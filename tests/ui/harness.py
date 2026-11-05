"""Drives a headless GNOME Shell running Ledge, for the UI tests.

The shell comes from scripts/headless.sh. Actions go through the extension's
development hooks (real pointer and keyboard events); assertions read its
DevQuery1 object, which reports state and where every "ledge:*" actor is, so
tests click by name instead of by pixel.
"""

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp")) / "ledge-nested"
DATA = STATE_DIR / "data" / "ledge"

SIGNAL_PATH = "/io/github/gabrielgirardi/Ledge/Touchpad"
DEV = "io.github.gabrielgirardi.Ledge.Dev1"
QUERY_PATH = "/io/github/gabrielgirardi/Ledge/Dev"
QUERY = "io.github.gabrielgirardi.Ledge.DevQuery1"
ESCAPE = 65307


class Shell:
    def __init__(self, monitors="1600x1000 1280x800"):
        shutil.rmtree(DATA, ignore_errors=True)
        env = dict(os.environ, LEDGE_MONITORS=monitors)
        subprocess.run([str(ROOT / "scripts" / "headless.sh")], check=True, env=env,
                       stdout=subprocess.DEVNULL)
        address = (STATE_DIR / "bus").read_text().strip()
        self.bus = Gio.DBusConnection.new_for_address_sync(
            address,
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
            None, None)

    def stop(self):
        self.bus.close_sync(None)
        subprocess.run([str(ROOT / "scripts" / "headless.sh"), "--stop"], check=False)

    # Actions -------------------------------------------------------------

    def emit(self, name, fmt=None, *args):
        self.bus.emit_signal(None, SIGNAL_PATH, DEV, name, GLib.Variant(fmt, args) if fmt else None)
        self.bus.flush_sync(None)

    def toggle(self):
        self.emit("Toggle")

    def warp(self, x, y):
        self.emit("Warp", "(ii)", x, y)
        time.sleep(0.15)

    def click(self, x, y):
        self.emit("Click", "(ii)", x, y)
        time.sleep(0.35)

    def click_target(self, name):
        x, y, _w, _h = self.wait_for(lambda: self.state()["targets"].get(name), f"target {name}")
        self.click(x, y)

    def key(self, keyval):
        self.emit("Key", "(u)", keyval)
        time.sleep(0.2)

    def type(self, text):
        self.emit("Type", "(s)", text)
        time.sleep(0.05 * len(text) + 0.2)

    def scroll(self, x, y, steps):
        self.emit("Scroll", "(iii)", x, y, steps)
        time.sleep(0.4)

    # Queries -------------------------------------------------------------

    def _query(self, method, params=None):
        reply = self.bus.call_sync("org.gnome.Shell", QUERY_PATH, QUERY, method, params,
                                   GLib.VariantType("(s)"), Gio.DBusCallFlags.NONE, 5000, None)
        return reply.unpack()[0]

    def state(self):
        return json.loads(self._query("GetState"))

    def pick(self, x, y):
        return self._query("Pick", GLib.Variant("(ii)", (x, y)))

    def todos(self):
        try:
            return json.loads((DATA / "todo.json").read_text())["items"]
        except FileNotFoundError:
            return []

    def wait_for(self, predicate, what, timeout=6.0):
        deadline = time.monotonic() + timeout
        while True:
            value = predicate()
            if value:
                return value
            if time.monotonic() > deadline:
                raise AssertionError(f"timed out waiting for {what}; state: {self.state()}")
            time.sleep(0.1)

    # Composite steps -----------------------------------------------------

    def open_panel(self):
        self.toggle()
        return self.wait_for(lambda: (s := self.state())["state"] == "OPEN" and s["progress"] == 1 and s,
                             "panel open")

    def close_panel(self):
        if self.state()["state"] != "CLOSED":
            self.key(ESCAPE)
            self.wait_for(lambda: self.state()["state"] == "CLOSED", "panel closed")
