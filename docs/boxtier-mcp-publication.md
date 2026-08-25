# BoxTier MCP 공개

## 공개 계약

- MCP URL: `https://boxtier.kr/mcp`
- 전송: Streamable HTTP
- 도구: `search`, `fetch`, `create_basketball_receipt`, `get_my_boxtier_account`, `list_my_match_records`
- 검색 결과: 공개 모집방의 ID·제목·BoxTier URL
- 상세 결과: 공개 모집 상태를 재검증한 방 조건
- 영수증 결과: MCP `image/png` content와 같은 PNG의 만료 R2 다운로드 URL
- 영수증 UI resource: 등록하지 않음 (`v2`·`v3`·`v4` 포함)
- 개인정보처리방침: `https://boxtier.kr/privacy`
- 이용약관: `https://boxtier.kr/terms`
- 지원: `privacy@boxtier.kr`

## 자동 선택 조건

ChatGPT 또는 Claude에 BoxTier MCP가 설치·연결된 경우에만 모델이 도구 설명을 보고 자동 선택한다. 설치되지 않은 모든 대화에서 서비스명만으로 전역 자동 호출되지는 않는다.

`search`는 사용자가 실제로 참가할 농구방, 픽업 경기, 팀 대 팀 상대를 찾거나 지역·날짜·시간·경기 방식 조건으로 매칭방 추천을 요청할 때만 사용한다. `fetch`는 추천 전에 검색 결과의 현재 공개 모집 상태와 상세 조건을 다시 확인한다. 일반 농구 지식, NBA 정보, 훈련법, 의료·상거래 등 무관한 질문에는 호출하지 않는다.

`create_basketball_receipt`는 사용자가 박스티어 농구 영수증·감열지 영수증·basketball game receipt를 요청하고 실제 팀명, 최종 점수, 경기 날짜, 장소, 경기 방식을 제공했을 때 사용한다. 값이 빠지면 생성 전에 질문한다. 농구 외 경기, 허위 기록, 상거래 영수증에는 사용하지 않는다.

`get_my_boxtier_account`와 `list_my_match_records`는 `profile` scope의 BoxTier OAuth 로그인이 필수다. 계정 확인이나 내 경기 기록 조회를 요청하면 ChatGPT가 로그인 연결을 표시한다. 영수증 생성은 로그인 없이도 가능하지만 익명 24시간 한도에 도달하면 로그인 연결을 제안하고, 로그인 후에는 canonical 프로필 기준 한도를 사용한다.

일반 호출은 완성 PNG를 `content[type=image]`에 한 번만 넣고 `structuredContent`에는 상태·크기·검증값·공개 코드·만료 다운로드 정보를 반환한다. `debugBase64=true`인 개발 확인 호출에서만 같은 Base64를 중복한다. 서버는 영수증 UI resource를 제공하지 않는다. 과거 위젯 descriptor를 캐시한 연결은 배포 뒤 해제·재연결하거나 도구를 재스캔해야 한다.

선택 엠블럼은 `homeEmblem`·`awayEmblem`의 `{ imageBase64 }` 또는 ChatGPT 첨부파일 입력으로 전달한다. 원형 파일은 강제하지 않는다. 투명 배경 정사각형 캔버스에 실제 도안만 담는 형식을 권장하며 원형 테두리·회색 원판을 미리 합성하지 않는다. 서버가 JPG·PNG·WebP 원본의 실제 알파 전경 경계와 가중중심을 계산해 비율을 보존하고, 전경 전체를 반지름 `138px` 원형 안전영역 안에 맞춘 `320×320px` 투명 WebP로 자동 중앙 정렬한다. 불투명 입력이 캔버스를 채우면 알파 경계의 지배적인 균일 흰색·회색 배경판을 최대 2단계 제거한 뒤 실제 도안을 계산한다. 배경과 도안을 안전하게 분리할 수 없으면 `emblem_background_not_removable`로 거부하며 배경 전체를 작은 엠블럼으로 축소하지 않는다. 입력과 처리본은 저장하지 않는다. 엠블럼이 없으면 용도별 고정 중립 엠블럼을 사용한다. `thermal`은 실제·중립 엠블럼의 알파 전경만 D 써멀 4단계 회색조로 변환한다. 종이·본문·선·패널은 연속 회색 농도를 보존한다.

## ChatGPT·Codex 공개 등록

1. OpenAI Platform의 plugin submission portal에서 `With MCP` 유형으로 BoxTier plugin을 만든다.
2. Universal MCP URL에 `https://boxtier.kr/mcp`를 등록하고 도메인 challenge를 완료한다.
3. `chatgpt-app-submission.json`을 가져와 앱 설명, 도구 annotation 근거, 평가 사례를 채운다.
4. 로고, `https://boxtier.kr`, `https://boxtier.kr/privacy#privacy-contact`, 개인정보처리방침, 이용약관, 아래 starter prompt를 입력한다.
5. `Scan Tools`에서 실제 PNG 반환과 도구 metadata를 검증한다.
6. Apps Management Write 권한과 검증된 publisher identity로 심사를 제출한다.
7. 승인 후 portal에서 공개하면 ChatGPT와 Codex가 공유하는 Plugins Directory에 게시된다.

