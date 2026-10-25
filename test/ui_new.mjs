// Browser test of the newer table features through the real screens: Spree modes, an additional sacrifice cost,
// mutate's over/under question, impulse draw from exile, a free cast from hand, and an opponent's "may pay {2}".
// node test/ui_new.mjs   (needs the local web server on :8090 and the MQTT mock)
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1366, height: 820 } }); await mock(ctx);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('page: ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|net::/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await p.goto('http://localhost:8090/?t=uin' + Date.now() % 100000); await p.fill('#welcomename', 'Marissa'); await p.click('text=Join the table');
await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 20000 });
await p.evaluate(async () => { const h = await KT.importPrecon(window.KT_PRECONS[4], () => {}); await KT.useDeck(h); await KT.importPrecon(window.KT_PRECONS[6], () => {}); });
await p.evaluate(() => { const d = KT.decks().find(x => x.src === window.KT_PRECONS[6].id); KT.addAI('Chandra', d, 'normal'); });
await p.waitForFunction(() => KT.S.seats.length === 2 && KT.S.seats.every(x => KT.S.players[x].libCount > 0), null, { timeout: 60000 });
await p.evaluate(() => KT.act({ type: 'start' })); await wait(1500);
await p.evaluate(() => { if (KT.P.phase === 'none') KT.openingHand(); KT.keep(); });
// Wait for my turn, main phase, nothing pending; the AI takes its turn by itself.
const myMain = async () => { for (let i = 0; i < 240; i++) { const ok = await p.evaluate(() => { const s = KT.S; return s.turn.active === KT.KEY && /^Main/.test(Rules.PHASES[s.turn.phase]) && !s.prio && !Rules.stackTop(s) && !(s.ask || []).length && !(s.tq || []).length && !s.turn.goal; }); if (ok) return true; await p.evaluate(async () => { const s = KT.S, me = KT.KEY; if (s.prio && s.prio.holder === me) await KT.pass(); else if (s.combat && !s.combat.done && (s.combat.waiting || []).includes(me) && !s.combat.ok[me]) await KT.block([]); else if (s.turn.active === me && !s.turn.goal && !/^Main/.test(Rules.PHASES[s.turn.phase])) { /* moving along */ } }); await wait(250); } return false; };
const settle = async () => { for (let i = 0; i < 40; i++) { const busy = await p.evaluate(() => !!(KT.S.prio || Rules.stackTop(KT.S) || (KT.S.tq || []).length)); if (!busy) return; await p.evaluate(async () => { if (KT.S.prio && KT.S.prio.holder === KT.KEY) await KT.pass(); }); await wait(250); } };
const results = [];
const check = (name, ok, info) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const D = (n, t, o, mc, extra) => Object.assign({ n, cmc: 1, faces: [{ n, t, o, img: '', p: (extra && extra.p) || '', tg: (extra && extra.t) || '', mc: mc || '' }] });
const addHand = async (id, d) => p.evaluate(([id, d]) => { KT.P.hand.push({ id, d }); KT.render(); }, [id, d]);
const clickText = async (txt) => { const b = p.locator('.modal button', { hasText: txt }).first(); await b.waitFor({ timeout: 5000 }); await b.click(); };

console.log('my turn:', await myMain());
await p.evaluate(() => KT.act({ type: 'dev', on: true })); await wait(400);

// 1) Spree: choose both modes, both happen.
await addHand('spr1', D('Test Spree', 'Sorcery', 'Spree\n+ {1} — Draw a card.\n+ {2} — You gain 3 life.', '{G}'));
const life0 = await p.evaluate(() => KT.S.players[KT.KEY].life);
p.evaluate(() => KT.castFlow(KT.P.hand.find(c => c.id === 'spr1'), 'hand'));
await p.locator('.modal .modes .mode').first().waitFor({ timeout: 5000 });
await p.locator('.modal .modes .mode').nth(0).click(); await p.locator('.modal .modes .mode').nth(1).click();
await clickText('Choose (2)'); await wait(800); await settle(); await wait(500);
const life1 = await p.evaluate(() => KT.S.players[KT.KEY].life);
check('spree both modes', life1 === life0 + 3, `life ${life0} → ${life1}`);

// 2) Additional sacrifice cost.
await p.evaluate(() => KT.act({ type: 'enter', zone: 'battlefield', cards: [{ id: 'fod1', d: { n: 'Fodder', cmc: 1, faces: [{ n: 'Fodder', t: 'Creature — Thrull', o: '', img: '', p: '1', tg: '1', mc: '{B}' }] } }] }));
await myMain();
await addHand('rit1', D('Test Rites', 'Instant', 'As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.', '{B}'));
p.evaluate(() => KT.castFlow(KT.P.hand.find(c => c.id === 'rit1'), 'hand'));
await p.locator('.modal .pkchoices .tthumb, .modal .pkchoices button').first().waitFor({ timeout: 5000 });
const thumbs = p.locator('.modal .pkchoices .tthumb, .modal .pkchoices button');
const nT = await thumbs.count(); let clicked = false;
for (let i = 0; i < nT; i++) { const t = await thumbs.nth(i).getAttribute('title'); if (/Fodder/.test(t || '')) { await thumbs.nth(i).click(); clicked = true; break; } }
if (!clicked) await thumbs.first().click();
await wait(800); await settle();
check('sacrifice cost', await p.evaluate(() => KT.S.cards.fod1 && KT.S.cards.fod1.zone === 'graveyard'), await p.evaluate(() => KT.S.cards.fod1 && KT.S.cards.fod1.zone));

