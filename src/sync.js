function buildMaps(mappings) {
  const byChannel = new Map();
  const bySource = new Map();
  for (const m of mappings) {
    const entry = {
      channel: m.channel,
      source: m.source,
      syncVolume: m.syncVolume !== false,
      syncMute: m.syncMute !== false,
    };
    const chArr = byChannel.get(m.channel) ?? [];
    chArr.push(entry);
    byChannel.set(m.channel, chArr);
    const srcArr = bySource.get(m.source) ?? [];
    srcArr.push(entry);
    bySource.set(m.source, srcArr);
  }
  return { byChannel, bySource };
}

// Maps GoXLR channel events to Streamlabs audio source updates, and (when
// twoWay is enabled) Streamlabs slider moves back to the GoXLR motorized
// faders. Echo suppression keeps the two sides from fighting each other.
export class SyncEngine {
  constructor({ goxlr, slobs, config, logger, dryRun = false }) {
    this.goxlr = goxlr;
    this.slobs = slobs;
    this.cfg = config.sync;
    this.log = logger;
    this.dryRun = dryRun;

    const maps = buildMaps(this.cfg.mappings);
    this.byChannel = maps.byChannel;
    this.bySource = maps.bySource;

    this.resourceIds = new Map(); // source name -> resourceId | null
    this.sourceIdToName = new Map(); // Streamlabs sourceId -> source name
    this.slobsMuted = new Map(); // source name -> bool (live truth from Streamlabs)
    this.throttles = new Map(); // source name -> { timer, lastSent, pendingV } (forward)
    this.reverseThrottles = new Map(); // channel -> { timer, lastSent, pendingV } (reverse)
    this.lastSentToSlobs = new Map(); // source -> { d, ts } (forward echo check)
    this.suppressForwardUntil = new Map(); // channel -> timestamp (reverse echo window)
    this.lastResolve = 0;
    this.resolving = null;

    goxlr.on('ready', () => this.pushFullState());
    goxlr.on('volume', (ch, v) => this.onVolume(ch, v));
    goxlr.on('mute', (ch, list) => this.onMute(ch, list));
    slobs.on('connected', async () => {
      await this.resolveSources(true);
      try {
        await this.slobs.subscribeAudioUpdates();
        this.log.debug('[sync] Subscribed to Streamlabs audio updates');
      } catch (e) {
        this.log.warn(`[sync] Could not subscribe to Streamlabs audio updates: ${e.message} (two-way sync disabled for this session)`);
      }
      this.pushFullState();
    });
    slobs.on('apiEvent', (rid, data) => {
      if (rid === 'AudioService.audioSourceUpdated') this.onSlobsAudio(data);
    });
  }

  get twoWay() {
    return this.cfg.twoWay !== false;
  }

  // Hot-applies settings edited from the dashboard (no restart needed).
  async applySettings({ mappings, muteMode, twoWay } = {}) {
    if (Array.isArray(mappings)) {
      this.cfg.mappings = mappings;
      const maps = buildMaps(mappings);
      this.byChannel = maps.byChannel;
      this.bySource = maps.bySource;
      this.resourceIds.clear();
    }
    if (muteMode) this.cfg.muteMode = muteMode;
    if (typeof twoWay === 'boolean') this.cfg.twoWay = twoWay;
    this.lastResolve = 0;
    await this.resolveSources(true);
    this.pushFullState();
  }

  deflection(v) {
    const x = Math.max(0, Math.min(255, v)) / 255;
    return Math.round(Math.pow(x, this.cfg.curveExponent) * 10000) / 10000;
  }

  goxlrVolume(deflection) {
    const d = Math.max(0, Math.min(1, deflection));
    return Math.max(0, Math.min(255, Math.round(255 * Math.pow(d, 1 / this.cfg.curveExponent))));
  }

  // Does this mute entry affect what the stream hears?
  affectsStream(m) {
    return m.state === 'MutedToAll' || (m.state === 'MutedToX' && (m.func === 'All' || m.func === 'ToStream'));
  }

  isMuted(list) {
    if (!list?.length) return false;
    if (this.cfg.muteMode === 'off') return false;
    if (this.cfg.muteMode === 'any') return true;
    return list.some((m) => this.affectsStream(m)); // 'follow_stream'
  }

