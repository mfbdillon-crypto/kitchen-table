import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const b = await chromium.launch(); const wait = ms => new Promise(r => setTimeout(r, ms)); const errs = [];
async function seat(name, vp, touch, t) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: !!touch, isMobile: !!touch, deviceScaleFactor: 2 }); await mock(ctx); const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(name + ': ' + e.message));
  await p.goto('http://localhost:8090/?t=' + t); await p.fill('#welcomename', name); await p.click('text=Join the table');
  await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
  await p.evaluate(() => KT.openDecks());
  await p.setInputFiles('#importfile', 'test/deck.csv'); await p.waitForSelector('text=Imported');
  await p.click('text=Play this deck', { force: true }); await wait(700);
  await p.evaluate(async () => {
    KT.openingHand(); KT.keep();
    const ls = KT.P.hand.filter(KT.isLand).map(c => c.id); await KT.fromHand(ls.slice(0, 3), 'battlefield');
    const pick = re => KT.P.library.filter(x => re.test(x.d.faces[0].t)).map(x => x.id);
    await KT.fromLibrary(pick(/Creature/).slice(0, 4), 'battlefield');
    await KT.fromLibrary(pick(/Planeswalker/).slice(0, 1), 'battlefield');
    const cr = Object.values(KT.S.cards).filter(x => x.zone === 'battlefield' && x.owner === KT.KEY && /Creature/.test(x.d.faces[0].t));
    await KT.counter(cr[0].id, '+1/+1', 3); await KT.counter(cr[0].id, 'flying', 1); await KT.counter(cr[0].id, 'deathtouch', 1);
    await KT.tap([cr[1].id], true); await KT.counter(cr[1].id, '-1/-1', 1); await KT.counter(cr[1].id, 'stun', 2);
    await KT.setMod(cr[2].id, 2, 0); await KT.counter(cr[2].id, 'shield', 1);
  });
  await wait(500); await p.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.remove())); return { ctx, p };
}
const D = await seat('Marissa', { width: 1440, height: 900 }, false, 'cnt1j');
await D.p.mouse.move(700, 880); await D.p.locator('.brow.creatures').screenshot({ path: 'test/cnt_desktop_row.png' });
await D.p.screenshot({ path: 'test/cnt_desktop.png' });
const L = await seat('Laptop', { width: 1280, height: 720 }, false, 'cnt2j');
await L.p.mouse.move(700, 715); await L.p.locator('.brow.creatures').screenshot({ path: 'test/cnt_1280_row.png' });
await L.p.locator('.brow.other').screenshot({ path: 'test/cnt_1280_pw.png' });
await L.p.click('#tabs >> text=All players'); await wait(300); await L.p.locator('.board').first().screenshot({ path: 'test/cnt_compact.png' });
const P = await seat('Phone', { width: 844, height: 390 }, true, 'cnt3j');
await P.p.locator('.brow.creatures').screenshot({ path: 'test/cnt_phone_row.png' });
console.log('ERRORS', errs); await b.close();
