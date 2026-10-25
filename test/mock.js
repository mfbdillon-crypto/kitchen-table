// Fake Scryfall for tests.
const cards = [];
let n = 0;
function add(name, type, kind, extra) { const id = 'id' + (++n); cards.push(Object.assign({ id, name, type_line: type, cmc: 2, set: 'tst', collector_number: String(n), image_uris: { normal: `https://cards.scryfall.io/normal/${kind}/${id}.jpg` } }, extra || {})); }
for (const l of ['Forest', 'Mountain', 'Plains', 'Command Tower', 'Exotic Orchard']) add(l, l === 'Command Tower' || l === 'Exotic Orchard' ? 'Land' : 'Basic Land — ' + l, 'land');
for (let i = 1; i <= 30; i++) add('Creature ' + i, 'Creature — Bear', 'creature', { power: '2', toughness: '2' });
for (let i = 1; i <= 15; i++) add('Spell ' + i, i % 2 ? 'Instant' : 'Sorcery', 'spell');
add('Rancor', 'Enchantment — Aura', 'spell'); add('Sol Ring', 'Artifact', 'spell');
add('Jace Test', 'Legendary Planeswalker — Jace', 'pw', { loyalty: '3' });
add('Alesha, Who Smiles at Death', 'Legendary Creature — Human Warrior', 'creature', { power: '3', toughness: '2', oracle_id: 'or-alesha', cmc: 3, color_identity: ['B', 'R', 'W'], oracle_text: 'First strike\nWhenever Alesha, Who Smiles at Death attacks, you may pay {W/B}{W/B}. If you do, return target creature card with power 2 or less from your graveyard to the battlefield tapped and attacking.', set: 'frf', set_name: 'Fate Reforged', collector_number: '90', released_at: '2015-01-23', finishes: ['nonfoil', 'foil'], frame: '2015', border_color: 'black' });
const aleshaPrints = [
  { kind: 'creature', set: 'frf', set_name: 'Fate Reforged', collector_number: '90', released_at: '2015-01-23', finishes: ['nonfoil', 'foil'] },
  { kind: 'pw', set: 'sld', set_name: 'Secret Lair Drop', collector_number: '1501', released_at: '2024-03-01', finishes: ['foil'], border_color: 'borderless', full_art: true, promo_types: ['galaxyfoil'] },
  { kind: 'spell', set: 'cmm', set_name: 'Commander Masters', collector_number: '612', released_at: '2023-08-04', finishes: ['nonfoil', 'foil', 'etched'], frame_effects: ['etched'] },
  { kind: 'token', set: 'pip', set_name: 'Fallout', collector_number: '777', released_at: '2024-03-08', finishes: ['nonfoil', 'foil'], frame_effects: ['showcase', 'extendedart'], flavor_name: 'Nora, Vault Dweller', security_stamp: 'triangle' },
  { kind: 'land', set: 'plst', set_name: 'The List', collector_number: 'FRF-90', released_at: '2021-01-01', finishes: ['nonfoil'], frame: '1997' }
].map((x, i) => Object.assign({ id: 'ales-' + i, oracle_id: 'or-alesha', name: 'Alesha, Who Smiles at Death', type_line: 'Legendary Creature — Human Warrior', cmc: 3, power: '3', toughness: '2', border_color: 'black', frame: '2015', image_uris: { normal: `https://cards.scryfall.io/normal/${x.kind}/ales${i}.jpg` } }, x));
const aleshaTwin = { id: 'twin-1', oracle_id: 'or-twin', name: 'Ada, Who Smiles at Danger', type_line: 'Legendary Creature — Human Warrior', cmc: 3, power: '3', toughness: '2', color_identity: ['B', 'R', 'W'], set: 'ub1', set_name: 'Universes Beyond Example', collector_number: '5', released_at: '2025-05-05', finishes: ['nonfoil', 'foil'], security_stamp: 'triangle', border_color: 'black', image_uris: { normal: 'https://cards.scryfall.io/normal/pw/twin.jpg' },
  oracle_text: 'First strike\nWhenever Ada, Who Smiles at Danger attacks, you may pay {W/B}{W/B}. If you do, return target creature card with power 2 or less from your graveyard to the battlefield tapped and attacking.' };
const notTwin = Object.assign({}, aleshaTwin, { id: 'nottwin', oracle_id: 'or-nt', name: 'Someone Else', oracle_text: 'Vigilance' });
cards.push({ id: 'dfc1', name: 'Delver of Secrets // Insectile Aberration', type_line: 'Creature — Human Wizard // Creature — Human Insect', cmc: 1, set: 'tst', collector_number: '99',
  card_faces: [{ name: 'Delver of Secrets', type_line: 'Creature — Human Wizard', power: '1', toughness: '1', image_uris: { normal: 'https://cards.scryfall.io/normal/creature/dfc1a.jpg' } },
    { name: 'Insectile Aberration', type_line: 'Creature — Human Insect', power: '3', toughness: '2', image_uris: { normal: 'https://cards.scryfall.io/normal/creature/dfc1b.jpg' } }] });
