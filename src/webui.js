import http from 'node:http';
import { spawn } from 'node:child_process';
import { readAssetText, readAssetBuffer } from './assets.js';

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

// Tiny local dashboard: status page + Server-Sent Events stream. No dependencies.
export function startWebUI({ cfg, goxlr, slobs, engine, logger, version, openBrowser = false }) {
  const ui = cfg.ui;
  const html = readAssetText('src/ui.html').replace('__VERSION__', version);
  const clients = new Set();

  const state = () => ({
    version,
    goxlr: {
      connected: !!goxlr.status && !!goxlr.serial,
      serial: goxlr.serial,
      device: goxlr.status?.mixers?.[goxlr.serial]?.hardware?.device_type ?? null,
    },
    streamlabs: { connected: slobs.connected, mode: slobs.connected ? slobs.mode : null },
    channels: [...engine.byChannel.entries()].map(([ch, maps]) => ({
      channel: ch,
      volume: goxlr.snapshotNow?.volumes?.[ch] ?? null,
      muted: engine.isMuted(goxlr.snapshotNow?.mutes?.[ch] ?? []),
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

  for (const ev of ['ready', 'volume', 'mute', 'disconnected']) goxlr.on(ev, pushState);
  slobs.on('connected', pushState);
  slobs.on('disconnected', pushState);
  logger.subscribe((line) => {
    const payload = `event: log\ndata: ${JSON.stringify(line)}\n\n`;
    for (const res of clients) res.write(payload);
  });

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];

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
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state()));
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
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      logger.info('[ui] Quit requested from the dashboard, shutting down.');
      setTimeout(() => process.exit(0), 150);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
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
