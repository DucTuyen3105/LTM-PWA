import { readWorkspace, writeWorkspace } from './storage.js';
import { API } from './config.js';
import { randomUUID } from './uuid.js';
export { API } from './config.js';
const empty = () => ({ tasks: [], queue: [], conflicts: [], lastSync: null });
export async function readState() {
    return (await readWorkspace()) || empty();
}
async function save(state) {
    await writeWorkspace(state);
    window.dispatchEvent(new Event('sync-state'));
}
let tail = Promise.resolve();
function exclusive(work) {
    const run = async () => navigator.locks ? await navigator.locks.request('sync-lab-write', work) : await work();
    const result = tail.then(run, run);
    tail = result.then(() => undefined, () => undefined);
    return result;
}
export async function editTask(id, changes) {
    await exclusive(async () => {
        const state = await readState();
        const taskId = id || randomUUID();
        const previous = state.tasks.find(t => t.id === taskId);
        const task = { id: taskId, title: '', completed: false, deleted: false, version: 0, ...previous, ...changes, updatedAt: new Date().toISOString() };
        task.title = task.title.trim();
        if (!task.title || task.title.length > 200)
            throw new Error('Nội dung phải có từ 1 đến 200 ký tự.');
        state.conflicts = state.conflicts.filter(c => c.local.taskId !== taskId);
        const pending = state.queue.find(m => m.taskId === taskId);
        // Coalesce unsent edits. Never change an in-flight payload: sync holds this lock.
        const mutation = { mutationId: randomUUID(), taskId, baseVersion: pending?.baseVersion ?? task.version, title: task.title, completed: task.completed, deleted: task.deleted };
        state.tasks = [task, ...state.tasks.filter(t => t.id !== taskId)];
        state.queue = [...state.queue.filter(m => m.taskId !== taskId), mutation];
        await save(state);
    });
}
async function request(path, options) {
    return fetch(`${API}${path}`, { ...options, cache: 'no-store', signal: AbortSignal.timeout(8000) });
}
export async function sync(onLog) {
    return exclusive(async () => {
        if (!navigator.onLine) {
            onLog('Offline: thay đổi đang nằm trong IndexedDB.');
            return;
        }
        const state = await readState();
        onLog(`PUSH: ${state.queue.length} thay đổi đang chờ`);
        // Conflicts use the authoritative server record and do not block other writes.
        for (const mutation of [...state.queue]) {
            const response = await request('/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation) });
            if (response.status === 409) {
                const body = await response.json();
                if (!body.detail || typeof body.detail !== 'object' || !('server' in body.detail))
                    throw new Error('mutationId bị sử dụng lại không hợp lệ.');
                const serverTask = body.detail.server;
                state.tasks = state.tasks.filter(t => t.id !== mutation.taskId);
                if (serverTask)
                    state.tasks.unshift(serverTask);
                state.queue = state.queue.filter(m => m.mutationId !== mutation.mutationId);
                state.conflicts = [
                    ...state.conflicts.filter(c => c.local.taskId !== mutation.taskId),
                    { local: mutation, server: serverTask },
                ];
                await save(state);
                onLog(`CONFLICT: ${mutation.title} — đã bỏ thay đổi local và dùng bản mới nhất từ server.`);
                continue;
            }
            if (!response.ok)
                throw new Error(`Push thất bại: HTTP ${response.status}. Hàng đợi được giữ lại.`);
            const { task } = await response.json();
            state.tasks = [task, ...state.tasks.filter(t => t.id !== task.id)];
            state.queue = state.queue.filter(m => m.mutationId !== mutation.mutationId);
            await save(state);
            onLog(`COMMIT: ${task.title} → server version ${task.version}`);
        }
        const response = await request('/tasks');
        if (!response.ok)
            throw new Error(`Pull thất bại: HTTP ${response.status}`);
        const body = await response.json();
        // Keep only edits that have not yet been accepted or rejected by the server.
        const pendingIds = new Set(state.queue.map(m => m.taskId));
        state.tasks = [...state.tasks.filter(t => pendingIds.has(t.id)), ...body.tasks.filter(t => !pendingIds.has(t.id))];
        // Refresh conflict server versions from the authoritative snapshot.
        state.conflicts = state.conflicts.map(c => ({ ...c, server: body.tasks.find(t => t.id === c.local.taskId) || null }));
        state.lastSync = new Date().toISOString();
        await save(state);
        onLog(`PULL: ${body.tasks.length} bản ghi từ PostgreSQL (bao gồm bản ghi đã xóa)`);
    });
}
export async function dismissConflict(id) {
    await exclusive(async () => {
        const state = await readState();
        state.conflicts = state.conflicts.filter(c => c.local.taskId !== id);
        await save(state);
    });
}
