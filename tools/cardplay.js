// Dev-mode play test of every precon card on a full table.
//   The tester (A) has lands of every colour, creatures (one with a +1/+1 counter), an artifact, an enchantment, cards in
//   the graveyard and in exile; the opponent (B) has creatures (one flying), an artifact, an enchantment, a land, a
//   planeswalker and cards in their graveyard. The card under test is put where it's used (battlefield, or cast as a spell),
//   each ability is used against that table with legal targets picked automatically, and the result is compared with
//   the table before: did anything happen? was anything left to do by hand? were there targets to pick?
// usage: node tools/cardplay.js [--deck N] [--card "Name"] [--verbose]
global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
const base = __dirname + '/../site/';
for (const f of ['cards', 'scry', 'effects', 'oracle', 'rulebook', 'rules', 'engine', 'precons']) require(base + f + '.js');
const fs = require('fs');
const db = {}; for (const c of JSON.parse(fs.readFileSync(__dirname + '/../data/forgecards.json', 'utf8'))) db[c.name] = c;
const args = process.argv.slice(2), want = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const onlyDeck = want('--deck'), onlyCard = want('--card'), verbose = args.includes('--verbose');
const R = Rules, RB = Rulebook;
const FILL = {
  'Grizzly Bears': ['Creature — Bear', '', '2', '2', 2, '{1}{G}'], 'Hill Giant': ['Creature — Giant', '', '3', '3', 4, '{3}{R}'],
  'Rancor': ['Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+0 and has trample.', '', '', 1, '{G}'],
  'Lightning Bolt': ['Instant', 'Lightning Bolt deals 3 damage to any target.', '', '', 1, '{R}'], 'Shock': ['Instant', 'Shock deals 2 damage to any target.', '', '', 1, '{R}'],
  'Pacifism': ['Enchantment — Aura', "Enchant creature\nEnchanted creature can't attack or block.", '', '', 2, '{1}{W}'],
  'Divination': ['Sorcery', 'Draw two cards.', '', '', 3, '{2}{U}'], 'Counterspell': ['Instant', 'Counter target spell.', '', '', 2, '{U}{U}'],
  'Serra Angel': ['Creature — Angel', 'Flying, vigilance', '4', '4', 5, '{3}{W}{W}'],
  'Liliana of the Veil': ['Legendary Planeswalker — Liliana', '+1: Each player discards a card.\n−2: Target player sacrifices a creature.', '', '', 3, '{1}{B}{B}'],
};
const D = n => { const sc = db[n]; if (sc) return Scry.toD(sc); const f = FILL[n]; if (!f) throw new Error('no card ' + n); return { n, cmc: f[4], faces: [{ n, t: f[0], o: f[1], p: f[2], tg: f[3], mc: f[5], img: '' }] }; };
let N = 0;
function table() {
  const s = R.newState();
  for (const p of ['A', 'B']) R.apply(s, p, { type: 'join', name: p });
  R.apply(s, 'A', { type: 'start' });
  for (const p of ['A', 'B']) Object.assign(s.players[p], { kept: true, online: true, libCount: 40, handCount: 5, life: 30 });
  s.seats = ['A', 'B']; Object.assign(s.turn, { active: 'A', phase: R.PI('Main 1'), mulls: false, n: 3, starts: { A: 3, B: 2 } });
  const put = (owner, zone, name, extra) => { const id = owner + (++N); s.cards[id] = Object.assign({ id, owner, ctrl: owner, zone, counters: {}, d: D(name), ctlT: 0, seq: ++s.seq, face: 0 }, extra || {}); return id; };
  for (const n of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Command Tower', 'Sol Ring']) put('A', 'battlefield', n);
  put('A', 'battlefield', 'Grizzly Bears'); put('A', 'battlefield', 'Hill Giant', { counters: { '+1/+1': 1 } });
  put('A', 'battlefield', 'Arcane Signet'); put('A', 'battlefield', 'Rancor');
  for (const n of ['Llanowar Elves', 'Lightning Bolt', 'Forest', 'Mind Stone', 'Pacifism', 'Divination']) put('A', 'graveyard', n);
  put('A', 'exile', 'Shock');
  put('B', 'battlefield', 'Serra Angel'); put('B', 'battlefield', 'Grizzly Bears'); put('B', 'battlefield', 'Sol Ring'); put('B', 'battlefield', 'Pacifism'); put('B', 'battlefield', 'Swamp');
  put('B', 'battlefield', 'Liliana of the Veil', { counters: { loyalty: 3 } });
  for (const n of ['Llanowar Elves', 'Counterspell', 'Island']) put('B', 'graveyard', n);
  // a fight in progress: my Bears attack B, B's Bears block; B's Angel attacks nobody
  const myBear = Object.values(s.cards).find(c => c.owner === 'A' && c.zone === 'battlefield' && c.d.n === 'Grizzly Bears'), hisBear = Object.values(s.cards).find(c => c.owner === 'B' && c.d.n === 'Grizzly Bears');
  s.combat = { n: s.turn.n, att: { [myBear.id]: { def: { p: 'B' }, blk: [hisBear.id] } }, waiting: [], ok: { B: true }, done: false };
  s.ctxCard = Object.values(s.cards).find(c => c.owner === 'B' && c.d.n === 'Serra Angel').id;
  s.dev = true; Cards.setState(s);
  return s;
}
const snapOf = s => JSON.stringify(Object.assign({}, s, { log: null, seq: null, rev: null, aichat: null, ask: (s.ask || []).filter(q => q.kind !== 'manual') }));
const walk = (x, f) => { if (Array.isArray(x)) return x.forEach(y => walk(y, f)); if (x && typeof x === 'object') { if (x.op) f(x); for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v, f); } };
// pick legal targets for every requirement of a text
function pickTargets(s, text, by) {
  const reqs = Cards.targetsIn(text); const tg = []; const none = [];
  for (const r of reqs) {
    const ch = Cards.targetChoices(s, r, by);
    // prefer the opponent's things for harmful-looking text, mine for helpful
    const helpful = !/damage|destroy|exile|sacrifice|loses?|counter target/i.test(text) && /\b(gets? \+|gains?|return .* to (?:your|its owner's) hand from|untap|put a \+1\/\+1|regenerate|protection|hexproof|indestructible)/i.test(text);
    ch.sort((a, b) => { const ca = a.c ? s.cards[a.c] : null, cb = b.c ? s.cards[b.c] : null; const oa = a.p || (ca && ca.ctrl), ob = b.p || (cb && cb.ctrl); const want = helpful ? by : (by === 'A' ? 'B' : 'A'); return (ob === want) - (oa === want); });
    const n = r.upTo ? Math.min(1, ch.length) : Math.min(r.n || 1, ch.length);
    if (!ch.length && !r.upTo) none.push(r.text);
    tg.push(ch.slice(0, n));
  }
  return { tg, none, reqs };
}
// Static wordings handled by code outside the card model (the function that does each is named).
const HANDLED = [
  /enter(?: the battlefield)? tapped/i,                                   // rules.entersTapped
  /can't be countered/i,                                                  // Cards.uncounterable
  /triggers an additional time|don't cause abilities/i,                  // engine.triggerTimes
  /in addition to (?:its|their) other (?:land )?types/i,                  // Cards.extraLandTypes / staticAnim
  /spend mana as though it were mana of any color/i,                      // Cards.pay
  /^skip your draw step/i,                                                // game.autoDraw
  /doesn't untap during|don't untap during|untap all permanents you control during each other/i,   // rules untap step
  /costs? \{[\dx]\} less to cast|affinity for/i,                         // Cards.costReduction / costOf
  /power and toughness are each equal to|power is equal to|toughness is equal to/i,   // Cards.pt (characteristic-defining)
  /^dredge \d+/i,                                                        // game.draw (dredge)
  /^(?:a deck can have|choose a background|this can be your commander|companion —)/i,   // deck building, not play
  /^enchant /i,                                                           // aura targets when cast
  /^ward—|^equip—/i,                                                      // Cards.wardCost / equip
  /(?:equipped|enchanted) creature (?:gets|has|can't)/i,                  // Cards.statics (attached)
  /^(?:all |other )?(?:[a-z]+s?)(?: and [a-z]+s)? (?:you control )?have [a-z]/i,   // Cards.extraStatics keyword grants
  /creatures of the chosen type have|of the chosen type .*gets/i,       // Cards.extraStatics
  /creatures with(?:out)? flying get/i,                                   // Cards.extraStatics
  /can't attack you/i,                                                    // oracle attackTax / combat checks
  /^during your turn, /i,                                                 // Cards.extraStatics / staticAnim
  /^you may look at the top card of your library any time|^play with the top card/i,   // Rulebook.topView
];
const results = []; const seen = new Set();
for (const [di, pc] of KT_PRECONS.entries()) {
  if (onlyDeck != null && +onlyDeck !== di) continue;
  for (const ent of pc.list.split('|')) {
    const name = ent.replace(/^\d+\s+/, ''); if (onlyCard && name !== onlyCard) continue;
    if (seen.has(name) || !db[name]) continue; seen.add(name);
    const d = D(name), rec = { deck: di, card: name, notes: [], issues: [] };
    const M = Oracle.model({ d, face: 0 });
    const isSpell = M.types.includes('instant') || M.types.includes('sorcery');
    const isLand = M.types.includes('land');
    for (const a of M.abilities) {
      if (!['spell', 'activated', 'triggered', 'mana'].includes(a.kind)) continue;
      const text = a.kind === 'spell' ? a.text : a.effect; if (!text) continue;
      const s = table();
      const id = 'T'; s.cards[id] = { id, owner: 'A', ctrl: 'A', zone: isSpell ? 'stack' : 'battlefield', counters: a.loyalty != null ? { loyalty: 6 } : {}, d, ctlT: 0, seq: ++s.seq, face: 0 };
      if (M.types.includes('planeswalker')) s.cards[id].counters.loyalty = 6;
      const { tg, none, reqs } = pickTargets(s, text, 'A');
      if (none.length) rec.issues.push(['no-target', `${a.kind}: “${text.slice(0, 90)}” — nothing legal for: ${none.join('; ')}`]);
      let ops;
      try { ops = a.kind === 'spell' ? (Engine.spellOps(s, s.cards[id]) || {}).ops : (a.ops || Effects.parse(text).ops); } catch (e) { rec.issues.push(['crash', 'parse ' + e.message]); continue; }
      if (!ops || !ops.length) { rec.issues.push(['no-ops', `${a.kind}: ${text.slice(0, 120)}`]); continue; }
      const before = snapOf(s), notes = [];
      s.cards[id].mode = [0]; s.cards[id].x = 2;
      const item = { id: 'item', ctrl: 'A', x: 2, d, ab: { name, src: id, ctx: { c: s.ctxCard, p: 'B', mv: 3 } }, mode: [0] };
      try { Engine.run(s, item, ops, tg, notes, {}); } catch (e) { rec.issues.push(['crash', `${a.kind}: ${e.message}`]); continue; }
      const manual = (s.ask || []).filter(q => q.kind === 'manual').flatMap(q => q.text);
      if (manual.length) rec.issues.push(['by-hand', `${a.kind}: ${manual.join(' | ').slice(0, 150)}`]);
      const changed = snapOf(s) !== before;
      if (!changed && !manual.length && !/^(?:add|you may)/i.test(text)) rec.issues.push(['no-effect', `${a.kind}: “${text.slice(0, 120)}”${reqs.length ? ' targets ' + JSON.stringify(tg) : ''} — notes: ${notes.join('; ').slice(0, 120)}`]);
      if (verbose) rec.notes.push(`${a.kind}: ${text.slice(0, 80)} → ${notes.join('; ').slice(0, 200)}`);
    }
    // permanents: abilities offered on the battlefield, and from the graveyard / exile
    if (!isSpell) {
      const s = table(); const c = { id: 'T', owner: 'A', ctrl: 'A', zone: 'battlefield', counters: {}, d, ctlT: 0, seq: ++s.seq, face: 0 }; s.cards.T = c; Cards.setState(s);
      const acts = M.abilities.filter(a => a.kind === 'activated' && !a.zone);
      let offered = []; try { offered = Cards.abilities(c) || []; } catch (e) { rec.issues.push(['crash', 'abilities ' + e.message]); }
      if (acts.length > offered.length) rec.issues.push(['not-offered', `${acts.length} activated abilities read, ${offered.length} offered on the battlefield`]);
    }
    for (const z of ['graveyard', 'exile']) {
      const s = table(); const c = { id: 'Z', owner: 'A', ctrl: 'A', zone: z, counters: {}, d, seq: ++s.seq, face: 0 }; s.cards.Z = c;
      let w = []; try { w = RB.ways(s, 'A', c); } catch (e) { rec.issues.push(['crash', z + ' ways ' + e.message]); }
      if (w.length) rec.notes.push(z + ': ' + w.map(x => x.label || x.kind).join(', '));
      if (z === 'graveyard' && /\b(flashback|escape|retrace|jump-start|disturb|aftermath)\b/i.test(Cards.rawText(c)) && !w.length) rec.issues.push(['gy-way', 'graveyard keyword but nothing offered']);
    }
    // Static lines nothing in the card model read: are they handled somewhere else (rulebook permissions, anthems and
    // keywords, cost reductions, untap/enter rules…)? Check by their effect on the table.
    const unk = M.abilities.filter(a => a.unknownStatic);
    if (unk.length) {
      const s0 = table(), s1 = table();
      s1.cards.T = { id: 'T', owner: 'A', ctrl: 'A', zone: 'battlefield', counters: {}, d, ctlT: 0, seq: ++s1.seq, face: 0 };
      const look = st => { Cards.setState(st); const cr = Object.values(st.cards).filter(c => c.zone === 'battlefield' && c.id !== 'T' && (c.faceDown || R.isType(c, 'creature'))); const sp = [{ d: D('Grizzly Bears'), zone: 'hand', owner: 'A', counters: {} }, { d: D('Lightning Bolt'), zone: 'hand', owner: 'A', counters: {} }, { d: D('Serra Angel'), zone: 'hand', owner: 'B', counters: {} }];
        return JSON.stringify([cr.map(c => [Cards.pt(st, c), [...Cards.keywords(c, st)].sort(), R.isType(c, 'creature')]), sp.map(c => Cards.costReduction ? Cards.costReduction(st, c, c.owner) : 0), RB.sheet(st, 'A').can.length, RB.sheet(st, 'A').cant.length, RB.sheet(st, 'B').can.length, RB.sheet(st, 'B').cant.length, RB.topView(st, 'A')]); };
      const changed = look(s0) !== look(s1);
      for (const a of unk) { const rb = RB.readLine(a.text.toLowerCase(), 'A', 'T', name, s1); if (!rb.length && !changed && !HANDLED.some(re => re.test(a.text))) rec.issues.push(['static?', a.text.slice(0, 150)]); }
    }
    results.push(rec);
  }
}
const bad = results.filter(r => r.issues.length);
const byKind = {}; for (const r of bad) for (const [k] of r.issues) byKind[k] = (byKind[k] || 0) + 1;
console.log(`${results.length} cards played, ${bad.length} with issues`, JSON.stringify(byKind));
for (const r of (verbose ? results : bad)) { console.log(`[${r.deck}] ${r.card}`); for (const [k, t] of r.issues) console.log(`   ${k}: ${t}`); if (verbose) for (const n of r.notes) console.log('   · ' + n); }
