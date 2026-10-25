

## Questions the table asks (`s.ask` → `{ type: "answer", id, … }`)

| Kind | When | Answer | AI handler |
|---|---|---|---|
| `may` | “You may …” on a triggered ability (or an intervening “if” the table can’t check) | `{ yes: true\|false, cond?: true\|false }` | brain.answerAsk → may |
| `targets` | Targets for a triggered ability being put on the stack | `{ tg: [[{ c: cardId } \| { p: playerId }, …] per target] }` | brain.answerAsk → targets (opIntent: hurt opponents / help me) |
| `modes` | Modes of a modal triggered ability | `{ modes: [index, …] } (min…max, not in ask.off)` | brain.answerAsk → modes |
| `order` | Order of several of my triggers that happened at once (603.3b) | `{ order: [triggerId, …] } in the order they should RESOLVE` | brain.answerAsk → order |
| `choose` | “As this enters, choose a color / creature type / player” | `{ value: "white" \| "Dragon" \| playerId }` | brain.answerAsk → choose |
| `enterOpt` | “Pay 2 life or it enters tapped” / “reveal a card or it enters tapped” | `{ yes: true\|false }` | brain.answerAsk → enterOpt |
| `legend` | Legend rule: keep one of my same-name legends (704.5j) | `{ keep: cardId }` | brain.answerAsk → legend |
| `cmdrZone` | My commander went to a graveyard/exile (or would go to my hand/library): command zone or not (903.9) | `{ command: true\|false }` | brain.answerAsk → cmdrZone (AI seats decide at once: always the command zone) |
| `punisher` | Combustible Gearhulk: let its controller draw N cards, or take damage from N milled cards | `{ yes: true\|false } (true = they draw)` | brain.answerAsk → punisher (AI seats decide at once) |
| `payLife` | Killing Wave: pay N life for each of my creatures I keep; the rest are sacrificed | `{ ids: [cardId, …] } (creatures to keep)` | brain.answerAsk → payLife (AI seats are decided at resolution) |
| `payUntap` | Mudslide: pay {2} each to untap any of my tapped creatures | `{ ids: [cardId, …] } (the table taps my lands for it)` | brain.answerAsk → payUntap |
| `pay` | “That player may pay {2}. If they don’t, …” (Smothering Tithe): pay to stop the rest from happening | `{ yes: true\|false } (true: the table taps my lands for it)` | brain.answerAsk → pay |
| `mutate` | My mutating spell merged with its host: keep the mutating card on top, or put it under (702.140c) | `{ top: true\|false }` | brain.answerAsk → mutate |
| `copy` | Clone: which creature it enters as a copy of | `{ pick: cardId \| null }` | brain.answerAsk → copy |
| `assign` | Combat damage of my attacker among 2+ blockers (510.1c) | `{ assign: { blockerId: n, …, player?: n } }` | brain.answerAsk → assign |
| `manual` | An effect the table can’t carry out by itself (“finish by hand”) | `{} (just acknowledge)` | executor: logs it as “couldn’t finish by hand” and acknowledges |

## Jobs only the owner can do (`s.todo[me]` → `todoAck`)

