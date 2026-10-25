// v6 engine: triggers go on the stack by themselves, targets, "may", temporary effects, turn flow.
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
require('../site/cards.js'); require('../site/effects.js'); require('../site/oracle.js'); require('../site/rules.js'); require('../site/engine.js');
const R = globalThis.Rules, assert = require('assert');
const s = R.newState();
const ok = (pid, a) => { const r = R.apply(s, pid, a); if (!r.ok) throw new Error(pid + ' ' + a.type + ': ' + r.err); return r; };
const bad = (pid, a) => { const r = R.apply(s, pid, a); assert(!r.ok, a.type + ' should fail'); return r.err; };
const D = (n, t, o, extra) => ({ n, cmc: (extra && extra.cmc) || 0, faces: [Object.assign({ n, t, o: o || '', img: '', p: '', tg: '', mc: '' }, extra || {})] });
const tail = k => s.log.slice(-(k || 6)).map(l => l.text).join('\n   ');
const PH = () => R.PHASES[s.turn.phase];
const stack = () => R.stackCards(s);
const ackTodos = () => { for (const [p, L] of Object.entries(s.todo || {})) if (L.length && s.players[p]) R.apply(s, p, { type: 'todoAck', ids: L.map(t => t.id) }); };   // the devices finish their part
const passAll = () => { for (let g = 0; g < 12 && s.prio && s.prio.holder; g++) ok(s.prio.holder, { type: 'pass' }); };
for (const p of ['A', 'B']) ok(p, { type: 'join', name: p });
ok('A', { type: 'start' }); for (const p of ['A', 'B']) s.players[p].kept = true;
s.seats = ['A', 'B']; s.turn.active = 'A'; s.turn.first = 'A'; s.turn.starts = { A: 1 }; s.turn.phase = R.PI('Main 1');
for (const p of ['A', 'B']) s.players[p].online = true;

// --- Alesha: attack trigger puts a +1/+1 counter on it; raid end-step trigger checks "if you attacked this turn".
const alesha = D('Alesha, Who Laughs at Fate', 'Legendary Creature — Human Warrior',
  'First strike\nWhenever Alesha attacks, put a +1/+1 counter on it.\nRaid — At the beginning of your end step, if you attacked this turn, return target creature card with mana value less than or equal to Alesha\'s power from your graveyard to the battlefield.', { p: '2', tg: '2', mc: '{1}{B}{R}', cmc: 3 });
const m = Oracle.model({ d: alesha, face: 0 });
console.log('Alesha abilities:', m.abilities.map(a => a.kind + (a.event ? ':' + a.event.type + (a.event.step ? '/' + a.event.step : '') : '') + (a.condition ? ' if ' + a.condition : '')).join(' | '));
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'A-alesha', d: alesha }] });
s.cards['A-alesha'].ctlT = 0;
ok('A', { type: 'enter', zone: 'graveyard', cards: [{ id: 'A-bear', d: D('Grizzly Bears', 'Creature — Bear', '', { p: '2', tg: '2', cmc: 2 }) }] });
ok('A', { type: 'advance', goal: 'combat' });
assert.equal(PH(), 'Declare attackers', 'stops at declare attackers: ' + PH());
ok('A', { type: 'attack', list: [{ id: 'A-alesha', p: 'B' }] });
assert.equal(stack().length, 1, 'attack trigger on the stack');
console.log('after attack:\n  ', tail(3));
passAll();
assert.equal(s.cards['A-alesha'].counters['+1/+1'], 1, 'counter put on');
assert.equal(R.stackCards(s).length, 0);
// B declares no blockers → damage window → damage → main 2
ok('B', { type: 'block', list: [] });
passAll();
console.log('phase after combat:', PH(), '| B life', s.players.B.life);
assert.equal(PH(), 'Main 2'); assert.equal(s.players.B.life, 37);
ok('A', { type: 'advance', goal: 'end' });
console.log('end step:', PH(), 'stack', stack().map(c => c.ab && c.ab.name), 'ask', JSON.stringify(s.ask));
assert.equal(PH(), 'End step');
assert.equal(stack().length, 1, 'raid trigger on the stack');
assert.deepEqual(stack()[0].tg, [[{ c: 'A-bear' }]], 'only one legal target → chosen automatically');
passAll();
console.log('after raid:\n  ', tail(4));
assert.equal(s.cards['A-bear'].zone, 'battlefield', 'bear came back');
// The turn continued: B's turn, at main 1 (upkeep/draw passed by themselves)
console.log('now:', s.turn.active, PH());
assert.equal(s.turn.active, 'B'); assert.equal(PH(), 'Main 1');

// --- Blood Artist on B's side: whenever a creature dies, target player loses 1 life and you gain 1.
const artist = D('Blood Artist', 'Creature — Vampire', 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.', { p: '0', tg: '1' });
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'B-artist', d: artist }] });
const lifeA = s.players.A.life, lifeB = s.players.B.life;
ok('A', { type: 'move', ids: ['A-bear'], to: 'graveyard' });
console.log('dies → ask:', JSON.stringify((s.ask || []).map(x => [x.kind, x.pid, x.reqs && x.reqs[0].choices])));
const ask = s.ask.find(x => x.kind === 'targets');
assert(ask && ask.pid === 'B', 'B chooses the target');
ok('B', { type: 'answer', id: ask.id, tg: [[{ p: 'A' }]] });
assert.equal(stack().length, 1);
passAll();
assert.equal(s.players.A.life, lifeA - 1); assert.equal(s.players.B.life, lifeB + 1);
console.log('blood artist:\n  ', tail(3));

// --- "may": When this enters, you may draw a card. Optional → asked on resolution.
const scholar = D('Curious Scholar', 'Creature — Human', 'When this creature enters, you may draw a card.', { p: '1', tg: '1' });
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'B-sch', d: scholar }] });
passAll();
const may = s.ask.find(x => x.kind === 'may');
assert(may, 'asked "use it?"');
ok('B', { type: 'answer', id: may.id, yes: true });
assert(s.todo.B.some(t => t.k === 'draw'), 'draw todo');
ok('B', { type: 'todoAck', ids: s.todo.B.map(t => t.id) });   // the device draws, then clears it
console.log('may:\n  ', tail(2));

