// A phone joins a computer's table: by the invite link, and by opening the bare site and typing the code; also the
// phone-as-hand link. Reports what the phone sees at each step.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const br = await chromium.launch(); const errs = []; const out = [];
const mk = async (name, o) => { const ctx = await br.newContext(o); await mock(ctx); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/TUNNEL|favicon|Failed to load|net::/.test(m.text())) errs.push(name + ' console: ' + m.text().slice(0, 200)); }); return p; };
const A = await mk('computer', { viewport: { width: 1366, height: 820 } });
await A.goto('http://localhost:8090/'); await A.fill('#welcomename', 'Marissa'); await A.click('text=Join the table');
await A.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
const code = await A.evaluate(() => KT.TABLE), invite = await A.evaluate(() => KT.inviteURL());
out.push('computer code ' + code + ' invite ' + invite);
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
// 1) by the invite link
const P1 = await mk('phone-invite', phone);
await P1.goto(invite); await wait(800);
out.push('phone(invite) url ' + (await P1.evaluate(() => location.href)) + ' welcome? ' + (await P1.locator('#welcomename').count()));
if (await P1.locator('#welcomename').count()) { await P1.fill('#welcomename', 'Phone'); await P1.click('text=Join the table'); }
await P1.waitForFunction(() => KT.me && KT.me(), null, { timeout: 25000 }).catch(e => out.push('phone(invite) never seated: ' + e.message.slice(0, 80)));
await wait(1500);
out.push('phone(invite) seats: ' + (await P1.evaluate(() => KT.S ? KT.S.seats.map(p => KT.S.players[p].name).join(',') : 'no state')) + ' table ' + (await P1.evaluate(() => KT.TABLE)) + ' status ' + (await P1.evaluate(() => KT.status)));
await P1.screenshot({ path: '/tmp/claude-0/phone_invite.png' });
// 2) bare URL then type the code
const P2 = await mk('phone-bare', phone);
await P2.goto('http://localhost:8090/'); await wait(800);
out.push('phone(bare) code ' + (await P2.evaluate(() => KT.TABLE)));
await P2.fill('#welcomename', 'Phone2'); await P2.fill('#welcomecode', code); await P2.click('text=Join the table');
await P2.waitForFunction(c => window.KT && KT.TABLE === c && KT.me && KT.me(), code, { timeout: 25000 }).catch(e => out.push('phone(bare→code) never seated: ' + e.message.slice(0, 80)));
await wait(1500);
out.push('phone(bare→code) table ' + (await P2.evaluate(() => KT.TABLE)) + ' seats ' + (await P2.evaluate(() => KT.S ? KT.S.seats.map(p => KT.S.players[p].name).join(',') : 'no state')));
await P2.screenshot({ path: '/tmp/claude-0/phone_bare.png' });
console.log(out.join('\n')); console.log('ERRORS', JSON.stringify(errs.slice(0, 10)));
await br.close();
