# Releasing

Only the maintainer cuts releases. Every release is a SemVer tag `vX.Y.Z` on
`main`.

## Steps

1. Check that `main` is green in CI and that your checkout is up to date:

   ```sh
   git switch main && git pull
   ```

2. Read `## [Unreleased]` in `CHANGELOG.md`. Make sure every user-visible
   change is listed under `Added`, `Changed`, `Fixed`, or `Removed`.

3. Pick the version from the SemVer table in CONTRIBUTING.md, then run:

   ```sh
   ./scripts/release.sh 0.2.0
   ```

   The script refuses to run on a dirty tree, off `main`, with an empty
   `Unreleased` section, or with a version that already exists. It sets
   `version-name` in `metadata.json`, moves `Unreleased` into a dated section,
   updates the compare links, runs `check.sh`, commits
   `chore(release): v0.2.0`, and creates the annotated tag `v0.2.0`. It pushes
   nothing.

4. Review the commit (`git show`), then publish:

   ```sh
   git push origin main --follow-tags
   ```

5. The **Release** workflow runs on the tag. It checks that the tag matches
   `metadata.json`, builds
   `ledge@gabrielgirardi.github.io.shell-extension.zip`, and creates a GitHub
   release with the zip and `metadata.json`. The in-app updater reads that
   `metadata.json` to check GNOME compatibility before it downloads the zip,
   and ignores releases without it. Do not rename either file. The release notes come from that version's CHANGELOG section.
   Versions below `1.0.0`, and versions with a pre-release suffix such as
   `0.2.0-rc.1`, are marked as pre-releases.

## If something goes wrong

- **The tag is wrong and not pushed yet:** run `git tag -d vX.Y.Z` and
  `git reset --hard HEAD~1`, then start again.
- **The tag is already pushed:** do not move or delete it. Fix the problem and
  release the next patch version.

## extensions.gnome.org

Ledge is not on extensions.gnome.org yet. Once it is, upload the zip from the
GitHub release, and record the EGO version number in the release notes.
EGO does not allow extensions that update themselves, and installs them to
the same folder as a zip install: the EGO upload needs a build without the
updater.
EGO's own integer `version` is separate from `version-name`.
