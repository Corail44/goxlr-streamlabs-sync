// Live end-to-end test of the GoXLR Utility client (requires the utility running).
// Nudges the Music channel volume by 1 step and back, and checks that the
// patch stream produces the matching 'volume' events. Restores the original value.
//
//   node tests/goxlr-live-test.mjs
import { GoXLRClient } from '../src/goxlr.js';
import { logger } from '../src/logger.js';

logger.setVerbose(true);

const URL = process.env.GOXLR_URL ?? 'ws://127.0.0.1:14564/api/websocket';
const client = new GoXLRClient({ url: URL, logger });

function waitVolume(channel, value, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      client.off('volume', on);
      reject(new Error(`timeout waiting for ${channel}=${value}`));
    }, ms);
    const on = (ch, v) => {
      if (ch === channel && v === value) {
        clearTimeout(t);
        client.off('volume', on);
        resolve();
      }
    };
    client.on('volume', on);
  });
}

function sendCommand(ws, serial, command) {
  ws.send(JSON.stringify({ id: 9000 + Math.floor(Math.random() * 999), data: { Command: [serial, command] } }));
}

const snap = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('GoXLR Utility unreachable')), 6000);
  client.once('ready', (s) => {
    clearTimeout(t);
    resolve(s);
  });
  client.connect();
});

const original = snap.volumes.Music;
const nudged = original < 255 ? original + 1 : original - 1;
logger.info(`Music volume: ${original} -> nudging to ${nudged} and back`);

const cmd = new WebSocket(URL);
await new Promise((res, rej) => {
  cmd.addEventListener('open', res);
  cmd.addEventListener('error', () => rej(new Error('command socket failed')));
});

try {
  const p1 = waitVolume('Music', nudged);
  sendCommand(cmd, client.serial, { SetVolume: ['Music', nudged] });
  await p1;
  logger.ok(`Event received: Music=${nudged}`);

  const p2 = waitVolume('Music', original);
  sendCommand(cmd, client.serial, { SetVolume: ['Music', original] });
  await p2;
  logger.ok(`Event received: Music=${original} (restored)`);

  logger.ok('PASS — patch stream and volume events work end-to-end');
  process.exitCode = 0;
} catch (e) {
  // Best-effort restore even on failure
  sendCommand(cmd, client.serial, { SetVolume: ['Music', original] });
  logger.error(`FAIL — ${e.message}`);
  process.exitCode = 1;
} finally {
  setTimeout(() => {
    cmd.close();
    client.close();
    process.exit(process.exitCode ?? 0);
  }, 300);
}
