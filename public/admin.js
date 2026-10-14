const $ = (id) => document.getElementById(id);
const state = { tabs: [], selectedTab: null };

// The per-run admin key arrives in the URL fragment of the link printed in the terminal.
function readAdminKey() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('k');
  try {
    if (fromHash) sessionStorage.setItem('tabshare-admin-key', fromHash);
    history.replaceState(null, '', location.pathname);
    return fromHash ?? sessionStorage.getItem('tabshare-admin-key') ?? '';
  } catch {
    return fromHash ?? '';
  }
}
const adminKey = readAdminKey();

const MODE_HELP = {
  isolated: 'Opens the tab’s URL in a separate headless browser on this machine and streams it. The viewer can’t reach your other tabs.',
  mirror: 'Streams your actual tab. Whatever you see — including logged-in pages — the viewer sees. Keep the tab in the foreground for smooth video.',
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Tabshare-Admin': adminKey, ...(options.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.data;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function loadStatus() {
  try {
    const s = await api('/api/status');
    if (Number.isInteger(s.maxExpiryMinutes) && s.maxExpiryMinutes !== maxExpiryMinutes) {
      maxExpiryMinutes = s.maxExpiryMinutes;
      refreshExpiryPicker();
    }
    $('status').textContent = `${s.chromeConnected ? 'Chrome connected' : 'Chrome NOT connected — run `npm run chrome`'} · ${s.publicUrl ? `Public URL: ${s.publicUrl}` : 'No public URL yet'}`;
  } catch (err) {
    $('status').textContent = `Error: ${err.message}`;
  }
}

async function loadTabs() {
  const list = $('tabs');
  try {
    state.tabs = await api('/api/tabs');
  } catch (err) {
    list.replaceChildren(el('li', { className: 'error', textContent: err.message }));
    return;
  }
  if (state.tabs.length === 0) {
    list.replaceChildren(el('li', { className: 'muted', textContent: 'No http(s) tabs open in the tabshare Chrome window.' }));
  } else {
    list.replaceChildren(...state.tabs.map(renderTab));
  }
  if (!state.tabs.some((t) => t.id === state.selectedTab)) selectTab(null);
}

function renderTab(tab) {
  const radio = el('input', { type: 'radio', name: 'tab', value: tab.id, checked: tab.id === state.selectedTab });
  radio.addEventListener('change', () => selectTab(tab.id));
  const text = el('div', {}, [
    el('div', { className: 'tab-title', textContent: tab.title || '(untitled)' }),
    el('div', { className: 'tab-url', textContent: tab.url }),
  ]);
  return el('li', {}, [el('label', {}, [radio, text])]);
}

function selectTab(id) {
  state.selectedTab = id;
  $('create').disabled = !id;
  if ($('include-cookies').checked) loadDomains();
}

async function loadDomains() {
  const box = $('domains');
  if (!state.selectedTab) {
    box.replaceChildren(el('span', { className: 'muted', textContent: 'Pick a tab first.' }));
    return;
  }
  box.replaceChildren(el('span', { className: 'muted', textContent: 'Loading…' }));
  try {
    const { domains, suggested } = await api(`/api/tabs/${state.selectedTab}/cookie-domains`);
    if (domains.length === 0) {
      box.replaceChildren(el('span', { className: 'muted', textContent: 'No cookies stored in this Chrome profile.' }));
      return;
    }
    const sorted = [...domains].sort((a, b) => Number(suggested.includes(b.domain)) - Number(suggested.includes(a.domain)));
    box.replaceChildren(
      ...sorted.map((d) =>
        el('label', {}, [
          el('input', { type: 'checkbox', value: d.domain, checked: suggested.includes(d.domain) }),
          document.createTextNode(`${d.domain} (${d.count})`),
        ]),
      ),
    );
  } catch (err) {
    box.replaceChildren(el('span', { className: 'error', textContent: err.message }));
  }
}

function updateOptions() {
  const mode = $('mode').value;
  $('mode-help').textContent = MODE_HELP[mode];
  $('cookie-section').classList.toggle('hidden', mode === 'mirror');
  const cookies = mode === 'isolated' && $('include-cookies').checked;
  $('cookie-picker').classList.toggle('hidden', !cookies);

  const risks = [];
  if (cookies) risks.push('The viewer will see pages as you, logged in to the selected sites.');
  if (mode === 'mirror') risks.push('The viewer sees your real tab, including anything you navigate to in it.');
  if ($('allow-control').checked) risks.push('With control enabled, the viewer can click and type as you — only share with people you trust.');
  $('risk').classList.toggle('hidden', risks.length === 0);
  $('risk').textContent = risks.join(' ');
}

const selectedDomains = () => [...$('domains').querySelectorAll('input:checked')].map((i) => i.value);

