import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Star } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import EvidenceSelector from "../components/match/EvidenceSelector.jsx";
import RuleSelector from "../components/match/RuleSelector.jsx";
import TeamBuilder from "../components/match/TeamBuilder.jsx";
import { COURTS, EVIDENCE_OPTIONS, MATCH_MODES, REGIONS } from "../lib/constants.js";
import { getRecruitingTierRange, isMmrInRecruitingRange } from "../lib/recruiting.js";

const today = new Date().toISOString().slice(0, 10);
const allRegions = ["전체", ...REGIONS];

function includesQuery(value, query) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function getUserTeam(teams, userId) {
  return teams
    .filter((team) => team.members.some((member) => member.userId === userId))
    .sort((a, b) => Number(b.members.some((member) => member.userId === userId && member.role === "captain")) - Number(a.members.some((member) => member.userId === userId && member.role === "captain")) || b.mmr - a.mmr)[0];
}

function getOpponentTeam(teams, teamId, region) {
  return teams.find((team) => team.id !== teamId && team.region === region) ?? teams.find((team) => team.id !== teamId);
}

export default function CreateMatch({ app }) {
  const navigate = useNavigate();
  const defaultTeamA = getUserTeam(app.state.teams, app.currentUser.id) ?? app.state.teams[0];
  const defaultTeamB = getOpponentTeam(app.state.teams, defaultTeamA?.id, app.currentUser.region);
  const [teamQuery, setTeamQuery] = useState("");
  const [courtQuery, setCourtQuery] = useState("");
  const [teamRegion, setTeamRegion] = useState(app.currentUser.region ?? "전체");
  const [courtRegion, setCourtRegion] = useState(app.currentUser.region ?? "전체");
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const favoriteCourtIds = app.state.settings?.favoriteCourtIds ?? [];
  const isFavoriteTeam = (team) => favoriteTeamIds.includes(team.id);
  const isFavoriteCourt = (court) => favoriteCourtIds.includes(court.id);
  const [draft, setDraft] = useState({
    title: "오늘의 5v5 공식전",
    mode: "5v5",
    court: COURTS[0].name,
    scheduledDate: today,
    scheduledTime: "20:30",
    teamAId: defaultTeamA?.id,
    teamBId: defaultTeamB?.id,
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
    memo: "룰 확정 후 결과 승인.",
    stakes: "다음 경기 우선권.",
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

  const selectedTeamA = app.state.teams.find((team) => team.id === draft.teamAId);
  const selectedTeamB = app.state.teams.find((team) => team.id === draft.teamBId);
  const teamOptions = useMemo(() => {
    const teamMap = new Map();
    [selectedTeamA, selectedTeamB, ...sortedTeams].filter(Boolean).forEach((team) => teamMap.set(team.id, team));
    return Array.from(teamMap.values());
  }, [selectedTeamA, selectedTeamB, sortedTeams]);
  const selectedTeams = useMemo(
    () => [selectedTeamA, selectedTeamB].filter(Boolean),
    [selectedTeamA, selectedTeamB],
  );
  const teamTierRange = getRecruitingTierRange(selectedTeamA?.mmr ?? 1200, draft.ranked);
  const teamTierBlocked = Boolean(
    draft.ranked &&
      selectedTeamA &&
      selectedTeamB &&
      !isMmrInRecruitingRange(selectedTeamB.mmr, selectedTeamA.mmr, true),
  );
  const teamSelectionInvalid = !selectedTeamA || !selectedTeamB || selectedTeamA.id === selectedTeamB.id;
  const selectedCourt = useMemo(
    () => COURTS.find((court) => court.name === draft.court) ?? COURTS[0],
    [draft.court],
  );

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  useEffect(() => {
    if (!app.state.teams.length) return;
    setDraft((current) => {
      const teamAExists = app.state.teams.some((team) => team.id === current.teamAId);
      const teamBExists = app.state.teams.some((team) => team.id === current.teamBId);
      const nextTeamAId = teamAExists ? current.teamAId : (getUserTeam(app.state.teams, app.currentUser.id) ?? app.state.teams[0])?.id;
      const nextTeamBId = teamBExists && current.teamBId !== nextTeamAId
        ? current.teamBId
        : getOpponentTeam(app.state.teams, nextTeamAId, app.currentUser.region)?.id;
      if (current.teamAId === nextTeamAId && current.teamBId === nextTeamBId) return current;
      return { ...current, teamAId: nextTeamAId, teamBId: nextTeamBId };
    });
  }, [app.currentUser.id, app.currentUser.region, app.state.teams]);

  const selectTeamA = (teamAId) => {
    const nextTeamBId = draft.teamBId === teamAId
      ? getOpponentTeam(sortedTeams, teamAId, app.currentUser.region)?.id ?? getOpponentTeam(app.state.teams, teamAId, app.currentUser.region)?.id
      : draft.teamBId;
    update({ teamAId, teamBId: nextTeamBId });
  };
  const selectTeamB = (teamBId) => {
    const nextTeamAId = draft.teamAId === teamBId
      ? getOpponentTeam(sortedTeams, teamBId, app.currentUser.region)?.id ?? getOpponentTeam(app.state.teams, teamBId, app.currentUser.region)?.id
      : draft.teamAId;
    update({ teamAId: nextTeamAId, teamBId });
  };
  const assignTeam = (teamId, side) => {
    if (side === "A") selectTeamA(teamId);
    if (side === "B") selectTeamB(teamId);
  };
  const submit = (event) => {
    event.preventDefault();
    if (teamTierBlocked || teamSelectionInvalid) return;
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
        <Button type="submit" disabled={teamTierBlocked || teamSelectionInvalid}>경기 생성</Button>
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
                <button key={court.id} type="button" className={draft.court === court.name ? "favorite-pick selected" : "favorite-pick"} onClick={() => update({ court: court.name })}>
                  <strong><Star size={15} fill="currentColor" /> {court.name}</strong>
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
          <Button
            type="button"
            variant="secondary"
            className={isFavoriteCourt(selectedCourt) ? "favorite-toggle-button active" : "favorite-toggle-button"}
            onClick={() => app.actions.toggleFavoriteCourt(selectedCourt.id)}
          >
            <Star size={16} fill={isFavoriteCourt(selectedCourt) ? "currentColor" : "none"} />
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
          {draft.ranked ? (
            <div className={teamTierBlocked ? "tier-range-note tier-range-note-warning" : "tier-range-note"}>
              <div>
                <span>정규전 허용 구간</span>
                <strong>{teamTierRange.label}</strong>
                <em>{selectedTeamA?.name ?? "A팀"} 기준</em>
              </div>
              <Badge tone={teamTierBlocked ? "orange" : "green"}>{teamTierBlocked ? "제한" : "허용"}</Badge>
            </div>
          ) : (
            <div className="tier-range-note">
              <div>
                <span>친선전</span>
                <strong>티어 자유</strong>
                <em>MMR 소폭</em>
              </div>
              <Badge tone="neutral">OPEN</Badge>
            </div>
          )}
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
                <button key={team.id} type="button" className={draft.teamAId === team.id || draft.teamBId === team.id ? "favorite-pick selected" : "favorite-pick"}>
                  <strong><Star size={15} fill="currentColor" /> {team.name}</strong>
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
              <select value={draft.teamAId ?? ""} onChange={(event) => selectTeamA(event.target.value)}>
                {!teamOptions.length ? <option value="">팀 없음</option> : null}
                {teamOptions
                  .filter((team) => team.id !== draft.teamBId)
                  .map((team) => <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>)}
              </select>
            </label>
            <label>
              Team B
              <select value={draft.teamBId ?? ""} onChange={(event) => selectTeamB(event.target.value)}>
                {!teamOptions.some((team) => team.id !== draft.teamAId) ? <option value="">상대 팀 없음</option> : null}
                {teamOptions
                  .filter((team) => team.id !== draft.teamAId)
                  .map((team) => <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>)}
              </select>
            </label>
          </div>
          <div className="favorite-action-row">
            {selectedTeamA ? (
              <Button
                type="button"
                variant="secondary"
                className={isFavoriteTeam(selectedTeamA) ? "favorite-toggle-button active" : "favorite-toggle-button"}
                onClick={() => app.actions.toggleFavoriteTeam(selectedTeamA.id)}
              >
                <Star size={16} fill={isFavoriteTeam(selectedTeamA) ? "currentColor" : "none"} />
                A팀 {isFavoriteTeam(selectedTeamA) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              </Button>
            ) : null}
            {selectedTeamB ? (
              <Button
                type="button"
                variant="secondary"
                className={isFavoriteTeam(selectedTeamB) ? "favorite-toggle-button active" : "favorite-toggle-button"}
                onClick={() => app.actions.toggleFavoriteTeam(selectedTeamB.id)}
              >
                <Star size={16} fill={isFavoriteTeam(selectedTeamB) ? "currentColor" : "none"} />
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
            <label><input type="checkbox" checked={draft.ranked} onChange={(event) => update({ ranked: event.target.checked })} /> 정규전 반영</label>
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
