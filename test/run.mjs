import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mock = require('./mock.js');
const URL = 'http://localhost:8090/';
const browser = await chromium.launch();
const errs = [];
async function player(name, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, opts || {}));
  await mock(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(name + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
  return { ctx, page, name };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function join(P) {
  await P.page.goto(URL);
  await P.page.fill('#welcomename', P.name);
  await P.page.click('text=Join the table');
  await P.page.waitForSelector('#top', { timeout: 20000 });
  await P.page.waitForFunction(n => window.KT.me && window.KT.me() && window.KT.me().name === n, P.name, { timeout: 15000 });
}
async function importDeck(P) {
  await P.page.evaluate(() => KT.openDecks());
  await P.page.setInputFiles('#importfile', 'test/deck.csv');
  await P.page.waitForSelector('.dk', { timeout: 15000 });
  await P.page.waitForSelector('text=Imported', { timeout: 15000 });
  const msg = await P.page.textContent('.decklist .muted');
  // mark Alesha as commander
  await P.page.click('.dline:has-text("Alesha") .star');
  await P.page.click('text=Play this deck');
  await P.page.waitForFunction(() => window.KT.P.library.length > 50, null, { timeout: 15000 });
  return msg;
}
const A = await player('Marissa'), B = await player('Alex'), C = await player('Sam');
await join(A); await join(B); await join(C);
await wait(800);
console.log('seats seen by C:', await C.page.evaluate(() => KT.S.seats.map(p => KT.S.players[p].name).join(',')));
console.log('A import:', await importDeck(A));
await importDeck(B);
console.log('A cmd zone:', await A.page.evaluate(() => Object.values(KT.S.cards).filter(c => c.zone === 'command').map(c => c.d.n)));
console.log('A lib', await A.page.evaluate(() => KT.P.library.length));
// start game & opening hand
await A.page.click('text=Start game'); await wait(500);
let landsOk = 0;
for (let i = 0; i < 30; i++) {
  const r = await A.page.evaluate(() => { const P = KT.P; P.library.push(...P.hand); P.hand = []; P.phase = 'none'; KT.openingHand(); return [P.hand.length, P.hand.filter(KT.isLand).length]; });
  if (r[0] === 7 && r[1] >= 3) landsOk++;
}
console.log('opening hands with 7 cards & >=3 lands:', landsOk, '/ 30');
await wait(300);
console.log('mulligan prompt shown:', await A.page.isVisible('text=Keep this opening hand?'));
await A.page.click('.mcard button:text-is("Mulligan")'); await wait(200);
await A.page.click('.mcard button:text-is("Mulligan")'); await wait(200);
await A.page.click('.mcard button:text-is("Keep")'); await wait(300);
console.log('bottom picker:', await A.page.isVisible('text=Put 1 card on the bottom'));
await A.page.click('.mcard .card >> nth=0'); await A.page.click('.mcard >> text=Put 1/1');
await wait(300);
console.log('hand after bottom:', await A.page.evaluate(() => KT.P.hand.length));
// play a land and a creature via menus
for (let i = 0; i < 4 && !(await A.page.evaluate(() => KT.S.turn.active === KT.KEY)); i++) { for (const X of [A, B, C].filter(Boolean)) await X.page.evaluate(() => { if (KT.S.turn.active === KT.KEY) return KT.act({ type: 'phase', dir: 'pass' }); }); await wait(400); }
const land = await A.page.evaluate(() => KT.P.hand.find(KT.isLand).id);
await A.page.click(`#hand .card[data-id="${land}"]`); await A.page.click('.menu >> text=Play land'); await wait(400);
await A.page.evaluate(() => { const c = KT.P.library.find(x => /Creature/.test(x.d.faces[0].t)); KT.P.library.splice(KT.P.library.indexOf(c), 1); KT.P.hand.push(c); KT.savePriv(); });
const cre = await A.page.evaluate(() => KT.P.hand.find(x => /Creature/.test(x.d.faces[0].t)).id);
await A.page.click(`#hand .card[data-id="${cre}"]`); await A.page.click('.menu >> text=Move to'); await A.page.click('.menu >> text=Battlefield (an effect puts it there)'); await wait(500);
console.log('B sees A battlefield:', await B.page.evaluate(() => Object.values(KT.S.cards).filter(c => c.zone === 'battlefield').map(c => c.d.n + ':' + c.row)));
// tap by clicking
await A.page.click(`.brow.creatures .card[data-id="${cre}"]`); await A.page.click('.menu >> text=Tap'); await wait(300);
// counters
await A.page.click(`.brow.creatures .card[data-id="${cre}"]`); await A.page.click('.menu >> text=Counters…');
await A.page.click('.modal .chips >> text="+1/+1"'); await A.page.click('.modal .chips >> text="+1/+1"'); await A.page.click('.modal .chips >> text="-1/-1"'); await A.page.click('.modal .chips >> text=flying'); await wait(400);
await A.page.click('.modal .x');
console.log('counters:', await A.page.evaluate(id => JSON.stringify(KT.S.cards[id].counters) + ' tapped=' + KT.S.cards[id].tapped, cre), 'pt badge:', await A.page.textContent(`.card[data-id="${cre}"] .pt`));
// B tries to tap A's creature - should not
await B.page.click('#tabs >> text=Marissa'); await wait(200);
await B.page.click(`.card[data-id="${cre}"]`); console.log('B sees note:', await B.page.textContent('.menu')); await B.page.keyboard.press('Escape'); await wait(300);
console.log('after B click tapped still:', await A.page.evaluate(id => KT.S.cards[id].tapped, cre));
// give control to Alex
await A.page.click(`.card[data-id="${cre}"]`); await A.page.click('.menu >> text=Give control to'); await A.page.click('.menu >> text=Alex'); await wait(500);
console.log('ctrl:', await B.page.evaluate(id => KT.S.cards[id].ctrl === KT.KEY, cre));
await B.page.click('#tabs >> text=My board'); await wait(200);
await B.page.screenshot({ path: 'test/B_board.png' });
// B returns it to hand -> goes to A's hand
await B.page.click(`.card[data-id="${cre}"]`); await B.page.click('.menu >> text=Move to'); await B.page.click('.menu >> text=Hand (return to hand)'); await wait(800);
console.log('back in A hand:', await A.page.evaluate(id => KT.P.hand.some(c => c.id === id), cre));
// scry 2 + search
await A.page.click('#hand >> text=Library ▾'); await A.page.click('.menu >> text=Scry X…'); await A.page.fill('#num-in', '2'); await A.page.click('.modal >> text=OK');
await A.page.click('.lookcard >> nth=0 >> text=Bottom'); await A.page.click('.modal >> text=Done'); await wait(400);
await A.page.click('#hand >> text=Library ▾'); await A.page.click('.menu >> text=Search your library…');
await A.page.fill('#libsearch', 'Creature'); await wait(200);
await A.page.click('.gridcards .card'); await A.page.click('.menu >> text=Put into hand'); await A.page.click('.modal >> text=Done — shuffle'); await wait(600);
console.log('log tail (B):', await B.page.evaluate(() => KT.S.log.slice(-6).map(e => KT.R.nameOf(KT.S, e.pid) + ' ' + e.text)));
// tokens
await A.page.click('#top >> text=Tokens'); await A.page.waitForSelector('.gridcards .card'); await A.page.click('.gridcards .card >> nth=0'); await wait(400); await A.page.click('.modal .x');
// zone viewer
await A.page.evaluate(async () => { await KT.mill(3); }); await wait(400);
await A.page.click('.pile:has-text("Graveyard")'); await wait(300);
console.log('graveyard viewer cards:', await A.page.locator('.zoneview .card').count()); await A.page.click('.modal .x');
// turn pass & untap
const active = await A.page.evaluate(() => KT.S.turn.active);
const who = [A, B, C].find(async P => true);
await A.page.screenshot({ path: 'test/A_board.png' });
await A.page.click('#tabs >> text=All players'); await wait(300); await A.page.screenshot({ path: 'test/A_all.png' });
// phone
await A.page.click('#top >> text=Phone'); await wait(500);
const phoneURL = await A.page.evaluate(() => KT.phoneURL());
const PH = await player('phone', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
await PH.page.goto(phoneURL.replace(/^https?:\/\/[^/]+/, 'http://localhost:8090')); await A.page.waitForSelector('text=Allow — it’s my phone', { timeout: 15000 }); await A.page.click('text=Allow — it’s my phone');
await PH.page.waitForSelector('.pc', { timeout: 20000 });
console.log('phone hand cards:', await PH.page.locator('.pc').count(), 'A hand:', await A.page.evaluate(() => KT.P.hand.length), 'A hides hand:', await A.page.isVisible('text=your hand is on your phone'));
await PH.page.screenshot({ path: 'test/phone.png' });
await PH.page.click('.pc >> nth=0'); await PH.page.click('.pacts button.primary'); await wait(800);
console.log('after phone play, A hand:', await A.page.evaluate(() => KT.P.hand.length), 'phone:', await PH.page.locator('.pc').count());
// failover: close A (host)
await A.ctx.close(); await wait(14000);
console.log('B status:', await B.page.evaluate(() => KT.status), 'C status:', await C.page.evaluate(() => KT.status));
const r = await C.page.evaluate(() => KT.act({ type: 'dice', sides: 20 }));
console.log('C act after failover ok:', r.ok, await B.page.evaluate(() => KT.S.log.slice(-1)[0].text));
// phone-only full board
const PF = await player('Pat', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
await join(PF); await wait(500); await PF.page.screenshot({ path: 'test/phone_full.png' });
console.log('ERRORS:', errs.length ? errs.slice(0, 10) : 'none');
await browser.close();
