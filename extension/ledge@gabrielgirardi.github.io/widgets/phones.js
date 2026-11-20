import Gio from 'gi://Gio';

const NAME = 'org.gnome.Shell.Extensions.GSConnect';
const ROOT = '/org/gnome/Shell/Extensions/GSConnect';
const DEVICE_IFACE = 'org.gnome.Shell.Extensions.GSConnect.Device';
// GSConnect publishes a phone's battery as the state of this action on the
// device's action group: (charging, icon name, percent, seconds left). The
// percent is -1 until the phone has reported it.
const BATTERY_ACTION = 'battery';

/**
 * Batteries of phones paired with GSConnect and connected right now. Calls
 * `onChange(id, battery)` with {name, percentage, charging}, or with null
 * when the phone goes away.
 */
export class PhoneBatteries {
    constructor(onChange) {
        this._onChange = onChange;
        this._devices = new Map();
        this._manager = null;
        this._cancellable = null;
        this._watchId = Gio.bus_watch_name(Gio.BusType.SESSION, NAME, Gio.BusNameWatcherFlags.NONE,
            () => this._connect(), () => this._disconnect());
    }

    _connect() {
        this._cancellable = new Gio.Cancellable();
        Gio.DBusObjectManagerClient.new_for_bus(Gio.BusType.SESSION,
            Gio.DBusObjectManagerClientFlags.DO_NOT_AUTO_START, NAME, ROOT, null, this._cancellable,
            (_o, res) => {
                try {
                    this._manager = Gio.DBusObjectManagerClient.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`Ledge phones: ${e.message}`);
                    return;
                }
                this._manager.connect('object-added', (_m, object) => this._add(object));
                this._manager.connect('object-removed', (_m, object) => this._remove(object.get_object_path()));
                this._manager.connect('interface-proxy-properties-changed', (_m, object) =>
                    this._sync(object.get_object_path()));
                this._manager.get_objects().forEach(object => this._add(object));
            });
    }

    _disconnect() {
        this._cancellable?.cancel();
        this._cancellable = null;
        for (const path of [...this._devices.keys()])
            this._remove(path);
        this._manager = null;
    }

    _add(object) {
        const proxy = object.get_interface(DEVICE_IFACE);
        const path = object.get_object_path();
        if (!proxy || this._devices.has(path))
            return;
        const actions = Gio.DBusActionGroup.get(this._manager.get_connection(), NAME, path);
        const ids = ['action-added', 'action-removed', 'action-state-changed'].map(signal =>
            actions.connect(signal, (_g, action) => {
                if (action === BATTERY_ACTION)
                    this._sync(path);
            }));
        this._devices.set(path, {proxy, actions, ids});
        // A remote action group only asks for its actions once it is queried.
        actions.list_actions();
        this._sync(path);
    }

    _remove(path) {
        const device = this._devices.get(path);
        if (!device)
            return;
        device.ids.forEach(id => device.actions.disconnect(id));
        this._devices.delete(path);
        this._onChange(path, null);
    }

    _sync(path) {
        const device = this._devices.get(path);
        if (!device)
            return;
        const prop = name => device.proxy.get_cached_property(name)?.unpack();
        const state = device.actions.has_action(BATTERY_ACTION)
            ? device.actions.get_action_state(BATTERY_ACTION)?.deep_unpack()
            : null;
        const [charging, , percentage] = state ?? [];
        const shown = prop('Paired') && prop('Connected') && percentage >= 0;
        this._onChange(path, shown ? {name: prop('Name'), percentage, charging} : null);
    }

    destroy() {
        Gio.bus_unwatch_name(this._watchId);
        this._disconnect();
    }
}
