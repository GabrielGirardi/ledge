import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {formatTime} from '../locale.js';
import {cardShell} from './card.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 3;

function isAllDay(event) {
    return event.date.getHours() === 0 && event.date.getMinutes() === 0 &&
        (event.end - event.date) % DAY_MS === 0 && event.end > event.date;
}

export class AgendaWidget {
    constructor() {
        this.actor = cardShell('x-office-calendar-symbolic', _('Calendar').toUpperCase());
        this._list = new St.BoxLayout({vertical: true, style_class: 'ledge-agenda'});
        this.actor.add_child(this._list);

        this._source = new Calendar.DBusEventSource();
        this._changedId = this._source.connect('changed', () => this._render());
        this.refresh();
    }

    refresh() {
        const now = new Date();
        const begin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        this._range = [begin, new Date(begin.getTime() + 2 * DAY_MS)];
        this._source.requestRange(...this._range);
        this._render();
    }

    _render() {
        this._list.destroy_all_children();
        const [begin, end] = this._range;
        const now = new Date();
        const tomorrow = new Date(begin.getTime() + DAY_MS);
        // An invitation that lives in two calendars (say, personal and work)
        // arrives twice with different ids; show it once.
        const seen = new Set();
        const upcoming = this._source.getEvents(begin, end).filter(e => {
            const key = `${e.summary}\u0000${e.date.getTime()}\u0000${e.end.getTime()}`;
            if (e.end <= now || seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
        const today = upcoming.filter(e => e.date < tomorrow).slice(0, MAX_EVENTS);

        if (today.length) {
            today.forEach(e => this._list.add_child(this._row(e, now, false)));
            return;
        }
        this._list.add_child(new St.Label({text: _('Nothing else today'), style_class: 'ledge-agenda-empty'}));
        if (upcoming.length)
            this._list.add_child(this._row(upcoming[0], now, true));
    }

    _row(event, now, isTomorrow) {
        const row = new St.BoxLayout({style_class: 'ledge-event'});
        const ongoing = event.date <= now;
        row.add_child(new St.Widget({
            style_class: ongoing ? 'ledge-event-bar ledge-event-bar-now' : 'ledge-event-bar',
            y_expand: true,
        }));
        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const title = new St.Label({text: event.summary, style_class: 'ledge-event-title'});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        let when;
        if (isAllDay(event))
            when = _('All day');
        else if (ongoing)
            /* Translators: an event happening now; %s is its end time */
            when = _('Now · until %s').format(formatTime(event.end));
        else
            /* Translators: event start and end times */
            when = _('%s – %s').format(formatTime(event.date), formatTime(event.end));
        if (isTomorrow)
            /* Translators: %s is the event time, e.g. "Tomorrow · 09:30 – 10:00" */
            when = _('Tomorrow · %s').format(when);

        text.add_child(title);
        text.add_child(new St.Label({text: when, style_class: 'ledge-event-time'}));
        row.add_child(text);
        return row;
    }

    destroy() {
        this._source.disconnect(this._changedId);
        this._source.destroy();
        this.actor.destroy();
    }
}
