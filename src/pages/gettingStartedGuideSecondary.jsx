import {
  ArrowRight,
  Bell,
  BookOpenCheck,
  ClipboardCheck,
  Clock3,
  Gauge,
  Play,
  Settings,
  ShieldCheck,
  Swords,
  Trophy,
  UserRoundCheck,
  Users,
  UsersRound,
} from "lucide-react";

export const GUIDE_CHAPTERS_SECONDARY = [
  {
    id: "tournaments",
    navLabel: "대회",
    eyebrow: "09 · TOURNAMENTS",
    title: "대회는 일반 경기보다 엄격하게 운영됩니다.",
    lead: "팀 초대, 참가 명단, 일정, 중립 심판, 대진과 경기 결과를 대회 단위로 잠그고 관리합니다.",
    image: "/assets/guide/tournaments.jpg?v=20260728-guide-r2",
    imageAlt: "일정 메뉴의 비공개 대회 목록과 대진표 버튼",
    caption: "일정에서 참가 대회를 찾고 대진표·일정·승인 상태를 한곳에서 확인합니다.",
    steps: [
      {
        title: "대회 생성과 승인",
        body: "토너먼트·리그 형식, 기간, 구장과 참가팀을 정합니다. 운영 대회는 지역 승인과 필수 심판 조건을 충족해야 개최할 수 있습니다.",
        Icon: Trophy,
      },
      {
        title: "팀 초대와 명단",
        body: "팀 초대는 알림에서 확인하고, 참가팀은 경기별 출전 명단을 제출합니다. 명단 제출 뒤에는 해당 경기 일정과 로스터가 잠깁니다.",
        Icon: UsersRound,
      },
      {
        title: "일정과 중립 심판",
        body: "경기 일정은 명단 제출 전 한 번만 수정할 수 있습니다. 필요한 수의 승인 심판을 배정하고 소속·동시간대 중복을 검사합니다.",
        Icon: Clock3,
      },
      {
        title: "대회 경기 권한",
        body: "배정 심판만 점수·개인 스탯·본인 스탯 이의 판정·최종 승인을 수행합니다. 대회 방장이나 팀장은 심판 권한을 대신하지 않습니다.",
        Icon: ShieldCheck,
      },
    ],
    callout: {
      title: "대회는 무심판 경기로 전환하지 않습니다",
      body: "배정 심판이 불참하거나 자격·중립성·일정 조건을 잃으면 경기를 그대로 진행하지 않고 운영자가 심판 배정을 해결해야 합니다.",
      details: [
        "대회 참가자는 자기 개인 스탯에 대해서만 이의를 제출합니다.",
        "배정 심판만 대회 이의를 처리하고 결과를 최종 승인합니다.",
        "공식 대회·학교·협회 규정이 있으면 BOXTIER 일반 룰보다 해당 규정이 우선합니다.",
      ],
      Icon: ShieldCheck,
    },
    actions: [
      { to: "/app/matches?panel=tournament", label: "대회 보기", Icon: Trophy, primary: true },
      { to: "/app/referee-rulebook", label: "심판 룰북", Icon: ArrowRight },
    ],
  },
  {
    id: "profile",
    navLabel: "프로필",
    eyebrow: "10 · PROFILE",
    title: "내 프로필과 기록 공개 범위를 관리합니다.",
    lead: "나 메뉴에서 프로필, 공식 출전 기록, 직접 만든 내 기록과 공개 범위를 구분해 관리합니다.",
    image: "/assets/guide/profile.jpg?v=20260728-guide-r2",
    imageAlt: "프로필 아이콘과 배치 진행 상태, 개인정보 입력 영역",
    caption: "나 메뉴에서 프로필·소속·배치 상태를 확인하고 공식 기록과 내 기록을 구분합니다.",
    steps: [
      {
        title: "프로필과 업적",
        body: "포지션·지역·소속과 프로필 아이콘을 관리하고, 달성한 업적 아이콘을 선택합니다. 공개 프로필 링크와 공유 카드는 핵심 정보만 보여줍니다.",
        Icon: UserRoundCheck,
      },
      {
        title: "기록과 공개 범위",
        body: "나 메뉴에서 실제 출전 공식 기록과 본인이 만든 내 기록을 분리해 봅니다. 지역 랭킹·팀 이력·통계 요약과 내 기록 공개 여부를 설정할 수 있습니다.",
        Icon: ClipboardCheck,
      },
      {
        title: "내 기록 공개",
        body: "본인이 만든 내 기록은 공식 전적과 분리해 표시하고 기록별 공개·비공개를 선택합니다. 공개 기록도 공식 MMR과 업적에는 반영하지 않습니다.",
        Icon: ShieldCheck,
      },
      {
        title: "즐겨찾기",
        body: "선수·팀·구장·심판을 저장하고 설정의 즐겨찾기 화면에서 종류별로 다시 찾습니다.",
        Icon: Users,
      },
    ],
    callout: {
      title: "팀 히스토리와 내 히스토리는 기준이 다릅니다",
      body: "팀 히스토리는 소속팀의 경기를 보여주지만 홈·나 메뉴는 본인이 실제 출전한 경기만 개인 기록으로 집계합니다.",
      details: [
        "QR 출석이나 지각 후보 등록만 하고 실제 교체하지 않은 경기는 개인 출전 기록이 아닙니다.",
        "통합·개인전·팀전·내 기록 필터는 같은 실제 출전 기준을 사용합니다.",
        "비공개 내 기록은 작성자에게만 보이고 공개 내 기록은 다른 사용자도 볼 수 있습니다.",
      ],
      Icon: ShieldCheck,
    },
    actions: [
      { to: "/app/profile", label: "나 메뉴 보기", Icon: UserRoundCheck, primary: true },
      { to: "/app/settings/favorites", label: "즐겨찾기 보기", Icon: ArrowRight },
    ],
  },
  {
    id: "settings",
    navLabel: "설정",
    eyebrow: "11 · SETTINGS",
    title: "알림·안전·화면 설정을 관리합니다.",
    lead: "앱과 Discord 알림, 차단, 신고, 테마와 홈 안내 표시를 한곳에서 관리합니다.",
    image: "/assets/guide/settings.jpg?v=20260728-guide-r2",
    imageAlt: "세부 설정, 화면 테마, 신고 접수 영역이 보이는 설정 화면",
    caption: "설정에서 즐겨찾기·구장·심판 메뉴와 테마·Discord·신고·차단을 관리합니다.",
    steps: [
      {
        title: "알림과 Discord",
        body: "받은 경기·팀 초대, 출석·참가 확인·이의·확정 알림을 앱에서 처리합니다. Discord를 연결하면 선택한 경기 알림을 같은 원본으로 받을 수 있습니다.",
        Icon: Bell,
      },
      {
        title: "차단",
        body: "차단한 사용자의 검색·추천·초대 노출을 줄이고 설정에서 해제합니다. 이미 성립한 경기의 운영 기록은 임의로 지우지 않습니다.",
        Icon: ShieldCheck,
      },
      {
        title: "신고",
        body: "선수·경기·팀·구장 문제를 실제 관계와 사유에 맞게 검색해 신고합니다. 처리 전 같은 대상의 중복 신고는 기존 접수로 연결합니다.",
        Icon: ClipboardCheck,
      },
      {
        title: "화면 설정",
        body: "다크·라이트 테마와 홈 안내 카드 표시를 저장합니다. 홈 카드를 숨겨도 설정과 사용 설명에서 다시 열 수 있습니다.",
        Icon: Settings,
      },
    ],
    callout: {
      title: "검색 결과와 실제 제출 대상을 함께 확인합니다",
      body: "신고 검색어를 바꾸면 이전에 선택한 대상은 초기화됩니다. 화면에 보이는 이름과 선택한 대상을 다시 확인합니다.",
      details: [
        "최종 승인 전 결과 문제는 이의신청, 승인 뒤 문제는 경기 신고를 사용합니다.",
        "구장 위치 오류·운영 위험·중복은 각각 다른 구조화 신고로 접수합니다.",
        "경기 출석 알림과 QR 출석 상태는 같은 경기 정보를 기준으로 표시됩니다.",
      ],
      Icon: ShieldCheck,
    },
    actions: [
      { to: "/app/settings", label: "설정 보기", Icon: Settings, primary: true },
    ],
  },
  {
    id: "terms",
    navLabel: "용어",
    eyebrow: "12 · TERMS",
    title: "자주 쓰는 말만 간단히 정리합니다.",
    lead: "비슷해 보이는 경기 구성, 역할, 기록 용어를 실제 권한과 반영 기준에 맞춰 구분합니다.",
    image: "/assets/guide/terms.jpg?v=20260728-guide-r2",
    imageAlt: "MMR, 팀과 사이드, 경기 역할을 나눠 설명하는 용어 화면",
    caption: "MMR·티어, 팀·파티·사이드, 방장·주장·심판처럼 헷갈리는 말을 역할별로 확인합니다.",
    steps: [
      {
        title: "MMR·티어·배정 전",
        body: "MMR은 실력이 비슷한 상대를 찾고 순위를 계산하는 경기력 점수입니다. 확정된 경쟁 경기 결과로 바뀝니다. 티어는 MMR 구간을 이름으로 보여주는 등급이고, 첫 경쟁전 5경기 전에는 배정 전으로 표시합니다.",
        Icon: Trophy,
      },
      {
        title: "팀·팀 파티·사이드",
        body: "팀은 경기 밖에서도 유지되는 소속입니다. 팀 파티는 그 팀 선수들이 한 경기에 같이 신청한 임시 묶음이고, A팀·B팀은 이번 경기에서만 나뉜 두 편입니다.",
        Icon: UsersRound,
      },
      {
        title: "팀장·주장·방장",
        body: "팀장은 팀 자체를 관리합니다. 주장은 이번 경기에서 자기 편의 명단을 관리하고, 방장은 방을 만든 사람으로 방 설정과 경기 운영의 정해진 단계만 맡습니다.",
        Icon: UserRoundCheck,
      },
      {
        title: "모바일 전광판 담당자·심판",
        body: "모바일 전광판 담당자는 현장에서 경기시계·샷클락을 맡으며 무심판 경기에서는 양쪽 점수도 조작합니다. 배정 심판은 심판 경기의 양쪽 점수·개인 기록·교체·이의·최종 승인을 맡습니다.",
        Icon: Gauge,
      },
    ],
    callout: {
      title: "경기 구성과 기록 이름",
      body: "개인전은 선수가 개인으로 참가하고, 팀전은 등록팀이 A팀·B팀을 이룹니다. 픽업은 개인 참가자를 현장에서 두 편으로 나누는 방식입니다.",
      details: [
        "출전은 현재 코트에 들어간 선수, 후보는 같은 편에서 교체를 기다리는 선수, 용병은 팀의 정규멤버가 아닌 등록 선수입니다.",
        "경기 확정은 모집 명단을 실제 경기방으로 넘기는 단계이고, 최종 승인은 점수·이의 처리가 끝난 결과를 공식 전적과 MMR에 반영하는 단계입니다.",
        "이의신청은 최종 승인 전에 점수나 기록 수정을 요청하는 절차입니다. 승인 뒤 문제는 경기 신고를 사용합니다.",
        "현장 일반 경기는 방을 만들어 실제 코트에서 진행한 경기입니다. 경기 후 함께 확인하는 기록은 끝난 경기를 참가자들이 함께 등록하는 방식이고, 내 기록은 내가 직접 작성하며 공식 전적·MMR과 분리됩니다.",
      ],
      Icon: BookOpenCheck,
    },
    actions: [
      { to: "/app/guide?chapter=matching", label: "매칭 흐름 보기", Icon: Swords, primary: true },
      { to: "/app/guide?chapter=records", label: "기록 구분 보기", Icon: ArrowRight },
    ],
  },
  {
    id: "practice",
    navLabel: "연습",
    eyebrow: "13 · PRACTICE",
    title: "초대부터 기록 확정까지 직접 해봅니다.",
    lead: "연습 선수를 초대하고, 심판·모바일 전광판 담당자·선수 화면을 바꿔 전체 흐름을 연습합니다.",
    practicePreview: true,
    steps: [
      {
        title: "방 만들기",
        body: "3v3 연습방을 설정합니다. 비공개 연습방으로 진행하며 경기 방식과 시계 규칙은 바꿔볼 수 있습니다.",
        Icon: Swords,
      },
      {
        title: "초대 수락과 출석",
        body: "빈 슬롯에서 연습 선수를 직접 초대하고 보조 버튼으로 상대의 수락을 받은 뒤 출석을 처리합니다.",
        Icon: Users,
      },
      {
        title: "심판·모바일 전광판 화면",
        body: "심판의 점수·개인 기록 권한과 무심판 모바일 전광판 담당자의 점수·경기시계·샷클락·QR 권한을 역할 화면에서 확인합니다.",
        Icon: Clock3,
      },
      {
        title: "기록 입력과 확정",
        body: "점수·개인 기록을 입력하고 이의 판정 뒤 심판 또는 방장의 최종 승인까지 확인합니다.",
        Icon: ClipboardCheck,
      },
    ],
    callout: {
      title: "연습 결과는 어디에도 남지 않습니다",
      body: "로그인 프로필은 표시 이름만 복제하고 모든 참가자를 격리된 연습용 선수로 만듭니다. 실제 전적, MMR, 신뢰점수, 알림, 디스코드에는 기록하지 않으며 새로고침하거나 페이지를 나가면 초기화됩니다.",
      details: [
        "시작 버튼이 막히면 초대 응답, 출석, 선택한 방식에 필요한 팀 배정 확정이 끝났는지 확인하세요.",
        "심판 경기 점수판은 배정 심판만, 무심판 경기 점수판은 지정된 모바일 전광판 담당자만 조작할 수 있습니다.",
      ],
      Icon: ShieldCheck,
    },
    actions: [
      { to: "/app/guide/practice", label: "연습 경기 열기", Icon: Play, primary: true },
      { to: "/app/guide?chapter=matching", label: "매칭 설명 다시 보기", Icon: ArrowRight },
    ],
  },
];
