# download-linkedin-resumes

A Chrome extension that goes through the applicants of a LinkedIn job, opens each **new** applicant's resume and saves it to **Google Drive**. It remembers who it has already handled, so re-running only picks up new people.

> macOS only for the Drive step (see [Why a helper is needed](#why-a-helper-is-needed)). Tested logic-wise in a sandbox; verify on your own LinkedIn page before relying on it.

---

## What it does

For every applicant that is not yet in the history, on every page of the list:

1. Click the applicant in the left list.
2. Wait for the details on the right, find the **Resume** link (top right) and click it.
3. In the popup that opens, click **Download**.
4. The resume opens in a new tab (Chrome's PDF viewer).
5. Click **Save to Google Drive** in the viewer's toolbar.
6. Chrome shows a "Choose your account" popup. Press **Tab, Tab, Enter** (and Space) to hit **Save**.
7. Wait, close the resume tab, record the applicant in the history, move on.

When the current page has no new applicants left, it clicks the next page number (`Page 2`, `Page 3`, …) and repeats until the last page.

A **wait of the same length** (default 3 s, set in the popup) follows every action.

---

## Folder layout

```
download-linkedin-resumes/
├── manifest.json
├── background.js        service worker: resume tab, Drive click, logging
├── content.js           runs on LinkedIn: walks applicants and pages
├── popup.html / popup.js
├── icons/
├── logs/                download-linkedin-resumes.log is written here
└── native/              macOS helper (one-time setup)
    ├── install_mac.sh
    ├── keys_host.sh
    └── key_watcher.sh
```

---

## Setup

### 1. Load the extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `download-linkedin-resumes` folder.
3. If you loaded an older copy before, **remove it first**. The extension has a fixed ID (`gjajhacfjnmidnpdiemhhbjkdgbkplml`) that the helper trusts.

### 2. Install the macOS helper (one time)

Run as your normal user, **not** with `sudo`:

```bash
bash /path/to/download-linkedin-resumes/native/install_mac.sh
```

It copies the helper to `~/.download-linkedin-resumes/`, registers it with Chrome, and points the logs at this project's `logs/` folder. Re-run it whenever you get a new version of the `native/` scripts.

### 3. Start the key watcher (every session)

In a **separate Terminal window**, and leave it open while downloading:

```bash
bash ~/.download-linkedin-resumes/key_watcher.sh
```

Allow your terminal app under **System Settings → Privacy & Security → Accessibility** (macOS prompts for it the first time). The watcher prints `keys sent` each time it presses the keys.

---

## Running it

1. Sign in to LinkedIn and open a job's applicants page (`linkedin.com/hiring/applicants/...`).
2. Make sure the key watcher is running (step 3 above).
3. Click the extension icon, then **Start download**.
4. **Click back into Chrome and leave it in front.** The keys are sent to whatever window is frontmost.
5. Watch the dark badge at the bottom-right of the page. **Stop** ends the run safely.

### Popup options

| Option | Meaning |
|---|---|
| Wait between steps | Seconds to wait after every action (1–30, default 3). Raise it if LinkedIn or Drive is slow. |
| Close resume tab after saving | Closes the PDF tab once Drive has accepted it. |
| Copy log | Copies the extension's recent steps to the clipboard. |
| Clear history | Forgets every applicant, so everyone is processed again. |

---

## History: no repeated work

* Each applicant is identified by their LinkedIn `applicationId`.
* An applicant is recorded **only after the save to Drive succeeded** (or when they have no resume link, so they aren't re-checked).
* Failed applicants are **not** recorded and are retried on the next run.
* Applicants already in the history are skipped instantly: no click, no waiting.
* The history is stored in the browser (`chrome.storage.local`). It is per browser profile and is removed if you remove the extension.

---

## Logs

Everything is written to one file:

```
download-linkedin-resumes/logs/download-linkedin-resumes.log
```

Follow it live with `tail -f logs/download-linkedin-resumes.log`.

| Prefix | Source |
|---|---|
| `[ext] [page]` | The page script: opening applicants, finding Resume, clicking Download. |
| `[ext]` | The service worker: Drive icon, key press, result. Times shown as `@hh:mm:ss.mmm` are when the event happened. |
| `[helper]` | The helper Chrome launches. |
| `[watcher]` | The Terminal key watcher. |

If the project folder can't be written to (for example macOS-protected folders), the helper falls back to `~/.download-linkedin-resumes/fallback.log`.

---

## Configuration

`~/.download-linkedin-resumes/config.sh` (created by the installer) can hold:

```bash
FINAL_KEYS="return space"   # keys pressed after Tab, Tab. Words: return, enter, space
```

Default presses Return, then Space half a second later (Space is harmless if Return already worked). Restart the watcher after changing it.

---

## Why a helper is needed

The "Choose your account" popup is a **native Chrome dialog**, not part of the web page. Extensions can't click it, so a small helper presses the keys at operating-system level.

* Chrome starts `keys_host.sh` (via native messaging) when the extension needs the keys pressed.
* macOS blocks key presses from that helper, so it passes the request to `key_watcher.sh`, which runs in Terminal and uses Terminal's Accessibility permission.
* The helper also appends the extension's log lines to the project log file.

The extension clicks the Drive icon with Chrome's debugger interface, so Chrome shows a **"started debugging this browser"** banner while a resume is processed. This is expected.

While a resume is processed, any normal browser download Chrome starts is cancelled, so nothing is saved locally.

---

## Troubleshooting

| What you see in the log or badge | Cause | Fix |
|---|---|---|
| `Specified native messaging host not found` | Helper not registered | Run `native/install_mac.sh` (as your normal user), restart Chrome. |
| `Access to the specified native messaging host is forbidden` | Extension ID mismatch | Remove old copies of the extension, load this folder. |
| `KEY WATCHER NOT RUNNING …` | Watcher isn't started | Start `key_watcher.sh` in Terminal and leave it open. |
| `…not allowed to send keystrokes (1002)` | Accessibility not granted | Allow your terminal app in Privacy & Security → Accessibility, then restart the watcher. |
| `Drive icon NOT found` / `no-drive-icon` | Viewer toolbar didn't show the icon | Not signed in to Chrome/Drive, or the resume isn't shown in Chrome's PDF viewer. |
| Keys sent OK, dialog doesn't close | Focus didn't start on "Use a different account", or Return isn't registering | Try `FINAL_KEYS="enter"` or `"space"` in `config.sh`; keep Chrome in front. |
| `no download popup found` | The Download popup didn't appear | Increase "Wait between steps". |
| Nothing starts | Not on an applicants page | Open `linkedin.com/hiring/applicants/...` and reload the tab. |

---

## Limitations

* **macOS only** for the Drive step.
* Chrome must stay the **frontmost app** during a run, and the key watcher must be running.
* Tab, Tab assumes the account popup opens with "Use a different account" focused. The account selected in that popup is whichever is pre-selected.
* LinkedIn changes its page markup from time to time. The extension relies on these hooks, listed here for maintenance:
  * applicant cards: `a[componentkey^="paginatedApplicantCard-"]`
  * details panel: `[data-sdui-screen*="ApplicantDetail"]`
  * pagination: `[data-testid="pagination-controls-list"]` with `button[aria-label="Page N"]` and `aria-current="true"`
  * Resume link and Download button: matched by visible text
  * Drive icon: `cr-icon-button[title="Save to Google Drive"]`
* Use it responsibly and within LinkedIn's terms; the waits are there to keep the pace human-like.

---

## Permissions

| Permission | Used for |
|---|---|
| `storage` | History, settings, step log |
| `tabs` | Detecting and closing the resume tab |
| `debugger` | Finding and clicking the Drive icon inside Chrome's PDF viewer |
| `nativeMessaging` | Talking to the macOS helper and writing the log file |
| `downloads` | Cancelling stray local downloads during a run |
| `activeTab` | Reaching the current tab from the popup |
| Host `*.linkedin.com`, `*.licdn.com` | Running on LinkedIn and its resume files |
