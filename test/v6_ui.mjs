// v6 UI: turn buttons, automatic steps, trigger prompts (use it? / targets with pictures), end-of-turn badges.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const T = 'v6' + Date.now() % 100000;
const br = await chromium.launch(); const errs = [];
async function player(name, opts) {
  const ctx = await br.newContext(Object.assign({ viewport: { width: 1366, height: 800 } }, opts || {})); await mock(ctx);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
  await p.goto('http://localhost:8090/?t=' + T); await p.fill('#welcomename', name); await p.click('text=Join the table');
  await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 25000 });
  await p.evaluate(async txt => { const d = await KT.linesToDeck(Scry.parseDeckFile(txt), 'Gruul', () => {}); await KT.useDeck(d); }, mock.aiDeck());
  return p;
}
const A = await player('Alex'); await wait(800);
const B = await player('Bea');
await wait(1500);
for (const p of [A, B]) await p.evaluate(() => { KT.openingHand(); KT.keep(); });
await A.evaluate(async () => { await KT.act({ type: 'house', set: { deckSize: 0 } }); await KT.act({ type: 'start' }); });
await wait(1500); for (const p of [A, B]) await p.evaluate(() => { KT.openingHand(); KT.keep(); });
await wait(2000);
const actName = await A.evaluate(() => KT.S.players[KT.S.turn.active].name);
const P = actName === 'Alex' ? A : B, O = P === A ? B : A;
const top = async p => p.evaluate(() => document.querySelector('#top .turn') && document.querySelector('#top .turn').innerText.replace(/\s+/g, ' '));
console.log('active', actName, '| phase', await P.evaluate(() => Rules.PHASES[KT.S.turn.phase]), '| top bar:', await top(P));
console.log('other top bar:', await top(O));
await P.screenshot({ path: 'test/shots/v6_top.png', clip: { x: 0, y: 0, width: 1366, height: 60 } });
const D = (n, t, o, p, tg) => ({ n, sid: '', cmc: 2, faces: [{ n, t, o, img: '', p: p || '', tg: tg || '', mc: '{1}{G}' }] });
// 1) "may" trigger on ETB
await P.evaluate(d => KT.act({ type: 'enter', zone: 'battlefield', cards: [{ id: KT.KEY.slice(1, 9) + '-sch', d }] }), D('Curious Scholar', 'Creature — Human', 'When this creature enters, you may draw a card.', '1', '1'));
await wait(1200);
for (let i = 0; i < 6; i++) { const h = await O.evaluate(() => KT.S.prio && KT.S.prio.holder === KT.KEY); if (h) await O.evaluate(() => KT.pass()); const h2 = await P.evaluate(() => KT.S.prio && KT.S.prio.holder === KT.KEY); if (h2) await P.evaluate(() => KT.pass()); await wait(500); }
const askTxt = await P.evaluate(() => [...document.querySelectorAll('.prio.mine')].map(e => e.innerText.replace(/\s+/g, ' ')).join(' | '));
console.log('may prompt:', askTxt);
await P.screenshot({ path: 'test/shots/v6_may.png' });
const hand0 = await P.evaluate(() => KT.P.hand.length);
await P.click('.prio.mine button.primary');
await wait(1500);
console.log('used it → hand', hand0, '→', await P.evaluate(() => KT.P.hand.length), '| log:', await P.evaluate(() => KT.S.log.slice(-3).map(l => l.text).join(' / ')));
// 2) targets with pictures: Blood Artist for P, a creature of O dies
await P.evaluate(d => KT.act({ type: 'enter', zone: 'battlefield', cards: [{ id: KT.KEY.slice(1, 9) + '-art', d }] }), D('Blood Artist', 'Creature — Vampire', 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.', '0', '1'));
await O.evaluate(d => KT.act({ type: 'enter', zone: 'battlefield', cards: [{ id: KT.KEY.slice(1, 9) + '-bear', d }] }), D('Grizzly Bears', 'Creature — Bear', '', '2', '2'));
await wait(800);
await O.evaluate(() => KT.act({ type: 'move', ids: [KT.KEY.slice(1, 9) + '-bear'], to: 'graveyard' }));
await wait(1500);
console.log('pickbar:', await P.evaluate(() => document.querySelector('.pickbar') && document.querySelector('.pickbar').innerText.replace(/\s+/g, ' ').slice(0, 200)));
console.log('thumbs:', await P.evaluate(() => document.querySelectorAll('.pickbar .tthumb').length));
await P.screenshot({ path: 'test/shots/v6_targets.png' });
const oLife = await O.evaluate(() => KT.me().life);
await P.click('.pickbar .tthumb:not(.set) >> nth=' + (await P.evaluate(() => [...document.querySelectorAll('.pickbar .tthumb')].findIndex(b => !/You/.test(b.innerText)))));
await wait(1200);
for (let i = 0; i < 6; i++) { for (const q of [O, P]) { const h = await q.evaluate(() => KT.S.prio && KT.S.prio.holder === KT.KEY); if (h) await q.evaluate(() => KT.pass()); } await wait(400); }
console.log('blood artist: O life', oLife, '→', await O.evaluate(() => KT.me().life), '| stack', await P.evaluate(() => Rules.stackCards(KT.S).length));
// 3) temporary effects badge
await P.evaluate(() => { const s = KT.S; const id = KT.KEY.slice(1, 9) + '-sch'; return KT.act({ type: 'log', text: 'test' }); });
// 4) End turn button → other gets end-step window (auto-pass) → other's turn at Main 1
const btn = await P.evaluate(() => [...document.querySelectorAll('#top button')].map(b => b.innerText).join(' | '));
console.log('P buttons:', btn);
await P.click('#top button:has-text("End turn")');
await wait(800);
const modal = await P.evaluate(() => !!document.querySelector('.modal'));
if (modal) { console.log('reminder modal:', await P.evaluate(() => document.querySelector('.modal').innerText.replace(/\s+/g, ' ').slice(0, 120))); await P.click('.modal button.primary'); }
await wait(4000);
console.log('after End turn: active', await A.evaluate(() => KT.S.players[KT.S.turn.active].name), await A.evaluate(() => Rules.PHASES[KT.S.turn.phase]), '| O top bar:', await top(O));
console.log('log tail:', await A.evaluate(() => KT.S.log.slice(-8).map(l => l.text).join(' / ')));
await O.screenshot({ path: 'test/shots/v6_newturn.png' });
// 5) Go to combat on O's turn (Bear-less): button only if they can attack
console.log('O buttons:', await O.evaluate(() => [...document.querySelectorAll('#top button')].map(b => b.innerText).join(' | ')));
console.log('ERRORS', errs);
await br.close();
