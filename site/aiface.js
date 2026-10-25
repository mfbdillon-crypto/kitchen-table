// Kitchen Table — the AI ↔ table interface sheet.
// One place that lists everything the table (rules engine) can ask a player, everything it can hand a player to do,
// every moment a player must act, and every action the AI may send back — with the exact answer shape the table
// accepts, a safe default, and which part of the AI handles it. The AI's executor checks every answer against this
// sheet before sending it (a bad answer is replaced by the safe default and logged), and test/ai_face.test.js fails
// if the engine starts asking something that isn't on the sheet.
(function (root) {
  'use strict';
  const isArr = Array.isArray;
  const firstN = (r, n) => r.choices.slice(0, Math.min(n, r.choices.length));

  // ---------------- 1. Questions (s.ask) — the table waits for an answer ----------------
  // answer: what to send with { type: 'answer', id }   check(ans, ask) → error text or ''   safe(ask) → a legal answer
  const ASKS = {
    may: { what: '“You may …” on a triggered ability (or an intervening “if” the table can’t check)', answer: '{ yes: true|false, cond?: true|false }', ai: 'brain.answerAsk → may', check: a => typeof a.yes === 'boolean' ? '' : 'yes must be true or false', safe: () => ({ yes: false, cond: false }) },
    targets: { what: 'Targets for a triggered ability being put on the stack', answer: '{ tg: [[{ c: cardId } | { p: playerId }, …] per target] }', ai: 'brain.answerAsk → targets (opIntent: hurt opponents / help me)',
      check: (a, ask) => { if (!isArr(a.tg) || a.tg.length !== ask.reqs.length) return 'one list per target'; for (let k = 0; k < ask.reqs.length; k++) { const r = ask.reqs[k], l = a.tg[k] || []; const ok = new Set(r.choices.map(t => t.p ? 'p' + t.p : 'c' + t.c)); if (l.some(t => !ok.has(t.p ? 'p' + t.p : 'c' + t.c))) return 'illegal target for ' + r.label; if (l.length > r.n) return 'too many for ' + r.label; if (!r.upTo && l.length < Math.min(r.n, r.choices.length)) return 'too few for ' + r.label; } return ''; },
      safe: ask => ({ tg: ask.reqs.map(r => r.upTo ? [] : firstN(r, r.n)) }) },
    modes: { what: 'Modes of a modal triggered ability', answer: '{ modes: [index, …] } (min…max, not in ask.off)', ai: 'brain.answerAsk → modes',
      check: (a, ask) => { if (!isArr(a.modes)) return 'modes must be a list'; const u = [...new Set(a.modes)]; if (u.length < ask.min || u.length > ask.max) return `choose ${ask.min}–${ask.max}`; if (u.some(i => i < 0 || i >= ask.modes.length || (ask.off || []).includes(i))) return 'unknown or used mode'; return ''; },
      safe: ask => ({ modes: ask.modes.map((m, i) => i).filter(i => !(ask.off || []).includes(i)).slice(0, Math.max(1, ask.min)) }) },
    order: { what: 'Order of several of my triggers that happened at once (603.3b)', answer: '{ order: [triggerId, …] } in the order they should RESOLVE', ai: 'brain.answerAsk → order',
      check: (a, ask) => isArr(a.order) && a.order.length === ask.items.length && ask.items.every(x => a.order.includes(x.id)) ? '' : 'must list every trigger once', safe: ask => ({ order: ask.items.map(x => x.id) }) },
    choose: { what: '“As this enters, choose a color / creature type / player”', answer: '{ value: "white" | "Dragon" | playerId }', ai: 'brain.answerAsk → choose',
      check: (a, ask) => typeof a.value === 'string' && (!ask.players || ask.players.includes(a.value)) ? '' : 'value must be a word (or one of ask.players)', safe: ask => ({ value: ask.players ? ask.players[0] : '' }) },
    enterOpt: { what: '“Pay 2 life or it enters tapped” / “reveal a card or it enters tapped”', answer: '{ yes: true|false }', ai: 'brain.answerAsk → enterOpt', check: a => typeof a.yes === 'boolean' ? '' : 'yes must be true or false', safe: () => ({ yes: false }) },
    legend: { what: 'Legend rule: keep one of my same-name legends (704.5j)', answer: '{ keep: cardId }', ai: 'brain.answerAsk → legend', check: (a, ask) => ask.ids.includes(a.keep) ? '' : 'keep must be one of ask.ids', safe: ask => ({ keep: ask.ids[ask.ids.length - 1] }) },
    payUntap: { what: 'Mudslide: pay {2} each to untap any of my tapped creatures', answer: '{ ids: [cardId, …] } (the table taps my lands for it)', ai: 'brain.answerAsk → payUntap', check: (a, ask) => Array.isArray(a.ids) && a.ids.every(id => ask.ids.includes(id)) ? '' : 'ids must come from ask.ids', safe: () => ({ ids: [] }) },
    pay: { what: '“That player may pay {2}. If they don’t, …” (Smothering Tithe): pay to stop the rest from happening', answer: '{ yes: true|false } (true: the table taps my lands for it)', ai: 'brain.answerAsk → pay', check: a => typeof a.yes === 'boolean' ? '' : 'yes must be true or false', safe: () => ({ yes: false }) },
    mutate: { what: 'My mutating spell merged with its host: keep the mutating card on top, or put it under (702.140c)', answer: '{ top: true|false }', ai: 'brain.answerAsk → mutate', check: a => typeof a.top === 'boolean' ? '' : 'top must be true or false', safe: () => ({ top: true }) },
    copy: { what: 'Clone: which creature it enters as a copy of', answer: '{ pick: cardId | null }', ai: 'brain.answerAsk → copy', check: (a, ask) => a.pick == null || ask.choices.includes(a.pick) ? '' : 'pick must be one of ask.choices', safe: () => ({ pick: null }) },
    assign: { what: 'Combat damage of my attacker among 2+ blockers (510.1c)', answer: '{ assign: { blockerId: n, …, player?: n } }', ai: 'brain.answerAsk → assign',
      check: (a, ask) => { if (!a.assign || typeof a.assign !== 'object') return 'assign must be an object'; const tot = Object.values(a.assign).reduce((x, y) => x + (y | 0), 0); return tot === ask.power ? '' : `assign exactly ${ask.power}`; },
      safe: ask => { const plan = {}; let left = ask.power; for (const b of ask.blockers) { const n = Math.min(left, b.lethal); plan[b.id] = n; left -= n; } if (left && ask.blockers[0]) plan[ask.blockers[0].id] += left; return { assign: plan }; } },
    manual: { what: 'An effect the table can’t carry out by itself (“finish by hand”)', answer: '{} (just acknowledge)', ai: 'executor: logs it as “couldn’t finish by hand” and acknowledges', check: () => '', safe: () => ({}) }
  };

  // ---------------- 2. Jobs (s.todo[me]) — things only the owner can do (hidden hand / library) ----------------
  // The page acknowledges with { type: 'todoAck', ids } after the handler finishes.
  const TODOS = {
    draw: { what: 'Draw N cards', ai: 'page draws by itself (game.js)' },
    mill: { what: 'Mill N cards', ai: 'page mills by itself (game.js)' },
    discard: { what: 'Discard N (or at random)', ai: 'executor.onTodo → brain.worstCards' },
    sacrifice: { what: 'Sacrifice N of a kind', ai: 'executor.onTodo → least useful to my plan (never the commander if anything else)' },
    sacUnless: { what: 'Upkeep cost: sacrifice something or the source', ai: 'executor.onTodo → sacrifice' },
    returnOwn: { what: 'Return a permanent I control to hand (Karoo lands…)', ai: 'executor.onTodo → tapped basic land first' },
    scry: { what: 'Scry N', ai: 'executor.onTodo → keep key cards / castable ones on top' },
    surveil: { what: 'Surveil N', ai: 'executor.onTodo → same as scry, the rest to the graveyard' },
    look: { what: 'Look at the top N, take some', ai: 'executor.onTodo → best for the plan' },
    fetch: { what: 'Search for basic lands', ai: 'executor.onTodo → colors my hand needs' },
    search: { what: 'Search the library for a card', ai: 'executor.onTodo → missing combo piece, key card, needed color' },
    cascade: { what: 'Cascade / discover N: reveal and maybe cast free (discover: or put it into my hand)', ai: 'executor.onTodo → cast it unless it has no good target' },
    sacSearch: { what: 'Scapeshift: sacrifice any number of lands, then search for that many land cards (onto the battlefield tapped)', ai: 'executor.onTodo → sacrifice every land, fetch the best ones' },
    freeCast: { what: 'You may cast a spell (of a kind, up to a mana value) from your hand or graveyard without paying its mana cost', ai: 'executor.onTodo → best castable fit, cast with alt free' },
    impulse: { what: 'Exile the top N cards; I may play them this turn / until the end of my next turn (Riku, Jeska’s Will)', ai: 'executor.onTodo → io.impulse; the plan then casts or plays them from exile' },
    handToTop: { what: 'Put N cards from my hand on top of my library (Brainstorm)', ai: 'executor.onTodo → brain.worstCards' },
    dig: { what: 'Reveal until N matching cards (Illuna, Auspicious Starrix, The Regalia) → battlefield / hand / either', ai: 'executor.onTodo → battlefield when I may choose' },
    fromHand: { what: 'Put a card from hand onto the battlefield', ai: 'executor.onTodo → best for the plan' },
    fromGy: { what: 'Return a card from my graveyard', ai: 'executor.onTodo → most valuable' }
  };

  // ---------------- 3. Moments when a player must act ----------------
  const MOMENTS = [
    { when: 'Opening hand (private phase “deciding”)', ai: 'brain.keepHand → io.keep / io.mulligan; “bottom” → brain.worstCards' },
    { when: 's.ask has a question for me', ai: 'brain.answerAsk, checked against this sheet' },
    { when: 's.todo[me] has a job', ai: 'executor.onTodo' },
    { when: 's.prio.holder === me, something on the stack', ai: 'brain.respond (saved responses: counter / protect / kill / sacrifice) → cast, else pass' },
    { when: 's.prio.holder === me, step "end" (end of someone’s turn)', ai: 'brain.respond (end-of-turn responses) → cast, else pass' },
    { when: 's.prio.holder === me, combat window after blocks', ai: 'brain.respond (combat tricks, removal on attackers, fogs) → cast, else pass' },
    { when: 's.combat waiting for my blocks', ai: 'brain.planBlocks → { type: "block", list }' },
    { when: 'My turn, Draw step', ai: 'io.drawForTurn' },
    { when: 'My turn, main phase, nothing pending', ai: 'plan steps in order: land → spells (Main 1 / Main 2) → equip → walkers → crew → advance “combat”' },
    { when: 'My turn, Declare attackers', ai: 'brain.planAttack → { type: "attack", list }' },
    { when: 'My turn, Main 2 done', ai: 'discard to 7 → advance “end” (the table runs end step, cleanup, next turn)' }
  ];

  // ---------------- 4. Actions the AI sends to the table ----------------
  const ACTIONS = {
    join: '{ name, ai: { skill, by, v: 2 } } — sit down as the planning AI (the table then asks it questions instead of choosing for it)',
    aiMeta: '{ skill?, v: 2 } — change difficulty / mark as planning AI',
    enter: '{ zone: "battlefield"|"stack"|…, cards, land?, cast?, tg?, mode?, x?, alt?, fromPool? } — play a land or cast from hand (via io.playLand / io.castFromHand)',
    move: '{ ids, to, cast?, sac?, tapped? } — cast from command zone / graveyard, sacrifice, return',
    tap: '{ ids, tapped: true, pay: true } — pay mana (tapping to pay doesn’t add to the pool)',
    activate: '{ id, i, tg?, crew?, sac? } — abilities, equip, crew, loyalty, sacrifice outlets',
    trigger: '{ id, i, tg } — only for triggers the engine doesn’t put on the stack itself',
    attack: '{ list: [{ id, p }] }', block: '{ list: [{ id, att }] }',
    pass: '{ top } — pass priority', advance: '{ goal: "combat"|"end" } — move my turn along',
    answer: '{ id, … } — see Questions', aiSay: '{ kind: "a", re, text } — reply to a question in the AI chat (the only time it speaks)'
  };

  // Check an answer before it is sent. Returns { ans, problem } — problem is '' when fine, otherwise the safe answer is used.
  function vet(ask, ans) {
    const row = ASKS[ask.kind];
    if (!row) return { ans: {}, problem: `the table asked “${ask.kind}”, which isn’t on the interface sheet` };
    let problem = '';
    try { problem = row.check(ans || {}, ask) || ''; } catch (e) { problem = 'check failed: ' + e.message; }
    return problem ? { ans: row.safe(ask), problem } : { ans, problem: '' };
  }
  // The sheet as text (for the dev panel and the docs).
  function sheet() {
    const out = ['QUESTIONS (s.ask → { type: "answer", id, … })'];
    for (const [k, r] of Object.entries(ASKS)) out.push(`  ${k}: ${r.what}. Answer ${r.answer}. AI: ${r.ai}.`);
    out.push('JOBS (s.todo[me] → todoAck)'); for (const [k, r] of Object.entries(TODOS)) out.push(`  ${k}: ${r.what}. AI: ${r.ai}.`);
    out.push('MOMENTS'); for (const m of MOMENTS) out.push(`  ${m.when} → ${m.ai}`);
    out.push('ACTIONS (AI → table)'); for (const [k, v] of Object.entries(ACTIONS)) out.push(`  ${k} ${v}`);
    return out.join('\n');
  }
  root.KT_AI_FACE = { ASKS, TODOS, MOMENTS, ACTIONS, vet, sheet };
})(typeof window !== 'undefined' ? window : globalThis);
