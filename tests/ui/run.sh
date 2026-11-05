#!/usr/bin/env bash
# Runs the UI tests against a headless GNOME Shell. Needs GNOME Shell 46,
# Python 3 with PyGObject, and the tools scripts/headless.sh uses.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
exec python3 -m unittest -v "$@"
