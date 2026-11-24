import argparse
import hashlib
import json
import os
import re
import stat
import zipfile
from pathlib import Path


def add_bytes(archive: zipfile.ZipFile, name: str, data: bytes, executable: bool = False) -> None:
    info = zipfile.ZipInfo(name)
    info.compress_type = zipfile.ZIP_DEFLATED
    mode = 0o755 if executable else 0o644
    info.external_attr = (stat.S_IFREG | mode) << 16
    archive.writestr(info, data)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the combined Ember/Project Pulse LAN client ZIP.")
    parser.add_argument("--project-pulse", required=True, type=Path)
    parser.add_argument("--ember", required=True, type=Path)
    parser.add_argument("--ca", required=True, type=Path)
    parser.add_argument("--onboarding", required=True, type=Path)
    parser.add_argument("--reporting-prompt", type=Path)
    parser.add_argument("--connectivity-prompt", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--workspace-id-file", type=Path)
    parser.add_argument("--client-release")
    parser.add_argument("--platform", choices=("universal","windows","macos","linux"), default="universal")
    args = parser.parse_args()

    project = args.project_pulse.resolve()
    ember_scripts = (args.ember / "apps/worker/scripts/demo-cn").resolve()
    files = {
        "README.md": project / "ops/report/README.md",
        "project-selection.md": project / "ops/report/project-selection.md",
        "PROMPT.txt": project / "ops/report/PROMPT.txt",
        "VERSION": project / "ops/report/VERSION",
        "UPGRADE.md": project / "ops/report/UPGRADE.md",
        "pulse-report.pl": project / "ops/report/pulse-report.pl",
        "pulse-report.ps1": project / "ops/report/pulse-report.ps1",
        "pulse-report-linux.sh": project / "ops/report/pulse-report-linux.sh",
        "project-paths.example.json": project / "ops/report/project-paths.example.json",
        "lan-report.md": project / "docs/lan-report.md",
        "team-edits.md": project / "docs/team-edits.md",
        "pulse-onboard.py": ember_scripts / "pulse-onboard.py",
        "ember-connect.py": ember_scripts / "ember-connect.py",
        "ember-member-listener.py": ember_scripts / "ember-member-listener.py",
        "Ember-LAN-CA.pem": args.ca,
        "接入提示词.txt": args.onboarding,
    }
    if args.reporting_prompt:
        files["PULSE-PROMPT.txt"] = files["PROMPT.txt"]
        files["PROMPT.txt"] = args.reporting_prompt
    if args.connectivity_prompt:
        files["空数据验连提示词.txt"] = args.connectivity_prompt
    if args.platform == "windows":
        del files["pulse-report.pl"], files["pulse-report-linux.sh"]
        files["ember-setup.cmd"] = ember_scripts / "ember-setup.cmd"
    elif args.platform in ("macos", "linux"):
        del files["pulse-report.ps1"]
        if args.platform == "macos":
            del files["pulse-report-linux.sh"]
        files["ember-setup.sh"] = ember_scripts / "ember-setup.sh"
    else:
        files["ember-setup.cmd"] = ember_scripts / "ember-setup.cmd"
        files["ember-setup.sh"] = ember_scripts / "ember-setup.sh"
    missing = [str(path) for path in files.values() if not path.is_file()]
    if missing:
        raise SystemExit("Missing package files:\n" + "\n".join(missing))

    root = "project-pulse-report"
    checksums = []
    manifest = None
    if args.workspace_id_file or args.client_release:
        if not args.workspace_id_file or not args.client_release:
            parser.error("--workspace-id-file and --client-release must be supplied together")
        workspace_id = args.workspace_id_file.read_text(encoding="ascii").strip()
        if not re.fullmatch(r"[a-f0-9]{32}", workspace_id) or not re.fullmatch(r"r\d+", args.client_release):
            parser.error("Invalid workspace identity or client release")
        manifest = json.dumps({"workspace_id": workspace_id, "client_release": args.client_release,
                               "platform": args.platform}).encode("utf-8")
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative, source in files.items():
            executable = relative.endswith((".py", ".pl", ".sh"))
            data = source.read_bytes()
            if relative.endswith((".pl", ".sh")):
                data = data.replace(b"\r\n", b"\n")
            add_bytes(archive, f"{root}/{relative}", data, executable)
            checksums.append(f"{hashlib.sha256(data).hexdigest()}  {relative}\n")
        if manifest:
            add_bytes(archive, f"{root}/ember-workspace.json", manifest)
            checksums.append(f"{hashlib.sha256(manifest).hexdigest()}  ember-workspace.json\n")
        add_bytes(archive, f"{root}/SHA256SUMS", "".join(checksums).encode("utf-8"), False)
    os.replace(temporary, output)
    print(f"OUTPUT={output}")
    print(f"SHA256={hashlib.sha256(output.read_bytes()).hexdigest().upper()}")
    print(f"SIZE={output.stat().st_size}")


if __name__ == "__main__":
    main()
