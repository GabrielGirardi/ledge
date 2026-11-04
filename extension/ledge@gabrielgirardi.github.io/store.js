import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

/**
 * A JSON document in ~/.local/share/ledge/. Reads and writes are async, and
 * writes are serialized so that a slow write never lands after a newer one.
 */
export class JsonStore {
    constructor(name) {
        const dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'ledge']);
        this._file = Gio.File.new_for_path(GLib.build_filenamev([dir, name]));
        this._dir = dir;
        this._queue = Promise.resolve();
    }

    async load(fallback) {
        try {
            const [bytes] = await this._file.load_contents_async(null);
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.warn(`Ledge: could not read ${this._file.get_path()}: ${e.message}`);
            return fallback;
        }
    }

    save(data) {
        const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(data)));
        this._queue = this._queue.then(async () => {
            GLib.mkdir_with_parents(this._dir, 0o700);
            await this._file.replace_contents_bytes_async(bytes, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE, null);
        }).catch(e => console.warn(`Ledge: could not write ${this._file.get_path()}: ${e.message}`));
        return this._queue;
    }
}
