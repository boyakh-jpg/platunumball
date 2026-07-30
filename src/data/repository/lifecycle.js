import { MATCH_SIDES } from "../../lib/constants.js";
import { MODE_SIZES } from "../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../lib/constants.js";
import { STAT_ENTRY_WINDOW_MINUTES } from "../../lib/constants.js";
import { adjustUserTrust } from "../trustUtils.js";
import { buildLeaguePairings } from "../tournamentMappers.js";
import { buildTournamentPairings } from "../tournamentMappers.js";
import { fillMatchDecision } from "../../lib/matchUtils.js";
import { getAcceptedTournamentRefereeIds } from "../../lib/tournamentGovernance.js";
import { getCourtId } from "../../lib/courts.js";
import { getPostgameRecordVerification } from "../../lib/postgameRecordVerification.js";
import { getPublicRoomTimingStatus } from "../../lib/matchUtils.js";
import { getRecruitingApplicantKey } from "../../lib/recruiting.js";
import { getRecruitingLobby } from "../../lib/recruiting.js";
import { getRecruitingRoomOwnerId } from "../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../lib/recruiting.js";
import { getScheduledStartMs } from "../matchLifecycleUtils.js";
import { getSelectableTeamPlayerIds } from "../../lib/recruiting.js";
import { getStatSubmissionStatus } from "../../lib/matchUtils.js";
import { getTeamCaptainId } from "../../lib/matchUtils.js";
import { getTeamEventEligibility } from "../../lib/recruiting.js";
import { isAutoDecisionDue } from "../../lib/matchUtils.js";
import { isEligibleReferee } from "../../lib/matchUtils.js";
import { isMatchRecordMatch } from "../../lib/matchUtils.js";
import { isPracticeEntity } from "../../lib/practiceMode.js";
import { isRecruitingPartyEntry } from "../../lib/recruiting.js";
import { isSupportedMatchMode } from "../../lib/constants.js";
import { isTournamentRefereeNeutral } from "../../lib/tournamentGovernance.js";
import { makeId } from "../rowUtils.js";
import { normalizeDisputeWindowMinutes } from "../../lib/constants.js";
import { normalizeRecruitingApplicants } from "../../lib/recruiting.js";
import { normalizeRecruitingPost } from "../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../lib/recruiting.js";
import { uniquePlayerIds } from "../rowUtils.js";
import { getServerRatingValue } from "./runtime.js";

function getMatchRecordComposition(draft = {}) {
  return draft.recordComposition === "team" ? "team" : "individual";
}

function getMatchRecordDraftInvalidReason(state, draft = {}, mode = "") {
  if (draft.visibility && draft.visibility !== "private") return "경기 기록은 비공개로만 만들 수 있습니다.";
  if (!isSupportedMatchMode(mode)) return "지원하지 않는 경기 인원입니다.";
  const requestedComposition = draft.recordComposition ?? getMatchRecordComposition(draft);
  if (!["individual", "team"].includes(requestedComposition)) return "경기 기록 구성 방식을 확인해 주세요.";
  if (!state.currentUserId || !state.users.some((user) => user.id === state.currentUserId && !user.anonymous)) return "경기 기록 생성자를 확인할 수 없습니다.";
  return "";
}

function getTrustedRefereeId(state, refereeId, playerIds = []) {
  if (!refereeId || playerIds.includes(refereeId)) return "";
  const user = state.users.find((item) => item.id === refereeId);
  return isEligibleReferee(user, REFEREE_TRUST_MIN, state.settings?.refereeAppointments) ? refereeId : "";
}

function getLocalTournamentMatchRefereeId(state, tournament, teamAId, teamBId) {
  const assignmentCounts = new Map();
  (state.matches ?? []).forEach((match) => {
    if (match.tournamentId === tournament.id && match.refereeId) {
      assignmentCounts.set(match.refereeId, (assignmentCounts.get(match.refereeId) ?? 0) + 1);
    }
  });
  return getAcceptedTournamentRefereeIds(tournament)
    .filter((refereeId) => isEligibleReferee(
      state.users.find((user) => user.id === refereeId),
      REFEREE_TRUST_MIN,
      state.settings?.refereeAppointments,
      tournament.endDate,
    ))
    .filter((refereeId) => isTournamentRefereeNeutral(tournament, refereeId, teamAId, teamBId, state.teams))
    .sort((left, right) => (
      (assignmentCounts.get(left) ?? 0) - (assignmentCounts.get(right) ?? 0)
      || String(left).localeCompare(String(right))
    ))[0] ?? "";
}

