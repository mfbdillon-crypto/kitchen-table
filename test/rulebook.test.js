// The rulebook: default limits, permissions from cards (can) and restrictions (can't), and how the table enforces them.
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
require('../site/cards.js'); require('../site/effects.js'); require('../site/oracle.js'); require('../site/rules.js'); require('../site/engine.js');
const R = globalThis.Rules, RB = globalThis.Rulebook, assert = require('assert');
const s = R.newState();
const ok = (pid, a) => { const r = R.apply(s, pid, a); if (!r.ok) throw new Error(pid + ' ' + a.type + ': ' + r.err); return r; };
const bad = (pid, a) => { const r = R.apply(s, pid, a); assert(!r.ok, a.type + ' should fail'); return r.err; };
const D = (n, t, o, extra) => ({ n, cmc: (extra && extra.cmc) || 0, faces: [Object.assign({ n, t, o: o || '', img: '', p: '', tg: '', mc: '' }, extra || {})] });
for (const p of ['A', 'B']) ok(p, { type: 'join', name: p });
ok('A', { type: 'start' });
// 103.5: nothing happens until everyone has kept.
s.seats = ['A', 'B']; s.turn.active = 'A'; s.turn.phase = R.PI('Main 1');
for (const p of ['A', 'B']) s.players[p].online = true;
ok('A', { type: 'player', patch: { kept: true } });
const err0 = bad('A', { type: 'enter', zone: 'battlefield', land: true, from: 'hand', cards: [{ id: 'l0', d: D('Forest', 'Basic Land — Forest') }] });
assert(/kept their opening hand/.test(err0), err0);
ok('B', { type: 'player', patch: { kept: true } });
ok('A', { type: 'enter', zone: 'battlefield', land: true, from: 'hand', cards: [{ id: 'l0', d: D('Forest', 'Basic Land — Forest') }] });
console.log('mulligans gate ok');

// Default: no casting from the graveyard.
ok('A', { type: 'enter', zone: 'graveyard', cards: [{ id: 'gbear', d: D('Grave Bear', 'Creature — Bear', '', { p: '2', tg: '2', cmc: 2 }) }, { id: 'gwall', d: D('Grave Wall', 'Artifact', '', { cmc: 2 }) }, { id: 'gland', d: D('Grave Forest', 'Basic Land — Forest') }] });
assert.equal(RB.ways(s, 'A', s.cards.gbear).length, 0);
const e1 = bad('A', { type: 'move', ids: ['gbear'], to: 'stack', cast: true });
assert(/graveyard/.test(e1), e1);
// Karador: one creature spell from the graveyard during each of your turns.
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'kar', d: D('Karador, Ghost Chieftain', 'Legendary Creature — Centaur Spirit', 'During each of your turns, you may cast a creature spell from your graveyard.', { p: '3', tg: '4' }) }] });
let w = RB.ways(s, 'A', s.cards.gbear);
assert.equal(w.length, 1, JSON.stringify(w)); assert(/Karador/.test(w[0].label));
assert.equal(RB.ways(s, 'A', s.cards.gwall).length, 0, 'not an artifact');
assert.equal(RB.ways(s, 'B', s.cards.gbear).length, 0, 'not for the other player');
ok('A', { type: 'move', ids: ['gbear'], to: 'stack', cast: true, perm: w[0].via });
R.apply(s, 'A', { type: 'pass' }); R.apply(s, 'B', { type: 'pass' });
console.log('bear zone after cast:', s.cards.gbear.zone);
ok('A', { type: 'enter', zone: 'graveyard', cards: [{ id: 'gbear2', d: D('Grave Bear 2', 'Creature — Bear', '', { p: '2', tg: '2', cmc: 2 }) }] });
assert.equal(RB.ways(s, 'A', s.cards.gbear2).length, 0, 'once per turn');
console.log('karador ok');

// Muldrotha: a land and one permanent of each type.
s.turn.permUse = {};
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'mul', d: D('Muldrotha, the Gravetide', 'Legendary Creature — Elemental Avatar', 'During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.', { p: '6', tg: '6' }) }] });
w = RB.ways(s, 'A', s.cards.gwall); assert(w.some(x => /Muldrotha/.test(x.label)), 'artifact via Muldrotha');
const wl = RB.ways(s, 'A', s.cards.gland); assert(wl.some(x => x.act === 'play'), 'land via Muldrotha');
console.log('muldrotha ok');

