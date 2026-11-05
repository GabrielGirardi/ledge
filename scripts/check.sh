#!/usr/bin/env bash
# Static checks. CI runs exactly this script; run it before every push.
set -uo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
ext="$here/extension/ledge@gabrielgirardi.github.io"
failed=0
step() { printf '\n== %s\n' "$1"; }
fail() { echo "FAIL: $*"; failed=1; }

step "JavaScript syntax"
while IFS= read -r f; do node --check "$f" || fail "$f"; done < <(find "$ext" -name '*.js')

step "Python syntax"
for f in "$here/touchd/ledge-touchd.py" "$here"/tools/screenshots/*.py "$here"/tests/ui/*.py; do
  python3 -m py_compile "$f" || fail "$f"
done
find "$here/touchd" "$here/tools" "$here/tests" -name __pycache__ -type d -exec rm -rf {} +

step "Shell scripts"
for f in "$here"/scripts/*.sh "$here"/tools/screenshots/*.sh; do bash -n "$f" || fail "$f"; done

step "GSettings schema"
glib-compile-schemas --strict --dry-run "$ext/schemas" || fail "schema"

step "metadata.json"
python3 - "$ext/metadata.json" <<'PY' || fail "metadata.json"
import json, re, sys
m = json.load(open(sys.argv[1]))
assert m["uuid"] == "ledge@gabrielgirardi.github.io", "uuid changed"
assert re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?", m["version-name"]), "version-name is not SemVer"
assert m["shell-version"], "shell-version is empty"
print("version", m["version-name"], "shells", ", ".join(m["shell-version"]))
PY

step "Translations"
tmp="$(mktemp)"
(cd "$here" && xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ --keyword=N_ --add-comments=Translators \
  --package-name=ledge -o "$tmp" $(find extension -name '*.js' | sort))
msgids() { msgcat --no-location --sort-output "$1" | grep -E '^msgid ' ; }
if ! diff <(msgids "$tmp") <(msgids "$here/po/ledge.pot") >/dev/null; then
  fail "po/ledge.pot is stale; run: scripts/update-po.sh"
fi
rm -f "$tmp"
for po in "$here"/po/*.po; do
  msgfmt --check -o /dev/null "$po" || fail "$po"
  untranslated="$(msgattrib --untranslated --no-obsolete "$po" | grep -c '^msgid "[^"]' || true)"
  [ "$untranslated" -eq 0 ] || echo "note: $(basename "$po") has $untranslated untranslated strings"
done

if [ "$failed" -ne 0 ]; then echo; echo "checks failed"; exit 1; fi
echo; echo "all checks passed"
