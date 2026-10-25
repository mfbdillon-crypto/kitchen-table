// Browser test of the rulebook at the table: the AI waits for opening hands; graveyard casting only with a permission
// (Karador), green glow on usable cards outside the hand, the top of the library with Courser, no free moves outside dev.
// node test/ui_rules.mjs   (needs the local web server on :8090 and the MQTT mock)
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1366, height: 820 } }); await mock(ctx);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('page: ' + e.message));
p.on('console', m => { if (/overlay:/.test(m.text())) console.log(m.text()); if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|net::/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await p.goto('http://localhost:8090/?t=rul' + Date.now() % 100000); await p.fill('#welcomename', 'Marissa'); await p.click('text=Join the table');
await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await p.evaluate(async () => { const h = await KT.importPrecon(window.KT_PRECONS[0], () => {}); await KT.useDeck(h); await KT.importPrecon(window.KT_PRECONS[6], () => {}); });
await p.evaluate(() => { const d = KT.decks().find(x => x.src === window.KT_PRECONS[6].id); KT.addAI('Chandra', d, 'normal'); });
await p.waitForFunction(() => KT.S.seats.length === 2 && KT.S.seats.every(x => KT.S.players[x].libCount > 0), null, { timeout: 60000 });
await p.evaluate(() => KT.act({ type: 'start' })); await wait(1500);
const results = []; const check = (name, ok, info) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
// 1) Before I keep, the AI does nothing on the board.
await p.evaluate(() => { if (KT.P.phase === 'none') KT.openingHand(); });
await wait(7000);
const before = await p.evaluate(() => ({ bf: Object.values(KT.S.cards).filter(c => c.zone === 'battlefield' || c.zone === 'stack').length, phase: Rules.PHASES[KT.S.turn.phase], n: KT.S.turn.n }));
check('AI waits for my keep', before.bf === 0 && before.n === 1, JSON.stringify(before));
await p.evaluate(() => KT.keep());
const myMain = async () => { for (let i = 0; i < 240; i++) { const ok = await p.evaluate(() => { const s = KT.S; return s.turn.active === KT.KEY && /^Main/.test(Rules.PHASES[s.turn.phase]) && !s.prio && !Rules.stackTop(s) && !(s.ask || []).length && !(s.tq || []).length && !s.turn.goal; }); if (ok) return true; await p.evaluate(async () => { const s = KT.S, me = KT.KEY; if (s.prio && s.prio.holder === me) await KT.pass(); else if (s.combat && !s.combat.done && (s.combat.waiting || []).includes(me) && !s.combat.ok[me]) await KT.block([]); }); await wait(250); } return false; };
const settle = async () => { for (let i = 0; i < 40; i++) { const busy = await p.evaluate(() => !!(KT.S.prio || Rules.stackTop(KT.S) || (KT.S.tq || []).length)); if (!busy) return; await p.evaluate(async () => { if (KT.S.prio && KT.S.prio.holder === KT.KEY) await KT.pass(); }); await wait(250); } };
console.log('my turn:', await myMain());
await p.evaluate(() => { window.D = (n, t, o, mc, pt) => ({ n, cmc: 2, faces: [{ n, t, o, img: '', p: pt ? pt[0] : '', tg: pt ? pt[1] : '', mc: mc || '' }] }); });
const labels = id => p.evaluate(id => KT.cardMenu(KT.S.cards[id]).filter(Boolean).map(x => x.label || x.note || (x.sep ? '—' : '')), id);
// 2) Lands for mana, a creature in my graveyard: no permission → nothing offered, no free moves.
await p.evaluate(() => KT.act({ type: 'enter', zone: 'battlefield', cards: [0, 1, 2, 3, 4].map(i => ({ id: 'L' + i, d: D('Swamp', 'Basic Land — Swamp', '{T}: Add {B}.') })) }));
await p.evaluate(() => KT.act({ type: 'enter', zone: 'graveyard', cards: [{ id: 'gz', d: D('Grave Zombie', 'Creature — Zombie', '', '{1}{B}', ['2', '2']) }] }));
await wait(500);
const l0 = await labels('gz');
check('no permission, no cast', !l0.some(x => /^Cast/.test(x)) && !l0.some(x => /Battlefield|Exile|Hand/.test(x)), l0.join(' | '));
check('no glow without permission', !(await p.evaluate(() => KT.usableNow(KT.S.cards.gz))));
// 3) Karador: the graveyard creature glows and can be cast from the menu.
await p.evaluate(() => KT.act({ type: 'enter', zone: 'battlefield', cards: [{ id: 'kar', d: D('Karador, Ghost Chieftain', 'Legendary Creature — Centaur Spirit', 'During each of your turns, you may cast a creature spell from your graveyard.', '{5}{B}{G}{W}', ['3', '4']) }] }));
await wait(600);
const l1 = await labels('gz');
check('Karador offers the cast', l1.some(x => /Karador/.test(x)), l1.join(' | '));
check('graveyard card glows', await p.evaluate(() => KT.usableNow(KT.S.cards.gz)));
check('graveyard pile glows', await p.locator('.pile.usable').count() > 0);
await p.evaluate(() => { const it = KT.cardMenu(KT.S.cards.gz).find(x => x && /Karador/.test(x.label || '')); it.fn(); });
await wait(1200); await settle(); await wait(600);
check('cast from graveyard', await p.evaluate(() => KT.S.cards.gz && KT.S.cards.gz.zone === 'battlefield'), await p.evaluate(() => KT.S.cards.gz && KT.S.cards.gz.zone));
// 4) Courser: the top land of my library can be played.
await myMain();
await p.evaluate(() => KT.act({ type: 'enter', zone: 'battlefield', cards: [{ id: 'cou', d: D('Courser of Kruphix', 'Enchantment Creature — Centaur', 'Play with the top card of your library revealed.\nYou may play lands from the top of your library.', '{1}{G}{G}', ['2', '4']) }] }));
await p.evaluate(() => { KT.P.library.unshift({ id: 'topF', d: D('Forest', 'Basic Land — Forest', '{T}: Add {G}.') }); KT.render(); });
await wait(500);
const lm = await p.evaluate(() => KT.libraryMenu().filter(Boolean).map(x => x.label || x.note || ''));
check('library shows the top card and the play option', lm.some(x => /Top card: Forest/.test(x)) && lm.some(x => /Courser/.test(x)), lm.join(' | '));
const landsBefore = await p.evaluate(() => (KT.S.turn.lands || {})[KT.KEY] || 0);
if (!landsBefore) {
  await p.evaluate(() => { const it = KT.libraryMenu().find(x => x && /Courser/.test(x.label || '')); it.fn(); });
  await wait(1200);
  check('played the top land', await p.evaluate(() => KT.S.cards.topF && KT.S.cards.topF.zone === 'battlefield'));
} else check('played the top land (skipped: land already played)', true);
// 5) A permanent with an activated ability glows when I can use it.
await p.evaluate(() => KT.act({ type: 'enter', zone: 'battlefield', cards: [{ id: 'ab1', d: D('Test Shrine', 'Artifact', '{1}: You gain 1 life.') }] }));
await wait(500);
check('ability permanent glows', await p.evaluate(() => KT.usableNow(KT.S.cards.ab1)));
check('lands don’t glow', !(await p.evaluate(() => KT.usableNow(KT.S.cards.L0))));
// 6) My commander dies: I'm asked whether it goes to the command zone.
const cm = await p.evaluate(() => (Object.values(KT.S.cards).find(c => c.cmdr && c.owner === KT.KEY) || {}).id);
await p.evaluate(id => KT.act({ type: 'move', ids: [id], to: 'battlefield' }), cm); await wait(400);
await p.evaluate(id => KT.act({ type: 'move', ids: [id], to: 'graveyard' }), cm);
const btn = p.locator('.prio button', { hasText: 'Command zone' });
await btn.first().waitFor({ timeout: 6000 }).catch(() => {});
const hasB = await btn.count(); console.log('OVERLAY:', await p.evaluate(() => [...document.querySelectorAll('.overlay')].map(o => o.innerText.slice(0, 200)).join(' || ') || 'none'));
if (hasB) { await p.evaluate(() => { const ov = document.querySelector('.overlay'); console.log('overlay:', ov ? ov.innerText.slice(0, 120) : 'none'); [...document.querySelectorAll('.prio button')].find(b => /Command zone/.test(b.textContent)).click(); }); }
await wait(800);
check('commander ask → command zone', hasB > 0 && await p.evaluate(id => KT.S.cards[id] && KT.S.cards[id].zone === 'command', cm), await p.evaluate(id => KT.S.cards[id] && KT.S.cards[id].zone, cm));
await p.screenshot({ path: '/home/claude/mtg/test/shots/ui_rules.png' });
console.log(results.join('\n'));
console.log('ERRORS', JSON.stringify(errs.slice(0, 10)));
await br.close();
