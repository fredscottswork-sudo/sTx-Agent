const $ = (selector, root = document) => root.querySelector(selector);
const list = $('#task-list');
const content = $('#detail-content');
const dot = $('#connection-dot');
const connection = $('#connection-label');
const toast = $('#toast');
let selectedId = null;
let knownTaskIds = new Set();
let refreshTimer = null;

const tokenDialog = $('#token-dialog');
const tokenInput = $('#api-token');
const tokenForm = $('#token-form');
let apiToken = sessionStorage.getItem('stx_api_token') || '';

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (apiToken) headers.set('Authorization', `Bearer ${apiToken}`);
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const value = await response.json().catch(() => ({}));
  if (response.status === 401) {
    tokenDialog.showModal();
    throw new Error('A valid server token is required.');
  }
  if (!response.ok) throw new Error(value.message || value.error || `HTTP ${response.status}`);
  return value;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setConnection(online, label) {
  dot.classList.toggle('online', online);
  dot.classList.toggle('offline', !online);
  connection.textContent = label;
}

function makeTaskCard(task) {
  const button = element('button', `task-card${task.id === selectedId ? ' active' : ''}`);
  button.type = 'button';
  button.addEventListener('click', () => selectTask(task.id));
  const top = element('div', 'task-card-top');
  const status = element('span', `pill ${task.status}`, task.status.replaceAll('_', ' '));
  const date = element('span', 'task-meta', new Date(task.updated_at).toLocaleString());
  top.append(status, date);
  const prompt = element('p', '', task.instruction || 'Task');
  button.append(top, prompt);
  return button;
}

async function refreshTasks() {
  try {
    const data = await api('/api/tasks?limit=60');
    const tasks = data.tasks || [];
    setConnection(true, 'Connected');
    const currentIds = new Set(tasks.map(task => task.id));
    if (selectedId && !currentIds.has(selectedId)) selectedId = null;
    list.replaceChildren();
    if (!tasks.length) list.append(element('p', 'muted', 'No tasks yet. Start with a question or a small project change.'));
    for (const task of tasks) list.append(makeTaskCard(task));
    knownTaskIds = currentIds;
    if (selectedId) await loadTask(selectedId);
  } catch (error) {
    setConnection(false, 'Disconnected');
    if (!list.children.length) list.append(element('p', 'muted', error.message));
  }
}

function addBlock(parent, title, value) {
  if (!value) return;
  const block = element('section', 'detail-block');
  block.append(element('h3', '', title), element('p', '', value));
  parent.append(block);
}

async function loadTask(taskId) {
  try {
    const task = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
    if (task.error) throw new Error(task.error);
    $('#detail-title').textContent = `Task ${task.id.slice(0, 8)}`;
    const status = $('#detail-status');
    status.textContent = task.status.replaceAll('_', ' ');
    status.className = `status pill ${task.status}`;
    content.replaceChildren();
    addBlock(content, 'Instruction', task.instruction);
    if (task.last_event) addBlock(content, 'Latest event', `${task.last_event.type} · ${new Date(task.last_event.timestamp).toLocaleTimeString()}`);
    if (task.answer) addBlock(content, 'Result', task.answer);
    if (task.error) addBlock(content, 'Error', task.error);
    if (task.model_turns || task.tool_calls) addBlock(content, 'Run stats', `${task.model_turns || 0} model turns · ${task.tool_calls || 0} tool calls`);

    const pending = (task.approvals || []).filter(item => item.status === 'pending');
    for (const approval of pending) {
      const card = element('section', 'approval');
      card.append(element('h3', '', `Approval required · ${approval.tool_name}`));
      card.append(element('p', '', `${approval.capability} · ${approval.risk} risk\n\n${approval.details}`));
      const actions = element('div', 'form-row');
      const deny = element('button', 'danger', 'Deny');
      const approve = element('button', 'primary', 'Approve');
      deny.type = approve.type = 'button';
      deny.addEventListener('click', () => answerApproval(task.id, approval.id, false));
      approve.addEventListener('click', () => answerApproval(task.id, approval.id, true));
      actions.append(deny, approve);
      card.append(actions);
      content.append(card);
    }
    const active = ['queued', 'running', 'awaiting_approval', 'cancelling'].includes(task.status);
    if (active) {
      const actions = element('div', 'detail-actions');
      const cancel = element('button', 'danger', 'Cancel task');
      cancel.type = 'button';
      cancel.addEventListener('click', () => cancelTask(task.id));
      actions.append(cancel);
      content.prepend(actions);
    }
    if (!content.children.length) content.append(element('p', 'muted', 'No additional task details yet.'));
  } catch (error) {
    content.replaceChildren(element('p', 'muted', error.message));
  }
}

async function selectTask(taskId) {
  selectedId = taskId;
  await refreshTasks();
}

async function answerApproval(taskId, approvalId, approved) {
  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST', body: JSON.stringify({ approved }),
    });
    notify(approved ? 'Approval recorded.' : 'Action denied.');
    await refreshTasks();
  } catch (error) { notify(error.message); }
}

async function cancelTask(taskId) {
  try {
    const response = await api(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', body: '{}' });
    notify(response.cancelled ? 'Cancellation requested.' : 'Task is no longer active.');
    await refreshTasks();
  } catch (error) { notify(error.message); }
}

$('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const task = $('#task').value.trim();
  if (!task) return;
  button.disabled = true;
  try {
    const created = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ task, dry_run: $('#dry-run').checked }),
    });
    $('#task').value = '';
    selectedId = created.id;
    notify('Task queued.');
    await refreshTasks();
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; }
});

$('#refresh').addEventListener('click', refreshTasks);
tokenForm.addEventListener('submit', event => {
  if (event.submitter?.id === 'save-token') {
    event.preventDefault();
    apiToken = tokenInput.value.trim();
    if (apiToken) sessionStorage.setItem('stx_api_token', apiToken);
    else sessionStorage.removeItem('stx_api_token');
    tokenInput.value = '';
    tokenDialog.close();
    refreshTasks();
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && tokenDialog.open) tokenDialog.close();
});
refreshTasks();
refreshTimer = setInterval(refreshTasks, 2500);
