import { DISPUTE_WINDOW_MINUTES } from "../../lib/constants.js";
import { MODE_SIZES } from "../../lib/constants.js";
import { MAX_BENCH_CAPACITY } from "../../lib/constants.js";
import { RECORD_TYPES } from "../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../lib/constants.js";
import { ROOM_SCHEDULE_MAX_DAYS } from "../../lib/constants.js";
import { SOLO_RECORD_ANONYMOUS_POSITION } from "../../lib/constants.js";
import { STAT_ENTRY_WINDOW_MINUTES } from "../../lib/constants.js";
import { getCourtId } from "../../lib/courts.js";
import { getMatchCreationPolicyPayload } from "../../lib/matchCreationPolicies.js";
import { getMatchRulesPayload } from "../../lib/matchRules.js";
import { getMatchRecordEndedAt } from "../../lib/matchUtils.js";
import { getRecordCreationWindowStatus } from "../../lib/matchUtils.js";
import { getRegisteredCourts } from "../../lib/courts.js";
import { getSeoulTimeInputValue } from "../../lib/matchUtils.js";
import { getSoloRecordLinkedRosterEntries } from "../../lib/personalRecordRoster.js";
import { getSoloRecordRosterError } from "../matchMappers.js";
import { getSoloRecordSideSize } from "../matchMappers.js";
import { isScheduleDateInAllowedWindow } from "../scheduleUtils.js";
import { makeAnonymousMatchPlayer } from "../../lib/matchUtils.js";
import { makeId } from "../rowUtils.js";
import { makeSoloRecordAnonymousSide } from "../matchMappers.js";
import { makeSoloRecordStats } from "../matchMappers.js";
import { normalizeRecruitingMmrRangeMode } from "../../lib/recruiting.js";
import { normalizeSoloRecordMode } from "../matchMappers.js";
import { toSoloRecordNumber } from "../matchMappers.js";
import { uniquePlayerIds } from "../rowUtils.js";
import { getDisciplineBlockedState, getHostTrustBlockNotification, getInvalidScheduleNotification } from "./guards.js";
import { getMatchRecordComposition, getMatchRecordDraftInvalidReason, getTrustedRefereeId } from "./lifecycle.js";
import { getServerRatingValue } from "./runtime.js";

const RECEIPT_DRAFT_PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function withSoloRecordNotification(state, title, body) {
  return {
    ...state,
    notifications: [
      { id: makeId("n"), title, body, tone: "match" },
      ...(state.notifications ?? []),
    ],
  };
}

