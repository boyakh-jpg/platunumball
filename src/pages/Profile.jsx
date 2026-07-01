import { useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import ProgressionChecklist from "../components/rating/ProgressionChecklist.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import ShareCard from "../components/share/ShareCard.jsx";
import { getUserHashtag } from "../lib/handles.js";
import { canChangeProfileName, getNextNameChangeDate } from "../lib/profileSetup.js";

function compareRecent(a, b) {
  return String(b.scheduledAt ?? b.createdAt ?? "").localeCompare(String(a.scheduledAt ?? a.createdAt ?? ""));
}

function getUserSide(match, userId) {
  if (match.teamA?.players?.includes(userId)) return "teamA";
  if (match.teamB?.players?.includes(userId)) return "teamB";
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

function getAverageFouls(matches = [], userId) {
  const confirmed = matches.filter((match) => match.status === "confirmed" && match.result && getUserSide(match, userId));
  if (!confirmed.length) return 0;
  const total = confirmed.reduce((sum, match) => sum + Number(match.result?.playerStats?.[userId]?.fouls ?? 0), 0);
  return total / confirmed.length;
}

function getProfileAverageFouls(user = {}, matches = []) {
  const summaryAverage = Number(user.matchSummary?.averageFouls);
  if (user.matchSummary && Number.isFinite(summaryAverage)) return summaryAverage;
  return getAverageFouls(matches, user.id);
}

function formatDate(date) {
  if (!date) return "";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function RecentRecordCard({ records, userId }) {
  return (
    <Card className="section-card profile-record-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Record</p>
          <h2>내 기록</h2>
        </div>
        <Link className="button button-secondary button-sm" to="/app/profile/records">기록 더보기</Link>
      </div>
      {records.length ? (
        <div className="recent-match-list">
          {records.map((match) => {
            const line = getUserRecordLine(match, userId);
            return (
              <Link key={match.id} to={`/app/matches?match=${match.id}`} className={`recent-match-row result-${line.result.toLowerCase()}`}>
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
  );
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
  const [profileError, setProfileError] = useState("");
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async (event) => {
    event.preventDefault();
    if (draft.name !== user.name && !canChangeProfileName(user)) {
      setProfileError(`닉네임은 월 1회만 변경할 수 있습니다. 다음 변경 가능일: ${formatDate(getNextNameChangeDate(user))}`);
      return;
    }
    setProfileError("");
    try {
      await app.actions.updateProfile(draft);
    } catch (error) {
      setProfileError(error.message || "프로필 저장에 실패했습니다.");
    }
  };
  const myRecords = [...app.state.matches]
    .filter((match) => match.status === "confirmed" && getUserSide(match, user.id))
    .sort(compareRecent)
    .slice(0, 6);
  const averageFouls = getProfileAverageFouls(user, app.state.matches);
  return (
    <div className="page-stack profile-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Profile</p>
          <h1>프로필</h1>
        </div>
        <Link className="button button-secondary" to="/app/signup">가입 정보 설정</Link>
      </header>
      <div className="content-grid profile-overview-grid">
        <div className="page-stack profile-main-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">내 정보</p>
                <h2>{getUserHashtag(user)}</h2>
              </div>
            </div>
            <form className="form-grid" onSubmit={submit}>
              {Object.entries(draft).map(([key, value]) => (
                <label key={key}>
                  {key}
                  <input value={value} onChange={(event) => update({ [key]: event.target.value })} />
                </label>
              ))}
              {profileError ? <p className="form-warning">{profileError}</p> : null}
              <Button type="submit">저장</Button>
            </form>
          </Card>
          <section className="profile-rating-grid">
            <RatingCard className="profile-rating-primary" title="통합" mmr={user.ratings.integrated} subtitle="메인 티어" />
            {Object.entries(user.ratings.modes).map(([mode, mmr]) => (
              <RatingCard className="profile-rating-mode" key={mode} title={mode} mmr={mmr} subtitle="모드 티어" />
            ))}
          </section>
          <RecentRecordCard records={myRecords} userId={user.id} />
        </div>
        <aside className="page-stack profile-side-grid">
          <ProgressionChecklist user={user} matches={app.state.matches} />
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
                <span>평균 파울</span>
                <strong>{averageFouls.toFixed(1)}</strong>
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
