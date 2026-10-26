# Handoff log — pick up here (updated 2026-10-25, 16:25 Phoenix)

## Phone can't connect (reported 14:46) — fixed in v8.6 (d28c99b)
- **Cause:** since v8.3 each browser makes its own game code, so opening the plain site URL on the phone put it alone at a new table.
- **Fix:** the welcome screen has a "Game code" box (prefilled). Typing the computer's code (shown in the lobby, kt-xxxxxx) seats you at that game at once. The Invite link / QR still work.
- Verified locally: test/phone_join.mjs (bare link → code → seated with the host) and test/phone.mjs (phone as hand) pass.
- Still true: joining after Start is refused (the phone can only watch). If the user still can't connect, check that first.
- Older browser tests (views, decks_ui, ux_fixes, table_strict, ui_stack, counters, looks) time out because of the changed menus; phone.mjs has been fixed, the rest still need updating.


## Card mechanics pass (v9.1, 2026-10-25 night) — NEXT: fresh-agent playtest in the morning
**Asked for (10 questions answered):**
- dev-mode test of every precon card on a full table;
- choices split into parts;
- pay-as-much pickers;
- a reveal window with if/then/or routing;
- moving counters;
- restrictions (Muldrotha) explained;
- phone-hand rows for cards playable from elsewhere;
- update the sheets.

The user will test with a fresh agent in the morning.

**Tools:**
- `node tools/cardplay.js [--deck N] [--card "Name"] [--verbose]` plays every precon card on a full table.
  - The table: the tester has lands, creatures, an artifact, an Aura, and cards in the graveyard and exile; the opponent has creatures, an artifact, an enchantment, a land, a planeswalker and graveyard cards; one combat is in progress.
  - Each ability is used with legal targets, and the result is compared with the table before.
  - It lists: by-hand, no-effect, no-target, not-offered, static?.
  - At the start: 221 of 1150 cards had something open. Now: 133 (91 by-hand clauses, 29 statics, 10 not-offered — mostly channel lands and class levels).
- `tools/cardcheck.js`: a quicker read-only check.

**Built:**
- **Activation costs** (`Cards.costPart` / `costPool`): return lands, untap or tap creatures, remove or put counters, exile from the graveyard, discard N, sacrifice N, life by colour identity. The UI asks for each choice; the server pays (`ab.extra`, `a.costs`). The AI skips abilities with costs it has to choose.
- **Hand abilities** (`Cards.handAbilities`, action `handAb`, `G.handAbility`): cycling, landcycling, typecycling, channel, "{N}, Discard this:".
- **"Your choice of …"**: op `choiceOf`. `Engine.hold` asks the controller (ask `pick`, button bar); the AI picks (`aiPick`).
- **Number picker** (`askCount`): X, multikicker and replicate, showing the most you can afford. `c.kicks`; replicate copies.
- **Reveal and route**:
  - Effects pre-pass `routeStart` / `routeBuild` → op `route` → todo `route` → `Cards.routePlan` → `routeModal` (quarter window) → `G.routeApply`.
  - "Mill N. You may put X from among them…" is a route too. The AI follows the routes.
- **Moving counters**: op `moveCounters`; the source target needs the counter (`flags.counter`).
- **Restrictions**: `Rulebook.why` explains used-up Muldrotha types; graveyard and exile cards get a hover title with the reason. "Target spell or nonland permanent" now targets permanents too.
- **Phone hand**: rows below the hand. The host computes `phoneElsewhere()`; the phone shows bright-green "Castable through X" or the keyword line (Flashback {4}{R}). Tap a card to cast or play it, or to use the ability (`playElsewhereFromPhone`, `activateFromPhone`, `phonePicks`).
- **Statics**:
  - can't be countered; trigger doubling (modern "entering" wording, Veyran, chosen type, Shaman/Wizard);
  - extra land types; any-colour mana; triple mana; granted quoted abilities; control Auras;
  - legend-rule exception; unpreventable combat damage; flying-only attacks; skip draw step; dredge;
  - cost reductions — "this costs {X} less" never matched before.
- **Parsing**:
  - flavour-named ability lines ("Eternity Gate — …") are read;
  - spell back-references ("that creature" after a target) apply to every spell;
  - "Search …, put it into your hand, shuffle".
