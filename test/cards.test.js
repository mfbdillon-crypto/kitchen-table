require('../site/cards.js'); const C = globalThis.Cards; const assert = require('assert');
const card = (n, t, o, extra) => ({ id: n, d: { n, faces: [Object.assign({ n, t, o, mc: '', p: '', tg: '' }, extra || {})] }, counters: {}, zone: 'hand' });
const show = (c) => ({ reqs: C.targetReqs(c).map(r => r.kinds.join('/') + ':' + r.ctrl + (r.non.length ? ' non' + r.non : '') + ' n' + r.n), eff: C.effectsOf(c) });
const cases = [
  card('Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.'),
  card('Swords to Plowshares', 'Instant', 'Exile target creature. Its controller gains life equal to its power.'),
  card('Doom Blade', 'Instant', 'Destroy target nonblack creature.'),
  card('Wrath of God', 'Sorcery', "Destroy all creatures. They can't be regenerated."),
  card('Counterspell', 'Instant', 'Counter target spell.'),
  card('Rampant Growth', 'Sorcery', 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.'),
  card('Cultivate', 'Sorcery', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.'),
  card('Divination', 'Sorcery', 'Draw two cards.'),
  card('Giant Growth', 'Instant', 'Target creature gets +3/+3 until end of turn.'),
  card('Beast Within', 'Instant', 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.'),
  card('Rancor', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+0 and has trample.\nWhen Rancor is put into a graveyard from the battlefield, return Rancor to its owner\'s hand.'),
  card('Path to Exile', 'Instant', 'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.'),
  card('Murder', 'Instant', 'Destroy target creature.'),
  card('Unsummon', 'Instant', "Return target creature to its owner's hand."),
  card('Night\'s Whisper', 'Sorcery', 'You draw two cards and you lose 2 life.'),
  card('Sign in Blood', 'Sorcery', 'Target player draws two cards and loses 2 life.'),
  card('Raise the Alarm', 'Instant', 'Create two 1/1 white Soldier creature tokens.'),
  card('Rabid Bite', 'Sorcery', "Rabid Bite deals damage equal to the power of target creature you control to target creature you don't control."),
  card('Prey Upon', 'Sorcery', "Target creature you control fights target creature you don't control."),
  card('Blasphemous Act', 'Sorcery', 'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.'),
  card('Kolaghan\'s Command', 'Instant', 'Choose two —\n• Return target creature card from your graveyard to your hand.\n• Target player discards a card.\n• Destroy target artifact.\n• Kolaghan\'s Command deals 2 damage to any target.'),
  card('Chaos Warp', 'Instant', "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield."),
  card('Heroic Intervention', 'Instant', 'Permanents you control gain hexproof and indestructible until end of turn.'),
  card('Vindicate', 'Sorcery', 'Destroy target permanent.'),
  card('Fact or Fiction', 'Instant', 'Reveal the top five cards of your library.'),
];
for (const c of cases) console.log(c.d.n.padEnd(22), JSON.stringify(show(c)));
const sol = card('Sol Ring', 'Artifact', '{T}: Add {C}{C}.'); console.log('Sol', C.manaSource(sol));
const sig = card('Arcane Signet', 'Artifact', "{T}: Add one mana of any color in your commander's color identity."); console.log('Signet', C.manaSource(sig));
const tower = card('Command Tower', 'Land', "{T}: Add one mana of any color in your commander's color identity."); console.log('Tower', C.manaSource(tower));
const forest = card('Forest', 'Basic Land — Forest', '({T}: Add {G}.)'); console.log('Forest', C.manaSource(forest));
const dual = card('Stomping Ground', 'Land — Mountain Forest', '({T}: Add {R} or {G}.)\nAs Stomping Ground enters, you may pay 2 life.'); console.log('Dual', C.manaSource(dual));
const elf = card('Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.'); console.log('Elf', C.manaSource(elf));
const treasure = card('Treasure', 'Token Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.'); console.log('Treasure', C.manaSource(treasure));
const srcs = [{ id: 'f1', amount: 1, colors: 'G' }, { id: 'f2', amount: 1, colors: 'G' }, { id: 'm1', amount: 1, colors: 'R' }, { id: 'sol', amount: 2, colors: 'C' }, { id: 'tw', amount: 1, colors: 'WUBRG' }];
console.log('pay {2}{G}{G}', C.pay(C.parseCost('{2}{G}{G}'), srcs));
console.log('pay {R}{G}', C.pay(C.parseCost('{R}{G}'), srcs));
console.log('pay {W}{W}', C.pay(C.parseCost('{W}{W}'), srcs));
console.log('pay {4}{R}', C.pay(C.parseCost('{4}{R}'), srcs));
console.log('pay {X}{R} x=3', C.pay(C.parseCost('{X}{R}'), srcs, 3));
console.log('kw', [...C.keywords(card('Serra Angel', 'Creature — Angel', 'Flying, vigilance'))]);
console.log('kw2', [...C.keywords(card('Alesha', 'Legendary Creature', 'First strike\nWhenever Alesha attacks, you may pay {W/B}{W/B}.'))]);
console.log('abil', C.abilities(card('Prodigal Pyromancer', 'Creature', '{T}: Prodigal Pyromancer deals 1 damage to any target.')));
console.log('abil pw', C.abilities(card('Chandra', 'Legendary Planeswalker — Chandra', '+1: Chandra deals 2 damage to target player.\n−7: You get an emblem.')));
