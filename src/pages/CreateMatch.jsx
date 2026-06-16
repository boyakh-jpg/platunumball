import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Globe2, Lock, Star, Trophy } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import EvidenceSelector from "../components/match/EvidenceSelector.jsx";
import RuleSelector from "../components/match/RuleSelector.jsx";
import TeamBuilder from "../components/match/TeamBuilder.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { COURTS, EVIDENCE_OPTIONS, MATCH_MODES, REFEREE_TRUST_MIN, REGIONS } from "../lib/constants.js";
import { isEligibleReferee } from "../lib/matchUtils.js";
import { MMR_RANGE_POLICIES, getRecruitingSideCapacity, getRecruitingTierRange, getSelectableTeamPlayerIds, isMmrInRecruitingRange } from "../lib/recruiting.js";

const today = new Date().toISOString().slice(0, 10);
const nextWeek = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString().slice(0, 10);
const maxScheduleDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);
const allRegions = ["전체", ...REGIONS];
const mmrLimitOptions = [
  { id: "off", label: "제한 없음" },
  { id: "warn", label: "경고만" },
  { id: "block", label: "생성 차단" },
];
const tournamentFormatOptions = [
  { id: "league", label: "리그", desc: "모든 팀이 일정 수만큼 경기" },
  { id: "tournament", label: "토너먼트", desc: "패배 시 탈락, 대진표 중심" },
];
const tournamentMmrPolicyOptions = [
  { id: "gap_adjusted", label: "격차 보정" },
  { id: "standard", label: "일반 MMR" },
  { id: "event_only", label: "대회 점수만" },
];
const tournamentScheduleOptions = [
  { id: "weekly", label: "주 1회 배정" },
  { id: "daily", label: "매일 배정" },
  { id: "manual", label: "직접 조율" },
];

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

function getMmrSpread(teams) {
  const mmrs = teams.map((team) => Number(team.mmr ?? 1200));
  return mmrs.length ? Math.max(...mmrs) - Math.min(...mmrs) : 0;
}

function getDefaultTeamPlayerIds(team, capacity) {
  if (!team) return [];
  return getSelectableTeamPlayerIds(team).slice(0, capacity);
}

function getPartyPlayerIds(team, playerIds, capacity) {
  if (!team) return [];
  if (!Array.isArray(playerIds)) return getDefaultTeamPlayerIds(team, capacity);
  const selectableIds = new Set(getSelectableTeamPlayerIds(team));
  return Array.from(new Set(playerIds.filter((playerId) => selectableIds.has(playerId)))).slice(0, capacity);
}

function PublicPartyPicker({ team, users, selectedIds, capacity, onChange }) {
  const userById = Object.fromEntries(users.map((user) => [user.id, user]));
  if (!team) {
    return (
      <div className="public-party-picker empty">
        <span>내 팀을 먼저 선택해야 한다.</span>
      </div>
    );
  }

  const memberIds = getSelectableTeamPlayerIds(team);
  const selectedSet = new Set(selectedIds);
  const toggleMember = (playerId) => {
    const nextIds = selectedSet.has(playerId)
      ? selectedIds.filter((id) => id !== playerId)
      : [...selectedIds, playerId].slice(0, capacity);
    onChange(nextIds);
  };

  return (
    <div className="public-party-picker">
      <div className="public-party-picker-head">
        <span>방장 파티 참여 팀원</span>
        <strong>{selectedIds.length}/{capacity}</strong>
      </div>
      <div className="public-party-picker-grid">
        {memberIds.map((playerId) => {
          const user = userById[playerId];
          const selected = selectedSet.has(playerId);
          const locked = !selected && selectedIds.length >= capacity;
          return (
            <button key={playerId} type="button" className={selected ? "selected" : ""} disabled={locked} onClick={() => toggleMember(playerId)}>
              <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "?"}</span>
              <span>
                <strong>{user?.name ?? "알 수 없음"}</strong>
                <em>{user?.position ?? "포지션 자유"}</em>
              </span>
              <Badge tone={selected ? "green" : "neutral"}>{selected ? "참여" : "대기"}</Badge>
            </button>
          );
        })}
      </div>
      {!selectedIds.length ? <em>최소 1명 선택 필요</em> : null}
    </div>
  );
}

