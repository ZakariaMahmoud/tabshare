import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUALITY_NAMES, streamSettings } from '../src/quality.js';

test('quality presets', () => {
  assert.deepEqual([...QUALITY_NAMES], ['low', 'standard', 'high']);
  assert.deepEqual({ ...streamSettings('low', 'isolated', 80) }, { jpegQuality: 50, maxWidth: 1280, maxHeight: 800, deviceScaleFactor: 1 });
  assert.deepEqual({ ...streamSettings('standard', 'isolated', 75) }, { jpegQuality: 75, deviceScaleFactor: 1 });
  assert.deepEqual({ ...streamSettings('high', 'isolated', 80) }, { jpegQuality: 92, deviceScaleFactor: 2 });
});

test('mirror shares keep the sharer’s own screen density', () => {
  assert.equal(streamSettings('high', 'mirror', 80).deviceScaleFactor, 1);
  assert.equal(streamSettings('high', 'mirror', 80).jpegQuality, 92);
});

test('unknown quality falls back to standard; result is frozen', () => {
  const s = streamSettings('nope', 'isolated', 80);
  assert.equal(s.jpegQuality, 80);
  assert.ok(Object.isFrozen(s));
});
