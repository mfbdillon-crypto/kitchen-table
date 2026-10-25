import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const jsQR = require('jsqr'); const { PNG } = require('pngjs');
const wait = ms => new Promise(r => setTimeout(r, ms)); const errs = [];
const b = await chromium.launch(); const T = 'wh' + Date.now() % 100000;
async function desk(name) { const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await mock(ctx); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message));
  await p.goto('http://localhost:8090/?t=' + T); await p.fill('#welcomename', name); await p.click('text=Join the table'); await p.waitForFunction(n => KT.me && KT.me() && KT.me().name === n, name, { timeout: 20000 });
  await p.click('#top >> text=Decks'); await p.setInputFiles('#importfile', 'test/deck.csv'); await p.waitForSelector('text=Imported'); await p.click('text=Play this deck'); await wait(700);
  await p.evaluate(() => { KT.openingHand(); KT.keep(); }); return p; }
async function phone(name) { const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }); await mock(ctx); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message)); return p; }
const qrOf = async (p, sel) => { const png = PNG.sync.read(await p.locator(sel).screenshot()); return jsQR(new Uint8ClampedArray(png.data), png.width, png.height).data; };
const M = await desk('Marissa'); const A = await desk('Alex');
// Invite QR
await A.click('#top button.invite'); const inviteUrl = await qrOf(A, '.qr'); console.log('invite QR:', inviteUrl, '| has hand secret?', /[?&]k=|m=hand/.test(inviteUrl)); await A.click('.modal .x');
// Marissa's hand code
await M.click('#top button:has-text("Phone")'); const handUrl = await qrOf(M, '.qr');
// 1) Alex's phone scans Marissa's hand code -> Marissa is asked; she says no
const AP = await phone('AlexPhone'); await AP.goto(handUrl);
await M.waitForSelector('text=Link a phone as your hand?', { timeout: 15000 }); console.log('Marissa asked before anything is shown: true');
console.log('Alex phone while waiting:', (await AP.textContent('.phone')).slice(0, 90), '| cards shown:', await AP.locator('.pc').count());
await M.click('text=Don’t allow'); await wait(3500);
console.log('after deny -> Alex phone cards:', await AP.locator('.pc').count(), '| says:', await AP.textContent('.pturn'), '| Marissa linked?', await M.evaluate(() => KT.phoneLinked));
// 2) Alex's phone opens the invite -> joins as its own player, no one's hand
const AP2 = await phone('AlexPhone2'); await AP2.goto(inviteUrl); await AP2.fill('#welcomename', 'Alex phone'); await AP2.click('text=Join the table');
await AP2.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
console.log('invite on phone -> own seat:', await AP2.evaluate(() => KT.me().name), '| hand mode?', await AP2.evaluate(() => KT.MODE), '| hand cards:', await AP2.evaluate(() => KT.P.hand.length), '| seats:', await M.evaluate(() => KT.S.seats.length));
// 3) Marissa's own phone: allow once, then it reconnects without asking
await M.click('#top button:has-text("Phone")').catch(() => {});
const MP = await phone('MarissaPhone'); await MP.goto(handUrl);
await M.waitForSelector('text=Link a phone as your hand?', { timeout: 15000 }); await M.click('text=Allow — it’s my phone');
await MP.waitForSelector('.pc', { timeout: 10000 }); console.log('Marissa phone after allow: cards', await MP.locator('.pc').count(), '= her hand', await M.evaluate(() => KT.P.hand.length));
await MP.reload(); await MP.waitForSelector('.pc', { timeout: 15000 }); console.log('after phone reload, no second prompt:', !(await M.locator('text=Link a phone as your hand?').count()));
// 4) New code: old link stops working
await M.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.remove()));
await M.evaluate(() => KT.resetPhone()); await wait(1500);
const AP3 = await phone('AlexPhone3'); await AP3.goto(handUrl); await wait(6000);
console.log('old code after reset -> cards:', await AP3.locator('.pc').count(), '| prompt on Marissa?', await M.locator('text=Link a phone as your hand?').count(), '| says:', await AP3.textContent('.pturn'));
console.log('ERRORS', errs); await b.close();
