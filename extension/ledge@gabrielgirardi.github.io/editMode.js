import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {CATALOG, shownWidgets} from './widgets/catalog.js';

const WIGGLE_DEGREES = 0.7;
const DRAG_THRESHOLD = 6;

/**
 * iOS-style editing inside the panel: cards wiggle, a minus hides a card,
 * dragging a card (or Up/Down on a focused card) reorders, and an "Add
 * widgets" tray at the end brings hidden ones back. Every change is written
 * to the `widgets` setting; the panel applies it like any other change.
 *
 * The panel forwards its captured events to handleEvent() while editing, so
 * a press on a card starts a drag instead of reaching the card's controls.
 */
export class EditMode {
    constructor(settings, content, onChange) {
        this._settings = settings;
        this._onChange = onChange;
        this._content = content;
        this._tray = null;
        this._drag = null;
        this.active = false;
    }

    enter() {
        if (this.active)
            return;
        this.active = true;
        this.refresh();
        this._onChange();
    }

    exit() {
        if (!this.active)
            return;
        this._endDrag(false);
        this.active = false;
        for (const card of this._cards()) {
            card.remove_style_pseudo_class('editing');
            card.can_focus = false;
            card.reactive = false;
            this._still(card);
            card._ledgeHide?.destroy();
            card._ledgeHide = null;
        }
        this._tray?.destroy();
        this._tray = null;
        this._onChange();
    }

    /** Re-applies edit decorations after the panel's widgets changed. */
    refresh() {
        if (!this.active)
            return;
        for (const card of this._cards())
            this._decorate(card);
        this._rebuildTray();
    }

    destroy() {
        this.exit();
    }

    /**
     * @returns {boolean|undefined} a Clutter event result, or undefined to let
     *   the panel handle the event as usual.
     */
    handleEvent(event) {
        if (!this.active)
            return undefined;
        const target = global.stage.get_event_actor(event);
        switch (event.type()) {
        case Clutter.EventType.KEY_PRESS:
            return this._onKey(event.get_key_symbol());
        case Clutter.EventType.BUTTON_PRESS: {
            if (!this._content.contains(target))
                return undefined;
            if (this._insideButton(target))
                return Clutter.EVENT_PROPAGATE;
            const card = this._cardOf(target);
            if (card) {
                const [, y] = event.get_coords();
                const [, top] = card.get_transformed_position();
                this._drag = {card, startY: y, grabOffset: y - top, moved: false};
                card.grab_key_focus();
            }
            // While editing, cards are things to move, not to use.
            return Clutter.EVENT_STOP;
        }
        case Clutter.EventType.MOTION:
            if (!this._drag)
                return undefined;
            this._dragTo(event.get_coords()[1]);
            return Clutter.EVENT_STOP;
        case Clutter.EventType.BUTTON_RELEASE:
            if (!this._drag)
                return undefined;
            this._endDrag(true);
            return Clutter.EVENT_STOP;
        default:
            return undefined;
        }
    }

    _onKey(symbol) {
        if (symbol === Clutter.KEY_Escape) {
            this.exit();
            return Clutter.EVENT_STOP;
        }
        if (symbol !== Clutter.KEY_Up && symbol !== Clutter.KEY_Down)
            return undefined;
        const card = this._cardOf(global.stage.get_key_focus());
        if (!card)
            return undefined;
        this._move(card, symbol === Clutter.KEY_Up ? -1 : 1);
        this._save();
        card.grab_key_focus();
        return Clutter.EVENT_STOP;
    }

    _cards() {
        return this._content.get_children().filter(a => a.name?.startsWith('ledge:card:'));
    }

    _idOf(card) {
        return card.name.slice('ledge:card:'.length);
    }

    _cardOf(actor) {
        for (let a = actor; a && a !== this._content; a = a.get_parent()) {
            if (a.get_parent() === this._content && a.name?.startsWith('ledge:card:'))
                return a;
        }
        return null;
    }

    _insideButton(actor) {
        for (let a = actor; a && a !== this._content; a = a.get_parent()) {
            if (a instanceof St.Button)
                return true;
        }
        return false;
    }

    _decorate(card) {
        card.add_style_pseudo_class('editing');
        card.can_focus = true;
        // Cards are plain boxes; without this a press on a card's background
        // picks the scroll view behind it and never reaches the card.
        card.reactive = true;
        if (!card._ledgeHide) {
            const id = this._idOf(card);
            const info = CATALOG.find(w => w.id === id);
            const hide = new St.Button({
                style_class: 'ledge-card-hide',
                can_focus: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
                child: new St.Icon({icon_name: 'list-remove-symbolic'}),
                name: `ledge:hide:${id}`,
                accessible_name: _('Hide %s').format(_(info.title)),
            });
            hide.connect('clicked', () => this._setShown(id, false));
            card.get_first_child().add_child(hide);
            card._ledgeHide = hide;
        }
        if (!this._drag || this._drag.card !== card)
            this._wiggle(card);
    }

