// Character definitions: rig proportions, colours, poses, animations and attacks.
// Everything here is data. Tuning combat feel mostly means editing this file.
(function () {
  const MS = (window.MS = window.MS || {});

  // ---- Poses (knight, facing right). fl/bl = front/back leg [thigh, knee],
  // fa/ba = front/back arm [upper, elbow], w = weapon angle, smear = [fromAngle, toAngle].
  const KNIGHT_POSES = {
    idle1: { lean: 4, fl: [18, -14], bl: [-14, -6], fa: [25, 65], ba: [35, 55], w: 150 },
    idle2: { lean: 4, bob: 1, fl: [18, -14], bl: [-14, -6], fa: [27, 63], ba: [37, 53], w: 147 },
    walk1: { lean: 6, fl: [28, -8], bl: [-22, -18], fa: [20, 65], ba: [30, 55], w: 150 },
    walk2: { lean: 6, bob: 1, fl: [8, -28], bl: [-6, -6], fa: [23, 64], ba: [33, 54], w: 147 },
    walk3: { lean: 6, fl: [-22, -18], bl: [28, -8], fa: [20, 65], ba: [30, 55], w: 150 },
    walk4: { lean: 6, bob: 1, fl: [-6, -6], bl: [8, -28], fa: [23, 64], ba: [33, 54], w: 147 },

    slash1: { lean: -6, fl: [10, -10], bl: [-18, -6], fa: [-120, -10], ba: [40, 40], w: -100 },
    slash2: { lean: 16, fl: [38, -22], bl: [-32, -4], fa: [85, 5], ba: [20, 30], w: 95, smear: [170, 95] },
    slash3: { lean: 14, fl: [38, -22], bl: [-32, -4], fa: [60, 20], ba: [20, 30], w: 45, smear: [95, 45] },

    chop1: { lean: -6, fl: [12, -10], bl: [-16, -6], fa: [160, 15], ba: [30, 40], w: 215 },
    chop2: { lean: -12, fl: [12, -10], bl: [-16, -6], fa: [170, 25], ba: [25, 35], w: 245 },
    chop3: { lean: 26, bob: 1, fl: [42, -30], bl: [-30, -2], fa: [95, -5], ba: [30, 30], w: 75, smear: [235, 75] },
    chop4: { lean: 28, bob: 1, fl: [42, -30], bl: [-30, -2], fa: [70, 0], ba: [30, 30], w: 30 },

    thrust1: { lean: -8, fl: [10, -10], bl: [-20, -6], fa: [-35, 120], ba: [20, 30], w: 92 },
    thrust2: { lean: 18, fl: [46, -30], bl: [-38, 0], fa: [88, 2], ba: [10, 20], w: 90 },
    thrust3: { lean: 18, fl: [46, -30], bl: [-38, 0], fa: [86, 4], ba: [10, 20], w: 89 },

    block: { lean: -4, bob: 1, fl: [16, -14], bl: [-16, -6], fa: [15, 80], ba: [80, 40], w: 165 },
    hurt: { lean: -22, fl: [8, -6], bl: [-20, -10], fa: [-30, 40], ba: [-10, 30], w: 210 },
    stagger: { lean: -28, fl: [14, -10], bl: [-24, -12], fa: [-60, 30], ba: [-70, 20], w: 230 },

    die1: { lean: -30, fl: [20, -30], bl: [-10, -40], fa: [-60, 30], ba: [-40, 20], w: 230, rot: -10 },
    die2: { lean: -20, fl: [40, -70], bl: [20, -80], fa: [-80, 20], ba: [-60, 20], w: 260, rot: -50 },
    die3: { lean: 0, fl: [5, -5], bl: [10, -10], fa: [150, 20], ba: [-30, 10], w: 170, rot: -90, lift: 2 },
  };

  // Trolls reuse the knight poses, hunched over with a dangling off-hand.
  const TROLL_POSES = {};
  for (const k in KNIGHT_POSES) {
    const p = KNIGHT_POSES[k];
    TROLL_POSES[k] = k.startsWith('die') ? p : Object.assign({}, p, { lean: (p.lean || 0) + 12, ba: [p.ba[0] * 0.5, 15] });
  }

  const KNIGHT_SPEC = {
    id: 'knight', kind: 'knight', poses: KNIGHT_POSES,
    thigh: 7, shin: 7, torso: 10, upper: 6, fore: 5, headR: 3, limbW: 3, torsoW: 6,
    weapon: 'sword', weaponLen: 14, shield: true,
    frameW: 80, frameH: 66, anchorX: 40, anchorY: 62,
    colors: {
      outline: '#140f1c', body: '#9aa1ad', bodyDark: '#5d6270', leg: '#7d8494', legDark: '#4c5060',
      torso: '#a3262a', cloth: '#7a1a1f', helm: '#b4bac6', helmLight: '#eef2f6', accent: '#e0b030',
      blade: '#b9c3cf', bladeLight: '#f4f8fc', hilt: '#6b4a22', shield: '#2c4a9a',
    },
  };

  const TROLL_SPEC = {
    id: 'troll', kind: 'troll', poses: TROLL_POSES,
    thigh: 8, shin: 8, torso: 13, upper: 8, fore: 7, headR: 4, headFwd: 3, limbW: 4, torsoW: 9,
    weapon: 'club', weaponLen: 16, shield: false,
    frameW: 104, frameH: 88, anchorX: 52, anchorY: 84,
    colors: {
      outline: '#120e0a', body: '#6f8a4a', bodyDark: '#4a5e30', leg: '#667f44', legDark: '#43562c',
      torso: '#6a8546', cloth: '#5a3e22', head: '#7b9852', eye: '#ff4020', tusk: '#efe8d0',
      club: '#7a5228', clubDark: '#4e3418',
    },
  };

  const OGRE_POSES = { ...TROLL_POSES,
    idle1: { ...KNIGHT_POSES.idle1, lean: 10, fa: [5, 20], ba: [-10, 20] },
    idle2: { ...KNIGHT_POSES.idle2, lean: 12, fa: [8, 20], ba: [-8, 20] },
    punchWind: { ...KNIGHT_POSES.idle1, lean: -8, fa: [-65, 55], ba: [40, 55] },
    punchHit: { ...KNIGHT_POSES.slash2, lean: 22, fa: [85, 0], ba: [20, 60], smear: [30, 100] },
    punchRecover: { ...KNIGHT_POSES.slash3, lean: 14, fa: [50, 25], ba: [20, 40], smear: null },
    slamWind: { ...KNIGHT_POSES.chop2, lean: -8, fa: [175, 0], ba: [160, 5] },
    slamHit: { ...KNIGHT_POSES.chop3, lean: 30, fa: [65, 0], ba: [75, 0], smear: [175, 65] },
  };
  const OGRE_SPEC = {
    ...TROLL_SPEC, id: 'ogre', kind: 'ogre', poses: OGRE_POSES,
    thigh: 11, shin: 11, torso: 20, upper: 12, fore: 11, headR: 5, headFwd: 2,
    limbW: 7, torsoW: 16, handR: 6, weapon: 'fists', weaponLen: 0,
    frameW: 144, frameH: 160, anchorX: 72, anchorY: 116,
    colors: { ...TROLL_SPEC.colors, body: '#b18a68', bodyDark: '#78543f', leg: '#98714f',
      legDark: '#684834', torso: '#a77f5d', cloth: '#483126', head: '#c49a75', eye: '#ffb040' },
  };
  const GREMLIN_POSES = {};
  for (const key in TROLL_POSES) GREMLIN_POSES[key] = { ...TROLL_POSES[key] };
  GREMLIN_POSES.slash1 = { ...KNIGHT_POSES.slash1, lean: 20, fa: [-35, 40], ba: [35, 35] };
  GREMLIN_POSES.slash2 = { ...KNIGHT_POSES.slash2, lean: 30, fa: [85, 0], ba: [65, 15], w: 100, smear: [40, 120] };
  GREMLIN_POSES.slash3 = { ...KNIGHT_POSES.slash3, lean: 24, fa: [50, 20], ba: [30, 40], w: 120 };
  const GREMLIN_SPEC = {
    ...TROLL_SPEC, id: 'gremlin', kind: 'gremlin', poses: GREMLIN_POSES,
    thigh: 5, shin: 5, torso: 7, upper: 5, fore: 4, headR: 2, headFwd: 2,
    limbW: 2, torsoW: 4, earLen: 5, weapon: 'claws', weaponLen: 6,
    frameW: 72, frameH: 80, anchorX: 36, anchorY: 52,
    colors: { ...TROLL_SPEC.colors, body: '#579d89', bodyDark: '#315f59', leg: '#478774',
      legDark: '#294e47', torso: '#579d89', cloth: '#493b36', head: '#75bea0', eye: '#fff076' },
  };

  const BASE_ANIMS = (slow) => ({
    idle: { loop: true, frames: [['idle1', 30 * slow], ['idle2', 30 * slow]] },
    walk: { loop: true, frames: [['walk1', 7 * slow], ['walk2', 7 * slow], ['walk3', 7 * slow], ['walk4', 7 * slow]] },
    block: { loop: true, frames: [['block', 60]] },
    hurt: { loop: true, frames: [['hurt', 60]] },
    stagger: { loop: true, frames: [['stagger', 60]] },
    die: { loop: false, frames: [['die1', 8], ['die2', 10], ['die3', 99999]] },
  });

  // Attack data. Frames are [pose, ticks at 60fps].
  //   active: frame index range where the hitbox is live
  //   reach:  [near, far] pixels in front of the body; depth: how far apart on the
  //           ground plane (y) you can be and still connect
  //   stop:   hit-stop freeze frames; stun: hitstun ticks; step: [frame, lunge speed]
  //   guardBreak: blocked hit staggers instead; decap: chance a killing blow takes the head
  MS.CHARS = {
    knight: {
      spec: KNIGHT_SPEC, hp: 100, speed: [1.25, 0.75], hw: 6, h: 32, stunMul: 1,
      anims: BASE_ANIMS(1),
      attacks: {
        slash: { frames: [['slash1', 7], ['slash2', 5], ['slash3', 7], ['idle1', 5]], active: [1, 1], reach: [4, 32], height: [-30, -12], depth: 8, dmg: 12, kb: 2.6, stop: 5, shake: 1.5, stun: 18, step: [1, 1.4], decap: 0.6 },
        chop: { frames: [['chop1', 7], ['chop2', 9], ['chop3', 5], ['chop4', 10], ['idle1', 6]], active: [2, 2], reach: [4, 30], height: [-42, -4], depth: 8, dmg: 22, kb: 3.4, stop: 9, shake: 3.5, stun: 26, step: [2, 2], guardBreak: true, decap: 0.35 },
        thrust: { frames: [['thrust1', 5], ['thrust2', 6], ['thrust3', 6], ['idle1', 4]], active: [1, 2], reach: [8, 40], height: [-24, -16], depth: 7, dmg: 8, kb: 1.8, stop: 3, shake: 1, stun: 12, step: [1, 2.6] },
      },
    },
    troll: {
      spec: TROLL_SPEC, hp: 90, speed: [0.8, 0.5], hw: 9, h: 42, stunMul: 0.6,
      anims: BASE_ANIMS(1.4),
      attacks: {
        swipe: { frames: [['slash1', 18], ['slash2', 6], ['slash3', 12], ['idle1', 10]], active: [1, 1], reach: [6, 40], height: [-36, -14], depth: 9, dmg: 12, kb: 3, stop: 6, shake: 2, stun: 20, step: [1, 1.2] },
        smash: { frames: [['chop1', 14], ['chop2', 18], ['chop3', 6], ['chop4', 18], ['idle1', 10]], active: [2, 2], reach: [6, 40], height: [-50, -4], depth: 9, dmg: 20, kb: 4, stop: 10, shake: 4.5, stun: 28, step: [2, 1.6], guardBreak: true },
      },
    },
    ogre: {
      spec: OGRE_SPEC, hp: 180, speed: [0.55, 0.35], hw: 15, h: 59, stunMul: 0.4,
      anims: BASE_ANIMS(1.8),
      attacks: {
        punch: { frames: [['punchWind', 22], ['punchHit', 6], ['punchRecover', 22]], active: [1, 1], reach: [8, 43], height: [-46, -10], depth: 11, dmg: 26, kb: 5, stop: 8, shake: 5, stun: 30, step: [1, 1.8] },
        slam: { frames: [['slamWind', 34], ['slamHit', 7], ['punchRecover', 27]], active: [1, 1], reach: [6, 43], height: [-65, -8], depth: 13, dmg: 34, kb: 6, stop: 11, shake: 7, stun: 38, step: [1, 1.2], guardBreak: true },
      },
    },
    gremlin: {
      spec: GREMLIN_SPEC, hp: 20, speed: [2.2, 1.15], hw: 4, h: 23, stunMul: 1.1,
      anims: BASE_ANIMS(0.55),
      attacks: {
        swipe: { frames: [['slash1', 3], ['slash2', 3], ['slash3', 4]], active: [1, 1], reach: [3, 23], height: [-23, -4], depth: 7, dmg: 5, kb: 0.8, stop: 2, shake: 0.8, stun: 7, step: [1, 0.5] },
      },
    },
  };
})();
