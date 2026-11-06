import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {newSession} from './geocode.js';
import {canSelfUpdate, findUpdate, installUpdate, installedVersion, isNewer} from './updater.js';

const FIRST_CHECK_S = 2 * 60;
const CHECK_EVERY_S = 24 * 60 * 60;
// How often to look at whether a day has passed; the day is counted from the
// last check, so it survives logins and suspends.
const TICK_S = 60 * 60;

/**
 * Checks GitHub for a new Ledge once a day. With automatic updates on, it
 * installs the new version for the next login and says so; otherwise it says
 * that one is out, once per version.
 */
export class AutoUpdater {
    constructor(extension, settings) {
        this._extension = extension;
        this._settings = settings;
        this._cancellable = new Gio.Cancellable();
        this._session = null;
        this._busy = false;
        this._sourceId = 0;
        if (!canSelfUpdate(extension.path))
            return;
        this._sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, FIRST_CHECK_S, () => {
            this._maybeCheck();
            this._sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, TICK_S, () => {
                this._maybeCheck();
                return GLib.SOURCE_CONTINUE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _maybeCheck() {
        const now = Math.floor(Date.now() / 1000);
        if (this._busy || now - this._settings.get_int64('update-checked-at') < CHECK_EVERY_S)
            return;
        this._busy = true;
        this._check(now).catch(e => {
            if (!this._cancellable.is_cancelled())
                console.warn(`Ledge: update check failed: ${e.message}`);
        }).finally(() => {
            this._busy = false;
        });
    }

    async _check(now) {
        this._session ??= newSession();
        // Compare with what is on disk: an update installed earlier and
        // waiting for the next login must not be offered again.
        const current = await installedVersion(this._extension.path);
        const release = await findUpdate(this._session, current, Config.PACKAGE_VERSION, {cancellable: this._cancellable});
        this._settings.set_int64('update-checked-at', now);
        if (!release)
            return;

        if (this._settings.get_boolean('auto-update')) {
            await installUpdate(this._session, release, this._extension.path, {cancellable: this._cancellable});
            Main.notify(_('Ledge updated to %s').format(release.version),
                _('Log out and back in to start using it.'));
        } else if (isNewer(release.version, this._settings.get_string('update-notified') || '0.0.0')) {
            this._settings.set_string('update-notified', release.version);
            Main.notify(_('Ledge %s is available').format(release.version),
                _('Update it in Ledge’s settings.'));
        }
    }

    destroy() {
        this._cancellable.cancel();
        if (this._sourceId)
            GLib.source_remove(this._sourceId);
        this._sourceId = 0;
        this._session?.abort();
    }
}
