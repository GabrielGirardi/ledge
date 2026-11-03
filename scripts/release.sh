#!/usr/bin/env bash
# Usage: scripts/release.sh X.Y.Z
# Bumps metadata.json, dates the CHANGELOG's Unreleased section, commits and
# tags vX.Y.Z locally. Pushing the tag is a separate, deliberate step.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
version="${1:?usage: scripts/release.sh X.Y.Z}"
meta="$here/extension/ledge@gabrielgirardi.github.io/metadata.json"
changelog="$here/CHANGELOG.md"

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "not SemVer: $version"; exit 1; }
[ -z "$(git -C "$here" status --porcelain)" ] || { echo "working tree is not clean"; exit 1; }
[ "$(git -C "$here" branch --show-current)" = "main" ] || { echo "release from main"; exit 1; }
git -C "$here" rev-parse "v$version" >/dev/null 2>&1 && { echo "v$version already exists"; exit 1; }
grep -q '^## \[Unreleased\]' "$changelog" || { echo "CHANGELOG.md has no [Unreleased] section"; exit 1; }

python3 - "$meta" "$changelog" "$version" <<'PY'
import datetime, json, re, sys
meta, changelog, version = sys.argv[1:]
text = open(changelog).read()
body = text.split("## [Unreleased]", 1)[1].split("\n## [", 1)[0].strip()
if not body:
    sys.exit("CHANGELOG.md: [Unreleased] is empty; describe the release first")

m = json.load(open(meta))
m["version-name"] = version
with open(meta, "w") as f:
    json.dump(m, f, indent=2, ensure_ascii=False)
    f.write("\n")
today = datetime.date.today().isoformat()
text = text.replace("## [Unreleased]", f"## [Unreleased]\n\n## [{version}] - {today}", 1)
repo = "https://github.com/GabrielGirardi/ledge"
prev = re.search(r"^## \[(\d+\.\d+\.\d+[^\]]*)\]", text.split(f"## [{version}]", 1)[1], re.M)
link = f"{repo}/compare/v{prev.group(1)}...v{version}" if prev else f"{repo}/releases/tag/v{version}"
text = re.sub(r"^\[Unreleased\]: .*$", f"[Unreleased]: {repo}/compare/v{version}...HEAD\n[{version}]: {link}", text, count=1, flags=re.M)
open(changelog, "w").write(text)
PY

"$here/scripts/check.sh" >/dev/null
git -C "$here" commit -qam "chore(release): v$version"
git -C "$here" tag -a "v$version" -m "Ledge $version"
echo "tagged v$version. Publish with: git push origin main --follow-tags"
