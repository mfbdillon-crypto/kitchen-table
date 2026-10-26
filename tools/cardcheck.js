// Dev-mode card check over the 18 precons: every card is put where it would be used (battlefield, graveyard, hand), and we
// record what the game reads and offers: abilities, the operations each effect becomes, what can't be done automatically,
// permissions the rulebook gives it, and static lines nothing understands.
// usage: node tools/cardcheck.js [--json] [--deck N] [--card "Name"]
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
const base = __dirname + '/../site/';
for (const f of ['cards', 'scry', 'effects', 'oracle', 'rulebook', 'rules', 'engine', 'precons', 'aiprofiles']) require(base + f + '.js');
const fs = require('fs');
const db = {}; for (const c of JSON.parse(fs.readFileSync(__dirname + '/../data/forgecards.json', 'utf8'))) db[c.name] = c;
const args = process.argv.slice(2), want = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const onlyDeck = want('--deck'), onlyCard = want('--card');
const R = Rules, RB = Rulebook;
const engSrc = fs.readFileSync(base + 'engine.js', 'utf8');
const handled = new Set([...engSrc.matchAll(/case '([a-zA-Z]+)'/g)].map(m => m[1]).concat(['if', 'instead', 'reflexive', 'crew']));
const problems = [];
const walk = (x, f) => { if (Array.isArray(x)) return x.forEach(y => walk(y, f)); if (x && typeof x === 'object') { if (x.op) f(x); for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v, f); } };
const seen = new Set(); const out = [];
// a two-player state; A owns the card under test
const fresh = () => { const s = R.newState(); for (const p of ['A', 'B']) R.apply(s, p, { type: 'join', name: p }); R.apply(s, 'A', { type: 'start' }); for (const p of ['A', 'B']) { s.players[p].kept = true; s.players[p].online = true; s.players[p].libCount = 40; s.players[p].handCount = 5; } s.seats = ['A', 'B']; s.turn.active = 'A'; s.turn.phase = R.PI('Main 1'); s.turn.mulls = false; return s; };
for (const [di, pc] of KT_PRECONS.entries()) {
  if (onlyDeck != null && +onlyDeck !== di) continue;
  for (const ent of pc.list.split('|')) {
    const name = ent.replace(/^\d+\s+/, ''); if (onlyCard && name !== onlyCard) continue;
    const sc = db[name] || db[name.split(' // ')[0]]; if (!sc) { problems.push({ deck: di, card: name, kind: 'missing-data' }); continue; }
    if (seen.has(name)) continue; seen.add(name);
    const d = Scry.toD(sc);
    const rec = { deck: di, card: name, type: d.faces[0].t, issues: [], ok: [] };
    // 1. model + effects
    const M = Oracle.model({ d, face: 0 });
    for (const a of M.abilities) {
      if (a.kind === 'static' && a.unknownStatic) rec.issues.push(['static?', a.text]);
      const text = a.kind === 'spell' ? a.text : a.effect;
      if (!text || a.kind === 'keyword') continue;
      const ops = a.ops || Effects.parse(text).ops;
      walk(ops, o => { if (o.op === 'manual') rec.issues.push(['manual', a.kind + ': ' + (o.text || '')]); else if (!handled.has(o.op)) rec.issues.push(['unknown-op', a.kind + ': [' + o.op + '] ' + (o.src || '')]); });
      if (a.kind === 'triggered' && (!a.event || a.event.type === 'other')) rec.issues.push(['trigger?', a.text]);
    }
    // 2. on the battlefield: abilities offered
    const s = fresh(); const c = { id: 'T', owner: 'A', ctrl: 'A', zone: 'battlefield', counters: {}, d, ctlT: 0, seq: 1 }; s.cards.T = c; Cards.setState(s);
    try { const abs = Cards.abilities(c) || []; rec.abilities = abs.length; } catch (e) { rec.issues.push(['crash', 'abilities: ' + e.message]); }
    // 3. permissions this card grants or takes away while on the battlefield
    try { const sh = RB.sheet(s, 'A'), sb = RB.sheet(s, 'B'); const mine = [...sh.can, ...sh.cant, ...sb.can, ...sb.cant].filter(e => e.src === 'T' || e.srcName === name); if (mine.length) rec.ok.push('rules: ' + mine.map(e => e.text || e.id).join(' / ')); } catch (e) { rec.issues.push(['crash', 'sheet: ' + e.message]); }
    // 4. in the graveyard / exile: can it be cast or played from there?
    for (const z of ['graveyard', 'exile']) { try { const cz = Object.assign({}, c, { zone: z, id: 'Z' }); s.cards.Z = cz; const w = RB.ways(s, 'A', cz); if (w.length) rec.ok.push(z + ': ' + w.map(x => x.label || x.kind).join(', ')); delete s.cards.Z; } catch (e) { rec.issues.push(['crash', z + ': ' + e.message]); } }
    const gyWords = /\b(flashback|escape|unearth|embalm|eternalize|encore|disturb|jump-start|retrace|aftermath|scavenge)\b/i.test(Cards.rawText(c));
    if (gyWords && !rec.ok.some(x => /^graveyard/.test(x)) && !/scavenge|unearth|embalm|eternalize|encore/i.test(Cards.rawText(c))) rec.issues.push(['gy-way?', 'has a graveyard keyword but nothing is offered there']);
    out.push(rec);
  }
}
const bad = out.filter(r => r.issues.length);
if (args.includes('--json')) { console.log(JSON.stringify({ cards: out.length, bad: bad.length, problems, out }, null, 1)); process.exit(0); }
const byKind = {}; for (const r of bad) for (const [k] of r.issues) byKind[k] = (byKind[k] || 0) + 1;
console.log(`${out.length} cards, ${bad.length} with issues`, JSON.stringify(byKind), problems.length ? 'missing data: ' + problems.map(p => p.card).join(', ') : '');
for (const r of bad) { console.log(`[${r.deck}] ${r.card} — ${r.type}`); for (const [k, t] of r.issues) console.log(`   ${k}: ${String(t).slice(0, 170)}`); }
