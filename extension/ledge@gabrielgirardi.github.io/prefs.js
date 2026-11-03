import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SIDES = ['right', 'left'];

export default class LedgePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        const panel = new Adw.PreferencesGroup({title: _('Panel')});
        const side = new Adw.ComboRow({
            title: _('Screen side'),
            subtitle: _('The panel opens with a two-finger swipe from this touchpad edge'),
            model: Gtk.StringList.new([_('Right'), _('Left')]),
            selected: Math.max(0, SIDES.indexOf(settings.get_string('side'))),
        });
        side.connect('notify::selected', () => settings.set_string('side', SIDES[side.selected]));
        panel.add(side);

        const indicator = new Adw.SwitchRow({
            title: _('Top bar button'),
            subtitle: _('Click it to open or close the panel'),
        });
        settings.bind('show-indicator', indicator, 'active', 0);
        panel.add(indicator);

        const shortcut = new Adw.EntryRow({
            title: _('Keyboard shortcut (for example <Super>t)'),
            text: settings.get_strv('toggle-shortcut')[0] ?? '',
            show_apply_button: true,
        });
        shortcut.connect('apply', () => {
            const accel = shortcut.text.trim();
            const [ok] = Gtk.accelerator_parse(accel);
            if (accel && !ok) {
                shortcut.add_css_class('error');
                return;
            }
            shortcut.remove_css_class('error');
            settings.set_strv('toggle-shortcut', accel ? [accel] : []);
        });
        panel.add(shortcut);
        page.add(panel);

        const weather = new Adw.PreferencesGroup({
            title: _('Weather'),
            description: _('Data from Open-Meteo. Leave empty to use the city of your time zone.'),
        });
        const city = new Adw.EntryRow({
            title: _('City'),
            text: settings.get_string('weather-city'),
            show_apply_button: true,
        });
        city.connect('apply', () => settings.set_string('weather-city', city.text.trim()));
        weather.add(city);
        page.add(weather);

        window.add(page);
    }
}
