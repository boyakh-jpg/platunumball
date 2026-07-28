export const REFEREE_EXAM_VERSION = "rankball-referee-2026-07";
export const REFEREE_EXAM_SIZE = 30;
export const REFEREE_EXAM_PASS_SCORE = 24;

const BASE_QUESTIONS = [
  {
    category: "time",
    stem: "공격팀이 백코트에서 라이브 볼을 컨트롤했다. 프런트코트로 넘겨야 하는 제한 시간은?",
    choices: ["8초", "5초", "14초", "24초"],
    answerIndex: 0,
    explanation: "백코트에서 팀 컨트롤이 시작되면 8초 안에 프런트코트로 넘어가야 한다.",
  },
  {
    category: "time",
    stem: "프런트코트에서 수비 파울이 선언되고 공격 제한 시간이 13초 남았다. 보통 재개 공격 제한 시간은?",
    choices: ["14초", "13초 유지", "24초", "8초"],
    answerIndex: 0,
    explanation: "프런트코트 수비 파울 후 14초 미만이면 보통 14초로 재설정한다.",
  },
  {
    category: "time",
    stem: "공격 제한 시간이 18초 남았고 수비 파울이 프런트코트에서 났다. 보통 공격 제한 시간은?",
    choices: ["18초 유지", "14초", "24초", "5초"],
    answerIndex: 0,
    explanation: "14초 이상 남아 있으면 남은 공격 제한 시간을 유지한다.",
  },
  {
    category: "time",
    stem: "스로인 선수가 볼을 받은 뒤 스로인을 완료해야 하는 시간은?",
    choices: ["5초", "3초", "8초", "24초"],
    answerIndex: 0,
    explanation: "스로인은 볼을 처분할 수 있게 된 뒤 5초 안에 해야 한다.",
  },
  {
    category: "time",
    stem: "공격 선수가 제한구역 안에 계속 머물 수 있는 기본 제한 시간은?",
    choices: ["3초", "5초", "8초", "14초"],
    answerIndex: 0,
    explanation: "공격팀이 프런트코트에서 볼을 컨트롤할 때 제한구역 3초가 적용된다.",
  },
  {
    category: "time",
    stem: "1m 안에서 밀착 수비를 받으며 볼을 들고 있는 선수가 패스, 슛, 드리블을 해야 하는 제한 시간은?",
    choices: ["5초", "3초", "8초", "14초"],
    answerIndex: 0,
    explanation: "볼을 든 선수가 1m 안에서 적극적인 수비를 받으면 5초 제한이 적용된다.",
  },
  {
    category: "violation",
    stem: "드리블을 끝낸 선수가 다시 드리블을 시작했다. 판정은?",
    choices: ["더블 드리블", "트래블링", "정상 플레이", "킥볼"],
    answerIndex: 0,
    explanation: "드리블 종료 후 다시 드리블하면 더블 드리블이다.",
  },
  {
    category: "violation",
    stem: "선수가 피벗풋을 먼저 들고 패스나 슛 전에 다시 바닥에 댔다. 판정은?",
    choices: ["트래블링", "더블 드리블", "정상 플레이", "백코트"],
    answerIndex: 0,
    explanation: "피벗풋이 규정 밖으로 움직이면 트래블링이다.",
  },
  {
    category: "violation",
    stem: "공격팀이 프런트코트에서 컨트롤하던 볼을 자기 백코트로 되돌려 먼저 터치했다. 판정은?",
    choices: ["백코트 바이얼레이션", "정상 플레이", "헬드볼", "킥볼"],
    answerIndex: 0,
    explanation: "프런트코트 팀 컨트롤 후 백코트로 되돌려 먼저 터치하면 백코트 위반이다.",
  },
  {
    category: "violation",
    stem: "선수가 의도적으로 발이나 다리로 볼을 찼다. 판정은?",
    choices: ["킥볼 바이얼레이션", "개인 파울", "정상 플레이", "테크니컬 파울"],
    answerIndex: 0,
    explanation: "고의로 발이나 다리로 볼을 차거나 막으면 바이얼레이션이다.",
  },
  {
    category: "violation",
    stem: "볼이 림에 닿아 있는 동안 공격 선수가 림을 잡아 볼이 들어가게 했다. 판정은?",
    choices: ["바스켓 인터피어런스", "정상 득점", "헬드볼", "수비 파울"],
    answerIndex: 0,
    explanation: "볼이 림에 닿아 있을 때 림을 잡아 볼의 움직임에 영향을 주면 바스켓 인터피어런스다.",
  },
  {
    category: "violation",
    stem: "수비 선수가 볼 전체가 림보다 높고 하강 중인 득점 가능한 슛을 터치했다. 판정은?",
    choices: ["골텐딩", "블록 성공", "헬드볼", "아웃오브바운드"],
    answerIndex: 0,
    explanation: "볼 전체가 림보다 높고 하강 중이며 들어갈 가능성이 있는 슛을 수비가 터치하면 골텐딩이다.",
  },
  {
    category: "boundary",
    stem: "볼을 가진 선수가 사이드라인을 밟았다. 판정은?",
    choices: ["아웃오브바운드", "정상 플레이", "트래블링", "더블 드리블"],
    answerIndex: 0,
    explanation: "라인은 코트 밖으로 본다.",
  },
  {
    category: "boundary",
    stem: "볼이 라인 위에 떨어졌다. 판정 기준은?",
    choices: ["아웃", "인", "점프볼", "재경기"],
    answerIndex: 0,
    explanation: "경계선은 코트 밖이다.",
  },
  {
    category: "boundary",
    stem: "마지막으로 공격 선수가 터치한 볼이 엔드라인 밖으로 나갔다. 소유권은?",
    choices: ["수비팀 스로인", "공격팀 스로인", "점프볼", "자유투"],
    answerIndex: 0,
    explanation: "마지막 터치의 상대팀이 스로인한다.",
  },
  {
    category: "contact",
    stem: "수비자가 합법적 수비 위치를 잡은 뒤 공격자가 몸통으로 충돌했다. 보통 판정은?",
    choices: ["공격자 파울", "수비자 파울", "노콜", "테크니컬 파울"],
    answerIndex: 0,
    explanation: "수비자가 먼저 합법적 위치를 점유했다면 공격자 충돌로 볼 수 있다.",
  },
  {
    category: "contact",
    stem: "수비자가 옆으로 움직이며 공격자의 진로에 늦게 들어가 충돌했다. 보통 판정은?",
    choices: ["수비자 파울", "공격자 파울", "점프볼", "백코트"],
    answerIndex: 0,
    explanation: "늦은 진로 차단은 블로킹 파울 가능성이 높다.",
  },
  {
    category: "contact",
    stem: "리바운드 위치를 잡기 위해 팔로 상대를 밀어냈다. 판정은?",
    choices: ["푸싱 파울", "정상 박스아웃", "트래블링", "헬드볼"],
    answerIndex: 0,
    explanation: "손이나 팔로 상대를 밀어 이득을 얻으면 푸싱 파울이다.",
  },
  {
    category: "contact",
    stem: "수비자가 손으로 계속 공격자의 움직임을 잡거나 늦췄다. 판정은?",
    choices: ["홀딩 또는 핸드체킹 파울", "정상 수비", "킥볼", "점프볼"],
    answerIndex: 0,
    explanation: "손 사용으로 상대 움직임을 제한하면 파울이다.",
  },
  {
    category: "contact",
    stem: "볼과 무관하게 과격하고 불필요한 접촉이 발생했다. 우선 검토할 판정은?",
    choices: ["언스포츠맨라이크 파울", "일반 바이얼레이션", "정상 플레이", "백코트"],
    answerIndex: 0,
    explanation: "불필요하거나 과격한 접촉은 언스포츠맨라이크 기준을 본다.",
  },
  {
    category: "contact",
    stem: "선수가 심판에게 모욕적 언행을 했다. 판정은?",
    choices: ["테크니컬 파울", "개인 파울", "킥볼", "정상 플레이"],
    answerIndex: 0,
    explanation: "심판, 상대, 경기 운영에 대한 모욕적 행위는 테크니컬 파울 대상이다.",
  },
  {
    category: "free_throw",
    stem: "마지막 자유투가 림에 맞지 않았다. 판정은?",
    choices: ["자유투 바이얼레이션", "정상 리바운드", "득점 인정", "점프볼"],
    answerIndex: 0,
    explanation: "마지막 자유투는 림에 닿아야 라이브 리바운드가 된다.",
  },
  {
    category: "free_throw",
    stem: "리바운드 위치 선수가 자유투 볼이 슈터의 손을 떠나기 전에 제한구역에 들어갔다. 판정 기준은?",
    choices: ["자유투 바이얼레이션", "정상 플레이", "개인 파울", "킥볼"],
    answerIndex: 0,
    explanation: "리바운드 위치 선수는 자유투 볼이 슈터의 손을 떠난 뒤 제한구역에 들어갈 수 있다.",
  },
  {
    category: "free_throw",
    stem: "자유투 선수가 볼을 받은 뒤 제한 시간 안에 슛하지 않았다. 판정은?",
    choices: ["자유투 바이얼레이션", "테크니컬 파울", "점프볼", "정상 플레이"],
    answerIndex: 0,
    explanation: "자유투도 정해진 시간 안에 시도해야 한다.",
  },
  {
    category: "throw_in",
    stem: "스로인 선수가 스로인 지점을 벗어나 큰 폭으로 이동했다. 판정은?",
    choices: ["스로인 바이얼레이션", "정상 플레이", "트래블링", "수비 파울"],
    answerIndex: 0,
    explanation: "지정 스로인 지점에서는 허용 범위 밖 이동이 제한된다.",
  },
  {
    category: "throw_in",
    stem: "수비자가 스로인 라인을 넘어 볼을 방해했다. 판정은?",
    choices: ["경고 또는 테크니컬 검토", "정상 수비", "백코트", "더블 드리블"],
    answerIndex: 0,
    explanation: "스로인 경계선을 넘어 방해하면 경고하고, 같은 팀이 반복하면 테크니컬 파울을 적용할 수 있다.",
  },
  {
    category: "possession",
    stem: "양팀 선수가 동시에 볼을 단단히 잡아 즉시 플레이가 어렵다. 판정은?",
    choices: ["헬드볼", "더블 파울", "트래블링", "아웃오브바운드"],
    answerIndex: 0,
    explanation: "양쪽이 볼 컨트롤을 다투며 플레이가 멈추면 헬드볼이다.",
  },
  {
    category: "possession",
    stem: "헬드볼 이후 소유권 결정에 쓰는 기본 절차는?",
    choices: ["교대 소유권", "항상 홈팀", "항상 수비팀", "자유투"],
    answerIndex: 0,
    explanation: "공식 경기에서는 교대 소유권 절차를 사용한다.",
  },
  {
    category: "score",
    stem: "3점 라인 밖에서 시도한 슛이 성공했다. 득점은?",
    choices: ["3점", "2점", "1점", "무효"],
    answerIndex: 0,
    explanation: "3점 구역에서 시도한 필드골은 3점이다.",
  },
  {
    category: "score",
    stem: "3점 라인을 밟고 슛을 시도해 성공했다. 득점은?",
    choices: ["2점", "3점", "1점", "무효"],
    answerIndex: 0,
    explanation: "라인을 밟으면 3점 구역 밖이 아니므로 2점이다.",
  },
  {
    category: "score",
    stem: "자유투가 성공했다. 득점은?",
    choices: ["1점", "2점", "3점", "무효"],
    answerIndex: 0,
    explanation: "자유투 성공은 1점이다.",
  },
  {
    category: "game_admin",
    stem: "심판은 판정 직후 양팀이 들을 수 있게 가장 먼저 무엇을 해야 하나?",
    choices: ["콜과 재개 방향을 명확히 알린다", "채팅을 확인한다", "기록을 먼저 닫는다", "다음 공격을 임의로 정한다"],
    answerIndex: 0,
    explanation: "콜, 방향, 재개 위치를 명확히 해야 혼란이 줄어든다.",
  },
  {
    category: "game_admin",
    stem: "동시에 두 신호가 충돌했다. 가장 적절한 처리 방식은?",
    choices: ["경기를 멈추고 심판진이 짧게 정리한 뒤 설명한다", "가까운 선수 의견만 따른다", "득점팀 의견을 따른다", "무조건 노콜 처리한다"],
    answerIndex: 0,
    explanation: "충돌 상황은 짧게 정리하고 판정 근거를 설명해야 한다.",
  },
  {
    category: "game_admin",
    stem: "선수가 부상 위험을 호소했다. 심판의 우선순위는?",
    choices: ["안전 확인과 경기 중단", "공격 제한 시간 유지", "채팅 기록", "득점 인정"],
    answerIndex: 0,
    explanation: "부상과 안전은 경기 진행보다 우선한다.",
  },
  {
    category: "rankball",
    stem: "BOXTIER 정규전에서 경기 시작 전 출석체크가 필요한 이유는?",
    choices: ["실제 참가자와 MMR 반영 대상을 확정하기 위해", "채팅 수를 늘리기 위해", "코트 즐겨찾기를 위해", "팀명을 바꾸기 위해"],
    answerIndex: 0,
    explanation: "출석체크는 실제 참가자 확정과 부도 패널티 판단 기준이다.",
  },
  {
    category: "rankball",
    stem: "BOXTIER에서 심판이 있는 경기의 개인 활약 입력 권한 원칙은?",
    choices: ["심판 우선", "방장 우선", "아무 선수나 가능", "상대팀 주장만 가능"],
    answerIndex: 0,
    explanation: "심판이 배정된 경기는 심판 기록이 우선이다.",
  },
  {
    category: "rankball",
    stem: "경기 종료 후 기록 입력은 빠르게 끝내야 한다. 기본 의도는?",
    choices: ["현장에서 기억이 정확할 때 확정하기 위해", "다음날 수정하게 하기 위해", "채팅을 숨기기 위해", "MMR을 무시하기 위해"],
    answerIndex: 0,
    explanation: "기록은 현장성이 높을수록 신뢰도가 높다.",
  },
  {
    category: "rankball",
    stem: "이의신청 단계에서 채팅창을 열어두는 이유는?",
    choices: ["판정/기록 조정 근거를 남기기 위해", "잡담을 늘리기 위해", "방을 홍보하기 위해", "초대장을 다시 보내기 위해"],
    answerIndex: 0,
    explanation: "이의신청은 근거와 합의 과정이 남아야 한다.",
  },
  {
    category: "rankball",
    stem: "후보 선수가 경기시계 담당자로 지정됐을 때 가능한 조작은?",
    choices: ["시간과 샷클락을 서버 상태와 맞춰 조작한다", "심판 경기의 점수를 임의로 올린다", "개인 스탯을 입력한다", "최종 승인을 대신한다"],
    answerIndex: 0,
    explanation: "심판 경기의 경기시계 담당자는 시간과 샷클락만 조작한다.",
  },
  {
    category: "rankball",
    stem: "BOXTIER 심판 경기에서 개인 기록을 입력할 수 있는 사람은?",
    choices: ["배정 심판만", "경기시계 담당자", "방장", "모든 출전 선수"],
    answerIndex: 0,
    explanation: "심판 경기의 개인 기록은 배정 심판만 입력한다.",
  },
  {
    category: "rankball",
    stem: "BOXTIER 무심판 일반 경기의 개인 기록 원칙은?",
    choices: ["개인 기록을 생성하지 않는다", "방장이 전원 기록한다", "각자 기록한다", "경기시계 담당자가 기록한다"],
    answerIndex: 0,
    explanation: "무심판 일반 경기는 팀 점수만 저장하고 개인 기록을 생성하지 않는다.",
  },
  {
    category: "rankball",
    stem: "경기 결과에 열린 이의가 남아 있을 때 최종 확정은?",
    choices: ["이의를 처리할 때까지 불가", "방장이 즉시 가능", "과반 동의로 가능", "시간이 지나면 즉시 가능"],
    answerIndex: 0,
    explanation: "열린 이의가 하나라도 있으면 최종 승인과 자동 확정을 모두 보류한다.",
  },
  {
    category: "rankball",
    stem: "정규전에서 경기 후 임의로 참가자를 추가하면 MMR 반영은 어떻게 보는 게 안전한가?",
    choices: ["추가 참가자는 기록만 남기고 MMR에서는 제외한다", "처음부터 뛴 선수와 동일하게 반영한다", "상대팀만 반영한다", "무조건 경기 무효다"],
    answerIndex: 0,
    explanation: "경기 후 추가한 선수는 기록 대상에는 넣을 수 있지만 MMR에서는 제외한다.",
  },
  {
    category: "rankball",
    stem: "길농 코트가 사용 중이라 시작이 늦어졌다. 방장이 해야 할 가장 적절한 액션은?",
    choices: ["경기 시작 버튼을 실제 시작 시점에 누른다", "예정 시간에 무조건 시작 처리한다", "방을 삭제한다", "모든 선수를 강퇴한다"],
    answerIndex: 0,
    explanation: "실제 시작 시점 기준으로 진행해야 기록과 시간 관리가 맞다.",
  },
  {
    category: "rankball",
    stem: "출석하지 않은 선수를 강퇴해야 하는 상황에서 중요한 것은?",
    choices: ["미도착 사유와 시점을 남긴다", "아무 사유 없이 반복 강퇴한다", "상대 선수만 강퇴한다", "기록방에서 처리한다"],
    answerIndex: 0,
    explanation: "강퇴는 신뢰도와 분쟁에 연결되므로 근거가 필요하다.",
  },
  {
    category: "rankball",
    stem: "심판 따봉/평가를 경기 후 받는 이유는?",
    choices: ["심판 신뢰도와 배정 품질을 관리하기 위해", "팀 MMR을 바로 올리기 위해", "경기 시간을 늘리기 위해", "초대장을 자동 수락하기 위해"],
    answerIndex: 0,
    explanation: "심판 평가는 다음 배정과 신뢰도 판단에 쓴다.",
  },
  {
    category: "mechanics",
    stem: "심판이 가장 좋은 위치를 잡는 기본 목적은?",
    choices: ["접촉, 발, 라인을 동시에 보기 위해", "가장 가까운 관중 옆에 서기 위해", "항상 골대 뒤에 있기 위해", "기록지만 보기 위해"],
    answerIndex: 0,
    explanation: "좋은 각도는 접촉과 라인 판정을 안정적으로 만든다.",
  },
  {
    category: "mechanics",
    stem: "파울 콜 후 손신호가 필요한 이유는?",
    choices: ["선수와 경기 운영자가 같은 판정을 이해하게 하기 위해", "경기를 지연하기 위해", "공격권을 숨기기 위해", "팀을 응원하기 위해"],
    answerIndex: 0,
    explanation: "명확한 신호는 경기 운영과 기록 정확도를 높인다.",
  },
  {
    category: "mechanics",
    stem: "논쟁이 커질 때 심판이 피해야 할 행동은?",
    choices: ["감정적으로 맞대응한다", "짧게 판정 근거를 설명한다", "안전거리를 확보한다", "필요하면 경고한다"],
    answerIndex: 0,
    explanation: "감정적 맞대응은 분쟁을 키운다.",
  },
  {
    category: "mechanics",
    stem: "판정이 애매하지만 명확한 근거가 없다. 좋은 운영은?",
    choices: ["본 위치와 확실한 사실 기준으로 판정한다", "유명한 선수 말을 따른다", "방장 말을 무조건 따른다", "소리를 크게 낸 쪽을 따른다"],
    answerIndex: 0,
    explanation: "심판은 본 것과 확실한 사실 기준으로 판정해야 한다.",
  },
  {
    category: "safety",
    stem: "고의적 위험 접촉이 반복되는 선수에게 필요한 조치는?",
    choices: ["경고 후 강한 파울 또는 퇴장성 판단", "계속 노콜", "상대팀에만 주의", "점수만 차감"],
    answerIndex: 0,
    explanation: "반복 위험 접촉은 경기 안전을 위해 강하게 관리해야 한다.",
  },
  {
    category: "safety",
    stem: "야외 코트 바닥이 젖어 미끄럽다. 심판/방장이 우선 확인할 것은?",
    choices: ["경기 진행 가능 안전성", "팀 엠블럼", "채팅 알림", "개인 티어"],
    answerIndex: 0,
    explanation: "길농은 코트 상태가 안전과 직결된다.",
  },
  {
    category: "safety",
    stem: "어린 참가자와 성인 참가자가 섞인 경기에서 특히 필요한 것은?",
    choices: ["접촉 강도와 안전 관리", "3점만 인정", "득점 기록 금지", "팀명 숨김"],
    answerIndex: 0,
    explanation: "연령 차이가 있으면 접촉 강도와 안전을 더 엄격히 봐야 한다.",
  },
  {
    category: "ethics",
    stem: "심판이 한 팀 소속 선수와 가까운 관계라면 어떻게 해야 하나?",
    choices: ["가능하면 사전 공개하고 배정 회피를 검토한다", "숨기고 진행한다", "그 팀에 유리하게 본다", "상대팀만 경고한다"],
    answerIndex: 0,
    explanation: "이해충돌은 신뢰도에 직접 영향을 준다.",
  },
  {
    category: "ethics",
    stem: "심판이 직접 확인하지 못한 개인 스탯을 선수 요청만으로 입력해 달라고 한다. 적절한 답은?",
    choices: ["확인 가능한 것만 입력한다", "요청대로 모두 입력한다", "상대팀 스탯을 깎는다", "경기 결과를 취소한다"],
    answerIndex: 0,
    explanation: "기록은 확인 가능해야 한다.",
  },
  {
    category: "ethics",
    stem: "심판이 판정 실수를 인지했다. 다음 데드볼 전에 바로잡을 수 있는 상황이면?",
    choices: ["절차에 맞게 정정하고 설명한다", "무조건 숨긴다", "다음 경기에서 보상한다", "점수를 임의로 준다"],
    answerIndex: 0,
    explanation: "정정 가능한 실수는 절차에 맞게 바로잡는 편이 낫다.",
  },
  {
    category: "ethics",
    stem: "심판이 경기 중 특정 선수에게 조롱성 발언을 했다. 판단은?",
    choices: ["심판 신뢰도 하락 사유", "좋은 경기 운영", "득점 보너스", "정상 기록"],
    answerIndex: 0,
    explanation: "심판은 중립성과 존중을 유지해야 한다.",
  },
  {
    category: "signal",
    stem: "득점 인정 여부가 혼란스러울 때 먼저 해야 할 일은?",
    choices: ["득점 여부와 점수를 명확히 선언한다", "바로 다음 공격을 시작한다", "관중에게 투표시킨다", "기록을 비운다"],
    answerIndex: 0,
    explanation: "득점과 점수 선언이 선행되어야 혼선이 줄어든다.",
  },
  {
    category: "signal",
    stem: "파울과 바이얼레이션이 거의 동시에 보였다. 일반적으로 먼저 판단할 것은?",
    choices: ["어느 위반이 먼저 발생했는지", "어느 팀이 유명한지", "점수가 높은 팀인지", "채팅 반응"],
    answerIndex: 0,
    explanation: "발생 순서와 원인이 중요하다.",
  },
  {
    category: "signal",
    stem: "경기 재개 전 양팀이 서로 다른 공격권을 주장한다. 심판이 확인할 것은?",
    choices: ["마지막 터치, 콜, 재개 위치", "선수 인기", "팀 색상", "관중 수"],
    answerIndex: 0,
    explanation: "공격권은 마지막 터치와 판정 근거로 정한다.",
  },
  {
    category: "signal",
    stem: "심판 콜이 늦었지만 명확한 파울을 봤다. 가장 나은 처리 방식은?",
    choices: ["즉시 휘슬 후 간단히 근거를 알린다", "늦었으니 무조건 취소한다", "상대에게 선택권을 준다", "득점으로 대체한다"],
    answerIndex: 0,
    explanation: "늦은 콜도 명확하면 즉시 정리해야 한다.",
  },
  {
    category: "signal",
    stem: "경기 중 기록판 점수가 선수 기억과 다르다. 우선 순서는?",
    choices: ["기록, 득점 상황, 양팀 확인을 맞춘다", "한쪽 주장만 따른다", "점수를 0:0으로 돌린다", "경기를 즉시 종료한다"],
    answerIndex: 0,
    explanation: "점수 분쟁은 기록과 상황 확인이 필요하다.",
  },
  {
    category: "rankball",
    stem: "BOXTIER에서 이의신청이 너무 복잡해지는 것을 막는 기본 방향은?",
    choices: ["짧은 시간 안에 단일 이의 중심으로 처리한다", "무제한 수정하게 한다", "모든 채팅을 삭제한다", "권한 검증을 생략한다"],
    answerIndex: 0,
    explanation: "현장 경기에서는 빠르고 단순한 분쟁 처리가 필요하다.",
  },
];

