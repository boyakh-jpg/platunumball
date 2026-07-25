import { useEffect, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
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
import Card from "../components/common/Card.jsx";
import { assetUrl } from "../lib/assets.js";

const GUIDE_CHAPTERS = [
  {
    id: "start",
    navLabel: "시작",
    eyebrow: "01 · START",
    title: "BOXTIER는 농구 기록 웹입니다.",
    lead: "매칭에서 끝나지 않고 실제 경기, 기록 확인, 티어까지 하나로 연결합니다.",
    image: "/assets/guide/start-home.jpg",
    imageAlt: "홈 화면의 매칭 만들기와 경기 기록하기 버튼",
    caption: "홈에서 예정 경기는 매칭으로, 끝난 경기는 기록으로 시작합니다.",
    steps: [
      {
        title: "경기를 시작합니다",
        body: "예정 경기는 매칭을 만들거나 참가합니다. 끝난 경기는 경기 기록으로 바로 시작합니다.",
        Icon: Swords,
      },
      {
        title: "기록을 남깁니다",
        body: "점수와 개인 기록을 입력합니다. 경기 종류에 맞는 확인 절차를 거쳐 저장합니다.",
        Icon: ClipboardCheck,
      },
      {
        title: "내 이력이 됩니다",
        body: "확정 기록은 프로필에 쌓입니다. 반영 조건을 충족한 경쟁전만 티어·MMR에 연결됩니다.",
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
      { to: "/app/create?intent=record", label: "경기 기록하기", Icon: ClipboardCheck, primary: true },
      { to: "/app/recruiting", label: "매칭 보기", Icon: ArrowRight },
    ],
  },
  {
    id: "matching",
    navLabel: "매칭",
    eyebrow: "02 · MATCHING",
    title: "방 만들기에서 경기 방식이 결정됩니다.",
    lead: "누가 보고, 어떤 목적으로, 언제, 몇 명이 경기할지 먼저 정합니다.",
    image: "/assets/guide/matching-create.jpg",
    imageAlt: "방 만들기 기본 설정의 공개 범위와 경기 방식 선택 화면",
    caption: "공개 범위, 경기 목적, 팀 구성, 일정과 인원을 한 화면에서 정합니다.",
    steps: [
      {
        title: "공개 범위",
        body: "공개방은 매칭 목록에서 모집하고, 비공개방은 초대받은 인원 중심으로 운영합니다.",
        Icon: Users,
      },
      {
        title: "경기 목적",
        body: "친선전은 기록만 남고, 경쟁전은 결과 확정 뒤 MMR 반영 대상이 됩니다.",
        Icon: Gauge,
      },
      {
        title: "팀 구성",
        body: "경기 전 구성을 고르거나, 현장 픽업으로 참가자 풀을 만든 뒤 체크인에서 A/B를 정합니다.",
        Icon: Swords,
      },
      {
        title: "일정과 정원",
        body: "즉시·일정 지정과 1v1·2v2·3v3·5v5를 고릅니다. 현장 픽업은 개인 참가만, 경기 전 구성은 개인·팀 참가를 지원합니다.",
        Icon: Clock3,
      },
    ],
    callout: {
      title: "현장 픽업은 현재 친선전으로 운영합니다",
      body: "체크인한 선수만 배치안에 들어갑니다. 배정 심판이 있으면 심판이, 없으면 방장이 A/B와 대기를 확인하고 최종 확정해야 경기를 시작할 수 있습니다.",
      details: [
        "시스템이 확정 없이 팀을 바꾸거나 교대를 실행하지 않습니다.",
        "모집 중에는 A/B가 아니라 참가자 풀과 전체 정원만 표시합니다.",
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
    title: "경기시계는 현장을 보조합니다.",
    lead: "시계 담당자는 시간만 운용하고, 점수는 심판·기록원이 확정한 기록을 읽어옵니다.",
    image: "/assets/guide/live-clock.jpg?v=20260725-responsive-clock",
    imageAlt: "가로형 BOXTIER 경기시계와 샷클락 화면",
    caption: "경기시간을 크게 보고, 샷클락은 설정했을 때만 큰 타일로 초기화합니다.",
    steps: [
      {
        title: "경기 시작",
        body: "배정 심판이 있으면 심판, 없으면 방장이 방에서 경기 시작을 처리합니다.",
        Icon: Play,
      },
      {
        title: "시계 담당",
        body: "기본 담당은 출전 선수입니다. 담당을 넘기면 이전 기기는 즉시 읽기 전용이 됩니다.",
        Icon: UserRoundCheck,
      },
      {
        title: "시간 운용",
        body: "시작·정지·재개·구간 종료·연장·담당 이전을 서버시간으로 기록합니다.",
        Icon: Clock3,
      },
      {
        title: "샷클락",
        body: "사용 안 함·30초·35초·60초 중 고릅니다. MMR 판단 기준은 샷클락이 아니라 경기시계입니다.",
        Icon: Gauge,
      },
    ],
    callout: {
      title: "정상 사용 여부는 서버 기록으로 판단합니다",
      body: "경기 시작 처리 후 5분 안에 시계를 시작하고, 정규 예상시간의 70% 이상 실제 진행한 뒤 시계 종료를 남겨야 정상 사용 후보가 됩니다.",
      details: [
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
    title: "기록마다 확정 방식이 다릅니다.",
    lead: "일반 경기와 끝난 경기를 나중에 입력하는 사후 기록은 확인 절차가 서로 다릅니다.",
    image: "/assets/guide/records-create.jpg",
    imageAlt: "경기 기록과 내 기록을 선택하는 기록 만들기 화면",
    caption: "함께한 경기 기록과 개인용 내 기록을 목적에 맞게 나눠 시작합니다.",
    steps: [
      {
        title: "기록 입력",
        body: "심판이 있으면 양쪽 전체를 기록합니다. 심판이 없으면 배정된 기록원이 자기 사이드를 기록하고, 기록 담당자가 없는 사이드는 실제 출전 선수가 본인 득점을 입력합니다.",
        Icon: ClipboardCheck,
      },
      {
        title: "일반 경기 확인",
        body: "참가자가 결과를 확인하고 실제 출전 선수는 본인 득점에 이의를 신청할 수 있습니다.",
        Icon: Users,
      },
      {
        title: "이의 판정",
        body: "방장이 열린 이의를 하나씩 가결·부결합니다. 마지막 판정이 끝나면 재승인 없이 확정되고 이후 불복은 신고합니다.",
        Icon: ShieldCheck,
      },
      {
        title: "사후 경기 기록",
        body: "실제 참가자 전원이 한 번씩 최종 승인합니다. 24시간 무응답자가 있으면 부분 확인으로 남고 MMR은 반영되지 않습니다.",
        Icon: CheckCircle2,
      },
    ],
    callout: {
      title: "경기 기록과 내 기록",
      body: "경기 기록은 함께한 참가자 확인을 거치는 사후 기록방입니다. 내 기록은 승인 없이 빠르게 남기는 개인용 기록입니다.",
      details: [
        "두 방식 모두 경기 이력용이며 MMR에는 반영되지 않습니다.",
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
        body: "확정된 경쟁전만 기본 대상입니다. 친선전·현장 픽업·사후 경기 기록·내 기록은 기록만 남습니다.",
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
];

const GUIDE_CHAPTER_IDS = GUIDE_CHAPTERS.map((chapter) => chapter.id);

export default function GettingStarted() {
  const [searchParams] = useSearchParams();
  const chapterTitleRef = useRef(null);
  const requestedChapterId = searchParams.get("chapter") ?? GUIDE_CHAPTER_IDS[0];
  const requestedChapterIndex = GUIDE_CHAPTER_IDS.indexOf(requestedChapterId);
  const activeIndex = requestedChapterIndex >= 0 ? requestedChapterIndex : 0;
  const chapter = GUIDE_CHAPTERS[activeIndex];
  const previousChapterIdRef = useRef(chapter.id);
  const previousChapter = GUIDE_CHAPTERS[activeIndex - 1] ?? null;
  const nextChapter = GUIDE_CHAPTERS[activeIndex + 1] ?? null;
  const CalloutIcon = chapter.callout.Icon;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    if (previousChapterIdRef.current !== chapter.id) {
      chapterTitleRef.current?.focus({ preventScroll: true });
    }
    previousChapterIdRef.current = chapter.id;
  }, [chapter.id]);

  return (
    <div className="getting-started-page">
      <div className="getting-started-topbar">
        <Link
          className="button ui-button button-secondary ui-button-secondary button-sm ui-button-sm"
          to="/app"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          홈으로
        </Link>
        <span>ALPHA GUIDE · 5단계</span>
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

        <figure className="getting-started-shot">
          <img
            src={assetUrl(chapter.image)}
            alt={chapter.imageAlt}
            loading="eager"
            decoding="async"
          />
          <figcaption>{chapter.caption}</figcaption>
        </figure>
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

      <nav className="getting-started-pager" aria-label="사용 설명 이전 다음">
        {previousChapter ? (
          <Link
            className="button ui-button button-secondary ui-button-secondary button-sm ui-button-sm"
            to={`?chapter=${previousChapter.id}`}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            이전
          </Link>
        ) : <span />}
        <span>{chapter.navLabel} · {activeIndex + 1}/{GUIDE_CHAPTERS.length}</span>
        {nextChapter ? (
          <Link
            className="button ui-button button-primary ui-button-primary button-sm ui-button-sm"
            to={`?chapter=${nextChapter.id}`}
          >
            다음
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <Link
            className="button ui-button button-primary ui-button-primary button-sm ui-button-sm"
            to="/app"
          >
            완료
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )}
      </nav>
    </div>
  );
}
