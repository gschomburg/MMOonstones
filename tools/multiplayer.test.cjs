// Logic regression tests; no browser, packages, or live server required.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function client(id, guests, host = false) {
  let now = 0;
  const noop = () => {};
  const ctx = new Proxy({}, { get: (o, key) => o[key] || noop });
  const canvas = () => ({ getContext: () => ctx });
  const net = { id, ready: true, offline: false, guests, world: { snapshot: null },
    corpses: { revision: null, fighters: [] },
    isHost: host, host() { return this.isHost; }, players: () => guests,
    input(intent) {
      const command = this.commands.push(this.overrideIntent || intent);
      const me = guests.find(g => g.id === id);
      if (me) me.commands = this.commands.history.slice();
      return command;
    } };
  const sandbox = { console, crypto: webcrypto, innerWidth: 1200, innerHeight: 900,
    Math: Object.create(Math),
    document: { hidden: false, getElementById: canvas, createElement: canvas },
    addEventListener: noop, requestAnimationFrame: noop, setInterval: noop,
    performance: { now: () => now },
    MS: { Net: net, Font: { draw: noop, width: s => s.length * 4 }, Rig: {
      disc: noop, line: noop, frame: () => ({}), headSprite: () => ({}),
      solve: () => ({ head: [0, -30], sh: [0, -20], hand: [8, -20], neck: [0, -26] }),
    } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['sync.js', 'characters.js', 'game.js']) {
    vm.runInContext(readFileSync(join(__dirname, '../versions/02/src', file), 'utf8'), sandbox);
    if (file === 'sync.js') net.commands = new sandbox.MS.Sync.Commands();
  }
  return { net, sync: sandbox.MS.Sync, chars: sandbox.MS.CHARS, game: sandbox.GAME,
    setRandom(value) { sandbox.Math.random = () => value; }, step(n = 1) {
    for (let i = 0; i < n; i++) { now += 17; sandbox.GAME.step(1); }
  } };
}
function player(id) {
  return { id, name: id, protocol: 3, heartbeat: Date.now(), commands: [], respawnSeq: 0 };
}
function quiet(c) { for (const f of c.game.fighters) if (f.team === 'e') f.brain = null; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function transfer(a, b) {
  b.net.world.snapshot = clone(a.net.world.snapshot);
  Object.assign(b.net.corpses, clone(a.net.corpses));
}

test('one host creates both players and consumes an attack edge only once', () => {
  const guests = [player('a'), player('b')], c = client('a', guests, true);
  c.step(6); quiet(c);
  assert.equal(c.game.fighters.filter(f => f.team === 'p').length, 2);
  assert.equal(c.game.fighters.filter(f => f.team === 'e').length, 1);
  const b = c.game.fighters.find(f => f.id === 'b'), x = b.x;
  guests[1].commands = [1, 2, 3].map(seq => ({ seq, mx: 1, my: 0, block: false, attack: null }));
  c.step(3); assert.ok(b.x > x);
  guests[1].commands.push({ seq: 4, mx: 0, my: 0, block: false, attack: 'chop' });
  c.step(1); assert.equal(b.state, 'attack'); assert.equal(b.inputSeq, 4);
  c.step(90); assert.equal(b.state, 'idle');
});

test('respawn keeps the fallen body and does not reset the arena', () => {
  const guests = [player('a')], c = client('a', guests, true);
  c.step(5); quiet(c);
  const fallen = c.game.player;
  fallen.hp = 0; fallen.state = 'dead'; fallen.play('die', true);
  c.game.kills = 31; guests[0].respawnSeq++;
  c.step();
  assert.notEqual(c.game.player, fallen);
  assert.equal(c.game.player.hp, c.game.player.maxHp);
  assert.ok(c.game.fighters.includes(fallen));
  assert.equal(c.game.kills, 31);
});

test('late join, in-place snapshot updates, and host migration preserve state', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true);
  a.step(5); quiet(a);
  const knight = a.game.player, troll = a.game.fighters.find(f => f.team === 'e');
  knight.startAttack('slash'); knight.hitList.add(troll);
  a.step();
  const b = client('b', guests);
  transfer(a, b); b.step();
  assert.equal(b.game.player.id, 'b');
  assert.equal(b.game.fighters.length, a.game.fighters.length);
  // Shared proxies can keep their identity while contents change.
  const same = b.net.world.snapshot;
  same.revision = 'next'; same.kills = 30; b.step();
  assert.equal(b.game.kills, 30);
  b.net.isHost = true; b.step();
  const migrated = b.game.fighters.find(f => f.id === 'a');
  assert.ok(migrated.hitList.has(b.game.fighters.find(f => f.id === troll.id)));
  assert.equal(b.game.kills, 30);
  guests.shift(); b.step();
  assert.ok(!b.game.fighters.some(f => f.id === 'a'));
});

