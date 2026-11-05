import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {CATALOG, shownWidgets} from './widgets/catalog.js';

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

        const hotEdge = new Adw.SwitchRow({
            title: _('Hot edge'),
            subtitle: _('Push the pointer against the screen edge to open the panel'),
        });
        settings.bind('hot-edge', hotEdge, 'active', 0);
        panel.add(hotEdge);

        const indicator = new Adw.SwitchRow({
            title: _('Panel button'),
            subtitle: _('A button next to your system icons, wherever your bar is'),
        });
        settings.bind('show-indicator', indicator, 'active', 0);
        panel.add(indicator);

        const shortcut = new Adw.EntryRow({
            title: _('Keyboard shortcut (for example <Super>t)'),
            use_markup: false,
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

        page.add(this._widgetsGroup(settings));

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

    /** One row per widget: a switch to show it, and buttons to move it. */
    _widgetsGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Widgets'),
            description: _('Hidden widgets are not loaded at all. You can also rearrange them from the panel.'),
        });
        let rows = [];

        const save = list => settings.set_strv('widgets', list.filter(w => w.shown).map(w => w.id));
        const load = () => {
            const shown = shownWidgets(settings);
            return [
                ...shown.map(id => ({id, shown: true})),
                ...CATALOG.filter(w => !shown.includes(w.id)).map(w => ({id: w.id, shown: false})),
            ];
        };

        const render = () => {
            rows.forEach(row => group.remove(row));
            const list = load();
            rows = list.map((entry, index) => {
                const info = CATALOG.find(w => w.id === entry.id);
                const row = new Adw.ActionRow({title: _(info.title)});
                row.add_prefix(new Gtk.Image({icon_name: info.icon}));

                const move = (delta, icon, label) => {
                    const button = new Gtk.Button({
                        icon_name: icon,
                        valign: Gtk.Align.CENTER,
                        css_classes: ['flat'],
                        tooltip_text: label,
                        sensitive: entry.shown && list[index + delta]?.shown === true,
                    });
                    button.connect('clicked', () => {
                        [list[index], list[index + delta]] = [list[index + delta], list[index]];
                        save(list);
                    });
                    return button;
                };
                row.add_suffix(move(-1, 'go-up-symbolic', _('Move up')));
                row.add_suffix(move(1, 'go-down-symbolic', _('Move down')));

                const toggle = new Gtk.Switch({active: entry.shown, valign: Gtk.Align.CENTER});
                toggle.connect('notify::active', () => {
                    entry.shown = toggle.active;
                    save(list);
                });
                row.add_suffix(toggle);
                row.activatable_widget = toggle;
                group.add(row);
                return row;
            });
        };

        const changedId = settings.connect('changed::widgets', render);
        group.connect('destroy', () => settings.disconnect(changedId));
        render();
        return group;
    }
}
