#!/usr/bin/env python3
"""Ledge touchpad helper (prototype).

libinput reports every two-finger motion as scrolling and never says where the
fingers are, so an edge swipe is undetectable from inside the compositor. This
helper reads the touchpad's raw multitouch coordinates (read-only, never
grabbed) and publishes two-finger horizontal swipes on the session bus:

  Begin(s edge)          edge = "left" | "right" | "none" (where the fingers landed)
  Update(d dx)           horizontal travel, in touchpad widths, + is rightward
  End(d dx, d vx)        final travel and release velocity (widths / second)
  Cancel()

Natural-scrolling settings do not affect these values: they are physical.
"""

import argparse
import fcntl
import glob
import math
import os
import re
import struct
import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

BUS_NAME = "io.github.gabrielgirardi.Ledge.Touchpad"
BUS_PATH = "/io/github/gabrielgirardi/Ledge/Touchpad"
BUS_IFACE = "io.github.gabrielgirardi.Ledge.Touchpad1"

EV_SYN, EV_KEY, EV_ABS = 0x00, 0x01, 0x03
SYN_REPORT, SYN_DROPPED = 0, 3
ABS_MT_SLOT = 0x2F
ABS_MT_POSITION_X = 0x35
ABS_MT_POSITION_Y = 0x36
ABS_MT_TRACKING_ID = 0x39
BTN_TOOL_FINGERS = {0x145: 1, 0x14D: 2, 0x14E: 3, 0x14F: 4, 0x148: 5}

INPUT_EVENT = struct.Struct("llHHi")
ABSINFO = struct.Struct("6i")

EDGE_ZONE = 0.12          # fingers must land within this fraction of either side
COMMIT_MM = 2.5           # travel before deciding horizontal vs. not
HORIZONTAL_RATIO = 1.3    # |dx| must beat |dy| by this much
VELOCITY_WINDOW = 0.08    # seconds of samples used for release velocity


def _ior(nr, size):
    return (2 << 30) | (size << 16) | (ord("E") << 8) | nr


def absinfo(fd, code):
    buf = fcntl.ioctl(fd, _ior(0x40 + code, ABSINFO.size), bytes(ABSINFO.size))
    _value, lo, hi, _fuzz, _flat, res = ABSINFO.unpack(buf)
    return lo, hi, res


def udev_props(node):
    """udev properties of /dev/input/<node>, from udev's runtime database."""
    rdev = os.stat(f"/dev/input/{node}").st_rdev
    try:
        with open(f"/run/udev/data/c{os.major(rdev)}:{os.minor(rdev)}") as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        return {}
    return dict(line[2:].split("=", 1) for line in lines if line.startswith("E:") and "=" in line)


def in_game_controller(node):
    """Controllers like the DualSense expose a touchpad next to a joystick on
    the same HID device. Their touchpad is not where anyone swipes for Ledge."""
    hid = os.path.realpath(f"/sys/class/input/{node}/device/..")
    for sibling in glob.glob(os.path.join(hid, "input*", "event*")):
        name = os.path.basename(sibling)
        if os.path.exists(f"/dev/input/{name}") and udev_props(name).get("ID_INPUT_JOYSTICK") == "1":
            return True
    return False


def find_touchpad():
    """The laptop's own touchpad if there is one, else an external one.
    Game controller touchpads are never picked."""
    candidates = []
    for node in os.listdir("/dev/input"):
        if not re.fullmatch(r"event\d+", node):
            continue
        props = udev_props(node)
        if props.get("ID_INPUT_TOUCHPAD") != "1" or in_game_controller(node):
            continue
        external = props.get("ID_BUS") in ("usb", "bluetooth")
        candidates.append((external, int(node[5:]), f"/dev/input/{node}"))
    return min(candidates)[2] if candidates else None


class Bus:
    def __init__(self):
        self.conn = None
        Gio.bus_own_name(Gio.BusType.SESSION, BUS_NAME, Gio.BusNameOwnerFlags.NONE,
                         self._acquired, None, None)

    def _acquired(self, conn, _name):
        self.conn = conn

    def emit(self, signal, fmt=None, *args):
        if self.conn is None:
            return
        params = GLib.Variant(fmt, args) if fmt else None
        self.conn.emit_signal(None, BUS_PATH, BUS_IFACE, signal, params)


