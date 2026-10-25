// Kitchen Table — your own side of the game: deck, library, hand, and everything you do with them.
// Your library and hand live only in your browser (and your linked phone). Public cards go
// through the table host, which checks the rules.
(function () {
  'use strict';
  const R = Rules;

  const params = new URLSearchParams(location.search);
  // An AI player runs as a hidden copy of the site inside the page of whoever added it (?m=ai&ai=<id>),
  // with its own storage space so it never touches that person's decks, hand or identity.
  const AI_ID = params.get('m') === 'ai' ? (params.get('ai') || '').replace(/[^\w]/g, '').slice(0, 20) : '';
  const NS = AI_ID ? 'ai:' + AI_ID + ':' : '';
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(NS + k); } catch (e) {} },
    raw: { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } }
  };

  // The table code: from the link, else the last table this browser played at, else a new one (kept in the address bar
  // so Invite shares it). Phones and AI frames always carry it in their link.
  const genCode = () => { const A = 'abcdefghjkmnpqrstuvwxyz23456789'; let c = ''; const r = new Uint32Array(6); crypto.getRandomValues(r); for (const x of r) c += A[x % A.length]; return 'kt-' + c; };
  let tParam = params.get('t');
  if (!tParam && !params.get('m') && !params.get('ai')) {
    try { tParam = JSON.parse(localStorage.getItem('kt:lastTable') || 'null'); } catch (e) { tParam = null; }
    if (!tParam) tParam = genCode();
    try { history.replaceState(null, '', location.pathname + '?t=' + encodeURIComponent(tParam) + location.hash); } catch (e) { /* the code still works */ }
  }
  const TABLE = (tParam || 'main').replace(/[^\w-]/g, '').slice(0, 40) || 'main';
  if (!params.get('m') && !params.get('ai')) { try { localStorage.setItem('kt:lastTable', JSON.stringify(TABLE)); } catch (e) {} }
  // Old tables' games are wiped from this browser when you sit at another one (they can't be brought back).
  function wipeOtherTables() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        const m = k && (k.match(/^kt:(priv|pub|roster):([\w-]+)/) || k.match(/^ai:\w+:kt:(priv|pub|roster):([\w-]+)/));
        if (m && m[2] !== TABLE) localStorage.removeItem(k);
      }
    } catch (e) { /* storage blocked */ }
  }
  if (!params.get('m') && !params.get('ai')) wipeOtherTables();

  const MODE = AI_ID ? 'ai' : params.get('m') === 'hand' ? 'hand' : 'table';
  let KEY = null; // your public seat id — set once your signing key is loaded (see G.ready below)

  const G = window.KT = {
    R, LS, TABLE, MODE, KEY, AI_ID, S: null, table: null, phone: null, phoneLinked: false,
    render() {}, toast() {}, status: 'connecting', statusMsg: ''
  };
  G.newTable = () => { location.href = location.pathname + '?t=' + encodeURIComponent(genCode()); };
  G.openTable = code => { const c = String(code || '').trim().replace(/[^\w-]/g, '-').slice(0, 40); if (c) location.href = location.pathname + '?t=' + encodeURIComponent(c); };

  // ---------------- randomness ----------------
  function rnd(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
  function shuffle(arr) { if (P && arr === P.library) P.known = []; for (let i = arr.length - 1; i > 0; i--) { const j = rnd(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  // ---------------- what I know about my library (401.2: its order is fixed; a shuffle makes it unknown again) ----------------
  // P.known: ids of library cards whose place I've seen (scry, surveil, "put on top", mulligan bottoms…).
  function know(cards) { P.known = [...new Set((P.known || []).concat(cards.map(c => c.id || c)))]; }
  G.knownLibrary = function () {
    const known = new Set(P.known || []), L = P.library;
    const top = []; for (const c of L) { if (!known.has(c.id)) break; top.push(c); }
    const bottom = []; for (let i = L.length - 1; i >= top.length; i--) { if (!known.has(L[i].id)) break; bottom.unshift(L[i]); }
    return { top, bottom };
  };
  G.rnd = rnd;

  // ---------------- private state ----------------
  function freshPriv(gameId) {
    return { gameId, deckId: null, deckName: '', library: [], hand: [], hidden: {}, revealed: [], mull: 0, phase: 'none', bottomN: 0, n: 0, autoDrew: null, handHere: false };
  }
  let PKEY = null;
  G.P = freshPriv(null);
  let P = G.P;

  // Load (or create) this browser's identity before anything else runs.
  G.ready = (async () => {
    if (MODE === 'hand') {
      G.PHONE_SECRET = (params.get('k') || '').replace(/[^\w]/g, '').slice(0, 40);
      G.PHONE_ID = await Net.phoneIdFor(TABLE, G.PHONE_SECRET);
      return;
    }
    // A tab can have its own player (to play a second seat from the same browser); otherwise the browser's.
    let tabIdent = null; if (!AI_ID) try { tabIdent = JSON.parse(sessionStorage.getItem('kt:ident:tab')); } catch (e) {}
    const ident = await Net.makeIdentity(tabIdent || LS.get('kt:ident', null));
    if (!tabIdent) LS.set('kt:ident', ident.jwk);
    G.tabPlayer = !!tabIdent;
    G.identity = ident;
    KEY = G.KEY = ident.pid;
    let ps = LS.get('kt:phoneSecret', null);
    if (!ps) { ps = Net.rid(24); LS.set('kt:phoneSecret', ps); }
    G.PHONE_SECRET = ps;
    G.PHONE_ID = await Net.phoneIdFor(TABLE, ps);
    PKEY = 'kt:priv:' + TABLE + ':' + KEY;
    setP(LS.get(PKEY, null) || freshPriv(null));
  })();
  function setP(np) { P = G.P = np; }

  // Your hand/library are kept per game, so ending up briefly at another copy of the table never wipes them.
  function archivePriv() {
    if (!P.gameId || !PKEY) return;
    LS.set(PKEY + ':g:' + P.gameId, P);
    const list = (LS.get(PKEY + ':gl', []) || []).filter(x => x !== P.gameId);
    list.push(P.gameId);
    while (list.length > 4) { const old = list.shift(); try { localStorage.removeItem(PKEY + ':g:' + old); } catch (e) {} }
    LS.set(PKEY + ':gl', list);
  }
  function savePriv(quiet) {
    if (G.dead) return;
    // Drop reveals that are no longer true (card left the hand, or top of library changed).
    const before = JSON.stringify(P.revealed);
    // (Cards revealed from the top N for a moment, r.n, stay while they're still among the top cards.)
    P.revealed = P.revealed.filter(r => r.from === 'hand' ? P.hand.some(c => c.id === r.id) : r.many ? P.library.slice(0, 20).some(c => c.id === r.id) : (P.library[0] && P.library[0].id === r.id));
    if (JSON.stringify(P.revealed) !== before) sendReveal();
    LS.set(PKEY, P);
    scheduleCounts();
    phoneSync();
    if (!quiet) G.render();
  }
  G.savePriv = savePriv;

  const me = () => G.S && G.S.players[KEY];
  G.me = me;
  G.seated = () => !!me();

  async function act(a) {
    if (!G.table) return { ok: false, err: 'Not connected.' };
    // Developer debugging: actions on someone else's card are sent as that card's controller (or owner); others as the chosen player.
    if (G.S && G.S.dev && G.S.hostPid === G.KEY && !a.as && a.type !== 'dev' && !['enter', 'counts', 'deck', 'inboxAck', 'todoAck', 'reveal', 'identify', 'log', 'aiSay'].includes(a.type)) {
      const id = a.id || (Array.isArray(a.ids) && a.ids[0]);
      const c = id && G.S.cards[id];
      const as = c ? (c.zone === 'battlefield' || c.zone === 'stack' ? c.ctrl : c.owner) : a.type === 'pass' && G.S.prio && G.S.prio.holder ? G.S.prio.holder : a.type === 'answer' ? ((G.S.ask || []).find(x => x.id === a.id) || {}).pid : G.devAs;
      if (as && as !== G.KEY && G.S.players[as]) a = Object.assign({}, a, { as });
    }
    const r = await G.table.act(a);
    if (!r.ok && r.err) { G.toast(r.err, 'err'); if (G.phoneLinked) phoneBanner(r.err); }
    return r;
  }
  G.act = act;
  const log = text => act({ type: 'log', text });

  let countsT = null;
  function scheduleCounts() {
    clearTimeout(countsT);
    countsT = setTimeout(() => {
      const m = me(); if (!m) return;
      if (m.handCount !== P.hand.length || m.libCount !== P.library.length) act({ type: 'counts', hand: P.hand.length, lib: P.library.length });
    }, 250);
  }

  function take(list, ids) {
    const set = new Set(ids), out = [];
    for (let i = list.length - 1; i >= 0; i--) if (set.has(list[i].id)) out.unshift(list.splice(i, 1)[0]);
    // keep the order the ids were given in
    return ids.map(id => out.find(c => c.id === id)).filter(Boolean);
  }

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const frontType = c => (c.d && c.d.faces && c.d.faces[0] && c.d.faces[0].t) || '';
  const isLand = c => /\bland\b/i.test(frontType(c));
  G.isLand = isLand;

  // ---------------- decks (saved on this device) ----------------
  G.decks = () => LS.get('kt:decks', []);
  G.saveDecks = list => { const ok = LS.set('kt:decks', list); if (!ok) G.toast('Your browser storage is full. Delete a deck or use smaller sleeve or playmat pictures.', 'err'); return ok; };

  // What everyone sees for your seat: sleeve, playmat and color palette.
  G.lookOf = deck => deck ? { sleeve: deck.sleeve || null, mat: deck.mat || null, palette: deck.palette || 'felt' } : null;
  G.pushLook = deck => { if (G.table && deck && G.P.deckId === deck.id) G.table.setSleeve(G.lookOf(deck)); };

  G.useDeck = async function (deck, rematch) {
    if (!me()) { G.toast('Take a seat first.', 'err'); return; }
    // Decks saved before the table could read rules text get it filled in once.
    if (deck.cards.some(e => e.d && e.d.faces && e.d.faces[0] && e.d.faces[0].o === undefined)) {
      G.toast('Reading your cards’ rules text from Scryfall…', 'quiet');
      const n = await Scry.enrich(deck.cards.map(e => e.d));
      if (n > 0) { const all = G.decks(); const i = all.findIndex(d => d.id === deck.id); if (i >= 0) { all[i] = deck; G.saveDecks(all); } }
    }
    const hadCards = P.deckId || Object.values(G.S.cards).some(c => c.owner === KEY);
    const n0 = P.n;
    setP(freshPriv(G.S.gameId));
    P.n = n0 + 1000; // never reuse card ids within a game
    P.deckId = deck.id; P.deckName = deck.name;
    const lib = [], cmd = [];
    let cmdrs = 0;
    for (const e of deck.cards) for (let i = 0; i < e.qty; i++) {
      const isCmdr = !!e.cmdr && i === 0 && ++cmdrs <= 2; // at most 2 commanders
      const c = { id: KEY.slice(1, 9) + '-' + (++P.n), owner: KEY, d: e.d, cmdr: isCmdr };
      (isCmdr ? cmd : lib).push(c);
    }
    P.library = shuffle(lib);
    savePriv();
    if (hadCards) await act({ type: 'resetMine' });
    G.table.setSleeve(G.lookOf(deck));
    await act({ type: 'deck', name: deck.name, sleeveRev: Date.now() });
    if (cmd.length) await act({ type: 'enter', zone: 'command', cards: cmd, msg: 'put {cards} into the command zone' });
    await act({ type: 'counts', hand: 0, lib: P.library.length });
    G.toast(rematch ? `Rematch! ${deck.name} is shuffled — draw your opening hand.` : `${deck.name} is shuffled and ready. Draw your opening hand when everyone is set.`, rematch ? 'turn' : 'info');
  };

  // ---------------- opening hand + mulligans ----------------
  function dealSeven() {
    const L = P.library;
    const hand = L.splice(0, 7);
    let moved = false;
    while (hand.filter(isLand).length < 3 && L.length) hand.push(L.shift());
    while (hand.length > 7) {
      const nl = hand.filter(c => !isLand(c));
      if (!nl.length) break;
      const x = nl[rnd(nl.length)];
      hand.splice(hand.indexOf(x), 1); L.push(x); moved = true;
    }
    shuffle(L);
    return hand;
  }

  G.openingHand = function () {
    if (!P.library.length) return G.toast('Load a deck first.', 'err');
    if (P.hand.length) return G.toast('Your hand already has cards. Use Draw instead.', 'err');
    P.hand = dealSeven();
    P.phase = 'deciding'; P.mull = 0;
    savePriv();
    log(`drew an opening hand of ${P.hand.length}`);
    if (me() && me().kept) act({ type: 'player', patch: { kept: false } });
  };

  G.mulligan = function () {
    P.library.push(...P.hand); P.hand = [];
    shuffle(P.library);
    P.mull++;
    P.hand = dealSeven();
    P.phase = 'deciding';
    savePriv();
    log(P.mull === 1 && !(G.S && G.S.house && G.S.house.freeMull === false) ? 'took a free mulligan' : `took mulligan #${P.mull}`);
  };

  G.autoDraw = () => { if (G.S && me()) autoDraw(); };
  G.keep = function () {
    // First mulligan is free in multiplayer / Commander (103.5c), then London mulligan (103.5).
    const free = !(G.S && G.S.house && G.S.house.freeMull === false);
    const n = Math.max(0, P.mull - (free ? 1 : 0));
    if (n > 0) { P.phase = 'bottom'; P.bottomN = Math.min(n, P.hand.length); savePriv(); return; }
    P.phase = 'kept'; savePriv();
    log(`kept their opening hand of ${P.hand.length}`);
    act({ type: 'player', patch: { kept: true } });
    autoDraw();
  };

  G.bottomChosen = function (ids) {
    const cards = take(P.hand, ids);
    P.library.push(...cards); know(cards);
    P.phase = 'kept'; P.bottomN = 0;
    savePriv();
    log(`kept ${P.hand.length} cards and put ${plural(cards.length, 'card')} on the bottom of their library`);
    act({ type: 'player', patch: { kept: true } });
    autoDraw();
  };

  // ---------------- drawing ----------------
  G.draw = function (n, why) {
    n = Math.max(1, n | 0);
    const got = P.library.splice(0, n);
    P.hand.push(...got);
    { const seen = got.filter(c => (P.revealed || []).some(r => r.top && r.id === c.id)); if (seen.length) { P.revealed = P.revealed.filter(r => !seen.some(c => c.id === r.id)); knowInHand(seen); } }
    if (P.phase === 'none') P.phase = 'kept';
    savePriv();
    if (got.length) act({ type: 'log', text: why || `drew ${plural(got.length, 'card')}`, drew: got.length });
    // 704.5b: drawing from an empty library loses the game.
    if (got.length < n) act({ type: 'lose', why: 'empty library' });
  };

  const UNTIL = {
    creature: { label: 'a creature', test: c => /\bcreature\b/i.test(frontType(c)) },
    historic: { label: 'a historic card', test: c => /\b(artifact|legendary|saga)\b/i.test(frontType(c)) },
    land: { label: 'a land', test: isLand },
    nonland: { label: 'a nonland card', test: c => !isLand(c) },
    instant: { label: 'an instant or sorcery', test: c => /\b(instant|sorcery)\b/i.test(frontType(c)) },
    artifact: { label: 'an artifact', test: c => /\bartifact\b/i.test(frontType(c)) },
    enchantment: { label: 'an enchantment', test: c => /\benchantment\b/i.test(frontType(c)) },
    planeswalker: { label: 'a planeswalker', test: c => /\bplaneswalker\b/i.test(frontType(c)) }
  };
  G.UNTIL = UNTIL;

  G.drawUntil = function (kind) {
    const u = UNTIL[kind]; if (!u) return;
    let k = 0, found = null;
    while (P.library.length) { const c = P.library.shift(); P.hand.push(c); k++; if (u.test(c)) { found = c; break; } }
    savePriv();
    log(`drew ${plural(k, 'card')} until they drew ${u.label}${found ? ' (' + found.d.n + ')' : ' — none left in their library'}`);
  };

  // ---------------- moving your own hidden cards ----------------
  function msgFor(zone, opts, from) {
    if (opts.msg) return opts.msg;
    const src = from === 'library' ? ' from their library' : from === 'command' ? '' : '';
    switch (zone) {
      case 'battlefield': return (opts.faceDown ? 'put {cards} onto the battlefield face down' : opts.playLand ? 'played {cards}' : 'put {cards}' + src + ' onto the battlefield') + (opts.tapped ? ' tapped' : '');
      case 'stack': return opts.faceDown ? 'cast {cards} face down' : 'cast {cards}' + src;
      case 'graveyard': return from === 'hand' ? 'discarded {cards}' : 'put {cards}' + src + ' into their graveyard';
      case 'exile': return 'exiled {cards}' + (from === 'hand' ? ' from their hand' : src);
      case 'command': return 'put {cards} into the command zone';
    }
    return 'moved {cards}';
  }

  let lastAct = null;
  async function toPublic(list, ids, zone, opts, from) {
    opts = opts || {};
    const cards = take(list, ids);
    if (!cards.length) return;
    const send = cards.map(c => {
      if (opts.faceDown) P.hidden[c.id] = c.d;
      return { id: c.id, d: opts.faceDown ? null : c.d, cmdr: c.cmdr, faceDown: !!opts.faceDown, face: opts.backFace ? 1 : 0 };
    });
    savePriv();
    const land = cards.every(isLand);
    const r = await act({ type: 'enter', zone, from, cards: send, tapped: !!opts.tapped, pos: opts.pos, row: opts.row, land: !!opts.playLand, tg: opts.tg, mode: opts.mode, x: opts.x, wardPaid: !!opts.wardPaid, fromPool: opts.fromPool, cast: !!opts.cast, alt: opts.alt, via: opts.via, perm: opts.perm, top: opts.top, suspend: opts.suspend || undefined, special: opts.special || undefined, textHint: opts.special === 'foretell' ? (cards[0] && cards[0].d ? (cards[0].d.faces || []).map(f => f.o || '').join('\n').slice(0, 2000) : '') : undefined, sacCost: opts.sacCost, mayPlay: opts.mayPlay, msg: msgFor(zone, Object.assign({ land }, opts), from) });
    if (r.ok) lastAct = { zone, ids, t: Date.now() };
    if (!r.ok) {
      // Only put the cards back if the table really refused. If we just never heard back, look at the board:
      // cards that made it onto the table stay there, so nothing is ever in two places at once.
      const back = r.uncertain ? cards.filter(c => !(G.S && G.S.cards[c.id])) : cards;
      if (back.length) { list.push(...back); savePriv(); }
    }
    else if (opts.backFace) for (const c of send) { /* already set face via enter */ }
  }

  G.fromHand = (ids, zone, opts) => toPublic(P.hand, ids, zone, opts, 'hand');
  // Play a land from your hand (counts as your one land for the turn).
  G.playLand = async function (id, tapped) {
    const c = P.hand.find(x => x.id === id); if (!c) return { ok: false };
    const T = G.S && G.S.turn;
    const lerr = T && T.active === KEY && R.landCheck ? R.landCheck(G.S, KEY) : null;
    if (lerr && /lands? per turn|lands you may play/.test(lerr)) {
      const err = lerr;
      G.toast(err, 'err'); if (G.phoneLinked) phoneBanner(err); G.render();
      return { ok: false, err };
    }
    await toPublic(P.hand, [id], 'battlefield', { playLand: true, tapped }, 'hand');
    return { ok: !P.hand.some(x => x.id === id) };
  };
  // Cast a card from your hand onto the stack, with targets/mode/X already chosen.
  G.castFromHand = (id, opts) => toPublic(P.hand, [id], 'stack', Object.assign({ cast: true }, opts || {}), 'hand');
  G.castFromLibrary = (id, opts) => toPublic(P.library, [id], 'stack', Object.assign({ cast: true }, opts || {}), 'library');
  G.castPublic = (id, opts) => act(Object.assign({ type: 'move', ids: [id], to: 'stack', cast: true }, opts || {}));
  G.pass = () => G.S && G.S.prio ? act({ type: 'pass', top: G.S.prio.top }) : null;
  G.activate = (id, i, tg, x, fromPool) => act({ type: 'activate', id, i, tg, x, fromPool });
  G.attack = list => act({ type: 'attack', list });
  G.block = list => act({ type: 'block', list });
  G.fromLibrary = (ids, zone, opts) => toPublic(P.library, ids, zone, opts, 'library');
  // Cascade (702.85): exile from the top until a nonland card with lesser mana value; it may be cast free; the rest go to the bottom in a random order.
  G.cascadeReveal = function (mv, top) {
    if (top) { const c = P.library.shift(); if (!c) return null; P.hand.push(c); savePriv(); log(`revealed ${c.d.n} from the top of their library`); return !isLand(c) && (+c.d.cmc || 0) < mv ? c : null; }
    const out = []; let hit = null;
    while (P.library.length) { const c = P.library.shift(); out.push(c); if (!isLand(c) && (+c.d.cmc || 0) < mv) { hit = c; break; } }
    const rest = out.filter(c => c !== hit);
    shuffle(rest); P.library.push(...rest);
    if (hit) P.hand.push(hit);         // held in hand only while its controller decides; cast it or it goes to the bottom
    savePriv();
    log(`cascaded: revealed ${plural(out.length, 'card')}${hit ? ', hitting ' + hit.d.n : ' and hit nothing'}; the rest went to the bottom in a random order`);
    return hit;
  };
  // "Exile cards from the top of your library until you exile a nonland permanent card…" (Illuna, Auspicious Starrix, The Regalia).
  // digFind looks (top down) for N matching cards; digFinish moves them and the rest where the card says.
  // Impulse draw: the top N cards go to exile face up, playable for a while.
  G.impulse = async function (t) {
    const ids = P.library.slice(0, Math.max(1, t.n || 1)).map(c => c.id);
    if (ids.length) await toPublic(P.library, ids, 'exile', { mayPlay: { until: t.until, from: t.from }, msg: `exiled {cards} from the top of their library (${t.src}) — they may play ${ids.length > 1 ? 'them' : 'it'} ${t.until === 'next' ? 'until the end of their next turn' : 'this turn'}` });
    return ids;
  };
  G.digFind = function (t) {
    const n = Math.max(1, t.n || 1), want = String(t.what || 'card');
    const fits = c => !c.d ? false : want === 'card' || window.Cards.matchesWhat(Object.assign({ zone: 'library', owner: KEY, counters: {}, face: 0 }, c), want);
    const hits = [], rest = [];
    for (const c of P.library) { if (hits.length >= n) break; if (fits(c)) hits.push(c.id); else if (!t.top) rest.push(c.id); if (t.top) break; }
    return { hits, rest, names: hits.map(id => (P.library.find(c => c.id === id) || {}).d).filter(Boolean).map(d => d.n) };
  };
  G.digFinish = async function (t, hits, rest, dest) {
    if (t.top && !hits.length) { if (dest === 'bottom' && P.library.length) { P.library.push(P.library.shift()); savePriv(); log(`${t.src}: put the top card of their library on the bottom`); } else log(`${t.src}: the top card stays`); return; }
    if (t.rest === 'bottom') { const r = take(P.library, rest); shuffle(r); P.library.push(...r); savePriv(); }
    else if (rest.length) await G.fromLibrary(rest, 'exile', {});
    if (!hits.length) { log(`${t.src}: revealed ${plural(rest.length, 'card')} and found nothing`); return; }
    if (dest === 'hand') { const hs = take(P.library, hits); P.hand.push(...hs); savePriv(); log(`${t.src}: revealed ${hs.map(c => c.d.n).join(', ')} and put ${hs.length > 1 ? 'them' : 'it'} into their hand`); }
    else await G.fromLibrary(hits, 'battlefield', { tapped: !!t.tapped });
  };
  G.cascadeDecline = function (id) { const i = P.hand.findIndex(c => c.id === id); if (i < 0) return; const [c] = P.hand.splice(i, 1); P.library.push(c); savePriv(); log(`put ${c.d.n} on the bottom of their library (didn’t cast it with cascade)`); };

  G.handToLibrary = function (ids, pos) {
    const cards = take(P.hand, ids);
    if (pos === 'bottom') { P.library.push(...cards); know(cards); }
    else if (pos === 'shuffle') { P.library.push(...cards); shuffle(P.library); }
    else { P.library.unshift(...cards.reverse()); know(cards); }
    savePriv();
    const n = plural(cards.length, 'card');
    log(pos === 'bottom' ? `put ${n} from their hand on the bottom of their library`
      : pos === 'shuffle' ? `shuffled ${n} from their hand into their library` : `put ${n} from their hand on top of their library`);
  };

  G.discardRandom = function () {
    if (!P.hand.length) return;
    const c = P.hand[rnd(P.hand.length)];
    G.fromHand([c.id], 'graveyard', { msg: 'discarded {cards} at random' });
  };

  G.libraryToHand = function (ids, why) {
    const cards = take(P.library, ids);
    P.hand.push(...cards);
    savePriv();
    if (why) log(why);
  };

  // ---------------- reveal (make public) ----------------
  // Cards in my hand the other players have seen (returned from a public zone, revealed by a tutor, drawn while
  // revealed on top): they stay known to the table until they leave my hand.
  function knowInHand(cards) { P.knownHand = [...new Set((P.knownHand || []).concat(cards.map(c => c.id || c)))]; sendReveal(); }
  G.knowInHand = knowInHand;
  function sendReveal() {
    const list = P.revealed.map(r => {
      const c = (r.from === 'hand' ? P.hand : P.library).find(x => x.id === r.id);
      return c ? { id: c.id, d: c.d, from: r.from } : null;
    }).filter(Boolean);
    P.knownHand = (P.knownHand || []).filter(id => P.hand.some(c => c.id === id));
    for (const id of P.knownHand) if (!list.some(x => x.id === id)) { const c = P.hand.find(x => x.id === id); list.push({ id: c.id, d: c.d, from: 'hand', known: true }); }
    act({ type: 'reveal', cards: list, quiet: true });
  }
  G.isRevealed = id => P.revealed.some(r => r.id === id);
  // Reveal library cards to the table for a moment ("reveal the top four cards…"), then stop.
  G.revealLib = function (ids, on) {
    P.revealed = (P.revealed || []).filter(r => !(r.from === 'library' && !r.top && ids.includes(r.id)));
    if (on) for (const id of ids) P.revealed.push({ id, from: 'library', many: true });
    sendReveal(); savePriv();
    if (on) log(`revealed ${P.library.filter(c => ids.includes(c.id)).map(c => c.d.n).join(', ')} from the top of their library`);
  };
  // "Play with the top card of your library revealed": keep the current top card revealed to the table.
  G.syncTopReveal = function () {
    if (!G.S || !window.Rulebook || !G.S.turn || !G.S.turn.active || !P.library) return;
    const want = Rulebook.topView(G.S, KEY).all && P.library[0] ? P.library[0].id : null;
    const cur = (P.revealed || []).filter(r => r.top);
    if (cur.length === (want ? 1 : 0) && (!want || cur[0].id === want)) return;
    P.revealed = (P.revealed || []).filter(r => !r.top);
    if (want) { P.revealed.push({ id: want, from: 'library', top: true }); know([want]); }
    sendReveal(); savePriv();
  };
  G.toggleReveal = function (id) {
    const c = P.hand.find(x => x.id === id); if (!c) return;
    if (G.isRevealed(id)) { P.revealed = P.revealed.filter(r => r.id !== id); log(`stopped revealing ${c.d.n}`); }
    else { P.revealed.push({ id, from: 'hand' }); log(`revealed ${c.d.n} from their hand`); }
    sendReveal(); savePriv();
  };
  G.revealHand = function () {
    const all = P.hand.every(c => G.isRevealed(c.id));
    P.revealed = P.revealed.filter(r => r.from !== 'hand');
    if (!all) { P.hand.forEach(c => P.revealed.push({ id: c.id, from: 'hand' })); log(`revealed their hand: ${R.listNames(P.hand.map(c => c.d.n))}`); }
    else log('stopped revealing their hand');
    sendReveal(); savePriv();
  };
  G.revealTop = function () {
    const c = P.library[0]; if (!c) return G.toast('Your library is empty.', 'err');
    if (!P.revealed.some(r => r.id === c.id)) P.revealed.push({ id: c.id, from: 'library' });
    sendReveal(); savePriv();
    log(`revealed the top card of their library: ${c.d.n}`);
  };

  // ---------------- library actions ----------------
  G.shuffleLibrary = function (quiet) { shuffle(P.library); savePriv(); if (!quiet) log('shuffled their library'); };

  G.mill = async function (n) {
    const ids = P.library.slice(0, n).map(c => c.id);
    if (!ids.length) return G.toast('Your library is empty.', 'err');
    await G.fromLibrary(ids, 'graveyard', { msg: 'milled {cards}' });
  };

  G.millUntil = async function (kind) {
    const u = UNTIL[kind]; if (!u) return;
    const ids = []; let found = false;
    for (const c of P.library) { ids.push(c.id); if (u.test(c)) { found = true; break; } }
    if (!ids.length) return G.toast('Your library is empty.', 'err');
    await G.fromLibrary(ids, 'graveyard', { msg: `milled {cards} (until ${u.label}${found ? '' : ' — none found'})` });
  };

  G.exileTop = async function (n, faceDown) {
    const ids = P.library.slice(0, n).map(c => c.id);
    if (!ids.length) return G.toast('Your library is empty.', 'err');
    await G.fromLibrary(ids, 'exile', { faceDown, msg: faceDown ? `exiled the top ${plural(ids.length, 'card')} of their library face down` : 'exiled {cards} from the top of their library' });
  };

  // decisions: [{id, dest}] in order. dest: top | bottom | graveyard | hand | exile | battlefield
  G.applyLook = async function (mode, x, decisions, lo) {
    const top = P.library.splice(0, x);
    const byId = new Map(top.map(c => [c.id, c]));
    const tops = [], bottoms = [], others = [];
    for (const d of decisions) {
      const c = byId.get(d.id); if (!c) continue; byId.delete(d.id);
      if (d.dest === 'top') tops.push(c); else if (d.dest === 'bottom') bottoms.push(c); else others.push([c, d.dest]);
    }
    for (const c of byId.values()) tops.push(c); // anything not decided stays on top
    P.library.unshift(...tops); P.library.push(...bottoms);
    know(tops.concat(bottoms));
    const toHand = others.filter(o => o[1] === 'hand').map(o => o[0]);
    P.hand.push(...toHand);
    // public destinations
    const pub = others.filter(o => o[1] !== 'hand');
    for (const [c] of pub) P.library.unshift(c); // put back temporarily so fromLibrary can take them
    savePriv(true);
    const word = mode === 'scry' ? 'scried' : mode === 'surveil' ? 'surveilled' : 'looked at';
    const parts = [];
    if (tops.length) parts.push(`${tops.length} on top`);
    if (bottoms.length) parts.push(`${bottoms.length} on the bottom`);
    if (toHand.length) parts.push(`${plural(toHand.length, 'card')} into their hand`);
    await log(`${word} ${mode === 'look' ? 'the top ' + plural(x, 'card') + ' of their library' : x}${parts.length ? ': ' + parts.join(', ') : ''}`);
    for (const dest of ['graveyard', 'exile', 'battlefield']) {
      const ids = pub.filter(o => o[1] === dest).map(o => o[0].id);
      if (ids.length) await G.fromLibrary(ids, dest, { tapped: dest === 'battlefield' && !!(lo && lo.tapped), msg: dest === 'graveyard' ? 'put {cards} into their graveyard' : dest === 'exile' ? 'exiled {cards} from their library' : 'put {cards} onto the battlefield from their library' });
    }
    savePriv();
  };

  G.finishSearch = function () {
    shuffle(P.library); savePriv();
    log('searched their library and shuffled it');
  };

  // Show a newly chosen printing on cards already in this game (library, hand and on the table).
  G.applyPrint = async function (oldName, d) {
    let changed = 0;
    for (const list of [P.library, P.hand]) for (const c of list) if (c.d && c.d.n === oldName) { c.d = d; changed++; }
    if (changed) savePriv();
    const ids = Object.values(G.S ? G.S.cards : {}).filter(c => c.owner === KEY && c.d && c.d.n === oldName && !c.token).map(c => c.id);
    if (ids.length) await act({ type: 'reprint', ids, d });
    return changed + ids.length;
  };

  // ---------------- public cards ----------------
  G.move = (ids, to, pos, extra) => act(Object.assign({ type: 'move', ids, to, pos }, extra || {}));
  G.tap = (ids, tapped, pay) => act({ type: 'tap', ids, tapped, pay: !!pay });
  G.counter = (id, kind, delta) => act({ type: 'counter', id, kind, delta });
  G.setMod = (id, p, t) => act({ type: 'mod', id, p, t });
  G.flip = id => act({ type: 'flip', id });
  G.attach = (id, to) => act({ type: 'attach', id, to });
  G.control = (ids, to) => act({ type: 'control', ids, to });
  G.setRow = (id, row) => act({ type: 'row', id, row });
  G.token = (d, count, tapped) => act({ type: 'token', d, count, tapped });
  G.copyToken = c => c.d && act({ type: 'token', d: { n: c.d.n, sid: c.d.sid, cmc: 0, faces: [R.face(c)] }, count: 1, copyOf: true });
  G.removeToken = ids => act({ type: 'removeToken', ids });
  G.turnFaceDown = function (id) {
    const c = G.S.cards[id]; if (!c || !c.d) return;
    P.hidden[id] = c.d; savePriv(true);
    act({ type: 'faceDown', id, down: true });
  };
  G.turnFaceUp = async function (id) {
    const d = P.hidden[id];
    if (!d) return G.toast('Only the card’s owner can turn it face up.', 'err');
    const r = await act({ type: 'faceDown', id, down: false, d });
    if (r.ok) { delete P.hidden[id]; savePriv(true); }
  };
  G.peek = id => P.hidden[id] || null;

  // ---------------- sync with the table ----------------
  const inboxBusy = new Set(), idBusy = new Set();
  function processInbox() {
    const box = (G.S.inbox || {})[KEY] || [];
    const ack = [];
    let shuffled = false, changed = false;
    const toHandKnown = [];
    for (const it of box) {
      const c = it.card;
      if (inboxBusy.has(c.id)) continue;
      ack.push(c.id); inboxBusy.add(c.id);
      if (P.hand.some(x => x.id === c.id) || P.library.some(x => x.id === c.id)) continue;
      const card = { id: c.id, owner: KEY, d: c.d || P.hidden[c.id] || null, cmdr: c.cmdr };
      delete P.hidden[c.id];
      if (!card.d) continue;
      changed = true;
      if (it.to === 'hand') { P.hand.push(card); toHandKnown.push(card); }
      else if (it.pos === 'bottom') { P.library.push(card); know([card]); }
      else if (it.pos === 'n2' || it.pos === 'n3') { P.library.splice(Math.min(P.library.length, it.pos === 'n2' ? 1 : 2), 0, card); know([card]); }
      else if (it.pos === 'shuffle') { P.library.push(card); shuffled = true; }
      else { P.library.unshift(card); know([card]); }
    }
    if (shuffled) shuffle(P.library);
    if (toHandKnown.length) knowInHand(toHandKnown);   // it came from a public zone: everyone saw it
    if (changed) savePriv(true);
    if (ack.length) act({ type: 'inboxAck', ids: ack }).then(() => ack.forEach(id => inboxBusy.delete(id)));
  }

  // Effects from spells that need your library or hand (draw, search for a land, scry, discard…).
  const todoBusy = new Set();
  function processTodo() {
    const list = ((G.S.todo || {})[KEY] || []).filter(t => !todoBusy.has(t.id));
    for (const t of list) {
      todoBusy.add(t.id);
      const ack = () => act({ type: 'todoAck', ids: [t.id] });
      if (t.k === 'draw') { G.draw(t.n || 1, `drew ${plural(t.n || 1, 'card')} (${t.src})`); ack(); continue; }
      if (t.k === 'mill') { G.mill(t.n || 1).then(ack); continue; }
      if (G.onTodo) { G.onTodo(t, ack); continue; }
      ack();
    }
  }
  // Search your library for basic lands (Rampant Growth, Cultivate…): returns the chosen cards.
  G.basicLands = () => P.library.filter(c => /\bbasic\b/i.test(frontType(c)) && isLand(c));
  G.fetchLands = async function (ids, t) {
    const chosen = ids.slice(0, t.n || 1);
    const toBf = t.split ? chosen.slice(0, 1) : t.dest === 'battlefield' ? chosen : [];
    const toGy = t.splitGy ? chosen.slice(1) : t.dest === 'graveyard' ? chosen : [];
    const toHand = t.split ? chosen.slice(1) : t.splitGy ? chosen.slice(0, 1) : t.dest === 'hand' ? chosen : [];
    if (toHand.length) { const cards = take(P.library, toHand); P.hand.push(...cards); if (t.reveal || (t.filter && t.filter !== 'card')) knowInHand(cards); }
    if (toGy.length) await G.fromLibrary(toGy, 'graveyard', { msg: `put {cards} into their graveyard (${t.src})` });
    const toTop = t.dest === 'top' ? take(P.library, chosen) : [];
    shuffle(P.library); P.library.unshift(...toTop); savePriv();
    if (toTop.length) log(`searched their library, revealed ${toTop.map(c => c.d.n).join(', ')} and put it on top (${t.src})`);
    if (toBf.length) await G.fromLibrary(toBf, 'battlefield', { tapped: t.tapped, msg: `put {cards} onto the battlefield${t.tapped ? ' tapped' : ''} (${t.src})` });
    log(`searched their library${toHand.length ? `, put ${plural(toHand.length, t.k === 'search' ? 'card' : 'land')} into their hand` : ''} and shuffled (${t.src})`);
  };

  const cmdrAsked = new Set();
  // The table asks about commanders itself now (903.9, the 'cmdrZone' question); this only covers a table without the engine.
  function commanderCheck() {
    if (window.Engine) return;
    for (const c of Object.values(G.S.cards)) {
      if (c.owner !== KEY || !c.cmdr || (c.zone !== 'graveyard' && c.zone !== 'exile')) continue;
      const k = c.id + ':' + c.seq;
      if (cmdrAsked.has(k)) continue;
      cmdrAsked.add(k);
      if (G.askCommander) G.askCommander(c);
    }
  }
  const zeroAsked = new Set();
  function zeroCheck() {
    for (const c of Object.values(G.S.cards)) {
      if (c.ctrl !== KEY || c.zone !== 'battlefield' || !c.zeroT || c.zeroOk) continue;
      const k = c.id + ':' + c.seq;
      if (zeroAsked.has(k)) continue;
      zeroAsked.add(k);
      if (G.askZero) G.askZero(c);
    }
  }

  function identify() {
    for (const c of Object.values(G.S.cards)) {
      if (c.owner === KEY && c.needsId && P.hidden[c.id] && !idBusy.has(c.id)) {
        idBusy.add(c.id);
        act({ type: 'identify', id: c.id, d: P.hidden[c.id] }).then(r => { idBusy.delete(c.id); if (r.ok) { delete P.hidden[c.id]; savePriv(true); } });
      }
    }
  }

  // When the game starts, everyone's opening hand is dealt for them; they then keep or mulligan (103.5).
  function autoOpening() {
    const s = G.S; if (MODE === 'hand' || !s || !s.turn || !s.turn.active || !me() || me().lost) return;
    if (P.phase !== 'none' || P.hand.length || !P.library.length || !P.deckId) return;
    if (s.turn.n > 1 || G._opened === s.gameId) return;
    G._opened = s.gameId;
    G.openingHand();
    if (MODE !== 'ai' && G.toast) G.toast('Here’s your opening hand — keep it or take a mulligan.', 'info');
  }
  function autoDraw() {
    const T = G.S.turn;
    // The draw step happened, even if the turn skipped ahead (e.g. a land played from upkeep moved it to main).
    if (!T || T.active !== KEY || T.phase < R.PI('Draw') || T.phase > R.PI('End step')) return;
    if (P.phase !== 'kept') return; // still deciding on an opening hand: don't draw for the turn yet
    const k = G.S.gameId + ':' + T.n;
    if (P.autoDrew === k) return;
    P.autoDrew = k;
    if (P.skipDraw) { P.skipDraw = false; savePriv(true); log('skipped their draw this turn'); return; }
    // 103.8a: in a two-player game the starting player skips their first draw.
    if (G.S.seats.length === 2 && T.n === 1 && T.first === KEY) { savePriv(true); log('skipped their first draw (two-player game)'); return; }
    G.draw(1, 'drew a card for the turn');
  }

  // Reminders for things the rules ask of you at certain steps.
  let lastStep = null;
  function stepReminders(s) {
    const T = s.turn; if (!T || !T.active) return;
    const key = s.gameId + ':' + T.n + ':' + T.phase;
    if (key === lastStep) return;
    const first = lastStep === null; lastStep = key;
    if (first || T.active !== KEY) return;
    const step = R.PHASES[T.phase];
    const say = t => { G.toast(t, 'info'); phoneBanner(t); };
    if (step === 'Upkeep' && s.table.initiative === KEY) say('You have the initiative: venture into the Undercity.');
    if (step === 'End step' && s.table.monarch === KEY) say('You’re the monarch: draw a card.');
    if (step === 'Cleanup' && P.hand.length > 7) say(`Discard down to 7 cards — you have ${P.hand.length} (rule 514.1).`);
  }

  let lastLogT = null;
  function notify(s) {
    const L = s.log || [];
    const newest = L.length ? L[L.length - 1].t : 0;
    if (lastLogT === null) { lastLogT = newest; return; }
    const myName = me() && me().name;
    for (const e of L) {
      if (e.t <= lastLogT) continue;
      const who = R.nameOf(s, e.pid);
      const line = (e.pid ? who + ' ' : '') + e.text;
      if (e.k === 'alert') { G.toast(line, 'alert'); phoneBanner(line); }
      else if (e.pid !== KEY && myName && e.text.includes(myName)) { G.toast(line, 'info'); phoneBanner(line); }
      else if (e.pid !== KEY && /searched|shuffled|scried|surveilled|looked at|revealed|mulligan|milled/.test(e.text)) G.toast(line, 'quiet');
      if (/passed the turn to/.test(e.text) && s.turn.active === KEY) { G.toast('Your turn', 'turn'); phoneBanner('Your turn'); }
    }
    lastLogT = newest;
  }

  let snapT = null;
  function onState(s) {
    G.S = s; if (window.Cards && window.Cards.setState) window.Cards.setState(s);
    clearTimeout(snapT);
    snapT = setTimeout(() => LS.set('kt:pub:' + TABLE, s), 800);
    if (P.gameId !== s.gameId) {
      const hadGame = !!P.gameId;
      // A new game: what this browser kept about any other game is deleted (it can't be brought back).
      // (Only for a fresh game — a copy of the table mid-game, seen for a moment during a host change, keeps the archive.)
      const fresh = !s.turn || !s.turn.active || (s.turn.n <= 1 && (s.log || []).some(l => /started a (new game|rematch)/.test(l.text)));
      if (fresh) { try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && PKEY && k.startsWith(PKEY + ':g:') && k !== PKEY + ':g:' + s.gameId) localStorage.removeItem(k); } LS.set(PKEY + ':gl', []); } catch (e) { /* storage blocked */ } }
      else archivePriv();
      const last = P.deckId;
      const back = LS.get(PKEY + ':g:' + s.gameId, null);
      if (back && back.gameId === s.gameId) { setP(back); LS.set(PKEY, P); G.render(); }
      else {
      setP(freshPriv(s.gameId));
      P.lastDeck = last;
      LS.set(PKEY, P);
      const deck = last && G.decks().find(d => d.id === last);
      if (hadGame && s.rematch && deck && s.players[KEY]) {
        // Rematch: reload the same deck automatically.
        setTimeout(() => G.useDeck(deck, true), 50);
      } else if (hadGame) G.toast('A new game started. Pick your deck to play.', 'info');
      }
    }
    if (me()) {
      if (!G.phone && MODE === 'table') G.startPhoneLink(true); // always ready for your phone once you're seated
      processInbox(); processTodo(); identify(); autoOpening(); autoDraw(); scheduleCounts(); commanderCheck(); zeroCheck();
      if (!me().deckName && P.deckId) act({ type: 'deck', name: P.deckName, sleeveRev: Date.now() });
    }
    notify(s);
    stepReminders(s);
    phoneSync();
    if (G.onStateHook) G.onStateHook(s);
    G.render();
  }

  // ---------------- phone link (computer side) ----------------
  function phoneSync() {
    if (!G.phone || !G.phone.linked) return;
    const m = me(), T = G.S && G.S.turn;
    // What the phone shows: the hand, the AI chat box, or both (tabs). Chosen on the computer.
    const push = G.LS.get('kt:phonePush', 'hand');
    const ais = G.S ? G.S.seats.filter(p => G.S.players[p] && G.S.players[p].ai) : [];
    const chat = push === 'hand' ? null : { ais: ais.map(p => ({ id: p, name: R.nameOf(G.S, p) })), lines: ((G.S && G.S.aichat) || []).slice(-40).map(x => ({ id: x.id, who: x.pid === KEY ? 'You' : (x.name || R.nameOf(G.S, x.pid)), to: x.to ? (x.to === KEY ? 'you' : (x.toName || R.nameOf(G.S, x.to))) : '', text: String(x.text || '').slice(0, 400), mine: x.pid === KEY })) };
    G.phone.send({
      t: 'hand',
      push, chat,
      cards: push === 'chat' ? [] : P.hand.map(c => ({ id: c.id, d: c.d, land: isLand(c), rev: G.isRevealed(c.id) })),
      info: {
        prio: phonePrio(),
        name: m ? m.name : '', life: m ? m.life : 0, lib: P.library.length,
        turn: T && T.active ? `Turn ${T.n} · ${R.nameOf(G.S, T.active)} · ${R.PHASES[T.phase]}` : 'Game not started',
        myTurn: !!(T && T.active === KEY), phase: P.phase, bottomN: P.bottomN, mull: P.mull,
        over: G.S && G.S.winner ? (G.S.winner === 'draw' ? '🤝 The game is a draw' : G.S.winner === KEY ? '🏆 You win!' : `🏆 ${R.nameOf(G.S, G.S.winner)} wins the game`) : m && m.lost ? `You’re out — ${m.lost.why}` : ''
      }
    });
  }
  function phoneBanner(text) { if (G.phone && G.phone.linked) G.phone.send({ t: 'banner', text: String(text).replace(/use the Move to option\./, 'tap the card and use the Move to option.') }); }
  function phonePrio() {
    const s = G.S; if (!s || !s.prio) return null;
    const top = R.stackTop(s);
    if (!top && s.prio.step) return { mine: s.prio.holder === KEY, step: true, text: 'Blockers are set — combat damage is next', waiting: s.prio.holder !== KEY ? R.nameOf(s, s.prio.holder) : '' };
    if (!top) return null;
    const tg = [].concat(...(top.tg || [])).map(t => t.p ? (t.p === KEY ? 'you' : R.nameOf(s, t.p)) : s.cards[t.c] ? (s.cards[t.c].ctrl === KEY ? 'your ' : R.nameOf(s, s.cards[t.c].ctrl) + '’s ') + R.cardName(s.cards[t.c]) : 'a card');
    return { mine: s.prio.holder === KEY, text: `${top.ab && top.ab.trig ? top.ab.name + ' triggered' : (top.ctrl === KEY ? 'You' : R.nameOf(s, top.ctrl)) + ' ' + (top.ab ? 'activated ' + top.ab.name : 'cast ' + R.cardName(top))}${tg.length ? ' → ' + R.listNames(tg) : ''}`, waiting: s.prio.holder !== KEY ? R.nameOf(s, s.prio.holder) : '' };
  }
  // Ask the phone to pick from a list (targets, modes, X). Resolves with the chosen value, or null.
  const phoneAsks = new Map();
  function phoneAsk(title, options, extra) {
    return new Promise(resolve => {
      if (!G.phone || !G.phone.linked) return resolve(null);
      const rid = Net.rid(8);
      phoneAsks.set(rid, resolve);
      G.phone.send(Object.assign({ t: 'choose', rid, title, options }, extra || {}));
      setTimeout(() => { if (phoneAsks.has(rid)) { phoneAsks.delete(rid); resolve(null); } }, 180000);
    });
  }
  // Casting from the phone: mode, X and targets are chosen on the phone.
  async function castFromPhone(id) {
    const c = P.hand.find(x => x.id === id); if (!c) return;
    const card = { id: c.id, owner: KEY, ctrl: KEY, d: c.d, zone: 'hand', counters: {}, face: 0 };
    const CD = window.Cards;
    let mode = null, x = 0;
    const md = CD.modesOf(card);
    if (md) {
      const n = md.pick === 'many' ? 1 : md.pick || 1;
      const picks = [];
      for (let i = 0; i < n; i++) {
        const v = await phoneAsk(`${c.d.n}: choose a mode${n > 1 ? ` (${i + 1} of ${n})` : ''}`, md.modes.map((m, k) => ({ label: m, value: k })).filter(o => !picks.includes(o.value)));
        if (v == null) return; picks.push(v);
      }
      mode = picks;
    }
    if (CD.costOf(card).x) { const v = await phoneAsk(`${c.d.n}: choose X`, Array.from({ length: 13 }, (_, k) => ({ label: String(k), value: k }))); if (v == null) return; x = v; }
    const reqs = CD.targetReqs(card, mode);
    const tg = [];
    // Every target is chosen as the spell is cast (601.2c); a spell that needs a target it can't get stays in hand.
    for (const req of reqs) if (!req.upTo && !CD.targetChoices(G.S, req, KEY).length) { phoneBanner(`${c.d.n} needs ${CD.reqLabel(req)}, and there isn’t a legal one — it stays in your hand.`); return; }
    for (let ri = 0; ri < reqs.length; ri++) {
      const req = reqs[ri];
      const choices = CD.orderChoices(G.S, CD.targetChoices(G.S, req, KEY), KEY, CD.helpfulTarget(card, mode, ri));
      const lab = t => t.p ? (t.p === KEY ? 'You' : R.nameOf(G.S, t.p)) : (G.S.cards[t.c].ctrl === KEY ? 'Your ' : R.nameOf(G.S, G.S.cards[t.c].ctrl) + '’s ') + R.cardName(G.S.cards[t.c]) + (G.S.cards[t.c].zone === 'stack' ? ' (spell)' : G.S.cards[t.c].zone === 'graveyard' ? ' (graveyard)' : '');
      const picked = [];
      const max = Math.min(req.n, 10);
      for (let i = 0; i < max; i++) {
        const opts = choices.filter(t => !picked.some(p => (p.c && p.c === t.c) || (p.p && p.p === t.p))).map(t => ({ label: lab(t), value: t }));
        if (!opts.length) break;
        if (req.upTo || i > 0) opts.push({ label: i > 0 ? 'Done' : 'No target', value: '__none' });
        const v = await phoneAsk(`${c.d.n}: choose ${CD.reqLabel(req)}${reqs.length > 1 ? ` (${ri + 1} of ${reqs.length})` : max > 1 ? ` (${i + 1})` : ''}`, opts);
        if (v == null) return;
        if (v === '__none') break;
        picked.push(v);
      }
      if (!picked.length && !req.upTo) return;
      tg.push(picked);
    }
    // Ward on a target (702.21a): pay it, or the spell will be countered.
    const warded = [].concat(...tg).map(t => t.c && G.S.cards[t.c]).filter(w => w && w.ctrl !== KEY && CD.has(w, 'ward', G.S));
    let wardPaid = false, wardMana = 0;
    if (warded.length) {
      const costs = warded.map(w => { const k = CD.wardCost(w) || { mana: 0, text: 'its ward cost' }; return { mana: k.mana, text: k.text, name: R.cardName(w) }; });
      wardMana = costs.reduce((a, c) => a + c.mana, 0);
      const v = await phoneAsk(`${costs.map(c => `${c.name} has ward — ${c.text}`).join('; ')}. Pay it, or ${c.d.n} is countered.`, [{ label: `Pay ${costs.map(c => c.text).join(' + ')} and cast`, value: 'pay' }, { label: 'Cast without paying', value: 'no' }]);
      if (v == null) return;
      wardPaid = v === 'pay';
    }
    const cst = CD.costOf(card); if (wardPaid) cst.g += wardMana;
    if (G.autoPay && !(await G.autoPay(card, x, cst))) { phoneBanner('Not enough untapped mana to pay for it automatically.'); return; }
    await G.castFromHand(id, { tg: reqs.length ? tg : undefined, mode: mode || undefined, x: x || undefined, wardPaid: wardPaid || undefined, fromPool: G.lastFromPool });
  }
  G.phoneSync = phoneSync;

  function onPhoneMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hi') return phoneSync();
    if (m.t === 'chosen') { const f = phoneAsks.get(m.rid); if (f) { phoneAsks.delete(m.rid); f(m.value === undefined ? null : m.value); } return; }
    if (m.t === 'pass') { G.pass(); return; }
    if (m.t === 'play') {
      const id = m.id, h = m.how;
      if (!P.hand.some(c => c.id === id)) return;
      if (h === 'auto') { const c = P.hand.find(x => x.id === id); if (isLand(c)) G.playLand(id); else castFromPhone(id); }
      else if (h === 'land') G.playLand(id);
      else if (h === 'cast') castFromPhone(id);
      else if (h === 'battlefield') G.fromHand([id], 'battlefield');
      else if (h === 'tapped') G.fromHand([id], 'battlefield', { tapped: true });
      else if (h === 'facedown') G.fromHand([id], 'battlefield', { faceDown: true });
      else if (h === 'stack') G.fromHand([id], 'stack');
      else if (h === 'graveyard') G.fromHand([id], 'graveyard');
      else if (h === 'exile') G.fromHand([id], 'exile');
      else if (h === 'top' || h === 'bottom') G.handToLibrary([id], h);
      else if (h === 'reveal') G.toggleReveal(id);
    }
    if (m.t === 'draw') G.draw(1);
    if (m.t === 'chat' && typeof m.text === 'string' && m.text.trim()) { const ais = G.S.seats.filter(p => G.S.players[p] && G.S.players[p].ai); const to = ais.includes(m.to) ? m.to : ais[0]; if (to) act({ type: 'aiAsk', to, text: m.text.trim().slice(0, 300) }); }
    if (m.t === 'opening') G.openingHand();
    if (m.t === 'keep') G.keep();
    if (m.t === 'mulligan') G.mulligan();
    if (m.t === 'bottom' && Array.isArray(m.ids)) G.bottomChosen(m.ids);
  }

  G.startPhoneLink = function () {
    if (G.phone || MODE !== 'table' || G.dead) return;
    G.phone = new Net.PhoneLink(G.PHONE_ID, G.PHONE_SECRET, onPhoneMsg, linked => {
      G.phoneLinked = linked;
      if (me()) act({ type: 'player', patch: { phone: linked } });
      if (linked) { P.handHere = false; G.toast('Phone linked. Your hand is on your phone now.', 'info'); phoneSync(); }
      else G.toast('Phone disconnected. Your hand is back on this screen.', 'info');
      G.render();
    }, {
      ask: (req, answer) => G.askPhone ? G.askPhone(req, answer) : answer(false),
      trusted: dev => (LS.get('kt:phones', []) || []).includes(dev),
      trust: dev => { const l = LS.get('kt:phones', []) || []; if (!l.includes(dev)) { l.push(dev); LS.set('kt:phones', l.slice(-5)); } }
    });
    G.phone.listen();
    // keep the phone up to date with the turn, even when the hand doesn't change
    if (!G._phonePing) G._phonePing = setInterval(() => { if (G.phone && G.phone.linked) G.phone.send({ t: 'ping' }); }, 4000);
  };
  // Make a new phone code: the old QR stops working and phones must be approved again.
  G.resetPhone = async function () {
    if (G.phone) await G.phone.revoke();
    G.phone = null; G.phoneLinked = false;
    const ps = Net.rid(24); LS.set('kt:phoneSecret', ps); LS.set('kt:phones', []);
    G.PHONE_SECRET = ps; G.PHONE_ID = await Net.phoneIdFor(TABLE, ps);
    if (me()) act({ type: 'player', patch: { phone: false } });
    G.startPhoneLink();
    G.render();
  };
  G.phoneURL = () => location.origin + location.pathname + '?t=' + encodeURIComponent(TABLE) + '&k=' + encodeURIComponent(G.PHONE_SECRET) + '&m=hand';
  G.inviteURL = () => location.origin + location.pathname + '?t=' + encodeURIComponent(TABLE);

  // ---------------- start ----------------
  // Your name (a second player in this tab keeps their own name in this tab only).
  G.myName = () => { if (G.tabPlayer) { try { return sessionStorage.getItem('kt:name:tab') || ''; } catch (e) { return ''; } } return LS.get('kt:name', ''); };
  G.setMyName = n => { if (G.tabPlayer) { try { sessionStorage.setItem('kt:name:tab', n); } catch (e) {} } else LS.set('kt:name', n); };
  // Play a different seat in this tab (the browser's own player stays in the other tab).
  G.newTabPlayer = async function () {
    const id = await Net.makeIdentity(null);
    try { sessionStorage.setItem('kt:ident:tab', JSON.stringify(id.jwk)); } catch (e) {}
    location.reload();
  };
  G.start = function (name) {
    if (G.table || !G.identity) return;
    G.table = new Net.Table({
      table: TABLE, identity: G.identity, name,
      snapshot: LS.get('kt:pub:' + TABLE, null),
      onState,
      onStatus: (st, msg) => { G.status = st; G.statusMsg = msg || ''; G.render(); },
      onSleeve: () => G.render(),
      roster: LS.get('kt:roster:' + TABLE, []),
      saveRoster: r => LS.set('kt:roster:' + TABLE, r),
      onReplaced: sameAsHost => {
        // Another tab took over this seat: let go of the phone and stop saving, so the two tabs never fight.
        G.replaced = sameAsHost ? 'host' : true; G.dead = true;
        if (G.phone) { G.phone.close(); G.phone = null; }
        clearInterval(G._phonePing); G._phonePing = null;
        G.render();
      },
      onStepDown: () => G.toast('Your connection dropped and another player is hosting now. Anything you did in the last few seconds may need redoing.', 'alert')
    });
    const deck = P.deckId && G.decks().find(d => d.id === P.deckId);
    if (deck) G.table.mySleeve = Net.cleanLook(G.lookOf(deck));
    G.table.start();
  };
})();
