// Kitchen Table — what an ability DOES. Turns effect text ("Put a +1/+1 counter on it. Each opponent loses 1 life.")
// into a list of operations the rules engine carries out, in order. Pronouns are kept symbolic
// ("this", "it" = the card the trigger is about, "that player"), amounts can be variables ("where X is …").
// Anything not understood becomes { op: 'manual', text } so the player is asked to finish it by hand.
(function (root) {
  'use strict';
  const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fifteen: 15, twenty: 20, x: 'X', that: 'THAT' };
  const amt = w => { w = String(w || '').toLowerCase().trim(); if (/^\d+$/.test(w)) return +w; if (w === 'that many') return { v: 'thatMany' }; return NUMW[w] !== undefined ? (NUMW[w] === 'X' ? { v: 'X' } : NUMW[w] === 'THAT' ? { v: 'thatMany' } : NUMW[w]) : null; };
  const COUNTER = /([+-]\d+\/[+-]\d+|[a-z]+(?: [a-z]+)?)/;
  // Players and objects a clause can talk about.
  function who(s) {
    s = s.trim();
    if (/^(you|your)$/.test(s)) return { k: 'you' };
    if (/^each opponent$|^your opponents$|^each of your opponents$/.test(s)) return { k: 'eachOpp' };
    if (/^each player$|^all players$/.test(s)) return { k: 'eachPlayer' };
    if (/^each other player$/.test(s)) return { k: 'eachOther' };
    if (/^that player$|^they$|^that opponent$|^the defending player$|^defending player$/.test(s)) return { k: 'evPlayer' };
    if (/^its controller$|^that creature's controller$|^that permanent's controller$|^their controller$/.test(s)) return { k: 'controllerOf', of: { k: 'ev' } };
    if (/^its owner$|^their owners?$/.test(s)) return { k: 'ownerOf', of: { k: 'ev' } };
    if (/^enchanted (?:creature|permanent)'s controller$|^enchanted player$/.test(s)) return { k: 'controllerOf', of: { k: 'attached' } };
    if (/^target (?:player|opponent)$/.test(s)) return { k: 't' };
    return null;
  }
  function obj(s) {
    s = s.trim().replace(/^the /, '');
    if (/^(this|it|itself)$/.test(s) && s === 'this') return { k: 'self' };
    if (/^(it|that creature|that card|that permanent|them|those cards|those creatures|that land|that token|the token|that spell)$/.test(s)) return { k: 'ev' };
    if (/^(enchanted|equipped) (creature|permanent|land|artifact)$/.test(s)) return { k: 'attached' };
    let m;
    if ((m = s.match(/^(?:up to (\w+) )?(?:(\w+) )?(?:other |another )?target (.+)$/))) return { k: 't', upTo: !!m[1], n: amt(m[1] || m[2] || 1) || 1, what: m[3] };
    if (s === 'any target') return { k: 't', what: 'any target' };
    if ((m = s.match(/^each (other )?(.+?)(?: you control| your opponents control| an opponent controls| target player controls| that player controls)?$/))) return { k: 'each', other: !!m[1], what: m[2], ctrl: /you control/.test(s) ? 'you' : /opponents? control/.test(s) ? 'opp' : /that player controls/.test(s) ? 'evPlayer' : 'any' };
    if ((m = s.match(/^all (other )?(.+?)(?: you control| your opponents control)?$/))) return { k: 'each', other: !!m[1], what: m[2], ctrl: /you control/.test(s) ? 'you' : /opponents control/.test(s) ? 'opp' : 'any' };
    if ((m = s.match(/^(other )?((?:[a-z]+ )*?(?:creatures|permanents|artifacts|enchantments|lands|tokens|[a-z]+s)) you control$/))) return { k: 'each', other: !!m[1], what: m[2], ctrl: 'you' };
    if ((m = s.match(/^attacking creatures(?: you control)?$/))) return { k: 'each', what: 'attacking creature', ctrl: /you control/.test(s) ? 'you' : 'any' };
    if (/^this$/.test(s)) return { k: 'self' };
    if ((m = s.match(/^(other )?([a-z ]+?) you control with ([a-z ]+)$/))) return { k: 'each', other: !!m[1], what: m[2], ctrl: 'you', with: m[3] };
    return null;
  }
  // "X" after "where X is …" / "equal to …".
  function variable(s) {
    s = String(s || '').trim().replace(/\.$/, '');
    let m;
    if ((m = s.match(/^the number of (.+?) you control$/))) return { v: 'count', what: m[1], ctrl: 'you' };
    if ((m = s.match(/^the number of (.+?) (?:your opponents control|an opponent controls)$/))) return { v: 'count', what: m[1], ctrl: 'opp' };
    if ((m = s.match(/^the number of (.+?) on the battlefield$/))) return { v: 'count', what: m[1], ctrl: 'any' };
    if ((m = s.match(/^the number of cards in your hand$/))) return { v: 'hand' };
    if ((m = s.match(/^the number of (.+?) cards? in your graveyard$/))) return { v: 'gy', what: m[1] };
    if (/^the number of cards in your graveyard$/.test(s)) return { v: 'gy', what: 'card' };
    if (/^(?:that spell's|its|the) mana value(?: of (?:that spell|it))?$|^the mana value of that spell$/.test(s)) return { v: 'evMV' };
    if (/^(?:that creature's|its) power$|^the sacrificed creature's power$/.test(s)) return { v: 'evPower' };
    if (/^(?:that creature's|its) toughness$/.test(s)) return { v: 'evToughness' };
    if (/^this's power$/.test(s)) return { v: 'selfPower' };
    if (/^this's toughness$/.test(s)) return { v: 'selfToughness' };
    if (/^the (?:life lost|damage dealt) this way$/.test(s)) return { v: 'lastAmount' };
    if (/^the amount of mana spent to cast (?:that spell|this spell|it)$/.test(s)) return { v: 'evMV' };
    if ((m = s.match(/^the greatest power among creatures you control$/))) return { v: 'maxPower' };
    if ((m = s.match(/^the number of (?:opponents you have|your opponents)$/))) return { v: 'opponents' };
    if ((m = s.match(/^the number of (\w+) counters on this$/))) return { v: 'selfCounters', kind: m[1] };
    if ((m = s.match(/^the number of (.+)$/)) && !/\b(?:it|this way|devoured|exiled|that|those|this turn)\b/.test(m[1])) return { v: 'count', what: m[1], ctrl: /you control/.test(m[1]) ? 'you' : 'any' };
    return null;
  }
  function tokenSpec(s) {
    // "a 1/1 white Spirit creature token with flying", "two tapped Treasure tokens", "X 1/1 red Goblin creature tokens"
    s = s.trim();
    let m = s.match(/^(an?|one|two|three|four|five|six|x|that many|\d+) (tapped )?(?:(\d+|x)\/(\d+|x) )?(.+?) tokens?(?: with (.+?))?(?: (?:that are|that's) (tapped and attacking|attacking))?$/);
    if (!m) return null;
    const desc = m[5].trim(), kws = (m[6] || '').replace(/^"|"$/g, '').trim();
    const named = /^(treasure|clue|food|blood|map|gold|powerstone|incubator|shard|junk|lander|mutagen|eldrazi spawn|eldrazi scion)/.exec(desc);
    const colors = []; for (const [w, c] of Object.entries({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' })) if (new RegExp('\\b' + w + '\\b').test(desc)) colors.push(c);
    const types = desc.replace(/\b(white|blue|black|red|green|colorless|and)\b/g, ' ').replace(/\s+/g, ' ').trim();
    return { n: amt(m[1]) || 1, tapped: !!m[2], p: m[3] || null, t: m[4] || null, desc, colors, types, kws, named: named ? named[1] : null, attacking: !!m[7] };
  }

  // ---------------- one clause ----------------
  function clause(raw, st) {
    let s = raw.trim().replace(/\.$/, '').replace(/^then,? /, '').trim();
    let optional = false, ifDid = false, m;
    if ((m = s.match(/^if you do,? (.+)$/))) { ifDid = true; s = m[1]; }
    if ((m = s.match(/^you may (.+)$/))) { optional = true; s = m[1]; }
    const wrap = op => op && Object.assign(op, optional ? { optional: true } : {}, ifDid ? { ifDid: true } : {});
    // Subject + verb.
    let subj = { k: 'you' }, body = s;
    const sm = s.match(/^(you|each opponent|each player|each other player|target player|target opponent|that player|they|its controller|its owner|that creature's controller|enchanted creature's controller|defending player|the defending player|that opponent) (.+)$/);
    if (sm) { subj = who(sm[1]); body = sm[2]; if (subj.k === 't') subj.i = st.ti++; }
    // Damage: "this deals 3 damage to any target", "it deals X damage to each creature without flying".
    if ((m = s.match(/^(this|it|that creature|enchanted creature|equipped creature) deals (\d+|x|that much) damage to (.+?)(?: and (\d+|x) damage to (.+))?$/)) || (m = s.match(/^(this|it) deals damage equal to (.+?) to (.+)$/))) {
      const eq = /damage equal to/.test(s);
      const n = eq ? variable(m[2]) : m[2] === 'that much' ? { v: 'thatMany' } : amt(m[2]);
      const to = targetOf(m[3], st);
      st.lastTo = to;
      const ops = [{ op: 'dmg', src: m[1] === 'this' ? 'self' : 'ev', n, to }];
      if (!eq && m[4]) ops.push({ op: 'dmg', src: m[1] === 'this' ? 'self' : 'ev', n: amt(m[4]), to: targetOf(m[5], st) });
      return ops.map(wrap);
    }
    if ((m = s.match(/^(?:this|it) deals (\d+|x) damage$/)) && st.lastTo) return [wrap({ op: 'dmg', src: 'self', n: amt(m[1]), to: st.lastTo })];
    // Players.
    if ((m = body.match(/^draws? (\w+|x) cards?$/)) || (m = body.match(/^draws? a card$/))) return [wrap({ op: 'draw', who: subj, n: m[1] ? amt(m[1]) : 1 })];
    if ((m = body.match(/^draws? cards equal to (.+)$/))) return [wrap({ op: 'draw', who: subj, n: variable(m[1]) })];
    if ((m = body.match(/^draws? a card for each (.+)$/)) && !/\b(?:it|this way|devoured|exiled|that|those)\b/.test(m[1])) return [wrap({ op: 'draw', who: subj, n: { v: 'count', what: m[1].replace(/ you control$/, ''), ctrl: /you control/.test(m[1]) ? 'you' : 'any' } })];
    if ((m = body.match(/^draws? that many cards$/))) return [wrap({ op: 'draw', who: subj, n: { v: 'thatMany' } })];
    if ((m = body.match(/^draws? an additional card$/))) return [wrap({ op: 'draw', who: subj, n: 1 })];
    if ((m = body.match(/^discards? (\w+) cards?(?: at random)?$/)) || (m = body.match(/^discards? a card(?: at random)?$/))) return [wrap({ op: 'discard', who: subj, n: m[1] ? amt(m[1]) : 1, random: /at random/.test(body) })];
    if (/^discards? (?:your|their) hand$/.test(body)) return [wrap({ op: 'discard', who: subj, n: 99, all: true })];
    if ((m = body.match(/^mills? (\w+) cards?$/))) return [wrap({ op: 'mill', who: subj, n: amt(m[1]) })];
    if ((m = body.match(/^gains? (\d+|x|that much) life$/))) return [wrap({ op: 'life', who: subj, n: m[1] === 'that much' ? { v: 'lastAmount' } : amt(m[1]), sign: 1 })];
    if ((m = body.match(/^gains? life equal to (.+)$/))) return [wrap({ op: 'life', who: subj, n: variable(m[1]), sign: 1 })];
    if ((m = body.match(/^gains? (\d+) life for each (.+)$/))) return [wrap({ op: 'life', who: subj, n: { v: 'count', what: m[2], ctrl: 'you', times: +m[1] }, sign: 1 })];
    if ((m = body.match(/^loses? (\d+|x|that much) life$/))) return [wrap({ op: 'life', who: subj, n: amt(m[1]) || { v: 'lastAmount' }, sign: -1 })];
    if ((m = body.match(/^loses? life equal to (.+)$/))) return [wrap({ op: 'life', who: subj, n: variable(m[1]), sign: -1 })];
    if ((m = body.match(/^loses? (\d+) life for each (.+)$/))) return [wrap({ op: 'life', who: subj, n: { v: 'count', what: m[2], ctrl: 'any', times: +m[1] }, sign: -1 })];
    if ((m = body.match(/^(?:each )?(?:sacrifices?) (an?|one|two|three) (.+?)(?: of (?:their|his or her) choice)?$/))) return [wrap({ op: 'sacrifice', who: subj, n: amt(m[1]), what: m[2] })];
    if ((m = body.match(/^sacrifices? (this|it|that creature|that permanent|enchanted creature|another permanent|another creature)$/))) return [wrap({ op: 'sacrifice', who: subj, n: 1, what: m[1] === 'this' ? { k: 'self' } : /another/.test(m[1]) ? m[1].replace('another ', '') : obj(m[1]), other: /another/.test(m[1]) })];
    if ((m = body.match(/^scry (\d+|x|one|two|three)$/))) return [wrap({ op: 'scry', who: subj, n: amt(m[1]) })];
    if ((m = body.match(/^surveil (\d+|one|two|three)$/))) return [wrap({ op: 'surveil', who: subj, n: amt(m[1]) })];
    if (/^(?:become|becomes) the monarch$/.test(body)) return [wrap({ op: 'monarch', who: subj })];
    if (/^takes? the initiative$/.test(body)) return [wrap({ op: 'initiative', who: subj })];
    if ((m = s.match(/^investigate(?: (\w+) times)?$/))) return [wrap({ op: 'token', who: { k: 'you' }, spec: { n: m[1] ? amt(m[1]) : 1, named: 'clue', desc: 'Clue artifact', types: 'Clue artifact' } })];
    if (/^proliferate$/.test(s)) return [wrap({ op: 'proliferate' })];
    if ((m = s.match(/^amass (\w+) (\d+|x)$/))) return [wrap({ op: 'amass', type: m[1].replace(/s$/, ''), n: amt(m[2]) })];
    if ((m = s.match(/^(?:it|this|target creature you control) explores$/))) return [wrap({ op: 'explore', what: /target/.test(s) ? { k: 't', i: st.ti++ } : obj(m[0].split(' ')[0]) })];
    if (/^(?:this|it) connives$/.test(s)) return [wrap({ op: 'draw', who: { k: 'you' }, n: 1 }), wrap({ op: 'discard', who: { k: 'you' }, n: 1 })];
    if ((m = s.match(/^shuffle (?:your|their) graveyard into (?:your|their) library$/))) return [wrap({ op: 'shuffleGy', who: subj })];
    if ((m = s.match(/^untap (?:up to (\w+) )?(lands|lands you control|all lands you control|target (.+)|this|it|that creature|all creatures you control)$/))) return [wrap({ op: 'untap', what: m[3] ? { k: 't', i: st.ti++, what: m[3] } : /^lands/.test(m[2]) ? { k: 'chooseUntap', n: amt(m[1]) || 99, what: 'land' } : /all/.test(m[2]) ? { k: 'each', what: m[2].replace(/^all /, '').replace(/ you control$/, ''), ctrl: 'you' } : obj(m[2]) })];
    if ((m = s.match(/^tap (?:up to (\w+) )?(target .+|this|it|that creature|all creatures your opponents control|each creature your opponents control|all lands that player controls)$/))) return [wrap({ op: 'tap', what: targetOf(m[2], st) })];
    if ((m = s.match(/^add ((?:\{[wubrgc]\})+)$/))) return [wrap({ op: 'addMana', units: m[1].match(/[wubrgc]/g).map(x => x.toUpperCase()) })];
    if ((m = s.match(/^add (one|two|three) mana of any (?:one )?color$/))) return [wrap({ op: 'addMana', units: Array(amt(m[1])).fill('WUBRG') })];
    // Tokens.
    if ((m = body.match(/^creates? (.+)$/))) {
      const tm = m[1].match(/^a token that's a copy of (.+?)(?:,? except .+)?$/);
      if (tm) return [wrap({ op: 'copyToken', who: subj, of: targetOf(tm[1], st) })];
      const forEach = m[1].match(/^(.+?) for each (.+)$/);
      const spec = tokenSpec(forEach ? forEach[1] : m[1].replace(/, where x is .+$/, ''));
      if (spec) { if (forEach) spec.n = { v: 'count', what: forEach[2].replace(/ you control$/, ''), ctrl: /you control/.test(forEach[2]) ? 'you' : 'any' }; return [wrap({ op: 'token', who: subj, spec })]; }
    }
    // Counters.
    if ((m = s.match(/^put (\w+|x|that many) (\+1\/\+1|-1\/-1|[a-z]+(?: [a-z]+)?) counters? on (.+)$/))) {
      const on = targetOf(m[3], st);
      return [wrap({ op: 'counters', n: m[1] === 'that many' ? { v: 'thatMany' } : amt(m[1]), kind: m[2], on })];
    }
    if ((m = s.match(/^double the number of (.+?) counters on (.+)$/))) return [wrap({ op: 'doubleCounters', kind: m[1], on: targetOf(m[2], st) })];
    if ((m = s.match(/^remove (\w+) (.+?) counters? from (.+)$/))) return [wrap({ op: 'counters', n: -(amt(m[1]) || 1), kind: m[2], on: targetOf(m[3], st) })];
    // Pump / grant (until end of turn = a temporary badge).
    if ((m = s.replace(/ until end of turn$/, '').match(/^(.+?) (?:gets|get) ([+-]\d+|[+-]x)\/([+-]\d+|[+-]x)(?: and (?:gains?|has|have) (.+?))?$/))) {
      const what = targetOf(m[1], st); if (what) return [wrap({ op: 'pump', what, p: m[2], t: m[3], kws: m[4] || '', eot: /until end of turn/.test(s) })];
    }
    if ((m = s.replace(/ until (?:end of turn|your next turn)$/, '').match(/^(.+?) (?:gains?|has|have) (protection from [a-z ,]+|[a-z ,]+?)$/)) && !/"/.test(s)) {
      const what = targetOf(m[1], st); if (what && m[2].length < 60) return [wrap({ op: 'grant', what, kws: m[2], eot: /until end of turn/.test(s), untilNext: /until your next turn/.test(s) })];
    }
    // Zone changes.
    if ((m = s.match(/^destroy (.+)$/))) { const what = targetOf(m[1].replace(/\. it can't be regenerated$|\. they can't be regenerated$/, ''), st); if (what) return [wrap({ op: 'destroy', what })]; }
    if ((m = s.match(/^exile (.+?), then return (?:it|that card|those cards|them) to the battlefield(?: tapped)? under (its owner's|their owners'|your) control$/))) return [wrap({ op: 'flicker', what: targetOf(m[1], st), control: /your/.test(m[2]) ? 'you' : 'owner' })];
    if ((m = s.match(/^exile (.+)$/)) && !/top|library/.test(m[1])) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'move', what, to: 'exile' })]; }
    if ((m = s.match(/^return (.+?) (?:from (?:your|a|their) graveyard )?to (?:its owner's|their owners'|your|their) hands?$/))) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'move', what, to: 'hand' })]; }
    if ((m = s.match(/^return (.+?) from (?:your|a|their) graveyard to the battlefield( tapped)?(?: under your control)?$/))) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'move', what, to: 'battlefield', tapped: !!m[2], control: 'you' })]; }
    if ((m = s.match(/^return (this|it) from your graveyard to your hand$/))) return [wrap({ op: 'move', what: obj(m[1]), to: 'hand' })];
    if ((m = s.match(/^put (.+?) onto the battlefield( tapped)?(?: under your control)?$/)) && !/from your hand|from among|library/.test(m[1])) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'move', what, to: 'battlefield', tapped: !!m[2], control: 'you' })]; }
    if ((m = s.match(/^counter (target .+)$/))) return [wrap({ op: 'counterSpell', what: targetOf(m[1], st) })];
    if ((m = s.match(/^(.+?) fights? (.+)$/))) { const a = targetOf(m[1], st), b = targetOf(m[2], st); if (a && b) return [wrap({ op: 'fight', a, b })]; }
    if (/^transform (this|it)$/.test(s)) return [wrap({ op: 'transform', what: { k: 'self' } })];
    // Library.
    if ((m = s.match(/^search your library for (up to )?(an?|one|two|three|four|five|\w+) (.+?) cards?(?: with [^,]+)?, (?:reveal (?:it|them|that card|those cards), )?(?:and )?put (?:it|them|that card|those cards|one of them|one) (into your hand|onto the battlefield)( tapped)?(?:(?: and the other| and the rest) into your hand)?(?:, then shuffle)?$/))) {
      return [wrap({ op: 'search', n: amt(m[2]) || 1, upTo: !!m[1], filter: m[3], dest: /hand/.test(m[4]) ? 'hand' : 'battlefield', tapped: !!m[5], split: /the other into your hand/.test(s) })];
    }
    if ((m = s.match(/^look at the top (\w+) cards? of your library/))) return [wrap({ op: 'look', n: amt(m[1]), text: raw })];
    if ((m = s.match(/^reveal the top (\w+) cards? of your library/))) return [wrap({ op: 'look', n: amt(m[1]), reveal: true, text: raw })];
    if ((m = s.match(/^pay ((?:\{[^}]+\})+|\d+ life)$/))) return [wrap({ op: 'pay', cost: m[1] })];
    if ((m = s.match(/^return (it|that card|them|those cards|the exiled card|the exiled cards) to the battlefield( tapped)? under (its owner's|their owners'|your) control(?: at the beginning of the next end step)?$/))) return [wrap({ op: 'move', what: { k: 'ev' }, to: 'battlefield', tapped: !!m[2], control: /your/.test(m[3]) ? 'you' : 'owner', delayed: /next end step/.test(s) ? 'end' : null })];
    if ((m = s.match(/^return (this|it) to (?:its owner's|your) hand$/))) return [wrap({ op: 'move', what: obj(m[1]), to: 'hand' })];

    // Mana variants.
    if ((m = s.match(/^add ((?:\{[wubrgc]\}(?:,? or )?)+)$/)) && /or/.test(m[1])) return [wrap({ op: 'addMana', units: [m[1].match(/[wubrgc]/g).map(x => x.toUpperCase()).join('')] })];
    if ((m = s.match(/^add (\{[wubrgc]\})(?:\{[wubrgc]\})*,? (?:or )?(\{[wubrgc]\}.*)$/))) return [wrap({ op: 'addMana', units: [s.match(/[wubrgc](?=\})/g).map(x => x.toUpperCase()).join('')], choice: true })];
    if (/^add one mana of any (?:color|type) (?:that a land (?:you|an opponent) controls? could produce|in your commander's color identity|that .+)$/.test(s)) return [wrap({ op: 'addMana', units: ['WUBRG'], limit: s })];
    if ((m = s.match(/^add (x|\w+) mana (?:of any one color|in any combination of colors)$/))) return [wrap({ op: 'addMana', units: { v: 'X', each: 'WUBRG' }, n: amt(m[1]) })];
    if (/^spend this mana only|^until end of turn, you don't lose this mana|this can't be countered|this can't be copied|it's still a land|they're still lands/.test(s)) return [];
    // Attach / animate.
    if ((m = s.match(/^attach (this|it) to (.+)$/))) return [wrap({ op: 'attach', what: obj(m[1]), to: targetOf(m[2], st) })];
    if ((m = s.match(/^tap untapped creatures with total power (\d+) or more: this becomes an artifact creature until end of turn$/))) return [wrap({ op: 'crew', n: +m[1] })];
    if ((m = s.match(/^(this|target .+?|it) becomes an? (?:(\d+|x)\/(\d+|x) )?(.+?)(?: with (.+?))?(?: in addition to its other types)? until end of turn$/))) return [wrap({ op: 'animate', what: targetOf(m[1], st), p: m[2] || null, t: m[3] || null, types: m[4], kws: m[5] || '', eot: true })];
    // Hand to battlefield.
    if ((m = s.match(/^put (?:an? |up to (\w+) )?(.+?) cards? from your hand onto the battlefield( tapped)?$/))) return [wrap({ op: 'fromHand', filter: m[2], n: amt(m[1]) || 1, tapped: !!m[3] })];
    if ((m = s.match(/^put (?:an? )?(.+?) cards? from your graveyard onto the battlefield( tapped)?$/))) return [wrap({ op: 'fromGy', filter: m[1], dest: 'battlefield', tapped: !!m[2] })];
    if ((m = s.match(/^return (?:an? |up to (\w+) )?(.+?) cards? from your graveyard to your hand$/))) return [wrap({ op: 'fromGy', filter: m[2], n: amt(m[1]) || 1, dest: 'hand' })];
    if (/^play an additional land this turn$/.test(s)) return [wrap({ op: 'extraLand', n: 1 })];
    // Blocking restrictions / misc.
    if ((m = s.match(/^(.+?) can't be blocked this turn$/))) return [wrap({ op: 'grant', what: targetOf(m[1], st), kws: 'unblockable', eot: true })];
    if ((m = s.match(/^(.+?) can't block this turn$/))) return [wrap({ op: 'grant', what: targetOf(m[1], st), kws: "can't block", eot: true })];
    if ((m = s.match(/^(.+?) gets? ([+-]\d+)\/([+-]\d+) until end of turn for each (.+)$/)) && !/\b(?:it|this way|devoured|exiled|that)\b/.test(m[4])) return [wrap({ op: 'pump', what: targetOf(m[1], st), p: m[2], t: m[3], per: m[4], eot: true })];
    if (/^until end of turn, (.+?) gets ([+-]\d+)\/([+-]\d+)$/.test(s)) { m = s.match(/^until end of turn, (.+?) gets ([+-]\d+)\/([+-]\d+)$/); return [wrap({ op: 'pump', what: targetOf(m[1], st), p: m[2], t: m[3], eot: true })]; }
    if ((m = s.match(/^(target player|target opponent|each opponent|that player) reveals (?:their|his or her) hand$/))) return [wrap({ op: 'reveal', who: who(m[1]) })];
    if ((m = s.match(/^tap all (.+)$/))) return [wrap({ op: 'tap', what: { k: 'each', what: m[1], ctrl: /target player controls/.test(m[1]) ? 't' : 'any' } })];
    if ((m = s.match(/^(target .+?) phases out$/))) return [wrap({ op: 'phase', what: targetOf(m[1], st) })];
    if (/^the ring tempts you$/.test(s)) return [wrap({ op: 'ring' })];
    if ((m = s.match(/^roll a d(\d+)$/))) return [wrap({ op: 'roll', d: +m[1] })];
    if ((m = s.match(/^search your library for (?:a|an) (.*?)card, (?:reveal it, )?put (?:it|that card) into your hand$/))) return [wrap({ op: 'search', n: 1, filter: m[1].trim() || 'card', dest: 'hand' })];
    if ((m = s.match(/^return a (land|creature|permanent) you control to its owner's hand$/))) return [wrap({ op: 'bounceOwn', what: m[1] })];
    if ((m = s.match(/^choose target (.+)$/))) return [wrap({ op: 'choose', what: targetOf('target ' + m[1], st) })];
    if (/^(?:put|you may put) the rest (?:on the bottom of your library(?: in (?:a|any) random order| in any order)?|into your graveyard)$/.test(s)) return [wrap({ op: 'rest', to: /graveyard/.test(s) ? 'graveyard' : 'bottom' })];

    if ((m = s.match(/^as an additional cost to cast this, (.+)$/))) return [wrap({ op: 'addlCost', cost: m[1] })];
    if (/^if you control a commander,? you may cast this without paying its mana cost$/.test(s)) return [wrap({ op: 'altCost', free: 'commander' })];
    if (/^you may choose new targets for (?:the copy|the copies|target spell or ability)$/.test(raw.trim().toLowerCase().replace(/\.$/, ''))) return [{ op: 'newTargets' }];
    if (/^choose new targets for (?:the copy|the copies)$/.test(s)) return [wrap({ op: 'newTargets' })];
    if ((m = s.match(/^regenerate (.+)$/))) return [wrap({ op: 'regen', what: targetOf(m[1], st) })];
    if ((m = s.match(/^(?:put|reveal|return) (.+?) from among (?:them|those cards|the milled cards|the cards milled this way|the revealed cards)(?: (into your hand|onto the battlefield|to your hand|on top of your library))?( tapped)?$/))) return [wrap({ op: 'fromAmong', filter: m[1], dest: !m[2] ? 'reveal' : /battlefield/.test(m[2]) ? 'battlefield' : /top/.test(m[2]) ? 'top' : 'hand', tapped: !!m[3] })];
    if ((m = s.match(/^put (?:it|that card|one|one of them|one pile) into your hand and the (?:other|rest)(?: pile)? into your graveyard$/))) return [wrap({ op: 'split', a: 'hand', b: 'graveyard' })];
    if (/^put (?:it|that card|them|those cards) into your hand$/.test(s)) return [wrap({ op: 'move', what: { k: 'ev' }, to: 'hand' })];
    if ((m = s.match(/^cast (.+?) without paying (?:its|their) mana costs?$/))) return [wrap({ op: 'freeCast', filter: m[1] })];
    if ((m = s.match(/^play (?:it|that card|them|those cards)(?: this turn| until (?:the end of your next turn|your next end step))$/))) return [wrap({ op: 'mayPlay', what: { k: 'ev' }, until: /next/.test(s) ? 'nextTurn' : 'eot' })];
    if ((m = s.match(/^(you and (?:that player|target opponent|target player)) each (.+)$/))) { const r = clause('you ' + m[2], st), r2 = clause((/target/.test(m[1]) ? 'target player ' : 'that player ') + m[2].replace(/^(\w+)/, x => x.endsWith('s') ? x : x + 's'), st); if (r && r2) return r.concat(r2).map(wrap); }
    if ((m = s.match(/^untap all (.+?) you control$/))) return [wrap({ op: 'untap', what: { k: 'each', what: m[1], ctrl: 'you' } })];
    if ((m = s.match(/^remove an? counter from (.+)$/))) return [wrap({ op: 'counters', n: -1, kind: 'any', on: targetOf(m[1], st) })];
    if ((m = s.match(/^pay (x|\d+) life$/))) return [wrap({ op: 'pay', cost: m[1] + ' life' })];
    // Nothing more to do.
    if (/^(?:shuffle|then shuffle|it can't be regenerated|they can't be regenerated|this spell can't be countered)$/.test(s)) return [];
    return null;
  }
  // The thing a damage/pump/destroy clause points at.
  function targetOf(s, st) {
    s = String(s || '').trim().replace(/\.$/, '');
    const w = who(s);
    if (w) { if (w.k === 't') w.i = st.ti++; return w; }
    if (/^(?:any target|target .+|up to \w+ target .+|\w+ target .+|another target .+)$/.test(s)) {
      const o = obj(s); if (o && o.k === 't') { o.i = st.ti++; return o; }
      return { k: 't', i: st.ti++, what: s };
    }
    if (/^each opponent and each creature/.test(s)) return { k: 'eachOppAndCreatures' };
    if (/^each creature and each player$/.test(s)) return { k: 'everything' };
    if ((m0 = s.match(/^each creature without flying$/))) return { k: 'each', what: 'creature', ctrl: 'any', without: 'flying' };
    if ((m0 = s.match(/^each creature with flying$/))) return { k: 'each', what: 'creature', ctrl: 'any', with: 'flying' };
    return obj(s);
  }
  var m0;

  // ---------------- a whole ability ----------------
  function parse(text, opts, st0) {
    const st = st0 || { ti: 0 };
    const t0 = String(text || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[“”]/g, '"')
      .replace(/\.?\s*(?:it|they) (?:has|have|gains?) "[^"]*"(?: until end of turn)?\.?/g, '.').trim();
    // "where X is …" applies to the clause before it.
    const sentences = t0.replace(/\.?\n/g, '. ').split(/(?<=\.)\s+|(?<=\.)$/).map(x => x.trim()).filter(Boolean);
    const ops = [];
    let understood = true;
    for (let sent of sentences) {
      // "If you're the monarch, it deals 7 damage instead." / "If it's an artifact, draw a card."
      const cm = sent.replace(/\.$/, '').match(/^if (?!you do\b|they do\b|a player does\b)([^,]+), (.+?)( instead)?$/);
      if (cm) {
        const inner = parse(cm[2] + '.', opts, st);
        ops.push({ op: cm[3] ? 'instead' : 'if', cond: cm[1], ops: inner.ops });
        if (!inner.understood) understood = false;
        continue;
      }
      let xvar = null;
      const wx = sent.match(/,? where x is (.+?)\.?$/);
      if (wx) { xvar = variable(wx[1]); sent = sent.slice(0, wx.index); }
      // Split into clauses: "draw a card, then discard a card", "each opponent loses 1 life and you gain 1 life".
      const parts = sent.replace(/\.$/, '').split(/,? then |(?<!if you do|if they do|when you do|if a player does), (?=(?:gain|lose|draw|discard|mill|create|scry|surveil)s?\b)|\. then |, and then |,? and (?=(?:you |each opponent |each player |that player |target player |its controller )?(?:gains? (?:\d|x |that much|life)|loses?|draws?|discards?|mills?|creates?|puts?|scry|surveil|sacrifices?|untaps?|taps?|returns?|exiles?|becomes?|takes?|investigate|proliferate)\b)/);
      let subject = null;
      for (let p of parts) {
        p = p.trim(); if (!p) continue;
        const sm = p.match(/^(you|each opponent|each player|target player|target opponent|that player|its controller)\b/);
        if (sm) subject = sm[1];
        else if (subject && /^(gains?|loses?|draws?|discards?|mills?|sacrifices?)\b/.test(p)) p = (subject.startsWith('target') ? 'that player' : subject) + ' ' + p;
        const r = clause(p, st);
        if (!r) { understood = false; ops.push({ op: 'manual', text: p.replace(/^./, x => x.toUpperCase()) }); continue; }
        for (const o of r) { if (xvar && (o.n && o.n.v === 'X')) o.n = xvar; if (xvar && o.spec && (o.spec.p === 'x' || (o.spec.n && o.spec.n.v === 'X'))) { o.spec.x = xvar; if (o.spec.n && o.spec.n.v === 'X') o.spec.n = xvar; } ops.push(o); }
      }
    }
    return { ops, understood, targets: st.ti };
  }

  root.Effects = { parse, clause, variable, tokenSpec, who, obj };
})(typeof window !== 'undefined' ? window : globalThis);
