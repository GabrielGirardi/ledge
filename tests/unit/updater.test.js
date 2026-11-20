// Unit tests for updater.js. Run: gjs -m tests/unit/updater.test.js
import Soup from 'gi://Soup?version=3.0';
import System from 'system';

import {HttpError, newSession} from '../../extension/ledge@gabrielgirardi.github.io/geocode.js';
import {findUpdate, isNewer, parseVersion, pickRelease, supportsShell, UUID} from '../../extension/ledge@gabrielgirardi.github.io/updater.js';

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

// A local server that answers like GitHub does once a network has used up
// its hourly allowance.
const server = new Soup.Server();
server.add_handler(null, (_server, msg) => {
    msg.set_status(403, null);
    msg.set_response('application/json', Soup.MemoryUse.COPY, new TextEncoder().encode('{"message":"API rate limit exceeded"}'));
});
server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
const url = `${server.get_uris()[0].to_string()}releases`;
const error = await findUpdate(newSession(), '0.5.0', '46.0', {url}).catch(e => e);
check('a refusal from GitHub is reported as rate limiting',
    [error instanceof HttpError, error.status, error.rateLimited], [true, 403, true]);
check('a missing page is not rate limiting', new HttpError(404, url).rateLimited, false);

if (failures) {
    print(`${failures} failed`);
    System.exit(1);
}