  async resolveSources(force = false) {
    if (!this.slobs.connected) return;
    if (this.resolving) return this.resolving;
    const now = Date.now();
    if (!force && now - this.lastResolve < 5000) return;
    this.lastResolve = now;

    this.resolving = (async () => {
      try {
        const sources = await this.slobs.getAudioSources();
        const byName = new Map(sources.map((s) => [s.name, s.resourceId]));
        this.sourceIdToName = new Map(sources.map((s) => [s.sourceId, s.name]));
        for (const s of sources) this.slobsMuted.set(s.name, !!s.muted);
        const wanted = new Set(this.cfg.mappings.map((m) => m.source));
        let okCount = 0;
        for (const name of wanted) {
          const rid = byName.get(name) ?? null;
          this.resourceIds.set(name, rid);
          if (rid) okCount++;
        }
        const missing = [...wanted].filter((n) => !this.resourceIds.get(n));
        if (missing.length) {
          this.log.warn(`[sync] Sources not found in Streamlabs: ${missing.map((s) => `"${s}"`).join(', ')}`);
          this.log.warn(`[sync] Available audio sources: ${sources.map((s) => `"${s.name}"`).join(', ') || '(none)'}`);
        }
        if (okCount) this.log.ok(`[sync] Resolved ${okCount}/${wanted.size} mapped source(s)`);
      } catch (e) {
        this.log.warn(`[sync] Could not list Streamlabs sources: ${e.message}`);
      } finally {
        this.resolving = null;
      }
    })();
    return this.resolving;
  }

  pushFullState() {
    const snap = this.goxlr.snapshotNow;
    if (!snap || !this.slobs.connected || this.cfg.syncOnConnect === false) return;
    this.log.info('[sync] Pushing current GoXLR state to Streamlabs');
    for (const [ch, maps] of this.byChannel) {
      if (ch in snap.volumes) {
        for (const m of maps) if (m.syncVolume) this.#queueVolume(m.source, snap.volumes[ch]);
      }
      const list = snap.mutes[ch] ?? [];
      for (const m of maps) {
        if (m.syncMute && this.cfg.muteMode !== 'off') this.#sendMute(m.source, this.isMuted(list));
      }
    }
  }

  // ---- Forward path: GoXLR -> Streamlabs ----------------------------------

  onVolume(ch, v) {
    const maps = this.byChannel.get(ch);
    if (!maps) return;
    if ((this.suppressForwardUntil.get(ch) ?? 0) > Date.now()) {
      this.log.debug(`[sync] ${ch} volume -> ${v} (echo of a reverse write, ignored)`);
      return;
    }
    this.log.debug(`[sync] ${ch} volume -> ${v}`);
    for (const m of maps) if (m.syncVolume) this.#queueVolume(m.source, v);
  }

  onMute(ch, list) {
    const maps = this.byChannel.get(ch);
    if (!maps) return;
    const muted = this.isMuted(list);
    this.log.info(`[sync] GoXLR ${ch} is now ${muted ? 'MUTED' : 'unmuted'} (for the stream)`);
    for (const m of maps) {
      if (m.syncMute && this.cfg.muteMode !== 'off') this.#sendMute(m.source, muted);
    }
  }

