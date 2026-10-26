// The combat window: opponent tabs + creature strip for attacking; attacker lanes with arrows and overlapping blockers for
// blocking; a confirmation step for both.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } }); await mock(ctx);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('page: ' + e.message)); p.on('console', m => { if (/ai attack/.test(m.text())) console.log(m.text()); });
const results = []; const check = (n, ok, info) => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${info ? ' — ' + info : ''}`);
await p.goto('http://localhost:8090/?t=cb' + Date.now() % 1e5); await p.fill('#welcomename', 'Marissa'); await p.click('text=Join the table');
await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await p.evaluate(async txt => { const d = await KT.linesToDeck(Scry.parseDeckFile(txt), 'Gruul Test', () => {}); await KT.useDeck(d); KT.addAI('Chandra', d, 'easy'); KT.addAI('Nissa', d, 'easy'); }, mock.aiDeck());
await p.waitForFunction(() => KT.S.seats.length === 3 && KT.S.seats.every(x => KT.S.players[x].libCount > 0), null, { timeout: 60000 });
await p.evaluate(async () => { await KT.act({ type: 'house', set: { deckSize: 0 } }); await KT.act({ type: 'start' }); });
await p.waitForFunction(() => KT.S.turn.active && KT.S.seats.every(x => KT.S.players[x].handCount > 0), null, { timeout: 30000 });
await p.evaluate(() => { KT.openingHand(); KT.keep(); });
// creatures for me (already in play) and for the AIs
await p.evaluate(async () => {
  const bear = await Scry.named('Grizzly Bears'), giant = await Scry.named('Hill Giant');
  await KT.act({ type: 'dev', on: true });
  const k = KT.KEY.slice(1, 9);
  await KT.act({ type: 'enter', zone: 'battlefield', cards: [{ id: k + '-g1', d: giant }, { id: k + '-b1', d: bear }, { id: k + '-b2', d: bear }, { id: k + '-b3', d: bear }] });
  for (const c of Object.values(KT.S.cards)) if (c.owner === KT.KEY && c.zone === 'battlefield') c.ctlT = 0;
});
// wait for my turn's combat
for (let i = 0; i < 120; i++) { const st = await p.evaluate(() => [KT.S.turn.active === KT.KEY, Rules.PHASES[KT.S.turn.phase], !!KT.S.prio]); if (st[0] && !st[2]) break; await p.evaluate(async () => { const s = KT.S; if (s.prio && s.prio.holder === KT.KEY) await KT.pass(); if (s.combat && !s.combat.done && s.combat.waiting.includes(KT.KEY) && !s.combat.ok[KT.KEY]) await KT.block([]); }); await wait(600); }
await p.evaluate(() => KT.act({ type: 'phase', to: Rules.PHASES.indexOf('Beginning of combat') }));
await p.waitForSelector('.cpanel.atk', { timeout: 15000 });
const box = await p.evaluate(() => { const b = document.querySelector('.cpanel').getBoundingClientRect(); return { a: b.width * b.height / (innerWidth * innerHeight), cx: b.left + b.width / 2 - innerWidth / 2 }; });
check('attack window ~quarter of the screen, centred', box.a > 0.15 && box.a < 0.45 && Math.abs(box.cx) < 20, JSON.stringify(box));
const tabs = await p.$$eval('.cptab', bs => bs.map(b => [b.textContent, Math.round(b.getBoundingClientRect().width)]));
check('a tab per opponent, evenly spaced', tabs.length === 2 && Math.abs(tabs[0][1] - tabs[1][1]) < 3, JSON.stringify(tabs));
const k = await p.evaluate(() => KT.KEY.slice(1, 9));
await p.click(`.cpanel [data-id="${k}-g1"]`);
await p.click('.cptab >> nth=1');
await p.click(`.cpanel [data-id="${k}-b1"]`);
await p.screenshot({ path: 'test/shots/combat_attack.png' });
const labs = await p.$$eval('.cpitem.sent .cplab', ls => ls.map(l => l.textContent));
check('creatures go to the chosen tab', labs.length === 2 && labs[0] !== labs[1], JSON.stringify(labs));
await p.click('.cpfoot >> text=/^Attack/');
await p.waitForSelector('.cpsum');
check('confirm step lists the attack', /←/.test(await p.$eval('.cpsum', e => e.textContent)), await p.$eval('.cpsum', e => e.textContent));
await p.screenshot({ path: 'test/shots/combat_confirm.png' });
await p.click('.cpfoot >> text=/Confirm attack/');
await wait(1500);
check('attack declared', await p.evaluate(k => !!(KT.S.combat && KT.S.combat.att[k + '-g1'] && KT.S.combat.att[k + '-b1']), k));
// ---- blocking: make an AI attack me
await p.evaluate(async () => {
  const s = KT.S; for (let i = 0; i < 20 && s.combat && !s.combat.done; i++) { if (s.prio && s.prio.holder === KT.KEY) await KT.pass(); await new Promise(r => setTimeout(r, 300)); }
});
for (let i = 0; i < 160; i++) {
  const st = await p.evaluate(() => !!document.querySelector('.cpanel.def:not(.min) .cplane'));
  if (st) break;
  await p.evaluate(async () => {
    const s = KT.S; if (s.prio && s.prio.holder === KT.KEY) await KT.pass();
    if (s.turn.active === KT.KEY && !s.prio && s.turn.goal !== 'pass') await KT.act({ type: 'advance', goal: 'end' });
    // give the active AI something to attack me with, once it's their turn
    const a = s.turn.active; const ph = Rules.PHASES[s.turn.phase];
    if (a !== KT.KEY && s.players[a].ai && !window._gave && /Main 1|Upkeep|Draw/.test(ph) && !s.prio && !(s.tq || []).length) { window._gave = true; const dr = await Scry.named('Hill Giant'), ogre = await Scry.named('Grizzly Bears');
      await KT.act({ type: 'enter', zone: 'battlefield', as: a, cards: [{ id: 'x-atk1', d: dr }, { id: 'x-atk2', d: ogre }] });
      for (const id of ['x-atk1', 'x-atk2']) if (s.cards[id]) s.cards[id].ctlT = 0;
      await KT.act({ type: 'phase', as: a, to: Rules.PHASES.indexOf('Declare attackers'), force: true });
      const r = await KT.act({ type: 'attack', as: a, list: [{ id: 'x-atk1', p: KT.KEY }, { id: 'x-atk2', p: KT.KEY }] }); console.log('ai attack', JSON.stringify(r)); }
  });
  await wait(500);
}
console.log('state', await p.evaluate(() => JSON.stringify([KT.S.turn.n, KT.S.players[KT.S.turn.active].name, Rules.PHASES[KT.S.turn.phase], !!window._gave, KT.S.combat && Object.keys(KT.S.combat.att), KT.S.prio && KT.S.prio.holder === KT.KEY])));
const lanes = await p.$$eval('.cpanel.def .cplane', ls => ls.length).catch(() => 0);
check('block window shows the attackers as lanes with arrows', lanes > 0 && await p.locator('.cpanel.def .cparrow').count() === lanes, 'lanes ' + lanes);
if (lanes) {
  const att0 = await p.$eval('.cpanel.def .cplane .card', e => e.dataset.id);
  const bl = await p.$$eval('.cpanel.def .cppool .cpitem:not(.off) .card', cs => cs.map(c => c.dataset.id));
  for (const b of bl.slice(0, 3)) { await p.click(`.cpanel [data-id="${b}"]`); await p.click(`.cpanel .cplane:has([data-id="${att0}"]) .cpname`); }
  await p.screenshot({ path: 'test/shots/combat_block.png' });
  const inSlot = await p.$$eval('.cpanel .cplane >> nth=0', () => 0).catch(() => 0);
  const slotN = await p.evaluate(a => { const lane = [...document.querySelectorAll('.cpanel .cplane')].find(l => l.querySelector(`[data-id="${a}"]`)); const bs = lane ? [...lane.querySelectorAll('.cpblk')] : []; const r = bs.map(b => b.getBoundingClientRect()); return { n: bs.length, overlap: r.length > 1 ? (r[0].right - r[1].left) / r[0].width : 0 }; }, att0);
  check('blockers move in front of the attacker, overlapping', slotN.n >= 2 && slotN.overlap > 0.3, JSON.stringify(slotN));
  await p.click('.cpfoot >> text=/^Block/');
  await p.waitForSelector('.cpanel .cpsum');
  check('confirm step lists the blocks', /blocked by/.test(await p.$eval('.cpsum', e => e.textContent)));
  await p.screenshot({ path: 'test/shots/combat_block_confirm.png' });
  await p.click('.cpfoot >> text=/^Confirm/');
  await wait(1200);
  check('blocks declared', await p.evaluate(() => !document.querySelector('.cpanel.def')));
}
// phone width
await p.setViewportSize({ width: 390, height: 844 }); await wait(400);
await p.screenshot({ path: 'test/shots/combat_phone.png' });
console.log(results.join('\n')); console.log('ERRORS', errs);
await br.close();
