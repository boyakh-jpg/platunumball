import {
  DEFAULT_RATING,
  MATCH_MODES,
  PLAYER_STAT_FIELDS,
  isSameRegion,
} from "./constants.js";
import { AGE_GROUPS } from "./profileSetup.js";
import {
  MMR_RANGE_POLICIES,
  getSelectableTeamPlayerIds,
  getTeamEventEligibility,
} from "./recruiting.js";

export const mmrLimitOptions = [
  { id: "off", label: "제한 없음" },
  { id: "warn", label: "경고만" },
  { id: "block", label: "생성 차단" },
];

export const tournamentFormatOptions = [
  { id: "league", label: "리그", desc: "모든 팀이 일정 수만큼 경기" },
  { id: "tournament", label: "토너먼트", desc: "패배 시 탈락, 대진표 중심" },
];

export const tournamentMmrPolicyOptions = [
  { id: "gap_adjusted", label: "격차 보정" },
  { id: "standard", label: "일반 MMR" },
  { id: "event_only", label: "대회 점수만" },
];

export const tournamentScheduleOptions = [
  { id: "weekly", label: "주 1회 배정" },
  { id: "daily", label: "매일 배정" },
  { id: "manual", label: "직접 조율" },
];

export const MATCH_MODE_IDS = new Set(MATCH_MODES.map((mode) => mode.id));

export const makeEmptySoloStats = () => (
  Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field.id, 0]))
);

export const ageRestrictionOptions = [
  { id: "any", label: "연령 무관", desc: "모든 연령 참여", allowedGroups: AGE_GROUPS.map((group) => group.id) },
  { id: "junior", label: "Junior", desc: "Junior 전용", allowedGroups: ["junior"] },
  { id: "rising", label: "Rising", desc: "Rising 전용", allowedGroups: ["rising"] },
  { id: "open", label: "Open", desc: "Open 전용", allowedGroups: ["open"] },
  { id: "junior_rising", label: "Junior ~ Rising", desc: "Junior / Rising 참여", allowedGroups: ["junior", "rising"] },
  { id: "rising_open", label: "Rising ~ Open", desc: "Rising / Open 참여", allowedGroups: ["rising", "open"] },
];

export function getAgeRestrictionOption(ageRestriction) {
  return ageRestrictionOptions.find((option) => option.id === ageRestriction) ?? ageRestrictionOptions[0];
}

export function getTeamChallengeEligibilityPolicy({
  teamA,
  teamB,
  users = [],
  capacity,
  currentUserId = "",
  ranked = true,
}) {
  if (!teamA?.id || !teamB?.id || teamA.id === teamB.id || Number(capacity) < 2) return null;
  const targetMmr = Number(teamA.mmr ?? DEFAULT_RATING);
  const mmrOptions = ranked
    ? [...Object.keys(MMR_RANGE_POLICIES).map((mmrRangeMode, index) => ({ mmrRangeMode, mmrLimitMode: "block", cost: index })), { mmrRangeMode: "wide", mmrLimitMode: "off", cost: 3 }]
    : [{ mmrRangeMode: "narrow", mmrLimitMode: "off", cost: 0 }];
  const candidates = [];
  for (const mmrOption of mmrOptions) {
    for (const ageOption of ageRestrictionOptions) {
      const options = {
        capacity,
        ranked,
        ...mmrOption,
        targetMmr,
        allowedAgeGroups: ageOption.allowedGroups,
      };
      const teamAEligibility = getTeamEventEligibility(teamA, users, { ...options, requireCaptainEligible: false });
      const teamBEligibility = getTeamEventEligibility(teamB, users, { ...options, requireCaptainEligible: true });
      if (!teamAEligibility.allowed || !teamBEligibility.allowed || !teamAEligibility.eligiblePlayerIds.includes(currentUserId)) continue;
      candidates.push({
        ...mmrOption,
        mmrCost: mmrOption.cost,
        ageRestriction: ageOption.id,
        teamAEligibility,
        teamBEligibility,
        cost: mmrOption.cost + ageOption.allowedGroups.length - 1,
      });
    }
  }
  return candidates.sort((a, b) => a.cost - b.cost || a.mmrCost - b.mmrCost || getAgeRestrictionOption(a.ageRestriction).allowedGroups.length - getAgeRestrictionOption(b.ageRestriction).allowedGroups.length)[0] ?? null;
}

