// Unit tests for sysstats.js. Run: gjs -m tests/unit/sysstats.test.js
import System from 'system';

import {appIdFromUnit, parseMeminfo, parseProcStat, share, SystemSampler} from '../../extension/ledge@gabrielgirardi.github.io/sysstats.js';

let failures = 0;
const check = (name, actual, expected) => {
    const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
    if (a !== e) {
        failures++;
        print(`FAIL ${name}: got ${a}, expected ${e}`);
    } else {
        print(`ok   ${name}`);
    }
};

check('cpu: waiting on disk is idle',
    parseProcStat('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3\n'), {busy: 150, total: 1000});
check('memory: used is what is not available',
    parseMeminfo('MemTotal:       16000000 kB\nMemFree:  1000 kB\nMemAvailable:    4000000 kB\n'),
    {used: 12000000 * 1024, total: 16000000 * 1024});
check('share of nothing is 0', share({used: 5, total: 0}), 0);

check('app started by GNOME', appIdFromUnit('app-gnome-org.gnome.Nautilus-4123.scope'), 'org.gnome.Nautilus.desktop');
check('escaped dashes', appIdFromUnit('app-gnome-google\\x2dchrome-6120.scope'), 'google-chrome.desktop');
check('flatpak', appIdFromUnit('app-flatpak-org.mozilla.firefox-912.scope'), 'org.mozilla.firefox.desktop');
check('app slice (terminal)', appIdFromUnit('app-org.gnome.Terminal.slice'), 'org.gnome.Terminal.desktop');
check('snap', appIdFromUnit('snap.firefox.firefox-0f3e7c2a-1b2c-4d5e-8f90-123456789abc.scope'), 'firefox_firefox.desktop');
check('session services are not apps', appIdFromUnit('app-gnome\\x2dsession\\x2dmanager.slice'), null);
check('plain services are not apps', appIdFromUnit('appimagelauncherd.service'), null);

// Against this machine's real kernel files: the shapes, not the numbers.
const sampler = new SystemSampler();
const first = await sampler.sample();
const second = await sampler.sample();
check('first reading has no CPU yet', first.cpu, null);
check('second reading has a CPU share', second.cpu >= 0 && second.cpu <= 1, true);
check('memory and disk are known', share(second.memory) > 0 && share(second.disk) > 0, true);

if (failures) {
    print(`${failures} failed`);
    System.exit(1);
}
