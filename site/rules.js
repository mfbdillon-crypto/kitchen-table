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
  function isType(c, word) { return new RegExp('\\b' + word + '\\b', 'i').test(typeLine(c)); }
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
        p: str(f.p, 8), tg: str(f.tg, 8), loy: str(f.loy, 8), def: str(f.def, 8), mc: str(f.mc, 60)
      }))
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
    c.loySeen = false; c.defSeen = false; c.noUntap = false; c.zeroT = false; c.zeroOk = false;
    c.counters = {}; c.tapped = false; c.mod = null; c.attachedTo = null; c.ctrl = c.owner; c.row = null;
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

  function moveOne(s, c, to, pos, opts, notes) {
    opts = opts || {};
    const from = c.zone;
    if (from === 'battlefield' && to !== 'battlefield') leaveBattlefield(s, c, notes);

    // 111.7 / 111.8: a token that leaves the battlefield ceases to exist.
    if (c.token && from === 'battlefield' && to !== 'battlefield') {
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
      if (opts.by) c.ctrl = opts.by; // whoever puts it onto the battlefield controls it (110.2a)
      c.tapped = !!opts.tapped;
      c.faceDown = keepDown;
      if (from === 'limbo' && opts.backFace) c.face = 1;
      enterBattlefield(s, c);
    }
    if ((to === 'exile' || to === 'stack') && keepDown && !c.faceDown) { c.faceDown = true; c.d = null; }
    if (opts.row && ROWS.includes(opts.row) && to === 'battlefield') c.row = opts.row;
    if (pos === 'bottom') {
      const min = Math.min(0, ...zoneCards(s, to, c.owner, 'owner').map(x => x.seq));
      c.seq = min - 1;
    } else c.seq = ++s.seq;
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
  function apply(s, pid, a) {
    if (!a || typeof a !== 'object') return { ok: false, err: 'bad action' };
    const me = s.players[pid];
    const need = () => { if (!me) throw new Error('Take a seat first.'); };
    const notes = [];
    // An action resent after a slow or lost reply must not happen twice.
    const aid = typeof a.aid === 'string' ? a.aid.slice(0, 40) : null;
    if (aid && s.done && s.done[pid] && s.done[pid].includes(aid)) return { ok: true, dup: true };
    const remember = () => { if (!aid) return; s.done = s.done || {}; const l = s.done[pid] = s.done[pid] || []; l.push(aid); if (l.length > 60) l.splice(0, l.length - 60); };
    const done = msg => { remember(); if (msg) log(s, pid, msg); sba(s, notes); for (const n of notes) log(s, pid, n, 'auto'); s.rev++; return { ok: true }; };
    try {
      switch (a.type) {
        case 'join': {
          if (!me) {
            if (s.seats.length >= MAX_SEATS) return { ok: false, err: 'The table is full (6 players).' };
            s.players[pid] = newPlayer(a.name);
            s.seats.push(pid);
            return done('sat down at the table');
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
          delete s.players[pid]; delete s.inbox[pid];
          s.seats = s.seats.filter(x => x !== pid);
          const wasActive = s.turn.active === pid;
          if (wasActive) { s.turn.active = nextSeat; s.turn.phase = 1; s.turn.n++; }
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
          if (t.online && a.pid !== pid) return { ok: false, err: 'You can only remove a player who is offline.' };
          return apply(s, a.pid, { type: 'leave' });
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
          for (const raw of list) {
            const c = cleanIncoming(raw, pid);
            if (!c) continue;
            if (s.cards[c.id]) return { ok: false, err: 'That card is already in play.' };
            s.cards[c.id] = c;
            c.zone = 'limbo';
            moveOne(s, c, to, a.pos, { by: pid, tapped: a.tapped, faceDown: c.faceDown, row: a.row, backFace: c.face === 1 }, notes);
            names.push(cardName(c));
          }
          // a.msg is a phrase like "cast {cards}"; the host fills in the card names (face-down cards stay hidden).
          const tmpl = typeof a.msg === 'string' && a.msg.includes('{cards}') ? a.msg.slice(0, 160)
            : `put {cards} ${to === 'battlefield' ? 'onto' : 'into'} ${ZONE_WORDS[to]}`;
          return done(a.quiet ? '' : tmpl.replace('{cards}', listNames(names)));
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
            const steal = (c.zone === 'graveyard' || c.zone === 'exile') && (to === 'battlefield' || to === 'stack') && c.owner !== pid;
            if (!canAct(s, pid, c) && !steal) return { ok: false, err: `You don't control ${cardName(c)}.` };
            if (c.zone === to && to !== 'battlefield') continue;
            froms.add(c.zone);
            const nm = cardName(c);
            const ownerName = c.owner !== pid ? nameOf(s, c.owner) + '’s ' : '';
            moveOne(s, c, to, a.pos, { by: pid, tapped: a.tapped, faceDown: a.faceDown, row: a.row }, notes);
            names.push(ownerName + nm);
          }
          if (!names.length) return { ok: true };
          const where = to === 'library'
            ? (a.pos === 'bottom' ? 'on the bottom of its owner’s library' : a.pos === 'shuffle' ? 'into its owner’s library and it was shuffled' : 'on top of its owner’s library')
            : to === 'hand' ? 'into its owner’s hand' : (to === 'battlefield' ? 'onto ' : 'into ') + ZONE_WORDS[to];
          const fromTxt = froms.size === 1 ? ` from ${ZONE_WORDS[[...froms][0]]}` : '';
          return done(`moved ${listNames(names)}${fromTxt} ${where}`);
        }
        case 'tap': {
          need();
          const ids = (a.ids || []).slice(0, 300);
          let changed = 0;
          for (const id of ids) {
            const c = s.cards[id];
            if (!c || c.zone !== 'battlefield') continue;
            if (c.ctrl !== pid) return { ok: false, err: `You don't control ${cardName(c)}.` };
            if (c.tapped !== !!a.tapped) { c.tapped = !!a.tapped; changed++; }
          }
          if (!changed) return { ok: true };
          const one = ids.length === 1 ? cardName(s.cards[ids[0]]) : null;
          return done(a.quiet ? '' : one ? `${a.tapped ? 'tapped' : 'untapped'} ${one}` : `${a.tapped ? 'tapped' : 'untapped'} ${changed} permanents`);
        }
        case 'counter': {
          need();
          const c = s.cards[a.id];
          if (!c || (c.zone !== 'battlefield' && c.zone !== 'exile')) return { ok: false, err: 'Counters go on cards on the battlefield or in exile.' };
          if (!canAct(s, pid, c)) return { ok: false, err: `You don't control ${cardName(c)}.` };
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
          return done(diff ? `${diff > 0 ? 'put' : 'removed'} ${Math.abs(diff)} ${kind} counter${Math.abs(diff) > 1 ? 's' : ''} ${diff > 0 ? 'on' : 'from'} ${cardName(c)}` : '');
        }
        case 'mod': {
          need();
          const c = s.cards[a.id];
          if (!c || c.zone !== 'battlefield' || c.ctrl !== pid) return { ok: false, err: 'You don’t control that.' };
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
            const from = c.ctrl; c.ctrl = pid; c.seq = ++s.seq;
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
          alertChecks(s, pid);
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
          // Random seating order and starting player (103.1 / 103.2).
          const order = s.seats.slice();
          for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
          s.seats = order;
          s.turn = { active: order[0], phase: 1, n: 1, first: order[0] };
          return done(`randomized the turn order: ${order.map(x => nameOf(s, x)).join(' → ')}. ${nameOf(s, order[0])} goes first.`);
        }
        case 'phase': {
          need();
          const T = s.turn;
          if (!T.active) return { ok: false, err: 'Start the game first.' };
          const activeOnline = s.players[T.active] && s.players[T.active].online;
          if (T.active !== pid && activeOnline) return { ok: false, err: 'Only the active player can change the phase.' };
          if (a.dir === 'pass' || T.phase >= PHASES.length - 1 && a.dir !== 'back') {
            return passTurn(s, pid, notes, done);
          }
          if (a.dir === 'back') T.phase = Math.max(1, T.phase - 1);
          else if (typeof a.to === 'number') T.phase = Math.max(1, Math.min(PHASES.length - 1, a.to | 0));
          else T.phase++;
          if (PHASES[T.phase] === 'Cleanup') clearMods(s);
          s.rev++; return { ok: true };
        }
        case 'log': {
          need();
          if (a.alert) { log(s, pid, String(a.text || '').slice(0, 200), 'alert'); s.rev++; return { ok: true }; }
          return done(String(a.text || '').slice(0, 200));
        }
        case 'reveal': {
          need();
          me.revealed = (a.cards || []).slice(0, 60).map(c => ({ id: String(c.id || '').slice(0, 40), d: cleanD(c.d), face: 0, from: c.from === 'library' ? 'library' : 'hand' })).filter(c => c.d);
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
            ns.players[id] = Object.assign(newPlayer(old.name), { online: old.online, phone: old.phone, sleeveRev: old.sleeveRev, deckName: old.deckName });
          }
          ns.rev = s.rev + 1;
          ns.rematch = !!a.rematch;
          if (ns.rematch && keep.length) {
            // Rematch: same decks, new random turn order (103.1).
            const order = keep.slice();
            for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
            ns.seats = order;
            ns.turn = { active: order[0], phase: 1, n: 1, first: order[0] };
          }
          Object.keys(s).forEach(k => delete s[k]);
          Object.assign(s, ns);
          if (s.rematch) log(s, pid, `started a rematch. Turn order: ${s.seats.map(x => nameOf(s, x)).join(' → ')}. ${nameOf(s, s.seats[0])} goes first.`);
          else log(s, pid, 'started a new game — everyone picks a deck');
          return { ok: true };
        }
        default: return { ok: false, err: 'Unknown action.' };
      }
    } catch (e) {
      return { ok: false, err: e.message || String(e) };
    }
  }

  // State-based actions (704.5) the table can check on its own.
  function sba(s, notes) {
    for (let pass = 0; pass < 5; pass++) {
      let changed = false;
      for (const c of Object.values(s.cards)) {
        if (c.zone !== 'battlefield') continue;
        const k = c.counters || {};
        // 704.5f: a creature with toughness 0 or less goes to its owner's graveyard.
        if (isType(c, 'creature') || c.faceDown) {
          // 704.5f: toughness 0 or less dies. The table can't see lasting boosts (anthems, equipment), so it asks the controller.
          const pt = ptOf(c);
          const zero = !!(pt && pt[1] <= 0);
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
      if (!s.legend[key]) log(s, list[0].ctrl, `controls two copies of the legendary ${cardName(list[0])} — keep one and put the other into the graveyard (legend rule)`, 'alert');
    }
    s.legend = now;
  }

  function clearMods(s) { for (const c of Object.values(s.cards)) c.mod = null; } // 514.2: "until end of turn" ends

  function passTurn(s, pid, notes, done) {
    const T = s.turn;
    clearMods(s);
    const idx = s.seats.indexOf(T.active);
    const next = s.seats[(idx + 1) % s.seats.length];
    T.active = next; T.n++; T.phase = 0;
    // 502.3: the active player untaps their permanents during the untap step.
    let n = 0;
    for (const c of Object.values(s.cards)) {
      if (c.zone !== 'battlefield' || c.ctrl !== next || !c.tapped) continue;
      if (c.noUntap) { log(s, next, `${cardName(c)} doesn't untap`, 'auto'); continue; }
      // 122.1d: instead of untapping, remove a stun counter.
      if (c.counters && c.counters.stun) { c.counters.stun--; if (!c.counters.stun) delete c.counters.stun; log(s, next, `removed a stun counter from ${cardName(c)} instead of untapping it`, 'auto'); continue; }
      c.tapped = false; n++;
    }
    T.phase = 1; // untap step has no priority, move straight to upkeep
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

  root.Rules = { PHASES, ROWS, PUBLIC_ZONES, KEYWORD_COUNTERS, SUGGESTED_COUNTERS, MAX_SEATS, START_LIFE,
    newState, apply, canAct, zoneCards, cardName, typeLine, isType, face, rowFor, ptOf, rid, listNames, nameOf };
})(typeof window !== 'undefined' ? window : globalThis);
