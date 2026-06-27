# RankBall HANDOFF

Updated: 2026-06-27

## 1. New Thread Start Order

Read first:
1. `AGENTS.md`
2. `HANDOFF.md`
3. `docs/logic-and-terminology.md`
4. `docs/design-system.md`
5. current files before editing

Important rule:
- Trust actual files over this handoff if they conflict.
- Do not overwrite uncommitted user work.
- Do not delete assets.
- Commit and push completed work unless user says not.

## 2. Current Repo State

Latest pushed commit:
- `8ac175f6 Fix mobile invite search panel`

Recent relevant commits:
- `8ac175f6 Fix mobile invite search panel`
- `7129c297 Fix invite popover and match list load`
- `57c236b6 Split frontend chunks`
- `fe8ec51 Fix light assets and local queue filter`
- `7f4610f Fix scoped state ordering`
- `b0554df Scope remote state reads`
- `a82c6a3 Fix remote season column select`
- `b6b49cf Fix remote affiliation column select`
- `795c91d Reduce Supabase state payload size`
- `95b5e6a Improve backend simulation diagnostics`
- `1eba2f9 Stabilize backend match simulation`
- `929296e Avoid local asset URLs in base CSS`
- `46ae9bc Support remote asset base URL`
- `7931742 Seed backend simulation test actors`
- `9b169f7 Extend backend simulation for referee flow`

Known current `git status --short`:
- `?? pnpm-lock.yaml`
- `?? pnpm-workspace.yaml`

These two files are untracked and were not touched in the last fixes. Do not stage them unless the user explicitly asks.

## 3. What Was Just Fixed

### Empty recruiting list

Symptom:
- User said match/recruiting list showed nothing.

Finding:
- `/api/state/load` production response was not empty.
- Example with `test-token-rankball-010`:
  - `matches: 200`
  - `recruitingPosts: 65`
  - `openPosts: 58`
- Actual bug was local filter.
- User region was `서울특별시 마포구`.
- Old queue room region values were like `마포`.
- Old comparison used exact `post.region === app.currentUser.region`, so local queue count became `0`.

Fix:
- `src/pages/Recruiting.jsx`
- Added region normalization:
  - `서울특별시 마포구`
  - `마포구`
  - `마포`
  are treated as the same local district.

Verified:
- Production data for `u10`:
  - exact local count: `0`
  - normalized local count: `12`

### Light mode background image missing

Symptom:
- User said background image did not show, emblem still showed, especially in light mode.

Finding:
- `src/lib/assets.js` injected CSS as `[data-theme="light"]`.
- `src/styles/tokens.css` defined `html[data-theme="light"]`.
- `html[data-theme="light"]` has higher specificity, so `--bg-court: none` won.

Fix:
- `src/lib/assets.js`
- Changed injected selector:
  - `[data-theme="light"]`
  - to `html[data-theme="light"]`

Verified:
- Production bundle contains:
  - `rankball-remote-assets`
  - `html[data-theme`
  - `rankball-court-hero-day.webp`
  - `regionDistrict`

## 4. Current Architecture

### Vercel API

Hobby plan serverless function limit was hit earlier.

Current shape:
- Only one Vercel function exists:
  - `api/index.js`
- `vercel.json` rewrites:
  - `/api/:path*` to `/api?path=:path*`
  - SPA fallback after API rewrite

Do not add many files directly under `api/`.
New API routes should go under `server/api/**` and be routed through `api/index.js`.

### Server API files

Important routes:
- `server/api/state/load.js`
- `server/api/matches/sync-match.js`
- `server/api/recruiting/sync-post.js`
- `server/api/tournaments/sync-tournament.js`
- `server/api/teams/sync-team.js`
- `server/api/profile/upsert.js`
- `server/api/admin/review-action.js`
- `server/api/admin/appointment-action.js`
- `server/api/admin/disciplinary-action.js`
- `server/api/discord/dm-worker.js`
- `server/api/discord/interactions.js`
- `server/api/discord/sync-deliveries.js`
- `server/api/courts/address-search.js`
- `server/api/court-requests/submit.js`
- `server/api/court-requests/approve.js`
- `server/api/reports/submit.js`

### Frontend state

Important files:
- `src/hooks/useAppData.js`
- `src/data/repository.js`
- `src/lib/mockData.js`

Current state:
- Supabase is active.
- Server actions exist.
- `useAppData.js` still has optimistic frontend reducer logic.
- `repository.js` still imports `initialState` from `src/lib/mockData.js`.
- This is not fully DB-authoritative yet.