| Kind | What | AI handler |
|---|---|---|
| `draw` | Draw N cards | page draws by itself (game.js) |
| `millDmg` | Combustible Gearhulk: mill N, then the table deals damage equal to their total mana value | executor.onTodo → mill, then send millDmg |
| `mill` | Mill N cards | page mills by itself (game.js) |
| `discard` | Discard N (or at random) | executor.onTodo → brain.worstCards |
| `sacrifice` | Sacrifice N of a kind | executor.onTodo → least useful to my plan (never the commander if anything else) |
| `sacUnless` | Upkeep cost: sacrifice something or the source | executor.onTodo → sacrifice |
| `returnOwn` | Return a permanent I control to hand (Karoo lands…) | executor.onTodo → tapped basic land first |
| `scry` | Scry N | executor.onTodo → keep key cards / castable ones on top |
| `surveil` | Surveil N | executor.onTodo → same as scry, the rest to the graveyard |
| `look` | Look at the top N, take some | executor.onTodo → best for the plan |
| `fetch` | Search for basic lands | executor.onTodo → colors my hand needs |
| `search` | Search the library for a card | executor.onTodo → missing combo piece, key card, needed color |
| `cascade` | Cascade / discover N: reveal and maybe cast free (discover: or put it into my hand) | executor.onTodo → cast it unless it has no good target |
| `sacSearch` | Scapeshift: sacrifice any number of lands, then search for that many land cards (onto the battlefield tapped) | executor.onTodo → sacrifice every land, fetch the best ones |
| `freeCast` | You may cast a spell (of a kind, up to a mana value) from your hand or graveyard without paying its mana cost | executor.onTodo → best castable fit, cast with alt free |
| `impulse` | Exile the top N cards; I may play them this turn / until the end of my next turn (Riku, Jeska’s Will) | executor.onTodo → io.impulse; the plan then casts or plays them from exile |
| `handToTop` | Put N cards from my hand on top of my library (Brainstorm) | executor.onTodo → brain.worstCards |
| `dig` | Reveal until N matching cards (Illuna, Auspicious Starrix, The Regalia) → battlefield / hand / either | executor.onTodo → battlefield when I may choose |
| `fromHand` | Put a card from hand onto the battlefield | executor.onTodo → best for the plan |
| `fromGy` | Return a card from my graveyard | executor.onTodo → most valuable |

## Moments the AI must act

| When | What the AI does |
|---|---|
| Opening hand (private phase “deciding”) | brain.keepHand → io.keep / io.mulligan; “bottom” → brain.worstCards |
| s.ask has a question for me | brain.answerAsk, checked against this sheet |
| s.todo[me] has a job | executor.onTodo |
| s.prio.holder === me, something on the stack | brain.respond (saved responses: counter / protect / kill / sacrifice) → cast, else pass |
| s.prio.holder === me, step "end" (end of someone’s turn) | brain.respond (end-of-turn responses) → cast, else pass |
| s.prio.holder === me, combat window after blocks | brain.respond (combat tricks, removal on attackers, fogs) → cast, else pass |
| s.combat waiting for my blocks | brain.planBlocks → { type: "block", list } |
| My turn, Draw step | io.drawForTurn |
| My turn, main phase, nothing pending | plan steps in order: land → spells (Main 1 / Main 2) → equip → walkers → crew → advance “combat” |
| My turn, Declare attackers | brain.planAttack → { type: "attack", list } |
| My turn, Main 2 done | discard to 7 → advance “end” (the table runs end step, cleanup, next turn) |

## Actions the AI sends

| Action | Shape and use |
|---|---|
| `join` | { name, ai: { skill, by, v: 2 } } — sit down as the planning AI (the table then asks it questions instead of choosing for it) |
| `aiMeta` | { skill?, v: 2 } — change difficulty / mark as planning AI |
| `enter` | { zone: "battlefield"\|"stack"\|…, cards, land?, cast?, tg?, mode?, x?, alt?, fromPool? } — play a land or cast from hand (via io.playLand / io.castFromHand) |
| `move` | { ids, to, cast?, sac?, tapped? } — cast from command zone / graveyard, sacrifice, return |
| `tap` | { ids, tapped: true, pay: true } — pay mana (tapping to pay doesn’t add to the pool) |
| `activate` | { id, i, tg?, crew?, sac? } — abilities, equip, crew, loyalty, sacrifice outlets |
| `trigger` | { id, i, tg } — only for triggers the engine doesn’t put on the stack itself |
| `attack` | { list: [{ id, p }] } |
| `block` | { list: [{ id, att }] } |
| `pass` | { top } — pass priority |
| `advance` | { goal: "combat"\|"end" } — move my turn along |
| `answer` | { id, … } — see Questions |
| `aiSay` | { kind: "a", re, text } — reply to a question in the AI chat (the only time it speaks) |
