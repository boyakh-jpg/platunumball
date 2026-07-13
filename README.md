# RankBall

친구끼리 하는 농구 경기를 오늘의 판으로 등록하고, 경기 후 양팀 승인으로 전적과 티어를 남기는 React + Vite MVP입니다.

## 실행

```bash
npm install
npm run dev
```

`.env`가 없어도 localStorage demo mode로 실행됩니다.

## Supabase

Vite에서도 Vercel/Next 스타일의 `NEXT_PUBLIC_*` 환경변수를 읽도록 설정했습니다.

```txt
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Supabase에 영속 저장을 쓰려면 `supabase/schema.sql`을 SQL Editor에서 먼저 실행하세요. 테이블이 없거나 정책이 막혀 있으면 앱은 localStorage demo mode로 계속 동작합니다.

### Supabase CLI migration

Production DB migration은 가능하면 Supabase CLI로 적용합니다.

```powershell
supabase --version
$env:SUPABASE_ACCESS_TOKEN="..."
$env:SUPABASE_DB_PASSWORD="..."
supabase link --project-ref olzxextphxpniwiiwwda --password $env:SUPABASE_DB_PASSWORD
supabase db push --linked --dry-run
supabase db push --linked
```

`DATABASE_URL`이 있으면 link 없이도 적용할 수 있습니다.

```powershell
supabase db push --db-url "$env:DATABASE_URL" --dry-run
supabase db push --db-url "$env:DATABASE_URL"
```

Production 적용 뒤 schema health를 확인합니다.

```powershell
Invoke-RestMethod -Method Post -Uri "https://platunumball.vercel.app/api/system/schema-health" -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```

배포 전 검증은 한 명령으로 실행합니다.

```powershell
npm run verify:release
```

`verify:release`는 production build 후 원격 Supabase/Auth 기반 전체 backend simulation과 schema health를 실행합니다. `SUPABASE_SERVICE_ROLE_KEY`, 테스트 Auth 환경변수, `CRON_SECRET`이 필요합니다. 종료 코드가 0이 아니면 배포하지 않습니다.

원격 DB에는 `supabase db reset --linked`, `DROP TABLE`, `TRUNCATE`, 대량 `DELETE`를 쓰지 않습니다.

## 환경변수

| 이름 | 위치 | 용도 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | 브라우저/서버 | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_ANON_KEY` | 브라우저 | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버/스크립트 전용 | server action, seed, simulation |
| `VITE_ENABLE_SERVER_ACTIONS` | 브라우저 | server action 활성화 |
| `VITE_DEMO_LOGIN` | 브라우저 | 테스트 로그인 UI 허용 |
| `RANKBALL_SEED_REAL_TEST_AUTH` / `RANKBALL_SEED_AUTH_ONLY` | 스크립트 | 테스트 계정을 Supabase Auth user로 만들고 기존 profile에 연결 |
| `RANKBALL_TEST_PASSWORD` / `VITE_TEST_AUTH_PASSWORD` | 스크립트/브라우저 | 테스트 계정 password Auth용 비밀번호 |
| `RANKBALL_TEST_AUTH_EMAIL_DOMAIN` / `VITE_TEST_AUTH_EMAIL_DOMAIN` | 스크립트/브라우저 | 테스트 계정 email domain. 기본값 `rankball.test` |
| `VITE_ASSET_BASE_URL` / `VITE_PUBLIC_ASSET_BASE_URL` | 브라우저 | 원격 asset base URL |
| `VITE_NAVER_MAP_CLIENT_ID` / `VITE_NAVER_MAP_NCP_KEY_ID` | 브라우저/서버 fallback | Naver map/geocode client id |
| `NAVER_MAP_CLIENT_SECRET` / `NAVER_MAP_NCP_KEY` / `NAVER_MAP_NCP_CLIENT_SECRET` | 서버 전용 | Naver geocode fallback secret |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI` | 서버 전용 | Discord OAuth |
| `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` / `DISCORD_GUILD_IDS` | 서버 전용 | Discord DM worker |
| `DISCORD_PUBLIC_KEY` | 서버 전용 | Discord interaction signature 검증 |
| `CRON_SECRET` | 서버/스크립트 전용 | worker, maintenance, schema-health |
| `SUPABASE_ACCESS_TOKEN` | CLI 전용 | Supabase Management API 인증 |
| `SUPABASE_DB_PASSWORD` | CLI 전용 | `supabase link`, `supabase db push --linked` 원격 DB 비밀번호 |
| `SUPABASE_PROJECT_ID` | CLI/CI 전용 | Supabase project ref. 현재 production ref: `olzxextphxpniwiiwwda` |
| `DATABASE_URL` | CLI/서버 전용 | `supabase db push --db-url` 또는 직접 Postgres 접속 |
| `RANKBALL_SIM_BASE_URL` / `RANKBALL_SIM_SECRET` / `RANKBALL_SIM_TIMEOUT_MS` | 스크립트 | backend simulation |

## Vercel

Framework preset은 `Vite`, build command는 `npm run build`, output directory는 `dist`입니다.
