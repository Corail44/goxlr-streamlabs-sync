import { EventEmitter } from 'node:events';
import { applyPatch } from './jsonpatch.js';

// Channels that have a submix volume (outputs like Headphones do not).
const SUBMIX_CHANNELS = ['Mic', 'LineIn', 'Console', 'System', 'Game', 'Chat', 'Sample', 'Music'];

// Client for the GoXLR Utility daemon websocket (https://github.com/GoXLR-on-Linux/goxlr-utility).
// Mirrors the full DaemonStatus locally by applying the JSON Patch stream, then
// emits high-level events:
//   'ready'  (snapshot)                    - first full status received
//   'volume' (channel, value 0-255)        - a channel volume changed
//   'mute'   (channel, [{state, func}])    - active mute entries for a channel changed
//   'disconnected'
export class GoXLRClient extends EventEmitter {
  constructor({ url, serial = null, logger }) {
    super();
    this.url = url;
    this.preferredSerial = serial;
    this.log = logger;
    this.ws = null;
    this.status = null;
    this.serial = null;
    this.lastSnapshot = null;
    this.nextId = 1;
    this.backoff = 1000;
    this.closed = false;
    this.pingTimer = null;
    this.wasConnected = false;
  }

  connect() {
    if (this.closed) return;
    this.log.debug(`[goxlr] Connecting to ${this.url}`);
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      return this.#retry(e.message);
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.backoff = 1000;
      this.wasConnected = true;
      this.log.ok('[goxlr] Connected to GoXLR Utility');
      this.#send('GetStatus');
      this.pingTimer = setInterval(() => this.#send('Ping'), 30000);
    });
    ws.addEventListener('message', (ev) => this.#onMessage(ev.data));
    ws.addEventListener('close', () => this.#onClose());
    ws.addEventListener('error', () => {}); // 'close' always follows
  }

  #send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ id: this.nextId++, data }));
    }
  }

  #command(command) {
    if (!this.serial) return false;
    this.#send({ Command: [this.serial, command] });
    return true;
  }

  setVolume(channel, volume) {
    return this.#command({ SetVolume: [channel, volume] });
  }

  setSubMixVolume(channel, volume) {
    return this.#command({ SetSubMixVolume: [channel, volume] });
  }

  // Writes where the stream actually listens: the submix volume when the
  // Broadcast Mix is assigned to Mix B, the main channel volume otherwise.
  setEffectiveVolume(channel, volume) {
    if (this.lastSnapshot?.submixActive && SUBMIX_CHANNELS.includes(channel)) {
      return this.setSubMixVolume(channel, volume);
    }
    return this.setVolume(channel, volume);
  }

  setFxEnabled(enabled) {
    return this.#command({ SetFXEnabled: !!enabled });
  }

  setActiveEffectPreset(preset) {
    return this.#command({ SetActiveEffectPreset: preset });
  }

  playSample(bank, button, index = 0) {
    return this.#command({ PlaySampleByIndex: [bank, button, index] });
  }

  stopSample(bank, button) {
    return this.#command({ StopSamplePlayback: [bank, button] });
  }

  #onClose() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.status) {
      this.log.warn('[goxlr] Disconnected from GoXLR Utility');
      this.emit('disconnected');
    } else if (!this.wasConnected) {
      this.log.debug('[goxlr] GoXLR Utility not reachable, retrying...');
    }
    this.status = null;
    this.serial = null;
    this.lastSnapshot = null;
    this.#retry();
  }

  #retry(msg) {
    if (this.closed) return;
    if (msg) this.log.debug(`[goxlr] ${msg}`);
    const d = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 10000);
    setTimeout(() => this.connect(), d);
  }

  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }
    const data = msg?.data;
    if (!data || typeof data !== 'object') return;

    if (data.Status) {
      this.status = data.Status;
      this.#afterUpdate();
    } else if (data.Patch) {
      if (!this.status) return;
      try {
        this.status = applyPatch(this.status, data.Patch);
      } catch (e) {
        this.log.debug(`[goxlr] Patch failed (${e.message}), requesting fresh status`);
        this.#send('GetStatus');
        return;
      }
      this.#afterUpdate();
    } else if (data.Error) {
      this.log.warn(`[goxlr] Daemon error: ${data.Error}`);
    }
  }

  #pickSerial() {
    const mixers = this.status?.mixers ?? {};
    if (this.preferredSerial && mixers[this.preferredSerial]) return this.preferredSerial;
    return Object.keys(mixers)[0] ?? null;
  }

  #afterUpdate() {
    const serial = this.#pickSerial();
    if (serial !== this.serial) {
      this.serial = serial;
      this.lastSnapshot = null;
      if (serial) {
        const type = this.status.mixers[serial]?.hardware?.device_type ?? 'GoXLR';
        this.log.ok(`[goxlr] Using device ${serial} (${type})`);
      } else {
        this.log.warn('[goxlr] No GoXLR device detected (is it plugged in?)');
      }
    }
    if (!serial) return;

    const snap = this.#snapshot(serial);
    const prev = this.lastSnapshot;
    this.lastSnapshot = snap;

    if (!prev) {
      this.emit('ready', snap);
      return;
    }

    if (prev.profileName !== snap.profileName) {
      this.log.info(`[goxlr] Profile loaded: ${snap.profileName}`);
      this.emit('profile', snap.profileName);
    }
    if (prev.submixActive !== snap.submixActive) {
      this.log.info(`[goxlr] Stream mix source: ${snap.submixActive ? 'Mix B (submix volumes)' : 'Mix A (main volumes)'}`);
      this.emit('submix', snap.submixActive);
    }
    for (const [ch, v] of Object.entries(snap.volumes)) {
      if (prev.volumes[ch] !== v) this.emit('volume', ch, v);
    }
    const channels = new Set([...Object.keys(snap.mutes), ...Object.keys(prev.mutes)]);
    for (const ch of channels) {
      const a = JSON.stringify(snap.mutes[ch] ?? []);
      const b = JSON.stringify(prev.mutes[ch] ?? []);
      if (a !== b) this.emit('mute', ch, snap.mutes[ch] ?? []);
    }
    if (JSON.stringify(snap.fx) !== JSON.stringify(prev.fx)) this.emit('fx', snap.fx);
    if (JSON.stringify(snap.sampler) !== JSON.stringify(prev.sampler)) this.emit('sampler', snap.sampler);
  }

  // snapshot = { volumes, mutes, submixActive }
  // volumes are EFFECTIVE stream volumes: when submixes are enabled and the
  // Broadcast Mix listens to Mix B, the submix volume replaces the main one.
  // mutes only contains ACTIVE entries (state !== 'Unmuted'); a missing key means unmuted.
  #snapshot(serial) {
    const m = this.status.mixers[serial];
    const levels = m?.levels ?? {};
    const submix = levels.submix ?? null;
    const submixActive = !!submix && submix.outputs?.BroadcastMix === 'B';

    const volumes = {};
    for (const [ch, v] of Object.entries(levels.volumes ?? {})) {
      const sub = submixActive && SUBMIX_CHANNELS.includes(ch) ? submix.inputs?.[ch]?.volume : undefined;
      volumes[ch] = typeof sub === 'number' ? sub : v;
    }

    const mutes = {};
    const add = (ch, state, func) => {
      if (!ch || !state || state === 'Unmuted') return;
      (mutes[ch] ??= []).push({ state, func });
    };
    for (const f of Object.values(m?.fader_status ?? {})) {
      if (f?.channel) add(f.channel, f.mute_state, f.mute_type);
    }
    const cough = m?.cough_button;
    if (cough) add('Mic', cough.state, cough.mute_type);

    // Voice FX (GoXLR Full only) and sampler pads that actually hold samples.
    const fxSrc = m?.effects;
    const fx = fxSrc
      ? { enabled: !!fxSrc.is_enabled, active: fxSrc.active_preset ?? null, names: { ...(fxSrc.preset_names ?? {}) } }
      : null;
    const sampler = {};
    for (const [bank, btns] of Object.entries(m?.sampler?.banks ?? {})) {
      for (const [btn, data] of Object.entries(btns ?? {})) {
        const count = data?.samples?.length ?? 0;
        if (!count) continue;
        (sampler[bank] ??= {})[btn] = {
          count,
          playing: !!data.is_playing,
          name: data.samples[0]?.name ?? `${bank}/${btn}`,
        };
      }
    }

    return { volumes, mutes, submixActive, profileName: m?.profile_name ?? null, fx, sampler };
  }

  get snapshotNow() {
    return this.lastSnapshot;
  }

  close() {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    try {
      this.ws?.close();
    } catch {}
  }
}
