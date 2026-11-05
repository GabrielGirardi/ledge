import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {EditMode} from './editMode.js';
import {Glass} from './glass.js';
import {timeLocale} from './locale.js';
import {AgendaWidget} from './widgets/agenda.js';
import {BatteriesWidget} from './widgets/batteries.js';
import {MediaWidget} from './widgets/media.js';
import {ScreenTimeWidget} from './widgets/screentime.js';
import {TodoWidget} from './widgets/todo.js';
import {WeatherWidget} from './widgets/weather.js';
import {shownWidgets} from './widgets/catalog.js';

const FACTORIES = {
    'weather': settings => new WeatherWidget(settings),
    'batteries': () => new BatteriesWidget(),
    'calendar': () => new AgendaWidget(),
    'todo': () => new TodoWidget(),
    'screen-time': () => new ScreenTimeWidget(),
    'media': () => new MediaWidget(),
};

const BUS_PATH = '/io/github/gabrielgirardi/Ledge/Touchpad';
const BUS_IFACE = 'io.github.gabrielgirardi.Ledge.Touchpad1';
const DEV_IFACE = 'io.github.gabrielgirardi.Ledge.Dev1';
const DEV_QUERY_PATH = '/io/github/gabrielgirardi/Ledge/Dev';
const DEV_QUERY_XML = `<node>
  <interface name="io.github.gabrielgirardi.Ledge.DevQuery1">
    <method name="GetState"><arg type="s" direction="out" name="json"/></method>
    <method name="Pick">
      <arg type="i" direction="in" name="x"/><arg type="i" direction="in" name="y"/>
      <arg type="s" direction="out" name="chain"/>
    </method>
  </interface>
</node>`;

const PANEL_WIDTH = 380;
const PANEL_RADIUS = 26;
const MARGIN = 12;
const BLEED = 48;
const OPEN_DISTANCE = 0.35;
const FLING_VELOCITY = 1.2;
const SPRING_STIFFNESS = 320;
const SPRING_DAMPING_RATIO = 0.82;

const HOT_EDGE_PRESSURE = 150;
const HOT_EDGE_TIMEOUT_MS = 1000;
const HOT_EDGE_INSET = 48;
const BUTTONS_MASK = Clutter.ModifierType.BUTTON1_MASK | Clutter.ModifierType.BUTTON2_MASK |
    Clutter.ModifierType.BUTTON3_MASK;

const State = {CLOSED: 0, DRAGGING: 1, SETTLING: 2, OPEN: 3};

function rubberBand(p) {
    if (p > 1)
        return 1 + (1 - 1 / ((p - 1) * 4 + 1)) * 0.06;
    return Math.max(0, p);
}

