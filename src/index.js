#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import { loadConfig, ROOT, CHANNELS } from './config.js';
import { GoXLRClient } from './goxlr.js';
import { StreamlabsClient } from './streamlabs.js';
import { SyncEngine } from './sync.js';

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const HELP = `goxlr-streamlabs-sync v${VERSION}
Sync GoXLR faders & mute buttons to Streamlabs Desktop audio sources.

Usage:
  node src/index.js [options]

Options:
  --config <path>   Use a specific config file (default: ./config.json)
  --list            List GoXLR channels and Streamlabs audio sources, then exit
  --dry-run         Log what would be sent to Streamlabs without sending it
  --verbose         Show debug output
  --help            Show this help
  --version         Show version
`;

function parseArgs(argv) {
  const args = { config: null, list: false, dryRun: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--list') args.list = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (a === '--version' || a === '-v') {
      console.log(VERSION);
      process.exit(0);
    } else {
      console.error(`Unknown option: ${a}\n`);
      console.log(HELP);
      process.exit(1);
    }
  }
  return args;
}

function waitFor(emitter, event, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      emitter.off(event, on);
      reject(new Error('timeout'));
    }, ms);
    const on = (...a) => {
      clearTimeout(t);
      resolve(a[0]);
    };
    emitter.once(event, on);
  });
}

async function listMode(cfg, log) {
  const goxlr = new GoXLRClient({ ...cfg.goxlr, logger: log });
  const slobs = new StreamlabsClient({ ...cfg.streamlabs, logger: log });
  goxlr.connect();
  slobs.connect();

  let okGoxlr = false;
  let okSlobs = false;

  const snap = await waitFor(goxlr, 'ready', 6000).catch(() => null);
  console.log('\n=== GoXLR channels ===');
  if (snap) {
    okGoxlr = true;
    for (const ch of CHANNELS) {
      if (!(ch in snap.volumes)) continue;
      const mutes = snap.mutes[ch];
      const muteInfo = mutes?.length ? `  [${mutes.map((m) => `${m.state}/${m.func}`).join(', ')}]` : '';
      console.log(`  ${ch.padEnd(11)} volume=${String(snap.volumes[ch]).padStart(3)}${muteInfo}`);
    }
  } else {
    log.error(`GoXLR Utility unreachable at ${cfg.goxlr.url} — is the utility running?`);
  }

  console.log('\n=== Streamlabs audio sources ===');
  if (!slobs.connected) await waitFor(slobs, 'connected', 6000).catch(() => null);
  if (slobs.connected) {
    try {
      const sources = await slobs.getAudioSources();
      okSlobs = true;
      if (!sources.length) console.log('  (no audio sources found)');
      for (const s of sources) console.log(`  "${s.name}"  (muted=${s.muted}, deflection=${s.fader?.deflection})`);
      console.log('\nUse these exact names in the "source" field of your config.json mappings.');
    } catch (e) {
      log.error(`Could not list sources: ${e.message}`);
    }
  } else {
    log.error('Streamlabs Desktop unreachable (see warnings above).');
  }

  goxlr.close();
  slobs.close();
  process.exit(okGoxlr && okSlobs ? 0 : 1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  logger.setVerbose(args.verbose);

  let loaded;
  try {
    loaded = loadConfig(args.config, { optional: args.list });
  } catch (e) {
    logger.error(e.message);
    process.exit(1);
  }
  const { cfg, file } = loaded;

  logger.info(`goxlr-streamlabs-sync v${VERSION}${args.dryRun ? ' (dry-run)' : ''}`);
  logger.info(`Config: ${file ?? '(defaults — no config.json yet)'}`);

  if (args.list) return listMode(cfg, logger);

  if (!cfg.sync.mappings.length) {
    logger.warn('No mappings configured — nothing will be synced. Edit config.json (see config.example.json).');
  }

  const goxlr = new GoXLRClient({ ...cfg.goxlr, logger });
  const slobs = new StreamlabsClient({ ...cfg.streamlabs, logger });
  new SyncEngine({ goxlr, slobs, config: cfg, logger, dryRun: args.dryRun });

  goxlr.connect();
  slobs.connect();

  process.on('SIGINT', () => {
    logger.info('Shutting down.');
    goxlr.close();
    slobs.close();
    process.exit(0);
  });
}

main().catch((e) => {
  logger.error(e.stack ?? String(e));
  process.exit(1);
});
