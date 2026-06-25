import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Globe2, Lock, Trophy } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import RuleSelector from "../components/match/RuleSelector.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { MATCH_MODES, REFEREE_TRUST_MIN, REGIONS } from "../lib/constants.js";
import { getCourtLayoutLabel, getCourtPlayWarning, getCourtSurfaceLabel, getRegisteredCourts } from "../lib/courts.js";
import { getCourtHashtag, getTeamHashtag } from "../lib/handles.js";
import { getPublicRoomMaxDateInput, isEligibleReferee } from "../lib/matchUtils.js";
import { AGE_GROUPS, getAgeGroupForUser } from "../lib/profileSetup.js";
import { MMR_RANGE_POLICIES, getRecruitingSideCapacity, getRecruitingTierRange, getSelectableTeamPlayerIds, isMmrInRecruitingRange } from "../lib/recruiting.js";

const today = new Date().toISOString().slice(0, 10);
const nextWeek = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString().slice(0, 10);
const maxScheduleDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);
const maxPrivateScheduleDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10);
const maxPublicScheduleDate = getPublicRoomMaxDateInput();
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

const ageRestrictionOptions = [
  { id: "any", label: "연령 무관", desc: "모든 연령 참여", allowedGroups: AGE_GROUPS.map((group) => group.id) },
  { id: "junior", label: "Junior", desc: "Junior 전용", allowedGroups: ["junior"] },
  { id: "rising", label: "Rising", desc: "Rising 전용", allowedGroups: ["rising"] },
  { id: "open", label: "Open", desc: "Open 전용", allowedGroups: ["open"] },
  { id: "junior_rising", label: "Junior ~ Rising", desc: "Junior / Rising 참여", allowedGroups: ["junior", "rising"] },
  { id: "rising_open", label: "Rising ~ Open", desc: "Rising / Open 참여", allowedGroups: ["rising", "open"] },
];

function getAgeRestrictionOption(ageRestriction) {
  return ageRestrictionOptions.find((option) => option.id === ageRestriction) ?? ageRestrictionOptions[0];
}

function getAgeRestrictionFromGroups(groupIds = []) {
  const order = AGE_GROUPS.map((group) => group.id);
  const groups = order.filter((groupId) => groupIds.includes(groupId));
  if (!groups.length || groups.length === order.length) return "any";
  return groups.join("_");
}

function toggleAgeRestriction(ageRestriction, groupId) {
  const currentOption = getAgeRestrictionOption(ageRestriction);
  const currentGroups = [...currentOption.allowedGroups];
  const nextSet = new Set(currentGroups);
  if (nextSet.has(groupId)) {
    if (nextSet.size > 1) nextSet.delete(groupId);
  }
  else nextSet.add(groupId);
  if (nextSet.has("junior") && nextSet.has("open")) nextSet.add("rising");
  return getAgeRestrictionFromGroups([...nextSet]);
}

const MAX_PARTY_RESERVES = 2;

function includesQuery(value, query) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function isHashtagQuery(query = "") {
  return query.trim().startsWith("#");
}

function getUserTeam(teams, userId) {
  return teams
    .filter((team) => team.members.some((member) => member.userId === userId))
    .sort((a, b) => Number(b.members.some((member) => member.userId === userId && member.role === "captain")) - Number(a.members.some((member) => member.userId === userId && member.role === "captain")) || b.mmr - a.mmr)[0];
}

function getAvailableTeamPlayerIds(team, excludedIds = []) {
  const excluded = new Set(excludedIds);
  return getSelectableTeamPlayerIds(team).filter((playerId) => !excluded.has(playerId));
}

function getOpponentTeam(teams, teamId, region, excludedIds = [], capacity = 1) {
  const canUseTeam = (team) => (
    team.id !== teamId &&
    getAvailableTeamPlayerIds(team, excludedIds).length >= capacity
  );
  return teams.find((team) => canUseTeam(team) && team.region === region) ?? teams.find(canUseTeam) ?? teams.find((team) => team.id !== teamId);
}

function getMmrSpread(teams) {
  const mmrs = teams.map((team) => Number(team.mmr ?? 1200));
  return mmrs.length ? Math.max(...mmrs) - Math.min(...mmrs) : 0;
}

function getDefaultTeamPlayerIds(team, capacity, excludedIds = [], preferredPlayerId = "") {
  if (!team) return [];
  const availableIds = getAvailableTeamPlayerIds(team, excludedIds);
  if (!preferredPlayerId || !availableIds.includes(preferredPlayerId)) return availableIds.slice(0, capacity);
  return [preferredPlayerId, ...availableIds.filter((playerId) => playerId !== preferredPlayerId)].slice(0, capacity);
}

function getPartyPlayerIds(team, playerIds, capacity, excludedIds = []) {
  if (!team) return [];
  if (!Array.isArray(playerIds)) return getDefaultTeamPlayerIds(team, capacity, excludedIds);
  const selectableIds = new Set(getSelectableTeamPlayerIds(team));
  const excluded = new Set(excludedIds);
  return Array.from(new Set(playerIds.filter((playerId) => selectableIds.has(playerId) && !excluded.has(playerId)))).slice(0, capacity);
}

function getPartyReserveIds(team, reserveIds, activeIds = [], capacity = MAX_PARTY_RESERVES, excludedIds = []) {
  if (!team || !Array.isArray(reserveIds)) return [];
  const teamPlayerIds = new Set((team.members ?? []).map((member) => member.userId));
  const activeSet = new Set([...activeIds, ...excludedIds]);
  return Array.from(new Set(reserveIds.filter((playerId) => teamPlayerIds.has(playerId) && !activeSet.has(playerId)))).slice(0, capacity);
}

function getDefaultTeamReserveIds(team, activeIds = [], capacity = MAX_PARTY_RESERVES, excludedIds = []) {
  if (!team) return [];
  const activeSet = new Set([...activeIds, ...excludedIds]);
  return (team.members ?? [])
    .map((member) => member.userId)
    .filter((playerId) => playerId && !activeSet.has(playerId))
    .slice(0, capacity);
}

