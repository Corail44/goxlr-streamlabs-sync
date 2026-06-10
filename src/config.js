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
  },
  ui: {
    enabled: true,
    host: '127.0.0.1',
    port: 14571,
    openBrowser: false,
    tray: true,
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

export function validateConfig(cfg) {
  const s = cfg.sync;
  if (!Array.isArray(s.mappings)) throw new Error('config: sync.mappings must be an array');
  for (const m of s.mappings) {
    if (!m || typeof m !== 'object') throw new Error('config: each mapping must be an object');
    if (!CHANNELS.includes(m.channel)) {
      throw new Error(`config: unknown channel "${m.channel}". Valid channels: ${CHANNELS.join(', ')}`);
    }
    if (typeof m.source !== 'string' || !m.source.trim()) {
      throw new Error(`config: mapping for channel "${m.channel}" needs a non-empty "source" name`);
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
  if (typeof cfg.ui.enabled !== 'boolean' || typeof cfg.ui.openBrowser !== 'boolean' || typeof cfg.ui.tray !== 'boolean') {
    throw new Error('config: ui.enabled, ui.openBrowser and ui.tray must be booleans');
  }
  if (!Number.isInteger(cfg.ui.port) || cfg.ui.port < 1 || cfg.ui.port > 65535) {
    throw new Error('config: ui.port must be an integer between 1 and 65535');
  }
  if (typeof cfg.ui.host !== 'string' || !cfg.ui.host.trim()) {
    throw new Error('config: ui.host must be a non-empty string');
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
