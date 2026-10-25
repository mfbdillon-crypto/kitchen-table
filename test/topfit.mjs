import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const T = 'fit' + Date.now() % 100000;
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1366, height: 768 } }); await mock(ctx);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('page: ' + e.message));
await p.goto('http://localhost:8090/?t=' + T); await p.fill('#welcomename', 'Marissa Longname'); await p.click('text=Join the table');
await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await p.evaluate(async txt => { const d = await KT.linesToDeck(Scry.parseDeckFile(txt), 'Gruul Test', () => {}); await KT.useDeck(d); }, mock.aiDeck());
await p.evaluate(() => KT.act({ type: 'start' }));
await p.evaluate(() => KT.act({ type: 'table', key: 'monarch', value: KT.KEY }));
await wait(600);
let bad = 0;
for (const w of [1024, 1180, 1280, 1366, 1440, 1600, 1920]) for (const panel of [false, true]) {
  await p.setViewportSize({ width: w, height: 768 });
  await p.evaluate(pn => { KT.aiOpen = pn; KT.logOpen = false; KT.renderNow(); }, panel);
  await wait(250);
  const r = await p.evaluate(() => {
    const top = document.getElementById('top');
    const els = [...top.querySelectorAll('button, .who, .tn, .brand b')].filter(e => e.offsetParent && getComputedStyle(e).display !== 'none');
    const rs = els.map(e => [e, e.getBoundingClientRect()]);
    const hits = [];
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i][1], b = rs[j][1];
      if (rs[i][0].contains(rs[j][0]) || rs[j][0].contains(rs[i][0])) continue;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits.push(rs[i][0].textContent.trim().slice(0, 14) + ' × ' + rs[j][0].textContent.trim().slice(0, 14));
    }
    const pass = top.querySelector('.pass'); let passOk = !pass;
    if (pass) { const b = pass.getBoundingClientRect(); const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); passOk = at === pass || pass.contains(at); }
    const off = rs.filter(([, b]) => b.right > innerWidth - (KT.aiOpen ? 0 : 0) + 1).map(([e]) => e.textContent.trim().slice(0, 12));
    return { fit: KT.topFit, h: top.offsetHeight, hits, passOk, off };
  });
  const ok = !r.hits.length && r.passOk && !r.off.length && r.h < 70;
  if (!ok) bad++;
  console.log(w, panel ? 'panel' : 'nopanel', ok ? 'OK ' : 'BAD', JSON.stringify(r));
  if (w === 1366 || !ok) await p.screenshot({ path: `test/shots/top_${w}_${panel ? 'p' : 'n'}.png`, clip: { x: 0, y: 0, width: w, height: 60 } });
}
console.log('bad', bad, 'errors', errs);
await br.close();
