"""Run the bundled collector with the project's confirmed scope and service addresses."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import os
import json
import importlib.util
import re
from pathlib import Path
import shutil
import subprocess
import time
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import ProxyHandler, build_opener, urlopen
import uuid

PULSE = "http://192.168.16.70:4185"
EMBER = "https://192.168.16.70:5443"
PACKAGE = Path(__file__).resolve().parent
PENDING = PACKAGE / ".pulse-pending"
PAIRED_SCOPE = "uploaded-sessions"


def approved_sources():
    selection = json.loads((PACKAGE / ".pulse-project-selection.json").read_text(encoding="utf-8-sig"))
    if selection.get("schema_version") != 1 or not selection.get("confirmed_at"):
        raise ValueError("需要先确认项目范围")
    sources = sorted({str(uuid.UUID(source)) for project in selection["projects"] for source in project["source_ids"]})
    if not sources:
        raise ValueError("没有获准上报的会话")
    return sources


def collector(action, work, sources, excluded=None, label=None, github_login=None, project_key=None):
    if sys.platform == "win32":
        def quote(text):
            return "'" + str(text).replace("'", "''") + "'"

        parameters = [f"-Action {action}", f"-Server {quote(PULSE)}",
                      "-OnlySource @(" + ",".join(quote(source) for source in sources) + ")"]
        if work is not None:
            parameters.append(f"-WorkDir {quote(work)}")
        if project_key is not None:
            parameters.append(f"-ProjectKey {quote(project_key)}")
        if action == "Prepare":
            parameters += ["-IncludeEvidence", "-ResolveGit"]
            for flag, value in (("ExcludeSessionId", excluded), ("Label", label), ("GitHubLogin", github_login)):
                if value:
                    parameters.append(f"-{flag} {quote(value)}")
        shell = shutil.which("pwsh") or "powershell.exe"
        command = [shell, "-NoProfile", "-Command",
                   "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; & "
                   + quote(PACKAGE / "pulse-report.ps1") + " " + " ".join(parameters)]
    else:
        interpreter = ["/usr/bin/perl", str(PACKAGE / "pulse-report.pl")] if sys.platform == "darwin" else [
            "sh", str(PACKAGE / "pulse-report-linux.sh")]
        command = interpreter + ["--action", action, "--server", PULSE]
        if work is not None:
            command += ["--work-dir", str(work)]
        if project_key is not None:
            command += ["--project-key", project_key]
        for source in sources:
            command += ["--only-source", source]
        if action == "Prepare":
            command += ["--include-evidence", "--resolve-git"]
            for flag, value in (("--exclude-session-id", excluded), ("--label", label), ("--github-login", github_login)):
                if value:
                    command += [flag, value]
    try:
        response = subprocess.run(command, cwd=PACKAGE, encoding="utf-8-sig", errors="replace", capture_output=True,
                                  timeout=300 if action in ("Prepare","Submit") else 35,
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired as exc:
        raise ValueError(f"Pulse {action} 执行超时，保留原批次后重试") from exc
    if response.returncode:
        raise ValueError(f"Pulse {action} 执行失败（退出码 {response.returncode}），请检查采集依赖及 Pulse 连通性")
    try:
        return json.loads(response.stdout)
    except ValueError as exc:
        raise ValueError(f"Pulse {action} 返回无效回执，请核对客户端和服务端版本") from exc


def load_connector():
    spec = importlib.util.spec_from_file_location("ember_connect", PACKAGE / "ember-connect.py")
    connector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(connector)
    return connector


def verify_package():
    entries = {}
    manifest = PACKAGE / "SHA256SUMS"
    if not manifest.is_file():
        raise ValueError("缺少包内 SHA256SUMS，请重新解压完整客户端")
    for line in manifest.read_text(encoding="utf-8").splitlines():
        digest, sep, name = line.partition("  ")
        if (not sep or not re.fullmatch(r"[a-f0-9]{64}", digest) or not name or name.startswith(".")
                or any(c in name for c in "/\\:") or name in entries):
            raise ValueError("包内校验清单格式错误，请重新下载客户端")
        entries[name] = digest
    required = {"ember-workspace.json", "Ember-LAN-CA.pem", "pulse-onboard.py", "ember-connect.py", "ember-member-listener.py"}
    if not required <= entries.keys():
        raise ValueError("包内校验清单不完整，请重新下载客户端")
    failed = [name for name, digest in entries.items()
              if not (PACKAGE / name).is_file() or hashlib.sha256((PACKAGE / name).read_bytes()).hexdigest() != digest]
    if failed:
        raise ValueError("客户端文件缺失或损坏，请重新解压：" + "、".join(failed))
    return len(entries)


def inspect_pulse():
    opener = build_opener(ProxyHandler({}))
    try:
        with opener.open(PULSE + "/api/v1/report-inventory", timeout=5) as response:
            return {"status":"reachable", "http":response.status}
    except HTTPError as exc:
        if exc.code in (401, 403):
            return {"status":"authorization_required", "http":exc.code}
        return {"status":"unsupported" if exc.code == 404 else "unavailable", "http":exc.code}
    except OSError:
        return {"status":"unavailable"}


def onboarding_preflight(result, connector, expected_member):
    team = connector.check_workspace()
    result["workspace"] = {key:team.get(key) for key in ("workspace", "workspace_id", "installed_release", "client_release", "platform")}
    if not connector.CREDENTIALS.is_file():
        result["next"] = "login"
        return
    member = connector.call_tool("get_onboarding_identity", {})
    if member.get("workspace_id") != team["workspace_id"]:
        raise ValueError("当前授权连接的团队工作区与接入包不一致")
    result["member"] = member["member"]
    if expected_member and expected_member not in (member["member"]["name"], member["member"]["id"]):
        raise ValueError("授权账号与预期不符，请用本人账号重新授权")
    result["missing_scopes"] = sorted({"read", "write", "private", "create_project_channels"} - set(member["scopes"]))
    if result["missing_scopes"]:
        result["next"] = "authorize_projects"
        return
    selection = PACKAGE / ".pulse-project-selection.json"
    if not selection.is_file():
        result["next"] = "confirm_projects"
        return
    approved_sources()
    result["channels"] = []
    for project in json.loads(selection.read_text(encoding="utf-8-sig"))["projects"]:
        key = project.get("repository")
        if not key:
            continue
        row = {"project":key}
        result["channels"].append(row)
        try:
            match = connector.call_tool("find_project_channel", {"repository":key})
            row["status"] = match["status"]
            if match["status"] != "matched":
                continue
            room = match["room"]["id"]
            row["room_id"] = room
            row["channel"] = f"{EMBER}/rooms/{room}?view=overview"
            snapshot = connector.call_tool("read_project_snapshot", {"room_id":room})["snapshot"]
            if snapshot and snapshot.get("revision"):
                row["updated_at"] = snapshot["updatedAt"]
                row["peer_confirmed"] = snapshot["peer_confirmed"]
                row["verify_url"] = f"{EMBER}/onboarding?" + urlencode({"room":room,"revision":snapshot["revision"]})
        except (ValueError, OSError, KeyError, StopIteration) as exc:
            row.update(status="pending", error=str(exc))
    rows = result["channels"]
    if not rows or any(row["status"] != "matched" or not row.get("verify_url") for row in rows):
        result["next"] = "bind_and_report"
    elif not all(row.get("peer_confirmed") for row in rows):
        result["next"] = "verify_report"
    else:
        result["next"] = "start_listener_and_schedule"


def bind_reporting_member(result):
    selection = json.loads((PACKAGE / ".pulse-project-selection.json").read_text(encoding="utf-8-sig"))
    if selection.get("ember_paired") != PAIRED_SCOPE:
        return
    try:
        proof = collector("DeviceProof", None, [])
        connector = load_connector()
        connector.check_workspace()
        result["ember_reporting_member"] = connector.call_tool("bind_pulse_device", proof)
    except (ValueError, OSError, KeyError, StopIteration, subprocess.SubprocessError) as exc:
        result["ember_reporting_member"] = {"status": "pending", "error": str(exc)}


def bind_project_channels():
    approved_sources()
    with publication_lock():
        return resolve_project_channels()


def resolve_project_channels():
    path = PACKAGE / ".pulse-project-selection.json"
    selection = json.loads(path.read_text(encoding="utf-8-sig"))
    connector = load_connector()
    connector.check_workspace()
    results = []
    paired = selection.get("ember_paired") == PAIRED_SCOPE
    projects = [project for project in selection["projects"] if project.get("ember_publish") is not False or (paired and project.get("ember_room_id"))]
    if not projects:
        return results
    rooms = {row["id"]: row for row in connector.call_tool("list_rooms", {})["rooms"] if row["kind"] != "direct"}
    for project in projects:
        repository = project.get("repository")
        try:
            saved = project.get("ember_room_id")
            if repository and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
                arguments = {"repository": repository}
                match = connector.call_tool("find_project_channel", arguments)
                if match["status"] == "matched":
                    room = match["room"]
                    if room["id"] not in rooms:
                        raise ValueError("找到的项目频道不在当前可访问列表，请刷新授权后重试")
                    status = "reused"
                elif match["status"] == "missing" and not saved:
                    if project.get("project_name"):
                        arguments["project_name"] = project["project_name"]
                    room = connector.call_tool("create_project_channel", arguments)["room"]
                    status = "resolved"
                else:
                    raise ValueError({
                        "ambiguous": "同一仓库存在多个频道绑定，需由管理员确认",
                        "forbidden": "当前 Ember 账号无法访问已绑定的频道，或缺少私有频道授权",
                        "missing": "本地有原频道记录，服务端未确认仓库绑定，请核对后再继续",
                    }.get(match["status"], "服务端未确认频道绑定"))
                if room["kind"] not in ("closed", "open"):
                    raise ValueError("服务端返回了无效的项目频道")
                room_id = room["id"]
                if room_id != saved:
                    project["ember_room_id"] = room_id
                    write_state(path, selection)
            elif saved and saved in rooms:
                room_id = saved
                status = "reused"
            else:
                raise ValueError("缺少已核实的 GitHub 仓库")
            results.append({"project": repository or project["workspace_name"], "room_id": room_id,
                            "channel": f"{EMBER}/rooms/{room_id}", "status": status})
        except (ValueError, OSError, KeyError, StopIteration) as exc:
            results.append({"project": repository or project.get("workspace_name"), "status": "pending", "error": str(exc)})
    return results


def plain(text):
    cleaned = re.sub(r"(?:https?://|(?:^|\s)[~/]|\b[A-Za-z]:[\\/])\S+", " ", str(text or ""))
    cleaned = re.sub(r"[<>\[\]@#*_~`]", "", cleaned)
    return " ".join(cleaned.split())[:200]


def reported_project_sessions(project_key, sources):
    sessions = []
    project = None
    for start in range(0, len(sources), 50):
        batch = sources[start:start + 50]
        inventory = collector("Inventory", None, batch, project_key=project_key)
        if not inventory.get("project"):
            continue
        if inventory["project"]["project_key"].lower() != project_key.lower():
            raise ValueError("Project Pulse 返回的项目归属不匹配")
        project = inventory["project"]
        allowed = set(batch)
        sessions.extend(row for row in inventory["sessions"]
                        if row["source_id"].lower() in allowed and row["project_key"].lower() == project_key.lower())
    return project, sessions


def verify_projects():
    approved_sources()
    selection = json.loads((PACKAGE / ".pulse-project-selection.json").read_text(encoding="utf-8-sig"))
    with urlopen(PULSE + "/api/v1/dashboard?days=7", timeout=10) as response:
        dashboard = json.load(response)
    results = []
    for project in selection["projects"]:
        key = project.get("repository") or project["workspace_name"]
        sources = sorted({str(uuid.UUID(value)) for value in project["source_ids"]})
        result = {"repository":key, "room_id":project.get("ember_room_id"), "selected_sources":len(sources)}
        result["partial_sections"] = [
            table for table, fields in (
                ("projects", ("full_name",)), ("project_reports", ("project_key",)),
                ("pulls", ("full_name",)), ("workspace_states", ("workspace_name",)),
                ("project_usage", ("project_key",)), ("memberships", ("full_name", "workspace_name")),
                ("sessions", ("full_name", "workspace_name")),
            )
            if any(next((row[field] for field in fields if row.get(field)), "").lower() == key.lower()
                   for row in dashboard.get(table) or [])
        ]
        result["dashboard_match"] = bool(result["partial_sections"])
        results.append(result)
        try:
            _, sessions = reported_project_sessions(key, sources)
            result["reported_sources"] = len({row["source_id"] for row in sessions})
        except (ValueError, KeyError, OSError, subprocess.SubprocessError) as exc:
            result["inventory_error"] = str(exc)
    return results


def write_state(path, record):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        json.dump(record, stream, ensure_ascii=True)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


@contextmanager
def file_lock(path):
    path.parent.mkdir(mode=0o700, exist_ok=True)
    with path.open("a+b") as lock:
        if sys.platform == "win32":
            import msvcrt
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def publication_lock():
    return file_lock(PENDING / "ember-publication.lock")


def ember_projects():
    approved_sources()
    selection = json.loads((PACKAGE / ".pulse-project-selection.json").read_text(encoding="utf-8-sig"))
    return {
        project["repository"].lower()
        for project in selection["projects"]
        if project.get("repository") and project.get("ember_publish") is not False
    }


def stage_progress(work):
    source = work / "ember-projects.json"
    queue = work / "ember-queued.json"
    if not source.is_file() or queue.is_file():
        return
    approved = ember_projects()
    entries = json.loads(source.read_text(encoding="utf-8-sig"))
    if not isinstance(entries, list):
        raise ValueError("ember-projects.json 必须是数组")
    observed = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    updates = {}
    for entry in entries:
        raw_repo = entry.get("repository") if isinstance(entry, dict) else None
        repo = raw_repo.lower() if isinstance(raw_repo, str) else ""
        if repo not in approved or repo in updates:
            raise ValueError("Ember 快照必须对应唯一且已确认发布的项目仓库")
        facts = {key: value for key, value in entry.items() if key != "repository"}
        if not facts or not facts.keys() <= {"goal", "status", "progress", "milestones", "pulls"}:
            raise ValueError("Ember 快照只接受项目摘要、目标、状态、里程碑和 PR")
        updates[repo] = {"revision": uuid.uuid4().hex, "observedAt": observed, "facts": facts}
    write_state(queue, {"updates": updates, "receipts": {}})


def publish_progress(channels):
    approved = ember_projects()
    verified = {item["project"].lower(): item["room_id"] for item in channels if "room_id" in item}
    results = []
    with publication_lock():
        connector = load_connector()
        pending = []
        for path in PENDING.glob("*/ember-queued.json"):
            state = json.loads(path.read_text(encoding="utf-8"))
            pending.extend((update["observedAt"], repo, path, update)
                           for repo, update in state["updates"].items() if repo not in state["receipts"])
        blocked = set()
        for _, repo, path, update in sorted(pending):
            if repo in blocked:
                continue
            result = {"project": repo, "work_dir": str(path.parent), "revision": update["revision"]}
            results.append(result)
            room = verified.get(repo)
            try:
                if repo not in approved or not room:
                    raise ValueError("项目范围或频道授权待核实")
                result["channel"] = f"{EMBER}/rooms/{room}"
                receipt = connector.call_tool("sync_project_snapshot", {
                    "room_id": room, "repository": repo, "update_json": json.dumps(update, ensure_ascii=False),
                })
                if receipt.get("revision") != update["revision"] or receipt.get("status") not in (
                    "published", "unchanged", "superseded",
                ):
                    raise ValueError("Ember 快照回执不匹配")
                state = json.loads(path.read_text(encoding="utf-8"))
                state["receipts"][repo] = receipt
                write_state(path, state)
                result.update(receipt)
                if receipt["status"] != "superseded":
                    try:
                        snapshot = connector.call_tool("read_project_snapshot", {"room_id":room})["snapshot"]
                        if not snapshot or snapshot["revision"] != update["revision"]:
                            raise ValueError("上报版本已更新，请从 preflight 核对当前快照")
                        result.update(readback_status="verified", peer_confirmed=snapshot["peer_confirmed"],
                                      verify_url=f"{EMBER}/onboarding?" + urlencode({"room":room,"revision":snapshot["revision"]}))
                    except (ValueError, OSError, KeyError, StopIteration) as exc:
                        result.update(readback_status="pending", readback_error=str(exc))
            except (ValueError, OSError, KeyError, RuntimeError, StopIteration) as exc:
                result.update(status="pending", error=str(exc))
                blocked.add(repo)
    return results


def submit_pulse(work, sources):
    if not (work / "plan.json").is_file():
        raise ValueError("Pulse 没有可提交的计划，恢复后运行 prepare")
    with file_lock(PENDING / "pulse-submission.lock"):
        receipt = work / "pulse-receipt.json"
        if receipt.is_file():
            return json.loads(receipt.read_text(encoding="utf-8"))
        result = collector("Submit", work, sources)
        write_state(receipt, result)
        (PENDING / "ember-context-revision").touch()
        return result


def start_listener():
    approved_sources()
    selection = json.loads((PACKAGE / ".pulse-project-selection.json").read_text(encoding="utf-8-sig"))
    if selection.get("ember_paired") != PAIRED_SCOPE:
        return "请用新版接入提示词确认项目"
    projects = selection["projects"]
    rooms = {p.get("ember_room_id") for p in projects}
    if not all(isinstance(room, str) and room for room in rooms):
        raise ValueError("启用本机代答的项目仍有频道未绑定")
    codex = shutil.which("codex")
    if not codex:
        raise OSError("找不到本机 Codex CLI")
    status = subprocess.run([codex, "login", "status"], cwd=PACKAGE, timeout=15,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if status.returncode:
        raise ValueError("本机 Codex CLI 尚未登录，请登录后重试")
    connector = load_connector()
    connector.check_workspace()
    response = connector.mcp({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, "2025-06-18")
    tools = {tool["name"] for tool in (response or {}).get("result", {}).get("tools", [])}
    if not {"read_room", "send_message"} <= tools:
        raise ValueError("Ember 网页授权缺少读取频道或发送消息权限")
    for room in sorted(rooms):
        connector.call_tool("read_room", {"room_id": room})
    with connector.mention_stream(sorted(rooms), 0):
        pass
    PENDING.mkdir(mode=0o700, exist_ok=True)
    options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS} if sys.platform == "win32" else {"start_new_session": True}
    with (PENDING / "ember-member-listener.log").open("ab") as log:
        process = subprocess.Popen([sys.executable, str(PACKAGE / "ember-member-listener.py")], stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=log, cwd=PACKAGE, **options)
    time.sleep(1)
    exit_code = process.poll()
    if exit_code not in (None, 3):
        raise OSError("本机 Codex 监听启动失败，请查看 .pulse-pending/ember-member-listener.log")
    return "已有监听进程" if exit_code == 3 else "监听已启动"


def check_listener(result):
    try:
        result["ember_member_listener"] = start_listener()
    except (ValueError, OSError, KeyError, StopIteration, subprocess.SubprocessError) as exc:
        result["ember_member_listener"] = "未就绪"
        result["ember_member_listener_error"] = str(exc)


def retry_ember(result):
    try:
        result["channels"] = bind_project_channels()
    except (ValueError, OSError, KeyError, StopIteration, subprocess.SubprocessError) as exc:
        result["ember_binding_error"] = str(exc)
    try:
        result["ember_posts"] = publish_progress(result.get("channels", []))
        if result["ember_posts"]:
            (PENDING / "ember-context-revision").touch()
    except (ValueError, OSError, KeyError, RuntimeError, StopIteration) as exc:
        result["ember_error"] = str(exc)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["links", "check-package", "preflight", "verify-projects", "bind-channels", "bind-pulse-device", "sync-ember", "start-listener", "prepare", "prepare-ember", "submit", "sync-pulse"])
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--exclude-session-id", type=lambda value: str(uuid.UUID(value)))
    parser.add_argument("--label")
    parser.add_argument("--github-login")
    parser.add_argument("--member", help="用 preflight 核对预期的 Ember 显示名或账号 ID")
    args = parser.parse_args()
    connector = load_connector()
    result = {"ember": EMBER, "ember_oauth": connector.ORIGIN, "project_pulse": PULSE, "onboarding": EMBER + "/onboarding"}
    try:
        if args.action == "check-package":
            result["package_files_verified"] = verify_package()
        elif args.action == "preflight":
            result["package_files_verified"] = verify_package()
            result["codex_cli"] = bool(shutil.which("codex"))
            result["github_cli"] = bool(shutil.which("gh"))
            onboarding_preflight(result, connector, args.member)
            result["pulse"] = inspect_pulse()
            try:
                if sys.platform == "win32":
                    collector("DeviceProof", None, [])
                else:
                    perl = shutil.which("perl")
                    if not perl or not shutil.which("curl"):
                        raise OSError("缺少 Perl 或 curl")
                    subprocess.run([perl, "-MJSON::PP", "-MDigest::SHA", "-e", "1"], check=True, timeout=10)
                result["collector_ready"] = True
            except (ValueError, OSError, subprocess.SubprocessError):
                result["collector_ready"] = False
        elif args.action == "verify-projects":
            result["projects"] = verify_projects()
        elif args.action == "start-listener":
            check_listener(result)
        elif args.action == "bind-pulse-device":
            bind_reporting_member(result)
        elif args.action != "links":
            sources = approved_sources()
            work = args.work_dir.resolve() if args.work_dir else None
            if work and (work.parent != PENDING.resolve() or not work.is_dir()):
                raise ValueError("请使用本轮准备上报返回的工作目录")
            if args.action in ("prepare", "prepare-ember"):
                PENDING.mkdir(mode=0o700, exist_ok=True)
                work = PENDING / uuid.uuid4().hex
                result["work_dir"] = str(work)
                if args.action == "prepare-ember":
                    work.mkdir(mode=0o700)
                else:
                    result["report"] = collector("Prepare", work, sources, args.exclude_session_id, args.label, args.github_login)
            elif args.action in ("bind-channels", "sync-ember", "submit", "sync-pulse"):
                if args.action in ("submit", "sync-pulse") and not work:
                    raise ValueError("请使用本轮准备上报返回的工作目录")
                if work:
                    result["work_dir"] = str(work)
                if args.action != "sync-pulse":
                    if work:
                        try:
                            with publication_lock():
                                stage_progress(work)
                        except (ValueError, OSError, KeyError, TypeError) as exc:
                            result["ember_stage_error"] = str(exc)
                    retry_ember(result)
                if args.action in ("submit", "sync-pulse"):
                    try:
                        result["report"] = submit_pulse(work, sources)
                    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as exc:
                        result["pulse_error"] = str(exc)
                if args.action == "submit":
                    bind_reporting_member(result)
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as exc:
        result["error"] = str(exc)
        if isinstance(exc, HTTPError) and args.action == "preflight":
            result["error"] = ("请重新用本人账号授权 Ember" if exc.code in (401, 403) else
                               "无法确认团队 Ember 工作区，请核对接入地址和客户端版本")
    binding = result.get("ember_reporting_member", {})
    listener = result.get("ember_member_listener")
    if args.action in ("bind-channels", "bind-pulse-device", "sync-ember", "submit", "sync-pulse", "start-listener"):
        incomplete = []
        if "pulse_error" in result:
            incomplete.append("pulse")
        if "ember_stage_error" in result:
            incomplete.append("ember_stage")
        if "ember_binding_error" in result or any("error" in item for item in result.get("channels", [])):
            incomplete.append("channels")
        if "ember_member_listener_error" in result or (listener and listener not in ("已有监听进程", "监听已启动")):
            incomplete.append("ember_member_listener")
        if binding and binding.get("status") != "bound":
            incomplete.append("ember_reporting_member")
        if "ember_error" in result or any("error" in item for item in result.get("ember_posts", [])):
            incomplete.append("ember_posts")
        if any(item.get("readback_status") == "pending" for item in result.get("ember_posts", [])):
            incomplete.append("ember_readback")
        if incomplete:
            result["incomplete"] = incomplete
    if "error" in result or result.get("incomplete") or result.get("collector_ready") is False:
        result["recovery"] = {
            "report_to_codex":"提供命令、失败字段和错误信息。不要复制密码、Token 或 OAuth 文件。",
            "retry":"修复指明的问题后重跑原命令。已准备的批次沿用原 work_dir，保留游标和回执。",
        }
    print(json.dumps(result, ensure_ascii=True))
    return 1 if "error" in result else 2 if result.get("incomplete") else 0


if __name__ == "__main__":
    sys.exit(main())
