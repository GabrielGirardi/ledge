#!/usr/bin/env bash
# Builds dist/ledge@gabrielgirardi.github.io.shell-extension.zip with compiled
# schemas and translations. Prints the zip path.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
uuid="ledge@gabrielgirardi.github.io"
src="$here/extension/$uuid"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cp -r "$src"/*.js "$src"/{metadata.json,stylesheet.css,widgets,schemas} "$stage/"
# The touchpad helper rides along, so an in-place update can refresh it too.
install -Dm644 "$here/touchd/ledge-touchd.py" "$stage/touchd/ledge-touchd.py"
rm -f "$stage/schemas/gschemas.compiled"
glib-compile-schemas "$stage/schemas"
for po in "$here"/po/*.po; do
  lang="$(basename "$po" .po)"
  mkdir -p "$stage/locale/$lang/LC_MESSAGES"
  msgfmt -o "$stage/locale/$lang/LC_MESSAGES/ledge.mo" "$po"
done

mkdir -p "$here/dist"
out="$here/dist/$uuid.shell-extension.zip"
rm -f "$out"
(cd "$stage" && zip -qr "$out" .)
echo "$out"