function rotateChoices(question, shift) {
  const choices = question.choices.map((choice, index) => ({ choice, correct: index === question.answerIndex }));
  const offset = shift % choices.length;
  const rotated = [...choices.slice(offset), ...choices.slice(0, offset)];
  return {
    choices: rotated.map((item) => item.choice),
    answerIndex: rotated.findIndex((item) => item.correct),
  };
}

const REFEREE_EXAM_BANK = Array.from({ length: 600 }, (_, index) => {
  const base = BASE_QUESTIONS[index % BASE_QUESTIONS.length];
  const round = Math.floor(index / BASE_QUESTIONS.length) + 1;
  const rotated = rotateChoices(base, round + index);
  return {
    id: `ref-${String(index + 1).padStart(3, "0")}`,
    category: base.category,
    stem: round === 1 ? base.stem : `${base.stem} [상황 ${round}]`,
    choices: rotated.choices,
    answerIndex: rotated.answerIndex,
    explanation: base.explanation,
  };
});
export const REFEREE_EXAM_BANK_SIZE = REFEREE_EXAM_BANK.length;
const REFEREE_EXAM_BANK_BY_ID = new Map(REFEREE_EXAM_BANK.map((question) => [question.id, question]));

function hashSeed(seed = "") {
  return Array.from(String(seed)).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

function seededRandom(seed) {
  let value = Math.abs(hashSeed(seed)) || 1;
  return () => {
    value = (value * 48271) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function buildRefereeExamSet(seed = Date.now(), count = REFEREE_EXAM_SIZE) {
  const random = seededRandom(seed);
  return [...REFEREE_EXAM_BANK]
    .map((question) => ({ question, sort: random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, count)
    .map((item, index) => ({ ...item.question, number: index + 1 }));
}

function toPublicQuestion(question) {
  const { answerIndex, explanation, ...publicQuestion } = question;
  return publicQuestion;
}

export function getRefereeExamSet(seed = Date.now(), count = REFEREE_EXAM_SIZE) {
  return buildRefereeExamSet(seed, count).map(toPublicQuestion);
}

export function createRefereeExamSet(seed = Date.now(), count = REFEREE_EXAM_SIZE) {
  const questions = buildRefereeExamSet(seed, count);
  return {
    questionIds: questions.map((question) => question.id),
    questions: questions.map(toPublicQuestion),
  };
}

export function gradeRefereeExam(seed = Date.now(), answers = {}, count = REFEREE_EXAM_SIZE) {
  const questions = Array.isArray(seed) ? seed : buildRefereeExamSet(seed, count);
  const reviewed = questions.map((question) => {
    const selectedIndex = Number(answers[question.id]);
    return {
      id: question.id,
      selectedIndex: Number.isInteger(selectedIndex) ? selectedIndex : -1,
      answerIndex: question.answerIndex,
      explanation: question.explanation,
      correct: selectedIndex === question.answerIndex,
    };
  });
  const score = reviewed.filter((item) => item.correct).length;
  return {
    score,
    total: questions.length,
    passed: score >= REFEREE_EXAM_PASS_SCORE,
    reviewed,
    reviewedById: Object.fromEntries(reviewed.map((item) => [item.id, item])),
  };
}

export function gradeRefereeExamByQuestionIds(questionIds = [], answers = {}) {
  const questions = questionIds
    .map((questionId) => REFEREE_EXAM_BANK_BY_ID.get(questionId))
    .filter(Boolean);
  return gradeRefereeExam(questions, answers, questions.length);
}
