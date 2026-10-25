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
    if (/^the defending player$|^defending player$|^the player or planeswalker it's attacking$|^the player it's attacking$|^the player (?:this|that creature) is attacking$/.test(s)) return { k: 'defender' };
    if (/^that player$|^they$|^that opponent$/.test(s)) return { k: 'evPlayer' };
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
    if ((m = s.match(/^any number of (?:other )?target (.+)$/))) return { k: 't', upTo: true, n: 99, what: m[1] };
    if ((m = s.match(/^(?:up to (\w+) )?(?:(\w+) )?(?:other |another )?target (.+)$/))) return { k: 't', upTo: !!m[1], n: amt(m[1] || m[2] || 1) || 1, what: m[3] };
    if (s === 'any target') return { k: 't', what: 'any target' };
    if ((m = s.match(/^(?:each |all )?((?:[a-z]+ )*?(?:creatures?|permanents?|artifacts?|enchantments?|lands?|tokens?)) (?:the )?defending player controls$/))) return { k: 'each', other: false, what: m[1], ctrl: 'defender' };
    if ((m = s.match(/^each (other )?(.+?)(?: you control| your opponents control| an opponent controls| target player controls| that player controls)?$/))) return { k: 'each', other: !!m[1], what: m[2], ctrl: /you control/.test(s) ? 'you' : /opponents? control/.test(s) ? 'opp' : /that player controls/.test(s) ? 'evPlayer' : 'any' };
    if ((m = s.match(/^all (other )?(.+?)(?: you control| your opponents control)?$/))) return { k: 'each', other: !!m[1], what: m[2], ctrl: /you control/.test(s) ? 'you' : /opponents control/.test(s) ? 'opp' : 'any' };
    if ((m = s.match(/^(other )?((?:[a-z]+ )*?(?:creatures|permanents|artifacts|enchantments|lands|tokens|[a-z]+s)) you control$/))) return { k: 'each', other: !!m[1], what: m[2], ctrl: 'you' };
    if ((m = s.match(/^((?:[a-z]+ )*?(?:creatures|permanents|artifacts|enchantments|lands|tokens)) (?:your opponents control|an opponent controls)$/))) return { k: 'each', other: false, what: m[1], ctrl: 'opp' };
    if ((m = s.match(/^((?:[a-z]+ )*?(?:creatures|permanents|artifacts|enchantments|lands|tokens)) (?:they|that player|target player) controls?$/))) return { k: 'each', other: false, what: m[1], ctrl: 'evPlayer' };
    if ((m = s.match(/^attacking creatures(?: you control)?$/))) return { k: 'each', what: 'attacking creature', ctrl: /you control/.test(s) ? 'you' : 'any' };
    if (/^this$/.test(s)) return { k: 'self' };
    if ((m = s.match(/^(other )?([a-z ]+?) you control with power (\d+) or greater$/))) return { k: 'each', other: !!m[1], what: m[2], ctrl: 'you', powerMin: +m[3] };
    if ((m = s.match(/^(other )?([a-z ]+?) you control with ([a-z ]+)$/))) return { k: 'each', other: !!m[1], what: m[2], ctrl: 'you', with: m[3] };
    return null;
  }
  // "X" after "where X is …" / "equal to …".
  function variable(s) {
    s = String(s || '').trim().replace(/\.$/, '');
    let m;
    if (/^the amount of \{e\} (?:paid|you paid) this way$/.test(s)) return { v: 'lastX' };
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
    return { n: amt(m[1]) || 1, tapped: !!m[2] || /^tapped/.test(m[7] || ''), p: m[3] || null, t: m[4] || null, desc, colors, types, kws, named: named ? named[1] : null, attacking: !!m[7] };
  }

  // ---------------- one clause ----------------
  function clause(raw, st) {
    let s = raw.trim().replace(/\.$/, '').replace(/^then,? /, '').trim();
    { const u = s.match(/^until end of turn, (.+)$/); if (u) s = u[1] + ' until end of turn'; }
    s = s.replace(/\bhis or her\b/g, 'their').replace(/\bhim or her\b/g, 'them').replace(/^(?:he|she) /, 'it ').replace(/ (?:him|her) /g, ' it ');
    let optional = false, ifDid = false, m;
    if ((m = s.match(/^if you do,? (.+)$/))) { ifDid = true; s = m[1]; }
    if ((m = s.match(/^you may (.+)$/))) { optional = true; s = m[1]; }
    const wrap = op => op && Object.assign(op, optional ? { optional: true } : {}, ifDid ? { ifDid: true } : {}, op.op !== 'manual' && !op.src ? { src: raw.trim().replace(/\.$/, '').replace(/^./, x => x.toUpperCase()) } : {});
    // Subject + verb.
    let subj = { k: 'you' }, body = s;
    const sm = s.match(/^(you|each opponent|each player|each other player|target player|target opponent|that player|they|its controller|its owner|that creature's controller|enchanted creature's controller|defending player|the defending player|that opponent) (.+)$/);
    if (sm) { subj = who(sm[1]); body = sm[2]; if (subj.k === 't') subj.i = st.ti++; }
    // Damage: "this deals 3 damage to any target", "it deals X damage to each creature without flying".
    if ((m = s.match(/^(this|it) deals twice x damage to (.+)$/))) { const to = targetOf(m[2], st); if (to) return [wrap({ op: 'dmg', src: 'self', n: { v: 'X2' }, to })]; }
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
    if (/^cascade$/.test(s)) return [wrap({ op: 'cascade' })];
    // Discover N (701.57): exile until a nonland card with mana value N or less; cast it free or put it into your hand.
    if ((m = s.match(/^discover (\d+)$/))) return [wrap({ op: 'discover', n: +m[1] })];
    if ((m = body.match(/^gets? (a|an|one|two|three|\d+|x) poison counters?$/))) return [wrap({ op: 'poison', who: subj, n: amt(m[1]) })];
    if ((m = s.match(/^double (?:the power of (.+?)|(its|this's) power) until end of turn$/))) { const what = targetOf(m[1] || (m[2] === 'its' ? 'it' : 'this'), st); if (what) return [wrap({ op: 'doublePT', what, powerOnly: true })]; }
    if ((m = s.match(/^(?:have )?(.+?) becomes? an? (.+?) with base power and toughness (\d+)\/(\d+)(?: in addition to (?:its|their) other (?:colors and )?types)? until end of turn$/))) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'animate', what, p: m[3], t: m[4], types: m[2], kws: '', eot: true })]; }
    if ((m = s.match(/^double the power and toughness of (.+?) until end of turn$/))) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'doublePT', what })]; }
    if (/^do this only once each turn$|^this ability triggers only once each turn$/.test(s)) return [];
    // Energy (107.14): "you get {E}{E}", "you get that many {E}".
    if ((m = body.match(/^gets? ((?:\{e\})+)$/))) return [wrap({ op: 'energy', who: subj, n: m[1].length / 3 })];
    if ((m = body.match(/^gets? that many \{e\}$/))) return [wrap({ op: 'energy', who: subj, n: { v: 'thatMany' } })];
    if ((m = body.match(/^gets? an amount of \{e\} equal to (.+)$/))) return [wrap({ op: 'energy', who: subj, n: variable(m[1]) })];
    if ((m = body.match(/^gets? (\w+) \{e\}$/))) return [wrap({ op: 'energy', who: subj, n: amt(m[1]) })];
    // Players.
    if ((m = body.match(/^draws? (\w+|x) cards?$/)) || (m = body.match(/^draws? a card$/))) return [wrap({ op: 'draw', who: subj, n: m[1] ? amt(m[1]) : 1 })];
    if ((m = body.match(/^draws? cards equal to (.+)$/))) return [wrap({ op: 'draw', who: subj, n: variable(m[1]) })];
    if ((m = body.match(/^draws? a card for each (.+? with an? [^ ]+ counter on it)$/))) return [wrap({ op: 'draw', who: subj, n: { v: 'count', what: m[1].replace(/ you control/, ''), ctrl: /you control/.test(m[1]) ? 'you' : 'any' } })];
    if ((m = body.match(/^draws? a card for each (?:creature|permanent|card)s? (?:destroyed|exiled|sacrificed|put into a graveyard) this way$/))) return [wrap({ op: 'draw', who: subj, n: { v: 'lastAmount' } })];
    if ((m = body.match(/^draws? a card for each (.+)$/)) && !/\b(?:it|this way|devoured|exiled|that|those)\b/.test(m[1])) return [wrap({ op: 'draw', who: subj, n: { v: 'count', what: m[1].replace(/ you control$/, ''), ctrl: /you control/.test(m[1]) ? 'you' : 'any' } })];
    if ((m = body.match(/^draws? that many cards$/))) return [wrap({ op: 'draw', who: subj, n: { v: 'thatMany' } })];
    if ((m = body.match(/^draws? an additional card$/))) return [wrap({ op: 'draw', who: subj, n: 1 })];
    if ((m = body.match(/^discards? (\w+) cards?(?: at random)?$/)) || (m = body.match(/^discards? a card(?: at random)?$/))) return [wrap({ op: 'discard', who: subj, n: m[1] ? amt(m[1]) : 1, random: /at random/.test(body) })];
    if (/^discards? (?:your|their) hand$|^discards? all the cards in (?:your|their) hand$/.test(body)) return [wrap({ op: 'discard', who: subj, n: 99, all: true })];
    if ((m = body.match(/^mills? cards equal to (.+)$/))) { const n = variable(m[1]); if (n) return [wrap({ op: 'mill', who: subj, n })]; }
    if ((m = body.match(/^mills? (\w+) cards?$/))) return [wrap({ op: 'mill', who: subj, n: amt(m[1]) })];
    if ((m = body.match(/^gains? (\d+|x|that much) life$/))) return [wrap({ op: 'life', who: subj, n: m[1] === 'that much' ? { v: 'lastAmount' } : amt(m[1]), sign: 1 })];
    if ((m = body.match(/^gains? life equal to (.+)$/))) return [wrap({ op: 'life', who: subj, n: variable(m[1]), sign: 1 })];
    if ((m = body.match(/^gains? (\d+) life for each (.+)$/))) return [wrap({ op: 'life', who: subj, n: { v: 'count', what: m[2], ctrl: 'you', times: +m[1] }, sign: 1 })];
    if ((m = body.match(/^loses? (\d+|x|that much) life$/))) return [wrap({ op: 'life', who: subj, n: amt(m[1]) || { v: 'lastAmount' }, sign: -1 })];
    if ((m = body.match(/^loses? life equal to (.+)$/))) return [wrap({ op: 'life', who: subj, n: variable(m[1]), sign: -1 })];
    if ((m = body.match(/^loses? (\d+) life for each (.+)$/))) return [wrap({ op: 'life', who: subj, n: { v: 'count', what: m[2], ctrl: 'any', times: +m[1] }, sign: -1 })];
    if ((m = body.match(/^(?:each )?(?:sacrifices?) (an?|one|two|three) (.+?)(?: of (?:their|his or her) choice)?$/))) { st.edict = m[2].replace(/(?<!s)s$/, ''); return [wrap({ op: 'sacrifice', who: subj, n: amt(m[1]), what: st.edict })]; }
    if ((m = s.match(/^sacrifice this unless you (?:sacrifice (a|an|one|two) ([a-z ]+)|pay ((?:\{[^}]+\})+))$/))) return [wrap(m[3] ? { op: 'sacUnlessPay', cost: m[3] } : { op: 'sacUnless', n: amt(m[1]), what: m[2] })];
    if ((m = body.match(/^sacrifices? (this|it|that creature|that permanent|enchanted creature|another permanent|another creature)$/))) return [wrap({ op: 'sacrifice', who: subj, n: 1, what: m[1] === 'this' ? { k: 'self' } : /another/.test(m[1]) ? m[1].replace('another ', '') : obj(m[1]), other: /another/.test(m[1]) })];
    if ((m = body.match(/^scry (\d+|x|one|two|three)$/))) return [wrap({ op: 'scry', who: subj, n: amt(m[1]) })];
    if ((m = body.match(/^surveil (\d+|one|two|three)$/))) return [wrap({ op: 'surveil', who: subj, n: amt(m[1]) })];
    if (/^(?:become|becomes) the monarch$/.test(body)) return [wrap({ op: 'monarch', who: subj })];
    if (/^takes? the initiative$/.test(body)) return [wrap({ op: 'initiative', who: subj })];
    if ((m = s.match(/^investigate(?: (\w+) times)?$/))) return [wrap({ op: 'token', who: { k: 'you' }, spec: { n: m[1] ? amt(m[1]) : 1, named: 'clue', desc: 'Clue artifact', types: 'Clue artifact' } })];
    if (/^proliferate$/.test(s)) return [wrap({ op: 'proliferate' })];
    // Path to Exile / Assassin's Trophy / Ghost Quarter: the target's controller may get a basic land.
    if ((m = s.match(/^(?:its controller|that player|that land's controller|that permanent's controller) may search their library for an? (?:basic land card|land card with a basic land type), put (?:it|that card) onto the battlefield( tapped)?(?:,? then shuffle)?$/))) return [wrap({ op: 'fetchFor', who: { k: 'targetCtrl', i: Math.max(0, st.ti - 1) }, tapped: !!m[1] })];
    // "At the beginning of the next end step, sacrifice/exile that token [unless you pay an amount of {E} equal to its mana value]."
    if ((m = s.match(/^at the beginning of the next end step, (sacrifice|exile) (that token|those tokens|the token|the tokens|it|them)( unless you pay an amount of \{e\} equal to its mana value)?$/)) && st.madeToken) return [wrap({ op: 'delayedToken', to: m[1] === 'exile' ? 'exile' : 'graveyard', energy: !!m[3] })];
    // Mudslide-style: "that player may choose any number of tapped creatures without flying they control and pay {2} for each".
    if ((m = s.match(/^that player may choose any number of tapped (creatures(?: without flying)?) they control and pay ((?:\{[^}]+\})+) for each creature chosen this way$/))) return [wrap({ op: 'payUntap', what: m[1].replace(/s\b/, ''), cost: m[2] })];
    // Urza's Saga: "This gains '{T}: Add {C}.'" — the permanent gets a new ability for as long as it stays.
    if ((m = s.match(/^this gains "(.+)"$/))) return [wrap({ op: 'gainAbility', text: m[1].replace(/\{([a-z0-9/]+)\}/g, (x, y) => '{' + y.toUpperCase() + '}').replace(/^./, x => x.toUpperCase()) })];
    if ((m = s.match(/^remove all (\w+) counters from (this|it)$/))) return [wrap({ op: 'removeAll', kind: m[1] })];
    if ((m = s.match(/^add one mana of any color for each (\w+) counter removed this way$/))) return [wrap({ op: 'addMana', units: { v: 'X', each: 'WUBRG' }, n: { v: 'lastAmount' } })];
    if ((m = s.match(/^each player who can't discards a card$/)) && st.edict) return [wrap({ op: 'discardIfNone', what: st.edict })];
    if (/^create a tapped colorless land token named everywhere that is every basic land type$/.test(s)) return [wrap({ op: 'token', who: { k: 'you' }, spec: { n: 1, tapped: true, p: null, t: null, desc: 'everywhere', named: 'everywhere', kws: '', colors: [], types: 'land' } })];
    // The Locust God: "return it to its owner's hand at the beginning of the next end step".
    if ((m = s.match(/^return (it|this|that card) to its owner's hand at the beginning of the next end step$/))) return [wrap({ op: 'move', what: m[1] === 'this' ? { k: 'self' } : { k: 'ev' }, to: 'hand', delayed: true })];
    // Arcane Denial: draws at the beginning of the next turn's upkeep.
    if ((m = s.match(/^(you|its controller) (?:may )?draws? (a card|up to two cards|two cards) at the beginning of the next turn's upkeep$/))) return [wrap({ op: 'delayedDraw', who: m[1] === 'you' ? { k: 'you' } : { k: 'targetCtrl', i: 0 }, n: /two/.test(m[2]) ? 2 : 1 })];
    if (/^each attacking creature and each blocking creature doesn't untap during its controller's next untap step$/.test(s)) return [wrap({ op: 'skipUntap', what: { k: 'each', what: 'attacking creature', ctrl: 'any' } }), wrap({ op: 'skipUntap', what: { k: 'each', what: 'blocking creature', ctrl: 'any' } })];
    if ((m = s.match(/^(?:its|their) owners? shuffles? (it|them) into (?:their|its) library$/))) return [wrap({ op: 'move', what: { k: 'ev' }, to: 'library', pos: 'shuffle' })];
    if ((m = s.match(/^for each creature, its controller sacrifices it unless they pay (\w+) life$/))) return [wrap({ op: 'payLifeOrSac', n: amt(m[1]) || { v: 'X' }, what: 'creature' })];
    // Copy a spell or an ability on the stack (Strionic Resonator, Expansion, See Double, Return the Favor).
    if ((m = s.match(/^copy (target .+?)$/)) && /spell|ability/.test(m[1])) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'copyStack', what })]; }
    // Mana added by an aura on a tapped land is part of paying (605.4a, Cards.manaSource): nothing to do here.
    if (/^(?:its controller|that player) adds? (?:an )?additional (?:one mana of any color|one mana of the chosen color|\{[wubrgc]\}+)$|^that player adds one mana of any type that land produced$/.test(s)) return [wrap({ op: 'manaNote' })];
    // Energy paid by amount: "you may pay an amount of {E} equal to that permanent's mana value" / "pay one or more {E}".
    if (/^(?:then )?(?:you may )?pay an amount of \{e\} equal to (?:that permanent's|that card's|its) mana value$/.test(s)) return [wrap({ op: 'payEnergy', mvOf: { k: 't', i: 0 } })];
    if (/^(?:then )?(?:you may )?pay one or more \{e\}$/.test(s)) return [wrap({ op: 'payEnergy', all: true })];
    if (/^(?:then )?note your life total$/.test(s)) return [wrap({ op: 'noteLife' })];
    if ((m = s.match(/^shuffle up to (\w+) target cards from graveyards into their owners' libraries$/))) return [wrap({ op: 'move', what: { k: 't', i: st.ti++, upTo: true, n: amt(m[1]) || 3, what: 'card from a graveyard' }, to: 'library', pos: 'shuffle' })];
    if ((m = s.match(/^put (up to \w+ target cards|target card) from (?:graveyards|a graveyard) on the bottom of (?:their|its) owners?'? librar(?:y|ies)(?: in any order)?$/))) { const n = /up to (\w+)/.exec(m[1]); return [wrap({ op: 'move', what: { k: 't', i: st.ti++, upTo: !!n, n: n ? amt(n[1]) || 1 : 1, what: 'card from a graveyard' }, to: 'library', pos: 'bottom' })]; }
    if ((m = body.match(/^shuffles? up to (\w+) target cards from (?:their|your) graveyard into (?:their|your) library$/))) return [wrap({ op: 'move', what: { k: 't', i: st.ti++, upTo: true, n: amt(m[1]) || 3 }, to: 'library', pos: 'shuffle' })];
    if ((m = s.match(/^(tap|untap) another target (.+)$/))) return [wrap({ op: m[1], what: targetOf('target ' + m[2], st) })];
    if ((m = s.match(/^(target .+?|it|that creature|this) phases out$/))) { const what = targetOf(m[1], st) || (m[1] === 'it' && st.ti > 0 ? { k: 't', i: st.ti - 1 } : null); if (what) return [wrap({ op: 'phaseOut', what })]; }
    if (/^(?:and )?after this phase, there is an additional combat phase$|^there is an additional combat phase after this phase$/.test(s)) return [wrap({ op: 'extraCombat', after: 'phase' })];
    if (/^after this main phase, there is an additional combat phase followed by an additional main phase$/.test(s)) return [wrap({ op: 'extraCombat', after: 'main' })];
    if (/^that creature's owner can't cast spells with the same name as that creature until your next turn$/.test(s)) return [wrap({ op: 'nameLock', what: st.ti > 0 ? { k: 't', i: st.ti - 1 } : { k: 'ev' } })];
    if ((m = s.match(/^((?:non)?[a-z]+ )?spells your opponents cast cost \{(\d+)\} more to cast until your next turn$/))) return [wrap({ op: 'costMod', n: +m[2], filter: (m[1] || '').trim() || null })];
    if ((m = s.match(/^(.+?) loses? ([a-z ,]+?) until end of turn$/))) { const what = targetOf(m[1], st); const kws = m[2].split(/,\s*|\s+and\s+/).map(x => x.trim()).filter(Boolean); if (what && kws.length) return [wrap({ op: 'loseKw', what, kws })]; }
    if ((m = s.match(/^(target opponent|target player|each opponent)'s life total becomes (\d+)$/))) return [wrap({ op: 'setLife', who: m[1] === 'each opponent' ? { k: 'eachOpp' } : { k: 't', i: st.ti++ }, n: +m[2] })];
    if ((m = s.match(/^if target player has fewer than (\w+) poison counters, they get a number of poison counters equal to the difference$/))) return [wrap({ op: 'setPoison', who: { k: 't', i: st.ti++ }, n: amt(m[1]) || 9 })];
    if ((m = s.match(/^(target creature) gets \+x\/\+x or -x\/-x until end of turn$/))) { const what = targetOf(m[1], st); return [wrap({ op: 'pump', what, p: '+x', t: '+x', eot: true, either: true })]; }
    if ((m = s.match(/^put your choice of an? ([a-z]+) counter, an? ([a-z]+) counter, or an? ([a-z]+) counter on (it|that token)$/)) && st.madeToken !== false) return [wrap({ op: 'counters', n: 1, kind: m[3], on: { k: 'lastToken' } })];
    if (/^the ring tempts you$/.test(s)) return [wrap({ op: 'tempt' })];
    if ((m = s.match(/^put (target .+?|that card|it|this) on top of (?:its|their) owner's library$/)) || (m = s.match(/^put (target .+? from your graveyard|that card|it) on top of your library$/))) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'move', what, to: 'library', pos: 'top' })]; }
    if ((m = s.match(/^put (target .+?|that card|it) into (?:its|their) owner's library (second|third) from the top$/))) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'move', what, to: 'library', pos: m[2] === 'second' ? 'n2' : 'n3' })]; }
    if ((m = s.match(/^(?:your )?opponents can't gain life this turn$/))) return [wrap({ op: 'noLifeGain' })];
    if ((m = s.match(/^untaps? all basic lands (?:they|you) control$/)) || (m = body.match(/^untaps? all basic lands (?:they|you) control$/))) return [wrap({ op: 'untap', what: { k: 'each', what: 'basic land', ctrl: subj.k === 't' ? 'targetP' : 'you', i: subj.i } })];
    if ((m = s.match(/^(?:you may )?play up to (\w+) additional lands? this turn$/))) return [wrap({ op: 'extraLand', n: amt(m[1]) || 1 })];
    if ((m = s.match(/^(?:then )?each creature your opponents control gets? (-\d+)\/(-\d+)(?: until end of turn)? for each poison counter its controller has$/))) return [wrap({ op: 'pump', what: { k: 'each', other: false, what: 'creature', ctrl: 'opp' }, p: m[1], t: m[2], per: 'poison counter its controller has', eot: true })];
    if (/^proliferate twice$/.test(s)) return [wrap({ op: 'proliferate' }), wrap({ op: 'proliferate' })];
    if ((m = s.match(/^shuffle (this|it|that card|that creature|that permanent) into its owner's library$/))) { const what = obj(m[1]); if (what) return [wrap({ op: 'move', what, to: 'library', pos: 'shuffle' })]; }
    if ((m = s.match(/^put a \+1\/\+1 counter or a loyalty counter on (it|that permanent|target .+)$/))) { const on = m[1] === 'it' && st.ti > 0 ? { k: 't', i: st.ti - 1 } : targetOf(m[1], st); if (on) return [wrap({ op: 'counters', n: 1, kind: '+1/+1|loyalty', on })]; }
    if ((m = s.match(/^you (untap all .+)$/))) { const r = clause(m[1], st); if (r) return r; }
    if ((m = s.match(/^amass (\w+) (\d+|x)$/))) return [wrap({ op: 'amass', type: m[1].replace(/s$/, ''), n: amt(m[2]) })];
    if ((m = s.match(/^(?:it|this|target creature you control) explores$/))) return [wrap({ op: 'explore', what: /target/.test(s) ? { k: 't', i: st.ti++ } : obj(m[0].split(' ')[0]) })];
    if (/^(?:this|it) connives$/.test(s)) return [wrap({ op: 'draw', who: { k: 'you' }, n: 1 }), wrap({ op: 'discard', who: { k: 'you' }, n: 1 })];
    if ((m = s.match(/^shuffle (?:your|their) graveyard into (?:your|their) library$/)) || (m = body.match(/^shuffles? (?:your|their) graveyard into (?:your|their) library$/))) return [wrap({ op: 'shuffleGy', who: subj })];
    if ((m = s.match(/^untap (?:up to (\w+) )?(lands|lands you control|all lands you control|target (.+)|this|it|that creature|all creatures you control)$/))) return [wrap({ op: 'untap', what: m[3] ? { k: 't', i: st.ti++, what: m[3] } : /^lands/.test(m[2]) ? { k: 'chooseUntap', n: amt(m[1]) || 99, what: 'land' } : /all/.test(m[2]) ? { k: 'each', what: m[2].replace(/^all /, '').replace(/ you control$/, ''), ctrl: 'you' } : obj(m[2]) })];
    if ((m = s.match(/^tap (?:up to (\w+) )?(target .+|this|it|that creature|all creatures your opponents control|each creature your opponents control|all lands that player controls)$/))) { const what = targetOf(m[2], st); st.lastObj = what; return [wrap({ op: 'tap', what })]; }
    // "It doesn't untap during its controller's next untap step" (Archipelagore, Frost Breath…).
    if ((m = s.match(/^(it|that creature|those creatures|they|that permanent|those permanents) (?:doesn't|don't|do not) untap during (?:its|their) controllers?'s? next untap step$/))) return [wrap({ op: 'skipUntap', what: st.lastObj || { k: 'ev' } })];
    // Fogs (615): "Prevent all combat damage that would be dealt this turn [by non-Elf creatures]", Kor Haven, Maze of Ith.
    if ((m = s.match(/^prevent all combat damage that would be dealt this turn(?: by (non-?[a-z]+) creatures)?$/))) return [wrap({ op: 'fog', non: m[1] ? m[1].replace(/^non-?/, '') : null })];
    if ((m = s.match(/^prevent all combat damage that would be dealt (to and dealt by|by) (target attacking creature|that creature|target creature|it) this turn$/))) { const what = /^target/.test(m[2]) ? targetOf(m[2], st) : (st.lastObj || (st.ti > 0 ? { k: 't', i: st.ti - 1 } : { k: 'ev' })); return [wrap({ op: 'fog', what, to: /to and/.test(m[1]) })]; }
    // Mana Drain: "At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value."
    if (/^at the beginning of your next main phase, add an amount of \{c\} equal to that spell's mana value$/.test(s)) return [wrap({ op: 'delayedMana' })];
    if ((m = s.match(/^put (\w+) cards? from your hand on top of your library(?: in any order)?$/))) return [wrap({ op: 'handToTop', n: amt(m[1]) || 1 })];
    if ((m = s.match(/^level (\d+)$/))) return [wrap({ op: 'level', n: +m[1] })];
    if (/^(?:you )?take an extra turn after this one$/.test(s)) return [wrap({ op: 'extraTurn' })];
    if ((m = s.match(/^tap or untap (target .+|another target .+)$/))) return [wrap({ op: 'tapUntap', what: targetOf(m[1], st) })];
    // "Each player this attacked this turn loses the game" (Angel of Destiny), "each player with exactly 13 life loses the game".
    if ((m = s.match(/^each player (?:this attacked this turn|with exactly (\d+) life) loses the game$/))) return [wrap({ op: 'loseGame', attacked: !m[1], life: m[1] ? +m[1] : null })];
    if ((m = s.match(/^add ((?:\{[wubrgc]\})+)$/))) return [wrap({ op: 'addMana', units: m[1].match(/[wubrgc]/g).map(x => x.toUpperCase()) })];
    if ((m = s.match(/^add \{([wubrgc])\} for each (.+)$/)) && !/\b(?:it|this way|removed|that|those)\b/.test(m[2])) return [wrap({ op: 'addMana', units: { v: 'X', each: m[1].toUpperCase() }, n: { v: 'count', what: m[2].replace(/ you control$/, ''), ctrl: /you control/.test(m[2]) ? 'you' : 'any' } })];
    if ((m = s.match(/^add (one|two|three) mana of any (?:one )?color$/))) return [wrap({ op: 'addMana', units: Array(amt(m[1])).fill('WUBRG') })];
    // Tokens.
    if ((m = body.match(/^creates? (.+)$/))) {
      const tm = m[1].match(/^a (tapped and attacking |tapped )?token that's a copy of (.+?)(?:,? except .+)?$/);
      if (tm) { st.madeToken = true; return [wrap({ op: 'copyToken', who: subj, of: targetOf(tm[2], st), tapped: !!tm[1], attacking: /attacking/.test(tm[1] || '') })]; }
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
    // "Creatures you control gain trample and get +X/+X until end of turn" (Craterhoof, Overwhelming Stampede).
    if ((m = s.replace(/^until end of turn, /, '').replace(/ until end of turn$/, '').match(/^(.+?) (?:gains?|have) ([a-z ,]+?) and (?:gets?) ([+-]\d+|[+-]x)\/([+-]\d+|[+-]x)$/))) {
      const what = targetOf(m[1], st); if (what) return [wrap({ op: 'pump', what, p: m[3], t: m[4], kws: m[2], eot: true })];
    }
    // Threaten effects: "gain control of target creature until end of turn".
    if ((m = s.match(/^(?:you )?gain control of (.+?)( until end of turn)?$/))) { const what = targetOf(m[1], st); if (what && what.k !== 'you') return [wrap({ op: 'gainControl', what, eot: !!m[2] })]; }
    if ((m = s.replace(/ until (?:end of turn|your next turn)$/, '').match(/^(.+?) (?:gains?|has|have) (protection from [a-z ,]+|[a-z ,]+?)$/)) && !/"/.test(s)) {
      const what = targetOf(m[1], st); if (what && m[2].length < 60) return [wrap({ op: 'grant', what, kws: m[2], eot: /until end of turn/.test(s), untilNext: /until your next turn/.test(s) })];
    }
    // Zone changes.
    if ((m = s.match(/^destroy (.+)$/))) { const what = targetOf(m[1].replace(/\. it can't be regenerated$|\. they can't be regenerated$/, ''), st); if (what) return [wrap({ op: 'destroy', what })]; }
    if ((m = s.match(/^(exile|destroy) (?:a|the) creature with the greatest power among creatures (target opponent|target player|that player|an opponent|each opponent) controls$/))) { const w = who(m[2]); if (w && w.k === 't') w.i = st.ti++; return [wrap({ op: 'biggest', act: m[1], who: w || { k: 'eachOpp' } })]; }
    if ((m = s.match(/^exile (.+?), then return (?:it|that card|those cards|them|those permanents|the exiled cards?) to the battlefield(?: tapped)? under (its owner's|their owners'|their owner's|your) control$/))) return [wrap({ op: 'flicker', what: targetOf(m[1], st), control: /your/.test(m[2]) ? 'you' : 'owner' })];
    if ((m = s.match(/^exile (.+)$/)) && !/top|library/.test(m[1])) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'move', what, to: 'exile' })]; }
    if ((m = s.match(/^return (.+?) (?:from (?:your|a|their) graveyard )?to (?:its owner's|their owners'|their owner's|your|their) hands?$/))) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'move', what, to: 'hand' })]; }
    if ((m = s.match(/^return (.+?) from (?:your|a|their) graveyard to the battlefield( tapped)?(?: under your control)?$/))) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'move', what, to: 'battlefield', tapped: !!m[2], control: 'you' })]; }
    if ((m = s.match(/^return (this|it) from your graveyard to your hand$/))) return [wrap({ op: 'move', what: obj(m[1]), to: 'hand' })];
    if ((m = s.match(/^put (.+?) onto the battlefield( tapped)?(?: under your control)?$/)) && !/from your hand|from among|library/.test(m[1])) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'move', what, to: 'battlefield', tapped: !!m[2], control: 'you' })]; }
    if ((m = s.match(/^counter (target .+)$/))) return [wrap({ op: 'counterSpell', what: targetOf(m[1], st) })];
    if ((m = s.match(/^(.+?) fights? (.+)$/))) { const a = targetOf(m[1], st), b = targetOf(m[2], st); if (a && b) return [wrap({ op: 'fight', a, b })]; }
    if (/^transform (this|it)$/.test(s)) return [wrap({ op: 'transform', what: { k: 'self' } })];
    // Library.
    // Jarad's Orders / Dina's Guidance: one into your hand and the other into your graveyard / "into your hand or graveyard".
    if ((m = s.match(/^search your library for up to two ([a-z ]+?) cards and reveal them$/))) { st.pendingSearch = m[1]; return []; }
    if (/^search your library for two cards$/.test(s)) { st.pendingSearch = 'card'; return []; }
    if (st.pendingSearch && /^put one into your hand and the other into your graveyard$/.test(s)) { const f = st.pendingSearch; st.pendingSearch = null; return [wrap({ op: 'search', n: 2, upTo: true, filter: f, dest: 'hand', splitGy: true })]; }
    if ((m = s.match(/^search your library for an? ([a-z ]+?) card, reveal it, put it into your hand or graveyard(?:, then shuffle)?$/))) return [wrap({ op: 'search', n: 1, filter: m[1], dest: 'handOrGy' })];
    if ((m = s.match(/^search your library for (up to )?(an?|one|two|three|four|five|\w+) (.+?) cards?( with [^,]+)?, (?:reveal (?:it|them|that card|those cards), )?(?:and )?put (?:it|them|that card|those cards|one of them|one) (into your hand|onto the battlefield)( tapped)?(?:(?: and the other| and the rest) into your hand)?(?:, then shuffle)?$/))) {
      // "with mana value 3 or less" / "with mana cost {0} or {1}": the most it may cost.
      const w = m[4] || '', mv = w.match(/mana value (\d+) or less/) || w.match(/mana cost \{(\d)\}(?: or \{(\d)\})?/);
      return [wrap({ op: 'search', n: amt(m[2]) || 1, upTo: !!m[1], filter: m[3], mvMax: mv ? Math.max(+mv[1], +(mv[2] || 0)) : undefined, dest: /hand/.test(m[5]) ? 'hand' : 'battlefield', tapped: !!m[6], split: /the other into your hand/.test(s) })];
    }
    if ((m = s.match(/^look at the top (\w+) cards? of your library/))) return [wrap({ op: 'look', n: amt(m[1]), text: raw })];
    if ((m = s.match(/^reveal the top (\w+) cards? of your library/))) return [wrap({ op: 'look', n: amt(m[1]), reveal: true, text: raw })];
    if ((m = s.match(/^pay ((?:\{[^}]+\})+|\d+ life)$/))) return [wrap({ op: 'pay', cost: m[1] })];
    if ((m = s.match(/^return (it|that card|them|those cards|the exiled card|the exiled cards) to the battlefield( tapped)? under (its owner's|their owners'|your) control(?: at the beginning of the next end step)?$/))) return [wrap({ op: 'move', what: { k: 'ev' }, to: 'battlefield', tapped: !!m[2], control: /your/.test(m[3]) ? 'you' : 'owner', delayed: /next end step/.test(s) ? 'end' : null })];
    if ((m = s.match(/^return (?:it|this|that card) to the battlefield transformed under (your|its owner's) control$/))) return [wrap({ op: 'move', what: { k: 'self' }, to: 'battlefield', transformed: true, control: /your/.test(m[1]) ? 'you' : 'owner' })];
    if ((m = s.match(/^return (this|it) to (?:its owner's|your) hand$/))) return [wrap({ op: 'move', what: obj(m[1]), to: 'hand' })];

    // Mana variants.
    if ((m = s.match(/^add ((?:\{[wubrgc]\}(?:,? or )?)+)$/)) && /or/.test(m[1])) return [wrap({ op: 'addMana', units: [m[1].match(/[wubrgc]/g).map(x => x.toUpperCase()).join('')] })];
    if ((m = s.match(/^add (\{[wubrgc]\})(?:\{[wubrgc]\})*,? (?:or )?(\{[wubrgc]\}.*)$/))) return [wrap({ op: 'addMana', units: [s.match(/[wubrgc](?=\})/g).map(x => x.toUpperCase()).join('')], choice: true })];
    if (/^add one mana of any (?:color|type) (?:that a land (?:you|an opponent) controls? could produce|in your commander's color identity|that .+)$/.test(s)) return [wrap({ op: 'addMana', units: ['WUBRG'], limit: s })];
    if ((m = s.match(/^add (x|\w+) mana (?:of any one color|in any combination of colors)$/))) return [wrap({ op: 'addMana', units: { v: 'X', each: 'WUBRG' }, n: amt(m[1]) })];
    if (/^spend this mana only|^until end of turn, you don't lose this mana|^you don't lose this mana|this can't be countered|this can't be copied|it's still a land|they're still lands/.test(s)) return [];
    // Attach / animate.
    if ((m = s.match(/^attach (this|it) to (the token|that token)$/))) return [wrap({ op: 'attach', what: obj(m[1]), to: { k: 'lastToken' } })];
    if ((m = s.match(/^attach (this|it) to (.+)$/))) return [wrap({ op: 'attach', what: obj(m[1]), to: targetOf(m[2], st) })];
    if ((m = s.match(/^tap untapped creatures with total power (\d+) or more: this becomes an artifact creature until end of turn$/))) return [wrap({ op: 'crew', n: +m[1] })];
    if ((m = s.match(/^(.+?) (?:becomes an?|become) (?:(\d+|x)\/(\d+|x) )?(.+?)(?: with (.+?))?(?: in addition to (?:its|their) other types)? until end of turn$/)) && /creature/.test(m[4])) { const what = targetOf(m[1], st); if (what) return [wrap({ op: 'animate', what, p: m[2] || null, t: m[3] || null, types: m[4].replace(/creatures$/, 'creature'), kws: m[5] || '', eot: true })]; }
    // Hand to battlefield.
    if ((m = s.match(/^(?:you may )?put an? (.+?) card with equal or lesser mana value from your hand onto the battlefield$/))) return [wrap({ op: 'fromHand', filter: m[1], n: 1, mvMax: { v: 'evMV' }, via: 'kodama' })];
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
    if ((m = s.match(/^tap all (.+ defending player controls)$/))) return [wrap({ op: 'tap', what: obj(m[1]) })];
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
    // "You may cast a spell with mana value 4 or less from your hand without paying its mana cost" (Baral's Expertise,
    // Press the Enemy, Diviner of Mist): the owner picks one and casts it free.
    if ((m = s.match(/^cast (an? .+?|an? (?:instant or sorcery )?spell[^,]*?) from your (hand|graveyard)(?: with mana value (\d+) or less)? without paying its mana cost$/))) {
      const f = m[1].replace(/^an? /, ''), mv = f.match(/with mana value (\d+) or less/) || (m[3] ? [0, m[3]] : null);
      return [wrap({ op: 'freeCast', from: m[2], filter: f.replace(/ with mana value .+$/, '').replace(/ with equal or lesser mana value$/, '').replace(/ spell$/, '').trim() || 'card', mvMax: mv ? +mv[1] : /equal or lesser mana value/.test(f) ? { v: 'evMV' } : undefined })];
    }
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
    if (/^(?:any target|target .+|up to \w+ target .+|\w+ target .+|another target .+|any number of (?:other )?target .+)$/.test(s)) {
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
    // "You get an emblem with "…"" (114): the quoted text is the emblem's ability, kept whole.
    const emb = [];
    text = String(text || '').replace(/you get an emblem with ["“]([^"”]+)["”]\.?/gi, (a, q) => { emb.push(q); return `__emblem:${emb.length - 1}__.`; });
    const t0 = String(text || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/ {2,}/g, ' ').replace(/(if you (?:do|pay)[^.]*?),? and after this phase, there is an additional combat phase/g, '$1, then after this phase, there is an additional combat phase').replace(/,? and after this phase, there is an additional combat phase/g, '. after this phase, there is an additional combat phase')
      .replace(/\bpay (two|three|four|five|six|seven|eight|nine|ten|\d+) \{e\}/g, (a, n) => 'pay ' + '{e}'.repeat(({ two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 })[n] || +n)).replace(/\bif you pay, /g, 'if you do, ').replace(/[“”]/g, '"')
      .replace(/\.?\s*(?:it|they) (?:has|have|gains?) "[^"]*"(?: until end of turn)?\.?/g, '.').trim();
    // "Exile/reveal cards from the top of your library until you exile a nonland permanent card. Put that card onto the
    // battlefield or into your hand." (Illuna, Auspicious Starrix, The Regalia): one effect, done on the owner's device.
    const t1 = t0.replace(/(?:exile|reveal) cards from the top of your library until you (?:exile|reveal) (a|an|x) ((?:nonland |non-?[a-z]+ )*(?:permanent|creature|land|artifact|enchantment|nonland)) cards?(, where x is the number of times this(?: creature)? has mutated)?\. put (?:that card|those [a-z ]*cards|it) (onto the battlefield(?: tapped)?(?: or into your hand)?|into your hand)(?: and the rest on the bottom of your library in a random order)?\./g,
      (all, a, what, mut, dest) => `__dig:${what.trim()}:${mut ? 'mut' : 1}:${/or into your hand/.test(dest) ? 'either' : /battlefield/.test(dest) ? 'battlefield' : 'hand'}:${/tapped/.test(dest) ? 1 : 0}:${/rest on the bottom/.test(all) ? 'bottom' : 'exile'}__.`);
    // "Reveal the top card of your library. If it's a creature card, put it onto the battlefield. Otherwise, you may put that
    // card on the bottom of your library." (Lurking Predators, Herald's Horn): a one-card dig.
    // Impulse draw: "Exile the top card of your library. Until the end of your next turn, you may play it." (Riku, Jeska's Will…)
    const t0i = t1.replace(/exile the top (card|two cards|three cards|four cards|x cards|\w+ cards) of your library\.\s*(until the end of your next turn|until end of turn|until your next end step|this turn)?,?\s*you may play (?:it|them|that card|those cards)( this turn| until end of turn| until the end of your next turn)?\./g,
      (all, n, w1, w2) => { const w = (w1 || w2 || 'this turn').trim(); const k = /next turn|next end step/.test(w) ? 'next' : 'eot'; const nn = n === 'card' ? 1 : (n.split(' ')[0]); return `__impulse:${nn}:${k}__.`; });
    const t0g = t0i.replace(/choose up to (\w+) target cards in graveyards\. the owners of those cards shuffle them into their libraries\./g, (a, n) => `shuffle up to ${n} target cards from graveyards into their owners' libraries.`);
    // Myr Battlesphere: "you may tap X untapped Myr you control. If you do, this gets +X/+0 … and deals X damage to the player…"
    const t0x = t0g.replace(/you may tap (?:x|any number of) untapped ([a-z]+?)s? you control\. if you do, this gets \+x\/\+0 until end of turn and deals x damage to (?:the player or planeswalker it's attacking|defending player|the defending player)\./g, (a, w) => `__tapx:${w}__.`);
    // Combustible Gearhulk: "Target opponent may have you draw three cards. If the player doesn't, you mill three cards,
    // then this deals damage to that player equal to the total mana value of those cards."
    const t0p = t0x.replace(/target opponent may have you draw (\w+) cards?\. if (?:the player|they|that player) (?:doesn't|don't|does not), you mill (\w+) cards?, then this deals damage to that player equal to the total mana value of those cards\./g, (a, d, m) => `__punisher:${d}:${m}__.`);
    // Arcane Bombardment: a random instant or sorcery from the graveyard is exiled with it; then each card exiled with it is copied and may be cast free.
    const t0b = t0p.replace(/exile an? (instant or sorcery|[a-z]+) card at random from your graveyard\. then copy each card exiled with this\. you may cast any number of the copies without paying their mana costs\./g, (a, w) => `__bombard:${w}__.`);
    const t0s = t0b.replace(/sacrifice any number of lands\. search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle\./g, '__scapeshift__.');
    const t0t = t0s.replace(/until your next turn, your life total can't change and you gain protection from everything\. all permanents you control phase out\./g, '__teferi__.');
    const t1a = t0t.replace(/choose a color\. add an amount of mana of that color equal to your devotion to that color\./g, '__devotion__.');
    const t1b = t1a.replace(/(?:reveal|look at) the top card of your library\. if it's an? ([a-z ]+?) card( of the chosen type)?, (you may )?(?:reveal it and )?put it (onto the battlefield|into your hand)\.(?: otherwise, you may put (?:that card|it) on the bottom of your library\.)?/g,
      (all, what, chosen, may, dest) => `__top:${what.trim()}:${chosen ? 1 : 0}:${/battlefield/.test(dest) ? 'battlefield' : 'hand'}:${/otherwise/.test(all) ? 1 : 0}__.`);
    // Worldly / Enlightened Tutor: "search your library for a creature card, reveal it, then shuffle and put the card on top".
    const t1c = t1b.replace(/search your library and\/or graveyard for an? ([a-z ]+?) card with mana value x or less and put it onto the battlefield\./g, (a, f) => `__finale:${f}__.`).replace(/search your library for an? ([a-z ]+?) card, reveal it, then shuffle and put (?:the|that) card on top\./g, (all, f) => `__tutortop:${f}__.`)
    // Rashmi: "reveal the top card of your library. you may cast it without paying its mana cost if it's a spell with lesser mana value. if you don't cast it, put it into your hand."
      .replace(/reveal the top card of your library\. you may cast it without paying its mana cost if it's a spell with lesser mana value\. if you don't cast it, put it into your hand\./g, '__rashmi__.');
    // "That player may pay {2}. If they don't, you create a Treasure token." (Smothering Tithe, Rhystic Study): the other
    // player chooses whether to pay; if they don't, the rest happens.
    const t2 = t1c.replace(/\b(that player|its controller|they|that opponent) may pay ((?:\{[^}]+\})+)\. if (?:they|that player|the player|he or she|its controller) (?:doesn't|don't|do not), ([^.]+)\./g, (all, w, cost, rest) => `__payor|${w}|${cost}|${rest}__.`);
    // "where X is …" applies to the clause before it.
    const sentences = t2.replace(/\.?\n/g, '. ').split(/(?<=\.)\s+|(?<=\.)$/).map(x => x.trim()).filter(Boolean);
    const ops = [];
    let understood = true;
    for (let sent of sentences) {
      const dg = sent.match(/^__dig:([a-z -]+):(mut|1):(either|battlefield|hand):([01]):(bottom|exile)__\.?$/);
      if (/^as an additional cost to cast this spell, discard (?:a|one) card\.?$/.test(sent)) continue;
      if (/^as an additional cost to cast this spell, (?:pay x life|sacrifice (?:a|an) [a-z ]+?(?: or discard a card)?)\.?$/.test(sent)) continue;   // paid as it's cast (601.2f)
      if (/^if you control a commander, you may cast this(?: spell)? without paying its mana cost\.?$/.test(sent)) continue;
      if (/^if that spell would be put into (?:your|a) graveyard, exile it instead\.?$/.test(sent)) continue;   // the free spell is exiled afterwards (not tracked)   // an alternative cost
      if (/^(?:rebound|split second|epic|fuse|escalate (?:\{[^}]+\})+|transmute (?:\{[^}]+\})+|suspend \d+—(?:\{[^}]+\})+)\.?$/.test(sent)) continue;   // keywords handled elsewhere (or by the players)   // handled as it resolves (702.88)
      if (/^activate (?:this ability )?only\b|^this ability costs (?:\{[^}]+\})+ less to activate\b/.test(sent)) continue;   // checked when it's activated (602.5)
      // Cost changes and "can't be countered" are about casting it, not what it does (601.2f, 101.2).
      if (/^this(?: spell)? costs? (?:\{[^}]+\})+ (?:less|more) to cast\b|^this spell can't be countered\.?$|^affinity for /.test(sent)) continue;   // paid as it's cast (601.2f)
      { const tr = root.Rulebook && root.Rulebook.tempRule(sent); if (tr) { ops.push({ op: 'ruleFx', until: tr.until, line: tr.line }); continue; } }
      // Vraska, Betrayal's Sting: "Target creature becomes a Treasure artifact with "…" and loses all other card types and abilities."
      if (/^target creature becomes a treasure artifact with "[^"]*" and loses all other card types and abilities\.?$/.test(sent)) { ops.push({ op: 'becomeTreasure', what: { k: 't', i: st.ti++, n: 1, what: 'creature' } }); continue; }
      // Avatar's Wrath: "Choose up to one target creature, then airbend all other creatures." (exile them; each owner may
      // cast theirs for {2} while it's exiled).
      if (/^choose up to one target creature, then airbend all other creatures\.?$/.test(sent)) { ops.push({ op: 'airbend', keep: { k: 't', i: st.ti++, n: 1, upTo: true, what: 'creature' } }); continue; }
      const ab1 = sent.match(/^airbend (target .+?)\.?$/);
      if (ab1) { const what = targetOf(ab1[1], st); if (what) { ops.push({ op: 'airbend', what }); continue; } }
      const bb = sent.match(/^__bombard:([a-z ]+)__\.?$/);
      if (bb) { ops.push({ op: 'bombard', what: bb[1] }); continue; }
      const pu = sent.match(/^__punisher:(\w+):(\w+)__\.?$/);
      if (pu) { ops.push({ op: 'punisher', who: { k: 't', i: st.ti++ }, draw: amt(pu[1]) || 3, mill: amt(pu[2]) || 3 }); continue; }
      const em = sent.match(/^__emblem:(\d+)__\.?$/);
      if (em) { ops.push({ op: 'emblem', text: emb[+em[1]] || '' }); continue; }
      const im = sent.match(/^__impulse:(\w+):(next|eot)__\.?$/);
      if (im) { ops.push({ op: 'impulse', n: amt(im[1]) || 1, until: im[2] }); continue; }
      const tt = sent.match(/^__tutortop:([a-z ]+)__\.?$/);
      if (tt) { ops.push({ op: 'search', n: 1, filter: tt[1], dest: 'top' }); continue; }
      const fn = sent.match(/^__finale:([a-z ]+)__\.?$/);
      if (fn) { ops.push({ op: 'search', n: 1, filter: fn[1], mvMax: { v: 'X' }, dest: 'battlefield' }); continue; }
      if (/^if (?:that|the|this) (?:creature|permanent|creature or planeswalker) would die this turn, exile it instead\.?$/.test(sent)) { ops.push({ op: 'dieExile', what: st.lastObj && st.lastObj.k === 't' ? st.lastObj : { k: 't', i: Math.max(0, st.ti - 1) } }); continue; }
      const tx = sent.match(/^__tapx:([a-z]+)__\.?$/);
      if (tx) { ops.push({ op: 'tapX', what: tx[1], then: [{ op: 'pump', what: { k: 'self' }, p: '+x', t: '+0', kws: '', eot: true, xv: { v: 'lastX' } }, { op: 'dmg', src: 'self', n: { v: 'lastX' }, to: { k: 'defender' } }] }); continue; }
      if (/^__rashmi__\.?$/.test(sent)) { ops.push({ op: 'rashmi' }); continue; }
      if (/^__scapeshift__\.?$/.test(sent)) { ops.push({ op: 'sacSearch', what: 'land', filter: 'land', tapped: true }); continue; }
      if (/^__teferi__\.?$/.test(sent)) { ops.push({ op: 'teferi' }); continue; }
      if (/^__devotion__\.?$/.test(sent)) { ops.push({ op: 'addDevotion' }); continue; }
      const tc = sent.match(/^__top:([a-z -]+):([01]):(battlefield|hand):([01])__\.?$/);
      if (tc) { ops.push({ op: 'dig', what: tc[1], n: 1, top: true, chosen: tc[2] === '1', dest: tc[3], mayBottom: tc[4] === '1', rest: 'top', tapped: false }); continue; }
      const po = sent.match(/^__payor\|([^|]+)\|([^|]+)\|(.+)__\.?$/);
      if (po) { const inner = parse(po[3] + '.', opts); ops.push({ op: 'payOrElse', who: who(po[1]), cost: po[2], ops: inner.ops, text: po[3] }); if (!inner.understood) understood = false; continue; }
      if (dg) { ops.push({ op: 'dig', what: dg[1], n: dg[2] === 'mut' ? 'mut' : 1, dest: dg[3], tapped: dg[4] === '1', rest: dg[5] }); continue; }
      // "If you're the monarch, it deals 7 damage instead." / "If it's an artifact, draw a card."
      // Reflexive triggers (603.12): "When you do, ..." is a new ability whose targets are chosen then.
      const rf = sent.replace(/\.$/, '').match(/^when you do, (.+)$/);
      if (rf) { const inner = parse(rf[1] + '.', opts); ops.push({ op: 'reflexive', text: rf[1], ops: inner.ops }); if (!inner.understood) understood = false; continue; }
      const ti = sent.replace(/\.$/, '').match(/^((?:draw a card|you gain \d+ life|create [^,]+?|scry \d+)) if (you control .+|you have .+|it's your turn|you're the monarch|an opponent .+|your life total is .+)$/);
      if (ti) { const inner = parse(ti[1] + '.', opts, st); ops.push({ op: 'if', cond: ti[2], ops: inner.ops }); if (!inner.understood) understood = false; continue; }
      const cm = sent.replace(/\.$/, '').replace(/^then (?=if )/, '').match(/^if (?!you do\b|they do\b|a player does\b|the player does\b|that player does\b)([^,]+), (.+?)( instead)?$/);
      if (cm) {
        const lead = /^instead,? /.test(cm[2]);
        const inner = parse(cm[2].replace(/^instead,? /, '') + '.', opts, st);
        ops.push({ op: cm[3] || lead ? 'instead' : 'if', cond: cm[1], ops: inner.ops });
        if (!inner.understood) understood = false;
        continue;
      }
      // Blink: "exile X, then return it/those cards to the battlefield under …" stays one clause.
      if (/^exile .+?,? then return (?:it|that card|those cards|them|those permanents) to the battlefield/.test(sent)) {
        const r = clause(sent.replace(/,? then /, ', then '), st);
        if (r) { ops.push(...r); continue; }
      }
      let xvar = null;
      const wx = sent.match(/,? where x is (.+?)\.?$/);
      if (wx) { xvar = variable(wx[1]); sent = sent.slice(0, wx.index); }
      // Split into clauses: "draw a card, then discard a card", "each opponent loses 1 life and you gain 1 life".
      const parts = sent.replace(/\.$/, '').split(/,? then |(?<!if you do|if they do|when you do|if a player does), (?=(?:gain|lose|draw|discard|mill|create|scry|surveil)s?\b)|\. then |, and then |,? and (?=(?:you |each opponent |each player |that player |target player |its controller )?(?:gains? (?:\d|x |that much|life|control)|loses?|draws?|discards?|mills?|creates?|puts?|scry|surveil|sacrifices?|untaps?|taps?|returns?|exiles?|becomes?|takes?|investigate|proliferate)\b)/);
      let subject = null, sentIfDid = false;
      for (let p of parts) {
        if (/^if you do,? /.test(p.trim())) sentIfDid = true;
        else if (sentIfDid) p = 'if you do, ' + p.trim();
        p = p.trim(); if (!p) continue;
        const sm = p.match(/^(you|each opponent|each player|target player|target opponent|that player|its controller)\b/);
        if (sm) subject = sm[1];
        else if (subject && /^(gains?|loses?|draws?|discards?|mills?|sacrifices?)\b/.test(p)) p = (subject.startsWith('target') ? 'that player' : subject) + ' ' + p;
        const r = clause(p, st);
        // The rest of a "look at the top N" ("put one of them into your hand and the rest on the bottom", "put them back in
        // any order") is done in the look window: it goes with the look.
        const lk = ops.length && ops[ops.length - 1].op === 'look' ? ops[ops.length - 1] : null;
        // "…put a land card from among them onto the battlefield" right after a look: part of the look window.
        const lk0 = ops.length && ops[ops.length - 1].op === 'look' ? ops[ops.length - 1] : null;
        if (lk0 && r && r.length === 1 && (r[0].op === 'fromAmong' || r[0].op === 'rest' || r[0].op === 'split')) { lk0.text = (lk0.text || '') + '. ' + p; continue; }
        if (!r && ops.length && ops[ops.length - 1].op === 'payUntap' && /^(?:if (?:they|the player|that player) (?:do|does),? )?untap those creatures$/.test(p)) continue;
        if (!r && lk && /\b(them|those cards|of them|the rest|that card|the other|it|the revealed cards?)\b|^you may shuffle/.test(p)) { lk.text = (lk.text || '') + '. ' + p; continue; }
        if (!r) { understood = false; ops.push({ op: 'manual', text: p.replace(/^./, x => x.toUpperCase()) }); continue; }
        for (const o of r) { if (xvar && o.op === 'pump' && /x/.test(String(o.p) + String(o.t))) o.xv = xvar; if (xvar && (o.n && o.n.v === 'X')) o.n = xvar; if (xvar && o.spec && (o.spec.p === 'x' || (o.spec.n && o.spec.n.v === 'X'))) { o.spec.x = xvar; if (o.spec.n && o.spec.n.v === 'X') o.spec.n = xvar; } ops.push(o); }
      }
    }
    // "Choose target artifact or creature. … gain control of it": "it" is the chosen target.
    const ch = ops.find(o => o.op === 'choose' && o.what && o.what.k === 't');
    if (ch) for (const o of ops) { if (o === ch) continue; for (const k of ['what', 'of', 'to']) if (o[k] && o[k].k === 'ev') o[k] = ch.what; }
    return { ops, understood, targets: st.ti };
  }

  // What a "look at the top N" lets you do, from its text: { keepTop, pick, filter, dest, rest, reveal }.
  // Shared by the table's window and the AI so both read the card the same way.
  function lookPlan(text) {
    const t = String(text || '').toLowerCase();
    if (/put them back in any order|put them back on top|put the rest back on top/.test(t) && !/into your hand|onto the battlefield/.test(t)) return { keepTop: true, pick: 0, rest: 'top', reveal: /reveal/.test(t) };
    const anyN = /any number of [a-z ]*cards? (?:from among them|of them)/.test(t);
    const nm = t.match(/put (?:up to )?(one|two|three|four|\d+) of (?:them|those cards) into your hand/);
    const pick = anyN ? 99 : nm ? (amt(nm[1]) || 1) : /into your hand|onto the battlefield/.test(t) ? 1 : 0;
    const filter = (t.match(/(?:reveal|put) (?:a|an|up to \w+|any number of) ([a-z ]+?) cards? from among/) || [])[1] || null;
    const dest = /from among them onto the battlefield|of them onto the battlefield/.test(t) ? 'battlefield' : 'hand';
    const rest = /rest (?:into|in) your graveyard|other(?:s)? into your graveyard/.test(t) || (/graveyard/.test(t) && !/bottom/.test(t)) ? 'graveyard' : /rest back on top|rest on top/.test(t) ? 'top' : 'bottom';
    return { keepTop: false, pick, filter: filter && filter !== 'card' ? filter : null, dest, rest, random: /random order/.test(t), tapped: /onto the battlefield tapped/.test(t), reveal: /reveal/.test(t), upTo: /up to|may|any number/.test(t) };
  }

  root.Effects = { parse, clause, variable, tokenSpec, who, obj, lookPlan };
})(typeof window !== 'undefined' ? window : globalThis);
