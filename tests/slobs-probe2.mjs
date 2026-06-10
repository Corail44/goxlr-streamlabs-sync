// Diagnostic 2: checks the StreamingService model/events and the volmeter
// subscription shapes over a dedicated pipe connection.
//   node tests/slobs-probe2.mjs
import net from 'node:net';

const sock = net.connect({ path: '\\\\.\\pipe\\slobs' });
sock.setEncoding('utf8');
let buf = '';
let id = 0;
let musicResource = null;
let volmeterCount = 0;

const send = (method, resource, args = []) => {
  id += 1;
  console.log(`>> [${id}] ${method} on ${resource}`);
  sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: { resource, args } }) + '\n');
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
      if (m) musicResource = m[1].replace(/\\"/g, '"');
    }
    if (line.includes('subscribeVolmeter') && volmeterCount > 2) continue; // limit spam
    if (line.includes('subscribeVolmeter')) volmeterCount++;
    console.log('<<', line.length > 500 ? line.slice(0, 500) + '...[tronque]' : line);
  }
});
sock.on('error', (e) => {
  console.log('PIPE ERROR:', e.message);
  process.exit(1);
});

sock.on('connect', () => {
  console.log('connected');
  send('getModel', 'StreamingService');
  setTimeout(() => send('streamingStatusChange', 'StreamingService'), 300);
  setTimeout(() => send('getSources', 'AudioService'), 600);
  setTimeout(() => {
    if (musicResource) send('subscribeVolmeter', musicResource);
    else console.log('(Music introuvable)');
  }, 1200);
  setTimeout(() => {
    console.log('--- fin ---');
    process.exit(0);
  }, 5000);
});
