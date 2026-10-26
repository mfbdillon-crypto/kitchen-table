// Phone as hand: rows below the hand for cards usable from elsewhere — graveyard (flashback words highlighted; Muldrotha's
// grant as a green banner), and abilities on the battlefield — and using them from the phone.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const browser = await chromium.launch(); const errs = []; const wait = ms => new Promise(r => setTimeout(r, ms));
const results = []; const check = (n, ok, info) => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${info ? ' — ' + info : ''}`);
async function ctxp(name, o) { const ctx = await browser.newContext(o || { viewport: { width: 1440, height: 900 } }); await mock(ctx); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(name + ': ' + e.message)); return { ctx, page }; }
const T = 'pe' + Date.now() % 1e5;
const A = await ctxp('computer');
await A.page.goto('http://localhost:8090/?t=' + T); await A.page.fill('#welcomename', 'Marissa'); await A.page.click('text=Join the table');
await A.page.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await A.page.evaluate(async txt => { const d = await KT.linesToDeck(Scry.parseDeckFile(txt), 'Gruul', () => {}); await KT.useDeck(d); KT.addAI('Chandra', d, 'easy'); }, mock.aiDeck());
await A.page.waitForFunction(() => KT.S.seats.length === 2 && KT.S.seats.every(x => KT.S.players[x].libCount > 0), null, { timeout: 60000 });
await A.page.evaluate(async () => { await KT.act({ type: 'house', set: { deckSize: 0 } }); await KT.act({ type: 'start' }); });
await A.page.waitForFunction(() => KT.S.turn.active && KT.S.seats.every(x => KT.S.players[x].handCount > 0), null, { timeout: 30000 });
await A.page.evaluate(() => { KT.openingHand(); KT.keep(); });
// my turn, main phase
for (let i = 0; i < 90; i++) { const st = await A.page.evaluate(() => KT.S.turn.active === KT.KEY && /Main/.test(Rules.PHASES[KT.S.turn.phase]) && !KT.S.prio); if (st) break; await A.page.evaluate(async () => { const s = KT.S; if (s.prio && s.prio.holder === KT.KEY) await KT.pass(); if (s.combat && !s.combat.done && s.combat.waiting.includes(KT.KEY) && !s.combat.ok[KT.KEY]) await KT.block([]); if (s.turn.active === KT.KEY && /combat|Declare/i.test(Rules.PHASES[s.turn.phase])) await KT.attack([]); }); await wait(500); }
// set the table: Muldrotha, a creature card and a flashback spell in my graveyard, a permanent with an activated ability, lands
await A.page.evaluate(async () => {
  const D = (n, t, o, x) => ({ n, cmc: 2, faces: [Object.assign({ n, t, o, mc: '{1}', p: '2', tg: '2', img: '' }, x || {})] });
  const k = KT.KEY.slice(1, 9);
  await KT.act({ type: 'dev', on: true });
  await KT.act({ type: 'enter', zone: 'battlefield', cards: [
    { id: k + '-mul', d: D('Muldrotha, the Gravetide', 'Legendary Creature — Elemental Avatar', 'During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.', { p: '6', tg: '6' }) },
    { id: k + '-pinger', d: D('Pinger', 'Creature — Human Wizard', '{T}: This deals 1 damage to any target.') },
    ...['Mountain', 'Forest', 'Mountain', 'Forest'].map((n, i) => ({ id: k + '-l' + i, d: D(n, 'Basic Land — ' + n, '', { mc: '' }) }))] });
  await KT.act({ type: 'enter', zone: 'graveyard', cards: [{ id: k + '-gb', d: D('Grave Bear', 'Creature — Bear', '') }, { id: k + '-fb', d: D('Firebolt', 'Sorcery', 'Firebolt deals 2 damage to any target.\nFlashback {4}{R}', { mc: '{R}' }) }] });
  for (const c of Object.values(KT.S.cards)) if (c.owner === KT.KEY && c.zone === 'battlefield') c.ctlT = 0;
  await KT.act({ type: 'dev', on: false });
});
// link a phone
await A.page.evaluate(() => KT.startPhoneLink && KT.startPhoneLink());
const url = await A.page.evaluate(() => KT.phoneURL());
const PH = await ctxp('phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await PH.page.goto(url); await A.page.waitForSelector('text=Allow — it’s my phone', { timeout: 15000 }); await A.page.click('text=Allow — it’s my phone');
await PH.page.waitForSelector('.prow', { timeout: 20000 });
await wait(800);
const rows = await PH.page.$$eval('.prowt', ts => ts.map(t => t.textContent));
check('rows below the hand', rows.includes('From your graveyard') && rows.includes('Abilities on the battlefield'), JSON.stringify(rows));
const grants = await PH.page.$$eval('.pgrant', g => g.map(x => x.textContent));
check('Muldrotha banner on the graveyard creature', grants.some(g => /Castable through Muldrotha/.test(g)), JSON.stringify(grants));
check('flashback words highlighted', grants.some(g => /^Flashback \{4\}\{R\}/.test(g)), JSON.stringify(grants));
check('not shown on the computer page', await A.page.locator('.prow').count() === 0);
await PH.page.screenshot({ path: 'test/shots/phone_elsewhere.png', fullPage: true });
// cast the Grave Bear from the graveyard through the phone
await PH.page.click('.prow:has-text("From your graveyard") .pc:has(.pgrant:has-text("Muldrotha"))');
await PH.page.waitForSelector('.pbig .pacts');
await PH.page.screenshot({ path: 'test/shots/phone_elsewhere_big.png' });
await PH.page.click('.pbig .pacts button.primary');
await wait(1500);
check('cast from the graveyard via the phone', await A.page.evaluate(k => { const c = KT.S.cards[k + '-gb']; return !!c && (c.zone === 'stack' || c.zone === 'battlefield'); }, await A.page.evaluate(() => KT.KEY.slice(1, 9))));
// use the Pinger's ability from the phone (target picked on the phone)
await PH.page.click('.prow:has-text("Abilities on the battlefield") .pc >> nth=0').catch(() => {});
await wait(300);
const abBtns = await PH.page.$$eval('.pbig .pacts button', bs => bs.map(b => b.textContent));
check('abilities listed with their costs', abBtns.some(t => /\{T\}/.test(t)), JSON.stringify(abBtns));
console.log(results.join('\n')); console.log('ERRORS', errs);
await browser.close();