function createSoloRecordMatch(state, draft = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "개인 기록 저장");
  if (disciplineBlock) return disciplineBlock;
  const playerId = state.currentUserId;
  const player = state.users.find((user) => user.id === playerId);
  if (!playerId || !player) return state;

  const now = new Date();
  const nowIso = now.toISOString();
  const recordDate = /^\d{4}-\d{2}-\d{2}$/.test(String(draft.scheduledDate ?? ""))
    ? String(draft.scheduledDate)
    : nowIso.slice(0, 10);
  const recordTime = /^\d{2}:\d{2}$/.test(String(draft.scheduledTime ?? ""))
    ? String(draft.scheduledTime)
    : getSeoulTimeInputValue(now);
  const recordWindow = getRecordCreationWindowStatus(recordDate, recordTime, now);
  if (!recordWindow.valid) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "개인 기록 날짜 확인",
          body: recordWindow.reason === "future"
            ? "경기가 끝난 뒤에만 개인 기록을 저장할 수 있습니다."
            : "개인 기록은 경기 종료 후 24시간 이내에만 저장할 수 있습니다.",
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }
  const scoreA = toSoloRecordNumber(draft.soloScoreFor);
  const scoreB = toSoloRecordNumber(draft.soloScoreAgainst);
  const mode = normalizeSoloRecordMode(draft.mode);
  const sideSize = getSoloRecordSideSize(mode);
  const recordEntryMode = draft.recordEntryMode === "named" ? "named" : "quick";
  const visibility = draft.visibility === "public" ? "public" : "private";
  const teamAName = String(draft.soloTeamAName ?? "").trim() || "우리팀";
  const teamBName = String(draft.soloTeamBName ?? draft.soloOpponentName ?? "").trim() || "상대팀";
  const teamARoster = recordEntryMode === "named"
    ? getSoloRecordLinkedRosterEntries(draft.soloTeamAPlayersText, draft.soloTeamAPlayerRefs, state.users)
    : { entries: [], refs: [] };
  const teamBRoster = recordEntryMode === "named"
    ? getSoloRecordLinkedRosterEntries(draft.soloTeamBPlayersText, draft.soloTeamBPlayerRefs, state.users)
    : { entries: [], refs: [] };
  const teamAEntries = teamARoster.entries;
  const teamBEntries = teamBRoster.entries;
  if (recordEntryMode === "named" && !teamBEntries.length && String(draft.soloOpponentName ?? "").trim()) {
    teamBEntries.push({ name: String(draft.soloOpponentName).trim(), position: SOLO_RECORD_ANONYMOUS_POSITION });
  }
  const rosterError = getSoloRecordRosterError(teamAEntries, teamBEntries, sideSize);
  if (rosterError) return withSoloRecordNotification(state, "개인 기록 선수 확인", rosterError);
  const teamAPlayerCount = Math.max(0, sideSize - 1);
  const teamBPlayerCount = sideSize;
  const teamAAnonymous = makeSoloRecordAnonymousSide({
    count: teamAPlayerCount,
    entries: teamAEntries,
  });
  const teamBAnonymous = makeSoloRecordAnonymousSide({
    count: teamBPlayerCount,
    entries: teamBEntries,
  });
  const anonymousPlayers = Object.fromEntries(
    [...teamAAnonymous, ...teamBAnonymous].map((entry) => [
      entry.id,
      {
        ...makeAnonymousMatchPlayer(entry.id, entry.name, entry.position),
        ...(entry.linkedProfileId ? { linkedProfileId: entry.linkedProfileId } : {}),
      },
    ]),
  );
  const playedPlayerIds = {
    teamA: uniquePlayerIds([playerId, ...teamAAnonymous.map((entry) => entry.id)]),
    teamB: teamBAnonymous.map((entry) => entry.id),
  };
  const mmrExcludedPlayerIds = uniquePlayerIds([...playedPlayerIds.teamA, ...playedPlayerIds.teamB]);
  const statSubmissions = {
    [playerId]: { by: playerId, source: "host_postgame", submittedAt: nowIso },
  };
  const result = {
    scoreA,
    scoreB,
    playerStats: {
      [playerId]: makeSoloRecordStats(draft.soloStats),
    },
    statSubmissions,
    submittedBy: playerId,
    submittedAt: nowIso,
    updatedAt: nowIso,
  };
  const selectedCourt = getRegisteredCourts(state).find((court) => court.name === draft.court || court.id === getCourtId(draft)) ?? null;
  const rules = {
    ...getMatchRulesPayload({ ...(draft.rules ?? {}), ...draft }, { mode }),
    recordType: RECORD_TYPES.personalRecord,
    recordEntryMode,
    mmrExcludedPlayerIds,
    playedPlayerIds,
    visibility,
    region: selectedCourt?.region ?? draft.region,
    ratingScale: 0,
    ...(RECEIPT_DRAFT_PUBLIC_ID_PATTERN.test(String(draft.receiptDraftPublicId ?? "").trim())
      ? { receiptDraftPublicId: String(draft.receiptDraftPublicId).trim() }
      : {}),
    recordSummary: {
      mode,
      recordEntryMode,
      teamAName,
      teamBName,
      teamAPlayers: [player.name || "나", ...teamAAnonymous.map((entry) => entry.name)],
      teamBPlayers: teamBAnonymous.map((entry) => entry.name),
      teamAPlayerRefs: teamAAnonymous.flatMap((entry) => (
        entry.linkedProfileId
          ? [{
              slotId: entry.id,
              linkedProfileId: entry.linkedProfileId,
              name: entry.name,
              position: entry.position,
            }]
          : []
      )),
      teamBPlayerRefs: teamBAnonymous.flatMap((entry) => (
        entry.linkedProfileId
          ? [{
              slotId: entry.id,
              linkedProfileId: entry.linkedProfileId,
              name: entry.name,
              position: entry.position,
            }]
          : []
      )),
    },
  };
  const match = {
    id: draft.id || makeId("m"),
    title: String(draft.title ?? "").trim() || "개인 기록",
    mode,
    courtId: selectedCourt?.id ?? getCourtId(draft),
    court: draft.court || "미정",
    scheduledDate: recordDate,
    scheduledTime: recordTime,
    scheduledAt: `${recordDate} ${recordTime}`,
    timingType: "scheduled",
    visibility,
    status: "confirmed",
    ranked: false,
    official: false,
    preRegistered: false,
    refereeId: "",
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: DISPUTE_WINDOW_MINUTES,
    rules,
    memo: draft.memo || "혼자 저장한 개인 기록입니다.",
    stakes: draft.stakes || "MMR 미반영",
    mmrLimitMode: "off",
    mmrRangeMode: "wide",
    ratingScale: 0,
    objectionWindow: "없음",
    evidence: [],
    teamA: { name: teamAName, teamId: "", players: [playerId], score: scoreA },
    teamB: { name: teamBName, teamId: "", players: [], score: scoreB },
    agreements: { teamA: [playerId], teamB: [] },
    approvals: { teamA: [playerId], teamB: [] },
    disputes: [],
    playedPlayerIds,
    reservePlayers: { teamA: [], teamB: [] },
    anonymousPlayers,
    mmrExcludedPlayerIds,
    result,
    ratingResult: [],
    teamRatingResult: { teamA: 0, teamB: 0, teams: {} },
    createdBy: playerId,
    agreedAt: nowIso,
    startedAt: nowIso,
    endedAt: nowIso,
    confirmedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    ...state,
    matches: [match, ...state.matches],
    notifications: [
      { id: makeId("n"), title: "개인 기록 저장", body: `${match.title} 기록이 저장됐습니다. MMR은 반영하지 않습니다.`, tone: "match", matchId: match.id },
      ...state.notifications,
    ],
  };
}

