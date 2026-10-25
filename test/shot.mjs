import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const browser = await chromium.launch(); const wait = ms => new Promise(r => setTimeout(r, ms));
for (const [w,hgt,touch,file] of [[1440,900,false,'layout_desktop.png'],[844,390,true,'layout_phone.png']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, hasTouch: touch, isMobile: touch }); await mock(ctx); const page = await ctx.newPage();
  await page.goto('http://localhost:8090/?t=shot'+w); await page.fill('#welcomename', 'Marissa'); await page.click('text=Join the table');
  await page.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
  await page.evaluate(async () => {
    const lines = Scry.parseDeckFile(await (await fetch('/../test/none')).text().catch(()=>''));
  }).catch(()=>{});
  await page.click('#top >> text=Decks'); await page.setInputFiles('#importfile', 'test/deck.csv'); await page.waitForSelector('text=Imported');
  await page.click('.dline:has-text("Alesha") .star', { force: true }); await page.click('text=Play this deck', { force: true }); await wait(800);
  await page.evaluate(async () => { KT.openingHand(); KT.keep(); const ls = KT.P.hand.filter(KT.isLand).map(c => c.id); await KT.fromHand(ls.slice(0, 3), 'battlefield');
    const c = KT.P.library.filter(x => /Creature/.test(x.d.faces[0].t)).slice(0,3).map(x=>x.id); await KT.fromLibrary(c, 'battlefield'); await KT.mill(2);
    const s = KT.P.library.find(x=>/Sol Ring|Rancor/.test(x.d.n)); if (s) await KT.fromLibrary([s.id],'battlefield'); await KT.exileTop(1,false);
    const cr = Object.values(KT.S.cards).find(x=>x.zone==='battlefield'&&/Creature/.test(x.d.faces[0].t)); await KT.tap([cr.id], true); await KT.counter(cr.id,'+1/+1',2); });
  await wait(500); await page.mouse.move(200, hgt-60); await page.mouse.move(2, hgt-2); console.log(file, await page.evaluate(() => [document.getElementById('preview').hidden, document.elementFromPoint(2, innerHeight-2).className, (() => { const e = document.elementFromPoint(340, 760); const c = e && e.closest('.card'); return c ? [c.className, getComputedStyle(c).width, c.parentElement.className, (c.closest('.strip') || {}).className, getComputedStyle(c).getPropertyValue('--cw')] : (e && e.className); })()])); await page.screenshot({ path: 'test/'+file });
  await ctx.close();
}
await browser.close();
