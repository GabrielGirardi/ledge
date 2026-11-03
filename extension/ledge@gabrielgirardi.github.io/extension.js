import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Glass} from './glass.js';
import {timeLocale} from './locale.js';
import {AgendaWidget} from './widgets/agenda.js';
import {BatteriesWidget} from './widgets/batteries.js';
import {MediaWidget} from './widgets/media.js';
import {WeatherWidget} from './widgets/weather.js';

const BUS_PATH = '/io/github/gabrielgirardi/Ledge/Touchpad';
const BUS_IFACE = 'io.github.gabrielgirardi.Ledge.Touchpad1';
const DEV_IFACE = 'io.github.gabrielgirardi.Ledge.Dev1';

const PANEL_WIDTH = 380;
const PANEL_RADIUS = 26;
const MARGIN = 12;
const BLEED = 48;
const OPEN_DISTANCE = 0.35;
const FLING_VELOCITY = 1.2;
const SPRING_STIFFNESS = 320;
const SPRING_DAMPING_RATIO = 0.82;

const State = {CLOSED: 0, DRAGGING: 1, SETTLING: 2, OPEN: 3};

function rubberBand(p) {
    if (p > 1)
        return 1 + (1 - 1 / ((p - 1) * 4 + 1)) * 0.06;
    return Math.max(0, p);
}

