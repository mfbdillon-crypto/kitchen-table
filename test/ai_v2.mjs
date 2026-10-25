// Browser test of the planning AI: a scripted human vs one or two AI players on ready-made decks, then the dev-mode
// AI plan panel. node test/ai_v2.mjs [nAI] [turns] [skill] [humanDeck] [aiDeck,aiDeck2]
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const T = 'aiv' + Date.now() % 100000;
const N_AI = +(process.argv[2] || 1), TURNS = +(process.argv[3] || 8), SKILL = process.argv[4] || 'normal';
const HD = +(process.argv[5] || 4), AD = (process.argv[6] || '6,3').split(',').map(Number);
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1366, height: 820 } }); await mock(ctx);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('page: ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|net::/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await p.goto('http://localhost:8090/?t=' + T); await p.fill('#welcomename', 'Marissa'); await p.click('text=Join the table');
await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await p.evaluate(async ([hd, ad]) => { const h = await KT.importPrecon(window.KT_PRECONS[hd], () => {}); await KT.useDeck(h); for (const i of ad) await KT.importPrecon(window.KT_PRECONS[i], () => {}); }, [HD, AD]);
await p.evaluate(async ([n, skill, ad]) => { for (let i = 0; i < n; i++) { const d = KT.decks().find(x => x.src === window.KT_PRECONS[ad[i]].id); KT.addAI(['Chandra', 'Nissa'][i], d, skill); } }, [N_AI, SKILL, AD]);
await p.waitForFunction(n => KT.S.seats.filter(x => KT.S.players[x].ai).length === n && KT.S.seats.every(x => KT.S.players[x].libCount > 0), N_AI, { timeout: 60000 });
console.log('seated:', await p.evaluate(() => KT.S.seats.map(x => KT.S.players[x].name + (KT.S.players[x].ai ? ` (AI ${KT.S.players[x].ai.skill} v${KT.S.players[x].ai.v})` : '') + ' ' + (KT.S.players[x].deckName || '')).join(', ')));
await p.evaluate(() => KT.act({ type: 'start' }));
await wait(1500);
await p.evaluate(() => { if (KT.P.phase === 'none') KT.openingHand(); KT.keep(); });
const human = async () => p.evaluate(async () => {
  const s = KT.S, me = KT.KEY, R = Rules;
  if ((s.ask || []).some(a => a.pid === me)) { const a = s.ask.find(x => x.pid === me); await KT.act({ type: 'answer', id: a.id, yes: true, tg: a.reqs ? a.reqs.map(r => r.choices.slice(0, r.upTo ? 0 : r.n)) : undefined, modes: a.modes ? [0] : undefined, order: a.items ? a.items.map(x => x.id) : undefined }); return 'answer ' + a.kind; }
  if (s.prio && s.prio.holder === me) { await KT.pass(); return 'pass'; }
  if (s.combat && !s.combat.done && (s.combat.waiting || []).includes(me) && !s.combat.ok[me]) { await KT.block([]); return 'noblock'; }
  if (s.turn.active === me && !s.prio && !R.stackTop(s) && !s.turn.goal) {
    const land = KT.P.hand.find(c => KT.isLand(c));
    if (land && !(s.turn.lands && s.turn.lands[me]) && /^Main/.test(R.PHASES[s.turn.phase])) { await KT.playLand(land.id); return 'land'; }
    if (KT.P.hand.length > 7) { await KT.fromHand([KT.P.hand[0].id], 'graveyard'); return 'discard'; }
    await KT.act({ type: 'advance', goal: 'end' }); return 'end';
  }
  return '';
});
const t0 = Date.now(); let lastTurn = 0, stall = 0, lastKey = '';
while (Date.now() - t0 < TURNS * 30000) {
  const st = await p.evaluate(() => ({ n: KT.S.turn.n, w: KT.S.winner, key: [KT.S.turn.n, KT.S.turn.phase, KT.S.rev].join(':') }));
  if (st.w || st.n > TURNS) break;
  if (st.n !== lastTurn) { lastTurn = st.n; console.log('turn', st.n, await p.evaluate(() => `${Rules.nameOf(KT.S, KT.S.turn.active)} — ` + KT.S.seats.map(x => `${KT.S.players[x].name} ${KT.S.players[x].life}`).join(', '))); }
  await human();
  if (st.key === lastKey) { if (++stall > 60) { console.log('STALL', await p.evaluate(() => JSON.stringify({ ph: Rules.PHASES[KT.S.turn.phase], act: KT.S.turn.active, goal: KT.S.turn.goal, prio: KT.S.prio, ask: KT.S.ask, tq: (KT.S.tq || []).length, combat: KT.S.combat && { done: KT.S.combat.done, waiting: KT.S.combat.waiting, ok: KT.S.combat.ok } }))); break; } } else stall = 0;
  lastKey = st.key;
  await wait(250);
}
console.log('final:', await p.evaluate(() => `turn ${KT.S.turn.n}, winner ${KT.S.winner ? Rules.nameOf(KT.S, KT.S.winner) : '-'}; ` + KT.S.seats.map(x => `${KT.S.players[x].name} ${KT.S.players[x].life}`).join(', ')));
console.log('AI chat:', await p.evaluate(() => (KT.S.aichat || []).map(m => m.kind + ':' + m.text).slice(-5).join(' | ') || '(quiet)'));
// Ask it a question: it should answer about rules/public info only.
await p.evaluate(() => { const ai = KT.S.seats.find(x => KT.S.players[x].ai); KT.act({ type: 'aiAsk', to: ai, text: 'What is your plan?' }); });
await wait(2500);
console.log('answer:', await p.evaluate(() => ((KT.S.aichat || []).filter(m => m.kind === 'a').pop() || {}).text));
// Developer mode → AI plans panel.
await p.evaluate(() => KT.act({ type: 'dev', on: true }));
await wait(600);
await p.evaluate(() => { KT.aiPlanOpen = true; KT.render(); });
await wait(1200);
const panel = await p.evaluate(() => { const el = document.querySelector('.aiplan'); return el ? el.innerText.slice(0, 2500) : 'NO PANEL'; });
console.log('PANEL:\n' + panel);
await p.screenshot({ path: '/home/claude/mtg/test/shots/ai_plan_panel.png' });
console.log('table log tail:', await p.evaluate(() => KT.S.log.slice(-25).map(l => (l.pid ? Rules.nameOf(KT.S, l.pid) + ' ' : '') + l.text).join('\n')));
console.log('ERRORS', JSON.stringify(errs.slice(0, 10)));
await br.close();
