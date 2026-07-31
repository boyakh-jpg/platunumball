import { Link, useNavigate } from "react-router-dom";
import HoverPortal, { HoverCardCloseButton, HoverCardTrigger } from "../common/HoverPortal.jsx";
import TierEmblem from "../rating/TierEmblem.jsx";
import TeamEmblem from "./TeamEmblem.jsx";
import useHoverCardInteraction from "../../hooks/useHoverCardInteraction.js";
import { getTeamHashtag } from "../../lib/handles.js";
import { isTouchPreviewEvent } from "../../lib/hoverPreviewPin.js";
import { getTierDivision } from "../../lib/tier.js";
import { DEFAULT_RATING } from "../../lib/constants.js";

export default function TeamHoverCard({ team, children, className = "", as = "link", to, directNavigation = false }) {
  const navigate = useNavigate();
  const cardKey = team?.id ? `team:${team.id}` : "";
  const {
    anchorRef,
    cardRef,
    closePinned,
    consumeLongPressOpen,
    hideHover,
    open,
    openPinned,
    pinnedOpen,
    triggerProps,
  } = useHoverCardInteraction({ cardKey, longPress: true });

  if (!team) {
    return <span className={className}>{children}</span>;
  }

  const teamPath = to ?? `/app/teams/${team.id}`;
  const played = Number(team.wins ?? 0) + Number(team.losses ?? 0);
  const winRate = played ? Math.round((Number(team.wins ?? 0) / played) * 100) : 0;
  const memberCount = Number(team.memberCount);
  const rosterCountLabel = Number.isInteger(memberCount) && memberCount >= 0
    ? `${memberCount}명`
    : team.membersPartial === true ? "확인 필요" : `${team.members?.length ?? 0}명`;
  const handleTriggerClick = (event) => {
    if (directNavigation) {
      event.preventDefault();
      event.stopPropagation();
      if (consumeLongPressOpen()) return;
      closePinned();
      navigate(teamPath, { state: { teamPreview: team } });
      return;
    }
    if (as === "span" && !isTouchPreviewEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (consumeLongPressOpen()) return;
    if (pinnedOpen) {
      closePinned();
      return;
    }
    openPinned();
  };

  return (
    <HoverCardTrigger
      anchorRef={anchorRef}
      className={`team-hover-trigger ${className}`}
      onClick={handleTriggerClick}
      onActivate={() => {
        if (directNavigation) {
          closePinned();
          navigate(teamPath, { state: { teamPreview: team } });
        } else {
          openPinned();
        }
      }}
      onDismiss={() => {
        hideHover();
        closePinned();
      }}
      role={directNavigation ? "link" : as === "span" ? null : "button"}
      tabIndex={as === "span" && !directNavigation ? null : 0}
      triggerProps={triggerProps}
    >
      {children}
      <HoverPortal
        anchorRef={anchorRef}
        className={`team-hover-card hover-portal-card ${pinnedOpen ? "touch-open" : ""}`}
        estimatedHeight={290}
        open={open}
        portalRef={cardRef}
      >
        <HoverCardCloseButton onClose={closePinned} />
        <span className="team-hover-head">
          <TeamEmblem team={team} size="md" />
          <span>
            <strong>{team.name}</strong>
            <span className="hover-hashtag">{getTeamHashtag(team)}</span>
            <em>{team.region} · {team.homeCourt}</em>
          </span>
        </span>
        <span className="team-hover-tier">
          <TierEmblem mmr={team.mmr} size="md" />
          <span>
            <b>팀 티어</b>
            <span className="hover-tier-label">{getTierDivision(team.mmr)}</span>
            <em>{Math.round(team.mmr ?? DEFAULT_RATING)} MMR</em>
          </span>
        </span>
        <span className="team-hover-stats">
          <span><b>{team.wins ?? 0}승</b><em>{team.losses ?? 0}패</em></span>
          <span><b>{winRate}%</b><em>승률</em></span>
          <span><b>{rosterCountLabel}</b><em>로스터</em></span>
        </span>
        <Link className="hover-card-action" to={teamPath} state={{ teamPreview: team }} onClick={(event) => {
          event.stopPropagation();
          closePinned();
        }}>팀 보기</Link>
      </HoverPortal>
    </HoverCardTrigger>
  );
}
