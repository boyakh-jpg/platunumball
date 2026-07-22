# RankBall HANDOFF

Updated: 2026-07-13

## 0. Current Status Override

- Core recruiting, match, tournament reducers are operation-only authoritative DB RPCs.
- Frontend production mutations are thin server calls. Local reducers are non-Supabase demo-only.
- Discord invite interactions, reminders, stale cleanup, and web/Discord room chat sync are implemented.
- The long-running Discord Gateway worker now handles heartbeat ACK, session resume, and bounded HTTP retry.
- Remaining external setup: real Discord Bot token, bridge secret, room channel/thread links, and an always-on worker host.
- Court hard delete/restore stays deferred until retention policy is decided.
- Sections below are historical context. Do not treat their old backlog or `test-token` examples as current instructions.

## 0.1 2026-07-02 Thread Transfer Summary

This was the latest handoff on 2026-07-02. It is retained for historical context and is superseded by the current status override above.

### Current pushed state

Latest pushed commit:
- `c6fa46f0 Add dedicated recruiting and recorder hero assets`

Recent commits:
- `c6fa46f0 Add dedicated recruiting and recorder hero assets`
- `be518880 Align arena widths and home hero layer`
- `1c3e6eb9 Show team rank board on mobile hero`
- `5e01251b Unify hero typography and remove washes`
- `b02ae360 Apply hero scope to all page headers`
- `086b16cc Use cream light hero titles`
- `ee46a50c Remove home image card frame lines`
- `e07330d7 Document cause and result reporting`
- `cb6f9012 Remove rank spotlight frame artifacts`
- `d81f7e42 Remove hero image overlay washes`
- `5a2a9d02 Remove boxed links inside rank image card`
- `a3f18dbe Fix mobile home hero bleed guard`

Known current `git status --short`:
- `?? pnpm-lock.yaml`
- `?? pnpm-workspace.yaml`

Do not stage `pnpm-lock.yaml` or `pnpm-workspace.yaml` unless the user explicitly asks.

### User rules that must carry over

- Korean only.
- Caveman mode: short, direct, no filler.
- Minimal safe changes.
- Do not rewrite whole files unless necessary.
- Do not delete assets unless explicitly asked.
- Do not invent filenames.
- Do not stage `pnpm-lock.yaml` or `pnpm-workspace.yaml` unless explicitly asked.
- Do not create many files under `api/`. Use `api/index.js` and `server/api/**`.
- Do not expose `service_role_key`, `DATABASE_URL`, DB passwords, or other secrets to frontend.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ASSET_BASE_URL` are frontend-public.
- If changing room/match/recruiting/referee/record/team/tournament/auth logic, read `docs/logic-and-terminology.md` first and update it if logic changes.
- If changing UI/CSS/theme/layout/cards/buttons/heroes/modals/slots/avatars, read `docs/design-system.md` first and update it if design behavior changes.
- After editing, report changed files, exact changes, cause, result, commands run, build/test result, warnings, and `네가 해야할 것`.
- Execute required non-destructive remote DB SQL directly when credentials/tools are available; do not ask "실행해도 됨?" first.
- If remote DB SQL cannot be executed, put the required user action under `네가 해야할 것`.
- Keep destructive SQL guarded: use it only after explicit user request/risk confirmation.
- Commit and push completed work unless the user says not to.

### Agent operating policy

- Main manager owns priority, conflict resolution, and final scope.
- Use subagents if available; otherwise emulate with bounded parallel analysis roles.
- Subagents should be analysis-first unless the user explicitly asks to fix.
- Do not let subagents scan open-ended. Give each one a bounded target.
- Report what each subagent/role found when the user asks.
- Reasoning effort:
  - Manager: high.
  - Runtime/simple import/build checks: low to medium.
  - Supabase/RLS/auth/security/data-flow: high.
  - Fix agent: medium.
  - Very high only when production is blocked, DB/RLS/auth/security conflict exists, or subagent reports disagree.
- Stop broad exploration after one critical production blocker is found.
- Fix one issue per pass unless the user explicitly says to continue through all pending issues.
- Prefer targeted `rg` and file reads over broad repo scans.
- Use `multi_tool_use.parallel` for parallel read/search commands.
- For UI checks, use browser verification when available and inspect computed styles/screenshots instead of guessing.

Suggested role split:
- Runtime Error Agent: undefined variables, missing imports/exports, hook crashes, null crashes.
- Supabase Integration Agent: schema/frontend mismatch, table/column/select/RLS/env mismatch.
- Build/Test Agent: build and smoke checks only.
- Security/RLS Agent: service role exposure, database URL exposure, RLS looseness/blockers.
- Flow Mapper Agent: room/match/feed lifecycle and duplicate calls.
- CSS/UI Agent: design tokens, hero/card/button/layout consistency.
- Fix Agent: minimal patch after manager selects scope.

### Current product invariants

- First-load numbers and lists must not change 5-10 seconds later due to late fallback calls.
- Home, Matches, Recruiting should rely on feed snapshots for current-user related data.
- Public browsing and user-related feed must stay separated:
  - `/app/recruiting`: public/local matching queue.
  - `/app/matches`: my schedule/action/soon.
  - `/app`: profile bootstrap + action queue + thin feed summaries.
- List screens must be thin. Detail data loads only when the user opens detail/modal/history.
- `user_room_feed.card_json` is the list source where possible.
- Broad `/api/state/load` or broad `loadNormalizedRemoteStateFromClient()` fallback must not reappear for list pages.
- `profile_feed` full redesign was discussed but not implemented; current safe path uses `user_room_feed` and thin endpoints.
- Confirmed old record rooms should not be loaded in Home/Matches by default. Records load from profile/team/record screens when opened.
- Basketball loader must be page-level/body-level when blocking remote data; avoid duplicate card-local loaders.

### Logic policies changed during this thread

- `user_room_feed.feed_scope='profile'` is current profile feed. `feed_scope='public'` is server-side public regional feed.
- `region_public` relation is public feed; `owner`, `participant`, `invited`, `referee` are profile feed.
- Feed counts are badge counts, not a trigger to auto-load relation lists.
- Recruiting relation tabs (`내가 만든 방`, `내 참여방`, `초대받음`) should load full relation feed without `더 보기`.
- Public recruiting list uses local/region/date filter and `더 보기` only when server says more public rows exist.
- Private team match creation B-side should invite one representative, not preselect the whole opponent roster.
- Private team B-side representative becomes party/side leader and selects team lineup after accepting.
- Team party only exists when actual party participants/reserves are at least 2. `teamId` alone does not make a party.
- Invite search:
  - profile invite rows select/send individual invite.
  - team invite rows use `joinMode:"team"` and `teamId`.
  - old invites without `joinMode` keep legacy inference.
- Search results should not show hover profile/team cards or favorite stars. Favorites are managed in Settings only.
- Hashtags use `#`, not `@`.
- Search threshold policy: Korean/# 2 chars, English/number 4 chars, debounce, max 10 results.
- Team roles were simplified conceptually to team captain, regular member, mercenary; avoid over-splitting unless logic doc is updated.
- Dispute flow is field-side verification:
  - after match end, score/stat review happens immediately.
  - only referee or host edits dispute draft.
  - save updates draft; confirm commits record.

