// Ability-word spells whose second line says "that creature" / "that spell" (Dispatch, Stubborn Denial), hand-size
// conditions, and pre-game permanents not being summoning sick.
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
require('../site/cards.js'); require('../site/effects.js'); require('../site/oracle.js'); require('../site/rules.js'); require('../site/engine.js');
const R = globalThis.Rules, I = R._int, assert = require('assert');
const s = R.newState();
const ok = (pid, a) => { const r = R.apply(s, pid, a); if (!r.ok) throw new Error(pid + ' ' + a.type + ': ' + r.err); return r; };
const D = (n, t, o, extra) => ({ n, cmc: (extra && extra.cmc) || 0, faces: [Object.assign({ n, t, o: o || '', img: '', p: '', tg: '', mc: '' }, extra || {})] });
const passAll = () => { for (let g = 0; g < 12 && s.prio && s.prio.holder; g++) ok(s.prio.holder, { type: 'pass' }); };
for (const p of ['A', 'B']) ok(p, { type: 'join', name: p });
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'pre', d: D('Early Bird', 'Creature — Bird', '', { p: '1', tg: '1' }) }] });
ok('A', { type: 'start' }); for (const p of ['A', 'B']) { s.players[p].kept = true; s.players[p].online = true; }
assert(!R.sick(s, s.cards.pre), 'in play before the game began: not summoning sick');
s.seats = ['A', 'B']; s.turn.active = 'A'; s.turn.phase = R.PI('Main 1'); s.turn.mulls = false;
s.players.A.libCount = 30; s.players.B.libCount = 30;

// Dispatch: tap target creature; with three artifacts, exile it.
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'vic', d: D('Victim', 'Creature — Ox', '', { p: '2', tg: '2' }) }, { id: 'vic2', d: D('Victim Two', 'Creature — Ox', '', { p: '2', tg: '2' }) }] });
const dispatch = D('Dispatch', 'Instant', 'Tap target creature.\nMetalcraft — If you control three or more artifacts, exile that creature.', { cmc: 1 });
s.dev = true;
ok('A', { type: 'enter', zone: 'stack', cast: true, alt: 'free', cards: [{ id: 'dp1', d: dispatch }], tg: [[{ c: 'vic' }]] });
s.dev = false;
passAll();
assert.equal(s.cards.vic.zone, 'battlefield'); assert(s.cards.vic.tapped, 'tapped only');
ok('A', { type: 'enter', zone: 'battlefield', cards: [1, 2, 3].map(i => ({ id: 'art' + i, d: D('Bauble ' + i, 'Artifact', '') })) });
s.dev = true;
ok('A', { type: 'enter', zone: 'stack', cast: true, alt: 'free', cards: [{ id: 'dp2', d: dispatch }], tg: [[{ c: 'vic2' }]] });
s.dev = false;
passAll();
assert.equal(s.cards.vic2.zone, 'exile', 'metalcraft exiles that creature');
console.log('dispatch ok');

// Stubborn Denial: with a 4-power creature, counter the spell outright.
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'big', d: D('Big One', 'Creature — Beast', '', { p: '4', tg: '4' }) }] });
s.dev = true;
ok('B', { type: 'enter', zone: 'stack', cast: true, alt: 'free', cards: [{ id: 'bspell', d: D('Some Sorcery', 'Sorcery', 'You gain 5 life.', { cmc: 3 }) }] });
ok('A', { type: 'enter', zone: 'stack', cast: true, alt: 'free', cards: [{ id: 'sd', d: D('Stubborn Denial', 'Instant', 'Counter target noncreature spell unless its controller pays {1}.\nFerocious — If you control a creature with power 4 or greater, counter that spell instead.', { cmc: 1 }) }], tg: [[{ c: 'bspell' }]] });
s.dev = false;
const lifeB = s.players.B.life;
passAll();
assert.notEqual(s.cards.bspell && s.cards.bspell.zone, 'stack'); assert.equal(s.players.B.life, lifeB, 'countered, no life gained');
assert(!(s.ask || []).some(q => q.kind === 'manual'), 'nothing left by hand: ' + JSON.stringify(s.ask));
console.log('stubborn denial ok');

