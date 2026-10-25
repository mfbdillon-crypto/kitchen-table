// A seat at a Kitchen Table game, driven over HTTP — for playtesting by a person-like client (another Claude).
// node test/seatd.mjs <name> <port> <table> <deckIndex>
//   GET  /view            → what this player sees (text)
//   POST /do   body: JS   → runs in the page; helpers on window.H (see below); returns JSON
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'module';
import http from 'http';
const require = createRequire(import.meta.url); const mock = require('./mock.js');
const [name, port, table, deckIdx] = [process.argv[2] || 'Seat', +(process.argv[3] || 7001), process.argv[4] || 'pt1', +(process.argv[5] || 0)];
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1366, height: 820 } }); await mock(ctx);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8090/?t=' + table); await p.fill('#welcomename', name); await p.click('text=Join the table');
await p.waitForFunction(() => KT.me && KT.me(), null, { timeout: 30000 });
await p.evaluate(async i => { const d = await KT.importPrecon(window.KT_PRECONS[i], () => {}); await KT.useDeck(d); }, deckIdx);
// Optional AI opponents: node test/seatd.mjs <name> <port> <table> <deck> <aiDeck[,aiDeck2]> <skill[,skill2]>
const AIS = (process.argv[6] || '').split(',').filter(Boolean).map(Number), SK = (process.argv[7] || 'normal').split(',');
if (AIS.length) {
  await p.evaluate(async ([ais, sk]) => { const names = ['Liliana', 'Nissa', 'Teferi']; for (let i = 0; i < ais.length; i++) { const d = await KT.importPrecon(window.KT_PRECONS[ais[i]], () => {}); KT.addAI(names[i], d, sk[i] || sk[0]); } }, [AIS, SK]);
  await p.waitForFunction(n => KT.S.seats.filter(x => KT.S.players[x].ai).length === n && KT.S.seats.every(x => KT.S.players[x].libCount > 0), AIS.length, { timeout: 60000 });
}
await p.evaluate(() => {
  const G = KT, R = Rules, CD = Cards;
  const S = () => G.S, me = () => G.KEY;
  const nm = c => R.cardName(c);
  const ptS = c => { const v = CD.pt(S(), c); return v ? ` ${v[0]}/${v[1]}` : ''; };
  const cnt = c => { const k = Object.entries(c.counters || {}); return k.length ? ' [' + k.map(([a, b]) => b + ' ' + a).join(', ') + ']' : ''; };
  const eot = c => c.eot && c.eot.length ? ' {EOT: ' + c.eot.map(b => b.label).join(', ') + '}' : '';
  const line = c => `${c.id} ${nm(c)}${ptS(c)}${c.tapped ? ' (tapped)' : ''}${cnt(c)}${eot(c)}${c.dmg ? ' dmg ' + c.dmg : ''}${c.attachedTo ? ' attached→' + c.attachedTo : ''}`;
  const hc = c => ({ id: c.id, owner: me(), ctrl: me(), d: c.d, zone: 'hand', counters: {}, face: 0 });
  window.H = {
    view() {
      const s = S(), T = s.turn, out = [];
      out.push(`Turn ${T.n} — ${T.active === me() ? 'YOUR turn' : R.nameOf(s, T.active) + "'s turn"} — step: ${R.PHASES[T.phase]}${T.goal ? ' (moving: ' + T.goal + ')' : ''}${s.winner ? ' — GAME OVER, winner ' + R.nameOf(s, s.winner) : ''}`);
      for (const pid of s.seats) { const P = s.players[pid]; out.push(`${pid === me() ? 'YOU' : P.name} (${pid}): life ${P.life}${P.poison ? ', poison ' + P.poison : ''}${P.energy ? ', energy ' + P.energy : ''}, hand ${pid === me() ? G.P.hand.length : P.handCount}, library ${P.libCount}${P.pool && P.pool.length ? ', mana pool ' + P.pool.join(' ') : ''}${s.table.monarch === pid ? ', MONARCH' : ''}`); }
      out.push('YOUR HAND:'); for (const c of G.P.hand) out.push(`  ${c.id} ${c.d.n} ${(c.d.faces[0].mc || '')} — ${c.d.faces[0].t}${G.isLand(c) ? '' : G.affordable(hc(c)) ? ' [can afford]' : ' [can’t afford]'}`);
      for (const pid of s.seats) {
        const bf = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === pid).sort((a, b) => a.seq - b.seq);
        out.push(`${pid === me() ? 'YOUR' : R.nameOf(s, pid) + "'s"} BATTLEFIELD:`); for (const c of bf) out.push('  ' + line(c));
        const gy = Object.values(s.cards).filter(c => c.zone === 'graveyard' && c.owner === pid); if (gy.length) out.push(`  graveyard: ${gy.map(c => c.id + ' ' + nm(c)).join('; ')}`);
        const cm = Object.values(s.cards).filter(c => c.zone === 'command' && c.owner === pid); if (cm.length) out.push(`  command zone: ${cm.map(c => c.id + ' ' + nm(c) + (s.tax[c.id] ? ' (tax ' + 2 * s.tax[c.id] + ')' : '')).join('; ')}`);
      }
      const st = R.stackCards(s); if (st.length) { out.push('STACK (bottom→top):'); for (const c of st) out.push(`  ${c.id} ${c.ab ? c.ab.name + (c.ab.trig ? ' TRIGGER' : ' ability') + ': ' + c.ab.text : nm(c)} (${R.nameOf(s, c.ctrl)})${c.tg && c.tg.some(l => l.length) ? ' targets ' + JSON.stringify(c.tg) : ''}`); }
      if (s.prio) out.push(`PRIORITY: holder ${s.prio.holder ? (s.prio.holder === me() ? 'YOU' : R.nameOf(s, s.prio.holder)) : 'none'}${s.prio.step ? ' (window before ' + (s.prio.step === 'end' ? 'the turn ends' : 'combat damage') + ')' : ''}`);
      const K = s.combat; if (K && K.n === T.n && !K.done) out.push(`COMBAT: ${JSON.stringify(K.att)} waiting blocks from ${K.waiting.filter(p => !K.ok[p]).map(p => R.nameOf(s, p)).join(', ') || 'nobody'}`);
      const asks = (s.ask || []).filter(a => a.pid === me()); if (asks.length) { out.push('QUESTIONS FOR YOU (answer with H.answer):'); for (const a of asks) out.push('  ' + JSON.stringify(a)); }
      const btns = [...document.querySelectorAll('#top .turn button')].map(b => b.innerText.trim()); out.push('Top-bar buttons: ' + (btns.join(' | ') || 'none'));
      const bars = [...document.querySelectorAll('.prio, .combatbar, .pickbar')].map(b => b.innerText.replace(/\s+/g, ' ').slice(0, 200)); if (bars.length) out.push('Prompts on screen: ' + bars.join(' || '));
      out.push('RECENT LOG:'); for (const l of s.log.slice(-14)) out.push('  ' + (l.pid ? R.nameOf(s, l.pid) + ' ' : '') + l.text);
      return out.join('\n');
    },
    playLand: id => G.playLand(id),
    // Cast from hand: tg = [[{c:id}|{p:pid}], ...] in the order the card says "target"; mode = [index…]; alt = 'flashback'|'kicker'… ; x = number
    async cast(id, opt) {
      opt = opt || {};
      const c = G.P.hand.find(x => x.id === id) || S().cards[id];
      if (!c) return { ok: false, err: 'no such card' };
      const card = G.P.hand.includes(c) ? hc(c) : c;
      let cost = CD.costOf(card);
      if (opt.alt) { const k = (G.castOptions(card, card.zone === 'hand' ? 'hand' : card.zone) || []).find(k => k.kind === opt.alt); if (k) { const m = (String(k.cost).match(/\{[^}]+\}/g) || []).join(''); if (k.additional) { const b = CD.parseCost(m); for (const q of ['g', 'W', 'U', 'B', 'R', 'G', 'C', 'x']) cost[q] += b[q] || 0; } else cost = CD.parseCost(m); } }
      if (!(await G.autoPay(card, opt.x || 0, cost))) return { ok: false, err: 'cannot pay' };
      const o = { tg: opt.tg, mode: opt.mode, x: opt.x, alt: opt.alt, wardPaid: opt.wardPaid, fromPool: G.lastFromPool };
      if (G.P.hand.includes(c)) { await G.castFromHand(id, o); return { ok: !G.P.hand.some(x => x.id === id) }; }
      return G.castPublic(id, o);
    },
    activate: (id, i, opt) => { opt = opt || {}; return G.act({ type: 'activate', id, i, tg: opt.tg, x: opt.x, crew: opt.crew, sac: opt.sac }); },
    abilities: id => CD.abilities(S().cards[id]).map((a, i) => i + ': ' + a.cost + ': ' + a.text),
    targets: (id, mode) => { const c = G.P.hand.find(x => x.id === id); const card = c ? hc(c) : S().cards[id]; return CD.targetReqs(card, mode).map(r => ({ need: r.text, n: r.n, upTo: r.upTo, choices: CD.targetChoices(S(), r, me()) })); },
    combat: () => G.act({ type: 'advance', goal: 'combat' }),
    endTurn: () => G.act({ type: 'advance', goal: 'end' }),
    attack: (ids, def) => G.act({ type: 'attack', list: ids.map(id => ({ id, p: def || S().seats.find(p => p !== me() && !S().players[p].lost) })) }),
    noAttack: () => G.act({ type: 'attack', list: [] }),
    block: pairs => G.act({ type: 'block', list: pairs.map(([b, a]) => ({ id: b, att: a })) }),
    pass: () => G.pass(),
    answer: (id, extra) => G.act(Object.assign({ type: 'answer', id }, extra || {})),
    tap: (ids, on) => G.tap(ids, on !== false),
    move: (ids, to) => G.act({ type: 'move', ids, to }),
    counter: (id, kind, delta) => G.act({ type: 'counter', id, kind, delta }),
    draw: n => G.draw(n || 1),
    start: () => G.act({ type: 'start' }),
    ask: (text, to) => G.act({ type: 'aiAsk', to: to || S().seats.find(p => S().players[p].ai), text }),
    aiChat: () => (S().aichat || []).slice(-6).map(m => m.kind + ': ' + m.text)
  };
  KT.openingHand(); KT.keep();
});
await p.evaluate(() => (() => { const old = H.view; H.view = function () { let v = old(); const ms = [...document.querySelectorAll('.modal')].map(m => m.innerText.replace(/\s+/g, ' ').slice(0, 500)); if (ms.length) v += '\nWINDOW OPEN ON YOUR SCREEN (use H.modalPick(i) to click card i, H.modalClick("button text")): ' + ms.join(' || ') + '\n  cards in window: ' + [...document.querySelectorAll('.modal .card')].map((c, i) => i + ':' + (c.querySelector('img') ? c.querySelector('img').alt : '?')).join(', '); const td = ((KT.S.todo || {})[KT.KEY] || []); if (td.length) v += '\nPENDING EFFECTS FOR YOU: ' + JSON.stringify(td); return v; };
H.modalPick = i => { const el = [...document.querySelectorAll('.modal .card')][i]; if (!el) return 'no card ' + i; el.click(); return 'clicked ' + i; };
H.modalClick = t => { const b = [...document.querySelectorAll('.modal button')].find(b => b.innerText.toLowerCase().includes(String(t).toLowerCase())); if (!b) return 'no button ' + t + '; buttons: ' + [...document.querySelectorAll('.modal button')].map(b => b.innerText).join(' | '); b.click(); return 'clicked ' + b.innerText; };
return 'patched'; })());
const server = http.createServer(async (req, res) => {
  let body = ''; req.on('data', d => body += d); await new Promise(r => req.on('end', r));
  try {
    if (req.url.startsWith('/view')) { const v = await p.evaluate(() => H.view()); res.end(v + (errs.length ? '\nPAGE ERRORS: ' + errs.slice(-5).join(' | ') : '') + '\n'); return; }
    if (req.url.startsWith('/aiplan')) { const v = await p.evaluate(() => [...document.querySelectorAll('iframe')].map(f => { try { const sn = f.contentWindow.KT && f.contentWindow.KT.aiSnapshot && f.contentWindow.KT.aiSnapshot(); return sn ? JSON.stringify(sn, null, 1) : ''; } catch (e) { return ''; } }).filter(Boolean).join('\n=====\n')); res.end(v + '\n'); return; }
    if (req.url.startsWith('/shot')) { await p.screenshot({ path: '/home/claude/mtg/test/shots/seat_' + name + '.png' }); res.end('saved test/shots/seat_' + name + '.png\n'); return; }
    if (req.url.startsWith('/do')) { const r = await p.evaluate(async code => { try { const v = await (0, eval)('(async () => (' + code + '))()'); return JSON.stringify(v === undefined ? null : v); } catch (e) { return 'ERROR ' + e.message; } }, body); await new Promise(r => setTimeout(r, 700)); res.end(r + '\n'); return; }
    res.end('GET /view, GET /shot, POST /do <js expression using H>\n');
  } catch (e) { res.end('ERROR ' + e.message + '\n'); }
});
server.listen(port, () => console.log(`${name} ready on ${port}`));
