import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  Clock3,
  Crown,
  MapPin,
  MessageSquare,
  PlusCircle,
  Search,
  Send,
  ShieldCheck,
  Star,
  Swords,
  UserPlus,
  UserRound,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import CourtHoverCard from "../components/court/CourtHoverCard.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import RefereeHoverCard from "../components/referee/RefereeHoverCard.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import { getTierEmblemSrc } from "../components/rating/TierEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { COURTS, MATCH_MODES, PLAYER_POSITIONS, REGIONS } from "../lib/constants.js";
import {
  MMR_RANGE_POLICIES,
  RECRUITING_JOIN_MODES,
  getRecruitingBestSide,
  getRecruitingFit,
  getRecruitingLobby,
  getRecruitingRatingScale,
  getRecruitingRoomOwnerId,
  getRecruitingSideCapacity,
  getRecruitingTargetMmr,
  getRecruitingTierRange,
  getSelectableTeamPlayerIds,
  hasRecruitingApplicant,
  hasPendingRecruitingInvitation,
  isRecruitingPostForUser,
  isNationalRecruitingPost,
} from "../lib/recruiting.js";
import { findTeamByHashtag, findUserByHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import {
  cleanRoomTitle,
  formatStatLine,
  getRoomCompetitionLabel,
  getRoomRefereeLabel,
  getRoomVisibilityLabel,
  getMatchRoomPhase,
  getMatchReservePlayerIds,
  getMatchSidePlayerIds,
  normalizePlayerStats,
  getPublicRoomMaxDateInput,
  getPublicRoomTimingStatus,
  isEligibleReferee,
  isInstantRoom,
  isMatchReferee,
} from "../lib/matchUtils.js";

const SIDE_LABELS = {
  teamA: "A사이드",
  teamB: "B사이드",
};
const RECORDABLE_RESERVE_SOURCES = new Set(["reserve-entry", "team-reserve"]);
const MAX_RESERVE_PLAYERS_PER_SIDE = 2;
const ROOM_SLOT_POSITION_AVATARS = {
  PG: "/assets/position-avatars/PG.png",
  SG: "/assets/position-avatars/SG.png",
  SF: "/assets/position-avatars/SF.png",
  PF: "/assets/position-avatars/PF.png",
  C: "/assets/position-avatars/C.png",
};

function formatWhen(value) {
  if (!value) return "방금";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "방금";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function getDefaultTitle(draft) {
  return `${draft.ranked ? "정규전" : "친선전"} ${draft.mode} 매치 큐`;
}

function getTodayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMaxInputValue() {
  return getPublicRoomMaxDateInput();
}

function getRecruitingSchedule(post) {
  if (isInstantRoom(post)) return "즉시";
  return [post.scheduledDate, post.scheduledTime].filter(Boolean).join(" ") || post.scheduledAt || "일정 미정";
}

function getDefaultApplyTeamId(post, teams) {
  return teams.find((team) => team.region === post.region)?.id ?? teams[0]?.id ?? "";
}

function isTeamOnlyRoom(post = {}) {
  return post.teamOnly === true || post.roomState?.teamOnly === true;
}

function getDefaultTeamPlayerIds(team, capacity, requiredPlayerId = "") {
  if (!team) return [];
  const selectableIds = getSelectableTeamPlayerIds(team);
  const orderedIds = requiredPlayerId && selectableIds.includes(requiredPlayerId)
    ? [requiredPlayerId, ...selectableIds.filter((playerId) => playerId !== requiredPlayerId)]
    : selectableIds;
  return orderedIds.slice(0, capacity);
}

function getPartyPlayerIds(team, playerIds, capacity, requiredPlayerId = "") {
  if (!team) return [];
  if (!Array.isArray(playerIds)) return getDefaultTeamPlayerIds(team, capacity, requiredPlayerId);
  const selectableIds = new Set(getSelectableTeamPlayerIds(team));
  const safeIds = Array.from(new Set(playerIds.filter((playerId) => selectableIds.has(playerId))));
  const orderedIds = requiredPlayerId && selectableIds.has(requiredPlayerId)
    ? [requiredPlayerId, ...safeIds.filter((playerId) => playerId !== requiredPlayerId)]
    : safeIds;
  return orderedIds.slice(0, capacity);
}

function getPartyReserveIds(team, reserveIds, activeIds = [], capacity = MAX_RESERVE_PLAYERS_PER_SIDE) {
  if (!team || !Array.isArray(reserveIds)) return [];
  const activeSet = new Set(activeIds);
  const selectableIds = new Set(getSelectableTeamPlayerIds(team));
  return Array.from(new Set(reserveIds.filter((playerId) => selectableIds.has(playerId) && !activeSet.has(playerId))))
    .slice(0, capacity);
}

function getDefaultTeamReserveIds(team, activeIds = [], capacity = MAX_RESERVE_PLAYERS_PER_SIDE) {
  if (!team) return [];
  const activeSet = new Set(activeIds);
  return getSelectableTeamPlayerIds(team)
    .filter((playerId) => !activeSet.has(playerId))
    .slice(0, capacity);
}

function getPlayerMmrAverage(playerIds = [], userById = {}, fallback = 1200) {
  const values = playerIds
    .map((playerId) => Number(userById[playerId]?.ratings?.integrated))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return fallback;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getRoomEditDraft(post) {
  return {
    sideCapacity: getRecruitingSideCapacity(post),
    matchJoinMode: post.hostJoinMode === "team" ? "team" : "player",
    mmrRangeMode: post.mmrRangeMode ?? post.roomState?.mmrRangeMode ?? "narrow",
    targetScore: post.rules?.targetScore ?? 21,
    timeLimit: post.rules?.timeLimit ?? 12,
    winByTwo: post.rules?.winByTwo ?? true,
    ball: post.rules?.ball ?? "7호 공",
    attackRule: post.rules?.attackRule ?? "득점 후 공격권 교대",
    foulRule: post.rules?.foulRule ?? "파울 콜 즉시 중단, 공격권 유지",
    stakes: post.stakes ?? "",
    memo: post.memo ?? "",
  };
}

function getDefaultJoinDraft(post, teams, currentUser, state) {
  const teamId = getDefaultApplyTeamId(post, teams);
  const team = teams.find((item) => item.id === teamId) ?? null;
  const capacity = getRecruitingSideCapacity(post);
  const teamOnly = isTeamOnlyRoom(post);
  const playerIds = teamOnly ? getDefaultTeamPlayerIds(team, capacity, currentUser.id) : [];
  return {
    joinMode: teamOnly ? "team" : "player",
    teamId,
    playerIds,
    reservePlayerIds: teamOnly ? getDefaultTeamReserveIds(team, playerIds) : [],
    side: getRecruitingBestSide(post, state),
    reserve: false,
    position: currentUser.position,
  };
}

function getEntryMmr(entry) {
  return isPartyEntry(entry)
    ? entry.team?.mmr ?? entry.user?.ratings?.integrated ?? 1200
    : entry.user?.ratings?.integrated ?? 1200;
}

function getEntryTitle(entry) {
  if (entry.fixed && entry.team) return `${entry.team.name} · 방장 파티`;
  if (entry.kind === "team" && entry.team) return `${entry.team.name} · 팀 파티`;
  if (entry.fixed) return `${entry.user?.name ?? "방장"} · 방장`;
  return `${entry.user?.name ?? "플레이어"} · 개인`;
}

function getReadyTitle(entry) {
  if (isPartyEntry(entry) && entry.team) {
    const leader = entry.user?.name ? ` · ${entry.user.name}` : "";
    return `${entry.team?.name ?? "팀"}${leader}`;
  }
  return entry.user?.name ?? "플레이어";
}

export function getLobbySideMeta(lobby, sideName, userById, { useSideName = false } = {}) {
  const side = lobby.sides[sideName];
  const teamEntry = side.entries.find((entry) => isPartyEntry(entry) && entry.team);
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

function getRoomSlotPositionAvatarSrc(position) {
  const normalizedPosition = String(position ?? "").trim().toUpperCase();
  return ROOM_SLOT_POSITION_AVATARS[normalizedPosition] ?? null;
}

function getRoomSlotDisplayPosition(user, slotPositions = {}, playerId = user?.id, entry = null) {
  const position = slotPositions[playerId] ?? (entry?.kind === "player" ? entry.position : null) ?? user?.position ?? PLAYER_POSITIONS[0];
  return PLAYER_POSITIONS.includes(position) ? position : PLAYER_POSITIONS[0];
}

function getPartyOptionLabel(option) {
  const leader = option.entry?.user?.name ? ` · ${option.entry.user.name}` : "";
  return `${option.team.name}${leader}`;
}

function getPartyOptionKey(option) {
  return `${option.sideName}-${option.team.id}-${option.entry?.id ?? "entry"}`;
}

function RoomSlotAvatar({ user, mmr = 1200, position = null }) {
  const [failed, setFailed] = useState(false);
  const normalizedPosition = String(position ?? user?.position ?? "").trim().toUpperCase();
  const avatarSrc = getRoomSlotPositionAvatarSrc(normalizedPosition);
  const initial = user?.name?.slice(0, 1) ?? "?";

  if (!avatarSrc || failed) {
    return <span className="avatar" style={{ "--avatar": user?.avatarColor }}>{initial}</span>;
  }

  return (
    <span className="avatar ow-position-avatar" data-position={normalizedPosition} style={{ "--avatar": user?.avatarColor }}>
      <img
        className="ow-position-avatar-tier"
        src={getTierEmblemSrc(user?.ratings?.integrated ?? mmr)}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={(event) => {
          event.currentTarget.hidden = true;
        }}
      />
      <img
        className="ow-position-avatar-player"
        src={avatarSrc}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function getTeamCaptainId(team) {
  return team?.members?.find((member) => member.role === "captain")?.userId ?? "";
}

const ROOM_SLOT_BADGES = {
  host: { tone: "host", label: "방장" },
  partyLeader: { tone: "captain", label: "파티장" },
  teamCaptain: { tone: "captain", label: "팀 주장" },
};

function getEntryPartyLeaderId(entry, hostPlayerId = "", roomState = {}) {
  if (!entry) return "";
  return roomState.partyLeaders?.[entry.id] ?? (entry.fixed ? hostPlayerId : entry.playerId) ?? "";
}

function getRoomSlotBadge(playerId, entry, hostPlayerId, showCaptainBadge = false, roomState = {}) {
  if (!playerId) return null;
  if (playerId === hostPlayerId) return ROOM_SLOT_BADGES.host;
  if (!showCaptainBadge) return null;
  if (isPartyEntry(entry) && getEntryPartyLeaderId(entry, hostPlayerId, roomState) === playerId) return ROOM_SLOT_BADGES.partyLeader;
  if (isPartyEntry(entry) && getTeamCaptainId(entry.team) === playerId) return ROOM_SLOT_BADGES.teamCaptain;
  return null;
}

function uniqueIds(ids = []) {
  return Array.from(new Set(ids.filter(Boolean)));
}

export function getLobbyRecorderIds(lobby) {
  const playingIds = new Set([...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers]);
  return ["teamA", "teamB"].reduce((acc, sideName) => {
    const candidate = (lobby.sides[sideName].reserveCandidates ?? []).find((item) => (
      RECORDABLE_RESERVE_SOURCES.has(item.source) &&
      item.status === "ready" &&
      !playingIds.has(item.playerId)
    ));
    acc[sideName] = candidate?.playerId ?? "";
    return acc;
  }, { teamA: "", teamB: "" });
}

export function canMovePlayerTo(lobby, playerId, sideName, reserve = false) {
  const side = lobby.sides[sideName];
  if (!side) return false;
  if (reserve) return side.reserves.includes(playerId) || side.reserveCandidates.length < MAX_RESERVE_PLAYERS_PER_SIDE;
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

function getJoinableSidePartyOptions(lobby, myTeams = [], currentUserId = "", targetSide = "") {
  const sides = ["teamA", "teamB"].filter((sideName) => !targetSide || sideName === targetSide);
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
  return entry?.kind === "team";
}

function getEntryTeamGroupId(entry) {
  return entry?.team?.id ?? entry?.teamId ?? entry?.sourceTeamId ?? "";
}

function getLobbyPrimaryTeamId(lobby, sideName) {
  const teamEntry = lobby.sides?.[sideName]?.entries?.find((entry) => getEntryTeamGroupId(entry));
  return getEntryTeamGroupId(teamEntry);
}

function getVisualPartyKey(entry, sideName = "") {
  const teamId = getEntryTeamGroupId(entry);
  if (!teamId) return "";
  return isPartyEntry(entry) ? `party:${entry.id}` : "";
}

function groupPartySlots(slots = []) {
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
  mmr = 1200,
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
        className={invite ? "ow-room-player-slot empty invite" : "ow-room-player-slot empty"}
        disabled={!invite}
        onClick={onInvite}
      >
        <UserRound size={18} />
        <strong>{title}</strong>
        {detail ? <em>{detail}</em> : null}
      </button>
    );
  }

  const slotClassName = status === "ready" ? "ow-room-player-slot ready" : "ow-room-player-slot";
  const displayPosition = position ?? getPlayerPosition(user);
  const slotContent = (
    <>
      {badge ? (
        <span className={`ow-room-slot-crown ${badge.tone}`} title={badge.label} aria-label={badge.label}>
          <Crown size={12} strokeWidth={3} />
        </span>
      ) : null}
      <RoomSlotAvatar user={user} mmr={mmr} position={displayPosition} />
      <strong>{user?.name ?? "플레이어"}</strong>
      <small>{displayPosition}</small>
      {detail ? <b>{detail}</b> : null}
      <em>{title}</em>
    </>
  );

  return (
    <div className="ow-room-player-slot-wrap">
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

function isCurrentUserRoomParticipant(post, lobby, currentUserId) {
  if (!currentUserId) return false;
  if (getRecruitingRoomOwnerId(post) === currentUserId) return true;
  if (post.playerId === currentUserId || post.playerIds?.includes(currentUserId)) return true;
  return (lobby.entries ?? []).some((entry) => (
    entry.players?.includes(currentUserId) ||
    entry.reserves?.includes(currentUserId)
  ));
}

export function getRecruitingRoomStatus(lobby, { post = null, myEntry = null, mine = false } = {}) {
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
  if (!mine && myEntry?.status && myEntry.status !== "ready") return { label: "대기방", tone: "orange", detail: "내 확인 필요" };
  return { label: "대기방", tone: "orange", detail: "참여 확인 중" };
}

export function getRecruitingRoomListStatus(lobby, { post = null, myEntry = null, mine = false } = {}) {
  const timingStatus = post ? getPublicRoomTimingStatus(post) : null;
  if (lobby.canConfirm) {
    if (timingStatus && !timingStatus.canConfirm) {
      return { label: "대기방", tone: timingStatus.expired ? "neutral" : "blue", detail: timingStatus.detail, actionLabel: "방 보기" };
    }
    return mine
      ? { label: "대기방", tone: "green", detail: "정원 충족 · 경기 확정 가능", actionLabel: "방 보기" }
      : { label: "대기방", tone: "green", detail: "방장 경기 확정 대기", actionLabel: "방 보기" };
  }
  if (!lobby.projectedFull) {
    return { label: "대기방", tone: "blue", detail: timingStatus?.timingType === "instant" ? "즉시 모집 중" : "빈 슬롯 모집 중", actionLabel: "방 보기" };
  }
  if (!mine && myEntry?.status && myEntry.status !== "ready") {
    return { label: "대기방", tone: "orange", detail: "내 참여 확인 필요", actionLabel: "확인하기" };
  }
  return { label: "대기방", tone: "orange", detail: "참가자 확인 대기", actionLabel: "방 보기" };
}

function TeamMemberPicker({
  team,
  userById,
  selectedIds,
  reserveIds = [],
  capacity,
  reserveCapacity = MAX_RESERVE_PLAYERS_PER_SIDE,
  onChange,
  onReserveChange,
  onRosterChange,
  requiredPlayerId = "",
  requiredActive = false,
}) {
  if (!team) {
    return (
      <div className="ow-party-picker empty">
        <span>선택할 팀이 없다.</span>
      </div>
    );
  }

  const memberIds = getSelectableTeamPlayerIds(team);
  const selectedSet = new Set(selectedIds);
  const reserveSet = new Set(reserveIds);
  const canSelectReserves = Boolean(onRosterChange || onReserveChange);
  const emitRoster = (nextSelectedIds, nextReserveIds) => {
    onRosterChange?.({ selectedIds: nextSelectedIds, reserveIds: nextReserveIds });
    onChange?.(nextSelectedIds);
    onReserveChange?.(nextReserveIds);
  };
  const setMemberRole = (playerId, role) => {
    const nextSelectedIds = selectedIds.filter((id) => id !== playerId);
    const nextReserveIds = reserveIds.filter((id) => id !== playerId);
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
    <div className="ow-party-picker">
      <div className="ow-party-picker-head">
        <span>참여 팀원</span>
        <strong>
          출전 {selectedIds.length}/{capacity}
          {canSelectReserves ? ` · 후보 ${reserveIds.length}/${reserveCapacity}` : ""}
        </strong>
      </div>
      <div className="ow-party-picker-grid">
        {memberIds.map((playerId) => {
          const user = userById[playerId];
          const selected = selectedSet.has(playerId);
          const reserve = reserveSet.has(playerId);
          const required = playerId === requiredPlayerId;
          const activeLocked = !selected && selectedIds.length >= capacity;
          const reserveLocked = requiredActive && required
            ? true
            : !reserve && reserveIds.length >= reserveCapacity;
          return (
            <div
              key={playerId}
              className={[
                "ow-party-member-card",
                selected ? "selected" : "",
                reserve ? "reserve" : "",
                required ? "required" : "",
              ].filter(Boolean).join(" ")}
            >
              <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "?"}</span>
              <span>
                <strong>{user?.name ?? "알 수 없음"}</strong>
                <em>{required ? `${getPlayerPosition(user)} · 필수` : getPlayerPosition(user)}</em>
              </span>
              <TierBadge mmr={user?.ratings?.integrated ?? 1200} compact />
              <div className="ow-party-role-buttons">
                <button type="button" className={selected ? "active" : ""} disabled={activeLocked} onClick={() => setMemberRole(playerId, "active")}>출전</button>
                {canSelectReserves ? (
                  <button type="button" className={reserve ? "active" : ""} disabled={reserveLocked} onClick={() => setMemberRole(playerId, "reserve")}>후보</button>
                ) : null}
                <button type="button" disabled={required} onClick={() => setMemberRole(playerId, "none")}>해제</button>
              </div>
            </div>
          );
        })}
      </div>
      {!selectedIds.length ? <em>최소 1명 선택 필요</em> : null}
    </div>
  );
}

function getRecruitingRuleSummary(post = {}) {
  const targetScore = Number(post.rules?.targetScore ?? 0);
  const timeLimit = Number(post.rules?.timeLimit ?? 0);
  return [
    targetScore ? `${targetScore}점` : "",
    timeLimit ? `${timeLimit}분` : "",
    post.rules?.winByTwo ? "2점차" : "",
    post.rules?.ball ?? "",
  ].filter(Boolean).join(" · ") || "룰 미정";
}

function QueueRoomBoard({ post, lobby, roomStatus = null }) {
  const status = roomStatus ?? getRecruitingRoomListStatus(lobby, { post });
  const filled = lobby.sides.teamA.projectedFilled + lobby.sides.teamB.projectedFilled;
  const capacity = getRecruitingSideCapacity(post) * 2;

  return (
    <div className={lobby.canConfirm ? "ow-queue-board complete" : "ow-queue-board"}>
      <div className="ow-summary-line">
        <span className="ow-summary-side">A {lobby.sides.teamA.projectedFilled}/{lobby.sides.teamA.capacity}</span>
        <strong>{filled}/{capacity}</strong>
        <span className="ow-summary-side">B {lobby.sides.teamB.projectedFilled}/{lobby.sides.teamB.capacity}</span>
      </div>
      <span className="ow-summary-meta">{getRecruitingRuleSummary(post)}</span>
      {status.detail ? <span className="ow-summary-detail">{status.detail}</span> : null}
    </div>
  );
}

function FillSlot({ candidate, lobby, userById, teams, hostPlayerId = "", currentUserId = "", showCaptainBadge = false, roomState = {}, readyText = "READY", slotPositions = {}, canManageEntry = null, onSelfAction }) {
  const user = candidate ? userById[candidate.playerId] : null;
  const readyLabel = candidate?.status === "ready" ? "READY" : "WAIT";
  const entry = candidate ? (lobby.entries ?? []).find((item) => item.id === candidate.entryId) : null;
  const badge = getRoomSlotBadge(candidate?.playerId, entry, hostPlayerId, showCaptainBadge, roomState);
  const isSelfSlot = candidate?.playerId === currentUserId;
  const canOpenAction = isSelfSlot || Boolean(entry && canManageEntry?.(entry));
  const displayPosition = getRoomSlotDisplayPosition(user, slotPositions, candidate?.playerId, entry);
  if (!user) {
    return (
      <div className="ow-room-player-slot empty">
        <UserRound size={17} />
        <span>후보 없음</span>
      </div>
    );
  }

  return (
    <div className="ow-room-player-slot-wrap">
      {canOpenAction && onSelfAction ? (
        <button
          type="button"
          className={candidate.status === "ready" ? "ow-room-player-slot fill ready self-action" : "ow-room-player-slot fill self-action"}
          onClick={(event) => onSelfAction(event)}
        >
          {badge ? (
            <span className={`ow-room-slot-crown ${badge.tone}`} title={badge.label} aria-label={badge.label}>
              <Crown size={12} strokeWidth={3} />
            </span>
          ) : null}
          <RoomSlotAvatar user={user} mmr={user.ratings?.integrated ?? 1200} position={displayPosition} />
          <strong>{user.name}</strong>
          <small>{displayPosition}</small>
          <b>{candidate.sourceLabel}</b>
          <em>{candidate.status === "ready" ? readyText : readyLabel}</em>
        </button>
      ) : (
      <PlayerHoverCard user={user} teams={teams} className={candidate.status === "ready" ? "ow-room-player-slot fill ready" : "ow-room-player-slot fill"}>
        {badge ? (
          <span className={`ow-room-slot-crown ${badge.tone}`} title={badge.label} aria-label={badge.label}>
            <Crown size={12} strokeWidth={3} />
          </span>
        ) : null}
        <RoomSlotAvatar user={user} mmr={user.ratings?.integrated ?? 1200} position={displayPosition} />
        <strong>{user.name}</strong>
        <small>{displayPosition}</small>
        <b>{candidate.sourceLabel}</b>
        <em>{candidate.status === "ready" ? readyText : readyLabel}</em>
      </PlayerHoverCard>
      )}
    </div>
  );
}

function CommandPopoverFrame({ floating = false, anchor = null, className = "", onClose, children }) {
  const anchored = Boolean(floating && anchor);
  const panelClassName = [
    className,
    floating ? "floating" : "",
    anchored ? "anchored" : "",
    anchored && anchor.placement === "top" ? "above" : "",
    anchored && anchor.placement !== "top" ? "below" : "",
  ].filter(Boolean).join(" ");
  const panelStyle = anchored
    ? {
        "--popover-x": `${anchor.x}px`,
        "--popover-y": `${anchor.y}px`,
        "--popover-width": `${anchor.width}px`,
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

  return (
    <div className="ow-slot-popover-backdrop" role="presentation" onPointerDown={onClose}>
      {panel}
    </div>
  );
}

export function SlotCommandPanel({ sideName, reserve = false, floating = false, anchor = null, canMoveHere = false, partyJoinOptions = [], onMoveHere, onJoinParty, onClose, children }) {
  return (
    <CommandPopoverFrame floating={floating} anchor={anchor} className="ow-slot-command-popover" onClose={onClose}>
      <header>
        <div>
          <strong>{SIDE_LABELS[sideName]} {reserve ? "후보 슬롯" : "빈 슬롯"}</strong>
          <span>이 자리로 이동하거나 초대한다.</span>
        </div>
        <button type="button" className="ow-icon-button" aria-label="닫기" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="ow-slot-command-actions">
        <Button type="button" size="sm" variant="secondary" disabled={!canMoveHere} onClick={onMoveHere}>
          이 자리로 이동
        </Button>
        {partyJoinOptions.map((option) => (
          <Button key={getPartyOptionKey(option)} type="button" size="sm" variant="secondary" onClick={() => onJoinParty(option.team.id, option.entry?.id)}>
            {getPartyOptionLabel(option)} 파티 합류
          </Button>
        ))}
      </div>
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
    <CommandPopoverFrame floating anchor={anchor} className="ow-slot-command-popover ow-self-slot-popover" onClose={onClose}>
      <header>
        <div>
          <strong>{heading}</strong>
          <span>{SIDE_LABELS[sideName]} · {reserve ? "후보" : "출전"} · {partyText}</span>
        </div>
        <button type="button" className="ow-icon-button" aria-label="닫기" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="ow-self-slot-status">
        <Badge tone={inParty ? "green" : fromParty ? "orange" : "neutral"}>{partyText}</Badge>
      </div>
      {onPositionChange ? (
        <label className="ow-self-position-control">
          <span>슬롯 포지션</span>
          <select value={safeCurrentPosition} onChange={(event) => onPositionChange(event.target.value)}>
            {PLAYER_POSITIONS.map((position) => <option key={position} value={position}>{position}</option>)}
          </select>
        </label>
      ) : null}
      {children}
      <div className="ow-slot-command-actions">
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

export function SideRoster({
  sideName,
  side,
  lobby,
  userById,
  teams,
  hostPlayerId = "",
  currentUserId = "",
  showCaptainBadge = false,
  roomState = {},
  slotPositions = {},
  canInvite = false,
  canManageEntry = null,
  onInviteSlot,
  onSelfSlotAction,
}) {
  const activeSlots = [];
  const seenPlayerIds = new Set();
  (side.entries ?? []).forEach((entry) => {
    (entry.players ?? []).forEach((playerId) => {
      if (!playerId || seenPlayerIds.has(playerId)) return;
      seenPlayerIds.add(playerId);
      activeSlots.push({
        entry,
        playerId,
        user: userById[playerId],
        partyKey: getVisualPartyKey(entry, sideName),
      });
    });
  });
  const activeSlotGroups = groupPartySlots(activeSlots);
  const openSlots = Math.max(0, side.capacity - side.projectedFilled);
  const renderActiveSlot = ({ entry, playerId, user }) => {
    const partyEntry = isPartyEntry(entry);
    const partyLabel = partyEntry && entry.team ? entry.team.name : "개인 참여";
    const isSelfSlot = playerId === currentUserId;
    const canOpenAction = Boolean(onSelfSlotAction) && (isSelfSlot || Boolean(canManageEntry?.(entry)));
    const displayPosition = getRoomSlotDisplayPosition(user, slotPositions, playerId, entry);
    return (
      <PlayerRoomSlot
        key={`${sideName}-${entry.id}-${playerId}`}
        user={user}
        teams={teams}
        status={entry.status}
        title={entry.status === "ready" ? "READY" : "WAIT"}
        detail={partyLabel}
        mmr={user?.ratings?.integrated ?? getEntryMmr(entry)}
        position={displayPosition}
        badge={getRoomSlotBadge(playerId, entry, hostPlayerId, showCaptainBadge, roomState)}
        onSelfAction={canOpenAction ? (event) => onSelfSlotAction?.(sideName, false, playerId, entry.id, event) : null}
      />
    );
  };
  return (
    <section className="ow-side-roster">
      <header>
        <div>
          <span>{SIDE_LABELS[sideName]}</span>
          <strong>{side.projectedFilled}/{side.capacity}</strong>
        </div>
      </header>
      <div className="ow-room-slot-row" style={{ "--slot-count": 5 }}>
        {activeSlotGroups.map((group) => (
          group.type === "party" ? (
            <div
              key={`${sideName}-${group.partyKey}`}
              className="ow-room-party-group"
              style={{ "--party-slot-count": group.slots.length, gridColumn: `span ${group.slots.length}` }}
            >
              {group.slots.map(renderActiveSlot)}
            </div>
          ) : renderActiveSlot(group.slots[0])
        ))}
        {side.fillSlots.map((candidate) => (
          <FillSlot
            key={`${sideName}-fill-${candidate.playerId}`}
            candidate={candidate}
            lobby={lobby}
            userById={userById}
            teams={teams}
            hostPlayerId={hostPlayerId}
            currentUserId={currentUserId}
            showCaptainBadge={showCaptainBadge}
            roomState={roomState}
            slotPositions={slotPositions}
            canManageEntry={canManageEntry}
            onSelfAction={(event) => onSelfSlotAction?.(sideName, false, candidate.playerId, candidate.entryId, event)}
          />
        ))}
        {Array.from({ length: openSlots }).map((_item, index) => {
          const slotKey = `${sideName}-active-${index}`;
          return (
            <Fragment key={slotKey}>
              <div className="ow-room-player-slot-wrap">
                <button
                  type="button"
                  className={canInvite ? "ow-room-player-slot empty invite" : "ow-room-player-slot empty"}
                  disabled={!canInvite}
                  onClick={(event) => onInviteSlot?.(sideName, false, slotKey, event)}
                >
                  <UserRound size={17} />
                  <span>빈 슬롯</span>
                  {canInvite ? <em>초대</em> : null}
                </button>
              </div>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

export function ReserveLine({
  sideName,
  candidates,
  playingIds,
  lobby,
  userById,
  teams,
  hostPlayerId = "",
  currentUserId = "",
  showCaptainBadge = false,
  roomState = {},
  slotPositions = {},
  canInvite = false,
  canManageEntry = null,
  recorderId = "",
  onInviteSlot,
  onSelfSlotAction,
}) {
  const playingSet = new Set(playingIds);
  const slots = candidates.slice(0, MAX_RESERVE_PLAYERS_PER_SIDE);
  const openSlots = Math.max(0, MAX_RESERVE_PLAYERS_PER_SIDE - slots.length);
  const slotTrackCount = 5;
  const reserveSlots = slots.map((candidate) => {
    const entry = (lobby.entries ?? []).find((item) => item.id === candidate.entryId);
    return {
      candidate,
      entry,
      partyKey: getVisualPartyKey(entry, sideName),
    };
  });
  const reserveSlotGroups = groupPartySlots(reserveSlots);
  const renderReserveSlot = ({ candidate, entry }) => {
    const user = userById[candidate.playerId];
    if (!user) return null;
    const canRecord = RECORDABLE_RESERVE_SOURCES.has(candidate.source) && candidate.status === "ready" && !playingSet.has(candidate.playerId);
    const assigned = recorderId === candidate.playerId;
    const readyText = canRecord ? (assigned ? "자동 기록자" : "기록 후보") : "후보";
    const isSelfSlot = candidate.playerId === currentUserId;
    const canOpenAction = Boolean(onSelfSlotAction) && (isSelfSlot || Boolean(canManageEntry?.(entry)));
    const displayPosition = getRoomSlotDisplayPosition(user, slotPositions, candidate.playerId, entry);
    return (
      <PlayerRoomSlot
        key={`${sideName}-${candidate.playerId}`}
        user={user}
        teams={teams}
        status={candidate.status}
        title={readyText}
        detail={candidate.sourceLabel}
        mmr={user.ratings?.integrated ?? 1200}
        position={displayPosition}
        badge={getRoomSlotBadge(candidate.playerId, entry, hostPlayerId, showCaptainBadge, roomState)}
        onSelfAction={canOpenAction ? (event) => onSelfSlotAction?.(sideName, true, candidate.playerId, candidate.entryId, event) : null}
      />
    );
  };
  return (
    <div className="ow-reserve-line">
      <strong>{SIDE_LABELS[sideName]} 후보 {candidates.length}/{MAX_RESERVE_PLAYERS_PER_SIDE}</strong>
      <div className="ow-room-reserve-row" style={{ "--slot-count": slotTrackCount }}>
        {reserveSlotGroups.map((group) => (
          group.type === "party" ? (
            <div
              key={`${sideName}-reserve-${group.partyKey}`}
              className="ow-room-party-group"
              style={{ "--party-slot-count": group.slots.length, gridColumn: `span ${group.slots.length}` }}
            >
              {group.slots.map(renderReserveSlot)}
            </div>
          ) : renderReserveSlot(group.slots[0])
        ))}
        {Array.from({ length: openSlots }).map((_item, index) => {
          const slotKey = `${sideName}-reserve-${index}`;
          return (
            <Fragment key={slotKey}>
              <div className="ow-room-player-slot-wrap">
                <button
                  type="button"
                  className={canInvite ? "ow-room-player-slot empty invite" : "ow-room-player-slot empty"}
                  disabled={!canInvite}
                  onClick={(event) => onInviteSlot?.(sideName, true, slotKey, event)}
                >
                  <UserRound size={17} />
                  <span>후보 슬롯</span>
                  {canInvite ? <em>초대</em> : null}
                </button>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function RoomKickPanel({
  lobby,
  userById,
  teams,
  onKickApplicant,
  onRemovePartyPlayer,
  onSetReserve,
  onSetPlacement,
  allowSideMove = false,
  attendanceBySide = null,
  requireMissingAttendance = false,
}) {
  const rows = [];
  (lobby.entries ?? []).forEach((entry) => {
    const partyEntry = isPartyEntry(entry);
    const activeIds = entry.players ?? [];
    const reserveIds = (entry.reserves ?? []).filter((playerId) => !activeIds.includes(playerId));
    [
      ...activeIds.map((playerId) => ({ playerId, reserve: false })),
      ...reserveIds.map((playerId) => ({ playerId, reserve: true })),
    ].forEach(({ playerId, reserve }) => {
      if (!playerId || (entry.fixed && playerId === entry.playerId)) return;
      const user = userById[playerId];
      if (!user) return;
      rows.push({ entry, partyEntry, playerId, reserve, user });
    });
  });

  if (!rows.length) return null;

  return (
    <div className="ow-host-kick-panel">
      <header>
        <strong>강퇴</strong>
        <span>방장은 팀 배치 대신 퇴장만 처리한다.</span>
      </header>
      <div className="ow-host-kick-list">
        {rows.map(({ entry, partyEntry, playerId, reserve, user }) => {
          const checkedIn = Boolean(attendanceBySide?.[entry.side]?.includes(playerId));
          const kickDisabled = requireMissingAttendance && checkedIn;
          return (
            <div key={`${entry.id}-${playerId}`} className="ow-host-kick-row">
              <PlayerHoverCard user={user} teams={teams} as="span">
                <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
                <span>
                  <strong>{user.name}</strong>
                  <em>{SIDE_LABELS[entry.side]} · {reserve ? "후보" : "출전"} · {entry.team?.name ?? "개인"}</em>
                  {attendanceBySide ? <i>{checkedIn ? "출석 완료" : "미출석"}</i> : null}
                </span>
              </PlayerHoverCard>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="danger-button"
                disabled={kickDisabled}
                onClick={() => (partyEntry ? onRemovePartyPlayer(entry.id, playerId) : onKickApplicant(entry.playerId))}
              >
                강퇴
              </Button>
              {onSetReserve ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => onSetReserve(entry, playerId, !reserve)}>
                  {reserve ? "출전" : "후보"}
                </Button>
              ) : null}
              {allowSideMove && onSetPlacement ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onSetPlacement(playerId, { side: entry.side === "teamA" ? "teamB" : "teamA", reserve })}
                >
                  {entry.side === "teamA" ? "B" : "A"} 이동
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RoomChat({ messages, userById, teams, value, canChat, readOnly = false, onChange, onSubmit }) {
  return (
    <div className="ow-room-chat">
      <header>
        <span><MessageSquare size={16} /> 방 채팅</span>
        <strong>{messages.length}</strong>
      </header>
      <div className="ow-chat-list">
        {messages.length ? messages.map((message) => {
          const user = userById[message.userId];
          return (
            <div key={message.id || `${message.userId}-${message.createdAt}`} className="ow-chat-message">
              <PlayerHoverCard user={user} teams={teams} as="span">
                <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "?"}</span>
              </PlayerHoverCard>
              <span>
                <strong>{user?.name ?? "알 수 없음"} <em>{formatWhen(message.createdAt)}</em></strong>
                <b>{message.body}</b>
              </span>
            </div>
          );
        }) : (
          <div className="ow-chat-empty">아직 채팅 없음</div>
        )}
      </div>
      {!readOnly ? (
        <form className="ow-chat-form" onSubmit={onSubmit}>
          <input
            value={value}
            disabled={!canChat}
            maxLength={500}
            onChange={(event) => onChange(event.target.value)}
            placeholder={canChat ? "방 전체에 보낼 메시지" : "참여 후 채팅 가능"}
          />
          <Button type="submit" disabled={!canChat || !value.trim()}>
            <Send size={16} /> 전송
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function InvitePanel({
  sideName,
  reserve = false,
  query,
  onQueryChange,
  users,
  teams,
  userById,
  disabledPlayerIds,
  selectedPlayerIds,
  favoritePlayerIds,
  favoriteTeamIds,
  allowedTeamId = "",
  onTogglePlayer,
  onInvitePlayers,
  onToggleFavoritePlayer,
  onToggleFavoriteTeam,
  onClose,
}) {
  const matchedUser = query.trim() ? findUserByHashtag(users, query) : null;
  const matchedTeam = query.trim() ? findTeamByHashtag(teams, query) : null;
  const selectedSet = new Set(selectedPlayerIds);
  const disabledSet = new Set(disabledPlayerIds);
  const allowedTeam = allowedTeamId ? teams.find((team) => team.id === allowedTeamId) : null;
  const allowedTeamMemberIds = new Set(allowedTeam ? getSelectableTeamPlayerIds(allowedTeam) : []);
  const isAllowedPlayer = (playerId) => !allowedTeamId || allowedTeamMemberIds.has(playerId);
  const favoritePlayers = favoritePlayerIds.map((playerId) => userById[playerId]).filter(Boolean);
  const favoriteTeams = favoriteTeamIds
    .map((teamId) => teams.find((team) => team.id === teamId))
    .filter((team) => team && (!allowedTeamId || team.id === allowedTeamId));
  const teamMemberIds = matchedTeam && (!allowedTeamId || matchedTeam.id === allowedTeamId) ? getSelectableTeamPlayerIds(matchedTeam) : [];
  const selectedInvitableIds = selectedPlayerIds.filter((playerId) => !disabledSet.has(playerId) && isAllowedPlayer(playerId));

  const renderPlayerInvite = (player) => {
    const disabled = !player || disabledSet.has(player.id) || !isAllowedPlayer(player.id);
    return (
      <button key={player.id} type="button" className="ow-invite-favorite" disabled={disabled} onClick={() => onInvitePlayers([player.id], null)}>
        <PlayerHoverCard as="span" user={player} teams={teams}>
          <span className="avatar small" style={{ "--avatar": player.avatarColor }}>{player.name.slice(0, 1)}</span>
          <span>
            <strong>{player.name}</strong>
            <em>{getUserHashtag(player)}</em>
          </span>
        </PlayerHoverCard>
        <b>{disabled ? "불가" : "초대"}</b>
      </button>
    );
  };

  return (
    <div className="ow-invite-panel">
      <header>
        <div>
          <strong>{SIDE_LABELS[sideName]} {reserve ? "후보" : "빈 슬롯"} 초대</strong>
          <span>{reserve ? "수락하면 해당 사이드의 후보 선수로 들어온다." : "선착순 수락이다. 방이 차면 수락 실패."}</span>
        </div>
        <button type="button" className="ow-icon-button" aria-label="초대 닫기" onClick={onClose}><X size={18} /></button>
      </header>
      <label className="ow-invite-search">
        <Search size={17} />
        <input value={query} placeholder={allowedTeam ? `${allowedTeam.name} 팀원 해시태그` : "#minjun 또는 #noeulkings"} onChange={(event) => onQueryChange(event.target.value)} />
      </label>

      {allowedTeam ? <div className="ow-invite-empty">{allowedTeam.name} 팀원만 이 사이드에 초대할 수 있습니다.</div> : null}

      {matchedUser ? (
        <div className="ow-invite-result">
          <PlayerHoverCard as="span" user={matchedUser} teams={teams}>
            <span className="avatar small" style={{ "--avatar": matchedUser.avatarColor }}>{matchedUser.name.slice(0, 1)}</span>
            <span>
              <strong>{matchedUser.name}</strong>
              <em>{getUserHashtag(matchedUser)} · {matchedUser.position}</em>
            </span>
          </PlayerHoverCard>
          <button type="button" className={favoritePlayerIds.includes(matchedUser.id) ? "active" : ""} onClick={() => onToggleFavoritePlayer(matchedUser.id)}>
            <Star size={15} fill={favoritePlayerIds.includes(matchedUser.id) ? "currentColor" : "none"} />
          </button>
          <Button type="button" size="sm" disabled={disabledSet.has(matchedUser.id) || !isAllowedPlayer(matchedUser.id)} onClick={() => onInvitePlayers([matchedUser.id], allowedTeamId || null)}>
            <UserPlus size={16} /> 초대
          </Button>
        </div>
      ) : null}

      {matchedTeam && (!allowedTeamId || matchedTeam.id === allowedTeamId) ? (
        <div className="ow-invite-team-picker">
          <div className="ow-invite-team-head">
            <TeamHoverCard as="span" team={matchedTeam}>
              <span className="team-dot" style={{ "--team-color": matchedTeam.accent }} />
              <span>
                <strong>{matchedTeam.name}</strong>
                <em>{getTeamHashtag(matchedTeam)} · {matchedTeam.mmr} MMR</em>
              </span>
            </TeamHoverCard>
            <button type="button" className={favoriteTeamIds.includes(matchedTeam.id) ? "active" : ""} onClick={() => onToggleFavoriteTeam(matchedTeam.id)}>
              <Star size={15} fill={favoriteTeamIds.includes(matchedTeam.id) ? "currentColor" : "none"} />
            </button>
          </div>
          <div className="ow-invite-member-grid">
            {teamMemberIds.map((playerId) => {
              const player = userById[playerId];
              const selected = selectedSet.has(playerId);
              const disabled = disabledSet.has(playerId);
              return (
                <button key={playerId} type="button" className={selected ? "selected" : ""} disabled={disabled} aria-pressed={selected} onClick={() => onTogglePlayer(playerId)}>
                  <span className="avatar small" style={{ "--avatar": player?.avatarColor }}>{player?.name?.slice(0, 1) ?? "?"}</span>
                  <span>
                    <strong>{player?.name ?? "선수"}</strong>
                    <em>{disabled ? "이미 대기/초대" : getUserHashtag(player)}</em>
                  </span>
                </button>
              );
            })}
          </div>
          <Button type="button" size="sm" disabled={!selectedInvitableIds.length} onClick={() => onInvitePlayers(selectedInvitableIds, matchedTeam.id)}>
            선택 {selectedInvitableIds.length}명 초대
          </Button>
        </div>
      ) : null}

      {query.trim() && !matchedUser && !matchedTeam ? <div className="ow-invite-empty">해시태그 결과 없음</div> : null}

      <div className="ow-invite-favorites">
        <strong>즐겨찾기</strong>
        <div>
          {favoritePlayers.map(renderPlayerInvite)}
          {favoriteTeams.map((team) => (
            <button key={team.id} type="button" className="ow-invite-favorite" onClick={() => onQueryChange(getTeamHashtag(team))}>
              <TeamHoverCard as="span" team={team}>
                <span className="team-dot" style={{ "--team-color": team.accent }} />
                <span>
                  <strong>{team.name}</strong>
                  <em>{getTeamHashtag(team)}</em>
                </span>
              </TeamHoverCard>
              <b>선택</b>
            </button>
          ))}
          {!favoritePlayers.length && !favoriteTeams.length ? <em>나 메뉴에서 즐겨찾기를 저장해라.</em> : null}
        </div>
      </div>
    </div>
  );
}

function InvitationPanel({ invitations, userById, teams, currentUserId, alreadyApplied, onAccept, onDecline }) {
  const pending = invitations.filter((invitation) => invitation.status === "pending");
  if (!pending.length) return null;
  return (
    <div className="ow-invitation-list">
      <strong>초대장</strong>
      {pending.map((invitation) => {
        const target = userById[invitation.targetUserId];
        const mine = invitation.targetUserId === currentUserId;
        return (
          <div key={invitation.id} className={mine ? "mine" : ""}>
            <PlayerHoverCard as="span" user={target} teams={teams}>
              <span className="avatar small" style={{ "--avatar": target?.avatarColor }}>{target?.name?.slice(0, 1) ?? "?"}</span>
              <span>
                <b>{target?.name ?? "선수"}</b>
                <em>{SIDE_LABELS[invitation.side]} · {invitation.reserve ? "후보" : "출전"} · {getUserHashtag(target)}</em>
              </span>
            </PlayerHoverCard>
            {mine ? (
              <span className="ow-invite-actions">
                <Button type="button" size="sm" onClick={() => onAccept(invitation.id)}>수락</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onDecline(invitation.id)}>거절</Button>
              </span>
            ) : (
              <Badge tone="blue">수락 대기</Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getSourceMatchUserSideName(match, userId) {
  if (!match || !userId) return null;
  if (match.teamA?.players?.includes(userId)) return "teamA";
  if (match.teamB?.players?.includes(userId)) return "teamB";
  return null;
}

function getSourceMatchParticipantSideName(match, userId) {
  if (!match || !userId) return null;
  if (match.teamA?.players?.includes(userId) || getMatchReservePlayerIds(match, "teamA").includes(userId)) return "teamA";
  if (match.teamB?.players?.includes(userId) || getMatchReservePlayerIds(match, "teamB").includes(userId)) return "teamB";
  return null;
}

function getSourceMatchDecisionSideName(match, userId, teams = []) {
  const playerSideName = getSourceMatchUserSideName(match, userId);
  if (playerSideName) return playerSideName;
  const sideName = ["teamA", "teamB"].find((name) => {
    const teamId = match?.[name]?.teamId;
    if (!teamId) return false;
    const team = teams.find((item) => item.id === teamId);
    return getTeamCaptainId(team) === userId;
  });
  return sideName ?? null;
}

function getSourceMatchStatus(match, lobby, userId = "") {
  if (!match) return { label: "대기방", tone: lobby.canConfirm ? "green" : "blue" };
  const phase = getMatchRoomPhase(match);
  return { label: phase.label, tone: phase.tone };
}

function getSourceMatchAction(match, userId, teams = [], userById = {}) {
  const sideName = getSourceMatchDecisionSideName(match, userId, teams);
  if (!match || !sideName) return { label: "경기 정보", detail: "명단과 룰을 확인합니다." };
  const phase = getMatchRoomPhase(match);
  if (phase.phase === "locked") {
    return { label: "확정방", detail: "경기 전까지 방 수정만 가능합니다." };
  }
  if (phase.phase === "checkin") {
    return { label: "경기준비방", detail: "인원 체크 후 미출석자는 정리하고 경기 시작을 누릅니다." };
  }
  if (phase.phase === "live") {
    return { label: "경기시작", detail: "기록판이 열려 있습니다. 경기 종료 전까지 개인활약을 입력합니다." };
  }
  if (phase.phase === "postgame") {
    return { label: "경기종료", detail: "파울, 점수, 따봉을 빠르게 정리하고 기록완료를 기다립니다." };
  }
  if (phase.phase === "dispute") {
    return {
      label: "이의신청방",
      detail: "30분 안에 이의 사유를 확인하고 승인 재개 또는 무효 처리하세요.",
      disputed: true,
    };
  }
  if (phase.phase === "record") return { label: "기록방", detail: "확정된 점수, 개인활약, 파울을 열람합니다." };
  if (phase.phase === "cancelled" || phase.phase === "void") return { label: phase.label, detail: "닫힌 방입니다." };
  return { label: "경기 정보", detail: "현재 상태를 확인합니다." };
}

function SourceMatchRecordSummary({ match, userById }) {
  if (!match?.result) return null;
  const result = match.result;
  const renderSide = (sideName) => {
    const sidePlayerIds = getMatchSidePlayerIds(match, sideName);
    const playerStats = normalizePlayerStats(result.playerStats, sidePlayerIds);
    return (
    <div className="ow-source-record-side" key={sideName}>
      <strong>{match[sideName]?.name ?? SIDE_LABELS[sideName]}</strong>
      {sidePlayerIds.map((playerId) => {
        const user = userById[playerId];
        return (
          <div key={playerId}>
            <span>{user?.name ?? "플레이어"}</span>
            <em>{formatStatLine(playerStats[playerId])}</em>
          </div>
        );
      })}
    </div>
    );
  };

  return (
    <div className="ow-source-record-summary">
      <div className="ow-source-record-score">
        <span>{match.teamA?.name ?? "A"}</span>
        <strong>{Number(result.scoreA ?? match.teamA?.score ?? 0)} : {Number(result.scoreB ?? match.teamB?.score ?? 0)}</strong>
        <span>{match.teamB?.name ?? "B"}</span>
      </div>
      <div className="ow-source-record-grid">
        {["teamA", "teamB"].map(renderSide)}
      </div>
    </div>
  );
}

export function RecruitingRoomModal({ app, post, onClose, onOpenMatch = null, sourceMatch = null }) {
  const selectedPost = post;
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const [joinDraftByPost, setJoinDraftByPost] = useState({});
  const [chatDraftByPost, setChatDraftByPost] = useState({});
  const [inviteDraft, setInviteDraft] = useState(null);
  const [slotActionDraft, setSlotActionDraft] = useState(null);
  const [roomEditDraftByPost, setRoomEditDraftByPost] = useState({});

  const closeModal = () => {
    setInviteDraft(null);
    setSlotActionDraft(null);
    onClose?.();
  };
  const getJoinDraft = (roomPost) => {
    const baseDraft = getDefaultJoinDraft(roomPost, myTeams, app.currentUser, app.state);
    const storedDraft = joinDraftByPost[roomPost.id];
    if (!storedDraft) return baseDraft;
    if (!isTeamOnlyRoom(roomPost) || storedDraft.joinMode === "team") return storedDraft;
    return {
      ...baseDraft,
      ...storedDraft,
      joinMode: "team",
      teamId: storedDraft.teamId || baseDraft.teamId,
      playerIds: storedDraft.playerIds?.length ? storedDraft.playerIds : baseDraft.playerIds,
      reservePlayerIds: storedDraft.reservePlayerIds ?? baseDraft.reservePlayerIds,
    };
  };
  const updateJoinDraft = (roomPost, patch) => {
    setJoinDraftByPost((current) => ({
      ...current,
      [roomPost.id]: { ...getJoinDraft(roomPost), ...patch },
    }));
  };
  const submitJoin = (roomPost) => {
    const joinDraft = getJoinDraft(roomPost);
    app.actions.interestRecruitingPost(roomPost.id, joinDraft);
  };
  const getChatDraft = (roomPost) => chatDraftByPost[roomPost.id] ?? '';
  const updateChatDraft = (roomPost, value) => {
    setChatDraftByPost((current) => ({ ...current, [roomPost.id]: value }));
  };
  const submitChat = (event, roomPost) => {
    event.preventDefault();
    const body = getChatDraft(roomPost).trim();
    if (!body) return;
    app.actions.sendRecruitingChat(roomPost.id, body);
    updateChatDraft(roomPost, '');
  };
  const getCommandAnchor = (event) => {
    const target = event?.currentTarget;
    if (!target?.getBoundingClientRect || typeof window === 'undefined') return null;
    const rect = target.getBoundingClientRect();
    const width = Math.min(380, Math.max(280, window.innerWidth - 24));
    const halfWidth = width / 2;
    const x = Math.min(
      Math.max(rect.left + rect.width / 2, 12 + halfWidth),
      window.innerWidth - 12 - halfWidth,
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placement = spaceBelow >= 300 || spaceBelow >= spaceAbove ? 'bottom' : 'top';
    const y = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8;
    return {
      x,
      y: Math.min(Math.max(y, 12), window.innerHeight - 12),
      width,
      placement,
    };
  };
  const openInviteSlot = (roomPost, sideName, reserve = false, slotKey = '', event = null) => {
    setSlotActionDraft(null);
    setInviteDraft({ postId: roomPost.id, sideName, reserve, slotKey, query: '', selectedPlayerIds: [], anchor: getCommandAnchor(event) });
  };
  const openSelfSlotAction = (roomPost, sideName, reserve = false, playerId = '', entryId = '', event = null) => {
    setInviteDraft(null);
    setSlotActionDraft({ postId: roomPost.id, sideName, reserve, playerId, entryId, anchor: getCommandAnchor(event) });
  };
  const getRoomEditDraftByPost = (roomPost) => roomEditDraftByPost[roomPost.id] ?? null;
  const openRoomEdit = (roomPost) => {
    setRoomEditDraftByPost((current) => ({ ...current, [roomPost.id]: getRoomEditDraft(roomPost) }));
  };
  const closeRoomEdit = (roomPost) => {
    setRoomEditDraftByPost((current) => {
      const next = { ...current };
      delete next[roomPost.id];
      return next;
    });
  };
  const updateRoomEditDraft = (roomPost, patch) => {
    setRoomEditDraftByPost((current) => ({
      ...current,
      [roomPost.id]: { ...(current[roomPost.id] ?? getRoomEditDraft(roomPost)), ...patch },
    }));
  };
  const saveRoomEdit = (roomPost) => {
    const roomEditDraft = getRoomEditDraftByPost(roomPost);
    if (!roomEditDraft) return;
    if (sourceMatch) app.actions.updateMatchRoomRules(sourceMatch.id, roomEditDraft);
    else app.actions.updateRecruitingRoomRules(roomPost.id, roomEditDraft);
    closeRoomEdit(roomPost);
  };
  const updateInviteDraft = (patch) => {
    setInviteDraft((current) => (current ? { ...current, ...patch } : current));
  };
  const toggleInvitePlayer = (playerId) => {
    setInviteDraft((current) => {
      if (!current) return current;
      const selected = current.selectedPlayerIds ?? [];
      return {
        ...current,
        selectedPlayerIds: selected.includes(playerId)
          ? selected.filter((id) => id !== playerId)
          : [...selected, playerId],
      };
    });
  };
  const sendInvites = (roomPost, playerIds, teamId = null) => {
    if (!inviteDraft || !playerIds.length) return;
    app.actions.inviteRecruitingPlayers(roomPost.id, { side: inviteDraft.sideName, reserve: Boolean(inviteDraft.reserve), playerIds, teamId });
    setInviteDraft((current) => (current ? { ...current, selectedPlayerIds: [] } : current));
  };
  const confirmQueueRoom = (roomPost) => {
    const matchId = app.actions.confirmRecruitingMatch(roomPost.id);
    if (!matchId) return;
    closeModal();
    onOpenMatch?.(matchId);
  };
  if (!selectedPost) return null;

  return (() => {
        const lobby = getRecruitingLobby(selectedPost, app.state);
        const joinDraft = getJoinDraft(selectedPost);
        const teamOnlyRoom = isTeamOnlyRoom(selectedPost);
        const selectedJoinTeam = myTeams.find((team) => team.id === joinDraft.teamId) ?? myTeams[0] ?? null;
        const joinCapacity = getRecruitingSideCapacity(selectedPost);
        const selectedJoinPlayerIds = getPartyPlayerIds(selectedJoinTeam, joinDraft.playerIds, joinCapacity, app.currentUser.id);
        const selectedJoinReserveIds = getPartyReserveIds(selectedJoinTeam, joinDraft.reservePlayerIds, selectedJoinPlayerIds);
        const candidateMmr = joinDraft.joinMode === "team"
          ? getPlayerMmrAverage(selectedJoinPlayerIds, userById, selectedJoinTeam?.mmr ?? app.currentUser.ratings.integrated)
          : app.currentUser.ratings.integrated;
        const fit = getRecruitingFit(selectedPost, candidateMmr || app.currentUser.ratings.integrated, app.state);
        const matchRoom = Boolean(sourceMatch);
        const storedRoomPost = app.state.recruitingPosts?.find((item) => item.id === selectedPost.id) ?? null;
        const slotPositions = selectedPost.roomState?.slotPositions ?? {};
        const roomOwnerId = getRecruitingRoomOwnerId(selectedPost);
        const mine = roomOwnerId === app.currentUser.id;
        const myEntry = lobby.entries.find((entry) => (
          entry.players?.includes(app.currentUser.id) ||
          entry.reserves?.includes(app.currentUser.id)
        ));
        const alreadyApplied = Boolean(myEntry && !mine);
        const canInviteFromRoom = !matchRoom && isCurrentUserRoomParticipant(selectedPost, lobby, app.currentUser.id);
        const canChat = Boolean(storedRoomPost) && isCurrentUserRoomParticipant(selectedPost, lobby, app.currentUser.id);
        const teamJoinValid = joinDraft.joinMode !== "team" || (
          Boolean(selectedJoinTeam) &&
          selectedJoinPlayerIds.includes(app.currentUser.id) &&
          selectedJoinPlayerIds.length > 0 &&
          (!teamOnlyRoom || selectedJoinPlayerIds.length >= joinCapacity)
        );
        const canJoin = !matchRoom && !mine && !alreadyApplied && fit.allowed && (joinDraft.joinMode === "player" || teamJoinValid);
        const selectedRange = getRecruitingTierRange(
          getRecruitingTargetMmr(selectedPost, app.state),
          selectedPost.ranked !== false,
          selectedPost.mmrRangeMode ?? selectedPost.roomState?.mmrRangeMode,
        );
        const selectedRatingScale = getRecruitingRatingScale(selectedPost);
        const roomEditDraft = getRoomEditDraftByPost(selectedPost);
        const roomEditRange = roomEditDraft
          ? getRecruitingTierRange(getRecruitingTargetMmr(selectedPost, app.state), selectedPost.ranked !== false, roomEditDraft.mmrRangeMode)
          : null;
        const maxSideFilled = Math.max(lobby.sides.teamA.filled, lobby.sides.teamB.filled);
        const roomEditCapacityValid = !roomEditDraft || Number(roomEditDraft.sideCapacity) >= maxSideFilled;
        const playingIds = [...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers];
        const partyJoinOptions = getSameSidePartyOptions(lobby, myEntry, myTeams);
        const sidePartyJoinOptions = getJoinableSidePartyOptions(lobby, myTeams, app.currentUser.id);
        const roomState = selectedPost.roomState ?? {};
        const recorderIds = getLobbyRecorderIds(lobby);
        const chatMessages = roomState.chatMessages ?? [];
        const invitations = roomState.invitations ?? [];
        const pendingInvitations = invitations.filter((invitation) => invitation.status === "pending");
        const getEntryPartyLeaderId = (entry) => roomState.partyLeaders?.[entry?.id]
          ?? (entry?.fixed ? selectedPost.playerId : entry?.playerId)
          ?? "";
        const canManageEntry = (entry) => Boolean(isPartyEntry(entry) && getEntryPartyLeaderId(entry) === app.currentUser.id);
        const getInviteAllowedTeamId = (sideName) => {
          if (!teamOnlyRoom) return "";
          return getLobbyPrimaryTeamId(lobby, sideName) ?? "";
        };
        const canInviteSideFromRoom = (sideName) => {
          if (!canInviteFromRoom) return false;
          if (!teamOnlyRoom) return true;
          const allowedTeamId = getInviteAllowedTeamId(sideName);
          if (!allowedTeamId) return false;
          const team = teamById[allowedTeamId];
          return Boolean(team?.members?.some((member) => member.userId === app.currentUser.id));
        };
        const moveCandidate = (candidate, placement) => {
          const candidateEntry = lobby.entries.find((entry) => entry.id === candidate.entryId);
          if (isPartyEntry(candidateEntry)) {
            app.actions.setRecruitingPartyPlayerPlacement(selectedPost.id, candidate.entryId, candidate.playerId, placement);
            return;
          }
          app.actions.setRecruitingApplicantPlacement(selectedPost.id, candidate.playerId, placement);
        };
        const removeCandidate = (candidate) => {
          const candidateEntry = lobby.entries.find((entry) => entry.id === candidate.entryId);
          if (isPartyEntry(candidateEntry)) {
            app.actions.removeRecruitingPartyPlayer(selectedPost.id, candidate.entryId, candidate.playerId);
            return;
          }
          app.actions.kickRecruitingApplicant(selectedPost.id, candidate.playerId);
        };
        const disabledInvitePlayerIds = [
          app.currentUser.id,
          roomOwnerId,
          selectedPost.playerId,
          ...lobby.entries.flatMap((entry) => [entry.playerId, ...(entry.players ?? []), ...(entry.reserves ?? [])]),
          ...pendingInvitations.map((invitation) => invitation.targetUserId),
        ].filter(Boolean);
        const activeInviteDraftRaw = inviteDraft?.postId === selectedPost.id ? inviteDraft : null;
        const activeSelfSlotDraftRaw = slotActionDraft?.postId === selectedPost.id ? slotActionDraft : null;
        const favoritePlayerIds = app.state.settings?.favoritePlayerIds ?? [];
        const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
        const useSideNameHeader = selectedPost.visibility !== "private";
        const teamAMeta = getLobbySideMeta(lobby, "teamA", userById, { useSideName: useSideNameHeader });
        const teamBMeta = getLobbySideMeta(lobby, "teamB", userById, { useSideName: useSideNameHeader });
        const sourceMatchStatus = getSourceMatchStatus(sourceMatch, lobby, app.currentUser.id);
        const sourceMatchAction = getSourceMatchAction(sourceMatch, app.currentUser.id, app.state.teams, userById);
        const sourceMatchSideName = getSourceMatchDecisionSideName(sourceMatch, app.currentUser.id, app.state.teams);
        const sourceMatchParticipantSideName = getSourceMatchParticipantSideName(sourceMatch, app.currentUser.id);
        const roomTimingStatus = getPublicRoomTimingStatus(selectedPost);
        const roomQueueStatus = getRecruitingRoomStatus(lobby, { post: selectedPost, myEntry, mine });
        const needsPrivateConfirm = !matchRoom && !mine && selectedPost.visibility !== "public" && Boolean(myEntry && myEntry.status !== "ready");
        const roomReadyLabel = sourceMatch ? sourceMatchStatus.label : roomQueueStatus.label;
        const sourceMatchPhase = sourceMatch ? getMatchRoomPhase(sourceMatch) : null;
        const sourceRoomReadOnly = Boolean(matchRoom && ["dispute", "record"].includes(sourceMatchPhase?.phase));
        const activeInviteDraft = sourceRoomReadOnly ? null : activeInviteDraftRaw;
        const activeSelfSlotDraft = sourceRoomReadOnly ? null : activeSelfSlotDraftRaw;
        const canUseChat = canChat && !sourceRoomReadOnly;
        const sourceMatchStarted = Boolean(sourceMatch?.startedAt);
        const currentUserIsSourceReferee = Boolean(sourceMatch && isMatchReferee(sourceMatch, app.currentUser.id) && isEligibleReferee(app.currentUser, sourceMatch.refereeTrustMin));
        const currentUserCanOperateStartedSourceMatch = Boolean(sourceMatch && (sourceMatch.refereeId ? currentUserIsSourceReferee : mine));
        const currentUserCanStartSourceMatch = Boolean(sourceMatch && (mine || currentUserIsSourceReferee));
        const sourceMatchAttendance = {
          teamA: sourceMatch?.attendance?.teamA ?? [],
          teamB: sourceMatch?.attendance?.teamB ?? [],
        };
        const canCheckInSourceMatch = Boolean(
          matchRoom &&
          sourceMatchParticipantSideName &&
          sourceMatchPhase?.phase === "checkin" &&
          !sourceMatch?.startedAt &&
          !sourceMatch?.endedAt &&
          !sourceMatch?.result,
        );
        const sourceMatchCheckedIn = Boolean(
          sourceMatchParticipantSideName &&
          sourceMatchAttendance[sourceMatchParticipantSideName]?.includes(app.currentUser.id),
        );
        const canStartSourceMatch = Boolean(matchRoom && currentUserCanStartSourceMatch && sourceMatchPhase?.phase === "checkin" && !sourceMatch?.result && !sourceMatch?.endedAt);
        const canEndSourceMatch = Boolean(matchRoom && currentUserCanOperateStartedSourceMatch && sourceMatchPhase?.phase === "live" && !sourceMatch?.result && !sourceMatch?.endedAt && sourceMatchStarted);
        const canReviewSourceMatch = Boolean(matchRoom && !sourceRoomReadOnly && currentUserCanOperateStartedSourceMatch && sourceMatchPhase?.phase === "dispute");
        const canCancelSourceMatch = Boolean(matchRoom && sourceMatch && ["contract", "agreed"].includes(sourceMatch.status) && (sourceMatchStarted || sourceMatch.endedAt || sourceMatch.result ? currentUserCanOperateStartedSourceMatch : mine));
        const canManageMatchCheckin = Boolean(matchRoom && mine && sourceMatchPhase?.phase === "checkin" && !sourceMatch?.startedAt && !sourceMatch?.endedAt && !sourceMatch?.result);
        const showSourceMatchRecordSummary = Boolean(
          matchRoom &&
          sourceMatch?.result &&
          ["postgame", "dispute", "record"].includes(sourceMatchPhase?.phase),
        );
        const canMoveMatchSides = Boolean(canManageMatchCheckin && selectedPost.hostJoinMode !== "team");
        const roomCompetitionLabel = getRoomCompetitionLabel(selectedPost);
        const roomDisplayTitle = cleanRoomTitle(selectedPost.title, roomCompetitionLabel);
        const roomVisibilityLabel = getRoomVisibilityLabel(sourceMatch ?? selectedPost, selectedPost);
        const roomVisibilityTone = roomVisibilityLabel === "대회방" ? "gold" : roomVisibilityLabel === "비공개방" ? "blue" : "green";
        const sourceTeamSideCount = ["teamA", "teamB"].filter((sideName) => Boolean(sourceMatch?.[sideName]?.teamId)).length;
        const lobbyTeamEntryCount = (lobby.entries ?? []).filter((entry) => isPartyEntry(entry)).length;
        const teamMatchSideLocked = sourceTeamSideCount >= 2 || (selectedPost.hostJoinMode === "team" && lobbyTeamEntryCount > 0);
        const roomMatchTypeLabel = sourceTeamSideCount >= 2 || (selectedPost.visibility === "private" && lobbyTeamEntryCount >= 2)
          ? "팀전"
          : lobbyTeamEntryCount > 0 || sourceTeamSideCount > 0
            ? "팀 파티 포함"
            : "개인 매칭";
        const roomPhaseBadge = sourceMatch ? sourceMatchPhase : roomQueueStatus;
        const referee = selectedPost.refereeId ? userById[selectedPost.refereeId] : null;
        const showCaptainBadge = selectedPost.visibility === "private";
        const activeSlotDraft = activeInviteDraft?.slotKey ? activeInviteDraft : null;
        const currentUserReserve = getEntryPlayerReserveState(myEntry, app.currentUser.id);
        const currentUserInEntry = Boolean(myEntry && (
          myEntry.playerId === app.currentUser.id ||
          myEntry.players?.includes(app.currentUser.id) ||
          myEntry.reserves?.includes(app.currentUser.id)
        ));
        const currentUserInParty = Boolean(currentUserInEntry && isPartyEntry(myEntry));
        const canMoveActiveUserToSlot = (sideName, reserve) => {
          if (!myEntry || !currentUserInEntry) return false;
          const samePlacement = myEntry.side === sideName && currentUserReserve === reserve;
          if (samePlacement) return false;
          if (teamMatchSideLocked && sideName !== myEntry.side) return false;
          if (!canMovePlayerTo(lobby, app.currentUser.id, sideName, reserve)) return false;
          if (myEntry.kind === "player" && myEntry.playerId === app.currentUser.id) return true;
          if (currentUserInParty && myEntry.side === sideName) return true;
          if (currentUserInParty) return true;
          return false;
        };
        const moveActiveUserToSlot = (sideName, reserve) => {
          if (!myEntry || !currentUserInEntry) return;
          if (myEntry.kind === "player" && myEntry.playerId === app.currentUser.id) {
            app.actions.setRecruitingApplicantPlacement(selectedPost.id, app.currentUser.id, { side: sideName, reserve });
            setInviteDraft(null);
            setSlotActionDraft(null);
            return;
          }
          if (currentUserInParty && myEntry.side === sideName) {
            app.actions.setRecruitingPartyPlayerPlacement(selectedPost.id, myEntry.id, app.currentUser.id, { side: sideName, reserve });
            setInviteDraft(null);
            setSlotActionDraft(null);
            return;
          }
          if (currentUserInParty) {
            app.actions.detachRecruitingPartyPlayer(selectedPost.id, myEntry.id, app.currentUser.id, { side: sideName, reserve });
            setInviteDraft(null);
            setSlotActionDraft(null);
          }
        };
        const leaveCurrentParty = () => {
          if (!currentUserInParty || !myEntry) return;
          app.actions.detachRecruitingPartyPlayer(selectedPost.id, myEntry.id, app.currentUser.id, { side: myEntry.side, reserve: currentUserReserve });
          setSlotActionDraft(null);
        };
        const renderSlotCommand = () => {
          if (!activeSlotDraft) return null;
          const sideName = activeSlotDraft.sideName;
          const reserve = Boolean(activeSlotDraft.reserve);
          const canMoveHere = Boolean(
            canMoveActiveUserToSlot(sideName, reserve),
          );
          const targetPartyOptions = getSameSidePartyOptions(lobby, myEntry, myTeams, sideName);
          return (
            <SlotCommandPanel
              sideName={sideName}
              reserve={reserve}
              floating
              anchor={activeSlotDraft.anchor}
              canMoveHere={canMoveHere}
              partyJoinOptions={targetPartyOptions}
              onMoveHere={() => moveActiveUserToSlot(sideName, reserve)}
              onJoinParty={(teamId, entryId) => app.actions.joinRecruitingSideParty(selectedPost.id, teamId, sideName, entryId)}
              onClose={() => setInviteDraft(null)}
            >
              <InvitePanel
                sideName={activeSlotDraft.sideName}
                reserve={Boolean(activeSlotDraft.reserve)}
                query={activeSlotDraft.query}
                onQueryChange={(query) => updateInviteDraft({ query, selectedPlayerIds: [] })}
                users={app.state.users}
                teams={app.state.teams}
                userById={userById}
                disabledPlayerIds={disabledInvitePlayerIds}
                selectedPlayerIds={activeSlotDraft.selectedPlayerIds ?? []}
                favoritePlayerIds={favoritePlayerIds}
                favoriteTeamIds={favoriteTeamIds}
                allowedTeamId={getInviteAllowedTeamId(activeSlotDraft.sideName)}
                onTogglePlayer={toggleInvitePlayer}
                onInvitePlayers={(playerIds, teamId) => sendInvites(selectedPost, playerIds, teamId)}
                onToggleFavoritePlayer={(playerId) => app.actions.toggleFavoritePlayer(playerId)}
                onToggleFavoriteTeam={(teamId) => app.actions.toggleFavoriteTeam(teamId)}
                onClose={() => setInviteDraft(null)}
              />
            </SlotCommandPanel>
          );
        };
        const selfPlacementActions = [
          { side: "teamA", reserve: false, label: "A 출전" },
          { side: "teamB", reserve: false, label: "B 출전" },
          { side: "teamA", reserve: true, label: "A 후보" },
          { side: "teamB", reserve: true, label: "B 후보" },
        ];
        const renderSlotPlacementActions = (targetEntry, targetPlayerId) => {
          if (!targetEntry || !targetPlayerId) return null;
          const targetReserve = getEntryPlayerReserveState(targetEntry, targetPlayerId);
          const targetIsParty = isPartyEntry(targetEntry);
          const targetIsCurrentUser = targetPlayerId === app.currentUser.id;
          const actions = targetIsParty
            ? [
                { side: targetEntry.side, reserve: false, label: `${SIDE_LABELS[targetEntry.side]} 출전` },
                { side: targetEntry.side, reserve: true, label: `${SIDE_LABELS[targetEntry.side]} 후보` },
              ]
            : selfPlacementActions;
          return (
            <div className="ow-self-placement-actions">
              {actions.map((action) => {
                const active = targetEntry.side === action.side && targetReserve === action.reserve;
                const movable = targetIsParty
                  ? !active
                  : targetIsCurrentUser && canMoveActiveUserToSlot(action.side, action.reserve);
                return (
                  <Button
                    key={`${action.side}-${action.reserve ? "reserve" : "active"}`}
                    type="button"
                    size="sm"
                    variant={active ? "primary" : "secondary"}
                    aria-pressed={active}
                    disabled={!active && !movable}
                    onClick={() => {
                      if (active) return;
                      if (targetIsParty) {
                        app.actions.setRecruitingPartyPlayerPlacement(selectedPost.id, targetEntry.id, targetPlayerId, { side: targetEntry.side, reserve: action.reserve });
                        setSlotActionDraft(null);
                        return;
                      }
                      moveActiveUserToSlot(action.side, action.reserve);
                    }}
                  >
                    {action.label}
                  </Button>
                );
              })}
            </div>
          );
        };
        const renderSelfSlotCommand = () => {
          if (!activeSelfSlotDraft) return null;
          const targetEntry = lobby.entries.find((entry) => entry.id === activeSelfSlotDraft.entryId);
          const targetPlayerId = activeSelfSlotDraft.playerId;
          const targetUser = userById[targetPlayerId];
          const targetIsCurrentUser = targetPlayerId === app.currentUser.id;
          if (!targetEntry || !targetUser) return null;
          const canManageTarget = targetIsCurrentUser || canManageEntry(targetEntry);
          if (!canManageTarget) return null;
          const sourceTeam = targetIsCurrentUser && myEntry?.sourceTeamId ? teamById[myEntry.sourceTeamId] : null;
          const targetPartyOptions = targetIsCurrentUser ? getSameSidePartyOptions(lobby, myEntry, myTeams, activeSelfSlotDraft.sideName) : [];
          const currentSlotPosition = getRoomSlotDisplayPosition(targetUser, slotPositions, targetPlayerId, targetEntry);
          return (
            <SelfSlotCommandPanel
              entry={targetEntry}
              sideName={activeSelfSlotDraft.sideName}
              reserve={Boolean(activeSelfSlotDraft.reserve)}
              sourceTeam={sourceTeam}
              anchor={activeSelfSlotDraft.anchor}
              heading={targetIsCurrentUser ? "내 슬롯 관리" : "파티원 관리"}
              canLeaveParty={targetIsCurrentUser && currentUserInParty}
              partyJoinOptions={targetPartyOptions}
              currentPosition={currentSlotPosition}
              onPositionChange={targetIsCurrentUser ? (position) => app.actions.setRecruitingSlotPosition(selectedPost.id, targetPlayerId, position) : null}
              onLeaveParty={leaveCurrentParty}
              onJoinParty={(teamId, entryId) => {
                app.actions.joinRecruitingSideParty(selectedPost.id, teamId, activeSelfSlotDraft.sideName, entryId);
                setSlotActionDraft(null);
              }}
              onClose={() => setSlotActionDraft(null)}
            >
              {renderSlotPlacementActions(targetEntry, targetPlayerId)}
            </SelfSlotCommandPanel>
          );
        };

        return (
          <div className="ow-compose-backdrop" role="presentation" onPointerDown={() => { setInviteDraft(null); setSlotActionDraft(null); closeModal(); }}>
            <aside className="ow-lobby-modal" role="dialog" aria-modal="true" aria-label="매치방" onPointerDown={(event) => event.stopPropagation()}>
              <div className="ow-lobby-arena">
                <div className="ow-lobby-topline">
                  <div className="badge-row">
                    <Badge tone={roomPhaseBadge?.tone ?? "neutral"}>{roomPhaseBadge?.label ?? "대기방"}</Badge>
                    <Badge tone="neutral">{selectedPost.mode}</Badge>
                    <Badge tone={roomVisibilityTone}>{roomVisibilityLabel}</Badge>
                    <Badge tone="neutral">{roomMatchTypeLabel}</Badge>
                    <Badge tone={selectedPost.ranked === false ? "neutral" : "gold"}>{roomCompetitionLabel}</Badge>
                    <Badge tone={referee ? "blue" : "neutral"}>{getRoomRefereeLabel(selectedPost)}</Badge>
                  </div>
                </div>

                <div className="ow-lobby-title">
                  <h2>{roomDisplayTitle}</h2>
                  <p><MapPin size={16} /><CourtHoverCard courtName={selectedPost.court}>{selectedPost.court}</CourtHoverCard> · {getRecruitingSchedule(selectedPost)}</p>
                </div>

                <div className="ow-lobby-versus-stage">
                  <div className="ow-lobby-team-panel team-a">
                    <div className="ow-lobby-team-head">
                      <span>{teamAMeta.label}</span>
                      <strong>{teamAMeta.name}</strong>
                      <em>{teamAMeta.mmr || "-"} MMR</em>
                    </div>
                    <SideRoster
                      sideName="teamA"
                      side={lobby.sides.teamA}
                      lobby={lobby}
                      userById={userById}
                      teams={app.state.teams}
                      hostPlayerId={roomOwnerId}
                      currentUserId={app.currentUser.id}
                      showCaptainBadge={showCaptainBadge}
                      roomState={roomState}
                      slotPositions={slotPositions}
                      canInvite={!sourceRoomReadOnly && canInviteSideFromRoom("teamA")}
                      canManageEntry={sourceRoomReadOnly ? null : canManageEntry}
                      canManage={mine}
                      onInviteSlot={sourceRoomReadOnly ? null : ((sideName, reserve, slotKey, event) => openInviteSlot(selectedPost, sideName, reserve, slotKey, event))}
                      onSelfSlotAction={sourceRoomReadOnly ? null : ((sideName, reserve, playerId, entryId, event) => openSelfSlotAction(selectedPost, sideName, reserve, playerId, entryId, event))}
                      onSetPlacement={(playerId, placement) => app.actions.setRecruitingApplicantPlacement(selectedPost.id, playerId, placement)}
                      onSetMemberReserve={(entryId, playerId, reserve) => app.actions.setRecruitingPartyPlayerReserve(selectedPost.id, entryId, playerId, reserve)}
                      onDetachMember={(entryId, playerId) => app.actions.detachRecruitingPartyPlayer(selectedPost.id, entryId, playerId)}
                      onRemoveMember={(entryId, playerId) => app.actions.removeRecruitingPartyPlayer(selectedPost.id, entryId, playerId)}
                      onKick={(playerId) => app.actions.kickRecruitingApplicant(selectedPost.id, playerId)}
                      onMoveCandidate={moveCandidate}
                      onRemoveCandidate={removeCandidate}
                    />
                  </div>

                  <div className="ow-lobby-score-core">
                    <strong>{lobby.sides.teamA.projectedFilled}/{lobby.sides.teamA.capacity}</strong>
                    <i>VS</i>
                    <strong>{lobby.sides.teamB.projectedFilled}/{lobby.sides.teamB.capacity}</strong>
                    <span>{roomReadyLabel}</span>
                  </div>

                  <div className="ow-lobby-team-panel team-b">
                    <div className="ow-lobby-team-head">
                      <span>{teamBMeta.label}</span>
                      <strong>{teamBMeta.name}</strong>
                      <em>{teamBMeta.mmr || "-"} MMR</em>
                    </div>
                    <SideRoster
                      sideName="teamB"
                      side={lobby.sides.teamB}
                      lobby={lobby}
                      userById={userById}
                      teams={app.state.teams}
                      hostPlayerId={roomOwnerId}
                      currentUserId={app.currentUser.id}
                      showCaptainBadge={showCaptainBadge}
                      roomState={roomState}
                      slotPositions={slotPositions}
                      canInvite={!sourceRoomReadOnly && canInviteSideFromRoom("teamB")}
                      canManageEntry={sourceRoomReadOnly ? null : canManageEntry}
                      canManage={mine}
                      onInviteSlot={sourceRoomReadOnly ? null : ((sideName, reserve, slotKey, event) => openInviteSlot(selectedPost, sideName, reserve, slotKey, event))}
                      onSelfSlotAction={sourceRoomReadOnly ? null : ((sideName, reserve, playerId, entryId, event) => openSelfSlotAction(selectedPost, sideName, reserve, playerId, entryId, event))}
                      onSetPlacement={(playerId, placement) => app.actions.setRecruitingApplicantPlacement(selectedPost.id, playerId, placement)}
                      onSetMemberReserve={(entryId, playerId, reserve) => app.actions.setRecruitingPartyPlayerReserve(selectedPost.id, entryId, playerId, reserve)}
                      onDetachMember={(entryId, playerId) => app.actions.detachRecruitingPartyPlayer(selectedPost.id, entryId, playerId)}
                      onRemoveMember={(entryId, playerId) => app.actions.removeRecruitingPartyPlayer(selectedPost.id, entryId, playerId)}
                      onKick={(playerId) => app.actions.kickRecruitingApplicant(selectedPost.id, playerId)}
                      onMoveCandidate={moveCandidate}
                      onRemoveCandidate={removeCandidate}
                    />
                  </div>
                </div>

                <div className="ow-reserve-panel">
                  <ReserveLine
                    sideName="teamA"
                    candidates={lobby.sides.teamA.reserveCandidates}
                    playingIds={playingIds}
                    userById={userById}
                    teams={app.state.teams}
                    hostPlayerId={roomOwnerId}
                    currentUserId={app.currentUser.id}
                    showCaptainBadge={showCaptainBadge}
                    roomState={roomState}
                    slotPositions={slotPositions}
                    canInvite={!sourceRoomReadOnly && canInviteSideFromRoom("teamA")}
                    canManageEntry={sourceRoomReadOnly ? null : canManageEntry}
                    canManage={mine}
                    recorderId={recorderIds.teamA}
                    lobby={lobby}
                    onInviteSlot={sourceRoomReadOnly ? null : ((sideName, reserve, slotKey, event) => openInviteSlot(selectedPost, sideName, reserve, slotKey, event))}
                    onSelfSlotAction={sourceRoomReadOnly ? null : ((sideName, reserve, playerId, entryId, event) => openSelfSlotAction(selectedPost, sideName, reserve, playerId, entryId, event))}
                    onMoveCandidate={moveCandidate}
                    onRemoveCandidate={removeCandidate}
                  />
                  <ReserveLine
                    sideName="teamB"
                    candidates={lobby.sides.teamB.reserveCandidates}
                    playingIds={playingIds}
                    userById={userById}
                    teams={app.state.teams}
                    hostPlayerId={roomOwnerId}
                    currentUserId={app.currentUser.id}
                    showCaptainBadge={showCaptainBadge}
                    roomState={roomState}
                    slotPositions={slotPositions}
                    canInvite={!sourceRoomReadOnly && canInviteSideFromRoom("teamB")}
                    canManageEntry={sourceRoomReadOnly ? null : canManageEntry}
                    canManage={mine}
                    recorderId={recorderIds.teamB}
                    lobby={lobby}
                    onInviteSlot={sourceRoomReadOnly ? null : ((sideName, reserve, slotKey, event) => openInviteSlot(selectedPost, sideName, reserve, slotKey, event))}
                    onSelfSlotAction={sourceRoomReadOnly ? null : ((sideName, reserve, playerId, entryId, event) => openSelfSlotAction(selectedPost, sideName, reserve, playerId, entryId, event))}
                    onMoveCandidate={moveCandidate}
                    onRemoveCandidate={removeCandidate}
                  />
                </div>

                <div className="ow-lobby-actions">
                  <div><Clock3 size={17} /><span>{getRecruitingSchedule(selectedPost)}</span></div>
                  <div><UsersRound size={17} /><span>{getRecruitingSideCapacity(selectedPost)} vs {getRecruitingSideCapacity(selectedPost)}</span></div>
                  <div><ShieldCheck size={17} /><span>{selectedPost.ranked === false ? "티어 자유" : `MMR ${Math.round(selectedRatingScale * 100)}%`}</span></div>
                  <div><Swords size={17} /><span>{selectedPost.rules?.targetScore ?? 21}점 · {selectedPost.rules?.timeLimit ?? 12}분</span></div>
                </div>
              </div>
              {renderSlotCommand()}
              {renderSelfSlotCommand()}

              {activeInviteDraft && !activeInviteDraft.slotKey ? (
                <InvitePanel
                  sideName={activeInviteDraft.sideName}
                  reserve={Boolean(activeInviteDraft.reserve)}
                  query={activeInviteDraft.query}
                  onQueryChange={(query) => updateInviteDraft({ query, selectedPlayerIds: [] })}
                  users={app.state.users}
                  teams={app.state.teams}
                  userById={userById}
                  disabledPlayerIds={disabledInvitePlayerIds}
                  selectedPlayerIds={activeInviteDraft.selectedPlayerIds ?? []}
                  favoritePlayerIds={favoritePlayerIds}
                  favoriteTeamIds={favoriteTeamIds}
                  allowedTeamId={getInviteAllowedTeamId(activeInviteDraft.sideName)}
                  onTogglePlayer={toggleInvitePlayer}
                  onInvitePlayers={(playerIds, teamId) => sendInvites(selectedPost, playerIds, teamId)}
                  onToggleFavoritePlayer={(playerId) => app.actions.toggleFavoritePlayer(playerId)}
                  onToggleFavoriteTeam={(teamId) => app.actions.toggleFavoriteTeam(teamId)}
                  onClose={() => setInviteDraft(null)}
                />
              ) : null}

              {!sourceRoomReadOnly ? (
                <InvitationPanel
                  invitations={invitations}
                  userById={userById}
                  teams={app.state.teams}
                  currentUserId={app.currentUser.id}
                  alreadyApplied={alreadyApplied}
                  onAccept={(invitationId) => app.actions.acceptRecruitingInvitation(selectedPost.id, invitationId)}
                  onDecline={(invitationId) => app.actions.declineRecruitingInvitation(selectedPost.id, invitationId)}
                />
              ) : null}

              {!sourceRoomReadOnly && mine && (!matchRoom || canManageMatchCheckin) ? (
                <RoomKickPanel
                  lobby={lobby}
                  userById={userById}
                  teams={app.state.teams}
                  onKickApplicant={(playerId) => (
                    matchRoom ? app.actions.removeMatchRoomPlayer(sourceMatch.id, playerId) : app.actions.kickRecruitingApplicant(selectedPost.id, playerId)
                  )}
                  onRemovePartyPlayer={(entryId, playerId) => (
                    matchRoom ? app.actions.removeMatchRoomPlayer(sourceMatch.id, playerId) : app.actions.removeRecruitingPartyPlayer(selectedPost.id, entryId, playerId)
                  )}
                  onSetReserve={matchRoom ? ((entry, playerId, reserve) => app.actions.setMatchRoomPlayerPlacement(sourceMatch.id, playerId, { side: entry.side, reserve })) : null}
                  onSetPlacement={matchRoom ? ((playerId, placement) => app.actions.setMatchRoomPlayerPlacement(sourceMatch.id, playerId, placement)) : null}
                  allowSideMove={canMoveMatchSides}
                  attendanceBySide={matchRoom ? sourceMatchAttendance : null}
                  requireMissingAttendance={canManageMatchCheckin}
                />
              ) : null}

              <div className="ow-room-rule-panel">
                <div className="ow-room-rule-head">
                  <strong>규칙</strong>
                  {!sourceRoomReadOnly && mine && (!matchRoom || (sourceMatch && ["locked", "checkin"].includes(sourceMatchPhase?.phase) && !sourceMatch.endedAt && !sourceMatch.result)) ? (
                    <Button type="button" size="sm" variant="secondary" onClick={() => (roomEditDraft ? closeRoomEdit(selectedPost) : openRoomEdit(selectedPost))}>
                      {roomEditDraft ? "수정 닫기" : "방 수정"}
                    </Button>
                  ) : null}
                </div>
                <div className="ow-room-rule-summary">
                  <span>{getRecruitingSideCapacity(selectedPost)} vs {getRecruitingSideCapacity(selectedPost)}</span>
                  <span>{selectedPost.rules?.targetScore ?? 21}점 · {selectedPost.rules?.timeLimit ?? 12}분</span>
                  <span>{(selectedPost.rules?.winByTwo ?? true) ? "2점차" : "선착순"} · {selectedPost.rules?.ball ?? "7호 공"}</span>
                  {selectedPost.ranked !== false ? <span>{selectedRange.label}</span> : <span>친선 · 티어 자유</span>}
                </div>
                <div className="ow-room-rule-summary detail">
                  <span>공격권: {selectedPost.rules?.attackRule ?? "득점 후 공격권 교대"}</span>
                  <span>파울: {selectedPost.rules?.foulRule ?? "파울 콜 즉시 중단, 공격권 유지"}</span>
                </div>
                <div className="ow-room-referee-line">
                  <strong>심판</strong>
                  {referee ? (
                    <RefereeHoverCard user={referee} matches={app.state.matches} minTrust={selectedPost.refereeTrustMin} className="ow-room-referee-card">
                      <span className="avatar small" style={{ "--avatar": referee.avatarColor }}>{referee.name.slice(0, 1)}</span>
                      <span>{referee.name}</span>
                    </RefereeHoverCard>
                  ) : (
                    <span>없음</span>
                  )}
                </div>
                {selectedPost.stakes ? (
                  <div className="ow-details-memo">
                    <strong>약속/벌칙</strong>
                    <span>{selectedPost.stakes}</span>
                  </div>
                ) : null}
                {selectedPost.memo ? (
                  <div className="ow-details-memo">
                    <strong>경기 메모</strong>
                    <span>{selectedPost.memo}</span>
                  </div>
                ) : null}
                {!sourceRoomReadOnly && roomEditDraft ? (
                  <div className="ow-room-edit-panel">
                    <div className="ow-field-grid three">
                      <label>
                        팀당 정원
                        <select value={roomEditDraft.sideCapacity} onChange={(event) => updateRoomEditDraft(selectedPost, { sideCapacity: Number(event.target.value) })}>
                          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} vs {value}</option>)}
                        </select>
                      </label>
                      <label>
                        목표 점수
                        <input type="number" min="7" max="31" value={roomEditDraft.targetScore} onChange={(event) => updateRoomEditDraft(selectedPost, { targetScore: event.target.value })} />
                      </label>
                      <label>
                        제한 시간
                        <input type="number" min="5" max="60" value={roomEditDraft.timeLimit} onChange={(event) => updateRoomEditDraft(selectedPost, { timeLimit: event.target.value })} />
                      </label>
                      {matchRoom && sourceMatchPhase?.phase === "checkin" ? (
                        <label>
                          매치 방식
                          <select value={roomEditDraft.matchJoinMode ?? selectedPost.hostJoinMode ?? "player"} onChange={(event) => updateRoomEditDraft(selectedPost, { matchJoinMode: event.target.value })}>
                            <option value="team">팀전 유지</option>
                            <option value="player">개인전 전환</option>
                          </select>
                        </label>
                      ) : null}
                    </div>
                    <div className="ow-field-grid three">
                      <label>
                        사용 공
                        <select value={roomEditDraft.ball} onChange={(event) => updateRoomEditDraft(selectedPost, { ball: event.target.value })}>
                          <option>7호 공</option>
                          <option>6호 공</option>
                          <option>코트 공</option>
                        </select>
                      </label>
                      <label className="switch-line">
                        <input type="checkbox" checked={roomEditDraft.winByTwo} onChange={(event) => updateRoomEditDraft(selectedPost, { winByTwo: event.target.checked })} />
                        2점 차 승리
                      </label>
                      {selectedPost.ranked !== false ? (
                        <label>
                          정규전 허용구간
                          <select value={roomEditDraft.mmrRangeMode} onChange={(event) => updateRoomEditDraft(selectedPost, { mmrRangeMode: event.target.value })}>
                            {Object.entries(MMR_RANGE_POLICIES).map(([mode, policy]) => <option key={mode} value={mode}>{policy.label}</option>)}
                          </select>
                        </label>
                      ) : null}
                    </div>
                    {roomEditRange ? <small>{roomEditRange.detail}</small> : null}
                    <div className="ow-field-grid">
                      <label>
                        공격권 룰
                        <input value={roomEditDraft.attackRule} onChange={(event) => updateRoomEditDraft(selectedPost, { attackRule: event.target.value })} />
                      </label>
                      <label>
                        파울 룰
                        <input value={roomEditDraft.foulRule} onChange={(event) => updateRoomEditDraft(selectedPost, { foulRule: event.target.value })} />
                      </label>
                    </div>
                    <label>
                      약속/벌칙
                      <textarea value={roomEditDraft.stakes} onChange={(event) => updateRoomEditDraft(selectedPost, { stakes: event.target.value })} />
                    </label>
                    <label>
                      경기 메모
                      <textarea value={roomEditDraft.memo} onChange={(event) => updateRoomEditDraft(selectedPost, { memo: event.target.value })} />
                    </label>
                    {!roomEditCapacityValid ? <span className="form-warning">현재 출전 인원이 {maxSideFilled}명이라 정원을 그보다 낮출 수 없습니다.</span> : null}
                    <div className="ow-room-edit-actions">
                      <Button type="button" size="sm" variant="secondary" onClick={() => closeRoomEdit(selectedPost)}>취소</Button>
                      <Button type="button" size="sm" disabled={!roomEditCapacityValid} onClick={() => saveRoomEdit(selectedPost)}>수정 저장</Button>
                    </div>
                    <small>저장하면 방장을 제외한 참가자가 다시 수락해야 합니다.</small>
                  </div>
                ) : null}
                <span>팀 MMR은 실제 참가한 팀원 비율 기준으로 반영한다.</span>
                <span>후보가 경기 밖에서 참여 확정하면 해당 사이드 개인 활약 기록자로 배정된다.</span>
                <span>확정 후 불참하면 신뢰점수 패널티 대상이다.</span>
              </div>

              <RoomChat
                messages={chatMessages}
                userById={userById}
                teams={app.state.teams}
                value={getChatDraft(selectedPost)}
                canChat={canUseChat}
                readOnly={sourceRoomReadOnly}
                onChange={(value) => updateChatDraft(selectedPost, value)}
                onSubmit={(event) => submitChat(event, selectedPost)}
              />

              <div className="ow-join-panel">
                {matchRoom ? (
                  <div className="ow-owner-panel">
                    <strong>{sourceMatchAction.label}</strong>
                    <span>{sourceMatchAction.detail}</span>
                    {sourceMatchAction.disputed && sourceMatch?.disputes?.[0]?.reason ? (
                      <span>최근 이의: {sourceMatch.disputes[0].reason}</span>
                    ) : null}
                    {showSourceMatchRecordSummary ? (
                      <SourceMatchRecordSummary match={sourceMatch} userById={userById} />
                    ) : null}
                    {!sourceRoomReadOnly && sourceMatchAction.action && sourceMatchSideName ? (
                      <Button
                        type="button"
                        onClick={() => {
                          if (sourceMatchAction.action === "agree") app.actions.agreeMatch(sourceMatch.id, sourceMatchSideName, app.currentUser.id);
                          if (sourceMatchAction.action === "approve") app.actions.approveMatch(sourceMatch.id, sourceMatchSideName, app.currentUser.id);
                        }}
                      >
                        {sourceMatchAction.button}
                      </Button>
                    ) : null}
                    {!sourceRoomReadOnly && canCheckInSourceMatch ? (
                      <Button
                        type="button"
                        variant={sourceMatchCheckedIn ? "secondary" : "primary"}
                        disabled={sourceMatchCheckedIn}
                        onClick={() => app.actions.checkInMatchPlayer(sourceMatch.id, sourceMatchParticipantSideName, app.currentUser.id)}
                      >
                        {sourceMatchCheckedIn ? "출석 완료" : "출석체크"}
                      </Button>
                    ) : null}
                    {sourceMatchAction.disputed && canReviewSourceMatch ? (
                      <>
                        <Button type="button" onClick={() => app.actions.resumeMatchApproval(sourceMatch.id)}>
                          승인 재개
                        </Button>
                        <Button type="button" variant="secondary" className="danger-button" onClick={() => app.actions.voidMatch(sourceMatch.id)}>
                          무효 처리
                        </Button>
                      </>
                    ) : null}
                    {!sourceRoomReadOnly && canStartSourceMatch ? (
                      <Button type="button" onClick={() => app.actions.startMatch(sourceMatch.id)}>
                        경기 시작
                      </Button>
                    ) : null}
                    {!sourceRoomReadOnly && canEndSourceMatch ? (
                      <Button type="button" variant="secondary" onClick={() => app.actions.endMatch(sourceMatch.id)}>
                        경기 종료
                      </Button>
                    ) : null}
                    {!sourceRoomReadOnly && canCancelSourceMatch ? (
                      <Button type="button" variant="secondary" className="danger-button" onClick={() => app.actions.cancelMatch(sourceMatch.id)}>
                        경기 취소
                      </Button>
                    ) : null}
                  </div>
                ) : mine ? (
                  <div className="ow-owner-panel">
                    <strong>방장 권한</strong>
                    <span>{roomQueueStatus.detail}</span>
                  </div>
                ) : alreadyApplied ? (
                  <div className="ow-owner-panel">
                    <strong>참여 중</strong>
                    <span>내 슬롯을 누르면 위치 변경, 후보 이동, 파티 조작을 할 수 있습니다.</span>
                  </div>
                ) : (
                  <form className="ow-join-form" onSubmit={(event) => { event.preventDefault(); submitJoin(selectedPost); }}>
                    {sidePartyJoinOptions.length ? (
                      <div className="ow-self-placement-actions">
                        {sidePartyJoinOptions.map((option) => (
                          <Button
                            key={getPartyOptionKey(option)}
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => app.actions.joinRecruitingSideParty(selectedPost.id, option.team.id, option.sideName, option.entry?.id)}
                          >
                            {SIDE_LABELS[option.sideName]} {getPartyOptionLabel(option)} 파티 합류
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    <div className="segmented-control compact-segments">
                      {Object.entries(RECRUITING_JOIN_MODES).filter(([mode]) => !teamOnlyRoom || mode === "team").map(([mode, meta]) => (
                        <button
                          key={mode}
                          type="button"
                          className={joinDraft.joinMode === mode ? "active" : ""}
                          onClick={() => {
                            const teamId = mode === "team" ? getDefaultApplyTeamId(selectedPost, myTeams) : "";
                            const team = myTeams.find((item) => item.id === teamId) ?? null;
                            const playerIds = mode === "team" ? getDefaultTeamPlayerIds(team, joinCapacity, app.currentUser.id) : [];
                            updateJoinDraft(selectedPost, {
                              joinMode: mode,
                              teamId,
                              playerIds,
                              reservePlayerIds: mode === "team" ? getDefaultTeamReserveIds(team, playerIds) : [],
                            });
                          }}
                        >
                          {meta.label}
                        </button>
                      ))}
                    </div>
                    {joinDraft.joinMode === "team" ? (
                      <>
                        <div className="ow-team-choice-field">
                          <span>참여 팀</span>
                          {myTeams.length ? (
                            <div className="ow-team-choice-grid">
                              {myTeams.map((team) => (
                                <button
                                  key={team.id}
                                  type="button"
                                  className={joinDraft.teamId === team.id ? "selected" : ""}
                                  onClick={() => {
                                    const playerIds = getDefaultTeamPlayerIds(team, joinCapacity, app.currentUser.id);
                                    updateJoinDraft(selectedPost, {
                                      teamId: team.id,
                                      playerIds,
                                      reservePlayerIds: getDefaultTeamReserveIds(team, playerIds),
                                    });
                                  }}
                                >
                                  <strong>{team.name}</strong>
                                  <em>{team.mmr} MMR</em>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <em>내 팀 없음</em>
                          )}
                        </div>
                        <TeamMemberPicker
                          team={selectedJoinTeam}
                          userById={userById}
                          selectedIds={selectedJoinPlayerIds}
                          reserveIds={selectedJoinReserveIds}
                          capacity={joinCapacity}
                          reserveCapacity={MAX_RESERVE_PLAYERS_PER_SIDE}
                          onRosterChange={({ selectedIds: playerIds, reserveIds: reservePlayerIds }) => updateJoinDraft(selectedPost, { playerIds, reservePlayerIds })}
                          requiredPlayerId={app.currentUser.id}
                        />
                      </>
                    ) : (
                      <label>
                        포지션
                        <select value={joinDraft.position} onChange={(event) => updateJoinDraft(selectedPost, { position: event.target.value })}>
                          {PLAYER_POSITIONS.map((position) => <option key={position}>{position}</option>)}
                        </select>
                      </label>
                    )}
                    <div className="ow-field-grid">
                      <label>
                        진영
                        <select value={joinDraft.side} onChange={(event) => updateJoinDraft(selectedPost, { side: event.target.value })}>
                          <option value="teamA">A사이드</option>
                          <option value="teamB">B사이드</option>
                        </select>
                      </label>
                      <label className="ow-check-row">
                        <input type="checkbox" checked={joinDraft.reserve} onChange={(event) => updateJoinDraft(selectedPost, { reserve: event.target.checked })} />
                        <span>
                          후보로 참여
                          <small>출전선수 부족하면 자동으로 출전됩니다.</small>
                        </span>
                      </label>
                    </div>
                    <div className="ow-mini-note">
                      <div>
                        <span>{joinDraft.joinMode === "team" ? `팀 파티 ${selectedJoinPlayerIds.length}+${selectedJoinReserveIds.length}` : "개인 참여"}</span>
                        <strong>{fit.label}</strong>
                        <em>{fit.range.label}</em>
                      </div>
                      <TierBadge mmr={candidateMmr || app.currentUser.ratings.integrated} compact />
                    </div>
                    <Button type="submit" disabled={!canJoin}>
                      {joinDraft.joinMode === "team" ? <UsersRound size={18} /> : <UserRound size={18} />}
                      참여
                    </Button>
                  </form>
                )}

                {needsPrivateConfirm ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => app.actions.setRecruitingReady(selectedPost.id, true)}
                  >
                    <CheckCircle2 size={18} />
                    수락
                  </Button>
                ) : null}
                {!matchRoom && mine ? (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!lobby.canConfirm || !roomTimingStatus.canConfirm}
                    onClick={() => confirmQueueRoom(selectedPost)}
                  >
                    <Swords size={18} />
                    경기 확정
                  </Button>
                ) : null}
                {!matchRoom && alreadyApplied ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="danger-button"
                    onClick={() => app.actions.cancelRecruitingParticipation(selectedPost.id)}
                  >
                    <XCircle size={18} /> 참여 취소
                  </Button>
                ) : null}
                {!matchRoom && mine ? (
                  <Button type="button" variant="secondary" className="danger-button" onClick={() => app.actions.closeRecruitingPost(selectedPost.id)}>
                    경기 취소
                  </Button>
                ) : null}
              </div>
              <div className="ow-modal-close-row">
                <Button
                  type="button"
                  variant="secondary"
                  className="ow-modal-close-button"
                  onClick={() => { setInviteDraft(null); closeModal(); }}
                >
                  <X size={20} /> 방 닫기
                </Button>
              </div>
            </aside>
          </div>
        );
      })();
}

export default function Recruiting({ app }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetPostId = searchParams.get("post") ?? "";
  const targetFilter = searchParams.get("filter") ?? "";
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const myTeamIds = useMemo(() => myTeams.map((team) => team.id), [myTeams]);
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const [scope, setScope] = useState("local");
  const [queue, setQueue] = useState("all");
  const [roomScope, setRoomScope] = useState(() => (targetFilter === "invited" ? "invited" : "all"));
  const [modeFilter, setModeFilter] = useState("all");
  const [queueControlsOpen, setQueueControlsOpen] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [draft, setDraft] = useState(() => ({
    hostJoinMode: myTeams[0]?.id ? "team" : "player",
    title: "",
    region: app.currentUser.region,
    court: COURTS.find((court) => court.region === app.currentUser.region)?.name ?? COURTS[0].name,
    timingType: "scheduled",
    scheduledDate: getTodayInputValue(),
    scheduledTime: "20:00",
    mode: "5v5",
    ranked: true,
    mmrRangeMode: "narrow",
    teamId: myTeams[0]?.id ?? "",
    playerIds: getDefaultTeamPlayerIds(myTeams[0], getRecruitingSideCapacity({ mode: "5v5" })),
    position: app.currentUser.position,
    memo: "빈자리는 개인 또는 팀 파티로 들어올 수 있습니다.",
  }));

  const selectedTeam = myTeams.find((team) => team.id === draft.teamId) ?? myTeams[0] ?? null;
  const draftCapacity = getRecruitingSideCapacity(draft);
  const selectedHostPlayerIds = getPartyPlayerIds(selectedTeam, draft.playerIds, draftCapacity);
  const draftTargetMmr = draft.hostJoinMode === "team"
    ? selectedTeam?.mmr ?? app.currentUser.ratings.integrated
    : app.currentUser.ratings.integrated;
  const draftRange = getRecruitingTierRange(draftTargetMmr, draft.ranked, draft.mmrRangeMode);
  const draftRangePolicy = MMR_RANGE_POLICIES[draft.mmrRangeMode] ?? MMR_RANGE_POLICIES.narrow;
  const hostNeedsTeam = draft.hostJoinMode === "team";
  const draftInstant = draft.timingType === "instant";
  const hasSchedule = Boolean((draftInstant || (draft.scheduledDate && draft.scheduledTime)) && draft.court);
  const minScheduleDate = getTodayInputValue();
  const maxScheduleDate = getMaxInputValue();
  const draftTimingStatus = getPublicRoomTimingStatus(draft);
  const scheduleAllowed = draftInstant || (draft.scheduledDate >= minScheduleDate && draft.scheduledDate <= maxScheduleDate && draftTimingStatus.canCreate);
  const canPostRecruiting = hasSchedule && scheduleAllowed && (!hostNeedsTeam || (Boolean(selectedTeam) && selectedHostPlayerIds.length > 0));

  useEffect(() => {
    if (targetFilter === "invited") {
      setScope("all");
      setRoomScope("invited");
      return;
    }
    if (!targetPostId) return;
    setScope("all");
    setQueue("all");
    setModeFilter("all");
    setRoomScope("all");
  }, [targetFilter, targetPostId]);

  useEffect(() => {
    if (!hostNeedsTeam) return;
    const nextTeam = selectedTeam ?? myTeams[0] ?? null;
    if (!nextTeam) return;
    const nextPlayerIds = getPartyPlayerIds(nextTeam, draft.playerIds, draftCapacity);
    const playerIdsNeedSync = !Array.isArray(draft.playerIds)
      || draft.playerIds.length > draftCapacity
      || draft.playerIds.some((playerId) => !getSelectableTeamPlayerIds(nextTeam).includes(playerId));
    if (draft.teamId === nextTeam.id && !playerIdsNeedSync) return;
    setDraft((current) => ({
      ...current,
      teamId: nextTeam.id,
      playerIds: nextPlayerIds.length ? nextPlayerIds : getDefaultTeamPlayerIds(nextTeam, draftCapacity),
    }));
  }, [draft.teamId, draft.playerIds, draftCapacity, hostNeedsTeam, myTeams, selectedTeam]);

  const scopedPosts = useMemo(() => {
    return [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status === "open")
      .filter((post) => {
        const invited = hasPendingRecruitingInvitation(post, app.currentUser.id);
        return invited || scope !== "local" || post.region === app.currentUser.region || isNationalRecruitingPost(post, app.state);
      })
      .filter((post) => queue === "all" || (queue === "ranked" ? post.ranked !== false : post.ranked === false))
      .filter((post) => modeFilter === "all" || post.mode === modeFilter)
      .filter((post) => roomScope !== "created" || getRecruitingRoomOwnerId(post) === app.currentUser.id)
      .filter((post) => roomScope !== "joined" || (getRecruitingRoomOwnerId(post) !== app.currentUser.id && isRecruitingPostForUser(post, app.currentUser.id, myTeamIds)))
      .filter((post) => roomScope !== "invited" || hasPendingRecruitingInvitation(post, app.currentUser.id));
  }, [app.currentUser.id, app.currentUser.region, app.state, modeFilter, myTeamIds, queue, roomScope, scope]);

  const posts = useMemo(() => {
    return scopedPosts.sort((a, b) => {
      const aLocal = Number(a.region === app.currentUser.region);
      const bLocal = Number(b.region === app.currentUser.region);
      const aMine = Number(isRecruitingPostForUser(a, app.currentUser.id, myTeamIds));
      const bMine = Number(isRecruitingPostForUser(b, app.currentUser.id, myTeamIds));
      const aNational = Number(isNationalRecruitingPost(a, app.state));
      const bNational = Number(isNationalRecruitingPost(b, app.state));
      const aInstant = Number(isInstantRoom(a));
      const bInstant = Number(isInstantRoom(b));
      return bMine - aMine || bInstant - aInstant || bLocal - aLocal || bNational - aNational || new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [app.currentUser.id, app.currentUser.region, app.state, myTeamIds, scopedPosts]);

  const selectedPost = selectedPostId
    ? app.state.recruitingPosts.find((post) => post.id === selectedPostId)
    : null;
  useBodyScrollLock(Boolean(selectedPost) || composeOpen);

  useEffect(() => {
    if (!targetPostId) return;
    const targetPost = app.state.recruitingPosts.find((post) => post.id === targetPostId && post.status !== "closed");
    if (!targetPost) return;
    setSelectedPostId(targetPostId);
  }, [app.state.recruitingPosts, targetPostId]);

  useEffect(() => {
    if (!targetPostId || !posts.some((post) => post.id === targetPostId)) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`recruiting-room-${targetPostId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [posts, targetPostId]);

  const rankedCount = scopedPosts.filter((post) => post.ranked !== false).length;
  const friendlyCount = scopedPosts.length - rankedCount;
  const createdRoomCount = (app.state.recruitingPosts ?? [])
    .filter((post) => post.status === "open")
    .filter((post) => getRecruitingRoomOwnerId(post) === app.currentUser.id)
    .length;
  const joinedRoomCount = (app.state.recruitingPosts ?? [])
    .filter((post) => post.status === "open")
    .filter((post) => getRecruitingRoomOwnerId(post) !== app.currentUser.id)
    .filter((post) => isRecruitingPostForUser(post, app.currentUser.id, myTeamIds))
    .length;
  const invitedRoomCount = (app.state.recruitingPosts ?? [])
    .filter((post) => post.status === "open")
    .filter((post) => hasPendingRecruitingInvitation(post, app.currentUser.id))
    .length;

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const submit = (event) => {
    event.preventDefault();
    const nextDraft = {
      ...draft,
      title: draft.title.trim() || getDefaultTitle(draft),
      scheduledDate: draftInstant ? "" : draft.scheduledDate,
      scheduledTime: draftInstant ? "" : draft.scheduledTime,
    };
    app.actions.createRecruitingPost(nextDraft);
    setDraft((current) => ({ ...current, title: "", memo: "빈자리는 개인 또는 팀 파티로 들어올 수 있습니다." }));
    setComposeOpen(false);
  };

  const selectRoomScope = (nextScope) => {
    const target = roomScope === nextScope ? "all" : nextScope;
    setRoomScope(target);
    if (target !== "all") setScope("all");
  };

  return (
    <div className="page-stack ow-recruit-page">
      <section className="ow-recruit-hero">
        <div className="ow-hero-copy">
          <span className="ow-kicker">MATCH QUEUE</span>
          <h1>대기 매칭</h1>
          <p>개인/팀 모집을 나누지 않는다. 공개방을 열면 참가자가 개인이나 팀 파티로 들어온다.</p>
        </div>
        <div className="ow-hero-panel">
          <div className="ow-hero-stats">
            <span><strong>{scopedPosts.length}</strong>OPEN</span>
            <span><strong>{rankedCount}</strong>RANKED</span>
            <span><strong>{friendlyCount}</strong>FRIENDLY</span>
          </div>
          <Link to="/app/create">
            <Button type="button" className="ow-hero-cta">
              <PlusCircle size={18} /> 경기방 만들기
            </Button>
          </Link>
        </div>
      </section>

      <section className={queueControlsOpen ? "ow-queue-controls" : "ow-queue-controls collapsed"}>
        <div className="ow-queue-controls-head">
          <div>
            <span className="ow-kicker">QUEUE FILTER</span>
            <strong>매치방 · {posts.length}개 표시</strong>
          </div>
          <button type="button" className="ow-collapse-button" onClick={() => setQueueControlsOpen((current) => !current)}>
            {queueControlsOpen ? "접기" : "펼치기"}
          </button>
        </div>

        {queueControlsOpen ? (
          <>
            <section className="ow-filter-bar" aria-label="필터">
              <button type="button" className={scope === "local" ? "active" : ""} onClick={() => setScope("local")}>내 지역</button>
              <button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>전체 지역</button>
              <button type="button" className={roomScope === "created" ? "active" : ""} onClick={() => selectRoomScope("created")}>내가 만든 방 {createdRoomCount}</button>
              <button type="button" className={roomScope === "joined" ? "active" : ""} onClick={() => selectRoomScope("joined")}>내 참여방 {joinedRoomCount}</button>
              <button type="button" className={roomScope === "invited" ? "active" : ""} onClick={() => selectRoomScope("invited")}>초대받음 {invitedRoomCount}</button>
              <button type="button" className={queue === "all" ? "active" : ""} onClick={() => setQueue("all")}>전체</button>
              <button type="button" className={queue === "ranked" ? "active" : ""} onClick={() => setQueue("ranked")}>정규전</button>
              <button type="button" className={queue === "friendly" ? "active" : ""} onClick={() => setQueue("friendly")}>친선전</button>
              <label className="ow-filter-select">
                방식
                <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
                  <option value="all">전체</option>
                  {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                </select>
              </label>
              <span className="ow-filter-count">{posts.length}개 표시</span>
            </section>
          </>
        ) : (
          <div className="ow-queue-summary">
            <span>{scope === "local" ? "내 지역" : "전체 지역"}</span>
            <span>{queue === "ranked" ? "정규전" : queue === "friendly" ? "친선전" : "전체"}</span>
            <span>{modeFilter === "all" ? "전체 방식" : MATCH_MODES.find((mode) => mode.id === modeFilter)?.label ?? modeFilter}</span>
            <span>{roomScope === "created" ? `내가 만든 방 ${createdRoomCount}` : roomScope === "joined" ? `내 참여방 ${joinedRoomCount}` : roomScope === "invited" ? `초대받음 ${invitedRoomCount}` : "전체 방"}</span>
          </div>
        )}
      </section>

      <section className="ow-recruit-list" aria-label="매치 큐 목록">
        {posts.length ? posts.map((post) => {
          const lobby = getRecruitingLobby(post, app.state);
          const target = getRecruitingTargetMmr(post, app.state);
          const range = getRecruitingTierRange(target, post.ranked !== false, post.mmrRangeMode ?? post.roomState?.mmrRangeMode);
          const roomOwnerId = getRecruitingRoomOwnerId(post);
          const host = userById[roomOwnerId] ?? userById[post.playerId];
          const hostTeam = post.teamId ? teamById[post.teamId] : null;
          const targetTeam = post.targetTeamId ? teamById[post.targetTeamId] : null;
          const applicantEntry = { kind: "player", joinMode: "player", playerId: app.currentUser.id };
          const applied = hasRecruitingApplicant(post, applicantEntry)
            || myTeams.some((team) => hasRecruitingApplicant(post, { kind: "team", joinMode: "team", teamId: team.id }));
          const mine = roomOwnerId === app.currentUser.id;
          const myRoom = isRecruitingPostForUser(post, app.currentUser.id, myTeamIds);
          const invited = hasPendingRecruitingInvitation(post, app.currentUser.id);
          const roomTag = invited ? "초대받음" : mine ? "내가 만든 방" : myRoom ? "내 참여방" : "";
          const myEntry = lobby.entries.find((entry) => (
            entry.players?.includes(app.currentUser.id) ||
            entry.reserves?.includes(app.currentUser.id)
          ));
          const roomStatus = getRecruitingRoomListStatus(lobby, { post, myEntry, mine });

          return (
            <article
              id={`recruiting-room-${post.id}`}
              key={post.id}
              className={`ow-recruit-card ow-lobby-card ${lobby.canConfirm ? "ow-state-ready" : ""} ${myRoom ? "ow-my-room" : ""} ${invited ? "ow-invited-room" : ""} ${targetPostId === post.id ? "ow-target-room" : ""}`}
              onClick={() => setSelectedPostId(post.id)}
            >
              <div className="ow-card-main">
                <div className="ow-card-top">
                  <span className="ow-type-tag">ROOM</span>
                  {roomTag ? <span className={invited ? "ow-my-room-tag invited" : "ow-my-room-tag"}>{roomTag}</span> : null}
                  <span className={`ow-queue-pill ${post.ranked === false ? "friendly" : "ranked"}`}>{post.ranked === false ? "친선전" : "정규전"}</span>
                  <span className="ow-position-pill">{post.mode}</span>
                  {targetTeam ? <span className="ow-position-pill">희망 상대 <TeamHoverCard team={targetTeam} as="span">{targetTeam.name}</TeamHoverCard></span> : null}
                  {isNationalRecruitingPost(post, app.state) ? <span className="ow-position-pill">전국 노출</span> : null}
                </div>
                <h3>{cleanRoomTitle(post.title, post.ranked === false ? "친선전" : "정규전")}</h3>
                <div className="ow-card-meta">
                  <MapPin size={15} />
                  <span>
                    {post.region} · <CourtHoverCard courtName={post.court} className="ow-card-hover-link">{post.court}</CourtHoverCard> ·{" "}
                    {hostTeam ? (
                      <TeamHoverCard team={hostTeam} as="span" className="ow-card-hover-link">{hostTeam.name}</TeamHoverCard>
                    ) : (
                      <PlayerHoverCard user={host} teams={app.state.teams} as="span" className="ow-card-hover-link">{host?.name ?? "방장"}</PlayerHoverCard>
                    )}
                  </span>
                </div>
                <QueueRoomBoard post={post} lobby={lobby} roomStatus={roomStatus} />
                <div className="ow-card-bottom">
                  <span>{getRecruitingSchedule(post)}</span>
                  <span className="ow-tier-chip">{post.ranked === false ? "티어 자유" : range.label}</span>
                  <span>{formatWhen(post.createdAt)}</span>
                  <span className={`ow-room-list-state ${roomStatus.tone}`}>{roomStatus.label}</span>
                </div>
              </div>

              <div className="ow-card-side" onClick={(event) => event.stopPropagation()}>
                <Button type="button" className="ow-card-action" onClick={() => setSelectedPostId(post.id)}>
                  <Swords size={16} /> {roomStatus.actionLabel}
                </Button>
              </div>
            </article>
          );
        }) : (
          <div className="ow-empty-state">
            <div>
              <strong>조건에 맞는 매치방 없음</strong>
              <p>필터를 바꾸거나 새 매치방을 열어라.</p>
            </div>
          </div>
        )}
      </section>

      {selectedPost ? (
        <RecruitingRoomModal
          app={app}
          post={selectedPost}
          onClose={() => setSelectedPostId(null)}
          onOpenMatch={(matchId) => navigate(`/app/matches?match=${matchId}`)}
        />
      ) : null}

      {composeOpen ? (
        <div className="ow-compose-backdrop" role="presentation" onMouseDown={() => setComposeOpen(false)}>
          <aside className="ow-compose-drawer" role="dialog" aria-modal="true" aria-label="매치방 만들기" onMouseDown={(event) => event.stopPropagation()}>
            <div className="ow-drawer-head">
              <div>
                <span className="ow-kicker">CREATE ROOM</span>
                <h2>매치방 만들기</h2>
              </div>
              <button type="button" className="ow-icon-button" aria-label="닫기" onClick={() => setComposeOpen(false)}><X size={20} /></button>
            </div>

            <form className="ow-compose-form" onSubmit={submit}>
              <div className="segmented-control compact-segments">
                <button
                  type="button"
                  className={draft.hostJoinMode === "team" ? "active" : ""}
                  onClick={() => {
                    const team = myTeams[0] ?? null;
                    update({
                      hostJoinMode: "team",
                      teamId: team?.id ?? "",
                      playerIds: getDefaultTeamPlayerIds(team, draftCapacity),
                    });
                  }}
                >
                  내 팀으로 열기
                </button>
                <button type="button" className={draft.hostJoinMode === "player" ? "active" : ""} onClick={() => update({ hostJoinMode: "player", teamId: "", playerIds: [] })}>개인으로 열기</button>
              </div>

              <div className="segmented-control compact-segments">
                <button type="button" className={!draft.ranked ? "active" : ""} onClick={() => update({ ranked: false })}>친선전</button>
                <button type="button" className={draft.ranked ? "active" : ""} onClick={() => update({ ranked: true })}>정규전</button>
              </div>

              {draft.ranked ? (
                <div className="ow-range-control">
                  <div>
                    <span>정규전 허용구간</span>
                    <strong>{draftRange.label}</strong>
                    <em>{draftRange.detail}</em>
                  </div>
                  <div className="segmented-control compact-segments">
                    {Object.entries(MMR_RANGE_POLICIES).map(([mode, policy]) => (
                      <button
                        key={mode}
                        type="button"
                        className={draft.mmrRangeMode === mode ? "active" : ""}
                        onClick={() => update({ mmrRangeMode: mode })}
                      >
                        {policy.label}
                      </button>
                    ))}
                  </div>
                  <small>{draftRangePolicy.detail} · 경기 확정 시 MMR {Math.round(draftRangePolicy.ratingScale * 100)}% 반영</small>
                </div>
              ) : null}

              <label>
                제목
                <input value={draft.title} placeholder={getDefaultTitle(draft)} onChange={(event) => update({ title: event.target.value })} />
              </label>

              <div className="field-block">
                <span className="field-label">시간 옵션</span>
                <div className="segmented-control compact-segments">
                  <button type="button" className={draft.timingType === "scheduled" ? "active" : ""} onClick={() => update({ timingType: "scheduled" })}>일정 지정</button>
                  <button type="button" className={draft.timingType === "instant" ? "active" : ""} onClick={() => update({ timingType: "instant" })}>즉시</button>
                </div>
                <small>{draftInstant ? "지금 바로 모아서 정원 충족 시 바로 확정한다." : "공개 예약방은 5일 이내, 경기 4시간 이후만 가능하다."}</small>
              </div>

              <div className="ow-field-grid">
                {!draftInstant ? (
                  <>
                    <label>
                      날짜
                      <input type="date" required min={minScheduleDate} max={maxScheduleDate} value={draft.scheduledDate} onChange={(event) => update({ scheduledDate: event.target.value })} />
                    </label>
                    <label>
                      시간
                      <input type="time" required value={draft.scheduledTime} onChange={(event) => update({ scheduledTime: event.target.value })} />
                    </label>
                  </>
                ) : (
                  <div className="ow-mini-note">
                    <div>
                      <span>일정</span>
                      <strong>즉시</strong>
                      <em>날짜/시간 입력 없음</em>
                    </div>
                    <Clock3 size={22} />
                  </div>
                )}
              </div>

              <div className="ow-field-grid three">
                <label>
                  지역
                  <select
                    value={draft.region}
                    onChange={(event) => {
                      const region = event.target.value;
                      update({ region, court: COURTS.find((court) => court.region === region)?.name ?? draft.court });
                    }}
                  >
                    {REGIONS.map((region) => <option key={region}>{region}</option>)}
                  </select>
                </label>
                <label>
                  방식
                  <select value={draft.mode} onChange={(event) => update({ mode: event.target.value })}>
                    {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                  </select>
                </label>
                <label>
                  장소
                  <select value={draft.court} onChange={(event) => update({ court: event.target.value })}>
                    {COURTS.filter((court) => court.region === draft.region || draft.region === "전체").map((court) => (
                      <option key={court.id} value={court.name}>{court.region} · {court.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="ow-field-grid">
                {draft.hostJoinMode === "team" ? (
                  <div className="ow-party-field">
                    <label>
                      내 파티 팀
                      <select
                        value={draft.teamId}
                        onChange={(event) => {
                          const teamId = event.target.value;
                          const team = myTeams.find((item) => item.id === teamId) ?? null;
                          update({
                            teamId,
                            playerIds: getDefaultTeamPlayerIds(team, draftCapacity),
                          });
                        }}
                      >
                        {myTeams.length ? myTeams.map((team) => (
                          <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>
                        )) : <option value="">내 팀 없음</option>}
                      </select>
                    </label>
                    <TeamMemberPicker
                      team={selectedTeam}
                      userById={userById}
                      selectedIds={selectedHostPlayerIds}
                      capacity={draftCapacity}
                      onChange={(playerIds) => update({ playerIds })}
                    />
                  </div>
                ) : (
                  <label>
                    내 포지션
                    <select value={draft.position} onChange={(event) => update({ position: event.target.value })}>
                      {PLAYER_POSITIONS.map((position) => <option key={position}>{position}</option>)}
                    </select>
                  </label>
                )}
                <div className="ow-mini-note">
                  <div>
                    <span>슬롯</span>
                    <strong>{draftCapacity} vs {draftCapacity}</strong>
                    <em>{draft.hostJoinMode === "team" ? `${selectedHostPlayerIds.length}명 선택 배치` : "개인 1명이 A사이드에 배치"}</em>
                  </div>
                  <ShieldCheck size={22} />
                </div>
              </div>

              <label>
                메모
                <textarea value={draft.memo} onChange={(event) => update({ memo: event.target.value })} />
              </label>

              <div className="ow-submit-row">
                <span className={canPostRecruiting ? "queue-note" : "form-warning"}>
                  <ShieldCheck size={17} /> {canPostRecruiting ? "등록 가능" : hasSchedule ? (scheduleAllowed ? "팀/팀원 선택 필요" : draftTimingStatus.detail) : "날짜/시간/장소 필요"}
                </span>
                <Button type="submit" disabled={!canPostRecruiting}><PlusCircle size={18} /> 등록</Button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
