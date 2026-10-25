// Kitchen Table — the rules engine for triggered abilities, temporary effects and turn flow (v6).
// rules.js reports what happens (cards changing zones, spells cast, attacks, blocks, combat damage, life
// changes, steps of the turn) and this file:
//   • finds every triggered ability that triggers (603.2), checks intervening "if" conditions (603.4),
//   • puts them on the stack the next time a player would get priority, active player's first (APNAP, 603.3b),
//     choosing targets as they go on the stack (603.3d) — the controller is asked when there is a real choice,
//   • asks "use it?" for optional ("you may") abilities when they resolve,
//   • carries out what the ability says (effects.js), and hands anything it can't do to the controller by name,
//   • keeps "until end of turn" changes as badges/counters on the card and removes them in the cleanup step (514.2),
//   • moves the turn along by itself: untap → upkeep → draw → main 1, then "Go to combat" or "End turn".
(function (root) {
  'use strict';
  const I = () => root.Rules && root.Rules._int;
  const Cd = () => root.Cards;
  const O = () => root.Oracle;
  const ASK_MS = 120000;                 // 2 minutes, then the table decides
  let EV = [];
  const META = new WeakMap();
  const STEP_KEY = { 'Upkeep': 'upkeep', 'Draw': 'draw', 'Main 1': 'main1', 'Beginning of combat': 'combat', 'End of combat': 'endCombat', 'Main 2': 'main2', 'End step': 'end' };

  function emit(e) { if (EV.length < 400) EV.push(e); }
  function lifeMap(s) { const o = {}; for (const p of s.seats || []) if (s.players[p]) o[p] = s.players[p].life; return o; }
  function meta(s) {
    let m = META.get(s);
    if (!m) { m = { life: lifeMap(s), turn: s.turn ? { n: s.turn.n, phase: s.turn.phase } : null }; META.set(s, m); }
    return m;
  }
  function begin(s) { meta(s); }
  function stats(s) { const T = s.turn; T.stats = T.stats || { attacked: {}, died: 0, gained: {}, lost: {}, spells: {}, drew: {} }; return T.stats; }
  // A copy of a card as it was (for "leaves the battlefield" abilities, which look back in time — 603.10).
  function snap(c) { return Object.assign({}, c, { counters: Object.assign({}, c.counters || {}), wasCre: !!(c.faceDown || (I() && I().isType(c, 'creature'))), pw: (Cd() && Cd().pt(null, c) || [0, 0])[0] }); }
  function cardName(c) { return I().cardName(c); }
  function nameOf(s, p) { return I().nameOf(s, p); }
  // The old AI takes the table's default choices; the planning AI (ai.v === 2) is asked like a person.
  const isAI = (s, p) => !!(s.players[p] && s.players[p].ai && s.players[p].ai.v !== 2);
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9+/]+/g, ' ').trim();

  // ======================= finding triggers =======================
  // Turn the raw reports into trigger events, then look at every permanent's triggered abilities.
  function check(s, notes) {
    const R = I(); if (!R || !s.turn || !s.turn.active || !O()) { EV = []; return 0; }
    const m = meta(s), T = s.turn, st = stats(s);
    const raw = EV.splice(0);
    const evs = [];
    // Life totals that changed (119.9 "gains life", "loses life").
    for (const pid of s.seats) {
      const P = s.players[pid]; if (!P) continue;
      if (P.lifeLock && P.life !== P.lifeLock.v) P.life = P.lifeLock.v;   // Teferi's Protection: the life total can't change
      const was = m.life[pid];
      if (was != null && P.life !== was) {
        const d = P.life - was;
        evs.push({ type: d > 0 ? 'gainLife' : 'loseLife', player: pid, n: Math.abs(d) });
        (d > 0 ? st.gained : st.lost)[pid] = (((d > 0 ? st.gained : st.lost)[pid]) || 0) + Math.abs(d);
      }
    }
    m.life = lifeMap(s);
    for (const pid of s.seats) { const P = s.players[pid]; if (P && P.lifeLock && P.life !== P.lifeLock.v) { P.life = P.lifeLock.v; m.life[pid] = P.life; } }
    // Steps of the turn that began since the last look.
    if (m.turn) {
      const steps = [];
      if (T.n === m.turn.n) { for (let i = m.turn.phase + 1; i <= T.phase; i++) steps.push(i); }
      else if (T.n > m.turn.n) { for (let i = 1; i <= T.phase; i++) steps.push(i); }
      for (const i of steps) {
        const k = STEP_KEY[R.PHASES[i]]; if (!k) continue;
        evs.push({ type: 'step', step: k, player: T.active });
        if (k === 'main1') loreUp(s, T.active, evs, notes);
        if (k === 'upkeep') for (const c of Object.values(s.cards)) if (c.zone === 'exile' && c.rebound && c.rebound.by === T.active && c.rebound.after < T.n) { R.todo(s, T.active, { k: 'freeCast', from: 'exile', ids: [c.id], filter: 'card', src: cardName(c) + ' (rebound)' }); c.rebound = null; notes.push(`${nameOf(s, T.active)} may cast ${cardName(c)} again for free (rebound)`); }
        if (k === 'upkeep' && s.delayedDraws && s.delayedDraws.length) {
          const due = s.delayedDraws.filter(x => x.after < T.n);
          for (const x of due) { R.todo(s, x.pid, { k: 'draw', n: x.n, src: x.src }); notes.push(`${nameOf(s, x.pid)} draws ${x.n > 1 ? x.n + ' cards' : 'a card'} (${x.src})`); }
          s.delayedDraws = s.delayedDraws.filter(x => !due.includes(x));
        }
        if ((k === 'main1' || k === 'main2') && s.delayedMana && s.delayedMana.length) {
          const due = s.delayedMana.filter(x => x.pid === T.active && (x.after < T.n || k === 'main2' && x.after === T.n && x.step !== 'main2'));
          for (const x of due) { R.addPool(s, x.pid, Array(x.n).fill('C')); notes.push(`${nameOf(s, x.pid)} added {C}×${x.n} (${x.src})`); }
          s.delayedMana = s.delayedMana.filter(x => !due.includes(x));
        }
        // 724.2: the monarch draws a card at the beginning of their end step.
        if (k === 'end' && s.table && s.table.monarch === T.active) { R.todo(s, T.active, { k: 'draw', n: 1, src: 'the monarch' }); notes.push(`${nameOf(s, T.active)} draws a card for being the monarch`); }
      }
    }
    m.turn = { n: T.n, phase: T.phase };
    // Zone changes.
    const left = [];
    for (const e of raw) {
      // 724.2: combat damage to the monarch makes the attacking creature's controller the monarch.
      if (e.type === 'combatDamage' && e.to === 'player' && s.table && s.table.monarch === e.player && e.card && e.card.ctrl !== e.player) { s.table.monarch = e.card.ctrl; notes.push(`${nameOf(s, e.card.ctrl)} became the monarch (combat damage to the monarch)`); }
      if (e.type !== 'zone') { evs.push(e); continue; }
      const c = e.card, now = s.cards[c.id];
      if (e.to === 'battlefield' && e.from !== 'battlefield' && now) {
        evs.push({ type: 'enter', card: now, player: now.ctrl, from: e.from });
        // Evoke (702.74a): "When it enters, if its evoke cost was paid, its controller sacrifices it."
        if (now.alt === 'evoke') { s.tq = s.tq || []; s.tq.push({ id: 'q' + (++s.seq), src: now.id, name: cardName(now), d: now.d, face: now.face || 0, ctrl: now.ctrl, i: -1, text: 'Evoke', effect: 'sacrifice this.', fixed: [{ op: 'sacrifice', what: { k: 'self' } }], optional: false, ctx: ctxOf(s, { card: now }), t: Date.now() }); }
        // Blitz: "When this creature dies, draw a card."
        if (now.alt === 'blitz') now.blitzed = true;
        asEnters(s, now, notes);
        if (now.zone === 'battlefield' && /\bsaga\b/i.test(R.typeLine(now)) && !now.faceDown) { now.counters.lore = (now.counters.lore || 0) + 1; evs.push({ type: 'chapter', card: now, n: now.counters.lore }); }
      }
      if (e.from === 'battlefield' && e.to !== 'battlefield') {
        left.push(c);
        if (e.to === 'graveyard' && c.wasCre) { evs.push({ type: 'die', card: c, ctrl: c.ctrl, player: c.ctrl }); st.died++; if (c.blitzed) { R.todo(s, c.ctrl, { k: 'draw', n: 1, src: cardName(c) + ' (blitz)' }); notes.push(`${nameOf(s, c.ctrl)} draws a card — ${cardName(c)} was blitzed and died`); } }
        evs.push({ type: 'leave', card: c, to: e.to });
        if (e.sac) evs.push({ type: 'sacrifice', card: c, player: c.ctrl });
      }
      if (e.to === 'graveyard') evs.push({ type: 'toGraveyard', card: now || c, from: e.from });
    }
    ringEvents(s, evs, notes);
    if (!evs.length) return place(s, notes);
    const onBf = Object.values(s.cards).filter(c => c.zone === 'battlefield' && !c.faceDown && c.d);
    const leftIds = new Set(left.map(c => c.id));
    const manyDone = new Set();
    let found = 0;
    for (const ev of evs) {
      const pool = onBf.slice();
      if (ev.type === 'die' || ev.type === 'leave') for (const c of left) if (!pool.some(x => x.id === c.id)) pool.push(c);
      if (ev.type === 'toGraveyard' && ev.card && ev.card.zone === 'graveyard' && !pool.includes(ev.card)) pool.push(ev.card);
      if (ev.type === 'cast' && ev.card && ev.card.zone === 'stack' && !pool.includes(ev.card)) pool.push(ev.card);   // "When you cast this spell" (cascade, Eldrazi)
      for (const src of pool) {
        if (!src.d || src.faceDown) continue;
        const M = O().model(src); if (!M) continue;
        M.abilities.forEach((a, i) => {
          if (a.kind !== 'triggered' || !a.event || a.event.type === 'other') return;
          const isLeave = a.event.type === 'die' || a.event.type === 'leave';
          if (leftIds.has(src.id) && !isLeave && !(ev.type === 'toGraveyard' && a.event.type === 'toGraveyard')) return;
          if (src.zone === 'graveyard' && a.event.type !== 'toGraveyard') return;
          if (src.zone === 'stack' && !(a.event.type === 'cast' && a.event.self)) return;
          if (src.zone === 'battlefield' && a.event.type === 'cast' && a.event.self) return;
          let ok = false; try { ok = O().fires(s, src, a, ev); } catch (e) { ok = false; }
          if (!ok) return;
          if (/\bone or more\b/.test(a.eventText || '') || a.event.many) { const k = src.id + '#' + i + '#' + (ev.player || ''); if (manyDone.has(k)) return; manyDone.add(k); }
          if (a.oncePerTurn || (a.event && a.event.firstEachTurn)) { T.once = T.once || {}; const k = src.id + '#' + i; if (T.once[k] === T.n) return; T.once[k] = T.n; }
          const cond = a.condition ? O().conditionHolds(s, src, a.condition) : true;
          if (cond === false) return;
          const times = triggerTimes(s, src, ev);
          for (let k = 0; k < times; k++) { queue(s, src, a, i, ev, cond === null); found++; }
        });
      }
    }
    return place(s, notes);
  }
  // The Ring's abilities (701.54c): level 2 loots when the Ring-bearer attacks, level 3 makes its blockers be sacrificed
  // at end of combat, level 4 drains 3 when it deals combat damage to a player.
  function ringBearerOf(s, c) { const P = c && s.players[c.ctrl]; return P && P.ring && P.ringBearer === c.id ? P.ring : 0; }
  function ringEvents(s, evs, notes) {
    const R = I();
    for (const ev of evs) {
      if (ev.type === 'attack' && ev.card && ringBearerOf(s, ev.card) >= 2) { R.todo(s, ev.card.ctrl, { k: 'draw', n: 1, src: 'the Ring' }); R.todo(s, ev.card.ctrl, { k: 'discard', n: 1, src: 'the Ring' }); notes.push(`${cardName(ev.card)} attacks with the Ring: draw a card, then discard a card`); }
      if (ev.type === 'block' && ev.att && s.cards[ev.att] && ringBearerOf(s, s.cards[ev.att]) >= 3 && ev.card) { s.delayed = (s.delayed || []).concat([{ step: 'endCombat', id: ev.card.id, to: 'graveyard', sac: true, src: 'the Ring', n: s.turn.n }]); notes.push(`${cardName(ev.card)} blocked the Ring-bearer — it will be sacrificed at end of combat`); }
      if (ev.type === 'combatDamage' && ev.to === 'player' && ev.card && ringBearerOf(s, ev.card) >= 4) { for (const p of s.seats) if (p !== ev.card.ctrl && R.alive(s, p) && s.players[p]) s.players[p].life -= 3; notes.push(`The Ring: each opponent of ${nameOf(s, ev.card.ctrl)} loses 3 life`); }
    }
  }
  // Teysa Karlov, Panharmonicon, Yarok, Elesh Norn (Mother of Machines), Isshin: some events make triggered abilities
  // trigger an additional time (or not at all, for an opponent's Elesh Norn).
  function triggerTimes(s, src, ev) {
    const C = Cd(), R = I(); if (!C) return 1;
    const ctrl = src.ctrl;
    let n = 1;
    const ent = ev.type === 'enter' && ev.card;
    for (const c of Object.values(s.cards)) {
      if (c.zone !== 'battlefield' || c.faceDown || !c.d) continue;
      const t = C.text(c).toLowerCase();
      if (!/additional time|don't cause abilities/.test(t)) continue;
      if (c.ctrl === ctrl) {
        if (ev.type === 'die' && /if a creature dying causes a triggered ability of a permanent you control to trigger/.test(t)) n++;
        if (ent && /if an artifact or creature entering the battlefield causes a triggered ability of a permanent you control to trigger/.test(t) && (R.isType(ent, 'artifact') || R.isType(ent, 'creature'))) n++;
        if (ent && /(?:if a permanent entering the battlefield causes|permanents entering the battlefield cause) (?:a )?triggered abilit(?:y|ies) of (?:a )?permanents? you control to trigger/.test(t)) n++;
        if (ev.type === 'attack' && /if a creature attacking causes a triggered ability of a permanent you control to trigger/.test(t)) n++;
      } else if (ent && /permanents entering the battlefield don't cause abilities of permanents your opponents control to trigger/.test(t)) return 0;
    }
    return Math.min(n, 4);
  }
  // Sagas: a lore counter as your precombat main phase begins (714.3b).
  function loreUp(s, pid, evs) {
    for (const c of Object.values(s.cards)) {
      if (c.zone !== 'battlefield' || c.ctrl !== pid || c.faceDown || !/\bsaga\b/i.test(I().typeLine(c))) continue;
      c.counters.lore = (c.counters.lore || 0) + 1;
      evs.push({ type: 'chapter', card: c, n: c.counters.lore });
    }
  }
  // "As this enters, choose a color / creature type / player…", "you may pay 2 life. If you don't, it enters tapped" (614.12).
  function asEnters(s, c, notes) {
    if (!c.d || c.faceDown) return;
    const M = O().model(c); if (!M) return;
    for (const a of M.abilities) {
      const t = String(a.text || '').toLowerCase();
      let m;
      if ((m = t.match(/^as this enters, choose (a|an|two) (creature type|color|player|opponent|card name|nonland card name|basic land type|card type)/))) {
        const what = m[2];
        const ask = { id: 'a' + (++s.seq), kind: 'choose', pid: c.ctrl, card: c.id, name: cardName(c), what, players: what === 'player' || what === 'opponent' ? s.seats.filter(p => I().alive(s, p) && (what === 'player' || p !== c.ctrl)) : undefined, since: Date.now() };
        if (isAI(s, c.ctrl) || !I().live(s, c.ctrl)) { c.chosen = defaultChoice(s, c, what); notes.push(`${cardName(c)}: ${nameOf(s, c.ctrl)} chose ${c.chosen}`); continue; }
        s.ask = (s.ask || []).concat([ask]);
      } else if ((m = t.match(/^as this enters, you may (pay (\d+) life|reveal an? ([a-z]+) or ([a-z]+) card from your hand)\. if you don't, (?:it|this) enters tapped/))) {
        const ask = { id: 'a' + (++s.seq), kind: 'enterOpt', pid: c.ctrl, card: c.id, name: cardName(c), text: a.text, life: m[2] ? +m[2] : 0, since: Date.now() };
        if (isAI(s, c.ctrl) || !I().live(s, c.ctrl)) { if (m[2] && s.players[c.ctrl].life > 10) s.players[c.ctrl].life -= +m[2]; else if (m[2]) c.tapped = true; continue; }
        s.ask = (s.ask || []).concat([ask]);
      } else if ((m = t.match(/^you may have this enter(?: the battlefield)? as a copy of (?:any|an?) (creature|artifact|enchantment|permanent|land)(?: [a-z ]*?)?(?: on the battlefield)?\b/))) {
        // Clones (707.9): pick what it copies as it enters.
        const kind = m[1];
        const choices = Object.values(s.cards).filter(o => o.zone === 'battlefield' && o.id !== c.id && !o.faceDown && o.d && (kind === 'permanent' || I().isType(o, kind))).map(o => o.id);
        if (!choices.length) continue;
        const ask = { id: 'a' + (++s.seq), kind: 'copy', pid: c.ctrl, card: c.id, name: cardName(c), what: kind, choices, since: Date.now() };
        if (isAI(s, c.ctrl) || !I().live(s, c.ctrl)) { const best = choices.map(id => s.cards[id]).sort((a, b) => ((+b.d.cmc) || 0) - ((+a.d.cmc) || 0))[0]; becomeCopy(s, c, best, notes); continue; }
        s.ask = (s.ask || []).concat([ask]);
      } else if (/^as this enters, note your life total/.test(t)) { c.noted = s.players[c.ctrl] ? s.players[c.ctrl].life : 0; }
    }
  }
  function becomeCopy(s, c, of, notes) {
    if (!of || !of.d) return;
    const nm = cardName(c);
    c.origD = c.origD || c.d; c.d = JSON.parse(JSON.stringify(of.d)); c.face = of.face || 0; c.copyOf = of.id; c.row = I().rowFor(c);
    notes.push(`${nm} entered as a copy of ${cardName(of)} (707.9)`);
  }
  // ======================= mutate (702.140) =======================
  // A mutating creature spell merges with its target: the host keeps being the same object (counters, tapped, how long
  // it has been under its controller's control); the card on top gives the name, types and power/toughness, and the
  // merged permanent has every ability of every card in it. The cards under the top one wait in the 'merged' zone.
  function mutComp(c) { return { id: c.id, d: c.d, face: c.face || 0, cmdr: !!c.cmdr }; }
  function mutSynth(s, h) {
    const comps = h.mut, top = comps[0];
    const tf = (top.d.faces && (top.d.faces[top.face || 0] || top.d.faces[0])) || {};
    const topName = tf.n || top.d.n || '';
    const texts = comps.map(k => {
      const f = (k.d.faces && (k.d.faces[k.face || 0] || k.d.faces[0])) || {};
      let o = f.o || ''; const n = f.n || k.d.n || '';
      if (n && n !== topName) { o = o.split(n).join(topName); const sh = n.split(',')[0]; if (sh.length > 2 && sh !== n) o = o.split(sh).join(topName); }
      return o;
    }).filter(Boolean);
    const d = JSON.parse(JSON.stringify(top.d));
    d.faces = [Object.assign({}, tf, { o: texts.join('\n') })];
    d.kw = [...new Set([].concat(...comps.map(k => Array.isArray(k.d.kw) ? k.d.kw : [])))];
    d.mk = 'mut:' + comps.map(k => k.id).join(',');
    h.d = d; h.face = 0;
    h.mutCmdr = (comps.find(k => k.cmdr && k.id !== h.id) || {}).id || null;
    h.mutNames = comps.map(k => ((k.d.faces && k.d.faces[k.face || 0]) || {}).n || k.d.n);
    h.row = I().rowFor(h);
  }
  function mutate(s, m, host, notes) {
    const R = I();
    if (!host.mut) { host.mutBase = host.d; host.mut = [mutComp(host)]; }
    const comp = mutComp(m);
    host.mut.unshift(comp);                               // on top by default; the caster may put it under (702.140c)
    R.moveOne(s, m, 'merged', 'top', null, notes);
    const mc = s.cards[m.id]; if (mc) { mc.mergedInto = host.id; mc.ctrl = host.ctrl; }
    const was = cardName(host);
    mutSynth(s, host);
    notes.push(`${cardName(mc || m)} mutated onto ${was} — they’re one creature now with all their abilities (702.140)`);
    emit({ type: 'mutate', card: host, player: host.ctrl });
    if (!isAI(s, host.ctrl) && R.live(s, host.ctrl)) s.ask = (s.ask || []).concat([{ id: 'a' + (++s.seq), kind: 'mutate', pid: host.ctrl, card: host.id, comp: m.id, name: cardName(host), mut: cardName(mc || m), host: was, since: Date.now() }]);
    else if (isAI(s, host.ctrl)) mutOrder(s, host, m.id, mutTopBest(s, host, m.id), notes);
  }
  // The old (v1) AI: whichever card gives the bigger creature goes on top.
  function mutTopBest(s, host, compId) {
    const pt = k => { const f = (k.d.faces && k.d.faces[k.face || 0]) || {}; return (+f.p || 0) + (+f.tg || 0); };
    const a = host.mut.find(k => k.id === compId), b = host.mut.find(k => k.id !== compId && k === host.mut[1]);
    return !b || pt(a) >= pt(b);
  }
  function mutOrder(s, host, compId, onTop, notes) {
    if (!host || !host.mut) return;
    const i = host.mut.findIndex(k => k.id === compId); if (i < 0) return;
    const [k] = host.mut.splice(i, 1);
    if (onTop) host.mut.unshift(k); else host.mut.splice(1, 0, k);
    mutSynth(s, host);
    if (!onTop) notes.push(`${cardName(host)}: ${(k.d.faces && k.d.faces[0] || {}).n || 'the mutating card'} went under it (702.140c)`);
  }
  function defaultChoice(s, c, what) {
    if (what === 'color') { const cs = Cd().colorsOf(c); return ({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' })[cs[0] || 'W']; }
    if (what === 'creature type') { const cnt = {}; for (const o of Object.values(s.cards)) if (o.ctrl === c.ctrl && o.zone === 'battlefield' && I().isType(o, 'creature')) for (const w of (I().typeLine(o).split(/[—-]/)[1] || '').trim().split(/\s+/)) if (w) cnt[w] = (cnt[w] || 0) + 1; const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; return top ? top[0] : 'Human'; }
    if (what === 'player' || what === 'opponent') return s.seats.find(p => p !== c.ctrl) || c.ctrl;
    return '—';
  }
  function ctxOf(s, ev) {
    const c = ev.card || null;
    let mv = 0, pw = null, tg = null;
    if (c && c.d) { mv = +c.d.cmc || 0; const p = Cd().pt(s, c) || (c.pw != null ? [c.pw, 0] : null); pw = p ? p[0] : null; tg = p ? p[1] : null; }
    return { c: c ? c.id : null, cName: c ? cardName(c) : null, ctrl: c ? c.ctrl : null, p: ev.player || (c && c.ctrl) || null, def: ev.def || undefined, n: ev.n || null, mv, pw, tg, step: ev.step || null, type: ev.type };
  }
  function queue(s, src, a, i, ev, askCond) {
    s.tq = s.tq || [];
    const ops = a.ops || [];
    const anyOptional = a.optional || ops.some(o => o.optional) || (ops.find(o => o.op === 'modes') || { modes: [] }).modes.some(md => md.ops.some(o => o.optional));
    s.tq.push({
      id: 'q' + (++s.seq), src: src.id, name: cardName(src), d: src.d, face: src.face || 0, ctrl: src.ctrl, i,
      text: a.text, effect: a.effect, optional: !!anyOptional, cond: a.condition || null, askCond: !!askCond,
      ctx: ctxOf(s, ev), modal: !!(a.modes && a.modes.length), t: Date.now()
    });
  }
  function abilityOf(item) {
    if (item.fixed) return { ops: item.fixed, kind: 'triggered', text: item.text, effect: item.effect };
    const m = O().model({ d: item.d, face: item.face || 0 });
    return m && m.abilities[item.i];
  }

  // ======================= putting triggers on the stack =======================
  function place(s, notes) {
    if (!s.tq || !s.tq.length) return 0;
    const R = I(), T = s.turn;
    // Nobody gets priority while triggered abilities are waiting to go on the stack (117.2a, 603.3).
    const wait = () => { if (s.prio) s.prio.holder = null; return 0; };
    if ((s.ask || []).some(x => x.kind === 'targets' || x.kind === 'modes' || x.kind === 'order')) return wait();
    const order = R.rotate(s, T.active || s.seats[0]);
    s.tq.sort((a, b) => (order.indexOf(a.ctrl) - order.indexOf(b.ctrl)) || (a.ord != null && b.ord != null ? a.ord - b.ord : 0));
    // Several triggers of one human player at once: they may pick the order (603.3b). Ask once.
    const mine = {};
    for (const q of s.tq) if (!q.ordered) (mine[q.ctrl] = mine[q.ctrl] || []).push(q);
    for (const [pid, list] of Object.entries(mine)) {
      if (list.length > 1 && !isAI(s, pid) && R.live(s, pid) && new Set(list.map(q => q.effect)).size > 1) {
        list.forEach((q, k) => { q.ordered = true; q.ord = k; });
        s.ask = (s.ask || []).concat([{ id: 'a' + (++s.seq), kind: 'order', pid, items: list.map(q => ({ id: q.id, name: q.name, text: q.effect })), since: Date.now() }]);
        return wait();
      }
      for (const q of list) q.ordered = true;
    }
    let placed = 0;
    while (s.tq.length) {
      const q = s.tq[0];
      if (!R.alive(s, q.ctrl)) { s.tq.shift(); continue; }
      const prep = prepare(s, q);
      if (prep === 'ask') break;
      s.tq.shift();
      if (prep === 'drop') { notes.push(`${q.name}’s triggered ability was removed from the stack — it has no legal target (603.3d)`); continue; }
      pushStack(s, q, prep, notes); placed++;
    }
    if (s.tq.length) return wait() || placed;
    if (placed || (s.prio && !s.prio.holder && R.stackTop(s))) R.startPrio(s, null, notes);
    return placed;
  }
  // Targets (and modes) are chosen as the ability is put on the stack.
  function prepare(s, q) {
    const R = I(), C = Cd();
    const a = abilityOf(q); if (!a) return 'drop';
    const ops = a.ops || [];
    const mo = ops.find(o => o.op === 'modes');
    // "Choose one that hasn't been chosen this turn" (Monument to Endurance and friends).
    const onceTurn = mo && /hasn't been chosen this turn/i.test(String(q.text || '') + ' ' + String(q.effect || ''));
    const T = s.turn;
    if (onceTurn) { T.modeUsed = T.modeUsed && T.modeUsed.n === T.n ? T.modeUsed : { n: T.n }; }
    const off = onceTurn ? (T.modeUsed[q.src] || []) : [];
    if (mo && q.mode == null) {
      let max = typeof mo.choose === 'number' ? mo.choose : mo.choose.max;
      if (max === 'X') { const sp = q.ctx && s.cards[q.ctx.c]; max = Math.min(mo.modes.length, mo.choose.modesOfSpell ? ((sp && sp.mode) || []).length || 1 : (q.ctx && q.ctx.n) || 1); }
      const min = typeof mo.choose === 'number' ? mo.choose : mo.choose.min;
      if (onceTurn && off.length >= mo.modes.length) return 'drop';
      if (isAI(s, q.ctrl) || q.timeout) {
        // Pick the first mode(s) that can actually do something.
        const okModes = mo.modes.map((md, k) => k).filter(k => !off.includes(k)).filter(k => { const reqs = C.targetsIn(mo.modes[k].text); return reqs.every(r => r.upTo || C.targetChoices(s, r, q.ctrl).length); });
        q.mode = (okModes.length ? okModes : mo.modes.map((md, k) => k).filter(k => !off.includes(k))).slice(0, Math.max(1, min));
      } else {
        s.ask = (s.ask || []).concat([{ id: 'a' + (++s.seq), kind: 'modes', pid: q.ctrl, q: q.id, name: q.name, modes: mo.modes.map(md => md.text), off, min, max, since: Date.now() }]);
        return 'ask';
      }
    }
    if (onceTurn && q.mode && !q.modeRec) { q.modeRec = true; T.modeUsed[q.src] = off.concat(q.mode); }
    const text = mo ? q.mode.map(k => mo.modes[k] && mo.modes[k].text).filter(Boolean).join('. ') : q.effect;
    const reqs = C.targetsIn(text || '');
    if (!reqs.length) return { tg: [], reqs: [] };
    const srcCard = s.cards[q.src] || { d: q.d, face: q.face, ctrl: q.ctrl, id: q.src };
    const choices = reqs.map(r => C.targetChoices(s, r, q.ctrl).filter(t => !(t.c && r.other && t.c === q.src) && !(t.c && s.cards[t.c] && C.protectedFrom(s.cards[t.c], srcCard, s))));
    if (reqs.some((r, k) => !r.upTo && !choices[k].length)) return 'drop';
    if (q.tg) return { tg: q.tg, reqs };
    const forced = reqs.every((r, k) => r.upTo ? !choices[k].length : choices[k].length <= r.n);
    if (forced) return { tg: choices.map((l, k) => l.slice(0, reqs[k].n)), reqs };
    if (isAI(s, q.ctrl) || q.timeout || !I().live(s, q.ctrl)) return { tg: autoTargets(s, q, reqs, choices, ops, mo), reqs };
    s.ask = (s.ask || []).concat([{ id: 'a' + (++s.seq), kind: 'targets', pid: q.ctrl, q: q.id, name: q.name, text: text, src: q.src,
      reqs: reqs.map((r, k) => ({ label: C.reqLabel ? C.reqLabel(r) : r.text, n: r.n, upTo: r.upTo, choices: choices[k].slice(0, 60), helpful: helpfulIdx(ops, mo, q, k) })), since: Date.now() }]);
    return 'ask';
  }
  // Is target number k something the ability helps (a pump, counters…) or hurts (damage, destroy…)?
  const HELP = { pump: o => !/^-/.test(String(o.p)) && !/^-/.test(String(o.t)), grant: () => true, untap: () => true, counters: o => o.kind !== '-1/-1' && !(o.n < 0), copyToken: () => true, attach: () => true, flicker: () => true, regen: () => true };
  function helpfulIdx(ops, mo, q, k) {
    let list = ops;
    if (mo && q.mode) { list = []; let off = 0; for (const mi of q.mode) { const md = mo.modes[mi]; if (!md) continue; for (const o of md.ops) list.push(shiftOp(o, off)); off += md.nTargets || 0; } }
    for (const o of list) {
      const refs = [o.what, o.to, o.on, o.who, o.a, o.b].filter(Boolean);
      if (refs.some(r => r.k === 't' && r.i === k)) {
        if (o.op === 'move') return o.to === 'battlefield' || (o.to === 'hand' && /graveyard/.test(String(o.what && o.what.what)));
        if (o.op === 'fight') return o.a && o.a.i === k;
        return HELP[o.op] ? !!HELP[o.op](o) : false;
      }
    }
    return false;
  }
  function autoTargets(s, q, reqs, choices, ops, mo) {
    const C = Cd();
    return reqs.map((r, k) => {
      const helpful = helpfulIdx(ops, mo, q, k);
      let list = C.orderChoices(s, choices[k], q.ctrl, helpful);
      // Among the right side, the biggest threat (or best friend) first.
      const score = t => t.p ? (helpful ? 0 : 100 - (s.players[t.p].life || 0) / 10) : ((C.pt(s, s.cards[t.c]) || [0])[0] * 2 + (+((s.cards[t.c].d || {}).cmc) || 0));
      const mineT = t => t.p ? t.p === q.ctrl : s.cards[t.c] && (s.cards[t.c].zone === 'graveyard' ? s.cards[t.c].owner : s.cards[t.c].ctrl) === q.ctrl;
      list = list.filter(t => mineT(t) === helpful).sort((a, b) => score(b) - score(a)).concat(list.filter(t => mineT(t) !== helpful));
      if (r.upTo && list.length && mineT(list[0]) !== helpful) return [];
      return list.slice(0, Math.min(r.n, 20));
    });
  }
  function pushStack(s, q, prep, notes) {
    const R = I();
    const a = abilityOf(q) || {};
    const id = 'tr' + (++s.seq) + '-' + String(q.src).slice(0, 12);
    const it = s.cards[id] = {
      id, owner: q.ctrl, ctrl: q.ctrl, d: q.d, face: q.face || 0, faceDown: false, token: true, cmdr: false, tapped: false, counters: {}, mod: null,
      attachedTo: null, row: null, zone: 'stack', seq: ++s.seq,
      ab: { src: q.src, text: String(q.effect || '').slice(0, 600), name: q.name, trig: true, eng: true, i: q.i, fixed: q.fixed || undefined, optional: q.optional, cond: q.cond, askCond: q.askCond, ctx: q.ctx, mode: q.mode || null, ev: a.eventText || '' },
      tg: prep.tg, reqs: prep.reqs, x: 0
    };
    R.wardFor(s, q.ctrl, it, null);
    const what = String(q.effect || '').replace(/^this /i, q.name + ' ');
    R.log(s, null, `${q.name} triggered${a.eventText ? ' (' + a.eventText.replace(/\bthis\b/g, q.name) + ')' : ''}: “${what}”${R.targetText(s, it)}`, 'trig');
  }

  // ======================= resolving =======================
  // Before an engine ability resolves: "use it?" for optional abilities; unknown "if" conditions.
  function hold(s, notes) {
    const R = I(); const top = R.stackTop(s);
    if (!top || !top.ab || !top.ab.eng) return false;
    const ab = top.ab;
    const need = (ab.optional && ab.may === undefined) || (ab.askCond && ab.condOk === undefined);
    if (!need) return false;
    if (isAI(s, top.ctrl) || !R.live(s, top.ctrl)) { if (ab.may === undefined) ab.may = true; if (ab.condOk === undefined) ab.condOk = true; return false; }
    if ((s.ask || []).some(x => x.kind === 'may' && x.item === top.id)) { if (s.prio) s.prio.holder = null; return true; }
    s.ask = (s.ask || []).concat([{ id: 'a' + (++s.seq), kind: 'may', pid: top.ctrl, item: top.id, name: ab.name, text: ab.text, cond: ab.askCond ? ab.cond : null, since: Date.now() }]);
    if (s.prio) s.prio.holder = null;
    return true;
  }
  function resolve(s, item, notes) {
    const R = I(), C = Cd();
    const ab = item.ab, by = item.ctrl;
    delete s.cards[item.id];
    if (ab.optional && ab.may === false) { notes.push(`${nameOf(s, by)} chose not to use ${ab.name}’s ability`); return; }
    if (ab.askCond && ab.condOk === false) { notes.push(`${ab.name}’s ability did nothing — “if ${ab.cond}” wasn’t true (603.4)`); return; }
    // 603.4: an intervening "if" is checked again on resolution.
    if (ab.cond && !ab.askCond) { const src = s.cards[ab.src] || { ctrl: by, id: ab.src }; if (O().conditionHolds(s, src, ab.cond) === false) { notes.push(`${ab.name}’s ability did nothing — “if ${ab.cond}” is no longer true (603.4)`); return; } }
    const reqs = item.reqs || [], tg = item.tg || [];
    const legal = reqs.map((r, i) => (tg[i] || []).filter(t => C.legalTarget(s, r, t, by)));
    if (tg.some(l => l && l.length) && legal.every(l => !l.length)) { notes.push(`${ab.name}’s ability didn’t resolve — its target${[].concat(...tg).length > 1 ? 's are' : ' is'} no longer legal (608.2b)`); return; }
    const a = abilityOf({ d: item.d, face: item.face, i: ab.i, fixed: ab.fixed, text: ab.text, effect: ab.text });
    let ops = a ? a.ops || [] : (root.Effects ? root.Effects.parse(ab.text).ops : []);
    run(s, item, ops, legal, notes, { mode: ab.mode });
  }
  // The operations of a spell (or of an activated ability on the stack).
  function spellOps(s, c) {
    if (!root.Effects || !c.d) return null;
    if (c.ab) { const r = root.Effects.parse(O().selfRef(c.ab.text, c.ab.name).replace(/\s*activate (?:this ability )?only[^.]*\.?/gi, '')); return { ops: r.ops, understood: r.understood && r.ops.every(o => o.op !== 'manual') }; }
    if (c.alt === 'overload') { const r = root.Effects.parse(Cd().spellText(c).replace(/\btarget\b/gi, 'each').replace(/\beach (creatures?|permanents?|artifacts?|[a-z]+) you don't control\b/gi, 'each $1 your opponents control')); return { ops: r.ops, understood: r.understood && r.ops.every(o => o.op !== 'manual') }; }
    const M = O().model(c); if (!M) return null;
    const sp = M.abilities.filter(a => a.kind === 'spell' && a.ops);
    if (!sp.length) return null;
    const ops = []; let off = 0, und = true;
    for (const a of sp) {
      for (const o of a.ops) ops.push(o.op === 'modes' ? o : shiftOp(o, off));
      off += a.nTargets || 0;
      // A modal spell is understood if the modes chosen are (the others don't matter).
      const mo = a.ops.find(o => o.op === 'modes');
      if (mo && c.mode && c.mode.length) {
        const deep = list => (list || []).every(o => o.op !== 'manual' && (!o.ops || deep(o.ops)));
        und = und && a.ops.filter(o => o.op !== 'modes').every(o => o.op !== 'manual') && [].concat(c.mode).every(i => mo.modes[i] && deep(mo.modes[i].ops));
      } else und = und && a.understood !== false;
    }
    return { ops, understood: und && ops.every(o => o.op !== 'manual') };
  }
  // Spells and activated abilities whose whole text the engine understands also resolve here.
  function canRun(text) { if (!root.Effects) return false; const r = root.Effects.parse(text); return r.understood && r.ops.length > 0 && r.ops.every(o => o.op !== 'manual'); }

  function shiftOp(o, off) {
    if (!off) return o;
    const c = JSON.parse(JSON.stringify(o));
    for (const k of ['what', 'to', 'on', 'who', 'a', 'b', 'of']) if (c[k] && c[k].k === 't') c[k].i += off;
    return c;
  }
  // Carry out a list of operations. legal[i] = the still-legal targets for target number i.
  function run(s, item, ops, legal, notes, opt) {
    const R = I(), C = Cd();
    opt = opt || {};
    const by = item.ctrl, ab = item.ab || {}, ctx = ab.ctx || {};
    const srcId = ab.src || item.id;
    const src = s.cards[srcId] || item;
    const srcName = ab.name || cardName(item);
    const X = item.x || 0;
    const st = { did: true, last: 0, manual: [] };
    const tcard = t => t && t.c && s.cards[t.c];
    const players = w => {
      if (!w) return [by];
      switch (w.k) {
        case 'you': return [by];
        case 'eachOpp': return s.seats.filter(p => p !== by && R.alive(s, p));
        case 'eachPlayer': return s.seats.filter(p => R.alive(s, p));
        case 'eachOther': return s.seats.filter(p => p !== by && R.alive(s, p));
        case 'evPlayer': return ctx.p ? [ctx.p] : [];
        // The defending player (506.2): from the attack event, or whoever this creature is attacking.
        case 'defender': { if (ctx.def) return [ctx.def]; const K = s.combat, a = K && K.att && (K.att[srcId] || K.att[ctx.c]); if (a && a.def) { const p = a.def.p || (s.cards[a.def.c] && s.cards[a.def.c].ctrl); if (p) return [p]; } const o = (s.seats || []).filter(p => p !== by && s.players[p] && !s.players[p].lost); return o.length === 1 ? o : []; }
        case 'targetCtrl': { const t = (legal[w.i] || []).find(x => x.c) || ((item.tg || [])[w.i] || []).find(x => x.c); const c = t && s.cards[t.c]; return c ? [c.zone === 'battlefield' ? c.ctrl : c.owner] : []; }
        case 'controllerOf': { if (w.of && w.of.k === 'attached') { const at = s.cards[src.attachedTo]; return at ? [at.ctrl] : []; } const c = s.cards[ctx.c]; return c ? [c.zone === 'battlefield' ? c.ctrl : c.owner] : ctx.ctrl ? [ctx.ctrl] : []; }
        case 'ownerOf': { const c = s.cards[ctx.c]; return c ? [c.owner] : []; }
        case 't': return (legal[w.i] || []).filter(t => t.p).map(t => t.p);
      }
      return [];
    };
    const count = v => {
      const w = String(v.what || '').replace(/ (?:you control|on the battlefield|your opponents control|an opponent controls)$/, '');
      const list = Object.values(s.cards).filter(c => c.zone === 'battlefield' && (v.ctrl === 'you' ? c.ctrl === by : v.ctrl === 'opp' ? c.ctrl !== by : true));
      // "creature you control with a +1/+1 counter on it"
      const cm = w.match(/^(.+?) (?:you control )?with an? ([+\-\d/]+|[a-z]+) counter on it$/);
      if (cm) return list.filter(c => C.matchesWhat(c, cm[1].replace(/s$/, '')) && ((c.counters || {})[cm[2]] || 0) > 0).length * (v.times || 1);
      return list.filter(c => C.matchesWhat(c, w.replace(/s$/, '').replace(/ies$/, 'y'))).length * (v.times || 1);
    };
    const val = n => {
      if (n == null) return 1;
      if (typeof n === 'number') return n;
      switch (n.v) {
        case 'X': return X;
        case 'X2': return 2 * X;
        case 'lastX': return st.lastX || 0;
        case 'thatMany': return ctx.n || st.last || 0;
        case 'lastAmount': return st.last || ctx.n || 0;
        case 'count': return count(n);
        case 'hand': return (s.players[by] || {}).handCount || 0;
        case 'gy': return Object.values(s.cards).filter(c => c.zone === 'graveyard' && c.owner === by && (!n.what || n.what === 'card' || C.matchesWhat(c, n.what.replace(/ cards?$/, '')))).length;
        case 'evMV': return ctx.mv || 0;
        case 'evPower': return ctx.pw || 0;
        case 'evToughness': return ctx.tg || 0;
        case 'selfPower': return (C.pt(s, src) || [0])[0];
        case 'selfToughness': return (C.pt(s, src) || [0, 0])[1];
        case 'maxPower': return Math.max(0, ...Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === by && (c.faceDown || R.isType(c, 'creature'))).map(c => (C.pt(s, c) || [0])[0]));
        case 'opponents': return s.seats.filter(p => p !== by && R.alive(s, p)).length;
        case 'selfCounters': return (src.counters || {})[n.kind] || 0;
      }
      return 0;
    };
    const cards = w => {
      if (!w) return [];
      switch (w.k) {
        case 'self': return src && s.cards[src.id] ? [s.cards[src.id]] : [];
        case 'ev': {
          const c = s.cards[ctx.c]; if (c) return [c];
          // A spell has no triggering object: "that creature" / "it" is the card it targeted.
          for (let k = legal.length - 1; k >= 0; k--) { const l = (legal[k] || []).map(tcard).filter(Boolean); if (l.length) return l; }
          return [];
        }
        case 'attached': { const c = s.cards[src.attachedTo]; return c ? [c] : []; }
        case 't': return (legal[w.i] || []).map(tcard).filter(Boolean);
        case 'lastToken': return (st.tokens || []).map(id => s.cards[id]).filter(Boolean);
        case 'each': case 'eachOppAndCreatures': case 'everything': {
          const what = w.k === 'each' ? String(w.what || 'permanent').replace(/s$/, '').replace(/^creature$/, 'creature') : 'creature';
          return Object.values(s.cards).filter(c => c.zone === 'battlefield' && !(w.other && c.id === srcId) &&
            (w.ctrl === 'you' ? c.ctrl === by : w.ctrl === 'opp' ? c.ctrl !== by : w.ctrl === 'evPlayer' ? c.ctrl === ctx.p : w.ctrl === 'defender' ? c.ctrl === players({ k: 'defender' })[0] : w.ctrl === 'targetP' ? (legal[w.i || 0] || []).some(t => t.p === c.ctrl) : true) &&
            (what === 'attacking creature' ? !!(s.combat && s.combat.att && s.combat.att[c.id]) : what === 'blocking creature' ? !!(s.combat && s.combat.att && Object.values(s.combat.att).some(a => (a.blk || []).includes(c.id))) : C.matchesWhat(c, what.replace(/ies$/, 'y'))) &&
            (!w.with || C.has(c, w.with, s)) && (!w.without || !C.has(c, w.without, s)) && (!w.powerMin || (C.pt(s, c) || [0])[0] >= w.powerMin));
        }
      }
      return [];
    };
    const both = w => {
      if (!w) return { ps: [], cs: [] };
      if (w.k === 't') { const l = legal[w.i] || []; return { ps: l.filter(t => t.p).map(t => t.p), cs: l.map(tcard).filter(Boolean) }; }
      if (w.k === 'eachOppAndCreatures') return { ps: players({ k: 'eachOpp' }), cs: cards(w) };
      if (w.k === 'everything') return { ps: players({ k: 'eachPlayer' }), cs: cards(w) };
      if (['you', 'eachOpp', 'eachPlayer', 'eachOther', 'evPlayer', 'defender', 'controllerOf', 'ownerOf'].includes(w.k)) return { ps: players(w), cs: [] };
      return { ps: [], cs: cards(w) };
    };
    const hurt = (target, n, from) => {
      if (n <= 0) return;
      from = from || src;
      const kws = C.keywords(from, s);
      if (target.p) {
        const P = s.players[target.p]; if (!P) return;
        if (kws.has('infect')) P.poison += n; else P.life -= n;
        R.alertChecks(s, target.p);
      } else {
        const c = target.c; if (!c || c.zone !== 'battlefield') return;
        if (C.protectedFrom(c, from, s)) { notes.push(`${cardName(c)}’s protection prevented ${n} damage`); return; }
        if (R.isType(c, 'planeswalker') && !R.isType(c, 'creature')) c.counters.loyalty = Math.max(0, (c.counters.loyalty || 0) - n);
        else if (R.isType(c, 'battle') && !R.isType(c, 'creature')) c.counters.defense = Math.max(0, (c.counters.defense || 0) - n);
        else if (kws.has('infect') || kws.has('wither')) c.counters['-1/-1'] = (c.counters['-1/-1'] || 0) + n;
        else c.dmg = (c.dmg || 0) + n;
        if (kws.has('deathtouch')) c.dtd = true;
      }
      if (kws.has('lifelink') && s.players[from.ctrl]) R.gainLife(s, from.ctrl, n);
      st.last += n;
    };
    const badge = (c, b) => { c.eot = (c.eot || []).concat([b]).slice(-20); };
    const addCounter = (c, kind, n) => {
      kind = String(kind).toLowerCase();
      if (kind === 'any') { const k = Object.keys(c.counters || {})[0]; if (!k) return; kind = k; }
      const cur = c.counters[kind] || 0, next = Math.max(0, cur + n);
      if (next) c.counters[kind] = next; else delete c.counters[kind];
      const plus = c.counters['+1/+1'] || 0, minus = c.counters['-1/-1'] || 0;
      if (plus && minus) { const m = Math.min(plus, minus); if (plus - m) c.counters['+1/+1'] = plus - m; else delete c.counters['+1/+1']; if (minus - m) c.counters['-1/-1'] = minus - m; else delete c.counters['-1/-1']; }
      if (n > 0) emit({ type: 'counter', kind, card: c, n });
      // 714.2b: a lore counter put on a Saga triggers the chapter it reaches.
      if (n > 0 && kind === 'lore' && /\bsaga\b/i.test(R.typeLine(c))) for (let k = cur + 1; k <= next; k++) emit({ type: 'chapter', card: c, n: k });
    };
    const KW = (C.KEYWORDS || []);
    const grantTo = (c, kwText, untilNext) => {
      const list = String(kwText || '').toLowerCase().replace(/\.$/, '').split(/,\s*(?:and\s+)?|\s+and\s+(?!from)/).map(x => x.trim()).filter(Boolean);
      const got = [];
      for (let k of list) {
        if (/^protection from /.test(k) || KW.includes(k)) { addCounter(c, k, 1); badge(c, { counter: k, until: untilNext ? by : 'eot', label: k }); got.push(k); }
        else if (k === 'unblockable' || k === "can't block" || /^can't be blocked/.test(k)) { c.grant = [...new Set((c.grant || []).concat([k === 'unblockable' || /^can't be blocked/.test(k) ? 'unblockable' : k]))]; badge(c, { label: k === "can't block" ? "can't block" : 'unblockable', until: 'eot' }); got.push(k); }
      }
      return got;
    };
    const pay = cost => {
      const P = s.players[by]; if (!P) return false;
      const life = String(cost).match(/^(\d+|x) life$/);
      if (life) { const n = life[1] === 'x' ? X : +life[1]; if (P.life < n) return false; P.life -= n; return true; }
      // Energy (107.14): {E} symbols are paid from the player's energy counters.
      const en = (String(cost).match(/\{e\}/gi) || []).length;
      if (en) { if ((P.energy || 0) < en) return false; const rest = String(cost).replace(/\{e\}/gi, ''); if (rest && !payMana(s, by, rest, notes)) return false; P.energy -= en; return true; }
      return payMana(s, by, String(cost), notes);
    };
    const condOk = cond => { const em = String(cond).match(/^(?:that|the) (?:creature|enchantment|artifact|card|permanent|spell|land) is an? ([a-z ]+)$/); if (em && ctx.c && s.cards[ctx.c]) return C.matchesWhat(Object.assign({}, s.cards[ctx.c]), em[1]); const sm = String(cond).match(/^(?:at least )?(\w+)(?: or more)? mana was spent to cast (?:that spell|it)$/); if (sm) return (ctx.mv || 0) >= (({ two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 })[sm[1]] || +sm[1] || 0); const xm = String(cond).match(/^x is (\d+) or (more|greater|less|fewer)$/); if (xm) { const v = st.lastX != null ? st.lastX : (ctx.mv || X || 0); return /less|fewer/.test(xm[2]) ? v <= +xm[1] : v >= +xm[1]; } const r = O().conditionHolds(s, Object.assign({}, src, { ctrl: by }), cond); if (r === null) { st.manual.push(`Check: if ${cond}`); return false; } return r; };
    const runList = (list, off) => {
      for (let k = 0; k < list.length; k++) {
        const o = shiftOp(list[k], off || 0);
        if (o.op === 'if') { if (condOk(o.cond)) runList(o.ops, off); continue; }
        if (o.op === 'instead') continue;
        const nx = list[k + 1];
        if (nx && nx.op === 'instead' && condOk(nx.cond)) { runList(nx.ops, off); continue; }
        if (o.ifDid && !st.did) continue;
        if (o.optional && ab.may === false) { st.did = false; continue; }
        try { one(o); } catch (e) { st.manual.push(String(o.text || (typeof o.src === 'string' ? o.src : '') || o.op)); }
      }
    };
    const one = o => {
      switch (o.op) {
        case 'dmg': {
          const n = val(o.n); const { ps, cs } = both(o.to);
          for (const p of ps) hurt({ p }, n); for (const c of cs) hurt({ c }, n);
          notes.push(`${srcName} dealt ${n} damage to ${R.listNames(ps.map(p => nameOf(s, p)).concat(cs.map(cardName))) || 'nothing'}`);
          break;
        }
        case 'draw': for (const p of players(o.who)) R.todo(s, p, { k: 'draw', n: val(o.n), src: srcName }); break;
        case 'discard': for (const p of players(o.who)) { R.todo(s, p, { k: 'discard', n: o.all ? 99 : val(o.n), random: !!o.random, src: srcName }); notes.push(`${nameOf(s, p)} must discard ${o.all ? 'their hand' : val(o.n)} (${srcName})`); } break;
        case 'mill': for (const p of players(o.who)) R.todo(s, p, { k: 'mill', n: val(o.n), src: srcName }); break;
        case 'life': {
          const n = val(o.n); const ps = players(o.who);
          for (const p of ps) { const P = s.players[p]; if (!P) continue; if (o.sign > 0) R.gainLife(s, p, n); else P.life -= n; R.alertChecks(s, p); }
          st.last = o.sign < 0 ? n * ps.length : n;
          notes.push(`${R.listNames(ps.map(p => nameOf(s, p)))} ${o.sign > 0 ? 'gained' : 'lost'} ${n} life (${srcName})`);
          break;
        }
        case 'sacrifice': {
          if (o.what && typeof o.what === 'object') { for (const c of cards(o.what)) { R.moveOne(s, c, 'graveyard', 'top', { sac: true }, notes); notes.push(`${nameOf(s, c.ctrl)} sacrificed ${cardName(c)}`); } break; }
          for (const p of players(o.who)) { R.todo(s, p, { k: 'sacrifice', n: val(o.n), what: String(o.what || 'permanent'), src: srcName }); notes.push(`${nameOf(s, p)} must sacrifice ${o.what} (${srcName})`); }
          break;
        }
        case 'energy': { const n = val(o.n); for (const p of players(o.who)) { const P = s.players[p]; if (P) P.energy = (P.energy || 0) + n; } st.last = n; notes.push(`${R.listNames(players(o.who).map(p => nameOf(s, p)))} got ${n} energy (${srcName})`); break; }
        case 'scry': R.todo(s, by, { k: 'scry', n: val(o.n), src: srcName }); break;
        case 'surveil': R.todo(s, by, { k: 'surveil', n: val(o.n), src: srcName }); break;
        case 'monarch': { const p = players(o.who)[0]; if (p) { s.table.monarch = p; notes.push(`${nameOf(s, p)} became the monarch`); } break; }
        case 'initiative': { const p = players(o.who)[0]; if (p) { s.table.initiative = p; notes.push(`${nameOf(s, p)} took the initiative`); } break; }
        case 'token': {
          const sp = o.spec, n = val(sp.n);
          const d = R.tokenD({ what: sp.named || sp.desc, p: sp.p === 'x' ? String(val(sp.x || { v: 'X' })) : sp.p || '', t: sp.t === 'x' ? String(val(sp.x || { v: 'X' })) : sp.t || '', kws: sp.kws });
          for (const p of players(o.who)) {
            const before = new Set(Object.keys(s.cards));
            R.makeToken(s, p, d, n, sp.tapped, notes);   // "that are attacking" isn't tapped (508.4)
            st.tokens = Object.keys(s.cards).filter(id => !before.has(id));
            emit({ type: 'token', player: p });
            if (sp.attacking && s.combat && s.combat.att) {
              const myAtt = s.combat.att[srcId] || Object.values(s.combat.att).find(x => x) || null;
              for (const id of Object.keys(s.cards)) if (!before.has(id) && myAtt) s.combat.att[id] = { def: myAtt.def, blk: [] };
            }
            notes.push(`${nameOf(s, p)} created ${n > 1 ? n + ' ' : 'a '}${d.n} token${n > 1 ? 's' : ''} (${srcName})`);
          }
          break;
        }
        case 'copyToken': for (const c of cards(o.of)) {
          if (!c.d) continue;
          const before = new Set(Object.keys(s.cards));
          R.makeToken(s, by, JSON.parse(JSON.stringify(c.d)), 1, !!o.tapped, notes);
          const made = Object.keys(s.cards).filter(id => !before.has(id));
          st.tokens = made;
          if (o.attacking && s.combat && s.combat.att) { const myAtt = s.combat.att[srcId] || Object.values(s.combat.att).find(x => x) || null; if (myAtt) for (const id of made) s.combat.att[id] = { def: myAtt.def, blk: [] }; }
          emit({ type: 'token', player: by });
          notes.push(`${nameOf(s, by)} created a token copy of ${cardName(c)}${o.attacking ? ', tapped and attacking' : ''}`);
        } break;
        case 'delayedToken': for (const id of st.tokens || []) { s.delayed = (s.delayed || []).concat([{ step: 'end', id, to: o.to, by, sac: o.to === 'graveyard', energy: !!o.energy, src: srcName, n: s.turn.n }]); } break;
        case 'proliferate': {
          const got = [];
          for (const c of Object.values(s.cards)) {
            if (c.zone !== 'battlefield' || !c.counters) continue;
            const ks = Object.keys(c.counters).filter(k => c.ctrl === by ? !['-1/-1', 'stun'].includes(k) : ['-1/-1', 'stun'].includes(k));
            for (const k of ks) addCounter(c, k, 1);
            if (ks.length) got.push(cardName(c));
          }
          for (const p of s.seats) { const P = s.players[p]; if (!P) continue; if (p !== by && P.poison > 0) { P.poison++; got.push(nameOf(s, p)); } if (p === by && P.energy > 0) P.energy++; if (p === by && P.exp > 0) P.exp++; }
          notes.push(`${nameOf(s, by)} proliferated${got.length ? ': ' + R.listNames(got) : ''}`);
          break;
        }
        case 'amass': {
          let army = Object.values(s.cards).find(c => c.zone === 'battlefield' && c.ctrl === by && /\barmy\b/i.test(R.typeLine(c)));
          if (!army) {
            const t = o.type[0].toUpperCase() + o.type.slice(1);
            const before = new Set(Object.keys(s.cards));
            R.makeToken(s, by, { n: t + ' Army', col: ['B'], faces: [{ n: t + ' Army', t: 'Token Creature — ' + t + ' Army', img: '', p: '0', tg: '0', mc: '', o: '' }] }, 1, false, notes);
            army = Object.values(s.cards).find(c => !before.has(c.id));
          }
          if (army) { addCounter(army, '+1/+1', val(o.n)); notes.push(`${nameOf(s, by)} amassed ${val(o.n)} (${cardName(army)})`); }
          break;
        }
        case 'untap': {
          if (o.what && o.what.k === 'chooseUntap') { let n = o.what.n; for (const c of Object.values(s.cards)) if (n > 0 && c.zone === 'battlefield' && c.ctrl === by && c.tapped && R.isType(c, 'land')) { c.tapped = false; c.manaAt = null; n--; } notes.push(`${nameOf(s, by)} untapped ${o.what.n - n} land${o.what.n - n === 1 ? '' : 's'}`); break; }
          const cs = cards(o.what); for (const c of cs) { c.tapped = false; c.manaAt = null; }
          if (cs.length) notes.push(`${srcName} untapped ${R.listNames(cs.map(cardName))}`); break;
        }
        case 'skipUntap': { const cs = cards(o.what); for (const c of cs) c.skipUntap = true; if (cs.length) notes.push(`${R.listNames(cs.map(cardName))} won’t untap during ${cs.length > 1 ? 'their controllers’' : 'its controller’s'} next untap step (${srcName})`); break; }
        case 'fog': {
          if (o.what) { for (const c of cards(o.what)) { c.fogBy = s.turn.n; if (o.to) c.fogTo = s.turn.n; notes.push(`Combat damage ${o.to ? 'to and ' : ''}by ${cardName(c)} is prevented this turn (${srcName})`); } break; }
          s.turn.fog = { n: s.turn.n, non: o.non || null };
          notes.push(`All combat damage${o.non ? ' by non-' + o.non.replace(/^./, x => x.toUpperCase()) + ' creatures' : ''} is prevented this turn (${srcName})`);
          break;
        }
        case 'level': {
          const c = s.cards[srcId]; if (!c || c.zone !== 'battlefield') break;
          c.counters.level = o.n; notes.push(`${cardName(c)} is level ${o.n} now (716.2)`);
          emit({ type: 'classLevel', card: c, n: o.n, player: c.ctrl });
          break;
        }
        // The Ring tempts you (701.54): the Ring gains its next ability, and you choose a Ring-bearer.
        // Killing Wave: each player pays N life for each creature they keep; the rest are sacrificed (all at once).
        case 'payLifeOrSac': {
          const n = Math.max(0, val(o.n) || 0);
          for (const p of (s.seats || []).filter(q => s.players[q] && !s.players[q].lost)) {
            const ids = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === p && (c.faceDown || R.isType(c, 'creature'))).map(c => c.id);
            if (!ids.length) continue;
            if (isAI(s, p) || !R.live(s, p)) {
              const val0 = c => (C.pt(s, c) || [0, 0])[0] + (C.pt(s, c) || [0, 0])[1] + (c.cmdr ? 6 : 0) + (c.token ? -1 : 2);
              let life = s.players[p].life; const keep = [];
              for (const id of ids.slice().sort((a, b) => val0(s.cards[b]) - val0(s.cards[a]))) { if (n === 0 || (life - n >= 10 && val0(s.cards[id]) >= n / 2)) { keep.push(id); life -= n; } }
              payLifeOrSac(s, p, n, ids, keep, srcName, notes);
              continue;
            }
            s.ask = (s.ask || []).concat([{ id: 'a' + (++s.seq), kind: 'payLife', pid: p, life: n, name: srcName, ids, since: Date.now() }]);
          }
          break;
        }
        case 'payUntap': {
          const p = players({ k: 'evPlayer' })[0] || s.turn.active; if (!p || !s.players[p]) break;
          const ids = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === p && c.tapped && (c.faceDown || R.isType(c, 'creature')) && !(/without flying/.test(o.what) && C.has(c, 'flying', s))).map(c => c.id);
          if (!ids.length) break;
          if (isAI(s, p) || !R.live(s, p)) { const got = []; for (const id of ids.sort((a, b) => (C.pt(s, s.cards[b]) || [0])[0] - (C.pt(s, s.cards[a]) || [0])[0])) { if (!payMana(s, p, o.cost, notes)) break; s.cards[id].tapped = false; got.push(cardName(s.cards[id])); } if (got.length) notes.push(`${nameOf(s, p)} paid to untap ${R.listNames(got)} (${srcName})`); break; }
          s.ask = (s.ask || []).concat([{ id: 'a' + (++s.seq), kind: 'payUntap', pid: p, cost: o.cost, name: srcName, ids, since: Date.now() }]);
          break;
        }
        case 'gainAbility': { const c = s.cards[srcId]; if (!c || c.zone !== 'battlefield') break; c.gained = (c.gained || []).concat([String(o.text).slice(0, 300)]); notes.push(`${cardName(c)} gained “${o.text}”`); break; }
        case 'removeAll': { const c = s.cards[srcId]; if (!c) break; st.last = (c.counters || {})[o.kind] || 0; if (c.counters) delete c.counters[o.kind]; notes.push(`${cardName(c)}: removed ${st.last} ${o.kind} counter${st.last === 1 ? '' : 's'}`); break; }
        case 'discardIfNone': for (const p of s.seats) { if (!R.alive(s, p)) continue; const has = Object.values(s.cards).some(c => c.zone === 'battlefield' && c.ctrl === p && C.matchesWhat(c, o.what)); if (!has) { R.todo(s, p, { k: 'discard', n: 1, src: srcName }); notes.push(`${nameOf(s, p)} had nothing to sacrifice, so they discard a card (${srcName})`); } } break;
        case 'delayedDraw': for (const p of players(o.who)) { s.delayedDraws = (s.delayedDraws || []).concat([{ pid: p, n: o.n, after: s.turn.n, src: srcName }]); notes.push(`${nameOf(s, p)} will draw ${o.n > 1 ? o.n + ' cards' : 'a card'} at the beginning of the next upkeep (${srcName})`); } break;
        case 'rashmi': R.todo(s, by, { k: 'cascade', mv: ctx.mv || 0, top: true, discover: true, src: srcName }); notes.push(`${nameOf(s, by)} reveals the top card of their library (${srcName})`); break;
        case 'noLifeGain': { s.turn.noGain = { n: s.turn.n, by }; notes.push(`${nameOf(s, by)}’s opponents can’t gain life this turn (${srcName})`); break; }
        // Phasing (702.26): a phased-out permanent is treated as though it doesn't exist until its controller's next untap step.
        case 'phaseOut': for (const c of cards(o.what)) { if (c.zone !== 'battlefield') continue; c.zone = 'phased'; c.phasedBy = c.ctrl; for (const a of Object.values(s.cards)) if (a.attachedTo === c.id && a.zone === 'battlefield') { a.zone = 'phased'; a.phasedBy = c.ctrl; } notes.push(`${cardName(c)} phased out (${srcName})`); } break;
        case 'teferi': {
          const P = s.players[by]; if (!P) break;
          P.lifeLock = { v: P.life }; P.protAll = true;
          let n = 0; for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' && c.ctrl === by) { c.zone = 'phased'; c.phasedBy = by; n++; }
          if (s.combat && s.combat.att) for (const id of Object.keys(s.combat.att)) if (s.cards[id] && s.cards[id].zone === 'phased') delete s.combat.att[id];
          notes.push(`${nameOf(s, by)}'s life total can't change and they have protection from everything until their next turn; ${n} permanents phased out (${srcName})`);
          break;
        }
        case 'extraCombat': {
          const T = s.turn;
          // "After this phase": from inside combat it's the next combat; from a main phase, right after that main phase.
          const inCombat = /combat|attackers|blockers|damage/i.test(R.PHASES[T.phase]);
          if (o.after === 'main' || !inCombat) T.extraAfterMain = (T.extraAfterMain || 0) + 1; else T.extraCombat = (T.extraCombat || 0) + 1;
          notes.push(`There will be an additional combat phase this turn (${srcName})`);
          break;
        }
        case 'loseKw': { const cs = cards(o.what); for (const c of cs) c.loseKw = { n: s.turn.n, kws: o.kws }; if (cs.length) notes.push(`${R.listNames(cs.map(cardName))} lost ${o.kws.join(' and ')} until end of turn (${srcName})`); break; }
        case 'sacSearch': R.todo(s, by, { k: 'sacSearch', what: o.what, filter: o.filter, tapped: !!o.tapped, src: srcName }); notes.push(`${nameOf(s, by)} sacrifices any number of ${o.what}s and searches for that many (${srcName})`); break;
        case 'nameLock': for (const c of cards(o.what)) { s.nameLocks = (s.nameLocks || []).concat([{ by, owner: c.owner, name: cardName(c) }]); notes.push(`${nameOf(s, c.owner)} can’t cast spells named ${cardName(c)} until ${nameOf(s, by)}’s next turn (${srcName})`); } break;
        case 'costMod': { s.costMods = (s.costMods || []).concat([{ by, n: o.n, filter: o.filter }]); notes.push(`${o.filter ? o.filter[0].toUpperCase() + o.filter.slice(1) + ' spells' : 'Spells'} ${nameOf(s, by)}’s opponents cast cost {${o.n}} more until ${nameOf(s, by)}’s next turn (${srcName})`); break; }
        case 'setLife': for (const p of players(o.who)) { const P = s.players[p]; if (P) { P.life = o.n; notes.push(`${nameOf(s, p)}'s life total became ${o.n} (${srcName})`); } } break;
        case 'setPoison': for (const p of players(o.who)) { const P = s.players[p]; if (P && (P.poison || 0) < o.n) { P.poison = o.n; notes.push(`${nameOf(s, p)} now has ${o.n} poison counters (${srcName})`); } } break;
        case 'tempt': {
          const P = s.players[by]; if (!P) break;
          P.ring = Math.min(4, (P.ring || 0) + 1);
          const mine = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === by && (c.faceDown || R.isType(c, 'creature')));
          const cur = P.ringBearer && s.cards[P.ringBearer] && s.cards[P.ringBearer].zone === 'battlefield' && s.cards[P.ringBearer].ctrl === by ? s.cards[P.ringBearer] : null;
          const pick = cur || mine.sort((a, b) => ((C.pt(s, b) || [0])[0] - (C.pt(s, a) || [0])[0]) || (a.token - b.token))[0];
          P.ringBearer = pick ? pick.id : null;
          notes.push(`The Ring tempts ${nameOf(s, by)} (level ${P.ring})${pick ? ' — ' + cardName(pick) + ' is the Ring-bearer' : ''}`);
          emit({ type: 'tempt', player: by });
          break;
        }
        case 'extraTurn': { s.extraTurns = (s.extraTurns || []).concat([by]); notes.push(`${nameOf(s, by)} will take an extra turn after this one (${srcName}, 500.7)`); break; }
        case 'tap': { const cs = cards(o.what); for (const c of cs) c.tapped = true; if (cs.length) notes.push(`${srcName} tapped ${R.listNames(cs.map(cardName))}`); break; }
        case 'addMana': {
          let units = Array.isArray(o.units) ? o.units : [];
          if (o.units && o.units.v) units = Array(val(o.n)).fill(o.units.each || 'WUBRG');
          R.addPool(s, by, units);
          notes.push(`${nameOf(s, by)} added ${units.map(u => '{' + (u.length > 1 ? (u === 'WUBRG' ? 'any' : u.split('').join('/')) : u) + '}').join('')} (${srcName})`);
          break;
        }
        case 'counters': {
          const n = val(typeof o.n === 'number' && o.n < 0 ? -o.n : o.n) * (typeof o.n === 'number' && o.n < 0 ? -1 : 1);
          const { ps, cs } = both(o.on);
          for (const c of cs) addCounter(c, o.kind === '+1/+1|loyalty' ? (R.isType(c, 'planeswalker') ? 'loyalty' : '+1/+1') : o.kind, n);
          for (const p of ps) { const P = s.players[p]; if (P && /poison/.test(o.kind)) P.poison = Math.max(0, P.poison + n); }
          if (cs.length || ps.length) notes.push(`${srcName} ${n > 0 ? 'put' : 'removed'} ${Math.abs(n)} ${o.kind === 'any' ? '' : o.kind + ' '}counter${Math.abs(n) > 1 ? 's' : ''} ${n > 0 ? 'on' : 'from'} ${R.listNames(cs.map(cardName).concat(ps.map(p => nameOf(s, p))))}`);
          break;
        }
        case 'doubleCounters': for (const c of cards(o.on)) { const k = String(o.kind).toLowerCase(); if (c.counters[k]) addCounter(c, k, c.counters[k]); } break;
        case 'pump': {
          const cs = cards(o.what);
          const perPoison = o.per && /^poison counters? its controller has$/.test(o.per);
          const mult = o.per && !perPoison ? val({ v: 'count', what: o.per, ctrl: /you control/.test(o.per) ? 'you' : 'any' }) : 1;
          const XX = o.xv ? val(o.xv) : X; st.lastX = XX;
          let num = v => /x/.test(v) ? Math.sign(parseInt(v.replace(/x/, '1'), 10)) * XX : parseInt(v, 10) * mult;
          let p = num(o.p), t = num(o.t);
          if (o.either && cs[0] && cs[0].ctrl !== by) { p = -p; t = -t; }
          if (perPoison) { const base = [parseInt(o.p, 10), parseInt(o.t, 10)]; for (const c of cs) { const k = ((s.players[c.ctrl] || {}).poison) || 0; if (!k) continue; c.mod = [(c.mod ? c.mod[0] : 0) + base[0] * k, (c.mod ? c.mod[1] : 0) + base[1] * k]; badge(c, { label: `${base[0] * k}/${base[1] * k}`, until: 'eot' }); } notes.push(`${srcName}: creatures got -1/-1 for each poison counter their controller has`); break; }
          for (const c of cs) { c.mod = [(c.mod ? c.mod[0] : 0) + p, (c.mod ? c.mod[1] : 0) + t]; badge(c, { label: `${p >= 0 ? '+' : ''}${p}/${t >= 0 ? '+' : ''}${t}`, until: 'eot' }); if (o.kws) grantTo(c, o.kws); }
          if (cs.length) notes.push(`${R.listNames(cs.map(cardName))} got ${p >= 0 ? '+' : ''}${p}/${t >= 0 ? '+' : ''}${t}${o.kws ? ' and ' + o.kws : ''} until end of turn (${srcName})`);
          break;
        }
        case 'grant': {
          const cs = cards(o.what); const got = [];
          for (const c of cs) got.push(...grantTo(c, o.kws, o.untilNext));
          if (cs.length) notes.push(`${R.listNames(cs.map(cardName))} gained ${o.kws} ${o.untilNext ? 'until ' + nameOf(s, by) + '’s next turn' : 'until end of turn'} (${srcName})`);
          if (!got.length) st.manual.push(`Give ${o.kws}`);
          break;
        }
        case 'regen': for (const c of cards(o.what)) { if (c.zone !== 'battlefield') continue; c.regen = (c.regen || 0) + 1; badge(c, { label: 'regeneration shield', until: 'eot', regen: true }); notes.push(`${cardName(c)} has a regeneration shield until end of turn (${srcName})`); } break;
        case 'destroy': st.last = 0; for (const c of cards(o.what)) { if (C.has(c, 'indestructible', s)) { notes.push(`${cardName(c)} is indestructible`); continue; } if (!/can't be regenerated/i.test(String(item.ab ? item.ab.text : (item.d && C.text(item)) || '')) && R.regenerated(s, c, notes)) continue; const nm = cardName(c); R.moveOne(s, c, 'graveyard', 'top', null, notes); st.last++; notes.push(`${srcName} destroyed ${nm}`); } break;
        case 'flicker': for (const c of cards(o.what)) { const owner = c.owner, nm = cardName(c); R.moveOne(s, c, 'exile', 'top', null, notes); const again = s.cards[c.id]; if (again) R.moveOne(s, again, 'battlefield', 'top', { by: o.control === 'you' ? by : owner }, notes); notes.push(`${srcName} exiled ${nm} and returned it to the battlefield`); } break;
        case 'move': {
          const cs = cards(o.what);
          for (const c of cs) {
            const nm = cardName(c);
            if (o.delayed) { s.delayed = (s.delayed || []).concat([{ step: 'end', id: c.id, to: o.to, by: o.control === 'you' ? by : c.owner, tapped: o.tapped, src: srcName, n: s.turn.n }]); notes.push(`${nm} will return at the beginning of the next end step (${srcName})`); continue; }
            R.moveOne(s, c, o.to, o.pos || 'top', o.to === 'battlefield' ? { by: o.control === 'owner' ? c.owner : by, tapped: o.tapped, backFace: !!o.transformed } : null, notes);
            notes.push(`${srcName} ${o.to === 'exile' ? 'exiled' : o.to === 'hand' ? 'returned' : 'put'} ${nm}${o.to === 'hand' ? ' to its owner’s hand' : o.to === 'battlefield' ? ' onto the battlefield' : ''}`);
          }
          break;
        }
        case 'gainControl': {
          for (const c of cards(o.what)) {
            if (c.zone !== 'battlefield' || c.ctrl === by) continue;
            const prev = c.ctrl; c.ctrl = by; c.ctlT = s.turn.n; c.seq = ++s.seq;
            if (o.eot) badge(c, { label: 'borrowed', until: 'eot', control: prev });
            notes.push(`${nameOf(s, by)} gained control of ${cardName(c)}${o.eot ? ' until end of turn' : ''} (${srcName})`);
          }
          break;
        }
        case 'animate': {
          // "becomes a 3/3 Elemental creature with haste until end of turn", crewed Vehicles (205.1b keeps its other types).
          for (const c of cards(o.what)) {
            c.animated = String(o.types || 'creature').toLowerCase(); c.animPT = o.p && o.t ? [o.p === 'x' ? X : +o.p, o.t === 'x' ? X : +o.t] : null;
            c.row = 'creatures'; badge(c, { label: c.animPT ? `${c.animPT[0]}/${c.animPT[1]} ${c.animated}` : (/vehicle/i.test(R.typeLine(c)) ? 'crewed' : c.animated), until: 'eot', animate: true });
            if (o.kws) grantTo(c, o.kws);
            notes.push(`${cardName(c)} became ${c.animPT ? c.animPT.join('/') + ' ' : 'an '}${c.animated} until end of turn`);
            emit({ type: 'crewed', card: c });
          }
          break;
        }
        // "That player may pay {2}. If they don't, …": the payer is asked (the v1 AI decides by itself).
        case 'payOrElse': {
          const payer = players(o.who)[0]; if (!payer) break;
          const elseItem = { id: 'q' + (++s.seq), src: srcId, name: srcName, d: item.d, face: item.face || 0, ctrl: by, i: -1, text: o.text, effect: o.text, fixed: o.ops, optional: false, ctx, t: Date.now(), ordered: true };
          if (isAI(s, payer) || !R.live(s, payer)) {
            const spare = s.turn.active !== payer && payMana(s, payer, o.cost, notes);
            if (spare) notes.push(`${nameOf(s, payer)} paid ${o.cost} (${srcName})`); else { s.tq = s.tq || []; s.tq.push(elseItem); notes.push(`${nameOf(s, payer)} didn’t pay ${o.cost} (${srcName})`); }
            break;
          }
          s.ask = (s.ask || []).concat([{ id: 'a' + (++s.seq), kind: 'pay', pid: payer, cost: o.cost, name: srcName, by, text: o.text, item: elseItem, since: Date.now() }]);
          break;
        }
        case 'reflexive': {
          if (!st.did) break;
          s.tq = s.tq || [];
          s.tq.push({ id: 'q' + (++s.seq), src: srcId, name: srcName, d: item.d, face: item.face || 0, ctrl: by, i: -1, text: o.text, effect: o.text, fixed: o.ops, optional: false, ctx, t: Date.now(), ordered: true });
          break;
        }
        case 'discover': R.todo(s, by, { k: 'cascade', mv: (o.n | 0) + 1, discover: true, src: srcName }); notes.push(`${srcName}: discover ${o.n} (${nameOf(s, by)} reveals until a nonland card with mana value ${o.n} or less)`); break;
        case 'dig': {
          const src = s.cards[srcId];
          const n = o.n === 'mut' ? Math.max(0, ((src && src.mut) || [1]).length - 1) : 1;
          if (!n) { notes.push(`${srcName}: nothing to reveal`); break; }
          const what = o.chosen ? ((src && src.chosen) ? src.chosen + ' ' : '') + o.what : o.what;
          R.todo(s, by, { k: 'dig', what, n, dest: o.dest, tapped: !!o.tapped, rest: o.rest, top: !!o.top, mayBottom: !!o.mayBottom, src: srcName });
          notes.push(`${srcName}: ${nameOf(s, by)} reveals cards until ${n > 1 ? n + ' ' + o.what + ' cards' : (/^[aeiou]/.test(o.what) ? 'an ' : 'a ') + o.what + ' card'}`);
          break;
        }
        case 'cascade': R.todo(s, by, { k: 'cascade', mv: ctx.mv || (+((item.d || {}).cmc) || 0), src: srcName }); notes.push(`${srcName}: cascade (${nameOf(s, by)} reveals until a cheaper nonland card)`); break;
        case 'poison': { const n = val(o.n); for (const p of players(o.who)) { const P = s.players[p]; if (P) P.poison = (P.poison || 0) + n; } notes.push(`${R.listNames(players(o.who).map(p => nameOf(s, p)))} got ${n} poison counter${n > 1 ? 's' : ''} (${srcName})`); break; }
        case 'doublePT': for (const c of cards(o.what)) { const v = C.pt(s, c) || [0, 0]; if (o.powerOnly) v[1] = 0; c.mod = [(c.mod ? c.mod[0] : 0) + v[0], (c.mod ? c.mod[1] : 0) + v[1]]; badge(c, { label: `+${v[0]}/+${v[1]}`, until: 'eot' }); } notes.push(`${srcName} doubled ${o.powerOnly ? 'power' : 'power and toughness'} until end of turn`); break;
        case 'biggest': {
          for (const p of players(o.who)) {
            const cs = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === p && (c.faceDown || R.isType(c, 'creature')));
            if (!cs.length) continue;
            const top = Math.max(...cs.map(c => (C.pt(s, c) || [0])[0]));
            const c = cs.find(x => (C.pt(s, x) || [0])[0] === top);
            if (o.act === 'destroy' && C.has(c, 'indestructible', s)) { notes.push(`${cardName(c)} is indestructible`); continue; }
            const nm = cardName(c); R.moveOne(s, c, o.act === 'exile' ? 'exile' : 'graveyard', 'top', null, notes);
            notes.push(`${srcName} ${o.act === 'exile' ? 'exiled' : 'destroyed'} ${nm} (the greatest power among ${nameOf(s, p)}’s creatures)`);
          }
          break;
        }
        case 'counterSpell': for (const c of cards(o.what)) { if (c.zone !== 'stack') continue; const nm = cardName(c); if (c.ab || (c.token && !c.d)) delete s.cards[c.id]; else R.moveOne(s, c, 'graveyard', 'top', null, notes); notes.push(`${srcName} countered ${nm}`); } break;
        case 'fight': {
          const a = cards(o.a)[0], b = cards(o.b)[0];
          if (a && b && a.zone === 'battlefield' && b.zone === 'battlefield') { const pa = (C.pt(s, a) || [0])[0], pb = (C.pt(s, b) || [0])[0]; hurt({ c: b }, pa, a); hurt({ c: a }, pb, b); notes.push(`${cardName(a)} fought ${cardName(b)}`); }
          break;
        }
        case 'transform': { const c = src && s.cards[src.id]; if (c && c.d && c.d.faces.length > 1) { const nm = cardName(c); c.face = c.face ? 0 : 1; c.row = R.rowFor(c); notes.push(`${nm} transformed into ${cardName(c)}`); } break; }
        case 'search': {
          if (/^basic (?:land|plains|island|swamp|mountain|forest)/.test(o.filter) || o.filter === 'basic land') R.todo(s, by, { k: 'fetch', n: o.n, dest: o.dest, tapped: o.tapped, split: o.split, filter: o.filter, src: srcName });
          else R.todo(s, by, { k: 'search', n: o.n, upTo: o.upTo, dest: o.dest, tapped: o.tapped, filter: o.filter, mvMax: o.mvMax == null ? undefined : val(o.mvMax), splitGy: !!o.splitGy, src: srcName });
          break;
        }
        case 'attach': { const at = o.what && o.what.k === 'ev' ? s.cards[ctx.c] : src && s.cards[src.id], t = o.to && o.to.k === 'lastToken' ? s.cards[(st.tokens || [])[0]] : cards(o.to)[0]; if (at && t && at.zone === 'battlefield' && t.zone === 'battlefield') { at.attachedTo = t.id; notes.push(`${cardName(at)} is now attached to ${cardName(t)}`); } break; }
        case 'extraLand': { const T = s.turn; T.extraLand = T.extraLand || {}; T.extraLand[by] = (T.extraLand[by] || 0) + (o.n || 1); notes.push(`${nameOf(s, by)} may play an additional land this turn`); break; }
        case 'roll': { const r = 1 + Math.floor(Math.random() * o.d); st.last = r; notes.push(`${nameOf(s, by)} rolled a d${o.d}: ${r} (${srcName})`); break; }
        case 'fromHand': {
          if (o.via && ctx.c && s.cards[ctx.c] && s.cards[ctx.c].via === o.via) { notes.push(`${srcName}: that one was put onto the battlefield with this ability, so nothing happens`); break; }
          R.todo(s, by, { k: 'fromHand', n: val(o.n), filter: o.filter, tapped: !!o.tapped, mvMax: o.mvMax ? val(o.mvMax) : undefined, via: o.via || undefined, src: srcName }); break;
        }
        case 'fromGy': R.todo(s, by, { k: 'fromGy', n: val(o.n), filter: o.filter, dest: o.dest || 'hand', tapped: !!o.tapped, src: srcName }); break;
        case 'sacUnless': R.todo(s, by, { k: 'sacUnless', n: val(o.n), what: o.what, srcId, src: srcName }); notes.push(`${nameOf(s, by)} sacrifices ${o.what === 'land' ? 'a land' : o.what} or ${srcName}`); break;
        case 'sacUnlessPay': { const c0 = s.cards[srcId]; if (!c0 || c0.zone !== 'battlefield') break; if (pay(o.cost)) notes.push(`${nameOf(s, by)} paid ${o.cost} to keep ${srcName}`); else { R.moveOne(s, c0, 'graveyard', 'top', { sac: true }, notes); notes.push(`${nameOf(s, by)} couldn’t pay ${o.cost}, so ${srcName} was sacrificed`); } break; }
        case 'tapUntap': for (const c of cards(o.what)) { c.tapped = c.ctrl !== by; if (!c.tapped) c.manaAt = null; notes.push(`${srcName} ${c.tapped ? 'tapped' : 'untapped'} ${cardName(c)}`); } break;
        case 'loseGame': {
          const K = s.combat;
          const losers = s.seats.filter(p => p !== by && R.alive(s, p) && (o.attacked ? !!(K && K.n === s.turn.n && Object.entries(K.att || {}).some(([id, x]) => id === srcId && (x.def.p === p))) : (s.players[p] || {}).life === o.life));
          for (const p of losers) { s.players[p].life = Math.min(s.players[p].life, 0); s.players[p].lostWhy = srcName; notes.push(`${nameOf(s, p)} loses the game (${srcName})`); }
          if (!o.attacked && s.players[by] && s.players[by].life === o.life) { s.players[by].life = 0; notes.push(`${nameOf(s, by)} loses the game (${srcName})`); }
          break;
        }
        case 'bounceOwn': R.todo(s, by, { k: 'returnOwn', n: 1, what: o.what, src: srcName }); break;
        case 'pay': { st.did = pay(o.cost); notes.push(st.did ? `${nameOf(s, by)} paid ${o.cost} (${srcName})` : `${nameOf(s, by)} couldn’t pay ${o.cost} (${srcName})`); break; }
        case 'modes': { let off = 0; for (const mi of (opt.mode || [0])) { const md = o.modes[mi]; if (!md) continue; runList(md.ops, off); off += md.nTargets || 0; } break; }
        // Nykthos: mana of the color I have the most devotion to (700.5) — the color is chosen as it resolves.
        case 'addDevotion': {
          const dev = { W: 0, U: 0, B: 0, R: 0, G: 0 };
          for (const c of Object.values(s.cards)) { if (c.zone !== 'battlefield' || c.ctrl !== by || c.faceDown || !c.d) continue; const mc = (R.face(c) || {}).mc || ''; for (const m of mc.match(/\{[^}]+\}/g) || []) for (const col of 'WUBRG') if (m.includes(col)) dev[col]++; }
          const [col, n] = Object.entries(dev).sort((a, b) => b[1] - a[1])[0];
          if (n > 0) R.addPool(s, by, Array(n).fill(col));
          notes.push(`${nameOf(s, by)} added ${n} ${({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' })[col]} mana (devotion, ${srcName})`);
          break;
        }
        case 'delayedMana': {
          const t = (legal[0] || [])[0], c = t && t.c && s.cards[t.c];
          const n = c && c.d ? (+c.d.cmc || 0) : 0;
          if (n) { s.delayedMana = (s.delayedMana || []).concat([{ pid: by, n, after: s.turn.n, src: srcName }]); notes.push(`${nameOf(s, by)} will add {C}×${n} at the beginning of their next main phase (${srcName})`); }
          break;
        }
        case 'fetchFor': for (const p of players(o.who)) { R.todo(s, p, { k: 'fetch', n: 1, dest: 'battlefield', tapped: !!o.tapped, optional: true, src: srcName }); notes.push(`${nameOf(s, p)} may search for a basic land (${srcName})`); } break;
        case 'impulse': { const n = val(o.n); R.todo(s, by, { k: 'impulse', n, until: o.until, from: s.turn.n, src: srcName }); notes.push(`${nameOf(s, by)} exiles the top ${n > 1 ? n + ' cards' : 'card'} of their library and may play ${n > 1 ? 'them' : 'it'} ${o.until === 'next' ? 'until the end of their next turn' : 'this turn'} (${srcName})`); break; }
        // "You may tap X untapped Myr you control" (Myr Battlesphere): tap every other untapped one that isn't attacking.
        case 'tapX': {
          const K = s.combat;
          const list = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === by && c.id !== srcId && !c.tapped && (c.faceDown || R.isType(c, 'creature')) && C.matchesWhat(c, o.what) && !(K && K.att && K.att[c.id]));
          for (const c of list) c.tapped = true;
          st.lastX = list.length; st.did = list.length > 0;
          notes.push(`${nameOf(s, by)} tapped ${list.length} untapped ${o.what} (${srcName})`);
          if (list.length) runList(o.then || [], 0);
          break;
        }
        // A rule that lasts a while ("until your next turn, your opponents can't cast spells from anywhere other than their hands").
        case 'ruleFx': { s.ruleFx = (s.ruleFx || []).concat([{ by, src: srcId, name: srcName, line: String(o.line).slice(0, 300), until: o.until, turn: s.turn.n }]).slice(-40); notes.push(`${srcName}: ${o.until === 'next' ? 'until ' + nameOf(s, by) + '’s next turn' : o.until === 'game' ? 'for the rest of the game' : 'this turn'}, ${o.line}`); break; }
        case 'noteLife': { const h = s.cards[srcId]; if (h) { h.noted = (s.players[by] || {}).life || 0; notes.push(`${srcName} noted ${nameOf(s, by)}’s life total: ${h.noted}`); } break; }
        case 'handToTop': R.todo(s, by, { k: 'handToTop', n: val(o.n), src: srcName }); break;
        case 'look': R.todo(s, by, { k: 'look', n: val(o.n), reveal: !!o.reveal, text: o.text, src: srcName }); break;
        case 'addlCost': case 'altCost': case 'choose': case 'rest': case 'newTargets': break;
        case 'reveal': for (const p of players(o.who)) notes.push(`${nameOf(s, p)} reveals their hand (${srcName}) — they show it to the table`); break;
        case 'shuffleGy': for (const p of players(o.who)) { const gy = Object.values(s.cards).filter(c => c.zone === 'graveyard' && c.owner === p); for (const c of gy) R.moveOne(s, c, 'library', 'shuffle', null, notes); notes.push(`${nameOf(s, p)} shuffled their graveyard (${gy.length}) into their library (${srcName})`); } break;
        case 'freeCast': if (o.from === 'hand' || o.from === 'graveyard') { R.todo(s, by, { k: 'freeCast', from: o.from, filter: o.filter, mvMax: o.mvMax == null ? undefined : val(o.mvMax), src: srcName }); notes.push(`${nameOf(s, by)} may cast ${o.filter === 'card' ? 'a spell' : 'a ' + o.filter + ' spell'} from their ${o.from} for free (${srcName})`); } else st.manual.push(o.src || 'Cast it without paying its mana cost'); break;
        case 'manual': st.manual.push(o.text); break;
        default: st.manual.push(o.text || (typeof o.src === 'string' ? o.src : '') || o.op);
      }
    };
    runList(ops, 0);
    if (st.manual.length) {
      s.ask = (s.ask || []).concat([{ id: 'a' + (++s.seq), kind: 'manual', pid: by, name: srcName, text: st.manual.slice(0, 6), since: Date.now() }]);
      notes.push(`${srcName}: ${nameOf(s, by)} finishes by hand — “${st.manual.join('. ')}”`);
    } else if (!opt.spell) notes.push(`${srcName}’s ability resolved`);
  }
  // Pay a mana cost for an optional "you may pay {N}" — from the pool first, then untapped lands (auto-pay).
  function payMana(s, pid, cost, notes) {
    const R = I(), C = Cd();
    const need = C.parseCost ? C.parseCost(cost) : null; if (!need) return false;
    const total = need.g + need.W + need.U + need.B + need.R + need.G + need.C;
    const P = s.players[pid];
    const units = (P.pool || []).map((u, i) => ({ u, pool: i }));
    const lands = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === pid && !c.tapped && R.isType(c, 'land') && R.unitsOf(c).length);
    for (const l of lands) for (const u of R.unitsOf(l)) units.push({ u, land: l });
    const used = new Set(), take = ok => { const i = units.findIndex((x, k) => !used.has(k) && ok(x.u)); if (i < 0) return false; used.add(i); return true; };
    for (const col of ['W', 'U', 'B', 'R', 'G', 'C']) for (let k = 0; k < need[col]; k++) if (!take(u => u.includes(col))) return false;
    for (const [a1, b1] of need.hy || []) { if (take(u => u.includes(a1) || u.includes(b1))) continue; if (a1 === '2' && take(() => true) && take(() => true)) continue; return false; }
    for (const c1 of need.ph || []) { if (take(u => u.includes(c1))) continue; if (P.life < 2) return false; P.life -= 2; }
    for (let k = 0; k < need.g; k++) if (!take(() => true)) return false;
    if (used.size < total) return false;
    const poolDrop = new Set(), tapped = new Set();
    for (const k of used) { const x = units[k]; if (x.pool != null) poolDrop.add(x.pool); else tapped.add(x.land); }
    P.pool = (P.pool || []).filter((u, i) => !poolDrop.has(i));
    // A land that makes more than one mana gives the rest to the pool.
    for (const l of tapped) { l.tapped = true; l.manaAt = s.turn.n; const all = R.unitsOf(l); const spent = [...used].filter(k => units[k].land === l).length; if (all.length > spent) R.addPool(s, pid, all.slice(spent)); }
    return true;
  }

  // ======================= answers from players =======================
  function answer(s, pid, a, notes) {
    const R = I(), C = Cd();
    const list = s.ask || [];
    const ask = list.find(x => x.id === a.id);
    if (!ask) return { ok: true, stale: true };
    if (ask.pid !== pid && !a.dev) return { ok: false, err: 'That choice belongs to ' + nameOf(s, ask.pid) + '.' };
    s.ask = list.filter(x => x !== ask);
    if (ask.kind === 'manual') return { ok: true };
    if (ask.kind === 'order') {
      const ids = Array.isArray(a.order) ? a.order : ask.items.map(x => x.id);
      // The last one listed goes on the stack first? No — the player lists them in the order they should RESOLVE.
      const rank = {}; ids.forEach((id, k) => { rank[id] = ids.length - k; });
      for (const q of s.tq || []) if (rank[q.id] != null) q.ord = rank[q.id];
      place(s, notes); return { ok: true };
    }
    if (ask.kind === 'modes') {
      const q = (s.tq || []).find(x => x.id === ask.q); if (!q) return { ok: true };
      const pick = [...new Set((Array.isArray(a.modes) ? a.modes : [0]).map(x => x | 0).filter(x => x >= 0 && x < ask.modes.length && !(ask.off || []).includes(x)))];
      if (pick.length < ask.min || pick.length > ask.max) { s.ask.push(ask); return { ok: false, err: `Choose ${ask.min === ask.max ? ask.min : ask.min + '–' + ask.max} mode${ask.max > 1 ? 's' : ''}.` }; }
      q.mode = pick;
      place(s, notes); return { ok: true };
    }
    if (ask.kind === 'targets') {
      const q = (s.tq || []).find(x => x.id === ask.q); if (!q) return { ok: true };
      const tg = R.cleanTargets(a.tg, ask.reqs.length);
      for (let k = 0; k < ask.reqs.length; k++) {
        const r = ask.reqs[k];
        const okSet = new Set(r.choices.map(t => t.p ? 'p' + t.p : 'c' + t.c));
        if (tg[k].some(t => !okSet.has(t.p ? 'p' + t.p : 'c' + t.c))) { s.ask.push(ask); return { ok: false, err: 'That isn’t a legal target for this ability.' }; }
        if (tg[k].length > r.n || (!r.upTo && tg[k].length < Math.min(r.n, r.choices.length))) { s.ask.push(ask); return { ok: false, err: `Choose ${r.upTo ? 'up to ' : ''}${r.n} for “${r.label}”.` }; }
      }
      q.tg = tg;
      place(s, notes); return { ok: true };
    }
    if (ask.kind === 'assign') {
      const K = s.combat; if (!K || K.done) return { ok: true };
      const plan = {}; let total = 0;
      for (const b of ask.blockers) { const n = Math.max(0, (a.assign && a.assign[b.id]) | 0); plan[b.id] = n; total += n; }
      const toPlayer = Math.max(0, (a.assign && a.assign.player) | 0);
      if (total + toPlayer > ask.power) { s.ask.push(ask); return { ok: false, err: `${ask.name} has only ${ask.power} power to assign.` }; }
      // 510.1c (since 2024 there is no damage assignment order): divide it among the blockers however you like;
      // with trample, damage goes to the player only once every blocker has lethal damage (702.19b; deathtouch: 1 is lethal).
      if (toPlayer && (!ask.trample || ask.blockers.some(b => plan[b.id] < (ask.deathtouch ? 1 : b.lethal)))) { s.ask.push(ask); return { ok: false, err: ask.trample ? 'With trample, assign lethal damage to every blocker before any goes to the player (702.19b).' : 'Without trample, all of its damage goes to the blockers.' }; }
      if (total + toPlayer < ask.power) { s.ask.push(ask); return { ok: false, err: `Assign all ${ask.power} damage.` }; }
      if (toPlayer) plan.player = toPlayer;
      K.assign = K.assign || {}; K.assign[ask.att] = plan;
      I().combatDamage(s, notes);
      return { ok: true };
    }
    if (ask.kind === 'choose') {
      const c = s.cards[ask.card]; if (!c) return { ok: true };
      let v = String(a.value || '').trim().slice(0, 40);
      if ((ask.what === 'player' || ask.what === 'opponent') && !ask.players.includes(v)) v = ask.players[0];
      if (!v) v = defaultChoice(s, c, ask.what);
      c.chosen = v;
      notes.push(`${cardName(c)}: ${nameOf(s, ask.pid)} chose ${ask.what === 'player' || ask.what === 'opponent' ? nameOf(s, v) : v}`);
      return { ok: true };
    }
    if (ask.kind === 'copy') {
      const c = s.cards[ask.card]; if (!c) return { ok: true };
      if (a.pick && ask.choices.includes(a.pick) && s.cards[a.pick]) becomeCopy(s, c, s.cards[a.pick], notes);
      else notes.push(`${cardName(c)} entered as itself (no copy)`);
      return { ok: true };
    }
    if (ask.kind === 'payLife') {
      payLifeOrSac(s, pid, ask.life, ask.ids, (Array.isArray(a.ids) ? a.ids : []).filter(id => ask.ids.includes(id)), ask.name, notes);
      return { ok: true };
    }
    if (ask.kind === 'payUntap') {
      const want = (Array.isArray(a.ids) ? a.ids : []).filter(id => ask.ids.includes(id) && s.cards[id] && s.cards[id].tapped);
      const got = [];
      for (const id of want) { if (!payMana(s, pid, ask.cost, notes)) break; s.cards[id].tapped = false; got.push(cardName(s.cards[id])); }
      if (got.length) notes.push(`${nameOf(s, pid)} paid ${ask.cost} each to untap ${R.listNames(got)} (${ask.name})`);
      return { ok: true };
    }
    if (ask.kind === 'pay') {
      if (a.yes && payMana(s, pid, ask.cost, notes)) { notes.push(`${nameOf(s, pid)} paid ${ask.cost} (${ask.name})`); place(s, notes); return { ok: true }; }
      if (a.yes) notes.push(`${nameOf(s, pid)} couldn’t pay ${ask.cost} with untapped lands (${ask.name})`);
      else notes.push(`${nameOf(s, pid)} didn’t pay ${ask.cost} (${ask.name})`);
      s.tq = s.tq || []; s.tq.push(Object.assign({}, ask.item, { t: Date.now() }));
      place(s, notes); return { ok: true };
    }
    if (ask.kind === 'mutate') {
      const h = s.cards[ask.card]; if (!h) return { ok: true };
      mutOrder(s, h, ask.comp, a.top !== false, notes);
      return { ok: true };
    }
    if (ask.kind === 'enterOpt') {
      const c = s.cards[ask.card]; if (!c) return { ok: true };
      if (a.yes && ask.life) { s.players[ask.pid].life -= ask.life; notes.push(`${nameOf(s, ask.pid)} paid ${ask.life} life so ${cardName(c)} entered untapped`); }
      else if (a.yes) notes.push(`${nameOf(s, ask.pid)} revealed a card so ${cardName(c)} entered untapped`);
      else { c.tapped = true; notes.push(`${cardName(c)} entered tapped`); }
      return { ok: true };
    }
    if (ask.kind === 'legend') {
      const keep = ask.ids.includes(a.keep) ? a.keep : ask.ids[ask.ids.length - 1];
      for (const id of ask.ids) if (id !== keep && s.cards[id] && s.cards[id].zone === 'battlefield') { const nm = cardName(s.cards[id]); I().moveOne(s, s.cards[id], 'graveyard', 'top', null, notes); notes.push(`${nameOf(s, ask.pid)} kept one ${nm} and put the other into the graveyard (legend rule, 704.5j)`); }
      return { ok: true };
    }
    if (ask.kind === 'may') {
      const it = s.cards[ask.item];
      if (it && it.ab) { it.ab.may = !!a.yes; if (ask.cond) it.ab.condOk = a.cond === undefined ? !!a.yes : !!a.cond; }
      if (s.prio) { s.prio.holder = null; R.nextHolder(s, notes); }
      return { ok: true };
    }
    return { ok: true };
  }
  // Pay N life for each creature kept (only while the life total covers it, 119.4); sacrifice the rest.
  function payLifeOrSac(s, pid, n, ids, keep, name, notes) {
    const R = I(); const P = s.players[pid]; if (!P) return;
    const kept = [];
    for (const id of keep) { const c = s.cards[id]; if (!c || c.zone !== 'battlefield') continue; if (n > 0 && P.life < n) break; if (n > 0) P.life -= n; kept.push(id); }
    if (kept.length && n > 0 && R.alertChecks) R.alertChecks(s, pid);
    const gone = ids.filter(id => !kept.includes(id) && s.cards[id] && s.cards[id].zone === 'battlefield');
    for (const id of gone) R.moveOne(s, s.cards[id], 'graveyard', 'top', { sac: true }, notes);
    notes.push(`${nameOf(s, pid)} ${kept.length ? `paid ${n * kept.length} life to keep ${R.listNames(kept.map(id => cardName(s.cards[id])))}` : 'kept no creatures'}${gone.length ? ` and sacrificed ${gone.length}` : ''} (${name})`);
  }
  // 2 minutes without an answer: the table decides (no, first mode, best targets, default order).
  function timeouts(s, notes) {
    const R = I(); let changed = false;
    const now = Date.now();
    for (const ask of (s.ask || []).slice()) {
      const stale = now - (ask.since || 0) > ASK_MS || !R.live(s, ask.pid);
      if (!stale) continue;
      if (ask.kind === 'manual') { if (now - ask.since > 10 * 60000) { s.ask = s.ask.filter(x => x !== ask); changed = true; } continue; }
      s.ask = s.ask.filter(x => x !== ask); changed = true;
      if (ask.kind === 'assign') { const K = s.combat; if (K && !K.done) { K.assign = K.assign || {}; K.assign[ask.att] = 'auto'; I().combatDamage(s, notes); } continue; }
      if (ask.kind === 'payUntap') { continue; }
      if (ask.kind === 'payLife') { s.ask.push(ask); answer(s, ask.pid, { id: ask.id, ids: [] }, notes); continue; }
      if (ask.kind === 'pay') { s.ask.push(ask); answer(s, ask.pid, { id: ask.id, yes: false }, notes); continue; }
      if (ask.kind === 'mutate') { s.ask.push(ask); answer(s, ask.pid, { id: ask.id, top: true }, notes); continue; }
      if (ask.kind === 'choose' || ask.kind === 'enterOpt' || ask.kind === 'copy') { s.ask.push(ask); answer(s, ask.pid, { id: ask.id, value: '', yes: false }, notes); continue; }
      if (ask.kind === 'legend') { s.ask.push(ask); answer(s, ask.pid, { id: ask.id, keep: ask.ids[ask.ids.length - 1] }, notes); continue; }
      if (ask.kind === 'may') { const it = s.cards[ask.item]; if (it && it.ab) { it.ab.may = false; it.ab.condOk = false; } notes.push(`${ask.name}: no answer in time, so it wasn’t used`); if (s.prio) { s.prio.holder = null; R.nextHolder(s, notes); } }
      else { const q = (s.tq || []).find(x => x.id === ask.q); if (q) q.timeout = true; for (const q2 of s.tq || []) if (ask.kind === 'order') q2.ordered = true; place(s, notes); }
    }
    // Priority held for 2 minutes: they pass.
    const P = s.prio;
    if (P && P.holder && now - (P.since || 0) > ASK_MS) { if (!P.passed.includes(P.holder)) P.passed.push(P.holder); notes.push(`${nameOf(s, P.holder)} didn’t answer in 2 minutes, so they passed`); R.nextHolder(s, notes); changed = true; }
    return changed;
  }

  // ======================= temporary effects =======================
  // Cleanup step (514.2): "until end of turn" effects end; badges and the counters they stood for go away.
  function endOfTurn(s) {
    if (root.Rulebook) root.Rulebook.expire(s, 'eot');
    // Impulse-drawn cards stop being playable (eot: this turn; next: at the end of their owner's next turn).
    for (const c of Object.values(s.cards)) {
      const mp = c.mayPlay; if (!mp) continue;
      if (c.zone !== 'exile' || (mp.until === 'eot' && s.turn.n >= mp.from) || (mp.until === 'next' && s.turn.active === mp.by && s.turn.n > mp.from)) c.mayPlay = null;
    }
    for (const c of Object.values(s.cards)) {
      if (!c.eot) continue;
      const keep = [];
      for (const b of c.eot) {
        if (b.until && b.until !== 'eot') { keep.push(b); continue; }
        if (b.counter && c.counters && c.counters[b.counter]) { c.counters[b.counter]--; if (!c.counters[b.counter]) delete c.counters[b.counter]; }
        if (b.animate) { c.animated = null; c.animPT = null; if (c.zone === 'battlefield') c.row = I().rowFor(c); }
        if (b.regen) c.regen = 0;
        if (b.control && c.zone === 'battlefield' && s.players[b.control]) { c.ctrl = b.control; c.ctlT = s.turn.n; c.seq = ++s.seq; }
      }
      c.eot = keep.length ? keep : null;
    }
  }
  // "Until your next turn" ends as that player's turn begins (611.2b).
  function turnBegins(s, pid) {
    for (const c of Object.values(s.cards)) {
      if (!c.eot) continue;
      const keep = [];
      for (const b of c.eot) {
        if (b.until === pid) { if (b.counter && c.counters && c.counters[b.counter]) { c.counters[b.counter]--; if (!c.counters[b.counter]) delete c.counters[b.counter]; } continue; }
        keep.push(b);
      }
      c.eot = keep.length ? keep : null;
    }
    s.turn.stats = { attacked: {}, died: 0, gained: {}, lost: {}, spells: {}, drew: {} };
    s.turn.extraLand = {};
    s.turn.permUse = {};
    if (root.Rulebook) root.Rulebook.expire(s, 'turn', pid);
    if (s.costMods) s.costMods = s.costMods.filter(m => m.by !== pid);
    if (s.nameLocks) s.nameLocks = s.nameLocks.filter(m => m.by !== pid);
  }
  // Delayed triggers ("return it at the beginning of the next end step").
  function delayed(s, step, notes) {
    if (!s.delayed || !s.delayed.length) return;
    const R = I(), keep = [];
    for (const d of s.delayed) {
      if (d.step !== step) { keep.push(d); continue; }
      const c = s.cards[d.id];
      if (c && c.zone !== 'battlefield') { R.moveOne(s, c, d.to, 'top', d.to === 'battlefield' ? { by: d.by, tapped: d.tapped } : null, notes); notes.push(`${cardName(c)} returned (${d.src})`); }
      else if (c && c.zone === 'battlefield' && d.to !== 'battlefield' && d.energy && s.players[c.ctrl] && (s.players[c.ctrl].energy || 0) >= ((c.d && +c.d.cmc) || 0)) { const mv = (c.d && +c.d.cmc) || 0; s.players[c.ctrl].energy -= mv; notes.push(`${nameOf(s, c.ctrl)} paid ${mv} energy to keep ${cardName(c)} (${d.src})`); }
      else if (c && c.zone === 'battlefield' && d.to !== 'battlefield') { const nm = cardName(c); R.moveOne(s, c, d.to, 'top', { sac: !!d.sac }, notes); if (d.src === 'warp' && s.cards[c.id]) s.cards[c.id].warpedOut = true; notes.push(`${nm} ${d.to === 'hand' ? 'returned to its owner’s hand' : d.to === 'exile' ? 'was exiled' : 'was sacrificed'} (${d.src})`); }
    }
    s.delayed = keep;
  }

  // ======================= turn flow =======================
  // The active player only says "Go to combat" or "End turn"; the steps in between happen by themselves,
  // stopping whenever something is on the stack, a choice is pending, or blockers are being declared.
  function canAttack(s, pid) {
    const R = I(), C = Cd();
    return Object.values(s.cards).some(c => c.zone === 'battlefield' && c.ctrl === pid && (c.faceDown || R.isType(c, 'creature')) && !c.tapped &&
      (!R.sick(s, c) || C.has(c, 'haste', s)) && !C.has(c, 'defender', s) && !C.has(c, "can't attack", s));
  }
  function busy(s) {
    const R = I();
    return !!(R.stackTop(s) || s.prio || (s.tq && s.tq.length) || (s.ask || []).some(x => x.kind !== 'manual') || s.winner);
  }
  function flow(s, notes) {
    const R = I(), T = s.turn;
    if (!T || !T.active || s.winner) return;
    for (let guard = 0; guard < 30; guard++) {
      if (!T.goal || busy(s)) return;
      const PI = R.PI, ph = T.phase;
      if (T.goal === 'main1' && ph >= PI('Main 1')) { T.goal = null; return; }
      if (T.goal === 'combat' && ph >= PI('Declare attackers')) { T.goal = null; if (!canAttack(s, T.active)) { T.goal = 'main2'; noCombat(s); continue; } return; }
      if (T.goal === 'main2' && ph >= PI('Main 2')) { T.goal = null; return; }
      const K = s.combat;
      if (K && K.n === T.n && !K.done && Object.keys(K.att || {}).length) return;   // combat in progress
      if (ph >= PI('Cleanup')) { R.passTurn(s, T.active, [], () => ({ ok: true }), true); check(s, notes); continue; }
      let next = ph + 1;
      // Additional combat phases (505.1a): Lightning Runner, Great Train Heist ("after this phase"), Aggravated Assault ("after this main phase … followed by an additional main phase").
      if (R.PHASES[ph] === 'End of combat' && T.extraCombat > 0) { T.extraCombat--; s.combat = null; next = PI('Beginning of combat'); T.goal = 'combat'; notes.push(`${nameOf(s, T.active)} gets an additional combat phase`); }
      else if (R.PHASES[ph] === 'Main 2' && T.extraAfterMain > 0) { T.extraAfterMain--; s.combat = null; next = PI('Beginning of combat'); T.goal = 'combat'; notes.push(`${nameOf(s, T.active)} gets an additional combat phase and main phase`); }
      if (R.PHASES[next] === 'Declare attackers' && T.goal === 'pass') noCombat(s);
      // 508.8: with no attackers, the declare blockers and combat damage steps are skipped.
      if ((R.PHASES[next] === 'Declare blockers' || R.PHASES[next] === 'Combat damage') && !(K && K.n === T.n && Object.keys(K.att || {}).length)) next = PI('End of combat');
      T.phase = next;
      if (R.PHASES[next] === 'Cleanup') { R.clearMods(s); endOfTurn(s); }
      if (R.PHASES[next] === 'End step') delayed(s, 'end', notes);
      if (R.PHASES[next] === 'End of combat') delayed(s, 'endCombat', notes);
      check(s, notes);
      // Before the turn ends, the other players get a chance to act in the end step — but only humans who can respond;
      // their screens pass by themselves when they have nothing to do (117.3).
      if (R.PHASES[next] === 'End step' && T.goal === 'pass' && !busy(s)) {
        const order = R.rotate(s, T.active).slice(1).filter(p => R.live(s, p) && !isAI(s, p));
        if (order.length) { s.prio = { order, passed: [], holder: null, since: Date.now(), top: null, step: 'end' }; R.nextHolder(s, notes); }
      }
    }
  }
  function noCombat(s) { const T = s.turn; if (!s.combat || s.combat.n !== T.n) s.combat = { n: T.n, att: {}, waiting: [], ok: {}, done: true }; }

  // After every action (and on the host's timer): look for triggers, put them on the stack, move the turn along.
  function after(s, notes) {
    const R = I(); if (!R || !s.turn) return;
    check(s, notes);
    place(s, notes);
    // Sagas whose last chapter has resolved are sacrificed (714.4).
    for (const c of Object.values(s.cards)) {
      if (c.zone !== 'battlefield' || c.faceDown || !c.counters || !c.counters.lore) continue;
      const M = O().model(c); if (!M) continue;
      const last = Math.max(0, ...M.abilities.filter(a => a.chapter).map(a => Math.max(...a.chapter)));
      if (!last || c.counters.lore < last) continue;
      if (Object.values(s.cards).some(x => x.zone === 'stack' && x.ab && x.ab.src === c.id) || (s.tq || []).some(q => q.src === c.id)) continue;
      R.moveOne(s, c, 'graveyard', 'top', { sac: true }, notes); notes.push(`${cardName(c)} was sacrificed after its last chapter (714.4)`);
    }
    legendRule(s, notes);
    flow(s, notes);
    check(s, notes);
  }
  // 704.5j: two or more legendary permanents with the same name — their controller chooses one to keep.
  function legendRule(s, notes) {
    const R = I(), groups = {};
    for (const c of Object.values(s.cards)) {
      if (c.zone !== 'battlefield' || c.faceDown || !/\blegendary\b/i.test(R.typeLine(c))) continue;
      const k = c.ctrl + '|' + cardName(c); (groups[k] = groups[k] || []).push(c);
    }
    for (const list of Object.values(groups)) {
      if (list.length < 2) continue;
      const pid = list[0].ctrl, ids = list.sort((a, b) => a.seq - b.seq).map(c => c.id);
      if ((s.ask || []).some(x => x.kind === 'legend' && x.ids.join() === ids.join())) continue;
      const ask = { id: 'a' + (++s.seq), kind: 'legend', pid, ids, name: cardName(list[0]), since: Date.now() };
      s.ask = (s.ask || []).concat([ask]);
      if (isAI(s, pid) || !R.live(s, pid)) answer(s, pid, { id: ask.id, keep: ids[ids.length - 1] }, notes);
    }
  }
  // Is this (cards.js) triggered ability one the engine already puts on the stack by itself?
  function handles(c, text) {
    const M = c && c.d && O() ? O().model(c) : null; if (!M) return false;
    const t = norm(text);
    return M.abilities.some(a => a.kind === 'triggered' && a.event && a.event.type !== 'other' && (norm(a.text) === t || norm(a.effect) === t || t.includes(norm(a.effect)) || norm(a.text).includes(t)));
  }

  root.Engine = { mutate, mutOrder, spellOps, emit, begin, check, place, hold, resolve, run, answer, timeouts, endOfTurn, turnBegins, flow, after, handles, canRun, canAttack, snap, payMana, _ev: () => EV };
})(typeof window !== 'undefined' ? window : globalThis);
