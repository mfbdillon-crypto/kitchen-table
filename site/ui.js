// Kitchen Table — everything you see and click.
(function () {
  'use strict';
  const G = window.KT, R = Rules;
  if (G.MODE === 'ai') return;          // an AI player's hidden page has no screen
  const CD = window.Cards;
  let KEY = G.KEY; // set after the identity loads (boot at the bottom)
  const S = () => G.S;
  const $ = (s, r) => (r || document).querySelector(s);
  const COARSE = matchMedia('(pointer: coarse)').matches;

  // ======================= helpers =======================
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv; } }
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (typeof v !== 'string' && k in e) e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const nameOf = pid => R.nameOf(S(), pid);
  const ZLABEL = { battlefield: 'Battlefield', stack: 'Stack', graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone', hand: 'Hand', library: 'Library' };

  // Default card back.
  const BACK = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 63 88"><defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#3b2b1c"/><stop offset="1" stop-color="#140e09"/></radialGradient></defs><rect width="63" height="88" rx="3.5" fill="#0d0a07"/><rect x="2.5" y="2.5" width="58" height="83" rx="2.5" fill="url(#g)"/><ellipse cx="31.5" cy="44" rx="17" ry="24" fill="none" stroke="#d1a54b" stroke-width="1.2" opacity=".75"/><ellipse cx="31.5" cy="44" rx="11" ry="16" fill="none" stroke="#d1a54b" stroke-width=".6" opacity=".5"/><text x="31.5" y="47.5" font-family="Georgia,serif" font-size="9" fill="#d1a54b" text-anchor="middle" opacity=".9">KT</text></svg>`);
  const lookOf = pid => { const v = G.table && G.table.sleeves[pid]; return !v ? {} : typeof v === 'string' ? { sleeve: v } : v; };
  const sleeveOf = pid => lookOf(pid).sleeve || BACK;

  // Color palettes for a player's side of the table: accent, two board colors, row tint.
  const PALETTES = {
    felt:     { name: 'Felt table', a: '#d1a54b', b1: '#1b2822', b2: '#141d18', row: 'rgba(0,0,0,.2)' },
    plains:   { name: 'Plains',     a: '#f3d77c', b1: '#34301f', b2: '#1d1b14', row: 'rgba(255,240,200,.06)' },
    island:   { name: 'Island',     a: '#62b4f0', b1: '#16304a', b2: '#0f1a28', row: 'rgba(120,190,255,.07)' },
    swamp:    { name: 'Swamp',      a: '#b996e0', b1: '#2a1f35', b2: '#141019', row: 'rgba(0,0,0,.28)' },
    mountain: { name: 'Mountain',   a: '#f2825a', b1: '#3a1c16', b2: '#1c100d', row: 'rgba(255,120,80,.06)' },
    forest:   { name: 'Forest',     a: '#86d67e', b1: '#183823', b2: '#0e1d13', row: 'rgba(120,220,120,.06)' },
    azorius:  { name: 'Azorius (white/blue)', a: '#a8d4f5', b1: '#22324a', b2: '#171c26', row: 'rgba(200,230,255,.07)' },
    dimir:    { name: 'Dimir (blue/black)',   a: '#7d9be6', b1: '#18213c', b2: '#0d0f18', row: 'rgba(0,0,0,.25)' },
    rakdos:   { name: 'Rakdos (black/red)',   a: '#ea5a4c', b1: '#33121a', b2: '#120a0c', row: 'rgba(0,0,0,.25)' },
    gruul:    { name: 'Gruul (red/green)',    a: '#eaa13f', b1: '#33240f', b2: '#15180c', row: 'rgba(255,170,80,.06)' },
    selesnya: { name: 'Selesnya (green/white)', a: '#c3e27e', b1: '#263a1e', b2: '#171d12', row: 'rgba(220,255,180,.06)' },
    orzhov:   { name: 'Orzhov (white/black)', a: '#e4d8b5', b1: '#2c2a2a', b2: '#121112', row: 'rgba(255,250,230,.05)' },
    izzet:    { name: 'Izzet (blue/red)',     a: '#4fd0f0', b1: '#1a2a44', b2: '#2a1218', row: 'rgba(120,220,255,.06)' },
    golgari:  { name: 'Golgari (black/green)', a: '#a7bd5e', b1: '#1e2614', b2: '#110f0c', row: 'rgba(0,0,0,.22)' },
    boros:    { name: 'Boros (red/white)',    a: '#f5bd52', b1: '#3a2214', b2: '#22180f', row: 'rgba(255,220,150,.06)' },
    simic:    { name: 'Simic (green/blue)',   a: '#52d9bb', b1: '#123232', b2: '#0e1c26', row: 'rgba(100,240,210,.06)' }
  };
  function boardStyle0(deck) {
    const pal = PALETTES[deck.palette] || PALETTES.felt;
    const st = { '--pa': pal.a, '--pb1': pal.b1, '--pb2': pal.b2, '--prow': pal.row };
    if (deck.mat) st['--mat'] = `url("${deck.mat}")`;
    return st;
  }
  function boardStyle(pid) {
    const L = lookOf(pid);
    const pal = PALETTES[L.palette] || PALETTES.felt;
    const st = { '--pa': pal.a, '--pb1': pal.b1, '--pb2': pal.b2, '--prow': pal.row };
    if (L.mat) st['--mat'] = `url("${L.mat}")`;
    return st;
  }

  // ======================= toasts =======================
  G.toast = function (text, kind) {
    const box = $('#toasts'); if (!box) return;
    // The same message again just stays up a little longer instead of stacking.
    const same = [...box.children].find(x => x.textContent === String(text) && !x.classList.contains('out'));
    const t = same || h('div', { class: 'toast ' + (kind || '') }, text);
    if (!same) box.append(t);
    if (kind === 'turn') [...box.children].forEach(x => { if (x !== t) x.remove(); });
    while (box.children.length > 3) box.firstChild.remove();
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, kind === 'err' ? 4500 : kind === 'alert' ? 7000 : 3200);
  };

  // ======================= modal =======================
  let modal = null;
  function openModal(title, build, opts) {
    closeModal(true);
    opts = opts || {};
    const body = h('div', { class: 'mbody' });
    const box = h('div', { class: 'modal ' + (opts.cls || ''), role: 'dialog', 'aria-label': title },
      h('header', null, h('h2', null, title), h('button', { class: 'x', title: 'Close', onclick: () => closeModal() }, '✕')),
      body);
    const ov = h('div', { class: 'overlay', onmousedown: e => { if (e.target === ov && !opts.sticky) closeModal(); } }, box);
    document.body.append(ov);
    modal = { ov, body, build, opts, title };
    build(body);
    return modal;
  }
  function closeModal(silent) {
    if (!modal) return;
    const m = modal; modal = null;
    m.ov.remove();
    if (!silent && m.opts.onClose) m.opts.onClose();
    setTimeout(() => pumpAsks(), 30);
  }
  function refreshModal() {
    if (!modal || !modal.opts.live) return;
    const sc = modal.body.querySelector('[data-scroll]');
    const pos = sc ? [sc.scrollLeft, sc.scrollTop] : null;
    const bodyTop = modal.body.scrollTop;
    modal.body.innerHTML = ''; modal.build(modal.body);
    const sc2 = modal.body.querySelector('[data-scroll]');
    if (pos && sc2) { sc2.scrollLeft = pos[0]; sc2.scrollTop = pos[1]; }
    modal.body.scrollTop = bodyTop;
  }

  function askNumber(title, def, then, max) {
    openModal(title, b => {
      const inp = h('input', { type: 'number', min: '1', max: String(max || 99), value: String(def || 1), id: 'num-in', class: 'num' });
      const go = () => { const n = Math.max(1, Math.min(max || 99, parseInt(inp.value, 10) || 1)); closeModal(); then(n); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      b.append(h('div', { class: 'row' }, inp, h('button', { class: 'primary', onclick: go }, 'OK')));
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
    }, { cls: 'small' });
  }

  function choose(title, text, options) {
    openModal(title, b => {
      if (text) b.append(h('p', null, text));
      b.append(h('div', { class: 'row wrap' }, options.map(o => h('button', { class: o.primary ? 'primary' : '', onclick: () => { closeModal(); o.fn(); } }, o.label))));
    }, { cls: 'small' });
  }

  // ======================= menu =======================
  let menu = null;
  function openMenu(anchor, items, title) {
    closeMenu();
    const box = h('div', { class: 'menu', role: 'menu' });
    const show = (list, head, back) => {
      box.innerHTML = '';
      if (head) box.append(h('div', { class: 'mhead' }, back ? h('button', { class: 'back', onclick: e => { e.stopPropagation(); back(); } }, '‹') : null, head));
      for (const it of list) {
        if (!it) continue;
        if (it.sep) { box.append(h('div', { class: 'msep' })); continue; }
        if (it.note) { box.append(h('div', { class: 'mnote' }, it.note)); continue; }
        const b = h('button', { role: 'menuitem', class: it.sub ? 'has-sub' : '', disabled: !!it.disabled }, it.label);
        b.onclick = e => {
          e.stopPropagation();
          if (it.sub) show(it.sub.filter(Boolean), it.label, () => show(items, title));
          else { closeMenu(); it.fn(); }
        };
        box.append(b);
      }
    };
    show(items, title);
    document.body.append(box);
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y };
    const W = window.innerWidth, H = window.innerHeight;
    box.style.left = Math.max(8, Math.min(W - 240, r.right + 4)) + 'px';
    box.style.top = Math.max(8, Math.min(H - box.offsetHeight - 8, r.top)) + 'px';
    if (r.right + 244 > W) box.style.left = Math.max(8, r.left - 244) + 'px';
    menu = box;
    setTimeout(() => document.addEventListener('mousedown', menuAway, true), 0);
  }
  function menuAway(e) { if (menu && !menu.contains(e.target)) closeMenu(); }
  function closeMenu() { if (menu) { menu.remove(); menu = null; } document.removeEventListener('mousedown', menuAway, true); }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (menu) { closeMenu(); return; }
    if (G.targeting) { G.targeting = null; render(); return; }
    if (G.picking) { const p = G.picking; G.picking = null; p.cancel(); render(); return; }
    if (G.combatPick) { G.combatPick = null; render(); return; }
    if (modal && !modal.opts.noEsc) closeModal();
  });

  // ======================= hover preview =======================
  // A temporary picture that follows the mouse while it's over a card, and vanishes as soon as it isn't.
  const prev = h('div', { id: 'preview', hidden: true });
  let prevSrc = null;
  function placePreview(x, y) {
    const W = window.innerWidth, H = window.innerHeight;
    const w = prev.offsetWidth || 260, ht = prev.offsetHeight || 360;
    let left = x + 22, top = y - ht / 2;
    if (left + w > W - 8) left = x - w - 22;          // flip to the left of the cursor near the right edge
    top = Math.max(8, Math.min(H - ht - 8, top));
    prev.style.transform = `translate(${Math.round(Math.max(8, left))}px, ${Math.round(top)}px)`;
  }
  function showPreview(c, e) {
    if (COARSE || !e || G.combatPick) return;     // while picking attackers/blockers the big card would cover the creature next to it
    prevSrc = e.currentTarget;
    const imgs = previewImgs(c);
    if (!imgs.length) return hidePreview();
    prev.innerHTML = '';
    for (const src of imgs) prev.append(h('img', { src, alt: '' }));
    const info = previewInfo(c);
    if (info) prev.append(info);
    prev.hidden = false;
    placePreview(e.clientX, e.clientY);
  }
  function hidePreview() { if (!prev.hidden) prev.hidden = true; prevSrc = null; }
  // Follow the mouse; hide the moment it isn't over the card that opened the preview.
  let mouseX = -1, mouseY = -1;
  // After the board redraws, keep the preview only if the mouse is still over that same card.
  function recheckPreview() {
    if (prev.hidden) return;
    const under = mouseX >= 0 && document.elementFromPoint(mouseX, mouseY);
    const card = under && under.closest && under.closest('.card, .pile, .dline');
    const id = prevSrc && prevSrc.dataset && prevSrc.dataset.id;
    if (card && id && card.dataset.id === id) prevSrc = card;
    else if (!prevSrc || !prevSrc.isConnected || !card || card !== prevSrc) hidePreview();
  }
  document.addEventListener('mousemove', e => {
    mouseX = e.clientX; mouseY = e.clientY;
    if (prev.hidden) return;
    if (!prevSrc || !prevSrc.isConnected || !prevSrc.contains(e.target)) return hidePreview();
    placePreview(e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener('mousedown', hidePreview, true);
  document.addEventListener('wheel', hidePreview, { passive: true, capture: true });
  document.addEventListener('scroll', hidePreview, true);
  window.addEventListener('blur', hidePreview);
  document.addEventListener('mouseleave', hidePreview);
  function previewImgs(c) {
    let d = c.d;
    if (c.faceDown || !d) { d = c.owner === KEY ? G.peek(c.id) : null; if (!d) return [sleeveOf(c.owner)]; }
    const faces = d.faces || [];
    const i = c.face || 0;
    const out = [faces[i] && faces[i].img].filter(Boolean);
    if (faces.length > 1 && faces[1 - i] && faces[1 - i].img) out.push(faces[1 - i].img);
    return out;
  }
  function previewInfo(c) {
    const bits = [];
    if (c.faceDown) bits.push(c.owner === KEY ? 'Face down (only you can see it)' : 'Face down');
    if (c.owner && c.ctrl && c.owner !== c.ctrl) bits.push(`Owner: ${nameOf(c.owner)} · Controller: ${nameOf(c.ctrl)}`);
    const k = Object.entries(c.counters || {});
    if (k.length) bits.push(k.map(([n, v]) => `${v} ${n}`).join(' · '));
    if (c.mod) bits.push(`Until end of turn: ${c.mod[0] >= 0 ? '+' : ''}${c.mod[0]}/${c.mod[1] >= 0 ? '+' : ''}${c.mod[1]}`);
    if (c.cmdr && S() && S().tax[c.id]) bits.push(`Commander tax: {${2 * S().tax[c.id]}}`);
    return bits.length ? h('div', { class: 'pinfo' }, bits.map(b => h('div', null, b))) : null;
  }

  // ======================= card element =======================
  function canAct(c) {
    if (!c || !G.seated()) return false;
    if (c.zone === 'hand' || c.zone === 'library') return c.owner === KEY;
    return R.canAct(S(), KEY, c);
  }

  function cardEl(c, opt) {
    opt = opt || {};
    const f = R.face(c);
    let src = f && f.img;
    if (c.faceDown || !c.d) src = sleeveOf(c.owner);
    const mine = canAct(c);
    const fin = !c.faceDown && c.d && c.d.fin ? ' ' + c.d.fin : '';
    const el = h('div', { class: 'card' + fin + (c.faceDown ? ' fd' : '') + (c.tapped && c.zone === 'battlefield' ? ' tap' : '') + (opt.cls ? ' ' + opt.cls : ''), 'data-id': c.id, tabindex: '0' },
      h('img', { src: src || BACK, alt: c.faceDown ? 'Face-down card' : R.cardName(c), draggable: false, loading: 'lazy' }));
    if (!src) el.append(h('div', { class: 'noimg' }, R.cardName(c)));
    if (c.faceDown && c.owner === KEY && G.peek(c.id)) el.append(h('div', { class: 'peek' }, 'face down'));

    // counter bars (right side)
    const ks = Object.entries(c.counters || {});
    if (ks.length && (c.zone === 'battlefield' || c.zone === 'exile')) {
      const bars = h('div', { class: 'bars' });
      // Phones: small cards fit 2 counters (1 when tapped); the last one shows how many more there are.
      const room = COARSE ? (c.tapped || ks.length > 2 ? 1 : 2) : ks.length;
      const shown = ks.slice(0, room);
      const extra = ks.length - shown.length;
      shown.forEach(([kind, n], i) => {
        const bar = h('div', { class: 'bar ' + (i % 2 ? 'gray' : 'black'), title: `${n} ${kind} counter${n > 1 ? 's' : ''}` },
          h('span', { class: 'bn' }, String(n)), h('span', { class: 'bk' }, shortCounter(kind)), h('span', { class: 'ba' }, tinyCounter(kind)));
        if (mine && !opt.noButtons) {
          bar.append(h('span', { class: 'arrows' },
            h('button', { class: 'up', title: 'Add one', onclick: e => { e.stopPropagation(); G.counter(c.id, kind, 1); } }, '▲'),
            h('button', { class: 'dn', title: 'Remove one', onclick: e => { e.stopPropagation(); G.counter(c.id, kind, -1); } }, '▼')));
        }
        bars.append(bar);
      });
      el.append(bars);
      if (extra) el.append(h('div', { class: 'cmore', title: 'More counters — tap the card to see them all' }, '+' + extra));
    }
    // P/T badge
    if (c.zone === 'battlefield') {
      const pt = R.ptOf(c);
      if (pt && (R.isType(c, 'creature') || c.faceDown || ks.some(([k]) => /\/\+?-?1$/.test(k)))) {
        const f2 = R.face(c);
        const base = c.faceDown ? [2, 2] : [parseInt(f2.p, 10), parseInt(f2.tg, 10)];
        const cls = pt[0] > base[0] || pt[1] > base[1] ? 'up' : pt[0] < base[0] || pt[1] < base[1] ? 'down' : '';
        el.append(h('button', { class: 'pt ' + cls, title: mine ? 'Change power/toughness until end of turn' : 'Power/toughness', onclick: e => { e.stopPropagation(); if (mine) ptModal(c.id); } }, `${pt[0]}/${pt[1]}`));
      }
    }
    if (c.token && !c.ab) el.append(h('div', { class: 'tag tok' }, 'Token'));
    if (c.zone === 'battlefield' && c.dmg) el.append(h('div', { class: 'tag dmg', title: 'Damage marked this turn' }, c.dmg + ' dmg'));
    if (c.zone === 'battlefield' && c.grant && c.grant.length) el.append(h('div', { class: 'tag grant', title: 'Until end of turn' }, c.grant.join(', ')));
    const K = S() && S().combat;
    if (c.zone === 'battlefield' && K && !K.done && K.att && K.att[c.id]) { const d = K.att[c.id].def; el.classList.add('attacking'); el.append(h('div', { class: 'tag atk' }, '⚔ ' + (d.p ? nameOf(d.p) : R.cardName(S().cards[d.c] || {})))); }
    if (c.zone === 'battlefield' && K && !K.done && K.att && Object.values(K.att).some(a => (a.blk || []).includes(c.id))) { el.classList.add('blocking'); el.append(h('div', { class: 'tag blk' }, '🛡 blocking')); }
    if (G.picking && c.zone !== 'hand' && c.zone !== 'library') { const st = pickState({ c: c.id }); if (st) el.classList.add(st); }
    if (G.combatPick && c.zone === 'battlefield') { const st = combatState(c); if (st) el.classList.add(st); }
    if (c.ab) el.append(h('div', { class: 'abtext' }, h('b', null, 'Ability'), ' ', c.ab.text));
    if (c.noUntap && c.zone === 'battlefield') el.append(h('div', { class: 'tag nou' }, 'Doesn’t untap'));
    if (c.zeroT && c.zone === 'battlefield') el.append(h('div', { class: 'tag zero' }, '0 toughness'));
    if (c.owner && c.ctrl && c.owner !== c.ctrl && c.zone === 'battlefield') el.append(h('div', { class: 'tag own', title: 'Owner' }, 'Owner: ' + nameOf(c.owner)));
    if (c.cmdr && c.zone === 'command' && S().tax[c.id]) el.append(h('div', { class: 'tag tax' }, 'Tax {' + 2 * S().tax[c.id] + '}'));
    if (opt.badge) el.append(h('div', { class: 'tag tok' }, opt.badge));

    const items = () => (opt.menu || cardMenu)(c);
    el.addEventListener('mouseenter', e => showPreview(c, e));
    el.addEventListener('mouseleave', hidePreview);
    el.addEventListener('contextmenu', e => { e.preventDefault(); if (!opt.noMenu) { hidePreview(); openMenu({ x: e.clientX, y: e.clientY }, items(), R.cardName(c)); } });
    // Double-click a permanent you control to tap or untap it quickly.
    el.addEventListener('dblclick', e => { if (c.zone === 'battlefield' && c.ctrl === KEY && G.seated()) { e.stopPropagation(); closeMenu(); G.tap([c.id], !c.tapped); } });
    el.addEventListener('click', e => {
      if (G.targeting) { e.stopPropagation(); finishTarget(c); return; }
      if (G.picking && c.zone !== 'hand' && c.zone !== 'library' && !opt.noMenu) { e.stopPropagation(); pickTarget({ c: c.id }); return; }
      if (G.combatPick && c.zone === 'battlefield') { e.stopPropagation(); combatClick(c); return; }
      if (opt.onClick) return opt.onClick(c, e);
      if (COARSE) { enlarge(c, !opt.noMenu ? items : null); return; }
      if (opt.noMenu) return;
      hidePreview();
      openMenu(el, items(), R.cardName(c));
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    if (opt.swipeUp && COARSE) {
      let sx = 0, sy = 0, moved = false;
      el.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; moved = false; el.style.transition = 'none'; }, { passive: true });
      el.addEventListener('touchmove', e => { const t = e.touches[0]; const dy = t.clientY - sy, dx = t.clientX - sx; if (dy < -10 && Math.abs(dy) > Math.abs(dx)) { moved = true; el.style.transform = `translateY(${Math.max(dy, -160)}px)`; } }, { passive: true });
      el.addEventListener('touchend', e => {
        const t = e.changedTouches[0]; const dy = t.clientY - sy, dx = t.clientX - sx;
        el.style.transition = ''; el.style.transform = '';
        if (moved && dy < -60 && Math.abs(dx) < 70) { e.preventDefault(); el.classList.add('fly'); opt.swipeUp(c); }
      });
    }
    return el;
  }

  function tinyCounter(k) {
    const map = { '+1/+1': '+1', '-1/-1': '−1', loyalty: 'loy', defense: 'def', 'first strike': '1st', 'double strike': 'dbl', deathtouch: 'dth', indestructible: 'ind', lifelink: 'lnk', hexproof: 'hex', flying: 'fly', trample: 'trm', vigilance: 'vig', shield: 'shd' };
    return map[k] || k.slice(0, 3);
  }
  function shortCounter(k) {
    const map = { 'first strike': '1st strike', 'double strike': 'dbl strike', indestructible: 'indestr.', deathtouch: 'deathtch', vigilance: 'vigil.', hexproof: 'hexprf', lifelink: 'lifelnk', loyalty: 'loyalty', defense: 'defense' };
    return map[k] || (k.length > 9 ? k.slice(0, 8) + '…' : k);
  }

  // Battlefield slot: a card plus anything attached to it.
  function slotEl(c) {
    const attached = Object.values(S().cards).filter(o => o.attachedTo === c.id && o.zone === 'battlefield').sort((a, b) => a.seq - b.seq);
    const slot = h('div', { class: 'slot' + (c.tapped ? ' tapped' : ''), style: { '--att': String(attached.length) } });
    attached.forEach((a, i) => {
      const ae = cardEl(a, { cls: 'att' });
      ae.style.setProperty('--i', String(i));
      slot.append(ae);
    });
    slot.append(cardEl(c, { cls: 'host' }));
    return slot;
  }

  // On phones: tap to enlarge, tap again for actions.
  function enlarge(c, itemsFn) {
    hidePreview();
    let sub = null; // an opened submenu, shown in place
    openModal(R.cardName(c), b => {
      const imgs = previewImgs(c);
      const pic = h('div', { class: 'enlarge' }, imgs.map(src => h('img', { src, alt: '' })));
      const acts = h('div', { class: 'eacts' });
      const list = sub ? [{ label: '‹ Back', back: true }].concat(sub.items) : (itemsFn ? itemsFn() : []);
      if (sub) acts.append(h('div', { class: 'ehead' }, sub.label));
      for (const it of list) {
        if (!it) continue;
        if (it.sep) continue;
        if (it.note) { acts.append(h('div', { class: 'mnote' }, it.note)); continue; }
        acts.append(h('button', { class: it.sub ? 'has-sub' : '', onclick: () => {
          if (it.back) { sub = null; refreshModal(); return; }
          if (it.sub) { sub = { label: it.label, items: it.sub.filter(Boolean) }; refreshModal(); return; }
          closeModal(); it.fn();
        } }, it.label + (it.sub ? ' ›' : '')));
      }
      b.append(h('div', { class: 'ewrap' }, pic, h('div', { class: 'eside' }, previewInfo(c), acts)));
    }, { cls: 'enl', live: true });
  }

  // ======================= card menus =======================
  const others = () => S().seats.filter(p => p !== KEY);

  function cmdrCheck(c, to, go) {
    // 903.9: a commander headed to a graveyard, exile, hand or library may go to the command zone instead.
    if (c.cmdr && ['hand', 'library'].includes(to)) {
      choose('Commander', `${R.cardName(c)} would go to ${to === 'library' ? 'your library' : 'your hand'}. Put it in the command zone instead?`, [
        { label: 'Command zone', primary: true, fn: () => G.move([c.id], 'command') },
        { label: ZLABEL[to], fn: go }
      ]);
    } else go();
  }
  function mv(c, to, pos, extra) { return () => cmdrCheck(c, to, () => G.move([c.id], to, pos, extra)); }

  function moveSub(c, from) {
    const z = c.zone;
    return [
      z !== 'battlefield' ? { label: 'Battlefield', fn: mv(c, 'battlefield') } : null,
      z !== 'battlefield' ? { label: 'Battlefield, tapped', fn: mv(c, 'battlefield', null, { tapped: true }) } : null,
      z !== 'stack' ? { label: z === 'command' ? `Stack (cast it — tax {${2 * ((S().tax || {})[c.id] || 0)}})` : 'Stack (cast it)', fn: mv(c, 'stack') } : null,
      { label: 'Hand (return to hand)', fn: mv(c, 'hand') },
      z !== 'graveyard' ? { label: 'Graveyard', fn: mv(c, 'graveyard') } : null,
      z !== 'exile' ? { label: 'Exile', fn: mv(c, 'exile') } : null,
      { label: 'Top of library', fn: mv(c, 'library', 'top') },
      { label: 'Bottom of library', fn: mv(c, 'library', 'bottom') },
      { label: 'Shuffle into library', fn: mv(c, 'library', 'shuffle') },
      z !== 'command' ? { label: 'Command zone', fn: () => G.move([c.id], 'command') } : null
    ];
  }

  function cardMenu(c) {
    if (!canAct(c)) {
      if (!G.seated()) return [{ note: 'Take a seat to play.' }];
      if (c.zone === 'battlefield') return [
        { note: `${nameOf(c.ctrl)} controls this card${c.owner !== c.ctrl ? ` (owner: ${nameOf(c.owner)})` : ''}.` },
        { label: 'Take control of it…', fn: () => choose('Take control', `Take control of ${nameOf(c.ctrl)}’s ${R.cardName(c)}? Use this for effects like Control Magic. Everyone sees it in the log.`, [{ label: 'Take control', primary: true, fn: () => G.act({ type: 'take', ids: [c.id] }) }, { label: 'Cancel', fn: () => {} }]) }
      ];
      if (c.zone === 'graveyard' || c.zone === 'exile') return [
        { note: `This card belongs to ${nameOf(c.owner)}.` },
        !c.faceDown ? { label: 'Put onto the battlefield under my control', fn: () => G.move([c.id], 'battlefield') } : null,
        !c.faceDown ? { label: 'Cast it (I control the spell)', fn: () => castFlow(c, 'public') } : null
      ];
      return [{ note: c.zone === 'stack' ? `${nameOf(c.ctrl)} controls this spell.` : `This card belongs to ${nameOf(c.owner)}.` }];
    }
    if (c.zone === 'command') {
      const tax = 2 * ((S().tax || {})[c.id] || 0);
      return [
        { label: `Cast — commander tax {${tax}}`, fn: () => castFlow(c, 'public') },
        { label: 'Put onto the battlefield (no tax)', fn: () => G.move([c.id], 'battlefield') },
        { sep: true },
        { label: 'Move to', sub: moveSub(c).filter(Boolean) }
      ];
    }
    const two = c.d && c.d.faces && c.d.faces.length > 1;
    const items = [];
    if (c.zone === 'battlefield') {
      items.push({ label: c.tapped ? 'Untap' : 'Tap', fn: () => G.tap([c.id], !c.tapped) });
      const trs = c.faceDown ? [] : CD.triggers(c);
      if (trs.length) items.push({ label: 'Put a triggered ability on the stack', sub: trs.map((t, i) => ({ label: t.line.slice(0, 90), fn: () => triggerFlow(c, i) })) });
      const abs = c.faceDown ? [] : CD.abilities(c);
      if (abs.length) items.push(abs.length === 1 ? { label: `Activate: ${abs[0].cost}: ${abs[0].text.slice(0, 60)}`, fn: () => activateFlow(c, 0) }
        : { label: 'Activate an ability', sub: abs.map((a, i) => ({ label: `${a.cost}: ${a.text.slice(0, 70)}`, fn: () => activateFlow(c, i) })) });
      items.push({ label: 'Counters…', fn: () => counterModal(c.id) });
      items.push({ label: c.noUntap ? 'Let it untap normally' : 'Doesn’t untap during untap step', fn: () => G.act({ type: 'noUntap', id: c.id, on: !c.noUntap }) });
      if (R.ptOf(c)) items.push({ label: 'Change P/T until end of turn…', fn: () => ptModal(c.id) });
      if (two && !c.faceDown) items.push({ label: 'Transform / flip', fn: () => G.flip(c.id) });
      if (c.faceDown) items.push(c.owner === KEY ? { label: 'Turn face up', fn: () => G.turnFaceUp(c.id) } : { note: 'Only the owner can turn this face up.' });
      else if (c.owner === KEY && !c.token) items.push({ label: 'Turn face down', fn: () => G.turnFaceDown(c.id) });
      items.push(c.attachedTo ? { label: 'Unattach', fn: () => G.attach(c.id, null) } : { label: 'Attach to…', fn: () => startTarget(c) });
      items.push({ sep: true });
      items.push({ label: 'Move to', sub: moveSub(c) });
      items.push({ label: 'Show in row', sub: [['creatures', 'Creatures'], ['other', 'Noncreatures'], ['lands', 'Lands']].filter(([r]) => r !== c.row).map(([r, l]) => ({ label: l, fn: () => G.setRow(c.id, r) })) });
      if (others().length) items.push({ label: 'Give control to', sub: others().map(p => ({ label: nameOf(p), fn: () => G.control([c.id], p) })) });
      if (c.ctrl !== c.owner && c.owner !== KEY) items.push({ label: `Return control to ${nameOf(c.owner)}`, fn: () => G.control([c.id], c.owner) });
      if (!c.faceDown) items.push({ label: 'Create a token copy', fn: () => G.copyToken(c) });
      if (c.token) items.push({ label: 'Remove token from the game', fn: () => G.removeToken([c.id]) });
    } else if (c.zone === 'stack') {
      const P = S().prio;
      if (P && P.holder !== KEY) items.push({ note: `Waiting for ${nameOf(P.holder)} to respond. It resolves by itself when everyone has passed.` });
      if (c.ctrl === KEY || !P || !P.holder) items.push({ label: 'Resolve it now (don’t wait for responses)', fn: () => G.act({ type: 'resolveNow' }) });
      if (!c.ab) items.push({ label: 'Counter it (to the graveyard)', fn: mv(c, 'graveyard') });
      if (two) items.push({ label: 'Flip to other face', fn: () => G.flip(c.id) });
      items.push({ label: 'Move to', sub: moveSub(c) });
      if (c.token) items.push({ label: 'Remove copy from the game', fn: () => G.removeToken([c.id]) });
    } else {
      items.push(...moveSub(c).filter(Boolean));
      if (two) items.push({ sep: true }, { label: 'Flip to other face', fn: () => G.flip(c.id) });
      if (c.zone === 'exile' && c.owner === KEY) {
        items.push({ label: 'Counters… (suspend, time)', fn: () => counterModal(c.id) });
        if (c.faceDown) items.push({ label: 'Turn face up', fn: () => G.turnFaceUp(c.id) });
        else items.push({ label: 'Turn face down', fn: () => G.turnFaceDown(c.id) });
      }
    }
    return items;
  }

  function handCard(c) { return { id: c.id, owner: KEY, ctrl: KEY, d: c.d, zone: 'hand', cmdr: c.cmdr, counters: {} }; }

  function handMenu(c) {
    const land = G.isLand(c);
    const two = c.d.faces && c.d.faces.length > 1;
    const T = S().turn;
    const landUsed = T.active && T.lands && T.lands[KEY] >= 1;
    return [
      land ? { label: landUsed ? 'Play land (already played one this turn)' : 'Play land', fn: () => G.playLand(c.id), disabled: !!(T.active && T.active !== KEY) }
        : { label: S().prio && S().prio.holder === KEY && R.stackTop(S()) ? 'Cast in response' : 'Cast', fn: () => castFlow(c, 'hand') },
      two && land ? { label: `Play the back face (${c.d.faces[1].n})`, fn: () => G.fromHand([c.id], 'battlefield', { backFace: true, playLand: true }) } : null,
      !land ? { label: 'Cast face down (morph, disguise…)', fn: () => G.fromHand([c.id], 'stack', { faceDown: true }) } : null,
      { label: G.isRevealed(c.id) ? 'Stop revealing' : 'Reveal to everyone', fn: () => G.toggleReveal(c.id) },
      { sep: true },
      { label: 'Move to', sub: [
        { label: 'Battlefield (an effect puts it there)', fn: () => G.fromHand([c.id], 'battlefield') },
        { label: 'Battlefield, tapped', fn: () => G.fromHand([c.id], 'battlefield', { tapped: true }) },
        two ? { label: `Battlefield, back face (${c.d.faces[1].n})`, fn: () => G.fromHand([c.id], 'battlefield', { backFace: true }) } : null,
        { label: 'Battlefield face down (manifest…)', fn: () => G.fromHand([c.id], 'battlefield', { faceDown: true }) },
        { label: 'Graveyard (discard)', fn: () => G.fromHand([c.id], 'graveyard') },
        { label: 'Exile', fn: () => G.fromHand([c.id], 'exile') },
        { label: 'Exile face down', fn: () => G.fromHand([c.id], 'exile', { faceDown: true }) },
        { label: 'Top of library', fn: () => G.handToLibrary([c.id], 'top') },
        { label: 'Bottom of library', fn: () => G.handToLibrary([c.id], 'bottom') },
        { label: 'Shuffle into library', fn: () => G.handToLibrary([c.id], 'shuffle') },
        { label: 'Command zone', fn: () => G.fromHand([c.id], 'command') }
      ].filter(Boolean) }
    ].filter(Boolean);
  }

  // Attach targeting
  function startTarget(c) { G.targeting = { id: c.id, name: R.cardName(c) }; render(); }
  function finishTarget(t) {
    const tg = G.targeting; G.targeting = null;
    if (t.zone !== 'battlefield') { G.toast('Pick a card on the battlefield.', 'err'); render(); return; }
    G.attach(tg.id, t.id); render();
  }

  // ======================= casting: modes, X and targets =======================
  // G.picking = { title, reqs, i, picked: [[targets for req 0], …], resolve, cancel }
  const sameT = (a, b) => (a.c && a.c === b.c) || (a.p && a.p === b.p);
  function pickState(t) {
    const p = G.picking; if (!p) return '';
    if (p.picked.some(l => l.some(x => sameT(x, t)))) return 'tgt-sel';
    const req = p.reqs[p.i];
    return req && CD.legalTarget(S(), req, t, KEY) ? 'tgt-ok' : '';
  }
  function pickTarget(t) {
    const p = G.picking; if (!p) return;
    const req = p.reqs[p.i];
    const list = p.picked[p.i];
    const at = list.findIndex(x => sameT(x, t));
    if (at >= 0) { list.splice(at, 1); render(); return; }
    if (!CD.legalTarget(S(), req, t, KEY)) { G.toast(`That isn’t a legal target for “${req.text}”.`, 'err'); return; }
    list.push(t);
    if (list.length >= req.n) nextReq(); else render();
  }
  function nextReq() {
    const p = G.picking; if (!p) return;
    p.i++;
    if (p.i >= p.reqs.length) { G.picking = null; if (p.prevTab && G.tab === 'all') G.tab = p.prevTab; p.resolve(p.picked); }
    render();
  }
  function pickTargets(title, card, reqs, mode, textCard) {
    return new Promise(resolve => {
      const prevTab = G.tab;
      G.picking = { title, card, reqs, mode, hc: textCard || card, i: 0, picked: reqs.map(() => []), resolve, prevTab,
        cancel: () => { if (G.tab === 'all') G.tab = prevTab; resolve(null); } };
      if (S().seats.length > 1) G.tab = 'all';
      closeMenu(); hidePreview(); render();
    });
  }
  function tlabel(t) {
    if (t.p) return t.p === KEY ? 'You' : nameOf(t.p);
    const c = S().cards[t.c]; if (!c) return 'a card';
    return (c.ctrl === KEY ? 'Your ' : nameOf(c.ctrl) + '’s ') + R.cardName(c) + (c.zone === 'stack' ? ' (spell)' : c.zone === 'graveyard' ? ' (graveyard)' : '');
  }
  function targetsTxt(c) {
    const l = [].concat(...(c.tg || [])); if (!l.length) return '';
    return ' → ' + R.listNames(l.map(tlabel));
  }
  function pickBar() {
    const p = G.picking; if (!p) return null;
    const req = p.reqs[p.i];
    const choices = CD.orderChoices(S(), CD.targetChoices(S(), req, KEY), KEY, !!p.hc && CD.helpfulTarget(p.hc, p.mode, p.i));
    const got = p.picked[p.i];
    return h('div', { class: 'pickbar', role: 'dialog', 'aria-label': p.title },
      h('div', { class: 'pkhead' }, h('b', null, p.title), h('span', null, ` — choose ${CD.reqLabel(req)}${p.reqs.length > 1 ? `  (${p.i + 1} of ${p.reqs.length})` : ''}`)),
      h('div', { class: 'pkchoices' }, choices.length ? choices.slice(0, 40).map(t => h('button', { class: 'chip' + (got.some(x => sameT(x, t)) ? ' set' : ''), onclick: () => pickTarget(t) }, tlabel(t)))
        : h('span', { class: 'muted' }, 'Nothing can be chosen for this right now.')),
      h('div', { class: 'pkbtns' },
        (req.upTo || got.length) ? h('button', { class: 'primary', onclick: nextReq }, got.length ? 'Done' : 'No target') : null,
        !choices.length && !req.upTo ? h('button', { onclick: () => { p.picked[p.i] = []; nextReq(); } }, 'Cast it without a target') : null,
        h('button', { onclick: () => { const q = G.picking; G.picking = null; q.cancel(); render(); } }, 'Cancel'),
        h('span', { class: 'muted small' }, COARSE ? 'Tap a highlighted card or a name above.' : 'Click a highlighted card or a name above. Esc cancels.')));
  }
  function chooseModes(card, md) {
    return new Promise(resolve => {
      const n = md.pick === 'many' ? md.modes.length : md.pick;
      const sel = [];
      let done = false;
      const finish = v => { if (done) return; done = true; closeModal(true); resolve(v); };
      openModal(`${R.cardName(card)} — choose ${md.pick === 'many' ? 'one or more' : n === 1 ? 'one' : n}`, b => {
        b.append(h('div', { class: 'modes' }, md.modes.map((m, i) => h('button', { class: 'mode' + (sel.includes(i) ? ' on' : ''), onclick: () => {
          if (sel.includes(i)) sel.splice(sel.indexOf(i), 1); else if (sel.length < n) sel.push(i);
          if (n === 1 && sel.length === 1) return finish(sel.slice());
          refreshModal();
        } }, m))));
        if (n > 1) b.append(h('div', { class: 'row' }, h('button', { class: 'primary', disabled: !sel.length || (md.pick !== 'many' && sel.length !== n), onclick: () => finish(sel.slice()) }, `Choose (${sel.length})`), h('button', { onclick: () => finish(null) }, 'Cancel')));
      }, { live: true, onClose: () => finish(null) });
    });
  }
  function askX(card) {
    return new Promise(resolve => {
      let done = false; const fin = v => { if (done) return; done = true; resolve(v); };
      openModal(`${R.cardName(card)} — choose X`, b => {
        const inp = h('input', { type: 'number', min: '0', max: '99', value: '1', class: 'num', id: 'x-in' });
        const go = () => { const n = Math.max(0, Math.min(99, parseInt(inp.value, 10) || 0)); closeModal(true); fin(n); };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        b.append(h('div', { class: 'row' }, inp, h('button', { class: 'primary', onclick: go }, 'OK')));
        setTimeout(() => { inp.focus(); inp.select(); }, 30);
      }, { cls: 'small', onClose: () => fin(null) });
    });
  }
  // Cast a card: choose its mode, X and targets if it needs them, then put it on the stack.
  async function castFlow(c, from) {
    const card = from === 'hand' ? handCard(c) : c;
    let mode = null, x = 0;
    const md = CD.modesOf(card);
    if (md) { mode = await chooseModes(card, md); if (!mode) return; }
    if (CD.costOf(card).x) { x = await askX(card); if (x == null) return; }
    const reqs = CD.targetReqs(card, mode);
    let tg;
    if (reqs.length) { tg = await pickTargets(`Casting ${R.cardName(card)}`, card, reqs, mode); if (!tg) return; }
    const opts = { tg, mode: mode || undefined, x: x || undefined };
    if (!(await autoPay(card, x))) return;
    if (from === 'hand') await G.castFromHand(c.id, opts);
    else await G.castPublic(c.id, opts);
  }
  // Optional: tap my untapped lands and mana permanents to pay the cost (setting under the hand).
  async function autoPay(card, x, cost) {
    if (!G.LS.get('kt:autopay', false)) return true;
    cost = cost || CD.costOf(card);
    if (card.zone === 'command' && card.cmdr) cost.g += 2 * ((S().tax || {})[card.id] || 0);
    if (!CD.costTotal(cost, x)) return true;
    const srcs = Object.values(S().cards).filter(c => c.zone === 'battlefield' && c.ctrl === KEY && !c.tapped && !(R.isType(c, 'creature') && R.sick(S(), c) && !CD.keywords(c, S()).has('haste')))
      .map(c => { const m = CD.manaSource(c); return m && !m.sac ? { id: c.id, amount: m.amount, colors: m.colors, units: m.units } : null; }).filter(Boolean);
    const ids = CD.pay(cost, srcs, x);
    if (!ids) { G.toast('Not enough untapped mana to pay for that automatically — tap your mana yourself, then cast it again.', 'err'); return false; }
    if (ids.length) await G.tap(ids, true);
    return true;
  }
  G.castFlow = castFlow;
  G.autoPay = (card, x, cost) => autoPay(card, x, cost);
  async function triggerFlow(c, i) {
    const tr = CD.triggers(c)[i];
    if (!tr) return;
    const reqs = CD.targetsIn(tr.text);
    let tg;
    if (reqs.length) { tg = await pickTargets(`${R.cardName(c)}: trigger`, c, reqs, null, { d: { faces: [{ n: R.cardName(c), t: 'Instant', o: tr.text }] }, counters: {} }); if (!tg) return; }
    G.act({ type: 'trigger', id: c.id, i, tg });
  }
  async function activateFlow(c, i) {
    const ab = CD.abilities(c)[i];
    if (!ab) return;
    const reqs = CD.targetsIn(ab.text);
    let tg;
    if (reqs.length) { tg = await pickTargets(`${R.cardName(c)}: ${ab.cost}`, c, reqs, null, { d: { faces: [{ n: R.cardName(c), t: 'Instant', o: ab.text }] }, counters: {} }); if (!tg) return; }
    if (!(await autoPay(c, 0, Object.assign({}, ab.mana, { hy: ab.mana.hy.slice(), ph: ab.mana.ph.slice() })))) return;
    G.activate(c.id, i, tg);
  }

  // ======================= priority: "do you want to respond?" =======================
  function prioBar() {
    const s = S(), P = s.prio;
    const top = R.stackTop(s);
    if (!P || !G.seated()) return null;
    if (!top && P.step) return stepBar(s, P);
    if (!top) return null;
    const what = `${top.ctrl === KEY ? 'You' : nameOf(top.ctrl)} ${top.ab ? 'activated ' + top.ab.name : 'cast ' + R.cardName(top)}${targetsTxt(top)}`;
    if (P.holder === KEY) {
      const auto = G.LS.get('kt:autopass', false);
      if (auto && !canRespond()) { if (G._autoFor !== P.top + ':' + P.since) { G._autoFor = P.top + ':' + P.since; setTimeout(() => { const q = S().prio; if (q && q.holder === KEY && q.top === P.top) G.pass(); }, 900); } }
      return h('div', { class: 'prio mine', role: 'alert' }, h('span', { class: 'pring' }),
        h('div', { class: 'ptext' }, h('b', null, 'Respond? '), what + '. ', h('span', { class: 'muted' }, auto && !canRespond() ? 'You have nothing to respond with — passing…' : 'Cast an instant or use an ability now — or pass and let it resolve.')),
        h('label', { class: 'apass', title: 'Pass automatically when you have no instants, flash cards or abilities you could use' }, h('input', { type: 'checkbox', checked: auto, onchange: e => { G.LS.set('kt:autopass', e.target.checked); render(); } }), ' Auto-pass when I can’t respond'),
        h('button', { class: 'primary', onclick: () => G.pass() }, 'Pass'));
    }
    const waited = Date.now() - (P.since || 0);
    const passed = P.passed.filter(p => p !== top.ctrl && p !== P.holder).map(p => p === KEY ? 'You' : nameOf(p));
    const hp = s.players[P.holder];
    return h('div', { class: 'prio' }, h('div', { class: 'ptext' }, what + '. ', h('b', null, `Waiting for ${P.holder === KEY ? 'you' : nameOf(P.holder)}${hp && hp.ai ? ' (AI)' : ''} to respond…`), passed.length ? h('span', { class: 'muted' }, ` ${R.listNames(passed)} passed.`) : null),
      top.ctrl === KEY ? h('button', { onclick: () => G.act({ type: 'resolveNow' }) }, waited > 45000 || (hp && !hp.online) ? 'Resolve it anyway' : 'Resolve now') : null);
  }
  // Blockers are declared: one round of priority before combat damage (510.1). Players with nothing to cast pass automatically.
  function stepBar(s, P) {
    const what = 'Blockers are set — combat damage is next';
    if (P.holder === KEY) {
      if (!canRespond()) {
        if (G._autoFor !== 'step:' + P.since) { G._autoFor = 'step:' + P.since; setTimeout(() => { const q = S().prio; if (q && q.step && q.holder === KEY && !R.stackTop(S())) G.pass(); }, 700); }
        return h('div', { class: 'prio' }, h('div', { class: 'ptext' }, what + '. ', h('span', { class: 'muted' }, 'You have no instants or abilities to use — moving on…')));
      }
      return h('div', { class: 'prio mine', role: 'alert' }, h('span', { class: 'pring' }),
        h('div', { class: 'ptext' }, h('b', null, 'Any combat tricks? '), what + '. ', h('span', { class: 'muted' }, 'Cast an instant or use an ability now, or continue to damage.')),
        h('button', { class: 'primary', onclick: () => G.pass() }, 'Continue to damage'));
    }
    const hp = s.players[P.holder];
    const waited = Date.now() - (P.since || 0);
    return h('div', { class: 'prio' }, h('div', { class: 'ptext' }, what + '. ', h('b', null, `Waiting for ${nameOf(P.holder)}${hp && hp.ai ? ' (AI)' : ''}…`)),
      s.turn.active === KEY && (waited > 30000 || (hp && !hp.online)) ? h('button', { onclick: () => G.act({ type: 'resolveNow' }) }, 'Go to damage') : null);
  }
  setInterval(() => { if (S() && S().prio && G.seated()) G.render(); }, 5000);
  // Could I do anything at instant speed? (an instant/flash card in hand, or an untapped permanent with an ability)
  function canRespond() {
    if (G.P.hand.some(c => CD.instantSpeed(handCard(c)))) return true;
    return Object.values(S().cards).some(c => c.zone === 'battlefield' && c.ctrl === KEY && !c.faceDown && CD.abilities(c).some(a => !a.equip && a.loyalty === undefined && !(a.tap && c.tapped)));
  }

  // ======================= game over =======================
  function winBar() {
    const s = S(), me = G.me();
    const lost = me && me.lost;
    if (!s.winner && !lost) return null;
    if (s.winner) return h('div', { class: 'winbar', role: 'alert' }, h('div', null, h('b', null, s.winner === 'draw' ? '🤝 The game is a draw' : s.winner === KEY ? '🏆 You win!' : `🏆 ${nameOf(s.winner)} wins the game!`), ' ', h('span', { class: 'muted' }, s.seats.filter(p => s.players[p].lost).map(p => `${nameOf(p)} ${s.players[p].lost.why}`).join(' · '))),
      h('div', { class: 'row wrap' }, me ? h('button', { class: 'primary', onclick: () => G.act({ type: 'newGame', rematch: true }) }, 'Rematch') : null, me ? h('button', { onclick: () => G.act({ type: 'newGame' }) }, 'New game') : null,
        lost && me.life > 0 ? h('button', { class: 'ghost', onclick: () => G.act({ type: 'unlose' }) }, 'That was a mistake — put me back in') : null));
    const left = me.lost.pending ? Math.max(0, Math.ceil((45000 - (Date.now() - me.lost.t)) / 1000)) : 0;
    return h('div', { class: 'winbar out' }, h('div', null, h('b', null, 'You’re out of this game'), ' — ', me.lost.why, '. You can keep watching.', left ? h('span', { class: 'muted' }, ` Your cards leave the table in ${left}s.`) : null),
      !me.lost.removed && me.life > 0 && me.poison < 10 ? h('button', { class: 'ghost', onclick: () => G.act({ type: 'unlose' }) }, 'That was a mistake — put me back in') : null);
  }

  // ======================= combat: attackers and blockers =======================
  // G.combatPick = { kind: 'attack', sel: {id: def}, def } | { kind: 'block', pairs: {blockerId: attackerId}, cur }
  const canAttackUI = c => c.ctrl === KEY && !c.tapped && (c.faceDown || R.isType(c, 'creature')) && !(R.sick(S(), c) && !CD.keywords(c, S()).has('haste')) && !CD.keywords(c, S()).has('defender');
  const canBlockUI = c => c.ctrl === KEY && !c.tapped && (c.faceDown || R.isType(c, 'creature')) && !CD.keywords(c, S()).has("can't block");
  const attackingMe = c => { const K = S().combat; const x = K && K.att && K.att[c.id]; return !!x && (x.def.p === KEY || (x.def.c && S().cards[x.def.c] && S().cards[x.def.c].ctrl === KEY)); };
  function combatState(c) {
    const P = G.combatPick;
    if (P.kind === 'attack') return P.sel[c.id] ? 'atk-sel' : canAttackUI(c) ? 'atk-ok' : '';
    if (P.kind === 'block') {
      if (P.cur === c.id) return 'blk-cur';
      if (P.pairs[c.id]) return 'blk-sel';
      if (canBlockUI(c)) return 'blk-ok';
      if (P.curAtt === c.id) return 'blk-cur';
      if (attackingMe(c)) return P.cur ? 'atk-target' : 'atk-in';
    }
    return '';
  }
  function combatClick(c) {
    const P = G.combatPick;
    if (P.kind === 'attack') {
      if (!canAttackUI(c) && !P.sel[c.id]) { G.toast(c.ctrl !== KEY ? 'Click your own creatures to attack with them.' : c.tapped ? `${R.cardName(c)} is tapped.` : R.sick(S(), c) ? `${R.cardName(c)} has summoning sickness (it hasn’t been yours since your turn began).` : `${R.cardName(c)} can’t attack.`, 'err'); return; }
      if (P.sel[c.id]) delete P.sel[c.id]; else P.sel[c.id] = P.def;
    } else {
      // Either order works: blocker then attacker, or attacker then blocker.
      const pair = (b, a) => {
        const why = blockProblem(b, a);
        if (why) { G.toast(why, 'err'); return false; }
        P.pairs[b.id] = a.id; P.cur = null; P.curAtt = null; return true;
      };
      if (c.ctrl === KEY && canBlockUI(c)) {
        if (P.pairs[c.id]) delete P.pairs[c.id];
        else if (P.curAtt && S().cards[P.curAtt]) pair(c, S().cards[P.curAtt]);
        else P.cur = P.cur === c.id ? null : c.id;
      } else if (attackingMe(c)) {
        if (P.cur && S().cards[P.cur]) pair(S().cards[P.cur], c);
        else P.curAtt = P.curAtt === c.id ? null : c.id;
      }
    }
    render();
  }
  function blockProblem(b, a) {
    const ak = CD.keywords(a, S()), bk = CD.keywords(b, S());
    if (ak.has('unblockable')) return `${R.cardName(a)} can’t be blocked.`;
    if (ak.has('flying') && !bk.has('flying') && !bk.has('reach')) return `${R.cardName(a)} has flying — only creatures with flying or reach can block it.`;
    return null;
  }
  // Could any of my creatures block any of these attackers?
  const anyBlock = atts => Object.values(S().cards).some(b => b.zone === 'battlefield' && canBlockUI(b) && atts.some(a => !blockProblem(b, a)));
  function defLabel(d) { return d.p ? nameOf(d.p) : R.cardName(S().cards[d.c] || {}); }
  function combatBar() {
    const s = S(), T = s.turn, K = s.combat;
    if (!G.seated() || !T.active || s.prio) return null;
    const P = G.combatPick;
    // Defending: something is attacking me.
    if (K && !K.done && K.n === T.n && K.waiting.includes(KEY) && !K.ok[KEY]) {
      const atts = Object.keys(K.att).map(id => s.cards[id]).filter(c => c && attackingMe(c));
      if (!P || P.kind !== 'block') { G.combatPick = { kind: 'block', pairs: {}, cur: null, prevTab: G.tab }; if (s.seats.length > 1) G.tab = 'all'; return combatBar(); }
      const n = Object.keys(P.pairs).length;
      if (!anyBlock(atts)) {
        const k = 'noblk:' + s.gameId + ':' + T.n;
        if (G._noBlock !== k) { G._noBlock = k; setTimeout(async () => { const r = await G.block([]); if (r && r.ok) { G.tab = P.prevTab || G.tab; G.combatPick = null; render(); } }, 900); }
        return h('div', { class: 'combatbar def' }, h('div', null, h('b', null, `${nameOf(T.active)} is attacking you`), ` with ${R.listNames(atts.map(c => R.cardName(c)))}.`), h('div', { class: 'muted small' }, 'None of your creatures can block — no blocks.'));
      }
      return h('div', { class: 'combatbar def', role: 'alert' },
        h('div', null, h('b', null, `${nameOf(T.active)} is attacking you`), ` with ${R.listNames(atts.map(c => { const pt = CD.pt(s, c); return R.cardName(c) + (pt ? ` (${pt.join('/')})` : ''); }))}.`),
        h('div', { class: 'muted small' }, P.cur ? `Now click the attacker that ${R.cardName(s.cards[P.cur])} should block.` : P.curAtt && s.cards[P.curAtt] ? `Now click the creature that should block ${R.cardName(s.cards[P.curAtt])}.` : 'Click one of your untapped creatures and the attacker it blocks (either order). Repeat for more blockers.'),
        Object.keys(P.pairs).length ? h('div', { class: 'chips' }, Object.entries(P.pairs).map(([b, a]) => h('button', { class: 'chip set', title: 'Remove this block', onclick: () => { delete P.pairs[b]; render(); } }, `${R.cardName(s.cards[b])} blocks ${R.cardName(s.cards[a])} ✕`))) : null,
        h('div', { class: 'row wrap' },
          h('button', { class: 'primary', onclick: async () => { const list = Object.entries(P.pairs).map(([id, att]) => ({ id, att })); const r = await G.block(list); if (r.ok) { G.tab = P.prevTab || G.tab; G.combatPick = null; render(); } } }, n ? `Block (${n})` : 'No blocks')));
    }
    if (P && P.kind === 'block') { G.combatPick = null; if (P.prevTab) G.tab = P.prevTab; }
    // Attacking: my turn, start of combat, haven't attacked yet.
    const step = R.PHASES[T.phase];
    if (T.active !== KEY || !['Beginning of combat', 'Declare attackers'].includes(step) || (K && K.n === T.n)) { if (G.combatPick && G.combatPick.kind === 'attack') G.combatPick = null; return null; }
    const foes = s.seats.filter(p => p !== KEY);
    const walkers = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl !== KEY && (R.isType(c, 'planeswalker') || R.isType(c, 'battle')));
    if (!P || P.kind !== 'attack') G.combatPick = { kind: 'attack', sel: {}, def: { p: foes[0] } };
    const Q = G.combatPick;
    const ready = Object.values(s.cards).filter(c => c.zone === 'battlefield' && canAttackUI(c));
    const n = Object.keys(Q.sel).length;
    return h('div', { class: 'combatbar' },
      h('div', null, h('b', null, 'Combat — choose your attackers. '), ready.length ? h('span', { class: 'muted' }, `Click your creatures (${ready.length} can attack). `) : h('span', { class: 'muted' }, 'None of your creatures can attack right now. ')),
      foes.length + walkers.length > 1 ? h('div', { class: 'chips' }, h('span', { class: 'muted small' }, 'Attack:'), foes.map(p => ({ p })).concat(walkers.map(c => ({ c: c.id }))).map(d => h('button', { class: 'chip' + (sameT(Q.def, d) ? ' set' : ''), onclick: () => { Q.def = d; render(); } }, defLabel(d)))) : null,
      n ? h('div', { class: 'chips' }, Object.entries(Q.sel).map(([id, d]) => h('button', { class: 'chip set', title: 'Remove', onclick: () => { delete Q.sel[id]; render(); } }, `${R.cardName(s.cards[id])} → ${defLabel(d)} ✕`))) : null,
      h('div', { class: 'row wrap' },
        h('button', { class: 'primary', disabled: !n, onclick: async () => { const list = Object.entries(Q.sel).map(([id, d]) => Object.assign({ id }, d)); const r = await G.attack(list); if (r.ok) { G.combatPick = null; render(); } } }, n ? `Attack (${n})` : 'Attack'),
        ready.length ? h('button', { onclick: () => { for (const c of ready) Q.sel[c.id] = Q.def; render(); } }, 'Select all') : null,
        h('button', { onclick: async () => { G.combatPick = null; await G.attack([]); } }, 'No attack — skip combat')));
  }

  // ======================= library menu =======================
  function libraryMenu() {
    const L = G.P.library.length;
    const until = kind => Object.entries(G.UNTIL).map(([k, u]) => ({ label: u.label.replace(/^an? /, '').replace(/^./, m => m.toUpperCase()), fn: () => kind(k) }));
    return [
      { note: `${plural(L, 'card')} in your library` },
      { label: 'Draw a card', fn: () => G.draw(1) },
      { label: 'Draw X cards…', fn: () => askNumber('Draw how many?', 2, n => G.draw(n), L) },
      { label: 'Draw until…', sub: until(k => G.drawUntil(k)) },
      { sep: true },
      { label: 'Scry X…', fn: () => askNumber('Scry how many?', 1, n => lookModal('scry', n), L) },
      { label: 'Surveil X…', fn: () => askNumber('Surveil how many?', 1, n => lookModal('surveil', n), L) },
      { label: 'Look at the top X…', fn: () => askNumber('Look at how many?', 3, n => lookModal('look', n), L) },
      { label: 'Reveal the top card', fn: () => G.revealTop() },
      { label: 'Search your library…', fn: () => searchModal() },
      { sep: true },
      { label: 'Mill X…', fn: () => askNumber('Mill how many?', 1, n => G.mill(n), L) },
      { label: 'Mill until…', sub: until(k => G.millUntil(k)) },
      { label: 'Exile the top X…', fn: () => askNumber('Exile how many from the top?', 1, n => G.exileTop(n, false), L) },
      { label: 'Exile the top X face down…', fn: () => askNumber('Exile how many face down?', 1, n => G.exileTop(n, true), L) },
      { label: 'Shuffle your library', fn: () => G.shuffleLibrary() },
      { label: G.P.skipDraw ? '✓ Skip my next draw (on)' : 'Skip my next draw', fn: () => { G.P.skipDraw = !G.P.skipDraw; G.savePriv(); G.toast(G.P.skipDraw ? 'Your next turn’s draw will be skipped.' : 'You’ll draw normally.'); } }
    ];
  }

  // ======================= top bar =======================
  function topBar() {
    const s = S();
    const T = s.turn;
    const me = G.me();
    const st = G.status;
    const dot = h('span', { class: 'dot ' + (st === 'host' || st === 'connected' ? 'on' : st === 'offline' ? 'off' : 'wait'), title: st === 'host' ? 'Connected (this browser is hosting the table)' : st === 'connected' ? 'Connected' : G.statusMsg || 'Connecting…' });
    const turnBox = h('div', { class: 'turn' });
    if (T.active) {
      const active = T.active === KEY;
      const canDrive = active || !(s.players[T.active] && s.players[T.active].online);
      turnBox.append(...[
        h('span', { class: 'tn' }, (COARSE ? 'T' : 'Turn ') + T.n),
        h('span', { class: 'who' + (active ? ' me' : '') }, active ? 'Your turn' : nameOf(T.active)),
        h('button', { class: 'ph', disabled: !canDrive || !me, title: 'Previous step', onclick: () => G.act({ type: 'phase', dir: 'back' }) }, '◀'),
        h('button', { class: 'phase', disabled: !canDrive || !me, title: 'Jump to a step', onclick: e => openMenu(e.currentTarget, R.PHASES.slice(1, -1).map((p, i) => ({ label: p, fn: () => G.act({ type: 'phase', to: i + 1 }) })), 'Steps') }, R.PHASES[T.phase]),
        h('button', { class: 'ph', disabled: !canDrive || !me, title: 'Next step', onclick: () => G.act({ type: 'phase' }) }, '▶'),
        canDrive && me ? h('button', { class: 'pass primary', onclick: passTurn }, 'Pass turn') : null
      ].filter(Boolean));
    } else if (me) {
      turnBox.append(h('button', { class: 'primary', onclick: () => G.act({ type: 'start' }), title: 'Randomizes the turn order and picks who goes first' }, 'Start game'));
    }

    const t = s.table;
    const markers = h('div', { class: 'markers' },
      h('button', { class: 'chip' + (t.monarch ? ' set' : ''), title: 'The monarch draws a card at their end step', onclick: e => markerMenu(e, 'monarch') }, '♛ ', t.monarch ? 'Monarch: ' + nameOf(t.monarch) : 'Monarch'),
      h('button', { class: 'chip' + (t.initiative ? ' set' : ''), onclick: e => markerMenu(e, 'initiative') }, t.initiative ? 'Initiative: ' + nameOf(t.initiative) : 'Initiative'),
      h('button', { class: 'chip' + (t.day ? ' set' : ''), onclick: e => openMenu(e.currentTarget, [{ label: 'Day', fn: () => G.act({ type: 'table', key: 'day', value: 'day' }) }, { label: 'Night', fn: () => G.act({ type: 'table', key: 'day', value: 'night' }) }, { label: 'Neither', fn: () => G.act({ type: 'table', key: 'day', value: null }) }], 'Day / night') }, t.day === 'day' ? '☀ Day' : t.day === 'night' ? '☾ Night' : 'Day/Night')
    );

    const unread = Math.max(0, s.log.length - (G.logSeen || 0));
    const aiUnread = Math.max(0, (s.aichat || []).length - (G.aiSeen || 0));
    const tools = h('div', { class: 'tools' },
      me ? h('button', { class: 'f3', onclick: e => openMenu(e.currentTarget, newGameMenu(), 'Start over') }, 'New game ▾') : null,
      h('button', { class: 'f3', onclick: () => deckManager() }, 'Decks'),
      me ? h('button', { class: 'f2', onclick: () => tokenModal() }, 'Tokens') : null,
      me ? h('button', { class: 'f2', onclick: e => openMenu(e.currentTarget, [2, 4, 6, 8, 10, 12, 20].map(n => ({ label: n === 2 ? 'Flip a coin' : 'Roll a d' + n, fn: () => G.act({ type: 'dice', sides: n }) })).concat([{ label: 'Roll any die…', fn: () => askNumber('How many sides?', 100, n => G.act({ type: 'dice', sides: n }), 1000) }]), 'Dice & coin') }, 'Dice') : null,
      h('button', { class: G.logOpen ? 'on' : '', onclick: () => { G.logOpen = !G.logOpen; G.aiOpen = false; render(); } }, 'Log', unread && !G.logOpen ? h('span', { class: 'badge' }, String(Math.min(unread, 99))) : null),
      h('button', { class: G.aiOpen ? 'on' : '', title: 'AI players: add one, read what they’re doing, ask them questions', onclick: () => { G.aiOpen = !G.aiOpen; if (G.aiOpen) G.logOpen = false; render(); } }, 'AI', aiUnread && !G.aiOpen ? h('span', { class: 'badge' }, String(Math.min(aiUnread, 99))) : null),
      h('button', { class: 'invite f3', onclick: inviteModal, title: 'Invite players to this table' }, 'Invite'),
      me ? h('button', { class: 'f4' + (G.phoneLinked ? ' on' : ''), onclick: phoneModal, title: 'Use your phone as your hand' }, G.phoneLinked ? 'Phone ✓' : 'Phone') : null,
      h('button', { title: 'More', onclick: e => openMenu(e.currentTarget, moreMenu(), 'Table') }, '⋯')
    );
    if (COARSE || innerWidth < 760) {
      const all = () => [
        me ? { label: 'New game ▸', sub: newGameMenu() } : null,
        { label: 'Decks', fn: () => deckManager() },
        me ? { label: 'Tokens', fn: () => tokenModal() } : null,
        me ? { label: 'Dice & coin ▸', sub: [2, 6, 20].map(n => ({ label: n === 2 ? 'Flip a coin' : 'Roll a d' + n, fn: () => G.act({ type: 'dice', sides: n }) })) } : null,
        { label: `Log${unread ? ' (' + Math.min(unread, 99) + ' new)' : ''}`, fn: () => { G.logOpen = !G.logOpen; G.aiOpen = false; render(); } },
        { label: `AI players & chat${aiUnread ? ' (' + Math.min(aiUnread, 99) + ' new)' : ''}`, fn: () => { G.aiOpen = !G.aiOpen; if (G.aiOpen) G.logOpen = false; render(); } },
        me && !COARSE ? { label: G.phoneLinked ? 'Phone (linked)…' : 'Use my phone as my hand…', fn: phoneModal } : null,
        me ? { label: 'Monarch ▸', sub: S().seats.map(p => ({ label: nameOf(p), fn: () => G.act({ type: 'table', key: 'monarch', value: p }) })).concat([{ label: 'Nobody', fn: () => G.act({ type: 'table', key: 'monarch', value: null }) }]) } : null,
        me ? { label: 'Initiative ▸', sub: S().seats.map(p => ({ label: nameOf(p), fn: () => G.act({ type: 'table', key: 'initiative', value: p }) })).concat([{ label: 'Nobody', fn: () => G.act({ type: 'table', key: 'initiative', value: null }) }]) } : null,
        me ? { label: 'Day / night ▸', sub: [{ label: 'Day', fn: () => G.act({ type: 'table', key: 'day', value: 'day' }) }, { label: 'Night', fn: () => G.act({ type: 'table', key: 'day', value: 'night' }) }, { label: 'Neither', fn: () => G.act({ type: 'table', key: 'day', value: null }) }] } : null,
        { sep: true }, ...moreMenu()
      ];
      return h('div', { id: 'top', class: 'compact' }, dot, turnBox,
        h('button', { class: 'menubtn', 'aria-label': 'Menu', onclick: e => openMenu(e.currentTarget, all(), 'Kitchen Table') }, '☰', unread && !G.logOpen ? h('span', { class: 'badge' }, String(Math.min(unread, 99))) : null));
    }
    return h('div', { id: 'top' },
      h('div', { class: 'brand' }, dot, h('b', null, 'Kitchen Table'), G.TABLE !== 'main' ? h('span', { class: 'tname' }, G.TABLE) : null),
      turnBox, markers, tools);
  }

  function newGameMenu() {
    const deck = G.P.deckId && G.decks().find(d => d.id === G.P.deckId);
    return [
      { label: 'Rematch — same decks, everyone starts fresh', fn: () => G.act({ type: 'newGame', rematch: true }) },
      { label: 'New game — everyone picks a deck', fn: () => G.act({ type: 'newGame' }) },
      { sep: true },
      deck ? { label: 'Restart just my side (reshuffle my deck)', fn: () => G.useDeck(deck) } : { note: 'Pick a deck to play first.' }
    ];
  }

  // Before passing, remind the player of end-of-turn rules (514.1 hand size, 722 monarch).
  function passTurn() {
    const s = S(), notes = [];
    if (s.turn.active === KEY) {
      if (G.P.hand.length > 7) notes.push(`Discard down to 7 — you have ${G.P.hand.length} cards in hand.`);
      if (s.table.monarch === KEY) notes.push('You’re the monarch: draw a card at your end step.');
    }
    const go = () => G.act({ type: 'phase', dir: 'pass' });
    if (!notes.length) return go();
    openModal('Before you pass', b => {
      b.append(h('ul', { class: 'remind' }, notes.map(n => h('li', null, n))));
      b.append(h('div', { class: 'row wrap' },
        G.P.hand.length > 7 ? h('button', { onclick: () => { closeModal(); hidePreview(); } }, 'Let me discard first') : null,
        s.table.monarch === KEY ? h('button', { onclick: () => { closeModal(); G.draw(1, 'drew a card for being the monarch'); } }, 'Draw for monarch') : null,
        h('button', { class: 'primary', onclick: () => { closeModal(); go(); } }, 'Pass turn')));
    }, { cls: 'small' });
  }

  // Prompts the table asks of you (shown one at a time, after any open window closes).
  const asks = [];
  function ask(fn) { asks.push(fn); pumpAsks(); }
  function askNow(fn) { asks.unshift(fn); pumpAsks(); }
  function pumpAsks() { if (!modal && asks.length) asks.shift()(); }
  G.askCommander = c => ask(() => {
    const cur = S().cards[c.id];
    if (!cur || (cur.zone !== 'graveyard' && cur.zone !== 'exile')) return pumpAsks();
    choose('Your commander', `${R.cardName(cur)} went to ${cur.zone === 'exile' ? 'exile' : 'the graveyard'}. Move it to the command zone?`, [
      { label: 'Command zone', primary: true, fn: () => { G.move([c.id], 'command'); setTimeout(pumpAsks, 50); } },
      { label: `Leave it in ${cur.zone === 'exile' ? 'exile' : 'the graveyard'}`, fn: () => setTimeout(pumpAsks, 50) }
    ]);
  });
  G.askZero = c => ask(() => {
    const cur = S().cards[c.id];
    if (!cur || cur.zone !== 'battlefield' || !cur.zeroT) return pumpAsks();
    const pt = R.ptOf(cur);
    choose('0 toughness', `${R.cardName(cur)} is ${pt ? pt.join('/') : '0 toughness'}. A creature with 0 toughness goes to the graveyard (rule 704.5f) — unless something you’re tracking yourself (an anthem, equipment) is boosting it.`, [
      { label: 'Put it into the graveyard', primary: true, fn: () => { G.move([c.id], 'graveyard'); setTimeout(pumpAsks, 50); } },
      { label: 'It’s boosted — keep it', fn: () => { G.act({ type: 'zeroOk', id: c.id }); setTimeout(pumpAsks, 50); } }
    ]);
  });

  function markerMenu(e, key) {
    openMenu(e.currentTarget, S().seats.map(p => ({ label: nameOf(p), fn: () => G.act({ type: 'table', key, value: p }) })).concat([{ label: 'Nobody', fn: () => G.act({ type: 'table', key, value: null }) }]), key === 'monarch' ? 'Who is the monarch?' : 'Who has the initiative?');
  }

  function moreMenu() {
    const me = G.me();
    const s = S();
    const fit = G.topFit || 0;
    return [
      { label: 'Invite players…', fn: inviteModal },
      me && fit >= 3 ? { label: 'New game ▸', sub: newGameMenu() } : null,
      fit >= 3 ? { label: 'Decks…', fn: () => deckManager() } : null,
      me && fit >= 2 ? { label: 'Tokens…', fn: () => tokenModal() } : null,
      me && fit >= 2 ? { label: 'Dice & coin ▸', sub: [2, 6, 20].map(n => ({ label: n === 2 ? 'Flip a coin' : 'Roll a d' + n, fn: () => G.act({ type: 'dice', sides: n }) })) } : null,
      me && fit >= 4 ? { label: G.phoneLinked ? 'Phone (linked)…' : 'Use my phone as my hand…', fn: phoneModal } : null,
      me && s.seats.length < R.MAX_SEATS ? { label: 'Add an AI player…', fn: addAIModal } : null,
      me && !COARSE ? { label: 'Monarch ▸', sub: s.seats.map(p => ({ label: nameOf(p), fn: () => G.act({ type: 'table', key: 'monarch', value: p }) })).concat([{ label: 'Nobody', fn: () => G.act({ type: 'table', key: 'monarch', value: null }) }]) } : null,
      me && !COARSE ? { label: 'Initiative ▸', sub: s.seats.map(p => ({ label: nameOf(p), fn: () => G.act({ type: 'table', key: 'initiative', value: p }) })).concat([{ label: 'Nobody', fn: () => G.act({ type: 'table', key: 'initiative', value: null }) }]) } : null,
      me && !COARSE ? { label: 'Day / night ▸', sub: [{ label: 'Day', fn: () => G.act({ type: 'table', key: 'day', value: 'day' }) }, { label: 'Night', fn: () => G.act({ type: 'table', key: 'day', value: 'night' }) }, { label: 'Neither', fn: () => G.act({ type: 'table', key: 'day', value: null }) }] } : null,
      me ? { label: 'Change my name…', fn: nameModal } : { label: 'Take a seat', fn: nameModal },
      me ? { label: 'Untap everything I control', fn: untapAll } : null,
      me ? { label: (G.LS.get('kt:autopass', false) ? '✓ ' : '') + 'Auto-pass when I can’t respond', fn: () => { G.LS.set('kt:autopass', !G.LS.get('kt:autopass', false)); G.toast(G.LS.get('kt:autopass', false) ? 'You’ll pass automatically when you have nothing to respond with.' : 'You’ll be asked every time.'); render(); } } : null,
      me ? { label: (G.LS.get('kt:autopay', false) ? '✓ ' : '') + 'Tap my lands for me when I cast', fn: () => { G.LS.set('kt:autopay', !G.LS.get('kt:autopay', false)); G.toast(G.LS.get('kt:autopay', false) ? 'Casting taps your lands automatically.' : 'You’ll tap your own mana.'); render(); } } : null,
      { sep: true },
      me && s.turn.active && !me.lost ? { label: 'Concede this game…', fn: () => choose('Concede', 'You’ll be out of this game (you can keep watching).', [{ label: 'Concede', primary: true, fn: () => G.act({ type: 'lose', why: 'concede' }) }, { label: 'Cancel', fn: () => {} }]) } : null,
      me ? { label: 'Leave my seat…', fn: () => choose('Leave seat', 'Your cards leave the table.', [{ label: 'Leave', primary: true, fn: () => G.act({ type: 'leave' }) }, { label: 'Cancel', fn: () => {} }]) } : null,
      ...s.seats.filter(p => p !== KEY && (canRemove(p) || !s.players[p].online)).map(p => ({ label: `Remove ${nameOf(p)}${s.players[p].ai ? ' (AI)' : ''}${s.players[p].online ? '' : ' (offline)'}…`, fn: () => removePlayer(p) })),
      ...s.seats.filter(p => s.players[p].ai && aiOf(p)).map(p => ({ label: `${nameOf(p)} (AI) settings…`, fn: () => manageAIModal(p) })),
      { sep: true },
      { label: 'Open a different table…', fn: tableModal }
    ];
  }

  // The host (the first person to sit down) can remove anyone; you can always remove your own AI or an offline player.
  const isHost = () => { const s = S(); const h = s.hostPid && s.players[s.hostPid] ? s.hostPid : s.seats.find(p => s.players[p] && !s.players[p].ai); return h === KEY; };
  const canRemove = p => isHost() || !!aiOf(p);
  function removePlayer(p) {
    const s = S(), pl = s.players[p]; if (!pl) return;
    choose(`Remove ${pl.name}?`, `${pl.name}${pl.ai ? ' (AI)' : ''} leaves the table, and their cards leave with them.${pl.ai ? '' : ' They can’t sit back down until a new game starts.'}`, [
      { label: 'Remove', primary: true, fn: async () => {
        const a = aiOf(p);
        if (a) { aiPost(a.id, { t: 'remove' }); setTimeout(() => { if (S().players[p]) G.act({ type: 'removeSeat', pid: p }); }, 2500); }
        else await G.act({ type: 'removeSeat', pid: p });
        G.toast(`${pl.name} was removed from the table.`);
      } },
      { label: 'Cancel', fn: () => {} }]);
  }
  function copyText(text, msg) {
    try { navigator.clipboard.writeText(text).then(() => G.toast(msg), () => window.prompt('Copy this:', text)); }
    catch (e) { window.prompt('Copy this:', text); }
  }

  function untapAll() {
    const ids = Object.values(S().cards).filter(c => c.zone === 'battlefield' && c.ctrl === KEY && c.tapped).map(c => c.id);
    if (ids.length) G.tap(ids, false);
  }

  // ======================= tabs =======================
  function tabsBar() {
    const s = S();
    const tabs = [];
    if (G.seated()) tabs.push(['me', 'My board']);
    for (const p of s.seats) if (p !== KEY) tabs.push([p, nameOf(p)]);
    tabs.push(['all', 'All players'], ['turn', 'Current turn']);
    if (!tabs.some(t => t[0] === G.tab) || (G.tab === 'me' && !G.seated())) G.tab = G.seated() ? 'me' : 'all';
    return h('nav', { id: 'tabs', role: 'tablist' }, tabs.map(([id, label]) => {
      const p = s.players[id];
      return h('button', { role: 'tab', class: G.tab === id ? 'on' : '', 'aria-selected': G.tab === id ? 'true' : 'false', onclick: () => { G.tab = id; render(); } },
        p ? h('span', { class: 'dot ' + (p.online ? 'on' : 'off') }) : null, label,
        p ? h('span', { class: 'tlife' }, String(p.life)) : null,
        id !== 'all' && id !== 'turn' && s.turn.active === (id === 'me' ? KEY : id) ? h('span', { class: 'tturn', title: 'Their turn' }, '●') : null);
    }));
  }

  // ======================= player board =======================
  function playerBar(pid, compact) {
    const s = S(), p = s.players[pid], mine = pid === KEY;
    const chip = (label, v, cls) => v ? h('span', { class: 'stat ' + (cls || '') }, label + ' ' + v) : null;
    const cmdTotal = Object.entries(p.cmdDmg || {}).filter(([, v]) => v > 0);
    const life = h('div', { class: 'life' + (p.life <= 0 ? ' dead' : '') },
      mine ? h('button', { onclick: () => G.act({ type: 'player', patch: { life: p.life - 1 } }), title: 'Lose 1 life' }, '−') : null,
      h('button', { class: 'lv', title: 'Trackers', onclick: () => trackerModal(pid) }, String(p.life)),
      mine ? h('button', { onclick: () => G.act({ type: 'player', patch: { life: p.life + 1 } }), title: 'Gain 1 life' }, '+') : null);
    const tags = [];
    if (s.turn.active === pid) tags.push(h('span', { class: 'tag2 turn' }, 'Their turn'.replace('Their', mine ? 'Your' : 'Their')));
    if (s.table.monarch === pid) tags.push(h('span', { class: 'tag2' }, '♛ Monarch'));
    if (s.table.initiative === pid) tags.push(h('span', { class: 'tag2' }, 'Initiative'));
    if (p.phone) tags.push(h('span', { class: 'tag2 dim' }, 'Hand on phone'));
    if (p.ai) tags.unshift(h('span', { class: 'tag2 ai', title: 'A computer player run by ' + nameOf(p.ai.by) }, 'AI · ' + p.ai.skill));
    if (p.lost) tags.unshift(h('span', { class: 'tag2 lostt', title: p.lost.why }, 'Out'));
    if (s.winner === pid) tags.unshift(h('span', { class: 'tag2 turn' }, '🏆 Winner'));
    const pickable = G.picking ? pickState({ p: pid }) : '';
    const bar = h('div', { class: 'pbar' + (pickable ? ' ' + pickable : ''), onclick: pickable ? () => pickTarget({ p: pid }) : null },
      h('div', { class: 'pname' }, h('span', { class: 'dot ' + (p.online ? 'on' : 'off'), title: p.online ? 'Online' : 'Offline' }), h('b', null, p.name), p.deckName && !compact ? h('span', { class: 'deck' }, p.deckName) : null, tags),
      life,
      h('div', { class: 'stats' },
        chip('Poison', p.poison, p.poison >= 10 ? 'bad' : 'warn'), chip('Energy', p.energy), chip('Exp', p.exp),
        cmdTotal.length ? h('button', { class: 'stat ' + (cmdTotal.some(([, v]) => v >= 21) ? 'bad' : 'warn'), onclick: () => trackerModal(pid) }, 'Cmdr dmg ' + cmdTotal.map(([, v]) => v).join('/')) : null,
        h('span', { class: 'stat dim', title: 'Cards in hand' }, 'Hand ' + p.handCount),
        h('span', { class: 'stat dim', title: 'Cards in library' }, 'Library ' + p.libCount)),
      mine && !compact ? h('div', { class: 'mass' },
        h('button', { onclick: untapAll }, 'Untap all'),
        h('button', { onclick: () => { const ids = Object.values(s.cards).filter(c => c.zone === 'battlefield' && c.ctrl === KEY && c.row === 'lands' && !c.tapped).map(c => c.id); if (ids.length) G.tap(ids, true); } }, 'Tap all lands'),
        h('button', { onclick: () => trackerModal(pid) }, 'Trackers')) : null);
    return bar;
  }

  function revealedStrip(pid) {
    const p = S().players[pid];
    if (!p.revealed || !p.revealed.length) return null;
    return h('div', { class: 'revealed' }, h('span', { class: 'lbl' }, 'Revealed'),
      h('div', { class: 'strip', 'data-scroll': 'rev-' + pid }, p.revealed.map(r => cardEl({ id: 'rev-' + r.id, d: r.d, face: 0, owner: pid, zone: 'revealed', counters: {} }, { noMenu: true, badge: r.from === 'library' ? 'Top of library' : null }))));
  }

  function rowsEl(pid, compact) {
    const s = S();
    const bf = R.zoneCards(s, 'battlefield', pid);
    const isHost = c => !(c.attachedTo && s.cards[c.attachedTo] && s.cards[c.attachedTo].zone === 'battlefield');
    const ROWDEF = [['creatures', 'Creatures'], ['other', 'Noncreatures'], ['lands', 'Lands']];
    return h('div', { class: 'rows' }, ROWDEF.map(([row, label]) => {
      const cards = bf.filter(c => (c.row || R.rowFor(c)) === row && isHost(c));
      return h('div', { class: 'brow ' + row },
        h('div', { class: 'rlabel' }, label, cards.length ? h('span', null, String(cards.length)) : null),
        h('div', { class: 'strip', 'data-scroll': 'row-' + pid + '-' + row }, cards.length ? cards.map(slotEl) : h('div', { class: 'empty' }, compact ? '' : emptyRowText(row, pid))));
    }));
  }
  function emptyRowText(row, pid) {
    if (pid !== KEY) return '';
    return row === 'lands' ? 'Lands you play show up here' : row === 'creatures' ? 'Creatures' : 'Artifacts, enchantments, planeswalkers';
  }

  function pile(pid, zone, label) {
    const s = S();
    const cards = R.zoneCards(s, zone, pid, 'owner');
    const top = cards[cards.length - 1];
    const el = h('button', { class: 'pile', onclick: () => zoneModal(pid, zone), title: `${label} — ${plural(cards.length, 'card')}. Click to look through it.` },
      h('div', { class: 'pimg' }, top ? h('img', { src: (top.faceDown || !top.d) ? sleeveOf(pid) : (R.face(top).img || BACK), alt: '' }) : h('div', { class: 'none' })),
      h('div', { class: 'plabel' }, h('span', { class: 'pl', 'data-short': label === 'Graveyard' ? 'Grave' : label }, label), h('b', null, String(cards.length))));
    if (top) { el.addEventListener('mouseenter', e => showPreview(top, e)); el.addEventListener('mouseleave', hidePreview); }
    return el;
  }

  // Left: command zone (up to two commanders).
  function cmdCol(pid) {
    const cmd = R.zoneCards(S(), 'command', pid, 'owner');
    return h('aside', { class: 'cmdcol' }, h('div', { class: 'plabel' }, h('span', { class: 'pl', 'data-short': 'Cmdr' }, 'Command')),
      cmd.length ? cmd.map(c => cardEl(c)) : h('div', { class: 'none' }));
  }
  // Right, top to bottom: exile, graveyard, library (library at the bottom).
  function pileCol(pid) {
    const s = S(), p = s.players[pid], mine = pid === KEY;
    const lib = h('button', { class: 'pile lib', title: mine ? 'Library — click for draw, scry, search, mill…' : `${p.libCount} cards in library`, onclick: e => { if (mine && G.P.library.length) openMenu(e.currentTarget, libraryMenu(), 'Library'); } },
      h('div', { class: 'pimg' }, p.libCount ? h('img', { src: sleeveOf(pid), alt: '' }) : h('div', { class: 'none' })),
      h('div', { class: 'plabel' }, h('span', { class: 'pl', 'data-short': 'Library' }, 'Library'), h('b', null, String(p.libCount))));
    return h('aside', { class: 'pilecol' }, pile(pid, 'exile', 'Exile'), pile(pid, 'graveyard', 'Graveyard'), lib);
  }

  function boardEl(pid, compact) {
    const s = S();
    if (!s.players[pid]) return h('div', { class: 'empty big' }, 'That player left the table.');
    const L = lookOf(pid);
    return h('section', { class: 'board' + (compact ? ' compact' : '') + (s.turn.active === pid ? ' active' : '') + (L.mat ? ' hasmat' : '') + (s.players[pid].lost ? ' lost' : ''), style: boardStyle(pid) },
      playerBar(pid, compact), revealedStrip(pid),
      h('div', { class: 'field' }, cmdCol(pid), rowsEl(pid, compact), pileCol(pid)));
  }

  function stackStrip() {
    const st = Object.values(S().cards).filter(c => c.zone === 'stack').sort((a, b) => a.seq - b.seq);
    if (!st.length) return null;
    return h('div', { id: 'stack' }, h('div', { class: 'rlabel' }, 'Stack', h('span', null, 'top →')),
      h('div', { class: 'strip', 'data-scroll': 'stack' }, st.map(c => h('div', { class: 'stk' + (c === st[st.length - 1] ? ' top' : '') }, cardEl(c), h('div', { class: 'by' }, nameOf(c.ctrl)),
        c.tg && c.tg.some(l => l.length) ? h('div', { class: 'tgts' }, targetsTxt(c).replace(/^ → /, '→ ')) : null))));
  }

  function mainView() {
    const s = S();
    const tab = G.tab;
    if (tab === 'all') {
      return h('div', { class: 'grid n' + s.seats.length }, s.seats.length ? s.seats.map(p => boardEl(p, true)) : h('div', { class: 'empty big' }, 'Nobody has sat down yet.'));
    }
    if (tab === 'turn') {
      if (!s.turn.active) return h('div', { class: 'empty big' }, 'The game hasn’t started. Press “Start game” when everyone is seated.');
      return h('div', null, h('div', { class: 'phases' }, R.PHASES.slice(1, -1).map((p, i) => h('span', { class: s.turn.phase === i + 1 ? 'on' : '' }, p))), boardEl(s.turn.active, false));
    }
    return boardEl(tab === 'me' ? KEY : tab, false);
  }

  // ======================= hand bar =======================
  function handBar() {
    const P = G.P, me = G.me();
    if (!me && S().kicked && S().kicked[KEY]) return h('div', { id: 'hand', class: 'spect' }, h('span', null, 'The host removed you from this table. You can keep watching; you can sit down again when a new game starts.'));
    if (!me) return h('div', { id: 'hand', class: 'spect' }, h('span', null, 'You’re watching. '), h('button', { class: 'primary', onclick: nameModal }, 'Take a seat'));
    const bar = h('div', { id: 'hand', class: COARSE ? 'drawer' + (G.drawerOpen ? ' open' : '') : '' });
    if (COARSE) bar.append(h('button', { class: 'handle', onclick: () => { G.drawerOpen = !G.drawerOpen; render(); } }, `Hand (${P.hand.length}) ${G.drawerOpen ? '▾' : '▴'}`));
    const btns = h('div', { class: 'hbtns' });
    if (!P.deckId && !P.library.length && !P.hand.length) {
      btns.append(h('button', { class: 'primary', onclick: deckManager }, 'Pick a deck'));
    } else {
      if (!P.hand.length && P.phase !== 'kept') btns.append(h('button', { class: 'primary', onclick: G.openingHand }, 'Draw opening hand'));
      btns.append(h('button', { onclick: () => G.draw(1), disabled: !P.library.length }, 'Draw'));
      btns.append(h('button', { onclick: e => openMenu(e.currentTarget, libraryMenu(), 'Library'), disabled: !P.library.length }, 'Library ▾'));
      btns.append(h('label', { class: 'autopay', title: 'When you cast a spell or use an ability, tap your untapped lands and mana rocks to pay for it' }, h('input', { type: 'checkbox', checked: G.LS.get('kt:autopay', false), onchange: e => { G.LS.set('kt:autopay', e.target.checked); G.toast(e.target.checked ? 'Your lands will be tapped automatically when you cast.' : 'Tap your own mana again.'); } }), ' Tap my lands for me'));
      if (P.hand.length) btns.append(h('button', { onclick: e => openMenu(e.currentTarget, [
        { label: P.hand.every(c => G.isRevealed(c.id)) ? 'Stop revealing hand' : 'Reveal my hand to everyone', fn: G.revealHand },
        { label: 'Discard a card at random', fn: G.discardRandom },
        { label: 'Shuffle hand into library', fn: () => G.handToLibrary(P.hand.map(c => c.id), 'shuffle') }
      ], 'Hand') }, 'Hand ▾'));
    }
    const hiddenOnPhone = G.phoneLinked && !P.handHere;
    const strip = h('div', { class: 'strip handstrip', 'data-scroll': 'hand' });
    if (hiddenOnPhone) {
      strip.append(h('div', { class: 'onphone' }, h('div', { class: 'backs' }, P.hand.slice(0, 7).map(() => h('img', { src: sleeveOf(KEY), alt: '' }))),
        h('span', null, `${plural(P.hand.length, 'card')} — your hand is on your phone.`), h('button', { onclick: () => { P.handHere = true; render(); } }, 'Show here')));
    } else {
      for (const c of P.hand) {
        const pc = handCard(c);
        const el = cardEl(pc, { menu: () => handMenu(c), cls: G.isRevealed(c.id) ? 'rev' : '', swipeUp: () => G.isLand(c) ? G.playLand(c.id) : castFlow(c, 'hand') });
        if (G.isRevealed(c.id)) el.append(h('div', { class: 'tag tok' }, 'Revealed'));
        strip.append(el);
      }
      if (!P.hand.length) strip.append(h('div', { class: 'empty' }, P.library.length ? 'Your hand is empty' : ''));
      if (G.phoneLinked) strip.append(h('button', { class: 'hidebtn', onclick: () => { P.handHere = false; render(); } }, 'Hide (on phone)'));
    }
    bar.append(h('div', { class: 'hinfo' }, h('b', null, 'Hand'), h('span', null, String(P.hand.length))), strip, btns);
    return bar;
  }

  // Mulligan step (always asked).
  function mulliganPanel() {
    const P = G.P;
    if (P.phase === 'deciding') {
      return h('div', { class: 'mull' }, h('div', { class: 'mcard' },
        h('h3', null, P.mull ? `Mulligan ${P.mull}: keep this hand?` : 'Keep this opening hand?'),
        h('p', null, P.mull === 0 ? 'Your first mulligan is free.' : `If you keep, you’ll put ${plural(Math.max(0, P.mull - 1), 'card')} on the bottom (your first mulligan was free).`),
        h('div', { class: 'row' }, h('button', { class: 'primary', onclick: G.keep }, 'Keep'), h('button', { onclick: G.mulligan }, 'Mulligan'))));
    }
    if (P.phase === 'bottom') {
      const sel = G.bottomSel = G.bottomSel || new Set();
      const n = P.bottomN;
      return h('div', { class: 'mull' }, h('div', { class: 'mcard wide' },
        h('h3', null, `Put ${plural(n, 'card')} on the bottom of your library`),
        h('div', { class: 'strip pick' }, P.hand.map(c => {
          const el = cardEl(handCard(c), { noMenu: true, cls: sel.has(c.id) ? 'sel' : '', onClick: () => { if (sel.has(c.id)) sel.delete(c.id); else if (sel.size < n) sel.add(c.id); render(); } });
          return el;
        })),
        h('div', { class: 'row' }, h('button', { class: 'primary', disabled: sel.size !== n, onclick: () => { const ids = [...sel]; G.bottomSel = null; G.bottomChosen(ids); } }, `Put ${sel.size}/${n} on the bottom`))));
    }
    return null;
  }

  // ======================= log =======================
  function logPanel() {
    if (!G.logOpen) return null;
    const s = S();
    G.logSeen = s.log.length;
    const list = h('div', { class: 'loglist', 'data-scroll': 'log' }, s.log.map(e => h('div', { class: 'le ' + (e.k || '') + (e.pid === KEY ? ' mine' : '') },
      h('time', null, new Date(e.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })), ' ',
      e.pid ? h('b', null, nameOf(e.pid)) : null, ' ', e.text)));
    setTimeout(() => { list.scrollTop = list.scrollHeight; }, 0);
    return h('aside', { id: 'log' }, h('header', null, h('h2', null, 'Game log'), h('button', { class: 'x', onclick: () => { G.logOpen = false; render(); } }, '✕')), list);
  }

  // ======================= AI players =======================
  // An AI runs as a hidden copy of the site inside the page of the player who added it.
  const myAIs = () => (G.LS.get('kt:myais', []) || []).filter(a => a.table === G.TABLE);
  const saveMyAIs = list => G.LS.set('kt:myais', (G.LS.get('kt:myais', []) || []).filter(a => a.table !== G.TABLE).concat(list));
  const aiFrames = {};
  function spawnAI(a) {
    if (aiFrames[a.id] || G.dead) return;
    const f = document.createElement('iframe');
    f.src = location.pathname + '?t=' + encodeURIComponent(G.TABLE) + '&m=ai&ai=' + encodeURIComponent(a.id);
    f.title = 'AI player'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
    f.style.cssText = 'position:fixed;width:2px;height:2px;border:0;opacity:0;pointer-events:none;left:-20px;top:-20px';
    document.body.append(f);
    aiFrames[a.id] = f;
  }
  const aiPost = (id, msg) => { const f = aiFrames[id]; if (f && f.contentWindow) f.contentWindow.postMessage(Object.assign({ kt: 'owner' }, msg), location.origin); };
  function clearAIStore(id) { const pre = 'ai:' + id + ':'; try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(pre)) localStorage.removeItem(k); } } catch (e) {} }
  addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.data.kt !== 'ai') return;
    const m = e.data;
    if (m.t === 'started') { const list = myAIs(); const a = list.find(x => x.id === m.id); if (a && a.pid !== m.pid) { a.pid = m.pid; saveMyAIs(list); render(); } }
    if (m.t === 'removed' || m.t === 'noconfig') { const f = aiFrames[m.id]; if (f) f.remove(); delete aiFrames[m.id]; saveMyAIs(myAIs().filter(x => x.id !== m.id)); clearAIStore(m.id); render(); }
  });
  const AI_NAMES = ['Ajani', 'Chandra', 'Teferi', 'Liliana', 'Nissa', 'Jace', 'Gideon', 'Sorin', 'Kaya', 'Vraska', 'Nahiri', 'Saheeli', 'Kiora', 'Ob Nixilis'];
  G.addAI = function (name, deck, skill) {
    const id = G.R.rid(10);
    G.LS.raw.set('ai:' + id + ':kt:aicfg', { name, skill, owner: KEY, deckId: deck.id });
    if (!G.LS.raw.set('ai:' + id + ':kt:decks', [Object.assign({}, deck, { mat: null })])) { G.toast('Your browser storage is full — delete a deck or a playmat picture first.', 'err'); return; }
    saveMyAIs(myAIs().concat([{ id, table: G.TABLE, name }]));
    spawnAI({ id });
    G.toast(`${name} is sitting down…`, 'info');
  };
  const aiOf = pid => myAIs().find(a => a.pid === pid);
  const SKILLS = [['easy', 'Easy', 'Plays loosely, never responds to your spells, blocks at random.'], ['normal', 'Normal', 'Plays on curve, sensible attacks and blocks, sometimes counters big spells.'], ['hard', 'Hard', 'Looks for lethal, holds up answers, careful trades and blocks.']];
  function addAIModal() {
    if (!G.seated()) return G.toast('Take a seat first.', 'err');
    const used = new Set(S().seats.map(p => S().players[p].name));
    let name = AI_NAMES.find(n => !used.has(n)) || 'AI player';
    let skill = 'normal', deckId = (G.decks()[0] || {}).id || null, busy = '';
    const imp = {};
    openModal('Add an AI player', b => {
      const decks = G.decks();
      if (deckId && !decks.some(d => d.id === deckId)) deckId = decks[0] && decks[0].id;
      const full = S().seats.length >= R.MAX_SEATS;
      b.append(h('p', { class: 'muted' }, 'The AI sits at the table like a player: it plays whole turns by itself, follows the rules, responds when it has priority, blocks — and explains what it’s doing in the AI chat, where anyone can ask it questions.'));
      const nm = h('input', { type: 'text', id: 'ainame', maxlength: '20', value: name, oninput: e => name = e.target.value });
      b.append(h('div', { class: 'row' }, h('b', null, 'Name'), nm));
      b.append(h('h4', null, 'Skill'), h('div', { class: 'skills' }, SKILLS.map(([k, l, d]) => h('button', { class: 'skill' + (skill === k ? ' on' : ''), onclick: () => { skill = k; refreshModal(); } }, h('b', null, l), h('span', null, d)))));
      b.append(h('h4', null, 'Deck'));
      if (!decks.length) b.append(h('p', { class: 'muted' }, 'You don’t have any decks yet. Import one below, or in Decks.'));
      else b.append(h('div', { class: 'aidecks' }, decks.map(d => h('button', { class: 'dk' + (d.id === deckId ? ' on' : ''), onclick: () => { deckId = d.id; refreshModal(); } }, h('img', { src: d.sleeve || BACK, alt: '' }), h('span', null, h('b', null, d.name), h('small', null, `${d.cards.reduce((a, c) => a + c.qty, 0)} cards${d.cards.some(c => c.cmdr) ? ' · ' + d.cards.filter(c => c.cmdr).map(c => c.d.n).join(' & ') : ''}`))))));
      b.append(deckImporter(imp, d => { deckId = d.id; busy = `Imported ${d.name}.`; refreshModal(); }, msg => { busy = msg; refreshModal(); }));
      if (busy) b.append(h('p', { class: 'muted small immsg' }, busy));
      b.append(h('div', { class: 'row wrap' },
        h('button', { class: 'primary', disabled: !deckId || full || !name.trim(), onclick: () => { const d = G.decks().find(x => x.id === deckId); if (!d) return; closeModal(); G.addAI(name.trim().slice(0, 20), d, skill); G.aiOpen = true; render(); } }, full ? 'The table is full' : 'Add AI player'),
        h('span', { class: 'muted small' }, 'It runs in this browser tab, so keep this tab open while you play.')));
    }, { live: true, cls: 'wide' });
  }
  function manageAIModal(pid) {
    const a = aiOf(pid); if (!a) return;
    openModal(`${nameOf(pid)} — AI settings`, b => {
      const p = S().players[pid]; if (!p) { b.append(h('p', null, 'That AI left the table.')); return; }
      b.append(h('h4', null, 'Skill'), h('div', { class: 'skills' }, SKILLS.map(([k, l, d]) => h('button', { class: 'skill' + (p.ai && p.ai.skill === k ? ' on' : ''), onclick: () => { aiPost(a.id, { t: 'skill', v: k }); G.toast(`${p.name} will play on ${l}.`); setTimeout(refreshModal, 1500); } }, h('b', null, l), h('span', null, d)))));
      b.append(h('h4', null, 'Deck'), h('p', { class: 'muted small' }, `Playing ${p.deckName || '—'}. Choosing another deck restarts its side of the game.`),
        h('div', { class: 'aidecks' }, G.decks().map(d => h('button', { class: 'dk' + (d.name === p.deckName ? ' on' : ''), title: d.name === p.deckName ? 'Playing this deck now' : '', onclick: () => { aiPost(a.id, { t: 'deck', deck: Object.assign({}, d, { mat: null }) }); G.toast(`${p.name} switches to ${d.name}.`); closeModal(); } }, h('img', { src: d.sleeve || BACK, alt: '' }), h('span', null, h('b', null, d.name))))));
      b.append(h('div', { class: 'row' }, h('button', { class: 'ghost danger', onclick: () => choose(`Remove ${p.name}?`, `${p.name} leaves the table and its cards go with it.`, [{ label: 'Remove', primary: true, fn: () => { aiPost(a.id, { t: 'remove' }); closeModal(); G.toast(`${p.name} is leaving the table.`); } }, { label: 'Cancel', fn: () => {} }]) }, 'Remove this AI')));
    }, { live: true });
  }
  function aiPanel() {
    const s = S();
    const ais = s.seats.filter(p => s.players[p].ai);
    G.aiSeen = (s.aichat || []).length;
    const time = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const lastSay = {}; for (const m of s.aichat || []) if (m.kind === 'say') lastSay[m.pid] = m.id;
    const list = h('div', { class: 'loglist aichat', 'data-scroll': 'aichat' }, (s.aichat || []).length ? (s.aichat || []).map(m => h('div', { class: 'cm ' + m.kind + (m.pid === KEY ? ' mine' : '') },
      h('div', { class: 'cmh' }, h('b', null, m.pid === KEY ? 'You' : (s.players[m.pid] ? nameOf(m.pid) : m.name || 'A player who left')), m.kind === 'q' && m.to ? h('span', { class: 'muted' }, ' → ' + (s.players[m.to] ? nameOf(m.to) : m.toName || 'a player who left')) : null, h('time', null, time(m.t))),
      h('div', { class: 'cmt' }, m.text),
      m.kind === 'a' && m.why && m.why.length ? h('ul', { class: 'why' }, m.why.map(w => h('li', null, w))) : null,
      m.kind === 'say' && m.why && m.why.length && s.players[m.pid] && s.players[m.pid].ai && G.seated() ? h('button', { class: 'ghost small legal' + (lastSay[m.pid] === m.id ? ' latest' : ''), onclick: () => G.act({ type: 'aiAsk', to: m.pid, text: 'Is this legal?', re: m.id }) }, 'Is this legal?') : null))
      : h('p', { class: 'muted' }, ais.length ? 'The AI explains its moves here.' : 'No AI players yet.'));
    // Follow new messages only while you're reading the latest ones (scrolling up to read stays put).
    let touched = false;
    for (const ev of ['wheel', 'touchstart', 'pointerdown', 'keydown']) list.addEventListener(ev, () => { touched = true; }, { passive: true });
    list.addEventListener('scroll', () => { if (touched) G.aiStick = list.scrollTop + list.clientHeight >= list.scrollHeight - 40; });
    setTimeout(() => { if (G.aiStick !== false) list.scrollTop = list.scrollHeight; }, 0);
    let to = G.aiAskTo && ais.includes(G.aiAskTo) ? G.aiAskTo : ais[0];
    const inp = h('input', { type: 'text', id: 'aiask', value: G.aiDraft || '', placeholder: ais.length ? 'Ask the AI — “Is that legal?”, “Why attack me?”…' : 'Add an AI player first', disabled: !ais.length || !G.seated(), oninput: e => { G.aiDraft = e.target.value; } });
    const send = () => { const t = inp.value.trim(); if (!t || !to) return; G.act({ type: 'aiAsk', to, text: t }); inp.value = ''; G.aiDraft = ''; G.aiStick = true; if (COARSE) inp.blur(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    const mineAIs = ais.filter(p => aiOf(p));
    return h('aside', { id: 'log', class: 'aipanel' },
      h('header', null, h('h2', null, 'AI table talk'), h('button', { class: 'ghost small', onclick: () => { G.aiOpen = false; G.logOpen = true; render(); } }, 'Game log'), h('button', { class: 'x', onclick: () => { G.aiOpen = false; render(); } }, '✕')),
      h('div', { class: 'aibar' },
        G.seated() && s.seats.length < R.MAX_SEATS ? h('button', { class: 'primary small', onclick: addAIModal }, '+ Add AI player') : null,
        mineAIs.map(p => h('button', { class: 'small', onclick: () => manageAIModal(p) }, `${nameOf(p)} ⚙`))),
      list,
      h('div', { class: 'askrow' }, ais.length > 1 ? h('select', { id: 'aito', onchange: e => { G.aiAskTo = e.target.value; } }, ais.map(p => h('option', { value: p, selected: p === to }, nameOf(p)))) : null, inp, h('button', { onclick: send, disabled: !ais.length || !G.seated() }, 'Ask')));
  }

  // ======================= effects that ask you something (search, scry, discard, sacrifice) =======================
  G.onTodo = (t, ack) => ask(() => {
    if (t.k === 'scry') {
      const n = Math.min(t.n || 1, G.P.library.length);
      if (!n) { ack(); return pumpAsks(); }
      lookModal('scry', n, () => { ack(); setTimeout(pumpAsks, 50); });
      return;
    }
    if (t.k === 'fetch') {
      const sel = [];
      let done = false;
      const finish = async ids => { if (done) return; done = true; closeModal(true); await G.fetchLands(ids, t); ack(); setTimeout(pumpAsks, 50); };
      openModal(`${t.src}: search for ${t.n > 1 ? 'up to ' + t.n + ' basic lands' : 'a basic land'}`, b => {
        const lands = G.basicLands();
        b.append(h('p', { class: 'muted' }, t.split ? 'The first one you pick goes onto the battlefield tapped, the second into your hand.' : t.dest === 'hand' ? 'They go into your hand.' : `They go onto the battlefield${t.tapped ? ' tapped' : ''}.`));
        const uniq = []; const seen = new Set(); for (const c of lands) if (!seen.has(c.d.n) || sel.includes(c.id)) { seen.add(c.d.n); uniq.push(c); }
        b.append(h('div', { class: 'strip pick' }, uniq.length ? uniq.map(c => cardEl(Object.assign({ zone: 'library', owner: KEY, counters: {} }, c), { noMenu: true, cls: sel.includes(c.id) ? 'sel' : '', badge: sel.includes(c.id) ? '#' + (sel.indexOf(c.id) + 1) : null, onClick: () => { const i = sel.indexOf(c.id); if (i >= 0) sel.splice(i, 1); else if (sel.length < (t.n || 1)) { const other = lands.find(x => x.d.n === c.d.n && !sel.includes(x.id)); sel.push(other ? other.id : c.id); } refreshModal(); } })) : h('p', { class: 'muted' }, 'There are no basic lands left in your library.')));
        b.append(h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => finish(sel.slice()) }, sel.length ? `Take ${sel.length}` : 'Find nothing'), h('span', { class: 'muted small' }, 'Your library is shuffled afterwards.')));
      }, { live: true, cls: 'wide', sticky: true, noEsc: true });
      return;
    }
    if (t.k === 'discard' || t.k === 'sacrifice' || t.k === 'returnOwn') {
      const n = t.n || 1, sel = [];
      const pool = t.k === 'discard' ? G.P.hand.map(c => handCard(c)) : Object.values(S().cards).filter(c => c.zone === 'battlefield' && c.ctrl === KEY && CD.matchesWhat(c, t.what));
      const need = Math.min(n, pool.length);
      if (!need) { ack(); return pumpAsks(); }
      let done = false;
      const verb = t.k === 'discard' ? 'discard' : t.k === 'returnOwn' ? 'return to your hand' : 'sacrifice';
      openModal(`${t.src}: ${verb} ${need === 1 ? (t.k === 'discard' ? 'a card' : (/^[aeiou]/.test(t.what || 'permanent') ? 'an ' : 'a ') + (t.what || 'permanent')) : need}`, b => {
        b.append(h('div', { class: 'strip pick' }, pool.map(c => cardEl(c, { noMenu: true, cls: sel.includes(c.id) ? 'sel' : '', onClick: () => { const i = sel.indexOf(c.id); if (i >= 0) sel.splice(i, 1); else if (sel.length < need) sel.push(c.id); refreshModal(); } }))));
        b.append(h('div', { class: 'row' }, h('button', { class: 'primary', disabled: sel.length !== need, onclick: async () => { if (done) return; done = true; closeModal(true); if (t.k === 'discard') await G.fromHand(sel.slice(), 'graveyard', { msg: `discarded {cards} (${t.src})` }); else if (t.k === 'returnOwn') await G.move(sel.slice(), 'hand'); else await G.move(sel.slice(), 'graveyard'); ack(); setTimeout(pumpAsks, 50); } }, `${t.k === 'discard' ? 'Discard' : t.k === 'returnOwn' ? 'Return' : 'Sacrifice'} (${sel.length}/${need})`)));
      }, { live: true, cls: 'wide', sticky: true, noEsc: true });
      return;
    }
    ack(); pumpAsks();
  });

  // ======================= deck import: Moxfield links, ManaBox files, pasted lists =======================
  async function fetchMoxfield(id) {
    const tries = ['/.netlify/functions/moxfield?id=' + encodeURIComponent(id), 'https://api2.moxfield.com/v3/decks/all/' + encodeURIComponent(id)];
    for (const u of tries) {
      try { const r = await fetch(u, { headers: { Accept: 'application/json' } }); if (!r.ok) continue; const j = await r.json(); if (j && (j.boards || j.mainboard)) return j; } catch (e) {}
    }
    return null;
  }
  function moxLines(j) {
    const out = [];
    const add = (obj, cmdr) => { for (const v of Object.values(obj || {})) { const c = v.card || {}; if (!c.name) continue; out.push({ name: c.name, qty: v.quantity || 1, id: c.scryfall_id || '', set: (c.set || '').toLowerCase(), num: c.cn || '', cmdr }); } };
    const B = j.boards || {};
    add(B.commanders ? B.commanders.cards : j.commanders, true);
    add(B.mainboard ? B.mainboard.cards : j.mainboard, false);
    return out;
  }
  async function linesToDeck(lines, deckName, onMsg) {
    if (!lines.length) throw new Error('No cards found in that list.');
    onMsg(`Looking up ${lines.length} cards on Scryfall…`);
    const res = await Scry.resolveLines(lines, (a, b2) => onMsg(`Looking up cards… ${a}/${b2}`));
    const merged = [];
    for (const c of res.cards) { const ex = merged.find(m => m.d.n === c.d.n && !m.cmdr && !c.cmdr); if (ex) ex.qty += c.qty; else merged.push(c); }
    let nC = 0; for (const c of merged) if (c.cmdr) { if (++nC > 2) c.cmdr = false; else c.qty = 1; }
    const d = { id: G.R.rid(8), name: deckName || 'Imported deck', cards: merged, sleeve: null };
    const all = G.decks(); all.unshift(d); G.saveDecks(all);
    onMsg(`Imported ${merged.reduce((a, c) => a + c.qty, 0)} cards${res.notFound.length ? ` (not found: ${res.notFound.slice(0, 5).join(', ')}${res.notFound.length > 5 ? '…' : ''})` : ''}.${merged.some(c => c.cmdr) ? '' : ' Star (☆) the commander in Decks.'}`);
    return d;
  }
  G.linesToDeck = linesToDeck; G.moxLines = moxLines;
  // A small "import a deck" block: Moxfield link, with a guided copy-and-paste fallback.
  // Moxfield link (or a pasted list). st keeps what was typed while the window redraws: { link, paste, open, fail }.
  function deckImporter(st, onDeck, onMsg) {
    const wrap = h('div', { class: 'importer' });
    const link = h('input', { type: 'text', id: 'moxlink', value: st.link || '', placeholder: 'moxfield.com/decks/…', 'aria-label': 'Moxfield deck link', oninput: e => { st.link = e.target.value; } });
    const area = h('textarea', { id: 'moxpaste', rows: '5', placeholder: 'Paste a deck list (Moxfield “Copy as plain text”, ManaBox, Arena…). It imports as soon as you paste.', hidden: !st.open, oninput: e => { st.paste = e.target.value; btn.hidden = !st.paste.trim(); } });
    area.value = st.paste || '';
    const nameFor = lines => { const c = lines.filter(l => l.cmdr).map(l => l.name.split(/,| \/\/ /)[0].trim()); return c.length ? c.join(' & ') + ' deck' : st.fail ? 'Moxfield deck' : 'Pasted deck'; };
    const moxUrl = () => { const v = (st.link || '').trim(); return /moxfield\.com\/decks\//i.test(v) ? (v.startsWith('http') ? v : 'https://' + v) : null; };
    const go = async () => {
      const v = (st.link || '').trim();
      const m = v.match(/moxfield\.com\/decks\/([A-Za-z0-9_\-]+)/i) || v.match(/^([A-Za-z0-9_\-]{12,})$/);
      if (!m) { onMsg('That doesn’t look like a Moxfield deck link. It should look like moxfield.com/decks/AbC123…'); return; }
      onMsg('Reading the deck from Moxfield…');
      const j = await fetchMoxfield(m[1]);
      if (j) { try { const d = await linesToDeck(moxLines(j), j.name || 'Moxfield deck', onMsg); st.link = ''; st.fail = false; onDeck(d); } catch (e) { onMsg(e.message || 'Couldn’t import that deck.'); } return; }
      st.open = true; st.fail = true;
      onMsg('Moxfield didn’t send that deck (it may be private, or Moxfield is busy). You can still bring it in: open it on Moxfield, choose Export → “Copy as plain text”, and paste it into the box above.');
      setTimeout(() => { const a = $('#moxpaste'); if (a) a.focus(); }, 60);
    };
    link.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    const fromText = async t => { if (!t.trim()) return; try { const lines = Scry.parseDeckFile(t); const d = await linesToDeck(lines, nameFor(lines), onMsg); st.paste = ''; st.open = false; st.fail = false; onDeck(d); } catch (e) { onMsg(e.message || 'Couldn’t import that list.'); } };
    area.addEventListener('paste', () => setTimeout(() => fromText(area.value), 30));
    const btn = h('button', { class: 'primary', hidden: !(st.paste || '').trim(), onclick: () => fromText(area.value) }, 'Import this list');
    const toggle = h('button', { class: 'ghost small', onclick: () => { st.open = !st.open; area.hidden = !st.open; toggle.textContent = st.open ? 'Hide the paste box' : 'Paste a deck list instead'; if (st.open) area.focus(); } }, st.open ? 'Hide the paste box' : 'Paste a deck list instead');
    wrap.append(h('div', { class: 'imhead' }, 'Import a deck from Moxfield'),
      h('div', { class: 'row imrow' }, link, h('button', { class: 'primary', onclick: go }, 'Import')),
      st.fail && moxUrl() ? h('button', { class: 'small', onclick: () => window.open(moxUrl(), '_blank', 'noopener') }, 'Open the deck on Moxfield ↗') : '',
      toggle, area, btn);
    return wrap;
  }

  // ======================= modals =======================
  function zoneModal(pid, zone) {
    openModal(`${nameOf(pid)} — ${ZLABEL[zone]}`, b => {
      const cards = R.zoneCards(S(), zone, pid, 'owner').slice().reverse();
      b.append(h('p', { class: 'muted' }, cards.length ? `${plural(cards.length, 'card')}${zone === 'graveyard' ? ', newest first' : ''}. Scroll sideways to look through them.` : 'Nothing here.'));
      const strip = h('div', { class: 'strip zoneview', 'data-scroll': 'zone' }, cards.map(c => cardEl(c)));
      b.append(h('div', { class: 'scrollwrap' }, h('button', { class: 'sarrow', onclick: () => strip.scrollBy({ left: -400, behavior: 'smooth' }) }, '‹'), strip, h('button', { class: 'sarrow', onclick: () => strip.scrollBy({ left: 400, behavior: 'smooth' }) }, '›')));
      if (pid === KEY && cards.length && zone !== 'command') {
        const ids = cards.map(c => c.id);
        b.append(h('div', { class: 'row wrap' }, h('span', { class: 'muted' }, 'Move all:'),
          zone !== 'exile' ? h('button', { onclick: () => G.move(ids, 'exile') }, 'Exile all') : null,
          zone !== 'graveyard' ? h('button', { onclick: () => G.move(ids, 'graveyard') }, 'All to graveyard') : null,
          h('button', { onclick: () => G.move(ids, 'library', 'shuffle') }, 'Shuffle all into library'),
          h('button', { onclick: () => G.move(ids, 'hand') }, 'All to hand')));
      }
    }, { live: true, cls: 'wide' });
  }

  function lookModal(mode, x, onDone) {
    const top = G.P.library.slice(0, x);
    const order = top.map(c => ({ id: c.id, dest: 'top' }));
    const dests = mode === 'scry' ? ['top', 'bottom'] : mode === 'surveil' ? ['top', 'graveyard'] : ['top', 'bottom', 'hand', 'graveyard', 'exile', 'battlefield'];
    const DL = { top: 'Top', bottom: 'Bottom', hand: 'Hand', graveyard: 'Graveyard', exile: 'Exile', battlefield: 'Battlefield' };
    const title = mode === 'scry' ? `Scry ${x}` : mode === 'surveil' ? `Surveil ${x}` : `Top ${plural(x, 'card')} of your library`;
    let applied = false;
    const apply = () => { if (applied) return; applied = true; closeModal(true); G.applyLook(mode, x, order).then(() => { if (onDone) onDone(); }); };
    openModal(title, b => {
      b.append(h('p', { class: 'muted' }, 'Left is the top of your library. Use the arrows to change the order of cards you keep on top.'));
      const strip = h('div', { class: 'strip look', 'data-scroll': 'look' });
      order.forEach((o, i) => {
        const c = top.find(t => t.id === o.id);
        strip.append(h('div', { class: 'lookcard' },
          cardEl(Object.assign({ zone: 'library', counters: {} }, c, { owner: KEY }), { noMenu: true, onClick: () => {} }),
          h('div', { class: 'ord' },
            h('button', { disabled: i === 0, title: 'Move left (closer to top)', onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; refreshModal(); } }, '←'),
            h('span', null, '#' + (i + 1)),
            h('button', { disabled: i === order.length - 1, title: 'Move right', onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; refreshModal(); } }, '→')),
          h('div', { class: 'dests' }, dests.map(d => h('button', { class: o.dest === d ? 'on' : '', onclick: () => { o.dest = d; refreshModal(); } }, DL[d])))));
      });
      b.append(strip, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: apply }, 'Done')));
    }, { live: true, cls: 'wide', sticky: true, onClose: apply });
  }

  function searchModal() {
    let q = '';
    const toTop = [];
    let finished = false;
    const finish = () => {
      if (finished) return; finished = true;
      G.finishSearch();
      if (toTop.length) { G.P.library.unshift(...toTop.splice(0)); G.savePriv(); G.act({ type: 'log', text: 'put a card on top of their library' }); }
    };
    openModal('Search your library', b => {
      const inp = h('input', { type: 'search', id: 'libsearch', placeholder: 'Filter by name or type', value: q, oninput: e => {
        q = e.target.value; const ql = q.toLowerCase();
        // Hide what doesn't match without rebuilding, so the phone keyboard stays up.
        b.querySelectorAll('.gridcards .card').forEach(el => { const c = G.P.library.find(x => x.id === el.dataset.id); el.hidden = !!(c && ql && !(c.d.n + ' ' + c.d.faces[0].t).toLowerCase().includes(ql)); });
      } });
      const cards = G.P.library.slice().sort((a, b2) => a.d.n.localeCompare(b2.d.n));
      b.append(h('p', { class: 'muted' }, `${plural(G.P.library.length, 'card')}, sorted by name. Your library is shuffled when you close this, and everyone is told you searched.`), inp);
      b.append(h('div', { class: 'gridcards', 'data-scroll': 'search' }, cards.map(c => cardEl(Object.assign({ zone: 'library', owner: KEY, counters: {} }, c), {
        menu: () => [
          { label: 'Put into hand', fn: () => { G.libraryToHand([c.id], 'put a card from their library into their hand'); refreshModal(); } },
          { label: 'Put onto the battlefield', fn: () => G.fromLibrary([c.id], 'battlefield').then(refreshModal) },
          { label: 'Put onto the battlefield tapped', fn: () => G.fromLibrary([c.id], 'battlefield', { tapped: true }).then(refreshModal) },
          { label: 'Put into graveyard', fn: () => G.fromLibrary([c.id], 'graveyard').then(refreshModal) },
          { label: 'Exile it', fn: () => G.fromLibrary([c.id], 'exile').then(refreshModal) },
          { label: 'Put on top (after shuffling)', fn: () => { const i = G.P.library.findIndex(x => x.id === c.id); if (i >= 0) toTop.push(G.P.library.splice(i, 1)[0]); G.savePriv(); refreshModal(); } }
        ]
      }))));
      if (toTop.length) b.append(h('p', { class: 'muted' }, `${toTop.length} card${toTop.length > 1 ? 's' : ''} will go on top after shuffling.`));
      b.append(h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { closeModal(); } }, 'Done — shuffle')));
    }, { live: true, cls: 'wide', onClose: finish });
  }

  function counterModal(id) {
    openModal('Counters', b => {
      const c = S().cards[id];
      if (!c || (c.zone !== 'battlefield' && c.zone !== 'exile')) { b.append(h('p', null, 'That card moved, so its counters are gone.')); return; }
      b.append(h('p', { class: 'muted' }, R.cardName(c)));
      const cur = Object.entries(c.counters || {});
      b.append(h('div', { class: 'clist' }, cur.length ? cur.map(([k, n]) => h('div', { class: 'crow' },
        h('span', { class: 'cname' }, k), h('button', { onclick: () => G.counter(id, k, -1) }, '▼'), h('b', null, String(n)), h('button', { onclick: () => G.counter(id, k, 1) }, '▲'),
        h('button', { class: 'ghost', onclick: () => G.counter(id, k, -n) }, 'Remove'))) : h('p', { class: 'muted' }, 'No counters yet.')));
      b.append(h('h4', null, 'Add a counter'));
      b.append(h('div', { class: 'chips' }, R.SUGGESTED_COUNTERS.map(k => h('button', { class: 'chip', onclick: () => G.counter(id, k, 1) }, k))));
      const inp = h('input', { type: 'text', id: 'newcounter', placeholder: 'New counter name (charge, oil, lore…)', list: 'counterlist' });
      const dl = h('datalist', { id: 'counterlist' }, ['charge', 'shield', 'stun', 'lore', 'time', 'oil', 'finality', 'age', 'fade', 'quest', 'study', 'blood', 'rad', 'level'].map(k => h('option', { value: k })));
      const add = () => { const k = inp.value.trim(); if (k) { G.counter(id, k, 1); inp.value = ''; } };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
      b.append(h('div', { class: 'row' }, inp, dl, h('button', { class: 'primary', onclick: add }, 'Add')));
    }, { live: true });
  }

  function ptModal(id) {
    openModal('Power / toughness', b => {
      const c = S().cards[id];
      if (!c) return;
      const m = c.mod || [0, 0];
      const pt = R.ptOf(c);
      b.append(h('p', { class: 'muted' }, `${R.cardName(c)} is ${pt ? pt.join('/') : '—'}. Changes here last until end of turn.`));
      const rowOf = (label, i) => h('div', { class: 'crow' }, h('span', { class: 'cname' }, label),
        h('button', { onclick: () => { const n = m.slice(); n[i]--; G.setMod(id, n[0], n[1]); } }, '−1'),
        h('b', null, (m[i] >= 0 ? '+' : '') + m[i]),
        h('button', { onclick: () => { const n = m.slice(); n[i]++; G.setMod(id, n[0], n[1]); } }, '+1'));
      b.append(rowOf('Power', 0), rowOf('Toughness', 1), h('div', { class: 'row' }, h('button', { onclick: () => G.setMod(id, 0, 0) }, 'Clear')));
    }, { live: true, cls: 'small' });
  }

  function trackerModal(pid) {
    openModal(`${nameOf(pid)} — trackers`, b => {
      const s = S(), p = s.players[pid]; if (!p) return;
      const mine = pid === KEY;
      const row = (label, key, steps) => h('div', { class: 'crow' }, h('span', { class: 'cname' }, label),
        mine ? steps.map(n => h('button', { onclick: () => G.act({ type: 'player', patch: { [key]: p[key] + n } }) }, (n > 0 ? '+' : '') + n)).slice(0, steps.length / 2) : null,
        mine ? h('button', { class: 'bignum', title: `Type a new ${label.toLowerCase()} total`, onclick: () => setTotal(label, key, p[key]) }, String(p[key])) : h('b', { class: 'big' }, String(p[key])),
        mine ? steps.map(n => h('button', { onclick: () => G.act({ type: 'player', patch: { [key]: p[key] + n } }) }, (n > 0 ? '+' : '') + n)).slice(steps.length / 2) : null);
      const setTotal = (label, key, cur) => openModal(`Set ${label.toLowerCase()}`, bb => {
        const inp = h('input', { type: 'number', min: '-99', max: '999', value: String(cur), class: 'num', id: 'total-in' });
        const go = () => { const n = parseInt(inp.value, 10); if (isNaN(n)) return; closeModal(); G.act({ type: 'player', patch: { [key]: Math.max(-99, Math.min(999, n)) } }); };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        bb.append(h('div', { class: 'row' }, inp, h('button', { class: 'primary', onclick: go }, 'Set')));
        setTimeout(() => { inp.focus(); inp.select(); }, 30);
      }, { cls: 'small' });
      b.append(row('Life', 'life', [-5, -1, 1, 5]), row('Poison', 'poison', [-1, 1]), row('Energy', 'energy', [-1, 1]), row('Experience', 'exp', [-1, 1]));
      const cmdrs = Object.values(s.cards).filter(c => c.cmdr && c.owner !== pid);
      b.append(h('h4', null, 'Commander damage taken'));
      if (!cmdrs.length) b.append(h('p', { class: 'muted' }, 'No other commanders on the table yet.'));
      for (const c of cmdrs) {
        const v = (p.cmdDmg || {})[c.id] || 0;
        b.append(h('div', { class: 'crow' + (v >= 21 ? ' bad' : '') }, h('span', { class: 'cname' }, `${R.cardName(c)} (${nameOf(c.owner)})`),
          mine ? h('button', { onclick: () => G.act({ type: 'player', patch: { cmdDmg: { [c.id]: v - 1 } } }) }, '−1') : null,
          h('b', null, String(v)),
          mine ? h('button', { onclick: () => G.act({ type: 'player', patch: { cmdDmg: { [c.id]: v + 1 }, life: p.life - 1 } }) }, '+1') : null));
      }
      if (mine && cmdrs.length) b.append(h('p', { class: 'muted' }, '+1 commander damage also takes 1 life.'));
      const myCmd = Object.values(s.cards).filter(c => c.cmdr && c.owner === pid);
      if (myCmd.length) {
        b.append(h('h4', null, 'Commander tax'));
        for (const c of myCmd) b.append(h('div', { class: 'crow' }, h('span', { class: 'cname' }, R.cardName(c)), h('b', null, '{' + 2 * (s.tax[c.id] || 0) + '}'), h('span', { class: 'muted' }, `cast ${s.tax[c.id] || 0}× from the command zone`)));
      }
    }, { live: true });
  }

  function tokenModal() {
    let q = '', results = null, busy = false, count = 1, tapped = false, err = '';
    const run = async term => {
      q = term; busy = true; err = ''; refreshModal();
      try { results = await Scry.tokens(term); } catch (e) { err = 'Couldn’t reach Scryfall. Check your internet and try again.'; results = []; }
      busy = false; refreshModal();
    };
    openModal('Add tokens', b => {
      const inp = h('input', { type: 'search', id: 'toksearch', placeholder: 'Search tokens — Treasure, Soldier, Zombie…', value: q });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(inp.value); });
      b.append(h('div', { class: 'row' }, inp, h('button', { class: 'primary', onclick: () => run(inp.value) }, 'Search')));
      b.append(h('div', { class: 'chips' }, ['Treasure', 'Food', 'Clue', 'Soldier', 'Zombie', 'Goblin', 'Spirit', 'Saproling', 'Elf Warrior', 'Thopter', 'Angel', 'Dragon', 'Beast', 'Blood', 'Map'].map(n => h('button', { class: 'chip', onclick: () => run(n) }, n))));
      b.append(h('div', { class: 'row' }, h('label', null, 'How many ', h('input', { type: 'number', id: 'tokcount', min: '1', max: '50', value: String(count), class: 'num', oninput: e => count = Math.max(1, Math.min(50, +e.target.value || 1)) })),
        h('label', null, h('input', { type: 'checkbox', id: 'toktapped', checked: tapped, onchange: e => tapped = e.target.checked }), ' Enters tapped')));
      if (busy) b.append(h('p', { class: 'muted' }, 'Searching Scryfall…'));
      if (err) b.append(h('p', { class: 'err' }, err));
      if (results && !busy) {
        if (!results.length) b.append(h('p', { class: 'muted' }, 'No tokens found. Try a different word.'));
        b.append(h('div', { class: 'gridcards', 'data-scroll': 'tok' }, results.map(d => {
          const el = cardEl({ id: 'tk-' + d.sid, d, face: 0, owner: KEY, zone: 'search', counters: {} }, { noMenu: true, onClick: () => { G.token(d, count, tapped); } });
          el.title = `Create ${count} ${d.n}`;
          return el;
        })));
        b.append(h('p', { class: 'muted' }, 'Click a token to create it. Remove tokens from their own card menu.'));
      }
    }, { live: true, cls: 'wide' });
    if (!results) run('');
  }

  function nameModal() {
    openModal(G.me() ? 'Your name' : 'Take a seat', b => {
      const inp = h('input', { type: 'text', id: 'myname', maxlength: '20', placeholder: 'Your name', value: (G.me() && G.me().name) || G.myName() });
      const go = () => { const n = inp.value.trim(); if (!n) return; G.setMyName(n); G.act({ type: 'join', name: n }); closeModal(); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      b.append(h('div', { class: 'row' }, inp, h('button', { class: 'primary', onclick: go }, G.me() ? 'Save' : 'Sit down')));
      setTimeout(() => inp.focus(), 30);
    }, { cls: 'small' });
  }

  function tableModal() {
    openModal('Open a different table', b => {
      b.append(h('p', { class: 'muted' }, 'Each table name is its own game. Share the link it gives you.'));
      const inp = h('input', { type: 'text', id: 'tablename', placeholder: 'e.g. friday-night', value: G.TABLE === 'main' ? '' : G.TABLE });
      b.append(h('div', { class: 'row' }, inp, h('button', { class: 'primary', onclick: () => { const t = inp.value.trim().replace(/[^\w-]/g, '-').slice(0, 40); location.href = location.pathname + (t && t !== 'main' ? '?t=' + encodeURIComponent(t) : ''); } }, 'Go')));
    }, { cls: 'small' });
  }

  function qrSvg(url) {
    try { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); return qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true }); } catch (e) { return ''; }
  }

  // Invite: the table link, as a QR code, a link to copy, and the phone's share sheet (text, messages…).
  function inviteModal() {
    openModal('Invite players', b => {
      const url = G.inviteURL();
      const s = S(), n = s ? s.seats.length : 0;
      const msg = `Join my Magic game on Kitchen Table: ${url}`;
      b.append(h('div', { class: 'qrwrap invite' },
        h('div', { class: 'qr', 'aria-label': 'Invite QR code', html: qrSvg(url) }),
        h('div', { class: 'invtext' },
          h('p', null, 'Friends scan this with their phone camera, or open the link, to join this table as their own player.'),
          h('div', { class: 'linkbox' }, h('input', { type: 'text', id: 'invitelink', readonly: true, value: url, onclick: e => e.target.select() })),
          h('div', { class: 'row wrap' },
            h('button', { class: 'primary', onclick: () => copyText(url, 'Invite link copied') }, 'Copy link'),
            navigator.share ? h('button', { onclick: () => navigator.share({ title: 'Kitchen Table', text: msg, url }).catch(() => {}) }, 'Share…') : null,
            h('button', { onclick: () => copyText(msg, 'Invite message copied') }, 'Copy message')),
          h('p', { class: 'muted small' }, `${n} of ${R.MAX_SEATS} seats taken${G.TABLE !== 'main' ? ` · table “${G.TABLE}”` : ''}.`),
          h('p', { class: 'muted small' }, 'This invite never opens anyone’s hand. Your own hand’s phone code is under “Phone” — keep that one to yourself.'))));
    }, { live: true });
  }

  function phoneModal() {
    G.startPhoneLink();
    openModal('Use your phone as your hand', b => {
      const url = G.phoneURL();
      b.append(h('div', { class: 'qrwrap' },
        h('div', { class: 'qr', 'aria-label': 'Phone QR code', html: qrSvg(url) }),
        h('div', null,
          h('p', null, h('b', null, 'This code is only for your own phone. '), 'Scan it with your phone’s camera; your phone shows your hand and the board stays here.'),
          h('p', { class: 'muted' }, 'This computer will ask you to allow the phone the first time. Swipe a card up to play it, or tap it to see it big and pick where it goes.'),
          h('p', null, G.phoneLinked ? h('b', { class: 'good' }, '✓ Your phone is linked') : h('span', { class: 'muted' }, 'Waiting for your phone…')),
          h('p', { class: 'muted small' }, 'Friends joining the game should use Invite instead.'),
          h('div', { class: 'row wrap' },
            h('button', { onclick: () => copyText(url, 'Phone link copied') }, 'Copy phone link'),
            h('button', { class: 'ghost', title: 'The old code stops working and phones must be allowed again', onclick: () => G.resetPhone() }, 'New code / unlink phones')))));
    }, { live: true });
  }

  // Phone approvals get their own layer on top of everything (even an open Decks window), one phone at a time,
  // each showing that phone's 3-digit code. You have to choose Allow or Don't allow.
  const phoneAsks = [];
  let phoneAskOpen = false;
  G.askPhone = (req, answer) => { phoneAsks.push({ req, answer }); showPhoneAsk(); };
  function showPhoneAsk() {
    if (phoneAskOpen || !phoneAsks.length) return;
    phoneAskOpen = true;
    const { req, answer } = phoneAsks.shift();
    const codeEl = h('b', null, req.code);
    req.update = () => { codeEl.textContent = req.code; };
    let done = false;
    const finish = ok => {
      if (done) return; done = true;
      ov.remove(); phoneAskOpen = false; req.update = null;
      answer(ok);
      if (ok && Date.now() - req.seen >= 12000) G.toast('That phone left before you allowed it. Scan the code again on it.', 'info');
      setTimeout(showPhoneAsk, 50);
    };
    const ov = h('div', { class: 'overlay top' }, h('div', { class: 'modal small', role: 'alertdialog', 'aria-label': 'Link a phone as your hand?' },
      h('header', null, h('h2', null, 'Link a phone as your hand?')),
      h('div', { class: 'mbody' },
        h('p', null, `${req.label} scanned your hand code and wants to show your hand.`),
        h('div', { class: 'pcode' }, h('span', { class: 'muted' }, 'Code on that phone'), codeEl),
        h('p', { class: 'muted' }, 'Allow it only if this matches the code on your own phone. Friends who want to play should use the Invite link instead.'),
        h('div', { class: 'row wrap' },
          h('button', { class: 'primary', onclick: () => finish(true) }, 'Allow — it’s my phone'),
          h('button', { onclick: () => finish(false) }, 'Don’t allow')))));
    document.body.append(ov);
  }

  // ======================= deck manager =======================
  let editing = null;
  function deckManager() {
    const decks = G.decks();
    if (!editing || !decks.some(d => d.id === editing)) editing = (G.P.deckId && decks.some(d => d.id === G.P.deckId)) ? G.P.deckId : (decks[0] && decks[0].id) || null;
    let acQ = '', acList = [], acBusy = false, importMsg = '';
    const imp = {};
    let acT = null;
    const saveDeck = deck => { const all = G.decks(); const i = all.findIndex(d => d.id === deck.id); deck.updated = Date.now(); if (i >= 0) all[i] = deck; else all.unshift(deck); G.saveDecks(all); };
    openModal('Decks', b => {
      const all = G.decks();
      const deck = all.find(d => d.id === editing) || null;
      const list = h('div', { class: 'decklist' },
        h('button', { class: 'primary', onclick: () => { const d = { id: G.R.rid(8), name: 'New deck', cards: [], sleeve: null }; saveDeck(d); editing = d.id; refreshModal(); } }, '+ New deck'),
        h('label', { class: 'import' }, 'Import from ManaBox (.txt or .csv)',
          h('input', { type: 'file', accept: '.csv,.txt,text/csv,text/plain', id: 'importfile', onchange: e => importFile(e.target.files[0]) })),
        deckImporter(imp, d => { editing = d.id; importMsg = `Imported ${d.name}.`; refreshModal(); }, msg => { importMsg = msg; refreshModal(); }),
        importMsg ? h('p', { class: 'muted small immsg' }, importMsg) : null,
        all.map(d => h('button', { class: 'dk' + (d.id === editing ? ' on' : ''), onclick: () => { editing = d.id; refreshModal(); } },
          d.sleeve ? h('img', { src: d.sleeve, alt: '' }) : h('img', { src: BACK, alt: '' }),
          h('span', null, h('b', null, d.name), h('small', null, `${d.cards.reduce((a, c) => a + c.qty, 0)} cards`)))));
      const ed = h('div', { class: 'deckedit' });
      if (!deck) ed.append(h('div', { class: 'empty big' }, 'Make a new deck or import one from ManaBox. In ManaBox, open your deck, choose Export, and pick CSV.'));
      else {
        const total = deck.cards.reduce((a, c) => a + c.qty, 0);
        const cmdN = deck.cards.filter(c => c.cmdr).length;
        const name = h('input', { type: 'text', id: 'deckname', value: deck.name, onchange: e => { deck.name = e.target.value.trim() || 'Untitled deck'; saveDeck(deck); refreshModal(); } });
        // search bar
        const search = h('input', { type: 'search', id: 'cardsearch', placeholder: 'Search Scryfall to add a card', value: acQ, autocomplete: 'off' });
        search.addEventListener('input', e => {
          acQ = e.target.value; clearTimeout(acT);
          acT = setTimeout(async () => { try { acList = await Scry.autocomplete(acQ); } catch (err) { acList = []; G.toast('Couldn’t reach Scryfall.', 'err'); } showAc(); }, 250);
        });
        const addName = async n => {
          try {
            const d = await Scry.named(n);
            const ex = deck.cards.find(c => c.d.n === d.n);
            if (ex) ex.qty++; else deck.cards.push({ d, qty: 1, cmdr: false });
            saveDeck(deck); acQ = ''; acList = []; refreshModal();
            G.toast(`Added ${d.n}`);
          } catch (e) { G.toast('Couldn’t find that card on Scryfall.', 'err'); }
        };
        search.addEventListener('keydown', e => { if (e.key === 'Enter' && acList[0]) addName(acList[0]); });
        const acEl = () => acList.length ? h('div', { class: 'ac' }, acList.slice(0, 12).map(n => h('button', { onclick: () => addName(n) }, n))) : null;
        const ac = acEl();
        const showAc = () => { const w = search.parentElement; if (!w) return; const old = w.querySelector('.ac'); if (old) old.remove(); const n = acEl(); if (n) w.append(n); };

        const groups = [['Commander', c => c.cmdr], ['Creatures', c => /creature/i.test(c.d.faces[0].t)], ['Planeswalkers', c => /planeswalker/i.test(c.d.faces[0].t)],
          ['Instants & sorceries', c => /instant|sorcery/i.test(c.d.faces[0].t)], ['Artifacts', c => /artifact/i.test(c.d.faces[0].t)], ['Enchantments', c => /enchantment/i.test(c.d.faces[0].t)],
          ['Lands', c => /\bland\b/i.test(c.d.faces[0].t)], ['Other', () => true]];
        const used = new Set();
        const sections = groups.map(([label, test]) => {
          const cs = deck.cards.filter(c => !used.has(c) && test(c));
          cs.forEach(c => used.add(c));
          if (!cs.length) return null;
          return h('div', { class: 'dgroup' }, h('h4', null, label, h('span', null, String(cs.reduce((a, c) => a + c.qty, 0)))),
            cs.sort((a, b2) => a.d.n.localeCompare(b2.d.n)).map(c => {
              const line = h('div', { class: 'dline' },
                h('button', { class: 'q', onclick: () => { c.qty--; if (c.qty <= 0) deck.cards.splice(deck.cards.indexOf(c), 1); saveDeck(deck); refreshModal(); } }, '−'),
                h('b', null, String(c.qty)),
                h('button', { class: 'q', onclick: () => { c.qty++; saveDeck(deck); refreshModal(); } }, '+'),
                h('span', { class: 'dn' }, c.d.n, c.d.fin ? h('span', { class: 'finchip' }, c.d.fin === 'etched' ? 'Etched' : 'Foil') : null),
                h('button', { class: 'artbtn', title: 'Choose which printing (art, frame, foil)', onclick: () => printPicker(deck, c, saveDeck) }, 'Print'),
                h('button', { class: 'star' + (c.cmdr ? ' on' : ''), title: c.cmdr ? 'Commander' : 'Make this a commander', onclick: () => {
                  // Commander allows at most two commanders (partners / Background, rule 903.3c).
                  if (!c.cmdr && deck.cards.filter(x => x.cmdr).length >= 2) { G.toast('A deck can have at most 2 commanders. Remove one first.', 'err'); return; }
                  c.cmdr = !c.cmdr; if (c.cmdr) c.qty = 1; saveDeck(deck); refreshModal();
                } }, c.cmdr ? '★ Commander' : '☆'));
              const fake = { id: 'dk-' + c.d.sid, d: c.d, face: 0, counters: {} };
              line.addEventListener('mouseenter', e => showPreview(fake, e)); line.addEventListener('mouseleave', hidePreview);
              return line;
            }));
        });
        const lands = deck.cards.filter(c => G.isLand(c)).reduce((a, c) => a + c.qty, 0);
        ed.append(
          h('div', { class: 'row' }, name, h('button', { class: 'primary', disabled: !G.me() || !total, onclick: () => play(deck) }, G.P.deckId === deck.id ? 'Restart with this deck' : 'Play this deck')),
          h('p', { class: 'muted' }, `${total} cards · ${lands} lands · ${cmdN ? plural(cmdN, 'commander') : 'no commander picked — tap ☆ next to a card'}`),
          h('div', { class: 'acwrap' }, search, ac),
          commanderPanel(deck, saveDeck),
          h('div', { class: 'looks' },
            h('div', { class: 'sleeve' }, h('img', { src: deck.sleeve || BACK, alt: 'Sleeve' }),
              h('div', null, h('b', null, 'Sleeve'), h('p', { class: 'muted small' }, 'On your library and face-down cards.'),
                h('label', { class: 'btnlike' }, deck.sleeve ? 'Change' : 'Upload', h('input', { type: 'file', accept: 'image/*', id: 'sleevefile', onchange: e => imageCrop(e.target.files[0], 'sleeve', deck, saveDeck) })),
                cmdArt(deck) ? h('button', { class: 'cmdartbtn', title: 'Use only the artwork of your commander (no card frame)', onclick: () => imageCrop(cmdArt(deck), 'sleeve', deck, saveDeck) }, 'Use commander art') : null,
                deck.sleeve ? h('button', { class: 'ghost', onclick: () => { deck.sleeve = null; saveDeck(deck); G.pushLook(deck); refreshModal(); } }, 'Remove') : null)),
            h('div', { class: 'sleeve matrow' },
              h('div', { class: 'matprev', style: boardStyle0(deck) }),
              h('div', null, h('b', null, 'Playmat'), h('p', { class: 'muted small' }, 'Shows behind your side of the table for everyone.'),
                h('label', { class: 'btnlike' }, deck.mat ? 'Change' : 'Upload', h('input', { type: 'file', accept: 'image/*', id: 'matfile', onchange: e => imageCrop(e.target.files[0], 'mat', deck, saveDeck) })),
                cmdArt(deck) ? h('button', { class: 'cmdartbtn', title: 'Use only the artwork of your commander (no card frame)', onclick: () => imageCrop(cmdArt(deck), 'mat', deck, saveDeck) }, 'Use commander art') : null,
                deck.mat ? h('button', { class: 'ghost', onclick: () => { deck.mat = null; saveDeck(deck); G.pushLook(deck); refreshModal(); } }, 'Remove') : null)),
            h('div', { class: 'palwrap' }, h('b', null, 'Colors'),
              h('div', { class: 'pals' }, Object.entries(PALETTES).map(([k, p]) => h('button', {
                class: 'pal' + ((deck.palette || 'felt') === k ? ' on' : ''), title: p.name, 'aria-label': p.name,
                style: { background: `linear-gradient(135deg, ${p.b1} 0 55%, ${p.b2} 55%)`, '--pa': p.a },
                onclick: () => { deck.palette = k; saveDeck(deck); G.pushLook(deck); refreshModal(); }
              }, h('span', { class: 'pdot' })))),
              h('span', { class: 'muted small' }, (PALETTES[deck.palette] || PALETTES.felt).name))),
          h('div', { class: 'dcards', 'data-scroll': 'deck' }, sections),
          h('div', { class: 'row' }, h('button', { class: 'ghost danger', onclick: () => choose('Delete deck', `Delete “${deck.name}” from this device?`, [{ label: 'Delete', primary: true, fn: () => { G.saveDecks(G.decks().filter(d => d.id !== deck.id)); editing = null; deckManager(); } }, { label: 'Cancel', fn: deckManager }]) }, 'Delete deck'))
        );
      }
      b.append(h('div', { class: 'decks' }, list, ed));
    }, { live: true, cls: 'xwide' });

    async function importFile(file) {
      if (!file) return;
      importText(await file.text(), file.name.replace(/\.(csv|txt)$/i, '').replace(/[_-]+/g, ' ').trim());
    }
    async function importText(text, deckName) {
      const lines = Scry.parseDeckFile(text);
      if (!lines.length) { importMsg = 'That file had no cards in it.'; refreshModal(); return; }
      importMsg = `Looking up ${lines.length} cards on Scryfall…`; refreshModal();
      try {
        const res = await Scry.resolveLines(lines, (a, b2) => { importMsg = `Looking up cards… ${a}/${b2}`; refreshModal(); });
        const merged = [];
        for (const c of res.cards) { const ex = merged.find(m => m.d.n === c.d.n && !m.cmdr && !c.cmdr); if (ex) ex.qty += c.qty; else merged.push(c); }
        let nC = 0; const dropped = [];
        for (const c of merged) if (c.cmdr) { if (++nC > 2) { c.cmdr = false; dropped.push(c.d.n); } else c.qty = 1; }
        const d = { id: G.R.rid(8), name: deckName || 'Imported deck', cards: merged, sleeve: null };
        saveDeck(d); editing = d.id;
        importMsg = `Imported ${merged.reduce((a, c) => a + c.qty, 0)} cards.`
          + (res.notFound.length ? ` Scryfall couldn’t find ${res.notFound.length === 1 ? 'this card, so it was left out' : 'these cards, so they were left out'}: ${res.notFound.slice(0, 8).join(', ')}${res.notFound.length > 8 ? '…' : ''}. Check the spelling, or add it with the search bar.` : '')
          + (dropped.length ? ` A deck can have at most 2 commanders, so ${dropped.join(', ')} went into the deck instead.` : '')
          + (merged.some(c => c.cmdr) ? '' : ' Tap ☆ next to your commander.');
      } catch (e) { importMsg = 'Couldn’t reach Scryfall. Check your internet and try again.'; }
      refreshModal();
    }

    function play(deck) {
      const go = () => { closeModal(true); G.useDeck(deck); };
      if (G.P.deckId || G.P.hand.length) choose('Switch deck', 'This takes your current cards off the table and starts you over with this deck.', [{ label: 'Switch', primary: true, fn: go }, { label: 'Cancel', fn: deckManager }]);
      else go();
    }
  }

  // ---------- commander printings ----------
  function printLine(d) {
    const pr = d.pr;
    if (!pr) return 'Default printing';
    return `${pr.setName || pr.set}${pr.year ? ' (' + pr.year + ')' : ''} · #${pr.num}`;
  }
  function commanderPanel(deck, saveDeck) {
    const cmds = deck.cards.filter(c => c.cmdr);
    if (!cmds.length) return h('div', { class: 'cmdpanel empty' }, h('b', null, 'Commander'), h('span', { class: 'muted' }, 'Tap ☆ next to a card below to make it your commander. Then you can pick its print here — full art, borderless, showcase, foil, Universes Beyond and more.'));
    return h('div', { class: 'cmdpanel' }, cmds.map(c => {
      const f = c.d.faces[0];
      return h('div', { class: 'cmdpick' },
        h('div', { class: 'cmdart' + (c.d.fin ? ' ' + c.d.fin : '') }, h('img', { src: f.img || BACK, alt: c.d.n })),
        h('div', { class: 'cmdinfo' },
          h('span', { class: 'eyebrow' }, 'Commander'),
          h('b', null, c.d.n),
          h('span', { class: 'muted small' }, printLine(c.d)),
          h('div', { class: 'tags' }, (c.d.pr ? c.d.pr.tags : []).slice(0, 4).map(t => h('span', { class: 'prtag ' + t.k }, t.l)), c.d.fin ? h('span', { class: 'prtag foil' }, c.d.fin === 'etched' ? 'Etched finish' : 'Foil finish') : null),
          h('button', { class: 'primary', onclick: () => printPicker(deck, c, saveDeck) }, 'Choose print')));
    }));
  }

  const PRINT_FILTERS = [
    ['all', 'All', 'Every printing'],
    ['full', 'Full art', 'Art covers the whole card'],
    ['borderless', 'Borderless', 'No black border; art runs to the edge'],
    ['showcase', 'Showcase', 'Special set-themed frames'],
    ['extended', 'Extended art', 'Art stretches past the usual box'],
    ['foil', 'Special foils', 'Foil-only, etched and special foil printings'],
    ['ub', 'Universes Beyond', 'Printings from other franchises'],
    ['reskin', 'Reskins', 'Same card with a different name or look (Godzilla, Secret Lair, UB)'],
    ['retro', 'Retro frame', 'Old-style frame'],
    ['promo', 'Promos', 'Promo, prerelease and serialized cards']
  ];
  function printMatches(d, f) {
    if (f === 'all') return true;
    const tags = d.pr ? d.pr.tags.map(t => t.k) : [];
    if (f === 'foil') return !!d.pr && (tags.includes('foil') || d.pr.finishes.includes('etched') || (d.pr.finishes.length > 0 && !d.pr.finishes.includes('nonfoil')));
    return tags.includes(f);
  }

  function printPicker(deck, entry, saveDeck) {
    let list = null, err = '', filter = 'all';
    let pick = entry.d.sid, fin = entry.d.fin || '';
    const load = async () => {
      list = null; err = ''; refreshModal();
      try { list = await Scry.prints(entry.d); } catch (e) { err = 'Couldn’t reach Scryfall to look up printings. Check your internet and try again.'; list = []; }
      // Always offer the printing you have now, even if Scryfall didn't return it.
      if (!err && !list.some(d => d.sid === entry.d.sid)) list = [Object.assign({}, entry.d, { pr: entry.d.pr || { set: '', setName: 'Your current printing', num: '', year: '', date: '', lang: 'en', finishes: ['nonfoil', 'foil'], tags: [] } })].concat(list);
      if (list.length && !list.some(d => d.sid === pick)) pick = list[0].sid;
      refreshModal();
    };
    const back = () => { closeModal(true); deckManager(); };
    openModal(`Choose a print — ${entry.d.n}`, b => {
      b.append(h('p', { class: 'muted pintro' }, 'Every printing of this card, newest first — including reskins with other names. Pick one and a finish; everyone at the table sees it.'));
      if (!list) { b.append(h('p', null, 'Loading printings from Scryfall…')); return; }
      if (err) { b.append(h('p', { class: 'err' }, err), h('div', { class: 'row' }, h('button', { class: 'primary', onclick: load }, 'Try again'), h('button', { onclick: back }, 'Back to deck'))); return; }
      if (list.length <= 1) b.append(h('p', { class: 'muted' }, 'Scryfall has no other printings of this card.'));
      const counts = {}; for (const [k] of PRINT_FILTERS) counts[k] = list.filter(d => printMatches(d, k)).length;
      b.append(h('div', { class: 'chips pfilters' }, PRINT_FILTERS.filter(([k]) => k === 'all' || counts[k]).map(([k, l, tip]) =>
        h('button', { class: 'chip' + (filter === k ? ' set' : ''), title: tip, onclick: () => { filter = k; refreshModal(); } }, `${l} (${counts[k]})`))));
      const shown = list.filter(d => printMatches(d, filter));
      const grid = h('div', { class: 'printgrid', 'data-scroll': 'prints' }, shown.map(d => {
        const on = d.sid === pick;
        const el = h('button', { class: 'print' + (on ? ' on' : ''), onclick: () => { pick = d.sid; const fs = d.pr.finishes.length ? d.pr.finishes : ['nonfoil']; if (!fs.includes(fin || 'nonfoil')) fin = fs.includes('nonfoil') ? '' : fs[0]; refreshModal(); } },
          h('div', { class: 'pimgw' + (on && fin ? ' ' + fin : '') }, h('img', { src: d.faces[0].img, alt: d.n })),
          h('div', { class: 'pmeta' },
            h('b', null, d.pr.setName || d.pr.set), h('span', { class: 'muted small' }, [d.pr.year, d.pr.num ? '#' + d.pr.num : '', d.pr.lang && d.pr.lang !== 'en' ? d.pr.lang.toUpperCase() : ''].filter(Boolean).join(' · ')),
            d.n !== entry.d.n ? h('span', { class: 'small' }, d.n) : null,
            d.sid === entry.d.sid ? h('span', { class: 'prtag current' }, 'Your current print') : null,
            h('div', { class: 'tags' }, d.pr.tags.slice(0, 4).map(t => h('span', { class: 'prtag ' + t.k }, t.l)))));
        const fake = { id: 'pp-' + d.sid, d, face: 0, counters: {} };
        el.addEventListener('mouseenter', e => showPreview(fake, e)); el.addEventListener('mouseleave', hidePreview);
        return el;
      }));
      b.append(grid);
      const chosen = list.find(d => d.sid === pick);
      if (chosen) {
        const fins = chosen.pr.finishes.length ? chosen.pr.finishes : ['nonfoil'];
        b.append(h('div', { class: 'row wrap pfoot' },
          h('span', null, 'Finish:'),
          ['', 'foil', 'etched'].filter(f => fins.includes(f === '' ? 'nonfoil' : f)).map(f => h('button', { class: 'chip' + (fin === f ? ' set' : ''), onclick: () => { fin = f; refreshModal(); } }, f === '' ? 'Regular' : f === 'foil' ? 'Foil (holo)' : 'Foil-etched')),
          h('span', { class: 'sp' }),
          h('button', { class: 'primary', onclick: async () => {
            const oldName = entry.d.n;
            entry.d = Object.assign({}, chosen, { fin });
            saveDeck(deck);
            // Already playing this deck? Update the cards in this game right away.
            if (G.P.deckId === deck.id && G.seated()) { const n = await G.applyPrint(oldName, entry.d); G.toast(n ? 'New print saved and shown on the table.' : 'Print saved.'); }
            else G.toast('Print saved.');
            back();
          } }, 'Use this print'),
          h('button', { onclick: back }, 'Cancel')));
      }
    }, { live: true, cls: 'xwide picker', onClose: () => setTimeout(deckManager, 0) });
    load();
  }

  // The commander's artwork only (Scryfall's "art crop" of the chosen print), for sleeves and playmats.
  function cmdArt(deck) {
    const c = deck.cards.find(x => x.cmdr);
    const img = c && c.d.faces && c.d.faces[0] && c.d.faces[0].img;
    return img && /cards\.scryfall\.io\/(normal|large|small|png)\//.test(img) ? img.replace(/\/(normal|large|small|png)\//, '/art_crop/').replace(/\.png(\?|$)/, '.jpg$1') : null;
  }
  function imageCrop(file, kind, deck, saveDeck) {
    const isMat = kind === 'mat';
    if (!file) return;
    const fromUrl = typeof file === 'string';
    const fr = fromUrl ? { readAsDataURL() { this.result = file; this.onload(); } } : new FileReader();
    fr.onload = () => {
      const img = new Image();
      if (fromUrl) img.crossOrigin = 'anonymous';
      img.onload = () => {
        const FW = isMat ? 800 : 250, FH = isMat ? 450 : 350; // card-shaped sleeve, wide playmat
        const base = Math.max(FW / img.width, FH / img.height);
        let zoom = 1, ox = 0, oy = 0;
        const clamp = () => {
          const w = img.width * base * zoom, hgt = img.height * base * zoom;
          ox = Math.min(0, Math.max(FW - w, ox)); oy = Math.min(0, Math.max(FH - hgt, oy));
        };
        ox = (FW - img.width * base) / 2; oy = (FH - img.height * base) / 2;
        openModal(isMat ? 'Adjust your playmat' : 'Adjust your sleeve', b => {
          const cv = h('canvas', { width: FW, height: FH, class: 'cropcv' + (isMat ? ' mat' : '') });
          const draw = () => { clamp(); const x = cv.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, FW, FH); x.drawImage(img, ox, oy, img.width * base * zoom, img.height * base * zoom); };
          let drag = null;
          cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, ox, oy }; cv.setPointerCapture(e.pointerId); });
          cv.addEventListener('pointermove', e => { if (!drag) return; const k = FW / cv.getBoundingClientRect().width; ox = drag.ox + (e.clientX - drag.x) * k; oy = drag.oy + (e.clientY - drag.y) * k; draw(); });
          cv.addEventListener('pointerup', () => drag = null);
          const zs = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', id: 'sleevezoom', oninput: e => {
            const nz = +e.target.value; const cx = FW / 2, cy = FH / 2;
            ox = cx - (cx - ox) * nz / zoom; oy = cy - (cy - oy) * nz / zoom; zoom = nz; draw();
          } });
          b.append(h('div', { class: 'crop' }, cv, h('div', null,
            h('p', null, 'Drag the picture to move it. Use the slider to zoom.'),
            h('label', null, 'Zoom ', zs),
            h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => {
              draw();
              deck[isMat ? 'mat' : 'sleeve'] = cv.toDataURL('image/jpeg', isMat ? 0.62 : 0.8);
              saveDeck(deck);
              G.pushLook(deck);
              deckManager();
            } }, isMat ? 'Save playmat' : 'Save sleeve'), h('button', { onclick: deckManager }, 'Cancel')))));
          draw();
        }, { cls: isMat ? 'wide' : 'small', sticky: true });
      };
      img.onerror = () => G.toast(fromUrl ? 'Couldn’t load the commander’s art from Scryfall. Check your internet and try again.' : 'That picture couldn’t be opened. Try a JPG or PNG.', 'err');
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  // ======================= welcome =======================
  function welcome() {
    const name = G.myName();
    const inp = h('input', { type: 'text', id: 'welcomename', maxlength: '20', placeholder: 'Your name', value: name });
    const go = () => { const n = inp.value.trim(); if (!n) { inp.focus(); return; } G.setMyName(n); G.wantSeat = true; G.start(n); render(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    setTimeout(() => inp.focus(), 50);
    return h('div', { class: 'welcome' }, h('div', { class: 'wcard' },
      h('h1', null, 'Kitchen Table'),
      h('p', null, 'Play Magic with your friends. Everyone opens this same link.'),
      h('div', { class: 'row' }, inp, h('button', { class: 'primary', onclick: go }, 'Join the table')),
      h('p', { class: 'muted small' }, 'Card pictures and data come from Scryfall.')));
  }

  // ======================= swipe between screens (phones) =======================
  if (COARSE) {
    let sx = 0, sy = 0, st = null;
    document.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = e.target; }, { passive: true });
    document.addEventListener('touchend', e => {
      if (G.MODE === 'hand' || modal || menu) return;
      const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      if (!st || !st.closest || !st.closest('#main')) return;
      const strip = st.closest('.strip');
      if (strip && (dx < 0 ? strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 4 : strip.scrollLeft > 4)) return;
      const tabs = [...document.querySelectorAll('#tabs button')];
      const i = tabs.findIndex(b => b.classList.contains('on'));
      const next = tabs[i + (dx < 0 ? 1 : -1)];
      if (next) { next.click(); const m = $('#main'); if (m) { m.classList.add(dx < 0 ? 'slide-l' : 'slide-r'); } }
    }, { passive: true });
  }

  // ======================= render =======================
  const root = document.getElementById('app');
  document.body.append(prev, h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }));

  function render() {
    if (G.MODE === 'hand') return KTPhone.render();
    if (G.replaced) { root.replaceChildren(h('div', { class: 'welcome' }, h('div', { class: 'wcard' }, h('h1', null, 'Kitchen Table'),
      h('p', null, G.replaced === 'host' ? 'You’re already at this table in another tab or window of this browser.' : 'This table is open in another tab or window on this device, so this one stopped.'),
      h('p', null, 'Want a second player on this computer? Join as a different player in this tab.'),
      h('div', { class: 'wbtns' },
        h('button', { class: 'primary', onclick: () => G.newTabPlayer() }, 'Join as a different player'),
        G.replaced === 'host' ? null : h('button', { onclick: () => location.reload() }, 'Play here instead'))))); return; }
    if (!G.table) { root.replaceChildren(welcome()); return; }
    if (!S()) { root.replaceChildren(h('div', { class: 'welcome' }, h('div', { class: 'wcard' }, h('h1', null, 'Kitchen Table'), h('p', null, G.statusMsg || 'Connecting to the table…')))); return; }
    if (G.wantSeat && !G.me() && (G.status === 'host' || G.status === 'connected') && !G.seatBusy) {
      if (S().seats.length < R.MAX_SEATS) {
        G.seatBusy = true;
        G.act({ type: 'join', name: (G.myName() || 'Player') }).then(r => { G.seatBusy = false; if (r.ok || r.kicked) G.wantSeat = false; else setTimeout(render, 2000); });
      } else { G.wantSeat = false; G.toast('The table is full (6 players). You can watch.', 'err'); }
    }
    // keep scroll positions
    const scrolls = {};
    root.querySelectorAll('[data-scroll]').forEach(el => scrolls[el.dataset.scroll] = [el.scrollLeft, el.scrollTop]);
    const bars = [winBar(), pickBar(), prioBar(), G.picking || S().winner ? null : combatBar()].filter(Boolean);
    const main = h('main', { id: 'main' }, bars.length ? h('div', { class: 'bars-top' }, bars) : null, stackStrip(), mainView());
    const view = h('div', { class: 'app' + (G.logOpen || G.aiOpen ? ' withlog' : '') + (COARSE ? ' touch' : '') },
      topBar(), tabsBar(),
      G.targeting ? h('div', { class: 'target' }, `Click the card to attach ${G.targeting.name} to — Esc to cancel `, h('button', { onclick: () => { G.targeting = null; render(); } }, 'Cancel')) : null,
      main, G.aiOpen ? aiPanel() : logPanel(), handBar(), mulliganPanel());
    const ae = document.activeElement, aeId = ae && ae.id && root.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) ? ae.id : null;
    const sel = aeId && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;
    root.replaceChildren(view);
    if (aeId) { const ne = document.getElementById(aeId); if (ne && ne !== document.activeElement) { ne.focus({ preventScroll: true }); if (sel && ne.setSelectionRange) try { ne.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
    fitTop();
    // Toasts sit just above the hand, so they never cover the prompts at the top of the table.
    const hb = document.getElementById('hand'); if (hb) document.documentElement.style.setProperty('--toastb', (hb.offsetHeight + 14) + 'px');
    root.querySelectorAll('[data-scroll]').forEach(el => { const s = scrolls[el.dataset.scroll]; if (s) { el.scrollLeft = s[0]; el.scrollTop = s[1]; } });
    refreshModal();
    recheckPreview();
  }
  // Keep the top bar on one line: fold the least-used buttons into ⋯ one group at a time until everything fits.
  function fitTop() {
    const top = document.getElementById('top'); if (!top || top.classList.contains('compact')) { G.topFit = 0; return; }
    const turn = top.querySelector('.turn');
    const over = () => top.scrollWidth > top.clientWidth + 1 || (turn && turn.scrollWidth > turn.clientWidth + 1);
    let lvl = 0;
    while (lvl < 5 && over()) { lvl++; top.classList.add('fit' + lvl); }
    G.topFit = lvl;
  }
  let fitT = null;
  addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => { if (S()) render(); }, 120); });
  // Redraw at most once per frame, and not while a mouse button / finger is down (so clicks aren't lost
  // when another player's move arrives mid-click).
  let rq = false, held = false, owed = false;
  addEventListener('pointerdown', () => { held = true; }, true);
  const release = () => { held = false; if (owed) { owed = false; G.render(); } };
  addEventListener('pointerup', () => setTimeout(release, 0), true);
  addEventListener('pointercancel', release, true);
  // While someone is typing, redraws wait until they leave the box: rebuilding it would close a phone's keyboard.
  // (On a computer, boxes on the table itself are redrawn with the cursor put back; boxes in a window always wait.)
  const typingNow = () => { const a = document.activeElement; return !!a && document.body.contains(a) && (COARSE || !!a.closest('.overlay')) && (a.tagName === 'TEXTAREA' || a.isContentEditable || (a.tagName === 'INPUT' && /^(text|search|number|email|url|tel|password)$/i.test(a.type))); };
  addEventListener('focusout', () => setTimeout(() => { if (owed && !held && !typingNow()) { owed = false; G.render(); } }, 0), true);
  G.render = () => {
    if (held || typingNow()) { owed = true; return; }
    if (rq) return;
    rq = true;
    // Animation frames pause while the page can't be seen; the timer keeps the table moving (joining, auto-pass…).
    const go = () => { if (!rq) return; rq = false; render(); };
    requestAnimationFrame(go); setTimeout(go, 160);
  };
  G.renderNow = render;
  G.ui = { h, cardEl, openMenu, closeMenu, openModal, closeModal, BACK, sleeveOf };

  // Boot (after this browser's identity has loaded)
  G.ready.then(() => {
    KEY = G.KEY;
    if (G.MODE === 'table' && G.myName()) { G.wantSeat = true; G.start(G.myName()); }
    if (G.MODE === 'table') setTimeout(() => myAIs().forEach(spawnAI), 1500);   // AI players I added come back with me
    render();
  }).catch(err => {
    root.replaceChildren(h('div', { class: 'welcome' }, h('div', { class: 'wcard' }, h('h1', null, 'Kitchen Table'),
      h('p', null, 'This browser couldn’t start the game. Open the site from its https:// link (not a saved file) and try again.'), h('p', { class: 'muted small' }, String(err && err.message || err)))));
  });
})();
