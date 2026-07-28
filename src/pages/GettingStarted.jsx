import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FlaskConical,
  Gauge,
  Play,
  ShieldCheck,
  Swords,
  Trophy,
  UserRoundCheck,
  Users,
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
    lead: "방을 만들고 사람을 초대해 경기를 진행한 뒤, 점수와 개인 기록을 확정해 내 이력과 티어를 관리합니다.",
    image: "/assets/guide/start-home.jpg",
    imageAlt: "홈 화면의 매칭 만들기와 경기 기록하기 버튼",
    caption: "홈에서 예정 경기는 매칭으로, 끝난 경기는 기록으로 시작합니다.",
    steps: [
      {
        title: "방을 만들고 초대합니다",
        body: "예정 경기는 매칭방을 만들고 선수·팀·심판을 초대합니다. 초대받은 사람은 홈 알림이나 방에서 수락합니다.",
        Icon: Swords,
      },
      {
        title: "역할에 따라 진행합니다",
        body: "심판 경기는 배정 심판이 양쪽 점수·개인 스탯·최종 승인을 맡습니다. 무심판 시계 경기는 경기시계 담당자가 양쪽 점수와 시계·샷클락·QR을 맡습니다.",
        Icon: ClipboardCheck,
      },
      {
        title: "기록을 확인하고 확정합니다",
        body: "일반 경기는 심판 또는 방장이 열린 이의를 처리한 뒤 직접 최종 승인합니다. 조건을 충족한 경쟁전만 티어·MMR에 반영됩니다.",
        Icon: Trophy,
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
        body: "공개 범위, 친선·경쟁, 경기 전 구성·현장 픽업, 일정과 정원을 정합니다.",
        Icon: Users,
      },
      {
        title: "선수·팀 초대",
        body: "경기 구성에 맞게 빈 출전·후보 자리에서 선수 또는 상대 팀을 검색해 초대합니다.",
        Icon: Gauge,
      },
      {
        title: "심판 초대",
        body: "방장은 자격 심판을 초대할 수 있습니다. 공개방은 조건을 충족한 심판이 직접 참여할 수도 있습니다.",
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
      ],
      Icon: CheckCircle2,
    },
    actions: [
      { to: "/app/create", label: "매칭 만들기", Icon: Swords, primary: true },
      { to: "/app/recruiting", label: "매칭 보기", Icon: ArrowRight },
    ],
  },
  {
    id: "live",
    navLabel: "진행",
    eyebrow: "03 · LIVE",
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
        body: "후보는 같은 사이드 출전 선수와 본인 교체할 수 있습니다. 배정 심판도 양쪽 교체를 처리할 수 있습니다.",
        Icon: Clock3,
      },
      {
        title: "경기시계",
        body: "출전 선수·후보·심판 중 지정된 담당자가 경기시계·샷클락과 출석 QR을 맡습니다. 양쪽 점수는 심판 경기에서는 배정 심판, 무심판 경기에서는 시계 담당자가 조작합니다.",
        Icon: Gauge,
      },
    ],
    callout: {
      title: "정상 사용 여부는 서버 기록으로 판단합니다",
      body: "경기 시작 처리 후 5분 안에 시계를 시작하고, 정규 예상시간의 70% 이상 실제 진행한 뒤 시계 종료를 남겨야 정상 사용 후보가 됩니다.",
      details: [
        "샷클락은 사용 안 함·24초·30초·60초 중 고르는 선택 기능이며 MMR 검증 기준은 경기시계입니다.",
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
    eyebrow: "04 · RECORDS",
    title: "점수와 개인 기록을 입력하고 함께 확인합니다.",
    lead: "일반 경기는 팀 점수만, 심판 경기와 내 기록은 개인 스탯까지 입력합니다.",
    image: "/assets/guide/records-create.jpg",
    imageAlt: "경기 기록과 내 기록을 선택하는 기록 만들기 화면",
    caption: "함께한 경기 기록과 개인용 내 기록을 목적에 맞게 나눠 시작합니다.",
    steps: [
      {
        title: "기록 담당",
        body: "심판 경기의 개인 스탯은 배정 심판이 입력합니다. 내 기록은 작성자 본인의 개인 스탯만 입력합니다.",
        Icon: ClipboardCheck,
      },
      {
        title: "점수와 개인 기록",
        body: "심판 없는 일반 경기는 팀 점수만 남깁니다. 개인 스탯은 심판 경기 또는 내 기록에서만 남깁니다.",
        Icon: Users,
      },
      {
        title: "출전 선수 확인",
        body: "사후 경기기록은 실제 참가자가 내 참가 확인으로 참가 사실과 입력된 경기 결과를 확인합니다. 문제가 있으면 24시간 안에 신고할 수 있습니다.",
        Icon: ShieldCheck,
      },
      {
        title: "이의와 확정",
        body: "일반 경기는 최소 3분 동안 이의 제출을 보장합니다. 심판 경기는 배정 심판, 무심판 경기는 방장이 최종 승인하며 disputeMinutes 뒤에는 보험성 자동 확정을 시도합니다.",
        Icon: CheckCircle2,
      },
    ],
    callout: {
      title: "경기 기록과 내 기록",
      body: "경기 기록은 함께한 참가자 확인을 거치는 사후 기록방입니다. 내 기록은 승인 없이 빠르게 남기는 개인용 기록입니다.",
      details: [
        "내 기록은 MMR에 반영되지 않습니다. 사후 경기 기록은 확인한 참가자에게만 낮은 개인 MMR 반영률을 적용합니다.",
        "사후 경기 기록은 24시간 동안 내 참가 확인과 문제 신고를 받고, 2/3 이상 확인과 열린 신고 없음 조건을 충족하면 자동 확정됩니다.",
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
    eyebrow: "05 · TIER",
    title: "티어는 확정 기록에서 자동 계산됩니다.",
    lead: "티어를 직접 고르지 않습니다. 조건을 충족한 경쟁전 결과가 모드별 MMR과 통합 MMR에 쌓입니다.",
    image: "/assets/guide/tier-profile.jpg",
    imageAlt: "프로필의 통합 MMR과 모드별 MMR 카드",
    caption: "프로필에서 통합 티어와 1v1·2v2·3v3·5v5 모드별 MMR을 확인합니다.",
    steps: [
      {
        title: "자동 계산",
        body: "저장된 MMR에서 티어가 계산됩니다. 사용자가 직접 올리거나 등급을 선택할 수 없습니다.",
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
        title: "미사용 계수",
        body: "시계를 끄거나 조건을 못 채우면 기존 경기 품질 계수에 1v1 50%·2v2 65%·3v3 80%·5v5 90%를 곱합니다.",
        Icon: Gauge,
      },
    ],
    callout: {
      title: "경기시계를 정상 사용해도 MMR 100%를 보장하지 않습니다",
      body: "정상 사용은 시계 미사용 감산을 피하는 조건입니다. 실제 반영량은 기존 경기 품질, 상대와 팀 구성, 모드별 정책을 함께 적용해 결정합니다.",
      details: [
        "경기시계 도입 전에 시작된 경기에는 시계 감산을 소급 적용하지 않습니다.",
        "통합 MMR과 모드별 MMR은 프로필에서 따로 확인할 수 있습니다.",
      ],
      Icon: ShieldCheck,
    },
    actions: [
      { to: "/app/profile", label: "내 티어 보기", Icon: Trophy, primary: true },
      { to: "/app/rankings", label: "랭킹 보기", Icon: ArrowRight },
    ],
  },
  {
    id: "practice",
    navLabel: "연습",
    eyebrow: "06 · PRACTICE",
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

        {chapter.practicePreview ? (
          <div className="getting-started-practice-preview ui-panel">
            <Badge tone="orange">현재 서비스 화면</Badge>
            <ol>
              <li><strong>CREATE</strong><span>경기 만들기</span></li>
              <li><strong>INVITE</strong><span>초대·출석</span></li>
              <li><strong>PLAY</strong><span>시계·진행</span></li>
              <li><strong>RECORD</strong><span>기록·승인</span></li>
            </ol>
            <p>실제 경기 만들기와 공용 방 모달을 사용하고 저장 통로만 이 페이지의 연습 상태로 분리합니다.</p>
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
