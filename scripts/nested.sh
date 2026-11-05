#!/usr/bin/env bash
# Runs a nested GNOME Shell window with Ledge (from this checkout) and the
# touchpad helper on a private session bus, so you can iterate without
# logging out. An installed copy of Ledge in your session is left untouched:
# the nested shell gets private data and config folders. Its only user
# extension is a link to the source tree, and settings changed in it (edit
# mode, preferences) never reach your real ones.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
uuid="ledge@gabrielgirardi.github.io"
"$here/scripts/build-dev.sh"

data="${XDG_RUNTIME_DIR:-/tmp}/ledge-nested/data"
config="${XDG_RUNTIME_DIR:-/tmp}/ledge-nested/config"
mkdir -p "$data/gnome-shell/extensions" "$config"
ln -sfn "$here/extension/$uuid" "$data/gnome-shell/extensions/$uuid"

export XDG_DATA_HOME="$data" XDG_CONFIG_HOME="$config" XDG_DATA_DIRS="${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
export LEDGE_DEV=1
export MUTTER_DEBUG_DUMMY_MODE_SPECS="${LEDGE_NESTED_SIZE:-1600x1000}"
mkdir -p "${XDG_RUNTIME_DIR:-/tmp}/ledge-nested"
exec dbus-run-session -- bash -c '
  echo "$DBUS_SESSION_BUS_ADDRESS" > "${XDG_RUNTIME_DIR:-/tmp}/ledge-nested/bus"
  python3 "'"$here"'/touchd/ledge-touchd.py" -v &
  gnome-shell --nested --wayland &
  shell=$!
  sleep 4
  gnome-extensions enable '"$uuid"' || true
  wait $shell
'
