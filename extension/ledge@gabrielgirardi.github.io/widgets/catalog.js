// The widgets Ledge knows, in default order. Shared by the panel and the
// preferences, so it must not import anything from GNOME Shell. Titles are
// marked with N_ for translation and translated where they are shown.
const N_ = s => s;

export const CATALOG = [
    {id: 'weather', title: N_('Weather'), icon: 'weather-few-clouds-symbolic'},
    {id: 'batteries', title: N_('Batteries'), icon: 'battery-good-symbolic'},
    {id: 'calendar', title: N_('Calendar'), icon: 'x-office-calendar-symbolic'},
    {id: 'todo', title: N_('To-do'), icon: 'checkbox-checked-symbolic'},
    {id: 'screen-time', title: N_('Screen Time'), icon: 'preferences-system-time-symbolic'},
    {id: 'media', title: N_('Now Playing'), icon: 'audio-x-generic-symbolic'},
];

const KNOWN = new Set(CATALOG.map(w => w.id));

/** The shown widgets, in order, from the `widgets` setting: known ids, once each. */
export function shownWidgets(settings) {
    return [...new Set(settings.get_strv('widgets'))].filter(id => KNOWN.has(id));
}
