#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { logger } from './logger.js';
import { IS_SEA } from './assets.js';
import { loadConfig, ROOT, CHANNELS } from './config.js';
import { GoXLRClient } from './goxlr.js';
import { StreamlabsClient } from './streamlabs.js';
import { SyncEngine } from './sync.js';
import { startWebUI, openInBrowser } from './webui.js';
import { startTray } from './tray.js';
import { startUpdateChecker } from './update.js';

let VERSION = '0.0.0';
try {
  VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
} catch {
  // Packaged .exe: version is injected at build time.
  if (typeof __GSS_VERSION__ !== 'undefined') VERSION = __GSS_VERSION__;
}

const HELP = `goxlr-streamlabs-sync v${VERSION}
Sync GoXLR faders & mute buttons to Streamlabs Desktop audio sources.

Usage:
  node src/index.js [options]          (from source)
  goxlr-streamlabs-sync.exe [options]  (packaged)

The packaged exe, launched without arguments, runs in the background
(tray icon + dashboard, no console window).

Options:
  --config <path>   Use a specific config file
  --list            List GoXLR channels and Streamlabs audio sources, then exit
  --open            Open the web dashboard in your browser on startup
  --hidden          Relaunch in the background (no console window) and exit
  --console         Stay attached to the console (skip the exe's auto-background)
  --no-ui           Disable the web dashboard and tray icon for this run
  --dry-run         Log what would be sent to Streamlabs without sending it
  --verbose         Show debug output
  --help            Show this help
  --version         Show version
`;

function parseArgs(argv) {
  const args = {
    config: null,
    list: false,
    dryRun: false,
    verbose: false,
    open: false,
    noUi: false,
    hidden: false,
    console: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--list') args.list = true;
    else if (a === '--open') args.open = true;
    else if (a === '--hidden') args.hidden = true;
    else if (a === '--console') args.console = true;
    else if (a === '--no-ui') args.noUi = true;
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

function relaunchDetached(extraArgs) {
  const rest = (IS_SEA ? process.argv.slice(2) : process.argv.slice(1)).filter((a) => a !== '--hidden');
  spawn(process.execPath, [...rest, ...extraArgs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
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
    log.error(`GoXLR Utility unreachable at ${cfg.goxlr.url} - is the utility running?`);
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
  const userArgs = process.argv.slice(2);
  const args = parseArgs(userArgs);

  // --hidden: relaunch ourselves detached without a console window, then exit.
  if (args.hidden) {
    relaunchDetached(['--console']);
    console.log('goxlr-streamlabs-sync: running in the background (tray icon / dashboard).');
    process.exit(0);
  }

  // Packaged exe double-clicked with no arguments: don't keep a console
  // window hostage - hand over to a detached background process.
  if (IS_SEA && userArgs.length === 0) {
    relaunchDetached(['--console']);
    console.log('goxlr-streamlabs-sync: running in the background (tray icon / dashboard).');
    console.log('Tip: run with --console to keep it attached to a terminal.');
    process.exit(0);
  }

  logger.setVerbose(args.verbose);

  let loaded;
  try {
    loaded = loadConfig(args.config, { optional: args.list });
  } catch (e) {
    logger.error(e.message);
    process.exit(1);
  }
  const { cfg, file, created } = loaded;

  logger.info(`goxlr-streamlabs-sync v${VERSION}${args.dryRun ? ' (dry-run)' : ''}`);
  logger.info(`Config: ${file ?? '(defaults - no config.json yet)'}`);
  if (created) {
    logger.warn('A default config.json was created - open the dashboard to set up your mappings!');
  }

  if (args.list) return listMode(cfg, logger);

  if (!cfg.sync.mappings.length) {
    logger.warn('No mappings configured yet - open the dashboard and add them in the Settings panel.');
  }

  const goxlr = new GoXLRClient({ ...cfg.goxlr, logger });
  const slobs = new StreamlabsClient({ ...cfg.streamlabs, logger });
  const engine = new SyncEngine({ goxlr, slobs, config: cfg, logger, dryRun: args.dryRun });

  const dashHost = cfg.ui.host === '0.0.0.0' ? '127.0.0.1' : cfg.ui.host;
  const dashUrl = `http://${dashHost}:${cfg.ui.port}`;

  const shutdown = (reason) => {
    logger.info(`Shutting down${reason ? ` (${reason})` : ''}.`);
    goxlr.close();
    slobs.close();
    process.exit(0);
  };

  let updateInfo = { available: false, latest: null, url: null };

  // Start the dashboard before connecting: its port doubles as the
  // single-instance lock (a second launch just reopens the dashboard).
  if (cfg.ui.enabled && !args.noUi) {
    try {
      await startWebUI({
        cfg,
        configFile: file,
        goxlr,
        slobs,
        engine,
        logger,
        version: VERSION,
        getUpdate: () => updateInfo,
        openBrowser: args.open || cfg.ui.openBrowser || created,
      });
    } catch (e) {
      if (e.code === 'EADDRINUSE') {
        logger.warn(`Already running (dashboard port ${cfg.ui.port} is busy) - opening ${dashUrl} instead.`);
        openInBrowser(dashUrl, logger);
        process.exit(0);
      }
      logger.warn(`[ui] Dashboard failed to start (${e.message}) - continuing without it.`);
    }
    if (cfg.ui.tray && process.platform === 'win32') {
      startTray({ url: dashUrl, logger, onQuit: () => shutdown('tray') });
    }
  }

  startUpdateChecker({
    version: VERSION,
    enabled: cfg.updateCheck,
    logger,
    onUpdate: (info) => {
      updateInfo = info;
    },
  });

  goxlr.connect();
  slobs.connect();

  process.on('SIGINT', () => shutdown());
}

main().catch((e) => {
  logger.error(e.stack ?? String(e));
  process.exit(1);
});
