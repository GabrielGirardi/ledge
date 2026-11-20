"""A stand-in for GSConnect's D-Bus service with one fictional phone, for the
UI tests and previews. It exports what Ledge reads: the device objects under
an ObjectManager, and each device's action group with a "battery" action.

Reads commands, one per line, from stdin:
    battery PERCENT CHARGING   e.g. "battery 42 true"
    connected true|false
    quit
"""

import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

NAME = "org.gnome.Shell.Extensions.GSConnect"
ROOT = "/org/gnome/Shell/Extensions/GSConnect"
DEVICE = f"{ROOT}/Device/demo_phone"
IFACE = "org.gnome.Shell.Extensions.GSConnect.Device"

INFO = Gio.DBusNodeInfo.new_for_xml(f"""<node>
<interface name="org.freedesktop.DBus.ObjectManager">
  <method name="GetManagedObjects"><arg type="a{{oa{{sa{{sv}}}}}}" direction="out"/></method>
  <signal name="InterfacesAdded"><arg type="o"/><arg type="a{{sa{{sv}}}}"/></signal>
  <signal name="InterfacesRemoved"><arg type="o"/><arg type="as"/></signal>
</interface>
<interface name="{IFACE}">
  <property name="Connected" type="b" access="read"/>
  <property name="Id" type="s" access="read"/>
  <property name="Name" type="s" access="read"/>
  <property name="Paired" type="b" access="read"/>
  <property name="IconName" type="s" access="read"/>
  <property name="Type" type="s" access="read"/>
</interface>
</node>""")

props = {
    "Connected": GLib.Variant("b", True),
    "Id": GLib.Variant("s", "demo-phone"),
    "Name": GLib.Variant("s", "Demo Phone"),
    "Paired": GLib.Variant("b", True),
    "IconName": GLib.Variant("s", "phone-symbolic"),
    "Type": GLib.Variant("s", "phone"),
}

battery = Gio.SimpleAction.new_stateful(
    "battery", GLib.VariantType("(bsii)"), GLib.Variant("(bsii)", (False, "battery-good-symbolic", 80, 0)))
actions = Gio.SimpleActionGroup()
actions.add_action(battery)


def on_root_call(conn, _sender, _path, _iface, method, _params, invocation):
    invocation.return_value(GLib.Variant("(a{oa{sa{sv}}})", ({DEVICE: {IFACE: props}},)))


def on_bus(conn, _name):
    conn.register_object(ROOT, INFO.interfaces[0], on_root_call, None, None)
    conn.register_object(DEVICE, INFO.interfaces[1], None,
                         lambda *a: props[a[-1]], None)
    conn.export_action_group(DEVICE, actions)

    def command(channel, _condition):
        line = channel.readline().split()
        if not line or line[0] == "quit":
            loop.quit()
            return False
        if line[0] == "battery":
            battery.set_state(GLib.Variant("(bsii)", (line[2] == "true", "battery-symbolic", int(line[1]), 0)))
        elif line[0] == "connected":
            props["Connected"] = GLib.Variant("b", line[1] == "true")
            conn.emit_signal(None, DEVICE, "org.freedesktop.DBus.Properties", "PropertiesChanged",
                             GLib.Variant("(sa{sv}as)", (IFACE, {"Connected": props["Connected"]}, [])))
        return True

    GLib.io_add_watch(GLib.IOChannel.unix_new(sys.stdin.fileno()), GLib.PRIORITY_DEFAULT, GLib.IO_IN | GLib.IO_HUP, command)
    print("ready", flush=True)


loop = GLib.MainLoop()
Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.NONE, on_bus, None, lambda *a: loop.quit())
loop.run()
