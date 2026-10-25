// The movement checkpoint: replacement effects, tokens lingering a moment, commanders going home, counter rules, suspend.
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
require('../site/cards.js'); require('../site/effects.js'); require('../site/oracle.js'); require('../site/rules.js'); require('../site/engine.js');
const R = globalThis.Rules, I = R._int, assert = require('assert');
const s = R.newState();
const ok = (pid, a) => { const r = R.apply(s, pid, a); if (!r.ok) throw new Error(pid + ' ' + a.type + ': ' + r.err); return r; };
const D = (n, t, o, extra) => ({ n, cmc: (extra && extra.cmc) || 0, faces: [Object.assign({ n, t, o: o || '', img: '', p: '', tg: '', mc: '' }, extra || {})] });
for (const p of ['A', 'B']) ok(p, { type: 'join', name: p });
ok('A', { type: 'start' }); for (const p of ['A', 'B']) { s.players[p].kept = true; s.players[p].online = true; }
s.seats = ['A', 'B']; s.turn.active = 'A'; s.turn.phase = R.PI('Main 1');
const bear = (id, extra) => ({ id, d: D('Bear ' + id, 'Creature — Bear', '', Object.assign({ p: '2', tg: '2', cmc: 2 }, extra || {})) });

// Rest in Peace: anything headed to a graveyard is exiled instead.
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'rip', d: D('Rest in Peace', 'Enchantment', 'When Rest in Peace enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.') }] });
ok('A', { type: 'enter', zone: 'battlefield', cards: [bear('b1')] });
const n1 = []; I.moveOne(s, s.cards.b1, 'graveyard', 'top', null, n1);
assert.equal(s.cards.b1.zone, 'exile', n1.join('; '));
console.log('rip:', n1.filter(x => /instead/.test(x)));
I.moveOne(s, s.cards.rip, 'exile', 'top', null, []);
// Leyline of the Void: only opponents' cards.
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'lev', d: D('Leyline of the Void', 'Enchantment', "If a card or token would be put into an opponent's graveyard from anywhere, exile it instead.") }] });
ok('A', { type: 'enter', zone: 'battlefield', cards: [bear('b2')] }); ok('B', { type: 'enter', zone: 'battlefield', cards: [bear('b3')] });
I.moveOne(s, s.cards.b2, 'graveyard', 'top', null, []); I.moveOne(s, s.cards.b3, 'graveyard', 'top', null, []);
assert.equal(s.cards.b2.zone, 'exile'); assert.equal(s.cards.b3.zone, 'graveyard');
I.moveOne(s, s.cards.lev, 'exile', 'top', null, []);
console.log('leyline ok');

// Tokens: a moment in the graveyard ("dies" sees it), then gone.
I.makeToken(s, 'A', I.tokenD({ what: 'Spirit', p: '1', t: '1' }), 1, false, []);
const tok = Object.values(s.cards).find(c => c.token && c.zone === 'battlefield');
const seen = []; const em = Engine.emit; Engine.emit = ev => { if (ev.type === 'zone') seen.push(ev.to); return em(ev); };
I.moveOne(s, tok, 'graveyard', 'top', null, []);
Engine.emit = em;
assert.equal(tok.zone, 'ghost'); assert.equal(tok.ghostZone, 'graveyard'); assert(seen.includes('graveyard'));
assert.equal(R.zoneCards(s, 'graveyard', 'A', 'owner').filter(c => c.token).length, 0, 'not counted as a graveyard card');
tok.ghostAt = 0; R.fixUp(s); assert(!s.cards[tok.id]);
console.log('token ok');

// Commanders: an AI seat's commander goes home by itself; a person is asked.
s.players.B.ai = { by: 'A', skill: 'normal' };
ok('B', { type: 'enter', zone: 'battlefield', cards: [Object.assign(bear('cmB'), { cmdr: true })] });
I.moveOne(s, s.cards.cmB, 'graveyard', 'top', null, []);
assert.equal(s.cards.cmB.zone, 'command', 'AI commander to the command zone');
ok('A', { type: 'enter', zone: 'battlefield', cards: [Object.assign(bear('cmA'), { cmdr: true })] });
I.moveOne(s, s.cards.cmA, 'exile', 'top', null, []);
assert.equal(s.cards.cmA.zone, 'exile');
let ask = (s.ask || []).find(a => a.kind === 'cmdrZone' && a.card === 'cmA'); assert(ask, 'asked');
Engine.answer(s, 'A', { id: ask.id, command: true }, []); s.ask = s.ask.filter(a => a !== ask);
assert.equal(s.cards.cmA.zone, 'command');
// To the hand: it waits in the command zone; the owner may still take it into their hand.
I.moveOne(s, s.cards.cmA, 'battlefield', 'top', { by: 'A' }, []);
I.moveOne(s, s.cards.cmA, 'hand', 'top', null, []);
assert.equal(s.cards.cmA.zone, 'command');
ask = s.ask.find(a => a.kind === 'cmdrZone' && a.card === 'cmA');
Engine.answer(s, 'A', { id: ask.id, command: false }, []); s.ask = s.ask.filter(a => a !== ask);
assert(!s.cards.cmA, 'went to the hand (private)');
assert((s.inbox.A || []).some(x => x.card.id === 'cmA' && x.to === 'hand'));
console.log('commander ok');

