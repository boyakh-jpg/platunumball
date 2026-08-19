# Style

Caveman mode.

- Korean only unless asked otherwise. No greetings or filler; apologize only when necessary.
- Keep answers short and core-only. Preserve exact code, commands, filenames, and paths.

# Core Coding

- 제1원칙: 운영 데이터, 사용자 값, 테마 색상, 경로, 화면별 시각 규칙을 하드코딩하지 않는다. canonical DB/API, 공용 helper, 디자인 토큰을 재사용한다.
- 제2원칙: 업로드 이미지는 용도별 canonical 저장소를 고정한다. DB row 수명주기에 결합된 게시판·사용자 첨부는 Supabase Storage, 고조회 공개 이미지와 서버 전용 비공개 증거는 Cloudflare R2에 저장한다. 파일별 동적 전환과 브라우저 직접 쓰기를 금지하고 DB에는 object key와 검증 메타데이터만 저장한다.
- Before changing CSS or logic, trace the final value through its cascade, inheritance, call path, and data path to the canonical owner.
- Change the narrowest canonical layer governing every affected consumer: DB/API/schema/helper, shared component or semantic variant, token or primitive, then truly page-specific code.
- Never bypass project-owned shared rules with duplicated logic, stronger selectors, inline styles, or `!important`. Only unavoidable third-party CSS may use narrowly scoped, reason-commented `!important`.
- Give legitimate screen differences an explicit shared semantic variant; do not mutate unrelated global tokens or create accidental page overrides.
- Inspect current files first. Make small targeted patches; avoid unnecessary rewrites. Never invent filenames or delete assets without explicit instruction.
- Preserve unrelated changes and existing UI/behavior outside the requested scope.

# Requests and Policy

- Before non-trivial implementation, restate a clean Korean implementation prompt with scope, affected screens, and required logic/design docs.
- Discover repository scope and proceed. Ask only for a material conflict, risk, or product decision; otherwise make and state the safest assumption. If a request conflicts with an existing principle, explain it and ask whether to change or reject that principle. Do not blindly agree.
- For bugs, state the broken invariant first. Evaluate UI ideas for clarity, steps, and responsiveness; logic changes for room phase, party, permission, MMR, and record rules.
- Diagnosis, explanation, and review are read-only unless implementation is also requested.
- Canonical policy docs describe current intent, not append-only changelogs; Git stores history. Before work, search the affected doc for duplicate, overlapping, or contradictory rules.
- User decisions and canonical policy define intent. DB/API/schema, helpers, code, and tests are runtime evidence. Newer dates or code do not replace policy unless scope and superseded rule are explicit.
- On conflict, inspect the canonical owner and relevant Git history; classify stale docs, implementation regression, or unresolved product decision. Ask only for the last case, otherwise repair the stale side in the same scoped change.
- When policy changes, replace or remove the superseded statement and update affected code/tests in the same commit. Audit broad existing drift separately; never normalize unrelated policy opportunistically.

# Project Safety

- For room, match, party, invite, referee, record, report, MMR, team, tournament, auth, notification, or contact logic, check `docs/logic-and-terminology.md`; update it in the same commit when behavior changes.
- For database, schema, RLS, storage, upload, or delivery changes, check `docs/data-storage-model.md`; update it in the same commit when data or storage behavior changes.
- For UI, CSS, responsive layout, themes, cards, buttons, slots, avatars, hover cards, modals, or heroes, check `docs/design-system.md`; update it in the same commit when design behavior changes.
- Matching and Matches share one room-modal logic. Keep slot, phase, party, and permission calculations in central helpers. Keep demo data compatible with real creation flow.
- Supabase migrations are non-destructive by default: no `DROP TABLE`, `TRUNCATE`, or `DELETE` without explicit risk-confirmed instruction. Prefer `ALTER TABLE`, `CREATE POLICY`, `DROP POLICY IF EXISTS`, and `IF EXISTS` / `IF NOT EXISTS`.
- Execute required non-destructive remote DB SQL when credentials/tools exist. If unavailable, give the exact action under `네가 해야할 것`.

# Verification and Completion

- Verify changed files and directly affected paths. Run repository-wide checks only when required or no narrower check exists. Report exact build/test failures.
- Build success alone is insufficient for affected flows. Test only affected roles/branches (host, party leader, regular/reserve player, referee/no-referee) and screens/breakpoints/themes (desktop/mobile, dark/light).
- Complete only after implementation, required doc updates, intended-diff review, and scoped verification pass or an exact blocker. Then report and stop.
- After context compaction, trust the retained summary and current diff unless new evidence invalidates them.

# Reporting, Git, and Deployment

- Implementation reports contain only: changed files, exact changes, cause, result, commands run, important warnings, `네가 해야할 것`.
- Diagnosis/explanation/review reports contain only conclusion, evidence, and required user action; do not commit, push, or verify deployment.
- After implementation verification, commit only intended files and push to production branch `main`, unless the user says not to.
- Deployable production code/config/assets must deploy through Vercel Git integration. Verify ready production metadata matches the pushed SHA; never add a preview or separate CLI deployment/promotion for that commit.