// 3) Mutate: over/under question.
await myMain();
await p.evaluate(() => KT.act({ type: 'enter', zone: 'battlefield', cards: [{ id: 'host1', d: { n: 'Bear Host', cmc: 2, faces: [{ n: 'Bear Host', t: 'Creature — Bear', o: '', img: '', p: '2', tg: '2', mc: '{1}{G}' }] } }] }));
await addHand('mut1', D('Test Mutator', 'Creature — Beast', 'Mutate {1}{G}\nTrample', '{3}{G}', { p: '5', t: '5' }));
await p.evaluate(() => KT.castFromHand('mut1', { alt: 'mutate', tg: [[{ c: 'host1' }]] }));
await wait(500); await settle();
await p.locator('.modal button', { hasText: 'on top' }).first().waitFor({ timeout: 6000 }).catch(() => {});
const hasQ = await p.locator('.modal button', { hasText: 'on top' }).count();
if (hasQ) await clickText('on top');
await wait(600);
check('mutate question + merge', hasQ > 0 && await p.evaluate(() => Rules.cardName(KT.S.cards.host1) === 'Test Mutator' && KT.S.cards.mut1.zone === 'merged'), await p.evaluate(() => Rules.cardName(KT.S.cards.host1) + ' / ' + (KT.S.cards.mut1 || {}).zone));

// 4) Impulse draw → exiled and playable.
await myMain();
const top = await p.evaluate(() => KT.P.library[0].id);
await p.evaluate(() => new Promise(r => KT.onTodo({ k: 'impulse', n: 1, until: 'eot', from: KT.S.turn.n, src: 'Test impulse' }, r)));
await wait(800);
check('impulse exile', await p.evaluate(id => KT.S.cards[id] && KT.S.cards[id].zone === 'exile' && !!KT.S.cards[id].mayPlay, top));

// 5) Free cast from hand.
await myMain();
await addHand('fre1', D('Free Bolt', 'Sorcery', 'You gain 2 life.', '{2}{R}'));
const life2 = await p.evaluate(() => KT.S.players[KT.KEY].life);
p.evaluate(() => new Promise(r => KT.onTodo({ k: 'freeCast', from: 'hand', filter: 'card', mvMax: 5, src: 'Test free' }, r)));
await p.locator('.modal .strip.pick .card').first().waitFor({ timeout: 5000 });
const cards = p.locator('.modal .strip.pick .card'); const nC = await cards.count(); let hit = false;
for (let i = 0; i < nC; i++) { const tx = await cards.nth(i).innerText().catch(() => ''); const ti = await cards.nth(i).getAttribute('title').catch(() => ''); if (/Free Bolt/.test(tx + ti)) { await cards.nth(i).click(); hit = true; break; } }
if (!hit) await cards.last().click();
await wait(900); await settle(); await wait(500);
check('free cast from hand', await p.evaluate(l => KT.S.players[KT.KEY].life >= l + 2, life2), `life ${life2} → ${await p.evaluate(() => KT.S.players[KT.KEY].life)}`);

// 6) An opponent's Smothering Tithe asks me to pay when I draw.
await myMain();
const ai = await p.evaluate(() => KT.S.seats.find(x => KT.S.players[x].ai));
await p.evaluate(ai => KT.act({ type: 'enter', zone: 'battlefield', as: ai, cards: [{ id: 'tithe1', d: { n: 'Test Tithe', cmc: 4, faces: [{ n: 'Test Tithe', t: 'Enchantment', o: "Whenever an opponent draws a card, that player may pay {2}. If they don't, you create a Treasure token.", img: '', p: '', tg: '', mc: '{3}{W}' }] } }] }), ai);
await wait(400);
const tr0 = await p.evaluate(ai => Object.values(KT.S.cards).filter(c => c.zone === 'battlefield' && c.ctrl === ai && /Treasure/.test(Rules.cardName(c))).length, ai);
await p.evaluate(() => KT.draw(1)); await wait(1200); await settle();
await p.locator('button', { hasText: 'Don’t pay' }).first().waitFor({ timeout: 8000 }).catch(() => {});
const bar = await p.locator('button', { hasText: 'Don’t pay' }).count();
if (bar) await p.locator('button', { hasText: 'Don’t pay' }).first().click();
await wait(1000); await settle(); await wait(600);
const tr1 = await p.evaluate(ai => Object.values(KT.S.cards).filter(c => c.zone === 'battlefield' && c.ctrl === ai && /Treasure/.test(Rules.cardName(c))).length, ai);
check('tithe pay bar', bar > 0 && tr1 === tr0 + 1, `bar ${bar}, treasures ${tr0} → ${tr1}`);

await p.screenshot({ path: '/home/claude/mtg/test/shots/ui_new.png' });
console.log(results.join('\n'));
console.log('ERRORS', JSON.stringify(errs.slice(0, 10)));
await br.close();