- **New effects**: populate, goad, counter all other spells, a random graveyard card to hand, shuffle hand and graveyard, N target players each…
- **Tests:**
  - test/build4.test.js (unit);
  - test/mechanics_ui.mjs (dev-mode browser spot check: cycling, choice bar, X picker, reveal window, return-a-land cost, Muldrotha and the hover reason);
  - test/phone_elsewhere.mjs.

**Still open (from cardplay.js):**
- Channel-land and Class-level abilities in the "not offered" list are false alarms.
- ~90 one-off clauses: votes, piles, phasing, "when that creature dies this turn", divided damage, cast-from-among, Myriad-style copies…
- Statics: Hideaway, fabricate grant, ripple, demonstrate, "double all damage of the chosen type", "monarch controls enchanted creature".
- Searches with ", where X is …" before "Reveal those cards".
- The AI doesn't use cycling or channel, or the new choice costs (return lands, untap creatures).
- Game 1's open AI items, further down, are still open.

## Combat window (v9.0, 20:10)
- **Where:** `combatBar()` in ui.js now draws a centred panel, `.cpanel`, about a quarter of the screen.
- **Attacking:** the opponents are evenly spaced tabs across the top, with each one's own colour, life and attacker count. Planeswalkers and battles appear as chips below. All of your creatures are shown; clicking one sends it at the current tab, or moves it there from another tab. Creatures that can't attack are dimmed, with the reason.
- **Blocking:** each attacker gets a lane with an arrow pointing down at you. A chosen blocker moves into the slot in front of its attacker; several blockers overlap, more so the more there are (`--ov`). Your remaining creatures are shown underneath.
- **Confirming:** both attacks and blocks end with a confirmation summary (Back / Confirm). "▾ Hide" shrinks the window to a pill so you can look at the table.
- **Toasts:** they move to the top while the window is open.
- **Test:** test/combat_ui.mjs, with screenshots in test/shots/combat_*.png.

## Browser storage (v8.9, 19:50)
The user couldn't add players because the browser's storage was full.
- **Clean start:** opening a table code different from the last one (a new table, or joining someone else's) clears this browser's decks, AI players, saved games and pictures. Kept: name, player key, phone links and preferences (`KEEP` in game.js).
- **Compact storage:** `LS.set` / `LS.raw.set` keep each card's data and each sleeve or playmat picture once, in a shared catalogue `kt:cat`, and store `{ $r: key }` references in their place. `LS.get` puts the full objects back.
  - `LS.prune()` drops unused catalogue entries; it runs when a deck is deleted and when a save fails.
  - Measured with 3 decks, 2 AIs and a game: 432 KB → 195 KB. Each extra AI or saved game is now about 10 KB instead of about 100 KB.

## PLAYTEST LOOP (started 15:57) — continue here
The user asked for this loop:
1. A fresh agent plays ONE game as a human against the AI in the browser (local server). It uses the dev tools, the logs and the AI trace to check that every move is legal and every option that should be offered was offered.
2. I repair what it finds.
3. Repeat, one game at a time, until usage is at 95%.
4. Then hand off, deploy and tie up loose ends.

The agent prompt is in this session's history (the "Play one game as human vs AI" brief). Its reports go to /tmp/claude-0/playtest/GAME<n>.md; game 1's report is copied to docs/playtest/GAME1.md.

### Game 1: fixed in v8.8
- Anthems for "attacking creatures" were applying to every creature: `matchesWhat` now checks attacking, blocking, tapped and untapped.
- A pending player choice (todo) now holds the turn, for up to 90 s: `busy()` in engine.js. Previously discover appeared on the next player's turn.
- Double strike: the regular-step damage is assigned again, so trample now goes through.
- `selfRef` no longer turns "Beast" in Beast Within into "this". The one-word short name is only replaced when it's used as a name.
- Bello's static ability works: `Cards.staticAnim`. Matching noncreatures become 4/4 Elementals with indestructible and haste, during your turn only.
- **Mana:**
  - Pain lands deal 1 damage when they pay a colored pip. Payment results carry a `.pain` list, sent as the tap action's `pain`; pool units get a '!' marker.
  - "Spend this mana only to cast X spells" sources only pay for those spells: the 4th argument of `Cards.pay`.
  - Conditional mana lines ("Activate only if") are no longer counted.
- "Enters with N <any> counters" now covers shield, time and so on.
- "Remove a counter from this or another creature you control. If you do…" now really removes one, and pays out nothing if there's no counter to remove.
- A spell's "it" / "that creature" after a target means that target (Bridgeworks Battle's fight).
- The P/T badge shows the engine's P/T, including anthems.
- The basic-land search allows two copies of the same name.