function SideRosterPicker({
  team,
  users,
  selectedIds,
  reserveIds = [],
  capacity,
  reserveCapacity = MAX_PARTY_RESERVES,
  title = "사이드 로스터",
  requiredActive = false,
  onChange,
  onReserveChange,
  onRosterChange,
}) {
  const userById = Object.fromEntries(users.map((user) => [user.id, user]));
  if (!team) {
    return (
      <div className="public-party-picker empty">
        <span>팀을 먼저 선택해야 합니다.</span>
      </div>
    );
  }

  const memberIds = getSelectableTeamPlayerIds(team);
  const activeIds = getPartyPlayerIds(team, selectedIds, capacity);
  const activeSet = new Set(activeIds);
  const reserveIdList = getPartyReserveIds(team, reserveIds, activeIds, reserveCapacity);
  const reserveSet = new Set(reserveIdList);
  const commitRoster = (nextActiveIds, nextReserveIds) => {
    if (onRosterChange) {
      onRosterChange({ selectedIds: nextActiveIds, reserveIds: nextReserveIds });
      return;
    }
    onChange(nextActiveIds);
    onReserveChange?.(nextReserveIds);
  };
  const toggleMember = (playerId) => {
    if (activeSet.has(playerId)) {
      const nextActive = activeIds.filter((id) => id !== playerId);
      const nextReserve = reserveIdList.length < reserveCapacity ? [...reserveIdList, playerId] : reserveIdList;
      commitRoster(nextActive, nextReserve);
      return;
    }
    if (reserveSet.has(playerId)) {
      const nextReserve = reserveIdList.filter((id) => id !== playerId);
      if (activeIds.length < capacity) {
        commitRoster([...activeIds, playerId], nextReserve);
        return;
      }
      commitRoster(activeIds, nextReserve);
      return;
    }
    if (activeIds.length < capacity) {
      commitRoster([...activeIds, playerId], reserveIdList);
      return;
    }
    if (reserveIdList.length < reserveCapacity) {
      commitRoster(activeIds, [...reserveIdList, playerId]);
    }
  };

  return (
    <div className="public-party-picker">
      <div className="public-party-picker-head">
        <span>{title}</span>
        <strong>출전 {activeIds.length}/{capacity} · 후보 {reserveIdList.length}/{reserveCapacity}</strong>
      </div>
      <div className="public-party-picker-grid">
        {memberIds.map((playerId) => {
          const user = userById[playerId];
          const selected = activeSet.has(playerId);
          const reserve = reserveSet.has(playerId);
          const locked = !selected && !reserve && activeIds.length >= capacity && reserveIdList.length >= reserveCapacity;
          return (
            <button
              key={playerId}
              type="button"
              className={selected ? "selected" : reserve ? "reserve" : ""}
              disabled={locked}
              onClick={() => toggleMember(playerId)}
            >
              <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "?"}</span>
              <span>
                <strong>{user?.name ?? "이름 없음"}</strong>
                <em>{user?.position ?? "포지션 자유"}</em>
              </span>
              <Badge tone={selected ? "green" : reserve ? "blue" : "neutral"}>{selected ? "출전" : reserve ? "후보" : "대기"}</Badge>
            </button>
          );
        })}
      </div>
      {requiredActive && activeIds.length < capacity ? <em>팀전은 출전 슬롯을 모두 채워야 확정할 수 있습니다.</em> : null}
    </div>
  );
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
  const defaultCapacity = getRecruitingSideCapacity({ mode: "5v5" });
  const defaultTeamAPlayerIds = getDefaultTeamPlayerIds(defaultTeamA, defaultCapacity, [], app.currentUser.id);
  const defaultTeamB = getOpponentTeam(app.state.teams, defaultTeamA?.id, app.currentUser.region, defaultTeamAPlayerIds, defaultCapacity);
  const defaultTeamBPlayerIds = getDefaultTeamPlayerIds(defaultTeamB, defaultCapacity, defaultTeamAPlayerIds);
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const defaultCourt = registeredCourts[0] ?? { name: "미정", region: app.currentUser.region };
  const [teamQuery, setTeamQuery] = useState("");
  const [opponentTeamQuery, setOpponentTeamQuery] = useState("");
  const [courtQuery, setCourtQuery] = useState("");
  const [teamRegion, setTeamRegion] = useState(app.currentUser.region ?? "전체");
  const [courtRegion, setCourtRegion] = useState(app.currentUser.region ?? "전체");
  const defaultAgeRestriction = getAgeGroupForUser(app.currentUser);
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const favoriteCourtIds = app.state.settings?.favoriteCourtIds ?? [];
  const isFavoriteTeam = (team) => favoriteTeamIds.includes(team.id);
  const isFavoriteCourt = (court) => favoriteCourtIds.includes(court.id);
  const [draft, setDraft] = useState({
    visibility: "private",
    timingType: "scheduled",
    hostJoinMode: "team",
    teamOnly: false,
    mmrLimitMode: "block",
    mmrRangeMode: "narrow",
    ageRestriction: defaultAgeRestriction,
    title: "오늘의 5v5 공식전",
    mode: "5v5",
    court: defaultCourt.name,
    scheduledDate: today,
    scheduledTime: "20:30",
    teamAId: defaultTeamA?.id,
    teamBId: defaultTeamB?.id,
    playerIds: defaultTeamAPlayerIds,
    reservePlayerIds: [],
    opponentPlayerIds: defaultTeamBPlayerIds,
    opponentReservePlayerIds: [],
    opponentLeaderId: defaultTeamBPlayerIds[0] ?? "",
    approvalModeA: "leader",
    approvalModeB: "leader",
    courtReserved: false,
    courtFee: "",
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
    evidence: [],
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
    const hashtagSearch = isHashtagQuery(teamQuery);
    return [...app.state.teams]
      .filter((team) => hashtagSearch || teamRegion === "전체" || team.region === teamRegion)
      .filter((team) => includesQuery(`${team.name} ${getTeamHashtag(team)} ${team.region} ${team.homeCourt}`, teamQuery))
      .sort((a, b) => Number(isFavoriteTeam(b)) - Number(isFavoriteTeam(a)) || Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || b.mmr - a.mmr);
  }, [app.currentUser.region, app.state.teams, favoriteTeamIds, teamQuery, teamRegion]);

  const sortedCourts = useMemo(() => {
    const hashtagSearch = isHashtagQuery(courtQuery);
    return registeredCourts
      .filter((court) => hashtagSearch || courtRegion === "전체" || court.region === courtRegion)
      .filter((court) => includesQuery(`${court.name} ${getCourtHashtag(court)} ${court.region} ${court.type} ${court.addressText ?? ""}`, courtQuery))
      .sort((a, b) => Number(isFavoriteCourt(b)) - Number(isFavoriteCourt(a)) || Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || a.name.localeCompare(b.name));
  }, [app.currentUser.region, courtQuery, courtRegion, favoriteCourtIds, registeredCourts]);

  const favoriteTeams = useMemo(() => {
    return [...app.state.teams]
      .filter(isFavoriteTeam)
      .sort((a, b) => Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || b.mmr - a.mmr)
      .slice(0, 10);
  }, [app.currentUser.region, app.state.teams, favoriteTeamIds]);

  const favoriteCourts = useMemo(() => {
    return [...registeredCourts]
      .filter(isFavoriteCourt)
      .sort((a, b) => Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [app.currentUser.region, favoriteCourtIds, registeredCourts]);

  const selectedTeamA = app.state.teams.find((team) => team.id === draft.teamAId);
  const selectedTeamB = app.state.teams.find((team) => team.id === draft.teamBId);
  const isPublicRoom = draft.visibility === "public";
  const isTournamentRoom = draft.visibility === "tournament";
  const isTeamRoom = !isTournamentRoom && draft.hostJoinMode === "team";
  const sideCapacity = getRecruitingSideCapacity(draft);
  const publicPartyCapacity = sideCapacity;
  const publicPartyPlayerIds = getPartyPlayerIds(selectedTeamA, draft.playerIds, sideCapacity);
  const ownerReservePlayerIds = getPartyReserveIds(selectedTeamA, draft.reservePlayerIds, publicPartyPlayerIds);
  const ownerSidePlayerIds = [...publicPartyPlayerIds, ...ownerReservePlayerIds];
  const ownerSidePlayerKey = ownerSidePlayerIds.join("|");
  const opponentPartyPlayerIds = getPartyPlayerIds(selectedTeamB, draft.opponentPlayerIds, sideCapacity, ownerSidePlayerIds);
  const opponentReservePlayerIds = getPartyReserveIds(selectedTeamB, draft.opponentReservePlayerIds, opponentPartyPlayerIds, MAX_PARTY_RESERVES, ownerSidePlayerIds);
  const opponentLeaderId = opponentPartyPlayerIds.includes(draft.opponentLeaderId) ? draft.opponentLeaderId : opponentPartyPlayerIds[0] ?? "";
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
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
  const teamAOptions = myTeams.length ? myTeams : teamOptions;
  const isInstantRoom = !isTournamentRoom && draft.timingType === "instant";
  const scheduleMaxDate = isPublicRoom ? maxPublicScheduleDate : isTournamentRoom ? maxScheduleDate : maxPrivateScheduleDate;
  const activePlayerIds = useMemo(() => {
    if (!isTeamRoom) return new Set([app.currentUser.id]);
    if (isPublicRoom) return new Set([...publicPartyPlayerIds, ...ownerReservePlayerIds]);
    return new Set([
      ...publicPartyPlayerIds,
      ...ownerReservePlayerIds,
      ...opponentPartyPlayerIds,
      ...opponentReservePlayerIds,
    ]);
  }, [app.currentUser.id, isPublicRoom, isTeamRoom, opponentPartyPlayerIds, opponentReservePlayerIds, ownerReservePlayerIds, publicPartyPlayerIds]);
  const opponentTeamResults = useMemo(() => {
    if (!isTeamRoom || isPublicRoom || !selectedTeamA) return [];
    const query = opponentTeamQuery.trim();
    return app.state.teams
      .filter((team) => team.id !== selectedTeamA.id)
      .filter((team) => getDefaultTeamPlayerIds(team, sideCapacity, ownerSidePlayerIds).length >= sideCapacity)
      .filter((team) => !query || includesQuery(`${team.name} ${getTeamHashtag(team)} ${team.region} ${team.homeCourt}`, query))
      .sort((a, b) => (
        Number(favoriteTeamIds.includes(b.id)) - Number(favoriteTeamIds.includes(a.id)) ||
        Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) ||
        b.mmr - a.mmr
      ))
      .slice(0, query ? 8 : 5);
  }, [app.currentUser.region, app.state.teams, favoriteTeamIds, isPublicRoom, isTeamRoom, opponentTeamQuery, ownerSidePlayerIds, selectedTeamA, sideCapacity]);
  const refereeCandidates = useMemo(
    () => app.state.users
      .filter((user) => isEligibleReferee(user, REFEREE_TRUST_MIN, app.state.settings?.refereeAppointments))
      .filter((user) => !activePlayerIds.has(user.id))
      .sort((a, b) => Number(b.trustScore ?? 0) - Number(a.trustScore ?? 0)),
    [activePlayerIds, app.state.settings?.refereeAppointments, app.state.users],
  );
  const teamTierRange = getRecruitingTierRange(selectedTeamA?.mmr ?? 1200, draft.ranked, draft.mmrRangeMode);
  const personalTierRange = getRecruitingTierRange(app.currentUser.ratings?.integrated ?? 1200, draft.ranked, draft.mmrRangeMode);
  const roomTierRange = isTeamRoom ? teamTierRange : personalTierRange;
  const mmrRangePolicy = MMR_RANGE_POLICIES[draft.mmrRangeMode] ?? MMR_RANGE_POLICIES.narrow;
  const ageRestrictionOption = getAgeRestrictionOption(draft.ageRestriction);
  const currentUserAgeGroup = getAgeGroupForUser(app.currentUser);
  const ageRestrictionBlocked = !isTournamentRoom && !ageRestrictionOption.allowedGroups.includes(currentUserAgeGroup);
  const teamTierBlocked = Boolean(
    isTeamRoom &&
      !isPublicRoom &&
      !isTournamentRoom &&
      draft.mmrLimitMode === "block" &&
      draft.ranked &&
      selectedTeamA &&
      selectedTeamB &&
      !isMmrInRecruitingRange(selectedTeamB.mmr, selectedTeamA.mmr, true, draft.mmrRangeMode),
  );
  const teamTierWarned = Boolean(
    isTeamRoom &&
      !isPublicRoom &&
      !isTournamentRoom &&
      draft.mmrLimitMode === "warn" &&
      draft.ranked &&
      selectedTeamA &&
      selectedTeamB &&
      !isMmrInRecruitingRange(selectedTeamB.mmr, selectedTeamA.mmr, true, draft.mmrRangeMode),
  );
  const scheduledStartMs = new Date(`${draft.scheduledDate}T${draft.scheduledTime || "00:00"}`).getTime();
  const publicScheduledLeadAllowed = !isPublicRoom || isInstantRoom || (Number.isFinite(scheduledStartMs) && scheduledStartMs > Date.now() + 4 * 3600000);
  const scheduleAllowed = isInstantRoom || (draft.scheduledDate >= today && draft.scheduledDate <= scheduleMaxDate && publicScheduledLeadAllowed);
  const tournamentEndAllowed = !isTournamentRoom || (draft.tournamentEndDate >= today && draft.tournamentEndDate <= maxScheduleDate);
  const privateTeamDuplicate = !isPublicRoom && isTeamRoom && opponentPartyPlayerIds.some((playerId) => ownerSidePlayerIds.includes(playerId));
  const privateTeamInvalid = !isPublicRoom && isTeamRoom && (
    !selectedTeamA ||
    !selectedTeamB ||
    selectedTeamA.id === selectedTeamB.id ||
    privateTeamDuplicate ||
    publicPartyPlayerIds.length < sideCapacity ||
    opponentPartyPlayerIds.length < sideCapacity
  );
  const publicTeamInvalid = draft.hostJoinMode === "team" && (
    !myTeams.some((team) => team.id === draft.teamAId) ||
    !publicPartyPlayerIds.length ||
    (draft.teamOnly && publicPartyPlayerIds.length < sideCapacity)
  );
  const tournamentMmrBlocked = Boolean(
    isTournamentRoom &&
      draft.ranked &&
      draft.mmrLimitMode === "block" &&
      tournamentMmrSpread > Number(draft.tournamentMaxMmrGap ?? 250),
  );
  const tournamentInvalid = !draft.title.trim() || tournamentTeams.length < 2 || tournamentMmrBlocked;
  const submitDisabled = !scheduleAllowed || !tournamentEndAllowed || ageRestrictionBlocked || (isTournamentRoom
    ? tournamentInvalid
    : isPublicRoom
      ? publicTeamInvalid
      : teamTierBlocked || privateTeamInvalid);
  const submitDisabledReason = !scheduleAllowed
    ? "일정 조건이 맞지 않습니다. 즉시는 바로 생성 가능하고, 예약 일정은 허용 기간 안에서만 가능합니다."
    : !tournamentEndAllowed
      ? "대회 종료일이 허용 기간을 벗어났습니다."
      : teamTierBlocked
        ? "상대팀 MMR이 현재 허용구간 밖입니다. MMR 제한을 경고만 또는 제한 없음으로 바꾸면 생성할 수 있습니다."
        : ageRestrictionBlocked
          ? "생성자가 선택한 연령 제한 밖입니다. 연령 제한을 바꾸면 생성할 수 있습니다."
          : privateTeamInvalid
          ? "팀전은 A/B사이드 출전 슬롯이 모두 채워져야 생성할 수 있습니다."
          : "";
  const selectedCourt = useMemo(
    () => registeredCourts.find((court) => court.name === draft.court) ?? defaultCourt,
    [defaultCourt, draft.court, registeredCourts],
  );
  const courtPlayWarning = getCourtPlayWarning(selectedCourt, draft.mode);
  const selectCourt = (court) => {
    update({ court: court.name });
    setCourtQuery(court.name);
    setCourtRegion(court.region);
  };

  const update = (patch) => setDraft((current) => {
    const next = { ...current, ...patch };
    if (patch.ranked === false) next.official = false;
    return next;
  });
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
      const capacity = getRecruitingSideCapacity(current);
      const tournamentTeamIds = (current.tournamentTeamIds ?? []).filter((teamId) => app.state.teams.some((team) => team.id === teamId));
      const nextTeamAId = teamAExists ? current.teamAId : (getUserTeam(app.state.teams, app.currentUser.id) ?? app.state.teams[0])?.id;
      const nextTeamA = app.state.teams.find((team) => team.id === nextTeamAId);
      const nextTeamAPlayerIds = getDefaultTeamPlayerIds(nextTeamA, capacity);
      const currentTeamB = app.state.teams.find((team) => team.id === current.teamBId);
      const currentTeamBUsable = teamBExists &&
        current.teamBId !== nextTeamAId &&
        getDefaultTeamPlayerIds(currentTeamB, capacity, nextTeamAPlayerIds).length >= capacity;
      const nextTeamBId = currentTeamBUsable
        ? current.teamBId
        : getOpponentTeam(app.state.teams, nextTeamAId, app.currentUser.region, nextTeamAPlayerIds, capacity)?.id;
      if (current.teamAId === nextTeamAId && current.teamBId === nextTeamBId && tournamentTeamIds.length === (current.tournamentTeamIds ?? []).length) return current;
      return { ...current, teamAId: nextTeamAId, teamBId: nextTeamBId, tournamentTeamIds };
    });
  }, [app.currentUser.id, app.currentUser.region, app.state.teams]);

  useEffect(() => {
    if (!isTeamRoom || !selectedTeamA) return;
    const selectableIds = getSelectableTeamPlayerIds(selectedTeamA);
    const selectedIds = getPartyPlayerIds(selectedTeamA, draft.playerIds, sideCapacity);
    const reserveIds = getPartyReserveIds(selectedTeamA, draft.reservePlayerIds, selectedIds);
    const playerIdsNeedSync = !Array.isArray(draft.playerIds)
      || draft.playerIds.length > sideCapacity
      || draft.playerIds.some((playerId) => !selectableIds.includes(playerId));
    const reserveIdsNeedSync = !Array.isArray(draft.reservePlayerIds)
      || draft.reservePlayerIds.length > MAX_PARTY_RESERVES
      || draft.reservePlayerIds.some((playerId) => !selectableIds.includes(playerId) || selectedIds.includes(playerId));
    if (!playerIdsNeedSync && !reserveIdsNeedSync) return;
    setDraft((current) => ({
      ...current,
      playerIds: !selectedIds.length ? getDefaultTeamPlayerIds(selectedTeamA, sideCapacity, [], app.currentUser.id) : selectedIds,
      reservePlayerIds: reserveIds,
    }));
  }, [app.currentUser.id, draft.hostJoinMode, draft.playerIds, draft.reservePlayerIds, isPublicRoom, isTeamRoom, sideCapacity, selectedTeamA]);

  useEffect(() => {
    if (!isTeamRoom || isPublicRoom || !selectedTeamB) return;
    const selectableIds = getSelectableTeamPlayerIds(selectedTeamB);
    const excludedIds = [...publicPartyPlayerIds, ...ownerReservePlayerIds];
    const selectedIds = getPartyPlayerIds(selectedTeamB, draft.opponentPlayerIds, sideCapacity, excludedIds);
    const fallbackSelectedIds = selectedIds.length ? selectedIds : getDefaultTeamPlayerIds(selectedTeamB, sideCapacity, excludedIds);
    const reserveIds = getPartyReserveIds(selectedTeamB, draft.opponentReservePlayerIds, fallbackSelectedIds, MAX_PARTY_RESERVES, excludedIds);
    const nextLeaderId = fallbackSelectedIds.includes(draft.opponentLeaderId) ? draft.opponentLeaderId : fallbackSelectedIds[0] ?? "";
    const playerIdsNeedSync = !Array.isArray(draft.opponentPlayerIds)
      || draft.opponentPlayerIds.length > sideCapacity
      || draft.opponentPlayerIds.some((playerId) => !selectableIds.includes(playerId) || excludedIds.includes(playerId))
      || selectedIds.length !== draft.opponentPlayerIds.length;
    const reserveIdsNeedSync = !Array.isArray(draft.opponentReservePlayerIds)
      || draft.opponentReservePlayerIds.length > MAX_PARTY_RESERVES
      || draft.opponentReservePlayerIds.some((playerId) => !selectableIds.includes(playerId) || fallbackSelectedIds.includes(playerId) || excludedIds.includes(playerId));
    const leaderNeedSync = draft.opponentLeaderId !== nextLeaderId;
    if (!playerIdsNeedSync && !reserveIdsNeedSync && !leaderNeedSync) return;
    setDraft((current) => ({
      ...current,
      opponentPlayerIds: fallbackSelectedIds,
      opponentReservePlayerIds: reserveIds,
      opponentLeaderId: nextLeaderId,
    }));
  }, [draft.hostJoinMode, draft.opponentLeaderId, draft.opponentPlayerIds, draft.opponentReservePlayerIds, isPublicRoom, isTeamRoom, ownerSidePlayerKey, sideCapacity, selectedTeamB]);

  const selectTeamA = (teamAId) => {
    const team = app.state.teams.find((item) => item.id === teamAId);
    const playerIds = getDefaultTeamPlayerIds(team, sideCapacity, [], app.currentUser.id);
    const currentTeamB = app.state.teams.find((item) => item.id === draft.teamBId);
    const currentTeamBUsable = currentTeamB &&
      currentTeamB.id !== teamAId &&
      getDefaultTeamPlayerIds(currentTeamB, sideCapacity, playerIds).length >= sideCapacity;
    const nextTeamB = currentTeamBUsable
      ? currentTeamB
      : getOpponentTeam(sortedTeams, teamAId, app.currentUser.region, playerIds, sideCapacity) ?? getOpponentTeam(app.state.teams, teamAId, app.currentUser.region, playerIds, sideCapacity);
    const opponentPlayerIds = getDefaultTeamPlayerIds(nextTeamB, sideCapacity, playerIds);
    setOpponentTeamQuery("");
    update({
      teamAId,
      teamBId: nextTeamB?.id,
      ...(isTeamRoom ? {
        playerIds,
        reservePlayerIds: getDefaultTeamReserveIds(team, playerIds),
        opponentPlayerIds,
        opponentReservePlayerIds: getDefaultTeamReserveIds(nextTeamB, opponentPlayerIds, MAX_PARTY_RESERVES, playerIds),
        opponentLeaderId: opponentPlayerIds[0] ?? "",
      } : {}),
    });
  };
  const selectTeamB = (teamBId) => {
    const currentTeamA = app.state.teams.find((item) => item.id === draft.teamAId);
    const nextTeamA = currentTeamA?.id === teamBId
      ? getOpponentTeam(sortedTeams, teamBId, app.currentUser.region, [], sideCapacity) ?? getOpponentTeam(app.state.teams, teamBId, app.currentUser.region, [], sideCapacity)
      : currentTeamA;
    const playerIds = getPartyPlayerIds(nextTeamA, draft.playerIds, sideCapacity);
    const team = app.state.teams.find((item) => item.id === teamBId);
    const opponentPlayerIds = getDefaultTeamPlayerIds(team, sideCapacity, playerIds);
    setOpponentTeamQuery("");
    update({
      teamAId: nextTeamA?.id,
      teamBId,
      ...(isTeamRoom ? {
        playerIds,
        reservePlayerIds: getDefaultTeamReserveIds(nextTeamA, playerIds),
        opponentPlayerIds,
        opponentReservePlayerIds: getDefaultTeamReserveIds(team, opponentPlayerIds, MAX_PARTY_RESERVES, playerIds),
        opponentLeaderId: opponentPlayerIds[0] ?? "",
      } : {}),
    });
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
  const renderCourtSearchItem = (court) => (
    <button
      key={court.id}
      type="button"
      className={draft.court === court.name ? "search-picker-result-row selected" : "search-picker-result-row"}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => selectCourt(court)}
    >
      <strong>{court.name}</strong>
      <span>{court.region} / {court.type} / {getCourtSurfaceLabel(court)} / {getCourtLayoutLabel(court)}</span>
      <em>{getCourtHashtag(court)} · {isFavoriteCourt(court) ? "즐겨찾기" : "구장"}</em>
    </button>
  );
  const renderCreateTeamSearchItem = (team) => {
    const invited = (draft.tournamentTeamIds ?? []).includes(team.id);
    const selected = isTournamentRoom ? invited : isPublicRoom ? draft.teamAId === team.id : draft.teamAId === team.id;
    const actionLabel = isTournamentRoom ? (invited ? "초대 해제" : "초대") : isPublicRoom ? "내 파티" : "A사이드";
    return (
      <button
        key={team.id}
        type="button"
        className={selected ? "search-picker-result-row selected" : "search-picker-result-row"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (isTournamentRoom) toggleTournamentTeam(team.id);
          else assignTeam(team.id, "A");
        }}
      >
        <TeamHoverCard team={team} as="span"><strong>{team.name}</strong></TeamHoverCard>
        <span>{team.region} · {team.mmr} MMR · {team.homeCourt}</span>
        <em>{getTeamHashtag(team)} · {isFavoriteTeam(team) ? "즐겨찾기" : actionLabel}</em>
      </button>
    );
  };
  const renderOpponentTeamSearchItem = (team) => {
    const mmrBlocked = draft.mmrLimitMode === "block" && draft.ranked && selectedTeamA && !isMmrInRecruitingRange(team.mmr, selectedTeamA.mmr, true, draft.mmrRangeMode);
    return (
      <button
        key={team.id}
        type="button"
        className={team.id === draft.teamBId ? "search-picker-result-row selected" : "search-picker-result-row"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectTeamB(team.id)}
      >
        <TeamHoverCard team={team} as="span"><strong>{team.name}</strong></TeamHoverCard>
        <span>{team.region} · {team.mmr} MMR · {team.homeCourt}</span>
        <em>{getTeamHashtag(team)} · {favoriteTeamIds.includes(team.id) ? "즐겨찾기" : mmrBlocked ? "MMR 범위 밖" : "B사이드"}</em>
      </button>
    );
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
    app.actions.createRecruitingPost({
      visibility: draft.visibility,
      title: draft.title,
      hostJoinMode: draft.hostJoinMode,
      teamOnly: isPublicRoom && isTeamRoom && Boolean(draft.teamOnly),
      teamId: isTeamRoom ? draft.teamAId : "",
      playerIds: isTeamRoom ? publicPartyPlayerIds : [],
      reservePlayerIds: isTeamRoom ? ownerReservePlayerIds : [],
      opponentTeamId: !isPublicRoom && isTeamRoom ? draft.teamBId : "",
      opponentPlayerIds: !isPublicRoom && isTeamRoom ? opponentPartyPlayerIds : [],
      opponentReservePlayerIds: !isPublicRoom && isTeamRoom ? opponentReservePlayerIds : [],
      opponentLeaderId: !isPublicRoom && isTeamRoom ? opponentLeaderId : "",
      approvalModeA: draft.approvalModeA,
      approvalModeB: draft.approvalModeB,
      refereeId: draft.refereeId,
      targetTeamId: "",
      region: selectedCourt.region,
      court: draft.court,
      timingType: draft.timingType,
      scheduledDate: isInstantRoom ? "" : draft.scheduledDate,
      scheduledTime: isInstantRoom ? "" : draft.scheduledTime,
      mode: draft.mode,
      ranked: draft.ranked,
      official: draft.official,
      preRegistered: draft.preRegistered,
      mmrRangeMode: draft.mmrRangeMode,
      ageRestriction: draft.ageRestriction,
      allowedAgeGroups: ageRestrictionOption.allowedGroups,
      rules: {
        targetScore: draft.targetScore,
        timeLimit: draft.timeLimit,
        ball: draft.ball,
        winByTwo: draft.winByTwo,
        attackRule: draft.attackRule,
        foulRule: draft.foulRule,
        ageRestriction: draft.ageRestriction,
        allowedAgeGroups: ageRestrictionOption.allowedGroups,
      },
      stakes: draft.stakes,
      courtReserved: draft.courtReserved,
      courtFee: draft.courtFee,
      memo: [
        draft.courtReserved ? `구장 예약: ${draft.courtFee ? `${draft.courtFee}원` : "예약 있음"}` : "",
        draft.memo,
        isPublicRoom ? "공개방: 빈 슬롯은 방에서 공개 모집합니다." : "비공개방: 초대/선택된 인원만 참여합니다.",
      ].filter(Boolean).join("\n"),
    });
    navigate("/app/recruiting");
    return;
  };

  return (
    <form className="page-stack" onSubmit={submit}>
      <header className="page-header">
        <div>
          <p className="eyebrow">CreateMatch</p>
          <h1>경기/대회 만들기</h1>
        </div>
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
                <em>선택한 A사이드/B사이드로 바로 경기 계약서를 만든다.</em>
              </span>
            </button>
            <button
              type="button"
              className={draft.visibility === "public" ? "active" : ""}
              onClick={() => {
                const team = defaultTeamA ?? selectedTeamA;
                const playerIds = getDefaultTeamPlayerIds(team, publicPartyCapacity, [], app.currentUser.id);
                update({
                  visibility: "public",
                  hostJoinMode: "team",
                  teamOnly: false,
                  teamAId: team?.id ?? draft.teamAId,
                  playerIds,
                  reservePlayerIds: getDefaultTeamReserveIds(team, playerIds),
                  opponentPlayerIds: [],
                  opponentReservePlayerIds: [],
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
              update({ visibility: "tournament", timingType: "scheduled", tournamentTeamIds: draft.tournamentTeamIds?.length ? draft.tournamentTeamIds : [defaultTeamA?.id, defaultTeamB?.id].filter(Boolean) });
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
            {!isTournamentRoom ? (
              <label>
                방 유형
                <select
                  value={draft.hostJoinMode}
                  onChange={(event) => {
                    const hostJoinMode = event.target.value;
                    const playerIds = hostJoinMode === "team" ? getDefaultTeamPlayerIds(selectedTeamA, publicPartyCapacity, [], app.currentUser.id) : [];
                    const opponentPlayerIds = hostJoinMode === "team" && !isPublicRoom ? getDefaultTeamPlayerIds(selectedTeamB, publicPartyCapacity, playerIds) : [];
                    update({
                      hostJoinMode,
                      teamOnly: hostJoinMode === "team" ? draft.teamOnly : false,
                      playerIds,
                      reservePlayerIds: hostJoinMode === "team" ? getDefaultTeamReserveIds(selectedTeamA, playerIds) : [],
                      opponentPlayerIds,
                      opponentReservePlayerIds: hostJoinMode === "team" && !isPublicRoom ? getDefaultTeamReserveIds(selectedTeamB, opponentPlayerIds, MAX_PARTY_RESERVES, playerIds) : [],
                      opponentLeaderId: opponentPlayerIds[0] ?? "",
                    });
                  }}
                >
                  <option value="team">팀전 / 팀 파티 포함</option>
                  <option value="player">개인전</option>
                </select>
              </label>
            ) : null}
            {false && isPublicRoom ? (
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
            {!isTournamentRoom ? (
              <div className="field-block">
                <span className="field-label">시간 옵션</span>
                <div className="segmented-control compact-segments">
                  <button type="button" className={draft.timingType === "scheduled" ? "active" : ""} onClick={() => update({ timingType: "scheduled" })}>일정 지정</button>
                  <button type="button" className={draft.timingType === "instant" ? "active" : ""} onClick={() => update({ timingType: "instant" })}>즉시</button>
                </div>
                <small>{isInstantRoom ? "날짜/시간 없이 바로 경기준비방으로 만든다." : isPublicRoom ? "공개 예약방은 5일 이내, 경기 4시간 이후만 가능하다." : "비공개 예약방은 1개월 이내로 만들 수 있다."}</small>
              </div>
            ) : null}
            <label>
              방식
              <select value={draft.mode} onChange={(event) => {
                const mode = event.target.value;
                const nextCapacity = getRecruitingSideCapacity({ mode });
                const playerIds = isTeamRoom ? getDefaultTeamPlayerIds(selectedTeamA, nextCapacity, [], app.currentUser.id) : [];
                const opponentPlayerIds = !isPublicRoom && isTeamRoom ? getDefaultTeamPlayerIds(selectedTeamB, nextCapacity, playerIds) : [];
                update({
                  mode,
                  ...(isTeamRoom ? {
                    playerIds,
                    reservePlayerIds: getDefaultTeamReserveIds(selectedTeamA, playerIds),
                    opponentPlayerIds,
                    opponentReservePlayerIds: !isPublicRoom ? getDefaultTeamReserveIds(selectedTeamB, opponentPlayerIds, MAX_PARTY_RESERVES, playerIds) : [],
                    opponentLeaderId: opponentPlayerIds[0] ?? "",
                  } : {}),
                });
              }}>
                {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
              </select>
            </label>
            {!isInstantRoom ? (
              <>
                <label>
                  날짜
                  <input type="date" min={today} max={scheduleMaxDate} value={draft.scheduledDate} onChange={(event) => update({ scheduledDate: event.target.value })} />
                </label>
                <label>
                  시간
                  <input type="time" value={draft.scheduledTime} onChange={(event) => update({ scheduledTime: event.target.value })} />
                </label>
              </>
            ) : null}
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
              <SearchPicker
                value={courtQuery}
                onChange={setCourtQuery}
                placeholder="코트, 지역, 실내/야외 검색"
                items={sortedCourts}
                idleItems={favoriteCourts.length ? favoriteCourts : sortedCourts.slice(0, 10)}
                idleTitle={favoriteCourts.length ? "자주 찾는 코트" : "추천 코트"}
                showIdleOnFocus
                floating
                renderItem={renderCourtSearchItem}
              />
            </label>
          </div>
          <div className="court-reservation-row">
            <label>
              <input type="checkbox" checked={draft.courtReserved} onChange={(event) => update({ courtReserved: event.target.checked })} />
              구장예약됨
            </label>
            {draft.courtReserved ? (
              <input value={draft.courtFee} placeholder="예약 금액/메모" onChange={(event) => update({ courtFee: event.target.value })} />
            ) : null}
          </div>
          <div className={courtPlayWarning ? "tier-range-note tier-range-note-warning" : "tier-range-note"}>
            <div>
              <span>구장 속성</span>
              <strong>{getCourtSurfaceLabel(selectedCourt)} / {getCourtLayoutLabel(selectedCourt)}</strong>
              <em>{courtPlayWarning || "선택한 방식과 구장 형태가 충돌하지 않습니다."}</em>
            </div>
            <Badge tone={courtPlayWarning ? "orange" : "green"}>{courtPlayWarning ? "경고" : "가능"}</Badge>
          </div>
        </Card>

        <Card className="section-card full-span selector-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{isTournamentRoom || isTeamRoom ? "Team Finder" : "Match Criteria"}</p>
              <h2>{isTournamentRoom ? "초대 팀 선택" : isTeamRoom ? (isPublicRoom ? "내 파티 선택" : "참여 팀 검색") : "개인전 매칭 기준"}</h2>
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
          ) : null}
          {!isTournamentRoom && draft.ranked ? (
            <div className={teamTierBlocked ? "mmr-range-mode-control tier-range-note-warning" : "mmr-range-mode-control"}>
              <div className="mmr-range-summary-row">
                <div>
                  <span>정규전 허용구간 선택</span>
                  <strong>{roomTierRange.detail}</strong>
                  <em>{teamTierWarned ? "경고만 표시" : isTeamRoom ? `${selectedTeamA?.name ?? "A사이드"} 기준` : `${app.currentUser.name} 기준`} · {mmrRangePolicy.detail}</em>
                </div>
                <Badge tone={teamTierBlocked || teamTierWarned ? "orange" : "green"}>{teamTierBlocked ? "차단" : teamTierWarned ? "경고" : "허용"}</Badge>
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
          {!isTournamentRoom ? (
            <div className={ageRestrictionBlocked ? "mmr-range-mode-control tier-range-note-warning" : "mmr-range-mode-control"}>
              <div className="mmr-range-summary-row">
                <div>
                  <span>연령 제한</span>
                  <strong>{ageRestrictionOption.label}</strong>
                  <em>{ageRestrictionOption.desc}</em>
                </div>
                <Badge tone={ageRestrictionBlocked ? "orange" : "green"}>{ageRestrictionBlocked ? "차단" : "허용"}</Badge>
              </div>
              <div className="segmented-control compact-segments age-restriction-segments">
                {AGE_GROUPS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={ageRestrictionOption.allowedGroups.includes(option.id) ? "active" : ""}
                    onClick={() => update({ ageRestriction: toggleAgeRestriction(draft.ageRestriction, option.id) })}
                  >
                    {option.label}
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
          {isTournamentRoom || isTeamRoom ? (
            <>
              <div className="search-controls">
                <label>
                  지역
                  <select value={teamRegion} onChange={(event) => setTeamRegion(event.target.value)}>
                    {allRegions.map((region) => <option key={region}>{region}</option>)}
                  </select>
                </label>
                <label>
                  팀명
                  <SearchPicker
                    value={teamQuery}
                    onChange={setTeamQuery}
                    placeholder="팀, 지역, 홈코트 검색"
                    items={sortedTeams}
                    idleItems={favoriteTeams}
                    idleTitle="즐겨찾기 팀"
                    showIdleOnFocus
                    floating
                    renderItem={renderCreateTeamSearchItem}
                  />
                </label>
              </div>
            </>
          ) : null}
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
          ) : isTeamRoom ? (
            <div className="form-grid two">
              <label>
                {isPublicRoom ? "방장 파티" : "A사이드"}
                <select value={draft.teamAId ?? ""} onChange={(event) => selectTeamA(event.target.value)}>
                  {!(isPublicRoom ? myTeams : teamAOptions).length ? <option value="">팀 없음</option> : null}
                  {(isPublicRoom ? myTeams : teamAOptions)
                    .filter((team) => isPublicRoom || team.id !== draft.teamBId)
                    .map((team) => <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>)}
                </select>
              </label>
              {isPublicRoom ? (
                <label className="switch-line create-team-only-toggle">
                  <input type="checkbox" checked={Boolean(draft.teamOnly)} onChange={(event) => update({ teamOnly: event.target.checked })} />
                  <span>
                    팀으로만 참여
                    <small>개인 참여를 막고 A/B 출전 슬롯을 팀 파티로만 채웁니다.</small>
                  </span>
                </label>
              ) : null}
              {!isPublicRoom ? (
                <div className={`team-search-field ${opponentTeamQuery.trim() ? "has-query" : ""}`}>
                  <span className="field-label">B사이드</span>
                  <SearchPicker
                    value={opponentTeamQuery}
                    onChange={setOpponentTeamQuery}
                    placeholder="상대 팀명 검색"
                    items={opponentTeamResults}
                    idleItems={opponentTeamResults}
                    idleTitle="추천 B사이드"
                    showIdleOnFocus
                    floating
                    renderItem={renderOpponentTeamSearchItem}
                  />
                  {selectedTeamB ? (
                    <div className="team-search-selected">
                      <TeamHoverCard team={selectedTeamB} as="span"><strong>{selectedTeamB.name}</strong></TeamHoverCard>
                      <span>{selectedTeamB.region} · {selectedTeamB.mmr} MMR</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {!isTournamentRoom && !isTeamRoom ? (
            <div className="create-public-note">
              <Globe2 size={17} />
              <span>개인전은 팀을 고르지 않습니다. 방 안에서 초대하고, 같은 사이드에 같은 소속팀 선수가 있으면 파티를 맺습니다.</span>
            </div>
          ) : null}
          {isTeamRoom ? (
            <SideRosterPicker
              team={selectedTeamA}
              users={app.state.users}
              selectedIds={publicPartyPlayerIds}
              reserveIds={ownerReservePlayerIds}
              capacity={publicPartyCapacity}
              title={isPublicRoom ? "방장 파티 출전/후보" : "A사이드 출전/후보"}
              requiredActive={!isPublicRoom || Boolean(draft.teamOnly)}
              onChange={(playerIds) => update({ playerIds })}
              onReserveChange={(reservePlayerIds) => update({ reservePlayerIds })}
              onRosterChange={({ selectedIds: playerIds, reserveIds: reservePlayerIds }) => update({ playerIds, reservePlayerIds })}
            />
          ) : null}
          {!isPublicRoom && isTeamRoom ? (
            <>
              <SideRosterPicker
                team={selectedTeamB}
                users={app.state.users}
                selectedIds={opponentPartyPlayerIds}
                reserveIds={opponentReservePlayerIds}
                capacity={publicPartyCapacity}
                title="B사이드 출전/후보"
                requiredActive
                onChange={(opponentPlayerIds) => update({
                  opponentPlayerIds,
                  opponentLeaderId: opponentPlayerIds.includes(draft.opponentLeaderId) ? draft.opponentLeaderId : opponentPlayerIds[0] ?? "",
                })}
                onReserveChange={(opponentReservePlayerIds) => update({ opponentReservePlayerIds })}
                onRosterChange={({ selectedIds: opponentPlayerIds, reserveIds: opponentReservePlayerIds }) => update({
                  opponentPlayerIds,
                  opponentReservePlayerIds,
                  opponentLeaderId: opponentPlayerIds.includes(draft.opponentLeaderId) ? draft.opponentLeaderId : opponentPlayerIds[0] ?? "",
                })}
              />
              <div className="form-grid two">
                <label>
                  B사이드 파티장
                  <select value={opponentLeaderId} onChange={(event) => update({ opponentLeaderId: event.target.value })}>
                    {opponentPartyPlayerIds.map((playerId) => (
                      <option key={playerId} value={playerId}>
                        {userById[playerId]?.name ?? playerId} · {userById[playerId]?.position ?? "포지션 자유"}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="stat-integrity-note">
                  B 파티장에게 초대장이 간다. 수락하면 B사이드가 READY가 된다.
                </div>
              </div>
            </>
          ) : null}
          {!isPublicRoom && isTeamRoom ? (
            <div className="form-grid two">
              <label>
                A사이드 수락 방식
                <select value={draft.approvalModeA} onChange={(event) => update({ approvalModeA: event.target.value })}>
                  <option value="leader">파티장만 수락</option>
                </select>
              </label>
              <label>
                B사이드 수락 방식
                <select value={draft.approvalModeB} onChange={(event) => update({ approvalModeB: event.target.value })}>
                  <option value="leader">파티장만 수락</option>
                </select>
              </label>
            </div>
          ) : null}
          {isPublicRoom ? (
            <div className="create-public-note">
              <Globe2 size={17} />
              <span>공개방은 매칭 목록에 노출된다. 상대 사이드는 방 안의 빈 슬롯을 공개 모집한다.</span>
            </div>
          ) : null}
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
            <label><input type="checkbox" checked={draft.ranked && draft.official} disabled={!draft.ranked} onChange={(event) => update({ official: event.target.checked })} /> 공식경기</label>
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
              <h2>약속과 메모</h2>
            </div>
          </div>
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
      <div className="create-submit-row">
        {submitDisabledReason ? <span className="create-submit-warning">{submitDisabledReason}</span> : null}
        <Button type="submit" disabled={submitDisabled}>{isTournamentRoom ? "대회 생성" : "경기 생성"}</Button>
      </div>
    </form>
  );
}
