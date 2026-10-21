// Kitchen Table — connections between players and phones.
//
// Every device keeps an ordinary secure web connection (a WebSocket) to two free public MQTT relay servers
// and sends small encrypted messages through them. Nothing connects device-to-device, so it works on mobile
// data and strict Wi-Fi alike. One player's browser hosts the game; if it goes away, the next player
// (in an order everyone agrees on) takes over within seconds.
(function (root) {
  'use strict';
  const enc = new TextEncoder();

  // ======================= small helpers =======================
  async function sha(str) { const b = await crypto.subtle.digest('SHA-256', enc.encode(str)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  function rid(n) { const a = new Uint8Array(n || 16); crypto.getRandomValues(a); const c = 'abcdefghijkmnpqrstuvwxyz23456789'; return [...a].map(x => c[x % c.length]).join(''); }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'; }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function sitePath() { return location.pathname.replace(/index\.html?$/i, ''); }   // /index.html and / are the same site
  function baseFor(table) { return 'kt2-' + hash(location.host + sitePath()) + '-' + slug(table); }
  const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = str => Uint8Array.from(atob(str), ch => ch.charCodeAt(0));
  // JSON with sorted keys, so the same game always produces the same text (for signed checkpoints).
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const okImg = v => typeof v === 'string' && v.length < 400000 && IMG_RE.test(v);
  // Sleeve / playmat / colors for a seat. Only pictures embedded in the message itself are allowed.
  function cleanLook(v) {
    if (!v || typeof v !== 'object') return null;
    return { sleeve: okImg(v.sleeve) ? v.sleeve : null, mat: okImg(v.mat) ? v.mat : null, palette: typeof v.palette === 'string' ? v.palette.slice(0, 20) : 'felt' };
  }
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const lstore = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  // ======================= identity =======================
  // Each player has a private signing key that never leaves their browser. Their seat id is a hash of the
  // public half, and the host checks a signature when they join, so nobody can pretend to be someone else.
  const ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIG = { name: 'ECDSA', hash: 'SHA-256' };
  const pidOf = async pub => 'p' + (await sha(pub.x + '.' + pub.y)).slice(0, 15);
  async function makeIdentity(stored) {
    let jwk = stored && stored.priv && stored.pub ? stored : null;
    if (!jwk) {
      const kp = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
      jwk = { priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: await crypto.subtle.exportKey('jwk', kp.publicKey) };
    }
    const privKey = await crypto.subtle.importKey('jwk', jwk.priv, ALG, false, ['sign']);
    const pub = { x: jwk.pub.x, y: jwk.pub.y };
    return { jwk, pid: await pidOf(pub), pub, async sign(text) { return b64(await crypto.subtle.sign(SIG, privKey, enc.encode(text))); } };
  }
  async function verifySig(pub, sig, text) {
    try {
      if (!pub || typeof pub.x !== 'string' || typeof pub.y !== 'string' || typeof sig !== 'string') return false;
      const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y, ext: true }, ALG, false, ['verify']);
      return await crypto.subtle.verify(SIG, key, unb64(sig), enc.encode(text));
    } catch (e) { return false; }
  }
  async function verifyHello(m, nonce) {
    try { return !!m.pub && (await pidOf(m.pub)) === m.pid && await verifySig(m.pub, m.sig, nonce); } catch (e) { return false; }
  }
  async function phoneIdFor(table, secret) { return baseFor(table) + '-ph-' + (await sha('phone:' + secret)).slice(0, 24); }
  // A 3-digit code shown on both the phone and the computer, so you can tell which phone you're approving.
  async function phoneCode(dev, addr) { return String(parseInt((await sha(dev + '|' + addr)).slice(0, 8), 16) % 900 + 100); }

  // ======================= relay servers (MQTT over WebSocket) =======================
  // Every device keeps a secure WebSocket to two free public MQTT servers and sends every message through
  // both, so if one server goes down mid-game nothing breaks. Each address is a "topic" that only its owner
  // listens to. (This replaced the free PeerJS server, which stopped accepting connections.)
  const BROKERS = root.KT_BROKERS || ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
  const WANT = Math.min(2, BROKERS.length), TOPIC = 'ktmq1/', PROBE_MS = root.KT_PROBE_MS || 1500;
  const te = new TextEncoder(), td = new TextDecoder();
  const u16 = n => [n >> 8 & 255, n & 255];
  const mstr = s => { const b = te.encode(s); return [...u16(b.length), ...b]; };
  function packet(head, body) {
    const len = []; let n = body.length;
    do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0);
    const out = new Uint8Array(1 + len.length + body.length); out[0] = head; out.set(len, 1); out.set(body, 1 + len.length); return out;
  }

  class Broker {
    constructor(url, idx, hub) { this.url = url; this.idx = idx; this.hub = hub; this.state = 'idle'; this.nextTry = 0; this.fails = 0; this.pid = 1; }
    start() {
      this.state = 'connecting'; this.buf = new Uint8Array(0);
      let ws; try { ws = new WebSocket(this.url, 'mqtt'); } catch (e) { return this.fail(); }
      ws.binaryType = 'arraybuffer'; this.ws = ws;
      this.to = setTimeout(() => { if (this.ws === ws && this.state === 'connecting') { try { ws.close(); } catch (e) {} this.fail(); } }, 8000);
      ws.onopen = () => {
        const body = [...mstr('MQTT'), 4, 0x02, ...u16(30), ...mstr('kt' + rid(16))];
        this.raw(packet(0x10, body));
      };
      ws.onmessage = ev => { if (this.ws === ws) this.feed(new Uint8Array(ev.data)); };
      ws.onclose = () => { if (this.ws === ws) this.fail(); };
      ws.onerror = () => {};
    }
    fail() {
      const was = this.state === 'up';
      clearTimeout(this.to); clearInterval(this.ping);
      if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch (e) {} }
      this.state = 'idle'; this.fails++;
      this.nextTry = Date.now() + Math.min(20000, 1000 * Math.pow(2, Math.min(this.fails, 5)));
      if (was) this.hub.brokerDown(this);
      this.hub.ensure();
    }
    raw(bytes) { try { this.ws.send(bytes); } catch (e) {} }
    feed(chunk) {
      const b = new Uint8Array(this.buf.length + chunk.length); b.set(this.buf); b.set(chunk, this.buf.length); this.buf = b;
      for (;;) {
        if (this.buf.length < 2) return;
        let mult = 1, len = 0, i = 1, d;
        do { if (i >= this.buf.length) return; d = this.buf[i++]; len += (d & 127) * mult; mult *= 128; } while (d & 128 && i < 5);
        if (this.buf.length < i + len) return;
        const head = this.buf[0], body = this.buf.subarray(i, i + len);
        this.buf = this.buf.slice(i + len);
        this.packet(head, body);
      }
    }
    packet(head, body) {
      const type = head >> 4;
      if (type === 2) {                                             // CONNACK
        if (body[1] !== 0) return this.fail();
        clearTimeout(this.to); this.state = 'up'; this.fails = 0;
        clearInterval(this.ping); this.ping = setInterval(() => this.raw(new Uint8Array([0xC0, 0])), 15000);
        this.hub.brokerUp(this);
      } else if (type === 3) {                                      // PUBLISH
        const tl = body[0] << 8 | body[1];
        const topic = td.decode(body.subarray(2, 2 + tl));
        let p = 2 + tl; if ((head >> 1) & 3) p += 2;
        let m; try { m = JSON.parse(td.decode(body.subarray(p))); } catch (e) { return; }
        this.hub.deliver(this, topic, m);
      }
    }
    sub(topic) { if (this.state === 'up') this.raw(packet(0x82, [...u16(this.nextPid()), ...mstr(topic), 0])); }
    unsub(topic) { if (this.state === 'up') this.raw(packet(0xA2, [...u16(this.nextPid()), ...mstr(topic)])); }
    pub(topic, obj) { if (this.state === 'up') this.raw(packet(0x30, [...mstr(topic), ...te.encode(JSON.stringify(obj))])); }
    nextPid() { this.pid = this.pid % 65000 + 1; return this.pid; }
  }

  const hub = {
    brokers: null, topics: new Map(),
    init() { if (this.brokers) return; this.brokers = BROKERS.map((u, i) => new Broker(u, i, this)); this.ensure(); setInterval(() => this.ensure(), 2000); },
    up() { return this.brokers ? this.brokers.filter(b => b.state === 'up') : []; },
    // Keep two servers going, preferring the ones earlier in the list (so every device shares at least one).
    ensure() {
      if (!this.brokers) return;
      let live = this.brokers.filter(b => b.state !== 'idle').length;
      const now = Date.now();
      for (const b of this.brokers) { if (live >= WANT) break; if (b.state === 'idle' && b.nextTry <= now) { b.start(); live++; } }
      // Everything failing for a while: try every server again.
      if (!live && this.brokers.every(b => b.nextTry > now)) for (const b of this.brokers) b.nextTry = 0;
    },
    wake() { if (!this.brokers) return; for (const b of this.brokers) if (b.state === 'idle') b.nextTry = 0; this.ensure(); },
    brokerUp(b) { for (const [t, s] of this.topics) { b.sub(t); s.brokerUp(b); } },
    brokerDown(b) { for (const s of this.topics.values()) s.brokerDown(b); },
    deliver(b, topic, m) { const s = this.topics.get(topic); if (s) s.input(b, m); },
    sub(topic, sig) { this.init(); this.topics.set(topic, sig); for (const b of this.up()) { b.sub(topic); sig.brokerUp(b); } },
    unsub(topic, sig) { if (this.topics.get(topic) !== sig) return; this.topics.delete(topic); for (const b of this.up()) b.unsub(topic); },
    pub(topic, m) { for (const b of this.up()) b.pub(topic, m); }
  };
  addEventListener('online', () => hub.wake());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) hub.wake(); });

  // ======================= Sig: one address on the relay =======================
  // An address is claimed by asking "anyone here?" on it; if another browser already holds it, that browser
  // answers and we get "taken" (the same as the old server's ID-TAKEN). Messages carry the sender's address.
  class Sig {
    constructor(id, handlers, token) {
      this.id = id; this.token = token || rid(12); this.cid = rid(12);
      this.h = handlers || {};
      this.connected = false; this.everOpen = false; this.closed = false; this.taken = false;
      this.queue = []; this.downSince = 0; this.probes = new Map();
      this.topic = TOPIC + id;
      hub.sub(this.topic, this);
    }
    brokerUp(b) {
      if (this.closed || this.probes.has(b)) return;
      b.pub(this.topic, { k: 'probe', c: this.cid });
      this.probes.set(b, setTimeout(() => {
        if (this.closed || this.taken || this.connected || b.state !== 'up') return;
        this.connected = true; this.downSince = 0;
        const first = !this.everOpen; this.everOpen = true;
        for (const m of this.queue.splice(0)) this.send(m);
        if (this.h.open) this.h.open(first);
      }, PROBE_MS));
    }
    brokerDown(b) {
      clearTimeout(this.probes.get(b)); this.probes.delete(b);
      if (hub.up().length || !this.connected) return;
      this.connected = false; this.downSince = Date.now();
      if (this.h.down) this.h.down();
    }
    input(b, m) {
      if (this.closed || !m || typeof m !== 'object') return;
      if (m.k === 'probe') {
        if (m.c === this.cid || typeof m.c !== 'string') return;
        // We hold this address (or we're claiming it at the same moment and win the tie): tell them.
        if (this.connected || this.cid < m.c) hub.pub(this.topic, { k: 'taken', to: m.c });
        return;
      }
      if (m.k === 'taken') { if (m.to === this.cid && !this.connected) this.lose(); return; }
      if (m.k === 'm' && typeof m.s === 'string' && this.h.message) this.h.message({ type: 'CANDIDATE', src: m.s, payload: m.p });
    }
    lose() { this.taken = true; this.close(); if (this.h.taken) this.h.taken(); }
    wake() { hub.wake(); }
    send(m) {
      if (!this.connected) { if (this.queue.length < 300) this.queue.push(m); return; }
      if (m && m.dst) hub.pub(TOPIC + m.dst, { k: 'm', s: this.id, p: m.payload });
    }
    close() { this.closed = true; this.connected = false; for (const t of this.probes.values()) clearTimeout(t); this.probes.clear(); hub.unsub(this.topic, this); }
  }

  // ======================= Relay: encrypted, compressed, ordered messages over a Sig =======================
  const RELAY = 'ktr2', CHUNK = 24000;
  async function keyFrom(label) { return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(label)), 'AES-GCM', false, ['encrypt', 'decrypt']); }
  const canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  async function zip(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
  async function unzip(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }

  class Relay {
    constructor(key, onMsg, onChunk) { this.key = key; this.onMsg = onMsg; this.onChunk = onChunk; this.parts = new Map(); this.perSrc = new Map(); this.seq = 0; this.outQ = Promise.resolve(); this.inQ = Promise.resolve(); this.caps = new Map(); this.done = new Map(); }
    input(sig, m) {
      const p = m.payload;
      if (!p || p.k !== RELAY) return;
      const src = m.src;
      if (p.zc !== undefined) this.caps.set(src, !!p.zc);
      if (this.onChunk) this.onChunk(src);
      this.inQ = this.inQ.then(() => this.receive(sig, src, p)).catch(() => {});
    }
    send(sig, dst, msg) {
      this.outQ = this.outQ.then(() => this.sendNow(sig, dst, msg)).catch(() => {});
      return this.outQ;
    }
    async sendNow(sig, dst, msg) {
      if (!sig || sig.closed || !dst) return;
      let bytes = enc.encode(JSON.stringify(msg)), z = 0;
      if (canZip && this.caps.get(dst) && bytes.length > 600) { bytes = await zip(bytes); z = 1; }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const body = b64(iv) + '.' + b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, bytes));
      const id = (++this.seq).toString(36) + rid(4);
      const n = Math.ceil(body.length / CHUNK) || 1;
      for (let i = 0; i < n; i++) sig.send({ type: 'CANDIDATE', dst, payload: { k: RELAY, id, i, n, z, zc: canZip ? 1 : 0, d: body.slice(i * CHUNK, (i + 1) * CHUNK) } });
    }
    async receive(sig, src, p) {
      if (typeof p.d !== 'string' || p.d.length > CHUNK || !(p.n >= 1 && p.n <= 120) || !(p.i >= 0 && p.i < p.n)) return;
      const key = src + '|' + p.id;
      if (this.done.has(key)) return;                           // the same message also came via the other server
      let e = this.parts.get(key);
      if (!e) {
        if ((this.perSrc.get(src) || 0) >= 20) return;          // one sender can't fill our memory with half-sent messages
        e = { got: 0, arr: new Array(p.n), t: Date.now(), src }; this.parts.set(key, e);
        this.perSrc.set(src, (this.perSrc.get(src) || 0) + 1);
      }
      if (e.arr[p.i] === undefined) { e.arr[p.i] = p.d; e.got++; }
      if (e.got < p.n) { this.sweep(); return; }
      this.drop(key, e);
      this.done.set(key, Date.now());
      if (this.done.size > 3000) { const cut = Date.now() - 120000; for (const [k, t] of this.done) if (t < cut) this.done.delete(k); }
      const [ivs, cts] = e.arr.join('').split('.');
      let bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivs) }, this.key, unb64(cts)));
      if (p.z) bytes = await unzip(bytes);
      this.onMsg(sig, src, JSON.parse(new TextDecoder().decode(bytes)));
    }
    drop(key, e) { this.parts.delete(key); this.perSrc.set(e.src, Math.max(0, (this.perSrc.get(e.src) || 1) - 1)); }
    sweep() { const now = Date.now(); for (const [k, e] of this.parts) if (now - e.t > 30000) this.drop(k, e); }
  }

  // ======================= the table =======================
  // Addresses: every device has its own address (kept across page reloads). The host also holds the table's
  // well-known "front doors" (<table>-host and, after a takeover, <table>-host2), which only answer newcomers
  // with "the host is at X". The host shares everyone's addresses, so if it vanishes the players agree on the
  // next host (lowest seat id first). If two hosts ever exist, they compare and the weaker one hands its
  // players to the stronger one. The host signs checkpoints of the game, so a takeover can only resume from a
  // copy the old host really sent.
  const HB = 2500, SILENT = 9000;
  class Table {
    constructor(opts) {
      this.table = opts.table; this.identity = opts.identity; this.pid = opts.identity.pid; this.name = opts.name;
      this.base = baseFor(this.table);
      this.doors = [this.base + '-host', this.base + '-host2'];
      this.onState = opts.onState || (() => {});
      this.onStatus = opts.onStatus || (() => {});
      this.onSleeve = opts.onSleeve || (() => {});
      this.onReplaced = opts.onReplaced || (() => {});
      this.onStepDown = opts.onStepDown;
      this.state = opts.snapshot || null;
      this.roster = (opts.roster || []).filter(r => Array.isArray(r) && r.length === 2);
      this.saveRoster = opts.saveRoster || (() => {});
      this.sleeves = {}; this.imgVer = {}; this.imgAsked = {};
      this.mySleeve = null;
      this.isHost = false; this.hostAddr = null; this.hostPub = null; this.prevHostPub = null;
      this.doorSigs = [null, null];
      this.clients = new Map();   // host: address -> { pid, lastSeen, nonce, checking, lim }
      this.pending = new Map(); this.ridN = 0;
      this.status = 'connecting';
      this.closed = false;
      this.epoch = null; this.seq = 0;
      this.heard = 0; this.hostMissing = 0;
      this.tries = [];
      this.resQ = [];
      this.lastTick = Date.now();
    }

    setStatus(s, msg) { this.status = s; this.onStatus(s, msg); }
    dbg(...a) { if (root.KT_DEBUG) console.log('[kt]', this.pid.slice(0, 5), ...a); }

    async start() {
      this.relay = new Relay(await keyFrom('kt-table:' + this.base), (sig, src, m) => this.got(sig, src, m), src => { if (src === this.hostAddr || src === this.trying) { this.heard = Date.now(); this.hostMissing = 0; } });
      // Same address after a reload (this tab only), so a reloading host or player picks up where they were.
      const saved = store.get('kt:addr:' + this.base);
      this.connect(saved && saved.a && saved.a.startsWith(this.base) ? saved : null);
      setInterval(() => this.tick(), HB);
    }
    connect(saved) {
      this.addr = saved ? saved.a : this.base + '-' + rid(10);
      const s = new Sig(this.addr, {
        open: () => this.onMainOpen(),
        message: m => this.relay.input(s, m),
        expire: src => this.expired(src),
        down: () => { if (!this.isHost) this.setStatus('offline', 'Reconnecting…'); },
        taken: () => { store.set('kt:addr:' + this.base, null); this.connect(null); }   // e.g. a duplicated tab
      }, saved ? saved.t : null);
      this.main = s;
      store.set('kt:addr:' + this.base, { a: this.addr, t: s.token });
    }

    onMainOpen() {
      if (this.isHost) {
        // Back from a network outage: if we were cut off long enough for others to take over, step down.
        if (this.wasDownFor > 6000) { this.wasDownFor = 0; return this.stepDown(); }
        this.setStatus('host');
        return;
      }
      if (this.synced && this.hostAddr) { this.setStatus('connected'); this.send(this.hostAddr, { t: 'ping' }); return; }
      this.findTable();
    }

    send(dst, m) { return this.relay.send(this.main, dst, m); }

    // ---------- finding the table ----------
    // Try to open the front door: free means we're first here and host; taken means knock (on both doors).
    findTable() {
      if (this.isHost || this.closed) return;
      this.setStatus('connecting', 'Looking for the table…');
      this.hostAddr = null; this.synced = false;
      this.tries = [];
      // Coming back to a game we were in (e.g. after a reload)? Look for the players we were with first —
      // the front door might have been grabbed by someone new during a takeover.
      if (!this.rosterTried && this.state && this.roster.some(([p]) => p !== this.pid)) {
        this.rosterTried = true;
        this.tries = this.candidates(null).filter(([p]) => p !== this.pid);
        return this.nextCandidate();
      }
      this.trying = 'door'; this.tryAt = Date.now();
      this.claimDoor(0, () => this.knock());
    }
    knock() {
      if (this.isHost) return;
      this.trying = 'door'; this.tryAt = Date.now();
      for (const d of this.doors) this.send(d, { t: 'join' });
    }
    joinVia(addr) {
      this.dbg('join ->', addr.slice(-6));
      this.trying = addr; this.tryAt = Date.now();
      this.send(addr, { t: 'join' });
    }
    expired(src) {
      if (this.isHost) { if (this.clients.has(src)) this.dropClient(src); return; }
      // The host may just be reloading: give it a few seconds before taking over.
      if (src === this.hostAddr && this.synced) { if (!this.hostMissing) this.hostMissing = Date.now(); return; }
      if (src === this.doors[0] && this.trying === 'door') return this.findTable();
      if (src === this.trying) this.nextCandidate();
    }
    claimDoor(i, onTaken) {
      if (this.doorSigs[i] || this.closed) return;
      const s = new Sig(this.doors[i], {
        open: () => { this.doorSigs[i] = s; if (!this.isHost) this.becomeHost(); },
        message: m => this.relay.input(s, m),
        taken: () => {
          if (this.doorSigs[i] === s) this.doorSigs[i] = null;
          if (this.isHost) this.challenge(i);
          else if (onTaken) onTaken();
        }
      });
      this.doorSigs[i] = s;
    }
    candidates(excl) { return this.roster.filter(([, addr]) => addr !== excl).sort((a, b) => a[0] < b[0] ? -1 : 1); }
    failover() {
      if (this.isHost || this.closed) return;
      const dead = this.hostAddr;
      this.dbg('failover', dead && dead.slice(-4));
      if (this.hostPub) this.prevHostPub = this.hostPub;
      this.synced = false; this.hostAddr = null; this.hostMissing = 0;
      this.setStatus('connecting', 'The host left — reconnecting…');
      this.tries = this.candidates(dead);
      if (!this.tries.length) return this.findTable();
      this.nextCandidate();
    }
    nextCandidate() {
      if (this.isHost) return;
      const next = this.tries.shift();
      if (!next) return this.findTable();
      const [pid, addr] = next;
      if (pid === this.pid) return this.takeOver();
      this.joinVia(addr);
    }

    // ---------- host ----------
    becomeHost() {
      if (this.isHost) return;
      this.dbg('becomeHost');
      if (!this.prevHostPub && this.hostPub) this.prevHostPub = this.hostPub;
      this.isHost = true; this.hostAddr = this.addr; this.trying = null;
      this.epoch = rid(6); this.seq = 0; this.sent = null;
      this.hostSince = Date.now(); this.lastClientAt = Date.now();
      if (!this.state) this.state = Rules.newState();
      this.startRev = this.state.rev;
      for (const id of Object.keys(this.state.players)) this.state.players[id].online = id === this.pid;
      this.clients.clear();
      if (this.mySleeve) this.setImg(this.pid, this.mySleeve);
      this.setStatus('host');
      // Moves we'd sent to the old host but never heard back about: apply them here (each has an id, so one
      // the old host already applied — and that reached us — won't happen twice).
      for (const [id, p] of [...this.pending]) {
        this.pending.delete(id);
        const r = Rules.apply(this.state, this.pid, p.a);
        p.res(Object.assign({ rejected: !r.ok }, r));
      }
      this.publish();
    }
    takeOver() {
      this.becomeHost();
      // Open both front doors as soon as the relay lets go of them (the first one may still be held by the old host).
      this.doorWait = 3000;
      const tryDoors = () => {
        if (!this.isHost || this.closed) return;
        if (!this.doorSigs[0]) this.claimDoor(0);
        if (!this.doorSigs[1]) this.claimDoor(1);
        if (!this.doorSigs[0]) { this.doorWait = Math.min(15000, this.doorWait * 1.5); this.doorTimer = setTimeout(tryDoors, this.doorWait); }
      };
      clearTimeout(this.doorTimer); tryDoors();
    }
    stepDown(to) {
      this.dbg('stepDown', to ? 'to ' + to.slice(-4) : '');
      this.isHost = false;
      if (this.onStepDown && !to) this.onStepDown();
      for (let i = 0; i < 2; i++) if (this.doorSigs[i]) { this.doorSigs[i].close(); this.doorSigs[i] = null; }
      clearTimeout(this.doorTimer);
      if (to) {
        // Hand our players to the stronger host, then join it ourselves.
        for (const [src, c] of this.clients) if (c.pid) this.send(src, { t: 'goto', addr: to });
        this.clients.clear();
        this.synced = false; this.tries = []; this.hostAddr = null;
        this.setStatus('connecting', 'Joining the main table…');
        return this.joinVia(to);
      }
      this.clients.clear();
      this.failover();
    }
    // A table with a game on it (cards out) is "real"; a brand-new empty table always gives way to a real one.
    trivial() { return !this.state || (Object.keys(this.state.cards).length === 0 && this.state.seats.length <= 1); }
    // Someone else holds a front door while we host: ask who, and the weaker side moves over.
    challenge(i) {
      if (Date.now() - (this.lastChallenge || 0) < 2000) return;
      this.lastChallenge = Date.now();
      this.send(this.doors[i], { t: 'who' });
    }
    setImg(pid, look) {
      const v = cleanLook(look);
      const json = JSON.stringify(v);
      this.imgJSON = this.imgJSON || {};
      if (this.imgJSON[pid] === json) return false;
      this.imgJSON[pid] = json;
      this.sleeves[pid] = v;
      this.imgVer[pid] = (this.imgVer[pid] || 0) + 1;
      this.onSleeve(pid, v);
      return true;
    }
    srcOf(pid) { for (const [src, c] of this.clients) if (c.pid === pid) return src; return null; }
    dropClient(src) {
      const c = this.clients.get(src);
      if (!c) return;
      this.clients.delete(src);
      if (c.pid && this.state.players[c.pid] && !this.srcOf(c.pid)) { this.state.players[c.pid].online = false; this.publish(); }
    }
    limited(c, kind, ms) { c.lim = c.lim || {}; const now = Date.now(); if (now - (c.lim[kind] || 0) < ms) return true; c.lim[kind] = now; return false; }
    iam() { return { t: 'iam', addr: this.addr, trivial: this.trivial() }; }

    async hostGot(sig, src, m) {
      if (this.clients.has(src)) this.lastClientMsg = Date.now();
      // The front doors only point newcomers to the host — and only while this browser is really running.
      const di = this.doorSigs.indexOf(sig);
      if (di >= 0 && sig !== this.main) {
        if (Date.now() - this.lastTick > 6000) return;          // frozen/asleep: don't hand out a dead address
        if (m.t === 'join') this.relay.send(sig, src, { t: 'goto', addr: this.addr });
        if (m.t === 'who') this.relay.send(sig, src, this.iam());
        return;
      }
      // Two hosts found each other. The one holding the front door keeps the table — unless its own table is
      // still empty, in which case it joins the other. Claims from others are never trusted beyond that.
      if (m.t === 'who') return;
      if (m.t === 'iam') {
        const a = String(m.addr || '');
        if (!a.startsWith(this.base) || a === this.addr) return;
        if (this.doors.includes(src)) {
          // The front-door holder answered our "who": we took over without the door, so we move over to it,
          // unless the door holder says its table is empty and ours has a game — then it should come to us.
          if (m.trivial && !this.trivial()) { if (!this.limited(this, 'iam', 1500)) this.send(a, { t: 'iam', addr: this.addr, trivial: false }); return; }
          return this.stepDown(a);
        }
        // Someone without the door says they have a real game: we only give way if OUR table is actually empty.
        if (this.doorSigs[0] && this.trivial() && m.trivial === false) return this.stepDown(a);
        return;
      }
      let c = this.clients.get(src);
      if (m.t === 'join') {
        if (c && (c.pid || c.checking)) { c.lastSeen = Date.now(); if (c.pid && !this.limited(c, 'join', 2000)) this.sendState(src); return; }
        const nonce = rid(16) + Date.now();
        this.clients.set(src, c = { pid: null, nonce, lastSeen: Date.now() });
        return this.send(src, { t: 'nonce', n: nonce, hpub: this.identity.pub });
      }
      if (!c) return this.send(src, { t: 'rejoin' });
      c.lastSeen = Date.now();
      if (m.t === 'hello') {
        if (c.pid || c.checking) return;
        c.checking = true;
        const claimed = String(m.pid || '').slice(0, 40);
        const good = claimed !== this.pid && await verifyHello(m, c.nonce);
        c.checking = false;
        if (!good) { this.clients.delete(src); return this.send(src, { t: 'denied', same: claimed === this.pid ? 1 : 0 }); }
        for (const [osrc, oc] of [...this.clients]) if (osrc !== src && oc.pid === claimed) { this.clients.delete(osrc); this.send(osrc, { t: 'replaced' }); }
        c.pid = claimed;
        if (this.state.players[claimed]) this.state.players[claimed].online = true;
        await this.maybeResume(claimed, m.ck);
        if (m.look) this.setImg(claimed, m.look);
        this.sendState(src);
        this.publish();
        return;
      }
      if (!c.pid) return this.send(src, { t: 'rejoin' });
      if (m.t === 'act') {
        const r = Rules.apply(this.state, c.pid, m.a);
        if (r.ok) { this.resQ.push([src, { t: 'res', rid: m.rid, ok: true }]); this.publish(); }
        else this.send(src, { t: 'res', rid: m.rid, ok: false, err: r.err });
      } else if (m.t === 'look') {
        if (!this.limited(c, 'look', 1500)) this.setImg(c.pid, m.look);
      } else if (m.t === 'img') {
        const pid = String(m.pid || '');
        if (this.sleeves[pid] && !this.limited(c, 'img:' + pid, 4000)) this.send(src, { t: 'img', pid, look: this.sleeves[pid], ver: this.imgVer[pid] });
      } else if (m.t === 'resync') {
        if (!this.limited(c, 'resync', 2000)) this.sendState(src);
      }
    }
    // Right after a takeover, a player may hold a newer copy of the game — but only one the previous host signed.
    async maybeResume(pid, ck) {
      if (!ck || typeof ck !== 'object' || typeof ck.json !== 'string' || ck.json.length > 3e6) return;
      if (Date.now() - this.hostSince > 15000 || this.state.rev !== this.startRev || !this.state.players[pid]) return;
      if (!this.prevHostPub || canon(ck.hpub) !== canon(this.prevHostPub)) return;
      const h = await sha(ck.json);
      if (h !== ck.h || !(await verifySig(ck.hpub, ck.sig, ck.h))) return;
      let s2; try { s2 = JSON.parse(ck.json); } catch (e) { return; }
      if (!s2 || s2.gameId !== this.state.gameId || !(s2.rev > this.state.rev) || !s2.players || !s2.cards || !Array.isArray(s2.log)) return;
      const mine = this.state.players;
      this.state = s2; this.startRev = s2.rev;
      for (const id of Object.keys(this.state.players)) this.state.players[id].online = !!(id === this.pid || this.srcOf(id) || (mine[id] && mine[id].online));
      this.sent = null;
      this.onState(this.state);
    }
    sendState(dst) {
      if (this.sent) this.flushNow();      // so the snapshot and the numbering line up
      this.send(dst, { t: 'state', s: this.state, epoch: this.epoch, seq: this.seq });
    }
    broadcast(msg, except) { for (const [src, c] of this.clients) if (c.pid && src !== except) this.send(src, msg); }
    rosterNow() {
      const r = [[this.pid, this.addr]];
      for (const [src, c] of this.clients) if (c.pid && this.state.players[c.pid]) r.push([c.pid, src]);
      return r;
    }

    // Changes go out at most 60 ms after they happen (even during a flurry), and a player's "done" only after them.
    publish() {
      if (!this.isHost) return;
      this.onState(this.state);
      if (!this._pub) this._pub = setTimeout(() => this.flushNow(), 60);
    }
    flushNow() {
      clearTimeout(this._pub); this._pub = null;
      const s = this.state;
      const now = { keys: {}, cards: {}, log: s.log, logLast: s.log[s.log.length - 1] || null };
      for (const k of Object.keys(s)) if (k !== 'cards' && k !== 'log') now.keys[k] = JSON.stringify(s[k]);
      for (const [id, c] of Object.entries(s.cards)) now.cards[id] = JSON.stringify(c);
      const prev = this.sent;
      this.sent = now;
      if (!prev) { this.seq++; for (const [src, c] of this.clients) if (c.pid) this.send(src, { t: 'state', s, epoch: this.epoch, seq: this.seq }); }
      else {
        const d = { t: 'delta', epoch: this.epoch, base: this.seq, seq: this.seq + 1, set: {}, del: [], cards: {} };
        let n = 0;
        for (const [k, v] of Object.entries(now.keys)) if (prev.keys[k] !== v) { d.set[k] = s[k]; n++; }
        for (const k of Object.keys(prev.keys)) if (!(k in now.keys)) { d.del.push(k); n++; }
        for (const [id, v] of Object.entries(now.cards)) if (prev.cards[id] !== v) { d.cards[id] = s.cards[id]; n++; }
        for (const id of Object.keys(prev.cards)) if (!(id in now.cards)) { d.cards[id] = null; n++; }
        if (prev.log !== s.log) { d.log = s.log; n++; }
        else {
          const at = prev.logLast ? s.log.lastIndexOf(prev.logLast) : -1;
          const add = prev.logLast ? (at >= 0 ? s.log.slice(at + 1) : null) : s.log.slice();
          if (add === null) { d.log = s.log; n++; } else if (add.length) { d.logAdd = add; n++; }
        }
        if (n) { this.seq++; this.broadcast(d); }
      }
      for (const [src, msg] of this.resQ.splice(0)) this.send(src, Object.assign(msg, { seq: this.seq }));
    }
    // A signed checkpoint of the game, sent with heartbeats.
    async checkpoint() {
      if (this.ckBusy) return this.ck;
      this.ckBusy = true;
      try {
        if (!this.ck || this.ck.rev !== this.state.rev || this.ck.gameId !== this.state.gameId) {
          const h = await sha(canon(this.state));
          this.ck = { rev: this.state.rev, gameId: this.state.gameId, h, sig: await this.identity.sign(h) };
        }
      } finally { this.ckBusy = false; }
      return this.ck;
    }

    // ---------- player ----------
    async clientGot(sig, src, m) {
      // Someone who noticed the host is gone may ask us to take over (we're next in line).
      if (m.t === 'join' && src !== this.hostAddr) {
        if ((!this.synced || this.hostMissing || Date.now() - this.heard > 4000) && this.roster.some(([, a]) => a === src)) {
          this.takeOver();
          return this.hostGot(sig, src, m);
        }
        return this.send(src, { t: 'notyet', host: this.hostAddr });
      }
      const fromDoor = this.doors.includes(src);
      if (m.t === 'goto' && (fromDoor || src === this.hostAddr)) {
        const a = String(m.addr || '');
        if (a && a.startsWith(this.base) && a !== this.addr && a !== this.hostAddr) { this.heard = Date.now(); this.synced = false; this.tries = []; this.joinVia(a); }
        else if (a === this.hostAddr && !this.synced) this.joinVia(a);
        return;
      }
      if (m.t === 'notyet') {
        const hAddr = String(m.host || '');
        setTimeout(() => {
          if (this.isHost || this.synced || this.trying !== src) return;
          if (hAddr && hAddr.startsWith(this.base) && hAddr !== this.addr) this.joinVia(hAddr); else this.joinVia(src);
        }, 1500);
        return;
      }
      if (m.t === 'who' || m.t === 'iam') return;
      // A player still talking to us as if we were host (we stepped down): point them to the real host.
      if ((m.t === 'ping' || m.t === 'act' || m.t === 'hello' || m.t === 'resync') && src !== this.hostAddr && this.synced && this.hostAddr) { this.send(src, { t: 'goto', addr: this.hostAddr }); return; }
      if (src !== this.trying && src !== this.hostAddr) return;
      this.heard = Date.now(); this.hostMissing = 0;
      if (m.t === 'nonce') {
        this.hostAddr = src;
        const sig2 = await this.identity.sign(String(m.n));
        this.send(src, { t: 'hello', pid: this.pid, pub: this.identity.pub, sig: sig2, look: this.mySleeve, ck: this.myCk || null });
        if (m.hpub) this.hostPub = m.hpub;
      } else if (m.t === 'rejoin') { this.synced = false; this.trying = src; this.send(src, { t: 'join' }); }
      else if (m.t === 'denied' && m.same) { this.close(); this.onReplaced(true); }   // this browser is already the host, in another tab
      else if (m.t === 'denied') { this.setStatus('offline', 'The table didn’t accept this browser’s identity.'); }
      else if (m.t === 'replaced') { this.close(); this.onReplaced(); }
      else if (m.t === 'state') {
        this.hostAddr = src; this.trying = null; this.rosterTried = false;
        this.state = m.s; this.epoch = m.epoch; this.seq = m.seq;
        this.synced = true;
        this.resendPending(true);
        if (this.status !== 'connected') this.setStatus('connected');
        this.onState(this.state);
      }
      else if (m.t === 'delta') {
        if (!this.synced || m.epoch !== this.epoch || m.base !== this.seq) { this.askResync(); return; }
        const s = this.state;
        for (const [k, v] of Object.entries(m.set || {})) s[k] = v;
        for (const k of (m.del || [])) delete s[k];
        for (const [id, c] of Object.entries(m.cards || {})) { if (c === null) delete s.cards[id]; else s.cards[id] = c; }
        if (m.log) s.log = m.log;
        else if (m.logAdd) { s.log.push(...m.logAdd); if (s.log.length > 300) s.log.splice(0, s.log.length - 300); }
        this.seq = m.seq;
        this.onState(s);
      }
      else if (m.t === 'hb') {
        if (Array.isArray(m.roster)) { this.roster = m.roster.filter(r => Array.isArray(r) && r.length === 2 && typeof r[1] === 'string' && r[1].startsWith(this.base)).slice(0, 8); this.saveRoster(this.roster); }
        if (m.hpub) this.hostPub = m.hpub;
        if (this.synced && (m.epoch !== this.epoch || m.seq !== this.seq)) this.askResync();
        else if (this.synced && m.ck && m.ck.rev === this.state.rev) this.keepCheckpoint(m.ck);
        for (const [pid, v] of Object.entries(m.imgs || {})) {
          if (this.imgVer[pid] === v || pid === this.pid) continue;
          if (Date.now() - (this.imgAsked[pid] || 0) < 8000) continue;
          this.imgAsked[pid] = Date.now();
          this.send(src, { t: 'img', pid });
        }
      }
      else if (m.t === 'img') {
        const pid = String(m.pid || '');
        this.imgVer[pid] = m.ver; this.sleeves[pid] = cleanLook(m.look); this.onSleeve(pid, this.sleeves[pid]);
      }
      else if (m.t === 'res') { const p = this.pending.get(m.rid); if (p) { this.pending.delete(m.rid); p.res({ ok: m.ok, err: m.err, rejected: !m.ok }); } }
    }
    // Keep the host's signed checkpoint if it matches our copy exactly — it's what lets a takeover resume safely.
    async keepCheckpoint(ck) {
      if (this.ckChecking) return;
      this.ckChecking = true;
      try {
        const json = canon(this.state);
        const h = await sha(json);
        if (h !== ck.h || !(await verifySig(this.hostPub, ck.sig, ck.h))) return;
        this.myCk = { json, h, sig: ck.sig, hpub: this.hostPub };
      } finally { this.ckChecking = false; }
    }
    resendPending(now) {
      const t = Date.now();
      for (const [id, p] of [...this.pending]) {
        if (t - p.t0 > 45000) { this.pending.delete(id); p.res({ ok: false, uncertain: true, err: 'The table didn’t confirm that — check the board.' }); continue; }
        if (this.synced && this.hostAddr && (now || t - p.sentAt > 4000)) { p.sentAt = t; this.send(this.hostAddr, { t: 'act', rid: id, a: p.a }); }
      }
    }
    askResync() {
      if (Date.now() - (this.resyncAt || 0) < 2000) return;
      this.resyncAt = Date.now();
      this.send(this.hostAddr, { t: 'resync' });
    }

    got(sig, src, m) {
      if (!m || typeof m !== 'object' || this.closed) return;
      if (this.isHost) this.hostGot(sig, src, m); else this.clientGot(sig, src, m);
    }

    // Heartbeats both ways, so a closed tab, sleeping laptop or dead battery is noticed within ~10 seconds.
    async tick() {
      const now = Date.now();
      this.lastTick = now;
      if (this.closed || !this.main) return;
      if (!this.main.connected) { if (this.isHost) this.wasDownFor = now - (this.main.downSince || now); return; }
      if (this.isHost) {
        for (const [src, c] of [...this.clients]) if (now - c.lastSeen > 10000) this.dropClient(src);
        const roster = this.rosterNow();
        if (roster.length > 1) { this.roster = roster; this.lastClientAt = now; }
        this.saveRoster(roster);
        const imgs = {}; for (const pid of Object.keys(this.sleeves)) if (this.sleeves[pid]) imgs[pid] = this.imgVer[pid];
        const ck = await this.checkpoint();
        if (!this.isHost) return;
        this.broadcast({ t: 'hb', epoch: this.epoch, seq: this.seq, roster, imgs, hpub: this.identity.pub, ck: { rev: ck.rev, h: ck.h, sig: ck.sig } });
        // While we host without the main front door (after a takeover), keep checking for a rival host there.
        if (!this.doorSigs[0] && now - (this.lastChallenge || 0) > 8000) this.challenge(0);
        // Cut off from everyone while the others were here (our own network dropped)? Step down so whoever took
        // over keeps the game, and rejoin them.
        if (roster.length <= 1 && this.roster.length > 1 && now - this.lastClientAt > 12000) { this.roster = this.roster.filter(([p]) => p !== this.pid); this.stepDown(); }
        return;
      }
      this.resendPending(false);
      if (this.synced && this.hostAddr) {
        this.send(this.hostAddr, { t: 'ping' });
        if (now - this.heard > SILENT || (this.hostMissing && now - this.hostMissing > 4000)) this.failover();
      } else if (this.trying && now - this.tryAt > 6000) {
        // No answer where we knocked (the relay may still be holding a vanished host's address): try the next one.
        if (this.trying === 'door' && this.roster.length && !this.tries.length) this.tries = this.candidates(null);
        if (this.tries.length) this.nextCandidate(); else this.knock();
      }
    }

    act(a) {
      a = Object.assign({}, a, { aid: a.aid || this.pid.slice(1, 7) + rid(8) });
      if (this.isHost) {
        const others = this.roster.length > 1 && [...this.clients.values()].some(c => c.pid);
        if (!this.main.connected || (others && Date.now() - (this.lastClientMsg || 0) > 7000)) return Promise.resolve({ ok: false, rejected: true, err: 'Reconnecting — try again in a moment.' });
        const r = Rules.apply(this.state, this.pid, a);
        if (r.ok) this.publish();
        return Promise.resolve(Object.assign({ rejected: !r.ok }, r));
      }
      if (!this.synced || !this.main.connected) return Promise.resolve({ ok: false, rejected: true, err: 'Not connected to the table yet.' });
      // Keep resending the same move (same id, so it can't happen twice) until the table answers.
      const id = ++this.ridN;
      return new Promise(res => {
        const p = { a, res, t0: Date.now(), sentAt: Date.now() };
        this.pending.set(id, p);
        this.send(this.hostAddr, { t: 'act', rid: id, a });
      });
    }

    setSleeve(look) {
      this.mySleeve = cleanLook(look);
      this.sleeves[this.pid] = this.mySleeve;
      if (this.isHost) this.setImg(this.pid, this.mySleeve);
      else if (this.hostAddr && this.synced) this.send(this.hostAddr, { t: 'look', look: this.mySleeve });
    }

    close() { this.closed = true; if (this.main) this.main.close(); for (const s of this.doorSigs) if (s) s.close(); }
  }

  // ======================= phone as your hand =======================
  // The computer listens at an address made from the QR secret; messages are encrypted with a key from the
  // same secret. A phone only gets the hand after you approve it on the computer (one request per phone,
  // each showing the 3-digit code on that phone). Only one device holds your hand at a time.
  class PhoneLink {
    constructor(id, secret, onMsg, onChange, opts) {
      this.id = id; this.secret = secret;
      this.onMsg = onMsg; this.onChange = onChange;
      this.ask = opts.ask; this.trusted = opts.trusted; this.trust = opts.trust;
      this.phone = null; this.dev = null; this.lastSeen = 0;
      this.asking = new Map(); this.denied = new Map();
      this._w = setInterval(() => { if (this.phone && Date.now() - this.lastSeen > 10000) { this.phone = null; this.onChange(false); } }, 2500);
    }
    get linked() { return !!this.phone; }
    async listen() {
      if (this.sig || this.closed) return;
      if (!this.relay) this.relay = new Relay(await keyFrom('kt-phone:' + this.secret), (sig, src, m) => this.got(src, m));
      const s = new Sig(this.id, {
        message: m => this.relay.input(s, m),
        expire: src => { if (src === this.phone) { this.phone = null; this.onChange(false); } },
        taken: () => { if (this.sig === s) this.sig = null; if (!this.closed) setTimeout(() => this.listen(), 3000); }
      });
      this.sig = s;
    }
    link(src, dev) {
      if (this.phone && this.phone !== src) this.reply(this.phone, { t: 'moved' });   // only one phone at a time
      const fresh = this.phone !== src;
      this.phone = src; this.dev = dev; this.lastSeen = Date.now();
      this.reply(src, { t: 'pong' });
      if (fresh) this.onChange(true);
      this.onMsg({ t: 'hi' });
    }
    async got(src, m) {
      if (!m || typeof m !== 'object' || this.closed) return;
      if (src !== this.phone) {
        if (m.t !== 'hi') return;                  // nothing but "hello" until approved
        const dev = String(m.dev || '').slice(0, 40);
        if (dev.length < 12) return;
        const den = this.denied.get(dev);
        // "Ask again" from a refused phone is allowed, but at most every 20 seconds.
        if (den && !(m.retry && Date.now() - den > 20000)) return this.reply(src, { t: 'denied' });
        if (den) this.denied.delete(dev);
        if (this.trusted(dev)) {
          if (!this.phone || this.dev === dev || m.take) return this.link(src, dev);
          return this.reply(src, { t: 'moved' });   // your hand is on another of your devices right now
        }
        const q = this.asking.get(dev);
        if (q) { q.seen = Date.now(); if (q.src !== src) { q.src = src; q.code = await phoneCode(dev, src); if (q.update) q.update(); } return this.reply(src, { t: 'pending' }); }
        if (this.asking.size >= 3) return this.reply(src, { t: 'pending' });
        const req = { src, dev, seen: Date.now(), label: String(m.label || 'A phone').slice(0, 40), code: await phoneCode(dev, src) };
        this.asking.set(dev, req);
        this.reply(src, { t: 'pending' });
        this.ask(req, ok => {
          this.asking.delete(dev);
          if (ok) {
            this.trust(dev);
            if (Date.now() - req.seen < 12000) this.link(req.src, dev);   // only link it if that phone is still there
            return;
          }
          this.denied.set(dev, Date.now()); this.reply(req.src, { t: 'denied' });
        });
        return;
      }
      this.lastSeen = Date.now();
      if (m.t === 'hi' || m.t === 'ping') { this.reply(src, { t: 'pong' }); if (m.t === 'hi') this.onMsg({ t: 'hi' }); return; }
      if (m.t === 'bye') { this.phone = null; this.onChange(false); return; }
      this.onMsg(m);
    }
    reply(dst, m) { if (this.sig && this.relay) return this.relay.send(this.sig, dst, m); }
    send(m) { if (this.phone) this.reply(this.phone, m); }
    // Unlink: tell the phone first so it clears your hand right away, then stop listening.
    async revoke() {
      const p = this.phone;
      this.closed = true; clearInterval(this._w);
      if (p) { try { await this.reply(p, { t: 'revoked' }); } catch (e) {} }
      const s = this.sig;
      setTimeout(() => { if (s) s.close(); }, 800);
      this.sig = null;
      if (this.phone) { this.phone = null; this.onChange(false); }
    }
    close() { this.closed = true; clearInterval(this._w); if (this.sig) this.sig.close(); this.sig = null; if (this.phone) { this.phone = null; this.onChange(false); } }
  }

  class PhoneClient {
    constructor(target, secret, dev, label, onMsg, onStatus) {
      this.target = target; this.secret = secret; this.dev = dev; this.label = label;
      this.onMsg = onMsg; this.onStatus = onStatus;
      this.lastSeen = 0; this.status = ''; this.code = '';
      this.lostSince = 0;
      // Keep the same address across reloads, so the 3-digit code doesn't change while you're approving.
      this.key = 'kt:phaddr:' + target;
      const saved = lstore.get(this.key);
      this.saved = saved && saved.a ? saved : { a: 'ktp-' + rid(14), t: rid(12) };
      lstore.set(this.key, this.saved);
      this.addr = this.saved.a;
      setInterval(() => this.tick(), 2500);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && !this.stopped()) this.hello(); });
    }
    stopped() { return ['denied', 'moved', 'revoked'].includes(this.status); }
    set(st) {
      if (st === this.status) return;
      this.status = st;
      if (st === 'waiting') this.lostSince = this.lostSince || Date.now(); else this.lostSince = 0;
      this.onStatus(st);
    }
    async start() {
      this.code = await phoneCode(this.dev, this.addr);
      if (!this.relay) this.relay = new Relay(await keyFrom('kt-phone:' + this.secret), (sig, src, m) => {
        if (src !== this.target) return;
        this.lastSeen = Date.now();
        if (m.t === 'pending') return this.set('pending');
        if (m.t === 'denied') return this.set('denied');
        if (m.t === 'moved') return this.set('moved');
        if (m.t === 'revoked') return this.set('revoked');
        this.set('linked');
        if (m.t !== 'pong') this.onMsg(m);
      });
      const s = new Sig(this.addr, {
        open: () => this.hello(),
        message: m => this.relay.input(s, m),
        expire: src => { if (src === this.target && !this.stopped()) this.set('waiting'); },
        down: () => { if (!this.stopped()) this.set('offline'); },
        taken: () => { this.saved = { a: 'ktp-' + rid(14), t: rid(12) }; lstore.set(this.key, this.saved); this.addr = this.saved.a; this.start(); }
      }, this.saved.t);
      this.sig = s;
    }
    hello(extra) { if (this.relay && this.sig) this.relay.send(this.sig, this.target, Object.assign({ t: 'hi', dev: this.dev, label: this.label }, extra || {})); }
    useHere() { this.set('waiting'); this.hello({ take: true }); }
    askAgain() { this.set('pending'); this.hello({ retry: true }); }
    get lostFor() { return this.lostSince ? Date.now() - this.lostSince : 0; }
    tick() {
      if (!this.sig || !this.sig.connected || this.stopped()) return;
      if (this.status === 'linked') this.relay.send(this.sig, this.target, { t: 'ping' }); else this.hello();
      if ((this.status === 'linked' || this.status === 'pending') && Date.now() - this.lastSeen > 8000) this.set('waiting');
      else if (!this.status || this.status === 'offline') this.set('waiting');
      if (this.status === 'waiting') this.onStatus('waiting');   // lets the screen update "lost for" messages
    }
    send(m) { if (this.relay && this.status === 'linked') this.relay.send(this.sig, this.target, m); }
  }

  root.Net = { Table, PhoneLink, PhoneClient, Sig, slug, hash, baseFor, makeIdentity, phoneIdFor, phoneCode, rid, cleanLook, canon };
})(window);
