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

## 환경변수

| 이름 | 위치 | 용도 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | 브라우저/서버 | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_ANON_KEY` | 브라우저 | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버/스크립트 전용 | server action, seed, simulation |
| `VITE_ENABLE_SERVER_ACTIONS` | 브라우저 | server action 활성화 |
| `RANKBALL_ENABLE_TEST_LOGIN` / `VITE_DEMO_LOGIN` | 서버/브라우저 | 테스트 로그인 허용 |
| `VITE_ASSET_BASE_URL` / `VITE_PUBLIC_ASSET_BASE_URL` | 브라우저 | 원격 asset base URL |
| `VITE_NAVER_MAP_CLIENT_ID` / `VITE_NAVER_MAP_NCP_KEY_ID` | 브라우저/서버 fallback | Naver map/geocode client id |
| `NAVER_MAP_CLIENT_SECRET` / `NAVER_MAP_NCP_KEY` / `NAVER_MAP_NCP_CLIENT_SECRET` | 서버 전용 | Naver geocode fallback secret |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI` | 서버 전용 | Discord OAuth |
| `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` / `DISCORD_GUILD_IDS` | 서버 전용 | Discord DM worker |
| `DISCORD_PUBLIC_KEY` | 서버 전용 | Discord interaction signature 검증 |
| `CRON_SECRET` | 서버/스크립트 전용 | worker, maintenance, schema-health |
| `RANKBALL_SIM_BASE_URL` / `RANKBALL_SIM_SECRET` / `RANKBALL_SIM_TIMEOUT_MS` | 스크립트 | backend simulation |

## Vercel

Framework preset은 `Vite`, build command는 `npm run build`, output directory는 `dist`입니다.
