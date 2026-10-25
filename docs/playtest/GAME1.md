# Kitchen Table playtest, game 1

## Setup
- **Table code:** `pt1g39704`. Local server on :8090, driven with Playwright (`mock.js`), at 1440x900. Every action went through the UI (hand menu, command-zone menu, combat bar, target picker bar, priority bar, search/discover/damage modals). The driver is /tmp/claude-0/playtest/driver.mjs and the helpers are st.sh, pass.sh and wm.sh.
- **Seats** (turn order was randomized): Marissa (human, me), then Angela (AI, normal), then Gitty (AI, hard).
  - Me: precon #7 **Bello — Enchantments** (RG).
  - Gitty, hard: precon #10 **The Gitrog Monster — Lands** (BG).
  - Angela, normal: precon #6 **Giada — Angels** (W).
- House rules were the defaults: 40 life, 1 land a turn, free first mulligan.
- **Length and result:** 22 game turns, about 15 minutes of wall time. I had 8 turns (1, 4, 7, 10, 13, 16, 19, 21).
  - Gitty lost on turn 20 to Angela's flyers, at 14 → −6. My Bello had dealt it 20 commander damage by then.
  - Angela won on turn 22 with a 34-power flying attack, taking me from 24 to −8. The game ran to its natural end.
- **Errors:** no page errors or console errors were recorded during the whole game (`errs` stayed empty), and nothing stalled for good.
- **Files:**
  - Log export: /tmp/claude-0/playtest/game1_log.json. It holds `KT.S.log`, the dev export, the AI snapshots and `Rulebook.unread`.
  - Raw dev export: /tmp/claude-0/playtest/dev_export.json.
  - AI snapshot from mid-game: /tmp/claude-0/playtest/aisnap_t18.json.
  - Screenshots: /tmp/claude-0/playtest/shots/.

## Problems, most important first

### 1. "Attacking creatures you control …" anthems apply to every creature, including blockers — illegal move
- **Cards:**
  - Gruul War Chant: "Attacking creatures you control get +1/+0 and have menace."
  - Berserkers' Onslaught: "Attacking creatures you control have double strike."
- **What happened:** once these were on the battlefield, all my creatures always had +1/+0, menace and double strike.
  - **Turn 10:** Bello was not attacking, yet `Cards.pt` = [4,3] and `Cards.has(Bello,'menace')` = true.
  - **Turn 13:** `has(Bello,'double strike')` = true outside combat.
  - **Turn 21:** the target picker showed Verduran Enchantress (0/2) as 2/2.
  - **Turn 22, Angela attacking:** my blocking Verduran Enchantress (real 0/2) dealt *first-strike* damage and then regular damage, killing a 2/2 Citizen. Log:
    `First-strike damage: Verduran Enchantress dealt 1 damage to Citizen` … `Verduran Enchantress dealt 1 damage to Citizen` … `Citizen was destroyed (lethal damage)`.
  - **Turn 22, Khalni Ambush on Angela's turn:** Bello (3/3, not attacking) "fought" Giada (4/4) and killed her, because it dealt 4.
- **Should be:** only creatures that are attacking get the bonus.
- **Cause:**
  - `Oracle.model` gives War Chant `filter: "attacking creatures"`.
  - `cards.js` `statics()` (≈ line 136) calls `matchesWhat(c, 'attacking creature')`, which ignores the adjective. `Cards.matchesWhat(Bello,'tapped creature')` also returns true on an untapped Bello.
  - So `matchesWhat` never checks attacking, blocking or tapped status.
- **Repro:** put Gruul War Chant on the battlefield with any creature, then check `Cards.pt(KT.S, creature)` outside combat.

### 2. A pending "todo" (discover, sacrifice choice) doesn't hold the turn; steps and turns advance under it — illegal move
- **Discover happens on the next player's turn.**
  - **Turn 16 → 17:** Chimil, the Inner Sun's end-step "discover 5" resolved. The log then reads `Chimil…’s ability resolved` → `Marissa passed the turn to Angela` → `Angela untapped` → `Marissa cascaded: revealed 2 cards, hitting Asceticism`.
  - The discover modal ("Cast it free or put it into your hand") appeared during **Angela's combat**. I cast Asceticism during her combat-damage step, with her Archangel of Thune trigger on the stack.
  - **Turn 19 → 20:** the same thing happened. I cast Verduran Enchantress (a creature) during Angela's main phase, with her Angel of Jubilation on the stack.
  - **Turn 21 → 22:** the same thing happened with Khalni Ambush.
  - In each case the turn timer polls showed `todo:[{k:'cascade',discover:true}]` while the turn number and phase kept moving.
