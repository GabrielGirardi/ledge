import GLib from 'gi://GLib';

/**
 * The first usable BCP 47 tag for a locale category. "C", "C.UTF-8" and
 * "POSIX" (common on minimal systems and containers) are not languages, and
 * Intl throws on them, which once kept the extension from enabling at all.
 */
function bcp47(category) {
    for (const name of GLib.get_language_names_with_category(category)) {
        const base = name.split('.')[0].split('@')[0];
        if (base === 'C' || base === 'POSIX')
            continue;
        const tag = base.replace('_', '-');
        try {
            Intl.getCanonicalLocales(tag);
            return tag;
        } catch {
            continue;
        }
    }
    return 'en-US';
}

// Dates follow LC_TIME and text follows LC_MESSAGES, so a system set to
// English text with Brazilian dates gets exactly that.
export const timeLocale = () => bcp47('LC_TIME');
export const messagesLanguage = () => bcp47('LC_MESSAGES').split('-')[0];

export const formatTime = date =>
    date.toLocaleTimeString(timeLocale(), {hour: 'numeric', minute: '2-digit'});
