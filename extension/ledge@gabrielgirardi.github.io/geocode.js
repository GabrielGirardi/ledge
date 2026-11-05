import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

// Imports nothing from GNOME Shell: the preferences, a separate GTK process,
// use it too.

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

export function newSession() {
    return new Soup.Session({user_agent: 'Ledge (GNOME Shell extension)', timeout: 15});
}

export async function getJson(session, url, cancellable = null) {
    const message = Soup.Message.new('GET', url);
    const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
    if (message.get_status() !== Soup.Status.OK)
        throw new Error(`HTTP ${message.get_status()} from ${url}`);
    return JSON.parse(new TextDecoder().decode(bytes.get_data()));
}

/**
 * Places matching a name, best first, from Open-Meteo's geocoding. `region`
 * tells same-named places apart: "São Paulo, Brazil" for Campinas.
 *
 * @returns {Promise<{name: string, region: string, latitude: number, longitude: number}[]>}
 */
export async function searchPlaces(session, query, language, {count = 8, cancellable = null} = {}) {
    const data = await getJson(session,
        `https://geocoding-api.open-meteo.com/v1/search?count=${count}&language=${language}` +
        `&name=${encodeURIComponent(query)}`, cancellable);
    return (data.results ?? []).map(r => ({
        name: r.name,
        region: [r.admin1, r.country].filter(part => part && part !== r.name).join(', '),
        latitude: r.latitude,
        longitude: r.longitude,
    }));
}
