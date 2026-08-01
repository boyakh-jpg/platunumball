import {
  createPortal,
} from "react-dom";

import {
  X,
} from "lucide-react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import {
  PLAYER_POSITIONS,
  SIDE_LABEL_TEXT as SIDE_LABELS,
} from "../../lib/constants.js";
import {
  getPartyOptionKey,
  getPartyOptionLabel,
  isPartyEntry,
} from "./RecruitingRoomSlotCore.jsx";



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
  pending = false,
  onMoveHere,
  onJoinParty,
  onClose,
  children,
}) {
  return (
    <CommandPopoverFrame floating={floating} anchor={anchor} className="arena-slot-command-popover" onClose={pending ? null : onClose}>
      <header>
        <div>
          <strong>{poolMode ? "참가자 초대" : `${SIDE_LABELS[sideName]} ${reserve ? "후보 슬롯" : "빈 슬롯"}`}</strong>
          <span>{poolMode ? "픽업 참가자 풀의 빈자리에 선수를 초대합니다." : "이 자리로 이동하거나 선수를 초대할 수 있습니다."}</span>
        </div>
        <button type="button" className="arena-icon-button" aria-label="닫기" disabled={pending} onClick={onClose}><X size={16} /></button>
      </header>
      {!poolMode ? (
        <div className="arena-slot-command-actions">
          <Button type="button" size="sm" variant="secondary" disabled={pending || !canMoveHere} onClick={onMoveHere}>
            {pending ? "처리 중" : "이 자리로 이동"}
          </Button>
          {partyJoinOptions.map((option) => (
            <Button key={getPartyOptionKey(option)} type="button" size="sm" variant="secondary" disabled={pending} onClick={() => onJoinParty(option.team.id, option.entry?.id)}>
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
  pending = false,
  onPositionChange,
  onLeaveParty,
  onJoinParty,
  onClose,
  children,
}) {
  const inParty = isPartyEntry(entry);
  const fromParty = Boolean(!inParty && sourceTeam);
  const partyText = entry?.kind === "team" && entry?.team
    ? `${entry.team.name} ${inParty ? "파티 연결됨" : "팀 참여 중"}`
    : fromParty
      ? `${sourceTeam.name} 파티에서 나와 개인 참여 중`
      : "개인 참여 중";
  const safeCurrentPosition = PLAYER_POSITIONS.includes(currentPosition) ? currentPosition : PLAYER_POSITIONS[0];

  return (
    <CommandPopoverFrame floating anchor={anchor} className="arena-slot-command-popover arena-self-slot-popover" onClose={pending ? null : onClose}>
      <header>
        <div>
          <strong>{heading}</strong>
          <span>{SIDE_LABELS[sideName]} · {reserve ? "후보" : "출전"} · {partyText}</span>
        </div>
        <button type="button" className="arena-icon-button" aria-label="닫기" disabled={pending} onClick={onClose}><X size={16} /></button>
      </header>
      <div className="arena-self-slot-status">
        <Badge tone={inParty ? "green" : fromParty ? "orange" : "neutral"}>{partyText}</Badge>
      </div>
      {onPositionChange ? (
        <label className="arena-self-position-control">
          <span>슬롯 포지션</span>
          <select disabled={pending} value={safeCurrentPosition} onChange={(event) => onPositionChange(event.target.value)}>
            {PLAYER_POSITIONS.map((position) => <option key={position} value={position}>{position}</option>)}
          </select>
        </label>
      ) : null}
      {children}
      <div className="arena-slot-command-actions">
        {canLeaveParty ? (
          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={onLeaveParty}>
            {pending ? "처리 중" : "파티 나가기"}
          </Button>
        ) : null}
        {partyJoinOptions.map((option) => (
          <Button key={getPartyOptionKey(option)} type="button" size="sm" variant="secondary" disabled={pending} onClick={() => onJoinParty(option.team.id, option.entry?.id)}>
            {getPartyOptionLabel(option)} 파티 합류
          </Button>
        ))}
      </div>
    </CommandPopoverFrame>
  );
}
