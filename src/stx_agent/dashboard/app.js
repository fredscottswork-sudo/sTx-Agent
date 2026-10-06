const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  page: 'overview',
  token: sessionStorage.getItem('stx_api_token') || '',
  settings: null,
  overview: null,
  tasks: [],
  approvals: [],
  index: null,
  audit: null,
  selectedTaskId: null,
  memoryReadConfirmed: false,
  loading: false,
};

const tokenDialog = $('#token-dialog');
const tokenForm = $('#token-form');
const tokenInput = $('#api-token');
const toast = $('#toast');

const pageCopy = {
  overview: ['Overview', 'A clear view of your agent, active work, and policy.'],
  tasks: ['Task management', 'Inspect runs, handle approvals, and manage task history.'],
  memory: ['Project memory', 'Review and manage explicit local context.'],
  workspace: ['Workspace index', 'Inspect bounded local project metadata.'],
  security: ['Security audit', 'Read-only checks of policy and local storage.'],
  settings: ['Agent settings', 'Review providers, permissions, and operating limits.'],
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function safeDate(value, options = {}) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, options);
}

function shortDate(value) {
  return safeDate(value, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatStatus(value) {
  return String(value || 'unknown').replaceAll('_', ' ');
}

function notify(message, kind = 'normal') {
  toast.textContent = message;
  toast.classList.toggle('error', kind === 'error');
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 3600);
}

function setConnection(online, message) {
  $('#connection-dot').classList.toggle('online', online);
  $('#connection-dot').classList.toggle('offline', !online);
  $('#connection-label').textContent = message;
  const badge = $('#runtime-badge');
  badge.className = `state-badge ${online ? 'ok' : 'error'}`;
  badge.replaceChildren(el('span'), document.createTextNode(online ? 'Online' : 'Disconnected'));
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const value = await response.json().catch(() => ({}));
  if (response.status === 401) {
    state.token = '';
    sessionStorage.removeItem('stx_api_token');
    if (!tokenDialog.open) tokenDialog.showModal();
    throw new Error('A valid server token is required.');
  }
  if (!response.ok) {
    const error = new Error(value.message || value.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = value.error;
    throw error;
  }
  return value;
}

function setPage(name) {
  if (!pageCopy[name]) return;
  state.page = name;
  for (const page of $$('.page')) {
    const active = page.dataset.page === name;
    page.hidden = !active;
    page.classList.toggle('active', active);
  }
  for (const link of $$('[data-nav]')) {
    const active = link.dataset.nav === name;
    link.classList.toggle('active', active);
    if (active && link.matches('button')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('#page-title').textContent = pageCopy[name][0];
  $('#page-subtitle').textContent = pageCopy[name][1];
  closeMobileNav();
  if (name === 'memory') loadMemories();
  if (name === 'workspace') loadIndexStatus();
  if (name === 'security') loadAudit();
  if (name === 'settings') loadSettings();
  if (name === 'tasks') renderTasks();
}

function closeMobileNav() {
  $('#sidebar').classList.remove('open');
  document.body.classList.remove('nav-open');
}

function openTaskComposer() {
  if (state.page !== 'overview') setPage('overview');
  $('#task-input').focus({ preventScroll: false });
  $('#task-launcher').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateStatusPill(node, status) {
  node.className = `status-pill ${status || 'unknown'}`;
  node.textContent = formatStatus(status);
}

function renderOverview() {
  const overview = state.overview;
  if (!overview) return;
  const counts = overview.task_counts || {};
  $('#workspace-name').textContent = overview.workspace_name || 'Workspace';
  $('#workspace-version').textContent = overview.version ? `v${overview.version}` : '—';
  $('#runtime-workspace').textContent = overview.workspace_name || 'Workspace';
  $('#runtime-mode').textContent = overview.autonomy || '—';
  $('#runtime-profiles').textContent = `${overview.model_profiles || 0} configured`;
  $('#metric-active').textContent = overview.active_tasks ?? '0';
  $('#metric-approvals').textContent = overview.pending_approvals ?? '0';
  $('#metric-completed').textContent = counts.completed ?? 0;
  $('#metric-review').textContent = overview.needs_review ?? 0;
  $('#nav-active-count').textContent = overview.active_tasks ?? 0;
  $('#runtime-network').textContent = state.settings?.network?.enabled ? 'Enabled · allow-listed' : 'Disabled';
  const indexStatus = state.index;
  $('#runtime-index').textContent = indexStatus?.available ? `${indexStatus.files} files` : 'Not built';
  renderApprovals($('#overview-approvals'), state.approvals.slice(0, 3));
  renderRecentTasks();
}

function makeApprovalCard(approval, compact = false) {
  const card = el('article', 'approval-item');
  const top = el('div', 'approval-item-top');
  top.append(el('strong', '', approval.tool_name || 'Tool action'));
  top.append(el('span', 'risk-chip', `${approval.risk || 'unknown'} risk`));
  card.append(top);
  card.append(el('p', 'approval-instruction', approval.instruction || 'Task request'));
  const detailText = `${approval.capability || 'capability'} · ${approval.details || 'Review the exact action before allowing it.'}`;
  card.append(el('span', 'approval-detail', detailText));
  const actions = el('div', 'approval-actions');
  const open = el('button', 'secondary-button', 'Review task');
  open.type = 'button';
  open.addEventListener('click', () => openTask(approval.task_id));
  actions.append(open);
  const deny = el('button', 'danger-button', 'Deny');
  deny.type = 'button';
  deny.addEventListener('click', () => answerApproval(approval.task_id, approval.id, false));
  const approve = el('button', 'primary-button', 'Approve');
  approve.type = 'button';
  approve.addEventListener('click', () => answerApproval(approval.task_id, approval.id, true));
  actions.append(deny, approve);
  card.append(actions);
  if (compact) card.classList.add('compact');
  return card;
}

function renderApprovals(container, approvals) {
  container.replaceChildren();
  if (!approvals.length) {
    container.append(el('p', 'empty-state', 'No actions are waiting for approval. STX cannot approve its own pending actions.'));
    return;
  }
  for (const approval of approvals) container.append(makeApprovalCard(approval, true));
}

function renderRecentTasks() {
  const container = $('#recent-tasks');
  container.replaceChildren();
  const recent = state.tasks.slice(0, 5);
  if (!recent.length) {
    container.append(el('p', 'empty-state', 'No tasks yet. Start with a small, verifiable request.'));
    return;
  }
  for (const task of recent) {
    const button = el('button', 'recent-item');
    button.type = 'button';
    const copy = el('span');
    copy.append(el('span', 'recent-prompt', task.instruction || 'Task'));
    copy.append(el('span', 'recent-meta', `${shortDate(task.updated_at)} · ${task.tool_calls || 0} tool calls`));
    const status = el('span', 'status-pill');
    updateStatusPill(status, task.status);
    button.append(copy, status);
    button.addEventListener('click', () => openTask(task.id));
    container.append(button);
  }
}

function openTask(taskId) {
  state.selectedTaskId = taskId;
  setPage('tasks');
  loadTask(taskId);
}

async function submitTask(event) {
  event.preventDefault();
  const button = $('#task-submit');
  const task = $('#task-input').value.trim();
  if (!task) return;
  button.disabled = true;
  try {
    const profile = $('#task-profile').value || null;
    const result = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ task, profile, dry_run: $('#task-dry-run').checked }),
    });
    $('#task-input').value = '';
    state.selectedTaskId = result.id;
    notify('Task queued. Review approvals before any gated action.');
    await refreshLive();
    setPage('tasks');
    await loadTask(result.id);
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function filteredTasks() {
  const query = $('#task-search').value.trim().toLowerCase();
  const status = $('#task-status-filter').value;
  return state.tasks.filter(task => {
    const matchesStatus = status === 'all' || task.status === status;
    const matchesQuery = !query || `${task.instruction || ''} ${task.id} ${task.status}`.toLowerCase().includes(query);
    return matchesStatus && matchesQuery;
  });
}

function renderTasks() {
  const container = $('#task-list');
  if (!container) return;
  const tasks = filteredTasks();
  $('#task-list-count').textContent = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
  container.replaceChildren();
  if (!tasks.length) {
    container.append(el('p', 'empty-state', state.tasks.length ? 'No tasks match these filters.' : 'No task history yet. Start a task from Overview.'));
  }
  for (const task of tasks) {
    const button = el('button', `task-card${task.id === state.selectedTaskId ? ' active' : ''}`);
    button.type = 'button';
    const top = el('div', 'task-card-top');
    const status = el('span', 'status-pill');
    updateStatusPill(status, task.status);
    top.append(status, el('span', 'task-card-date', shortDate(task.updated_at)));
    button.append(top, el('p', 'task-card-prompt', task.instruction || 'Task'));
    const foot = el('div', 'task-card-foot');
    foot.append(el('span', '', `${task.model_turns || 0} turns`), el('span', '', '·'), el('span', '', `${task.tool_calls || 0} tool calls`));
    if (task.dry_run) foot.append(el('span', '', '· dry run'));
    button.append(foot);
    button.addEventListener('click', () => {
      state.selectedTaskId = task.id;
      renderTasks();
      loadTask(task.id);
    });
    container.append(button);
  }
}

function addDetailSection(parent, label, value, className = '') {
  if (value === undefined || value === null || value === '') return;
  const section = el('section', `detail-section${className ? ` ${className}` : ''}`);
  section.append(el('p', 'detail-label', label), el('p', 'detail-copy', value));
  parent.append(section);
}

function makeDetailMeta(label, value) {
  const item = el('div', 'detail-meta');
  item.append(el('span', '', label), el('strong', '', value));
  return item;
}

async function loadTask(taskId) {
  const inspector = $('#task-inspector');
  if (!taskId) return;
  inspector.replaceChildren(el('p', 'empty-state', 'Loading task details…'));
  try {
    const task = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
    if (task.error) throw new Error(task.message || task.error);
    if (state.selectedTaskId !== taskId || state.page !== 'tasks') return;
    inspector.replaceChildren();
    const head = el('div', 'task-detail-head');
    const title = el('div');
    title.append(el('p', 'eyebrow', 'TASK DETAIL'), el('h2', '', task.instruction?.slice(0, 120) || 'Task'));
    title.append(el('div', 'task-id', `ID ${task.id}`));
    const status = el('span', 'status-pill');
    updateStatusPill(status, task.status);
    head.append(title, status);
    inspector.append(head);

    const actions = el('div', 'task-detail-actions');
    const active = ['queued', 'running', 'awaiting_approval', 'cancelling'].includes(task.status);
    if (active) {
      const cancel = el('button', 'danger-button', 'Cancel task');
      cancel.type = 'button';
      cancel.addEventListener('click', () => cancelTask(task.id));
      actions.append(cancel);
    }
    const reuse = el('button', 'secondary-button', 'Use again');
    reuse.type = 'button';
    reuse.addEventListener('click', () => reuseTask(task));
    actions.append(reuse);
    if (!active) {
      const deleteButton = el('button', 'danger-button', 'Delete history');
      deleteButton.type = 'button';
      const deleteMode = state.settings?.permissions?.find(item => item.capability === 'tasks.history.delete')?.mode || 'deny';
      deleteButton.disabled = deleteMode === 'deny';
      deleteButton.title = deleteMode === 'deny' ? 'Denied by active policy' : 'Remove this finished task record';
      deleteButton.addEventListener('click', () => deleteTaskHistory(task.id));
      actions.append(deleteButton);
    }
    inspector.append(actions);

    addDetailSection(inspector, 'Instruction', task.instruction);
    const statsSection = el('section', 'detail-section');
    statsSection.append(el('p', 'detail-label', 'Run information'));
    const stats = el('div', 'detail-meta-grid');
    stats.append(
      makeDetailMeta('PROFILE', task.requested_profile || 'default routing'),
      makeDetailMeta('MODEL TURNS', task.model_turns || 0),
      makeDetailMeta('TOOL CALLS', task.tool_calls || 0),
      makeDetailMeta('MODE', task.dry_run ? 'dry run' : 'normal'),
      makeDetailMeta('CREATED', shortDate(task.created_at)),
      makeDetailMeta('UPDATED', shortDate(task.updated_at)),
    );
    statsSection.append(stats);
    inspector.append(statsSection);
    if (task.last_event) {
      const eventText = `${task.last_event.type || 'event'} · ${safeDate(task.last_event.timestamp)}`;
      addDetailSection(inspector, 'Latest recorded event', eventText);
    }
    if (task.answer) addDetailSection(inspector, task.status === 'completed' ? 'Result' : 'Partial result', task.answer);
    if (task.error) {
      const error = el('div', 'detail-section');
      error.append(el('p', 'detail-label', 'Task error'), el('p', 'detail-error', task.error));
      inspector.append(error);
    }

    const approvals = task.approvals || [];
    if (approvals.length) {
      const section = el('section', 'detail-section');
      section.append(el('p', 'detail-label', 'Approval history'));
      for (const approval of approvals) {
        if (approval.status === 'pending') {
          const card = makeApprovalCard({
            ...approval,
            task_id: task.id,
            instruction: task.instruction,
          });
          card.classList.add('detail-approval');
          section.append(card);
        } else {
          const line = el('div', 'permission-row');
          line.append(el('span', 'permission-name', `${approval.tool_name} · ${approval.capability}`));
          const result = el('span', `permission-mode ${approval.status === 'approved' ? 'allow' : 'deny'}`, approval.status);
          line.append(result);
          section.append(line);
        }
      }
      inspector.append(section);
    }
  } catch (error) {
    inspector.replaceChildren(el('p', 'empty-state', error.message));
  }
}

function reuseTask(task) {
  $('#task-input').value = task.instruction || '';
  $('#task-profile').value = task.requested_profile || '';
  $('#task-dry-run').checked = Boolean(task.dry_run);
  openTaskComposer();
  notify('Task copied into the composer. Review it before starting again.');
}

async function answerApproval(taskId, approvalId, approved) {
  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    });
    notify(approved ? 'Approval recorded.' : 'Action denied.');
    await refreshLive();
    if (state.page === 'tasks' && state.selectedTaskId) await loadTask(state.selectedTaskId);
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function cancelTask(taskId) {
  try {
    const result = await api(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', body: '{}' });
    notify(result.cancelled ? 'Cancellation requested. In-flight provider calls may take time to stop.' : 'Task is no longer active.');
    await refreshLive();
    if (state.page === 'tasks') await loadTask(taskId);
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function deleteTaskHistory(taskId) {
  if (!window.confirm('Permanently delete this finished task record and its approval history? This cannot be undone.')) return;
  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmed: true }),
    });
    if (state.selectedTaskId === taskId) state.selectedTaskId = null;
    notify('Task history deleted.');
    await refreshLive();
    if (state.page === 'tasks') {
      $('#task-inspector').replaceChildren(el('div', 'inspector-empty'));
      const empty = $('.inspector-empty', $('#task-inspector'));
      empty.append(el('span', 'empty-mark', '◎'), el('h2', '', 'Select a task'), el('p', '', 'Task status, approvals, run outcome, and actions appear here.'));
    }
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function refreshLive() {
  try {
    const [overview, tasks, approvals, index] = await Promise.all([
      api('/api/overview'),
      api('/api/tasks?limit=100'),
      api('/api/approvals?limit=100'),
      api('/api/index'),
    ]);
    state.overview = overview;
    state.tasks = tasks.tasks || [];
    state.approvals = approvals.approvals || [];
    state.index = index;
    setConnection(true, 'Connected');
    renderOverview();
    renderTasks();
    if (state.page === 'tasks' && state.selectedTaskId && state.tasks.some(task => task.id === state.selectedTaskId)) {
      await loadTask(state.selectedTaskId);
    } else if (state.selectedTaskId && !state.tasks.some(task => task.id === state.selectedTaskId)) {
      state.selectedTaskId = null;
    }
    if (state.page === 'workspace') renderIndex(index);
  } catch (error) {
    setConnection(false, 'Disconnected');
    if (error.status !== 401) notify(`Control API unavailable: ${error.message}`, 'error');
  }
}

async function loadSettings(force = false) {
  if (state.settings && !force) {
    renderSettings();
    renderProfileOptions();
    return;
  }
  try {
    state.settings = await api('/api/settings');
    renderSettings();
    renderProfileOptions();
    renderOverview();
  } catch (error) {
    if (state.page === 'settings') $('#profile-list').replaceChildren(el('p', 'empty-state', error.message));
    if (error.status !== 401) notify(error.message, 'error');
  }
}

function renderProfileOptions() {
  const select = $('#task-profile');
  if (!select || !state.settings) return;
  const selected = select.value;
  select.replaceChildren(new Option('Default routing', ''));
  for (const profile of state.settings.profiles || []) {
    const option = new Option(`${profile.name} · ${profile.model}`, profile.name);
    select.add(option);
  }
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}

function renderSettings() {
  if (!state.settings) return;
  const settings = state.settings;
  const profileContainer = $('#profile-list');
  profileContainer.replaceChildren();
  $('#profile-count-chip').textContent = `${settings.profiles.length} profile${settings.profiles.length === 1 ? '' : 's'}`;
  if (!settings.profiles.length) profileContainer.append(el('p', 'empty-state', 'No model profiles are configured. Create a profile in the local TOML config before submitting model-backed tasks.'));
  for (const profile of settings.profiles) {
    const card = el('article', 'profile-card');
    const top = el('div', 'profile-card-top');
    top.append(el('strong', '', profile.name));
    if (profile.name === settings.agent.default_profile) top.append(el('span', 'ready-chip', 'DEFAULT'));
    card.append(top, el('p', 'profile-model', profile.model));
    card.append(el('p', 'profile-provider', `${profile.provider} · ${profile.provider_kind} · temperature ${profile.temperature}`));
    card.append(el('p', 'profile-endpoint', profile.endpoint || 'Endpoint not configured'));
    const foot = el('div', 'profile-card-foot');
    foot.append(el('span', '', profile.credential_ready ? 'Credential ready' : 'Credential missing / not required'));
    foot.append(el('span', `ready-chip${profile.credential_ready ? '' : ' missing'}`, profile.credential_ready ? 'READY' : 'CHECK KEY'));
    card.append(foot);
    profileContainer.append(card);
  }

  const permissions = $('#permission-list');
  permissions.replaceChildren();
  for (const item of settings.permissions || []) {
    const row = el('div', 'permission-row');
    row.append(el('span', 'permission-name', item.capability));
    row.append(el('span', `permission-mode ${item.mode}`, item.mode));
    permissions.append(row);
  }
  if (!permissions.children.length) permissions.append(el('p', 'empty-state', 'No explicit capability entries are configured; unlisted capabilities are denied.'));

  const tools = $('#tool-list');
  tools.replaceChildren();
  $('#tool-count-chip').textContent = `${settings.tools.length} tools`;
  for (const tool of settings.tools || []) {
    const row = el('div', 'tool-row');
    const detail = el('div');
    detail.append(el('strong', '', tool.name), el('small', '', `${tool.capability} · ${tool.description}`));
    row.append(detail, el('span', 'tool-policy', tool.permission));
    tools.append(row);
  }
  if (!tools.children.length) tools.append(el('p', 'empty-state', 'No built-in tools are available.'));

  const limits = $('#limits-grid');
  limits.replaceChildren();
  const entries = [
    ['Autonomy', settings.agent.autonomy],
    ['Tool steps / run', settings.agent.max_tool_steps],
    ['Index file cap', settings.index.enabled ? settings.index.max_files : 'disabled'],
    ['Context budget', `${settings.index.context_chars.toLocaleString()} chars`],
    ['Memory retention', settings.memory.enabled ? `${settings.memory.retention_days} days` : 'disabled'],
    ['Task retention', `${settings.tasks.retention_days} days · ${settings.tasks.max_records.toLocaleString()} max`],
    ['Network research', settings.network.enabled ? `${settings.network.allowed_hosts.length} allow-listed host(s)` : 'disabled'],
    ['Config file', settings.config_present ? 'present · read-only here' : 'not found'],
  ];
  for (const [label, value] of entries) {
    const tile = el('div', 'limit-tile');
    tile.append(el('span', '', label), el('strong', '', value));
    limits.append(tile);
  }
  if (state.index) renderIndex(state.index);
}

async function loadIndexStatus() {
  if (!state.settings) await loadSettings();
  try {
    const index = await api('/api/index');
    state.index = index;
    renderIndex(index);
  } catch (error) {
    $('#index-message').textContent = error.message;
  }
}

function renderIndex(index) {
  if (!index) return;
  $('#index-files').textContent = Number(index.files || 0).toLocaleString();
  $('#index-symbols').textContent = Number(index.symbols || 0).toLocaleString();
  $('#index-bytes').textContent = formatBytes(index.bytes || 0);
  $('#index-updated').textContent = index.last_indexed_at ? safeDate(index.last_indexed_at * 1000) : 'Not indexed yet';
  const badge = $('#index-state-badge');
  badge.className = `state-badge ${index.available ? 'ok' : index.error ? 'error' : ''}`;
  badge.replaceChildren(el('span'), document.createTextNode(index.available ? 'Ready' : index.error ? 'Unreadable' : 'Not built'));
  const runtimeIndex = $('#runtime-index');
  if (runtimeIndex) runtimeIndex.textContent = index.available ? `${index.files} files` : 'Not built';
  const mode = state.settings?.permissions?.find(item => item.capability === 'filesystem.read')?.mode || 'deny';
  const button = $('#index-action');
  button.disabled = !state.settings?.index?.enabled || mode === 'deny';
  button.title = mode === 'deny' ? 'Workspace reads are denied by the active policy' : '';
  $('#index-policy-chip').textContent = mode === 'confirm' ? 'Owner confirmation required' : `filesystem.read · ${mode}`;
  if (index.error) $('#index-message').textContent = 'The existing index database could not be read. Run the local CLI or inspect .stx storage before rebuilding.';
}

async function runIndex() {
  const button = $('#index-action');
  const force = $('#force-index').checked;
  const mode = state.settings?.permissions?.find(item => item.capability === 'filesystem.read')?.mode || 'deny';
  if (mode === 'deny') return notify('Workspace indexing is denied by active policy.', 'error');
  if (mode === 'confirm' && !window.confirm('Index eligible workspace file metadata and selected symbols now?')) return;
  if (force && !window.confirm('Force a full re-parse of every eligible file? This may take longer.')) return;
  button.disabled = true;
  button.textContent = 'Indexing…';
  $('#index-message').textContent = 'Reading eligible files and updating the local index. This may take a moment.';
  try {
    const result = await api('/api/index', {
      method: 'POST',
      body: JSON.stringify({ force, confirmed: mode === 'confirm' }),
    });
    state.index = result.status;
    renderIndex(result.status);
    const summary = result.summary;
    $('#index-message').textContent = `Index refreshed: ${summary.indexed} changed, ${summary.unchanged} unchanged, ${summary.skipped_large} too large, ${summary.skipped_binary} binary.`;
    notify('Workspace index updated.');
  } catch (error) {
    $('#index-message').textContent = error.message;
    notify(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh index ↻';
    renderIndex(state.index);
  }
}

async function loadAudit(force = false) {
  if (state.audit && !force) {
    renderAudit();
    return;
  }
  try {
    state.audit = await api('/api/audit');
    renderAudit();
  } catch (error) {
    if (state.page === 'security') $('#audit-list').replaceChildren(el('p', 'empty-state', error.message));
    if (error.status !== 401) notify(error.message, 'error');
  }
}

function renderAudit() {
  if (!state.audit) return;
  const summary = state.audit.summary || {};
  $('#audit-critical').textContent = summary.critical || 0;
  $('#audit-warning').textContent = summary.warning || 0;
  $('#audit-info').textContent = summary.info || 0;
  $('#audit-timestamp').textContent = safeDate(Date.now(), { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const total = (summary.critical || 0) + (summary.warning || 0) + (summary.info || 0);
  $('#audit-result-label').textContent = total ? `${total} finding${total === 1 ? '' : 's'}` : 'No findings';
  const badge = $('#nav-audit-count');
  const concerns = (summary.critical || 0) + (summary.warning || 0);
  badge.hidden = concerns === 0;
  badge.textContent = concerns > 9 ? '9+' : concerns ? String(concerns) : '!';
  const list = $('#audit-list');
  list.replaceChildren();
  const findings = state.audit.findings || [];
  if (!findings.length) list.append(el('p', 'empty-state', 'No findings from the local checks that ran. This is not a complete security certification.'));
  for (const finding of findings) {
    const card = el('article', 'audit-finding');
    card.append(el('span', `finding-severity ${finding.severity}`, finding.severity));
    const body = el('div', 'finding-content');
    body.append(el('h3', '', finding.title), el('code', 'finding-id', finding.check_id), el('p', '', finding.detail));
    if (finding.remediation) body.append(el('p', 'finding-remediation', `Suggested review: ${finding.remediation}`));
    card.append(body);
    list.append(card);
  }
}

async function loadMemories() {
  const list = $('#memory-list');
  if (!state.settings) await loadSettings();
  const memorySettings = state.settings?.memory;
  if (!memorySettings?.enabled) {
    list.replaceChildren(el('p', 'empty-state', 'Explicit memory is disabled in the active configuration.'));
    $('#memory-count').textContent = 'Disabled';
    $('#memory-submit').disabled = true;
    return;
  }
  const readMode = state.settings?.permissions?.find(item => item.capability === 'memory.read')?.mode || 'deny';
  const writeMode = state.settings?.permissions?.find(item => item.capability === 'memory.write')?.mode || 'deny';
  $('#memory-submit').disabled = writeMode === 'deny';
  $('#memory-policy-chip').textContent = `read ${readMode} · write ${writeMode}`;
  const params = new URLSearchParams({ limit: '100' });
  const search = $('#memory-search').value.trim();
  if (search) params.set('q', search);
  if (readMode === 'confirm') {
    if (!state.memoryReadConfirmed) {
      const consent = window.confirm('Show saved local memory records in this browser? They may contain private project context.');
      if (!consent) {
        list.replaceChildren(el('p', 'empty-state', 'Memory access was not opened. Select Memory again after reviewing the active policy.'));
        return;
      }
      state.memoryReadConfirmed = true;
    }
    params.set('confirmed', '1');
  }
  if (readMode === 'deny') {
    list.replaceChildren(el('p', 'empty-state', 'Memory reads are denied by the active policy. Change the local permission configuration to manage memory here.'));
    $('#memory-count').textContent = 'Access denied';
    return;
  }
  list.replaceChildren(el('p', 'empty-state', 'Loading saved memories…'));
  try {
    const result = await api(`/api/memory?${params.toString()}`);
    renderMemories(result.items || []);
  } catch (error) {
    list.replaceChildren(el('p', 'empty-state', error.message));
  }
}

function relativeExpiry(epochSeconds) {
  const seconds = Number(epochSeconds) - Date.now() / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return 'expired';
  const days = Math.ceil(seconds / 86400);
  return days === 1 ? 'expires in 1 day' : `expires in ${days} days`;
}

function renderMemories(items) {
  const list = $('#memory-list');
  list.replaceChildren();
  $('#memory-count').textContent = `${items.length} shown`;
  if (!items.length) list.append(el('p', 'empty-state', 'No active memories match this filter. Add only durable, non-sensitive project context.'));
  for (const item of items) {
    const card = el('article', 'memory-item');
    const head = el('div', 'memory-item-head');
    head.append(el('span', 'memory-category', item.category), el('span', 'memory-expiry', relativeExpiry(item.expires_at)));
    card.append(head, el('p', 'memory-copy', item.content));
    const foot = el('div', 'memory-item-foot');
    const tags = el('div', 'memory-tags');
    for (const tag of item.tags || []) tags.append(el('span', 'tag', tag));
    tags.append(el('span', 'tag', `importance ${Number(item.importance).toFixed(1)}`));
    foot.append(tags);
    const remove = el('button', 'danger-button memory-delete', 'Forget');
    remove.type = 'button';
    const writeMode = state.settings?.permissions?.find(row => row.capability === 'memory.write')?.mode || 'deny';
    remove.disabled = writeMode === 'deny';
    remove.addEventListener('click', () => forgetMemory(item.id));
    foot.append(remove);
    card.append(foot);
    list.append(card);
  }
}

async function createMemory(event) {
  event.preventDefault();
  const writeMode = state.settings?.permissions?.find(row => row.capability === 'memory.write')?.mode || 'deny';
  if (writeMode === 'deny') return notify('Memory writes are denied by active policy.', 'error');
  const content = $('#memory-content').value.trim();
  if (!content) return;
  if (writeMode === 'confirm' && !window.confirm('Save this text as local, model-retrievable memory? Check that it contains no secrets or private personal data.')) return;
  const tags = $('#memory-tags').value.split(',').map(tag => tag.trim()).filter(Boolean);
  const ttl = Number($('#memory-ttl').value);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3650) return notify('Expiry must be between 1 and 3650 days.', 'error');
  const button = $('#memory-submit');
  button.disabled = true;
  try {
    await api('/api/memory', {
      method: 'POST',
      body: JSON.stringify({
        content,
        category: $('#memory-category').value || 'project',
        importance: Number($('#memory-importance').value),
        ttl_days: ttl,
        tags,
        confirmed: writeMode === 'confirm',
      }),
    });
    $('#memory-form').reset();
    $('#memory-ttl').value = state.settings.memory.retention_days;
    $('#importance-value').textContent = '0.5';
    notify('Memory saved locally.');
    await loadMemories();
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    button.disabled = writeMode === 'deny';
  }
}

async function forgetMemory(id) {
  if (!window.confirm('Permanently remove this memory? It cannot be recovered.')) return;
  try {
    await api(`/api/memory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmed: true }),
    });
    notify('Memory removed.');
    await loadMemories();
  } catch (error) {
    notify(error.message, 'error');
  }
}

let memorySearchTimer = null;
$('#memory-search').addEventListener('input', () => {
  clearTimeout(memorySearchTimer);
  memorySearchTimer = setTimeout(loadMemories, 280);
});
$('#memory-refresh').addEventListener('click', loadMemories);
$('#memory-form').addEventListener('submit', createMemory);
$('#memory-importance').addEventListener('input', event => {
  $('#importance-value').textContent = Number(event.target.value).toFixed(1);
});
$('#memory-category').addEventListener('focus', () => {
  if (state.settings?.memory?.categories?.length && !$('#memory-category').options.length) {
    for (const category of state.settings.memory.categories) $('#memory-category').add(new Option(category, category));
  }
});

async function runAudit() {
  $('#audit-refresh').disabled = true;
  $('#audit-result-label').textContent = 'Checking…';
  try {
    state.audit = await api('/api/audit');
    renderAudit();
    notify('Local read-only security checks finished.');
  } catch (error) {
    $('#audit-list').replaceChildren(el('p', 'empty-state', error.message));
    notify(error.message, 'error');
  } finally {
    $('#audit-refresh').disabled = false;
  }
}

$('#audit-refresh').addEventListener('click', runAudit);
$('#index-action').addEventListener('click', runIndex);
$('#task-form').addEventListener('submit', submitTask);
$('#task-search').addEventListener('input', renderTasks);
$('#task-status-filter').addEventListener('change', renderTasks);
$('#clear-task-filters').addEventListener('click', () => {
  $('#task-search').value = '';
  $('#task-status-filter').value = 'all';
  renderTasks();
});

for (const button of $$('[data-nav]')) {
  button.addEventListener('click', () => setPage(button.dataset.nav));
}
for (const button of $$('[data-focus-task]')) button.addEventListener('click', openTaskComposer);
$('#mobile-menu').addEventListener('click', () => {
  $('#sidebar').classList.toggle('open');
  document.body.classList.toggle('nav-open');
});
document.addEventListener('click', event => {
  if (document.body.classList.contains('nav-open') && !event.target.closest('.sidebar') && !event.target.closest('#mobile-menu')) closeMobileNav();
});
$('#global-refresh').addEventListener('click', async () => {
  await refreshLive();
  await loadSettings(true);
  if (state.page === 'security') await loadAudit(true);
  if (state.page === 'memory') await loadMemories();
  notify('Control data refreshed.');
});

tokenForm.addEventListener('submit', event => {
  if (event.submitter?.id !== 'save-token') return;
  event.preventDefault();
  const token = tokenInput.value.trim();
  if (token.length < 24) return notify('The server token must be at least 24 characters.', 'error');
  state.token = token;
  sessionStorage.setItem('stx_api_token', token);
  tokenInput.value = '';
  tokenDialog.close();
  refreshLive();
  loadSettings(true);
  loadAudit(true);
});
tokenDialog.addEventListener('close', () => {
  if (!state.token) tokenInput.value = '';
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMobileNav();
});

async function initialize() {
  try {
    const health = await api('/api/health');
    setConnection(true, 'Connected');
    $('#workspace-version').textContent = `v${health.version}`;
  } catch (error) {
    setConnection(false, 'Disconnected');
  }
  await Promise.allSettled([refreshLive(), loadSettings(true), loadAudit(true)]);
  renderProfileOptions();
  for (const category of state.settings?.memory?.categories || ['project', 'decision', 'preference', 'error', 'episode', 'working']) {
    $('#memory-category').add(new Option(category, category));
  }
  $('#memory-ttl').value = state.settings?.memory?.retention_days || 180;
  setInterval(refreshLive, 4500);
}

initialize();
