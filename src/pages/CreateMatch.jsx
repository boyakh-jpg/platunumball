import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ClipboardList, Globe2, Lock, Map as MapIcon, MapPin, Star, Trophy, X } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import CourtDetailModal from "../components/court/CourtDetailModal.jsx";
import CourtMapPicker from "../components/court/CourtMapPicker.jsx";
import RuleSelector from "../components/match/RuleSelector.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { MATCH_MODES, MAX_RECRUITING_RESERVES_PER_SIDE as MAX_PARTY_RESERVES, PLAYER_POSITIONS, PLAYER_STAT_FIELDS, RECORD_TYPES, REFEREE_TRUST_MIN, REGIONS, getCanonicalRegion, getHostTrustRequirement, getRoomKindFromDraft, getRoomKindLabel, isSameRegion } from "../lib/constants.js";
import { getCourtLayoutLabel, getCourtPlayWarning, getCourtRecommendationScore, getCourtSurfaceLabel, getRegisteredCourts, isCourtFuzzySearchMatch } from "../lib/courts.js";
import { getCourtHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { addDateDays, getLocalDateInputValue, getPublicRoomMaxDateInput, getPublicRoomTimingStatus, isEligibleReferee } from "../lib/matchUtils.js";
import { AGE_GROUPS, getAgeGroupForUser, getRepresentativeTeam } from "../lib/profileSetup.js";
import { DIRECTORY_PICKER_PAGE_LIMIT } from "../lib/queryPolicy.js";
import { MMR_RANGE_POLICIES, getRecruitingSideCapacity, getRecruitingTierRange, getSelectableTeamPlayerIds, getTeamEventEligibility, isMmrInRecruitingRange } from "../lib/recruiting.js";

const today = getLocalDateInputValue();
const minSoloRecordDate = addDateDays(today, -7);
const nextWeek = addDateDays(today, 7);
const maxScheduleDate = addDateDays(today, 365);
const maxPrivateScheduleDate = addDateDays(today, 30);
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
const SOLO_RECORD_MODES = ["1v1", "2v2", "3v3", "4v4", "5v5"].map((id) => ({ id, label: id }));
const MATCH_MODE_IDS = new Set(MATCH_MODES.map((mode) => mode.id));

function getCourtAddress(court = {}) {
  return court.roadAddress || court.addressText || court.jibunAddress || "주소 미등록";
}

function getCourtSearchText(court = {}) {
  return [
    court.name,
    getCourtHashtag(court),
    court.region,
    court.type,
    getCourtAddress(court),
    getCourtSurfaceLabel(court),
    getCourtLayoutLabel(court),
  ].filter(Boolean).join(" ");
}

const makeEmptySoloStats = () => Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field.id, 0]));

function getSoloRecordUserLine(user = {}) {
  const position = PLAYER_POSITIONS.includes(user.position) && user.position !== "상관없음" ? user.position : "";
  return [user.name, getUserHashtag(user), position].filter(Boolean).join(" ");
}

function getSoloRecordUserSearchText(user = {}) {
  return [user.name, getUserHashtag(user), user.position, user.region, `신뢰도 ${user.trustScore ?? ""}`].filter(Boolean).join(" ");
}

function getSoloRecordModeSize(mode = "1v1") {
  const match = String(mode).match(/^(\d)/);
  const value = match ? Number(match[1]) : 1;
  return Math.max(1, Math.min(5, Number.isFinite(value) ? value : 1));
}

