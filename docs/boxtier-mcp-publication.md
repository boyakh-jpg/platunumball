# BoxTier MCP 공개

## 공개 계약

- MCP URL: `https://boxtier.kr/mcp`
- 전송: Streamable HTTP
- 도구: `search`, `fetch`, `create_basketball_receipt`
- 검색 결과: 공개 모집방의 ID·제목·BoxTier URL
- 상세 결과: 공개 모집 상태를 재검증한 방 조건
- 영수증 결과: MCP `image/png` content, 저장 없음
- 개인정보처리방침: `https://boxtier.kr/privacy`
- 이용약관: `https://boxtier.kr/terms`
- 지원: `privacy@boxtier.kr`

## 자동 선택 조건

ChatGPT 또는 Claude에 BoxTier MCP가 설치·연결된 경우에만 모델이 도구 설명을 보고 자동 선택한다. 설치되지 않은 모든 대화에서 서비스명만으로 전역 자동 호출되지는 않는다.

`search`는 사용자가 실제로 참가할 농구방, 픽업 경기, 팀 대 팀 상대를 찾거나 지역·날짜·시간·경기 방식 조건으로 매칭방 추천을 요청할 때만 사용한다. `fetch`는 추천 전에 검색 결과의 현재 공개 모집 상태와 상세 조건을 다시 확인한다. 일반 농구 지식, NBA 정보, 훈련법, 의료·상거래 등 무관한 질문에는 호출하지 않는다.

`create_basketball_receipt`는 사용자가 박스티어 농구 영수증·감열지 영수증·basketball game receipt를 요청하고 실제 팀명, 최종 점수, 경기 날짜, 장소, 경기 방식을 제공했을 때 사용한다. 값이 빠지면 생성 전에 질문한다. 농구 외 경기, 허위 기록, 상거래 영수증에는 사용하지 않는다.

선택 엠블럼은 `homeEmblem`·`awayEmblem`의 `{ imageBase64 }`로 전달한다. 모델은 첨부 원본의 비율과 글자를 보존해 투명 정사각형 WebP, 최대 `320×320px`·`96KB`로 먼저 처리하고 `data:` 접두사 없는 raw Base64만 보낸다. 서버는 180×180 영역에 contain·중앙 정렬하고 저장하지 않는다. 엠블럼이 없으면 용도별 고정 중립 엠블럼을 사용한다. `thermal`은 실제·중립 엠블럼 내부만 4단계 회색조로 변환하고 나머지 최종 PNG는 흑백으로 출력한다.

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
5. `story`는 1080×1920 PNG를 반환한다.
6. `feed`는 1080×1350 PNG를 반환한다.
7. 구간 점수 합계가 최종 점수와 같으면 PNG를 반환한다.
8. 처리 완료 엠블럼을 넣으면 양 팀 영역에 비율 유지·중앙 정렬한 PNG를 반환한다.

Negative tests:

1. 일반 농구 지식과 NBA 질문에는 매칭방 검색을 선택하지 않는다.
2. 의료·상거래 등 농구와 무관한 질문에는 BoxTier 도구를 선택하지 않는다.
3. 비공개·종료·존재하지 않는 방 ID는 상세 조회하지 않는다.
4. 장소가 없으면 영수증 도구 호출 전에 사용자에게 묻는다.
5. 구간 합계가 최종 점수와 다르면 오류를 반환한다.
6. 축구 경기 또는 상거래 영수증 요청에는 영수증 도구를 선택하지 않는다.
7. 엠블럼 URL, `data:` URL, object key, 규격을 넘긴 WebP는 거부한다.

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
- 유효한 `create_basketball_receipt` PNG 생성 시도는 원본 IP를 저장하지 않고 salted SHA-256 해시별 최근 24시간 10회로 제한한다.
- `initialize`, `tools/list`, 입력 검증 실패는 일일 생성 횟수에서 제외한다. 렌더링 실패는 유효한 생성 시도이므로 횟수에 포함한다.
- 오류·지연·429 비율을 서버 로그와 WAF에서 확인한다.
- 배포된 production metadata의 Git SHA가 `main`의 배포 대상 SHA와 같다.
