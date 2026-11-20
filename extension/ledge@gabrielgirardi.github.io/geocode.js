import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

// Imports nothing from GNOME Shell: the preferences, a separate GTK process,
// use it too.

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

export function newSession() {
    return new Soup.Session({user_agent: 'Ledge (GNOME Shell extension)', timeout: 15});
}

export class HttpError extends Error {
    /** `headers` is the response's Soup.MessageHeaders, if any. */
    constructor(status, url, headers = null) {
        super(`HTTP ${status} from ${url}`);
        this.status = status;
        // GitHub says how many requests are left and when the count resets,
        // or, for its secondary limits, how many seconds to wait.
        const left = headers?.get_one('x-ratelimit-remaining');
        const reset = Number(headers?.get_one('x-ratelimit-reset'));
        const wait = Number(headers?.get_one('retry-after'));
        this.rateLimited = status === 429 || (status === 403 && (left === '0' || wait > 0));
        /** When asking again will work, in milliseconds since the epoch, or null. */
        this.retryAt = null;
        if (this.rateLimited && wait > 0)
            this.retryAt = Date.now() + wait * 1000;
        else if (this.rateLimited && reset > 0)
            this.retryAt = reset * 1000;
    }
}

export async function getJson(session, url, cancellable = null) {
    const message = Soup.Message.new('GET', url);
    const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
    if (message.get_status() !== Soup.Status.OK)
        throw new HttpError(message.get_status(), url, message.get_response_headers());
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