Do not claim mock/localStorage/demo dependency is completely gone.

## 5. Supabase/PostREST Egress Work

Problem:
- Supabase Free egress was rising.
- User confirmed most was PostREST egress.

Main cause found:
- Full state loads were too broad.
- Earlier code fetched too much data through PostREST.

Already done:
- Removed broad `select("*")` usage in current searched source paths.
- Added explicit column selects in `src/data/repository.js`.
- Scoped user-only data:
  - `favorites`
  - `notifications`
  - `discord_notification_deliveries`
- Scoped client-state private profile reads:
  - `/api/state/load` still returns public profile rows needed by screens.
  - Supabase `profiles` private columns are fetched only for the current auth/test profile in client-state mode.
- Limited client state load:
  - matches: `200`
  - recruiting posts: `160`
  - tournaments: `80`
- Added optional `/api/state/load` pagination inputs:
  - `matchLimit`, `matchUpdatedBefore`
  - `recruitingLimit`, `recruitingUpdatedBefore`
  - `tournamentLimit`, `tournamentUpdatedBefore`
  - nested `pagination.matches/recruiting/tournaments` aliases also work.
- Child tables are now fetched only for loaded parent IDs where possible:
  - match children by loaded match IDs
  - recruiting applications by loaded post IDs
  - tournament teams by loaded tournament IDs
- Server action load uses operation scope where possible:
  - match operation loads target match scope
  - recruiting operation loads target post scope
  - tournament operation loads target tournament scope
- Added `user_room_feed` DB-maintained index:
  - recruiting `region_public`, `owner`, `participant`, `invited`, `referee`
  - match `owner`, `participant`, `referee`
  - trigger refresh uses soft `is_active=false`, no table/data deletion
- `/api/recruiting/list` reads local region public ids from `user_room_feed` first and returns feed-based room-scope counts.
- `/api/matches/list` reads current-profile match ids from `user_room_feed` first.
- `/app/recruiting` no longer does first-load `includeMine`; `내가 만든 방`/`내 참여방`/`초대받음` load only on user click.
- `/app/recruiting` removed the default `전체 지역` toggle. First list is local region; later region/district picker should be explicit.
- `/app/matches` no longer runs idle `scope=mine` recruiting background load.
- `approveMatch` still uses `{ clientState: true }` because rating/MMR repeat factor still needs recent match history.
- Ordering fixed:
  - recent `matches`, `recruiting_posts`, `tournaments` load by `updated_at`
  - `nullsFirst: false`

Important warning:
- This reduced egress, but did not finish the egress project.
- `profiles`, `teams`, `team_members`, `courts`, and settings-related tables can still be broad.
- `user_room_feed` SQL must be applied in Supabase before production uses the feed path. Until then API falls back to older RPC/PostREST reads.
- Next step is moving more action reducers into SQL and making list-card payloads thinner.

## 6. Backend Simulation

Script:
- `scripts/simulate-backend-flow.mjs`

Production command:

```powershell
$env:RANKBALL_SIM_TIMEOUT_MS='45000'
C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\scripts\simulate-backend-flow.mjs --base-url=https://platunumball.vercel.app
```

Last known pass:
- basic 1v1 no-referee flow
- referee 1v1 flow
- both reached `confirmed`
- cleanup succeeded

Known limitation:
- Simulation currently covers only basic 1v1 no-referee and referee 1v1.
- It does not yet cover:
  - 3v3
  - 5v5
  - team party join
  - invite/accept expiry
  - reserve auto-promotion
  - referee no-show
  - recorder handoff
  - dispute draft to commit
  - tournament bracket

## 7. Discord / Cron

Current state:
- Discord OAuth/DM pieces exist.
- `server/api/discord/dm-worker.js` exists.
- `CRON_SECRET` is used to protect worker calls.
- cron-job.org test returned:
  - `200 OK`
  - `{"ok":true,"processed":0,"sent":0,"failed":0}`
- Test DM by Discord username worked after bot invite/token setup.

Important:
- Do not print or commit secrets.
- Do not put secret keys in `VITE_*`.
- `VITE_*` values are public browser values.

Remaining Discord work:
- invite accept/decline button interaction hardening
- Discord chat to web chat sync
- web chat to Discord sync
- scheduled match reminder creation from match lifecycle
- cancel/void should cancel pending reminders
- if match starts early, start-time reminder should not be sent
- if result moves to dispute/approval early, stale reminder should not be sent

## 8. Asset / R2 State

Current state:
- `src/lib/assets.js` supports:
  - `VITE_ASSET_BASE_URL`
  - `VITE_PUBLIC_ASSET_BASE_URL`
