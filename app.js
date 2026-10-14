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
    let items = this.all();
    if (!items.length || !navigator.onLine) return;
    const remaining = [];
    for (const it of items) {
      try { await callApi(it.action, it.payload); } catch { remaining.push(it); }
    }
    store.set('queue', remaining);
    renderQueueNote();
    if (remaining.length < items.length) toast('Synced saved items');
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
const titles = { home: 'Idealist', idea: 'Idea Generator', task: 'Daily Task', list: 'My tasks', ideas: 'My ideas', settings: 'Settings' };
let current = 'home';
function show(view) {
  current = view;
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  $('title').textContent = titles[view];
  $('back').hidden = view === 'home';
  stopAllDictation();
  if (view === 'list') loadTasks();
  if (view === 'ideas') loadIdeas();
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
  const idleHint = hint.textContent;

  if (!SR) {
    mic.disabled = true;
    hint.textContent = 'Voice typing is not supported here. Use Chrome on Android, or type.';
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
    hint.textContent = 'Listening… tap again to stop';
    begin();
  }
  function stop() {
    listening = false;
    mic.classList.remove('on');
    hint.textContent = idleHint;
    if (rec) { rec.onend = null; try { rec.stop(); } catch {} }
  }

  mic.addEventListener('click', () => (listening ? stop() : start()));
  dictations.push(stop);
}
function stopAllDictation() { dictations.forEach((stop) => stop()); }

makeDictation($('idea-mic'), $('idea-text'), $('idea-hint'));
makeDictation($('task-mic'), $('task-text'), $('task-hint'));

/* ---------- ideas ---------- */
$('idea-save').addEventListener('click', async () => {
  stopAllDictation();
  const text = $('idea-text').value.trim();
  if (!text) return toast('Say or type an idea first');
  const btn = $('idea-save');
  btn.disabled = true;
  try {
    const r = await saveOrQueue('addIdea', { text });
    $('idea-text').value = '';
    toast(r === 'saved' ? 'Idea saved 💡' : 'Offline — will sync later');
  } catch (err) { toast(err.message); }
  btn.disabled = false;
});

/* ---------- tasks ---------- */
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
document.querySelectorAll('[data-rdue]').forEach((c) =>
  c.addEventListener('click', () => ($('resched-due').value = presetDate(c.dataset.rdue)))
);

const fmtDate = (s) => new Date(s.replace(' ', 'T')).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

$('task-save').addEventListener('click', async () => {
  stopAllDictation();
  const text = $('task-text').value.trim();
  if (!text) return toast('Say or type a task first');
  const btn = $('task-save');
  btn.disabled = true;
  try {
    const r = await saveOrQueue('addTask', { text, due: $('task-due').value });
    $('task-text').value = '';
    $('task-due').value = '';
    toast(r === 'saved' ? 'Task saved ✅' : 'Offline — will sync later');
  } catch (err) { toast(err.message); }
  btn.disabled = false;
});

/* ----- task list: Pending / Done tabs, Done + Reschedule actions ----- */
let taskStatus = 'Pending';

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    taskStatus = tab.dataset.status;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    loadTasks();
  })
);

function renderTasks(tasks, status) {
  const ul = $('task-list');
  ul.innerHTML = '';
  const empty = $('list-empty');
  empty.hidden = tasks.length > 0;
  empty.textContent = status === 'Pending' ? 'No pending tasks 🎉' : 'Nothing completed yet';
  const now = toLocalInput(new Date());

  tasks.forEach((t) => {
    const due = t.due ? t.due.replace(' ', 'T') : '';
    const overdue = status === 'Pending' && due && due < now;
    const li = el('li', overdue ? 'overdue' : '');
    li.append(el('div', 'body', t.text));

    if (status === 'Pending') {
      li.append(el('div', 'meta', due ? `${overdue ? '⚠️ Overdue · was due' : '🕒 Due'} ${fmtDate(due)}` : 'No due date'));
      const actions = el('div', 'actions');
      const done = el('button', 'primary small', '✓ Done');
      const resched = el('button', 'secondary small', '↻ Reschedule');
      done.addEventListener('click', async () => {
        done.disabled = true;
        try {
          await callApi('completeTask', { id: t.id });
          toast('Done 🎉');
          loadTasks();
        } catch (err) { done.disabled = false; toast(err.message); }
      });
      resched.addEventListener('click', () => openReschedule(t, due));
      actions.append(done, resched);
      li.append(actions);
    } else {
      li.append(el('div', 'meta', t.completed ? `✓ Completed ${fmtDate(t.completed)}` : '✓ Completed'));
    }
    ul.append(li);
  });
}

async function loadTasks() {
  const status = taskStatus;
  const cacheKey = `tasksCache-${status}`;
  renderTasks(store.get(cacheKey, []), status);
  try {
    const tasks = await callApi('listTasks', { status });
    store.set(cacheKey, tasks);
    if (status === taskStatus) renderTasks(tasks, status);
  } catch (err) { toast(err.message); }
}

/* ----- reschedule dialog ----- */
let reschedId = null;
function openReschedule(task, due) {
  reschedId = task.id;
  $('resched-task').textContent = task.text;
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
    await callApi('rescheduleTask', { id: reschedId, due });
    $('dlg-resched').close();
    toast('Rescheduled ✔');
    loadTasks();
  } catch (err) { toast(err.message); }
  btn.disabled = false;
});

/* ---------- ideas list + share ---------- */
function renderIdeas(ideas) {
  const ul = $('idea-list');
  ul.innerHTML = '';
  $('ideas-empty').hidden = ideas.length > 0;
  ideas.forEach((idea) => {
    const li = el('li');
    li.append(el('div', 'body', idea.text));
    li.append(el('div', 'meta', `💡 ${idea.created ? fmtDate(idea.created) : ''}`));
    const actions = el('div', 'actions');
    const share = el('button', 'primary small', '↗ Share');
    const copy = el('button', 'secondary small', 'Copy');
    share.addEventListener('click', () => shareIdea(idea.text));
    copy.addEventListener('click', () => copyText(idea.text));
    actions.append(share, copy);
    li.append(actions);
    ul.append(li);
  });
}

async function loadIdeas() {
  renderIdeas(store.get('ideasCache', []));
  try {
    const ideas = await callApi('listIdeas');
    store.set('ideasCache', ideas);
    renderIdeas(ideas);
  } catch (err) { toast(err.message); }
}

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
  try { await callApi('ping'); toast('Connected ✔'); } catch (err) { toast(err.message); }
});

/* ---------- start ---------- */
window.addEventListener('online', () => queue.flush());
renderQueueNote();
if (!cfg().url) show('settings'); else { show('home'); queue.flush(); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
