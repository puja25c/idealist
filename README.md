# Idealist

Voice-record **ideas** and **daily tasks** on your phone. Ideas and tasks are saved to a Google Sheet, and a Telegram bot reminds you of pending tasks every 4 hours.

```
Phone (PWA on GitHub Pages)  ──►  Google Apps Script  ──►  Google Sheet (Ideas, Tasks)
                                        │
                                        └── timer every 4h ──► Telegram message
```

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css`, `app.js` | The app |
| `manifest.webmanifest`, `sw.js`, `icons/` | Makes it installable on your home screen |
| `apps-script/Code.gs` | Backend: saves to the sheet + sends Telegram reminders |
| `sheet-template/*.csv` | Column layout (the script also creates these tabs for you) |

---

## Setup (about 15 minutes)

### 1. Create the Google Sheet
1. Go to <https://sheets.new> and name it **Idealist**.
2. Open **Extensions → Apps Script**.
3. Delete what's there and paste the contents of `apps-script/Code.gs`.
4. At the top, change `SECRET` to a long random word (you'll enter the same one in the app).
5. In the function dropdown pick **`setupSheets`** and click **Run**. Approve the permission prompt.
   You'll now have **Ideas** and **Tasks** tabs with the right columns.
6. Set your time zone: **Project Settings (⚙) → Show "appsscript.json"**, or simply **Project Settings → Time zone**.

### 2. Create the Telegram bot
1. In Telegram, search for **@BotFather** → send `/newbot` → follow the prompts.
2. Copy the **bot token** it gives you into `TELEGRAM_BOT_TOKEN` in `Code.gs`.
3. Open your new bot in Telegram and send it any message (e.g. "hi").
4. Back in Apps Script run **`findChatId`**, then open **Execution log**. Copy the number into `TELEGRAM_CHAT_ID`.
5. Run **`testTelegram`**. You should get a message on your phone.
6. Run **`createReminderTrigger`**. Reminders now go out every 4 hours (not between 10 PM and 7 AM).

### 3. Deploy the backend
1. Click **Deploy → New deployment → type: Web app**.
2. *Execute as:* **Me**. *Who has access:* **Anyone**.
3. Click **Deploy**, approve permissions, and copy the **Web app URL**.

> After you edit `Code.gs` later, use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** so the URL stays the same.

### 4. Put the app on GitHub Pages
1. Create a new GitHub repository (e.g. `idealist`), then upload everything in this folder **except** you don't need `apps-script/` or `sheet-template/` there (harmless if you do).
2. Repo **Settings → Pages → Source: Deploy from a branch → `main` / root → Save**.
3. After a minute your app is at `https://<your-username>.github.io/idealist/`.

### 5. Install on your phone
1. Open that link in **Chrome on Android**.
2. Menu (⋮) → **Add to Home screen** / **Install app**.
3. Open Idealist → in **Settings** paste the **Web app URL** and **Secret**, tap **Test connection**, then **Save settings**.
4. Allow the microphone when asked.

---

## Using it
- **Idea Generator**: tap 🎤, speak, tap again to stop, fix any words by typing, tap **Save idea**.
- **Daily Task**: dictate the task, choose **Get it done by** (or tap a quick option), tap **Save task**.
- **My tasks**: **Pending** and **Done** tabs. Each pending task shows when it's due (overdue ones in red) with **✓ Done** and **↻ Reschedule** buttons.
- **My ideas**: all saved ideas, newest first. **↗ Share** opens your phone's share sheet (WhatsApp, Telegram, Gmail, Messages, etc.). **Copy** copies the text.
- If you're offline when saving, the item is kept on the phone and synced automatically later.

## Adding features later
Everything is deliberately small and separate:
1. **New data** → add a tab name + columns to `SHEETS` in `Code.gs`, add a `case` in `handleAction_()`.
2. **New screen** → add a `<section class="view" id="view-xyz">` in `index.html`, a title in `titles` in `app.js`, and call `callApi('yourAction', {...})`.
3. **Update the app** → push to GitHub; bump `CACHE` in `sw.js` (`idealist-v2`) so phones refresh.

Ideas for next: recurring tasks, priorities/tags, turn an idea into a task, weekly digest on Telegram, search ideas.

## Security note
The Web app URL + Secret are the only thing protecting your sheet. They're stored only on your phone (not in the GitHub repo). Don't share them.