function makeTournamentMatch(state, tournament, teamA, teamB, pairing, now, matchId = "") {
  const mode = tournament.mode || "5v5";
  const size = MODE_SIZES[mode] ?? 5;
  const disputeMinutes = normalizeDisputeWindowMinutes(tournament.rules?.disputeMinutes ?? tournament.disputeMinutes);
  const roundLabel = tournament.format === "tournament" ? `${pairing.round}R-${pairing.fixture}` : `L-${pairing.fixture}`;
  const teamAPlayers = [];
  const teamBPlayers = [];

  return {
    id: matchId || makeId("m"),
    title: `${roundLabel} · ${teamA.name} vs ${teamB.name}`,
    mode,
    courtId: tournament.courtId ?? getCourtId(tournament),
    court: tournament.court || "미정",
    scheduledDate: "",
    scheduledTime: "",
    scheduledAt: "일정 미정",
    visibility: tournament.visibility ?? "private",
    status: "agreed",
    ranked: tournament.ranked !== false,
    official: Boolean(tournament.official),
    preRegistered: true,
    refereeId: getLocalTournamentMatchRefereeId(state, tournament, teamA.id, teamB.id),
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes,
    tournamentId: tournament.id,
    tournamentFormat: tournament.format,
    tournamentRound: pairing.round,
    tournamentFixture: pairing.fixture,
    tournamentBracketMatch: pairing.bracketMatch ?? pairing.fixture,
    tournamentMmrPolicy: tournament.mmrPolicy,
    rules: {
      ...(tournament.rules ?? {}),
      sideCapacity: size,
      visibility: tournament.visibility ?? "private",
      rosterReady: { teamA: false, teamB: false },
      rosterReadyAt: {},
      tournamentOrganizerId: tournament.createdBy,
      tournamentSideAssignmentLocked: false,
      tournamentHostRosterSelected: false,
    },
    memo: tournament.memo || "대회 경기입니다.",
    stakes: "대회 경기 MMR 가중치가 적용됩니다.",
    mmrLimitMode: tournament.mmrLimitMode ?? "warn",
    objectionWindow: `${disputeMinutes}분`,
    evidence: [],
    teamA: { name: teamA.name, teamId: teamA.id, players: teamAPlayers, score: 0 },
    teamB: { name: teamB.name, teamId: teamB.id, players: teamBPlayers, score: 0 },
    agreements: { teamA: teamAPlayers, teamB: teamBPlayers },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    createdBy: tournament.createdBy,
    agreedAt: now,
    createdAt: now,
  };
}

function generateTournamentMatches(state, tournament, options = {}) {
  if (tournament.matchIds?.length) return { matches: [], tournament };

  const teamById = Object.fromEntries(state.teams.map((team) => [team.id, team]));
  const now = new Date().toISOString();
  const pairSource = tournament.format === "tournament"
    ? buildTournamentPairings(tournament.teamIds ?? [])
    : { seedOrder: tournament.teamIds ?? [], pairings: buildLeaguePairings(tournament.teamIds ?? []), byes: [] };
  const preferredMatchIds = Array.isArray(options.preferredMatchIds) ? options.preferredMatchIds : [];
  const matches = [];
  pairSource.pairings.forEach((pairing, index) => {
    const teamA = teamById[pairing.teamAId];
    const teamB = teamById[pairing.teamBId];
    if (!teamA || !teamB) return;
    const match = makeTournamentMatch(
      { ...state, matches: [...(state.matches ?? []), ...matches] },
      tournament,
      teamA,
      teamB,
      pairing,
      now,
      preferredMatchIds[index],
    );
    matches.push(match);
  });
  const matchIds = matches.map((match) => match.id);
  const fixtureRows = matches.map((match) => ({
    matchId: match.id,
    round: match.tournamentRound,
    fixture: match.tournamentFixture,
    bracketMatch: match.tournamentBracketMatch ?? match.tournamentFixture,
    teamAId: match.teamA.teamId,
    teamBId: match.teamB.teamId,
  }));
  const bracket = tournament.format === "tournament"
    ? {
        format: "tournament",
        generatedAt: now,
        seedOrder: pairSource.seedOrder,
        bracketSize: pairSource.bracketSize,
        slots: pairSource.slots,
        firstRound: pairSource.firstRound,
        rounds: [{ id: "round-1", name: "1라운드", pairings: fixtureRows, byes: pairSource.byes }],
      }
    : {
        format: "league",
        generatedAt: now,
        fixtures: fixtureRows,
      };

  return {
    matches,
    tournament: {
      ...tournament,
      status: "active",
      startedAt: now,
      matchIds,
      bracket,
    },
  };
}

