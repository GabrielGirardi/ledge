#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
uuid="ledge@gabrielgirardi.github.io"
src="$here/extension/$uuid"
dest="$HOME/.local/share/gnome-shell/extensions/$uuid"
glib-compile-schemas "$src/schemas"
for po in "$here"/po/*.po; do
  lang="$(basename "$po" .po)"
  mkdir -p "$src/locale/$lang/LC_MESSAGES"
  msgfmt -o "$src/locale/$lang/LC_MESSAGES/ledge.mo" "$po"
done
mkdir -p "$(dirname "$dest")"
ln -sfn "$src" "$dest"
echo "linked $dest -> $src"