// --- protection until end of turn: a counter that goes away in cleanup
const pro = D('Gods Willing-ish', 'Instant', 'Target creature you control gains protection from red until end of turn.');
const it = { id: 'X1', ctrl: 'B', x: 0, ab: { name: 'Test', src: 'nowhere', ctx: {} } };
Engine.run(s, it, Effects.parse('Target creature you control gains protection from red until end of turn.').ops, [[{ c: 'B-artist' }]], [], {});
assert.equal(s.cards['B-artist'].counters['protection from red'], 1);
Engine.run(s, it, Effects.parse('Target creature gets +3/+3 and gains flying until end of turn.').ops, [[{ c: 'B-artist' }]], [], {});
console.log('badges:', JSON.stringify(s.cards['B-artist'].eot), Cards.pt(s, s.cards['B-artist']), [...Cards.keywords(s.cards['B-artist'], s)]);
ok('B', { type: 'advance', goal: 'end' });
console.log('end window:', PH(), s.prio && s.prio.step, s.prio && s.prio.holder); passAll();
console.log('after B end turn:', s.turn.active, PH(), 'counters', JSON.stringify(s.cards['B-artist'].counters), 'eot', s.cards['B-artist'].eot);
assert(!s.cards['B-artist'].counters['protection from red'], 'protection counter removed at end of turn');
assert(!s.cards['B-artist'].counters.flying);
assert.deepEqual(Cards.pt(s, s.cards['B-artist']), [0, 1]);

// --- upkeep trigger stops the flow until it resolves
const upk = D('Phyrexian Arena-ish', 'Enchantment', 'At the beginning of your upkeep, you draw a card and you lose 1 life.');
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'A-arena', d: upk }] });
ok('A', { type: 'advance', goal: 'end' }); passAll();
console.log('A ends turn →', s.turn.active, PH(), 'stack', stack().map(c => c.ab && c.ab.name));
ok('B', { type: 'advance', goal: 'end' }); while (s.prio && s.prio.step === 'end') ok(s.prio.holder, { type: 'pass' });
console.log('B ends turn →', s.turn.active, PH(), 'stack', stack().map(c => c.ab && c.ab.name));
assert.equal(s.turn.active, 'A'); assert.equal(PH(), 'Upkeep'); assert.equal(stack().length, 1);
const la = s.players.A.life; passAll();
for (const [p, L] of Object.entries(s.todo || {})) if (L.length) ok(p, { type: 'todoAck', ids: L.map(t => t.id) });   // devices finish their draws
assert.equal(s.players.A.life, la - 1); assert.equal(PH(), 'Main 1', 'flow continued to main 1');
// phase can't go backwards
assert.equal(R.apply(s, 'A', { type: 'phase', to: R.PI('Upkeep') }).stale, true);
// manual trigger action refused for engine-handled abilities
console.log('manual trigger:', R.apply(s, 'A', { type: 'trigger', id: 'A-arena', i: 0 }).err);
console.log('engine ok');

// --- alternative costs: flashback exiles, kicker condition, overload hits each, evoke sacrifices
{
  const T = s.turn; T.phase = R.PI('Main 1');
  const me = T.active, foe = s.seats.find(p => p !== me);
  const fb = D('Think Twice-ish', 'Instant', 'Draw a card.\nFlashback {2}{U}', { mc: '{1}{U}' });
  ok(me, { type: 'enter', zone: 'graveyard', cards: [{ id: 'fb1', d: fb }] });
  ok(me, { type: 'move', ids: ['fb1'], to: 'stack', cast: true, alt: 'flashback' });
  passAll();
  console.log('flashback →', s.cards.fb1 && s.cards.fb1.zone);
  assert.equal(s.cards.fb1.zone, 'exile');
  ok(foe, { type: 'enter', zone: 'battlefield', cards: [{ id: 'f1', d: D('Bear A', 'Creature — Bear', '', { p: '2', tg: '2' }) }, { id: 'f2', d: D('Bear B', 'Creature — Bear', '', { p: '2', tg: '2' }) }] });
  const rift = D('Rift-ish', 'Instant', "Return target nonland permanent you don't control to its owner's hand.\nOverload {6}{U}", { mc: '{1}{U}' });
  ok(me, { type: 'enter', zone: 'stack', cast: true, alt: 'overload', cards: [{ id: 'rift', d: rift }] });
  passAll();
  console.log('overload →', s.cards.f1, s.cards.f2, (s.inbox[foe] || []).map(x => x.card.id));
  assert(!s.cards.f1 && !s.cards.f2, 'both bounced');
  const kick = D('Burst-ish', 'Instant', "Kicker {4}\nThis spell deals 3 damage to any target. If this spell was kicked, it deals 6 damage instead.", { mc: '{R}' });
  const l0 = s.players[foe].life;
  ok(me, { type: 'enter', zone: 'stack', cast: true, alt: 'kicker', cards: [{ id: 'kb', d: kick }], tg: [[{ p: foe }]] });
  passAll();
  console.log('kicker →', l0, '→', s.players[foe].life);
  assert.equal(s.players[foe].life, l0 - 6);
  const ev = D('Shriekmaw-ish', 'Creature — Elemental', 'Fear\nWhen this creature enters, destroy target nonartifact, nonblack creature.\nEvoke {1}{B}', { p: '3', tg: '2', mc: '{4}{B}' });
  ok(foe, { type: 'enter', zone: 'battlefield', cards: [{ id: 'f3', d: D('Bear C', 'Creature — Bear', '', { p: '2', tg: '2', mc: '{1}{G}' }) }] });
  ok(me, { type: 'enter', zone: 'stack', cast: true, alt: 'evoke', cards: [{ id: 'ev', d: ev }] });
  passAll();
  for (let g = 0; g < 5 && (s.ask || []).length; g++) { const a = s.ask[0]; if (a.kind === 'order') ok(a.pid, { type: 'answer', id: a.id, order: a.items.map(x => x.id).reverse() }); else if (a.kind === 'targets') ok(a.pid, { type: 'answer', id: a.id, tg: [[a.reqs[0].choices[0]]] }); else ok(a.pid, { type: 'answer', id: a.id, yes: true }); passAll(); }
  passAll();
  console.log('evoke →', s.cards.ev && s.cards.ev.zone, s.cards.f3 && s.cards.f3.zone, tail(12), JSON.stringify(s.ask), JSON.stringify(Oracle.model({d:ev,face:0}).abilities.map(a=>[a.kind,a.event&&a.event.type])));
  assert.equal(s.cards.ev.zone, 'graveyard'); assert.equal(s.cards.f3.zone, 'graveyard');
  console.log('alt costs ok');
}

