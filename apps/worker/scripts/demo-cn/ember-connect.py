"""Connect a local Codex CLI to Ember over HTTPS with browser consent."""
import argparse
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import secrets
import ssl
import subprocess
import sys
import time
from threading import Lock
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener

ORIGIN = "https://192.168.16.70:5443"
RESOURCE = ORIGIN + "/mcp"
PACKAGE = Path(__file__).resolve().parent
STATE = Path.home() / ".ember-cn"
CREDENTIALS = STATE / "oauth.json"
_REFRESH = Lock()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def connection():
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.load_verify_locations(PACKAGE / "Ember-LAN-CA.pem")
    return build_opener(ProxyHandler({}), NoRedirect(), HTTPSHandler(context=context))


def check_workspace():
    path = PACKAGE / "ember-workspace.json"
    if not path.is_file():
        raise ValueError("缺少工作区配置，请从团队接入页重新下载完整 ZIP")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    platform = {"win32":"windows", "darwin":"macos", "linux":"linux"}.get(sys.platform)
    if manifest.get("platform", "universal") not in ("universal", platform):
        raise ValueError("客户端包与当前操作系统不匹配，请从团队接入页下载对应版本")
    with connection().open(ORIGIN + "/api/onboarding", timeout=8) as response:
        actual = json.load(response)
    if not manifest.get("workspace_id") or actual.get("workspace_id") != manifest["workspace_id"]:
        raise ValueError("当前 Ember 与接入包的团队工作区不一致。请从团队接入页重新下载。")
    return {**actual, "installed_release": manifest["client_release"], "platform": platform}


def request(path, payload, *, form=False, token=None, protocol=None):
    headers = {"Content-Type": "application/x-www-form-urlencoded" if form else "application/json",
               "Accept": "application/json, text/event-stream"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if protocol:
        headers["MCP-Protocol-Version"] = protocol
    data = (urlencode(payload) if form else json.dumps(payload)).encode()
    with connection().open(Request(ORIGIN + path, data, headers), timeout=25) as response:
        if response.status == 202 or response.status == 204:
            return None
        if response.headers.get_content_type() == "text/event-stream":
            lines = (line[6:] for line in response if line.startswith(b"data: "))
            return json.loads(next(lines))
        return json.load(response)


def save(client, tokens):
    STATE.mkdir(mode=0o700, exist_ok=True)
    temporary = STATE / ("oauth-" + secrets.token_hex(8) + ".tmp")
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
        json.dump({"client_id": client, **tokens}, stream)
    temporary.replace(CREDENTIALS)


def connect(include_private=False, include_write=False, create_projects=False, open_browser=False):
    check_workspace()
    scopes = ["read"]
    if include_write or create_projects:
        scopes.append("write")
    if include_private or create_projects:
        scopes.append("private")
    if create_projects:
        scopes.append("create_project_channels")
    nonce = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    result = {}

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            url = urlsplit(self.path)
            params = parse_qs(url.query)
            if url.path != "/callback" or params.get("state") != [nonce] or params.get("iss") != [ORIGIN]:
                self.send_error(400)
                return
            result.update(params)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("已收到授权结果，请返回 Codex。".encode())

    with HTTPServer(("127.0.0.1", 0), Callback) as callback:
        redirect = f"http://127.0.0.1:{callback.server_port}/callback"
        client = request("/oauth/register", {"client_name": "Codex（Ember 中文局域网）",
                                             "redirect_uris": [redirect]})["client_id"]
        query = urlencode({"response_type": "code", "client_id": client, "redirect_uri": redirect,
                           "state": nonce, "code_challenge": challenge, "code_challenge_method": "S256",
                           "scope": " ".join(scopes),
                           "resource": RESOURCE})
        url = ORIGIN + "/oauth/authorize?" + query
        print(url, flush=True)
        if open_browser:
            webbrowser.open(url)
        deadline = time.monotonic() + 300
        while not result and time.monotonic() < deadline:
            callback.timeout = max(0, deadline - time.monotonic())
            callback.handle_request()

    if not result.get("code"):
        raise RuntimeError("没有收到网页授权")
    tokens = request("/oauth/token", {"grant_type": "authorization_code", "code": result["code"][0],
                     "client_id": client, "code_verifier": verifier, "redirect_uri": redirect,
                     "resource": RESOURCE}, form=True)
    save(client, tokens)


@contextmanager
def refresh_file_lock():
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / "oauth-refresh.lock").open("a+b") as lock:
        deadline = time.monotonic() + 28
        while True:
            try:
                if sys.platform == "win32":
                    import msvcrt
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as exc:
                if time.monotonic() >= deadline:
                    raise OSError("另一个进程正在刷新 Ember 授权，本轮稍后重试") from exc
                time.sleep(0.2)
        yield


