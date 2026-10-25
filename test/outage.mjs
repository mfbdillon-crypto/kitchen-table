import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms)); const T = 'out' + Date.now() % 100000; const P = []; const errs = [];
for (const name of ['Marissa', 'Alex', 'Sam']) {
  const br = await chromium.launch({ args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] }); const ctx = await br.newContext(); await mock(ctx);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message));
  await p.goto('http://localhost:8090/?t=' + T); await p.fill('#welcomename', name); await p.click('text=Join the table');
  await p.waitForFunction(n => KT.me && KT.me() && KT.me().name === n, name, { timeout: 30000 });
  P.push({ name, br, ctx, p });
}
const st = async () => (await Promise.all(P.map(async x => x.name + '=' + await x.p.evaluate(() => KT.status)))).join(' ');
const same = async () => { const v = await Promise.all(P.map(x => x.p.evaluate(() => JSON.stringify({ c: KT.S.cards, p: Object.fromEntries(Object.entries(KT.S.players).map(([k, v]) => [k, [v.life, v.name]])), l: KT.S.log.slice(-5).map(e => e.text) })))); return v.every(x => x === v[0]); };
await wait(2000); console.log('start', await st());
const H = P[0];
// short blip: 4 s — nobody should take over
await H.ctx.setOffline(true); await wait(4000); await H.ctx.setOffline(false); await wait(5000);
console.log('after 4s blip:', await st());
// long outage: 25 s
await H.ctx.setOffline(true);
const r1 = await H.p.evaluate(() => KT.act({ type: 'player', patch: { life: 77 } }));
console.log('host acts while offline ->', r1.ok ? 'ACCEPTED (bad)' : 'refused: ' + r1.err);
await wait(14000); console.log('during outage:', (await Promise.all(P.slice(1).map(async x => x.name + '=' + await x.p.evaluate(() => KT.status)))).join(' '));
const r2 = await P[1].p.evaluate(() => KT.act({ type: 'player', patch: { life: 30 } })); const r3 = await P[2].p.evaluate(() => KT.act({ type: 'dice', sides: 6 }));
console.log('others can act during outage:', r2.ok, r3.ok);
await wait(11000); await H.ctx.setOffline(false); await wait(14000);
console.log('after host returns:', await st());
console.log('everyone has the same game:', await same(), '| Alex life everywhere:', (await Promise.all(P.map(x => x.p.evaluate(() => Object.values(KT.S.players).find(p => p.name === 'Alex').life)))).join(','));
const r4 = await H.p.evaluate(() => KT.act({ type: 'dice', sides: 20 })); await wait(1500);
console.log('returned host can act:', r4.ok, '| same game:', await same());
console.log('ERRORS', errs); for (const x of P) await x.br.close();
