// Kitchen Table — shared game state and rules.
// Runs on whichever browser is hosting the table. Every change to the public game goes through
// apply(state, playerId, action), which checks that the player is allowed to do it
// (you act only on cards you own or control) and applies the Magic rules for moving cards.
(function (root) {
  'use strict';

  const PHASES = ['Untap', 'Upkeep', 'Draw', 'Main 1', 'Beginning of combat', 'Declare attackers',
    'Declare blockers', 'Combat damage', 'End of combat', 'Main 2', 'End step', 'Cleanup'];
  const PUBLIC_ZONES = ['battlefield', 'stack', 'graveyard', 'exile', 'command'];
  const ROWS = ['lands', 'other', 'creatures'];
  // Rule 122.1b keyword counters, plus the common ones.
  const KEYWORD_COUNTERS = ['flying', 'first strike', 'double strike', 'deathtouch', 'decayed', 'exalted', 'haste',
    'hexproof', 'indestructible', 'lifelink', 'menace', 'reach', 'shadow', 'trample', 'vigilance'];
  const SUGGESTED_COUNTERS = ['+1/+1', '-1/-1', 'loyalty', 'defense'].concat(KEYWORD_COUNTERS);
  const MAX_SEATS = 6;
  const START_LIFE = 40;

  function rid(n) { let s = ''; const c = 'abcdefghijkmnpqrstuvwxyz23456789'; for (let i = 0; i < (n || 8); i++) s += c[Math.floor(Math.random() * c.length)]; return s; }

  function newState() {
    return {
      v: 1, rev: 0, gameId: rid(6), seq: 1,
      seats: [], players: {}, cards: {}, inbox: {}, tax: {},
      turn: { active: null, phase: 0, n: 0, first: null },
      table: { monarch: null, initiative: null, day: null },
      log: []
    };
  }

  function newPlayer(name) {
    return {
      name: cleanName(name), life: START_LIFE, poison: 0, energy: 0, exp: 0, cmdDmg: {},
      handCount: 0, libCount: 0, revealed: [], deckName: '', online: true, phone: false, sleeveRev: 0,
      alerts: {}
    };
  }

  function cleanName(n) { return String(n || 'Player').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player'; }
  function nameOf(s, pid) { return (s.players[pid] && s.players[pid].name) || 'Someone'; }

  // ---------- card data helpers ----------
  function face(c) { return c && c.d && c.d.faces ? (c.d.faces[c.face || 0] || c.d.faces[0]) : null; }
  function cardName(c) {
    if (!c) return 'a card';
    if (c.faceDown || !c.d) return 'a face-down card';
    const f = face(c); return (f && f.n) || c.d.n || 'a card';
  }
  function typeLine(c) { const f = face(c); return (f && f.t) || ''; }
  function isType(c, word) { return root.Cards ? root.Cards.isType(c, word) : new RegExp('\\b' + word + '\\b', 'i').test(typeLine(c)); }
  function rowFor(c) {
    if (c.faceDown) return 'creatures';          // face-down permanents are 2/2 creatures (708.2a)
    if (isType(c, 'creature')) return 'creatures';
    if (isType(c, 'land')) return 'lands';
    return 'other';
  }
  function cleanD(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.faces)) return null;
    const str = (v, n) => typeof v === 'string' ? v.slice(0, n || 300) : '';
    return {
      n: str(d.n, 150), sid: str(d.sid, 60), cmc: +d.cmc || 0,
      fin: d.fin === 'foil' || d.fin === 'etched' ? d.fin : '',
      faces: d.faces.slice(0, 2).map(f => ({
        n: str(f.n, 150), t: str(f.t, 150), img: /^https:\/\/[^"'<>\s]+$/.test(f.img || '') ? f.img : '',
        p: str(f.p, 8), tg: str(f.tg, 8), loy: str(f.loy, 8), def: str(f.def, 8), mc: str(f.mc, 60), o: str(f.o, 1500)
      })),
      kw: Array.isArray(d.kw) ? d.kw.slice(0, 16).map(k => str(k, 30)) : undefined,
      col: Array.isArray(d.col) ? d.col.filter(x => /^[WUBRG]$/.test(x)).slice(0, 5) : undefined,
      pm: Array.isArray(d.pm) ? d.pm.filter(x => /^[WUBRGC]$/.test(x)).slice(0, 6) : undefined
    };
  }
  function cleanIncoming(c, pid) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') return null;
    return {
      id: c.id.slice(0, 40), owner: pid, ctrl: pid, d: c.faceDown ? null : cleanD(c.d),
      face: c.face ? 1 : 0, faceDown: !!c.faceDown, token: !!c.token, cmdr: !!c.cmdr,
      tapped: false, counters: {}, mod: null, attachedTo: null, row: null, zone: null, seq: 0
    };
  }

  function log(s, pid, text, kind) {
    s.log.push({ t: Date.now(), pid: pid || null, text: String(text).slice(0, 300), k: kind || '' });
    if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
  }

  // A player finishing an effect by hand ("Exile a creature… target opponent controls") may move other players' cards meanwhile.
  function finishing(s, pid) { return (s.ask || []).some(a => a.kind === 'manual' && a.pid === pid); }
  function canAct(s, pid, c) {
    if (!c) return false;
    if (c.zone === 'battlefield' || c.zone === 'stack') return c.ctrl === pid;
    return c.owner === pid;
  }

  function zoneCards(s, zone, pid, by) {
    by = by || (zone === 'battlefield' || zone === 'stack' ? 'ctrl' : 'owner');
    return Object.values(s.cards).filter(c => c.zone === zone && (!pid || c[by] === pid)).sort((a, b) => a.seq - b.seq);
  }

  function enterBattlefield(s, c) {
    c.tapped = c.tapped || false;
    c.row = rowFor(c);
    c.ctlT = s.turn ? s.turn.n : 0; c.dmg = 0;
    const f = face(c);
    // 306.5b / 310.4b: planeswalkers and battles enter with their printed loyalty / defense.
    if (f && !c.faceDown) {
      if (isType(c, 'planeswalker') && /^\d+$/.test(f.loy) && +f.loy > 0) { c.counters.loyalty = +f.loy; c.loySeen = true; }
      if (isType(c, 'battle') && /^\d+$/.test(f.def) && +f.def > 0) { c.counters.defense = +f.def; c.defSeen = true; }
    }
  }

  // A card that leaves the battlefield becomes a new object (400.7): counters, tapped status,
  // modifiers and attachments go away, and it returns to its owner's control.
  function leaveBattlefield(s, c, notes) {
    c.loySeen = false; c.defSeen = false; c.noUntap = false; c.skipUntap = false; c.via = null; c.gained = null; c.zeroT = false; c.zeroOk = false;
    c.counters = {}; c.tapped = false; c.mod = null; c.attachedTo = null; c.ctrl = c.owner; c.row = null;
    c.dmg = 0; c.dtd = false; c.grant = null; c.ctlT = null; c.alt = null; c.eot = null; c.chosen = null; c.animated = null; c.animPT = null; c.regen = 0; if (c.origD) { c.d = c.origD; c.origD = null; c.copyOf = null; }
    if (s.combat && s.combat.att) { delete s.combat.att[c.id]; for (const a of Object.values(s.combat.att)) a.blk = (a.blk || []).filter(x => x !== c.id); }
    for (const o of Object.values(s.cards)) {
      if (o.attachedTo === c.id) {
        o.attachedTo = null;
        // 704.5m: an Aura attached to nothing goes to its owner's graveyard. Equipment just stays (704.5n).
        if (o.zone === 'battlefield' && isType(o, 'aura')) {
          moveOne(s, o, 'graveyard', 'top', null, notes);
          notes.push(`${cardName(o)} went to the graveyard (it was attached to ${cardName(c)})`);
        }
      }
    }
  }

  // ======================= the movement checkpoint =======================
  // Every card that changes zones passes through here (400.7): replacement effects (616) decide where it really goes,
  // then triggers see the move, then the card lands. Tokens linger a moment in their new zone before they cease to
  // exist (111.7); commanders may go to the command zone instead (903.9).
  function moveOne(s, c, to, pos, opts, notes) {
    opts = opts || {};
    notes = notes || [];
    const from = c.zone;
    if (from === 'ghost') return;   // 111.8: a token that left the battlefield can't move again
    // 702.34a and friends: a spell cast with flashback (jump-start, escape, harmonize) is exiled instead of going anywhere else.
    if (from === 'stack' && to !== 'battlefield' && to !== 'stack' && ['flashback', 'jump-start', 'harmonize'].includes(c.alt)) to = 'exile';
    // Rebound (702.88): cast from hand, it's exiled as it resolves; its owner may cast it free at their next upkeep.
    if (from === 'stack' && to === 'graveyard' && c.castFrom === 'hand' && !c.ab && !c.token && root.Cards && root.Cards.keywords && /(^|\n)rebound\b/i.test(root.Cards.rawText(c))) { to = 'exile'; c.rebound = { by: c.owner, after: s.turn ? s.turn.n : 0 }; }
    if (from === 'stack' && to !== 'battlefield' && c.alt === 'escape' && !isType(c, 'creature') && !isType(c, 'artifact') && !isType(c, 'enchantment') && !isType(c, 'planeswalker')) to = 'exile';
    // Unearth (702.84a): "if it would leave the battlefield, exile it instead of putting it anywhere else".
    if (from === 'battlefield' && to !== 'battlefield' && to !== 'exile' && c.unearthed) to = 'exile';
    // Replacement effects from permanents and the card's own counters (Rest in Peace, Leyline of the Void, finality…).
    if (root.Rulebook && from !== to) { const r = root.Rulebook.replaceMove(s, c, from, to); if (r.why && r.to !== to) { notes.push(`${cardName(c)} went to ${ZONE_WORDS[r.to] || r.to} instead of ${ZONE_WORDS[to] || to} (${r.why})`); to = r.to; } }
    // 903.9b: a commander that would go to a hand or library may go to the command zone instead. The AI always sends
    // it home; a person is asked (it waits in the command zone meanwhile).
    let cmdrAsk = null;
    if (c.cmdr && (to === 'hand' || to === 'library') && from !== 'command' && !opts.cmdrOk && !c.token) {
      if (!cmdrHuman(s, c.owner)) { notes.push(`${cardName(c)} went to the command zone instead of ${c.owner === c.ctrl ? 'its owner’s ' : ''}${to} (903.9b)`); to = 'command'; }
      else { cmdrAsk = { zone: to, pos: pos || 'top' }; to = 'command'; }
    }
    if (root.Engine && from !== to) root.Engine.emit({ type: 'zone', from, to, card: root.Engine.snap(c), sac: !!opts.sac, fromPriv: opts.fromPriv || null });
    // A merged (mutated) permanent that leaves takes every card in it along (702.140e / 721.? — each card goes to the same zone).
    if (from === 'battlefield' && to !== 'battlefield' && c.mut) {
      const comps = c.mut.filter(k => k.id !== c.id).map(k => s.cards[k.id]).filter(x => x && x.zone === 'merged');
      c.d = c.mutBase || c.d; c.mut = null; c.mutBase = null; c.mutCmdr = null; c.mutNames = null;
      for (const k of comps) { k.mergedInto = null; moveOne(s, k, to, pos, null, notes); }
    }
    if (from === 'battlefield' && to !== 'battlefield') leaveBattlefield(s, c, notes);

    // 111.7 / 111.8: a token that leaves the battlefield goes to its new zone for a moment (so "dies" and "leaves"
    // abilities see it), then ceases to exist the next time state-based actions are checked.
    if (c.token && from === 'battlefield' && to !== 'battlefield') {
      if (to === 'graveyard' || to === 'exile' || to === 'command') {
        c.zone = 'ghost'; c.ghostZone = to; c.ghostAt = Date.now(); c.ctrl = c.owner; c.tapped = false; c.attachedTo = null; c.seq = ++s.seq;
        notes.push(`${cardName(c)} token went to ${ZONE_WORDS[to]} and ceases to exist (111.7)`);
        return;
      }
      delete s.cards[c.id];
      notes.push(`${cardName(c)} token left the battlefield and ceased to exist`);
      return;
    }

    // Commander tax (903.8): only casting it from the command zone counts (putting it onto the battlefield doesn't).
    if (from === 'command' && to === 'stack' && c.cmdr) s.tax[c.id] = (s.tax[c.id] || 0) + 1;

    // 712.8a: outside the battlefield and stack, a double-faced card has only its front face.
    if (to !== 'battlefield' && to !== 'stack') c.face = 0;
    else if (from !== to && from !== 'limbo') c.face = opts.backFace ? 1 : 0;   // enters front face up unless told otherwise
    // Counters on an exiled card (suspend, etc.) go away when it leaves exile.
    if (from === 'exile' && to !== 'exile') c.counters = {};

    // 708.9 / 406.3: a face-down card stays face down only on the battlefield, or when it's exiled or cast face down on purpose.
    const keepDown = to === 'battlefield' ? (from === 'battlefield' ? c.faceDown : !!opts.faceDown)
      : (to === 'exile' || to === 'stack') ? !!opts.faceDown : false;
    if (c.faceDown && !keepDown && from !== 'limbo') { c.faceDown = false; if (!c.d) c.needsId = true; } // the owner's device fills in the name

    if (to === 'hand' || to === 'library') {
      delete s.cards[c.id];
      if (c.token) { notes.push(`${cardName(c)} token ceased to exist`); return; }
      (s.inbox[c.owner] = s.inbox[c.owner] || []).push({
        card: { id: c.id, owner: c.owner, d: c.d, face: 0, cmdr: c.cmdr, faceDown: false },
        to, pos: pos || 'top'
      });
      return;
    }

    c.zone = to;
    if (to !== 'battlefield' && to !== 'stack') c.ctrl = c.owner; // other zones belong to the owner (400.3)
    if (to === 'stack' && opts.by && from !== 'stack') c.ctrl = opts.by; // whoever casts it controls the spell (110.2)
    if (to === 'battlefield' && from !== 'battlefield') {
      c.wasCast = from === 'stack';
      if (from === 'stack' && c.suspendCast) { c.counters = c.counters || {}; c.counters.haste = 1; c.suspendCast = false; }   // 702.62a: a creature cast this way has haste
      if (opts.by) c.ctrl = opts.by; // whoever puts it onto the battlefield controls it (110.2a)
      c.tapped = !!opts.tapped || entersTapped(c, s);
      c.faceDown = keepDown;
      if (from === 'limbo' && opts.backFace) c.face = 1;
      enterBattlefield(s, c);
      enterCounters(s, c, notes);
    }
    if ((to === 'exile' || to === 'stack') && keepDown && !c.faceDown) { c.faceDown = true; c.d = null; }
    if (opts.row && ROWS.includes(opts.row) && to === 'battlefield') c.row = opts.row;
    if (from === 'stack' && to !== 'battlefield') c.alt = null;
    if (pos === 'bottom') {
      const min = Math.min(0, ...zoneCards(s, to, c.owner, 'owner').map(x => x.seq));
      c.seq = min - 1;
    } else c.seq = ++s.seq;
    // 903.9a: a commander put into a graveyard or exile may go to the command zone (a state-based choice).
    if (c.cmdr && (to === 'graveyard' || to === 'exile') && from !== 'command' && !opts.cmdrOk) {
      if (!cmdrHuman(s, c.owner)) { moveOne(s, c, 'command', 'top', { cmdrOk: true }, notes); notes.push(`${cardName(c)} returned to the command zone (903.9a)`); }
      else cmdrAsk = { zone: to, done: true };
    }
    if (cmdrAsk) s.ask = (s.ask || []).filter(a => !(a.kind === 'cmdrZone' && a.card === c.id)).concat([{ id: 'a' + (++s.seq), kind: 'cmdrZone', pid: c.owner, card: c.id, name: cardName(c), zone: cmdrAsk.zone, pos: cmdrAsk.pos, inZone: !!cmdrAsk.done, since: Date.now() }]);
  }
  // A person (not an AI seat, and at the table) makes their own commander choices.
  function cmdrHuman(s, pid) { const P = s.players[pid]; return !!(P && !P.ai && live(s, pid)); }
  // Shield counters (122.1c): "If it would be dealt damage or destroyed, instead remove a shield counter from it."
  function shielded(s, c, notes, what) {
    if (!c || !c.counters || !(c.counters.shield > 0)) return false;
    c.counters.shield--; if (!c.counters.shield) delete c.counters.shield;
    if (notes) notes.push(`${cardName(c)} lost a shield counter instead of ${what === 'damage' ? 'being dealt damage' : 'being destroyed'} (122.1c)`);
    return true;
  }

  // Gaining life, with replacement effects (616): "you gain that much life plus 1 instead" (Angel of Vitality),
  // "twice that much" (Boon Reflection, Rhox Faithmender), and "your opponents can't gain life" (Erebos).
  function gainLife(s, pid, n) {
    const P = s.players[pid]; if (!P || n <= 0) return 0;
    if (s.turn && s.turn.noGain && s.turn.noGain.n === s.turn.n && s.turn.noGain.by !== pid) return 0;   // Atarka's Command
    const C = root.Cards;
    let plus = 0, mult = 1;
    if (C) for (const o of Object.values(s.cards)) {
      if (o.zone !== 'battlefield' || o.faceDown || !o.d) continue;
      const t = C.text(o).toLowerCase();
      if (o.ctrl !== pid && /your opponents can't gain life/.test(t)) return 0;
      if (o.ctrl === pid && /players? can't gain life|you can't gain life/.test(t) && !/opponents/.test(t)) return 0;
      if (o.ctrl !== pid) continue;
      let m = t.match(/if you would gain life, you gain that much life plus (\d+|one|two) instead/);
      if (m) plus += /^\d+$/.test(m[1]) ? +m[1] : m[1] === 'two' ? 2 : 1;
      if (/if you would gain life, you gain twice that much life instead/.test(t)) mult *= 2;
    }
    const got = (n + plus) * mult;
    P.life += got;
    return got;
  }
  // 614.1c: "Each other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control"
  // (Giada), "Each other creature you control enters with an additional +1/+1 counter on it" (and similar).
  function enterCounters(s, c, notes) {
    const C = root.Cards; if (!C || c.faceDown || !(isType(c, 'creature'))) return;
    let add = 0;
    for (const o of Object.values(s.cards)) {
      if (o.zone !== 'battlefield' || o.faceDown || o.id === c.id || o.ctrl !== c.ctrl || !o.d) continue;
      const t = C.text(o).toLowerCase();
      const m = t.match(/each other ([a-z ]+?) you control enters(?: the battlefield)? with (an|one|two|three) additional \+1\/\+1 counters? on it(?: for each ([a-z ]+?) you already control)?/);
      if (!m) continue;
      const what = m[1].replace(/ies$/, 'y').replace(/s$/, '');
      if (what !== 'creature' && !C.matchesWhat(c, what)) continue;
      const per = { an: 1, one: 1, two: 2, three: 3 }[m[2]] || 1;
      if (m[3]) { const w2 = m[3].replace(/ies$/, 'y').replace(/s$/, ''); add += per * Object.values(s.cards).filter(x => x.zone === 'battlefield' && x.ctrl === c.ctrl && x.id !== c.id && (w2 === 'creature' ? isType(x, 'creature') : C.matchesWhat(x, w2))).length; }
      else add += per;
    }
    if (add > 0) { c.counters['+1/+1'] = (c.counters['+1/+1'] || 0) + add; if (notes) notes.push(`${cardName(c)} entered with ${add} additional +1/+1 counter${add > 1 ? 's' : ''}`); }
  }
  // "This land enters tapped." (an unconditional line on the card) — 614.1c / 305.7
  function entersTapped(c, s) {
    if (c.faceDown || !root.Cards) return false;
    // "Artifacts and creatures your opponents control enter tapped." (614.1d) on someone else's permanent.
    if (s) for (const o of Object.values(s.cards)) {
      if (o.zone !== 'battlefield' || o.faceDown || !o.d || o.ctrl === c.ctrl) continue;
      const m = root.Cards.text(o).match(/(?:^|\n|\. )((?:[a-z]+(?:, | and | or ))*[a-z]+) your opponents control enter(?: the battlefield)? tapped/i);
      if (m && m[1].toLowerCase().split(/,\s*(?:and |or )?|\s+and\s+|\s+or\s+/).some(w => w && (w.replace(/s$/, '') === 'permanent' || root.Cards.isType(c, w.replace(/s$/, '')) || root.Cards.matchesWhat(Object.assign({}, c, { zone: 'battlefield' }), w.replace(/s$/, ''))))) return true;
    }
    const t = root.Cards.text(c);
    if (t.split(/\n|\.\s+/).some(l => /^(this|this (land|creature|artifact|permanent)) enters(?: the battlefield)? tapped\.?$/i.test(l.trim()))) return true;
    // Conditional enters-tapped lands (305.7): "…enters tapped unless you control a Mountain or a Forest" and friends.
    const m = t.match(/this (?:land )?enters(?: the battlefield)? tapped unless ([^.\n]+)/i);
    if (!m || !s) return false;
    const u = m[1].toLowerCase().trim(), who = c.ctrl;
    const mine = Object.values(s.cards).filter(o => o.zone === 'battlefield' && o.ctrl === who && o.id !== c.id);
    const lands = mine.filter(o => isType(o, 'land'));
    let k;
    if (/^you have two or more opponents/.test(u)) return s.seats.filter(p => p !== who && alive(s, p)).length < 2;
    if ((k = u.match(/^you control two or fewer other lands/))) return lands.length > 2;
    if ((k = u.match(/^you control two or more other lands/))) return lands.length < 2;
    if ((k = u.match(/^you control (?:an? )?([a-z]+)(?: or (?:an? )?([a-z]+))?$/))) return !lands.concat(mine).some(o => [k[1], k[2]].filter(Boolean).some(w => isType(o, w)));
    if ((k = u.match(/^you control two or more basic lands/))) return lands.filter(o => isType(o, 'basic')).length < 2;
    if (/^a player has 13 or less life/.test(u)) return !s.seats.some(p => s.players[p] && s.players[p].life <= 13);
    if ((k = u.match(/^you control a legendary (creature|permanent)/))) return !mine.some(o => isType(o, 'legendary') && (k[1] === 'permanent' || isType(o, 'creature')));
    return false;
  }
  const ZONE_WORDS = { battlefield: 'the battlefield', stack: 'the stack', graveyard: 'the graveyard', exile: 'exile', command: 'the command zone', hand: 'hand', library: 'library' };

  function num(v, lo, hi) { v = Math.round(+v); if (!isFinite(v)) return null; return Math.max(lo, Math.min(hi, v)); }

  function alertChecks(s, pid) {
    const p = s.players[pid]; if (!p) return;
    const was = p.alerts || {};
    const now = { dead: p.life <= 0, poison: p.poison >= 10 };
    for (const [k, v] of Object.entries(p.cmdDmg || {})) if (v >= 21) now['cmd:' + k] = true;
    if (now.dead && !was.dead) log(s, pid, 'is at ' + p.life + ' life', 'alert');
    if (now.poison && !was.poison) log(s, pid, 'has ' + p.poison + ' poison counters', 'alert');
    for (const k of Object.keys(now)) if (k.startsWith('cmd:') && !was[k]) {
      const cid = k.slice(4); const c = s.cards[cid] || null;
      log(s, pid, `has taken ${p.cmdDmg[cid]} commander damage from ${c ? cardName(c) : 'a commander'}`, 'alert');
    }
    p.alerts = now;
  }

  // ======================= apply an action =======================
  // Dev-mode rewind: the host keeps the last 20 public states of each game (in memory only).
  const HIST = new Map(), NO_HIST = new Set(['counts', 'log', 'reveal', 'inboxAck', 'todoAck', 'aiAsk', 'aiSay', 'dev', 'devRewind', 'deck', 'player', 'join', 'chat', 'ping']);
  function remember(s, a) {
    if (!a || NO_HIST.has(a.type) || !s.gameId || !s.turn || !s.turn.active) return;
    let H = HIST.get(s.gameId); if (!H) { H = []; HIST.set(s.gameId, H); if (HIST.size > 3) HIST.delete(HIST.keys().next().value); }
    try { const copy = Object.assign({}, s, { log: [] }); H.push(JSON.stringify(copy)); } catch (e) { return; }
    if (H.length > 20) H.shift();
  }
  function apply(s, pid, a) {
    if (root.Cards && root.Cards.setState) root.Cards.setState(s);
    remember(s, a);
    const before = s.turn ? s.turn.n + ':' + s.turn.phase : '';
    if (root.Engine) root.Engine.begin(s);
    const r = apply0(s, pid, a);
    if (r && r.ok && !r.dup && root.Engine && s.turn && s.turn.active) {
      const notes = [];
      try { root.Engine.after(s, notes); } catch (e) { notes.push('Rules engine problem: ' + (e && e.message)); if (typeof console !== 'undefined') console.error(e); }
      for (const n of notes) log(s, null, n, 'auto');
      sba(s, []);
      s.rev++;
    } else if (root.Engine && !(r && r.ok)) root.Engine._ev().length = 0;
    if (r && r.ok && s.turn && before !== s.turn.n + ':' + s.turn.phase) emptyPools(s);
    return r;
  }
  // ---- mana pool: tapping a mana source by hand adds its mana; casting spends it; it empties between steps (106.4, 500.4) ----
  function emptyPools(s) { for (const p of Object.values(s.players || {})) if (p.pool && p.pool.length) p.pool = []; }
  function addPool(s, pid, units) { const p = s.players[pid]; if (!p || !units.length) return; p.pool = (p.pool || []).concat(units).slice(0, 60); }
  function unitsOf(c) {
    const m = root.Cards && root.Cards.manaSource(c); if (!m || m.sac) return [];
    return Array.from({ length: m.amount }, (_, i) => (m.units ? m.units[i] : null) || m.colors);
  }
  // Spend from the pool: chosen units if the client says which (fromPool), otherwise the best fit for the cost.
  function spendPool(s, pid, cost, x, fromPool) {
    const p = s.players[pid]; if (!p || !p.pool || !p.pool.length || !cost) return;
    if (Array.isArray(fromPool)) { const drop = new Set(fromPool.map(n => n | 0)); p.pool = p.pool.filter((u, i) => !drop.has(i)); return; }
    const pool = p.pool.slice(), used = new Array(pool.length).fill(false);
    const take = ok => { let best = -1; for (let i = 0; i < pool.length; i++) if (!used[i] && ok(pool[i]) && (best < 0 || pool[i].length < pool[best].length)) best = i; if (best >= 0) used[best] = true; return best >= 0; };
    for (const col of ['W', 'U', 'B', 'R', 'G', 'C']) for (let i = 0; i < (cost[col] || 0); i++) take(u => u.includes(col));
    for (const col of cost.ph || []) take(u => u.includes(col));
    for (const [a1, b1] of cost.hy || []) if (!take(u => u.includes(a1) || u.includes(b1)) && a1 === '2') { take(() => true); take(() => true); }
    let g = (cost.g || 0) + (cost.x || 0) * (x || 0);
    while (g-- > 0 && take(() => true)) {}
    p.pool = pool.filter((u, i) => !used[i]);
  }
  function apply0(s, pid, a) {
    if (!a || typeof a !== 'object') return { ok: false, err: 'bad action' };
    // Developer debugging (host only): the host may act as any player to repair the game.
    if (a.type === 'dev') {
      if (pid !== s.hostPid) return { ok: false, err: 'Only the host can turn on developer debugging.' };
      s.dev = !!a.on; log(s, pid, s.dev ? 'turned ON developer debugging — the host can move and use everyone’s cards' : 'turned off developer debugging', 'alert'); s.rev++; return { ok: true };
    }
    {
      const hostDev = !!(s.dev && pid === s.hostPid);
      if (a.as && hostDev && s.players[a.as]) { const as = a.as; a = Object.assign({}, a, { as: undefined, dev: true }); pid = as; }
      else if (a.dev && !hostDev) a = Object.assign({}, a, { dev: false });
    }
    const me = s.players[pid];
    const need = () => { if (!me) throw new Error('Take a seat first.'); };
    const notes = [];
    // An action resent after a slow or lost reply must not happen twice.
    const aid = typeof a.aid === 'string' ? a.aid.slice(0, 40) : null;
    if (aid && s.done && s.done[pid] && s.done[pid].includes(aid)) return { ok: true, dup: true };
    const remember = () => { if (!aid) return; s.done = s.done || {}; const l = s.done[pid] = s.done[pid] || []; l.push(aid); if (l.length > 60) l.splice(0, l.length - 60); };
    const done = msg => { remember(); if (msg) log(s, pid, msg); sba(s, notes); fixUp(s, notes); for (const n of notes) log(s, pid, n, 'auto'); s.rev++; return { ok: true }; };
    try {
      switch (a.type) {
        case 'join': {
          if (!me) {
            if (s.kicked && s.kicked[pid]) return { ok: false, err: 'The host removed you from this table.', kicked: true };
            // Once the game has started nobody new sits down (players who were seated can always come back).
            if (s.turn && s.turn.active && !s.winner) return { ok: false, err: 'This game has already started — you can watch, and join when the next game starts.', started: true };
            if (s.seats.length >= MAX_SEATS) return { ok: false, err: 'The table is full (6 players).' };
            if (!s.hostPid || !s.players[s.hostPid]) s.hostPid = s.seats.find(p => s.players[p] && !s.players[p].ai) || (a.ai ? null : pid);
            s.players[pid] = newPlayer(a.name);
            if (a.ai && typeof a.ai === 'object') s.players[pid].ai = { skill: ['easy', 'normal', 'hard'].includes(a.ai.skill) ? a.ai.skill : 'normal', by: String(a.ai.by || '').slice(0, 40), v: a.ai.v === 2 ? 2 : 1 };
            s.seats.push(pid);
            return done(s.players[pid].ai ? `(an AI player, ${s.players[pid].ai.skill}) sat down at the table` : 'sat down at the table');
          }
          const old = me.name; me.name = cleanName(a.name);
          return done(old !== me.name ? `changed their name from ${old}` : '');
        }
        case 'leave': {
          need();
          const idx = s.seats.indexOf(pid);
          const nextSeat = s.seats.length > 1 ? s.seats[(idx + 1) % s.seats.length] : null;
          for (const c of Object.values(s.cards)) {
            if (c.owner === pid) { if (c.zone === 'battlefield') leaveBattlefield(s, c, notes); delete s.cards[c.id]; }
            else if (c.ctrl === pid) c.ctrl = c.owner;
          }
          // Their spells leave the stack, and nobody waits on them for priority or blocks any more.
          if (s.prio) { s.prio.order = s.prio.order.filter(p => p !== pid); s.prio.passed = s.prio.passed.filter(p => p !== pid); if (s.prio.holder === pid) { s.prio.holder = null; nextHolder(s, notes); } }
          if (s.combat) { s.combat.waiting = s.combat.waiting.filter(p => p !== pid); delete s.combat.ok[pid]; for (const [id, x] of Object.entries(s.combat.att)) if (x.def.p === pid || !s.cards[id]) delete s.combat.att[id]; }
          delete s.players[pid]; delete s.inbox[pid]; if (s.todo) delete s.todo[pid];
          s.seats = s.seats.filter(x => x !== pid);
          if (s.hostPid === pid) s.hostPid = s.seats.find(p => s.players[p] && !s.players[p].ai) || null;
          const wasActive = s.turn.active === pid;
          if (wasActive && nextSeat && nextSeat !== pid) {
            s.turn.active = nextSeat; s.turn.phase = 1; s.turn.n++; s.turn.lands = {}; s.combat = null; s.prio = stackTop(s) ? s.prio : null;
            for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && c.ctrl === nextSeat && c.tapped && !c.noUntap) c.tapped = false;   // 502.3
            s.turn.starts = s.turn.starts || {}; s.turn.starts[nextSeat] = s.turn.n;                                                                    // 302.6
          }
          // The monarch / initiative passes to the active player, or the next player if the leaver was active.
          for (const k of ['monarch', 'initiative']) if (s.table[k] === pid) s.table[k] = s.turn.active || null;
          for (const n of notes) log(s, null, n, 'auto');
          log(s, null, `${me.name} left the table`);
          remember(); s.rev++; return { ok: true };
        }
        case 'removeSeat': {
          need();
          const t = s.players[a.pid];
          if (!t) return { ok: false, err: 'No such player.' };
          if (!s.hostPid || !s.players[s.hostPid]) s.hostPid = s.seats.find(p => s.players[p] && !s.players[p].ai) || null;
          const byHost = pid === s.hostPid || (t.ai && t.ai.by === pid);
          if (t.online && a.pid !== pid && !byHost) return { ok: false, err: 'Only the host can remove a player who is still here.' };
          if (a.pid !== pid && byHost) { s.kicked = s.kicked || {}; s.kicked[a.pid] = Date.now(); }
          const name = t.name;
          const r = apply(s, a.pid, { type: 'leave' });
          if (r.ok && a.pid !== pid) { log(s, pid, `removed ${name} from the table`); fixUp(s); s.rev++; }
          return r;
        }
        case 'resetMine': {
          // Switching decks mid-game: take all of your cards off the table.
          need();
          for (const c of Object.values(s.cards)) {
            if (c.owner === pid) delete s.cards[c.id];
            else if (c.ctrl === pid) c.ctrl = c.owner;
          }
          delete s.inbox[pid];
          me.revealed = [];
          return done('cleared their cards from the table to switch decks');
        }
        case 'deck': { need(); me.deckName = String(a.name || '').slice(0, 60); me.sleeveRev = +a.sleeveRev || 0; return done(a.name ? `is playing ${me.deckName}` : ''); }
        case 'counts': {
          need();
          const h = num(a.hand, 0, 999), l = num(a.lib, 0, 999);
          if (h !== null) me.handCount = h; if (l !== null) me.libCount = l;
          s.rev++; return { ok: true };
        }
        case 'enter': {
          need();
          const to = PUBLIC_ZONES.includes(a.zone) ? a.zone : null;
          if (!to) return { ok: false, err: 'bad zone' };
          const list = (a.cards || []).slice(0, 120);
          const names = [];
          const cmdrsNow = Object.values(s.cards).filter(c => c.owner === pid && c.cmdr).length;
          if (cmdrsNow + list.filter(c => c && c.cmdr).length > 2) return { ok: false, err: 'You can have at most 2 commanders.' };
          // Playing a land (305.2): once per turn, on your own turn, in a main phase, with nothing on the stack.
          if (a.land && to === 'battlefield' && s.turn.active) {
            const err = landCheck(s, pid) || (root.Rulebook && a.from === 'library' && list[0] ? root.Rulebook.castBlock(s, pid, Object.assign({ owner: pid, zone: 'library' }, list[0], { d: cleanD(list[0].d) }), Object.assign({}, a, { fromZone: 'library', top: true })) : null);
            if (err) return { ok: false, err, land: true };
            s.turn.lands = s.turn.lands || {};
            s.turn.lands[pid] = (s.turn.lands[pid] || 0) + 1;
          }
          if (to === 'stack' && list.length === 1) {
            const err = castCheck(s, pid, Object.assign({ face: list[0].face ? 1 : 0 }, list[0], { d: cleanD(list[0].d) }), a);
            if (err) return { ok: false, err };
          }
          for (const raw of list) {
            const c = cleanIncoming(raw, pid);
            if (!c) continue;
            if (s.cards[c.id]) return { ok: false, err: 'That card is already in play.' };
            s.cards[c.id] = c;
            c.zone = 'limbo';
            if (typeof a.via === 'string' && /^[a-z]{2,12}$/.test(a.via) && to === 'battlefield') c.via = a.via;
            // Suspend (702.62a): exiled from the hand with N time counters, its suspend cost paid.
            if (to === 'exile' && a.suspend && a.from === 'hand' && root.Cards) {
              const sm = String(root.Cards.rawText(c)).match(/suspend (\d+)\s*[—-]\s*((?:\{[^}]+\})*)/i);
              if (!sm) return { ok: false, err: `${cardName(c)} doesn’t have suspend.` };
              if (!root.Cards.instantSpeed(c) && (s.turn.active !== pid || stackCards(s).length || !/^Main/.test(PHASES[s.turn.phase]))) return { ok: false, err: 'You can suspend it only when you could cast it (702.62a).' };
              spendPool(s, pid, root.Cards.parseCost(sm[2]), 0, a.fromPool);
              moveOne(s, c, 'exile', 'top', { by: pid }, notes);
              c.counters = { time: +sm[1] }; c.suspended = { by: pid, turn: s.turn.n };
              names.push(cardName(c));
              return done(`suspended ${cardName(c)} with ${sm[1]} time counters (702.62)`);
            }
            if (to === 'exile' && a.mayPlay && /^(eot|next)$/.test(a.mayPlay.until)) c.mayPlay = { by: pid, until: a.mayPlay.until, from: num(a.mayPlay.from, 0, 99999) || s.turn.n };   // "put onto the battlefield with this ability" (Kodama)
            moveOne(s, c, to, a.pos, { by: pid, tapped: a.tapped, faceDown: c.faceDown, row: a.row, backFace: c.face === 1 }, notes);
            names.push(cardName(c));
            if (to === 'stack') { c.castFrom = a.from === 'hand' ? 'hand' : null; onCast(s, pid, c, a); }
            if (root.Engine && a.from === 'hand' && to === 'graveyard') root.Engine.emit({ type: 'discard', player: pid, card: c });
          }
          // a.msg is a phrase like "cast {cards}"; the host fills in the card names (face-down cards stay hidden).
          const tmpl = typeof a.msg === 'string' && a.msg.includes('{cards}') ? a.msg.slice(0, 160)
            : to === 'stack' ? 'cast {cards}' : `put {cards} ${to === 'battlefield' ? 'onto' : 'into'} ${ZONE_WORDS[to]}`;
          const tgTxt = to === 'stack' && list.length === 1 ? targetText(s, s.cards[list[0].id]) : '';
          if (to === 'stack') startPrio(s, pid, notes);
          return done(a.quiet ? '' : tmpl.replace('{cards}', listNames(names)) + tgTxt);
        }
        case 'move': {
          need();
          const to = PUBLIC_ZONES.concat(['hand', 'library']).includes(a.to) ? a.to : null;
          if (!to) return { ok: false, err: 'bad zone' };
          const ids = (a.ids || []).slice(0, 200);
          const names = [];
          let froms = new Set();
          for (const id of ids) {
            const c = s.cards[id];
            if (!c) continue;
            const steal = (c.zone === 'graveyard' || c.zone === 'exile') && ((to === 'battlefield' && a.dev) || (to === 'stack' && a.cast)) && c.owner !== pid;
            if (!canAct(s, pid, c) && !steal && !finishing(s, pid)) return { ok: false, err: `You don't control ${cardName(c)}.` };
            if (c.zone === to && to !== 'battlefield') continue;
            if (to === 'stack' && ids.length === 1) { const err = castCheck(s, pid, c, a); if (err) return { ok: false, err }; }
            // Playing a land from exile (impulse draw): it's the land drop for the turn (305.2).
            if ((a.playLand || a.land) && to === 'battlefield' && ids.length === 1 && isType(c, 'land')) { const a2 = Object.assign({}, a); const err = landCheck(s, pid) || (root.Rulebook && !a.dev ? root.Rulebook.castBlock(s, pid, c, a2) : null); if (err) return { ok: false, err, land: true }; if (root.Rulebook) root.Rulebook.use(s, pid, a2.perm, c); s.turn.lands = s.turn.lands || {}; s.turn.lands[pid] = (s.turn.lands[pid] || 0) + 1; }
            if (to !== 'exile') c.mayPlay = null;
            froms.add(c.zone);
            const nm = cardName(c);
            const ownerName = c.owner !== pid ? nameOf(s, c.owner) + '’s ' : '';
            moveOne(s, c, to, a.pos, { by: pid, tapped: a.tapped, faceDown: a.faceDown, row: a.row, sac: !!a.sac && c.zone === 'battlefield' && to === 'graveyard' }, notes);
            names.push(ownerName + nm);
            if (to === 'stack') onCast(s, pid, c, a);
          }
          if (!names.length) return { ok: true };
          if (to === 'stack') {
            const one = ids.length === 1 && s.cards[ids[0]];
            startPrio(s, pid, notes);
            return done(`cast ${listNames(names)}${froms.size === 1 && !froms.has('hand') ? ' from ' + ZONE_WORDS[[...froms][0]] : ''}${one ? targetText(s, one) : ''}`);
          }
          const where = to === 'library'
            ? (a.pos === 'bottom' ? 'on the bottom of its owner’s library' : a.pos === 'shuffle' ? 'into its owner’s library and it was shuffled' : 'on top of its owner’s library')
            : to === 'hand' ? 'into its owner’s hand' : (to === 'battlefield' ? 'onto ' : 'into ') + ZONE_WORDS[to];
          const fromTxt = froms.size === 1 ? ` from ${ZONE_WORDS[[...froms][0]]}` : '';
          if (a.sac && to === 'graveyard') return done(`sacrificed ${listNames(names)}${a.quietSac ? ' (' + String(a.quietSac).slice(0, 60) + ')' : ''}`);
          return done(`moved ${listNames(names)}${fromTxt} ${where}`);
        }
        case 'tap': {
          need();
          const ids = (a.ids || []).slice(0, 300);
          let changed = 0;
          for (const id of ids) {
            const c = s.cards[id];
            if (!c || c.zone !== 'battlefield') continue;
            if (c.ctrl !== pid && !finishing(s, pid)) return { ok: false, err: `You don't control ${cardName(c)}.` };
            if (c.tapped !== !!a.tapped) {
              c.tapped = !!a.tapped; changed++;
              // Tapped by hand for mana (not as part of paying for something): the mana goes into the pool.
              const key = s.turn.n;
              if (a.tapped && !a.pay && c.manaAt !== key && !((c.faceDown || isType(c, 'creature')) && sick(s, c) && !(root.Cards && root.Cards.has(c, 'haste', s)))) {
                const ms = root.Cards && root.Cards.manaSource(c);
                // A Signet needs {1} from the pool to make its mana.
                if (ms && ms.filter) { const P = s.players[pid]; if ((P.pool || []).length >= ms.filter) { spendPool(s, pid, { g: ms.filter, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, x: 0, hy: [], ph: [] }, 0); addPool(s, pid, ms.units.slice()); c.manaAt = key; } }
                else { const u = unitsOf(c); if (u.length) { addPool(s, pid, u); c.manaAt = key; } }
              }
            }
          }
          if (!changed) return { ok: true };
          const one = ids.length === 1 ? cardName(s.cards[ids[0]]) : null;
          return done(a.quiet ? '' : one ? `${a.tapped ? 'tapped' : 'untapped'} ${one}` : `${a.tapped ? 'tapped' : 'untapped'} ${changed} permanents`);
        }
        case 'counter': {
          need();
          const c = s.cards[a.id];
          if (!c || (c.zone !== 'battlefield' && c.zone !== 'exile')) return { ok: false, err: 'Counters go on cards on the battlefield or in exile.' };
          if (!canAct(s, pid, c) && !finishing(s, pid)) return { ok: false, err: `You don't control ${cardName(c)}.` };
          const kind = String(a.kind || '').toLowerCase().trim().slice(0, 30);
          if (!kind) return { ok: false, err: 'Name the counter.' };
          const cur = c.counters[kind] || 0;
          const next = a.set !== undefined ? num(a.set, 0, 9999) : Math.max(0, cur + (num(a.delta, -999, 999) || 0));
          if (next) c.counters[kind] = next; else delete c.counters[kind];
          // 704.5q: +1/+1 and -1/-1 counters cancel out.
          const plus = c.counters['+1/+1'] || 0, minus = c.counters['-1/-1'] || 0;
          if (plus && minus) {
            const m = Math.min(plus, minus);
            if (plus - m) c.counters['+1/+1'] = plus - m; else delete c.counters['+1/+1'];
            if (minus - m) c.counters['-1/-1'] = minus - m; else delete c.counters['-1/-1'];
          }
          const diff = (c.counters[kind] || 0) - cur;
          if (root.Engine && diff > 0 && kind === 'lore' && c.zone === 'battlefield' && /\bsaga\b/i.test(typeLine(c))) for (let k = cur + 1; k <= cur + diff; k++) root.Engine.emit({ type: 'chapter', card: c, n: k });
          if (root.Engine && diff > 0) root.Engine.emit({ type: 'counter', kind, card: c, n: diff });
          return done(diff ? `${diff > 0 ? 'put' : 'removed'} ${Math.abs(diff)} ${kind} counter${Math.abs(diff) > 1 ? 's' : ''} ${diff > 0 ? 'on' : 'from'} ${cardName(c)}` : '');
        }
        case 'mod': {
          need();
          const c = s.cards[a.id];
          if (!c || c.zone !== 'battlefield' || (c.ctrl !== pid && !finishing(s, pid))) return { ok: false, err: 'You don’t control that.' };   // finishing an effect by hand may change others' creatures
          const p = num(a.p, -99, 99) || 0, t = num(a.t, -99, 99) || 0;
          c.mod = (p || t) ? [p, t] : null;
          return done(c.mod ? `gave ${cardName(c)} ${p >= 0 ? '+' : ''}${p}/${t >= 0 ? '+' : ''}${t} until end of turn` : `cleared the P/T change on ${cardName(c)}`);
        }
        case 'flip': {
          need();
          const c = s.cards[a.id];
          if (!c || !canAct(s, pid, c)) return { ok: false, err: 'You don’t control that.' };
          if (!c.d || c.d.faces.length < 2) return { ok: false, err: 'That card has only one face.' };
          const before = cardName(c);
          c.face = c.face ? 0 : 1;
          if (c.zone === 'battlefield') c.row = rowFor(c);
          return done(`transformed ${before} into ${cardName(c)}`);
        }
        case 'faceDown': {
          need();
          const c = s.cards[a.id];
          if (!c || c.zone !== 'battlefield' && c.zone !== 'stack' && c.zone !== 'exile') return { ok: false, err: 'Can’t turn that.' };
          if (c.owner !== pid && c.ctrl !== pid) return { ok: false, err: 'You don’t control that.' };
          if (a.down) {
            if (c.owner !== pid) return { ok: false, err: 'Only the owner can turn it face down.' };
            const nm = cardName(c); c.faceDown = true; c.d = null; if (c.zone === 'battlefield') c.row = 'creatures';
            return done(`turned ${nm} face down`);
          }
          if (c.owner !== pid) return { ok: false, err: 'Ask the owner to turn it face up.' };
          c.d = cleanD(a.d); c.faceDown = false; if (c.zone === 'battlefield') c.row = rowFor(c);
          return done(`turned a face-down card face up: ${cardName(c)}`);
        }
        case 'identify': {
          need();
          const c = s.cards[a.id];
          if (!c || c.owner !== pid || !c.needsId) return { ok: true };
          c.d = cleanD(a.d); c.needsId = false;
          return done(`revealed the face-down card: ${cardName(c)}`);
        }
        case 'attach': {
          need();
          const c = s.cards[a.id];
          if (!c || c.zone !== 'battlefield' || c.ctrl !== pid) return { ok: false, err: 'You don’t control that.' };
          if (a.to === null) { c.attachedTo = null; return done(`unattached ${cardName(c)}`); }
          const t = s.cards[a.to];
          if (!t || t.zone !== 'battlefield' || t.id === c.id) return { ok: false, err: 'Pick a card on the battlefield.' };
          let p = t; while (p) { if (p.attachedTo === c.id) return { ok: false, err: 'Those are already attached the other way.' }; p = s.cards[p.attachedTo]; }
          c.attachedTo = t.id;
          return done(`attached ${cardName(c)} to ${t.ctrl !== pid ? nameOf(s, t.ctrl) + '’s ' : ''}${cardName(t)}`);
        }
        case 'row': {
          need();
          const c = s.cards[a.id];
          if (!c || c.zone !== 'battlefield' || c.ctrl !== pid || !ROWS.includes(a.row)) return { ok: false, err: 'Can’t move that.' };
          c.row = a.row; s.rev++; return { ok: true };
        }
        case 'reorder': {
          need();
          const c = s.cards[a.id], o = s.cards[a.before];
          if (!c || !o || c.ctrl !== pid || c.zone !== 'battlefield') return { ok: true };
          c.seq = o.seq - 0.5; s.rev++; return { ok: true };
        }
        case 'control': {
          need();
          const to = a.to;
          if (!s.players[to]) return { ok: false, err: 'Pick a player at the table.' };
          const names = [];
          for (const id of (a.ids || [])) {
            const c = s.cards[id];
            if (!c || c.zone !== 'battlefield') continue;
            if (c.ctrl !== pid) return { ok: false, err: `You don't control ${cardName(c)}.` };
            if (c.ctrl !== to) c.ctlT = s.turn.n;
            c.ctrl = to; c.seq = ++s.seq;
            names.push((c.owner !== pid ? nameOf(s, c.owner) + '’s ' : '') + cardName(c));
          }
          if (!names.length) return { ok: true };
          return done(to === pid ? '' : `gave control of ${listNames(names)} to ${nameOf(s, to)}`);
        }
        case 'take': {
          // Control-changing effects (Control Magic, Treachery…): take a permanent you don't control.
          need();
          const names = [];
          for (const id of (a.ids || [])) {
            const c = s.cards[id];
            if (!c || c.zone !== 'battlefield' || c.ctrl === pid) continue;
            const from = c.ctrl; c.ctrl = pid; c.seq = ++s.seq; c.ctlT = s.turn.n;
            names.push(`${nameOf(s, from)}’s ${cardName(c)}`);
          }
          return done(names.length ? `took control of ${listNames(names)}` : '');
        }
        case 'noUntap': {
          need();
          const c = s.cards[a.id];
          if (!c || c.zone !== 'battlefield' || c.ctrl !== pid) return { ok: false, err: 'You don’t control that.' };
          c.noUntap = !!a.on;
          return done(`${cardName(c)} ${c.noUntap ? 'won’t untap during its controller’s untap step' : 'untaps normally again'}`);
        }
        case 'zeroOk': {
          need();
          const c = s.cards[a.id];
          if (!c || c.ctrl !== pid) return { ok: true };
          c.zeroOk = true; s.rev++; return { ok: true };
        }
        case 'reprint': {
          // You picked a different printing of your own card mid-game: same card, new picture.
          need();
          const d = cleanD(a.d);
          if (!d) return { ok: false, err: 'bad card' };
          let n = 0;
          for (const id of (a.ids || []).slice(0, 100)) {
            const c = s.cards[id];
            if (!c || c.owner !== pid || c.faceDown || c.token) continue;
            c.d = d; if (c.face && d.faces.length < 2) c.face = 0; if (c.zone === 'battlefield') c.row = rowFor(c);
            n++;
          }
          if (!n) return { ok: true };
          return done(`changed the printing of ${d.n}`);
        }
        case 'token': {
          need();
          const d = cleanD(a.d);
          if (!d) return { ok: false, err: 'Pick a token.' };
          const n = num(a.count, 1, 50) || 1;
          for (let i = 0; i < n; i++) {
            const c = cleanIncoming({ id: pid + '-t' + (++s.seq), d, token: true }, pid);
            s.cards[c.id] = c; c.zone = 'limbo';
            moveOne(s, c, 'battlefield', 'top', { by: pid, tapped: a.tapped }, notes);
          }
          return done(`created ${n > 1 ? n + ' ' : 'a '}${d.n} token${n > 1 ? 's' : ''}${a.copyOf ? ' (a copy)' : ''}`);
        }
        case 'removeToken': {
          need();
          const names = [];
          for (const id of (a.ids || [])) {
            const c = s.cards[id];
            if (!c) continue;
            if (!c.token) return { ok: false, err: `${cardName(c)} isn't a token.` };
            if (!canAct(s, pid, c)) return { ok: false, err: `You don't control ${cardName(c)}.` };
            const notes2 = [];
            if (c.zone === 'battlefield') leaveBattlefield(s, c, notes2);
            notes.push(...notes2);
            delete s.cards[id]; names.push(cardName(c));
          }
          return done(names.length ? `removed ${listNames(names)} token${names.length > 1 ? 's' : ''} from the game` : '');
        }
        case 'player': {
          need();
          const p = a.patch || {};
          for (const k of ['life', 'poison', 'energy', 'exp']) if (p[k] !== undefined) { const v = num(p[k], -999, 9999); if (v !== null) me[k] = v; }
          if (p.cmdDmg && typeof p.cmdDmg === 'object') {
            for (const [k, v] of Object.entries(p.cmdDmg)) { const n = num(v, 0, 999); if (n) me.cmdDmg[k.slice(0, 40)] = n; else delete me.cmdDmg[k]; }
          }
          if (p.phone !== undefined) me.phone = !!p.phone;
          if (p.kept !== undefined) me.kept = !!p.kept;
          alertChecks(s, pid);
          checkLoss(s, notes); fixUp(s, notes); for (const n of notes) log(s, null, n, 'auto');
          s.rev++; return { ok: true };
        }
        case 'table': {
          need();
          const t = s.table;
          if (a.key === 'monarch' || a.key === 'initiative') {
            const v = a.value && s.players[a.value] ? a.value : null;
            t[a.key] = v;
            return done(v ? `made ${nameOf(s, v)} ${a.key === 'monarch' ? 'the monarch' : 'take the initiative'}` : `cleared the ${a.key}`);
          }
          if (a.key === 'day') {
            t.day = a.value === 'day' || a.value === 'night' ? a.value : null;
            return done(t.day ? `made it ${t.day}` : 'removed day/night');
          }
          return { ok: false, err: 'bad key' };
        }
        case 'start': {
          need();
          if (!s.seats.length) return { ok: false, err: 'Nobody is seated.' };
          if (s.turn && s.turn.active && !s.winner) return { ok: false, err: 'The game has already started. Use New game to start over.' };
          // Random seating order and starting player (103.1 / 103.2).
          const order = s.seats.slice();
          for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
          // Players who are out (or just watching) don't take turns.
          order.sort((x, y) => (alive(s, x) ? 0 : 1) - (alive(s, y) ? 0 : 1));
          s.seats = order;
          s.turn = { active: order[0], phase: 1, n: 1, first: order[0], lands: {}, starts: { [order[0]]: 1 }, goal: 'main1', mulls: true };
          for (const p of order) if (s.players[p]) { s.players[p].kept = false; s.players[p].life = (s.house && s.house.life) || START_LIFE; }
          return done(`randomized the turn order: ${order.map(x => nameOf(s, x)).join(' → ')}. ${nameOf(s, order[0])} goes first.`);
        }
        case 'phase': {
          need();
          const T = s.turn;
          if (!T.active) return { ok: false, err: 'Start the game first.' };
          const activeOnline = s.players[T.active] && s.players[T.active].online;
          if (T.active !== pid && activeOnline) return { ok: false, err: 'Only the active player can change the phase.' };
          if (stackCards(s).length && !a.force) return { ok: false, err: 'Wait until everything on the stack has resolved.' };
          if (s.prio && s.prio.step && live(s, s.prio.holder) && !(a.force && Date.now() - (s.prio.since || 0) > 45000)) return { ok: false, err: s.prio.holder === pid ? 'Press “Continue to damage” to pass priority — the others get their chance to respond before damage (117.3).' : `Wait — ${nameOf(s, s.prio.holder)} may still cast something before combat damage (510).` };
          {
            const K0 = s.combat;
            const pend = K0 && K0.n === T.n && !K0.done && !K0.blocked ? K0.waiting.filter(p => !K0.ok[p] && live(s, p)) : [];
            if (pend.length && Date.now() - (K0.since || 0) < 90000) return { ok: false, err: `Wait for ${listNames(pend.map(p => nameOf(s, p)))} to declare blockers (509.1).` };
          }
          const dev = !!(a.dev && s.dev);
          if (a.dir === 'back' && !dev) return { ok: false, err: 'The game doesn’t go backwards (only in developer debugging).' };
          if (typeof a.to === 'number' && (a.to | 0) <= T.phase && !dev) return { ok: true, stale: true };
          if (a.dir === 'pass' || T.phase >= PHASES.length - 1 && a.dir !== 'back') {
            // Ending the turn still goes through the end step (and its triggers) first (513).
            if (root.Engine && !dev && T.phase < PI('End step')) { T.goal = 'pass'; return done(''); }
            return passTurn(s, pid, notes, done);
          }
          const was = T.phase;
          if (a.dir === 'back') T.phase = Math.max(1, T.phase - 1);
          else if (typeof a.to === 'number') T.phase = Math.max(1, Math.min(PHASES.length - 1, a.to | 0));
          else T.phase++;
          if (T.phase > was) T.goal = null;
          if (root.Engine && PHASES[T.phase] === 'Declare blockers' && !(s.combat && s.combat.n === T.n)) { s.combat = { n: T.n, att: {}, waiting: [], ok: {}, done: true }; }
          const K = s.combat;
          // Moving into combat damage deals it (blockers not declared in time count as no blocks).
          if (K && K.n === T.n && !K.done && T.phase >= PI('Combat damage') && was < PI('Combat damage') && Object.keys(K.att).length) { if (s.prio && s.prio.step) s.prio = null; combatDamage(s, notes); for (const x of notes) log(s, null, x, 'auto'); s.rev++; return { ok: true }; }
          if (PHASES[T.phase] === 'Cleanup') { clearMods(s); if (root.Engine) root.Engine.endOfTurn(s); }
          s.rev++; return { ok: true };
        }
        // House rules (host, before the game starts): starting life, commander damage, the free first mulligan.
        case 'house': {
          if (pid !== s.hostPid) return { ok: false, err: 'Only the host sets the house rules.' };
          if (s.turn && s.turn.active && !s.winner) return { ok: false, err: 'House rules are set before the game starts.' };
          const H = s.house = Object.assign({ life: START_LIFE, cmdrDmg: true, freeMull: true }, s.house || {});
          if (a.life !== undefined) { const v = num(a.life, 1, 999); if (v) H.life = v; }
          if (a.cmdrDmg !== undefined) H.cmdrDmg = !!a.cmdrDmg;
          if (a.freeMull !== undefined) H.freeMull = !!a.freeMull;
          for (const p of s.seats) if (s.players[p] && !s.turn.active) s.players[p].life = H.life;
          return done(`set the house rules: ${H.life} life, commander damage ${H.cmdrDmg ? 'on' : 'off'}, free first mulligan ${H.freeMull ? 'on' : 'off'}`);
        }
        // Dev mode (host only): step the public table back to before an earlier action (hidden cards stay where they are).
        case 'devRewind': {
          if (!(s.dev && pid === s.hostPid) && !a.dev) return { ok: false, err: 'Only the host, in dev mode, can rewind.' };
          const H = HIST.get(s.gameId) || [];
          const k = Math.max(1, Math.min(H.length, num(a.steps, 1, 20) || 1));
          if (!H.length) return { ok: false, err: 'Nothing to rewind.' };
          const snap = JSON.parse(H.splice(H.length - k, k)[0]);
          const keepLog = s.log, keepDev = s.dev, keepHost = s.hostPid, players = s.players;
          Object.keys(s).forEach(x => delete s[x]); Object.assign(s, snap);
          for (const p of Object.keys(s.players)) if (players[p]) { s.players[p].online = players[p].online; s.players[p].offAt = players[p].offAt; }
          s.log = keepLog; s.dev = keepDev; s.hostPid = keepHost; s.rev = (s.rev || 0) + 1000;
          return done(`rewound the table ${k} action${k > 1 ? 's' : ''} (dev mode — cards in hands and libraries stay where they are)`);
        }
        // Dev mode (host only): add a rule line for a player, or switch a card's rule off/on — for debugging the rulebook.
        case 'devPerm': {
          if (!(s.dev && pid === s.hostPid) && !a.dev) return { ok: false, err: 'Only the host, in dev mode, can edit the rulebook.' };
          if (a.op === 'add' && s.players[a.pid] && typeof a.line === 'string') { s.devPerms = (s.devPerms || []).concat([{ pid: a.pid, line: a.line.toLowerCase().replace(/\.$/, '').trim().slice(0, 300) }]).slice(-40); return done(''); }
          if (a.op === 'remove') { s.devPerms = (s.devPerms || []).filter((x, i) => i !== (a.i | 0)); return done(''); }
          if (a.op === 'off' && typeof a.key === 'string') { s.devOff = [...new Set((s.devOff || []).concat([a.key.slice(0, 120)]))].slice(-80); return done(''); }
          if (a.op === 'on' && typeof a.key === 'string') { s.devOff = (s.devOff || []).filter(k => k !== a.key); return done(''); }
          return { ok: false, err: 'bad op' };
        }
        // Graveyard abilities (unearth, embalm, eternalize, encore): sorcery speed, the card's own cost (602.5d).
        case 'gyAct': {
          need();
          const c = s.cards[a.id];
          if (!c || c.zone !== 'graveyard' || c.owner !== pid || !root.Oracle) return { ok: false, err: 'That card isn’t in your graveyard.' };
          const k = root.Oracle.model(c).costs.find(x => x.ability && x.zone === 'graveyard' && x.kind === a.kind);
          if (!k) return { ok: false, err: `${cardName(c)} has no ${a.kind} ability.` };
          if (mulligansPending(s)) return { ok: false, err: 'Wait until every player has kept their opening hand (103.5).' };
          if (s.turn.active !== pid || stackCards(s).length || !/^Main/.test(PHASES[s.turn.phase])) return { ok: false, err: `${a.kind[0].toUpperCase() + a.kind.slice(1)} only as a sorcery: in your main phase with an empty stack (602.5d).` };
          const RB = root.Rulebook, bl = RB && RB.cant(s, pid, 'activate', c);
          if (bl) return { ok: false, err: `${bl.srcName}: ${bl.text}.` };
          const en = (String(k.cost).match(/\{e\}/gi) || []).length || (+((String(k.cost).match(/pay (\w+) \{e\}/i) || [])[1]) || ({ eight: 8, six: 6, four: 4, three: 3, two: 2, one: 1 })[(String(k.cost).match(/pay (\w+) \{e\}/i) || [])[1]] || 0);
          if (en && (me.energy || 0) < en) return { ok: false, err: `You need ${en} energy.` };
          if (en) me.energy -= en;
          const mana = (String(k.cost).match(/\{[^}]+\}/g) || []).filter(x => !/^\{e\}$/i.test(x)).join('');
          if (root.Cards && mana) spendPool(s, pid, root.Cards.parseCost(mana), 0, a.fromPool);
          const eotHaste = x => { x.counters = x.counters || {}; x.counters.haste = (x.counters.haste || 0) + 1; x.eot = (x.eot || []).concat([{ counter: 'haste', until: 'eot', label: 'haste' }]); };
          const copyD = (over) => { const d = JSON.parse(JSON.stringify(c.d)); const f = d.faces[c.face || 0] || d.faces[0]; d.faces = [Object.assign(f, { mc: '' }, over || {})]; d.n = d.faces[0].n; d.cmc = 0; return d; };
          const made = () => { const before = new Set(Object.keys(s.cards)); return () => Object.keys(s.cards).filter(id => !before.has(id)); };
          if (a.kind === 'unearth') {
            moveOne(s, c, 'battlefield', 'top', { by: pid }, notes); c.unearthed = true; eotHaste(c);
            s.delayed = (s.delayed || []).concat([{ step: 'end', id: c.id, to: 'exile', by: pid, src: 'unearth', n: s.turn.n }]);
            return done(`unearthed ${cardName(c)} — it has haste and is exiled at the beginning of the next end step (702.84)`);
          }
          moveOne(s, c, 'exile', 'top', { by: pid }, notes);
          if (a.kind === 'embalm' || a.kind === 'eternalize') {
            const f0 = (c.d.faces[c.face || 0] || c.d.faces[0]);
            const t = String(f0.t || '').replace(/—\s*/, '— Zombie ');
            const nw = made(); makeToken(s, pid, copyD(a.kind === 'eternalize' ? { t, p: '4', tg: '4', col: ['B'] } : { t, col: ['W'] }), 1, false, notes);
            for (const id of nw()) if (s.cards[id] && s.cards[id].d) s.cards[id].d.col = a.kind === 'eternalize' ? ['B'] : ['W'];
            return done(`${a.kind === 'embalm' ? 'embalmed' : 'eternalized'} ${cardName(c)}: a token copy${a.kind === 'eternalize' ? ', a 4/4 black Zombie,' : ' (a white Zombie)'} entered the battlefield`);
          }
          if (a.kind === 'encore') {
            const opps = s.seats.filter(p => p !== pid && s.players[p] && !s.players[p].lost);
            for (const opp of opps) { const nw = made(); makeToken(s, pid, copyD(), 1, false, notes); for (const id of nw()) { const tk = s.cards[id]; if (!tk) continue; eotHaste(tk); tk.mustAttack = opp; s.delayed = (s.delayed || []).concat([{ step: 'end', id, to: 'graveyard', sac: true, by: pid, src: 'encore', n: s.turn.n }]); } }
            return done(`encored ${cardName(c)}: a hasty token copy for each opponent, each attacking that player this turn if able; they’re sacrificed at the beginning of the next end step (702.141)`);
          }
          return done(`used ${a.kind} on ${cardName(c)}`);
        }
        case 'advance': {
          if (mulligansPending(s)) return { ok: false, err: 'Wait until every player has kept their opening hand (103.5).' };
          // The turn buttons: "Go to combat" or "End turn" (the steps in between happen by themselves).
          need();
          const T = s.turn;
          if (!T.active) return { ok: false, err: 'Start the game first.' };
          if (T.active !== pid && s.players[T.active] && s.players[T.active].online) return { ok: false, err: 'It isn’t your turn.' };
          if (a.goal === 'combat') {
            if (T.phase >= PI('Declare attackers') || (s.combat && s.combat.n === T.n)) return { ok: false, err: 'Combat already happened this turn.' };
            if (stackCards(s).length) return { ok: false, err: 'Wait until everything on the stack has resolved.' };
            T.goal = 'combat';
            return done('');
          }
          if (a.goal === 'end') {
            if (stackCards(s).length) return { ok: false, err: 'Wait until everything on the stack has resolved.' };
            const K = s.combat;
            if (K && K.n === T.n && !K.done && Object.keys(K.att || {}).length) return { ok: false, err: 'Finish combat first.' };
            T.goal = 'pass';
            return done('');
          }
          return { ok: false, err: 'bad goal' };
        }
        case 'answer': {
          need();
          if (!root.Engine) return { ok: true };
          const r = root.Engine.answer(s, pid, Object.assign({}, a, { dev: !!(a.dev && s.dev) }), notes);
          if (!r.ok) return r;
          return done('');
        }
        case 'log': {
          need();
          if (root.Engine && a.drew > 0) { const T = s.turn; if (T && T.active) { T.stats = T.stats || { attacked: {}, died: 0, gained: {}, lost: {}, spells: {}, drew: {} }; for (let i = 0; i < Math.min(20, a.drew | 0); i++) { T.stats.drew[pid] = (T.stats.drew[pid] || 0) + 1; root.Engine.emit({ type: 'draw', player: pid, nth: T.stats.drew[pid], step: PHASES[T.phase] === 'Draw' && T.active === pid }); } } }
          if (a.alert) { log(s, pid, String(a.text || '').slice(0, 200), 'alert'); s.rev++; return { ok: true }; }
          return done(String(a.text || '').slice(0, 200));
        }
        case 'reveal': {
          need();
          me.revealed = (a.cards || []).slice(0, 60).map(c => ({ id: String(c.id || '').slice(0, 40), d: cleanD(c.d), face: 0, from: c.from === 'library' ? 'library' : 'hand', known: c.known ? true : undefined })).filter(c => c.d);
          if (a.quiet) return done('');
          if (!me.revealed.length) return done(a.quiet ? '' : 'hid their revealed cards');
          return done(a.quiet ? '' : `revealed ${listNames(me.revealed.map(c => c.d.n))} from their ${a.from === 'library' ? 'library' : 'hand'}`);
        }
        case 'inboxAck': {
          need();
          const ids = new Set(a.ids || []);
          s.inbox[pid] = (s.inbox[pid] || []).filter(x => !ids.has(x.card.id));
          s.rev++; return { ok: true };
        }
        case 'dice': {
          need();
          if (a.sides === 2) return done(`flipped a coin: ${Math.random() < 0.5 ? 'heads' : 'tails'}`);
          const n = num(a.sides, 2, 1000) || 6;
          return done(`rolled a d${n}: ${1 + Math.floor(Math.random() * n)}`);
        }
        case 'newGame': {
          need();
          const keep = s.seats.slice(), ps = s.players;
          const ns = newState();
          ns.seats = keep;
          for (const id of keep) {
            const old = ps[id];
            ns.players[id] = Object.assign(newPlayer(old.name), { online: old.online, phone: old.phone, sleeveRev: old.sleeveRev, deckName: old.deckName }, old.ai ? { ai: old.ai } : {});
          }
          ns.rev = s.rev + 1;
          ns.hostPid = s.hostPid;
          ns.kicked = a.rematch ? s.kicked : undefined;   // a brand-new game lets removed players sit down again
          ns.rematch = !!a.rematch;
          ns.house = s.house;
          if (ns.rematch && keep.length) {
            // Rematch: same decks, new random turn order (103.1).
            const order = keep.slice();
            for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
            ns.seats = order;
            ns.turn = { active: order[0], phase: 1, n: 1, first: order[0], lands: {}, starts: { [order[0]]: 1 }, goal: 'main1', mulls: true };
            for (const p of order) if (ns.players[p]) { ns.players[p].kept = false; ns.players[p].life = (s.house && s.house.life) || START_LIFE; }
          }
          Object.keys(s).forEach(k => delete s[k]);
          Object.assign(s, ns);
          if (s.rematch) log(s, pid, `started a rematch. Turn order: ${s.seats.map(x => nameOf(s, x)).join(' → ')}. ${nameOf(s, s.seats[0])} goes first.`);
          else log(s, pid, 'started a new game — everyone picks a deck');
          return { ok: true };
        }
        case 'pass': {
          // Pass priority: "I don't want to respond." When everyone has passed, the top of the stack resolves.
          need();
          const P = s.prio;
          if (!P) return { ok: true };
          if (a.top && P.top && P.top !== a.top) return { ok: true, stale: true };
          let who = pid;
          if (P.holder !== pid) {
            if (a.for && a.for === P.holder && !live(s, a.for)) who = a.for;
            else return { ok: true, stale: true };
          }
          if (!P.passed.includes(who)) P.passed.push(who);
          nextHolder(s, notes);
          remember(); sba(s, notes); for (const n of notes) log(s, null, n, 'auto'); s.rev++; return { ok: true };
        }
        case 'resolveNow': {
          // Nobody answered for a while (or the player who has to answer is away): resolve the top anyway.
          need();
          const P = s.prio, top = stackTop(s);
          if (!top && P && P.step) {
            if (s.turn.active !== pid && live(s, P.holder) && Date.now() - (P.since || 0) < 45000) return { ok: false, err: `${nameOf(s, P.holder)} is still deciding.` };
            s.prio = null; if (combatWaiting(s)) combatDamage(s, notes);
            remember(); sba(s, notes); for (const n of notes) log(s, null, n, 'auto'); s.rev++; return { ok: true };
          }
          if (!top) return { ok: true };
          // A "you may" on top is still being answered: that player's choice comes first (it times out after 2 minutes).
          const mayAsk = (s.ask || []).find(x => x.kind === 'may' && x.item === top.id);
          if (mayAsk) return { ok: false, err: mayAsk.pid === pid ? `First answer whether to use ${mayAsk.name}.` : `${nameOf(s, mayAsk.pid)} is deciding whether to use ${mayAsk.name}.` };
          if ((s.tq || []).length) return { ok: false, err: 'Triggered abilities are still being put on the stack.' };
          const waited = P ? Date.now() - (P.since || 0) : 1e9;
          // The spell's own controller may skip the wait (a casual-table shortcut); anyone else waits 45 seconds.
          if (P && live(s, P.holder) && waited < 45000 && top.ctrl !== pid) return { ok: false, err: `${nameOf(s, P.holder)} is still deciding. You can resolve it yourself after 45 seconds.` };
          log(s, pid, P && P.holder ? `resolved ${cardName(top)} without waiting for ${nameOf(s, P.holder)}` : `resolved ${cardName(top)}`);
          resolveTop(s, notes);
          if (stackCards(s).length) startPrio(s, null, notes); else s.prio = null;
          remember(); sba(s, notes); for (const n of notes) log(s, null, n, 'auto'); s.rev++; return { ok: true };
        }
        case 'activate': {
          // An activated ability of a permanent goes on the stack (602.2). Mana abilities don't (605.3).
          need();
          const src = s.cards[a.id];
          if (!src || src.zone !== 'battlefield') return { ok: false, err: 'That isn’t on the battlefield.' };
          if (src.ctrl !== pid) return { ok: false, err: `You don't control ${cardName(src)}.` };
          const C = root.Cards;
          const ab = C.abilities(src)[a.i | 0];
          if (!ab) return { ok: false, err: 'That ability isn’t on the card.' };
          if (mulligansPending(s)) return { ok: false, err: 'Wait until every player has kept their opening hand (103.5).' };
          { const bl = root.Rulebook && root.Rulebook.cant(s, pid, 'activate', src); if (bl) return { ok: false, err: `${bl.srcName}: ${bl.text}.` }; }
          if ((src.faceDown || isType(src, 'creature')) && Object.values(s.cards).some(o => o.zone === 'battlefield' && o.ctrl !== pid && !o.faceDown && o.d && /activated abilities of creatures your opponents control can't be activated/i.test(C.text(o)))) return { ok: false, err: 'Creatures’ activated abilities can’t be activated right now (Linvala).' };
          if (ab.tap) {
            if (src.tapped) return { ok: false, err: `${cardName(src)} is already tapped.` };
            if ((src.faceDown || isType(src, 'creature')) && sick(s, src) && !(C.has(src, 'haste', s))) return { ok: false, err: `${cardName(src)} hasn’t been under your control since your turn began, so it can’t use {T} abilities yet (summoning sickness, 302.6).` };
          }
          // Activation restrictions (602.5): "Activate only as a sorcery / once each turn / during your turn / if …".
          const restr = String(ab.text || '').toLowerCase().match(/activate (?:this ability )?only ([^.]+)/g) || [];
          const sorc = /^level \d+\.?$/i.test(ab.text || '') || restr.some(r => /as a sorcery/.test(r));
          if (sorc && !ab.equip && (s.turn.active !== pid || stackCards(s).length || !/^Main/.test(PHASES[s.turn.phase]))) return { ok: false, err: 'Activate this only as a sorcery: in your main phase with an empty stack (602.5d).' };
          if (restr.some(r => /during your turn/.test(r)) && s.turn.active !== pid) return { ok: false, err: 'Activate this only during your turn.' };
          if (restr.some(r => /during your upkeep/.test(r)) && (s.turn.active !== pid || PHASES[s.turn.phase] !== 'Upkeep')) return { ok: false, err: 'Activate this only during your upkeep.' };
          const onceKey = src.id + '#' + (a.i | 0);
          if (restr.some(r => /once each turn/.test(r))) { s.turn.actOnce = s.turn.actOnce || {}; if (s.turn.actOnce[onceKey] === s.turn.n) return { ok: false, err: 'This ability can be activated only once each turn.' }; }
          { const cnd = restr.map(r => (r.match(/^if (.+)$/) || [])[1]).find(Boolean); if (cnd && root.Oracle && root.Oracle.conditionHolds(s, src, cnd) === false) return { ok: false, err: `Activate this only if ${cnd}.` }; }
          const enNeed = ab.energy === 'X' ? (num(a.x, 0, 99) || 0) : (ab.energy || 0);
          if (enNeed && (me.energy || 0) < enNeed) return { ok: false, err: `You need ${enNeed} energy (you have ${me.energy || 0}).` };
          if (ab.equip && (s.turn.active !== pid || stackCards(s).length || !/^Main/.test(PHASES[s.turn.phase]))) return { ok: false, err: 'Equip only as a sorcery: in your main phase with an empty stack (702.6a).' };
          {
            const reqs0 = C.targetsIn(ab.text), tg0 = cleanTargets(a.tg, reqs0.length);
            for (let i = 0; i < reqs0.length; i++) for (const t of tg0[i] || []) if (!C.legalTarget(s, reqs0[i], t, pid)) return { ok: false, err: 'That isn’t a legal target for this ability.' };
          }
          if (ab.loyalty !== undefined) {
            const have = (src.counters || {}).loyalty || 0;
            if (s.turn.active !== pid || stackCards(s).length || !/^Main/.test(PHASES[s.turn.phase])) return { ok: false, err: 'Loyalty abilities can be activated only in your main phase with an empty stack (606.3).' };
            if ((s.turn.loyal || {})[src.id] === s.turn.n) return { ok: false, err: `${cardName(src)} already used a loyalty ability this turn (606.3).` };
            if (have + ab.loyalty < 0) return { ok: false, err: `${cardName(src)} doesn’t have enough loyalty.` };
            src.counters.loyalty = have + ab.loyalty; if (!src.counters.loyalty) delete src.counters.loyalty;
            (s.turn.loyal = s.turn.loyal || {})[src.id] = s.turn.n;
          }
          const reqs = C.targetsIn(ab.text);
          const tg = cleanTargets(a.tg, reqs.length);
          for (let i = 0; i < reqs.length; i++) for (const t of tg[i] || []) if (!C.legalTarget(s, reqs[i], t, pid)) return { ok: false, err: 'That isn’t a legal target for this ability.' };
          for (const t of [].concat(...tg)) if (t.c && s.cards[t.c] && C.protectedFrom(s.cards[t.c], src, s)) return { ok: false, err: `${cardName(s.cards[t.c])} has protection from ${cardName(src)}, so it can’t be targeted by its abilities (702.16b).` };
          // Other costs: crew (tap creatures), sacrifice another permanent, pay life (602.2b, 118).
          let crewNames = null, sacked = null;
          if (ab.crew) {
            const ids = [...new Set((a.crew || []).slice(0, 20))];
            const crew = ids.map(id => s.cards[id]).filter(x => x && x.zone === 'battlefield' && x.ctrl === pid && x.id !== src.id && (x.faceDown || isType(x, 'creature')) && !x.tapped);
            if (crew.length !== ids.length) return { ok: false, err: 'Crew with untapped creatures you control.' };
            const pw = crew.reduce((t, x) => t + Math.max(0, (C.pt(s, x) || [0])[0]), 0);
            if (pw < ab.crew) return { ok: false, err: `Crew ${ab.crew} needs creatures with total power ${ab.crew} or more (you chose ${pw}).` };
            for (const x of crew) x.tapped = true;
            crewNames = crew.map(cardName);
          }
          if (ab.sacOther) {
            const v = s.cards[a.sac];
            if (!v || v.zone !== 'battlefield' || v.ctrl !== pid || (/another/i.test(ab.cost) && v.id === src.id) || !C.matchesWhat(v, ab.sacOther)) return { ok: false, err: `Choose ${/^[aeiou]/.test(ab.sacOther) ? 'an' : 'a'} ${ab.sacOther} you control to sacrifice.` };
            sacked = cardName(v); var sackedCtx = { pw: (C.pt(s, v) || [0])[0], tg: (C.pt(s, v) || [0, 0])[1], mv: +((v.d || {}).cmc) || 0, c: v.id, cName: sacked }; moveOne(s, v, 'graveyard', 'top', { sac: true }, notes);
          }
          if (ab.life) { if (me.life < ab.life) return { ok: false, err: `You need ${ab.life} life to pay.` }; me.life -= ab.life; }
          if (enNeed) { me.energy = (me.energy || 0) - enNeed; s.turn.stats = s.turn.stats || {}; (s.turn.stats.energy = s.turn.stats.energy || {})[pid] = ((s.turn.stats.energy || {})[pid] || 0) + enNeed; }
          // "Discard a card" in the cost (Pack Rat): the hand is private, so the owner's page discards it (602.2b).
          if (/discard (?:a|one) card/i.test(ab.cost || '')) { if (!(me.handCount > 0)) return { ok: false, err: 'You need a card in hand to discard.' }; todo(s, pid, { k: 'discard', n: 1, src: cardName(src) + ' (cost)' }); }
          if (ab.tap) src.tapped = true;
          if (restr.some(r => /once each turn/.test(r))) { s.turn.actOnce = s.turn.actOnce || {}; s.turn.actOnce[onceKey] = s.turn.n; }
          spendPool(s, pid, ab.mana, num(a.x, 0, 99) || 0, a.fromPool);
          // Mana abilities don't use the stack (605.3).
          if (ab.manaAb && root.Effects) {
            const r = root.Effects.parse(ab.text);
            for (const o of r.ops) if (o.op === 'addMana') addPool(s, pid, Array.isArray(o.units) ? o.units : ['WUBRG']);
            if (ab.sac) moveOne(s, src, 'graveyard', 'top', { sac: true }, notes);
            return done(`used ${cardName(src)}${sacked ? ' (sacrificed ' + sacked + ')' : ''}: ${ab.text}`);
          }
          const id = 'ab' + (++s.seq) + '-' + src.id.slice(0, 12);
          s.cards[id] = { id, owner: pid, ctrl: pid, d: src.d, face: src.face || 0, faceDown: false, token: true, cmdr: false, tapped: false, counters: {}, mod: null,
            attachedTo: null, row: null, zone: 'stack', seq: ++s.seq, ab: { src: src.id, text: String(ab.text).slice(0, 400), name: cardName(src), ctx: typeof sackedCtx !== 'undefined' && sackedCtx ? sackedCtx : undefined }, tg, reqs, x: num(a.x, 0, 99) || 0 };
          wardFor(s, pid, s.cards[id], a);
          if (ab.sac) moveOne(s, src, 'graveyard', 'top', { sac: true }, notes);
          if (ab.exileSelf && src.zone === 'battlefield') moveOne(s, src, 'exile', 'top', null, notes);
          startPrio(s, pid, notes);
          return done(`activated ${cardName(src)}${crewNames ? ' (crewed by ' + listNames(crewNames) + ')' : ''}${sacked ? ' (sacrificed ' + sacked + ')' : ''}${ab.life ? ' (paid ' + ab.life + ' life)' : ''}: “${String(ab.text).replace(/^this /i, cardName(src) + ' ')}”${targetText(s, s.cards[id])}`);
        }
        case 'trigger': {
          // A triggered ability goes on the stack (603.3): its controller puts it there and picks targets.
          need();
          const src = s.cards[a.id];
          if (!src || src.ctrl !== pid && src.owner !== pid) return { ok: false, err: 'That isn’t your card.' };
          const C = root.Cards;
          const tr = C.triggers(src)[a.i | 0];
          if (!tr) return { ok: false, err: 'That card has no such triggered ability.' };
          if (root.Engine && root.Engine.handles(src, tr.text) && !a.force) return { ok: false, err: 'The table puts this triggered ability on the stack by itself when it triggers.', auto: true };
          const reqs = C.targetsIn(tr.text);
          const tg = cleanTargets(a.tg, reqs.length);
          for (let i = 0; i < reqs.length; i++) for (const t of tg[i] || []) if (!C.legalTarget(s, reqs[i], t, pid)) return { ok: false, err: 'That isn’t a legal target for this ability.' };
          for (const t of [].concat(...tg)) if (t.c && s.cards[t.c] && C.protectedFrom(s.cards[t.c], src, s)) return { ok: false, err: `${cardName(s.cards[t.c])} has protection from ${cardName(src)} (702.16b).` };
          const id = 'tr' + (++s.seq) + '-' + src.id.slice(0, 12);
          s.cards[id] = { id, owner: pid, ctrl: pid, d: src.d, face: src.face || 0, faceDown: false, token: true, cmdr: false, tapped: false, counters: {}, mod: null,
            attachedTo: null, row: null, zone: 'stack', seq: ++s.seq, ab: { src: src.id, text: String(tr.text).slice(0, 400), name: cardName(src), trig: true }, tg, reqs, x: 0 };
          startPrio(s, pid, notes);
          return done(`put ${cardName(src)}’s triggered ability on the stack: “${String(tr.text).replace(/^this /i, cardName(src) + ' ')}”${targetText(s, s.cards[id])}`);
        }
        case 'attack': {
          need();
          const T = s.turn;
          if (T.active !== pid) return { ok: false, err: 'Only the player whose turn it is can attack.' };
          if (stackCards(s).length) return { ok: false, err: 'Wait until the stack is empty.' };
          const step = PHASES[T.phase];
          if (!['Main 1', 'Beginning of combat', 'Declare attackers'].includes(step)) return { ok: false, err: 'Attackers are declared at the start of combat, after your first main phase.' };
          if (s.combat && s.combat.n === T.n) return { ok: false, err: 'You already attacked this turn.' };
          const C = root.Cards;
          const att = {}, names = [], defs = new Set();
          // "Attacks that player this turn if able" (encore, 508.1d): added if it was left out and can attack.
          a = Object.assign({}, a, { list: (a.list || []).slice(0, 80) });
          for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && c.ctrl === pid && c.mustAttack && !c.tapped && !a.list.some(it => it && it.id === c.id) && s.players[c.mustAttack] && !s.players[c.mustAttack].lost && (!sick(s, c) || (C && C.has(c, 'haste', s)))) a.list.push({ id: c.id, p: c.mustAttack });
          for (const it of a.list) {
            const c = s.cards[it && it.id];
            if (!c || c.zone !== 'battlefield' || c.ctrl !== pid) return { ok: false, err: 'You can only attack with creatures you control.' };
            if (!(c.faceDown || isType(c, 'creature'))) return { ok: false, err: `${cardName(c)} isn’t a creature.` };
            if (c.tapped) return { ok: false, err: `${cardName(c)} is tapped, so it can’t attack.` };
            const kw = C.keywords(c, s);
            if (sick(s, c) && !kw.has('haste')) return { ok: false, err: `${cardName(c)} hasn’t been under your control since your turn began and doesn’t have haste, so it can’t attack yet (summoning sickness, 302.6).` };
            if (kw.has('defender') || kw.has("can't attack")) return { ok: false, err: `${cardName(c)} can’t attack.` };
            let def = null;
            if (it.p && s.players[it.p] && it.p !== pid && alive(s, it.p)) def = { p: it.p };
            else if (it.c && s.cards[it.c] && s.cards[it.c].zone === 'battlefield' && s.cards[it.c].ctrl !== pid && (isType(s.cards[it.c], 'planeswalker') || isType(s.cards[it.c], 'battle'))) def = { c: it.c };
            if (!def) return { ok: false, err: 'Choose an opponent (or their planeswalker) to attack.' };
            att[c.id] = { def, blk: [] };
            defs.add(def.p || s.cards[def.c].ctrl);
            names.push(cardName(c));
          }
          if (!names.length) {
            s.combat = { n: T.n, att: {}, waiting: [], ok: {}, done: true };
            if (T.phase < PI('Declare attackers')) T.phase = PI('Declare attackers');
            T.goal = 'main2';
            return done('didn’t attack');
          }
          for (const id of Object.keys(att)) { const c = s.cards[id]; if (!C.keywords(c, s).has('vigilance')) c.tapped = true; }
          s.combat = { n: T.n, att, waiting: [...defs], ok: {}, done: false, since: Date.now() };
          T.phase = PI('Declare blockers');
          T.goal = null;
          if (root.Engine) {
            T.stats = T.stats || { attacked: {}, died: 0, gained: {}, lost: {}, spells: {}, drew: {} }; T.stats.attacked[pid] = true;
            root.Engine.emit({ type: 'youAttack', player: pid });
            const alone = Object.keys(att).length === 1;
            for (const [id, x] of Object.entries(att)) root.Engine.emit({ type: 'attack', card: s.cards[id], player: pid, alone, def: x.def.p || (s.cards[x.def.c] && s.cards[x.def.c].ctrl) });
          }
          const byDef = {};
          for (const [id, x] of Object.entries(att)) { const k = x.def.p ? nameOf(s, x.def.p) : cardName(s.cards[x.def.c]); (byDef[k] = byDef[k] || []).push(cardName(s.cards[id])); }
          log(s, pid, 'attacked ' + Object.entries(byDef).map(([k, v]) => `${k} with ${listNames(v)}`).join('; '));
          for (const p of s.combat.waiting) if (!live(s, p)) s.combat.ok[p] = true;
          if (s.combat.waiting.every(p => s.combat.ok[p])) { s.combat.blocked = true; startStep(s, notes); }
          remember(); sba(s, notes); for (const n of notes) log(s, null, n, 'auto'); s.rev++; return { ok: true };
        }
        case 'block': {
          need();
          const K = s.combat;
          if (!K || K.done || K.n !== s.turn.n) return { ok: false, err: 'Nothing is attacking right now.' };
          if (!K.waiting.includes(pid)) return { ok: false, err: 'Nobody is attacking you.' };
          if (K.ok[pid]) return { ok: false, err: 'You already declared your blockers.' };
          // Attack triggers resolve in the declare attackers step, before blockers are declared (508.2, 509.1).
          if (stackCards(s).length || (s.tq && s.tq.length)) return { ok: false, err: 'Wait — the attack triggers resolve before blockers are declared (508.2).' };
          const C = root.Cards;
          const used = new Set(), pairs = [];
          for (const it of (a.list || []).slice(0, 80)) {
            const b = s.cards[it && it.id], x = K.att[it && it.att], at = s.cards[it && it.att];
            if (!b || b.zone !== 'battlefield' || b.ctrl !== pid || !(b.faceDown || isType(b, 'creature'))) return { ok: false, err: 'Block with untapped creatures you control.' };
            if (b.tapped) return { ok: false, err: `${cardName(b)} is tapped, so it can’t block.` };
            if (used.has(b.id)) return { ok: false, err: `${cardName(b)} can block only one attacker.` };
            if (!x || !at) return { ok: false, err: 'That creature isn’t attacking.' };
            const target = x.def.p || (s.cards[x.def.c] && s.cards[x.def.c].ctrl);
            if (target !== pid) return { ok: false, err: `${cardName(at)} isn’t attacking you.` };
            const why = C.blockProblem(s, b, at);
            if (why) return { ok: false, err: why };
            used.add(b.id); pairs.push([b, at]);
          }
          const count = {}; for (const [, at] of pairs) count[at.id] = (count[at.id] || 0) + 1;
          for (const [id, n] of Object.entries(count)) if (n === 1 && C.keywords(s.cards[id], s).has('menace')) return { ok: false, err: `${cardName(s.cards[id])} has menace — it can’t be blocked except by two or more creatures (702.110b).` };
          for (const [b, at] of pairs) K.att[at.id].blk.push(b.id);
          if (root.Engine) { for (const [b, at] of pairs) root.Engine.emit({ type: 'block', card: b, player: pid, att: at.id }); for (const id of Object.keys(count)) root.Engine.emit({ type: 'blocked', card: s.cards[id], player: s.cards[id].ctrl }); }
          K.ok[pid] = true;
          if (pairs.length) log(s, pid, 'blocked ' + pairs.map(([b, at]) => `${cardName(at)} with ${cardName(b)}`).join(', '));
          else log(s, pid, 'didn’t block');
          if (K.waiting.every(p => K.ok[p] || !live(s, p))) { K.blocked = true; if (!stackTop(s)) startStep(s, notes); }
          remember(); sba(s, notes); for (const n of notes) log(s, null, n, 'auto'); s.rev++; return { ok: true };
        }
        case 'lose': {
          need();
          lose(s, pid, a.why === 'concede' ? 'conceded' : 'drew from an empty library (704.5b)', notes);
          remember(); for (const n of notes) log(s, null, n, 'auto'); s.rev++; return { ok: true };
        }
        case 'unlose': {
          // A mistake (life typed wrong…): put a player back in once their totals are fine again.
          need();
          const P = s.players[a.pid || pid];
          if (!P || !P.lost) return { ok: true };
          if (P.lost.removed) return { ok: false, err: `${P.name}’s cards already left the game.` };
          if (P.life <= 0 || P.poison >= 10 || Object.values(P.cmdDmg || {}).some(v => v >= 21)) return { ok: false, err: `Fix ${P.name}’s life, poison or commander damage first.` };
          delete P.lost;
          if (s.winner && s.seats.filter(p => alive(s, p)).length > 1) s.winner = null;
          return done(`put ${P.name} back in the game`);
        }
        case 'todoAck': {
          need();
          const ids = new Set(a.ids || []);
          s.todo = s.todo || {};
          s.todo[pid] = (s.todo[pid] || []).filter(x => !ids.has(x.id));
          s.rev++; return { ok: true };
        }
        case 'aiSay': {
          // The AI explains what it's doing or answers a question (only an AI seat can speak as the AI).
          need();
          if (!me.ai) return { ok: false, err: 'Only an AI player can do that.' };
          chat(s, { pid, kind: a.kind === 'a' ? 'a' : 'say', text: String(a.text || '').slice(0, 600), why: Array.isArray(a.why) ? a.why.slice(0, 12).map(x => String(x).slice(0, 200)) : undefined, re: typeof a.re === 'string' ? a.re.slice(0, 20) : undefined });
          s.rev++; return { ok: true };
        }
        case 'wardPay': {
          // The caster paid the ward cost (mana tapped by hand, or life).
          need();
          const c = s.cards[a.id];
          if (!c || c.zone !== 'stack' || c.ctrl !== pid || !c.wardDue) return { ok: false, err: 'Nothing to pay ward for.' };
          for (const t of [].concat(...(c.tg || []))) { const w = t.c && s.cards[t.c]; if (w && w.ctrl !== pid && root.Cards.has(w, 'ward', s)) payWard(s, pid, wardCost(w), cardName(w)); }
          c.wardDue = null;
          checkLoss(s, notes); for (const n of notes) log(s, null, n, 'auto');
          return done(`paid the ward cost for ${cardName(c)}`);
        }
        case 'devActive': {
          need();
          if (!a.dev) return { ok: false, err: 'Developer debugging only.' };
          s.turn.active = pid; s.turn.starts = s.turn.starts || {}; s.prio = null;
          return done(`was made the active player (developer debugging)`);
        }
        case 'pool': {
          // Clear your own pool by hand, or add mana a card made ("Add {R}{R}{R}").
          need();
          if (a.clear) { me.pool = []; s.rev++; return { ok: true }; }
          const units = (Array.isArray(a.add) ? a.add : []).map(u => String(u).toUpperCase().replace(/[^WUBRGC]/g, '')).filter(Boolean).slice(0, 20);
          addPool(s, pid, units);
          return done(units.length ? `added ${units.map(u => '{' + (u.length > 1 ? u.split('').join('/') : u) + '}').join('')} to their mana pool` : '');
        }
        case 'demand': {
          // A player points out that someone (usually an AI) owes an effect: sacrifice, discard, draw, mill, lose life, return a permanent.
          need();
          const t = s.players[a.pid];
          if (!t || !alive(s, a.pid)) return { ok: false, err: 'That player isn’t in the game.' };
          const k = String(a.k || ''), n = num(a.n, 1, 20) || 1, what = String(a.what || 'creature').toLowerCase().replace(/[^a-z ]/g, '').slice(0, 40) || 'creature';
          const src = `${me.name}’s reminder`;
          if (k === 'life') { t.life -= n; log(s, pid, `reminded ${t.name} to lose ${n} life — ${t.name} is at ${t.life}`); checkLoss(s, notes); fixUp(s, notes); for (const x of notes) log(s, null, x, 'auto'); s.rev++; return { ok: true }; }
          if (!['sacrifice', 'discard', 'draw', 'mill', 'returnOwn'].includes(k)) return { ok: false, err: 'Pick what they have to do.' };
          todo(s, a.pid, { k, n, what: k === 'sacrifice' || k === 'returnOwn' ? what : undefined, src });
          const verb = { sacrifice: `sacrifice ${n > 1 ? n + ' × ' : 'a '}${what}`, discard: `discard ${n} card${n > 1 ? 's' : ''}`, draw: `draw ${n} card${n > 1 ? 's' : ''}`, mill: `mill ${n} card${n > 1 ? 's' : ''}`, returnOwn: `return ${n > 1 ? n + ' × ' : 'a '}${what} they control to their hand` }[k];
          return done(`reminded ${t.name} to ${verb}`);
        }
        case 'aiAsk': {
          need();
          const to = s.players[a.to];
          if (!to || !to.ai) return { ok: false, err: 'Pick an AI player to ask.' };
          const text = String(a.text || '').trim().slice(0, 300);
          if (!text) return { ok: false, err: 'Type a question.' };
          chat(s, { pid, kind: 'q', to: a.to, text, re: typeof a.re === 'string' ? a.re.slice(0, 20) : undefined });
          s.rev++; return { ok: true };
        }
        case 'aiMeta': {
          need();
          if (!me.ai && a.restore) me.ai = { skill: 'normal', by: String(a.by || '').slice(0, 40) };
          if (!me.ai) return { ok: false, err: 'Only an AI player can do that.' };
          if (['easy', 'normal', 'hard'].includes(a.skill)) me.ai.skill = a.skill;
          // v2: the planning AI answers the table's questions itself (targets, "you may", order…) instead of taking defaults.
          if (a.v === 2) me.ai.v = 2;
          s.rev++; return { ok: true };
        }
        default: return { ok: false, err: 'Unknown action.' };
      }
    } catch (e) {
      return { ok: false, err: e.message || String(e) };
    }
  }

  // 701.19: a regeneration shield replaces being destroyed — tap it, remove all damage, remove it from combat.
  function regenerated(s, c, notes) {
    if (!c || !(c.regen > 0)) return false;
    c.regen--; c.tapped = true; c.dmg = 0; c.dtd = false;
    const K = s.combat;
    if (K && K.att) { delete K.att[c.id]; for (const x of Object.values(K.att)) if (x.blk) x.blk = x.blk.filter(id => id !== c.id); }
    if (notes) notes.push(`${cardName(c)} regenerated (tapped, damage removed, removed from combat)`);
    return true;
  }
  // State-based actions (704.5) the table can check on its own.
  function sba(s, notes) {
    for (let pass = 0; pass < 5; pass++) {
      let changed = false;
      for (const c of Object.values(s.cards)) {
        if (c.zone !== 'battlefield') continue;
        const k = c.counters || {};
        // 704.5q: +1/+1 and -1/-1 counters on the same permanent cancel out.
        if (k['+1/+1'] > 0 && k['-1/-1'] > 0) { const m = Math.min(k['+1/+1'], k['-1/-1']); k['+1/+1'] -= m; k['-1/-1'] -= m; if (!k['+1/+1']) delete k['+1/+1']; if (!k['-1/-1']) delete k['-1/-1']; }
        // 704.5f: a creature with toughness 0 or less goes to its owner's graveyard.
        if (isType(c, 'creature') || c.faceDown) {
          // 704.5g / 704.5h: lethal damage, or any damage from a source with deathtouch, destroys it (unless it's indestructible).
          const ptl = root.Cards ? root.Cards.pt(s, c) : ptOf(c);
          if (ptl && ((c.dmg > 0 && c.dmg >= ptl[1] && ptl[1] > 0) || c.dtd) && !(root.Cards && root.Cards.has(c, 'indestructible', s))) {
            if (shielded(s, c, notes, 'destroy')) { c.dmg = 0; c.dtd = false; changed = true; continue; }
            if (regenerated(s, c, notes)) { changed = true; continue; }
            const nm = cardName(c); moveOne(s, c, 'graveyard', 'top', null, notes);
            notes.push(`${nm} was destroyed (${c.dtd ? 'deathtouch damage' : 'lethal damage'})`); changed = true; continue;
          }
          // 704.5f: toughness 0 or less dies. The table can't see every lasting boost, so it asks the controller.
          const pt = root.Cards ? root.Cards.pt(s, c) : ptOf(c);
          const fpt = face(c);
          const starPT = !c.faceDown && fpt && /\*/.test(String(fpt.tg || ''));
          const zero = !!(pt && pt[1] <= 0) && !starPT;
          if (zero && root.Engine) { const nm = cardName(c); moveOne(s, c, 'graveyard', 'top', null, notes); notes.push(`${nm} had ${pt[1]} toughness and was put into the graveyard (704.5f)`); changed = true; continue; }
          if (zero && !c.zeroT && !c.zeroOk) notes.push(`${cardName(c)} has ${pt[1]} toughness — its controller should put it into the graveyard unless something else is boosting it`);
          c.zeroT = zero;
          if (!zero) c.zeroOk = false;
        }
        // 704.5i: a planeswalker with 0 loyalty goes to the graveyard. 704.5v: same for a battle with 0 defense.
        if (c.loySeen && isType(c, 'planeswalker') && !(k.loyalty > 0)) { const nm = cardName(c); moveOne(s, c, 'graveyard', 'top', null, notes); notes.push(`${nm} had no loyalty left and was put into the graveyard`); changed = true; continue; }
        if (c.defSeen && isType(c, 'battle') && !(k.defense > 0)) { const nm = cardName(c); moveOne(s, c, 'graveyard', 'top', null, notes); notes.push(`${nm} had no defense left and was put into the graveyard`); changed = true; continue; }
        if (k.loyalty > 0) c.loySeen = true;
        if (k.defense > 0) c.defSeen = true;
      }
      if (!changed) break;
    }
    // 704.5j: legend rule — the controller must choose one. We point it out instead of choosing for them.
    const seen = {};
    for (const c of Object.values(s.cards)) {
      if (c.zone !== 'battlefield' || c.faceDown || !/\blegendary\b/i.test(typeLine(c))) continue;
      const key = c.ctrl + '|' + cardName(c);
      (seen[key] = seen[key] || []).push(c);
    }
    s.legend = s.legend || {};
    const now = {};
    for (const [key, list] of Object.entries(seen)) if (list.length > 1) {
      now[key] = true;
      if (!s.legend[key] && !root.Engine) log(s, list[0].ctrl, `controls two copies of the legendary ${cardName(list[0])} — keep one and put the other into the graveyard (legend rule)`, 'alert');
    }
    s.legend = now;
    checkLoss(s, notes);
  }

  // ======================= stack, priority, resolving =======================
  const PI = name => PHASES.indexOf(name);
  // Online, or only just dropped (a reload or a host change takes a few seconds — don't skip them for that).
  const live = (s, p) => { const P = s.players[p]; return !!P && !P.lost && (P.online !== false || Date.now() - (P.offAt || 0) < 9000); };
  const alive = (s, p) => !!(s.players[p] && !s.players[p].lost);
  // 704.5a / 704.5c / 903.10a: a player with 0 or less life, 10 poison counters or 21 damage from one commander loses.
  function checkLoss(s, notes) {
    const losing = [];
    for (const pid of s.seats) {
      const P = s.players[pid];
      if (!P || P.lost) continue;
      if (P.lifeLock && P.life !== P.lifeLock.v) P.life = P.lifeLock.v;   // Teferi's Protection
      let why = null;
      if (P.life <= 0) why = `has ${P.life} life (704.5a)`;
      else if (P.poison >= 10) why = `has ${P.poison} poison counters (704.5c)`;
      else { const cd = !(s.house && s.house.cmdrDmg === false) && Object.entries(P.cmdDmg || {}).find(([, v]) => v >= 21); if (cd) why = `took ${cd[1]} combat damage from ${s.cards[cd[0]] ? cardName(s.cards[cd[0]]) : 'one commander'} (903.10a)`; }
      if (why) losing.push([pid, why]);
    }
    if (!losing.length) return;
    // Everyone who loses at the same moment loses together; if nobody is left, the game is a draw (104.4a).
    const after = s.seats.filter(p => alive(s, p) && !losing.some(([q]) => q === p));
    for (const [pid, why] of losing) lose(s, pid, why, notes, after.length === 0);
  }
  function lose(s, pid, why, notes, drawGame) {
    const P = s.players[pid]; if (!P || P.lost) return;
    const before = s.seats.filter(p => alive(s, p)).length;
    P.lost = { why: String(why).slice(0, 120), t: Date.now(), pending: before > 2 && !drawGame };
    log(s, pid, `lost the game — ${P.lost.why}`, 'alert');
    const left = s.seats.filter(p => alive(s, p));
    if (drawGame && !left.length && !s.winner) { s.winner = 'draw'; log(s, null, 'The game is a draw — everyone left lost at the same time (104.4a).', 'alert'); }
    if (s.seats.length >= 2 && left.length === 1 && !s.winner && !drawGame) { s.winner = left[0]; log(s, left[0], 'wins the game!', 'alert'); }
    if (P.lost.pending && !s.winner) log(s, pid, 'is out — their cards leave the game in 45 seconds unless this was a mistake', 'auto');
    if (s.combat && !s.combat.done) { delete s.combat.ok[pid]; s.combat.waiting = s.combat.waiting.filter(p => p !== pid); for (const [id, x] of Object.entries(s.combat.att)) if (x.def.p === pid) delete s.combat.att[id]; }
    // Their spells and abilities leave the stack (800.4a); priority that was waiting on them moves on.
    if (!s.winner) for (const c of Object.values(s.cards)) if (c.zone === 'stack' && c.ctrl === pid) { if (c.ab || c.token) delete s.cards[c.id]; else moveOne(s, c, 'graveyard', 'top', null, notes); }
    if (s.prio) { if (!s.prio.passed.includes(pid)) s.prio.passed.push(pid); if (!stackTop(s) && !s.prio.step) s.prio = null; }
    if (s.turn.active === pid && left.length >= 1 && !s.winner) { s.prio = null; passTurn(s, pid, notes, () => ({ ok: true })); }
  }
  // 800.4a: when a player leaves a multiplayer game, everything they own leaves too, and what they controlled goes back.
  function removeLoser(s, pid, notes) {
    const P = s.players[pid]; if (!P || !P.lost || !P.lost.pending) return;
    P.lost.pending = false; P.lost.removed = true;
    let n = 0;
    for (const c of Object.values(s.cards)) {
      if (c.owner === pid) { if (c.zone === 'battlefield') leaveBattlefield(s, c, notes); delete s.cards[c.id]; n++; }
      else if (c.ctrl === pid && c.zone === 'battlefield') c.ctrl = c.owner;
    }
    delete s.inbox[pid]; if (s.todo) delete s.todo[pid];
    for (const k of ['monarch', 'initiative']) if (s.table[k] === pid) s.table[k] = s.turn.active && alive(s, s.turn.active) ? s.turn.active : null;
    notes.push(`${P.name}’s cards left the game (${n})`);
  }
  function stackCards(s) { return Object.values(s.cards).filter(c => c.zone === 'stack').sort((a, b) => a.seq - b.seq); }
  function stackTop(s) { const st = stackCards(s); return st[st.length - 1] || null; }
  // Summoning sickness (302.6): it came under this player's control this turn.
  // A creature can attack or use {T} only if its controller has controlled it since their most recent turn began.
  function sick(s, c) {
    if (c.ctlT == null || !s.turn || !s.turn.active) return false;
    const start = s.turn.starts && s.turn.starts[c.ctrl];
    return !(start != null && c.ctlT < start);
  }

  function mulligansPending(s) {
    const T = s.turn; if (!T || !T.active || !T.mulls) return false;
    if ((s.seats || []).every(p => !s.players[p] || s.players[p].lost || s.players[p].kept)) { T.mulls = false; return false; }
    return true;
  }
  function landCheck(s, pid) {
    const T = s.turn;
    if (mulligansPending(s)) return 'Wait until every player has kept their opening hand (103.5).';
    if (T.active !== pid) return 'You can play a land only on your own turn.';
    if (stackCards(s).length) return 'Wait until the stack is empty to play a land.';
    const step = PHASES[T.phase];
    if (step !== 'Main 1' && step !== 'Main 2') {
      if (T.phase < PI('Main 1')) T.phase = PI('Main 1');     // playing a land in upkeep/draw just moves you to your main phase
      else return 'You can play a land only in one of your main phases.';
    }
    // 305.2: one land per turn, plus "you may play an additional land" effects (Aesi, Azusa, Exploration, Explore…).
    if ((T.lands && T.lands[pid] || 0) >= 1 + extraLands(s, pid)) return extraLands(s, pid) ? `You've played all ${1 + extraLands(s, pid)} lands you may play this turn.` : 'You can only play one land per turn. If you need a second land, use the Move to option.';
    return null;
  }
  function extraLands(s, pid) {
    const C = root.Cards; let n = (s.turn.extraLand && s.turn.extraLand[pid]) || 0;
    if (C) for (const c of Object.values(s.cards)) {
      if (c.zone !== 'battlefield' || c.ctrl !== pid || c.faceDown) continue;
      const m = C.text(c).toLowerCase().match(/you may play (an|two|three) additional lands? on each of your turns/);
      if (m) n += { an: 1, two: 2, three: 3 }[m[1]];
    }
    // Rites of Flourishing: "Each player may play an additional land on each of their turns."
    if (C) for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && !c.faceDown && c.d && /each player may play an additional land on each of their turns/i.test(C.text(c))) n += 1;
    return n;
  }
  function cleanTargets(tg, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const list = Array.isArray(tg) && Array.isArray(tg[i]) ? tg[i] : [];
      out.push(list.slice(0, 20).map(t => t && typeof t.c === 'string' ? { c: t.c.slice(0, 50) } : t && typeof t.p === 'string' ? { p: t.p.slice(0, 40) } : null).filter(Boolean));
    }
    return out;
  }
  // Targets chosen while casting must be legal (601.2c).
  function castCheck(s, pid, c, a) {
    const C = root.Cards;
    // Timing (307.1, 301.1): only instants and cards with flash can be cast outside your own main phase with an empty stack.
    const RB = root.Rulebook;
    // 103.5: nothing is cast or played until every player has kept an opening hand.
    if (a && a.cast && mulligansPending(s)) return 'Wait until every player has kept their opening hand (103.5).';
    // Where it's cast from (601.3): the rulebook knows every permission and restriction (flashback, Muldrotha, Grafdigger's Cage…).
    if (RB && a && a.cast && !c.faceDown) { const zone = c.zone && c.zone !== 'limbo' ? c.zone : (a.from || 'hand'); const a2 = Object.assign({}, a, { fromZone: zone }); const err = RB.castBlock(s, pid, Object.assign({}, c, { zone, owner: c.owner || pid, ctrl: pid }), a2); if (err) return err; if (a2.perm && !a.perm) a.perm = a2.perm; }
    if (C && a && a.cast && a.alt !== 'free' && !c.faceDown && !C.instantSpeed(c) && !isType(c, 'land') && !(RB && RB.flash(s, pid, Object.assign({ zone: c.zone && c.zone !== 'limbo' ? c.zone : (a.from || 'hand') }, c)))) {   // cast during an effect (cascade): no timing check (608.2g)
      if (s.turn.active && s.turn.active !== pid) return `${cardName(c)} isn’t an instant and doesn’t have flash, so you can cast it only during your own turn (307.1).`;
      if (s.turn.active && !/^Main/.test(PHASES[s.turn.phase])) return `${cardName(c)} can be cast only in one of your main phases (307.1).`;
      if (stackCards(s).length) return `${cardName(c)} can be cast only while the stack is empty (307.1).`;
    }
    // Additional sacrifice cost (601.2f): it has to be a permanent of that kind you control.
    if (C && a && a.cast && !c.faceDown && C.sacCost && C.sacCost(c)) {
      const want = C.sacCost(c), id = Array.isArray(a.sacCost) ? a.sacCost[0] : null, f = id && s.cards[id];
      if (!f) return `${cardName(c)} needs you to sacrifice ${/^[aeiou]/.test(want) ? 'an' : 'a'} ${want} as you cast it.`;
      if (f.zone !== 'battlefield' || f.ctrl !== pid || !C.matchesWhat(f, want)) return `${cardName(f)} isn’t ${/^[aeiou]/.test(want) ? 'an' : 'a'} ${want} you control.`;
    }
    if (a && a.cast && C && s.turn && s.turn.active) {
      const st = s.turn.stats || {}, n = (st.spells || {})[pid] || 0, nNC = (st.spellsNC || {})[pid] || 0;
      for (const o of Object.values(s.cards)) {
        if (o.zone !== 'battlefield' || o.faceDown || !o.d) continue;
        const t = C.text(o).toLowerCase();
        if (/each player can't cast more than one spell each turn/.test(t) && n >= 1) return `Only one spell each turn (${cardName(o)}).`;
        if (/each player can't cast more than one noncreature spell each turn/.test(t) && nNC >= 1 && !isType(c, 'creature')) return `Only one noncreature spell each turn (${cardName(o)}).`;
      }
    }
    if (a && a.cast && (s.nameLocks || []).some(m => m.owner === pid && m.name === cardName(c))) return `You can’t cast spells named ${cardName(c)} right now (Reflector Mage).`;
    if (!C || !a || !a.tg) return null;
    const reqs = C.targetReqs(c, a.mode, a.alt);
    const tg = cleanTargets(a.tg, reqs.length);
    for (let i = 0; i < reqs.length; i++) {
      for (const t of tg[i]) if (!C.legalTarget(s, reqs[i], t, pid)) return `${t.p ? nameOf(s, t.p) : cardName(s.cards[t.c])} isn’t a legal target for ${cardName(c)} (${reqs[i].text}).`;
      for (const t of tg[i]) if (t.c && C.protectedFrom(s.cards[t.c], c, s)) return `${cardName(s.cards[t.c])} has protection from ${cardName(c)}, so it can’t be targeted by it (702.16b).`;
      if (tg[i].length > reqs[i].n) return `${cardName(c)} can have only ${reqs[i].n} target${reqs[i].n > 1 ? 's' : ''} for “${reqs[i].text}”.`;
      if (!reqs[i].upTo && tg[i].length && tg[i].length < reqs[i].n) return `${cardName(c)} needs exactly ${reqs[i].n} different targets for “${reqs[i].text}” (601.2c).`;
    }
    return null;
  }
  function onCast(s, pid, c, a) {
    const C = root.Cards;
    c.mode = a && a.mode != null ? [].concat(a.mode).map(x => x | 0).slice(0, 5) : null;
    c.x = num(a && a.x, 0, 99) || 0;
    c.reqs = C && !c.faceDown ? C.targetReqs(c, c.mode, a && a.alt) : [];
    c.tg = cleanTargets(a && a.tg, c.reqs.length);
    c.castBy = pid;
    if (root.Rulebook && a && typeof a.perm === 'string') root.Rulebook.use(s, pid, a.perm, c);
    c.alt = a && typeof a.alt === 'string' && /^[a-z-]{3,20}$/.test(a.alt) ? a.alt : null;
    if (C && !c.faceDown && C.sacCost && C.sacCost(c) && a && Array.isArray(a.sacCost) && s.cards[a.sacCost[0]]) {
      const f = s.cards[a.sacCost[0]]; c.sacked = { name: cardName(f), pw: (C.pt(s, f) || [0])[0], mv: +((f.d || {}).cmc) || 0 };
      moveOne(s, f, 'graveyard', 'top', { sac: true }, []); log(s, pid, `sacrificed ${c.sacked.name} to cast ${cardName(c)}`, 'auto');
    }
    // "As an additional cost to cast this spell, discard a card" (Unexpected Windfall): the owner's page discards it (602.2b).
    if (C && !c.faceDown && C.discardCost && C.discardCost(c)) todo(s, pid, { k: 'discard', n: 1, src: cardName(c) + ' (cost)' });
    // "As an additional cost to cast this spell, pay X life" (Toxic Deluge).
    if (C && !c.faceDown && c.x && /as an additional cost to cast this spell, pay x life/i.test(C.text(c)) && s.players[pid]) { s.players[pid].life -= c.x; log(s, pid, `paid ${c.x} life to cast ${cardName(c)}`, 'auto'); }
    if (s.turn && s.turn.active) { const T = s.turn; T.stats = T.stats || { attacked: {}, died: 0, gained: {}, lost: {}, spells: {}, drew: {} }; T.stats.spells[pid] = (T.stats.spells[pid] || 0) + 1; if (!isType(c, 'creature')) { T.stats.spellsNC = T.stats.spellsNC || {}; T.stats.spellsNC[pid] = (T.stats.spellsNC[pid] || 0) + 1; } if (root.Engine) root.Engine.emit({ type: 'cast', player: pid, card: c, nth: T.stats.spells[pid] }); }
    if (C && !c.faceDown) spendPool(s, pid, C.costOf(c), c.x, a && a.fromPool);
    wardFor(s, pid, c, a);
  }
  // Ward (702.21a): a spell or ability targeting an opponent's permanent with ward is countered unless the ward cost is paid.
  function wardFor(s, pid, c, a) {
    const C = root.Cards; if (!c) return;
    c.wardDue = null;
    if (C) for (const t of [].concat(...(c.tg || []))) {
      const w = t.c && s.cards[t.c];
      if (!w || w.ctrl === pid || !C.has(w, 'ward', s)) continue;
      const cost = wardCost(w);
      if (a && a.wardPaid) { payWard(s, pid, cost, cardName(w)); continue; }
      (c.wardDue = c.wardDue || []).push(`${cardName(w)} (ward ${cost.text})`);
    }
  }
  function wardCost(c) { return (root.Cards && root.Cards.wardCost(c)) || { text: 'its cost', mana: 0, life: 0, discard: 0, sac: null }; }
  // Paying ward: life now; a discard or sacrifice is asked of the caster.
  function payWard(s, pid, cost, src) {
    const P = s.players[pid]; if (!P) return;
    if (cost.life) P.life -= cost.life;
    if (cost.discard) todo(s, pid, { k: 'discard', n: cost.discard, src: src + ' (ward)' });
    if (cost.sac) todo(s, pid, { k: 'sacrifice', n: 1, what: cost.sac, src: src + ' (ward)' });
  }
  function targetText(s, c) {
    if (!c || !c.tg || !c.tg.some(l => l.length)) return '';
    const names = [].concat(...c.tg).map(t => t.p ? (t.p === c.ctrl ? 'themselves' : nameOf(s, t.p)) : s.cards[t.c] ? (s.cards[t.c].ctrl !== c.ctrl ? nameOf(s, s.cards[t.c].ctrl) + '’s ' : '') + cardName(s.cards[t.c]) : 'a card');
    return ' targeting ' + listNames(names);
  }

  // Priority (117): after something is cast, each other player in turn order may respond. When everyone has
  // passed in a row, the top of the stack resolves; then the active player gets priority again (117.3b).
  function rotate(s, first) { const i = Math.max(0, s.seats.indexOf(first)); return s.seats.slice(i).concat(s.seats.slice(0, i)); }
  function startPrio(s, by, notes) {
    const top = stackTop(s);
    if (!top) { s.prio = null; return; }
    const order = by ? rotate(s, by).slice(1).concat([by]) : rotate(s, s.turn.active || s.seats[0]);
    s.prio = { order, passed: by ? [by] : [], holder: null, since: Date.now(), top: top.id };
    nextHolder(s, notes);
  }
  function nextHolder(s, notes) {
    for (let guard = 0; guard < 40 && s.prio; guard++) {
      const P = s.prio;
      // Triggered abilities waiting to be put on the stack (their controller is choosing order, targets or modes):
      // nobody gets priority until they're on the stack (117.5, 603.3).
      if (root.Engine && s.tq && s.tq.length) { P.holder = null; return; }
      const cand = P.order.find(p => !P.passed.includes(p) && live(s, p));
      if (cand) { P.holder = cand; P.since = Date.now(); return; }
      if (P.step) { s.prio = null; if (P.step === 'damage' && combatWaiting(s)) combatDamage(s, notes); return; }
      if (root.Engine && root.Engine.hold(s, notes)) return;
      resolveTop(s, notes);
      sba(s, notes);
      if (root.Engine) { root.Engine.check(s, notes); if (s.prio && s.prio !== P) continue; }
      const top = stackTop(s);
      if (!top) { s.prio = null; if (combatWaiting(s)) startStep(s, notes); return; }
      s.prio = { order: rotate(s, s.turn.active || s.seats[0]), passed: [], holder: null, since: Date.now(), top: top.id };
    }
  }
  // Players who left or went offline can't hold up the stack or combat.
  function fixUp(s, notes) {
    // 111.7: tokens that left the battlefield have shown in their new zone for a moment; now they cease to exist.
    for (const c of Object.values(s.cards)) if (c.zone === 'ghost' && Date.now() - (c.ghostAt || 0) > 1500) { delete s.cards[c.id]; notes.push(`${cardName(c)} token ceased to exist`); }
    // Players who lost in a game that goes on: after a short undo window their cards leave the game (800.4a).
    for (const pid of s.seats) { const L = s.players[pid] && s.players[pid].lost; if (L && L.pending && Date.now() - L.t > 45000) removeLoser(s, pid, notes); }
    if (!s.prio && stackTop(s)) startPrio(s, null, notes);
    if (!s.prio && combatWaiting(s)) startStep(s, notes);
    const P = s.prio;
    if (P && !P.step && !stackTop(s)) s.prio = null;
    else if (P && P.holder && !live(s, P.holder)) { if (!P.passed.includes(P.holder)) P.passed.push(P.holder); nextHolder(s, notes); }
    else if (P && !P.step && P.top !== (stackTop(s) || {}).id) { const t = stackTop(s); P.top = t.id; }
    const K = s.combat;
    if (K && !K.done && !K.blocked && K.n === s.turn.n && Object.keys(K.att).length && K.waiting.every(p => K.ok[p] || !live(s, p))) { K.blocked = true; if (!s.prio && !stackTop(s)) startStep(s, notes); }
  }
  // After blockers are declared, players may cast tricks before combat damage (510.1 / 117.3).
  function combatWaiting(s) { const K = s.combat; return !!(K && !K.done && K.blocked && !K.waitAssign && K.n === s.turn.n && !stackTop(s)); }
  function startStep(s, notes) {
    s.prio = { order: rotate(s, s.turn.active || s.seats[0]), passed: [], holder: null, since: Date.now(), top: null, step: 'damage' };
    nextHolder(s, notes);
  }

  function resolveTop(s, notes) {
    const C = root.Cards;
    const c = stackTop(s);
    if (!c) return;
    const by = c.ctrl, nm = cardName(c);
    if (c.wardDue && c.wardDue.length) {
      log(s, null, `${nm} was countered — the ward cost of ${listNames(c.wardDue)} wasn’t paid (702.21a)`, 'auto');
      if (c.ab || c.token) delete s.cards[c.id]; else moveOne(s, c, 'graveyard', 'top', null, notes);
      return;
    }
    if (c.ab && c.ab.eng && root.Engine) { root.Engine.resolve(s, c, notes); return; }
    const reqs = c.reqs || [];
    const tg = c.tg || [];
    const chose = tg.some(l => l && l.length);
    const legal = reqs.map((r, i) => (tg[i] || []).filter(t => C && C.legalTarget(s, r, t, by)));
    // Mutate (702.140b): onto a legal target it merges; if the target is gone, it's just a creature spell.
    let mutFell = false;
    if (c.alt === 'mutate' && !c.ab && reqs[0] && reqs[0].mutate) {
      const t = legal[0] && legal[0][0], host = t && t.c && s.cards[t.c];
      if (host && host.zone === 'battlefield' && root.Engine && root.Engine.mutate) { root.Engine.mutate(s, c, host, notes); return; }
      if (chose) notes.push(`${nm}’s mutate target is gone, so it resolves as an ordinary creature spell (702.140b)`);
      mutFell = true; c.alt = null;
    }
    // 608.2b: if every target is gone or illegal, the spell does nothing and leaves the stack.
    if (C && chose && !mutFell && legal.every(l => !l.length)) {
      notes.push(`${nm} didn’t resolve — its target${[].concat(...tg).length > 1 ? 's are' : ' is'} no longer legal (608.2b)`);
      if (c.ab || c.token) delete s.cards[c.id]; else moveOne(s, c, 'graveyard', 'top', null, notes);
      return;
    }
    const perm = !c.ab && !c.faceDown ? C && C.isPermanentCard(c) : !c.ab;
    let eff = { effects: [], understood: true };
    if (C && !c.faceDown) eff = C.effectsOf(c, c.mode);
    // v6: the new effect engine does spells and activated abilities whenever it understands them (or the old one doesn't).
    const E = root.Engine && !c.faceDown && !perm ? root.Engine.spellOps(s, c) : null;
    if (E && (E.understood || !eff.understood || !eff.effects.length)) {
      if (c.ab) { delete s.cards[c.id]; root.Engine.run(s, Object.assign({}, c, { ab: Object.assign({ ctx: {} }, c.ab) }), E.ops, legal, notes, { mode: c.mode, spell: true }); return; }
      root.Engine.run(s, c, E.ops, legal, notes, { mode: c.mode, spell: true });
      eff = { effects: [1], understood: true };
    } else if (eff.effects.length) applyEffects(s, c, legal, eff.effects, notes);
    if (c.ab) {
      delete s.cards[c.id];
      notes.push(`${c.ab.name}’s ability resolved${eff.understood && eff.effects.length ? '' : ' — apply its effect by hand'}`);
      return;
    }
    if (perm) {
      let aura = reqs[0] && reqs[0].aura && legal[0] && legal[0][0];
      const x = c.x || 0;
      moveOne(s, c, 'battlefield', 'top', { by }, notes);
      if (aura && aura.c && s.cards[aura.c] && s.cards[aura.c].zone !== 'battlefield') { notes.push(`${nm} enchants a card that isn’t on the battlefield — finish its effect by hand`); aura = null; }
      if (aura && s.cards[c.id]) { if (aura.c && s.cards[aura.c]) s.cards[c.id].attachedTo = aura.c; }
      // "This enters with X (or N) +1/+1 counters on it."
      const em = C && s.cards[c.id] && C.text(s.cards[c.id]).match(/this (?:creature )?enters(?: the battlefield)? with (x|a|an|one|two|three|four|five|six|\d+) (\+1\/\+1|-1\/-1|loyalty|charge|oil) counters? on it/i);
      if (em) { const n = /^x$/i.test(em[1]) ? x : C.toNum(em[1]) || 0; const k = em[2].toLowerCase(); if (n > 0) s.cards[c.id].counters[k] = (s.cards[c.id].counters[k] || 0) + n; }
      notes.push(`${nm} resolved and entered the battlefield${aura && aura.c && s.cards[aura.c] ? ' attached to ' + cardName(s.cards[aura.c]) : ''}`);
      const e2 = s.cards[c.id];
      if (e2 && e2.alt) {
        const later = (to, why) => { s.delayed = (s.delayed || []).concat([{ step: 'end', id: e2.id, to, by: e2.owner, src: why, n: s.turn.n, sac: to === 'graveyard' }]); };
        if (e2.alt === 'dash') { e2.grant = ['haste']; later('hand', 'dash'); notes.push(`${nm} was dashed: it has haste and returns to its owner’s hand at the beginning of the next end step (702.109)`); }
        if (e2.alt === 'blitz') { e2.grant = ['haste']; later('graveyard', 'blitz'); notes.push(`${nm} was blitzed: it has haste, “when it dies, draw a card”, and is sacrificed at the beginning of the next end step (702.152)`); }
        if (e2.alt === 'warp') { later('exile', 'warp'); e2.warped = true; notes.push(`${nm} was warped: it’s exiled at the beginning of the next end step, and its owner may cast it from exile later (702.185)`); }
      }
      return;
    }
    if (c.token) { delete s.cards[c.id]; notes.push(`${nm} (a copy) resolved`); return; }
    if (!s.cards[c.id] || s.cards[c.id].zone !== 'stack') { notes.push(`${nm} resolved`); return; }   // it put itself somewhere else (Black Sun's Zenith)
    moveOne(s, c, 'graveyard', 'top', null, notes);
    notes.push(`${nm} resolved${eff.effects.length ? '' : ''}${!eff.understood ? ' — the table can’t do all of its text by itself, so finish it by hand' : ''}`);
  }

  function todo(s, pid, item) {
    s.todo = s.todo || {};
    (s.todo[pid] = s.todo[pid] || []).push(Object.assign({ id: rid(8) }, item));
  }
  function tokenD(e) {
    const what = String(e.what || '').toLowerCase();
    const KNOWN = {
      treasure: { n: 'Treasure', t: 'Token Artifact — Treasure', o: '{T}, Sacrifice this artifact: Add one mana of any color.' },
      food: { n: 'Food', t: 'Token Artifact — Food', o: '{2}, {T}, Sacrifice this artifact: You gain 3 life.' },
      clue: { n: 'Clue', t: 'Token Artifact — Clue', o: '{2}, Sacrifice this artifact: Draw a card.' },
      blood: { n: 'Blood', t: 'Token Artifact — Blood', o: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.' },
      everywhere: { n: 'Everywhere', t: 'Token Land — Plains Island Swamp Mountain Forest', o: '{T}: Add {W}, {U}, {B}, {R}, or {G}.' },
      map: { n: 'Map', t: 'Token Artifact — Map', o: '{1}, {T}, Sacrifice this artifact: Target creature you control explores.' }
    };
    for (const [k, v] of Object.entries(KNOWN)) if (new RegExp('\\b' + k + '\\b').test(what)) return { n: v.n, faces: [{ n: v.n, t: v.t, img: '', p: '', tg: '', mc: '', o: v.o }] };
    const colorsW = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
    const words = what.replace(/,/g, '').split(/\s+/).filter(w => w && !colorsW.includes(w) && w !== 'and' && w !== 'creature' && w !== 'artifact' && w !== 'enchantment' && w !== 'legendary');
    const sub = words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Creature';
    const isCre = /creature/.test(what) || e.p !== '';
    const col = [['white', 'W'], ['blue', 'U'], ['black', 'B'], ['red', 'R'], ['green', 'G']].filter(([w]) => new RegExp('\\b' + w + '\\b').test(what)).map(([, c]) => c);
    const kw = String(e.kws || '').split(/,\s*|\s+and\s+/).map(x => x.trim()).filter(Boolean);
    return { n: sub, col, kw: kw.map(k => k[0].toUpperCase() + k.slice(1)), faces: [{ n: sub, t: 'Token ' + (/artifact/.test(what) ? 'Artifact ' : '') + (isCre ? 'Creature — ' : '— ') + sub, img: '', p: isCre ? String(e.p || '1') : '', tg: isCre ? String(e.t || '1') : '', mc: '', o: kw.join(', ') }] };
  }
  function makeToken(s, pid, d, n, tapped, notes) {
    for (let i = 0; i < Math.min(n, 30); i++) {
      const c = cleanIncoming({ id: pid + '-t' + (++s.seq), d, token: true }, pid);
      s.cards[c.id] = c; c.zone = 'limbo';
      moveOne(s, c, 'battlefield', 'top', { by: pid, tapped }, notes);
    }
  }
  function matchesAll(s, c, what, by) {
    const w = what.toLowerCase();
    if (c.zone !== 'battlefield') return false;
    const kinds = ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'permanent', 'battle'].filter(k => new RegExp('\\b' + k + 's?\\b').test(w));
    const nonM = [...w.matchAll(/\bnon-?([a-z]+)/g)].map(m => m[1].replace(/s$/, ''));
    if (!kinds.length && !nonM.length) return false;
    if (kinds.length && !kinds.some(k => k === 'permanent' || isType(c, k) || (k === 'creature' && c.faceDown))) return false;
    if (nonM.some(k => isType(c, k))) return false;
    if (/you don't control|your opponents control|an opponent controls/.test(w) && c.ctrl === by) return false;
    if (/you control/.test(w) && !/don't control/.test(w) && c.ctrl !== by) return false;
    return true;
  }

  function applyEffects(s, src, legal, effects, notes) {
    const C = root.Cards;
    const by = src.ctrl, srcName = src.ab ? src.ab.name : cardName(src);
    const srcText = src.ab ? String(src.ab.text || '') : (root.Cards && src.d ? root.Cards.text(src) : '');
    const X = src.x || 0;
    const val = n => n === 'X' ? X : (+n || 0);
    const pick = i => (i != null && legal[i]) ? legal[i] : [];
    const tcard = t => t && t.c && s.cards[t.c];
    const label = t => t.p ? nameOf(s, t.p) : (tcard(t) ? cardName(tcard(t)) : 'it');
    const powers = {}, ctrlOf = {};
    for (const l of legal) for (const t of l) if (tcard(t)) { const p = C.pt(s, tcard(t)); powers[t.c] = p ? p[0] : 0; ctrlOf[t.c] = tcard(t).ctrl; }
    let lostThisWay = 0;
    const hurt = (t, n) => {
      if (n <= 0) return;
      if (t.p) { const P = s.players[t.p]; if (!P) return; P.life -= n; lostThisWay += n; alertChecks(s, t.p); return; }
      const c = tcard(t); if (!c || c.zone !== 'battlefield') return;
      if (C.protectedFrom(c, s.cards[src.ab ? src.ab.src : src.id] || src, s)) { notes.push(`${cardName(c)}’s protection prevented ${n} damage`); return; }
      if (isType(c, 'planeswalker') && !isType(c, 'creature')) { c.counters.loyalty = Math.max(0, (c.counters.loyalty || 0) - n); return; }
      if (isType(c, 'battle') && !isType(c, 'creature')) { c.counters.defense = Math.max(0, (c.counters.defense || 0) - n); return; }
      if (shielded(s, c, notes, 'damage')) return;
      c.dmg = (c.dmg || 0) + n;
    };
    for (const e of effects) {
      const T = e.tis ? [].concat(...e.tis.map(pick)) : pick(e.ti);
      switch (e.k) {
        case 'dmg': {
          const n = val(e.n);
          if (e.to === 't') { for (const t of T) { hurt(t, n); notes.push(`${srcName} dealt ${n} damage to ${label(t)}`); } }
          else if (e.to === 'eachOpp') { for (const p of s.seats) if (p !== by) hurt({ p }, n); notes.push(`${srcName} dealt ${n} damage to each opponent`); }
          else if (e.to === 'eachPlayer') { for (const p of s.seats) hurt({ p }, n); notes.push(`${srcName} dealt ${n} damage to each player`); }
          else if (e.to === 'you') { hurt({ p: by }, n); notes.push(`${srcName} dealt ${n} damage to ${nameOf(s, by)}`); }
          else { for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && (c.faceDown || isType(c, 'creature')) && (e.to === 'allCreatures' || c.ctrl !== by)) hurt({ c: c.id }, n); notes.push(`${srcName} dealt ${n} damage to ${e.to === 'allCreatures' ? 'each creature' : 'each creature its controller’s opponents control'}`); }
          break;
        }
        case 'destroy': for (const t of T) { const c = tcard(t); if (!c) continue; if (C.has(c, 'indestructible', s)) { notes.push(`${cardName(c)} is indestructible, so it wasn’t destroyed`); continue; } if (!/can't be regenerated/i.test(srcText || '') && regenerated(s, c, notes)) continue; const nm = cardName(c); moveOne(s, c, 'graveyard', 'top', null, notes); notes.push(`${srcName} destroyed ${nm}`); } break;
        case 'destroyAll': { let n = 0; for (const c of Object.values(s.cards)) if (matchesAll(s, c, e.what, by) && !C.has(c, 'indestructible', s) && (/can't be regenerated/i.test(srcText || '') || !regenerated(s, c, notes))) { moveOne(s, c, 'graveyard', 'top', null, notes); n++; } notes.push(`${srcName} destroyed ${n} permanent${n === 1 ? '' : 's'} (${e.what})`); break; }
        case 'exile': for (const t of T) { const c = tcard(t); if (!c) continue; const nm = cardName(c); moveOne(s, c, 'exile', 'top', null, notes); notes.push(`${srcName} exiled ${nm}`); } break;
        case 'exileAll': { let n = 0; for (const c of Object.values(s.cards)) if (matchesAll(s, c, e.what, by)) { moveOne(s, c, 'exile', 'top', null, notes); n++; } notes.push(`${srcName} exiled ${n} permanent${n === 1 ? '' : 's'}`); break; }
        case 'bounce': for (const t of T) { const c = tcard(t); if (!c) continue; const nm = cardName(c); moveOne(s, c, 'hand', 'top', null, notes); notes.push(`${srcName} returned ${nm} to its owner’s hand`); } break;
        case 'gyToHand': for (const t of T) { const c = tcard(t); if (!c) continue; const nm = cardName(c); moveOne(s, c, 'hand', 'top', null, notes); notes.push(`${srcName} returned ${nm} from the graveyard to its owner’s hand`); } break;
        case 'reanimate': for (const t of T) { const c = tcard(t); if (!c) continue; moveOne(s, c, 'battlefield', 'top', { by, tapped: e.tapped }, notes); notes.push(`${srcName} returned ${cardName(c)} to the battlefield`); } break;
        case 'counter': for (const t of T) { const c = tcard(t); if (!c || c.zone !== 'stack') continue; const nm = cardName(c); if (c.ab || c.token) delete s.cards[c.id]; else moveOne(s, c, 'graveyard', 'top', null, notes); notes.push(`${srcName} countered ${nm}`); } break;
        case 'pump': for (const t of T) { const c = tcard(t); if (!c) continue; const p = /x/.test(e.p) ? Math.sign(parseInt(e.p + '1', 10)) * X : parseInt(e.p, 10), q = /x/.test(e.t) ? Math.sign(parseInt(e.t + '1', 10)) * X : parseInt(e.t, 10); c.mod = [(c.mod ? c.mod[0] : 0) + p, (c.mod ? c.mod[1] : 0) + q]; grant(c, e.kws); notes.push(`${cardName(c)} got ${p >= 0 ? '+' : ''}${p}/${q >= 0 ? '+' : ''}${q} until end of turn`); } break;
        case 'attachSrc': { const eq = src.ab && s.cards[src.ab.src]; const t = T[0] && tcard(T[0]); if (eq && t && eq.zone === 'battlefield' && eq.ctrl === by && t.id !== eq.id) { eq.attachedTo = t.id; notes.push(`${cardName(eq)} is now attached to ${cardName(t)}`); } break; }
        case 'grant': for (const t of T) { const c = tcard(t); if (!c) continue; grant(c, e.kws); notes.push(`${cardName(c)} gained ${e.kws} until end of turn`); } break;
        case 'pumpAll': { const p = parseInt(e.p, 10), q = parseInt(e.t, 10); for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && c.ctrl === by && (c.faceDown || isType(c, 'creature'))) { c.mod = [(c.mod ? c.mod[0] : 0) + p, (c.mod ? c.mod[1] : 0) + q]; grant(c, e.kws); } notes.push(`creatures ${nameOf(s, by)} controls got ${e.p}/${e.t} until end of turn`); break; }
        case 'grantAll': { for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && c.ctrl === by) grant(c, e.kws); notes.push(`${nameOf(s, by)}’s permanents gained ${e.kws} until end of turn`); break; }
        case 'counters': { const n = val(e.n); const list = e.each ? Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === by && isType(c, 'creature')) : T.map(tcard).filter(Boolean); for (const c of list) c.counters['+1/+1'] = (c.counters['+1/+1'] || 0) + n; notes.push(`${srcName} put ${n} +1/+1 counter${n > 1 ? 's' : ''} on ${list.map(cardName).join(', ') || 'nothing'}`); break; }
        case 'tap': for (const t of T) { const c = tcard(t); if (c) { c.tapped = true; notes.push(`${srcName} tapped ${cardName(c)}`); } } break;
        case 'untap': for (const t of T) { const c = tcard(t); if (c) { c.tapped = false; c.manaAt = null; notes.push(`${srcName} untapped ${cardName(c)}`); } } break;
        case 'tapAllOpp': for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && c.ctrl !== by && isType(c, 'creature')) c.tapped = true; notes.push(`${srcName} tapped all creatures ${nameOf(s, by)}’s opponents control`); break;
        case 'bite': case 'fight': {
          const a = tcard(pick(e.ti)[0]), b = pick(e.ti2)[0];
          if (!a || !b) { notes.push(`${srcName} did nothing — one of its creatures is gone`); break; }
          const pa = C.pt(s, a) ? C.pt(s, a)[0] : 0;
          hurt(b, pa); if (tcard(b) && C.has(a, 'deathtouch', s)) tcard(b).dtd = true;
          if (e.k === 'fight' && tcard(b)) { const pb = C.pt(s, tcard(b)) ? C.pt(s, tcard(b))[0] : 0; hurt({ c: a.id }, pb); if (C.has(tcard(b), 'deathtouch', s)) a.dtd = true; }
          notes.push(e.k === 'fight' ? `${cardName(a)} fought ${label(b)}` : `${cardName(a)} dealt ${pa} damage to ${label(b)}`);
          break;
        }
        case 'token': {
          const ft = e.forTargetCtrl != null ? pick(e.forTargetCtrl)[0] : null;
          const owner2 = ft ? (ft.p || ctrlOf[ft.c] || by) : by;
          const n = e.n === 'X' ? X : (e.n || 1);
          const d = tokenD(e);
          makeToken(s, s.players[owner2] ? owner2 : by, d, n, e.tapped, notes);
          notes.push(`${nameOf(s, s.players[owner2] ? owner2 : by)} created ${n > 1 ? n + ' ' : 'a '}${d.n} token${n > 1 ? 's' : ''}`);
          break;
        }
        case 'draw': {
          const n = val(e.n);
          const who = e.who === 'you' ? [by] : e.who === 'each' ? s.seats.slice() : T.filter(t => t.p).map(t => t.p);
          for (const p of who) { todo(s, p, { k: 'draw', n, src: srcName }); }
          notes.push(`${who.map(p => nameOf(s, p)).join(', ')} draw${who.length === 1 ? 's' : ''} ${n} card${n === 1 ? '' : 's'} (${srcName})`);
          break;
        }
        case 'life': {
          const n = e.n === 'LOST' ? lostThisWay : val(e.n);
          const who = e.who === 'you' ? [by] : e.who === 'each opponent' ? s.seats.filter(p => p !== by) : e.who === 'each player' ? s.seats.slice() : T.filter(t => t.p).map(t => t.p);
          for (const p of who) { if (e.sign > 0) gainLife(s, p, n); else s.players[p].life -= n; if (e.sign < 0) lostThisWay += n; alertChecks(s, p); }
          if (who.length) notes.push(`${who.map(p => nameOf(s, p)).join(', ')} ${e.sign > 0 ? 'gained' : 'lost'} ${n} life (${srcName})`);
          break;
        }
        case 'lifeEqPow': for (const t of T) { const who = ctrlOf[t.c]; const pw = powers[t.c] || 0; if (pw > 0 && who && s.players[who]) { gainLife(s, who, pw); notes.push(`${nameOf(s, who)} gained ${pw} life`); } } break;
        case 'fetchCtrl': for (const t of T) { const who = ctrlOf[t.c]; if (who && s.players[who]) { todo(s, who, { k: 'fetch', n: 1, dest: 'battlefield', tapped: e.tapped, optional: true, src: srcName }); notes.push(`${nameOf(s, who)} may search for a basic land (${srcName})`); } } break;
        case 'fetch': todo(s, by, { k: 'fetch', n: e.n, dest: e.dest, tapped: e.tapped, split: e.split, src: srcName }); notes.push(`${nameOf(s, by)} searches for ${e.n === 1 ? 'a basic land' : e.n + ' basic lands'} (${srcName})`); break;
        case 'scry': todo(s, by, { k: 'scry', n: val(e.n), src: srcName }); break;
        case 'mill': { const who = e.who === 'target player' ? T.filter(t => t.p).map(t => t.p) : e.who === 'each opponent' ? s.seats.filter(p => p !== by) : s.seats.slice(); for (const p of who) todo(s, p, { k: 'mill', n: val(e.n), src: srcName }); break; }
        case 'discard': { const who = e.who === 'each opponent' ? s.seats.filter(p => p !== by && alive(s, p)) : e.who === 'each player' ? s.seats.filter(p => alive(s, p)) : T.filter(t => t.p).map(t => t.p); for (const p of who) todo(s, p, { k: 'discard', n: val(e.n), src: srcName }); if (who.length) notes.push(`${who.map(p => nameOf(s, p)).join(', ')} must discard ${val(e.n)} (${srcName})`); break; }
        case 'addMana': { addPool(s, by, e.units || []); notes.push(`${nameOf(s, by)} added ${(e.units || []).map(u => '{' + (u.length > 1 ? 'any' : u) + '}').join('')} to their mana pool (${srcName})`); break; }
        case 'surveil': todo(s, by, { k: 'surveil', n: val(e.n), src: srcName }); break;
        case 'exileGy': for (const t of T) if (t.p) { let n = 0; for (const c of Object.values(s.cards)) if (c.zone === 'graveyard' && c.owner === t.p) { moveOne(s, c, 'exile', 'top', null, notes); n++; } notes.push(`${srcName} exiled ${n} card${n === 1 ? '' : 's'} from ${nameOf(s, t.p)}’s graveyard`); } break;
        case 'sacUnless': todo(s, by, { k: 'sacUnless', n: val(e.n), what: e.what, srcId: src.ab ? src.ab.src : src.id, src: srcName }); notes.push(`${nameOf(s, by)} sacrifices ${e.what === 'land' ? 'a land' : e.what} or ${srcName} (${srcName})`); break;
        case 'returnOwn': { todo(s, by, { k: 'returnOwn', n: val(e.n), what: e.what, src: srcName }); notes.push(`${nameOf(s, by)} returns ${e.what === 'land' ? 'a land' : e.what} they control to their hand (${srcName})`); break; }
        case 'sacrifice': { const who = e.who === 'each opponent' || e.who === 'each other player' ? s.seats.filter(p => p !== by && alive(s, p)) : e.who === 'each player' ? s.seats.filter(p => alive(s, p)) : T.filter(t => t.p).map(t => t.p); for (const p of who) todo(s, p, { k: 'sacrifice', n: val(e.n), what: e.what, src: srcName }); if (who.length) notes.push(`${who.map(p => nameOf(s, p)).join(', ')} must sacrifice ${e.what} (${srcName})`); break; }
      }
    }
    for (const p of s.seats) alertChecks(s, p);
  }
  function grant(c, kws) {
    const list = String(kws || '').toLowerCase().split(/,\s*|\s+and\s+/).map(x => x.trim()).filter(x => root.Cards && root.Cards.KEYWORDS.includes(x));
    if (list.length) c.grant = [...new Set((c.grant || []).concat(list))];
  }

  // ======================= combat damage (510) =======================
  // Toxic N, printed or granted ("Other Rats you control have toxic 1"); several instances add up (702.164c).
  function toxicOf(s, c) {
    const C = root.Cards; if (!C || c.faceDown) return 0;
    let n = 0;
    for (const m of C.text(c).matchAll(/(?:^|\n|, )toxic (\d+)/gi)) n += +m[1];
    for (const o of Object.values(s.cards)) {
      if (o.zone !== 'battlefield' || o.ctrl !== c.ctrl || o.faceDown || !o.d) continue;
      const m = C.text(o).match(/(other )?([a-z ]+?)s? you control have toxic (\d+)/i);
      if (m && !(m[1] && o.id === c.id) && C.matchesWhat(c, m[2].replace(/s$/, ''))) n += +m[3];
    }
    return n;
  }
  function combatDamage(s, notes) {
    const C = root.Cards, K = s.combat;
    if (!K || K.done) return;
    // 510.1c-d: an attacker blocked by two or more creatures — its controller divides its damage among them. Ask first.
    if (root.Engine) {
      K.assign = K.assign || {};
      const need = Object.entries(K.att).filter(([id, x]) => s.cards[id] && s.cards[id].zone === 'battlefield' && (x.blk || []).filter(b => s.cards[b] && s.cards[b].zone === 'battlefield').length >= 2 && !K.assign[id]);
      let waiting = false;
      for (const [id, x] of need) {
        const a = s.cards[id], who = a.ctrl;
        if (s.players[who] && s.players[who].ai || !live(s, who) || !((C.pt(s, a) || [0])[0] > 0)) { K.assign[id] = 'auto'; continue; }
        if (!(s.ask || []).some(q => q.kind === 'assign' && q.att === id)) {
          const pw = Math.max(0, (C.pt(s, a) || [0])[0]);
          s.ask = (s.ask || []).concat([{ id: 'a' + (++s.seq), kind: 'assign', pid: who, att: id, name: cardName(a), power: pw, trample: C.keywords(a, s).has('trample'), deathtouch: C.keywords(a, s).has('deathtouch'),
            blockers: x.blk.filter(b => s.cards[b] && s.cards[b].zone === 'battlefield').map(b => ({ id: b, name: cardName(s.cards[b]), lethal: Math.max(0, ((C.pt(s, s.cards[b]) || [0, 0])[1]) - (s.cards[b].dmg || 0)) })), since: Date.now() }]);
        }
        waiting = true;
      }
      if (waiting) { K.waitAssign = true; return; }
      K.waitAssign = false;
    }
    K.done = true;
    s.turn.phase = PI('Combat damage');
    const kwOf = c => C.keywords(c, s);
    const alive = id => s.cards[id] && s.cards[id].zone === 'battlefield' ? s.cards[id] : null;
    const firstish = c => { const k = kwOf(c); return k.has('first strike') || k.has('double strike'); };
    const inCombat = Object.entries(K.att).flatMap(([id, x]) => [id].concat(x.blk || [])).map(alive).filter(Boolean);
    const twoSteps = inCombat.some(firstish);
    const dealt = new Set();
    const summary = [];
    const step = first => {
      const ev = [];
      const deals = c => { const k = kwOf(c); return first ? (k.has('first strike') || k.has('double strike')) : (!twoSteps || k.has('double strike') || !k.has('first strike')); };
      for (const [id, x] of Object.entries(K.att)) {
        const a = alive(id); if (!a) continue;
        const blockers = (x.blk || []).map(alive).filter(Boolean);
        if (deals(a)) {
          const ka = kwOf(a);
          let power = Math.max(0, (C.pt(s, a) || [0])[0]);
          const toDef = n => { if (n <= 0) return; if (x.def.p) ev.push({ src: a, p: x.def.p, n }); else if (alive(x.def.c)) ev.push({ src: a, c: x.def.c, n }); };
          const plan = K.assign && K.assign[id] && K.assign[id] !== 'auto' ? K.assign[id] : null;
          if ((x.blk || []).length && plan && blockers.length) {
            // The attacking player's own division of damage (510.1c).
            let left = power;
            for (const b of blockers) { const give = Math.max(0, Math.min(left, plan[b.id] | 0)); if (give > 0) ev.push({ src: a, c: b.id, n: give }); left -= give; }
            if (left > 0) { if (ka.has('trample') && plan.player) toDef(left); else if (blockers.length) ev.push({ src: a, c: blockers[blockers.length - 1].id, n: left }); }
          } else if ((x.blk || []).length) {
            if (!blockers.length) { if (ka.has('trample')) toDef(power); }
            else {
              blockers.forEach((b, i) => {
                if (power <= 0) return;
                const bt = (C.pt(s, b) || [0, 0])[1];
                const lethal = ka.has('deathtouch') ? 1 : Math.max(0, bt - (b.dmg || 0));
                const last = i === blockers.length - 1;
                const give = last && !ka.has('trample') ? power : Math.min(power, Math.max(lethal, 0));
                if (give > 0) ev.push({ src: a, c: b.id, n: give });
                power -= give;
              });
              if (power > 0 && ka.has('trample')) toDef(power);
            }
          } else toDef(power);
        }
        for (const b of blockers) if (deals(b)) { const pw = Math.max(0, (C.pt(s, b) || [0])[0]); if (pw > 0) ev.push({ src: b, c: a.id, n: pw }); }
      }
      // All combat damage in a step happens at once (510.2).
      // Fogs (615.1): combat damage prevented this turn.
      const T0 = s.turn, fog = T0.fog && T0.fog.n === T0.n ? T0.fog : null;
      const prevented = e => (fog && (!fog.non || !isType(e.src, fog.non))) || e.src.fogBy === T0.n || (e.c && s.cards[e.c] && s.cards[e.c].fogTo === T0.n);
      for (const e of ev) {
        const k = kwOf(e.src);
        if (prevented(e)) { summary.push(`${e.n} combat damage from ${cardName(e.src)} was prevented`); continue; }
        if (e.c && s.cards[e.c] && C.protectedFrom(s.cards[e.c], e.src, s)) { summary.push(`${cardName(s.cards[e.c])}’s protection prevented ${e.n} damage from ${cardName(e.src)}`); continue; }
        dealt.add(e.src.id);
        if (e.p) {
          const P = s.players[e.p]; if (!P) continue;
          if (k.has('infect')) P.poison += e.n; else P.life -= e.n;
          // Toxic N (702.164): combat damage to a player also gives them N poison counters.
          { const tx = toxicOf(s, e.src); if (tx) { P.poison += tx; summary.push(`${nameOf(s, e.p)} got ${tx} poison counter${tx > 1 ? 's' : ''} (toxic)`); } }
          if (e.src.cmdr) P.cmdDmg[e.src.id] = (P.cmdDmg[e.src.id] || 0) + e.n;
          else if (e.src.mutCmdr) P.cmdDmg[e.src.mutCmdr] = (P.cmdDmg[e.src.mutCmdr] || 0) + e.n;   // a commander under a mutated pile (903.3)
          if (root.Engine) root.Engine.emit({ type: 'combatDamage', card: e.src, to: 'player', player: e.p, n: e.n });
          summary.push(`${cardName(e.src)} dealt ${e.n} ${k.has('infect') ? 'poison ' : ''}damage to ${nameOf(s, e.p)}`);
        } else {
          const t = s.cards[e.c]; if (!t) continue;
          if (!(isType(t, 'planeswalker') && !isType(t, 'creature')) && shielded(s, t, summary, 'damage')) continue;
          if (isType(t, 'planeswalker') && !isType(t, 'creature')) { t.counters.loyalty = Math.max(0, (t.counters.loyalty || 0) - e.n); summary.push(`${cardName(e.src)} dealt ${e.n} damage to ${cardName(t)}`); }
          else if (isType(t, 'battle') && !isType(t, 'creature')) { t.counters.defense = Math.max(0, (t.counters.defense || 0) - e.n); }
          else if (k.has('infect') || k.has('wither')) { t.counters['-1/-1'] = (t.counters['-1/-1'] || 0) + e.n; if (k.has('deathtouch')) t.dtd = true; summary.push(`${cardName(e.src)} put ${e.n} −1/−1 counter${e.n > 1 ? 's' : ''} on ${cardName(t)}`); }
          else { t.dmg = (t.dmg || 0) + e.n; if (k.has('deathtouch')) t.dtd = true; summary.push(`${cardName(e.src)} dealt ${e.n} damage to ${cardName(t)}`); }
          if (root.Engine) root.Engine.emit({ type: 'combatDamage', card: e.src, to: 'creature', target: t.id, player: e.src.ctrl, n: e.n });
        }
        if (k.has('lifelink') && s.players[e.src.ctrl]) gainLife(s, e.src.ctrl, e.n);
      }
      for (const p of s.seats) alertChecks(s, p);
      // The damage line first, then what died from it (state-based actions, 704.3).
      if (summary.length) { for (const n of notes.splice(0)) log(s, null, n, 'auto'); log(s, null, (first ? 'First-strike damage: ' : 'Combat: ') + summary.join('; '), 'auto'); anyDmg = true; summary.length = 0; }
      sba(s, notes);
    };
    let anyDmg = false;
    if (twoSteps) step(true);
    step(false);
    if (!anyDmg) notes.push('Combat: no damage was dealt');
    // After combat damage the turn moves on by itself: end of combat (triggers), then main phase 2.
    if (root.Engine) s.turn.goal = 'main2'; else s.turn.phase = PI('Main 2');
  }

  function chat(s, m) {
    s.aichat = s.aichat || [];
    s.aichat.push(Object.assign({ id: rid(6), t: Date.now(), name: m.pid && s.players[m.pid] ? s.players[m.pid].name : undefined, toName: m.to && s.players[m.to] ? s.players[m.to].name : undefined }, m));
    if (s.aichat.length > 160) s.aichat.splice(0, s.aichat.length - 160);
  }

  function clearMods(s) { for (const c of Object.values(s.cards)) c.mod = null; } // 514.2: "until end of turn" ends

  function passTurn(s, pid, notes, done) {
    const T = s.turn;
    if (stackCards(s).length && alive(s, T.active)) return { ok: false, err: 'Wait until everything on the stack has resolved.' };
    clearMods(s);
    if (root.Engine) root.Engine.endOfTurn(s);
    // 514.2: damage wears off and "until end of turn" effects end.
    for (const c of Object.values(s.cards)) { c.dmg = 0; c.dtd = false; c.grant = null; }
    s.combat = null; s.prio = null; T.lands = {};
    const idx = s.seats.indexOf(T.active);
    let next = s.seats[(idx + 1) % s.seats.length];
    for (let k = 2; k <= s.seats.length && !alive(s, next); k++) next = s.seats[(idx + k) % s.seats.length];
    // 500.7: extra turns — the most recently created one is taken first.
    while (s.extraTurns && s.extraTurns.length) { const e = s.extraTurns.pop(); if (alive(s, e)) { next = e; log(s, e, 'takes an extra turn', 'alert'); break; } }
    T.active = next; T.n++; T.phase = 0;
    // 502.1: phased-out permanents of the active player phase in; "until your next turn" protection ends (Teferi's Protection).
    for (const c of Object.values(s.cards)) if (c.zone === 'phased' && c.phasedBy === next) { c.zone = 'battlefield'; c.phasedBy = null; }
    if (s.players[next]) { s.players[next].lifeLock = null; s.players[next].protAll = false; }
    // 502.3: the active player untaps their permanents during the untap step.
    let n = 0;
    for (const c of Object.values(s.cards)) {
      if (c.zone === 'battlefield' && c.ctrl === next && !c.tapped && c.skipUntap) c.skipUntap = false;
      if (c.zone !== 'battlefield' || c.ctrl !== next || !c.tapped) continue;
      if (c.noUntap) { log(s, next, `${cardName(c)} doesn't untap`, 'auto'); continue; }
      if (c.skipUntap) { c.skipUntap = false; log(s, next, `${cardName(c)} doesn't untap this time`, 'auto'); continue; }
      if (root.Cards && /(?:^|\n)this doesn't untap during your untap step/i.test(root.Cards.text(c))) continue;   // Basalt Monolith, Mana Vault
      if (root.Cards && (c.faceDown || isType(c, 'creature')) && !root.Cards.has(c, 'flying', s) && Object.values(s.cards).some(o => o.zone === 'battlefield' && !o.faceDown && o.d && /creatures without flying don't untap during their controllers' untap steps/i.test(root.Cards.text(o)))) continue;   // Mudslide
      // 122.1d: instead of untapping, remove a stun counter.
      if (c.counters && c.counters.stun) { c.counters.stun--; if (!c.counters.stun) delete c.counters.stun; log(s, next, `removed a stun counter from ${cardName(c)} instead of untapping it`, 'auto'); continue; }
      c.tapped = false; n++;
    }
    // Seedborn Muse: "Untap all permanents you control during each other player's untap step."
    if (root.Cards) for (const m of Object.values(s.cards)) if (m.zone === 'battlefield' && m.ctrl !== next && !m.faceDown && m.d && /untap all permanents you control during each other player's untap step/i.test(root.Cards.text(m))) for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && c.ctrl === m.ctrl && c.tapped && !c.noUntap) c.tapped = false;
    T.starts = T.starts || {}; T.starts[next] = T.n;
    T.phase = 1; // untap step has no priority, move straight to upkeep
    T.goal = 'main1'; // upkeep → draw → main 1 by themselves unless something triggers
    if (root.Engine) root.Engine.turnBegins(s, next);
    log(s, pid, `passed the turn to ${nameOf(s, next)}`);
    if (n) log(s, next, `untapped ${n} permanent${n > 1 ? 's' : ''}`, 'auto');
    for (const x of notes) log(s, pid, x, 'auto');
    s.rev++;
    return { ok: true };
  }

  function listNames(names) {
    if (names.length <= 1) return names[0] || 'nothing';
    if (names.length > 6) {
      const counts = {}; names.forEach(n => counts[n] = (counts[n] || 0) + 1);
      return Object.entries(counts).map(([n, c]) => c > 1 ? `${c}× ${n}` : n).join(', ');
    }
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  // Power/toughness with counters and until-end-of-turn changes.
  function ptOf(c) {
    let p, t;
    if (c.faceDown) { p = 2; t = 2; } // 708.2a: a face-down permanent is a 2/2 before counters and effects
    else {
      const f = face(c);
      if (!f || f.p === '' || f.tg === '') return null;
      p = parseInt(f.p, 10); t = parseInt(f.tg, 10);
      if (isNaN(p) || isNaN(t)) return null;
    }
    const k = c.counters || {};
    p += (k['+1/+1'] || 0) - (k['-1/-1'] || 0); t += (k['+1/+1'] || 0) - (k['-1/-1'] || 0);
    if (c.mod) { p += c.mod[0]; t += c.mod[1]; }
    return [p, t];
  }

  const _int = { moveOne, makeToken, tokenD, todo, log, cardName, nameOf, stackCards, stackTop, startPrio, nextHolder: (s, n) => nextHolder(s, n), PHASES, PI: n => PHASES.indexOf(n),
    gainLife: (s, p, n) => gainLife(s, p, n), regenerated: (s, c, n) => regenerated(s, c, n), isType, typeLine, alive: (s, p) => alive(s, p), live: (s, p) => live(s, p), addPool, unitsOf, passTurn, sba, alertChecks, rotate, face, rowFor, listNames,
    clearMods, cleanTargets, wardFor, targetText, sick, combatDamage: (s, n) => combatDamage(s, n), shielded: (s, c, n, w) => shielded(s, c, n, w), cmdrHuman: (s, p) => cmdrHuman(s, p) };
  root.Rules = { _int, PHASES, ROWS, PUBLIC_ZONES, KEYWORD_COUNTERS, SUGGESTED_COUNTERS, MAX_SEATS, START_LIFE,
    newState, apply, canAct, zoneCards, cardName, typeLine, isType, face, rowFor, ptOf, rid, listNames, nameOf,
    stackCards, stackTop, sick, alive, shielded: (s, c, notes, what) => shielded(s, c, notes, what), fixUp: (s) => { const key = () => JSON.stringify([s.prio && [s.prio.holder, s.prio.top, s.prio.passed.length], s.combat && s.combat.done, stackCards(s).length, (s.ask || []).length, (s.tq || []).length, s.turn && [s.turn.phase, s.turn.n]]); const before = key(); const notes = []; if (root.Engine && s.turn && s.turn.active) { root.Engine.begin(s); try { root.Engine.timeouts(s, notes); } catch (e) {} } fixUp(s, notes); if (root.Engine && s.turn && s.turn.active) { try { root.Engine.after(s, notes); } catch (e) { if (typeof console !== 'undefined') console.error(e); } } for (const n of notes) log(s, null, n, 'auto'); return notes.length > 0 || key() !== before; }, landCheck: (s, pid) => landCheck(JSON.parse(JSON.stringify(s)), pid), extraLands: (s, pid) => extraLands(s, pid), PI };
})(typeof window !== 'undefined' ? window : globalThis);
// Node (tests, simulations): the rulebook comes along with the rules.
if (typeof module !== 'undefined' && typeof require === 'function' && !globalThis.Rulebook) { try { require('./rulebook.js'); } catch (e) { /* the page loads it with a script tag */ } }
