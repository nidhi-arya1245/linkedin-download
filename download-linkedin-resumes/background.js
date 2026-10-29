// download-linkedin-resumes – service worker
// After the Download click, the resume opens in a new tab (Chrome's PDF viewer).
// We click "Save to Google Drive" there. Nothing is saved locally.

const WINDOW_MS = 90000;
const PDF_VIEWER_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai'; // Chrome's built-in PDF viewer
let waiter = null; // { sendResponse, timer }

const getPending = async () => (await chrome.storage.session.get('pending')).pending || null;
const setPending = (p) => chrome.storage.session.set({ pending: p });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Step log (last 200 lines) – open the popup and click "Copy log" to read it
const stamp = () => { const d = new Date(); return `@${d.toLocaleTimeString('en-GB')}.${String(d.getMilliseconds()).padStart(3, '0')}`; };
function nativeLog(line) { // append to <project>/logs/download-linkedin-resumes.log via the helper
  try {
    chrome.runtime.sendNativeMessage(
      'com.download_linkedin_resumes.keys',
      { action: 'log', line: (stamp() + ' ' + String(line)).replace(/\\/g, '/').replace(/"/g, "'").replace(/[\r\n]+/g, ' ').slice(0, 300) },
      () => void chrome.runtime.lastError
    );
  } catch (e) { /* helper not installed: ignore */ }
}

async function log(msg) {
  console.log('[ldr]', msg);
  nativeLog(msg);
  const { log: lines = [] } = await chrome.storage.local.get('log');
  lines.push(`${new Date().toLocaleTimeString()}  ${msg}`);
  await chrome.storage.local.set({ log: lines.slice(-200) });
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const step = Math.max(1, Number(settings.stepDelay) || 3);
  return { ...settings, step, stepMs: step * 1000 }; // the SAME wait after every action
}

// ---- "Save to Google Drive" button in Chrome's PDF viewer (nested open shadow DOMs) ----
// Returns the button's centre {x, y} if found, else null.
const FIND_BUTTON_SRC = `(() => {
  const find = (root) => {
    const hit = root.querySelector && root.querySelector('cr-icon-button[title="Save to Google Drive"]');
    if (hit) return hit;
    for (const el of (root.querySelectorAll ? root.querySelectorAll('*') : [])) {
      if (el.shadowRoot) { const r = find(el.shadowRoot); if (r) return r; }
    }
    return null;
  };
  const b = find(document);
  if (!b) return null;
  const r = b.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

// The "Choose your account" popup is a NATIVE Chrome dialog (not part of the web page), so it can't be
// clicked through the DOM. A small macOS helper presses Tab, Tab, Enter instead (see native/install_mac.sh).
const KEYS_HOST = 'com.download_linkedin_resumes.keys';
function pressTabTabEnter() {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(KEYS_HOST, { action: 'tab-tab-enter' }, (res) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve({ ok: false, error: err.message });
      resolve(res?.ok ? { ok: true } : { ok: false, error: res?.error || 'helper failed' });
    });
  });
}

// Uses Chrome's debugger protocol: it can see inside the PDF viewer frame and send *real* mouse clicks
// (Chrome shows a "started debugging this browser" banner while attached).
// Flow: click the Drive icon -> wait (popup shows) -> Tab, Tab, Enter -> wait.
async function saveToGoogleDrive(tabId, stepMs) {
  const root = { tabId };
  const sessions = new Set();
  const autoAttach = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };
  const onEvent = (src, method, params) => {
    if (src.tabId !== tabId || method !== 'Target.attachedToTarget') return;
    sessions.add(params.sessionId);
    chrome.debugger.sendCommand({ tabId, sessionId: params.sessionId }, 'Target.setAutoAttach', autoAttach).catch(() => {});
  };
  chrome.debugger.onEvent.addListener(onEvent);

  const locate = async (src) => {
    const targets = [root, ...[...sessions].map((sessionId) => ({ tabId, sessionId }))];
    for (const dbg of targets) {
      try {
        const r = await chrome.debugger.sendCommand(dbg, 'Runtime.evaluate', { expression: src, returnByValue: true });
        if (r?.result?.value) return r.result.value;
      } catch (e) { /* frame may have gone away */ }
    }
    return null;
  };
  const waitLocate = async (src, tries) => {
    for (let i = 0; i < tries; i++) {
      const pos = await locate(src);
      if (pos) return pos;
      await sleep(1000);
    }
    return null;
  };
  const click = async ({ x, y }) => {
    const send = (p) => chrome.debugger.sendCommand(root, 'Input.dispatchMouseEvent', p);
    await send({ type: 'mouseMoved', x, y });
    await send({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send({ type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  };

  try {
    await log('attaching to resume tab');
    await chrome.debugger.attach(root, '1.3');
    await chrome.debugger.sendCommand(root, 'Target.setAutoAttach', autoAttach);

    // 1) "Save to Google Drive" icon in the viewer toolbar
    const icon = await waitLocate(FIND_BUTTON_SRC, 15); // toolbar can take a few seconds to appear
    if (!icon) { await log('Drive icon NOT found'); return 'no-drive-icon'; }
    await log('Drive icon found, clicking');
    await click(icon);
    await sleep(stepMs); // wait: account popup appears (before the keys are pressed)

    // 2) popup is visible now -> press Tab, Tab, Enter (lands on "Save"), then wait
    await log('pressing Tab, Tab, Enter via helper');
    const keys = await pressTabTabEnter();
    await log('helper result: ' + JSON.stringify(keys));
    if (!keys.ok) return 'keys-failed: ' + keys.error;
    await sleep(stepMs); // wait: Drive upload / popup closes
    return 'ok';
  } catch (e) {
    await log('error: ' + (e && e.message));
    return 'error';
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    await chrome.debugger.detach(root).catch(() => {});
  }
}

// ---- Finish / messaging ----
async function finish(via) {
  const p = await getPending();
  if (!p || p.finished) return;
  p.finished = true;
  p.via = via;
  await setPending(p);
  const { closeTab } = await getSettings();
  log('finish: ' + via);
  if (via === 'drive') {
    // saved: close the resume tab and go back to the LinkedIn tab
    if (p.resumeTabId && closeTab !== false) { log('closing resume tab'); await chrome.tabs.remove(p.resumeTabId).catch(() => {}); log('resume tab closed'); }
    if (p.tabId) {
      await chrome.tabs.update(p.tabId, { active: true }).catch(() => {});
      const t = await chrome.tabs.get(p.tabId).catch(() => null);
      if (t) chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    }
  } // on failure the resume tab is left open so you can see what happened
  log('replying to page (waiter ' + (waiter ? 'present' : 'MISSING') + ')');
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.sendResponse({ via });
    waiter = null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'log') { log('[page] ' + msg.line); return; }
  if (msg?.type === 'expect-resume') {
    setPending({ id: msg.id, name: msg.name, tabId: sender.tab?.id, startedAt: Date.now() })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'wait-resume') {
    getPending().then((p) => {
      if (p?.finished) return sendResponse({ via: p.via });
      const timer = setTimeout(() => finish('timeout'), WINDOW_MS - 5000);
      waiter = { sendResponse, timer };
    });
    return true;
  }
});

// The resume opens in a new tab after the Download click
chrome.tabs.onCreated.addListener(async (tab) => {
  const p = await getPending();
  if (!p || p.finished || p.resumeTabId) return;
  if (Date.now() - p.startedAt > WINDOW_MS) return;
  p.resumeTabId = tab.id;
  await setPending(p);
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const p = await getPending();
  if (!p || p.finished || p.resumeTabId !== tabId || p.handling) return;
  const url = tab.url || tab.pendingUrl || '';
  if (!/^https?:/i.test(url)) return; // wait until the tab has a real URL
  p.handling = true;
  await setPending(p);

  const s = await getSettings();
  await sleep(s.stepMs);                                   // wait: resume tab opened / viewer loading
  const result = await saveToGoogleDrive(tabId, s.stepMs); // click Drive icon, wait, click Save, wait
  await log('result: ' + result);
  finish(result === 'ok' ? 'drive' : 'drive-failed:' + result);
});

// No local saves: cancel any browser download that starts while a resume is being processed.
chrome.downloads.onCreated.addListener(async (item) => {
  if (item.byExtensionId) return;
  const p = await getPending();
  if (!p || p.finished || Date.now() - p.startedAt > WINDOW_MS) return;
  chrome.downloads.cancel(item.id, () => chrome.downloads.erase({ id: item.id }));
});
