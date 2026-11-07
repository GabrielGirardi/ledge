import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {cardShell} from './card.js';
import {VERTICAL} from '../compat.js';

const UPOWER = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower';
const DEVICE_IFACE = 'org.freedesktop.UPower.Device';

const TYPE_LINE_POWER = 1;
const TYPE_BATTERY = 2;
const STATE_CHARGING = 1;
const LOW_PERCENT = 20;
const RING_SIZE = 54;

const ICONS = {
    2: 'computer-symbolic',
    3: 'uninterruptible-power-supply-symbolic',
    5: 'input-mouse-symbolic',
    6: 'input-keyboard-symbolic',
    8: 'phone-symbolic',
    10: 'input-tablet-symbolic',
    12: 'input-gaming-symbolic',
    13: 'input-tablet-symbolic',
    14: 'input-touchpad-symbolic',
    17: 'audio-headset-symbolic',
    18: 'audio-speakers-symbolic',
    19: 'audio-headphones-symbolic',
};

class BatteryRing {
    constructor() {
        this.actor = new St.BoxLayout({...VERTICAL, style_class: 'ledge-battery'});
        const bin = new St.Widget({layout_manager: new Clutter.BinLayout(), width: RING_SIZE, height: RING_SIZE});
        this._area = new St.DrawingArea({width: RING_SIZE, height: RING_SIZE});
        this._area.connect('repaint', area => this._paint(area));
        this._icon = new St.Icon({
            style_class: 'ledge-battery-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        bin.add_child(this._area);
        bin.add_child(this._icon);
        this._label = new St.Label({style_class: 'ledge-battery-label', x_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(bin);
        this.actor.add_child(this._label);
        this._fraction = 0;
        this._low = false;
    }

    update(iconName, percentage, charging) {
        this._icon.icon_name = iconName;
        this._fraction = Math.min(1, percentage / 100);
        this._low = percentage <= LOW_PERCENT && !charging;
        this._label.text = `${charging ? '⚡' : ''}${Math.round(percentage)}%`;
        this._area.queue_repaint();
    }

    _paint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const line = w * 0.09;
        const r = Math.min(w, h) / 2 - line / 2;
        cr.setLineWidth(line);
        cr.setLineCap(Cairo.LineCap.ROUND);

        cr.setSourceRGBA(1, 1, 1, 0.14);
        cr.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
        cr.stroke();

        if (this._low)
            cr.setSourceRGBA(1, 0.27, 0.23, 1);
        else
            cr.setSourceRGBA(0.2, 0.84, 0.42, 1);
        const start = -Math.PI / 2;
        cr.arc(w / 2, h / 2, r, start, start + 2 * Math.PI * this._fraction);
        cr.stroke();
        cr.$dispose();
    }
}

export class BatteriesWidget {
    constructor() {
        this.actor = cardShell('battery-good-symbolic', _('Batteries').toUpperCase());
        this._row = new St.BoxLayout({style_class: 'ledge-battery-row'});
        this.actor.add_child(this._row);
        this.actor.visible = false;

        this._devices = new Map();
        this._cancellable = new Gio.Cancellable();
        this._subscriptions = ['DeviceAdded', 'DeviceRemoved'].map(signal =>
            Gio.DBus.system.signal_subscribe(UPOWER, UPOWER, signal, UPOWER_PATH, null,
                Gio.DBusSignalFlags.NONE,
                (_c, _s, _p, _i, name, params) => {
                    const [path] = params.deep_unpack();
                    if (name === 'DeviceAdded')
                        this._add(path);
                    else
                        this._remove(path);
                }));

        Gio.DBus.system.call(UPOWER, UPOWER_PATH, UPOWER, 'EnumerateDevices', null,
            new GLib.VariantType('(ao)'), Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (conn, res) => {
                try {
                    const [paths] = conn.call_finish(res).deep_unpack();
                    paths.forEach(path => this._add(path));
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`Ledge batteries: ${e.message}`);
                }
            });
    }

    _add(path) {
        if (this._devices.has(path) || path.endsWith('/DisplayDevice'))
            return;
        const entry = {proxy: null, ring: null, changedId: 0};
        this._devices.set(path, entry);
        Gio.DBusProxy.new(Gio.DBus.system, Gio.DBusProxyFlags.NONE, null,
            UPOWER, path, DEVICE_IFACE, this._cancellable, (_o, res) => {
                try {
                    entry.proxy = Gio.DBusProxy.new_finish(res);
                } catch (e) {
                    return;
                }
                if (this._devices.get(path) !== entry)
                    return;
                entry.changedId = entry.proxy.connect('g-properties-changed', () => this._sync(entry));
                this._sync(entry);
            });
    }

    _remove(path) {
        const entry = this._devices.get(path);
        if (!entry)
            return;
        this._devices.delete(path);
        if (entry.changedId)
            entry.proxy.disconnect(entry.changedId);
        entry.ring?.actor.destroy();
        this._syncVisible();
    }

    _sync(entry) {
        const prop = name => entry.proxy.get_cached_property(name)?.unpack();
        const type = prop('Type');
        const percentage = prop('Percentage') ?? 0;
        const present = type !== TYPE_BATTERY || prop('IsPresent');
        const shown = type !== TYPE_LINE_POWER && present && percentage > 0;

        if (!shown) {
            entry.ring?.actor.destroy();
            entry.ring = null;
        } else {
            if (!entry.ring) {
                entry.ring = new BatteryRing();
                if (type === TYPE_BATTERY)
                    this._row.insert_child_at_index(entry.ring.actor, 0);
                else
                    this._row.add_child(entry.ring.actor);
            }
            entry.ring.update(ICONS[type] ?? 'battery-symbolic', percentage, prop('State') === STATE_CHARGING);
        }
        this._syncVisible();
    }

    _syncVisible() {
        this.actor.visible = this._row.get_n_children() > 0;
    }

    destroy() {
        this._cancellable.cancel();
        this._subscriptions.forEach(id => Gio.DBus.system.signal_unsubscribe(id));
        for (const entry of this._devices.values()) {
            if (entry.changedId)
                entry.proxy.disconnect(entry.changedId);
        }
        this._devices.clear();
        this.actor.destroy();
    }
}