- Local fallback path is `/assets/...`.
- Base CSS no longer hardcodes image URLs directly.
- `src/lib/assets.js` injects `--bg-*` variables.

Required env:
- `VITE_ASSET_BASE_URL=https://your-r2-public-domain`

Important:
- R2 public URL must contain files under matching paths:
  - `/assets/main.webp`
  - `/assets/main-day.webp`
  - `/assets/rankball-court-hero.webp`
  - `/assets/rankball-court-hero-day.webp`
  - `/assets/rankball-ball-night.webp`
  - `/assets/rankball-ball-day.webp`
  - `/assets/rankball-hoop-night.webp`
  - `/assets/rankball-hoop-day.webp`
  - `/assets/rankball-profile-night.webp`
  - `/assets/rankball-action-day.webp`

If backgrounds disappear again:
1. Check Vercel `VITE_ASSET_BASE_URL`.
2. Check R2 path includes `/assets/...`.
3. Check DevTools Network image response code.
4. Check injected style tag id `rankball-remote-assets`.

## 9. Naver Address Search

Current state:
- Naver address API frontend/server connection exists.
- User reported it worked in production domain but not preview.
- Naver app domain config matters.

Important:
- Naver wildcard like `https://*.vercel.app` may not behave like expected for all preview URLs.
- Production domain should be added exactly.
- Local dev URLs should be added separately if needed:
  - `http://localhost:5173`
  - `http://127.0.0.1:5173`

Do not switch to Kakao unless user asks again.

## 10. Auth / Profile State

Current direction:
- Google account should map to one RankBall profile.
- `profiles.auth_user_id` should be populated for real Google users.
- Test accounts use `test_login_id`.
- Hashtag should start with `#`, not `@`.
- Hashtag is locked after initial setup.
- Birth year is locked after initial setup.
- Nickname can change but should be limited.

Known issues to keep checking:
- User saw signup/profile setup appearing repeatedly.
- User found real profile row with `auth_user_id` set and test row with `auth_user_id: null`.
- Need verify hydration gate does not redirect to `/app/signup` before remote profile load completes.
- Need verify all test handles use `#`.
- Need cleanup plan for old `@` handles if any remain.

Important file:
- `src/lib/profileSetup.js`
- `src/pages/Signup.jsx`
- `src/hooks/useAuthSession.js`
- `src/hooks/useAppData.js`
- `server/api/profile/upsert.js`

## 11. High Priority Remaining Work

### A. Fully DB-authoritative transactions

Current:
- Server actions exist.
- They still use normalized state and snapshot-style persistence in places.

Need:
- Recruiting DB RPC transactions:
  - create
  - join
  - invite
  - accept/decline
  - ready
  - confirm
  - close
- Match DB RPC transactions:
  - attendance
  - start
  - end
  - result submit
  - dispute draft
  - dispute resolve
  - approve
  - MMR/rating commit
- Team membership DB RPC:
  - create/update/delete team
  - member update
  - captain permissions
- Tournament DB RPC:
  - bracket generation
  - team approval
  - schedule changes
- Eligibility server validation:
  - roster
  - age group
  - referee eligibility
  - team-only room restrictions
  - division rules

### B. Frontend thin caller

Current:
- `useAppData.js` still runs frontend reducers and optimistic mutations.

Need:
- Production path should trust server result.
- Frontend should become a thin caller for server actions.
- Avoid local fallback as source of truth in Supabase mode.
- Keep optimistic UI only if rollback is clean and server result replaces it.

### C. Screen-specific state endpoints

Current:
- `/api/profile/me`, `/api/recruiting/list`, `/api/matches/list`, `/api/matches/detail`, and recorder-specific match reads exist.
- `/api/state/load` still exists for broad fallback/older routes.
- Recruiting/match list endpoints now have feed-first paths but still load row details through PostREST after ids are chosen.

Need:
- Split into endpoints/RPC like:
  - `/api/recruiting/detail`
  - `/api/teams/list`
  - `/api/teams/detail`
  - `/api/settings/context`
  - `/api/admin/context`
- Add pagination/cursors.
- Do not load all profiles for every screen.
- Do not load all child tables for list screens.

### D. More simulations

Need scenarios:
- 3v3 party
- 5v5 party
- public room with team party
- private team room
- individual room where team party is blocked/allowed correctly by rules
- invite before slots fill
- invite expires if slots/reserves full
- reserve auto-promotion
- referee eligible join
- referee ineligible blocked
- private referee invite
- referee no-show accepted by other side leader
- recorder handoff
- dispute draft to approval/commit
- cancelled match reminders removed
- tournament bracket generation

