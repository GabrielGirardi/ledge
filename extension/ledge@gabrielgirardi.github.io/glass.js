import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BLUR_RADIUS = 90;
// GNOME 48 moved the snippet hooks from Shell to Cogl.
const SnippetHook = Cogl.SnippetHook ?? Shell.SnippetHook;

const RoundedMask = GObject.registerClass(
class RoundedMask extends Shell.GLSLEffect {
    _init(radius) {
        super._init();
        this._radius = radius;
        this._sizeLocation = this.get_uniform_location('size');
        this._radiusLocation = this.get_uniform_location('radius');
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(SnippetHook.FRAGMENT,
            'uniform vec2 size;\nuniform float radius;\n',
            `vec2 p = cogl_tex_coord_in[0].xy * size;
             vec2 q = abs(p - size * 0.5) - (size * 0.5 - radius);
             float d = length(max(q, 0.0)) - radius;
             cogl_color_out *= clamp(0.5 - d, 0.0, 1.0);`,
            false);
    }

    vfunc_paint_target(node, paintContext) {
        const [width, height] = this.actor.get_size();
        this.set_uniform_float(this._sizeLocation, 2, [width, height]);
        this.set_uniform_float(this._radiusLocation, 1, [this._radius]);
        super.vfunc_paint_target(node, paintContext);
    }
});

/**
 * A blurred copy of the wallpaper, aligned so it looks like the panel is
 * frosted glass over the desktop. Static blur instead of BACKGROUND-mode
 * blur because the latter re-blurs only damaged regions and leaves square
 * artifacts wherever the cursor or anything underneath repaints.
 */
export class Glass {
    constructor(radius) {
        this.actor = new St.Widget({clip_to_allocation: true, x_expand: true, y_expand: true});
        this.actor.set_size(0, 0);
        this.actor.add_effect(new RoundedMask(radius));
        this._monitorIndex = -1;
        this._origin = [0, 0];
        this._bgManager = null;
    }

    setMonitor(index) {
        if (index === this._monitorIndex)
            return;
        this._bgManager?.destroy();
        this._monitorIndex = index;
        this._bgManager = new Background.BackgroundManager({
            container: this.actor,
            monitorIndex: index,
            controlPosition: false,
            vignette: false,
        });
        this._bgManager.connect('changed', () => this._decorate());
        this._decorate();
    }

    setOrigin(x, y) {
        this._origin = [x, y];
        this._bgManager?.backgroundActor.set_position(-x, -y);
    }

    _decorate() {
        const bg = this._bgManager.backgroundActor;
        const monitor = Main.layoutManager.monitors[this._monitorIndex];
        bg.set_size(monitor.width, monitor.height);
        if (!bg.get_effect('ledge-blur')) {
            const blur = new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR, brightness: 1.0});
            if ('radius' in blur)
                blur.radius = BLUR_RADIUS;
            else
                blur.sigma = BLUR_RADIUS / 2;
            bg.add_effect_with_name('ledge-blur', blur);
        }
        this.setOrigin(...this._origin);
    }

    destroy() {
        this._bgManager?.destroy();
        this._bgManager = null;
        this.actor.destroy();
    }
}
