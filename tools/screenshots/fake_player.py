"""A minimal MPRIS player for screenshots. Usage: fake_player.py COVER.png"""

import sys
from pathlib import Path

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

XML = """<node>
<interface name="org.mpris.MediaPlayer2">
  <property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/>
</interface>
<interface name="org.mpris.MediaPlayer2.Player">
  <method name="PlayPause"/><method name="Next"/><method name="Previous"/>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="CanPlay" type="b" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
</interface>
</node>"""

PROPS = {
    "Identity": GLib.Variant("s", "Demo Player"),
    "DesktopEntry": GLib.Variant("s", ""),
    "PlaybackStatus": GLib.Variant("s", "Playing"),
    "Metadata": GLib.Variant("a{sv}", {
        "xesam:title": GLib.Variant("s", "Neon Tides"),
        "xesam:artist": GLib.Variant("as", ["Synthwave Collective"]),
        "mpris:artUrl": GLib.Variant("s", Path(sys.argv[1]).resolve().as_uri()),
    }),
    "CanPlay": GLib.Variant("b", True),
    "CanGoNext": GLib.Variant("b", True),
    "CanGoPrevious": GLib.Variant("b", True),
}


def on_bus(conn, _name):
    for iface in Gio.DBusNodeInfo.new_for_xml(XML).interfaces:
        conn.register_object("/org/mpris/MediaPlayer2", iface,
                             lambda c, s, p, i, m, args, inv: inv.return_value(None),
                             lambda c, s, p, i, prop: PROPS[prop], None)


Gio.bus_own_name(Gio.BusType.SESSION, "org.mpris.MediaPlayer2.ledgedemo",
                 Gio.BusNameOwnerFlags.NONE, on_bus, None, None)
GLib.MainLoop().run()