### Game 1: still open (do these next)
1. **Bello's granted trigger** "Whenever this creature deals combat damage to a player, draw a card" isn't given to the animated permanents. Add it in the engine's trigger pool (engine.js ~line 115) for cards where `Cards.staticAnim(s, c)` is set.
2. **AI mistakes:**
   - Gitrog (hard) sacrificed its only black source. aibrain's land-sacrifice choice should keep colours the hand needs.
   - The AI tapped lands for a sorcery-speed spell while its own triggers were on the stack, and lost the mana. Check timing before tapping (aiexec).
   - The AI never uses Wayfarer's Bauble.
   - Under lethal flying pressure, the AI attacked instead of defending.
3. **Log:**
   - It keeps only 300 lines (rules.js:83). Keep more, or archive the overflow for the dev export.
   - The permission timeline only records while dev mode is on.
4. **Small:**
   - The log doubles names ("Angela Angela created") and says "a Angel token".
   - The commander menu says "commander tax" when the tax is 0.
   - The Monarch, Initiative and Day/Night chips do nothing for non-dev players: hide them, or make them work.
   - "Tap" is offered on non-mana permanents.
   - The RULES_SHEET wording for 103.8c is wrong.
5. **Fire-Lit Thicket-style filter lands** ({R/G}, {T}: Add …) only make {C}.

## Since 15:00 (v8.7)
- **Browser tests:** all repaired and passing (views, decks_ui, ux_fixes, table_strict, ui_stack, counters, looks, v6_ui, cardtrack, cmd2, phone_strict, prints, twophones, wronghand).
  - `KT.openDecks()` opens the deck window; tests use it instead of the removed Decks button.
  - Tests that use the 86-card mock deck set the house rule `deckSize: 0` before Start.
- **Free casts need a grant:** `Rulebook.freeGrant`. A free cast is allowed only for:
  - a pending cascade or freeCast todo;
  - a step left to finish by hand;
  - a 'free' way such as plot;
  - dev mode.
- **Plot timing:** plotted cards are cast at sorcery speed (`a.sorceryTiming`).
- **Pre-game permanents** (ctlT 0) are not summoning sick.
- **Spell lines:** a later line's "that creature" / "that spell" points at the earlier target (Dispatch, Stubborn Denial). "Counter that spell" works.
- **New conditions:** hand-size (hellbent) and "has no X counters".
- **New effects:** adapt, "untap that land", exchange control, lowest life total, "You put …".
- **Manual clauses:** 99 left (`node tools/manual_cov.js`). They are mostly one-off cards.
- **engine_sim** now answers the cmdrZone, punisher and payLife asks.
- **AI levels (54 games each):** hard 28–25 easy, hard 30–21 normal. Hard still wins, but the gap with easy looks smaller than before v8 (34–20). That may be noise; re-run before tuning.

## Since 11:05
- v8.5 is live (724f27b): house rules window, lobby name/join rows, deck window order, AI deck picker, mulligan in the hand bar, simpler menus, Split log on top 30%, tab order, myriad/Selvala fixes.
- The aibrain.js incomingNext multiplayer estimate was changed after v8.5. It's committed but not deployed.
- The 4-player AI sweep is clean: no errors or stalls. Games last about 40 turns (≈10 rounds), which is normal.

## Where things stand
- Live and test sites both run **v9.1** (see version.txt).
  - Live: starlit-conkies-c2facb.netlify.app (siteId 12ee5b76-1741-480c-8f66-9a4f87d4af69)
  - Test: joyful-rabanadas-f66e6c.netlify.app (siteId 5236eb56-b402-43c4-a92f-1aac62cc691d)
- The engine revision (docs/ENGINE_REVISION_PLAN.md) is built: stages 1–4 plus the follow-up mechanics.
  - v8.0: rulebook — permissions, green glow, mulligan gate, dev-only free moves.
  - v8.1: movement checkpoint — replacement effects, ghost tokens, commander choice, counter rules, suspend.
  - v8.2: library knowledge, reveal and pick window, cards known in hand.
  - v8.3: lobby with house rules, game codes, data wipe, board Log/Split tabs, slim dev bar (rewind, export).
  - v8.4: copy spells and abilities, emblems, Gearhulk, Arcane Bombardment, foretell and plot, AI suspend, energy paid by amount, airbend, Vraska's −2.

