# Architecture

Ledge has two processes. They talk over the session bus.

```
 touchpad (/dev/input/eventN)
        │ raw multitouch frames (read-only)
        ▼
 ┌──────────────────┐   session bus signals   ┌─────────────────────────────────┐
 │ ledge-touchd     │ ──────────────────────► │ GNOME Shell extension           │
 │ (Python, systemd │  Begin/Update/End/Cancel│  extension.js  gesture, spring, │
 │  user service)   │                         │                input grab       │
 └──────────────────┘                         │  glass.js      frosted glass    │
                                              │  widgets/*.js  data + cards     │
                                              └─────────────────────────────────┘
```

## Why a separate helper

libinput, the input stack under GNOME, reports every two-finger motion as
scroll events. Those events do not include finger positions. Upstream declined
to add a two-finger swipe gesture
([freedesktop bug 99165](https://bugs.freedesktop.org/show_bug.cgi?id=99165)).
Without finger positions, GNOME Shell cannot tell a swipe that started at the
touchpad edge from an ordinary scroll.

The kernel evdev device does report per-finger coordinates. Reading it needs
access that the session user does not have by default. The udev rule grants
that access for touchpads only, through the `uaccess` tag. The tag gives the
user who is active on the seat an ACL on the device.

The helper opens the device read-only and never calls `EVIOCGRAB`. libinput and
the compositor keep receiving every event, so normal scrolling keeps working.

## D-Bus protocol

The helper owns `io.github.gabrielgirardi.Ledge.Touchpad` on the session bus,
and emits signals from `/io/github/gabrielgirardi/Ledge/Touchpad` on interface
`io.github.gabrielgirardi.Ledge.Touchpad1`.

| Signal | Arguments | Meaning |
|---|---|---|
| `Begin` | `s edge` | A two-finger horizontal swipe started. `edge` is `left`, `right`, or `none`: where the fingers landed. |
| `Update` | `d dx` | Horizontal travel since `Begin`, in touchpad widths. Positive is rightward. |
| `End` | `d dx, d vx` | The fingers lifted. `vx` is the release velocity in widths per second, measured over the last 80 ms. |
| `Cancel` | | The swipe stopped being a two-finger swipe, for example because a third finger landed. |

The values are physical. Natural scrolling and pointer speed settings do not
affect them.

Changing this protocol is a breaking change. See CONTRIBUTING.md.

## Gesture state machine (helper)

The helper evaluates the state after every `SYN_REPORT` frame.

```
IDLE ──2 fingers down──► CANDIDATE ──moved ≥2.5 mm, |dx| ≥ 1.3·|dy|──► ACTIVE ──fingers < 2──► (End) IDLE
                             │                                            │
                             └──vertical or ≠2 fingers──► REJECTED        └──3+ fingers──► (Cancel) REJECTED
                                                          (until all fingers lift)
```

The helper classifies the edge from where each finger first touched down, not
from where it is when the swipe commits. An edge swipe is one where the
fingers landed in the outer 12 % of the touchpad, with every finger in the
outer 24 %.

## Panel (extension)

### Geometry

`_strip` is a clipped, non-reactive actor along the screen edge, inside the
monitor's work area, so it never covers a docked top bar or bottom bar. The
panel slides inside it. Because of the clip, the panel always enters from the
screen edge.

`progress` runs from 0 (hidden) to 1 (open). It maps to `translation_x`.
Above 1, it is rubber-banded.

### States

| State | Driven by |
|---|---|
| `CLOSED` | Nothing. The panel is hidden. |
| `DRAGGING` | `Update` signals from the helper. |
| `SETTLING` | A slightly underdamped spring (stiffness 320, damping ratio 0.82), integrated per frame. |
| `OPEN` | Nothing. Input is grabbed. |

When the fingers lift, the panel settles toward the end the user meant. A
release velocity above 1.2 panel-widths per second wins. Otherwise the panel
goes to the nearer end.

While the panel is not `CLOSED`, the extension holds a modal grab. Finger
scroll events are swallowed, so the window underneath does not scroll. A click
outside the panel or <kbd>Esc</kbd> closes it.

The screen side is read once per layout, as `_layoutSide`. The gesture
direction and the placement both use that value, so they cannot disagree. A
side change made while the panel is open applies when it closes.

### Glass

`Shell.BlurEffect` in `BACKGROUND` mode re-blurs only the damaged region of
each frame. That leaves square artifacts wherever the cursor or a window
underneath repaints. Ledge uses a static copy of the wallpaper instead:

1. A `BackgroundManager` creates a wallpaper actor the size of the monitor
   inside the glass layer.
2. An `ACTOR`-mode blur is applied to that actor once, and then cached.
3. The actor is offset by the panel's on-screen position, so the blur lines
   up with the real wallpaper.
4. A GLSL `RoundedMask` clips the corners with antialiasing.

The trade-off: the glass shows the wallpaper, not the windows behind the
panel.

### Widgets

Each widget is a module in `widgets/` that exposes:

| Member | Contract |
|---|---|
| `actor` | A card built with `cardShell(icon, title)`. Hide it when there is nothing to show. |
| `refresh()` | Optional. Runs each time the panel opens. Must be cheap or rate-limited. |
| `destroy()` | Disconnects everything and destroys `actor`. |

| Widget | Source | Refresh |
|---|---|---|
| Weather | Open-Meteo geocoding and forecast (libsoup 3) | On open, when the data is older than 30 minutes |
| Batteries | UPower over the system bus | Live, through `PropertiesChanged` and `DeviceAdded`/`DeviceRemoved` |
| Calendar | GNOME Shell's `DBusEventSource` (the calendar server) | On open, plus change signals |
| Now Playing | GNOME Shell's `MprisPlayer`, one per `org.mpris.MediaPlayer2.*` name | Live |

## Locale

`locale.js` reads `LC_TIME` for dates (`Intl`) and `LC_MESSAGES` for the
weather geocoding language. UI strings use gettext with the domain `ledge`.
This matters for users who run, for example, an English UI with Brazilian date
formats.
