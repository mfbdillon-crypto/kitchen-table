// The AI ↔ table interface sheet (site/aiface.js) covers everything the engine can ask or hand to a player,
// every entry has a handler in the AI, and the safe answers are accepted by the sheet's own checks.
global.window = global;
require('../site/aiface.js');
const fs = require('fs'), assert = require('assert');
const F = globalThis.KT_AI_FACE;
const src = f => fs.readFileSync(__dirname + '/../site/' + f, 'utf8');
const eng = src('engine.js') + src('rules.js');
// 1) Every question kind the engine creates is on the sheet.
const asks = new Set([...eng.matchAll(/kind: '([a-zA-Z]+)', pid/g)].map(m => m[1]));
for (const k of asks) assert(F.ASKS[k], `engine asks “${k}” but the interface sheet has no row for it`);
// 2) Every job kind handed to a player is on the sheet.
const todos = new Set([...eng.matchAll(/todo\(s, [a-zA-Z.]+, \{ k: '([a-zA-Z]+)'/g)].map(m => m[1]));
for (const k of todos) assert(F.TODOS[k], `engine hands out job “${k}” but the sheet has no row for it`);
// 3) Every row has an AI handler.
const brain = src('aibrain.js'), exec = src('aiexec.js');
for (const k of Object.keys(F.ASKS)) if (k !== 'manual') assert(new RegExp(`case '${k}'`).test(brain), `no brain.answerAsk case for “${k}”`);
for (const [k, r] of Object.entries(F.TODOS)) if (!/page/.test(r.ai)) assert(new RegExp(`t\\.k === '${k}'`).test(exec), `no executor.onTodo handler for “${k}”`);
// 4) The safe answers pass the checks; bad answers are caught.
const samples = {
  may: { kind: 'may' }, targets: { kind: 'targets', reqs: [{ n: 1, upTo: false, label: 'creature', choices: [{ c: 'x' }, { c: 'y' }] }, { n: 2, upTo: true, label: 'player', choices: [{ p: 'A' }] }] },
  modes: { kind: 'modes', modes: ['a', 'b', 'c'], min: 1, max: 1, off: [0] }, order: { kind: 'order', items: [{ id: 'q1' }, { id: 'q2' }] },
  choose: { kind: 'choose', what: 'player', players: ['A', 'B'] }, enterOpt: { kind: 'enterOpt' }, legend: { kind: 'legend', ids: ['l1', 'l2'] },
  copy: { kind: 'copy', choices: ['c1'] }, assign: { kind: 'assign', power: 5, blockers: [{ id: 'b1', lethal: 2 }, { id: 'b2', lethal: 4 }] }, manual: { kind: 'manual' }
};
for (const [k, ask] of Object.entries(samples)) { const safe = F.ASKS[k].safe(ask); assert.equal(F.ASKS[k].check(safe, ask), '', `safe answer for ${k} fails its own check`); }
assert(F.vet(samples.targets, { tg: [[{ c: 'zzz' }], []] }).problem, 'illegal target is caught');
assert(F.vet(samples.modes, { modes: [0] }).problem, 'used mode is caught');
assert(F.vet(samples.assign, { assign: { b1: 1 } }).problem, 'too little damage is caught');
assert(!F.vet(samples.targets, { tg: [[{ c: 'y' }], [{ p: 'A' }]] }).problem, 'a good answer passes');
assert(F.vet({ kind: 'mystery' }, {}).problem, 'unknown questions are flagged');
console.log(`interface sheet ok — ${asks.size} question kinds, ${todos.size} job kinds covered`);