// --- two blockers: the attacker divides damage; legend rule asks which to keep
{
  const T = s.turn; const me = T.active, foe = s.seats.find(p => p !== me);
  // fresh turn for "me" so combat is possible
  s.combat = null; T.phase = R.PI('Main 1'); T.goal = null;
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'big', d: D('Big Ogre', 'Creature — Ogre', 'Trample', { p: '6', tg: '6' }) }] }); s.cards.big.ctlT = 0;
  ok(foe, { type: 'enter', zone: 'battlefield', cards: [{ id: 'b1', d: D('Wall 1', 'Creature — Wall', '', { p: '0', tg: '2' }) }, { id: 'b2', d: D('Wall 2', 'Creature — Wall', '', { p: '0', tg: '3' }) }] });
  ok(me, { type: 'advance', goal: 'combat' }); passAll();
  ok(me, { type: 'attack', list: [{ id: 'big', p: foe }] }); passAll();
  ok(foe, { type: 'block', list: [{ id: 'b1', att: 'big' }, { id: 'b2', att: 'big' }] }); passAll();
  const as = (s.ask || []).find(a => a.kind === 'assign');
  console.log('assign ask:', JSON.stringify(as && as.blockers), as && as.power);
  assert(as, 'attacker is asked to divide damage');
  console.log('bad split:', bad(me, { type: 'answer', id: as.id, assign: { b1: 1, b2: 2, player: 3 } }));
  const lf = s.players[foe].life;
  ok(me, { type: 'answer', id: as.id, assign: { b1: 2, b2: 3, player: 1 } });
  console.log('after split:', s.cards.b1 && s.cards.b1.zone, s.cards.b2 && s.cards.b2.zone, lf, '→', s.players[foe].life, PH());
  assert.equal(s.players[foe].life, lf - 1); assert.equal(s.cards.b1.zone, 'graveyard'); assert.equal(s.cards.b2.zone, 'graveyard');
  const leg = D('Hero of Legend', 'Legendary Creature — Human', '', { p: '2', tg: '2' });
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'L1', d: leg }] });
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'L2', d: leg }] });
  const la = (s.ask || []).find(a => a.kind === 'legend');
  assert(la, 'legend rule asks');
  ok(me, { type: 'answer', id: la.id, keep: 'L1' });
  assert.equal(s.cards.L1.zone, 'battlefield'); assert.equal(s.cards.L2.zone, 'graveyard');
  console.log('legend rule:', tail(1));
  console.log('combat/legend ok');
}

// --- keyword triggers: extort, prowess, exalted; "your opponents' creatures enter tapped"
{
  const T = s.turn; const me = T.active, foe = s.seats.find(p => p !== me);
  T.phase = R.PI('Main 1'); T.goal = null; s.combat = null;
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'bo', d: D('Blind Obedience', 'Enchantment', 'Extort\nArtifacts and creatures your opponents control enter tapped.') }, { id: 'pl1', d: D('Plains', 'Basic Land — Plains', '({T}: Add {W}.)') }] });
  ok(foe, { type: 'enter', zone: 'battlefield', cards: [{ id: 'fb', d: D('Foe Bear', 'Creature — Bear', '', { p: '2', tg: '2' }) }] });
  assert(s.cards.fb.tapped, 'opponent creature entered tapped');
  const lf = s.players[foe].life, lm = s.players[me].life;
  ok(me, { type: 'enter', zone: 'stack', cast: true, cards: [{ id: 'ins', d: D('Opt-ish', 'Instant', 'Draw a card.') }] });
  for (let g = 0; g < 6; g++) { const a = (s.ask || []).find(x => x.kind === 'may'); if (a) ok(a.pid, { type: 'answer', id: a.id, yes: true }); passAll(); }
  console.log('extort:', lf, '→', s.players[foe].life, '|', lm, '→', s.players[me].life, '| plains tapped', s.cards.pl1.tapped);
  assert.equal(s.players[foe].life, lf - 1); assert.equal(s.players[me].life, lm + 1); assert(s.cards.pl1.tapped, 'paid {W/B} with the Plains');
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'mk', d: D('Monk', 'Creature — Human Monk', 'Prowess', { p: '1', tg: '2' }) }] });
  ok(me, { type: 'enter', zone: 'stack', cast: true, cards: [{ id: 'ins2', d: D('Opt-ish', 'Instant', 'Draw a card.') }] });
  for (let g = 0; g < 6; g++) { const o = (s.ask || []).find(x => x.kind === 'order'); if (o) ok(o.pid, { type: 'answer', id: o.id, order: o.items.map(x => x.id) }); const a = (s.ask || []).find(x => x.kind === 'may'); if (a) ok(a.pid, { type: 'answer', id: a.id, yes: false }); passAll(); }
  console.log('prowess:', Cards.pt(s, s.cards.mk), JSON.stringify(s.cards.mk.eot));
  assert.deepEqual(Cards.pt(s, s.cards.mk), [2, 3]);
  console.log('keyword triggers ok');
}