### Design policies changed during this thread

- All page-level heroes means home, matches, recruiting, recorder, teams, profile, settings, rulebook, tournament, match room, and page-header heroes.
- Hero title font token is `--hero-title-font`.
- Do not put dark/white wash, scanline/grid, blur, or pseudo overlay on hero images.
- Hero backgrounds must not double-layer parent and child.
- Home hero:
  - desktop uses `.rank-summary-grid` background.
  - 759px 이하 uses `.home-rank-board-head` background because parent is `display: contents`.
- `/app/matches` and `/app/recruiting` page containers follow shared 1440px desktop width.
- Desktop/non-mobile hero side/top bleed rules are documented in `docs/design-system.md`.
- Mobile must avoid body horizontal scroll. Slot rows can scroll only inside the slot row when necessary.
- Room modal slots preserve structure: A/B side, avatars, READY/WAIT, empty slots, reserve slots, party connection lines.
- Recruiting hero now uses:
  - light: `/assets/court-ball-day.webp`
  - dark: `/assets/court-ball-night.webp`
  - token: `--bg-recruiting`
- Recorder/progress hero now uses:
  - light: `/assets/NY-court-day.webp`
  - dark: `/assets/NY-court-night.webp`
  - token: `--bg-recorder`
- Generic `--bg-ball`/`--bg-hoop` should not be reused for Recruiting/Recorder heroes.
- Dark palette standard:
  - `#303132`, `#242526`, `#18191A`, `#F05A46`, `#FFD36C`, `#65D99F`, white text.
- Light palette standard:
  - warm cream sports app, not white SaaS dashboard.
  - `#F5F1E8`, `#FFFAF1`, `#151515`, `#E5553F`, `#A86C14`, `#218A5F`.
- Cause/result should be documented in design/logic docs when fixing repeated UI/logic bugs.

### Important completed work in this thread

