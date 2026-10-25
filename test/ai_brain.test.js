// Unit checks for the planning AI (aibrain.js): card roles, profiles, opponent reads, wipes, blocks, counters.
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
for (const f of ['cards', 'scry', 'effects', 'oracle', 'rules', 'engine', 'precons', 'aiprofiles', 'aibrain']) require('../site/' + f + '.js');
const assert = require('assert'), fs = require('fs');
const db = {}; for (const c of JSON.parse(fs.readFileSync(__dirname + '/../data/forgecards.json', 'utf8'))) db[c.name] = c;
const card = n => ({ id: 'x-' + n, d: Scry.toD(db[n]), zone: 'hand', counters: {}, face: 0 });
const roles = n => [...AIBrain.roles(card(n))].sort().join(',');
// Roles
const R1 = { 'Swords to Plowshares': 'removal', 'Wrath of God': 'wipe', 'Sol Ring': 'ramp', 'Toxic Deluge': 'wipe', 'Cyclonic Rift': 'bounce', 'Fact or Fiction': 'draw', 'Teferi\'s Protection': 'protection', 'Viscera Seer': 'sacOutlet', 'Blood Artist': 'deathDrain' };
for (const [n, r] of Object.entries(R1)) { if (!db[n]) { console.log('(no data for', n + ')'); continue; } assert(roles(n).split(',').includes(r), `${n} should be ${r} (got ${roles(n)})`); }
if (db['Cathar Commando']) assert(!roles('Cathar Commando').split(',').includes('removal'), 'Cathar Commando is not removal when cast');
if (db['Mana Drain']) assert(roles('Mana Drain').split(',').includes('counter'), 'Mana Drain counters');
console.log('roles ok');
// Every ready-made deck has a profile whose cards are in the deck.
for (const p of KT_PRECONS) { const pr = KT_AI_PROFILES[p.id]; assert(pr, 'profile for ' + p.name); assert.equal(pr.cmdr, p.cmdr); assert(pr.key.length >= 8, p.name + ' key cards'); }
console.log('profiles ok');
// A small table: me (Erebos) vs Giada with a big board.
const s = Rules.newState();
const act = (pid, a) => { const r = Rules.apply(s, pid, a); if (r.ok === false) throw new Error(a.type + ': ' + r.err); return r; };
act('A', { type: 'join', name: 'A' }); act('B', { type: 'join', name: 'B' });
s.players.A.online = s.players.B.online = true;
act('A', { type: 'enter', zone: 'command', cards: [Object.assign(card('Erebos, God of the Dead'), { id: 'A-cm', cmdr: true })] });
act('B', { type: 'enter', zone: 'command', cards: [Object.assign(card('Giada, Font of Hope'), { id: 'B-cm', cmdr: true })] });
act('A', { type: 'start' }); for (const p of Object.keys(s.players)) s.players[p].kept = true;
s.turn.active = 'A'; s.turn.phase = Rules.PI('Main 1');
const bfB = ['Archangel of Thune', 'Lyra Dawnbringer', 'Serra Paragon', 'Resplendent Angel'].filter(n => db[n]).map((n, i) => Object.assign(card(n), { id: 'B-' + i }));
act('B', { type: 'enter', zone: 'battlefield', cards: bfB });
act('B', { type: 'move', ids: ['B-cm'], to: 'battlefield' });
const lands = Array.from({ length: 4 }, (_, i) => Object.assign(card('Swamp'), { id: 'A-l' + i }));
act('A', { type: 'enter', zone: 'battlefield', cards: lands });
const hand = [Object.assign(card('Damnation'), { id: 'A-h1' })];
const B = new AIBrain({ me: 'A', level: 'hard', deckId: 'suiUheeJvkWIWDUHHpE_Ww', bracket: 1, rng: () => 0.5 });
const view = () => ({ s, me: 'A', hand, lib: [] });
B.think(view(), true);
const rd = B.reads.B;
assert.deepEqual(rd.arch.slice(0, 2), ['tribal', 'flyers'], 'reads Giada as an Angel tribal deck');
assert(rd.kill.has('Giada, Font of Hope') && rd.kill.has('Archangel of Thune'), 'knows what to kill on sight');
const w = B.wipeCheck(Object.assign(card('Damnation'), { id: 'A-h1' }));
assert(w.good, 'Damnation is good against a board of Angels: ' + w.reason);
const step = B.plan.steps.find(x => x.kind === 'cast' && x.id === 'A-h1');
assert(step, 'plans to cast the wipe: ' + B.plan.steps.map(x => x.label).join('; '));
console.log('wipe ok —', w.reason);
// Blocks: chump-block a lethal attacker.
s.players.A.life = 4;
act('A', { type: 'enter', zone: 'battlefield', cards: [Object.assign(card('Grim Guardian'), { id: 'A-c1' })] });
act('B', { type: 'enter', zone: 'battlefield', cards: [Object.assign(card('Krosan Tusker'), { id: 'B-t' })] });
s.turn.active = 'B'; s.combat = { n: s.turn.n, att: { 'B-t': { def: { p: 'A' }, blk: [] } }, waiting: ['A'], ok: {}, done: false };
s.cards['B-t'].tapped = true;
B.think(view(), true);
const bl = B.planBlocks();
assert(bl.blocks.some(b => b.att === 'B-t'), 'chump-blocks the lethal attacker: ' + bl.why);
console.log('blocks ok —', bl.why);
// Counter: a wipe aimed at a board I'm winning with is worth a counterspell; a mana rock isn't.
const B2 = new AIBrain({ me: 'B', level: 'hard', deckId: 'x9PjY9XdcU-f9giP4_oI0w', bracket: 3, rng: () => 0.5 });
s.combat = null; s.turn.active = 'A';
B2.think({ s, me: 'B', hand: [], lib: [] }, true);
const wrath = Object.assign(card('Damnation'), { id: 'A-st', zone: 'stack', ctrl: 'A', owner: 'A', tg: [] });
assert(B2.counterWorth(wrath), 'counter a wipe that would hit my better board');
const rock = Object.assign(card('Sol Ring'), { id: 'A-st2', zone: 'stack', ctrl: 'A', owner: 'A', tg: [] });
assert(!B2.counterWorth(rock), 'not worth countering Sol Ring');
console.log('counter choices ok');

