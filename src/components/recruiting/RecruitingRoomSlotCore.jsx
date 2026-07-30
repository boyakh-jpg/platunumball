import {
  useEffect,
  useState,
} from "react";

import {
  Crown,
  UserRound,
  X,
} from "lucide-react";
import Badge from "../common/Badge.jsx";
import BasketballLoader from "../common/BasketballLoader.jsx";
import Button from "../common/Button.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import {
  getTierEmblemSrc,
} from "../rating/TierEmblem.jsx";
import {
  DEFAULT_RATING,
  MATCH_SIDES,
  PLAYER_POSITIONS,
  SIDE_LABEL_TEXT as SIDE_LABELS,
} from "../../lib/constants.js";
import {
  isPlacementComplete,
} from "../../lib/rating.js";
import {
  assetUrl,
} from "../../lib/assets.js";

import {
  getRecruitingBenchCapacity,
  getRecruitingEntryLeaderId,
  getRecruitingRoomOwnerId,
  getRecruitingPostTerminalState,
  isRecruitingPartyEntry,
  isRecruitingTeamEntry,
} from "../../lib/recruiting.js";

import {
  getMatchReservePlayerIds,
  getMatchSidePlayerIds,
  getPublicRoomTimingStatus,
} from "../../lib/matchUtils.js";
import {
  getProfileAvatarInitial,
  isAnonymousDisplayUser,
} from "../../../shared/lib/profileMappers.js";

export function RecruitingRoomLoadingView({ onClose }) {
  return (
    <div className="arena-modal-backdrop arena-room-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="arena-room-modal ui-room-borderless-scope" role="dialog" aria-modal="true" aria-label="방 불러오는 중" onMouseDown={(event) => event.stopPropagation()}>
        <div className="arena-modal-status-row">
          <Badge tone="orange">ROOM LOAD</Badge>
          <button type="button" className="arena-icon-button" aria-label="닫기" onClick={onClose}><X size={18} /></button>
        </div>
        <BasketballLoader label="방 불러오는 중" />
        <div className="arena-modal-close-row">
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>방 닫기</Button>
        </div>
      </aside>
    </div>
  );
}

export const RECRUITING_FILTER_PAGE_LIMIT = 50;
export const RECRUITING_FILTER_DEBOUNCE_MS = 250;

export function useDebouncedValue(value, delayMs) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timerId = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timerId);
  }, [delayMs, value]);

  return debouncedValue;
}

export function getEntryMmr(entry) {
  return isRecruitingTeamEntry(entry)
    ? entry.team?.mmr ?? entry.user?.ratings?.integrated ?? DEFAULT_RATING
    : entry.user?.ratings?.integrated ?? DEFAULT_RATING;
}

export function getLobbySideMeta(lobby, sideName, userById, { useSideName = false } = {}) {
  const side = lobby.sides[sideName];
  const teamEntry = side.entries.find((entry) => isRecruitingTeamEntry(entry) && entry.team);
  const leadEntry = teamEntry ?? side.entries[0] ?? null;
  const playerMmrs = side.projectedPlayers
    .map((playerId) => userById[playerId]?.ratings?.integrated)
    .filter((value) => Number.isFinite(Number(value)));
  const avgMmr = playerMmrs.length
    ? Math.round(playerMmrs.reduce((sum, value) => sum + Number(value), 0) / playerMmrs.length)
    : 0;

  return {
    name: useSideName ? SIDE_LABELS[sideName] : leadEntry?.team?.name ?? leadEntry?.user?.name ?? SIDE_LABELS[sideName],
    mmr: useSideName ? avgMmr : leadEntry?.team?.mmr ?? avgMmr,
    label: sideName === "teamA" ? "HOME TEAM" : "OPPONENT",
  };
}

export function getPlayerPosition(user) {
  return user?.position || "포지션 자유";
}

const ROOM_SLOT_POSITION_AVATARS = {
  PG: assetUrl("/assets/position-avatars/PG.webp"),
  SG: assetUrl("/assets/position-avatars/SG.webp"),
  SF: assetUrl("/assets/position-avatars/SF.webp"),
  PF: assetUrl("/assets/position-avatars/PF.webp"),
  C: assetUrl("/assets/position-avatars/C.webp"),
};