- Reduced and documented broad list fallback rules.
- Stabilized feed-based first-load counts/lists in Home/Matches/Recruiting.
- Added/used feed counts RPC pattern for recruiting badges.
- Scoped local/public recruiting and relation list behavior.
- Moved many page loads toward feed/detail separation.
- Added profile match summary feed concept for player stats.
- Improved invite acceptance refresh and stale protection.
- Fixed private team B-side invite flow direction in docs/logic and UI pieces.
- Fixed invite popover clipping and search result behavior.
- Fixed slot/party UI visual issues repeatedly and documented invariants.
- Standardized hero typography and removed hero overlay washes.
- Extended hero scope to all page-level headers.
- Fixed home hero mobile bleed guards and desktop/single background layer.
- Moved team rank board into mobile team hub hero.
- Added dedicated Recruiting/Recorder hero assets.
- Build currently passes with direct Vite command.

### Still risky / unfinished

- `useAppData.js` still contains optimistic/frontend reducer logic. Production is not fully DB-authoritative.
- Some server actions still replay normalized state instead of SQL/RPC transactions.
- `profile_match_summaries` exists for player summary direction, but team/referee summaries remain future work.
- Full `profile_feed` redesign was not implemented.
- Supabase production migrations must be verified before relying on feed/RPC paths.
- `profiles`, `teams`, `team_members`, `courts`, settings, and directory reads may still have egress reduction opportunities.
- `/api/state/load` still exists and should remain fallback/profile-only, not list-page source.
- Team management UX and role enforcement still need product-level tightening.
- Full simulation coverage is incomplete:
  - team party, private team invite, reserve promotion, referee no-show, recorder handoff, dispute draft/commit, tournament.
- `pnpm-lock.yaml` and `pnpm-workspace.yaml` remain untracked.

### Current useful verification commands

```powershell
git status --short
git log -8 --oneline
C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\node_modules\vite\bin\vite.js build
```

`npm` may not be available in this environment. `pnpm run build` may fail on `ERR_PNPM_IGNORED_BUILDS esbuild@0.21.5`; direct Vite build is the known working check.

### Next-thread prompt

Paste this into the next thread:

```text
Continue from repository:
C:\Users\user\Documents\rankball

Rules:
- Korean only.
- Caveman mode: short, direct, no filler.
- Minimal safe changes.
- Do not rewrite whole files unless necessary.
- Do not delete assets.
- Do not invent filenames.
- Do not stage pnpm-lock.yaml or pnpm-workspace.yaml unless explicitly asked.
- Do not create many api/ files. Use api/index.js + server/api routes.
- Do not expose service_role_key, DATABASE_URL, DB password, or any secret to frontend.
- If changing room/match/recruiting/referee/record/team/tournament/auth logic, read docs/logic-and-terminology.md first and update it if logic changes.
- If changing UI/CSS/theme/layout/cards/buttons/slots/avatars/modals/heroes, read docs/design-system.md first and update it if design behavior changes.
- After editing, report changed files, exact changes, cause/result, commands run, test/build result, warnings.
- Commit and push completed work unless I say not to.

First read:
- AGENTS.md
- HANDOFF.md
- docs/logic-and-terminology.md
- docs/design-system.md
- relevant source files before editing

Start commands:
- git status --short
- git log -8 --oneline
- rg -n "loadNormalizedRemoteStateFromClient|/api/state/load|select\\(\"\\*\"\\)|user_room_feed|rankball_recruiting_feed_counts" src server api supabase

Current pushed state:
- Latest known commit: c6fa46f0 Add dedicated recruiting and recorder hero assets
- Recent UI commits include hero scope, hero typography, home hero single background, matches/recruiting 1440 width, team mobile rank board, recruiting/recorder dedicated hero assets.

Current priority:
1. Do not let Home/Matches/Recruiting first-load numbers/lists change after delayed fallback calls.
2. Keep list screens feed-first and thin. Detail/history loads only on explicit open.
3. Continue Supabase egress reduction without breaking feed counts, invite acceptance, match/recruiting schedules.
4. Move remaining action logic toward server/RPC authoritative paths one small issue at a time.
5. Expand simulations after each flow fix.

Agent operation:
- Use subagents if available.
- Main Manager: high reasoning, picks scope and resolves conflicts.
- Runtime Error Agent: medium, undefined/import/hook/null crash.
- Supabase Integration Agent: high, schema/RLS/frontend mismatch.
- Build/Test Agent: low, build/smoke only.
- Security/RLS Agent: high, secret/RLS/security only.
- Flow Mapper Agent: medium/high, duplicate calls and feed lifecycle.
- CSS/UI Agent: medium, tokens/layout/hero/card consistency.
- Fix Agent: medium, minimal patch only after manager selects target.
- Keep subagents bounded. Do not scan whole repo unless required.
- Report subagent findings when asked.

Known untracked:
- pnpm-lock.yaml
- pnpm-workspace.yaml
Do not stage unless explicitly asked.

Known design invariants:
- All page-level heroes include home/matches/recruiting/recorder/teams/profile/settings/rulebook/tournament/match room/page-header.
- No hero overlay wash/blur/grid/pseudo layer.
- Home hero background is one layer only: desktop parent, mobile visible child.
- Recruiting hero uses --bg-recruiting court-ball day/night.
- Recorder hero uses --bg-recorder NY-court day/night.
- Matches and Recruiting desktop page width is shared 1440px.
- Room modal slot structure must remain; visual changes only unless explicitly changing logic.

Known logic invariants:
- user_room_feed profile/public scopes are canonical for list screens.
- Feed counts are badge counts, not auto-load triggers.
- Recruiting relation tabs load only on click and do not show 더 보기.
- Team party requires 2+ actual participants/reserves.
- Private team B-side invite selects one representative; lineup chosen after accept.
- Broad /api/state/load must not reappear as list-page fallback.

Before any fix:
- State the broken invariant.
- Read the relevant docs/source.
- Patch minimal files.
- Run direct Vite build:
  C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\node_modules\vite\bin\vite.js build
```

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
- `501fc47b Reduce invite refresh duplication`

