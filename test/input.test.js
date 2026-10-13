import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInputMessage } from '../src/input.js';

const p = (obj) => parseInputMessage(typeof obj === 'string' ? obj : JSON.stringify(obj));

test('parses valid mouse events with default button', () => {
  assert.deepEqual({ ...p({ type: 'mouse', action: 'down', x: 0.5, y: 1 }) }, { type: 'mouse', action: 'down', x: 0.5, y: 1, button: 'left' });
});

test('rejects out-of-range or malformed mouse events', () => {
  assert.equal(p({ type: 'mouse', action: 'down', x: 1.5, y: 0 }), null);
  assert.equal(p({ type: 'mouse', action: 'drag', x: 0, y: 0 }), null);
  assert.equal(p({ type: 'mouse', action: 'up', x: 0, y: 0, button: 'back' }), null);
  assert.equal(p({ type: 'mouse', action: 'up', x: '0', y: 0 }), null);
});

test('clamps wheel deltas', () => {
  const w = p({ type: 'wheel', x: 0, y: 0, dx: -1e9, dy: 50 });
  assert.equal(w.dx, -2000);
  assert.equal(w.dy, 50);
  assert.equal(p({ type: 'wheel', x: 0, y: 0, dx: Infinity, dy: 0 }), null);
});

test('accepts allowlisted keys and editing combos only', () => {
  for (const key of ['Enter', 'a', 'Z', '7', 'Space', 'Shift+Tab', 'Control+a', 'Meta+c', 'Control+z', 'Control+Shift+z', 'Control+Shift+ArrowLeft', 'Meta+Backspace']) {
    assert.ok(p({ type: 'key', key }), key);
  }
  for (const key of ['', 'Control+', 'Hyper+a', 'aa', 'Enter; rm -rf', 'Control+Control+a', 'F12', 'F5', 'Insert',
    'Control+v', 'Meta+V', 'Control+Shift+v', 'Control+t', 'Control+w', 'Control+l', 'Control+Shift+i', 'Alt+ArrowLeft', 'Shift+a']) {
    assert.equal(p({ type: 'key', key }), null, key);
  }
});

test('limits text length', () => {
  assert.ok(p({ type: 'text', text: 'hello' }));
  assert.equal(p({ type: 'text', text: '' }), null);
  assert.equal(p({ type: 'text', text: 'x'.repeat(201) }), null);
});

test('rejects junk', () => {
  assert.equal(p('not json'), null);
  assert.equal(p('null'), null);
  assert.equal(p({ type: 'toString' }), null);
  assert.equal(p({ type: '__proto__' }), null);
});

test('result is frozen', () => {
  assert.ok(Object.isFrozen(p({ type: 'text', text: 'a' })));
});
