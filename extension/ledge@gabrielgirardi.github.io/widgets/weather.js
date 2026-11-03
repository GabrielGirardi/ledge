import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {messagesLanguage} from '../locale.js';
import {cardShell} from './card.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const STALE_MS = 30 * 60 * 1000;

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

        this._session = new Soup.Session({user_agent: 'Ledge/0.1 (GNOME Shell extension)', timeout: 15});
        this._cancellable = new Gio.Cancellable();
        this._place = null;
        this._fetchedAt = 0;
        this._busy = false;
        this._cityId = settings.connect('changed::weather-city', () => {
            this._place = null;
            this._fetchedAt = 0;
            this.refresh();
        });

        this._message(_('Loading…'));
        this.refresh();
    }

    refresh() {
        if (this._busy || Date.now() - this._fetchedAt < STALE_MS)
            return;
        this._busy = true;
        this._update().catch(e => {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            console.warn(`Ledge weather: ${e.message}`);
            this._message(_('Could not load the weather'));
        }).finally(() => {
            this._busy = false;
        });
    }

    _city() {
        const city = this._settings.get_string('weather-city').trim();
        if (city)
            return city;
        return GLib.TimeZone.new_local().get_identifier().split('/').pop().replace(/_/g, ' ');
    }

    async _getJson(url) {
        const message = Soup.Message.new('GET', url);
        const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable);
        if (message.get_status() !== Soup.Status.OK)
            throw new Error(`HTTP ${message.get_status()} from ${url}`);
        return JSON.parse(new TextDecoder().decode(bytes.get_data()));
    }

    async _update() {
        if (!this._place) {
            const city = this._city();
            const geo = await this._getJson(
                `https://geocoding-api.open-meteo.com/v1/search?count=1&language=${messagesLanguage()}` +
                `&name=${encodeURIComponent(city)}`);
            const hit = geo.results?.[0];
            if (!hit) {
                this._message(_('City “%s” not found').format(city));
                return;
            }
            this._place = {name: hit.name, latitude: hit.latitude, longitude: hit.longitude};
        }

        const {name, latitude, longitude} = this._place;
        const f = await this._getJson(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
            '&current=temperature_2m,weather_code,is_day' +
            '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1');
        this._fetchedAt = Date.now();

        const {label, icon} = describe(f.current.weather_code, f.current.is_day);
        this.actor.title.text = `${_('Weather')} · ${name}`.toUpperCase();
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
        this._settings.disconnect(this._cityId);
        this._session.abort();
        this.actor.destroy();
    }
}