Recent relevant commits:
- `501fc47b Reduce invite refresh duplication`
- `b556299f Stabilize feed refresh and match counts`
- `df5e8ce8 Stabilize match feed and invite refresh`
- `5b47662c Preserve explicit profile settings`
- `6e6f867c Add DB migration for match stale guard`
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
- Example used the authenticated `rankball-010` Supabase session available at that time:
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

## 5-1. Supabase CLI / DB Migration Apply

Current production project ref:
- `olzxextphxpniwiiwwda`

Use Supabase CLI for production DB migration when available.

Required command check:

```powershell
supabase --version
```

Non-interactive env needed:

```powershell
$env:SUPABASE_ACCESS_TOKEN="..."
$env:SUPABASE_DB_PASSWORD="..."
```

Link and dry run:

```powershell
supabase link --project-ref olzxextphxpniwiiwwda --password $env:SUPABASE_DB_PASSWORD
supabase db push --linked --dry-run
```

Apply:

```powershell
supabase db push --linked
```

Alternative if `DATABASE_URL` is provided:

```powershell
supabase db push --db-url "$env:DATABASE_URL" --dry-run
supabase db push --db-url "$env:DATABASE_URL"
```

Never run on production unless explicitly approved:
- `supabase db reset --linked`
- `DROP TABLE`
- `TRUNCATE`
- broad `DELETE`

Current feed-related migrations that production must have:
- `supabase/migrations/20260629093000_match_stale_and_feed_health.sql`
- `supabase/migrations/20260629102000_match_feed_card_contract.sql`
- `supabase/migrations/20260629111500_feed_trigger_repair.sql`
- `supabase/migrations/20260629113500_feed_courts_trigger_health.sql`

After applying, verify:

```powershell
Invoke-RestMethod -Method Post -Uri "https://boxtier.kr/api/system/schema-health" -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```

Expected feed trigger state:
- `rankball_feed_trigger_health` RPC exists.
- `failedFeedTriggerCount` is `0`.
- Required triggers include `rankball_courts_feed_dependency_refresh`.

## 6. Backend Simulation

Script:
- `scripts/simulate-backend-flow.mjs`

Production command:

```powershell
$env:RANKBALL_SIM_TIMEOUT_MS='45000'
C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\scripts\simulate-backend-flow.mjs --base-url=https://boxtier.kr
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
- `CLOUDFLARE_ACCOUNT_ID=...`
- `CLOUDFLARE_R2_API_TOKEN=...` (`rankball` bucket object write/delete only)
- `CLOUDFLARE_R2_BUCKET=rankball`

Team emblem writes:
- Browser converts the source to square WebP, at most `512x512` and `300KB`.
- `POST /api/teams/emblem` verifies the authenticated captain and writes `team-emblems/{teamId}/{contentHash}.webp`.
- `teams.emblem_key` is the source of truth. `VITE_ASSET_BASE_URL` resolves the public URL.

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

Production state count checks now run through the authenticated backend simulation. Do not use legacy `test-token` bearer values.

```powershell
npm run simulate:backend -- --full
```

Production backend simulation:

```powershell
$env:RANKBALL_SIM_TIMEOUT_MS='45000'
C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe .\scripts\simulate-backend-flow.mjs --base-url=https://boxtier.kr
```

Search wide Supabase payload patterns:

```powershell
rg -n 'select\("\*"\)|select\(''\*''\)|profiles\(\*\)|courts\(\*\)|match_players\(\*\)|reports\(\*\)|reviews\(\*\)|player_match_stats\(\*\)' .\src .\server .\api .\scripts
```

## 14. Suggested Next Thread Prompt

Use `## 0. 2026-07-02 Thread Transfer Summary` above. The prompt in that section is the current next-thread prompt.
