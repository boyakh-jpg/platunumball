import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, PlusCircle, Search, Shield, Swords } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import TeamCard from "../components/team/TeamCard.jsx";
import { COURTS, MAX_TEAM_MEMBERSHIPS, REGIONS } from "../lib/constants.js";

const allRegions = ["전체", ...REGIONS];

const roleLabels = {
  captain: "주장",
  regular: "정규",
  candidate: "후보",
  substitute: "후보",
  mercenary: "용병",
  guest: "게스트",
};

function getTeamSide(match, teamId) {
  if (match.teamA.teamId === teamId) return "teamA";
  if (match.teamB.teamId === teamId) return "teamB";
  return null;
}

function getSideScore(match, sideName) {
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return Number(match.result?.[resultKey] ?? match[sideName]?.score ?? 0);
}

function getTeamRecord(matches, teamId) {
  return matches.reduce((record, match) => {
    if (match.status !== "confirmed") return record;
    const sideName = getTeamSide(match, teamId);
    if (!sideName) return record;
    const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
    const score = getSideScore(match, sideName);
    const opponentScore = getSideScore(match, oppositeSide);
    if (score > opponentScore) record.wins += 1;
    if (score < opponentScore) record.losses += 1;
    if (score === opponentScore) record.draws += 1;
    record.played += 1;
    return record;
  }, { wins: 0, losses: 0, draws: 0, played: 0 });
}

function compareTeamRank(a, b) {
  const aWinRate = a.played ? a.wins / a.played : 0;
  const bWinRate = b.played ? b.wins / b.played : 0;
  return b.mmr - a.mmr || bWinRate - aWinRate || b.played - a.played || a.name.localeCompare(b.name);
}