// --- crew, sacrifice-cost mana ability, 0 toughness, conditional tapped land, toxic
{
  const T = s.turn; const me = T.active, foe = s.seats.find(p => p !== me);
  T.phase = R.PI('Main 1'); T.goal = null; s.combat = null;
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'veh', d: D('Smuggler Copter-ish', 'Artifact — Vehicle', 'Flying\nCrew 1', { p: '3', tg: '3' }) }, { id: 'pilot', d: D('Pilot', 'Creature — Human', '', { p: '1', tg: '1' }) }] });
  console.log('crew refused:', bad(me, { type: 'activate', id: 'veh', i: 0, crew: [] }));
  ok(me, { type: 'activate', id: 'veh', i: 0, crew: ['pilot'] }); passAll();
  console.log('crewed:', Rules.isType(s.cards.veh, 'creature'), s.cards.pilot.tapped, JSON.stringify(s.cards.veh.eot));
  assert(Cards.isType(s.cards.veh, 'creature'));
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'kyk', d: D('Kykar-ish', 'Legendary Creature — Bird Wizard', 'Flying\nSacrifice a Spirit: Add {R}.', { p: '1', tg: '3' }) }, { id: 'spi', d: D('Spirit', 'Token Creature — Spirit', 'Flying', { p: '1', tg: '1' }) }] });
  const pool0 = (s.players[me].pool || []).length;
  ok(me, { type: 'activate', id: 'kyk', i: 0, sac: 'spi' });
  console.log('sac mana:', s.players[me].pool, s.cards.spi);
  assert.equal((s.players[me].pool || []).length, pool0 + 1);
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'tc', d: D('Training Center-ish', 'Land', 'This land enters tapped unless you have two or more opponents.\n{T}: Add {U} or {R}.') }] });
  assert(s.cards.tc.tapped, 'two-player: enters tapped');
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'z0', d: D('Frail', 'Creature — Rat', '', { p: '1', tg: '1' }) }] });
  ok(me, { type: 'counter', id: 'z0', kind: '-1/-1', delta: 1 });
  console.log('0 toughness →', s.cards.z0 && s.cards.z0.zone);
  assert.equal(s.cards.z0.zone, 'graveyard');
  console.log('crew etc ok');
}

// --- threaten: gain control until end of turn, untap it, haste; control returns in cleanup
{
  const T = s.turn; const me = T.active, foe = s.seats.find(p => p !== me);
  T.phase = R.PI('Main 1'); T.goal = null; s.combat = null;
  ok(foe, { type: 'enter', zone: 'battlefield', cards: [{ id: 'ogre', d: D('Ogre', 'Creature — Ogre', '', { p: '3', tg: '3' }) }] });
  s.cards.ogre.tapped = true;
  ok(me, { type: 'enter', zone: 'stack', cast: true, tg: [[{ c: 'ogre' }]], cards: [{ id: 'thr', d: D('Threaten', 'Sorcery', 'Untap target creature and gain control of it until end of turn. That creature gains haste until end of turn.') }] });
  assert(!s.prio.holder, 'no priority while trigger order is being chosen');
  for (let g = 0; g < 8; g++) { const o = (s.ask || []).find(x => x.kind === 'order'); if (o) ok(o.pid, { type: 'answer', id: o.id, order: o.items.map(x => x.id) }); const a = (s.ask || []).find(x => x.kind === 'may'); if (a) ok(a.pid, { type: 'answer', id: a.id, yes: false }); passAll(); }
  console.log('threaten:', s.cards.ogre.ctrl === me, s.cards.ogre.tapped, JSON.stringify(s.cards.ogre.eot), tail(3));
  assert.equal(s.cards.ogre.ctrl, me); Engine.endOfTurn(s); assert.equal(s.cards.ogre.ctrl, foe); s.cards.ogre.tapped = true;
  ok(me, { type: 'enter', zone: 'stack', cast: true, tg: [[{ c: 'ogre' }]], cards: [{ id: 'thr2', d: D('Act of Treason', 'Sorcery', 'Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.') }] });
  for (let g = 0; g < 8; g++) { const o = (s.ask || []).find(x => x.kind === 'order'); if (o) ok(o.pid, { type: 'answer', id: o.id, order: o.items.map(x => x.id) }); const a = (s.ask || []).find(x => x.kind === 'may'); if (a) ok(a.pid, { type: 'answer', id: a.id, yes: false }); passAll(); }
  assert.equal(s.cards.ogre.ctrl, me); assert(!s.cards.ogre.tapped);
  R._int ? null : null;
  Engine.endOfTurn(s);
  assert.equal(s.cards.ogre.ctrl, foe, 'control returns at cleanup');
  console.log('threaten ok');
}

// --- Teysa Karlov: a creature dying makes death triggers trigger an additional time
{
  const T = s.turn; const me = T.active, foe = s.seats.find(p => p !== me);
  T.phase = R.PI('Main 1'); T.goal = null; s.combat = null;
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'tey', d: D('Teysa Karlov', 'Legendary Creature — Human Advisor', 'If a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.\nCreature tokens you control have vigilance and lifelink.', { p: '2', tg: '4' }) }, { id: 'zul', d: D('Zulaport Cutthroat', 'Creature — Human Rogue Ally', 'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.', { p: '1', tg: '1' }) }, { id: 'fod', d: D('Fodder', 'Creature — Goblin', '', { p: '1', tg: '1' }) }] });
  const lf = s.players[foe].life;
  ok(me, { type: 'move', ids: ['fod'], to: 'graveyard', sac: true });
  for (let g = 0; g < 8; g++) { const o = (s.ask || []).find(x => x.kind === 'order'); if (o) ok(o.pid, { type: 'answer', id: o.id, order: o.items.map(x => x.id) }); passAll(); }
  console.log('teysa:', lf, '→', s.players[foe].life);
  assert.equal(s.players[foe].life, lf - 2);
  console.log('teysa ok');
}

// --- Giada (enters with counters), Angel of Vitality (lifegain +1, +2/+2 at 25+), Righteous Valkyrie (anthem at starting life + 7)
{
  const T = s.turn; const me = T.active;
  T.phase = R.PI('Main 1'); T.goal = null; s.combat = null;
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'gia', d: D('Giada, Font of Hope', 'Legendary Creature — Angel', 'Flying, vigilance\nEach other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control.\n{T}: Add {W}. Spend this mana only to cast an Angel spell.', { p: '2', tg: '2' }) }] });
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'av1', d: D('Angel of Vitality', 'Creature — Angel', 'Flying\nIf you would gain life, you gain that much life plus 1 instead.\nAngel of Vitality gets +2/+2 as long as you have 25 or more life.', { p: '2', tg: '2' }) }] });
  console.log('giada counters on vitality:', JSON.stringify(s.cards.av1.counters));
  assert.equal(s.cards.av1.counters['+1/+1'], 1);
  s.players[me].life = 30;
  console.log('vitality p/t at 30 life:', Cards.pt(s, s.cards.av1));
  assert.deepEqual(Cards.pt(s, s.cards.av1), [5, 5]);
  const before = s.players[me].life;
  R._int.gainLife(s, me, 2);
  assert.equal(s.players[me].life, before + 3, 'gain 2 → 3 with Angel of Vitality');
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'rv', d: D('Righteous Valkyrie', 'Creature — Angel Cleric', 'Flying\nAs long as you have at least 7 life more than your starting life total, creatures you control get +2/+2.', { p: '4', tg: '5' }) }] });
  s.players[me].life = 50;
  console.log('valkyrie anthem: giada', Cards.pt(s, s.cards.gia), 'valkyrie', Cards.pt(s, s.cards.rv));
  assert.deepEqual(Cards.pt(s, s.cards.gia), [4, 4]);
  console.log('angels ok');
}