// The rulebook in planning: Karador lets me cast a creature from my graveyard; Courser lets me play the top land.
{
  const s3 = Rules.newState(); const a3 = (pid, a) => { const r = Rules.apply(s3, pid, a); if (r.ok === false) throw new Error(a.type + ': ' + r.err); return r; };
  a3('A', { type: 'join', name: 'A' }); a3('B', { type: 'join', name: 'B' }); s3.players.A.online = s3.players.B.online = true;
  a3('A', { type: 'start' }); for (const p of ['A', 'B']) s3.players[p].kept = true; s3.turn.active = 'A'; s3.turn.phase = Rules.PI('Main 1'); s3.seats = ['A', 'B'];
  a3('A', { type: 'enter', zone: 'battlefield', cards: Array.from({ length: 6 }, (_, i) => Object.assign(card(['Swamp', 'Forest', 'Plains'][i % 3]), { id: 'A-L' + i })) });
  a3('A', { type: 'enter', zone: 'battlefield', cards: [Object.assign(card('Karador, Ghost Chieftain'), { id: 'A-kar' }), Object.assign(card('Courser of Kruphix'), { id: 'A-cou' })] });
  a3('A', { type: 'enter', zone: 'graveyard', cards: [Object.assign(card('Siege Zombie'), { id: 'A-gz' })] });
  const B3 = new AIBrain({ me: 'A', level: 'hard', deckId: 'none', bracket: 2, rng: () => 0.5 });
  const top = Object.assign(card('Forest'), { id: 'A-top' });
  B3.think({ s: s3, me: 'A', hand: [], lib: [top], top }, true);
  const gyStep = B3.plan.steps.find(x => x.kind === 'cast' && x.id === 'A-gz');
  console.log('plan:', B3.plan.steps.map(x => x.label).join(' | '));
  assert(gyStep, 'casts Siege Zombie from the graveyard with Karador');
  const landStep = B3.plan.steps.find(x => x.kind === 'land');
  assert(landStep && landStep.zone === 'library', 'plays the top land with Courser');
  console.log('rulebook planning ok');
}
console.log('ai brain ok');
