import { useState } from "react";
import Button from "../components/common/Button.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import { REFEREE_TRUST_MIN } from "../lib/constants.js";
import { getCourtHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { isEligibleReferee } from "../lib/matchUtils.js";

export default function useSettingsFavorites({ app, registeredCourts }) {
  const [favoriteQuery, setFavoriteQuery] = useState("");
  const [favoriteListType, setFavoriteListType] = useState("");
  const favoritePlayerIds = app.state.settings?.favoritePlayerIds ?? [];
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const favoriteCourtIds = app.state.settings?.favoriteCourtIds ?? [];
  const favoriteRefereeIds = app.state.settings?.favoriteRefereeIds ?? [];
  const favoritePlayers = favoritePlayerIds.map((playerId) => app.state.users.find((item) => item.id === playerId)).filter(Boolean);
  const favoriteTeams = favoriteTeamIds.map((teamId) => app.state.teams.find((item) => item.id === teamId)).filter(Boolean);
  const favoriteCourts = favoriteCourtIds.map((courtId) => registeredCourts.find((item) => item.id === courtId)).filter(Boolean);
  const favoriteReferees = favoriteRefereeIds
    .map((userId) => app.state.users.find((item) => item.id === userId))
    .filter((user) => user && isEligibleReferee(user, REFEREE_TRUST_MIN, app.state.settings?.refereeAppointments));
  const favoriteListConfig = {
    player: { label: "프로필", count: favoritePlayerIds.length },
    team: { label: "팀", count: favoriteTeamIds.length },
    court: { label: "구장", count: favoriteCourtIds.length },
    referee: { label: "심판", count: favoriteRefereeIds.length },
  };
  const favoriteSearchIdleItems = [
    ...favoritePlayers.map((item) => ({ ...item, kind: "profile" })),
    ...favoriteTeams.map((item) => ({ ...item, kind: "team" })),
    ...favoriteCourts.map((item) => ({ ...item, kind: "court" })),
    ...favoriteReferees.map((item) => ({ ...item, kind: "referee" })),
  ].slice(0, 10);
  const renderFavoriteSearchItem = (item) => {
    if (item.kind === "team") {
      return (
        <div key={`favorite-team-${item.id}`} className="favorite-result-row" onMouseDown={(event) => event.preventDefault()}>
          <span className="favorite-result-identity team-identity">
            <TeamEmblem team={item} size="sm" />
            <span>
              <strong>{item.name}</strong>
              <em>{getTeamHashtag(item)}</em>
            </span>
          </span>
          <Button type="button" size="sm" variant={favoriteTeamIds.includes(item.id) ? "primary" : "secondary"} onClick={() => { app.actions.toggleFavoriteTeam(item.id); setFavoriteQuery(""); }}>
            {favoriteTeamIds.includes(item.id) ? "해제" : "저장"}
          </Button>
        </div>
      );
    }
    if (item.kind === "court") {
      return (
        <div key={`favorite-court-${item.id}`} className="favorite-result-row" onMouseDown={(event) => event.preventDefault()}>
          <span className="favorite-result-identity">
            <span className="team-dot" />
            <span>
              <strong>{item.name}</strong>
              <em>{getCourtHashtag(item)}</em>
            </span>
          </span>
          <Button type="button" size="sm" variant={favoriteCourtIds.includes(item.id) ? "primary" : "secondary"} onClick={() => { app.actions.toggleFavoriteCourt(item.id); setFavoriteQuery(""); }}>
            {favoriteCourtIds.includes(item.id) ? "해제" : "저장"}
          </Button>
        </div>
      );
    }
    if (item.kind === "referee") {
      return (
        <div key={`favorite-referee-${item.id}`} className="favorite-result-row" onMouseDown={(event) => event.preventDefault()}>
          <span className="favorite-result-identity">
            <ProfileEmblem user={item} className="small" />
            <span>
              <strong>{item.name}</strong>
              <em>{getUserHashtag(item)} · 신뢰도 {item.trustScore}</em>
            </span>
          </span>
          <Button type="button" size="sm" variant={favoriteRefereeIds.includes(item.id) ? "primary" : "secondary"} onClick={() => { app.actions.toggleFavoriteReferee(item.id); setFavoriteQuery(""); }}>
            {favoriteRefereeIds.includes(item.id) ? "해제" : "저장"}
          </Button>
        </div>
      );
    }
    return (
      <div key={`favorite-player-${item.id}`} className="favorite-result-row" onMouseDown={(event) => event.preventDefault()}>
        <span className="favorite-result-identity">
          <ProfileEmblem user={item} className="small" />
          <span>
            <strong>{item.name}</strong>
            <em>{getUserHashtag(item)}</em>
          </span>
        </span>
        <Button type="button" size="sm" variant={favoritePlayerIds.includes(item.id) ? "primary" : "secondary"} onClick={() => { app.actions.toggleFavoritePlayer(item.id); setFavoriteQuery(""); }}>
          {favoritePlayerIds.includes(item.id) ? "해제" : "저장"}
        </Button>
      </div>
    );
  };

  return {
    favoriteQuery,
    setFavoriteQuery,
    favoriteListType,
    setFavoriteListType,
    favoritePlayers,
    favoriteTeams,
    favoriteCourts,
    favoriteReferees,
    favoriteListConfig,
    favoriteSearchIdleItems,
    renderFavoriteSearchItem,
  };
}