export default function Teams({ app }) {
  const [draft, setDraft] = useState({ name: "New Court Crew", region: app.currentUser.region, homeCourt: COURTS[0].name, captainId: app.currentUser.id, accent: "#58d2c0" });
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState(app.currentUser.region ?? "전체");
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const isFavoriteTeam = (team) => favoriteTeamIds.includes(team.id);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const teamCountByUser = useMemo(() => {
    const counts = new Map();
    app.state.teams.forEach((team) => {
      team.members.forEach((member) => counts.set(member.userId, (counts.get(member.userId) ?? 0) + 1));
    });
    return counts;
  }, [app.state.teams]);
  const selectedCaptainTeamCount = teamCountByUser.get(draft.captainId) ?? 0;
  const captainLimitReached = selectedCaptainTeamCount >= MAX_TEAM_MEMBERSHIPS;
  const rankingTeams = useMemo(() => {
    return app.state.teams
      .map((team) => ({ ...team, ...getTeamRecord(app.state.matches, team.id) }))
      .sort(compareTeamRank)
      .map((team, index) => ({ ...team, rank: index + 1 }));
  }, [app.state.matches, app.state.teams]);
  const topTeam = rankingTeams[0];
  const myTeams = useMemo(() => {
    return rankingTeams
      .filter((team) => team.members.some((member) => member.userId === app.currentUser.id))
      .map((team) => ({ ...team, myRole: team.members.find((member) => member.userId === app.currentUser.id)?.role ?? "regular" }))
      .sort((a, b) => Number(b.myRole === "captain") - Number(a.myRole === "captain") || a.rank - b.rank);
  }, [app.currentUser.id, rankingTeams]);
  const favoriteTeams = useMemo(() => {
    return rankingTeams
      .filter(isFavoriteTeam)
      .slice(0, 10);
  }, [favoriteTeamIds, rankingTeams]);
  const visibleTeams = useMemo(() => {
    return rankingTeams
      .filter((team) => region === "전체" || team.region === region)
      .filter((team) => `${team.name} ${team.region} ${team.homeCourt}`.toLowerCase().includes(query.trim().toLowerCase()));
  }, [query, rankingTeams, region]);

  const submit = (event) => {
    event.preventDefault();
    app.actions.createTeam(draft);
    setDraft({ name: "New Court Crew", region: app.currentUser.region, homeCourt: COURTS[0].name, captainId: app.currentUser.id, accent: "#58d2c0" });
  };

  return (
    <div className="page-stack teams-page">
      <section className="team-hub-hero">
        <div>
          <p className="eyebrow">Squad House</p>
          <h1>팀 허브</h1>
          <p>내 팀 관리, 팀 탐색, 전체 팀 랭킹을 한 화면에서 확인합니다.</p>
        </div>
        <div className="team-hub-board">
          <span><Crown size={18} /> 전체 1위 팀</span>
          <strong>{topTeam?.name}</strong>
          <em>{topTeam?.mmr} MMR · {topTeam?.wins}승 {topTeam?.losses}패 · {topTeam?.played}경기</em>
          <div>
            <span><Shield size={16} /> MMR 우선</span>
            <span><Swords size={16} /> 승률 보정</span>
          </div>
        </div>
      </section>

      <section className="team-overview-grid">
        <Card className="section-card my-team-management-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">My Teams</p>
              <h2>내 팀 관리</h2>
            </div>
            <Badge tone={myTeams.length > MAX_TEAM_MEMBERSHIPS ? "orange" : myTeams.length ? "green" : "neutral"}>{myTeams.length}/{MAX_TEAM_MEMBERSHIPS}</Badge>
          </div>
          <div className="my-team-list">
            {myTeams.length ? myTeams.map((team) => {
              const winRate = team.played ? Math.round((team.wins / team.played) * 100) : 0;
              const isCaptain = team.myRole === "captain";
              return (
                <Link key={team.id} className="my-team-row" to={`/app/teams/${team.id}${isCaptain ? "#team-control" : ""}`}>
                  <span className="team-rank-chip">#{team.rank}</span>
                  <span className="team-mini-dot" style={{ "--team-color": team.accent }} />
                  <strong>{team.name}</strong>
                  <em>{roleLabels[team.myRole] ?? team.myRole} · {team.mmr} MMR · {winRate}%</em>
                  <TierBadge mmr={team.mmr} compact />
                  <b>{isCaptain ? "관리" : "상세"}</b>
                </Link>
              );
            }) : (
              <div className="empty-state">소속 팀이 없습니다. 오른쪽에서 팀을 만들거나 모집에 지원하세요.</div>
            )}
          </div>
        </Card>

        <Card className="section-card team-rank-rule-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Ranking Rule</p>
              <h2>랭킹 기준</h2>
            </div>
          </div>
          <div className="rank-rule-list">
            <div><strong>1</strong><span>팀 MMR 높은 순</span></div>
            <div><strong>2</strong><span>동률이면 확정 경기 승률</span></div>
            <div><strong>3</strong><span>그래도 같으면 확정 경기수</span></div>
          </div>
          <p className="team-ranking-note">즐겨찾기와 지역 필터는 탐색용입니다. 순위 번호는 전체 랭킹 기준으로 고정됩니다.</p>
        </Card>
      </section>

      <Card className="section-card selector-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Team Ranking</p>
            <h2>팀 검색과 지역 정렬</h2>
          </div>
          <Search size={22} />
        </div>
        <div className="search-controls">
          <label>
            지역
            <select value={region} onChange={(event) => setRegion(event.target.value)}>
              {allRegions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            팀명/홈코트
            <input value={query} placeholder="Noeul, 마포, 한강..." onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        <div className="quick-picker">
          <p className="eyebrow">자주 찾는 팀 10</p>
          <div>
            {favoriteTeams.map((team) => (
              <button key={team.id} type="button" onClick={() => { setRegion(team.region); setQuery(team.name); }}>
                <strong>{team.name}</strong>
                <span>{team.region} · {team.mmr} MMR</span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="content-grid">
        <section className="card-grid">
          {visibleTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              users={app.state.users}
              rank={team.rank}
              favorite={isFavoriteTeam(team)}
              onToggleFavorite={() => app.actions.toggleFavoriteTeam(team.id)}
            />
          ))}
        </section>
        <Card className="section-card team-create-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Create Squad</p>
              <h2>새 팀 만들기</h2>
            </div>
            <PlusCircle size={22} />
          </div>
          <form className="form-stack" onSubmit={submit}>
            <label>
              팀 이름
              <input value={draft.name} onChange={(event) => update({ name: event.target.value })} />
            </label>
            <label>
              지역
              <select value={draft.region} onChange={(event) => update({ region: event.target.value })}>
                {REGIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              홈 코트
              <select value={draft.homeCourt} onChange={(event) => update({ homeCourt: event.target.value })}>
                {COURTS.filter((court) => court.region === draft.region || draft.region === "전체").map((court) => <option key={court.id} value={court.name}>{court.name}</option>)}
              </select>
            </label>
            <label>
              주장
              <select value={draft.captainId} onChange={(event) => update({ captainId: event.target.value })}>
                {app.state.users.map((user) => {
                  const count = teamCountByUser.get(user.id) ?? 0;
                  return (
                    <option key={user.id} value={user.id} disabled={count >= MAX_TEAM_MEMBERSHIPS}>
                      {user.name} · {user.position} · {count}/{MAX_TEAM_MEMBERSHIPS}팀
                    </option>
                  );
                })}
              </select>
              <span className={captainLimitReached ? "form-warning" : "form-chip"}>
                {selectedCaptainTeamCount}/{MAX_TEAM_MEMBERSHIPS}팀
              </span>
            </label>
            <label>
              팀 컬러
              <input type="color" value={draft.accent} onChange={(event) => update({ accent: event.target.value })} />
            </label>
            <Button type="submit" disabled={captainLimitReached}><PlusCircle size={18} /> 팀 만들기</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
