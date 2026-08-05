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

Supabase 영속 저장은 `supabase/migrations`를 순서대로 적용합니다. Supabase 환경이 설정된 뒤 원격 로드가 실패하면 localStorage demo state로 후퇴하지 않고 원격 shell/error 상태를 유지합니다.

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
Invoke-RestMethod -Method Post -Uri "https://boxtier.kr/api/system/schema-health" -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```

배포 전 검증은 한 명령으로 실행합니다.

```powershell
npm run verify:release -- --confirm-production=olzxextphxpniwiiwwda
```

`verify:release`는 production build 후 원격 Supabase/Auth 기반 전체 backend simulation과 schema health를 실행합니다. production ref와 정확히 같은 `--confirm-production=<project-ref>` CLI flag가 없으면 API/Auth 호출 전에 중단합니다. `SUPABASE_SERVICE_ROLE_KEY`, 테스트 Auth 환경변수, `CRON_SECRET`이 필요합니다. 종료 코드가 0이 아니면 배포하지 않습니다.

simulation은 실행 전에 environment, 직접 Supabase project ref, 원격 API host/ref를 stderr에 표시합니다. process당 전체 flow 반복 상한은 1회이고 자동 재시도는 cleanup 실패 시 최대 1회입니다. 별도 process를 다시 실행하는 외부 runner도 호출 횟수를 1회로 제한해야 합니다. `--safety-check-only`는 target guard만 검증하고 DB/API를 호출하지 않습니다.

테스트 전용 Supabase는 test URL, publishable key, service-role key를 함께 설정합니다. 원격 test API를 쓰면 실제 배포 대상과 같은 ref를 `--remote-project-ref=<test-ref>`로 추가합니다. 직접 ref와 원격 ref가 다르면 실행하지 않습니다.

원격 DB에는 `supabase db reset --linked`, `DROP TABLE`, `TRUNCATE`, 대량 `DELETE`를 쓰지 않습니다.

## 환경변수

| 이름 | 위치 | 용도 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | 브라우저/서버 | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_ANON_KEY` | 브라우저 | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버/스크립트 전용 | server action, seed, simulation |
| `VITE_ENABLE_SERVER_ACTIONS` | 브라우저 | server action 활성화 |
| `VITE_DEMO_LOGIN` | 브라우저 | localhost 테스트 로그인 UI 허용 |
| `RANKBALL_SEED_REAL_TEST_AUTH` / `RANKBALL_SEED_AUTH_ONLY` | 스크립트 | 테스트 계정을 Supabase Auth user로 만들고 기존 profile에 연결 |
| `RANKBALL_TEST_PASSWORD` / `VITE_TEST_AUTH_PASSWORD` | 스크립트/브라우저 | 테스트 계정 password Auth용 비밀번호 |
| `RANKBALL_TEST_AUTH_EMAIL_DOMAIN` / `VITE_TEST_AUTH_EMAIL_DOMAIN` | 스크립트/브라우저 | 테스트 계정 email domain. 기본값 `rankball.test` |
| `VITE_ASSET_BASE_URL` / `VITE_PUBLIC_ASSET_BASE_URL` | 브라우저 | 원격 asset base URL |
| `VITE_NAVER_MAP_CLIENT_ID` / `VITE_NAVER_MAP_NCP_KEY_ID` | 브라우저/서버 fallback | Naver map/geocode client id |
| `NAVER_MAP_CLIENT_SECRET` / `NAVER_MAP_NCP_KEY` / `NAVER_MAP_NCP_CLIENT_SECRET` | 서버 전용 | Naver geocode fallback secret |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI` | 서버 전용 | Discord OAuth |
| `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` / `DISCORD_GUILD_IDS` | 서버 전용 | Discord DM worker |
| `DISCORD_PUBLIC_KEY` | 서버 전용 | Discord interaction signature 검증 |
| `DISCORD_CHAT_BRIDGE_SECRET` / `DISCORD_CHAT_BRIDGE_URL` | bridge worker | Discord 방 채팅을 웹 API로 전달 |
| `DISCORD_CHAT_BRIDGE_REQUEST_TIMEOUT_MS` / `DISCORD_CHAT_BRIDGE_MAX_DELIVERY_ATTEMPTS` | bridge worker | 전달 timeout과 재시도 횟수. 기본 `10000`, `4` |
| `CRON_SECRET` | 서버/스크립트 전용 | worker, maintenance, schema-health |
| `SUPABASE_ACCESS_TOKEN` | CLI 전용 | Supabase Management API 인증 |
| `SUPABASE_DB_PASSWORD` | CLI 전용 | `supabase link`, `supabase db push --linked` 원격 DB 비밀번호 |
| `SUPABASE_PROJECT_ID` | CLI/CI 전용 | Supabase project ref. 현재 production ref: `olzxextphxpniwiiwwda` |
| `DATABASE_URL` | CLI/서버 전용 | `supabase db push --db-url` 또는 직접 Postgres 접속 |
| `RANKBALL_SIM_BASE_URL` / `RANKBALL_SIM_SECRET` / `RANKBALL_SIM_TIMEOUT_MS` / `RANKBALL_SIM_CLEANUP_TIMEOUT_MS` | 스크립트 | backend simulation |
| `RANKBALL_SIM_REMOTE_PROJECT_REF` | 스크립트 | 원격 test API가 사용하는 Supabase project ref. `--remote-project-ref`가 우선 |
| `RANKBALL_SIM_REPEAT` / `RANKBALL_SIM_MAX_RETRIES` | 스크립트 | 전체 flow 반복 상한 `1`, cleanup 재시도 상한 `1` |

## Discord 방 채팅 bridge

상시 실행 환경에서 아래 명령을 실행합니다. Gateway worker는 heartbeat ACK 누락 시 재연결하고, 가능한 세션은 resume하며, 웹 API의 timeout·429·5xx를 제한 횟수만큼 재시도합니다.

```powershell
npm run discord:room-chat-bridge
```

운영에서는 `DISCORD_CHAT_BRIDGE_SECRET`을 별도로 설정합니다. `CRON_SECRET` fallback은 기존 배포 호환용입니다.

## Vercel

Framework preset은 `Vite`, build command는 `npm run build`, output directory는 `dist`입니다.
