// Browser test of library knowledge: scry makes the top known, a shuffle forgets it; "reveal the top N, pick" shows the
// cards to the table while you choose; Courser keeps the top card revealed; a card returned to hand stays known.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1366, height: 820 } }); await mock(ctx);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('page: ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|net::/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await p.goto('http://localhost:8090/?t=lib' + Date.now() % 100000); await p.fill('#welcomename', 'Marissa'); await p.click('text=Join the table');
await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await p.evaluate(async () => { const h = await KT.importPrecon(window.KT_PRECONS[10], () => {}); await KT.useDeck(h); await KT.importPrecon(window.KT_PRECONS[6], () => {}); });
await p.evaluate(() => { const d = KT.decks().find(x => x.src === window.KT_PRECONS[6].id); KT.addAI('Chandra', d, 'normal'); });
await p.waitForFunction(() => KT.S.seats.length === 2 && KT.S.seats.every(x => KT.S.players[x].libCount > 0), null, { timeout: 60000 });
await p.evaluate(() => KT.act({ type: 'start' })); await wait(1500);
await p.evaluate(() => { if (KT.P.phase === 'none') KT.openingHand(); KT.keep(); });
const results = []; const check = (name, ok, info) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
const clickBtn = async (re) => p.evaluate(src => { const b = [...document.querySelectorAll('.modal button')].find(x => new RegExp(src).test(x.textContent)); if (b) b.click(); return !!b; }, re.source);
// 1) Scry 2, keep both on top → known.
p.evaluate(() => new Promise(r => KT.onTodo({ k: 'scry', n: 2, src: 'Test scry' }, r)));
await p.locator('.modal').first().waitFor({ timeout: 5000 });
await clickBtn(/Done|Apply|OK|Keep/); await wait(800);
let kn = await p.evaluate(() => { const k = KT.knownLibrary(); return [k.top.length, k.bottom.length]; });
check('scry makes the top known', kn[0] === 2, JSON.stringify(kn));
const lm = await p.evaluate(() => KT.libraryMenu().filter(Boolean).map(x => x.label || x.note || ''));
check('library menu offers known cards', lm.some(x => /Cards I know about \(2\)/.test(x)), lm.join(' | '));
await p.evaluate(() => KT.shuffleLibrary(true));
kn = await p.evaluate(() => { const k = KT.knownLibrary(); return [k.top.length, k.bottom.length]; });
check('a shuffle forgets', kn[0] === 0 && kn[1] === 0, JSON.stringify(kn));
// 2) Reveal the top 3 and pick a land; the table sees them while I choose.
await p.evaluate(() => { const D = (n, t) => ({ id: 'rl-' + n, d: { n, cmc: 0, faces: [{ n, t, o: '', img: '', p: '', tg: '', mc: '' }] } }); KT.P.library.unshift(D('Forest', 'Basic Land — Forest'), D('Bear', 'Creature — Bear'), D('Elk', 'Creature — Elk')); });
p.evaluate(() => new Promise(r => KT.onTodo({ k: 'look', n: 3, reveal: true, text: 'reveal the top three cards of your library. put a land card from among them into your hand and the rest on the bottom of your library in any order', src: 'Test reveal' }, r)));
await p.locator('.modal .strip.pick .card').first().waitFor({ timeout: 5000 });
await wait(600);
const shown = await p.evaluate(() => (KT.S.players[KT.KEY].revealed || []).filter(r => r.from === 'library').length); 
check('revealed to the table while choosing', shown === 3, 'revealed ' + shown);
await p.evaluate(() => { const c = [...document.querySelectorAll('.modal .strip.pick .card')].find(x => /Forest/.test(x.querySelector('img') && x.querySelector('img').alt || x.textContent)); if (c) c.click(); });
await wait(200); await clickBtn(/Take/); await wait(1200);
const r2 = await p.evaluate(() => ({ inHand: KT.P.hand.some(c => c.id === 'rl-Forest'), bottom: KT.knownLibrary().bottom.map(c => c.d.n), rev: (KT.S.players[KT.KEY].revealed || []).map(r => r.d.n + (r.known ? '*' : '')) }));
check('picked the land, rest known on the bottom', r2.inHand && r2.bottom.length === 2, JSON.stringify(r2));
check('the revealed land stays known in hand', r2.rev.includes('Forest*'), JSON.stringify(r2.rev));
// 3) Courser: the top card is revealed to everyone.
await p.evaluate(() => KT.act({ type: 'enter', zone: 'battlefield', cards: [{ id: 'cou', d: { n: 'Courser of Kruphix', cmc: 3, faces: [{ n: 'Courser of Kruphix', t: 'Enchantment Creature — Centaur', o: 'Play with the top card of your library revealed.\nYou may play lands from the top of your library.', img: '', p: '2', tg: '4', mc: '{1}{G}{G}' }] } }] }));
await wait(1500);
const topRev = await p.evaluate(() => { const t = KT.P.library[0]; return (KT.S.players[KT.KEY].revealed || []).some(r => r.from === 'library' && r.id === t.id); });
check('Courser reveals the top card', topRev);
// 4) A permanent returned to my hand stays known to the table.
await p.evaluate(() => KT.act({ type: 'move', ids: ['cou'], to: 'hand' }));
await wait(1800);
const known = await p.evaluate(() => (KT.S.players[KT.KEY].revealed || []).some(r => r.known && r.id === 'cou'));
check('returned card known in hand', known);
console.log(results.join('\n'));
console.log('ERRORS', JSON.stringify(errs.slice(0, 10)));
await br.close();
