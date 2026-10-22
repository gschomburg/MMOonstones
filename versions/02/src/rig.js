// Procedural pixel-art rig.
// A pose is a set of joint angles. Each pose gets drawn once into its own small
// canvas (a sprite frame) and cached. The game only ever blits frames, so these can
// later be swapped for hand-drawn sprite sheets without touching game logic.
//
// Angle convention (degrees): 0 = straight down, 90 = forward, 180 = straight up,
// -90 = backward. Characters are authored facing right; the game flips them.
(function () {
  const MS = (window.MS = window.MS || {});
  const D = Math.PI / 180;
  const DEFAULT_POSE = { lean: 0, bob: 0, hipX: 0, fl: [0, 0], bl: [0, 0], fa: [0, 0], ba: [0, 0], w: 180, lift: 0, rot: 0, smear: null };

  const dir = (a) => [Math.sin(a * D), Math.cos(a * D)];
  const add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k];

  // Chunky pixel line: stamps a w*w square along the segment.
  function line(ctx, a, b, w, color) {
    ctx.fillStyle = color;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2) + 1;
    const o = Math.floor(w / 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      ctx.fillRect(Math.round(a[0] + dx * t) - o, Math.round(a[1] + dy * t) - o, w, w);
    }
  }

  function disc(ctx, p, r, color) {
    ctx.fillStyle = color;
    const cx = Math.round(p[0]), cy = Math.round(p[1]), R = Math.ceil(r);
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) if (x * x + y * y <= r * r + r * 0.8) ctx.fillRect(cx + x, cy + y, 1, 1);
  }

  // Joined limb: all outlines first, then fills, so joints don't show seams.
  function chain(ctx, pts, w, fill, out) {
    for (let i = 0; i < pts.length - 1; i++) line(ctx, pts[i], pts[i + 1], w + 2, out);
    for (let i = 0; i < pts.length - 1; i++) line(ctx, pts[i], pts[i + 1], w, fill);
  }

  // Forward kinematics. Returns joint positions with feet planted at (ax, ay).
  function solve(spec, pose, ax, ay) {
    const P = Object.assign({}, DEFAULT_POSE, pose);
    const hip = [P.hipX, 0];
    const leg = (L) => {
      const k = add(hip, dir(L[0]), spec.thigh);
      return [hip, k, add(k, dir(L[0] + L[1]), spec.shin)];
    };
    const FL = leg(P.fl), BL = leg(P.bl);
    const ground = Math.max(FL[2][1], BL[2][1]); // lowest foot touches the ground
    const up = [Math.sin(P.lean * D), -Math.cos(P.lean * D)];
    const hipU = [hip[0], hip[1] + P.bob]; // bob moves the upper body only
    const sh = add(hipU, up, spec.torso);
    const neck = add(sh, up, 1);
    const head = add(add(sh, up, spec.headR + 1), [1, 0], spec.headFwd || 0);
    const skirt = add(hipU, up, -3);
    const arm = (A, off) => {
      const s = [sh[0] + off, sh[1] + 1];
      const e = add(s, dir(A[0]), spec.upper);
      return [s, e, add(e, dir(A[0] + A[1]), spec.fore)];
    };
    const FA = arm(P.fa, 1), BA = arm(P.ba, -1);
    const wd = dir(P.w);
    const tip = add(FA[2], wd, spec.weaponLen), butt = add(FA[2], wd, -3);

    // Whole-body rotation around the feet (used for falling over).
    const cr = Math.cos(P.rot * D), sr = Math.sin(P.rot * D);
    const T = (p) => {
      const x = p[0], y = p[1] - ground;
      return [ax + x * cr - y * sr, ay + x * sr + y * cr - P.lift];
    };
    const Tm = (a) => a.map(T);
    return {
      P, hipU: T(hipU), sh: T(sh), neck: T(neck), head: T(head), skirt: T(skirt),
      FL: Tm(FL), BL: Tm(BL), FA: Tm(FA), BA: Tm(BA), hand: T(FA[2]), tip: T(tip), butt: T(butt),
    };
  }

  function drawHead(ctx, spec, c) {
    const C = spec.colors, O = C.outline, r = spec.headR;
    const cx = Math.round(c[0]), cy = Math.round(c[1]);
    disc(ctx, c, r + 1, O);
    if (spec.kind === 'knight') {
      ctx.fillStyle = C.accent; // plume
      [[0, -r - 2], [-1, -r - 2], [-2, -r - 1], [-3, -r - 1], [-4, -r], [-5, -r + 1], [-5, -r + 2]].forEach(([x, y]) => ctx.fillRect(cx + x, cy + y, 1, 1));
      disc(ctx, c, r, C.helm);
      ctx.fillStyle = C.helmLight; ctx.fillRect(cx - 1, cy - 2, 2, 1);
      ctx.fillStyle = O; ctx.fillRect(cx + 1, cy, r, 1); ctx.fillRect(cx + 2, cy + 2, 1, 1);
    } else {
      if (spec.earLen) {
        line(ctx, [cx - r, cy], [cx - r - spec.earLen, cy - 3], 3, O);
        line(ctx, [cx - r, cy], [cx - r - spec.earLen + 1, cy - 2], 1, C.head);
      }
      disc(ctx, c, r, C.head);
      ctx.fillStyle = C.bodyDark; ctx.fillRect(cx + 1, cy - 2, 3, 1);
      ctx.fillStyle = C.eye; ctx.fillRect(cx + 2, cy - 1, 1, 1);
      ctx.fillStyle = C.tusk; ctx.fillRect(cx + 3, cy + 1, 1, 2);
      if (spec.kind === 'ogre') { ctx.fillStyle = O; ctx.fillRect(cx, cy - 3, 5, 2); }
    }
  }

  function drawShield(ctx, spec, S) {
    const C = spec.colors, cx = Math.round(S.BA[2][0]) + 1, cy = Math.round(S.BA[2][1]);
    ctx.fillStyle = C.outline; ctx.fillRect(cx - 3, cy - 5, 7, 11); ctx.fillRect(cx - 2, cy + 6, 5, 1);
    ctx.fillStyle = C.shield; ctx.fillRect(cx - 2, cy - 4, 5, 9); ctx.fillRect(cx - 1, cy + 5, 3, 1);
    ctx.fillStyle = C.accent; ctx.fillRect(cx, cy - 3, 1, 7); ctx.fillRect(cx - 1, cy - 1, 3, 1);
  }

  function drawWeapon(ctx, spec, S) {
    if (spec.weapon === 'fists') return;
    const C = spec.colors, O = C.outline, h = S.hand, t = S.tip, b = S.butt;
    const dx = t[0] - h[0], dy = t[1] - h[1], L = Math.hypot(dx, dy) || 1;
    const u = [dx / L, dy / L], n = [-u[1], u[0]];
    if (spec.weapon === 'sword') {
      const gc = add(h, u, 1.5), g1 = add(gc, n, 3), g2 = add(gc, n, -3);
      line(ctx, b, t, 4, O);
      line(ctx, g1, g2, 4, O);
      line(ctx, b, h, 2, C.hilt);
      line(ctx, gc, t, 2, C.blade);
      line(ctx, add(gc, u, 1), t, 1, C.bladeLight);
      line(ctx, g1, g2, 2, C.accent);
    } else if (spec.weapon === 'claws') {
      for (const offset of [-2, 0, 2]) {
        const start = add(h, n, offset), end = add(start, u, spec.weaponLen);
        line(ctx, start, end, 2, O); line(ctx, start, end, 1, C.tusk);
      }
    } else {
      const k = add(h, u, spec.weaponLen - 4);
      line(ctx, b, t, 5, O); disc(ctx, k, 4, O);
      line(ctx, b, t, 3, C.club); disc(ctx, k, 3, C.club);
      disc(ctx, add(k, n, 1.5), 0.6, C.clubDark); disc(ctx, add(k, u, 2), 0.6, C.clubDark);
    }
  }

  // Motion smear: a fading arc around the shoulder, from angle a0 to a1.
  function drawSmear(ctx, spec, S) {
    const [a0, a1] = S.P.smear, rot = S.P.rot, R = spec.upper + spec.fore + spec.weaponLen * 0.85;
    const n = Math.ceil(Math.abs(a1 - a0) / 2);
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = a0 + (a1 - a0) * t - rot;
      ctx.fillStyle = `rgba(255,250,225,${(0.08 + 0.55 * t).toFixed(2)})`;
      for (let r = R - 2; r <= R + 1; r++) {
        const p = add(S.sh, dir(a), r);
        ctx.fillRect(Math.round(p[0]), Math.round(p[1]), 1, 1);
      }
    }
  }

  function drawFigure(ctx, spec, pose, ax, ay, opts) {
    opts = opts || {};
    const S = solve(spec, pose, ax, ay), C = spec.colors, O = C.outline;
    if (S.P.smear) drawSmear(ctx, spec, S);
    chain(ctx, S.BA, spec.limbW - 1, C.bodyDark, O);
    if (spec.handR) { disc(ctx, S.BA[2], spec.handR + 1, O); disc(ctx, S.BA[2], spec.handR, C.bodyDark); }
    chain(ctx, S.BL, spec.limbW, C.legDark, O);
    line(ctx, S.hipU, S.sh, spec.torsoW + 2, O);
    line(ctx, S.hipU, S.skirt, spec.torsoW + 2, O);
    line(ctx, S.hipU, S.sh, spec.torsoW, C.torso);
    line(ctx, S.hipU, S.skirt, spec.torsoW, C.cloth);
    if (opts.headless) disc(ctx, S.neck, 1.5, '#8a0c0c');
    else drawHead(ctx, spec, S.head);
    chain(ctx, S.FL, spec.limbW, C.leg, O);
    if (spec.shield) drawShield(ctx, spec, S);
    drawWeapon(ctx, spec, S);
    chain(ctx, S.FA, spec.limbW - 1, C.body, O);
    disc(ctx, S.hand, spec.handR ? spec.handR + 1 : 1.6, O); disc(ctx, S.hand, spec.handR || 1, C.body);
    if (spec.handR) {
      ctx.fillStyle = C.bodyDark;
      for (let i = -2; i <= 2; i += 2) ctx.fillRect(Math.round(S.hand[0]) + i, Math.round(S.hand[1]) - 3, 1, 3);
    }
    if (spec.kind === 'knight') { disc(ctx, S.FA[0], 2.6, O); disc(ctx, S.FA[0], 1.8, C.helm); }
  }

  // ---- Sprite frame cache ----
  const cache = new Map();
  function frame(spec, poseName, variant) {
    variant = variant || '';
    const key = spec.id + '|' + poseName + '|' + variant;
    let c = cache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = spec.frameW; c.height = spec.frameH;
    const x = c.getContext('2d');
    drawFigure(x, spec, spec.poses[poseName], spec.anchorX, spec.anchorY, { headless: variant.includes('nohead') });
    if (variant.includes('flash')) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
    cache.set(key, c);
    return c;
  }

  function headSprite(spec) {
    const key = spec.id + '|HEAD';
    let c = cache.get(key);
    if (c) return c;
    const s = spec.headR * 2 + 8;
    c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d');
    drawHead(x, spec, [s / 2, s / 2]);
    disc(x, [s / 2 - 1, s / 2 + spec.headR], 1.2, '#8a0c0c');
    cache.set(key, c);
    return c;
  }

  // All poses laid out in a grid, labelled, for export / repainting.
  function sheet(spec) {
    const names = Object.keys(spec.poses), cols = 6, rows = Math.ceil(names.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * spec.frameW; c.height = rows * (spec.frameH + 8);
    const x = c.getContext('2d');
    names.forEach((n, i) => {
      const cx = (i % cols) * spec.frameW, cy = ((i / cols) | 0) * (spec.frameH + 8);
      x.drawImage(frame(spec, n), cx, cy);
      if (MS.Font) MS.Font.draw(x, n, cx + 2, cy + spec.frameH + 1, '#888');
    });
    return c;
  }

  MS.Rig = { line, disc, solve, drawFigure, frame, headSprite, sheet };
})();
