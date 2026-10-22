// Small, engine-independent helpers for sequenced input and delayed rendering.
(function () {
  const MS = window.MS = window.MS || {};
  class Commands {
    constructor() { this.seq = 0; this.acked = 0; this.history = []; this.pending = []; }
    push(intent) {
      const command = { seq: ++this.seq, mx: intent.mx || 0, my: intent.my || 0,
        block: !!intent.block, attack: intent.attack || null };
      this.history.push(command); this.pending.push(command);
      if (this.history.length > 120) this.history.shift();
      if (this.pending.length > 120) this.pending.shift();
      return command;
    }
    acknowledge(seq) {
      this.acked = Math.max(this.acked, seq || 0);
      this.pending = this.pending.filter(c => c.seq > this.acked);
    }
  }
  const renderFields = ['id', 'lifeId', 'x', 'y', 'z', 'facing', 'state', 'fi', 'ft',
    'animName', 'attackName', 'flash', 'headless'];
  class Timeline {
    constructor(delay = 100) { this.delay = delay; this.clear(); }
    clear() { this.samples = []; this.cursor = null; this.last = null; }
    push(snapshot, now) {
      if (!Number.isFinite(snapshot.tick)) return;
      const last = this.samples[this.samples.length - 1];
      if (last && snapshot.tick <= last.tick) this.clear();
      this.samples.push({ tick: snapshot.tick, at: now, fighters: new Map(snapshot.fighters.map(f =>
        [f.id, Object.fromEntries(renderFields.map(k => [k, f[k]]))])) });
      if (this.samples.length > 32) this.samples.shift();
    }
    sample(id, now) {
      const newest = this.samples[this.samples.length - 1];
      if (!newest) return null;
      const desired = newest.tick + (now - newest.at - this.delay) * 0.06;
      if (this.cursor === null) this.cursor = desired;
      else {
        const dt = Math.max(0, now - this.last);
        this.cursor += dt * 0.06;
        // A gently disciplined render clock absorbs uneven packet arrivals.
        this.cursor += (desired - this.cursor) * (1 - Math.exp(-dt / 250));
      }
      this.last = now;
      this.cursor = Math.min(this.cursor, newest.tick); // no unbounded extrapolation
      let a = this.samples[0], b = a;
      for (const sample of this.samples) {
        b = sample;
        if (sample.tick >= this.cursor) break;
        a = sample;
      }
      const from = a.fighters.get(id), to = b.fighters.get(id);
      if (!from || !to) return null;
      const alpha = a.tick === b.tick ? 0 : Math.max(0, Math.min(1, (this.cursor - a.tick) / (b.tick - a.tick)));
      return { from, to, alpha, ticks: Math.max(0, this.cursor - a.tick) };
    }
  }
  MS.Sync = { Commands, Timeline };
})();
