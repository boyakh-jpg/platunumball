import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CheckCircle2, Clock3, PlusCircle, ShieldAlert, Swords, Trophy } from "lucide-react";
import Button from "../components/common/Button.jsx";

const STATUS_META = {
  contract: { label: "동의", tone: "blue" },
  agreed: { label: "예정", tone: "green" },
  approval: { label: "승인", tone: "orange" },
  disputed: { label: "보류", tone: "orange" },
  confirmed: { label: "확정", tone: "green" },
  void: { label: "무효", tone: "neutral" },
  cancelled: { label: "취소", tone: "neutral" },
};

const VIEWS = [
  {
    id: "active",
    code: "LIVE",
    title: "진행중",
    desc: "동의, 예정, 승인, 보류",
    icon: Swords,
    statuses: ["contract", "agreed", "approval", "disputed"],
  },
  {
    id: "approval",
    code: "CHECK",
    title: "처리 필요",
    desc: "승인과 이의 확인",
    icon: ShieldAlert,
    statuses: ["approval", "disputed"],
  },
  {
    id: "done",
    code: "DONE",
    title: "기록",
    desc: "확정된 경기",
    icon: Trophy,
    statuses: ["confirmed"],
  },
  {
    id: "closed",
    code: "CLOSED",
    title: "닫힘",
    desc: "취소와 무효",
    icon: CheckCircle2,
    statuses: ["cancelled", "void"],
  },
];

function compareRecent(a, b) {
  return String(b.scheduledAt ?? b.createdAt ?? "").localeCompare(String(a.scheduledAt ?? a.createdAt ?? ""));
}

function formatMatchTime(match) {
  return match.scheduledAt ?? match.createdAt?.slice(0, 16)?.replace("T", " ") ?? "시간 미정";
}

function getWinner(match) {
  const scoreA = Number(match.teamA.score ?? match.result?.scoreA ?? 0);
  const scoreB = Number(match.teamB.score ?? match.result?.scoreB ?? 0);
  if (scoreA === scoreB) return "";
  return scoreA > scoreB ? match.teamA.name : match.teamB.name;
}

function getViewCount(matches, view) {
  return matches.filter((match) => view.statuses.includes(match.status)).length;
}

export default function Matches({ app }) {
  const [viewId, setViewId] = useState("active");
  const selectedView = VIEWS.find((view) => view.id === viewId) ?? VIEWS[0];

  const matchesByView = useMemo(() => {
    return [...app.state.matches]
      .filter((match) => selectedView.statuses.includes(match.status))
      .sort(compareRecent);
  }, [app.state.matches, selectedView.statuses]);

  const visibleMatches = matchesByView.slice(0, selectedView.id === "done" ? 80 : 60);
  const activeCount = getViewCount(app.state.matches, VIEWS[0]);
  const approvalCount = getViewCount(app.state.matches, VIEWS[1]);
  const doneCount = getViewCount(app.state.matches, VIEWS[2]);

  return (
    <div className="page-stack om-match-page">
      <section className="om-match-hero">
        <div className="om-match-copy">
          <span className="om-kicker">MATCH QUEUE</span>
          <h1>경기 큐</h1>
          <p>지금 처리할 경기만 보고, 지난 기록은 필요할 때만 연다.</p>
        </div>
        <div className="om-match-panel">
          <div className="om-match-stats">
            <span><strong>{activeCount}</strong>LIVE</span>
            <span><strong>{approvalCount}</strong>CHECK</span>
            <span><strong>{doneCount}</strong>DONE</span>
          </div>
          <Link to="/app/create">
            <Button className="om-match-create"><PlusCircle size={18} /> 경기 만들기</Button>
          </Link>
        </div>
      </section>

      <section className="om-view-grid" aria-label="경기 상태">
        {VIEWS.map((view) => {
          const Icon = view.icon;
          const active = view.id === viewId;
          return (
            <button
              key={view.id}
              type="button"
              className={active ? "om-view-card active" : "om-view-card"}
              onClick={() => setViewId(view.id)}
            >
              <span className="om-view-icon"><Icon size={22} /></span>
              <span>
                <small>{view.code}</small>
                <strong>{view.title}</strong>
                <em>{view.desc}</em>
              </span>
              <b>{getViewCount(app.state.matches, view)}</b>
            </button>
          );
        })}
      </section>

      <section className="om-match-list" aria-label="경기 목록">
        <div className="om-list-head">
          <div>
            <span className="om-kicker">{selectedView.code}</span>
            <h2>{selectedView.title}</h2>
          </div>
          <span>{matchesByView.length}개 중 {visibleMatches.length}개 표시</span>
        </div>

        {visibleMatches.length ? visibleMatches.map((match) => {
          const status = STATUS_META[match.status] ?? { label: match.status, tone: "blue" };
          const scoreA = match.teamA.score ?? match.result?.scoreA ?? 0;
          const scoreB = match.teamB.score ?? match.result?.scoreB ?? 0;
          const winner = getWinner(match);

          return (
            <article key={match.id} className={`om-match-card om-status-${match.status}`}>
              <div className="om-card-main">
                <div className="om-card-kicker">
                  <span className={`om-status-pill ${status.tone}`}>{status.label}</span>
                  <span>{match.mode}</span>
                  <span>{match.official ? "공식" : "일반"}</span>
                </div>
                <h3>{match.title}</h3>
                <p><CalendarDays size={15} />{formatMatchTime(match)} · {match.court}</p>
              </div>
              <div className="om-score-box">
                <Link to={`/app/teams/${match.teamA.teamId}`}>{match.teamA.name}</Link>
                <strong>{scoreA} : {scoreB}</strong>
                <Link to={`/app/teams/${match.teamB.teamId}`}>{match.teamB.name}</Link>
                {winner ? <span>{winner} 우세</span> : null}
              </div>
              <Link className="button button-secondary button-md om-room-link" to={`/app/matches/${match.id}`}>
                경기방
              </Link>
            </article>
          );
        }) : (
          <div className="om-empty-state">
            <strong>해당 큐 없음</strong>
            <p>다른 상태를 선택하거나 새 경기를 만든다.</p>
          </div>
        )}
      </section>
    </div>
  );
}
