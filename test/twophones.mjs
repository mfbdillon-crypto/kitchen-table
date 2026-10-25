import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const jsQR = require('jsqr'); const { PNG } = require('pngjs');
const wait = ms => new Promise(r => setTimeout(r, ms)); const errs = [];
const b = await chromium.launch(); const T = 'tp' + Date.now() % 100000;
const dctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await mock(dctx); const M = await dctx.newPage(); M.on('pageerror', e => errs.push('desk: ' + e.message));
await M.goto('http://localhost:8090/?t=' + T); await M.fill('#welcomename', 'Ben'); await M.click('text=Join the table'); await M.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await M.click('#top >> text=Decks'); await M.setInputFiles('#importfile', 'test/deck.csv'); await M.waitForSelector('text=Imported'); await M.click('text=Play this deck'); await wait(700);
await M.evaluate(() => { KT.openingHand(); KT.keep(); });
await M.click('#top button:has-text("Phone")');
const png = PNG.sync.read(await M.locator('.qr').screenshot()); const url = jsQR(new Uint8ClampedArray(png.data), png.width, png.height).data;
async function phone(n) { const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await mock(c); const p = await c.newPage(); p.on('pageerror', e => errs.push(n + ': ' + e.message)); return p; }
const own = await phone('own'); await own.goto(url); await own.waitForSelector('.pcode b', { timeout: 15000 });
const stranger = await phone('stranger'); await wait(1500); await stranger.goto(url); await stranger.waitForSelector('.pcode b', { timeout: 15000 });
const ownCode = await own.textContent('.pcode b'), strCode = await stranger.textContent('.pcode b');
await M.waitForSelector('text=Link a phone as your hand?'); await wait(800);
const shown1 = await M.textContent('.modal .pcode b');
console.log('own phone code', ownCode, '| stranger code', strCode, '| prompt shows', shown1, '(should be own: ' + (shown1 === ownCode) + ')');
await wait(1500); const shown1b = await M.textContent('.modal .pcode b'); console.log('prompt unchanged after stranger scan:', shown1b === shown1);
await M.click('text=Allow — it’s my phone'); await wait(600);
const shown2 = await M.locator('.modal .pcode b').count() ? await M.textContent('.modal .pcode b') : 'none';
console.log('second, separate prompt for the stranger:', shown2, '(matches stranger: ' + (shown2 === strCode) + ')');
await M.click('text=Don’t allow'); await wait(3500);
console.log('own phone cards:', await own.locator('.pc').count(), '| stranger cards:', await stranger.locator('.pc').count(), '| stranger says:', await stranger.textContent('.pturn'));
// approve a 2nd device of mine (tablet) -> takes over without flapping
const tab = await phone('tablet'); await tab.goto(url); await M.waitForSelector('text=Link a phone as your hand?', { timeout: 15000 }); await M.click('text=Allow — it’s my phone');
let toasts = 0; M.on('console', () => {}); const t0 = Date.now(); const seen = new Set();
for (let i = 0; i < 12; i++) { await wait(1000); const t = await M.evaluate(() => [...document.querySelectorAll('.toast')].map(x => x.textContent).filter(x => /Phone linked/.test(x)).length); toasts = Math.max(toasts, t); }
console.log('after tablet allowed: tablet cards', await tab.locator('.pc').count(), '| own phone says:', (await own.textContent('.phone')).slice(0, 70), '| "linked" toasts at once (max):', toasts);
await own.click('text=Use this phone instead'); await wait(2500);
console.log('own phone takes it back: cards', await own.locator('.pc').count(), '| tablet says:', (await tab.textContent('.phone')).slice(0, 60));
console.log('ERRORS', errs); await b.close();
