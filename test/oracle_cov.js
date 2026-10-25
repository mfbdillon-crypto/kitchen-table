// Card-model coverage over every card in the ready-made decks (data/forgecards.json).
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
require('../site/cards.js'); require('../site/scry.js'); require('../site/effects.js'); require('../site/oracle.js');
const fs = require('fs');
const cards = JSON.parse(fs.readFileSync(__dirname + '/../data/forgecards.json', 'utf8'));
const extra = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : [];
const all = cards.concat(extra);
const kinds = {}, unknown = [], otherTrig = [], notUnderstood = {}, conds = {};
let abil = 0;
for (const sc of all) {
  const d = Scry.toD(sc);
  for (let fi = 0; fi < d.faces.length; fi++) {
    const m = Oracle.model({ d, face: fi, counters: {} });
    for (const a of m.abilities) {
      abil++; kinds[a.kind] = (kinds[a.kind] || 0) + 1;
      if (a.kind === 'triggered' && a.event && a.event.type === 'other') otherTrig.push(m.name + ' :: ' + a.eventText);
      if (a.kind === 'triggered' && a.condition) conds[a.condition] = (conds[a.condition] || 0) + 1;
      if ((a.kind === 'triggered' || a.kind === 'activated' || a.kind === 'spell') && a.understood === false) { const k = a.kind; (notUnderstood[k] = notUnderstood[k] || []).push(m.name + ' :: ' + (a.unknownText || a.text)); }
    }
    for (const u of m.unknown) unknown.push(m.name + ' :: ' + u);
  }
}
const pct = (n, d) => (100 * n / d).toFixed(1) + '%';
console.log('cards', all.length, 'abilities', abil, JSON.stringify(kinds));
console.log('unclassified lines', unknown.length, pct(unknown.length, abil));
console.log('triggers with unrecognised event', otherTrig.length);
for (const k of Object.keys(notUnderstood)) console.log('effects not understood —', k, notUnderstood[k].length, '/', kinds[k], pct(notUnderstood[k].length, kinds[k]));
if (process.env.SHOW) {
  const show = process.env.SHOW;
  const L = show === 'unknown' ? unknown : show === 'events' ? otherTrig : show === 'conds' ? Object.entries(conds).sort((a, b) => b[1] - a[1]).map(x => x[1] + ' ' + x[0]) : notUnderstood[show] || [];
  console.log(L.slice(0, +(process.env.N || 80)).join('\n'));
}
