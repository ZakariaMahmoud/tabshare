const $ = (id) => document.getElementById(id);
const screen = $('screen');
const token = new URLSearchParams(location.hash.slice(1)).get('t');
// Remove the secret from the address bar so it isn't shared by accident (screenshots, copy-paste).
history.replaceState(null, '', location.pathname);

const BUTTONS = ['left', 'middle', 'right'];
const NAMED_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
// Must match the server allowlist in src/input.js. Ctrl/Cmd+V is handled by the paste event,
// which sends *your* clipboard text.
const COMBO_KEYS = new Set(['a', 'c', 'x', 'y', 'z', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Home', 'End']);

let ws;
let currentUrl = null;
let frameScale = 1; // frame pixels per CSS pixel of the shared page
let actualSize = false;

// "Fit" scales the frame to the window; "Actual size" shows it 1:1 (sharper text, scrollable).
function applyZoom() {
  const stage = document.querySelector('.stage');
  stage.classList.toggle('actual', actualSize);
  screen.style.width = actualSize && screen.naturalWidth ? `${screen.naturalWidth / frameScale}px` : '';
  $('zoom').textContent = actualSize ? 'Fit to window' : 'Actual size';
}

$('zoom').addEventListener('click', () => {
  actualSize = !actualSize;
  applyZoom();
});
let lastMove = 0;

function showMessage(text) {
  $('message').textContent = text;
  $('message').classList.remove('hidden');
  screen.classList.add('hidden');
}

const send = (msg) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

function point(event) {
  const r = screen.getBoundingClientRect();
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return { x: clamp((event.clientX - r.left) / r.width), y: clamp((event.clientY - r.top) / r.height) };
}

function enableControl() {
  screen.classList.add('control');
  screen.addEventListener('contextmenu', (e) => e.preventDefault());
  screen.addEventListener('mousedown', (e) => {
    e.preventDefault();
    screen.focus();
    send({ type: 'mouse', action: 'down', button: BUTTONS[e.button] ?? 'left', ...point(e) });
  });
  screen.addEventListener('mouseup', (e) => send({ type: 'mouse', action: 'up', button: BUTTONS[e.button] ?? 'left', ...point(e) }));
  screen.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastMove < 33) return; // ~30 moves/s is plenty
    lastMove = now;
    send({ type: 'mouse', action: 'move', ...point(e) });
  });
  screen.addEventListener('wheel', (e) => {
    e.preventDefault();
    send({ type: 'wheel', dx: e.deltaX, dy: e.deltaY, ...point(e) });
  }, { passive: false });
  screen.addEventListener('keydown', (e) => {
    const mod = ['Control', 'Meta'].find((m) => e.getModifierState(m));
    const shift = e.getModifierState('Shift') ? 'Shift+' : '';
    if (e.getModifierState('Alt')) return;
    if (mod) {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!COMBO_KEYS.has(key)) return; // let the browser handle it locally (e.g. Ctrl+V → paste event)
      e.preventDefault();
      send({ type: 'key', key: `${mod}+${shift}${key}` });
    } else if (NAMED_KEYS.has(e.key)) {
      e.preventDefault();
      send({ type: 'key', key: `${shift}${e.key}` });
    } else if (e.key === ' ') {
      e.preventDefault();
      send({ type: 'key', key: 'Space' });
    } else if (e.key.length === 1) {
      e.preventDefault();
      send({ type: 'text', text: e.key });
    }
  });
  screen.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text') ?? '';
    for (let i = 0; i < text.length; i += 200) send({ type: 'text', text: text.slice(i, i + 200) });
  });
}

function onFrame(data) {
  const url = URL.createObjectURL(new Blob([data], { type: 'image/jpeg' }));
  screen.onload = () => {
    if (currentUrl && currentUrl !== url) URL.revokeObjectURL(currentUrl);
    currentUrl = url;
    if (actualSize) applyZoom(); // the frame size can change (e.g. the sharer resized the window)
  };
  screen.src = url;
  screen.classList.remove('hidden');
  $('message').classList.add('hidden');
}

function onControl(msg) {
  if (msg.type === 'hello') {
    $('title').textContent = msg.title || 'Shared tab';
    $('mode').textContent = msg.allowControl ? 'You can control this tab — click it first' : 'View only';
    $('expires').textContent = `until ${new Date(msg.expiresAt).toLocaleTimeString()}`;
    $('quality').textContent = `${msg.quality ?? 'standard'} quality`;
    frameScale = Number(msg.frameScale) > 0 ? Number(msg.frameScale) : 1;
    $('zoom').classList.remove('hidden');
    showMessage('Waiting for the first frame…');
    if (msg.allowControl) enableControl();
  } else if (msg.type === 'ended') {
    showMessage(`Sharing ended (${msg.reason}).`);
  } else if (msg.type === 'error') {
    showMessage(msg.message);
  }
}

function connect() {
  if (!token) {
    showMessage('This link is missing its access token. Ask the sender for the full link.');
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.binaryType = 'arraybuffer';
  ws.addEventListener('open', () => ws.send(JSON.stringify({ token })));
  ws.addEventListener('message', (e) => {
    if (typeof e.data === 'string') {
      try {
        onControl(JSON.parse(e.data));
      } catch {
        /* ignore malformed control messages */
      }
    } else {
      onFrame(e.data);
    }
  });
  ws.addEventListener('close', () => {
    if ($('message').classList.contains('hidden')) showMessage('Disconnected.');
  });
}

connect();