function getStateRepresentativeTeamId(state, userId) {
  const user = state.users.find((item) => item.id === userId);
  const explicitTeamId = userId === state.currentUserId
    ? state.settings?.representativeTeamId ?? user?.representativeTeamId ?? ""
    : user?.representativeTeamId ?? "";
  const memberTeams = state.teams
    .filter((team) => team.members?.some((member) => member.userId === userId))
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || String(a.id).localeCompare(String(b.id)));
  return memberTeams.some((team) => team.id === explicitTeamId) ? explicitTeamId : memberTeams[0]?.id ?? "";
}

function getLocalTournamentTeamSnapshot(state, team, options = {}) {
  const eligibility = getTeamEventEligibility(team, state.users, options);
  const representativeMemberIds = getSelectableTeamPlayerIds(team)
    .filter((playerId) => getStateRepresentativeTeamId(state, playerId) === team.id);
  const representativeMemberSet = new Set(representativeMemberIds);
  const eligiblePlayerIds = eligibility.eligiblePlayerIds.filter((playerId) => representativeMemberSet.has(playerId));
  const captainId = getTeamCaptainId(state.teams, team.id);
  const capacity = Math.max(1, Math.min(5, Number(options.capacity) || 1));
  return {
    teamId: team.id,
    captainId,
    captainRepresentative: Boolean(captainId && getStateRepresentativeTeamId(state, captainId) === team.id),
    representativeMemberIds,
    eligiblePlayerIds,
    eligibleCount: eligiblePlayerIds.length,
    capacity,
    allowed: Boolean(captainId && getStateRepresentativeTeamId(state, captainId) === team.id && eligiblePlayerIds.length >= capacity),
  };
}

function getTournamentMatchWinnerTeamId(match = {}) {
  if (!match || match.status !== "confirmed") return "";
  const scoreA = Number(match.result?.scoreA ?? match.teamA?.score ?? 0);
  const scoreB = Number(match.result?.scoreB ?? match.teamB?.score ?? 0);
  if (scoreA === scoreB) return "";
  return scoreA > scoreB ? match.teamA?.teamId ?? "" : match.teamB?.teamId ?? "";
}

function findTournamentRoundMatch(matches = [], tournamentId = "", round = 1, fixture = 1) {
  return matches.find((match) => (
    match.tournamentId === tournamentId &&
    Number(match.tournamentRound ?? 0) === Number(round) &&
    Number(match.tournamentFixture ?? 0) === Number(fixture)
  )) ?? null;
}

function getTournamentNodeWinnerTeamId(state, tournament, round, fixture) {
  const bracket = tournament.bracket ?? {};
  if (round === 1) {
    const row = (bracket.firstRound ?? [])[fixture - 1];
    if (row?.byeTeamId) return row.byeTeamId;
  }
  return getTournamentMatchWinnerTeamId(findTournamentRoundMatch(state.matches, tournament.id, round, fixture));
}

