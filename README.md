# MMOonstones

Moonstone-inspired combat prototype.

## Play locally

From this directory, run:

```sh
python3 -m http.server 8000
```

- Multiplayer: http://localhost:8000/versions/02/?v=bestiary-2
- Offline practice: http://localhost:8000/versions/02/?offline
- Original single-player prototype (unchanged): http://localhost:8000/versions/01/

Open multiplayer in two browsers/tabs, or serve the same files over HTTPS to
friends. Everyone running the current version 02 build joins the **same public arena**, including
players using different web hosts. Internet access is required for p5.party and
its demo server. This is a public prototype, not a private or secured game.

## Multiplayer version 02

- p5.party 0.16.0, vanilla JavaScript API; no p5.js or build step needed.
- One room, co-op knights. Enemies chase the nearest living knight.
- **Friendly fire: ON/OFF** above the canvas lets knights hurt and kill each other.
  It defaults off. Anyone can change it for the whole room, without resetting
  the game. Normal blocking/guard breaks still apply; enemies never hurt allies.
- Up to eight living enemies, scaling with the player count; defeated bodies pile
  up (oldest corpses are removed after 300 to bound the shared state).
- Enemies spawn one at a time, two seconds apart, until the living-enemy target
  (`2 + player count`, capped at eight) is reached. Re-enabling enemies spawns
  one immediately. The shared cooldown also applies to replacements and survives
  host handoff; kills cannot trigger a separate burst of replacements.
- The spawn mix repeats **troll, gremlin, ogre, gremlin**. Trolls retain their
  club attacks. Ogres are taller, slower, and tougher (180 HP), with oversized
  fists, a telegraphed punch, and a heavier guard-breaking overhead slam.
- Gremlins are small, fast (2.2 px/tick), and fragile (20 HP). They close quickly,
  choose a burst of 1–3 rapid claw swipes, then retreat for roughly a second
  before closing again. Getting interrupted breaks the burst. AI phases,
  remaining swipes, and spawn rotation survive host handoff.
- Press **R** after dying to respawn yourself, without resetting anyone else.
- **Enemies: ON/OFF** above the canvas toggles monsters for the whole arena. Anyone
  can use it. Turning it off removes living enemies immediately and stops spawning,
  keeping existing corpses and the kill count. Turning it back on resumes spawning.
- Every player's live ping appears above the canvas. Each guest measures a probe
  to the host and back through the server; the host probes another guest instead.
  These are **application-level peer round-trip times**, not one-way latency or
  server-only ping. They include relay and client scheduling time. Alone, the
  roster says “waiting for peer”; missing replies expire after six seconds.
- The elected p5.party host simulates combat at 60 Hz, publishing snapshots at
  up to 20 Hz. Each client generates a numbered input command per simulation tick;
  unacknowledged commands are batched at up to 30 Hz, with attacks sent immediately.
  The host consumes commands once and acknowledges their sequence in snapshots.
- Guests immediately predict their own movement, blocking, and attack animation.
  When a snapshot arrives, they restore host state and replay only unacknowledged
  inputs. Small position corrections ease out over approximately 80 ms. Damage,
  hit detection, separation, kills, and respawns remain host-authoritative.
- Other fighters render from a 100 ms interpolation buffer using host simulation
  ticks (no synchronized clocks needed). Visual animations advance between
  snapshots. If packets stop, remote fighters freeze rather than extrapolating
  indefinitely; the buffer holds at most 32 snapshots.
- Shared records: `world.snapshot` contains active/moving fighters and room state;
  `graveyard` contains settled non-player corpses, updated only when membership
  changes. Bodies still falling, moving, or spurting blood stay in the active
  snapshot. Each player's `myShared` contains their command batch and ping/identity.
- The dummy's latest 16 numbered hits travel with its totals in the world snapshot.
  Guests play each new hit's wobble, flash, straw, sound, and damage popup once;
  late arrivals start at the current total without replaying historical hits.
- New arrivals get the current arena, kills, and corpses. On host departure,
  p5.party elects a successor who resumes the latest snapshot, including AI,
  animation, and already-hit targets. The room persists until the demo server
  clears its data; it is not durable storage.

The bestiary build uses protocol 3 and the shared room `arena-bestiary-1`, isolated
from older builds that cannot render the new character types. Reload using
http://localhost:8000/versions/02/?v=bestiary-2 to bypass a cached page. Character,
rig, sync, network, and game scripts have matching cache-busting tags. Old rooms are left untouched;
their arena state is not migrated. `GAME.networkStats()` exposes pending inputs,
buffered snapshots, position correction, and active/archive counts in the console.

### Prototype limitations

There is no server rewind/lag compensation: damage can still arrive late, and
collisions, knockback, or very long network stalls can cause corrections. Input
history is bounded to two seconds. Remote interpolation intentionally adds 100 ms
of visual delay in exchange for smooth movement. Blood, sounds,
and detached-head motion are local cosmetic effects; late arrivals see existing
bodies but not all historical blood decals. Background hosting uses a timer,
but browsers can still throttle/suspend tabs: keep the host visible for best
results. The demo server has no authentication or anti-cheat protections.

The original combat controls and implementation notes are in [docs/README.md](docs/README.md).

Run the multiplayer logic regression tests (Node.js, no dependencies):

```sh
node --test tools/multiplayer.test.cjs
```
