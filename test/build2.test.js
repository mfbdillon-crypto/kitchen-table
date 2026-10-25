// The last building batch: copying triggers and spells, emblems, Vraska's Treasure, airbend, Combustible Gearhulk,
// Arcane Bombardment's copies, foretell / plot, energy paid by amount, mana-doubling lands.
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
require('../site/cards.js'); require('../site/effects.js'); require('../site/oracle.js'); require('../site/rules.js'); require('../site/engine.js');
const R = globalThis.Rules, I = R._int, RB = globalThis.Rulebook, assert = require('assert');
const s = R.newState();
const ok = (pid, a) => { const r = R.apply(s, pid, a); if (!r.ok) throw new Error(pid + ' ' + a.type + ': ' + r.err); return r; };
const D = (n, t, o, extra) => ({ n, cmc: (extra && extra.cmc) || 0, faces: [Object.assign({ n, t, o: o || '', img: '', p: '', tg: '', mc: '' }, extra || {})] });
for (const p of ['A', 'B']) ok(p, { type: 'join', name: p });
ok('A', { type: 'start' }); for (const p of ['A', 'B']) { s.players[p].kept = true; s.players[p].online = true; }
s.seats = ['A', 'B']; s.turn.active = 'A'; s.turn.phase = R.PI('Main 1');
const clear = () => { for (const c of Object.values(s.cards)) if (c.zone === 'stack') delete s.cards[c.id]; s.tq = []; s.prio = null; s.ask = []; };
const run = (name, text, tg, by) => { const n = []; Engine.run(s, { id: 'x' + Math.random(), ctrl: by || 'A', d: D(name, 'Sorcery', ''), ab: { name } }, Effects.parse(text).ops, tg || [], n); return n; };

// Copy target triggered ability you control.
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'res', d: D('Strionic Resonator', 'Artifact', '{2}, {T}: Copy target triggered ability you control. You may choose new targets for the copy.') }] });
s.cards.trig = { id: 'trig', owner: 'A', ctrl: 'A', zone: 'stack', seq: ++s.seq, token: true, counters: {}, d: D('Elf', 'Creature', ''), ab: { src: 'x', text: 'Draw a card.', name: 'Elf', trig: true, eng: true } };
const req = Cards.targetsIn('Copy target triggered ability you control.')[0];
assert(Cards.legalTarget(s, req, { c: 'trig' }, 'A'), 'my trigger is a legal target');
assert(!Cards.legalTarget(s, req, { c: 'trig' }, 'B'), 'not for the other player');
run('Strionic Resonator', 'Copy target triggered ability you control.', [[{ c: 'trig' }]]);
assert.equal(Object.values(s.cards).filter(c => c.zone === 'stack' && c.ab && c.ab.text === 'Draw a card.').length, 2, 'copied');
clear();
console.log('copy ok');

// Emblems: Tezzeret's end-step search works from the command zone.
run('Tezzeret, Artifice Master', 'You get an emblem with "At the beginning of your end step, search your library for a permanent card, put it onto the battlefield, then shuffle."');
const em = Object.values(s.cards).find(c => c.emblem);
assert(em && em.zone === 'command' && em.owner === 'A');
const M = Oracle.model(em); assert(M.abilities.some(a => a.kind === 'triggered'), 'emblem trigger parsed');
console.log('emblem ok');

// Vraska's -2 and Avatar's Wrath.
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'big', d: D('Big Wurm', 'Creature — Wurm', 'Trample', { p: '7', tg: '7', cmc: 7 }) }, { id: 'sm', d: D('Small Elf', 'Creature — Elf', '', { p: '1', tg: '1', cmc: 1 }) }] });
run('Vraska', 'Target creature becomes a Treasure artifact with "{T}, Sacrifice this artifact: Add one mana of any color" and loses all other card types and abilities.', [[{ c: 'big' }]]);
assert(R.isType(s.cards.big, 'artifact') && !R.isType(s.cards.big, 'creature'), 'a Treasure now');
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'keep', d: D('Keeper', 'Creature — Human', '', { p: '2', tg: '2' }) }] });
run("Avatar's Wrath", 'Choose up to one target creature, then airbend all other creatures.', [[{ c: 'keep' }]]);
assert.equal(s.cards.keep.zone, 'battlefield'); assert.equal(s.cards.sm.zone, 'exile'); assert(s.cards.sm.airbent);
s.turn.active = 'B';
const w = RB.ways(s, 'B', s.cards.sm); assert(w.some(x => x.kind === 'airbend' && x.cost === '{2}'), JSON.stringify(w));
s.turn.active = 'A';
console.log('vraska, airbend ok');

