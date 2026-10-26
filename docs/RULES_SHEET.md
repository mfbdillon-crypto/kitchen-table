# Kitchen Table — rulebook sheet

Generated from `site/rulebook.js`. Every player starts with the default limits; card text read by the
patterns below adds permissions (CAN) or restrictions (CAN'T) for the players it names. "Can't" beats "can" (101.2).
Temporary rules from resolving spells ("until your next turn, …", "this turn, …") use the same patterns.

## Default rules — casting

| Id | Rule | What nobody can do |
|---|---|---|
| `cast.hand` | 601.3 | Spells are cast from your hand. |
| `cast.command` | 903.8 | Your commander may also be cast from the command zone, for {2} more for each previous time. |
| `cast.gy` | 601.3 | You can’t cast cards from a graveyard (flashback, escape, Muldrotha… are exceptions). |
| `cast.exile` | 601.3 | You can’t cast cards from exile (foretell, plot, warp, impulse draw, rebound… are exceptions). |
| `cast.library` | 601.3 | You can’t cast or play cards from your library (Courser of Kruphix, Vizier of the Menagerie… are exceptions). |
| `cast.others` | 601.3 | You can’t cast or play cards you don’t own from any zone, unless an effect lets you. |
| `cast.timing` | 307.1 | Non-instant spells only in your main phase, on your turn, with an empty stack (flash is an exception). |
| `land.zone` | 305.1 | Lands are played from your hand. |
| `land.timing` | 305.2 | One land per turn, on your turn, in a main phase, with an empty stack. |
| `cast.cost` | 601.2f | You pay the full cost, including additional costs. |
| `game.start` | 103.5 | Nothing is played until every player has kept an opening hand. |

## Default rules — combat

| Id | Rule | What nobody can do |
|---|---|---|
| `atk.turn` | 508.1 | Only the active player attacks. |
| `atk.sick` | 302.6 | A creature can’t attack or use {T} abilities unless you’ve controlled it since your turn began (haste is an exception). |
| `atk.tapped` | 508.1a | Tapped creatures can’t attack. |
| `blk.tapped` | 509.1a | Tapped creatures can’t block. |
| `blk.evasion` | 702 | Flying, menace, fear, intimidate, shadow, horsemanship and "can’t be blocked" limit blockers. |
| `cmdr.damage` | 903.10a | 21 combat damage from one commander makes a player lose. |

## Default rules — abilities

| Id | Rule | What nobody can do |
|---|---|---|
| `ab.cost` | 602.2 | Activated abilities need their full cost: {T}, mana, life, energy, sacrifices. |
| `ab.loyalty` | 606.3 | One loyalty ability per planeswalker per turn, at sorcery speed. |
| `ab.sorcery` | 602.5d | “Activate only as a sorcery” abilities only in your main phase with an empty stack. |
| `res.life` | 119.4 | You can pay life only if your life total is at least that much. |
| `res.energy` | 107.14 | You can pay {E} only with energy counters you have. |
| `res.draw` | 504.1 | One card drawn in your draw step (the first player skips it, 103.8c). |

## Default rules — zones

| Id | Rule | What nobody can do |
|---|---|---|
| `zone.hidden` | 400.2 | Libraries and hands are hidden; only the owner sees their hand, nobody sees a library. |
| `zone.order` | 401.2 | A library’s order is fixed; nobody may look through it or change it except by an effect. |
| `zone.newobj` | 400.7 | A card that changes zones becomes a new object with no memory of where it was. |
| `zone.token` | 111.7 | A token that leaves the battlefield ceases to exist the next time state-based actions are checked. |
| `zone.cmdr` | 903.9 | A commander that would go to a graveyard or exile may go to the command zone instead. |
| `zone.move` | — | Cards move only through the rules or effects; free moves by hand are a dev-mode tool for the host. |

## Permissions cards grant (CAN)

| Id | Who | Card text pattern |
|---|---|---|
| `gy.muldrotha` | you | `during each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard` |
| `gy.serra` | you | `once during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value (\w+) or less from your graveyard` |
| `gy.once` | you | `^(?:during each of your turns\|once (?:during )?each (?:of your )?turns?), you may cast (?:a\|an\|one) ([a-z ]+?) spell(?: with mana value (\w+) or less)? from your graveyard` |
| `gy.lands` | you | `you may play lands from your graveyard` |
| `gy.cast` | you | `^you may cast ([a-z ]+?) (?:spells )?from your graveyard` |
| `gy.selfAsLongAs` | you | `^you may cast this from your graveyard as long as (.+)$` |
| `gy.oppCast` | you | `you may cast ([a-z ]*?)spells from (?:your )?opponents' graveyards` |
| `top.both` | you | `you may play lands and cast spells from the top of your library` |
| `top.lands` | you | `you may play lands from the top of your library` |
| `top.cast` | you | `you may cast ([a-z ]*?)spells from the top of your library` |
| `top.look` | you | `you may look at the top (?:card )?of your library any time` |
| `top.revealed` | you | `play with the top card of your library revealed` |
| `top.oneMulti` | you | `once during each of your turns, you may cast a spell from your hand or the top of your library without paying its mana cost` |
| `ex.withThis` | you | `you may (?:cast\|play) (?:spells from among )?(?:the )?cards? exiled with this` |
| `flash` | you | `^you may cast ([a-z ]*?)spells(?: this turn)? as though they had flash` |
| `flash.cmdr` | you | `you may cast (?:your )?commanders? as though (?:it\|they) had flash` |
| `free.hand` | you | `you may cast spells from your hand without paying their mana costs` |
| `free.type` | you | `^you may cast ([a-z]+) spells without paying their mana costs` |
| `land.extra` | you | `you may play (an\|two\|three) additional lands? on each of your turns` |
| `land.extraEach` | each | `each player may play an additional land on each of their turns` |

## Restrictions cards impose (CAN'T)

| Id | Who | Card text pattern |
|---|---|---|
| `no.gyLib` | each | `players can't cast spells from graveyards or libraries` |
| `no.notHand` | from the text | `(your opponents\|players\|each player\|each opponent) can't cast spells from anywhere other than their hands` |
| `no.oppTurn` | opp | `your opponents can't cast spells (?:or activate abilities )?during your turn` |
| `no.oppTurnAb` | opp | `your opponents can't cast spells or activate abilities during your turn` |
| `no.mvLow` | opp | `your opponents can't cast spells with mana value (\w+) or less` |
| `no.mvHigh` | each | `players can't cast spells with mana value (\w+) or greater` |
| `no.noncreature` | from the text | `(your opponents\|players\|each player) can't cast noncreature spells` |
| `no.creature` | from the text | `(your opponents\|players\|each player) can't cast creature spells` |
| `no.spells` | from the text | `^(?:for the rest of the game, )?(you\|your opponents\|players\|each player) can't cast spells$` |
| `no.lands` | from the text | `(your opponents\|players\|each player) can't play lands` |
| `no.one` | each | `each player can't cast more than one spell each turn` |
| `no.oneNC` | each | `each player can't cast more than one noncreature spell each turn` |
| `no.artAb` | each | `activated abilities of artifacts(?: and creatures)? can't be activated` |
| `no.oppCreAb` | opp | `activated abilities of creatures your opponents control can't be activated` |
| `no.gain` | from the text | `(your opponents\|players) can't gain life` |
| `no.search` | from the text | `(your opponents\|players) can't search libraries` |
| `no.draw2` | each | `each player can't draw more than one card each turn` |
| `no.gyEnter` | each | `creature cards in graveyards and libraries can't enter the battlefield` |

## Card keywords that work outside the hand

Read from each card's own text (`Oracle.model(card).costs`): flashback, escape, jump-start, retrace, disturb,
harmonize, aftermath (graveyard); foretell, plot, warp, impulse draw (`mayPlay`), rebound (exile); unearth, embalm, eternalize, encore
(graveyard abilities); the commander from the command zone.

## Activation costs the table pays (602.2, `Cards.costPart`)

| Cost text | How it is paid |
|---|---|
| `{…}`, `{T}`, `Sacrifice this`, `Sacrifice a/another X`, `Discard a card`, `Pay N life`, `Pay {E}`, `Exile this` | as printed |
| `Return a/two/three X you control to its owner's hand` / `Return this to its owner's hand` | you pick the permanents (bounce) |
| `Untap a/two/… tapped X you control` | you pick the tapped creatures |
| `Tap a/an/another untapped X you control` | you pick them |
| `Remove a/N <kind> counter(s) from this` / `Put a <kind> counter on this` | from / onto the card itself (refused without enough counters) |
| `Exile a/N X card(s) from your graveyard` | you pick them |
| `Discard two/N cards` | your device discards |
| `Sacrifice two/N X` | you pick them |
| `Pay life equal to the number of colors in your commanders' color identity` | counted from your commanders |

## Abilities used from the hand (`Cards.handAbilities`)

Cycling {N} → draw a card; basic landcycling / landcycling / <type>cycling {N} → search for that card; Channel — {N}, Discard this: …;
`{N}, Discard this: …`. The card is discarded as the cost and the ability goes on the stack (action `handAb`).

## Choices while it resolves

- **Your choice of …** — `gains your choice of flying, vigilance, or trample`, `put your choice of a +1/+1, flying, or lifelink counter on …`: its controller gets a bar of buttons before it resolves (ask `pick`); the AI picks the strongest keyword (+1/+1 counters high).
- **How many** — X costs, multikicker, replicate: a −/+ picker from 0 with the most the untapped mana can pay (`askCount`). Kicks are stored on the spell (`c.kicks`); replicate copies it that many times.
- **Moving counters** — `Move a +1/+1 counter from target creature onto another target creature`: the first target must have that counter (`flags.counter`).

## Reveal and route (op `route`, todo `route`)

A sentence that starts “Reveal / Exile / Look at the top N cards of your library” or “Reveal cards … until you reveal a X card”,
and the sentences after it that say where cards go (“If it's a X card, put it …”, “Put it … if it's a X card”, “Otherwise, put it …”, “Put that card … and the rest …”,
“Put all X cards revealed this way … and the rest …”, “Put the rest …”) become one effect. “Mill N. You may put a X card from among them into your hand” too.
The owner's device shows the cards in a window with where each one goes; where the text doesn't say, the player picks from the zones the text names (or any zone with “Other…”).

## Statics handled outside the card model

| Text | Where |
|---|---|
| “… enter tapped” (yours or your opponents') | `rules.entersTapped` |
| “… can't be countered” | `Cards.uncounterable` |
| “… triggers an additional time” (entering, dying, attacking, casting instants/sorceries, chosen type, Shaman/Wizard) / “don't cause abilities … to trigger” | `engine.triggerTimes` |
| “Each land is a Forest in addition…”, “All lands are Islands in addition…” | `Cards.extraLandTypes` (types and mana) |
| “You may spend mana as though it were mana of any color” | `Cards.pay` |
| “If you tap a permanent for mana, it produces three times as much” | `Cards.manaSource` |
| “Enchanted land has "…"”, “Treasures you control have "…"”, “Equipped creature has "…"” | `Cards.granted` (the quoted ability is added to the card) |
| “You control enchanted creature” | `rules.auraControl` (control returns when the Aura leaves) |
| “The "legend rule" doesn't apply to permanents you control” | legend rule (rules + engine) |
| “Combat damage … can't be prevented” | `rules.combatDamage` |
| “Creatures without flying or islandwalk can't attack” | attack check |
| “Skip your draw step” | `game.autoDraw` |
| “Dredge N” | `game.draw` (asked on each draw) |
| “This costs {X} less …” (greatest power, total power, artifacts an opponent controls, per {E} paid), chosen-type and per-counter reductions | `Cards.costReduction` |
| “During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard” (Muldrotha) | rulebook `gy.*`, `limit: eachType` — a used-up type is explained on hover |
