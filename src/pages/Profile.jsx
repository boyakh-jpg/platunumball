import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import ProgressionChecklist from "../components/rating/ProgressionChecklist.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import ShareCard from "../components/share/ShareCard.jsx";

function compareRecent(a, b) {
  return String(b.scheduledAt ?? b.createdAt ?? "").localeCompare(String(a.scheduledAt ?? a.createdAt ?? ""));
}

function getUserSide(match, userId) {
  if (match.teamA.players.includes(userId)) return "teamA";
  if (match.teamB.players.includes(userId)) return "teamB";
  return null;
}

function getSideScore(match, sideName) {
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return Number(match.result?.[resultKey] ?? match[sideName]?.score ?? 0);
}

function getUserResult(match, userId) {
  const sideName = getUserSide(match, userId);
  if (!sideName) return "D";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  const sideScore = getSideScore(match, sideName);
  const otherScore = getSideScore(match, otherSide);
  if (sideScore === otherScore) return "D";
  return sideScore > otherScore ? "W" : "L";
}

function getUserRecordLine(match, userId) {
  const sideName = getUserSide(match, userId) ?? "teamA";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  return {
    side: match[sideName],
    opponent: match[otherSide],
    score: getSideScore(match, sideName),
    opponentScore: getSideScore(match, otherSide),
    result: getUserResult(match, userId),
  };
}

export default function Profile({ app }) {
  const user = app.currentUser;
  const [draft, setDraft] = useState({
    name: user.name,
    position: user.position,
    region: user.region,
    school: user.school,
    company: user.company,
  });
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const submit = (event) => {
    event.preventDefault();
    app.actions.updateProfile(draft);
  };
  const myRecords = [...app.state.matches]
    .filter((match) => match.status === "confirmed" && getUserSide(match, user.id))
    .sort(compareRecent)
    .slice(0, 6);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Profile</p>
          <h1>프로필</h1>
        </div>
      </header>
      <div className="content-grid">
        <div className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">내 정보</p>
                <h2>{user.handle}</h2>
              </div>
            </div>
            <form className="form-grid" onSubmit={submit}>
              {Object.entries(draft).map(([key, value]) => (
                <label key={key}>
                  {key}
                  <input value={value} onChange={(event) => update({ [key]: event.target.value })} />
                </label>
              ))}
              <Button type="submit">저장</Button>
            </form>
          </Card>
          <section className="mode-grid">
            <RatingCard title="통합" mmr={user.ratings.integrated} subtitle="메인 티어" />
            {Object.entries(user.ratings.modes).map(([mode, mmr]) => (
              <RatingCard key={mode} title={mode} mmr={mmr} subtitle="모드 티어" />
            ))}
          </section>
        </div>
        <aside className="page-stack">
          <ProgressionChecklist user={user} matches={app.state.matches} />
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Record</p>
                <h2>내 기록</h2>
              </div>
            </div>
            {myRecords.length ? (
              <div className="recent-match-list">
                {myRecords.map((match) => {
                  const line = getUserRecordLine(match, user.id);
                  return (
                    <Link key={match.id} to={`/app/matches/${match.id}`} className={`recent-match-row result-${line.result.toLowerCase()}`}>
                      <b>{line.result}</b>
                      <span>
                        <strong>{line.side.name} vs {line.opponent.name}</strong>
                        <em>{match.scheduledAt} · {match.mode}</em>
                      </span>
                      <i>{line.score}:{line.opponentScore}</i>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">확정된 경기 기록이 없습니다.</div>
            )}
          </Card>
          <ShareCard user={user} match={app.state.matches[0]} />
          <Card className="section-card">
            <div className="contract-grid single">
              <div>
                <span>신뢰도</span>
                <strong>{user.trustScore}</strong>
              </div>
              <div>
                <span>지역</span>
                <strong>{user.region}</strong>
              </div>
              <div>
                <span>학교</span>
                <strong>{user.school}</strong>
              </div>
              <div>
                <span>회사</span>
                <strong>{user.company}</strong>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
