// One public arena. Each guest owns only their input; the elected host owns combat.
(function () {
  const params = new URLSearchParams(location.search);
  const id = crypto.randomUUID();
  const status = document.getElementById('status');
  const roster = document.getElementById('roster');
  const N = window.MS.Net = {
    id, ready: false, offline: params.has('offline'), me: null, guests: [], world: null, corpses: null,
    commands: new MS.Sync.Commands(),
    host: () => N.ready && p5party.isHost(),
    players: () => N.guests.filter(g => typeof g.id === 'string' && g.protocol === 3),
    friendlyFireRequest: null,
    requestFriendlyFire(enabled) {
      if (N.ready) p5party.emit('set-friendly-fire', { enabled });
    },
    enemyRequest: null,
    requestEnemies(enabled) {
      if (N.ready) p5party.emit('set-enemies', { enabled });
    },
    input(it, respawn) {
      if (!N.ready) return;
      const command = N.commands.push(it);
      if (respawn) N.me.respawnSeq++;
      if (it.attack || respawn) N.flush(true);
      return command;
    },
    flush(force = false) {
      if (!N.ready) return;
      const now = performance.now();
      if (force || now - N.sent >= 33) {
        // A bounded rolling window survives batching without losing attack edges.
        // Every command represents exactly one fixed simulation tick.
        N.me.commands = N.commands.history.filter(c => c.seq > N.commands.acked);
        N.me.heartbeat = Date.now();
        N.me.isHost = N.host();
        N.sent = now;
      }
    },
    sent: 0,
  };
  if (N.offline) { status.textContent = 'Offline practice — add no query string to join everyone'; return; }
  let probe = null, lastPong = 0;
  const pingSeen = new Map();
  async function connect() {
    try {
      if (!window.p5party) throw new Error('p5.party could not load');
      // Keep incompatible older tabs from becoming host for this build.
      await p5party.connect('wss://demoserver.p5party.org', 'gschomburg_mmoonstones_v02', 'arena-bestiary-1');
      N.world = await p5party.loadShared('world', { snapshot: null });
      N.corpses = await p5party.loadShared('graveyard', { revision: null, fighters: [] });
      N.me = await p5party.loadMyShared({
        protocol: 3, id, name: 'Knight ' + id.slice(0, 4).toUpperCase(), commands: [],
        respawnSeq: 0, heartbeat: Date.now(), ping: null, pingAt: 0, isHost: false,
      });
      N.guests = p5party.loadGuestShareds();
      p5party.subscribe('set-enemies', data => {
        if (N.host() && typeof data?.enabled === 'boolean') N.enemyRequest = data.enabled;
      });
      p5party.subscribe('set-friendly-fire', data => {
        if (N.host() && typeof data?.enabled === 'boolean') N.friendlyFireRequest = data.enabled;
      });
      // p5.party delivers your own events locally! A different client must
      // echo the probe, or we'd mistakenly report a zero-millisecond ping.
      p5party.subscribe('ping', data => {
        if (data.target === id && data.id !== id) p5party.emit('pong', data);
      });
      p5party.subscribe('pong', data => {
        if (!probe || data.id !== id || data.seq !== probe.seq) return;
        N.me.ping = Math.round(performance.now() - probe.start);
        N.me.pingAt = Date.now();
        lastPong = performance.now();
        probe = null;
      });
      N.ready = true;
      lastPong = performance.now();
      setInterval(() => {
        const others = N.players().filter(g => g.id !== id);
        const peer = others.find(g => g.isHost) || others[0];
        if (!peer) { N.me.ping = null; probe = null; lastPong = performance.now(); return; }
        if (!probe || performance.now() - probe.start > 4000) {
          probe = { seq: crypto.randomUUID(), start: performance.now() };
          p5party.emit('ping', { id, seq: probe.seq, target: peer.id });
        }
      }, 1500);
    } catch (error) {
      status.textContent = 'Connection failed: ' + error.message + ' — reload to retry, or use ?offline';
    }
  }
  setInterval(() => {
    if (!N.ready) return;
    const stale = performance.now() - lastPong > 6000;
    status.textContent = stale ? 'Connection stalled — waiting for server…' :
      'Shared arena · ' + N.players().length + ' players · ' + (N.host() ? 'you host combat' : 'guest') + ' · ping = host RTT (host probes a peer)';
    roster.replaceChildren(...N.players().map(g => {
      const row = document.createElement('span'); row.className = 'player';
      let seen = pingSeen.get(g.id);
      if (!seen || seen.stamp !== g.pingAt) {
        seen = { stamp: g.pingAt, at: performance.now() }; pingSeen.set(g.id, seen);
      }
      const ping = performance.now() - seen.at < 6000 && Number.isFinite(g.ping) ? g.ping + ' ms' : N.players().length === 1 ? 'waiting for peer' : '…';
      row.textContent = g.name + (g.id === id ? ' (you)' : '') + '  ' + ping;
      row.style.color = ping === '…' ? '#807898' : g.ping > 200 ? '#ff9870' : '#9ad070';
      return row;
    }));
  }, 500);
  connect();
})();
