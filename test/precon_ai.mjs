// Ready-made decks: import two through the Decks window (Moxfield is offline in tests, so the saved lists are used),
// then let two AIs play them against each other for a while.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const A = +(process.argv[2] || 0), B = +(process.argv[3] || 1), SECS = +(process.argv[4] || 120);
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1366, height: 768 } }); await mock(ctx);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('page: ' + e.message));
await p.goto('http://localhost:8090/?t=pc' + Date.now() % 100000); await p.fill('#welcomename', 'Host'); await p.click('text=Join the table');
await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
const names = await p.evaluate(async ([a, b]) => { const out = []; for (const i of [a, b]) { const d = await KT.importPrecon(window.KT_PRECONS[i], () => {}); out.push([d.name, d.cards.reduce((x, c) => x + c.qty, 0), d.cards.filter(c => c.cmdr).map(c => c.d.n).join('&'), !!d.sleeve, !!d.mat]); } return out; }, [A, B]);
console.log('imported', JSON.stringify(names));
await p.evaluate(([a, b]) => { const ds = KT.decks(); const da = ds.find(d => d.src === KT_PRECONS[a].id), db = ds.find(d => d.src === KT_PRECONS[b].id); KT.addAI('Alpha', da, 'hard'); setTimeout(() => KT.addAI('Beta', db, 'normal'), 2500); }, [A, B]);
await p.waitForFunction(() => KT.S.seats.filter(x => KT.S.players[x].ai && KT.S.players[x].libCount > 0).length === 2, null, { timeout: 60000 });
await p.evaluate(() => KT.act({ type: 'lose', why: 'watching' }));
await p.evaluate(() => KT.act({ type: 'start' }));
const t0 = Date.now();
while (Date.now() - t0 < SECS * 1000) { await wait(5000); const st = await p.evaluate(() => ({ n: KT.S.turn.n, w: KT.S.winner })); if (st.w) break; }
const res = await p.evaluate(() => ({ turn: KT.S.turn.n, phase: Rules.PHASES[KT.S.turn.phase], winner: KT.S.winner && (KT.S.players[KT.S.winner] || {}).name, life: KT.S.seats.map(x => KT.S.players[x].name + ':' + KT.S.players[x].life), chat: (KT.S.aichat || []).slice(-30).map(m => (KT.S.players[m.pid] || {}).name + ': ' + m.text), log: KT.S.log.slice(-25).map(l => l.text) }));
console.log(JSON.stringify(res, null, 1));
console.log('ERRORS', errs);
await br.close();
