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
o.push('## Activation costs the table pays (602.2, `Cards.costPart`)', '',
  '| Cost text | How it is paid |', '|---|---|',
  '| `{…}`, `{T}`, `Sacrifice this`, `Sacrifice a/another X`, `Discard a card`, `Pay N life`, `Pay {E}`, `Exile this` | as printed |',
  '| `Return a/two/three X you control to its owner\'s hand` / `Return this to its owner\'s hand` | you pick the permanents (bounce) |',
  '| `Untap a/two/… tapped X you control` | you pick the tapped creatures |',
  '| `Tap a/an/another untapped X you control` | you pick them |',
  '| `Remove a/N <kind> counter(s) from this` / `Put a <kind> counter on this` | from / onto the card itself (refused without enough counters) |',
  '| `Exile a/N X card(s) from your graveyard` | you pick them |', '| `Discard two/N cards` | your device discards |', '| `Sacrifice two/N X` | you pick them |',
  '| `Pay life equal to the number of colors in your commanders\' color identity` | counted from your commanders |', '');
o.push('## Abilities used from the hand (`Cards.handAbilities`)', '', 'Cycling {N} → draw a card; basic landcycling / landcycling / <type>cycling {N} → search for that card; Channel — {N}, Discard this: …;',
  '`{N}, Discard this: …`. The card is discarded as the cost and the ability goes on the stack (action `handAb`).', '');
o.push('## Choices while it resolves', '', '- **Your choice of …** — `gains your choice of flying, vigilance, or trample`, `put your choice of a +1/+1, flying, or lifelink counter on …`: its controller gets a bar of buttons before it resolves (ask `pick`); the AI picks the strongest keyword (+1/+1 counters high).',
  '- **How many** — X costs, multikicker, replicate: a −/+ picker from 0 with the most the untapped mana can pay (`askCount`). Kicks are stored on the spell (`c.kicks`); replicate copies it that many times.',
  '- **Moving counters** — `Move a +1/+1 counter from target creature onto another target creature`: the first target must have that counter (`flags.counter`).', '');
o.push('## Reveal and route (op `route`, todo `route`)', '', 'A sentence that starts “Reveal / Exile / Look at the top N cards of your library” or “Reveal cards … until you reveal a X card”,',
  'and the sentences after it that say where cards go (“If it\'s a X card, put it …”, “Put it … if it\'s a X card”, “Otherwise, put it …”, “Put that card … and the rest …”,',
  '“Put all X cards revealed this way … and the rest …”, “Put the rest …”) become one effect. “Mill N. You may put a X card from among them into your hand” too.',
  'The owner\'s device shows the cards in a window with where each one goes; where the text doesn\'t say, the player picks from the zones the text names (or any zone with “Other…”).', '');
o.push('## Statics handled outside the card model', '', '| Text | Where |', '|---|---|',
  '| “… enter tapped” (yours or your opponents\') | `rules.entersTapped` |', '| “… can\'t be countered” | `Cards.uncounterable` |',
  '| “… triggers an additional time” (entering, dying, attacking, casting instants/sorceries, chosen type, Shaman/Wizard) / “don\'t cause abilities … to trigger” | `engine.triggerTimes` |',
  '| “Each land is a Forest in addition…”, “All lands are Islands in addition…” | `Cards.extraLandTypes` (types and mana) |',
  '| “You may spend mana as though it were mana of any color” | `Cards.pay` |', '| “If you tap a permanent for mana, it produces three times as much” | `Cards.manaSource` |',
  '| “Enchanted land has \"…\"”, “Treasures you control have \"…\"”, “Equipped creature has \"…\"” | `Cards.granted` (the quoted ability is added to the card) |',
  '| “You control enchanted creature” | `rules.auraControl` (control returns when the Aura leaves) |', '| “The \"legend rule\" doesn\'t apply to permanents you control” | legend rule (rules + engine) |',
  '| “Combat damage … can\'t be prevented” | `rules.combatDamage` |', '| “Creatures without flying or islandwalk can\'t attack” | attack check |',
  '| “Skip your draw step” | `game.autoDraw` |', '| “Dredge N” | `game.draw` (asked on each draw) |',
  '| “This costs {X} less …” (greatest power, total power, artifacts an opponent controls, per {E} paid), chosen-type and per-counter reductions | `Cards.costReduction` |',
  '| “During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard” (Muldrotha) | rulebook `gy.*`, `limit: eachType` — a used-up type is explained on hover |', '');
process.stdout.write(o.join('\n'));