function getRoomSlotPositionAvatarSrc(position) {
  const normalizedPosition = String(position ?? "").trim().toUpperCase();
  return ROOM_SLOT_POSITION_AVATARS[normalizedPosition] ?? null;
}

export function getRoomSlotDisplayPosition(user, slotPositions = {}, playerId = user?.id, entry = null) {
  const position = slotPositions[playerId] ?? (entry?.kind === "player" ? entry.position : null) ?? user?.position ?? PLAYER_POSITIONS[0];
  return PLAYER_POSITIONS.includes(position) ? position : PLAYER_POSITIONS[0];
}

export function getPartyOptionLabel(option) {
  const leader = option.entry?.user?.name ? ` · ${option.entry.user.name}` : "";
  return `${option.team.name}${leader}`;
}

export function getPartyOptionKey(option) {
  return `${option.sideName}-${option.team.id}-${option.entry?.id ?? "entry"}`;
}

function RoomSlotAvatar({ user, mmr = DEFAULT_RATING, position = null }) {
  const [failed, setFailed] = useState(false);
  const normalizedPosition = String(position ?? user?.position ?? "").trim().toUpperCase();
  const avatarSrc = getRoomSlotPositionAvatarSrc(normalizedPosition);

  const initial = getProfileAvatarInitial(user, "?");

  if (isAnonymousDisplayUser(user)) {
    return <span className="avatar anonymous" style={{ "--avatar": user?.avatarColor }}>{initial}</span>;
  }

  if (!avatarSrc || failed) {
    return <span className="avatar" style={{ "--avatar": user?.avatarColor }}>{initial}</span>;
  }

  return (
    <span
      className="avatar arena-position-avatar"
      data-position={normalizedPosition}
      data-tier-state={isPlacementComplete(user?.ratings) ? "placed" : "placement"}
      style={{ "--avatar": user?.avatarColor }}
    >
      <img
        className="arena-position-avatar-tier"
        src={getTierEmblemSrc(user?.ratings?.integrated ?? mmr, user?.ratings)}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={(event) => {
          event.currentTarget.hidden = true;
        }}
      />
      <img
        className="arena-position-avatar-player"
        src={avatarSrc}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

const ROOM_SLOT_BADGES = {
  host: { tone: "host", label: "방장" },
  sideLeader: { tone: "captain", label: "사이드장" },
  partyLeader: { tone: "captain", label: "파티장" },
};

export function getEntryPartyLeaderId(entry, hostPlayerId = "", roomState = {}) {
  return getRecruitingEntryLeaderId(entry, roomState, hostPlayerId);
}

export function getRecruitingSideLeaderId(lobby = {}, sideName = "", hostPlayerId = "", roomState = {}) {
  const side = lobby.sides?.[sideName];
  const entry = side?.entries?.find((item) => isPartyEntry(item)) ?? side?.entries?.[0] ?? null;
  const reserveEntryId = side?.reserveCandidates?.[0]?.entryId ?? "";
  const fallbackEntry = reserveEntryId ? lobby.entries?.find((item) => item.id === reserveEntryId) ?? null : null;
  const targetEntry = entry ?? fallbackEntry;
  if (!targetEntry) return "";
  const rosterIds = uniqueIds([...(targetEntry.players ?? []), ...(targetEntry.reserves ?? [])]);
  const leaderId = getEntryPartyLeaderId(targetEntry, hostPlayerId, roomState);
  return rosterIds.includes(leaderId) ? leaderId : rosterIds[0] ?? "";
}

export function getRoomSlotBadge(playerId, entry, hostPlayerId, showCaptainBadge = false, roomState = {}, options = {}) {
  const showPartyBadge = options.showPartyBadge !== false;
  const sideLeaderId = options.sideLeaderId ?? "";
  if (!playerId) return null;
  if (playerId === hostPlayerId) return ROOM_SLOT_BADGES.host;
  if (sideLeaderId && sideLeaderId === playerId) return ROOM_SLOT_BADGES.sideLeader;
  if (!showCaptainBadge || !showPartyBadge) return null;
  if (isPartyEntry(entry) && getEntryPartyLeaderId(entry, hostPlayerId, roomState) === playerId) return ROOM_SLOT_BADGES.partyLeader;
  return null;
}

function uniqueIds(ids = []) {
  return Array.from(new Set(ids.filter(Boolean)));
}

export function getMissingStartAttendanceIds(match = {}, operatorId = "") {
  const attendance = match.attendance ?? {};
  return MATCH_SIDES.flatMap((sideName) => (
    uniqueIds([...getMatchSidePlayerIds(match, sideName), ...getMatchReservePlayerIds(match, sideName)])
      .filter((playerId) => playerId !== operatorId)
      .filter((playerId) => !(attendance[sideName] ?? []).includes(playerId))
  ));
}

export function canMovePlayerTo(post, lobby, playerId, sideName, reserve = false) {
  const side = lobby.sides[sideName];
  if (!side) return false;
  if (reserve) return side.reserves.includes(playerId) || side.reserveCandidates.length < getRecruitingBenchCapacity(post);
  return side.projectedPlayers.includes(playerId) || side.projectedFilled < side.capacity;
}

export function getEntryPlayerReserveState(entry, playerId) {
  if (!entry || !playerId) return false;
  if (entry.reserve) return true;
  return (entry.reserves ?? []).includes(playerId) && !(entry.players ?? []).includes(playerId);
}

export function getSameSidePartyOptions(lobby, myEntry, myTeams = [], targetSide = myEntry?.side) {
  if (!myEntry || myEntry.kind === "team") return [];
  const sideEntries = lobby.sides[targetSide]?.entries ?? [];
  return myTeams.flatMap((team) => {
    const memberIds = new Set((team.members ?? []).map((member) => member.userId));
    return sideEntries
      .filter((entry) => (
      entry.id !== myEntry.id &&
      (
        entry.team?.id === team.id ||
        (entry.kind === "player" && memberIds.has(entry.playerId))
      )
      ))
      .map((entry) => ({ team, entry, sideName: targetSide }));
  });
}

export function getJoinableSidePartyOptions(lobby, myTeams = [], currentUserId = "", targetSide = "") {
  const sides = MATCH_SIDES.filter((sideName) => !targetSide || sideName === targetSide);
  return sides.flatMap((sideName) => {
    const sideEntries = lobby.sides[sideName]?.entries ?? [];
    return myTeams.flatMap((team) => {
      const memberIds = new Set((team.members ?? []).map((member) => member.userId));
      const hasCurrentUser = memberIds.has(currentUserId);
      if (!hasCurrentUser) return [];
      return sideEntries
        .filter((entry) => (
        ![entry.playerId, ...(entry.players ?? []), ...(entry.reserves ?? [])].includes(currentUserId) &&
        (
          entry.team?.id === team.id ||
          (entry.kind === "player" && memberIds.has(entry.playerId))
        )
        ))
        .map((entry) => ({ team, entry, sideName }));
    });
  });
}

export function isPartyEntry(entry) {
  return isRecruitingPartyEntry(entry);
}

function getEntryTeamGroupId(entry) {
  return entry?.team?.id ?? entry?.teamId ?? entry?.sourceTeamId ?? "";
}

export function getLobbyPrimaryTeamId(lobby, sideName) {
  const teamEntry = lobby.sides?.[sideName]?.entries?.find((entry) => getEntryTeamGroupId(entry));
  return getEntryTeamGroupId(teamEntry);
}

export function getRoomSlotTeamName(entry, teams = []) {
  const teamId = getEntryTeamGroupId(entry);
  return entry?.team?.name
    ?? teams.find((team) => team.id === teamId)?.name
    ?? "개인 참여";
}

export function getVisualPartyKey(entry, sideName = "") {
  const teamId = getEntryTeamGroupId(entry);
  if (!teamId) return "";
  return isPartyEntry(entry) ? `party:${entry.id}` : "";
}

export function groupPartySlots(slots = []) {
  const groups = [];

  slots.forEach((slot) => {
    const canGroup = Boolean(slot.partyKey);
    const lastGroup = groups[groups.length - 1];
    if (canGroup && lastGroup?.partyKey === slot.partyKey) {
      lastGroup.slots.push(slot);
      return;
    }
    groups.push(canGroup ? { type: "party", partyKey: slot.partyKey, slots: [slot] } : { type: "slot", slots: [slot] });
  });

  return groups.map((group) => (
    group.type === "party" && group.slots.length < 2
      ? { type: "slot", slots: group.slots }
      : group
  ));
}

export function PlayerRoomSlot({
  user,
  teams,
  status = "waiting",
  title = "",
  detail = "",
  mmr = DEFAULT_RATING,
  position = null,
  badge = null,
  empty = false,
  invite = false,
  onInvite,
  onSelfAction,
  children,
}) {
  if (empty) {
    return (
      <button
        type="button"
        className={invite ? "arena-room-player-slot empty invite" : "arena-room-player-slot empty"}
        disabled={!invite}
        onClick={onInvite}
      >
        <UserRound size={18} />
        <strong>{title}</strong>
        {detail ? <em>{detail}</em> : null}
      </button>
    );
  }

  const slotClassName = status === "ready" ? "arena-room-player-slot ready" : "arena-room-player-slot";
  const displayPosition = position ?? getPlayerPosition(user);
  const slotContent = (
    <>
      {badge ? (
        <span className={`arena-room-slot-crown ${badge.tone}`} title={badge.label} aria-label={badge.label}>
          <Crown size={12} strokeWidth={3} />
        </span>
      ) : null}
      <RoomSlotAvatar user={user} mmr={mmr} position={displayPosition} />
      <strong>{user?.name ?? "플레이어"}</strong>
      <small>{displayPosition}</small>
      {detail ? <span className="arena-room-slot-detail">{detail}</span> : null}
      <em>{title}</em>
    </>
  );

  return (
    <div className="arena-room-player-slot-wrap">
      {onSelfAction ? (
        <button type="button" className={`${slotClassName} self-action`} onClick={(event) => onSelfAction(event)}>
          {slotContent}
        </button>
      ) : (
        <PlayerHoverCard user={user} teams={teams} className={slotClassName}>
          {slotContent}
        </PlayerHoverCard>
      )}
      {children}
    </div>
  );
}

export function isCurrentUserRoomParticipant(post, lobby, currentUserId) {
  if (!currentUserId) return false;
  if (getRecruitingRoomOwnerId(post) === currentUserId) return true;
  if (post.refereeId === currentUserId) return true;
  if (post.playerId === currentUserId || post.playerIds?.includes(currentUserId)) return true;
  return (lobby.entries ?? []).some((entry) => (
    entry.players?.includes(currentUserId) ||
    entry.reserves?.includes(currentUserId)
  ));
}

export function getRecruitingRoomStatus(lobby, { post = null, myEntry = null, mine = false } = {}) {
  const terminalStatus = post ? getRecruitingPostTerminalState(post) : null;
  if (terminalStatus) return terminalStatus;
  const timingStatus = post ? getPublicRoomTimingStatus(post) : null;
  if (lobby.canConfirm) {
    if (timingStatus && !timingStatus.canConfirm) {
      return { label: "대기방", tone: timingStatus.expired ? "neutral" : "blue", detail: timingStatus.detail };
    }
    return mine
      ? { label: "대기방", tone: "green", detail: "정원 충족 · 경기 확정 가능" }
      : { label: "대기방", tone: "green", detail: "방장 경기 확정 대기" };
  }
  if (!lobby.projectedFull) return { label: "대기방", tone: "blue", detail: timingStatus?.timingType === "instant" ? "즉시 모집 중" : "모집 중" };
  return { label: "대기방", tone: "orange", detail: "참여 확인 중" };
}

export function getRecruitingRoomListStatus(lobby, { post = null } = {}) {
  const terminalStatus = post ? getRecruitingPostTerminalState(post) : null;
  if (terminalStatus) return { ...terminalStatus, actionLabel: "방 보기" };
  const timingStatus = post ? getPublicRoomTimingStatus(post) : null;
  if (timingStatus?.expired) {
    return { label: "종료됨", tone: "neutral", detail: timingStatus.detail, actionLabel: "방 보기" };
  }
  if (!lobby.projectedFull) {
    return { label: "대기방", tone: "orange", detail: timingStatus?.timingType === "instant" ? "즉시 모집 중" : "빈 슬롯 모집 중", actionLabel: "방 보기" };
  }
  return { label: "정원참", tone: "neutral", detail: "빈 슬롯 없음", actionLabel: "방 보기" };
}
