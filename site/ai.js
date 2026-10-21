// Kitchen Table — the AI player.
// It runs as a hidden copy of the site (?m=ai&ai=<id>) inside the page of the player who added it, so it sits at
// the table exactly like a person: its own hidden hand and library, and every move goes through the table host's
// rules checks. It plays whole turns by itself, answers when it has priority, blocks, explains what it does in the
// AI chat, and answers questions like "is that legal?".
(function () {
  'use strict';
  const G = window.KT;
  if (!G || G.MODE !== 'ai') return;
  const R = Rules, C = Cards;
  const PH = R.PHASES;
  const PI = n => PH.indexOf(n);

  let cfg = null;
  const SKILL = { easy: { pace: 1600, think: 0.35 }, normal: { pace: 1150, think: 0.75 }, hard: { pace: 900, think: 1 } };
  const skill = () => (G.me() && G.me().ai && G.me().ai.skill) || (cfg && cfg.skill) || 'normal';
  const pace = () => SKILL[skill()].pace;
  const roll = p => Math.random() < p;
  const ME = () => G.KEY;
  const S = () => G.S;
  const nameOf = pid => R.nameOf(S(), pid);
  const cn = c => R.cardName(c);
  const tell = msg => { try { parent.postMessage(Object.assign({ kt: 'ai', id: G.AI_ID }, msg), location.origin); } catch (e) {} };

  // ---------------- talking ----------------
  const noDot = t => String(t).replace(/[.\s]+$/, '');
  let lastWhy = null;
  function say(text, why) {
    lastWhy = { text, why: why || [], t: Date.now() };
    return G.act({ type: 'aiSay', text, why });
  }

  // ---------------- what I can see ----------------
  const hand = () => G.P.hand.map(c => Object.assign({ zone: 'hand', counters: {}, face: 0 }, c));
  const mine = (zone) => Object.values(S().cards).filter(c => c.zone === zone && (zone === 'battlefield' ? c.ctrl === ME() : c.owner === ME()));
  const opps = () => S().seats.filter(p => p !== ME() && S().players[p] && R.alive(S(), p));
  const creaturesOf = pid => Object.values(S().cards).filter(c => c.zone === 'battlefield' && c.ctrl === pid && (c.faceDown || R.isType(c, 'creature')));
  const isCreature = c => c.faceDown || R.isType(c, 'creature');
  const ptOf = c => C.pt(S(), c) || [0, 0];
  const kw = c => C.keywords(c, S());
  function value(c) {
    if (!c) return 0;
    let v = (c.d && +c.d.cmc) || 0;
    if (isCreature(c)) { const [p, t] = ptOf(c); v += p * 1.2 + t * 0.6; const k = kw(c); for (const x of ['flying', 'deathtouch', 'lifelink', 'double strike', 'first strike', 'trample', 'hexproof', 'indestructible', 'menace']) if (k.has(x)) v += 1.2; }
    if (R.isType(c, 'planeswalker')) v += 4 + ((c.counters || {}).loyalty || 0);
    if (c.cmdr) v += 4;
    if (R.isType(c, 'land')) v -= 1;
    return v;
  }

  // Mana I can make right now: untapped permanents with a mana ability (creatures only if they can tap).
  function sources() {
    const out = [];
    for (const c of mine('battlefield')) {
      if (c.tapped) continue;
      const m = C.manaSource(c);
      if (!m || m.sac) continue;
      if (isCreature(c) && R.sick(S(), c) && !kw(c).has('haste')) continue;
      out.push({ id: c.id, amount: m.amount, colors: m.colors, units: m.units, name: cn(c) });
    }
    return out;
  }
  const manaAvailable = () => sources().reduce((a, s) => a + s.amount, 0);
  function costFor(c) {
    const cost = C.costOf(c);
    if (c.zone === 'command' && c.cmdr) cost.g += 2 * ((S().tax || {})[c.id] || 0);
    return cost;
  }

  // ---------------- choosing targets ----------------
  const HARM = ['dmg', 'destroy', 'exile', 'bounce', 'tap', 'counter', 'discard', 'sacrifice', 'mill'];
  const HELP = ['pump', 'grant', 'counters', 'untap', 'gyToHand', 'reanimate'];
  function intentFor(card, eff, i) {
    const es = eff.effects.filter(e => e.ti === i || e.ti2 === i || e.forTargetCtrl === i || (e.tis && e.tis.includes(i)));
    if (es.some(e => e.k === 'bite' || e.k === 'fight')) return es.some(e => e.ti === i) ? 'mine-fighter' : 'theirs';
    if (es.some(e => e.k === 'life' && e.sign < 0) || es.some(e => HARM.includes(e.k))) return 'theirs';
    // "Target creature gets -4/-4": that's removal, not a pump.
    if (es.some(e => e.k === 'pump' && (/^-/.test(String(e.t)) || (/^-/.test(String(e.p)) && !/^\+/.test(String(e.t)))))) return 'theirs';
    if (es.some(e => e.k === 'draw' || (e.k === 'life' && e.sign > 0))) return 'me';
    if (es.some(e => HELP.includes(e.k) || e.k === 'attachSrc')) return 'mine';
    const t = C.text(card).toLowerCase();
    if (/enchanted creature (gets [+]|has )/.test(t)) return 'mine';
    if (/enchanted creature (gets -|can't|doesn't untap|loses)/.test(t)) return 'theirs';
    return 'theirs';
  }
  function threat(t) {
    if (t.p) return 10 - S().players[t.p].life / 8;
    const c = S().cards[t.c];
    return value(c) + (c && c.ctrl ? 0 : 0);
  }
  // Pick targets for every requirement; null if the spell isn't worth casting (or can't be).
  function chooseTargets(card, mode, eff, extra) {
    const reqs = C.targetReqs(card, mode);
    if (!reqs.length) return { tg: [], reqs, desc: [] };
    const s = S();
    const tg = [], desc = [];
    const taken = new Set();
    for (let i = 0; i < reqs.length; i++) {
      const req = reqs[i];
      let choices = C.targetChoices(s, req, ME()).filter(t => !taken.has(t.c || t.p));
      const intent = intentFor(card, eff, i);
      const e = eff.effects.find(x => x.ti === i);
      const dmg = e && e.k === 'dmg' ? (e.n === 'X' ? (extra && extra.x) || 0 : e.n) : 0;
      let pick = null;
      if (intent === 'theirs') {
        choices = choices.filter(t => t.p ? t.p !== ME() : (s.cards[t.c].ctrl !== ME() && s.cards[t.c].owner !== ME()) || (s.cards[t.c].zone === 'graveyard' && s.cards[t.c].owner !== ME()));
        if (e && e.k === 'counter') choices = choices.filter(t => s.cards[t.c] && s.cards[t.c].ctrl !== ME());
        if (dmg) {
          // Burn: kill the best creature it can kill, otherwise hit the opponent closest to losing.
          const killable = choices.filter(t => t.c && isCreature(s.cards[t.c]) && ptOf(s.cards[t.c])[1] - (s.cards[t.c].dmg || 0) <= dmg && !kw(s.cards[t.c]).has('indestructible'));
          const pws = choices.filter(t => t.c && R.isType(s.cards[t.c], 'planeswalker') && ((s.cards[t.c].counters || {}).loyalty || 0) <= dmg);
          const players = choices.filter(t => t.p);
          const bestKill = killable.concat(pws).sort((a, b) => threat(b) - threat(a))[0];
          if (bestKill && (threat(bestKill) >= 3 || !players.length)) pick = bestKill;
          else if (players.length) pick = players.sort((a, b) => s.players[a.p].life - s.players[b.p].life)[0];
          else pick = bestKill || null;
        } else {
          pick = choices.sort((a, b) => threat(b) - threat(a))[0] || null;
          if (pick && pick.c && skill() !== 'easy' && threat(pick) < 2.5 && e && ['destroy', 'exile'].includes(e.k)) pick = null;   // don't waste removal on a 1/1
        }
      } else if (intent === 'me') {
        pick = choices.find(t => t.p === ME()) || null;
      } else {
        choices = choices.filter(t => t.p ? t.p === ME() : (s.cards[t.c].ctrl === ME() || (s.cards[t.c].zone === 'graveyard' && s.cards[t.c].owner === ME())));
        if (intent === 'mine-fighter') choices = choices.filter(t => t.c && isCreature(s.cards[t.c]));
        pick = choices.sort((a, b) => (intent === 'mine-fighter' ? ptOf(s.cards[b.c])[0] - ptOf(s.cards[a.c])[0] : threat(b) - threat(a)))[0] || null;
        if (pick && extra && extra.protect && !extra.protect.includes(pick.c)) { const pr = choices.find(t => extra.protect.includes(t.c)); if (pr) pick = pr; }
      }
      if (!pick) { if (req.upTo) { tg.push([]); continue; } return null; }
      taken.add(pick.c || pick.p);
      tg.push([pick]);
      desc.push(pick.p ? (pick.p === ME() ? 'myself' : nameOf(pick.p)) : (s.cards[pick.c].ctrl !== ME() ? nameOf(s.cards[pick.c].ctrl) + '’s ' : 'my ') + cn(s.cards[pick.c]));
    }
    // Fight / bite: only worth it if my creature can kill theirs.
    const bite = eff.effects.find(e => e.k === 'bite' || e.k === 'fight');
    if (bite && tg[bite.ti] && tg[bite.ti2] && tg[bite.ti][0] && tg[bite.ti2][0] && tg[bite.ti2][0].c) {
      const a = s.cards[tg[bite.ti][0].c], b = s.cards[tg[bite.ti2][0].c];
      if (ptOf(a)[0] < ptOf(b)[1] - (b.dmg || 0) && !kw(a).has('deathtouch')) return null;
    }
    return { tg, reqs, desc };
  }

  // ---------------- what I could cast ----------------
  function modeFor(card) {
    const md = C.modesOf(card);
    if (!md) return null;
    const scored = md.modes.map((m, i) => ({ i, eff: C.effectsIn(m) })).filter(x => x.eff.understood && x.eff.effects.length);
    if (!scored.length) return undefined;
    const pick = md.pick === 'many' ? 1 : md.pick || 1;
    const ok = [];
    for (const x of scored) {
      if (ok.length >= pick) break;
      const t = chooseTargets(card, [x.i], x.eff);
      if (t) ok.push(x.i);
    }
    return ok.length === pick ? ok : undefined;
  }
  function plan(card, when) {
    // when: 'main' (my main phase, empty stack) | 'instant' (responding / any time)
    const s = S();
    const land = R.isType(card, 'land');
    if (land) return null;
    if (when === 'instant' && !C.instantSpeed(card)) return null;
    const mode = modeFor(card);
    if (mode === undefined) return null;
    const eff = C.effectsOf(card, mode);
    const perm = C.isPermanentCard(card);
    if (!perm && (!eff.understood || !eff.effects.length)) return null;   // I only cast spells I fully understand
    if (!perm && eff.effects.some(e => e.k === 'destroyAll' || e.k === 'exileAll')) {
      const theirs = opps().reduce((a, p) => a + creaturesOf(p).reduce((x, c) => x + value(c), 0), 0);
      const ours = creaturesOf(ME()).reduce((x, c) => x + value(c), 0);
      if (theirs < ours + 6) return null;                                  // only wipe the board when I'm behind
    }
    if (!perm && eff.effects.some(e => e.k === 'counter') && when !== 'instant') return null;
    // Pump / protection tricks are for combat or for answering removal, not for casting into an empty board.
    if (!perm && when === 'main' && eff.effects.every(e => ['pump', 'grant', 'pumpAll', 'grantAll', 'untap'].includes(e.k) && !(e.k === 'pump' && intentFor(card, eff, e.ti) === 'theirs'))) return null;
    // Auras that enchant a card in a graveyard (Animate Dead) need hands-on play; I leave those alone.
    if (perm && /aura/i.test(R.typeLine(card)) && C.targetReqs(card, mode).some(r => r.gy || /graveyard/.test(r.text || ''))) return null;
    const cost = costFor(card);
    let x = 0;
    if (cost.x) { x = Math.max(0, manaAvailable() - C.costTotal(cost, 0)); if (x < 1) return null; }
    const pay = C.pay(cost, sources(), x);
    if (!pay) return null;
    const t = chooseTargets(card, mode, eff, { x });
    if (!t) return null;
    if (!perm && skill() !== 'easy' && eff.effects.every(e => e.k === 'dmg') && t.tg.length && t.tg.every(l => !l[0] || l[0].p)) {
      const dmg = eff.effects.reduce((a, e) => a + (e.n === 'X' ? x : +e.n || 0), 0);
      const low = t.tg.some(l => l[0] && l[0].p && s.players[l[0].p].life <= Math.max(dmg, 6));
      if (!low && G.P.hand.length < 7) return null;
    }
    // Value of casting it now.
    let score = (card.d && +card.d.cmc) || 0;
    if (perm && isCreature(card)) score += 1.5;
    if (eff.effects.some(e => e.k === 'fetch')) score += S().turn.n < 8 ? 4 : 1;
    if (eff.effects.some(e => ['destroy', 'exile', 'dmg', 'bounce'].includes(e.k)) && t.tg.some(l => l[0] && l[0].c)) score += 2 + Math.max(0, ...t.tg.flat().map(threat));
    if (card.cmdr) score += 3;
    if (eff.effects.some(e => e.k === 'draw')) score += 1;
    return { card, mode, eff, x, pay, tg: t.tg, reqs: t.reqs, desc: t.desc, score, cost };
  }

  function whyCast(p, when) {
    const s = S();
    const why = [];
    const tl = R.typeLine(p.card);
    if (C.instantSpeed(p.card)) why.push(`Timing: ${/instant/i.test(tl) ? 'it’s an instant' : 'it has flash'}, so I can cast it any time I have priority (rule 117.1a).`);
    else why.push(`Timing: it’s my turn, my ${PH[s.turn.phase]} phase, and the stack is empty — that’s when a ${/sorcery/i.test(tl) ? 'sorcery' : 'permanent spell'} can be cast (rule 307.1 / 301.1).`);
    const srcs = p.pay.map(id => s.cards[id]).filter(Boolean).map(cn);
    const mc = (C.face(p.card) || {}).mc || '{0}';
    why.push(`Cost: ${mc}${p.x ? ` with X = ${p.x}` : ''}${p.card.cmdr && p.card.zone === 'command' && (s.tax || {})[p.card.id] ? ` plus commander tax {${2 * s.tax[p.card.id]}} (rule 903.8)` : ''}, paid by tapping ${srcs.length ? R.listNames(srcs) : 'nothing'}.`);
    p.reqs.forEach((r, i) => {
      const t = p.tg[i] && p.tg[i][0]; if (!t) return;
      const nm = t.p ? nameOf(t.p) : cn(s.cards[t.c]);
      why.push(`Target: ${nm} is a legal choice for “${r.text}”${t.c && C.keywords(s.cards[t.c], s).has('hexproof') ? '' : ' and doesn’t have hexproof or shroud'} (rule 115.1).`);
    });
    if (p.card.cmdr && p.card.zone === 'command') why.push('Commanders can be cast from the command zone (rule 903.8).');
    return why;
  }
  async function cast(p, when) {
    const s = S();
    const why = whyCast(p, when);          // before casting: commander tax goes up once it's cast
    if (p.pay.length) { const r = await G.tap(p.pay, true); if (!r.ok) return false; }
    const opts = { tg: p.tg, mode: p.mode, x: p.x };
    let r;
    if (p.card.zone === 'hand') { await G.castFromHand(p.card.id, opts); r = { ok: !G.P.hand.some(c => c.id === p.card.id) }; }
    else r = await G.castPublic(p.card.id, opts);
    if (!r || !r.ok) return false;
    const tgt = p.desc.length ? ` targeting ${R.listNames(p.desc)}` : '';
    const how = C.isPermanentCard(p.card) ? '' : explainEffect(p);
    say(`I cast ${cn(p.card)}${tgt}.${how ? ' ' + how : ''}`, why);
    return true;
  }
  function explainEffect(p) {
    const e = p.eff.effects[0]; if (!e) return '';
    const m = { dmg: 'It deals damage', destroy: 'It destroys its target', exile: 'It exiles its target', counter: 'It counters that spell', draw: 'I draw cards', fetch: 'It finds me lands', pump: 'It pumps my creature', bounce: 'It returns its target to hand', token: 'It makes tokens' };
    return m[e.k] ? m[e.k] + ' when it resolves.' : '';
  }

  // ---------------- lands ----------------
  function chooseLand() {
    const lands = hand().filter(c => G.isLand(c));
    if (!lands.length) return null;
    // A color my hand needs that I can't make yet, untapped lands first.
    const have = new Set(sources().flatMap(s => s.colors.split('')));
    const needed = new Set();
    for (const c of hand()) { const cost = C.costOf(c); for (const col of ['W', 'U', 'B', 'R', 'G']) if (cost[col] && !have.has(col)) needed.add(col); }
    const score = c => {
      const m = C.manaSource(c) || { colors: '' };
      let v = 0;
      for (const col of needed) if (m.colors.includes(col)) v += 3;
      if (/enters (the battlefield )?tapped/i.test(C.text(c))) v -= 2;
      v += m.colors.length * 0.3;
      return v;
    };
    return lands.sort((a, b) => score(b) - score(a))[0];
  }

  // ---------------- combat ----------------
  function canAttack(c) {
    const s = S();
    if (c.tapped || !isCreature(c)) return false;
    const k = kw(c);
    if (k.has('defender') || k.has("can't attack")) return false;
    if (R.sick(s, c) && !k.has('haste')) return false;
    return true;
  }
  function blockersFor(att, defPid) {
    const ak = kw(att);
    if (ak.has('unblockable')) return [];
    return creaturesOf(defPid).filter(b => !b.tapped && !kw(b).has("can't block") && (!ak.has('flying') || kw(b).has('flying') || kw(b).has('reach')));
  }
  // Does blocker b kill attacker a / survive?
  function fightResult(a, b) {
    const [ap, at] = ptOf(a), [bp, bt] = ptOf(b);
    const ak = kw(a), bk = kw(b);
    const aKills = (ap >= bt - (b.dmg || 0) || (ak.has('deathtouch') && ap > 0)) && !bk.has('indestructible');
    const bKills = (bp >= at - (a.dmg || 0) || (bk.has('deathtouch') && bp > 0)) && !ak.has('indestructible');
    const aFirst = (ak.has('first strike') || ak.has('double strike')) && !(bk.has('first strike') || bk.has('double strike'));
    const bFirst = (bk.has('first strike') || bk.has('double strike')) && !(ak.has('first strike') || ak.has('double strike'));
    return { aDies: bKills && !(aFirst && aKills), bDies: aKills && !(bFirst && bKills) };
  }
  const pinger = c => C.abilities(c).some(a => a.tap && !a.sac && C.costTotal(a.mana, 0) === 0 && C.effectsIn(a.text).effects.some(e => e.k === 'dmg'));
  function planAttack() {
    const s = S();
    const sk = skill();
    const mineC = creaturesOf(ME()).filter(canAttack);
    if (!mineC.length || !opps().length) return [];
    const life = s.players[ME()].life;
    const targets = opps();
    // The opponent to pressure: lowest life (normal/hard), random (easy).
    const order = targets.slice().sort((a, b) => s.players[a].life - s.players[b].life);
    const list = [];
    // Lethal check against each opponent.
    for (const p of order) {
      const unblockable = mineC.filter(c => blockersFor(c, p).length === 0);
      const dmg = unblockable.reduce((a, c) => a + ptOf(c)[0], 0);
      if (dmg >= s.players[p].life && sk !== 'easy') return unblockable.map(c => ({ id: c.id, p, why: 'lethal' }));
    }
    // Keep back enough blockers if I'm low on life.
    const theirPower = targets.reduce((a, p) => a + creaturesOf(p).filter(c => !c.tapped || true).reduce((x, c) => x + ptOf(c)[0], 0), 0);
    const keepBack = sk === 'easy' ? 0 : life <= theirPower + 4 ? Math.ceil(mineC.length / 2) : 0;
    const sorted = mineC.slice().sort((a, b) => value(a) - value(b));
    const held = new Set(keepBack ? sorted.slice().reverse().filter(c => !kw(c).has('vigilance')).slice(0, keepBack).map(c => c.id) : []);
    for (const c of mineC) {
      if (held.has(c.id)) continue;
      if (ptOf(c)[0] <= 0) continue;
      if (sk !== 'easy' && C.manaSource(c) && ptOf(c)[0] <= 1) continue;      // keep mana creatures home for mana
      if (sk !== 'easy' && ptOf(c)[0] <= 2 && pinger(c)) continue;              // a "{T}: deal 1 damage" creature does more by staying home
      const defs = sk === 'easy' ? [targets[Math.floor(Math.random() * targets.length)]] : order;
      let chosen = null, safe = false;
      for (const p of defs) {
        const bl = blockersFor(c, p);
        const bad = bl.some(b => { const r = fightResult(c, b); return r.aDies && !r.bDies; });
        const trade = bl.some(b => { const r = fightResult(c, b); return r.aDies && r.bDies && value(b) < value(c); });
        if (!bad && !(trade && sk === 'hard')) { chosen = p; safe = true; break; }
        if (!chosen) chosen = p;
      }
      if (sk === 'easy' ? roll(0.6) : safe || kw(c).has('vigilance') && !creaturesOf(chosen).length) list.push({ id: c.id, p: chosen, why: safe ? 'safe' : 'pressure' });
    }
    return list;
  }
  function planBlocks() {
    const s = S(), K = s.combat, sk = skill();
    const atts = Object.entries(K.att).filter(([, x]) => (x.def.p || (s.cards[x.def.c] || {}).ctrl) === ME()).map(([id]) => s.cards[id]).filter(Boolean);
    const free = new Set(creaturesOf(ME()).filter(b => !b.tapped && !kw(b).has("can't block")).map(b => b.id));
    const blocks = [];
    if (sk === 'easy') {
      for (const a of atts) { const bl = blockersFor(a, ME()).filter(b => free.has(b.id)); if (bl.length && roll(0.35) && !kw(a).has('menace')) { const b = bl[0]; blocks.push({ id: b.id, att: a.id }); free.delete(b.id); } }
      return blocks;
    }
    const incoming = atts.reduce((x, a) => x + ptOf(a)[0], 0);
    let life = s.players[ME()].life;
    const sorted = atts.slice().sort((a, b) => value(b) - value(a));
    for (const a of sorted) {
      const menace = kw(a).has('menace');
      const cand = blockersFor(a, ME()).filter(b => free.has(b.id));
      if (!cand.length || (menace && cand.length < 2)) continue;
      // 1) a block that kills it and survives; 2) a good trade; 3) chump if the hits would be lethal.
      let best = cand.filter(b => { const r = fightResult(a, b); return r.aDies && !r.bDies; }).sort((x, y) => value(x) - value(y))[0];
      if (!best) best = cand.filter(b => { const r = fightResult(a, b); return r.aDies && r.bDies && value(b) <= value(a) + (sk === 'hard' ? 0 : 1); }).sort((x, y) => value(x) - value(y))[0];
      if (!best) best = cand.filter(b => { const r = fightResult(a, b); return !r.bDies; }).sort((x, y) => value(x) - value(y))[0];   // it just bounces off
      if (!best && incoming >= life - (sk === 'hard' ? 3 : 1)) best = cand.sort((x, y) => value(x) - value(y))[0];
      if (!best) continue;
      blocks.push({ id: best.id, att: a.id }); free.delete(best.id);
      if (menace) { const second = cand.find(b => b.id !== best.id && free.has(b.id)); if (second) { blocks.push({ id: second.id, att: a.id }); free.delete(second.id); } else blocks.pop(); }
      life += ptOf(a)[0];
    }
    return blocks;
  }

  // ---------------- responding (I hold priority on someone else's spell) ----------------
  function respond() {
    const s = S(), top = R.stackTop(s);
    if (!top || top.ctrl === ME() || skill() === 'easy') return null;
    const targetsMe = (top.tg || []).flat().some(t => t.p === ME() || (t.c && s.cards[t.c] && s.cards[t.c].ctrl === ME()));
    const big = top.ab ? false : ((top.d && +top.d.cmc) || 0) >= (skill() === 'hard' ? 4 : 5) || top.cmdr;
    const cands = hand().map(c => plan(c, 'instant')).filter(Boolean);
    // Counterspells: stop spells aimed at me, or big threats.
    const counter = cands.find(p => p.eff.effects.some(e => e.k === 'counter') && p.tg[0] && p.tg[0][0] && p.tg[0][0].c === top.id);
    if (counter && (targetsMe || big) && roll(SKILL[skill()].think)) return counter;
    // Save my creature: pump it or give it protection in response to damage / removal.
    if (targetsMe) {
      const mineT = (top.tg || []).flat().filter(t => t.c && s.cards[t.c] && s.cards[t.c].ctrl === ME()).map(t => t.c);
      if (mineT.length) {
        const save = hand().map(c => { const p = plan(c, 'instant'); if (!p) return null; const t = chooseTargets(c, p.mode, p.eff, { protect: mineT, x: p.x }); return t && t.tg.flat().some(x => mineT.includes(x.c)) ? Object.assign(p, t) : null; })
          .filter(Boolean).find(p => p.eff.effects.some(e => e.k === 'grant' && /hexproof|indestructible|protection/.test(e.kws)) || (p.eff.effects.some(e => e.k === 'pump') && top.d && /damage/i.test(C.text(top))));
        if (save) return save;
      }
    }
    return null;
  }

  // After blockers: a pump spell that wins a fight (my creature survives, or kills theirs and survives).
  function combatTrick() {
    const s = S(), K = s.combat; if (!K) return null;
    const fights = [];
    for (const [aid, x] of Object.entries(K.att)) {
      const a = s.cards[aid]; if (!a) continue;
      for (const bid of x.blk || []) { const b = s.cards[bid]; if (!b) continue; if (a.ctrl === ME()) fights.push([a, b]); else if (b.ctrl === ME()) fights.push([b, a]); }
    }
    if (!fights.length) return null;
    for (const c of hand()) {
      const p = plan(c, 'instant'); if (!p) continue;
      const pump = p.eff.effects.find(e => e.k === 'pump' && !/^-/.test(String(e.t)) && !/x/i.test(String(e.p) + String(e.t)));
      if (!pump || p.eff.effects.length > 2) continue;
      const dp = parseInt(pump.p, 10) || 0, dt = parseInt(pump.t, 10) || 0;
      for (const [m, o] of fights) {
        const [mp, mt] = ptOf(m), [op, ot] = ptOf(o), mk = kw(m), ok = kw(o);
        const dies = (pw, dtch, t, dmg, ind) => !ind && ((dtch && pw > 0) || pw >= t - (dmg || 0));
        const before = { me: dies(op, ok.has('deathtouch'), mt, m.dmg, mk.has('indestructible')), them: dies(mp, mk.has('deathtouch'), ot, o.dmg, ok.has('indestructible')) };
        const after = { me: dies(op, ok.has('deathtouch'), mt + dt, m.dmg, mk.has('indestructible')), them: dies(mp + dp, mk.has('deathtouch'), ot, o.dmg, ok.has('indestructible')) };
        if (after.me || (!before.me && before.them === after.them)) continue;
        const t = chooseTargets(c, p.mode, p.eff, { protect: [m.id], x: p.x });
        if (!t || !t.tg.flat().some(x => x.c === m.id)) continue;
        return Object.assign(p, t);
      }
    }
    return null;
  }

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
    [/infect|poison/, 'Infect: damage to players is dealt as poison counters (10 poison and you lose), and to creatures as −1/−1 counters (702.90).'],
    [/summoning sick|sickness|just came in|why can't .*attack/, 'Summoning sickness: a creature can’t attack or use {T} abilities unless its controller has controlled it continuously since their most recent turn began — unless it has haste (302.6).'],
    [/land.*(turn|once|two|second|extra)|play.*land/, 'Lands: you may play one land per turn, during your main phase, when the stack is empty (305.2). Extra land drops only come from effects — use “Move to → Battlefield” for those.'],
    [/commander tax|tax/, 'Commander tax: each time you cast your commander from the command zone, it costs {2} more for each previous time (903.8).'],
    [/commander damage|21/, 'Commander damage: a player who has been dealt 21 or more combat damage by the same commander loses the game (903.10a).'],
    [/mulligan/, 'Mulligans here: your first mulligan in Commander is free, then each later one means putting one more card on the bottom (London mulligan, 103.5).'],
    [/stack|priority|respond|in response/, 'The stack: when a spell is cast, every player gets a chance to respond in turn order. A response resolves first (last in, first out). When everyone passes in a row, the top spell resolves (117, 405).'],
    [/fizzle|target.*(gone|left|illegal)|counter.*rules/, 'If every target of a spell is gone or illegal when it tries to resolve, it doesn’t resolve at all (608.2b).'],
    [/legend/, 'Legend rule: if you control two legendary permanents with the same name, you choose one and put the other into the graveyard (704.5j).'],
    [/block.*(two|more|multiple)|two blockers/, 'Each creature can block only one attacker, but several creatures can block the same attacker (509.1).'],
    [/damage.*(wear|go away|reset|heal)/, 'Damage on creatures wears off during the cleanup step at the end of each turn (514.2).'],
    [/toughness.*0|zero toughness/, 'A creature with 0 or less toughness goes to its owner’s graveyard (704.5f).'],
    [/monarch/, 'The monarch draws an extra card at their end step; dealing combat damage to the monarch steals it (724).'],
    [/mana value|cmc|converted/, 'Mana value is the total amount of mana in a card’s mana cost; X counts as 0 except on the stack (202.3).'],
    [/hand size|discard.*(seven|7)|maximum/, 'Hand size: at your cleanup step you discard down to seven cards (514.1).'],
    [/counterspell|counter a spell|countered/, 'A countered spell goes to its owner’s graveyard without doing anything (701.6).']
  ];
  const answered = new Set();
  function findChat(id) { return (S().aichat || []).find(m => m.id === id); }
  function answer(q) {
    const s = S();
    const t = q.text.toLowerCase();
    const ref = q.re ? findChat(q.re) : null;
    if (ref && ref.pid === ME()) {
      const why = ref.why && ref.why.length ? ref.why : ['That was an ordinary game action with no special requirements.'];
      return { text: `Yes, “${ref.text}” is legal. Here’s what I checked:`, why };
    }
    const aboutMe = /\b(you|your|that|this|it)\b/.test(t) && /(legal|allowed|cheat|why|how (did|can|could)|is that ok|wrong|illegal|not allowed|okay|ok\b|right)/.test(t);
    const faq = FAQ.find(([re]) => re.test(t));
    if (aboutMe && lastWhy && !(faq && /^(what|how) (does|do|is|are)\b/.test(t))) {
      return { text: `My last move was: “${lastWhy.text}” I checked the rules before doing it:`, why: lastWhy.why.length ? lastWhy.why : ['It didn’t need any special permission.'] };
    }
    if (faq) return { text: faq[1] };
    if (/(legal|allowed|cheat|illegal)/.test(t) && lastWhy) return { text: `My last move was: “${lastWhy.text}” I checked the rules before doing it:`, why: lastWhy.why.length ? lastWhy.why : ['It didn’t need any special permission.'] };
    if (/(mana|untapped|lands)/.test(t)) {
      const src = sources();
      return { text: `I have ${src.reduce((a, x) => a + x.amount, 0)} mana available right now${src.length ? ': ' + src.map(x => `${x.name} ({${x.colors.split('').join('/')}})`).join(', ') : ''}.` };
    }
    if (/(hand|cards in)/.test(t)) return { text: `I have ${G.P.hand.length} card${G.P.hand.length === 1 ? '' : 's'} in hand and ${G.P.library.length} in my library. I won’t say what they are!` };
    if (/(life|health)/.test(t)) return { text: s.seats.map(p => `${nameOf(p)}: ${s.players[p].life}`).join(' · ') };
    if (/(plan|doing|thinking|next|strategy|what are you)/.test(t)) return { text: planText() };
    if (/(attack|block)/.test(t) && lastCombat) return { text: lastCombat };
    if (/(skill|level|difficulty|how good)/.test(t)) return { text: `I’m playing on ${skill()} — ${skill() === 'easy' ? 'I play loosely and don’t respond to spells' : skill() === 'normal' ? 'I play on curve, make sensible attacks and blocks, and sometimes counter big spells' : 'I look for lethal, hold up answers, and make careful trades'}. The player who added me can change it.` };
    if (/(hi|hello|hey|good game|gg)\b/.test(t)) return { text: 'Hello! Good luck — ask me anything about what I’m doing or about the rules.' };
    return { text: 'I’m the table’s built-in rules engine, so I can answer things like “Is that legal?”, “Why did you attack Alex?”, “How much mana do you have?” or “What does trample do?”.' };
  }
  let lastCombat = '';
  function planText() {
    const s = S(), T = s.turn;
    if (!T.active) return 'Waiting for the game to start.';
    if (T.active !== ME()) return `It’s ${nameOf(T.active)}’s turn. I’m watching for things I need to respond to${skill() !== 'easy' ? ' and keeping an eye on blocks' : ''}.`;
    const c = hand().map(x => plan(x, 'main')).filter(Boolean).sort((a, b) => b.score - a.score)[0];
    return `It’s my ${PH[T.phase]}. I have ${manaAvailable()} mana available${c ? ` and I’m thinking about casting ${cn(c.card)}` : ''}${creaturesOf(ME()).some(canAttack) ? ', then attacking' : ''}.`;
  }

  // ---------------- effects that need my hand / library ----------------
  G.onTodo = async function (t, ack) {
    try {
      if (t.k === 'fetch') {
        const basics = G.basicLands();
        const need = new Set(); for (const c of hand()) { const cost = C.costOf(c); for (const col of ['W', 'U', 'B', 'R', 'G']) if (cost[col]) need.add(col); }
        const have = new Set(sources().flatMap(s => s.colors.split('')));
        const sorted = basics.slice().sort((a, b) => { const ca = (C.manaSource(a) || {}).colors || '', cb = (C.manaSource(b) || {}).colors || ''; const sc = x => [...x].some(col => need.has(col) && !have.has(col)) ? 2 : [...x].some(col => need.has(col)) ? 1 : 0; return sc(cb) - sc(ca); });
        const pick = []; const seen = new Set();
        for (const c of sorted) { if (pick.length >= (t.n || 1)) break; const col = ((C.manaSource(c) || {}).colors || ''); if (!seen.has(col) || sorted.length <= (t.n || 1)) { pick.push(c.id); seen.add(col); } }
        for (const c of sorted) { if (pick.length >= (t.n || 1)) break; if (!pick.includes(c.id)) pick.push(c.id); }
        await G.fetchLands(pick, t);
      } else if (t.k === 'scry') {
        const top = G.P.library.slice(0, t.n || 1);
        const lands = mine('battlefield').filter(c => R.isType(c, 'land')).length;
        const decisions = top.map(c => ({ id: c.id, dest: (G.isLand(c) ? lands >= 6 : (+c.d.cmc || 0) > lands + 2) ? 'bottom' : 'top' }));
        await G.applyLook('scry', top.length, decisions);
      } else if (t.k === 'discard') {
        const n = Math.min(t.n || 1, G.P.hand.length);
        const pick = discardChoice(n);
        for (const id of pick) await G.fromHand([id], 'graveyard', { msg: `discarded {cards} (${t.src})` });
      } else if (t.k === 'sacrifice') {
        const what = (t.what || 'creature').toLowerCase();
        const list = mine('battlefield').filter(c => /creature/.test(what) ? isCreature(c) : /artifact/.test(what) ? R.isType(c, 'artifact') : /land/.test(what) ? R.isType(c, 'land') : true).sort((a, b) => value(a) - value(b));
        const ids = list.slice(0, t.n || 1).map(c => c.id);
        if (ids.length) { await G.move(ids, 'graveyard', null, { msg: 'sacrificed' }); say(`I sacrifice ${R.listNames(ids.map(id => cn(S().cards[id] || { d: null })))} (${t.src}) — it was my least valuable choice.`); }
      }
    } catch (e) { console.error(e); }
    ack();
  };
  function discardChoice(n) {
    const lands = mine('battlefield').filter(c => R.isType(c, 'land')).length;
    const h = hand();
    const landsInHand = h.filter(c => G.isLand(c)).length;
    const score = c => G.isLand(c) ? (lands >= 6 ? 0 : landsInHand > 2 ? 1 : 8) : 10 - Math.abs(((+c.d.cmc || 0) - lands));
    return h.slice().sort((a, b) => score(a) - score(b)).slice(0, n).map(c => c.id);
  }

  // ---------------- one step of thinking ----------------
  async function step() {
    const s = S(), me = G.me();
    if (!s) return false;
    // Sit down.
    if (!me) {
      if ((G.status === 'host' || G.status === 'connected') && s.seats.length < R.MAX_SEATS && !G.joining) {
        G.joining = true;
        const r = await G.act({ type: 'join', name: cfg.name, ai: { skill: cfg.skill, by: cfg.owner } });
        G.joining = false;
        if (r.ok) say(`Hi! I’m ${cfg.name}, an AI player (${cfg.skill}). I follow the rules and explain my moves here — ask me anything.`);
        return r.ok;
      }
      return false;
    }
    if (!me.ai && cfg) { await G.act({ type: 'aiMeta', restore: true, by: cfg.owner, skill: cfg.skill }); return true; }
    if (me.ai && cfg && cfg.skill && me.ai.skill !== cfg.skill) { await G.act({ type: 'aiMeta', skill: cfg.skill }); return true; }
    if (s.winner && !tried.has('gg:' + s.gameId)) { tried.add('gg:' + s.gameId); say(s.winner === ME() ? 'Good game — thanks for playing! Press Rematch for another.' : s.winner === 'draw' ? 'A draw — good game, everyone!' : `Good game, ${nameOf(s.winner)}!`); return true; }
    if (me.lost || s.winner) {
      // Still answer questions after the game.
      const q = (s.aichat || []).find(m => m.kind === 'q' && m.to === ME() && !answered.has(m.id));
      if (!q) return false;
    }
    // Questions for me.
    for (const q of (s.aichat || []).filter(m => m.kind === 'q' && m.to === ME() && !answered.has(m.id))) {
      answered.add(q.id);
      if ((s.aichat || []).some(m => m.kind === 'a' && m.re === q.id)) continue;
      if (Date.now() - q.t > 5 * 60000) continue;
      const a = answer(q);
      await G.act({ type: 'aiSay', kind: 'a', re: q.id, text: a.text, why: a.why });
      return true;
    }
    // Deck.
    if (!G.P.deckId && !G.P.library.length && !G.P.hand.length) {
      const deck = G.decks()[0];
      if (deck && !G.loadingDeck) { G.loadingDeck = true; try { await G.useDeck(deck); } finally { G.loadingDeck = false; } return true; }
      return false;
    }
    // Opening hand.
    if (G.P.phase === 'none' && !G.P.hand.length && G.P.library.length && G.P.deckId && (s.turn.active || s.seats.every(p => s.players[p].ai || s.players[p].handCount > 0 || s.players[p].libCount === 0 || true))) {
      G.openingHand(); return true;
    }
    if (G.P.phase === 'deciding') {
      const lands = G.P.hand.filter(c => G.isLand(c)).length;
      if ((lands < 2 || lands > 5) && G.P.mull < 2) { G.mulligan(); return true; }
      G.keep(); say(`I keep my opening hand of ${G.P.hand.length - Math.max(0, G.P.mull - 1)}.`); return true;
    }
    if (G.P.phase === 'bottom') {
      const ids = discardChoice(G.P.bottomN);
      G.bottomChosen(ids); return true;
    }
    if (!s.turn.active) return false;
    // Legend rule: keep the newest copy.
    for (const key of Object.keys(s.legend || {})) {
      if (!key.startsWith(ME() + '|')) continue;
      const nm = key.slice(ME().length + 1);
      const copies = mine('battlefield').filter(c => cn(c) === nm).sort((a, b) => a.seq - b.seq);
      if (copies.length > 1) { await G.move(copies.slice(0, -1).map(c => c.id), 'graveyard'); say(`I control two copies of ${nm}, so I keep the newest one and put the other into my graveyard (legend rule, 704.5j).`); return true; }
    }
    // Priority: someone cast something.
    if (s.prio && s.prio.holder === ME()) {
      const p = s.prio.step ? (skill() !== 'easy' && !R.stackTop(s) && !tried.has('trick:' + s.gameId + ':' + s.turn.n + ':' + s.prio.since) ? (tried.add('trick:' + s.gameId + ':' + s.turn.n + ':' + s.prio.since), combatTrick()) : null) : respond();
      if (p) { const ok = await cast(p, 'instant'); if (ok) return true; }
      await G.pass(); return true;
    }
    if (!s.prio && await checkEnterTriggers()) return true;
    if (s.prio) {
      // My spell is waiting on someone who isn't answering.
      const top = R.stackTop(s);
      if (top && top.ctrl === ME() && Date.now() - s.prio.since > 75000) {
        await G.act({ type: 'resolveNow' }); say(`${nameOf(s.prio.holder)} hasn’t answered for over a minute, so I’m letting ${cn(top)} resolve.`); return true;
      }
      return false;
    }
    // Blocks.
    const K = s.combat;
    if (K && !K.done && K.n === s.turn.n && K.waiting.includes(ME()) && !K.ok[ME()]) {
      const blocks = planBlocks();
      const r = await G.block(blocks);
      if (r.ok) {
        lastCombat = blocks.length ? `I blocked ${blocks.map(b => `${cn(s.cards[b.att])} with ${cn(s.cards[b.id])}`).join(', ')} — ${skill() === 'easy' ? 'it looked fun' : 'those blocks either kill the attacker, survive, or keep me alive'}.` : 'I didn’t block — none of my blocks were worth it.';
        say(lastCombat, ['Declare blockers step, and these creatures are attacking me (509.1).', 'Each blocker is untapped and blocks only one attacker.', 'Flying attackers were only blocked by creatures with flying or reach; menace attackers by two or more.']);
      }
      return true;
    }
    if (s.turn.active !== ME()) {
      if (PH[s.turn.phase] === 'End step' && !s.prio && skill() !== 'easy') return useTapAbility(s.gameId + ':' + s.turn.n + ':eot');
      return false;
    }
    return myTurn();
  }
  const tried = new Set();

  let openWaitSince = 0;
  async function myTurn() {
    const s = S(), T = s.turn, ph = PH[T.phase];
    const key = s.gameId + ':' + T.n;
    // Turn 1: let everyone draw and keep an opening hand first (103.5) — up to a minute and a half.
    if (T.n === 1 && s.seats.some(p => p !== ME() && !s.players[p].lost && s.players[p].handCount === 0 && s.players[p].libCount > 0)) {
      if (!openWaitSince) { openWaitSince = Date.now(); say('I’ll wait for everyone to draw and keep their opening hands before I start.'); return true; }
      if (Date.now() - openWaitSince < 90000) return false;
    }
    if (ph === 'Upkeep') { if (await fireTriggers('upkeep', mine('battlefield'), key)) return true; await G.act({ type: 'phase', to: PI('Draw') }); return true; }
    if (ph === 'Draw') {
      if (G.P.autoDrew !== key && G.P.phase === 'kept') { G.autoDraw(); return true; }
      await G.act({ type: 'phase', to: PI('Main 1') }); return true;
    }
    if (ph === 'Main 1' || ph === 'Main 2') {
      // Land drop.
      if (!(T.lands && T.lands[ME()]) && !tried.has(key + ':land')) {
        const land = chooseLand();
        if (land) {
          tried.add(key + ':land');
          const r = await G.playLand(land.id);
          if (r.ok) { say(`I play ${cn(land)}.`, [`It’s my turn and my ${ph} phase, and the stack is empty (rule 305.2).`, 'It’s my first land this turn — one land per turn.']); return true; }
        }
      }
      // Spells (one at a time; each waits for everyone to respond).
      const cands = hand().map(c => plan(c, 'main')).concat(mine('command').filter(c => c.cmdr).map(c => plan(c, 'main'))).filter(Boolean)
        .filter(p => !tried.has(key + ':' + p.card.id));
      // Hard players keep a counterspell's mana open when they can.
      let pick = null;
      if (cands.length) {
        if (skill() === 'easy') pick = cands[Math.floor(Math.random() * cands.length)];
        else {
          cands.sort((a, b) => b.score - a.score);
          pick = cands[0];
          if (skill() === 'hard' && ph === 'Main 1' && isCreature(pick.card) && !kw(pick.card).has('haste') && creaturesOf(ME()).some(canAttack)) pick = cands.find(p => !isCreature(p.card)) || pick;
        }
      }
      if (pick) {
        tried.add(key + ':' + pick.card.id);
        const ok = await cast(pick, 'main');
        if (ok) return true;
      }
      // Equipment: put unattached equipment on my best creature.
      if (skill() !== 'easy') for (const eq of mine('battlefield').filter(c => R.isType(c, 'equipment') && !(c.attachedTo && S().cards[c.attachedTo] && S().cards[c.attachedTo].zone === 'battlefield'))) {
        if (tried.has(key + ':eq:' + eq.id)) continue;
        tried.add(key + ':eq:' + eq.id);
        const abs = C.abilities(eq); const i = abs.findIndex(x => x.equip);
        if (i < 0) continue;
        const best = creaturesOf(ME()).sort((x, y) => value(y) + (canAttack(y) ? 2 : 0) - value(x) - (canAttack(x) ? 2 : 0))[0];
        if (!best) continue;
        const pay = C.pay(abs[i].mana, sources(), 0);
        if (!pay) continue;
        if (pay.length) await G.tap(pay, true);
        const r = await G.activate(eq.id, i, [[{ c: best.id }]]);
        if (r.ok) { say(`I equip ${cn(eq)} to ${cn(best)}.`, [`${abs[i].cost}: equip only as a sorcery — it’s my main phase and the stack is empty (702.6a).`, `Paid by tapping ${R.listNames(pay.map(id => cn(S().cards[id])))}.`, `${cn(best)} is a creature I control.`]); return true; }
      }
      // Planeswalkers: use a plus ability once per turn.
      for (const pw of mine('battlefield').filter(c => R.isType(c, 'planeswalker'))) {
        if (tried.has(key + ':pw:' + pw.id) || (T.loyal || {})[pw.id] === T.n) continue;
        tried.add(key + ':pw:' + pw.id);
        const abs = C.abilities(pw);
        const i = abs.findIndex(a => a.loyalty !== undefined && a.loyalty >= 0 && C.effectsIn(a.text).understood);
        if (i < 0) continue;
        const fake = { id: pw.id, ab: { text: abs[i].text }, d: pw.d, zone: 'stack', counters: {} };
        const eff = C.effectsIn(abs[i].text);
        const reqs = C.targetsIn(abs[i].text);
        let tg = [];
        if (reqs.length) { const t = chooseTargets({ d: { faces: [{ n: cn(pw), t: 'Instant', o: abs[i].text }] }, counters: {} }, null, eff); if (!t) continue; tg = t.tg; }
        const r = await G.activate(pw.id, i, tg);
        if (r.ok) { say(`I activate ${cn(pw)}’s ${abs[i].cost} ability: “${noDot(abs[i].text)}”.`, ['Loyalty abilities: once per turn, in my main phase, with an empty stack (606.3).']); return true; }
      }
      if (ph === 'Main 1') {
        await G.act({ type: 'phase', to: PI('Beginning of combat') }); return true;
      }
      if (await useTapAbility(key)) return true;
      await G.act({ type: 'phase', to: PI('End step') }); return true;
    }
    if (ph === 'Beginning of combat' || ph === 'Declare attackers') {
      if (s.combat && s.combat.n === T.n) { await G.act({ type: 'phase', to: PI('Main 2') }); return true; }
      const list = planAttack();
      let r = await G.attack(list.map(x => ({ id: x.id, p: x.p })));
      if (!r.ok && list.length) { console.warn('[ai] attack refused:', r.err); r = await G.attack([]); }
      if (!r.ok) { await G.act({ type: 'phase', to: PI('Main 2') }); return true; }
      if (r.ok && list.length) {
        const by = {}; for (const x of list) (by[x.p] = by[x.p] || []).push(cn(S().cards[x.id] || s.cards[x.id]));
        lastCombat = `I attacked ${Object.entries(by).map(([p, v]) => `${nameOf(p)} with ${R.listNames(v)}`).join(' and ')}${list.some(x => x.why === 'lethal') ? ' — that should be lethal' : skill() === 'easy' ? '' : `, because ${list.every(x => x.why === 'safe') ? 'no blocker can kill them for free' : 'it keeps the pressure on'}`}.`;
        say(lastCombat, ['It’s my turn and the start of combat (508.1).', 'Every attacker is untapped and has been under my control since my turn began (or has haste), and none has defender.', 'Each attacks an opponent (or an opponent’s planeswalker).']);
      } else if (r.ok) say('No attacks this turn.');
      return true;
    }
    if (ph === 'Declare blockers') {
      const K = s.combat;
      if (K && K.n === T.n && !K.done && await fireTriggers('attack', Object.keys(K.att).map(id => s.cards[id]).filter(Boolean), key)) return true;
      if (K && !K.done && Date.now() - (K.since || 0) > 90000) { await G.act({ type: 'phase', to: PI('Combat damage') }); say('Nobody declared blocks for a minute and a half, so I moved on to combat damage (unblocked).'); return true; }
      return false;
    }
    if (ph === 'Combat damage' || ph === 'End of combat') { await G.act({ type: 'phase', to: PI('Main 2') }); return true; }
    if (ph === 'End step') {
      if (await fireTriggers('end', mine('battlefield'), key)) return true;
      if (s.table.monarch === ME() && !tried.has(key + ':monarch')) { tried.add(key + ':monarch'); G.draw(1, 'drew a card for being the monarch'); return true; }
      await G.act({ type: 'phase', to: PI('Cleanup') }); return true;
    }
    if (ph === 'Cleanup') {
      if (G.P.hand.length > 7) {
        const ids = discardChoice(G.P.hand.length - 7);
        for (const id of ids) await G.fromHand([id], 'graveyard', { msg: 'discarded {cards} (hand size)' });
        say(`I discard down to seven cards (514.1).`); return true;
      }
      await G.act({ type: 'phase', dir: 'pass' }); return true;
    }
    await G.act({ type: 'phase' }); return true;
  }

  // Triggered abilities of my own permanents: entering the battlefield, attacking, my upkeep and end step.
  const seenPerm = new Set();
  let permInit = false;
  async function fireTriggers(ev, cardsList, key) {
    for (const c of cardsList) {
      const trs = C.triggers(c);
      for (let i = 0; i < trs.length; i++) {
        const tr = trs[i];
        if (tr.ev !== ev) continue;
        const tk = key + ':tr:' + c.id + ':' + i;
        if (tried.has(tk)) continue;
        tried.add(tk);
        const eff = C.effectsIn(tr.text);
        if (!eff.understood || !eff.effects.length) {
          const once = 'skip:' + S().gameId + ':' + cn(c) + ':' + i;
          if (tried.has(once)) continue;
          tried.add(once);
          say(`${cn(c)} has a triggered ability I can’t carry out by myself (“${tr.text}”), so I’ll skip it this game. If it matters, its effect can be done by hand.`); return true;
        }
        const reqs = C.targetsIn(tr.text);
        let tg = [], desc = [];
        if (reqs.length) {
          let t = chooseTargetsFor({ d: { faces: [{ n: cn(c), t: 'Instant', o: tr.text }] }, counters: {} }, reqs, eff);
          const optional = /\byou may\b|\bup to\b/i.test(tr.text);
          if (!t && !optional) t = anyTargets(reqs, eff);
          if (!t) {
            const none = reqs.some(r => !C.targetChoices(S(), r, ME()).length);
            say(none ? `${cn(c)}’s triggered ability has no legal target, so it’s removed from the stack (603.3d).` : `${cn(c)}’s triggered ability says “may”, and no target is worth it, so I skip it.`); return true;
          }
          tg = t.tg; desc = t.desc;
        }
        const r = await G.act({ type: 'trigger', id: c.id, i, tg });
        if (r.ok) { say(`${cn(c)} triggers: “${noDot(tr.text.replace(/^this /i, cn(c) + ' '))}”${desc.length ? ' — targeting ' + R.listNames(desc) : ''}.`, [`Triggered ability (${tr.line}) — it goes on the stack the next time a player would get priority (603.3).`, reqs.length ? 'Its targets are chosen as it’s put on the stack (603.3d).' : 'It has no targets.']); return true; }
      }
    }
    return false;
  }
  async function checkEnterTriggers() {
    const bf = mine('battlefield');
    if (!permInit) { bf.forEach(c => seenPerm.add(c.id)); permInit = true; return false; }
    const fresh = bf.filter(c => !seenPerm.has(c.id));
    fresh.forEach(c => seenPerm.add(c.id));
    for (const id of [...seenPerm]) if (!S().cards[id] || S().cards[id].zone !== 'battlefield') seenPerm.delete(id);
    if (!fresh.length) return false;
    return fireTriggers('etb', fresh, 'etb:' + S().gameId + ':' + S().turn.n);
  }

  // {T} abilities that deal damage or draw ("{T}: Prodigal Pyromancer deals 1 damage to any target").
  async function useTapAbility(key) {
    if (skill() === 'easy') return false;
    for (const c of mine('battlefield')) {
      if (c.tapped || tried.has(key + ':ab:' + c.id)) continue;
      if (isCreature(c) && R.sick(S(), c) && !kw(c).has('haste')) continue;
      const abs = C.abilities(c);
      for (let i = 0; i < abs.length; i++) {
        const ab = abs[i];
        if (!ab.tap || ab.sac || C.costTotal(ab.mana, 0) > 0 || ab.loyalty !== undefined) continue;
        const eff = C.effectsIn(ab.text);
        if (!eff.understood || !eff.effects.some(e => ['dmg', 'draw', 'life', 'counters', 'tap'].includes(e.k))) continue;
        const pseudo = { d: { faces: [{ n: cn(c), t: 'Instant', o: ab.text }] }, counters: {} };
        const reqs = C.targetsIn(ab.text);
        let tg = [], desc = [];
        if (reqs.length) { const t = chooseTargetsFor(pseudo, reqs, eff); if (!t) continue; tg = t.tg; desc = t.desc; }
        tried.add(key + ':ab:' + c.id);
        const r = await G.activate(c.id, i, tg);
        if (r.ok) { say(`I use ${cn(c)}: “${noDot(ab.text.replace(/^this /i, cn(c) + ' '))}”${desc.length ? ' targeting ' + R.listNames(desc) : ''}.`, ['It’s an activated ability with {T} in its cost: the creature is untapped and has been under my control since my turn began (602.5a, 302.6).', 'Abilities go on the stack like spells, so everyone may respond (602.2).']); return true; }
      }
    }
    return false;
  }
  // A mandatory trigger must target something if it can: prefer an opponent's thing, else the least valuable of mine.
  function anyTargets(reqs, eff) {
    const s = S(), tg = [], desc = [], taken = new Set();
    for (let i = 0; i < reqs.length; i++) {
      const ch = C.targetChoices(s, reqs[i], ME()).filter(t => !taken.has(t.c || t.p));
      if (!ch.length) { if (reqs[i].upTo) { tg.push([]); continue; } return null; }
      const theirs = ch.filter(t => t.p ? t.p !== ME() : s.cards[t.c] && s.cards[t.c].ctrl !== ME());
      const intent = intentFor({ d: null }, eff, i);
      const pool = intent === 'theirs' ? (theirs.length ? theirs : ch) : (ch.filter(t => !theirs.includes(t)).length ? ch.filter(t => !theirs.includes(t)) : ch);
      const pick = pool.slice().sort((a, b) => (intent === 'theirs' && pool !== theirs ? threat(a) - threat(b) : threat(b) - threat(a)))[0];
      taken.add(pick.c || pick.p); tg.push([pick]);
      desc.push(pick.p ? (pick.p === ME() ? 'myself' : nameOf(pick.p)) : (s.cards[pick.c].ctrl !== ME() ? nameOf(s.cards[pick.c].ctrl) + '’s ' : 'my ') + cn(s.cards[pick.c]));
    }
    return { tg, desc };
  }
  function chooseTargetsFor(pseudo, reqs, eff) {
    const save = C.targetReqs;
    try { C.targetReqs = () => reqs; return chooseTargets(pseudo, null, eff); } finally { C.targetReqs = save; }
  }

  // ---------------- the loop ----------------
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
      if (did) { waitRev = before; waitUntil = Date.now() + 4000; nextAt = Date.now() + pace() * (0.75 + Math.random() * 0.5); }
      else { waitRev = -1; nextAt = Date.now() + 400; }
    } catch (e) { console.error('[ai]', e); nextAt = Date.now() + 2000; }
    finally { busy = false; }
  }

  // ---------------- messages from the page that owns me ----------------
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
    Net.ticker.every(300, tick);
    tell({ t: 'started', pid: G.KEY });
  });
  G.aiDebug = { plan, hand, sources, planAttack, planBlocks, answer, step };
})();
