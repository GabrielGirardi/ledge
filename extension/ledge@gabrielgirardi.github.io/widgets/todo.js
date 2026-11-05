import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {JsonStore} from '../store.js';
import {cardShell} from './card.js';

const MAX_LENGTH = 200;

class TaskRow {
    constructor(item, {onToggle, onRemove}) {
        this.actor = new St.BoxLayout({style_class: 'ledge-todo-row', reactive: true, track_hover: true});

        this._check = new St.Button({
            style_class: 'ledge-todo-check',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'object-select-symbolic', style_class: 'ledge-todo-check-icon'}),
        });
        this._check.connect('clicked', () => onToggle(item.id));

        this._label = new St.Label({style_class: 'ledge-todo-text', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._remove = new St.Button({
            style_class: 'ledge-todo-remove',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'user-trash-symbolic'}),
            accessible_name: _('Delete task'),
        });
        this._remove.connect('clicked', () => onRemove(item.id));

        const syncRemove = () => {
            this._remove.opacity = this.actor.hover || this._remove.has_key_focus() ? 255 : 0;
        };
        this.actor.connect('notify::hover', syncRemove);
        this._remove.connect('key-focus-in', syncRemove);
        this._remove.connect('key-focus-out', syncRemove);
        syncRemove();

        this.actor.add_child(this._check);
        this.actor.add_child(this._label);
        this.actor.add_child(this._remove);
        this.update(item);
    }

    update(item) {
        const escaped = GLib.markup_escape_text(item.text, -1);
        this._label.clutter_text.set_markup(item.done ? `<s>${escaped}</s>` : escaped);
        if (item.done) {
            this.actor.add_style_pseudo_class('checked');
            this._check.add_style_pseudo_class('checked');
        } else {
            this.actor.remove_style_pseudo_class('checked');
            this._check.remove_style_pseudo_class('checked');
        }
        this._check.accessible_name = item.done ? _('Mark as not done') : _('Mark as done');
    }
}

export class TodoWidget {
    constructor() {
        this.actor = cardShell('checkbox-checked-symbolic', _('To-do').toUpperCase());

        // Same picking fix as the panel's scroll view: clip on the scroll
        // view's allocation, not on the narrower page GNOME 46 reports.
        this._list = new St.BoxLayout({vertical: true, style_class: 'ledge-todo-list', clip_to_view: false});
        this._scroll = new St.ScrollView({
            style_class: 'ledge-todo-scroll vfade',
            clip_to_allocation: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            x_expand: true,
        });
        this._scroll.child = this._list;
        this.actor.add_child(this._scroll);

        this._entry = new St.Entry({
            style_class: 'ledge-todo-entry',
            hint_text: _('Add a task'),
            can_focus: true,
            x_expand: true,
            primary_icon: new St.Icon({icon_name: 'list-add-symbolic', style_class: 'ledge-todo-entry-icon'}),
        });
        this._entry.clutter_text.max_length = MAX_LENGTH;
        this._entry.clutter_text.connect('activate', () => this._add());
        this.actor.add_child(this._entry);

        this._footer = new St.BoxLayout({style_class: 'ledge-todo-footer'});
        this._summary = new St.Label({style_class: 'ledge-card-sub', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._clear = new St.Button({style_class: 'ledge-link-button', label: _('Clear completed'), can_focus: true});
        this._clear.connect('clicked', () => this._clearDone());
        this._footer.add_child(this._summary);
        this._footer.add_child(this._clear);
        this.actor.add_child(this._footer);

        this._items = [];
        this._rows = new Map();
        this._store = new JsonStore('todo.json');
        this._store.load({items: []}).then(data => {
            if (!this._store)
                return;
            // Keep anything added while the file was still loading.
            this._items = [...(Array.isArray(data.items) ? data.items : []), ...this._items];
            this._sync();
        });
        this._sync();
    }

    _add() {
        const text = this._entry.text.trim();
        if (!text)
            return;
        this._items.push({id: GLib.uuid_string_random(), text, done: false});
        this._entry.text = '';
        this._commit();
        // Show the new task, which lands at the end of the list.
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            const adjustment = this._scroll.vadjustment;
            adjustment.value = adjustment.upper - adjustment.page_size;
            return GLib.SOURCE_REMOVE;
        });
    }

    _toggle(id) {
        const item = this._items.find(i => i.id === id);
        if (!item)
            return;
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
        this._sync();
    }

    /**
     * Updates rows in place, in creation order. A finished task stays where
     * it is: moving it would put a different task under the pointer, and the
     * next click would toggle that one instead.
     */
    _sync() {
        const ids = new Set(this._items.map(i => i.id));
        for (const [id, row] of this._rows) {
            if (!ids.has(id)) {
                row.actor.destroy();
                this._rows.delete(id);
            }
        }
        this._items.forEach((item, index) => {
            let row = this._rows.get(item.id);
            if (!row) {
                row = new TaskRow(item, {
                    onToggle: id => this._toggle(id),
                    onRemove: id => this._remove(id),
                });
                this._rows.set(item.id, row);
            }
            row.update(item);
            if (this._list.get_child_at_index(index) !== row.actor) {
                if (row.actor.get_parent())
                    this._list.set_child_at_index(row.actor, index);
                else
                    this._list.insert_child_at_index(row.actor, index);
            }
        });

        const done = this._items.filter(i => i.done).length;
        const total = this._items.length;
        this._scroll.visible = total > 0;
        this._footer.visible = total > 0;
        this._clear.visible = done > 0;
        if (total > 0 && done === total)
            this._summary.text = _('All done');
        else
            /* Translators: tasks finished out of all tasks, e.g. "2 of 5 done" */
            this._summary.text = _('%d of %d done').format(done, total);
    }

    destroy() {
        this._store = null;
        this.actor.destroy();
    }
}