## What was in progress when we stopped
- **Testing pass (task: "Testing pass").** Not started yet. Run first:
  - `tools/sweep2.sh`: 4-player AI games over all 18 decks, three seeds, logs in /tmp/claude-0/sw2.
  - Then grep the logs for `refused`, `error`, `STUCK` and `manual`.
  - Then a browser play-through of the human flows with test/ui_*.mjs, plus a manual check of the lobby on a phone width.
- **Flaky test:** `test/ui_lib.mjs` "revealed to the table while choosing" once showed 2 of 3 (a timing race; it passes on rerun).

## UI tasks requested 2026-10-25 11:32 (do these with the testing pass)
1. **Lobby → pick a deck:** at the top of that window show the picked deck, its sleeve and its playmat. Put all the other deck options at the bottom, so there's no scrolling past them to select the deck or reach those settings.
2. **Add AI → deck:** show every available deck ready to click. Drop the "select ready-made decks" button.
3. **House rules:** make it its own window where the host can change every aspect of the game. Build it on the rulebook DEFAULTS table so each default rule can be edited. It must include:
   - number of commanders allowed
   - number of cards in a deck
   - whether players can play from the graveyard or other zones by default
   - lands per turn
   - starting life, commander damage, free mulligan
   - any other default worth changing — make it comprehensive.
4. **Join with a code:** make "join another game with an invite code" more prominent in the lobby.
5. **Keep or mulligan:**
   - Whenever the game asks a person to keep or mulligan, open the hand bar automatically (on phones too).
   - Move the keep/mulligan controls out of the way of the hand: put them in the hand bar itself, on the side where the Library / Draw buttons later appear.
6. **☰ menu and top bar:** keep only what's needed while a game is going.
   - Setup belongs in the lobby. Debug-only things belong in dev mode.
   - Nobody can add or remove an AI once the game has started, so remove those entries mid-game.
   - Re-evaluate every item in the menu.
7. **Change your name:** give it a clear, prominent place in the lobby. Remove it from the in-game menu.
8. **Split view:** the log takes the top 30% of the board area and the board the bottom 70% (stacked vertically, not side by side).
9. **Tabs:** order them "My board", then "Current turn", then the others.

## Known gaps / next work
- About 99 rarer card clauses are still handled "by hand" — run `node tools/manual_cov.js` to list them.
- Cascade/discover hits are checked only against a pending grant, not the exact card (the hit is private to the device).
- Rewind only restores public state.
- AI levels last measured (before v8): hard 34–20 easy, hard 34–18 normal. Re-measure with `tools/levels.sh hard easy`.

## How to work
- **Working copy:** /home/claude/mtg/site.
  - If the container was reset, rebuild it from this repo: copy `site/` to /home/claude/mtg/site and `test/` to /home/claude/mtg/test.
  - Tests expect `../site`, and a `data/forgecards.json` next to `test/`. That file is in this repo's `data/`.
- **Tests:**
  - Unit: `for f in test/*.test.js; do node $f; done`
  - Engine simulation: `node test/engine_sim.js`
  - AI games: `node test/ai_sim.js 6,3 hard,normal 40 7 2`
- **Browser tests** (test/ui_new, ui_rules, ui_lib, ui_lobby, ai_v2 `.mjs`) need two servers:
  - `python3 -m http.server 8090 --directory site`
  - `node test/mqttserver.js 9001` and `9002`
- **Commit:**
  - Copy every site file except version.txt into this repo's `site/`.
  - Regenerate the docs: `node test/rules_sheet.js > docs/RULES_SHEET.md` and `node tools/sheetmd.js > docs/AI_ENGINE_SHEET.md`.
  - Commit, then push to origin main.
- **Deploy (browser pane, tab "seed" on app.netlify.com, signed in):**
  1. Paste `tools/ktdeploy.js` into the page if `window.ktDeploy` is missing.
  2. Run `ktDeploy(sha, title)` for the test site, or add the live siteId as a third argument. Start it without awaiting if it takes more than 45 s.
  3. Check with `ktStatus(id)`.
  4. Netlify sometimes answers 429 (too many requests). Wait about a minute and retry.
  5. Never enter credentials.