### E. Court / report / moderation

Need:
- approved court hidden/disabled server action fully wired
- court review hide/delete admin action
- false court report trust penalty transaction
- court registration trust threshold enforced server-side
- reporter feedback notification
- malicious reporter penalty
- regional admin scope checks

### F. Discord

Need:
- invite button interaction robustly mapped to current profile
- Discord user ID uniqueness across RankBall profiles
- DM queue scheduled events from match lifecycle
- chat sync, later

### G. Bundle size

Current:
- Last direct Vite build split chunks below the `500KB` warning threshold.

Need later:
- keep heavy routes lazy-loaded.
- split CSS later if first paint still feels heavy.

## 12. Current Warnings

- `pnpm-lock.yaml` and `pnpm-workspace.yaml` are untracked.
- Do not stage those unless intentionally switching package manager.
- `docs/logic-and-terminology.md` may show mojibake in PowerShell output, but browser/source can still be OK.
- Direct Vite build succeeds with chunk split.
- Supabase egress is reduced, not solved.
- Match list shows only user-related schedule by design; public browsing is in Recruiting/Matching list.
- If user says "경기 목록이 비었다", first check whether they mean:
  - `/app/matches` my schedule
  - `/app/recruiting` public matching queue
  - a selected filter/date/history state

## 13. Useful Commands

Status:

```powershell
git status --short
git log -8 --oneline
```

Build:

```powershell
C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\node_modules\vite\bin\vite.js build
```

Production state count check:

```powershell
@'
const response = await fetch('https://platunumball.vercel.app/api/state/load', {
  method: 'POST',
  headers: { authorization: 'Bearer test-token-rankball-010', 'content-type': 'application/json' },
  body: JSON.stringify({})
});
const json = await response.json();
const state = json.state ?? {};
console.log({
  currentUserId: state.currentUserId,
  users: state.users?.length,
  matches: state.matches?.length,
  recruitingPosts: state.recruitingPosts?.length,
  tournaments: state.tournaments?.length,
});
'@ | C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --input-type=module -
```

Production backend simulation:

```powershell
$env:RANKBALL_SIM_TIMEOUT_MS='45000'
C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\scripts\simulate-backend-flow.mjs --base-url=https://platunumball.vercel.app
```

Search wide Supabase payload patterns:

```powershell
rg -n 'select\("\*"\)|select\(''\*''\)|profiles\(\*\)|courts\(\*\)|match_players\(\*\)|reports\(\*\)|reviews\(\*\)|player_match_stats\(\*\)' .\src .\server .\api .\scripts
```

## 14. Suggested Next Thread Prompt

Paste this into the next thread:

```text
Continue from this repository: C:\Users\user\Documents\rankball

First read:
- AGENTS.md
- HANDOFF.md
- docs/logic-and-terminology.md
- docs/design-system.md
- relevant source files before editing

Current priority:
Keep reducing Supabase PostREST egress and continue backend migration, but do not break the feed-based recruiting/match list, recruiting local filter, and light-mode background.

Known latest fixes:
- user_room_feed feed-first recruiting/match list work is in current repo state. Check latest git log for exact commit after this handoff.
- 8ac175f6 fixed mobile invite search panel.
- 7129c297 fixed invite popover and match list load.
- 57c236b6 split frontend chunks.
- fe8ec51 fixed light background selector and local recruiting queue region matching.
- 7f4610f fixed scoped state ordering.
- b0554df scoped remote state reads.

Rules:
- Korean only.
- Minimal safe changes.
- Do not rewrite whole files unless necessary.
- Do not delete assets.
- Do not stage pnpm-lock.yaml or pnpm-workspace.yaml unless I explicitly ask.
- Do not create many files under api/. Vercel Hobby limit means use api/index.js and server/api routes.
- If changing room/match/referee/record/team/tournament/auth logic, check docs/logic-and-terminology.md first and update it if logic changes.
- If changing UI/CSS/theme/layout, check docs/design-system.md first and update it if design behavior changes.
- After editing, report changed files, exact changes, commands run, test/build result, warnings.

Start by running:
- git status --short
- git log -8 --oneline
- production state count check from HANDOFF.md

Then continue the highest priority backend work:
1. apply/verify user_room_feed SQL in Supabase if not already applied
2. recruiting/match SQL reducer migration for action stability and lower read calls
3. make list-card payloads thinner, especially related users/teams
4. frontend useAppData thin caller cleanup
5. expand backend simulation scenarios
```
