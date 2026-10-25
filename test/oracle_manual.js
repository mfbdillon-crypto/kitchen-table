// Lists effect clauses the effect parser hands to the player ("manual"), most common shapes first.
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
require('../site/cards.js'); require('../site/scry.js'); require('../site/effects.js'); require('../site/oracle.js');
const fs = require('fs');
const cards = JSON.parse(fs.readFileSync(__dirname + '/../data/forgecards.json', 'utf8'));
const out = [];
for (const sc of cards) { const d = Scry.toD(sc); for (let fi = 0; fi < d.faces.length; fi++) { const m = Oracle.model({ d, face: fi, counters: {} }); for (const a of m.abilities) for (const o of a.ops || []) if (o.op === 'manual') out.push(m.name + ' :: ' + o.text); } }
const O = +process.env.O || 0, N = +process.env.N || 400;
console.log(out.length); console.log(out.slice(O, O + N).join('\n'));