// Hellbent / hand-size conditions.
s.players.A.handCount = 0;
assert.equal(Oracle.conditionHolds(s, { ctrl: 'A' }, 'you have no cards in hand'), true);
s.players.A.handCount = 3;
assert.equal(Oracle.conditionHolds(s, { ctrl: 'A' }, 'you have one or fewer cards in hand'), false);
console.log('build3 ok');

// Exchange control, adapt, lowest life.
const runT = (text, tg, by) => { const n = []; Engine.run(s, { id: 'x' + Math.random(), ctrl: by || 'A', d: D('Test', 'Sorcery', ''), ab: { name: 'Test' } }, Effects.parse(text).ops, tg || [], n); return n; };
console.log('targets:', JSON.stringify(Cards.targetsIn('Exchange control of two target creatures.')));
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'theirs', d: D('Theirs', 'Creature — Elk', '', { p: '3', tg: '3' }) }] });
runT('Exchange control of two target creatures.', [[{ c: 'big' }, { c: 'theirs' }]]);
assert.equal(s.cards.big.ctrl, 'B'); assert.equal(s.cards.theirs.ctrl, 'A');
const adaptSrc = { id: 'ad', ctrl: 'A', owner: 'A', zone: 'battlefield', counters: {}, d: D('Adapter', 'Creature — Mutant', '', { p: '1', tg: '1' }) }; s.cards.ad = adaptSrc;
const runSelf = text => Engine.run(s, adaptSrc, Effects.parse(text).ops, [], []);
runSelf('Adapt 2.'); runSelf('Adapt 2.');
assert.equal(s.cards.ad.counters['+1/+1'], 2, 'adapt only once while it has counters');
s.players.A.life = 30; s.players.B.life = 12;
runT("Each player's life total becomes the lowest life total among all players.");
assert.equal(s.players.A.life, 12);
console.log('exchange, adapt, lowest life ok');

// Double strike + trample against two blockers: the regular-step damage is assigned again (Bello vs Gitrog + Elves).
{
  const ds = D('Striker', 'Creature — Elemental', 'Double strike, trample', { p: '5', tg: '3' });
  for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && R.isType(c, 'creature')) delete s.cards[c.id];
  ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'ds', d: ds }] });
  ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'g6', d: D('Six', 'Creature — Frog', '', { p: '6', tg: '6' }) }, { id: 'e1', d: D('Elf', 'Creature — Elf', '', { p: '1', tg: '1' }) }] });
  s.cards.ds.ctlT = 0; s.cards.ds.tapped = true;
  const lb = s.players.B.life;
  s.combat = { n: s.turn.n, att: { ds: { def: { p: 'B' }, blk: ['g6', 'e1'] } }, waiting: [], ok: { B: true }, done: false, assign: { ds: { g6: 4, e1: 1 } } };
  I.combatDamage(s, []);
  assert.equal(s.cards.e1.zone !== 'battlefield' || s.cards.e1.dmg >= 1, true);
  assert.equal(s.players.B.life, lb - 3, 'second strike: 2 more is lethal to the 6/6, 3 tramples over (life ' + s.players.B.life + ')');
  s.combat = null;
  console.log('double strike trample ok');
}