test('troll corpses accumulate past the original two-body cap', () => {
  const c = client('a', [player('a')], true); c.step(5); quiet(c);
  for (let i = 0; i < 32; i++) {
    const t = c.game.fighters.find(f => f.team === 'e' && f.state !== 'dead');
    t.state = 'dead'; t.hp = 0; t.play('die', true); c.step(120);
    quiet(c);
  }
  assert.equal(c.game.fighters.filter(f => f.team === 'e' && f.state === 'dead').length, 32);
});

test('enemy toggle removes living trolls, preserves corpses and kills, and resumes spawning', () => {
  const c = client('a', [player('a')], true); c.step(5); quiet(c);
  const corpse = c.game.fighters.find(f => f.team === 'e');
  corpse.state = 'dead'; corpse.hp = 0; corpse.play('die', true);
  c.game.kills = 12; c.game.respawn = 160;
  c.net.enemyRequest = false; c.step();
  assert.equal(c.game.enemiesEnabled, false);
  assert.equal(c.game.fighters.filter(f => f.team === 'e' && f.state !== 'dead').length, 0);
  assert.ok(c.game.fighters.includes(corpse));
  assert.equal(c.game.kills, 12);
  assert.equal(c.game.respawn, 0);
  assert.equal(c.net.world.snapshot.enemiesEnabled, false);
  c.step(180);
  assert.equal(c.game.fighters.filter(f => f.team === 'e').length, 1);
  c.net.enemyRequest = true; c.step(5);
  assert.equal(c.game.fighters.filter(f => f.team === 'e' && f.state !== 'dead').length, 1);
  c.step(240);
  assert.equal(c.game.fighters.filter(f => f.team === 'e' && f.state !== 'dead').length, 3);
});

test('disabled enemies remain disabled for late join and host handoff', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true);
  a.step(5); a.net.enemyRequest = false; a.step();
  const b = client('b', guests);
  transfer(a, b); b.step();
  assert.equal(b.game.enemiesEnabled, false);
  b.net.isHost = true; b.step(180);
  assert.equal(b.game.fighters.filter(f => f.team === 'e').length, 0);
});

test('commands retain attack edges in batches and only replay unacknowledged inputs', () => {
  const { sync } = client('a', [player('a')]);
  const commands = new sync.Commands();
  commands.push({ mx: 1 }); commands.push({ attack: 'slash' }); commands.push({ attack: 'chop' });
  commands.acknowledge(2);
  assert.equal(commands.pending.length, 1);
  assert.equal(commands.pending[0].attack, 'chop');
  commands.acknowledge(1); // stale acknowledgements cannot move backwards
  assert.equal(commands.acked, 2);
  for (let i = 0; i < 200; i++) commands.push({});
  assert.equal(commands.history.length, 120);
  assert.equal(commands.pending.length, 120);
});

