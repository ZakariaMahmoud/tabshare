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

function toast(message, isError = false) {
  const node = el('div', { className: `toast${isError ? ' err' : ''}`, textContent: message });
  $('toasts').append(node);
  setTimeout(() => node.remove(), 2600);
}

// ---- status ------------------------------------------------------------
let publicUrl = null;

async function loadStatus() {
  try {
    const s = await api('/api/status');
    if (Number.isInteger(s.maxExpiryMinutes) && s.maxExpiryMinutes !== maxExpiryMinutes) {
      maxExpiryMinutes = s.maxExpiryMinutes;
      refreshExpiryPicker();
    }
    const chrome = $('chrome-chip');
    chrome.className = `chip ${s.chromeConnected ? 'ok' : 'bad'}`;
    $('chrome-text').textContent = s.chromeConnected ? 'Chrome connected' : 'Chrome not connected — run npm run chrome';

    publicUrl = s.publicUrl ?? null;
    $('url-chip').className = `chip url-chip ${publicUrl ? 'ok' : ''}`;
    $('url-text').textContent = publicUrl ?? 'No public URL yet';
    $('copy-url').classList.toggle('hidden', !publicUrl);
  } catch (err) {
    $('chrome-chip').className = 'chip bad';
    $('chrome-text').textContent = err.message;
  }
}

$('copy-url').addEventListener('click', async () => {
  if (!publicUrl) return;
  try {
    await navigator.clipboard.writeText(publicUrl);
    toast('Public URL copied');
  } catch {
    toast('Could not copy', true);
  }
});

// ---- tab picker --------------------------------------------------------
const AVATAR_HUES = 360;
function avatarColor(text) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % AVATAR_HUES;
  return `hsl(${hash} 52% 48%)`;
}

const TICK = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M5 13l4 4L19 7');
  svg.append(path);
  return el('span', { className: 'tick' }, [svg]);
};

function renderTab(tab) {
  const title = tab.title || '(untitled)';
  const radio = el('input', { type: 'radio', name: 'tab', value: tab.id, checked: tab.id === state.selectedTab });
  radio.addEventListener('change', () => selectTab(tab.id));
  const avatar = el('span', { className: 'avatar', textContent: title.trim()[0] || '?' });
  avatar.style.background = avatarColor(title);
  const meta = el('span', { className: 'meta' }, [
    el('span', { className: 'tab-title', textContent: title }),
    el('span', { className: 'tab-url', textContent: tab.url }),
  ]);
  return el('label', { className: 'tab' }, [radio, avatar, meta, TICK()]);
}

function renderTabList() {
  const list = $('tabs');
  const q = $('tab-search').value.trim().toLowerCase();
  const shown = q
    ? state.tabs.filter((t) => `${t.title} ${t.url}`.toLowerCase().includes(q))
    : state.tabs;
  if (shown.length === 0) {
    list.replaceChildren(el('p', { className: 'muted', textContent: q ? 'No tabs match your search.' : 'No http(s) tabs open in the tabshare Chrome window.' }));
  } else {
    list.replaceChildren(...shown.map(renderTab));
  }
}

async function loadTabs() {
  try {
    state.tabs = await api('/api/tabs');
  } catch (err) {
    $('tabs').replaceChildren(el('p', { className: 'error', textContent: err.message }));
    return;
  }
  $('tab-search').classList.toggle('hidden', state.tabs.length <= 6);
  if (!state.tabs.some((t) => t.id === state.selectedTab)) selectTab(null);
  renderTabList();
}

function selectTab(id) {
  state.selectedTab = id;
  $('create').disabled = !id;
  updateSummary();
  if ($('include-cookies').checked) loadDomains();
}

// ---- cookie domains ----------------------------------------------------
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

const selectedDomains = () => [...$('domains').querySelectorAll('input:checked')].map((i) => i.value);
const currentMode = () => $('mode').value;

function updateOptions() {
  const mode = currentMode();
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
  updateSummary();
}

