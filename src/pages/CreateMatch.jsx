import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import EvidenceSelector from "../components/match/EvidenceSelector.jsx";
import RuleSelector from "../components/match/RuleSelector.jsx";
import TeamBuilder from "../components/match/TeamBuilder.jsx";
import { COURTS, EVIDENCE_OPTIONS, MATCH_MODES, REGIONS } from "../lib/constants.js";

const today = new Date().toISOString().slice(0, 10);
const allRegions = ["전체", ...REGIONS];

function includesQuery(value, query) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

export default function CreateMatch({ app }) {
  const navigate = useNavigate();
  const [teamQuery, setTeamQuery] = useState("");
  const [courtQuery, setCourtQuery] = useState("");
  const [teamRegion, setTeamRegion] = useState(app.currentUser.region ?? "전체");
  const [courtRegion, setCourtRegion] = useState(app.currentUser.region ?? "전체");
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const favoriteCourtIds = app.state.settings?.favoriteCourtIds ?? [];
  const isFavoriteTeam = (team) => favoriteTeamIds.includes(team.id) || (!favoriteTeamIds.length && team.favorite);
  const isFavoriteCourt = (court) => favoriteCourtIds.includes(court.id) || (!favoriteCourtIds.length && court.favorite);
  const [draft, setDraft] = useState({
    title: "오늘의 5v5 공식전",
    mode: "5v5",
    court: COURTS[0].name,
    scheduledDate: today,
    scheduledTime: "20:30",
    teamAId: app.state.teams[0]?.id,
    teamBId: app.state.teams[1]?.id,
    ranked: true,
    official: true,
    preRegistered: true,
    targetScore: 21,
    timeLimit: 12,
    ball: "7호 공",
    winByTwo: true,
    attackRule: "득점 후 공격권 교대",
    foulRule: "파울 콜 즉시 중단, 공격권 유지",
    objectionWindow: "24시간",
    evidence: EVIDENCE_OPTIONS.filter((option) => option.id === "captain"),
    memo: "경기 전 룰을 확정하고, 경기 후 결과를 승인하면 티어에 반영됩니다.",
    stakes: "승자팀 다음 경기 우선권. 금전 거래 없이 약속만 기록합니다.",
  });

  const sortedTeams = useMemo(() => {
    return [...app.state.teams]
      .filter((team) => teamRegion === "전체" || team.region === teamRegion)
      .filter((team) => includesQuery(`${team.name} ${team.region} ${team.homeCourt}`, teamQuery))
      .sort((a, b) => Number(isFavoriteTeam(b)) - Number(isFavoriteTeam(a)) || Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || b.mmr - a.mmr);
  }, [app.currentUser.region, app.state.teams, favoriteTeamIds, teamQuery, teamRegion]);

  const sortedCourts = useMemo(() => {
    return COURTS
      .filter((court) => courtRegion === "전체" || court.region === courtRegion)
      .filter((court) => includesQuery(`${court.name} ${court.region} ${court.type}`, courtQuery))
      .sort((a, b) => Number(isFavoriteCourt(b)) - Number(isFavoriteCourt(a)) || Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || a.name.localeCompare(b.name));
  }, [app.currentUser.region, courtQuery, courtRegion, favoriteCourtIds]);

  const favoriteTeams = useMemo(() => {
    return [...app.state.teams]
      .filter(isFavoriteTeam)
      .sort((a, b) => Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || b.mmr - a.mmr)
      .slice(0, 10);
  }, [app.currentUser.region, app.state.teams, favoriteTeamIds]);

  const favoriteCourts = useMemo(() => {
    return [...COURTS]
      .filter(isFavoriteCourt)
      .sort((a, b) => Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [app.currentUser.region, favoriteCourtIds]);

  const selectedTeams = useMemo(
    () => app.state.teams.filter((team) => team.id === draft.teamAId || team.id === draft.teamBId),
    [app.state.teams, draft.teamAId, draft.teamBId],
  );
  const selectedTeamA = app.state.teams.find((team) => team.id === draft.teamAId);
  const selectedTeamB = app.state.teams.find((team) => team.id === draft.teamBId);
  const selectedCourt = useMemo(
    () => COURTS.find((court) => court.name === draft.court) ?? COURTS[0],
    [draft.court],
  );

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const assignTeam = (teamId, side) => {
    if (side === "A") update({ teamAId: teamId, teamBId: draft.teamBId === teamId ? draft.teamAId : draft.teamBId });
    if (side === "B") update({ teamBId: teamId, teamAId: draft.teamAId === teamId ? draft.teamBId : draft.teamAId });
  };
  const submit = (event) => {
    event.preventDefault();
    const matchId = app.actions.createMatch(draft);
    navigate(matchId ? `/app/matches/${matchId}` : "/app/matches");
  };

  return (
    <form className="page-stack" onSubmit={submit}>
      <header className="page-header">
        <div>
          <p className="eyebrow">CreateMatch</p>
          <h1>오늘의 판 만들기</h1>
        </div>
        <Button type="submit">경기 생성</Button>
      </header>

      <div className="content-grid wide-left">
        <Card className="section-card full-span">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">기본 설정</p>
              <h2>경기 정보와 일정</h2>
            </div>
          </div>
          <div className="form-grid">
            <label>
              제목
              <input value={draft.title} onChange={(event) => update({ title: event.target.value })} />
            </label>
            <label>
              방식
              <select value={draft.mode} onChange={(event) => update({ mode: event.target.value })}>
                {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
              </select>
            </label>
            <label>
              날짜
              <input type="date" value={draft.scheduledDate} onChange={(event) => update({ scheduledDate: event.target.value })} />
            </label>
            <label>
              시간
              <input type="time" value={draft.scheduledTime} onChange={(event) => update({ scheduledTime: event.target.value })} />
            </label>
          </div>
        </Card>

        <Card className="section-card full-span selector-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Court Finder</p>
              <h2>코트 검색</h2>
            </div>
            <Badge tone="green">{draft.court}</Badge>
          </div>
          <div className="search-controls">
            <label>
              지역
              <select value={courtRegion} onChange={(event) => setCourtRegion(event.target.value)}>
                {allRegions.map((region) => <option key={region}>{region}</option>)}
              </select>
            </label>
            <label>
              코트명
              <input value={courtQuery} placeholder="코트, 지역, 실내/야외 검색" onChange={(event) => setCourtQuery(event.target.value)} />
            </label>
          </div>
          <div className="quick-picker">
            <p className="eyebrow">자주 찾는 코트</p>
            <div>
              {favoriteCourts.map((court) => (
                <button key={court.id} type="button" className={draft.court === court.name ? "selected" : ""} onClick={() => update({ court: court.name })}>
                  <strong>{court.name}</strong>
                  <span>{court.region} · {court.type}</span>
                  <small>
                    <b onClick={(event) => { event.stopPropagation(); app.actions.toggleFavoriteCourt(court.id); }}>해제</b>
                  </small>
                </button>
              ))}
            </div>
          </div>
          <select value={draft.court} onChange={(event) => update({ court: event.target.value })}>
            {sortedCourts.map((court) => <option key={court.id} value={court.name}>{court.region} · {court.name} · {court.type}</option>)}
          </select>
          <Button type="button" variant="secondary" onClick={() => app.actions.toggleFavoriteCourt(selectedCourt.id)}>
            {isFavoriteCourt(selectedCourt) ? "선택 코트 즐겨찾기 해제" : "선택 코트 즐겨찾기 추가"}
          </Button>
        </Card>

        <Card className="section-card full-span selector-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Team Finder</p>
              <h2>참여 팀 검색</h2>
            </div>
          </div>
          <div className="search-controls">
            <label>
              지역
              <select value={teamRegion} onChange={(event) => setTeamRegion(event.target.value)}>
                {allRegions.map((region) => <option key={region}>{region}</option>)}
              </select>
            </label>
            <label>
              팀명
              <input value={teamQuery} placeholder="팀, 지역, 홈코트 검색" onChange={(event) => setTeamQuery(event.target.value)} />
            </label>
          </div>
          <div className="quick-picker">
            <p className="eyebrow">자주 찾는 팀</p>
            <div>
              {favoriteTeams.map((team) => (
                <button key={team.id} type="button" className={draft.teamAId === team.id || draft.teamBId === team.id ? "selected" : ""}>
                  <strong>{team.name}</strong>
                  <span>{team.region} · {team.mmr} MMR</span>
                  <small>
                    <b onClick={() => assignTeam(team.id, "A")}>A</b>
                    <b onClick={() => assignTeam(team.id, "B")}>B</b>
                    <b onClick={() => app.actions.toggleFavoriteTeam(team.id)}>해제</b>
                  </small>
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid two">
            <label>
              Team A
              <select value={draft.teamAId} onChange={(event) => update({ teamAId: event.target.value })}>
                {sortedTeams.map((team) => <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>)}
              </select>
            </label>
            <label>
              Team B
              <select value={draft.teamBId} onChange={(event) => update({ teamBId: event.target.value })}>
                {sortedTeams.filter((team) => team.id !== draft.teamAId).map((team) => <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>)}
              </select>
            </label>
          </div>
          <div className="favorite-action-row">
            {selectedTeamA ? (
              <Button type="button" variant="secondary" onClick={() => app.actions.toggleFavoriteTeam(selectedTeamA.id)}>
                A팀 {isFavoriteTeam(selectedTeamA) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              </Button>
            ) : null}
            {selectedTeamB ? (
              <Button type="button" variant="secondary" onClick={() => app.actions.toggleFavoriteTeam(selectedTeamB.id)}>
                B팀 {isFavoriteTeam(selectedTeamB) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              </Button>
            ) : null}
          </div>
          <TeamBuilder teams={selectedTeams} users={app.state.users} draft={draft} onChange={update} />
        </Card>

        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">규칙</p>
              <h2>룰 설정</h2>
            </div>
          </div>
          <RuleSelector draft={draft} onChange={update} />
          <div className="toggle-pair">
            <label><input type="checkbox" checked={draft.ranked} onChange={(event) => update({ ranked: event.target.checked })} /> 랭크 반영</label>
            <label><input type="checkbox" checked={draft.official} onChange={(event) => update({ official: event.target.checked })} /> 공식경기</label>
            <label><input type="checkbox" checked={draft.preRegistered} onChange={(event) => update({ preRegistered: event.target.checked })} /> 사전등록</label>
          </div>
          <div className="form-grid two">
            <label>
              공격권 룰
              <input value={draft.attackRule} onChange={(event) => update({ attackRule: event.target.value })} />
            </label>
            <label>
              파울 룰
              <input value={draft.foulRule} onChange={(event) => update({ foulRule: event.target.value })} />
            </label>
            <label>
              이의제기 시간
              <select value={draft.objectionWindow} onChange={(event) => update({ objectionWindow: event.target.value })}>
                <option>1시간</option>
                <option>6시간</option>
                <option>24시간</option>
              </select>
            </label>
          </div>
        </Card>

        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">계약 조건</p>
              <h2>약속/벌칙 메모</h2>
            </div>
          </div>
          <EvidenceSelector selected={draft.evidence} onChange={(evidence) => update({ evidence })} />
          <label className="memo-label">
            약속/벌칙 메모
            <textarea value={draft.stakes} onChange={(event) => update({ stakes: event.target.value })} />
          </label>
          <label className="memo-label">
            경기 메모
            <textarea value={draft.memo} onChange={(event) => update({ memo: event.target.value })} />
          </label>
        </Card>
      </div>
    </form>
  );
}
