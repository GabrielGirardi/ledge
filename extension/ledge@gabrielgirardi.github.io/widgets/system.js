import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {share, SystemSampler} from '../sysstats.js';
import {cardShell} from './card.js';
import {Ring} from './ring.js';

const EVERY_S = 2;
const BLUE = [0.04, 0.52, 1];
// Above this, a ring turns red: the machine is about to feel slow, or the
// disk is about to fill up.
const HIGH = 0.9;
// Below this share of the whole machine, no app is "busy"; the app holding
// the most memory is named instead.
const BUSY_CPU = 0.03;

const percent = fraction => `${Math.round(fraction * 100)}%`;

/**
 * CPU, memory, and disk use, and the app weighing on the machine the most,
 * so a slow moment has an answer without opening System Monitor. Reads only
 * while the panel is open.
 */
export class SystemWidget {
    constructor() {
        this.actor = cardShell('computer-symbolic', _('System').toUpperCase());

        const row = new St.BoxLayout({style_class: 'ledge-battery-row', x_expand: true});
        row.layout_manager.homogeneous = true;
        this._cpu = new Ring({color: BLUE, name: 'ledge:system-cpu'});
        this._memory = new Ring({color: BLUE, name: 'ledge:system-memory'});
        this._disk = new Ring({color: BLUE, name: 'ledge:system-disk'});
        [this._cpu, this._memory, this._disk].forEach(ring => row.add_child(ring.actor));
        this.actor.add_child(row);

        this._app = new St.BoxLayout({style_class: 'ledge-usage-row', visible: false});
        this._appIcon = new St.Bin();
        this._appName = new St.Label({
            style_class: 'ledge-usage-name',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            name: 'ledge:system-app',
        });
        this._appName.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._appUse = new St.Label({style_class: 'ledge-usage-time', y_align: Clutter.ActorAlign.CENTER});
        this._app.add_child(this._appIcon);
        this._app.add_child(this._appName);
        this._app.add_child(this._appUse);
        this._appCaption = new St.Label({style_class: 'ledge-card-sub ledge-system-caption', name: 'ledge:system-caption'});
        this.actor.add_child(this._appCaption);
        this.actor.add_child(this._app);

        this._appSystem = Shell.AppSystem.get_default();
        this._sampler = new SystemSampler();
        this._cancellable = new Gio.Cancellable();
        this._sourceId = 0;
        this._show({cpu: null, memory: {used: 0, total: 0}, disk: {used: 0, total: 0}, apps: []});
        this.actor.connect('notify::mapped', () => (this.actor.mapped ? this._start() : this._stop()));
    }

    _start() {
        if (this._sourceId)
            return;
        this._tick();
        this._sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, EVERY_S, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stop() {
        if (this._sourceId)
            GLib.source_remove(this._sourceId);
        this._sourceId = 0;
    }

    _tick() {
        this._sampler.sample(this._cancellable).then(s => this._show(s)).catch(e => {
            if (!this._cancellable.is_cancelled())
                console.warn(`Ledge system: ${e.message}`);
        });
    }

    _show({cpu, memory, disk, apps}) {
        this._cpu.update({
            value: cpu === null ? '–' : percent(cpu),
            fraction: cpu ?? 0,
            label: _('CPU'),
            alert: cpu > HIGH,
        });
        this._memory.update({
            value: percent(share(memory)),
            fraction: share(memory),
            label: _('Memory'),
            alert: share(memory) > HIGH,
        });
        this._disk.update({
            value: percent(share(disk)),
            fraction: share(disk),
            label: _('Disk'),
            alert: share(disk) > HIGH,
        });
        this._showApp(apps);
    }

    _showApp(apps) {
        const known = apps.map(a => ({...a, app: this._appSystem.lookup_app(a.appId)})).filter(a => a.app);
        const byCpu = known.filter(a => a.cpu >= BUSY_CPU).sort((a, b) => b.cpu - a.cpu)[0];
        const top = byCpu ?? known.sort((a, b) => b.memory - a.memory)[0];
        this._app.visible = this._appCaption.visible = Boolean(top);
        if (!top)
            return;
        this._appCaption.text = byCpu ? _('Busiest app right now') : _('App using the most memory');
        this._appIcon.child = top.app.create_icon_texture(20);
        this._appName.text = top.app.get_name();
        /* Translators: what the busiest app uses, e.g. "12% CPU · 1.2 GB" */
        this._appUse.text = byCpu
            ? _('%s CPU · %s').format(percent(top.cpu), GLib.format_size(top.memory))
            : GLib.format_size(top.memory);
    }

    destroy() {
        this._stop();
        this._cancellable.cancel();
        this.actor.destroy();
    }
}
