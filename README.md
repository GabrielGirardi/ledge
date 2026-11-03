# Ledge

**A Today View for GNOME.** Swipe two fingers in from the edge of your touchpad
and a frosted-glass sidebar follows your fingers. It shows the weather, the
battery of every device you own, your next events, and what is playing.

Ledge is inspired by the widget sidebar on macOS and iOS, built natively for
GNOME Shell.

> **Status: early preview (0.x).** It works daily on the maintainer's machine,
> but expect rough edges, and expect settings to change between minor versions.

## Features

- **Gesture that tracks your fingers.** The panel moves 1:1 with a two-finger
  swipe from the touchpad edge. A spring finishes the motion when you lift:
  past halfway or a quick flick opens the panel, anything else closes it.
- **Other ways in.** Press <kbd>Super</kbd>+<kbd>T</kbd> or click the top bar button. Press
  <kbd>Esc</kbd>, click outside the panel, or swipe back to close it.
- **Widgets**
  - **Weather:** current conditions with the daily high and low, from
    [Open-Meteo](https://open-meteo.com). No account or API key needed.
  - **Batteries:** rings for the laptop, Bluetooth headsets, mice, and
    keyboards, from UPower.
  - **Calendar:** today's remaining events, or the next one tomorrow, from
    your GNOME Online Accounts.
  - **Now Playing:** cover art, title, artist, and playback controls for any
    MPRIS player.
- **Glass look:** a blurred copy of your wallpaper with rounded corners, and
  cards that cascade in.
- **Left or right edge:** set in the preferences.
- **Languages:** English, Brazilian Portuguese.

## Requirements

| | |
|---|---|
| GNOME Shell | 46 (other versions are on the roadmap) |
| Session | Wayland or X11 |
| Touchpad | Any multitouch touchpad. The gesture is optional; the shortcut and button work without one. |
| Python | 3.10 or later, with PyGObject (`python3-gi`), which most GNOME systems already ship |

## Install

Ledge is not on extensions.gnome.org yet. Install it from source:

```sh
git clone https://github.com/GabrielGirardi/ledge.git
cd ledge
./scripts/install.sh
```

The script does three things:

1. It installs the extension for your user.
2. It installs the touchpad helper as a systemd user service (`ledge-touchd`).
3. It installs a udev rule that lets your user read the touchpad. This step
   asks for `sudo` once.

Then log out and log back in. On Wayland, GNOME Shell only discovers new
extensions at login.

To remove Ledge, run `./scripts/uninstall.sh`. Add `--udev` to also remove the
udev rule.

## Configure

Run `gnome-extensions prefs ledge@gabrielgirardi.github.io`, or open the
Extensions app.

| Setting | Default | Notes |
|---|---|---|
| Screen side | Right | Only a swipe from this touchpad edge opens the panel. |
| Top bar button | On | |
| Keyboard shortcut | `<Super>t` | Any GTK accelerator, for example `<Super><Shift>d`. |
| Weather city | Empty | When empty, Ledge uses the city of your time zone (`America/Sao_Paulo` becomes São Paulo). |

## How it works

libinput reports every two-finger motion as scrolling and never says where the
fingers are. So GNOME cannot tell an edge swipe apart from a normal scroll.
Ledge splits the work in two parts:

- **`ledge-touchd`** reads the touchpad's raw multitouch coordinates. It only
  reads the device and never grabs it. It publishes two-finger horizontal
  swipes on the session bus, together with the edge where the fingers landed.
- **The GNOME Shell extension** draws the panel and moves it with the
  gesture. While the panel is open, it takes input focus so the app
  underneath stops scrolling.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the full design, including the
D-Bus protocol and the gesture state machine.

## Privacy

- The touchpad helper reads only touchpads. The udev rule matches
  `ID_INPUT_TOUCHPAD=1` and never grants access to keyboards. The helper sends
  nothing over the network.
- The weather widget sends your city name, and then its coordinates, to
  Open-Meteo. No other widget makes network requests.

## Troubleshooting

| Symptom | Check |
|---|---|
| The gesture does nothing | Run `systemctl --user status ledge-touchd`. If it says *no read access*, run `./scripts/install-udev-rule.sh`. |
| The panel never appears | Run `gnome-extensions info ledge@gabrielgirardi.github.io`. The state must be `ACTIVE`. |
| Errors | Run `journalctl --user -u ledge-touchd -b` and `journalctl -b /usr/bin/gnome-shell \| grep -i ledge`. |

## Roadmap

- Support GNOME Shell 47 to 49.
- Hot corner trigger.
- Phone battery through GSConnect/KDE Connect.
- Smart stacks and more widgets.
- A community widget API.
- Rewrite the helper in Rust.
- Publish on extensions.gnome.org, AUR, and Fedora.

## Contributing

Contributions are welcome: code, translations, bug reports, and ideas. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Everyone
taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Ledge is free software under the [GNU General Public License v3.0 or
later](LICENSE).
