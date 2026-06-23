# RankBall Handoff

## 1. Project Overview

RankBall is a basketball matchmaking, team, ranking, recording, and referee workflow web app.

Main stack:
- Vite
- React
- CSS modules are not used; most UI styling is centralized in `src/styles/globals.css` plus feature CSS files.
- Supabase is configured for auth/data, but the app still uses a mixed mockData/localStorage/Supabase structure for development.
- React Router routes are under `/app`.

Important product goals:
- Build a game-like basketball web app, closer to stat dashboard plus arena-style room UI.
- Public/private match rooms should feel like one unified room system, not separate menu-specific implementations.
- Responsive layout must work on desktop and mobile.
- Light and dark themes must both be usable.
- Cards, buttons, list rows, room slots, hover cards, and modals should follow shared visual rules.
- Do not overcomplicate user actions. The app should reduce unnecessary access points and repeated confirmations.

Important UI direction:
- Match and recruiting room cards should use the same visual language.
- Content cards should be flat surfaces.
- Gradients are allowed only for hero/tier/image presentation areas, not ordinary content boxes.
- Tier should usually be shown with an emblem, not repeated text badges.
- Hover cards should show one clear large emblem, not duplicate emblems.

## 2. Current Task

The latest task was to clean up visual inconsistency and wasted space outside the match/recruiting room flows.

Requested fixes:
- Find popup cards where tier emblems appeared twice and reduce them to one larger emblem.
- Remove borders around emblem-only displays inside hover cards.
- Fix Home boxes/buttons that violated the current CSS standard.
- Fix spacing and alignment issues in Team cards.
- Fix Settings desktop layout where one column was much taller and space was wasted.
- Reduce excessive card spacing across non-match menus.
- Recheck repeatedly until overflow and obvious layout breaks were gone.

Why:
- UI had become inconsistent after many iterative changes.
- Some cards had gradients while others used flat surfaces.
- Team cards had uneven rows and emblem sizing problems.
- Settings desktop layout had the right column much taller than the left.
- Popup tier cards duplicated emblem visuals.

Current status:
- Done for the scoped UI cleanup.
- Committed and pushed in `6c98bbb Polish dense card surfaces`.
- No known uncommitted changes before creating this handoff.

## 3. Files Changed

### `docs/design-system.md`

What changed:
- Added a `2026-06-23 dense surface pass` section.
- Documented hover popup tier rules, flat content surface rules, Settings compact layout rules, and Team card row/emblem rules.

Why:
- Project instructions require design behavior changes to update the design system.
- Future agents need a clear standard to avoid reintroducing duplicate badges or gradients.

Risky parts:
- None functionally.
- File line endings may show CRLF warnings on Windows.

### `src/components/profile/PlayerHoverCard.jsx`

What changed:
- Removed `TierBadge` from the hover tier grid.
- Added `getTierDivision`.
- Player tier rows now show `TierEmblem` plus text label only.
- Active team section now uses one small `TierEmblem` plus text label.

Why:
- Screenshot showed duplicated emblems inside popup cards.
- Hover card standard is one emblem plus one readable label.

Risky parts:
- Only display output changed.
- Hover/touch/link logic was intentionally not changed.

### `src/components/team/TeamHoverCard.jsx`

What changed:
- Removed `TierBadge`.
- Added `getTierDivision`.
- Team hover card now shows one larger `TierEmblem` and a text tier label.

Why:
- Same duplicate-emblem problem existed in team hover cards.

Risky parts:
- Only display output changed.
- Hover/touch/link logic was intentionally not changed.

### `src/pages/Settings.jsx`

What changed:
- Moved the block-player card from the right column to the left column.
- Did not remove any Settings feature.

Why:
- Settings desktop layout had one column much taller than the other.
- Moving the small block-player card balanced the columns.

Risky parts:
- Low risk.
- It changes visual order of Settings sections only.

### `src/styles/globals.css`

What changed:
- Added dense surface cleanup rules for:
  - hover cards
  - player/team hover tier grids
  - Home side cards
  - Team cards
  - Settings cards
  - generic `match-card`
  - light theme equivalents
- Removed gradients from standard content cards.
- Enlarged hover-card emblems without wrapping them in extra bordered pills.
- Made Team card member rows consistent height.
- Made Team card emblem sizing stable on desktop/mobile.
- Made Settings columns compact.
- Made Settings address results and report participant lists internally scroll instead of stretching the entire card.

Why:
- Needed one consistent card surface rule.
- Needed to reduce wasted space and fix alignment.
- Needed to prevent overflow on desktop and mobile.

Risky parts:
- This file has many existing overlapping rules.
- New rules were appended near the end to win cascade safely.
- Future cleanup should consolidate duplicated CSS carefully, not rewrite the whole file.

## 4. Important Decisions

Design decisions:
- Ordinary content cards use flat surfaces, not gradients.
- Gradients remain reserved for hero/tier/image presentation.
- Hover popup tier display must be `TierEmblem` plus text label, not `TierBadge compact`.
- Team cards show one team tier emblem on the right.
- Settings long helper lists should scroll inside the card instead of pushing the whole page height.

Architecture decisions:
- No room logic was changed.
- No match/recruiting state logic was changed.
- No new component abstraction was introduced.
- CSS was adjusted conservatively because existing styles are centralized and overlapping.

State/data-flow decisions:
- No state shape changed.
- No mock data changed.
- No Supabase schema changed.
- No localStorage/repository behavior changed.

