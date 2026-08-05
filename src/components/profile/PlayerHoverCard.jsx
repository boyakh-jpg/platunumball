import { Link } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import HoverPortal, { HoverCardCloseButton, HoverCardTrigger } from "../common/HoverPortal.jsx";
import TierEmblem from "../rating/TierEmblem.jsx";
import TeamEmblem from "../team/TeamEmblem.jsx";
import useHoverCardInteraction from "../../hooks/useHoverCardInteraction.js";
import { isDiscordLinked } from "../../lib/discord.js";
import { getTeamHashtag, getUserHashtag } from "../../lib/handles.js";
import { isTouchPreviewEvent } from "../../lib/hoverPreviewPin.js";
import { getAgeGroupForUser, getAgeGroupLabel, getRepresentativeTeam, getUserProfileTeams } from "../../lib/profileSetup.js";
import { getPlacementLabel, hasModeRating, isPlacementComplete } from "../../lib/rating.js";
import { getTierDivision } from "../../lib/tier.js";
import { getTeamRoleLabel, isMercenaryTeamRole, normalizeTeamRole } from "../../lib/constants.js";
import ProfileEmblem from "./ProfileEmblem.jsx";

const rolePriority = {
  captain: 0,
  regular: 1,
  mercenary: 2,
};

function getUserTeams(userId, teams = []) {
  return getUserProfileTeams(userId, teams)
    .sort((a, b) => (rolePriority[normalizeTeamRole(a.myRole)] ?? 9) - (rolePriority[normalizeTeamRole(b.myRole)] ?? 9) || b.mmr - a.mmr);
}

function roleLabel(role) {
  if (role === "captain") return getTeamRoleLabel(role);
  if (isMercenaryTeamRole(role)) return "용병";
  return "정규멤버";
}

export default function PlayerHoverCard({ user, teams = [], children, className = "", as = "link", to }) {
  const cardKey = user?.id ? `player:${user.id}` : "";
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

  if (!user) return children ?? null;

  const anonymousUser = Boolean(user.anonymous || user.participationLabel === "개인참여");
  const userTeams = getUserTeams(user.id, teams);
  const projectedRepresentativeTeam = user.representativeTeam
    ? getUserTeams(user.id, [user.representativeTeam])[0]
    : null;
  const activeTeam = userTeams.find((team) => team.id === user.representativeTeamId)
    ?? projectedRepresentativeTeam
    ?? getRepresentativeTeam(user.id, userTeams, user.representativeTeamId);
  const discordLinked = isDiscordLinked(user);
  const placementComplete = isPlacementComplete(user.ratings);
  const modes = placementComplete
    ? [
        { label: "통합", mode: "", mmr: user.ratings?.integrated },
        ...Object.entries(user.ratings?.modes ?? {}).map(([mode, mmr]) => ({ label: mode, mode, mmr })),
      ]
    : [{ label: "통합", mode: "", mmr: user.ratings?.integrated }];
  const profilePath = to ?? `/app/players/${user.id}`;
  const handleTriggerClick = (event) => {
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
      className={`player-hover-trigger ${className}`}
      onClick={handleTriggerClick}
      onActivate={openPinned}
      onDismiss={() => {
        hideHover();
        closePinned();
      }}
      role={as === "span" ? null : "button"}
      tabIndex={as === "span" ? null : 0}
      triggerProps={triggerProps}
    >
      {children}
      <HoverPortal
        anchorRef={anchorRef}
        className={`player-hover-card hover-portal-card ${pinnedOpen ? "touch-open" : ""}`}
        estimatedHeight={360}
        open={open}
        portalRef={cardRef}
      >
        <HoverCardCloseButton onClose={closePinned} />
        <span className="player-hover-head">
          <ProfileEmblem user={user} anonymous={anonymousUser} />
          <span>
            <span className="player-hover-identity">
              <strong>{user.name}</strong>
              <span className="hover-hashtag">{getUserHashtag(user)}</span>
              <span className="hover-age-group">{getAgeGroupLabel(getAgeGroupForUser(user))}</span>
            </span>
            {discordLinked ? (
              <span className="discord-link-badge" aria-label="Discord 연동됨" title="Discord 연동됨">
                <MessageCircle size={13} aria-hidden="true" />
              </span>
            ) : null}
            <em>{anonymousUser ? `${user.participationLabel ?? "개인참여"} · ${user.position ?? "free"}` : `${user.region} · ${user.position}`} · 신뢰도 {user.trustScore ?? "-"}</em>
          </span>
        </span>
        <span className="player-hover-tier-grid">
          {modes.map(({ label, mode, mmr }) => {
            const modeMissing = Boolean(mode) && !hasModeRating(user.ratings, mode);
            return (
              <span className={`player-hover-tier-row${label === "통합" ? " is-integrated" : ""}`} key={label}>
                {modeMissing ? <span className="rating-card-empty-mark" aria-hidden="true">—</span> : <TierEmblem mmr={Number(mmr)} ratings={user.ratings} size="sm" />}
                <span>
                  <b>{label}</b>
                  <span className="hover-tier-label">
                    {!placementComplete ? getPlacementLabel(user.ratings) : modeMissing ? "기록 없음" : getTierDivision(Number(mmr))}
                  </span>
                </span>
              </span>
            );
          })}
        </span>
        <span className="player-hover-team">
          <b>대표팀</b>
          {activeTeam ? (
            <span>
              <TeamEmblem team={activeTeam} size="xs" />
              <strong>{activeTeam.name}</strong>
              <em>{getTeamHashtag(activeTeam)} · {roleLabel(activeTeam.myRole)}</em>
              <span className="hover-team-tier">
                <TierEmblem mmr={activeTeam.mmr} size="sm" />
                <span className="hover-tier-label">{getTierDivision(activeTeam.mmr)}</span>
              </span>
            </span>
          ) : (
            <em>없음</em>
          )}
        </span>
        <Link className="ui-compact-action hover-card-action" to={profilePath} state={{ playerPreview: user }} onClick={(event) => {
          event.stopPropagation();
          closePinned();
        }}>프로필 보기</Link>
      </HoverPortal>
    </HoverCardTrigger>
  );
}