function advanceTournamentAfterMatch(state, confirmedMatch) {
  if (!confirmedMatch?.tournamentId || confirmedMatch.tournamentFormat !== "tournament") return state;
  const tournament = (state.tournaments ?? []).find((item) => item.id === confirmedMatch.tournamentId);
  if (!tournament || tournament.format !== "tournament" || tournament.status !== "active") return state;
  const winnerTeamId = getTournamentMatchWinnerTeamId(confirmedMatch);
  if (!winnerTeamId) return state;

  const bracket = tournament.bracket ?? {};
  const bracketSize = Number(bracket.bracketSize ?? 0);
  const totalRounds = Math.max(1, Math.ceil(Math.log2(Math.max(bracketSize, 2))));
  const currentRound = Number(confirmedMatch.tournamentRound ?? 1);
  const currentFixture = Number(confirmedMatch.tournamentFixture ?? 1);
  const now = new Date().toISOString();

  if (currentRound >= totalRounds) {
    const closedTournament = {
      ...tournament,
      status: "closed",
      bracket: {
        ...bracket,
        championTeamId: winnerTeamId,
        completedAt: now,
      },
    };
    return {
      ...state,
      tournaments: (state.tournaments ?? []).map((item) => (item.id === tournament.id ? closedTournament : item)),
      notifications: [
        {
          id: makeId("n"),
          title: "대회 종료",
          body: `${tournament.title} 우승팀이 확정됐습니다.`,
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }

  const nextRound = currentRound + 1;
  const nextFixture = Math.ceil(currentFixture / 2);
  const sourceFixtureA = (nextFixture - 1) * 2 + 1;
  const sourceFixtureB = sourceFixtureA + 1;
  const teamAId = getTournamentNodeWinnerTeamId(state, tournament, currentRound, sourceFixtureA);
  const teamBId = getTournamentNodeWinnerTeamId(state, tournament, currentRound, sourceFixtureB);
  if (!teamAId || !teamBId) return state;
  if (findTournamentRoundMatch(state.matches, tournament.id, nextRound, nextFixture)) return state;

  const teamById = Object.fromEntries(state.teams.map((team) => [team.id, team]));
  const teamA = teamById[teamAId];
  const teamB = teamById[teamBId];
  if (!teamA || !teamB) return state;

  const nextMatch = makeTournamentMatch(state, tournament, teamA, teamB, {
    round: nextRound,
    fixture: nextFixture,
    bracketMatch: nextFixture,
  }, now);
  const nextRoundIndex = nextRound - 1;
  const rounds = [...(bracket.rounds ?? [])];
  const currentRoundEntry = rounds[nextRoundIndex] ?? {
    id: `round-${nextRound}`,
    name: `${nextRound}라운드`,
    pairings: [],
    byes: [],
  };
  const nextPairing = {
    matchId: nextMatch.id,
    round: nextRound,
    fixture: nextFixture,
    bracketMatch: nextFixture,
    sourceRound: currentRound,
    sourceFixtures: [sourceFixtureA, sourceFixtureB],
    teamAId,
    teamBId,
  };
  rounds[nextRoundIndex] = {
    ...currentRoundEntry,
    pairings: [
      ...(currentRoundEntry.pairings ?? []).filter((pairing) => Number(pairing.fixture) !== nextFixture),
      nextPairing,
    ].sort((a, b) => Number(a.fixture ?? 0) - Number(b.fixture ?? 0)),
  };
  const nextTournament = {
    ...tournament,
    matchIds: [...new Set([...(tournament.matchIds ?? []), nextMatch.id])],
    bracket: {
      ...bracket,
      rounds,
      updatedAt: now,
    },
  };

  return {
    ...state,
    matches: [nextMatch, ...state.matches],
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournament.id ? nextTournament : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "후속 라운드 생성",
        body: `${tournament.title} ${nextRound}라운드 ${nextFixture}경기가 생성됐습니다.`,
        tone: "match",
        matchId: nextMatch.id,
      },
      ...state.notifications,
    ],
  };
}

function updateAffiliationScores(state) {
  const users = state.users;
  return state.affiliations.filter((affiliation) => affiliation.type !== "club").map((affiliation) => {
    const members = users.filter((user) => {
      if (affiliation.type === "region") return user.region === affiliation.name;
      if (affiliation.type === "school") return user.school === affiliation.name;
      if (affiliation.type === "company") return user.company === affiliation.name;
      if (affiliation.type === "organization") return user.affiliationId === affiliation.id;
      return false;
    });
    if (!members.length) return affiliation;
    const average = members.reduce((sum, user) => sum + user.ratings.integrated, 0) / members.length;
    return { ...affiliation, memberCount: members.length, score: Math.round(average + affiliation.wins * 2 - affiliation.losses) };
  });
}

function finalizeMatch(state, targetMatch) {
  if (isPracticeEntity(targetMatch)) {
    const confirmedMatch = {
      ...targetMatch,
      status: "confirmed",
      ratingResult: [],
      teamRatingResult: null,
      confirmedAt: new Date().toISOString(),
    };
    return {
      ...state,
      matches: state.matches.map((match) => (match.id === targetMatch.id ? confirmedMatch : match)),
    };
  }
  const ratingResult = getServerRatingValue("calculateFinalizationRating", state, targetMatch) ?? {
    users: state.users,
    teams: state.teams,
    changes: [],
    teamRatingResult: null,
  };
  const users = ratingResult.users;
  const teams = ratingResult.teams;

  const confirmedMatch = {
    ...targetMatch,
    status: "confirmed",
    ratingResult: ratingResult.changes,
    teamRatingResult: ratingResult.teamRatingResult,
    confirmedAt: new Date().toISOString(),
  };
  const nextState = {
    ...state,
    users,
    teams,
    matches: state.matches.map((match) => (match.id === targetMatch.id ? confirmedMatch : match)),
    notifications: [
      {
        id: makeId("n"),
        title: "경기 확정",
        body: ratingResult.changes.length || ratingResult.teamRatingResult
          ? `${targetMatch.title} 결과가 티어와 랭킹에 반영됐습니다.`
          : `${targetMatch.title} 결과가 공식 기록으로 확정됐습니다.`,
        tone: ratingResult.changes.length || ratingResult.teamRatingResult ? "tier" : "match",
        matchId: targetMatch.id,
      },
      ...state.notifications,
    ],
  };

  const advancedState = advanceTournamentAfterMatch(nextState, confirmedMatch);
  return { ...advancedState, affiliations: updateAffiliationScores(advancedState) };
}

function applyAutomaticMatchDecisions(state, now = new Date()) {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  let nextState = state;

  for (const match of state.matches ?? []) {
    const current = nextState.matches.find((item) => item.id === match.id);
    if (!current) continue;

    if (isMatchRecordMatch(current) && ["agreed", "approval", "disputed"].includes(current.status) && current.result) {
      const verification = getPostgameRecordVerification(current, { now });
      if (!verification.expired) continue;
      const hasOpenReport = (nextState.reports ?? []).some((report) => (
        report.type === "match"
        && report.targetId === current.id
        && !["resolved", "dismissed"].includes(report.status)
      ));
      const hasOpenDispute = (current.disputes ?? []).some((dispute) => dispute.status === "open");
      if (!verification.canAutoFinalize || hasOpenReport || hasOpenDispute) {
        const verificationStatus = hasOpenReport || hasOpenDispute ? "review" : "insufficient";
        const nextMatch = {
          ...current,
          rules: {
            ...(current.rules ?? {}),
            matchRecordVerificationStatus: verificationStatus,
            matchRecordConfirmationClosedAt: current.rules?.matchRecordConfirmationClosedAt ?? nowIso,
          },
          updatedAt: nowIso,
        };
        nextState = {
          ...nextState,
          matches: nextState.matches.map((item) => item.id === current.id ? nextMatch : item),
        };
        continue;
      }
      const nextMatch = {
        ...current,
        ranked: true,
        mmrExcludedPlayerIds: verification.unconfirmedIds,
        rules: {
          ...(current.rules ?? {}),
          ratingScale: getServerRatingValue("getPostgameRecordMmrScale", current),
          mmrExcludedPlayerIds: verification.unconfirmedIds,
          teamRatingDisabled: true,
          matchRecordVerificationStatus: "confirmed",
          matchRecordAutoFinalizedAt: nowIso,
        },
        autoConfirmedAt: current.autoConfirmedAt ?? nowIso,
      };
      nextState = finalizeMatch(
        {
          ...nextState,
          matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        },
        nextMatch,
      );
      continue;
    }

    if (current.status === "approval" && current.result) {
      const submittedAtMs = new Date(current.result.submittedAt ?? "").getTime();
      const disputeMinutes = normalizeDisputeWindowMinutes(current.disputeMinutes);
      if (!Number.isFinite(submittedAtMs) || nowMs < submittedAtMs + disputeMinutes * 60 * 1000) continue;
      if ((current.disputes ?? []).some((dispute) => dispute.status === "open")) continue;
      const resultValid = [current.result.scoreA, current.result.scoreB]
        .every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 999);
      const statStatus = getStatSubmissionStatus(current);
      if (!resultValid || (current.refereeId && !statStatus.complete)) continue;
      const result = current.disputeDraftResult ?? current.result;
      const nextMatch = {
        ...current,
        result,
        teamA: { ...current.teamA, score: result.scoreA },
        teamB: { ...current.teamB, score: result.scoreB },
        disputeDraftResult: undefined,
        disputeDraftUpdatedAt: undefined,
        autoConfirmedAt: current.autoConfirmedAt ?? nowIso,
        rules: {
          ...(current.rules ?? {}),
          autoFinalizationAudit: {
            actor: "system",
            finalizedAt: nowIso,
            policy: "dispute_window_elapsed",
          },
        },
      };
      nextState = finalizeMatch(
        {
          ...nextState,
          matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        },
        nextMatch,
      );
      continue;
    }

    if (!isAutoDecisionDue(current, nowMs)) continue;

    if (current.status === "contract") {
      const nextMatch = {
        ...current,
        status: "agreed",
        agreements: fillMatchDecision(current, "agreements"),
        agreedAt: current.agreedAt ?? nowIso,
        autoAgreedAt: current.autoAgreedAt ?? nowIso,
      };
      nextState = {
        ...nextState,
        matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        notifications: [
          {
            id: makeId("n"),
            title: "동의 자동 처리",
            body: `${current.title} 동의가 24시간 안에 처리되지 않아 자동 동의 처리됐습니다.`,
            tone: "match",
            matchId: current.id,
          },
          ...nextState.notifications,
        ],
      };
      continue;
    }

  }

  return nextState;
}

