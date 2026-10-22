// Moonstone-style combat prototype: a single arena with a depth plane
// (walk up/down as well as left/right), light camera scroll, fixed 60Hz update.
(function () {
  const MS = window.MS, R = MS.Rig, F = MS.Font, N = MS.Net;
  let replaying = false;
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
    const s = Math.max(1, Math.floor(Math.min(innerWidth / VW, (innerHeight - 190) / VH)));
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
      this.lifeId = crypto.randomUUID(); this.inputSeq = 0;
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
        if (this.fountain > 0) { this.fountain--; if (this.fountain % 2 === 0 && !replaying) neckSpurt(this); }
      } else if (st === 'hurt' || st === 'stagger' || st === 'blockstun') {
        this.tickAnim();
        if (--this.timer <= 0) { const blk = st === 'blockstun' && it.block; this.state = blk ? 'block' : 'idle'; this.play(this.state, true); }
      } else if (st === 'attack') {
        const r = this.tickAnim();
        if (r === 'next' && this.atk.step && this.fi === this.atk.step[0]) this.vx = this.facing * this.atk.step[1];
        if (r === 'next' && this.fi === this.atk.active[0] && !replaying) SFX.swing();
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
    constructor(x, y) { this.x = x; this.y = y; this.z = 0; this.isDummy = true; this.team = 'none'; this.state = 'idle'; this.wobble = 0; this.flash = 0; this.hits = 0; this.dmg = 0; this.events = []; this.def = { hw: 6, h: 30 }; }
    update() { if (this.wobble > 0) this.wobble--; if (this.flash > 0) this.flash--; }
  }

  function nearestKnight(me, g) {
    let target = null, best = Infinity;
    for (const fighter of g.fighters) {
      if (fighter.team !== 'p' || fighter.state === 'dead') continue;
      const distance = Math.hypot(fighter.x - me.x, (fighter.y - me.y) * 2);
      if (distance < best) { best = distance; target = fighter; }
    }
    return target;
  }
  const enemyIntent = () => ({ mx: 0, my: 0, attack: null, block: false, face: 0 });
  const canAct = me => ['idle', 'walk', 'block'].includes(me.state) && me.hitstop <= 0;
  class TrollBrain {
    constructor() { this.cd = 50; this.blockT = 0; this.retreat = 0; this.reacted = false; }
    think(me, g) {
      const p = nearestKnight(me, g), it = enemyIntent();
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

  class OgreBrain {
    constructor() { this.cd = 65; }
    think(me, g) {
      const p = nearestKnight(me, g), it = enemyIntent();
      if (!p) return it;
      if (this.cd > 0) this.cd--;
      const dx = p.x - me.x, dy = p.y - me.y, distance = Math.abs(dx);
      it.face = dx >= 0 ? 1 : -1;
      if (Math.abs(dy) > 3) it.my = Math.sign(dy);
      if (distance > 35) it.mx = Math.sign(dx);
      else if (distance < 23) it.mx = -Math.sign(dx);
      if (distance <= 43 && Math.abs(dy) <= 7 && this.cd <= 0 && canAct(me)) {
        it.attack = Math.random() < 0.65 ? 'punch' : 'slam';
        this.cd = 115 + Math.floor(Math.random() * 35);
      }
      return it;
    }
  }

  class GremlinBrain {
    constructor() { this.phase = 'approach'; this.remaining = 0; this.retreatTicks = 0; }
    retreat() {
      this.phase = 'retreat'; this.remaining = 0;
      this.retreatTicks = 48 + Math.floor(Math.random() * 13);
    }
    think(me, g) {
      const p = nearestKnight(me, g), it = enemyIntent();
      if (!p) return it;
      const dx = p.x - me.x, dy = p.y - me.y, distance = Math.abs(dx);
      it.face = dx >= 0 ? 1 : -1;
      // A swipe already in flight must finish before retreating or queuing more.
      if (me.state === 'attack' || me.hitstop > 0) return it;
      if (!canAct(me)) {
        if (this.phase === 'burst') this.retreat(); // being interrupted breaks the combo
        return it;
      }
      if (this.phase === 'burst' && (this.remaining <= 0 || distance > 29 || Math.abs(dy) > 9)) this.retreat();
      if (this.phase === 'retreat') {
        if (distance < 95) {
          it.mx = -it.face;
          if ((me.x < 18 && it.mx < 0) || (me.x > WW - 18 && it.mx > 0)) {
            it.my = me.y < (GTOP + GBOT) / 2 ? 1 : -1;
          }
        }
        if (--this.retreatTicks <= 0) this.phase = 'approach';
        return it;
      }
      if (this.phase === 'approach') {
        if (Math.abs(dy) > 2) it.my = Math.sign(dy);
        if (distance > 19) it.mx = it.face;
        if (distance > 25 || Math.abs(dy) > 5) return it;
        this.phase = 'burst'; this.remaining = 1 + Math.floor(Math.random() * 3);
      }
      // Only issue a new attack once the previous one has actually completed.
      // No repeated attack intent/buffering while the swing is in progress.
      it.mx = it.my = 0; it.attack = 'swipe'; this.remaining--;
      return it;
    }
  }
  function createBrain(kind, state) {
    const Brain = { troll: TrollBrain, ogre: OgreBrain, gremlin: GremlinBrain }[kind];
    return Brain ? Object.assign(new Brain(), state || {}) : null;
  }

  // ---------- game state ----------
  const G = { fighters: [], particles: [], popups: [], cam: { x: 0, y: 0 }, shake: 0, debug: false, slow: false, kills: 0, respawn: 0, enemiesEnabled: true, spawnIndex: 0, friendlyFire: false };
  const enemiesToggle = document.getElementById('enemies-toggle');
  enemiesToggle?.addEventListener?.('click', () => {
    if (N.offline) setEnemiesEnabled(!G.enemiesEnabled);
    else N.requestEnemies(!G.enemiesEnabled);
    enemiesToggle.blur();
  });
  const friendlyFireToggle = document.getElementById('friendly-fire-toggle');
  friendlyFireToggle?.addEventListener?.('click', () => {
    if (N.offline) G.friendlyFire = !G.friendlyFire;
    else N.requestFriendlyFire(!G.friendlyFire);
    friendlyFireToggle.blur();
  });
  function setEnemiesEnabled(enabled) {
    G.enemiesEnabled = enabled;
    if (!enabled) {
      G.fighters = G.fighters.filter(f => f.team !== 'e' || f.state === 'dead');
      G.enemy = [...G.fighters].reverse().find(f => f.team === 'e');
      G.respawn = 0;
    }
  }

  function reset() {
    bakeWorld();
    G.particles = []; G.popups = []; G.kills = 0; G.respawn = 0; G.spawnIndex = 0;
    G.player = new Fighter('knight', 200, 182, 1, { name: 'Sir Knight', team: 'p' });
    G.dummy = new Dummy(130, 160);
    G.fighters = [G.player];
    spawnEnemy(380);
    G.cam.x = clamp(G.player.x - VW / 2, 0, WW - VW); G.cam.y = WH - VH;
  }
  function spawnEnemy(x) {
    if (!G.enemiesEnabled) return;
    // A repeating mix guarantees all three species appear, with extra gremlins.
    const kind = ['troll', 'gremlin', 'ogre', 'gremlin'][G.spawnIndex++ % 4];
    const name = kind[0].toUpperCase() + kind.slice(1);
    const t = new Fighter(kind, x, rand(160, 200), -1, { name, team: 'e', brain: createBrain(kind) });
    G.fighters.push(t); G.enemy = t;
    G.respawn = 120; // One shared spawn cooldown: two seconds at 60 Hz.
    t.id = kind + '-' + crypto.randomUUID();
    // Keep a generous graveyard, bounded so a long-running room stays playable.
    const dead = G.fighters.filter((f) => f.state === 'dead' && f.team !== 'p');
    while (dead.length > 300) G.fighters.splice(G.fighters.indexOf(dead.shift()), 1);
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

  function resolveHits(attackers = G.fighters) {
    const targets = [...G.fighters.filter(f => f.state !== 'dead'), G.dummy];
    for (const a of attackers) {
      if (a.state !== 'attack' || a.fi < a.atk.active[0] || a.fi > a.atk.active[1]) continue;
      const box = attackBox(a);
      for (const t of targets) {
        if (t === a || t.state === 'dead' || a.hitList.has(t)) continue;
        if (t.team === a.team && !(G.friendlyFire && a.team === 'p')) continue;
        if (Math.abs(t.y - a.y) > a.atk.depth) continue;
        const hb = hurtbox(t);
        if (box.x1 < hb.x0 || box.x0 > hb.x1) continue;
        a.hitList.add(t);
        applyHit(a, t, a.atk);
      }
    }
  }

  function dummyFeedback(damage, direction, shake) {
    const d = G.dummy;
    d.wobble = 20; d.flash = 4;
    G.shake = Math.max(G.shake, shake || 0);
    straw(d.x, d.y, 18, direction); popup(d, damage, '#f0e0a0'); SFX.straw(); SFX.hit();
  }
  function applyHit(a, t, atk) {
    const dirx = a.facing;
    G.shake = Math.max(G.shake, atk.shake);
    if (t.isDummy) {
      t.hits++; t.dmg += atk.dmg; a.hitstop = atk.stop;
      t.events.push({ seq: t.hits, damage: atk.dmg, direction: dirx, shake: atk.shake });
      if (t.events.length > 16) t.events.shift();
      dummyFeedback(atk.dmg, dirx, atk.shake);
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
    if (t.team === 'e') G.kills++;
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
  const fields = ['id', 'lifeId', 'inputSeq', 'kind', 'name', 'team', 'x', 'y', 'z', 'vx', 'facing', 'hp', 'maxHp', 'ghostHp',
    'state', 'timer', 'hitstop', 'flash', 'fountain', 'headless', 'fi', 'ft', 'buffer', 'respawnSeq'];
  let publishAt = 0, applied = null, wasHost = false;
  const inputSeen = new Map();
  const timeline = new MS.Sync.Timeline(100);
  let worldTick = 0, archiveKey = null;
  let receivedArchiveRevision = null;
  const correction = { x: 0, y: 0, at: 0 };
  function decayCorrection(now) {
    const decay = Math.exp(-Math.max(0, now - correction.at) / 80);
    correction.x *= decay; correction.y *= decay; correction.at = now;
  }
  function settled(f) {
    return f.state === 'dead' && f.team !== 'p' && f.fi === f.anim.frames.length - 1 &&
      f.fountain <= 0 && Math.abs(f.vx) < 0.05 && f.hitstop <= 0;
  }
  function serialize(f) {
      const data = Object.fromEntries(fields.map(k => [k, f[k] === undefined ? null : f[k]]));
      data.buffer = f.buffer ? { ...f.buffer } : null;
      data.animName = Object.keys(f.def.anims).find(k => f.def.anims[k] === f.anim) || 'idle';
      data.attackName = Object.keys(f.def.attacks).find(k => f.def.attacks[k] === f.atk) || null;
      data.hitIds = [...f.hitList].map(t => t.isDummy ? 'dummy' : t.id);
      data.brain = f.brain ? { ...f.brain } : null;
      return data;
  }
  function snapshot() {
    const archived = G.fighters.filter(settled);
    const key = archived.map(f => f.id + ':' + f.team).join('|');
    if (N.corpses && key !== archiveKey) {
      // Corpses are published only when the graveyard changes, not at 20 Hz.
      N.corpses.fighters = archived.map(serialize);
      N.corpses.revision = crypto.randomUUID(); archiveKey = key;
    }
    return { fighters: G.fighters.filter(f => !N.corpses || !settled(f)).map(serialize),
      tick: worldTick, corpseRevision: N.corpses?.revision || null,
      revision: crypto.randomUUID(), dummy: { hits: G.dummy.hits, dmg: G.dummy.dmg,
        events: G.dummy.events.map(event => ({ ...event })) }, kills: G.kills,
      respawn: G.respawn, enemiesEnabled: G.enemiesEnabled, spawnIndex: G.spawnIndex, friendlyFire: G.friendlyFire };
  }
  function receive(s) {
    // The two shared records can arrive independently. Keep the previous scene
    // until the matching graveyard arrives, rather than briefly dropping bodies.
    if (s.corpseRevision && s.corpseRevision !== N.corpses?.revision) return false;
    const now = performance.now();
    decayCorrection(now);
    const previousPlayer = G.player;
    const previousX = previousPlayer.x + correction.x, previousY = previousPlayer.y + correction.y;
    const incoming = [...s.fighters, ...(s.corpseRevision ? N.corpses.fighters : [])];
    const old = new Map(G.fighters.map(f => [f.id, f]));
    G.fighters = incoming.map((data, index) => {
      const prior = old.get(data.id);
      if (index >= s.fighters.length && prior && receivedArchiveRevision === s.corpseRevision) return prior;
      const f = prior?.lifeId === data.lifeId ? prior : new Fighter(data.kind, data.x, data.y, data.facing, data);
      if (old.has(data.id) && data.hp < f.hp) {
        blood(data.x, data.y, 24, -data.facing, 12); popup(f, f.hp - data.hp, '#ff6050'); SFX.hit();
        if (data.state === 'dead') SFX.die();
      }
      if (old.has(data.id) && data.headless && !f.headless) {
        const head = f.joint('head');
        G.particles.push({ kind: 'head', sprite: R.headSprite(f.spec), x: data.x, y: data.y,
          z: head.z, vx: -data.facing * 1.5, vz: 3, spin: 0, flip: data.facing, life: 1e9 });
      }
      for (const k of fields) f[k] = k === 'buffer' && data[k] ? { ...data[k] } : data[k];
      f.atk = data.attackName ? f.def.attacks[data.attackName] : null;
      f.anim = f.atk || f.def.anims[data.animName];
      f.brain = data.brain ? createBrain(data.kind, data.brain) : null;
      return f;
    });
    for (let i = 0; i < s.fighters.length; i++) {
      G.fighters[i].hitList = new Set(incoming[i].hitIds.map(id => id === 'dummy' ? G.dummy : G.fighters.find(f => f.id === id)).filter(Boolean));
    }
    if (applied !== null && s.dummy.hits > G.dummy.hits) {
      const events = (s.dummy.events || []).filter(event => event.seq > G.dummy.hits);
      for (const event of events) dummyFeedback(event.damage, event.direction, event.shake);
      // Compatibility with a host still running the previous build.
      if (!events.length) dummyFeedback(s.dummy.dmg - G.dummy.dmg, 1, 1.5);
    }
    G.dummy.hits = s.dummy.hits; G.dummy.dmg = s.dummy.dmg;
    G.dummy.events = (s.dummy.events || []).map(event => ({ ...event }));
    G.kills = s.kills; G.respawn = s.respawn;
    G.spawnIndex = s.spawnIndex || 0;
    G.enemiesEnabled = s.enemiesEnabled !== false;
    G.friendlyFire = !!s.friendlyFire;
    receivedArchiveRevision = s.corpseRevision;
    G.player = G.fighters.find(f => f.id === N.id) || G.player;
    G.enemy = [...G.fighters].reverse().find(f => f.team === 'e');
    worldTick = s.tick;
    if (!N.host()) {
      timeline.push(s, now);
      N.commands.acknowledge(G.player.inputSeq);
      // Restore authoritative state, then replay only inputs not yet simulated
      // by the host. Never replay damage, collisions, particles, or audio.
      if (G.player.id === N.id) {
        replaying = true;
        try { for (const command of N.commands.pending) G.player.update(command); }
        finally { replaying = false; }
      }
      if (previousPlayer.lifeId === G.player.lifeId && G.player.state !== 'dead') {
        correction.x = previousX - G.player.x; correction.y = previousY - G.player.y;
        if (Math.hypot(correction.x, correction.y) > 80) correction.x = correction.y = 0;
      } else correction.x = correction.y = 0;
    } else {
      timeline.clear(); correction.x = correction.y = 0; archiveKey = null;
      // On takeover, rebase even if we already displayed this snapshot. Our
      // guest copy may be predicted ahead of it. Consume outstanding local
      // commands once so the new host doesn't inherit a permanent input queue.
      if (G.player.id === N.id) {
        replaying = true;
        try {
          for (const command of N.commands.pending) {
            if (command.seq <= G.player.inputSeq) continue;
            G.player.update(command); G.player.inputSeq = command.seq;
            separate(); resolveHits([G.player]);
          }
        } finally { replaying = false; }
        N.commands.acknowledge(G.player.inputSeq);
      }
    }
    return true;
  }
  function reconcilePlayers() {
    const guests = N.players(), ids = new Set(guests.map(g => g.id));
    for (const id of inputSeen.keys()) if (!ids.has(id)) inputSeen.delete(id);
    G.fighters = G.fighters.filter(f => f.team !== 'p' || ids.has(f.id));
    for (const g of guests) {
      let f = G.fighters.find(f => f.id === g.id);
      if (!f || (f.state === 'dead' && g.respawnSeq > (f.respawnSeq || 0))) {
        if (f) { f.team = 'corpse'; f.id = 'fallen-' + crypto.randomUUID(); }
        f = new Fighter('knight', rand(170, 250), rand(155, 210), 1, { name: g.name, team: 'p' });
        f.id = g.id;
        f.inputSeq = g.id === N.id ? N.commands.seq : g.commands?.[g.commands.length - 1]?.seq || 0;
        f.respawnSeq = g.respawnSeq;
        G.fighters.push(f);
      }
    }
    G.player = G.fighters.find(f => f.id === N.id) || G.player;
  }
  function update() {
    if (tapped('KeyB')) G.debug = !G.debug;
    if (tapped('KeyT') && N.offline) G.slow = !G.slow;
    if (tapped('KeyR') && N.offline) reset();
    if (tapped('KeyP')) exportSheets();
    const localIntent = keyboardIntent();
    if (!N.offline && !N.ready) { pressed.clear(); return; }
    const authority = N.offline || N.host();
    if (N.ready) {
      if (N.world.snapshot && ((!authority && N.world.snapshot.revision !== applied) || (authority && !wasHost))) {
        if (receive(N.world.snapshot)) applied = N.world.snapshot.revision;
        else if (authority) { pressed.clear(); return; }
      }
      if (authority) reconcilePlayers();
      wasHost = authority;
    }
    const localCommand = N.input(localIntent, tapped('KeyR'));
    if (authority) {
    worldTick++;
    if (typeof N.enemyRequest === 'boolean') {
      setEnemiesEnabled(N.enemyRequest); N.enemyRequest = null;
      publishAt = -Infinity; // Publish the removal without waiting for the next snapshot interval.
    }
    if (typeof N.friendlyFireRequest === 'boolean') {
      G.friendlyFire = N.friendlyFireRequest; N.friendlyFireRequest = null;
      publishAt = -Infinity;
    }
    for (const f of G.fighters) {
      if (settled(f)) continue;
      let it = null;
      if (N.ready && f.team === 'p') {
        const g = N.players().find(g => g.id === f.id);
        let seen = inputSeen.get(f.id);
        if (g && (!seen || seen.heartbeat !== g.heartbeat)) {
          seen = { heartbeat: g.heartbeat, at: performance.now() }; inputSeen.set(f.id, seen);
        }
        if (g && performance.now() - seen.at < 2000) {
          const commands = g.id === N.id ? N.commands.history : g.commands || [];
          const command = commands.find(c => c.seq > f.inputSeq);
          if (command) { it = command; f.inputSeq = command.seq; }
          if (g.id === N.id) N.commands.acknowledge(f.inputSeq);
        }
      }
      else if (f === G.player) it = localIntent;
      else if (f.brain && f.state !== 'dead') it = f.brain.think(f, G);
      f.update(it);
    }
    separate();
    resolveHits();
    if (G.respawn > 0) G.respawn--;
    // Several enemies at once; more players attract a larger mob.
    const desired = Math.min(8, 2 + (N.ready ? N.players().length : 1));
    if (G.enemiesEnabled && !G.respawn && G.fighters.filter(f => f.team === 'e' && f.state !== 'dead').length < desired) spawnEnemy(rand(300, WW - 15));
    if (N.ready && performance.now() - publishAt >= 50) {
      N.world.snapshot = snapshot(); publishAt = performance.now();
    }
    }
    else if (G.player.id === N.id && localCommand) G.player.update(localCommand);
    G.dummy.update();
    updateParticles();
    if (!authority) for (const f of G.fighters) {
      if (f.headless && f.fountain > 0 && Math.random() < 0.5) neckSpurt(f);
    }
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

  function presentation(f, now) {
    if (N.offline || N.host()) return f;
    if (f.id === N.id) {
      decayCorrection(now);
      return Object.assign(Object.create(f), { x: f.x + correction.x, y: f.y + correction.y });
    }
    const sample = timeline.sample(f.id, now);
    if (!sample || sample.from.lifeId !== sample.to.lifeId || sample.from.lifeId !== f.lifeId) return f;
    const { from, to, alpha, ticks } = sample;
    const view = Object.assign(Object.create(f), from);
    for (const key of ['x', 'y', 'z']) view[key] = from[key] + (to[key] - from[key]) * alpha;
    view.anim = from.attackName ? f.def.attacks[from.attackName] : f.def.anims[from.animName];
    // Advance visual animation between snapshots, without running combat/AI.
    let remaining = Math.floor(from.ft + ticks);
    view.fi = from.fi;
    for (let n = 0; n < 60 && remaining >= view.anim.frames[view.fi][1]; n++) {
      remaining -= view.anim.frames[view.fi][1];
      if (view.fi < view.anim.frames.length - 1) view.fi++;
      else if (view.anim.loop) view.fi = 0;
      else break;
    }
    return view;
  }
  G.presentation = (f, now = performance.now()) => presentation(f, now);
  G.networkStats = () => ({ pendingInputs: N.commands.pending.length, bufferedSnapshots: timeline.samples.length,
    correction: Math.hypot(correction.x, correction.y), activeFighters: G.fighters.filter(f => !settled(f)).length,
    corpses: G.fighters.filter(settled).length });
  function render() {
    if (friendlyFireToggle) {
      friendlyFireToggle.disabled = !N.offline && !N.ready;
      friendlyFireToggle.textContent = 'Friendly fire: ' + (G.friendlyFire ? 'ON' : 'OFF') + (N.offline ? '' : ' (everyone)');
      friendlyFireToggle.setAttribute?.('aria-pressed', String(G.friendlyFire));
    }
    if (enemiesToggle) {
      enemiesToggle.disabled = !N.offline && !N.ready;
      enemiesToggle.textContent = 'Enemies: ' + (G.enemiesEnabled ? 'ON' : 'OFF') + (N.offline ? '' : ' (everyone)');
      enemiesToggle.setAttribute?.('aria-pressed', String(G.enemiesEnabled));
    }
    const sx0 = G.shake ? rand(-G.shake, G.shake) : 0, sy0 = G.shake ? rand(-G.shake, G.shake) : 0;
    const cx = Math.round(G.cam.x + sx0), cy = Math.round(G.cam.y + sy0);
    ctx.drawImage(far, -Math.round(G.cam.x * 0.4), -Math.round(G.cam.y * 0.5));
    ctx.drawImage(ground, -cx, -cy);

    const now = performance.now();
    const things = [...G.fighters.map(f => presentation(f, now)), G.dummy, ...G.particles.filter((p) => p.kind === 'head')];
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
      if (e.team === 'p' && e.state !== 'dead') {
        F.draw(ctx, e.id === N.id ? 'YOU' : e.name, sx - F.width(e.id === N.id ? 'YOU' : e.name) / 2, sy - e.def.h - 9, e.id === N.id ? '#e8d48a' : '#90c8ff', '#000');
      }
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
      const label = e.state === 'dead' ? e.name + ' - slain' : e.name;
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
    if (G.enemiesEnabled && G.respawn > 0 && G.respawn < 100 &&
        G.fighters.filter(f => f.team === 'e' && f.state !== 'dead').length < Math.min(8, 2 + (N.ready ? N.players().length : 1))) {
      const s = 'Another approaches...'; F.draw(ctx, s, VW / 2 - F.width(s) / 2, 26, '#9ad070', '#000');
    }
    if (p.state === 'dead') {
      const s1 = 'You have fallen', s2 = 'Press R';
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 84, VW, 26);
      F.draw(ctx, s1, VW / 2 - F.width(s1) / 2, 90, '#ff6050', '#000');
      F.draw(ctx, s2, VW / 2 - F.width(s2) / 2, 99, '#c0b8e0', '#000');
    }
  }

  function exportSheets() {
    for (const k of Object.keys(MS.CHARS)) {
      const a = document.createElement('a');
      a.download = k + '_sheet.png'; a.href = R.sheet(MS.CHARS[k].spec).toDataURL('image/png'); a.click();
    }
  }

  // ---------- loop ----------
  reset();
  const STEP = 1000 / 60;
  let last = performance.now(), acc = 0;
  function advance(now) {
    acc += Math.min(document.hidden ? 1000 : 100, now - last); last = now;
    const step = G.slow ? STEP * 4 : STEP;
    while (acc >= step) { update(); acc -= step; }
    N.flush?.(); // Send the complete tick batch, not just its first command.
  }
  function loop(now) {
    advance(now);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  // Background tabs suspend animation frames. Keep hosting/input alive when
  // testing two tabs; browsers may still throttle or suspend a hidden page.
  setInterval(() => { if (document.hidden) advance(performance.now()); }, 100);
  window.GAME = G; // handy for poking at state from the console
  // Test hook: advance n fixed ticks synchronously, then draw.
  G.step = (n) => { for (let i = 0; i < n; i++) update(); render(); };
})();
