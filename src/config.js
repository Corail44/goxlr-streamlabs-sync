import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IS_SEA, ROOT } from './assets.js';

export { ROOT } from './assets.js';

export const CHANNELS = [
  'Mic',
  'LineIn',
  'Console',
  'System',
  'Game',
  'Chat',
  'Sample',
  'Music',
  'Headphones',
  'MicMonitor',
  'LineOut',
];

const MUTE_MODES = ['follow_stream', 'any', 'off'];
const TRANSPORTS = ['auto', 'pipe', 'websocket'];

const DEFAULTS = {
  goxlr: {
    url: 'ws://127.0.0.1:14564/api/websocket',
    serial: null,
  },
  streamlabs: {
    transport: 'auto',
    pipeName: 'slobs',
    url: 'ws://127.0.0.1:59650/api',
    token: null,
  },
  sync: {
    throttleMs: 50,
    curveExponent: 1.0,
    muteMode: 'follow_stream',
    syncOnConnect: true,
    twoWay: true,
    mappings: [],
    profiles: {},
    snapshots: {},
    snapshotFadeMs: 1200,
    sceneRules: {},
  },
  ui: {
    enabled: true,
    host: '127.0.0.1',
    port: 14571,
    openBrowser: false,
    tray: true,
    notifications: true,
    pin: null,
  },
  updateCheck: true,
};

const EXAMPLE_MAPPINGS = [
  { channel: 'Mic', source: 'Mic (GoXLR)' },
  { channel: 'Music', source: 'Music (GoXLR)' },
  { channel: 'Game', source: 'Game (GoXLR)' },
  { channel: 'System', source: 'System (GoXLR)' },
  { channel: 'Chat', source: 'Chat (GoXLR)' },
];

export function defaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

// Stable per-user folder - survives wherever the exe is launched from
// (browser temp folders, Downloads, USB sticks...).
export function appDataDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'goxlr-streamlabs-sync');
}

// Where a new config should be created when none exists.
export function defaultConfigPath() {
  return IS_SEA ? path.join(appDataDir(), 'config.json') : path.join(ROOT, 'config.json');
}

export function saveConfigFile(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}

function validateMappings(mappings, label) {
  if (!Array.isArray(mappings)) throw new Error(`config: ${label} must be an array`);
  for (const m of mappings) {
    if (!m || typeof m !== 'object') throw new Error(`config: each mapping in ${label} must be an object`);
    if (!CHANNELS.includes(m.channel)) {
      throw new Error(`config: unknown channel "${m.channel}" in ${label}. Valid channels: ${CHANNELS.join(', ')}`);
    }
    if (typeof m.source !== 'string' || !m.source.trim()) {
      throw new Error(`config: mapping for channel "${m.channel}" in ${label} needs a non-empty "source" name`);
    }
  }
}

