// Diagnostic: subscribes to Streamlabs observables over a dedicated pipe
// connection, changes a deflection, and prints every raw line received.
//   node tests/slobs-events-probe.mjs
import net from 'node:net';

const sock = net.connect({ path: '\\\\.\\pipe\\slobs' });
sock.setEncoding('utf8');
let buf = '';
let id = 0;
const send = (method, resource, args = []) => {
  id += 1;
  const msg = { jsonrpc: '2.0', id, method, params: { resource, args } };
  console.log(`>> [${id}] ${method} on ${resource}`);
  sock.write(JSON.stringify(msg) + '\n');
  return id;
};

sock.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    if (!musicResource) {
      const m = /"resourceId":"(AudioSource\[\\"[^\]]+\\"\])","name":"Music"/.exec(line);
      if (m) {
        musicResource = m[1].replace(/\\"/g, '"');
        console.log('   (Music resource trouve:', musicResource + ')');
      }
    }
    console.log('<<', line.length > 400 ? line.slice(0, 400) + '...[tronque]' : line);
  }
});
sock.on('error', (e) => {
  console.log('PIPE ERROR:', e.message);
  process.exit(1);
});

let musicResource = null;

sock.on('connect', async () => {
  console.log('connected');
  send('getSources', 'AudioService');
  setTimeout(() => send('audioSourceUpdated', 'AudioService'), 300);
  setTimeout(() => send('sourceUpdated', 'SourcesService'), 600);
  setTimeout(() => {
    if (musicResource) send('setDeflection', musicResource, [0.31]);
  }, 1500);
  setTimeout(() => {
    if (musicResource) send('setDeflection', musicResource, [0.3]);
  }, 3000);
  setTimeout(() => {
    console.log('--- fin de la sonde ---');
    process.exit(0);
  }, 6000);
});

