import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { IS_SEA, readAssetText, readAssetBuffer } from './assets.js';
import { CHANNELS, defaultConfigPath, mergeWithDefaults, saveConfigFile, validateConfig } from './config.js';
import { getAutostart, setAutostart } from './autostart.js';
import { testStreamlabsToken } from './streamlabs.js';

export function openInBrowser(url, logger) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    logger?.debug?.(`[ui] could not open browser: ${e.message}`);
  }
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Tiny local dashboard: status page + Server-Sent Events stream + settings API.
// No dependencies.
export function startWebUI({ cfg, configFile, goxlr, slobs, engine, logger, version, getUpdate, openBrowser = false, onRestart = null }) {
  const ui = cfg.ui;
  const html = readAssetText('src/ui.html').replace('__VERSION__', version);
  const clients = new Set();
  let cfgFile = configFile;

  const parseSlobsUrl = () => {
    const m = /^wss?:\/\/([^:/]+):(\d+)/.exec(cfg.streamlabs.url) ?? [];
    return { host: m[1] ?? '127.0.0.1', port: Number(m[2] ?? 59650) };
  };

  const lanUrls = () => {
    if (cfg.ui.host !== '0.0.0.0') return [];
    const urls = [];
    for (const list of Object.values(os.networkInterfaces() ?? {})) {
      for (const itf of list ?? []) {
        if (itf.family === 'IPv4' && !itf.internal) urls.push(`http://${itf.address}:${cfg.ui.port}`);
      }
    }
    return urls;
  };

  let live = { streaming: 'offline', recording: 'offline' };

  const state = () => ({
    version,
    configFile: cfgFile,
    channels_list: CHANNELS,
    update: getUpdate ? getUpdate() : { available: false },
    goxlr: {
      connected: !!goxlr.status && !!goxlr.serial,
      serial: goxlr.serial,
      device: goxlr.status?.mixers?.[goxlr.serial]?.hardware?.device_type ?? null,
    },
    streamlabs: { connected: slobs.connected, mode: slobs.connected ? slobs.mode : null },
    settings: {
      muteMode: cfg.sync.muteMode,
      mappings: cfg.sync.mappings,
      hasToken: !!cfg.streamlabs.token,
      slobsHost: parseSlobsUrl().host,
      slobsPort: parseSlobsUrl().port,
      twoWay: cfg.sync.twoWay !== false,
      notifications: cfg.ui.notifications !== false,
    },
    live,
    lan: { enabled: cfg.ui.host === '0.0.0.0', urls: lanUrls() },
    profile: {
      active: goxlr.snapshotNow?.profileName ?? null,
      dedicated: engine.usingDedicatedSet(),
      list: Object.keys(cfg.sync.profiles ?? {}),
      activeMappings: engine.activeSet(),
    },
    submixActive: !!goxlr.snapshotNow?.submixActive,
    channels: [...engine.byChannel.entries()].map(([ch, maps]) => ({
      channel: ch,
      volume: goxlr.snapshotNow?.volumes?.[ch] ?? null,
      muted: engine.channelSourcesMuted(maps),
      goxlrMuted: engine.isMuted(goxlr.snapshotNow?.mutes?.[ch] ?? []),
      sources: maps.map((m) => ({ name: m.source, resolved: !!engine.resourceIds.get(m.source) })),
    })),
    logs: logger.recent(),
  });

  // Coalesce bursts (fader sweeps) into at most ~10 pushes/second.
  let pushTimer = null;
  const pushState = () => {
    if (pushTimer || clients.size === 0) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const payload = `event: state\ndata: ${JSON.stringify(state())}\n\n`;
      for (const res of clients) res.write(payload);
    }, 100);
  };

  for (const ev of ['ready', 'volume', 'mute', 'submix', 'profile', 'disconnected']) goxlr.on(ev, pushState);
  slobs.on('connected', pushState);
  slobs.on('disconnected', pushState);
  slobs.on('apiEvent', pushState);

  // Streaming / recording status (used for the LIVE badge and quit guard).
  let liveTimer = null;
  const fetchLive = () => {
    if (liveTimer) return;
    liveTimer = setTimeout(async () => {
      liveTimer = null;
      if (!slobs.connected) return;
      try {
        const m = await slobs.call('getModel', 'StreamingService');
        live = { streaming: m?.streamingStatus ?? 'offline', recording: m?.recordingStatus ?? 'offline' };
      } catch (e) {
        logger.debug(`[ui] StreamingService.getModel failed: ${e.message}`);
      }
      pushState();
    }, 250);
  };
  slobs.on('connected', async () => {
    try {
      await slobs.call('streamingStatusChange', 'StreamingService');
      await slobs.call('recordingStatusChange', 'StreamingService');
    } catch (e) {
      logger.debug(`[ui] StreamingService subscriptions failed: ${e.message}`);
    }
    fetchLive();
  });
  slobs.on('disconnected', () => {
    live = { streaming: 'offline', recording: 'offline' };
  });
  slobs.on('apiEvent', (rid) => {
    if (typeof rid === 'string' && rid.startsWith('StreamingService.')) fetchLive();
  });
  logger.subscribe((line) => {
    const payload = `event: log\ndata: ${JSON.stringify(line)}\n\n`;
    for (const res of clients) res.write(payload);
  });

  const json = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  async function handleConfigSave(req, res) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return json(res, 400, { error: `invalid JSON body: ${e.message}` });
    }

    // Re-read the file (if any) so we never clobber hand-edited sections.
    let raw = {};
    if (cfgFile && fs.existsSync(cfgFile)) {
      try {
        raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      } catch {
        raw = {};
      }
    }
    const cleanMappings = (arr) =>
      arr.map((m) => ({
        channel: String(m.channel ?? ''),
        source: String(m.source ?? '').trim(),
        ...(m.syncVolume === false ? { syncVolume: false } : {}),
        ...(m.syncMute === false ? { syncMute: false } : {}),
      }));

    const next = mergeWithDefaults(raw);
    next.streamlabs.token = next.streamlabs.token ?? cfg.streamlabs.token;
    next.sync.profiles = { ...(next.sync.profiles ?? {}), ...(cfg.sync.profiles ?? {}) };
    if (Array.isArray(body.mappings) && !body.profileSet) next.sync.mappings = cleanMappings(body.mappings);
    if (typeof body.muteMode === 'string') next.sync.muteMode = body.muteMode;
    if (typeof body.twoWay === 'boolean') next.sync.twoWay = body.twoWay;
    if (typeof body.notifications === 'boolean') next.ui.notifications = body.notifications;

    // Dedicated mapping sets per GoXLR profile
    if (body.profileSet && typeof body.profileSet.name === 'string' && body.profileSet.name.trim()) {
      next.sync.profiles[body.profileSet.name.trim()] = cleanMappings(
        Array.isArray(body.profileSet.mappings) ? body.profileSet.mappings : []
      );
    }
    if (typeof body.profileDelete === 'string') {
      delete next.sync.profiles[body.profileDelete];
    }

    // LAN access toggle (rebinds at next start)
    let needsRestart = false;
    if (typeof body.lanAccess === 'boolean') {
      const wanted = body.lanAccess ? '0.0.0.0' : '127.0.0.1';
      if (wanted !== cfg.ui.host) needsRestart = true;
      next.ui.host = wanted;
    }
    const newToken = typeof body.token === 'string' ? body.token.trim() : '';
    if (newToken) next.streamlabs.token = newToken;

    // Optional websocket host/port override (Streamlabs lets users change them).
    const reqHost = typeof body.slobsHost === 'string' ? body.slobsHost.trim() : '';
    const reqPort = body.slobsPort != null && body.slobsPort !== '' ? Number(body.slobsPort) : null;
    if (reqHost || reqPort != null) {
      const cur = parseSlobsUrl();
      const host = reqHost || cur.host;
      const port = reqPort ?? cur.port;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return json(res, 400, { error: 'invalid Streamlabs port' });
      }
      next.streamlabs.url = `ws://${host}:${port}/api`;
    }

    try {
      validateConfig(next);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }

    const target = cfgFile ?? defaultConfigPath();
    try {
      saveConfigFile(target, next);
      cfgFile = target;
    } catch (e) {
      return json(res, 500, { error: `could not write ${target}: ${e.message}` });
    }

    if (newToken) {
      cfg.streamlabs.token = newToken;
      slobs.token = newToken; // used on the next (re)connection
    }
    if (next.streamlabs.url !== cfg.streamlabs.url) {
      cfg.streamlabs.url = next.streamlabs.url;
      slobs.url = next.streamlabs.url.replace(/\/+$/, '');
    }
    cfg.sync.profiles = next.sync.profiles;
    cfg.ui.notifications = next.ui.notifications;
    await engine.applySettings({ mappings: next.sync.mappings, muteMode: next.sync.muteMode, twoWay: next.sync.twoWay });
    logger.ok(`[ui] Settings saved to ${target}`);
    pushState();
    json(res, 200, { ok: true, file: target, needsRestart });
  }

  const server = http.createServer(async (req, res) => {
    const url = (req.url ?? '/').split('?')[0];

    try {
      if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      } else if (req.method === 'GET' && url === '/icon.ico') {
        try {
          const icon = readAssetBuffer('assets/icon.ico');
          res.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'max-age=86400' });
          res.end(icon);
        } catch {
          res.writeHead(404);
          res.end();
        }
      } else if (req.method === 'GET' && url === '/api/state') {
        json(res, 200, state());
      } else if (req.method === 'GET' && url === '/api/sources') {
        if (!slobs.connected) return json(res, 200, { sources: [] });
        try {
          const sources = await slobs.getAudioSources();
          json(res, 200, { sources: sources.map((s) => s.name) });
        } catch (e) {
          json(res, 200, { sources: [], error: e.message });
        }
      } else if (req.method === 'GET' && url === '/api/autostart') {
        json(res, 200, await getAutostart());
      } else if (req.method === 'POST' && url === '/api/autostart') {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return json(res, 400, { error: 'invalid JSON body' });
        }
        try {
          const result = await setAutostart(!!body.enabled);
          logger.ok(`[ui] Autostart ${result.enabled ? 'enabled' : 'disabled'}${result.command ? ` (${result.command})` : ''}`);
          json(res, 200, result);
        } catch (e) {
          json(res, 500, { error: e.message });
        }
      } else if (req.method === 'POST' && url === '/api/config') {
        await handleConfigSave(req, res);
      } else if (req.method === 'GET' && url === '/api/diagnostic') {
        const report = [
          `goxlr-streamlabs-sync v${version}`,
          `node ${process.version} | ${process.platform} ${os.release()} | packaged=${IS_SEA}`,
          `config: ${cfgFile ?? '(none)'}`,
          `goxlr: ${goxlr.serial ?? 'disconnected'} (${goxlr.status?.mixers?.[goxlr.serial]?.hardware?.device_type ?? '-'}) submixActive=${!!goxlr.snapshotNow?.submixActive} profile=${goxlr.snapshotNow?.profileName ?? '-'}`,
          `streamlabs: ${slobs.connected ? slobs.mode : 'disconnected'} | streaming=${live.streaming} recording=${live.recording}`,
          `twoWay=${cfg.sync.twoWay} muteMode=${cfg.sync.muteMode} uiHost=${cfg.ui.host}`,
          `active mappings (${engine.activeSet().length})${engine.usingDedicatedSet() ? ` [profile ${engine.activeProfile}]` : ' [default]'}:`,
          ...engine.activeSet().map((m) => `  ${m.channel} -> "${m.source}" resolved=${!!engine.resourceIds.get(m.source)} muted=${engine.slobsMuted.get(m.source) ?? '-'}`),
          `profiles with dedicated sets: ${Object.keys(cfg.sync.profiles ?? {}).join(', ') || '(none)'}`,
          '--- last logs ---',
          ...logger.recent().slice(-40).map((l) => `[${l.level}] ${l.msg}`),
        ].join('\n');
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(report);
      } else if (req.method === 'POST' && url === '/api/restart') {
        if (!onRestart) return json(res, 400, { error: 'restart not available' });
        json(res, 200, { ok: true });
        logger.info('[ui] Restart requested from the dashboard.');
        setTimeout(onRestart, 250);
      } else if (req.method === 'POST' && url === '/api/channel-mute') {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return json(res, 400, { error: 'invalid JSON body' });
        }
        try {
          await engine.setSourcesMuted(String(body.channel ?? ''), !!body.muted);
          pushState();
          json(res, 200, { ok: true });
        } catch (e) {
          json(res, 400, { error: e.message });
        }
      } else if (req.method === 'POST' && url === '/api/test-token') {
        let body = {};
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch {}
        const token = (typeof body.token === 'string' && body.token.trim()) || cfg.streamlabs.token;
        let url = cfg.streamlabs.url;
        const tHost = typeof body.host === 'string' ? body.host.trim() : '';
        const tPort = body.port != null && body.port !== '' ? Number(body.port) : null;
        if (tHost || tPort != null) {
          const cur = parseSlobsUrl();
          const port = Number.isInteger(tPort) && tPort >= 1 && tPort <= 65535 ? tPort : cur.port;
          url = `ws://${tHost || cur.host}:${port}/api`;
        }
        const result = await testStreamlabsToken({ url, token });
        logger.info(`[ui] Token test: ${result.ok ? 'OK (websocket + auth)' : `failed (${result.error})`}`);
        json(res, 200, result);
      } else if (req.method === 'GET' && url === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);
        clients.add(res);
        const hb = setInterval(() => res.write(': hb\n\n'), 15000);
        req.on('close', () => {
          clearInterval(hb);
          clients.delete(res);
        });
      } else if (req.method === 'POST' && url === '/api/quit') {
        json(res, 200, { ok: true });
        logger.info('[ui] Quit requested from the dashboard, shutting down.');
        setTimeout(() => process.exit(0), 150);
      } else {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
      }
    } catch (e) {
      logger.debug(`[ui] request error: ${e.message}`);
      try {
        json(res, 500, { error: e.message });
      } catch {}
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(ui.port, ui.host, () => {
      const displayHost = ui.host === '0.0.0.0' ? '127.0.0.1' : ui.host;
      const url = `http://${displayHost}:${ui.port}`;
      logger.ok(`[ui] Dashboard available at ${url}`);
      if (openBrowser) openInBrowser(url, logger);
      resolve(server);
    });
  });
}
