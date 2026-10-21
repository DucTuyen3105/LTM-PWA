const $ = id => document.getElementById(id);
let busy = false;
const logs = [];

export function showError(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
}

export function setBusy(value) {
  busy = value;
  document.querySelectorAll('[data-lock]').forEach(button => { button.disabled = busy; });
  $('sync-button').textContent = busy ? 'Đang sync…' : '↻ Đồng bộ ngay';
}

export function showConnection(status) {
  const labels = { checking: 'Đang kiểm tra kết nối…', online: 'Online', offline: 'Offline', unavailable: 'Không kết nối được máy chủ' };
  $('connection-status').className = `badge ${status}`;
  $('connection-status').textContent = `● ${labels[status]}`;
}

export function log(message) {
  logs.unshift(`${new Date().toLocaleTimeString()} ${message}`);
  logs.length = Math.min(logs.length, 40);
  $('sync-log').textContent = logs.join('\n');
}

export function renderState(state) {
  const tasks = state.tasks.filter(task => !task.deleted);
  $('task-count').textContent = tasks.length;
  $('queue-count').textContent = state.queue.length;
  $('conflict-count').textContent = state.conflicts.length;
  $('empty-state').hidden = tasks.length > 0;
  const nodes = tasks.map(task => {
    const node = $('task-template').content.firstElementChild.cloneNode(true);
    node.dataset.taskId = task.id;
    node.querySelector('input').checked = task.completed;
    node.querySelector('strong').textContent = task.title;
    node.querySelector('strong').classList.toggle('done', task.completed);
    const pending = state.queue.some(change => change.taskId === task.id);
    node.querySelector('small').textContent = `Version ${task.version} · ${pending ? '⏳ Chờ gửi' : '✓ Server đã xác nhận'}`;
    return node;
  });
  $('task-list').replaceChildren(...nodes);
  $('last-sync').textContent = `Đồng bộ gần nhất: ${state.lastSync ? new Date(state.lastSync).toLocaleString() : 'chưa có'}`;
  $('outbox').textContent = JSON.stringify(state.queue, null, 2);
  renderConflicts(state.conflicts);
  setBusy(busy);
}

function renderConflicts(conflicts) {
  $('conflicts').hidden = conflicts.length === 0;
  $('conflict-list').replaceChildren(...conflicts.map(conflict => {
    const node = document.createElement('article');
    const description = document.createElement('p');
    description.textContent = `Không lưu được thay đổi cho công việc “${conflict.local.title}” vì dữ liệu trên máy chủ đã thay đổi.`;
    const result = document.createElement('p');
    result.textContent = !conflict.server || conflict.server.deleted
      ? 'Công việc đã bị xóa trên máy chủ và được bỏ khỏi danh sách.'
      : `Đã hiển thị bản mới nhất từ máy chủ: “${conflict.server.title}”.`;
    const button = document.createElement('button');
    button.textContent = 'Đã hiểu';
    button.dataset.taskId = conflict.local.taskId;
    node.append(description, result, button);
    return node;
  }));
}

export function renderServer(tasks) {
  $('server-tasks').replaceChildren(...tasks.map(task => {
    const row = document.createElement('tr');
    for (const value of [task.title, task.version, task.deleted ? 'Đã xóa' : task.completed ? 'Hoàn thành' : 'Đang làm']) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  }));
  $('server-seen').textContent = `Đọc lúc ${new Date().toLocaleTimeString()}.`;
}
