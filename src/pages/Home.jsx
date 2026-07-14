import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Bell, CalendarDays, ClipboardCheck, Handshake, PlusCircle, ShieldAlert, Swords, Trophy, UserPlus } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import MatchCard from "../components/match/MatchCard.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import TierEmblem from "../components/rating/TierEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { MAX_TEAM_MEMBERSHIPS, getTeamRoleLabel } from "../lib/constants.js";
import { getRegisteredCourts } from "../lib/courts.js";
import { getCourtHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { canUserResolveMatchDispute, getAllowedStatFields, getMatchRecordWindow, getMatchRoomPhase, getMatchSideScore as getSideScore, getMatchUserParticipantSideName, getPlayerStatSubmitted, getPublicRoomTimingStatus, getRoomScheduleLabel, getSafeMatchSide as getSafeMatchSideBase, isInstantRoom, isMatchRelatedToUser, isPersonalRecordMatch, isSeedSampleMatch, userNeedsMatchAction, userNeedsMatchAgreement, userNeedsMatchApproval } from "../lib/matchUtils.js";
import { getPendingRecruitingInvitations, getRecruitingLobby, getRecruitingRoomOwnerId, isRecruitingPostForUser } from "../lib/recruiting.js";
import { getCurrentSeason, getPlayerSeasonRows, getSeasonProgress } from "../lib/season.js";
import { getTier, getTierDivision, getTierDivisionNumber } from "../lib/tier.js";
import { getDiscordAvatarClassName, getDiscordAvatarStyle } from "../lib/discord.js";
import { getNotificationDueAt, getNotificationHref, isHomeActionNotification, isNotificationVisibleToUser } from "../lib/notifications.js";

function toDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateValue, amount) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return toDateInputValue(date);
}

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

function isHomeUserMatch(match = {}, userId = "") {
  if (isSeedSampleMatch(match)) return false;
  return isMatchRelatedToUser(match, userId);
}

function compareSchedule(a, b) {
  const aKey = `${getScheduleDate(a) || "9999-12-31"} ${a.scheduledTime ?? ""} ${a.scheduledAt ?? ""}`;
  const bKey = `${getScheduleDate(b) || "9999-12-31"} ${b.scheduledTime ?? ""} ${b.scheduledAt ?? ""}`;
  return aKey.localeCompare(bKey);
}

