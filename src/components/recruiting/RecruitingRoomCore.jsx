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

function getPlayerPosition(user) {
  return user?.position || "포지션 자유";
}

function isAnonymousDisplayUser(user = null) {
  return Boolean(user?.anonymous || user?.participationLabel === "개인참여");
}

function getAvatarInitial(user = null, fallback = "?") {
  return isAnonymousDisplayUser(user) ? "?" : (user?.name?.slice(0, 1) ?? fallback);
}

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

  const initial = getAvatarInitial(user);

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

export function TeamMemberPicker({
  team,
  userById,
  selectedIds = [],
  reserveIds = [],
  capacity,
  reserveCapacity = MAX_RESERVE_PLAYERS_PER_SIDE,
  onChange,
  onReserveChange,
  onRosterChange,
  requiredPlayerId = "",
  requiredActive = false,
  eligiblePlayerIds = null,
  deferCommit = false,
  submitLabel = "선수 확정",
}) {
  const [draftRoster, setDraftRoster] = useState({ selectedIds, reserveIds });

  useEffect(() => {
    setDraftRoster({ selectedIds, reserveIds });
  }, [selectedIds.join("|"), reserveIds.join("|")]);

  if (!team) {
    return (
      <div className="arena-party-picker empty">
        <span>선택할 수 있는 팀이 없습니다.</span>
      </div>
    );
  }

  const effectiveSelectedIds = deferCommit ? draftRoster.selectedIds : selectedIds;
  const effectiveReserveIds = deferCommit ? draftRoster.reserveIds : reserveIds;
  const memberIds = getSelectableTeamPlayerIds(team);
  const selectedSet = new Set(effectiveSelectedIds);
  const reserveSet = new Set(effectiveReserveIds);
  const eligibleSet = Array.isArray(eligiblePlayerIds) ? new Set(eligiblePlayerIds) : null;
  const canSelectReserves = Boolean(onRosterChange || onReserveChange);
  const commitRoster = (nextSelectedIds, nextReserveIds) => {
    onRosterChange?.({ selectedIds: nextSelectedIds, reserveIds: nextReserveIds });
    onChange?.(nextSelectedIds);
    onReserveChange?.(nextReserveIds);
  };
  const emitRoster = (nextSelectedIds, nextReserveIds) => {
    if (deferCommit) {
      setDraftRoster({ selectedIds: nextSelectedIds, reserveIds: nextReserveIds });
      return;
    }
    commitRoster(nextSelectedIds, nextReserveIds);
  };
  const rosterChanged = deferCommit && (
    selectedIds.join("|") !== effectiveSelectedIds.join("|") ||
    reserveIds.join("|") !== effectiveReserveIds.join("|")
  );
  const setMemberRole = (playerId, role) => {
    if ((role === "active" || role === "reserve") && eligibleSet && !eligibleSet.has(playerId)) return;
    const nextSelectedIds = effectiveSelectedIds.filter((id) => id !== playerId);
    const nextReserveIds = effectiveReserveIds.filter((id) => id !== playerId);
    if (role === "active") {
      if (nextSelectedIds.length >= capacity) return;
      emitRoster([...nextSelectedIds, playerId], nextReserveIds);
      return;
    }
    if (role === "reserve") {
      if (requiredActive && playerId === requiredPlayerId) return;
      if (nextReserveIds.length >= reserveCapacity) return;

      emitRoster(nextSelectedIds, [...nextReserveIds, playerId]);
      return;
    }
    if (playerId === requiredPlayerId) return;
    emitRoster(nextSelectedIds, nextReserveIds);
  };

  return (
    <div className="arena-party-picker">
      <div className="arena-party-picker-head">
        <span>참여 팀원</span>
        <strong>
          출전 {effectiveSelectedIds.length}/{capacity}
          {canSelectReserves ? ` · 후보 ${effectiveReserveIds.length}/${reserveCapacity}` : ""}
        </strong>
      </div>
      <div className="arena-party-picker-grid">
        {memberIds.map((playerId) => {
          const user = userById[playerId];
          const selected = selectedSet.has(playerId);
          const reserve = reserveSet.has(playerId);
          const required = playerId === requiredPlayerId;
          const eligible = !eligibleSet || eligibleSet.has(playerId);
          const activeLocked = !selected && effectiveSelectedIds.length >= capacity;
          const reserveLocked = requiredActive && required
            ? true
            : !reserve && effectiveReserveIds.length >= reserveCapacity;
          return (
            <div
              key={playerId}
              className={[
                "arena-party-member-card",
                selected ? "selected" : "",
                reserve ? "reserve" : "",
                required ? "required" : "",
                !eligible ? "ineligible" : "",
              ].filter(Boolean).join(" ")}
            >
              <ProfileEmblem user={user} className="small" />
              <span>
                <strong>{user?.name ?? "알 수 없음"}</strong>
                <em>{!eligible ? `${getPlayerPosition(user)} · 조건 불일치` : required ? `${getPlayerPosition(user)} · 필수` : getPlayerPosition(user)}</em>
              </span>
              <TierBadge mmr={user?.ratings?.integrated ?? DEFAULT_RATING} ratings={user?.ratings} compact />
              <div className="arena-party-role-buttons">
                <button type="button" className={selected ? "active" : ""} disabled={!eligible || activeLocked} onClick={() => setMemberRole(playerId, "active")}>출전</button>
                {canSelectReserves ? (
                  <button type="button" className={reserve ? "active" : ""} disabled={!eligible || reserveLocked} onClick={() => setMemberRole(playerId, "reserve")}>후보</button>
                ) : null}
                <button type="button" disabled={required} onClick={() => setMemberRole(playerId, "none")}>해제</button>
              </div>
            </div>
          );
        })}
      </div>
      {!effectiveSelectedIds.length ? <em>최소 1명 선택 필요</em> : null}
      {deferCommit ? (
        <Button type="button" size="sm" disabled={!rosterChanged || !effectiveSelectedIds.length} onClick={() => commitRoster(effectiveSelectedIds, effectiveReserveIds)}>
          {submitLabel}
        </Button>
      ) : null}
    </div>
  );
}

