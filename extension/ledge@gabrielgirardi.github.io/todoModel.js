import GLib from 'gi://GLib';

import {JsonStore} from './store.js';

// Reminders are checked at least this often, so one still fires on time
// after the machine wakes from suspend.
const CHECK_EVERY_S = 30;
// Ledge is off while the screen is locked and before login, so reminders can
// come due unseen. Those from the last day still notify when it is back;
// older ones only show as overdue on the card.
const LATE_LIMIT_MS = 24 * 60 * 60 * 1000;

/**
 * The to-do list and its reminders. It lives as long as Ledge is enabled, not
 * as long as the To-do card: hiding the card must not silence a reminder.
 * The card renders it; `notify(item)` is called once when a reminder is due.
 */
export class TodoModel {
    constructor({notify}) {
        this.items = [];
        this._notify = notify;
        this._listeners = new Set();
        this._dueId = 0;
        this._store = new JsonStore('todo.json');
        this._store.load({items: []}).then(data => {
            if (!this._store)
                return;
            // Keep anything added while the file was still loading.
            const saved = Array.isArray(data.items) ? data.items : [];
            const stale = Date.now() - LATE_LIMIT_MS;
            saved.filter(i => i.at < stale).forEach(i => (i.notified = true));
            this.items = [...saved, ...this.items];
            this._changed();
        });
        this._checkId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CHECK_EVERY_S, () => {
            this._remind();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /** Calls `listener()` after every change; returns a function that stops it. */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    /** `at` is a reminder time in milliseconds since the epoch, or null. */
    add(text, at = null) {
        this.items.push({id: GLib.uuid_string_random(), text, done: false, ...at && {at}});
        this._commit();
    }

    toggle(id) {
        const item = this.items.find(i => i.id === id);
        if (!item)
            return;
        item.done = !item.done;
        // Reopening a task whose time went by while it was done is not the
        // moment to remind about it.
        if (!item.done && item.at <= Date.now())
            item.notified = true;
        this._commit();
    }

    remove(id) {
        this.items = this.items.filter(i => i.id !== id);
        this._commit();
    }

    clearDone() {
        this.items = this.items.filter(i => !i.done);
        this._commit();
    }

    _commit() {
        this._store.save({items: this.items});
        this._changed();
    }

    _changed() {
        this._remind();
        this._listeners.forEach(listener => listener());
    }

    /** Notifies about every reminder that came due, once, and waits for the next. */
    _remind() {
        const now = Date.now();
        const pending = this.items.filter(i => i.at && !i.done && !i.notified);
        const due = pending.filter(i => i.at <= now);
        due.forEach(item => {
            item.notified = true;
            this._notify(item);
        });
        if (due.length)
            this._commit();

        if (this._dueId)
            GLib.source_remove(this._dueId);
        this._dueId = 0;
        const next = Math.min(...pending.filter(i => i.at > now).map(i => i.at));
        if (next - now < CHECK_EVERY_S * 1000) {
            this._dueId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, next - now, () => {
                this._dueId = 0;
                this._remind();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    destroy() {
        GLib.source_remove(this._checkId);
        if (this._dueId)
            GLib.source_remove(this._dueId);
        this._listeners.clear();
        this._store = null;
    }
}
