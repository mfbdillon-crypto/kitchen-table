// approve helper added
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const jsQR = require('jsqr'); const { PNG } = require('pngjs');
const browser = await chromium.launch(); const errs = []; const wait = ms => new Promise(r => setTimeout(r, ms));
async function ctxp(name, o) { const ctx = await browser.newContext(o || { viewport: { width: 1440, height: 900 } }); await mock(ctx); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(name + ': ' + e.message)); page.on('console', m => { if (m.type()==='error' && !/TUNNEL|favicon|Aborting|is taken/.test(m.text())) errs.push(name+' console: '+m.text()); }); return { ctx, page }; }
const A = await ctxp('computer');
await A.page.goto('http://localhost:8090/?t=phonetest'); await A.page.fill('#welcomename', 'Marissa'); await A.page.click('text=Join the table');
await A.page.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await A.page.click('#top >> text=Decks'); await A.page.setInputFiles('#importfile', 'test/deck.csv'); await A.page.waitForSelector('text=Imported'); await A.page.click('text=Play this deck'); await wait(800);
await A.page.click('#hand >> text=Draw opening hand'); await wait(300);
await A.page.click('#top button:has-text("Phone")'); await wait(500); console.log('MODAL:', (await A.page.evaluate(() => (document.querySelector('.modal') || {}).outerHTML || 'none')).slice(0, 600)); await A.page.waitForSelector('.qr svg', { timeout: 5000 });
const shot = await A.page.locator('.qr').screenshot();
const png = PNG.sync.read(shot); const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
console.log('QR decodes to:', code && code.data, ' expected:', await A.page.evaluate(() => KT.phoneURL()));
for (const [label, vp] of [['sideways', { width: 844, height: 390 }], ['upright', { width: 390, height: 844 }]]) {
  const PH = await ctxp('phone-' + label, { viewport: vp, hasTouch: true, isMobile: true });
  await PH.page.goto(code.data); await A.page.waitForSelector('text=Allow — it’s my phone', { timeout: 15000 }); await A.page.click('text=Allow — it’s my phone'); /*approve*/
  await PH.page.waitForSelector(label === 'sideways' ? '.pask' : '.pc', { timeout: 20000 });
  console.log(label, 'phone shows:', label === 'sideways' ? await PH.page.textContent('.pask') : (await PH.page.locator('.pc').count()) + ' cards');
  if (label === 'sideways') console.log(label, 'computer linked:', await A.page.evaluate(() => KT.phoneLinked));
  if (label === 'sideways') {
    await PH.page.click('.pask button:text-is("Keep")'); await wait(600);
    console.log('kept via phone, computer phase:', await A.page.evaluate(() => KT.P.phase), 'phone cards:', await PH.page.locator('.pc').count());
    // swipe up the first card
    const box = await PH.page.locator('.pc').first().boundingBox();
    await PH.page.touchscreen.tap(box.x + box.width/2, box.y + box.height/2); await wait(300);
    await PH.page.screenshot({ path: 'test/phone_big.png' });
    await PH.page.click('.pacts button.primary'); await wait(800);
    console.log('played from phone -> battlefield+stack count:', await A.page.evaluate(() => Object.values(KT.S.cards).filter(c => c.zone === 'battlefield' || c.zone === 'stack').length), 'phone cards:', await PH.page.locator('.pc').count());
    await PH.page.click('.phead button:text-is("Draw")'); await wait(600);
    console.log('draw from phone -> phone cards:', await PH.page.locator('.pc').count());
    await PH.page.screenshot({ path: 'test/phone_side.png' });
    // computer reload: phone should reconnect
    await A.page.reload(); await A.page.waitForSelector('#top', { timeout: 20000 }); await wait(9000);
    console.log('after computer reload, phone status:', await PH.page.textContent('.pturn'), 'cards:', await PH.page.locator('.pc').count());
  } else {
    await PH.page.screenshot({ path: 'test/phone_up.png' });
  }
  await PH.ctx.close(); await wait(1500);
}
console.log('ERRORS', errs);
await browser.close();
