import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import HoverPortal from "../common/HoverPortal.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import TierEmblem from "../rating/TierEmblem.jsx";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import { getTeamHashtag } from "../../lib/handles.js";

function isTouchPreviewEvent(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  return typeof window !== "undefined" && window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function canUseHoverPreview() {
  return typeof window === "undefined" || !window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

export default function TeamHoverCard({ team, children, className = "", as = "link", to }) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [touchOpen, setTouchOpen] = useState(false);
  const anchorRef = useRef(null);
  const cardRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressOpenedRef = useRef(false);
  useBodyScrollLock(touchOpen);

  useEffect(() => () => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
  }, []);

  useEffect(() => {
    if (!touchOpen) return undefined;

    const closeOutside = (event) => {
      const target = event.target;
      if (anchorRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      setTouchOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setTouchOpen(false);
    };

    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [touchOpen]);

  if (!team) {
    if (as === "span") return <span className={className}>{children}</span>;
    return to ? <Link className={className} to={to}>{children}</Link> : children ?? null;
  }

  const Component = as === "span" ? "span" : Link;
  const teamPath = to ?? `/app/teams/${team.id}`;
  const props = as === "span" ? {} : { to: teamPath };
  const played = Number(team.wins ?? 0) + Number(team.losses ?? 0);
  const winRate = played ? Math.round((Number(team.wins ?? 0) / played) * 100) : 0;
  const showHover = () => {
    if (canUseHoverPreview()) setHoverOpen(true);
  };
  const hideHover = () => setHoverOpen(false);
  const closeTouch = () => setTouchOpen(false);
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
      setHoverOpen(false);
      setTouchOpen(true);
    }, 420);
  };
  const handleTriggerClick = (event) => {
    if (!isTouchPreviewEvent(event)) return;
    if (longPressOpenedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      longPressOpenedRef.current = false;
      return;
    }
    if (as === "span") {
      event.preventDefault();
      event.stopPropagation();
      setTouchOpen(true);
    }
  };
  const open = touchOpen || (canUseHoverPreview() && hoverOpen);

  return (
    <Component
      ref={anchorRef}
      className={`team-hover-trigger ${className}`}
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
        className={`team-hover-card hover-portal-card ${touchOpen ? "touch-open" : ""}`}
        estimatedHeight={290}
        open={open}
        portalRef={cardRef}
      >
        <button type="button" className="hover-card-close" onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closeTouch();
        }}>닫기</button>
        <span className="team-hover-head">
          <span className="team-emblem" style={{ "--team-color": team.accent }}>{team.name.slice(0, 1)}</span>
          <span>
            <strong>{team.name}</strong>
            <span className="hover-hashtag">{getTeamHashtag(team)}</span>
            <em>{team.region} · {team.homeCourt}</em>
          </span>
        </span>
        <span className="team-hover-tier">
          <TierEmblem mmr={team.mmr} size="md" showLabel />
          <span>
            <b>팀 티어</b>
            <TierBadge mmr={team.mmr} compact />
            <em>{Math.round(team.mmr ?? 1200)} MMR</em>
          </span>
        </span>
        <span className="team-hover-stats">
          <span><b>{team.wins ?? 0}승</b><em>{team.losses ?? 0}패</em></span>
          <span><b>{winRate}%</b><em>승률</em></span>
          <span><b>{team.members?.length ?? 0}명</b><em>로스터</em></span>
        </span>
        <Link className="hover-card-action" to={teamPath} onClick={(event) => {
          event.stopPropagation();
          closeTouch();
        }}>팀 보기</Link>
      </HoverPortal>
    </Component>
  );
}
