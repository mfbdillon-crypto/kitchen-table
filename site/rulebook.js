// Kitchen Table — the rulebook: what every player can't do by default, and the cards that let them (or stop them).
//
// Three lists, all read from the table state (nothing is stored per card name):
//   DEFAULTS  the game's own limits (casting only from your hand, sorcery timing, one land a turn…), each with its rule
//   CAN       per player: permissions granted by cards — Muldrotha, Karador, Courser of Kruphix, flashback, flash…
//   CAN'T     per player: restrictions from cards — Grafdigger's Cage, Drannith Magistrate, Dragonlord Dromoka…
// "Can't" beats "can" (101.2). Cards are read with the PATTERNS table below: one line of text → one entry. Temporary
// rules from resolved spells ("until your next turn, your opponents can't cast spells from anywhere other than their
// hands") live in s.ruleFx; the host's dev-mode edits in s.devPerms.
//
// Rulebook.sheet(s, pid)            → { can: [...], cant: [...] } for that player right now
// Rulebook.ways(s, pid, c)          → every permitted way to cast/play card c from where it is (zone permission only)
// Rulebook.castBlock(s, pid, c, a)  → why this cast/play isn't allowed from that zone, or null (used by Rules)
// Rulebook.flash(s, pid, c)         → a permission to cast c as though it had flash, or null
// Rulebook.use(s, pid, via, c)      → records a once-a-turn permission as used
// Rulebook.why(s, pid, c)           → dev mode: every action for this card and what allows or blocks it
(function (root) {
  'use strict';
  const C = () => root.Cards, O = () => root.Oracle, R = () => root.Rules;
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const n = w => (w == null ? null : /^\d+$/.test(w) ? +w : NUM[w] != null ? NUM[w] : null);

  // ---------------- the default rules (what nobody can do unless a card says so) ----------------
  const DEFAULTS = [
    // casting & playing
    { id: 'cast.hand', area: 'casting', rule: '601.3', text: 'Spells are cast from your hand.' },
    { id: 'cast.command', area: 'casting', rule: '903.8', text: 'Your commander may also be cast from the command zone, for {2} more for each previous time.' },
    { id: 'cast.gy', area: 'casting', rule: '601.3', text: 'You can’t cast cards from a graveyard (flashback, escape, Muldrotha… are exceptions).' },
    { id: 'cast.exile', area: 'casting', rule: '601.3', text: 'You can’t cast cards from exile (foretell, plot, warp, impulse draw, rebound… are exceptions).' },
    { id: 'cast.library', area: 'casting', rule: '601.3', text: 'You can’t cast or play cards from your library (Courser of Kruphix, Vizier of the Menagerie… are exceptions).' },
    { id: 'cast.others', area: 'casting', rule: '601.3', text: 'You can’t cast or play cards you don’t own from any zone, unless an effect lets you.' },
    { id: 'cast.timing', area: 'casting', rule: '307.1', text: 'Non-instant spells only in your main phase, on your turn, with an empty stack (flash is an exception).' },
    { id: 'land.zone', area: 'casting', rule: '305.1', text: 'Lands are played from your hand.' },
    { id: 'land.timing', area: 'casting', rule: '305.2', text: 'One land per turn, on your turn, in a main phase, with an empty stack.' },
    { id: 'cast.cost', area: 'casting', rule: '601.2f', text: 'You pay the full cost, including additional costs.' },
    { id: 'game.start', area: 'casting', rule: '103.5', text: 'Nothing is played until every player has kept an opening hand.' },
    // combat
    { id: 'atk.turn', area: 'combat', rule: '508.1', text: 'Only the active player attacks.' },
    { id: 'atk.sick', area: 'combat', rule: '302.6', text: 'A creature can’t attack or use {T} abilities unless you’ve controlled it since your turn began (haste is an exception).' },
    { id: 'atk.tapped', area: 'combat', rule: '508.1a', text: 'Tapped creatures can’t attack.' },
    { id: 'blk.tapped', area: 'combat', rule: '509.1a', text: 'Tapped creatures can’t block.' },
    { id: 'blk.evasion', area: 'combat', rule: '702', text: 'Flying, menace, fear, intimidate, shadow, horsemanship and "can’t be blocked" limit blockers.' },
    { id: 'cmdr.damage', area: 'combat', rule: '903.10a', text: '21 combat damage from one commander makes a player lose.' },
    // abilities & resources
    { id: 'ab.cost', area: 'abilities', rule: '602.2', text: 'Activated abilities need their full cost: {T}, mana, life, energy, sacrifices.' },
    { id: 'ab.loyalty', area: 'abilities', rule: '606.3', text: 'One loyalty ability per planeswalker per turn, at sorcery speed.' },
    { id: 'ab.sorcery', area: 'abilities', rule: '602.5d', text: '“Activate only as a sorcery” abilities only in your main phase with an empty stack.' },
    { id: 'res.life', area: 'abilities', rule: '119.4', text: 'You can pay life only if your life total is at least that much.' },
    { id: 'res.energy', area: 'abilities', rule: '107.14', text: 'You can pay {E} only with energy counters you have.' },
    { id: 'res.draw', area: 'abilities', rule: '504.1', text: 'One card drawn in your draw step (the first player skips it, 103.8c).' },
    // zones & card movement
    { id: 'zone.hidden', area: 'zones', rule: '400.2', text: 'Libraries and hands are hidden; only the owner sees their hand, nobody sees a library.' },
    { id: 'zone.order', area: 'zones', rule: '401.2', text: 'A library’s order is fixed; nobody may look through it or change it except by an effect.' },
    { id: 'zone.newobj', area: 'zones', rule: '400.7', text: 'A card that changes zones becomes a new object with no memory of where it was.' },
    { id: 'zone.token', area: 'zones', rule: '111.7', text: 'A token that leaves the battlefield ceases to exist the next time state-based actions are checked.' },
    { id: 'zone.cmdr', area: 'zones', rule: '903.9', text: 'A commander that would go to a graveyard or exile may go to the command zone instead.' },
    { id: 'zone.move', area: 'zones', rule: '—', text: 'Cards move only through the rules or effects; free moves by hand are a dev-mode tool for the host.' }
  ];

  // ---------------- card text → permissions and restrictions ----------------
  // act: 'cast' | 'play' (lands) | 'look'; zones: where from; what: card filter; limit: how often; who: 'you'|'opp'|'each'.
  // Lines are matched lower-case with the card's own name already turned into "this".
  const PATTERNS = [
    // graveyard
    { id: 'gy.muldrotha', kind: 'can', re: /during each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard/, out: () => [{ act: ['play', 'cast'], zones: ['graveyard'], what: 'permanent', limit: 'eachType', yourTurn: true }] },
    { id: 'gy.serra', kind: 'can', re: /once during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value (\w+) or less from your graveyard/, out: m => [{ act: ['play', 'cast'], zones: ['graveyard'], what: 'permanent', mvMax: n(m[1]), limit: 'once', yourTurn: true }] },
    { id: 'gy.once', kind: 'can', re: /^(?:during each of your turns|once (?:during )?each (?:of your )?turns?), you may cast (?:a|an|one) ([a-z ]+?) spell(?: with mana value (\w+) or less)? from your graveyard/, out: (m, l) => [{ act: ['cast'], zones: ['graveyard'], what: m[1].replace(/ spell$/, ''), mvMax: n(m[2]), limit: 'once', yourTurn: /during each of your turns|of your turns/.test(l) }] },
    { id: 'gy.lands', kind: 'can', re: /you may play lands from your graveyard/, out: () => [{ act: ['play'], zones: ['graveyard'], what: 'land' }] },
    { id: 'gy.cast', kind: 'can', re: /^you may cast ([a-z ]+?) (?:spells )?from your graveyard/, out: m => [{ act: ['cast'], zones: ['graveyard'], what: m[1].replace(/ spells?$/, '').replace(/^spells$/, 'card') }] },
    { id: 'gy.selfAsLongAs', kind: 'can', re: /^you may cast this from your graveyard as long as (.+)$/, out: m => [{ act: ['cast'], zones: ['graveyard'], self: true, cond: m[1] }] },
    { id: 'gy.oppCast', kind: 'can', re: /you may cast ([a-z ]*?)spells from (?:your )?opponents' graveyards/, out: m => [{ act: ['cast'], zones: ['graveyard'], what: (m[1] || 'card').trim() || 'card', others: true }] },
    // top of the library
    { id: 'top.both', kind: 'can', re: /you may play lands and cast spells from the top of your library/, out: () => [{ act: ['play', 'cast'], zones: ['library'], what: 'card', top: true }] },
    { id: 'top.lands', kind: 'can', re: /you may play lands from the top of your library/, out: () => [{ act: ['play'], zones: ['library'], what: 'land', top: true }] },
    { id: 'top.cast', kind: 'can', re: /you may cast ([a-z ]*?)spells from the top of your library/, out: m => [{ act: ['cast'], zones: ['library'], what: (m[1] || '').trim() || 'card', top: true }] },
    { id: 'top.look', kind: 'can', re: /you may look at the top (?:card )?of your library any time/, out: () => [{ act: ['look'], zones: ['library'], top: true }] },
    { id: 'top.revealed', kind: 'can', re: /play with the top card of your library revealed/, out: () => [{ act: ['look'], zones: ['library'], top: true, all: true }] },
    { id: 'top.oneMulti', kind: 'can', re: /once during each of your turns, you may cast a spell from your hand or the top of your library without paying its mana cost/, out: () => [{ act: ['cast'], zones: ['hand', 'library'], what: 'card', top: true, free: true, limit: 'once', yourTurn: true }] },
    // exile: cards exiled "with this" (Gonti, Hostage Taker…) are marked mayPlay when exiled; this line is informational.
    { id: 'ex.withThis', kind: 'can', re: /you may (?:cast|play) (?:spells from among )?(?:the )?cards? exiled with this/, out: () => [{ act: ['cast', 'play'], zones: ['exile'], what: 'card', exiledWith: true }] },
    // flash
    { id: 'flash', kind: 'can', re: /^you may cast ([a-z ]*?)spells(?: this turn)? as though they had flash/, out: m => [{ act: ['flash'], zones: ['hand', 'graveyard', 'exile', 'library', 'command'], what: (m[1] || '').trim() || 'card' }] },
    { id: 'flash.cmdr', kind: 'can', re: /you may cast (?:your )?commanders? as though (?:it|they) had flash/, out: () => [{ act: ['flash'], zones: ['command'], what: 'card', cmdr: true }] },
    // free casting (paid elsewhere; listed so the sheet is complete)
    { id: 'free.hand', kind: 'can', re: /you may cast spells from your hand without paying their mana costs/, out: () => [{ act: ['free'], zones: ['hand'], what: 'card' }] },
    { id: 'free.type', kind: 'can', re: /^you may cast ([a-z]+) spells without paying their mana costs/, out: m => [{ act: ['free'], zones: ['hand'], what: m[1] }] },
    { id: 'land.extra', kind: 'can', re: /you may play (an|two|three) additional lands? on each of your turns/, out: m => [{ act: ['extraLand'], n: n(m[1]) }] },
    { id: 'land.extraEach', kind: 'can', re: /each player may play an additional land on each of their turns/, who: 'each', out: () => [{ act: ['extraLand'], n: 1 }] },
    // restrictions — casting
    { id: 'no.gyLib', kind: 'cant', who: 'each', re: /players can't cast spells from graveyards or libraries/, out: () => [{ act: ['cast'], zones: ['graveyard', 'library'] }] },
    { id: 'no.notHand', kind: 'cant', re: /(your opponents|players|each player|each opponent) can't cast spells from anywhere other than their hands/, whoFrom: 1, out: () => [{ act: ['cast'], zones: ['graveyard', 'library', 'exile', 'command'] }] },
    { id: 'no.oppTurn', kind: 'cant', who: 'opp', re: /your opponents can't cast spells (?:or activate abilities )?during your turn/, out: () => [{ act: ['cast'], zones: '*', srcTurn: true }] },
    { id: 'no.oppTurnAb', kind: 'cant', who: 'opp', re: /your opponents can't cast spells or activate abilities during your turn/, out: () => [{ act: ['activate'], srcTurn: true }] },
    { id: 'no.mvLow', kind: 'cant', who: 'opp', re: /your opponents can't cast spells with mana value (\w+) or less/, out: m => [{ act: ['cast'], zones: '*', mvMax: n(m[1]) }] },
    { id: 'no.mvHigh', kind: 'cant', who: 'each', re: /players can't cast spells with mana value (\w+) or greater/, out: m => [{ act: ['cast'], zones: '*', mvMin: n(m[1]) }] },
    { id: 'no.noncreature', kind: 'cant', re: /(your opponents|players|each player) can't cast noncreature spells/, whoFrom: 1, out: () => [{ act: ['cast'], zones: '*', what: 'noncreature' }] },
    { id: 'no.creature', kind: 'cant', re: /(your opponents|players|each player) can't cast creature spells/, whoFrom: 1, out: () => [{ act: ['cast'], zones: '*', what: 'creature' }] },
    { id: 'no.spells', kind: 'cant', re: /^(?:for the rest of the game, )?(you|your opponents|players|each player) can't cast spells$/, whoFrom: 1, out: () => [{ act: ['cast'], zones: '*' }] },
    { id: 'no.lands', kind: 'cant', re: /(your opponents|players|each player) can't play lands/, whoFrom: 1, out: () => [{ act: ['play'], zones: '*' }] },
    { id: 'no.one', kind: 'cant', who: 'each', re: /each player can't cast more than one spell each turn/, out: () => [{ act: ['cast'], zones: '*', perTurn: 1 }] },
    { id: 'no.oneNC', kind: 'cant', who: 'each', re: /each player can't cast more than one noncreature spell each turn/, out: () => [{ act: ['cast'], zones: '*', perTurn: 1, what: 'noncreature' }] },
    // restrictions — abilities and resources (enforced where they apply: Rules activate, gainLife, search…)
    { id: 'no.artAb', kind: 'cant', who: 'each', re: /activated abilities of artifacts(?: and creatures)? can't be activated/, out: () => [{ act: ['activate'], what: 'artifact' }] },
    { id: 'no.oppCreAb', kind: 'cant', who: 'opp', re: /activated abilities of creatures your opponents control can't be activated/, out: () => [{ act: ['activate'], what: 'creature' }] },
    { id: 'no.gain', kind: 'cant', re: /(your opponents|players) can't gain life/, whoFrom: 1, out: () => [{ act: ['gainLife'] }] },
    { id: 'no.search', kind: 'cant', re: /(your opponents|players) can't search libraries/, whoFrom: 1, out: () => [{ act: ['search'] }] },
    { id: 'no.draw2', kind: 'cant', who: 'each', re: /each player can't draw more than one card each turn/, out: () => [{ act: ['draw'], perTurn: 1 }] },
    { id: 'no.gyEnter', kind: 'cant', who: 'each', re: /creature cards in graveyards and libraries can't enter the battlefield/, out: () => [{ act: ['enter'], zones: ['graveyard', 'library'], what: 'creature' }] }
  ];
  // Temporary rules from a resolving spell or ability: the same patterns, kept in s.ruleFx with an expiry.
  const TEMP = /^(until your next turn|until end of turn|this turn|for the rest of the game),? (.+)$/;
  function tempRule(text) {
    const t = String(text || '').toLowerCase().replace(/\.$/, '').trim();
    const m = t.match(TEMP);
    if (!m) { if (/\bthis turn\b/.test(t) && PATTERNS.some(p => p.re.test(t.replace(/ this turn\b/, '')))) return { until: 'eot', line: t.replace(/ this turn\b/, '') }; return null; }
    const line = m[2];
    return PATTERNS.some(p => p.re.test(line)) ? { until: m[1] === 'until your next turn' ? 'next' : m[1] === 'for the rest of the game' ? 'game' : 'eot', line } : null;
  }

  // ---------------- reading the table ----------------
  const isLand = c => R().isType(c, 'land');
  const whoList = (s, src, w) => {
    const live = (s.seats || []).filter(p => s.players[p] && !s.players[p].lost);
    if (w === 'each') return live;
    if (w === 'opp') return live.filter(p => p !== src);
    return [src];
  };
  const whoWord = w => (/your opponents|each opponent/.test(w) ? 'opp' : /^you$/.test(w) ? 'you' : 'each');
  // One rule per sentence ("Creature cards in graveyards and libraries can't enter the battlefield. Players can't cast…").
  const lines = c => String(C().text(c) || '').toLowerCase().replace(/\([^)]*\)/g, '').split(/\n|\.\s+(?=[a-z])/).map(x => x.trim().replace(/\.$/, '')).filter(Boolean);
  let cache = { sig: null, list: null };
  function signature(s) {
    let sig = (s.turn && (s.turn.n + ':' + s.turn.active)) + '|' + (s.ruleFx || []).length + '|' + (s.devPerms || []).length + '|' + (s.devOff || []).join() + '|';
    for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && !c.faceDown) sig += c.id + c.ctrl + ((c.gained || []).length) + (c.face || 0) + ',';
    return sig;
  }
  function readLine(l, ctrl, srcId, srcName, s, extra) {
    const out = [];
    for (const p of PATTERNS) {
      const m = l.match(p.re); if (!m) continue;
      const w = p.whoFrom ? whoWord(m[p.whoFrom]) : (p.who || 'you');
      for (const e of p.out(m, l)) out.push(Object.assign({ id: p.id, kind: p.kind, who: whoList(s, ctrl, w), whoWord: w, src: srcId, srcName, srcCtrl: ctrl, text: l }, e, extra || {}));
      if (p.kind === 'can' && /^(?:gy|top)\./.test(p.id)) break;   // the first graveyard/library permission on a line is the right one
    }
    return out;
  }
  function all(s) {
    const sig = signature(s);
    if (cache.sig === sig && cache.s === s) return cache.list;
    const list = [];
    for (const c of Object.values(s.cards)) {
      if (c.zone !== 'battlefield' || c.faceDown || !c.d) continue;
      for (const l of lines(c)) {
        if (/^(when|whenever|at the beginning)\b/.test(l) || /^[^"]*\{[^}]+\}[^"]*:/.test(l) && !/^you may/.test(l)) continue;   // triggers and activated abilities aren't rules
        list.push(...readLine(l, c.ctrl, c.id, R().cardName(c), s));
      }
    }
    for (const fx of s.ruleFx || []) list.push(...readLine(fx.line, fx.by, fx.src, fx.name, s, { temp: fx.until }));
    (s.devPerms || []).forEach((d, i) => list.push(...readLine(d.line, d.pid, 'dev' + i, 'dev mode', s, { dev: i })));
    const off = new Set(s.devOff || []);
    const out = off.size ? list.filter(e => !off.has(keyOf(e))) : list;
    cache = { sig, list: out, s };
    return out;
  }
  function sheet(s, pid) {
    const L = all(s).filter(e => e.who.includes(pid));
    return { can: L.filter(e => e.kind === 'can'), cant: L.filter(e => e.kind === 'cant') };
  }

  // ---------------- does an entry cover this card? ----------------
  const mv = c => +((c.d || {}).cmc) || 0;
  function covers(e, c, zone) {
    if (e.zones && e.zones !== '*' && !e.zones.includes(zone)) return false;
    if (e.what === 'permanent') { if (!C().isPermanentCard(c)) return false; }
    else if (e.what === 'noncreature') { if (R().isType(c, 'creature')) return false; }
    else if (e.what && e.what !== 'card' && !e.what.split(/ or | and |, /).some(w => C().matchesWhat(c, w.trim()))) return false;
    if (e.mvMax != null && mv(c) > e.mvMax) return false;
    if (e.mvMin != null && mv(c) < e.mvMin) return false;
    return true;
  }
  const yourTurn = (s, pid) => s.turn && s.turn.active === pid;
  const permType = c => ['artifact', 'creature', 'enchantment', 'land', 'planeswalker', 'battle'].filter(t => R().isType(c, t));
  const useKey = e => (e.src || 'dev') + ':' + e.id;
  function keyOf(e) { return (e.src || 'dev') + ':' + e.id + ':' + (e.text || '').slice(0, 40); }
  // Lines on the battlefield that look like rules but match no pattern (dev mode: "unread rules").
  const RULEISH = /\bcan't\b|\byou may (?:cast|play)\b|as though (?:it|they) had flash|\bfrom (?:your|their|a) graveyard\b.*\bmay\b|top (?:card )?of your library any time/;
  function unread(s) {
    const out = [];
    for (const c of Object.values(s.cards)) {
      if (c.zone !== 'battlefield' || c.faceDown || !c.d) continue;
      for (const l of lines(c)) {
        if (/^(when|whenever|at the beginning)\b/.test(l) || /^[^"]*\{[^}]+\}[^"]*:/.test(l) || !RULEISH.test(l)) continue;
        if (/can't be (?:blocked|countered|the target|sacrificed|destroyed)|can't block|can't attack|doesn't untap|can't be regenerated|this spell can't/.test(l)) continue;   // handled by combat/keyword code
        if (!readLine(l, c.ctrl, c.id, '', s).length) out.push({ card: R().cardName(c), line: l });
      }
    }
    return out;
  }
  function usedUp(s, pid, e, c) {
    const U = ((s.turn && s.turn.permUse) || {})[pid] || {};
    const u = U[useKey(e)];
    if (!u) return false;
    if (e.limit === 'once') return true;
    if (e.limit === 'eachType') { const ts = isLand(c) ? ['land'] : permType(c).filter(t => t !== 'land'); return ts.every(t => u.includes(t)); }
    return false;
  }
  // The restriction that stops this player doing act with card c from zone, or null.
  function blocker(s, pid, c, act, zone) {
    const st = (s.turn && s.turn.stats) || {};
    for (const e of sheet(s, pid).cant) {
      if (!e.act.includes(act)) continue;
      if (!covers(e, c, zone)) continue;
      if (e.srcTurn && !(s.turn && s.turn.active === e.srcCtrl)) continue;
      if (e.perTurn) { const k = e.what === 'noncreature' ? (st.spellsNC || {})[pid] : (st.spells || {})[pid]; if ((k || 0) < e.perTurn) continue; }
      return e;
    }
    return null;
  }

  // ---------------- every way to cast or play this card from where it is ----------------
  // { act: 'cast'|'play', kind: 'normal' | an alternative cost kind | 'free', cost, via (permission key), label, src }
  function ways(s, pid, c, o) {
    o = o || {};
    const out = [];
    if (!c || !c.d || c.faceDown && c.zone !== 'hand') return out;
    const zone = o.zone || c.zone;
    const own = (c.owner || pid) === pid;
    const land = isLand(c);
    const add = (w) => { const b = blocker(s, pid, c, w.act, zone); if (b) { if (o.blocked) o.blocked.push(Object.assign({ by: b }, w)); return; } out.push(w); };
    const M = O() ? O().model(Object.assign({}, c, { zone })) : null;
    const mc = (R().face(c) || {}).mc || '';
    // The card's own keywords for this zone (flashback, escape, foretell, plot, warp…).
    const selfCosts = M ? M.costs.filter(k => !k.ability && !k.faceDown && k.kind !== 'normal' && (k.zone === zone)) : [];
    if (zone === 'hand') {
      if (land) add({ act: 'play', kind: 'normal', label: 'Play land' });
      else { add({ act: 'cast', kind: 'normal', cost: mc, label: 'Cast' }); for (const k of selfCosts) add({ act: 'cast', kind: k.kind, cost: k.cost, alt: k, label: k.kind }); }
      return out;
    }
    if (zone === 'command') {
      if (c.cmdr && own && !land) add({ act: 'cast', kind: 'normal', cost: mc, label: 'Cast (commander tax)', via: 'cmdr' });
      return out;
    }
    if (zone === 'battlefield' || zone === 'stack') return out;
    // Graveyard / exile / library: only with a permission.
    if (zone === 'exile') {
      if (c.mayPlay && c.mayPlay.by === pid) add({ act: land ? 'play' : 'cast', kind: 'normal', cost: mc, via: 'mayPlay', label: land ? 'Play it' : 'Cast it from exile', src: c.mayPlay.src });
      if (c.warpedOut && own && !land) add({ act: 'cast', kind: 'normal', cost: mc, via: 'warp', label: 'Cast it from exile (warp)' });
      if (c.exPerm && c.exPerm.by === pid) for (const k of selfCosts.filter(k => k.kind === c.exPerm.kind)) add({ act: 'cast', kind: k.kind, cost: k.cost, alt: k, via: 'self', label: k.kind });
    }
    if (zone === 'graveyard' && own) for (const k of selfCosts) if (!(k.kind === 'disturb' && land)) add({ act: 'cast', kind: k.kind, cost: k.cost, alt: k, via: 'self', label: k.kind });
    if (zone === 'graveyard' && own && /aftermath/i.test(C().rawText(c))) add({ act: 'cast', kind: 'normal', cost: mc, via: 'self', label: 'Cast (aftermath)' });
    // Player permissions (Muldrotha, Karador, Courser, Vizier…).
    for (const e of sheet(s, pid).can) {
      const acts = e.act.filter(a => a === 'cast' || a === 'play');
      if (!acts.length) continue;
      if (!e.zones || !e.zones.includes(zone)) continue;
      if (zone === 'library' && e.top && !o.top) continue;
      if (e.others ? own : !own) continue;
      if (e.self && e.src !== c.id) continue;
      if (e.yourTurn && !yourTurn(s, pid)) continue;
      if (e.cond && O() && O().conditionHolds(s, Object.assign({}, c, { ctrl: pid }), e.cond) === false) continue;
      if (e.what === 'permanent' && !C().isPermanentCard(c)) continue;
      if (!covers(e, c, zone)) continue;
      if (usedUp(s, pid, e, c)) continue;
      const act = land ? 'play' : 'cast';
      if (!acts.includes(act)) continue;
      add({ act, kind: e.free ? 'free' : 'normal', cost: e.free ? '' : mc, via: 'perm:' + useKey(e), label: `${land ? 'Play' : 'Cast'} it (${e.srcName})`, src: e.src, perm: e });
    }
    return out;
  }
  function pickFrom(w, a, act) {
    return a.perm ? w.find(x => x.via === a.perm) : w.find(x => (a.alt && a.alt !== 'normal' ? x.kind === a.alt : (x.kind === 'normal' || x.kind === 'free'))) || w.find(x => x.act === act && !a.alt);
  }
  // Called by Rules when a card is cast or played from a zone: null if allowed, else the reason. When it's allowed and
  // no permission was named, the one that applies is written into a.perm (so once-a-turn permissions get used up).
  function castBlock(s, pid, c, a) {
    a = a || {};
    const zone = a.fromZone || c.zone;
    const act = isLand(c) ? 'play' : 'cast';
    if (a.alt === 'free' || a.effect) { const b = blocker(s, pid, c, act, zone); return b ? `${b.srcName}: ${b.text}` : null; }   // an effect is casting it (cascade, rebound, "you may cast it without paying") — only restrictions apply
    const blocked = [];
    const w = ways(s, pid, c, { zone, top: a.top, blocked });
    const want = pickFrom(w, a, act);
    if (want) { if (!a.perm && want.via && typeof a === 'object') a.perm = want.via; return null; }
    if (blocked.length) return `${blocked[0].by.srcName}: “${blocked[0].by.text}”.`;
    if (zone === 'graveyard') return `You can’t ${act} ${R().cardName(c)} from a graveyard — nothing lets you right now (601.3).`;
    if (zone === 'exile') return `You can’t ${act} ${R().cardName(c)} from exile — nothing lets you right now (601.3).`;
    if (zone === 'library') return `You can’t ${act} cards from your library — nothing lets you right now (601.3).`;
    if (zone === 'battlefield' || zone === 'stack') return `${R().cardName(c)} is already on the ${zone}.`;
    return null;
  }
  // The permission that was used, so once-a-turn ones are spent (Karador, Lurrus, Muldrotha's one of each type).
  function use(s, pid, via, c) {
    if (!via || !/^perm:/.test(via) || !s.turn) return;
    const e = all(s).find(x => 'perm:' + useKey(x) === via); if (!e || !e.limit) return;
    const T = s.turn; T.permUse = T.permUse || {}; const U = T.permUse[pid] = T.permUse[pid] || {};
    const k = useKey(e);
    U[k] = (U[k] || []).concat(e.limit === 'eachType' ? (isLand(c) ? ['land'] : permType(c).filter(t => t !== 'land').slice(0, 1)) : ['used']);
  }
  function flash(s, pid, c) {
    const zone = c.zone || 'hand';
    for (const e of sheet(s, pid).can) if (e.act.includes('flash') && covers(e, c, zone) && (!e.cmdr || c.cmdr)) return e;
    return null;
  }
  // Library top: may this player look at their top card / is it revealed to everyone?
  function topView(s, pid) {
    const c = sheet(s, pid).can;
    return { look: c.some(e => e.act.includes('look') || (e.zones || []).includes('library') && e.top), all: c.some(e => e.act.includes('look') && e.all), play: c.filter(e => (e.zones || []).includes('library') && e.top && e.act.some(a => a === 'cast' || a === 'play')) };
  }
  // Is an act stopped for this player (gain life, search, draw…)? Returns the restriction or null.
  function cant(s, pid, act, c) {
    for (const e of sheet(s, pid).cant) { if (!e.act.includes(act)) continue; if (c && e.what && !C().matchesWhat(c, e.what)) continue; if (e.srcTurn && !(s.turn && s.turn.active === e.srcCtrl)) continue; return e; }
    return null;
  }
  // Dev mode: what this card can do and what stops it.
  function why(s, pid, c) {
    const blocked = [];
    const w = ways(s, pid, c, { blocked, top: c.zone === 'library' });
    const rows = w.map(x => ({ ok: true, act: x.act, how: x.label + (x.kind && x.kind !== 'normal' ? ' [' + x.kind + ']' : ''), by: x.via || 'default rules' }));
    for (const b of blocked) rows.push({ ok: false, act: b.act, how: b.label, by: `${b.by.srcName}: ${b.by.text}` });
    if (!w.length && !blocked.length && ['graveyard', 'exile', 'library'].includes(c.zone)) rows.push({ ok: false, act: isLand(c) ? 'play' : 'cast', how: 'from ' + c.zone, by: 'default rule ' + (DEFAULTS.find(d => d.id === 'cast.' + (c.zone === 'graveyard' ? 'gy' : c.zone)) || {}).rule });
    return rows;
  }
  function expire(s, when, pid) {
    // 'eot' at cleanup; 'next' at the start of the controller's next turn.
    s.ruleFx = (s.ruleFx || []).filter(f => !(when === 'eot' && f.until === 'eot') && !(when === 'turn' && f.until === 'next' && f.by === pid));
  }

  root.Rulebook = { DEFAULTS, PATTERNS, sheet, ways, castBlock, use, flash, topView, cant, why, tempRule, expire, blocker, all, readLine, keyOf, unread };
})(typeof window !== 'undefined' ? window : globalThis);
