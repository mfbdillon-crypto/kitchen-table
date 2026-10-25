// Every player on a restrictive network: direct WebRTC is impossible for all of them.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const T = 'tstrict' + Date.now() % 100000; const errs = [];
const players = [];
for (const name of ['Marissa', 'Alex', 'Sam', 'Jo']) {
  const br = await chromium.launch({ args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } }); await mock(ctx); const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(name + ': ' + e.message));
  const t0 = Date.now();
  await p.goto('http://localhost:8090/?t=' + T); await p.fill('#welcomename', name); await p.click('text=Join the table');
  await p.waitForFunction(n => KT.me && KT.me() && KT.me().name === n, name, { timeout: 30000 });
  console.log(name, 'seated in', ((Date.now() - t0) / 1000).toFixed(1) + 's as', await p.evaluate(() => KT.status));
  players.push({ name, br, p });
}
const [A, B, C, D] = players;
await wait(800);
console.log('D sees seats:', await D.p.evaluate(() => KT.S.seats.map(x => KT.S.players[x].name).join(', ')));
for (const P of [A, B, C, D]) {
  await P.p.evaluate(() => KT.openDecks()); await P.p.setInputFiles('#importfile', 'test/deck.csv'); await P.p.waitForSelector('text=Imported');
  await P.p.click('.dline:has-text("Alesha") .star'); await P.p.click('text=Play this deck'); await wait(1000);
}
await A.p.click('text=Start game'); await wait(800);
await B.p.evaluate(async () => { KT.openingHand(); KT.keep(); const l = KT.P.hand.find(KT.isLand); await KT.fromHand([l.id], 'battlefield'); });
await wait(1000);
console.log('C sees Alex battlefield:', await C.p.evaluate(() => Object.values(KT.S.cards).filter(c => c.zone === 'battlefield').map(c => c.d.n + '/' + KT.S.players[c.owner].name)));
const t1 = Date.now(); await B.p.evaluate(() => KT.act({ type: 'player', patch: { life: 33 } }));
await D.p.waitForFunction(() => Object.values(KT.S.players).some(p => p.life === 33), null, { timeout: 10000 });
console.log('life change reached Jo in', Date.now() - t1, 'ms');
// sleeve + playmat (big pictures) reach other players
await B.p.evaluate(() => KT.openDecks()); await B.p.setInputFiles('#matfile', 'test/mat.jpg'); await B.p.click('text=Save playmat'); await wait(300); await B.p.click('.modal .x');
await C.p.waitForFunction(() => Object.values(KT.table.sleeves).some(v => v && v.mat), null, { timeout: 20000 }).then(() => console.log('playmat reached Sam: true')).catch(() => console.log('playmat reached Sam: FALSE'));
// host leaves -> someone takes over
const hostName = (await Promise.all(players.map(async P => [P.name, await P.p.evaluate(() => KT.status)]))).find(x => x[1] === 'host')[0];
console.log('host is', hostName);
const H = players.find(P => P.name === hostName); await H.br.close();
const rest = players.filter(P => P !== H);
await wait(15000);
console.log('after host left:', (await Promise.all(rest.map(async P => P.name + '=' + await P.p.evaluate(() => KT.status)))).join(' '));
const r = await rest[1].p.evaluate(() => KT.act({ type: 'dice', sides: 6 }));
await wait(800);
console.log('action after takeover ok:', r.ok, '| others see it:', (await Promise.all(rest.map(P => P.p.evaluate(() => KT.S.log.slice(-1)[0].text)))).join(' / '));
console.log('ERRORS', errs);
for (const P of rest) await P.br.close();
