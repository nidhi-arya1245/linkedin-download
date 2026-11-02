// download-linkedin-resumes – content script (runs on linkedin.com)
(() => {
  if (window.__ldrLoaded) return;
  window.__ldrLoaded = true;

  // ---- Selectors (LinkedIn's CSS classes are obfuscated, so we use stable attributes / text) ----
  const CARD_SEL = 'a[componentkey^="paginatedApplicantCard-"]';
  const CARD_PREFIX = 'paginatedApplicantCard-';
  const DETAIL_SEL = '[data-sdui-screen*="ApplicantDetail"]';
  const DIALOG_SEL = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';
  const NEXT_PAGE_SEL = '[data-testid="pagination-controls-next-button-visible"]';

  let running = false;
  let stopRequested = false;
  const skippedThisRun = new Set(); // ids that failed in this run (so we don't loop on them)

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  let stepDelaySec = 3;
  async function loadSettings() {
    const { settings = {} } = await chrome.storage.local.get('settings');
    stepDelaySec = Math.max(1, Number(settings.stepDelay) || 3);
  }
  // Wait between steps (user-configurable, with a little jitter)
  async function pause(label) {
    const ms = stepDelaySec * 1000; // the SAME wait after every action
    if (label) setStatus(`${label} (waiting ${stepDelaySec}s)`);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { checkStop(); await sleep(250); }
  }
  const isVisible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const textOf = (el) => ((el.innerText || el.getAttribute('aria-label') || '') + '').replace(/\s+/g, ' ').trim();

  class Stopped extends Error {}
  const checkStop = () => { if (stopRequested) throw new Stopped(); };

  async function waitFor(fn, timeout = 10000, interval = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      checkStop();
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  // ---- History (chrome.storage.local) ----
  async function getHistory() {
    return (await chrome.storage.local.get('history')).history || {};
  }
  async function saveHistory(id, entry) {
    const history = await getHistory();
    history[id] = { ...entry, ts: Date.now() };
    await chrome.storage.local.set({ history });
  }

  // ---- Status UI ----
  let badge;
  function setStatus(text, { final = false } = {}) {
    chrome.storage.local.set({ status: text, heartbeat: Date.now() });
    try { chrome.runtime.sendMessage({ type: 'log', line: text }); } catch (e) {}
    if (!badge) {
      badge = document.createElement('div');
      badge.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#1d2226;color:#fff;' +
        'padding:10px 14px;border-radius:10px;font:13px/1.4 -apple-system,Segoe UI,sans-serif;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:320px;display:flex;gap:12px;align-items:center;';
      const msg = document.createElement('span');
      msg.id = 'ldr-msg';
      const btn = document.createElement('button');
      btn.textContent = 'Stop';
      btn.style.cssText = 'background:#b24020;color:#fff;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;';
      btn.onclick = () => { stopRequested = true; setStatus('Stopping…'); };
      btn.id = 'ldr-stop';
      badge.append(msg, btn);
      document.body.appendChild(badge);
    }
    badge.querySelector('#ldr-msg').textContent = 'Resume downloader: ' + text;
    badge.querySelector('#ldr-stop').style.display = final ? 'none' : '';
    if (final) setTimeout(() => { badge?.remove(); badge = null; }, 8000);
  }

  // ---- DOM helpers ----
  const idOfCard = (card) => card.getAttribute('componentkey').slice(CARD_PREFIX.length);
  const cards = () => [...document.querySelectorAll(CARD_SEL)];
  const nameOfCard = (card) => {
    let n = (card.querySelector('p span')?.textContent || '').trim();
    n = n.replace(/\s+is\s+(open to work|hiring|a hirer|an? [a-z ]+)$/i, '').trim(); // drop LinkedIn badge text
    return n || 'applicant';
  };

  function scrollParent(el) {
    let p = el?.parentElement;
    while (p && p !== document.body) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 4) return p;
      p = p.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function findResumeLink() {
    const scope = document.querySelector(DETAIL_SEL) || document;
    const els = [...scope.querySelectorAll('a, button, [role="button"], [role="link"]')]
      .filter((el) => !el.closest(CARD_SEL) && isVisible(el));
    const exact = els.find((el) => /^(view |download )?resume$/i.test(textOf(el)));
    if (exact) return exact;
    return els.find((el) => {
      const t = textOf(el);
      return t.length < 30 && /resume/i.test(t);
    }) || null;
  }

  function findDialog() {
    return [...document.querySelectorAll(DIALOG_SEL)].find(isVisible) || null;
  }
  function findDownloadButton(dialog) {
    return [...dialog.querySelectorAll('a, button, [role="button"]')]
      .filter(isVisible)
      .find((el) => /download/i.test(textOf(el))) || null;
  }
  function closeDialog() {
    const d = findDialog();
    if (!d) return;
    const closeBtn = [...d.querySelectorAll('button, [role="button"]')]
      .find((b) => /^(dismiss|close|cancel)$/i.test(textOf(b)) || /dismiss|close/i.test(b.getAttribute('aria-label') || ''));
    if (closeBtn) closeBtn.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  }

  const bg = (msg) => chrome.runtime.sendMessage(msg);

  // ---- Core: process one applicant ----
  async function processCard(card) {
    const id = idOfCard(card);
    const name = nameOfCard(card);
    setStatus(`opening ${name}…`);

    card.scrollIntoView({ block: 'center' });
    await pause(`${name}: found in list`);
    card.click();

    // wait until the URL reflects this applicant, then let the right panel render
    await waitFor(() => location.href.includes('applicationId=' + id), 8000);
    await pause(`${name}: loading details`);
    await waitFor(() => (document.querySelector(DETAIL_SEL) || document.body).innerText.includes(name), 6000);

    // top-right "Resume" link in the detail pane
    const resumeLink = await waitFor(findResumeLink, 8000);
    if (!resumeLink) {
      await saveHistory(id, { name, status: 'no-resume' });
      setStatus(`${name}: no resume link, skipped`);
      return;
    }
    resumeLink.click();
    await pause(`${name}: resume clicked`);

    // popup with a Download button
    const dialog = await waitFor(findDialog, 8000);
    const dlBtn = dialog && (await waitFor(() => findDownloadButton(findDialog() || dialog), 5000));
    if (!dlBtn) {
      skippedThisRun.add(id);
      closeDialog();
      await pause(`${name}: no download popup found, skipped`);
      return;
    }

    setStatus(`downloading ${name}…`);
    await bg({ type: 'expect-resume', id, name });
    dlBtn.click();
    const result = await bg({ type: 'wait-resume' }); // resolves once the resume tab/download was handled
    closeDialog();
    await pause(`${name}: closing popup`);

    if (result?.via === 'drive') {
      await saveHistory(id, { name, status: 'downloaded', via: 'drive' });
      setStatus(`${name}: saved to Google Drive`);
    } else {
      // not saved → don't record in history, so it is retried on the next run
      skippedThisRun.add(id);
      setStatus(`${name}: could not save to Drive (${result?.via || 'unknown'}), will retry next run`);
    }
  }

  // ---- Paging through the list ----
  async function nextUnprocessedCard() {
    const history = await getHistory();
    return cards().find((c) => {
      const id = idOfCard(c);
      return !history[id] && !skippedThisRun.has(id);
    }) || null;
  }

  // Scroll the left list to its end so lazily-rendered cards appear. Returns true if more cards showed up.
  async function loadMoreInList() {
    const list = cards();
    if (!list.length) return false;
    const before = list.length;
    const sp = scrollParent(list[list.length - 1]);
    sp.scrollTo({ top: sp.scrollHeight, behavior: 'instant' });
    // poll (returns as soon as new cards appear; gives up after 2s at the end of the list)
    return !!(await waitFor(() => cards().length > before, 2000, 200));
  }

  // ---- Pagination: <ul data-testid="pagination-controls-list"> with buttons aria-label="Page N" ----
  const PAGE_LIST_SEL = '[data-testid="pagination-controls-list"]';
  const pageNo = (btn) => {
    const m = /(\d+)/.exec(btn.getAttribute('aria-label') || btn.textContent || '');
    return m ? Number(m[1]) : null;
  };
  const currentPage = () => {
    const b = document.querySelector(`${PAGE_LIST_SEL} button[aria-current="true"]`);
    return b ? pageNo(b) : null;
  };

  async function goNextPage() {
    const cur = currentPage();
    let btn = null;

    // smallest page number higher than the current one
    if (cur != null) {
      const higher = [...document.querySelectorAll(`${PAGE_LIST_SEL} button`)]
        .map((b) => ({ b, n: pageNo(b) }))
        .filter((x) => x.n != null && x.n > cur)
        .sort((x, y) => x.n - y.n);
      if (higher.length) btn = higher[0].b;
    }
    // fallback: a "next" arrow, if LinkedIn shows one
    if (!btn) {
      const wrap = document.querySelector(NEXT_PAGE_SEL);
      if (wrap) {
        const cand = wrap.matches('button, a, [role="button"]') ? wrap : wrap.querySelector('button, a, [role="button"]') || wrap;
        if (!cand.disabled && cand.getAttribute('aria-disabled') !== 'true') btn = cand;
      }
    }
    if (!btn) return false; // no further pages

    const firstBefore = cards()[0] && idOfCard(cards()[0]);
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    const changed = await waitFor(
      () => (cur != null && currentPage() !== cur) || (cards()[0] && idOfCard(cards()[0]) !== firstBefore),
      10000
    );
    if (!changed) return false;
    await pause(`page ${currentPage() ?? '?'} loaded`);
    cards()[0]?.scrollIntoView({ block: 'start' });
    return true;
  }

  async function run() {
    running = true;
    stopRequested = false;
    skippedThisRun.clear();
    let processed = 0;
    let pageProcessed = 0;
    try {
      await chrome.storage.local.set({ running: true });
      await loadSettings();
      setStatus('starting…');
      await waitFor(() => cards().length > 0, 15000);
      if (!cards().length) { setStatus('no applicants found on this page', { final: true }); return; }

      while (true) {
        checkStop();
        await chrome.storage.local.set({ heartbeat: Date.now() });
        const card = await nextUnprocessedCard();
        if (card) {
          try {
            await processCard(card);
            processed++;
            pageProcessed++;
          } catch (e) {
            if (e instanceof Stopped) throw e;
            console.warn('[ldr] failed on', idOfCard(card), e);
            skippedThisRun.add(idOfCard(card));
            closeDialog();
          }
          continue;
        }
        if (await loadMoreInList()) continue;
        // this page is finished (every card is either in history or failed this run)
        const hist = await getHistory();
        const onPage = cards();
        const already = onPage.filter((x) => hist[idOfCard(x)]).length - pageProcessed;
        setStatus(`page ${currentPage() ?? '?'} finished: ${pageProcessed} processed now, ${Math.max(0, already)} already in history`);
        pageProcessed = 0;
        if (await goNextPage()) continue;
        break;
      }
      setStatus(`done – ${processed} new resume(s) downloaded`, { final: true });
    } catch (e) {
      if (e instanceof Stopped) setStatus(`stopped after ${processed} resume(s)`, { final: true });
      else { console.error('[ldr]', e); setStatus('error: ' + e.message, { final: true }); }
    } finally {
      running = false;
      await chrome.storage.local.set({ running: false });
    }
  }

  // ---- Wiring ----
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'start') {
      if (running) sendResponse({ ok: false, reason: 'Already running.' });
      else { run(); sendResponse({ ok: true }); }
    } else if (msg?.type === 'stop') {
      stopRequested = true;
      sendResponse({ ok: true });
    }
  });

  // If LinkedIn did a full page navigation mid-run, pick the run back up.
  (async () => {
    const { running: was, heartbeat = 0 } = await chrome.storage.local.get(['running', 'heartbeat']);
    if (was && Date.now() - heartbeat < 20000 && location.pathname.startsWith('/hiring/applicants')) {
      await sleep(2000);
      if (!running) run();
    }
  })();
})();