const pad = (n) => String(n).padStart(2, '0');
/** Formats a time as the value of an <input type="datetime-local"> (local time, minutes). */
const toLocalInput = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "4:30 PM" today, otherwise "Oct 15, 9:00 AM". */
function formatWhen(ms) {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// The server's limit, from /api/status. The server validates regardless; this only guides the inputs.
let maxExpiryMinutes = 7 * 24 * 60;

/** Keeps the date picker within what the server accepts: 1 minute up to the maximum from now. */
function refreshExpiryPicker() {
  const picker = $('expires-at');
  const now = Date.now();
  picker.min = toLocalInput(now + 60_000);
  picker.max = toLocalInput(now + maxExpiryMinutes * 60_000);
  if (!picker.value) picker.value = toLocalInput(now + 60 * 60_000);
}

const selectExpiry = (kind) => {
  document.querySelector(`input[name="expiry"][value="${kind}"]`).checked = true;
};

function expiryRequest() {
  const kind = document.querySelector('input[name="expiry"]:checked').value;
  if (kind === 'after') return { ttlMinutes: Math.round(Number($('ttl').value) * Number($('ttl-unit').value)) };
  const at = new Date($('expires-at').value).getTime();
  if (!Number.isFinite(at)) throw new Error('Pick a date and time for the link to expire.');
  return { expiresAt: at };
}

function updateViewersHelp() {
  const n = Number($('max-viewers').value);
  $('viewers-help').textContent =
    n === 1 ? 'Only one person can watch at a time.' : `Up to ${n} people can watch at the same time.`;
}

async function createShare() {
  $('create-error').textContent = '';
  $('create').disabled = true;
  const mode = $('mode').value;
  const includeCookies = mode === 'isolated' && $('include-cookies').checked;
  try {
    const expiry = expiryRequest();
    await api('/api/shares', {
      method: 'POST',
      body: JSON.stringify({
        ...expiry,
        tabId: state.selectedTab,
        mode,
        quality: $('quality').value,
        includeCookies,
        cookieDomains: includeCookies ? selectedDomains() : [],
        allowControl: $('allow-control').checked,
        oneTime: $('one-time').checked,
        maxViewers: Number($('max-viewers').value),
      }),
    });
    await loadShares();
  } catch (err) {
    $('create-error').textContent = err.message;
  } finally {
    $('create').disabled = !state.selectedTab;
  }
}

// Share cards are kept between refreshes and updated in place, so the periodic refresh never
// destroys a button you're about to click or the text you've selected in a link box.
const shareCards = new Map(); // share id -> { node, badgeRow, badgeKey }

const badgeTexts = (share) => [
  share.mode,
  `${share.quality} quality`,
  share.includeCookies ? `cookies: ${share.cookieDomains.join(', ')}` : 'no cookies',
  share.allowControl ? 'control' : 'view only',
  share.oneTime ? `one-time · ${share.viewers} watching` : `${share.viewers}/${share.maxViewers} watching`,
  `expires ${formatWhen(share.expiresAt)}`,
];

function createShareCard(share) {
  const link = el('input', { type: 'text', value: share.link, readOnly: true });
  const copy = el('button', { textContent: 'Copy' });
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(share.link);
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = 'Copy'), 1500);
  });
  const revoke = el('button', { className: 'danger', textContent: 'Stop sharing' });
  revoke.addEventListener('click', async () => {
    revoke.disabled = true;
    try {
      await api(`/api/shares/${share.id}`, { method: 'DELETE' });
    } catch (err) {
      alert(err.message);
      revoke.disabled = false;
    }
    await loadShares();
  });
  const badgeRow = el('div', { className: 'row' });
  const node = el('div', { className: 'share' }, [
    el('div', { className: 'tab-title', textContent: share.tabTitle || share.tabUrl }),
    badgeRow,
    el('div', { className: 'row' }, [link, copy, revoke]),
  ]);
  return { node, badgeRow, badgeKey: '' };
}

function updateBadges(card, share) {
  const texts = badgeTexts(share);
  const key = texts.join('\n');
  if (key === card.badgeKey) return;
  card.badgeRow.replaceChildren(...texts.map((t) => el('span', { className: 'badge', textContent: t })));
  card.badgeKey = key;
}

function renderShares(shares) {
  const container = $('shares');
  const liveIds = new Set(shares.map((s) => s.id));
  for (const [id, card] of shareCards) {
    if (!liveIds.has(id)) {
      card.node.remove();
      shareCards.delete(id);
    }
  }
  for (const share of shares) {
    let card = shareCards.get(share.id);
    if (!card) {
      card = createShareCard(share);
      shareCards.set(share.id, card);
      container.append(card.node);
    }
    updateBadges(card, share);
  }
  $('no-shares').classList.toggle('hidden', shares.length > 0);
}

async function loadShares() {
  try {
    renderShares(await api('/api/shares'));
    $('shares-error').textContent = '';
  } catch (err) {
    // Keep the existing cards visible; just report the problem.
    $('shares-error').textContent = `Could not refresh shares: ${err.message}`;
  }
}

$('refresh').addEventListener('click', loadTabs);
$('mode').addEventListener('change', updateOptions);
$('allow-control').addEventListener('change', updateOptions);
$('include-cookies').addEventListener('change', () => {
  updateOptions();
  if ($('include-cookies').checked) loadDomains();
});
$('create').addEventListener('click', createShare);
$('expires-at').addEventListener('focus', refreshExpiryPicker);
$('expires-at').addEventListener('input', () => selectExpiry('at'));
$('ttl').addEventListener('input', () => selectExpiry('after'));
$('ttl-unit').addEventListener('change', () => selectExpiry('after'));
$('max-viewers').addEventListener('input', updateViewersHelp);
refreshExpiryPicker();
updateViewersHelp();

updateOptions();
loadStatus();
loadTabs();
loadShares();
setInterval(loadShares, 5000);
setInterval(loadStatus, 10000);
