import Clutter from 'gi://Clutter';
import Geoclue from 'gi://Geoclue';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather?version=4.0';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {getJson, newSession, searchPlaces} from '../geocode.js';
import {messagesLanguage} from '../locale.js';
import {cardShell} from './card.js';

const STALE_MS = 30 * 60 * 1000;
// GeoClue answers in a second or two when it can; without Wi-Fi it may never
// answer at all.
const LOCATE_TIMEOUT_S = 10;
// Moves smaller than this keep the current place (and its forecast).
const LOCATE_THRESHOLD_M = 2000;

// WMO weather interpretation codes, as used by Open-Meteo.
const CONDITIONS = [
    [[0], () => _('Clear sky'), 'weather-clear'],
    [[1, 2], () => _('Partly cloudy'), 'weather-few-clouds'],
    [[3], () => _('Overcast'), 'weather-overcast'],
    [[45, 48], () => _('Fog'), 'weather-fog'],
    [[51, 53, 55, 56, 57], () => _('Drizzle'), 'weather-showers-scattered'],
    [[61, 63, 65, 66, 67, 80, 81, 82], () => _('Rain'), 'weather-showers'],
    [[71, 73, 75, 77, 85, 86], () => _('Snow'), 'weather-snow'],
    [[95, 96, 99], () => _('Thunderstorm'), 'weather-storm'],
];
const HAS_NIGHT_ICON = new Set(['weather-clear', 'weather-few-clouds']);

function describe(code, isDay) {
    const match = CONDITIONS.find(([codes]) => codes.includes(code));
    if (!match)
        return {label: _('Unavailable'), icon: 'weather-severe-alert-symbolic'};
    const [, label, icon] = match;
    const variant = !isDay && HAS_NIGHT_ICON.has(icon) ? `${icon}-night` : icon;
    return {label: label(), icon: `${variant}-symbolic`};
}

class PlaceNotFound extends Error {
    constructor(city) {
        super(`no place named ${city}`);
        this.city = city;
    }
}

export class WeatherWidget {
    constructor(settings) {
        this._settings = settings;
        this.actor = cardShell('weather-few-clouds-symbolic', _('Weather').toUpperCase());

        const body = new St.BoxLayout({style_class: 'ledge-weather'});
        const text = new St.BoxLayout({vertical: true, x_expand: true});
        this._temp = new St.Label({style_class: 'ledge-card-value'});
        this._sub = new St.Label({style_class: 'ledge-card-sub'});
        text.add_child(this._temp);
        text.add_child(this._sub);
        this._icon = new St.Icon({style_class: 'ledge-weather-icon', y_align: Clutter.ActorAlign.CENTER});
        body.add_child(text);
        body.add_child(this._icon);
        this.actor.add_child(body);

        this._session = newSession();
        this._cancellable = new Gio.Cancellable();
        this._place = null;
        this._fetchedAt = 0;
        this._busy = false;
        this._stale = false;
        this._gclue = null;
        this._locating = null;
        this._settingsIds = ['changed::weather-location', 'changed::weather-city']
            .map(signal => settings.connect(signal, () => this._relocate()));
        this._location = new Gio.Settings({schema_id: 'org.gnome.system.location'});
        this._locationId = this._location.connect('changed::enabled', () => this._relocate());

        this._message(_('Loading…'));
        this.refresh();
    }

    refresh() {
        if (this._busy || Date.now() - this._fetchedAt < STALE_MS)
            return;
        this._busy = true;
        this._stale = false;
        this._update().catch(e => {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            console.warn(`Ledge weather: ${e.message}`);
            if (!this._stale)
                this._message(_('Could not load the weather'));
        }).finally(() => {
            this._busy = false;
            // The place changed while this update ran; it showed the old one.
            if (this._stale && !this._cancellable.is_cancelled())
                this.refresh();
        });
    }

    /** Forgets the place, so the next refresh looks it up again. */
    _relocate() {
        this._stale = this._busy;
        this._place = null;
        this._fetchedAt = 0;
        if (!this._location.get_boolean('enabled'))
            this._gclue = null;
        this.refresh();
    }

