// Activation costs the table now pays (return a land, untap creatures, remove/put counters, tap another), and abilities
// used from the hand (cycling, landcycling, channel).
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
require('../site/cards.js'); require('../site/effects.js'); require('../site/oracle.js'); require('../site/rulebook.js'); require('../site/rules.js'); require('../site/engine.js');
const R = globalThis.Rules, assert = require('assert');
const s = R.newState();
const ok = (pid, a) => { const r = R.apply(s, pid, a); if (!r.ok) throw new Error(pid + ' ' + a.type + ': ' + r.err); return r; };
const bad = (pid, a) => { const r = R.apply(s, pid, a); assert(!r.ok, a.type + ' should be refused'); return r.err; };
const D = (n, t, o, extra) => ({ n, cmc: (extra && extra.cmc) || 0, faces: [Object.assign({ n, t, o: o || '', img: '', p: '', tg: '', mc: '' }, extra || {})] });
const passAll = () => { for (let g = 0; g < 12 && s.prio && s.prio.holder; g++) ok(s.prio.holder, { type: 'pass' }); };
for (const p of ['A', 'B']) ok(p, { type: 'join', name: p });
ok('A', { type: 'start' }); for (const p of ['A', 'B']) Object.assign(s.players[p], { kept: true, online: true, libCount: 30, handCount: 5 });
s.seats = ['A', 'B']; Object.assign(s.turn, { active: 'A', phase: R.PI('Main 1'), mulls: false });
const ab = id => Cards.abilities(s.cards[id]);

// Meloku-style: {1}, Return a land you control to its owner's hand: make a token.
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'mel', d: D('Cloud Lord', 'Creature — Spirit', "{1}, Return a land you control to its owner's hand: Create a 1/1 blue Illusion creature token with flying.", { p: '2', tg: '4' }) }, { id: 'isl', d: D('Island', 'Basic Land — Island', '') }, { id: 'isl2', d: D('Island', 'Basic Land — Island', '') }] });
for (const id of ['mel', 'isl', 'isl2']) s.cards[id].ctlT = 0;
s.players.A.pool = ['U'];
assert.deepEqual(ab('mel')[0].extra, [{ k: 'bounce', n: 1, what: 'land' }]);
bad('A', { type: 'activate', id: 'mel', i: 0 });   // no land chosen
ok('A', { type: 'activate', id: 'mel', i: 0, costs: [['isl']], fromPool: [0] });
assert(!s.cards.isl || s.cards.isl.zone === 'hand', 'the land went back to hand (it leaves the public table)'); assert(JSON.stringify(s.inbox.A || []).includes('isl'), 'sent to its owner');
passAll();
assert(Object.values(s.cards).some(c => c.token && c.zone === 'battlefield' && /Illusion/.test(c.d.faces[0].t)), 'token made');
console.log('return-a-land cost ok');

// Grave-Troll-style: {1}, Remove a +1/+1 counter from this: Regenerate this — refused without a counter.
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'trl', d: D('Troll', 'Creature — Troll', '{1}, Remove a +1/+1 counter from this: Regenerate this.', { p: '2', tg: '2' }) }] });
s.cards.trl.counters = { '+1/+1': 2 }; s.players.A.pool = ['C'];
ok('A', { type: 'activate', id: 'trl', i: 0, fromPool: [0] });
assert.equal(s.cards.trl.counters['+1/+1'], 1, 'one counter removed');
passAll();
s.cards.trl.counters = {}; s.players.A.pool = ['C'];
assert(/counter/.test(bad('A', { type: 'activate', id: 'trl', i: 0, fromPool: [0] })));
console.log('remove-a-counter cost ok');

