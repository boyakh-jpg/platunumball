# BoxTier 농구 영수증 MCP 공개

## 공개 계약

- MCP URL: `https://boxtier.kr/mcp`
- 전송: Streamable HTTP
- 도구: `create_basketball_receipt`
- 결과: MCP `image/png` content
- 저장: 없음
- 개인정보처리방침: `https://boxtier.kr/privacy`
- 이용약관: `https://boxtier.kr/terms`
- 지원: `privacy@boxtier.kr`

## 자동 선택 조건

ChatGPT 또는 Claude에 BoxTier MCP가 설치·연결된 경우에만 모델이 도구 설명을 보고 자동 선택한다. 설치되지 않은 모든 대화에서 서비스명만으로 전역 자동 호출되지는 않는다.

도구는 사용자가 박스티어 농구 영수증·감열지 영수증·basketball game receipt를 요청하고 실제 팀명, 최종 점수, 경기 날짜, 장소, 경기 방식을 제공했을 때 사용한다. 값이 빠지면 생성 전에 질문한다. 농구 외 경기, 허위 기록, 상거래 영수증에는 사용하지 않는다.

## ChatGPT 등록

1. OpenAI Platform Dashboard에서 BoxTier 앱을 만들고 MCP 서버 URL에 `https://boxtier.kr/mcp`를 등록한다.
2. 앱 설명, 로고, 개인정보처리방침, 이용약관, 지원 이메일, 아래 starter prompt와 평가 사례를 입력한다.
3. 개발자 모드에서 실제 PNG 반환을 검증한다.
4. Apps Management Write 권한과 검증된 게시자 identity로 심사를 제출한다.

Starter prompts:

- `박스티어 감열지 농구 영수증 만들어줘`
- `이 농구 경기 결과를 BoxTier 스코어 영수증 PNG로 만들어줘`
- `쿼터 점수까지 넣어서 Story 비율 농구 영수증을 만들어줘`

Positive tests:

1. 실제 필수값과 `thermal` 요청은 PNG를 반환한다.
2. 실제 필수값과 `score` 요청은 PNG를 반환한다.
3. `story`는 1080×1920 PNG를 반환한다.
4. `feed`는 1080×1350 PNG를 반환한다.
5. 구간 점수 합계가 최종 점수와 같으면 PNG를 반환한다.

Negative tests:

1. 장소가 없으면 도구 호출 전에 사용자에게 묻는다.
2. 구간 합계가 최종 점수와 다르면 오류를 반환한다.
3. 축구 경기 또는 상거래 영수증 요청에는 도구를 선택하지 않는다.

## Claude 연결

Claude Code:

```bash
claude mcp add --transport http boxtier https://boxtier.kr/mcp
```

Claude.ai는 설정의 Connectors에서 같은 URL을 사용자 지정 connector로 등록한다. Claude Messages API는 요청의 `mcp_servers`에 `https://boxtier.kr/mcp`를 전달한다.

## 운영 확인

- `/mcp`가 인증 없이 HTTPS로 연결된다.
- `initialize`, `tools/list`, `tools/call`이 성공한다.
- 도구 응답의 MIME type은 `image/png`다.
- 모든 `POST /mcp` 요청은 인스턴스별 IP 기준 1분 5회로 제한한다.
- 유효한 `create_basketball_receipt` PNG 생성 시도는 원본 IP를 저장하지 않고 salted SHA-256 해시별 최근 24시간 10회로 제한한다.
- `initialize`, `tools/list`, 입력 검증 실패는 일일 생성 횟수에서 제외한다. 렌더링 실패는 유효한 생성 시도이므로 횟수에 포함한다.
- 오류·지연·429 비율을 서버 로그와 WAF에서 확인한다.
- 배포된 production metadata의 Git SHA가 `main`의 배포 대상 SHA와 같다.