// --- "cast an instant or sorcery spell" (Guttersnipe), Gitrog (land to graveyard → draw; upkeep sacrifice-unless)
{
  const T = s.turn; const me = T.active, foe = s.seats.find(p => p !== me);
  T.phase = R.PI('Main 1'); T.goal = null; s.combat = null;
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'gut', d: D('Guttersnipe', 'Creature — Goblin Shaman', 'Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.', { p: '2', tg: '2' }) }] });
  const lf = s.players[foe].life;
  ok(me, { type: 'enter', zone: 'stack', cast: true, cards: [{ id: 'opt2', d: D('Opt-ish', 'Instant', 'Draw a card.') }] });
  for (let g = 0; g < 8; g++) { const o = (s.ask || []).find(x => x.kind === 'order'); if (o) ok(o.pid, { type: 'answer', id: o.id, order: o.items.map(x => x.id) }); const a = (s.ask || []).find(x => x.kind === 'may'); if (a) ok(a.pid, { type: 'answer', id: a.id, yes: false }); passAll(); }
  console.log('guttersnipe:', lf, '→', s.players[foe].life);
  assert.equal(s.players[foe].life, lf - 2);
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'git', d: D('The Gitrog Monster', 'Legendary Creature — Frog Horror', 'Deathtouch\nAt the beginning of your upkeep, sacrifice The Gitrog Monster unless you sacrifice a land.\nYou may play an additional land on each of your turns.\nWhenever one or more land cards are put into your graveyard from anywhere, draw a card.', { p: '6', tg: '6' }) }, { id: 'gl', d: D('Swamp', 'Basic Land — Swamp', '({T}: Add {B}.)') }] });
  const td0 = ((s.todo || {})[me] || []).length;
  ok(me, { type: 'move', ids: ['gl'], to: 'graveyard', sac: true });
  for (let g = 0; g < 6; g++) passAll();
  const draws = ((s.todo || {})[me] || []).filter(t => t.k === 'draw' && /Gitrog/.test(t.src)).length;
  console.log('gitrog draw todos:', draws);
  assert(draws >= 1, 'Gitrog draws when a land goes to the graveyard');
  console.log('cast-type and gitrog ok');
}

// --- Regeneration shield (Swarmyard) and */* counting (Pack Rat)
{
  const T = s.turn; const me = T.active;
  T.phase = R.PI('Main 1'); T.goal = null; s.combat = null;
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'swy', d: D('Swarmyard', 'Land', '{T}: Add {C}.\n{T}: Regenerate target Rat, Ninja, or Squirrel.') }, { id: 'rat1', d: D('Pack Rat', 'Creature — Rat', "Pack Rat's power and toughness are each equal to the number of Rats you control.", { p: '*', tg: '*' }) }, { id: 'rat2', d: D('Rat', 'Creature — Rat', '', { p: '1', tg: '1' }) }] });
  console.log('pack rat:', Cards.pt(s, s.cards.rat1));
  const nRats = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === me && /\bRat\b/.test(Rules.typeLine(c))).length;
  const st0 = Cards.statics(s, s.cards.rat1);
  assert.deepEqual(Cards.pt(s, s.cards.rat1), [nRats + st0.p, nRats + st0.t]);
  ok(me, { type: 'activate', id: 'swy', i: Cards.abilities(s.cards.swy).findIndex(a => /regenerate/i.test(a.text)), tg: [[{ c: 'rat2' }]] }); passAll();
  s.cards.rat2.dmg = 5; ok(me, { type: 'counter', id: 'rat1', kind: '+1/+1', delta: 0 });
  Rules._int.sba(s, []);
  console.log('regenerated rat:', s.cards.rat2.zone, s.cards.rat2.tapped);
  assert.equal(s.cards.rat2.zone, 'battlefield');
  console.log('regen ok');
}

