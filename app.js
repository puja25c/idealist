'use strict';

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
const cfg = () => store.get('cfg', { url: '', secret: '', lang: 'en-IN' });

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

/* ---------- icons (inline SVG, no text on buttons) ---------- */
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>',
  sliders: '<path d="M4 6h8m4 0h4M4 12h2m4 0h10M4 18h10m4 0h2"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  reschedule: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
};
function icon(name, size = 20) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}
function iconBtn(name, label, extra = '') {
  const b = el('button', `ibtn ${extra}`.trim());
  b.innerHTML = icon(name);
  b.title = label;
  b.setAttribute('aria-label', label);
  return b;
}
document.querySelectorAll('[data-icon]').forEach((n) => {
  n.innerHTML = icon(n.dataset.icon, Number(n.dataset.size) || 22);
});

/* ---------- API (Google Apps Script web app) ---------- */
async function callApi(action, payload = {}) {
  const { url, secret } = cfg();
  if (!url) throw new Error('Add your web app URL in Settings first');
  // text/plain avoids a CORS preflight, which Apps Script does not support.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret, action, ...payload }),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || 'Request failed');
  return out.data;
}

/* Saves that fail (e.g. no signal) are queued and retried later. */
const queue = {
  all: () => store.get('queue', []),
  push(item) { store.set('queue', [...this.all(), item]); renderQueueNote(); },
  async flush() {
    const items = this.all();
    if (!items.length || !navigator.onLine) return;
    const remaining = [];
    for (const it of items) {
      try { await callApi(it.action, it.payload); } catch { remaining.push(it); }
    }
    store.set('queue', remaining);
    renderQueueNote();
    if (remaining.length < items.length) { toast('Synced saved items'); if (current === 'home') loadHome(); }
  },
};
function renderQueueNote() {
  const n = queue.all().length;
  $('queue-note').hidden = n === 0;
  $('queue-note').textContent = `${n} item${n === 1 ? '' : 's'} waiting to sync`;
}

async function saveOrQueue(action, payload) {
  try {
    await callApi(action, payload);
    return 'saved';
  } catch (err) {
    // Config problems should be shown, not silently queued.
    if (!cfg().url) throw err;
    queue.push({ action, payload });
    return 'queued';
  }
}

/* ---------- navigation ---------- */
const titles = { home: 'Idealist', idea: 'New idea', task: 'New task', settings: 'Settings' };
let current = 'home';
function show(view) {
  current = view;
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  $('title').textContent = titles[view];
  $('back').hidden = view === 'home';
  $('open-settings').hidden = view === 'settings';
  stopAllDictation();
  window.scrollTo(0, 0);
  if (view === 'home') loadHome();
  if (view === 'settings') fillSettings();
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
$('back').addEventListener('click', () => show('home'));
$('open-settings').addEventListener('click', () => show('settings'));

/* ---------- dictation (Web Speech API) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const dictations = [];

function makeDictation(mic, textarea, hint) {
  let rec = null, listening = false, base = '';

  if (!SR) {
    mic.disabled = true;
    hint.textContent = 'Voice typing needs Chrome on Android. You can type instead.';
    return;
  }

  function begin() {
    rec = new SR();
    rec.lang = cfg().lang || 'en-IN';
    // Non-continuous + auto-restart avoids the duplicated-text bug in Android Chrome.
    rec.continuous = false;
    rec.interimResults = true;
    base = textarea.value ? textarea.value.trimEnd() + ' ' : '';
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      textarea.value = base + text;
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast('Microphone permission is blocked');
        stop();
      }
    };
    rec.onend = () => { if (listening) begin(); };
    try { rec.start(); } catch { /* already started */ }
  }

  function start() {
    listening = true;
    mic.classList.add('on');
    hint.textContent = 'Listening…';
    begin();
  }
  function stop() {
    listening = false;
    mic.classList.remove('on');
    hint.textContent = '';
    if (rec) { rec.onend = null; try { rec.stop(); } catch {} }
  }

  mic.addEventListener('click', () => (listening ? stop() : start()));
  dictations.push(stop);
}
function stopAllDictation() { dictations.forEach((stop) => stop()); }

