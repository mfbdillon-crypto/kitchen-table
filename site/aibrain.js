// Kitchen Table — the AI's planner ("brain").
// Reads its own commander and deck profile (aiprofiles.js), reads every opponent's commander to work out how to
// disrupt it, scores how much each opponent threatens its plan, picks the fastest win route over the next 10 turns,
// builds this turn's list of moves plus a list of saved responses for opponents' turns (like the table's trigger
// list), and keeps backup scenarios. Every plan and every change of plan is logged with the reason, so a developer
// can compare what it wanted to do with what it did.
//
// The brain never looks at the order of its library: it only gets the library as an unordered list of cards
// (its own decklist minus what it has seen), which it uses for odds — like a player who knows their deck.
// It runs in the browser (inside the AI player's hidden page) and in node (test/ai_sim.js).
(function (root) {
  'use strict';
  const R = () => root.Rules, C = () => root.Cards, FX = () => root.Effects;
  const PROFILES = () => root.KT_AI_PROFILES || {};
  const ARCH = () => root.KT_AI_ARCHETYPES || {};
  const byCmdr = name => (root.KT_AI_PROFILE_BY_CMDR ? root.KT_AI_PROFILE_BY_CMDR(name) : null);

  // ---------------- difficulty ----------------
  // Easy plans 3 turns ahead with 1 backup, holds nothing up, makes a not-best choice ~25% of the time.
  // Normal plans 10 turns with 3 backups and holds answers. Hard plans 10 turns with 5 backups, weighs open mana
  // deeply and never deliberately misplays.
  const LEVELS = {
    easy: { horizon: 3, scenarios: 1, mistake: 0.25, hold: false, risk: 0.4, wipeSense: 0.6 },
    normal: { horizon: 10, scenarios: 3, mistake: 0.08, hold: true, risk: 0.85, wipeSense: 1 },
    hard: { horizon: 10, scenarios: 5, mistake: 0, hold: true, risk: 1, wipeSense: 1, deep: true }
  };

  // ---------------- small helpers ----------------
  const low = x => String(x || '').toLowerCase();
  const sum = (a, f) => a.reduce((x, y) => x + (f ? f(y) : y), 0);
  const uniq = a => [...new Set(a)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function Brain(opts) {
    const B = this;
    B.level = LEVELS[opts.level] ? opts.level : 'normal';
    B.L = LEVELS[B.level];
    B.rng = opts.rng || Math.random;
    B.me = opts.me;
    B.deckId = opts.deckId || null;
    B.profile = Object.assign({ arch: ['value'], win: ['combat-big'], key: [], protect: [], finishers: [], wipes: [], combos: [], vs: {} }, PROFILES()[B.deckId] || {});
    B.bracket = opts.bracket || B.profile.bracket || 2;
    B.log = [];                 // plan log: every plan, change, action, refusal
    B.seen = {};                // pid -> { id: name } cards an opponent has shown this game
    B.reads = {};               // pid -> read of that opponent
    B.plan = null;              // current plan (route, milestones, turn steps, responses, scenarios)
    B.sig = '';
    B.turnPlans = {};           // turn number -> { planned: [...], did: [...] }
    B.gameId = null;
  }
  const P = Brain.prototype;

  // ---------------- logging ----------------
  P.note = function (kind, text, data) {
    const s = this.s;
    const e = { t: Date.now(), turn: s && s.turn ? s.turn.n : 0, phase: s && s.turn ? R().PHASES[s.turn.phase] : '', kind, text: String(text) };
    if (data !== undefined) e.data = data;
    this.log.push(e);
    if (this.log.length > 600) this.log.splice(0, this.log.length - 600);
    if (root.KT_AI_LOG_CONSOLE) console.log(`[${this.me}] ${e.turn}/${e.phase} ${kind}: ${text}`);
    return e;
  };
  // A not-best choice now and then (Easy 25%, Normal 8%, Hard never). Never picks something marked unsafe.
  P.choose = function (sorted, what) {
    if (!sorted.length) return null;
    // One roll per decision (per turn), not per re-think.
    const k = what + ':' + (this.s && this.s.turn ? this.s.turn.n : 0);
    this.rolls = this.rolls || {};
    if (this.rolls[k] === undefined) this.rolls[k] = this.rng() < this.L.mistake;
    if (sorted.length > 1 && this.L.mistake && this.rolls[k]) {
      const alt0 = sorted.slice(1).find(x => !x.unsafe);
      if (alt0 && this.rollNoted !== k) { this.rollNoted = k; this.note('mistake', `${what}: picked ${alt0.label || alt0.name || 'option 2'} instead of ${sorted[0].label || sorted[0].name || 'the best option'} (difficulty ${this.level})`); }
      if (alt0) return alt0;
    }
    return sorted[0];
  };

  // ======================= reading cards =======================
  const ROLE_CACHE = new Map();
  // What a card is for: land, ramp, draw, removal, wipe, counter, protection, tutor, recursion, token, anthem,
  // sacOutlet, deathDrain, evasion, equipment, aura, fog, finisher, threat, trick, edict, bounce, flash…
  function roles(card) {
    if (!card || !card.d) return new Set();
    const key = card.d.n + ':' + (card.face || 0);
    if (ROLE_CACHE.has(key)) return ROLE_CACHE.get(key);
    const Cd = C(), Rr = R();
    let t = low(Cd.text(card)); const tl = low(Rr.typeLine(card));
    const r = new Set();
    const isLandCard = /\bland\b/.test(tl.split('//')[0]);
    if (isLandCard) r.add('land');
    if (/\bcreature\b/.test(tl)) r.add('creature');
    if (/\binstant\b/.test(tl) || /\bflash\b/.test(t)) r.add('instant');
    if (!isLandCard && Cd.manaSource && Cd.manaSource(card)) r.add('ramp');
    if (/search your library for (?:up to \w+ )?(?:a |an |two )?(?:basic )?(?:land|forest|plains|island|swamp|mountain)/.test(t) || /put (?:a|up to \w+) land cards? from your hand onto the battlefield/.test(t) || /play an additional land|additional land on each/.test(t) || /create (?:a|two|three|\w+) (?:tapped )?treasure/.test(t)) r.add('ramp');
    if ((/\bdraws? (?:a|two|three|four|\w+|x|that many) cards?\b|\bdraw cards equal\b/.test(t) && !/each player draws|target player draws/.test(t)) || /(?:put|puts) (?:that card|one|those cards|it|them|one of them|a pile|one pile|the chosen pile|two of them|any number of [a-z ]+) (?:of them )?into your hand|\binvestigate\b/.test(t)) r.add('draw');
    // For permanents, only what happens when they enter counts as removal (an activated ability isn't a spell I can cast in response).
    const isPerm = !/\b(instant|sorcery)\b/.test(tl.split('//')[0]);
    const eff0 = t;
    const t2 = isPerm ? (t.match(/when [^.]*enters[^.]*\.[^.]*\.?/g) || []).join(' ') : t;
    if (isPerm) { const keep = t; t = t2; /* removal family on ETB text */ }
    if (/(?:destroy|exile) (?:up to \w+ )?(?:another )?target (?:creature|permanent|nonland permanent|artifact|enchantment|planeswalker|attacking|tapped|nonartifact|nonblack|creature or planeswalker|artifact or enchantment)/.test(t) ||
      /deals? (?:\d+|x) damage to (?:any target|target creature|target attacking)/.test(t) || /target creature (?:an opponent controls )?gets -\d+\/-\d+/.test(t) || /(?:destroy|exile) target/.test(t)) r.add('removal');
    if (/return target (?:creature|nonland permanent|permanent|artifact|enchantment)[^.]*to (?:its|their) owner'?s? hand/.test(t)) { r.add('bounce'); r.add('removal'); }
    if (/(?:target|each) (?:opponent|player) sacrifices (?:a|an) (?:creature|attacking)/.test(t)) r.add('edict');
    if (/(?:destroy|exile) all (?:other )?(?:creatures|nonland permanents|permanents|nontoken creatures|artifacts|enchantments|attacking creatures)|deals? (?:\d+|x) damage to each creature|all creatures get -|each creature gets -|return all (?:nonland permanents|creatures|attacking creatures)|each player sacrifices (?:all|the rest|.*creatures)/.test(t) && !/you control get|creatures you control\b(?! and)/.test(t.split('.')[0] || '')) r.add('wipe');
    if (/^(?:.*\n)?(?:[^\n]*)\bcounter target (?:[a-z ]+ )?spell|counter target (?:activated|triggered)/.test(t)) r.add('counter');
    if ((/(?:gains?|have|has) (?:hexproof|indestructible|protection|shroud)/.test(t) || /phase out|teferi's protection|heroic intervention/.test(t)) && !/creature$/.test(tl) && !isLandCard) r.add('protection');
    t = eff0;
    if (/search your library for (?:a|an|up to \w+|two)? ?(?:card|creature|artifact|enchantment|instant|sorcery|planeswalker|legendary|[a-z]+ card)/.test(t) && !/\bland\b|forest|plains|island|swamp|mountain/.test(t.match(/search your library for[^.,]*/)?.[0] || '')) r.add('tutor');
    if (/return (?:target |a |up to \w+ |another )?[^.]*card[^.]* from your graveyard|from your graveyard (?:to|onto)|you may cast [^.]*from your graveyard/.test(t)) r.add('recursion');
    if (/\bcreate\b[^.]*\btokens?\b/.test(t)) r.add('token');
    if (/creatures you control get \+|other [a-z]+s? you control get \+|creatures you control have/.test(t)) r.add('anthem');
    if (/(?:^|\n)sacrifice (?:a|another) (?:creature|permanent|artifact|token)[^:]*:/.test(t)) r.add('sacOutlet');
    if (/whenever [^.]*dies[^.]*(?:loses? \d+ life|deals? \d+ damage|drain)/.test(t) || /whenever [^.]*(?:dies|you sacrifice)[^.]*each opponent loses/.test(t)) r.add('deathDrain');
    if (/each opponent loses \d+ life|deals \d+ damage to each opponent/.test(t)) r.add('drain');
    if (/\b(?:flying|menace|can't be blocked|shadow|horsemanship)\b/.test(t)) r.add('evasion');
    if (/\btoxic \d|\binfect\b|poison counter|proliferate/.test(t)) r.add('poison');
    if (/\bequipment\b/.test(tl)) r.add('equipment');
    if (/\baura\b/.test(tl)) r.add(/enchanted creature (?:gets \+|has |gains |can't be blocked)/.test(t) ? 'aura' : /enchanted creature (?:gets -|can't attack|can't block|doesn't untap)|enchant creature an opponent/.test(t) ? 'removal' : 'aura');
    if (/prevent all combat damage/.test(t)) r.add('fog');
    if (/target creature (?:you control )?gets \+\d+\/\+\d+/.test(t) && r.has('instant') && !r.has('creature')) r.add('trick');
    if (/creatures you control get \+\d+\/\+\d+ (?:and gain trample )?until end of turn|extra combat|additional combat/.test(t)) r.add('finisher');
    if (/\bvehicle\b/.test(tl)) r.add('vehicle');
    if (/\bcopy target (?:instant|sorcery|spell)/.test(t)) r.add('copy');
    ROLE_CACHE.set(key, r);
    return r;
  }
  Brain.roles = roles;
  const nameOfCard = c => (c && c.d ? (c.d.n || '').split(' // ')[0] : '');
  const fullName = c => (c && c.d ? c.d.n || '' : '');
  P.isKey = function (c) { const n = nameOfCard(c), f = fullName(c), p = this.profile; return p.key.includes(n) || p.key.includes(f); };
  P.isProtect = function (c) { const n = nameOfCard(c), f = fullName(c), p = this.profile; return p.protect.includes(n) || p.protect.includes(f) || (c.cmdr && c.owner === this.me && p.cmdrRole === 'engine'); };
  P.isFinisher = function (c) { const n = nameOfCard(c), f = fullName(c); return this.profile.finishers.includes(n) || this.profile.finishers.includes(f); };

  // ======================= the state seen from my seat =======================
  // view: { s, me, hand:[{id,d,cmdr}], lib:[{d}] (unordered), level }
  P.load = function (view) {
    this.s = view.s; this.view = view;
    if (this.s && this.s.gameId !== this.gameId) { this.gameId = this.s.gameId; this.seen = {}; this.reads = {}; this.plan = null; this.sig = ''; this.turnPlans = {}; this.note('game', `new game — I play ${this.profile.cmdr || 'my deck'} (${this.profile.arch.join(', ')}), level ${this.level}`); }
  };
  P.cards = function (f) { return Object.values(this.s.cards).filter(f); };
  P.bf = function (pid) { return this.cards(c => c.zone === 'battlefield' && c.ctrl === pid); };
  P.isCre = function (c) { return c.faceDown || R().isType(c, 'creature'); };
  P.creatures = function (pid) { return this.bf(pid).filter(c => this.isCre(c)); };
  P.opps = function () { const s = this.s; return s.seats.filter(p => p !== this.me && s.players[p] && R().alive(s, p)); };
  P.pt = function (c) { return C().pt(this.s, c) || [0, 0]; };
  P.kw = function (c) { return C().keywords(c, this.s); };
  P.handCards = function () { return this.view.hand.map(c => Object.assign({ zone: 'hand', counters: {}, face: 0, owner: this.me, ctrl: this.me }, c)); };
  P.cmdZone = function () { return this.cards(c => c.zone === 'command' && c.cmdr && c.owner === this.me); };
  P.myCommanders = function () { return this.cards(c => c.cmdr && c.owner === this.me); };
  P.life = function (pid) { return (this.s.players[pid] || {}).life || 0; };

  // A card's worth on the battlefield (for trades, removal targets, sacrifice choices).
  P.value = function (c) {
    if (!c) return 0;
    let v = (c.d && +c.d.cmc) || 0;
    if (this.isCre(c)) { const [p, t] = this.pt(c); v += p * 1.2 + t * 0.6; const k = this.kw(c); for (const x of ['flying', 'deathtouch', 'lifelink', 'double strike', 'first strike', 'trample', 'hexproof', 'indestructible', 'menace', 'vigilance']) if (k.has(x)) v += 1; }
    if (R().isType(c, 'planeswalker')) v += 4 + ((c.counters || {}).loyalty || 0);
    if (c.cmdr) v += 4;
    if (R().isType(c, 'land')) v -= 1.5;
    if (c.token && !this.isCre(c)) v -= 1;
    if (c.ctrl === this.me || c.owner === this.me) { if (this.isKey(c)) v += 3; if (this.isProtect(c)) v += 3; }
    else { const rd = this.reads[c.ctrl]; if (rd && rd.kill.has(nameOfCard(c))) v += 4; if (rd && rd.engines.has(c.id)) v += 3; }
    return v;
  };

  // ======================= opponents =======================
  // Read an opponent's commander: known ready-made deck → its saved profile; otherwise infer from the text.
  P.readOpp = function (pid) {
    const s = this.s;
    const cm = this.cards(c => c.cmdr && c.owner === pid);
    const names = cm.map(nameOfCard).filter(Boolean);
    let prof = null;
    for (const c of cm) { prof = byCmdr(fullName(c)) || byCmdr(nameOfCard(c)); if (prof) break; }
    let arch = prof ? prof.arch.slice() : [];
    if (!prof) for (const c of cm) arch.push(...inferArch(c));
    arch = uniq(arch.length ? arch : ['value']);
    const kill = new Set(prof ? prof.vs.kill || [] : names);
    names.forEach(n => { const p = prof && prof.cmdrRole; if (!prof || p === 'engine' || p === 'threat') kill.add(n); });
    // Engines on their battlefield right now: permanents with triggered abilities that feed their plan.
    const engines = new Set();
    for (const c of this.bf(pid)) {
      if (c.faceDown || R().isType(c, 'land')) continue;
      const rl = roles(c);
      if (c.cmdr || kill.has(nameOfCard(c)) || rl.has('deathDrain') || rl.has('anthem') || (rl.has('token') && !R().isType(c, 'instant')) || (prof && prof.key.includes(nameOfCard(c)))) engines.add(c.id);
    }
    const counter = prof ? (prof.vs.counter || []) : arch.includes('spellslinger') ? ['instant'] : ['commander'];
    const hate = prof ? (prof.vs.hate || []) : archHate(arch);
    const read = { pid, cmdr: names, prof: prof ? prof.id : null, arch, kill, engines, counter, hate, wipeAt: prof ? prof.vs.wipeAt : 4, note: prof ? prof.vs.note : (ARCH()[arch[0]] || {}).counter || '' };
    // Combos of theirs that are close: all but one piece on the battlefield.
    read.comboNear = [];
    for (const k of (prof ? prof.combos || [] : [])) {
      if (k.kind !== 'infinite') continue;
      const onBf = k.cards.filter(n => this.bf(pid).some(c => nameOfCard(c) === n || fullName(c) === n));
      if (onBf.length >= k.cards.length - 1) read.comboNear.push({ cards: k.cards, have: onBf, note: k.note, missing: k.cards.filter(n => !onBf.includes(n)) });
    }
    this.reads[pid] = read;
    return read;
  };
  function inferArch(c) {
    const t = low(C().text(c)), tl = low(R().typeLine(c)), out = [];
    if (/sacrifice (?:a|another)|whenever (?:a|another) creature (?:you control )?dies/.test(t)) out.push('aristocrats');
    if (/create [^.]*tokens?/.test(t)) out.push('tokens');
    if (/\bequip|equipped|aura|enchanted creature/.test(t)) out.push('voltron');
    if (/whenever you cast (?:an? )?(?:instant|sorcery|noncreature)/.test(t)) out.push('spellslinger');
    if (/graveyard/.test(t)) out.push('graveyard');
    if (/landfall|whenever a land|additional land/.test(t)) out.push('landfall');
    if (/\+1\/\+1 counter/.test(t)) out.push('counters');
    if (/toxic|infect|poison|proliferate/.test(t)) out.push('poison');
    if (/whenever [^.]*attacks/.test(t)) out.push('attackTriggers');
    if (/ninjutsu/.test(t)) out.push('ninjas');
    if (/enchantment/.test(t)) out.push('enchantress');
    if (/artifact/.test(t)) out.push('artifacts');
    if (/vehicle|crew/.test(t)) out.push('vehicles');
    if (/flying/.test(t) && /dragon|angel/.test(tl)) out.push('flyers');
    if (/exile the top card[^.]*you may (?:play|cast)/.test(t)) out.push('impulse');
    if (/treasure/.test(t)) out.push('treasure');
    if (/additional combat/.test(t)) out.push('extraCombat');
    if (/put [^.]*creature card[^.]*onto the battlefield/.test(t)) out.push('cheat');
    if (/life/.test(t) && /gain/.test(t)) out.push('lifegain');
    if (/cascade/.test(t)) out.push('cascade');
    if (/enters|blink|exile [^.]*return/.test(t)) out.push('blink');
    const sub = (tl.split(/[—-]/)[1] || '').trim().split(/\s+/)[0];
    if (sub && new RegExp('\\b' + sub + 's?\\b').test(t.replace(low(nameOfCard(c)), ''))) out.push('tribal');
    if (!out.length) out.push(C().pt(null, c) ? 'combat-big' : 'value');
    return out;
  }
  function archHate(arch) {
    const m = { graveyard: 'graveyard', lands: 'graveyard', aristocrats: 'graveyard', enchantress: 'enchantments', vehicles: 'artifacts', artifacts: 'artifacts', tokens: 'tokens', flyers: 'flyers', treasure: 'artifacts' };
    return uniq(arch.map(a => m[a]).filter(Boolean));
  }
  P.oppMana = function (pid) {
    return this.bf(pid).filter(c => !c.tapped && C().manaSource(c) && !(this.isCre(c) && R().sick(this.s, c))).reduce((a, c) => a + ((C().manaSource(c) || {}).amount || 1), 0);
  };
  P.oppColors = function (pid) {
    const set = new Set();
    for (const c of this.bf(pid)) { const m = C().manaSource(c); if (m && m.colors) for (const x of m.colors) set.add(x); }
    return set;
  };
  // How much this opponent threatens MY plan (no grudges: only what their cards and board do).
  P.threat = function (pid) {
    const s = this.s, rd = this.reads[pid] || this.readOpp(pid);
    const Pl = s.players[pid];
    const cre = this.creatures(pid);
    const power = sum(cre, c => this.pt(c)[0]);
    const evasive = sum(cre.filter(c => { const k = this.kw(c); return k.has('flying') || k.has('menace') || k.has('trample'); }), c => this.pt(c)[0]);
    const myLife = this.life(this.me);
    const clockOnMe = power > 0 ? myLife / Math.max(1, power * 0.6 + evasive * 0.4) : 20;
    // How close they are to winning (against anyone).
    const minOppLife = Math.min(...s.seats.filter(p => p !== pid && R().alive(s, p)).map(p => this.life(p)));
    const nearWin = (power + evasive) / Math.max(1, minOppLife) + (Pl.poison ? 0 : 0) + rd.comboNear.length * 1.5 + rd.engines.size * 0.25;
    // Interference with my plan: their deck fights my archetype.
    let interfere = 0;
    const mine = this.profile.arch;
    const seen = Object.values(this.seen[pid] || {});
    const seenRoles = seen.map(n => n.roles || []).flat();
    const cols = this.oppColors(pid);
    if (mine.some(a => ['tokens', 'combat-wide', 'tribal', 'aristocrats', 'flyers', 'counters', 'poison'].includes(a))) interfere += seenRoles.filter(x => x === 'wipe').length * 1.2 + (cols.has('W') || cols.has('B') ? 0.6 : 0);
    if (mine.some(a => ['graveyard', 'lands', 'aristocrats'].includes(a))) interfere += seen.filter(n => /bojuka bog|rest in peace|leyline of the void|relic of progenitus|scavenger grounds/i.test(n.name)).length * 2;
    if (mine.some(a => ['spellslinger', 'combo', 'control'].includes(a))) interfere += cols.has('U') ? 1 : 0;
    if (mine.includes('flyers')) interfere += sum(cre.filter(c => this.kw(c).has('flying') || this.kw(c).has('reach')), () => 0.4);
    if (mine.includes('voltron')) interfere += seenRoles.filter(x => x === 'edict' || x === 'removal').length * 0.5;
    interfere += seenRoles.filter(x => x === 'counter').length * 0.6 + seenRoles.filter(x => x === 'removal').length * 0.3;
    // My commander's damage dealt to them doesn't matter; their commander damage to me does.
    const me = s.players[this.me];
    const cmdHit = Math.max(0, ...Object.entries(me.cmdDmg || {}).filter(([id]) => (s.cards[id] || {}).owner === pid).map(([, v]) => v));
    const handSize = Pl.handCount || 0;
    const score = 3 * nearWin + 2 * interfere + 6 / Math.max(1, clockOnMe) + rd.engines.size * 0.8 + handSize * 0.25 + this.oppMana(pid) * 0.1 + cmdHit / 6 + Math.max(0, (40 - Pl.life) * -0.02);
    return { pid, score, nearWin, interfere, clockOnMe, power, evasive, engines: rd.engines.size, comboNear: rd.comboNear };
  };
  // Opponents' public cards: remembered for this game.
  P.observe = function () {
    for (const c of Object.values(this.s.cards)) {
      if (c.owner === this.me || !c.d || c.faceDown || c.token) continue;
      if (!['battlefield', 'graveyard', 'exile', 'stack', 'command'].includes(c.zone)) continue;
      const m = (this.seen[c.owner] = this.seen[c.owner] || {});
      if (!m[c.id]) m[c.id] = { name: fullName(c), roles: [...roles(c)] };
    }
  };

  // ======================= mana =======================
  P.sources = function (pid) {
    pid = pid || this.me;
    const out = [], Cd = C(), s = this.s;
    for (const c of this.bf(pid)) {
      if (c.tapped) continue;
      const m = Cd.manaSource(c);
      if (!m || m.sac) continue;
      if (this.isCre(c) && R().sick(s, c) && !this.kw(c).has('haste')) continue;
      let colors = m.colors;
      if (/commander's color identity/i.test(Cd.text(c))) { const ci = this.identity(); if (ci) colors = ci; }
      const only = (low(Cd.text(c)).match(/spend this mana only to cast (?:an? )?([a-z ]+?) spells?/) || [])[1] || null;
      out.push({ id: c.id, amount: m.amount, colors, units: m.units, name: R().cardName(c), filter: m.filter, only, rank: R().isType(c, 'land') ? 0 : this.isCre(c) ? 2 : 1 });
    }
    return out.sort((a, b) => a.rank - b.rank);
  };
  // Pay with lands first, then rocks, creatures last (so they can still attack); restricted mana only for its spells.
  P.payFor = function (cost, srcs, x, card) {
    const ok = srcs.filter(s0 => !s0.only || (card && C().matchesWhat(card, s0.only)));
    return C().pay(cost, ok.slice().sort((a, b) => (a.rank || 0) - (b.rank || 0)), x);
  };
  P.identity = function () {
    const set = new Set();
    for (const c of this.myCommanders()) for (const x of (c.d && (c.d.ci || c.d.col)) || C().colorsOf(c)) set.add(x);
    return [...set].filter(x => 'WUBRG'.includes(x)).join('');
  };
  // A Signet needs one mana fed in to make two: it only adds one more, and nothing on its own.
  P.manaNow = function (srcs) { const l = srcs || this.sources(); const plain = sum(l.filter(x => !x.filter), x => x.amount); return plain + (plain > 0 ? l.filter(x => x.filter).length : 0); };
  P.costOf = function (c) {
    const cost = C().costOf(c);
    if (c.zone === 'command' && c.cmdr) cost.g += 2 * ((this.s.tax || {})[c.id] || 0);
    if (C().costReduction) cost.g = Math.max(0, cost.g - C().costReduction(this.s, c, this.me));
    if (C().freeWithCommander && C().freeWithCommander(this.s, c, this.me)) return C().parseCost('');
    return cost;
  };
  P.mv = function (c) { return C().costTotal(this.costOf(c), 0); };

  // ======================= targets =======================
  const HARM = new Set(['dmg', 'destroy', 'exile', 'bounce', 'tap', 'counter', 'discard', 'sacrifice', 'mill']);
  const HELP = new Set(['pump', 'grant', 'counters', 'untap', 'gyToHand', 'reanimate']);
  P.intentFor = function (card, eff, i) {
    const es = eff.effects.filter(e => e.ti === i || e.ti2 === i || e.forTargetCtrl === i || (e.tis && e.tis.includes(i)));
    if (es.some(e => e.k === 'bite' || e.k === 'fight')) return es.some(e => e.ti === i) ? 'mine-fighter' : 'theirs';
    if (es.some(e => e.k === 'draw') && es.some(e => e.k === 'life' && e.sign < 0) && !es.some(e => HARM.has(e.k))) return this.life(this.me) > 8 ? 'me' : 'theirs';
    if (es.some(e => e.k === 'life' && e.sign < 0) || es.some(e => HARM.has(e.k))) return 'theirs';
    if (es.some(e => e.k === 'pump' && (/^-/.test(String(e.t)) || (/^-/.test(String(e.p)) && !/^\+/.test(String(e.t)))))) return 'theirs';
    if (es.some(e => e.k === 'draw' || (e.k === 'life' && e.sign > 0))) return 'me';
    if (es.some(e => HELP.has(e.k) || e.k === 'attachSrc')) return 'mine';
    const t = low(C().text(card));
    if (/enchanted creature (?:can't|doesn't|gets -|loses)|enchanted permanent (?:can't|doesn't|loses)|you control enchanted/.test(t)) return 'theirs';
    // Auras that help whoever controls what they enchant (Wild Growth, Underworld Connections, ramp auras, pump auras).
    if (/enchanted (?:creature|land|permanent|artifact) (?:gets [+]|has |gains )|whenever enchanted land is tapped for mana|enchanted land is every basic land type/.test(t)) return 'mine';
    return 'theirs';
  };
  // A target's importance: a player close to losing or a permanent that matters to the top threat.
  P.targetScore = function (t) {
    const s = this.s;
    if (t.p) { const th = this.threatOf(t.p); const l = this.life(t.p); return 10 - l / 8 + th * 0.5 + (t.p !== this.me && l <= 3 ? 12 : 0); }
    const c = s.cards[t.c]; if (!c) return 0;
    let v = this.value(c);
    if (c.ctrl !== this.me) v *= 1 + Math.min(1, this.threatOf(c.ctrl) / 10);
    return v;
  };
  P.threatOf = function (pid) { const th = (this.threats || []).find(x => x.pid === pid); return th ? th.score : 0; };
  // Targets for a spell/ability from hand (same rules as the table: ward, protection, legality).
  P.chooseTargets = function (card, mode, eff, extra) {
    const Cd = C(), Rr = R(), s = this.s, me = this.me;
    extra = extra || {};
    const reqs = extra.reqs || Cd.targetReqs(card, mode);
    if (!reqs.length) return { tg: [], reqs, desc: [] };
    const tg = [], desc = [], taken = new Set();
    for (let i = 0; i < reqs.length; i++) {
      const req = reqs[i];
      let choices = (extra.choices && extra.choices[i]) || Cd.targetChoices(s, req, me);
      choices = choices.filter(t => !taken.has(t.c || t.p))
        .filter(t => t.p ? Rr.alive(s, t.p) : !(s.cards[t.c] && s.cards[t.c].zone === 'battlefield' && !Rr.alive(s, s.cards[t.c].ctrl)))
        .filter(t => !t.c || !s.cards[t.c] || !Cd.protectedFrom(s.cards[t.c], card, s))
        .filter(t => {
          const c = t.c && s.cards[t.c]; if (!c || c.ctrl === me || !this.kw(c).has('ward')) return true;
          if (extra.noWard) return false;
          const k = Cd.wardCost(c); if (!k || k.discard || k.sac) return false;
          if (k.life && this.life(me) <= k.life + 8) return false;
          return this.manaNow() >= Cd.costTotal(Cd.costOf(card), 0) + k.mana;
        });
      let intent = extra.intent ? extra.intent[i] : this.intentFor(card, eff, i);
      // The requirement itself can settle it: "…you control" is mine, "…an opponent controls" is theirs.
      if (!extra.intent && req.ctrl === 'you' && intent === 'theirs') intent = 'mine';
      if (!extra.intent && req.ctrl === 'opp' && intent !== 'theirs') intent = 'theirs';
      const e = eff.effects.find(x => x.ti === i);
      const dmg = e && e.k === 'dmg' ? (e.n === 'X' ? extra.x || 0 : +e.n || 0) : 0;
      let pick = null;
      if (intent === 'theirs') {
        choices = choices.filter(t => t.p ? t.p !== me : s.cards[t.c] && ((s.cards[t.c].ctrl !== me && s.cards[t.c].owner !== me) || (s.cards[t.c].zone === 'graveyard' && s.cards[t.c].owner !== me) || s.cards[t.c].zone === 'stack' && s.cards[t.c].ctrl !== me));
        if (dmg) {
          const killable = choices.filter(t => t.c && this.isCre(s.cards[t.c]) && this.pt(s.cards[t.c])[1] - (s.cards[t.c].dmg || 0) <= dmg && !this.kw(s.cards[t.c]).has('indestructible'));
          const pws = choices.filter(t => t.c && Rr.isType(s.cards[t.c], 'planeswalker') && ((s.cards[t.c].counters || {}).loyalty || 0) <= dmg);
          const players = choices.filter(t => t.p);
          const bestKill = killable.concat(pws).sort((a, b) => this.targetScore(b) - this.targetScore(a))[0];
          const lethal = players.filter(t => this.life(t.p) <= dmg).sort((a, b) => this.life(a.p) - this.life(b.p))[0];
          if (lethal) pick = lethal;
          else if (bestKill && (this.targetScore(bestKill) >= 3 || !players.length)) pick = bestKill;
          else if (players.length) pick = players.sort((a, b) => this.targetScore(b) - this.targetScore(a))[0];
          else pick = bestKill || null;
        } else {
          const sorted = choices.slice().sort((a, b) => this.targetScore(b) - this.targetScore(a));
          pick = sorted[0] || null;
          if (pick && pick.c && e && ['destroy', 'exile'].includes(e.k) && this.targetScore(pick) < (extra.minValue != null ? extra.minValue : 2.5)) pick = null;   // don't waste removal on a 1/1
        }
      } else if (intent === 'me') {
        pick = choices.find(t => t.p === me) || null;
      } else if (e && e.k === 'reanimate') {
        pick = choices.filter(t => t.c && this.isCre(s.cards[t.c])).sort((a, b) => this.value(s.cards[b.c]) - this.value(s.cards[a.c]))[0] || null;
      } else {
        choices = choices.filter(t => t.p ? t.p === me : s.cards[t.c] && (s.cards[t.c].ctrl === me || (s.cards[t.c].zone === 'graveyard' && s.cards[t.c].owner === me)));
        if (intent === 'mine-fighter') choices = choices.filter(t => t.c && this.isCre(s.cards[t.c]));
        pick = choices.sort((a, b) => (intent === 'mine-fighter' ? this.pt(s.cards[b.c])[0] - this.pt(s.cards[a.c])[0] : this.value(s.cards[b.c]) - this.value(s.cards[a.c])))[0] || null;
        if (pick && extra.protect && !extra.protect.includes(pick.c)) { const pr = choices.find(t => extra.protect.includes(t.c)); if (pr) pick = pr; }
        if (pick && extra.voltron) { const v = choices.find(t => t.c === extra.voltron); if (v) pick = v; }
      }
      if (!pick) { if (req.upTo) { tg.push([]); desc.push(''); continue; } return null; }
      taken.add(pick.c || pick.p);
      const group = [pick];
      if (req.n > 1 && req.n < 99) {
        const more = choices.filter(t => !taken.has(t.c || t.p) && (intent === 'theirs' ? (t.p ? t.p !== me : s.cards[t.c] && s.cards[t.c].ctrl !== me) : true)).sort((a, b) => this.targetScore(b) - this.targetScore(a)).slice(0, req.n - 1);
        if (more.length < req.n - 1 && !req.upTo) return null;
        for (const m of more) { taken.add(m.c || m.p); group.push(m); }
      }
      tg.push(group);
      desc.push(pick.p ? (pick.p === me ? 'myself' : Rr.nameOf(s, pick.p)) : (s.cards[pick.c].ctrl !== me ? Rr.nameOf(s, s.cards[pick.c].ctrl) + '’s ' : 'my ') + Rr.cardName(s.cards[pick.c]));
    }
    const bite = eff.effects.find(e => e.k === 'bite' || e.k === 'fight');
    if (bite && tg[bite.ti] && tg[bite.ti2] && tg[bite.ti][0] && tg[bite.ti2][0] && tg[bite.ti2][0].c) {
      const a = s.cards[tg[bite.ti][0].c], b = s.cards[tg[bite.ti2][0].c];
      if (a && b && this.pt(a)[0] < this.pt(b)[1] - (b.dmg || 0) && !this.kw(a).has('deathtouch')) return null;
    }
    return { tg, reqs, desc };
  };

  // ======================= what a card would do if cast now =======================
  // Returns a castable option with a score, or null. when: 'main' (my main phase, empty stack) | 'instant'.
  P.option = function (card, when, extra) {
    const o = this.option0(card, when, extra);
    const m = extra && (extra.counterTarget || extra.noMutate) ? null : this.mutateOption(card, when, extra);
    return m && (!o || m.score > o.score) ? m : o;
  };
  P.option0 = function (card, when, extra) {
    const Cd = C(), Rr = R(), s = this.s;
    extra = extra || {};
    if (Rr.isType(card, 'land')) return null;
    if (when === 'instant' && !Cd.instantSpeed(card)) return null;
    const rl = roles(card);
    const mode = this.modeFor(card);
    if (mode === undefined) return null;
    const eff = Cd.effectsOf(card, mode);
    const perm = Cd.isPermanentCard(card);
    // Spells: only ones the table can carry out (the old effects model or the v6 engine).
    let understood = eff.understood && eff.effects.length;
    if (!perm && !understood && root.Engine && root.Engine.spellOps) { const so = root.Engine.spellOps(s, Object.assign({}, card, { mode })); if (so && so.understood && so.ops.length) understood = true; }
    if (!perm && !understood && !rl.has('counter') && !rl.has('wipe') && !rl.has('draw')) return null;
    if (!perm && rl.has('counter') && !extra.counterTarget) return null;   // counterspells only as responses
    // Auras that need a graveyard target, and graveyard tricks: left alone.
    if (perm && /aura/i.test(Rr.typeLine(card)) && Cd.targetReqs(card, mode).some(r => r.gy || /graveyard/.test(r.text || ''))) return null;
    const cost = this.costOf(card);
    { const sp = Cd.spreeCost && mode ? Cd.spreeCost(card, mode) : null; if (sp) for (const k of ['g', 'W', 'U', 'B', 'R', 'G', 'C']) cost[k] += sp[k] || 0; }
    const srcs = extra.sources || this.sources();
    // Additional sacrifice cost: the least useful permanent of that kind (never the commander or a key card).
    let sacCost;
    const sc = Cd.sacCost && Cd.sacCost(card);
    if (sc) {
      const fod = this.bf(this.me).filter(c => Cd.matchesWhat(c, sc) && !c.cmdr && !this.isKey(c) && !(R().isType(c, 'land') && this.bf(this.me).filter(x => R().isType(x, 'land')).length <= 4));
      const f = this.worstPermanents(fod, 1)[0];
      if (!f || (!f.token && this.value(f) > 6 && !this.profile.arch.includes('aristocrats'))) return null;
      sacCost = [f.id];
    }
    let x = 0;
    if (cost.x) { x = Math.max(0, Math.floor((this.manaNow(srcs) - Cd.costTotal(cost, 0)) / cost.x)); if (x < 1) return null; }
    // "As an additional cost to cast this spell, pay X life" (Toxic Deluge): enough to kill what matters, never below 8 life.
    if (!cost.x && /as an additional cost to cast this spell, pay x life/i.test(Cd.text(card))) {
      const tough = this.opps().flatMap(p => this.creatures(p)).map(c => this.pt(c)[1]).sort((a, b) => b - a);
      x = Math.min(tough[0] || 0, this.life(this.me) - 8);
      if (x < 1) return null;
    }
    let pay = this.payFor(cost, srcs, x, card);
    if (!pay) return null;
    let t;
    if (extra.counterTarget) {
      const reqs = Cd.targetReqs(card, mode);
      if (!reqs[0] || !Cd.legalTarget(s, reqs[0], { c: extra.counterTarget }, this.me)) return null;
      t = { tg: [[{ c: extra.counterTarget }]], reqs, desc: [Rr.cardName(s.cards[extra.counterTarget])] };
      for (let i = 1; i < reqs.length; i++) { const tt = this.chooseTargets(card, mode, eff, { reqs: [reqs[i]], x }); if (!tt) return null; t.tg.push(tt.tg[0]); }
    } else {
      t = this.chooseTargets(card, mode, eff, Object.assign({ x }, extra));
      if (!t) return null;
    }
    const wardMana = t.tg.flat().reduce((a, q) => { const c = q.c && s.cards[q.c]; if (!c || c.ctrl === this.me || !this.kw(c).has('ward')) return a; const k = Cd.wardCost(c); return a + (k ? k.mana : 0); }, 0);
    if (wardMana) { pay = this.payFor(Object.assign({}, cost, { g: cost.g + wardMana, hy: cost.hy.slice(), ph: cost.ph.slice() }), srcs, x, card); if (!pay) return null; }
    if (this.selfHarm(eff, x, card) >= this.life(this.me) - 3) return null;
    const mana = Cd.costTotal(cost, x) + wardMana;
    const o = { card, id: card.id, name: Rr.cardName(card), mode, eff, x, pay, tg: t.tg, reqs: t.reqs, desc: t.desc, cost, mana, roles: rl, perm, when,
      wardPaid: t.tg.flat().some(q => q.c && s.cards[q.c] && s.cards[q.c].ctrl !== this.me && this.kw(s.cards[q.c]).has('ward')), from: card.zone, sacCost };
    if (sacCost && t.tg.flat().some(q => q.c === sacCost[0])) return null;
    o.score = this.scoreOption(o);
    if (sacCost) { const f = s.cards[sacCost[0]]; o.score -= f ? this.value(f) * (this.profile.arch.includes('aristocrats') ? 0.2 : 0.6) : 0; o.desc = o.desc.concat(['sacrificing ' + (f ? Rr.cardName(f) : '?')]); }
    return o;
  };
  // Mutate (702.140): cast it for its mutate cost onto a non-Human creature I own — it keeps every ability and fires
  // "whenever this creature mutates"; the merged creature can attack now if the host could.
  P.mutateOption = function (card, when, extra) {
    const Cd = C(), Rr = R(), s = this.s, O = root.Oracle;
    if (!O || !card.d || !Rr.isType(card, 'creature')) return null;
    if (when === 'instant' && !Cd.instantSpeed(card)) return null;
    let M; try { M = O.model(card); } catch (e) { return null; }
    const k = M && M.costs.find(x => x.kind === 'mutate'); if (!k) return null;
    if (card.zone !== 'hand' && !(card.zone === 'command' && card.cmdr)) return null;
    const req = Cd.targetReqs(card, null, 'mutate')[0];
    const hosts = Cd.targetChoices(s, req, this.me).map(t => s.cards[t.c]).filter(h => h && h.zone === 'battlefield' && !Cd.protectedFrom(h, card, s));
    if (!hosts.length) return null;
    const cost = Cd.parseCost((String(k.cost || '').match(/\{[^}]+\}/g) || []).join(''));
    if (card.zone === 'command' && card.cmdr) cost.g += 2 * ((s.tax || {})[card.id] || 0);
    cost.g = Math.max(0, cost.g - Cd.costReduction(s, card, this.me));
    const srcs = (extra && extra.sources) || this.sources();
    const pay = this.payFor(cost, srcs, 0, card); if (!pay) return null;
    const hostScore = h => (Rr.sick(s, h) && !this.kw(h).has('haste') ? 0 : 3) + this.value(h) * 0.3 + (this.kw(h).has('flying') || this.kw(h).has('trample') ? 1 : 0) - (h.tapped ? 0.5 : 0);
    const host = hosts.sort((a, b) => hostScore(b) - hostScore(a))[0];
    const eff = { effects: [], understood: true };
    const o = { card, id: card.id, name: Rr.cardName(card), mode: null, eff, x: 0, pay, tg: [[{ c: host.id }]], reqs: [req], desc: ['my ' + Rr.cardName(host)], cost, mana: Cd.costTotal(cost, 0), roles: roles(card), perm: true, when, wardPaid: false, from: card.zone, alt: 'mutate' };
    o.score = this.scoreOption(o);
    const trig = (Cd.text(card) + '\n' + Cd.text(host)).match(/whenever this creature mutates/gi);
    o.score += 1.5 + (trig ? trig.length * 2 : 0) + (hostScore(host) >= 3 ? 1.5 : 0);
    o.desc = ['mutate onto my ' + Rr.cardName(host)];
    return o;
  };
  // Why a card in hand isn't being cast (for the end-of-turn note in the plan log).
  P.whyNot = function (card) {
    const Cd = C(), Rr = R();
    if (Rr.isType(card, 'land')) return null;
    const mode = this.modeFor(card); if (mode === undefined) return 'no mode with a useful target';
    const eff = Cd.effectsOf(card, mode), perm = Cd.isPermanentCard(card), rl = roles(card);
    if (!perm && rl.has('counter')) return 'counterspell (kept for a response)';
    if (!perm && !(eff.understood && eff.effects.length)) { const so = root.Engine && root.Engine.spellOps ? root.Engine.spellOps(this.s, Object.assign({}, card, { mode })) : null; if (!(so && so.understood && so.ops.length) && !rl.has('wipe') && !rl.has('draw')) return 'the table can’t carry out its effect by itself'; }
    const cost = this.costOf(card); if (!this.payFor(cost, this.sources(), cost.x ? 1 : 0, card)) return `needs ${Cd.costTotal(cost, cost.x ? 1 : 0)} mana${cost.W || cost.U || cost.B || cost.R || cost.G ? ' (colors)' : ''} — have ${this.sources().map(x => x.name + ':' + x.colors + (x.only ? '(only ' + x.only + ')' : '') + (x.filter ? '(filter)' : '')).join(', ') || 'none'}`;
    const t = this.chooseTargets(card, mode, eff, {}); if (!t) return 'no good target';
    const o = this.option(card, 'main'); if (o && o.score <= 0) return o.wipe ? 'wipe not worth it: ' + o.wipe.reason : 'not worth it now';
    if (!o && Cd.instantSpeed(card)) return 'kept for instant speed';
    return o ? 'lower priority than other plays' : 'not castable now';
  };
  P.modeFor = function (card) {
    const Cd = C();
    const md = Cd.modesOf(card);
    if (!md) return null;
    const scored = md.modes.map((m, i) => ({ i, eff: Cd.effectsIn(m), text: m })).filter(x => x.eff.understood && x.eff.effects.length);
    if (!scored.length) return undefined;
    const most = C().modePick ? C().modePick(this.s, card, md, this.me) : md.pick;
    const pick = md.pick === 'many' ? 1 : Math.max(md.pick || 1, most > (md.pick || 1) ? most : 0);
    const val = x => { const t = low(x.text); let v = 0; if (/destroy|exile|damage|counter target/.test(t)) v += 3; if (/draw/.test(t)) v += 2; if (/create/.test(t)) v += 2; if (/\+1\/\+1|gets \+/.test(t)) v += 1; if (/gain \d+ life/.test(t)) v += 0.5; if (/return/.test(t)) v += 1; if (/each opponent/.test(t)) v += 1; if (/to each creature|each creature gets|destroy all creatures/.test(t)) { const mine = this.creatures(this.me).length, theirs = Math.max(0, ...this.opps().map(p => this.creatures(p).length)); v += theirs > mine + 1 ? 1 : -4; } return v; };
    scored.sort((a, b) => val(b) - val(a));
    const ok = [];
    for (const x of scored) {
      if (ok.length >= pick) break;
      const t = this.chooseTargets(card, [x.i], x.eff);
      if (t) ok.push(x.i);
    }
    // Confluences: the best mode again for the slots left.
    if (md.repeat) while (ok.length && ok.length < pick) ok.push(ok[0]);
    if (ok.length >= (md.pick === 'many' ? 1 : md.pick || 1) && ok.length <= pick) return ok.sort((a, b) => a - b);
    return undefined;
  };
  P.selfHarm = function (eff, x, card) {
    let n = card && /pay x life/i.test(C().text(card)) ? (x || 0) : 0;
    for (const e of eff.effects) {
      const v = e.n === 'X' ? (x || 0) : (+e.n || 0);
      if (e.k === 'dmg' && (e.to === 'eachPlayer' || e.to === 'you')) n += v;
      if (e.k === 'life' && e.sign < 0 && (e.who === 'you' || e.who === 'each player')) n += v;
    }
    return n;
  };
  // How much a play helps MY plan right now.
  P.scoreOption = function (o) {
    const s = this.s, rl = o.roles, card = o.card, prof = this.profile;
    const turn = s.turn.n, round = Math.ceil(turn / Math.max(1, s.seats.length));
    const lands = this.bf(this.me).filter(c => R().isType(c, 'land')).length;
    let v = (card.d && +card.d.cmc) || 0;
    if (o.perm && this.isCre(card)) v += 1.5 + (this.desperate() ? 3 + this.pt(card)[1] * 0.5 : 0);
    if (this.desperate() && (rl.has('removal') || rl.has('fog') || rl.has('wipe'))) v += 3;
    if (this.isKey(card)) v += o.perm || rl.has('draw') || rl.has('ramp') || rl.has('tutor') ? 4 : 0;
    if (this.isProtect(card)) v += 1.5;
    if (card.zone === 'exile' && card.mayPlay) v += 2.5;   // use it before it's gone
    if (card.cmdr) {
      const role = prof.cmdrRole || 'value';
      v += role === 'engine' ? 6 : role === 'threat' ? 4 : role === 'enabler' ? 4 : 2.5;
      if (round < (prof.cmdrTurn || 3)) v -= 1;
      const tax = (s.tax || {})[card.id] || 0;
      if (tax >= 2 && role !== 'engine') v -= tax;      // recast only when it's worth the tax
    }
    if (rl.has('ramp')) v += round <= 4 ? 4 : lands < 7 ? 1.5 : 0.2;
    if (rl.has('draw')) v += (this.view.hand.length <= 2 ? 3 : 1.2);
    if (rl.has('anthem') && this.creatures(this.me).length >= 3) v += 3;
    if (rl.has('token')) v += prof.arch.some(a => ['tokens', 'aristocrats', 'combat-wide'].includes(a)) ? 2 : 0.8;
    if (rl.has('sacOutlet') && prof.arch.includes('aristocrats')) v += 2.5;
    if (rl.has('deathDrain')) v += prof.arch.includes('aristocrats') ? 3 : 1;
    if (rl.has('equipment') || rl.has('aura')) v += prof.arch.includes('voltron') ? 2.5 : 0.5;
    if (this.isFinisher(card)) v += this.finishReady() ? 5 : -1;
    if (rl.has('tutor')) v += this.comboMissing() ? 3 : 1;
    // Removal: worth the threat it answers (to my plan).
    if ((rl.has('removal') || rl.has('bounce') || rl.has('edict')) && o.tg.some(l => l[0] && l[0].c)) {
      const best = Math.max(0, ...o.tg.flat().filter(q => q.c).map(q => this.targetScore(q) * (s.cards[q.c] && (s.cards[q.c].token ? 1 : rl.has('bounce') && !/destroy|exile/.test(low(C().text(card))) ? (s.cards[q.c].cmdr ? 0.35 : 0.45) : 1))));
      v += 1.5 + best * 0.6;
    }
    if (rl.has('wipe')) { const w = this.wipeCheck(card, o.x); v = w.good ? 6 + w.margin : -50; o.wipe = w; }
    // Combo piece: big bonus when it completes (or nearly completes) a combo the bracket allows.
    const cp = this.comboPiece(card); if (cp) v += cp.complete ? 30 : 3;
    // Don't overextend into a likely wipe: creatures past a healthy board are worth less if opponents can wipe.
    if (o.perm && this.isCre(card) && !card.cmdr && this.wipeRisk() > 0.5 && this.creatures(this.me).length >= 4 && !this.isKey(card)) v -= 2.5;
    return v;
  };
  // ---------------- combos (bracket-gated) ----------------
  P.allowedCombos = function () { return (this.profile.combos || []).filter(k => k.kind === 'engine' || this.bracket >= 3); };
  P.zoneOfName = function (n) {
    if (this.bf(this.me).some(c => nameOfCard(c) === n || fullName(c) === n)) return 'battlefield';
    if (this.view.hand.some(c => c.d && (c.d.n === n || c.d.n.split(' // ')[0] === n))) return 'hand';
    if (this.cmdZone().some(c => nameOfCard(c) === n)) return 'command';
    if (this.cards(c => c.zone === 'graveyard' && c.owner === this.me && (nameOfCard(c) === n || fullName(c) === n)).length) return 'graveyard';
    return 'library';
  };
  P.comboPiece = function (card) {
    const n = nameOfCard(card), f = fullName(card);
    for (const k of this.allowedCombos()) {
      if (!k.cards.includes(n) && !k.cards.includes(f)) continue;
      const others = k.cards.filter(x => x !== n && x !== f);
      const onBf = others.filter(x => this.zoneOfName(x) === 'battlefield');
      return { combo: k, complete: onBf.length === others.length, have: onBf.length, need: others.length };
    }
    return null;
  };
  P.comboMissing = function () {
    for (const k of this.allowedCombos()) { const z = k.cards.map(n => this.zoneOfName(n)); if (z.filter(x => x === 'library').length === 1) return k; }
    return null;
  };
  // Am I ready to finish (board wide/big enough that the finisher wins or nearly wins)?
  P.finishReady = function () {
    const my = this.creatures(this.me);
    const pw = sum(my, c => this.pt(c)[0]);
    const oppLife = Math.min(...this.opps().map(p => this.life(p)));
    return my.length >= 4 || pw >= oppLife * 0.6;
  };

  // ======================= board wipes =======================
  // All three tests: do I come out ahead, am I behind, and could I hold creatures back first.
  P.wipeCheck = function (card, x) {
    const t = low(C().text(card));
    const hitsAll = !/you don't control|your opponents control|nonblack|non-?\w+ creatures? you don't/.test(t);
    // How much it does: "deals 2 damage to each creature", "all creatures get -X/-X" (X chosen), or everything.
    const dm = t.match(/deals? (\d+|x) damage to each creature|(?:all|each) creatures? gets? -(\d+|x)\/-(?:\d+|x)/);
    const amt = dm ? ((dm[1] || dm[2]) === 'x' ? (x || 0) : +(dm[1] || dm[2])) : null;
    const shrink = dm && !!dm[2];
    const affected = c => this.isCre(c) && !(/creature tokens/.test(t) && !c.token) && (amt == null ? !this.kw(c).has('indestructible') : shrink ? this.pt(c)[1] <= amt : !this.kw(c).has('indestructible') && this.pt(c)[1] - (c.dmg || 0) <= amt);
    const mine = this.creatures(this.me).filter(affected);
    const myLoss = hitsAll ? sum(mine, c => this.value(c)) : 0;
    const per = this.opps().map(p => ({ p, loss: sum(this.creatures(p).filter(affected), c => this.value(c)), n: this.creatures(p).filter(affected).length }));
    const theirLoss = sum(per, x => x.loss), biggest = Math.max(0, ...per.map(x => x.loss));
    const ahead = theirLoss >= myLoss * 1.5 + 4;
    const myBoard = sum(this.creatures(this.me), c => this.value(c));
    const behind = biggest > myBoard * 1.5 && Math.min(...(this.threats || []).map(x => x.clockOnMe), 20) <= 3;
    const dying = this.incomingNext() >= this.life(this.me);
    const wipeAt = this.opps().some(p => { const rd = this.reads[p]; return rd && rd.wipeAt && this.creatures(p).length >= rd.wipeAt; });
    const sense = this.L.wipeSense;
    const good = (ahead && (theirLoss > 6 * sense || wipeAt)) || behind || dying || (wipeAt && theirLoss > myLoss);
    const reason = ahead ? `opponents lose ${theirLoss.toFixed(0)} worth of creatures, I lose ${myLoss.toFixed(0)}` : behind ? 'I am far behind on board' : dying ? 'I would die to the next attack' : wipeAt ? 'an opponent is wide enough that its deck wins from here' : `not worth it yet (they'd lose ${theirLoss.toFixed(0)}, I'd lose ${myLoss.toFixed(0)})`;
    return { good, margin: clamp((theirLoss - myLoss) / 4, 0, 8), reason, myLoss, theirLoss };
  };
  // Chance an opponent wipes the board soon: colors, seen wipes, profile.
  P.wipeRisk = function () {
    let r = 0;
    for (const p of this.opps()) {
      const cols = this.oppColors(p), rd = this.reads[p];
      const prof = rd && rd.prof && PROFILES()[rd.prof];
      if (prof && prof.wipes && prof.wipes.length) r = Math.max(r, 0.2 + 0.1 * prof.wipes.length);
      else if (cols.has('W') || cols.has('B') || cols.has('R')) r = Math.max(r, 0.35);
      const seenW = Object.values(this.seen[p] || {}).filter(x => x.roles.includes('wipe')).length;
      if (seenW) r = Math.max(r, 0.5 + 0.1 * seenW);
    }
    return clamp(r, 0, 0.9);
  };
  // Damage I could take on the next opponents' turns (each opponent's untapped-next-turn attackers).
  P.incomingNext = function () {
    let n = 0;
    for (const p of this.opps()) {
      const cre = this.creatures(p).filter(c => !this.kw(c).has('defender'));
      n += sum(cre, c => this.pt(c)[0]) * (this.opps().length > 1 ? 0.55 : 1);
    }
    const blockers = this.creatures(this.me).filter(c => !c.tapped).length;
    return Math.max(0, n - blockers * 1.5);
  };

  // ======================= win routes over the next 10 turns =======================
  P.routes = function () {
    const s = this.s, me = this.me, prof = this.profile;
    const opps = this.opps();
    const totalLife = sum(opps, p => this.life(p)), minLife = Math.min(...opps.map(p => this.life(p)));
    const my = this.creatures(me);
    const power = sum(my, c => this.pt(c)[0]);
    const evasive = sum(my.filter(c => { const k = this.kw(c); return k.has('flying') || k.has('menace') || k.has('trample') || k.has("can't be blocked"); }), c => this.pt(c)[0]);
    const handCre = this.handCards().filter(c => this.isCre(c) || roles(c).has('token'));
    const growth = Math.min(8, handCre.length * 2 + (prof.arch.includes('tokens') ? 2 : 0) + this.libShare(c => this.isCre(c)) * 2);
    const oppBlock = sum(opps, p => this.creatures(p).filter(c => !c.tapped).length);
    const out = [];
    const turnsFor = (perTurn, life) => perTurn <= 0 ? 99 : Math.ceil(life / perTurn);
    // Combat: what gets through blockers, growing as I cast more.
    const through = Math.max(0, evasive + Math.max(0, power - evasive) * Math.max(0.15, 1 - oppBlock / Math.max(1, my.length + 1)));
    for (const w of uniq(prof.win.concat(['combat-big']))) {
      let est = 99, why = '';
      if (w === 'combat-wide' || w === 'combat-big' || w === 'flyers') {
        let dmg = 0, life = totalLife, t = 0, pw = w === 'flyers' ? evasive : through;
        while (life > 0 && t < 12) { t++; pw += growth / 2; dmg = pw; life -= dmg; }
        est = t; why = `${pw.toFixed(0)} damage a turn gets through by turn ${t} (now ${(w === 'flyers' ? evasive : through).toFixed(0)})`;
      } else if (w === 'drain') {
        const eng = this.bf(me).filter(c => roles(c).has('deathDrain') || roles(c).has('drain')).length + (this.handCards().filter(c => roles(c).has('deathDrain') || roles(c).has('drain')).length * 0.6);
        const fodder = my.filter(c => c.token || this.value(c) < 4).length + (prof.arch.includes('tokens') ? 2 : 0);
        const per = eng * Math.max(1, fodder * 0.5) * (this.bf(me).some(c => nameOfCard(c) === 'Teysa Karlov') ? 2 : 1);
        est = turnsFor(per, minLife) + (eng ? 0 : 3); why = `${eng.toFixed(1)} drain engines, ~${per.toFixed(0)} life lost per opponent a turn`;
      } else if (w === 'poison') {
        const tox = my.filter(c => this.kw(c).has('infect') || /toxic/i.test(C().text(c)) || /rat/i.test(R().typeLine(c))).length;
        const minPoison = Math.min(...opps.map(p => 10 - ((s.players[p] || {}).poison || 0)));
        est = turnsFor(tox * 0.8 + growth * 0.2, minPoison); why = `${tox} poison attackers, ${minPoison} poison to go`;
      } else if (w === 'voltron' || w === 'cmdr-damage') {
        const cm = this.myCommanders().find(c => c.zone === 'battlefield') || my.sort((a, b) => this.pt(b)[0] - this.pt(a)[0])[0];
        const p = cm ? this.pt(cm)[0] + this.handCards().filter(c => roles(c).has('equipment') || roles(c).has('aura')).length * 2 : 0;
        est = turnsFor(p, w === 'cmdr-damage' ? 21 : minLife) + (cm ? 0 : 2) + opps.length - 1; why = cm ? `${R().cardName(cm)} hits for ~${p}` : 'no voltron body yet';
      } else if (w === 'combo') {
        let best = 99, bw = 'no combo pieces';
        for (const k of this.allowedCombos().filter(k => k.kind === 'infinite')) {
          const z = k.cards.map(n => this.zoneOfName(n));
          const missing = z.filter(x => x === 'library').length + z.filter(x => x === 'graveyard').length * 0.6;
          const inHand = z.filter(x => x === 'hand' || x === 'command').length;
          const tutors = this.handCards().filter(c => roles(c).has('tutor')).length;
          // Assembled already but nobody has won: the table can't run the loop by itself, so it isn't a win route.
          if (z.every(x => x === 'battlefield')) { if (best === 99) bw = `${k.cards.join(' + ')} is assembled, but the loop has to be finished by hand — playing for value`; continue; }
          const turns = Math.max(0, missing - tutors) * 4 + inHand * 0.8 + 1;
          if (turns < best) { best = Math.round(turns); bw = `${k.cards.join(' + ')} (${k.note}): ${k.cards.map((n, i) => n + ' in ' + z[i]).join(', ')}`; }
        }
        est = best; why = bw;
      } else if (w === 'burn') {
        const pingers = this.bf(me).filter(c => /deals? \d+ damage to (?:each opponent|any target|target)/.test(low(C().text(c)))).length;
        est = pingers ? turnsFor(pingers * 2 * Math.max(1, opps.length), totalLife) : 30; why = `${pingers} damage sources`;
      } else if (w === 'alt-win') {
        const dest = this.zoneOfName('Angel of Destiny');
        const need = 55 - this.life(me);
        est = dest === 'battlefield' ? Math.max(1, Math.ceil(need / 4)) : dest === 'hand' ? Math.max(2, Math.ceil(need / 4)) : 30; why = `Angel of Destiny in ${dest}, need ${Math.max(0, need)} more life`;
      }
      out.push({ route: w, turns: est, why });
    }
    // The deck's own win routes are preferred (it is built for them): a small handicap for the others.
    for (const r of out) { const i = prof.win.indexOf(r.route); r.score = r.turns + (i < 0 ? 2.5 : i * 0.75); }
    out.sort((a, b) => a.score - b.score);
    return out;
  };
  // Share of the unseen part of my deck that fits (odds for the next draws, without knowing the order).
  P.libShare = function (f) {
    const lib = this.view.lib || [];
    if (!lib.length) return 0;
    return lib.filter(c => f(Object.assign({ zone: 'library', counters: {}, face: 0 }, c))).length / lib.length;
  };
  // Mana I expect on each of the next N turns (lands in hand, ramp in hand, land odds per draw).
  P.manaCurve = function (n) {
    const now = this.bf(this.me).filter(c => C().manaSource(c)).reduce((a, c) => a + ((C().manaSource(c) || {}).amount || 1), 0);
    const landsInHand = this.view.hand.filter(c => /\bland\b/i.test(((c.d || {}).faces || [{}])[0].t || '')).length;
    const ramp = this.handCards().filter(c => roles(c).has('ramp') && !roles(c).has('land')).length;
    const pLand = this.libShare(c => /\bland\b/i.test(R().typeLine(c)));
    const extra = /additional land/i.test(this.myCommanders().map(c => C().text(c)).join(' ')) ? 1 : 0;
    const out = []; let m = now, lh = landsInHand, r = ramp;
    for (let i = 0; i < n; i++) { const play = lh >= 1 + extra ? 1 + extra : lh > 0 ? lh : pLand; lh = Math.max(0, lh - (1 + extra)) + pLand; m += play + (r > 0 ? 1 : 0); if (r > 0) r--; out.push(+m.toFixed(1)); }
    return out;
  };

  // ======================= the plan =======================
  // A fingerprint of everything I can see that could change the plan.
  P.signature = function () {
    const s = this.s;
    const parts = [s.turn.n, s.turn.active, s.turn.phase > R().PI('Main 1') ? (s.turn.phase > R().PI('End of combat') ? 2 : 1) : 0, this.view.hand.map(c => c.id).sort().join(',')];
    for (const c of Object.values(s.cards)) if (c.zone === 'battlefield' || c.zone === 'stack' || c.zone === 'command') parts.push(c.id + (c.tapped ? 't' : '') + (c.zone[0]) + JSON.stringify(c.counters || {}).length);
    for (const p of s.seats) parts.push(p + ':' + this.life(p) + ':' + ((s.players[p] || {}).poison || 0) + ':' + ((s.players[p] || {}).handCount || 0));
    parts.push(Object.values(s.cards).filter(c => c.zone === 'graveyard').length);
    parts.push('x:' + Object.values(s.cards).filter(c => c.zone === 'exile' && c.mayPlay && c.owner === this.me).map(c => c.id).join(','));
    return parts.join('|');
  };
  // What changed since the last plan, in words (for the change log).
  P.whatChanged = function (prev) {
    if (!prev) return 'first look at the game';
    const s = this.s, out = [];
    if (prev.turn !== s.turn.n) out.push(`turn ${s.turn.n} (${R().nameOf(s, s.turn.active)})`);
    const before = new Set(prev.hand), now = this.view.hand.map(c => c.id);
    const drew = now.filter(id => !before.has(id)); if (drew.length) out.push(`${drew.length} new card${drew.length > 1 ? 's' : ''} in hand`);
    const bfPrev = new Set(prev.bf), bfNow = Object.values(s.cards).filter(c => c.zone === 'battlefield');
    const entered = bfNow.filter(c => !bfPrev.has(c.id) && c.ctrl !== this.me).map(c => R().cardName(c));
    if (entered.length) out.push(`opponents played ${entered.slice(0, 3).join(', ')}${entered.length > 3 ? '…' : ''}`);
    const left = prev.bf.filter(id => !s.cards[id] || s.cards[id].zone !== 'battlefield').map(id => prev.names[id]).filter(Boolean);
    if (left.length) out.push(`${left.slice(0, 3).join(', ')} left the battlefield`);
    const st = R().stackCards(s).filter(c => c.ctrl !== this.me);
    if (st.length) out.push(`on the stack: ${st.map(c => c.ab ? c.ab.name + ' ability' : R().cardName(c)).join(', ')}`);
    for (const p of s.seats) if (prev.life[p] != null && prev.life[p] !== this.life(p)) out.push(`${R().nameOf(s, p)} life ${prev.life[p]}→${this.life(p)}`);
    return out.join('; ') || 'board changed';
  };
  P.snapshotFor = function () {
    const s = this.s, names = {};
    const bf = Object.values(s.cards).filter(c => c.zone === 'battlefield').map(c => { names[c.id] = R().cardName(c); return c.id; });
    return { turn: s.turn.n, hand: this.view.hand.map(c => c.id), bf, names, life: Object.fromEntries(s.seats.map(p => [p, this.life(p)])) };
  };

  // Rethink if anything changed. Returns the plan (and logs the change when the plan is different).
  P.think = function (view, force) {
    this.load(view);
    const s = this.s;
    if (!s || !s.turn || !s.turn.active) return null;
    const sig = this.signature();
    if (!force && sig === this.sig && this.plan) return this.plan;
    const why = this.whatChanged(this.lastSnap);
    this.sig = sig; this.lastSnap = this.snapshotFor();
    this.observe();
    for (const p of this.opps()) this.readOpp(p);
    this.threats = this.opps().map(p => this.threat(p)).sort((a, b) => b.score - a.score);
    const plan = this.makePlan();
    const old = this.plan;
    this.plan = plan;
    const diff = this.diffPlans(old, plan);
    const newTurn = old && old.turn !== plan.turn;
    if (!old || (newTurn && plan.steps.length)) this.note('plan', `Turn ${s.turn.n} plan: ${plan.route.route} in ~${plan.route.turns} turns (${plan.route.why}). Moves: ${plan.steps.filter(x => !['abilities', 'end'].includes(x.kind)).map(x => x.label).join('; ') || '-'}. Holding: ${[...new Set(plan.responses.map(x => x.name))].join(', ') || '-'}. Main threat: ${plan.target ? R().nameOf(s, plan.target.pid) : '-'}.`, this.planData(plan));
    else if (newTurn) { if (diff && /holding|route|target/.test(diff)) this.note('replan', `Opponent's turn (${why}): ${diff}`, this.planData(plan)); }
    else if (diff) this.note('replan', `Changed plan (${why}): ${diff}`, this.planData(plan));
    return plan;
  };
  P.planData = function (p) { return { route: p.route, steps: p.steps.map(x => x.label), responses: p.responses.map(x => x.label), scenarios: p.scenarios.map(x => x.label) }; };
  P.diffPlans = function (a, b) {
    if (!a) return 'new';
    const out = [];
    if (a.route.route !== b.route.route) out.push(`route ${a.route.route} → ${b.route.route}`);
    const as = a.steps.map(x => x.key), bs = b.steps.map(x => x.key);
    const gone = x => (this.doneCheck && this.doneCheck(x.key)) || (x.kind === 'cast' && !this.view.hand.some(c => c.id === x.id) && !this.cmdZone().some(c => c.id === x.id) && !(this.s.cards[x.id] && ['graveyard', 'exile'].includes(this.s.cards[x.id].zone))) || (x.kind === 'land' && !this.view.hand.some(c => c.id === x.id)) || (x.kind === 'attack' && this.s.combat && this.s.combat.n === this.s.turn.n) || ['abilities', 'end'].includes(x.kind);
    const add = b.steps.filter(x => !as.includes(x.key) && !['abilities', 'end'].includes(x.kind)).map(x => x.label), rem = a.steps.filter(x => !bs.includes(x.key) && !gone(x)).map(x => x.label);
    if (add.length) out.push('new moves: ' + add.join('; '));
    if (rem.length) out.push('dropped: ' + rem.join('; '));
    const ar = a.responses.map(x => x.key), br = b.responses.map(x => x.key);
    const radd = b.responses.filter(x => !ar.includes(x.key)).map(x => x.label), rrem = a.responses.filter(x => !br.includes(x.key) && !x.fired).map(x => x.label);
    if (radd.length) out.push('now holding: ' + radd.join('; '));
    if (rrem.length) out.push('no longer holding: ' + rrem.join('; '));
    if ((a.target || {}).pid !== (b.target || {}).pid) out.push(`main target ${a.target ? R().nameOf(this.s, a.target.pid) : '-'} → ${b.target ? R().nameOf(this.s, b.target.pid) : '-'}`);
    return out.join(' · ');
  };

  P.makePlan = function () {
    const s = this.s, me = this.me, L = this.L, Rr = R();
    const routes = this.routes();
    const route = routes[0];
    // Keep the same main target unless another opponent is clearly more dangerous (no flip-flopping every look).
    let target = this.threats[0] || null;
    const prevT = this.plan && this.plan.target && this.threats.find(x => x.pid === this.plan.target.pid);
    if (prevT && target && prevT !== target && target.score < prevT.score * 1.2 + 0.5) target = prevT;
    const myTurn = s.turn.active === me;
    const plan = { at: Date.now(), turn: s.turn.n, route, routes: routes.slice(0, 4), target, threats: this.threats.map(t => ({ pid: t.pid, name: Rr.nameOf(s, t.pid), score: +t.score.toFixed(1), clockOnMe: +t.clockOnMe.toFixed(1), why: `power ${t.power}, engines ${t.engines}${t.comboNear.length ? ', combo close: ' + t.comboNear.map(k => k.cards.join('+')).join('; ') : ''}${t.interfere ? ', fights my plan ' + t.interfere.toFixed(1) : ''}` })),
      reads: this.opps().map(p => { const r = this.reads[p]; return { pid: p, name: Rr.nameOf(s, p), cmdr: r.cmdr.join(' + '), arch: r.arch.join(', '), kill: [...r.kill].slice(0, 6), note: r.note }; }),
      steps: [], responses: [], scenarios: [], milestones: [] };
    // ---- the turns ahead (milestones) ----
    const curve = this.manaCurve(L.horizon);
    const hand = this.handCards().concat(this.cmdZone());
    const keyInHand = hand.filter(c => !Rr.isType(c, 'land')).sort((a, b) => this.priorityOf(b) - this.priorityOf(a));
    const used = new Set();
    for (let i = 0; i < L.horizon; i++) {
      const m = curve[i];
      const fits = keyInHand.filter(c => !used.has(c.id) && this.mv(c) <= m).slice(0, 2);
      fits.forEach(c => used.add(c.id));
      const text = fits.length ? `cast ${fits.map(c => Rr.cardName(c)).join(' and ')}` : i === 0 ? 'develop' : `draw into ${this.profile.key.filter(n => this.zoneOfName(n) === 'library').slice(0, 2).join(' / ') || 'threats'}`;
      plan.milestones.push({ turn: i + 1, mana: m, text: text + (i + 1 >= route.turns ? ` — win via ${route.route}` : '') });
      if (i + 1 >= route.turns) break;
    }
    // ---- this turn: moves in order ----
    if (myTurn) this.planTurn(plan);
    // ---- what I hold for opponents' turns ----
    this.planResponses(plan, myTurn);
    // ---- backups ----
    this.planScenarios(plan);
    plan.summary = `${myTurn ? plan.steps.length + ' moves this turn' : 'opponent’s turn'}, ${plan.responses.length} saved response${plan.responses.length === 1 ? '' : 's'}, main threat ${target ? Rr.nameOf(s, target.pid) : 'none'}.`;
    return plan;
  };
  P.priorityOf = function (c) {
    let v = 0;
    if (this.isKey(c)) v += 5;
    if (c.cmdr) v += this.profile.cmdrRole === 'engine' ? 6 : 3;
    const rl = roles(c);
    if (rl.has('ramp')) v += 3;
    if (rl.has('draw')) v += 1;
    if (this.isFinisher(c)) v += this.finishReady() ? 4 : -2;
    return v - this.mv(c) * 0.1;
  };

  // This turn's moves: land, then the best set of spells my mana allows (keeping mana for held answers when that's
  // worth more), equips, abilities, the attack, and second-main plays.
  P.planTurn = function (plan) {
    const s = this.s, Rr = R(), Cd = C(), L = this.L;
    const ph = Rr.PHASES[s.turn.phase];
    const steps = plan.steps;
    const T = s.turn;
    const landDone = ((T.lands && T.lands[this.me]) || 0) >= 1 + (R().extraLands ? R().extraLands(s, this.me) : 0);
    if (!landDone && /^Main|Upkeep|Draw|Untap/.test(ph)) { const land = this.chooseLand(); if (land) steps.push({ key: 'land:' + land.id, kind: 'land', id: land.id, label: `play ${Rr.cardName(land)}`, why: land.why }); }
    // Spells: options with my current sources (+ the land I'm about to play).
    let srcs = this.sources();
    const pending = steps.find(x => x.kind === 'land');
    if (pending) { const lc = this.view.hand.find(c => c.id === pending.id); const m = lc && Cd.manaSource(Object.assign({ zone: 'battlefield' }, lc)); if (m && !/enters (?:the battlefield )?tapped/i.test(Cd.text(lc))) srcs = srcs.concat([{ id: lc.id, amount: m.amount, colors: m.colors, units: m.units, name: lc.d.n, pending: true }]); }
    const cands = this.handCards().concat(this.cmdZone()).concat(this.gyCastables()).concat(this.exileCards().filter(c => !R().isType(c, 'land'))).map(c => this.option(c, 'main', { sources: srcs })).filter(Boolean).filter(o => o.score > 0);
    // What I'd like to hold up: the best answer in hand for an opponent's turn.
    // Last round's held answer: did it get used? (adapts how much mana it keeps open)
    if (this.holding && this.holding.turn !== T.n) { this.holdWaste = this.holding.fired ? Math.max(0, (this.holdWaste || 0) - 1) : (this.holdWaste || 0) + 1; if (!this.holding.fired) this.note('replan', `Held ${this.holding.name} all round and didn't need it (held mana wasted ${this.holdWaste}× in a row — keeping less open)`); this.holding = null; }
    const hold = L.hold ? this.holdChoice(srcs) : null;
    if (this.desperate() && !(this.plan && this.plan.desperateNoted === s.turn.n)) { plan.desperateNoted = s.turn.n; this.note('plan', `Desperate: the next attacks (~${this.incomingNext().toFixed(0)} damage) could kill me at ${this.life(this.me)} life — casting blockers and answers now`); }
    const pickSet = sources => {
      const chosen = []; let left = sources.slice();
      const order = cands.slice().sort((a, b) => (b.score / Math.max(1, b.mana * 0.6)) - (a.score / Math.max(1, a.mana * 0.6)));
      for (const o of order) {
        if (chosen.some(x => x.id === o.id)) continue;
        const pay = this.payFor(o.cost, left, o.x, o.card);
        if (!pay) continue;
        chosen.push(Object.assign({}, o, { pay }));
        const used = new Set(pay);
        left = left.filter(x => !used.has(x.id));
        // Ramp that makes mana right away (rocks, dorks with haste) adds sources for later picks.
      }
      return { chosen, left, value: sum(chosen, o => o.score) };
    };
    let set = pickSet(srcs);
    if (hold) {
      const reserve = new Set(hold.pay);
      const kept = pickSet(srcs.filter(x => !reserve.has(x.id)));
      const keepValue = kept.value + hold.value;
      this.holdNote = `${hold.name}: hold value ${hold.value.toFixed(1)} vs tapping out ${set.value.toFixed(1)}`;
      if (keepValue >= set.value) { set = kept; plan.hold = { id: hold.id, name: hold.name, why: hold.why, pay: hold.pay, value: hold.value }; }
    }
    // Mistakes (lower levels): sometimes swap the best play for the next one.
    const ranked = set.chosen.sort((a, b) => this.sequenceRank(a) - this.sequenceRank(b));
    for (const o of ranked) {
      const main2 = this.castInMain2(o);
      steps.push({ key: 'cast:' + o.id, kind: 'cast', id: o.id, from: o.from, label: `${main2 ? '(main 2) ' : ''}cast ${o.name}${o.desc.filter(Boolean).length ? ' → ' + o.desc.filter(Boolean).join(', ') : ''}`, why: this.whyOption(o), main2, score: +o.score.toFixed(1) });
    }
    // Equipment and auras on the plan's creature; vehicles to crew; planeswalkers; tap abilities.
    let left = set.left.filter(x => !x.pending);
    // Equipment that gives shroud (Lightning Greaves) goes on last — after it, nothing else can target that creature.
    const eqs = this.bf(this.me).filter(c => Rr.isType(c, 'equipment') && !(c.attachedTo && s.cards[c.attachedTo] && s.cards[c.attachedTo].zone === 'battlefield'))
      .sort((a, b) => (/equipped creature has[^.]*shroud/i.test(Cd.text(a)) ? 1 : 0) - (/equipped creature has[^.]*shroud/i.test(Cd.text(b)) ? 1 : 0));
    for (const eq of eqs) {
      const best = this.voltronTarget(true); if (!best) break;
      const ab = Cd.abilities(eq).find(x => x.equip); if (!ab) continue;
      const pay = Cd.pay(ab.mana, left, 0); if (!pay) continue;           // only what the mana left after my spells can pay
      const used = new Set(pay); left = left.filter(x => !used.has(x.id));
      steps.push({ key: 'equip:' + eq.id, kind: 'equip', id: eq.id, to: best.id, label: `equip ${Rr.cardName(eq)} to ${Rr.cardName(best)}`, why: 'make my best attacker bigger' });
    }
    for (const pw of this.bf(this.me).filter(c => Rr.isType(c, 'planeswalker'))) if ((T.loyal || {})[pw.id] !== T.n) steps.push({ key: 'pw:' + pw.id, kind: 'pw', id: pw.id, label: `use ${Rr.cardName(pw)}`, why: 'once per turn' });
    // Aristocrats: if sacrificing everything drains an opponent out, do it.
    const lethalSac = this.lethalSacrifice();
    if (lethalSac) steps.push({ key: 'sacwin', kind: 'sacwin', label: `sacrifice for lethal drain (${lethalSac.why})`, why: lethalSac.why });
    const vehicles = this.bf(this.me).filter(c => Rr.isType(c, 'vehicle') && !Rr.isType(c, 'creature'));
    for (const v of vehicles) steps.push({ key: 'crew:' + v.id, kind: 'crew', id: v.id, label: `crew ${Rr.cardName(v)}`, why: 'attack with it' });
    if (Rr.PI(ph) <= Rr.PI('Declare attackers') && !(s.combat && s.combat.n === T.n)) steps.push({ key: 'attack', kind: 'attack', label: `attack (${plan.target ? 'pressure ' + Rr.nameOf(s, plan.target.pid) : 'best targets'})`, why: plan.route.route });
    steps.push({ key: 'abilities', kind: 'abilities', label: 'use tap abilities', why: 'value' });
    steps.push({ key: 'end', kind: 'end', label: 'end turn', why: plan.hold ? `holding ${plan.hold.name}` : 'done' });
    // Keep the old done/failed marks for moves that are still planned.
    const prevSteps = (this.plan && this.plan.turn === s.turn.n && this.plan.steps) || [];
    for (const st of steps) { const old = prevSteps.find(x => x.key === st.key); if (old) { st.done = old.done; st.failed = old.failed; st.tries = old.tries; } }
    const tp = (this.turnPlans[T.n] = this.turnPlans[T.n] || { planned: [], did: [], failed: [] });
    for (const st of steps) if (!tp.planned.includes(st.label)) tp.planned.push(st.label);
  };
  P.extraLands = function () { return /additional land/i.test(this.bf(this.me).map(c => C().text(c)).join(' ')) ? 1 : 0; };
  // Cards I may play from exile (impulse draw).
  // Cards I can cast at instant speed from: hand and exile (impulse).
  P.spellPool = function () { return this.handCards().concat(this.exileCards().filter(c => !R().isType(c, 'land'))); };
  P.exileCards = function () { return this.cards(c => c.zone === 'exile' && c.owner === this.me && c.mayPlay); };
  P.gyCastables = function () {
    // "During each of your turns, you may cast a creature spell from your graveyard" (Karador) and similar.
    const perm = this.bf(this.me).some(c => /you may cast (?:a |one )?creature spells? from your graveyard/i.test(C().text(c)));
    if (!perm || this.gyCastTurn === this.s.turn.n) return [];
    return this.cards(c => c.zone === 'graveyard' && c.owner === this.me && this.isCre(c));
  };
  // Sequencing: ramp first, draw next, then engines, removal/wipes, creatures, the rest.
  P.sequenceRank = function (o) {
    const rl = o.roles;
    if (rl.has('wipe')) return 1;
    if (rl.has('ramp')) return 0;
    if (rl.has('draw') && !o.perm) return 2;
    if (o.card.cmdr) return 3;
    if (rl.has('removal')) return 4;
    if (rl.has('anthem') || rl.has('equipment')) return 5;
    return 6 + (this.isCre(o.card) ? 1 : 0);
  };
  // Creatures without haste that don't help this combat go down after combat (hide information); not on Easy.
  // About to die next turn: cast blockers and answers now, hold nothing back but a fog or protection.
  P.desperate = function () { const s = this.s; if (!s || !s.turn) return false; const k = s.turn.n + ':' + s.rev; if (this._despK !== k) { this._despK = k; this._desp = this.incomingNext() >= this.life(this.me); } return this._desp; };
  P.castInMain2 = function (o) {
    if (this.level === 'easy' || this.desperate()) return false;
    const c = o.card;
    if (!this.isCre(c) || this.kw(c).has('haste') || o.roles.has('anthem') || o.roles.has('ramp') || o.card.cmdr && this.profile.cmdrRole === 'engine') return false;
    if (o.roles.has('wipe')) return false;
    if (o.alt === 'mutate') { const h = o.tg[0] && o.tg[0][0] && this.s.cards[o.tg[0][0].c]; if (h && !h.tapped && !R().sick(this.s, h)) return false; }   // the merged creature can attack now
    return this.creatures(this.me).some(x => !x.tapped && !R().sick(this.s, x));
  };
  P.whyOption = function (o) {
    const out = [];
    if (o.card.cmdr) out.push(`commander (${this.profile.cmdrRole || 'value'})`);
    if (this.isKey(o.card)) out.push('key card for my plan');
    if (o.wipe) out.push(o.wipe.reason);
    const cp = this.comboPiece(o.card); if (cp) out.push(cp.complete ? `completes ${cp.combo.cards.join(' + ')}` : `combo piece (${cp.have}/${cp.need} others out)`);
    for (const r of ['ramp', 'draw', 'removal', 'token', 'anthem', 'sacOutlet', 'deathDrain']) if (o.roles.has(r)) out.push(r);
    return out.join(', ') || 'best use of mana';
  };
  P.chooseLand = function () {
    const Cd = C();
    // Exiled lands I may play only this round go first.
    const exL = this.exileCards().filter(c => R().isType(c, 'land'));
    if (exL.length) return Object.assign({}, exL[0], { why: 'from exile before it expires' });
    const lands = this.handCards().filter(c => R().isType(c, 'land'));
    if (!lands.length) return null;
    const have = new Set(this.sources().flatMap(s => s.colors.split('')));
    const needed = new Set();
    for (const c of this.handCards().concat(this.cmdZone())) { const cost = Cd.costOf(c); for (const col of ['W', 'U', 'B', 'R', 'G']) if (cost[col] && !have.has(col)) needed.add(col); }
    const curMana = this.manaNow();
    const wantNow = this.handCards().some(c => !R().isType(c, 'land') && this.mv(c) === curMana + 1);
    const score = c => {
      const m = Cd.manaSource(Object.assign({ zone: 'battlefield' }, c)) || { colors: '' };
      let v = 0;
      for (const col of needed) if (m.colors.includes(col)) v += 3;
      const tapped = /enters (?:the battlefield )?tapped/i.test(Cd.text(c));
      if (tapped) v -= wantNow ? 3 : 0.5;
      v += m.colors.length * 0.3;
      if (/search your library|sacrifice this[^:]*: search/i.test(Cd.text(c))) v += 0.5;
      return v;
    };
    const sorted = lands.sort((a, b) => score(b) - score(a));
    const pick = this.choose(sorted.map(c => ({ c, label: R().cardName(c), unsafe: false })), 'land')?.c || sorted[0];
    pick.why = needed.size ? `makes ${[...needed].join('/')} I need` : 'best land';
    return pick;
  };
  P.voltronTarget = function (equip) {
    const my = this.creatures(this.me).filter(c => !equip || !this.kw(c).has('shroud'));
    if (!my.length) return null;
    const cm = my.find(c => c.cmdr && c.owner === this.me);
    if (this.profile.arch.includes('voltron') && cm) return cm;
    return my.slice().sort((a, b) => (this.value(b) + (this.kw(b).has('flying') ? 3 : 0) + (R().sick(this.s, b) ? -2 : 0)) - (this.value(a) + (this.kw(a).has('flying') ? 3 : 0) + (R().sick(this.s, a) ? -2 : 0)))[0];
  };
  P.lethalSacrifice = function () {
    if (!this.profile.arch.includes('aristocrats')) return null;
    const outlets = this.bf(this.me).filter(c => roles(c).has('sacOutlet'));
    if (!outlets.length) return null;
    const drains = this.bf(this.me).filter(c => roles(c).has('deathDrain')).length;
    if (!drains) return null;
    const mult = this.bf(this.me).some(c => nameOfCard(c) === 'Teysa Karlov') ? 2 : 1;
    const fodder = this.creatures(this.me).filter(c => !outlets.includes(c) && !roles(c).has('deathDrain') && !c.cmdr && !this.isProtect(c)).length;
    const dmg = fodder * drains * mult;
    const p = this.opps().find(x => this.life(x) <= dmg);
    return p ? { pid: p, why: `${fodder} creatures × ${drains} drain × ${mult} ≥ ${this.life(p)} life` } : null;
  };

  // ======================= saved responses (my trigger list) =======================
  // Which instant-speed answer is worth keeping mana for on opponents' turns.
  P.holdChoice = function (srcs) {
    const Cd = C();
    const inst = this.spellPool().filter(c => Cd.instantSpeed(c) && !R().isType(c, 'land'));
    let best = null;
    for (const c of inst) {
      const rl = roles(c);
      const cost = this.costOf(c);
      const pay = this.payFor(cost, srcs, cost.x ? 1 : 0, c);
      if (!pay) continue;
      let v = 0, why = '';
      const exposed = this.bf(this.me).filter(x => this.isProtect(x) || this.isKey(x));
      const oppOpen = Math.max(0, ...this.opps().map(p => this.oppMana(p)));
      const nearWin = Math.max(0, ...this.threats.map(t => t.nearWin));
      if (rl.has('counter')) { const top = this.threats[0]; v = 4 + nearWin * 2 + (top ? top.score * 0.3 + top.engines * 0.8 + Math.min(4, (this.s.players[top.pid] || {}).handCount || 0) * 0.3 : 0); why = 'counter the next spell that matters'; }
      else if (rl.has('protection')) { v = exposed.length ? 2.5 + sum(exposed, x => this.value(x)) * 0.15 : 0; why = `protect ${exposed.map(x => R().cardName(x)).slice(0, 2).join(', ')}`; }
      else if (rl.has('removal')) { v = 2 + nearWin * 1.5; why = 'kill a threat on their turn'; }
      else if (rl.has('fog')) { v = this.incomingNext() >= this.life(this.me) * 0.6 ? 5 : 0.5; why = 'survive their attack'; }
      else if (this.isCre(c)) { v = 1.5; why = 'flash it in at end of turn'; }
      else if (rl.has('draw')) { v = 1.2; why = 'draw at end of turn'; }
      v *= this.L.risk;
      // Held mana that keeps going unused is worth less next time (it adapts to how this table plays).
      v /= 1 + (this.holdWaste || 0) * 0.6;
      if (oppOpen === 0 && rl.has('counter')) v *= 0.8;
      if (v > (best ? best.value : 0.5)) best = { id: c.id, name: R().cardName(c), value: v, pay, why };
    }
    return best;
  };
  // The trigger list: "if X happens, do Y" for opponents' turns (and responses on my own turn).
  P.planResponses = function (plan, myTurn) {
    const Cd = C(), Rr = R(), s = this.s;
    const out = plan.responses;
    const keep = (this.plan && this.plan.responses) || [];
    if (this.level === 'easy') {
      // Easy only uses obvious ones: save a creature from removal with a protection spell.
      for (const c of this.spellPool().filter(c => Cd.instantSpeed(c) && roles(c).has('protection'))) out.push({ key: 'protect:' + c.id, ev: 'target', card: c.id, name: Rr.cardName(c), label: `if my creature is targeted by removal → ${Rr.cardName(c)}`, prio: 2 });
    } else {
      for (const c of this.spellPool().filter(c => Cd.instantSpeed(c) && !Rr.isType(c, 'land'))) {
        const rl = roles(c), nm = Rr.cardName(c);
        if (rl.has('counter')) out.push({ key: 'counter:' + c.id, ev: 'cast', card: c.id, name: nm, label: `counter: a spell that wipes or removes my key cards, an opponent's win condition or combo piece, the top threat's engine, or a counter aimed at my spell → ${nm}`, prio: 5 });
        if (rl.has('protection')) out.push({ key: 'protect:' + c.id, ev: 'target', card: c.id, name: nm, label: `if ${this.bf(this.me).filter(x => this.isProtect(x)).map(x => Rr.cardName(x)).slice(0, 3).join(', ') || 'my key creature'} is targeted or a wipe is cast → ${nm}`, prio: 4 });
        if (rl.has('removal') || rl.has('bounce')) {
          out.push({ key: 'kill:' + c.id, ev: 'threat', card: c.id, name: nm, label: `if an opponent completes a combo or plays a must-answer engine → ${nm} at once`, prio: 4 });
          out.push({ key: 'killatk:' + c.id, ev: 'attack', card: c.id, name: nm, label: `if a big attacker comes at me → ${nm} on it`, prio: 3 });
          out.push({ key: 'eotkill:' + c.id, ev: 'endstep', card: c.id, name: nm, label: `end of the turn before mine, if unused → ${nm} on the biggest threat`, prio: 1 });
        }
        if (rl.has('trick')) out.push({ key: 'trick:' + c.id, ev: 'blocks', card: c.id, name: nm, label: `in combat, if a pump wins a fight → ${nm}`, prio: 2 });
        if (rl.has('fog')) out.push({ key: 'fog:' + c.id, ev: 'attack', card: c.id, name: nm, label: `if the attack would kill me → ${nm}`, prio: 5 });
        if ((this.isCre(c) || rl.has('draw') || rl.has('token')) && !rl.has('counter') && !rl.has('removal')) out.push({ key: 'eot:' + c.id, ev: 'endstep', card: c.id, name: nm, label: `end of the turn before mine → ${nm}`, prio: 1 });
      }
      // Sacrifice outlets: in response to removal on my creature, or a wipe, sacrifice for value.
      for (const c of this.bf(this.me).filter(c => roles(c).has('sacOutlet'))) out.push({ key: 'sac:' + c.id, ev: 'target', ability: c.id, name: Rr.cardName(c), label: `if my creature would die or be exiled → sacrifice it to ${Rr.cardName(c)} first`, prio: 3 });
    }
    for (const r of out) { const o = keep.find(x => x.key === r.key); if (o) { r.fired = o.fired; r.skips = o.skips; } }
    out.sort((a, b) => b.prio - a.prio);
    plan.responses = out;
  };

  // ======================= backup scenarios =======================
  P.planScenarios = function (plan) {
    const Rr = R(), s = this.s, me = this.me;
    const list = [];
    const hand = this.spellPool();
    const second = plan.routes[1];
    const key = this.bf(me).filter(c => (this.isKey(c) || this.isProtect(c)) && !c.cmdr);
    const cm = this.myCommanders()[0];
    // 1. Board wipe.
    const rebuild = hand.filter(c => this.isCre(c) || roles(c).has('token')).slice(0, 2).map(c => Rr.cardName(c));
    list.push({ key: 'wipe', p: this.wipeRisk(), label: `if the board is wiped → ${rebuild.length ? 'rebuild with ' + rebuild.join(', ') : 'draw into threats'}${cm ? ', recast ' + Rr.cardName(cm) : ''}` });
    // 2. Commander removed.
    if (cm) { const tax = 2 * (((s.tax || {})[cm.id] || 0) + 1); list.push({ key: 'cmdr', p: this.profile.cmdrRole === 'engine' ? 0.6 : 0.3, label: `if ${Rr.cardName(cm)} is removed → recast it for ${this.mv(cm) + tax} (${this.profile.cmdrRole === 'engine' ? 'needed for the plan' : 'when spare mana'}), meanwhile ${second ? 'switch to ' + second.route : 'play value'}` }); }
    // 3. Main spell countered.
    const blue = this.opps().filter(p => this.oppColors(p).has('U'));
    if (blue.length) list.push({ key: 'countered', p: 0.35, label: `if my main spell is countered (${blue.map(p => Rr.nameOf(s, p)).join(', ')} can) → bait with a cheaper spell first, then cast ${(plan.steps.find(x => x.kind === 'cast') || {}).label || 'the next threat'}` });
    // 4. Key piece removed.
    if (key.length) list.push({ key: 'keylost', p: 0.4, label: `if ${Rr.cardName(key[0])} is removed → ${hand.find(c => roles(c).has('tutor')) ? 'tutor a replacement' : 'next key card: ' + (this.profile.key.find(n => this.zoneOfName(n) !== 'battlefield') || 'any engine')}` });
    // 5. An opponent is about to win.
    const near = this.threats.find(t => t.nearWin > 0.9 || t.comboNear.length);
    list.push({ key: 'theywin', p: near ? 0.7 : 0.15, label: `if ${near ? Rr.nameOf(s, near.pid) : 'an opponent'} is about to win → hold removal/counters for ${near && near.comboNear.length ? near.comboNear[0].missing.join(' or ') : 'their finisher'}, chump-block, attack them first` });
    // 6. Attack shut down (blockers, fog).
    list.push({ key: 'stalled', p: 0.3, label: `if my attacks are stopped → ${second ? 'switch to ' + second.route + ' (' + second.why + ')' : 'build a bigger board and use removal on blockers'}` });
    // 7. Mana trouble.
    list.push({ key: 'mana', p: this.view.hand.filter(c => /\bland\b/i.test(((c.d || {}).faces || [{}])[0].t || '')).length ? 0.1 : 0.4, label: 'if I miss land drops → cast ramp and cheap spells first, hold expensive ones' });
    list.sort((a, b) => b.p - a.p);
    plan.scenarios = list.slice(0, this.L.scenarios);
  };

  // ======================= decisions the executor asks for =======================
  // Respond to the top of the stack (or the end step) from the trigger list. Returns an option to cast/activate or null.
  P.respond = function (ctx) {
    const s = this.s, Rr = R(), Cd = C(), me = this.me;
    const plan = this.plan; if (!plan) return null;
    const top = Rr.stackTop(s);
    for (const r of plan.responses) {
      if (r.fired) continue;
      const card = r.card ? this.spellPool().find(c => c.id === r.card) : null;
      if (r.card && !card) continue;
      let o = null, why = '';
      if (r.ev === 'cast' && top && top.ctrl !== me) {
        const m = this.counterWorth(top);
        if (!m) { if (root.KT_AI_DEBUG) this.note('debug', `counter? ${R().cardName(top)}: not worth it`); continue; }
        o = this.option(card, 'instant', { counterTarget: top.id }); why = m;
      } else if (r.ev === 'target' && top && top.ctrl !== me) {
        const mineT = (top.tg || []).flat().filter(t => t.c && s.cards[t.c] && s.cards[t.c].ctrl === me && s.cards[t.c].zone === 'battlefield').map(t => t.c);
        const wipe = !top.ab && top.d && roles(top).has('wipe');
        const harmful = mineT.length && (top.ab ? /destroy|exile|damage|sacrifice|return/i.test(top.ab.text || '') : roles(top).has('removal') || roles(top).has('bounce'));
        if (!harmful && !wipe) continue;
        const worth = mineT.length ? Math.max(...mineT.map(id => this.value(s.cards[id]))) : sum(this.creatures(me), c => this.value(c)) * 0.4;
        if (worth < 4) continue;
        if (r.ability) { o = this.sacResponse(r.ability, mineT); why = 'sacrifice in response for value'; }
        else { o = this.option(card, 'instant', { protect: mineT }); if (o && mineT.length && !o.tg.flat().some(x => mineT.includes(x.c)) && o.reqs.length) o = null; why = wipe ? `save my board from ${Rr.cardName(top)}` : `save ${mineT.map(id => Rr.cardName(s.cards[id])).join(', ')}`; }
      } else if (r.ev === 'threat') {
        const th = this.mustAnswer();
        if (!th) continue;
        o = this.option(card, 'instant', { minValue: 0 }); if (o && !o.tg.flat().some(x => x.c === th.id)) { o = this.forceTarget(card, th.id); }
        why = `${Rr.cardName(s.cards[th.id])} must be answered (${th.why})`;
      } else if (r.ev === 'attack' && ctx.combat && s.turn.active !== me) {
        const K = s.combat; if (!K || K.n !== s.turn.n) continue;
        const atMe = Object.entries(K.att || {}).filter(([, x]) => (x.def.p || (s.cards[x.def.c] || {}).ctrl) === me).map(([id]) => s.cards[id]).filter(Boolean);
        if (!atMe.length) continue;
        const roleSet = roles(card);
        if (roleSet.has('fog')) { const inc = sum(atMe, c => this.pt(c)[0]) - sum(Object.values(K.att).flatMap(x => x.blk || []).map(id => s.cards[id]).filter(Boolean), () => 2); if (inc < this.life(me)) continue; o = this.option(card, 'instant'); why = 'the attack would kill me'; }
        else { const big = atMe.sort((a, b) => this.value(b) - this.value(a))[0]; if (this.value(big) < 6 && !(big.cmdr && this.pt(big)[0] >= 5)) continue; o = this.forceTarget(card, big.id); why = `stop ${Rr.cardName(big)}`; }
      } else if (r.ev === 'endstep' && ctx.endStep) {
        // At the end of the turn right before mine — or any opponent's end step if the mana would go unused.
        const seats = Rr._int.rotate(s, s.turn.active);
        const beforeMe = seats[(seats.indexOf(me) - 1 + seats.length) % seats.length] === s.turn.active || seats[seats.indexOf(s.turn.active) + 1] === me;
        if (!beforeMe && this.level !== 'hard') continue;
        if (!beforeMe && plan.responses.some(x => !x.fired && x.ev === 'cast' && this.spellPool().some(c => c.id === x.card))) continue;   // keep the counter mana
        o = this.option(card, 'instant', { minValue: 3 }); why = 'end of turn';
      } else if (r.ev === 'blocks' && ctx.blocks) {
        o = this.combatTrick(card); why = 'wins the fight';
      }
      if (!o) { r.skips = (r.skips || 0) + 1; if (root.KT_AI_DEBUG) this.note('debug', `${r.key}: no (${why || 'condition not met'}) top=${top ? R().cardName(top) : '-'}`); continue; }
      return { response: r, option: o, why };
    }
    return null;
  };
  // Is this spell worth a counterspell? Returns the reason, or null.
  P.counterWorth = function (top) {
    const s = this.s, me = this.me, Rr = R();
    if (top.ab) return null;
    const rl = roles(top), nm = Rr.cardName(top), n = nameOfCard(top);
    const rd = this.reads[top.ctrl] || this.readOpp(top.ctrl);
    const targetsMine = (top.tg || []).flat().filter(t => (t.c && s.cards[t.c] && (s.cards[t.c].ctrl === me || (s.cards[t.c].zone === 'stack' && s.cards[t.c].ctrl === me))) || t.p === me);
    if (rl.has('wipe')) { const w = sum(this.creatures(me), c => this.value(c)), t = sum(this.opps().map(p => sum(this.creatures(p), c => this.value(c)))); if (w >= t * 0.8 && w > 8) return `${nm} would wipe my better board`; }
    if (targetsMine.some(t => t.c && s.cards[t.c] && (this.isProtect(s.cards[t.c]) || this.isKey(s.cards[t.c]) || s.cards[t.c].zone === 'stack' || s.cards[t.c].cmdr || this.value(s.cards[t.c]) >= 7))) return `${nm} targets ${targetsMine.map(t => Rr.cardName(s.cards[t.c])).join(', ')}`;
    if (rd.comboNear.some(k => k.missing.includes(n))) return `${nm} completes ${R().nameOf(s, top.ctrl)}’s combo`;
    if (rd.kill.has(n)) return `${nm} is ${Rr.nameOf(s, top.ctrl)}’s engine`;
    if (top.cmdr && rd.counter.includes('commander') && this.threatOf(top.ctrl) >= (this.threats[0] || {}).score) return `${nm} is the top threat’s commander`;
    const mv = (top.d && +top.d.cmc) || 0;
    const counters = this.spellPool().filter(c => roles(c).has('counter')).length;
    if (mv >= (counters >= 2 ? 5 : 6) && this.threatOf(top.ctrl) >= ((this.threats[0] || {}).score || 0) * 0.8) return `${nm} is a big threat from the top threat`;
    // A pump/overrun in the middle of an attack on me that would make it lethal (Akroma's Will, Craterhoof…).
    const K = s.combat;
    if (K && K.n === s.turn.n && !K.done && s.turn.active === top.ctrl && (rl.has('finisher') || rl.has('anthem') || /creatures you control (?:get|gain)/i.test(C().text(top)))) {
      const atMe = Object.entries(K.att || {}).filter(([, x]) => (x.def.p || (s.cards[x.def.c] || {}).ctrl) === me).map(([id]) => s.cards[id]).filter(Boolean);
      const unblocked = atMe.filter(a => !((K.att[a.id] || {}).blk || []).length);
      const boost = +((C().text(top).match(/get \+(\d+)\/\+\d+/) || [])[1] || 2);
      if (unblocked.length && sum(unblocked, a => this.pt(a)[0] + boost) >= this.life(me) * 0.6) return `${nm} would make the attack on me deadly`;
    }
    if (rl.has('counter') && targetsMine.length) return `${nm} counters my spell`;
    // Mana kept open for this counter all round: on the last opponent turn before mine, use it on their best spell.
    const seats = Rr._int.rotate(s, s.turn.active);
    const lastBeforeMe = seats[(seats.indexOf(me) - 1 + seats.length) % seats.length] === s.turn.active;
    if (lastBeforeMe && this.holding && this.holding.counter && !this.holding.fired && (mv >= 4 || top.cmdr || rl.has('wipe') || rl.has('draw') && mv >= 3) && top.ctrl === s.turn.active) return `${nm} is the best spell this round, and I kept mana open for it`;
    return null;
  };
  // A permanent an opponent controls that must be answered now (combo complete, finisher, engine of the top threat).
  P.mustAnswer = function () {
    const s = this.s;
    let best = null;
    for (const p of this.opps()) {
      const rd = this.reads[p]; if (!rd) continue;
      for (const c of this.bf(p)) {
        if (R().isType(c, 'land')) continue;
        const n = nameOfCard(c);
        let v = 0, why = '';
        const k = rd.comboNear.find(k => k.cards.includes(n) && k.missing.length === 0);
        if (k) { v = 20; why = 'combo assembled: ' + k.cards.join(' + '); }
        else if (rd.kill.has(n) && this.threatOf(p) >= ((this.threats[0] || {}).score || 0) * 0.7) { v = 8 + this.value(c); why = 'engine of the main threat'; }
        if (v > (best ? best.v : 9)) best = { id: c.id, v, why };
      }
    }
    return best;
  };
  P.forceTarget = function (card, id) {
    const Cd = C();
    const mode = this.modeFor(card); if (mode === undefined) return null;
    const reqs = Cd.targetReqs(card, mode);
    if (!reqs.length || !Cd.legalTarget(this.s, reqs[0], { c: id }, this.me)) return null;
    const o = this.option(card, 'instant', { minValue: 0 }); if (!o) return null;
    o.tg = [[{ c: id }]].concat(o.tg.slice(1)); o.desc = [R().cardName(this.s.cards[id])].concat(o.desc.slice(1));
    return o;
  };
  P.sacResponse = function (outletId, mineT) {
    const s = this.s, c = s.cards[outletId]; if (!c) return null;
    const abs = C().abilities(c); const i = abs.findIndex(a => a.sacOther);
    if (i < 0) return null;
    const vic = mineT.find(id => s.cards[id] && C().matchesWhat(s.cards[id], abs[i].sacOther));
    if (!vic) return null;
    const pay = C().pay(abs[i].mana, this.sources(), 0); if (!pay) return null;
    return { ability: true, id: outletId, i, sac: vic, pay, name: R().cardName(c), tg: [] };
  };
  // A pump spell that wins a fight in the current combat.
  P.combatTrick = function (card) {
    const s = this.s, K = s.combat; if (!K) return null;
    const fights = [];
    for (const [aid, x] of Object.entries(K.att)) {
      const a = s.cards[aid]; if (!a) continue;
      for (const bid of x.blk || []) { const b = s.cards[bid]; if (!b) continue; if (a.ctrl === this.me) fights.push([a, b]); else if (b.ctrl === this.me) fights.push([b, a]); }
    }
    if (!fights.length) return null;
    const o = this.option(card, 'instant'); if (!o) return null;
    const pump = o.eff.effects.find(e => e.k === 'pump' && !/^-/.test(String(e.t)) && !/x/i.test(String(e.p) + String(e.t)));
    if (!pump) return null;
    const dp = parseInt(pump.p, 10) || 0, dt = parseInt(pump.t, 10) || 0;
    for (const [m, op] of fights) {
      const [mp, mt] = this.pt(m), [opp, ot] = this.pt(op), mk = this.kw(m), ok = this.kw(op);
      const dies = (pw, dtch, t, dmg, ind) => !ind && ((dtch && pw > 0) || pw >= t - (dmg || 0));
      const before = { me: dies(opp, ok.has('deathtouch'), mt, m.dmg, mk.has('indestructible')), them: dies(mp, mk.has('deathtouch'), ot, op.dmg, ok.has('indestructible')) };
      const after = { me: dies(opp, ok.has('deathtouch'), mt + dt, m.dmg, mk.has('indestructible')), them: dies(mp + dp, mk.has('deathtouch'), ot, op.dmg, ok.has('indestructible')) };
      if (after.me || (!before.me && before.them === after.them)) continue;
      const t = this.chooseTargets(card, o.mode, o.eff, { protect: [m.id], x: o.x });
      if (!t || !t.tg.flat().some(x => x.c === m.id)) continue;
      return Object.assign(o, t);
    }
    return null;
  };

  // ---------------- combat ----------------
  P.canAttack = function (c) {
    const s = this.s;
    if (c.tapped || !this.isCre(c)) return false;
    const k = this.kw(c);
    if (k.has('defender') || k.has("can't attack")) return false;
    if (R().sick(s, c) && !k.has('haste')) return false;
    return true;
  };
  P.blockersFor = function (att, pid) { return this.creatures(pid).filter(b => !b.tapped && !C().blockProblem(this.s, b, att)); };
  P.fight = function (a, b, pumpA, pumpB) {
    const [ap0, at0] = this.pt(a), [bp0, bt0] = this.pt(b);
    const ap = ap0 + (pumpA || 0), at = at0 + (pumpA || 0), bp = bp0 + (pumpB || 0), bt = bt0 + (pumpB || 0);
    const ak = this.kw(a), bk = this.kw(b);
    const aFS = ak.has('first strike') || ak.has('double strike'), bFS = bk.has('first strike') || bk.has('double strike');
    let aD = a.dmg || 0, bD = b.dmg || 0, aT = false, bT = false;
    const dead = (d, t, touched, ind) => !ind && (d >= t || touched);
    if (aFS && ap > 0) { bD += ap; if (ak.has('deathtouch')) bT = true; }
    if (bFS && bp > 0) { aD += bp; if (bk.has('deathtouch')) aT = true; }
    let aDead = dead(aD, at, aT, ak.has('indestructible')), bDead = dead(bD, bt, bT, bk.has('indestructible'));
    const aHits = !aDead && (!aFS || ak.has('double strike')) && ap > 0, bHits = !bDead && (!bFS || bk.has('double strike')) && bp > 0;
    if (aHits) { bD += ap; if (ak.has('deathtouch')) bT = true; }
    if (bHits) { aD += bp; if (bk.has('deathtouch')) aT = true; }
    aDead = dead(aD, at, aT, ak.has('indestructible')); bDead = dead(bD, bt, bT, bk.has('indestructible'));
    return { aDies: aDead, bDies: bDead };
  };
  // Open mana and colors → how likely a combat trick or flash blocker punishes an attack (0..1).
  P.trickRisk = function (pid) {
    const open = this.oppMana(pid);
    if (!open) return 0;
    const hand = (this.s.players[pid] || {}).handCount || 0;
    const seenTricks = Object.values(this.seen[pid] || {}).filter(x => x.roles.includes('trick') || x.roles.includes('removal') && x.roles.includes('instant')).length;
    return clamp((Math.min(open, 4) / 4) * (hand / 6) * (0.5 + seenTricks * 0.2), 0, 0.8) * this.L.risk;
  };
  P.planAttack = function () {
    const s = this.s, me = this.me, Rr = R();
    const mineC = this.creatures(me).filter(c => this.canAttack(c));
    const opps = this.opps();
    if (!mineC.length || !opps.length) return { list: [], why: 'no attackers' };
    const order = opps.slice().sort((a, b) => this.threatOf(b) - this.threatOf(a));
    // 1) Lethal on anyone (evasion and blockers counted).
    for (const p of opps.slice().sort((a, b) => this.life(a) - this.life(b))) {
      const bl = this.creatures(p).filter(c => !c.tapped);
      const sorted = mineC.slice().sort((a, b) => this.blockersFor(a, p).length - this.blockersFor(b, p).length || this.pt(b)[0] - this.pt(a)[0]);
      // Assume each untapped blocker stops one attacker (the biggest it can).
      let dmg = 0; const used = new Set();
      for (const a of sorted.slice().sort((x, y) => this.pt(y)[0] - this.pt(x)[0])) {
        const b = this.blockersFor(a, p).find(x => !used.has(x.id));
        if (b) { used.add(b.id); if (this.kw(a).has('trample')) dmg += Math.max(0, this.pt(a)[0] - this.pt(b)[1]); continue; }
        dmg += this.pt(a)[0];
      }
      const poisonP = (s.players[p] || {}).poison || 0;
      const tox = sum(mineC.filter(a => this.blockersFor(a, p).length === 0), a => (/toxic (\d+)/i.exec(C().text(a)) || [])[1] * 1 || (this.kw(a).has('infect') ? this.pt(a)[0] : 0));
      if (dmg >= this.life(p) || (tox && poisonP + tox >= 10)) {
        const list = mineC.map(c => ({ id: c.id, p, why: 'lethal' }));
        return { list, why: `lethal on ${Rr.nameOf(s, p)} (${dmg} through ${bl.length} blockers)` };
      }
    }
    // 2) Crack-back: keep enough blockers home.
    const incoming = this.incomingNext();
    const life = this.life(me);
    const keepN = incoming >= life - 4 ? Math.ceil(mineC.length / 2) : incoming >= life * 0.6 ? 1 : 0;
    const homeGuard = new Set(mineC.filter(c => !this.kw(c).has('vigilance')).sort((a, b) => this.pt(b)[1] - this.pt(a)[1]).slice(0, keepN).map(c => c.id));
    const list = [], why = [];
    const stall = s.turn.n > 6 * s.seats.filter(p => Rr.alive(s, p)).length;
    for (const c of mineC) {
      if (homeGuard.has(c.id)) { why.push(`${Rr.cardName(c)} stays home to block`); continue; }
      if (this.pt(c)[0] <= 0) continue;
      if (C().manaSource(c) && this.pt(c)[0] <= 1 && !this.profile.arch.includes('tokens')) continue;
      // The opponent to hit: whoever threatens my plan most, if the attack is safe there.
      let best = null;
      const pw = this.pt(c)[0];
      const toxN = ((/toxic (\d+)/i.exec(C().text(c)) || [])[1] * 1 || 0) + (this.kw(c).has('infect') ? pw : 0);
      for (const p of order) {
        const bl = this.blockersFor(c, p);
        const risk = this.trickRisk(p);
        const outs = bl.map(b => ({ b, r: this.fight(c, b) }));
        const bad = outs.some(o => o.r.aDies && !o.r.bDies);
        const trade = outs.some(o => o.r.aDies && o.r.bDies && this.value(o.b) < this.value(c));
        const trickBad = risk > 0.35 && bl.some(b => this.fight(c, b, 0, 2).aDies);
        // Blockers that would only die to it don't really stop it (nobody chumps unless it's lethal).
        const realBl = outs.filter(o => o.r.aDies || !o.r.bDies).length;
        const lifeP = Math.max(1, this.life(p));
        // Damage counts for more against whoever threatens my plan most (relative to the top threat), never by grudge.
        const topScore = Math.max(0.1, ...this.threats.map(x => x.score));
        const weight = 0.5 + this.threatOf(p) / topScore;
        const dies = outs.some(o => o.r.aDies);
        const hitV = (this.kw(c).has('infect') ? 0 : pw) + toxN * (lifeP / 10);
        const ev = (realBl ? 0.4 : bl.length ? 0.85 : 1) * hitV * weight - (bad ? this.value(c) : 0) - (trade ? this.value(c) * 0.6 : dies && !stall ? this.value(c) * 0.35 : 0) - (trickBad ? this.value(c) * risk : 0) - (this.isProtect(c) && bl.length ? 3 : 0);
        if (!best || ev > best.ev) best = { p, ev, bad, trickBad };
      }
      if (best && (best.ev > 0.3 || (stall && !best.bad))) { list.push({ id: c.id, p: best.p, why: best.trickBad ? 'risky' : 'safe' }); }
      else if (best) why.push(`${Rr.cardName(c)} doesn't attack (${best.bad ? 'a blocker kills it for free' : best.trickBad ? 'open mana for a trick' : 'nothing to gain'})`);
    }
    return { list, why: why.join('; ') };
  };
  P.planBlocks = function () {
    const s = this.s, K = s.combat, me = this.me, Rr = R();
    const atts = Object.entries(K.att).filter(([, x]) => (x.def.p || (s.cards[x.def.c] || {}).ctrl) === me).map(([id]) => s.cards[id]).filter(Boolean);
    const free = new Set(this.creatures(me).filter(b => !b.tapped && !this.kw(b).has("can't block")).map(b => b.id));
    const blocks = [], notes = [];
    const meP = s.players[me];
    let life = this.life(me);
    const incoming = sum(atts.filter(a => !this.kw(a).has('infect')), a => this.pt(a)[0]);
    const poisonIn = sum(atts, a => (this.kw(a).has('infect') ? this.pt(a)[0] : 0) + ((/toxic (\d+)/i.exec(C().text(a)) || [])[1] * 1 || 0));
    const deadly = a => (a.cmdr && ((meP.cmdDmg || {})[a.id] || 0) + this.pt(a)[0] >= 21) || (this.kw(a).has('infect') && (meP.poison || 0) + this.pt(a)[0] >= 10) || this.pt(a)[0] >= life;
    const dangerCmd = a => a.cmdr && ((meP.cmdDmg || {})[a.id] || 0) + this.pt(a)[0] >= 15;
    const sorted = atts.slice().sort((a, b) => (deadly(b) - deadly(a)) || this.value(b) - this.value(a));
    let remaining = incoming;
    for (const a of sorted) {
      const menace = this.kw(a).has('menace');
      const cand = this.blockersFor(a, me).filter(b => free.has(b.id));
      if (!cand.length || (menace && cand.length < 2)) continue;
      // Key creatures don't block unless I'd die.
      const spare = cand.filter(b => !this.isProtect(b) && !this.isKey(b));
      let best = cand.filter(b => { const r = this.fight(a, b); return r.aDies && !r.bDies; }).sort((x, y) => this.value(x) - this.value(y))[0];
      if (!best) best = cand.filter(b => { const r = this.fight(a, b); return r.aDies && r.bDies && this.value(b) <= this.value(a) + (this.level === 'hard' ? 0 : 1); }).sort((x, y) => this.value(x) - this.value(y))[0];
      if (!best) best = cand.filter(b => !this.fight(a, b).bDies).sort((x, y) => this.value(x) - this.value(y))[0];
      const lethalNow = deadly(a) || remaining >= life - (this.level === 'hard' ? 3 : 1) || (meP.poison || 0) + poisonIn >= 10;
      // Chump to protect the plan: lethal, dangerous commander damage, or a body I don't need.
      if (!best && (lethalNow || dangerCmd(a))) best = (spare.length ? spare : cand).sort((x, y) => this.value(x) - this.value(y))[0];
      if (!best && remaining >= life * 0.5 && spare.length && this.value(spare[0]) < 2.5) best = spare.sort((x, y) => this.value(x) - this.value(y))[0];
      if (!best) continue;
      if (this.isProtect(best) && !lethalNow && this.fight(a, best).bDies) continue;
      blocks.push({ id: best.id, att: a.id }); free.delete(best.id);
      notes.push(`${Rr.cardName(best)} blocks ${Rr.cardName(a)}${lethalNow ? ' (would be lethal)' : dangerCmd(a) ? ' (commander damage)' : ''}`);
      if (menace) { const second = cand.find(b => b.id !== best.id && free.has(b.id)); if (second) { blocks.push({ id: second.id, att: a.id }); free.delete(second.id); } else { blocks.pop(); notes.pop(); } }
      remaining -= this.pt(a)[0];
    }
    // Easy blocks loosely: sometimes drops a block.
    if (this.level === 'easy' && blocks.length && this.rng() < 0.25) { const d = blocks.pop(); this.note('mistake', `didn't block ${Rr.cardName(s.cards[d.att])} (difficulty easy)`); }
    return { blocks, why: notes.join('; ') || 'no good blocks' };
  };

  // ---------------- mulligan ----------------
  P.keepHand = function (hand, mulls) {
    const lands = hand.filter(c => /\bland\b/i.test(((c.d || {}).faces || [{}])[0].t || '')).length;
    const cards = hand.map(c => Object.assign({ zone: 'hand', counters: {}, face: 0 }, c));
    const ramp = cards.filter(c => roles(c).has('ramp') && !roles(c).has('land')).length;
    const key = cards.filter(c => this.isKey(c)).length;
    const cheap = cards.filter(c => !R().isType(c, 'land') && C().costTotal(C().costOf(c), 0) <= 3).length;
    let score = 0;
    score += lands >= 3 && lands <= 4 ? 4 : lands === 2 ? (ramp ? 2.5 : 1) : lands === 5 ? 2 : lands >= 6 ? -2 : -4;
    score += Math.min(ramp, 2) * 1.2 + Math.min(key, 2) * 1 + Math.min(cheap, 3) * 0.5;
    const need = 5 - mulls * 1.5;
    const keep = score >= need || mulls >= 2;
    this.note('mulligan', `${keep ? 'keep' : 'mulligan'}: ${lands} lands, ${ramp} ramp, ${key} key, ${cheap} cheap → score ${score.toFixed(1)} (need ${need.toFixed(1)})`);
    return keep;
  };
  // Cards to put away (discard, bottom, sacrifice): the least useful for my plan.
  P.worstCards = function (cards, n) {
    const lands = this.bf(this.me).filter(c => R().isType(c, 'land')).length;
    const landsInHand = cards.filter(c => R().isType(c, 'land')).length;
    const score = c => {
      if (R().isType(c, 'land')) return lands >= 6 ? 0 : landsInHand > 2 ? 1 : 8;
      let v = 10 - Math.abs(((+c.d.cmc || 0) - lands));
      if (this.isKey(c)) v += 6;
      if (roles(c).has('removal') || roles(c).has('counter')) v += 2;
      return v;
    };
    return cards.slice().sort((a, b) => score(a) - score(b)).slice(0, n);
  };
  P.worstPermanents = function (list, n) { return list.slice().sort((a, b) => this.value(a) - this.value(b)).slice(0, n); };
  // Answers to the table's questions (engine asks).
  P.answerAsk = function (ask) {
    const s = this.s, Rr = R(), me = this.me;
    switch (ask.kind) {
      case 'may': {
        const t = low(ask.text);
        let yes = true, why = 'it helps';
        if (/pay \d+ life|lose \d+ life/.test(t) && this.life(me) <= 12) { yes = false; why = 'life too low'; }
        if (/you may pay \{/.test(t)) { const m = (t.match(/pay ((?:\{[^}]+\})+)/) || [])[1] || ''; const need = (m.match(/\{/g) || []).length; const held = this.plan && this.plan.hold ? this.plan.hold.pay.length : 0; if (this.manaNow() - held < need) { yes = false; why = 'mana is kept for a response'; } }
        if (/sacrifice|discard/.test(t) && !/if you do, (?:draw|create|put|you gain|each opponent)/.test(t) && !this.profile.arch.includes('aristocrats')) { yes = false; why = 'not worth the cost'; }
        if (/you may sacrifice (?:a|another) creature/.test(t)) {
          const it = s.cards[ask.item]; const src = it && it.ab ? it.ab.src : null;
          const fodder = this.creatures(me).filter(c => c.id !== src && (c.token || this.value(c) < 3) && !this.isProtect(c));
          if (!fodder.length) { yes = false; why = 'no spare creature to sacrifice'; } else why = `sacrifice ${R().cardName(fodder[0])}`;
        }
        return { yes, cond: true, why };
      }
      case 'order': {
        // Resolve removal and token makers before drains and draws (so the drains see the deaths).
        const rank = it => { const t = low(it.text); return /destroy|exile|damage/.test(t) ? 0 : /create/.test(t) ? 1 : /sacrifice/.test(t) ? 2 : /loses? \d+ life|drain/.test(t) ? 3 : 4; };
        return { order: ask.items.slice().sort((a, b) => rank(a) - rank(b)).map(x => x.id), why: 'removal, then tokens, then drains' };
      }
      case 'modes': {
        const val = txt => { const t = low(txt); let v = 0; if (/destroy|exile|damage|counter target/.test(t)) v += 3; if (/draw/.test(t)) v += 2; if (/create/.test(t)) v += 2; if (/\+1\/\+1|gets \+/.test(t)) v += 1; if (/gain \d+ life/.test(t)) v += 0.5; if (/return/.test(t)) v += 1; const reqs = C().targetsIn(txt); if (reqs.some(r => !r.upTo && !C().targetChoices(s, r, me).filter(tt => tt.p ? tt.p !== me || /draw|gain/.test(t) : true).length)) v -= 10; return v; };
        const idx = ask.modes.map((m, i) => ({ i, v: val(m) })).filter(x => !(ask.off || []).includes(x.i)).sort((a, b) => b.v - a.v);
        const n = Math.max(ask.min, Math.min(ask.max, idx.filter(x => x.v > 0).length || ask.min));
        return { modes: idx.slice(0, n).map(x => x.i), why: 'best modes' };
      }
      case 'targets': {
        const q = (s.tq || []).find(x => x.id === ask.q);
        const text = q ? q.effect : '';
        const ops = root.Effects ? root.Effects.parse(text).ops : [];
        const intent = ask.reqs.map((r, k) => this.opIntent(ops, k, text));
        const blink = ops.some(o => o.op === 'flicker');
        // Blink only what gains from it: no tokens (they'd vanish), yes to enters-the-battlefield value and tapped mana rocks.
        const blinkOk = id => { const c = s.cards[id]; if (!c || c.token || c.ctrl !== me) return false; const tx = low(C().text(c)); return /when [^.]*enters/.test(tx) || (c.tapped && C().manaSource(c) && !R().isType(c, 'land')) || (c.dmg || 0) > 0 || (c.counters && c.counters['-1/-1']); };
        const tg = ask.reqs.map((r, k) => {
          if (blink && r.upTo && r.n > 1) { const pick = r.choices.filter(x => x.c && blinkOk(x.c)); return pick; }
          const ch = r.choices.slice();
          const fromThem = t => t.p ? t.p !== me : s.cards[t.c] && s.cards[t.c].ctrl !== me;
          const pool = intent[k] === 'theirs' ? ch.filter(fromThem) : ch.filter(t => !fromThem(t));
          const use = pool.length ? pool : (r.upTo ? [] : ch);
          const sorted = use.sort((a, b) => intent[k] === 'theirs' || pool.length ? this.targetScore(b) - this.targetScore(a) : this.targetScore(a) - this.targetScore(b));
          return sorted.slice(0, r.upTo ? Math.min(r.n, pool.length) : Math.min(r.n, sorted.length));
        });
        return { tg, why: intent.join(', ') };
      }
      case 'choose': {
        if (ask.what === 'player' || ask.what === 'opponent') { const p = (this.threats[0] || {}).pid || ask.players.find(x => x !== me) || ask.players[0]; return { value: p, why: 'main threat' }; }
        if (ask.what === 'color') { const cnt = {}; for (const c of this.view.hand.concat(this.view.lib)) for (const x of (c.d && c.d.col) || []) cnt[x] = (cnt[x] || 0) + 1; const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; const nm = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }; return { value: best ? nm[best[0]] : 'white', why: 'most common color in my deck' }; }
        const cnt = {}; for (const c of this.view.hand.concat(this.view.lib)) { const tl = ((c.d && c.d.faces && c.d.faces[0].t) || ''); if (!/creature/i.test(tl)) continue; for (const w of (tl.split(/[—-]/)[1] || '').trim().split(/\s+/).filter(Boolean)) cnt[w] = (cnt[w] || 0) + 1; }
        const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
        return { value: best ? best[0] : '', why: 'most common creature type in my deck' };
      }
      case 'enterOpt': {
        const wantNow = this.handCards().some(c => !R().isType(c, 'land') && this.mv(c) === this.manaNow() + 1);
        if (ask.life) return { yes: wantNow && this.life(me) > 10, why: wantNow ? 'I need the mana this turn' : 'no need to pay life' };
        return { yes: true, why: 'free to enter untapped' };
      }
      case 'legend': { const list = ask.ids.map(id => s.cards[id]).filter(Boolean).sort((a, b) => this.value(b) - this.value(a) + (a.tapped - b.tapped)); return { keep: (list[0] || {}).id || ask.ids[ask.ids.length - 1], why: 'keep the better one' }; }
      case 'payUntap': {
        // Untap the best blockers/attackers with spare land mana, keeping enough for the plan on my own turn.
        const cost = C().costTotal(C().parseCost(ask.cost), 0);
        let lands = this.bf(me).filter(c => !c.tapped && R().isType(c, 'land') && C().manaSource(c)).length;
        if (s.turn.active === me) lands -= Math.min(lands, Math.max(0, ...this.handCards().filter(c => !R().isType(c, 'land')).map(c => this.mv(c))));
        const ids = ask.ids.map(id => s.cards[id]).filter(Boolean).sort((a, b) => this.value(b) - this.value(a)).slice(0, Math.floor(lands / Math.max(1, cost))).map(c => c.id);
        return { ids, why: ids.length ? 'untap my best creatures with spare mana' : 'no spare mana' };
      }
      case 'pay': {
        // Pay with spare mana: never on my own turn if it costs me a spell; keep mana held for answers.
        const cost = C().costTotal(C().parseCost(ask.cost), 0);
        const lands = this.bf(me).filter(c => !c.tapped && R().isType(c, 'land') && C().manaSource(c)).length;
        const mine = s.turn.active === me;
        const hc = this.holding && !this.holding.fired && this.handCards().find(c => c.id === this.holding.id); const held = hc ? this.mv(hc) : 0;
        const yes = mine ? lands - cost >= Math.max(...this.handCards().filter(c => !R().isType(c, 'land')).map(c => this.mv(c)), 0) : lands - cost >= held;
        return { yes: !!yes && lands >= cost, why: yes ? 'spare mana' : 'I need the mana' };
      }
      case 'mutate': {
        // The top card decides power/toughness, name and types; abilities stay either way.
        const h = s.cards[ask.card], comps = (h && h.mut) || [];
        const ptOf = k => { const f = (k && k.d && k.d.faces && k.d.faces[k.face || 0]) || {}; return (+f.p || 0) + (+f.tg || 0); };
        const mine = comps.find(k => k.id === ask.comp), other = comps.find(k => k.id !== ask.comp);
        const top = !other || ptOf(mine) >= ptOf(other);
        return { top, why: top ? 'the mutating card is the bigger body' : 'the host is the bigger body' };
      }
      case 'copy': { const best = ask.choices.map(id => s.cards[id]).filter(Boolean).sort((a, b) => this.value(b) - this.value(a))[0]; return { pick: best ? best.id : null, why: 'best creature' }; }
      case 'assign': {
        const plan = {}; let left = ask.power;
        const bl = ask.blockers.slice().sort((a, b) => this.value(s.cards[b.id]) - this.value(s.cards[a.id]));
        for (const b of bl) { const n = Math.min(left, ask.deathtouch ? 1 : b.lethal); plan[b.id] = n; left -= n; }
        if (left && ask.trample) plan.player = left; else if (left && bl[0]) plan[bl[0].id] += left;
        return { assign: plan, why: 'lethal to the best blockers first' };
      }
    }
    return {};
  };
  // Does target k of this (trigger) text hurt or help?
  P.opIntent = function (ops, k, text) {
    const refs = [];
    const walk = list => { for (const o of list || []) { for (const f of ['to', 'what', 'on', 'who', 'of', 'a', 'b']) if (o[f] && o[f].k === 't' && o[f].i === k) refs.push(o); if (o.ops) walk(o.ops); if (o.modes) for (const m of o.modes) walk(m.ops); } };
    walk(ops);
    for (const o of refs) {
      if (['dmg', 'destroy', 'tap', 'counterSpell', 'gainControl', 'biggest'].includes(o.op)) return 'theirs';
      if (o.op === 'move') return o.to === 'battlefield' ? 'mine' : 'theirs';
      if (o.op === 'life') return o.sign < 0 ? 'theirs' : 'mine';
      if (o.op === 'pump') return /^-/.test(o.p) || /^-/.test(o.t) ? 'theirs' : 'mine';
      if (o.op === 'counters') return /-1\/-1|stun/.test(o.kind) || (typeof o.n === 'number' && o.n < 0) ? 'theirs' : 'mine';
      if (['grant', 'untap', 'draw', 'animate', 'doublePT', 'flicker'].includes(o.op)) return 'mine';
      if (['discard', 'mill', 'sacrifice', 'poison', 'reveal'].includes(o.op)) return 'theirs';
    }
    return /opponent|destroy|exile|damage|loses|discards?|reveals|sacrifices/.test(low(text)) ? 'theirs' : 'mine';
  };

  // ======================= for the dev panel =======================
  P.snapshot = function () {
    const p = this.plan;
    return { me: this.me, level: this.level, deck: this.profile.cmdr, arch: this.profile.arch, bracket: this.bracket, plan: p ? {
      route: p.route, routes: p.routes, target: p.target ? R().nameOf(this.s, p.target.pid) : null, threats: p.threats, reads: p.reads, milestones: p.milestones,
      steps: p.steps.map(x => ({ label: x.label, why: x.why, done: !!x.done, failed: x.failed || null })), hold: p.hold || null,
      responses: p.responses.map(x => ({ label: x.label, fired: !!x.fired, skips: x.skips || 0 })), scenarios: p.scenarios.map(x => ({ label: x.label, p: +x.p.toFixed(2) })) } : null,
      turns: this.turnPlans, log: this.log.slice(-200), wire: (this.wire || []).slice(-60) };
  };

  root.AIBrain = Brain;
  root.AIBrain.LEVELS = LEVELS;
})(typeof window !== 'undefined' ? window : globalThis);
