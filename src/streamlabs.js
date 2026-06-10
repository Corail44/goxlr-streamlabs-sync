import { EventEmitter } from 'node:events';
import net from 'node:net';

const BACKOFF_MAX = 15000;

// JSON-RPC 2.0 client for Streamlabs Desktop.
//
// Two transports:
//   - Named pipe \\.\pipe\slobs   (zero config, local only, newline-delimited JSON)
//   - Websocket  ws://127.0.0.1:59650/api (SockJS, requires the API token from
//     Settings -> Remote Control)
//
// Note: Streamlabs' named pipe listener is single-shot — once a client
// disconnects, the pipe is gone until Streamlabs Desktop restarts. This client
// therefore keeps one persistent connection and reconnects with backoff.
export class StreamlabsClient extends EventEmitter {
  constructor({ transport = 'auto', pipeName = 'slobs', url = 'ws://127.0.0.1:59650/api', token = null, logger }) {
    super();
    this.transport = transport;
    this.pipeName = pipeName;
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.log = logger;
    this.sock = null;
    this.ws = null;
    this.mode = null; // 'pipe' | 'ws'
    this.framed = false; // SockJS framing detected on websocket
    this.connected = false;
    this.pending = new Map();
    this.nextId = 1;
    this.backoff = 2000;
    this.closed = false;
    this.buf = '';
    this.warnedPipe = false;
  }

  connect() {
    if (this.closed) return;
    if (this.transport === 'websocket') this.#connectWs();
    else this.#connectPipe(this.transport === 'auto');
  }

  #connectPipe(allowFallback) {
    const path = `\\\\.\\pipe\\${this.pipeName}`;
    this.log.debug(`[streamlabs] Trying named pipe ${path}`);
    const sock = net.connect({ path });
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      if (allowFallback && this.token) {
        this.log.debug(`[streamlabs] Pipe unavailable (${err}), falling back to websocket`);
        this.#connectWs();
        return;
      }
      if (!this.warnedPipe) {
        this.warnedPipe = true;
        this.log.warn('[streamlabs] Cannot reach Streamlabs Desktop (named pipe unavailable).');
        this.log.warn('[streamlabs] If Streamlabs IS running, its pipe is probably stale: restart Streamlabs Desktop,');
        this.log.warn('[streamlabs] or set streamlabs.token in config.json (Settings -> Remote Control) to use the websocket.');
      }
      this.#retry();
    };

    const to = setTimeout(() => fail('timeout'), 4000);
    sock.once('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      this.sock = sock;
      this.mode = 'pipe';
      this.buf = '';
      sock.setEncoding('utf8');
      sock.on('data', (d) => this.#onData(d));
      sock.on('close', () => this.#onClose());
      sock.on('error', (e) => this.log.debug(`[streamlabs] pipe error: ${e.message}`));
      this.#onTransportUp();
    });
    sock.once('error', (e) => {
      clearTimeout(to);
      fail(e.code ?? e.message);
    });
  }

  #connectWs(framedAttempt = false) {
    if (this.closed) return;
    if (!this.token) {
      this.log.warn('[streamlabs] Websocket transport requires streamlabs.token in config.json (Settings -> Remote Control)');
      return this.#retry();
    }
    const url = framedAttempt
      ? `${this.url}/${String(Math.floor(Math.random() * 900) + 100)}/${Math.random().toString(36).slice(2, 10)}/websocket`
      : `${this.url}/websocket`;
    this.log.debug(`[streamlabs] Trying websocket ${url}`);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      return this.#retry();
    }
    this.ws = ws;
    this.mode = 'ws';
    this.framed = false;
    let opened = false;
    let firstMessage = true;

    ws.addEventListener('open', () => {
      opened = true;
      // Raw SockJS websocket endpoint: no hello frame, ready right away.
      // Framed endpoint: wait for the 'o' open frame before talking.
      if (!framedAttempt) this.#onTransportUp();
    });
    ws.addEventListener('message', (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : ev.data.toString();
      if (firstMessage && raw === 'o') {
        firstMessage = false;
        this.framed = true;
        this.#onTransportUp();
        return;
      }
      firstMessage = false;
      this.#onWsFrame(raw);
    });
    ws.addEventListener('close', () => {
      if (!opened && !framedAttempt) {
        this.log.debug('[streamlabs] Raw websocket refused, trying SockJS framed endpoint');
        this.#connectWs(true);
        return;
      }
      this.#onClose();
    });
    ws.addEventListener('error', () => {});
  }

  #onWsFrame(raw) {
    if (raw === 'h' || raw === 'o') return; // SockJS heartbeat / open
    if (raw.startsWith('c')) {
      try {
        this.ws.close();
      } catch {}
      return;
    }
    if (raw.startsWith('a')) {
      let arr;
      try {
        arr = JSON.parse(raw.slice(1));
      } catch {
        return;
      }
      for (const s of arr) this.#handle(s);
      return;
    }
    this.#handle(raw);
  }

  #onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      if (line.trim()) this.#handle(line);
    }
  }

  #handle(s) {
    let msg;
    try {
      msg = JSON.parse(typeof s === 'string' ? s : String(s));
    } catch {
      return;
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    this.log.debug('[streamlabs] event:', JSON.stringify(msg).slice(0, 200));
  }

  async #onTransportUp() {
    this.log.ok(`[streamlabs] Connected to Streamlabs Desktop via ${this.mode === 'pipe' ? 'named pipe' : 'websocket'}`);
    this.backoff = 2000;
    this.warnedPipe = false;
    if (this.mode === 'ws' && this.token) {
      try {
        await this.call('auth', 'TcpServerService', [this.token]);
        this.log.ok('[streamlabs] Authenticated');
      } catch (e) {
        this.log.error(`[streamlabs] Auth failed: ${e.message} — check streamlabs.token in config.json`);
        try {
          this.ws.close();
        } catch {}
        return;
      }
    }
    this.connected = true;
    this.emit('connected');
  }

  #onClose() {
    const was = this.connected;
    this.connected = false;
    this.sock = null;
    this.ws = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('disconnected'));
    }
    this.pending.clear();
    if (was) {
      this.log.warn('[streamlabs] Disconnected from Streamlabs Desktop');
      this.emit('disconnected');
    }
    this.#retry();
  }

  #retry() {
    if (this.closed) return;
    const d = this.backoff;
    this.backoff = Math.min(this.backoff * 1.7, BACKOFF_MAX);
    setTimeout(() => this.connect(), d);
  }

  #send(obj) {
    const s = JSON.stringify(obj);
    if (this.mode === 'pipe') this.sock.write(s + '\n');
    else this.ws.send(this.framed ? JSON.stringify([s]) : s);
  }

  call(method, resource, args = []) {
    return new Promise((resolve, reject) => {
      if (!this.sock && !this.ws) return reject(new Error('not connected'));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.#send({ jsonrpc: '2.0', id, method, params: { resource, args } });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  getAudioSources() {
    return this.call('getSources', 'AudioService');
  }

  setDeflection(resourceId, v) {
    return this.call('setDeflection', resourceId, [v]);
  }

  setMuted(resourceId, m) {
    return this.call('setMuted', resourceId, [m]);
  }

  close() {
    this.closed = true;
    try {
      this.sock?.destroy();
    } catch {}
    try {
      this.ws?.close();
    } catch {}
  }
}