function applyExpiredRecruitingRooms(state, now = new Date()) {
  const expiredRows = (state.recruitingPosts ?? []).map((post) => {
    if (post.status !== "open") return false;
    const lobby = getRecruitingLobby(post, state);
    const timing = getPublicRoomTimingStatus(post, now);
    if (timing.expired) return { post, lobby, penalizeHost: lobby.projectedFull };
    const deadlineMs = getScheduledStartMs(post);
    if (!Number.isFinite(deadlineMs) || now.getTime() <= deadlineMs || lobby.projectedFull) return false;
    return { post, lobby, penalizeHost: false };
  }).filter(Boolean);
  if (!expiredRows.length) return state;

  const expiredPosts = expiredRows.map((row) => row.post);
  const expiredIds = new Set(expiredPosts.map((post) => post.id));
  const penalizedHostIds = expiredRows.filter((row) => row.penalizeHost).map((row) => getRecruitingRoomOwnerId(row.post) || row.post.playerId);
  const nowIso = now.toISOString();

  return {
    ...state,
    users: penalizedHostIds.reduce((users, userId) => adjustUserTrust(users, userId, -4), state.users),
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => {
      if (!expiredIds.has(post.id)) return post;
      const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
      return {
        ...post,
        status: "cancelled",
        cancelledAt: post.cancelledAt ?? nowIso,
        roomState: {
          ...roomState,
          invitations: roomState.invitations.map((invitation) => (
            invitation.status === "pending" ? { ...invitation, status: "expired", updatedAt: nowIso } : invitation
          )),
        },
      };
    }),
    notifications: [
      ...expiredPosts.map((post) => ({
        id: makeId("n"),
        title: "매칭방 자동 취소",
        body: `${post.title} 인원이 제한시간 안에 차지 않아 취소됐습니다.`,
        tone: "orange",
        recruitingPostId: post.id,
      })),
      ...state.notifications,
    ],
  };
}

