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

## Vercel

Framework preset은 `Vite`, build command는 `npm run build`, output directory는 `dist`입니다.
