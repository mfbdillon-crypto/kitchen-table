// Writes docs/RULES_SHEET.md from the rulebook itself (so the sheet never goes out of date).
// node test/rules_sheet.js > ../kitchen-table/docs/RULES_SHEET.md
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
for (const f of ['cards', 'effects', 'oracle', 'rules', 'engine']) require('../site/' + f + '.js');
const RB = globalThis.Rulebook, e = x => String(x).replace(/\|/g, '\\|');
const src = re => '`' + e(String(re).replace(/^\/|\/[a-z]*$/g, '')) + '`';
const o = ['# Kitchen Table — rulebook sheet', '', 'Generated from `site/rulebook.js`. Every player starts with the default limits; card text read by the',
  'patterns below adds permissions (CAN) or restrictions (CAN\'T) for the players it names. "Can\'t" beats "can" (101.2).',
  'Temporary rules from resolving spells ("until your next turn, …", "this turn, …") use the same patterns.', ''];
for (const area of ['casting', 'combat', 'abilities', 'zones']) {
  o.push(`## Default rules — ${area}`, '', '| Id | Rule | What nobody can do |', '|---|---|---|');
  for (const d of RB.DEFAULTS.filter(x => x.area === area)) o.push(`| \`${d.id}\` | ${d.rule} | ${e(d.text)} |`);
  o.push('');
}
for (const kind of ['can', 'cant']) {
  o.push(kind === 'can' ? '## Permissions cards grant (CAN)' : '## Restrictions cards impose (CAN\'T)', '', '| Id | Who | Card text pattern |', '|---|---|---|');
  for (const p of RB.PATTERNS.filter(x => x.kind === kind)) o.push(`| \`${p.id}\` | ${p.who || (p.whoFrom ? 'from the text' : 'you')} | ${src(p.re)} |`);
  o.push('');
}
o.push('## Card keywords that work outside the hand', '', 'Read from each card\'s own text (`Oracle.model(card).costs`): flashback, escape, jump-start, retrace, disturb,',
  'harmonize, aftermath (graveyard); foretell, plot, warp, impulse draw (`mayPlay`), rebound (exile); unearth, embalm, eternalize, encore',
  '(graveyard abilities); the commander from the command zone.', '');
process.stdout.write(o.join('\n'));
