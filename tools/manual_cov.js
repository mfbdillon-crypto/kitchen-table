global.window = global; global.localStorage = { getItem() { return null; }, setItem() {} };
const base = '/home/claude/mtg/site/';
for (const f of ['cards', 'scry', 'effects', 'oracle', 'rules', 'engine', 'precons', 'aiprofiles']) require(base + f + '.js');
const fs = require('fs');
const db = {}; for (const c of JSON.parse(fs.readFileSync('/home/claude/mtg/data/forgecards.json', 'utf8'))) db[c.name] = c;
const decks = KT_PRECONS;
const key = new Set(); for (const p of Object.values(KT_AI_PROFILES)) for (const k of [].concat(p.key || [], p.finishers || [], p.wipes || [])) key.add(k);
const out = [];
const engSrc = fs.readFileSync(base + 'engine.js', 'utf8');
const handled = new Set([...engSrc.matchAll(/case '([a-zA-Z]+)'/g)].map(m => m[1]).concat(['if', 'instead', 'reflexive', 'crew']));
const unknownOps = o => { const outU = []; const walk = x => { if (Array.isArray(x)) return x.forEach(walk); if (x && typeof x === 'object') { if (x.op && !handled.has(x.op)) outU.push('[' + x.op + '] ' + (x.src || x.text || '')); for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v); } }; walk(o); return outU; };
for (const [di, pc] of decks.entries()) {
  for (const ent of pc.list.split('|')) {
    const name = ent.replace(/^\d+\s+/, ''); const sc = db[name] || db[name.split(' // ')[0]]; if (!sc) continue;
    const d = Scry.toD(sc);
    const card = { id: 'x', d, face: 0, counters: {}, zone: 'hand' };
    const m = Oracle.model(card);
    const texts = [];
    const oldOk = mode => { try { const e = Cards.effectsOf(card, mode); return e.understood && e.effects.length; } catch (e) { return false; } };
    for (const a of m.abilities) if ((a.kind === 'triggered' || a.kind === 'activated') && a.effect) { const mm = a.effect.match(/choose (?:one|two|three|one or more|one or both) ?(?:—|-)\s*([\s\S]*)$/i); if (mm) mm[1].split(/\n|•/).map(x => x.trim()).filter(Boolean).forEach(x => texts.push([a.kind + '-mode', x])); else texts.push([a.kind, a.effect]); }
    if (/instant|sorcery/i.test(m.typeLine)) { const md = Cards.modesOf(card); if (md) md.modes.forEach((x, i) => { if (!oldOk([i])) texts.push(['spell-mode', x.replace(/^[^—]{1,30} — /, ''), i]); }); else texts.push(['spell', Cards.spellText(card)]); }
    for (const [k, t, mi] of texts) {
      if (k === 'spell' && oldOk(null)) continue;
      let r; try { r = Effects.parse(t); } catch (e) { r = { ops: [{ op: 'manual', text: 'CRASH ' + e.message }] }; }
      const man = (r.ops || []).filter(o => o.op === 'manual');
      const deep = (JSON.stringify(r.ops).match(/"op":"manual","text":"([^"]+)"/g) || []).concat(unknownOps(r.ops).map(x => '"op":"manual","text":"' + x + '"'));
      if (deep.length) out.push({ deck: di, name, key: key.has(name), k, text: deep.map(x => x.replace(/^"op":"manual","text":"/, '').replace(/"$/, '')).join(' | ') });
    }
  }
}
const uniq = {}; for (const o of out) { const k = o.name + o.text; if (!uniq[k]) uniq[k] = Object.assign({ decks: [] }, o); uniq[k].decks.push(o.deck); }
const list = Object.values(uniq).sort((a, b) => b.key - a.key || a.deck - b.deck);
console.log('manual pieces:', list.length, 'key cards:', list.filter(x => x.key).length);
for (const o of list) console.log((o.key ? '★ ' : '  ') + `[${[...new Set(o.decks)].join(',')}] ${o.name} (${o.k}): ${o.text.slice(0, 160)}`);
