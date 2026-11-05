#!/usr/bin/env bash
# Sends a development hook to the shell started by headless.sh or nested.sh.
#
#   dev-signal.sh Toggle                 open or close, like the shortcut
#   dev-signal.sh Show 0.5               pin the panel at a progress (0..1)
#   dev-signal.sh Click X Y              left click at stage coordinates
#   dev-signal.sh Warp X Y               move the pointer (picks the active monitor)
#   dev-signal.sh Pick X Y               log which actor is under a point
#   dev-signal.sh Scroll X Y STEPS       wheel steps (negative scrolls up)
#   dev-signal.sh Key KEYVAL             press a key (65307 is Escape)
#   dev-signal.sh Type 'text\n'          type text; \n presses Return
#   dev-signal.sh Shot /abs/path.png     screenshot of the whole stage
#   dev-signal.sh State | Dump           log panel state / layer allocations
#
# Results of State and Dump go to the shell log (headless.sh prints its path).
set -euo pipefail
state="${XDG_RUNTIME_DIR:-/tmp}/ledge-nested"
export DBUS_SESSION_BUS_ADDRESS="$(cat "$state/bus")"
emit() {
  gdbus emit --session --object-path /io/github/gabrielgirardi/Ledge/Touchpad \
    --signal "io.github.gabrielgirardi.Ledge.Dev1.$1" "${@:2}" >/dev/null
}
case "${1:?signal name required}" in
  Toggle|State|Dump) emit "$1" ;;
  Warp) emit Warp "$2" "$3" ;;
  Pick) emit Pick "$2" "$3" ;;
  Show) emit Show "$2" ;;
  Click) emit Click "$2" "$3" ;;
  Scroll) emit Scroll "$2" "$3" "int32 $4" ;;
  Key) emit Key "uint32 $2" ;;
  Type) emit Type "'$2'" ;;  # GVariant text turns \n into a newline
  Shot) emit Shot "'$2'" ;;
  *) echo "unknown signal: $1" >&2; exit 2 ;;
esac
