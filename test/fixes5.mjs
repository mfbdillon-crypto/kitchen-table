import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const T = 'fx' + Date.now() % 100000;
const br = await chromium.launch(); const errs = [];
async function player(name, opts) {
  const ctx = await br.newContext(Object.assign({ viewport: { width: 1366, height: 800 } }, opts || {})); await mock(ctx);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message));
  await p.goto('http://localhost:8090/?t=' + T); await p.fill('#welcomename', name); await p.click('text=Join the table');
  await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 25000 });
  await p.evaluate(async txt => { const d = await KT.linesToDeck(Scry.parseDeckFile(txt), 'Gruul', () => {}); await KT.useDeck(d); }, mock.aiDeck());
  return p;
}
const A = await player('Alex'); await wait(800);
const B = await player('Bea');
const M = await player('Mo', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await wait(1500);
for (const p of [A, B, M]) await p.evaluate(() => { KT.openingHand(); KT.keep(); });
await A.evaluate(() => KT.act({ type: 'start' }));
await wait(1500);
// whoever is active: give them two lands in hand and play both
const act = await A.evaluate(() => KT.S.turn.active === KT.KEY ? 'A' : KT.S.players[KT.S.turn.active].name);
const P = act === 'A' ? A : act === 'Bea' ? B : M;
console.log('active:', act);
await P.evaluate(() => KT.act({ type: 'phase', to: Rules.PHASES.indexOf('Main 1') }));
await wait(600);
const lands = await P.evaluate(() => KT.P.hand.filter(c => KT.isLand(c)).map(c => c.id));
const r1 = await P.evaluate(id => KT.playLand(id), lands[0]); await wait(800);
const r2 = await P.evaluate(id => KT.playLand(id), lands[1]);
console.log('land1', r1.ok, 'land2', r2.ok, r2.err);
console.log('toast:', await P.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).pop()));
// resolve now: active player casts Bolt at someone, then resolves immediately
await P.evaluate(async () => { const bolt = await Scry.named('Lightning Bolt'); KT.P.hand.push({ id: KT.KEY.slice(1, 9) + '-boltx', owner: KT.KEY, d: bolt }); KT.savePriv(); });
const other = await P.evaluate(() => KT.S.seats.find(p => p !== KT.KEY));
await P.evaluate(o => KT.castFromHand(KT.KEY.slice(1, 9) + '-boltx', { tg: [[{ p: o }]] }), other);
await wait(800);
console.log('stack before:', await P.evaluate(() => Rules.stackCards(KT.S).length), 'holder', await P.evaluate(() => KT.S.prio && KT.S.players[KT.S.prio.holder].name));
const rr = await P.evaluate(() => KT.act({ type: 'resolveNow' }));
await wait(800);
console.log('resolveNow:', rr.ok, rr.err, 'stack after:', await P.evaluate(() => Rules.stackCards(KT.S).length), 'life', await P.evaluate(o => KT.S.players[o].life, other));
// mobile keyboard: Mo opens the AI/ deck window and focuses a text box while others make moves
await M.evaluate(() => { KT.ui.openModal('Test', b => b.append(KT.ui.h('input', { type: 'text', id: 'kbtest' })), { live: true }); });
await M.focus('#kbtest'); await M.keyboard.type('Hel');
for (let i = 0; i < 4; i++) { await A.evaluate(() => KT.act({ type: 'dice', sides: 6 })); await wait(500); }
await M.keyboard.type('lo');
console.log('mobile focus kept:', await M.evaluate(() => document.activeElement && document.activeElement.id), 'value:', await M.evaluate(() => document.getElementById('kbtest').value));
await M.evaluate(() => document.activeElement.blur()); await wait(400);
// host removes Bea (online, human)
const hostName = await A.evaluate(() => KT.S.players[KT.S.hostPid].name);
console.log('host is', hostName);
const H = hostName === 'Alex' ? A : hostName === 'Bea' ? B : M;
const victim = H === B ? A : B;
const vid = await victim.evaluate(() => KT.KEY);
const rm = await H.evaluate(v => KT.act({ type: 'removeSeat', pid: v }), vid);
await wait(1500);
console.log('remove:', rm.ok, rm.err, 'seats:', await H.evaluate(() => KT.S.seats.map(p => KT.S.players[p].name)));
const back = await victim.evaluate(() => KT.act({ type: 'join', name: 'again' }));
console.log('rejoin:', back.ok, back.err, back.kicked);
const nonHost = [A, B, M].find(p => p !== H && p !== victim);
const tryRm = await nonHost.evaluate(() => KT.act({ type: 'removeSeat', pid: KT.S.hostPid }));
console.log('non-host remove host:', tryRm.ok, tryRm.err);
console.log('ERRORS', errs);
await br.close();
