// Kitchen Table — phone as your hand (opened from the QR code on your computer).
window.KTPhone = (function () {
  'use strict';
  const G = window.KT;
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (typeof v !== 'string' && k in e) e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return e;
  }

  let push = 'hand', chat = null, tab = 'hand', draft = '', chatTo = null;
  let cards = [], info = {}, status = 'connecting', banner = null, bannerT = null, sel = null, client = null, choose = null;
  const bottomSel = new Set();
  let elsewhere = null, selX = null;   // cards usable from outside the hand, and the one opened
  const send = m => client && client.send(m);

  function onMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hand') { push = m.push || 'hand'; chat = m.chat || null; elsewhere = m.elsewhere || null; if (push !== 'both') tab = push; cards = m.cards || []; info = m.info || {}; if (sel && !cards.some(c => c.id === sel)) sel = null; render(); }
    if (m.t === 'choose') { choose = m; sel = null; render(); return; }
    if (m.t === 'banner') {
      banner = m.text; clearTimeout(bannerT);
      bannerT = setTimeout(() => { banner = null; render(); }, 6000);
      render();
    }
  }

  function start() {
    if (client) return;
    let dev = G.LS.get('kt:phoneDev', null); if (!dev) { dev = Net.rid(16); G.LS.set('kt:phoneDev', dev); }
    const ua = navigator.userAgent;
    const label = (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : 'A phone or tablet') + (/CriOS|Chrome/.test(ua) ? ' (Chrome)' : /Safari/.test(ua) ? ' (Safari)' : /Firefox|FxiOS/.test(ua) ? ' (Firefox)' : '');
    client = new Net.PhoneClient(G.PHONE_ID, G.PHONE_SECRET, dev, label, onMsg, st => { status = st; render(); });
    client.start();
    try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
  }

  const img = c => (c.d && c.d.faces && c.d.faces[0] && c.d.faces[0].img) || '';

  function play(id, how) { sel = null; send({ t: 'play', id, how }); render(); }

  function cardView(c) {
    const el = h('div', { class: 'pc' + (c.d && c.d.fin ? ' ' + c.d.fin : '') + (c.rev ? ' rev' : '') + (bottomSel.has(c.id) ? ' sel' : '') }, h('img', { src: img(c), alt: c.d.n, draggable: false }), c.rev ? h('span', { class: 'ptag' }, 'Revealed') : null);
    let sx = 0, sy = 0, t0 = 0;
    el.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; t0 = Date.now(); el.style.transition = 'none'; }, { passive: true });
    el.addEventListener('touchmove', e => {
      const t = e.touches[0]; const dy = t.clientY - sy, dx = t.clientX - sx;
      if (dy < 0 && Math.abs(dy) > Math.abs(dx)) el.style.transform = `translateY(${Math.max(dy, -220)}px)`;
    }, { passive: true });
    el.addEventListener('touchend', e => {
      const t = e.changedTouches[0]; const dy = t.clientY - sy, dx = t.clientX - sx;
      el.style.transition = '';
      if (info.phase === 'bottom') { el.style.transform = ''; return; }
      if (dy < -70 && Math.abs(dx) < 80) {
        el.classList.add('fly');
        setTimeout(() => play(c.id, 'auto'), 180);
      } else el.style.transform = '';
    });
    el.addEventListener('click', () => {
      if (info.phase === 'bottom') {
        if (bottomSel.has(c.id)) bottomSel.delete(c.id); else if (bottomSel.size < info.bottomN) bottomSel.add(c.id);
        render(); return;
      }
      sel = c.id; render();
    });
    return el;
  }

  function render() {
    const root = document.getElementById('app');
    // Lost the computer for a while (or the code was replaced): don't keep showing an old hand.
    // Don't keep showing a hand once the link is gone, unlinked, refused or moved to another device.
    if (status === 'waiting' && client && client.lostFor > 3000 && cards.length) { cards = []; info = {}; sel = null; }
    if (['moved', 'denied', 'revoked'].includes(status) && cards.length) { cards = []; info = {}; sel = null; }
    const lost = status === 'waiting' && client && client.lostFor > 3000;
    const head = h('header', { class: 'phead' },
      h('span', { class: 'dot ' + (status === 'linked' ? 'on' : 'wait') }),
      h('b', null, info.name || 'Your hand'),
      info.name ? h('span', { class: 'plife' }, String(info.life)) : null,
      h('span', { class: 'pturn' + (info.myTurn ? ' me' : '') }, status === 'linked' ? (info.turn || 'Linked to your computer') : status === 'pending' ? 'Approve this phone on your computer' : status === 'denied' ? 'Not allowed — this hand code belongs to another seat' : status === 'moved' ? 'Your hand is on your other device' : status === 'revoked' ? 'This phone was unlinked' : status === 'waiting' ? 'Looking for your computer — keep Kitchen Table open there' : status === 'offline' ? 'No connection — retrying…' : 'Connecting…'),
      h('span', { class: 'sp' }),
      status === 'linked' && info.phase !== 'deciding' && info.phase !== 'bottom' && !cards.length && info.lib && info.phase !== 'kept' ? h('button', { class: 'primary', onclick: () => send({ t: 'opening' }) }, 'Opening hand') : null,
      status === 'linked' && info.phase !== 'deciding' && info.phase !== 'bottom' ? h('button', { onclick: () => send({ t: 'draw' }), disabled: !info.lib }, 'Draw') : null);
    const parts = [head];
    if (status === 'linked' && push === 'both') parts.push(h('div', { class: 'ptabs' }, h('button', { class: tab === 'hand' ? 'on' : '', onclick: () => { tab = 'hand'; render(); } }, 'Hand'), h('button', { class: tab === 'chat' ? 'on' : '', onclick: () => { tab = 'chat'; render(); } }, 'Chat')));
    if (status === 'linked' && chat && tab === 'chat') {
      // The AI chat box on the phone: read what the AI players say and ask them things.
      const log = h('div', { class: 'pchat' }, chat.lines.length ? chat.lines.map(l => h('div', { class: 'pline' + (l.mine ? ' mine' : '') }, h('b', null, l.who + (l.to ? ' → ' + l.to : '') + ': '), l.text)) : h('div', { class: 'pempty' }, 'No chat yet.'));
      const inp = h('input', { type: 'text', value: draft, placeholder: chat.ais.length ? 'Ask the AI…' : 'No AI players at the table', oninput: e => { draft = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') go(); } });
      const go = () => { const t = draft.trim(); if (!t) return; send({ t: 'chat', text: t, to: chatTo || (chat.ais[0] || {}).id }); draft = ''; inp.value = ''; };
      parts.push(log, h('div', { class: 'pchatin' }, chat.ais.length > 1 ? h('select', { onchange: e => { chatTo = e.target.value; } }, chat.ais.map(a => h('option', { value: a.id, selected: a.id === chatTo }, a.name))) : null, inp, h('button', { class: 'primary', onclick: go, disabled: !chat.ais.length }, 'Send')));
      const hadFocus = document.activeElement && document.activeElement.tagName === 'INPUT';
      const root0 = document.getElementById('app');
      root0.replaceChildren(h('div', { class: 'phone' }, parts));
      const pc = root0.querySelector('.pchat'); if (pc) pc.scrollTop = pc.scrollHeight;
      if (hadFocus) { const i2 = root0.querySelector('.pchatin input'); if (i2) { i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); } }
      return;
    }
    if (banner) parts.push(h('div', { class: 'pbanner' }, banner));
    if (status === 'linked' && info.over) parts.push(h('div', { class: 'pprio over' }, h('b', null, info.over), h('span', { class: 'muted' }, ' — rematch from your computer')));
    if (status === 'linked' && info.prio) parts.push(info.prio.mine
      ? h('div', { class: 'pprio mine' }, h('span', null, h('b', null, info.prio.step ? 'Combat tricks? ' : 'Respond? '), info.prio.text), h('button', { class: 'primary', onclick: () => send({ t: 'pass' }) }, info.prio.step ? 'Continue' : 'Pass'))
      : h('div', { class: 'pprio' }, h('span', null, info.prio.text + ' — waiting for ' + info.prio.waiting)));
    if (info.phase === 'deciding') parts.push(h('div', { class: 'pask' }, h('span', null, info.mull ? `Mulligan ${info.mull}: keep this hand?` : 'Keep this opening hand?'),
      h('button', { class: 'primary', onclick: () => send({ t: 'keep' }) }, 'Keep'), h('button', { onclick: () => send({ t: 'mulligan' }) }, 'Mulligan')));
    if (info.phase === 'bottom') parts.push(h('div', { class: 'pask' }, h('span', null, `Tap ${info.bottomN} card${info.bottomN > 1 ? 's' : ''} to put on the bottom`),
      h('button', { class: 'primary', disabled: bottomSel.size !== info.bottomN, onclick: () => { send({ t: 'bottom', ids: [...bottomSel] }); bottomSel.clear(); } }, `Done (${bottomSel.size}/${info.bottomN})`)));
    const strip = h('div', { class: 'phand' }, cards.length ? cards.map(cardView) : h('div', { class: 'pempty' },
      status === 'linked' ? 'Your hand is empty.'
      : status === 'pending' ? [h('div', { class: 'pcode' }, h('span', null, 'Your code'), h('b', null, client ? client.code : '')), h('p', null, 'Your computer is asking whether to link this phone. Check the code matches, then tap “Allow” there.')]
      : status === 'denied' ? [h('p', null, 'This phone wasn’t allowed. To join the game as your own player, open the Invite link instead.'), h('button', { onclick: () => client.askAgain() }, 'It’s my phone — ask again')]
      : status === 'revoked' ? 'This phone was unlinked from your hand. To link it again, scan the new code on your computer (Phone button).'
      : status === 'moved' ? [h('p', null, 'Your hand moved to another of your devices.'), h('button', { class: 'primary', onclick: () => client.useHere() }, 'Use this phone instead')]
      : lost ? 'Can’t find your computer. Make sure Kitchen Table is open there — if you made a new phone code, scan the new one.'
      : 'Waiting for your computer. Keep Kitchen Table open there.'));
    parts.push(strip);
    if (cards.length && info.phase !== 'bottom') parts.push(h('div', { class: 'phint' }, 'Swipe up: lands are played, everything else is cast onto the stack · tap a card to see it big'));
    // Below the hand: what I can use from elsewhere — rows shown only when something is in them.
    if (status === 'linked' && elsewhere && info.phase !== 'bottom' && info.phase !== 'deciding') {
      const ROWS = [['graveyard', 'From your graveyard'], ['exile', 'From exile'], ['top', 'Top of your library'], ['abilities', 'Abilities on the battlefield']];
      for (const [k, title] of ROWS) {
        const list = elsewhere[k] || []; if (!list.length) continue;
        parts.push(h('div', { class: 'prow' }, h('div', { class: 'prowt' }, title), h('div', { class: 'phand small' }, list.map(e => {
          const banner = e.grants && e.grants.length ? h('span', { class: 'pgrant' }, `${e.ways && e.ways.every(w => /^Play/.test(w.label)) ? 'Playable' : 'Castable'} through ${e.grants.join(' / ')}`) : null;
          const words = !banner && e.words ? h('span', { class: 'pgrant words' }, e.words) : null;
          const abil = k === 'abilities' ? h('span', { class: 'pgrant ab' + (e.abilities.every(a => a.why) ? ' off' : '') }, e.abilities.length === 1 ? e.abilities[0].cost : e.abilities.length + ' abilities') : null;
          return h('div', { class: 'pc' + (e.tapped ? ' tapped' : ''), onclick: () => { selX = { k, id: e.id }; sel = null; render(); } }, h('img', { src: img(e), alt: e.d.n, draggable: false }), banner, words, abil);
        }))));
      }
    }
    if (sel) {
      const c = cards.find(x => x.id === sel);
      if (c) {
        const b = (label, how, cls) => h('button', { class: cls || '', onclick: () => play(c.id, how) }, label);
        parts.push(h('div', { class: 'pbig', onclick: e => { if (e.target.classList.contains('pbig')) { sel = null; render(); } } },
          h('img', { src: img(c), alt: c.d.n }),
          h('div', { class: 'pacts' },
            h('b', null, c.d.n),
            c.land ? b('Play land', 'land', 'primary') : b(info.prio && info.prio.mine && !info.prio.step ? 'Cast in response' : 'Cast', 'cast', 'primary'),
            h('div', { class: 'pmove' }, 'Move to'),
            b('Battlefield', 'battlefield'),
            b('Battlefield, tapped', 'tapped'),
            b('Battlefield, face down', 'facedown'),
            b('Graveyard', 'graveyard'), b('Exile', 'exile'),
            b('Top of library', 'top'), b('Bottom of library', 'bottom'),
            b(c.rev ? 'Stop revealing' : 'Reveal to everyone', 'reveal'),
            h('button', { class: 'ghost', onclick: () => { sel = null; render(); } }, 'Close'))));
      }
    }
    if (selX && elsewhere) {
      const list = elsewhere[selX.k] || [], e = list.find(x => x.id === selX.id);
      if (!e) selX = null;
      else {
        const close = () => { selX = null; render(); };
        const acts = selX.k === 'abilities'
          ? e.abilities.map(a => h('button', { class: a.why ? 'ghost' : 'primary', disabled: !!a.why, onclick: () => { send({ t: 'ability', id: e.id, i: a.i }); close(); } }, h('b', null, a.cost + ': '), a.text.length > 80 ? a.text.slice(0, 78) + '…' : a.text, a.why ? h('span', { class: 'muted small' }, ' — ' + a.why) : null))
          : e.ways.map((w, i) => h('button', { class: 'primary', onclick: () => { send({ t: 'elsewhere', id: e.id, w: i }); close(); } }, w.label + (w.cost && !/free/i.test(w.label) ? ' — ' + w.cost : '')));
        parts.push(h('div', { class: 'pbig', onclick: ev => { if (ev.target.classList.contains('pbig')) close(); } },
          h('img', { src: img(e), alt: e.d.n }),
          h('div', { class: 'pacts' }, h('b', null, e.d.n),
            e.grants && e.grants.length ? h('div', { class: 'pgrantbig' }, `Castable through ${e.grants.join(' / ')}`) : e.words ? h('div', { class: 'pgrantbig' }, e.words) : null,
            acts, h('button', { class: 'ghost', onclick: close }, 'Close'))));
      }
    }
    if (choose) {
      const q = choose;
      const answer = v => { choose = null; send({ t: 'chosen', rid: q.rid, value: v }); render(); };
      parts.push(h('div', { class: 'pbig pchoose' }, h('div', { class: 'pacts' },
        h('b', null, q.title),
        q.options.map(o => h('button', { class: o.value === '__none' ? 'ghost' : '', onclick: () => answer(o.value) }, o.label)),
        h('button', { class: 'ghost', onclick: () => answer(null) }, 'Cancel'))));
    }
    // Re-rendering replaces the hand strip: keep where it was scrolled to.
    const old = root.querySelector('.phand'), sl = old ? old.scrollLeft : 0;
    root.replaceChildren(h('div', { class: 'phone' }, parts));
    const nw = root.querySelector('.phand'); if (nw && sl) nw.scrollLeft = sl;
  }

  if (G.MODE === 'hand') G.ready.then(start);
  return { render };
})();
