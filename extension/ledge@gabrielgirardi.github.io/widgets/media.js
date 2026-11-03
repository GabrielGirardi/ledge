import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {MprisPlayer} from 'resource:///org/gnome/shell/ui/mpris.js';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {cardShell} from './card.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

export class MediaWidget {
    constructor() {
        this.actor = cardShell('audio-x-generic-symbolic', _('Now Playing').toUpperCase());
        this.actor.visible = false;

        const body = new St.BoxLayout({style_class: 'ledge-media'});
        this._cover = new St.Icon({style_class: 'ledge-media-cover', icon_size: 56});
        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._title = new St.Label({style_class: 'ledge-media-title'});
        this._artist = new St.Label({style_class: 'ledge-media-artist'});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(this._title);
        text.add_child(this._artist);
        body.add_child(this._cover);
        body.add_child(text);
        this.actor.add_child(body);

        const controls = new St.BoxLayout({style_class: 'ledge-media-controls', x_align: Clutter.ActorAlign.CENTER});
        this._prev = this._button('media-skip-backward-symbolic', () => this._player?.previous());
        this._play = this._button('media-playback-start-symbolic', () => this._player?.playPause());
        this._next = this._button('media-skip-forward-symbolic', () => this._player?.next());
        [this._prev, this._play, this._next].forEach(b => controls.add_child(b));
        this.actor.add_child(controls);

        this._players = new Map();
        this._player = null;
        this._cancellable = new Gio.Cancellable();
        this._ownerId = Gio.DBus.session.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _n, params) => {
                const [name, oldOwner, newOwner] = params.deep_unpack();
                if (name.startsWith(MPRIS_PREFIX) && newOwner && !oldOwner)
                    this._addPlayer(name);
            });
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1,
            this._cancellable, (conn, res) => {
                try {
                    const [names] = conn.call_finish(res).deep_unpack();
                    names.filter(n => n.startsWith(MPRIS_PREFIX)).forEach(n => this._addPlayer(n));
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`Ledge media: ${e.message}`);
                }
            });
    }

    _button(iconName, callback) {
        const button = new St.Button({
            style_class: 'ledge-media-button',
            can_focus: true,
            child: new St.Icon({icon_name: iconName, icon_size: 16}),
        });
        button.connect('clicked', callback);
        return button;
    }

    _addPlayer(busName) {
        if (this._players.has(busName))
            return;
        const player = new MprisPlayer(busName);
        const ids = [
            player.connect('changed', () => {
                if (player.status === 'Playing')
                    this._lastPlaying = player;
                this._render();
            }),
            player.connect('closed', () => this._removePlayer(busName)),
        ];
        this._players.set(busName, {player, ids});
    }

    _removePlayer(busName) {
        const entry = this._players.get(busName);
        if (!entry)
            return;
        entry.ids.forEach(id => entry.player.disconnect(id));
        this._players.delete(busName);
        if (this._lastPlaying === entry.player)
            this._lastPlaying = null;
        this._render();
    }

    _pick() {
        const players = [...this._players.values()].map(e => e.player).filter(p => p.trackTitle);
        return players.find(p => p.status === 'Playing') ??
            (players.includes(this._lastPlaying) ? this._lastPlaying : null) ??
            players[0] ?? null;
    }

    _render() {
        const player = this._pick();
        this._player = player;
        this.actor.visible = player !== null;
        if (!player)
            return;

        this._title.text = player.trackTitle;
        this._artist.text = player.trackArtists.join(', ');
        if (player.trackCoverUrl)
            this._cover.gicon = new Gio.FileIcon({file: Gio.File.new_for_uri(player.trackCoverUrl)});
        else
            this._cover.gicon = player.app?.get_icon() ?? new Gio.ThemedIcon({name: 'audio-x-generic-symbolic'});

        this._play.child.icon_name = player.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._prev.reactive = player.canGoPrevious;
        this._next.reactive = player.canGoNext;
        this._prev.opacity = player.canGoPrevious ? 255 : 90;
        this._next.opacity = player.canGoNext ? 255 : 90;
    }

    destroy() {
        this._cancellable.cancel();
        Gio.DBus.session.signal_unsubscribe(this._ownerId);
        for (const busName of [...this._players.keys()])
            this._removePlayer(busName);
        this.actor.destroy();
    }
}
