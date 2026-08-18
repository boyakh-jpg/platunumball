import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import HoverPortal, { HoverCardCloseButton, HoverCardTrigger } from "../common/HoverPortal.jsx";
import TierEmblem from "../rating/TierEmblem.jsx";
import TeamEmblem from "../team/TeamEmblem.jsx";
import useHoverCardInteraction from "../../hooks/useHoverCardInteraction.js";
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

export default function PlayerHoverCard({ user, teams = [], children, className = "", as = "link", to, contactContext = null, resolveContact = null }) {
  const [contact, setContact] = useState(null);
  const [contactState, setContactState] = useState("idle");
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

  useEffect(() => {
    setContact(null);
    setContactState("idle");
  }, [contactContext?.id, contactContext?.kind, user?.id]);

  if (!user) return children ?? null;

  const anonymousUser = Boolean(user.anonymous || user.participationLabel === "개인참여");
  const userTeams = getUserTeams(user.id, teams);
  const projectedRepresentativeTeam = user.representativeTeam
    ? getUserTeams(user.id, [user.representativeTeam])[0]
    : null;
  const activeTeam = userTeams.find((team) => team.id === user.representativeTeamId)
    ?? projectedRepresentativeTeam
    ?? getRepresentativeTeam(user.id, userTeams, user.representativeTeamId);
  const placementComplete = isPlacementComplete(user.ratings);
  const modes = placementComplete
    ? [
        { label: "통합", mode: "", mmr: user.ratings?.integrated },
        ...Object.entries(user.ratings?.modes ?? {}).map(([mode, mmr]) => ({ label: mode, mode, mmr })),
      ]
    : [{ label: "통합", mode: "", mmr: user.ratings?.integrated }];
  const profilePath = to ?? `/app/players/${user.id}`;
  const handleResolveContact = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!contactContext || !resolveContact || contactState === "loading") return;
    setContactState("loading");
    const result = await resolveContact("/api/contacts/resolve", {
      targetProfileId: user.id,
      context: contactContext,
    });
    if (!result || result.ok === false) {
      setContactState("error");
      return;
    }
    setContact(result.contact ?? null);
    setContactState(result.contact ? "ready" : "empty");
  };
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
        {contactContext && resolveContact ? (
          <span className="player-hover-contact">
            {contact?.kind === "kakao" ? (
              <a className="ui-compact-action hover-card-action" href={contact.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>카카오톡 연락</a>
            ) : (
              <button type="button" className="ui-compact-action hover-card-action" disabled={contactState === "loading"} onClick={handleResolveContact}>
                {contactState === "loading" ? "확인 중" : "연락 방법 확인"}
              </button>
            )}
            {contactState === "empty" ? <em>공개된 연락 방법 없음</em> : null}
            {contactState === "error" ? <em>연락 방법을 확인하지 못했습니다.</em> : null}
          </span>
        ) : null}
        <Link className="ui-compact-action hover-card-action" to={profilePath} state={{ playerPreview: user }} onClick={(event) => {
          event.stopPropagation();
          closePinned();
        }}>프로필 보기</Link>
      </HoverPortal>
    </HoverCardTrigger>
  );
}
