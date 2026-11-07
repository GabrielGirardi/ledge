import Clutter from 'gi://Clutter';
import St from 'gi://St';

/**
 * Spread into an St.BoxLayout's parameters to stack its children. GNOME 48
 * replaced the `vertical` property with `orientation`, and 51 removed
 * `vertical`; 46 and 47 only have `vertical`.
 */
export const VERTICAL = 'orientation' in St.BoxLayout.prototype
    ? {orientation: Clutter.Orientation.VERTICAL}
    : {vertical: true};
