// Card tracker: plays a busy game (with a host reload and a host takeover) and after EVERY step logs where
// every card is. Flags the first step where any card is duplicated or missing, with that card's full history.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const OUT = '/home/claude/mtg/test/tracker/'; const T = 'track' + Date.now() % 100000;
const wait = ms => new Promise(r => setTimeout(r, ms)); const T0 = Date.now(); fs.writeFileSync('/home/claude/mtg/test/tracker/trace.txt', '');
const logf = fs.createWriteStream(OUT + 'steps.jsonl'); const say = (...a) => { const l = a.join(' '); console.log(l); fs.appendFileSync(OUT + 'summary.txt', l + '\n'); };
fs.writeFileSync(OUT + 'summary.txt', '');
const names = ['Hana', 'Alex', 'Bo', 'Cy']; const P = [];
for (const name of names) {
  const br = await chromium.launch({ args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } }); await mock(ctx); await ctx.addInitScript(() => { window.KT_DEBUG = 1; });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.text().startsWith('[kt]')) fs.appendFileSync(OUT + 'trace.txt', ((Date.now() - T0) / 1000).toFixed(1) + ' ' + name + ' ' + m.text() + '\n'); });
  await p.goto('http://localhost:8090/?t=' + T); await p.fill('#welcomename', name); await p.click('text=Join the table');
  await p.waitForFunction(n => KT.me && KT.me() && KT.me().name === n, name, { timeout: 30000 });
  await p.click('#top >> text=Decks'); await p.setInputFiles('#importfile', 'test/deck.csv'); await p.waitForSelector('text=Imported');
  await p.click('.dline:has-text("Alesha") .star'); await p.click('text=Play this deck'); await wait(1200);
  await p.evaluate(() => { KT.openingHand(); KT.keep(); });
  P.push({ name, br, ctx, p, errs, alive: true, key: await p.evaluate(() => KT.KEY) });
}
const owners = Object.fromEntries(P.map(x => [x.key, x.name]));
const live = () => P.filter(x => x.alive);
async function hostPage() { const seen = []; for (const x of live()) { const st = await Promise.race([x.p.evaluate(() => KT.status).catch(e => 'err:' + e.message.slice(0, 60)), wait(5000).then(() => 'timeout')]); seen.push(x.name + '=' + st); if (st === 'host') return x; } say('     (no host found: ' + seen.join(' ') + ')'); return null; }
// Everyone's full card list at the start (by owner): library + hand + public.
async function where() {
  const H = await hostPage(); if (!H) return null;
  const pub = await H.p.evaluate(() => Object.values(KT.S.cards).map(c => [c.id, c.owner, c.zone, c.ctrl]));
  const inbox = await H.p.evaluate(() => Object.entries(KT.S.inbox || {}).flatMap(([o, l]) => l.map(i => [i.card.id, o, 'inbox:' + i.to])));
  const priv = {};
  for (const x of live()) priv[x.key] = await x.p.evaluate(() => ({ lib: KT.P.library.map(c => c.id), hand: KT.P.hand.map(c => c.id) })).catch(() => null);
  return { host: H.name, pub, inbox, priv };
}
const start = await where(); const expected = {};
for (const x of P) expected[x.key] = new Set([...start.priv[x.key].lib, ...start.priv[x.key].hand, ...start.pub.filter(c => c[1] === x.key).map(c => c[0])]);
say('table', T, '| cards per player at start:', P.map(x => x.name + '=' + expected[x.key].size).join(' '));
const history = {}; let firstBad = null; let step = 0;
async function check(label) {
  step++;
  const w = await where(); if (!w) { say('step', step, label, '— no host right now'); return; }
  const loc = {};   // card id -> [places]
  const add = (id, place) => (loc[id] = loc[id] || []).push(place);
  for (const [id, owner, zone, ctrl] of w.pub) add(id, owners[owner] + ':' + zone + (ctrl !== owner ? '(ctrl ' + owners[ctrl] + ')' : ''));
  for (const [id, owner, z] of w.inbox) add(id, owners[owner] + ':' + z);
  for (const x of live()) { const pr = w.priv[x.key]; if (!pr) continue; pr.lib.forEach(id => add(id, x.name + ':library')); pr.hand.forEach(id => add(id, x.name + ':hand')); }
  const problems = [];
  for (const x of live()) for (const id of expected[x.key]) {
    const places = (loc[id] || []).filter(p => !p.includes(':inbox') || !(loc[id] || []).some(q => q !== p));
    const real = loc[id] || [];
    const inTransit = real.filter(p => p.includes(':inbox'));
    const settled = real.filter(p => !p.includes(':inbox'));
    if (settled.length > 1 || (settled.length === 1 && inTransit.length)) problems.push(['DUPLICATE', id, real]);
    if (!real.length) problems.push(['MISSING', id, history[id] ? history[id][history[id].length - 1] : '?']);
  }
  for (const [id, places] of Object.entries(loc)) { const h = history[id] = history[id] || []; const now = places.join(' + '); if (h[h.length - 1] !== now) h.push(now); }
  logf.write(JSON.stringify({ step, label, host: w.host, loc }) + '\n');
  const counts = live().map(x => x.name + '=' + [...expected[x.key]].filter(id => (loc[id] || []).length).length).join(' ');
  say(String(step).padStart(3), label.padEnd(34), 'host=' + w.host.padEnd(5), counts, problems.length ? '  <<< ' + problems.length + ' PROBLEM(S)' : '');
  if (problems.length && !firstBad) {
    firstBad = step;
    for (const [kind, id, info] of problems.slice(0, 10)) say('     ', kind, id, JSON.stringify(info), '| history:', (history[id] || []).join('  ->  '));
  }
}
await check('after opening hands');
// Each round: every player does a few random moves through the site's own functions.
const moves = async x => x.p.evaluate(async () => {
  const r = Math.random(), P = KT.P, done = [];
  const pick = l => l[Math.floor(Math.random() * l.length)];
  try {
    if (r < .25 && P.hand.length) { const c = pick(P.hand); await KT.fromHand([c.id], pick(['battlefield', 'graveyard', 'exile', 'stack'])); done.push('hand->public'); }
    else if (r < .40) { KT.draw(1); done.push('draw'); }
    else if (r < .50) { await KT.mill(2); done.push('mill2'); }
    else if (r < .65) { const mine = Object.values(KT.S.cards).filter(c => c.owner === KT.KEY && c.zone !== 'command'); if (mine.length) { const c = pick(mine); await KT.move([c.id], pick(['hand', 'library', 'graveyard', 'exile', 'battlefield']), pick(['top', 'bottom', 'shuffle'])); done.push('public->' ); } }
    else if (r < .75 && P.hand.length) { KT.handToLibrary([pick(P.hand).id], pick(['top', 'bottom', 'shuffle'])); done.push('hand->library'); }
    else if (r < .85) { const bf = Object.values(KT.S.cards).filter(c => c.ctrl === KT.KEY && c.zone === 'battlefield'); if (bf.length) { await KT.tap([pick(bf).id], true); done.push('tap'); } }
    else { await KT.act({ type: 'player', patch: { life: KT.me().life - 1 } }); done.push('life'); }
  } catch (e) { done.push('ERR ' + e.message); }
  return done.join(',');
}).catch(e => 'page-err');
async function round(label, n) {
  for (let i = 0; i < n; i++) await Promise.all(live().map(moves));
  await wait(2500); await check(label);
}
for (let i = 1; i <= 2; i++) await round('round ' + i + ' (all players, 3 moves)', 3);
// host reload
let H = await hostPage(); say('---- reloading host', H.name); await H.p.reload(); await H.p.waitForFunction(() => KT.S && KT.me && KT.me(), null, { timeout: 30000 }); await wait(4000); await check('after host reload');
await round('round 3', 3);
// rapid burst while host is killed mid-way
H = await hostPage(); say('---- burst, then killing host', H.name);
const burst = Promise.all(live().filter(x => x !== H).map(async x => { for (let k = 0; k < 6; k++) await moves(x); }));
await wait(700); H.alive = false; fs.appendFileSync(OUT + 'trace.txt', ((Date.now() - T0) / 1000).toFixed(1) + ' ---- HOST KILLED\n'); await H.br.close();
for (let k = 0; k < 10; k++) { await wait(3000); say('  +' + (k + 1) * 3 + 's statuses:', (await Promise.all(live().map(async x => x.name + '=' + await x.p.evaluate(() => KT.status + '/' + (KT.table.hostAddr || '-').slice(-4) + '/pending' + KT.table.pending.size).catch(() => '?')))).join(' ')); }
await burst; await check('after host killed mid-burst');
for (let i = 4; i <= 5; i++) await round('round ' + i, 3);
await wait(4000); await check('final');
// do all players' copies agree with the host?
const Hp = await hostPage(); if (!Hp) { say('no host at the end'); process.exit(1); } const hs = await Hp.p.evaluate(() => JSON.stringify(KT.S.cards));
for (const x of live()) say('copy of game matches host:', x.name, (await x.p.evaluate(() => JSON.stringify(KT.S.cards))) === hs);
say('page errors:', JSON.stringify(P.map(x => x.errs.length)));
say(firstBad ? 'FIRST PROBLEM AT STEP ' + firstBad : 'NO CARD WAS EVER DUPLICATED OR LOST');
for (const x of live()) await x.br.close();
