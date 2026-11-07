#!/usr/bin/env bash
# Runs the UI tests against a headless GNOME Shell. Needs GNOME Shell 46 or
# later, Python 3 with PyGObject, and the tools scripts/headless.sh uses.
# Fails as well when Ledge logged a JS error, even if every test passed: an
# effect that fails to build leaves the panel working but wrong.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
status=0
python3 -m unittest -v "$@" || status=$?
log="${XDG_RUNTIME_DIR:-/tmp}/ledge-nested/shell.log"
errors="$(grep -A15 'JS ERROR' "$log" | grep -B15 'extensions/ledge@' || true)"
if [ -n "$errors" ]; then
  printf 'Ledge logged JS errors:\n%s\n' "$errors" >&2
  status=1
fi
exit $status
