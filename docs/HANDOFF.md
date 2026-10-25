# Handoff log — pick up here (written 2026-10-25, 11:05 Phoenix)

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