test('guest predicts immediately, then replays inputs over the host acknowledgement', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true);
  a.net.enemyRequest = false; a.step(5);
  a.game.player.x = 500; a.game.player.y = 220;
  const remote = a.game.fighters.find(f => f.id === 'b'); remote.x = 200; remote.y = 150;
  a.step(3);
  const b = client('b', guests); transfer(a, b); b.step();
  const initialX = b.game.player.x;
  b.net.overrideIntent = { mx: 1, my: 0, block: false, attack: null };
  b.step(6); // no host ticks or incoming snapshots
  assert.ok(b.game.player.x > initialX + 5);
  assert.equal(remote.x, 200); // predicting never writes host state
  a.step(3); transfer(a, b); b.step();
  const auth = a.net.world.snapshot.fighters.find(f => f.id === 'b');
  const pendingMovement = b.net.commands.pending.reduce((sum, c) => sum + c.mx, 0);
  assert.equal(b.net.commands.acked, auth.inputSeq);
  assert.ok(Math.abs(b.game.player.x - auth.x - pendingMovement * b.game.player.def.speed[0]) < 0.0001);
  assert.equal(b.game.player.hp, auth.hp); // damage remains authoritative
});

test('interpolation is buffered, clock-independent, bounded, and does not mutate snapshots', () => {
  const { sync } = client('a', [player('a')]);
  const timeline = new sync.Timeline(100);
  const snap = (tick, x) => ({ tick, fighters: [{ id: 'b', lifeId: 'life', x, y: 150, z: 0 }] });
  const first = snap(0, 0), last = snap(6, 60);
  timeline.push(first, 100000); timeline.push(snap(3, 30), 100050); timeline.push(last, 100100);
  const view = timeline.sample('b', 100150);
  const x = view.from.x + (view.to.x - view.from.x) * view.alpha;
  assert.ok(x > 0 && x < 60); // halfway through history, not snapped to latest
  const frozen = timeline.sample('b', 200000);
  assert.ok(frozen.from.x <= 60 && frozen.to.x <= 60); // stalls do not extrapolate forever
  assert.equal(first.fighters[0].x, 0); assert.equal(last.fighters[0].x, 60);
  timeline.push(snap(1, 10), 200100); // reset/reconnect tick discontinuity
  assert.equal(timeline.samples.length, 1);
});

test('settled corpses leave the hot snapshot; graveyard is unchanged until membership changes', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true); a.step(5); quiet(a);
  const corpse = a.game.fighters.find(f => f.team === 'e');
  corpse.state = 'dead'; corpse.hp = 0; corpse.play('die', true);
  corpse.fi = corpse.anim.frames.length - 1; corpse.fountain = 0; corpse.vx = 0;
  a.step(4);
  assert.ok(!a.net.world.snapshot.fighters.some(f => f.id === corpse.id));
  assert.ok(a.net.corpses.fighters.some(f => f.id === corpse.id));
  const revision = a.net.corpses.revision;
  a.step(12); assert.equal(a.net.corpses.revision, revision);
  const b = client('b', guests); transfer(a, b); b.step();
  assert.ok(b.game.fighters.some(f => f.id === corpse.id));
  b.net.isHost = true; b.step(5);
  assert.ok(b.game.fighters.some(f => f.id === corpse.id));
  assert.ok(!b.net.world.snapshot.fighters.some(f => f.id === corpse.id));
});

test('prediction does not mutate nested shared snapshot state', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true);
  a.net.enemyRequest = false; a.step(5);
  const remote = a.game.fighters.find(f => f.id === 'b');
  remote.state = 'hurt'; remote.timer = 40; remote.play('hurt', true);
  remote.buffer = { name: 'slash', ttl: 10 }; a.step(3);
  const b = client('b', guests); transfer(a, b);
  const before = JSON.stringify(b.net.world.snapshot);
  b.step(5);
  assert.equal(JSON.stringify(b.net.world.snapshot), before);
});

test('host takeover waits for matching graveyard rather than overwriting missing corpses', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true); a.step(5);
  const corpse = a.game.fighters.find(f => f.team === 'e');
  corpse.state = 'dead'; corpse.hp = 0; corpse.play('die', true);
  corpse.fi = corpse.anim.frames.length - 1; corpse.vx = 0; corpse.fountain = 0;
  a.step(4);
  const b = client('b', guests);
  b.net.world.snapshot = clone(a.net.world.snapshot); // graveyard packet has not arrived
  b.net.isHost = true; b.step(3);
  assert.equal(b.net.corpses.revision, null);
  assert.equal(b.net.world.snapshot.revision, a.net.world.snapshot.revision);
  Object.assign(b.net.corpses, clone(a.net.corpses)); b.step(5);
  assert.ok(b.game.fighters.some(f => f.id === corpse.id));
  assert.ok(b.net.corpses.fighters.some(f => f.id === corpse.id));
});

