# Style

Caveman mode.

- Korean only unless asked otherwise.
- No filler.
- No greetings.
- No apologies unless necessary.
- Short answers.
- Core points only.
- Preserve code, commands, filenames, and paths exactly.

# Coding

- Do not rewrite whole files unless necessary.
- Make minimal safe changes.
- Do not delete assets unless asked.
- Do not invent filenames.
- Commit and push completed work unless user says not to.

# Agent Instructions

## User preferences
- Make minimal safe changes.
- Do not rewrite whole files unless necessary.
- Do not delete assets unless explicitly asked.
- Do not invent filenames.
- Preserve existing UI/behavior unless the task explicitly requires a change.
- Prefer small targeted patches.

## Reporting format
After every task, report:
1. changed files
2. exact changes
3. commands run
4. important warnings

## Development rules
- Inspect current files before editing.
- If requirements are ambiguous, make the safest reasonable assumption and mention it.
- If there are uncommitted changes, do not overwrite them.
- If a build/test fails, include the exact failure summary.
- Supabase SQL Editor migration SQL must avoid data loss by default: do not use `DROP TABLE`, `TRUNCATE`, or `DELETE` unless explicitly requested after risk confirmation.
- Supabase migration SQL should use `ALTER TABLE`, `CREATE POLICY`, `DROP POLICY IF EXISTS`, and `IF EXISTS` / `IF NOT EXISTS` for objects that may already exist.

# Request Handling

- Before implementing non-trivial requests, restate the request as a clean implementation prompt in Korean.
- Confirm the intended scope, affected screens, and whether logic/design docs need updates.
- Do not blindly agree with the user.
- Judge the request against `docs/logic-and-terminology.md` and `docs/design-system.md`.
- If the request conflicts with existing principles, say so and ask whether to change the principle or reject the change.
- If the request is safe and aligned with principles, proceed without excessive questioning.
- If the user is reporting a bug, first say what invariant appears broken.
- If the user proposes a UI idea, evaluate whether it improves clarity, reduces steps, and preserves responsive layout.
- If the user proposes a logic change, evaluate whether it breaks room phase, party, permission, MMR, or record rules.

# Project Rules

- Before changing room, match, party, invite, referee, record, report, MMR, team, tournament, or auth logic, check `docs/logic-and-terminology.md`.
- If logic changes, update `docs/logic-and-terminology.md` in the same commit.
- Before changing UI, CSS, responsive layout, light/dark theme, cards, buttons, slots, avatars, hover cards, modals, or page heroes, check `docs/design-system.md`.
- If design behavior changes, update `docs/design-system.md` in the same commit.
- Do not create separate menu-specific room modals. Matching and Matches must use the same room modal logic.
- Do not duplicate slot, phase, party, or permission calculations in page components. Use central helpers first.
- If demo data changes, keep it compatible with real creation flow.

# Verification

- Build success alone is not enough for room or UI changes.
- For flow changes, test at least host, party leader, regular player, reserve player, referee/no-referee paths.
- For UI changes, check desktop, mobile, dark mode, and light mode.
