import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import HoverPortal from "../common/HoverPortal.jsx";
import TierEmblem from "../rating/TierEmblem.jsx";
import TeamEmblem from "./TeamEmblem.jsx";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import { getTeamHashtag } from "../../lib/handles.js";
import { canUseHoverPreview, clearPinnedHoverPreview, getPinnedHoverPreviewKey, isTouchPreviewEvent, pinHoverPreview, subscribePinnedHoverPreview } from "../../lib/hoverPreviewPin.js";
import { getTierDivision } from "../../lib/tier.js";
import { DEFAULT_RATING } from "../../lib/constants.js";

export default function TeamHoverCard({ team, children, className = "", as = "link", to, directNavigation = false }) {
  const navigate = useNavigate();
  const [hoverOpen, setHoverOpen] = useState(false);
  const [touchOpen, setTouchOpen] = useState(false);
  const [pinnedHoverKey, setPinnedHoverKey] = useState(getPinnedHoverPreviewKey);
  const anchorRef = useRef(null);
  const cardRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressOpenedRef = useRef(false);
  const cardKey = team?.id ? `team:${team.id}` : "";
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

  if (!team) {
    return <span className={className}>{children}</span>;
  }

  const teamPath = to ?? `/app/teams/${team.id}`;
  const props = directNavigation
    ? { role: "link", tabIndex: 0 }
    : as === "span" ? {} : { role: "button", tabIndex: 0 };
  const played = Number(team.wins ?? 0) + Number(team.losses ?? 0);
  const winRate = played ? Math.round((Number(team.wins ?? 0) / played) * 100) : 0;
  const memberCount = Number(team.memberCount);
  const rosterCountLabel = Number.isInteger(memberCount) && memberCount >= 0
    ? `${memberCount}명`
    : team.membersPartial === true ? "확인 필요" : `${team.members?.length ?? 0}명`;
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
    if (directNavigation) {
      event.preventDefault();
      event.stopPropagation();
      if (longPressOpenedRef.current) {
        longPressOpenedRef.current = false;
        return;
      }
      closeTouch();
      navigate(teamPath);
      return;
    }
    if (as === "span" && !isTouchPreviewEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (longPressOpenedRef.current) {
      longPressOpenedRef.current = false;
      return;
    }
    if (touchOpen) {
      closeTouch();
      return;
    }
    openPinned();
  };
  const open = touchOpen || (!pinnedHoverKey && canUseHoverPreview() && hoverOpen);

  return (
    <span
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
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          if (directNavigation) {
            closeTouch();
            navigate(teamPath);
          } else {
            openPinned();
          }
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
        <button type="button" className="hover-card-close" aria-label="닫기" onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closeTouch();
        }}>X</button>
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
        <Link className="hover-card-action" to={teamPath} onClick={(event) => {
          event.stopPropagation();
          closeTouch();
        }}>팀 보기</Link>
      </HoverPortal>
    </span>
  );
}
