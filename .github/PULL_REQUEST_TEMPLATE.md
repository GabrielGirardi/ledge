## What and why

<!-- What does this change, and which problem does it solve? Link the issue: Closes #123 -->

## How it was tested

<!-- GNOME version, Wayland or X11, and what you did. For visual changes, attach a screenshot or recording. -->

## Checklist

- [ ] The title follows Conventional Commits (`feat: ...`, `fix(gesture): ...`)
- [ ] `./scripts/check.sh` passes
- [ ] Tested in `./scripts/nested.sh` or in a real session
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]` (skip for changes users do not see)
- [ ] User-visible strings use `_()`, and `./scripts/update-po.sh` was run
- [ ] `destroy()` and `disable()` undo everything the change sets up
