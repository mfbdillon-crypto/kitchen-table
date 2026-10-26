// Kitchen Table — the AI player (v2: the planning AI).
// It runs as a hidden copy of the site (?m=ai&ai=<id>) inside the page of the player who added it, so it sits at
// the table exactly like a person: its own hidden hand and library, and every move goes through the table host's
// rules checks. The thinking is in aibrain.js (plans, saved responses, scenarios, log) and the doing in aiexec.js.
// It stays quiet at the table: it only answers when someone asks it a question, and then only about the rules and
// public information — never its hand or what it is holding back.
(function () {
  'use strict';
  const G = window.KT;
  if (!G || G.MODE !== 'ai') return;
  const R = Rules, C = Cards;
  let cfg = null, brain = null, exec = null;
  const skill = () => (G.me() && G.me().ai && G.me().ai.skill) || (cfg && cfg.skill) || 'normal';
  const ME = () => G.KEY;
  const S = () => G.S;
  const nameOf = pid => R.nameOf(S(), pid);
  const cn = c => R.cardName(c);
  const tell = msg => { try { parent.postMessage(Object.assign({ kt: 'ai', id: G.AI_ID }, msg), location.origin); } catch (e) {} };
  const precon = () => { const d = (G.decks() || []).find(x => x.id === G.P.deckId) || (G.decks() || [])[0]; return d && d.src ? (window.KT_PRECONS || []).find(p => p.id === d.src) : null; };

  // ---------------- the brain and its hands ----------------
  const isLand = c => G.isLand(c);
  const io = {
    s: () => G.S, me: () => G.KEY, hand: () => G.P.hand, lib: () => G.P.library.slice().sort((a, b) => (a.d.n < b.d.n ? -1 : 1)),
    act: a => G.act(a),
    castFromHand: async (id, o) => { await G.castFromHand(id, o); return { ok: !G.P.hand.some(c => c.id === id), err: 'the table refused the spell' }; },
    castPublic: (id, o) => G.castPublic(id, o),
    playLand: async id => {
      const T = G.S.turn;
      if (((T.lands || {})[G.KEY] || 0) >= 1) { await G.fromHand([id], 'battlefield', { playLand: true }); return { ok: !G.P.hand.some(c => c.id === id), err: 'extra land refused' }; }
      return G.playLand(id);
    },
    tapPay: ids => G.tap(ids, true, true),
    privPhase: () => G.P.phase, mulls: () => G.P.mull || 0, bottomN: () => G.P.bottomN || 0,
    openingHand: () => G.openingHand(), keep: () => G.keep(), mulligan: () => G.mulligan(), bottom: ids => G.bottomChosen(ids),
    drawForTurn: () => { const T = G.S.turn; if (!T || T.active !== G.KEY || T.phase < R.PI('Draw') || G.P.phase !== 'kept') return false; const k = G.S.gameId + ':' + T.n; if (G.P.autoDrew === k) return false; G.autoDraw(); return G.P.autoDrew === k; },
    draw: (n, why) => G.draw(n, why), mill: n => G.mill(n),
    discard: (ids, why) => G.fromHand(ids, 'graveyard', { msg: `discarded {cards}${why ? ' (' + why + ')' : ''}` }),
    libTop: n => G.P.library.slice(0, n),
    applyLook: (mode, n, decisions) => G.applyLook(mode, n, decisions),
    searchTake: (ids, t) => G.fetchLands(ids, t),
    cascadeReveal: (mv, top) => G.cascadeReveal(mv, top),
    cascadeDecline: id => G.cascadeDecline(id),
    handToTop: ids => G.handToLibrary(ids, 'top'),
    impulse: t => G.impulse(t),
    digFind: t => G.digFind(t),
    routePlan: t => G.routePlan(t), routeApply: (t, d) => G.routeApply(t, d),
    digFinish: (t, hits, rest, dest) => G.digFinish(t, hits, rest, dest),
    fromHand: (ids, zone, o) => G.fromHand(ids, zone, o),
    move: (ids, to, extra) => G.move(ids, to, null, extra),
    castFromLibrary: async (id, o) => { await G.castFromLibrary(id, o); return { ok: !G.P.library.some(c => c.id === id), err: 'the table refused the spell' }; },
    playTop: async (id, perm) => { await G.fromLibrary([id], 'battlefield', { playLand: true, perm }); return { ok: !G.P.library.some(c => c.id === id), err: 'the table refused the land' }; }
  };
  function setup() {
    const pc = precon();
    const id = pc ? pc.id : null;
    if (brain && brain.deckId === id && brain.level === skill()) return;
    const old = brain;
    brain = new AIBrain({ me: G.KEY, level: skill(), deckId: id, bracket: pc ? pc.bracket : 2 });
    if (old) { brain.log = old.log; brain.note('setup', `difficulty ${skill()}, deck ${pc ? pc.name : 'unknown'}`); }
    exec = new AIExec(brain, io);
    G.brain = brain; G.aiExec = exec;
  }

  // ---------------- answering questions (rules and public information only) ----------------
  // ---------------- answering questions ----------------
  const FAQ = [
    [/flying/, 'Flying: a creature with flying can be blocked only by creatures with flying or reach (702.9b).'],
    [/reach/, 'Reach: a creature with reach can block creatures with flying (702.17b).'],
    [/trample/, 'Trample: if it’s blocked, it only has to assign lethal damage to its blockers; the rest can go to the player it’s attacking (702.19b).'],
    [/deathtouch/, 'Deathtouch: any damage it deals to a creature is enough to destroy it, and 1 damage counts as lethal when assigning combat damage (702.2).'],
    [/double strike/, 'Double strike: it deals combat damage twice — in the first-strike step and the regular step (702.4).'],
    [/first strike/, 'First strike: it deals its combat damage before creatures without first strike (702.7).'],
    [/lifelink/, 'Lifelink: damage it deals also makes its controller gain that much life (702.15).'],
    [/vigilance/, 'Vigilance: attacking doesn’t cause it to tap (702.20).'],
    [/menace/, 'Menace: it can’t be blocked except by two or more creatures (702.110).'],
    [/haste/, 'Haste: it can attack and use {T} abilities the turn it comes under your control (702.10).'],
    [/hexproof/, 'Hexproof: it can’t be the target of spells or abilities your opponents control (702.11).'],
    [/shroud/, 'Shroud: it can’t be the target of any spells or abilities (702.18).'],
    [/indestructible/, 'Indestructible: it isn’t destroyed by lethal damage or “destroy” effects (702.12).'],
    [/defender/, 'Defender: it can’t attack (702.3).'],
    [/flash/, 'Flash: you can cast it any time you could cast an instant (702.8).'],
    [/toxic/, 'Toxic N: when it deals combat damage to a player, it deals that damage normally AND that player gets N poison counters. Ten poison counters and that player loses (702.164, 704.5c).'],
    [/infect|poison/, 'Infect: damage to players is dealt as poison counters (10 poison and you lose), and to creatures as −1/−1 counters (702.90).'],
    [/summoning sick|sickness|just came in|why can't .*attack/, 'Summoning sickness: a creature can’t attack or use {T} abilities unless its controller has controlled it continuously since their most recent turn began — unless it has haste (302.6).'],
    [/land.*(turn|once|two|second|extra)|play.*land/, 'Lands: you may play one land per turn, during your main phase, when the stack is empty (305.2). Extra land drops only come from effects — use the Move to option for those.'],
    [/commander tax|tax/, 'Commander tax: each time you cast your commander from the command zone, it costs {2} more for each previous time (903.8).'],
    [/commander damage|21/, 'Commander damage: a player who has been dealt 21 or more combat damage by the same commander loses the game (903.10a).'],
    [/mulligan/, 'Mulligans here: your first mulligan in Commander is free, then each later one means putting one more card on the bottom (London mulligan, 103.5).'],
    [/stack|priority|respond|in response/, 'The stack: when a spell is cast, every player gets a chance to respond in turn order. A response resolves first (last in, first out). When everyone passes in a row, the top spell resolves (117, 405).'],
    [/fizzle|target.*(gone|left|illegal)|counter.*rules/, 'If every target of a spell is gone or illegal when it tries to resolve, it doesn’t resolve at all (608.2b).'],
    [/legend/, 'Legend rule: if you control two legendary permanents with the same name, you choose one and put the other into the graveyard (704.5j).'],
    [/block.*(two|more|multiple)|two blockers/, 'Each creature can block only one attacker, but several creatures can block the same attacker (509.1).'],
    [/damage.*(wear|go away|reset|heal)/, 'Damage on creatures wears off during the cleanup step at the end of each turn (514.2).'],
    [/toughness.*\b0\b|\b0 toughness|zero toughness/, 'A creature with 0 or less toughness goes to its owner’s graveyard (704.5f).'],
    [/monarch/, 'The monarch draws an extra card at their end step; dealing combat damage to the monarch steals it (724).'],
    [/mana value|cmc|converted/, 'Mana value is the total amount of mana in a card’s mana cost; X counts as 0 except on the stack (202.3).'],
    [/hand size|discard.*(seven|7)|maximum/, 'Hand size: at your cleanup step you discard down to seven cards (514.1).'],
    [/\bward\b/, 'Ward: whenever it becomes the target of a spell or ability an opponent controls, that spell or ability is countered unless its controller pays the ward cost (702.21).'],
    [/protection/, 'Protection from a quality (a color, creatures…): it can’t be blocked, targeted, dealt damage, or enchanted/equipped by anything with that quality (702.16).'],
    [/counterspell|counter a spell|countered/, 'A countered spell goes to its owner’s graveyard without doing anything (701.6).']
  ];
  const answered = new Set();

  const lastDid = re => { if (!brain) return null; for (let i = brain.log.length - 1; i >= 0; i--) { const e = brain.log[i]; if (e.kind === 'did' && !/searched|looked at|scry|surveil|end turn|discarded/.test(e.text) && (!re || re.test(e.text))) return e; } return null; };
  function answer(q) {
    const s = S(), t = String(q.text || '').toLowerCase();
    const faqs = FAQ.filter(([re]) => re.test(t)).slice(0, 2).map(f => f[1]);
    // A card on the table the question is about (longest name wins; never cards in hidden zones).
    const pool = Object.values(s.cards).filter(c => !c.faceDown && c.d && c.zone !== 'library' && c.zone !== 'hand');
    let card = null; for (const c of pool) { const n = cn(c).toLowerCase(), short = n.split(',')[0]; if ((n.length > 3 && t.includes(n)) || (short.length > 4 && t.includes(short))) if (!card || n.length > cn(card).length) card = c; }
    const cardLine = c => `${cn(c)} (${R.typeLine(c)}${C.pt(s, c) ? ', now ' + C.pt(s, c).join('/') : ''}): “${(C.rawText ? C.rawText(c) : C.text(c)).replace(/\n/g, ' ').replace(/\([^)]*\)/g, '').slice(0, 300)}”`;
    // "Why did you attack me / block / target that?" — my last public move of that kind, with its public reason.
    if (/\bwhy\b|legal|allowed|cheat|illegal/.test(t)) {
      const kind = /attack/.test(t) ? /attacked|no attack/ : /block/.test(t) ? /blocked|no blocks/ : card ? new RegExp(cn(card).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
      const e = lastDid(kind);
      if (e) {
        const legal = /legal|allowed|cheat|illegal/.test(t) ? 'Yes, it was legal — the table checks every move before allowing it. ' : '';
        const what = e.text.replace(/ — in hand:.*$/, '').replace(/\(holding [^)]*\)/, '').replace(/ \(.*\)$/, '');
        const reason = /attacked/.test(e.text) ? ' I attack whoever threatens my game plan most, where my creatures get through or trade well — not whoever attacked me last.' : /blocked/.test(e.text) ? ' I block when it kills the attacker, survives, or keeps me alive; I don’t throw away creatures my plan needs.' : '';
        return { text: `${legal}I ${what.replace(/^(attacked|blocked|cast|no attack|no blocks)/, m => m)}.${reason}` };
      }
    }
    // Rules questions: the rule, plus the card's text when a card is named.
    if (faqs.length || card) {
      const parts = [];
      if (faqs.length) parts.push(faqs.join(' '));
      if (card) parts.push(cardLine(card) + (/\b(does|do|is|can|will|would)\b/.test(t) ? ' The table applies this automatically when it happens.' : ''));
      return { text: parts.join(' ') };
    }
    if (/(plan|strategy|thinking|next|going to|hold|holding)/.test(t)) return { text: 'I keep my plans to myself — that’s hidden information, like a player’s hand.' };
    if (/(hand|cards in|how many cards)/.test(t)) return { text: `I have ${G.P.hand.length} card${G.P.hand.length === 1 ? '' : 's'} in hand and ${G.P.library.length} in my library.` };
    if (/(life|winning|ahead|score|poison)/.test(t)) return { text: s.seats.map(p => `${nameOf(p)}: ${s.players[p].life}${s.players[p].poison ? ' (' + s.players[p].poison + ' poison)' : ''}`).join(' · ') };
    if (/(mana|untapped|lands)/.test(t)) { const n = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === ME() && !c.tapped && C.manaSource(c)).length; return { text: `I have ${n} untapped mana source${n === 1 ? '' : 's'} on the battlefield — you can see them on my side of the table.` }; }
    if (/(skill|level|difficulty|how good)/.test(t)) return { text: `I’m playing on ${skill()}. The player who added me can change it.` };
    return { text: 'Ask me about the rules, a card on the table, or a move I made — I don’t share my hand or my plans.' };
  }

  // ---------------- one step ----------------
  async function step() {
    const s = S(), me = G.me();
    if (!s) return false;
    if (!me) {
      if ((G.status === 'host' || G.status === 'connected') && s.seats.length < R.MAX_SEATS && !G.joining) {
        G.joining = true;
        const r = await G.act({ type: 'join', name: cfg.name, ai: { skill: cfg.skill, by: cfg.owner, v: 2 } });
        G.joining = false;
        if (r.kicked) { G.dead = true; tell({ t: 'removed' }); return false; }
        return r.ok;
      }
      return false;
    }
    if (!me.ai && cfg) { await G.act({ type: 'aiMeta', restore: true, by: cfg.owner, skill: cfg.skill, v: 2 }); return true; }
    if (me.ai && (me.ai.v !== 2 || (cfg && cfg.skill && me.ai.skill !== cfg.skill))) { await G.act({ type: 'aiMeta', skill: cfg.skill, v: 2 }); return true; }
    // Questions for me (the only time I talk).
    for (const q of (s.aichat || []).filter(m => m.kind === 'q' && m.to === ME() && !answered.has(m.id))) {
      answered.add(q.id);
      if ((s.aichat || []).some(m => m.kind === 'a' && m.re === q.id) || Date.now() - q.t > 5 * 60000) continue;
      const a = answer(q);
      await G.act({ type: 'aiSay', kind: 'a', re: q.id, text: a.text });
      return true;
    }
    if (me.lost || s.winner) return false;
    // Deck.
    if (!G.P.deckId && !G.P.library.length && !G.P.hand.length) {
      const deck = G.decks()[0];
      if (deck && !G.loadingDeck) { G.loadingDeck = true; try { await G.useDeck(deck); } finally { G.loadingDeck = false; } return true; }
      return false;
    }
    if (G.P.phase === 'none' && !G.P.hand.length && G.P.library.length && G.P.deckId && s.turn.active) { G.openingHand(); return true; }
    setup();
    return exec.step();
  }

  // ---------------- the loop: as fast as the table answers ----------------
  let busy = false, nextAt = 0, waitRev = -1, waitUntil = 0;
  async function tick() {
    if (busy || !cfg || G.dead) return;
    const now = Date.now();
    if (now < nextAt) return;
    const s = S();
    if (waitRev >= 0 && s && s.rev <= waitRev && now < waitUntil) return;   // wait for my last move to come back from the host
    busy = true;
    try {
      const before = s ? s.rev : -1;
      const did = await step();
      if (did) { waitRev = before; waitUntil = Date.now() + 3000; nextAt = Date.now() + 40; }
      else { waitRev = -1; nextAt = Date.now() + 250; }
    } catch (e) { console.error('[ai]', e); if (brain) brain.note('error', e.message); nextAt = Date.now() + 1500; }
    finally { busy = false; }
  }
  // Effects that need my hand or library (draw and mill are done by the page itself).
  G.onTodo = async function (t, ack) { try { setup(); await exec.onTodo(t); } catch (e) { console.error(e); } ack(); };

  addEventListener('message', async e => {
    if (e.origin !== location.origin || !e.data || e.data.kt !== 'owner') return;
    const m = e.data;
    if (m.t === 'skill' && ['easy', 'normal', 'hard'].includes(m.v)) { cfg.skill = m.v; G.LS.set('kt:aicfg', cfg); }
    if (m.t === 'deck' && m.deck) { G.saveDecks([m.deck]); cfg.deckId = m.deck.id; G.LS.set('kt:aicfg', cfg); if (G.me()) await G.useDeck(m.deck); }
    if (m.t === 'remove') { cfg = null; if (G.me()) await G.act({ type: 'leave' }); G.dead = true; tell({ t: 'removed' }); }
  });

  G.toast = (text, kind) => { if (kind === 'err') console.warn('[ai]', text); };
  G.askCommander = c => G.move([c.id], 'command');
  G.askZero = c => G.move([c.id], 'graveyard');
  G.ready.then(() => {
    cfg = G.LS.get('kt:aicfg', null);
    if (!cfg) { tell({ t: 'noconfig' }); return; }
    G.myName = () => cfg.name; G.setMyName = () => {};
    G.start(cfg.name);
    Net.ticker.every(120, tick);
    tell({ t: 'started', pid: G.KEY });
  });
  G.aiSnapshot = () => brain ? brain.snapshot() : null;
})();
