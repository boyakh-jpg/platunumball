import {
  useEffect,
  useState,
} from "react";
import {
  createPortal,
} from "react-dom";

import {
  Crown,
  UserRound,
  X,
} from "lucide-react";
import Badge from "../common/Badge.jsx";
import BasketballLoader from "../common/BasketballLoader.jsx";
import Button from "../common/Button.jsx";
import {
  MatchListSummary,
} from "../match/MatchListCard.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import {
  getTierEmblemSrc,
} from "../rating/TierEmblem.jsx";
import {
  DEFAULT_RATING,
  MATCH_SIDES,
  MAX_RECRUITING_RESERVES_PER_SIDE as MAX_RESERVE_PLAYERS_PER_SIDE,
  PLAYER_POSITIONS,
  SIDE_LABEL_TEXT as SIDE_LABELS,
} from "../../lib/constants.js";
import {
  isPlacementComplete,
} from "../../lib/rating.js";

import {
  getRecruitingBenchCapacity,
  getRecruitingEntryLeaderId,
  getRecruitingListCardCounts,
  getRecruitingRoomOwnerId,
  getRecruitingPostTerminalState,
  getSelectableTeamPlayerIds,
  isRecruitingPartyEntry,
  isRecruitingTeamEntry,
  isTeamRecruitingRoom,
} from "../../lib/recruiting.js";

import {
  getMatchReservePlayerIds,
  getMatchSidePlayerIds,
  getPublicRoomTimingStatus,
} from "../../lib/matchUtils.js";
import {
  getMatchRuleSummary,
} from "../../lib/matchRules.js";

function CommandPopoverFrame({ floating = false, anchor = null, className = "", onClose, children }) {
  const anchored = Boolean(floating && anchor);
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const panelWidth = anchored
    ? Math.min(Math.max(Number(anchor.width) || 0, 520), Math.max(240, viewportWidth - 24))
    : null;
  const panelX = anchored
    ? Math.min(
      Math.max(Number(anchor.x) || viewportWidth / 2, 12 + panelWidth / 2),
      Math.max(12 + panelWidth / 2, viewportWidth - 12 - panelWidth / 2),
    )
    : null;
  const panelClassName = [
    className,
    floating ? "floating" : "",
    anchored ? "anchored" : "",
    anchored && anchor.placement === "top" ? "above" : "",
    anchored && anchor.placement !== "top" ? "below" : "",
  ].filter(Boolean).join(" ");
  const panelStyle = anchored
    ? {
        "--popover-x": `${panelX}px`,
        "--popover-y": `${anchor.y}px`,
        "--popover-width": `${panelWidth}px`,
      }
    : undefined;
  const panel = (
    <div
      className={panelClassName}
      style={panelStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );

  if (!floating) return panel;

  const popover = (
    <div className="arena-slot-popover-backdrop" role="presentation" onPointerDown={(event) => {
      event.stopPropagation();
      onClose?.();
    }}>
      {panel}
    </div>
  );

  if (typeof document === "undefined") return popover;
  return createPortal(popover, document.body);
}

export function SlotCommandPanel({
  sideName,
  reserve = false,
  floating = false,
  anchor = null,
  canMoveHere = false,
  partyJoinOptions = [],
  poolMode = false,
  onMoveHere,
  onJoinParty,
  onClose,
  children,
}) {
  return (
    <CommandPopoverFrame floating={floating} anchor={anchor} className="arena-slot-command-popover" onClose={onClose}>
      <header>
        <div>
          <strong>{poolMode ? "참가자 초대" : `${SIDE_LABELS[sideName]} ${reserve ? "후보 슬롯" : "빈 슬롯"}`}</strong>
          <span>{poolMode ? "픽업 참가자 풀의 빈자리에 선수를 초대합니다." : "이 자리로 이동하거나 선수를 초대할 수 있습니다."}</span>
        </div>
        <button type="button" className="arena-icon-button" aria-label="닫기" onClick={onClose}><X size={16} /></button>
      </header>
      {!poolMode ? (
        <div className="arena-slot-command-actions">
          <Button type="button" size="sm" variant="secondary" disabled={!canMoveHere} onClick={onMoveHere}>
            이 자리로 이동
          </Button>
          {partyJoinOptions.map((option) => (
            <Button key={getPartyOptionKey(option)} type="button" size="sm" variant="secondary" onClick={() => onJoinParty(option.team.id, option.entry?.id)}>
              {partyJoinOptions.length === 1 ? "파티 새로고침" : `${getPartyOptionLabel(option)} 파티 새로고침`}
            </Button>
          ))}
        </div>
      ) : null}
      {children}
    </CommandPopoverFrame>
  );
}

export function SelfSlotCommandPanel({
  entry,
  sideName,
  reserve = false,
  sourceTeam = null,
  anchor = null,
  heading = "내 슬롯 관리",
  canLeaveParty = false,
  partyJoinOptions = [],
  currentPosition = "",
  onPositionChange,
  onLeaveParty,
  onJoinParty,
  onClose,
  children,
}) {
  const inParty = isPartyEntry(entry);
  const fromParty = Boolean(!inParty && sourceTeam);
  const partyText = inParty && entry?.team
    ? `${entry.team.name} 파티 연결됨`
    : fromParty
      ? `${sourceTeam.name} 파티에서 나와 개인 참여 중`
      : "개인 참여 중";
  const safeCurrentPosition = PLAYER_POSITIONS.includes(currentPosition) ? currentPosition : PLAYER_POSITIONS[0];

  return (
    <CommandPopoverFrame floating anchor={anchor} className="arena-slot-command-popover arena-self-slot-popover" onClose={onClose}>
      <header>
        <div>
          <strong>{heading}</strong>
          <span>{SIDE_LABELS[sideName]} · {reserve ? "후보" : "출전"} · {partyText}</span>
        </div>
        <button type="button" className="arena-icon-button" aria-label="닫기" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="arena-self-slot-status">
        <Badge tone={inParty ? "green" : fromParty ? "orange" : "neutral"}>{partyText}</Badge>
      </div>
      {onPositionChange ? (
        <label className="arena-self-position-control">
          <span>슬롯 포지션</span>
          <select value={safeCurrentPosition} onChange={(event) => onPositionChange(event.target.value)}>
            {PLAYER_POSITIONS.map((position) => <option key={position} value={position}>{position}</option>)}
          </select>
        </label>
      ) : null}
      {children}
      <div className="arena-slot-command-actions">
        {canLeaveParty ? (
          <Button type="button" size="sm" variant="secondary" onClick={onLeaveParty}>
            파티 나가기
          </Button>
        ) : null}
        {partyJoinOptions.map((option) => (
          <Button key={getPartyOptionKey(option)} type="button" size="sm" variant="secondary" onClick={() => onJoinParty(option.team.id, option.entry?.id)}>
            {getPartyOptionLabel(option)} 파티 합류
          </Button>
        ))}
      </div>
    </CommandPopoverFrame>
  );
}
