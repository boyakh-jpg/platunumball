import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Gauge,
  ListChecks,
  Play,
  ShieldCheck,
  Swords,
  Trophy,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Card from "../components/common/Card.jsx";

const GUIDE_STEPS = [
  {
    number: "01",
    title: "경기를 잡습니다",
    body: "매칭을 만들거나 참가합니다. 이미 끝난 경기는 ‘경기 기록하기’로 바로 시작할 수 있습니다.",
    Icon: Swords,
  },
  {
    number: "02",
    title: "현장에서 진행합니다",
    body: "출석과 팀을 확인합니다. 경기시계와 심판은 필요한 경기에서만 선택해 사용합니다.",
    Icon: Play,
  },
  {
    number: "03",
    title: "기록을 확인합니다",
    body: "점수와 개인 기록을 입력하고 참가자가 확인합니다. 잘못된 내용은 확정 전에 이의를 남깁니다.",
    Icon: ClipboardCheck,
  },
  {
    number: "04",
    title: "내 티어가 쌓입니다",
    body: "확정된 경쟁전 기록만 BOXTIER 티어·MMR에 반영됩니다. 친선전과 기록 전용 경기는 기록만 남습니다.",
    Icon: Trophy,
  },
];

const GUIDE_FEATURES = [
  {
    eyebrow: "MATCHING",
    title: "매칭",
    badge: "핵심",
    tone: "orange",
    Icon: Users,
    body: "공개 모집·비공개 초대, 개인·팀, 즉시·시간 지정 경기를 만들고 참가합니다.",
    note: "1v1 · 2v2 · 3v3 · 5v5",
  },
  {
    eyebrow: "GAME CLOCK",
    title: "BOXTIER 경기시계",
    badge: "선택",
    tone: "blue",
    Icon: Clock3,
    body: "쿼터, 휴식, 연장과 샷클락을 서버시간으로 기록합니다. 시계를 쓰지 않아도 경기는 진행할 수 있습니다.",
    note: "전체화면·화면 유지·부저는 기기별 베타",
  },
  {
    eyebrow: "OFFICIALS",
    title: "심판·기록원",
    badge: "선택",
    tone: "green",
    Icon: UserRoundCheck,
    body: "심판이 있으면 판정과 기록을 맡기고, 없으면 방장과 참가자가 기본 진행·확인 절차를 사용합니다.",
    note: "커뮤니티 경기 운영 보조 기능",
  },
  {
    eyebrow: "TIER & MMR",
    title: "티어 관리",
    badge: "확정 기록",
    tone: "gold",
    Icon: Gauge,
    body: "티어를 직접 고르는 방식이 아닙니다. 검증된 경쟁전 기록을 쌓아 통합·모드별 MMR을 관리합니다.",
    note: "BOXTIER 내부 경기 등급",
  },
];

const GUIDE_ROLES = [
  {
    title: "방장·경기관리자",
    body: "모집, 출석, 팀 배정, 경기 시작과 기록 확정을 관리합니다.",
  },
  {
    title: "경기시계 담당 선수",
    body: "출전선수 중 한 명이 시계를 시작하고 필요하면 다른 출전선수에게 넘깁니다.",
  },
  {
    title: "심판·기록원",
    body: "배정된 경기에서 판정·점수·개인 기록을 입력하고 커밋합니다.",
  },
  {
    title: "참가자",
    body: "내 출석과 기록을 확인하고, 틀린 내용은 확정 전에 이의를 남깁니다.",
  },
];