def authorized(call, *, refresh=True):
    try:
        current = json.loads(CREDENTIALS.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError("请用本人账号重新授权 Ember，再续传原批次") from exc
    try:
        return call(current["access_token"])
    except HTTPError as error:
        if error.code != 401 or not refresh:
            raise
    with _REFRESH, refresh_file_lock():
        latest = json.loads(CREDENTIALS.read_text(encoding="utf-8"))
        if latest["access_token"] == current["access_token"]:
            client = latest["client_id"]
            try:
                tokens = request("/oauth/token", {"grant_type": "refresh_token", "client_id": client,
                                 "refresh_token": latest["refresh_token"], "resource": RESOURCE}, form=True)
            except HTTPError as exc:
                if exc.code == 400:
                    try:
                        reason = json.load(exc)
                    except (ValueError, OSError):
                        reason = None
                    if isinstance(reason, dict) and reason.get("error") == "invalid_grant":
                        raise ValueError("Ember 授权已失效，请用本人账号重新授权，再续传原批次") from exc
                raise
            save(client, tokens)
            latest = tokens
    return call(latest["access_token"])


def mcp(message, protocol=None, *, refresh=True):
    return authorized(lambda token: request("/mcp", message, token=token, protocol=protocol), refresh=refresh)


def mention_stream(rooms, after):
    if not rooms:
        raise ValueError("需要已绑定的项目频道")
    query = [("room", room) for room in rooms]
    path = "/api/codex/mentions?" + urlencode(query)

    def open_stream(token):
        headers = {"Authorization": "Bearer " + token, "Accept": "text/event-stream", "Last-Event-ID": str(after)}
        return connection().open(Request(ORIGIN + path, headers=headers), timeout=25)

    stream = authorized(open_stream)
    if stream.headers.get_content_type() != "text/event-stream":
        stream.close()
        raise ValueError("Ember 代答推送格式错误")
    return stream


def mention_events(rooms, after, still_bound):
    with mention_stream(rooms, after) as stream:
        fields = {}
        for raw in stream:
            if raw.startswith(b":") and not still_bound():
                return
            line = raw.decode("utf-8").rstrip("\r\n")
            if not line:
                if fields.get("event") == "mention":
                    yield int(fields["id"]), json.loads(fields["data"])
                fields.clear()
            elif ":" in line and not line.startswith(":"):
                name, value = line.split(":", 1)
                fields[name] = value.lstrip(" ")


def mention_job(action, room_id, message_id, lease_id=None):
    payload = {"action": action, "roomId": room_id, "messageId": message_id}
    if lease_id:
        payload["leaseId"] = lease_id
    return authorized(lambda token: request("/api/codex/mentions", payload, token=token))


def call_tool(name, arguments, *, refresh=True):
    reply = mcp({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                 "params": {"name": name, "arguments": arguments}}, "2025-06-18", refresh=refresh)
    result = reply.get("result", {})
    if not result or result.get("isError"):
        raise ValueError("Ember 拒绝操作，请检查网页授权和频道权限")
    return json.loads(result["content"][0]["text"])


def serve():
    protocol = None
    for line in sys.stdin:
        message = json.loads(line)
        try:
            reply = mcp(message, protocol)
            if message.get("method") == "initialize" and reply:
                protocol = reply.get("result", {}).get("protocolVersion")
            if reply is not None:
                print(json.dumps(reply), flush=True)
        except (OSError, ValueError, KeyError, StopIteration):
            if "id" in message:
                print(json.dumps({"jsonrpc": "2.0", "id": message["id"],
                                  "error": {"code": -32000, "message": "无法连接 Ember，请核对网络或重新授权。"}}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["connect", "serve", "rooms"])
    parser.add_argument("--private", action="store_true", help="允许在网页上选择私聊和私有频道")
    parser.add_argument("--write", action="store_true", help="申请发布项目进展的权限")
    parser.add_argument("--project-channels", action="store_true", help="申请创建私有项目频道并发布进展的权限")
    args = parser.parse_args()
    if args.mode == "serve":
        serve()
        return
    if args.mode == "rooms":
        print(json.dumps(call_tool("list_rooms", {})))
        return
    connect(args.private, args.write, args.project_channels, open_browser=True)
    subprocess.run(["codex", "mcp", "add", "ember-cn", "--", sys.executable,
                    str(Path(__file__).resolve()), "serve"], check=True)
    print("Ember 网页授权已完成。重新打开 Codex 会话即可调用 ember-cn。")


if __name__ == "__main__":
    main()