function getAgeRestrictionFromGroups(groupIds = []) {
  const order = AGE_GROUPS.map((group) => group.id);
  const groups = order.filter((groupId) => groupIds.includes(groupId));
  if (!groups.length || groups.length === order.length) return "any";
  return groups.join("_");
}

export function toggleAgeRestriction(ageRestriction, groupId) {
  const currentOption = getAgeRestrictionOption(ageRestriction);
  const currentGroups = [...currentOption.allowedGroups];
  const nextSet = new Set(currentGroups);
  if (nextSet.has(groupId)) {
    if (nextSet.size > 1) nextSet.delete(groupId);
  } else {
    nextSet.add(groupId);
  }
  if (nextSet.has("junior") && nextSet.has("open")) nextSet.add("rising");
  return getAgeRestrictionFromGroups([...nextSet]);
}

export function includesQuery(value, query) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function getActionErrorCode(result) {
  if (!result || typeof result !== "object" || result.ok !== false) return "";
  return String(result.error || result.message || "server_action_failed");
}

export function getDefaultCreateTitle(mode = "5v5", matchIntent = "standard_competitive") {
  if (matchIntent === "pickup") return `오늘의 ${mode} 픽업`;
  if (matchIntent === "friendly") return `오늘의 ${mode} 친선전`;
  return `오늘의 ${mode} 경쟁전`;
}

export function getDefaultTournamentTitle(format = "league") {
  return format === "tournament" ? "새 토너먼트" : "새 리그";
}

export function isDefaultCreateTitle(title = "") {
  return /^오늘의\s+(1v1|2v2|3v3|4v4|5v5)\s+(공식전|친선전|경쟁전|픽업)$/i.test(String(title).trim());
}

export function isDefaultTournamentTitle(title = "") {
  return ["새 리그", "새 토너먼트"].includes(String(title).trim());
}

export function getMatchModeOrDefault(mode = "", fallback = "5v5") {
  return MATCH_MODE_IDS.has(String(mode)) ? String(mode) : fallback;
}

