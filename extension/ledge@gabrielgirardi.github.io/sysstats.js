import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Reads CPU, memory, disk, and per-app usage from the kernel. Imports nothing
// from GNOME Shell, so the unit tests can run it.

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'query_filesystem_info_async');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');

async function readText(path, cancellable) {
    const [bytes] = await Gio.File.new_for_path(path).load_contents_async(cancellable);
    return new TextDecoder().decode(bytes);
}

/** {busy, total} jiffies over all CPUs, from /proc/stat. Waiting on disk counts as idle. */
export function parseProcStat(text) {
    const fields = text.split('\n', 1)[0].trim().split(/\s+/).slice(1, 9).map(Number);
    const total = fields.reduce((sum, n) => sum + n, 0);
    const [, , , idle, iowait] = fields;
    return {busy: total - idle - iowait, total};
}

/** {used, total} bytes of memory, from /proc/meminfo. */
export function parseMeminfo(text) {
    const kib = key => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0) * 1024;
    const total = kib('MemTotal');
    return {used: total - kib('MemAvailable'), total};
}

/**
 * The application a systemd unit under app.slice runs, as a desktop file id,
 * or null for units that are not apps. GNOME starts each app in its own
 * scope, so a browser's helper processes are counted with the browser.
 */
export function appIdFromUnit(unit) {
    const name = unit.replace(/\\x([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
    let m = /^app-(?:gnome|flatpak)-(.+)-\d+\.scope$/.exec(name);
    if (m)
        return `${m[1]}.desktop`;
    m = /^app-(?!gnome-session)(.+)\.slice$/.exec(name);
    if (m)
        return `${m[1]}.desktop`;
    m = /^snap\.([^.]+)\.(.+)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.scope$/.exec(name);
    if (m)
        return `${m[1]}_${m[2]}.desktop`;
    return null;
}

/** "used of total" as a fraction, 0 when nothing is known. */
export const share = ({used, total}) => (total > 0 ? used / total : 0);

export class SystemSampler {
    constructor() {
        this._cpu = null;
        this._apps = new Map();
        this._appsDir = null;
    }

    async _appsSlice(cancellable) {
        if (this._appsDir === null) {
            // From GNOME Shell's own cgroup, up to the user's service manager.
            const own = await readText('/proc/self/cgroup', cancellable);
            const m = /^0::(\/.*\/user@\d+\.service)\//m.exec(own);
            this._appsDir = m ? `/sys/fs/cgroup${m[1]}/app.slice` : '';
        }
        return this._appsDir;
    }

    /** CPU microseconds used so far by each app under app.slice. */
    async _appTimes(cancellable) {
        const dir = await this._appsSlice(cancellable);
        if (!dir)
            return new Map();
        const times = new Map();
        const enumerator = await Gio.File.new_for_path(dir).enumerate_children_async('standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, cancellable);
        const units = [];
        for (let batch; (batch = await enumerator.next_files_async(64, GLib.PRIORITY_LOW, cancellable)).length;)
            units.push(...batch.filter(i => i.get_file_type() === Gio.FileType.DIRECTORY).map(i => i.get_name()));
        await Promise.all(units.map(async unit => {
            const appId = appIdFromUnit(unit);
            if (!appId)
                return;
            try {
                const [stat, memory] = await Promise.all([
                    readText(`${dir}/${unit}/cpu.stat`, cancellable),
                    readText(`${dir}/${unit}/memory.current`, cancellable),
                ]);
                const usec = Number(/^usage_usec (\d+)/m.exec(stat)?.[1] ?? 0);
                const prev = times.get(appId);
                times.set(appId, {usec: usec + (prev?.usec ?? 0), memory: Number(memory) + (prev?.memory ?? 0)});
            } catch (e) {
                // The app quit between listing and reading.
            }
        }));
        return times;
    }

    /**
     * One reading. `cpu` and each app's `cpu` are fractions of the whole
     * machine since the previous reading, null on the first.
     *
     * @returns {Promise<{cpu: ?number, memory: {used, total}, disk: {used, total},
     *   apps: {appId: string, cpu: ?number, memory: number}[]}>}
     */
    async sample(cancellable = null) {
        const [stat, meminfo, fs, appTimes] = await Promise.all([
            readText('/proc/stat', cancellable),
            readText('/proc/meminfo', cancellable),
            Gio.File.new_for_path(GLib.get_home_dir()).query_filesystem_info_async(
                'filesystem::size,filesystem::free', GLib.PRIORITY_LOW, cancellable),
            this._appTimes(cancellable).catch(() => new Map()),
        ]);
        const now = GLib.get_monotonic_time();
        const cpu = parseProcStat(stat);
        const prev = this._cpu;
        this._cpu = {...cpu, at: now};

        const elapsedUsec = prev ? (now - prev.at) * GLib.get_num_processors() : 0;
        const apps = [...appTimes].map(([appId, {usec, memory}]) => {
            const before = this._apps.get(appId);
            return {appId, memory, cpu: before && elapsedUsec > 0 ? Math.max(0, usec - before) / elapsedUsec : null};
        });
        this._apps = new Map([...appTimes].map(([appId, {usec}]) => [appId, usec]));

        const size = fs.get_attribute_uint64('filesystem::size');
        return {
            cpu: prev && cpu.total > prev.total ? (cpu.busy - prev.busy) / (cpu.total - prev.total) : null,
            memory: parseMeminfo(meminfo),
            disk: {used: size - fs.get_attribute_uint64('filesystem::free'), total: size},
            apps,
        };
    }
}
