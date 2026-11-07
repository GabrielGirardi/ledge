# Changelog

All notable changes to Ledge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Support for GNOME Shell 47, 48, and 49 (#8, #9).

### Fixed

- GNOME 48 and later: the panel's rounded corners failed to draw, because
  GNOME moved the shader hooks Ledge uses.

### Development

- CI runs the UI tests on GNOME 46, 47, 48, and 49. `scripts/test-gnome.sh`
  runs them locally on 47 to 49, in a container (#10).
- The UI tests fail when Ledge logs a JS error, and open the preferences.
- `scripts/nested.sh` uses GNOME 49's `mutter-devkit`.

## [0.4.1] - 2026-11-06

### Added

- Updates from the settings: **Check for updates** installs a new version
  from GitHub, together with the touchpad helper, once it supports your GNOME
  Shell version. **Automatic updates** (off by default) does it once a day in
  the background. Either way, the new version starts at the next login.

- Screen Time: switch between today, the last 7 days, and the last 30 days.
  The longer ranges show the total, a daily average, one bar per day, and the
  most used apps over the range.

## [0.4.0] - 2026-11-05

### Added

- Hot edge: push the pointer against the screen edge to open the panel. Edges
  between two monitors are left free. It never fires in fullscreen apps or
  while a mouse button is held, and it can be turned off (#3).
- Choose, order, and hide widgets in the preferences. A hidden widget is not
  loaded at all (#5).
- Edit mode, from the pencil in the panel. Drag a card to reorder, or press
  <kbd>↑</kbd>/<kbd>↓</kbd> on a focused card; <kbd>−</kbd> to hide, and an
  "Add widgets" tray to bring hidden ones back. <kbd>Esc</kbd> leaves edit
  mode before it closes the panel (#6).
- Weather location: search for a city by name in the preferences, with the
  state and country of each match. Automatic location now uses where the
  device is when Location Services are on, before falling back to the time
  zone's city.
- UI regression tests (`tests/ui`) that drive a headless GNOME Shell, run in
  CI on every push and pull request.

### Fixed

- The weather showed the city named by the time zone, which can be far away:
  `America/Sao_Paulo` covers most of Brazil's South and Southeast.
- Edit mode tilted the cards, which rendered their text slanted, as if
  italic, and its minus buttons made every card taller.
- On systems with the `C` or `C.UTF-8` locale (minimal installs, containers),
  Ledge failed to enable at all: "C" is not a language tag. Found by the new
  CI tests.
- Edit mode: a fast drag left the card short of the pointer, because each
  motion event moved it one slot at most. Found by the CI tests.
- Edit mode: a hidden card (Now Playing with nothing playing) could swallow a
  move, so dragging or pressing an arrow seemed to do nothing.
- The hot edge also works in the overview, which stock GNOME shows at login.
- To-do: on a screen shorter than the panel, the list was squeezed to a row or
  two instead of the panel scrolling.

## [0.3.1] - 2026-11-05

### Fixed

- The weather showed the city named by the time zone, which can be far away:
  `America/Sao_Paulo` covers most of Brazil's South and Southeast.
- Edit mode tilted the cards, which rendered their text slanted, as if
  italic, and its minus buttons made every card taller.

- To-do: checking off a task moved it to the end of the list, so the task
  under the pointer changed and the next click toggled a different one.
  Finished tasks now stay where they are, and rows update in place.

### Changed

- To-do redesign: round checkboxes that fill in when done, struck-through
  finished tasks, a trash button on hover, an add field with a plus icon, and
  an "N of M done" summary. The list shows about five tasks and scrolls for
  the rest; adding a task scrolls to it.

## [0.3.0] - 2026-11-05

### Added

- A settings button in the panel's top corner opens the preferences.
- The panel opens on the active monitor: the one under the pointer for the
  gesture and the panel button, and the one with the focused window for the
  keyboard shortcut.

### Changed

- The "Top bar button" setting is now "Panel button", because bars such as
  Zorin Taskbar put it at the bottom.

### Fixed

- The weather showed the city named by the time zone, which can be far away:
  `America/Sao_Paulo` covers most of Brazil's South and Southeast.
- Edit mode tilted the cards, which rendered their text slanted, as if
  italic, and its minus buttons made every card taller.

- Buttons near the panel's right edge ignored clicks, including the settings
  button, a task's delete button, and the "next track" button. A scrolled box
  in GNOME 46 clips picking to a page narrower than the view.
- The calendar showed an invitation twice when it was in two calendars.
- With a game controller connected (for example a DualSense), the touchpad
  helper could read the controller's touchpad instead of the laptop's, so the
  gesture stopped working. Controller touchpads are now skipped, and built-in
  touchpads win over USB and Bluetooth ones.
- The touchpad helper waits for the touchpad to come back after suspend,
  instead of exiting and running into systemd's restart limit (#1).
- Connecting or disconnecting a monitor while the panel is open no longer
  leaves it off-screen (#4).

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

- The weather showed the city named by the time zone, which can be far away:
  `America/Sao_Paulo` covers most of Brazil's South and Southeast.
- Edit mode tilted the cards, which rendered their text slanted, as if
  italic, and its minus buttons made every card taller.

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

[Unreleased]: https://github.com/GabrielGirardi/ledge/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/GabrielGirardi/ledge/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/GabrielGirardi/ledge/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/GabrielGirardi/ledge/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/GabrielGirardi/ledge/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/GabrielGirardi/ledge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/GabrielGirardi/ledge/releases/tag/v0.1.0
