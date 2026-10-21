import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/storage.js';
import { editTask, readState, dismissConflict, sync } from '../src/sync.js';
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
const server = new Map();
const seen = new Map();
let fail = false;
let loseAck = false;
globalThis.fetch = async (_url, options) => {
    if (fail)
        throw new Error('API unavailable');
    if (options?.method === 'POST') {
        const m = JSON.parse(String(options.body));
        if (seen.has(m.mutationId))
            return Response.json({ task: seen.get(m.mutationId) });
        const old = server.get(m.taskId);
        if ((old?.version || 0) !== m.baseVersion)
            return Response.json({ detail: { server: old || null } }, { status: 409 });
        const task = { id: m.taskId, title: m.title, completed: m.completed, deleted: m.deleted, version: (old?.version || 0) + 1, updatedAt: new Date().toISOString() };
        server.set(task.id, task);
        seen.set(m.mutationId, task);
        if (loseAck) {
            loseAck = false;
            throw new Error('Response lost after commit');
        }
        return Response.json({ task });
    }
    return Response.json({ tasks: [...server.values()] });
};
beforeEach(async () => {
    // Ensure schema exists before clearing it.
    await readState();
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    server.clear();
    seen.clear();
    fail = false;
    loseAck = false;
    Object.assign(navigator, { onLine: true });
});
const log = () => { };
test('create, update, delete and sync work without crypto.randomUUID on HTTP', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
    try {
        const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
        await editTask(null, { title: 'HTTP task' });
        const state = await readState();
        const id = state.tasks[0].id;
        assert.match(id, uuidV4);
        assert.match(state.queue[0].mutationId, uuidV4);
        assert.notEqual(id, state.queue[0].mutationId);
        await sync(log);
        await editTask(id, { completed: true });
        await sync(log);
        assert.equal(server.get(id).completed, true);
        await editTask(id, { deleted: true });
        await sync(log);
        assert.equal(server.get(id).deleted, true);
        assert.equal((await readState()).queue.length, 0);
    } finally {
        Object.defineProperty(globalThis, 'crypto', descriptor);
    }
});
test('offline changes are coalesced, persisted and pushed on reconnect', async () => {
    Object.assign(navigator, { onLine: false });
    await editTask(null, { title: 'Offline task' });
    const id = (await readState()).tasks[0].id;
    await editTask(id, { completed: true });
    await sync(log);
    assert.equal((await readState()).queue.length, 1);
    assert.equal(server.size, 0);
    Object.assign(navigator, { onLine: true });
    await sync(log);
    assert.equal((await readState()).queue.length, 0);
    assert.equal(server.get(id)?.completed, true);
});
test('failed API preserves outbox, lost acknowledgement safely replays', async () => {
    await editTask(null, { title: 'Retry' });
    fail = true;
    await assert.rejects(sync(log));
    assert.equal((await readState()).queue.length, 1);
    fail = false;
    loseAck = true;
    await assert.rejects(sync(log));
    assert.equal((await readState()).queue.length, 1);
    await sync(log);
    assert.equal((await readState()).tasks[0].version, 1);
    assert.equal((await readState()).queue.length, 0);
});
test('delete survives offline and is pulled as a tombstone', async () => {
    await editTask(null, { title: 'Delete me' });
    await sync(log);
    const id = (await readState()).tasks[0].id;
    await editTask(id, { deleted: true });
    assert.equal((await readState()).queue[0].deleted, true);
    await sync(log);
    assert.equal(server.get(id)?.deleted, true);
    assert.equal((await readState()).tasks[0].deleted, true);
});
test('conflict reports the rejected record and automatically renders the server version', async () => {
    await editTask(null, { title: 'Original' });
    await sync(log);
    const task = (await readState()).tasks[0];
    server.set(task.id, { ...task, title: 'Other device', version: 2 });
    await editTask(task.id, { title: 'My offline edit' });
    await sync(log);
    const state = await readState();
    assert.equal(state.conflicts.length, 1);
    assert.equal(state.conflicts[0].local.title, 'My offline edit');
    assert.equal(state.tasks[0].title, 'Other device');
    assert.equal(state.tasks[0].version, 2);
    assert.equal(state.queue.length, 0);
    await sync(log);
    assert.equal(server.get(task.id)?.version, 2);
    assert.equal((await readState()).conflicts.length, 1);
    await dismissConflict(task.id);
    assert.equal((await readState()).conflicts.length, 0);
});
test('remote deletion automatically removes the conflicted local record', async () => {
    await editTask(null, { title: 'Original' });
    await sync(log);
    const task = (await readState()).tasks[0];
    server.set(task.id, { ...task, deleted: true, version: 2 });
    await editTask(task.id, { title: 'Stale edit' });
    await sync(log);
    const state = await readState();
    assert.equal(state.queue.length, 0);
    assert.equal(state.tasks[0].deleted, true);
    assert.equal(state.conflicts[0].server?.deleted, true);
});
test('conflict does not block unrelated records or subsequent edits against the server version', async () => {
    await editTask(null, { title: 'Original' });
    await sync(log);
    const task = (await readState()).tasks[0];
    server.set(task.id, { ...task, title: 'Other device', version: 2 });
    await editTask(task.id, { title: 'Rejected edit' });
    await editTask(null, { title: 'Unrelated task' });
    await sync(log);
    assert.equal(server.size, 2);
    assert.equal((await readState()).queue.length, 0);
    await editTask(task.id, { completed: true });
    assert.equal((await readState()).queue[0].baseVersion, 2);
    await sync(log);
    assert.equal(server.get(task.id)?.version, 3);
    assert.equal(server.get(task.id)?.title, 'Other device');
    assert.equal((await readState()).conflicts.length, 0);
});
