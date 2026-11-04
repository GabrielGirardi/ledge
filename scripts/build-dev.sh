#!/usr/bin/env bash
# Compiles schemas and translations in place, so the source tree under
# extension/ can be loaded by GNOME Shell directly.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
src="$here/extension/ledge@gabrielgirardi.github.io"
glib-compile-schemas "$src/schemas"
for po in "$here"/po/*.po; do
  lang="$(basename "$po" .po)"
  mkdir -p "$src/locale/$lang/LC_MESSAGES"
  msgfmt -o "$src/locale/$lang/LC_MESSAGES/ledge.mo" "$po"
done
