# Changelog

All notable changes to Ledge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-03

### Added

- To-do widget: add, check off, delete, and clear tasks. Stored locally in
  `~/.local/share/ledge/todo.json`.
- Screen Time widget: today's total and top apps by focused time, not counting
  idle or locked time. Stored locally in `~/.local/share/ledge/usage.json`,
  with 30 days of history.
- The panel scrolls when its content is taller than the screen.
- `scripts/headless.sh` and `scripts/dev-signal.sh`: a scriptable headless
  shell with real pointer and keyboard hooks, for reproducing input bugs.
- README screenshots and a gesture animation, generated from fictional data by
  `tools/screenshots/run.sh`.

### Fixed

- Clicking outside the panel or pressing <kbd>Esc</kbd> did not close it. The
  listener was on the stage, which receives nothing while the panel holds its
  input grab.
- The panel no longer covers bars that hide automatically, such as Zorin
  Taskbar with intellihide.
- The keyboard shortcut row in the preferences showed an empty title, because
  `<Super>` in the title was parsed as markup.
- Translation templates no longer contain absolute paths.

## [0.1.0] - 2026-11-03

First preview.

### Added

- Today View sidebar for GNOME Shell 46 that follows a two-finger swipe from
  the touchpad edge, with spring physics and fling detection.
- `ledge-touchd`, a touchpad helper that reads raw multitouch coordinates
  (read-only) and publishes edge swipes on the session bus, with a systemd
  user service and a touchpad-only udev rule.
- Keyboard shortcut (<kbd>Super</kbd>+<kbd>T</kbd>) and a top bar button to toggle the panel.
- Widgets: weather (Open-Meteo), device batteries (UPower), calendar (GNOME
  Online Accounts), and Now Playing (MPRIS).
- Frosted-glass look from a blurred copy of the wallpaper, with rounded
  corners and a card cascade.
- Preferences for the screen side, top bar button, shortcut, and weather city.
- English and Brazilian Portuguese translations. Dates follow `LC_TIME`.

[Unreleased]: https://github.com/GabrielGirardi/ledge/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/GabrielGirardi/ledge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/GabrielGirardi/ledge/releases/tag/v0.1.0
