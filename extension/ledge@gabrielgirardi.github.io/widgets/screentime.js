import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {timeLocale} from '../locale.js';
import {UsageTracker} from '../usage.js';
import {cardShell} from './card.js';

const TOP_APPS = 4;
const BAR_WIDTH = 96;
const CHART_HEIGHT = 52;

// The usage tracker keeps 30 days, so that is the longest range.
const RANGES = [
    {days: 1, label: () => _('Today')},
    {days: 7, label: () => _('7 days')},
    {days: 30, label: () => _('30 days')},
];

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1)
        return _('<1m');
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    /* Translators: hours and minutes, e.g. "3h 05m" */
    return h ? _('%dh %02dm').format(h, m) : _('%dm').format(m);
}

/**
 * Time in apps for today, the last 7 days, or the last 30. Longer ranges add
 * a daily average and one bar per day, so a heavy day stands out.
 */
export class ScreenTimeWidget {
    constructor() {
        this.actor = cardShell('preferences-system-time-symbolic', _('Screen Time').toUpperCase());

        this._tabs = new St.BoxLayout({style_class: 'ledge-segments', x_expand: true});
        this._tabs.layout_manager.homogeneous = true;
        this._buttons = RANGES.map(range => {
            const button = new St.Button({
                style_class: 'ledge-segment',
                label: range.label(),
                can_focus: true,
                x_expand: true,
                name: `ledge:usage-range:${range.days}`,
            });
            button.connect('clicked', () => this._show(range.days));
            this._tabs.add_child(button);
            return button;
        });
        this.actor.add_child(this._tabs);

        this._total = new St.Label({style_class: 'ledge-card-value', name: 'ledge:usage-total'});
        this._caption = new St.Label({style_class: 'ledge-card-sub', name: 'ledge:usage-caption'});
        this._chart = new St.BoxLayout({style_class: 'ledge-usage-chart', x_expand: true});
        this._chart.layout_manager.homogeneous = true;
        this._list = new St.BoxLayout({vertical: true, style_class: 'ledge-usage-list'});
        this.actor.add_child(this._total);
        this.actor.add_child(this._caption);
        this.actor.add_child(this._chart);
        this.actor.add_child(this._list);

        this._appSystem = Shell.AppSystem.get_default();
        this._tracker = new UsageTracker();
        this._days = 1;
        this._destroyed = false;
        // Older days only exist once the saved history is read.
        this._tracker.loaded.then(() => {
            if (!this._destroyed)
                this.refresh();
        });
        this.refresh();
    }

    _show(days) {
        this._days = days;
        this.refresh();
    }

    refresh() {
        this._buttons.forEach((button, i) => {
            if (RANGES[i].days === this._days)
                button.add_style_pseudo_class('checked');
            else
                button.remove_style_pseudo_class('checked');
        });

        const {apps, daily} = this._tracker.range(this._days);
        const total = apps.reduce((sum, a) => sum + a.seconds, 0);
        this._total.text = formatDuration(total);
        this._list.destroy_all_children();
        this._chart.destroy_all_children();

        const shown = apps.filter(a => a.seconds >= 60).slice(0, TOP_APPS);
        if (this._days === 1)
            this._caption.text = shown.length ? _('Today, in apps') : _('Nothing tracked yet today');
        else if (!shown.length)
            this._caption.text = _('Nothing tracked in this period');
        else
            /* Translators: average time in apps per day, e.g. "Average 3h 05m a day" */
            this._caption.text = _('Average %s a day').format(formatDuration(total / this._days));

        this._chart.visible = this._days > 1 && shown.length > 0;
        if (this._chart.visible)
            this._drawChart(daily);

        const max = shown[0]?.seconds ?? 1;
        for (const {appId, seconds} of shown)
            this._list.add_child(this._row(appId, seconds, max));
    }

    /** One bar per day, oldest first; weekday initials when there is room. */
    _drawChart(daily) {
        const max = Math.max(...daily.map(d => d.seconds), 1);
        const labelled = daily.length <= 7;
        const weekday = new Intl.DateTimeFormat(timeLocale(), {weekday: 'narrow'});
        daily.forEach(({date, seconds}, i) => {
            const column = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'ledge-usage-day'});
            const slot = new St.Bin({
                height: CHART_HEIGHT,
                x_expand: true,
                y_align: Clutter.ActorAlign.FILL,
                child: new St.Widget({
                    style_class: i === daily.length - 1 ? 'ledge-usage-bar ledge-usage-bar-today' : 'ledge-usage-bar',
                    // A sliver even for an empty day, so the axis reads as a row of days.
                    height: Math.max(2, Math.round(CHART_HEIGHT * seconds / max)),
                    x_expand: true,
                    y_expand: true,
                    y_align: Clutter.ActorAlign.END,
                }),
            });
            column.add_child(slot);
            if (labelled) {
                column.add_child(new St.Label({
                    text: weekday.format(date),
                    style_class: 'ledge-usage-day-label',
                    x_align: Clutter.ActorAlign.CENTER,
                }));
            }
            this._chart.add_child(column);
        });
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
        this._destroyed = true;
        this._tracker.destroy();
        this.actor.destroy();
    }
}
