import { useMemo, useState } from "react";
import { CalendarDays, ClipboardCheck, Handshake, ShieldAlert, Swords, Trophy, UserPlus } from "lucide-react";
import { DEFAULT_RATING, HOME_RIVAL_TEAM_LIMIT } from "../lib/constants.js";
import { getRegisteredCourts } from "../lib/courts.js";
import { addDateDays, canUserResolveMatchDispute, getActualMatchPlayerSideName, getAllowedStatFields, getLocalDateInputValue, getMatchRecordWindow, getMatchRoomPhase, getMatchSideResult, getMatchSideScore as getSideScore, getMatchUserParticipantSideName, getOpenMatchDisputes, getPlayerRecentRecordMatches, getPlayerStatSubmitted, getPublicRoomTimingStatus, getRoomScheduleLabel, getSafeMatchSide as getSafeMatchSideBase, getTournamentMatchDisplayTitle, isInstantRoom, isMatchRelatedToUser, isPersonalRecordMatch, isSeedSampleMatch, isTournamentMatchInUserSchedule, userNeedsMatchAction, userNeedsMatchAgreement, userNeedsMatchApproval } from "../lib/matchUtils.js";
import { getPendingRecruitingInvitations, getRecruitingInvitationSenderName, getRecruitingLobby, getRecruitingRoomOwnerId } from "../lib/recruiting.js";
import { getPlacementLabel, isPlacementComplete } from "../lib/rating.js";
import { useRoomModalNavigation } from "../lib/roomModalNavigation.js";
import { getCurrentSeason, getPlayerSeasonRows, getSeasonProgress } from "../lib/season.js";
import { getTierDivision } from "../lib/tier.js";
import { compareNotificationsNewestFirst, dedupeNotifications, getNotificationHref, isHomeActionNotification, isNotificationDisplayable, isNotificationTargetUnavailable, isNotificationVisibleToUser } from "../lib/notifications.js";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { MatchRoomModal } from "./Matches.jsx";
import { RecruitingRoomModal } from "./Recruiting.jsx";
import { useHomeSearchModel } from "./useHomeSearchModel.jsx";
import HomePageView from "./HomePageView.jsx";

