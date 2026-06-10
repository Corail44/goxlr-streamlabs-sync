// Live test of the Streamlabs client write path (requires Streamlabs Desktop
// with a fresh named pipe, or a token via SLOBS_TOKEN env).
// Full cycle on one audio source: read -> setDeflection(0.5) -> verify ->
// restore original -> verify -> no-op setMuted -> verify.
//
//   node tests/slobs-live-test.mjs [source name]
import { StreamlabsClient } from '../src/streamlabs.js';
import { logger } from '../src/logger.js';

logger.setVerbose(true);

const slobs = new StreamlabsClient({
  transport: process.env.SLOBS_TOKEN ? 'auto' : 'pipe',
  pipeName: 'slobs',
  url: 'ws://127.0.0.1:59650/api',
  token: process.env.SLOBS_TOKEN ?? null,
  logger,
});

function fail(msg) {
  logger.error(`FAIL - ${msg}`);
  slobs.close();
  process.exit(1);
}

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), 8000);
  slobs.once('connected', () => {
    clearTimeout(t);
    resolve();
  });
  slobs.connect();
}).catch(() => fail('could not connect to Streamlabs Desktop'));

const sources = await slobs.getAudioSources().catch((e) => fail(`getSources: ${e.message}`));
logger.info(`${sources.length} audio source(s): ${sources.map((s) => `"${s.name}"`).join(', ')}`);

const wantedName = process.argv[2] ?? 'Chatbox';
const target = sources.find((s) => s.name === wantedName) ?? sources[0];
if (!target) fail('no audio source available to test against');

const d0 = target.fader?.deflection ?? 1;
const m0 = !!target.muted;
logger.info(`Target: "${target.name}" (deflection=${d0}, muted=${m0})`);

async function readBack() {
  const all = await slobs.getAudioSources();
  return all.find((s) => s.sourceId === target.sourceId);
}

const TEST_V = Math.abs(d0 - 0.5) < 0.01 ? 0.6 : 0.5;

await slobs.setDeflection(target.resourceId, TEST_V).catch((e) => fail(`setDeflection: ${e.message}`));
let t1 = await readBack();
if (Math.abs((t1?.fader?.deflection ?? -1) - TEST_V) > 0.01) {
  fail(`deflection not applied (expected ${TEST_V}, got ${t1?.fader?.deflection})`);
}
logger.ok(`setDeflection(${TEST_V}) applied and verified`);

await slobs.setDeflection(target.resourceId, d0).catch((e) => fail(`restore: ${e.message}`));
t1 = await readBack();
if (Math.abs((t1?.fader?.deflection ?? -1) - d0) > 0.01) {
  fail(`deflection not restored (expected ${d0}, got ${t1?.fader?.deflection})`);
}
logger.ok(`Original deflection ${d0} restored and verified`);

await slobs.setMuted(target.resourceId, m0).catch((e) => fail(`setMuted: ${e.message}`));
t1 = await readBack();
if (!!t1?.muted !== m0) fail(`muted state changed (expected ${m0}, got ${t1?.muted})`);
logger.ok(`setMuted(${m0}) no-op verified`);

logger.ok('PASS - Streamlabs write path works (setDeflection + setMuted)');
slobs.close();
process.exit(0);
