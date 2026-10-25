import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const jsQR = require('jsqr'); const { PNG } = require('pngjs');
const wait = ms => new Promise(r => setTimeout(r, ms)); const errs = [];
const b = await chromium.launch(); const T = 'ux' + Date.now() % 100000;
const dctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await mock(dctx); const M = await dctx.newPage(); M.on('pageerror', e => errs.push('desk: ' + e.message));
await M.goto('http://localhost:8090/?t=' + T); await M.fill('#welcomename', 'Ben'); await M.click('text=Join the table'); await M.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await M.evaluate(() => KT.openDecks()); await M.setInputFiles('#importfile', 'test/deck.csv'); await M.waitForSelector('text=Imported');
await M.click('.dline:has-text("Alesha") .star'); await M.click('text=Play this deck'); await wait(800);
await M.evaluate(() => { KT.openingHand(); KT.keep(); });
await M.click('#top button:has-text("Phone")');
const png = PNG.sync.read(await M.locator('.qr').screenshot()); const url = jsQR(new Uint8ClampedArray(png.data), png.width, png.height).data;
await M.click('.modal .x');
// 1) prompt appears even while Decks is open
await M.evaluate(() => KT.openDecks()); await wait(300);
const pc = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await mock(pc); const P = await pc.newPage(); P.on('pageerror', e => errs.push('phone: ' + e.message));
await P.goto(url); await P.waitForSelector('.pcode b', { timeout: 15000 }); const code1 = await P.textContent('.pcode b');
await M.waitForSelector('.overlay.top >> text=Link a phone as your hand?', { timeout: 6000 }).then(() => console.log('1) prompt shows over the open Decks window: true')).catch(() => console.log('1) prompt shows over Decks: FALSE'));
// 2) phone reloads while asking -> same code
await P.reload(); await P.waitForSelector('.pcode b', { timeout: 15000 }); const code2 = await P.textContent('.pcode b'); await wait(1500);
console.log('2) code before/after phone reload:', code1, code2, '| computer prompt shows:', await M.textContent('.overlay.top .pcode b'));
// 3) refuse, then "ask again" from the phone
await M.click('.overlay.top >> text=Don’t allow'); await P.waitForSelector('text=It’s my phone — ask again', { timeout: 8000 });
await P.click('text=It’s my phone — ask again'); await wait(2500);
console.log('3) ask again right away is rate limited (no new prompt):', !(await M.locator('.overlay.top').count()));
await wait(19000); await P.click('text=It’s my phone — ask again').catch(() => {}); await M.waitForSelector('.overlay.top', { timeout: 8000 }).then(() => console.log('3b) after 20 s, asking again shows a new prompt: true')).catch(() => console.log('3b) new prompt: FALSE'));
await M.click('.overlay.top >> text=Allow — it’s my phone'); await P.waitForSelector('.pc', { timeout: 8000 }); console.log('   allowed -> phone cards', await P.locator('.pc').count());
// 4) new code clears the old phone right away
await M.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.remove()));
const t0 = Date.now(); await M.evaluate(() => KT.resetPhone());
await P.waitForFunction(() => !document.querySelector('.pc'), null, { timeout: 15000 }); console.log('4) old phone cleared after new code in', Date.now() - t0, 'ms; says:', await P.textContent('.pturn'));
// 5) mid-game print change shows on the table
await M.evaluate(() => KT.openDecks()); await M.click('.cmdpanel >> text=Choose print'); await M.waitForSelector('.printgrid .print');
await M.click('.print:has-text("Commander Masters")'); await M.click('.pfoot >> text=Foil-etched'); await M.click('text=Use this print'); await wait(1200);
console.log('5) commander on table now:', await M.evaluate(() => { const c = Object.values(KT.S.cards).find(c => c.zone === 'command'); return c.d.faces[0].img.split('/').pop() + ' fin=' + c.d.fin; }));
// 6) Scryfall down -> Try again / Back
await dctx.route('https://api.scryfall.com/cards/named**', r => r.abort());
await M.click('.dline:has-text("Sol Ring") .artbtn').catch(async () => { await M.evaluate(() => KT.openDecks()); await M.click('.dline:has-text("Sol Ring") .artbtn'); });
await M.waitForSelector('text=Try again', { timeout: 8000 }).then(() => console.log('6) Scryfall down -> Try again + Back to deck shown: true')).catch(() => console.log('6) FALSE'));
await M.click('text=Back to deck'); console.log('   back in Decks:', await M.locator('.decklist').count() > 0);
console.log('ERRORS', errs); await b.close();
