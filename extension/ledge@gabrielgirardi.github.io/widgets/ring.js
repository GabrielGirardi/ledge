import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {VERTICAL} from '../compat.js';

const SIZE = 54;
const GREEN = [0.2, 0.84, 0.42];
const RED = [1, 0.27, 0.23];

/** An icon or a short value inside a progress ring, with a label underneath. */
export class Ring {
    /** `name` names the value in the middle, for the tests. */
    constructor({color = GREEN, name = null} = {}) {
        this.actor = new St.BoxLayout({...VERTICAL, style_class: 'ledge-battery'});
        const bin = new St.Widget({layout_manager: new Clutter.BinLayout(), width: SIZE, height: SIZE});
        this._area = new St.DrawingArea({width: SIZE, height: SIZE});
        this._area.connect('repaint', area => this._paint(area));
        this._icon = new St.Icon({
            style_class: 'ledge-battery-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._value = new St.Label({
            style_class: 'ledge-ring-value',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
            name,
        });
        bin.add_child(this._area);
        bin.add_child(this._icon);
        bin.add_child(this._value);
        this._label = new St.Label({style_class: 'ledge-battery-label', x_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(bin);
        this.actor.add_child(this._label);
        this._color = color;
        this._fraction = 0;
        this._alert = false;
    }

    /** Shows `icon` or, without one, `value` in the middle. `alert` paints the ring red. */
    update({icon = null, value = '', fraction, label, alert = false}) {
        this._icon.visible = Boolean(icon);
        if (icon)
            this._icon.icon_name = icon;
        this._value.visible = !icon;
        this._value.text = value;
        this._fraction = Math.min(1, Math.max(0, fraction));
        this._alert = alert;
        this._label.text = label;
        this._area.queue_repaint();
    }

    _paint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const line = w * 0.09;
        const r = Math.min(w, h) / 2 - line / 2;
        cr.setLineWidth(line);
        cr.setLineCap(Cairo.LineCap.ROUND);

        cr.setSourceRGBA(1, 1, 1, 0.14);
        cr.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
        cr.stroke();

        cr.setSourceRGBA(...(this._alert ? RED : this._color), 1);
        const start = -Math.PI / 2;
        cr.arc(w / 2, h / 2, r, start, start + 2 * Math.PI * this._fraction);
        cr.stroke();
        cr.$dispose();
    }
}