- **Upkeep trigger lets the draw step pass.**
  - **Turn 18:** Gitrog's upkeep trigger made Gitty choose a land to sacrifice. The land hitting the graveyard put a Gitrog "draw a card" trigger on the stack.
  - Three milliseconds later the log shows `Gitty drew a card for the turn`, and the phase reached Main 1 with that trigger still on the stack.
- **Should be:** discover is chosen while Chimil's trigger resolves, in my end step (701.57). No step may end while the stack is non-empty or a resolution is still waiting on a choice (500.2).
- **Cause:** `engine.js` `busy()` (line 1326) checks the stack, `prio`, `tq` and `ask`, but **not `s.todo`**. So `flow()` advances `turn.goal` ('pass') while a todo is pending.
- **Repro:** control Chimil, click End turn, Pass on the discover trigger, and don't touch the modal. Angela's turn starts.

### 3. Double strike + trample against multiple blockers: second-strike damage reuses the first assignment and never tramples over — illegal move
- **Turn 19:** Bello (5/3 with double strike, trample and menace) was blocked by The Gitrog Monster (6/6) and Fyndhorn Elves (1/1). I assigned the first strike as 4 to Gitrog and 1 to Elves, and the Elves died.
- **What happened in regular damage:** "Bello dealt 4 damage to The Gitrog Monster; Bello dealt 1 damage to The Gitrog Monster". All 5 went to Gitrog, and nothing reached Gitty. I wasn't asked for a new assignment.
- **Should be:** Gitrog already had 4 damage, so lethal was 2. With trample, 3 could go to Gitty (702.19c, 510.1c-d). That would have been lethal commander damage: 20 + 3 = 23.
- **Repro:** a double-strike trampler blocked by two creatures, where the first strike kills one.

### 4. Card's own first name replaced with "this" everywhere in its text (Beast Within makes no token) — illegal move / unread text
- **Turn 9:** Gitty's Beast Within destroyed Giada, Font of Hope, but Angela got **no 3/3 Beast token**. Log: `Beast Within destroyed Giada…` then `Beast Within resolved`, with no "created" line.
- `Engine.spellOps` for Beast Within gives `spec:{desc:"green this", types:"this"}`.
- **Cause:** `oracle.js` `selfRef()` (lines 56-63) replaces `name.split(' ')[0]` ("Beast", 5 letters or more) with "this" across the whole text.
- **Other cards affected:** any card whose first name-word is 5 letters or more and also appears in its text — "Beast …", "Angel …", "Goblin …", "Dragon …" token makers, tribal text and so on. This is a broad bug.
- The `token` op with `types:"this"` then fails silently, and nothing is flagged as unread.

### 5. Bello, Bard of the Brambles' static ability does nothing, and isn't reported — unread text / missing option
- **Text:** "During your turn, each non-Equipment artifact and non-Aura enchantment you control with MV ≥ 4 is a 4/4 Elemental creature … indestructible, haste, and 'whenever this creature deals combat damage to a player, draw a card.'"
- **What happened:** Gruul War Chant (MV 4), Berserkers' Onslaught (MV 5), Chimil (MV 6), Street Riot (MV 5), Asceticism (MV 5) and Encroaching Dragonstorm (MV 4) never became creatures. The combat bar said "1 can attack" every turn.
- This is the deck's commander and whole plan, and `aiprofiles.js` describes it.
- **The unread report missed it:** `Rulebook.unread(KT.S)` returned `[]` all game. `tools/manual_cov.js` only checks triggered, activated and spell text, so static abilities that aren't implemented are invisible.
- No code handles "in addition to its other types" (grep finds nothing).

### 6. Pain lands never deal damage; mana-spend restrictions ignored — illegal move
- **Llanowar Wastes**
  - The AI tapped it for {B} or {G} on turn 3 (Putrid Imp {B}), turn 6 (Traverse the Ulvenwald {G}) and turn 12 (Grim Flayer {B}{G}).
  - Gitty's life never dropped from it. Text: "{T}: Add {B} or {G}. Llanowar Wastes deals 1 damage to you."