    /**
     * Where to show the weather for, in order: a place picked in the
     * preferences; a city typed in Ledge 0.3 or earlier; the device's
     * location, when Location Services are on; the city of the time zone.
     */
    async _resolvePlace() {
        const [name, latitude, longitude] = this._settings.get_value('weather-location').deepUnpack();
        if (name)
            return {name, latitude, longitude};

        const typed = this._settings.get_string('weather-city').trim();
        if (typed)
            return this._geocode(typed);

        if (this._location.get_boolean('enabled')) {
            try {
                return await this._locate();
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) && this._cancellable.is_cancelled())
                    throw e;
                console.warn(`Ledge weather: no location from GeoClue, using the time zone: ${e.message}`);
            }
        }
        return this._geocode(GLib.TimeZone.new_local().get_identifier().split('/').pop().replace(/_/g, ' '));
    }

    async _geocode(city) {
        const [hit] = await searchPlaces(this._session, city, messagesLanguage(), {count: 1, cancellable: this._cancellable});
        if (!hit)
            throw new PlaceNotFound(city);
        return hit;
    }

    async _locate() {
        if (!this._gclue) {
            // Gives up after a while; destroy() cancels it too.
            const attempt = this._locating = new Gio.Cancellable();
            let timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, LOCATE_TIMEOUT_S, () => {
                timeout = 0;
                attempt.cancel();
                return GLib.SOURCE_REMOVE;
            });
            try {
                // The desktop id GNOME Shell's own weather uses; GeoClue
                // allows it whenever Location Services are on.
                this._gclue = await new Promise((resolve, reject) => {
                    Geoclue.Simple.new('org.gnome.Shell', Geoclue.AccuracyLevel.CITY, attempt, (_o, result) => {
                        try {
                            resolve(Geoclue.Simple.new_finish(result));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
            } finally {
                if (timeout)
                    GLib.source_remove(timeout);
                this._locating = null;
            }
            this._gclue.get_client().distance_threshold = LOCATE_THRESHOLD_M;
            const gclue = this._gclue;
            gclue.connect('notify::location', () => {
                if (this._gclue === gclue)
                    this._relocate();
            });
        }
        const {latitude, longitude} = this._gclue.location;
        // GWeather's offline city database: no extra lookup leaves the machine.
        const nearest = GWeather.Location.get_world()?.find_nearest_city(latitude, longitude);
        return {name: nearest?.get_city_name() ?? _('Your location'), latitude, longitude};
    }

    async _update() {
        if (!this._place) {
            let place;
            try {
                place = await this._resolvePlace();
            } catch (e) {
                if (!(e instanceof PlaceNotFound))
                    throw e;
                if (!this._stale)
                    this._message(_('City “%s” not found').format(e.city));
                return;
            }
            if (this._stale)
                return;
            this._place = place;
        }

        const {name, latitude, longitude} = this._place;
        this.actor.title.text = `${_('Weather')} · ${name}`.toUpperCase();
        const f = await getJson(this._session,
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
            '&current=temperature_2m,weather_code,is_day' +
            '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1', this._cancellable);
        if (this._stale)
            return;
        this._fetchedAt = Date.now();

        const {label, icon} = describe(f.current.weather_code, f.current.is_day);
        this._temp.text = `${Math.round(f.current.temperature_2m)}°`;
        /* Translators: condition · daily high and low, e.g. "Rain · high 28° low 17°" */
        this._sub.text = _('%s · high %s° low %s°').format(label,
            Math.round(f.daily.temperature_2m_max[0]), Math.round(f.daily.temperature_2m_min[0]));
        this._icon.icon_name = icon;
        this._icon.visible = true;
    }

    _message(text) {
        this._temp.text = '—';
        this._sub.text = text;
        this._icon.visible = false;
    }

    destroy() {
        this._cancellable.cancel();
        this._locating?.cancel();
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._location.disconnect(this._locationId);
        this._gclue = null;
        this._session.abort();
        this.actor.destroy();
    }
}
