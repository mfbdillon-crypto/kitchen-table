// Phone on a restrictive network (like cellular CGNAT): direct WebRTC can't get through.
// approve helper added
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const jsQR = require('jsqr'); const { PNG } = require('pngjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const desk = await chromium.launch();
const phoneBrowser = await chromium.launch({ args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
const errs = [];
const dctx = await desk.newContext({ viewport: { width: 1440, height: 900 } }); await mock(dctx); const A = await dctx.newPage();
A.on('pageerror', e => errs.push('desk: ' + e.message));
const T = 'strict' + Date.now() % 100000;
await A.goto('http://localhost:8090/?t=' + T); await A.fill('#welcomename', 'Marissa'); await A.click('text=Join the table');
await A.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await A.evaluate(() => KT.openDecks()); await A.setInputFiles('#importfile', 'test/deck.csv'); await A.waitForSelector('text=Imported'); await A.click('text=Play this deck'); await wait(800);
await A.click('#hand >> text=Draw opening hand'); await wait(300);
await A.click('#top button:has-text("Phone")'); await A.waitForSelector('.qr svg');
const png = PNG.sync.read(await A.locator('.qr').screenshot()); const url = jsQR(new Uint8ClampedArray(png.data), png.width, png.height).data;
const pctx = await phoneBrowser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }); await mock(pctx); const PH = await pctx.newPage();
PH.on('pageerror', e => errs.push('phone: ' + e.message));
const t0 = Date.now(); await PH.goto(url); await A.waitForSelector('text=Allow — it’s my phone', { timeout: 15000 }); await A.click('text=Allow — it’s my phone'); /*approve*/
let linked = false;
for (let i = 0; i < 40; i++) { await wait(500); if (await PH.locator('.pask, .pc').count()) { linked = true; break; } }
console.log('phone linked on strict network:', linked, 'after', ((Date.now() - t0) / 1000).toFixed(1) + 's', '| phone says:', await PH.textContent('.phead'));
if (linked) {
  await PH.click('.pask button:text-is("Keep")'); await wait(800);
  console.log('keep via phone -> computer phase', await A.evaluate(() => KT.P.phase));
  await PH.locator('.pc').first().tap(); await wait(300); await PH.click('.pacts button.primary'); await wait(1200);
  console.log('play via phone -> battlefield', await A.evaluate(() => Object.values(KT.S.cards).filter(c => c.zone === 'battlefield').length), 'phone cards', await PH.locator('.pc').count());
  await PH.click('.phead button:text-is("Draw")'); await wait(1200); console.log('draw via phone -> phone cards', await PH.locator('.pc').count());
  await PH.close(); const t1 = Date.now(); let back = false;
  for (let i = 0; i < 30; i++) { await wait(500); if (!(await A.evaluate(() => KT.phoneLinked))) { back = true; break; } }
  console.log('computer noticed phone gone:', back, ((Date.now() - t1) / 1000).toFixed(1) + 's');
}
console.log('ERRORS', errs);
await desk.close(); await phoneBrowser.close();
