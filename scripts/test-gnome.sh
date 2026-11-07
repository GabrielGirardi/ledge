#!/usr/bin/env bash
# Runs the UI tests against another GNOME Shell release, in a Fedora
# container: ./scripts/test-gnome.sh 48 [unittest args]. Needs docker or
# podman. The checkout is mounted read-only; the shell writes only inside the
# container.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
gnome="${1:?usage: $0 GNOME_VERSION [unittest args]}"; shift
case "$gnome" in
  47) fedora=41 ;; 48) fedora=42 ;; 49) fedora=43 ;; 50) fedora=44 ;;
  *) echo "no Fedora image known for GNOME $gnome" >&2; exit 2 ;;
esac
engine="$(command -v podman || command -v docker)"
image="ledge-test:gnome$gnome"
"$engine" build -q -t "$image" --build-arg FEDORA="$fedora" \
  -f "$here/tests/ui/container/Containerfile" "$here/tests/ui/container" >/dev/null

exec "$engine" run --rm --init -v "$here:/checkout:ro" "$image" \
  /checkout/tests/ui/container/inside.sh "$@"