// Devoted Druid: Put a -1/-1 counter on this: Untap this.
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'dd', d: D('Druid', 'Creature — Elf', 'Put a -1/-1 counter on this: Untap this.', { p: '0', tg: '2' }) }] });
s.cards.dd.tapped = true; s.cards.dd.ctlT = 0;
ok('A', { type: 'activate', id: 'dd', i: 0 }); passAll();
assert.equal(s.cards.dd.counters['-1/-1'], 1); assert.equal(s.cards.dd.tapped, false);
console.log('put-a-counter cost ok');

// Untap two tapped creatures you control.
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'c1', d: D('One', 'Creature — Human', '', { p: '1', tg: '1' }) }, { id: 'c2', d: D('Two', 'Creature — Human', '', { p: '1', tg: '1' }) }, { id: 'unt', d: D('Untapper', 'Artifact', 'Untap two tapped creatures you control: You gain 2 life.') }] });
s.cards.c1.tapped = s.cards.c2.tapped = true;
const life = s.players.A.life;
ok('A', { type: 'activate', id: 'unt', i: 0, costs: [['c1', 'c2']] }); passAll();
assert(!s.cards.c1.tapped && !s.cards.c2.tapped); assert.equal(s.players.A.life, life + 2);
console.log('untap-creatures cost ok');

// Cycling and channel from the hand.
const cyc = D('Cycler', 'Creature — Beast', 'Cycling {2}', { p: '3', tg: '3', cmc: 4 });
assert.equal(Cards.handAbilities({ d: cyc, counters: {}, zone: 'hand' })[0].text, 'Draw a card.');
const swc = D('Swamp Cycler', 'Creature — Zombie', 'Swampcycling {2}', { p: '2', tg: '2' });
assert(/Swamp card/.test(Cards.handAbilities({ d: swc, counters: {}, zone: 'hand' })[0].text));
s.players.A.pool = ['C', 'C'];
const hc = s.players.A.handCount;
ok('A', { type: 'handAb', card: { id: 'cyc1', d: cyc }, i: 0, fromPool: [0, 1] });
assert.equal(s.cards.cyc1.zone, 'graveyard'); assert.equal(s.players.A.handCount, hc - 1);
passAll();
assert((s.todo.A || []).some(t => t.k === 'draw'), 'draw a card');
const chan = D('Channel Land', 'Legendary Land', "{T}: Add {G}.\nChannel — {1}{G}, Discard this: Target player gains 3 life.");
const hab = Cards.handAbilities({ d: chan, counters: {}, zone: 'hand' });
assert.equal(hab[0].kind, 'channel');
s.players.A.pool = ['G', 'G'];
const lb = s.players.B.life;
ok('A', { type: 'handAb', card: { id: 'ch1', d: chan }, i: 0, tg: [[{ p: 'B' }]], fromPool: [0, 1] }); passAll();
assert.equal(s.players.B.life, lb + 3);
console.log('cycling and channel ok');
console.log('build4 ok');

// "Your choice of": the controller is asked before it resolves; the AI picks for itself.
{
  ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'tgt', d: D('Target Me', 'Creature — Bear', '', { p: '2', tg: '2' }) }] });
  s.dev = true;
  ok('A', { type: 'enter', zone: 'stack', cast: true, alt: 'free', cards: [{ id: 'ch', d: D('Choice Spell', 'Instant', 'Target creature gains your choice of flying, vigilance, or trample until end of turn.') }], tg: [[{ c: 'c1' }]] });
  s.dev = false;
  passAll();
  const q = s.ask.find(x => x.kind === 'pick');
  assert(q && q.options.length === 3, 'asked: ' + JSON.stringify(s.ask));
  ok('A', { type: 'answer', id: q.id, value: 2 });
  passAll();
  assert(Cards.keywords(s.cards.c1, s).has('trample'), 'trample granted');
  // the AI picks
  s.players.B.ai = { by: 'A', skill: 'normal' };
  s.dev = true;
  ok('B', { type: 'enter', zone: 'stack', cast: true, alt: 'free', cards: [{ id: 'ch2', d: D('Choice Spell 2', 'Instant', 'Put your choice of a +1/+1 counter, a flying counter, or a lifelink counter on target creature.') }], tg: [[{ c: 'tgt' }]] });
  s.dev = false;
  passAll();
  assert(!s.ask.some(x => x.kind === 'pick'), 'AI not asked');
  assert(Object.keys(s.cards.tgt.counters).length === 1, JSON.stringify(s.cards.tgt.counters));
  delete s.players.B.ai;
  console.log('your choice of ok', JSON.stringify(s.cards.tgt.counters));
}