- **Giada, Font of Hope:** "{T}: Add {W}. Spend this mana only to cast an Angel spell."
  - On turn 8 Angela tapped Giada (plus a Plains) to pay **Equip {2}** for Sword of the Animist. Log: `Angela tapped 2 permanents` → `activated Sword of the Animist … targeting Giada`. The board showed `Giada(T)`.
- **Other abilities read wrong:**
  - Training Compound's "Activate only if …" mana ability is also read as unconditional.
  - Fire-Lit Thicket's filter ability `{R/G}, {T}` is skipped, so it can only make {C}.
- **Cause:** `cards.js` `manaSource()` (lines 269-292).
  - The regex treats "`{B} or {G}. this deals 1 damage to you`" as plain "B or G".
  - Nothing in the codebase reads "Spend this mana only" (grep finds nothing).
  - Same for Karplusan Forest in my deck, though autopay mostly took {C} from it.

### 7. Sanctuary Warden: no shield counters, and its "remove a counter: if you do" is free — illegal move
- **No shield counters:** "enters with two shield counters" is ignored.
  - On turn 17 it entered with only Giada's +1/+1 counters: `{"+1/+1":2}`.
  - **Cause:** `rules.js` ≈ line 1679 only accepts `+1/+1|-1/-1|loyalty|charge|oil` in the "this enters with N … counters" regex. Shield is missing; time counters (Impending) probably are too.
- **The cost isn't paid:**
  - On turn 17, turn 20 and turn 22, the "you may remove a counter … If you do, draw a card and create a Citizen" trigger made Angela draw and get a Citizen token every time.
  - No counter was ever removed: every Angel kept all its counters.
  - `Effects.parse` gives `{op:'counters', n:-1, kind:'any', on:null, optional:true}` with no object chosen, yet `ifDid` is satisfied.
  - The AI trace says `may for Sanctuary Warden: {"yes":true}`.

### 8. Bridgeworks Battle: the creature fights itself — illegal move
- **Turn 21:** I targeted my Bello and Angela's Angel of Jubilation. Log: `Bello got +2/+2` → **`Angel of Jubilation fought Angel of Jubilation`**. Jubilation died to its own 7 damage, and Bello took nothing.
- **Should be:** "Then it fights up to one target creature" — "it" is the first target (Bello).
- **Cause:** spellOps gives the fight op `a:{k:'ev'}`. The 'ev' fix-up at `engine.js:466` runs only when the text splits into more than one sentence part. At run time, 'ev' resolves to the last-touched target (the second one).
- Khalni Ambush (two explicit targets) fought correctly.

### 9. Search can't take two copies of the same basic land — missing option
- **Turn 21:** Encroaching Dragonstorm says "search for up to two basic land cards".
  - The modal lists one card per name: Forest and Mountain, out of 12 basics in the library.
  - Clicking Forest a second time deselects it, so two Forests can't be taken.
- The Wooded Foothills search on turn 10 listed every card individually, so the two search UIs are inconsistent.

### 10. P/T badge on cards ignores static effects — UI confusion
- Bello showed "3/3" on the battlefield while the engine used 4/3 (turn 10) and then 5/3 (turns 13 and 19). Combat damage, fights and the target picker all used the engine value.
- **Cause:** `ui.js` line 366 uses `R.ptOf(c)` (counters plus `mod` only) rather than `Cards.pt(s,c)`. Anthems such as Angel of Jubilation, Street Riot and equipment don't show.

### 11. AI blunders
- **Angela (normal), turn 8:** paid Equip with Giada's restricted mana, which tapped her only attacker. She then didn't attack at all that turn. This depends on #6.
- **Gitty (hard), turn 18:** sacrificed **Llanowar Wastes**, its only black source, to Gitrog's upkeep cost, while it held five Forests. The trace says "least useful to my plan".
  - Right after, the trace says `dropped: cast Feed the Swarm → Angela’s Archangel of Thune` because it had no {B} left.
  - It could never cast black spells again, including recasting its commander.
- **Gitty, turns 15 and 18:** wasted its mana on a refused cast.
  - During Main 2, with its own Grim Flayer and Gitrog triggers on the stack, it tapped 2 lands (`Gitty tapped 2 permanents`) to cast Carnivorous Cultivator, a sorcery-speed creature.
  - The table refused it. Trace: `refused: cast Carnivorous Cultivator … “the table refused the spell”`. The lands stayed tapped.
  - The AI should check the timing before tapping, or retry once the stack empties.
