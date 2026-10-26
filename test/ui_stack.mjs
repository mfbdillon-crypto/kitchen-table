import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const T = 'uis' + Date.now() % 100000;
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1366, height: 820 } }); await mock(ctx);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('page: ' + e.message));
await p.goto('http://localhost:8090/?t=' + T); await p.fill('#welcomename', 'Marissa'); await p.click('text=Join the table');
await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await p.evaluate(async txt => { const d = await KT.linesToDeck(Scry.parseDeckFile(txt), 'Gruul Test', () => {}); await KT.useDeck(d); }, mock.aiDeck());
await p.evaluate(() => KT.addAI('Chandra', KT.decks()[0], 'normal'));
await p.waitForFunction(() => KT.S.seats.length === 2 && KT.S.seats.every(x => KT.S.players[x].libCount > 0), null, { timeout: 40000 });
console.log('start:', JSON.stringify(await p.evaluate(async () => { await KT.act({ type: 'house', set: { deckSize: 0 } }); const r = await KT.act({ type: 'start' }); return [r, KT.S.seats.map(x => [KT.S.players[x].name, KT.S.players[x].libCount, KT.S.players[x].handCount])]; })));
await p.waitForFunction(() => KT.S.seats.some(x => KT.S.players[x].ai && KT.S.players[x].handCount > 0), null, { timeout: 40000 });
await p.evaluate(() => { KT.openingHand(); KT.keep(); });
// Give both sides something on the battlefield, and the human a Bolt + creature in hand.
await p.evaluate(async () => {
  const bolt = await Scry.named('Lightning Bolt'), bear = await Scry.named('Grizzly Bears'), giant = await Scry.named('Hill Giant');
  KT.P.hand.unshift({ id: KT.KEY.slice(1, 9) + '-bolt1', owner: KT.KEY, d: bolt }, { id: KT.KEY.slice(1, 9) + '-bear1', owner: KT.KEY, d: bear });
  KT.savePriv();
  await KT.act({ type: 'enter', zone: 'battlefield', cards: [{ id: KT.KEY.slice(1, 9) + '-giant1', d: giant }] });
});
await p.evaluate(() => KT.act({ type: 'start' }));
await wait(800);
// make it the human's turn
for (let i = 0; i < 90; i++) { const mine = await p.evaluate(() => { const g = Object.values(KT.S.cards).find(c => c.id.endsWith('-giant1')); return KT.S.turn.active === KT.KEY && !KT.S.prio && (!g || g.ctlT < KT.S.turn.starts[KT.KEY]); }); if (mine) break; await p.evaluate(async () => { const s = KT.S; if (s.prio && s.prio.holder === KT.KEY) await KT.pass(); if (s.combat && !s.combat.done && s.combat.waiting.includes(KT.KEY) && !s.combat.ok[KT.KEY]) await KT.block([]); }); await wait(700); }
await p.evaluate(async () => { const m = KT.P.hand.find(c => KT.isLand(c) && /Mountain/.test(c.d.faces[0].t)) || KT.P.hand.find(KT.isLand); if (m) await KT.fromHand([m.id], 'battlefield'); });
await wait(400);
await p.evaluate(() => { KT.tab = 'all'; KT.render(); });
await wait(500);
// Cast Lightning Bolt from the hand menu → target picker
await p.click('#hand .card[data-id$="-bolt1"]');
await p.click('.menu >> text=Cast');
await p.waitForSelector('.pickbar');
await p.screenshot({ path: 'test/s1_pick.png' });
const chips = await p.$$eval('.pickbar .pkchoices button', bs => bs.map(b => b.textContent));
console.log('target choices:', chips.join(' | '));
// pick the AI player as the target
const aiName = await p.evaluate(() => KT.S.players[KT.S.seats.find(x => KT.S.players[x].ai)].name);
await p.click(`.pickbar .pkchoices button:has-text("${aiName}")`);
await wait(400);
await p.screenshot({ path: 'test/s2_waiting.png' });
console.log('prio bar:', await p.$eval('.prio', e => e.textContent).catch(() => 'none'));
await p.waitForFunction(() => !KT.S.prio, null, { timeout: 20000 });
console.log('AI life after bolt:', await p.evaluate(() => KT.S.players[KT.S.seats.find(x => KT.S.players[x].ai)].life));
// combat bar
await p.evaluate(() => KT.act({ type: 'phase', to: Rules.PHASES.indexOf('Beginning of combat') }));
await p.waitForSelector('.cpanel');
console.log('giant:', await p.evaluate(() => JSON.stringify([KT.S.turn.n, KT.S.turn.active === KT.KEY, KT.S.turn.starts, Object.values(KT.S.cards).filter(c => c.id.endsWith('-giant1')).map(c => [c.zone, c.ctrl === KT.KEY, c.tapped, c.ctlT])])));
await p.screenshot({ path: 'test/s3_attack.png' });
const giantUp = await p.evaluate(() => !!document.querySelector('.cpanel .cpitem:not(.off) .card[data-id$="-giant1"]'));
if (giantUp) { await p.click('.cpanel .card[data-id$="-giant1"]'); await wait(200); }
console.log('combat window:', await p.$eval('.cpanel', e => e.textContent));
await p.click(giantUp ? '.cpfoot button.primary' : '.cpfoot >> text=No attack');
await p.click('.cpfoot button.primary');   // confirm
await wait(3000);
console.log('after attack:', await p.evaluate(() => KT.S.log.slice(-4).map(l => l.text).join(' | ')));
// open the AI panel
await p.evaluate(() => { KT.aiOpen = true; KT.render(); });
await wait(300);
await p.screenshot({ path: 'test/s4_aipanel.png' });
// pass turn, let the AI play, answer its prompts, and capture a 'Respond?' bar and a block bar
await p.evaluate(() => KT.act({ type: 'phase', dir: 'pass' }));
let gotPrio = false, gotBlock = false;
for (let i = 0; i < 120 && !(gotPrio && gotBlock); i++) {
  const st = await p.evaluate(() => ({ prio: KT.S.prio && KT.S.prio.holder === KT.KEY, block: !!(KT.S.combat && !KT.S.combat.done && KT.S.combat.waiting.includes(KT.KEY) && !KT.S.combat.ok[KT.KEY]), mine: KT.S.turn.active === KT.KEY }));
  if (st.prio && !gotPrio) { await wait(300); await p.screenshot({ path: 'test/s5_respond.png' }); gotPrio = true; console.log('respond bar:', await p.$eval('.prio', e => e.textContent).catch(() => 'none')); }
  if (st.prio) await p.click('.prio button.primary').catch(() => {});
  if (st.block && !gotBlock) { await wait(300); await p.screenshot({ path: 'test/s6_block.png' }); gotBlock = true; console.log('block window:', await p.$eval('.cpanel', e => e.textContent).catch(() => 'none')); await p.click('.cpfoot >> text=No blocks').catch(() => {}); await p.click('.cpfoot button.primary', { timeout: 3000 }).catch(() => console.log('   (no block button — auto no-blocks)')); }
  if (st.mine && !st.prio) await p.evaluate(() => KT.act({ type: 'phase', dir: 'pass' }));
  await wait(700);
}
console.log('ERRORS', errs);
await br.close();
