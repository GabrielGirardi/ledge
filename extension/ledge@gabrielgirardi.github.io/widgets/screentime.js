import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {UsageTracker} from '../usage.js';
import {cardShell} from './card.js';

const TOP_APPS = 4;
const BAR_WIDTH = 96;

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1)
        return _('<1m');
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    /* Translators: hours and minutes, e.g. "3h 05m" */
    return h ? _('%dh %02dm').format(h, m) : _('%dm').format(m);
}

export class ScreenTimeWidget {
    constructor() {
        this.actor = cardShell('preferences-system-time-symbolic', _('Screen Time').toUpperCase());
        this._total = new St.Label({style_class: 'ledge-card-value'});
        this._caption = new St.Label({style_class: 'ledge-card-sub', text: _('Today, in apps')});
        this._list = new St.BoxLayout({vertical: true, style_class: 'ledge-usage-list'});
        this.actor.add_child(this._total);
        this.actor.add_child(this._caption);
        this.actor.add_child(this._list);

        this._appSystem = Shell.AppSystem.get_default();
        this._tracker = new UsageTracker();
        this.refresh();
    }

    refresh() {
        const apps = this._tracker.today();
        const total = apps.reduce((sum, a) => sum + a.seconds, 0);
        this._total.text = formatDuration(total);
        this._list.destroy_all_children();

        const shown = apps.filter(a => a.seconds >= 60).slice(0, TOP_APPS);
        this._caption.text = shown.length ? _('Today, in apps') : _('Nothing tracked yet today');
        const max = shown[0]?.seconds ?? 1;
        for (const {appId, seconds} of shown)
            this._list.add_child(this._row(appId, seconds, max));
    }

    _row(appId, seconds, max) {
        const app = this._appSystem.lookup_app(appId);
        const row = new St.BoxLayout({style_class: 'ledge-usage-row'});
        row.add_child(app?.create_icon_texture(20) ?? new St.Icon({icon_name: 'application-x-executable-symbolic', icon_size: 20}));

        const name = new St.Label({
            text: app?.get_name() ?? appId.replace(/\.desktop$/, ''),
            style_class: 'ledge-usage-name',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        row.add_child(name);

        const track = new St.Widget({style_class: 'ledge-usage-track', width: BAR_WIDTH, y_align: Clutter.ActorAlign.CENTER});
        track.add_child(new St.Widget({
            style_class: 'ledge-usage-fill',
            width: Math.max(4, Math.round(BAR_WIDTH * seconds / max)),
        }));
        row.add_child(track);
        row.add_child(new St.Label({
            text: formatDuration(seconds),
            style_class: 'ledge-usage-time',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        return row;
    }

    destroy() {
        this._tracker.destroy();
        this.actor.destroy();
    }
}
