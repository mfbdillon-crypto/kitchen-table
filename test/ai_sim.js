// AI vs AI: the planning AI (aibrain.js + aiexec.js) plays whole games against itself through Rules.apply, with the
// v6 engine on. Checks that it interacts properly with the engine (no stalls, few refusals), and that what it planned
// matches what it did. Usage:
//   node test/ai_sim.js [deckA,deckB,...] [levelA,levelB,...] [turns] [seed] [games]
//   e.g. node test/ai_sim.js 6,3 hard,normal 30 7 1
// Env: LOG=1 prints each AI's plan log; QUIET=1 prints only the summary line.
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
for (const f of ['cards', 'scry', 'effects', 'oracle', 'rules', 'engine', 'precons', 'aiprofiles', 'aiface', 'aibrain', 'aiexec']) require('../site/' + f + '.js');
const R = Rules, fs = require('fs');
const db = {}; for (const c of JSON.parse(fs.readFileSync(__dirname + '/../data/forgecards.json', 'utf8'))) db[c.name] = c;
const decks = (process.argv[2] || '6,3').split(',').map(Number);
const levels = (process.argv[3] || 'normal,normal').split(',');
const TURNS = +(process.argv[4] || 30);
let seed = +(process.argv[5] || 7);
const GAMES = +(process.argv[6] || 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const isLand = c => /\bland\b/i.test(((c.d.faces || [])[0] || {}).t || '');

async function game(gi) {
  const s = R.newState();
  const seats = decks.map((_, i) => 'ABCD'[i]);
  const P = {}, ex = {}, refusals = {}, stats = { actions: 0 };
  let uid = 0;
  const deck = (pid, k) => {
    const pc = KT_PRECONS[k];
    const lib = [], cmd = [];
    for (const line of pc.list.split('|')) {
      const m = line.match(/^(\d+)\s+(.+)$/); if (!m) continue;
      const sc = db[m[2]] || db[m[2].split(' // ')[0]]; if (!sc) continue;
      for (let i = 0; i < +m[1]; i++) { const c = { id: pid + '-' + (++uid), d: Scry.toD(sc) }; if (m[2] === pc.cmdr && !cmd.length) { c.cmdr = true; cmd.push(c); } else lib.push(c); }
    }
    if (!cmd.length && db[pc.cmdr]) cmd.push({ id: pid + '-cmdr', d: Scry.toD(db[pc.cmdr]), cmdr: true });
    return { lib: shuffle(lib), hand: [], cmd, name: pc.name, id: pc.id, bracket: pc.bracket, phase: 'none', mull: 0, bottomN: 0, drew: -1 };
  };
  const act = (pid, a) => {
    stats.actions++;
    let r;
    try { r = R.apply(s, pid, a); } catch (e) { r = { ok: false, err: 'CRASH ' + e.message }; console.log('CRASH', a.type, e.stack.split('\n').slice(0, 4).join(' / ')); }
    if (r && r.ok === false) { const k = a.type + ': ' + String(r.err).slice(0, 90); (refusals[pid] = refusals[pid] || {})[k] = ((refusals[pid] || {})[k] || 0) + 1; }
    return r || { ok: true };
  };
  for (const [i, p] of seats.entries()) {
    act(p, { type: 'join', name: p + (levels[i] || 'normal')[0].toUpperCase(), ai: { skill: levels[i] || 'normal', by: 'sim', v: 2 } });
    s.players[p].online = true; P[p] = deck(p, decks[i]);
  }
  for (const p of seats) act(p, { type: 'enter', zone: 'command', cards: P[p].cmd });
  act('A', { type: 'start' });
  const take = (list, ids) => { const out = []; for (const id of ids) { const i = list.findIndex(c => c.id === id); if (i >= 0) out.push(list.splice(i, 1)[0]); } return out; };
  const io = p => ({
    s: () => s, me: () => p, hand: () => P[p].hand, lib: () => P[p].lib.slice().sort((a, b) => a.d.n < b.d.n ? -1 : 1),
    act: a => act(p, a),
    castFromHand: (id, o) => { const c = take(P[p].hand, [id])[0]; if (!c) return { ok: false, err: 'not in hand' }; const r = act(p, Object.assign({ type: 'enter', zone: 'stack', cast: true, from: 'hand', cards: [c] }, o)); if (!r.ok) P[p].hand.push(c); return r; },
    castPublic: (id, o) => act(p, Object.assign({ type: 'move', ids: [id], to: 'stack', cast: true }, o)),
    playLand: id => { const c = take(P[p].hand, [id])[0]; if (!c) return { ok: false, err: 'not in hand' }; const r = act(p, { type: 'enter', zone: 'battlefield', land: true, from: 'hand', cards: [c] }); if (!r.ok) P[p].hand.push(c); return r; },
    tapPay: ids => act(p, { type: 'tap', ids: [...ids], tapped: true, pay: true, pain: [...(ids.pain || [])] }),
    privPhase: () => P[p].phase, mulls: () => P[p].mull, bottomN: () => P[p].bottomN,
    openingHand: () => { P[p].hand = P[p].lib.splice(0, 7); P[p].phase = 'deciding'; },
    keep: () => { const n = Math.max(0, P[p].mull - 1); if (n) { P[p].phase = 'bottom'; P[p].bottomN = n; return; } P[p].phase = 'kept'; act(p, { type: 'player', patch: { kept: true } }); },
    mulligan: () => { P[p].lib.push(...P[p].hand); P[p].hand = []; shuffle(P[p].lib); P[p].mull++; P[p].hand = P[p].lib.splice(0, 7); },
    bottom: ids => { P[p].lib.push(...take(P[p].hand, ids)); P[p].phase = 'kept'; act(p, { type: 'player', patch: { kept: true } }); },
    drawForTurn: () => {
      const T = s.turn; if (T.active !== p || T.phase < R.PI('Draw') || P[p].drew === T.n) return false;
      P[p].drew = T.n; if (T.n === 1 && seats.length === 2) return false;
      draw(p, 1, 'drew a card for the turn'); return true;
    },
    draw: (n, why) => draw(p, n, why), mill: n => { const ids = P[p].lib.splice(0, n); if (ids.length) act(p, { type: 'enter', zone: 'graveyard', cards: ids }); },
    discard: (ids, why) => { const cs = take(P[p].hand, ids); if (cs.length) act(p, { type: 'enter', zone: 'graveyard', from: 'hand', cards: cs }); },
    libTop: n => P[p].lib.slice(0, n),
    castFromLibrary: (id, o) => { if (!P[p].lib[0] || P[p].lib[0].id !== id) return { ok: false, err: 'not on top' }; const c = P[p].lib.shift(); const r = act(p, Object.assign({ type: 'enter', zone: 'stack', cast: true, from: 'library', cards: [c] }, o)); if (!r.ok) P[p].lib.unshift(c); return r; },
    playTop: (id, perm) => { if (!P[p].lib[0] || P[p].lib[0].id !== id) return { ok: false, err: 'not on top' }; const c = P[p].lib.shift(); const r = act(p, { type: 'enter', zone: 'battlefield', land: true, from: 'library', perm, cards: [c] }); if (!r.ok) P[p].lib.unshift(c); return r; },
    applyLook: (mode, n, decisions) => {
      const top = P[p].lib.splice(0, n); const tops = [], bottoms = [];
      for (const c of top) { const d = (decisions.find(x => x.id === c.id) || { dest: 'top' }).dest; if (d === 'top') tops.push(c); else if (d === 'bottom') bottoms.push(c); else if (d === 'hand') P[p].hand.push(c); else act(p, { type: 'enter', zone: d, cards: [c] }); }
      P[p].lib.unshift(...tops); P[p].lib.push(...bottoms);
    },
    searchTake: (ids, t) => {
      const cs = take(P[p].lib, ids.slice(0, t.n || 1));
      const toBf = t.split ? cs.slice(0, 1) : t.dest === 'battlefield' ? cs : [];
      const toGy = t.splitGy ? cs.slice(1) : t.dest === 'graveyard' ? cs : [];
      const toHand = t.split ? cs.slice(1) : t.splitGy ? cs.slice(0, 1) : t.dest === 'battlefield' || t.dest === 'graveyard' ? [] : cs;
      if (t.dest === 'top') { shuffle(P[p].lib); P[p].lib.unshift(...cs); return; }
      P[p].hand.push(...toHand); shuffle(P[p].lib);
      if (toBf.length) act(p, { type: 'enter', zone: 'battlefield', tapped: !!t.tapped, cards: toBf });
      if (toGy.length) act(p, { type: 'enter', zone: 'graveyard', from: 'library', cards: toGy });
    },
    cascadeReveal: (mv, top) => { if (top) { const c = P[p].lib.shift(); if (!c) return null; P[p].hand.push(c); return !isLand(c) && (+c.d.cmc || 0) < mv ? c : null; } const out = []; let hit = null; while (P[p].lib.length) { const c = P[p].lib.shift(); out.push(c); if (!isLand(c) && (+c.d.cmc || 0) < mv) { hit = c; break; } } P[p].lib.push(...shuffle(out.filter(c => c !== hit))); if (hit) P[p].hand.push(hit); return hit; },
    cascadeDecline: id => { const c = take(P[p].hand, [id])[0]; if (c) P[p].lib.push(c); },
    impulse: t => { const cs = P[p].lib.splice(0, Math.max(1, t.n || 1)); if (cs.length) act(p, { type: 'enter', zone: 'exile', from: 'library', cards: cs, mayPlay: { until: t.until, from: t.from } }); return cs.map(c => c.id); },
    handToTop: ids => { const cs = take(P[p].hand, ids); P[p].lib.unshift(...cs); },
    routePlan: t => Cards.routePlan(t, P[p].lib, p),
    routeApply: (t, dec) => { const by = to => dec.filter(x => x.to === to).map(x => x.id); const bot = take(P[p].lib, by('bottom')); P[p].lib.push(...bot); const hd = take(P[p].lib, by('hand')); P[p].hand.push(...hd);
      for (const [z, tapped] of [['battlefield', false], ['battlefield', true], ['graveyard', false], ['exile', false]]) { const ids = dec.filter(x => x.to === z && !!x.tapped === tapped).map(x => x.id); const cs = take(P[p].lib, ids); if (cs.length) act(p, { type: 'enter', zone: z, from: 'library', cards: cs, tapped }); } },
    digFind: t => { const n = Math.max(1, t.n || 1), want = String(t.what || 'card'); const fits = c => want === 'card' || Cards.matchesWhat(Object.assign({ zone: 'library', owner: p, counters: {}, face: 0 }, c), want); const hits = [], rest = []; for (const c of P[p].lib) { if (hits.length >= n) break; if (fits(c)) hits.push(c.id); else if (!t.top) rest.push(c.id); if (t.top) break; } return { hits, rest, names: hits.map(id => P[p].lib.find(c => c.id === id).d.n) }; },
    digFinish: (t, hits, rest, dest) => { if (t.top && !hits.length) { if (dest === 'bottom' && P[p].lib.length) P[p].lib.push(P[p].lib.shift()); return; } const rs = take(P[p].lib, rest); if (t.rest === 'bottom') P[p].lib.push(...shuffle(rs)); else if (rs.length) act(p, { type: 'enter', zone: 'exile', from: 'library', cards: rs }); const hs = take(P[p].lib, hits); if (!hs.length) return; if (dest === 'hand') P[p].hand.push(...hs); else act(p, { type: 'enter', zone: 'battlefield', from: 'library', tapped: !!t.tapped, cards: hs }); },
    fromHand: (ids, zone, o) => { const cs = take(P[p].hand, ids); if (!cs.length) return { ok: true }; const r = act(p, Object.assign({ type: 'enter', zone, from: 'hand', cards: cs }, o || {})); if (!r.ok) P[p].hand.push(...cs); return r; },
    move: (ids, to, extra) => act(p, Object.assign({ type: 'move', ids, to }, extra || {}))
  });
  const draw = (p, n, why) => { const got = P[p].lib.splice(0, n); P[p].hand.push(...got); act(p, { type: 'log', text: why || `drew ${got.length}`, drew: got.length }); if (got.length < n) act(p, { type: 'lose', why: 'empty library' }); };
  for (const [i, p] of seats.entries()) {
    const B = new AIBrain({ me: p, level: levels[i] || 'normal', deckId: P[p].id, bracket: P[p].bracket, rng: rnd });
    ex[p] = new AIExec(B, io(p));
    io(p).openingHand();
  }
  const inbox = p => {
    const ib = (s.inbox[p] || []).slice(); if (!ib.length) return;
    for (const x of ib) { if (x.to === 'hand') P[p].hand.push({ id: x.card.id, d: x.card.d, cmdr: x.card.cmdr }); else if (x.pos === 'bottom') P[p].lib.push({ id: x.card.id, d: x.card.d }); else if (x.pos === 'n2' || x.pos === 'n3') P[p].lib.splice(x.pos === 'n2' ? 1 : 2, 0, { id: x.card.id, d: x.card.d }); else if (x.pos === 'shuffle') { P[p].lib.push({ id: x.card.id, d: x.card.d }); shuffle(P[p].lib); } else P[p].lib.unshift({ id: x.card.id, d: x.card.d }); }
    act(p, { type: 'inboxAck', ids: ib.map(x => x.card.id) });
  };
  const todos = async p => {
    const list = ((s.todo || {})[p] || []).slice();
    for (const t of list) { await ex[p].onTodo(t); act(p, { type: 'todoAck', ids: [t.id] }); }
    return list.length > 0;
  };
  // Commanders go back to the command zone (903.9).
  const cmdrHome = () => { for (const c of Object.values(s.cards)) if (c.cmdr && (c.zone === 'graveyard' || c.zone === 'exile')) act(c.owner, { type: 'move', ids: [c.id], to: 'command' }); };
  let idle = 0, lastSig = '';
  for (let step = 0; step < TURNS * 300 && !s.winner; step++) {
    if (s.turn.n > TURNS) break;
    let did = false;
    for (const p of seats) { inbox(p); if (await todos(p)) did = true; }
    cmdrHome();
    for (const p of seats) { if (s.players[p].lost) continue; if (await ex[p].step()) { did = true; break; } }
    const sig = [s.turn.n, s.turn.phase, R.stackCards(s).length, (s.ask || []).length, JSON.stringify(s.prio && s.prio.holder), s.turn.goal].join(':');
    if (!did) {
      if (++idle > 5) {
        // Stuck: show the state, then nudge (like the host's timers would after a while).
        console.log(`STUCK? game ${gi} turn ${s.turn.n} ${R.PHASES[s.turn.phase]} active ${s.turn.active} goal ${s.turn.goal} prio ${JSON.stringify(s.prio)} ask ${JSON.stringify((s.ask || []).map(a => a.kind + ':' + a.pid))} tq ${(s.tq || []).length} combat ${JSON.stringify(s.combat && { n: s.combat.n, done: s.combat.done, waiting: s.combat.waiting, ok: s.combat.ok })}`);
        stats.stuck = (stats.stuck || 0) + 1;
        if (stats.stuck > 3) break;
        for (const a of (s.ask || []).slice()) a.since = 0;
        if (s.prio) s.prio.since = 0;
        R.fixUp(s);
        idle = 0;
      }
    } else idle = 0;
    lastSig = sig;
  }
  const name = p => s.players[p].name;
  const res = { game: gi, turns: s.turn.n, winner: s.winner ? name(s.winner) : '-', life: seats.map(p => `${name(p)} ${s.players[p].life}${s.players[p].poison ? ' (' + s.players[p].poison + 'p)' : ''}`).join(', '), actions: stats.actions, stuck: stats.stuck || 0 };
  console.log(`GAME ${gi}: ${seats.map(p => `${name(p)}=${P[p].name}`).join(' vs ')} → turn ${res.turns}, winner ${res.winner}; ${res.life}; actions ${res.actions}${res.stuck ? ', STUCK ' + res.stuck : ''}`);
  for (const p of seats) {
    const B = ex[p].B;
    const kinds = {}; for (const e of B.log) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    const rf = Object.entries(refusals[p] || {}).sort((a, b) => b[1] - a[1]);
    if (!process.env.QUIET) {
      console.log(`  ${name(p)} log: ${JSON.stringify(kinds)}`);
      if (rf.length) console.log(`  ${name(p)} refused: ${rf.slice(0, 8).map(([k, v]) => v + '× ' + k).join(' | ')}`);
      const tp = Object.entries(B.turnPlans).slice(-3);
      for (const [t, x] of tp) { const missed = x.planned.filter(l => !x.did.some(d => d.includes(l.replace(/^\(main 2\) /, '').split(' → ')[0].replace(/^cast /, '')))); console.log(`  ${name(p)} turn ${t}: did ${x.did.length}/${x.planned.length} planned; failed: ${x.failed.slice(0, 3).join(' | ') || '-'}`); }
    }
    { const tps = Object.values(B.turnPlans).filter(x => x.unused != null); const un = tps.reduce((a, x) => a + x.unused, 0); const heldT = tps.filter(x => x.held).length; console.log(`  ${name(p)} mana unused per turn: ${(un / Math.max(1, tps.length)).toFixed(1)} (held answers on ${heldT}/${tps.length} turns); commander cast turn: ${(B.log.find(e => e.kind === 'did' && /commander/.test(e.text)) || {}).turn || '-'}`); }
    if (process.env.LOG) for (const e of B.log) console.log(`    [${name(p)} t${e.turn} ${e.phase}] ${e.kind}: ${e.text}`);
  }
  fs.writeFileSync(__dirname + `/aisim_${decks.join('_')}_${gi}.log`, seats.map(p => ex[p].B.log.map(e => `[${name(p)} t${e.turn} ${e.phase}] ${e.kind}: ${e.text}`).join('\n')).join('\n\n') + '\n\nTABLE LOG\n' + s.log.map(l => (l.pid ? name(l.pid) + ' ' : '') + l.text).join('\n'));
  return res;
}
(async () => {
  const out = [];
  for (let g = 1; g <= GAMES; g++) out.push(await game(g));
  if (GAMES > 1) { const w = {}; for (const r of out) w[r.winner] = (w[r.winner] || 0) + 1; console.log('WINS', JSON.stringify(w), 'avg turns', (out.reduce((a, r) => a + r.turns, 0) / out.length).toFixed(1), 'stuck', out.filter(r => r.stuck).length); }
})();