// Counters: +1/+1 and -1/-1 cancel; shield stops damage or destruction; finality exiles.
ok('A', { type: 'enter', zone: 'battlefield', cards: [bear('c1')] });
Object.assign(s.cards.c1.counters, { '+1/+1': 3, '-1/-1': 1 }); I.sba(s, []);
assert.deepEqual(s.cards.c1.counters, { '+1/+1': 2 });
s.cards.c1.counters.shield = 1;
Engine.run(s, { id: 'kill', ctrl: 'B', d: D('Murder', 'Instant', ''), ab: { name: 'Murder' } }, Effects.parse('Destroy target creature.').ops, [[{ c: 'c1' }]], []);
assert.equal(s.cards.c1.zone, 'battlefield'); assert(!s.cards.c1.counters.shield);
s.cards.c1.counters.finality = 1;
Engine.run(s, { id: 'kill2', ctrl: 'B', d: D('Murder', 'Instant', ''), ab: { name: 'Murder' } }, Effects.parse('Destroy target creature.').ops, [[{ c: 'c1' }]], []);
assert.equal(s.cards.c1.zone, 'exile', 'finality');
// Brutal Expulsion: "if that creature would die this turn, exile it instead".
ok('B', { type: 'enter', zone: 'battlefield', cards: [bear('c2', { tg: '2' })] });
Engine.run(s, { id: 'be', ctrl: 'A', d: D('Brutal Expulsion', 'Instant', ''), ab: { name: 'Brutal Expulsion' } }, Effects.parse('This deals 2 damage to target creature or planeswalker. If that creature or planeswalker would die this turn, exile it instead.').ops, [[{ c: 'c2' }]], []);
I.sba(s, []);
assert.equal(s.cards.c2.zone, 'exile');
// Unearth: back with haste, exiled if it would leave.
ok('A', { type: 'enter', zone: 'graveyard', cards: [{ id: 'ue', d: D('Dredged Zombie', 'Creature — Zombie', 'Unearth {B}', { p: '3', tg: '1', cmc: 3 }) }] });
for (const c of Object.values(s.cards)) if (c.zone === 'stack') delete s.cards[c.id]; s.tq = []; s.prio = null; s.turn.phase = R.PI('Main 1'); s.turn.active = 'A';
ok('A', { type: 'gyAct', id: 'ue', kind: 'unearth' });
assert.equal(s.cards.ue.zone, 'battlefield'); assert(Cards.has(s.cards.ue, 'haste', s));
I.moveOne(s, s.cards.ue, 'hand', 'top', null, []);
assert.equal(s.cards.ue.zone, 'exile', 'unearthed cards are exiled instead');
console.log('counters, unearth ok');

// Suspend: exiled with time counters, one comes off each upkeep, then it's cast free.
const sus = { id: 'su', d: D('Rift Test', 'Creature — Elemental', 'Suspend 2—{G}', { p: '3', tg: '3', cmc: 4, mc: '{3}{G}' }) };
ok('A', { type: 'enter', zone: 'exile', from: 'hand', suspend: true, cards: [sus] });
assert.equal(s.cards.su.counters.time, 2);
Engine.check(s, []); for (let i = 0; i < 2; i++) { s.turn.n++; s.turn.phase = R.PI('Upkeep'); Engine.check(s, []); }
assert(!s.cards.su.counters.time, 'time counters gone'); assert((s.todo.A || []).some(t => t.k === 'freeCast' && t.ids.includes('su')), 'may cast it');
console.log('suspend counters:', JSON.stringify(s.cards.su.counters), 'todo:', JSON.stringify((s.todo && s.todo.A || []).map(t => t.k)));
console.log('movement ok');
