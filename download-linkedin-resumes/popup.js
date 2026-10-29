const $ = (id) => document.getElementById(id);

async function refresh() {
  const { history = {}, status, settings = {} } = await chrome.storage.local.get(['history', 'status', 'settings']);
  const done = Object.values(history).filter((h) => h.status === 'downloaded').length;
  $('count').textContent = `${done} downloaded so far`;
  $('closeTab').checked = settings.closeTab !== false;
  if (document.activeElement !== $('stepDelay')) $('stepDelay').value = settings.stepDelay || 3;
  if (status && !$('status').classList.contains('err')) $('status').textContent = status;
}

$('start').addEventListener('click', async () => {
  const st = $('status');
  st.classList.remove('err');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/www\.linkedin\.com\/hiring\/applicants\//.test(tab.url || '')) {
    st.classList.add('err');
    st.textContent = 'Open a LinkedIn job applicants page (/hiring/applicants/…) first.';
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'start' });
    st.textContent = res?.ok ? 'Started – you can watch progress on the page.' : (res?.reason || 'Could not start.');
    if (res?.ok) setTimeout(() => window.close(), 900);
  } catch (e) {
    st.classList.add('err');
    st.textContent = 'Page not ready. Reload the LinkedIn tab and try again.';
  }
});

$('closeTab').addEventListener('change', async (e) => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  settings.closeTab = e.target.checked;
  await chrome.storage.local.set({ settings });
});

$('stepDelay').addEventListener('change', async (e) => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  settings.stepDelay = Math.min(30, Math.max(1, Number(e.target.value) || 3));
  await chrome.storage.local.set({ settings });
});

$('copylog').addEventListener('click', async () => {
  const { log = [] } = await chrome.storage.local.get('log');
  await navigator.clipboard.writeText(log.join('\n') || '(log is empty)');
  $('status').textContent = `Copied ${log.length} log line(s) to clipboard.`;
});

$('clear').addEventListener('click', async () => {
  if (confirm('Forget all downloaded applicants? They will be downloaded again next run.')) {
    await chrome.storage.local.remove(['history', 'status']);
    $('status').textContent = 'History cleared.';
    refresh();
  }
});

chrome.storage.onChanged.addListener(refresh);
refresh();
