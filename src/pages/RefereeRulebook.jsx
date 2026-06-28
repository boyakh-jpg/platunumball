import { ArrowLeft, BookOpen, ClipboardCheck, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Card from "../components/common/Card.jsx";
import { assetUrl } from "../lib/assets.js";
import {
  REFEREE_RULEBOOK_CHECKLIST,
  REFEREE_RULEBOOK_NOTICE,
  REFEREE_RULEBOOK_SECTIONS,
  REFEREE_STAT_GUIDELINES,
} from "../lib/refereeRulebook.js";

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
        src={assetUrl(`/assets/named/${imageTheme}/webp/${scene}.webp`)}
        alt={`${title} 일러스트`}
        loading="lazy"
        onError={(event) => {
          if (event.currentTarget.dataset.fallback === "true") return;
          event.currentTarget.dataset.fallback = "true";
          event.currentTarget.src = fallbackSrc;
        }}
      />
      <figcaption>{title}</figcaption>
    </figure>
  );
}

export default function RefereeRulebook({ theme = "dark" }) {
  return (
    <div className="page-stack referee-rulebook-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Study guide</p>
          <h1>커뮤니티 심판 룰북</h1>
        </div>
        <Link className="button button-secondary button-md" to="/app/settings">
          <ArrowLeft size={16} /> 설정
        </Link>
      </header>

      <section className="referee-rulebook-hero">
        <div>
          <Badge tone="blue">문제 원문 비공개</Badge>
          <h2>시험 문제 대신 판정 기준을 공부한다</h2>
          <p>
            RankBall 심판은 공식 심판을 대체하는 역할이 아니라, 동네 경기에서 양쪽이 납득할 수 있게
            점수, 파울, 개인활약, 이의신청을 정리하는 운영자다.
          </p>
        </div>
        <RulebookIllustration scene="standard" theme={theme} />
      </section>

      <div className="referee-rulebook-notice">
        {REFEREE_RULEBOOK_NOTICE.map((notice) => <span key={notice}>{notice}</span>)}
      </div>

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

      <section className="referee-rulebook-section-grid">
        {REFEREE_RULEBOOK_SECTIONS.map((section) => (
          <Card key={section.title} className="referee-rulebook-section-card">
            <RulebookIllustration scene={section.scene} theme={theme} />
            <div className="referee-rulebook-section-body">
              <strong>{section.title}</strong>
              <p>{section.summary}</p>
              <ul>
                {section.points.map((point) => <li key={point}>{point}</li>)}
              </ul>
              <div className="referee-rulebook-detail-grid">
                {section.details.map((detail) => (
                  <div key={detail.label}>
                    <span>{detail.label}</span>
                    <ul>
                      {detail.items.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </section>

      <section className="referee-stat-guide">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Stat standard</p>
            <h2>개인활약 기록 기준</h2>
          </div>
          <ShieldCheck size={22} />
        </div>
        <p>
          개인활약은 심판이 봤거나 기록자가 확실히 확인한 장면만 기록한다. 애매하면 많이 주는 것보다
          적게 주는 편이 낫다.
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

      <Card className="referee-rulebook-footer">
        <BookOpen size={20} />
        <p>
          이 자료는 RankBall 커뮤니티 운영용이다. 공식 대회, 학교 대회, 협회 경기에서는 해당 대회 규정과
          심판 지침을 우선한다.
        </p>
      </Card>
    </div>
  );
}
