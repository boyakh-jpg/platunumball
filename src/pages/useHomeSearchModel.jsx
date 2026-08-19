import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CourtIdentityIcon } from "../components/court/CourtHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import { DEFAULT_RATING } from "../lib/constants.js";
import { getCourtHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { isPlacementComplete } from "../lib/rating.js";
import { getTier, getTierDivisionNumber } from "../lib/tier.js";

export function useHomeSearchModel({
  searchText, app, blockedUserIds, getPlayerRatingSummary, favoritePlayerIds,
  favoriteRefereeIds, user, favoriteTeamIds, registeredCourts, favoriteCourtIds,
  SEARCH_DETAIL_LIMIT, seasonRows, myCompletedMatches, getUserResult, upcomingItems,
  getUserMatchLine,
}) {
  const blockedUserIdSet = useMemo(() => new Set(blockedUserIds), [blockedUserIds]);
  const searchResults = useMemo(() => {
    if (!searchText) return [];

    const players = app.state.users
      .filter((item) => !blockedUserIds.includes(item.id))
      .map((item) => {
        const hashtag = getUserHashtag(item);
        return {
          id: `player-${item.id}`,
          entityId: item.id,
          label: item.name,
          kind: "PLAYER",
          meta: `${item.region} · ${item.position} · ${getPlayerRatingSummary(item)}`,
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
        entityId: team.id,
        label: team.name,
        kind: "TEAM",
        meta: `${team.region} · ${team.homeCourt} · ${team.mmr}`,
        href: `/app/teams/${team.id}`,
        score: Number(hashtag.toLowerCase() === searchText) * 100000 + Number(favoriteTeamIds.includes(team.id)) * 20000 + Number(team.region === user.region) * 10000 + team.mmr,
        haystack: `${team.name} ${hashtag} ${team.region} ${team.homeCourt}`,
        team,
        hashtag,
      };
    });
    const courts = registeredCourts.map((court) => {
      const hashtag = getCourtHashtag(court);
      return {
        id: `court-${court.id}`,
        entityId: court.id,
        label: court.name,
        kind: "COURT",
        meta: `${court.region} · ${court.type}`,
        href: `/app/courts/${encodeURIComponent(court.id)}`,
        score: Number(hashtag.toLowerCase() === searchText) * 100000 + Number(favoriteCourtIds.includes(court.id)) * 20000 + Number(court.region === user.region) * 10000,
        haystack: `${court.name} ${hashtag} ${court.region} ${court.type}`,
        court,
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
      .filter((playerId) => !blockedUserIdSet.has(playerId))
      .map((playerId) => app.state.users.find((item) => item.id === playerId))
      .filter(Boolean)
      .map((item) => {
        const hashtag = getUserHashtag(item);
        return {
          id: `favorite-player-${item.id}`,
          label: item.name,
          kind: "PLAYER",
          meta: `${item.region} · ${item.position} · ${getPlayerRatingSummary(item)}`,
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
          team,
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
          href: `/app/courts/${encodeURIComponent(court.id)}`,
          haystack: `${court.name} ${hashtag} ${court.region} ${court.type}`,
          court,
          hashtag,
        };
      });
    const favoriteReferees = favoriteRefereeIds
      .filter((refereeId) => !blockedUserIdSet.has(refereeId))
      .map((refereeId) => app.state.users.find((item) => item.id === refereeId))
      .filter(Boolean)
      .map((item) => {
        const hashtag = getUserHashtag(item);
        return {
          id: `favorite-referee-${item.id}`,
          label: item.name,
          kind: "REFEREE",
          meta: `${item.region} · ${item.position} · ${item.trustScore}`,
          href: `/app/referees/${item.id}`,
          haystack: `${item.name} ${hashtag} ${item.region} ${item.position}`,
          avatar: item.avatarColor,
          user: item,
          hashtag,
        };
      });
    return [...favoritePlayers, ...favoriteTeams, ...favoriteCourts, ...favoriteReferees].slice(0, SEARCH_DETAIL_LIMIT);
  }, [app.state.teams, app.state.users, blockedUserIdSet, favoriteCourtIds, favoritePlayerIds, favoriteRefereeIds, favoriteTeamIds, registeredCourts]);
  const topRankers = seasonRows.slice(0, 5);
  const recentFiveMatches = myCompletedMatches.slice(0, 5);
  const recentFiveWins = recentFiveMatches.filter((match) => getUserResult(match, user.id) === "W").length;
  const latestMyMatches = recentFiveMatches;
  const nextUpcomingMatch = upcomingItems[0]?.item ?? null;
  const nextUpcomingLine = nextUpcomingMatch ? getUserMatchLine(nextUpcomingMatch, user.id) : null;
  const placementComplete = isPlacementComplete(user.ratings);
  const rankSpotlightTier = placementComplete ? getTier(user.ratings.integrated) : null;
  const rankSpotlightDivision = placementComplete ? getTierDivisionNumber(user.ratings.integrated) : null;
  const rankSpotlightLabel = placementComplete
    ? (rankSpotlightDivision ? `${rankSpotlightTier.name} ${rankSpotlightDivision}` : rankSpotlightTier.name)
    : "배정 전";
  const renderHomeSearchItem = (item) => {
    const content = (
      <>
      {item.avatar ? <ProfileEmblem user={item.user} className="small" initial={item.label.slice(0, 1)} /> : null}
      {item.team ? <TeamEmblem team={item.team} size="xs" /> : null}
      {item.court ? <CourtIdentityIcon compact /> : null}
      <span className="rank-result-main">
        <strong>{item.label}</strong>
        <em>{item.meta}</em>
      </span>
      <small>{item.kind} · {item.hashtag}</small>
      </>
    );
    return <Link key={item.id} className="home-search-entity-trigger" to={item.href}>{content}</Link>;
  };
  const mapRemoteHomeSearchItem = (item) => {
    if (item.kind === "match_code") {
      return {
        id: `remote-match-code-${item.id}`,
        entityId: item.id,
        label: item.label,
        kind: "MATCH",
        meta: "경기 일련번호",
        href: item.href,
        hashtag: `#${item.publicCode}`,
        searchText: item.searchText,
      };
    }
    if (["player", "referee"].includes(item.kind) && blockedUserIdSet.has(item.id)) return null;
    if (item.kind === "team") {
      const hashtag = getTeamHashtag(item);
      return {
        id: `remote-team-${item.id}`,
        entityId: item.id,
        label: item.name,
        kind: "TEAM",
        meta: `${item.region ?? "지역 미정"} · ${item.homeCourt ?? "홈코트 미정"} · ${item.mmr ?? DEFAULT_RATING}`,
        href: `/app/teams/${item.id}`,
        team: item,
        hashtag,
        searchText: item.searchText,
      };
    }
    if (item.kind === "court") {
      const hashtag = getCourtHashtag(item);
      return {
        id: `remote-court-${item.id}`,
        entityId: item.id,
        label: item.name,
        kind: "COURT",
        meta: `${item.region ?? "지역 미정"} · ${item.type ?? "구장"}`,
        href: `/app/courts/${encodeURIComponent(item.id)}`,
        court: item,
        hashtag,
        searchText: item.searchText,
      };
    }
    const hashtag = getUserHashtag(item);
    return {
      id: `remote-${item.kind}-${item.id}`,
      entityId: item.id,
      label: item.name,
      kind: item.kind === "referee" ? "REFEREE" : "PLAYER",
      meta: `${item.region ?? "지역 미정"} · ${item.position ?? "포지션"} · ${getPlayerRatingSummary(item)}`,
      href: item.kind === "referee" ? `/app/referees/${item.id}` : `/app/players/${item.id}`,
      avatar: item.avatarColor,
      user: item,
      hashtag,
      searchText: item.searchText,
    };
  };

  return {
    searchResults, homeFavoriteSearchItems, topRankers, recentFiveMatches, recentFiveWins,
    latestMyMatches, nextUpcomingMatch, nextUpcomingLine, placementComplete, rankSpotlightTier,
    rankSpotlightDivision, rankSpotlightLabel, renderHomeSearchItem, mapRemoteHomeSearchItem,
  };
}
