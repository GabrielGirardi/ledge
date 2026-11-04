#!/usr/bin/env bash
# Links the source tree into your real session's extensions folder, for
# developers who want to run unreleased code day to day. Refuses to replace
# a copy installed by scripts/install.sh; run scripts/uninstall.sh first.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
uuid="ledge@gabrielgirardi.github.io"
dest="$HOME/.local/share/gnome-shell/extensions/$uuid"
if [ -e "$dest" ] && [ ! -L "$dest" ]; then
  echo "$dest is an installed copy; run scripts/uninstall.sh first" >&2
  exit 1
fi
"$here/scripts/build-dev.sh"
mkdir -p "$(dirname "$dest")"
ln -sfn "$here/extension/$uuid" "$dest"
echo "linked $dest -> $here/extension/$uuid"