class Tracker:
    IDLE, CANDIDATE, ACTIVE, REJECTED = range(4)

    def __init__(self, fd, bus, verbose, trace):
        self.bus = bus
        self.verbose = verbose
        self.trace = trace
        self.xmin, xmax, xres = absinfo(fd, ABS_MT_POSITION_X)
        self.ymin, ymax, yres = absinfo(fd, ABS_MT_POSITION_Y)
        self.width = xmax - self.xmin
        self.xres = xres or 1
        self.yres = yres or self.xres
        self.slots = {}            # slot -> [x, y, tracking]
        self.landed = {}           # slot -> normalized x at touch-down
        self.new_slots = set()
        self.slot = 0
        self.fingers = 0
        self.state = self.IDLE
        print(f"touchpad {self.width / self.xres:.0f}mm wide, "
              f"{(ymax - self.ymin) / self.yres:.0f}mm tall", file=sys.stderr)

    def norm_x(self, x):
        return (x - self.xmin) / self.width

    def handle(self, sec, usec, etype, code, value):
        if etype == EV_ABS:
            if code == ABS_MT_SLOT:
                self.slot = value
                return
            s = self.slots.setdefault(self.slot, [0, 0, -1])
            if code == ABS_MT_POSITION_X:
                s[0] = value
            elif code == ABS_MT_POSITION_Y:
                s[1] = value
            elif code == ABS_MT_TRACKING_ID:
                if value >= 0 and s[2] < 0:
                    self.new_slots.add(self.slot)
                elif value < 0:
                    self.landed.pop(self.slot, None)
                s[2] = value
        elif etype == EV_KEY and code in BTN_TOOL_FINGERS:
            if value:
                self.fingers = BTN_TOOL_FINGERS[code]
            elif self.fingers == BTN_TOOL_FINGERS[code]:
                self.fingers = 0
        elif etype == EV_SYN and code == SYN_REPORT:
            for slot in self.new_slots:
                self.landed[slot] = self.norm_x(self.slots[slot][0])
            self.new_slots.clear()
            self.frame(sec + usec / 1e6)
        elif etype == EV_SYN and code == SYN_DROPPED:
            self.abort()

    def touching(self):
        return [s for s in self.slots.values() if s[2] >= 0]

    def centroid(self):
        pts = self.touching()
        if not pts:
            return None
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

    def edge(self):
        xs = list(self.landed.values())
        if len(xs) < 2:
            return "none"
        if min(xs) > 1 - EDGE_ZONE * 2 and max(xs) > 1 - EDGE_ZONE:
            return "right"
        if max(xs) < EDGE_ZONE * 2 and min(xs) < EDGE_ZONE:
            return "left"
        return "none"

    def abort(self):
        if self.state == self.ACTIVE:
            self.bus.emit("Cancel")
        self.state = self.REJECTED

    def frame(self, t):
        n = self.fingers
        if self.trace:
            pts = " ".join(f"{self.norm_x(p[0]):.3f},{p[1]}" for p in self.touching())
            print(f"T {t:.4f} n={n} st={self.state} {pts}", file=sys.stderr)
        if n == 0:
            if self.state == self.ACTIVE:
                self.finish()
            self.state = self.IDLE
            return

        c = self.centroid()
        if c is None:
            return

        if self.state == self.IDLE:
            if n == 2 and len(self.touching()) >= 2:
                self.start = c
                self.start_edge = self.edge()
                self.samples = [(t, c[0])]
                self.state = self.CANDIDATE
            elif n > 2:
                self.state = self.REJECTED
            return

        if self.state == self.REJECTED:
            return

        if n != 2:
            if self.state == self.ACTIVE:
                if n < 2:
                    self.finish()
                else:
                    self.bus.emit("Cancel")
            self.state = self.REJECTED
            return

        dx_mm = (c[0] - self.start[0]) / self.xres
        dy_mm = (c[1] - self.start[1]) / self.yres
        self.samples.append((t, c[0]))
        self.samples = [s for s in self.samples if t - s[0] <= VELOCITY_WINDOW]

        if self.state == self.CANDIDATE:
            if math.hypot(dx_mm, dy_mm) < COMMIT_MM:
                return
            if abs(dx_mm) < HORIZONTAL_RATIO * abs(dy_mm):
                self.state = self.REJECTED
                return
            self.state = self.ACTIVE
            self.bus.emit("Begin", "(s)", self.start_edge)
            if self.verbose:
                print(f"begin edge={self.start_edge}", file=sys.stderr)

        self.dx = (c[0] - self.start[0]) / self.width
        self.bus.emit("Update", "(d)", self.dx)

    def finish(self):
        vx = 0.0
        if len(self.samples) >= 2:
            (t0, x0), (t1, x1) = self.samples[0], self.samples[-1]
            if t1 > t0:
                vx = (x1 - x0) / self.width / (t1 - t0)
        self.bus.emit("End", "(dd)", self.dx, vx)
        if self.verbose:
            print(f"end dx={self.dx:+.3f} vx={vx:+.2f}", file=sys.stderr)


RETRY_S = 3


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("device", nargs="?", help="evdev node (default: autodetect)")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--trace", action="store_true", help="print every raw frame")
    args = ap.parse_args()

    bus = Bus()
    loop = GLib.MainLoop()
    fatal = []
    waiting = [False]

    def retry_later():
        GLib.timeout_add_seconds(RETRY_S, lambda: attach() and False)

    def attach():
        """Opens the touchpad, or schedules another try. Touchpads on I2C can
        vanish across suspend and come back with a new node; waiting here
        instead of exiting keeps systemd's restart limit out of the picture."""
        path = args.device or find_touchpad()
        try:
            if not path:
                raise FileNotFoundError("no touchpad found")
            fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            tracker = Tracker(fd, bus, args.verbose, args.trace)
        except PermissionError:
            fatal.append(f"ledge-touchd: no read access to {path}. "
                         "Install packaging/70-ledge-touchpad.rules (see README).")
            loop.quit()
            return False
        except OSError as e:
            if not waiting[0]:
                print(f"ledge-touchd: {e}; waiting for a touchpad", file=sys.stderr)
                waiting[0] = True
            retry_later()
            return False
        waiting[0] = False
        print(f"ledge-touchd: reading {path}", file=sys.stderr)

        def on_input(_fd, cond):
            try:
                if cond & (GLib.IO_HUP | GLib.IO_ERR):
                    raise OSError("device went away")
                data = os.read(fd, INPUT_EVENT.size * 64)
            except BlockingIOError:
                return True
            except OSError as e:
                print(f"ledge-touchd: lost {path}: {e}; waiting for it to come back", file=sys.stderr)
                tracker.abort()
                os.close(fd)
                retry_later()
                return False
            for i in range(0, len(data) - INPUT_EVENT.size + 1, INPUT_EVENT.size):
                tracker.handle(*INPUT_EVENT.unpack_from(data, i))
            return True

        GLib.io_add_watch(fd, GLib.PRIORITY_HIGH, GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, on_input)
        return True

    attach()
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 2, loop.quit)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, loop.quit)
    loop.run()
    if fatal:
        sys.exit(fatal[0])


if __name__ == "__main__":
    main()