// --- Mutate (702.140): merge onto a non-Human host, "whenever this creature mutates", leaves together
{
  const T = s.turn; const me = T.active, foe = s.seats.find(p => p !== me);
  T.phase = R.PI('Main 1'); T.goal = null; s.combat = null;
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'mhost', d: D('Grizzly Bears', 'Creature — Bear', '', { p: '2', tg: '2' }) }, { id: 'mhum', d: D('Village Guy', 'Creature — Human', '', { p: '1', tg: '1' }) }] });
  ok(foe, { type: 'enter', zone: 'battlefield', cards: [{ id: 'mart', d: D('Shiny Rock', 'Artifact', '') }] });
  s.cards.mhost.counters['+1/+1'] = 1;
  const gem = { id: 'gem', d: D('Gemrazer', 'Creature — Beast', 'Mutate {1}{G}{G}\nReach, trample\nWhenever this creature mutates, destroy target artifact or enchantment an opponent controls.', { p: '4', tg: '4', mc: '{3}{G}' }) };
  bad(me, { type: 'enter', zone: 'stack', cast: true, alt: 'mutate', cards: [Object.assign({}, gem, { id: 'gemx' })], tg: [[{ c: 'mhum' }]] });
  ok(me, { type: 'enter', zone: 'stack', cast: true, alt: 'mutate', cards: [gem], tg: [[{ c: 'mhost' }]] });
  const drain = () => { for (let g = 0; g < 10; g++) { passAll(); for (const a of (s.ask || []).slice()) { if (a.kind === 'mutate') ok(a.pid, { type: 'answer', id: a.id, top: true }); else if (a.kind === 'targets') ok(a.pid, { type: 'answer', id: a.id, tg: a.reqs.map(r => r.choices.slice(0, r.upTo ? 0 : 1)) }); else if (a.kind === 'may') ok(a.pid, { type: 'answer', id: a.id, yes: true }); else if (a.kind === 'order') ok(a.pid, { type: 'answer', id: a.id, order: a.items.map(x => x.id) }); else if (a.kind === 'manual') ok(a.pid, { type: 'answer', id: a.id }); } } };
  drain();
  const h = s.cards.mhost;
  console.log('mutated:', R.cardName(h), Cards.pt(s, h), [...Cards.keywords(h, s)], s.cards.gem.zone, 'artifact:', s.cards.mart && s.cards.mart.zone);
  assert.equal(R.cardName(h), 'Gemrazer');
  assert.deepEqual(Cards.pt(s, h).slice(0, 2), [5 + Cards.statics(s, h).p, 5 + Cards.statics(s, h).t]);
  assert(Cards.keywords(h, s).has('trample'));
  assert.equal(s.cards.gem.zone, 'merged');
  assert(!s.cards.mart || s.cards.mart.zone === 'graveyard', 'the mutate trigger destroyed the artifact');
  ok(me, { type: 'move', ids: ['mhost'], to: 'graveyard' });
  console.log('after death:', s.cards.mhost.zone, R.cardName(s.cards.mhost), s.cards.gem.zone);
  assert.equal(s.cards.gem.zone, 'graveyard'); assert.equal(R.cardName(s.cards.mhost), 'Grizzly Bears');
  // Target gone: it resolves as an ordinary creature.
  drain(); console.log('stack now:', stack().map(c => R.cardName(c)));
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'mh2', d: D('Bear Two', 'Creature — Bear', '', { p: '2', tg: '2' }) }] });
  ok(me, { type: 'enter', zone: 'stack', cast: true, alt: 'mutate', cards: [Object.assign({}, gem, { id: 'gem2' })], tg: [[{ c: 'mh2' }]] });
  ok(me, { type: 'move', ids: ['mh2'], to: 'graveyard' });
  drain();
  console.log('fallback:', s.cards.gem2.zone);
  assert.equal(s.cards.gem2.zone, 'battlefield');
  console.log('mutate ok');
}

// --- Smothering Tithe (pay or else), Craterhoof (+X/+X where X = creatures), cost reductions, Illuna's dig
{
  const T = s.turn; const me = T.active, foe = s.seats.find(p => p !== me);
  T.phase = R.PI('Main 1'); T.goal = null; s.combat = null;
  const drain = () => { for (let g = 0; g < 10; g++) { passAll(); for (const a of (s.ask || []).slice()) { if (a.kind === 'targets') ok(a.pid, { type: 'answer', id: a.id, tg: a.reqs.map(r => r.choices.slice(0, r.upTo ? 0 : 1)) }); else if (a.kind === 'may') ok(a.pid, { type: 'answer', id: a.id, yes: true }); else if (a.kind === 'order') ok(a.pid, { type: 'answer', id: a.id, order: a.items.map(x => x.id) }); else if (a.kind === 'manual') ok(a.pid, { type: 'answer', id: a.id }); } } };
  drain();
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'tithe', d: D('Smothering Tithe', 'Enchantment', "Whenever an opponent draws a card, that player may pay {2}. If they don't, you create a Treasure token.") }] });
  const treasures = () => Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === me && /Treasure/.test(R.cardName(c))).length;
  const t0 = treasures();
  ok(foe, { type: 'log', text: 'drew 1', drew: 1 }); drain();
  let pa = (s.ask || []).find(a => a.kind === 'pay' && a.pid === foe);
  console.log('tithe ask:', pa && pa.cost);
  assert(pa, 'the drawing player is asked to pay');
  ok(foe, { type: 'answer', id: pa.id, yes: false }); drain();
  console.log('treasures:', t0, '→', treasures());
  assert.equal(treasures(), t0 + 1);
  // Craterhoof: +X/+X where X is the number of creatures I control.
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'hoof', d: D('Craterhoof Behemoth', 'Creature — Beast', 'Haste\nWhen Craterhoof Behemoth enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.', { p: '5', tg: '5' }) }] });
  drain();
  const nCre = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === me && Rules.isType(c, 'creature')).length;
  console.log('hoof mod:', s.cards.hoof.mod, 'creatures', nCre, [...Cards.keywords(s.cards.hoof, s)]);
  assert.deepEqual(s.cards.hoof.mod, [nCre, nCre]);
  assert(Cards.keywords(s.cards.hoof, s).has('trample'));
  // Blasphemous Act costs {1} less per creature on the battlefield.
  const all = Object.values(s.cards).filter(c => c.zone === 'battlefield' && Rules.isType(c, 'creature')).length;
  assert.equal(Cards.costReduction(s, { id: 'ba', owner: me, ctrl: me, zone: 'hand', counters: {}, face: 0, d: D('Blasphemous Act', 'Sorcery', 'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.', { mc: '{8}{R}' }) }, me), all);
  // Illuna: reveal until a nonland permanent → a 'dig' job for its owner.
  const dq = Effects.parse('exile cards from the top of your library until you exile a nonland permanent card. put that card onto the battlefield or into your hand.').ops;
  assert.equal(dq[0].op, 'dig'); assert.equal(dq[0].dest, 'either');
  console.log('tithe, hoof, reductions, dig ok');
}

// --- Fogs and additional sacrifice costs
{
  const T = s.turn; const me = T.active, foe = s.seats.find(p => p !== me);
  T.phase = R.PI('Main 1'); T.goal = null; s.combat = null;
  const ops = Effects.parse('prevent all combat damage that would be dealt this turn.').ops;
  assert.equal(ops[0].op, 'fog');
  const rites = { id: 'rites', d: D('Village Rites', 'Instant', 'As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.', { mc: '{B}' }) };
  const err = bad(me, { type: 'enter', zone: 'stack', cast: true, cards: [rites] });
  console.log('no sacrifice:', err);
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'fodder', d: D('Fodder', 'Creature — Thrull', '', { p: '1', tg: '1' }) }] });
  ok(me, { type: 'enter', zone: 'stack', cast: true, cards: [rites], sacCost: ['fodder'] });
  assert.equal(s.cards.fodder.zone, 'graveyard');
  console.log('fog and sacrifice cost ok');
}

