#!/usr/bin/env bash
# Starts a headless GNOME Shell (no window) with Ledge from this checkout and
# development hooks enabled. Unlike nested.sh, the pointer is fully
# controllable, so scripted clicks land where you aim them. Prints READY and
# returns once Ledge is ACTIVE; stop it with: scripts/headless.sh --stop
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
uuid="ledge@gabrielgirardi.github.io"
state="${XDG_RUNTIME_DIR:-/tmp}/ledge-nested"

stop() {
  for p in $(pgrep -x gnome-shell || true); do
    tr '\0' ' ' < "/proc/$p/cmdline" | grep -q -- '--headless' && kill "$p"
  done
  return 0
}
[ "${1:-}" = "--stop" ] && { stop; exit 0; }
stop; sleep 1

"$here/scripts/build-dev.sh"
mkdir -p "$state/data/gnome-shell/extensions"
ln -sfn "$here/extension/$uuid" "$state/data/gnome-shell/extensions/$uuid"

(XDG_DATA_HOME="$state/data" LEDGE_DEV=1 setsid dbus-run-session -- \
  gnome-shell --headless --wayland --virtual-monitor "${LEDGE_NESTED_SIZE:-1600x1000}" \
  > "$state/shell.log" 2>&1 &)

for _ in $(seq 60); do
  sleep 1
  pid=""
  for p in $(pgrep -x gnome-shell || true); do
    tr '\0' ' ' < "/proc/$p/cmdline" | grep -q -- '--headless' && pid="$p"
  done
  [ -n "$pid" ] || continue
  tr '\0' '\n' < "/proc/$pid/environ" | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p' > "$state/bus"
  export DBUS_SESSION_BUS_ADDRESS="$(cat "$state/bus")"
  gnome-extensions enable "$uuid" 2>/dev/null || true
  if gnome-extensions info "$uuid" 2>/dev/null | grep -q 'State: ACTIVE'; then
    sleep 2
    echo "READY (log: $state/shell.log)"
    grep 'JS ERROR' "$state/shell.log" || true
    exit 0
  fi
done
echo "Ledge did not become ACTIVE; see $state/shell.log" >&2
exit 1