function getRecruitingRuleSummary(post = {}) {
  return getMatchRuleSummary(post.rules, post.mode);
}

export function getRecruitingRoomTypeLabel(room = {}, lobby = null) {
  if (isTeamRecruitingRoom(room)) return "팀전";
  const lobbyTeamCount = lobby?.entries?.filter((entry) => isRecruitingTeamEntry(entry)).length ?? 0;
  if (lobbyTeamCount >= 2) return "팀전";
  if (lobbyTeamCount > 0) return "팀 파티 포함";
  return "개인 매칭";
}

export function QueueRoomBoard({ post, lobby }) {
  const counts = getRecruitingListCardCounts(post, lobby, { projected: true });
  const ruleSummary = getRecruitingRuleSummary(post);

  return (
    <MatchListSummary
      left={counts.layout === "sides" ? `A ${counts.teamA.filled}/${counts.teamA.capacity}` : null}
      center={counts.layout === "unified" ? `참가 ${counts.filled}/${counts.capacity}` : `${counts.filled}/${counts.capacity}`}
      right={counts.layout === "sides" ? `B ${counts.teamB.filled}/${counts.teamB.capacity}` : null}
      detail={ruleSummary}
      variant={counts.layout === "unified" ? "participant" : "count"}
    />
  );
}

export function FillSlot({ candidate, lobby, userById, teams, hostPlayerId = "", currentUserId = "", showCaptainBadge = false, roomState = {}, sideLeaderId = "", readyText = "출전", slotPositions = {}, canManageEntry = null, onSelfAction }) {
  const user = candidate ? userById[candidate.playerId] : null;
  const readyLabel = candidate?.status === "ready" ? "출전" : "대기";
  const entry = candidate ? (lobby.entries ?? []).find((item) => item.id === candidate.entryId) : null;
  const teamName = getRoomSlotTeamName(entry, teams);
  const badge = getRoomSlotBadge(candidate?.playerId, entry, hostPlayerId, showCaptainBadge, roomState, { showPartyBadge: !candidate?.reserve, sideLeaderId });
  const isSelfSlot = candidate?.playerId === currentUserId;
  const canOpenAction = isSelfSlot || Boolean(entry && canManageEntry?.(entry));
  const displayPosition = getRoomSlotDisplayPosition(user, slotPositions, candidate?.playerId, entry);
  if (!user) {
    return (
      <div className="arena-room-player-slot empty">
        <UserRound size={17} />
        <span>후보 없음</span>
      </div>
    );
  }

  return (
    <div className="arena-room-player-slot-wrap">
      {canOpenAction && onSelfAction ? (
        <button
          type="button"
          className={candidate.status === "ready" ? "arena-room-player-slot fill ready self-action" : "arena-room-player-slot fill self-action"}
          onClick={(event) => onSelfAction(event)}
        >
          {badge ? (
            <span className={`arena-room-slot-crown ${badge.tone}`} title={badge.label} aria-label={badge.label}>
              <Crown size={12} strokeWidth={3} />
            </span>
          ) : null}
          <RoomSlotAvatar user={user} mmr={user.ratings?.integrated ?? DEFAULT_RATING} position={displayPosition} />
          <strong>{user.name}</strong>
          <small>{displayPosition}</small>
          <span className="arena-room-slot-detail">{teamName}</span>
          <em>{candidate.status === "ready" ? readyText : readyLabel}</em>
        </button>
      ) : (
      <PlayerHoverCard user={user} teams={teams} className={candidate.status === "ready" ? "arena-room-player-slot fill ready" : "arena-room-player-slot fill"}>
        {badge ? (
          <span className={`arena-room-slot-crown ${badge.tone}`} title={badge.label} aria-label={badge.label}>
            <Crown size={12} strokeWidth={3} />
          </span>
        ) : null}
        <RoomSlotAvatar user={user} mmr={user.ratings?.integrated ?? DEFAULT_RATING} position={displayPosition} />
        <strong>{user.name}</strong>
        <small>{displayPosition}</small>
        <span className="arena-room-slot-detail">{teamName}</span>
        <em>{candidate.status === "ready" ? readyText : readyLabel}</em>
      </PlayerHoverCard>
      )}
    </div>
  );
}

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
