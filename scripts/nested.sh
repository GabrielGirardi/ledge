#!/usr/bin/env bash
# Runs a nested GNOME Shell window with Ledge and the touchpad helper on a
# private session bus, so you can iterate without logging out.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
"$here/scripts/link-extension.sh"
export LEDGE_DEV=1
export MUTTER_DEBUG_DUMMY_MODE_SPECS="${LEDGE_NESTED_SIZE:-1600x1000}"
exec dbus-run-session -- bash -c '
  python3 "'"$here"'/touchd/ledge-touchd.py" -v &
  gnome-shell --nested --wayland &
  shell=$!
  sleep 4
  gnome-extensions enable ledge@gabrielgirardi.github.io || true
  wait $shell
'
