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

The helper reads one touchpad. It prefers a built-in one (I²C, PS/2) over USB
or Bluetooth, and it skips touchpads that belong to a game controller, which
it recognizes by a joystick node on the same HID device. If the touchpad is
missing or disappears, the helper retries every 3 seconds instead of exiting.

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

While the panel is not `CLOSED`, the extension holds a modal grab with
`Main.pushModal(panel)`. During a Clutter grab, every event, including clicks
outside the panel, goes only to the grab actor's subtree. So the extension
listens on the panel's `captured-event`, not the stage's. A listener on the
stage never fires while the grab is active.

- **Click outside, or <kbd>Esc</kbd>:** closes the panel. <kbd>Esc</kbd> also
  works while a text field in the panel has focus.
- **Scroll over the panel:** scrolls the widgets.
- **Scroll elsewhere:** swallowed, so the window underneath does not move.

### Monitor

The panel opens on the active monitor. For the gesture and the panel button,
that is the monitor under the pointer. For the keyboard shortcut, it is the
monitor with the focused window. The monitor is chosen on every open. If the
monitor layout changes while the panel is open, the panel closes and returns
to the primary monitor.

### Scrolling and picking

The widgets live in an `St.ScrollView` with `clip_to_allocation`, and the
content box has `clip_to_view: false`. In GNOME 46, the scroll view gives its
child a horizontal page that is narrower than the view, because it reserves
room for a vertical scrollbar. A scrolled box clips *picking*, but not
painting, to that page. The result: the right ~38 px of every row was drawn
but ignored clicks. Use the `Pick` development hook to check hit-testing after
any layout change.

A related trap: when the panel's content is taller than the screen, GNOME 46
lays it out at *minimum* heights, and a nested scroll view's minimum is next to
nothing. The to-do list pins its `min_height` to its rows (up to its cap), so
the panel scrolls instead of squeezing the list.

### Hot edge

`Layout.PressureBarrier` with one `Meta.Barrier` per monitor on the configured
edge, only where that edge is the edge of the whole screen. A barrier on an
edge shared with another monitor would stop the pointer from crossing. The
barriers stop 48 px short of the corners. An event filter ignores pushes while
a mouse button is held (drag and drop) or on a monitor running something
fullscreen. The barriers are rebuilt when the monitors, the side, or the
setting change.

### Widgets and edit mode

The `widgets` setting is the source of truth: shown widget ids, in order.
`widgets/catalog.js` lists the known widgets for both the panel and the
preferences. It imports nothing from GNOME Shell, because the preferences run
in a separate GTK process. `_syncWidgets()` diffs the setting against the live
widgets. It destroys removed ones (a hidden widget makes no D-Bus or network
calls), creates added ones, and reorders the rest without rebuilding them.

Edit mode (`editMode.js`) only ever writes that setting. While it is active,
the panel forwards its captured events to it first:

- A press on a card starts a drag instead of reaching the card's controls.
  Cards are made reactive so the press does not pick the scroll view behind
  them.
- Motion moves the card under the pointer and reorders it live.
- Release writes the new order.

There is no `Clutter.DragAction` in GNOME 46, so dragging is built on the
panel's existing modal grab.

### Height

The panel sizes to its content, up to the room between GNOME's panel and the
opposite edge of the monitor. Beyond that, the content scrolls. The room is
measured on every open from where `Main.panel` actually is. Bars that hide
automatically, such as Zorin Taskbar or Dash to Panel, reserve no work-area
space, so the work area alone would put the sidebar underneath them.

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
| Weather | Open-Meteo forecast (libsoup 3). The place, in order: one picked in the preferences (`weather-location`), a city typed in 0.3 or earlier (`weather-city`), GeoClue when Location Services are on (named by GWeather's offline city list), the time zone's city. | On open, when the data is older than 30 minutes, and when the place changes |
| Batteries | UPower over the system bus | Live, through `PropertiesChanged` and `DeviceAdded`/`DeviceRemoved` |
| Calendar | GNOME Shell's `DBusEventSource` (the calendar server) | On open, plus change signals |
| To-do | `~/.local/share/ledge/todo.json` through `JsonStore` | Written on every change |
| Screen Time | `UsageTracker` (`usage.js`): `Shell.WindowTracker` focus changes, minus idle (2 min) and locked time | Always running. Saved every 60 s to `~/.local/share/ledge/usage.json`, which keeps 30 days, the longest range the card shows |
| Now Playing | GNOME Shell's `MprisPlayer`, one per `org.mpris.MediaPlayer2.*` name | Live |

## Locale

`locale.js` reads `LC_TIME` for dates (`Intl`) and `LC_MESSAGES` for the
weather geocoding language. UI strings use gettext with the domain `ledge`.
This matters for users who run, for example, an English UI with Brazilian date
formats.