const tokens = [{ id: 'tok1', name: 'Treasure', type_line: 'Token Artifact — Treasure', image_uris: { normal: 'https://cards.scryfall.io/normal/token/t1.jpg' } },
  { id: 'tok2', name: 'Soldier', type_line: 'Token Creature — Soldier', power: '1', toughness: '1', image_uris: { normal: 'https://cards.scryfall.io/normal/token/t2.jpg' } }];
// Real-looking cards with rules text, for AI games.
const REAL = [
  ['Forest', 'Basic Land — Forest', '', 0, '({T}: Add {G}.)', null, null, [], ['G'], 'land'],
  ['Mountain', 'Basic Land — Mountain', '', 0, '({T}: Add {R}.)', null, null, [], ['R'], 'land'],
  ['Plains', 'Basic Land — Plains', '', 0, '({T}: Add {W}.)', null, null, [], ['W'], 'land'],
  ['Command Tower', 'Land', '', 0, "{T}: Add one mana of any color in your commander's color identity.", null, null, [], ['G', 'R'], 'land'],
  ['Llanowar Elves', 'Creature — Elf Druid', '{G}', 1, '{T}: Add {G}.', '1', '1', [], ['G'], 'creature'],
  ['Grizzly Bears', 'Creature — Bear', '{1}{G}', 2, '', '2', '2', [], [], 'creature'],
  ['Hill Giant', 'Creature — Giant', '{3}{R}', 4, '', '3', '3', [], [], 'creature'],
  ['Goblin Guide', 'Creature — Goblin Scout', '{R}', 1, 'Haste', '2', '2', ['Haste'], [], 'creature'],
  ['Colossal Dreadmaw', 'Creature — Dinosaur', '{4}{G}{G}', 6, 'Trample', '6', '6', ['Trample'], [], 'creature'],
  ['Prodigal Pyromancer', 'Creature — Human Wizard', '{2}{R}', 3, '{T}: Prodigal Pyromancer deals 1 damage to any target.', '1', '1', [], [], 'creature'],
  ['Giant Spider', 'Creature — Spider', '{3}{G}', 4, 'Reach', '2', '4', ['Reach'], [], 'creature'],
  ['Serra Angel', 'Creature — Angel', '{3}{W}{W}', 5, 'Flying, vigilance', '4', '4', ['Flying', 'Vigilance'], [], 'creature'],
  ['Lightning Bolt', 'Instant', '{R}', 1, 'Lightning Bolt deals 3 damage to any target.', null, null, [], [], 'spell'],
  ['Giant Growth', 'Instant', '{G}', 1, 'Target creature gets +3/+3 until end of turn.', null, null, [], [], 'spell'],
  ['Rampant Growth', 'Sorcery', '{1}{G}', 2, 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.', null, null, [], [], 'spell'],
  ['Cultivate', 'Sorcery', '{2}{G}', 3, 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', null, null, [], [], 'spell'],
  ['Prey Upon', 'Sorcery', '{G}', 1, "Target creature you control fights target creature you don't control.", null, null, [], [], 'spell'],
  ['Divination', 'Sorcery', '{2}{U}', 3, 'Draw two cards.', null, null, [], [], 'spell'],
  ['Sol Ring', 'Artifact', '{1}', 1, '{T}: Add {C}{C}.', null, null, [], ['C'], 'spell'],
  ['Rancor', 'Enchantment — Aura', '{G}', 1, "Enchant creature\nEnchanted creature gets +2/+0 and has trample.\nWhen Rancor is put into a graveyard from the battlefield, return Rancor to its owner's hand.", null, null, [], [], 'spell'],
  ['Murder', 'Instant', '{1}{B}{B}', 3, 'Destroy target creature.', null, null, [], [], 'spell'],
  ['Ruric Thar, the Unbowed', 'Legendary Creature — Ogre Warrior', '{4}{R}{G}', 6, 'Vigilance, reach\nRuric Thar, the Unbowed attacks each combat if able.\nWhenever a player casts a noncreature spell, Ruric Thar, the Unbowed deals 6 damage to that player.', '6', '6', ['Vigilance', 'Reach'], [], 'creature'],
  ['Bruna, Light of Alabaster', 'Legendary Creature — Angel', '{3}{G}{W}{U}', 6, 'Flying, vigilance', '5', '5', ['Flying', 'Vigilance'], [], 'creature']
];
for (const [name, type, mc, cmc, o, p2, t2, kw, pm, kind] of REAL) {
  const id = 'real-' + name.toLowerCase().replace(/[^a-z]+/g, '-');
  const prior = cards.findIndex(c => c.name === name); if (prior >= 0) cards.splice(prior, 1);
  cards.push({ id, name, type_line: type, mana_cost: mc, cmc, oracle_text: o.replace(/\\n/g, '\n'), power: p2 || undefined, toughness: t2 || undefined, keywords: kw, produced_mana: pm, color_identity: [], set: 'tst', collector_number: 'r' + id.length + name.length, image_uris: { normal: `https://cards.scryfall.io/normal/${kind}/${id}.jpg` } });
}
// Real card text for the ready-made decks (data/forgecards.json, built from Forge's card scripts), for AI playtests.
try {
  const have = new Set(cards.map(c => c.name.toLowerCase()));
  const kindOf = t => /Land/.test(t) ? 'land' : /Creature/.test(t) ? 'creature' : /Planeswalker/.test(t) ? 'pw' : 'spell';
  for (const c of JSON.parse(require('fs').readFileSync(__dirname + '/../data/forgecards.json', 'utf8'))) {
    if (have.has(c.name.toLowerCase())) continue;
    const fix = u => u.replace('/front/', '/' + kindOf(c.type_line || '') + '/');
    if (c.image_uris) c.image_uris = { normal: fix(c.image_uris.normal) };
    if (c.card_faces) for (const f of c.card_faces) if (f.image_uris) f.image_uris = { normal: fix(f.image_uris.normal).replace('/' + kindOf(c.type_line || '') + '/', '/' + kindOf(f.type_line || '') + '/') };
    cards.push(c);
  }
} catch (e) {}
const byName = new Map(cards.map(c => [c.name.toLowerCase(), c]));
for (const c of cards) if (c.card_faces) byName.set(c.card_faces[0].name.toLowerCase(), c);
const fs = require('fs');
module.exports = async function install(ctx) {
  await ctx.route('**/.netlify/functions/moxfield**', r => r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"offline test"}' }));
  await ctx.route('https://cards.scryfall.io/**', r => { const k = (r.request().url().match(/\/(?:normal|art_crop|large|small|png)\/([^/]+)\//) || [0, 'creature'])[1]; r.fulfill({ contentType: 'image/png', body: fs.readFileSync(__dirname + '/img_' + (fs.existsSync(__dirname + '/img_' + k + '.png') ? k : 'creature') + '.png') }); });
  await ctx.route('https://api.scryfall.com/**', async r => {
    const u = new URL(r.request().url());
    const json = o => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (u.pathname === '/cards/autocomplete') { const q = u.searchParams.get('q').toLowerCase(); return json({ data: cards.map(c => c.name).filter(x => x.toLowerCase().includes(q)).slice(0, 20) }); }
    if (u.pathname === '/cards/named') { const c = byName.get(u.searchParams.get('exact').toLowerCase()); return c ? json(c) : r.fulfill({ status: 404, contentType: 'application/json', body: '{"details":"not found"}' }); }
    if (u.pathname === '/cards/search') {
      const raw = u.searchParams.get('q');
      if (/oracleid:or-alesha/.test(raw) && !/-oracleid/.test(raw)) return json({ data: aleshaPrints, has_more: false });
      if (/-oracleid:or-alesha/.test(raw)) return json({ data: [aleshaTwin, notTwin], has_more: false });
      if (/oracleid:/.test(raw)) return json({ data: [], has_more: false });
      const q = raw.toLowerCase().replace('t:token', '').trim(); return json({ data: tokens.filter(t => !q || t.name.toLowerCase().includes(q)) });
    }
    if (u.pathname === '/cards/collection') {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } });
      const ids = JSON.parse(r.request().postData()).identifiers; const data = [], nf = [];
      for (const i of ids) { const c = i.id ? cards.find(x => x.id === i.id) : i.name ? byName.get(i.name.toLowerCase()) : cards.find(x => x.set === i.set && x.collector_number === i.collector_number); if (c) data.push(c); else nf.push(i); }
      return json({ data, not_found: nf });
    }
    r.fulfill({ status: 404, body: '{}' });
  });
  await ctx.route('http://localhost:8090/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.KT_BROKERS=['ws://127.0.0.1:9001/mqtt','ws://127.0.0.1:9002/mqtt'];window.KT_PROBE_MS=700;" }));
};
module.exports.csv = () => {
  const rows = ['Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency'];
  const lands = cards.filter(c => /Land/.test(c.type_line));
  rows.push(`Forest,tst,Test,1,normal,common,30,1,${cards[0].id},0,false,false,near_mint,en,USD`);
  rows.push(`Mountain,tst,Test,2,normal,common,6,2,${cards[1].id},0,false,false,near_mint,en,USD`);
  for (const c of cards.filter(c => !/Land/.test(c.type_line) && !/Alesha/.test(c.name))) rows.push(`"${c.name}",tst,Test,${c.collector_number},normal,common,1,9,${c.id},0,false,false,near_mint,en,USD`);
  rows.push(`"Alesha, Who Smiles at Death",tst,Test,${byName.get('alesha, who smiles at death').collector_number},normal,rare,1,9,,0,false,false,near_mint,en,USD`);
  return rows.join('\n');
};

module.exports.aiDeck = (cmdr) => [
  '// COMMANDER', '1 ' + (cmdr || 'Ruric Thar, the Unbowed'), '',
  '17 Forest', '15 Mountain', '1 Command Tower',
  '4 Llanowar Elves', '6 Grizzly Bears', '5 Hill Giant', '4 Goblin Guide', '3 Colossal Dreadmaw', '3 Prodigal Pyromancer', '4 Giant Spider',
  '6 Lightning Bolt', '4 Giant Growth', '4 Rampant Growth', '3 Cultivate', '3 Prey Upon', '1 Sol Ring', '2 Rancor'
].join('\n');
