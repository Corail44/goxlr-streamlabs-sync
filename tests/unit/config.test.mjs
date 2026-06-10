import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, mergeWithDefaults, validateConfig } from '../../src/config.js';

test('default config validates', () => {
  validateConfig(defaultConfig());
});

test('valid mappings and profiles pass', () => {
  const cfg = mergeWithDefaults({
    sync: {
      mappings: [{ channel: 'Music', source: 'Music' }],
      profiles: { Stream: [{ channel: 'Game', source: 'Game' }] },
    },
  });
  validateConfig(cfg);
});

test('unknown channel is rejected', () => {
  const cfg = mergeWithDefaults({ sync: { mappings: [{ channel: 'Banana', source: 'X' }] } });
  assert.throws(() => validateConfig(cfg), /unknown channel/);
});

test('empty source is rejected', () => {
  const cfg = mergeWithDefaults({ sync: { mappings: [{ channel: 'Music', source: '  ' }] } });
  assert.throws(() => validateConfig(cfg), /non-empty/);
});

test('bad channel inside a profile set is rejected', () => {
  const cfg = mergeWithDefaults({ sync: { profiles: { P: [{ channel: 'Nope', source: 'X' }] } } });
  assert.throws(() => validateConfig(cfg), /profiles/);
});

test('bad muteMode is rejected', () => {
  const cfg = mergeWithDefaults({ sync: { muteMode: 'sometimes' } });
  assert.throws(() => validateConfig(cfg), /muteMode/);
});

test('non-boolean twoWay is rejected', () => {
  const cfg = mergeWithDefaults({ sync: { twoWay: 'yes' } });
  assert.throws(() => validateConfig(cfg), /twoWay/);
});

test('bad ui port is rejected', () => {
  const cfg = mergeWithDefaults({ ui: { port: 99999999 } });
  assert.throws(() => validateConfig(cfg), /port/);
});