export default function GettingStarted() {
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
        <span>ALPHA GUIDE · 약 2분</span>
      </div>

      <Card as="header" className="getting-started-hero">
        <div className="getting-started-hero__copy">
          <Badge tone="orange">FIRST RECORD</Badge>
          <p className="eyebrow">BOXTIER 사용 설명</p>
          <h1>
            농구를 했다면,
            <span>기록이 남아야 합니다.</span>
          </h1>
          <p>
            BOXTIER는 경기를 찾는 데서 끝나지 않습니다.
            실제 경기의 점수와 선수 기록을 남기고, 확인된 기록으로 내 티어를 관리하는 농구 기록 웹입니다.
          </p>
          <div className="getting-started-actions">
            <Link
              className="button ui-button button-primary ui-button-primary button-md ui-button-md"
              to="/app/create?intent=record"
            >
              <ClipboardCheck size={18} aria-hidden="true" />
              내 경기 기록하기
            </Link>
            <Link
              className="button ui-button button-secondary ui-button-secondary button-md ui-button-md"
              to="/app/recruiting"
            >
              매칭 둘러보기
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="getting-started-visual ui-panel" aria-label="경기에서 티어까지 이어지는 기록 흐름">
          <span className="getting-started-visual__label">ONE GAME, ONE RECORD</span>
          <div className="getting-started-visual__flow">
            <span>
              <Play size={20} aria-hidden="true" />
              <b>PLAY</b>
              <small>경기</small>
            </span>
            <ArrowRight size={22} aria-hidden="true" />
            <span>
              <ClipboardCheck size={20} aria-hidden="true" />
              <b>RECORD</b>
              <small>기록</small>
            </span>
            <ArrowRight size={22} aria-hidden="true" />
            <span>
              <Trophy size={20} aria-hidden="true" />
              <b>TIER</b>
              <small>티어</small>
            </span>
          </div>
          <strong>경기 하나가 내 농구 이력이 됩니다.</strong>
        </div>
      </Card>

      <Card as="section" className="getting-started-free" id="guide-free">
        <span className="getting-started-free__icon">
          <ShieldCheck size={28} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">FREE CORE</p>
          <h2>필수 웹 기능은 평생 무료</h2>
          <p>
            경기 모집·초대·참가, 기본 경기시계, 기록 입력·확정 기록 열람,
            개인·팀 티어·MMR 조회와 커뮤니티 심판 기능에 이용료를 붙이지 않습니다.
          </p>
          <small>
            서비스 운영 기간 기준입니다. 구장비·심판비·기록비·장비비·통신비 같은 현장·외부 비용은 포함되지 않습니다.
            {" "}
            <Link to="/terms#terms-fees">무료 범위 보기</Link>
          </small>
        </div>
        <CheckCircle2 size={24} className="getting-started-free__check" aria-hidden="true" />
      </Card>

      <section className="getting-started-section" aria-labelledby="getting-started-flow-title">
        <div className="getting-started-section__head">
          <div>
            <p className="eyebrow">4 STEPS</p>
            <h2 id="getting-started-flow-title">처음에는 이것만 알면 됩니다</h2>
          </div>
          <span>기록 → 확인 → 티어</span>
        </div>
        <ol className="getting-started-steps">
          {GUIDE_STEPS.map(({ number, title, body, Icon }) => (
            <li className="getting-started-step ui-panel" key={number}>
              <div>
                <span>{number}</span>
                <Icon size={22} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="getting-started-section" aria-labelledby="getting-started-tools-title">
        <div className="getting-started-section__head">
          <div>
            <p className="eyebrow">COURT TOOLS</p>
            <h2 id="getting-started-tools-title">경기마다 필요한 기능만 켭니다</h2>
          </div>
          <span>강제하지 않는 현장 도구</span>
        </div>
        <div className="getting-started-features">
          {GUIDE_FEATURES.map(({ eyebrow, title, badge, tone, Icon, body, note }) => (
            <Card as="article" className="getting-started-feature" key={title}>
              <div className="getting-started-feature__head">
                <span><Icon size={22} aria-hidden="true" /></span>
                <Badge tone={tone}>{badge}</Badge>
              </div>
              <p className="eyebrow">{eyebrow}</p>
              <h3>{title}</h3>
              <p>{body}</p>
              <small>{note}</small>
            </Card>
          ))}
        </div>
      </section>

      <Card as="section" className="getting-started-roles">
        <div className="getting-started-section__head">
          <div>
            <p className="eyebrow">WHO DOES WHAT</p>
            <h2>현장에서는 누가 무엇을 하나요?</h2>
          </div>
          <ListChecks size={25} aria-hidden="true" />
        </div>
        <div className="getting-started-role-list">
          {GUIDE_ROLES.map((role, index) => (
            <div key={role.title}>
              <span>{index + 1}</span>
              <p>
                <strong>{role.title}</strong>
                <small>{role.body}</small>
              </p>
            </div>
          ))}
        </div>
      </Card>

      <aside className="getting-started-alpha ui-panel">
        <BookOpenCheck size={24} aria-hidden="true" />
        <div>
          <strong>지금은 알파 테스트 중입니다.</strong>
          <p>
            기록·매칭·티어의 핵심 흐름은 사용할 수 있습니다.
            경기시계의 전체화면·화면 유지·부저는 브라우저와 기기에 따라 제한될 수 있습니다.
          </p>
        </div>
        <Link to="/app/settings">문제 신고</Link>
      </aside>

      <Card as="section" className="getting-started-final">
        <div>
          <p className="eyebrow">READY?</p>
          <h2>첫 기록을 남겨보세요.</h2>
          <p>오늘 한 경기부터 시작하면 됩니다.</p>
        </div>
        <div className="getting-started-actions">
          <Link
            className="button ui-button button-primary ui-button-primary button-md ui-button-md"
            to="/app/create?intent=record"
          >
            <ClipboardCheck size={18} aria-hidden="true" />
            경기 기록하기
          </Link>
          <Link
            className="button ui-button button-secondary ui-button-secondary button-md ui-button-md"
            to="/app/recruiting"
          >
            매칭 보기
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </Card>
    </div>
  );
}
