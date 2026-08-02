import { ArrowLeft, BookOpen, ClipboardCheck, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { assetUrl } from "../lib/assets.js";
import {
  REFEREE_RULEBOOK_CHECKLIST,
  REFEREE_RULEBOOK_EASY_SECTIONS,
  REFEREE_RULEBOOK_NOTICE,
  REFEREE_RULEBOOK_SECTIONS,
  REFEREE_STAT_GUIDELINES,
} from "../lib/refereeRulebook.js";

const RULEBOOK_ASSET_VERSION = "20260802-3";
const RULEBOOK_SOURCES = [
  {
    label: "FIBA 경기규칙 2024",
    href: "https://assets.fiba.basketball/image/upload/documents-corporate-fiba-official-rules-2024-v10a.pdf",
  },
  {
    label: "FIBA 통계 매뉴얼 2024",
    href: "https://assets.fiba.basketball/image/upload/documents-corporate-fiba-statisticians-manual-2024.pdf",
  },
];

const RULEBOOK_CHAPTERS = [
  {
    eyebrow: "Game rules",
    title: "경기 중 판정",
    description: "경기 전 확인부터 득점과 재개까지 실제 코트에서 먼저 찾는 기준입니다.",
    sections: [...REFEREE_RULEBOOK_SECTIONS.slice(0, 6), REFEREE_RULEBOOK_SECTIONS[7]],
  },
  {
    eyebrow: "BOXTIER flow",
    title: "운영·기록·이의·MMR",
    description: "출석과 교체부터 기록 분류, 이의 처리, 최종 승인과 MMR까지 역할별 기준입니다.",
    sections: REFEREE_RULEBOOK_SECTIONS.slice(8, 14),
  },
  {
    eyebrow: "Safety",
    title: "안전·심판 윤리",
    description: "판정보다 먼저 적용할 경기 중단 기준과 심판의 중립성 원칙입니다.",
    sections: REFEREE_RULEBOOK_SECTIONS.slice(14),
  },
];

const SCENE_COPY = {
  standard: "콜 기준",
  pregame: "경기 전",
  clock: "시간",
  violation: "위반",
  contact: "접촉",
  score: "득점",
  stats: "활약",
  technical: "제재",
  authority: "권한",
  dispute: "이의",
  review: "후기",
  safety: "안전",
  ethics: "윤리",
  points: "득점",
  assist: "어시",
  rebound: "리바",
  steal: "스틸",
  block: "블록",
  foul: "파울",
};

function getRulebookImageTheme(theme) {
  return theme === "light" ? "light" : "dark";
}

function RulebookIllustration({ scene, theme = "dark" }) {
  const title = SCENE_COPY[scene] ?? SCENE_COPY.standard;
  const imageTheme = getRulebookImageTheme(theme);
  const fallbackSrc = assetUrl(`/assets/referee-rulebook/${scene}.svg`);
  return (
    <figure className="rulebook-asset">
      <img
        src={`${assetUrl(`/assets/referee-rulebook-rendered/${imageTheme}/${scene}.webp`)}?v=${RULEBOOK_ASSET_VERSION}`}
        alt={`${title} 일러스트`}
        loading="lazy"
        onError={(event) => {
          if (event.currentTarget.dataset.fallback === "true") return;
          event.currentTarget.dataset.fallback = "true";
          event.currentTarget.src = fallbackSrc;
        }}
      />
    </figure>
  );
}

export default function RefereeRulebook({ theme = "dark" }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rulebookLevel = searchParams.get("level") === "detail" ? "detail" : "easy";
  const isEasyRulebook = rulebookLevel === "easy";

  const selectRulebookLevel = (nextLevel) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextLevel === "detail") nextParams.set("level", "detail");
    else nextParams.delete("level");
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <div className="page-stack referee-rulebook-page">
      <header className="page-header ui-page-hero ui-design-app-hero">
        <div className="ui-page-hero__copy">
          <p className="eyebrow">Study guide</p>
          <h1>농구 룰북</h1>
        </div>
        <Button as={Link} variant="secondary" to="/app/settings">
          <ArrowLeft size={16} /> 설정
        </Button>
      </header>

      <Card className="referee-rulebook-intro">
        <div>
          <Badge tone={isEasyRulebook ? "green" : "blue"}>
            {isEasyRulebook ? "처음 보는 사람용" : "FIBA 2024 · BOXTIER 운영 기준"}
          </Badge>
          <h2>{isEasyRulebook ? "경기에서 바로 쓰는 쉬운 규칙" : "판정과 기록 상세 기준"}</h2>
        </div>
        <RulebookIllustration scene="standard" theme={theme} />
      </Card>

      <div className="segmented-control compact-segments rulebook-level-switch" aria-label="룰북 난이도">
        <button
          type="button"
          className={isEasyRulebook ? "active" : ""}
          aria-pressed={isEasyRulebook}
          onClick={() => selectRulebookLevel("easy")}
        >
          쉬운 규칙
        </button>
        <button
          type="button"
          className={!isEasyRulebook ? "active" : ""}
          aria-pressed={!isEasyRulebook}
          onClick={() => selectRulebookLevel("detail")}
        >
          상세 규칙
        </button>
      </div>

      <div className="referee-rulebook-notice">
        {(isEasyRulebook
          ? [
            "공식 대회·학교·협회 경기는 해당 대회 규칙이 먼저입니다.",
            "세부 판정과 개인활약 기록 기준은 상세 규칙에서 확인합니다.",
          ]
          : REFEREE_RULEBOOK_NOTICE
        ).map((notice) => <span key={notice}>{notice}</span>)}
      </div>

      {isEasyRulebook ? (
        <RulebookChapter
          chapter={{
            eyebrow: "Easy rulebook",
            title: "처음 한 경기, 이것만 확인",
            description: "더 정확한 판정 기준과 개인활약 세부 기준은 상세 규칙에서 확인합니다.",
            sections: REFEREE_RULEBOOK_EASY_SECTIONS,
          }}
          theme={theme}
        />
      ) : (
        <>
      <section className="referee-rulebook-checklist">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Quick checklist</p>
            <h2>경기 운영 순서</h2>
          </div>
          <ClipboardCheck size={22} />
        </div>
        <div>
          {REFEREE_RULEBOOK_CHECKLIST.map((item, index) => (
            <span key={item}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              {item}
            </span>
          ))}
        </div>
      </section>

      <RulebookChapter chapter={RULEBOOK_CHAPTERS[0]} theme={theme} />

      <section className="referee-stat-guide">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Stat standard</p>
            <h2>7. 개인활약 기록 기준</h2>
          </div>
          <ShieldCheck size={22} />
        </div>
        <p>
          일반 경기의 개인활약은 배정 심판이 확인한 장면만 기록됩니다. 숫자를 예쁘게 만드는 것보다
          팀 점수와 판정 근거를 정확히 남기는 것이 먼저입니다.
        </p>
        <div className="referee-stat-guide-grid">
          {REFEREE_STAT_GUIDELINES.map((stat) => (
            <Card key={stat.stat} className="referee-stat-guide-card">
              <RulebookIllustration scene={stat.scene} theme={theme} />
              <div>
                <Badge tone="green">{stat.stat}</Badge>
                <strong>{stat.summary}</strong>
              </div>
              <div className="referee-stat-columns">
                <div>
                  <span>기록</span>
                  <ul>{stat.record.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div>
                  <span>제외</span>
                  <ul>{stat.reject.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              </div>
              <div className="referee-stat-examples">
                <span>상황 예시</span>
                <ul>{stat.examples.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {RULEBOOK_CHAPTERS.slice(1).map((chapter) => (
        <RulebookChapter key={chapter.title} chapter={chapter} theme={theme} />
      ))}
        </>
      )}

      <Card className="referee-rulebook-footer">
        <BookOpen size={20} />
        <div>
          <p>
            현재 적용 중인 FIBA 2024 규칙과 통계 매뉴얼을 기준으로 확인했습니다. 공식 대회·학교·협회 경기는
            해당 대회 규정과 심판 지침이 우선입니다.
          </p>
          <div className="referee-rulebook-sources">
            {RULEBOOK_SOURCES.map((source) => (
              <a key={source.href} href={source.href} target="_blank" rel="noreferrer">
                {source.label}
              </a>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

function RulebookChapter({ chapter, theme }) {
  return (
    <section className="referee-rulebook-chapter">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{chapter.eyebrow}</p>
          <h2>{chapter.title}</h2>
          <p>{chapter.description}</p>
        </div>
      </div>
      <div className="referee-rulebook-section-grid">
        {chapter.sections.map((section) => (
          <Card key={section.title} className="referee-rulebook-section-card">
            <RulebookIllustration scene={section.scene} theme={theme} />
            <div className="referee-rulebook-section-body">
              <strong>{section.title}</strong>
              <p>{section.summary}</p>
              <ul>{section.points.map((point) => <li key={point}>{point}</li>)}</ul>
              <div className="referee-rulebook-detail-grid">
                {section.details.map((detail) => (
                  <div key={detail.label}>
                    <span>{detail.label}</span>
                    <ul>{detail.items.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
