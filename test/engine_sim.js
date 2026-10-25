// Stress test: two (or more) scripted players play the ready-made decks against each other through Rules.apply,
// with the v6 engine on. Looks for crashes, stuck games and engine problems. Usage: node test/engine_sim.js [deckA] [deckB] [turns] [seed]
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
require('../site/cards.js'); require('../site/scry.js'); require('../site/effects.js'); require('../site/oracle.js'); require('../site/rules.js'); require('../site/engine.js'); require('../site/precons.js');
const R = Rules, fs = require('fs');
const db = {}; for (const c of JSON.parse(fs.readFileSync(__dirname + '/../data/forgecards.json', 'utf8'))) db[c.name] = c;
let seed = +(process.argv[5] || 7);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = a => a[Math.floor(rnd() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const deckIdx = [+(process.argv[2] || 0), +(process.argv[3] || 1)];
const TURNS = +(process.argv[4] || 20);
const s = R.newState();
const P = {};
let uid = 0;
function deck(pid, k) {
  const pc = KT_PRECONS[k];
  const lib = [], cmd = [];
  for (const line of pc.list.split('|')) {
    const m = line.match(/^(\d+)\s+(.+)$/); if (!m) continue;
    const sc = db[m[2]] || db[m[2].split(' // ')[0]]; if (!sc) continue;
    for (let i = 0; i < +m[1]; i++) { const c = { id: pid + '-' + (++uid), d: Scry.toD(sc) }; if (m[2] === pc.cmdr && !cmd.length) { c.cmdr = true; cmd.push(c); } else lib.push(c); }
  }
  if (!cmd.length && db[pc.cmdr]) cmd.push({ id: pid + '-cmdr', d: Scry.toD(db[pc.cmdr]), cmdr: true });
  return { lib: shuffle(lib), hand: [], cmd, name: pc.name };
}
const problems = [], stats = { trig: 0, asks: {}, manual: 0, actions: 0, refused: {} };
function act(pid, a) {
  stats.actions++;
  let r;
  try { r = R.apply(s, pid, a); } catch (e) { problems.push(`CRASH ${a.type}: ${e.stack.split('\n').slice(0, 3).join(' / ')}`); return { ok: false }; }
  if (!r.ok) { const k = a.type + ': ' + String(r.err).slice(0, 70); stats.refused[k] = (stats.refused[k] || 0) + 1; }
  return r;
}
const seats = ['A', 'B'];
for (const [i, p] of seats.entries()) { act(p, { type: 'join', name: p }); s.players[p].online = true; P[p] = deck(p, deckIdx[i]); }
for (const p of seats) act(p, { type: 'enter', zone: 'command', cards: P[p].cmd });
act('A', { type: 'start' });
for (const p of seats) { P[p].hand = P[p].lib.splice(0, 7); act(p, { type: 'player', patch: { kept: true } }); }
const isLand = c => /\bland\b/i.test(c.d.faces[0].t);
const draw = (p, n) => { const got = P[p].lib.splice(0, n); P[p].hand.push(...got); act(p, { type: 'log', text: `drew ${got.length}`, drew: got.length }); if (got.length < n) act(p, { type: 'lose', why: 'empty library' }); };
const drew = {};
function inbox(p) {
  const ib = (s.inbox[p] || []).slice();
  if (!ib.length) return;
  for (const x of ib) { if (x.to === 'hand') P[p].hand.push({ id: x.card.id, d: x.card.d, cmdr: x.card.cmdr }); else P[p].lib.unshift({ id: x.card.id, d: x.card.d }); }
  act(p, { type: 'inboxAck', ids: ib.map(x => x.card.id) });
}
function todos(p) {
  const list = ((s.todo || {})[p] || []).slice();
  for (const t of list) {
    if (t.k === 'draw') draw(p, t.n || 1);
    else if (t.k === 'discard') { const ids = P[p].hand.splice(0, Math.min(t.n || 1, P[p].hand.length)); if (ids.length) act(p, { type: 'enter', zone: 'graveyard', from: 'hand', cards: ids }); }
    else if (t.k === 'mill') { const ids = P[p].lib.splice(0, t.n || 1); if (ids.length) act(p, { type: 'enter', zone: 'graveyard', cards: ids }); }
    else if (t.k === 'sacrifice') { const mine = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === p && Cards.matchesWhat(c, String(t.what || 'permanent').replace(/s$/, ''))); const take = mine.slice(0, t.n || 1).map(c => c.id); if (take.length) act(p, { type: 'move', ids: take, to: 'graveyard' }); }
    else if (t.k === 'fetch' || t.k === 'search') { const i = P[p].lib.findIndex(c => isLand(c)); if (i >= 0) { const [c] = P[p].lib.splice(i, 1); if (t.dest === 'battlefield') act(p, { type: 'enter', zone: 'battlefield', tapped: !!t.tapped, cards: [c] }); else P[p].hand.push(c); } }
    act(p, { type: 'todoAck', ids: [t.id] });
  }
}
function answerAsks() {
  for (const ask of (s.ask || []).slice()) {
    stats.asks[ask.kind] = (stats.asks[ask.kind] || 0) + 1;
    if (ask.kind === 'manual') { stats.manual++; if (process.env.MANUAL) console.log('MANUAL', ask.name, '::', ask.text.join(' | ')); act(ask.pid, { type: 'answer', id: ask.id }); continue; }
    if (ask.kind === 'cmdrZone') { act(ask.pid, { type: 'answer', id: ask.id, command: rnd() < 0.8 }); continue; }
    if (ask.kind === 'punisher') { act(ask.pid, { type: 'answer', id: ask.id, yes: rnd() < 0.5 }); continue; }
    if (ask.kind === 'payLife') { act(ask.pid, { type: 'answer', id: ask.id, ids: [] }); continue; }
    if (ask.kind === 'may') { act(ask.pid, { type: 'answer', id: ask.id, yes: rnd() < 0.8 }); continue; }
    if (ask.kind === 'order') { act(ask.pid, { type: 'answer', id: ask.id, order: shuffle(ask.items.map(x => x.id)) }); continue; }
    if (ask.kind === 'modes') { act(ask.pid, { type: 'answer', id: ask.id, modes: shuffle([...Array(ask.modes.length).keys()]).slice(0, ask.min) }); continue; }
    if (ask.kind === 'assign') { const asg = {}; let left = ask.power; for (const b of ask.blockers) { const n = Math.min(left, b.lethal); asg[b.id] = n; left -= n; } if (left) asg[ask.blockers[0].id] += left; act(ask.pid, { type: 'answer', id: ask.id, assign: asg }); continue; }
    if (ask.kind === 'choose') { act(ask.pid, { type: 'answer', id: ask.id, value: ask.players ? ask.players[0] : ask.what === 'color' ? 'white' : 'Angel' }); continue; }
    if (ask.kind === 'enterOpt') { act(ask.pid, { type: 'answer', id: ask.id, yes: rnd() < 0.5 }); continue; }
    if (ask.kind === 'legend') { act(ask.pid, { type: 'answer', id: ask.id, keep: ask.ids[0] }); continue; }
    if (ask.kind === 'targets') { const tg = ask.reqs.map(r => shuffle(r.choices.slice()).slice(0, r.upTo ? Math.min(1, r.n) : Math.min(r.n, r.choices.length))); act(ask.pid, { type: 'answer', id: ask.id, tg }); continue; }
  }
}
function settle() {
  for (let g = 0; g < 60; g++) {
    for (const p of seats) { inbox(p); todos(p); }
    if ((s.ask || []).length) { answerAsks(); continue; }
    if (s.prio && s.prio.holder) { act(s.prio.holder, { type: 'pass' }); continue; }
    const K = s.combat;
    if (K && !K.done && !K.blocked && K.n === s.turn.n) {
      for (const p of K.waiting.filter(p => !K.ok[p])) {
        const atk = Object.keys(K.att).filter(id => (K.att[id].def.p || (s.cards[K.att[id].def.c] || {}).ctrl) === p);
        const mine = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === p && !c.tapped && Cards.isType(c, 'creature'));
        const list = [];
        for (const b of mine) if (rnd() < 0.5 && atk.length) { const at = pick(atk); if (!Cards.blockProblem(s, b, s.cards[at])) list.push({ id: b.id, att: at }); }
        if (act(p, { type: 'block', list }).ok === false) act(p, { type: 'block', list: [] });
      }
      continue;
    }
    break;
  }
}
const target = (req, by) => { const ch = Cards.targetChoices(s, req, by); return ch.length ? [pick(ch)] : []; };
let lastTurn = -1, stuck = 0;
for (let step = 0; step < TURNS * 40 && !s.winner; step++) {
  settle();
  const T = s.turn, p = T.active;
  if (T.n > TURNS) break;
  const key = T.n + ':' + T.phase + ':' + R.stackCards(s).length + ':' + (s.ask || []).length;
  if (key === lastTurn) { if (++stuck > 6) { problems.push(`STUCK at turn ${T.n} ${R.PHASES[T.phase]} prio=${JSON.stringify(s.prio)} ask=${JSON.stringify(s.ask)} tq=${(s.tq || []).length} combat=${JSON.stringify(s.combat)} goal=${T.goal}`); break; } } else stuck = 0;
  lastTurn = key;
  if (drew[p] !== T.n && T.phase >= R.PI('Draw')) { drew[p] = T.n; if (!(T.n === 1)) draw(p, 1); continue; }
  const ph = R.PHASES[T.phase];
  if (ph === 'Main 1' && !T.goal) {
    if (!T.played) T.played = {};
    if (T.played[p] !== T.n) {
      T.played[p] = T.n;
      const land = P[p].hand.find(isLand);
      if (land) { P[p].hand.splice(P[p].hand.indexOf(land), 1); if (!act(p, { type: 'enter', zone: 'battlefield', land: true, cards: [land] }).ok) P[p].hand.push(land); }
      // Cast up to two spells (mana is ignored in this test).
      for (let k = 0; k < 2; k++) {
        const c = P[p].hand.find(x => !isLand(x));
        if (!c) break;
        P[p].hand.splice(P[p].hand.indexOf(c), 1);
        const card = { d: c.d, face: 0 };
        const md = Cards.modesOf(card);
        const mode = md ? [0] : undefined;
        const reqs = Cards.targetReqs(card, mode);
        const tg = reqs.map(r => target(r, p));
        if (reqs.some((r, i) => !r.upTo && !tg[i].length)) { P[p].hand.push(c); continue; }
        const r = act(p, { type: 'enter', zone: 'stack', cast: true, cards: [c], tg, mode });
        if (!r.ok) P[p].hand.push(c);
        settle();
      }
      // Commander from the command zone sometimes.
      const cm = Object.values(s.cards).find(c => c.owner === p && c.zone === 'command' && c.cmdr);
      if (cm && rnd() < 0.5) { act(p, { type: 'move', ids: [cm.id], to: 'stack', cast: true }); settle(); }
      continue;
    }
    act(p, { type: 'advance', goal: R.Engine ? 'combat' : 'combat' });
    continue;
  }
  if (ph === 'Declare attackers' && !(s.combat && s.combat.n === T.n)) {
    const list = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === p && Cards.isType(c, 'creature') && !c.tapped && !R.sick(s, c) && !Cards.has(c, 'defender', s)).filter(() => rnd() < 0.7)
      .map(c => ({ id: c.id, p: seats.find(q => q !== p && !s.players[q].lost) }));
    const r = act(p, { type: 'attack', list });
    if (!r.ok) act(p, { type: 'attack', list: [] });
    continue;
  }
  if (ph === 'Main 2' && !T.goal) { act(p, { type: 'advance', goal: 'end' }); continue; }
  if (!T.goal && !s.prio && !R.stackCards(s).length) { act(p, { type: 'advance', goal: 'end' }); continue; }
}
const logs = s.log.map(l => l.text);
stats.trig = logs.filter(t => / triggered/.test(t)).length;
const engineProblems = logs.filter(t => /Rules engine problem/.test(t));
console.log(`${P.A.name} vs ${P.B.name}: turn ${s.turn.n}, winner ${s.winner || '-'}, life ${seats.map(p => s.players[p].life).join('/')}`);
console.log('stats', JSON.stringify(stats));
console.log('problems', problems.length, problems.slice(0, 5).join('\n'));
console.log('engine problems', engineProblems.length, [...new Set(engineProblems)].slice(0, 8).join('\n'));
if (process.env.LOG) console.log(logs.slice(-+process.env.LOG).join('\n'));
fs.writeFileSync(__dirname + '/sim_' + deckIdx.join('_') + '.log', logs.join('\n'));
