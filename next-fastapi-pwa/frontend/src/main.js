import './styles.css';
import { API, CONNECTION_INTERVAL, SYNC_INTERVAL } from './config.js';
import { readState, editTask, dismissConflict, sync } from './sync.js';
import { createConnectionMonitor } from './connection.js';
import { setupPwa } from './pwa.js';
import { renderState, renderServer, showConnection, showError, setBusy, log } from './view.js';

let state = { tasks: [], queue: [], conflicts: [], lastSync: null };
let running = false;
let disposed = false;
const listeners = [];
const connection = createConnectionMonitor(API, status => {
  showConnection(status);
  if (status === 'online') void synchronize();
});

document.getElementById('api-docs').href = `${API}/docs`;

async function refresh() {
  const latest = await readState();
  if (!disposed) { state = latest; renderState(state); }
}

async function inspectServer() {
  const response = await fetch(`${API}/tasks`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Không đọc được server: HTTP ${response.status}`);
  const { tasks } = await response.json();
  if (!disposed) renderServer(tasks);
}

async function synchronize() {
  if (running || disposed) return;
  running = true;
  setBusy(true);
  showError();
  try {
    if (!(await connection.check())) return;
    await sync(log);
    await inspectServer();
  } catch (error) {
    const reachable = await connection.check();
    if (reachable) showError('Chưa đồng bộ được. Vui lòng thử lại.');
    log(String(error));
  } finally {
    try { await refresh(); }
    catch (error) { if (!disposed) showError(String(error)); }
    finally { running = false; if (!disposed) setBusy(false); }
  }
}

async function change(id, changes) {
  try {
    await editTask(id, changes);
    await refresh();
    await synchronize();
  } catch (error) { showError(String(error)); }
}

function listen(target, name, handler) {
  target.addEventListener(name, handler);
  listeners.push(() => target.removeEventListener(name, handler));
}

listen(document.getElementById('task-form'), 'submit', event => {
  event.preventDefault();
  const input = document.getElementById('task-input');
  const title = input.value;
  if (!title.trim()) return;
  input.value = '';
  void change(null, { title });
});

// Event delegation keeps task handlers independent of list re-rendering.
listen(document.getElementById('task-list'), 'click', event => {
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  const id = control.closest('[data-task-id]').dataset.taskId;
  const task = state.tasks.find(task => task.id === id);
  if (!task) return;
  if (control.dataset.action === 'toggle') void change(id, { completed: control.checked });
  if (control.dataset.action === 'delete') void change(id, { deleted: true });
  if (control.dataset.action === 'edit') {
    const title = prompt('Sửa công việc', task.title);
    if (title !== null) void change(id, { title });
  }
});

listen(document.getElementById('conflict-list'), 'click', event => {
  const button = event.target.closest('button[data-task-id]');
  if (button) void dismissConflict(button.dataset.taskId).then(refresh).catch(error => showError(String(error)));
});
listen(document.getElementById('sync-button'), 'click', () => void synchronize());
listen(document.getElementById('refresh-server'), 'click', async () => {
  try { if (await connection.check()) await inspectServer(); }
  catch (error) { log(String(error)); void connection.check(); }
});
listen(window, 'sync-state', () => void refresh().catch(error => showError(String(error))));
const check = () => { void connection.check(); };
listen(window, 'online', check);
listen(window, 'offline', check);
listen(window, 'focus', check);
listen(document, 'visibilitychange', () => { if (!document.hidden) check(); });

const connectionTimer = setInterval(check, CONNECTION_INTERVAL);
const syncTimer = setInterval(() => { if (navigator.onLine) void synchronize(); }, SYNC_INTERVAL);
void refresh().then(check).catch(error => showError(String(error)));
void setupPwa(log).catch(error => log(`PWA: ${error}`));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    connection.dispose();
    clearInterval(connectionTimer);
    clearInterval(syncTimer);
    listeners.forEach(remove => remove());
  });
}