// Reveal and route: the card's words decide where each card goes; unknown wording leaves it to the player.
{
  const run = text => Engine.run(s, { id: 'rr' + Math.random(), ctrl: 'A', d: D('Revealer', 'Sorcery', ''), ab: { name: 'Revealer' } }, Effects.parse(text).ops, [], []);
  s.todo.A = [];
  run("Reveal the top card of your library. If it's a land card, put it onto the battlefield tapped. Otherwise, put it into your hand.");
  const t = s.todo.A.find(x => x.k === 'route'); assert(t, 'route job');
  const lib = [{ id: 'L1', d: D('Forest', 'Basic Land — Forest', '') }, { id: 'L2', d: D('Bear', 'Creature — Bear', '') }];
  assert.deepEqual(Cards.routePlan(t, lib, 'A').cards.map(c => c.dest && [c.dest.to, c.dest.tapped]), [['battlefield', true]]);
  assert.deepEqual(Cards.routePlan(t, lib.slice(1), 'A').cards.map(c => c.dest && c.dest.to), ['hand']);
  s.todo.A = [];
  run('Reveal the top four cards of your library. Put all creature cards revealed this way into your hand and the rest into your graveyard.');
  const t2 = s.todo.A.find(x => x.k === 'route');
  const lib2 = [{ id: 'a', d: D('Bear', 'Creature — Bear', '') }, { id: 'b', d: D('Bolt', 'Instant', '') }, { id: 'c', d: D('Elf', 'Creature — Elf', '') }, { id: 'd', d: D('Swamp', 'Basic Land — Swamp', '') }];
  assert.deepEqual(Cards.routePlan(t2, lib2, 'A').cards.map(c => c.dest.to), ['hand', 'graveyard', 'hand', 'graveyard']);
  s.todo.A = [];
  run('Reveal the top two cards of your library. Put one of them into your hand and the other into your graveyard.');
  const t3 = s.todo.A.find(x => x.k === 'route');
  assert(Cards.routePlan(t3, lib2, 'A').cards.every(c => !c.dest), 'not understood: the player is asked');
  assert.deepEqual(t3.zones.sort(), ['graveyard', 'hand']);
  s.todo.A = [];
  console.log('reveal and route ok');
}

// Moving counters: the source must have one; it moves onto the other target.
{
  const text = 'Move a +1/+1 counter from target creature onto another target creature.';
  const reqs = Cards.targetsIn(text);
  s.cards.c1.counters = {}; s.cards.c2.counters = { '+1/+1': 2 };
  assert(!Cards.legalTarget(s, reqs[0], { c: 'c1' }, 'A') && Cards.legalTarget(s, reqs[0], { c: 'c2' }, 'A'), 'only a creature with a +1/+1 counter can be the source');
  Engine.run(s, { id: 'mv', ctrl: 'A', d: D('Mover', 'Sorcery', ''), ab: { name: 'Mover' } }, Effects.parse(text).ops, [[{ c: 'c2' }], [{ c: 'c1' }]], []);
  assert.equal(s.cards.c2.counters['+1/+1'], 1); assert.equal(s.cards.c1.counters['+1/+1'], 1);
  console.log('move counters ok');
}