export function createMatch(state, draft) {
  if (draft?.recordType === RECORD_TYPES.personalRecord) return createSoloRecordMatch(state, draft);
  const isMatchRecord = draft?.recordType === RECORD_TYPES.matchRecord;
  if (!isMatchRecord) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "경기 생성 불가", body: "일반 방은 모집/초대방 생성 경로로만 만듭니다.", tone: "orange" },
        ...state.notifications,
      ],
    };
  }
  const disciplineBlock = getDisciplineBlockedState(state, "경기방 생성");
  if (disciplineBlock) return disciplineBlock;
  const effectiveDraft = isMatchRecord
    ? {
        ...draft,
        visibility: "private",
        ranked: false,
        official: false,
        preRegistered: false,
        mmrLimitMode: "off",
        ageRestriction: "any",
        allowedAgeGroups: [],
        courtReserved: false,
        courtFee: "",
        refereeWanted: false,
        refereeId: "",
        stakes: "",
      }
    : draft;
  const hostTrustBlock = getHostTrustBlockNotification(state, effectiveDraft);
  if (hostTrustBlock) return { ...state, notifications: [hostTrustBlock, ...state.notifications] };
  const mode = effectiveDraft.mode ?? "5v5";
  const size = MODE_SIZES[mode] ?? 5;
  const timingType = effectiveDraft.timingType === "instant" ? "instant" : "scheduled";
  const scheduledAt = timingType === "instant" ? "즉시" : `${effectiveDraft.scheduledDate ?? ""} ${effectiveDraft.scheduledTime ?? ""}`.trim();
  const recordDate = String(effectiveDraft.scheduledDate ?? "");
  const recordTime = /^\d{2}:\d{2}$/.test(String(effectiveDraft.scheduledTime ?? ""))
    ? String(effectiveDraft.scheduledTime)
    : "";
  const recordWindow = getRecordCreationWindowStatus(recordDate, recordTime, new Date());
  if (!recordWindow.valid) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "경기 기록 시간 확인",
          body: recordWindow.reason === "future"
            ? "경기가 끝난 뒤에만 경기 기록을 만들 수 있습니다."
            : "경기 기록은 경기 종료 후 24시간 이내에만 만들 수 있습니다.",
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }
  if (!isMatchRecord && timingType !== "instant" && !isScheduleDateInAllowedWindow(effectiveDraft.scheduledDate, new Date(), ROOM_SCHEDULE_MAX_DAYS)) {
    return { ...state, notifications: [getInvalidScheduleNotification(ROOM_SCHEDULE_MAX_DAYS), ...state.notifications] };
  }
  const nowIso = new Date().toISOString();
  const recordStartedAt = isMatchRecord ? new Date(recordWindow.occurredAtMs).toISOString() : null;
  const recordEndedAt = isMatchRecord ? getMatchRecordEndedAt(recordStartedAt)?.toISOString() : null;
  const matchRecordInvalidReason = isMatchRecord ? getMatchRecordDraftInvalidReason(state, effectiveDraft, mode) : "";
  if (matchRecordInvalidReason) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "경기 기록 생성 불가", body: matchRecordInvalidReason, tone: "orange" },
        ...state.notifications,
      ],
    };
  }
  const evidence = (effectiveDraft.evidence ?? []).map((item) => ({ id: item.id, label: item.label }));
  const teamAPlayers = [state.currentUserId].filter(Boolean);
  const teamBPlayers = [];
  const refereeId = getTrustedRefereeId(state, effectiveDraft.refereeId, [...teamAPlayers, ...teamBPlayers]);
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(effectiveDraft.mmrRangeMode);
  const ranked = isMatchRecord ? false : effectiveDraft.ranked !== false;
  const ratingScale = isMatchRecord
    ? getServerRatingValue("getPostgameRecordMmrScale", { mode })
    : ranked ? getServerRatingValue("getRecruitingRatingScale", { ranked, mmrRangeMode }) : 0;
  const disputeMinutes = DISPUTE_WINDOW_MINUTES;
  const selectedCourt = getRegisteredCourts(state).find((court) => court.name === effectiveDraft.court || court.id === getCourtId(effectiveDraft)) ?? null;
  const creator = state.users.find((user) => user.id === state.currentUserId);
  const recordComposition = getMatchRecordComposition(effectiveDraft);
  const recordBenchCapacity = recordComposition === "team" ? MAX_BENCH_CAPACITY : 0;
  const creationPolicy = getMatchCreationPolicyPayload(effectiveDraft);
  const match = {
    id: effectiveDraft.id || makeId("m"),
    title: effectiveDraft.title || `${effectiveDraft.court} ${mode} 판`,
    mode,
    courtId: selectedCourt?.id ?? "",
    court: selectedCourt?.name ?? (String(effectiveDraft.court ?? "").trim() || "미정"),
    scheduledDate: timingType === "instant" ? "" : effectiveDraft.scheduledDate,
    scheduledTime: timingType === "instant" ? "" : effectiveDraft.scheduledTime,
    scheduledAt: scheduledAt || "일정 미정",
    timingType,
    matchIntent: creationPolicy.matchIntent,
    matchPurpose: creationPolicy.matchPurpose,
    formationMode: creationPolicy.formationMode,
    visibility: "private",
    status: "agreed",
    ranked,
    official: ranked && Boolean(effectiveDraft.official),
    preRegistered: isMatchRecord ? false : Boolean(draft.preRegistered),
    refereeId,
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes,
    rules: {
      ...getMatchRulesPayload({ ...(effectiveDraft.rules ?? {}), ...effectiveDraft }, { mode }),
      recordType: RECORD_TYPES.matchRecord,
      recordComposition,
      recordSetupReady: false,
      recordApprovalMode: {
        teamA: recordComposition === "team" ? "captain" : "all",
        teamB: recordComposition === "team" ? "captain" : "all",
      },
      recordApproverIds: { teamA: [], teamB: [] },
      participantAcceptedIds: [],
      rosterReady: { teamA: false, teamB: false },
      sideCapacity: size,
      onCourtCount: size,
      starterCount: size,
      teamCapacity: size + recordBenchCapacity,
      benchCapacity: recordBenchCapacity,
      waitlistCapacity: 0,
      mmrRangeMode: "off",
      ratingScale,
      ageRestriction: "any",
      allowedAgeGroups: [],
      courtReserved: false,
      visibility: "private",
      region: selectedCourt?.region ?? effectiveDraft.region,
      recordDurationMinutes: 30,
    },
    memo: effectiveDraft.memo || (isMatchRecord ? "경기 종료 후 기록 입력 대기." : "결과 승인 대기."),
    stakes: isMatchRecord ? "" : effectiveDraft.stakes || "다음 경기 우선권.",
    mmrLimitMode: isMatchRecord ? "off" : effectiveDraft.mmrLimitMode ?? "block",
    mmrRangeMode,
    ratingScale,
    objectionWindow: `${disputeMinutes}분`,
    evidence,
    teamA: { name: creator?.name ?? "A사이드", teamId: "", players: teamAPlayers, score: 0 },
    teamB: { name: "B사이드", teamId: "", players: teamBPlayers, score: 0 },
    agreements: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    createdBy: state.currentUserId,
    agreedAt: nowIso,
    startedAt: recordStartedAt ?? undefined,
    endedAt: recordEndedAt ?? undefined,
    createdAt: nowIso,
  };
  return {
    ...state,
    matches: [match, ...state.matches],
    notifications: [
      { id: makeId("n"), title: "경기 기록", body: `${match.title} 빈 경기 기록이 만들어졌습니다. ${recordComposition === "team" ? "두 팀" : "A/B 선수"}을 구성해 주세요.`, tone: "match", matchId: match.id },
      ...state.notifications,
    ],
  };
}
