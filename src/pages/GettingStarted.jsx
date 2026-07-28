import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FlaskConical,
  Gauge,
  MapPin,
  Play,
  QrCode,
  Settings,
  ShieldCheck,
  Swords,
  Trophy,
  UserRoundCheck,
  Users,
  UsersRound,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { isHomeGuideCardVisible } from "../data/settingsMappers.js";
import { assetUrl } from "../lib/assets.js";

const GUIDE_CHAPTERS = [
  {
    id: "start",
    navLabel: "시작",
    eyebrow: "01 · START",
    title: "BOXTIER는 농구 기록 웹입니다.",
    lead: "홈에서 할 일을 확인하고, 방을 만들거나 참가해 경기를 진행한 뒤 내 전적·팀·티어를 관리합니다.",
    image: "/assets/guide/start-home.jpg",
    imageAlt: "홈 화면의 매칭 만들기와 경기 기록하기 버튼",
    caption: "홈에서 예정 경기는 매칭으로, 끝난 경기는 기록으로 시작합니다.",
    steps: [
      {
        title: "방을 만들고 초대합니다",
        body: "예정 경기는 매칭방을 만들고 선수·팀·심판을 초대합니다. 끝난 경기는 경기 기록 또는 내 기록으로 남길 수 있습니다.",
        Icon: Swords,
      },
      {
        title: "홈에서 할 일을 확인합니다",
        body: "받은 초대, 출석, 참가 확인, 이의 처리처럼 지금 해야 할 일이 홈 액션 큐에 먼저 표시됩니다. 예정 경기와 최근 실제 출전 기록도 함께 확인합니다.",
        Icon: Bell,
      },
      {
        title: "역할에 맞게 경기와 기록을 끝냅니다",
        body: "심판·방장·경기시계 담당자·선수의 권한은 분리됩니다. 열린 이의를 처리하고 별도 최종 승인을 마친 확정 경기만 공식 전적이 됩니다.",
        Icon: Trophy,
      },
      {
        title: "내 기록과 팀 이력을 나눠 봅니다",
        body: "홈과 나 메뉴는 내가 실제 출전한 개인전·팀전을 보여줍니다. 팀 히스토리는 내가 뛰지 않은 소속팀 경기까지 포함할 수 있습니다.",
        Icon: ClipboardCheck,
      },
    ],
    callout: {
      title: "필수 웹 기능은 평생 무료",
      body: "경기 모집·참가, 기본 경기시계, 기록 입력·확정 기록 열람, 티어 조회 같은 필수 웹 기능은 서비스 운영 기간 동안 이용료를 받지 않습니다.",
      details: [
        "구장비·심판비·기록비·장비비·통신비는 무료 범위에서 제외됩니다.",
        "현재 알파 테스트 중이므로 중요한 경기 전에는 방의 규칙·명단·역할을 다시 확인하세요.",
      ],
      Icon: ShieldCheck,
    },
    actions: [
      { to: "/app/guide/practice", label: "연습 경기 시작", Icon: FlaskConical, primary: true },
      { to: "/app/create?intent=record", label: "경기 기록하기", Icon: ClipboardCheck },
    ],
  },
  {
    id: "matching",
    navLabel: "매칭",
    eyebrow: "02 · MATCHING",
    title: "방을 만들고 사람을 초대합니다.",
    lead: "경기 방식과 정원을 정한 뒤 선수·팀·심판을 초대하고, 수락 상태와 자리를 확인합니다.",
    image: "/assets/guide/matching-create.jpg",
    imageAlt: "방 만들기 기본 설정의 공개 범위와 경기 방식 선택 화면",
    caption: "공개 범위, 경기 목적, 팀 구성, 일정과 인원을 한 화면에서 정합니다.",
    steps: [
      {
        title: "방 설정",
        body: "공개·비공개, 친선·경쟁, 경기 전 구성·현장 픽업, 즉시·예약, 1v1·2v2·3v3·5v5, 출전·후보 정원과 MMR 범위를 정합니다.",
        Icon: Users,
      },
      {
        title: "선수·팀 초대",
        body: "경기 구성에 맞게 빈 출전·후보 자리에서 선수 또는 상대 팀을 검색해 초대합니다.",
        Icon: Gauge,
      },
      {
        title: "심판 초대",
        body: "방장은 자격 심판을 초대할 수 있습니다. 공개방은 조건을 충족한 심판이 직접 참여할 수 있고, 비공개방은 초대된 대상만 들어옵니다.",
        Icon: Swords,
      },
      {
        title: "초대 수락과 현장 출석",
        body: "초대받은 사람은 홈 액션 큐 또는 방에서 수락합니다. QR 출석은 경기시계를 사용하는 일반 공개 매칭방에서만 선택할 수 있습니다.",
        Icon: Clock3,
      },
    ],
    callout: {
      title: "초대 수락과 현장 출석은 다릅니다",
      body: "현장 픽업은 체크인한 선수만 배치안에 넣습니다. 배정 심판 또는 방장이 A/B와 대기를 최종 확정해야 경기를 시작할 수 있습니다.",
      details: [
        "초대 수락은 출석이 아닙니다. 현장에서 출석한 선수만 경기 명단에 배치합니다.",
        "QR 토큰은 5분마다 바뀌며 경기 10분 전부터 로그인한 사전 등록 선수의 출석만 확인합니다.",
        "시작 후 QR은 경기 전에 등록됐지만 미출석 처리된 선수를 원래 사이드 후보로 등록할 뿐, 출전·팀 배치를 자동 확정하지 않습니다.",
        "픽업방은 모집 중 A/B를 정하지 않습니다. 체크인 뒤 참석자만 직접·랜덤·MMR 균형 방식으로 나누고 배정 확정 후 시작합니다.",
      ],
      Icon: CheckCircle2,
    },
    actions: [
      { to: "/app/create", label: "매칭 만들기", Icon: Swords, primary: true },
      { to: "/app/recruiting", label: "매칭 보기", Icon: ArrowRight },
    ],
  },
  {
    id: "attendance",
    navLabel: "출석",
    eyebrow: "03 · ATTENDANCE",
    title: "QR 출석과 실제 출전은 다릅니다.",
    lead: "초대 수락, 현장 출석, 지각 후보 등록, 실제 교체 출전을 순서대로 확인합니다.",
    image: "/assets/guide/attendance-qr.png?v=20260728-attendance-r1",
    imageAlt: "QR 출석 코드와 A/B 사이드별 출석 상태가 함께 표시된 출석판",
    caption: "방장·배정 심판은 출석판을 확인하고, 선수는 현장에서 QR을 스캔합니다.",
    steps: [
      {
        title: "QR 적용 경기 확인",
        body: "QR 출석은 경기시계를 사용하는 일반 공개 매칭의 선택 기능입니다. 공개 경쟁전은 기본 사용하고, 공개 친선전은 방을 만들 때 선택합니다.",
        Icon: ShieldCheck,
      },
      {
        title: "경기 전 QR 출석",
        body: "경기 10분 전부터 경기시계 담당자 화면의 QR을 로그인한 사전 등록 선수가 스캔합니다. QR은 경기와 5분 구간에 묶인 서버 서명값입니다.",
        Icon: QrCode,
      },
      {
        title: "미출석과 지각 QR",
        body: "경기 시작 시 미출석 선수를 확정합니다. 진행 중에는 그 선수만 지각 QR로 원래 사이드 후보에 등록할 수 있으며 새 선수를 추가하지 않습니다.",
        Icon: Clock3,
      },
      {
        title: "실제 교체 출전",
        body: "지각 QR은 후보 등록까지만 처리합니다. 후보 본인의 자진 교체 또는 배정 심판의 교체가 실제로 기록돼야 출전시간·개인 전적·MMR 출전자로 계산합니다.",
        Icon: UserRoundCheck,
      },
    ],
    callout: {
      title: "출석판은 서버 상태로 자동 갱신합니다",
      body: "체크인 참가자 표는 3초, 경기 전 QR 패널은 15초, 경기시계와 지각 QR은 3초 간격으로 서버 상태를 다시 확인합니다. 수동 새로고침도 같은 서버 원본을 읽습니다.",
      details: [
        "초대 수락만으로 현장 출석이 되지 않고, 경기 전 QR 출석만으로 출전·후보 자리를 바꾸지 않습니다.",
        "만료된 QR, 다른 경기의 QR, 서명이 잘못된 QR, 미등록 사용자 스캔은 거부합니다.",
        "경기 시작 때 미출석 처리된 사전 등록 선수만 지각 QR을 사용할 수 있습니다.",
        "지각 QR 뒤 실제 교체하지 않으면 팀 히스토리에는 경기 자체가 보여도 홈·나 메뉴의 개인 출전 기록에는 포함되지 않습니다.",
      ],
      Icon: CheckCircle2,
    },
    actions: [
      { to: "/app/matches", label: "내 일정 확인", Icon: QrCode, primary: true },
      { to: "/app/guide?chapter=live", label: "경기 진행 보기", Icon: ArrowRight },
    ],
  },
  {
    id: "live",
    navLabel: "진행",
    eyebrow: "04 · LIVE",
    title: "심판·경기시계 담당자·선수가 역할을 나눕니다.",
    lead: "심판 유무와 경기시계 사용 여부에 따라 점수·기록·최종 승인 권한이 분리됩니다.",
    image: "/assets/guide/live-clock.jpg?v=20260725-clock-hierarchy-r2",
    imageAlt: "A/B 점수판과 30초 샷클락이 함께 열린 가로형 BOXTIER 경기시계",
    caption: "지정된 담당자 화면에서 A/B 점수와 경기시간을 조작하고 샷클락을 초기화합니다.",
    steps: [
      {
        title: "심판이 있는 경기",
        body: "배정 심판이 출석, 경기 시작, 양쪽 기록, 경기 종료와 결과 제출을 맡습니다.",
        Icon: Play,
      },
      {
        title: "심판이 없는 경기",
        body: "방장이 출석·시작·종료·최종 승인을 맡습니다. 시계를 쓰면 담당자가 양쪽 점수와 시계·샷클락·QR을 맡고, 시계를 쓰지 않으면 방장이 양쪽 점수를 맡습니다.",
        Icon: UserRoundCheck,
      },
      {
        title: "후보 교체",
        body: "후보는 같은 사이드 출전 선수와 본인 교체할 수 있습니다. 배정 심판도 양쪽 교체를 처리할 수 있지만 무심판 방장·파티장·다른 선수는 타인을 교체할 수 없습니다.",
        Icon: Clock3,
      },
      {
        title: "경기시계",
        body: "출전 선수·후보·심판 중 지정된 담당자가 경기시계·샷클락과 출석 QR을 맡습니다. 양쪽 점수는 심판 경기에서는 배정 심판, 무심판 경기에서는 시계 담당자가 조작합니다. 담당 기기에 연결된 워치·비오디오 미디어 리모컨으로도 샷클락을 초기화할 수 있습니다.",
        Icon: Gauge,
      },
    ],
    callout: {
      title: "정상 사용 여부는 서버 기록으로 판단합니다",
      body: "경기 시작 처리 후 5분 안에 시계를 시작하고, 정규 예상시간의 70% 이상 실제 진행한 뒤 시계 종료를 남겨야 정상 사용 후보가 됩니다.",
      details: [
        "샷클락은 사용 안 함·24초·30초·60초 중 고르는 선택 기능이며 MMR 검증 기준은 경기시계입니다.",
        "휴대폰·태블릿의 블루투스 설정에서 워치 또는 비오디오 미디어 리모컨을 먼저 연결합니다. 현재 경기시계 담당자가 라이브 시계 화면을 한 번 터치한 뒤 리모컨의 재생 또는 일시정지를 누르면 설정한 샷클락 시간으로 초기화됩니다.",
        "별도 연결 버튼이나 기기 목록은 없습니다. 휴식·종료·읽기 전용 화면에서는 동작하지 않으며, 이어폰·헤드셋은 부저 소리를 가져갈 수 있어 지원 기기로 안내하지 않습니다.",
        "담당자는 출전 선수·후보·배정 심판 중 현장에서 정하고 넘길 수 있습니다. 넘긴 뒤 이전 담당자 화면은 읽기 전용이 됩니다.",
        "지각 QR만 찍고 후보에서 실제 교체하지 않은 선수는 개인 전적과 MMR 출전자로 계산하지 않습니다.",
        "구간 시간이 0이어도 바로 끝내지 않아 연장할 수 있습니다. 실제 시계 시작 90분 뒤에는 사후 기록 단계로 전환됩니다.",
        "전체화면·화면 유지·미디어 부저는 기기별 베타이며 브라우저 제한이 적용될 수 있습니다.",
      ],
      Icon: ShieldCheck,
    },
    actions: [
      { to: "/app/recorder", label: "플레이 보기", Icon: Play, primary: true },
      { to: "/app/create", label: "방 만들기", Icon: ArrowRight },
    ],
  },
  {
    id: "records",
    navLabel: "기록",
    eyebrow: "05 · RECORDS",
    title: "기록 유형과 확인 절차를 구분합니다.",
    lead: "일반 live 경기, 함께 만든 사후 경기기록, 본인이 작성한 내 기록은 권한·확정·MMR 규칙이 서로 다릅니다.",
    image: "/assets/guide/records-create.jpg",
    imageAlt: "경기 기록과 내 기록을 선택하는 기록 만들기 화면",
    caption: "함께한 경기 기록과 개인용 내 기록을 목적에 맞게 나눠 시작합니다.",
    steps: [
      {
        title: "일반 live 경기",
        body: "심판 경기는 심판이 점수·개인 스탯·이의·최종 승인을 맡습니다. 무심판 경기는 팀 점수만 저장하고 방장이 이의와 최종 승인을 맡습니다.",
        Icon: ClipboardCheck,
      },
      {
        title: "사후 경기기록",
        body: "함께한 경기를 나중에 만들며 개인 스탯은 생성하지 않습니다. 실제 참가자 2/3 이상이 24시간 안에 내 참가 확인을 해야 확정 조건을 충족합니다.",
        Icon: Users,
      },
      {
        title: "내 기록",
        body: "작성자가 자기 점수와 개인 스탯을 저장합니다. 공개·비공개를 고를 수 있지만 공식 전적·업적·MMR과는 별도로 집계됩니다.",
        Icon: ShieldCheck,
      },
      {
        title: "내 기록 메뉴",
        body: "통합은 실제 출전한 개인전과 팀전의 합계입니다. 개인전·팀전·내 기록 필터로 통계, 날짜별 기록, 최근 6개월과 장기 보관 기록을 같은 기준으로 나눕니다.",
        Icon: CheckCircle2,
      },
    ],
    callout: {
      title: "경기 기록과 내 기록",
      body: "경기 기록은 함께한 참가자 확인을 거치는 사후 기록방입니다. 내 기록은 승인 없이 빠르게 남기는 개인용 기록입니다.",
      details: [
        "사후 경기 기록은 확인한 참가자의 개인 MMR만 1v1 10%·2v2 20%·3v3 35%·5v5 50% 반영하고 팀 MMR은 반영하지 않습니다. 내 기록은 MMR에 반영되지 않습니다.",
        "사후 경기 기록은 참가자 2/3 이상이 내 참가 확인을 해야 하며, 24시간 뒤 기준 충족과 열린 신고 없음이 확인되면 자동 확정됩니다.",
        "실제 시간이 겹치는 다른 공식 경기가 있으면 live 시작·결과 확정·MMR 반영 또는 사후 기록 확정을 막습니다.",
        "최종 승인 뒤에는 새 이의신청을 받지 않습니다. 이후 문제는 경기 신고로 접수합니다.",
        "일반 경쟁전은 별도 방 흐름에서 결과 확정 조건을 충족해야 MMR 반영 대상이 됩니다.",
      ],
      Icon: BookOpenCheck,
    },
    actions: [
      { to: "/app/create?intent=record", label: "경기 기록", Icon: ClipboardCheck, primary: true },
      { to: "/app/recorder", label: "기록 보기", Icon: ArrowRight },
    ],
  },
  {
    id: "tier",
    navLabel: "티어",
    eyebrow: "06 · TIER",
    title: "티어는 확정 기록에서 자동 계산됩니다.",
    lead: "티어를 직접 고르지 않습니다. 조건을 충족한 경쟁전 결과가 모드별 MMR과 통합 MMR에 쌓입니다.",
    image: "/assets/guide/tier-profile.jpg",
    imageAlt: "프로필의 통합 MMR과 모드별 MMR 카드",
    caption: "프로필에서 통합 티어와 1v1·2v2·3v3·5v5 모드별 MMR을 확인합니다.",
    steps: [
      {
        title: "자동 계산",
        body: "저장된 MMR에서 티어가 계산됩니다. 첫 확정 경쟁전 5경기 동안은 배정 전으로 표시하고, 승패·상대·같은 팀 구성을 반영해 브론즈부터 다이아몬드 사이에 배치합니다.",
        Icon: Trophy,
      },
      {
        title: "반영 대상",
        body: "확정된 경쟁전만 기본 대상입니다. 현장 픽업도 경쟁전과 검증 조건을 선택하면 반영되며, 친선전·사후 경기 기록·내 기록은 기록만 남습니다.",
        Icon: CheckCircle2,
      },
      {
        title: "시계 검증",
        body: "5분 안 시작, 명시적 시계 종료, 예상 정규시간의 70% 이상 실제 진행을 모두 확인합니다.",
        Icon: Clock3,
      },
      {
        title: "개인·팀 MMR",
        body: "개인은 통합과 1v1·2v2·3v3·5v5 MMR을 나눠 봅니다. 팀 MMR은 주장·정규멤버 상위 5명 평균과 팀 성과 보정으로 계산하며 용병은 기준 평균에서 제외합니다.",
        Icon: Gauge,
      },
    ],
    callout: {
      title: "경기시계를 정상 사용해도 MMR 100%를 보장하지 않습니다",
      body: "정상 사용은 시계 미사용 감산을 피하는 조건입니다. 실제 반영량은 기존 경기 품질, 상대와 팀 구성, 모드별 정책을 함께 적용해 결정합니다.",
      details: [
        "경기시계 도입 전에 시작된 경기에는 시계 감산을 소급 적용하지 않습니다.",
        "통합 MMR과 모드별 MMR은 프로필에서 따로 확인할 수 있습니다.",
        "랭크보드는 내 지역 개인·팀 순위와 전국 순위를 나누고, 시즌 허브는 개인 승격권·팀 승격권·라이벌 매치업을 보여줍니다.",
      ],
      Icon: ShieldCheck,
    },
    actions: [
      { to: "/app/profile", label: "내 티어 보기", Icon: Trophy, primary: true },
      { to: "/app/rankings", label: "랭킹 보기", Icon: ArrowRight },
    ],
  },
  {
    id: "teams",
    navLabel: "팀",
    eyebrow: "07 · TEAMS",
    title: "팀 소속과 경기 역할은 구분됩니다.",
    lead: "팀장은 팀 자체를 관리하고, 실제 경기에서는 방장과 사이드장이 방의 명단과 진행 역할을 맡습니다.",
    previewItems: [
      { label: "MY TEAM", title: "내 팀 관리" },
      { label: "ROSTER", title: "주장·정규·용병" },
      { label: "DISCOVER", title: "주변·라이벌·소속" },
      { label: "HISTORY", title: "팀 경기 이력" },
    ],
    steps: [
      {
        title: "내 팀과 대표팀",
        body: "여러 팀에 소속될 수 있고 대표팀을 따로 정할 수 있습니다. 팀장은 가입·역할·팀 정보·엠블럼·홈코트를 관리합니다.",
        Icon: UsersRound,
      },
      {
        title: "팀전 만들기",
        body: "팀전은 팀장만 만드는 기능이 아닙니다. 일반 팀원도 소속팀을 선택해 방을 만들 수 있고, 경기에서는 각 사이드장이 출전·후보 명단을 운영합니다.",
        Icon: Swords,
      },
      {
        title: "팀 찾기",
        body: "내 팀을 먼저 보여주고 주변 팀, 비슷한 연령대·MMR의 라이벌 팀, 같은 소속 팀을 각각 최대 5개 추천합니다. 전체 팀은 검색할 때만 조회합니다.",
        Icon: Gauge,
      },
      {
        title: "팀 전적과 개인 전적",
        body: "팀 히스토리는 팀이 출전한 경기를 기준으로 합니다. 내가 후보로만 남았거나 뛰지 않은 경기는 팀 이력에는 보여도 홈·나 메뉴 개인 전적에는 포함되지 않습니다.",
        Icon: Trophy,
      },
    ],
    callout: {
      title: "팀 파티와 개인 픽업을 섞지 않습니다",
      body: "사전 구성 팀전은 선택한 팀의 한 묶음으로 참가합니다. 픽업방은 모든 참가자를 개인으로 받고 체크인 뒤 A/B를 정합니다.",
      details: [
        "팀전 엔트리는 경기방에서 파티 나가기로 분리하지 않습니다.",
        "팀 MMR 변동은 실제 MMR 반영 출전자 중 주장·정규멤버 비율만큼 적용합니다.",
        "전원이 용병이면 개인 경기 결과는 남아도 팀 성과 보정은 0%입니다.",
      ],
      Icon: ShieldCheck,
    },
    actions: [
      { to: "/app/teams", label: "내 팀 보기", Icon: UsersRound, primary: true },
      { to: "/app/create", label: "팀전 만들기", Icon: ArrowRight },
    ],
  },
  {
    id: "courts",
    navLabel: "구장",
    eyebrow: "08 · COURTS",
    title: "승인 구장을 찾고 현장 정보를 보완합니다.",
    lead: "구장 프로필에서 위치·시설·리뷰를 확인하고, 새 구장이나 잘못된 정보를 구조화해 제보할 수 있습니다.",
    previewItems: [
      { label: "SEARCH", title: "승인 구장 찾기" },
      { label: "PROFILE", title: "시설·지도·리뷰" },
      { label: "REQUEST", title: "새 구장 신청" },
      { label: "REPORT", title: "정보 수정 신고" },
    ],
    steps: [
      {
        title: "구장 검색과 즐겨찾기",
        body: "팀 홈코트와 경기 구장은 같은 승인 구장 검색기를 사용합니다. 관심 구장은 즐겨찾기에 넣어 홈과 설정에서 빠르게 확인합니다.",
        Icon: MapPin,
      },
      {
        title: "구장 프로필",
        body: "공식 주소·지도 위치, 코트 형태, 바닥, 조명, 유료 여부와 경기 참가자 리뷰를 확인합니다. 저장 좌표가 있으면 지도는 그 위치를 우선합니다.",
        Icon: Gauge,
      },
      {
        title: "새 구장 신청",
        body: "주소를 검색한 뒤 실제 시설명과 세부 위치·시설 정보를 입력합니다. 주변 승인·대기 구장을 먼저 비교해 중복 신청을 줄입니다.",
        Icon: ClipboardCheck,
      },
      {
        title: "수정·중복 신고",
        body: "승인 구장의 위치 오류·운영 상태·중복·기타 문제를 구장 프로필이나 설정에서 신고합니다. 같은 미처리 대상의 중복 신고는 기존 접수로 연결됩니다.",
        Icon: ShieldCheck,
      },
    ],
    callout: {
      title: "구장 정보와 경기 예약은 다릅니다",
      body: "서비스의 승인 구장 정보는 시설 탐색용입니다. 실제 사용 가능 시간, 예약, 비용과 현장 규칙은 방 메모와 시설 운영자 안내를 다시 확인해야 합니다.",
      details: [
        "유료 구장은 방 생성 시 비용 근거와 정산 방식을 명확히 입력합니다.",
        "위험하거나 폐쇄된 시설은 리뷰보다 구장 상태 신고를 먼저 사용합니다.",
        "관리자는 실제 중복 구장 두 개를 모두 유효하게 두지 않고 하나를 정정·무효 처리합니다.",
      ],
      Icon: ShieldCheck,
    },
    actions: [
      { to: "/app/settings/courts", label: "구장 신청", Icon: MapPin, primary: true },
      { to: "/app/settings/favorites", label: "즐겨찾기 보기", Icon: ArrowRight },
    ],
  },
  {
    id: "tournaments",
    navLabel: "대회",
    eyebrow: "09 · TOURNAMENTS",
    title: "대회는 일반 경기보다 엄격하게 운영됩니다.",
    lead: "팀 초대, 참가 명단, 일정, 중립 심판, 대진과 경기 결과를 대회 단위로 잠그고 관리합니다.",
    previewItems: [
      { label: "TEAMS", title: "참가팀 초대" },
      { label: "SCHEDULE", title: "일정·구장" },
      { label: "REFEREE", title: "중립 심판" },
      { label: "BRACKET", title: "대진·결과" },
    ],
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
    previewItems: [
      { label: "PROFILE", title: "아이콘·소속·포지션" },
      { label: "RECORDS", title: "통합·개인·팀·내 기록" },
      { label: "PRIVACY", title: "공개·비공개 범위" },
      { label: "FAVORITE", title: "선수·팀·구장 저장" },
    ],
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
    previewItems: [
      { label: "NOTICE", title: "앱·Discord 알림" },
      { label: "REPORT", title: "선수·경기·팀·구장 신고" },
      { label: "SAFETY", title: "차단 사용자 관리" },
      { label: "DISPLAY", title: "테마·홈 안내 표시" },
    ],
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
      body: "신고 검색어를 바꾸면 이전에 선택한 대상은 초기화됩니다. 화면에 보이는 이름과 서버에 제출되는 대상을 다시 확인합니다.",
      details: [
        "최종 승인 전 결과 문제는 이의신청, 승인 뒤 문제는 경기 신고를 사용합니다.",
        "구장 위치 오류·운영 위험·중복은 각각 다른 구조화 신고로 접수합니다.",
        "경기 출석 알림과 QR 출석 상태는 서버의 같은 경기 원본을 사용합니다.",
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
    previewItems: [
      { label: "MMR", title: "실력 지표·티어" },
      { label: "ROOM", title: "팀·파티·사이드" },
      { label: "ROLE", title: "방장·담당자·심판" },
      { label: "RECORD", title: "확정·이의·기록" },
    ],
    steps: [
      {
        title: "MMR·티어·배정 전",
        body: "MMR은 확정된 경쟁 경기 결과로 바뀌는 매칭·랭킹용 점수입니다. 티어는 MMR 구간을 나타내는 등급이고, 경쟁전 5경기를 마치기 전에는 배정 전으로 표시합니다.",
        Icon: Trophy,
      },
      {
        title: "팀·팀 파티·사이드",
        body: "팀은 경기 밖에서도 유지되는 소속입니다. 팀 파티는 그 팀 선수가 특정 팀전에 함께 들어온 참가 묶음이고, A/B 사이드는 이번 경기에서 맞붙는 두 편입니다.",
        Icon: UsersRound,
      },
      {
        title: "팀장·사이드장·방장",
        body: "팀장은 팀 자체를 관리합니다. 사이드장은 이번 경기의 자기 사이드 명단을 관리하고, 방장은 방을 만든 사람으로 방 설정과 경기 운영의 정해진 단계만 맡습니다.",
        Icon: UserRoundCheck,
      },
      {
        title: "경기시계 담당자·심판",
        body: "경기시계 담당자는 현장에서 시계·샷클락을 맡으며 무심판 시계 경기에서는 양쪽 점수도 조작합니다. 배정 심판은 심판 경기의 양쪽 점수·개인 기록·교체·이의·최종 승인을 맡습니다.",
        Icon: Gauge,
      },
    ],
    callout: {
      title: "경기 구성과 기록 이름",
      body: "개인전은 선수가 개인으로 참가하고, 팀전은 등록팀이 A/B를 이룹니다. 픽업은 개인 참가자를 현장에서 두 사이드로 나누는 방식입니다.",
      details: [
        "출전은 현재 코트에 들어간 선수, 후보는 같은 사이드에서 교체를 기다리는 선수, 용병은 팀의 정규멤버가 아닌 등록 선수입니다.",
        "경기 확정은 모집 명단을 실제 경기방으로 넘기는 단계이고, 최종 승인은 점수·이의 처리가 끝난 결과를 공식 전적과 MMR에 반영하는 단계입니다.",
        "이의신청은 최종 승인 전에 점수나 기록 수정을 요청하는 절차입니다. 승인 뒤 문제는 경기 신고를 사용합니다.",
        "일반 live 경기는 현장에서 운영한 경기, `match_record`는 끝난 경기를 함께 등록하는 경기 기록, `personal_record`는 본인이 작성하며 공식 전적·MMR과 분리되는 내 기록입니다.",
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
    lead: "실제 공용 방에서 연습 선수를 초대하고, 심판·경기시계 담당자·선수 화면을 바꿔 전체 흐름을 시험합니다.",
    practicePreview: true,
    steps: [
      {
        title: "방 만들기",
        body: "실제 경기 만들기 모듈에서 3v3 연습방을 설정합니다. 비공개·비저장만 고정하고 경기 방식과 시계 규칙은 바꿔볼 수 있습니다.",
        Icon: Swords,
      },
      {
        title: "초대 수락과 출석",
        body: "빈 슬롯에서 연습 선수를 직접 초대하고 보조 버튼으로 상대의 수락을 받은 뒤 출석을 처리합니다.",
        Icon: Users,
      },
      {
        title: "심판·경기시계 화면",
        body: "심판의 점수·개인 기록 권한과 무심판 경기시계 담당자의 점수·시계·샷클락·QR 권한을 역할 화면에서 확인합니다.",
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
        "심판 경기 점수판은 배정 심판만, 무심판 시계 경기 점수판은 지정된 경기시계 담당자만 조작할 수 있습니다.",
      ],
      Icon: ShieldCheck,
    },
    actions: [
      { to: "/app/guide/practice", label: "연습 경기 열기", Icon: Play, primary: true },
      { to: "/app/guide?chapter=matching", label: "매칭 설명 다시 보기", Icon: ArrowRight },
    ],
  },
];

const GUIDE_CHAPTER_IDS = GUIDE_CHAPTERS.map((chapter) => chapter.id);

export default function GettingStarted({ app }) {
  const [searchParams] = useSearchParams();
  const [homeGuideCardSavePending, setHomeGuideCardSavePending] = useState(false);
  const [homeGuideCardSaveStatus, setHomeGuideCardSaveStatus] = useState("");
  const chapterTitleRef = useRef(null);
  const requestedChapterId = searchParams.get("chapter") ?? GUIDE_CHAPTER_IDS[0];
  const requestedChapterIndex = GUIDE_CHAPTER_IDS.indexOf(requestedChapterId);
  const activeIndex = requestedChapterIndex >= 0 ? requestedChapterIndex : 0;
  const chapter = GUIDE_CHAPTERS[activeIndex];
  const previousChapterIdRef = useRef(chapter.id);
  const previousChapter = GUIDE_CHAPTERS[activeIndex - 1] ?? null;
  const nextChapter = GUIDE_CHAPTERS[activeIndex + 1] ?? null;
  const CalloutIcon = chapter.callout.Icon;
  const homeGuideCardVisible = isHomeGuideCardVisible(app.state.settings);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    if (previousChapterIdRef.current !== chapter.id) {
      chapterTitleRef.current?.focus({ preventScroll: true });
    }
    previousChapterIdRef.current = chapter.id;
  }, [chapter.id]);

  const toggleHomeGuideCard = async () => {
    if (homeGuideCardSavePending) return;
    setHomeGuideCardSavePending(true);
    setHomeGuideCardSaveStatus("저장 중");
    try {
      const saved = await app.actions.updateSettings({
        showHomeGuideCard: !homeGuideCardVisible,
      });
      setHomeGuideCardSaveStatus(saved && saved.ok !== false
        ? "설정과 함께 저장되었습니다."
        : "표시 설정을 저장하지 못했습니다.");
    } catch {
      setHomeGuideCardSaveStatus("표시 설정을 저장하지 못했습니다.");
    } finally {
      setHomeGuideCardSavePending(false);
    }
  };

  return (
    <div className="getting-started-page">
      <div className="getting-started-topbar">
        <Button
          as={Link}
          variant="secondary"
          size="sm"
          to="/app"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          홈으로
        </Button>
        <span>ALPHA GUIDE · {GUIDE_CHAPTERS.length}단계</span>
      </div>

      <nav className="getting-started-chapter-nav ui-panel" aria-label="사용 설명 목차">
        {GUIDE_CHAPTERS.map((item, index) => (
          <Link
            key={item.id}
            className={item.id === chapter.id ? "is-active" : ""}
            to={`?chapter=${item.id}`}
            aria-current={item.id === chapter.id ? "page" : undefined}
          >
            <span aria-hidden="true">{index + 1}</span>
            {item.navLabel}
          </Link>
        ))}
      </nav>

      <Card as="article" className="getting-started-chapter">
        <header className="getting-started-chapter__copy">
          <Badge tone="orange">{activeIndex + 1} / {GUIDE_CHAPTERS.length}</Badge>
          <p className="eyebrow">{chapter.eyebrow}</p>
          <h1 ref={chapterTitleRef} tabIndex={-1}>{chapter.title}</h1>
          <p>{chapter.lead}</p>
          <div className="ui-action-row">
            {chapter.actions.map((action) => {
              const ActionIcon = action.Icon;
              return (
                <Link
                  key={action.to}
                  className={`button ui-button button-${action.primary ? "primary" : "secondary"} ui-button-${action.primary ? "primary" : "secondary"} button-md ui-button-md`}
                  to={action.to}
                >
                  {action.primary ? <ActionIcon size={18} aria-hidden="true" /> : null}
                  {action.label}
                  {!action.primary ? <ActionIcon size={18} aria-hidden="true" /> : null}
                </Link>
              );
            })}
          </div>
        </header>

        {chapter.practicePreview || chapter.previewItems ? (
          <div className="getting-started-practice-preview ui-panel">
            <Badge tone="orange">현재 서비스 화면</Badge>
            <ol>
              {(chapter.previewItems ?? [
                { label: "CREATE", title: "경기 만들기" },
                { label: "INVITE", title: "초대·출석" },
                { label: "PLAY", title: "시계·진행" },
                { label: "RECORD", title: "기록·승인" },
              ]).map((item) => (
                <li key={item.label}><strong>{item.label}</strong><span>{item.title}</span></li>
              ))}
            </ol>
            <p>{chapter.practicePreview
              ? "실제 경기 만들기와 공용 방 모달을 사용하고 저장 통로만 이 페이지의 연습 상태로 분리합니다."
              : `${chapter.navLabel} 메뉴에서 위 기능을 현재 계정 권한에 맞게 확인할 수 있습니다.`}</p>
          </div>
        ) : (
          <figure className="getting-started-shot">
            <img
              src={assetUrl(chapter.image)}
              alt={chapter.imageAlt}
              loading="eager"
              decoding="async"
            />
            <figcaption>{chapter.caption}</figcaption>
          </figure>
        )}
      </Card>

      <section className="getting-started-section" aria-labelledby="getting-started-steps-title">
        <div className="getting-started-section__head">
          <div>
            <p className="eyebrow">HOW IT WORKS</p>
            <h2 id="getting-started-steps-title">{chapter.navLabel} 흐름</h2>
          </div>
          <span>{activeIndex + 1} / {GUIDE_CHAPTERS.length}</span>
        </div>
        <ol className="getting-started-steps">
          {chapter.steps.map(({ title, body, Icon }, index) => (
            <li className="getting-started-step ui-panel" key={title}>
              <div>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <Icon size={21} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <Card as="aside" className="getting-started-callout">
        <span className="getting-started-callout__icon">
          <CalloutIcon size={25} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">CHECK POINT</p>
          <h2>{chapter.callout.title}</h2>
          <p>{chapter.callout.body}</p>
          <ul>
            {chapter.callout.details.map((detail) => <li key={detail}>{detail}</li>)}
          </ul>
          {chapter.id === "start" ? <Link to="/terms#terms-fees">무료 범위 보기</Link> : null}
        </div>
      </Card>

      {chapter.id === "practice" ? (
        <section className="getting-started-home-guide-setting ui-panel" aria-labelledby="home-guide-setting-title">
          <div>
            <p className="eyebrow">HOME GUIDE</p>
            <h2 id="home-guide-setting-title">홈 안내 카드</h2>
            <p>설정의 홈 안내 카드와 같은 값입니다. 숨겨도 사용 설명과 연습 경기는 계속 이용할 수 있습니다.</p>
            <small role="status">{homeGuideCardSaveStatus || "선택 즉시 설정에 저장됩니다."}</small>
          </div>
          <Button
            type="button"
            variant="secondary"
            aria-pressed={!homeGuideCardVisible}
            disabled={homeGuideCardSavePending}
            onClick={() => void toggleHomeGuideCard()}
          >
            {homeGuideCardVisible ? "홈에서 사용 설명 안 보기" : "홈에 사용 설명 다시 표시"}
          </Button>
        </section>
      ) : null}

      <nav className="getting-started-pager" aria-label="사용 설명 이전 다음">
        {previousChapter ? (
          <Button
            as={Link}
            variant="secondary"
            size="sm"
            to={`?chapter=${previousChapter.id}`}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            이전
          </Button>
        ) : <span />}
        <span>{chapter.navLabel} · {activeIndex + 1}/{GUIDE_CHAPTERS.length}</span>
        {nextChapter ? (
          <Button
            as={Link}
            size="sm"
            to={`?chapter=${nextChapter.id}`}
          >
            다음
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        ) : (
          <Button
            as={Link}
            size="sm"
            to="/app"
          >
            완료
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        )}
      </nav>
    </div>
  );
}