test('a hundred settled bodies do not increase the active snapshot fighter count', () => {
  const c = client('a', [player('a')], true); c.step(5);
  const troll = c.game.fighters.find(f => f.team === 'e');
  c.net.enemyRequest = false; c.step();
  for (let i = 0; i < 100; i++) {
    const corpse = new troll.constructor('troll', 300, 180, 1, { team: 'e', name: 'Troll' });
    corpse.id = 'corpse-' + i; corpse.hp = 0; corpse.state = 'dead'; corpse.play('die', true);
    corpse.fi = corpse.anim.frames.length - 1; c.game.fighters.push(corpse);
  }
  c.step(4);
  assert.equal(c.net.corpses.fighters.length, 100);
  assert.equal(c.net.world.snapshot.fighters.length, 1);
  assert.ok(JSON.stringify(c.net.world.snapshot).length < JSON.stringify(c.net.corpses).length / 20);
});

test('rendered remote positions interpolate without changing simulation positions', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true);
  a.net.enemyRequest = false; a.step(5);
  a.game.player.x = 100; a.game.player.y = 140; a.step(3);
  const b = client('b', guests); transfer(a, b); b.step(3);
  a.game.player.x = 200; a.step(3); transfer(a, b); b.step(3);
  const remote = b.game.fighters.find(f => f.id === 'a');
  const view = b.game.presentation(remote, 119);
  assert.ok(view.x >= 100 && view.x < 200);
  assert.equal(remote.x, 200);
  assert.ok(view.anim.frames[view.fi]);
});

test('host handoff consumes predicted commands once and leaves no permanent local input backlog', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true);
  a.net.enemyRequest = false; a.step(5);
  a.game.player.x = 500; a.game.player.y = 220;
  const remote = a.game.fighters.find(f => f.id === 'b'); remote.x = 200; remote.y = 140;
  a.step(3);
  const b = client('b', guests); transfer(a, b); b.step();
  b.net.overrideIntent = { mx: 1 }; b.step(6);
  const predicted = b.game.player.x;
  b.net.isHost = true; b.step();
  assert.ok(Math.abs(b.game.player.x - predicted - b.game.player.def.speed[0]) < 0.0001);
  assert.equal(b.net.commands.pending.length, 0);
  assert.equal(b.game.player.inputSeq, b.net.commands.seq);
});

function strikeDummy(c, id, name = 'slash') {
  const fighter = c.game.fighters.find(f => f.id === id);
  fighter.x = 104; fighter.y = 160; fighter.facing = 1; fighter.hitstop = 0;
  fighter.startAttack(name); fighter.fi = fighter.atk.active[0];
  c.step(3);
}

test('guests see dummy wobble, flash, straw, and individual damage amounts for either player', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true);
  a.net.enemyRequest = false; a.step(5);
  const b = client('b', guests); transfer(a, b); b.step();
  strikeDummy(a, 'a', 'slash');
  strikeDummy(a, 'b', 'chop'); // two hits between guest snapshots
  transfer(a, b); b.step();
  assert.equal(b.game.dummy.hits, 2);
  assert.equal(b.game.dummy.dmg, 34);
  assert.ok(b.game.dummy.wobble > 0); assert.ok(b.game.dummy.flash > 0);
  assert.deepEqual(Array.from(b.game.popups, p => p.text), ['12', '22']);
  assert.ok(b.game.particles.some(p => p.kind === 'straw'));
  const revisionOnly = b.net.world.snapshot;
  revisionOnly.revision = 'same-hit-new-snapshot'; b.step();
  assert.equal(b.game.popups.length, 2); // no duplicate playback
  b.step(50);
  assert.equal(b.game.dummy.wobble, 0); assert.equal(b.game.dummy.flash, 0);
  assert.equal(b.game.popups.length, 0);
});