// Grafdigger's Cage: can't beats can.
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'cage', d: D("Grafdigger's Cage", 'Artifact', "Creature cards in graveyards and libraries can't enter the battlefield. Players can't cast spells from graveyards or libraries.") }] });
const blocked = []; w = RB.ways(s, 'A', s.cards.gbear2, { blocked });
assert.equal(w.length, 0); assert(blocked.length, 'blocked by the cage');
assert(RB.sheet(s, 'A').cant.some(e => e.id === 'no.gyLib'));
console.log('cage:', RB.why(s, 'A', s.cards.gwall).map(r => (r.ok ? '✓ ' : '✗ ') + r.act + ' ' + r.how + ' — ' + r.by).join(' | '));
ok('B', { type: 'move', ids: ['cage'], to: 'graveyard' });

// Flashback: the card's own permission.
ok('A', { type: 'enter', zone: 'graveyard', cards: [{ id: 'fb', d: D('Test Flashback', 'Sorcery', 'You gain 3 life.\nFlashback {1}{G}', { cmc: 1, mc: '{G}' }) }] });
w = RB.ways(s, 'A', s.cards.fb); assert(w.some(x => x.kind === 'flashback'), JSON.stringify(w));
console.log('flashback ok');

// Dragonlord Dromoka: opponents can't cast spells during its controller's turn.
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'dro', d: D('Dragonlord Dromoka', 'Legendary Creature — Elder Dragon', "This spell can't be countered.\nFlying, lifelink\nYour opponents can't cast spells during your turn.", { p: '5', tg: '7' }) }] });
const bolt = { id: 'bolt', owner: 'B', zone: 'hand', d: D('Bolt', 'Instant', 'Bolt deals 3 damage to any target.', { mc: '{R}', cmc: 1 }), counters: {} };
assert(RB.castBlock(s, 'B', bolt, { fromZone: 'hand' }), 'B is locked on A’s turn');
assert(!RB.castBlock(s, 'A', Object.assign({}, bolt, { owner: 'A' }), { fromZone: 'hand' }), 'A is not');
ok('A', { type: 'move', ids: ['dro'], to: 'graveyard' });
console.log('dromoka ok');

// Courser of Kruphix: lands from the top of the library; flash grants.
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'cou', d: D('Courser of Kruphix', 'Enchantment Creature — Centaur', 'Play with the top card of your library revealed.\nYou may play lands from the top of your library.', { p: '2', tg: '4' }) }] });
const top = { id: 'tl', owner: 'A', zone: 'library', d: D('Forest', 'Basic Land — Forest'), counters: {} };
assert(RB.ways(s, 'A', top, { top: true }).some(x => x.act === 'play'));
assert(RB.topView(s, 'A').all, 'revealed to everyone');
assert.equal(RB.ways(s, 'A', top).length, 0, 'only the top card');
console.log('courser ok');

// A temporary rule from a resolving spell (Avatar's Wrath).
const ops = Effects.parse("Until your next turn, your opponents can't cast spells from anywhere other than their hands.").ops;
assert.equal(ops[0].op, 'ruleFx');
Engine.run(s, { id: 'aw', ctrl: 'A', d: D("Avatar's Wrath", 'Sorcery', ''), ab: { name: "Avatar's Wrath" } }, ops, [], []);
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'kar2', d: D('Karador B', 'Legendary Creature — Centaur Spirit', 'During each of your turns, you may cast a creature spell from your graveyard.', { p: '3', tg: '4' }) }] });
ok('B', { type: 'enter', zone: 'graveyard', cards: [{ id: 'bgy', d: D('B Bear', 'Creature — Bear', '', { p: '2', tg: '2', cmc: 2 }) }] });
s.turn.active = 'B';
assert.equal(RB.ways(s, 'B', s.cards.bgy).length, 0, 'locked by the wrath');
RB.expire(s, 'turn', 'A');
assert(RB.ways(s, 'B', s.cards.bgy).length, 'wrath ended at A’s next turn');
s.turn.active = 'A';
console.log('temporary rule ok');

// Every pattern is reachable from a sample line (keeps the table honest as it grows).
const samples = { 'gy.lands': 'You may play lands from your graveyard.', 'top.cast': 'You may cast creature spells from the top of your library.', flash: 'You may cast creature spells as though they had flash.', 'no.mvLow': "Your opponents can't cast spells with mana value 3 or less." };
for (const [id, line] of Object.entries(samples)) assert(RB.readLine(line.toLowerCase().replace(/\.$/, ''), 'A', 'x', 'X', s).some(e => e.id === id), id);
console.log('rulebook ok');
