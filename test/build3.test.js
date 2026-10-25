// Ability-word spells whose second line says "that creature" / "that spell" (Dispatch, Stubborn Denial), hand-size
// conditions, and pre-game permanents not being summoning sick.
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
require('../site/cards.js'); require('../site/effects.js'); require('../site/oracle.js'); require('../site/rules.js'); require('../site/engine.js');
const R = globalThis.Rules, assert = require('assert');
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
