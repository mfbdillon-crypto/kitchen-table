# Handoff log — pick up here (updated 2026-10-25, 14:47 Phoenix)

## Phone can't connect (reported 14:46) — fixed in v8.6 (d28c99b)
- **Cause:** since v8.3 each browser makes its own game code, so opening the plain site URL on the phone put it alone at a new table.
- **Fix:** the welcome screen has a "Game code" box (prefilled). Typing the computer's code (shown in the lobby, kt-xxxxxx) seats you at that game at once. The Invite link / QR still work.
- Verified locally: test/phone_join.mjs (bare link → code → seated with the host) and test/phone.mjs (phone as hand) pass.
- Still true: joining after Start is refused (the phone can only watch). If the user still can't connect, check that first.
- Older browser tests (views, decks_ui, ux_fixes, table_strict, ui_stack, counters, looks) time out because of the changed menus; phone.mjs has been fixed, the rest still need updating.

## Since 11:05
- v8.5 is live (724f27b): house rules window, lobby name/join rows, deck window order, AI deck picker, mulligan in the hand bar, simpler menus, Split log on top 30%, tab order, myriad/Selvala fixes.
- The aibrain.js incomingNext multiplayer estimate was changed after v8.5. It's committed but not deployed.
- The 4-player AI sweep is clean: no errors or stalls. Games last about 40 turns (≈10 rounds), which is normal.

## Where things stand
- Live and test sites both run **v8.4 (commit 9bd3d19)**.
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
- About 110 rarer card clauses are still handled "by hand" — run `node tools/manual_cov.js` to list them.
- The cast permission check trusts `alt: 'free'` from devices: an effect-driven cast skips the permission check. Tighten this with a pending-grant list.
- Plotted cards can be cast at instant speed (they should be sorcery-speed).
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