export function formatCreateSaveError(result, fallback) {
  const errorCode = getActionErrorCode(result);
  if (!errorCode) return fallback;
  const lowerCode = errorCode.toLowerCase();
  let reason = "";
  if (errorCode === "local_reducer_blocked") {
    reason = "입력한 내용을 확인한 뒤 다시 시도해 주세요.";
  } else if (lowerCode.includes("rankball_recruiting_action") || lowerCode.includes("rankball_match_action") || lowerCode.includes("could not find the function")) {
    reason = "최신 기능이 아직 반영되지 않았습니다. 잠시 후 다시 시도해 주세요.";
  } else if (errorCode === "recruiting_sync_permission_denied" || errorCode === "match_sync_permission_denied") {
    reason = "현재 계정에 이 방/경기를 저장할 권한이 없습니다.";
  } else if (errorCode === "recruiting_team_roster_not_member" || errorCode === "match_team_roster_not_member" || errorCode === "team_roster_not_member") {
    reason = "선택한 팀 명단에 방장 또는 참가 선수가 없습니다. 팀원을 먼저 등록해 주세요.";
  } else if (errorCode === "recruiting_player_not_found" || errorCode === "match_player_not_found") {
    reason = "선택한 참가 선수의 프로필을 찾지 못했습니다.";
  } else if (errorCode === "referee_not_eligible") {
    reason = "선택한 심판이 활성 심판 조건을 통과하지 못했습니다.";
  } else if (errorCode === "team_roster_not_member") {
    reason = "선택한 출전 선수 또는 후보 선수가 해당 팀 명단에 없습니다.";
  } else if (errorCode === "profile_not_found" || errorCode === "missing_actor_profile_id") {
    reason = "로그인 계정과 연결된 프로필을 찾지 못했습니다.";
  } else if (errorCode === "missing_bearer_token" || errorCode === "invalid_bearer_token") {
    reason = "로그인이 만료되었습니다. 다시 로그인해 주세요.";
  } else if (errorCode === "server_action_missing_access_token") {
    reason = "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.";
  } else if (errorCode === "server_actions_disabled") {
    reason = "현재 저장 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  } else if (errorCode === "age_group_not_allowed") {
    reason = "선택한 연령 제한과 참가자 연령대가 맞지 않습니다.";
  } else if (errorCode === "invalid_schedule_window") {
    reason = "일정이 생성 가능한 기간 밖입니다.";
  } else if (errorCode === "match_regulation_duration_exceeded") {
    reason = "정규 경기시간은 총 63분 이하로 입력해 주세요.";
  } else if (errorCode === "room_remake_source_not_found") {
    reason = "원본 취소방을 찾지 못했습니다. 일정의 취소된 방에서 다시 시도해 주세요.";
  } else if (errorCode === "room_remake_owner_required") {
    reason = "원본 방장만 같은 설정으로 다시 만들 수 있습니다.";
  } else if (errorCode === "room_remake_source_not_terminal" || errorCode === "room_remake_source_mismatch") {
    reason = "취소되거나 만료된 원본 방에서만 다시 만들 수 있습니다.";
  } else if (errorCode === "recruiting_core_locked" || errorCode === "match_roster_locked" || errorCode === "match_referee_locked") {
    reason = "이미 확정된 방 또는 경기 정보는 변경할 수 없습니다.";
  } else if (errorCode === "team_eligible_roster_insufficient") {
    reason = "연령·MMR 조건을 충족한 팀원이 경기 인원보다 적습니다.";
  } else if (errorCode === "team_roster_player_ineligible") {
    reason = "선택 명단에 연령·MMR 조건을 충족하지 않는 선수가 있습니다.";
  } else if (errorCode === "team_captain_required" || errorCode === "tournament_team_captain_required") {
    reason = "팀장만 팀전 초대·참가를 확정할 수 있습니다.";
  } else if (["tournament_representative_team_required", "tournament_creator_representative_team_required", "tournament_team_representative_required"].includes(errorCode)) {
    reason = "대회에는 대표팀으로만 참가할 수 있습니다. 팀 메뉴에서 대표팀을 확인해 주세요.";
  } else if (errorCode === "tournament_representative_roster_insufficient") {
    reason = "대표팀 기준으로 고정된 참가 가능 선수가 경기 인원보다 적습니다.";
  } else if (errorCode === "tournament_team_snapshot_missing") {
    reason = "대회 생성 시점의 대표팀 명단을 찾지 못했습니다.";
  } else if (errorCode === "supabase_admin_not_configured") {
    reason = "현재 저장 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  } else {
    reason = fallback || "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return reason;
}

export function isHashtagQuery(query = "") {
  return query.trim().startsWith("#");
}

export function getAvailableTeamPlayerIds(team, excludedIds = []) {
  const excluded = new Set(excludedIds);
  return getSelectableTeamPlayerIds(team).filter((playerId) => !excluded.has(playerId));
}

export function getOpponentTeam(teams, teamId, region, excludedIds = [], capacity = 1) {
  const canUseTeam = (team) => (
    team.id !== teamId
    && getAvailableTeamPlayerIds(team, excludedIds).length >= capacity
  );
  return teams.find((team) => canUseTeam(team) && isSameRegion(team.region, region))
    ?? teams.find(canUseTeam)
    ?? teams.find((team) => team.id !== teamId);
}

export function getMmrSpread(teams) {
  const mmrs = teams.map((team) => Number(team.mmr ?? DEFAULT_RATING));
  return mmrs.length ? Math.max(...mmrs) - Math.min(...mmrs) : 0;
}

export function getRepresentativePlayerIds(userId = "") {
  return userId ? [userId] : [];
}

export function getDefaultCreateMode(team) {
  const availableCount = team ? getSelectableTeamPlayerIds(team).length : 0;
  if (availableCount >= 5) return "5v5";
  if (availableCount >= 3) return "3v3";
  if (availableCount >= 2) return "2v2";
  return "1v1";
}

export function getDefaultMmrLimitMode(_teamA, _teamB, ranked = true) {
  return ranked ? "block" : "off";
}

export function getCreateStepFromSearch(search = "", steps = []) {
  const firstStep = steps[0]?.id ?? 1;
  const lastStep = steps.at(-1)?.id ?? firstStep;
  const step = Number(new URLSearchParams(search).get("step"));
  if (step === 6) return lastStep;
  return steps.some((item) => item.id === step) ? step : firstStep;
}

export function getCreateStepSearch(search = "", step = 1) {
  const params = new URLSearchParams(search);
  if (step > 1) params.set("step", String(step));
  else params.delete("step");
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
}

export const DEFAULT_MATCH_MEMO = "룰 확정 후 결과 승인.";
const DEFAULT_MATCH_RECORD_MEMO = "경기 참가자와 결과를 확인합니다.";

export function getMatchRecordMemo(value = "") {
  return !String(value).trim() || value === DEFAULT_MATCH_MEMO ? DEFAULT_MATCH_RECORD_MEMO : value;
}