// Mana: pain lands hurt only for colored mana; "spend this mana only" sources pay only for their spells; conditional mana.
{
  const W = D('Llanowar Wastes', 'Land', '{T}: Add {C}.\n{T}: Add {B} or {G}. Llanowar Wastes deals 1 damage to you.');
  ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'lw', d: W }, { id: 'fo', d: D('Forest', 'Basic Land — Forest', '') }, { id: 'gi', d: D('Giada, Font of Hope', 'Legendary Creature — Angel', '{T}: Add {W}. Spend this mana only to cast an Angel spell.', { p: '2', tg: '2' }) }] });
  const ms = Cards.manaSource(s.cards.lw);
  assert(ms.pain && /C/.test(ms.colors), JSON.stringify(ms));
  const src = id => { const m = Cards.manaSource(s.cards[id]); return Object.assign({ id }, m); };
  const p1 = Cards.pay(Cards.parseCost('{1}'), [src('lw')], 0); assert.deepEqual(p1.pain, [], 'colorless: no pain');
  const p2 = Cards.pay(Cards.parseCost('{B}{G}'), [src('lw'), src('fo')], 0); assert.deepEqual(p2.pain, ['lw'], 'black from the Wastes hurts');
  const life0 = s.players.A.life;
  ok('A', { type: 'tap', ids: [...p2], tapped: true, pay: true, pain: p2.pain });
  assert.equal(s.players.A.life, life0 - 1);
  assert.equal(Cards.pay(Cards.parseCost('{1}'), [src('gi')], 0), null, 'Giada mana not for an equip cost');
  assert(Cards.pay(Cards.parseCost('{1}'), [src('gi')], 0, { d: D('Some Angel', 'Creature — Angel', ''), counters: {} }), 'Giada mana for an Angel');
  assert.equal(Cards.manaSource({ d: D('Training Compound', 'Land', '{T}: Add {C}.\n{T}: Add {U}. Activate only if you control an artifact.'), counters: {} }).colors, 'C');
  console.log('mana rules ok');
}

// Bridgeworks Battle: "Target creature you control gets +2/+2… Then it fights up to one target creature you don't control."
{
  for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && R.isType(c, 'creature')) delete s.cards[c.id];
  ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'mine', d: D('Mine', 'Creature — Bear', '', { p: '3', tg: '3' }) }] });
  ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'foe', d: D('Foe', 'Creature — Bear', '', { p: '4', tg: '4' }) }] });
  s.dev = true;
  ok('A', { type: 'enter', zone: 'stack', cast: true, alt: 'free', cards: [{ id: 'bb', d: D('Bridgeworks Battle', 'Sorcery', "Target creature you control gets +2/+2 until end of turn. Then it fights up to one target creature you don't control.", { cmc: 3 }) }], tg: [[{ c: 'mine' }], [{ c: 'foe' }]] });
  s.dev = false; passAll();
  assert.equal(s.cards.foe ? s.cards.foe.zone : 'gone', s.cards.foe ? 'graveyard' : 'gone', 'the foe died (5 damage)');
  assert.equal(s.cards.mine.zone, 'battlefield'); assert.equal(s.cards.mine.dmg, 4, 'mine took 4');
  console.log('bridgeworks ok');
}

// Sanctuary Warden: enters with two shield counters; "remove a counter … If you do" needs a counter to remove.
{
  s.dev = true;
  ok('A', { type: 'enter', zone: 'stack', cast: true, alt: 'free', cards: [{ id: 'sw', d: D('Shield Bearer', 'Creature — Angel', 'Flying\nThis creature enters with two shield counters on it.', { p: '5', tg: '5', cmc: 6 }) }] });
  s.dev = false; passAll();
  assert.equal(s.cards.sw.counters.shield, 2, JSON.stringify(s.cards.sw.counters));
  const hc = s.players.A.handCount || 0, toks = Object.values(s.cards).filter(c => c.token).length;
  const ops = Effects.parse('You may remove a counter from this or another creature you control. If you do, draw a card and create a 1/1 colorless Citizen creature token.').ops;
  Engine.run(s, { id: 'wt', ctrl: 'A', d: s.cards.sw.d, ab: { name: 'Shield Bearer', src: 'sw' } }, ops, [], []);
  assert.equal(s.cards.sw.counters.shield, 1, 'one counter removed');
  for (const c of Object.values(s.cards)) if (c.ctrl === 'A' && c.counters) c.counters = {};
  const toks2 = Object.values(s.cards).filter(c => c.token).length;
  Engine.run(s, { id: 'wt2', ctrl: 'A', d: s.cards.sw.d, ab: { name: 'Shield Bearer', src: 'sw' } }, ops, [], []);
  assert.equal(Object.values(s.cards).filter(c => c.token).length, toks2, 'no counter, no token');
  console.log('warden ok', toks2 > toks);
}