test('late joins do not replay old dummy hits; previous-build hosts still show new hit feedback', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true);
  a.net.enemyRequest = false; a.step(5); strikeDummy(a, 'a');
  const b = client('b', guests); transfer(a, b); b.step();
  assert.equal(b.game.dummy.hits, 1);
  assert.equal(b.game.popups.length, 0); assert.equal(b.game.dummy.wobble, 0);
  const s = b.net.world.snapshot;
  delete s.dummy.events; s.dummy.hits++; s.dummy.dmg += 8; s.revision = 'legacy-hit';
  b.step();
  assert.equal(b.game.popups[0].text, '8'); assert.ok(b.game.dummy.wobble > 0);
  const snapshotBefore = JSON.stringify(s);
  b.net.isHost = true; b.step();
  assert.equal(JSON.stringify(s), snapshotBefore);
  assert.equal(b.game.dummy.events.length, 0);
});

test('enabling enemies spawns one immediately, then one per 120 ticks up to the cap', () => {
  const c = client('a', [player('a'), player('b')], true);
  const alive = () => c.game.fighters.filter(f => f.team === 'e' && f.state !== 'dead').length;
  const advance = n => { for (let i = 0; i < n; i++) { c.step(); quiet(c); } };
  c.net.enemyRequest = false; c.step();
  c.net.enemyRequest = true; advance(1);
  assert.equal(alive(), 1); assert.equal(c.game.respawn, 120);
  advance(119); assert.equal(alive(), 1);
  advance(1); assert.equal(alive(), 2);
  advance(119); assert.equal(alive(), 2);
  advance(1); assert.equal(alive(), 3);
  advance(120); assert.equal(alive(), 4);
  advance(240); assert.equal(alive(), 4);
});

test('spawn cooldown survives host handoff and simultaneous deaths do not bypass it', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true);
  a.net.enemyRequest = false; a.step(); a.net.enemyRequest = true; a.step(); quiet(a);
  a.step(123); quiet(a); // two living enemies; second spawn was three ticks ago
  for (const troll of a.game.fighters.filter(f => f.team === 'e')) {
    troll.hp = 0; troll.state = 'dead'; troll.play('die', true);
  }
  a.step(3);
  const b = client('b', guests); transfer(a, b); b.net.isHost = true;
  const remaining = a.net.world.snapshot.respawn;
  const alive = () => b.game.fighters.filter(f => f.team === 'e' && f.state !== 'dead').length;
  b.step(remaining - 1); assert.equal(alive(), 0);
  b.step(); assert.equal(alive(), 1); assert.equal(b.game.respawn, 120);
});

function bestiary(c) {
  c.game.respawn = 1; c.step(); // gremlin
  c.game.respawn = 1; c.step(); // ogre
  return Object.fromEntries(c.game.fighters.filter(f => f.team === 'e').map(f => [f.kind, f]));
}

test('mixed spawns include large fist-fighting ogres and small, fragile, fast gremlins', () => {
  const c = client('a', [player('a')], true), enemies = bestiary(c);
  assert.deepEqual(Object.keys(enemies).sort(), ['gremlin', 'ogre', 'troll']);
  assert.equal(enemies.ogre.spec.weapon, 'fists');
  assert.ok(enemies.ogre.spec.handR >= 5);
  assert.ok(enemies.ogre.def.h > enemies.troll.def.h);
  assert.ok(enemies.ogre.hp > enemies.troll.hp);
  assert.ok(enemies.gremlin.def.h < c.game.player.def.h);
  assert.ok(enemies.gremlin.hp < c.game.player.def.attacks.chop.dmg);
  assert.ok(enemies.gremlin.def.speed[0] > c.game.player.def.speed[0]);
});

