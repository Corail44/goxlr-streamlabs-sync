import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SyncEngine } from '../../src/sync.js';

const loggerStub = { info() {}, ok() {}, warn() {}, error() {}, debug() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeMocks() {
  const goxlr = new EventEmitter();
  goxlr.snapshotNow = { volumes: { Music: 100 }, mutes: {}, submixActive: false, profileName: 'Base' };
  goxlr.calls = [];
  goxlr.setEffectiveVolume = (ch, v) => {
    goxlr.calls.push([ch, v]);
    return true;
  };
  const slobs = new EventEmitter();
  slobs.connected = true;
  slobs.defl = [];
  slobs.muteCalls = [];
  slobs.getAudioSources = async () => [
    { name: 'Music', sourceId: 'sid1', resourceId: 'rid1', muted: false, fader: { deflection: 0.39 } },
  ];
  slobs.setDeflection = async (r, d) => {
    slobs.defl.push([r, d]);
  };
  slobs.setMuted = async (r, m) => {
    slobs.muteCalls.push([r, m]);
  };
  slobs.subscribeAudioUpdates = async () => {};
  return { goxlr, slobs };
}

const baseCfg = (over = {}) => ({
  sync: {
    throttleMs: 0,
    curveExponent: 1,
    muteMode: 'follow_stream',
    syncOnConnect: true,
    twoWay: true,
    mappings: [{ channel: 'Music', source: 'Music' }],
    profiles: {},
    ...over,
  },
});

test('forward: GoXLR volume change reaches Streamlabs as deflection', async () => {
  const { goxlr, slobs } = makeMocks();
  new SyncEngine({ goxlr, slobs, config: baseCfg(), logger: loggerStub });
  slobs.emit('connected');
  await sleep(30);
  goxlr.emit('volume', 'Music', 128);
  await sleep(30);
  assert.ok(slobs.defl.some(([r, d]) => r === 'rid1' && Math.abs(d - 128 / 255) < 0.001));
});

test('reverse: a Streamlabs slider move drives the GoXLR', async () => {
  const { goxlr, slobs } = makeMocks();
  const engine = new SyncEngine({ goxlr, slobs, config: baseCfg(), logger: loggerStub });
  slobs.emit('connected');
  await sleep(30);
  // Age the forward-write echo marker left by the connect-time full push.
  engine.lastSentToSlobs.set('Music', { d: 0.39, ts: Date.now() - 60000 });
  slobs.emit('apiEvent', 'AudioService.audioSourceUpdated', { sourceId: 'sid1', muted: false, fader: { deflection: 0.8 } });
  await sleep(30);
  assert.deepEqual(goxlr.calls.at(-1), ['Music', 204]);
});

test('reverse is disabled when twoWay is off', async () => {
  const { goxlr, slobs } = makeMocks();
  new SyncEngine({ goxlr, slobs, config: baseCfg({ twoWay: false }), logger: loggerStub });
  slobs.emit('connected');
  await sleep(30);
  slobs.emit('apiEvent', 'AudioService.audioSourceUpdated', { sourceId: 'sid1', muted: false, fader: { deflection: 0.8 } });
  await sleep(30);
  assert.equal(goxlr.calls.length, 0);
});

test('echo of a forward write is not sent back to the GoXLR', async () => {
  const { goxlr, slobs } = makeMocks();
  new SyncEngine({ goxlr, slobs, config: baseCfg(), logger: loggerStub });
  slobs.emit('connected');
  await sleep(30);
  goxlr.emit('volume', 'Music', 128);
  await sleep(30);
  slobs.emit('apiEvent', 'AudioService.audioSourceUpdated', { sourceId: 'sid1', muted: false, fader: { deflection: 128 / 255 } });
  await sleep(30);
  assert.equal(goxlr.calls.length, 0);
});

test('slider quantization noise does not nudge the hardware', async () => {
  const { goxlr, slobs } = makeMocks();
  const engine = new SyncEngine({ goxlr, slobs, config: baseCfg(), logger: loggerStub });
  slobs.emit('connected');
  await sleep(30);
  engine.lastSentToSlobs.set('Music', { d: 0.5, ts: Date.now() - 60000 });
  slobs.emit('apiEvent', 'AudioService.audioSourceUpdated', { sourceId: 'sid1', muted: false, fader: { deflection: 0.506 } });
  await sleep(30);
  assert.equal(goxlr.calls.length, 0, 'within tolerance: ignored');
  slobs.emit('apiEvent', 'AudioService.audioSourceUpdated', { sourceId: 'sid1', muted: false, fader: { deflection: 0.7 } });
  await sleep(30);
  assert.deepEqual(goxlr.calls.at(-1), ['Music', 179]);
});

test('strip mute mutes the mapped Streamlabs source', async () => {
  const { goxlr, slobs } = makeMocks();
  const engine = new SyncEngine({ goxlr, slobs, config: baseCfg(), logger: loggerStub });
  slobs.emit('connected');
  await sleep(30);
  await engine.setSourcesMuted('Music', true);
  assert.ok(slobs.muteCalls.some(([r, m]) => r === 'rid1' && m === true));
  assert.equal(engine.slobsMuted.get('Music'), true);
});

test('a dedicated profile set replaces the default mappings', async () => {
  const { goxlr, slobs } = makeMocks();
  const cfg = baseCfg({ profiles: { Stream: [{ channel: 'Game', source: 'GameSrc' }] } });
  const engine = new SyncEngine({ goxlr, slobs, config: cfg, logger: loggerStub });
  goxlr.emit('ready', { volumes: {}, mutes: {}, submixActive: false, profileName: 'Stream' });
  await sleep(50);
  assert.equal(engine.usingDedicatedSet(), true);
  assert.ok(engine.byChannel.has('Game'));
  assert.equal(engine.byChannel.has('Music'), false);
  goxlr.emit('profile', 'Base');
  await sleep(50);
  assert.equal(engine.usingDedicatedSet(), false);
  assert.ok(engine.byChannel.has('Music'));
});

test('isMuted honors the mute modes', () => {
  const { goxlr, slobs } = makeMocks();
  const engine = new SyncEngine({ goxlr, slobs, config: baseCfg(), logger: loggerStub });
  const toPhones = [{ state: 'MutedToX', func: 'ToPhones' }];
  const toStream = [{ state: 'MutedToX', func: 'ToStream' }];
  const toAll = [{ state: 'MutedToAll', func: 'ToPhones' }];
  assert.equal(engine.isMuted(toPhones), false, 'follow_stream ignores headphone-only mutes');
  assert.equal(engine.isMuted(toStream), true);
  assert.equal(engine.isMuted(toAll), true);
  engine.cfg.muteMode = 'any';
  assert.equal(engine.isMuted(toPhones), true);
  engine.cfg.muteMode = 'off';
  assert.equal(engine.isMuted(toAll), false);
});
