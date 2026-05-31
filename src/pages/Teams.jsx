import { useMemo, useState } from "react";
import { Crown, PlusCircle, Search, Shield, Swords } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import TeamCard from "../components/team/TeamCard.jsx";
import { COURTS, MAX_TEAM_MEMBERSHIPS, REGIONS } from "../lib/constants.js";

const allRegions = ["전체", ...REGIONS];

export default function Teams({ app }) {
  const [draft, setDraft] = useState({ name: "New Court Crew", region: app.currentUser.region, homeCourt: COURTS[0].name, captainId: app.currentUser.id, accent: "#58d2c0" });
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState(app.currentUser.region ?? "전체");
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const isFavoriteTeam = (team) => favoriteTeamIds.includes(team.id) || (!favoriteTeamIds.length && team.favorite);
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
  const topTeam = [...app.state.teams].sort((a, b) => b.mmr - a.mmr)[0];
  const favoriteTeams = useMemo(() => {
    return [...app.state.teams]
      .filter(isFavoriteTeam)
      .sort((a, b) => Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || b.mmr - a.mmr)
      .slice(0, 10);
  }, [app.currentUser.region, app.state.teams, favoriteTeamIds]);
  const visibleTeams = useMemo(() => {
    return [...app.state.teams]
      .filter((team) => region === "전체" || team.region === region)
      .filter((team) => `${team.name} ${team.region} ${team.homeCourt}`.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || Number(isFavoriteTeam(b)) - Number(isFavoriteTeam(a)) || b.mmr - a.mmr);
  }, [app.currentUser.region, app.state.teams, favoriteTeamIds, query, region]);

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
          <h1>코트 위 팀 랭크를 장악하세요.</h1>
          <p>지역별 팀을 먼저 보고, 자주 찾는 팀을 빠르게 골라 경기방에 연결하세요.</p>
        </div>
        <div className="team-hub-board">
          <span><Crown size={18} /> Top squad</span>
          <strong>{topTeam?.name}</strong>
          <em>{topTeam?.mmr} MMR · {topTeam?.wins}승 {topTeam?.losses}패</em>
          <div>
            <span><Shield size={16} /> regular core</span>
            <span><Swords size={16} /> official ready</span>
          </div>
        </div>
      </section>

      <Card className="section-card selector-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Team Search</p>
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
              <span className={captainLimitReached ? "form-warning" : "form-help"}>
                한 플레이어는 최대 {MAX_TEAM_MEMBERSHIPS}개 팀까지만 소속될 수 있습니다.
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