for (const [random, expected] of [[0, 1], [0.4, 2], [0.99, 3]]) {
  test(`gremlin rushes in, issues exactly ${expected} swipes without buffering, then retreats`, () => {
    const c = client('a', [player('a')], true), me = bestiary(c).gremlin;
    const brain = new me.brain.constructor(); c.setRandom(random);
    const target = { team: 'p', state: 'idle', x: 300, y: 180 }, g = { fighters: [target] };
    me.x = 220; me.y = 180; me.state = 'idle'; me.hitstop = 0;
    const rush = brain.think(me, g); assert.equal(rush.mx, 1); assert.equal(rush.attack, null);
    me.x = 280;
    for (let i = 0; i < expected; i++) {
      me.state = 'idle';
      assert.equal(brain.think(me, g).attack, 'swipe');
      const remaining = brain.remaining;
      me.state = 'attack';
      for (let tick = 0; tick < 12; tick++) assert.equal(brain.think(me, g).attack, null);
      assert.equal(brain.remaining, remaining);
    }
    me.state = 'idle';
    const escape = brain.think(me, g);
    assert.equal(escape.attack, null); assert.equal(escape.mx, -1); assert.equal(brain.phase, 'retreat');
    const x = me.x; me.update(escape); assert.ok(me.x < x);
    for (let i = 0; i < 65 && brain.phase === 'retreat'; i++) me.update(brain.think(me, g));
    assert.equal(brain.phase, 'approach');
  });
}

test('ogres telegraph heavy punches/slams; interrupting a gremlin breaks its burst', () => {
  const c = client('a', [player('a')], true), enemies = bestiary(c);
  const g = { fighters: [{ team: 'p', state: 'idle', x: 300, y: 180 }] };
  const ogre = enemies.ogre; ogre.x = 265; ogre.y = 180; ogre.state = 'idle'; ogre.hitstop = 0;
  c.setRandom(0); ogre.brain.cd = 0;
  assert.equal(ogre.brain.think(ogre, g).attack, 'punch');
  assert.ok(ogre.brain.cd > 100);
  c.setRandom(0.99); ogre.brain.cd = 0;
  assert.equal(ogre.brain.think(ogre, g).attack, 'slam');
  assert.ok(ogre.def.attacks.slam.frames[0][1] > 25);
  assert.ok(ogre.def.attacks.slam.guardBreak);
  const gremlin = enemies.gremlin; gremlin.brain.phase = 'burst'; gremlin.brain.remaining = 2;
  gremlin.state = 'hurt'; gremlin.hitstop = 0;
  assert.equal(gremlin.brain.think(gremlin, g).attack, null);
  assert.equal(gremlin.brain.phase, 'retreat'); assert.equal(gremlin.brain.remaining, 0);
});

test('mixed AI kinds, burst phase, spawn rotation, and friendly fire survive host handoff', () => {
  const guests = [player('a'), player('b')], a = client('a', guests, true), enemies = bestiary(a);
  enemies.gremlin.brain.phase = 'retreat'; enemies.gremlin.brain.retreatTicks = 35;
  a.net.friendlyFireRequest = true; a.step();
  const b = client('b', guests); transfer(a, b); b.step();
  const gremlin = b.game.fighters.find(f => f.kind === 'gremlin');
  const ogre = b.game.fighters.find(f => f.kind === 'ogre');
  assert.equal(gremlin.brain.constructor.name, 'GremlinBrain');
  assert.equal(ogre.brain.constructor.name, 'OgreBrain');
  assert.equal(gremlin.brain.phase, 'retreat');
  const ticks = gremlin.brain.retreatTicks;
  b.net.isHost = true; b.step();
  assert.equal(gremlin.brain.phase, 'retreat'); assert.equal(gremlin.brain.retreatTicks, ticks - 1);
  assert.equal(b.game.spawnIndex, a.game.spawnIndex);
  assert.equal(b.game.friendlyFire, true);
});

