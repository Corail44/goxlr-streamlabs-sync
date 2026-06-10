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

test('valid snapshots and scene rules pass', () => {
  const cfg = mergeWithDefaults({
    sync: {
      snapshots: { Pause: { volumes: { Music: 30 }, muted: { Music: true } } },
      sceneRules: { 'Ma Scene': { snapshot: 'Pause' } },
    },
  });
  validateConfig(cfg);
});

test('snapshot with an out-of-range volume is rejected', () => {
  const cfg = mergeWithDefaults({ sync: { snapshots: { X: { volumes: { Music: 999 } } } } });
  assert.throws(() => validateConfig(cfg), /0-255/);
});

test('scene rule without a snapshot name is rejected', () => {
  const cfg = mergeWithDefaults({ sync: { sceneRules: { Scene: {} } } });
  assert.throws(() => validateConfig(cfg), /snapshot/);
});

test('pin accepts null and 4-8 digits, rejects the rest', () => {
  validateConfig(mergeWithDefaults({ ui: { pin: null } }));
  validateConfig(mergeWithDefaults({ ui: { pin: '1234' } }));
  assert.throws(() => validateConfig(mergeWithDefaults({ ui: { pin: 'abcd' } })), /pin/i);
  assert.throws(() => validateConfig(mergeWithDefaults({ ui: { pin: '12' } })), /pin/i);
});
