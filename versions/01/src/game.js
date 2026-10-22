// Moonstone-style combat prototype: a single arena with a depth plane
// (walk up/down as well as left/right), light camera scroll, fixed 60Hz update.
(function () {
  const MS = window.MS, R = MS.Rig, F = MS.Font;
  const VW = 320, VH = 200;          // internal (Amiga-ish) resolution
  const WW = 576, WH = 228;          // arena size; a bit bigger than the screen
  const GTOP = 132, GBOT = 220;      // walkable ground band (feet y)
  const FAR_W = VW + Math.ceil((WW - VW) * 0.4), FAR_H = VH + 20;

  // ---------- canvases ----------
  const screen = document.getElementById('screen'), sctx = screen.getContext('2d');
  const buf = mk(VW, VH), ctx = buf.getContext('2d');
  let far, ground, gctx;
  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function resize() {
    const s = Math.max(1, Math.floor(Math.min(innerWidth / VW, (innerHeight - 70) / VH)));
    screen.width = VW * s; screen.height = VH * s;
    sctx.imageSmoothingEnabled = false;
  }
  addEventListener('resize', resize); resize();

  function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- input ----------
  const keys = new Set(), pressed = new Set();
  addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    SFX.unlock();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  const down = (...c) => c.some((k) => keys.has(k));
  const tapped = (...c) => c.some((k) => pressed.has(k));

  // Every fighter is driven by an "intent" — from the keyboard or from an AI brain.
  // Adding more players later just means more intent sources.
  function keyboardIntent() {
    return {
      mx: (down('ArrowRight', 'KeyD') ? 1 : 0) - (down('ArrowLeft', 'KeyA') ? 1 : 0),
      my: (down('ArrowDown', 'KeyS') ? 1 : 0) - (down('ArrowUp', 'KeyW') ? 1 : 0),
      attack: tapped('KeyJ', 'KeyZ') ? 'slash' : tapped('KeyK', 'KeyX') ? 'chop' : tapped('KeyL', 'KeyC') ? 'thrust' : null,
      block: down('ShiftLeft', 'ShiftRight', 'KeyI', 'KeyV'),
    };
  }

  // ---------- sound (tiny WebAudio synth) ----------
  const SFX = {
    ac: null, nb: null,
    unlock() {
      if (!this.ac) { try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
      if (this.ac.state === 'suspended') this.ac.resume();
    },
    noise(dur, f0, f1, vol, type) {
      const ac = this.ac; if (!ac) return;
      if (!this.nb) { this.nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = this.nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
      s.buffer = this.nb; f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(ac.destination); s.start(t); s.stop(t + dur);
    },
    tone(f0, f1, dur, vol, type) {
      const ac = this.ac; if (!ac) return;
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
    },
    swing() { this.noise(0.13, 700, 2600, 0.22, 'bandpass'); },
    hit() { this.noise(0.16, 500, 90, 0.5, 'lowpass'); this.tone(140, 45, 0.14, 0.35, 'square'); },
    clang() { this.tone(1500, 1350, 0.28, 0.12, 'square'); this.tone(2230, 2100, 0.22, 0.08, 'triangle'); this.noise(0.05, 4000, 3000, 0.2, 'highpass'); },
    straw() { this.noise(0.1, 2500, 1200, 0.3, 'highpass'); },
    die() { this.tone(220, 55, 0.7, 0.22, 'sawtooth'); },
  };

  // ---------- world bake ----------
  function bakeWorld() {
    const r = rng(7);
    far = mk(FAR_W, FAR_H); const f = far.getContext('2d');
    // Sky bands with dithered transitions.
    const sky = ['#0b0a1a', '#11102a', '#19163a', '#231d4b', '#30255a', '#3f2d68', '#4f3672'];
    const BH = 15;
    for (let y = 0; y < FAR_H; y++) {
      const b = Math.min(sky.length - 1, (y / BH) | 0), nb = Math.min(sky.length - 1, b + 1);
      f.fillStyle = sky[b]; f.fillRect(0, y, FAR_W, 1);
      if (y % BH >= BH - 4) { f.fillStyle = sky[nb]; for (let x = (y & 1); x < FAR_W; x += 2) f.fillRect(x, y, 1, 1); }
    }
    for (let i = 0; i < 70; i++) { f.fillStyle = r() < 0.3 ? '#fff' : '#9a90c8'; f.fillRect((r() * FAR_W) | 0, (r() * 75) | 0, 1, 1); }
    // Moon with a dithered halo.
    const mx = 300, my = 36;
    f.fillStyle = '#3a2f6c';
    for (let y = -19; y <= 19; y++) for (let x = -19; x <= 19; x++) { const d = x * x + y * y; if (d < 361 && d > 169 && ((x + y) & 1)) f.fillRect(mx + x, my + y, 1, 1); }
    R.disc(f, [mx, my], 12, '#ece6c4'); R.disc(f, [mx - 4, my - 3], 2.5, '#cdc6a4'); R.disc(f, [mx + 4, my + 4], 2, '#cdc6a4'); R.disc(f, [mx + 5, my - 5], 1, '#cdc6a4');
    const hill = (base, amp, fr, ph, col) => {
      const ys = [];
      for (let x = 0; x < FAR_W; x++) {
        const y = Math.round(base + Math.sin(x * fr + ph) * amp + Math.sin(x * fr * 2.7 + ph * 2) * amp * 0.35);
        ys.push(y); f.fillStyle = col; f.fillRect(x, y, 1, FAR_H - y);
      }
      return ys;
    };
    hill(92, 8, 0.013, 1, '#1d1636');
    const mid = hill(104, 6, 0.021, 4, '#151027');
    // Distant stone circle on the hill.
    f.fillStyle = '#0a0816';
    [[150, 9], [158, 10], [166, 8], [175, 10], [184, 9]].forEach(([x, h], i) => {
      const y = mid[x];
      f.fillRect(x, y - h, 3, h + 2);
      if (i % 2 === 0 && i < 4) f.fillRect(x - 1, y - h - 2, 12, 2);
    });
    hill(116, 4, 0.03, 2, '#0f0c1d');

    ground = mk(WW, WH); gctx = ground.getContext('2d'); const g = gctx;
    const EDGE = 118;
    // Back tree line.
    for (let i = 0; i < 46; i++) {
      const x = (r() * WW) | 0, h = 18 + ((r() * 26) | 0), base = EDGE + 3;
      g.fillStyle = r() < 0.5 ? '#0b140f' : '#0e1a13';
      for (let j = 0; j < h; j++) { const w = Math.max(1, Math.round(j * 0.42)); g.fillRect(x - (w >> 1), base - h + j, w, 1); }
    }
    for (let x = 0; x < WW; x += 3) R.disc(g, [x, EDGE + 1 + r() * 2], 3 + r() * 2, '#0d1811');
    // Grass with depth shading.
    const grass = ['#1c2e18', '#22381c', '#294220', '#2f4a24', '#344f27'];
    for (let y = EDGE; y < WH; y++) {
      const t = (y - EDGE) / (WH - EDGE), b = Math.min(grass.length - 1, (t * grass.length) | 0), nb = Math.min(grass.length - 1, b + 1);
      g.fillStyle = grass[b]; g.fillRect(0, y, WW, 1);
      if (((y - EDGE) % 22) > 17) { g.fillStyle = grass[nb]; for (let x = (y & 1); x < WW; x += 2) g.fillRect(x, y, 1, 1); }
    }
    for (let i = 0; i < 2600; i++) { g.fillStyle = r() < 0.5 ? '#1a2a15' : '#3e5c2d'; g.fillRect((r() * WW) | 0, EDGE + 2 + ((r() * (WH - EDGE)) | 0), 1, 1); }
    // Trampled earth where the fighting happens.
    const cx = WW / 2, cy = 178, rx = 220, ry = 40;
    for (let y = cy - ry - 4; y < cy + ry + 4; y++) for (let x = cx - rx - 8; x < cx + rx + 8; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + (r() - 0.5) * 0.25;
      if (d < 1) { g.fillStyle = d < 0.75 ? (r() < 0.1 ? '#3a2d1d' : '#4a3a27') : (r() < 0.5 ? '#3f3322' : '#33401f'); g.fillRect(x, y, 1, 1); }
    }
    for (let i = 0; i < 160; i++) {
      const x = (r() * WW) | 0, y = EDGE + 6 + ((r() * (WH - EDGE - 6)) | 0);
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1.05) continue;
      g.fillStyle = '#4a6a34'; g.fillRect(x, y - 1, 1, 1); g.fillRect(x + 2, y - 1, 1, 1); g.fillStyle = '#3e5c2d'; g.fillRect(x + 1, y - 2, 1, 2);
    }
    for (let i = 0; i < 12; i++) {
      const x = r() * WW, y = EDGE + 8 + r() * (WH - EDGE - 10), s = 1.5 + r() * 1.8;
      R.disc(g, [x, y], s + 1, '#151018'); R.disc(g, [x, y], s, '#5a5866'); g.fillStyle = '#7d7b8a'; g.fillRect(Math.round(x - 1), Math.round(y - s + 1), 1, 1);
    }
    // Two big standing stones at the back edge.
    [[46, 36], [520, 30]].forEach(([x, h]) => {
      const y = EDGE + 8;
      g.fillStyle = '#100c16'; g.fillRect(x - 1, y - h - 1, 13, h + 2); g.fillRect(x, y - h - 2, 11, 1);
      g.fillStyle = '#545262'; g.fillRect(x, y - h, 11, h); g.fillStyle = '#6c6a7c'; g.fillRect(x + 1, y - h, 3, h - 2);
      g.fillStyle = '#3e3c4a'; for (let j = 0; j < h; j += 3) g.fillRect(x + 8 + (j % 2), y - h + j, 1, 2);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - 2, y, 16, 2);
    });
  }

  // ---------- entities ----------
  class Fighter {
    constructor(kind, x, y, facing, o) {
      this.def = MS.CHARS[kind]; this.spec = this.def.spec; this.kind = kind;
      this.x = x; this.y = y; this.z = 0; this.vx = 0; this.facing = facing;
      this.hp = this.maxHp = this.def.hp; this.ghostHp = this.hp;
      this.name = o.name; this.team = o.team; this.brain = o.brain || null;
      this.state = 'idle'; this.timer = 0; this.hitstop = 0; this.flash = 0; this.fountain = 0;
      this.atk = null; this.hitList = new Set(); this.buffer = null; this.headless = false;
      this.play('idle', true);
    }
    play(name, force) {
      const a = this.def.anims[name];
      if (this.anim === a && !force) return;
      this.anim = a; this.fi = 0; this.ft = 0;
    }
    get pose() { return this.anim.frames[this.fi][0]; }
    tickAnim() {
      if (++this.ft < this.anim.frames[this.fi][1]) return null;
      this.ft = 0;
      if (this.fi < this.anim.frames.length - 1) { this.fi++; return 'next'; }
      if (this.anim.loop) { this.fi = 0; return 'next'; }
      return 'end';
    }
    startAttack(name) {
      const a = this.def.attacks[name]; if (!a) return;
      this.atk = a; this.anim = a; this.fi = 0; this.ft = 0; this.state = 'attack'; this.hitList.clear();
    }
    update(it) {
      it = it || {};
      // Buffer attack presses so combos feel responsive.
      if (it.attack) this.buffer = { name: it.attack, ttl: 10 };
      else if (this.buffer && --this.buffer.ttl <= 0) this.buffer = null;
      if (this.flash > 0) this.flash--;
      this.ghostHp += (this.hp - this.ghostHp) * 0.06;
      if (this.hitstop > 0) { this.hitstop--; return; }

      const st = this.state;
      if (st === 'dead') {
        this.tickAnim();
        if (this.fountain > 0) { this.fountain--; if (this.fountain % 2 === 0) neckSpurt(this); }
      } else if (st === 'hurt' || st === 'stagger' || st === 'blockstun') {
        this.tickAnim();
        if (--this.timer <= 0) { const blk = st === 'blockstun' && it.block; this.state = blk ? 'block' : 'idle'; this.play(this.state, true); }
      } else if (st === 'attack') {
        const r = this.tickAnim();
        if (r === 'next' && this.atk.step && this.fi === this.atk.step[0]) this.vx = this.facing * this.atk.step[1];
        if (r === 'next' && this.fi === this.atk.active[0]) SFX.swing();
        if (r === 'end') { this.state = 'idle'; this.atk = null; this.play('idle', true); }
      }

      if (this.state === 'idle' || this.state === 'walk' || this.state === 'block') {
        if (this.buffer) { this.startAttack(this.buffer.name); this.buffer = null; }
        else if (it.block) {
          if (it.mx) this.facing = it.mx > 0 ? 1 : -1;
          if (it.face) this.facing = it.face;
          if (this.state !== 'block') { this.state = 'block'; this.play('block'); }
        } else {
          const mx = it.mx || 0, my = it.my || 0, sp = this.def.speed;
          if (mx || my) {
            this.x += mx * sp[0]; this.y += my * sp[1];
            if (mx) this.facing = mx > 0 ? 1 : -1;
            if (this.state !== 'walk') { this.state = 'walk'; this.play('walk'); }
          } else if (this.state !== 'idle') { this.state = 'idle'; this.play('idle'); }
          if (it.face) this.facing = it.face;
          this.tickAnim();
        }
      }

      this.x += this.vx; this.vx *= 0.82; if (Math.abs(this.vx) < 0.05) this.vx = 0;
      this.x = clamp(this.x, 10, WW - 10); this.y = clamp(this.y, GTOP, GBOT);
    }
    // Joint positions of the current pose, in world space (z = height above feet).
    joint(name) {
      const S = R.solve(this.spec, this.spec.poses[this.pose], 0, 0);
      return { x: this.x + S[name][0] * this.facing, z: -S[name][1] };
    }
  }

  class Dummy {
    constructor(x, y) { this.x = x; this.y = y; this.z = 0; this.isDummy = true; this.team = 'none'; this.state = 'idle'; this.wobble = 0; this.flash = 0; this.hits = 0; this.dmg = 0; this.def = { hw: 6, h: 30 }; }
    update() { if (this.wobble > 0) this.wobble--; if (this.flash > 0) this.flash--; }
  }

  class TrollBrain {
    constructor() { this.cd = 50; this.blockT = 0; this.retreat = 0; this.reacted = false; }
    think(me, g) {
      const p = g.player, it = { mx: 0, my: 0, attack: null, block: false, face: 0 };
      if (!p || p.state === 'dead') return it;
      const dx = p.x - me.x, dy = p.y - me.y, adx = Math.abs(dx);
      it.face = dx > 0 ? 1 : -1;
      if (this.cd > 0) this.cd--;
      if (this.blockT > 0) { this.blockT--; it.block = true; return it; }
      // Sometimes read the player's wind-up and raise a guard.
      if (p.state === 'attack' && p.fi < p.atk.active[0] && adx < 50 && Math.abs(dy) < 10) {
        if (!this.reacted) { this.reacted = true; if (Math.random() < 0.35) { this.blockT = 26; it.block = true; return it; } }
      } else if (p.state !== 'attack') this.reacted = false;
      if (this.retreat > 0) { this.retreat--; it.mx = -it.face; return it; }
      const RANGE = 30;
      if (Math.abs(dy) > 3) it.my = Math.sign(dy);
      if (adx > RANGE + 6) it.mx = Math.sign(dx);
      else if (adx < RANGE - 10) it.mx = -Math.sign(dx);
      if (adx <= RANGE + 10 && Math.abs(dy) <= 5 && this.cd <= 0 && me.state !== 'attack') {
        it.attack = Math.random() < 0.6 ? 'swipe' : 'smash';
        this.cd = 60 + Math.random() * 70;
        if (Math.random() < 0.3) this.retreat = 30;
      }
      return it;
    }
  }

  // ---------- game state ----------
  const G = { fighters: [], particles: [], popups: [], cam: { x: 0, y: 0 }, shake: 0, debug: false, slow: false, kills: 0, respawn: 0 };

  function reset() {
    bakeWorld();
    G.particles = []; G.popups = []; G.kills = 0; G.respawn = 0;
    G.player = new Fighter('knight', 200, 182, 1, { name: 'Sir Knight', team: 'p' });
    G.dummy = new Dummy(130, 160);
    G.fighters = [G.player];
    spawnTroll(380);
    G.cam.x = clamp(G.player.x - VW / 2, 0, WW - VW); G.cam.y = WH - VH;
  }
  function spawnTroll(x) {
    const t = new Fighter('troll', x, rand(160, 200), -1, { name: 'Troll', team: 'e', brain: new TrollBrain() });
    G.fighters.push(t); G.enemy = t;
    // Keep at most two corpses lying around.
    const dead = G.fighters.filter((f) => f.state === 'dead' && f !== G.player);
    while (dead.length > 2) G.fighters.splice(G.fighters.indexOf(dead.shift()), 1);
  }

  // ---------- particles ----------
  const BLOOD = ['#a01010', '#7a0808', '#c82020'];
  function blood(x, y, z, dirx, n) {
    for (let i = 0; i < n; i++)
      G.particles.push({ kind: 'blood', x: x + rand(-2, 2), y: y + rand(-1.5, 1.5), z: z + rand(-3, 3), vx: dirx * rand(0.3, 2.2), vy: rand(-0.3, 0.3), vz: rand(0, 2.4), c: pick(BLOOD), life: 240 });
  }
  function sparks(x, y, z) {
    for (let i = 0; i < 12; i++) G.particles.push({ kind: 'spark', x, y, z, vx: rand(-2, 2), vy: 0, vz: rand(0.5, 3), c: pick(['#fff6a0', '#ffd040', '#ffffff']), life: 18 });
  }
  function straw(x, y, z, dirx) {
    for (let i = 0; i < 10; i++) G.particles.push({ kind: 'straw', x, y: y + rand(-1, 1), z: z + rand(-4, 4), vx: dirx * rand(0.2, 1.6), vy: 0, vz: rand(0.3, 2), c: pick(['#d8b848', '#b89030', '#e8d070']), life: 200 });
  }
  function neckSpurt(f) {
    const n = f.joint('neck');
    for (let i = 0; i < 2; i++) G.particles.push({ kind: 'blood', x: n.x, y: f.y + rand(-1, 1), z: n.z, vx: -f.facing * rand(-0.4, 1.2), vy: rand(-0.2, 0.2), vz: rand(1.2, 2.8), c: pick(BLOOD), life: 240 });
  }
  function popup(e, text, c) { G.popups.push({ x: e.x, y: e.y, z: (e.def.h || 30) + 6, text: String(text), c, life: 45 }); }

  function updateParticles() {
    const keep = [];
    for (const p of G.particles) {
      p.life--;
      if (p.kind === 'head') {
        p.vz -= 0.18; p.x += p.vx; p.z += p.vz; p.spin += p.vx * 8;
        if (p.z <= 0) { p.z = 0; if (Math.abs(p.vz) > 0.8) { p.vz = -p.vz * 0.4; p.vx *= 0.6; } else { p.vz = 0; p.vx *= 0.8; } }
        if (p.z > 1 && p.life % 3 === 0) blood(p.x, p.y, p.z, 0, 1);
        keep.push(p); continue;
      }
      p.vz -= 0.15; p.x += p.vx; p.y += p.vy; p.z += p.vz;
      if (p.z <= 0) {
        if (p.kind === 'blood' || (p.kind === 'straw' && Math.random() < 0.4)) {
          gctx.fillStyle = p.kind === 'blood' ? pick(['#6a0a0a', '#7e0c0c', '#560707']) : p.c;
          gctx.fillRect(Math.round(p.x), Math.round(p.y), Math.random() < 0.3 ? 2 : 1, 1);
        }
        continue;
      }
      if (p.life > 0) keep.push(p);
    }
    // Cap severed heads lying around.
    const heads = keep.filter((p) => p.kind === 'head');
    G.particles = heads.length > 6 ? keep.filter((p) => p !== heads[0]) : keep;
    G.popups = G.popups.filter((p) => (p.z += 0.35, --p.life > 0));
  }

  // ---------- combat ----------
  function hurtbox(e) { return { x0: e.x - e.def.hw, x1: e.x + e.def.hw }; }
  function attackBox(a) {
    const k = a.atk;
    return a.facing > 0 ? { x0: a.x + k.reach[0], x1: a.x + k.reach[1] } : { x0: a.x - k.reach[1], x1: a.x - k.reach[0] };
  }

  function resolveHits() {
    const targets = [...G.fighters, G.dummy];
    for (const a of G.fighters) {
      if (a.state !== 'attack' || a.fi < a.atk.active[0] || a.fi > a.atk.active[1]) continue;
      const box = attackBox(a);
      for (const t of targets) {
        if (t === a || t.team === a.team || t.state === 'dead' || a.hitList.has(t)) continue;
        if (Math.abs(t.y - a.y) > a.atk.depth) continue;
        const hb = hurtbox(t);
        if (box.x1 < hb.x0 || box.x0 > hb.x1) continue;
        a.hitList.add(t);
        applyHit(a, t, a.atk);
      }
    }
  }

  function applyHit(a, t, atk) {
    const dirx = a.facing;
    G.shake = Math.max(G.shake, atk.shake);
    if (t.isDummy) {
      t.wobble = 20; t.flash = 4; t.hits++; t.dmg += atk.dmg; a.hitstop = atk.stop;
      straw(t.x, t.y, 18, dirx); popup(t, atk.dmg, '#f0e0a0'); SFX.straw(); SFX.hit();
      return;
    }
    const facingAttacker = t.facing === (a.x > t.x ? 1 : -1);
    if (t.state === 'block' && facingAttacker) {
      const s = t.joint('hand');
      sparks(s.x + t.facing * 4, t.y, s.z); SFX.clang();
      a.hitstop = t.hitstop = 4;
      if (atk.guardBreak) { t.state = 'stagger'; t.timer = 34; t.play('stagger', true); t.vx = dirx * atk.kb; popup(t, 'BREAK', '#ffd040'); }
      else { t.state = 'blockstun'; t.timer = 12; t.vx = dirx * atk.kb * 0.7; a.vx = -dirx * 1.2; popup(t, 'BLOCK', '#a0c0ff'); }
      return;
    }
    t.hp = Math.max(0, t.hp - atk.dmg); t.flash = 6;
    a.hitstop = t.hitstop = atk.stop;
    t.vx = dirx * atk.kb;
    const chest = t.joint('sh');
    blood(chest.x, t.y, chest.z - 2, dirx, 8 + atk.dmg);
    popup(t, atk.dmg, '#ff6050'); SFX.hit();
    if (t.hp <= 0) kill(t, a, atk);
    else { t.state = 'hurt'; t.timer = Math.round(atk.stun * t.def.stunMul); t.atk = null; t.play('hurt', true); }
  }

  function kill(t, a, atk) {
    const dirx = a.facing;
    const head = t.joint('head');
    t.state = 'dead'; t.atk = null; t.facing = -dirx; t.play('die', true); SFX.die();
    if (atk.decap && Math.random() < atk.decap) {
      t.headless = true; t.fountain = 60;
      G.particles.push({ kind: 'head', sprite: R.headSprite(t.spec), x: head.x, y: t.y + rand(-2, 2), z: head.z, vx: dirx * rand(1, 2.2), vz: rand(2.2, 3.4), spin: 0, flip: t.facing, life: 1e9 });
      blood(head.x, t.y, head.z, dirx, 20);
    }
    if (t === G.enemy) { G.kills++; G.respawn = 160; }
  }

  // Simple push-apart so bodies don't overlap.
  function separate() {
    const list = [...G.fighters.filter((f) => f.state !== 'dead'), G.dummy];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (Math.abs(a.y - b.y) > 6) continue;
      const min = (a.def.hw + b.def.hw) * 0.8, dx = b.x - a.x;
      if (Math.abs(dx) >= min) continue;
      const push = (min - Math.abs(dx)) * (dx >= 0 ? 1 : -1);
      if (a.isDummy) b.x += push; else if (b.isDummy) a.x -= push; else { a.x -= push / 2; b.x += push / 2; }
    }
  }

  // ---------- update ----------
  function update() {
    if (tapped('KeyB')) G.debug = !G.debug;
    if (tapped('KeyT')) G.slow = !G.slow;
    if (tapped('KeyR')) reset();
    if (tapped('KeyP')) exportSheets();

    for (const f of G.fighters) {
      let it = null;
      if (f === G.player) it = keyboardIntent();
      else if (f.brain && f.state !== 'dead') it = f.brain.think(f, G);
      f.update(it);
    }
    separate();
    resolveHits();
    G.dummy.update();
    updateParticles();

    if (G.respawn > 0 && --G.respawn === 0) spawnTroll(G.player.x < WW / 2 ? WW - 12 : 12);

    const p = G.player;
    const tx = clamp(p.x - VW / 2 + p.facing * 24, 0, WW - VW), ty = clamp(p.y - 150, 0, WH - VH);
    G.cam.x += (tx - G.cam.x) * 0.08; G.cam.y += (ty - G.cam.y) * 0.08;
    G.shake *= 0.85; if (G.shake < 0.3) G.shake = 0;
    pressed.clear();
  }

  // ---------- render ----------
  function drawDummy(d, sx, sy) {
    const O = '#140f1c', lean = d.wobble > 0 ? Math.sin(d.wobble * 0.7) * (d.wobble / 20) * 4 : 0;
    const top = [sx + lean, sy - 30], mid = [sx + lean * 0.7, sy - 22], sack = [sx + lean * 0.8, sy - 16];
    const wood = d.flash ? '#fff' : '#7a5a30', strawC = d.flash ? '#fff' : '#c8a050';
    R.line(ctx, [sx - 5, sy], [sx + 5, sy], 4, O); R.line(ctx, [sx - 5, sy], [sx + 5, sy], 2, wood);
    R.line(ctx, [sx, sy], top, 4, O); R.line(ctx, [sx, sy], top, 2, wood);
    R.line(ctx, [mid[0] - 8, mid[1]], [mid[0] + 8, mid[1]], 4, O); R.line(ctx, [mid[0] - 8, mid[1]], [mid[0] + 8, mid[1]], 2, wood);
    R.disc(ctx, sack, 6, O); R.disc(ctx, sack, 5, strawC);
    R.disc(ctx, top, 4.5, O); R.disc(ctx, top, 3.5, strawC);
    ctx.fillStyle = O; ctx.fillRect(Math.round(top[0]) - 1, Math.round(top[1]) - 1, 1, 1); ctx.fillRect(Math.round(top[0]) + 1, Math.round(top[1]) - 1, 1, 1);
  }

  function shadow(x, y, w) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(Math.round(x - w / 2) + 1, Math.round(y) - 1, w - 2, 1);
    ctx.fillRect(Math.round(x - w / 2), Math.round(y), w, 1);
    ctx.fillRect(Math.round(x - w / 2) + 1, Math.round(y) + 1, w - 2, 1);
  }

  function bar(x, y, w, f, ghost, col) {
    ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = '#3a0c10'; ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = '#e8d48a'; ctx.fillRect(x, y, Math.round(w * ghost), 4);
    ctx.fillStyle = col; ctx.fillRect(x, y, Math.round(w * f), 4);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x, y, Math.round(w * f), 1);
  }

  function render() {
    const sx0 = G.shake ? rand(-G.shake, G.shake) : 0, sy0 = G.shake ? rand(-G.shake, G.shake) : 0;
    const cx = Math.round(G.cam.x + sx0), cy = Math.round(G.cam.y + sy0);
    ctx.drawImage(far, -Math.round(G.cam.x * 0.4), -Math.round(G.cam.y * 0.5));
    ctx.drawImage(ground, -cx, -cy);

    const things = [...G.fighters, G.dummy, ...G.particles.filter((p) => p.kind === 'head')];
    for (const e of things) {
      const w = e.kind === 'head' ? 6 : e.state === 'dead' ? e.def.h : e.def.hw * 2 + 6;
      shadow(e.x - cx - (e.state === 'dead' ? e.facing * w / 2 - e.facing * 3 : 0), e.y - cy, w);
    }
    things.sort((a, b) => a.y - b.y);
    for (const e of things) {
      const sx = Math.round(e.x - cx), sy = Math.round(e.y - cy - e.z);
      if (e.isDummy) { drawDummy(e, sx, sy); continue; }
      if (e.kind === 'head') {
        const s = e.sprite, q = Math.round(e.spin / 90) * 90;
        ctx.save(); ctx.translate(sx, sy - s.height / 2 + 2); ctx.rotate(q * Math.PI / 180); ctx.scale(e.flip, 1);
        ctx.drawImage(s, -s.width / 2, -s.height / 2); ctx.restore();
        continue;
      }
      const variant = (e.headless ? 'nohead' : '') + (e.flash > 0 && e.flash % 2 === 0 ? '+flash' : '');
      const img = R.frame(e.spec, e.pose, variant);
      ctx.save(); ctx.translate(sx, sy); ctx.scale(e.facing, 1);
      ctx.drawImage(img, -e.spec.anchorX, -e.spec.anchorY); ctx.restore();
    }

    for (const p of G.particles) {
      if (p.kind === 'head') continue;
      ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x - cx), Math.round(p.y - cy - p.z), 1, p.kind === 'blood' && p.vz < -1 ? 2 : 1);
    }
    for (const p of G.popups) F.draw(ctx, p.text, Math.round(p.x - cx - F.width(p.text) / 2), Math.round(p.y - cy - p.z), p.c, '#000');

    if (G.debug) drawDebug(cx, cy);
    drawHud();
    sctx.drawImage(buf, 0, 0, screen.width, screen.height);
  }

  function drawDebug(cx, cy) {
    for (const e of [...G.fighters, G.dummy]) {
      const hb = hurtbox(e);
      ctx.strokeStyle = e.state === 'dead' ? '#555' : '#40ff80';
      ctx.strokeRect(Math.round(hb.x0 - cx) + 0.5, Math.round(e.y - cy - e.def.h) + 0.5, hb.x1 - hb.x0, e.def.h);
      ctx.fillStyle = '#40ff80'; ctx.fillRect(Math.round(e.x - cx), Math.round(e.y - cy), 1, 1);
      if (e.state === 'attack') {
        const k = e.atk, box = attackBox(e), live = e.fi >= k.active[0] && e.fi <= k.active[1];
        ctx.strokeStyle = live ? '#ff3030' : '#806020';
        ctx.strokeRect(Math.round(box.x0 - cx) + 0.5, Math.round(e.y - cy + k.height[0]) + 0.5, box.x1 - box.x0, k.height[1] - k.height[0]);
        ctx.fillStyle = live ? 'rgba(255,48,48,0.35)' : 'rgba(128,96,32,0.3)';
        ctx.fillRect(Math.round(box.x0 - cx), Math.round(e.y - cy - k.depth), box.x1 - box.x0, k.depth * 2 + 1);
      }
      if (!e.isDummy) F.draw(ctx, e.state, Math.round(e.x - cx - F.width(e.state) / 2), Math.round(e.y - cy + 3), '#40ff80', '#000');
    }
  }

  function drawHud() {
    const p = G.player, e = G.enemy;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, VW, 17);
    F.draw(ctx, p.name, 6, 3, '#e8d48a', '#000');
    bar(6, 10, 90, p.hp / p.maxHp, p.ghostHp / p.maxHp, '#c83030');
    if (e) {
      const label = e.state === 'dead' ? 'Troll - slain' : e.name;
      F.draw(ctx, label, VW - 6 - F.width(label), 3, '#9ad070', '#000');
      bar(VW - 96, 10, 90, e.hp / e.maxHp, e.ghostHp / e.maxHp, '#6aa040');
    }
    const k = 'Slain ' + G.kills;
    F.draw(ctx, k, VW / 2 - F.width(k) / 2, 3, '#c0b8e0', '#000');
    const dm = 'Dummy ' + G.dummy.hits + ' hits';
    F.draw(ctx, dm, VW / 2 - F.width(dm) / 2, 10, '#807898', '#000');
    let y = VH - 8;
    if (G.slow) { F.draw(ctx, 'Slow-mo', 4, y, '#ffd040', '#000'); y -= 7; }
    if (G.debug) F.draw(ctx, 'Hitboxes', 4, y, '#40ff80', '#000');
    if (G.respawn > 0 && G.respawn < 100) { const s = 'Another approaches...'; F.draw(ctx, s, VW / 2 - F.width(s) / 2, 26, '#9ad070', '#000'); }
    if (p.state === 'dead') {
      const s1 = 'You have fallen', s2 = 'Press R';
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 84, VW, 26);
      F.draw(ctx, s1, VW / 2 - F.width(s1) / 2, 90, '#ff6050', '#000');
      F.draw(ctx, s2, VW / 2 - F.width(s2) / 2, 99, '#c0b8e0', '#000');
    }
  }

  function exportSheets() {
    for (const k of ['knight', 'troll']) {
      const a = document.createElement('a');
      a.download = k + '_sheet.png'; a.href = R.sheet(MS.CHARS[k].spec).toDataURL('image/png'); a.click();
    }
  }

  // ---------- loop ----------
  reset();
  const STEP = 1000 / 60;
  let last = performance.now(), acc = 0;
  function loop(now) {
    acc += Math.min(100, now - last); last = now;
    const step = G.slow ? STEP * 4 : STEP;
    while (acc >= step) { update(); acc -= step; }
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.GAME = G; // handy for poking at state from the console
  // Test hook: advance n fixed ticks synchronously, then draw.
  G.step = (n) => { for (let i = 0; i < n; i++) update(); render(); };
})();
