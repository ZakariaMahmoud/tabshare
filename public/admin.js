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

async function createShare() {
  $('create-error').textContent = '';
  $('create').disabled = true;
  const mode = $('mode').value;
  const includeCookies = mode === 'isolated' && $('include-cookies').checked;
  try {
    await api('/api/shares', {
      method: 'POST',
      body: JSON.stringify({
        tabId: state.selectedTab,
        mode,
        includeCookies,
        cookieDomains: includeCookies ? selectedDomains() : [],
        allowControl: $('allow-control').checked,
        oneTime: $('one-time').checked,
        ttlMinutes: Number($('ttl').value),
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

function renderShare(share) {
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
    await api(`/api/shares/${share.id}`, { method: 'DELETE' }).catch((err) => alert(err.message));
    await loadShares();
  });
  const badges = [
    share.mode,
    share.includeCookies ? `cookies: ${share.cookieDomains.join(', ')}` : 'no cookies',
    share.allowControl ? 'control' : 'view only',
    share.oneTime ? 'one-time' : `max ${share.maxViewers}`,
    `${share.viewers} watching`,
    `expires ${new Date(share.expiresAt).toLocaleTimeString()}`,
  ].map((t) => el('span', { className: 'badge', textContent: t }));
  return el('div', { className: 'share' }, [
    el('div', { className: 'tab-title', textContent: share.tabTitle || share.tabUrl }),
    el('div', { className: 'row' }, badges),
    el('div', { className: 'row' }, [link, copy, revoke]),
  ]);
}

async function loadShares() {
  try {
    const shares = await api('/api/shares');
    $('shares').replaceChildren(...(shares.length ? shares.map(renderShare) : [el('p', { className: 'muted', textContent: 'No active shares.' })]));
  } catch (err) {
    $('shares').replaceChildren(el('p', { className: 'error', textContent: err.message }));
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

updateOptions();
loadStatus();
loadTabs();
loadShares();
setInterval(loadShares, 5000);
setInterval(loadStatus, 10000);