makeDictation($('idea-mic'), $('idea-text'), $('idea-hint'));
makeDictation($('task-mic'), $('task-text'), $('task-hint'));

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function presetDate(kind) {
  const d = new Date();
  if (kind === '2h') d.setHours(d.getHours() + 2);
  if (kind === 'today6') d.setHours(18, 0, 0, 0);
  if (kind === 'tom9') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  if (kind === 'nextweek') { d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); }
  return toLocalInput(d);
}
document.querySelectorAll('[data-due]').forEach((c) =>
  c.addEventListener('click', () => ($('task-due').value = presetDate(c.dataset.due)))
);
document.querySelectorAll('[data-idue]').forEach((c) =>
  c.addEventListener('click', () => ($('idea-due').value = presetDate(c.dataset.idue)))
);
document.querySelectorAll('[data-rdue]').forEach((c) =>
  c.addEventListener('click', () => ($('resched-due').value = presetDate(c.dataset.rdue)))
);

// Shows the raw text instead of "Invalid Date" if a value can't be parsed.
const fmtDate = (s) => {
  const d = new Date(String(s).replace(' ', 'T'));
  return isNaN(d) ? String(s) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

/* ---------- Google Calendar (opens the pre-filled "new event" screen, 30 minutes from the due time) ---------- */
function calendarUrl(text, dueLocal) {
  const start = new Date(dueLocal);
  if (isNaN(start)) return '';
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const f = (d) => toLocalInput(d).replace(/[-:]/g, '') + '00';
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent(text)}&dates=${f(start)}/${f(end)}`
    + `&details=${encodeURIComponent('Added from Idealist')}`;
}
function openCalendar(text, dueLocal) {
  const url = calendarUrl(text, dueLocal);
  if (!url) return toast('Set a date first');
  if (!window.open(url, '_blank', 'noopener')) toast('Allow pop-ups to open Calendar');
}

/* ---------- add idea / add task ---------- */
$('idea-save').addEventListener('click', async () => {
  stopAllDictation();
  const text = $('idea-text').value.trim();
  if (!text) return toast('Say or type an idea first');
  const btn = $('idea-save');
  btn.disabled = true;
  try {
    const r = await saveOrQueue('addIdea', { text, due: $('idea-due').value });
    $('idea-text').value = '';
    $('idea-due').value = '';
    toast(r === 'saved' ? 'Idea saved' : 'Offline, will sync later');
    show('home');
  } catch (err) { toast(err.message); }
  btn.disabled = false;
});

$('task-save').addEventListener('click', async () => {
  stopAllDictation();
  const text = $('task-text').value.trim();
  if (!text) return toast('Say or type a task first');
  const btn = $('task-save');
  btn.disabled = true;
  try {
    const due = $('task-due').value;
    const addToCal = $('task-cal').checked;
    store.set('addToCal', addToCal);
    const r = await saveOrQueue('addTask', { text, due });
    $('task-text').value = '';
    $('task-due').value = '';
    toast(r === 'saved' ? 'Task saved' : 'Offline, will sync later');
    show('home');
    if (addToCal && due) openCalendar(text, due);
    else if (addToCal) toast('Saved. Pick a date to add it to your calendar.');
  } catch (err) { toast(err.message); }
  btn.disabled = false;
});

/* ---------- home: tasks + ideas on one screen ---------- */
function calendarButton(text, due) {
  const b = iconBtn('calendar', 'Add to Google Calendar', 'when-open');
  b.addEventListener('click', () => openCalendar(text, due));
  return b;
}

/** One card for a task or an idea. Only icons on the buttons; the check turns green when done. */
function itemCard(item, kind) {
  const isDone = item.status === 'Done';
  const due = item.due ? item.due.replace(' ', 'T') : '';
  const overdue = !isDone && due && due < toLocalInput(new Date());
  const li = el('li', isDone ? 'done' : overdue ? 'overdue' : '');

  li.append(el('div', 'body', item.text));

  const meta = el('div', 'meta');
  if (due) {
    meta.innerHTML = icon('clock', 14);
    meta.append(fmtDate(due));
    li.append(meta);
  } else if (kind === 'idea' && item.created) {
    meta.append(fmtDate(item.created));
    li.append(meta);
  }

  const actions = el('div', 'actions');

  const done = iconBtn('check', 'Mark as done', isDone ? 'done' : '');
  done.addEventListener('click', async () => {
    if (li.classList.contains('done')) return;
    // Show the change immediately, undo it if saving fails.
    li.classList.add('done');
    done.classList.add('done');
    li.classList.remove('overdue');
    try {
      await callApi(kind === 'task' ? 'completeTask' : 'completeIdea', { id: item.id });
      toast('Done');
      updateCounts();
    } catch (err) {
      li.classList.remove('done');
      done.classList.remove('done');
      if (overdue) li.classList.add('overdue');
      toast(err.message);
    }
  });
  actions.append(done);

  const resched = iconBtn(due ? 'reschedule' : 'clock', due ? 'Reschedule' : 'Set date', 'when-open');
  resched.addEventListener('click', () => openReschedule(kind, item, due));
  actions.append(resched);

  if (due) actions.append(calendarButton(item.text, due));

  if (kind === 'idea') {
    const share = iconBtn('share', 'Share');
    share.addEventListener('click', () => shareIdea(item.text));
    actions.append(share);
  }

  li.append(actions);
  return li;
}

function updateCounts() {
  const open = (id) => $(id).querySelectorAll('li:not(.done)').length;
  $('task-count').textContent = open('task-list') || '';
  $('idea-count').textContent = open('idea-list') || '';
}

function renderList(listId, emptyId, items, kind) {
  const ul = $(listId);
  ul.innerHTML = '';
  $(emptyId).hidden = items.length > 0;
  items.forEach((it) => ul.append(itemCard(it, kind)));
  updateCounts();
}

async function loadHome() {
  renderList('task-list', 'task-empty', store.get('tasksAll', []), 'task');
  renderList('idea-list', 'idea-empty', store.get('ideasAll', []), 'idea');
  if (!cfg().url) return;
  const [t, i] = await Promise.allSettled([
    callApi('listTasks', { status: 'All' }),
    callApi('listIdeas', { status: 'All' }),
  ]);
  if (current !== 'home') return;
  if (t.status === 'fulfilled') { store.set('tasksAll', t.value); renderList('task-list', 'task-empty', t.value, 'task'); }
  if (i.status === 'fulfilled') { store.set('ideasAll', i.value); renderList('idea-list', 'idea-empty', i.value, 'idea'); }
  const failed = [t, i].find((r) => r.status === 'rejected');
  if (failed) toast(failed.reason.message);
}

/* ----- reschedule dialog ----- */
let reschedId = null, reschedKind = 'task';
function openReschedule(kind, item, due) {
  reschedKind = kind;
  reschedId = item.id;
  $('resched-title').textContent = due ? 'Reschedule' : 'Set date';
  $('resched-task').textContent = item.text;
  $('resched-due').value = due || presetDate('tom9');
  $('dlg-resched').showModal();
}
$('resched-cancel').addEventListener('click', () => $('dlg-resched').close());
$('resched-save').addEventListener('click', async () => {
  const due = $('resched-due').value;
  if (!due) return toast('Pick a date and time');
  const btn = $('resched-save');
  btn.disabled = true;
  try {
    await callApi(reschedKind === 'idea' ? 'rescheduleIdea' : 'rescheduleTask', { id: reschedId, due });
    $('dlg-resched').close();
    toast('Date saved');
    loadHome();
  } catch (err) { toast(err.message); }
  btn.disabled = false;
});

/* ----- share ----- */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { toast('Could not copy'); }
}

async function shareIdea(text) {
  const message = `💡 ${text}`;
  // Native share sheet: lists WhatsApp, Telegram, Gmail, Messages, etc. that are on the phone.
  if (navigator.share) {
    try { await navigator.share({ title: 'My idea', text: message }); return; }
    catch (err) { if (err.name === 'AbortError') return; /* otherwise fall through */ }
  }
  const enc = encodeURIComponent(message);
  $('sh-whatsapp').href = `https://wa.me/?text=${enc}`;
  $('sh-telegram').href = `https://t.me/share/url?url=%20&text=${enc}`;
  $('sh-email').href = `mailto:?subject=${encodeURIComponent('My idea')}&body=${enc}`;
  $('sh-sms').href = `sms:?body=${enc}`;
  $('sh-copy').onclick = () => { copyText(message); $('dlg-share').close(); };
  $('dlg-share').showModal();
}
$('sh-close').addEventListener('click', () => $('dlg-share').close());

/* ---------- settings ---------- */
function fillSettings() {
  const c = cfg();
  $('set-url').value = c.url;
  $('set-secret').value = c.secret;
  $('set-lang').value = c.lang || 'en-IN';
}
function readSettings() {
  return { url: $('set-url').value.trim(), secret: $('set-secret').value.trim(), lang: $('set-lang').value };
}
$('set-save').addEventListener('click', () => { store.set('cfg', readSettings()); toast('Settings saved'); show('home'); queue.flush(); });
$('set-test').addEventListener('click', async () => {
  store.set('cfg', readSettings());
  try { await callApi('ping'); toast('Connected'); } catch (err) { toast(err.message); }
});

/* ---------- start ---------- */
window.addEventListener('online', () => queue.flush());
$('task-cal').checked = store.get('addToCal', false);
renderQueueNote();
if (!cfg().url) show('settings'); else { show('home'); queue.flush(); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
