import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyInput, measureViewport } from '../src/streamer.js';

function fakePage({ inner = { width: 780, height: 493 }, emulated = { width: 1280, height: 800 }, evaluateFails = false } = {}) {
  const calls = [];
  return {
    calls,
    evaluate: async () => {
      if (evaluateFails) throw new Error('page closed');
      return inner;
    },
    viewportSize: () => emulated,
    mouse: {
      move: async (x, y) => calls.push(['move', x, y]),
      down: async (o) => calls.push(['down', o.button]),
      up: async (o) => calls.push(['up', o.button]),
      wheel: async (dx, dy) => calls.push(['wheel', dx, dy]),
    },
    keyboard: {
      press: async (k) => calls.push(['press', k]),
      insertText: async (t) => calls.push(['text', t]),
    },
  };
}

test('measureViewport uses the real window size, not Playwright’s emulated default', async () => {
  assert.deepEqual(await measureViewport(fakePage()), { width: 780, height: 493 });
  assert.deepEqual(await measureViewport(fakePage({ evaluateFails: true })), { width: 1280, height: 800 });
  assert.deepEqual(await measureViewport(fakePage({ inner: { width: 0, height: 0 } })), { width: 1280, height: 800 });
});

test('applyInput maps normalized coordinates onto the measured page when no size is known yet', async () => {
  const page = fakePage();
  await applyInput(page, null, { type: 'mouse', action: 'down', x: 0.5, y: 0.5, button: 'left' });
  assert.deepEqual(page.calls, [['move', 390, 247], ['down', 'left']]);
});

test('applyInput uses the known size and handles every input type', async () => {
  const page = fakePage();
  const size = { width: 1000, height: 500 };
  await applyInput(page, size, { type: 'mouse', action: 'up', x: 0.1, y: 0.2, button: 'right' });
  await applyInput(page, size, { type: 'wheel', x: 0, y: 1, dx: 0, dy: 120 });
  await applyInput(page, size, { type: 'key', key: 'Space' });
  await applyInput(page, size, { type: 'text', text: 'hi' });
  assert.deepEqual(page.calls, [['move', 100, 100], ['up', 'right'], ['move', 0, 500], ['wheel', 0, 120], ['press', ' '], ['text', 'hi']]);
  await assert.rejects(applyInput(page, size, { type: 'nope' }), /unknown input type/);
});