// Combustible Gearhulk: an AI opponent decides at once; a person is asked; mill damage.
s.players.B.ai = { by: 'A', skill: 'normal' }; s.players.B.life = 30;
const ng = run('Combustible Gearhulk', "Target opponent may have you draw three cards. If the player doesn't, you mill three cards, then this deals damage to that player equal to the total mana value of those cards.", [[{ p: 'B' }]]);
assert((s.todo.A || []).some(t => t.k === 'millDmg' && t.to === 'B'), 'AI at 30 life takes the damage: ' + ng.join('; '));
ok('A', { type: 'enter', zone: 'graveyard', cards: [{ id: 'm1', d: D('M1', 'Sorcery', '', { cmc: 3 }) }, { id: 'm2', d: D('M2', 'Creature', '', { cmc: 4 }) }] });
ok('A', { type: 'millDmg', ids: ['m1', 'm2'], to: 'B', src: 'Combustible Gearhulk' });
assert.equal(s.players.B.life, 23);
delete s.players.B.ai;
run('Combustible Gearhulk', "Target opponent may have you draw three cards. If the player doesn't, you mill three cards, then this deals damage to that player equal to the total mana value of those cards.", [[{ p: 'B' }]]);
assert(s.ask.some(a => a.kind === 'punisher' && a.pid === 'B'), 'a person is asked');
clear();
console.log('gearhulk ok');

// Arcane Bombardment: exile a random instant/sorcery, cast copies (the card stays exiled).
ok('A', { type: 'enter', zone: 'graveyard', cards: [{ id: 'bolt', d: D('Bolt', 'Instant', 'You gain 3 life.', { cmc: 1, mc: '{R}' }) }] });
const bombOps = Effects.parse('Exile an instant or sorcery card at random from your graveyard. Then copy each card exiled with this. You may cast any number of the copies without paying their mana costs.').ops;
assert.equal(bombOps[0].op, 'bombard');
s.todo.A = [];
Engine.run(s, { id: 'bomb1', ctrl: 'A', d: D('Arcane Bombardment', 'Enchantment', ''), ab: { name: 'Arcane Bombardment', src: 'bombsrc' } }, bombOps, [], []);
const ft = (s.todo.A || []).find(t => t.k === 'freeCast' && t.copy);
assert(ft, 'free copy offered');
const exiled = s.cards[ft.ids[0]]; assert.equal(exiled.zone, 'exile');
ok('A', { type: 'move', ids: [exiled.id], to: 'stack', cast: true, alt: 'free', copy: true });
assert.equal(exiled.zone, 'exile', 'the card stays exiled');
assert(Object.values(s.cards).some(c => c.zone === 'stack' && c.copy), 'a copy is on the stack');
clear();
console.log('bombardment ok');

// Plot from hand, then cast free on a later turn.
ok('A', { type: 'enter', zone: 'exile', from: 'hand', special: 'plot', cards: [{ id: 'pl', d: D('Plot Test', 'Sorcery', 'You gain 2 life.\nPlot {1}{R}', { cmc: 4, mc: '{3}{R}' }) }] });
assert.equal(s.cards.pl.zone, 'exile'); assert.equal(s.cards.pl.exPerm.kind, 'plot');
assert.equal(RB.ways(s, 'A', s.cards.pl).length, 0, 'not this turn');
s.turn.n++;
assert(RB.ways(s, 'A', s.cards.pl).some(x => x.via === 'plot'), 'a later turn');
// Plotted cards are cast free only at sorcery speed (702.170d).
s.turn.active = 'B';
assert(!R.apply(s, 'A', { type: 'move', ids: ['pl'], to: 'stack', cast: true, alt: 'free' }).ok, 'not on the opponent turn');
s.turn.active = 'A';
{ const r = R.apply(JSON.parse(JSON.stringify(s)), 'A', { type: 'move', ids: ['pl'], to: 'stack', cast: true, alt: 'free' }); assert(r.ok, 'plot on my main phase: ' + r.err); }
// A free cast needs something that grants it (a pending effect, plot, or dev mode).
ok('A', { type: 'enter', zone: 'graveyard', cards: [{ id: 'nofree', d: D('No Free', 'Sorcery', 'You gain 1 life.', { cmc: 5, mc: '{5}' }) }] });
s.players.A.libCount = 10;
const rf = R.apply(s, 'A', { type: 'move', ids: ['nofree'], to: 'stack', cast: true, alt: 'free' });
assert(!rf.ok, 'no grant, no free cast');
s.todo.A = [{ id: 'g1', k: 'freeCast', from: 'graveyard', filter: 'card' }];
ok('A', { type: 'move', ids: ['nofree'], to: 'stack', cast: true, alt: 'free' });
s.todo.A = []; clear();
console.log('plot ok');

// Energy paid by amount.
s.players.A.energy = 5;
const tk0 = Object.values(s.cards).filter(c => c.token && c.zone === 'battlefield').length;
run('Aether Refinery', 'You may pay one or more {E}. If you do, create an X/X black Aetherborn creature token, where X is the amount of {E} paid this way.');
assert.equal(s.players.A.energy, 0);
const tok = Object.values(s.cards).filter(c => c.token && c.zone === 'battlefield');
assert.equal(tok.length, tk0 + 1); assert.deepEqual(Cards.pt(s, tok[tok.length - 1]), [5, 5]);
console.log('energy ok');

// Heartbeat of Spring doubles land mana.
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'for', d: D('Forest', 'Basic Land — Forest', '') }, { id: 'hb', d: D('Heartbeat of Spring', 'Enchantment', 'Whenever a player taps a land for mana, that player adds one mana of any type that land produced.') }] });
Cards.setState(s);
assert.equal(Cards.manaSource(s.cards.for).amount, 2);
console.log('build2 ok');
