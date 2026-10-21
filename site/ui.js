// Kitchen Table — everything you see and click.
(function () {
  'use strict';
  const G = window.KT, R = Rules;
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
    const t = h('div', { class: 'toast ' + (kind || '') }, text);
    box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, kind === 'err' ? 5200 : kind === 'alert' ? 8000 : 3800);
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
    if (COARSE || !e) return;
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
    if (c.token) el.append(h('div', { class: 'tag tok' }, 'Token'));
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
        !c.faceDown ? { label: 'Cast it (I control the spell)', fn: () => G.move([c.id], 'stack') } : null
      ];
      return [{ note: c.zone === 'stack' ? `${nameOf(c.ctrl)} controls this spell.` : `This card belongs to ${nameOf(c.owner)}.` }];
    }
    if (c.zone === 'command') {
      const tax = 2 * ((S().tax || {})[c.id] || 0);
      return [
        { label: `Cast (to the stack) — tax {${tax}}`, fn: () => G.move([c.id], 'stack') },
        { label: 'Put onto the battlefield (no tax)', fn: () => G.move([c.id], 'battlefield') },
        { sep: true },
        { label: 'Move to', sub: moveSub(c).filter(Boolean) }
      ];
    }
    const two = c.d && c.d.faces && c.d.faces.length > 1;
    const items = [];
    if (c.zone === 'battlefield') {
      items.push({ label: c.tapped ? 'Untap' : 'Tap', fn: () => G.tap([c.id], !c.tapped) });
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
      const perm = /\b(creature|artifact|enchantment|planeswalker|land|battle)\b/i.test(R.typeLine(c));
      items.push({ label: perm ? 'Resolve (onto the battlefield)' : 'Resolve (to the graveyard)', fn: perm ? mv(c, 'battlefield') : mv(c, 'graveyard') });
      items.push({ label: 'Counter it (to the graveyard)', fn: mv(c, 'graveyard') });
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
    return [
      { label: land ? 'Play land' : 'Put onto the battlefield', fn: () => G.fromHand([c.id], 'battlefield') },
      { label: 'Put onto the battlefield tapped', fn: () => G.fromHand([c.id], 'battlefield', { tapped: true }) },
      !land ? { label: 'Cast (put on the stack)', fn: () => G.fromHand([c.id], 'stack') } : null,
      two ? { label: `Play the back face (${c.d.faces[1].n})`, fn: () => G.fromHand([c.id], 'battlefield', { backFace: true }) } : null,
      { label: 'Play face down (morph, manifest…)', fn: () => G.fromHand([c.id], 'battlefield', { faceDown: true }) },
      { label: G.isRevealed(c.id) ? 'Stop revealing' : 'Reveal to everyone', fn: () => G.toggleReveal(c.id) },
      { sep: true },
      { label: 'Move to', sub: [
        { label: 'Graveyard (discard)', fn: () => G.fromHand([c.id], 'graveyard') },
        { label: 'Exile', fn: () => G.fromHand([c.id], 'exile') },
        { label: 'Exile face down', fn: () => G.fromHand([c.id], 'exile', { faceDown: true }) },
        { label: 'Top of library', fn: () => G.handToLibrary([c.id], 'top') },
        { label: 'Bottom of library', fn: () => G.handToLibrary([c.id], 'bottom') },
        { label: 'Shuffle into library', fn: () => G.handToLibrary([c.id], 'shuffle') },
        { label: 'Command zone', fn: () => G.fromHand([c.id], 'command') }
      ] }
    ];
  }

  // Attach targeting
  function startTarget(c) { G.targeting = { id: c.id, name: R.cardName(c) }; render(); }
  function finishTarget(t) {
    const tg = G.targeting; G.targeting = null;
    if (t.zone !== 'battlefield') { G.toast('Pick a card on the battlefield.', 'err'); render(); return; }
    G.attach(tg.id, t.id); render();
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
    const tools = h('div', { class: 'tools' },
      me ? h('button', { onclick: e => openMenu(e.currentTarget, newGameMenu(), 'Start over') }, 'New game ▾') : null,
      h('button', { onclick: () => deckManager() }, 'Decks'),
      me ? h('button', { onclick: () => tokenModal() }, 'Tokens') : null,
      me ? h('button', { onclick: e => openMenu(e.currentTarget, [2, 4, 6, 8, 10, 12, 20].map(n => ({ label: n === 2 ? 'Flip a coin' : 'Roll a d' + n, fn: () => G.act({ type: 'dice', sides: n }) })).concat([{ label: 'Roll any die…', fn: () => askNumber('How many sides?', 100, n => G.act({ type: 'dice', sides: n }), 1000) }]), 'Dice & coin') }, 'Dice') : null,
      h('button', { class: G.logOpen ? 'on' : '', onclick: () => { G.logOpen = !G.logOpen; render(); } }, 'Log', unread && !G.logOpen ? h('span', { class: 'badge' }, String(Math.min(unread, 99))) : null),
      h('button', { class: 'invite', onclick: inviteModal, title: 'Invite players to this table' }, 'Invite'),
      me ? h('button', { class: G.phoneLinked ? 'on' : '', onclick: phoneModal, title: 'Use your phone as your hand' }, G.phoneLinked ? 'Phone ✓' : 'Phone') : null,
      h('button', { title: 'More', onclick: e => openMenu(e.currentTarget, moreMenu(), 'Table') }, '⋯')
    );
    if (COARSE) {
      const all = () => [
        { label: 'Invite players', fn: inviteModal },
        me ? { label: 'New game ▸', sub: newGameMenu() } : null,
        { label: 'Decks', fn: () => deckManager() },
        me ? { label: 'Tokens', fn: () => tokenModal() } : null,
        me ? { label: 'Dice & coin ▸', sub: [2, 6, 20].map(n => ({ label: n === 2 ? 'Flip a coin' : 'Roll a d' + n, fn: () => G.act({ type: 'dice', sides: n }) })) } : null,
        { label: `Log${unread ? ' (' + Math.min(unread, 99) + ' new)' : ''}`, fn: () => { G.logOpen = !G.logOpen; render(); } },
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
    return [
      { label: 'Invite players…', fn: inviteModal },
      me ? { label: 'Change my name…', fn: nameModal } : { label: 'Take a seat', fn: nameModal },
      me ? { label: 'Untap everything I control', fn: untapAll } : null,
      { sep: true },
      me ? { label: 'Leave my seat…', fn: () => choose('Leave seat', 'Your cards leave the table.', [{ label: 'Leave', primary: true, fn: () => G.act({ type: 'leave' }) }, { label: 'Cancel', fn: () => {} }]) } : null,
      ...s.seats.filter(p => !s.players[p].online && p !== KEY).map(p => ({ label: `Remove ${nameOf(p)} (offline)`, fn: () => G.act({ type: 'removeSeat', pid: p }) })),
      { sep: true },
      { label: 'Open a different table…', fn: tableModal }
    ];
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
    const bar = h('div', { class: 'pbar' },
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
    return h('section', { class: 'board' + (compact ? ' compact' : '') + (s.turn.active === pid ? ' active' : '') + (L.mat ? ' hasmat' : ''), style: boardStyle(pid) },
      playerBar(pid, compact), revealedStrip(pid),
      h('div', { class: 'field' }, cmdCol(pid), rowsEl(pid, compact), pileCol(pid)));
  }

  function stackStrip() {
    const st = Object.values(S().cards).filter(c => c.zone === 'stack').sort((a, b) => a.seq - b.seq);
    if (!st.length) return null;
    return h('div', { id: 'stack' }, h('div', { class: 'rlabel' }, 'Stack', h('span', null, 'top →')),
      h('div', { class: 'strip', 'data-scroll': 'stack' }, st.map(c => h('div', { class: 'stk' }, cardEl(c), h('div', { class: 'by' }, nameOf(c.ctrl))))));
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
        const el = cardEl(pc, { menu: () => handMenu(c), cls: G.isRevealed(c.id) ? 'rev' : '', swipeUp: () => G.fromHand([c.id], 'battlefield') });
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

  function lookModal(mode, x) {
    const top = G.P.library.slice(0, x);
    const order = top.map(c => ({ id: c.id, dest: 'top' }));
    const dests = mode === 'scry' ? ['top', 'bottom'] : mode === 'surveil' ? ['top', 'graveyard'] : ['top', 'bottom', 'hand', 'graveyard', 'exile', 'battlefield'];
    const DL = { top: 'Top', bottom: 'Bottom', hand: 'Hand', graveyard: 'Graveyard', exile: 'Exile', battlefield: 'Battlefield' };
    const title = mode === 'scry' ? `Scry ${x}` : mode === 'surveil' ? `Surveil ${x}` : `Top ${plural(x, 'card')} of your library`;
    let applied = false;
    const apply = () => { if (applied) return; applied = true; closeModal(true); G.applyLook(mode, x, order); };
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
      const inp = h('input', { type: 'search', id: 'libsearch', placeholder: 'Filter by name or type', value: q, oninput: e => { q = e.target.value; refreshModal(); const i = $('#libsearch'); i.focus(); i.setSelectionRange(q.length, q.length); } });
      const cards = G.P.library.filter(c => !q || (c.d.n + ' ' + c.d.faces[0].t).toLowerCase().includes(q.toLowerCase()))
        .slice().sort((a, b2) => a.d.n.localeCompare(b2.d.n));
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
        h('b', { class: 'big' }, String(p[key])),
        mine ? steps.map(n => h('button', { onclick: () => G.act({ type: 'player', patch: { [key]: p[key] + n } }) }, (n > 0 ? '+' : '') + n)).slice(steps.length / 2) : null);
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
    let acQ = '', acList = [], acBusy = false, importMsg = '', pasteOpen = false;
    let acT = null;
    const saveDeck = deck => { const all = G.decks(); const i = all.findIndex(d => d.id === deck.id); deck.updated = Date.now(); if (i >= 0) all[i] = deck; else all.unshift(deck); G.saveDecks(all); };
    openModal('Decks', b => {
      const all = G.decks();
      const deck = all.find(d => d.id === editing) || null;
      const list = h('div', { class: 'decklist' },
        h('button', { class: 'primary', onclick: () => { const d = { id: G.R.rid(8), name: 'New deck', cards: [], sleeve: null }; saveDeck(d); editing = d.id; refreshModal(); } }, '+ New deck'),
        h('label', { class: 'import' }, 'Import from ManaBox (.txt or .csv)',
          h('input', { type: 'file', accept: '.csv,.txt,text/csv,text/plain', id: 'importfile', onchange: e => importFile(e.target.files[0]) })),
        h('button', { class: 'ghost small', onclick: () => { pasteOpen = !pasteOpen; refreshModal(); } }, pasteOpen ? 'Close paste box' : 'Or paste a deck list'),
        pasteOpen ? h('div', { class: 'paste' },
          h('textarea', { id: 'pastebox', rows: '8', placeholder: '// COMMANDER\n1 Alesha, Who Smiles at Death (FRF) 90\n\n1 Sol Ring (C21) 263\n30 Plains' }),
          h('button', { class: 'primary', onclick: () => { const t = $('#pastebox').value; if (t.trim()) { pasteOpen = false; importText(t, 'Pasted deck'); } } }, 'Import list')) : null,
        importMsg ? h('p', { class: 'muted small' }, importMsg) : null,
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
          acT = setTimeout(async () => { acBusy = true; try { acList = await Scry.autocomplete(acQ); } catch (err) { acList = []; G.toast('Couldn’t reach Scryfall.', 'err'); } acBusy = false; refreshModal(); const i = $('#cardsearch'); if (i) { i.focus(); i.setSelectionRange(acQ.length, acQ.length); } }, 250);
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
        const ac = acList.length ? h('div', { class: 'ac' }, acList.slice(0, 12).map(n => h('button', { onclick: () => addName(n) }, n))) : null;

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
          h('div', { class: 'acwrap' }, search, acBusy ? h('span', { class: 'muted small' }, ' searching…') : null, ac),
          commanderPanel(deck, saveDeck),
          h('div', { class: 'looks' },
            h('div', { class: 'sleeve' }, h('img', { src: deck.sleeve || BACK, alt: 'Sleeve' }),
              h('div', null, h('b', null, 'Sleeve'), h('p', { class: 'muted small' }, 'On your library and face-down cards.'),
                h('label', { class: 'btnlike' }, deck.sleeve ? 'Change' : 'Upload', h('input', { type: 'file', accept: 'image/*', id: 'sleevefile', onchange: e => imageCrop(e.target.files[0], 'sleeve', deck, saveDeck) })),
                deck.sleeve ? h('button', { class: 'ghost', onclick: () => { deck.sleeve = null; saveDeck(deck); G.pushLook(deck); refreshModal(); } }, 'Remove') : null)),
            h('div', { class: 'sleeve matrow' },
              h('div', { class: 'matprev', style: boardStyle0(deck) }),
              h('div', null, h('b', null, 'Playmat'), h('p', { class: 'muted small' }, 'Shows behind your side of the table for everyone.'),
                h('label', { class: 'btnlike' }, deck.mat ? 'Change' : 'Upload', h('input', { type: 'file', accept: 'image/*', id: 'matfile', onchange: e => imageCrop(e.target.files[0], 'mat', deck, saveDeck) })),
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

  function imageCrop(file, kind, deck, saveDeck) {
    const isMat = kind === 'mat';
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
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
      img.onerror = () => G.toast('That picture couldn’t be opened. Try a JPG or PNG.', 'err');
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
        G.act({ type: 'join', name: (G.myName() || 'Player') }).then(r => { G.seatBusy = false; if (r.ok) G.wantSeat = false; else setTimeout(render, 2000); });
      } else { G.wantSeat = false; G.toast('The table is full (6 players). You can watch.', 'err'); }
    }
    // keep scroll positions
    const scrolls = {};
    root.querySelectorAll('[data-scroll]').forEach(el => scrolls[el.dataset.scroll] = [el.scrollLeft, el.scrollTop]);
    const main = h('main', { id: 'main' }, stackStrip(), mainView());
    const view = h('div', { class: 'app' + (G.logOpen ? ' withlog' : '') + (COARSE ? ' touch' : '') },
      topBar(), tabsBar(),
      G.targeting ? h('div', { class: 'target' }, `Click the card to attach ${G.targeting.name} to — Esc to cancel `, h('button', { onclick: () => { G.targeting = null; render(); } }, 'Cancel')) : null,
      main, logPanel(), handBar(), mulliganPanel());
    root.replaceChildren(view);
    root.querySelectorAll('[data-scroll]').forEach(el => { const s = scrolls[el.dataset.scroll]; if (s) { el.scrollLeft = s[0]; el.scrollTop = s[1]; } });
    refreshModal();
    recheckPreview();
  }
  // Redraw at most once per frame, and not while a mouse button / finger is down (so clicks aren't lost
  // when another player's move arrives mid-click).
  let rq = false, held = false, owed = false;
  addEventListener('pointerdown', () => { held = true; }, true);
  const release = () => { held = false; if (owed) { owed = false; G.render(); } };
  addEventListener('pointerup', () => setTimeout(release, 0), true);
  addEventListener('pointercancel', release, true);
  G.render = () => {
    if (held) { owed = true; return; }
    if (rq) return;
    rq = true;
    requestAnimationFrame(() => { rq = false; render(); });
  };
  G.renderNow = render;
  G.ui = { h, cardEl, openMenu, closeMenu, openModal, closeModal, BACK, sleeveOf };

  // Boot (after this browser's identity has loaded)
  G.ready.then(() => {
    KEY = G.KEY;
    if (G.MODE === 'table' && G.myName()) { G.wantSeat = true; G.start(G.myName()); }
    render();
  }).catch(err => {
    root.replaceChildren(h('div', { class: 'welcome' }, h('div', { class: 'wcard' }, h('h1', null, 'Kitchen Table'),
      h('p', null, 'This browser couldn’t start the game. Open the site from its https:// link (not a saved file) and try again.'), h('p', { class: 'muted small' }, String(err && err.message || err)))));
  });
})();
