#!/usr/bin/env bash
# Regenerates po/ledge.pot from the sources and merges it into every po/*.po.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
ext="$here/extension/ledge@gabrielgirardi.github.io"
cd "$here"
xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ --keyword=N_ --add-comments=Translators \
  --package-name=ledge -o "$here/po/ledge.pot" $(cd "$here" && find extension -name '*.js' | sort)
for po in "$here"/po/*.po; do
  msgmerge --quiet --no-fuzzy-matching --update --backup=none "$po" "$here/po/ledge.pot"
done
echo "updated po/ledge.pot and $(ls "$here"/po/*.po | wc -l) translation(s)"
