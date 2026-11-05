import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {newSession, searchPlaces} from './geocode.js';
import {messagesLanguage} from './locale.js';
import {CATALOG, shownWidgets} from './widgets/catalog.js';

const SEARCH_DELAY_MS = 350;

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

        page.add(this._weatherGroup(settings));

        window.add(page);
    }

    /**
     * The current place, with a way back to automatic, and a search that
     * lists matching places by region, so that one of the many Santa Marias
     * is not mistaken for another.
     */
    _weatherGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Weather'), description: _('Data from Open-Meteo')});
        const location = new Gio.Settings({schema_id: 'org.gnome.system.location'});

        const current = new Adw.ActionRow({title: _('Location')});
        current.add_prefix(new Gtk.Image({icon_name: 'find-location-symbolic'}));
        const automatic = new Gtk.Button({
            label: _('Use automatic'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        automatic.connect('clicked', () => {
            settings.set_value('weather-location', new GLib.Variant('(sdd)', ['', 0, 0]));
            settings.set_string('weather-city', '');
        });
        current.add_suffix(automatic);
        group.add(current);

        const showCurrent = () => {
            const [name] = settings.get_value('weather-location').deepUnpack();
            const place = name || settings.get_string('weather-city').trim();
            automatic.visible = Boolean(place);
            if (place)
                current.subtitle = place;
            else if (location.get_boolean('enabled'))
                current.subtitle = _('Automatic: where this device is');
            else
                current.subtitle = _('Automatic: the city of your time zone. Turn on Location Services in Settings › Privacy to use where this device is.');
        };
        const ids = [
            settings.connect('changed::weather-location', showCurrent),
            settings.connect('changed::weather-city', showCurrent),
        ];
        const locationId = location.connect('changed::enabled', showCurrent);
        showCurrent();

        const search = new Adw.EntryRow({title: _('Search for a city')});
        search.add_prefix(new Gtk.Image({icon_name: 'system-search-symbolic'}));
        group.add(search);

        const session = newSession();
        let results = [];
        let timer = 0;
        let cancellable = null;
        const clear = () => {
            results.forEach(row => group.remove(row));
            results = [];
        };
        const show = rows => {
            clear();
            results = rows;
            rows.forEach(row => group.add(row));
        };
        const note = text => {
            const row = new Adw.ActionRow({title: text, sensitive: false});
            show([row]);
        };
        const pick = place => {
            settings.set_value('weather-location',
                new GLib.Variant('(sdd)', [place.name, place.latitude, place.longitude]));
            settings.set_string('weather-city', '');
            search.text = '';
        };
        const run = async query => {
            cancellable?.cancel();
            cancellable = new Gio.Cancellable();
            const mine = cancellable;
            let places;
            try {
                places = await searchPlaces(session, query, messagesLanguage(), {cancellable: mine});
            } catch (e) {
                if (!mine.is_cancelled())
                    note(_('Could not search. Check your internet connection.'));
                return;
            }
            if (mine.is_cancelled())
                return;
            if (!places.length) {
                note(_('No places found'));
                return;
            }
            show(places.map(place => {
                const row = new Adw.ActionRow({title: place.name, subtitle: place.region, activatable: true});
                row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
                row.connect('activated', () => pick(place));
                return row;
            }));
        };
        search.connect('changed', () => {
            if (timer)
                GLib.source_remove(timer);
            timer = 0;
            cancellable?.cancel();
            const query = search.text.trim();
            if (query.length < 2) {
                clear();
                return;
            }
            timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DELAY_MS, () => {
                timer = 0;
                run(query);
                return GLib.SOURCE_REMOVE;
            });
        });
        search.connect('entry-activated', () => results[0]?.activatable && results[0].emit('activated'));

        group.connect('destroy', () => {
            if (timer)
                GLib.source_remove(timer);
            cancellable?.cancel();
            ids.forEach(id => settings.disconnect(id));
            location.disconnect(locationId);
        });
        return group;
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
