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

  let cards = [], info = {}, status = 'connecting', banner = null, bannerT = null, sel = null, client = null;
  const bottomSel = new Set();
  const send = m => client && client.send(m);

  function onMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hand') { cards = m.cards || []; info = m.info || {}; if (sel && !cards.some(c => c.id === sel)) sel = null; render(); }
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
        setTimeout(() => play(c.id, 'battlefield'), 180);
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
    if (banner) parts.push(h('div', { class: 'pbanner' }, banner));
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
    if (cards.length && info.phase !== 'bottom') parts.push(h('div', { class: 'phint' }, 'Swipe a card up to play it · tap to see it big'));
    if (sel) {
      const c = cards.find(x => x.id === sel);
      if (c) {
        const b = (label, how, cls) => h('button', { class: cls || '', onclick: () => play(c.id, how) }, label);
        parts.push(h('div', { class: 'pbig', onclick: e => { if (e.target.classList.contains('pbig')) { sel = null; render(); } } },
          h('img', { src: img(c), alt: c.d.n }),
          h('div', { class: 'pacts' },
            h('b', null, c.d.n),
            b(c.land ? 'Play land' : 'Battlefield', 'battlefield', 'primary'),
            b('Battlefield, tapped', 'tapped'),
            !c.land ? b('Cast (stack)', 'stack') : null,
            b('Face down', 'facedown'),
            b('Graveyard', 'graveyard'), b('Exile', 'exile'),
            b('Top of library', 'top'), b('Bottom of library', 'bottom'),
            b(c.rev ? 'Stop revealing' : 'Reveal to everyone', 'reveal'),
            h('button', { class: 'ghost', onclick: () => { sel = null; render(); } }, 'Close'))));
      }
    }
    root.replaceChildren(h('div', { class: 'phone' }, parts));
  }

  if (G.MODE === 'hand') G.ready.then(start);
  return { render };
})();
