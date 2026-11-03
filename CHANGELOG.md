# Changelog

All notable changes to Ledge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/GabrielGirardi/ledge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/GabrielGirardi/ledge/releases/tag/v0.1.0
