#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v python3 >/dev/null 2>&1; then
    printf '%s\n' 'Python 3 is required. Install it or ask Codex to fix the prerequisite, then rerun.' >&2
    exit 2
fi
if [ "$#" -eq 0 ]; then set -- preflight; fi
exec python3 -B "$here/pulse-onboard.py" "$@"
