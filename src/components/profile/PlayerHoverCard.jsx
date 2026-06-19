import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import HoverPortal from "../common/HoverPortal.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import TierEmblem from "../rating/TierEmblem.jsx";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import { getTeamHashtag, getUserHashtag } from "../../lib/handles.js";
import { clearPinnedHoverPreview, getPinnedHoverPreviewKey, pinHoverPreview, subscribePinnedHoverPreview } from "../../lib/hoverPreviewPin.js";
import { getAgeGroupForUser, getAgeGroupLabel } from "../../lib/profileSetup.js";

const rolePriority = {
  captain: 0,
  regular: 1,
  candidate: 1,
  substitute: 1,
  mercenary: 2,
  guest: 3,
};

function getUserTeams(userId, teams = []) {
  return teams
    .map((team) => {
      const member = team.members?.find((item) => item.userId === userId);
      return member ? { ...team, myRole: member.role } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (rolePriority[a.myRole] ?? 9) - (rolePriority[b.myRole] ?? 9) || b.mmr - a.mmr);
}

function roleLabel(role) {
  if (role === "captain") return "주장";
  if (role === "regular" || role === "candidate" || role === "substitute") return "팀원";
  if (role === "mercenary" || role === "guest") return "용병";
  return "팀원";
}

function isTouchPreviewEvent(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  return typeof window !== "undefined" && window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function canUseHoverPreview() {
  return typeof window === "undefined" || !window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

export default function PlayerHoverCard({ user, teams = [], children, className = "", as = "link", to }) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [touchOpen, setTouchOpen] = useState(false);
  const [pinnedHoverKey, setPinnedHoverKey] = useState(getPinnedHoverPreviewKey);
  const anchorRef = useRef(null);
  const cardRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressOpenedRef = useRef(false);
  const cardKey = user?.id ? `player:${user.id}` : "";
  useBodyScrollLock(touchOpen);

  const openPinned = () => {
    setHoverOpen(false);
    pinHoverPreview(cardKey);
    setTouchOpen(true);
  };
  const closeTouch = () => {
    setTouchOpen(false);
    clearPinnedHoverPreview(cardKey);
  };

  useEffect(() => subscribePinnedHoverPreview(setPinnedHoverKey), []);

  useEffect(() => {
    if (touchOpen && pinnedHoverKey && pinnedHoverKey !== cardKey) setTouchOpen(false);
  }, [cardKey, pinnedHoverKey, touchOpen]);

  useEffect(() => () => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    clearPinnedHoverPreview(cardKey);
  }, [cardKey]);

  useEffect(() => {
    if (!touchOpen) return undefined;

    const closeOutside = (event) => {
      const target = event.target;
      if (anchorRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      closeTouch();
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeTouch();
    };

    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [cardKey, touchOpen]);

  if (!user) return children ?? null;

  const userTeams = getUserTeams(user.id, teams);
  const activeTeam = userTeams[0];
  const modes = [
    ["통합", user.ratings?.integrated],
    ...Object.entries(user.ratings?.modes ?? {}),
  ].filter(([, mmr]) => Number.isFinite(Number(mmr)));
  const profilePath = to ?? `/app/players/${user.id}`;
  const props = as === "span" ? {} : { role: "button", tabIndex: 0 };
  const showHover = () => {
    if (canUseHoverPreview() && !pinnedHoverKey) setHoverOpen(true);
  };
  const hideHover = () => setHoverOpen(false);
  const clearLongPress = () => {
    if (!longPressTimerRef.current) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };
  const handlePointerDown = (event) => {
    if (!isTouchPreviewEvent(event)) return;
    clearLongPress();
    setHoverOpen(false);
    longPressOpenedRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressOpenedRef.current = true;
      openPinned();
    }, 420);
  };
  const handleTriggerClick = (event) => {
    if (as === "span" && !isTouchPreviewEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (longPressOpenedRef.current) {
      longPressOpenedRef.current = false;
      return;
    }
    openPinned();
  };
  const open = touchOpen || (!pinnedHoverKey && canUseHoverPreview() && hoverOpen);

  return (
    <span
      ref={anchorRef}
      className={`player-hover-trigger ${className}`}
      onBlur={hideHover}
      onClick={handleTriggerClick}
      onContextMenu={(event) => {
        if (isTouchPreviewEvent(event)) event.preventDefault();
      }}
      onFocus={showHover}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          hideHover();
          closeTouch();
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          openPinned();
        }
      }}
      onMouseEnter={showHover}
      onMouseLeave={hideHover}
      onPointerCancel={clearLongPress}
      onPointerDown={handlePointerDown}
      onPointerLeave={clearLongPress}
      onPointerUp={clearLongPress}
      onDragStart={(event) => {
        if (isTouchPreviewEvent(event)) event.preventDefault();
      }}
      {...props}
    >
      {children}
      <HoverPortal
        anchorRef={anchorRef}
        className={`player-hover-card hover-portal-card ${touchOpen ? "touch-open" : ""}`}
        estimatedHeight={360}
        open={open}
        portalRef={cardRef}
      >
        <button type="button" className="hover-card-close" onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closeTouch();
        }}>닫기</button>
        <span className="player-hover-head">
          <span className="avatar" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
          <span>
            <strong>{user.name}</strong>
            <span className="hover-hashtag">{getUserHashtag(user)}</span>
            <span className="hover-age-group">{getAgeGroupLabel(getAgeGroupForUser(user))}</span>
            <em>{user.region} · {user.position} · 신뢰도 {user.trustScore ?? "-"}</em>
          </span>
        </span>
        <span className="player-hover-tier-grid">
          {modes.map(([mode, mmr]) => (
            <span className="player-hover-tier-row" key={mode}>
              <TierEmblem mmr={Number(mmr)} size="sm" />
              <span>
                <b>{mode}</b>
                <TierBadge mmr={Number(mmr)} compact />
              </span>
            </span>
          ))}
        </span>
        <span className="player-hover-team">
          <b>활성 팀</b>
          {activeTeam ? (
            <span>
              <i style={{ "--team-color": activeTeam.accent }} />
              <strong>{activeTeam.name}</strong>
              <em>{getTeamHashtag(activeTeam)} · {roleLabel(activeTeam.myRole)}</em>
              <TierBadge mmr={activeTeam.mmr} compact />
            </span>
          ) : (
            <em>없음</em>
          )}
        </span>
        <Link className="hover-card-action" to={profilePath} onClick={(event) => {
          event.stopPropagation();
          closeTouch();
        }}>프로필 보기</Link>
      </HoverPortal>
    </span>
  );
}