Things intentionally avoided:
- Did not rewrite `globals.css`.
- Did not delete assets.
- Did not change room phase, party, invite, referee, record, MMR, tournament, team, or auth logic.
- Did not create separate menu-specific room modal logic.
- Did not touch Match/Recruiting room logic because the current request was visual cleanup outside those flows.

## 5. Current Repo State

Known repo state before this handoff:
- Last pushed commit: `6c98bbb Polish dense card surfaces`
- `git status --short` was clean before adding `HANDOFF.md`.

Files that should not be overwritten casually:
- `docs/logic-and-terminology.md`
- `docs/design-system.md`
- `src/styles/globals.css`
- `src/pages/Recruiting.jsx`
- `src/pages/Matches.jsx`
- room modal / slot / party helpers
- existing assets under `public/assets`

Generated files/assets:
- `dist/` exists from build output.
- `node_modules/` exists.
- Do not delete existing image assets unless the user explicitly asks.
- Do not recreate or rename assets unless necessary.

## 6. Known Issues / Bugs

Existing known issues:
- Vite build still warns that the main JS chunk is larger than 500 kB.
- `src/styles/globals.css` has many overlapping legacy CSS rules. It works, but is hard to reason about.
- Some terminal output may show mojibake for Korean text, but source files are UTF-8 and browser text renders normally.
- Match/recruiting room logic has historically been fragile. Do not modify it without checking `docs/logic-and-terminology.md`.
- Settings page still has long forms. The latest pass reduced the worst imbalance but did not redesign Settings.

Suspected causes:
- Styling drift came from appending menu-specific CSS instead of a single card surface system.
- Duplicate hover emblems came from combining `TierEmblem` and `TierBadge compact`.
- Settings imbalance came from stacking several large forms in one column.

Things not yet verified:
- Full manual screenshot pass after the final Settings compact adjustment.
- All light-mode visual details across every page.
- Production deployment rendering after Vercel build.
- Chunk splitting or bundle-size optimization.

## 7. Commands Run

Commands already run:

```powershell
git status --short
git log -5 --oneline
Get-ChildItem -Name
rg -n "TierBadge|hover-tier-label|team-card|settings-page|home-side-stack|match-card" src docs/design-system.md
Get-Content -Path src\pages\Settings.jsx -TotalCount 520
Get-Content -Path src\pages\Settings.jsx -TotalCount 980 | Select-Object -Skip 520
git diff -- src\components\profile\PlayerHoverCard.jsx src\components\team\TeamHoverCard.jsx src\pages\Settings.jsx src\styles\globals.css docs\design-system.md
git diff --check
git diff --stat
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\vite\bin\vite.js build
git add docs/design-system.md src/components/profile/PlayerHoverCard.jsx src/components/team/TeamHoverCard.jsx src/pages/Settings.jsx src/styles/globals.css
git commit -m "Polish dense card surfaces"
git push origin main
```

Browser checks run through the in-app browser:
- Desktop Home, Teams, Settings DOM metrics.
- Mobile Home, Teams, Settings DOM metrics with viewport `390x844`.
- Verified:
  - horizontal overflow `0`
  - standard-card gradient count `0`
  - Team card row heights `44px`
  - Team card emblem width `78px` desktop, `70px` mobile
  - Settings columns after final compact pass about `1682px / 1705px`

Build result:
- Build succeeded.

Existing build warning:

```text
(!) Some chunks are larger than 500 kB after minification.
```

Failures encountered:
- `npm run build` failed earlier because `npm` was not available in PATH.
- A `pnpm run build` attempt triggered package-manager side effects and failed on esbuild ignored builds. Generated `pnpm-lock.yaml` and `pnpm-workspace.yaml` were removed. Final build was run directly with the bundled Node runtime and Vite.
- A combined PowerShell command using `&&` failed because this shell version did not accept `&&` as a statement separator. Commands were rerun separately.

## 8. How To Continue

Recommended next steps:
1. Run `git status --short` before editing.
2. If changing UI/CSS, read `docs/design-system.md` first.
3. If changing room, match, party, invite, referee, record, MMR, team, tournament, or auth logic, read `docs/logic-and-terminology.md` first.
4. Inspect current components before editing. Do not rely only on this handoff.
5. For visual work, prefer a small CSS patch and verify:
   - desktop
   - mobile
   - dark theme
   - light theme
6. For room logic, verify at least:
   - host
   - party leader
   - regular player
   - reserve player
   - referee/no-referee paths
7. Keep changes scoped. Avoid broad refactors unless the user explicitly asks.
8. Commit and push completed work unless the user says not to.

Recommended order for likely next cleanup:
1. Manual screenshot check Home/Teams/Settings in dark mode.
2. Manual screenshot check Home/Teams/Settings in light mode.
3. If remaining visual drift exists, add small end-of-file CSS overrides.
4. Only after UI is stable, consider backend/Supabase migration planning.

## 9. Guardrails

- Do not rewrite whole files unless necessary.
- Do not delete assets.
- Do not change unrelated UI.
- Preserve existing behavior unless explicitly requested.
- Before editing, inspect current files.
- Use `apply_patch` for manual file edits.
- Do not create separate menu-specific room modals.
- Do not duplicate slot, phase, party, or permission calculations in page components.
- If logic changes, update `docs/logic-and-terminology.md` in the same commit.
- If design behavior changes, update `docs/design-system.md` in the same commit.
- If demo data changes, keep it compatible with the real creation flow.
- After editing, report changed files, exact changes, commands run, and warnings.