class Ledge {
    constructor(extension) {
        const settings = extension.getSettings();
        this._extension = extension;
        this._settings = settings;
        this._monitorIndex = Main.layoutManager.primaryIndex;
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

        // GNOME 46's scroll view reports a horizontal page narrower than the
        // view (it reserves room for a vertical scrollbar), and a scrolled box
        // clips picking to that page, so the right ~38 px of every row ignored
        // clicks while still painting. Clip on the scroll view's real
        // allocation instead.
        this._content = new St.BoxLayout({
            vertical: true,
            style_class: 'ledge-content',
            x_expand: true,
            clip_to_view: false,
        });
        this._scroll = new St.ScrollView({
            style_class: 'ledge-scroll vfade',
            clip_to_allocation: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            // Scroll with the wheel or touchpad; the fade shows there is more.
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            x_expand: true,
            y_expand: true,
        });
        const header = new St.BoxLayout({style_class: 'ledge-header'});
        const heading = new St.BoxLayout({vertical: true, x_expand: true});
        this._weekday = new St.Label({style_class: 'ledge-weekday'});
        this._date = new St.Label({style_class: 'ledge-date', name: 'ledge:date'});
        heading.add_child(this._weekday);
        heading.add_child(this._date);
        const settingsButton = new St.Button({
            style_class: 'ledge-header-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.START,
            child: new St.Icon({icon_name: 'emblem-system-symbolic'}),
            accessible_name: _('Settings'),
            name: 'ledge:gear',
        });
        settingsButton.connect('clicked', () => {
            this._closeNow();
            this._extension.openPreferences();
        });
        const editButton = new St.Button({
            style_class: 'ledge-header-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.START,
            child: new St.Icon({icon_name: 'document-edit-symbolic'}),
            accessible_name: _('Edit widgets'),
            name: 'ledge:edit',
        });
        const doneButton = new St.Button({
            style_class: 'ledge-done-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.START,
            label: _('Done'),
            name: 'ledge:edit-done',
            visible: false,
        });
        header.add_child(heading);
        header.add_child(editButton);
        header.add_child(settingsButton);
        header.add_child(doneButton);
        this._content.add_child(header);

        this._edit = new EditMode(settings, this._content, () => {
            editButton.visible = !this._edit.active;
            settingsButton.visible = !this._edit.active;
            doneButton.visible = this._edit.active;
        });
        editButton.connect('clicked', () => this._edit.enter());
        doneButton.connect('clicked', () => this._edit.exit());

        this._widgetById = new Map();
        this._widgets = [];
        this._syncWidgets();
        this._scroll.child = this._content;
        this._panel.add_child(this._scroll);

        this._strip.add_child(this._panel);
        Main.layoutManager.addTopChrome(this._strip);

        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
            // The monitor the panel is on may be gone; start over on the primary.
            this._closeNow();
            this._monitorIndex = Main.layoutManager.primaryIndex;
            this._relayout();
            this._syncHotEdge();
        });
        this._workareasId = global.display.connect('workareas-changed', () => {
            if (this._state === State.CLOSED)
                this._relayout();
        });

        this._settingsIds = [
            settings.connect('changed::side', () => {
                if (this._state === State.CLOSED)
                    this._relayout();
                this._syncHotEdge();
            }),
            settings.connect('changed::hot-edge', () => this._syncHotEdge()),
            settings.connect('changed::widgets', () => this._syncWidgets()),
            settings.connect('changed::show-indicator', () => this._syncIndicator()),
        ];
        Main.wm.addKeybinding('toggle-shortcut', settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this.toggle('focus'));
        this._syncIndicator();
        this._syncHotEdge();
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
        this._devQuery?.unexport();
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        Main.wm.removeKeybinding('toggle-shortcut');
        this._indicator?.destroy();
        this._indicator = null;
        this._removeHotEdge();
        Main.layoutManager.disconnect(this._monitorsId);
        global.display.disconnect(this._workareasId);
        this._edit.destroy();
        this._widgetById.forEach(w => w.destroy());
        this._widgetById.clear();
        this._glass.destroy();
        Main.layoutManager.removeChrome(this._strip);
        this._strip.destroy();
    }

    /**
     * Makes the panel's widgets match the `widgets` setting: creates the ones
     * that were added, destroys the ones that were removed (so a hidden widget
     * costs nothing), and reorders the rest without rebuilding them.
     */
    _syncWidgets() {
        const order = shownWidgets(this._settings);
        for (const [id, widget] of this._widgetById) {
            if (!order.includes(id)) {
                widget.destroy();
                this._widgetById.delete(id);
            }
        }
        this._widgets = order.map((id, i) => {
            let widget = this._widgetById.get(id);
            if (!widget) {
                widget = FACTORIES[id](this._settings);
                widget.actor.name = `ledge:card:${id}`;
                this._widgetById.set(id, widget);
                this._content.add_child(widget.actor);
            }
            // Index 0 is the date header.
            this._content.set_child_at_index(widget.actor, i + 1);
            return widget;
        });
        this._edit?.refresh();
    }

    _inward() {
        return this._layoutSide === 'right' ? -1 : 1;
    }

    _relayout() {
        const monitors = Main.layoutManager.monitors;
        if (!monitors[this._monitorIndex])
            this._monitorIndex = Main.layoutManager.primaryIndex;
        const index = this._monitorIndex;
        const monitor = monitors[index];
        if (!monitor)
            return;
        this._layoutSide = this._settings.get_string('side');
        const right = this._layoutSide === 'right';
        const wa = Main.layoutManager.getWorkAreaForMonitor(index);
        const [top, bottom] = this._verticalRoom(monitor, wa);
        const stripWidth = PANEL_WIDTH + MARGIN + BLEED;
        const stripX = right ? wa.x + wa.width - stripWidth : wa.x;
        const panelX = right ? BLEED : MARGIN;
        this._strip.set_position(stripX, top);
        this._strip.set_size(stripWidth, bottom - top);
        this._panel.set_position(panelX, MARGIN);
        this._panel.set_width(PANEL_WIDTH);
        // Taller than the room available: cap the panel and let the content scroll.
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._panel.style = `max-height: ${Math.floor((bottom - top - 2 * MARGIN) / scale)}px;`;
        this._panelOrigin = [stripX + panelX - monitor.x, top + MARGIN - monitor.y];
        this._hiddenOffset = PANEL_WIDTH + MARGIN + BLEED;
        this._glass.setMonitor(index);
        this._apply();
    }

    /**
     * The work area, minus GNOME's panel wherever it actually is. Bars that
     * auto-hide (Zorin Taskbar, Dash to Panel) reserve no work-area space, so
     * the work area alone would put the sidebar underneath them.
     */
    _verticalRoom(monitor, wa) {
        let top = wa.y;
        let bottom = wa.y + wa.height;
        const bar = Main.panel;
        if (!bar.mapped)
            return [top, bottom];
        const [x, y] = bar.get_transformed_position();
        const [w, h] = bar.get_transformed_size();
        const onMonitor = x < monitor.x + monitor.width && x + w > monitor.x &&
            y < monitor.y + monitor.height && y + h > monitor.y;
        if (onMonitor && h > 0) {
            if (y + h / 2 < monitor.y + monitor.height / 2)
                top = Math.max(top, y + h);
            else
                bottom = Math.min(bottom, y);
        }
        return [top, bottom];
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
            this.toggle('pointer');
            return Clutter.EVENT_STOP;
        });
        this._indicator.connect('touch-event', (_a, event) => {
            if (event.type() === Clutter.EventType.TOUCH_BEGIN)
                this.toggle('pointer');
            return Clutter.EVENT_STOP;
        });
        Main.panel.addToStatusArea('ledge-indicator', this._indicator, 0, 'right');
    }

    /**
     * @param {'pointer'|'focus'} where - the monitor under the pointer (gesture,
     *   button), or the one holding the focused window (keyboard shortcut).
     */
    /**
     * A pressure barrier on the configured edge of every monitor whose edge is
     * the edge of the whole screen. Pushing the pointer against it opens the
     * panel, like a hot corner. Edges shared with another monitor get no
     * barrier, so the pointer can still cross between screens.
     */
    _syncHotEdge() {
        this._removeHotEdge();
        if (!this._settings.get_boolean('hot-edge'))
            return;
        const right = this._settings.get_string('side') === 'right';
        const monitors = Main.layoutManager.monitors;
        this._pressure = new Layout.PressureBarrier(HOT_EDGE_PRESSURE, HOT_EDGE_TIMEOUT_MS,
            Shell.ActionMode.NORMAL);
        this._pressure.setEventFilter(event => {
            // Ignore drags, and fullscreen apps such as games and video.
            const [, , mods] = global.get_pointer();
            const index = global.display.get_monitor_index_for_rect(
                new Mtk.Rectangle({x: Math.round(event.x), y: Math.round(event.y), width: 1, height: 1}));
            return (mods & BUTTONS_MASK) !== 0 || Boolean(monitors[index]?.inFullscreen);
        });
        this._pressure.connect('trigger', () => {
            if (this._state === State.CLOSED)
                this.toggle('pointer');
        });
        this._barriers = [];
        for (const m of monitors) {
            const x = right ? m.x + m.width : m.x;
            const shared = monitors.some(o => o !== m &&
                (right ? o.x === x : o.x + o.width === x) &&
                o.y < m.y + m.height && o.y + o.height > m.y);
            if (shared || m.height <= 2 * HOT_EDGE_INSET)
                continue;
            const barrier = new Meta.Barrier({
                backend: global.backend,
                x1: x, y1: m.y + HOT_EDGE_INSET,
                x2: x, y2: m.y + m.height - HOT_EDGE_INSET,
                directions: right ? Meta.BarrierDirection.NEGATIVE_X : Meta.BarrierDirection.POSITIVE_X,
            });
            this._pressure.addBarrier(barrier);
            this._barriers.push(barrier);
        }
    }

    _removeHotEdge() {
        if (!this._pressure)
            return;
        this._pressure.destroy();
        this._barriers.forEach(b => b.destroy());
        this._barriers = [];
        this._pressure = null;
    }

    toggle(where = 'pointer') {
        const opening = this._state === State.CLOSED ||
            (this._state === State.SETTLING && this._target === 0);
        if (!opening) {
            this._settle(0, 0);
            return;
        }
        this._open(where);
        this._settle(1, 0);
    }

    _activeMonitor(where) {
        const pointer = global.display.get_current_monitor();
        if (where === 'focus')
            return global.display.focus_window?.get_monitor() ?? pointer;
        return pointer;
    }

    _open(where) {
        if (this._state === State.CLOSED) {
            this._monitorIndex = this._activeMonitor(where);
            // Bars move and auto-hide, so measure the room on every open.
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
        // While grabbed, Clutter delivers every event (including clicks outside
        // the panel) to the grab actor's subtree only; the stage never sees them.
        this._capturedId = this._panel.connect('captured-event', (_a, e) => this._onCaptured(e));
    }

    _releaseInput() {
        if (!this._grab)
            return;
        this._panel.disconnect(this._capturedId);
        Main.popModal(this._grab);
        this._grab = null;
    }

    _onCaptured(event) {
        const edited = this._edit.handleEvent(event);
        if (edited !== undefined)
            return edited;
        switch (event.type()) {
        case Clutter.EventType.SCROLL:
            // Over the panel, scrolling scrolls the widgets. Elsewhere it is
            // swallowed so the window underneath does not move.
            return this._panel.contains(global.stage.get_event_actor(event))
                ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
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
        this._open('pointer');
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

    /** Closes without animation, for when the panel must not linger. */
    _closeNow() {
        if (this._state === State.CLOSED)
            return;
        this._stopSpring();
        this._progress = 0;
        this._state = State.CLOSED;
        this._apply();
        this._releaseInput();
        this._edit.exit();
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
            this._edit.exit();
            if (this._layoutSide !== this._settings.get_string('side'))
                this._relayout();
        }
    }

    // Development hooks, enabled only with LEDGE_DEV set (scripts/nested.sh):
    // Show(d progress) pins the panel at a progress; Shot(s path) saves a PNG of the stage.
    _subscribeDev() {
        // Queries for automated tests (tests/ui): state, and where every actor
        // named "ledge:*" is, so tests click by name rather than by pixel.
        this._devQuery = Gio.DBusExportedObject.wrapJSObject(DEV_QUERY_XML, {
            GetState: () => JSON.stringify(this._devState()),
            Pick: (x, y) => this._devPick(x, y),
        });
        this._devQuery.export(Gio.DBus.session, DEV_QUERY_PATH);

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
            sub('Toggle', () => this.toggle('pointer')),
            sub('Pick', (x, y) => {
                const chain = [];
                for (let a = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y); a; a = a.get_parent())
                    chain.push(`${a.constructor.name}${a.style_class ? `.${a.style_class}` : ''}`);
                console.log(`ledge-pick ${x},${y}: ${chain.slice(0, 6).join(' < ')}`);
            }),
            sub('Push', (dx, steps) => {
                const seat = Clutter.get_default_backend().get_default_seat();
                this._devPointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
                let i = 0;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                    this._devPointer.notify_relative_motion(GLib.get_monotonic_time(), dx, 0);
                    return ++i < steps ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
                });
            }),
            sub('Drag', (x, y, dy, steps) => {
                // Press at (x, y), move dy pixels over `steps` frames, release.
                const seat = Clutter.get_default_backend().get_default_seat();
                this._devPointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
                seat.warp_pointer(x, y);
                let i = -10; // let the warp land before pressing
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                    const t = GLib.get_monotonic_time();
                    if (i < 0)
                        ; // waiting
                    else if (i === 0)
                        this._devPointer.notify_button(t, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
                    else if (i <= steps)
                        this._devPointer.notify_relative_motion(t, 0, dy / steps);
                    else
                        this._devPointer.notify_button(t, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
                    return ++i <= steps + 1 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
                });
            }),
            sub('Warp', (x, y) => Clutter.get_default_backend().get_default_seat().warp_pointer(x, y)),
            sub('State', () => console.log(`ledge-state ${Object.keys(State)[this._state]} monitor=${this._monitorIndex} ` +
                `strip=${this._strip.x},${this._strip.y} ` +
                `progress=${this._progress.toFixed(3)} grab=${Boolean(this._grab)} ` +
                `focus=${global.stage.get_key_focus()?.constructor.name ?? 'none'}`)),
            sub('Click', (x, y) => {
                const seat = Clutter.get_default_backend().get_default_seat();
                this._devPointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
                seat.warp_pointer(x, y);
                // The button must land after the motion has been processed.
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    const t = GLib.get_monotonic_time();
                    this._devPointer.notify_button(t, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
                    this._devPointer.notify_button(t + 1000, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
                    return GLib.SOURCE_REMOVE;
                });
            }),
            sub('Scroll', (x, y, steps) => {
                const seat = Clutter.get_default_backend().get_default_seat();
                this._devPointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
                seat.warp_pointer(x, y);
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    for (let i = 0; i < Math.abs(steps); i++) {
                        this._devPointer.notify_discrete_scroll(GLib.get_monotonic_time() + i * 1000,
                            steps > 0 ? Clutter.ScrollDirection.DOWN : Clutter.ScrollDirection.UP,
                            Clutter.ScrollSource.WHEEL);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }),
            sub('Key', keyval => {
                const seat = Clutter.get_default_backend().get_default_seat();
                this._devKeyboard ??= seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
                const t = GLib.get_monotonic_time();
                this._devKeyboard.notify_keyval(t, keyval, Clutter.KeyState.PRESSED);
                this._devKeyboard.notify_keyval(t + 1000, keyval, Clutter.KeyState.RELEASED);
            }),
            sub('Type', text => {
                const seat = Clutter.get_default_backend().get_default_seat();
                this._devKeyboard ??= seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
                let t = GLib.get_monotonic_time();
                for (const ch of text) {
                    const keyval = ch === '\n' ? Clutter.KEY_Return : Clutter.unicode_to_keysym(ch.codePointAt(0));
                    this._devKeyboard.notify_keyval(t += 1000, keyval, Clutter.KeyState.PRESSED);
                    this._devKeyboard.notify_keyval(t += 1000, keyval, Clutter.KeyState.RELEASED);
                }
            }),
            sub('Dump', () => {
                for (const actor of [this._strip, this._panel, ...this._panel.get_children()]) {
                    const box = actor.get_allocation_box();
                    console.log(`ledge-dump ${actor.constructor.name}.${actor.style_class ?? ''} ` +
                        `box=${box.x1},${box.y1} ${box.get_width()}x${box.get_height()} visible=${actor.visible} ` +
                        `opacity=${actor.opacity} effects=${actor.get_effects().map(e => e.constructor.name)}`);
                }
            }));
    }

    _devState() {
        const targets = {};
        const walk = actor => {
            if (actor.name?.startsWith('ledge:') && actor.mapped) {
                const e = actor.get_transformed_extents();
                targets[actor.name.slice(6)] = [Math.round(e.get_x() + e.get_width() / 2),
                    Math.round(e.get_y() + e.get_height() / 2), Math.round(e.get_width()), Math.round(e.get_height())];
            }
            actor.get_children().forEach(walk);
        };
        walk(this._strip);
        return {
            state: Object.keys(State)[this._state],
            progress: this._progress,
            monitor: this._monitorIndex,
            side: this._layoutSide,
            grab: Boolean(this._grab),
            focus: global.stage.get_key_focus()?.constructor.name ?? null,
            hotEdges: this._barriers?.length ?? 0,
            widgets: this._widgets.map(w => w.actor.name.slice('ledge:card:'.length)),
            editing: this._edit.active,
            pointer: global.get_pointer().slice(0, 2),
            targets,
        };
    }

    _devPick(x, y) {
        const chain = [];
        for (let a = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y); a; a = a.get_parent())
            chain.push(a.name || `${a.constructor.name}${a.style_class ? `.${a.style_class}` : ''}`);
        return chain.join(' < ');
    }

    async _shot(path) {
        const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
    }
}

export default class LedgeExtension extends Extension {
    enable() {
        this._ledge = new Ledge(this);
    }

    disable() {
        this._ledge.destroy();
        this._ledge = null;
    }
}
