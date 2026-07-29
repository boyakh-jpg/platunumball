import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  MapPin,
  Moon,
  Trophy,
  Users,
} from "lucide-react";
import { useState } from "react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import {
  BOXTIER_LOGO_URL,
  assetUrl,
} from "../lib/assets.js";

const UPCOMING = [
  {
    day: "오늘",
    time: "오후 7:30",
    title: "퇴근 후 가볍게 3대3",
    place: "양재 풀코트",
    people: "4자리 남음",
  },
  {
    day: "토",
    time: "오후 2:00",
    title: "처음 와도 괜찮은 경기",
    place: "마포 실내체육관",
    people: "2자리 남음",
  },
  {
    day: "일",
    time: "오전 10:00",
    title: "강남 픽앤롤 정기 경기",
    place: "반포 농구장",
    people: "참가 확정",
  },
];

const RECENT = [
  { result: "승리", matchup: "강남 픽앤롤 vs 잠실 루키즈", score: "21 : 17" },
  { result: "패배", matchup: "강남 픽앤롤 vs 마포 러너스", score: "18 : 21" },
  { result: "승리", matchup: "강남 픽앤롤 vs 성수 크루", score: "21 : 14" },
];

function ClassicLandingPreview() {
  return (
    <main className="landing">
      <section className="landing-hero">
        <div className="landing-backdrop" aria-hidden="true" />
        <div className="landing-copy">
          <div className="landing-brand-lockup" aria-label="BOXTIER">
            <span className="brand-logo-frame" aria-hidden="true">
              <img className="brand-logo-img" src={BOXTIER_LOGO_URL} alt="" />
            </span>
            <span className="brand-letter-wrap" aria-hidden="true">
              <span className="brand-letter-text">BOXTIER</span>
            </span>
          </div>
          <Badge tone="green">Season Zero</Badge>
          <div className="landing-actions">
            <div className="landing-primary-actions">
              <Button type="button" className="landing-create-action">매칭 만들기</Button>
              <Button type="button" className="landing-create-action">경기 기록하기</Button>
            </div>
          </div>
          <div className="landing-stat-grid">
            <span><strong>14</strong>matches</span>
            <span><strong>3</strong>teams</span>
            <span><strong>1217</strong>top MMR</span>
          </div>
        </div>
        <div className="broadcast-panel">
          <div className="broadcast-glass">
            <span className="live-dot">TODAY</span>
            <h2>5v5 Match</h2>
            <div className="broadcast-score">
              <span>Team A</span><strong>21</strong><i>VS</i><strong>17</strong><span>Team B</span>
            </div>
            <div className="broadcast-list">
              <span>승인 대기 <b>2</b></span>
              <span>열린 매칭 <b>3</b></span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function VisualDirectionDemo() {
  const [designMode, setDesignMode] = useState("editorial");

  return (
    <div className="ui-design-host" data-design={designMode}>
      <div className="ui-design-page">
        <header className="ui-design-toolbar">
          <div className="ui-design-toolbar__copy">
            <p className="eyebrow">BOXTIER visual demo</p>
            <span>하나의 DOM을 두 CSS가 렌더링합니다.</span>
          </div>
          <div className="ui-design-toolbar__actions">
            <div className="ui-design-switch" role="radiogroup" aria-label="디자인 선택">
              <button
                type="button"
                className={designMode === "classic" ? "is-active" : ""}
                aria-pressed={designMode === "classic"}
                onClick={() => setDesignMode("classic")}
              >
                기본
              </button>
              <button
                type="button"
                className={designMode === "editorial" ? "is-active" : ""}
                aria-pressed={designMode === "editorial"}
                onClick={() => setDesignMode("editorial")}
              >
                새 디자인
              </button>
            </div>
            <Button as="a" variant="secondary" href="/app">
              원본 앱
            </Button>
          </div>
        </header>

        {designMode === "classic" ? <ClassicLandingPreview /> : <main className="ui-design-flow">
        <section
          className="ui-design-hero"
          style={{
            "--ui-design-media": "var(--bg-action)",
            "--ui-design-media-position": "center 36%",
            "--ui-design-media-position-mobile": "62% center",
          }}
        >
          <div className="ui-design-hero__copy">
            <Badge tone="green">지금 12명이 경기 찾는 중</Badge>
            <h1>오늘,<br />농구할 사람?</h1>
            <p>장소와 시간을 고르면 같이 뛸 사람을 찾을 수 있어요.</p>
            <div className="ui-design-actions">
              <Button type="button">
                경기 찾기 <ArrowRight size={18} />
              </Button>
              <Button type="button" variant="secondary">
                직접 만들기
              </Button>
            </div>
          </div>
          <div className="ui-design-stat-strip ui-design-hero__stats" aria-label="내 활동 요약">
            <span><b>3</b>예정 경기</span>
            <span><b>8</b>이번 달 경기</span>
            <span><b>64%</b>승률</span>
          </div>
        </section>

        <section className="ui-design-section">
          <div className="ui-design-section-heading">
            <div>
              <p className="eyebrow">Play next</p>
              <h2>가까운 경기</h2>
            </div>
            <button type="button" className="ui-design-text-action">
              전체 일정 <ChevronRight size={17} />
            </button>
          </div>
          <div className="ui-design-list ui-design-schedule">
            {UPCOMING.map((match) => (
              <button type="button" key={`${match.day}-${match.time}`} className="ui-design-row ui-design-schedule-row">
                <time>
                  <b>{match.day}</b>
                  <span>{match.time}</span>
                </time>
                <span className="ui-design-schedule-copy">
                  <strong>{match.title}</strong>
                  <small><MapPin size={14} /> {match.place}</small>
                </span>
                <span className="ui-design-availability">{match.people}</span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        </section>

        <section
          className="ui-design-image-feature"
          style={{
            "--ui-design-media": "var(--bg-teams)",
            "--ui-design-media-position": "center",
            "--ui-design-media-position-mobile": "64% center",
          }}
        >
          <div className="ui-design-image-feature__copy">
            <p className="eyebrow">My team</p>
            <h2>강남 픽앤롤</h2>
            <p>같이 뛴 경기와 다음 약속을 한곳에서 봐요.</p>
            <div className="ui-design-inline-meta">
              <span><Users size={17} /> 팀원 8명</span>
              <span><Trophy size={17} /> 최근 3연승</span>
              <span><CalendarDays size={17} /> 일요일 정기 경기</span>
            </div>
            <button type="button" className="ui-design-text-action ui-design-text-action--inverse">
              팀 보기 <ArrowRight size={18} />
            </button>
          </div>
        </section>

        <section className="ui-design-spotlight">
          <div className="ui-design-spotlight__intro">
            <img
              src={assetUrl("/assets/tier-emblems/tier-gold-v5.webp")}
              alt="골드 티어 엠블럼"
            />
            <div>
              <p className="eyebrow">My season</p>
              <h2>이번 시즌, 꽤 잘하고 있어요.</h2>
              <p>실력 점수 1217 · 골드 4</p>
            </div>
          </div>
          <dl className="ui-design-stat-strip ui-design-spotlight__stats">
            <div><dt>경기</dt><dd>14</dd></div>
            <div><dt>승리</dt><dd>9</dd></div>
            <div><dt>연속 출석</dt><dd>6주</dd></div>
          </dl>
        </section>

        <section className="ui-design-section">
          <div className="ui-design-section-heading">
            <div>
              <p className="eyebrow">Recent games</p>
              <h2>최근 경기</h2>
            </div>
          </div>
          <div className="ui-design-list ui-design-result-list">
            {RECENT.map((record) => (
              <div className="ui-design-result-row" key={record.matchup}>
                <span className={record.result === "승리" ? "is-win" : "is-loss"}>{record.result}</span>
                <strong>{record.matchup}</strong>
                <b>{record.score}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="ui-design-section">
          <div className="ui-design-section-heading">
            <div>
              <p className="eyebrow">Preferences</p>
              <h2>화면 설정</h2>
            </div>
          </div>
          <div className="ui-design-list ui-design-preference-list">
            <label className="ui-design-preference-row">
              <span><Moon size={18} /><b>화면 밝기</b><small>눈이 편한 화면을 선택해요.</small></span>
              <select defaultValue="light" aria-label="화면 밝기">
                <option value="light">라이트</option>
                <option value="dark">다크</option>
              </select>
            </label>
            <label className="ui-design-preference-row">
              <span><Users size={18} /><b>프로필 공개</b><small>다른 사람이 내 경기 기록을 볼 수 있어요.</small></span>
              <input type="checkbox" defaultChecked aria-label="프로필 공개" />
            </label>
          </div>
        </section>
        </main>}
      </div>
    </div>
  );
}
