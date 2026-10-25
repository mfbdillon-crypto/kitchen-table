// A human (driven by this script, mostly passing) vs. one or two AI players, for several turns.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const T = 'aig' + Date.now() % 100000;
const N_AI = +(process.argv[2] || 1), TURNS = +(process.argv[3] || 8), SKILL = process.argv[4] || 'normal';
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } }); await mock(ctx);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('page: ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
p.on('frameattached', f => {});
ctx.on('page', () => {});
await p.goto('http://localhost:8090/?t=' + T); await p.fill('#welcomename', 'Marissa'); await p.click('text=Join the table');
await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await p.evaluate(async txt => { const d = await KT.linesToDeck(Scry.parseDeckFile(txt), 'Gruul Test', () => {}); await KT.useDeck(d); }, mock.aiDeck());
await wait(1000);
await p.evaluate(async ([n, skill]) => { const d = KT.decks()[0]; for (let i = 0; i < n; i++) KT.addAI(['Chandra', 'Nissa'][i], d, skill); }, [N_AI, SKILL]);
await p.waitForFunction(n => KT.S.seats.filter(x => KT.S.players[x].ai).length === n && KT.S.seats.every(x => KT.S.players[x].handCount > 0 || x === KT.KEY), N_AI, { timeout: 40000 });
console.log('AI seated:', await p.evaluate(() => KT.S.seats.map(x => KT.S.players[x].name + (KT.S.players[x].ai ? ' (AI ' + KT.S.players[x].ai.skill + ')' : '') + ' hand ' + KT.S.players[x].handCount).join(', ')));
await p.evaluate(() => { KT.openingHand(); KT.keep(); });
await wait(500);
await p.evaluate(() => KT.act({ type: 'start' }));
// Drive the human: pass priority, no blocks, play a land and pass the turn.
const ACTIVE = process.argv[5] === 'active';
const human = async () => p.evaluate(async active => {
  const s = KT.S, me = KT.KEY, R = Rules, C = Cards;
  if (s.prio && s.prio.holder === me) { await KT.pass(); return 'pass'; }
  if (s.combat && !s.combat.done && s.combat.waiting.includes(me) && !s.combat.ok[me]) {
    if (!active) { await KT.block([]); return 'noblock'; }
    // block the biggest attacker with my biggest untapped creature
    const mine = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === me && R.isType(c, 'creature') && !c.tapped);
    const atts = Object.keys(s.combat.att).map(id => s.cards[id]).filter(Boolean).filter(a => !C.keywords(a, s).has('flying'));
    const list = []; if (mine[0] && atts[0]) list.push({ id: mine[0].id, att: atts[0].id });
    await KT.block(list); return 'block';
  }
  if (s.turn.active === me && !s.prio) {
    const ph = R.PHASES[s.turn.phase];
    window.__h = window.__h || {};
    const key = s.turn.n;
    const land = KT.P.hand.find(c => KT.isLand(c));
    if (land && !(s.turn.lands && s.turn.lands[me])) { await KT.playLand(land.id); return 'land'; }
    if (active && ph !== 'Main 2' && !window.__h['cast' + key]) {
      window.__h['cast' + key] = 1;
      const bolt = KT.P.hand.find(c => c.d.n === 'Lightning Bolt');
      const foe = Object.values(s.cards).find(c => c.zone === 'battlefield' && c.ctrl !== me && R.isType(c, 'creature'));
      if (bolt && foe) { await KT.castFromHand(bolt.id, { tg: [[{ c: foe.id }]] }); return 'bolt'; }
      const cre = KT.P.hand.find(c => /Creature/.test(c.d.faces[0].t) && c.d.cmc <= Object.values(s.cards).filter(x => x.zone === 'battlefield' && x.ctrl === me && R.isType(x, 'land')).length);
      if (cre) { await KT.castFromHand(cre.id, {}); return 'creature'; }
    }
    if (active && !window.__h['atk' + key] && !(s.combat && s.combat.n === key)) {
      window.__h['atk' + key] = 1;
      await KT.act({ type: 'phase', to: R.PHASES.indexOf('Beginning of combat') });
      const ready = Object.values(KT.S.cards).filter(c => c.zone === 'battlefield' && c.ctrl === me && R.isType(c, 'creature') && !c.tapped && !R.sick(KT.S, c));
      const foeP = KT.S.seats.find(x => x !== me);
      const r = await KT.attack(ready.map(c => ({ id: c.id, p: foeP })));
      return 'attack ' + ready.length + (r.ok ? '' : ' ERR ' + r.err);
    }
    if (active && !window.__h['ask' + key] && (s.aichat || []).some(m => m.kind === 'say' && m.text.startsWith('I cast'))) {
      window.__h['ask' + key] = 1;
      const m = [...s.aichat].reverse().find(m => m.kind === 'say' && m.text.startsWith('I cast'));
      await KT.act({ type: 'aiAsk', to: m.pid, text: 'Is this legal?', re: m.id });
      await KT.act({ type: 'aiAsk', to: m.pid, text: 'What does trample do?' });
      return 'asked';
    }
    await KT.act({ type: 'phase', dir: 'pass' }); return 'passturn';
  }
  return '';
}, ACTIVE);
const t0 = Date.now();
let lastTurn = 0;
while (Date.now() - t0 < TURNS * 60000) {
  const did = await human(); if (did && did !== 'pass' && did !== 'noblock' && did !== 'passturn') console.log('   human:', did);
  const st = await p.evaluate(() => ({ n: KT.S.turn.n, active: KT.S.players[KT.S.turn.active] && KT.S.players[KT.S.turn.active].name, phase: Rules.PHASES[KT.S.turn.phase], lives: KT.S.seats.map(x => KT.S.players[x].name + ':' + KT.S.players[x].life).join(' ') }));
  if (st.n !== lastTurn) { console.log(`turn ${st.n} (${st.active}) ${st.lives}`); lastTurn = st.n; }
  if (st.n > TURNS) break;
  await wait(400);
}
await wait(2000);
const out = await p.evaluate(() => ({
  chat: (KT.S.aichat || []).map(m => `${KT.R.nameOf(KT.S, m.pid)} [${m.kind}] ${m.text}${m.why ? ' | ' + m.why.join(' / ') : ''}`),
  log: KT.S.log.map(l => (l.pid ? KT.R.nameOf(KT.S, l.pid) + ' ' : '') + l.text),
  board: KT.S.seats.map(x => KT.S.players[x].name + ': ' + Object.values(KT.S.cards).filter(c => c.zone === 'battlefield' && c.ctrl === x).map(c => KT.R.cardName(c)).join(', ')),
  counts: KT.S.seats.map(x => { const P = KT.S.players[x]; const pub = Object.values(KT.S.cards).filter(c => c.owner === x && !c.token).length; return P.name + ' total ' + (pub + P.handCount + P.libCount); })
}));
fs.writeFileSync('test/ai_game.log', out.log.join('\n') + '\n\n--- AI chat ---\n' + out.chat.join('\n'));
console.log('--- AI chat (last 25) ---'); console.log(out.chat.slice(-25).join('\n'));
console.log('--- board ---'); console.log(out.board.join('\n'));
console.log('--- card totals (should be 100 each) ---'); console.log(out.counts.join('\n'));
console.log('ERRORS', errs.slice(0, 10));
await br.close();