Starter prompts:

- `오늘 성수에서 참가할 3대3 농구 매칭방 찾아줘`
- `내일 잠실에서 5대5로 붙을 상대 팀 모집방 찾아줘`
- `박스티어 감열지 농구 영수증 만들어줘`
- `이 농구 경기 결과를 BoxTier 스코어 영수증 PNG로 만들어줘`
- `쿼터 점수까지 넣어서 Story 비율 농구 영수증을 만들어줘`

Positive tests:

1. 지역·날짜·방식 검색은 조건에 맞는 현재 공개 모집방만 반환한다.
2. 상세 조회 시 방의 공개·모집 상태를 다시 확인한다.
3. 실제 필수값과 `thermal` 요청은 PNG를 반환한다.
4. 실제 필수값과 `score` 요청은 PNG를 반환한다.
5. `thermal story`는 현재 종이 경계 크기의 paper-only PNG를 반환하고 찢긴 상·하단 바깥 픽셀은 투명하다. `score story`는 1080×1920 PNG를 반환한다.
6. `feed`는 1080×1350 PNG를 반환한다.
7. 구간 점수 합계가 최종 점수와 같으면 PNG를 반환한다.
8. JPG·PNG·WebP 엠블럼을 넣으면 균일한 흰색·회색 배경판을 제거하고 실제 전경을 양 팀 원형 안전영역에 비율 유지·자동 중앙 정렬한 PNG를 반환한다.

Negative tests:

1. 일반 농구 지식과 NBA 질문에는 매칭방 검색을 선택하지 않는다.
2. 의료·상거래 등 농구와 무관한 질문에는 BoxTier 도구를 선택하지 않는다.
3. 비공개·종료·존재하지 않는 방 ID는 상세 조회하지 않는다.
4. 장소가 없으면 영수증 도구 호출 전에 사용자에게 묻는다.
5. 구간 합계가 최종 점수와 다르면 오류를 반환한다.
6. 축구 경기 또는 상거래 영수증 요청에는 영수증 도구를 선택하지 않는다.
7. 엠블럼 URL, `data:` URL, object key, 규격을 넘긴 WebP는 거부한다.
8. 배경과 실제 도안을 안전하게 분리할 수 없는 단색 엠블럼은 `emblem_background_not_removable`로 거부한다.

## MCP Registry·Claude 공개 등록

1. 저장소 루트의 `server.json`을 공식 MCP Registry validator로 검사한다.
2. GitHub namespace `io.github.boyakh-jpg/boxtier`로 로그인하고 `mcp-publisher publish`를 실행한다.
3. Registry API에서 공개 metadata와 `https://boxtier.kr/mcp` remote endpoint를 확인한다.

공식 MCP Registry는 Anthropic이 참여하는 공개 MCP metadata 원본이다. Claude의 directory 반영은 Anthropic의 downstream 선별 대상이며 Registry 게시만으로 Claude directory 노출을 보장하지 않는다. Claude에는 아래 방식으로 즉시 직접 연결할 수 있다.

### 직접 연결

Claude Code:

```bash
claude mcp add --transport http boxtier https://boxtier.kr/mcp
```

Claude.ai는 설정의 Connectors에서 같은 URL을 사용자 지정 connector로 등록한다. Claude Messages API는 요청의 `mcp_servers`에 `https://boxtier.kr/mcp`를 전달한다.

## 운영 확인

- `/mcp`가 인증 없이 HTTPS로 연결된다.
- `initialize`, `tools/list`, `tools/call`이 성공한다.
- `search`·`fetch`는 표준 JSON text content, 영수증은 `image/png` content를 반환한다.
- 검색·상세 결과에 비공개 방, 종료 방, 사용자 개인정보가 포함되지 않는다.
- 모든 `POST /mcp` 요청은 인스턴스별 IP 기준 1분 5회로 제한한다.
- 유효한 `create_basketball_receipt` PNG 생성 시도는 비로그인은 salted SHA-256 IP 해시, 로그인 사용자는 salted SHA-256 canonical 프로필 해시별 최근 24시간 10회로 제한한다. `adminlevel=100` owner만 일일 제한을 우회한다.
- 익명 일일 한도 초과는 OAuth challenge로 로그인을 유도한다. 로그인 일반 사용자의 한도 초과는 재로그인을 유도하지 않는다.
- 계정·내 기록 도구는 `profile` scope를 요구하며 입력으로 다른 사용자의 프로필 ID를 받지 않는다.
- `initialize`, `tools/list`, 입력 검증 실패는 일일 생성 횟수에서 제외한다. 렌더링 실패는 유효한 생성 시도이므로 횟수에 포함한다.
- 오류·지연·429 비율을 서버 로그와 WAF에서 확인한다.
- 배포된 production metadata의 Git SHA가 `main`의 배포 대상 SHA와 같다.