function applyAutomaticRecruitingConfirmations(state) {
  return state;
}

function repairRecruitingSameTeamPersonalParties(state) {
  let changed = false;
  const recruitingPosts = (state.recruitingPosts ?? []).map((post) => {
    if (!post || post.status !== "open" || post.visibility !== "public") return post;
    let postChanged = false;
    const normalizedPost = normalizeRecruitingPost(post);
    let applicants = normalizeRecruitingApplicants(normalizedPost.applicants ?? []);
    const lobby = getRecruitingLobby({ ...normalizedPost, applicants }, state);
    const roomState = normalizeRecruitingRoomState(normalizedPost.roomState ?? {});
    const capacity = getRecruitingSideCapacity(normalizedPost);
    const partyTargetsBySide = MATCH_SIDES.reduce((acc, sideName) => {
      acc[sideName] = (lobby.sides?.[sideName]?.entries ?? [])
        .filter((entry) => isRecruitingPartyEntry(entry) && entry.team?.id)
        .map((entry) => ({
          entryId: entry.id,
          teamId: entry.team.id,
          fixed: Boolean(entry.fixed),
          memberIds: new Set((entry.team.members ?? []).map((member) => member.userId)),
          playerIds: uniquePlayerIds(entry.players ?? []),
        }));
      return acc;
    }, {});
    const nextPartyReserves = { ...(roomState.partyReserves ?? {}) };

    applicants.forEach((applicant) => {
      if (
        applicant.kind !== "player" ||
        applicant.status !== "ready" ||
        !applicant.playerId ||
        applicant.sourceTeamId ||
        applicant.sourceEntryId
      ) return;

      const targets = (partyTargetsBySide[applicant.side] ?? [])
        .filter((target) => target.memberIds.has(applicant.playerId));
      if (targets.length !== 1) return;

      const target = targets[0];
      const applicantKey = getRecruitingApplicantKey(applicant);
      if (applicant.reserve) {
        const reserveIds = uniquePlayerIds([...(nextPartyReserves[target.entryId] ?? []), applicant.playerId]);
        nextPartyReserves[target.entryId] = reserveIds;
      } else if (target.fixed) {
        const currentPlayerIds = uniquePlayerIds(normalizedPost.playerIds ?? []);
        const nextPlayerIds = uniquePlayerIds([...currentPlayerIds, applicant.playerId]).slice(0, capacity);
        if (!nextPlayerIds.includes(applicant.playerId)) return;
        normalizedPost.playerIds = nextPlayerIds;
        target.playerIds = nextPlayerIds;
      } else {
        let absorbed = false;
        applicants = applicants.map((item) => {
          if (getRecruitingApplicantKey(item) !== target.entryId) return item;
          const currentPlayerIds = uniquePlayerIds(item.playerIds ?? []);
          const nextPlayerIds = uniquePlayerIds([...currentPlayerIds, applicant.playerId]).slice(0, capacity);
          if (!nextPlayerIds.includes(applicant.playerId)) return item;
          target.playerIds = nextPlayerIds;
          absorbed = true;
          return {
            ...item,
            playerId: nextPlayerIds.includes(item.playerId) ? item.playerId : nextPlayerIds[0],
            playerIds: nextPlayerIds,
          };
        });
        if (!absorbed) return;
      }

      applicants = applicants.filter((item) => getRecruitingApplicantKey(item) !== applicantKey);
      postChanged = true;
      changed = true;
    });

    return postChanged
      ? {
          ...post,
          hostJoinMode: normalizedPost.hostJoinMode,
          teamId: normalizedPost.teamId,
          playerIds: normalizedPost.playerIds,
          roomState: { ...roomState, partyReserves: nextPartyReserves },
          applicants,
        }
      : post;
  });

  return changed ? { ...state, recruitingPosts } : state;
}

export function runAutomaticStateMaintenance(state, now = new Date()) {
  return repairRecruitingSameTeamPersonalParties(applyAutomaticRecruitingConfirmations(applyExpiredRecruitingRooms(applyAutomaticMatchDecisions(state, now), now)));
}

export {
  advanceTournamentAfterMatch,
  applyAutomaticRecruitingConfirmations,
  finalizeMatch,
  generateTournamentMatches,
  getLocalTournamentTeamSnapshot,
  getMatchRecordComposition,
  getMatchRecordDraftInvalidReason,
  getStateRepresentativeTeamId,
  getTrustedRefereeId,
};
