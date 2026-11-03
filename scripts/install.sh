#!/usr/bin/env bash
# Installs Ledge for the current user from this checkout:
#   - the GNOME Shell extension (packed and installed with gnome-extensions)
#   - the touchpad helper as a systemd user service
#   - the udev rule that lets the helper read the touchpad (asks for sudo once)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
uuid="ledge@gabrielgirardi.github.io"

zip="$("$here/scripts/pack.sh")"
gnome-extensions install --force "$zip"
echo "installed extension $uuid"

install -Dm755 "$here/touchd/ledge-touchd.py" "$HOME/.local/lib/ledge/ledge-touchd.py"
install -Dm644 "$here/packaging/ledge-touchd.service" "$HOME/.config/systemd/user/ledge-touchd.service"
systemctl --user daemon-reload

if [ ! -f /etc/udev/rules.d/70-ledge-touchpad.rules ]; then
  "$here/scripts/install-udev-rule.sh"
fi
systemctl --user enable --now ledge-touchd.service
echo "touchpad helper running: systemctl --user status ledge-touchd"

if gnome-extensions enable "$uuid" 2>/dev/null; then
  echo "extension enabled"
else
  # GNOME Shell on Wayland only discovers new extensions at login.
  python3 - "$uuid" <<'PY'
import ast, subprocess, sys
key = ["org.gnome.shell", "enabled-extensions"]
current = ast.literal_eval(subprocess.check_output(["gsettings", "get", *key], text=True).replace("@as ", ""))
if sys.argv[1] not in current:
    subprocess.check_call(["gsettings", "set", *key, str(current + [sys.argv[1]])])
PY
  echo "log out and back in to load the extension"
fi
