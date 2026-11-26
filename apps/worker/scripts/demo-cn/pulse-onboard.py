"""Run the bundled collector with the project's confirmed scope and service addresses."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import errno
import hashlib
import os
import json
import importlib.util
import math
import re
from pathlib import Path
import shutil
import signal
import subprocess
import time
import sys
from http.client import HTTPException
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import ProxyHandler, build_opener, urlopen
import uuid

PULSE = "http://192.168.16.70:4185"
EMBER = "https://192.168.16.70:5443"
PACKAGE = Path(__file__).resolve().parent
PENDING = PACKAGE / ".pulse-pending"
PAIRED_SCOPE = "uploaded-sessions"
LISTENER_TIMEOUT = 120


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


class LockBusy(OSError):
    pass


@contextmanager
def file_lock(path):
    path.parent.mkdir(mode=0o700, exist_ok=True)
    with path.open("a+b") as lock:
        try:
            if sys.platform == "win32":
                import msvcrt
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if exc.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK) or getattr(exc, "winerror", None) == 33:
                raise LockBusy("已有上报在执行，保留批次等待下一轮") from exc
            raise
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
    if any(work.glob("ember-queued.invalid-*.json")):
        raise ValueError("此工作目录有隔离批次，请保留文件并核对版本后修复")
    approved = ember_projects()
    entries = json.loads(source.read_text(encoding="utf-8-sig"))
    if not isinstance(entries, list):
        raise ValueError("ember-projects.json 必须是数组")
    observed = datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    updates = {}
    no_change = []
    seen = set()
    for entry in entries:
        raw_repo = entry.get("repository") if isinstance(entry, dict) else None
        repo = raw_repo.lower() if isinstance(raw_repo, str) else ""
        if repo not in approved or repo in seen:
            raise ValueError("Ember 快照必须对应唯一且已确认发布的项目仓库")
        seen.add(repo)
        facts = {key: value for key, value in entry.items() if key != "repository"}
        if set(facts) == {"no_change"} and facts["no_change"] is True:
            no_change.append(repo)
            continue
        if not facts or not facts.keys() <= {"goal", "status", "progress", "milestones", "pulls"}:
            raise ValueError("Ember 快照只接受项目摘要、目标、状态、里程碑和 PR")
        updates[repo] = {"revision": uuid.uuid4().hex, "observedAt": observed, "facts": facts}
    write_state(queue, {"updates": updates, "receipts": {}, "no_change": no_change})


def queue_contents(path):
    state = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(state, dict) or not all(isinstance(state.get(key), dict) for key in ("updates", "receipts")):
        raise ValueError("待发文件结构无效")
    readbacks = state.setdefault("readbacks", {})
    if not isinstance(readbacks, dict):
        raise ValueError("读回记录结构无效")
    no_change = state.get("no_change", [])
    if not isinstance(no_change, list) or any(not isinstance(repo, str) or repo in state["updates"] for repo in no_change):
        raise ValueError("无进展记录结构无效")
    for repo, update in state["updates"].items():
        if (not isinstance(update, dict) or not re.fullmatch(r"[a-f0-9]{32}", str(update.get("revision", ""))) or
                not isinstance(update.get("observedAt"), str) or not isinstance(update.get("facts"), dict)):
            raise ValueError("待发版本无效")
        receipt = state["receipts"].get(repo)
        if repo in state["receipts"] and (not isinstance(receipt, dict) or receipt.get("revision") != update["revision"] or
                                    receipt.get("status") not in ("published", "unchanged", "superseded")):
            raise ValueError("写入回执无效")
        readback = readbacks.get(repo)
        if repo in readbacks and (receipt is None or not isinstance(readback, dict) or
                                     readback.get("readback_status") not in ("verified", "superseded")):
            raise ValueError("读回记录无效")
    return state


def retry_request(call):
    for attempt in range(3):
        try:
            return call()
        except HTTPError as exc:
            if exc.code not in (408, 500, 502, 503, 504) or attempt == 2:
                raise
        except OSError:
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)


def publish_progress(channels):
    approved = ember_projects()
    verified = {item["project"].lower(): item["room_id"] for item in channels if "room_id" in item}
    results = []
    with publication_lock():
        connector = load_connector()
        pending = []
        for path in PENDING.glob("*/ember-queued.json"):
            try:
                state = queue_contents(path)
            except (ValueError, UnicodeError) as exc:
                quarantined = path.with_name(f"ember-queued.invalid-{uuid.uuid4().hex}.json")
                try:
                    path.replace(quarantined)
                except OSError as move_error:
                    results.append({"status": "pending", "work_dir": str(path.parent), "error": f"无法隔离损坏批次：{move_error}"})
                    continue
                results.append({"status": "quarantined", "work_dir": str(path.parent),
                                "quarantined_file": str(quarantined), "error": f"保留损坏批次：{exc}"})
                continue
            except OSError as exc:
                results.append({"status": "pending", "work_dir": str(path.parent), "error": str(exc)})
                continue
            pending.extend((update["observedAt"], repo, path, update, state)
                           for repo, update in state["updates"].items()
                           if repo not in state["readbacks"] and state["receipts"].get(repo, {}).get("status") != "superseded")
        blocked = set()
        snapshots = {}
        for _, repo, path, update, state in sorted(pending, key=lambda item: item[:3]):
            if repo in blocked:
                continue
            result = {"project": repo, "work_dir": str(path.parent), "revision": update["revision"]}
            results.append(result)
            room = verified.get(repo)
            try:
                if repo not in approved or not room:
                    raise ValueError("项目范围或频道授权待核实")
                result["channel"] = f"{EMBER}/rooms/{room}"
                if repo not in state["receipts"]:
                    receipt = retry_request(lambda: connector.call_tool("sync_project_snapshot", {
                        "room_id": room, "repository": repo, "update_json": json.dumps(update, ensure_ascii=False),
                    }))
                    if receipt.get("revision") != update["revision"] or receipt.get("status") not in (
                        "published", "unchanged", "superseded",
                    ):
                        raise ValueError("Ember 快照回执不匹配")
                    state["receipts"][repo] = receipt
                    write_state(path, state)
                    snapshots.pop(room, None)
                receipt = state["receipts"][repo]
                result.update(receipt)
                if receipt["status"] == "superseded":
                    continue
                try:
                    if room not in snapshots:
                        snapshots[room] = retry_request(lambda: connector.call_tool(
                            "read_project_snapshot", {"room_id": room}))["snapshot"]
                    snapshot = snapshots[room]
                    if snapshot and snapshot.get("revision") == update["revision"]:
                        readback = {"readback_status": "verified", "peer_confirmed": snapshot["peer_confirmed"],
                                    "verify_url": f"{EMBER}/onboarding?" + urlencode({"room": room, "revision": snapshot["revision"]})}
                    elif snapshot and snapshot.get("revision") and (
                        (snapshot.get("observedAt") or snapshot.get("updatedAt") or "", snapshot["revision"]) >
                        (update["observedAt"], update["revision"])
                    ):
                        readback = {"readback_status": "superseded", "current_revision": snapshot["revision"]}
                    else:
                        raise ValueError("尚未读到该版本，稍后重新核验")
                    state["readbacks"][repo] = readback
                    write_state(path, state)
                    result.update(readback)
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


def listener_running():
    try:
        with file_lock(PENDING / "ember-member-uploaded-sessions.lock"):
            return False
    except LockBusy:
        return True


@contextmanager
def windows_listener_process(pid, *, terminate=False):
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel.GetProcessTimes.argtypes = (wintypes.HANDLE,) + (ctypes.POINTER(wintypes.FILETIME),) * 4
    kernel.TerminateProcess.argtypes = (wintypes.HANDLE, wintypes.UINT)
    handle = kernel.OpenProcess(0x1000 | (0x0001 if terminate else 0), False, pid)
    if not handle:
        error = ctypes.get_last_error()
        if error == 87:  # No such process.
            yield None, None
            return
        raise ctypes.WinError(error)
    try:
        times = [wintypes.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in times)):
            raise ctypes.WinError(ctypes.get_last_error())
        created = times[0]
        yield str((created.dwHighDateTime << 32) | created.dwLowDateTime), (
            lambda: kernel.TerminateProcess(handle, 1)
        )
    finally:
        kernel.CloseHandle(handle)


def listener_process_stamp(pid):
    if sys.platform == "win32":
        with windows_listener_process(pid) as (stamp, _):
            return stamp
    result = subprocess.run(["ps", "-ww", "-p", str(pid), "-o", "lstart=", "-o", "command="],
                            capture_output=True, timeout=5, env={**os.environ, "LC_ALL": "C"})
    return hashlib.sha256(result.stdout.strip()).hexdigest() if result.returncode == 0 and result.stdout.strip() else None


def listener_state(name):
    try:
        value = json.loads((PENDING / name).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def listener_signal_age(instance, *, startup_grace=True):
    heartbeat = listener_state("ember-listener-health.json")
    stamp = heartbeat.get("server_signal_at") if heartbeat.get("instance") == instance.get("instance") else None
    if not isinstance(stamp, (int, float)) or not math.isfinite(stamp) or stamp > time.time() + 5:
        stamp = instance.get("started_at") if startup_grace else None
    return max(0, time.time() - stamp) if isinstance(stamp, (int, float)) and math.isfinite(stamp) else None


def stop_stalled_listener(instance):
    if not listener_running():
        return True
    if listener_state("ember-listener-process.json") != instance:
        raise ValueError("监听进程已变更，保留现有进程")
    age = listener_signal_age(instance)
    if age is None or age <= LISTENER_TIMEOUT:
        return False
    pid, expected = instance.get("pid"), instance.get("process_stamp")
    if type(pid) is not int or pid <= 0 or pid == os.getpid() or not expected:
        raise ValueError("无法确认监听进程身份，保留现有进程")
    if sys.platform == "win32":
        with windows_listener_process(pid, terminate=True) as (stamp, terminate):
            if stamp != expected:
                raise ValueError("监听进程身份不匹配，保留现有进程")
            if not terminate():
                raise OSError("无法停止卡住的 Ember 监听进程")
    else:
        try:
            pidfd = os.pidfd_open(pid) if hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal") else None
            try:
                if listener_process_stamp(pid) != expected:
                    raise ValueError("监听进程身份不匹配，保留现有进程")
                if pidfd is None:
                    os.kill(pid, signal.SIGKILL)
                else:
                    signal.pidfd_send_signal(pidfd, signal.SIGKILL)
            finally:
                if pidfd is not None:
                    os.close(pidfd)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + 8
    while listener_running():
        if time.monotonic() >= deadline:
            raise OSError("旧监听未释放锁，本轮不会再启动进程")
        time.sleep(0.2)
    return True


def start_listener(expected_member=None, *, verify_binding=False, stalled=None):
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
    workspace = connector.check_workspace()
    if expected_member or verify_binding:
        identity = connector.call_tool("get_onboarding_identity", {})
        if identity.get("workspace_id") != workspace["workspace_id"] or (
            expected_member and expected_member not in (identity["member"]["id"], identity["member"]["name"])
        ):
            raise ValueError("监听授权账号或工作区与定时任务不符，请用本人账号重新授权")
    if verify_binding:
        for project in projects:
            repository = project.get("repository")
            if not repository:
                raise ValueError("自动恢复监听需要已确认的仓库与频道绑定")
            bound = connector.call_tool("find_project_channel", {"repository": repository})
            if bound.get("status") != "matched" or bound["room"]["id"] != project["ember_room_id"]:
                raise ValueError(f"监听频道绑定待核实：{repository}")
    response = connector.mcp({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, "2025-06-18")
    tools = {tool["name"] for tool in (response or {}).get("result", {}).get("tools", [])}
    if not {"read_room", "send_message"} <= tools:
        raise ValueError("Ember 网页授权缺少读取频道或发送消息权限")
    for room in sorted(rooms):
        connector.call_tool("read_room", {"room_id": room})
    with connector.mention_stream(sorted(rooms), 0) as stream:
        if stalled and stream.readline(1024).strip() != b": ready":
            raise OSError("Ember 推送未就绪，保留原监听并等待下一轮")
    if stalled is not None and not stop_stalled_listener(stalled):
        return "已有监听进程"
    if listener_running():
        return "已有监听进程"
    PENDING.mkdir(mode=0o700, exist_ok=True)
    options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS} if sys.platform == "win32" else {"start_new_session": True}
    with (PENDING / "ember-member-listener.log").open("ab") as log:
        process = subprocess.Popen([sys.executable, str(PACKAGE / "ember-member-listener.py")], stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=log, cwd=PACKAGE, **options)
    deadline = time.monotonic() + (15 if stalled is not None else 5)
    while time.monotonic() < deadline:
        exit_code = process.poll()
        instance = listener_state("ember-listener-process.json")
        if exit_code is None and instance.get("pid") == process.pid and listener_running():
            if stalled is None:
                return "监听已启动"
            age = listener_signal_age(instance, startup_grace=False)
            if age is not None and age <= LISTENER_TIMEOUT:
                return "监听已重启"
        if exit_code == 3 and listener_running():
            return "已有监听进程"
        if exit_code is not None:
            break
        time.sleep(0.2)
    raise OSError("尚未确认监听进程启动或重启后的心跳，请查看 .pulse-pending/ember-member-listener.log")


def check_listener(result, expected_member=None, *, verify_binding=False):
    try:
        with file_lock(PENDING / "ember-member-listener-start.lock"):
            if not listener_running():
                result["ember_member_listener"] = start_listener(expected_member, verify_binding=verify_binding)
                return
            instance = listener_state("ember-listener-process.json")
            age = listener_signal_age(instance)
            if age is not None:
                result["ember_member_listener_signal_age_seconds"] = int(age)
            if age is not None and age <= LISTENER_TIMEOUT:
                result["ember_member_listener"] = "已有监听进程"
                return
            if not instance.get("instance"):
                raise ValueError("旧监听缺少可验证的进程记录，请停止旧版后启动新版监听")
            result["ember_member_listener"] = start_listener(expected_member, verify_binding=True, stalled=instance)
    except (ValueError, OSError, KeyError, StopIteration, subprocess.SubprocessError, HTTPException) as exc:
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


def ember_cycle_projects(result, work, repositories):
    queue = {}
    unreadable = False
    if work and any((work / name).is_file() for name in ("ember-projects.json", "ember-queued.json")):
        try:
            queue = queue_contents(work / "ember-queued.json")
        except (ValueError, OSError):
            unreadable = True
    updates = queue.get("updates", {})
    waiting = {
        item["project"]: item for item in result.get("ember_posts", [])
        if "project" in item and (item.get("error") or item.get("readback_status") == "pending")
    }
    rows = []
    for repo in sorted(repositories):
        row = {"project": repo}
        if repo in updates:
            receipt = queue["receipts"].get(repo, {})
            readback = queue["readbacks"].get(repo, {})
            status = "pending_retry"
            if receipt.get("status") == "superseded" or readback.get("readback_status") == "superseded":
                status = "superseded"
            elif readback.get("readback_status") == "verified":
                status = "updated" if receipt["status"] == "published" else "no_change"
            row.update(revision=updates[repo]["revision"], **readback)
        elif repo in queue.get("no_change", []):
            status = "no_change"
        else:
            status = "pending_retry" if unreadable else "missing_draft"
        if repo in waiting:
            item = waiting[repo]
            if status != "missing_draft":
                status = "pending_retry"
            row["retry_error"] = item.get("readback_error") or item.get("error")
        row["status"] = status
        rows.append(row)
    return rows


def cycle(result, work, sources, args):
    with file_lock(PENDING / "report-cycle.lock"):
        # A finished draft is renamed to ember-projects.json by its producer.
        # Look for drafts left by an interrupted run, including the optional work directory.
        try:
            with publication_lock():
                for draft in sorted(PENDING.glob("*/ember-projects.json")):
                    if draft.parent != work and any(draft.parent.glob("ember-queued.invalid-*.json")):
                        continue
                    try:
                        stage_progress(draft.parent)
                    except (ValueError, OSError, KeyError, TypeError) as exc:
                        result.setdefault("ember_stage_errors", []).append({"work_dir": str(draft.parent), "error": str(exc)})
        except OSError as exc:
            result["ember_stage_error"] = str(exc)
        retry_ember(result)
        result["ember_projects"] = ember_cycle_projects(result, work, ember_projects())
        check_listener(result, args.member, verify_binding=True)
        if args.ember_only:
            return
        try:
            # Prepare resumes the existing collector state first. The Python receipt is
            # reused for explicit work directories that already have a plan.
            if not work or not (work / "plan.json").is_file():
                work = PENDING / uuid.uuid4().hex
                with file_lock(PENDING / "pulse-submission.lock"):
                    prepared = collector("Prepare", work, sources, args.exclude_session_id, args.label, args.github_login)
                    result["prepared"] = {key:value for key, value in prepared.items() if key != "evidence"}
            result["pulse_work_dir"] = str(work)
            result["report"] = submit_pulse(work, sources)
        except (ValueError, OSError, KeyError, subprocess.SubprocessError) as exc:
            result["pulse_error"] = str(exc)
        bind_reporting_member(result)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["links", "check-package", "preflight", "verify-projects", "bind-channels", "bind-pulse-device", "sync-ember", "start-listener", "prepare", "prepare-ember", "submit", "sync-pulse", "cycle"])
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--ember-only", action="store_true", help="cycle 只续传和核验 Ember 项目快照")
    parser.add_argument("--exclude-session-id", type=lambda value: str(uuid.UUID(value)))
    parser.add_argument("--label")
    parser.add_argument("--github-login")
    parser.add_argument("--member", help="预期的 Ember 显示名或账号 ID")
    args = parser.parse_args()
    if args.ember_only and args.action != "cycle":
        parser.error("--ember-only requires cycle")
    result = {"operation": args.action, "ember": EMBER, "ember_oauth": EMBER, "project_pulse": PULSE, "onboarding": EMBER + "/onboarding"}
    try:
        if args.action == "check-package":
            result["package_files_verified"] = verify_package()
        elif args.action == "preflight":
            result["package_files_verified"] = verify_package()
            result["codex_cli"] = bool(shutil.which("codex"))
            result["github_cli"] = bool(shutil.which("gh"))
            onboarding_preflight(result, load_connector(), args.member)
            result["pulse"] = inspect_pulse()
            try:
                if sys.platform == "win32":
                    if not shutil.which("curl.exe"):
                        raise OSError("缺少 curl.exe")
                    collector("DeviceProof", None, [])
                else:
                    perl = shutil.which("/usr/bin/perl" if sys.platform == "darwin" else "perl")
                    if not perl or not shutil.which("curl") or (sys.platform != "darwin" and not shutil.which("sh")):
                        raise OSError("缺少本机脚本依赖")
                    subprocess.run([perl, "-MJSON::PP", "-MDigest::SHA", "-e", "1"], check=True, timeout=10)
                result["collector_ready"] = True
            except (ValueError, OSError, subprocess.SubprocessError) as exc:
                result["collector_ready"] = False
                result["collector_error"] = str(exc)
        elif args.action == "verify-projects":
            result["projects"] = verify_projects()
        elif args.action == "start-listener":
            check_listener(result, args.member)
        elif args.action == "bind-pulse-device":
            bind_reporting_member(result)
        elif args.action != "links":
            sources = approved_sources()
            work = args.work_dir.resolve() if args.work_dir else None
            if work and (work.parent != PENDING.resolve() or not work.is_dir()):
                raise ValueError("请使用本轮准备上报返回的工作目录")
            if args.action == "cycle":
                verify_package()
                try:
                    cycle(result, work, sources, args)
                except LockBusy:
                    result["status"] = "already_running"
            elif args.action in ("prepare", "prepare-ember"):
                PENDING.mkdir(mode=0o700, exist_ok=True)
                work = PENDING / uuid.uuid4().hex
                result["work_dir"] = str(work)
                if args.action == "prepare-ember":
                    work.mkdir(mode=0o700)
                else:
                    with file_lock(PENDING / "pulse-submission.lock"):
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
    if args.action in ("bind-channels", "bind-pulse-device", "sync-ember", "submit", "sync-pulse", "start-listener", "cycle"):
        incomplete = ["already_running"] if result.get("status") == "already_running" else []
        if "pulse_error" in result:
            incomplete.append("pulse")
        if args.action == "cycle" and (result.get("report", {}).get("usage_verified") is False or
                                        result.get("prepared", {}).get("diagnostics", {}).get("recovery_unverified")):
            incomplete.append("pulse_receipt_unverified")
        if "ember_stage_error" in result or result.get("ember_stage_errors"):
            incomplete.append("ember_stage")
        if "ember_binding_error" in result or any("error" in item for item in result.get("channels", [])):
            incomplete.append("channels")
        if "ember_member_listener_error" in result or (listener and listener not in (
            "已有监听进程", "监听已启动", "监听已重启",
        )):
            incomplete.append("ember_member_listener")
        if binding and binding.get("status") != "bound":
            incomplete.append("ember_reporting_member")
        if "ember_error" in result or any("error" in item for item in result.get("ember_posts", [])):
            incomplete.append("ember_posts")
        if any(item.get("readback_status") == "pending" for item in result.get("ember_posts", [])):
            incomplete.append("ember_readback")
        if any(item["status"] in ("missing_draft", "pending_retry") for item in result.get("ember_projects", [])):
            incomplete.append("ember_projects")
        if incomplete:
            result["incomplete"] = incomplete
    if args.action == "preflight" and "error" not in result:
        incomplete = []
        if result.get("collector_ready") is False:
            incomplete.append("collector")
        if result.get("pulse", {}).get("status") in ("unavailable", "unsupported"):
            incomplete.append("pulse_connectivity")
        if result.get("next") != "start_listener_and_schedule":
            incomplete.append(result.get("next", "workspace"))
        if incomplete:
            result["incomplete"] = incomplete
    if "error" in result or result.get("incomplete"):
        result["recovery"] = {
            "report_to_codex":"提供命令、失败字段和错误信息。不要复制密码、Token 或 OAuth 文件。",
            "retry":"修复指明的问题后重跑原命令。已准备的批次沿用原 work_dir，保留游标和回执。",
        }
    if args.action == "cycle" and "error" not in result and result.get("status") != "already_running":
        try:
            write_state(PENDING / "last-cycle.json", result)
        except OSError as exc:
            result.setdefault("incomplete", []).append("cycle_receipt")
            result["cycle_receipt_error"] = str(exc)
    print(json.dumps(result, ensure_ascii=True))
    return 1 if "error" in result else 2 if result.get("incomplete") else 0


if __name__ == "__main__":
    sys.exit(main())