function getUserResult(match, userId) {
  const sideName = getMatchUserParticipantSideName(match, userId) ?? "teamA";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  const sideScore = getSideScore(match, sideName);
  const otherScore = getSideScore(match, otherSide);
  if (sideScore === otherScore) return "D";
  return sideScore > otherScore ? "W" : "L";
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

function getRecruitingSchedule(post) {
  return getRoomScheduleLabel(post);
}

function getHomeRecruitingMeta(post = {}) {
  return `${getRecruitingSchedule(post)} · ${post.court || "구장 미정"}`;
}

function getHomeMatchMeta(match = {}) {
  const prefix = isPersonalRecordMatch(match) ? "개인 기록 · " : "";
  return `${prefix}${match.scheduledAt || getRoomScheduleLabel(match)} · ${match.court || "구장 미정"}`;
}

function getNotificationPreviewBody(notification = {}) {
  return String(notification.body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "알림 확인 필요";
}

const getSafeMatchSide = (match = {}, sideName = "teamA") => getSafeMatchSideBase(match, sideName, { includeScore: true });

function getUserMatchLine(match, userId) {
  const sideName = getMatchUserParticipantSideName(match, userId) ?? "teamA";
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
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [processingInviteId, setProcessingInviteId] = useState("");
  const searchText = query.trim().toLowerCase();
  const completedMatches = [...app.state.matches].filter((match) => match.status === "confirmed");
  const myTeam = app.state.teams.find((team) => team.members.some((member) => member.userId === user.id));
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const myTeams = useMemo(() => app.state.teams
    .filter((team) => team.members.some((member) => member.userId === user.id))
    .map((team) => ({ ...team, myRole: team.members.find((member) => member.userId === user.id)?.role ?? "regular" }))
    .sort((a, b) => Number(b.myRole === "captain") - Number(a.myRole === "captain") || b.mmr - a.mmr), [app.state.teams, user.id]);
  const captainTeamIds = useMemo(() => myTeams.filter((team) => team.myRole === "captain").map((team) => team.id), [myTeams]);
  const myTeamIds = useMemo(() => myTeams.map((team) => team.id), [myTeams]);
  const todayValue = toDateInputValue();
  const maxScheduleDate = addDays(todayValue, 365);
  const upcomingItems = useMemo(() => {
    const matchItems = [...app.state.matches]
      .filter((match) => ["locked", "checkin"].includes(getMatchRoomPhase(match).phase))
      .filter((match) => isHomeUserMatch(match, user.id) && !userNeedsMatchAction(match, user.id))
      .filter((match) => isHomeUpcomingScheduleItem(match, todayValue, maxScheduleDate))
      .map((match) => ({ type: "match", id: `match-${match.id}`, item: match }));
    return matchItems.sort((a, b) => compareSchedule(a.item, b.item));
  }, [app.state.matches, maxScheduleDate, todayValue, user.id]);
  const pendingInvitations = useMemo(() => getPendingRecruitingInvitations(app.state, user.id), [app.state, user.id]);
  const pendingTeamInvitations = useMemo(() => (app.state.teamInvitations ?? []).filter((invitation) => (
    invitation.targetUserId === user.id &&
    invitation.status === "pending"
  )), [app.state.teamInvitations, user.id]);
  const myTeamCount = myTeams.length;
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const favoritePlayerIds = app.state.settings?.favoritePlayerIds ?? [];
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const favoriteCourtIds = app.state.settings?.favoriteCourtIds ?? [];
  const favoriteRefereeIds = app.state.settings?.favoriteRefereeIds ?? [];
  const season = getCurrentSeason(app.state);
  const seasonProgress = getSeasonProgress(season);
  const seasonRows = getPlayerSeasonRows(app.state.users, app.state.matches, season, user.region);
  const mySeasonIndex = seasonRows.findIndex((row) => row.id === user.id);
  const mySeasonRow = mySeasonIndex >= 0 ? seasonRows[mySeasonIndex] : null;
  const localRivals = useMemo(() => {
    const regionTeams = app.state.teams
      .filter((team) => team.region === user.region)
      .sort((a, b) => b.mmr - a.mmr);
    const referenceMmr = myTeam?.mmr ?? regionTeams[0]?.mmr ?? user.ratings.integrated;
    return regionTeams
      .filter((team) => team.id !== myTeam?.id)
      .slice(0, 4)
      .map((team) => ({ ...team, gap: team.mmr - referenceMmr }));
  }, [app.state.teams, myTeam?.id, myTeam?.mmr, user.ratings.integrated, user.region]);
  const acceptHomeRecruitingInvitation = async (postId, invitationId) => {
    const key = `${postId}:${invitationId}`;
    setProcessingInviteId(key);
    try {
      const acceptPromise = app.actions.acceptRecruitingInvitation(postId, invitationId);
      navigate(`/app/recruiting?post=${postId}`);
      await acceptPromise;
    } finally {
      setProcessingInviteId("");
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
  const myCompletedMatches = completedMatches.filter((match) => isHomeUserMatch(match, user.id));
  const actionItems = useMemo(() => {
    const tournamentInviteItems = (app.state.tournaments ?? [])
      .filter((tournament) => tournament.status === "draft")
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
      .filter((notification) => isNotificationVisibleToUser(notification, user.id))
      .filter((notification) => notification.type === "tournament_invite" && isHomeActionNotification(notification))
      .filter((notification) => !loadedTournamentInviteIds.has(notification.tournamentId))
      .map((notification) => ({
        id: `notification-${notification.id}`,
        priority: 0,
        label: "대회 초대",
        title: notification.title,
        meta: notification.body || "팀장 승인 필요",
        href: getNotificationHref(notification),
        icon: Trophy,
      }));
    const tournamentScheduleItems = (app.state.notifications ?? [])
      .filter((notification) => isNotificationVisibleToUser(notification, user.id))
      .filter((notification) => notification.type === "tournament_match_schedule" && isHomeActionNotification(notification))
      .map((notification) => ({
        id: `notification-${notification.id}`,
        priority: 1,
        label: "명단 구성",
        title: notification.title,
        meta: notification.body || "출전·후보 명단 구성 필요",
        href: getNotificationHref(notification),
        icon: ClipboardCheck,
      }));
    const matchItems = app.state.matches
      .filter((match) => isHomeUserMatch(match, user.id))
      .map((match) => {
        const phase = getMatchRoomPhase(match).phase;
        if (userNeedsMatchAgreement(match, user.id)) {
          return {
            id: `agreement-${match.id}`,
            priority: 1,
            label: "동의",
            title: match.title,
            meta: getHomeMatchMeta(match),
            href: `/app/matches?match=${match.id}`,
            icon: Handshake,
          };
        }
        if (phase === "checkin" && userOperatesCheckin(match, user.id)) {
          return {
            id: `checkin-${match.id}`,
            priority: 2,
            label: "경기 시작",
            title: match.title,
            meta: getHomeMatchMeta(match),
            href: `/app/matches?match=${match.id}`,
            icon: Swords,
          };
        }
        if (phase === "postgame" && userNeedsResultInput(match, user.id)) {
          return {
            id: `result-${match.id}`,
            priority: 3,
            label: "결과 입력",
            title: match.title,
            meta: getHomeMatchMeta(match),
            href: `/app/matches?match=${match.id}`,
            icon: CalendarDays,
          };
        }
        if (phase === "dispute" && (userNeedsMatchApproval(match, user.id) || canUserResolveMatchDispute(match, user.id))) {
          return {
            id: `approval-${match.id}`,
            priority: 4,
            label: match.status === "disputed" ? "이의 확인" : "결과 승인",
            title: match.title,
            meta: getHomeMatchMeta(match),
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
        priority: 1,
        label: "경기 확정",
        title: post.title,
        meta: getHomeRecruitingMeta(post),
        href: `/app/recruiting?post=${post.id}`,
        icon: Swords,
      }));

    const invitationItems = pendingInvitations.map(({ post, invitation }) => ({
      id: `invite-${post.id}-${invitation.id}`,
      priority: 0,
      actionType: "recruiting-invite",
      postId: post.id,
      invitationId: invitation.id,
      label: invitation.role === "referee" ? "심판 초대" : "방 초대",
      title: post.title,
      meta: getHomeRecruitingMeta(post),
      href: `/app/recruiting?filter=invited&post=${post.id}`,
      icon: UserPlus,
    }));
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
    const cancelledRoomItems = (app.state.recruitingPosts ?? [])
      .filter((post) => post.status === "cancelled")
      .filter((post) => isRecruitingPostForUser(post, user.id, myTeamIds))
      .sort((a, b) => String(b.cancelledAt ?? b.createdAt ?? "").localeCompare(String(a.cancelledAt ?? a.createdAt ?? "")))
      .slice(0, 2)
      .map((post) => ({
        id: `cancelled-room-${post.id}`,
        priority: 5,
        label: "방 취소",
        title: post.title,
        meta: getHomeRecruitingMeta(post),
        href: `/app/recruiting?post=${post.id}`,
        icon: ShieldAlert,
      }));
    return [...invitationItems, ...teamInvitationItems, ...tournamentInviteItems, ...tournamentNotificationItems, ...tournamentScheduleItems, ...confirmableRoomItems, ...matchItems, ...cancelledRoomItems]
      .sort((a, b) => a.priority - b.priority || String(a.meta).localeCompare(String(b.meta)));
  }, [app.state, app.state.matches, app.state.recruitingPosts, app.state.tournaments, captainTeamIds, myTeamIds, pendingInvitations, pendingTeamInvitations, teamById, user.id]);
  const priorityItems = actionItems.slice(0, 5);
  const homeNoticeItems = useMemo(() => (app.state.notifications ?? [])
    .filter((notification) => isNotificationVisibleToUser(notification, user.id))
    .filter((notification) => !notification.readAt)
    .sort((a, b) => {
      const aTime = getNotificationDueAt(a) || a.createdAt || "";
      const bTime = getNotificationDueAt(b) || b.createdAt || "";
      return String(bTime).localeCompare(String(aTime));
    }), [app.state.notifications, user.id]);
  const priorityNoticeItems = homeNoticeItems.slice(0, 4);

  const searchResults = useMemo(() => {
    if (!searchText) return [];

    const players = app.state.users
      .filter((item) => !blockedUserIds.includes(item.id))
      .map((item) => {
        const hashtag = getUserHashtag(item);
        return {
          id: `player-${item.id}`,
          label: item.name,
          kind: "PLAYER",
          meta: `${item.region} · ${item.position} · ${item.ratings.integrated}`,
          href: `/app/players/${item.id}`,
          score: Number(hashtag.toLowerCase() === searchText) * 100000 + Number(favoritePlayerIds.includes(item.id) || favoriteRefereeIds.includes(item.id)) * 20000 + Number(item.region === user.region) * 10000 + item.ratings.integrated,
          haystack: `${item.name} ${hashtag} ${item.region} ${item.position} ${item.club}`,
          avatar: item.avatarColor,
          user: item,
          hashtag,
        };
      });
    const teams = app.state.teams.map((team) => {
      const hashtag = getTeamHashtag(team);
      return {
        id: `team-${team.id}`,
        label: team.name,
        kind: "TEAM",
        meta: `${team.region} · ${team.homeCourt} · ${team.mmr}`,
        href: `/app/teams/${team.id}`,
        score: Number(hashtag.toLowerCase() === searchText) * 100000 + Number(favoriteTeamIds.includes(team.id)) * 20000 + Number(team.region === user.region) * 10000 + team.mmr,
        haystack: `${team.name} ${hashtag} ${team.region} ${team.homeCourt}`,
        teamColor: team.accent,
        hashtag,
      };
    });
    const courts = registeredCourts.map((court) => {
      const hashtag = getCourtHashtag(court);
      return {
        id: `court-${court.id}`,
        label: court.name,
        kind: "COURT",
        meta: `${court.region} · ${court.type}`,
        href: "/app/create",
        score: Number(hashtag.toLowerCase() === searchText) * 100000 + Number(favoriteCourtIds.includes(court.id)) * 20000 + Number(court.region === user.region) * 10000,
        haystack: `${court.name} ${hashtag} ${court.region} ${court.type}`,
        court: true,
        hashtag,
      };
    });

    return [...players, ...teams, ...courts]
      .filter((item) => {
        const itemHashtag = item.hashtag.toLowerCase();
        if (/^#\d+$/.test(searchText)) return itemHashtag === searchText;
        if (searchText.startsWith("#")) return itemHashtag.includes(searchText);
        return item.haystack.toLowerCase().includes(searchText);
      })
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  }, [app.state.teams, app.state.users, blockedUserIds, favoriteCourtIds, favoritePlayerIds, favoriteRefereeIds, favoriteTeamIds, registeredCourts, searchText, user.region]);
  const homeFavoriteSearchItems = useMemo(() => {
    const favoritePlayers = favoritePlayerIds
      .map((playerId) => app.state.users.find((item) => item.id === playerId))
      .filter(Boolean)
      .map((item) => {
        const hashtag = getUserHashtag(item);
        return {
          id: `favorite-player-${item.id}`,
          label: item.name,
          kind: "PLAYER",
          meta: `${item.region} · ${item.position} · ${item.ratings.integrated}`,
          href: `/app/players/${item.id}`,
          haystack: `${item.name} ${hashtag} ${item.region} ${item.position} ${item.club}`,
          avatar: item.avatarColor,
          user: item,
          hashtag,
        };
      });
    const favoriteTeams = favoriteTeamIds
      .map((teamId) => app.state.teams.find((team) => team.id === teamId))
      .filter(Boolean)
      .map((team) => {
        const hashtag = getTeamHashtag(team);
        return {
          id: `favorite-team-${team.id}`,
          label: team.name,
          kind: "TEAM",
          meta: `${team.region} · ${team.homeCourt} · ${team.mmr}`,
          href: `/app/teams/${team.id}`,
          haystack: `${team.name} ${hashtag} ${team.region} ${team.homeCourt}`,
          teamColor: team.accent,
          hashtag,
        };
      });
    const favoriteCourts = favoriteCourtIds
      .map((courtId) => registeredCourts.find((court) => court.id === courtId))
      .filter(Boolean)
      .map((court) => {
        const hashtag = getCourtHashtag(court);
        return {
          id: `favorite-court-${court.id}`,
          label: court.name,
          kind: "COURT",
          meta: `${court.region} · ${court.type}`,
          href: "/app/create",
          haystack: `${court.name} ${hashtag} ${court.region} ${court.type}`,
          court: true,
          hashtag,
        };
      });
    const favoriteReferees = favoriteRefereeIds
      .map((refereeId) => app.state.users.find((item) => item.id === refereeId))
      .filter(Boolean)
      .map((item) => {
        const hashtag = getUserHashtag(item);
        return {
          id: `favorite-referee-${item.id}`,
          label: item.name,
          kind: "REFEREE",
          meta: `${item.region} · ${item.position} · ${item.trustScore}`,
          href: `/app/players/${item.id}`,
          haystack: `${item.name} ${hashtag} ${item.region} ${item.position}`,
          avatar: item.avatarColor,
          user: item,
          hashtag,
        };
      });
    return [...favoritePlayers, ...favoriteTeams, ...favoriteCourts, ...favoriteReferees].slice(0, SEARCH_DETAIL_LIMIT);
  }, [app.state.teams, app.state.users, favoriteCourtIds, favoritePlayerIds, favoriteRefereeIds, favoriteTeamIds, registeredCourts]);
  const topRankers = seasonRows.slice(0, 5);
  const recentFiveMatches = myCompletedMatches.slice(0, 5);
  const recentFiveWins = recentFiveMatches.filter((match) => getUserResult(match, user.id) === "W").length;
  const latestMyMatches = recentFiveMatches;
  const nextUpcomingMatch = upcomingItems[0]?.item ?? null;
  const nextUpcomingLine = nextUpcomingMatch ? getUserMatchLine(nextUpcomingMatch, user.id) : null;
  const rankSpotlightTier = getTier(user.ratings.integrated);
  const rankSpotlightDivision = getTierDivisionNumber(user.ratings.integrated);
  const rankSpotlightLabel = rankSpotlightDivision ? `${rankSpotlightTier.name} ${rankSpotlightDivision}` : rankSpotlightTier.name;
  const renderHomeSearchItem = (item) => (
    <Link key={item.id} to={item.href}>
      {item.avatar ? <span className={getDiscordAvatarClassName(item.user, "avatar small")} style={getDiscordAvatarStyle(item.user)}>{item.label.slice(0, 1)}</span> : null}
      {item.teamColor ? <span className="team-mini-dot" style={{ "--team-color": item.teamColor }} /> : null}
      {item.court ? <span className="court-mini-dot" /> : null}
      <span className="rank-result-main">
        <strong>{item.label}</strong>
        <em>{item.meta}</em>
      </span>
      <small>{item.kind} · {item.hashtag}</small>
    </Link>
  );
  const mapRemoteHomeSearchItem = (item) => {
    if (item.kind === "team") {
      const hashtag = getTeamHashtag(item);
      return {
        id: `remote-team-${item.id}`,
        label: item.name,
        kind: "TEAM",
        meta: `${item.region ?? "지역 미정"} · ${item.homeCourt ?? "홈코트 미정"} · ${item.mmr ?? 1200}`,
        href: `/app/teams/${item.id}`,
        teamColor: item.accent,
        hashtag,
        searchText: item.searchText,
      };
    }
    if (item.kind === "court") {
      const hashtag = getCourtHashtag(item);
      return {
        id: `remote-court-${item.id}`,
        label: item.name,
        kind: "COURT",
        meta: `${item.region ?? "지역 미정"} · ${item.type ?? "구장"}`,
        href: "/app/create",
        court: true,
        hashtag,
        searchText: item.searchText,
      };
    }
    const hashtag = getUserHashtag(item);
    return {
      id: `remote-${item.kind}-${item.id}`,
      label: item.name,
      kind: item.kind === "referee" ? "REFEREE" : "PLAYER",
      meta: `${item.region ?? "지역 미정"} · ${item.position ?? "포지션"} · ${item.ratings?.integrated ?? item.trustScore ?? "-"}`,
      href: `/app/players/${item.id}`,
      avatar: item.avatarColor,
      user: item,
      hashtag,
      searchText: item.searchText,
    };
  };

  return (
    <div className="page-stack rank-home">
      <Card className="home-search-panel rank-search-card">
        <SearchPicker
          value={query}
          onChange={setQuery}
          placeholder="이름, 팀명, 코트명, 해시태그를 바로 검색"
          items={searchResults}
          remoteSearchType="all"
          mapRemoteItem={mapRemoteHomeSearchItem}
          idleItems={homeFavoriteSearchItems}
          idleTitle="즐겨찾기"
          showIdleOnFocus
          closeOnResultClick
          renderItem={renderHomeSearchItem}
          limit={SEARCH_PREVIEW_LIMIT}
          detailLimit={SEARCH_DETAIL_LIMIT}
          fieldClassName="home-search-box"
        />
        <div className="home-search-actions">
          <Link to="/app/create" className="home-search-create">
            <Button className="home-search-create-button"><PlusCircle size={18} /> 매칭 만들기</Button>
          </Link>
          <Link to="/app/create?intent=record" className="home-search-create">
            <Button className="home-search-create-button"><ClipboardCheck size={18} /> 경기 기록하기</Button>
          </Link>
        </div>
      </Card>

      <div className="page-stack home-left-rail">
        <section className="rank-summary-grid">
          <div className="home-rank-board-head">
            <div className="rank-hero-top">
              <div>
                <p className="eyebrow">내 랭크 보드</p>
                <h1>{user.name}님의 오늘 코트 현황</h1>
                <p>{user.region} · {user.position} · 통합 {getTierDivision(user.ratings.integrated)} · {Math.round(user.ratings.integrated)} MMR</p>
              </div>
            </div>
            <aside className="home-hero-board" aria-label="내 코트 요약">
              <Link className="home-hero-next" to={nextUpcomingMatch ? `/app/matches?match=${nextUpcomingMatch.id}` : "/app/recruiting"}>
                <span><CalendarDays size={16} /> {nextUpcomingMatch ? "NEXT MATCH" : "COURT OPEN"}</span>
                <strong>{nextUpcomingLine ? `${nextUpcomingLine.side.name} vs ${nextUpcomingLine.opponent.name}` : "예정된 경기 없음"}</strong>
                <em>{nextUpcomingMatch ? `${getRoomScheduleLabel(nextUpcomingMatch)} · ${nextUpcomingMatch.court || "구장 미정"}` : "새 매칭을 찾아 다음 경기를 잡으세요."}</em>
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
              <div className="home-hero-stats">
                <span><strong>{upcomingItems.length}</strong><em>확정 경기</em></span>
                <span><strong>{recentFiveWins}승</strong><em>최근 5경기</em></span>
                <span><strong>{mySeasonIndex >= 0 ? `${mySeasonIndex + 1}위` : "대기"}</strong><em>지역 순위</em></span>
              </div>
            </aside>
          </div>
        </section>
      </div>

      <aside className="page-stack home-right-rail">
        <aside className="page-stack home-top-rail">
          <div className="rank-tier-rail">
            <Card className="section-card rank-profile-card rank-spotlight-card">
              <div className="rank-spotlight-content">
                <p className="eyebrow">My Rank</p>
                <div className="rank-spotlight-main">
                  <TierEmblem mmr={user.ratings.integrated} size="md" />
                  <div>
                    <strong>{rankSpotlightLabel}</strong>
                    <span>{Math.round(user.ratings.integrated)} MMR · 최근 5경기 {recentFiveWins}승</span>
                  </div>
                </div>
                <div className="rank-profile-tabs rank-spotlight-links">
                  <Link to={`/app/players/${user.id}`}>프로필</Link>
                  <Link to="/app/season">시즌</Link>
                  <Link to="/app/settings">설정</Link>
                </div>
              </div>
            </Card>
          </div>

          <Card className="section-card home-action-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Action Queue</p>
                <h2>내가 처리할 일</h2>
              </div>
              <Badge tone={actionItems.length ? "orange" : "neutral"}>{actionItems.length}개</Badge>
            </div>
            <div className="home-action-list">
              {actionItems.length ? (
                <>
                {priorityItems.map((item) => {
                  const Icon = item.icon;
                  if (item.actionType === "recruiting-invite") {
                    const isProcessing = processingInviteId === `${item.postId}:${item.invitationId}`;
                    return (
                      <div key={item.id} className={`home-action-row priority-${item.priority}`}>
                        <span className="home-action-icon"><Icon size={18} /></span>
                        <span className="home-action-main">
                          <strong>{item.title}</strong>
                          <em>{item.meta}</em>
                        </span>
                        <span className="home-action-buttons">
                          <Button size="sm" type="button" disabled={isProcessing} onClick={() => acceptHomeRecruitingInvitation(item.postId, item.invitationId)}>{isProcessing ? "수락 중" : "수락"}</Button>
                          <Button size="sm" type="button" variant="secondary" disabled={isProcessing} onClick={() => declineHomeRecruitingInvitation(item.postId, item.invitationId)}>{isProcessing ? "처리 중" : "거절"}</Button>
                          <Link className="button button-secondary button-sm" to={item.href}>보기</Link>
                        </span>
                      </div>
                    );
                  }
                  return (
                    <Link key={item.id} to={item.href} className={`home-action-row priority-${item.priority}`}>
                      <span className="home-action-icon"><Icon size={18} /></span>
                      <span className="home-action-main">
                        <strong>{item.title}</strong>
                        <em>{item.meta}</em>
                      </span>
                      <b>{item.label}</b>
                    </Link>
                  );
                })}
                {actionItems.length > priorityItems.length ? (
                  <Link to={actionItems[priorityItems.length]?.href ?? "/app/matches"} className="home-action-row priority-5">
                    <span className="home-action-icon"><ClipboardCheck size={18} /></span>
                    <span className="home-action-main">
                      <strong>더 처리할 항목 있음</strong>
                      <em>{actionItems.length - priorityItems.length}개 더 있음</em>
                    </span>
                    <b>더보기</b>
                  </Link>
                ) : null}
                </>
              ) : (
                <div className="home-action-row priority-5">
                  <span className="home-action-icon"><ClipboardCheck size={18} /></span>
                  <span className="home-action-main">
                    <strong>처리할 일 없음</strong>
                    <em>초대, 승인, 기록 입력 같은 작업이 여기 뜹니다.</em>
                  </span>
                  <b>OK</b>
                </div>
              )}
            </div>
          </Card>

          <Card className="section-card home-alert-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Alerts</p>
                <h2>알림</h2>
              </div>
              <Badge tone={homeNoticeItems.length ? "orange" : "neutral"}>{homeNoticeItems.length}개</Badge>
            </div>
            <div className="home-action-list">
              {priorityNoticeItems.length ? (
                <>
                  {priorityNoticeItems.map((notification) => (
                    <Link key={notification.id} to={getNotificationHref(notification)} className="home-action-row priority-5">
                      <span className="home-action-icon"><Bell size={18} /></span>
                      <span className="home-action-main">
                        <strong>{notification.title}</strong>
                        <em>{getNotificationPreviewBody(notification)}</em>
                      </span>
                      <b>보기</b>
                    </Link>
                  ))}
                  {homeNoticeItems.length > priorityNoticeItems.length ? (
                    <Link to="/app/notifications" className="home-action-row priority-5">
                      <span className="home-action-icon"><Bell size={18} /></span>
                      <span className="home-action-main">
                        <strong>더 많은 알림</strong>
                        <em>{homeNoticeItems.length - priorityNoticeItems.length}개 더 있음</em>
                      </span>
                      <b>전체</b>
                    </Link>
                  ) : null}
                </>
              ) : (
                <div className="home-action-row priority-5">
                  <span className="home-action-icon"><Bell size={18} /></span>
                  <span className="home-action-main">
                    <strong>새 알림 없음</strong>
                    <em>경기 안내와 방 변경 알림이 여기 뜹니다.</em>
                  </span>
                  <b>OK</b>
                </div>
              )}
            </div>
          </Card>
        </aside>

        <aside className="page-stack home-side-stack">
          <Card className="section-card rank-leaderboard-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Local Ranking</p>
                <h2>{user.region} 랭킹</h2>
              </div>
              <Trophy size={20} />
            </div>
            <div className="rank-list">
              {topRankers.map((row, index) => (
                <PlayerHoverCard className="rank-row" key={row.id} user={row} teams={app.state.teams}>
                  <b>{index + 1}</b>
                  <span className={getDiscordAvatarClassName(row, "avatar small")} style={getDiscordAvatarStyle(row)}>{row.name.slice(0, 1)}</span>
                  <strong>{row.name}</strong>
                  <em>{Math.round(row.seasonScore)}점</em>
                </PlayerHoverCard>
              ))}
            </div>
          </Card>

          <Card className="section-card season-mini-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Season Race</p>
                <h2>{user.region} 시즌 레이스</h2>
              </div>
              <Trophy size={20} />
            </div>
            <div className="season-progress">
              <span style={{ width: `${seasonProgress}%` }} />
            </div>
            <div className="contract-grid single">
              <div>
                <span>내 지역 순위</span>
                <strong>{mySeasonIndex >= 0 ? `${mySeasonIndex + 1}위` : "대기"}</strong>
              </div>
              <div>
                <span>시즌 전적</span>
                <strong>{mySeasonRow ? `${mySeasonRow.seasonWins}승 ${mySeasonRow.seasonLosses}패` : "0승 0패"}</strong>
              </div>
            </div>
            <Link to="/app/season">
              <Button variant="secondary" className="wide-button"><Trophy size={17} /> 시즌 허브</Button>
            </Link>
          </Card>
          <Card className="section-card rivalry-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Local Rivalry</p>
                <h2>{user.region} 라이벌</h2>
              </div>
              <Swords size={20} />
            </div>
            <div className="compact-list rivalry-list">
              {localRivals.length ? localRivals.map((team) => (
                <TeamHoverCard key={team.id} team={team}>
                  <span>{team.name}</span>
                  <strong>{team.gap > 0 ? `+${team.gap}` : team.gap} MMR</strong>
                </TeamHoverCard>
              )) : <div><span>지역 라이벌 없음</span><strong>대기</strong></div>}
            </div>
          </Card>
          <Card className="section-card home-my-teams-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">My Teams</p>
                <h2>내 소속 팀</h2>
              </div>
              <Badge tone={myTeamCount > MAX_TEAM_MEMBERSHIPS ? "orange" : myTeamCount ? "green" : "neutral"}>{myTeamCount}/{MAX_TEAM_MEMBERSHIPS}</Badge>
            </div>
            <div className="home-team-list">
              {myTeams.length ? myTeams.slice(0, 5).map((team) => (
                <TeamHoverCard key={team.id} team={team}>
                  <span className="team-mini-dot" style={{ "--team-color": team.accent }} />
                  <strong>{team.name}</strong>
                  <em>{getTeamRoleLabel(team.myRole)}</em>
                  <b>{team.mmr}</b>
                </TeamHoverCard>
              )) : <div><span>팀 없음</span><strong>팀 찾기 필요</strong></div>}
            </div>
            <Link to="/app/teams">
              <Button variant="secondary" className="wide-button">팀 전체 보기</Button>
            </Link>
          </Card>
        </aside>
      </aside>

      <div className="content-grid home-dashboard-grid rank-dashboard-grid">
        <div className="page-stack home-primary-stack">
          <Card className="section-card match-focus-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Upcoming</p>
                <h2>내 확정 경기</h2>
              </div>
              <Badge tone={upcomingItems.length ? "orange" : "neutral"}>{upcomingItems.length}개</Badge>
            </div>
            {upcomingItems.length ? (
              <div className="match-stack">
                {upcomingItems.slice(0, 3).map((entry) => {
                  return <MatchCard key={entry.id} match={entry.item} teams={app.state.teams} courts={registeredCourts} />;
                })}
                {upcomingItems.length > 3 ? (
                  <Link to="/app/matches" className="button button-secondary button-sm home-upcoming-more">
                    전체 보기
                  </Link>
                ) : null}
              </div>
            ) : (
              <div className="empty-state">확정 경기 없음</div>
            )}
          </Card>

          <Card className="section-card home-recent-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Recent Matches</p>
                <h2>내 최근 전적</h2>
              </div>
              <Badge tone="green">{myCompletedMatches.length}경기</Badge>
            </div>
            <div className="recent-result-strip">
              {myCompletedMatches.slice(0, 8).map((match) => {
                const result = getUserResult(match, user.id);
                return (
                  <Link key={match.id} to={`/app/matches?match=${match.id}`} className={`recent-result-pill result-${result.toLowerCase()}`}>
                    {result}
                  </Link>
                );
              })}
            </div>
            <div className="recent-match-list">
              {latestMyMatches.map((match) => (
                <Link key={match.id} to={`/app/matches?match=${match.id}`} className={`recent-match-row result-${getUserResult(match, user.id).toLowerCase()}`}>
                  {(() => {
                    const line = getUserMatchLine(match, user.id);
                    return (
                      <>
                        <b>{line.result}</b>
                        <span>
                          <TeamHoverCard team={teamById[line.side.teamId]} as="span"><strong>{line.side.name}</strong></TeamHoverCard>
                          <em>vs <TeamHoverCard team={teamById[line.opponent.teamId]} as="span">{line.opponent.name}</TeamHoverCard> · {match.court}</em>
                        </span>
                        <i>{line.score}:{line.opponentScore}</i>
                      </>
                    );
                  })()}
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