function getSoloRecordRosterLines(value = "") {
  return String(value ?? "")
    .split(/[\n,]+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function getSoloRecordRosterIdentity(line = "") {
  const text = String(line ?? "").replace(/\s+/g, " ").trim();
  const hashtag = text.match(/#[^\s#]+/);
  if (hashtag?.[0]) return hashtag[0].toLowerCase();
  const parts = text.split(" ");
  const maybePosition = parts.at(-1)?.toUpperCase() ?? "";
  const nameText = PLAYER_POSITIONS.includes(maybePosition) ? parts.slice(0, -1).join(" ") : text;
  return nameText.trim().toLowerCase();
}

function getSoloRecordUserIdentity(user = {}) {
  return getUserHashtag(user).toLowerCase();
}

function getSoloRecordSelectedIdentitySet(teamAText = "", teamBText = "") {
  return new Set([...getSoloRecordRosterLines(teamAText), ...getSoloRecordRosterLines(teamBText)]
    .map(getSoloRecordRosterIdentity)
    .filter(Boolean));
}

function getSoloRecordRosterError(mode = "1v1", teamAText = "", teamBText = "") {
  const sideSize = getSoloRecordModeSize(mode);
  const teamALines = getSoloRecordRosterLines(teamAText);
  const teamBLines = getSoloRecordRosterLines(teamBText);
  const teamALimit = Math.max(0, sideSize - 1);
  if (teamALines.length > teamALimit) return `우리 사이드는 본인 제외 ${teamALimit}명까지만 추가할 수 있습니다.`;
  if (teamBLines.length > sideSize) return `상대 사이드는 ${sideSize}명까지만 추가할 수 있습니다.`;
  const seen = new Map();
  for (const line of [...teamALines, ...teamBLines]) {
    const identity = getSoloRecordRosterIdentity(line);
    if (!identity) continue;
    if (seen.has(identity)) return "같은 선수를 우리/상대 또는 같은 사이드에 중복으로 넣을 수 없습니다.";
    seen.set(identity, line);
  }
  return "";
}

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

function includesQuery(value, query) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function getActionErrorCode(result) {
  if (!result || typeof result !== "object" || result.ok !== false) return "";
  return String(result.error || result.message || "server_action_failed");
}

function formatActionDebugDetails(details = null) {
  if (!details || typeof details !== "object") return "";
  const detailText = Object.entries(details)
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return detailText ? `[${detailText}]` : "";
}

function getDefaultCreateTitle(mode = "5v5") {
  return `오늘의 ${mode} 공식전`;
}

function isDefaultCreateTitle(title = "") {
  return /^오늘의\s+(1v1|2v2|3v3|4v4|5v5)\s+공식전$/i.test(String(title).trim());
}

function getMatchModeOrDefault(mode = "", fallback = "5v5") {
  return MATCH_MODE_IDS.has(String(mode)) ? String(mode) : fallback;
}

function formatCreateSaveError(result, fallback) {
  const errorCode = getActionErrorCode(result);
  if (!errorCode) return fallback;
  const detail = typeof result?.message === "string" ? result.message : "";
  const debugDetail = formatActionDebugDetails(result?.details);
  const lowerCode = errorCode.toLowerCase();
  let reason = "";
  if (errorCode === "local_reducer_blocked") {
    if (debugDetail && detail) return `${detail} ${debugDetail} 원문: ${errorCode}`;
    reason = detail || "화면 입력값이 생성 조건을 통과하지 못했습니다.";
  } else if (lowerCode.includes("rankball_recruiting_action") || lowerCode.includes("rankball_match_action") || lowerCode.includes("could not find the function")) {
    reason = "Supabase DB에 최신 SQL 함수가 아직 적용되지 않았습니다. `supabase/schema.sql`의 action RPC를 먼저 배포해야 합니다.";
  } else if (errorCode === "recruiting_sync_permission_denied" || errorCode === "match_sync_permission_denied") {
    reason = "현재 계정에 이 방/경기를 저장할 권한이 없습니다.";
  } else if (errorCode === "recruiting_team_roster_not_member" || errorCode === "match_team_roster_not_member" || errorCode === "team_roster_not_member") {
    reason = "선택한 팀 명단에 방장 또는 참가 선수가 없습니다. 팀 멤버를 먼저 등록해야 합니다.";
  } else if (errorCode === "recruiting_player_not_found" || errorCode === "match_player_not_found") {
    reason = "선택한 참가 선수 프로필을 DB에서 찾지 못했습니다.";
  } else if (errorCode === "referee_not_eligible") {
    reason = "선택한 심판이 활성 심판 조건을 통과하지 못했습니다.";
  } else if (errorCode === "team_roster_not_member") {
    reason = "선택한 출전/후보 선수가 해당 팀 roster에 없습니다.";
  } else if (errorCode === "profile_not_found" || errorCode === "missing_actor_profile_id") {
    reason = "로그인 계정과 연결된 프로필을 서버에서 찾지 못했습니다.";
  } else if (errorCode === "missing_bearer_token" || errorCode === "invalid_bearer_token") {
    reason = "로그인 토큰이 없거나 만료되었습니다. 다시 로그인해야 합니다.";
  } else if (errorCode === "server_action_missing_access_token") {
    reason = "브라우저에 Google 로그인 access token이 없어 서버 저장을 보낼 수 없습니다. 다시 로그인해야 합니다.";
  } else if (errorCode === "server_actions_disabled") {
    reason = "서버 저장 액션이 비활성화되어 있습니다. 배포 환경의 `VITE_ENABLE_SERVER_ACTIONS` 값을 확인해야 합니다.";
  } else if (errorCode === "age_group_not_allowed") {
    reason = "선택한 연령 제한과 참가자 연령대가 맞지 않습니다.";
  } else if (errorCode === "invalid_schedule_window") {
    reason = "일정이 생성 가능한 기간 밖입니다.";
  } else if (errorCode === "recruiting_core_locked" || errorCode === "match_roster_locked" || errorCode === "match_referee_locked") {
    reason = "서버가 핵심 방/경기 정보를 잠금 상태로 판단했습니다.";
  } else if (errorCode === "team_eligible_roster_insufficient") {
    reason = "연령·MMR 조건을 충족한 팀원이 경기 인원보다 적습니다.";
  } else if (errorCode === "team_roster_player_ineligible") {
    reason = "선택 명단에 연령·MMR 조건을 충족하지 않는 선수가 있습니다.";
  } else if (errorCode === "team_captain_required" || errorCode === "tournament_team_captain_required") {
    reason = "팀장만 팀전 초대·참가를 확정할 수 있습니다.";
  } else if (["tournament_representative_team_required", "tournament_creator_representative_team_required", "tournament_team_representative_required"].includes(errorCode)) {
    reason = "대회에는 대표팀으로만 참가할 수 있습니다. 팀 메뉴에서 대표팀을 확인하세요.";
  } else if (errorCode === "tournament_representative_roster_insufficient") {
    reason = "대표팀 기준으로 고정된 참가 가능 선수가 경기 인원보다 적습니다.";
  } else if (errorCode === "tournament_team_snapshot_missing") {
    reason = "대회 생성 시점의 대표팀 명단을 찾지 못했습니다.";
  } else if (errorCode === "supabase_admin_not_configured") {
    reason = "서버 Supabase service role 환경변수가 설정되지 않았습니다.";
  } else {
    reason = "서버가 저장 요청을 거부했습니다.";
  }
  return `${reason} 원문: ${errorCode}`;
}

function isHashtagQuery(query = "") {
  return query.trim().startsWith("#");
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
  return teams.find((team) => canUseTeam(team) && isSameRegion(team.region, region)) ?? teams.find(canUseTeam) ?? teams.find((team) => team.id !== teamId);
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

function getRepresentativePlayerIds(userId = "") {
  return userId ? [userId] : [];
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

function getDefaultCreateMode(team) {
  const availableCount = team ? getSelectableTeamPlayerIds(team).length : 0;
  if (availableCount >= 5) return "5v5";
  if (availableCount >= 3) return "3v3";
  if (availableCount >= 2) return "2v2";
  return "1v1";
}

function getDefaultMmrLimitMode(teamA, teamB, ranked = true, rangeMode = "narrow") {
  if (!teamA || !teamB) return "block";
  return isMmrInRecruitingRange(teamB.mmr, teamA.mmr, ranked, rangeMode) ? "block" : "warn";
}

export default function CreateMatch({ app }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isRecordCreateIntent = useMemo(() => new URLSearchParams(location.search).get("intent") === "record", [location.search]);
  const loadDirectory = app.actions.loadDirectory;
  const requestedTournamentDirectoryRef = useRef(false);
  useEffect(() => {
    if (requestedTournamentDirectoryRef.current) return;
    requestedTournamentDirectoryRef.current = true;
    loadDirectory?.({ kind: "teams", limit: DIRECTORY_PICKER_PAGE_LIMIT, offset: 0, includeTeamMemberProfiles: true });
  }, [loadDirectory]);
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id && member.role === "captain")),
    [app.currentUser.id, app.state.teams],
  );
  const representativeTeamId = app.state.settings?.representativeTeamId ?? app.currentUser.representativeTeamId ?? "";
  const currentRepresentativeTeam = useMemo(
    () => getRepresentativeTeam(app.currentUser.id, app.state.teams, representativeTeamId) ?? null,
    [app.currentUser.id, app.state.teams, representativeTeamId],
  );
  const representativeTournamentTeam = useMemo(
    () => myTeams.find((team) => team.id === currentRepresentativeTeam?.id) ?? null,
    [currentRepresentativeTeam?.id, myTeams],
  );
  const canCreateTeamRoom = myTeams.length > 0;
  const defaultTeamA = myTeams[0];
  const defaultTournamentTeamA = representativeTournamentTeam;
  const defaultMode = getDefaultCreateMode(defaultTeamA);
  const defaultHostJoinMode = canCreateTeamRoom && defaultMode !== "1v1" ? "team" : "player";
  const defaultCapacity = getRecruitingSideCapacity({ mode: defaultMode });
  const defaultTournamentCapacity = getRecruitingSideCapacity({ mode: "5v5" });
  const currentRegion = getCanonicalRegion(app.currentUser.regionDistrict || app.currentUser.region);
  const favoriteCourtIds = app.state.settings?.favoriteCourtIds ?? [];
  const defaultTeamAPlayerIds = defaultHostJoinMode === "team" ? getRepresentativePlayerIds(app.currentUser.id) : [];
  const defaultTeamB = defaultHostJoinMode === "team" && defaultTeamA
    ? getOpponentTeam(app.state.teams, defaultTeamA.id, currentRegion, defaultTeamAPlayerIds, 1)
    : undefined;
  const defaultTournamentTeamB = getOpponentTeam(app.state.teams, defaultTournamentTeamA?.id, currentRegion, [], defaultTournamentCapacity);
  const defaultTeamBPlayerIds = defaultHostJoinMode === "team" ? getDefaultTeamPlayerIds(defaultTeamB, 1, defaultTeamAPlayerIds) : [];
  const defaultMmrLimitMode = getDefaultMmrLimitMode(defaultTeamA, defaultTeamB);
  const directoryCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const [discoveredCourts, setDiscoveredCourts] = useState([]);
  const registeredCourts = useMemo(() => {
    const byId = new Map(directoryCourts.map((court) => [court.id, court]));
    discoveredCourts.forEach((court) => {
      if (court?.id && !byId.has(court.id)) byId.set(court.id, court);
    });
    return [...byId.values()];
  }, [directoryCourts, discoveredCourts]);
  const defaultCourt = [...registeredCourts]
    .filter((court) => isSameRegion(court.region, currentRegion))
    .sort((a, b) => Number(favoriteCourtIds.includes(b.id)) - Number(favoriteCourtIds.includes(a.id)) || getCourtRecommendationScore(b) - getCourtRecommendationScore(a))[0]
    ?? [...registeredCourts].sort((a, b) => getCourtRecommendationScore(b) - getCourtRecommendationScore(a))[0]
    ?? { name: "미정", region: currentRegion || app.currentUser.region };
  const [teamQuery, setTeamQuery] = useState("");
  const [opponentTeamQuery, setOpponentTeamQuery] = useState("");
  const [matchRecordOpponentQuery, setMatchRecordOpponentQuery] = useState("");
  const [matchRecordOpponentSnapshot, setMatchRecordOpponentSnapshot] = useState(null);
  const [courtQuery, setCourtQuery] = useState("");
  const [courtMapOpen, setCourtMapOpen] = useState(false);
  const [courtDetailCourtId, setCourtDetailCourtId] = useState("");
  const [refereeQuery, setRefereeQuery] = useState("");
  const [soloTeamAUserQuery, setSoloTeamAUserQuery] = useState("");
  const [soloTeamBUserQuery, setSoloTeamBUserQuery] = useState("");
  const [teamRegion, setTeamRegion] = useState(currentRegion || "전체");
  const [courtRegion, setCourtRegion] = useState(currentRegion || "전체");
  const defaultAgeRestriction = getAgeGroupForUser(app.currentUser);
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const favoriteRefereeIds = app.state.settings?.favoriteRefereeIds ?? [];
  const isFavoriteTeam = (team) => favoriteTeamIds.includes(team.id);
  const isFavoriteCourt = (court) => favoriteCourtIds.includes(court.id);
  const [draft, setDraft] = useState({
    recordType: RECORD_TYPES.match,
    visibility: "private",
    timingType: "scheduled",
    hostJoinMode: defaultHostJoinMode,
    teamOnly: false,
    mmrLimitMode: defaultMmrLimitMode,
    mmrRangeMode: "narrow",
    ageRestriction: defaultAgeRestriction,
    title: getDefaultCreateTitle(defaultMode),
    mode: defaultMode,
    courtId: defaultCourt.id ?? "",
    court: defaultCourt.name,
    tournamentCourtIds: defaultCourt.id ? [defaultCourt.id] : [],
    scheduledDate: today,
    scheduledTime: "20:30",
    teamAId: defaultTeamA?.id,
    teamBId: defaultHostJoinMode === "team" ? defaultTeamB?.id : undefined,
    playerIds: defaultTeamAPlayerIds,
    reservePlayerIds: [],
    opponentPlayerIds: [],
    opponentReservePlayerIds: [],
    opponentLeaderId: defaultTeamBPlayerIds[0] ?? "",
    approvalModeA: "leader",
    approvalModeB: "leader",
    courtReserved: false,
    courtFee: "",
    refereeWanted: false,
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
    objectionWindow: "30분",
    evidence: [],
    memo: "룰 확정 후 결과 승인.",
    stakes: "다음 경기 우선권.",
    soloOpponentName: "상대",
    soloTeamAName: "우리팀",
    soloTeamBName: "상대팀",
    soloTeamAPlayersText: "",
    soloTeamBPlayersText: "",
    soloScoreFor: "",
    soloScoreAgainst: "",
    soloStats: makeEmptySoloStats(),
    tournamentFormat: "league",
    tournamentTeamIds: [defaultTournamentTeamA?.id, defaultTournamentTeamB?.id].filter(Boolean),
    tournamentEndDate: nextWeek,
    tournamentSchedulePolicy: "weekly",
    tournamentScheduleNote: "초대팀 확정 후 경기별 일정을 배정합니다.",
    tournamentMmrPolicy: "gap_adjusted",
    tournamentMaxMmrGap: 250,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState("");

  const sortedTeams = useMemo(() => {
    const hashtagSearch = isHashtagQuery(teamQuery);
    return [...app.state.teams]
      .filter((team) => hashtagSearch || teamRegion === "전체" || isSameRegion(team.region, teamRegion))
      .filter((team) => includesQuery(`${team.name} ${getTeamHashtag(team)} ${team.region} ${team.homeCourt}`, teamQuery))
      .sort((a, b) => Number(isFavoriteTeam(b)) - Number(isFavoriteTeam(a)) || Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) || b.mmr - a.mmr);
  }, [app.state.teams, currentRegion, favoriteTeamIds, teamQuery, teamRegion]);

  const sortedCourts = useMemo(() => {
    const query = courtQuery.trim();
    const hasQuery = Boolean(query);
    const regionCandidates = registeredCourts
      .filter((court) => hasQuery || courtRegion === "전체" || isSameRegion(court.region, courtRegion));
    const exactMatches = regionCandidates.filter((court) => includesQuery(getCourtSearchText(court), query));
    const matches = exactMatches.length
      ? exactMatches
      : regionCandidates.filter((court) => isCourtFuzzySearchMatch(court, query));
    return matches
      .sort((a, b) => Number(isFavoriteCourt(b)) - Number(isFavoriteCourt(a)) || Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) || getCourtRecommendationScore(b) - getCourtRecommendationScore(a) || a.name.localeCompare(b.name));
  }, [courtQuery, courtRegion, currentRegion, favoriteCourtIds, registeredCourts]);

  const favoriteTeams = useMemo(() => {
    return [...app.state.teams]
      .filter(isFavoriteTeam)
      .sort((a, b) => Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) || b.mmr - a.mmr)
      .slice(0, 10);
  }, [app.state.teams, currentRegion, favoriteTeamIds]);

  const favoriteCourts = useMemo(() => {
    return [...registeredCourts]
      .filter(isFavoriteCourt)
      .sort((a, b) => Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) || getCourtRecommendationScore(b) - getCourtRecommendationScore(a) || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [currentRegion, favoriteCourtIds, registeredCourts]);

  const selectedTeamA = app.state.teams.find((team) => team.id === draft.teamAId);
  const selectedTeamB = app.state.teams.find((team) => team.id === draft.teamBId);
  const isSoloRecord = draft.recordType === RECORD_TYPES.personalRecord;
  const isMatchRecordRoom = draft.recordType === RECORD_TYPES.matchRecord;
  const isIndividualMatchRecord = isMatchRecordRoom && draft.mode === "1v1";
  const soloRosterError = useMemo(
    () => getSoloRecordRosterError(draft.mode, draft.soloTeamAPlayersText, draft.soloTeamBPlayersText),
    [draft.mode, draft.soloTeamAPlayersText, draft.soloTeamBPlayersText],
  );
  const soloRecordSelectedIdentitySet = useMemo(
    () => getSoloRecordSelectedIdentitySet(draft.soloTeamAPlayersText, draft.soloTeamBPlayersText),
    [draft.soloTeamAPlayersText, draft.soloTeamBPlayersText],
  );
  const isPublicRoom = !isSoloRecord && !isMatchRecordRoom && draft.visibility === "public";
  const isTournamentRoom = !isSoloRecord && !isMatchRecordRoom && draft.visibility === "tournament";
  const isTeamRoom = !isSoloRecord && !isTournamentRoom && draft.hostJoinMode === "team";
  const effectiveTeamOnly = Boolean(isTeamRoom);
  const currentRoomKind = getRoomKindFromDraft(draft);
  const sideCapacity = getRecruitingSideCapacity(draft);
  const ageRestrictionOption = getAgeRestrictionOption(draft.ageRestriction);
  const getTeamEligibility = (team, targetMmr = team?.mmr) => getTeamEventEligibility(team, app.state.users, {
    capacity: sideCapacity,
    ranked: isMatchRecordRoom ? false : draft.ranked,
    mmrLimitMode: isMatchRecordRoom ? "off" : draft.mmrLimitMode,
    mmrRangeMode: draft.mmrRangeMode,
    targetMmr,
    allowedAgeGroups: isMatchRecordRoom ? [] : ageRestrictionOption.allowedGroups,
    requireCaptainEligible: !isTournamentRoom,
  });
  const selectedTeamAEligibility = getTeamEligibility(selectedTeamA, selectedTeamA?.mmr);
  const selectedTeamBEligibility = getTeamEligibility(selectedTeamB, selectedTeamA?.mmr ?? selectedTeamB?.mmr);
  const selectedMatchRecordOpponent = matchRecordOpponentSnapshot?.id === draft.opponentLeaderId
    ? matchRecordOpponentSnapshot
    : app.state.users.find((user) => user.id === draft.opponentLeaderId) ?? null;
  const publicPartyPlayerIds = getPartyPlayerIds(selectedTeamA, draft.playerIds, sideCapacity);
  const ownerReservePlayerIds = getPartyReserveIds(selectedTeamA, draft.reservePlayerIds, publicPartyPlayerIds);
  const ownerSidePlayerIds = [...publicPartyPlayerIds, ...ownerReservePlayerIds];
  const ownerSidePlayerKey = ownerSidePlayerIds.join("|");
  const opponentPartyPlayerIds = getPartyPlayerIds(selectedTeamB, draft.opponentPlayerIds, sideCapacity, ownerSidePlayerIds);
  const opponentReservePlayerIds = getPartyReserveIds(selectedTeamB, draft.opponentReservePlayerIds, opponentPartyPlayerIds, MAX_PARTY_RESERVES, ownerSidePlayerIds);
  const opponentCaptainId = selectedTeamB?.members?.find((member) => member.role === "captain")?.userId ?? "";
  const opponentInviteTargetIds = !isPublicRoom && isTeamRoom && opponentCaptainId && !ownerSidePlayerIds.includes(opponentCaptainId) ? [opponentCaptainId] : [];
  const opponentLeaderId = isIndividualMatchRecord
    ? draft.opponentLeaderId ?? ""
    : opponentInviteTargetIds.includes(draft.opponentLeaderId) ? draft.opponentLeaderId : opponentInviteTargetIds[0] ?? "";
  const tournamentTeams = useMemo(
    () => (draft.tournamentTeamIds ?? []).map((teamId) => app.state.teams.find((team) => team.id === teamId)).filter(Boolean),
    [app.state.teams, draft.tournamentTeamIds],
  );
  const getTournamentTeamEligibility = (team) => {
    const eligibility = getTeamEligibility(team, team?.mmr);
    const isMyTeam = myTeams.some((item) => item.id === team?.id);
    if (isMyTeam && representativeTournamentTeam?.id !== team?.id) {
      return { ...eligibility, allowed: false, reason: "내 팀은 대표팀으로 설정된 팀만 참가할 수 있습니다." };
    }
    return eligibility;
  };
  const tournamentMmrSpread = getMmrSpread(tournamentTeams);
  const tournamentEligibilityById = new Map(tournamentTeams.map((team) => [team.id, getTournamentTeamEligibility(team)]));
  const ineligibleTournamentTeams = tournamentTeams.filter((team) => !tournamentEligibilityById.get(team.id)?.allowed);
  const tournamentDirectoryError = app.directoryStatus?.error ?? "";
  const tournamentDirectoryPending = app.remoteReady === false || app.directoryStatus?.loading || (app.directoryStatus?.loaded === false && !tournamentDirectoryError);
  const representativeTournamentTeamSelected = Boolean(
    representativeTournamentTeam?.id && (draft.tournamentTeamIds ?? []).includes(representativeTournamentTeam.id),
  );
  const teamOptions = useMemo(() => {
    const teamMap = new Map();
    [selectedTeamA, selectedTeamB, ...tournamentTeams, ...sortedTeams].filter(Boolean).forEach((team) => teamMap.set(team.id, team));
    return Array.from(teamMap.values());
  }, [selectedTeamA, selectedTeamB, sortedTeams, tournamentTeams]);
  const teamAOptions = myTeams;
  const isInstantRoom = !isTournamentRoom && draft.timingType === "instant";
  const scheduleMaxDate = isSoloRecord || isMatchRecordRoom ? today : isPublicRoom ? maxPublicScheduleDate : isTournamentRoom ? maxScheduleDate : maxPrivateScheduleDate;
  const activePlayerIds = useMemo(() => {
    if (!isTeamRoom) return new Set([app.currentUser.id, ...(isIndividualMatchRecord ? [opponentLeaderId] : [])].filter(Boolean));
    if (isPublicRoom) return new Set([...publicPartyPlayerIds, ...ownerReservePlayerIds]);
    return new Set([
      ...publicPartyPlayerIds,
      ...ownerReservePlayerIds,
      ...opponentPartyPlayerIds,
      ...opponentReservePlayerIds,
      opponentLeaderId,
    ]);
  }, [app.currentUser.id, isIndividualMatchRecord, isPublicRoom, isTeamRoom, opponentLeaderId, opponentPartyPlayerIds, opponentReservePlayerIds, ownerReservePlayerIds, publicPartyPlayerIds]);

  useEffect(() => {
    if (isRecordCreateIntent) {
      if (isSoloRecord || isMatchRecordRoom) return;
      setDraft((current) => {
        const mode = !canCreateTeamRoom || current.mode === "1v1"
          ? "1v1"
          : getMatchModeOrDefault(current.mode, defaultMode === "1v1" ? "2v2" : defaultMode);
        const individualRecord = mode === "1v1";
        const playerIds = individualRecord ? [app.currentUser.id] : getRepresentativePlayerIds(app.currentUser.id);
        const opponentLeaderId = individualRecord
          ? ""
          : getDefaultTeamPlayerIds(defaultTeamB, 1, playerIds)[0] ?? "";
        return {
          ...current,
          recordType: RECORD_TYPES.matchRecord,
          visibility: "private",
          timingType: "scheduled",
          hostJoinMode: individualRecord ? "player" : "team",
          teamOnly: !individualRecord,
          mode,
          ranked: false,
          official: false,
          preRegistered: false,
          mmrLimitMode: "off",
          ageRestriction: "any",
          courtReserved: false,
          courtFee: "",
          stakes: "",
          title: isDefaultCreateTitle(current.title) ? "경기 기록" : current.title,
          scheduledDate: today,
          teamAId: individualRecord ? undefined : defaultTeamA?.id ?? current.teamAId,
          teamBId: individualRecord ? undefined : defaultTeamB?.id ?? current.teamBId,
          playerIds,
          reservePlayerIds: [],
          opponentPlayerIds: individualRecord ? [opponentLeaderId].filter(Boolean) : [],
          opponentReservePlayerIds: [],
          opponentLeaderId,
        };
      });
      return;
    }
    if (!isSoloRecord && !isMatchRecordRoom) return;
    setDraft((current) => {
      const mode = getMatchModeOrDefault(current.mode, defaultMode);
      const playerIds = defaultHostJoinMode === "team" ? getRepresentativePlayerIds(app.currentUser.id) : [];
      const title = current.title === "개인 기록" || current.title === "경기 기록" || isDefaultCreateTitle(current.title)
        ? getDefaultCreateTitle(mode)
        : current.title;
      return {
        ...current,
        recordType: RECORD_TYPES.match,
        visibility: "private",
        timingType: "scheduled",
        hostJoinMode: defaultHostJoinMode,
        teamOnly: defaultHostJoinMode === "team",
        mode,
        ranked: true,
        official: true,
        preRegistered: true,
        title,
        playerIds,
        reservePlayerIds: [],
        opponentPlayerIds: [],
        opponentReservePlayerIds: [],
        opponentLeaderId: "",
      };
    });
  }, [app.currentUser.id, canCreateTeamRoom, defaultHostJoinMode, defaultMode, defaultTeamA?.id, defaultTeamB?.id, isMatchRecordRoom, isRecordCreateIntent, isSoloRecord]);

  const opponentTeamResults = useMemo(() => {
    if (!isTeamRoom || isPublicRoom || !selectedTeamA) return [];
    const query = opponentTeamQuery.trim();
    const recentOpponentScores = new Map();
    app.state.matches.forEach((match) => {
      const teamAId = match.teamA?.teamId ?? match.teamAId;
      const teamBId = match.teamB?.teamId ?? match.teamBId;
      const opponentId = teamAId === selectedTeamA.id ? teamBId : teamBId === selectedTeamA.id ? teamAId : "";
      if (!opponentId || opponentId === selectedTeamA.id) return;
      const dateValue = Date.parse(match.confirmedAt ?? match.endedAt ?? match.startedAt ?? match.scheduledAt ?? match.createdAt ?? "");
      const score = Number.isFinite(dateValue) ? dateValue : 1;
      recentOpponentScores.set(opponentId, Math.max(recentOpponentScores.get(opponentId) ?? 0, score));
    });
    return app.state.teams
      .filter((team) => team.id !== selectedTeamA.id)
      .filter((team) => getAvailableTeamPlayerIds(team, ownerSidePlayerIds).length >= 1)
      .filter((team) => !query || includesQuery(`${team.name} ${getTeamHashtag(team)} ${team.region} ${team.homeCourt}`, query))
      .filter((team) => getTeamEligibility(team, selectedTeamA.mmr).allowed || query)
      .sort((a, b) => (
        Number(favoriteTeamIds.includes(b.id)) - Number(favoriteTeamIds.includes(a.id)) ||
        Number(Boolean(recentOpponentScores.get(b.id))) - Number(Boolean(recentOpponentScores.get(a.id))) ||
        (recentOpponentScores.get(b.id) ?? 0) - (recentOpponentScores.get(a.id) ?? 0) ||
        Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) ||
        Math.abs(Number(a.mmr ?? 1200) - Number(selectedTeamA.mmr ?? 1200)) - Math.abs(Number(b.mmr ?? 1200) - Number(selectedTeamA.mmr ?? 1200)) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      ))
      .slice(0, query ? 8 : 5);
  }, [app.state.matches, app.state.teams, currentRegion, draft.ageRestriction, draft.mmrRangeMode, favoriteTeamIds, isPublicRoom, isTeamRoom, opponentTeamQuery, ownerSidePlayerIds, selectedTeamA]);
  const favoriteOpponentTeams = useMemo(() => {
    if (!isTeamRoom || isPublicRoom || !selectedTeamA) return [];
    return app.state.teams
      .filter((team) => favoriteTeamIds.includes(team.id))
      .filter((team) => team.id !== selectedTeamA.id)
      .filter((team) => getAvailableTeamPlayerIds(team, ownerSidePlayerIds).length >= 1)
      .filter((team) => getTeamEligibility(team, selectedTeamA.mmr).allowed)
      .sort((a, b) => (
        Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) ||
        Math.abs(Number(a.mmr ?? 1200) - Number(selectedTeamA.mmr ?? 1200)) - Math.abs(Number(b.mmr ?? 1200) - Number(selectedTeamA.mmr ?? 1200)) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      ))
      .slice(0, 10);
  }, [app.state.teams, currentRegion, draft.ageRestriction, draft.mmrRangeMode, favoriteTeamIds, isPublicRoom, isTeamRoom, ownerSidePlayerIds, selectedTeamA]);
  const refereeCandidates = useMemo(
    () => app.state.users
      .filter((user) => isEligibleReferee(user, REFEREE_TRUST_MIN, app.state.settings?.refereeAppointments))
      .filter((user) => !activePlayerIds.has(user.id))
      .sort((a, b) => Number(b.trustScore ?? 0) - Number(a.trustScore ?? 0)),
    [activePlayerIds, app.state.settings?.refereeAppointments, app.state.users],
  );
  const selectedReferee = refereeCandidates.find((user) => user.id === draft.refereeId) ?? null;
  const favoriteReferees = useMemo(
    () => favoriteRefereeIds
      .map((userId) => refereeCandidates.find((user) => user.id === userId))
      .filter(Boolean),
    [favoriteRefereeIds, refereeCandidates],
  );
  const refereeSearchResults = useMemo(() => {
    const query = refereeQuery.trim();
    return refereeCandidates.filter((user) => (
      !query ||
      includesQuery(`${user.name} ${getUserHashtag(user)} ${user.position} ${user.region} 신뢰도 ${user.trustScore}`, query)
    ));
  }, [refereeCandidates, refereeQuery]);
  const soloRecordUserCandidates = useMemo(
    () => app.state.users
      .filter((user) => user.id !== app.currentUser.id && !user.anonymous)
      .filter((user) => !soloRecordSelectedIdentitySet.has(getSoloRecordUserIdentity(user)))
      .sort((a, b) => (
        Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) ||
        Number(b.trustScore ?? 0) - Number(a.trustScore ?? 0) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      )),
    [app.currentUser.id, app.state.users, currentRegion, soloRecordSelectedIdentitySet],
  );
  const matchRecordOpponentCandidates = useMemo(() => {
    const blockedUserIds = new Set(app.state.settings?.blockedUserIds ?? []);
    return app.state.users
      .filter((user) => user.id !== app.currentUser.id && !user.anonymous && !blockedUserIds.has(user.id))
      .sort((a, b) => (
        Number(isSameRegion(b.region, currentRegion)) - Number(isSameRegion(a.region, currentRegion)) ||
        Number(b.trustScore ?? 0) - Number(a.trustScore ?? 0) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
      ));
  }, [app.currentUser.id, app.state.settings?.blockedUserIds, app.state.users, currentRegion]);
  const teamTierRange = getRecruitingTierRange(selectedTeamA?.mmr ?? 1200, draft.ranked, draft.mmrRangeMode);
  const personalTierRange = getRecruitingTierRange(app.currentUser.ratings?.integrated ?? 1200, draft.ranked, draft.mmrRangeMode);
  const roomTierRange = isTeamRoom ? teamTierRange : personalTierRange;
  const mmrRangePolicy = MMR_RANGE_POLICIES[draft.mmrRangeMode] ?? MMR_RANGE_POLICIES.narrow;
  const currentUserAgeGroup = getAgeGroupForUser(app.currentUser);
  const ageRestrictionBlocked = !isSoloRecord && !isMatchRecordRoom && !isTournamentRoom && !ageRestrictionOption.allowedGroups.includes(currentUserAgeGroup);
  const hostTrustRequired = !isSoloRecord && !isMatchRecordRoom && !isTournamentRoom
    ? getHostTrustRequirement({ ranked: draft.ranked, visibility: isPublicRoom ? "public" : "private", official: draft.official })
    : 0;
  const hostTrustScore = Number(app.currentUser.trustScore ?? 0);
  const hostTrustBlocked = hostTrustRequired > 0 && hostTrustScore < hostTrustRequired;
  const teamTierBlocked = Boolean(
    isTeamRoom &&
      !isPublicRoom &&
      !isMatchRecordRoom &&
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
      !isMatchRecordRoom &&
      !isTournamentRoom &&
      draft.mmrLimitMode === "warn" &&
      draft.ranked &&
      selectedTeamA &&
      selectedTeamB &&
      !isMmrInRecruitingRange(selectedTeamB.mmr, selectedTeamA.mmr, true, draft.mmrRangeMode),
  );
  const scheduledTimingStatus = getPublicRoomTimingStatus({
    ...draft,
    visibility: isPublicRoom ? "public" : "private",
  });
  const scheduledTimingAllowed = isInstantRoom || scheduledTimingStatus.canCreate;
  const scheduleAllowed = isSoloRecord || isMatchRecordRoom
    ? Boolean(draft.scheduledDate && draft.scheduledDate >= minSoloRecordDate && draft.scheduledDate <= today)
    : isInstantRoom || (draft.scheduledDate >= today && draft.scheduledDate <= scheduleMaxDate && scheduledTimingAllowed);
  const tournamentEndAllowed = !isTournamentRoom || (draft.tournamentEndDate >= today && draft.tournamentEndDate <= maxScheduleDate);
  const selectedCourt = useMemo(
    () => registeredCourts.find((court) => court.id === draft.courtId || court.name === draft.court) ?? null,
    [draft.court, draft.courtId, registeredCourts],
  );
  const selectedTournamentCourts = useMemo(() => {
    const selectedIds = new Set(draft.tournamentCourtIds ?? []);
    return registeredCourts.filter((court) => selectedIds.has(court.id));
  }, [draft.tournamentCourtIds, registeredCourts]);
  const courtRequiredBlocked = !selectedCourt?.id;
  const ownsSelectedTeamA = myTeams.some((team) => team.id === draft.teamAId);
  const privateTeamDuplicate = !isPublicRoom && isTeamRoom && opponentPartyPlayerIds.some((playerId) => ownerSidePlayerIds.includes(playerId));
  const privateTeamInvalid = !isPublicRoom && isTeamRoom && (
    !ownsSelectedTeamA ||
    !selectedTeamA ||
    !selectedTeamB ||
    !selectedTeamAEligibility.allowed ||
    !selectedTeamBEligibility.allowed ||
    selectedTeamA.id === selectedTeamB.id ||
    privateTeamDuplicate ||
    !opponentLeaderId
  );
  const matchRecordIndividualInvalid = isIndividualMatchRecord && (
    draft.hostJoinMode !== "player" ||
    draft.teamOnly === true ||
    !selectedMatchRecordOpponent ||
    selectedMatchRecordOpponent.id === app.currentUser.id
  );
  const matchRecordTeamInvalid = isMatchRecordRoom && !isIndividualMatchRecord && (
    !isTeamRoom ||
    !ownsSelectedTeamA ||
    !selectedTeamA ||
    !selectedTeamB ||
    !selectedTeamAEligibility.allowed ||
    !selectedTeamBEligibility.allowed ||
    selectedTeamA.id === selectedTeamB.id ||
    !opponentLeaderId ||
    opponentLeaderId === app.currentUser.id
  );
  const publicTeamInvalid = isPublicRoom && isTeamRoom && (
    !myTeams.some((team) => team.id === draft.teamAId) ||
    !selectedTeamAEligibility.allowed
  );
  const tournamentMmrBlocked = Boolean(
    isTournamentRoom &&
      draft.ranked &&
      draft.mmrLimitMode === "block" &&
      tournamentMmrSpread > Number(draft.tournamentMaxMmrGap ?? 250),
  );
  const tournamentInvalid = !draft.title.trim() || tournamentDirectoryPending || Boolean(tournamentDirectoryError) || !representativeTournamentTeamSelected || tournamentTeams.length < 2 || tournamentMmrBlocked || ineligibleTournamentTeams.length > 0;
  const publicTeamInvalidReason = !myTeams.some((team) => team.id === draft.teamAId)
    ? "내 팀을 먼저 선택해야 팀방을 만들 수 있습니다."
    : !selectedTeamAEligibility.allowed
      ? `${selectedTeamA?.name ?? "선택 팀"}: ${selectedTeamAEligibility.reason}`
    : "";
  const privateTeamInvalidReason = !ownsSelectedTeamA
    ? "팀전은 내 팀을 A사이드로 선택해야 만들 수 있습니다."
    : !selectedTeamB
      ? "B사이드 상대 팀을 검색해서 선택해야 합니다."
      : !selectedTeamAEligibility.allowed
        ? `${selectedTeamA?.name ?? "A사이드"}: ${selectedTeamAEligibility.reason}`
        : !selectedTeamBEligibility.allowed
          ? `${selectedTeamB.name}: ${selectedTeamBEligibility.reason}`
      : selectedTeamA?.id === selectedTeamB.id
        ? "A/B사이드는 서로 다른 팀이어야 합니다."
        : privateTeamDuplicate
          ? "A/B사이드 출전 선수는 중복될 수 없습니다."
          : !opponentLeaderId
              ? "B사이드 초대 대상 1명을 선택해야 합니다."
              : "";
  const matchRecordInvalidReason = isIndividualMatchRecord
    ? !selectedMatchRecordOpponent
      ? "기록 확인을 받을 상대 선수를 선택해야 합니다."
      : selectedMatchRecordOpponent.id === app.currentUser.id
        ? "본인을 상대 선수로 선택할 수 없습니다."
        : draft.hostJoinMode !== "player" || draft.teamOnly === true
          ? "1v1 경기 기록방은 개인전으로 만들어야 합니다."
          : ""
    : !isTeamRoom
    ? "2v2 이상 경기 기록방은 팀전으로 만들어야 합니다."
    : !ownsSelectedTeamA
      ? "기록할 내 팀을 A사이드로 선택해야 합니다."
    : !selectedTeamB
      ? "기록 확인을 받을 B사이드 팀을 선택해야 합니다."
      : !selectedTeamAEligibility.allowed
        ? `${selectedTeamA?.name ?? "A사이드"}: ${selectedTeamAEligibility.reason}`
        : !selectedTeamBEligibility.allowed
          ? `${selectedTeamB.name}: ${selectedTeamBEligibility.reason}`
      : selectedTeamA?.id === selectedTeamB.id
          ? "A/B사이드는 서로 다른 팀이어야 합니다."
          : !opponentLeaderId || opponentLeaderId === app.currentUser.id
            ? "B사이드 기록 확인 대표 1명을 선택해야 합니다."
            : "";
  const tournamentInvalidReason = !draft.title.trim()
    ? "대회 이름을 입력해야 생성할 수 있습니다."
    : tournamentDirectoryPending
      ? "팀원 정보를 불러오는 중입니다."
    : tournamentDirectoryError
      ? "팀원 정보를 불러오지 못했습니다. 다시 시도하세요."
    : !representativeTournamentTeam
      ? "대회에 참가할 대표팀의 팀장이어야 합니다."
    : !representativeTournamentTeamSelected
      ? "내 대표팀을 참가팀에 포함해야 합니다."
    : tournamentTeams.length < 2
      ? "대회는 최소 2개 팀을 선택해야 생성할 수 있습니다."
      : tournamentMmrBlocked
        ? "대회 팀 MMR 차이가 허용값을 넘었습니다. MMR 제한을 경고만 또는 제한 없음으로 바꾸면 생성할 수 있습니다."
        : ineligibleTournamentTeams.length
          ? `${ineligibleTournamentTeams[0].name}: ${tournamentEligibilityById.get(ineligibleTournamentTeams[0].id)?.reason}`
        : "";
  const soloStatsInvalid = PLAYER_STAT_FIELDS.some((field) => {
    if (field.id === "points") return false;
    const value = Number((draft.soloStats ?? {})[field.id] ?? 0);
    return !Number.isFinite(value) || value < 0 || value > 999;
  });
  const soloScoreForNumber = Number(draft.soloScoreFor);
  const soloScoreAgainstNumber = Number(draft.soloScoreAgainst);
  const soloRecordInvalid = isSoloRecord && (
    !draft.title.trim() ||
    !draft.scheduledDate ||
    draft.scheduledDate < minSoloRecordDate ||
    draft.scheduledDate > today ||
    !Number.isFinite(soloScoreForNumber) ||
    !Number.isFinite(soloScoreAgainstNumber) ||
    soloScoreForNumber < 0 ||
    soloScoreAgainstNumber < 0 ||
    soloScoreForNumber > 999 ||
    soloScoreAgainstNumber > 999 ||
    Boolean(soloRosterError) ||
    soloStatsInvalid
  );
  const matchRecordInvalid = isMatchRecordRoom && (matchRecordIndividualInvalid || matchRecordTeamInvalid);
  const submitDisabled = courtRequiredBlocked || (isSoloRecord ? soloRecordInvalid : !scheduleAllowed || !tournamentEndAllowed || ageRestrictionBlocked || hostTrustBlocked || (isMatchRecordRoom
    ? matchRecordInvalid
    : isTournamentRoom
    ? tournamentInvalid
    : isPublicRoom
      ? publicTeamInvalid
      : teamTierBlocked || privateTeamInvalid));
  const submitDisabledReason = courtRequiredBlocked
    ? "등록된 구장을 선택해야 생성할 수 있습니다."
    : isSoloRecord && soloRecordInvalid
    ? soloRosterError || "제목, 날짜, 점수를 확인해야 합니다. 개인 기록 날짜는 오늘부터 과거 7일까지만 가능합니다."
    : isMatchRecordRoom && matchRecordInvalid
      ? (matchRecordInvalidReason || "경기 기록방은 A/B팀과 기록 확인 대표가 필요합니다.")
    : !scheduleAllowed
    ? isMatchRecordRoom ? "경기 기록 날짜는 오늘부터 과거 7일까지만 가능합니다." : "일정 조건이 맞지 않습니다. 즉시는 바로 생성 가능하고, 예약 일정은 허용 기간 안에서만 가능합니다."
    : !tournamentEndAllowed
      ? "대회 종료일이 허용 기간을 벗어났습니다."
      : teamTierBlocked
        ? "상대팀 MMR이 현재 허용구간 밖입니다. MMR 제한을 경고만 또는 제한 없음으로 바꾸면 생성할 수 있습니다."
        : ageRestrictionBlocked
          ? "생성자가 선택한 연령 제한 밖입니다. 연령 제한을 바꾸면 생성할 수 있습니다."
          : hostTrustBlocked
            ? `방장 신뢰도 ${hostTrustRequired}점 이상 필요합니다. 현재 ${hostTrustScore}점입니다.`
            : privateTeamInvalid
              ? privateTeamInvalidReason || "팀전은 A사이드 팀과 B사이드 대표가 필요합니다."
              : isTournamentRoom && tournamentInvalidReason
                ? tournamentInvalidReason
                : isPublicRoom && publicTeamInvalidReason
                  ? publicTeamInvalidReason
                  : "";
  const courtSummary = selectedCourt ?? defaultCourt;
  const courtPlayWarning = selectedCourt ? getCourtPlayWarning(selectedCourt, draft.mode) : "";
  const selectCourt = (court) => {
    setSubmitFeedback("");
    if (court?.id && !registeredCourts.some((item) => item.id === court.id)) {
      setDiscoveredCourts((current) => [...current.filter((item) => item.id !== court.id), court]);
    }
    setDraft((current) => ({
      ...current,
      courtId: court.id ?? "",
      court: court.name,
      ...(isTournamentRoom && court.id
        ? { tournamentCourtIds: Array.from(new Set([...(current.tournamentCourtIds ?? []), court.id])) }
        : {}),
    }));
    setCourtQuery(court.name);
    if (court.region) setCourtRegion(court.region);
  };
  const removeTournamentCourt = (courtId) => {
    setSubmitFeedback("");
    setDraft((current) => {
      const nextIds = (current.tournamentCourtIds ?? []).filter((id) => id !== courtId);
      if (!nextIds.length) return current;
      if (current.courtId !== courtId) return { ...current, tournamentCourtIds: nextIds };
      const nextCourt = registeredCourts.find((court) => court.id === nextIds[0]);
      return {
        ...current,
        tournamentCourtIds: nextIds,
        courtId: nextCourt?.id ?? "",
        court: nextCourt?.name ?? "",
      };
    });
  };

  const update = (patch) => {
    setSubmitFeedback("");
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (patch.ranked === false) next.official = false;
      return next;
    });
  };
  const updateSoloStat = (fieldId, value) => {
    const nextValue = Math.max(0, Math.min(999, Number(value) || 0));
    update({ soloStats: { ...(draft.soloStats ?? {}), [fieldId]: nextValue } });
  };
  const clearZeroSoloScore = (fieldId) => {
    setDraft((current) => (String(current[fieldId]) === "0" ? { ...current, [fieldId]: "" } : current));
  };
  const appendSoloRecordUser = (sideName, user) => {
    const fieldId = sideName === "teamA" ? "soloTeamAPlayersText" : "soloTeamBPlayersText";
    const line = getSoloRecordUserLine(user);
    if (!line) return;
    const sideSize = getSoloRecordModeSize(draft.mode);
    const targetLimit = sideName === "teamA" ? Math.max(0, sideSize - 1) : sideSize;
    const targetLines = getSoloRecordRosterLines(draft[fieldId]);
    const identity = getSoloRecordRosterIdentity(line);
    if (targetLines.length >= targetLimit) {
      setSubmitFeedback(sideName === "teamA" ? `우리 사이드는 본인 제외 ${targetLimit}명까지만 추가할 수 있습니다.` : `상대 사이드는 ${targetLimit}명까지만 추가할 수 있습니다.`);
      return;
    }
    if (identity && soloRecordSelectedIdentitySet.has(identity)) {
      setSubmitFeedback("같은 선수를 우리/상대 또는 같은 사이드에 중복으로 넣을 수 없습니다.");
      return;
    }
    setSubmitFeedback("");
    setDraft((current) => {
      const lines = String(current[fieldId] ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
      if (lines.includes(line)) return current;
      return { ...current, [fieldId]: [...lines, line].join("\n") };
    });
    if (sideName === "teamA") setSoloTeamAUserQuery("");
    else setSoloTeamBUserQuery("");
  };
  const selectMatchRecordOpponent = (user) => {
    if (!user?.id || user.id === app.currentUser.id) return;
    setMatchRecordOpponentSnapshot(user);
    setMatchRecordOpponentQuery("");
    update({
      opponentLeaderId: user.id,
      opponentPlayerIds: [user.id],
      opponentReservePlayerIds: [],
    });
  };
  useEffect(() => {
    if (!draft.refereeId) return;
    if (refereeCandidates.some((user) => user.id === draft.refereeId)) return;
    setDraft((current) => ({ ...current, refereeId: "" }));
    setRefereeQuery("");
  }, [draft.refereeId, refereeCandidates]);

  useEffect(() => {
    if (!app.state.teams.length) return;
    setDraft((current) => {
      const teamAExists = app.state.teams.some((team) => team.id === current.teamAId);
      const teamBExists = app.state.teams.some((team) => team.id === current.teamBId);
      const capacity = getRecruitingSideCapacity(current);
      const currentTournamentTeamIds = (current.tournamentTeamIds ?? []).filter((teamId) => app.state.teams.some((team) => team.id === teamId));
      const tournamentTeamIds = currentTournamentTeamIds.filter((teamId) => (
        !myTeams.some((team) => team.id === teamId) || teamId === representativeTournamentTeam?.id
      ));
      if (representativeTournamentTeam?.id && !tournamentTeamIds.includes(representativeTournamentTeam.id)) {
        tournamentTeamIds.unshift(representativeTournamentTeam.id);
      }
      if (!currentTournamentTeamIds.length && defaultTournamentTeamB?.id && !tournamentTeamIds.includes(defaultTournamentTeamB.id)) {
        tournamentTeamIds.push(defaultTournamentTeamB.id);
      }
      const nextUserTeamId = myTeams[0]?.id ?? "";
      const currentTeamAIsMine = teamAExists && myTeams.some((team) => team.id === current.teamAId);
      const nextTeamAId = currentTeamAIsMine ? current.teamAId : nextUserTeamId;
      const nextTeamA = app.state.teams.find((team) => team.id === nextTeamAId);
      const nextTeamAPlayerIds = nextTeamA ? getRepresentativePlayerIds(app.currentUser.id) : [];
      const currentTeamB = app.state.teams.find((team) => team.id === current.teamBId);
      const currentTeamBUsable = teamBExists &&
        current.teamBId !== nextTeamAId &&
        getDefaultTeamPlayerIds(currentTeamB, capacity, nextTeamAPlayerIds).length >= capacity;
      const nextTeamB = currentTeamBUsable
        ? currentTeamB
        : getOpponentTeam(app.state.teams, nextTeamAId, currentRegion, nextTeamAPlayerIds, capacity);
      const nextTeamBId = nextTeamB?.id;
      const nextMmrLimitMode = isDefaultCreateTitle(current.title)
        ? getDefaultMmrLimitMode(nextTeamA, nextTeamB, current.ranked, current.mmrRangeMode)
        : current.mmrLimitMode;
      if (current.teamAId === nextTeamAId && current.teamBId === nextTeamBId && current.mmrLimitMode === nextMmrLimitMode && tournamentTeamIds.length === (current.tournamentTeamIds ?? []).length) return current;
      return { ...current, teamAId: nextTeamAId, teamBId: nextTeamBId, mmrLimitMode: nextMmrLimitMode, tournamentTeamIds };
    });
  }, [app.currentUser.id, app.state.teams, currentRegion, defaultTournamentTeamB?.id, myTeams, representativeTournamentTeam?.id]);

  useEffect(() => {
    if (canCreateTeamRoom) return;
    setDraft((current) => current.hostJoinMode === "team"
      ? {
        ...current,
        hostJoinMode: "player",
        teamOnly: false,
        playerIds: [],
        reservePlayerIds: [],
        opponentPlayerIds: [],
        opponentReservePlayerIds: [],
        opponentLeaderId: "",
      }
      : current);
  }, [canCreateTeamRoom]);

  useEffect(() => {
    if (!isTeamRoom || !selectedTeamA) return;
    const selectableIds = getSelectableTeamPlayerIds(selectedTeamA);
    const selectedIds = selectableIds.includes(app.currentUser.id) ? getRepresentativePlayerIds(app.currentUser.id) : [];
    const playerIdsNeedSync = !Array.isArray(draft.playerIds)
      || draft.playerIds.length !== selectedIds.length
      || draft.playerIds.some((playerId, index) => playerId !== selectedIds[index]);
    const reserveIdsNeedSync = !Array.isArray(draft.reservePlayerIds)
      || draft.reservePlayerIds.length > 0;
    if (!playerIdsNeedSync && !reserveIdsNeedSync) return;
    setDraft((current) => ({
      ...current,
      playerIds: selectedIds,
      reservePlayerIds: [],
    }));
  }, [app.currentUser.id, draft.hostJoinMode, draft.playerIds, draft.reservePlayerIds, isPublicRoom, isTeamRoom, selectedTeamA]);

  useEffect(() => {
    if (!isTeamRoom || isPublicRoom || !selectedTeamB) return;
    const excludedIds = [...publicPartyPlayerIds, ...ownerReservePlayerIds];
    const captainId = selectedTeamB.members?.find((member) => member.role === "captain")?.userId ?? "";
    const nextLeaderId = captainId && !excludedIds.includes(captainId) ? captainId : "";
    const playerIdsNeedSync = !Array.isArray(draft.opponentPlayerIds)
      || draft.opponentPlayerIds.length > 0;
    const reserveIdsNeedSync = !Array.isArray(draft.opponentReservePlayerIds)
      || draft.opponentReservePlayerIds.length > 0;
    const leaderNeedSync = draft.opponentLeaderId !== nextLeaderId;
    if (!playerIdsNeedSync && !reserveIdsNeedSync && !leaderNeedSync) return;
    setDraft((current) => ({
      ...current,
      opponentPlayerIds: [],
      opponentReservePlayerIds: [],
      opponentLeaderId: nextLeaderId,
    }));
  }, [draft.hostJoinMode, draft.opponentLeaderId, draft.opponentPlayerIds, draft.opponentReservePlayerIds, isPublicRoom, isTeamRoom, ownerSidePlayerKey, selectedTeamB]);

  const selectTeamA = (teamAId) => {
    if (!myTeams.some((team) => team.id === teamAId)) return;
    const team = app.state.teams.find((item) => item.id === teamAId);
    const teamEligibility = getTeamEligibility(team, team?.mmr);
    if (!teamEligibility.allowed) {
      setSubmitFeedback(`${team?.name ?? "내 팀"}: ${teamEligibility.reason}`);
      return;
    }
    const playerIds = getRepresentativePlayerIds(app.currentUser.id);
    const currentTeamB = app.state.teams.find((item) => item.id === draft.teamBId);
    const currentTeamBUsable = currentTeamB &&
      currentTeamB.id !== teamAId &&
      getAvailableTeamPlayerIds(currentTeamB, playerIds).length >= 1;
    const nextTeamB = currentTeamBUsable
      ? currentTeamB
      : getOpponentTeam(sortedTeams, teamAId, currentRegion, playerIds, 1) ?? getOpponentTeam(app.state.teams, teamAId, currentRegion, playerIds, 1);
    const opponentLeaderId = nextTeamB?.members?.find((member) => member.role === "captain")?.userId ?? "";
    setOpponentTeamQuery("");
    update({
      teamAId,
      teamBId: nextTeamB?.id,
      ...(isTeamRoom ? {
        playerIds,
        reservePlayerIds: [],
        opponentPlayerIds: [],
        opponentReservePlayerIds: [],
        opponentLeaderId,
      } : {}),
    });
  };
  const selectTeamB = (teamBId) => {
    const currentTeamA = app.state.teams.find((item) => item.id === draft.teamAId);
    const nextTeamA = currentTeamA?.id === teamBId
      ? getOpponentTeam(sortedTeams, teamBId, currentRegion, [], sideCapacity) ?? getOpponentTeam(app.state.teams, teamBId, currentRegion, [], sideCapacity)
      : currentTeamA;
    const playerIds = draft.playerIds?.length ? draft.playerIds : getRepresentativePlayerIds(app.currentUser.id);
    const team = app.state.teams.find((item) => item.id === teamBId);
    const teamEligibility = getTeamEligibility(team, nextTeamA?.mmr ?? team?.mmr);
    if (!teamEligibility.allowed) {
      setSubmitFeedback(`${team?.name ?? "상대 팀"}: ${teamEligibility.reason}`);
      return;
    }
    const opponentLeaderId = team?.members?.find((member) => member.role === "captain")?.userId ?? "";
    setOpponentTeamQuery("");
    update({
      teamAId: nextTeamA?.id,
      teamBId,
      ...(isTeamRoom ? {
        playerIds,
        reservePlayerIds: [],
        opponentPlayerIds: [],
        opponentReservePlayerIds: [],
        opponentLeaderId,
      } : {}),
    });
  };
  const assignTeam = (teamId, side) => {
    if (side === "A") selectTeamA(teamId);
    if (side === "B") selectTeamB(teamId);
  };
  const toggleTournamentTeam = (teamId) => {
    const teamIds = draft.tournamentTeamIds ?? [];
    const team = app.state.teams.find((item) => item.id === teamId);
    if (teamIds.includes(teamId) && teamId === representativeTournamentTeam?.id) {
      setSubmitFeedback("내 대표팀은 대회 참가팀에서 해제할 수 없습니다.");
      return;
    }
    if (!teamIds.includes(teamId)) {
      const eligibility = getTournamentTeamEligibility(team);
      if (!eligibility.allowed) {
        setSubmitFeedback(`${team?.name ?? "선택 팀"}: ${eligibility.reason}`);
        return;
      }
    }
    setDraft((current) => {
      const currentTeamIds = current.tournamentTeamIds ?? [];
      return {
        ...current,
        tournamentTeamIds: currentTeamIds.includes(teamId)
          ? currentTeamIds.filter((id) => id !== teamId)
          : [...currentTeamIds, teamId],
      };
    });
  };
  const renderCourtSearchItem = (court) => {
    const favorite = isFavoriteCourt(court);
    const rating = Number(court.adjustedRating ?? court.rating ?? 0);
    const reviewCount = Number(court.reviewCount ?? 0);
    const completedMatchCount = Number(court.completedMatchCount ?? 0);
    return (
      <div
        key={court.id}
        className={draft.court === court.name ? "search-picker-result-row search-picker-result-row-actionable selected" : "search-picker-result-row search-picker-result-row-actionable"}
        onMouseDown={(event) => event.preventDefault()}
      >
        <button type="button" className="search-picker-result-main" onClick={() => selectCourt(court)}>
          <strong>{court.name}</strong>
          <span className="court-search-result-address">{getCourtAddress(court)}</span>
          <span>{court.region} / {court.type} / {getCourtSurfaceLabel(court)} / {getCourtLayoutLabel(court)}</span>
          <em className="court-search-result-meta">
            <span>{getCourtHashtag(court)} · {favorite ? "즐겨찾기" : "구장"}</span>
            <span><Star size={13} fill={reviewCount ? "currentColor" : "none"} /> {reviewCount ? `보정 ${rating.toFixed(1)} · 리뷰 ${reviewCount}` : "평가 전"} · 경기 {completedMatchCount}</span>
          </em>
        </button>
      </div>
    );
  };
  const renderCreateTeamSearchItem = (team) => {
    const invited = (draft.tournamentTeamIds ?? []).includes(team.id);
    const selected = isTournamentRoom ? invited : isPublicRoom ? draft.teamAId === team.id : draft.teamAId === team.id;
    const eligibility = isTournamentRoom ? getTournamentTeamEligibility(team) : getTeamEligibility(team, team.mmr);
    const actionLabel = isTournamentRoom ? (invited ? "초대 해제" : "초대") : isPublicRoom ? "내 파티" : "A사이드";
    return (
      <button
        key={team.id}
        type="button"
        className={["search-picker-result-row", selected ? "selected" : "", !eligibility.allowed && !invited ? "is-disabled" : ""].filter(Boolean).join(" ")}
        disabled={!eligibility.allowed && !invited}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (isTournamentRoom) toggleTournamentTeam(team.id);
          else assignTeam(team.id, "A");
        }}
      >
        <strong>{team.name}</strong>
        <span>{team.region} · {team.mmr} MMR · {team.homeCourt}</span>
        <em>{getTeamHashtag(team)} · {eligibility.allowed ? `${actionLabel} · 가능 ${eligibility.eligibleCount}/${eligibility.capacity}` : eligibility.reason}</em>
      </button>
    );
  };
  const renderOpponentTeamSearchItem = (team) => {
    const mmrBlocked = draft.mmrLimitMode === "block" && draft.ranked && selectedTeamA && !isMmrInRecruitingRange(team.mmr, selectedTeamA.mmr, true, draft.mmrRangeMode);
    const eligibility = getTeamEligibility(team, selectedTeamA?.mmr ?? team.mmr);
    const favorite = favoriteTeamIds.includes(team.id);
    const toggleFavorite = (event) => {
      event.preventDefault();
      event.stopPropagation();
      app.actions.toggleFavoriteTeam(team.id);
    };
    return (
      <div
        key={team.id}
        className={team.id === draft.teamBId ? "search-picker-result-row search-picker-result-row-actionable selected" : "search-picker-result-row search-picker-result-row-actionable"}
        onMouseDown={(event) => event.preventDefault()}
      >
        <button type="button" className="search-picker-result-main" disabled={!eligibility.allowed || mmrBlocked} onClick={() => selectTeamB(team.id)}>
          <strong>{team.name}</strong>
          <span>{team.region} · {team.mmr} MMR · {team.homeCourt}</span>
          <em>{getTeamHashtag(team)} · {mmrBlocked ? "팀 MMR 범위 밖" : eligibility.allowed ? `${favorite ? "즐겨찾기" : "B사이드"} · 가능 ${eligibility.eligibleCount}/${eligibility.capacity}` : eligibility.reason}</em>
        </button>
        <button
          type="button"
          className={favorite ? "search-picker-favorite-action active" : "search-picker-favorite-action"}
          aria-label={favorite ? `${team.name} 즐겨찾기 해제` : `${team.name} 즐겨찾기 추가`}
          aria-pressed={favorite}
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleFavorite}
        >
          <Star size={16} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
    );
  };
  const selectReferee = (user) => {
    update({ refereeWanted: true, refereeId: user.id });
    setRefereeQuery(user.name ?? "");
  };
  const clearReferee = () => {
    update({ refereeWanted: false, refereeId: "" });
    setRefereeQuery("");
  };
  const renderRefereeSearchItem = (user) => {
    const favorite = favoriteRefereeIds.includes(user.id);
    return (
      <div
        key={user.id}
        className={user.id === draft.refereeId ? "search-picker-result-row search-picker-result-row-actionable selected" : "search-picker-result-row search-picker-result-row-actionable"}
        onMouseDown={(event) => event.preventDefault()}
      >
        <button type="button" className="search-picker-result-main" onClick={() => selectReferee(user)}>
          <strong>{user.name}</strong>
          <span>{getUserHashtag(user)} · {user.position} · {user.region}</span>
          <em>{favorite ? "즐겨찾기 · " : ""}신뢰도 {user.trustScore} · {user.refereeProfile?.grade ?? user.refereeGrade ?? "심판"}</em>
        </button>
      </div>
    );
  };
  const renderSoloRecordUserSearchItem = (sideName) => (user) => (
    <div
      key={user.id}
      className="search-picker-result-row search-picker-result-row-actionable"
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" className="search-picker-result-main" onClick={() => appendSoloRecordUser(sideName, user)}>
        <strong>{user.name}</strong>
        <span>{getUserHashtag(user)} · {user.position} · {user.region}</span>
        <em>텍스트만 추가 · 유저 연결 없음</em>
      </button>
    </div>
  );
  const renderMatchRecordOpponentSearchItem = (user) => (
    <div
      key={user.id}
      className={user.id === draft.opponentLeaderId ? "search-picker-result-row search-picker-result-row-actionable selected" : "search-picker-result-row search-picker-result-row-actionable"}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" className="search-picker-result-main" onClick={() => selectMatchRecordOpponent(user)}>
        <strong>{user.name}</strong>
        <span>{getUserHashtag(user)} · {user.position ?? "포지션 자유"} · {user.region ?? "지역 미정"}</span>
        <em>1v1 기록 확인 요청</em>
      </button>
    </div>
  );
  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (submitDisabled) {
      setSubmitFeedback(submitDisabledReason || "경기 생성 조건을 확인하세요.");
      return;
    }
    setSubmitFeedback("");
    setSubmitting(true);
    try {
    if (isSoloRecord) {
      const matchId = await app.actions.createMatch({
        ...draft,
        recordType: RECORD_TYPES.personalRecord,
        visibility: "private",
        ranked: false,
        official: false,
        preRegistered: false,
        mode: draft.mode,
        mmrLimitMode: "off",
        courtId: selectedCourt.id,
        court: selectedCourt.name,
        scheduledDate: draft.scheduledDate,
        scheduledTime: draft.scheduledTime,
      });
      if (typeof matchId === "string" && matchId) navigate("/app/profile/records");
      else {
        setSubmitFeedback(formatCreateSaveError(matchId, "개인 기록 저장에 실패했습니다."));
      }
      return;
    }
    if (isMatchRecordRoom) {
      const individualRecord = draft.mode === "1v1";
      const matchId = await app.actions.createMatch({
        ...draft,
        recordType: RECORD_TYPES.matchRecord,
        visibility: "private",
        timingType: "scheduled",
        hostJoinMode: individualRecord ? "player" : "team",
        teamOnly: !individualRecord,
        ranked: false,
        official: false,
        preRegistered: false,
        mmrLimitMode: "off",
        ageRestriction: "any",
        allowedAgeGroups: [],
        courtReserved: false,
        courtFee: "",
        stakes: "",
        teamAId: individualRecord ? undefined : draft.teamAId,
        teamBId: individualRecord ? undefined : draft.teamBId,
        playerIds: individualRecord ? [app.currentUser.id] : getRepresentativePlayerIds(app.currentUser.id),
        reservePlayerIds: [],
        opponentPlayerIds: [opponentLeaderId].filter(Boolean),
        opponentReservePlayerIds: [],
        opponentLeaderId,
        courtId: selectedCourt.id,
        court: selectedCourt.name,
        scheduledDate: draft.scheduledDate,
        scheduledTime: draft.scheduledTime,
      });
      if (typeof matchId === "string" && matchId) navigate(`/app/recorder?match=${encodeURIComponent(matchId)}`);
      else {
        setSubmitFeedback(formatCreateSaveError(matchId, "경기 기록방 생성에 실패했습니다."));
      }
      return;
    }
    if (isTournamentRoom) {
      const tournamentResult = await app.actions.createTournament({
        ...draft,
        teamIds: draft.tournamentTeamIds,
        courtId: selectedCourt.id,
        court: selectedCourt.name,
        region: selectedCourt.region,
        rules: {
          targetScore: Number(draft.targetScore),
          timeLimit: Number(draft.timeLimit),
          ball: draft.ball,
          winByTwo: Boolean(draft.winByTwo),
          attackRule: draft.attackRule,
          foulRule: draft.foulRule,
          sideCapacity,
          mmrLimitMode: draft.mmrLimitMode,
          mmrRangeMode: draft.mmrRangeMode,
          ageRestriction: draft.ageRestriction,
          allowedAgeGroups: ageRestrictionOption.allowedGroups,
          allowedCourtIds: selectedTournamentCourts.map((court) => court.id),
          allowedCourts: selectedTournamentCourts.map((court) => ({ id: court.id, name: court.name, region: court.region })),
          rosterReady: { teamA: false, teamB: false },
        },
      });
      if (typeof tournamentResult === "string" && tournamentResult) {
        navigate(`/app/tournaments/${encodeURIComponent(tournamentResult)}`, {
          state: { from: "/app/matches?panel=tournament" },
        });
      }
      else {
        setSubmitFeedback(formatCreateSaveError(tournamentResult, "대회 저장에 실패했습니다."));
      }
      return;
    }
    const postId = await app.actions.createRecruitingPost({
      visibility: draft.visibility,
      title: draft.title,
      hostJoinMode: draft.hostJoinMode,
      teamOnly: effectiveTeamOnly,
      teamId: isTeamRoom ? draft.teamAId : "",
      playerIds: isTeamRoom ? getRepresentativePlayerIds(app.currentUser.id) : [],
      reservePlayerIds: [],
      opponentTeamId: !isPublicRoom && isTeamRoom ? draft.teamBId : "",
      opponentPlayerIds: [],
      opponentReservePlayerIds: [],
      opponentLeaderId: !isPublicRoom && isTeamRoom ? opponentLeaderId : "",
      invitePlayerIds: [],
      approvalModeA: draft.approvalModeA,
      approvalModeB: draft.approvalModeB,
      refereeWanted: draft.refereeWanted || Boolean(draft.refereeId),
      refereeId: draft.refereeId,
      targetTeamId: !isPublicRoom && isTeamRoom ? draft.teamBId || "" : "",
      region: selectedCourt.region,
      courtId: selectedCourt.id,
      court: selectedCourt.name,
      timingType: draft.timingType,
      scheduledDate: isInstantRoom ? "" : draft.scheduledDate,
      scheduledTime: isInstantRoom ? "" : draft.scheduledTime,
      mode: draft.mode,
      ranked: draft.ranked,
      official: draft.official,
      preRegistered: draft.preRegistered,
      mmrRangeMode: draft.mmrRangeMode,
      mmrLimitMode: draft.mmrLimitMode,
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
    if (typeof postId === "string" && postId) navigate(`/app/recruiting?post=${encodeURIComponent(postId)}`);
    else {
      setSubmitFeedback(formatCreateSaveError(postId, "경기 저장에 실패했습니다."));
    }
    return;
    } catch (error) {
      setSubmitFeedback(formatCreateSaveError(error, "서버 저장 중 오류가 발생했습니다."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="page-stack create-match-page" onSubmit={submit}>
      <header className="page-header">
        <div>
          <p className="eyebrow">{isRecordCreateIntent ? "RecordMatch" : "CreateMatch"}</p>
          <h1>{isRecordCreateIntent ? "기록하기" : "경기/대회 만들기"}</h1>
        </div>
      </header>

      <div className="content-grid wide-left">
        <Card className="section-card full-span">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Room visibility</p>
              <h2>{isRecordCreateIntent ? "기록 방식" : "공개 범위"}</h2>
            </div>
            <Badge tone={isTournamentRoom ? "gold" : isPublicRoom ? "green" : "neutral"}>{getRoomKindLabel(currentRoomKind)}</Badge>
          </div>
          <div className="create-mode-grid">
            {!isRecordCreateIntent ? (
              <>
                <button
                  type="button"
                  className={draft.recordType === RECORD_TYPES.match && draft.visibility === "private" ? "active" : ""}
                  onClick={() => update({ recordType: RECORD_TYPES.match, visibility: "private", mode: getMatchModeOrDefault(draft.mode, defaultMode), ranked: true, official: true, preRegistered: true })}
                >
                  <Lock size={19} />
                  <span>
                    <strong>비공개 경기방</strong>
                    <em>개인전은 생성 후 빈 슬롯에서 초대하고, 팀전은 B팀 대표를 정해 닫힌 방을 만든다.</em>
                  </span>
                </button>
                <button
                  type="button"
                  className={draft.recordType === RECORD_TYPES.match && draft.visibility === "public" ? "active" : ""}
                  onClick={() => {
                    const team = defaultTeamA ?? selectedTeamA;
                    const nextMode = getMatchModeOrDefault(draft.mode, defaultMode);
                    const hostJoinMode = nextMode === "1v1" || !canCreateTeamRoom ? "player" : draft.hostJoinMode;
                    const playerIds = hostJoinMode === "team" ? getRepresentativePlayerIds(app.currentUser.id) : [];
                    update({
                      recordType: RECORD_TYPES.match,
                      visibility: "public",
                      mode: nextMode,
                      ranked: draft.recordType === RECORD_TYPES.personalRecord ? true : draft.ranked,
                      official: draft.recordType === RECORD_TYPES.personalRecord ? true : draft.official,
                      preRegistered: draft.recordType === RECORD_TYPES.personalRecord ? true : draft.preRegistered,
                      hostJoinMode,
                      teamOnly: hostJoinMode === "team",
                      teamAId: team?.id ?? draft.teamAId,
                      playerIds,
                      reservePlayerIds: [],
                      opponentPlayerIds: [],
                      opponentReservePlayerIds: [],
                    });
                  }}
                >
                  <Globe2 size={19} />
                  <span>
                    <strong>공개 매칭방</strong>
                    <em>매칭 목록에 노출하고, 개인전은 개인 참여·팀전은 팀 대표 참여로 채운다.</em>
                  </span>
                </button>
                <button type="button" className={isTournamentRoom ? "active" : ""} onClick={() => {
                  setTeamRegion("전체");
                  update({ recordType: RECORD_TYPES.match, visibility: "tournament", mode: getMatchModeOrDefault(draft.mode, defaultMode), timingType: "scheduled", tournamentTeamIds: draft.tournamentTeamIds?.length ? draft.tournamentTeamIds : [defaultTournamentTeamA?.id, defaultTournamentTeamB?.id].filter(Boolean) });
                }}>
                  <Trophy size={19} />
                  <span>
                    <strong>비공개 대회방</strong>
                    <em>초대팀, 리그/토너먼트, 일정, MMR 룰을 한 번에 정한다.</em>
                  </span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={isMatchRecordRoom ? "active" : ""}
                  onClick={() => {
                    const team = defaultTeamA ?? selectedTeamA;
                    const opponentTeam = defaultTeamB ?? selectedTeamB;
                    const nextMode = !canCreateTeamRoom || draft.mode === "1v1"
                      ? "1v1"
                      : getMatchModeOrDefault(draft.mode, defaultMode === "1v1" ? "2v2" : defaultMode);
                    const individualRecord = nextMode === "1v1";
                    const playerIds = individualRecord ? [app.currentUser.id] : getRepresentativePlayerIds(app.currentUser.id);
                    const nextOpponentLeaderId = individualRecord && isIndividualMatchRecord
                      ? draft.opponentLeaderId
                      : individualRecord
                        ? ""
                        : getDefaultTeamPlayerIds(opponentTeam, 1, playerIds)[0] ?? "";
                    update({
                      recordType: RECORD_TYPES.matchRecord,
                      visibility: "private",
                      timingType: "scheduled",
                      hostJoinMode: individualRecord ? "player" : "team",
                      teamOnly: !individualRecord,
                      mode: nextMode,
                      ranked: false,
                      official: false,
                      preRegistered: false,
                      mmrLimitMode: "off",
                      ageRestriction: "any",
                      courtReserved: false,
                      courtFee: "",
                      stakes: "",
                      title: isMatchRecordRoom ? draft.title : "경기 기록",
                      scheduledDate: today,
                      teamAId: individualRecord ? undefined : team?.id ?? draft.teamAId,
                      teamBId: individualRecord ? undefined : opponentTeam?.id ?? draft.teamBId,
                      playerIds,
                      reservePlayerIds: [],
                      opponentPlayerIds: individualRecord ? [nextOpponentLeaderId].filter(Boolean) : [],
                      opponentReservePlayerIds: [],
                      opponentLeaderId: nextOpponentLeaderId,
                    });
                  }}
                >
                  <ClipboardList size={19} />
                  <span>
                    <strong>경기 기록</strong>
                    <em>이미 끝난 1v1 또는 팀전을 기록 확인방으로 만든다. 매칭 목록에는 보이지 않는다.</em>
                  </span>
                </button>
                <button
                  type="button"
                  className={isSoloRecord ? "active" : ""}
                  onClick={() => update({
                    recordType: RECORD_TYPES.personalRecord,
                    visibility: "private",
                    timingType: "scheduled",
                    hostJoinMode: "player",
                    teamOnly: false,
                    mode: "1v1",
                    ranked: false,
                    official: false,
                    preRegistered: false,
                    mmrLimitMode: "off",
                    title: draft.recordType === RECORD_TYPES.personalRecord ? draft.title : "개인 기록",
                    scheduledDate: today,
                    playerIds: [],
                    reservePlayerIds: [],
                    opponentPlayerIds: [],
                    opponentReservePlayerIds: [],
                    opponentLeaderId: "",
                  })}
                >
                  <ClipboardList size={19} />
                  <span>
                    <strong>내 기록</strong>
                    <em>1v1~5v5 경기에서 내 기록만 저장한다. MMR은 반영하지 않는다.</em>
                  </span>
                </button>
              </>
            )}
          </div>
        </Card>

        <Card className="section-card full-span">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">기본 설정</p>
              <h2>경기 정보와 일정</h2>
            </div>
          </div>
          <div className={`form-grid create-match-info-grid ${!isTournamentRoom && !isSoloRecord && !isMatchRecordRoom ? "is-standard-room" : ""}`}>
            <label className="create-title-field">
              제목
              <input value={draft.title} onChange={(event) => update({ title: event.target.value })} />
            </label>
            {!isTournamentRoom && !isSoloRecord && !isMatchRecordRoom ? (
              <label className="create-format-field">
                경기 형식
                <select
                  value={draft.hostJoinMode}
                  onChange={(event) => {
                    const hostJoinMode = event.target.value === "team" && !canCreateTeamRoom ? "player" : event.target.value;
                    const playerIds = hostJoinMode === "team" ? getRepresentativePlayerIds(app.currentUser.id) : [];
                    const opponentLeaderId = hostJoinMode === "team" && !isPublicRoom ? getDefaultTeamPlayerIds(selectedTeamB, 1, playerIds)[0] ?? "" : "";
                    update({
                      hostJoinMode,
                      teamOnly: hostJoinMode === "team",
                      playerIds,
                      reservePlayerIds: [],
                      opponentPlayerIds: [],
                      opponentReservePlayerIds: [],
                      opponentLeaderId,
                    });
                  }}
                >
                  <option value="team" disabled={!canCreateTeamRoom}>팀전</option>
                  <option value="player">개인전</option>
                </select>
                {!canCreateTeamRoom ? <span className="form-warning">팀이 있어야 팀전을 만들 수 있습니다.</span> : null}
              </label>
            ) : null}
            {isTournamentRoom ? (
              <label className="create-format-field">
                대회 방식
                <select value={draft.tournamentFormat} onChange={(event) => update({ tournamentFormat: event.target.value })}>
                  {tournamentFormatOptions.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.desc}</option>)}
                </select>
              </label>
            ) : null}
            {!isTournamentRoom && !isSoloRecord && !isMatchRecordRoom ? (
              <div className="field-block create-timing-field">
                <span className="field-label">시간 옵션</span>
                <div className="segmented-control compact-segments">
                  <button type="button" className={draft.timingType === "scheduled" ? "active" : ""} onClick={() => update({ timingType: "scheduled" })}>일정 지정</button>
                  <button type="button" className={draft.timingType === "instant" ? "active" : ""} onClick={() => update({ timingType: "instant" })}>즉시</button>
                </div>
                <small>{isInstantRoom ? "날짜/시간 없이 바로 경기준비방으로 만든다." : isPublicRoom ? "공개 예약방은 5일 이내, 경기 4시간 이후만 가능하다." : "비공개 예약방은 1개월 이내로 만들 수 있다."}</small>
              </div>
            ) : null}
            {!isTournamentRoom ? (
            <label className="create-capacity-field">
              인원 방식
              <select value={draft.mode} onChange={(event) => {
                const mode = event.target.value;
                if (isSoloRecord) {
                  update({ mode });
                  return;
                }
                if (isMatchRecordRoom) {
                  const individualRecord = mode === "1v1";
                  const playerIds = individualRecord ? [app.currentUser.id] : getRepresentativePlayerIds(app.currentUser.id);
                  const nextOpponentLeaderId = individualRecord && isIndividualMatchRecord
                    ? draft.opponentLeaderId
                    : individualRecord
                      ? ""
                      : getDefaultTeamPlayerIds(selectedTeamB, 1, playerIds)[0] ?? "";
                  if (individualRecord !== isIndividualMatchRecord) {
                    setMatchRecordOpponentSnapshot(null);
                    setMatchRecordOpponentQuery("");
                  }
                  update({
                    mode,
                    hostJoinMode: individualRecord ? "player" : "team",
                    teamOnly: !individualRecord,
                    title: isDefaultCreateTitle(draft.title) ? getDefaultCreateTitle(mode) : draft.title,
                    teamAId: individualRecord ? undefined : defaultTeamA?.id ?? draft.teamAId,
                    teamBId: individualRecord ? undefined : defaultTeamB?.id ?? draft.teamBId,
                    playerIds,
                    reservePlayerIds: [],
                    opponentPlayerIds: individualRecord ? [nextOpponentLeaderId].filter(Boolean) : [],
                    opponentReservePlayerIds: [],
                    opponentLeaderId: nextOpponentLeaderId,
                  });
                  return;
                }
                const hostJoinMode = mode === "1v1" || !canCreateTeamRoom ? "player" : draft.hostJoinMode;
                const nextIsTeamRoom = !isTournamentRoom && hostJoinMode === "team";
                const playerIds = nextIsTeamRoom ? getRepresentativePlayerIds(app.currentUser.id) : [];
                const opponentLeaderId = !isPublicRoom && nextIsTeamRoom ? getDefaultTeamPlayerIds(selectedTeamB, 1, playerIds)[0] ?? "" : "";
                update({
                  mode,
                  hostJoinMode,
                  teamOnly: nextIsTeamRoom,
                  title: isDefaultCreateTitle(draft.title) ? getDefaultCreateTitle(mode) : draft.title,
                  ...(nextIsTeamRoom ? {
                    playerIds,
                    reservePlayerIds: [],
                    opponentPlayerIds: [],
                    opponentReservePlayerIds: [],
                    opponentLeaderId,
                  } : {
                    playerIds: [],
                    reservePlayerIds: [],
                    opponentPlayerIds: [],
                    opponentReservePlayerIds: [],
                    opponentLeaderId: "",
                  }),
                });
              }}>
                {(isSoloRecord ? SOLO_RECORD_MODES : MATCH_MODES).map((mode) => (
                  <option key={mode.id} value={mode.id} disabled={isMatchRecordRoom && mode.id !== "1v1" && !canCreateTeamRoom}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            ) : null}
            {!isInstantRoom ? (
              <>
                <label className="create-date-field">
                  날짜
                  <input type="date" min={isSoloRecord || isMatchRecordRoom ? minSoloRecordDate : today} max={scheduleMaxDate} value={draft.scheduledDate} onChange={(event) => update({ scheduledDate: event.target.value })} />
                </label>
                <label className="create-time-field">
                  시간
                  <input type="time" value={draft.scheduledTime} onChange={(event) => update({ scheduledTime: event.target.value })} />
                </label>
              </>
            ) : null}
            {isSoloRecord ? (
              <>
                <label>
                  우리 팀명
                  <input value={draft.soloTeamAName} placeholder="우리팀" onChange={(event) => update({ soloTeamAName: event.target.value })} />
                </label>
                <label>
                  상대 팀명
                  <input value={draft.soloTeamBName} placeholder="상대팀" onChange={(event) => update({ soloTeamBName: event.target.value, soloOpponentName: event.target.value })} />
                </label>
                <label>
                  내 점수
                  <input type="number" min="0" max="999" value={draft.soloScoreFor} onFocus={() => clearZeroSoloScore("soloScoreFor")} onChange={(event) => update({ soloScoreFor: event.target.value })} />
                </label>
                <label>
                  상대 점수
                  <input type="number" min="0" max="999" value={draft.soloScoreAgainst} onFocus={() => clearZeroSoloScore("soloScoreAgainst")} onChange={(event) => update({ soloScoreAgainst: event.target.value })} />
                </label>
                <label>
                  우리팀 유저 찾기
                  <SearchPicker
                    value={soloTeamAUserQuery}
                    onChange={setSoloTeamAUserQuery}
                    placeholder="이름, #해시태그 검색"
                    items={soloRecordUserCandidates}
                    getSearchText={getSoloRecordUserSearchText}
                    remoteSearchType="player"
                    remoteLimit={10}
                    idleItems={soloRecordUserCandidates.slice(0, 5)}
                    idleTitle="최근/지역 선수"
                    title="선수 검색 결과"
                    emptyText="선수 없음"
                    showIdleOnFocus
                    floating
                    closeOnResultClick
                    renderItem={renderSoloRecordUserSearchItem("teamA")}
                  />
                </label>
                <label>
                  상대팀 유저 찾기
                  <SearchPicker
                    value={soloTeamBUserQuery}
                    onChange={setSoloTeamBUserQuery}
                    placeholder="이름, #해시태그 검색"
                    items={soloRecordUserCandidates}
                    getSearchText={getSoloRecordUserSearchText}
                    remoteSearchType="player"
                    remoteLimit={10}
                    idleItems={soloRecordUserCandidates.slice(0, 5)}
                    idleTitle="최근/지역 선수"
                    title="선수 검색 결과"
                    emptyText="선수 없음"
                    showIdleOnFocus
                    floating
                    closeOnResultClick
                    renderItem={renderSoloRecordUserSearchItem("teamB")}
                  />
                </label>
                <label className="memo-label solo-record-roster-field">
                  우리팀 선수
                  <textarea value={draft.soloTeamAPlayersText} placeholder="한 줄에 한 명. 예: 김민준 #rb001pg PG" onChange={(event) => update({ soloTeamAPlayersText: event.target.value })} />
                </label>
                <label className="memo-label solo-record-roster-field">
                  상대 선수
                  <textarea value={draft.soloTeamBPlayersText} placeholder="한 줄에 한 명. 예: 이서연 #rb002c C" onChange={(event) => update({ soloTeamBPlayersText: event.target.value })} />
                </label>
              </>
            ) : null}
            {!isTournamentRoom && !isSoloRecord && !isMatchRecordRoom ? (
              <>
                <div className="create-referee-row">
                  <label className="settings-checkbox">
                    <input
                      type="checkbox"
                      checked={draft.refereeWanted || Boolean(draft.refereeId)}
                      onChange={(event) => {
                        const refereeWanted = event.target.checked;
                        update({ refereeWanted, refereeId: refereeWanted ? draft.refereeId : "" });
                        if (!refereeWanted) setRefereeQuery("");
                      }}
                    />
                    <span>심판 있음</span>
                  </label>
                  <label className="create-referee-search">
                    심판 검색
                    <SearchPicker
                      value={refereeQuery}
                      onChange={(value) => {
                        setRefereeQuery(value);
                        update({ refereeWanted: true, refereeId: "" });
                      }}
                      placeholder="심판 이름, #해시태그, 지역 검색"
                      items={refereeSearchResults}
                      remoteSearchType="referee"
                      idleItems={favoriteReferees.length ? favoriteReferees : refereeCandidates.slice(0, 8)}
                      idleTitle={favoriteReferees.length ? "즐겨찾기 심판" : "초대 가능한 심판"}
                      title="심판 검색 결과"
                      emptyText="초대 가능한 심판 없음"
                      showIdleOnFocus
                      floating
                      closeOnResultClick
                      renderItem={renderRefereeSearchItem}
                    />
                  </label>
                </div>
                <div className="stat-integrity-note create-referee-note">
                  <span>
                    {selectedReferee
                      ? `초대할 심판: ${selectedReferee.name} · 신뢰도 ${selectedReferee.trustScore}`
                      : "심판 초대 안 함 · 심판 없으면 개인 기록은 득점 중심"}
                    {` · 신뢰도 ${REFEREE_TRUST_MIN} 이상만 초대 가능`}
                  </span>
                  {selectedReferee ? (
                    <Button type="button" variant="secondary" size="sm" onClick={clearReferee}>초대 해제</Button>
                  ) : null}
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
            <Badge tone={selectedCourt ? "green" : "orange"}>{selectedCourt?.name ?? "구장 선택 필요"}</Badge>
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
                idleTitle={favoriteCourts.length ? "즐겨찾는 구장" : "내 지역 추천 구장"}
                showIdleOnFocus
                floating
                closeOnResultClick
                remoteSearchType="court"
                getSearchText={getCourtSearchText}
                renderItem={renderCourtSearchItem}
              />
            </label>
          </div>
          <div className="create-selected-court-profile" aria-live="polite">
            <div className="create-selected-court-main">
              <span className="create-selected-court-icon"><MapPin size={20} /></span>
              <div>
                <strong>{selectedCourt?.name ?? "구장을 선택하세요"}</strong>
                <span>{selectedCourt ? getCourtAddress(selectedCourt) : "코트명·주소 검색 또는 지도에서 등록 구장을 확인할 수 있습니다."}</span>
                {selectedCourt ? (
                  <em>
                    {selectedCourt.region || "지역 미정"} · {getCourtSurfaceLabel(selectedCourt)} · {getCourtLayoutLabel(selectedCourt)} · {Number(selectedCourt.reviewCount) > 0 ? `보정 ${Number(selectedCourt.adjustedRating ?? selectedCourt.rating ?? 0).toFixed(1)} (${selectedCourt.reviewCount})` : "평가 전"}
                  </em>
                ) : null}
              </div>
            </div>
            <div className="create-selected-court-actions">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCourtMapOpen(true)}>
                <MapIcon size={16} /> 지도에서 찾기
              </Button>
              {selectedCourt?.id ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setCourtDetailCourtId(selectedCourt.id)}>
                  구장 정보
                </Button>
              ) : null}
            </div>
          </div>
          {!isSoloRecord && !isMatchRecordRoom ? (
            <div className="court-reservation-row">
              <label>
                <input type="checkbox" checked={draft.courtReserved} onChange={(event) => update({ courtReserved: event.target.checked })} />
                구장예약됨
              </label>
              {draft.courtReserved ? (
                <input value={draft.courtFee} placeholder="예약 금액/메모" onChange={(event) => update({ courtFee: event.target.value })} />
              ) : null}
            </div>
          ) : null}
          {isTournamentRoom ? (
            <div className="tournament-court-pool" aria-label="대회 사용 구장">
              <div>
                <span>대회 사용 구장</span>
                <strong>{selectedTournamentCourts.length}개</strong>
              </div>
              <div className="tournament-court-pool-list">
                {selectedTournamentCourts.map((court) => (
                  <span key={court.id}>
                    {court.name}
                    <button
                      type="button"
                      aria-label={`${court.name} 제외`}
                      disabled={selectedTournamentCourts.length <= 1}
                      onClick={() => removeTournamentCourt(court.id)}
                      title={`${court.name} 제외`}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className={!selectedCourt || courtPlayWarning ? "tier-range-note tier-range-note-warning" : "tier-range-note"}>
            <div>
              <span>구장 속성</span>
              <strong>{selectedCourt ? `${getCourtSurfaceLabel(courtSummary)} / ${getCourtLayoutLabel(courtSummary)}` : "구장 선택 필요"}</strong>
              <em>{selectedCourt ? (courtPlayWarning || "선택한 방식과 구장 형태가 충돌하지 않습니다.") : "등록된 구장을 검색 결과에서 선택하세요."}</em>
            </div>
            <Badge tone={!selectedCourt || courtPlayWarning ? "orange" : "green"}>{!selectedCourt ? "필수" : courtPlayWarning ? "경고" : "가능"}</Badge>
          </div>
        </Card>

        <CourtMapPicker
          open={courtMapOpen}
          courts={registeredCourts}
          selectedCourt={selectedCourt}
          currentRegion={currentRegion}
          onClose={() => setCourtMapOpen(false)}
          onSelect={(court) => {
            selectCourt(court);
            setCourtMapOpen(false);
          }}
        />
        <CourtDetailModal
          app={app}
          courtId={courtDetailCourtId}
          open={Boolean(courtDetailCourtId)}
          onClose={() => setCourtDetailCourtId("")}
        />

        <Card className="section-card full-span selector-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{isSoloRecord ? "Solo Record" : isMatchRecordRoom ? "Record Participants" : isTournamentRoom || isTeamRoom ? "Team Finder" : "Match Criteria"}</p>
              <h2>{isSoloRecord ? "개인 스탯" : isMatchRecordRoom ? (isIndividualMatchRecord ? "상대 선수 선택" : "기록 확인 팀") : isTournamentRoom ? "초대 팀 선택" : isTeamRoom ? (isPublicRoom ? "내 파티 선택" : "참여 팀 검색") : "개인전 매칭 기준"}</h2>
            </div>
          </div>
          {isSoloRecord ? (
            <>
              <div className="create-public-note">
                <ClipboardList size={17} />
                <span>내 점수는 PTS로 저장합니다. 아래 스탯은 기록 히스토리에만 남고 MMR에는 반영하지 않습니다.</span>
              </div>
              <div className="form-grid two">
                {PLAYER_STAT_FIELDS.filter((field) => field.id !== "points").map((field) => (
                  <label key={field.id}>
                    {field.label}
                    <input
                      type="number"
                      min="0"
                      max="999"
                      value={(draft.soloStats ?? {})[field.id] ?? 0}
                      onChange={(event) => updateSoloStat(field.id, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </>
          ) : null}
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
          {!isSoloRecord && !isMatchRecordRoom ? (
            <div className="create-eligibility-grid">
              {draft.ranked ? (
                <div className={teamTierBlocked ? "mmr-range-mode-control create-eligibility-control tier-range-note-warning" : "mmr-range-mode-control create-eligibility-control"}>
                  <div className="mmr-range-summary-row">
                    <div>
                      <span>정규전 허용구간</span>
                      <strong>{isTournamentRoom ? `${mmrRangePolicy.label} · 팀별 MMR 기준` : roomTierRange.detail}</strong>
                      <em>{isTournamentRoom ? "각 팀의 조건 충족 선수 수를 검사" : teamTierWarned ? "경고만 표시" : isTeamRoom ? `${selectedTeamA?.name ?? "A사이드"} 기준` : `${app.currentUser.name} 기준`} · {mmrRangePolicy.detail}</em>
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
              <div className={ageRestrictionBlocked ? "mmr-range-mode-control create-eligibility-control tier-range-note-warning" : "mmr-range-mode-control create-eligibility-control"}>
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
            </div>
          ) : null}
          {!isSoloRecord && !isMatchRecordRoom ? (
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
          ) : null}
          {isTournamentRoom ? (
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
                    remoteSearchType="team"
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
                    <button key={team.id} type="button" disabled={team.id === representativeTournamentTeam?.id} onClick={() => toggleTournamentTeam(team.id)}>
                      <TeamHoverCard team={team} as="span"><strong>{team.name}</strong></TeamHoverCard>
                      <em>{team.id === representativeTournamentTeam?.id ? "대표팀" : "해제"}</em>
                    </button>
                  ))}
                </div>
              </div>
              <div className="tournament-team-grid">
                {teamOptions.map((team) => {
                  const invited = (draft.tournamentTeamIds ?? []).includes(team.id);
                  const eligibility = getTournamentTeamEligibility(team);
                  return (
                    <button key={team.id} type="button" className={[invited ? "active" : "", !eligibility.allowed && !invited ? "is-disabled" : ""].filter(Boolean).join(" ")} disabled={!eligibility.allowed && !invited} onClick={() => toggleTournamentTeam(team.id)}>
                      <TeamHoverCard team={team} as="span"><strong>{team.name}</strong></TeamHoverCard>
                      <span>{team.region} · {team.homeCourt}</span>
                      <em>{team.mmr} MMR · {eligibility.allowed ? `가능 ${eligibility.eligibleCount}/${eligibility.capacity}` : eligibility.reason}</em>
                    </button>
                  );
                })}
              </div>
              <div className="create-public-note">
                <Trophy size={17} />
                <span>비공개 대회는 조건을 충족한 팀만 초대할 수 있다. 팀장 승인 후 경기와 출전 명단 구성 작업이 생성된다.</span>
              </div>
            </>
          ) : isIndividualMatchRecord ? (
            <div className="form-grid two create-match-record-opponent-grid">
              <div className="team-search-field create-opponent-team-field">
                <span className="field-label">B사이드 상대 선수</span>
                <div className="create-opponent-team-control">
                  <SearchPicker
                    value={matchRecordOpponentQuery}
                    onChange={setMatchRecordOpponentQuery}
                    placeholder="이름, #해시태그 검색"
                    items={matchRecordOpponentCandidates}
                    remoteSearchType="player"
                    idleItems={matchRecordOpponentCandidates.slice(0, 8)}
                    idleTitle="최근/지역 선수"
                    title="상대 선수 검색 결과"
                    emptyText="선수 없음"
                    showIdleOnFocus
                    floating
                    closeOnResultClick
                    renderItem={renderMatchRecordOpponentSearchItem}
                  />
                  {selectedMatchRecordOpponent ? (
                    <div className="team-search-selected create-opponent-team-selected create-record-opponent-selected">
                      <strong>{selectedMatchRecordOpponent.name}</strong>
                      <span>{getUserHashtag(selectedMatchRecordOpponent)} · {selectedMatchRecordOpponent.position ?? "포지션 자유"}</span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="stat-integrity-note create-match-record-opponent-note">
                상대 선수에게 1v1 기록 확인 요청을 보낸다. 양측 확인 전에는 공식 기록으로 확정되지 않는다.
              </div>
            </div>
          ) : isTeamRoom ? (
            <div className="form-grid two">
              <label>
                {isPublicRoom ? "내 팀" : "A사이드"}
                <select value={draft.teamAId ?? ""} onChange={(event) => selectTeamA(event.target.value)}>
                  {!(isPublicRoom ? myTeams : teamAOptions).length ? <option value="">팀 없음</option> : null}
                  {(isPublicRoom ? myTeams : teamAOptions)
                    .filter((team) => isPublicRoom || team.id !== draft.teamBId)
                    .map((team) => {
                      const eligibility = getTeamEligibility(team, team.mmr);
                      return <option key={team.id} value={team.id} disabled={!eligibility.allowed}>{team.region} · {team.name} · {team.mmr} · {eligibility.allowed ? `${eligibility.eligibleCount}/${eligibility.capacity} 가능` : "참가 불가"}</option>;
                    })}
                </select>
              </label>
              {isPublicRoom ? (
                <div className="create-public-note">
                  <Globe2 size={17} />
                  <span>공개 팀전은 팀 대표가 방을 만들고, 출전/후보 명단은 방 안에서 확정합니다.</span>
                </div>
              ) : null}
              {!isPublicRoom ? (
                <div className={`team-search-field create-opponent-team-field ${opponentTeamQuery.trim() ? "has-query" : ""}`}>
                  <span className="field-label">{isMatchRecordRoom ? "B사이드 기록 확인팀" : "B사이드"}</span>
                  <div className="create-opponent-team-control">
                    <SearchPicker
                      value={opponentTeamQuery}
                      onChange={setOpponentTeamQuery}
                      placeholder="상대 팀명 검색"
                      items={opponentTeamResults}
                      remoteSearchType="team"
                      idleItems={favoriteOpponentTeams.length ? favoriteOpponentTeams : opponentTeamResults}
                      idleTitle={favoriteOpponentTeams.length ? "즐겨찾기 팀" : "추천 B사이드"}
                      resultsClassName="create-opponent-team-results"
                      limit={10}
                      detailLimit={10}
                      showIdleOnFocus
                      floating
                      closeOnResultClick
                      renderItem={renderOpponentTeamSearchItem}
                    />
                    {selectedTeamB ? (
                      <div className="team-search-selected create-opponent-team-selected">
                        <strong>{selectedTeamB.name}</strong>
                        <span>{selectedTeamB.region} · {selectedTeamB.mmr} MMR</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {!isSoloRecord && !isMatchRecordRoom && !isTournamentRoom && !isTeamRoom ? (
            <div className="create-public-note">
              <Globe2 size={17} />
              <span>{isPublicRoom ? "개인전은 개인 참여만 받습니다. 팀전은 별도 팀전 분기로 만듭니다." : "비공개 개인전은 방을 만든 뒤 방모달의 빈 슬롯에서 선수를 초대합니다."}</span>
            </div>
          ) : null}
          {!isPublicRoom && isTeamRoom ? (
            <div className="form-grid two">
              <label>
                {isMatchRecordRoom ? "B사이드 확인 대표" : "B사이드 초대 대상"}
                <select value={opponentLeaderId} disabled={!opponentInviteTargetIds.length} onChange={(event) => update({ opponentLeaderId: event.target.value })}>
                  {opponentInviteTargetIds.map((playerId) => {
                    const user = app.state.users.find((item) => item.id === playerId);
                    return (
                      <option key={playerId} value={playerId}>
                        {user?.name ?? playerId} · {user?.position ?? "포지션 자유"}
                      </option>
                    );
                  })}
                </select>
              </label>
              <div className="stat-integrity-note">
                {isMatchRecordRoom
                  ? "상대팀 대표 1명에게 기록 확인 요청을 보낸다. 확인 대표가 B사이드 출전/후보를 고른다."
                  : "상대팀 대표 1명에게 초대장을 보낸다. 수락한 사람이 B사이드 파티장이 되고 방에서 출전/후보를 고른다."}
              </div>
            </div>
          ) : null}
          {isPublicRoom ? (
            <div className="create-public-note">
              <Globe2 size={17} />
              <span>공개방은 매칭 목록에 노출된다. 상대 사이드는 방 안의 빈 슬롯을 공개 모집한다.</span>
            </div>
          ) : null}
        </Card>

        {!isSoloRecord ? (
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">규칙</p>
                <h2>룰 설정</h2>
              </div>
            </div>
            <>
              <RuleSelector draft={draft} onChange={update} />
              {!isMatchRecordRoom ? (
                <div className="toggle-pair">
                  <label><input type="checkbox" checked={draft.ranked} onChange={(event) => update({ ranked: event.target.checked })} /> 정규전 반영</label>
                  <label><input type="checkbox" checked={draft.ranked && draft.official} disabled={!draft.ranked} onChange={(event) => update({ official: event.target.checked })} /> 공식경기</label>
                  <label><input type="checkbox" checked={draft.preRegistered} onChange={(event) => update({ preRegistered: event.target.checked })} /> 사전등록</label>
                </div>
              ) : null}
              <div className={`form-grid two create-rules-grid${isTournamentRoom ? " has-schedule-note" : ""}`}>
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
                    <option>30분</option>
                    <option>1시간</option>
                  </select>
                </label>
                {isTournamentRoom ? (
                  <label>
                    일정 메모
                    <input value={draft.tournamentScheduleNote} onChange={(event) => update({ tournamentScheduleNote: event.target.value })} />
                  </label>
                ) : null}
              </div>
            </>
          </Card>
        ) : null}

        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{isSoloRecord || isMatchRecordRoom ? "Record Note" : "계약 조건"}</p>
              <h2>{isSoloRecord || isMatchRecordRoom ? "기록 메모" : "약속과 메모"}</h2>
            </div>
          </div>
          {!isSoloRecord && !isMatchRecordRoom ? (
            <label className="memo-label">
              약속/벌칙 메모
              <textarea value={draft.stakes} onChange={(event) => update({ stakes: event.target.value })} />
            </label>
          ) : null}
          <label className="memo-label">
            경기 메모
            <textarea value={draft.memo} onChange={(event) => update({ memo: event.target.value })} />
          </label>
        </Card>
      </div>
      <div className="create-submit-row">
        {submitFeedback || submitDisabledReason ? <span className="create-submit-warning">{submitFeedback || submitDisabledReason}</span> : null}
        <Button type="submit" disabled={submitDisabled || submitting}>{isSoloRecord ? "기록 저장" : isMatchRecordRoom ? "기록방 만들기" : isTournamentRoom ? "대회 생성" : "경기 생성"}</Button>
      </div>
    </form>
  );
}
