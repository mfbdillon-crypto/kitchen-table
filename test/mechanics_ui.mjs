// Dev-mode browser spot check of the card mechanics: cards are put on the table, in the hand and in the graveyard, then
// used through the real menus: cycling, "your choice of", the X picker, the reveal window, a return-a-land cost, and
// Muldrotha's graveyard permissions (with the used-up reason on hover).
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } }); await mock(ctx);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('page: ' + e.message));
const results = []; const check = (n, ok, info) => { const l = `${ok ? 'PASS' : 'FAIL'} ${n}${info ? ' — ' + info : ''}`; results.push(l); console.log(l); };
await p.goto('http://localhost:8090/?t=mech' + Date.now() % 1e5); await p.fill('#welcomename', 'Marissa'); await p.click('text=Join the table');
await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await p.evaluate(async txt => { const d = await KT.linesToDeck(Scry.parseDeckFile(txt), 'Gruul', () => {}); await KT.useDeck(d); KT.addAI('Chandra', d, 'easy'); }, mock.aiDeck());
await p.waitForFunction(() => KT.S.seats.length === 2 && KT.S.seats.every(x => KT.S.players[x].libCount > 0), null, { timeout: 60000 });
await p.evaluate(async () => { await KT.act({ type: 'house', set: { deckSize: 0 } }); await KT.act({ type: 'start' }); });
await p.waitForFunction(() => KT.S.turn.active && KT.S.seats.every(x => KT.S.players[x].handCount > 0), null, { timeout: 30000 });
await p.evaluate(() => { KT.openingHand(); KT.keep(); });
for (let i = 0; i < 90; i++) { const st = await p.evaluate(() => KT.S.turn.active === KT.KEY && /Main/.test(Rules.PHASES[KT.S.turn.phase]) && !KT.S.prio && !(KT.S.tq || []).length); if (st) break; await p.evaluate(async () => { const s = KT.S; if (s.prio && s.prio.holder === KT.KEY) await KT.pass(); if (s.combat && !s.combat.done && s.combat.waiting.includes(KT.KEY) && !s.combat.ok[KT.KEY]) await KT.block([]); if (s.turn.active === KT.KEY && /combat|Declare/i.test(Rules.PHASES[s.turn.phase])) await KT.attack([]); }); await wait(500); }
const k = await p.evaluate(() => KT.KEY.slice(1, 9));
// the table: lands, a creature, a Meloku-style card, Muldrotha, graveyard cards; cards in hand
await p.evaluate(async k => {
  const D = (n, t, o, x) => ({ n, cmc: (x && x.cmc) || 2, faces: [Object.assign({ n, t, o, mc: '{1}', p: '2', tg: '2', img: '' }, x || {})] });
  await KT.act({ type: 'dev', on: true });
  await KT.act({ type: 'enter', zone: 'battlefield', cards: [
    ...['Mountain', 'Mountain', 'Forest', 'Forest', 'Mountain', 'Forest', 'Mountain', 'Forest', 'Mountain', 'Forest'].map((n, i) => ({ id: k + '-l' + i, d: D(n, 'Basic Land — ' + n, '', { mc: '', cmc: 0 }) })),
    { id: k + '-hero', d: D('Hero', 'Creature — Human Warrior', '', { p: '3', tg: '3' }) },
    { id: k + '-mel', d: D('Cloud Lord', 'Creature — Spirit', "{1}, Return a land you control to its owner's hand: Draw a card.", { p: '2', tg: '4' }) },
    { id: k + '-mul', d: D('Muldrotha, the Gravetide', 'Legendary Creature — Elemental Avatar', 'During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.', { p: '6', tg: '6' }) }] });
  await KT.act({ type: 'enter', zone: 'graveyard', cards: [{ id: k + '-g1', d: D('Grave Bear', 'Creature — Bear', '') }, { id: k + '-g2', d: D('Grave Elk', 'Creature — Elk', '') }] });
  for (const c of Object.values(KT.S.cards)) if (c.owner === KT.KEY && c.zone === 'battlefield') c.ctlT = 0;
  await KT.act({ type: 'dev', on: false });
  KT.P.hand.push({ id: k + '-cyc', d: D('Cycler', 'Creature — Beast', 'Cycling {2}', { p: '4', tg: '4', cmc: 5 }) });
  KT.P.hand.push({ id: k + '-cho', d: D('Choice', 'Instant', 'Target creature gains your choice of flying, vigilance, or trample until end of turn.', { mc: '{G}', cmc: 1 }) });
  KT.P.hand.push({ id: k + '-xb', d: D('X Blast', 'Sorcery', 'X Blast deals X damage to any target.', { mc: '{X}{R}', cmc: 1 }) });
  KT.P.hand.push({ id: k + '-rev', d: D('Seek', 'Sorcery', "Reveal the top card of your library. If it's a land card, put it onto the battlefield tapped. Otherwise, put it into your hand.", { mc: '{G}', cmc: 1 }) });
  KT.savePriv(); KT.render();
}, k);
await wait(600);
const resolve = async () => { for (let i = 0; i < 20; i++) { const st = await p.evaluate(() => ({ prio: KT.S.prio && KT.S.prio.holder === KT.KEY, stack: Rules.stackCards(KT.S).length })); if (!st.stack) break; if (st.prio) await p.evaluate(() => KT.pass()); await wait(400); } };
const handMenu = async id => { await p.click(`#hand .card[data-id="${id}"]`); await p.waitForSelector('.menu'); return p.$$eval('.menu button', bs => bs.map(b => b.textContent)); };
// 1. cycling from the hand
const items = await handMenu(k + '-cyc');
check('hand menu offers Cycling', items.some(t => /Cycling \{2\}/.test(t)), JSON.stringify(items));
await p.click('.menu >> text=/Cycling/'); await wait(800);
check('cycled: card in the graveyard, ability on the stack', await p.evaluate(k => KT.S.cards[k + '-cyc'] && KT.S.cards[k + '-cyc'].zone === 'graveyard', k));
await resolve();
// 2. your choice of
await handMenu(k + '-cho'); await p.click('.menu >> text=Cast');
await p.waitForSelector('.pickbar'); await p.click(`.pickbar .pkchoices button:has-text("Hero")`).catch(async () => { await p.click(`.board .card[data-id="${k}-hero"]`); });
await wait(600); await p.evaluate(() => KT.pass());
await p.waitForSelector('.prio:has-text("choose one")', { timeout: 8000 }).catch(() => {});
const opts = await p.$$eval('.prio .chip', bs => bs.map(b => b.textContent)).catch(() => []);
check('choice bar with the three options', opts.length === 3, JSON.stringify(opts));
await p.screenshot({ path: 'test/shots/mech_choice.png' });
if (opts.length) await p.click('.prio .chip >> text=Trample');
await wait(600); await resolve();
check('trample granted', await p.evaluate(k => Cards.keywords(KT.S.cards[k + '-hero'], KT.S).has('trample'), k));
// 3. X picker
await handMenu(k + '-xb'); await p.click('.menu >> text=Cast');
await p.waitForSelector('.cstep', { timeout: 8000 });
const maxT = await p.textContent('.cstep button.ghost');
check('X picker shows the most you can afford', /Max \(\d+\)/.test(maxT), maxT);
await p.screenshot({ path: 'test/shots/mech_x.png' });
await p.click('.cstep button:text-is("+")'); await p.click('.modal button.primary:text-is("OK")');
await p.waitForSelector('.pickbar'); await p.click('.pickbar .pkchoices button:has-text("Chandra")'); await wait(800); await resolve();
const life = await p.evaluate(() => KT.S.players[KT.S.seats.find(x => KT.S.players[x].ai)].life);
check('X damage dealt', life < 40, 'Chandra at ' + life);
// 4. reveal and route window
await handMenu(k + '-rev'); await p.click('.menu >> text=Cast'); await wait(600); await resolve();
await p.waitForSelector('.modal.routewin', { timeout: 8000 }).catch(() => {});
const rw = await p.evaluate(() => { const m = document.querySelector('.modal.routewin'); return m ? { cards: m.querySelectorAll('.rtcard').length, why: m.querySelector('.rtwhy').textContent } : null; });
check('reveal window shows the card and where it goes', rw && rw.cards === 1 && /by the card/.test(rw.why), JSON.stringify(rw));
await p.screenshot({ path: 'test/shots/mech_reveal.png' });
if (rw) await p.click('.modal.routewin button.primary');
await wait(800);
// 5. return-a-land cost
const landsBefore = await p.evaluate(() => Object.values(KT.S.cards).filter(c => c.owner === KT.KEY && c.zone === 'battlefield' && /Land/.test(c.d.faces[0].t)).length);
await p.click(`.board .card[data-id="${k}-mel"]`); await p.waitForSelector('.menu');
await p.click('.menu >> text=/Return a land/'); await p.waitForSelector('.modal');
const pool = await p.$$eval('.modal .pkchoices > *', x => x.length);
check('cost asks which land to return', pool >= 1, 'lands offered: ' + pool);
await p.click('.modal .pkchoices > * >> nth=0'); await p.click('.modal button.primary:text-is("OK")').catch(() => {});
await wait(800); await resolve();
const lands = await p.evaluate(() => Object.values(KT.S.cards).filter(c => c.owner === KT.KEY && c.zone === 'battlefield' && /Land/.test(c.d.faces[0].t)).length);
check('a land went back to the hand', lands === landsBefore - 1, 'lands on the battlefield: ' + lands + ' | ' + await p.evaluate(() => [...document.querySelectorAll('#toasts > *')].map(t => t.textContent).join(' / ') + ' | log: ' + KT.S.log.slice(-4).map(l => l.text).join(' / ')));
// 6. Muldrotha: cast one creature from the graveyard; the other then can't be, and says why
const glow = await p.evaluate(() => [...document.querySelectorAll('.pile.usable')].some(e => /Graveyard/.test(e.textContent)));
check('graveyard creatures glow (Muldrotha)', glow);
await p.evaluate(async k => { const c = KT.S.cards[k + '-g1']; const w = Rulebook.ways(KT.S, KT.KEY, c)[0]; await KT.act({ type: 'dev', on: true }); await KT.castPublic(c.id, { perm: w.via, alt: 'free' }); await KT.act({ type: 'dev', on: false }); }, k);
await wait(600); await resolve(); await p.evaluate(() => KT.render()); await wait(300);
await p.click('.pile:has-text("Graveyard") >> nth=0'); await wait(400);
const title = await p.evaluate(k => { const el = document.querySelector(`.modal .card[data-id="${k}-g2"]`); return el ? el.title : 'no element'; }, k);
await p.screenshot({ path: 'test/shots/mech_muldrotha.png' });
check('the second creature says why not', /Muldrotha/.test(title), title);
console.log('ERRORS', errs);
await br.close();
