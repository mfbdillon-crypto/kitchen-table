// Kitchen Table — reading card text: mana costs, mana abilities, keywords, targets and common effects.
// Used by the table host (to resolve spells and combat), by the screen (to ask for targets) and by the AI.
(function (root) {
  'use strict';
  const COLORS = ['W', 'U', 'B', 'R', 'G'];
  const BASIC = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G', wastes: 'C' };
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, x: 'X' };
  const toNum = w => w == null ? 1 : /^\d+$/.test(w) ? +w : (NUM[String(w).toLowerCase()] !== undefined ? NUM[String(w).toLowerCase()] : null);
  const KEYWORDS = ['flying', 'first strike', 'double strike', 'deathtouch', 'haste', 'hexproof', 'indestructible', 'lifelink', 'menace',
    'reach', 'trample', 'vigilance', 'defender', 'flash', 'shroud', 'infect', 'wither', 'prowess', 'ward', 'skulk', 'shadow', 'horsemanship', 'fear', 'intimidate'];

  // ---------- basic card facts ----------
  function face(c) { return c && c.d && c.d.faces ? (c.d.faces[c.face || 0] || c.d.faces[0]) : null; }
  function typeLine(c) { const f = face(c); return (f && f.t) || ''; }
  // The game state the rules are looking at (for things like a god's devotion check).
  let CUR = null;
  function setState(s) { CUR = s; }
  function isType(c, w) {
    if (c && c.animated && c.zone === 'battlefield' && new RegExp('\\b' + w + '\\b', 'i').test(c.animated)) return true;   // crewed Vehicle, animated land
    if (!new RegExp('\\b' + w + '\\b', 'i').test(typeLine(c))) return false;
    if (/^creatures?$/i.test(w) && CUR && c && c.zone === 'battlefield' && !c.faceDown && notCreatureNow(CUR, c)) return false;
    return true;
  }
  // Theros gods: "As long as your devotion to black is less than five, this isn't a creature." (700.5)
  function notCreatureNow(s, c) {
    const f = face(c); const o = f && f.o; if (!o || !/isn't a creature/i.test(o)) return false;
    const m = o.match(/as long as your devotion to (white|blue|black|red|green)(?: and (white|blue|black|red|green))? is less than (\w+)/i); if (!m) return false;
    const want = [m[1], m[2]].filter(Boolean).map(x => ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' })[x.toLowerCase()]);
    let dev = 0;
    for (const p of Object.values(s.cards || {})) {
      if (p.zone !== 'battlefield' || p.ctrl !== c.ctrl || p.faceDown) continue;
      const mc = (face(p) || {}).mc || '';
      for (const sym of mc.match(/\{[^}]+\}/g) || []) if (want.some(col => sym.includes(col))) dev++;
    }
    return dev < (toNum(m[3]) || 5);
  }
  function nameOf(c) { const f = face(c); return (f && f.n) || (c && c.d && c.d.n) || ''; }
  function rawText(c) { if (!c || c.faceDown) return ''; const f = face(c); const o = (f && f.o) || ''; return c.gained && c.zone === 'battlefield' ? o + '\n' + c.gained.join('\n') : o; }
  // Rules text with reminder text removed and the card's own name replaced by "this".
  // Classes (716): on the battlefield a Class has only the abilities of the levels it has reached, plus the
  // activated ability that gains the next level.
  function levelText(c, o) {
    if (!c || c.zone !== 'battlefield' || !/\bclass\b/i.test(typeLine(c))) return o;
    const lvl = (c.counters && c.counters.level) || 1, out = [];
    for (const line of String(o || '').split('\n')) {
      const m = line.match(/^(?:\{[^}]+\})+: level (\d+)\s*$/i);
      if (m) { const n = +m[1]; if (n <= lvl) continue; if (n === lvl + 1) out.push(line); break; }
      out.push(line);
    }
    return out.join('\n');
  }
  function text(c) {
    let t = levelText(c, rawText(c)).replace(/\([^)]*\)/g, '').replace(/[ \t]+$/gm, '').replace(/ +\n/g, '\n');
    const n = nameOf(c);
    if (n) {
      const short = n.split(',')[0];
      for (const x of [n, short]) if (x && x.length > 2) t = t.split(x).join('this');
    }
    return t;
  }
  const lines = c => text(c).split('\n').map(l => l.trim()).filter(Boolean);
  const isPermanentCard = c => /\b(creature|artifact|enchantment|planeswalker|land|battle)\b/i.test(typeLine(c));

  // ---------- keywords ----------
  function keywords(c, s) {
    const set = new Set();
    if (!c) return set;
    if (c.faceDown) { for (const k of Object.keys(c.counters || {})) if (KEYWORDS.includes(k)) set.add(k); return set; }
    const kw = c.d && Array.isArray(c.d.kw) ? c.d.kw : [];
    for (const k of kw) { const l = String(k).toLowerCase(); if (KEYWORDS.includes(l)) set.add(l); }
    // Lines that are only keywords ("Flying, vigilance").
    for (const line of lines(c)) {
      const parts = line.toLowerCase().replace(/\.$/, '').split(/,\s*|\s+and\s+/);
      const ks = parts.map(p => KEYWORDS.find(k => p === k || p.startsWith(k + ' ')));
      if (ks.every(Boolean)) ks.forEach(k => set.add(k));
    }
    for (const k of Object.keys(c.counters || {})) if (KEYWORDS.includes(k)) set.add(k);
    for (const k of (c.grant || [])) set.add(k);
    if (s) for (const k of statics(s, c).kws) set.add(k);
    const t = text(c);
    if (/(^|\n|\. )this (?:creature )?can't block\b/i.test(t) || /(^|\n|\. )this (?:creature )?can't attack or block\b/i.test(t)) set.add("can't block");
    if (/(^|\n|\. )this (?:creature )?can't attack\b/i.test(t)) set.add("can't attack");
    if (/(^|\n|\. )this (?:creature )?can't be blocked\.?($|\n)/i.test(t)) set.add('unblockable');
    // "…lose hexproof and indestructible until end of turn" (Shadowspear).
    if (c.loseKw && s && s.turn && c.loseKw.n === s.turn.n) for (const k of c.loseKw.kws) set.delete(k);
    return set;
  }
  const has = (c, k, s) => keywords(c, s).has(k);

  // ---------- static P/T and keyword boosts (anthems, equipment, auras) ----------
  function statics(s, c) {
    const out = { p: 0, t: 0, kws: new Set() };
    if (!s || !c || c.zone !== 'battlefield') return out;
    const isCreature = c.faceDown || isType(c, 'creature');
    if (!isCreature) return out;
    for (const o of Object.values(s.cards)) {
      if (o.zone !== 'battlefield' || o.faceDown || !o.d) continue;
      const t = text(o);
      if (!t) continue;
      // Equipment / Auras attached to this creature.
      if (o.attachedTo === c.id) {
        for (const m of t.matchAll(/(?:equipped|enchanted) creature gets ([+-]\d+)\/([+-]\d+)/gi)) { out.p += +m[1]; out.t += +m[2]; }
        for (const m of t.matchAll(/(?:equipped|enchanted) creature (?:gets [^.]*? and )?has ([a-z ,]+?)(?:\.|$|\n)/gi)) addKws(out.kws, m[1]);
        if (/(?:equipped|enchanted) (?:creature|permanent) can't attack or block/i.test(t)) { out.kws.add("can't attack"); out.kws.add("can't block"); }
        else if (/(?:equipped|enchanted) (?:creature|permanent) can't attack/i.test(t)) out.kws.add("can't attack");
        else if (/(?:equipped|enchanted) (?:creature|permanent) can't block/i.test(t)) out.kws.add("can't block");
        if (/(?:equipped|enchanted) creature can't be blocked\b/i.test(t)) out.kws.add('unblockable');
      }
      extraStatics(s, o, c, out, t);
      // v6: anthems and keyword grants read from the card model ("Other Elves you control get +1/+1", "Creatures your opponents control get -1/-1", "Dragons you control have flying").
      const M = root.Oracle ? root.Oracle.model(o) : null;
      if (M) {
        for (const a of M.abilities) {
          // "As long as you have 25 or more life, this gets +2/+2" / "As long as …, creatures you control get +2/+2".
          if (a.kind === 'static' && (a.sub === 'conditional' || a.sub === 'selfStatic')) {
            const tx = String(a.text || '').toLowerCase().replace(/\.$/, '');
            let mm = tx.match(/^as long as (.+?), (other )?(?:([a-z]+) )?creatures you control get ([+-]\d+)\/([+-]\d+)(?: and have ([a-z ,]+))?$/) || tx.match(/^(other )?(?:([a-z]+) )?creatures you control get ([+-]\d+)\/([+-]\d+)(?: and have ([a-z ,]+))? as long as (.+)$/);
            if (mm && o.ctrl === c.ctrl) {
              const lead = /^as long as/.test(tx);
              const cond = lead ? mm[1] : mm[6], other = lead ? mm[2] : mm[1], tribe = lead ? mm[3] : mm[2], pp = lead ? mm[4] : mm[3], tt = lead ? mm[5] : mm[4], kk = lead ? mm[6] : mm[5];
              if (!(other && o.id === c.id) && (!tribe || matchesWhat(c, tribe.replace(/s$/, ''))) && root.Oracle.conditionHolds(s, o, cond) === true) { out.p += +pp; out.t += +tt; if (kk) addKws(out.kws, kk); }
              continue;
            }
            mm = tx.match(/^(?:this|it) gets ([+-]\d+)\/([+-]\d+)(?: and has ([a-z ,]+))? as long as (.+)$/) || tx.match(/^as long as (.+?), (?:this|it) gets ([+-]\d+)\/([+-]\d+)(?: and has ([a-z ,]+))?$/);
            if (mm && o.id === c.id) {
              const lead = /^as long as/.test(tx);
              const cond = lead ? mm[1] : mm[4], pp = lead ? mm[2] : mm[1], tt = lead ? mm[3] : mm[2], kk = lead ? mm[4] : mm[3];
              if (root.Oracle.conditionHolds(s, o, cond) === true) { out.p += +pp; out.t += +tt; if (kk) addKws(out.kws, kk); }
            }
            continue;
          }
          if (a.kind !== 'static' || (a.sub !== 'anthem' && a.sub !== 'grant')) continue;
          if (a.who === 'you' && o.ctrl !== c.ctrl) continue;
          if (a.who === 'opp' && o.ctrl === c.ctrl) continue;
          if (a.other && o.id === c.id) continue;
          const f = String(a.filter || 'creatures').toLowerCase().replace(/\bcreatures\b/, 'creature');
          if (f !== 'creature' && !matchesWhat(c, f.replace(/ves$/, 'f').replace(/ies$/, 'y').replace(/s$/, ''))) continue;
          if (a.sub === 'anthem') { const n = v => /x/i.test(v) ? 0 : parseInt(v, 10) || 0; out.p += n(a.p); out.t += n(a.t); if (a.kws) addKws(out.kws, a.kws); }
          else addKws(out.kws, a.kws);
        }
        continue;
      }
      if (o.ctrl !== c.ctrl) continue;
      for (const line of t.split('\n')) {
        let m = line.match(/^(other )?(?:([a-z]+) )?creatures you control get ([+-]\d+)\/([+-]\d+)(?: and have ([a-z ,]+))?\.?$/i);
        if (m && !(m[1] && o.id === c.id) && (!m[2] || new RegExp('\\b' + m[2].replace(/s$/, '') + '\\b', 'i').test(typeLine(c)))) {
          out.p += +m[3]; out.t += +m[4]; if (m[5]) addKws(out.kws, m[5]);
          continue;
        }
        m = line.match(/^(other )?(?:([a-z]+) )?creatures you control have ([a-z ,]+?)\.?$/i);
        if (m && !(m[1] && o.id === c.id) && (!m[2] || new RegExp('\\b' + m[2].replace(/s$/, '') + '\\b', 'i').test(typeLine(c)))) addKws(out.kws, m[3]);
      }
    }
    return out;
  }
  function addKws(set, str) { for (const p of String(str).toLowerCase().split(/,\s*|\s+and\s+/)) { const w = p.trim().replace(/^and /, '').replace(/\s*(?:—|\{).*$/, ''); const k = KEYWORDS.find(x => w === x); if (k) set.add(k); } }
  // Statics the card model doesn't place, read from the text (Street Riot, Gravitational Shift, Training Regimen, Saruman,
  // Cover of Darkness, Lifecraft Engine, Oviya, Radha, Nim Deathmantle, Whispersilk Cloak…).
  function extraStatics(s, o, c, out, t) {
    const mine = o.ctrl === c.ctrl, myTurn = s.turn && s.turn.active === o.ctrl;
    const isAtt = !!(s.combat && s.combat.att && s.combat.att[c.id]);
    for (const raw of t.split('\n')) {
      const line = raw.toLowerCase().trim().replace(/\.$/, '').trim();
      let m;
      if (o.attachedTo === c.id) {
        if ((m = line.match(/^(?:equipped|enchanted) creature gets [+-]\d+\/[+-]\d+, has ([a-z ,]+?)(?:,? and is .+)?$/))) addKws(out.kws, m[1]);
        if ((m = line.match(/^(?:equipped|enchanted) creature can't be blocked and has ([a-z ,]+)$/))) addKws(out.kws, m[1]);
        if ((m = line.match(/^(?:equipped|enchanted) creature has (ward [{}0-9a-z]+|[a-z ,]+ and ward [{}0-9a-z]+)$/))) addKws(out.kws, m[1]);
      }
      if ((m = line.match(/^during your turn, (?:(other )?creatures you control|this) (?:gets? ([+-]\d+)\/([+-]\d+)(?: and (?:has|have) ([a-z ,]+))?|(?:has|have) ([a-z ,]+))$/)) && myTurn) {
        const self = /, this /.test(line);
        if (self ? o.id === c.id : mine && !(m[1] && o.id === c.id)) { if (m[2]) { out.p += +m[2]; out.t += +m[3]; } if (m[4]) addKws(out.kws, m[4]); if (m[5]) addKws(out.kws, m[5]); }
      }
      if ((m = line.match(/^creatures (with|without) ([a-z]+) get ([+-]\d+)\/([+-]\d+)$/))) { const has = keywordsBase(c).has(m[2]); if ((m[1] === 'with') === has) { out.p += +m[3]; out.t += +m[4]; } }
      if ((m = line.match(/^creatures you control with ([+\-\d/]+) counters on them have ([a-z ,]+)$/)) && mine && ((c.counters || {})[m[1]] || 0) > 0) addKws(out.kws, m[2]);
      if ((m = line.match(/^(other )?([a-z]+)s?(?: and ([a-z]+)s?)? you control have ([a-z ,{}0-9]+)$/)) && mine && !(m[1] && o.id === c.id) && !/^creature/.test(m[2]) && (matchesWhat(c, m[2]) || (m[3] && matchesWhat(c, m[3])))) addKws(out.kws, m[4]);
      if ((m = line.match(/^creatures of the chosen type have ([a-z ,]+)$/)) && o.chosen && new RegExp('\\b' + o.chosen + '\\b', 'i').test(typeLine(c))) addKws(out.kws, m[1]);
      if ((m = line.match(/^each creature you control of the chosen type(?: other than this(?: [a-z]+)?)? gets ([+-]\d+)\/([+-]\d+)$/)) && mine && o.chosen && o.id !== c.id && new RegExp('\\b' + o.chosen + '\\b', 'i').test(typeLine(c))) { out.p += +m[1]; out.t += +m[2]; }
      if ((m = line.match(/^each creature that's attacking one of your opponents has ([a-z ,]+)$/)) && isAtt) { const d = s.combat.att[c.id].def; const dp = d && (d.p || (s.cards[d.c] || {}).ctrl); if (dp && dp !== o.ctrl) addKws(out.kws, m[1]); }
    }
  }
  function keywordsBase(c) { const set = new Set(); for (const k of (c.d && c.d.kw) || []) set.add(String(k).toLowerCase()); for (const line of lines(c)) for (const p of line.toLowerCase().replace(/\.$/, '').split(/,\s*|\s+and\s+/)) if (KEYWORDS.includes(p.trim())) set.add(p.trim()); for (const k of (c.grant || [])) set.add(k); return set; }

  // Power/toughness with counters, until-end-of-turn changes and static boosts.
  function pt(s, c) {
    let p, t;
    if (c.faceDown) { p = 2; t = 2; }
    else {
      const f = face(c);
      if ((!f || f.p === '' || f.tg === '' || f.p == null) && !c.animPT) return null;
      p = parseInt(f.p, 10); t = parseInt(f.tg, 10);
      if (c.animPT) { p = c.animPT[0]; t = c.animPT[1]; }
      // Maha: "Creatures your opponents control have base toughness 1."
      if (s && c.zone === 'battlefield' && Object.values(s.cards).some(o => o.zone === 'battlefield' && o.ctrl !== c.ctrl && !o.faceDown && o.d && /creatures your opponents control have base toughness 1/i.test(rawText(o)))) t = 1;
      // */* creatures (604.3, characteristic-defining): "power and toughness are each equal to the number of Rats you control",
      // "… equal to the number of cards in your hand", "power is equal to …" — counted where the table can.
      if ((isNaN(p) || isNaN(t)) && s && s.cards && !c.animPT) {
        const tx = text(c).toLowerCase();
        const m = tx.match(/(power and toughness are each|power is|toughness is) equal to the number of (.+?)(?: you control| on the battlefield| in your graveyard| in all graveyards)?(?:\.|,|$)/);
        if (m) {
          const zoneTxt = (tx.match(/equal to the number of .+?( you control| on the battlefield| in your graveyard| in all graveyards)/) || [])[1] || ' you control';
          const what = m[2].replace(/ cards?$/, '').replace(/(elv|dwarv|wolv)es$/, x => x.slice(0, -3) + 'f').replace(/ies$/, 'y').replace(/s$/, '');
          let n = 0;
          if (/cards? in your hand/.test(m[2])) n = (s.players[c.ctrl] || {}).handCount || 0;
          else if (/graveyard/.test(zoneTxt)) n = Object.values(s.cards).filter(o => o.zone === 'graveyard' && (/all/.test(zoneTxt) || o.owner === c.ctrl) && (what === 'card' || matchesWhat(Object.assign({}, o), what))).length;
          else n = Object.values(s.cards).filter(o => o.zone === 'battlefield' && (/battlefield/.test(zoneTxt) || o.ctrl === c.ctrl) && matchesWhat(o, what)).length;
          if (isNaN(p) && /power/.test(m[1])) p = n;
          if (isNaN(t) && /toughness|each/.test(m[1])) t = n;
        }
      }
      if (isNaN(p)) p = 0; if (isNaN(t)) t = 0;   // anything else with a *: 0 plus boosts
    }
    const k = c.counters || {};
    p += (k['+1/+1'] || 0) - (k['-1/-1'] || 0); t += (k['+1/+1'] || 0) - (k['-1/-1'] || 0);
    if (c.mod) { p += c.mod[0]; t += c.mod[1]; }
    if (s) { const st = statics(s, c); p += st.p; t += st.t; }
    // "This creature gets +1/+0 for each other Rat you control." (Rat Colony and friends)
    if (s && s.cards && !c.faceDown && c.zone === 'battlefield') for (const line of lines(c)) {
      const m = line.match(/^this (?:creature )?gets ([+-]\d+)\/([+-]\d+) for each (other )?(.+?) you control\.?$/i);
      if (!m) continue;
      const w = m[4].toLowerCase().replace(/(elv|dwarv|wolv)es$/, x => x.slice(0, -3) + 'f').replace(/ies$/, 'y').replace(/s$/, '');
      const n = Object.values(s.cards).filter(o => o.zone === 'battlefield' && o.ctrl === c.ctrl && !(m[3] && o.id === c.id) && matchesWhat(o, w)).length;
      p += +m[1] * n; t += +m[2] * n;
    }
    return [p, t];
  }

  // ---------- mana ----------
  function parseCost(mc) {
    const r = { g: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, x: 0, hy: [], ph: [] };
    for (const m of String(mc || '').matchAll(/\{([^}]+)\}/g)) {
      const t = m[1].toUpperCase();
      if (/^\d+$/.test(t)) r.g += +t;
      else if (t === 'X') r.x++;
      else if (COLORS.includes(t) || t === 'C') r[t]++;
      else if (/^[WUBRG]\/P$/.test(t)) r.ph.push(t[0]);
      else if (/^2\/[WUBRG]$/.test(t)) r.hy.push(['2', t[2]]);
      else if (/^[WUBRGC]\/[WUBRG]$/.test(t)) r.hy.push([t[0], t[2]]);
      else if (t === 'S') r.g++;
    }
    return r;
  }
  function costOf(c, raw) {
    const f = face(c); const r = parseCost(f && f.mc);
    if (raw || !CUR || !CUR.cards || !c || c.zone === 'battlefield' || c.zone === 'stack') return r;
    // Cost changes from permanents (601.2f): "Creature spells you cast cost {1} less", Herald's Horn, Thalia's "Noncreature spells cost {1} more".
    const who = c.ctrl || c.owner;
    let delta = 0;
    const fits = f0 => { const w = String(f0 || '').trim().toLowerCase(); if (!w || w === 'any') return true; return w.split(/\s+or\s+|,\s*/).some(x => matchesWhat(c, x.replace(/s$/, ''))); };
    for (const o of Object.values(CUR.cards)) {
      if (o.zone !== 'battlefield' || o.faceDown || !o.d) continue;
      const t = text(o);
      for (const line of t.split('\n')) {
        let m = line.match(/^([A-Za-z ]*?)spells you cast(?: of the chosen type)? cost \{(\d+)\} less to cast\.?$/i);
        if (m && o.ctrl === who) { if (/of the chosen type/i.test(line) && !(o.chosen && new RegExp('\\b' + o.chosen + '\\b', 'i').test(typeLine(c)))) continue; if (fits(m[1])) delta -= +m[2]; continue; }
        m = line.match(/^([A-Za-z ]*?)spells (your opponents cast )?cost \{(\d+)\} more to cast\.?$/i);
        if (m && (!m[2] || o.ctrl !== who) && fits(m[1])) delta += +m[3];
      }
    }
    // Temporary taxes (Elspeth Conquers Death): "Noncreature spells your opponents cast cost {2} more until your next turn".
    for (const m of CUR.costMods || []) if (m.by !== who && (!m.filter || (m.filter === 'noncreature' ? !isType(c, 'creature') : matchesWhat(Object.assign({}, c, { zone: 'stack' }), m.filter)))) delta += m.n;
    r.g = Math.max(0, r.g + delta);
    return r;
  }
  function manaValue(c) { return (c && c.d && +c.d.cmc) || 0; }
  function costTotal(r, x) { return r.g + r.W + r.U + r.B + r.R + r.G + r.C + r.hy.length + r.ph.length + r.x * (x || 0); }

  // What mana a permanent makes when tapped: { amount, colors: 'WUBRGC' subset, sac }.
  function manaSource(c) {
    if (!c || c.faceDown || !c.d) return null;
    const tl = typeLine(c).toLowerCase();
    let best = null;
    for (const line of lines(c)) {
      // Filter mana (Signets, Talismans' cousins): "{1}, {T}: Add {R}{W}." — needs one other mana fed in.
      const fm = line.match(/^\{(\d)\}, \{T\}: Add ((?:\{[WUBRGC]\})+)\.?$/i);
      if (fm) { const pips = [...fm[2].matchAll(/\{([WUBRGC])\}/gi)].map(x => x[1].toUpperCase()); const src = { amount: pips.length, colors: [...new Set(pips)].join(''), units: pips, filter: +fm[1], sac: false }; if (!best) best = src; continue; }
      const m = line.match(/^\{T\}(?:, ([^:]+))?: Add (.+?)\.?$/i);
      if (!m) continue;
      const extra = (m[1] || '').toLowerCase();
      if (extra && !/sacrifice this/.test(extra)) continue;   // other extra costs (pay life, discard…) are skipped
      const what = m[2];
      let amount = 1, colors = '';
      const pips = [...what.matchAll(/\{([WUBRGC])\}/g)].map(x => x[1]);
      if (/any (?:one )?color|any combination of colors|any type/i.test(what)) { colors = 'WUBRG'; const n = what.match(/^(one|two|three|\d+) mana/i); amount = n ? toNum(n[1]) : 1; }
      else if (/ or /.test(what) && pips.length) { colors = [...new Set(pips)].join(''); amount = 1; }
      else if (pips.length) { colors = [...new Set(pips)].join(''); amount = pips.length; }
      else continue;
      const src = { amount, colors, sac: /sacrifice/.test(extra) };
      if (pips.length > 1 && !/ or /.test(what) && !/any/i.test(what)) src.units = pips;      // {G}{U}: one green and one blue
      if (!best || src.amount > best.amount || (src.amount === best.amount && src.colors.length > best.colors.length)) best = src;
    }
    if (!best && /\bland\b/.test(tl)) {
      const cols = Object.entries(BASIC).filter(([n]) => new RegExp('\\b' + n + '\\b').test(tl)).map(([, col]) => col);
      const pm = c.d.pm && c.d.pm.length ? c.d.pm.filter(x => 'WUBRGC'.includes(x)) : [];
      const all = [...new Set(cols.concat(pm))];
      if (all.length) best = { amount: 1, colors: all.join(''), sac: false };
    }
    // Auras like Fertile Ground / Wild Growth / Utopia Sprawl: "Whenever enchanted land is tapped for mana, its controller adds an additional…" (605.4a)
    if (best && !best.sac && CUR && CUR.cards && c.id) {
      for (const o of Object.values(CUR.cards)) {
        if (o.attachedTo !== c.id || o.zone !== 'battlefield' || o.faceDown || !o.d) continue;
        const m = text(o).match(/whenever enchanted (?:land|forest|plains|island|swamp|mountain) is tapped for mana, its controller adds an additional (one mana of any color|one mana of the chosen color|\{([WUBRGC])\}(?:\{([WUBRGC])\})?)/i);
        if (!m) continue;
        const add = m[2] ? [m[2], m[3]].filter(Boolean).map(x => x.toUpperCase()) : /chosen color/i.test(m[1]) && o.chosen ? [({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' })[o.chosen] || 'WUBRG'] : ['WUBRG'];
        const units = best.units ? best.units.slice() : Array.from({ length: best.amount }, () => best.colors);
        best = { amount: units.length + add.length, colors: best.colors, sac: false, units: units.concat(add) };
      }
    }
    return best;
  }

  // Pay a cost from a list of sources [{id, amount, colors}]: returns the ids to tap, or null.
  // Filter sources (a Signet) are used only when needed, each fed by one other mana (605).
  function pay(cost, sources, x) {
    const plain = sources.filter(s => !s.filter), filters = sources.filter(s => s.filter);
    let r = pay0(cost, plain, x);
    if (r || !filters.length) return r;
    let pool = plain.slice(); const extra = [];
    for (const f of filters) {
      // Feed it with the least useful single mana (prefer colorless, then the widest).
      const feeders = pool.filter(p => p.amount === 1).sort((a, b) => (a.colors === 'C' ? -1 : 0) - (b.colors === 'C' ? -1 : 0) || b.colors.length - a.colors.length);
      for (const fd of feeders) {
        const trial = pool.filter(p => p !== fd).concat([{ id: f.id, amount: f.amount, colors: f.colors, units: f.units }]);
        r = pay0(cost, trial, x);
        if (r) return r.concat(extra, [fd.id]);
      }
      // Not enough yet: keep this one fed by the first feeder and try adding another filter.
      if (!feeders.length) break;
      const fd = feeders[0]; pool = pool.filter(p => p !== fd).concat([{ id: f.id, amount: f.amount, colors: f.colors, units: f.units }]); extra.push(fd.id);
    }
    return null;
  }
  function pay0(cost, sources, x) {
    const need = [];
    for (const col of ['W', 'U', 'B', 'R', 'G', 'C']) for (let i = 0; i < cost[col]; i++) need.push(col);
    for (const col of cost.ph) need.push(col);
    // Two-color hybrid pips ({U/W}) take part in the matching too, so a Plains and an Island can pay {U/W}{W/B}.
    const hy = [];
    for (const [a, b] of cost.hy) { if (a === '2') hy.push([a, b]); else need.push(a + b); }
    let generic = cost.g + cost.x * (x || 0);
    // Mana units: a 2-mana source gives two units of one of its colors.
    const units = [];
    for (const s of sources) for (let i = 0; i < s.amount; i++) units.push({ src: s.id, colors: s.units ? s.units[i] || s.colors : s.colors, i });
    const used = new Array(units.length).fill(false);
    // Colored pips: least flexible units first, by matching with backtracking.
    const fits = (u, col) => [...col].some(ch => u.colors.includes(ch));
    const order = need.map((col, k) => ({ col, k })).sort((a, b) => units.filter(u => fits(u, a.col)).length - units.filter(u => fits(u, b.col)).length);
    const assign = new Array(order.length).fill(-1);
    function place(n) {
      if (n === order.length) return true;
      const col = order[n].col;
      const cands = units.map((u, i) => i).filter(i => !used[i] && fits(units[i], col)).sort((a, b) => units[a].colors.length - units[b].colors.length);
      for (const i of cands) { used[i] = true; assign[n] = i; if (place(n + 1)) return true; used[i] = false; }
      return false;
    }
    if (!place(0)) return null;
    // Hybrid: either color, or 2 generic for {2/W}.
    for (const [a, b] of hy) {
      let i = units.findIndex((u, k) => !used[k] && (u.colors.includes(a) || u.colors.includes(b)));
      if (i >= 0) { used[i] = true; continue; }
      if (a === '2') { generic += 2; continue; }
      return null;
    }
    // Generic: finish sources we already started, then use as few (and as plain) sources as possible.
    const touched = () => new Set(units.filter((u, k) => used[k]).map(u => u.src));
    while (generic > 0) {
      const t = touched();
      const free = units.map((u, i) => i).filter(i => !used[i]);
      if (!free.length) return null;
      const left = src => units.filter((u, k) => !used[k] && u.src === src).length;
      free.sort((a, b) => (t.has(units[b].src) - t.has(units[a].src))
        || ((left(units[b].src) <= generic) - (left(units[a].src) <= generic))
        || (left(units[b].src) - left(units[a].src))
        || (units[a].colors.replace('C', '').length - units[b].colors.replace('C', '').length));   // colorless first, then the least flexible
      used[free[0]] = true; generic--;
    }
    return [...touched()];
  }

  // ---------- targets ----------
  // A target requirement: { n, upTo, any, kinds:[...], ctrl:'any'|'you'|'opp', non:[...], gy, flags:{}, text }
  const KIND_WORDS = ['creature', 'planeswalker', 'artifact', 'enchantment', 'land', 'battle', 'permanent', 'player', 'opponent', 'spell', 'card', 'instant', 'sorcery'];
  function parseTargetPhrase(after) {
    // after: the words following "target"
    const req = { kinds: [], ctrl: 'any', non: [], flags: {}, gy: false };
    const words = after.toLowerCase().split(/\s+/);
    const stop = /^(you|an|your|that|with|without|to|from|and|gets?|gains?|loses?|deals?|of|on|in|into|at|is|are|can't|has|have|attacking|blocking|tapped|untapped|it|its|their|this|each|until|for|then|unless|if|as|the|a|or)$/;
    let i = 0;
    while (i < words.length) {
      let w = words[i].replace(/[.,;:]$/, '').replace(/'s$/, '');
      const endsHere = /[.,;:]$/.test(words[i]);
      if (w === 'or' && i > 0) { i++; continue; }
      if (/^non-?/.test(w) && w.length > 4) { req.non.push(w.replace(/^non-?/, '').replace(/s$/, '')); i++; if (endsHere && !/^(non-?[a-z]+|[a-z]+)$/.test((words[i] || '').replace(/[.,;:]$/, '')) ) break; if (endsHere && /[.;:]$/.test(words[i - 1])) break; continue; }
      if ((w === 'attacking' || w === 'blocking') && (words[i + 1] === 'or') && /^(attacking|blocking)$/.test(words[i + 2] || '')) { req.flags.combat = true; i += 3; continue; }
      if (w === 'attacking' || w === 'blocking' || w === 'tapped' || w === 'untapped' || w === 'legendary') { req.flags[w] = true; i++; continue; }
      const base = w === 'sorceries' ? 'sorcery' : w.replace(/s$/, '');
      if (KIND_WORDS.includes(base)) {
        req.kinds.push(base); i++;
        // "creature, enchantment, or planeswalker": a comma continues the list when another type follows.
        if (endsHere) { const nx = (words[i] || '').replace(/[.,;:]$/, ''); if (!(nx === 'or' || nx === 'and' || KIND_WORDS.includes(nx.replace(/s$/, '')) || /^non-?/.test(nx))) break; }
        continue;
      }
      if (stop.test(w) && req.kinds.length) break;
      if (!req.kinds.length && /^(white|blue|black|red|green|colorless|multicolored)$/.test(w)) { req.flags[w] = true; i++; continue; }
      if (req.kinds.length) break;
      i++;
      if (i > 4) break;
    }
    const rest0 = words.slice(i).join(' ');
    // "with mana value 4 or greater", "with power 2 or less": checked when targets are chosen.
    const nm = rest0.split(/[.;]/)[0].match(/\b(?:with|that has|that have) (mana value|converted mana cost|power|toughness) (\d+) or (greater|less|more|fewer)\b/);
    if (nm) req.num = { stat: /mana/.test(nm[1]) ? 'mv' : nm[1], n: +nm[2], ge: /greater|more/.test(nm[3]) };
    const rest = nm ? rest0.replace(nm[0], '').replace(/\s+/g, ' ').trim() : rest0;
    // Restrictions the table can't check ("that's attacking alone", "with a counter on it"…).
    if (/^(with|that|if|whose)\b/.test(rest.split(/[.;]/)[0]) && !/^with flying\b/.test(rest)) req.complex = true;
    if (/^(you control|you own)\b/.test(rest)) req.ctrl = 'you';
    else if (/^(you don't control|an opponent controls|your opponents control|you do not control)\b/.test(rest)) req.ctrl = 'opp';
    if (/^(from|in) (your|a|an opponent's|target player's) graveyard/.test(rest) || /graveyard/.test(rest.split(/[.;]/)[0]) && req.kinds.includes('card')) req.gy = true;
    if (/^(from|in) your graveyard/.test(rest) || (req.kinds.includes('card') && /\bfrom your graveyard\b/.test(rest.split(/[.;]/)[0]))) req.ctrl = 'you';
    if (/^(from|in) an opponent's graveyard/.test(rest)) req.ctrl = 'opp';
    if (/power|toughness|mana value|converted/.test(rest.split(/[.;]/)[0])) req.complex = true;
    if (/^with flying\b/.test(rest)) req.flags.flying = true;
    if (req.kinds.includes('opponent')) { req.kinds = req.kinds.filter(k => k !== 'opponent'); if (!req.kinds.includes('player')) req.kinds.push('player'); req.ctrl = 'opp'; }
    if (req.kinds.includes('card')) { req.gy = true; req.kinds = req.kinds.filter(k => k !== 'card'); if (!req.kinds.length) req.kinds.push('any-card'); }
    return req;
  }

  // Split a spell's text into the part that happens when it resolves (skipping keyword lines and triggers).
  function spellText(c) {
    return lines(c).filter(l => !/^(flashback|kicker|buyback|cycling|madness|overload|retrace|escape|jump-start|replicate|storm|convoke|delve|affinity|ward|equip|enchant)\b/i.test(l) && !/^(when|whenever|at the beginning)\b/i.test(l)).join('\n');
  }
  function modesOf(c) {
    const t = spellText(c);
    if (/^spree\b/im.test(t)) {
      const ls = t.split('\n').map(x => x.trim()).filter(x => /^\+\s*\{/.test(x));
      if (ls.length >= 2) return { pick: 'many', spree: ls.map(x => (x.match(/^\+\s*((?:\{[^}]+\})+)/) || [])[1] || ''), modes: ls.map(x => x.replace(/^\+\s*(?:\{[^}]+\})+\s*—\s*/, '')) };
    }
    const m = t.match(/choose (one or more|one or both|any number|one|two|three)\s*(?:—|-)?\s*\n?([\s\S]*)/i);
    if (!m) return null;
    const parts = m[2].split(/\n|•/).map(x => x.replace(/^[•\s]+/, '').trim());
    // The rest of the "Choose …" line ("You may choose the same mode more than once." / "If you control a commander as
    // you cast this spell, you may choose both.") is a rule about choosing, not a mode.
    const head = /^[.\s—-]/.test(m[2]) || /^\.?\s*(you may|if )/i.test(parts[0] || '') ? parts.shift() || '' : '';
    const modes = parts.filter(x => x && !/^choose/i.test(x));
    if (modes.length < 2) return null;
    const out = { pick: /one or both|one or more|any number/i.test(m[1]) ? 'many' : toNum(m[1]) || 1, modes };
    const esc = t.match(/^escalate ((?:\{[^}]+\})+)/im); if (esc) out.escalate = esc[1];
    if (/choose the same mode more than once/i.test(head)) out.repeat = true;
    const more = head.match(/if (.+?), (?:you may )?choose (both|two|any number)(?: instead)?/i);
    if (more) { out.more = { cond: more[1].toLowerCase(), pick: /any number/i.test(more[2]) ? 'many' : 2 }; }
    return out;
  }

  function targetsIn(str) {
    const reqs = [];
    // A reflexive "When you do, …" ability picks its own targets later (603.12).
    const s = str.replace(/\n/g, ' ').replace(/\bwhen you do\b.*$/i, '');
    const re = /\b(?:(up to )(one|two|three|four|five|\d+) |(one|two|three|four|five|\d+) |(any number of) )?(?:(other|another) )?target ((?:(?!\btarget\b)[^.;:])*)|\bany target\b/gi;
    let m;
    while ((m = re.exec(s))) {
      if (/^any target$/i.test(m[0])) { reqs.push({ n: 1, upTo: false, kinds: ['creature', 'player', 'planeswalker', 'battle'], ctrl: 'any', non: [], flags: {}, gy: false, any: true, text: 'any target' }); continue; }
      let req = parseTargetPhrase(m[6] || '');
      // "target Rat, Ninja, or Squirrel", "target Goblin you control": a list of subtypes.
      if (!req.kinds.length) {
        const sm = (m[6] || '').match(/^((?:[A-Z][a-z]+)(?:,? (?:or |and )?[A-Z][a-z]+)*)\b(.*)$/);
        if (!sm || /\bthat\s*$/i.test(s.slice(Math.max(0, m.index - 8), m.index))) continue;   // "spells that target Terror of the Peaks" is not a target
        const subs = sm[1].split(/,? (?:or |and )?|, /).map(x => x.trim()).filter(Boolean);
        req = parseTargetPhrase('permanent' + sm[2]);
        if (/^\s*cards?\b/.test(sm[2])) req = parseTargetPhrase('card' + sm[2].replace(/^\s*cards?/, ''));
        req.subs = subs;
      } else {
        // "target Dragon card", "target Elf creature": a subtype in front of the type.
        const cm = (m[6] || '').match(/^((?:[A-Z][a-z]+)(?:,? (?:or |and )?[A-Z][a-z]+)*) (?:creature|card|permanent|spell|artifact|enchantment|land)s?\b/);
        if (cm) req.subs = cm[1].split(/,? (?:or |and )?|, /).map(x => x.trim()).filter(Boolean);
      }
      req.n = m[4] ? 99 : toNum(m[2] || m[3]) || 1;
      req.upTo = !!m[1] || !!m[4];
      req.other = !!m[5];
      req.text = m[0].replace(/\s+/g, ' ').trim().slice(0, 80);
      reqs.push(req);
    }
    return reqs;
  }

  // Targets chosen when casting: for an Aura, the thing it enchants; for an instant or sorcery, every "target" in it.
  function targetReqs(c, mode, alt) {
    if (!c || c.faceDown) return [];
    // Mutate (702.140a): the spell targets a non-Human creature with the same owner.
    if ((alt || (c.zone === 'stack' ? c.alt : null)) === 'mutate') return [{ n: 1, upTo: false, kinds: ['creature'], ctrl: 'any', non: ['human'], flags: {}, gy: false, own: true, mutate: true, text: 'target non-Human creature you own' }];
    const tl = typeLine(c);
    if (/\baura\b/i.test(tl)) {
      const m = text(c).match(/^enchant ([a-z ]+?)(?:\n|$)/im);
      if (!m) return [];
      const req = parseTargetPhrase(m[1]);
      if (!req.kinds.length) return [];
      return [Object.assign(req, { n: 1, upTo: false, text: 'enchant ' + m[1], aura: true })];
    }
    if (!/\b(instant|sorcery)\b/i.test(tl)) return [];
    const md = modesOf(c);
    if (md && mode != null) {
      const chosen = [].concat(mode).map(i => md.modes[i]).filter(Boolean);
      return targetsIn(chosen.join('. '));
    }
    if (md) return [];
    return targetsIn(spellText(c));
  }

  function colorsOf(c) {
    if (c && c.d && Array.isArray(c.d.col)) return c.d.col;
    const mc = (face(c) || {}).mc || '';
    return [...new Set(mc.match(/[WUBRG]/g) || [])];
  }
  function sameColor(c, col) {
    const cs = colorsOf(c);
    const map = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    if (col === 'colorless') return !cs.length;
    if (col === 'multicolored') return cs.length > 1;
    return cs.includes(map[col]);
  }
  // Can this card/player be chosen for this requirement? t = {c: cardId} or {p: pid}
  function legalTarget(s, req, t, by) {
    if (!t) return false;
    if (t.p) {
      if (!req.kinds.includes('player')) return false;
      if (!s.players[t.p] || s.players[t.p].lost) return false;
      if (s.players[t.p].protAll && t.p !== by) return false;   // protection from everything
      if (req.ctrl === 'opp' && t.p === by) return false;
      if (req.ctrl === 'you' && t.p !== by) return false;
      return true;
    }
    const c = s.cards[t.c];
    if (!c) return false;
    if (req.num) {
      const v = req.num.stat === 'mv' ? (c.token ? 0 : manaValue(c)) : ((pt(s, c) || [0, 0])[req.num.stat === 'power' ? 0 : 1]);
      if (req.num.ge ? v < req.num.n : v > req.num.n) return false;
    }
    if (req.gy) {
      if (c.zone !== 'graveyard') return false;
      if (req.ctrl === 'you' && c.owner !== by) return false;
      if (req.ctrl === 'opp' && c.owner === by) return false;
      if (req.subs && !req.subs.some(t => isType(c, t))) return false;
      return req.kinds.includes('any-card') || req.kinds.some(k => k === 'permanent' ? isPermanentCard(c) : k === 'card' || isType(c, k)) && !req.non.some(k => isType(c, k));
    }
    if (req.kinds.includes('spell')) {
      if (c.zone !== 'stack' || c.ab) return false;
      const others = req.kinds.filter(k => k !== 'spell');
      if (others.length && !others.some(k => isType(c, k))) return false;
      if (req.non.some(k => isType(c, k))) return false;
      return true;
    }
    if (c.zone !== 'battlefield') return false;
    const kindOk = req.kinds.some(k => k === 'permanent' || (k === 'creature' && c.faceDown) || isType(c, k));
    if (!kindOk) return false;
    if (req.subs && !req.subs.some(t => isType(c, t))) return false;
    if (req.non.some(k => (k === 'token' ? c.token : isType(c, k)) || (['white', 'blue', 'black', 'red', 'green'].includes(k) && sameColor(c, k)))) return false;
    if (req.ctrl === 'you' && c.ctrl !== by) return false;
    if (req.ctrl === 'opp' && c.ctrl === by) return false;
    if (req.own && c.owner !== by) return false;
    if (req.flags.tapped && !c.tapped) return false;
    if (req.flags.untapped && c.tapped) return false;
    const attacking = !!(s.combat && s.combat.att && s.combat.att[c.id]);
    const blocking = !!(s.combat && s.combat.att && Object.values(s.combat.att).some(a => (a.blk || []).includes(c.id)));
    if (req.flags.combat && !attacking && !blocking) return false;
    if (req.flags.attacking && !attacking) return false;
    if (req.flags.blocking && !(s.combat && s.combat.att && Object.values(s.combat.att).some(a => (a.blk || []).includes(c.id)))) return false;
    if (req.flags.legendary && !isType(c, 'legendary')) return false;
    if (req.flags.flying && !has(c, 'flying', s)) return false;
    for (const col of ['white', 'blue', 'black', 'red', 'green', 'colorless', 'multicolored']) if (req.flags[col] && !sameColor(c, col)) return false;
    // Hexproof / shroud: opponents (or anyone, for shroud) can't target it.
    const kw = keywords(c, s);
    if (kw.has('shroud')) return false;
    if (kw.has('hexproof') && c.ctrl !== by) return false;
    return true;
  }
  // Short wording for a requirement in menus: "a creature you control", "any target", "a creature card in your graveyard".
  function reqLabel(req) {
    if (req.any) return 'any target';
    const many = req.n > 1;
    const pl = w => !many ? w : w === 'sorcery' ? 'sorceries' : w + 's';
    const kinds = req.kinds.map(k => k === 'any-card' ? 'card' : k);
    const joinOr = l => l.length <= 1 ? l.join('') : l.slice(0, -1).join(', ') + ' or ' + l[l.length - 1];
    const others = kinds.filter(k => k !== 'spell');
    const list = req.subs ? joinOr(req.subs.map(pl)) + (others.length && !['permanent', 'any-card'].includes(others[0]) ? ' ' + pl(others[0]) : '') : kinds.includes('spell') ? (others.length ? joinOr(others) + ' ' : '') + pl('spell') : joinOr(kinds.map(pl));
    const pre = [].concat(req.non.map(n => 'non' + n), Object.keys(req.flags || {}).filter(f => req.flags[f] && f !== 'flying' && f !== 'combat'));
    let w = (req.flags && req.flags.combat ? 'attacking or blocking ' : '') + (pre.length ? pre.join(' ') + ' ' : '') + list;
    if (req.gy) w += (kinds.includes('card') ? '' : ' card') + (req.ctrl === 'you' ? ' in your graveyard' : req.ctrl === 'opp' ? ' in an opponent’s graveyard' : ' in a graveyard');
    else if (req.ctrl === 'you') w += ' you control';
    else if (req.ctrl === 'opp') w += kinds.length === 1 && kinds[0] === 'player' ? '' : ' you don’t control';
    if (req.ctrl === 'opp' && kinds.length === 1 && kinds[0] === 'player') w = 'opponent';
    if (req.flags && req.flags.flying) w += ' with flying';
    if (req.num) w += ` with ${req.num.stat === 'mv' ? 'mana value' : req.num.stat} ${req.num.n} or ${req.num.ge ? 'greater' : 'less'}`;
    const n = req.n > 1 && req.n < 99 ? (['', '', 'two', 'three', 'four', 'five'][req.n] || req.n) + ' ' : req.n >= 99 ? 'any number of ' : /^[aeiou]/i.test(w) ? 'an ' : 'a ';
    return (req.upTo && req.n < 99 ? 'up to ' : '') + n + (req.other ? 'other ' : '') + w;
  }
  // Is target i of this spell meant to help (pump, protect, reanimate…) rather than hurt? Decides which choices are listed first.
  function helpfulTarget(card, mode, i) {
    let eff; try { eff = effectsOf(card, mode); } catch (e) { return false; }
    const es = eff.effects.filter(e => e.ti === i || e.ti2 === i || (e.tis && e.tis.includes(i)));
    if (es.some(e => (e.k === 'bite' || e.k === 'fight') && e.ti === i)) return true;
    if (es.some(e => e.k === 'pump' && /^-/.test(String(e.t)))) return false;
    if (es.some(e => ['pump', 'grant', 'counters', 'untap', 'gyToHand', 'reanimate', 'attachSrc'].includes(e.k))) return true;
    if (!es.length && /enchanted (?:creature|land|permanent|artifact) (?:gets \+|has |gains )|whenever enchanted land is tapped for mana/i.test(text(card)) && !/enchanted (?:creature|permanent) (?:can't|doesn't)/i.test(text(card))) return true;
    return false;
  }
  function orderChoices(s, choices, by, helpful) {
    const mineT = t => t.p ? t.p === by : !!(s.cards[t.c] && (s.cards[t.c].zone === 'graveyard' ? s.cards[t.c].owner === by : s.cards[t.c].ctrl === by));
    return choices.slice().sort((a, b) => (mineT(a) === mineT(b) ? 0 : (mineT(a) === helpful ? -1 : 1)) || ((a.p ? 0 : 1) - (b.p ? 0 : 1)));
  }
  // "Protection from red", "protection from creatures", "protection from everything" (702.16).
  function protections(c, s) {
    const out = new Set(); if (!c || c.faceDown) return out;
    for (const m of text(c).toLowerCase().matchAll(/protection from ([a-z ,]+?)(?:\.|$|\n|\()/g))
      for (const q of m[1].split(/,\s*(?:and\s+)?(?:from\s+)?|\s+and\s+from\s+|\s+and\s+/)) if (q.trim()) out.add(q.trim().replace(/^from /, ''));
    for (const k of Object.keys(c.counters || {})) if (/^protection from /.test(k)) out.add(k.slice(16));
    return out;
  }
  const COLOR_WORD = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  function protectedFrom(target, source, s) {
    const pr = protections(target, s); if (!pr.size || !source) return false;
    if (pr.has('everything')) return true;
    const cols = colorsOf(source);
    for (const [w, k] of Object.entries(COLOR_WORD)) if (pr.has(w) && cols.includes(k)) return true;
    if (pr.has('multicolored') && cols.length > 1) return true;
    if (pr.has('monocolored') && cols.length === 1) return true;
    for (const t of ['creatures', 'artifacts', 'enchantments', 'instants', 'sorceries', 'planeswalkers']) if (pr.has(t) && isType(source, t === 'sorceries' ? 'sorcery' : t.replace(/s$/, ''))) return true;
    return false;
  }
  // Why this blocker can't block that attacker (509.1b), or null.
  function blockProblem(s, b, a) {
    const ak = keywords(a, s), bk = keywords(b, s);
    const nm = x => nameOf(x);
    if (bk.has("can't block")) return `${nm(b)} can’t block.`;
    if (ak.has('unblockable')) return `${nm(a)} can’t be blocked.`;
    { const P = s && s.players && s.players[a.ctrl]; if (P && P.ring && P.ringBearer === a.id && (pt(s, b) || [0])[0] > (pt(s, a) || [0])[0]) return `${nm(a)} is the Ring-bearer — creatures with greater power can’t block it.`; }
    if (ak.has('fear') && !isType(b, 'artifact') && !sameColor(b, 'black')) return `${nm(a)} has fear — only artifact and/or black creatures can block it (702.36b).`;
    if (ak.has('intimidate') && !isType(b, 'artifact') && !['white', 'blue', 'black', 'red', 'green'].some(col => sameColor(a, col) && sameColor(b, col))) return `${nm(a)} has intimidate — only artifact creatures and creatures that share a color with it can block it (702.13b).`;
    if (ak.has('flying') && !bk.has('flying') && !bk.has('reach')) return `${nm(a)} has flying — only creatures with flying or reach can block it (702.9b).`;
    if (protectedFrom(a, b, s)) return `${nm(a)} has protection from ${nm(b)}’s qualities, so ${nm(b)} can’t block it (702.16f).`;
    const t = text(a).toLowerCase(), bp = (pt(s, b) || [0, 0])[0], ap = (pt(s, a) || [0, 0])[0];
    if (/can't be blocked except by creatures with flying/.test(t) && !bk.has('flying')) return `${nm(a)} can be blocked only by creatures with flying.`;
    let m = t.match(/can't be blocked by creatures with power (\d+) or (less|greater)/);
    if (m && (m[2] === 'less' ? bp <= +m[1] : bp >= +m[1])) return `${nm(a)} can’t be blocked by creatures with power ${m[1]} or ${m[2]}.`;
    if (ak.has('skulk') && bp > ap) return `${nm(a)} has skulk — creatures with greater power can’t block it (702.118b).`;
    if (ak.has('shadow') && !bk.has('shadow')) return `${nm(a)} has shadow — only creatures with shadow can block it (702.28b).`;
    if (ak.has('horsemanship') && !bk.has('horsemanship')) return `${nm(a)} has horsemanship — only creatures with horsemanship can block it.`;
    return null;
  }
  // Does a permanent fit "nonland permanent", "nontoken creature", "creature or planeswalker"…?
  const MW_SKIP = new Set(['you', 'control', 'controls', 'your', 'opponent', 'opponents', 'the', 'with', 'card', 'spell', 'attacking', 'blocking', 'tapped', 'untapped', 'that', 'this', 'and', 'from', 'graveyard', 'hand', 'library', 'battlefield', 'player', 'each', 'another', 'target', 'power', 'toughness', 'mana', 'value', 'less', 'greater', 'equal', 'than', 'or', 'any', 'number', 'other', 'face-down', 'face-up', 'nontoken', 'non', 'don\'t', 'doesn\'t', 'without', 'flying', 'reach', 'trample', 'haste', 'counter', 'counters', 'on', 'it', 'its', 'of', 'in', 'under', 'commander', 'historic', 'outlaw', 'party', 'enter', 'enters', 'die', 'dies']);
  function matchesWhat(c, what) {
    const alts = String(what || 'permanent').toLowerCase().replace(/\b(a|an|one|two|other)\b/g, ' ').split(/\s+or\s+|,\s*/);
    const is = k => k === 'permanent' ? (c.zone === 'battlefield' || !(isType(c, 'instant') || isType(c, 'sorcery'))) : k === 'token' ? !!c.token : (k === 'creature' && c.faceDown) || isType(c, k);
    return alts.some(alt => alt.trim().split(/\s+/).filter(Boolean).every(w0 => {
      const w = w0.replace(/(elv|dwarv|wolv)es$/, m => m.slice(0, -3) + 'f').replace(/ies$/, 'y').replace(/s$/, '');
      const neg = /^non-?/.test(w) && w.length > 4; const k = neg ? w.replace(/^non-?/, '') : w;
      if (['permanent', 'token', 'creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle', 'legendary', 'basic', 'snow', 'instant', 'sorcery', 'kindred'].includes(k)) return neg ? !is(k) : is(k);
      if (['white', 'blue', 'black', 'red', 'green', 'colorless', 'multicolored'].includes(k)) return neg ? !sameColor(c, k) : sameColor(c, k);
      // Words that aren't about the card itself.
      if (MW_SKIP.has(k) || k.length < 3 || !/^[a-z'-]+$/.test(k)) return true;
      // Anything else is a subtype: "Dragon", "Elf", "Equipment", "Aura"… (205.3)
      const sub = new RegExp('\\b' + k + '(?:s|es)?\\b', 'i').test((typeLine(c).split(/[—-]/)[1] || '')) || (k === 'aura' || k === 'equipment' || k === 'vehicle' ? new RegExp('\\b' + k + '\\b', 'i').test(typeLine(c)) : false) || (c.d && c.faces === undefined && /changeling/i.test(text(c)) && isType(c, 'creature'));
      return neg ? !sub : sub;
    }));
  }
  // "As an additional cost to cast this spell, sacrifice a creature" (Village Rites, Bone Splinters, Harrow…) → 'creature'.
  function discardCost(c) { return /as an additional cost to cast this spell, discard (?:a|one) card/i.test(text(c)); }
  function sacCost(c) {
    const m = text(c).toLowerCase().match(/as an additional cost to cast this spell, sacrifice (?:a|an) ([a-z ]+?)(?: or discard a card)?\./);
    return m ? m[1].trim() : null;
  }
  // "If you control a commander, you may cast this spell without paying its mana cost" (Fierce Guardianship, Deflecting Swat…).
  function freeFromHand(s, c, by) { return !!s && c.zone === 'hand' && Object.values(s.cards || {}).some(o => o.zone === 'battlefield' && o.ctrl === by && !o.faceDown && o.d && /you may cast spells from your hand without paying their mana costs/i.test(text(o))); }
  function freeWithCommander(s, c, by) { return /if you control a commander, you may cast this(?: spell)? without paying its mana cost/i.test(text(c)) && !!s && Object.values(s.cards || {}).some(o => o.cmdr && o.ctrl === by && o.zone === 'battlefield'); }
  // How many modes may be chosen right now ("If you control a commander as you cast this spell, you may choose both").
  function modePick(s, c, md, by) {
    if (!md) return 1;
    const base = md.pick === 'many' ? md.modes.length : md.pick;
    if (!md.more || !s) return base;
    const cond = md.more.cond, mine = Object.values(s.cards || {}).filter(o => o.zone === 'battlefield' && o.ctrl === by);
    let ok = false, mm;
    if (/you control a commander/.test(cond)) ok = mine.some(o => o.cmdr);
    else if ((mm = cond.match(/you control an? ([a-z]+)/))) ok = mine.some(o => matchesWhat(o, mm[1]));
    else if ((mm = cond.match(/an opponent has (\w+) or more cards in their graveyard/))) { const n = toNum(mm[1]) || 8; ok = (s.seats || []).some(p => p !== by && Object.values(s.cards).filter(o => o.zone === 'graveyard' && o.owner === p).length >= n); }
    return ok ? (md.more.pick === 'many' ? md.modes.length : Math.max(base, md.more.pick)) : base;
  }
  // Cost reductions (601.2f): "This spell costs {1} less to cast for each creature on the battlefield" (Blasphemous Act),
  // "costs {X} less, where X is the greatest power among creatures you control" (The Great Henge), affinity, and statics
  // on my permanents: "Artifact spells you cast cost {1} less to cast", "Angel spells you cast cost {2} less"…
  // Returns how much generic mana is taken off.
  function costReduction(s, c, by) {
    if (!s || !c || c.faceDown) return 0;
    by = by || c.owner || c.ctrl;
    const bf = Object.values(s.cards).filter(o => o.zone === 'battlefield' && !o.faceDown && o.d);
    const count = (what, who) => bf.filter(o => (who === 'you' ? o.ctrl === by : who === 'opp' ? o.ctrl !== by : true) && matchesWhat(o, what)).length;
    const pow = o => (pt(s, o) || [0])[0];
    let n = 0;
    const own = text(c).toLowerCase();
    let m;
    if ((m = own.match(/this spell costs \{(\d+)\} less to cast for each ([a-z -]+?) (on the battlefield|you control|your opponents control)/))) n += +m[1] * count(m[2], /you control/.test(m[3]) ? 'you' : /opponents/.test(m[3]) ? 'opp' : 'any');
    if ((m = own.match(/affinity for ([a-z]+)/))) n += count(m[1].replace(/s$/, ''), 'you');
    // Karador: "…for each creature card in your graveyard".
    if ((m = own.match(/this spell costs \{(\d+)\} less to cast for each ([a-z ]+?) cards? in your graveyard/))) n += +m[1] * Object.values(s.cards).filter(o => o.zone === 'graveyard' && o.owner === by && matchesWhat(o, m[2])).length;
    if ((m = own.match(/this spell costs \{x\} less to cast, where x is (the greatest power among creatures you control|the total power of creatures you control|the greatest number of ([a-z]+) an opponent controls)/))) {
      const mine = bf.filter(o => o.ctrl === by && isType(o, 'creature'));
      if (/greatest power/.test(m[1])) n += Math.max(0, ...mine.map(pow));
      else if (/total power/.test(m[1])) n += mine.reduce((a, o) => a + Math.max(0, pow(o)), 0);
      else { const per = {}; for (const o of bf) if (o.ctrl !== by && matchesWhat(o, m[2].replace(/s$/, ''))) per[o.ctrl] = (per[o.ctrl] || 0) + 1; n += Math.max(0, ...Object.values(per)); }
    }
    // Statics on my permanents.
    for (const o of bf) {
      if (o.ctrl !== by) continue;
      const t = text(o).toLowerCase();
      for (const line of t.split('\n')) {
        const r = line.match(/^(?:each spell you cast that's ([a-z ]+?)|([a-z ,]+?) spells you cast(?: of the chosen type)?) costs? \{(\d+)\} less to cast(?: for each ([+\-\d/]+) counter on this)?\.?$/);
        if (!r) continue;
        if (!r[1] && !r[4]) continue;   // the plain "X spells you cast cost {N} less" is already in costOf
        const per = r[4] ? ((o.counters || {})[r[4]] || 0) : 1;
        let ok;
        if (r[1]) ok = r[1].split(/ or /).some(w => matchesWhat(c, w.trim()));
        else {
          const filt = r[2].trim();
          if (/chosen type/.test(line)) ok = !!o.chosen && isType(c, 'creature') && new RegExp('\\b' + o.chosen + '\\b', 'i').test(typeLine(c)) && (!/creature/.test(filt) || isType(c, 'creature'));
          else ok = filt.split(/ and | or |, /).some(w => { w = w.replace(/\s*spells?$/, '').trim(); return w === 'noncreature' ? !isType(c, 'creature') : matchesWhat(Object.assign({}, c, { zone: 'stack' }), w); });
        }
        if (ok) n += +r[3] * per;
      }
    }
    return n;
  }
  // Ward's cost (702.21): "Ward {2}", "Ward—Pay 4 life", "Ward—Discard a card", "Ward—{3}, Pay 3 life", "Ward—Sacrifice a …".
  function wardCost(c) {
    const m = text(c).match(/\bward\s*(?:—|-|:)?\s*([^.\n]+)/i); if (!m) return null;
    const t = m[1].trim(), out = { text: t.replace(/^[A-Z]/, x => x.toLowerCase()), mana: 0, life: 0, discard: 0, sac: null };
    const mana = t.match(/^((?:\{[^}]+\})+)/); if (mana) out.mana = costTotal(parseCost(mana[1]), 0), out.manaText = mana[1];
    const life = t.match(/pay (\d+) life/i); if (life) out.life = +life[1];
    const dis = t.match(/discard (a|one|two) cards?/i); if (dis) out.discard = toNum(dis[1]) || 1;
    const sac = t.match(/sacrifice (?:a|an) ([a-z ]+)/i); if (sac) out.sac = sac[1].trim();
    return out;
  }
  // Every legal choice for a requirement, for menus and the AI.
  function targetChoices(s, req, by) {
    const out = [];
    if (req.kinds.includes('player')) for (const p of s.seats) if (legalTarget(s, req, { p }, by)) out.push({ p });
    for (const c of Object.values(s.cards)) if (legalTarget(s, req, { c: c.id }, by)) out.push({ c: c.id });
    return out;
  }

  // ---------- effects (what the table can do by itself when a spell resolves) ----------
  // Board wipes we can do exactly: "all creatures", "all nonland permanents", "all artifacts and enchantments", "all creatures you don't control"…
  const MASS = /^(?:non-?[a-z]+ )?(?:creatures|artifacts|enchantments|planeswalkers|permanents|lands|nonland permanents|artifacts and enchantments|creatures and planeswalkers|artifacts, creatures, and enchantments|other creatures)(?: you don't control| your opponents control)?$/;
  function effectsIn(str) {
    const out = [];
    let ti = 0;   // target index, in order of appearance
    let understood = true;
    const sentences = [];
    const VERB = /^(draws?|loses?|gains?|discards?|mills?|sacrifices?|creates?|scry|puts?|returns?|exiles?|destroys?|deals?|you (?:draw|lose|gain|create|scry|mill|discard|sacrifice|put|return))\b/i;
    // Abilities granted to a token in quotes ("It has “Sacrifice this creature: Add {C}.”") describe the token, not this effect.
    const str2 = str.replace(/\.?\s*(?:it|they) (?:has|have) ["“][^"”]*["”]\.?/gi, '.').replace(/["“][^"”]*["”]/g, 'that ability');
    for (const sent of str2.replace(/\.?\n/g, '. ').split(/\.\s+|\.$/).map(x => x.trim()).filter(Boolean)) {
      // "You draw two cards and you lose 2 life" / "Target player draws two cards and loses 2 life": one clause each.
      const parts = sent.split(/,? and (?=(?:you )?(?:draws?|loses? (?:\d|x|that|life)|gains? (?:\d|x|that|life)|discards?|mills?|sacrifices?|creates?|scry)\b)|, then (?=(?:you )?(?:draw|scry|lose|gain))/i);
      let subject = '';
      for (let i = 0; i < parts.length; i++) {
        let p = parts[i].trim();
        const sm = p.match(/^(target player|target opponent|each opponent|each player|you)\b/i);
        if (sm) subject = sm[1];
        else if (i > 0 && subject && /^(draws?|loses?|gains?|discards?|mills?|sacrifices?|creates?)\b/i.test(p)) p = (/^target/i.test(subject) ? '@T ' : '') + subject + ' ' + p;
        sentences.push(p);
      }
    }
    for (let raw of sentences) {
      // A clause that continues the previous one's target ("…draws two cards and loses 2 life") reuses it.
      const carried = raw.startsWith('@T ');
      if (carried) raw = raw.slice(3);
      const s = raw.toLowerCase();
      const nT = carried ? 0 : targetsIn(raw).length;
      const t0 = carried ? Math.max(0, ti - 1) : ti;
      let hit = false;
      let m;
      if ((m = s.match(/deals (\d+|x) damage to (any target|target [a-z ',]+?|each creature(?: and each planeswalker)?(?: you don't control| your opponents control)?|each other creature|each opponent|each player|you)(?: and (\d+|x) damage to (you|each opponent|target [a-z ]+))?$/))) {
        const n = m[1] === 'x' ? 'X' : +m[1];
        const to = m[2].startsWith('each creature') || m[2] === 'each other creature' ? (/don't control|opponents control/.test(m[2]) ? 'oppCreatures' : 'allCreatures') : m[2] === 'each opponent' ? 'eachOpp' : m[2] === 'each player' ? 'eachPlayer' : m[2] === 'you' ? 'you' : 't';
        out.push({ k: 'dmg', n, to, ti: to === 't' ? t0 : null });
        if (m[3]) { const n2 = m[3] === 'x' ? 'X' : +m[3]; out.push({ k: 'dmg', n: n2, to: m[4] === 'you' ? 'you' : m[4] === 'each opponent' ? 'eachOpp' : 't', ti: m[4].startsWith('target') ? t0 + 1 : null }); }
        hit = true;
      } else if (/,? then |\buntil\b|\bunless\b|\breturn\b|\binstead\b/.test(s) && /^(destroy|exile) /.test(s)) { hit = false; }
      else if ((m = s.match(/^destroy (target|up to (?:one|two|three) target|two target) /))) { out.push({ k: 'destroy', ti: t0, all: /two target|up to/.test(m[1]) }); hit = true; }
      else if ((m = s.match(/^destroy (?:all|each) ([a-z ',]+?)$/)) && MASS.test(m[1])) { out.push({ k: 'destroyAll', what: m[1] }); hit = true; }
      else if ((m = s.match(/^exile (target|up to one target|another target) /))) { out.push({ k: 'exile', ti: t0 }); hit = true; }
      else if ((m = s.match(/^attach this to target creature you control$/))) { out.push({ k: 'attachSrc', ti: t0 }); hit = true; }
      else if ((m = s.match(/^exile all ([a-z ',]+?)$/)) && MASS.test(m[1])) { out.push({ k: 'exileAll', what: m[1] }); hit = true; }
      else if ((m = s.match(/^return (?:target|up to one target|another target) [a-z ,']*? to (?:its|their) owner(?:'s|s'|s)? hands?$/))) { out.push({ k: 'bounce', ti: t0 }); hit = true; }
      else if ((m = s.match(/^its controller gains life equal to its power$/))) { out.push({ k: 'lifeEqPow', ti: t0 - 1 }); hit = true; }
      else if ((m = s.match(/^its controller may search their library for a basic land card, put (?:it|that card) onto the battlefield( tapped)?, then shuffle$/))) { out.push({ k: 'fetchCtrl', ti: t0 - 1, tapped: !!m[1] }); hit = true; }
      else if ((m = s.match(/^its controller investigates$/))) { out.push({ k: 'token', n: 1, what: 'clue', p: '', t: '', kws: '', forTargetCtrl: t0 - 1 }); hit = true; }
      else if ((m = s.match(/^its controller creates (a|an|one|two|three|\d+) (?:(\d+)\/(\d+) )?([a-z ,\-]+?) tokens?$/))) { out.push({ k: 'token', n: toNum(m[1]), p: m[2] || '', t: m[3] || '', what: m[4], kws: '', forTargetCtrl: t0 - 1 }); hit = true; }
      else if ((m = s.match(/deals damage equal to (?:its|the) power(?: of (?:target|another target) creature you control)? to (?:target|another target|up to one target) ([a-z ',]+)$/))) { out.push({ k: 'bite', ti: t0, ti2: t0 + 1 }); hit = true; }
      else if ((m = s.match(/^(?:permanents|creatures) you control gain ([a-z ,]+?) until end of turn$/))) { out.push({ k: 'grantAll', kws: m[1] }); hit = true; }
      else if ((m = s.match(/^return target ([a-z ]*?)card from your graveyard to your hand$/))) { out.push({ k: 'gyToHand', ti: t0 }); hit = true; }
      else if ((m = s.match(/^return target ([a-z ]*?)card from (?:your|a) graveyard to the battlefield(?: under your control)?( tapped)?$/))) { out.push({ k: 'reanimate', ti: t0, tapped: !!m[2] }); hit = true; }
      else if ((m = s.match(/^counter target ([a-z ]*?)spell$/))) { out.push({ k: 'counter', ti: t0 }); hit = true; }
      else if ((m = s.match(/^(?:target creature|target creature you control) gets ([+-]\d+|[+-]x)\/([+-]\d+|[+-]x)(?: and gains ([a-z ,]+?))? until end of turn$/))) { out.push({ k: 'pump', ti: t0, p: m[1], t: m[2], kws: m[3] || '' }); hit = true; }
      else if ((m = s.match(/^(?:target creature|target creature you control) gains ([a-z ,]+?) until end of turn$/))) { out.push({ k: 'grant', ti: t0, kws: m[1] }); hit = true; }
      else if ((m = s.match(/^creatures you control get ([+-]\d+)\/([+-]\d+)(?: and gain ([a-z ,]+?))? until end of turn$/))) { out.push({ k: 'pumpAll', p: m[1], t: m[2], kws: m[3] || '' }); hit = true; }
      else if ((m = s.match(/^creatures you control gain ([a-z ,]+?) until end of turn$/))) { out.push({ k: 'grantAll', kws: m[1] }); hit = true; }
      else if ((m = s.match(/^put (a|an|one|two|three|four|five|\d+|x) \+1\/\+1 counters? on (target creature|each creature you control|target creature you control)$/))) { out.push({ k: 'counters', n: toNum(m[1]), each: m[2].startsWith('each'), ti: m[2].startsWith('target') ? t0 : null }); hit = true; }
      else if ((m = s.match(/^tap (?:target|up to one target|up to two target|two target) /))) { out.push({ k: 'tap', ti: t0, all: true }); hit = true; }
      else if ((m = s.match(/^untap (?:target|up to one target|up to two target|two target) /))) { out.push({ k: 'untap', ti: t0, all: true }); hit = true; }
      else if ((m = s.match(/^tap all creatures your opponents control$/))) { out.push({ k: 'tapAllOpp' }); hit = true; }
      else if ((m = s.match(/^target creature you control deals damage equal to its power to (?:target|another target) ([a-z ',]+)$/))) { out.push({ k: 'bite', ti: t0, ti2: t0 + 1 }); hit = true; }
      else if ((m = s.match(/^target creature you control fights (?:target|another target) ([a-z ',]+)$/))) { out.push({ k: 'fight', ti: t0, ti2: t0 + 1 }); hit = true; }
      else if ((m = s.match(/^create (a|an|one|two|three|four|five|x|\d+) (tapped )?(?:(\d+)\/(\d+) )?([a-z ,\-]+?) tokens?(?: with ([a-z ,]+?))?(?: that [^.]*)?$/))) {
        out.push({ k: 'token', n: toNum(m[1]), tapped: !!m[2], p: m[3] || '', t: m[4] || '', what: m[5], kws: m[6] || '' }); hit = true;
      } else if ((m = s.match(/^(?:then )?(target player|target opponent|each player|you)? ?draws? (a|one|two|three|four|five|\d+|x) cards?$/)) || (m = s.match(/^(?:then )?(you)? ?draw (a|one|two|three|four|five|\d+|x) cards?$/))) {
        const who = !m[1] || m[1] === 'you' ? 'you' : m[1] === 'each player' ? 'each' : 't';
        out.push({ k: 'draw', n: toNum(m[2]), who, ti: who === 't' ? t0 : null }); hit = true;
      } else if ((m = s.match(/^(target player|target opponent|you|each opponent|each player) (?:gains?) (\d+|x) life$/))) { out.push({ k: 'life', n: toNum(m[2]), who: m[1], sign: 1, ti: m[1].startsWith('target') ? t0 : null }); hit = true; }
      else if ((m = s.match(/^(target player|target opponent|you|each opponent|each player) loses? (\d+|x) life(?: and you gain (\d+|x) life| and you gain life equal to the life lost this way)?$/))) {
        out.push({ k: 'life', n: toNum(m[2]), who: m[1], sign: -1, ti: m[1].startsWith('target') ? t0 : null });
        if (m[3] || /life lost this way/.test(s)) out.push({ k: 'life', n: m[3] ? toNum(m[3]) : 'LOST', who: 'you', sign: 1 });
        hit = true;
      } else if ((m = s.match(/^you gain (\d+|x) life$/))) { out.push({ k: 'life', n: toNum(m[1]), who: 'you', sign: 1 }); hit = true; }
      else if ((m = s.match(/^search your library for (up to )?(a|one|two|three|\d+) basic lands? cards?(?:[^,]*)?, (?:reveal (?:it|them|those cards), )?(?:and )?put (it|them|one|one of them|that card|those cards) (onto the battlefield|into your hand)( tapped)?(?: and the other into your hand)?(?:, then shuffle)?$/))) {
        out.push({ k: 'fetch', n: toNum(m[2]), dest: /hand/.test(m[4]) ? 'hand' : 'battlefield', tapped: !!m[5], split: /the other into your hand/.test(s) }); hit = true;
      } else if ((m = s.match(/^scry (\d+|x)$/))) { out.push({ k: 'scry', n: toNum(m[1]) }); hit = true; }
      else if ((m = s.match(/^surveil (\d+|x|one|two|three)$/))) { out.push({ k: 'surveil', n: toNum(m[1]) }); hit = true; }
      else if ((m = s.match(/^exile (?:all cards from )?target player's graveyard$/))) { out.push({ k: 'exileGy', ti: t0 }); hit = true; }
      else if ((m = s.match(/^sacrifice this unless you sacrifice (a|an|one|two) ([a-z ]+)$/))) { out.push({ k: 'sacUnless', n: toNum(m[1]), what: m[2] }); hit = true; }
      else if ((m = s.match(/^(target player|each opponent|each player) mills (\d+|a|two|three|four|five) cards?$/))) { out.push({ k: 'mill', n: toNum(m[2]), who: m[1], ti: m[1] === 'target player' ? t0 : null }); hit = true; }
      else if ((m = s.match(/^(target player|target opponent|each opponent|each player) discards (a|one|two|three|\d+) cards?$/))) { out.push({ k: 'discard', n: toNum(m[2]), who: m[1], ti: m[1].startsWith('target') ? t0 : null }); hit = true; }
      else if ((m = s.match(/^add ((?:\{[wubrgc]\})+)$/))) { out.push({ k: 'addMana', units: m[1].match(/[wubrgc]/g).map(x => x.toUpperCase()) }); hit = true; }
      else if ((m = s.match(/^add (one|two|three) mana of any (?:one )?color$/))) { out.push({ k: 'addMana', units: Array(toNum(m[1])).fill('WUBRG') }); hit = true; }
      else if ((m = s.match(/^return (a|an|one|two) ([a-z ]+?) you control to (?:its|their) owner's hand$/))) { out.push({ k: 'returnOwn', n: toNum(m[1]), what: m[2] }); hit = true; }
      else if ((m = s.match(/^(each opponent|each player|each other player|target player|target opponent) sacrifices (a|an|one|two) ([a-z ]+?)(?: of (?:their|his or her) choice)?$/))) { out.push({ k: 'sacrifice', n: toNum(m[2]), what: m[3], who: m[1], ti: m[1].startsWith('target') ? t0 : null }); hit = true; }
      else if (/^(shuffle|then shuffle|it can't be regenerated|they can't be regenerated|this spell can't be countered|this spell costs)/.test(s)) { hit = true; }
      // "Destroy target artifact, target creature, target enchantment, and target land": one effect, several targets.
      if (nT > 1 && !out.some(e => e.ti === t0 + 1)) for (const e of out) if (e.ti === t0 && ['destroy', 'exile', 'bounce', 'tap', 'untap', 'dmg'].includes(e.k) && e.ti2 == null && !e.tis) e.tis = Array.from({ length: nT }, (_, k) => t0 + k);
      ti = carried ? ti : t0 + nT;
      if (!hit) understood = false;
    }
    return { effects: out, understood };
  }
  function effectsOf(c, mode) {
    const r = effectsOf0(c, mode);
    if (r.understood && c && targetReqs(c, mode).some(q => q.complex)) r.understood = false;
    return r;
  }
  function effectsOf0(c, mode) {
    if (!c) return { effects: [], understood: false };
    if (c.ab) return effectsIn(c.ab.text || '');
    if (isPermanentCard(c)) return { effects: [], understood: true };
    const md = modesOf(c);
    if (md) {
      if (mode == null) return { effects: [], understood: false };
      return effectsIn([].concat(mode).map(i => md.modes[i]).filter(Boolean).join('. '));
    }
    return effectsIn(spellText(c));
  }

  // Activated abilities written on a permanent: "{2}, {T}: Draw a card." → [{cost, tap, text}]
  function abilities(c) {
    const out = [];
    for (const line of lines(c)) {
      const m = line.match(/^((?:\{[^}]+\}|,|\s|tap|sacrifice this[a-z ]*|sacrifice (?:an?|another) [a-z ]+?|discard a card|pay \d+ life|remove [a-z ]+ counters? from this[a-z ]*)+?):\s*(.+)$/i);
      if (!m) continue;
      const sacOther = (m[1].match(/sacrifice (?:an?|another) ([a-z ]+?)\s*(?:,|$)/i) || [])[1] || null;
      const life = +((m[1].match(/pay (\d+) life/i) || [])[1] || 0);
      // Tap-only mana abilities are used by tapping the card; ones with other costs (Kykar's "Sacrifice a Spirit: Add {R}") are in the menu.
      if (/^add\b/i.test(m[2]) && !sacOther && !life && !/\{\d+\}/.test(m[1])) continue;
      out.push({ cost: m[1].trim(), tap: /\{T\}/.test(m[1]), sac: /sacrifice this/i.test(m[1]), sacOther: sacOther && sacOther.trim(), life, manaAb: /^add\b/i.test(m[2]), mana: parseCost(m[1].replace(/\{T\}|\{Q\}/g, '')), text: m[2].trim() });
    }
    // Crew N (702.122): tap untapped creatures with total power N or more — the Vehicle becomes an artifact creature until end of turn.
    for (const line of lines(c)) {
      const m = line.match(/^crew (\d+)/i);
      if (m) out.push({ cost: 'Crew ' + m[1], crew: +m[1], tap: false, sac: false, mana: parseCost(''), text: 'This becomes an artifact creature until end of turn.' });
    }
    // Equip {N}: attach to a creature you control, only as a sorcery (702.6).
    for (const line of lines(c)) {
      const m = line.match(/^equip(?: [a-z ]+)? ((?:\{[^}]+\})+)/i);
      if (m && !/^equip\b[^{]*—/i.test(line)) out.push({ cost: 'Equip ' + m[1], equip: true, tap: false, sac: false, mana: parseCost(m[1]), text: 'Attach this to target creature you control.' });
    }
    // Planeswalker loyalty abilities: "+1: …", "−3: …"
    if (isType(c, 'planeswalker')) for (const line of lines(c)) {
      const m = line.match(/^\[?([+−\-]?\d+|0|[+−\-]x)\]?:\s*(.+)$/i);
      if (m) out.push({ cost: m[1], loyalty: /x/i.test(m[1]) ? 0 : +m[1].replace('−', '-'), loyaltyX: /x/i.test(m[1]) || undefined, text: m[2].trim(), mana: parseCost('') });
    }
    return out;
  }

  // Triggered abilities written on a card: "When this enters, …", "Whenever this attacks, …", "At the beginning of your upkeep, …"
  function triggers(c) {
    const out = [];
    for (const line of lines(c)) {
      let m = line.match(/^(when|whenever) this (?:creature |permanent |artifact |enchantment |land |aura |equipment |vehicle |saga |planeswalker )?(enters(?: the battlefield)?|attacks|dies|blocks|deals combat damage to a player)(?: or (?:attacks|dies|blocks))?,\s*(.+)$/i);
      if (m) { const ev = /enters/i.test(m[2]) ? 'etb' : /attacks/i.test(m[2]) ? 'attack' : /dies/i.test(m[2]) ? 'dies' : /blocks/i.test(m[2]) ? 'block' : 'combatDamage'; out.push({ ev, text: m[3].trim(), line }); if (/or attacks/i.test(line) && ev === 'etb') out.push({ ev: 'attack', text: m[3].trim(), line }); continue; }
      m = line.match(/^at the beginning of (your|each) (upkeep|end step|combat on your turn)(?:,|\s)\s*(.+)$/i);
      if (m) { out.push({ ev: /upkeep/i.test(m[2]) ? 'upkeep' : /end/i.test(m[2]) ? 'end' : 'combat', each: /each/i.test(m[1]), text: m[3].trim(), line }); continue; }
      m = line.match(/^(when|whenever) ([^,]+?),\s*(.+)$/i);
      if (m) out.push({ ev: 'other', when: m[2], text: m[3].trim(), line });
    }
    return out;
  }

  // Does this permanent have flash, or is it an instant? (can be cast at any time you have priority)
  function instantSpeed(c) { return /\binstant\b/i.test(typeLine(c)) || has(c, 'flash'); }

  // Spree: the extra mana for the modes chosen.
  function spreeCost(c, mode) { const md = modesOf(c); if (!md || !mode) return null; if (md.escalate) return parseCost(Array(Math.max(0, [].concat(mode).length - 1)).fill(md.escalate).join('')); if (!md.spree) return null; return parseCost([].concat(mode).map(i => md.spree[i] || '').join('')); }
  root.Cards = { freeFromHand, spreeCost, discardCost, freeWithCommander, levelText, modePick, sacCost, costReduction, KEYWORDS, colorsOf, face, typeLine, isType, nameOf, text, rawText, keywords, has, statics, pt, parseCost, costOf, manaValue, costTotal, manaSource, pay,
    setState, notCreatureNow, wardCost, targetReqs, targetsIn, legalTarget, targetChoices, reqLabel, protections, protectedFrom, blockProblem, matchesWhat, helpfulTarget, orderChoices, modesOf, effectsIn, effectsOf, abilities, triggers, instantSpeed, isPermanentCard, toNum, spellText };
})(typeof window !== 'undefined' ? window : globalThis);
