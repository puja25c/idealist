/**
 * Idealist backend — paste this into Extensions > Apps Script of your Google Sheet.
 * It (1) receives ideas/tasks from the app, and (2) sends Telegram reminders every 4 hours.
 *
 * To add a new feature later: add a new sheet tab + a new `case` in handleAction_().
 */

// ====== SETTINGS — edit these ======
const CONFIG = {
  SECRET: 'change-this-to-a-long-random-word',   // must match the "Secret" in the app's Settings
  TELEGRAM_BOT_TOKEN: '',                        // from @BotFather
  TELEGRAM_CHAT_ID: '',                          // run findChatId() once to get this
  REMINDER_EVERY_HOURS: 4,                       // 1, 2, 4, 6, 8 or 12
  QUIET_START_HOUR: 22,                          // no reminders from 10 PM ...
  QUIET_END_HOUR: 7,                             // ... until 7 AM
};

// ====== Sheet layout ======
const SHEETS = {
  Ideas: ['ID', 'Created', 'Idea'],
  Tasks: ['ID', 'Created', 'Task', 'Due', 'Status', 'Completed'],
};
const DATE_FMT = 'yyyy-MM-dd HH:mm';

// ====== Web app entry points ======
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.secret !== CONFIG.SECRET) return json_({ ok: false, error: 'Wrong secret' });
    return json_({ ok: true, data: handleAction_(req) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, message: 'Idealist backend is running' });
}

function handleAction_(req) {
  switch (req.action) {
    case 'addIdea':      return addIdea_(req.text);
    case 'addTask':      return addTask_(req.text, req.due);
    case 'listTasks':    return listTasks_(req.status);
    case 'completeTask': return completeTask_(req.id);
    case 'rescheduleTask': return rescheduleTask_(req.id, req.due);
    case 'listIdeas':    return listIdeas_();
    case 'ping':         return 'pong';
    default: throw new Error('Unknown action: ' + req.action);
  }
}

// ====== Actions ======
function addIdea_(text) {
  text = String(text || '').trim();
  if (!text) throw new Error('Empty idea');
  const id = newId_();
  sheet_('Ideas').appendRow([id, now_(), text]);
  return { id: id };
}

function addTask_(text, due) {
  text = String(text || '').trim();
  if (!text) throw new Error('Empty task');
  const id = newId_();
  const dueStr = due ? String(due).replace('T', ' ') : '';
  sheet_('Tasks').appendRow([id, now_(), text, dueStr, 'Pending', '']);
  return { id: id };
}

function listPendingTasks_() { return listTasks_('Pending'); }

/** status: 'Pending' (default) or 'Done'. Pending is sorted by due date, Done by most recently completed. */
function listTasks_(status) {
  status = status === 'Done' ? 'Done' : 'Pending';
  return readTasks_()
    .filter(function (t) { return t.status === status; })
    .sort(function (a, b) {
      if (status === 'Done') return a.completed < b.completed ? 1 : -1;
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : 1;
    })
    .map(function (t) { return { id: t.id, text: t.text, due: t.due, completed: t.completed }; });
}

/** Newest first, capped at 300 so the response stays small. */
function listIdeas_() {
  const rows = sheet_('Ideas').getDataRange().getValues();
  return rows.slice(1)
    .filter(function (r) { return r[0] !== ''; })
    .map(function (r) { return { id: String(r[0]), created: String(r[1]), text: String(r[2]) }; })
    .reverse()
    .slice(0, 300);
}

function rescheduleTask_(id, due) {
  if (!due) throw new Error('Pick a new date and time');
  const sh = sheet_('Tasks');
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sh.getRange(i + 1, 4).setValue(String(due).replace('T', ' '));
      return { id: id };
    }
  }
  throw new Error('Task not found');
}

function completeTask_(id) {
  const sh = sheet_('Tasks');
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sh.getRange(i + 1, 5).setValue('Done');
      sh.getRange(i + 1, 6).setValue(now_());
      return { id: id };
    }
  }
  throw new Error('Task not found');
}

// ====== Telegram reminders ======
function sendReminders() {
  const tz = Session.getScriptTimeZone();
  const hour = Number(Utilities.formatDate(new Date(), tz, 'H'));
  if (inQuietHours_(hour)) return;

  const pending = listPendingTasks_();
  if (!pending.length) return;

  const nowStr = Utilities.formatDate(new Date(), tz, DATE_FMT);
  const overdue = pending.filter(function (t) { return t.due && t.due < nowStr; });
  const upcoming = pending.filter(function (t) { return !t.due || t.due >= nowStr; });

  const lines = ['📋 You have ' + pending.length + ' pending task' + (pending.length > 1 ? 's' : '') + ':'];
  if (overdue.length) {
    lines.push('', '⚠️ Overdue');
    overdue.forEach(function (t) { lines.push('• ' + t.text + ' (was due ' + t.due + ')'); });
  }
  if (upcoming.length) {
    lines.push('', '🕒 Upcoming');
    upcoming.forEach(function (t) { lines.push('• ' + t.text + (t.due ? ' (by ' + t.due + ')' : '')); });
  }
  sendTelegram_(lines.join('\n'));
}

function inQuietHours_(hour) {
  const s = CONFIG.QUIET_START_HOUR, e = CONFIG.QUIET_END_HOUR;
  return s > e ? (hour >= s || hour < e) : (hour >= s && hour < e);
}

function sendTelegram_(message) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in CONFIG first');
  }
  UrlFetchApp.fetch('https://api.telegram.org/bot' + CONFIG.TELEGRAM_BOT_TOKEN + '/sendMessage', {
    method: 'post',
    payload: { chat_id: CONFIG.TELEGRAM_CHAT_ID, text: message },
  });
}

// ====== One-time setup helpers (run these from the Apps Script editor) ======

/** Step 1: creates the Ideas and Tasks tabs with the right columns. */
function setupSheets() {
  Object.keys(SHEETS).forEach(function (name) { sheet_(name); });
}

/** Step 2: after messaging your bot once, run this to see your chat ID in the log. */
function findChatId() {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + CONFIG.TELEGRAM_BOT_TOKEN + '/getUpdates');
  const updates = JSON.parse(res.getContentText()).result || [];
  if (!updates.length) { Logger.log('No messages yet. Send any message to your bot in Telegram, then run again.'); return; }
  Logger.log('Your chat ID is: ' + updates[updates.length - 1].message.chat.id);
}

/** Step 3: sends a test message. */
function testTelegram() {
  sendTelegram_('✅ Idealist reminders are connected.');
}

/** Step 4: creates the repeating timer (replaces any existing one). */
function createReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendReminders').timeBased().everyHours(CONFIG.REMINDER_EVERY_HOURS).create();
}

// ====== Helpers ======
function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const headers = SHEETS[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Keep dates as plain text so Sheets doesn't reformat them.
    sh.getRange(2, 1, sh.getMaxRows() - 1, headers.length).setNumberFormat('@');
  }
  return sh;
}

function readTasks_() {
  const rows = sheet_('Tasks').getDataRange().getValues();
  return rows.slice(1).filter(function (r) { return r[0] !== ''; }).map(function (r) {
    return { id: String(r[0]), created: String(r[1]), text: String(r[2]), due: String(r[3]), status: String(r[4]), completed: String(r[5]) };
  });
}

function newId_() { return Utilities.getUuid().slice(0, 8); }
function now_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), DATE_FMT); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
