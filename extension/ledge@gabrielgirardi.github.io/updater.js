import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {getJson} from './geocode.js';

// Imports nothing from GNOME Shell: the preferences, a separate GTK process,
// use it too.

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');
Gio._promisify(Gio.File.prototype, 'copy_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

export const UUID = 'ledge@gabrielgirardi.github.io';
export const RELEASES_URL = 'https://api.github.com/repos/GabrielGirardi/ledge/releases?per_page=20';
const DOWNLOAD_PREFIX = 'https://github.com/GabrielGirardi/ledge/releases/download/';
const ZIP_NAME = `${UUID}.shell-extension.zip`;
const HELPER = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'lib', 'ledge', 'ledge-touchd.py']);

/** [major, minor, patch] of "1.2.3" or "v1.2.3"; null for anything else. */
export function parseVersion(text) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text ?? '');
    return m ? m.slice(1).map(Number) : null;
}

/** True when version `a` is newer than `b`. */
export function isNewer(a, b) {
    const [pa, pb] = [parseVersion(a), parseVersion(b)];
    if (!pa || !pb)
        return false;
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i])
            return pa[i] > pb[i];
    }
    return false;
}

/**
 * The newest published release from the GitHub API's list, with the URLs of
 * its zip and its metadata.json. Drafts, pre-release tags ("1.0.0-rc.1"),
 * and releases without both files are skipped. GitHub marks every 0.x
 * release as a pre-release, so that flag is not a filter.
 */
export function pickRelease(releases) {
    let best = null;
    for (const release of releases ?? []) {
        if (release.draft || !parseVersion(release.tag_name))
            continue;
        const url = name => release.assets?.find(a => a.name === name)?.browser_download_url;
        const zipUrl = url(ZIP_NAME);
        const metadataUrl = url('metadata.json');
        // Only ever download from this project's own releases.
        if (!zipUrl?.startsWith(DOWNLOAD_PREFIX) || !metadataUrl?.startsWith(DOWNLOAD_PREFIX))
            continue;
        const version = release.tag_name.replace(/^v/, '');
        if (!best || isNewer(version, best.version))
            best = {version, zipUrl, metadataUrl, pageUrl: release.html_url};
    }
    return best;
}

/** True when `metadata` declares support for this GNOME Shell ("46.2" matches "46"). */
export function supportsShell(metadata, shellVersion) {
    const major = String(shellVersion).split('.')[0];
    return (metadata['shell-version'] ?? []).some(v => String(v) === major || String(v) === String(shellVersion));
}

/**
 * Whether this copy may replace itself: only a copy installed for this user
 * from a zip. A copy from a distribution package (in /usr) is the package
 * manager's to update, and a development checkout (a symlink) is git's.
 */
export function canSelfUpdate(extensionPath) {
    const userCopy = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', UUID]);
    if (extensionPath !== userCopy)
        return false;
    const info = Gio.File.new_for_path(extensionPath).query_info('standard::is-symlink',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    return !info.get_is_symlink();
}

/** The version-name in the metadata.json on disk, which an update replaces. */
export async function installedVersion(extensionPath) {
    const file = Gio.File.new_for_path(GLib.build_filenamev([extensionPath, 'metadata.json']));
    const [bytes] = await file.load_contents_async(null);
    return JSON.parse(new TextDecoder().decode(bytes))['version-name'];
}

/**
 * The newest release this GNOME Shell can run, if it is newer than
 * `currentVersion`; otherwise null.
 */
export async function findUpdate(session, currentVersion, shellVersion, {url = RELEASES_URL, cancellable = null} = {}) {
    const release = pickRelease(await getJson(session, url, cancellable));
    if (!release || !isNewer(release.version, currentVersion))
        return null;
    const metadata = await getJson(session, release.metadataUrl, cancellable);
    if (metadata.uuid !== UUID || !supportsShell(metadata, shellVersion))
        return null;
    return release;
}

async function run(argv, cancellable) {
    const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE);
    const [, stderr] = await proc.communicate_utf8_async(null, cancellable);
    if (!proc.get_successful())
        throw new Error(`${argv.join(' ')}: ${stderr?.trim() || `exit ${proc.get_exit_status()}`}`);
}

/**
 * Downloads and installs `release` over this copy. The new code runs from the
 * next login: GNOME Shell on Wayland cannot reload an extension in place.
 * The touchpad helper is updated too, when it was installed by install.sh.
 */
export async function installUpdate(session, release, extensionPath, {cancellable = null} = {}) {
    const message = Soup.Message.new('GET', release.zipUrl);
    const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
    if (message.get_status() !== Soup.Status.OK)
        throw new Error(`HTTP ${message.get_status()} from ${release.zipUrl}`);

    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'ledge']);
    GLib.mkdir_with_parents(dir, 0o700);
    const zip = Gio.File.new_for_path(GLib.build_filenamev([dir, `ledge-${release.version}.zip`]));
    await zip.replace_contents_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable);
    try {
        await run(['gnome-extensions', 'install', '--force', zip.get_path()], cancellable);
    } finally {
        zip.delete_async(GLib.PRIORITY_DEFAULT, null, null);
    }

    const helper = Gio.File.new_for_path(HELPER);
    const newHelper = Gio.File.new_for_path(GLib.build_filenamev([extensionPath, 'touchd', 'ledge-touchd.py']));
    if (helper.query_exists(null) && newHelper.query_exists(null)) {
        await newHelper.copy_async(helper, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, cancellable, null);
        await run(['systemctl', '--user', 'try-restart', 'ledge-touchd.service'], cancellable).catch(e =>
            console.warn(`Ledge: could not restart the touchpad helper: ${e.message}`));
    }
}