- **Angela:** never activated Wayfarer's Bauble across 10+ turns, with "1 mana unused" at the end of several turns. Minor.
- **Gitty, turn 18 (suspect):** facing Angela's 30+ power of flyers at 14 life, it attacked me with three small creatures. Its own trace said "Desperate … could kill me", but it took no defensive action. It died the next turn.

### 12. Exported log is truncated to the last 300 lines — debug tooling
- `rules.js:83` splices `s.log` to 300 entries. Both `KT.S.log` and the dev "Export the game log" start mid-game, at `cast Putrid Imp`: turns 1-3 are missing.
- `permissions` (`KT.permLog`) was empty in the export. It seems to record only while dev mode is on, so a game where dev mode is turned on at the end gets no timeline. Suspect.

### 13. Smaller UI and cosmetic issues
- The command-zone menu reads "Cast (commander tax) — {1}{R}{G}" for the first cast, when the tax is 0.
- The log duplicates the player name: "Angela Angela created a Citizen token". The pid prefix is added on top of text that already contains the name. It also says "a Angel token".
- Event order in the log: "Giada … returned to the command zone (903.9a)" is printed *before* "Beast Within destroyed Giada".
- **Monarch / Initiative / Day-Night chips:** these sit in the top bar for everyone but only do anything for the dev host (`ui.js:1422`). For a normal player they look like buttons that do nothing.
- **Card menus offer "Tap" (suspect):** the menus for non-mana permanents such as Asceticism and Wooded Foothills offer "Tap". `rules.js` `case 'tap'` lets a controller tap any permanent at will, which is not a legal game action for non-mana permanents.
- RULES_SHEET says the first player skips the draw "(103.8c)". The engine correctly lets the first player draw in multiplayer, as 103.8c says, but the sheet's wording is wrong.

## Checked and correct
- **Mulligan gate:** before I kept, no card glowed and `usableNow` was false for all of them. The AIs kept and waited; nobody acted before every player had kept.
- **Lands:**
  - One land per turn: the other lands stopped glowing after a land drop.
  - Gitrog's extra land drop was used legally.
- **Lands entering tapped:**
  - Spire Garden entered untapped with two opponents.
  - Rockfall Vale entered tapped with only one other land.
  - Stomping Ground's pay-2-life prompt worked: 38 → 36, untapped.
- **Wooded Foothills:** paid 1 life, was sacrificed, and the search correctly included dual lands with the Mountain/Forest types.
- **Commander:**
  - Bello was castable from the command zone only once affordable.
  - Giada's recast cost {2} tax: 4 lands.
  - Commander damage was tracked (Gitty: 4, 12, 20).
  - When Giada died, the 903.9a choice went to the command zone for the AI. For me (Bello), I got the "Command zone / Leave it" prompt.
- **Combat:**
  - Summoning sickness, tapped attackers unable to block, and fliers blocked only by flying or reach (checked `Cards.blockProblem`).
  - Menace made Gitty double-block.
  - First-strike and regular damage steps worked, as did the multi-blocker damage-assignment modal.
  - Regeneration worked against deathtouch: tapped, damage removed, removed from combat.
  - Lifelink and Archangel of Thune's triggers were correct.
- **Giada's counters:** Giada's "+1 counter per Angel already controlled" was right for Archangel (1), Sanctuary Warden (2), Jubilation (3) and Resplendent (4).
- **Resplendent Angel:** its intervening "if you gained 5 or more life this turn" check made a token on Angela's turn but not on mine.
- **Tokens and dying:**
  - Tokens left the game when they died (111.7).
  - 704.5a losses happened at 0 life or less.
  - The eliminated player's cards left the game after the grace period.
- **Card effects:**
  - Verduran Enchantress's "may draw" prompt worked.
  - Traverse the Ulvenwald and Edge of Autumn searches respected their conditions.
  - The Gitrog upkeep and land-to-graveyard draw triggers fired once each.
  - Khalni Ambush, the MDFC front face, fought correctly.
- **AI plans:** the trace was readable. Normal Angela's flyer plan was coherent and won, and she cast her commander on turn 5 and again after it died.
- **Errors:** no page errors or console errors were seen in the whole game.
