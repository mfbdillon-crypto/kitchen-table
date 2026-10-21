// Scryfall card lookups + ManaBox CSV import.
(function (root) {
  'use strict';
  const API = 'https://api.scryfall.com';
  let last = 0;
  const cache = new Map();

  // Scryfall asks for no more than ~10 requests a second.
  async function get(path, opts) {
    const wait = Math.max(0, last + 110 - Date.now());
    last = Date.now() + wait;
    if (wait) await new Promise(r => setTimeout(r, wait));
    const res = await fetch(API + path, Object.assign({ headers: { Accept: 'application/json' } }, opts || {}));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(body.details || ('Scryfall error ' + res.status)); e.status = res.status; throw e; }
    return body;
  }

  const oracleOf = c => c.card_faces && !c.oracle_text ? c.card_faces.map(f => f.oracle_text || '').join('\n') : (c.oracle_text || '');
  function img(o) { return o && o.image_uris ? (o.image_uris.normal || o.image_uris.large || o.image_uris.small || '') : ''; }

  // Turn a Scryfall card into the small record the game uses.
  function toD(c) {
    const faces = [];
    if (c.card_faces && c.card_faces.length >= 2 && !c.image_uris) {
      // Transforming / modal double-faced cards: two pictures.
      for (const f of c.card_faces.slice(0, 2)) faces.push({ n: f.name, t: f.type_line || '', img: img(f), p: f.power || '', tg: f.toughness || '', loy: f.loyalty || '', def: f.defense || '', mc: f.mana_cost || '', o: f.oracle_text || '' });
    } else {
      const f0 = (c.card_faces && c.card_faces[0]) || {};
      faces.push({
        n: c.name, t: c.type_line || f0.type_line || '', img: img(c) || img(f0),
        p: c.power || f0.power || '', tg: c.toughness || f0.toughness || '', loy: c.loyalty || f0.loyalty || '', def: c.defense || f0.defense || '',
        mc: c.mana_cost || f0.mana_cost || '', o: oracleOf(c)
      });
    }
    return { n: c.name, sid: c.id, oid: c.oracle_id || (c.card_faces && c.card_faces[0] && c.card_faces[0].oracle_id) || '', cmc: c.cmc || 0, faces,
      kw: c.keywords || [], pm: c.produced_mana || [], ci: c.color_identity || [] };
  }
  // Older saved decks don't have rules text: look it up once (by printing id, then name) and fill it in.
  async function enrich(ds, onProgress) {
    const need = ds.filter(d => d && d.faces && d.faces[0] && d.faces[0].o === undefined);
    if (!need.length) return 0;
    const ids = [...new Set(need.map(d => d.sid).filter(Boolean))];
    const byId = new Map(), byName = new Map();
    try {
      const r = await collection(ids.map(id => ({ id })), onProgress);
      for (const c of r.cards) { byId.set(c.id, c); byName.set(c.name.toLowerCase(), c); }
      const left = need.filter(d => !byId.has(d.sid) && !byName.has(d.n.toLowerCase()));
      if (left.length) { const r2 = await collection([...new Set(left.map(d => d.n.split(' // ')[0]))].map(name => ({ name }))); for (const c of r2.cards) byName.set(c.name.toLowerCase(), c), byName.set(c.name.split(' // ')[0].toLowerCase(), c); }
    } catch (e) { return -1; }
    let n = 0;
    for (const d of need) {
      const c = byId.get(d.sid) || byName.get(d.n.toLowerCase()) || byName.get(d.n.split(' // ')[0].toLowerCase());
      if (!c) { d.faces.forEach(f => { if (f.o === undefined) f.o = ''; }); continue; }
      const fresh = toD(c);
      d.faces.forEach((f, i) => { const g = fresh.faces[i] || fresh.faces[0]; f.o = g.o || ''; if (!f.mc) f.mc = g.mc; });
      d.kw = fresh.kw; d.pm = fresh.pm; d.ci = fresh.ci;
      n++;
    }
    return n;
  }

  // ---------- printings ----------
  // What makes a printing special, as short labels people recognize.
  function printTags(c) {
    const t = [];
    const fe = c.frame_effects || [], pt = c.promo_types || [];
    if (c.flavor_name) t.push({ k: 'reskin', l: `Reskin: “${c.flavor_name}”` });
    if (c.security_stamp === 'triangle' || /universes beyond/i.test(c.set_name || '')) t.push({ k: 'ub', l: 'Universes Beyond' });
    if (c.full_art) t.push({ k: 'full', l: 'Full art' });
    if (c.border_color === 'borderless') t.push({ k: 'borderless', l: 'Borderless' });
    if (fe.includes('showcase')) t.push({ k: 'showcase', l: 'Showcase' });
    if (fe.includes('extendedart')) t.push({ k: 'extended', l: 'Extended art' });
    if (fe.includes('inverted') || fe.includes('etched')) t.push({ k: 'frame', l: fe.includes('etched') ? 'Etched frame' : 'Inverted frame' });
    if (c.frame === '1993' || c.frame === '1997') t.push({ k: 'retro', l: 'Retro frame' });
    if (c.textless) t.push({ k: 'full', l: 'Textless' });
    if (c.promo || pt.length) t.push({ k: 'promo', l: pt.includes('serialized') ? 'Serialized' : pt.includes('prerelease') ? 'Prerelease promo' : 'Promo' });
    for (const p of pt) {
      const m = { textured: 'Textured foil', galaxyfoil: 'Galaxy foil', surgefoil: 'Surge foil', halofoil: 'Halo foil', confettifoil: 'Confetti foil', gilded: 'Gilded foil', stepandcompleat: 'Step-and-compleat foil', oilslick: 'Oil slick foil', neonink: 'Neon ink', rainbowfoil: 'Rainbow foil', raisedfoil: 'Raised foil', fracturefoil: 'Fracture foil', ripplefoil: 'Ripple foil', manafoil: 'Mana foil', firstplacefoil: 'First-place foil', doublerainbow: 'Double rainbow foil' }[p];
      if (m) t.push({ k: 'foil', l: m });
    }
    return t;
  }
  function printInfo(c) {
    return {
      set: (c.set || '').toUpperCase(), setName: c.set_name || '', num: c.collector_number || '',
      year: (c.released_at || '').slice(0, 4), date: c.released_at || '', lang: c.lang || 'en',
      finishes: (c.finishes || []).filter(f => ['nonfoil', 'foil', 'etched'].includes(f)),
      tags: printTags(c), artist: c.artist || ''
    };
  }
  async function searchAll(q, maxPages) {
    const out = [];
    let url = '/cards/search?q=' + encodeURIComponent(q) + '&unique=prints&include_extras=true&order=released&dir=desc';
    for (let page = 0; page < (maxPages || 3) && url; page++) {
      let r;
      try { r = await get(url); } catch (e) { if (e.status === 404) break; throw e; }
      out.push(...(r.data || []));
      url = r.has_more && r.next_page ? r.next_page.replace(API, '') : null;
    }
    return out;
  }
  const norm = (txt, names) => {
    let t = String(txt || '').toLowerCase();
    for (const n of names) if (n) t = t.split(n.toLowerCase()).join('~');
    return t.replace(/\s+/g, ' ').trim();
  };
  const shortName = n => n.split(' // ')[0].split(',')[0];
  // Every printing of a card (same rules text, any name — includes "Universes Beyond" reskins that were
  // given new names), newest first, ignoring online-only versions.
  async function prints(d) {
    const k = 'pr:' + (d.oid || d.n); if (cache.has(k)) return cache.get(k);
    const base = await get('/cards/named?exact=' + encodeURIComponent(d.n.split(' // ')[0]));
    const oid = base.oracle_id || (base.card_faces && base.card_faces[0].oracle_id);
    let list = await searchAll(`oracleid:${oid}`, 3);
    // Same card under another name (e.g. Universes Beyond / Universes Within versions): same cost, types,
    // power/toughness and rules text once the names are swapped out.
    let others = [];
    try {
      const parts = [`mv=${base.cmc || 0}`, `-oracleid:${oid}`];
      const tl = (base.type_line || '').split(' // ')[0].split(' — ')[0].toLowerCase().split(' ').filter(w => w && w !== '//');
      for (const w of tl) parts.push('t:' + w);
      if (base.power !== undefined) parts.push(`pow=${base.power}`, `tou=${base.toughness}`);
      const ci = (base.color_identity || []).join('').toLowerCase() || 'c';
      parts.push(`id=${ci}`);
      const want = norm(oracleOf(base), [base.name, shortName(base.name)]);
      const cand = await searchAll(parts.join(' '), 2);
      others = cand.filter(c => want && norm(oracleOf(c), [c.name, shortName(c.name)]) === want && (c.type_line || '').toLowerCase() === (base.type_line || '').toLowerCase());
    } catch (e) {}
    const all = list.concat(others).filter(c => !c.digital && (c.image_uris || (c.card_faces && c.card_faces[0].image_uris)));
    const out = all.map(c => { const x = toD(c); x.pr = printInfo(c); if (c.name !== base.name) x.pr.tags.unshift({ k: 'reskin', l: `Same card as ${base.name}` }); return x; })
      .sort((a, b) => (b.pr.date || '').localeCompare(a.pr.date || ''));
    cache.set(k, out);
    return out;
  }

  async function autocomplete(q) {
    q = q.trim(); if (q.length < 2) return [];
    const k = 'ac:' + q.toLowerCase(); if (cache.has(k)) return cache.get(k);
    const r = await get('/cards/autocomplete?q=' + encodeURIComponent(q));
    cache.set(k, r.data || []); return r.data || [];
  }

  async function named(name) {
    const k = 'n:' + name.toLowerCase(); if (cache.has(k)) return cache.get(k);
    const c = await get('/cards/named?exact=' + encodeURIComponent(name));
    const d = toD(c); cache.set(k, d); return d;
  }

  async function search(q, extra) {
    const r = await get('/cards/search?q=' + encodeURIComponent(q) + (extra || ''));
    return (r.data || []).map(toD);
  }

  async function tokens(term) {
    term = term.trim();
    const q = (term ? term + ' ' : '') + 't:token';
    try { return (await search(q, '&unique=art&order=name')).slice(0, 60); }
    catch (e) { if (e.status === 404) return []; throw e; }
  }

  // Look up many cards at once (75 per request).
  async function collection(idents, onProgress) {
    const out = [], missing = [];
    for (let i = 0; i < idents.length; i += 75) {
      const chunk = idents.slice(i, i + 75);
      const r = await get('/cards/collection', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiers: chunk }) });
      out.push(...(r.data || []));
      missing.push(...(r.not_found || []));
      if (onProgress) onProgress(Math.min(idents.length, i + 75), idents.length);
    }
    return { cards: out, missing };
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }

  // Reads a ManaBox export (CSV) — or a plain "1 Sol Ring" text list — into lines to look up.
  function parseDeckFile(text) {
    const rows = parseCSV(text);
    const head = (rows[0] || []).map(h => h.trim().toLowerCase());
    const col = (...names) => head.findIndex(h => names.includes(h));
    const iName = col('name', 'card name', 'card');
    // ManaBox CSV columns: Binder Name, Binder Type, Name, Set code, Set name, Collector number, Foil, Rarity,
    // Quantity, ManaBox ID, Scryfall ID, Purchase price, Misprint, Altered, Condition, Language, Purchase price currency
    if (iName >= 0 && rows.length > 1) {
      const iQty = col('quantity', 'qty', 'count', 'amount');
      const iId = col('scryfall id', 'scryfall_id', 'scryfallid');
      const iSet = col('set code', 'set', 'edition code');
      const iNum = col('collector number', 'collector_number', 'number');
      const iBoard = col('board', 'section', 'category', 'zone', 'deck section');
      const lines = [];
      for (const r of rows.slice(1)) {
        const name = (r[iName] || '').trim(); if (!name) continue;
        const board = iBoard >= 0 ? (r[iBoard] || '').toLowerCase() : '';
        if (/maybe|side|consider|wish/.test(board)) continue;
        lines.push({
          name, qty: Math.max(1, parseInt(iQty >= 0 ? r[iQty] : '1', 10) || 1),
          id: iId >= 0 ? (r[iId] || '').trim() : '', set: iSet >= 0 ? (r[iSet] || '').trim().toLowerCase() : '',
          num: iNum >= 0 ? (r[iNum] || '').trim() : '', cmdr: /commander/.test(board)
        });
      }
      return lines;
    }
    // Text export (ManaBox "Export", MTG Arena, Moxfield…):
    //   // COMMANDER
    //   1 Niv-Mizzet, Visionary (FDN) 350
    //   <blank line>
    //   1 Counterspell (DSC) 114
    //   1 Jace, Ingenious Mind-Mage (XLN) 280 *F*
    //   // SIDEBOARD   // MAYBEBOARD   (skipped)
    const lines = [];
    let section = 'main';
    const HEAD = /^(?:\/\/\s*)?([a-z][a-z ]*?)\s*:?\s*(?:\(\d+\))?$/i;
    for (const raw of text.split(/\r?\n/)) {
      const l = raw.trim();
      if (!l) { if (section === 'commander') section = 'main'; continue; }   // a blank line ends the commander section
      // Only known section names count as headings — a bare card name like "Sol Ring" is a card, not a heading.
      const SECTIONS = /^(?:\/\/\s*)?(commanders?|deck|main|mainboard|main deck|library|sideboard|maybeboard|maybe|considering|tokens?|companion|wishboard|attractions?|stickers?|creatures?|lands?|instants?|sorcery|sorceries|artifacts?|enchantments?|planeswalkers?|battles?|other)\s*:?\s*(?:\(\d+\))?$/i;
      const hm = SECTIONS.test(l) || (l.startsWith('//') && HEAD.test(l)) ? l.match(HEAD) : null;
      if (hm) {
        const w = hm[1].toLowerCase().trim();
        if (/^commanders?$/.test(w)) section = 'commander';
        else if (/^(deck|main|mainboard|main deck|library|creatures?|lands?|instants?|sorcery|sorceries|artifacts?|enchantments?|planeswalkers?|battles?|other)$/.test(w)) section = 'main';
        else if (/^(sideboard|maybeboard|maybe|considering|tokens?|companion|wishboard|attractions?|stickers?)$/.test(w)) section = 'skip';
        continue;
      }
      if (l.startsWith('//') || l.startsWith('#')) continue;
      if (section === 'skip') continue;
      const m = l.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]{2,8})\)(?:\s+([^\s*]+))?)?(?:\s+\*[A-Za-z]+\*)*\s*$/);
      if (m) lines.push({ name: m[2].trim(), qty: +m[1], set: (m[3] || '').toLowerCase(), num: m[4] || '', id: '', cmdr: section === 'commander' });
      else lines.push({ name: l.replace(/\s+\*[A-Za-z]+\*$/, ''), qty: 1, set: '', num: '', id: '', cmdr: section === 'commander' });
    }
    return lines;
  }

  // Look every line up on Scryfall, keeping the deck's order (so commanders stay first).
  async function resolveLines(lines, onProgress) {
    const ident = l => l.id ? { id: l.id } : (l.set && l.num) ? { set: l.set, collector_number: l.num } : { name: l.name.split(' // ')[0] };
    const { cards } = await collection(lines.map(ident), onProgress);
    const byId = new Map(), bySetNum = new Map(), byName = new Map();
    const index = c => {
      byId.set(c.id, c); bySetNum.set(c.set + '|' + String(c.collector_number).toLowerCase(), c);
      const n = c.name.toLowerCase(); if (!byName.has(n)) byName.set(n, c);
      const f = c.name.split(' // ')[0].toLowerCase(); if (!byName.has(f)) byName.set(f, c);
    };
    cards.forEach(index);
    const find = l => (l.id && byId.get(l.id)) || (l.set && l.num && bySetNum.get(l.set + '|' + String(l.num).toLowerCase())) ||
      byName.get(l.name.toLowerCase()) || byName.get(l.name.split(' // ')[0].toLowerCase());
    // A printing that wasn't found (wrong set code or number) gets one more try by name only.
    const retry = lines.filter(l => !find(l));
    if (retry.length) {
      try { const r = await collection(retry.map(l => ({ name: l.name.split(' // ')[0] }))); r.cards.forEach(index); } catch (e) {}
    }
    const out = [], notFound = [];
    for (const l of lines) {
      const c = find(l);
      if (c) out.push({ d: toD(c), qty: l.qty, cmdr: !!l.cmdr });
      else notFound.push(l.name);
    }
    return { cards: out, notFound };
  }

  root.Scry = { autocomplete, named, search, tokens, parseDeckFile, resolveLines, toD, prints, enrich, collection };
})(window);