  // Trailing-edge throttle so fader sweeps don't flood Streamlabs.
  #queueVolume(source, rawV) {
    const t = this.throttles.get(source) ?? { timer: null, lastSent: 0, pendingV: null };
    this.throttles.set(source, t);
    t.pendingV = rawV;
    const fire = () => {
      t.timer = null;
      if (t.pendingV == null) return;
      const v = t.pendingV;
      t.pendingV = null;
      t.lastSent = Date.now();
      this.#sendVolume(source, v);
    };
    if (t.timer) return;
    const wait = Math.max(0, (this.cfg.throttleMs ?? 50) - (Date.now() - t.lastSent));
    if (wait === 0) fire();
    else t.timer = setTimeout(fire, wait);
  }

  async #sendVolume(source, rawV) {
    const d = this.deflection(rawV);
    if (this.dryRun) return this.log.info(`[dry-run] setDeflection("${source}", ${d})`);
    const rid = await this.#rid(source);
    if (!rid) return;
    this.lastSentToSlobs.set(source, { d, ts: Date.now() });
    try {
      await this.slobs.setDeflection(rid, d);
      this.log.debug(`[sync] "${source}" deflection=${d}`);
    } catch (e) {
      this.log.warn(`[sync] setDeflection failed for "${source}": ${e.message}`);
      this.resourceIds.set(source, null);
      this.resolveSources();
    }
  }

  async #sendMute(source, muted) {
    if (this.dryRun) return this.log.info(`[dry-run] setMuted("${source}", ${muted})`);
    const rid = await this.#rid(source);
    if (!rid) return;
    this.slobsMuted.set(source, muted);
    try {
      await this.slobs.setMuted(rid, muted);
      this.log.info(`[sync] "${source}" ${muted ? 'muted' : 'unmuted'} in Streamlabs`);
    } catch (e) {
      this.log.warn(`[sync] setMuted failed for "${source}": ${e.message}`);
      this.resourceIds.set(source, null);
      this.resolveSources();
    }
  }

  async #rid(source) {
    let rid = this.resourceIds.get(source);
    if (!rid) {
      await this.resolveSources();
      rid = this.resourceIds.get(source);
    }
    if (!rid) this.log.debug(`[sync] Skipping "${source}" (not found in Streamlabs)`);
    return rid;
  }

  // ---- Reverse path: Streamlabs -> GoXLR (motorized faders) ---------------

  onSlobsAudio(model) {
    // audioSourceUpdated events carry sourceId but no name.
    const name = model?.name ?? (model?.sourceId ? this.sourceIdToName.get(model.sourceId) : null);
    if (!name) {
      if (model?.sourceId) this.resolveSources(); // unknown source: refresh the maps (cooldown inside)
      return;
    }
    if (typeof model.muted === 'boolean') this.slobsMuted.set(name, model.muted);

    const maps = this.bySource.get(name);
    if (!maps || !this.twoWay) return;
    const d = model.fader?.deflection;
    if (typeof d !== 'number') return;

    // Ignore echoes of our own forward writes. The value tolerance is wide
    // enough (1% ~ 2.5 steps) to absorb Streamlabs' 0.5 dB slider
    // quantization without nudging the hardware back.
    const last = this.lastSentToSlobs.get(name);
    if (last && (Math.abs(last.d - d) < 0.01 || Date.now() - last.ts < 1200)) return;

    const v = this.goxlrVolume(d);
    for (const m of maps) {
      if (!m.syncVolume) continue;
      const current = this.goxlr.snapshotNow?.volumes?.[m.channel];
      if (typeof current === 'number' && Math.abs(current - v) <= 2) continue;
      this.#queueReverse(m.channel, v);
    }
  }

  #queueReverse(channel, v) {
    const t = this.reverseThrottles.get(channel) ?? { timer: null, lastSent: 0, pendingV: null };
    this.reverseThrottles.set(channel, t);
    t.pendingV = v;
    const fire = () => {
      t.timer = null;
      if (t.pendingV == null) return;
      const value = t.pendingV;
      t.pendingV = null;
      t.lastSent = Date.now();
      this.#sendReverse(channel, value);
    };
    if (t.timer) return;
    const wait = Math.max(0, (this.cfg.throttleMs ?? 50) - (Date.now() - t.lastSent));
    if (wait === 0) fire();
    else t.timer = setTimeout(fire, wait);
  }

  #sendReverse(channel, v) {
    if (this.dryRun) return this.log.info(`[dry-run] GoXLR SetVolume(${channel}, ${v})`);
    this.suppressForwardUntil.set(channel, Date.now() + 600);
    if (this.goxlr.setEffectiveVolume(channel, v)) {
      this.log.info(`[sync] Streamlabs slider moved: GoXLR ${channel} -> ${v}`);
    }
  }

  // ---- Dashboard actions ---------------------------------------------------

  // Mutes/unmutes the Streamlabs source(s) mapped to a channel. Works for
  // every channel, including those without a physical fader.
  async setSourcesMuted(channel, muted) {
    const maps = this.byChannel.get(channel);
    if (!maps) throw new Error(`no mapping for channel ${channel}`);
    for (const m of maps) {
      await this.#sendMute(m.source, muted);
    }
  }

  // Live mute state of the sources mapped to a channel (Streamlabs truth).
  channelSourcesMuted(maps) {
    return maps.some((m) => this.slobsMuted.get(m.source) === true);
  }
}