// --- Parses: Ponder, Brainstorm, Lurking Predators, Nykthos, Mana Drain
{
  const P = t => Effects.parse(t).ops;
  assert.equal(P('look at the top three cards of your library, then put them back in any order. you may shuffle. draw a card.')[0].op, 'look');
  assert(P('look at the top three cards of your library, then put them back in any order.').every(o => o.op !== 'manual'));
  assert.equal(P('draw three cards, then put two cards from your hand on top of your library in any order.')[1].op, 'handToTop');
  const lp = P("reveal the top card of your library. if it's a creature card, put it onto the battlefield. otherwise, you may put that card on the bottom of your library.")[0];
  assert(lp.op === 'dig' && lp.top && lp.mayBottom);
  assert.equal(P('choose a color. add an amount of mana of that color equal to your devotion to that color.')[0].op, 'addDevotion');
  assert.equal(P("counter target spell. at the beginning of your next main phase, add an amount of {c} equal to that spell's mana value.")[1].op, 'delayedMana');
  console.log('look, brainstorm, top-card, devotion, mana drain parses ok');
}

// --- Impulse draw (Riku): exile the top card, may play it until the end of the next turn
{
  const P = t => Effects.parse(t).ops;
  const ip = P('exile the top card of your library. until the end of your next turn, you may play it.')[0];
  assert(ip.op === 'impulse' && ip.until === 'next' && ip.n === 1);
  assert.equal(P('exile the top three cards of your library. you may play them this turn.')[0].until, 'eot');
  const me = s.turn.active;
  ok(me, { type: 'enter', zone: 'exile', from: 'library', cards: [{ id: 'imp1', d: D('Shock', 'Instant', 'Shock deals 2 damage to any target.', { mc: '{R}' }) }], mayPlay: { until: 'eot', from: s.turn.n } });
  assert(s.cards.imp1.mayPlay && s.cards.imp1.mayPlay.until === 'eot');
  Engine.endOfTurn(s);
  assert(!s.cards.imp1.mayPlay, 'expires at end of turn');
  console.log('impulse ok');
}

// --- Rebound (Ephemerate): exiled as it resolves when cast from hand, then a free cast at the next upkeep
{
  const me = s.turn.active; s.turn.phase = R.PI('Main 1'); s.combat = null;
  for (let g = 0; g < 6; g++) passAll();
  ok(me, { type: 'enter', zone: 'stack', cast: true, from: 'hand', cards: [{ id: 'reb1', d: D('Bounce Again', 'Instant', 'Draw a card.\nRebound', { mc: '{W}' }) }] });
  for (let g = 0; g < 10; g++) { passAll(); for (const a of (s.ask || []).slice()) { if (a.kind === 'targets') ok(a.pid, { type: 'answer', id: a.id, tg: a.reqs.map(r => r.choices.slice(0, r.upTo ? 0 : 1)) }); else if (a.kind === 'may') ok(a.pid, { type: 'answer', id: a.id, yes: false }); else if (a.kind === 'order') ok(a.pid, { type: 'answer', id: a.id, order: a.items.map(x => x.id) }); else ok(a.pid, { type: 'answer', id: a.id }); } }
  console.log('rebound zone:', stack().map(c => R.cardName(c)), (s.ask || []).map(a => a.kind), s.prio);
  console.log('rebound zone:', s.cards.reb1 && s.cards.reb1.zone, s.cards.reb1 && s.cards.reb1.rebound);
  assert.equal(s.cards.reb1.zone, 'exile'); assert(s.cards.reb1.rebound);
  console.log('rebound ok');
}

// --- Teferi's Protection: life can't change, permanents phase out and back in at the next turn
{
  const me = s.turn.active;
  const ops = Effects.parse("until your next turn, your life total can't change and you gain protection from everything. all permanents you control phase out.").ops;
  assert.equal(ops[0].op, 'teferi');
  const n0 = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === me).length;
  Engine.run(s, { id: 'tp', ctrl: me, d: D("Teferi's Protection", 'Instant', ''), ab: { name: "Teferi's Protection" } }, ops, [], []);
  const lf = s.players[me].life;
  s.players[me].life -= 7; Engine.check(s, []);
  assert.equal(s.players[me].life, lf, 'life is locked');
  assert.equal(Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === me).length, 0);
  console.log('teferi: phased', Object.values(s.cards).filter(c => c.zone === 'phased').length, 'of', n0);
  console.log('teferi ok');
}

// --- Additional combat phase after the main phase (Aggravated Assault)
{
  const T = s.turn; for (let g = 0; g < 6; g++) passAll();
  s.ask = []; s.tq = []; s.prio = null; s.todo = {};
  T.phase = R.PI('Main 2'); T.extraAfterMain = 1; T.goal = 'pass'; s.combat = { n: T.n, att: {}, waiting: [], ok: {}, done: true };
  console.log('busy?', !!(R.stackTop(s) || s.prio || (s.tq && s.tq.length) || (s.ask || []).some(x => x.kind !== 'manual') || s.winner), T.goal);
  const nn = []; Engine.flow(s, nn);
  console.log('extra combat phase:', R.PHASES[T.phase], T.goal, nn.filter(x => /additional combat/.test(x)));
  assert(nn.some(x => /additional combat phase and main phase/.test(x)), 'went to an additional combat');
  console.log('extra combat ok');
}

// --- Planeswalker abilities written "[+2]: …" (the card data's format)
{
  const T = s.turn; const me = T.active, foe = s.seats.find(p => p !== me);
  T.phase = R.PI('Main 1'); T.goal = null; s.combat = null; for (let g = 0; g < 6; g++) passAll(); s.ask = [];
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'sorin', d: D('Sorin Test', 'Legendary Planeswalker — Sorin', '[+2]: Sorin Test deals 2 damage to any target and you gain 2 life.\n[-3]: Target opponent\'s life total becomes 10.', { loy: '4' }) }] });
  const abs = Cards.abilities(s.cards.sorin);
  assert.equal(abs.length, 2); assert.equal(abs[0].loyalty, 2);
  const lf = s.players[foe].life;
  ok(me, { type: 'activate', id: 'sorin', i: 0, tg: [[{ p: foe }]] }); passAll();
  console.log('sorin loyalty:', s.cards.sorin.counters.loyalty, 'foe life', lf, '→', s.players[foe].life);
  assert.equal(s.cards.sorin.counters.loyalty, 6);
  console.log('planeswalker ok');
}

