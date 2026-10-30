/* =====================================================================
   UnderCover Studio — newsroom admin
   Vanilla JS + supabase-js. No build step: this file ships as-is.
   ===================================================================== */
(function () {
  'use strict';

  /* ── tiny helpers ───────────────────────────────────────────────── */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);

  const pad = (n) => String(n).padStart(2, '0');
  function fmtDate(iso, withTime) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const base = `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`;
    return withTime ? `${base} · ${pad(d.getHours())}:${pad(d.getMinutes())}` : base;
  }
  function relTime(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
    return fmtDate(iso);
  }
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 70);
  const num = (v, fallback = 0) => (Number.isFinite(+v) ? +v : fallback);

  let toastTimer;
  function toast(message, tone) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.dataset.show = '1';
    if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.dataset.show = '0'; }, 3200);
  }

  /* ── state ──────────────────────────────────────────────────────── */
  let sb = null;
  let config = null;
  let session = null;
  let staff = null;
  let view = 'overview';
  let drawer = { open: false, resource: null, row: null };
  const ref = { sections: [], authors: [], shows: [] };
  const counts = {};

  /* ── resources ──────────────────────────────────────────────────── */
  const RESOURCES = {
    stories: {
      label: 'Stories', heading: 'Stories', sub: 'Everything the newsroom has written',
      table: 'stories', order: 'published_at', asc: false, noun: 'story',
      search: ['title', 'slug', 'deck', 'kicker'],
      filters: [
        { key: 'status', options: ['published', 'draft', 'review', 'archived'] },
        { key: 'section_slug', from: 'sections' },
      ],
      columns: [
        { key: 'title', primary: true, render: (r) => `<strong>${esc(r.title)}</strong><small>${esc(r.section_slug || '')} · /${esc(r.slug)}</small>` },
        { key: 'author_slug', label: 'Author', render: (r) => esc((ref.authors.find((a) => a.slug === r.author_slug) || {}).name || r.author_slug || '—') },
        { key: 'status', label: 'Status', render: (r) => badge(r.status) },
        { key: 'published_at', label: 'Published', render: (r) => esc(fmtDate(r.published_at)) },
        { key: 'views', label: 'Views', cls: 'num', render: (r) => esc(r.views || 0) },
      ],
      defaults: { status: 'draft', read_minutes: 4, section_slug: 'news', body: [], tags: [] },
      fields: [
        { key: 'title', label: 'Headline', type: 'text', required: true, wide: true, placeholder: 'What happened, in one line' },
        { key: 'slug', label: 'URL slug', type: 'text', help: 'Leave blank to build it from the headline' },
        { key: 'section_slug', label: 'Section', type: 'select', from: 'sections' },
        { key: 'author_slug', label: 'Author', type: 'select', from: 'authors', blank: '—' },
        { key: 'kicker', label: 'Kicker', type: 'text', placeholder: 'Budget 2026' },
        { key: 'deck', label: 'Standfirst', type: 'textarea', wide: true, rows: 2 },
        { key: 'body', label: 'Story body', type: 'body', wide: true },
        { key: 'image_url', label: 'Lead image', type: 'image', wide: true },
        { key: 'image_caption', label: 'Image caption', type: 'text' },
        { key: 'image_credit', label: 'Image credit', type: 'text' },
        { key: 'tags', label: 'Tags', type: 'tags', help: 'Comma separated' },
        { key: 'location', label: 'Dateline', type: 'text', placeholder: 'Kampala' },
        { key: 'status', label: 'Status', type: 'select', options: ['draft', 'review', 'published', 'archived'] },
        { key: 'published_at', label: 'Publish date', type: 'datetime' },
        { key: 'read_minutes', label: 'Read time (min)', type: 'number' },
        { key: 'is_lead', label: 'Homepage lead', type: 'check' },
        { key: 'is_top', label: 'Top story', type: 'check' },
        { key: 'is_featured', label: 'Editors’ pick', type: 'check' },
        { key: 'seo_title', label: 'SEO title', type: 'text' },
        { key: 'seo_description', label: 'SEO description', type: 'textarea', rows: 2 },
      ],
    },
    videos: {
      label: 'Videos', heading: 'Video', sub: 'Reports, explainers and long-form',
      table: 'videos', order: 'published_at', asc: false, noun: 'video',
      search: ['title', 'show_name', 'section'],
      filters: [{ key: 'status', options: ['published', 'draft'] }],
      columns: [
        { key: 'title', primary: true, render: (r) => `<strong>${esc(r.title)}</strong><small>${esc(r.show_name || '')}</small>` },
        { key: 'duration', label: 'Length' },
        { key: 'status', label: 'Status', render: (r) => badge(r.status) },
        { key: 'published_at', label: 'Added', render: (r) => esc(fmtDate(r.published_at)) },
      ],
      defaults: { status: 'published' },
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true, wide: true },
        { key: 'slug', label: 'Slug', type: 'text' },
        { key: 'show_name', label: 'Show', type: 'text' },
        { key: 'section', label: 'Section', type: 'text' },
        { key: 'duration', label: 'Duration', type: 'text', placeholder: '06:42' },
        { key: 'description', label: 'Description', type: 'textarea', wide: true },
        { key: 'image_url', label: 'Thumbnail', type: 'image', wide: true },
        { key: 'video_url', label: 'Video URL', type: 'url', wide: true, help: 'HLS, MP4, Mux or Vimeo link' },
        { key: 'status', label: 'Status', type: 'select', options: ['published', 'draft'] },
        { key: 'published_at', label: 'Published', type: 'datetime' },
        { key: 'is_featured', label: 'Featured', type: 'check' },
      ],
    },
    shows: {
      label: 'Shows', heading: 'Shows', sub: 'The radio and TV slate',
      table: 'shows', order: 'sort_order', asc: true, noun: 'show',
      search: ['name', 'host'],
      columns: [
        { key: 'name', primary: true, render: (r) => `<strong>${esc(r.name)}</strong><small>${esc(r.days || '')}</small>` },
        { key: 'host', label: 'Host' },
        { key: 'start_time', label: 'Starts', render: (r) => esc((r.start_time || '').slice(0, 5) || '—') },
        { key: 'is_live', label: 'On air', render: (r) => (r.is_live ? badge('live') : '—') },
      ],
      defaults: { sort_order: 0 },
      fields: [
        { key: 'name', label: 'Show name', type: 'text', required: true, wide: true },
        { key: 'slug', label: 'Slug', type: 'text' },
        { key: 'tagline', label: 'Tagline', type: 'text', wide: true },
        { key: 'description', label: 'Description', type: 'textarea', wide: true },
        { key: 'host', label: 'Host', type: 'text' },
        { key: 'days', label: 'Days', type: 'text', placeholder: 'Monday to Friday' },
        { key: 'start_time', label: 'Start', type: 'time' },
        { key: 'end_time', label: 'End', type: 'time' },
        { key: 'image_url', label: 'Image', type: 'image', wide: true },
        { key: 'sort_order', label: 'Order', type: 'number' },
        { key: 'is_live', label: 'Currently on air', type: 'check' },
      ],
    },
    schedule: {
      label: 'Schedule', heading: 'Schedule', sub: 'What is on, and when',
      table: 'schedule_slots', order: 'sort_order', asc: true, noun: 'slot',
      search: ['title', 'host'],
      filters: [{ key: 'day_group', options: ['Weekdays', 'Saturday', 'Sunday'] }],
      columns: [
        { key: 'start_time', label: 'Time', render: (r) => `<span class="mono">${esc(r.start_time)}</span>` },
        { key: 'title', primary: true, render: (r) => `<strong>${esc(r.title)}</strong><small>${esc(r.day_group)}</small>` },
        { key: 'host', label: 'Host' },
      ],
      defaults: { day_group: 'Weekdays', sort_order: 0 },
      fields: [
        { key: 'title', label: 'Programme', type: 'text', required: true, wide: true },
        { key: 'host', label: 'Host', type: 'text' },
        { key: 'start_time', label: 'Start time', type: 'text', placeholder: '06:00' },
        { key: 'day_group', label: 'Days', type: 'select', options: ['Weekdays', 'Saturday', 'Sunday'] },
        { key: 'show_slug', label: 'Linked show', type: 'select', from: 'shows', blank: '—' },
        { key: 'sort_order', label: 'Order', type: 'number' },
      ],
    },
    podcasts: {
      label: 'Podcasts', heading: 'Podcasts', sub: 'On-demand audio',
      table: 'podcasts', order: 'published_at', asc: false, noun: 'episode',
      search: ['title', 'show_name'],
      columns: [
        { key: 'title', primary: true, render: (r) => `<strong>${esc(r.title)}</strong><small>${esc(r.show_name || '')}</small>` },
        { key: 'duration', label: 'Length' },
        { key: 'published_at', label: 'Published', render: (r) => esc(fmtDate(r.published_at)) },
      ],
      defaults: {},
      fields: [
        { key: 'title', label: 'Episode title', type: 'text', required: true, wide: true },
        { key: 'slug', label: 'Slug', type: 'text' },
        { key: 'show_name', label: 'Show', type: 'text' },
        { key: 'duration', label: 'Duration', type: 'text', placeholder: '32 min' },
        { key: 'description', label: 'Description', type: 'textarea', wide: true },
        { key: 'audio_url', label: 'Audio URL', type: 'url', wide: true },
        { key: 'image_url', label: 'Artwork', type: 'image', wide: true },
        { key: 'published_at', label: 'Published', type: 'datetime' },
      ],
    },
    presenters: {
      label: 'Presenters', heading: 'Presenters', sub: 'The voices on air',
      table: 'presenters', order: 'sort_order', asc: true, noun: 'presenter',
      search: ['name', 'show_name'],
      columns: [
        { key: 'name', primary: true, render: (r) => `<strong>${esc(r.name)}</strong><small>${esc(r.show_name || '')}</small>` },
        { key: 'initials', label: 'Initials' },
      ],
      defaults: { sort_order: 0 },
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'text' },
        { key: 'show_name', label: 'Show', type: 'text' },
        { key: 'initials', label: 'Initials', type: 'text' },
        { key: 'bio', label: 'Biography', type: 'textarea', wide: true },
        { key: 'image_url', label: 'Portrait', type: 'image', wide: true },
        { key: 'sort_order', label: 'Order', type: 'number' },
      ],
    },
    ticker: {
      label: 'Ticker', heading: 'Ticker', sub: 'The line that runs across the top of the site',
      table: 'ticker_items', order: 'sort_order', asc: true, noun: 'item',
      search: ['text', 'label'],
      columns: [
        { key: 'label', label: 'Label', render: (r) => badge(r.label.toLowerCase()) },
        { key: 'text', primary: true, render: (r) => `<strong>${esc(r.text)}</strong>` },
        { key: 'active', label: 'Live', render: (r) => (r.active ? '✔' : '—') },
      ],
      defaults: { active: true, sort_order: 0 },
      fields: [
        { key: 'label', label: 'Label', type: 'text', required: true, placeholder: 'Breaking' },
        { key: 'text', label: 'Text', type: 'textarea', required: true, wide: true, rows: 2 },
        { key: 'sort_order', label: 'Order', type: 'number' },
        { key: 'active', label: 'Show on site', type: 'check' },
      ],
    },
    subscribers: {
      label: 'Newsletter', heading: 'Newsletter', sub: 'Readers who asked for The Cover Note',
      table: 'subscribers', order: 'created_at', asc: false, noun: 'subscriber', readOnly: true,
      search: ['email', 'source'],
      columns: [
        { key: 'email', primary: true, render: (r) => `<strong>${esc(r.email)}</strong><small>${esc(r.source || 'website')}</small>` },
        { key: 'created_at', label: 'Joined', render: (r) => esc(fmtDate(r.created_at)) },
      ],
      fields: [],
      toolbarExtra: 'export-subscribers',
    },
    messages: {
      label: 'Inbox', heading: 'Inbox', sub: 'Messages from the contact form',
      table: 'messages', order: 'created_at', asc: false, noun: 'message',
      search: ['name', 'email', 'body'],
      columns: [
        { key: 'name', primary: true, render: (r) => `<strong>${esc(r.name || 'Anonymous')}</strong><small>${esc(r.email || '')}</small>` },
        { key: 'body', label: 'Message', render: (r) => esc(String(r.body || '').slice(0, 90)) + (String(r.body || '').length > 90 ? '…' : '') },
        { key: 'created_at', label: 'Received', render: (r) => esc(relTime(r.created_at)) },
        { key: 'handled', label: '', render: (r) => (r.handled ? badge('archived', 'done') : badge('review', 'new')) },
      ],
      defaults: { handled: false },
      fields: [
        { key: 'name', label: 'From', type: 'text' },
        { key: 'email', label: 'Email', type: 'text' },
        { key: 'body', label: 'Message', type: 'textarea', wide: true, rows: 8 },
        { key: 'handled', label: 'Mark as handled', type: 'check' },
      ],
    },
  };

  function badge(kind, text) {
    const k = String(kind || '').toLowerCase();
    return `<span class="badge badge--${esc(k)}">${esc(text || kind)}</span>`;
  }

  /* ── data access ────────────────────────────────────────────────── */
  async function selectAll(table, order, asc) {
    let q = sb.from(table).select('*');
    if (order) q = q.order(order, { ascending: asc !== false });
    const { data, error } = await q.limit(1000);
    if (error) throw error;
    return data || [];
  }

  async function loadRefs() {
    const [sections, authors, shows] = await Promise.all([
      selectAll('sections', 'sort_order', true),
      selectAll('authors', 'name', true),
      selectAll('shows', 'sort_order', true),
    ]);
    Object.assign(ref, { sections, authors, shows });
  }

  async function countRows(table, extra) {
    let q = sb.from(table).select('id', { count: 'exact', head: true });
    if (extra) q = extra(q);
    const { count } = await q;
    return count || 0;
  }

  /* ── auth ───────────────────────────────────────────────────────── */
  async function loadConfig() {
    const res = await fetch('../assets/site.config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('site.config.json not found');
    return res.json();
  }

  async function start() {
    try {
      config = await loadConfig();
    } catch (err) {
      document.getElementById('login-error').hidden = false;
      document.getElementById('login-error').textContent = 'Configuration missing: ' + err.message;
      document.getElementById('login').hidden = false;
      return;
    }
    sb = window.supabase.createClient(config.supabase_url, config.supabase_anon_key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    const { data } = await sb.auth.getSession();
    session = data.session;
    if (session) await enterApp(); else showLogin();

    sb.auth.onAuthStateChange((event, s) => {
      session = s;
      if (event === 'SIGNED_OUT') showLogin();
    });
  }

  function showLogin() {
    document.getElementById('app').hidden = true;
    document.getElementById('login').hidden = false;
    const form = document.getElementById('login-form');
    const emailInput = form.querySelector('[name="email"]');
    const passInput = form.querySelector('[name="password"]');
    emailInput.value = localStorage.getItem('ucm:last-email') || '';
    if (emailInput.value) passInput.focus(); else emailInput.focus();
  }

  async function enterApp() {
    const { data: rows, error } = await sb.from('staff').select('*')
      .eq('user_id', session.user.id).limit(1);
    if (error || !rows || !rows.length) {
      document.getElementById('login').hidden = false;
      document.getElementById('login-error').hidden = false;
      document.getElementById('login-error').textContent =
        'This account is not on the newsroom staff list. Ask the editor to add you.';
      $('#login-submit')?.removeAttribute('disabled');
      return;
    }
    staff = rows[0];
    document.getElementById('login').hidden = true;
    document.getElementById('app').hidden = false;
    document.getElementById('who-name').textContent = staff.full_name || 'Editor';
    document.getElementById('who-role').textContent = staff.role || 'editor';
    document.getElementById('who-avatar').textContent = staff.initials || initialsOf(staff.full_name);

    sb.from('staff').update({ last_seen: new Date().toISOString() })
      .eq('user_id', session.user.id).then(() => {});

    if (!location.hash) location.hash = '#overview';
    await route();
    loadCounts();
  }

  function initialsOf(name) {
    return String(name || 'UC').split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
  }

  async function loadCounts() {
    try {
      const [stories, published, subscribers, messages] = await Promise.all([
        countRows('stories'),
        countRows('stories', (q) => q.eq('status', 'published')),
        countRows('subscribers'),
        countRows('messages', (q) => q.eq('handled', false)),
      ]);
      counts.stories = stories; counts.published = published;
      counts.subscribers = subscribers; counts.messages = messages;
      const set = (k, v) => { const el = document.querySelector(`[data-count="${k}"]`); if (el) el.textContent = v ? String(v) : ''; };
      set('stories', stories); set('subscribers', subscribers); set('messages', messages);
      const msgEl = document.querySelector('[data-count="messages"]');
      if (msgEl) msgEl.dataset.hot = messages ? '1' : '0';
    } catch (err) { /* non-fatal */ }
  }

  /* ── routing ────────────────────────────────────────────────────── */
  const HEADINGS = {
    overview: ['Overview', 'Today in the newsroom'],
    media: ['Media library', 'Images uploaded through the CMS'],
    settings: ['Station settings', 'Identity, stream and publishing'],
  };

  async function route() {
    const hash = (location.hash || '#overview').replace('#', '');
    view = RESOURCES[hash] || HEADINGS[hash] ? hash : 'overview';
    closeDrawer();
    closeSidebar();
    $$('.nav__item').forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const heading = HEADINGS[view] || [RESOURCES[view].heading, RESOURCES[view].sub];
    document.getElementById('view-title').textContent = heading[0];
    document.getElementById('view-sub').textContent = heading[1];
    const el = document.getElementById('view');
    el.innerHTML = '<div class="empty"><span class="skeleton" style="display:inline-block;width:200px"></span></div>';

    try {
      if (view === 'overview') await renderOverview(el);
      else if (view === 'media') await renderMedia(el);
      else if (view === 'settings') await renderSettings(el);
      else await renderResource(el, view);
    } catch (err) {
      el.innerHTML = `<div class="empty"><strong>Could not load this view</strong>${esc(err.message || err)}</div>`;
    }
  }

  window.addEventListener('hashchange', () => { if (session && staff) route(); });

  /* ── overview ───────────────────────────────────────────────────── */
  async function renderOverview(el) {
    const [stories, activity, build, subs, open] = await Promise.all([
      selectAll('stories', 'updated_at', false),
      selectAll('activity_log', 'created_at', false).catch(() => []),
      fetch('../assets/build.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      countRows('subscribers'),
      countRows('messages', (q) => q.eq('handled', false)),
    ]);
    counts.subscribers = subs; counts.messages = open;
    const published = stories.filter((s) => s.status === 'published');
    const drafts = stories.filter((s) => s.status !== 'published');
    const views = stories.reduce((sum, s) => sum + (s.views || 0), 0);

    const recent = stories.slice(0, 6);
    el.innerHTML = `
      <div class="stats">
        <div class="stat stat--hot"><span class="stat__value">${published.length}</span><span class="stat__label">Published</span><span class="stat__sub">${drafts.length} in draft or review</span></div>
        <div class="stat"><span class="stat__value">${views.toLocaleString()}</span><span class="stat__label">Story reads</span><span class="stat__sub">all time</span></div>
        <div class="stat"><span class="stat__value">${subs}</span><span class="stat__label">Subscribers</span><span class="stat__sub">The Cover Note</span></div>
        <div class="stat"><span class="stat__value">${open}</span><span class="stat__label">Open messages</span><span class="stat__sub">in the inbox</span></div>
      </div>
      <div class="panels">
        <section class="panel">
          <div class="panel__head"><h2>Recently edited</h2><a class="btn btn--ghost btn--sm" href="#stories">All stories</a></div>
          <ul class="list">
            ${recent.length ? recent.map((s) => `
              <li class="list__item">
                <span class="dot" style="${s.status === 'published' ? '' : 'background:#c9a227'}"></span>
                <span class="grow"><strong>${esc(s.title)}</strong><small>${esc(s.section_slug || '')} · ${esc(relTime(s.updated_at))}</small></span>
                ${badge(s.status)}
              </li>`).join('') : '<li class="empty">No stories yet. <strong><a href="#stories">Write the first headline</a></strong></li>'}
          </ul>
        </section>
        <section class="panel">
          <div class="panel__head"><h2>Newsroom</h2></div>
          <div class="panel__body panel__body--pad">
            <p style="font-size:.84rem;color:var(--muted);margin-bottom:12px">
              ${build ? `Site last built <strong>${esc(relTime(build.built_at))}</strong> from <strong>${esc(build.source)}</strong> · ${build.stories} stories.` : 'No build information available.'}
            </p>
            <ul class="list" style="margin:0 -16px -16px">
              ${(activity || []).slice(0, 5).map((a) => `<li class="list__item"><span class="grow"><strong>${esc(a.action)}</strong><small>${esc(a.detail || a.entity || '')} · ${esc(relTime(a.created_at))}</small></span></li>`).join('') || '<li class="list__item"><span class="grow"><small>No activity recorded yet.</small></span></li>'}
            </ul>
          </div>
        </section>
      </div>`;
  }

  /* ── table views ────────────────────────────────────────────────── */
  let tableState = null;

  function optionList(field, value, placeholder) {
    let pairs = [];
    if (field.options) pairs = field.options.map((o) => [o, o]);
    else if (field.from) {
      pairs = (ref[field.from] || []).map((row) => [
        row.slug, row.name || row.label || row.slug,
      ]);
    }
    const blank = field.blank !== undefined ? field.blank : placeholder;
    const head = blank ? `<option value="">${esc(blank)}</option>` : '';
    return head + pairs.map(([v, label]) =>
      `<option value="${esc(v)}"${String(v) === String(value || '') ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }

  async function renderResource(el, key) {
    const R = RESOURCES[key];
    const rows = await selectAll(R.table, R.order, R.asc);
    tableState = { key, rows, q: '', filters: {} };
    const filterSelects = (R.filters || []).map((f) => {
      const opts = f.options
        ? f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')
        : (ref[f.from] || []).map((r) => `<option value="${esc(r[`${f.from === 'sections' ? 'slug' : 'slug'}`])}">${esc(r.name || r.slug)}</option>`).join('');
      return `<select class="select-inline" data-filter="${esc(f.key)}"><option value="">All ${esc(f.key.replace(/_/g, ' '))}</option>${opts}</select>`;
    }).join('');

    el.innerHTML = `
      <div class="toolbar">
        <div class="search"><input type="search" placeholder="Search ${esc(R.label.toLowerCase())}" data-search autocomplete="off"></div>
        ${filterSelects}
        <span style="flex:1"></span>
        ${R.readOnly
      ? '<button class="btn btn--ghost btn--sm" data-act="export" type="button">Export CSV</button>'
      : `<button class="btn btn--primary btn--sm" data-act="new" type="button">+ New ${esc(R.noun)}</button>`}
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr>${R.columns.map((c) => `<th${c.cls ? ` class="${c.cls}"` : ''}>${esc(c.label || c.key.replace(/_/g, ' '))}</th>`).join('')}</tr></thead>
          <tbody data-rows></tbody>
        </table>
      </div>`;

    drawRows(el, R);

    el.querySelector('[data-search]').addEventListener('input', (e) => {
      tableState.q = e.target.value.toLowerCase();
      drawRows(el, R);
    });
    $$('[data-filter]', el).forEach((sel) => {
      sel.addEventListener('change', () => {
        tableState.filters[sel.dataset.filter] = sel.value;
        drawRows(el, R);
      });
    });
    const newBtn = el.querySelector('[data-act="new"]');
    if (newBtn) newBtn.addEventListener('click', () => openDrawer(key, null));
    const exportBtn = el.querySelector('[data-act="export"]');
    if (exportBtn) exportBtn.addEventListener('click', () => exportCsv(R));
  }

  function filteredRows() {
    const { rows, q, filters } = tableState;
    return rows.filter((row) => {
      for (const [k, v] of Object.entries(filters)) {
        if (v && String(row[k] || '') !== v) return false;
      }
      if (!q) return true;
      return (RESOURCES[tableState.key].search || [])
        .some((f) => String(row[f] || '').toLowerCase().includes(q));
    });
  }

  function drawRows(el, R) {
    const rows = filteredRows();
    const body = el.querySelector('[data-rows]');
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${R.columns.length}"><div class="empty"><strong>Nothing here yet</strong>${tableState.q ? 'No match for that search.' : 'Use the button above to add the first one.'}</div></td></tr>`;
      return;
    }
    body.innerHTML = rows.map((row) => `
      <tr data-id="${esc(row.id)}">
        ${R.columns.map((c) => `<td${c.primary ? ' class="primary"' : ''}${c.cls ? ` class="${c.cls}"` : ''}>${c.render ? c.render(row) : esc(row[c.key] ?? '—')}</td>`).join('')}
      </tr>`).join('');
    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const row = rows.find((r) => String(r.id) === tr.dataset.id);
        openDrawer(tableState.key, row);
      });
    });
  }

  function exportCsv() {
    const rows = filteredRows();
    if (!rows.length) return toast('Nothing to export', 'error');
    const cols = ['email', 'source', 'created_at'];
    const csv = [cols.join(',')].concat(rows.map((r) =>
      cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'undercover-newsletter.csv'; a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${rows.length} subscribers`);
  }

  /* ── drawer / editor ────────────────────────────────────────────── */
  let bodyBlocks = [];

  const BLOCK_TYPES = [['p', 'Paragraph'], ['h2', 'Heading'], ['quote', 'Quote'], ['ul', 'Bullet list'], ['ol', 'Numbered list']];

  function openDrawer(key, row) {
    const R = RESOURCES[key];
    if (!R.fields.length) return;
    drawer = { open: true, key, row };
    bodyBlocks = Array.isArray(row?.body) ? JSON.parse(JSON.stringify(row.body)) : [];
    const el = document.getElementById('drawer');
    document.getElementById('drawer-eyebrow').textContent = row ? 'Editing' : 'New';
    document.getElementById('drawer-title').textContent = row
      ? (row.title || row.name || R.noun)
      : `New ${R.noun}`;
    const form = document.getElementById('drawer-form');
    form.innerHTML = R.fields.map((f) => fieldHTML(f, row ? row[f.key] : (R.defaults || {})[f.key])).join('');
    const bodyField = form.querySelector('[data-body]');
    if (bodyField) renderBlocks(bodyField);
    document.getElementById('drawer-delete').hidden = !row;
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { el.dataset.open = '1'; });
    document.getElementById('scrim').hidden = false;
    setTimeout(() => { const first = form.querySelector('input,textarea,select'); if (first) first.focus(); }, 260);
  }

  function closeDrawer() {
    const el = document.getElementById('drawer');
    if (!el || el.hidden) return;
    el.dataset.open = '0';
    el.setAttribute('aria-hidden', 'true');
    setTimeout(() => { if (el.dataset.open !== '1') el.hidden = true; }, 260);
    document.getElementById('scrim').hidden = true;
    drawer = { open: false, key: null, row: null };
  }

  function fieldHTML(f, value) {
    const id = `f-${f.key}`;
    const wide = f.wide ? ' field--wide' : '';
    if (f.type === 'check') {
      return `<label class="field field--check${wide}"><input type="checkbox" id="${id}" name="${f.key}"${value ? ' checked' : ''}><span>${esc(f.label)}</span></label>`;
    }
    const help = f.help ? `<small>${esc(f.help)}</small>` : '';
    const label = `<span>${esc(f.label)}${f.required ? ' *' : ''}</span>`;
    if (f.type === 'body') {
      return `<div class="field${wide}"><span>${esc(f.label)}</span>
        <div class="blocks" data-body></div>
        <div class="upload" style="margin-top:8px">
          ${BLOCK_TYPES.map(([t, l]) => `<button type="button" class="btn btn--ghost btn--sm" data-add-block="${t}">+ ${l}</button>`).join('')}
        </div>${help}</div>`;
    }
    if (f.type === 'select') {
      return `<label class="field${wide}">${label}<select id="${id}" name="${f.key}">${optionList(f, value)}</select>${help}</label>`;
    }
    if (f.type === 'textarea') {
      return `<label class="field${wide}">${label}<textarea id="${id}" name="${f.key}" rows="${f.rows || 3}">${esc(value ?? '')}</textarea>${help}</label>`;
    }
    if (f.type === 'image') {
      return `<div class="field${wide}">${label}
        <img class="thumb" alt=""${value ? ` src="${esc(value)}"` : ''} style="${value ? '' : 'display:none'}">
        <div class="upload">
          <input type="text" id="${id}" name="${f.key}" value="${esc(value ?? '')}" placeholder="assets/img/name-700.jpg or https://…">
          <button type="button" class="btn btn--ghost btn--sm" data-upload="${f.key}">Upload…</button>
        </div>
        <input type="file" accept="image/*" hidden data-file="${f.key}">
        ${help}</div>`;
    }
    if (f.type === 'tags') {
      const v = Array.isArray(value) ? value.join(', ') : (value || '');
      return `<label class="field${wide}">${label}<input type="text" id="${id}" name="${f.key}" value="${esc(v)}" placeholder="Parliament, Budget">${help}</label>`;
    }
    const typeMap = { number: 'number', datetime: 'datetime-local', time: 'time', url: 'url', text: 'text' };
    const inputType = typeMap[f.type] || 'text';
    let v = value ?? '';
    if (f.type === 'datetime') v = toLocalInput(v);
    if (f.type === 'time' && v) v = String(v).slice(0, 5);
    return `<label class="field${wide}">${label}<input type="${inputType}" id="${id}" name="${f.key}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"${f.type === 'number' ? ' step="1"' : ''}>${help}</label>`;
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function renderBlocks(container) {
    if (!bodyBlocks.length) {
      container.innerHTML = '<p style="font-size:.82rem;color:var(--muted);padding:10px 0">No blocks yet — add a paragraph to start writing.</p>';
      return;
    }
    container.innerHTML = bodyBlocks.map((b, i) => {
      const type = b.type || 'p';
      const isList = type === 'ul' || type === 'ol';
      const text = isList ? (b.items || []).join('\n') : (b.text || '');
      return `<div class="block" data-i="${i}">
        <div class="block__head">
          <select data-block-type>${BLOCK_TYPES.map(([t, l]) => `<option value="${t}"${t === type ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <div class="block__tools">
            <button type="button" data-move="-1" title="Move up">↑</button>
            <button type="button" data-move="1" title="Move down">↓</button>
            <button type="button" data-remove title="Remove">✕</button>
          </div>
        </div>
        <textarea rows="${isList ? 4 : type === 'h2' ? 1 : 3}" placeholder="${isList ? 'One item per line' : type === 'quote' ? 'Quotation' : 'Write here…'}">${esc(text)}</textarea>
        ${type === 'quote' ? `<input type="text" data-cite value="${esc(b.cite || '')}" placeholder="Attribution (optional)">` : ''}
      </div>`;
    }).join('');
  }

  function readBlocks(container) {
    return Array.from(container.querySelectorAll('.block')).map((el) => {
      const type = el.querySelector('[data-block-type]').value;
      const value = el.querySelector('textarea').value;
      if (type === 'ul' || type === 'ol') {
        return { type, items: value.split('\n').map((s) => s.trim()).filter(Boolean) };
      }
      const block = { type, text: value };
      const cite = el.querySelector('[data-cite]');
      if (cite && cite.value.trim()) block.cite = cite.value.trim();
      return block;
    });
  }

  function collect(R) {
    const payload = {};
    R.fields.forEach((f) => {
      const el = document.getElementById(`f-${f.key}`);
      if (!el) return;
      if (f.type === 'check') payload[f.key] = el.checked;
      else if (f.type === 'number') payload[f.key] = el.value === '' ? null : Number(el.value);
      else if (f.type === 'tags') payload[f.key] = el.value.split(',').map((s) => s.trim()).filter(Boolean);
      else if (f.type === 'body') payload[f.key] = readBlocks(document.querySelector('[data-body]'));
      else if (f.type === 'datetime') payload[f.key] = el.value ? new Date(el.value).toISOString() : null;
      else if (f.type === 'time') payload[f.key] = el.value ? (el.value.length === 5 ? `${el.value}:00` : el.value) : null;
      else payload[f.key] = el.value.trim() === '' ? null : el.value.trim();
    });
    return payload;
  }

  async function saveDrawer() {
    const R = RESOURCES[drawer.key];
    const btn = document.getElementById('drawer-save');
    btn.disabled = true;
    try {
      const payload = collect(R);
      if (R.table === 'stories') {
        if (!payload.slug) payload.slug = slugify(payload.title);
        if (!payload.slug) throw new Error('A headline is needed to build the URL');
        if (payload.status === 'published' && !payload.published_at) payload.published_at = new Date().toISOString();
      } else if (!payload.slug && ('slug' in payload)) {
        payload.slug = slugify(payload.title || payload.name);
      }
      let res;
      if (drawer.row) {
        res = await sb.from(R.table).update(payload).eq('id', drawer.row.id).select();
      } else {
        res = await sb.from(R.table).insert(payload).select();
      }
      if (res.error) throw res.error;
      await sb.from('activity_log').insert({
        actor: staff?.full_name || 'staff',
        action: drawer.row ? `${R.noun}.update` : `${R.noun}.create`,
        entity: payload.slug || payload.name || R.noun,
        detail: payload.title || payload.name || '',
      });
      toast(drawer.row ? 'Saved' : `${R.noun[0].toUpperCase()}${R.noun.slice(1)} created`);
      closeDrawer();
      await route();
      loadCounts();
    } catch (err) {
      toast(err.message || 'Could not save', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteDrawer() {
    if (!drawer.row) return;
    const R = RESOURCES[drawer.key];
    if (!confirm(`Delete this ${R.noun}? This cannot be undone.`)) return;
    const { error } = await sb.from(R.table).delete().eq('id', drawer.row.id);
    if (error) return toast(error.message, 'error');
    await sb.from('activity_log').insert({
      actor: staff?.full_name || 'staff', action: `${R.noun}.delete`,
      entity: drawer.row.slug || R.noun, detail: drawer.row.title || '',
    });
    toast('Deleted');
    closeDrawer();
    await route();
    loadCounts();
  }

  /* ── media library ──────────────────────────────────────────────── */
  async function renderMedia(el) {
    const { data, error } = await sb.from('media').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    const items = data || [];
    el.innerHTML = `
      <div class="dropzone" id="dropzone">
        <strong>Drop images here, or choose a file</strong>
        <span style="font-size:.82rem">PNG, JPG, WebP or SVG · stored in Supabase Storage</span>
        <div style="margin-top:10px"><button class="btn btn--primary btn--sm" type="button" id="pick">Choose file</button></div>
        <input type="file" accept="image/*" hidden id="media-file">
      </div>
      <div class="media-grid" id="media-grid">
        ${items.length ? items.map(mediaCard).join('') : '<div class="empty" style="grid-column:1/-1"><strong>No images yet</strong>Uploads appear here and can be reused in any story.</div>'}
      </div>`;

    const fileInput = el.querySelector('#media-file');
    el.querySelector('#pick').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => uploadFile(fileInput.files[0]));
    const dz = el.querySelector('#dropzone');
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); dz.style.borderColor = 'var(--red)';
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); dz.style.borderColor = '';
    }));
    dz.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    });
    el.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(b.dataset.copy);
      toast('URL copied');
    }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this image?')) return;
      const row = items.find((i) => i.id === b.dataset.del);
      await sb.storage.from('media').remove([row.path]);
      await sb.from('media').delete().eq('id', row.id);
      toast('Image deleted');
      route();
    }));
  }

  function mediaCard(m) {
    return `<figure class="media-card">
      <img src="${esc(m.url)}" alt="${esc(m.alt || '')}" loading="lazy">
      <button type="button" data-copy="${esc(m.url)}">Copy URL</button>
      <div class="media-card__meta"><span>${esc(m.path.split('/').pop())}</span>
        <button type="button" class="btn btn--danger btn--sm" data-del="${esc(m.id)}" style="position:static;opacity:1;background:transparent;color:#a30400;padding:0 .3em">✕</button>
      </div>
    </figure>`;
  }

  async function uploadFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Only images can be uploaded', 'error');
    if (file.size > 5 * 1024 * 1024) return toast('Keep images under 5 MB', 'error');
    const now = new Date();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${Date.now()}-${slugify(file.name.replace(/\.[^.]+$/, ''))}.${ext}`;
    toast('Uploading…');
    const { error } = await sb.storage.from('media').upload(path, file, { cacheControl: '31536000', upsert: false });
    if (error) return toast(error.message, 'error');
    const { data: pub } = sb.storage.from('media').getPublicUrl(path);
    const { error: rowError } = await sb.from('media').insert({
      path, url: pub.publicUrl, alt: file.name.replace(/\.[^.]+$/, ''),
      mime: file.type, bytes: file.size, uploaded_by: session.user.id,
    });
    if (rowError) toast(rowError.message, 'error'); else toast('Image uploaded');
    route();
  }

  /* ── settings ───────────────────────────────────────────────────── */
  async function renderSettings(el) {
    const { data, error } = await sb.from('settings').select('*').order('key');
    if (error) throw error;
    const rows = data || [];
    el.innerHTML = rows.map((row) => `
      <section class="panel" style="margin-bottom:16px">
        <div class="panel__head"><h2>${esc(row.label || row.key)}</h2>
          <span class="badge">${row.is_public ? 'public' : 'private'}</span></div>
        <div class="panel__body panel__body--pad">
          <div class="grid2" data-settings="${esc(row.key)}">
            ${Object.entries(row.value || {}).map(([k, v]) => `
              <label class="field${String(k).includes('url') || String(k).length > 14 ? ' field--wide' : ''}">
                <span>${esc(k.replace(/_/g, ' '))}</span>
                <input type="text" data-key="${esc(k)}" value="${esc(typeof v === 'boolean' ? String(v) : v)}">
              </label>`).join('')}
          </div>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn btn--primary btn--sm" type="button" data-save="${esc(row.key)}">Save</button>
            <button class="btn btn--ghost btn--sm" type="button" data-publish>Trigger rebuild</button>
          </div>
        </div>
      </section>`).join('') + `
      <section class="panel">
        <div class="panel__head"><h2>Publishing</h2></div>
        <div class="panel__body panel__body--pad">
          <p style="font-size:.86rem;color:var(--muted);margin-bottom:12px">
            The public site is generated from this database. Edits are saved instantly here; to push them live,
            add your Vercel deploy hook to <strong>publishing → deploy_hook</strong> and press “Publish site”.
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn--primary btn--sm" type="button" id="publish-now">Publish site now</button>
            <a class="btn btn--ghost btn--sm" href="https://vercel.com/fredscottswork-1879s-projects/undercover-media/deployments" target="_blank" rel="noopener">Open Vercel ↗</a>
          </div>
        </div>
      </section>`;

    el.querySelectorAll('[data-save]').forEach((btn) => btn.addEventListener('click', async () => {
      const key = btn.dataset.save;
      const wrap = el.querySelector(`[data-settings="${CSS.escape(key)}"]`);
      const row = rows.find((r) => r.key === key);
      const value = { ...(row.value || {}) };
      wrap.querySelectorAll('[data-key]').forEach((input) => {
        const k = input.dataset.key;
        const original = value[k];
        value[k] = typeof original === 'boolean' ? input.value === 'true' : input.value;
      });
      const { error: e } = await sb.from('settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
      toast(e ? e.message : 'Settings saved', e ? 'error' : undefined);
    }));
    el.querySelectorAll('[data-publish]').forEach((b) => b.addEventListener('click', publishSite));
    el.querySelector('#publish-now').addEventListener('click', publishSite);
  }

  async function publishSite() {
    const { data } = await sb.from('settings').select('value').eq('key', 'publishing').maybeSingle();
    const hook = data?.value?.deploy_hook;
    if (!hook) {
      toast('Add your Vercel deploy hook first (publishing → deploy_hook)', 'error');
      return;
    }
    toast('Build triggered — the site updates in about a minute');
    try {
      await fetch(hook, { method: 'POST', mode: 'no-cors' });
    } catch (err) {
      toast('Could not reach Vercel', 'error');
    }
    sb.from('activity_log').insert({
      actor: staff?.full_name || 'staff', action: 'site.publish', entity: 'site', detail: 'deploy hook',
    }).then(() => {});
  }

  /* ── chrome wiring ──────────────────────────────────────────────── */
  function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.dataset.open = '0';
    document.getElementById('scrim').hidden = true;
  }

  function bindChrome() {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const errEl = document.getElementById('login-error');
      const btn = document.getElementById('login-submit');
      errEl.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      const { error } = await sb.auth.signInWithPassword({
        email: form.querySelector('[name="email"]').value.trim(),
        password: form.querySelector('[name="password"]').value,
      });
      btn.disabled = false;
      btn.textContent = 'Sign in';
      if (error) {
        errEl.hidden = false;
        errEl.textContent = error.message === 'Invalid login credentials'
          ? 'That email and password do not match a staff account.' : error.message;
        return;
      }
      localStorage.setItem('ucm:last-email', form.querySelector('[name="email"]').value.trim());
      form.reset();
      await enterApp();
    });

    document.getElementById('sign-out').addEventListener('click', async () => {
      await sb.auth.signOut();
      staff = null;
      showLogin();
    });

    document.getElementById('menu-toggle').addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      const open = sidebar.dataset.open === '1';
      sidebar.dataset.open = open ? '0' : '1';
      document.getElementById('scrim').hidden = open;
    });

    document.getElementById('scrim').addEventListener('click', closeSidebar);

    document.getElementById('publish').addEventListener('click', publishSite);
    document.getElementById('drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('drawer-cancel').addEventListener('click', closeDrawer);
    document.getElementById('drawer-delete').addEventListener('click', deleteDrawer);
    document.getElementById('drawer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      saveDrawer();
    });

    document.getElementById('drawer-form').addEventListener('click', (e) => {
      const add = e.target.closest('[data-add-block]');
      if (add) {
        const container = document.querySelector('[data-body]');
        bodyBlocks = readBlocks(container);
        const type = add.dataset.addBlock;
        bodyBlocks.push(type === 'ul' || type === 'ol' ? { type, items: [] } : { type, text: '' });
        renderBlocks(container);
        const last = container.querySelector('.block:last-child textarea');
        if (last) last.focus();
        return;
      }
      const move = e.target.closest('[data-move]');
      if (move) {
        const container = document.querySelector('[data-body]');
        bodyBlocks = readBlocks(container);
        const i = Number(move.closest('.block').dataset.i);
        const j = i + Number(move.dataset.move);
        if (j < 0 || j >= bodyBlocks.length) return;
        [bodyBlocks[i], bodyBlocks[j]] = [bodyBlocks[j], bodyBlocks[i]];
        renderBlocks(container);
        return;
      }
      const remove = e.target.closest('[data-remove]');
      if (remove) {
        const container = document.querySelector('[data-body]');
        bodyBlocks = readBlocks(container);
        bodyBlocks.splice(Number(remove.closest('.block').dataset.i), 1);
        renderBlocks(container);
        return;
      }
      const upload = e.target.closest('[data-upload]');
      if (upload) {
        const input = document.querySelector(`[data-file="${upload.dataset.upload}"]`);
        input.click();
      }
    });

    document.getElementById('drawer-form').addEventListener('change', async (e) => {
      const fileInput = e.target.closest('[data-file]');
      if (fileInput && fileInput.files[0]) {
        const key = fileInput.dataset.file;
        const url = await uploadInline(fileInput.files[0]);
        if (url) {
          const field = document.getElementById(`f-${key}`);
          field.value = url;
          const preview = field.closest('.field').querySelector('.thumb');
          preview.src = url;
          preview.style.display = '';
        }
        return;
      }
      const typeSelect = e.target.closest('[data-block-type]');
      if (typeSelect) {
        const container = document.querySelector('[data-body]');
        const i = Number(typeSelect.closest('.block').dataset.i);
        bodyBlocks = readBlocks(container);
        const type = typeSelect.value;
        const existing = bodyBlocks[i] || { type };
        bodyBlocks[i] = type === 'ul' || type === 'ol'
          ? { type, items: existing.items || [] }
          : { type, text: existing.text || '' };
        renderBlocks(container);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (drawer.open) closeDrawer();
        else closeSidebar();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && drawer.open) {
        e.preventDefault();
        saveDrawer();
      }
    });
  }

  async function uploadInline(file) {
    if (!file.type.startsWith('image/')) { toast('Only images can be uploaded', 'error'); return null; }
    const now = new Date();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${Date.now()}-${slugify(file.name.replace(/\.[^.]+$/, ''))}.${ext}`;
    toast('Uploading…');
    const { error } = await sb.storage.from('media').upload(path, file, { cacheControl: '31536000' });
    if (error) { toast(error.message, 'error'); return null; }
    const { data } = sb.storage.from('media').getPublicUrl(path);
    await sb.from('media').insert({
      path, url: data.publicUrl, alt: file.name, mime: file.type,
      bytes: file.size, uploaded_by: session?.user?.id,
    });
    toast('Image uploaded');
    return data.publicUrl;
  }

  /* ── boot ───────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    bindChrome();
    start();
  });
})();
