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

- 제1원칙: 운영 데이터, 사용자 값, 테마 색상, 경로, 화면별 시각 규칙을 하드코딩하지 않는다. canonical DB/API, 공용 helper, 디자인 토큰을 재사용한다.
- 제2원칙: 업로드 이미지는 용도별 canonical 저장소를 고정한다. DB row 수명주기에 결합된 게시판·사용자 첨부는 Supabase Storage, 고조회 공개 이미지와 서버 전용 비공개 증거는 Cloudflare R2를 사용한다. 파일별 동적 전환과 브라우저 직접 쓰기를 금지하고 DB에는 object key와 검증 메타데이터만 저장한다.
- Inspect relevant current files before editing.
- Make minimal safe changes. Prefer small targeted patches.
- Do not rewrite whole files unless necessary.
- Do not delete assets unless explicitly asked.
- Do not invent filenames.
- Preserve existing UI and behavior unless the task requires a change.
- Preserve unrelated uncommitted changes.

# Request Handling

- Before non-trivial implementation, restate the request as a clean Korean implementation prompt and state the intended scope, affected screens, and required logic/design documentation.
- Determine discoverable scope from the repository and proceed without excessive confirmation. Ask only when a conflict or material risk requires a user decision.
- Do not blindly agree with the user.
- For affected logic or UI, judge the request against `docs/logic-and-terminology.md` or `docs/design-system.md`.
- If the request conflicts with an existing principle, explain the conflict and ask whether to change the principle or reject the change.
- If the user reports a bug, first state the invariant that appears broken.
- For a UI idea, evaluate clarity, step count, and responsive layout.
- For a logic change, evaluate room phase, party, permission, MMR, and record rules.
- Diagnosis, explanation, and review requests are read-only unless the user also asks for implementation.

# Development Rules

- If requirements are ambiguous, make the safest reasonable assumption and mention it.
- If a build or test fails, include the exact failure summary.
- Supabase SQL Editor migration SQL must avoid data loss by default. Do not use `DROP TABLE`, `TRUNCATE`, or `DELETE` unless explicitly requested after risk confirmation.
- Supabase migration SQL should use `ALTER TABLE`, `CREATE POLICY`, `DROP POLICY IF EXISTS`, and `IF EXISTS` / `IF NOT EXISTS` for objects that may already exist.
- Required non-destructive remote DB SQL may be executed directly when credentials or tools are available. Do not ask "실행해도 됨?" first.
- If remote DB SQL cannot be executed, report the exact required user action under `네가 해야할 것`.

# Project Rules

- Before changing room, match, party, invite, referee, record, report, MMR, team, tournament, or auth logic, check `docs/logic-and-terminology.md`.
- If logic changes, update `docs/logic-and-terminology.md` in the same commit.
- Before changing UI, CSS, responsive layout, light/dark theme, cards, buttons, slots, avatars, hover cards, modals, or page heroes, check `docs/design-system.md`.
- If design behavior changes, update `docs/design-system.md` in the same commit.
- Do not create separate menu-specific room modals. Matching and Matches must use the same room modal logic.
- Do not duplicate slot, phase, party, or permission calculations in page components. Use central helpers first.
- If demo data changes, keep it compatible with real creation flow.

# Verification

- Limit verification to changed files and directly affected paths.
- Run a repository-wide build or test suite only when the changed scope requires it or no narrower verification exists.
- Build success alone is not enough for an affected room or UI flow.
- For flow changes, test only affected roles and branches. Include host, party leader, regular player, reserve player, and referee/no-referee only when each path is affected.
- For UI changes, check only affected screens, breakpoints, and themes. Include desktop, mobile, dark mode, and light mode only when each is affected.

# Completion

- A task is complete when the requested change is implemented, required logic/design docs are updated, the intended diff is reviewed, and changed-scope verification passes or an exact blocker is reported.
- After reaching the completion condition, report and stop. Do not start unrelated investigation, refactoring, audit, or verification.
- After context compaction, trust the retained summary and current diff. Do not repeat completed inspection or verification unless new changes or evidence invalidate it.

# Reporting

- After an implementation task, report only:
  1. changed files
  2. exact changes
  3. cause
  4. result
  5. commands run
  6. important warnings
  7. 네가 해야할 것
- For diagnosis, explanation, or review, report only the conclusion, evidence, and required user action. Do not use the seven-part report or deployment verification.

# Git and Deployment

- Commit and push only implementation work that changes repository files, unless the user says not to.
- Use `main` as the production branch.
- After implementation verification, commit only the intended files and push the completed commit to `main`.
- For deployable production code, configuration, or asset changes, Vercel Git integration must deploy the pushed commit directly to production. Verify that the ready production deployment metadata matches the pushed commit SHA.
- Do not create a preview deployment and do not run a separate CLI deployment or promotion for the same commit.
- Diagnosis, explanation, and review tasks do not commit, push, or verify deployment.
