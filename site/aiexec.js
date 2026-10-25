// Kitchen Table — the AI's hands: carries out the brain's plan through the table, one action at a time.
// Works with any "io" adapter (the browser AI page in ai.js, or the node simulator in test/ai_sim.js):
//   io.s() state · io.me() my seat · io.hand() my hand · io.lib() my library (UNORDERED copy) · io.act(a) → result
//   io.castFromHand(id, opts) · io.castPublic(id, opts) · io.playLand(id) · io.tapPay(ids)
//   io.privPhase() 'none'|'deciding'|'bottom'|'kept' · io.mulls() · io.bottomN() · io.openingHand() · io.keep() · io.mulligan() · io.bottom(ids)
//   io.drawForTurn() (once per turn) · io.discard(ids, why) · io.libTop(n) (cards I'm allowed to see: look/scry) · io.applyLook(mode, n, decisions)
//   io.searchTake(ids, t) · io.cascadeReveal(mv) · io.cascadeDecline(id) · io.fromHand(ids, zone, opts) · io.move(ids, to, extra)
// Every move is written to the brain's log: what it planned, what it did, and anything the table refused.
(function (root) {
  'use strict';
  const R = () => root.Rules, C = () => root.Cards;
  const roles = c => root.AIBrain.roles(c);

  function Exec(brain, io) {
    this.B = brain;
    // The adapter's table-changing calls are logged on the wire too.
    const self = this, wrapped = Object.assign({}, io);
    for (const k of ['castFromHand', 'castPublic', 'playLand', 'tapPay', 'move', 'fromHand', 'discard']) {
      if (typeof io[k] !== 'function') continue;
      wrapped[k] = async (...args) => { let r; try { r = await io[k](...args); } catch (e) { r = { ok: false, err: e.message }; } self.wire('out', `${k} ${JSON.stringify(args).slice(0, 90)} → ${r && r.ok === false ? 'refused: ' + r.err : 'ok'}`); return r; };
    }
    this.io = wrapped;
    this.state = {};           // per turn: step key -> 'done' | 'failed:<err>'
    this.firedAt = {};
    this.tried = new Set();
    this.askTries = {};
    brain.doneCheck = key => !!this.markOf(key);
  }
  const E = Exec.prototype;
  E.view = function () { return { s: this.io.s(), me: this.io.me(), hand: this.io.hand(), lib: this.io.lib() }; };
  E.mark = function (key, v) { const s = this.io.s(); const k = s.gameId + ':' + s.turn.n; (this.state[k] = this.state[k] || {})[key] = v; };
  E.markOf = function (key) { const s = this.io.s(); return ((this.state[s.gameId + ':' + s.turn.n]) || {})[key]; };
  E.did = function (step, r, text) {
    const B = this.B, s = this.io.s();
    const tp = (B.turnPlans[s.turn.n] = B.turnPlans[s.turn.n] || { planned: [], did: [], failed: [] });
    if (r && r.ok === false) { B.note('refused', `${text || step.label}: the table said “${r.err}”`, { step: step.key }); tp.failed.push(`${step.label} — ${r.err}`); this.mark(step.key, 'failed:' + r.err); return false; }
    B.note('did', text || step.label, { step: step.key, why: step.why });
    tp.did.push(text || step.label);
    this.mark(step.key, 'done');
    return true;
  };
  // Everything said between the AI and the table, for the dev panel's "Talk with the table" list.
  E.wire = function (dir, text) { const B = this.B; B.wire = B.wire || []; B.wire.push({ t: Date.now(), dir, text: String(text).slice(0, 200) }); if (B.wire.length > 150) B.wire.splice(0, B.wire.length - 150); };
  E.act = async function (a) {
    let r;
    try { r = (await this.io.act(a)) || { ok: true }; } catch (e) { r = { ok: false, err: e.message }; }
    const brief = Object.entries(a).filter(([k]) => k !== 'type').map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : v}`).join(' ');
    this.wire('out', `${a.type} ${brief} → ${r.ok === false ? 'refused: ' + r.err : 'ok'}`);
    return r;
  };

  // ---------------- one action ----------------
  // Returns true when it did something (the caller waits for the table to update before the next step).
  E.step = async function () {
    const io = this.io, B = this.B, s = io.s(), me = io.me();
    if (!s || !s.players[me]) return false;
    const P = s.players[me];
    if (s.winner || P.lost) return false;
    // Opening hand.
    const ph0 = io.privPhase();
    if (ph0 === 'deciding') { B.load(this.view()); if (B.keepHand(io.hand(), io.mulls())) io.keep(); else io.mulligan(); return true; }
    if (ph0 === 'bottom') { B.load(this.view()); const hand = io.hand().map(c => Object.assign({ zone: 'hand', counters: {}, face: 0 }, c)); io.bottom(B.worstCards(hand, io.bottomN()).map(c => c.id)); return true; }
    if (!s.turn || !s.turn.active) return false;
    B.think(this.view());
    // 1) The table is asking me something.
    for (const ask of (s.ask || []).filter(a => a.pid === me)) {
      this.wire('in', `question ${ask.kind}${ask.name ? ' (' + ask.name + ')' : ''}`);
      if (ask.kind === 'manual') { B.note('manual', `couldn't finish by hand: ${ask.name} — “${(ask.text || []).join('. ')}”`); await this.act({ type: 'answer', id: ask.id }); return true; }
      // The interface sheet (aiface.js) checks every answer; a bad one becomes the safe default.
      const tries = (this.askTries[ask.id] = (this.askTries[ask.id] || 0) + 1);
      let ans; try { ans = tries > 2 ? {} : B.answerAsk(ask); } catch (e) { ans = {}; B.note('error', `answer ${ask.kind}: ${e.message}`); }
      const why = ans.why; delete ans.why;
      const face = root.KT_AI_FACE;
      const v = face ? face.vet(ask, ans) : { ans, problem: '' };
      if (v.problem) B.note('interface', `${ask.kind} answer ${JSON.stringify(ans)} rejected by the sheet (${v.problem}) — sending the safe answer ${JSON.stringify(v.ans)}`);
      B.note('answer', `${ask.kind} for ${ask.name || 'the table'}: ${JSON.stringify(v.ans)}${why ? ' (' + why + ')' : ''}`);
      const r = await this.act(Object.assign({ type: 'answer', id: ask.id }, v.ans));
      if (r.ok === false && face && face.ASKS[ask.kind]) { B.note('refused', `answer ${ask.kind}: ${r.err}`); const fb = await this.act(Object.assign({ type: 'answer', id: ask.id }, face.ASKS[ask.kind].safe(ask))); if (fb.ok === false) B.note('refused', `safe answer: ${fb.err}`); }
      return true;
    }
    // Waiting for someone else's choice.
    if ((s.ask || []).some(a => a.kind !== 'manual')) return false;
    // 2) Priority: a response from my trigger list, or pass.
    if (s.prio && s.prio.holder === me) return this.priority();
    if (s.prio) return false;
    // 3) Blockers.
    const K = s.combat, T = s.turn;
    if (K && !K.done && K.n === T.n && (K.waiting || []).includes(me) && !(K.ok || {})[me]) {
      const { blocks, why } = B.planBlocks();
      const r = await this.act({ type: 'block', list: blocks });
      if (r.ok === false) { B.note('refused', `blocks: ${r.err}`); await this.act({ type: 'block', list: [] }); }
      else B.note('did', blocks.length ? `blocked: ${why}` : `no blocks (${why})`);
      return true;
    }
    if (T.active !== me) return false;
    return this.myTurn();
  };

  E.priority = async function () {
    const io = this.io, B = this.B, s = io.s(), me = io.me(), Rr = R();
    const top = Rr.stackTop(s);
    const ctx = { endStep: s.prio.step === 'end' && !top, blocks: !!(s.prio.step && s.prio.step !== 'end' && !top), combat: !!(s.combat && s.combat.n === s.turn.n && !s.combat.done) };
    const key = 'prio:' + s.prio.since + ':' + (top ? top.id : 'step');
    if (!this.tried.has(key)) {
      this.tried.add(key);
      const res = B.respond(ctx);
      if (res) {
        const ok = await this.execOption(res.option, 'instant');
        if (ok) { res.response.fired = true; if (B.holding) B.holding.fired = true; B.note('response', `${res.response.label.split('→')[0].trim()} → ${res.option.name}: ${res.why}`); return true; }
        B.note('refused', `response ${res.option.name} could not be cast`);
      }
    }
    await this.act({ type: 'pass', top: s.prio.top });
    return true;
  };

  E.myTurn = async function () {
    const io = this.io, B = this.B, s = io.s(), me = io.me(), Rr = R(), T = s.turn;
    const ph = Rr.PHASES[T.phase];
    if (io.drawForTurn()) return true;
    if (Rr.stackTop(s) || (s.tq || []).length) return false;
    const K = s.combat;
    if (K && K.n === T.n && !K.done && Object.keys(K.att || {}).length) return false;   // combat in progress
    if (T.goal) return false;                                                            // the table is moving the turn along
    if (await this.unhandledTriggers()) return true;
    const plan = B.plan; if (!plan) return false;
    const inMain = /^Main/.test(ph);
    const main1 = ph === 'Main 1';
    for (const st of plan.steps) {
      const m = this.markOf(st.key);
      if (m) continue;
      if (st.kind === 'land') { if (!inMain) continue; const ex = io.s().cards[st.id]; const r = ex && ex.zone === 'exile' ? await this.act({ type: 'move', ids: [st.id], to: 'battlefield', playLand: true }) : await io.playLand(st.id); this.did(st, r); return true; }
      if (st.kind === 'cast') {
        if (!inMain) continue;
        if (st.main2 && main1) continue;
        const card = this.findCard(st.id);
        if (!card) { this.mark(st.key, 'gone'); continue; }
        const o = B.option(card, 'main');
        if (!o) { this.mark(st.key, 'failed:no longer castable'); B.note('skip', `${st.label}: no longer castable`); continue; }
        if (card.zone === 'graveyard') B.gyCastTurn = T.n;
        const ok = await this.execOption(o, 'main');
        this.did(st, ok ? { ok: true } : { ok: false, err: this.lastErr || 'refused' }, `cast ${o.name}${o.desc.filter(Boolean).length ? ' → ' + o.desc.filter(Boolean).join(', ') : ''} (${st.why})`);
        return true;
      }
      if (st.kind === 'equip') { if (!inMain) continue; const r = await this.equip(st); this.did(st, r); return true; }
      if (st.kind === 'pw') { if (!inMain) continue; const r = await this.walker(st.id); if (r === null) { this.mark(st.key, 'skip'); continue; } this.did(st, r, r.text); return true; }
      if (st.kind === 'sacwin') { if (!inMain) continue; const r = await this.sacForWin(); if (r === null) { this.mark(st.key, 'done'); continue; } if (r.ok === false) this.did(st, r); else B.note('did', r.text); return true; }
      if (st.kind === 'crew') { if (!main1) continue; const r = await this.crew(st.id); if (r === null) { this.mark(st.key, 'skip'); continue; } this.did(st, r, r.text); return true; }
      if (st.kind === 'attack') {
        if (main1) { const r = await this.act({ type: 'advance', goal: 'combat' }); if (r.ok === false) { this.did(st, r); } return true; }
        if (ph === 'Declare attackers' || ph === 'Beginning of combat') {
          const { list, why } = B.planAttack();
          let r = await this.act({ type: 'attack', list: list.map(x => ({ id: x.id, p: x.p })) });
          if (r.ok === false && list.length) { B.note('refused', `attack: ${r.err}`); r = await this.act({ type: 'attack', list: [] }); }
          const by = {}; for (const x of list) (by[x.p] = by[x.p] || []).push(Rr.cardName(s.cards[x.id]));
          this.did(st, r, list.length ? `attacked ${Object.entries(by).map(([p, v]) => `${Rr.nameOf(s, p)} with ${v.join(', ')}`).join('; ')}${why ? ' (' + why + ')' : ''}` : `no attack (${why || 'nothing worth it'})`);
          return true;
        }
        continue;
      }
      if (st.kind === 'abilities') { if (!inMain) continue; const r = await this.tapAbility(); if (r === null) { this.mark(st.key, 'done'); continue; } B.note(r.ok === false ? 'refused' : 'did', r.text || r.err); return true; }
      if (st.kind === 'end') {
        if (main1 && plan.steps.some(x => x.kind === 'cast' && x.main2 && !this.markOf(x.key))) { const r = await this.act({ type: 'advance', goal: 'combat' }); if (r.ok === false) this.mark('attack', 'failed'); return true; }
        // Hand size (514.1): discard before the turn ends.
        const hand = io.hand();
        // (Stop if discarding keeps drawing cards — a discard trigger that draws must not empty my library.)
        const dk = 'discards:' + s.turn.n; this.discards = this.discards || {}; this.discards[dk] = (this.discards[dk] || 0);
        if (hand.length > 7 && this.discards[dk]++ < 3) { const worst = B.worstCards(hand.map(c => Object.assign({ zone: 'hand', counters: {}, face: 0 }, c)), hand.length - 7); await io.discard(worst.map(c => c.id), 'hand size'); B.note('did', `discarded ${worst.map(c => c.d.n).join(', ')} (hand size)`); return true; }
        const unused = B.manaNow();
        if (plan.hold) { const hc = io.hand().find(c => c.id === plan.hold.id); B.holding = { id: plan.hold.id, name: plan.hold.name, turn: T.n, counter: !!(hc && roles(Object.assign({ zone: 'hand', counters: {}, face: 0 }, hc)).has('counter')), fired: false }; }
        const tpx = (B.turnPlans[T.n] = B.turnPlans[T.n] || { planned: [], did: [], failed: [] }); tpx.unused = unused; tpx.held = plan.hold ? plan.hold.name : null;
        const r = await this.act({ type: 'advance', goal: 'end' });
        const kept = unused >= 2 ? this.io.hand().map(c => Object.assign({ zone: 'hand', counters: {}, face: 0, owner: me, ctrl: me }, c)).map(c => { const w = B.whyNot(c); return w ? `${c.d.n}: ${w}` : null; }).filter(Boolean) : [];
        this.did(st, r, `end turn${plan.hold ? ' (holding ' + plan.hold.name + ')' : ''}${unused ? `, ${unused} mana unused` : ''}${kept.length ? ' — in hand: ' + kept.join('; ') : ''}`);
        return true;
      }
    }
    // Nothing planned fits this step: move on.
    if (main1) { await this.act({ type: 'advance', goal: 'combat' }); return true; }
    if (/^Main 2/.test(ph)) { await this.act({ type: 'advance', goal: 'end' }); return true; }
    return false;
  };
  E.findCard = function (id) {
    const h = this.io.hand().find(c => c.id === id);
    if (h) return Object.assign({ zone: 'hand', counters: {}, face: 0, owner: this.io.me(), ctrl: this.io.me() }, h);
    const c = this.io.s().cards[id];
    return c && (c.zone === 'command' || c.zone === 'graveyard' || (c.zone === 'exile' && c.mayPlay)) ? c : null;
  };
  // Cast an option (or activate an ability response).
  E.execOption = async function (o, when) {
    const io = this.io;
    this.lastErr = null;
    if (o.ability) {
      if (o.pay && o.pay.length) await io.tapPay(o.pay);
      const r = await this.act({ type: 'activate', id: o.id, i: o.i, tg: o.tg, sac: o.sac });
      if (r.ok === false) this.lastErr = r.err;
      return r.ok !== false;
    }
    if (o.pay && o.pay.length) { const r = await io.tapPay([...new Set(o.pay)]); if (r && r.ok === false) { this.lastErr = r.err; return false; } }
    const opts = { tg: o.tg, mode: o.mode, x: o.x, wardPaid: o.wardPaid, fromPool: [], alt: o.alt || undefined, sacCost: o.sacCost || undefined };
    let r;
    if (o.card.zone === 'hand') r = await io.castFromHand(o.card.id, opts);
    else r = await io.castPublic(o.card.id, opts);
    if (!r || r.ok === false) { this.lastErr = (r && r.err) || 'refused'; return false; }
    return true;
  };
  E.equip = async function (st) {
    const s = this.io.s(), eq = s.cards[st.id];
    if (!eq) return { ok: false, err: 'gone' };
    const abs = C().abilities(eq), i = abs.findIndex(x => x.equip);
    if (i < 0) return { ok: false, err: 'no equip ability' };
    const pay = C().pay(abs[i].mana, this.B.sources(), 0);
    if (!pay) return { ok: false, err: 'not enough mana to equip' };
    if (pay.length) await this.io.tapPay(pay);
    return this.act({ type: 'activate', id: eq.id, i, tg: [[{ c: st.to }]] });
  };
  E.walker = async function (id) {
    const B = this.B, s = this.io.s(), pw = s.cards[id], T = s.turn;
    if (!pw || (T.loyal || {})[pw.id] === T.n) return null;
    const abs = C().abilities(pw), loyal = (pw.counters || {}).loyalty || 0;
    const order = abs.map((a, i) => ({ a, i })).filter(x => x.a.loyalty !== undefined && C().effectsIn(x.a.text).understood && C().effectsIn(x.a.text).effects.length && (x.a.loyalty >= 0 || (loyal + x.a.loyalty > 0 && C().effectsIn(x.a.text).effects.some(e => ['destroy', 'exile', 'dmg'].includes(e.k)))))
      .sort((x, y) => (y.a.loyalty < 0) - (x.a.loyalty < 0) || y.a.loyalty - x.a.loyalty);
    for (const o of order) {
      const eff = C().effectsIn(o.a.text), reqs = C().targetsIn(o.a.text);
      let tg = [];
      if (reqs.length) { const t = B.chooseTargets({ d: { faces: [{ n: R().cardName(pw), t: 'Instant', o: o.a.text }] }, counters: {} }, null, eff, { reqs, noWard: true }); if (!t) continue; tg = t.tg; }
      const r = await this.act({ type: 'activate', id: pw.id, i: o.i, tg });
      return Object.assign(r, { text: `${R().cardName(pw)} ${abs[o.i].cost}: ${abs[o.i].text}` });
    }
    return null;
  };
  E.crew = async function (id) {
    const B = this.B, s = this.io.s(), v = s.cards[id];
    if (!v || R().isType(v, 'creature')) return null;
    const abs = C().abilities(v), i = abs.findIndex(a => a.crew);
    if (i < 0) return null;
    const need = abs[i].crew;
    const pool = B.creatures(this.io.me()).filter(c => !c.tapped && c.id !== id).sort((a, b) => (R().sick(s, b) - R().sick(s, a)) || B.value(a) - B.value(b));
    const pick = []; let pw = 0;
    for (const c of pool) { if (pw >= need) break; pick.push(c.id); pw += Math.max(0, B.pt(c)[0]); }
    if (pw < need) return null;
    // Only crew if the Vehicle is a better attacker than the crew.
    const vPow = (C().pt(s, Object.assign({}, v, { animated: 'artifact creature' })) || [0])[0] || +((v.d.faces[0] || {}).p || 0);
    if (vPow <= pw && pick.every(id2 => !R().sick(s, s.cards[id2]))) return null;
    const r = await this.act({ type: 'activate', id, i, crew: pick });
    return Object.assign(r, { text: `crewed ${R().cardName(v)} with ${pick.map(x => R().cardName(s.cards[x])).join(', ')}` });
  };
  E.sacForWin = async function () {
    const B = this.B, s = this.io.s();
    const outlet = B.bf(this.io.me()).find(c => roles(c).has('sacOutlet'));
    if (!outlet) return null;
    const abs = C().abilities(outlet), i = abs.findIndex(a => a.sacOther);
    if (i < 0) return null;
    // Never the drain creatures or the commander while anything else is left.
    const all = B.creatures(this.io.me()).filter(c => c.id !== outlet.id && C().matchesWhat(c, abs[i].sacOther));
    const spare = all.filter(c => !roles(c).has('deathDrain') && !c.cmdr && !B.isProtect(c));
    const fodder = B.worstPermanents(spare.length ? spare : [], 1)[0];
    if (!fodder) return null;
    const pay = C().pay(abs[i].mana, B.sources(), 0); if (!pay) return null;
    if (pay.length) await this.io.tapPay(pay);
    const r = await this.act({ type: 'activate', id: outlet.id, i, sac: fodder.id });
    return Object.assign(r, { text: `sacrificed ${R().cardName(fodder)} to ${R().cardName(outlet)} (drain for the win)` });
  };
  // {T} abilities that deal damage, draw, gain life or tap: once each per turn. Fetch lands get cracked too.
  E.tapAbility = async function () {
    const B = this.B, s = this.io.s(), key = s.gameId + ':' + s.turn.n;
    for (const c of B.bf(this.io.me())) {
      if (c.tapped || !R().isType(c, 'land') || this.tried.has(key + ':fetch:' + c.id)) continue;
      const abs = C().abilities(c), i = abs.findIndex(a => a.sac && /search your library for/i.test(a.text));
      if (i < 0) continue;
      this.tried.add(key + ':fetch:' + c.id);
      if (abs[i].life && B.life(this.io.me()) <= abs[i].life + 5) continue;
      const pay = C().pay(abs[i].mana, B.sources().filter(x => x.id !== c.id), 0); if (!pay) continue;
      if (pay.length) await this.io.tapPay(pay);
      const r = await this.act({ type: 'activate', id: c.id, i, tg: [] });
      return Object.assign(r, { text: `cracked ${R().cardName(c)}: ${abs[i].text}` });
    }
    for (const c of B.bf(this.io.me())) {
      if (c.tapped || this.tried.has(key + ':ab:' + c.id)) continue;
      if (B.isCre(c) && R().sick(s, c) && !B.kw(c).has('haste')) continue;
      const abs = C().abilities(c);
      for (let i = 0; i < abs.length; i++) {
        const ab = abs[i];
        if (!ab.tap || ab.sac || ab.sacOther || ab.discard || ab.manaAb || ab.crew || ab.equip || ab.loyalty !== undefined) continue;
        const pay = C().pay(ab.mana, B.sources().filter(x => x.id !== c.id), 0); if (!pay) continue;
        const eff = C().effectsIn(ab.text);
        if (!eff.understood || !eff.effects.some(e => ['dmg', 'draw', 'life', 'counters', 'tap', 'token', 'scry'].includes(e.k))) continue;
        const reqs = C().targetsIn(ab.text);
        let tg = [];
        if (reqs.length) { const t = B.chooseTargets({ d: { faces: [{ n: R().cardName(c), t: 'Instant', o: ab.text }] }, counters: {} }, null, eff, { reqs, noWard: true }); if (!t) continue; tg = t.tg; }
        this.tried.add(key + ':ab:' + c.id);
        if (pay.length) await this.io.tapPay(pay);
        const r = await this.act({ type: 'activate', id: c.id, i, tg });
        return Object.assign(r, { text: `used ${R().cardName(c)}: ${ab.text}` });
      }
    }
    return null;
  };
  // Triggered abilities the table doesn't put on the stack by itself (cards.js triggers the v6 engine doesn't handle).
  E.unhandledTriggers = async function () {
    const s = this.io.s(), me = this.io.me(), Eng = root.Engine;
    if (!Eng || !Eng.handles) return false;
    const ph = R().PHASES[s.turn.phase];
    const ev = ph === 'Upkeep' ? 'upkeep' : ph === 'End step' ? 'end' : null;
    if (!ev) return false;
    const key = s.gameId + ':' + s.turn.n + ':' + ev;
    for (const c of this.B.bf(me)) {
      const trs = C().triggers(c);
      for (let i = 0; i < trs.length; i++) {
        const tr = trs[i]; if (tr.ev !== ev || Eng.handles(c, tr.text)) continue;
        const tk = key + ':' + c.id + ':' + i; if (this.tried.has(tk)) continue; this.tried.add(tk);
        const eff = C().effectsIn(tr.text); if (!eff.understood || !eff.effects.length) continue;
        const reqs = C().targetsIn(tr.text);
        let tg = [];
        if (reqs.length) { const t = this.B.chooseTargets({ d: { faces: [{ n: R().cardName(c), t: 'Instant', o: tr.text }] }, counters: {} }, null, eff, { reqs, noWard: true }); if (!t) continue; tg = t.tg; }
        const r = await this.act({ type: 'trigger', id: c.id, i, tg });
        if (r.ok !== false) { this.B.note('did', `put ${R().cardName(c)}’s trigger on the stack: ${tr.text}`); return true; }
      }
    }
    return false;
  };

  // ---------------- effects that need my hand or library ----------------
  E.onTodo = async function (t) {
    const io = this.io, B = this.B, s = io.s(), me = io.me();
    B.load(this.view());
    this.wire('in', `job ${t.k}${t.n ? ' ×' + t.n : ''} (${t.src || ''})`);
    if (root.KT_AI_FACE && !root.KT_AI_FACE.TODOS[t.k]) B.note('interface', `the table gave me a job “${t.k}” that isn't on the interface sheet — skipped`);
    const hand = () => io.hand().map(c => Object.assign({ zone: 'hand', counters: {}, face: 0, owner: me, ctrl: me }, c));
    try {
      if (t.k === 'draw') { await io.draw(t.n || 1, `drew ${t.n || 1} (${t.src})`); return; }
      if (t.k === 'mill') { await io.mill(t.n || 1); return; }
      if (t.k === 'discard') { const n = Math.min(t.n || 1, io.hand().length); const pick = t.random ? hand().sort(() => B.rng() - 0.5).slice(0, n) : B.worstCards(hand(), n); if (pick.length) await io.discard(pick.map(c => c.id), t.src); B.note('did', `discarded ${pick.map(c => c.d.n).join(', ')} (${t.src})`); return; }
      if (t.k === 'sacrifice' || t.k === 'sacUnless') {
        const list = B.bf(me).filter(c => C().matchesWhat(c, t.what || 'creature') && !c.cmdr || C().matchesWhat(c, t.what || 'creature') && B.bf(me).filter(x => C().matchesWhat(x, t.what || 'creature')).length <= (t.n || 1));
        const pick = B.worstPermanents(list, t.n || 1);
        if (pick.length) { await io.move(pick.map(c => c.id), 'graveyard', { sac: true, quietSac: t.src }); B.note('did', `sacrificed ${pick.map(c => R().cardName(c)).join(', ')} (${t.src}) — least useful to my plan`); }
        else if (t.k === 'sacUnless' && t.srcId && s.cards[t.srcId]) await io.move([t.srcId], 'graveyard', { sac: true });
        return;
      }
      if (t.k === 'returnOwn') {
        const list = B.bf(me).filter(c => C().matchesWhat(c, t.what)).sort((a, b) => (b.tapped - a.tapped) || ((/basic/i.test(R().typeLine(b)) ? 1 : 0) - (/basic/i.test(R().typeLine(a)) ? 1 : 0)) || B.value(a) - B.value(b));
        const ids = list.slice(0, t.n || 1).map(c => c.id);
        if (ids.length) await io.move(ids, 'hand');
        return;
      }
      if (t.k === 'scry' || t.k === 'surveil') {
        const top = io.libTop(t.n || 1);
        const lands = B.bf(me).filter(c => R().isType(c, 'land')).length;
        const keep = c => { const cc = Object.assign({ zone: 'library', counters: {}, face: 0 }, c); if (/\bland\b/i.test(R().typeLine(cc))) return lands < 6; return B.isKey(cc) || (+c.d.cmc || 0) <= lands + 2; };
        const decisions = top.map(c => ({ id: c.id, dest: keep(c) ? 'top' : t.k === 'scry' ? 'bottom' : 'graveyard' }));
        await io.applyLook(t.k, top.length, decisions);
        B.note('did', `${t.k} ${top.length}: kept ${decisions.filter(d => d.dest === 'top').length} on top`);
        return;
      }
      if (t.k === 'freeCast') {
        const want = String(t.filter || 'card');
        const pool = (t.from === 'graveyard' ? B.cards(c => c.zone === 'graveyard' && c.owner === me) : hand()).filter(c => !R().isType(c, 'land') && (t.mvMax == null || (+c.d.cmc || 0) <= t.mvMax) && (want === 'card' || C().matchesWhat(Object.assign({ zone: 'stack' }, c), want)));
        const opts = pool.map(c => B.option(c, C().instantSpeed(c) ? 'instant' : 'main', { sources: [] }) || B.option(c, 'main', { sources: [] })).filter(Boolean).sort((a, b) => b.score - a.score);
        const o = opts[0];
        if (!o) { B.note('did', `${t.src}: nothing worth casting for free`); return; }
        const r = o.card.zone === 'hand' ? await io.castFromHand(o.id, { tg: o.tg, mode: o.mode, alt: 'free', fromPool: [] }) : await io.castPublic(o.id, { tg: o.tg, mode: o.mode, alt: 'free', fromPool: [] });
        B.note('did', `${t.src}: cast ${o.name} for free${r && r.ok === false ? ' (refused: ' + r.err + ')' : ''}`);
        return;
      }
      if (t.k === 'impulse') { const ids = await io.impulse(t); B.note('did', `exiled ${ids.length} from the top to play (${t.src})`); return; }
      if (t.k === 'handToTop') {
        const ids = B.worstCards(hand(), t.n || 1).map(c => c.id);
        await io.handToTop(ids);
        B.note('did', `put ${ids.length} card${ids.length > 1 ? 's' : ''} from my hand on top of my library (${t.src})`);
        return;
      }
      if (t.k === 'look') {
        const top = io.libTop(t.n || 1);
        const text = String(t.text || '').toLowerCase();
        // "Put them back in any order": all stay on top, best first.
        if (/put them back in any order|put them back on top/.test(text)) {
          const wantT = c => { const cc = Object.assign({ zone: 'library', counters: {}, face: 0 }, c); return (B.isKey(cc) ? 10 : 0) + ((+c.d.cmc || 0) <= B.manaNow() + 1 ? 2 : 0) + (/\bland\b/i.test(R().typeLine(cc)) && B.bf(me).filter(x => R().isType(x, 'land')).length < 5 ? 3 : 0); };
          const order = top.slice().sort((a, b) => wantT(b) - wantT(a));
          await io.applyLook('look', top.length, order.map(c => ({ id: c.id, dest: 'top' })));
          B.note('did', `looked at ${top.length} and put them back: ${order.map(c => c.d.n).join(', ')}`);
          return;
        }
        const anyN = /any number of [a-z ]*cards? from among them/.test(text);
        const pickN = anyN ? 99 : /put (?:two|2) of them into your hand/.test(text) ? 2 : /into your hand|onto the battlefield/.test(text) ? 1 : 0;
        const want = c => { const cc = Object.assign({ zone: 'library', counters: {}, face: 0 }, c); return (B.isKey(cc) ? 10 : 0) + (roles(cc).has('ramp') ? 3 : 0) + (roles(cc).has('removal') ? 2 : 0) + ((+c.d.cmc || 0) <= B.manaNow() + 1 ? 2 : 0); };
        const filt = (text.match(/(?:reveal|put) (?:a|an|up to \w+|any number of) ([a-z ]+?) cards? from among/) || [])[1];
        const okC = c => !filt || C().matchesWhat(Object.assign({ zone: 'library', counters: {}, face: 0 }, c), filt);
        const best = top.filter(okC).sort((a, b) => want(b) - want(a)).slice(0, pickN);
        const rest = /graveyard/.test(text) && !/bottom/.test(text) ? 'graveyard' : 'bottom';
        const toBf = /from among them onto the battlefield/.test(text);
        const decisions = top.map(c => ({ id: c.id, dest: best.includes(c) ? (toBf ? 'battlefield' : 'hand') : rest }));
        await io.applyLook('look', top.length, decisions);
        B.note('did', `looked at ${top.length} (${t.src}): took ${best.map(c => c.d.n).join(', ') || 'nothing'}`);
        return;
      }
      if (t.k === 'fetch' || t.k === 'search') {
        const lib = io.lib();
        const want = String(t.filter || (t.k === 'fetch' ? 'basic land' : 'card')).replace(/ cards?$/, '').replace(/ with .*$/, '').trim();
        const fits = c => { const cc = Object.assign({ zone: 'library', counters: {}, face: 0, owner: me }, c); return (t.mvMax == null || (+c.d.cmc || 0) <= t.mvMax) && (want === 'card' || C().matchesWhat(cc, want) || (t.k === 'fetch' && /\bbasic\b/i.test(R().typeLine(cc)) && /\bland\b/i.test(R().typeLine(cc)))); };
        const pool = lib.filter(fits);
        // The plan decides: a missing combo piece, a key card, or the land color I need.
        const need = new Set(); for (const c of hand()) { const cost = C().costOf(c); for (const col of 'WUBRG') if (cost[col]) need.add(col); }
        const have = new Set(B.sources().flatMap(x => x.colors.split('')));
        const missing = B.comboMissing();
        const score = c => { const cc = Object.assign({ zone: 'library', counters: {}, face: 0 }, c); let v = 0; if (missing && missing.cards.includes(c.d.n)) v += 20; if (B.isKey(cc)) v += 8; if (B.isFinisher(cc) && B.finishReady()) v += 6; const m = C().manaSource(Object.assign({ zone: 'battlefield' }, cc)); if (m) for (const col of m.colors) if (need.has(col) && !have.has(col)) v += 3; v += (+c.d.cmc || 0) * 0.2; return v; };
        const ids = pool.sort((a, b) => score(b) - score(a)).slice(0, t.n || 1).map(c => c.id);
        // "Into your hand or graveyard": big creatures go to the graveyard for a reanimation deck.
        if (t.dest === 'handOrGy') { const c0 = lib.find(c => c.id === ids[0]); const gy = c0 && B.profile.arch.some(a => /reanimat|graveyard/.test(a)) && (+c0.d.cmc || 0) >= 5 && /creature/i.test(((c0.d.faces || [])[0] || {}).t || ''); t = Object.assign({}, t, { dest: gy ? 'graveyard' : 'hand' }); }
        await io.searchTake(ids, t);
        B.note('did', `searched (${t.src}): took ${ids.map(id => (lib.find(c => c.id === id) || { d: { n: '?' } }).d.n).join(', ') || 'nothing'}`);
        return;
      }
      if (t.k === 'cascade') {
        const hit = await io.cascadeReveal(t.mv || 0, !!t.top);
        if (!hit) return;
        const card = Object.assign({ zone: 'hand', counters: {}, face: 0, owner: me, ctrl: me }, hit);
        const o = B.option(card, 'instant', { sources: [] }) || B.option(card, 'main', { sources: [] });
        // Free: the cost check doesn't apply; cast it unless it would hurt me.
        const tgt = o ? o.tg : B.chooseTargets(card, null, C().effectsOf(card, null), {});
        const word = t.discover ? 'discover' : 'cascade';
        // Discover: a card with no good target right now goes into my hand instead (701.57a).
        if (tgt === null && C().targetReqs(card, null).some(r => !r.upTo)) { if (!t.discover) await io.cascadeDecline(hit.id); B.note('did', `${word}: ${t.discover ? 'put ' + hit.d.n + ' into my hand' : 'declined ' + hit.d.n} (no good target)`); return; }
        if (t.discover && R().isType(card, 'land')) return;
        const r = await io.castFromHand(hit.id, { tg: o ? o.tg : (tgt || { tg: [] }).tg, mode: o ? o.mode : undefined, alt: 'free', fromPool: [] });
        if ((!r || r.ok === false) && !t.discover) await io.cascadeDecline(hit.id);
        B.note('did', `${word}: cast ${hit.d.n} for free`);
        return;
      }
      if (t.k === 'dig') {
        const f = await io.digFind(t);
        // "Onto the battlefield or into your hand": permanents I can use go down; the rest to hand.
        let dest = t.dest !== 'either' ? t.dest : 'battlefield';
        // One-card reveal that missed (Lurking Predators): bottom a land I don't need or an expensive card.
        if (t.top && !f.hits.length) {
          const top = (io.libTop(1) || [])[0];
          const lands = B.bf(me).filter(c => R().isType(c, 'land')).length;
          const bottom = t.mayBottom && top && (/\bland\b/i.test(((top.d.faces || [])[0] || {}).t || '') ? lands >= 6 : (+top.d.cmc || 0) > lands + 2 && !B.isKey(Object.assign({ zone: 'library', counters: {}, face: 0 }, top)));
          dest = bottom ? 'bottom' : 'top';
        }
        await io.digFinish(t, f.hits, f.rest, dest);
        B.note('did', `${t.src}: revealed until ${f.names.join(', ') || 'nothing'}${f.hits.length ? ' → ' + (dest === 'hand' ? 'hand' : 'battlefield') : ''}`);
        return;
      }
      if (t.k === 'fromHand') {
        const want = String(t.filter || 'card').replace(/ cards?$/, '').trim();
        const pool = hand().filter(c => (want === 'card' || C().matchesWhat(c, want)) && (t.mvMax == null || (+c.d.cmc || 0) <= t.mvMax)).sort((a, b) => B.value(b) + (B.isKey(b) ? 5 : 0) - B.value(a) - (B.isKey(a) ? 5 : 0));
        const pick = pool.slice(0, t.n || 1);
        if (pick.length) { await io.fromHand(pick.map(c => c.id), 'battlefield', { tapped: t.tapped, via: t.via }); B.note('did', `put ${pick.map(c => c.d.n).join(', ')} onto the battlefield (${t.src})`); }
        return;
      }
      if (t.k === 'fromGy') {
        const want = String(t.filter || 'card').replace(/ cards?$/, '').trim();
        const pool = B.cards(c => c.zone === 'graveyard' && c.owner === me && (want === 'card' || C().matchesWhat(c, want))).sort((a, b) => B.value(b) - B.value(a));
        const pick = pool.slice(0, t.n || 1);
        if (pick.length) { await io.move(pick.map(c => c.id), t.dest || 'hand', t.dest === 'battlefield' && t.tapped ? { tapped: true } : null); B.note('did', `returned ${pick.map(c => R().cardName(c)).join(', ')} (${t.src})`); }
        return;
      }
    } catch (e) { B.note('error', `todo ${t.k}: ${e.message}`); }
  };

  root.AIExec = Exec;
})(typeof window !== 'undefined' ? window : globalThis);
