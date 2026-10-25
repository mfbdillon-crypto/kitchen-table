// Kitchen Table — card model. Reads a card's rules text once and describes it:
// costs (and alternative costs), types, P/T, keywords, and every ability on it — each one classified as
// keyword, triggered, activated, mana, static, replacement or spell — with trigger events, conditions and effects.
// The rules engine (rules.js) uses this to put triggers on the stack by itself and to apply statics.
(function (root) {
  'use strict';
  const C = () => root.Cards;
  const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, x: 'X' };
  const num = w => w == null ? 1 : /^\d+$/.test(w) ? +w : NUMW[String(w).toLowerCase()] !== undefined ? NUMW[String(w).toLowerCase()] : null;
  const SUPER = ['legendary', 'basic', 'snow', 'world', 'ongoing', 'host'];
  const TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery', 'tribal', 'dungeon', 'conspiracy', 'phenomenon', 'plane', 'scheme', 'vanguard'];
  // Ability words are flavor labels in front of an ability ("Raid — At the beginning…"); 207.2c.
  const ABILITY_WORDS = /^(?:adamant|addendum|alliance|battalion|bloodrush|celebration|channel|chroma|cohort|constellation|converge|corrupted|council's dilemma|coven|delirium|descend \d+|domain|eerie|eminence|enrage|fateful hour|fathomless descent|ferocious|flurry|formidable|grandeur|hellbent|heroic|imprint|inspired|join forces|kinship|landfall|lieutenant|magecraft|metalcraft|morbid|pack tactics|paradox|parley|radiance|raid|rally|renew|revolt|secret council|spell mastery|strive|survival|sweep|tempting offer|threshold|undergrowth|valiant|void|will of the council|max speed|start your engines!?|exhaust)\s*[—-]\s*/i;
  // Keywords that stand alone on a line ("Flying, vigilance"), with their parameter if they take one.
  const KW_SIMPLE = ['flying', 'first strike', 'double strike', 'deathtouch', 'haste', 'hexproof', 'indestructible', 'lifelink', 'menace', 'reach', 'trample', 'vigilance', 'defender', 'flash', 'shroud', 'infect', 'wither', 'prowess', 'skulk', 'shadow', 'horsemanship', 'fear', 'intimidate', 'changeling', 'devoid', 'persist', 'undying', 'exalted', 'convoke', 'delve', 'improvise', 'cascade', 'storm', 'flanking', 'banding', 'phasing', 'rebound', 'split second', 'sunburst', 'living weapon', 'unleash', 'evolve', 'extort', 'dethrone', 'melee', 'mentor', 'riot', 'ascend', 'afflict', 'battle cry', 'soulbond', 'myriad', 'partner', 'decayed', 'training', 'ravenous', 'read ahead', 'toxic', 'backup', 'for mirrodin!', 'compleated', 'demonstrate', 'enlist', 'jump-start', 'retrace', 'cipher', 'haunt', 'epic', 'gravestorm', 'fuse', 'assist', 'friends forever', 'doctor\'s companion', 'daybound', 'nightbound', 'umbra armor', 'totem armor', 'protection', 'hexproof from', 'landwalk', 'islandwalk', 'swampwalk', 'forestwalk', 'mountainwalk', 'plainswalk', 'job select', 'offspring', 'gift', 'impending', 'disguise', 'cloak', 'saddle', 'spree', 'freerunning', 'bargain', 'craft', 'discover', 'mobilize', 'harmonize', 'warp', 'station', 'sneak'];
  const KW_PARAM = /^(ward|equip|kicker|multikicker|flashback|cycling|landcycling|basic landcycling|plainscycling|islandcycling|swampcycling|mountaincycling|forestcycling|typecycling|madness|morph|megamorph|disguise|unearth|escape|embalm|eternalize|encore|evoke|dash|blitz|buyback|echo|cumulative upkeep|bestow|emerge|surge|spectacle|prowl|ninjutsu|commander ninjutsu|foretell|plot|overload|mutate|reconfigure|disturb|cleave|squad|prototype|craft with|warp|harmonize|crew|fortify|outlast|level up|transmute|suspend|annihilator|bushido|rampage|fading|vanishing|modular|graft|bloodthirst|afterlife|amplify|devour|fabricate|tribute|renown|bolster|absorb|frenzy|poisonous|toxic|backup|ravenous|soulshift|afflict|crew|saddle|station|offspring|impending|mobilize|ward)\b\s*(.*)$/i;
  // Alternative ways to cast (and where from) — 118.9, 702.x.
  const ALT_COSTS = {
    flashback: { zone: 'graveyard', after: 'exile' }, escape: { zone: 'graveyard' }, unearth: { zone: 'graveyard', ability: true }, disturb: { zone: 'graveyard', back: true },
    'jump-start': { zone: 'graveyard', after: 'exile', extra: 'discard a card' }, retrace: { zone: 'graveyard', extra: 'discard a land card' }, embalm: { zone: 'graveyard', ability: true }, eternalize: { zone: 'graveyard', ability: true }, encore: { zone: 'graveyard', ability: true },
    kicker: { zone: 'hand', additional: true }, multikicker: { zone: 'hand', additional: true }, buyback: { zone: 'hand', additional: true }, bargain: { zone: 'hand', additional: true },
    evoke: { zone: 'hand' }, dash: { zone: 'hand' }, blitz: { zone: 'hand' }, overload: { zone: 'hand' }, surge: { zone: 'hand' }, spectacle: { zone: 'hand' }, prowl: { zone: 'hand' }, emerge: { zone: 'hand' },
    madness: { zone: 'exile' }, foretell: { zone: 'exile' }, plot: { zone: 'exile' }, warp: { zone: 'hand' }, bestow: { zone: 'hand' }, mutate: { zone: 'hand' }, prototype: { zone: 'hand' }, cleave: { zone: 'hand' },
    morph: { zone: 'hand', faceDown: true }, megamorph: { zone: 'hand', faceDown: true }, disguise: { zone: 'hand', faceDown: true }, ninjutsu: { zone: 'hand', ability: true }, 'commander ninjutsu': { zone: 'command', ability: true },
    cycling: { zone: 'hand', ability: true }, harmonize: { zone: 'graveyard' }, 'sneak': { zone: 'hand' }
  };

  // The triggered ability each of these keywords stands for (reminder text in modern wording).
  const KW_TRIGGERS = {
    extort: 'Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.',
    prowess: 'Whenever you cast a noncreature spell, this gets +1/+1 until end of turn.',
    exalted: 'Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.',
    annihilator: 'Whenever this attacks, defending player sacrifices N permanents.',
    'battle cry': 'Whenever this attacks, each other attacking creature gets +1/+0 until end of turn.',
    afflict: 'Whenever this becomes blocked, defending player loses N life.',
    bushido: 'Whenever this blocks or becomes blocked, it gets +N/+N until end of turn.',
    rampage: 'Whenever this becomes blocked, it gets +N/+N until end of turn for each creature blocking it beyond the first.',
    flanking: 'Whenever a creature without flanking blocks this, the blocking creature gets -1/-1 until end of turn.',
    'living weapon': 'When this enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.',
    renown: 'Whenever this deals combat damage to a player, if it isn\'t renowned, put N +1/+1 counters on it and it becomes renowned.',
    afterlife: 'When this dies, create N 1/1 white and black Spirit creature tokens with flying.',
    fabricate: 'When this enters, put N +1/+1 counters on it.',
    evolve: 'Whenever a creature you control enters, if that creature has greater power or toughness than this, put a +1/+1 counter on this.',
    training: 'Whenever this attacks with another creature with greater power, put a +1/+1 counter on this.',
    mentor: 'Whenever this attacks, put a +1/+1 counter on target attacking creature with lesser power.',
    'myriad': 'Whenever this attacks, for each opponent other than defending player, you may create a token that\'s a copy of this that\'s tapped and attacking that player or a planeswalker they control.',
    melee: 'Whenever this attacks, it gets +1/+1 until end of turn for each opponent you attacked this turn.',
    dethrone: 'Whenever this attacks the player with the most life or tied for most life, put a +1/+1 counter on this.',
    toxic: '',
    cascade: 'When you cast this spell, cascade.'
  };
  const cache = new Map();
  function faceOf(c, i) { return c && c.d && c.d.faces ? c.d.faces[i == null ? (c.face || 0) : i] || c.d.faces[0] : null; }
  function stripReminder(t) { return String(t || '').replace(/\([^)]*\)/g, '').replace(/[ \t]+\n/g, '\n').trim(); }
  // The card's own name (and its short name before a comma) become "this", as in modern Oracle wording.
  function selfRef(t, name) {
    if (!name) return t;
    let out = t;
    for (const x of [name, name.split(',')[0], name.split(' ')[0]].filter(x => x && x.length > 2)) {
      if (x === name.split(' ')[0] && x.length < 5) continue;
      out = out.split(x + "'s").join("this's").split(x).join('this');
    }
    return out.replace(/\bthis (creature|permanent|artifact|enchantment|land|planeswalker|vehicle|aura|equipment|saga|battle|spell|token|class|case|room)\b/gi, 'this');
  }
  function splitTypes(tl) {
    const [left, right] = String(tl || '').split(/\s+[—-]\s+/);
    const words = (left || '').toLowerCase().split(/\s+/).filter(Boolean);
    return { supertypes: words.filter(w => SUPER.includes(w)), types: words.filter(w => TYPES.includes(w)), subtypes: (right || '').split(/\s+/).filter(Boolean) };
  }

  // ---------------- triggers ----------------
  // The event part of "When/Whenever/At …, effect" → { type, self, who, what, other, filter }.
  function parseEvent(ev) {
    const r = parseEvent0(ev);
    if (r && typeof r.what === 'string') {
      const w = r.what;
      if (/ you control$/.test(w)) { r.what = w.replace(/ you control$/, ''); r.who = 'you'; }
      else if (/ (?:an opponent controls|your opponents control)$/.test(w)) { r.what = w.replace(/ (?:an opponent controls|your opponents control)$/, ''); r.who = 'opp'; }
    }
    return r;
  }
  function parseEvent0(ev) {
    const e = ev.toLowerCase().trim();
    let m;
    // "this or another Dragon you control enters" = this one, or any other matching one.
    if ((m = e.match(/^this or another (.+)$/))) { const r = parseEvent('another ' + m[1]); if (r.type !== 'other') return Object.assign(r, { orSelf: true }); }
    const who = s => /\bopponent/.test(s) ? 'opp' : /\byou\b|\byour\b|you control/.test(s) ? 'you' : 'any';
    // Steps and phases.
    if ((m = e.match(/^at the beginning of (your|each|each opponent's|each player's|the|that player's|the next|your next) ?(?:turn's )?(upkeep|draw step|precombat main phase|first main phase|main phase|combat(?: on your turn)?|end step|next end step|end of combat|second main phase|postcombat main phase)/))) {
      const step = /upkeep/.test(m[2]) ? 'upkeep' : /draw/.test(m[2]) ? 'draw' : /end of combat/.test(m[2]) ? 'endCombat' : /combat/.test(m[2]) ? 'combat' : /end step/.test(m[2]) ? 'end' : /second|postcombat/.test(m[2]) ? 'main2' : 'main1';
      return { type: 'step', step, whose: /your/.test(m[1]) || /on your turn/.test(m[2]) ? 'you' : /opponent/.test(m[1]) ? 'opp' : 'any', once: /next/.test(m[1] + m[2]) };
    }
    if (/^at end of combat/.test(e)) return { type: 'step', step: 'endCombat', whose: 'any' };
    // Zone changes.
    if ((m = e.match(/^this (?:enters|enters the battlefield|is put onto the battlefield)(?: or attacks)?(?: or (?:dies|leaves the battlefield))?$/))) return { type: 'enter', self: true, alsoAttack: /or attacks/.test(e) };
    if (/^this (?:enters|enters the battlefield) or (?:dies|leaves)/.test(e)) return { type: 'enter', self: true, alsoDie: true };
    if ((m = e.match(/^(another |one or more (?:other )?)?((?:nontoken |token |legendary |non-?[a-z]+ |[a-z]+ )*?)?(creatures?|lands?|artifacts?|enchantments?|planeswalkers?|permanents?|tokens?|[a-z]+s?)( you control| an opponent controls| your opponents control)? (?:enters|enter)(?: the battlefield)?(?: under your control| under an opponent's control)?(?: or attacks)?$/))) {
      return { type: 'enter', self: false, other: !!m[1] && /another|other/.test(m[1]), what: (m[2] || '') + m[3].replace(/s$/, ''), who: m[4] ? who(m[4]) : /under your control/.test(e) ? 'you' : 'any', many: /one or more/.test(m[1] || '') };
    }
    if (/^this mutates$/.test(e)) return { type: 'mutate', self: true };
    if (/^this dies or is put into exile from the battlefield$/.test(e)) return { type: 'leave', self: true, toIn: ['graveyard', 'exile'] };
    if (/^this attacks or becomes the target of a spell$/.test(e)) return { type: 'attack', self: true, alsoTargeted: true };
    if (/^a permanent you control is put into a graveyard(?: from the battlefield)?$/.test(e)) return { type: 'leave', self: false, what: 'permanent', who: 'you', toIn: ['graveyard'] };
    if ((m = e.match(/^an? (creature|permanent|artifact|enchantment) is exiled from the battlefield$/))) return { type: 'leave', self: false, what: m[1], who: 'any', toIn: ['exile'] };
    if ((m = e.match(/^one or more creatures you control with (flying|trample|menace|deathtouch) deal combat damage to (?:a player|an opponent|one or more players)$/))) return { type: 'combatDamage', self: false, who: 'you', what: 'creature', with: m[1], to: 'player', many: true };
    if ((m = e.match(/^this becomes crewed( for the first time each turn)?$/))) return { type: 'crewed', self: true, firstEachTurn: !!m[1] };
    if ((m = e.match(/^you draw your (second|third|fourth|fifth|sixth|seventh) card each turn$/))) return { type: 'draw', who: 'you', nthN: { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 }[m[1]] };
    if (/^this enters untapped$/.test(e)) return { type: 'enter', self: true, untapped: true };
    if (/^the ring tempts you$|^you choose a creature as your ring-bearer$/.test(e)) return { type: 'tempt' };
    if ((m = e.match(/^this (?:class )?becomes level (\d+)$/))) return { type: 'classLevel', self: true, n: +m[1] };
    if (/^this dies$|^this is put into (?:a|your) graveyard from the battlefield$/.test(e)) return { type: 'die', self: true };
    if ((m = e.match(/^(another |one or more (?:other )?)?((?:nontoken |token |legendary |non-?[a-z]+ |[a-z]+ )*?)?(creatures?|permanents?|artifacts?|[a-z]+s?)( you control| an opponent controls| your opponents control)? (?:dies|die|is put into a graveyard from the battlefield)$/))) {
      return { type: 'die', self: false, other: !!m[1] && /another|other/.test(m[1]), what: (m[2] || '') + m[3].replace(/s$/, ''), who: m[4] ? who(m[4]) : 'any', many: /one or more/.test(m[1] || '') };
    }
    if (/^this leaves the battlefield$/.test(e)) return { type: 'leave', self: true };
    if (/^this is put into your graveyard from anywhere|^this is put into a graveyard from anywhere/.test(e)) return { type: 'toGraveyard', self: true };
    if ((m = e.match(/^(?:one or more|a) ((?:[a-z]+ )*?)cards? (?:are|is) put into (your|an opponent's|a) graveyards? from (?:anywhere|your library)$/))) return { type: 'toGraveyard', self: false, what: (m[1] || '').trim() || 'card', who: /your/.test(m[2]) ? 'you' : /opponent/.test(m[2]) ? 'opp' : 'any', many: /one or more/.test(e) };
    // Combat.
    if (/^this attacks$/.test(e)) return { type: 'attack', self: true };
    if (/^this attacks or blocks$/.test(e)) return { type: 'attack', self: true, alsoBlock: true };
    if (/^this blocks$/.test(e)) return { type: 'block', self: true };
    if (/^this blocks or becomes blocked/.test(e)) return { type: 'block', self: true, alsoBlocked: true };
    if (/^this becomes blocked/.test(e)) return { type: 'blocked', self: true };
    if ((m = e.match(/^(another |one or more (?:other )?)?((?:nontoken |token |[a-z]+ )*?)?(creatures?)( you control)? attacks?$/))) return { type: 'attack', self: false, other: !!m[1] && /another|other/.test(m[1]), what: (m[2] || '') + 'creature', who: m[4] ? 'you' : 'any', many: /one or more/.test(m[1] || '') };
    if (/^you attack(?: with one or more creatures)?$/.test(e)) return { type: 'youAttack' };
    if (/^you attack a player$/.test(e)) return { type: 'youAttack' };
    if ((m = e.match(/^this deals combat damage to (a player|an opponent|a creature|a player or planeswalker|one or more players)$/))) return { type: 'combatDamage', self: true, to: /creature/.test(m[1]) ? 'creature' : 'player' };
    if ((m = e.match(/^(?:a|one or more) ((?:[a-z]+ )*?)creatures? you control deals? combat damage to (a player|an opponent|one or more players)$/))) return { type: 'combatDamage', self: false, who: 'you', what: (m[1] || '') + 'creature', to: 'player' };
    if ((m = e.match(/^(?:a|an|one or more) ([a-z]+?)s? you control deals? combat damage to (a player|an opponent|one or more players)$/)) && m[1] !== 'creature') return { type: 'combatDamage', self: false, who: 'you', what: m[1], to: 'player' };
    if (/^this deals damage/.test(e)) return { type: 'dealsDamage', self: true };
    if (/^this is dealt damage/.test(e)) return { type: 'dealtDamage', self: true };
    // Spells.
    if ((m = e.match(/^(you|a player|an opponent|each opponent) casts? (?:an|a|your first|their first|your second)?\b ?(.*?)(?:spell|spells)(?: each turn)?(?: from (?:your|their) (?:hand|graveyard))?(?:, | that |$)/)) || (m = e.match(/^(you|a player|an opponent) casts? (.*)$/))) {
      return { type: 'cast', who: m[1] === 'you' ? 'you' : /opponent/.test(m[1]) ? 'opp' : 'any', what: (m[2] || '').trim(), first: /first/.test(e), second: /second/.test(e) };
    }
    if (/^this becomes the target of a spell or ability/.test(e)) return { type: 'targeted', self: true, oppOnly: /an opponent controls/.test(e) };
    // Cards and life.
    if ((m = e.match(/^(you|a player|an opponent|each opponent) draws? (?:a|your second|their second|one or more)? ?cards?(?: each turn)?(?: except the first one (?:you|they) draws? in each of (?:your|their) draw steps)?$/))) return { type: 'draw', who: m[1] === 'you' ? 'you' : /opponent/.test(m[1]) ? 'opp' : 'any', second: /second/.test(e), notFirst: /except the first/.test(e) };
    if ((m = e.match(/^(you|a player|an opponent) discards? (?:a|one or more) ?(?:[a-z]+ )?cards?$/))) return { type: 'discard', who: m[1] === 'you' ? 'you' : /opponent/.test(m[1]) ? 'opp' : 'any' };
    if ((m = e.match(/^(you|a player|an opponent) gains? life/))) return { type: 'gainLife', who: m[1] === 'you' ? 'you' : /opponent/.test(m[1]) ? 'opp' : 'any', firstEach: /for the first time each turn/.test(e) };
    if ((m = e.match(/^(you|a player|an opponent) loses? life/))) return { type: 'loseLife', who: m[1] === 'you' ? 'you' : /opponent/.test(m[1]) ? 'opp' : 'any' };
    if ((m = e.match(/^you sacrifice (?:a|an|one or more|another) ?(.*)$/))) return { type: 'sacrifice', who: 'you', what: m[1] || 'permanent' };
    if ((m = e.match(/^you cycle (?:or discard )?(?:a|another) card$/))) return { type: 'cycle', who: 'you' };
    if ((m = e.match(/^you (?:create|put onto the battlefield) (?:a|one or more) ?(.*)tokens?$/))) return { type: 'token', who: 'you', what: m[1] || '' };
    if (/one or more \+1\/\+1 counters are put on (this|a creature you control)/.test(e)) return { type: 'counter', kind: '+1/+1', self: /this/.test(e) };
    if (/^this becomes tapped|^this becomes untapped/.test(e)) return { type: /untap/.test(e) ? 'untapped' : 'tapped', self: true };
    if (/^this is turned face up/.test(e)) return { type: 'faceUp', self: true };
    if ((m = e.match(/^(?:you|a player) (?:play|plays) a land/))) return { type: 'enter', self: false, what: 'land', who: /^you/.test(e) ? 'you' : 'any' };
    if (/^at the beginning of combat on (your|each player's|each opponent's) turn$/.test(e)) return { type: 'step', step: 'combat', whose: /your/.test(e) ? 'you' : /opponent/.test(e) ? 'opp' : 'any' };
    if (/^you cycle this$/.test(e)) return { type: 'cycle', who: 'you', self: true };
    if ((m = e.match(/^this enters and whenever (.+)$/))) return { type: 'enter', self: true };
    if ((m = e.match(/^(another |a |an )?((?:[a-z]+ )*?)creature (you control )?with power (\d+) or (less|greater) enters$/))) return { type: 'enter', self: false, other: /another/.test(m[1] || ''), what: (m[2] || '') + 'creature', who: m[3] ? 'you' : 'any', power: { n: +m[4], le: m[5] === 'less' } };
    if (/^a creature you control attacks alone$/.test(e)) return { type: 'attack', self: false, what: 'creature', who: 'you', alone: true };
    if ((m = e.match(/^(?:a|one or more) ((?:[a-z]+ )*?)creatures? (?:you control )?with (flying|trample|deathtouch|lifelink|haste|menace) attacks?$/))) return { type: 'attack', self: false, what: (m[1] || '') + 'creature', who: 'you', with: m[2], many: /one or more/.test(e) };
    if ((m = e.match(/^(?:a|one or more) creatures? attacks? you(?: or a planeswalker you control)?$/))) return { type: 'attack', self: false, what: 'creature', who: 'opp', attacksYou: true, many: /one or more/.test(e) };
    if ((m = e.match(/^(?:a|an|one or more) ((?:[a-z]+ )*?)([a-z]+?)s? you control (?:attack|attacks)$/))) return { type: 'attack', self: false, what: (m[1] || '') + m[2], who: 'you', many: /one or more/.test(e) };
    if ((m = e.match(/^(equipped|enchanted) creature deals combat damage to (?:a player|an opponent)$/))) return { type: 'combatDamage', self: false, attached: true, to: 'player' };
    if ((m = e.match(/^(?:a|an|one or more) ((?:[a-z]+ )*?)([a-z]+?)s? you control deals? combat damage to (?:a player|an opponent|one or more players|a player or battle)$/))) return { type: 'combatDamage', self: false, who: 'you', what: (m[1] || '') + m[2], to: 'player', many: /one or more/.test(e) };
    if (/^(?:a|one or more) creatures? deals? (?:combat )?damage to you$/.test(e)) return { type: 'combatDamage', self: false, who: 'opp', to: 'player', toYou: true, many: /one or more/.test(e) };
    if ((m = e.match(/^(?:a|an) (nontoken )?(creature|permanent) is put into (your|a player's|an opponent's) graveyard from the battlefield$/))) return { type: 'die', self: false, what: (m[1] || '') + m[2], who: /your/.test(m[3]) ? 'you' : /opponent/.test(m[3]) ? 'opp' : 'any', anyType: m[2] === 'permanent' };
    if ((m = e.match(/^(another |one or more (?:other )?)?((?:[a-z]+ )*?)(creatures?|permanents?) you control leaves? the battlefield(?: without dying)?$/))) return { type: 'leave', self: false, other: !!m[1] && /another|other/.test(m[1]), what: (m[2] || '') + m[3].replace(/s$/, ''), who: 'you', notDie: /without dying/.test(e), many: /one or more/.test(e) };
    if (/^an opponent plays a land$/.test(e)) return { type: 'enter', self: false, what: 'land', who: 'opp', played: true };
    if ((m = e.match(/^you put one or more (\+1\/\+1 )?counters on (?:a|an) ([a-z ]+?)(?: you control)?$/))) return { type: 'counter', kind: m[1] ? '+1/+1' : 'any', self: false, what: m[2] };
    if (/^you cast this spell$/.test(e)) return { type: 'cast', who: 'you', self: true };
    if (/^you expend/.test(e)) return { type: 'other', text: e };
    return { type: 'other', text: e };
  }
  // Split "When this enters, if you control …, you may draw a card." into event, intervening "if", optional, effect.
  function parseTrigger(line) {
    // "Whenever you cast an Aura, Equipment, or Vehicle spell, …": the type list's commas aren't the event's end.
    line = line.replace(/\b(casts? an? [a-z]+(?:, [a-z]+)*),? or ([a-z]+ spells?)/i, (m0, a, b) => a.replace(/, /g, ' or ') + ' or ' + b);
    // "Whenever a Goblin, Orc, or Army you control dies, …": a list of subtypes.
    line = line.replace(/\b(a|an|another) ([A-Z][a-z]+), ([A-Z][a-z]+),? or ([A-Z][a-z]+)\b/, (m0, a, x, y, z) => `${a} ${x} or ${y} or ${z}`);
    const m = line.match(/^(when|whenever|at)\s+(.+?),\s+(.+)$/i);
    if (!m) return null;
    let evText = ((m[1].toLowerCase() === 'at' ? 'at ' : '') + m[2]).replace(/ and whenever you fully unlock a room$/i, ''), rest = m[3];
    // "At the beginning of your end step, if you attacked this turn, …" (603.4)
    let cond = null;
    const ci = rest.match(/^if ([^,]+),\s*(.+)$/i);
    if (ci) { cond = ci[1].trim(); rest = ci[2]; }
    else { const ce = evText.match(/^(.+?),?\s+if (.+)$/i); if (ce && !/^at the beginning/i.test(evText)) { evText = ce[1]; cond = ce[2]; } }
    const optional = /^you may\b/i.test(rest) || /\byou may\b/i.test(rest.split(/[.;]/)[0]) && !/^(target|each)/i.test(rest);
    const ev = parseEvent(evText);
    return { event: ev, eventText: evText.trim(), condition: cond, optional, effect: rest.trim(), oncePerTurn: /this ability triggers only once each turn/i.test(line) };
  }
  // ---------------- activated abilities ----------------
  const COST_PART = /^(?:\{[^}]+\}|tap|untap|sacrifice [^,:]+|discard [^,:]+|pay \d+ life|pay [^,:]+|exile [^,:]+|remove [^,:]+|return [^,:]+ to its owner's hand|put [^,:]+ counters? on [^,:]+|mill [^,:]+|tap an untapped [^,:]+|tap [^,:]+ untapped [^,:]+|collect evidence \d+|forage|exert this|reveal [^,:]+|[+−-]\d+|[+−-]x|0)$/i;
  function parseActivated(line) {
    const m = line.match(/^((?:[^:"]|"[^"]*")+?):\s+(.+)$/);
    if (!m) return null;
    const costText = m[1].trim().replace(/^\[([+−\-]?(?:\d+|x))\]$/i, '$1');
    const parts = costText.split(/,\s*/);
    if (!parts.every(p => COST_PART.test(p.trim()) || /^\{[^}]+\}(\{[^}]+\})*$/.test(p.trim()))) return null;
    const loy = costText.match(/^([+−-]?\d+)$/);
    const manaStr = (costText.match(/\{[^}]+\}/g) || []).filter(x => !/^\{[TQ]\}$/i.test(x)).join('');
    const effect = m[2].trim();
    return {
      cost: costText, mana: manaStr, tap: /\{T\}/.test(costText), untapCost: /\{Q\}/.test(costText),
      sac: (costText.match(/sacrifice ([^,]+)/i) || [])[1] || null, discard: (costText.match(/discard ([^,]+)/i) || [])[1] || null,
      life: +((costText.match(/pay (\d+) life/i) || [])[1] || 0), loyalty: loy ? +loy[1].replace('−', '-') : undefined,
      sorcery: /activate only as a sorcery|activate (?:this ability )?only (?:any time you could cast a sorcery|during your turn)/i.test(effect),
      oncePerTurn: /activate only once each turn/i.test(effect),
      isMana: /^add \{|^add (?:one|two|three|x) mana|^add [^.]*mana/i.test(effect) && !/target/i.test(effect),
      effect: effect.replace(/\s*Activate (?:this ability )?only[^.]*\.?/i, '').trim()
    };
  }
  // ---------------- statics ----------------
  function parseStatic(line) {
    const l = line.toLowerCase().replace(/\.$/, '');
    let m;
    if ((m = l.match(/^(other )?((?:[a-z]+ )*?)?(creatures|[a-z]+s) you control get ([+-]\d+|[+-]x)\/([+-]\d+|[+-]x)(?: and have ([a-z ,]+))?(?: until end of turn)?$/))) return { kind: 'anthem', other: !!m[1], filter: ((m[2] || '') + m[3]).trim(), p: m[4], t: m[5], kws: m[6] || '', who: 'you' };
    if ((m = l.match(/^(other )?((?:[a-z]+ )*?)?(creatures|[a-z]+s) you control have ([a-z ,"]+)$/))) return { kind: 'grant', other: !!m[1], filter: ((m[2] || '') + m[3]).trim(), kws: m[4], who: 'you' };
    if ((m = l.match(/^creatures your opponents control get ([+-]\d+)\/([+-]\d+)$/))) return { kind: 'anthem', filter: 'creatures', p: m[1], t: m[2], who: 'opp' };
    if ((m = l.match(/^(all |each )?creatures get ([+-]\d+)\/([+-]\d+)$/))) return { kind: 'anthem', filter: 'creatures', p: m[2], t: m[3], who: 'all' };
    if ((m = l.match(/^(equipped|enchanted) (creature|permanent) gets ([+-]\d+)\/([+-]\d+)(?: and has ([a-z ,]+))?(?: for each [a-z ]+)?$/))) return { kind: 'attached', p: m[3], t: m[4], kws: m[5] || '' };
    if ((m = l.match(/^(equipped|enchanted) (creature|permanent) has ([a-z ,]+)$/))) return { kind: 'attached', p: '+0', t: '+0', kws: m[3] };
    if ((m = l.match(/^(equipped|enchanted) (creature|permanent) can't (attack or block|attack|block)/))) return { kind: 'attachedRestrict', what: m[3] };
    if ((m = l.match(/^([a-z ]*?)spells you cast cost \{(\d+)\} less to cast$/))) return { kind: 'costLess', filter: m[1].trim() || 'any', n: +m[2] };
    if ((m = l.match(/^([a-z ]*?)spells (?:your opponents cast|cost) (?:cost )?\{(\d+)\} more to cast$/))) return { kind: 'costMore', filter: m[1].trim(), n: +m[2] };
    if (/creatures can't attack you(?: or planeswalkers you control)? unless their controller pays/.test(l)) return { kind: 'attackTax', text: line };
    if (/you may (?:play|cast) [^.]* from (?:the top of your library|your graveyard)/.test(l)) return { kind: 'permission', from: /graveyard/.test(l) ? 'graveyard' : 'library', text: line };
    if (/^during each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard/.test(l)) return { kind: 'permission', from: 'graveyard', text: line, muldrotha: true };
    if (/^you may play an additional land|^you may play two additional lands|^you may play up to (?:two|three) additional lands/.test(l)) return { kind: 'extraLand', n: /two|up to two/.test(l) ? 2 : /three/.test(l) ? 3 : 1 };
    if (/^as long as /.test(l)) return { kind: 'conditional', text: line };
    if (/this can't (attack|block|be blocked)/.test(l)) return { kind: 'selfRestrict', text: line };
    if (/^(?:you have|creatures you control have|permanents you control have) (hexproof|shroud|protection)/.test(l)) return { kind: 'grantPlayer', text: line };
    if (/^this has |^this gets /.test(l)) return { kind: 'selfStatic', text: line };
    if (/^you have no maximum hand size|^your maximum hand size/.test(l)) return { kind: 'handSize', text: line };
    if (/^each (?:other )?[a-z ]+ you control enters with/.test(l)) return { kind: 'etbCounters', text: line };
    if (/^(?:players|your opponents|each opponent) can't /.test(l)) return { kind: 'restriction', text: line };
    if (/^you can't lose|^you don't lose/.test(l)) return { kind: 'restriction', text: line };
    return null;
  }
  // "This enters tapped", "enters with N counters", "If … would …, instead …" (614).
  function parseReplacement(line) {
    const l = line.toLowerCase();
    if (/^this enters tapped/.test(l)) return { kind: 'entersTapped', unless: (l.match(/unless (.+)$/) || [])[1] || null };
    if (/^this enters with/.test(l)) return { kind: 'entersWith', text: line };
    if (/^as this enters/.test(l)) return { kind: 'asEnters', text: line };
    if (/\bwould\b.*\binstead\b|^if .* would .*/.test(l)) return { kind: 'replacement', text: line };
    if (/^prevent all|^damage that would be dealt/.test(l)) return { kind: 'prevention', text: line };
    return null;
  }
  // A line made only of keywords: "Flying, first strike", "Ward {2}", "Flashback {2}{R}", "Protection from red".
  function parseKeywordLine(line) {
    const l = line.replace(/\.$/, '').trim();
    const parts = l.split(/,\s*(?![^{]*\})/).map(x => x.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const lp = p.toLowerCase();
      if (/^protection from /.test(lp)) { out.push({ k: 'protection', from: lp.slice(16).split(/\s+and\s+from\s+|,\s*from\s+|\s+and\s+/) }); continue; }
      if (/^hexproof from /.test(lp)) { out.push({ k: 'hexproof from', from: lp.slice(14) }); continue; }
      if (/^[a-z]+walk$/.test(lp)) { out.push({ k: 'landwalk', type: lp.replace(/walk$/, '') }); continue; }
      if (/^(?:enchant|equip|crew|ward)\b/.test(lp) || KW_PARAM.test(lp)) { const m = p.match(KW_PARAM) || p.match(/^(enchant)\s+(.*)$/i); if (m) { out.push({ k: m[1].toLowerCase(), param: (m[2] || '').replace(/^[—-]\s*/, '').trim() }); continue; } }
      const s = KW_SIMPLE.find(k => lp === k);
      if (s) { out.push({ k: s }); continue; }
      if (/^(?:annihilator|afflict|bushido|rampage|toxic|backup|poisonous|absorb|frenzy|fading|vanishing|modular|graft|bloodthirst|afterlife|amplify|devour|fabricate|tribute|renown|bolster|soulshift|mentor|training|casualty|squad|offspring|exploit) ?\d*$/.test(lp)) { out.push({ k: lp.replace(/ ?\d+$/, ''), param: (lp.match(/\d+$/) || [''])[0] }); continue; }
      return null;
    }
    return out.length ? out : null;
  }

  // ---------------- the model ----------------
  function model(c) {
    if (!c || !c.d) return null;
    const key = (c.d.n || '') + '|' + (c.face || 0) + '|' + (c.faceDown ? 1 : 0) + (c.d.mk ? '|' + c.d.mk : '') + (c.zone === 'battlefield' && c.counters && c.counters.level ? '|L' + c.counters.level : '') + (c.zone === 'battlefield' ? '|bf' : '') + (c.gained && c.zone === 'battlefield' ? '|g' + c.gained.length : '');
    if (cache.has(key)) return cache.get(key);
    const f = faceOf(c) || {};
    const name = f.n || c.d.n || '';
    const tl = splitTypes(f.t);
    const m = {
      name, faces: (c.d.faces || []).length, typeLine: f.t || '', supertypes: tl.supertypes, types: tl.types, subtypes: tl.subtypes,
      cost: f.mc || '', cmc: +c.d.cmc || 0, colors: C() ? C().colorsOf(c) : [], pt: f.p != null && f.p !== '' ? [f.p, f.tg] : null,
      loyalty: f.loy || f.l || null, keywords: [], costs: [], abilities: [], unknown: []
    };
    const isSpell = m.types.includes('instant') || m.types.includes('sorcery');
    const lines = stripReminder(C() && C().levelText ? C().levelText(c, (f.o || '') + (c.gained && c.zone === 'battlefield' ? '\n' + c.gained.join('\n') : '')) : (f.o || '')).split('\n').map(x => x.trim()).filter(Boolean);
    let modal = null;
    for (let raw of lines) {
      if (modal && /^[•●]/.test(raw)) { modal.modes.push(selfRef(raw.replace(/^[•●]\s*/, ''), name)); continue; }
      // Spree (702.172): "+ {2} — mode" lines are modes with an extra cost each.
      if (modal && modal.spree && /^\+\s*\{/.test(raw)) { modal.modes.push(selfRef(raw, name)); continue; }
      if (isSpell && /^spree\b/i.test(raw)) { modal = { kind: 'spell', text: raw, modes: [], spree: true }; m.abilities.push(modal); continue; }
      modal = null;
      let line = selfRef(raw, name);
      const aw = line.match(ABILITY_WORDS); const abilityWord = aw ? aw[0].replace(/\s*[—-]\s*$/, '') : null;
      if (aw) line = line.slice(aw[0].length);
      // Saga chapters "I, II — …"
      const ch = line.match(/^((?:I|II|III|IV|V|VI)(?:,\s*(?:I|II|III|IV|V|VI))*)\s*[—-]\s*(.+)$/);
      if (ch && m.subtypes.some(x => /saga/i.test(x))) { m.abilities.push({ kind: 'triggered', chapter: ch[1].split(/,\s*/).map(r => ({ I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 })[r]), event: { type: 'chapter' }, effect: ch[2], text: line, optional: false }); continue; }
      const kws = parseKeywordLine(line);
      if (kws) {
        for (const k of kws) {
          m.keywords.push(k);
          if (ALT_COSTS[k.k]) m.costs.push(Object.assign({ kind: k.k, cost: k.param || '', text: line }, ALT_COSTS[k.k]));
          if (k.k === 'equip' || k.k === 'crew' || k.k === 'reconfigure' || k.k === 'fortify') m.abilities.push({ kind: 'activated', keyword: k.k, cost: k.param, mana: (k.param.match(/\{[^}]+\}/g) || []).join(''), sorcery: k.k !== 'crew', effect: k.k === 'equip' ? 'Attach this to target creature you control.' : k.k === 'crew' ? `Tap untapped creatures with total power ${k.param} or more: this becomes an artifact creature until end of turn.` : line, text: line });
          if (k.k === 'cycling' || /cycling$/.test(k.k)) m.abilities.push({ kind: 'activated', keyword: k.k, zone: 'hand', cost: k.param + ', Discard this card', mana: (k.param.match(/\{[^}]+\}/g) || []).join(''), effect: k.k === 'cycling' ? 'Draw a card.' : `Search your library for a ${k.k.replace(/cycling$/, '').trim() || 'land'} card, reveal it, put it into your hand, then shuffle.`, text: line });
        }
        m.abilities.push({ kind: 'keyword', text: line, keywords: kws.map(k => k.k) });
        // Keywords that are triggered abilities (702.x): the table puts them on the stack like any other trigger.
        for (const k of kws) {
          const t = KW_TRIGGERS[k.k]; if (!t) continue;
          const txt = t.replace(/N/g, k.param || '1');
          const tr = parseTrigger(txt);
          if (tr) m.abilities.push(Object.assign({ kind: 'triggered', text: txt, keywordOf: k.k }, tr));
        }
        continue;
      }
      if (/^choose (?:one|two|three|one or more|one or both|any number)\b/i.test(line)) { modal = { kind: isSpell ? 'spell' : 'modal', text: line, modes: [], pick: line }; m.abilities.push(modal); continue; }
      const trig = /^(when|whenever|at)\b/i.test(line) ? parseTrigger(line) : null;
      const MODAL = /choose (?:one|two|three|one or more|one or both|any number|up to (?:one|two|three|x))\b[^.]*(?:—|\.)?\s*$/i;
      if (trig) { const a = Object.assign({ kind: 'triggered', text: line, abilityWord }, trig); m.abilities.push(a); if (MODAL.test(a.effect || '')) { a.modes = []; modal = a; } continue; }
      const act = parseActivated(line);
      if (act) { const a = Object.assign({ kind: act.isMana ? 'mana' : 'activated', text: line, abilityWord }, act); m.abilities.push(a); if (MODAL.test(a.effect || '')) { a.modes = []; modal = a; } continue; }
      // On an instant or sorcery, every line that isn't about casting it is part of what it does ("Creatures you control get +2/+1 until end of turn").
      if (isSpell && /^(?:escalate|rebound|split second|epic|fuse|transmute|suspend|storm|replicate|buyback|entwine|splice|conspire|demonstrate|casualty|squad|gift|freerunning|bargain)\b/i.test(line)) { m.abilities.push({ kind: 'keyword', text: line }); continue; }
      if (isSpell && !/^(?:this spell|this) (?:can't be countered|costs)|^as an additional cost|^affinity for|^if you control a commander|^(?:escalate|rebound|split second|epic|fuse|transmute|suspend|storm|replicate|buyback|kicker|multikicker|flashback|cycling|overload|retrace|jump-start|entwine|splice|conspire|demonstrate|casualty|squad|offspring|gift|freerunning|bargain|harmonize|warp|sneak)\b/i.test(line)) { m.abilities.push({ kind: 'spell', text: line }); continue; }
      const rep = parseReplacement(line);
      if (rep) { m.abilities.push(Object.assign({ text: line }, rep, { kind: 'replacement', sub: rep.kind })); continue; }
      const st = parseStatic(line);
      if (st) { m.abilities.push(Object.assign({ text: line, abilityWord }, st, { kind: 'static', sub: st.kind })); continue; }
      if (isSpell) { m.abilities.push({ kind: 'spell', text: line }); continue; }
      // Vehicles' "Crew N" handled above; the rest of a permanent's text we couldn't place.
      m.abilities.push({ kind: 'static', text: line, unknownStatic: true });
      m.unknown.push(line);
    }
    // Effects of triggered/activated/spell abilities through the effect parser in cards.js.
    for (const a of m.abilities) {
      const t = a.kind === 'spell' ? a.text : a.kind === 'triggered' || a.kind === 'activated' || a.kind === 'mana' ? a.effect : null;
      if (t == null || !C()) continue;
      const e = C().effectsIn(t);
      a.effects = e.effects;
      const E = (typeof Effects !== 'undefined') ? Effects : root.Effects;
      if (E && a.modes && a.modes.length) {
        // Modal: "choose one/two/one or more/any number —" (+ commander "may choose both").
        const h = String(t).toLowerCase(), mm = h.match(/choose (one or more|one or both|any number|up to (\w+)|\w+)/);
        const nw = { one: 1, two: 2, three: 3, four: 4 };
        // "Choose up to X, where X is the number of times you chose a mode for that spell" (Riku of Many Paths).
        const choose = a.spree ? { min: 1, max: a.modes.length } : !mm ? 1 : /one or more|any number|one or both/.test(mm[1]) ? { min: 1, max: a.modes.length } : mm[2] === 'x' ? { min: 0, max: 'X', modesOfSpell: /number of times you chose a mode/.test(h) } : mm[2] ? { min: /^up to/.test(mm[1]) ? 0 : 1, max: nw[mm[2]] || 1 } : nw[mm[1]] || 1;
        const pre = a.spree ? '' : h.replace(/escalate (?:\{[^}]+\})+/, '').replace(/choose [^—]*—/, '').replace(/choose [^.—]*(?:—|\.)/, '').replace(/if you control a commander[^.]*\./, '').replace(/you may choose the same mode more than once\.?/, '').replace(/^\s*\./, '').trim();
        const preOps = pre ? E.parse(pre) : { ops: [], understood: true, targets: 0 };
        const modes = a.modes.map(x => { const r = E.parse(x.replace(/^\+\s*(?:\{[^}]+\})+\s*—\s*/, '').replace(/^[^—]{1,30} — /, '')); return { text: x, ops: r.ops, understood: r.understood, nTargets: r.targets }; });
        a.ops = preOps.ops.concat([{ op: 'modes', choose, both: /may choose both/.test(h), repeat: /same mode more than once/.test(h), modes }]);
        a.understood = preOps.understood && modes.every(x => x.understood);
      } else if (E) { const r = E.parse(t); a.ops = r.ops; a.nTargets = r.targets; a.understood = r.understood && r.ops.length > 0; }
      else a.understood = e.understood && e.effects.length > 0;
      a.targets = C().targetsIn(t);
      if (!a.understood) a.unknownText = t;
    }
    m.costs.unshift({ kind: 'normal', cost: m.cost, zone: m.types.includes('land') ? null : 'hand' });
    m.counts = m.abilities.reduce((o, a) => (o[a.kind] = (o[a.kind] || 0) + 1, o), {});
    cache.set(key, m);
    return m;
  }

  // ---------------- matching events to triggers ----------------
  // Does trigger ability `a` of permanent `src` (controlled by `ctrl`) fire for event `ev`?
  // ev: { type, card (the object it's about), player (who did it / whose step), ... }
  function fires(s, src, a, ev) {
    const E = a.event; if (!E || E.type === 'other') return false;
    const ctrl = src.ctrl;
    const whoOk = (w, p) => w === 'any' || !w || (w === 'you' ? p === ctrl : p !== ctrl);
    const whatOk = (what, card) => !what || !card || C().matchesWhat(card, what.replace(/\b(another|other)\b/g, '').trim() || 'permanent');
    switch (E.type) {
      case 'step': return ev.type === 'step' && ev.step === E.step && (E.whose === 'any' || (E.whose === 'you' ? ev.player === ctrl : ev.player !== ctrl));
      case 'enter':
        if (ev.type !== 'enter') return E.alsoAttack && ev.type === 'attack' && E.self && ev.card && ev.card.id === src.id;
        if (E.orSelf && ev.card && ev.card.id === src.id) return true;
        if (E.self) return ev.card && ev.card.id === src.id && !(E.untapped && ev.card.tapped);
        if (E.other && ev.card && ev.card.id === src.id) return false;
        if (E.power && ev.card) { const p = (C().pt(s, ev.card) || [0])[0]; if (E.power.le ? p > E.power.n : p < E.power.n) return false; }
        return whoOk(E.who, ev.card && ev.card.ctrl) && whatOk(E.what, ev.card);
      case 'die':
        if (ev.type !== 'die') return false;
        if (E.orSelf && ev.card && ev.card.id === src.id) return true;
        if (E.self) return ev.card && ev.card.id === src.id;
        if (E.other && ev.card && ev.card.id === src.id) return false;
        return whoOk(E.who, ev.ctrl) && whatOk(E.what, ev.card);
      case 'leave':
        if (E.toIn && ev.type === 'leave' && !E.toIn.includes(ev.to)) return false;
        if (E.self === false) { if (ev.type !== 'leave' || !ev.card || (E.other && ev.card.id === src.id)) return false; if (E.notDie && ev.to === 'graveyard' && ev.card.wasCre) return false; return whoOk(E.who, ev.card.ctrl) && whatOk(E.what, ev.card); }
        return ev.type === 'leave' && ev.card && ev.card.id === src.id;
      case 'attack':
        if (E.alsoTargeted && ev.type === 'targeted' && ev.card && ev.card.id === src.id) return true;
        if (ev.type !== 'attack') return false;
        if (E.self) return ev.card && ev.card.id === src.id;
        if (E.other && ev.card && ev.card.id === src.id) return false;
        if (E.attacksYou) return ev.def === ctrl;
        if (E.alone) return !!(ev.alone && ev.card && ev.card.ctrl === ctrl);
        if (E.with && ev.card && !C().has(ev.card, E.with, s)) return false;
        return whoOk(E.who, ev.card && ev.card.ctrl) && whatOk(E.what, ev.card);
      case 'youAttack': return ev.type === 'youAttack' && ev.player === ctrl;
      case 'block': return (ev.type === 'block' && ev.card && ev.card.id === src.id) || (E.alsoBlocked && ev.type === 'blocked' && ev.card && ev.card.id === src.id);
      case 'blocked': return ev.type === 'blocked' && ev.card && ev.card.id === src.id;
      case 'combatDamage':
        if (ev.type !== 'combatDamage' || (E.to === 'player' && ev.to !== 'player') || (E.to === 'creature' && ev.to !== 'creature')) return false;
        if (E.attached) return !!(ev.card && src.attachedTo === ev.card.id);
        if (E.toYou) return ev.player === ctrl && ev.card && ev.card.ctrl !== ctrl;
        if (E.with && ev.card && !C().has(ev.card, E.with, s)) return false;
        return E.self ? !!(ev.card && ev.card.id === src.id) : whoOk(E.who, ev.card && ev.card.ctrl) && whatOk(E.what, ev.card);
      case 'crewed': return ev.type === 'crewed' && ev.card && ev.card.id === src.id;
      case 'cast': if (E.self) return ev.type === 'cast' && ev.card && ev.card.id === src.id;
        return ev.type === 'cast' && whoOk(E.who, ev.player) && castWhatOk(E.what, ev.card) && (!E.first || ev.nth === 1) && (!E.second || ev.nth === 2);
      case 'draw': return ev.type === 'draw' && whoOk(E.who, ev.player) && (!E.nthN || ev.nth === E.nthN);
      case 'discard': return ev.type === 'discard' && whoOk(E.who, ev.player);
      case 'gainLife': return ev.type === 'gainLife' && whoOk(E.who, ev.player);
      case 'loseLife': return ev.type === 'loseLife' && whoOk(E.who, ev.player);
      case 'sacrifice': return ev.type === 'sacrifice' && ev.player === ctrl && whatOk(E.what, ev.card);
      case 'token': return ev.type === 'token' && ev.player === ctrl;
      case 'tapped': case 'untapped': return ev.type === E.type && ev.card && ev.card.id === src.id;
      case 'targeted': return ev.type === 'targeted' && ev.card && ev.card.id === src.id && (!E.oppOnly || ev.player !== ctrl);
      case 'classLevel': return ev.type === 'classLevel' && ev.card && ev.card.id === src.id && ev.n === E.n;
      case 'tempt': return ev.type === 'tempt' && ev.player === ctrl;
      case 'mutate': return ev.type === 'mutate' && ev.card && ev.card.id === src.id;
      case 'chapter': return ev.type === 'chapter' && ev.card && ev.card.id === src.id && a.chapter.includes(ev.n);
      case 'counter': return ev.type === 'counter' && (E.kind === 'any' || ev.kind === E.kind) && (E.self ? ev.card && ev.card.id === src.id : ev.card && ev.card.ctrl === ctrl && (!E.what || whatOk(E.what, ev.card)));
      case 'cycle': return ev.type === 'cycle' && ev.player === ctrl && (!E.self || (ev.card && ev.card.id === src.id));
      // "Whenever one or more land cards are put into your graveyard from anywhere" (The Gitrog Monster).
      case 'toGraveyard': if (ev.type !== 'toGraveyard' || !ev.card) return false;
        if (E.self) return ev.card.id === src.id;
        return (E.who !== 'you' || ev.card.owner === ctrl) && (E.who !== 'opp' || ev.card.owner !== ctrl) && (!E.what || C().matchesWhat(Object.assign({}, ev.card, { zone: 'graveyard' }), E.what));
      default: return false;
    }
  }
  function castWhatOk(what, card) {
    const w = String(what || '').replace(/^(?:a|an)\s+/, '').trim();
    if (!w || !card) return true;
    const Cd = C();
    const words = w.split(/\s+or\s+/);
    return words.some(alt => alt.split(/\s+/).every(x0 => {
      const x = x0.replace(/s$/, '');
      if (/^non/.test(x)) return !Cd.isType(card, x.replace(/^non-?/, ''));
      if (['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'legendary', 'battle', 'kindred'].includes(x)) return Cd.isType(card, x);
      if (['white', 'blue', 'black', 'red', 'green'].includes(x)) return Cd.colorsOf(card).includes({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[x]);
      if (x === 'multicolored') return Cd.colorsOf(card).length > 1;
      if (x === 'colorless') return !Cd.colorsOf(card).length;
      return true;
    }));
  }
  // Intervening "if" (603.4): conditions the engine can check by itself.
  function conditionHolds(s, src, cond) {
    if (!cond) return true;
    const c = cond.toLowerCase().trim(), me = src.ctrl, T = s.turn || {}, st = T.stats || {};
    let m;
    if (/^you attacked (?:with a creature )?this turn$|^you attacked this turn$/.test(c)) return !!(st.attacked && st.attacked[me]);
    if (/^a creature died this turn$/.test(c)) return (st.died || 0) > 0;
    if (/^you gained life this turn$/.test(c)) return !!(st.gained && st.gained[me]);
    if (/^an opponent lost life this turn$/.test(c)) return Object.keys(st.lost || {}).some(p => p !== me);
    if (/^you(?:'ve)? cast two or more spells this turn$/.test(c)) return ((st.spells || {})[me] || 0) >= 2;
    if (/^it wasn't put onto the battlefield with this ability$/.test(c)) return true;   // checked as it resolves (engine fromHand)
    if (/^it's your combat phase$/.test(c)) return T.active === me && /combat|attackers|blockers|damage/i.test((root.Rules && root.Rules.PHASES[T.phase]) || '');
    if (/^it's not your turn$/.test(c)) return T.active !== me;
    if (/^it's your turn$/.test(c)) return T.active === me;
    if ((m = c.match(/^(?:it|this) has (\w+) or more ([+\-\d/]+|[a-z]+) counters on (?:it|this)$/)) || (m = c.match(/^there are (\w+) or more ([+\-\d/]+|[a-z]+) counters on (?:it|this)$/))) { const n = num(m[1]) || 0; return (((src.counters || {})[m[2]]) || 0) >= n; }
    if ((m = c.match(/^you control exactly (\w+) permanents$/))) return Object.values(s.cards).filter(x => x.zone === 'battlefield' && x.ctrl === me).length === (num(m[1]) || 0);
    if (/^you cast it$/.test(c)) return !!src.wasCast;
    if ((m = c.match(/^you control an? ([a-z ]+)$/)) && !/ with /.test(m[1])) return Object.values(s.cards).some(x => x.zone === 'battlefield' && x.ctrl === me && C().matchesWhat(x, m[1]));
    if (/^you have the initiative$/.test(c)) return (s.table || {}).initiative === me;
    if ((m = c.match(/^you gained (\w+) or more life this turn$/))) return ((st.gained || {})[me] || 0) >= (num(m[1]) || 0);
    if (/^you didn't lose life this turn$/.test(c)) return !((st.lost || {})[me]);
    if (/^this is tapped$/.test(c)) return !!src.tapped;
    if ((m = c.match(/^each player has (\w+) or less life$/))) return (s.seats || []).every(p => !s.players[p] || s.players[p].life <= (num(m[1]) || 0));
    if (/^you have more cards in hand than each opponent$/.test(c)) return (s.seats || []).filter(p => p !== me).every(p => ((s.players[me] || {}).handCount || 0) > ((s.players[p] || {}).handCount || 0));
    if ((m = c.match(/^you have (\w+) or more ([a-z ]+?) cards? in your graveyard$/))) return Object.values(s.cards).filter(x => x.zone === 'graveyard' && x.owner === me && C().matchesWhat(x, m[2])).length >= (num(m[1]) || 0);
    if ((m = c.match(/^creatures you control have total power (\w+) or greater$/))) return Object.values(s.cards).filter(x => x.zone === 'battlefield' && x.ctrl === me && C().isType(x, 'creature')).reduce((t, x) => t + Math.max(0, (C().pt(s, x) || [0])[0]), 0) >= (num(m[1]) || 0);
    if (/^there are four or more card types among cards in your graveyard$/.test(c)) { const ty = new Set(); for (const x of Object.values(s.cards)) if (x.zone === 'graveyard' && x.owner === me) for (const t of ['artifact', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery', 'battle', 'kindred']) if (C().isType(x, t)) ty.add(t); return ty.size >= 4; }
    if ((m = c.match(/^an opponent controls more ([a-z]+?)s? than you$/))) { const n = p => Object.values(s.cards).filter(x => x.zone === 'battlefield' && x.ctrl === p && C().matchesWhat(x, m[1])).length; return (s.seats || []).some(p => p !== me && n(p) > n(me)); }
    if (/^you control a commander$/.test(c)) return Object.values(s.cards).some(x => x.cmdr && x.ctrl === me && x.zone === 'battlefield');
    if ((m = c.match(/^you control (\w+) or fewer ([a-z ]+?)s?$/))) { const n = num(m[1]); if (n != null) return Object.values(s.cards).filter(x => x.zone === 'battlefield' && x.ctrl === me && C().matchesWhat(x, m[2])).length <= n; }
    if ((m = c.match(/^you control an? ([a-z ]+?) with power (\d+) or greater$/))) return Object.values(s.cards).some(x => x.zone === 'battlefield' && x.ctrl === me && C().matchesWhat(x, m[1]) && ((C().pt(s, x) || [0])[0] >= +m[2]));
    if (/^you control your commander$/.test(c)) return Object.values(s.cards).some(x => x.cmdr && x.owner === me && x.ctrl === me && x.zone === 'battlefield');
    if ((m = c.match(/^you control (\w+) or more ([a-z ]+?)s?$/i))) { const n = num(m[1]) || 0; const w = m[2].toLowerCase(); return Object.values(s.cards).filter(x => x.zone === 'battlefield' && x.ctrl === me && (C().matchesWhat(x, w) || C().isType(x, w))).length >= n; }
    if ((m = c.match(/^you have (\d+) or more life$/))) return (s.players[me] || {}).life >= +m[1];
    if ((m = c.match(/^you have (\d+) or less life$/))) return (s.players[me] || {}).life <= +m[1];
    if ((m = c.match(/^there are (\w+) or more cards in your graveyard$/))) return Object.values(s.cards).filter(x => x.zone === 'graveyard' && x.owner === me).length >= (num(m[1]) || 0);
    const life = p => (s.players[p] || {}).life || 0;
    const opps = () => (s.seats || []).filter(p => p !== me && s.players[p] && !s.players[p].lost);
    const lands = p => Object.values(s.cards).filter(x => x.zone === 'battlefield' && x.ctrl === p && C().isType(x, 'land')).length;
    if ((m = c.match(/^you have at least (\d+) life more than your starting life total$/))) return life(me) >= 40 + +m[1];
    if ((m = c.match(/^you gained (\d+) or more life this turn$/))) return ((st.gained || {})[me] || 0) >= +m[1];
    if (/^you didn't lose life this turn$/.test(c)) return !((st.lost || {})[me]);
    if (/^you lost life this turn$/.test(c)) return !!((st.lost || {})[me]);
    if (/^you're the monarch$/.test(c)) return (s.table || {}).monarch === me;
    if (/^you have the initiative$/.test(c)) return (s.table || {}).initiative === me;
    if (/^an opponent controls more lands than you$/.test(c)) return opps().some(p => lands(p) > lands(me));
    if (/^that player controls more lands than you$/.test(c)) return null;
    if ((m = c.match(/^each player has (\d+) or less life$/))) return (s.seats || []).every(p => !s.players[p] || s.players[p].lost || life(p) <= +m[1]);
    if (/^you have more cards in hand than each opponent$/.test(c)) return opps().every(p => ((s.players[me] || {}).handCount || 0) > ((s.players[p] || {}).handCount || 0));
    if ((m = c.match(/^you control an? (.+?) with power (\d+) or greater$/))) return Object.values(s.cards).some(x => x.zone === 'battlefield' && x.ctrl === me && C().matchesWhat(x, m[1]) && ((C().pt(s, x) || [0])[0] >= +m[2]));
    if ((m = c.match(/^creatures you control have total power (\d+) or greater$/))) return Object.values(s.cards).filter(x => x.zone === 'battlefield' && x.ctrl === me && (x.faceDown || C().isType(x, 'creature'))).reduce((t, x) => t + Math.max(0, (C().pt(s, x) || [0])[0]), 0) >= +m[1];
    if ((m = c.match(/^you have (\w+) or more ([a-z ]+?) cards in your graveyard$/))) return Object.values(s.cards).filter(x => x.zone === 'graveyard' && x.owner === me && C().matchesWhat(x, m[2])).length >= (num(m[1]) || 0);
    if (/^you've drawn more than one card this turn$/.test(c)) return ((st.drew || {})[me] || 0) > 1;
    if (/^there are four or more card types among cards in your graveyard$/.test(c)) { const ts = new Set(); for (const x of Object.values(s.cards)) if (x.zone === 'graveyard' && x.owner === me) for (const t of ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery']) if (C().isType(x, t)) ts.add(t); return ts.size >= 4; }
    if (/^(?:this spell|it) was kicked$|^this was kicked$/.test(c)) return src.alt === 'kicker' || src.alt === 'multikicker';
    if (/^this spell was bargained$|^it was bargained$/.test(c)) return src.alt === 'bargain';
    if (/^this is untapped$/.test(c)) return !src.tapped;
    if (/^this is tapped$/.test(c)) return !!src.tapped;
    if (/^your life total is greater than or equal to the last noted life total for this(?: [a-z]+)?$/.test(c)) { const live = s.cards && s.cards[src.id]; const n = live && live.noted != null ? live.noted : src.noted; return life(me) >= (n == null ? 0 : n); }
    return null;      // unknown condition: the player is asked
  }

  root.Oracle = { model, fires, conditionHolds, parseTrigger, parseEvent, parseActivated, parseStatic, parseKeywordLine, selfRef, stripReminder, clear: () => cache.clear() };
})(typeof window !== 'undefined' ? window : globalThis);
