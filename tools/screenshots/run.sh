#!/usr/bin/env bash
# Regenerates docs/images/ from fictional data in an isolated GNOME profile:
# generated wallpaper and album art, a local calendar, a demo MPRIS player.
# Opens a nested GNOME Shell window for about a minute. Batteries and weather
# are live, since they come from UPower and Open-Meteo.
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
tools="$here/tools/screenshots"
uuid="ledge@gabrielgirardi.github.io"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

export XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data"
export XDG_CACHE_HOME="$work/cache" XDG_STATE_HOME="$work/state"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"

python3 -I "$tools/make_assets.py" "$work/assets" >/dev/null
mkdir -p "$XDG_DATA_HOME/evolution/calendar/system"
cp "$work/assets/calendar.ics" "$XDG_DATA_HOME/evolution/calendar/system/calendar.ics"

zip="$("$here/scripts/pack.sh")"
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions/$uuid"
unzip -q "$zip" -d "$XDG_DATA_HOME/gnome-shell/extensions/$uuid"

dbus-run-session -- python3 -I "$tools/capture.py" "$work" "$here/docs/images" \
  "$XDG_DATA_HOME/gnome-shell/extensions/$uuid/schemas"
