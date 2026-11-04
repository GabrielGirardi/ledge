import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {JsonStore} from './store.js';

const IDLE_MS = 2 * 60 * 1000;
const SAVE_EVERY_S = 60;
const KEEP_DAYS = 30;

const dayKey = (date = new Date()) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * Counts how long each app holds keyboard focus, per local day. Time does not
 * count while the user is idle for two minutes or the screen is locked.
 * Everything stays in ~/.local/share/ledge/usage.json, pruned to 30 days.
 */
export class UsageTracker {
    constructor() {
        this._days = {};
        this._dirty = false;
        this._current = null;
        this._idle = false;
        this._loaded = false;
        this._store = new JsonStore('usage.json');
        this._store.load({days: {}}).then(data => {
            if (!this._store)
                return;
            for (const [day, apps] of Object.entries(data.days ?? {})) {
                const merged = this._days[day] ??= {};
                for (const [id, seconds] of Object.entries(apps))
                    merged[id] = (merged[id] ?? 0) + seconds;
            }
            this._loaded = true;
        });

        this._windowTracker = Shell.WindowTracker.get_default();
        this._focusId = this._windowTracker.connect('notify::focus-app', () => this._restart());
        this._sessionId = Main.sessionMode.connect('updated', () => this._restart());

        this._idleMonitor = global.backend.get_core_idle_monitor();
        this._idleWatch = this._idleMonitor.add_idle_watch(IDLE_MS, () => {
            this._idle = true;
            this._restart();
            this._activeWatch = this._idleMonitor.add_user_active_watch(() => {
                this._activeWatch = 0;
                this._idle = false;
                this._restart();
            });
        });

        this._saveId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, SAVE_EVERY_S, () => {
            this._flush();
            this._save();
            return GLib.SOURCE_CONTINUE;
        });
        this._restart();
    }

    /** Today's apps, most used first: [{appId, seconds}]. */
    today() {
        this._flush();
        return Object.entries(this._days[dayKey()] ?? {})
            .map(([appId, seconds]) => ({appId, seconds}))
            .sort((a, b) => b.seconds - a.seconds);
    }

    _countable() {
        if (this._idle || Main.sessionMode.isLocked)
            return null;
        const id = this._windowTracker.focus_app?.get_id();
        return id && !id.startsWith('window:') ? id : null;
    }

    _restart() {
        this._flush();
        const appId = this._countable();
        this._current = appId ? {appId, since: GLib.get_monotonic_time()} : null;
    }

    _flush() {
        if (!this._current)
            return;
        const now = GLib.get_monotonic_time();
        const seconds = (now - this._current.since) / 1e6;
        this._current.since = now;
        if (seconds <= 0)
            return;
        const day = this._days[dayKey()] ??= {};
        day[this._current.appId] = (day[this._current.appId] ?? 0) + seconds;
        this._dirty = true;
    }

    _save() {
        // Saving before the history is loaded would overwrite it.
        if (!this._dirty || !this._loaded)
            return;
        const cutoff = dayKey(new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000));
        for (const day of Object.keys(this._days)) {
            if (day < cutoff)
                delete this._days[day];
        }
        this._dirty = false;
        this._store.save({days: this._days});
    }

    destroy() {
        this._flush();
        this._save();
        this._store = null;
        this._windowTracker.disconnect(this._focusId);
        Main.sessionMode.disconnect(this._sessionId);
        this._idleMonitor.remove_watch(this._idleWatch);
        if (this._activeWatch)
            this._idleMonitor.remove_watch(this._activeWatch);
        GLib.source_remove(this._saveId);
    }
}