    _wiggle(card) {
        if (!St.Settings.get().enable_animations || card._ledgeWiggling)
            return;
        card._ledgeWiggling = true;
        card.set_pivot_point(0.5, 0.5);
        card.rotation_angle_z = -WIGGLE_DEGREES;
        card.ease({
            rotation_angle_z: WIGGLE_DEGREES,
            duration: 130 + Math.round(Math.random() * 40),
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            repeatCount: -1,
            autoReverse: true,
        });
    }

    _still(card) {
        card._ledgeWiggling = false;
        card.remove_transition('rotation-angle-z');
        card.rotation_angle_z = 0;
    }

    _rebuildTray() {
        this._tray?.destroy();
        this._tray = null;
        const shown = shownWidgets(this._settings);
        const hidden = CATALOG.filter(w => !shown.includes(w.id));
        if (!hidden.length)
            return;

        this._tray = new St.BoxLayout({vertical: true, style_class: 'ledge-edit-tray'});
        this._tray.add_child(new St.Label({text: _('Add widgets').toUpperCase(), style_class: 'ledge-card-title'}));
        for (const info of hidden) {
            const row = new St.BoxLayout({style_class: 'ledge-edit-add-row', x_expand: true});
            row.add_child(new St.Icon({icon_name: info.icon, style_class: 'ledge-card-icon'}));
            row.add_child(new St.Label({text: _(info.title), x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
            row.add_child(new St.Icon({icon_name: 'list-add-symbolic', style_class: 'ledge-edit-add-icon'}));
            const button = new St.Button({
                style_class: 'ledge-edit-add',
                can_focus: true,
                child: row,
                name: `ledge:add:${info.id}`,
                accessible_name: _('Add %s').format(_(info.title)),
            });
            button.connect('clicked', () => this._setShown(info.id, true));
            this._tray.add_child(button);
        }
        this._content.add_child(this._tray);
    }

    _setShown(id, shown) {
        const list = shownWidgets(this._settings).filter(w => w !== id);
        if (shown)
            list.push(id);
        this._settings.set_strv('widgets', list);
    }

    _move(card, delta) {
        const cards = this._cards().filter(c => c.visible);
        const index = cards.indexOf(card);
        const to = index + delta;
        if (to < 0 || to >= cards.length)
            return false;
        this._moveBefore(card, delta < 0 ? cards[to] : cards[to].get_next_sibling());
        return true;
    }

    /** Moves card right before `sibling` (or to the end of the cards). */
    _moveBefore(card, sibling) {
        if (sibling)
            this._content.set_child_below_sibling(card, sibling);
        else
            this._content.set_child_above_sibling(card, this._cards().at(-1));
    }

    _dragTo(y) {
        const drag = this._drag;
        if (!drag.moved) {
            if (Math.abs(y - drag.startY) < DRAG_THRESHOLD)
                return;
            drag.moved = true;
            this._still(drag.card);
            drag.card.add_style_pseudo_class('dragging');
        }
        const cards = this._cards().filter(c => c.visible);
        const index = cards.indexOf(drag.card);
        const centerOf = card => {
            const [, top] = card.get_transformed_position();
            return top - card.translation_y + card.height / 2;
        };
        // A fast drag (or a busy machine) delivers sparse motion events; walk
        // past every neighbour the pointer crossed, not just one per event.
        let to = index;
        while (to > 0 && y < centerOf(cards[to - 1]))
            to--;
        while (to < cards.length - 1 && y > centerOf(cards[to + 1]))
            to++;
        if (to !== index)
            this._moveBefore(drag.card, to < index ? cards[to] : cards[to].get_next_sibling());

        const [, top] = drag.card.get_transformed_position();
        const resting = top - drag.card.translation_y;
        drag.card.translation_y = y - drag.grabOffset - resting;
    }

    _endDrag(save) {
        const drag = this._drag;
        if (!drag)
            return;
        this._drag = null;
        if (!drag.moved)
            return;
        drag.card.remove_style_pseudo_class('dragging');
        drag.card.ease({
            translation_y: 0,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this.active)
                    this._wiggle(drag.card);
            },
        });
        if (save)
            this._save();
    }

    _save() {
        this._settings.set_strv('widgets', this._cards().map(c => this._idOf(c)));
    }
}
