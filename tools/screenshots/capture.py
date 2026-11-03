"""Drives nested GNOME Shell sessions and writes the README images.
Run through tools/screenshots/run.sh, which sets up the isolated profile."""

import math
import os
import subprocess
import sys
import time
from pathlib import Path

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402
from PIL import Image, ImageChops  # noqa: E402

UUID = "ledge@gabrielgirardi.github.io"
PATH = "/io/github/gabrielgirardi/Ledge/Touchpad"
DEV = "io.github.gabrielgirardi.Ledge.Dev1"
W, H = 1600, 1000

work, images, schema_dir = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
raw = work / "raw"
raw.mkdir(exist_ok=True)
images.mkdir(parents=True, exist_ok=True)
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def gset(schema, key, value, ledge=False):
    env = dict(os.environ, GSETTINGS_SCHEMA_DIR=schema_dir) if ledge else None
    subprocess.run(["gsettings", "set", schema, key, value], check=True, env=env)


def emit(name, fmt=None, *args):
    bus.emit_signal(None, PATH, DEV, name, GLib.Variant(fmt, args) if fmt else None)
    bus.flush_sync(None)


def shot(name):
    path = raw / f"{name}.png"
    path.unlink(missing_ok=True)
    emit("Shot", "(s)", str(path))
    last = -1
    for _ in range(100):
        time.sleep(0.05)
        if path.exists() and path.stat().st_size == last and last > 0:
            return Image.open(path).convert("RGB")
        last = path.stat().st_size if path.exists() else -1
    raise RuntimeError(f"screenshot {name} timed out")


def show(p, settle=0.15):
    emit("Show", "(d)", float(p))
    time.sleep(settle)


def wayland_sockets():
    runtime = Path(os.environ["XDG_RUNTIME_DIR"])
    return {p.name for p in runtime.glob("wayland-*") if not p.name.endswith(".lock")}


def start_shell(lang):
    before = wayland_sockets()
    env = dict(os.environ, LANGUAGE=lang, LC_ALL=f"{lang}.UTF-8", LEDGE_DEV="1",
               MUTTER_DEBUG_DUMMY_MODE_SPECS=f"{W}x{H}")
    shell = subprocess.Popen(["gnome-shell", "--nested", "--wayland"], env=env,
                             stdout=subprocess.DEVNULL, stderr=open(work / f"shell-{lang}.log", "w"))
    for _ in range(120):
        time.sleep(0.5)
        info = subprocess.run(["gnome-extensions", "info", UUID], capture_output=True, text=True).stdout
        if "State: ACTIVE" in info:
            # D-Bus-activated apps (the preferences window) must open on the
            # nested display, not on the session the script was started from.
            socket = sorted(wayland_sockets() - before)[-1]
            subprocess.run(["dbus-update-activation-environment", f"WAYLAND_DISPLAY={socket}", "DISPLAY="],
                           check=True)
            time.sleep(1)
            show(1, 0)
            show(0, 0)
            time.sleep(6)  # weather request, calendar server, cover art
            return shell
    shell.terminate()
    raise RuntimeError(f"Ledge did not become ACTIVE; see {work}/shell-{lang}.log")


def stop_shell(shell):
    shell.terminate()
    shell.wait(10)


def spring(x, v, target, fps=30, k=320, zeta=0.82):
    c = 2 * math.sqrt(k) * zeta
    out = []
    for _ in range(fps * 2):
        for _ in range(8):
            h = 1 / fps / 8
            v += (-k * (x - target) - c * v) * h
            x += v * h
        out.append(x)
        if abs(x - target) < 0.002 and abs(v) < 0.02:
            break
    out.append(target)
    return out


def gesture_curve():
    """(progress, milliseconds) pairs: a finger drag, the spring, a hold, and back."""
    drag = [0.62 * (1 - (1 - t / 13) ** 2) for t in range(1, 14)]
    opened = spring(drag[-1], 1.6, 1)
    closing = [opened[-1] - 0.3 * (t / 8) ** 1.6 for t in range(1, 9)]
    closed = spring(closing[-1], -2.2, 0)
    frame = 33
    return ([(0, 600)] + [(p, frame) for p in drag + opened[:-1]] + [(1, 1800)] +
            [(p, frame) for p in closing + closed[:-1]] + [(0, 400)])


player = subprocess.Popen([sys.executable, "-I", str(Path(__file__).with_name("fake_player.py")),
                           str(work / "assets" / "cover.png")])
try:
    gset("org.gnome.shell", "enabled-extensions", f"['{UUID}']")
    gset("org.gnome.shell", "welcome-dialog-last-shown-version", "'999'")
    gset("org.gnome.desktop.interface", "color-scheme", "'prefer-dark'")
    for key in ("picture-uri", "picture-uri-dark"):
        gset("org.gnome.desktop.background", key, f"'{(work / 'assets' / 'wallpaper.png').as_uri()}'")
    gset("org.gnome.desktop.background", "picture-options", "'zoom'")

    # English, right edge: hero, gesture animation, preferences.
    gset("org.gnome.shell.extensions.ledge", "side", "'right'", ledge=True)
    shell = start_shell("en_US")
    show(1, 1.5)
    hero = shot("hero")
    frames, durations = [], []
    for p, ms in gesture_curve():
        show(p, 0.03)
        frames.append(shot("frame"))
        durations.append(ms)
    show(0, 0.5)
    desktop = shot("desktop")
    prefs = subprocess.Popen(["gnome-extensions", "prefs", UUID])
    time.sleep(6)
    prefs_full = shot("prefs")
    prefs.terminate()
    stop_shell(shell)

    # Brazilian Portuguese, left edge.
    gset("org.gnome.shell.extensions.ledge", "side", "'left'", ledge=True)
    shell = start_shell("pt_BR")
    show(1, 1.5)
    left = shot("left-pt")
    stop_shell(shell)
finally:
    player.terminate()

hero.save(images / "hero.jpg", quality=90, optimize=True, progressive=True)
hero.crop((W - 470, 0, W, 780)).save(images / "panel.png", optimize=True)
left.crop((0, 0, 470, 780)).save(images / "left-pt-br.png", optimize=True)

box = ImageChops.difference(prefs_full, desktop).getbbox()
if box:
    pad = 24
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(W, box[2] + pad), min(H, box[3] + pad))
    prefs_full.crop(box).save(images / "preferences.png", optimize=True)
else:
    print("warning: preferences window not found; preferences.png not updated")

# Animated WebP keeps the full gradient; GIF's 256 colors band badly on the glass.
anim = [f.crop((W - 720, 0, W, 780)).resize((576, 624), Image.LANCZOS) for f in frames]
anim[0].save(images / "gesture.webp", save_all=True, append_images=anim[1:], duration=durations,
             loop=0, quality=82, method=6)
for f in sorted(images.iterdir()):
    print(f"{f.name}: {f.stat().st_size // 1024} KiB")
