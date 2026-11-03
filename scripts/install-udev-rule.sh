#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
sudo install -m 0644 "$here/packaging/70-ledge-touchpad.rules" /etc/udev/rules.d/70-ledge-touchpad.rules
sudo udevadm control --reload
sudo udevadm trigger --subsystem-match=input --action=change
echo "ok: touchpad readable by the active session user"