function updateSummary() {
  const tab = state.tabs.find((t) => t.id === state.selectedTab);
  if (!tab) {
    $('summary').textContent = 'Choose a tab to share.';
    return;
  }
  const mode = currentMode() === 'mirror' ? 'Mirror of' : 'Isolated copy of';
  const control = $('allow-control').checked ? 'can control' : 'view only';
  const viewers = Number($('max-viewers').value);
  const parts = [`<b>${mode}</b> “${tab.title || tab.url}”`, control, `${viewers} viewer${viewers === 1 ? '' : 's'}`];
  if (currentMode() === 'isolated' && $('include-cookies').checked) parts.push('logged in');
  if ($('one-time').checked) parts.push('one-time');
  $('summary').innerHTML = parts.join(' · ');
}

// ---- expiry ------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
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
  updateSummary();
}

async function createShare() {
  $('create-error').textContent = '';
  $('create').disabled = true;
  const mode = currentMode();
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
    toast('Share link created');
  } catch (err) {
    $('create-error').textContent = err.message;
    toast(err.message, true);
  } finally {
    $('create').disabled = !state.selectedTab;
  }
}

// ---- active shares -----------------------------------------------------
// Share cards are kept between refreshes and updated in place, so the periodic refresh never
// destroys a button you're about to click or the text you've selected in a link box.
const shareCards = new Map(); // share id -> { node, liveEl, badgesEl, dynKey }

function badgeList(share) {
  const watching = share.oneTime
    ? `${share.viewers} watching · one-time`
    : `${share.viewers}/${share.maxViewers} watching`;
  return [
    { text: share.mode },
    { text: `${share.quality} quality` },
    { text: share.includeCookies ? `cookies: ${share.cookieDomains.join(', ')}` : 'no cookies' },
    { text: share.allowControl ? 'control' : 'view only' },
    { text: watching, accent: true },
    { text: `expires ${formatWhen(share.expiresAt)}` },
  ];
}

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>';

function createShareCard(share) {
  const live = el('span', { className: 'live' });
  const head = el('div', { className: 'share-head' }, [
    el('span', { className: 'title', textContent: share.tabTitle || share.tabUrl }),
    live,
  ]);

  const badgesEl = el('div', { className: 'badges' });

  const link = el('input', { type: 'text', value: share.link, readOnly: true });
  link.addEventListener('focus', () => link.select());
  const copy = el('button', { className: 'copy-btn', type: 'button' });
  copy.innerHTML = `${COPY_ICON}<span>Copy link</span>`;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(share.link);
      copy.classList.add('done');
      copy.querySelector('span').textContent = 'Copied';
      toast('Link copied');
      setTimeout(() => {
        copy.classList.remove('done');
        copy.querySelector('span').textContent = 'Copy link';
      }, 1600);
    } catch {
      toast('Could not copy', true);
    }
  });

  const revoke = el('button', { className: 'btn-danger', type: 'button', textContent: 'Stop sharing' });
  revoke.addEventListener('click', async () => {
    revoke.disabled = true;
    try {
      await api(`/api/shares/${share.id}`, { method: 'DELETE' });
      toast('Sharing stopped');
    } catch (err) {
      toast(err.message, true);
      revoke.disabled = false;
    }
    await loadShares();
  });

  const node = el('div', { className: 'share' }, [
    head,
    badgesEl,
    el('div', { className: 'link-row' }, [link, copy]),
    el('div', { className: 'share-actions' }, [revoke]),
  ]);
  return { node, liveEl: live, badgesEl, dynKey: '' };
}

function updateShareCard(card, share) {
  const badges = badgeList(share);
  const key = `${share.viewers}|${share.expiresAt}|${badges.map((b) => b.text).join(',')}`;
  if (key === card.dynKey) return;
  card.dynKey = key;

  const watching = share.viewers > 0;
  card.liveEl.className = `live${watching ? '' : ' idle'}`;
  card.liveEl.textContent = watching ? 'Live' : 'Idle';

  card.badgesEl.replaceChildren(
    ...badges.map((b) => el('span', { className: `badge${b.accent ? ' accent' : ''}`, textContent: b.text })),
  );
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
    updateShareCard(card, share);
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

// ---- wiring ------------------------------------------------------------
$('refresh').addEventListener('click', loadTabs);
$('tab-search').addEventListener('input', renderTabList);
$('mode').addEventListener('change', updateOptions);
$('quality').addEventListener('change', updateSummary);
$('allow-control').addEventListener('change', updateOptions);
$('one-time').addEventListener('change', updateSummary);
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