test('friendly fire defaults off, enables knight damage, then disables it without resetting the arena', () => {
  const c = client('a', [player('a'), player('b')], true); c.net.enemyRequest = false; c.step(3);
  const a = c.game.player, b = c.game.fighters.find(f => f.id === 'b');
  const swing = () => {
    a.x = 104; a.y = 190; a.facing = 1; a.hitstop = 0;
    b.x = 128; b.y = 190; b.state = 'idle'; b.hitstop = 0;
    a.startAttack('slash'); a.fi = a.atk.active[0]; c.step();
  };
  swing(); assert.equal(b.hp, 100); assert.equal(c.game.friendlyFire, false);
  c.game.kills = 7;
  c.net.friendlyFireRequest = true; swing(); assert.equal(b.hp, 88);
  assert.equal(c.net.world.snapshot.friendlyFire, true); assert.equal(c.game.kills, 7);
  c.net.friendlyFireRequest = false; swing(); assert.equal(b.hp, 88);
  assert.equal(c.game.friendlyFire, false); assert.equal(c.game.kills, 7);
});

test('all new sprite poses and variants draw finite, unclipped pixels with valid colors', () => {
  let pixels = 0, activeCanvas;
  const ctx = { fillStyle: '', fillRect(...args) {
    assert.ok(args.every(Number.isFinite)); assert.equal(typeof this.fillStyle, 'string'); pixels++;
    const [x, y, w, h] = args;
    assert.ok(x >= 0 && y >= 0 && x + w <= activeCanvas.width && y + h <= activeCanvas.height,
      `clipped pixel: ${args} in ${activeCanvas.width}x${activeCanvas.height}`);
  } };
  const sandbox = { document: { createElement: () => ({ getContext() { activeCanvas = this; return ctx; } }) } };
  sandbox.window = sandbox; vm.createContext(sandbox);
  for (const file of ['characters.js', 'rig.js']) vm.runInContext(
    readFileSync(join(__dirname, '../versions/02/src', file), 'utf8'), sandbox);
  for (const kind of ['ogre', 'gremlin']) {
    const spec = sandbox.MS.CHARS[kind].spec;
    for (const pose of Object.keys(spec.poses)) for (const variant of ['', 'nohead', '+flash']) {
      sandbox.MS.Rig.frame(spec, pose, variant);
    }
  }
  assert.ok(pixels > 1000);
});

test('friendly fire permits player kills and respawns but does not enable enemy infighting', () => {
  const c = client('a', [player('a'), player('b')], true); c.net.enemyRequest = false; c.step(3);
  c.net.friendlyFireRequest = true; c.step();
  const a = c.game.player, b = c.game.fighters.find(f => f.id === 'b');
  a.x = 100; a.y = 190; a.facing = 1; a.hitstop = 0;
  b.x = 125; b.y = 190; b.hp = 5;
  a.startAttack('slash'); a.fi = a.atk.active[0]; c.step();
  assert.equal(b.state, 'dead'); assert.equal(c.game.kills, 0);
  c.net.guests[1].respawnSeq++; c.step();
  assert.equal(c.game.fighters.find(f => f.id === 'b').hp, 100);
  const ogre = new a.constructor('ogre', 350, 160, 1, { name: 'Ogre', team: 'e' });
  const troll = new a.constructor('troll', 380, 160, -1, { name: 'Troll', team: 'e' });
  ogre.id = 'ogre-test'; troll.id = 'troll-test';
  c.game.fighters.push(ogre, troll); ogre.startAttack('punch'); ogre.fi = ogre.atk.active[0]; c.step();
  assert.equal(troll.hp, troll.maxHp);
});

test('gremlin burst counts remain correct through real fighter animation updates', () => {
  for (const [random, expected] of [[0, 1], [0.4, 2], [0.99, 3]]) {
    const c = client('a', [player('a')], true), me = bestiary(c).gremlin;
    me.brain = new me.brain.constructor(); me.x = 280; me.y = 180;
    me.state = 'idle'; me.hitstop = 0; me.play('idle', true); c.setRandom(random);
    const g = { fighters: [{ team: 'p', state: 'idle', x: 300, y: 180 }] };
    let started = 0;
    for (let tick = 0; tick < 120; tick++) {
      const intent = me.brain.think(me, g), previous = me.state;
      me.update(intent);
      if (previous !== 'attack' && me.state === 'attack') started++;
      if (me.brain.phase === 'retreat') break;
    }
    assert.equal(started, expected); assert.equal(me.brain.phase, 'retreat');
  }
});
