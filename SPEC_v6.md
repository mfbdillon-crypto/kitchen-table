# Kitchen Table v6 — rules-engine revamp (from Marissa's interview, 2026-10-21)

## Hard constraints
- DO NOT change the AI (ai.js behaviour) until Marissa gives a new prompt. Keep it working with the engine (no breakage), but no new AI features.
- Deploy to the TEST site only (joyful-rabanadas-f66e6c). Live site (starlit-conkies) only when she approves.
- After the engine is done: play a test game with a fresh Claude client (me vs fresh Claude, two seats), constantly checking triggers/counters/abilities. Report: short summary + fix list.

## Card model (parse every card's text)
1. Costs: mana cost + alternative/additional costs (flashback, warp, kicker, escape, overload, unearth, disturb, madness, evoke, dash, blitz, foretell, plot, cycling, convoke, commander tax…). UI: choose Cast → popup asks which cost if more than one.
2. P/T and every modifier: counters, statics (anthems), "gets +X/+X when attacking", triggers, temporary effects.
3. Keywords: all common + parameterized (ward {N}/—cost, protection from X, landwalk, etc.).
4. Name, supertypes, types, subtypes, all card info.
5. Each ability identified and counted: activated / triggered / static / spell / mana / replacement / keyword. Evaluate each.
6. Unknown text: do the known parts, then prompt the controller with the exact unknown sentence to finish by hand.

## Triggers
- Engine silently tracks triggers of permanents in play (and graveyard/command where relevant); after anything happens/resolves it checks for new triggers.
- Triggers go on the stack automatically at the right time (players never "choose to trigger").
- Only "may"/optional triggers ask "use it?" (ask each time).
- Targets chosen immediately as the trigger is put on the stack (603.3d); no legal target → removed.
- Simultaneous triggers: auto-order (APNAP, 603.3b), player can reorder.
- Intervening "if" conditions checked by the engine (raid: attacked this turn; creature died this turn; etc.).
- Example: Alesha, Who Laughs at Fate — attack trigger + raid end-step trigger.

## Temporary effects
- ALL "until end of turn" effects shown as badges/counters on the card (e.g. "+3/+3 EOT", "Pro red EOT", "Flying EOT"), removed by an end-of-turn cleanup trigger.
- Protection: protection counter on the card; "until end of turn" → removed at end of turn.

## Statics
- Apply automatically: anthems, keyword grants, cost changes, restrictions ("can't attack you unless…").
- Muldrotha-style graveyard permissions: just allow casting/playing from graveyard during your turn (player tracks the per-type limit).

## Other rules decisions
- Mana: enforce full payment; auto-pay by default, option to pick lands yourself.
- Legend rule: player chooses which to keep.
- Commander to graveyard/exile: ask each time.
- Multiple blockers: ALWAYS ask the attacker to assign damage.
- Life, poison, commander damage, loyalty: all automatic; losses checked.
- Tokens: working tokens (Treasure taps for mana etc.).
- Activated abilities: card menu, only currently-legal ones enabled, reasons shown for others.
- Copies/clones: common cases.
- Modes, X, colors, creature types, players: always prompt when the rules say.
- Rulings: show Scryfall rulings in the big card preview.
- SBAs: fully automatic, logged (704.3).
- Counters: ALL kinds (+1/+1 & −1/−1 annihilate, keyword counters, loyalty/defense/lore with saga chapters, stun/time/oil/charge, shield…).
- Target selection: show PICTURES of the possible targets (also for combat choices).
- Graveyard: click graveyard pile → click card → menu offers flashback/escape/unearth/disturb/Muldrotha casting etc. when legal.
- Hidden info: exactly who the card says.

## Turn flow
- Untap → upkeep → draw → main 1 automatic unless triggers in those steps (no pause for instants).
- Main 1: buttons "Go to combat" (only if able to attack) and "End turn". Main 2: "End turn".
- End turn still goes through combat (beginning-of-combat triggers), main 2, end step (triggers), cleanup.
- After combat damage → automatically main 2.
- Opponents get "anything before end of turn?" only if they can respond.
- No phase selector, no going backwards (only in developer debugging).
- Blocks: only defending players are prompted. Pre-damage tricks window: everyone who can respond.
- Timeouts: 2 minutes, then auto-pass / no blocks / skip optional.
- Buttons live in the top bar replacing ◀ step ▶; step name shown as plain text.
- No creature able to attack → only "End turn" offered (combat still runs silently for triggers).

## Developer debugging
- Host only; ⋯ menu toggle; red banner for everyone while on; automatically off at each new game.
- Powers: move any card anywhere (any player's zones), use any card's abilities on all boards (activate, trigger, tap/untap, counters, P/T), change phase/turn/stack (selector, back/forward, pass priority for others, resolve/remove stack items), edit players (life, poison, cmdr damage, mana pool, active player).

## Interface
- All players tab: List / Grid 2×2 / Grid 2×3 / 3×2; option to rotate each board 180° (feels like across the table). All tabs show each player's playmat and sleeves.
- Phone push: hand, AI chat/chat box, or both (phone shows tabs).
- Ready-made decks: always listed in the normal Decks list with a bracket badge; can't delete; copy to edit.
- Extra test decks: 4–6 Moxfield decks covering mechanics missing from the current 12 (sagas, adventures/MDFCs, energy, vehicles, mutate, landfall, proliferate, storm…), offered to players as "Test" decks.

## Test decks to prove the engine
- Her Alesha (Alesha, Who Laughs at Fate, BR), Muldrotha (BUG graveyard), Giada Angels, the 12 ready-made decks, plus the extra mechanic decks.
