import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionMonitor } from '../src/connection.js';
function setup(fetcher, onlineHint = () => true) {
    const changes = [];
    const monitor = createConnectionMonitor('http://api.test', value => changes.push(value), { fetcher, onlineHint, timeout: 10 });
    return { changes, monitor };
}
test('browser online hint alone does not confirm API connectivity', async () => {
    const { monitor, changes } = setup(async () => { throw new TypeError('Failed to fetch'); });
    assert.equal(await monitor.check(), false);
    assert.deepEqual(changes, ['unavailable']);
});
test('offline browser never sends a health request', async () => {
    const { monitor, changes } = setup(async () => { throw new Error('Must not fetch'); }, () => false);
    assert.equal(await monitor.check(), false);
    assert.deepEqual(changes, ['offline']);
});
test('valid uncached health probe confirms connection and recovery', async () => {
    let available = false;
    const { monitor, changes } = setup(async (url, init) => {
        assert.equal(url, 'http://api.test/health');
        assert.equal(init?.cache, 'no-store');
        if (!available)
            throw new Error('API stopped');
        return Response.json({ status: 'ok' });
    });
    await monitor.check();
    available = true;
    assert.equal(await monitor.check(), true);
    assert.deepEqual(changes, ['unavailable', 'online']);
});
test('HTTP failure and wrong response are not reported as online', async () => {
    for (const response of [new Response('Error', { status: 503 }), Response.json({ status: 'wrong' })]) {
        const { monitor, changes } = setup(async () => response);
        assert.equal(await monitor.check(), false);
        assert.deepEqual(changes, ['unavailable']);
    }
});
test('late successful probe cannot overwrite a newer offline state', async () => {
    let online = true;
    let resolve;
    const { monitor, changes } = setup(() => new Promise(r => { resolve = r; }), () => online);
    const first = monitor.check();
    online = false;
    await monitor.check();
    resolve(Response.json({ status: 'ok' }));
    await first;
    assert.deepEqual(changes, ['offline']);
});
test('timeout marks API unavailable, disposal ignores outstanding result', async () => {
    const { monitor, changes } = setup((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
    }));
    assert.equal(await monitor.check(), false);
    assert.deepEqual(changes, ['unavailable']);
    let resolve;
    const other = setup(() => new Promise(r => { resolve = r; }));
    const pending = other.monitor.check();
    other.monitor.dispose();
    resolve(Response.json({ status: 'ok' }));
    await pending;
    assert.deepEqual(other.changes, []);
});
test('frequent checks share an in-flight request and allow the next probe after completion', async () => {
    let requests = 0;
    let resolve;
    const { monitor, changes } = setup(() => {
        requests++;
        return new Promise(r => { resolve = r; });
    });
    const first = monitor.check();
    assert.equal(monitor.check(), first);
    assert.equal(monitor.check(), first);
    assert.equal(requests, 1);
    resolve(Response.json({ status: 'ok' }));
    assert.equal(await first, true);
    const next = monitor.check();
    assert.equal(requests, 2);
    resolve(Response.json({ status: 'ok' }));
    assert.equal(await next, true);
    assert.deepEqual(changes, ['online']);
});
