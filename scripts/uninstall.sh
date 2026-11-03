#!/usr/bin/env bash
# Removes what scripts/install.sh installed. Pass --udev to also remove the udev rule.
set -euo pipefail
uuid="ledge@gabrielgirardi.github.io"
systemctl --user disable --now ledge-touchd.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/ledge-touchd.service"
rm -rf "$HOME/.local/lib/ledge"
systemctl --user daemon-reload
gnome-extensions uninstall "$uuid" 2>/dev/null || rm -rf "$HOME/.local/share/gnome-shell/extensions/$uuid"
if [ "${1:-}" = "--udev" ]; then
  sudo rm -f /etc/udev/rules.d/70-ledge-touchpad.rules
  sudo udevadm control --reload
  sudo udevadm trigger --subsystem-match=input --action=change
fi
echo "Ledge removed"
