import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
global.T0 = Date.now();
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms)); const T = 'split' + Date.now() % 100000; const P = [];
for (const name of ['Marissa', 'Alex', 'Sam', 'Jo']) {
  const br = await chromium.launch(); const ctx = await br.newContext(); await mock(ctx); await ctx.addInitScript(() => { window.KT_DEBUG = 1; });
  const p = await ctx.newPage(); const t0 = Date.now();
  p.on('console', m => { if (m.text().startsWith('[kt]')) console.log(name.padEnd(8), ((Date.now() - global.T0) / 1000).toFixed(1).padStart(5), m.text()); });
  await p.goto('http://localhost:8090/?t=' + T); await p.fill('#welcomename', name); await p.click('text=Join the table');
  await p.waitForFunction(n => KT.me && KT.me() && KT.me().name === n, name, { timeout: 30000 });
  P.push({ name, br, p, t: Date.now() - t0 });
}
global.T0 = Date.now();
console.log('seat times', P.map(x => x.name + ' ' + x.t + 'ms').join(', '));
await wait(3000);
const st = async () => (await Promise.all(P.filter(x => !x.gone).map(async x => x.name + '=' + await x.p.evaluate(() => KT.status)))).join(' ');
console.log('before', await st());
const host = P.find(x => true); for (const x of P) if (await x.p.evaluate(() => KT.status) === 'host') { x.gone = true; await x.br.close(); console.log('closed host', x.name); break; }
for (let i = 0; i < 8; i++) { await wait(2500); console.log('t+' + (i + 1) * 2.5 + 's', await st()); }
for (const x of P) if (!x.gone) await x.br.close();
