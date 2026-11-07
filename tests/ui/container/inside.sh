#!/usr/bin/env bash
# The container side of scripts/test-gnome.sh. Starts as root to give GNOME
# Shell the system bus it expects (it asks logind about the session), then
# runs the tests as an ordinary user on a copy of the checkout: compiling
# schemas and translations must not write into the mounted source.
set -euo pipefail
if [ "$(id -u)" = 0 ]; then
  mkdir -p /run/dbus && dbus-daemon --system --fork
  exec runuser -u tester -- "$0" "$@"
fi
cp -r /checkout /tmp/ledge && cd /tmp/ledge
export XDG_RUNTIME_DIR=/tmp/xdg && mkdir -p -m 0700 "$XDG_RUNTIME_DIR"
gnome-shell --version
exec ./tests/ui/run.sh "$@"
