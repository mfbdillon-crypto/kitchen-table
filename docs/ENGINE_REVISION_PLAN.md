# Engine revision plan (agreed with Marissa, 2026-10-25)

Goal: a structured engine in which any card can go anywhere, carry any counter, and any token can exist; the engine
does everything the rules require by itself, and tracks what each player can't do (defaults) and which cards let them
break or tighten those rules. All tracking is silent (visible only in dev mode). Simplify where it helps.

## Rulebook (permissions)
- Three lists: shared DEFAULTS (casting/playing, combat, abilities/resources, zones/movement); per player CAN grants
  from cards (Flashback, Muldrotha, Bolas's Citadel…); per player CAN'T restrictions from cards (Grafdigger's Cage…).
- "Can't" beats "can" (101.2).
- Cards are read by text patterns/keywords (one tunable table), never per-card entries. Must be complete enough that
  AI seats never need a human; no prompts to players about permissions.
- Disallowed actions are not offered at all.
- Dev mode: add/remove permissions by hand; full sheet view; generated doc docs/RULES_SHEET.md.

## Movement, tokens, counters
- One movement checkpoint with a full replacement layer (616): Rest in Peace, Leyline of the Void, commander → command
  zone (human owner is asked; AI decides).
- Tokens leaving the battlefield appear briefly in the new zone (triggers see them), then cease to exist (704.5d).
- Any counter on any card/player; small labelled badges. Counter rules automatic: +1/+1 vs −1/−1, shield, stun,
  lore/Sagas, time/suspend, finality.
- Effect the engine can't fully do: do what it can, keep going, add to the unread report.

## Libraries and knowledge
- Hidden cards stay on each owner's device. Library order fixed at game start and at every shuffle.
- Click the library: every known card (top and bottom) incl. scry/surveil results. Reveals visible to all; "pick X"
  window from revealed cards. Shuffle wipes library knowledge. Revealed cards stay known per opponent while in hand.
- AI must not act until every player has kept their opening hand.

## Screens
- Green glow on any card outside the hand that is usable right now (timing, mana, targets); no glow for plain mana
  sources; no red glow outside the hand.
- Choices always shown as a bar of card pictures (even a single choice).
- Every board: tabs Board / Log / Split (70/30); that player's actions. Table log logs all movement and actions;
  permission changes only in dev mode.
- Simplify the player menu (duplicate AI-log / add-AI entries).
- Lobby: centred panel ~1/4 of the screen: house rules (common toggles), add AIs, invites, Start. No joins after
  start. Auto game code saved in each browser to return; prefilled. Old game data wiped on new game / joining another.
- Disconnected human: seat waits for the same player.

## AI
- All levels use their own permissions; normal/hard read opponents' sheets (graveyard hate, avoid locks).

## Dev mode (host only, unobtrusive)
- Hand moves; permission editor; "Why not?" per card; permission timeline; AI decision trace; unread-text report with
  copy; rewind last ~20 actions; live game-log export.

## Rollout
- Large stages, each deployed (test site, then live) as it passes tests, without waiting.
  1. Rulebook core + permission reading + cast/play from any zone + green glow + AI waits for mulligans.
  2. Movement checkpoint / replacement layer, tokens, counters.
  3. Library order + knowledge + reveal/pick bar + choice bar.
  4. Lobby, game codes, data wipe, board log tabs, menu cleanup, dev tools, rewind.

## Status
- v8.0 stage 1 (rulebook), v8.1 stage 2 (movement checkpoint), v8.2 stage 3 (library knowledge), v8.3 stage 4 (lobby, logs, dev tools) — all live.
- v8.4: foretell, plot, AI suspend, copying spells and abilities, emblems, Combustible Gearhulk, Arcane Bombardment, airbend, Vraska's Treasure, energy by amount.
- Known follow-ups:
  per-opponent knowledge of library tops; rewinding hidden zones; ~110 rarer card clauses (see test coverage).
