import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {JsonStore} from '../store.js';
import {cardShell} from './card.js';

const MAX_LENGTH = 200;

export class TodoWidget {
    constructor() {
        this.actor = cardShell('checkbox-checked-symbolic', _('To-do').toUpperCase());
        this._list = new St.BoxLayout({vertical: true, style_class: 'ledge-todo-list'});
        this.actor.add_child(this._list);

        this._entry = new St.Entry({
            style_class: 'ledge-todo-entry',
            hint_text: _('Add a task'),
            can_focus: true,
            x_expand: true,
        });
        this._entry.clutter_text.max_length = MAX_LENGTH;
        this._entry.clutter_text.connect('activate', () => this._add());
        this.actor.add_child(this._entry);

        this._footer = new St.BoxLayout({style_class: 'ledge-todo-footer'});
        this._remaining = new St.Label({style_class: 'ledge-card-sub', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._clear = new St.Button({style_class: 'ledge-link-button', label: _('Clear completed'), can_focus: true});
        this._clear.connect('clicked', () => this._clearDone());
        this._footer.add_child(this._remaining);
        this._footer.add_child(this._clear);
        this.actor.add_child(this._footer);

        this._items = [];
        this._store = new JsonStore('todo.json');
        this._store.load({items: []}).then(data => {
            if (!this._store)
                return;
            // Keep anything added while the file was still loading.
            this._items = [...(Array.isArray(data.items) ? data.items : []), ...this._items];
            this._render();
        });
        this._render();
    }

    _add() {
        const text = this._entry.text.trim();
        if (!text)
            return;
        this._items.push({id: GLib.uuid_string_random(), text, done: false});
        this._entry.text = '';
        this._commit();
    }

    _toggle(id) {
        const item = this._items.find(i => i.id === id);
        if (item)
            item.done = !item.done;
        this._commit();
    }

    _remove(id) {
        this._items = this._items.filter(i => i.id !== id);
        this._commit();
    }

    _clearDone() {
        this._items = this._items.filter(i => !i.done);
        this._commit();
    }

    _commit() {
        this._store.save({items: this._items});
        this._render();
    }

    _render() {
        this._list.destroy_all_children();
        const open = this._items.filter(i => !i.done);
        const done = this._items.filter(i => i.done);
        [...open, ...done].forEach(item => this._list.add_child(this._row(item)));
        this._list.visible = this._items.length > 0;

        this._footer.visible = this._items.length > 0;
        this._remaining.text = open.length === 0
            ? _('All done')
            : _('%d left').format(open.length);
        this._clear.visible = done.length > 0;
    }

    _row(item) {
        const row = new St.BoxLayout({style_class: 'ledge-todo-row', reactive: true, track_hover: true});
        const check = new St.Button({
            style_class: 'ledge-todo-check',
            can_focus: true,
            child: new St.Icon({icon_name: item.done ? 'checkbox-checked-symbolic' : 'checkbox-symbolic'}),
            accessible_name: item.done ? _('Mark as not done') : _('Mark as done'),
        });
        check.connect('clicked', () => this._toggle(item.id));

        const label = new St.Label({
            text: item.text,
            style_class: item.done ? 'ledge-todo-text ledge-todo-done' : 'ledge-todo-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        const remove = new St.Button({
            style_class: 'ledge-todo-remove',
            can_focus: true,
            child: new St.Icon({icon_name: 'window-close-symbolic'}),
            accessible_name: _('Delete task'),
            opacity: 0,
        });
        remove.connect('clicked', () => this._remove(item.id));
        row.connect('notify::hover', () => {
            remove.opacity = row.hover || remove.has_key_focus() ? 255 : 0;
        });

        row.add_child(check);
        row.add_child(label);
        row.add_child(remove);
        return row;
    }

    destroy() {
        this._store = null;
        this.actor.destroy();
    }
}