export function validateConfig(cfg) {
  const s = cfg.sync;
  validateMappings(s.mappings, 'sync.mappings');
  if (s.profiles == null || typeof s.profiles !== 'object' || Array.isArray(s.profiles)) {
    throw new Error('config: sync.profiles must be an object (GoXLR profile name -> mappings array)');
  }
  for (const [name, set] of Object.entries(s.profiles)) {
    validateMappings(set, `sync.profiles["${name}"]`);
  }
  if (s.snapshots == null || typeof s.snapshots !== 'object' || Array.isArray(s.snapshots)) {
    throw new Error('config: sync.snapshots must be an object');
  }
  for (const [name, snap] of Object.entries(s.snapshots)) {
    if (!snap || typeof snap !== 'object') throw new Error(`config: snapshot "${name}" must be an object`);
    for (const [ch, v] of Object.entries(snap.volumes ?? {})) {
      if (!CHANNELS.includes(ch)) throw new Error(`config: snapshot "${name}" has unknown channel "${ch}"`);
      if (typeof v !== 'number' || v < 0 || v > 255) throw new Error(`config: snapshot "${name}" volume for ${ch} must be 0-255`);
    }
    for (const [ch, m] of Object.entries(snap.muted ?? {})) {
      if (!CHANNELS.includes(ch)) throw new Error(`config: snapshot "${name}" has unknown channel "${ch}"`);
      if (typeof m !== 'boolean') throw new Error(`config: snapshot "${name}" muted for ${ch} must be a boolean`);
    }
  }
  if (typeof s.snapshotFadeMs !== 'number' || s.snapshotFadeMs < 0 || s.snapshotFadeMs > 30000) {
    throw new Error('config: sync.snapshotFadeMs must be a number between 0 and 30000');
  }
  if (s.sceneRules == null || typeof s.sceneRules !== 'object' || Array.isArray(s.sceneRules)) {
    throw new Error('config: sync.sceneRules must be an object (scene name -> { snapshot })');
  }
  for (const [scene, rule] of Object.entries(s.sceneRules)) {
    if (!rule || typeof rule !== 'object' || typeof rule.snapshot !== 'string' || !rule.snapshot.trim()) {
      throw new Error(`config: sceneRules["${scene}"] needs a "snapshot" name`);
    }
  }
  if (!MUTE_MODES.includes(s.muteMode)) {
    throw new Error(`config: sync.muteMode must be one of: ${MUTE_MODES.join(', ')}`);
  }
  if (typeof s.curveExponent !== 'number' || s.curveExponent <= 0) {
    throw new Error('config: sync.curveExponent must be a number > 0');
  }
  if (typeof s.throttleMs !== 'number' || s.throttleMs < 0) {
    throw new Error('config: sync.throttleMs must be a number >= 0');
  }
  if (typeof s.twoWay !== 'boolean') {
    throw new Error('config: sync.twoWay must be a boolean');
  }
  if (!TRANSPORTS.includes(cfg.streamlabs.transport)) {
    throw new Error(`config: streamlabs.transport must be one of: ${TRANSPORTS.join(', ')}`);
  }
  if (
    typeof cfg.ui.enabled !== 'boolean' ||
    typeof cfg.ui.openBrowser !== 'boolean' ||
    typeof cfg.ui.tray !== 'boolean' ||
    typeof cfg.ui.notifications !== 'boolean'
  ) {
    throw new Error('config: ui.enabled, ui.openBrowser, ui.tray and ui.notifications must be booleans');
  }
  if (!Number.isInteger(cfg.ui.port) || cfg.ui.port < 1 || cfg.ui.port > 65535) {
    throw new Error('config: ui.port must be an integer between 1 and 65535');
  }
  if (typeof cfg.ui.host !== 'string' || !cfg.ui.host.trim()) {
    throw new Error('config: ui.host must be a non-empty string');
  }
  if (cfg.ui.pin !== null && !(typeof cfg.ui.pin === 'string' && /^\d{4,8}$/.test(cfg.ui.pin))) {
    throw new Error('config: ui.pin must be null or a 4-8 digit string');
  }
  if (typeof cfg.updateCheck !== 'boolean') {
    throw new Error('config: updateCheck must be a boolean');
  }
}

export function mergeWithDefaults(raw) {
  return {
    goxlr: { ...DEFAULTS.goxlr, ...raw.goxlr },
    streamlabs: { ...DEFAULTS.streamlabs, ...raw.streamlabs },
    sync: { ...DEFAULTS.sync, ...raw.sync },
    ui: { ...DEFAULTS.ui, ...raw.ui },
    updateCheck: typeof raw.updateCheck === 'boolean' ? raw.updateCheck : DEFAULTS.updateCheck,
  };
}

// Search order: --config > ./config.json (cwd) > next to the exe / project root
// > %APPDATA%\goxlr-streamlabs-sync\config.json. The packaged exe creates the
// APPDATA one on first run.
export function loadConfig(explicitPath, { optional = false } = {}) {
  const candidates = explicitPath
    ? [path.resolve(explicitPath)]
    : [
        path.resolve(process.cwd(), 'config.json'),
        path.join(ROOT, 'config.json'),
        path.join(appDataDir(), 'config.json'),
      ];
  let file = candidates.find((p) => fs.existsSync(p));
  let created = false;

  if (!file && IS_SEA && !explicitPath) {
    const target = defaultConfigPath();
    const initial = defaultConfig();
    initial.sync.mappings = EXAMPLE_MAPPINGS;
    try {
      saveConfigFile(target, initial);
      file = target;
      created = true;
    } catch {
      // unwritable: fall through to the error below
    }
  }

  if (!file) {
    if (optional) return { cfg: defaultConfig(), file: null, created: false };
    throw new Error(
      `No config.json found (looked at: ${candidates.join(' ; ')})\n` +
        `  -> Copy "${path.join(ROOT, 'config.example.json')}" to "${defaultConfigPath()}" and edit the mappings.`
    );
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Invalid JSON in ${file}: ${e.message}`);
  }

  const cfg = mergeWithDefaults(raw);
  validateConfig(cfg);
  return { cfg, file, created };
}