function getScheduleDate(item = {}) {
  if (item.scheduledDate) return String(item.scheduledDate).slice(0, 10);
  const scheduledText = String(item.scheduledAt ?? "");
  const scheduledDate = scheduledText.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (scheduledDate) return scheduledDate;
  const createdText = String(item.createdAt ?? "");
  return createdText.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function isInstantScheduleItem(item = {}) {
  const scheduledAt = String(item?.scheduledAt ?? "").trim().toLowerCase();
  return isInstantRoom(item) || scheduledAt === "instant" || scheduledAt === "\uC989\uC2DC";
}

function isHomeUpcomingScheduleItem(item = {}, todayValue, maxScheduleDate) {
  if (isInstantScheduleItem(item)) return false;
  const itemDate = getScheduleDate(item);
  return Boolean(itemDate && itemDate >= todayValue && itemDate <= maxScheduleDate);
}

function isHomeActionableMatchSchedule(match = {}, todayValue = "") {
  const phase = getMatchRoomPhase(match).phase;
  if (["postgame", "dispute"].includes(phase)) return true;
  if (isInstantScheduleItem(match)) return !getPublicRoomTimingStatus(match).expired;
  const matchDate = getScheduleDate(match);
  return !matchDate || matchDate >= todayValue;
}

function isHomeUserMatch(match = {}, userId = "") {
  if (isSeedSampleMatch(match)) return false;
  if (match.tournamentId) return isTournamentMatchInUserSchedule(match, userId);
  return isMatchRelatedToUser(match, userId);
}

function isActionableTournamentInvite(tournament = {}, blockedUserIds = [], todayValue = "") {
  if (tournament.status !== "draft" || blockedUserIds.includes(tournament.createdBy)) return false;
  const endDate = String(tournament.endDate ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  return !endDate || endDate >= todayValue;
}

function compareSchedule(a, b) {
  const aKey = `${getScheduleDate(a) || "9999-12-31"} ${a.scheduledTime ?? ""} ${a.scheduledAt ?? ""}`;
  const bKey = `${getScheduleDate(b) || "9999-12-31"} ${b.scheduledTime ?? ""} ${b.scheduledAt ?? ""}`;
  return aKey.localeCompare(bKey);
}

function getUserResult(match, userId) {
  const sideName = getActualMatchPlayerSideName(match, userId) ?? getMatchUserParticipantSideName(match, userId) ?? "teamA";
  return getMatchSideResult(match, sideName);
}

function getPlayerRatingSummary(user = {}) {
  if (!user.ratings) return user.trustScore ?? "-";
  if (!isPlacementComplete(user.ratings)) return getPlacementLabel(user.ratings);
  const mmr = Number(user.ratings?.integrated ?? DEFAULT_RATING);
  return `${getTierDivision(mmr)} · ${Math.round(mmr)} MMR`;
}

function userNeedsResultInput(match, userId) {
  if (!["agreed", "approval", "disputed"].includes(match.status) || !isMatchRelatedToUser(match, userId)) return false;
  if (getPlayerStatSubmitted(match, userId)) return false;
  const recordWindow = getMatchRecordWindow(match);
  if (!recordWindow.statOpen) return false;
  const playerIds = [...(match.teamA?.players ?? []), ...(match.teamB?.players ?? [])];
  return playerIds.some((playerId) => getAllowedStatFields(match, userId, playerId).length > 0);
}

function userOperatesCheckin(match, userId) {
  return match.refereeId ? match.refereeId === userId : match.createdBy === userId;
}

function getHomeRecruitingMeta(post = {}) {
  return `${getRoomScheduleLabel(post)} · ${post.court || "구장 미정"}`;
}

function getHomeMatchMeta(match = {}) {
  const prefix = isPersonalRecordMatch(match) ? "개인 기록 · " : "";
  return `${prefix}${getRoomScheduleLabel(match)} · ${match.court || "구장 미정"}`;
}

const getSafeMatchSide = (match = {}, sideName = "teamA") => getSafeMatchSideBase(match, sideName, { includeScore: true });

function getUserMatchLine(match, userId) {
  const sideName = getActualMatchPlayerSideName(match, userId) ?? getMatchUserParticipantSideName(match, userId) ?? "teamA";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  return {
    side: getSafeMatchSide(match, sideName),
    opponent: getSafeMatchSide(match, otherSide),
    score: getSideScore(match, sideName),
    opponentScore: getSideScore(match, otherSide),
    result: getUserResult(match, userId),
  };
}

const SEARCH_PREVIEW_LIMIT = 5;
const SEARCH_DETAIL_LIMIT = 20;

export default function Home({ app }) {
  const user = app.currentUser;
  const [query, setQuery] = useState("");
  const [processingInviteId, setProcessingInviteId] = useState("");
  const {
    selectedMatchId,
    setSelectedMatchId,
    selectedRecruitingPostId,
    setSelectedRecruitingPostId,
    openMatchRoom,
    openRecruitingRoom,
  } = useRoomModalNavigation({
    loadRecruitingPost: app.actions.loadRecruitingPost,
  });
  const searchText = query.trim().toLowerCase();
  const completedMatches = [...app.state.matches].filter((match) => match.status === "confirmed");
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const homeOwnTeamIds = app.state.homeSummary?.ownTeamIds;
  const myTeams = useMemo(() => app.state.teams
    .filter((team) => (
      Array.isArray(homeOwnTeamIds)
        ? homeOwnTeamIds.includes(team.id)
        : team.members.some((member) => member.userId === user.id)
    ))
    .map((team) => ({ ...team, myRole: team.members.find((member) => member.userId === user.id)?.role ?? "regular" }))
    .sort((a, b) => Number(b.myRole === "captain") - Number(a.myRole === "captain") || b.mmr - a.mmr), [app.state.teams, homeOwnTeamIds, user.id]);
  const captainTeamIds = useMemo(() => myTeams.filter((team) => team.myRole === "captain").map((team) => team.id), [myTeams]);
  const myTeamIds = useMemo(() => myTeams.map((team) => team.id), [myTeams]);
  const todayValue = getLocalDateInputValue();
  const maxScheduleDate = addDateDays(todayValue, 365);
  const upcomingItems = useMemo(() => {
    const matchItems = [...app.state.matches]
      .filter((match) => ["locked", "checkin"].includes(getMatchRoomPhase(match).phase))
      .filter((match) => isHomeUserMatch(match, user.id) && !userNeedsMatchAction(match, user.id))
      .filter((match) => isHomeUpcomingScheduleItem(match, todayValue, maxScheduleDate))
      .map((match) => ({ type: "match", id: `match-${match.id}`, item: match }));
    return matchItems.sort((a, b) => compareSchedule(a.item, b.item));
  }, [app.state.matches, maxScheduleDate, todayValue, user.id]);
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
  const selectedRecruitingPost = (app.state.recruitingPosts ?? []).find((post) => post.id === selectedRecruitingPostId) ?? null;
  useBodyScrollLock(Boolean(selectedRecruitingPost));
  const pendingInvitations = useMemo(() => getPendingRecruitingInvitations(app.state, user.id)
    .filter(({ invitation }) => !blockedUserIds.includes(invitation.fromUserId)), [app.state, blockedUserIds, user.id]);
  const pendingTeamInvitations = useMemo(() => (app.state.teamInvitations ?? []).filter((invitation) => (
    invitation.targetUserId === user.id &&
    invitation.status === "pending" &&
    !blockedUserIds.includes(invitation.fromUserId)
  )), [app.state.teamInvitations, blockedUserIds, user.id]);
  const myTeamCount = myTeams.length;
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const favoritePlayerIds = app.state.settings?.favoritePlayerIds ?? [];
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const favoriteCourtIds = app.state.settings?.favoriteCourtIds ?? [];
  const favoriteRefereeIds = app.state.settings?.favoriteRefereeIds ?? [];
  const season = getCurrentSeason(app.state);
  const seasonProgress = getSeasonProgress(season);
  const regionalPlayerIds = app.state.homeSummary?.regionalPlayerIds;
  const hasRegionalPlayerSnapshot = Array.isArray(regionalPlayerIds);
  const seasonRows = hasRegionalPlayerSnapshot
    ? regionalPlayerIds
      .map((playerId) => app.state.users.find((item) => item.id === playerId))
      .filter(Boolean)
      .filter((item) => isPlacementComplete(item.ratings))
      .map((item) => ({ ...item, seasonScore: item.ratings.integrated }))
    : getPlayerSeasonRows(app.state.users, app.state.matches, season, user.region)
      .filter((item) => isPlacementComplete(item.ratings));
  const snapshotRegionalRank = Number(app.state.homeSummary?.regionalRank);
  const mySeasonIndex = isPlacementComplete(user.ratings) && Number.isInteger(snapshotRegionalRank) && snapshotRegionalRank > 0
    ? snapshotRegionalRank - 1
    : seasonRows.findIndex((row) => row.id === user.id);
  const mySeasonRow = getPlayerSeasonRows([user], app.state.matches, season, user.region)[0] ?? null;
  const localRivals = useMemo(() => {
    const rivalTeamIds = app.state.homeSummary?.rivalTeamIds;
    const regionTeams = Array.isArray(rivalTeamIds)
      ? rivalTeamIds.map((teamId) => teamById[teamId]).filter(Boolean)
      : app.state.teams
        .filter((team) => team.region === user.region)
        .sort((a, b) => b.mmr - a.mmr)
        .filter((team) => !myTeamIds.includes(team.id))
        .slice(0, HOME_RIVAL_TEAM_LIMIT);
    const referenceMmr = myTeams[0]?.mmr ?? regionTeams[0]?.mmr ?? user.ratings.integrated;
    return regionTeams
      .map((team) => ({ ...team, gap: team.mmr - referenceMmr }));
  }, [app.state.homeSummary?.rivalTeamIds, app.state.teams, myTeamIds, myTeams, teamById, user.ratings.integrated, user.region]);
  const acceptHomeRecruitingInvitation = async (postId, invitationId) => {
    const key = `${postId}:${invitationId}`;
    setProcessingInviteId(key);
    try {
      const result = await app.actions.acceptRecruitingInvitation(postId, invitationId);
      if (result && result.ok !== false) {
        setSelectedMatchId("");
        setSelectedRecruitingPostId(postId);
      }
    } finally {
      setProcessingInviteId("");
    }
  };
  const openActionRoom = (event, item = {}) => {
    if (isNotificationTargetUnavailable(item, app.state)) return;
    if (item.matchId) {
      event.preventDefault();
      openMatchRoom(item.matchId);
    } else if (item.recruitingPostId) {
      event.preventDefault();
      openRecruitingRoom(item.recruitingPostId);
    }
  };
  const declineHomeRecruitingInvitation = async (postId, invitationId) => {
    const key = `${postId}:${invitationId}`;
    setProcessingInviteId(key);
    try {
      await app.actions.declineRecruitingInvitation(postId, invitationId);
    } finally {
      setProcessingInviteId("");
    }
  };
  const myCompletedMatches = getPlayerRecentRecordMatches(completedMatches, user.id)
    .filter((match) => !isPersonalRecordMatch(match));
  const actionItems = useMemo(() => {
    const tournamentInviteItems = (app.state.tournaments ?? [])
      .filter((tournament) => isActionableTournamentInvite(tournament, blockedUserIds, todayValue))
      .flatMap((tournament) => captainTeamIds
        .filter((teamId) => (tournament.teamIds ?? []).includes(teamId))
        .filter((teamId) => (tournament.teamStatuses?.[teamId] ?? "invited") === "invited")
        .map((teamId) => ({
          id: `tournament-${tournament.id}-${teamId}`,
          tournamentId: tournament.id,
          priority: 0,
          label: "대회 초대",
          title: tournament.title,
          meta: `${teamById[teamId]?.name ?? "내 팀"} · ${tournament.format === "tournament" ? "토너먼트" : "리그"} 승인 필요`,
          href: `/app/tournaments/${tournament.id}`,
          icon: Trophy,
        })));
    const loadedTournamentInviteIds = new Set(tournamentInviteItems.map((item) => item.tournamentId).filter(Boolean));
    const tournamentNotificationItems = (app.state.notifications ?? [])
      .filter((notification) => isNotificationVisibleToUser(notification, user.id, { blockedUserIds }))
      .filter((notification) => ["tournament_invite", "tournament_referee_invite", "tournament_region_review"].includes(notification.type) && isHomeActionNotification(notification))
      .filter((notification) => !loadedTournamentInviteIds.has(notification.tournamentId))
      .filter((notification) => {
        const tournament = (app.state.tournaments ?? []).find((item) => item.id === notification.tournamentId);
        return !tournament || isActionableTournamentInvite(tournament, blockedUserIds, todayValue);
      })
      .map((notification) => ({
        id: `notification-${notification.id}`,
        priority: 0,
        label: notification.type === "tournament_referee_invite"
          ? "대회 심판 초대"
          : notification.type === "tournament_region_review" ? "대회 지역 승인" : "대회 초대",
        title: notification.title,
        meta: notification.body || "승인 필요",
        href: getNotificationHref(notification),
        icon: Trophy,
      }));
    const tournamentScheduleItems = (app.state.notifications ?? [])
      .filter((notification) => isNotificationVisibleToUser(notification, user.id, { blockedUserIds }))
      .filter((notification) => notification.type === "tournament_match_schedule" && isHomeActionNotification(notification))
      .map((notification) => ({
        id: `notification-${notification.id}`,
        matchId: notification.matchId,
        recruitingPostId: notification.recruitingPostId,
        priority: 1,
        label: "명단 구성",
        title: notification.title,
        meta: notification.body || "출전·후보 명단 구성 필요",
        href: getNotificationHref(notification),
        icon: ClipboardCheck,
      }));
    const matchItems = app.state.matches
      .filter((match) => isHomeUserMatch(match, user.id))
      .filter((match) => isHomeActionableMatchSchedule(match, todayValue))
      .map((match) => {
        const phase = getMatchRoomPhase(match).phase;
        if (userNeedsMatchAgreement(match, user.id)) {
          return {
            id: `agreement-${match.id}`,
            matchId: match.id,
            priority: 1,
            label: "동의",
            title: getTournamentMatchDisplayTitle(match, match.title),
            meta: getHomeMatchMeta(match),
            href: `/app/matches?match=${match.id}`,
            icon: Handshake,
          };
        }
        if (phase === "checkin" && userOperatesCheckin(match, user.id)) {
          return {
            id: `checkin-${match.id}`,
            matchId: match.id,
            priority: 2,
            label: "경기 시작",
            title: getTournamentMatchDisplayTitle(match, match.title),
            meta: getHomeMatchMeta(match),
            href: `/app/matches?match=${match.id}`,
            icon: Swords,
          };
        }
        if (phase === "postgame" && userNeedsResultInput(match, user.id)) {
          return {
            id: `result-${match.id}`,
            matchId: match.id,
            priority: 3,
            label: "결과 입력",
            title: getTournamentMatchDisplayTitle(match, match.title),
            meta: getHomeMatchMeta(match),
            href: `/app/matches?match=${match.id}`,
            icon: CalendarDays,
          };
        }
        if (phase === "dispute" && (userNeedsMatchApproval(match, user.id) || canUserResolveMatchDispute(match, user.id))) {
          const openDisputeCount = getOpenMatchDisputes(match).length;
          return {
            id: `approval-${match.id}`,
            matchId: match.id,
            priority: 4,
            label: match.status === "disputed" ? `이의 ${openDisputeCount}건` : "결과 승인",
            title: getTournamentMatchDisplayTitle(match, match.title),
            meta: match.status === "disputed" ? `${getHomeMatchMeta(match)} · 처리 대기 ${openDisputeCount}건` : getHomeMatchMeta(match),
            href: `/app/matches?match=${match.id}`,
            icon: ShieldAlert,
          };
        }
        return null;
      })
      .filter(Boolean);
    const confirmableRoomItems = (app.state.recruitingPosts ?? [])
      .filter((post) => post.status === "open" && getRecruitingRoomOwnerId(post) === user.id)
      .map((post) => ({ post, lobby: getRecruitingLobby(post, app.state), timing: getPublicRoomTimingStatus(post) }))
      .filter(({ lobby, timing }) => lobby.canConfirm && timing.canConfirm)
      .map(({ post }) => ({
        id: `confirm-room-${post.id}`,
        recruitingPostId: post.id,
        priority: 1,
        label: "경기 확정",
        title: post.title,
        meta: getHomeRecruitingMeta(post),
        href: `/app/recruiting?post=${post.id}`,
        icon: Swords,
      }));

    const invitationItems = pendingInvitations.map(({ post, invitation }) => {
      const senderName = getRecruitingInvitationSenderName(app.state, invitation);
      return {
        id: `invite-${post.id}-${invitation.id}`,
        recruitingPostId: post.id,
        priority: 0,
        actionType: "recruiting-invite",
        postId: post.id,
        invitationId: invitation.id,
        label: invitation.role === "referee" ? "심판 초대" : "방 초대",
        title: post.title,
        meta: `${getHomeRecruitingMeta(post)} · ${senderName}님이 초대`,
        href: `/app/recruiting?filter=invited&post=${post.id}`,
        icon: UserPlus,
      };
    });
    const teamInvitationItems = pendingTeamInvitations.map((invitation) => {
      const team = teamById[invitation.teamId];
      return {
        id: `team-invite-${invitation.id}`,
        priority: 0,
        label: "팀 초대",
        title: team?.name ?? "팀 초대",
        meta: "팀 가입 초대 · 수락/거절 필요",
        href: "/app/notifications",
        icon: UserPlus,
      };
    });
    return [...invitationItems, ...teamInvitationItems, ...tournamentInviteItems, ...tournamentNotificationItems, ...tournamentScheduleItems, ...confirmableRoomItems, ...matchItems]
      .sort((a, b) => a.priority - b.priority || String(a.meta).localeCompare(String(b.meta)));
  }, [app.state, app.state.matches, app.state.recruitingPosts, app.state.tournaments, blockedUserIds, captainTeamIds, myTeamIds, pendingInvitations, pendingTeamInvitations, teamById, todayValue, user.id]);
  const priorityItems = actionItems.slice(0, 5);
  const homeNoticeItems = useMemo(() => dedupeNotifications((app.state.notifications ?? [])
    .filter((notification) => isNotificationVisibleToUser(notification, user.id, { blockedUserIds }))
    .map((notification) => isNotificationTargetUnavailable(notification, app.state)
      ? { ...notification, targetUnavailable: true }
      : notification)
    .filter((notification) => isNotificationDisplayable(notification))
    .filter((notification) => !notification.readAt))
    .sort(compareNotificationsNewestFirst), [app.state, app.state.notifications, blockedUserIds, user.id]);
  const priorityNoticeItems = homeNoticeItems.slice(0, 4);

  const {
    searchResults, homeFavoriteSearchItems, topRankers, recentFiveMatches, recentFiveWins,
    latestMyMatches, nextUpcomingMatch, nextUpcomingLine, placementComplete, rankSpotlightTier,
    rankSpotlightDivision, rankSpotlightLabel, renderHomeSearchItem, mapRemoteHomeSearchItem,
  } = useHomeSearchModel({
    searchText, app, blockedUserIds, getPlayerRatingSummary, favoritePlayerIds,
    favoriteRefereeIds, user, favoriteTeamIds, registeredCourts, favoriteCourtIds,
    SEARCH_DETAIL_LIMIT, seasonRows, myCompletedMatches, getUserResult, upcomingItems,
    getUserMatchLine,
  });

  const homeRoomOverlays = (
    <>
      <MatchRoomModal app={app} matchId={selectedMatchId} entryPoint="home" onClose={() => setSelectedMatchId("")} />
      {selectedRecruitingPost ? (
        <RecruitingRoomModal
          app={app}
          post={selectedRecruitingPost}
          entryPoint="home"
          onClose={() => setSelectedRecruitingPostId("")}
          onOpenMatch={(matchId) => {
            setSelectedRecruitingPostId("");
            openMatchRoom(matchId);
          }}
        />
      ) : null}
    </>
  );

  return <HomePageView {...{
    query, setQuery, searchResults, mapRemoteHomeSearchItem, homeFavoriteSearchItems,
    renderHomeSearchItem, SEARCH_PREVIEW_LIMIT, SEARCH_DETAIL_LIMIT, user, getPlayerRatingSummary,
    nextUpcomingMatch, openMatchRoom, nextUpcomingLine, upcomingItems, recentFiveWins,
    mySeasonIndex, app, registeredCourts, myCompletedMatches, getUserResult,
    latestMyMatches, getUserMatchLine, acceptHomeRecruitingInvitation, actionItems, declineHomeRecruitingInvitation,
    homeNoticeItems, localRivals, mySeasonRow, myTeamCount, myTeams,
    openActionRoom, placementComplete, priorityItems, priorityNoticeItems, processingInviteId,
    rankSpotlightLabel, seasonProgress, topRankers, homeRoomOverlays,
  }} />;
}
