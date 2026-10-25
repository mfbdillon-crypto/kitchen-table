require('../site/cards.js'); require('../site/rules.js'); const R = globalThis.Rules; const assert = require('assert');
const s = R.newState();
const ok = (pid, a) => { const r = R.apply(s, pid, a); if (!r.ok) throw new Error(pid + ' ' + a.type + ': ' + r.err); return r; };
const bad = (pid, a) => { const r = R.apply(s, pid, a); assert(!r.ok, a.type + ' should fail'); return r.err; };
const D = (n, t, o, extra) => ({ n, faces: [Object.assign({ n, t, o: o || '', img: 'https://cards.scryfall.io/x.jpg', p: '', tg: '', mc: '' }, extra || {})] });
for (const p of ['A', 'B', 'C']) ok(p, { type: 'join', name: p });
ok('A', { type: 'start' }); for (const p of Object.keys(s.players)) s.players[p].kept = true;
s.seats = ['A', 'B', 'C']; s.turn.active = 'A'; s.turn.first = 'A'; s.turn.starts = { A: 1 };
// lands: once per turn
ok('A', { type: 'enter', zone: 'battlefield', land: true, cards: [{ id: 'A-f1', d: D('Forest', 'Basic Land — Forest') }] });
assert.equal(s.turn.phase, R.PI('Main 1'), 'land moved us to main 1');
console.log('2nd land:', bad('A', { type: 'enter', zone: 'battlefield', land: true, cards: [{ id: 'A-f2', d: D('Forest', 'Basic Land — Forest') }] }));
assert(!s.cards['A-f2']);
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'A-f2', d: D('Forest', 'Basic Land — Forest') }] }); // Move to → battlefield works
console.log('B land on A turn:', bad('B', { type: 'enter', zone: 'battlefield', land: true, cards: [{ id: 'B-f1', d: D('Island', 'Basic Land — Island') }] }));
// creatures
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'B-bear', d: D('Grizzly Bears', 'Creature — Bear', '', { p: '2', tg: '2' }) }] });
ok('C', { type: 'enter', zone: 'battlefield', cards: [{ id: 'C-wall', d: D('Hexproof Guy', 'Creature', 'Hexproof', { p: '1', tg: '4' }) }] });
// Bolt with a target → stack, priority to B then C, then resolves
const bolt = D('Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.');
console.log('hexproof target:', bad('A', { type: 'enter', zone: 'stack', cards: [{ id: 'A-bolt', d: bolt }], tg: [[{ c: 'C-wall' }]] }));
ok('A', { type: 'enter', zone: 'stack', cards: [{ id: 'A-bolt', d: bolt }], tg: [[{ c: 'B-bear' }]] });
assert.equal(s.prio.holder, 'B'); console.log('log:', s.log[s.log.length - 1].text);
// B responds with Giant Growth on its bear
const gg = D('Giant Growth', 'Instant', 'Target creature gets +3/+3 until end of turn.');
ok('B', { type: 'enter', zone: 'stack', cards: [{ id: 'B-gg', d: gg }], tg: [[{ c: 'B-bear' }]] });
assert.equal(s.prio.holder, 'C', 'after B responds, C is next');
ok('C', { type: 'pass' }); assert.equal(s.prio.holder, 'A');
ok('A', { type: 'pass' }); // all passed → Giant Growth resolves, then new round starting with active player A
assert.equal(s.cards['B-gg'].zone, 'graveyard'); assert.deepEqual(s.cards['B-bear'].mod, [3, 3]);
assert.equal(s.prio.holder, 'A', 'active player gets priority after resolution');
ok('A', { type: 'pass' }); ok('B', { type: 'pass' }); ok('C', { type: 'pass' });
assert.equal(s.cards['A-bolt'].zone, 'graveyard'); assert.equal(s.cards['B-bear'].zone, 'battlefield'); assert.equal(s.cards['B-bear'].dmg, 3);
assert(!s.prio, 'stack empty');
console.log('bear survived:', s.log.slice(-4).map(l => l.text).join(' | '));
// Bolt the player
ok('A', { type: 'enter', zone: 'stack', cards: [{ id: 'A-bolt2', d: bolt }], tg: [[{ p: 'C' }]] });
ok('B', { type: 'pass' }); ok('C', { type: 'pass' });
assert.equal(s.players.C.life, 37);
// Murder fizzles when target leaves
const murder = D('Murder', 'Instant', 'Destroy target creature.');
ok('A', { type: 'enter', zone: 'stack', cards: [{ id: 'A-m', d: murder }], tg: [[{ c: 'B-bear' }]] });
ok('B', { type: 'move', ids: ['B-bear'], to: 'graveyard' });
ok('B', { type: 'pass' }); ok('C', { type: 'pass' });
assert.equal(s.cards['A-m'].zone, 'graveyard'); console.log('fizzle:', s.log.slice(-2).map(l => l.text).join(' | '));
// draw todo
ok('A', { type: 'enter', zone: 'stack', cards: [{ id: 'A-div', d: D('Divination', 'Sorcery', 'Draw two cards.') }] });
ok('B', { type: 'pass' }); ok('C', { type: 'pass' });
assert.equal(s.todo.A[0].k, 'draw'); assert.equal(s.todo.A[0].n, 2); ok('A', { type: 'todoAck', ids: [s.todo.A[0].id] }); assert.equal(s.todo.A.length, 0);
// a creature spell resolves onto the battlefield; summoning sick
ok('A', { type: 'enter', zone: 'stack', cards: [{ id: 'A-ogre', d: D('Ogre', 'Creature — Ogre', '', { p: '3', tg: '3' }) }] });
ok('B', { type: 'pass' }); ok('C', { type: 'pass' });
assert.equal(s.cards['A-ogre'].zone, 'battlefield');
console.log('sick attack:', bad('A', { type: 'attack', list: [{ id: 'A-ogre', p: 'B' }] }));
// next turns: pass around back to A
ok('A', { type: 'phase', dir: 'pass' }); ok('B', { type: 'phase', dir: 'pass' }); ok('C', { type: 'phase', dir: 'pass' });
assert.equal(s.turn.active, 'A');
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'B-wall', d: D('Wall', 'Creature — Wall', 'Defender', { p: '0', tg: '5' }) }, { id: 'B-flyer', d: D('Bird', 'Creature — Bird', 'Flying', { p: '1', tg: '1' }) }] });
ok('A', { type: 'enter', zone: 'battlefield', cards: [{ id: 'A-drag', d: D('Dragon', 'Creature — Dragon', 'Flying, trample', { p: '5', tg: '5' }) }] });
s.cards['A-drag'].ctlT = 0;
s.turn.phase = R.PI('Main 1');
ok('A', { type: 'attack', list: [{ id: 'A-ogre', p: 'B' }, { id: 'A-drag', p: 'C' }] });
assert.equal(s.turn.phase, R.PI('Declare blockers'));
assert(s.cards['A-ogre'].tapped);
console.log('wall blocks flyer:', bad('B', { type: 'block', list: [{ id: 'B-wall', att: 'A-drag' }] }));
ok('B', { type: 'block', list: [{ id: 'B-wall', att: 'A-ogre' }] });
assert(!s.combat.done);
ok('C', { type: 'block', list: [] });
assert(!s.combat.done && s.prio && s.prio.step === 'damage', 'a priority window before damage');
assert.equal(s.prio.holder, 'A');
const passStep = () => { let g = 0; while (s.prio && s.prio.step && g++ < 6) ok(s.prio.holder, { type: 'pass' }); };
passStep();
assert(s.combat.done, 'damage dealt after all blocks');
assert.equal(s.players.C.life, 37 - 5); assert.equal(s.players.B.life, 40);
assert.equal(s.cards['B-wall'].dmg, 3); assert.equal(s.turn.phase, R.PI('Main 2'));
console.log('combat:', s.log.slice(-3).map(l => l.text).join(' | '));
// trample over a chump + first strike
ok('A', { type: 'phase', dir: 'pass' }); ok('B', { type: 'phase', dir: 'pass' }); ok('C', { type: 'phase', dir: 'pass' });
s.turn.phase = R.PI('Beginning of combat');
ok('A', { type: 'attack', list: [{ id: 'A-drag', p: 'B' }] });
ok('B', { type: 'block', list: [{ id: 'B-flyer', att: 'A-drag' }] });
passStep();
assert.equal(s.cards['B-flyer'], undefined === s.cards['B-flyer'] ? undefined : s.cards['B-flyer']); 
assert.equal(s.cards['B-flyer'].zone, 'graveyard', 'chump blocker died'); assert.equal(s.players.B.life, 36, 'trample 4');
console.log('trample:', s.log.slice(-2).map(l => l.text).join(' | '));
// Wrath
ok('A', { type: 'enter', zone: 'stack', cards: [{ id: 'A-wrath', d: D('Wrath of God', 'Sorcery', "Destroy all creatures. They can't be regenerated.") }] });
ok('B', { type: 'pass' }); ok('C', { type: 'pass' });
assert.equal(Object.values(s.cards).filter(c => c.zone === 'battlefield' && /Creature/.test(c.d && c.d.faces[0].t)).length, 0);
// Activated ability (pinger)
ok('B', { type: 'enter', zone: 'battlefield', cards: [{ id: 'B-ping', d: D('Pinger', 'Creature', '{T}: Pinger deals 1 damage to any target.', { p: '1', tg: '1' }) }] });
console.log('sick tap:', bad('B', { type: 'activate', id: 'B-ping', i: 0, tg: [[{ p: 'A' }]] }));
s.cards['B-ping'].ctlT = 0;
ok('B', { type: 'activate', id: 'B-ping', i: 0, tg: [[{ p: 'A' }]] });
assert(s.cards['B-ping'].tapped); assert.equal(s.prio.holder, 'C');
ok('C', { type: 'pass' }); ok('A', { type: 'pass' });
assert.equal(s.players.A.life, 39); assert(!R.stackCards(s).length);
// offline holder is skipped
ok('A', { type: 'enter', zone: 'stack', cards: [{ id: 'A-bolt3', d: bolt }], tg: [[{ p: 'B' }]] });
s.players.B.online = false; R.fixUp(s);
assert.equal(s.prio.holder, 'C'); ok('C', { type: 'pass' }); assert.equal(s.players.B.life, 33);
console.log('stack ok');
