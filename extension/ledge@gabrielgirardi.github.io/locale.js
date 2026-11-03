import GLib from 'gi://GLib';

function bcp47(category) {
    const name = GLib.get_language_names_with_category(category).find(n => n !== 'C') ?? 'en_US';
    return name.split('.')[0].split('@')[0].replace('_', '-');
}

// Dates follow LC_TIME and text follows LC_MESSAGES, so a system set to
// English text with Brazilian dates gets exactly that.
export const timeLocale = () => bcp47('LC_TIME');
export const messagesLanguage = () => bcp47('LC_MESSAGES').split('-')[0];

export const formatTime = date =>
    date.toLocaleTimeString(timeLocale(), {hour: 'numeric', minute: '2-digit'});