export default function CreateMatch({ app }) {
  const navigate = useNavigate();
  const defaultTeamA = getUserTeam(app.state.teams, app.currentUser.id) ?? app.state.teams[0];
  const defaultTeamB = getOpponentTeam(app.state.teams, defaultTeamA?.id, app.currentUser.region);
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const [teamQuery, setTeamQuery] = useState("");
  const [courtQuery, setCourtQuery] = useState("");
  const [teamRegion, setTeamRegion] = useState(app.currentUser.region ?? "전체");
  const [courtRegion, setCourtRegion] = useState(app.currentUser.region ?? "전체");
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const favoriteCourtIds = app.state.settings?.favoriteCourtIds ?? [];
  const isFavoriteTeam = (team) => favoriteTeamIds.includes(team.id);
  const isFavoriteCourt = (court) => favoriteCourtIds.includes(court.id);
  const [draft, setDraft] = useState({
    visibility: "private",
    hostJoinMode: "team",
    mmrLimitMode: "block",
    mmrRangeMode: "narrow",
    title: "오늘의 5v5 공식전",
    mode: "5v5",
    court: COURTS[0].name,
    scheduledDate: today,
    scheduledTime: "20:30",
    teamAId: defaultTeamA?.id,
    teamBId: defaultTeamB?.id,
    playerIds: getDefaultTeamPlayerIds(defaultTeamA, getRecruitingSideCapacity({ mode: "5v5" })),
    refereeId: "",
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
    tournamentFormat: "league",
    tournamentTeamIds: [defaultTeamA?.id, defaultTeamB?.id].filter(Boolean),
    tournamentEndDate: nextWeek,
    tournamentSchedulePolicy: "weekly",
    tournamentScheduleNote: "초대팀 확정 후 경기별 일정을 배정합니다.",
    tournamentMmrPolicy: "gap_adjusted",
    tournamentMaxMmrGap: 250,
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
  const publicPartyCapacity = getRecruitingSideCapacity(draft);
  const publicPartyPlayerIds = getPartyPlayerIds(selectedTeamA, draft.playerIds, publicPartyCapacity);
  const tournamentTeams = useMemo(
    () => (draft.tournamentTeamIds ?? []).map((teamId) => app.state.teams.find((team) => team.id === teamId)).filter(Boolean),
    [app.state.teams, draft.tournamentTeamIds],
  );
  const tournamentMmrSpread = getMmrSpread(tournamentTeams);
  const teamOptions = useMemo(() => {
    const teamMap = new Map();
    [selectedTeamA, selectedTeamB, ...tournamentTeams, ...sortedTeams].filter(Boolean).forEach((team) => teamMap.set(team.id, team));
    return Array.from(teamMap.values());
  }, [selectedTeamA, selectedTeamB, sortedTeams, tournamentTeams]);
  const selectedTeams = useMemo(
    () => (draft.visibility === "public"
      ? (draft.hostJoinMode === "team" ? [selectedTeamA].filter(Boolean) : [])
      : [selectedTeamA, selectedTeamB].filter(Boolean)),
    [draft.hostJoinMode, draft.visibility, selectedTeamA, selectedTeamB],
  );
  const isPublicRoom = draft.visibility === "public";
  const isTournamentRoom = draft.visibility === "tournament";
  const activePlayerIds = useMemo(() => {
    const capacity = getRecruitingSideCapacity(draft);
    if (isPublicRoom) return new Set(draft.hostJoinMode === "team" ? publicPartyPlayerIds : [app.currentUser.id]);
    return new Set([
      ...getDefaultTeamPlayerIds(selectedTeamA, capacity),
      ...getDefaultTeamPlayerIds(selectedTeamB, capacity),
    ]);
  }, [app.currentUser.id, draft, isPublicRoom, publicPartyPlayerIds, selectedTeamA, selectedTeamB]);
  const refereeCandidates = useMemo(
    () => app.state.users
      .filter((user) => isEligibleReferee(user, REFEREE_TRUST_MIN))
      .filter((user) => !activePlayerIds.has(user.id))
      .sort((a, b) => Number(b.trustScore ?? 0) - Number(a.trustScore ?? 0)),
    [activePlayerIds, app.state.users],
  );
  const teamTierRange = getRecruitingTierRange(selectedTeamA?.mmr ?? 1200, draft.ranked, draft.mmrRangeMode);
  const mmrRangePolicy = MMR_RANGE_POLICIES[draft.mmrRangeMode] ?? MMR_RANGE_POLICIES.narrow;
  const teamTierBlocked = Boolean(
    !isPublicRoom &&
      !isTournamentRoom &&
      draft.mmrLimitMode === "block" &&
      draft.ranked &&
      selectedTeamA &&
      selectedTeamB &&
      !isMmrInRecruitingRange(selectedTeamB.mmr, selectedTeamA.mmr, true, draft.mmrRangeMode),
  );
  const teamTierWarned = Boolean(
    !isPublicRoom &&
      !isTournamentRoom &&
      draft.mmrLimitMode === "warn" &&
      draft.ranked &&
      selectedTeamA &&
      selectedTeamB &&
      !isMmrInRecruitingRange(selectedTeamB.mmr, selectedTeamA.mmr, true, draft.mmrRangeMode),
  );
  const scheduleAllowed = draft.scheduledDate >= today && draft.scheduledDate <= maxScheduleDate;
  const tournamentEndAllowed = !isTournamentRoom || (draft.tournamentEndDate >= today && draft.tournamentEndDate <= maxScheduleDate);
  const privateTeamInvalid = !selectedTeamA || !selectedTeamB || selectedTeamA.id === selectedTeamB.id;
  const publicTeamInvalid = draft.hostJoinMode === "team" && (
    !myTeams.some((team) => team.id === draft.teamAId) || !publicPartyPlayerIds.length
  );
  const tournamentMmrBlocked = Boolean(
    isTournamentRoom &&
      draft.ranked &&
      draft.mmrLimitMode === "block" &&
      tournamentMmrSpread > Number(draft.tournamentMaxMmrGap ?? 250),
  );
  const tournamentInvalid = !draft.title.trim() || tournamentTeams.length < 2 || tournamentMmrBlocked;
  const submitDisabled = !scheduleAllowed || !tournamentEndAllowed || (isTournamentRoom
    ? tournamentInvalid
    : isPublicRoom
      ? publicTeamInvalid
      : teamTierBlocked || privateTeamInvalid);
  const selectedCourt = useMemo(
    () => COURTS.find((court) => court.name === draft.court) ?? COURTS[0],
    [draft.court],
  );

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  useEffect(() => {
    if (!draft.refereeId) return;
    if (refereeCandidates.some((user) => user.id === draft.refereeId)) return;
    setDraft((current) => ({ ...current, refereeId: "" }));
  }, [draft.refereeId, refereeCandidates]);

  useEffect(() => {
    if (!app.state.teams.length) return;
    setDraft((current) => {
      const teamAExists = app.state.teams.some((team) => team.id === current.teamAId);
      const teamBExists = app.state.teams.some((team) => team.id === current.teamBId);
      const tournamentTeamIds = (current.tournamentTeamIds ?? []).filter((teamId) => app.state.teams.some((team) => team.id === teamId));
      const nextTeamAId = teamAExists ? current.teamAId : (getUserTeam(app.state.teams, app.currentUser.id) ?? app.state.teams[0])?.id;
      const nextTeamBId = teamBExists && current.teamBId !== nextTeamAId
        ? current.teamBId
        : getOpponentTeam(app.state.teams, nextTeamAId, app.currentUser.region)?.id;
      if (current.teamAId === nextTeamAId && current.teamBId === nextTeamBId && tournamentTeamIds.length === (current.tournamentTeamIds ?? []).length) return current;
      return { ...current, teamAId: nextTeamAId, teamBId: nextTeamBId, tournamentTeamIds };
    });
  }, [app.currentUser.id, app.currentUser.region, app.state.teams]);

  useEffect(() => {
    if (!isPublicRoom || draft.hostJoinMode !== "team" || !selectedTeamA) return;
    const selectableIds = getSelectableTeamPlayerIds(selectedTeamA);
    const selectedIds = getPartyPlayerIds(selectedTeamA, draft.playerIds, publicPartyCapacity);
    const playerIdsNeedSync = !Array.isArray(draft.playerIds)
      || draft.playerIds.length > publicPartyCapacity
      || draft.playerIds.some((playerId) => !selectableIds.includes(playerId));
    if (!playerIdsNeedSync) return;
    setDraft((current) => ({
      ...current,
      playerIds: selectedIds.length ? selectedIds : getDefaultTeamPlayerIds(selectedTeamA, publicPartyCapacity),
    }));
  }, [draft.hostJoinMode, draft.playerIds, isPublicRoom, publicPartyCapacity, selectedTeamA]);

  const selectTeamA = (teamAId) => {
    const nextTeamBId = draft.teamBId === teamAId
      ? getOpponentTeam(sortedTeams, teamAId, app.currentUser.region)?.id ?? getOpponentTeam(app.state.teams, teamAId, app.currentUser.region)?.id
      : draft.teamBId;
    const team = app.state.teams.find((item) => item.id === teamAId);
    update({
      teamAId,
      teamBId: nextTeamBId,
      ...(isPublicRoom && draft.hostJoinMode === "team" ? { playerIds: getDefaultTeamPlayerIds(team, publicPartyCapacity) } : {}),
    });
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
  const toggleTournamentTeam = (teamId) => {
    setDraft((current) => {
      const teamIds = current.tournamentTeamIds ?? [];
      return {
        ...current,
        tournamentTeamIds: teamIds.includes(teamId)
          ? teamIds.filter((id) => id !== teamId)
          : [...teamIds, teamId],
      };
    });
  };
  const submit = (event) => {
    event.preventDefault();
    if (submitDisabled) return;
    if (isTournamentRoom) {
      const tournamentId = app.actions.createTournament({
        ...draft,
        teamIds: draft.tournamentTeamIds,
        region: selectedCourt.region,
      });
      if (tournamentId) navigate("/app/matches");
      return;
    }
    if (isPublicRoom) {
      app.actions.createRecruitingPost({
        title: draft.title,
        hostJoinMode: draft.hostJoinMode,
        teamId: draft.hostJoinMode === "team" ? draft.teamAId : "",
        playerIds: draft.hostJoinMode === "team" ? publicPartyPlayerIds : [],
        refereeId: draft.refereeId,
        targetTeamId: draft.teamBId,
        region: selectedCourt.region,
        court: draft.court,
        scheduledDate: draft.scheduledDate,
        scheduledTime: draft.scheduledTime,
        mode: draft.mode,
        ranked: draft.ranked,
        mmrRangeMode: draft.mmrRangeMode,
        memo: [
          draft.memo,
          selectedTeamB ? `희망 상대: ${selectedTeamB.name}` : "",
          "공개방: 개인 또는 팀 파티가 빈 슬롯에 참여할 수 있습니다.",
        ].filter(Boolean).join("\n"),
      });
      navigate("/app/recruiting");
      return;
    }
    const matchId = app.actions.createMatch(draft);
    navigate(matchId ? `/app/matches/${matchId}` : "/app/matches");
  };

  return (
    <form className="page-stack" onSubmit={submit}>
      <header className="page-header">
        <div>
          <p className="eyebrow">CreateMatch</p>
          <h1>경기/대회 만들기</h1>
        </div>
        <Button type="submit" disabled={submitDisabled}>{isTournamentRoom ? "대회 생성" : isPublicRoom ? "매칭에 공개" : "경기 생성"}</Button>
      </header>

      <div className="content-grid wide-left">
        <Card className="section-card full-span">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Room visibility</p>
              <h2>공개 범위</h2>
            </div>
            <Badge tone={isTournamentRoom ? "gold" : isPublicRoom ? "green" : "neutral"}>{isTournamentRoom ? "비공개 대회" : isPublicRoom ? "공개방" : "비공개방"}</Badge>
          </div>
          <div className="create-mode-grid">
            <button type="button" className={draft.visibility === "private" ? "active" : ""} onClick={() => update({ visibility: "private" })}>
              <Lock size={19} />
              <span>
                <strong>비공개 경기방</strong>
                <em>선택한 A팀/B팀으로 바로 경기 계약서를 만든다.</em>
              </span>
            </button>
            <button
              type="button"
              className={draft.visibility === "public" ? "active" : ""}
              onClick={() => {
                const team = defaultTeamA ?? selectedTeamA;
                update({
                  visibility: "public",
                  hostJoinMode: "team",
                  teamAId: team?.id ?? draft.teamAId,
                  playerIds: getDefaultTeamPlayerIds(team, publicPartyCapacity),
                });
              }}
            >
              <Globe2 size={19} />
              <span>
                <strong>공개 매칭방</strong>
                <em>매칭 목록에 노출하고 빈 슬롯을 개인/팀 파티가 채운다.</em>
              </span>
            </button>
            <button type="button" className={isTournamentRoom ? "active" : ""} onClick={() => {
              setTeamRegion("전체");
              update({ visibility: "tournament", tournamentTeamIds: draft.tournamentTeamIds?.length ? draft.tournamentTeamIds : [defaultTeamA?.id, defaultTeamB?.id].filter(Boolean) });
            }}>
              <Trophy size={19} />
              <span>
                <strong>비공개 대회방</strong>
                <em>초대팀, 리그/토너먼트, 일정, MMR 룰을 한 번에 정한다.</em>
              </span>
            </button>
          </div>
        </Card>

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
            {isPublicRoom ? (
              <label>
                방장 참여
                <select
                  value={draft.hostJoinMode}
                  onChange={(event) => {
                    const hostJoinMode = event.target.value;
                    update({
                      hostJoinMode,
                      playerIds: hostJoinMode === "team" ? getDefaultTeamPlayerIds(selectedTeamA, publicPartyCapacity) : [],
                    });
                  }}
                >
                  <option value="team">내 팀 파티로 열기</option>
                  <option value="player">개인으로 열기</option>
                </select>
              </label>
            ) : null}
            {isTournamentRoom ? (
              <label>
                대회 방식
                <select value={draft.tournamentFormat} onChange={(event) => update({ tournamentFormat: event.target.value })}>
                  {tournamentFormatOptions.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.desc}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              방식
              <select value={draft.mode} onChange={(event) => update({ mode: event.target.value })}>
                {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
              </select>
            </label>
            <label>
              날짜
              <input type="date" min={today} max={maxScheduleDate} value={draft.scheduledDate} onChange={(event) => update({ scheduledDate: event.target.value })} />
            </label>
            <label>
              시간
              <input type="time" value={draft.scheduledTime} onChange={(event) => update({ scheduledTime: event.target.value })} />
            </label>
            {!isTournamentRoom ? (
              <>
                <label>
                  심판
                  <select value={draft.refereeId} onChange={(event) => update({ refereeId: event.target.value })}>
                    <option value="">초대 안 함 · 개인 기록은 득점만</option>
                    {refereeCandidates.map((user) => (
                      <option key={user.id} value={user.id}>{user.name} · 신뢰도 {user.trustScore}</option>
                    ))}
                  </select>
                </label>
                <div className="stat-integrity-note">
                  심판은 신뢰도 {REFEREE_TRUST_MIN} 이상만 가능. 초대 시 심판만 득점/리바운드/어시스트/스틸/블록을 입력한다.
                </div>
              </>
            ) : null}
            {isTournamentRoom ? (
              <>
                <label>
                  종료일
                  <input type="date" min={today} max={maxScheduleDate} value={draft.tournamentEndDate} onChange={(event) => update({ tournamentEndDate: event.target.value })} />
                </label>
                <label>
                  일정 배정
                  <select value={draft.tournamentSchedulePolicy} onChange={(event) => update({ tournamentSchedulePolicy: event.target.value })}>
                    {tournamentScheduleOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              </>
            ) : null}
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
              <h2>{isTournamentRoom ? "초대 팀 선택" : isPublicRoom ? "내 파티와 희망 상대" : "참여 팀 검색"}</h2>
            </div>
          </div>
          {isTournamentRoom ? (
            <div className={tournamentMmrBlocked ? "tier-range-note tier-range-note-warning" : "tier-range-note"}>
              <div>
                <span>초대팀 MMR 차이</span>
                <strong>{tournamentTeams.length}팀 · {tournamentMmrSpread}점 차이</strong>
                <em>{draft.mmrLimitMode === "off" ? "제한 없음" : `${draft.tournamentMaxMmrGap}점 기준`}</em>
              </div>
              <Badge tone={tournamentMmrBlocked ? "orange" : "green"}>{tournamentMmrBlocked ? "차단" : "허용"}</Badge>
            </div>
          ) : draft.ranked ? (
            <div className={teamTierBlocked ? "tier-range-note tier-range-note-warning" : "tier-range-note"}>
              <div>
                <span>정규전 허용 구간</span>
                <strong>{teamTierRange.label}</strong>
                <em>{teamTierWarned ? "경고만 표시" : `${selectedTeamA?.name ?? "A팀"} 기준`}</em>
              </div>
              <Badge tone={teamTierBlocked || teamTierWarned ? "orange" : "green"}>{teamTierBlocked ? "차단" : teamTierWarned ? "경고" : "허용"}</Badge>
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
          {!isTournamentRoom && draft.ranked ? (
            <div className="mmr-range-mode-control">
              <div>
                <span>허용구간 선택</span>
                <strong>{teamTierRange.detail}</strong>
                <em>{mmrRangePolicy.detail} · 경기 확정 시 MMR {Math.round(mmrRangePolicy.ratingScale * 100)}% 반영</em>
              </div>
              <div className="segmented-control compact-segments">
                {Object.entries(MMR_RANGE_POLICIES).map(([mode, policy]) => (
                  <button
                    key={mode}
                    type="button"
                    className={draft.mmrRangeMode === mode ? "active" : ""}
                    onClick={() => update({ mmrRangeMode: mode })}
                  >
                    {policy.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="form-grid two">
            <label>
              MMR 제한
              <select value={draft.mmrLimitMode} onChange={(event) => update({ mmrLimitMode: event.target.value })}>
                {mmrLimitOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            {isTournamentRoom ? (
              <label>
                허용 MMR 차이
                <input type="number" min="0" step="10" value={draft.tournamentMaxMmrGap} onChange={(event) => update({ tournamentMaxMmrGap: event.target.value })} />
              </label>
            ) : null}
            {isTournamentRoom ? (
              <label>
                MMR 득점 룰
                <select value={draft.tournamentMmrPolicy} onChange={(event) => update({ tournamentMmrPolicy: event.target.value })}>
                  {tournamentMmrPolicyOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
            ) : null}
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
              {favoriteTeams.map((team) => {
                const invited = (draft.tournamentTeamIds ?? []).includes(team.id);
                const selected = isTournamentRoom ? invited : draft.teamAId === team.id || draft.teamBId === team.id;
                return (
                  <button key={team.id} type="button" className={selected ? "favorite-pick selected" : "favorite-pick"}>
                    <TeamHoverCard team={team} as="span"><strong><Star size={15} fill="currentColor" /> {team.name}</strong></TeamHoverCard>
                    <span>{team.region} · {team.mmr} MMR</span>
                    <small>
                      {isTournamentRoom ? (
                        <b onClick={() => toggleTournamentTeam(team.id)}>{invited ? "초대 해제" : "초대"}</b>
                      ) : (
                        <>
                          <b onClick={() => assignTeam(team.id, "A")}>A</b>
                          <b onClick={() => assignTeam(team.id, "B")}>B</b>
                        </>
                      )}
                      <b onClick={() => app.actions.toggleFavoriteTeam(team.id)}>즐겨찾기 해제</b>
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
          {isTournamentRoom ? (
            <>
              <div className="tournament-selected-strip">
                <span>선택 {tournamentTeams.length}팀 · 팀 수 제한 없음 · 2의 거듭제곱이 아니면 부전승 자동 배정</span>
                <div>
                  {tournamentTeams.map((team) => (
                    <button key={team.id} type="button" onClick={() => toggleTournamentTeam(team.id)}>
                      <TeamHoverCard team={team} as="span"><strong>{team.name}</strong></TeamHoverCard>
                      <em>해제</em>
                    </button>
                  ))}
                </div>
              </div>
              <div className="tournament-team-grid">
                {teamOptions.map((team) => {
                  const invited = (draft.tournamentTeamIds ?? []).includes(team.id);
                  return (
                    <button key={team.id} type="button" className={invited ? "active" : ""} onClick={() => toggleTournamentTeam(team.id)}>
                      <TeamHoverCard team={team} as="span"><strong>{team.name}</strong></TeamHoverCard>
                      <span>{team.region} · {team.homeCourt}</span>
                      <em>{team.mmr} MMR</em>
                    </button>
                  );
                })}
              </div>
              <div className="create-public-note">
                <Trophy size={17} />
                <span>비공개 대회는 초대팀만 보이게 저장된다. 경기 자동 생성 전 단계라 일정/룰/초대팀을 먼저 확정한다.</span>
              </div>
            </>
          ) : (
            <div className="form-grid two">
              <label>
                {isPublicRoom ? "내 팀/파티" : "Team A"}
                <select value={draft.teamAId ?? ""} onChange={(event) => selectTeamA(event.target.value)}>
                  {!(isPublicRoom ? myTeams : teamOptions).length ? <option value="">팀 없음</option> : null}
                  {(isPublicRoom ? myTeams : teamOptions)
                    .filter((team) => team.id !== draft.teamBId)
                    .map((team) => <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>)}
                </select>
              </label>
              <label>
                {isPublicRoom ? "희망 상대팀" : "Team B"}
                <select value={draft.teamBId ?? ""} onChange={(event) => selectTeamB(event.target.value)}>
                  {!teamOptions.some((team) => team.id !== draft.teamAId) ? <option value="">상대 팀 없음</option> : null}
                  {teamOptions
                    .filter((team) => team.id !== draft.teamAId)
                    .map((team) => <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>)}
                </select>
              </label>
            </div>
          )}
          {isPublicRoom && draft.hostJoinMode === "team" ? (
            <PublicPartyPicker
              team={selectedTeamA}
              users={app.state.users}
              selectedIds={publicPartyPlayerIds}
              capacity={publicPartyCapacity}
              onChange={(playerIds) => update({ playerIds })}
            />
          ) : null}
          {isPublicRoom ? (
            <div className="create-public-note">
              <Globe2 size={17} />
              <span>공개방은 매칭 목록에 노출된다. 희망 상대팀은 표시용이고, 실제 참여자는 방에서 대기/확정한다.</span>
            </div>
          ) : null}
          {!isTournamentRoom ? (
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
          ) : null}
          {isTournamentRoom ? null : <TeamBuilder teams={selectedTeams} users={app.state.users} draft={draft} onChange={update} />}
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
            {isTournamentRoom ? (
              <label>
                일정 메모
                <input value={draft.tournamentScheduleNote} onChange={(event) => update({ tournamentScheduleNote: event.target.value })} />
              </label>
            ) : null}
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
