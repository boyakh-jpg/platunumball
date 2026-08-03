import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/common/Button.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import { REFEREE_TRUST_MIN } from "../lib/constants.js";
import { getCourtHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { isEligibleReferee } from "../lib/matchUtils.js";

export default function useSettingsFavorites({ app, registeredCourts }) {
  const [favoriteQuery, setFavoriteQuery] = useState("");
  const [favoriteListType, setFavoriteListType] = useState("");
  const [favoriteActionPendingKey, setFavoriteActionPendingKey] = useState("");
  const [favoriteActionError, setFavoriteActionError] = useState("");
  const [favoriteSearchResetKey, setFavoriteSearchResetKey] = useState(0);
  const favoriteActionPendingRef = useRef("");
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
  const toggleFavoriteItem = async (kind, toggleAction, item, clearQuery = false) => {
    const actionKey = `${kind}:${item.id}`;
    if (favoriteActionPendingRef.current) return false;
    favoriteActionPendingRef.current = actionKey;
    setFavoriteActionPendingKey(actionKey);
    setFavoriteActionError("");
    try {
      const result = await toggleAction(item.id, item);
      if (!result || result?.ok === false) {
        setFavoriteActionError("즐겨찾기를 저장하지 못했습니다. 다시 시도해 주세요.");
        return false;
      }
      if (clearQuery) {
        setFavoriteQuery("");
        setFavoriteSearchResetKey((current) => current + 1);
      }
      return true;
    } catch {
      setFavoriteActionError("즐겨찾기를 저장하지 못했습니다. 다시 시도해 주세요.");
      return false;
    } finally {
      favoriteActionPendingRef.current = "";
      setFavoriteActionPendingKey("");
    }
  };
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
          <Button type="button" size="sm" variant={favoriteTeamIds.includes(item.id) ? "primary" : "secondary"} disabled={Boolean(favoriteActionPendingKey)} onClick={() => { void toggleFavoriteItem("team", app.actions.toggleFavoriteTeam, item, true); }}>
            {favoriteActionPendingKey === `team:${item.id}` ? "저장 중" : favoriteTeamIds.includes(item.id) ? "해제" : "저장"}
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
          <Button type="button" size="sm" variant={favoriteCourtIds.includes(item.id) ? "primary" : "secondary"} disabled={Boolean(favoriteActionPendingKey)} onClick={() => { void toggleFavoriteItem("court", app.actions.toggleFavoriteCourt, item, true); }}>
            {favoriteActionPendingKey === `court:${item.id}` ? "저장 중" : favoriteCourtIds.includes(item.id) ? "해제" : "저장"}
          </Button>
        </div>
      );
    }
    if (item.kind === "referee") {
      return (
        <div key={`favorite-referee-${item.id}`} className="favorite-result-row" onMouseDown={(event) => event.preventDefault()}>
          <Link className="favorite-result-identity" to={`/app/referees/${item.id}`}>
            <ProfileEmblem user={item} className="small" />
            <span>
              <strong>{item.name}</strong>
              <em>{getUserHashtag(item)} · 신뢰도 {item.trustScore}</em>
            </span>
          </Link>
          <Button type="button" size="sm" variant={favoriteRefereeIds.includes(item.id) ? "primary" : "secondary"} disabled={Boolean(favoriteActionPendingKey)} onClick={() => { void toggleFavoriteItem("referee", app.actions.toggleFavoriteReferee, item, true); }}>
            {favoriteActionPendingKey === `referee:${item.id}` ? "저장 중" : favoriteRefereeIds.includes(item.id) ? "해제" : "저장"}
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
        <Button type="button" size="sm" variant={favoritePlayerIds.includes(item.id) ? "primary" : "secondary"} disabled={Boolean(favoriteActionPendingKey)} onClick={() => { void toggleFavoriteItem("player", app.actions.toggleFavoritePlayer, item, true); }}>
          {favoriteActionPendingKey === `player:${item.id}` ? "저장 중" : favoritePlayerIds.includes(item.id) ? "해제" : "저장"}
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
    favoriteActionPendingKey,
    favoriteActionError,
    favoriteSearchResetKey,
    toggleFavoriteItem,
    renderFavoriteSearchItem,
  };
}