// Statics: can't be countered; triggers an additional time (modern "entering" wording); "this costs {X} less";
// spend mana as though any color.
{
  ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'nocnt', d: D('Shield of Faith', 'Enchantment', "Creature spells you control can't be countered.") }] });
  s.cards.cspell = { id: 'cspell', owner: 'A', ctrl: 'A', zone: 'stack', counters: {}, seq: ++s.seq, d: D('Big Beast', 'Creature — Beast', '', { p: '5', tg: '5' }) };
  s.cards.ispell = { id: 'ispell', owner: 'A', ctrl: 'A', zone: 'stack', counters: {}, seq: ++s.seq, d: D('Quick', 'Instant', 'Draw a card.') };
  assert(Cards.uncounterable(s, s.cards.cspell) && !Cards.uncounterable(s, s.cards.ispell));
  Engine.run(s, { id: 'cs', ctrl: 'B', d: D('Counter', 'Instant', ''), ab: { name: 'Counter' } }, Effects.parse('Counter target spell.').ops, [[{ c: 'cspell' }]], []);
  assert.equal(s.cards.cspell.zone, 'stack', 'creature spell not countered');
  delete s.cards.cspell; delete s.cards.ispell;
  // Panharmonicon, modern wording
  ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'panh', d: D('Panharmonic', 'Artifact', 'If a permanent entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.') }] });
  // a creature with an enters trigger: count queued triggers
  s.tq = [];
  ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'etb', d: D('Greeter', 'Creature — Human', 'When this creature enters, you gain 1 life.', { p: '1', tg: '1' }) }] });
  const q = (s.tq || []).filter(x => x.src === 'etb').length + Object.values(s.cards).filter(c => c.zone === 'stack' && c.ab && c.ab.src === 'etb').length;
  assert.equal(q, 2, 'triggered twice: ' + q);
  passAll(); s.tq = [];
  // "This costs {X} less to cast, where X is the greatest power among creatures you control."
  Cards.setState(s);
  const henge = { d: D('Henge', 'Artifact', 'This spell costs {X} less to cast, where X is the greatest power among creatures you control.', { mc: '{7}{G}{G}' }), zone: 'hand', owner: 'A', counters: {} };
  const mx = Math.max(...Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === 'A' && R.isType(c, 'creature')).map(c => Cards.pt(s, c)[0]));
  assert.equal(Cards.costReduction(s, henge, 'A'), mx, 'greatest power');
  ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'anyc', d: D('Prism', 'Artifact', 'You may spend mana as though it were mana of any color.') }] });
  assert(Cards.pay(Cards.parseCost('{U}'), [{ id: 'f', amount: 1, colors: 'G' }], 0, { ctrl: 'A', owner: 'A', d: D('X', 'Instant', '') }), 'green pays blue');
  console.log('statics ok');
}

// Granted abilities (Enchanted land has "{T}: Add two mana of any one color."), control auras, the legend rule exception,
// creatures without flying can't attack.
{
  ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'gland', d: D('Plains', 'Basic Land — Plains', '') }, { id: 'aur', d: D('Overgrowth', 'Enchantment — Aura', 'Enchant land\nEnchanted land has "{T}: Add two mana of any one color."') }] });
  s.cards.aur.attachedTo = 'gland'; Cards.setState(s);
  assert.equal(Cards.manaSource(s.cards.gland).amount, 2, 'the granted mana ability');
  ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'stolen', d: D('Their Beast', 'Creature — Beast', '', { p: '4', tg: '4' }) }] });
  ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'ensl', d: D('Enslave', 'Enchantment — Aura', 'Enchant creature\nYou control enchanted creature.') }] });
  s.cards.ensl.attachedTo = 'stolen'; R._int.sba(s, []);
  assert.equal(s.cards.stolen.ctrl, 'A', 'stolen');
  R._int.moveOne(s, s.cards.ensl, 'graveyard', 'top', null, []); R._int.sba(s, []);
  assert.equal(s.cards.stolen.ctrl, 'B', 'back to B when the aura leaves');
  console.log('granted abilities, control auras ok');
}
