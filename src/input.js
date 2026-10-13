// Validation for remote-control messages sent by viewers. Everything here is untrusted.

const MOUSE_ACTIONS = new Set(['move', 'down', 'up']);
const BUTTONS = new Set(['left', 'middle', 'right']);
const NAMED = 'Enter|Backspace|Tab|Escape|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space';
// Ctrl/Cmd combos are limited to editing/navigation. Notably absent: Ctrl+V (would paste the
// *sharer's* clipboard into the page, readable in the stream), Alt combos and function keys.
const EDIT_COMBO = '[acxyzACXYZ]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Backspace|Delete|Home|End';
const KEY_RE = new RegExp(`^(?:[A-Za-z0-9]|${NAMED}|Shift\\+(?:${NAMED})|(?:Control|Meta)\\+(?:Shift\\+)?(?:${EDIT_COMBO}))$`);
const MAX_TEXT = 200;
const MAX_WHEEL = 2000;

const isUnit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, max) => Math.max(-max, Math.min(max, v));

function parseMouse(m) {
  const button = m.button ?? 'left';
  if (!MOUSE_ACTIONS.has(m.action) || !isUnit(m.x) || !isUnit(m.y) || !BUTTONS.has(button)) return null;
  return { type: 'mouse', action: m.action, x: m.x, y: m.y, button };
}

function parseWheel(m) {
  if (!isUnit(m.x) || !isUnit(m.y) || !isFiniteNum(m.dx) || !isFiniteNum(m.dy)) return null;
  return { type: 'wheel', x: m.x, y: m.y, dx: clamp(m.dx, MAX_WHEEL), dy: clamp(m.dy, MAX_WHEEL) };
}

const parseKey = (m) => (typeof m.key === 'string' && KEY_RE.test(m.key) ? { type: 'key', key: m.key } : null);

const parseText = (m) =>
  typeof m.text === 'string' && m.text.length > 0 && m.text.length <= MAX_TEXT
    ? { type: 'text', text: m.text }
    : null;

const PARSERS = { mouse: parseMouse, wheel: parseWheel, key: parseKey, text: parseText };

/** Parses a raw viewer message into a frozen input command, or null if invalid. */
export function parseInputMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const parser = Object.hasOwn(PARSERS, msg.type) ? PARSERS[msg.type] : null;
  const parsed = parser ? parser(msg) : null;
  return parsed ? Object.freeze(parsed) : null;
}
