// Unit tests for updater.js. Run: gjs -m tests/unit/updater.test.js
import System from 'system';

import {isNewer, parseVersion, pickRelease, supportsShell, UUID} from '../../extension/ledge@gabrielgirardi.github.io/updater.js';

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

const DL = 'https://github.com/GabrielGirardi/ledge/releases/download';
const release = (tag, extra = {}) => ({
    tag_name: tag,
    draft: false,
    prerelease: true,
    html_url: `https://github.com/GabrielGirardi/ledge/releases/tag/${tag}`,
    assets: [
        {name: `${UUID}.shell-extension.zip`, browser_download_url: `${DL}/${tag}/${UUID}.shell-extension.zip`},
        {name: 'metadata.json', browser_download_url: `${DL}/${tag}/metadata.json`},
    ],
    ...extra,
});

check('parse', parseVersion('v0.10.2'), [0, 10, 2]);
check('parse rejects pre-release tags', parseVersion('1.0.0-rc.1'), null);
check('newer patch', isNewer('0.4.2', '0.4.1'), true);
check('numeric, not text, order', isNewer('0.10.0', '0.9.9'), true);
check('same is not newer', isNewer('0.4.1', 'v0.4.1'), false);
check('older is not newer', isNewer('0.3.9', '0.4.0'), false);
check('garbage is never newer', isNewer('latest', '0.1.0'), false);

check('picks the highest version, not the first listed',
    pickRelease([release('v0.4.1'), release('v0.10.0'), release('v0.9.0')])?.version, '0.10.0');
check('0.x releases are GitHub pre-releases and still count',
    pickRelease([release('v0.5.0')])?.version, '0.5.0');
check('skips drafts', pickRelease([release('v0.6.0', {draft: true}), release('v0.5.0')])?.version, '0.5.0');
check('skips releases without metadata.json (0.4.0 and older)',
    pickRelease([release('v0.4.0', {assets: [release('v0.4.0').assets[0]]})]), null);
check('only downloads from this project',
    pickRelease([release('v9.0.0', {assets: release('v9.0.0').assets.map(a =>
        ({...a, browser_download_url: a.browser_download_url.replace('GabrielGirardi/ledge', 'someone/else')}))})]), null);
check('nothing to pick', pickRelease([]), null);

check('shell major matches a point release', supportsShell({'shell-version': ['46']}, '46.2'), true);
check('other shells do not match', supportsShell({'shell-version': ['46', '47']}, '48.1'), false);

if (failures) {
    print(`${failures} failed`);
    System.exit(1);
}