// --- Killing Wave (pay X life per creature or sacrifice), Turn the Earth, Sigarda's Splendor's noted life
{
  const T = s.turn; const me = T.active, foe = s.seats.find(p => p !== me);
  for (let g = 0; g < 6; g++) passAll(); s.ask = []; s.tq = [];
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'kw1', d: D('Wave Bear', 'Creature — Bear', '', { p: '2', tg: '2' }) }, { id: 'kw2', d: D('Wave Elk', 'Creature — Elk', '', { p: '3', tg: '3' }) }] });
  ok(foe, { type: 'enter', zone: 'battlefield', cards: [{ id: 'kw3', d: D('Wave Rat', 'Creature — Rat', '', { p: '1', tg: '1' }) }] });
  const ops = Effects.parse('For each creature, its controller sacrifices it unless they pay X life.').ops;
  assert.equal(ops[0].op, 'payLifeOrSac');
  const l0 = s.players[me].life;
  Engine.run(s, { id: 'kwv', ctrl: me, d: D('Killing Wave', 'Sorcery', ''), ab: { name: 'Killing Wave' }, x: 3 }, ops, [], []);
  const myAsk = (s.ask || []).find(a => a.kind === 'payLife' && a.pid === me), foeAsk = (s.ask || []).find(a => a.kind === 'payLife' && a.pid === foe);
  if (!(myAsk && foeAsk)) console.log('ME', me, foe, ['kw1','kw2','kw3'].map(i => s.cards[i] && [s.cards[i].zone, s.cards[i].ctrl]), 'ASKS', JSON.stringify(s.ask), s.seats, Object.keys(s.players).map(p => [p, s.players[p].ai, s.players[p].online]));
  assert(myAsk && foeAsk, 'both players are asked');
  const nn = []; Engine.answer(s, me, { id: myAsk.id, ids: ['kw2'] }, nn); Engine.answer(s, foe, { id: foeAsk.id, ids: [] }, nn);
  console.log('killing wave:', nn.filter(x => /Killing Wave/.test(x)));
  assert.equal(s.cards.kw2.zone, 'battlefield'); assert.equal(s.cards.kw1.zone, 'graveyard'); assert.equal(s.cards.kw3.zone, 'graveyard');
  assert.equal(s.players[me].life, l0 - myAsk.life);
  // Turn the Earth: graveyard cards back into their owners' libraries.
  const te = Effects.parse('Choose up to three target cards in graveyards. The owners of those cards shuffle them into their libraries. You gain 2 life.').ops;
  assert.equal(te[0].op, 'move'); assert.equal(te[0].pos, 'shuffle');
  Engine.run(s, { id: 'tte', ctrl: me, d: D('Turn the Earth', 'Instant', ''), ab: { name: 'Turn the Earth' }, tg: [[{ c: 'kw1' }, { c: 'kw3' }]] }, te, [[{ c: 'kw1' }, { c: 'kw3' }]], []);
  const zt = id => s.cards[id] ? s.cards[id].zone : 'library (private)';
  console.log('turn the earth:', zt('kw1'), zt('kw3'));
  assert.notEqual(zt('kw1'), 'graveyard'); assert.notEqual(zt('kw3'), 'graveyard');
  // Sigarda's Splendor: draw only if life ≥ the noted life total, then note it again.
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'sig', d: D("Sigarda's Splendor", 'Enchantment', 'As this enchantment enters, note your life total.\nAt the beginning of your upkeep, draw a card if your life total is greater than or equal to the last noted life total for this enchantment. Then note your life total.') }] });
  s.cards.sig.noted = s.players[me].life + 5;
  const sp = Effects.parse('Draw a card if your life total is greater than or equal to the last noted life total for this enchantment. Then note your life total.').ops;
  assert(Oracle.conditionHolds(s, s.cards.sig, sp[0].cond) === false);
  s.cards.sig.noted = s.players[me].life - 1;
  assert(Oracle.conditionHolds(s, s.cards.sig, sp[0].cond) === true);
  console.log('killing wave, turn the earth, splendor ok');
}

// --- Energy: abilities that cost {E}, and "you may pay eight {E}" in an effect
{
  const T = s.turn; const me = T.active;
  for (let g = 0; g < 6; g++) passAll(); s.ask = []; s.tq = []; T.phase = R.PI('Main 1'); s.combat = null;
  ok(me, { type: 'enter', zone: 'battlefield', cards: [{ id: 'whirl', d: D('Whirler Test', 'Artifact Creature — Thopter', 'Pay {E}{E}{E}: Create a 1/1 colorless Thopter artifact creature token with flying.', { p: '2', tg: '1' }) }] });
  s.players[me].energy = 2;
  bad(me, { type: 'activate', id: 'whirl', i: 0 });
  s.players[me].energy = 4;
  ok(me, { type: 'activate', id: 'whirl', i: 0 }); passAll();
  assert.equal(s.players[me].energy, 1);
  assert(Object.values(s.cards).some(c => c.zone === 'battlefield' && /Thopter/.test(R.cardName(c)) && c.token), 'made a thopter');
  const lr = Effects.parse('You get {E}{E} (two energy counters), then you may pay eight {E}. If you pay, untap all creatures you control, and after this phase, there is an additional combat phase.').ops;
  s.players[me].energy = 6;
  const nn = []; Engine.run(s, { id: 'lrn', ctrl: me, d: D('Lightning Runner', 'Creature', ''), ab: { name: 'Lightning Runner' } }, lr, [], nn);
  console.log('runner:', s.players[me].energy, nn.filter(x => /energy|paid|additional/i.test(x)));
  assert.equal(s.players[me].energy, 0);
  console.log('energy ok');
}