class Ledge {
    constructor(settings) {
        this._settings = settings;
        this._state = State.CLOSED;
        this._progress = 0;
        this._grab = null;
        this._panelOrigin = [0, 0];
        this._layoutSide = settings.get_string('side');

        this._strip = new St.Widget({clip_to_allocation: true, reactive: false});
        this._panel = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'ledge-panel',
            reactive: true,
        });
        this._glass = new Glass(PANEL_RADIUS);
        this._panel.add_child(this._glass.actor);
        this._panel.add_child(new St.Widget({style_class: 'ledge-tint', x_expand: true, y_expand: true}));

        this._content = new St.BoxLayout({vertical: true, style_class: 'ledge-content', x_expand: true, y_expand: true});
        this._weekday = new St.Label({style_class: 'ledge-weekday'});
        this._date = new St.Label({style_class: 'ledge-date'});
        this._content.add_child(this._weekday);
        this._content.add_child(this._date);

        this._widgets = [
            new WeatherWidget(settings),
            new BatteriesWidget(),
            new AgendaWidget(),
            new MediaWidget(),
        ];
        this._widgets.forEach(w => this._content.add_child(w.actor));
        this._panel.add_child(this._content);

        this._strip.add_child(this._panel);
        Main.layoutManager.addTopChrome(this._strip);

        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._relayout());
        this._workareasId = global.display.connect('workareas-changed', () => this._relayout());
        this._settingsIds = [
            settings.connect('changed::side', () => {
                if (this._state === State.CLOSED)
                    this._relayout();
            }),
            settings.connect('changed::show-indicator', () => this._syncIndicator()),
        ];
        Main.wm.addKeybinding('toggle-shortcut', settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this.toggle());
        this._syncIndicator();
        this._signalIds = ['Begin', 'Update', 'End', 'Cancel'].map(name =>
            Gio.DBus.session.signal_subscribe(null, BUS_IFACE, name, BUS_PATH, null,
                Gio.DBusSignalFlags.NONE,
                (_c, _s, _p, _i, signal, params) => this[`_on${signal}`](...params.deep_unpack())));
        if (GLib.getenv('LEDGE_DEV'))
            this._subscribeDev();

        this._refreshDate();
        this._relayout();
    }

    destroy() {
        this._stopSpring();
        this._releaseInput();
        this._signalIds.forEach(id => Gio.DBus.session.signal_unsubscribe(id));
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        Main.wm.removeKeybinding('toggle-shortcut');
        this._indicator?.destroy();
        this._indicator = null;
        Main.layoutManager.disconnect(this._monitorsId);
        global.display.disconnect(this._workareasId);
        this._widgets.forEach(w => w.destroy());
        this._glass.destroy();
        Main.layoutManager.removeChrome(this._strip);
        this._strip.destroy();
    }

    _inward() {
        return this._layoutSide === 'right' ? -1 : 1;
    }

    _relayout() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const index = Main.layoutManager.primaryIndex;
        this._layoutSide = this._settings.get_string('side');
        const right = this._layoutSide === 'right';
        const wa = Main.layoutManager.getWorkAreaForMonitor(index);
        const stripWidth = PANEL_WIDTH + MARGIN + BLEED;
        const stripX = right ? wa.x + wa.width - stripWidth : wa.x;
        const panelX = right ? BLEED : MARGIN;
        this._strip.set_position(stripX, wa.y);
        this._strip.set_size(stripWidth, wa.height);
        this._panel.set_position(panelX, MARGIN);
        this._panel.set_width(PANEL_WIDTH);
        this._panelOrigin = [stripX + panelX - monitor.x, wa.y + MARGIN - monitor.y];
        this._hiddenOffset = PANEL_WIDTH + MARGIN + BLEED;
        this._glass.setMonitor(index);
        this._apply();
    }

    _refreshDate() {
        const now = new Date();
        const locale = timeLocale();
        this._weekday.text = now.toLocaleDateString(locale, {weekday: 'long'}).toUpperCase();
        this._date.text = now.toLocaleDateString(locale, {day: 'numeric', month: 'long'});
    }

    _syncIndicator() {
        const wanted = this._settings.get_boolean('show-indicator');
        if (wanted === Boolean(this._indicator))
            return;
        if (!wanted) {
            this._indicator.destroy();
            this._indicator = null;
            return;
        }
        this._indicator = new PanelMenu.Button(0.5, _('Today'), true);
        this._indicator.add_child(new St.Icon({
            icon_name: 'sidebar-show-right-symbolic',
            style_class: 'system-status-icon',
        }));
        this._indicator.connect('button-press-event', () => {
            this.toggle();
            return Clutter.EVENT_STOP;
        });
        this._indicator.connect('touch-event', (_a, event) => {
            if (event.type() === Clutter.EventType.TOUCH_BEGIN)
                this.toggle();
            return Clutter.EVENT_STOP;
        });
        Main.panel.addToStatusArea('ledge-indicator', this._indicator, 0, 'right');
    }

    toggle() {
        const opening = this._state === State.CLOSED ||
            (this._state === State.SETTLING && this._target === 0);
        if (!opening) {
            this._settle(0, 0);
            return;
        }
        this._open();
        this._settle(1, 0);
    }

    _open() {
        if (this._state === State.CLOSED) {
            if (this._layoutSide !== this._settings.get_string('side'))
                this._relayout();
            this._prepareOpen();
            this._cascadeCards();
        }
        this._grabInput();
    }

    _apply() {
        const p = this._progress;
        const offset = -this._inward() * (1 - p) * this._hiddenOffset;
        this._panel.translation_x = offset;
        this._glass.setOrigin(this._panelOrigin[0] + offset, this._panelOrigin[1]);
        this._panel.opacity = Math.round(255 * Math.min(1, Math.max(0, p * 5)));
        this._panel.visible = p > 0.002;
    }

    _prepareOpen() {
        this._refreshDate();
        this._widgets.forEach(w => w.refresh?.());
    }

    _cascadeCards() {
        this._widgets.map(w => w.actor).filter(a => a.visible).forEach((card, i) => {
            card.remove_all_transitions();
            card.opacity = 0;
            card.translation_y = 18;
            card.ease({
                opacity: 255,
                translation_y: 0,
                delay: 60 + i * 45,
                duration: 420,
                mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            });
        });
    }

    _grabInput() {
        if (this._grab)
            return;
        this._grab = Main.pushModal(this._panel, {actionMode: Shell.ActionMode.POPUP});
        this._capturedId = global.stage.connect('captured-event', (_a, e) => this._onCaptured(e));
    }

    _releaseInput() {
        if (!this._grab)
            return;
        global.stage.disconnect(this._capturedId);
        Main.popModal(this._grab);
        this._grab = null;
    }

    _onCaptured(event) {
        switch (event.type()) {
        case Clutter.EventType.SCROLL:
            return event.get_scroll_source() === Clutter.ScrollSource.FINGER
                ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        case Clutter.EventType.BUTTON_PRESS:
        case Clutter.EventType.TOUCH_BEGIN:
            if (this._panel.contains(global.stage.get_event_actor(event)))
                return Clutter.EVENT_PROPAGATE;
            this._settle(0, 0);
            return Clutter.EVENT_STOP;
        case Clutter.EventType.KEY_PRESS:
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._settle(0, 0);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _onBegin(edge) {
        if (this._state === State.CLOSED && edge !== this._settings.get_string('side'))
            return;
        this._open();
        this._stopSpring();
        this._dragOrigin = this._progress;
        this._state = State.DRAGGING;
    }

    _onUpdate(dx) {
        if (this._state !== State.DRAGGING)
            return;
        this._progress = rubberBand(this._dragOrigin + this._inward() * dx / OPEN_DISTANCE);
        this._apply();
    }

    _onEnd(_dx, vx) {
        if (this._state !== State.DRAGGING)
            return;
        const v = this._inward() * vx / OPEN_DISTANCE;
        let target;
        if (v > FLING_VELOCITY)
            target = 1;
        else if (v < -FLING_VELOCITY)
            target = 0;
        else
            target = this._progress > 0.5 ? 1 : 0;
        this._settle(target, v);
    }

    _onCancel() {
        if (this._state === State.DRAGGING)
            this._settle(this._progress > 0.5 ? 1 : 0, 0);
    }

    _settle(target, velocity) {
        this._stopSpring();
        this._state = State.SETTLING;
        this._target = target;

        const k = SPRING_STIFFNESS;
        const c = 2 * Math.sqrt(k) * SPRING_DAMPING_RATIO;
        let x = this._progress;
        let v = velocity;
        let last = null;

        this._spring = new Clutter.Timeline({actor: this._strip, duration: 2000});
        this._spring.connect('new-frame', (_tl, msecs) => {
            const dt = Math.min(last === null ? 1 / 60 : (msecs - last) / 1000, 0.05);
            last = msecs;
            const steps = Math.max(1, Math.ceil(dt / 0.004));
            const h = dt / steps;
            for (let i = 0; i < steps; i++) {
                v += (-k * (x - target) - c * v) * h;
                x += v * h;
            }
            this._progress = Math.max(0, x);
            this._apply();
            if (Math.abs(x - target) < 0.0015 && Math.abs(v) < 0.02)
                this._finish(target);
        });
        this._spring.connect('completed', () => this._finish(target));
        this._spring.start();
    }

    _stopSpring() {
        if (!this._spring)
            return;
        const spring = this._spring;
        this._spring = null;
        spring.stop();
    }

    _finish(target) {
        if (this._state !== State.SETTLING)
            return;
        this._stopSpring();
        this._progress = target;
        this._apply();
        this._state = target ? State.OPEN : State.CLOSED;
        if (!target) {
            this._releaseInput();
            if (this._layoutSide !== this._settings.get_string('side'))
                this._relayout();
        }
    }

    // Development hooks, enabled only with LEDGE_DEV set (scripts/nested.sh):
    // Show(d progress) pins the panel at a progress; Shot(s path) saves a PNG of the stage.
    _subscribeDev() {
        const sub = (name, handler) => Gio.DBus.session.signal_subscribe(null, DEV_IFACE, name, BUS_PATH,
            null, Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _n, params) => handler(...params.deep_unpack()));
        this._signalIds.push(
            sub('Show', p => {
                this._stopSpring();
                if (p > 0 && this._state === State.CLOSED)
                    this._prepareOpen();
                this._progress = p;
                this._state = p > 0 ? State.OPEN : State.CLOSED;
                this._apply();
            }),
            sub('Shot', path => this._shot(path).catch(logError)),
            sub('Toggle', () => this.toggle()),
            sub('Dump', () => {
                for (const actor of [this._strip, this._panel, ...this._panel.get_children()]) {
                    const box = actor.get_allocation_box();
                    console.log(`ledge-dump ${actor.constructor.name}.${actor.style_class ?? ''} ` +
                        `box=${box.x1},${box.y1} ${box.get_width()}x${box.get_height()} visible=${actor.visible} ` +
                        `opacity=${actor.opacity} effects=${actor.get_effects().map(e => e.constructor.name)}`);
                }
            }));
    }

    async _shot(path) {
        const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
    }
}

export default class LedgeExtension extends Extension {
    enable() {
        this._ledge = new Ledge(this.getSettings());
    }

    disable() {
        this._ledge.destroy();
        this._ledge = null;
    }
}
