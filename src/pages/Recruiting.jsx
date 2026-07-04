import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  CalendarDays,
  Clock3,
  Copy,
  Crown,
  MapPin,
  MessageSquare,
  PlusCircle,
  Send,
  Share2,
  ShieldCheck,
  Swords,
  UserRound,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import CourtHoverCard from "../components/court/CourtHoverCard.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import RefereeHoverCard from "../components/referee/RefereeHoverCard.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import { getTierEmblemSrc } from "../components/rating/TierEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { MATCH_MODES, PLAYER_POSITIONS, PLAYER_STAT_FIELDS, REGIONS, getCanonicalRegion, isSameRegion } from "../lib/constants.js";
import { inferRegionSelection, REGION_TREE } from "../lib/profileSetup.js";
import { getCourtLayoutLabel, getCourtPlayWarning, getCourtSurfaceLabel, getRegisteredCourts } from "../lib/courts.js";
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
  hasPendingRecruitingInvitation,
  isRecruitingPartyEntry,
  isSoloIndividualRecruitingRoom,
  isRecruitingPostForUser,
  isNationalRecruitingPost,
} from "../lib/recruiting.js";
import { findTeamByHashtag, findUserByHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { assetUrl } from "../lib/assets.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  cleanRoomTitle,
  MATCH_DISPUTE_REASON_OPTIONS,
  OTHER_MATCH_DISPUTE_REASON,
  buildMatchDisputeRequest,
  formatStatLine,
  getRoomCompetitionLabel,
  getRoomRefereeLabel,
  getRoomVisibilityLabel,
  getMatchPlayerDisputePoints,
  getMatchRecordPlayerIds,
  getMatchRecordWindow,
  getMatchRoomPhase,
  getMatchReservePlayerIds,
  getMatchSideLeaderId,
  getMatchSidePlayerIds,
  getMatchSideRecordPlayerIds,
  getAllowedResultStatFields,
  getStatRecorderSides,
  normalizePlayerStats,
  canOperatorSubmitMissingPostgameResult,
  getPublicRoomMaxDateInput,
  getPublicRoomTimingStatus,
  getRoomScheduleLabel,
  isEligibleReferee,
  isInstantRoom,
  isMatchReferee,
} from "../lib/matchUtils.js";
import "../styles/recruiting-arena.css";
import "../styles/matches-arena.css";

const SIDE_LABELS = {
  teamA: "A사이드",
  teamB: "B사이드",
};
const CHAT_MESSAGE_MAX_LENGTH = 60;
const CHAT_SEND_COOLDOWN_MS = 3000;
const CHAT_REPEAT_BLOCK_MS = 30000;
const CHAT_RATE_WINDOW_MS = 60000;
const CHAT_RATE_LIMIT = 6;
const AUTO_RECRUITING_TITLE_PATTERN = /^(모집방|모집 중\s*\d*|정규전|친선전|대기방|매치 큐)$/;
const RECORDABLE_RESERVE_SOURCES = new Set(["reserve-entry", "team-reserve"]);
const MAX_RESERVE_PLAYERS_PER_SIDE = 2;
const ROOM_SLOT_POSITION_AVATARS = {
  PG: assetUrl("/assets/position-avatars/PG.webp"),
  SG: assetUrl("/assets/position-avatars/SG.webp"),
  SF: assetUrl("/assets/position-avatars/SF.webp"),
  PF: assetUrl("/assets/position-avatars/PF.webp"),
  C: assetUrl("/assets/position-avatars/C.webp"),
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

function getRecruitingCardTitle(post) {
  const title = cleanRoomTitle(post.title, "")
    .replace(/^(정규전|친선전)\s+(1v1|2v2|3v3|5v5)\s*/i, "")
    .replace(/\s+(1v1|2v2|3v3|5v5)$/i, "")
    .trim();
  return AUTO_RECRUITING_TITLE_PATTERN.test(title) ? "" : title;
}

function getRecruitingFallbackTitle(post = {}) {
  const competition = post.ranked === false ? "친선전" : "정규전";
  return `${competition} ${post.mode || "매치"} 매치 큐`;
}

function getRecruitingDisplayTitle(post = {}, fallback = "") {
  return getRecruitingCardTitle(post) || fallback || getRecruitingFallbackTitle(post);
}

function getTodayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStartDateFilterOptions() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateOptions = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const day = date.getDay();
    return {
      id: getDateInputValue(date),
      type: "date",
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      subLabel: index === 0 ? "오늘" : index === 1 ? "내일" : ["일", "월", "화", "수", "목", "금", "토"][day],
      weekend: day === 0 ? "sun" : day === 6 ? "sat" : "",
    };
  });
  return [{ id: "instant", type: "instant", label: "즉시", subLabel: "바로" }, ...dateOptions];
}

const RECRUITING_FILTER_PAGE_LIMIT = 50;
export const RECRUITING_ROOM_REFRESH_INTERVAL_MS = 15000;
const RECRUITING_FILTER_DEBOUNCE_MS = 250;
const RECRUITING_RELATION_SCOPES = new Set(["created", "joined", "invited"]);

function getMaxInputValue() {
  return getPublicRoomMaxDateInput();
}

function useDebouncedValue(value, delayMs) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timerId = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timerId);
  }, [delayMs, value]);

  return debouncedValue;
}

function getRecruitingSchedule(post) {
  return getRoomScheduleLabel(post);
}

function getRoomShareUrl(roomId = "") {
  const path = roomId ? `/app/recruiting?post=${encodeURIComponent(roomId)}` : "/app/recruiting";
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL;
  const fallbackBase = typeof window !== "undefined" ? window.location.origin : "";
  const base = String(configuredBase || fallbackBase).replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the selection copy path below.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

function getDefaultApplyTeamId(post, teams) {
  return teams.find((team) => isSameRegion(team.region, post.region))?.id ?? teams[0]?.id ?? "";
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

function getJoinActiveCapacity(post, lobby, sideName, reserve = false) {
  const side = lobby?.sides?.[sideName];
  if (!side) return getRecruitingSideCapacity(post);
  if (reserve) return Math.max(0, MAX_RESERVE_PLAYERS_PER_SIDE - (side.reserveCandidates?.length ?? 0));
  if (isTeamOnlyRoom(post)) return getRecruitingSideCapacity(post);
  return Math.max(0, side.capacity - side.filled);
}

function getJoinReserveCapacity(lobby, sideName) {
  const side = lobby?.sides?.[sideName];
  if (!side) return MAX_RESERVE_PLAYERS_PER_SIDE;
  return Math.max(0, MAX_RESERVE_PLAYERS_PER_SIDE - (side.reserveCandidates?.length ?? 0));
}

function getDefaultJoinRoster(post, lobby, team, currentUser, sideName, reserve = false) {
  const capacity = getJoinActiveCapacity(post, lobby, sideName, reserve);
  const playerIds = getDefaultTeamPlayerIds(team, capacity, currentUser.id);
  return {
    playerIds,
    reservePlayerIds: reserve ? [] : getDefaultTeamReserveIds(team, playerIds, getJoinReserveCapacity(lobby, sideName)),
  };
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
    court: post.court ?? "",
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
  const soloIndividualRoom = isSoloIndividualRecruitingRoom(post);
  const teamOnly = isTeamOnlyRoom(post) && !soloIndividualRoom;
  const side = getRecruitingBestSide(post, state);
  const lobby = getRecruitingLobby(post, state);
  const reserve = !teamOnly && getJoinActiveCapacity(post, lobby, side, false) <= 0 && getJoinReserveCapacity(lobby, side) > 0;
  const roster = teamOnly
    ? getDefaultJoinRoster(post, lobby, team, currentUser, side, reserve)
    : { playerIds: [], reservePlayerIds: [] };
  return {
    joinMode: teamOnly ? "team" : "player",
    teamId: teamOnly ? teamId : "",
    playerIds: roster.playerIds,
    reservePlayerIds: roster.reservePlayerIds,
    side,
    reserve,
    position: currentUser.position,
  };
}

function getEntryMmr(entry) {
  return isPartyEntry(entry)
    ? entry.team?.mmr ?? entry.user?.ratings?.integrated ?? 1200
    : entry.user?.ratings?.integrated ?? 1200;
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
  const initial = getAvatarInitial(user);

  if (isAnonymousDisplayUser(user)) {
    return <span className="avatar anonymous" style={{ "--avatar": user?.avatarColor }}>{initial}</span>;
  }

  if (!avatarSrc || failed) {
    return <span className="avatar" style={{ "--avatar": user?.avatarColor }}>{initial}</span>;
  }

  return (
    <span className="avatar arena-position-avatar" data-position={normalizedPosition} style={{ "--avatar": user?.avatarColor }}>
      <img
        className="arena-position-avatar-tier"
        src={getTierEmblemSrc(user?.ratings?.integrated ?? mmr)}
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

function getTeamCaptainId(team) {
  return team?.members?.find((member) => member.role === "captain")?.userId ?? "";
}

const ROOM_SLOT_BADGES = {
  host: { tone: "host", label: "방장" },
  partyLeader: { tone: "captain", label: "파티장" },
};

function getEntryPartyLeaderId(entry, hostPlayerId = "", roomState = {}) {
  if (!entry) return "";
  return roomState.partyLeaders?.[entry.id] ?? (entry.fixed ? hostPlayerId : entry.playerId) ?? "";
}

function getRecruitingSideLeaderId(lobby = {}, sideName = "", hostPlayerId = "", roomState = {}) {
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

function getRoomSlotBadge(playerId, entry, hostPlayerId, showCaptainBadge = false, roomState = {}, options = {}) {
  const showPartyBadge = options.showPartyBadge !== false;
  const sideLeaderId = options.sideLeaderId ?? "";
  if (!playerId) return null;
  if (playerId === hostPlayerId) return ROOM_SLOT_BADGES.host;
  if (sideLeaderId && sideLeaderId === playerId) return ROOM_SLOT_BADGES.partyLeader;
  if (!showCaptainBadge || !showPartyBadge) return null;
  if (isPartyEntry(entry) && getEntryPartyLeaderId(entry, hostPlayerId, roomState) === playerId) return ROOM_SLOT_BADGES.partyLeader;
  return null;
}

function uniqueIds(ids = []) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function isMatchSideTeamParty(match = {}, sideName = "") {
  const sourceMatch = match ?? {};
  return Boolean(sourceMatch[sideName]?.teamId) && uniqueIds([...(sourceMatch[sideName]?.players ?? []), ...getMatchReservePlayerIds(sourceMatch, sideName)]).length >= 2;
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
  return isRecruitingPartyEntry(entry);
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
      {detail ? <b>{detail}</b> : null}
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

function isCurrentUserRoomParticipant(post, lobby, currentUserId) {
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

export function getRecruitingRoomListStatus(lobby, { post = null } = {}) {
  const timingStatus = post ? getPublicRoomTimingStatus(post) : null;
  if (timingStatus?.expired) {
    return { label: "종료됨", tone: "neutral", detail: timingStatus.detail, actionLabel: "방 보기" };
  }
  if (!lobby.projectedFull) {
    return { label: "대기방", tone: "orange", detail: timingStatus?.timingType === "instant" ? "즉시 모집 중" : "빈 슬롯 모집 중", actionLabel: "방 보기" };
  }
  return { label: "정원참", tone: "neutral", detail: "빈 슬롯 없음", actionLabel: "방 보기" };
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
      <div className="arena-party-picker empty">
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
    <div className="arena-party-picker">
      <div className="arena-party-picker-head">
        <span>참여 팀원</span>
        <strong>
          출전 {selectedIds.length}/{capacity}
          {canSelectReserves ? ` · 후보 ${reserveIds.length}/${reserveCapacity}` : ""}
        </strong>
      </div>
      <div className="arena-party-picker-grid">
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
                "arena-party-member-card",
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
              <div className="arena-party-role-buttons">
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
  const rulesSource = post.rules ?? {};
  const targetScore = Number(rulesSource.targetScore ?? 21);
  const timeLimit = Number(rulesSource.timeLimit ?? 12);
  return [
    targetScore ? `${targetScore}점` : "",
    timeLimit ? `${timeLimit}분` : "",
    (rulesSource.winByTwo ?? true) ? "2점차" : "",
    rulesSource.ball ?? "7호 공",
  ].filter(Boolean).join(" · ");
}

function getRecruitingRoomTypeLabel(room = {}, lobby = null) {
  const listPartyCount = Number(room.listCounts?.partyCount);
  if (Number.isFinite(listPartyCount) && listPartyCount >= 2) return "팀전";
  if (Number.isFinite(listPartyCount) && listPartyCount > 0) return "팀 파티 포함";
  const lobbyTeamCount = lobby?.entries?.filter((entry) => isPartyEntry(entry)).length ?? 0;
  if (lobbyTeamCount >= 2) return "팀전";
  if (lobbyTeamCount > 0) return "팀 파티 포함";
  return "개인 매칭";
}

function QueueRoomBoard({ post, lobby }) {
  const filled = lobby.sides.teamA.projectedFilled + lobby.sides.teamB.projectedFilled;
  const capacity = getRecruitingSideCapacity(post) * 2;
  const ruleSummary = getRecruitingRuleSummary(post);

  return (
    <div className="om-match-summary-box count-summary">
      <div className="om-summary-line">
        <span className="om-summary-side">A {lobby.sides.teamA.projectedFilled}/{lobby.sides.teamA.capacity}</span>
        <strong>{filled}/{capacity}</strong>
        <span className="om-summary-side">B {lobby.sides.teamB.projectedFilled}/{lobby.sides.teamB.capacity}</span>
      </div>
      {ruleSummary ? <span className="om-summary-detail">{ruleSummary}</span> : null}
    </div>
  );
}

function FillSlot({ candidate, lobby, userById, teams, hostPlayerId = "", currentUserId = "", showCaptainBadge = false, roomState = {}, sideLeaderId = "", readyText = "READY", slotPositions = {}, canManageEntry = null, onSelfAction }) {
  const user = candidate ? userById[candidate.playerId] : null;
  const readyLabel = candidate?.status === "ready" ? "READY" : "WAIT";
  const entry = candidate ? (lobby.entries ?? []).find((item) => item.id === candidate.entryId) : null;
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
          <RoomSlotAvatar user={user} mmr={user.ratings?.integrated ?? 1200} position={displayPosition} />
          <strong>{user.name}</strong>
          <small>{displayPosition}</small>
          <b>{candidate.sourceLabel}</b>
          <em>{candidate.status === "ready" ? readyText : readyLabel}</em>
        </button>
      ) : (
      <PlayerHoverCard user={user} teams={teams} className={candidate.status === "ready" ? "arena-room-player-slot fill ready" : "arena-room-player-slot fill"}>
        {badge ? (
          <span className={`arena-room-slot-crown ${badge.tone}`} title={badge.label} aria-label={badge.label}>
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

export function SlotCommandPanel({ sideName, reserve = false, floating = false, anchor = null, canMoveHere = false, partyJoinOptions = [], onMoveHere, onJoinParty, onClose, children }) {
  return (
    <CommandPopoverFrame floating={floating} anchor={anchor} className="arena-slot-command-popover" onClose={onClose}>
      <header>
        <div>
          <strong>{SIDE_LABELS[sideName]} {reserve ? "후보 슬롯" : "빈 슬롯"}</strong>
          <span>이 자리로 이동하거나 초대한다.</span>
        </div>
        <button type="button" className="arena-icon-button" aria-label="닫기" onClick={onClose}><X size={16} /></button>
      </header>
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
  sideLeaderId = "",
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
        badge={getRoomSlotBadge(playerId, entry, hostPlayerId, showCaptainBadge, roomState, { sideLeaderId })}
        onSelfAction={canOpenAction ? (event) => onSelfSlotAction?.(sideName, false, playerId, entry.id, event) : null}
      />
    );
  };
  return (
    <section className="arena-side-roster">
      <header>
        <div>
          <span>{SIDE_LABELS[sideName]}</span>
          <strong>{side.projectedFilled}/{side.capacity}</strong>
        </div>
      </header>
      <div className="arena-room-slot-row" style={{ "--slot-count": 5 }}>
        {activeSlotGroups.map((group) => (
          group.type === "party" ? (
            <div
              key={`${sideName}-${group.partyKey}`}
              className="arena-room-party-group"
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
            sideLeaderId={sideLeaderId}
            slotPositions={slotPositions}
            canManageEntry={canManageEntry}
            onSelfAction={(event) => onSelfSlotAction?.(sideName, false, candidate.playerId, candidate.entryId, event)}
          />
        ))}
        {Array.from({ length: openSlots }).map((_item, index) => {
          const slotKey = `${sideName}-active-${index}`;
          return (
            <Fragment key={slotKey}>
              <div className="arena-room-player-slot-wrap">
                <button
                  type="button"
                  className={canInvite ? "arena-room-player-slot empty invite" : "arena-room-player-slot empty"}
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
  sideLeaderId = "",
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
        badge={getRoomSlotBadge(candidate.playerId, entry, hostPlayerId, showCaptainBadge, roomState, { showPartyBadge: false, sideLeaderId })}
        onSelfAction={canOpenAction ? (event) => onSelfSlotAction?.(sideName, true, candidate.playerId, candidate.entryId, event) : null}
      />
    );
  };
  return (
    <div className="arena-reserve-line">
      <strong>{SIDE_LABELS[sideName]} 후보 {candidates.length}/{MAX_RESERVE_PLAYERS_PER_SIDE}</strong>
      <div className="arena-room-reserve-row" style={{ "--slot-count": slotTrackCount }}>
        {reserveSlotGroups.map((group) => (
          group.type === "party" ? (
            <div
              key={`${sideName}-reserve-${group.partyKey}`}
              className="arena-room-party-group"
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
              <div className="arena-room-player-slot-wrap">
                <button
                  type="button"
                  className={canInvite ? "arena-room-player-slot empty invite" : "arena-room-player-slot empty"}
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
  onCheckInPlayer,
  onSetReserve,
  onSetPlacement,
  allowSideMove = false,
  attendanceBySide = null,
  requireMissingAttendance = false,
  currentUserId = "",
}) {
  const [pendingKick, setPendingKick] = useState(null);
  const rows = [];
  (lobby.entries ?? []).forEach((entry) => {
    const partyEntry = isPartyEntry(entry);
    const activeIds = entry.players ?? [];
    const reserveIds = (entry.reserves ?? []).filter((playerId) => !activeIds.includes(playerId));
    [
      ...activeIds.map((playerId) => ({ playerId, reserve: false })),
      ...reserveIds.map((playerId) => ({ playerId, reserve: true })),
    ].forEach(({ playerId, reserve }) => {
      if (!playerId || (!attendanceBySide && entry.fixed && playerId === entry.playerId)) return;
      const user = userById[playerId];
      if (!user) return;
      rows.push({ entry, partyEntry, playerId, reserve, user });
    });
  });

  if (!rows.length) return null;

  const closeKickConfirm = () => setPendingKick(null);
  const confirmKick = () => {
    if (!pendingKick) return;
    if (pendingKick.partyEntry) onRemovePartyPlayer(pendingKick.entryId, pendingKick.playerId);
    else onKickApplicant(pendingKick.playerId);
    closeKickConfirm();
  };

  return (
    <div className="arena-host-kick-panel">
      <header>
        <strong>강퇴</strong>
        <span>방장은 팀 배치 대신 퇴장만 처리한다.</span>
      </header>
      <div className="arena-host-kick-list">
        {rows.map(({ entry, partyEntry, playerId, reserve, user }) => {
          const checkedIn = Boolean(attendanceBySide?.[entry.side]?.includes(playerId));
          const selfRow = playerId === currentUserId;
          const kickDisabled = selfRow || (requireMissingAttendance && checkedIn);
          return (
            <div key={`${entry.id}-${playerId}`} className="arena-host-kick-row">
              <PlayerHoverCard user={user} teams={teams} as="span">
                <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
                <span>
                  <strong>{user.name}</strong>
                  <em>{SIDE_LABELS[entry.side]} · {reserve ? "후보" : "출전"} · {entry.team?.name ?? "개인"}</em>
                  {attendanceBySide ? <i>{checkedIn ? "출석 완료" : "미출석"}</i> : null}
                </span>
              </PlayerHoverCard>
              {attendanceBySide && onCheckInPlayer && !selfRow ? (
                <Button
                  type="button"
                  size="sm"
                  variant={checkedIn ? "secondary" : "primary"}
                  disabled={checkedIn}
                  onClick={() => onCheckInPlayer(entry.side, playerId)}
                >
                  {checkedIn ? "출석 완료" : "출석"}
                </Button>
              ) : attendanceBySide && selfRow ? <span className="form-chip">본인</span> : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="danger-button"
                disabled={kickDisabled}
                onClick={() => setPendingKick({
                  entryId: entry.id,
                  partyEntry,
                  playerId: partyEntry ? playerId : entry.playerId,
                  playerName: user.name,
                })}
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
      {pendingKick && typeof document !== "undefined" ? createPortal(
        <div className="arena-kick-confirm-backdrop" role="presentation" onMouseDown={closeKickConfirm}>
          <div className="arena-kick-confirm-dialog" role="dialog" aria-modal="true" aria-label="강퇴 확인" onMouseDown={(event) => event.stopPropagation()}>
            <strong>{pendingKick.playerName} 강퇴</strong>
            <p>강퇴하면 즉시 방에서 제외됩니다. 반복 강퇴는 방장 신뢰도를 줄일 수 있습니다.</p>
            <div>
              <Button type="button" variant="secondary" onClick={closeKickConfirm}>취소하기</Button>
              <Button type="button" variant="primary" className="danger-button" onClick={confirmKick}>강퇴하기</Button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

export function RoomChat({
  messages,
  userById,
  teams,
  value,
  canChat,
  readOnly = false,
  locked = false,
  sending = false,
  cooldown = false,
  error = "",
  onChange,
  onSubmit,
  onVisibleChange = null,
}) {
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const latestMessage = messages.at(-1);
  const latestMessageKey = latestMessage ? `${latestMessage.id || ""}:${latestMessage.createdAt || ""}:${latestMessage.body || ""}` : "";
  const inputDisabled = !canChat || sending || cooldown || locked;

  useEffect(() => {
    const node = listRef.current;
    if (!node) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [messages.length, latestMessageKey]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof onVisibleChange !== "function") return undefined;
    if (typeof IntersectionObserver === "undefined") {
      onVisibleChange(true);
      return () => onVisibleChange(false);
    }
    const observer = new IntersectionObserver(([entry]) => {
      onVisibleChange(Boolean(entry?.isIntersecting));
    }, { threshold: 0.1 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      onVisibleChange(false);
    };
  }, [onVisibleChange]);

  return (
    <div className="arena-room-chat" ref={rootRef}>
      <header>
        <span><MessageSquare size={16} /> 방 채팅</span>
        <strong>{locked ? "경기 종료됨" : messages.length}</strong>
      </header>
      <div className="arena-chat-list" ref={listRef}>
        {messages.length ? messages.map((message) => {
          const user = userById[message.userId];
          return (
            <div key={message.id || `${message.userId}-${message.createdAt}`} className="arena-chat-message">
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
          <div className="arena-chat-empty">아직 채팅 없음</div>
        )}
      </div>
      {!readOnly ? (
        <form className="arena-chat-form" onSubmit={onSubmit}>
          <input
            value={value}
            disabled={inputDisabled}
            onChange={(event) => onChange(event.target.value)}
            placeholder={locked ? "경기 종료됨" : canChat ? "방 전체에 보낼 메시지" : "참여 후 채팅 가능"}
          />
          <Button type="submit" disabled={inputDisabled || !value.trim()}>
            <Send size={16} /> 전송
          </Button>
          <small className={error ? "arena-chat-helper error" : "arena-chat-helper"}>
            {error || `${value.length}/${CHAT_MESSAGE_MAX_LENGTH}`}
          </small>
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
  canInvitePlayer = () => true,
  onTogglePlayer,
  onInvitePlayers,
  onClose,
}) {
  const matchedTeam = query.trim() ? findTeamByHashtag(teams, query) : null;
  const selectedSet = new Set(selectedPlayerIds);
  const disabledSet = new Set(disabledPlayerIds);
  const allowedTeam = allowedTeamId ? teams.find((team) => team.id === allowedTeamId) : null;
  const allowedTeamMemberIds = new Set(allowedTeam ? getSelectableTeamPlayerIds(allowedTeam) : []);
  const isAllowedPlayer = (playerId, player = null) => (
    (!allowedTeamId || allowedTeamMemberIds.has(playerId) || (player?.teamIds ?? []).includes(allowedTeamId)) &&
    canInvitePlayer(playerId, player)
  );
  const favoritePlayers = favoritePlayerIds.map((playerId) => userById[playerId]).filter(Boolean);
  const favoriteTeams = favoriteTeamIds
    .map((teamId) => teams.find((team) => team.id === teamId))
    .filter((team) => team && (!allowedTeamId || team.id === allowedTeamId));
  const teamMemberIds = matchedTeam && (!allowedTeamId || matchedTeam.id === allowedTeamId) ? getSelectableTeamPlayerIds(matchedTeam) : [];
  const selectedInvitableIds = selectedPlayerIds.filter((playerId) => !disabledSet.has(playerId) && isAllowedPlayer(playerId, userById[playerId]));
  const canShowSelectedInviteAction = Boolean(selectedInvitableIds.length && !matchedTeam);
  const selectedInviteTeamId = allowedTeamId || null;
  const selectedInviteJoinMode = allowedTeamId ? "team" : "player";
  const inviteQuery = query.trim().toLowerCase();
  const inviteSearchPlayers = inviteQuery
    ? users
      .filter((player) => isAllowedPlayer(player.id, player))
      .filter((player) => `${player.name} ${getUserHashtag(player)} ${player.region} ${player.position}`.toLowerCase().includes(inviteQuery))
      .map((player) => ({ type: "player", player }))
    : [];
  const inviteSearchTeams = inviteQuery && !allowedTeamId
    ? teams
      .filter((team) => `${team.name} ${getTeamHashtag(team)} ${team.region} ${team.homeCourt}`.toLowerCase().includes(inviteQuery))
      .map((team) => ({ type: "team", team }))
    : [];
  const inviteSearchItems = [...inviteSearchPlayers, ...inviteSearchTeams];
  const idleInviteItems = [
    ...favoritePlayers.filter((player) => isAllowedPlayer(player.id, player)).map((player) => ({ type: "player", player })),
    ...favoriteTeams.map((team) => ({ type: "team", team })),
  ];
  const getInviteItemSearchText = (item = {}) => {
    if (item.type === "team") {
      const team = item.team ?? item;
      return [team.name, getTeamHashtag(team), team.region, team.homeCourt].filter(Boolean).join(" ");
    }
    const player = item.player ?? item;
    return [player.name, getUserHashtag(player), player.handle, player.region, player.position].filter(Boolean).join(" ");
  };

  const renderInviteSearchItem = (item) => {
    if (item.type === "team") {
      const team = item.team;
      return (
        <div
          key={`team-${team.id}`}
          className="search-picker-result-row search-picker-result-row-actionable"
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" className="search-picker-result-main" onClick={() => onQueryChange(getTeamHashtag(team))}>
            <strong>{team.name}</strong>
            <span>{getTeamHashtag(team)} · {team.mmr} MMR</span>
            <em>팀</em>
          </button>
        </div>
      );
    }
    const player = item.player;
    const disabled = disabledSet.has(player.id) || !isAllowedPlayer(player.id, player);
    const selected = selectedSet.has(player.id);
    return (
      <div
        key={`player-${player.id}`}
        className={selected ? "search-picker-result-row search-picker-result-row-actionable selected" : "search-picker-result-row search-picker-result-row-actionable"}
        onMouseDown={(event) => event.preventDefault()}
      >
        <button
          type="button"
          className="search-picker-result-main"
          disabled={disabled}
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            if (!disabled) onTogglePlayer(player.id);
          }}
        >
          <strong>{player.name}</strong>
          <span>{getUserHashtag(player)} · {player.position}</span>
          <em>{disabled ? "불가" : selected ? "선택됨" : "선택"}</em>
        </button>
      </div>
    );
  };

  return (
    <div className="arena-invite-panel">
      <header>
        <div>
          <strong>{SIDE_LABELS[sideName]} {reserve ? "후보" : "빈 슬롯"} 초대</strong>
          <span>{reserve ? "수락하면 해당 사이드의 후보 선수로 들어온다." : "선착순 수락이다. 방이 차면 수락 실패."}</span>
        </div>
        <button type="button" className="arena-icon-button" aria-label="초대 닫기" onClick={onClose}><X size={18} /></button>
      </header>
      <SearchPicker
        value={query}
        onChange={onQueryChange}
        placeholder={allowedTeam ? `${allowedTeam.name} 팀원 검색` : "선수 또는 팀 검색"}
        items={inviteSearchItems}
        getSearchText={getInviteItemSearchText}
        remoteSearchType={allowedTeamId ? "profile" : ["profile", "team"]}
        remoteSearchContext={allowedTeamId ? { teamId: allowedTeamId } : null}
        mapRemoteItem={(item) => {
          if (item.kind === "team") return allowedTeamId ? null : { type: "team", team: item };
          if (!isAllowedPlayer(item.id, item)) return null;
          return { type: "player", player: item };
        }}
        idleItems={idleInviteItems}
        idleTitle="즐겨찾기"
        showIdleOnFocus
        limit={5}
        detailLimit={50}
        loadMoreStep={5}
        remoteLimit={25}
        floating
        fieldClassName="arena-invite-search"
        renderItem={renderInviteSearchItem}
      />

      {canShowSelectedInviteAction ? (
        <div className="arena-invite-actions">
          <Button type="button" size="sm" onClick={() => onInvitePlayers(selectedInvitableIds, selectedInviteTeamId, selectedInviteJoinMode)}>
            선택 {selectedInvitableIds.length}명 초대
          </Button>
        </div>
      ) : null}

      {allowedTeam ? <div className="arena-invite-empty">{allowedTeam.name} 팀원만 이 사이드에 초대할 수 있습니다.</div> : null}

      {matchedTeam && (!allowedTeamId || matchedTeam.id === allowedTeamId) ? (
        <div className="arena-invite-team-picker">
          <div className="arena-invite-team-head">
            <>
              <span className="team-dot" style={{ "--team-color": matchedTeam.accent }} />
              <span>
                <strong>{matchedTeam.name}</strong>
                <em>{getTeamHashtag(matchedTeam)} · {matchedTeam.mmr} MMR</em>
              </span>
            </>
          </div>
          <div className="arena-invite-member-grid">
            {teamMemberIds.map((playerId) => {
              const player = userById[playerId];
              const selected = selectedSet.has(playerId);
              const disabled = disabledSet.has(playerId);
              return (
                <button key={playerId} type="button" className={selected ? "selected" : ""} disabled={disabled} aria-pressed={selected} onClick={() => {
                  if (!disabled) onTogglePlayer(playerId);
                }}>
                  <span className="avatar small" style={{ "--avatar": player?.avatarColor }}>{player?.name?.slice(0, 1) ?? "?"}</span>
                  <span>
                    <strong>{player?.name ?? "선수"}</strong>
                    <em>{disabled ? "이미 대기/초대" : getUserHashtag(player)}</em>
                  </span>
                </button>
              );
            })}
          </div>
          <Button type="button" size="sm" disabled={!selectedInvitableIds.length} onClick={() => onInvitePlayers(selectedInvitableIds, matchedTeam.id, "team")}>
            선택 {selectedInvitableIds.length}명 초대
          </Button>
        </div>
      ) : null}

      {query.trim() && !inviteSearchItems.length && !matchedTeam ? <div className="arena-invite-empty">검색 결과 없음</div> : null}
    </div>
  );
}

function RefereeInvitePanel({
  query,
  onQueryChange,
  candidates,
  favoriteRefereeIds = [],
  pendingInvitations,
  userById,
  matches,
  minTrust,
  canInvite,
  canJoin,
  disabledRefereeIds = [],
  onInviteReferee,
  onJoin,
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const disabledRefereeSet = new Set(disabledRefereeIds);
  const searchItems = canInvite
    ? candidates
      .filter((user) => (
        !normalizedQuery ||
        `${user.name} ${getUserHashtag(user)} ${user.region} ${user.position} 신뢰도 ${user.trustScore}`.toLowerCase().includes(normalizedQuery)
      ))
      .slice(0, 8)
    : [];
  const favoriteReferees = favoriteRefereeIds
    .map((userId) => candidates.find((user) => user.id === userId))
    .filter(Boolean);
  const idleItems = canInvite ? (favoriteReferees.length ? favoriteReferees : candidates.slice(0, 8)) : [];
  const renderRefereeSearchItem = (user) => {
    return (
      <div
        key={user.id}
        className="search-picker-result-row search-picker-result-row-actionable"
        onMouseDown={(event) => event.preventDefault()}
      >
        <button type="button" className="search-picker-result-main" onClick={() => onInviteReferee(user.id)}>
          <span>
            <strong>{user.name}</strong>
          </span>
          <span>{getUserHashtag(user)} · 신뢰도 {user.trustScore}</span>
          <em>초대</em>
        </button>
      </div>
    );
  };

  return (
    <div className="arena-invite-panel arena-referee-invite-panel">
      <header>
        <div>
          <strong>심판 초대 슬롯</strong>
          <span>심판 자격이 있고 이 방에 참여하지 않은 사람만 초대할 수 있습니다.</span>
        </div>
        {canJoin ? (
          <Button type="button" size="sm" onClick={onJoin}>
            <ShieldCheck size={16} /> 심판참여
          </Button>
        ) : null}
      </header>

      {canInvite ? (
        <SearchPicker
          value={query}
          onChange={onQueryChange}
          placeholder="심판 이름, #해시태그, 지역 검색"
          items={searchItems}
          remoteSearchType="referee"
          mapRemoteItem={(item) => (disabledRefereeSet.has(item.id) ? null : item)}
          idleItems={idleItems}
          idleTitle={favoriteReferees.length ? "즐겨찾기 심판" : "초대 가능한 심판"}
          showIdleOnFocus
          floating
          fieldClassName="arena-invite-search"
          closeOnResultClick
          renderItem={renderRefereeSearchItem}
        />
      ) : (
        <div className="arena-invite-empty">심판 초대 권한 없음</div>
      )}

      {pendingInvitations.length ? (
        <div className="arena-referee-pending-list">
          {pendingInvitations.map((invitation) => {
            const target = userById[invitation.targetUserId];
            return (
              <span key={invitation.id}>
                {target?.name ?? "심판"} · 초대 대기
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function InvitationPanel({ invitations, userById, teams, currentUserId, alreadyApplied, onAccept, onDecline }) {
  const pending = invitations.filter((invitation) => invitation.status === "pending");
  if (!pending.length) return null;
  return (
    <div className="arena-invitation-list">
      <strong>초대장</strong>
      {pending.map((invitation) => {
        const target = userById[invitation.targetUserId];
        const mine = invitation.targetUserId === currentUserId;
        const inviteLabel = invitation.role === "referee"
          ? "심판"
          : `${SIDE_LABELS[invitation.side]} · ${invitation.reserve ? "후보" : "출전"}`;
        return (
          <div key={invitation.id} className={mine ? "mine" : ""}>
            <PlayerHoverCard as="span" user={target} teams={teams}>
              <span className="avatar small" style={{ "--avatar": target?.avatarColor }}>{target?.name?.slice(0, 1) ?? "?"}</span>
              <span>
                <b>{target?.name ?? "선수"}</b>
                <em>{inviteLabel} · {getUserHashtag(target)}</em>
              </span>
            </PlayerHoverCard>
            {mine ? (
              <span className="arena-invite-actions">
                <Button type="button" size="sm" onClick={() => onAccept(invitation)}>수락</Button>
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
  const agreedResultOpen = match.status === "agreed" && match.endedAt && match.result && !getMatchRecordWindow(match).disputeExpired;
  const effectiveStatus = agreedResultOpen ? "approval" : match.status;
  if (effectiveStatus === "contract") {
    const agreed = (match.agreements?.[sideName] ?? []).includes(userId);
    return agreed
      ? { label: "확정방", detail: "다른 참가자 READY를 기다립니다." }
      : { label: "확정방", detail: "현재 명단과 룰에 READY하면 경기준비로 넘어갑니다.", action: "agree", button: "READY" };
  }
  if (effectiveStatus === "approval") {
    const approved = (match.approvals?.[sideName] ?? []).includes(userId);
    return approved
      ? { label: "결과 승인", detail: "다른 참가자 승인만 남았습니다." }
      : { label: "결과 승인", detail: "기록과 득점 합계가 맞으면 승인합니다.", action: "approve", button: "승인" };
  }
  if (effectiveStatus === "disputed") {
    return {
      label: "이의신청방",
      detail: "30분 안에 이의 사유를 확인하고 수정안 확정 또는 무효 처리하세요.",
      disputed: true,
    };
  }
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
  if (phase.phase === "dispute") return { label: "결과 확인", detail: "이의신청 시간 안에 기록을 확인합니다." };
  if (phase.phase === "record") return { label: "기록방", detail: "확정된 점수, 개인활약, 파울을 열람합니다." };
  if (phase.phase === "cancelled" || phase.phase === "void") return { label: phase.label, detail: "닫힌 방입니다." };
  return { label: "경기 정보", detail: "현재 상태를 확인합니다." };
}

function canShowRecruitingQueuePost(post, { roomScope, currentUserId, myTeamIds, targetPostId }) {
  if (post.visibility !== "private") return true;
  if (post.id === targetPostId) return true;
  if (roomScope === "created") return getRecruitingRoomOwnerId(post) === currentUserId;
  if (roomScope === "joined") return getRecruitingRoomOwnerId(post) !== currentUserId && isRecruitingPostForUser(post, currentUserId, myTeamIds);
  if (roomScope === "invited") return hasPendingRecruitingInvitation(post, currentUserId);
  return false;
}

function normalizeRegionText(value = "") {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function stripRegionSuffix(value = "") {
  return normalizeRegionText(value).replace(/[시군구]$/u, "");
}

function getRegionAliases(user = {}) {
  const region = String(user.region ?? "");
  const regionSido = String(user.regionSido ?? "");
  const regionDistrict = String(user.regionDistrict ?? "");
  const regionParts = region.split(/\s+/).filter(Boolean);
  const districtFromRegion = regionParts.at(-1) ?? "";
  return [
    region,
    regionDistrict,
    stripRegionSuffix(regionDistrict),
    districtFromRegion,
    stripRegionSuffix(districtFromRegion),
    regionSido && regionDistrict ? `${regionSido}${regionDistrict}` : "",
    regionSido && districtFromRegion ? `${regionSido}${districtFromRegion}` : "",
  ].map(normalizeRegionText).filter(Boolean);
}

function isLocalRecruitingPost(post = {}, user = {}) {
  const postRegionKey = stripRegionSuffix(post.regionKey ?? "");
  const postRegion = normalizeRegionText(post.region);
  if (!postRegion && !postRegionKey) return false;
  const aliases = getRegionAliases(user);
  return aliases.some((alias) => {
    const aliasKey = stripRegionSuffix(alias);
    return (postRegionKey && aliasKey && postRegionKey === aliasKey)
      || (postRegion && (
        postRegion === alias
        || postRegion.includes(alias)
        || alias.includes(postRegion)
      ));
  });
}

function isRegionRecruitingPost(post = {}, regionKey = "", user = {}) {
  if (!regionKey || regionKey === "local") return isLocalRecruitingPost(post, user);
  const postRegionKey = stripRegionSuffix(post.regionKey ?? "");
  const selectedRegion = stripRegionSuffix(regionKey);
  if (postRegionKey && selectedRegion) return postRegionKey === selectedRegion;
  const postRegion = normalizeRegionText(post.region);
  return Boolean(postRegion && selectedRegion && (
    postRegion === selectedRegion ||
    postRegion.includes(selectedRegion) ||
    selectedRegion.includes(postRegion)
  ));
}

function isExpiredInstantRecruitingPost(post = {}) {
  return isInstantRoom(post) && getPublicRoomTimingStatus(post).expired;
}

function SourceMatchRecordSummary({ match, userById }) {
  if (!match?.result) return null;
  const result = match.disputeDraftResult ?? match.result;
  const getRecordSummaryNames = (sideName) => {
    const names = sideName === "teamA"
      ? match.rules?.recordSummary?.teamAPlayers
      : match.rules?.recordSummary?.teamBPlayers;
    return Array.isArray(names) ? names.map((name) => String(name ?? "").trim()) : [];
  };
  const getPlayerName = (sideName, playerId, index) => (
    userById[playerId]?.name
    || match.anonymousPlayers?.[playerId]?.name
    || getRecordSummaryNames(sideName)[index]
    || "플레이어"
  );
  const renderSide = (sideName) => {
    const sidePlayerIds = getMatchSideRecordPlayerIds(match, sideName, false);
    const playerStats = normalizePlayerStats(result.playerStats, sidePlayerIds);
    return (
    <div className="arena-source-record-side" key={sideName}>
      <strong>{match[sideName]?.name ?? SIDE_LABELS[sideName]}</strong>
      {sidePlayerIds.map((playerId, index) => (
          <div key={playerId}>
            <span>{getPlayerName(sideName, playerId, index)}</span>
            <em>{formatStatLine(playerStats[playerId])}</em>
          </div>
      ))}
    </div>
    );
  };

  return (
    <div className="arena-source-record-summary">
      <div className="arena-source-record-score">
        <span>{match.teamA?.name ?? "A"}</span>
        <strong>{Number(result.scoreA ?? match.teamA?.score ?? 0)} : {Number(result.scoreB ?? match.teamB?.score ?? 0)}</strong>
        <span>{match.teamB?.name ?? "B"}</span>
      </div>
      <div className="arena-source-record-grid">
        {["teamA", "teamB"].map(renderSide)}
      </div>
    </div>
  );
}

function makeSourceMatchDraft(match) {
  const result = match?.disputeDraftResult ?? match?.result ?? {};
  const includeReserves = getMatchRoomPhase(match).phase === "live";
  const playerIds = ["teamA", "teamB"].flatMap((sideName) => getMatchSideRecordPlayerIds(match, sideName, includeReserves));
  return {
    scoreA: Number(result.scoreA ?? match?.teamA?.score ?? 0),
    scoreB: Number(result.scoreB ?? match?.teamB?.score ?? 0),
    playerStats: normalizePlayerStats(result.playerStats, playerIds),
    statSubmissions: result.statSubmissions ?? {},
    submittedBy: result.submittedBy,
    submittedAt: result.submittedAt,
  };
}

function SourceMatchDisputeEditor({
  match,
  userById,
  canReview,
  onSave,
  onResolve = null,
  onVoid = null,
  canEditSideScore = null,
  getEditableStatFields = null,
  submitLabel = "",
}) {
  const [draft, setDraft] = useState(() => makeSourceMatchDraft(match));
  const includeReserves = getMatchRoomPhase(match).phase === "live";

  useEffect(() => {
    setDraft(makeSourceMatchDraft(match));
  }, [match?.id, match?.result?.updatedAt, match?.disputeDraftResult?.updatedAt]);

  if (!match) return null;
  const hasResult = Boolean(match.result);
  const sideNames = ["teamA", "teamB"];
  const getEditableFieldsForPlayer = (playerId) => (
    canReview
      ? PLAYER_STAT_FIELDS
      : typeof getEditableStatFields === "function"
        ? getEditableStatFields(playerId) ?? []
        : []
  );
  const canEditScore = (sideName) => (
    canReview || (typeof canEditSideScore === "function" && canEditSideScore(sideName))
  );
  const canSaveDraft = (
    canReview ||
    sideNames.some((sideName) => canEditScore(sideName)) ||
    sideNames
      .flatMap((sideName) => getMatchSideRecordPlayerIds(match, sideName, includeReserves))
      .some((playerId) => getEditableFieldsForPlayer(playerId).length > 0)
  );

  const updatePlayerStat = (playerId, fieldId, value) => {
    setDraft((current) => ({
      ...current,
      playerStats: {
        ...current.playerStats,
        [playerId]: {
          ...(current.playerStats[playerId] ?? {}),
          [fieldId]: Math.max(0, Number(value ?? 0)),
        },
      },
    }));
  };
  const getRecordSummaryNames = (sideName) => {
    const names = sideName === "teamA"
      ? match.rules?.recordSummary?.teamAPlayers
      : match.rules?.recordSummary?.teamBPlayers;
    return Array.isArray(names) ? names.map((name) => String(name ?? "").trim()) : [];
  };
  const getPlayerName = (sideName, playerId, index) => (
    userById[playerId]?.name
    || match.anonymousPlayers?.[playerId]?.name
    || getRecordSummaryNames(sideName)[index]
    || "선수"
  );

  return (
    <form className="arena-dispute-editor" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <div className="arena-dispute-score-row">
        <label>
          {match.teamA?.name ?? "A"}
          <input type="number" min="0" disabled={!canEditScore("teamA")} value={draft.scoreA} onChange={(event) => setDraft((current) => ({ ...current, scoreA: Number(event.target.value) }))} />
        </label>
        <strong>:</strong>
        <label>
          {match.teamB?.name ?? "B"}
          <input type="number" min="0" disabled={!canEditScore("teamB")} value={draft.scoreB} onChange={(event) => setDraft((current) => ({ ...current, scoreB: Number(event.target.value) }))} />
        </label>
      </div>
      <div className="arena-dispute-stat-grid">
        {["teamA", "teamB"].map((sideName) => (
          <div className="arena-dispute-side" key={sideName}>
            <strong>{match[sideName]?.name ?? SIDE_LABELS[sideName]}</strong>
            {getMatchSideRecordPlayerIds(match, sideName, includeReserves).map((playerId, index) => {
              const playerStats = draft.playerStats[playerId] ?? {};
              const editableFieldIds = new Set(getEditableFieldsForPlayer(playerId).map((field) => field.id));
              return (
                <div className="arena-dispute-player" key={playerId}>
                  <span>{getPlayerName(sideName, playerId, index)}</span>
                  <div>
                    {PLAYER_STAT_FIELDS.map((field) => (
                      <label key={field.id}>
                        {field.shortLabel}
                        <input
                          type="number"
                          min="0"
                          disabled={!editableFieldIds.has(field.id)}
                          value={Number(playerStats[field.id] ?? 0)}
                          onChange={(event) => updatePlayerStat(playerId, field.id, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="match-action-row">
        <Button type="submit" disabled={!canSaveDraft}>{submitLabel || (hasResult ? "수정안 저장" : "결과 저장")}</Button>
        {hasResult && onResolve ? <Button type="button" disabled={!canReview} onClick={() => onResolve(draft)}>수정안 확정</Button> : null}
        {hasResult && onVoid ? <Button type="button" variant="secondary" className="danger-button" disabled={!canReview} onClick={onVoid}>무효 처리</Button> : null}
      </div>
      <p className="muted">{hasResult ? "확정 후 불복은 신고로 처리합니다." : "결과 저장 후 양쪽 승인 단계로 넘어갑니다."}</p>
    </form>
  );
}

export function RecruitingRoomModal(props) {
  if (!props.app?.currentUser?.id) {
    return null;
  }
  return <RecruitingRoomModalReady {...props} />;
}

function RecruitingRoomModalReady({ app, post, onClose, onOpenMatch = null, sourceMatch = null, onInvitationAccepted = null, onJoined = null, skipInitialDetailLoad = false }) {
  const selectedPost = post;
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const courtByName = useMemo(() => Object.fromEntries(registeredCourts.map((court) => [court.name, court])), [registeredCourts]);
  const [joinDraftByPost, setJoinDraftByPost] = useState({});
  const [chatDraftByPost, setChatDraftByPost] = useState({});
  const [chatErrorByPost, setChatErrorByPost] = useState({});
  const [chatCooldownUntilByPost, setChatCooldownUntilByPost] = useState({});
  const [chatSendingPostId, setChatSendingPostId] = useState("");
  const [chatAreaVisible, setChatAreaVisible] = useState(false);
  const [inviteDraft, setInviteDraft] = useState(null);
  const [slotActionDraft, setSlotActionDraft] = useState(null);
  const [sourceDisputeDraft, setSourceDisputeDraft] = useState({
    matchId: "",
    resultKey: "",
    reason: MATCH_DISPUTE_REASON_OPTIONS[0],
    customReason: "",
    requestedPoints: "",
  });
  const [roomEditDraftByPost, setRoomEditDraftByPost] = useState({});
  const [refereeInviteQueryByPost, setRefereeInviteQueryByPost] = useState({});
  const [pendingRosterOpen, setPendingRosterOpen] = useState(null);
  const [confirmingMatchId, setConfirmingMatchId] = useState("");
  const [joiningPostId, setJoiningPostId] = useState("");
  const [roomShareStatus, setRoomShareStatus] = useState("");
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const [sheetDragSettling, setSheetDragSettling] = useState(false);
  const roomPostId = selectedPost?.id ?? "";
  const roomShareUrl = useMemo(() => getRoomShareUrl(roomPostId), [roomPostId]);
  const sourceMatchPhaseForChat = sourceMatch ? getMatchRoomPhase(sourceMatch) : null;
  const roomChatLocked = Boolean(
    selectedPost?.status === "closed" ||
    selectedPost?.confirmedAt ||
    (sourceMatch && ["record", "cancelled", "void"].includes(sourceMatchPhaseForChat?.phase)),
  );
  const modalPostDetailLoadRef = useRef("");
  const chatSendLogRef = useRef({});
  const roomShareStatusTimerRef = useRef(0);
  const lobbyModalRef = useRef(null);
  const sheetDragRef = useRef(null);
  const sheetDragTimerRef = useRef(0);

  useEffect(() => {
    if (!roomPostId) {
      modalPostDetailLoadRef.current = "";
      return;
    }
    if (!app.remoteReady || !app.currentUser.id) return;
    const refreshKey = `${roomPostId}:${app.currentUser.id}`;
    if (sourceMatch || skipInitialDetailLoad) {
      modalPostDetailLoadRef.current = refreshKey;
      return;
    }
    if (modalPostDetailLoadRef.current === refreshKey) return;
    modalPostDetailLoadRef.current = refreshKey;
    app.actions.loadRecruitingPost?.(roomPostId);
  }, [app.actions, app.currentUser.id, app.remoteReady, roomPostId, skipInitialDetailLoad, sourceMatch]);

  useEffect(() => {
    if (!sourceMatch?.id) return;
    const resultKey = sourceMatch.result?.updatedAt ?? sourceMatch.result?.submittedAt ?? "";
    setSourceDisputeDraft((current) => (
      current.matchId === sourceMatch.id && current.resultKey === resultKey
        ? current
        : {
          matchId: sourceMatch.id,
          resultKey,
          reason: MATCH_DISPUTE_REASON_OPTIONS[0],
          customReason: "",
          requestedPoints: String(getMatchPlayerDisputePoints(sourceMatch, app.currentUser.id)),
        }
    ));
  }, [app.currentUser.id, sourceMatch?.id, sourceMatch?.result?.updatedAt]);

  useEffect(() => {
    if (!roomPostId || !app.remoteReady || !app.currentUser.id || !chatAreaVisible || roomChatLocked) return undefined;
    return app.actions.pollRecruitingChat?.(roomPostId);
  }, [app.actions.pollRecruitingChat, app.currentUser.id, app.remoteReady, chatAreaVisible, roomChatLocked, roomPostId]);

  useEffect(() => {
    if (!roomPostId || !app.remoteReady || !app.currentUser.id) return undefined;
    return app.actions.subscribeRecruitingRoom?.(roomPostId);
  }, [app.actions.subscribeRecruitingRoom, app.currentUser.id, app.remoteReady, roomPostId]);

  useEffect(() => () => {
    window.clearTimeout(roomShareStatusTimerRef.current);
    window.clearTimeout(sheetDragTimerRef.current);
  }, []);

  const showRoomShareStatus = useCallback((message) => {
    setRoomShareStatus(message);
    window.clearTimeout(roomShareStatusTimerRef.current);
    roomShareStatusTimerRef.current = window.setTimeout(() => setRoomShareStatus(""), 1600);
  }, []);

  const copyRoomShareUrl = useCallback(async () => {
    try {
      const copied = await copyTextToClipboard(roomShareUrl);
      showRoomShareStatus(copied ? "URL 복사됨" : "복사 실패");
    } catch {
      showRoomShareStatus("복사 실패");
    }
  }, [roomShareUrl, showRoomShareStatus]);

  const shareRoom = useCallback(async () => {
    const title = getRecruitingDisplayTitle(selectedPost, "RankBall 매치방");
    const text = [title, selectedPost?.court, selectedPost ? getRecruitingSchedule(selectedPost) : ""].filter(Boolean).join(" · ");
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: roomShareUrl });
        showRoomShareStatus("공유창 열림");
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await copyRoomShareUrl();
  }, [copyRoomShareUrl, roomShareUrl, selectedPost, showRoomShareStatus]);

  const closeModal = () => {
    setInviteDraft(null);
    setSlotActionDraft(null);
    onClose?.();
  };
  const resetSheetDrag = () => {
    window.clearTimeout(sheetDragTimerRef.current);
    setSheetDragSettling(true);
    setSheetDragOffset(0);
    sheetDragTimerRef.current = window.setTimeout(() => setSheetDragSettling(false), 160);
  };
  const getSheetDismissDistance = () => {
    const viewportHeight = Math.max(1, window.innerHeight || 1);
    return Math.min(260, Math.max(160, viewportHeight * 0.4));
  };
  const isSheetDragInteractiveTarget = (target) => Boolean(target?.closest?.(
    "button:not(.arena-lobby-drag-handle), a, input, textarea, select, [contenteditable='true'], .arena-slot-command-popover",
  ));
  const canDismissBySheetDrag = () => {
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    const editing = Boolean(activeElement?.matches?.("input, textarea, select, [contenteditable='true']"));
    return !editing
      && !inviteDraft
      && !slotActionDraft
      && !pendingRosterOpen
      && !getRoomEditDraftByPost(selectedPost)
      && Number(lobbyModalRef.current?.scrollTop ?? 0) <= 2;
  };
  const startSheetDrag = (event) => {
    if (event.pointerType !== "touch" || !canDismissBySheetDrag()) return;
    if (isSheetDragInteractiveTarget(event.target)) return;
    window.clearTimeout(sheetDragTimerRef.current);
    setSheetDragSettling(false);
    setSheetDragOffset(0);
    sheetDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      active: false,
    };
  };
  const moveSheetDrag = (event) => {
    const drag = sheetDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - drag.startY;
    if (deltaY < -12) {
      sheetDragRef.current = null;
      return;
    }
    if (!drag.active) {
      if (deltaY <= 8) return;
      drag.active = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    setSheetDragOffset(Math.max(0, Math.min(deltaY, window.innerHeight || deltaY)));
  };
  const finishSheetDrag = (event) => {
    const drag = sheetDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sheetDragRef.current = null;
    if (!drag.active) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const deltaY = event.clientY - drag.startY;
    if (canDismissBySheetDrag() && deltaY >= getSheetDismissDistance()) {
      setSheetDragSettling(true);
      setSheetDragOffset(window.innerHeight || 720);
      sheetDragTimerRef.current = window.setTimeout(closeModal, 150);
      return;
    }
    resetSheetDrag();
  };
  const cancelSheetDrag = () => {
    const wasActive = Boolean(sheetDragRef.current?.active);
    sheetDragRef.current = null;
    if (wasActive) resetSheetDrag();
  };
  const sheetDragProgress = sheetDragOffset ? Math.min(1, sheetDragOffset / getSheetDismissDistance()) : 0;
  const sheetBackdropOpacity = 0.62 - (sheetDragProgress * 0.24);
  const sheetModalOpacity = 1 - (sheetDragProgress * 0.34);
  const submitSourceDispute = (event) => {
    event.preventDefault();
    if (!sourceMatch?.id) return;
    app.actions.disputeMatch(sourceMatch.id, buildMatchDisputeRequest({
      match: sourceMatch,
      playerId: app.currentUser.id,
      playerName: app.currentUser.name,
      requestedPoints: sourceDisputeDraft.requestedPoints,
      reason: sourceDisputeDraft.reason,
      customReason: sourceDisputeDraft.customReason,
    }));
  };
  const getRefereeInviteQuery = (roomPost) => refereeInviteQueryByPost[roomPost.id] ?? "";
  const updateRefereeInviteQuery = (roomPost, query) => {
    setRefereeInviteQueryByPost((current) => ({ ...current, [roomPost.id]: query }));
  };
  const getJoinDraft = (roomPost) => {
    const baseDraft = getDefaultJoinDraft(roomPost, myTeams, app.currentUser, app.state);
    const storedDraft = joinDraftByPost[roomPost.id];
    if (!storedDraft) return baseDraft;
    if (isSoloIndividualRecruitingRoom(roomPost) && storedDraft.joinMode === "team") {
      return {
        ...baseDraft,
        ...storedDraft,
        joinMode: "player",
        teamId: "",
        playerIds: [],
        reservePlayerIds: [],
      };
    }
    if (!isTeamOnlyRoom(roomPost) || storedDraft.joinMode === "team" || storedDraft.joinMode === "referee") return storedDraft;
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
  const submitJoin = async (roomPost) => {
    if (!roomPost?.id || joiningPostId === roomPost.id) return false;
    const joinDraft = getJoinDraft(roomPost);
    const lobby = getRecruitingLobby(roomPost, app.state);
    const shouldReserve = joinDraft.joinMode !== "referee" &&
      !isTeamOnlyRoom(roomPost) &&
      !joinDraft.reserve &&
      getJoinActiveCapacity(roomPost, lobby, joinDraft.side, false) <= 0 &&
      getJoinReserveCapacity(lobby, joinDraft.side) > 0;
    const application = shouldReserve ? { ...joinDraft, reserve: true } : joinDraft;
    setJoiningPostId(roomPost.id);
    try {
      const result = await app.actions.interestRecruitingPost(roomPost.id, application);
      if (result && result.ok !== false) onJoined?.(roomPost.id, result);
      return result;
    } finally {
      setJoiningPostId((current) => (current === roomPost.id ? "" : current));
    }
  };
  const getChatDraft = (roomPost) => chatDraftByPost[roomPost.id] ?? '';
  const updateChatDraft = (roomPost, value) => {
    setChatDraftByPost((current) => ({ ...current, [roomPost.id]: value }));
    setChatErrorByPost((current) => current[roomPost.id] ? { ...current, [roomPost.id]: "" } : current);
  };
  const setChatError = (postId, message) => {
    setChatErrorByPost((current) => ({ ...current, [postId]: message }));
  };
  const clearChatCooldown = (postId, until) => {
    window.setTimeout(() => {
      setChatCooldownUntilByPost((current) => (
        current[postId] === until ? { ...current, [postId]: 0 } : current
      ));
    }, Math.max(0, until - Date.now()));
  };
  const handleChatVisibleChange = useCallback((visible) => {
    setChatAreaVisible(visible);
  }, []);
  const submitChat = async (event, roomPost) => {
    event.preventDefault();
    if (!roomPost?.id || roomChatLocked) return;
    const postId = roomPost.id;
    const body = getChatDraft(roomPost).trim();
    if (!body) return;
    if (body.includes("\n") || body.includes("\r")) {
      setChatError(postId, "한 줄로 입력해주세요.");
      return;
    }
    if (body.length > CHAT_MESSAGE_MAX_LENGTH) {
      setChatError(postId, "60자 이내로 입력해주세요.");
      return;
    }
    const now = Date.now();
    if (chatSendingPostId === postId || Number(chatCooldownUntilByPost[postId] ?? 0) > now) {
      setChatError(postId, "잠시 후 다시 입력해주세요.");
      return;
    }
    const recentLog = (chatSendLogRef.current[postId] ?? []).filter((item) => now - item.at < CHAT_RATE_WINDOW_MS);
    if (recentLog.some((item) => item.body === body && now - item.at < CHAT_REPEAT_BLOCK_MS)) {
      setChatError(postId, "잠시 후 다시 입력해주세요.");
      return;
    }
    if (recentLog.length >= CHAT_RATE_LIMIT) {
      setChatError(postId, "잠시 후 다시 입력해주세요.");
      return;
    }
    setChatSendingPostId(postId);
    updateChatDraft(roomPost, "");
    try {
      const result = await app.actions.sendRecruitingChat(roomPost.id, body);
      if (result?.ok === false) throw new Error(result.error || "chat_send_failed");
      chatSendLogRef.current[postId] = [...recentLog, { body, at: now }];
      const cooldownUntil = Date.now() + CHAT_SEND_COOLDOWN_MS;
      setChatCooldownUntilByPost((current) => ({ ...current, [postId]: cooldownUntil }));
      clearChatCooldown(postId, cooldownUntil);
    } catch (error) {
      setChatError(postId, "잠시 후 다시 입력해주세요.");
    } finally {
      setChatSendingPostId((current) => (current === postId ? "" : current));
    }
  };
  const getCommandAnchor = (event) => {
    const target = event?.currentTarget;
    if (!target?.getBoundingClientRect || typeof window === 'undefined') return null;
    const rect = target.getBoundingClientRect();
    const width = Math.min(560, Math.max(520, window.innerWidth - 24));
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
    app.actions.loadDirectory?.();
    setInviteDraft({ postId: roomPost.id, sideName, reserve, slotKey, query: '', selectedPlayerIds: [], anchor: getCommandAnchor(event) });
  };
  const openSelfSlotAction = (roomPost, sideName, reserve = false, playerId = '', entryId = '', event = null) => {
    setInviteDraft(null);
    setSlotActionDraft({ postId: roomPost.id, sideName, reserve, playerId, entryId, anchor: getCommandAnchor(event) });
  };
  const shouldOpenRosterAfterAccept = (roomPost, invitation = {}) => {
    const teamId = invitation.teamId || roomPost?.targetTeamId || "";
    return Boolean(
      teamId &&
      invitation.role !== "referee" &&
      roomPost?.visibility === "private" &&
      roomPost?.hostJoinMode === "team" &&
      (invitation.side || "teamB") === "teamB" &&
      !invitation.reserve
    );
  };
  const acceptRoomInvitation = async (roomPost, invitation = {}) => {
    if (!invitation.id) return;
    if (shouldOpenRosterAfterAccept(roomPost, invitation)) {
      setPendingRosterOpen({
        postId: roomPost.id,
        teamId: invitation.teamId || roomPost.targetTeamId,
        sideName: invitation.side || "teamB",
      });
    }
    try {
      const result = await app.actions.acceptRecruitingInvitation(roomPost.id, invitation.id);
      if (!result || result.ok === false) setPendingRosterOpen(null);
      else {
        app.actions.loadRecruitingPost?.(roomPost.id);
        onInvitationAccepted?.(roomPost.id, invitation);
      }
    } catch {
      setPendingRosterOpen(null);
    }
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
  const sendInvites = async (roomPost, playerIds, teamId = null, joinMode = "") => {
    if (!inviteDraft || !playerIds.length) return false;
    const inviteJoinMode = joinMode || (teamId ? "team" : "player");
    const invite = { side: inviteDraft.sideName, reserve: Boolean(inviteDraft.reserve), playerIds, teamId, joinMode: inviteJoinMode };
    const result = await app.actions.inviteRecruitingPlayers(roomPost.id, invite);
    if (result && result.ok !== false) {
      app.actions.loadRecruitingPost?.(roomPost.id);
      setInviteDraft(null);
    }
    return result;
  };
  useEffect(() => {
    if (!pendingRosterOpen || !selectedPost || selectedPost.id !== pendingRosterOpen.postId) return;
    const roomState = selectedPost.roomState ?? {};
    const lobby = getRecruitingLobby(selectedPost, app.state);
    const targetEntry = (lobby.entries ?? []).find((entry) => (
      entry.kind === "team" &&
      entry.side === pendingRosterOpen.sideName &&
      (entry.team?.id === pendingRosterOpen.teamId || entry.teamId === pendingRosterOpen.teamId) &&
      (
        entry.playerId === app.currentUser.id ||
        entry.players?.includes(app.currentUser.id) ||
        entry.reserves?.includes(app.currentUser.id) ||
        roomState.partyLeaders?.[entry.id] === app.currentUser.id
      )
    ));
    if (!targetEntry) return;
    const partyLeaderId = roomState.partyLeaders?.[targetEntry.id] ?? (targetEntry.fixed ? selectedPost.playerId : targetEntry.playerId) ?? "";
    if (partyLeaderId !== app.currentUser.id) {
      setPendingRosterOpen(null);
      return;
    }
    setInviteDraft(null);
    setSlotActionDraft({
      postId: selectedPost.id,
      sideName: targetEntry.side,
      reserve: false,
      playerId: app.currentUser.id,
      entryId: targetEntry.id,
      anchor: null,
    });
    setPendingRosterOpen(null);
  }, [app.currentUser.id, app.state, pendingRosterOpen, selectedPost]);
  const confirmQueueRoom = async (roomPost) => {
    if (!roomPost?.id || confirmingMatchId === roomPost.id) return;
    if (roomPost.status === "closed" || roomPost.confirmedAt) return;
    setConfirmingMatchId(roomPost.id);
    try {
      const matchId = await app.actions.confirmRecruitingMatch(roomPost.id);
      if (!matchId) return;
      closeModal();
      onOpenMatch?.(matchId);
    } finally {
      setConfirmingMatchId((current) => (current === roomPost.id ? "" : current));
    }
  };
  if (!selectedPost) return null;

  return (() => {
        const lobby = getRecruitingLobby(selectedPost, app.state);
        const joinDraft = getJoinDraft(selectedPost);
        const soloIndividualRoom = isSoloIndividualRecruitingRoom(selectedPost);
        const teamOnlyRoom = isTeamOnlyRoom(selectedPost) && !soloIndividualRoom;
        const selectedJoinTeam = myTeams.find((team) => team.id === joinDraft.teamId) ?? myTeams[0] ?? null;
        const joinCapacity = getJoinActiveCapacity(selectedPost, lobby, joinDraft.side, joinDraft.reserve);
        const selectedJoinPlayerIds = getPartyPlayerIds(selectedJoinTeam, joinDraft.playerIds, joinCapacity, app.currentUser.id);
        const selectedJoinReserveIds = joinDraft.reserve
          ? []
          : getPartyReserveIds(selectedJoinTeam, joinDraft.reservePlayerIds, selectedJoinPlayerIds);
        const candidateMmr = joinDraft.joinMode === "team" && !soloIndividualRoom
          ? getPlayerMmrAverage(selectedJoinPlayerIds, userById, selectedJoinTeam?.mmr ?? app.currentUser.ratings.integrated)
          : app.currentUser.ratings.integrated;
        const fit = getRecruitingFit(selectedPost, candidateMmr || app.currentUser.ratings.integrated, app.state);
        const matchRoom = Boolean(sourceMatch);
        const recruitingRoomConfirmed = Boolean(selectedPost.status === "closed" || selectedPost.confirmedAt);
        const storedRoomPost = app.state.recruitingPosts?.find((item) => item.id === selectedPost.id) ?? null;
        const slotPositions = selectedPost.roomState?.slotPositions ?? {};
        const roomOwnerId = getRecruitingRoomOwnerId(selectedPost);
        const mine = roomOwnerId === app.currentUser.id;
        const myEntry = lobby.entries.find((entry) => (
          entry.players?.includes(app.currentUser.id) ||
          entry.reserves?.includes(app.currentUser.id)
        ));
        const alreadyApplied = Boolean(myEntry && !mine);
        const currentUserIsRoomReferee = selectedPost.refereeId === app.currentUser.id;
        const canInviteFromRoom = !matchRoom && !recruitingRoomConfirmed && isCurrentUserRoomParticipant(selectedPost, lobby, app.currentUser.id);
        const canChat = Boolean(storedRoomPost) && isCurrentUserRoomParticipant(selectedPost, lobby, app.currentUser.id);
        const selectedRoomState = selectedPost.roomState ?? {};
        const refereeWanted = Boolean(selectedPost.refereeWanted || selectedRoomState.refereeWanted || selectedPost.refereeId);
        const getJoinRosterPatch = (team, sideName = joinDraft.side, reserve = joinDraft.reserve) => (
          getDefaultJoinRoster(selectedPost, lobby, team, app.currentUser, sideName, reserve)
        );
        const teamJoinValid = !soloIndividualRoom && (joinDraft.joinMode !== "team" || (
          Boolean(selectedJoinTeam) &&
          selectedJoinPlayerIds.includes(app.currentUser.id) &&
          selectedJoinPlayerIds.length > 0 &&
          (!teamOnlyRoom || selectedJoinPlayerIds.length >= getRecruitingSideCapacity(selectedPost))
        ));
        const canJoinReferee = selectedPost.visibility === "public" && refereeWanted && !selectedPost.refereeId && isEligibleReferee(app.currentUser, selectedPost.refereeTrustMin, app.state.settings?.refereeAppointments);
        const joinMmrLimitMode = selectedPost.mmrLimitMode ?? selectedPost.roomState?.mmrLimitMode ?? "block";
        const joinTierAllowed = joinMmrLimitMode !== "block" || fit.allowed;
        const canJoin = selectedPost.visibility === "public" && !matchRoom && !recruitingRoomConfirmed && !mine && !alreadyApplied && (
          joinDraft.joinMode === "referee"
            ? canJoinReferee
            : joinTierAllowed && (joinDraft.joinMode === "player" || teamJoinValid)
        );
        const joiningThisRoom = joiningPostId === selectedPost.id;
        const joinModeEntries = [
          ...Object.entries(RECRUITING_JOIN_MODES).filter(([mode]) => {
            if (mode === "team" && soloIndividualRoom) return false;
            return !teamOnlyRoom || mode === "team";
          }),
    ...(canJoinReferee ? [["referee", { label: "심판" }]] : []),
        ];
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
        const roomEditCourt = roomEditDraft
          ? registeredCourts.find((court) => court.name === roomEditDraft.court) ?? registeredCourts.find((court) => court.name === selectedPost.court) ?? null
          : null;
        const roomEditCourtWarning = roomEditDraft && roomEditCourt ? getCourtPlayWarning(roomEditCourt, `${roomEditDraft.sideCapacity}v${roomEditDraft.sideCapacity}`) : "";
        const maxSideFilled = Math.max(lobby.sides.teamA.filled, lobby.sides.teamB.filled);
        const roomEditCapacityValid = !roomEditDraft || Number(roomEditDraft.sideCapacity) >= maxSideFilled;
        const playingIds = [...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers];
        const partyJoinOptions = soloIndividualRoom ? [] : getSameSidePartyOptions(lobby, myEntry, myTeams);
        const sidePartyJoinOptions = soloIndividualRoom ? [] : getJoinableSidePartyOptions(lobby, myTeams, app.currentUser.id);
        const roomState = selectedRoomState;
        const recorderIds = getLobbyRecorderIds(lobby);
        const chatMessages = roomState.chatMessages ?? [];
        const invitations = roomState.invitations ?? [];
        const pendingInvitations = invitations.filter((invitation) => invitation.status === "pending");
        const pendingRefereeInvitations = pendingInvitations.filter((invitation) => invitation.role === "referee");
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
          if (selectedPost.visibility === "private" && selectedPost.hostJoinMode === "team") return false;
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
        const canInvitePlayerByRoom = (playerId, player = null) => {
          if (!playerId) return false;
          const mmrLimitMode = selectedPost.mmrLimitMode ?? roomState.mmrLimitMode ?? "block";
          if (mmrLimitMode !== "block") return true;
          const targetPlayer = player ?? userById[playerId];
          if (!targetPlayer) return true;
          return getRecruitingFit(selectedPost, targetPlayer.ratings?.integrated ?? 1200, app.state).allowed;
        };
        const disabledRefereeIds = new Set([
          ...disabledInvitePlayerIds,
          selectedPost.refereeId,
          ...pendingRefereeInvitations.map((invitation) => invitation.targetUserId),
        ].filter(Boolean));
        const refereeInviteCandidates = isSupabaseConfigured
          ? []
          : app.state.users
            .filter((user) => !disabledRefereeIds.has(user.id))
            .filter((user) => isEligibleReferee(user, selectedPost.refereeTrustMin, app.state.settings?.refereeAppointments))
            .sort((a, b) => Number(b.trustScore ?? 0) - Number(a.trustScore ?? 0));
        const showRefereeInviteSlot = refereeWanted && !selectedPost.refereeId;
        const canInviteRefereeFromRoom = showRefereeInviteSlot && canInviteFromRoom;
        const activeInviteDraftRaw = inviteDraft?.postId === selectedPost.id ? inviteDraft : null;
        const activeSelfSlotDraftRaw = slotActionDraft?.postId === selectedPost.id ? slotActionDraft : null;
        const favoritePlayerIds = app.state.settings?.favoritePlayerIds ?? [];
        const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
        const favoriteRefereeIds = app.state.settings?.favoriteRefereeIds ?? [];
        const useSideNameHeader = selectedPost.visibility !== "private";
        const teamAMeta = getLobbySideMeta(lobby, "teamA", userById, { useSideName: useSideNameHeader });
        const teamBMeta = getLobbySideMeta(lobby, "teamB", userById, { useSideName: useSideNameHeader });
        const sourceMatchStatus = getSourceMatchStatus(sourceMatch, lobby, app.currentUser.id);
        const sourceMatchAction = getSourceMatchAction(sourceMatch, app.currentUser.id, app.state.teams, userById);
        const sourceMatchSideName = getSourceMatchDecisionSideName(sourceMatch, app.currentUser.id, app.state.teams);
        const roomTimingStatus = getPublicRoomTimingStatus(selectedPost);
        const roomQueueStatus = getRecruitingRoomStatus(lobby, { post: selectedPost, myEntry, mine });
        const needsPrivateConfirm = !matchRoom && !mine && selectedPost.visibility !== "public" && Boolean(myEntry && myEntry.status !== "ready");
        const roomReadyLabel = sourceMatch ? sourceMatchStatus.label : roomQueueStatus.label;
        const sourceMatchPhase = sourceMatch ? getMatchRoomPhase(sourceMatch) : null;
        const sourceRoomReadOnly = Boolean(matchRoom && (sourceMatch?.status === "disputed" || ["record", "cancelled", "void"].includes(sourceMatchPhase?.phase)));
        const activeInviteDraft = sourceRoomReadOnly ? null : activeInviteDraftRaw;
        const activeSelfSlotDraft = sourceRoomReadOnly ? null : activeSelfSlotDraftRaw;
        const canUseChat = canChat && !sourceRoomReadOnly && !roomChatLocked;
        const sourceMatchStarted = Boolean(sourceMatch?.startedAt);
        const currentUserIsSourceReferee = Boolean(sourceMatch && isMatchReferee(sourceMatch, app.currentUser.id) && isEligibleReferee(app.currentUser, sourceMatch.refereeTrustMin, app.state.settings?.refereeAppointments));
        const currentUserCanOperateStartedSourceMatch = Boolean(sourceMatch && (sourceMatch.refereeId ? currentUserIsSourceReferee : mine));
        const currentUserCanStartSourceMatch = Boolean(sourceMatch && (sourceMatch.refereeId ? currentUserIsSourceReferee : mine));
        const sourceMatchHostSideName = sourceMatch && getMatchSidePlayerIds(sourceMatch, "teamB").includes(sourceMatch.createdBy) ? "teamB" : "teamA";
        const sourceMatchOpponentSideName = sourceMatchHostSideName === "teamA" ? "teamB" : "teamA";
        const sourceMatchSideLeaderIds = {
          teamA: sourceMatch
            ? getMatchSideLeaderId(sourceMatch, app.state.teams, "teamA")
            : getRecruitingSideLeaderId(lobby, "teamA", roomOwnerId, roomState),
          teamB: sourceMatch
            ? getMatchSideLeaderId(sourceMatch, app.state.teams, "teamB")
            : getRecruitingSideLeaderId(lobby, "teamB", roomOwnerId, roomState),
        };
        const sourceMatchOpponentLeaderId = sourceMatch
          ? sourceMatchSideLeaderIds[sourceMatchOpponentSideName] ?? ""
          : "";
        const sourceMatchAttendance = {
          teamA: sourceMatch?.attendance?.teamA ?? [],
          teamB: sourceMatch?.attendance?.teamB ?? [],
        };
        const canManageMatchCheckin = Boolean(matchRoom && currentUserCanStartSourceMatch && sourceMatchPhase?.phase === "checkin" && !sourceMatch?.startedAt && !sourceMatch?.endedAt && !sourceMatch?.result);
        const canStartSourceMatch = Boolean(matchRoom && currentUserCanStartSourceMatch && sourceMatchPhase?.phase === "checkin" && !sourceMatch?.result && !sourceMatch?.endedAt);
        const canRequestRefereeAbsence = Boolean(matchRoom && mine && sourceMatch?.refereeId && sourceMatchPhase?.phase === "checkin" && !sourceMatch?.refereeAbsenceRequest?.confirmedAt && !sourceMatch?.startedAt && !sourceMatch?.endedAt && !sourceMatch?.result);
        const canConfirmRefereeAbsence = Boolean(matchRoom && sourceMatchOpponentLeaderId === app.currentUser.id && sourceMatch?.refereeId && sourceMatch?.refereeAbsenceRequest && !sourceMatch.refereeAbsenceRequest.confirmedAt && sourceMatchPhase?.phase === "checkin" && !sourceMatch?.startedAt && !sourceMatch?.endedAt && !sourceMatch?.result && sourceMatchSideName);
        const canEndSourceMatch = Boolean(matchRoom && currentUserCanOperateStartedSourceMatch && sourceMatchPhase?.phase === "live" && !sourceMatch?.endedAt && sourceMatchStarted);
        const canReviewSourceMatch = Boolean(matchRoom && currentUserCanOperateStartedSourceMatch && sourceMatchPhase?.phase === "dispute");
        const canSubmitSourceMatchLiveResult = Boolean(matchRoom && sourceMatch?.status === "agreed" && sourceMatchPhase?.phase === "live" && currentUserCanOperateStartedSourceMatch && sourceMatchStarted && !sourceMatch?.endedAt);
        const canSubmitSourceMatchPostgameResult = Boolean(matchRoom && canOperatorSubmitMissingPostgameResult(sourceMatch, currentUserCanOperateStartedSourceMatch));
        const sourceMatchRecorderSides = sourceMatch ? getStatRecorderSides(sourceMatch, app.currentUser.id) : [];
        const canSubmitSourceMatchRecorderResult = Boolean(matchRoom && sourceMatch?.status === "agreed" && sourceMatchPhase?.phase === "live" && sourceMatchStarted && !sourceMatch?.endedAt && sourceMatchRecorderSides.length);
        const canEditSourceMatchSideScore = (sideName) => (
          canSubmitSourceMatchLiveResult ||
          canSubmitSourceMatchPostgameResult ||
          (canSubmitSourceMatchRecorderResult && sourceMatchRecorderSides.includes(sideName))
        );
        const getEditableSourceMatchStatFields = (playerId) => (
          sourceMatch ? getAllowedResultStatFields(sourceMatch, app.currentUser.id, playerId, false) : []
        );
        const canCancelSourceMatch = Boolean(matchRoom && sourceMatch && ["contract", "agreed"].includes(sourceMatch.status) && (sourceMatchStarted || sourceMatch.endedAt || sourceMatch.result ? currentUserCanOperateStartedSourceMatch : mine));
        const sourceMatchRecordWindow = sourceMatch ? getMatchRecordWindow(sourceMatch) : null;
        const sourceMatchApprovalOpen = Boolean(
          sourceMatch?.result &&
          sourceMatchRecordWindow?.disputeOpen &&
          (sourceMatch.status === "approval" || (sourceMatch.status === "agreed" && sourceMatch.endedAt)),
        );
        const canRequestSourceMatchPointDispute = Boolean(
          matchRoom &&
          sourceMatchApprovalOpen &&
          getMatchRecordPlayerIds(sourceMatch, true).includes(app.currentUser.id),
        );
        const sourceCurrentDisputePoints = sourceMatch ? getMatchPlayerDisputePoints(sourceMatch, app.currentUser.id) : 0;
        const showSourceMatchRecordSummary = Boolean(
          matchRoom &&
          sourceMatch?.result &&
          ["postgame", "dispute", "record"].includes(sourceMatchPhase?.phase),
        );
        const canMoveMatchSides = Boolean(canManageMatchCheckin && selectedPost.hostJoinMode !== "team");
        const canEditSourceRoomRules = Boolean(
          !sourceRoomReadOnly &&
          (!matchRoom ? mine : (
            sourceMatch &&
            ["locked", "checkin"].includes(sourceMatchPhase?.phase) &&
            !sourceMatch.endedAt &&
            !sourceMatch.result &&
            (sourceMatch.refereeId && sourceMatchPhase?.phase === "checkin" ? currentUserIsSourceReferee : mine)
          )),
        );
        const roomCompetitionLabel = getRoomCompetitionLabel(selectedPost);
        const roomDisplayTitle = getRecruitingDisplayTitle(selectedPost, `${roomCompetitionLabel} ${selectedPost.mode || ""} 매치 큐`.trim());
        const roomVisibilityLabel = getRoomVisibilityLabel(sourceMatch ?? selectedPost, selectedPost);
        const roomVisibilityTone = roomVisibilityLabel === "대회방" ? "gold" : roomVisibilityLabel === "비공개방" ? "blue" : "green";
        const sourceTeamSideCount = ["teamA", "teamB"].filter((sideName) => isMatchSideTeamParty(sourceMatch, sideName)).length;
        const lobbyTeamEntryCount = (lobby.entries ?? []).filter((entry) => isPartyEntry(entry)).length;
        const teamMatchSideLocked = sourceTeamSideCount >= 2 || (selectedPost.hostJoinMode === "team" && lobbyTeamEntryCount > 0);
        const roomMatchTypeLabel = sourceTeamSideCount >= 2 || (selectedPost.visibility === "private" && lobbyTeamEntryCount >= 2)
          ? "팀전"
          : lobbyTeamEntryCount > 0 || sourceTeamSideCount > 0
            ? "팀 파티 포함"
            : "개인 매칭";
        const roomPhaseBadge = sourceMatch ? sourceMatchPhase : roomQueueStatus;
        const referee = selectedPost.refereeId ? userById[selectedPost.refereeId] : null;
        const showCaptainBadge = selectedPost.visibility === "private" || Boolean(sourceMatch);
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
          const targetPartyOptions = soloIndividualRoom ? [] : getSameSidePartyOptions(lobby, myEntry, myTeams, sideName);
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
                onQueryChange={(query) => updateInviteDraft({ query })}
                users={app.state.users}
                teams={app.state.teams}
                userById={userById}
                disabledPlayerIds={disabledInvitePlayerIds}
                selectedPlayerIds={activeSlotDraft.selectedPlayerIds ?? []}
                favoritePlayerIds={favoritePlayerIds}
                favoriteTeamIds={favoriteTeamIds}
                allowedTeamId={getInviteAllowedTeamId(activeSlotDraft.sideName)}
                canInvitePlayer={canInvitePlayerByRoom}
                onTogglePlayer={toggleInvitePlayer}
                onInvitePlayers={(playerIds, teamId, joinMode) => { void sendInvites(selectedPost, playerIds, teamId, joinMode); }}
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
            <div className="arena-self-placement-actions">
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
          const targetPartyOptions = targetIsCurrentUser && !soloIndividualRoom ? getSameSidePartyOptions(lobby, myEntry, myTeams, activeSelfSlotDraft.sideName) : [];
          const currentSlotPosition = getRoomSlotDisplayPosition(targetUser, slotPositions, targetPlayerId, targetEntry);
          const canManageTeamRoster = targetEntry.kind === "team" && targetEntry.team && getEntryPartyLeaderId(targetEntry) === app.currentUser.id;
          const teamRosterCapacity = getRecruitingSideCapacity(selectedPost);
          const teamRosterActiveIds = canManageTeamRoster
            ? getPartyPlayerIds(targetEntry.team, targetEntry.players ?? [], teamRosterCapacity, app.currentUser.id)
            : [];
          const teamRosterReserveIds = canManageTeamRoster
            ? getPartyReserveIds(targetEntry.team, roomState.partyReserves?.[targetEntry.id] ?? [], teamRosterActiveIds)
            : [];
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
              {canManageTeamRoster ? (
                <TeamMemberPicker
                  team={targetEntry.team}
                  userById={userById}
                  selectedIds={teamRosterActiveIds}
                  reserveIds={teamRosterReserveIds}
                  capacity={teamRosterCapacity}
                  reserveCapacity={MAX_RESERVE_PLAYERS_PER_SIDE}
                  requiredPlayerId={app.currentUser.id}
                  requiredActive
                  onRosterChange={({ selectedIds, reserveIds }) => app.actions.setRecruitingTeamPartyRoster(selectedPost.id, targetEntry.id, {
                    teamId: targetEntry.team.id,
                    playerIds: selectedIds,
                    reservePlayerIds: reserveIds,
                  })}
                />
              ) : null}
            </SelfSlotCommandPanel>
          );
        };

        return (
          <div
            className="arena-compose-backdrop"
            role="presentation"
            style={{ "--sheet-backdrop-opacity": sheetBackdropOpacity }}
            onPointerDown={() => { setInviteDraft(null); setSlotActionDraft(null); closeModal(); }}
          >
            <aside
              ref={lobbyModalRef}
              className={`arena-lobby-modal${sheetDragSettling ? " is-sheet-settling" : ""}${sheetDragOffset > 0 ? " is-sheet-dragging" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label="매치방"
              style={{ "--sheet-drag-y": `${sheetDragOffset}px`, "--sheet-modal-opacity": sheetModalOpacity }}
              onPointerDown={(event) => { event.stopPropagation(); startSheetDrag(event); }}
              onPointerMove={moveSheetDrag}
              onPointerUp={finishSheetDrag}
              onPointerCancel={cancelSheetDrag}
            >
              <button
                type="button"
                className="arena-lobby-drag-handle"
                aria-label="아래로 당겨 방 닫기"
              />
              <div className="arena-lobby-arena">
                <div className="arena-lobby-topline">
                  <div className="badge-row">
                    <Badge tone={roomPhaseBadge?.tone ?? "neutral"}>{roomPhaseBadge?.label ?? "대기방"}</Badge>
                    <Badge tone="neutral">{selectedPost.mode}</Badge>
                    <Badge tone={roomVisibilityTone}>{roomVisibilityLabel}</Badge>
                    <Badge tone="neutral">{roomMatchTypeLabel}</Badge>
                    <Badge tone={selectedPost.ranked === false ? "neutral" : "gold"}>{roomCompetitionLabel}</Badge>
                    <Badge tone={referee ? "blue" : "neutral"}>{getRoomRefereeLabel(selectedPost)}</Badge>
                  </div>
                  <div className="arena-room-share-actions" aria-label="방 공유">
                    <Button type="button" size="sm" variant="secondary" onClick={copyRoomShareUrl}>
                      <Copy size={15} /> URL 복사
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={shareRoom}>
                      <Share2 size={15} /> 공유하기
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => { setInviteDraft(null); setSlotActionDraft(null); closeModal(); }}>
                      <X size={15} /> 방 닫기
                    </Button>
                    {roomShareStatus ? <span className="arena-room-share-message">{roomShareStatus}</span> : null}
                  </div>
                </div>

                <div className="arena-lobby-title">
                  <h2>{roomDisplayTitle}</h2>
                  <p><MapPin size={16} /><CourtHoverCard court={courtByName[selectedPost.court]} courtName={selectedPost.court}>{selectedPost.court}</CourtHoverCard> · {getRecruitingSchedule(selectedPost)}</p>
                </div>

                <div className="arena-lobby-versus-stage">
                  <div className="arena-lobby-team-panel team-a">
                    <div className="arena-lobby-team-head">
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
                      sideLeaderId={sourceMatchSideLeaderIds.teamA}
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

                  <div className="arena-lobby-score-core">
                    <strong>{lobby.sides.teamA.projectedFilled}/{lobby.sides.teamA.capacity}</strong>
                    <i>VS</i>
                    <strong>{lobby.sides.teamB.projectedFilled}/{lobby.sides.teamB.capacity}</strong>
                    <span>{roomReadyLabel}</span>
                  </div>

                  <div className="arena-lobby-team-panel team-b">
                    <div className="arena-lobby-team-head">
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
                      sideLeaderId={sourceMatchSideLeaderIds.teamB}
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

                <div className="arena-reserve-panel">
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
                    sideLeaderId={sourceMatchSideLeaderIds.teamA}
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
                    sideLeaderId={sourceMatchSideLeaderIds.teamB}
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

                <div className="arena-lobby-actions">
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
                  onQueryChange={(query) => updateInviteDraft({ query })}
                  users={app.state.users}
                  teams={app.state.teams}
                  userById={userById}
                  disabledPlayerIds={disabledInvitePlayerIds}
                  selectedPlayerIds={activeInviteDraft.selectedPlayerIds ?? []}
                  favoritePlayerIds={favoritePlayerIds}
                  favoriteTeamIds={favoriteTeamIds}
                  allowedTeamId={getInviteAllowedTeamId(activeInviteDraft.sideName)}
                  canInvitePlayer={canInvitePlayerByRoom}
                  onTogglePlayer={toggleInvitePlayer}
                  onInvitePlayers={(playerIds, teamId, joinMode) => { void sendInvites(selectedPost, playerIds, teamId, joinMode); }}
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
                  onAccept={(invitation) => acceptRoomInvitation(selectedPost, invitation)}
                  onDecline={async (invitationId) => {
                    const result = await app.actions.declineRecruitingInvitation(selectedPost.id, invitationId);
                    if (result && result.ok !== false) app.actions.loadRecruitingPost?.(selectedPost.id);
                  }}
                />
              ) : null}

              {!sourceRoomReadOnly && ((!matchRoom && mine) || (matchRoom && canManageMatchCheckin)) ? (
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
                  onCheckInPlayer={matchRoom ? ((sideName, playerId) => app.actions.checkInMatchPlayer(sourceMatch.id, sideName, playerId)) : null}
                  onSetReserve={matchRoom ? ((entry, playerId, reserve) => app.actions.setMatchRoomPlayerPlacement(sourceMatch.id, playerId, { side: entry.side, reserve })) : null}
                  onSetPlacement={matchRoom ? ((playerId, placement) => app.actions.setMatchRoomPlayerPlacement(sourceMatch.id, playerId, placement)) : null}
                  allowSideMove={canMoveMatchSides}
                  attendanceBySide={matchRoom ? sourceMatchAttendance : null}
                  requireMissingAttendance={canManageMatchCheckin}
                  currentUserId={app.currentUser.id}
                />
              ) : null}

              <div className="arena-room-rule-panel">
                <div className="arena-room-rule-head">
                  <strong>규칙</strong>
                  {canEditSourceRoomRules ? (
                    <Button type="button" size="sm" variant="secondary" onClick={() => (roomEditDraft ? closeRoomEdit(selectedPost) : openRoomEdit(selectedPost))}>
                      {roomEditDraft ? "수정 닫기" : "방 수정"}
                    </Button>
                  ) : null}
                </div>
                <div className="arena-room-rule-summary">
                  <span>{getRecruitingSideCapacity(selectedPost)} vs {getRecruitingSideCapacity(selectedPost)}</span>
                  <span>{selectedPost.rules?.targetScore ?? 21}점 · {selectedPost.rules?.timeLimit ?? 12}분</span>
                  <span>{(selectedPost.rules?.winByTwo ?? true) ? "2점차" : "선착순"} · {selectedPost.rules?.ball ?? "7호 공"}</span>
                  {selectedPost.ranked !== false ? <span>{selectedRange.label}</span> : <span>친선 · 티어 자유</span>}
                </div>
                <div className="arena-room-rule-summary detail">
                  <span>공격권: {selectedPost.rules?.attackRule ?? "득점 후 공격권 교대"}</span>
                  <span>파울: {selectedPost.rules?.foulRule ?? "파울 콜 즉시 중단, 공격권 유지"}</span>
                </div>
                <div className="arena-room-referee-line">
                  <strong>심판</strong>
                  {referee ? (
                    <RefereeHoverCard user={referee} matches={app.state.matches} minTrust={selectedPost.refereeTrustMin} className="arena-room-referee-card">
                      <span className="avatar small" style={{ "--avatar": referee.avatarColor }}>{referee.name.slice(0, 1)}</span>
                      <span>{referee.name}</span>
                    </RefereeHoverCard>
                  ) : (
                    <span>없음</span>
                  )}
                </div>
                {!sourceRoomReadOnly && showRefereeInviteSlot ? (
                  <RefereeInvitePanel
                    query={getRefereeInviteQuery(selectedPost)}
                    onQueryChange={(query) => updateRefereeInviteQuery(selectedPost, query)}
                    candidates={refereeInviteCandidates}
                    favoriteRefereeIds={favoriteRefereeIds}
                    pendingInvitations={pendingRefereeInvitations}
                    userById={userById}
                    matches={app.state.matches}
                    minTrust={selectedPost.refereeTrustMin}
                    canInvite={canInviteRefereeFromRoom}
                    canJoin={canJoinReferee && !mine && !matchRoom}
                    disabledRefereeIds={[...disabledRefereeIds]}
                    onInviteReferee={async (refereeId) => {
                      const result = await app.actions.inviteRecruitingReferee(selectedPost.id, refereeId);
                      if (result && result.ok !== false) app.actions.loadRecruitingPost?.(selectedPost.id);
                    }}
                    onJoin={() => app.actions.interestRecruitingPost(selectedPost.id, { joinMode: "referee" })}
                  />
                ) : null}
                {selectedPost.stakes ? (
                  <div className="arena-details-memo">
                    <strong>약속/벌칙</strong>
                    <span>{selectedPost.stakes}</span>
                  </div>
                ) : null}
                {selectedPost.memo ? (
                  <div className="arena-details-memo">
                    <strong>경기 메모</strong>
                    <span>{selectedPost.memo}</span>
                  </div>
                ) : null}
                {!sourceRoomReadOnly && roomEditDraft ? (
                  <div className="arena-room-edit-panel">
                    <div className="arena-field-grid three">
                      <label>
                        팀당 정원
                        <select value={roomEditDraft.sideCapacity} onChange={(event) => updateRoomEditDraft(selectedPost, { sideCapacity: Number(event.target.value) })}>
                          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} vs {value}</option>)}
                        </select>
                      </label>
                      <label>
                        구장
                        <select value={roomEditDraft.court} onChange={(event) => updateRoomEditDraft(selectedPost, { court: event.target.value })}>
                          {registeredCourts.map((court) => (
                            <option key={court.id ?? court.name} value={court.name}>
                              {court.name} / {getCourtSurfaceLabel(court)} / {getCourtLayoutLabel(court)}
                            </option>
                          ))}
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
                    <div className="arena-field-grid three">
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
                    {roomEditCourt ? (
                      <small className={roomEditCourtWarning ? "room-edit-warning" : ""}>
                        {getCourtSurfaceLabel(roomEditCourt)} / {getCourtLayoutLabel(roomEditCourt)}
                        {roomEditCourtWarning ? ` · ${roomEditCourtWarning}` : " · 선택한 방식과 구장 형태가 충돌하지 않습니다."}
                      </small>
                    ) : null}
                    <div className="arena-field-grid">
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
                    <div className="arena-room-edit-actions">
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
                locked={roomChatLocked}
                sending={chatSendingPostId === selectedPost.id}
                cooldown={Number(chatCooldownUntilByPost[selectedPost.id] ?? 0) > Date.now()}
                error={chatErrorByPost[selectedPost.id] ?? ""}
                onChange={(value) => updateChatDraft(selectedPost, value)}
                onSubmit={(event) => submitChat(event, selectedPost)}
                onVisibleChange={handleChatVisibleChange}
              />

              <div className="arena-join-panel">
                {matchRoom ? (
                  <div className="arena-owner-panel">
                    <strong>{sourceMatchAction.label}</strong>
                    <span>{sourceMatchAction.detail}</span>
                    {sourceMatchAction.disputed && sourceMatch?.disputes?.[0]?.reason ? (
                      <span>최근 이의: {sourceMatch.disputes[0].reason}</span>
                    ) : null}
                    {showSourceMatchRecordSummary ? (
                      <SourceMatchRecordSummary match={sourceMatch} userById={userById} />
                    ) : null}
                    {!sourceMatchAction.disputed && sourceMatchApprovalOpen ? (
                      <form className="arena-dispute-editor" onSubmit={submitSourceDispute}>
                        <div className="arena-dispute-score-row">
                          <label>
                            점수판
                            <input type="text" disabled value={`${sourceMatch?.result?.scoreA ?? sourceMatch?.teamA?.score ?? 0} : ${sourceMatch?.result?.scoreB ?? sourceMatch?.teamB?.score ?? 0}`} readOnly />
                          </label>
                          <label>
                            내 득점
                            <input
                              type="number"
                              min="0"
                              disabled={!canRequestSourceMatchPointDispute}
                              value={sourceDisputeDraft.matchId === sourceMatch.id ? sourceDisputeDraft.requestedPoints : String(sourceCurrentDisputePoints)}
                              onChange={(event) => setSourceDisputeDraft((current) => ({ ...current, matchId: sourceMatch.id, resultKey: sourceMatch.result?.updatedAt ?? sourceMatch.result?.submittedAt ?? "", requestedPoints: event.target.value }))}
                            />
                          </label>
                        </div>
                        <label className="memo-label">
                          이의제기 사유
                          <select
                            disabled={!canRequestSourceMatchPointDispute}
                            value={sourceDisputeDraft.matchId === sourceMatch.id ? sourceDisputeDraft.reason : MATCH_DISPUTE_REASON_OPTIONS[0]}
                            onChange={(event) => setSourceDisputeDraft((current) => ({ ...current, matchId: sourceMatch.id, resultKey: sourceMatch.result?.updatedAt ?? sourceMatch.result?.submittedAt ?? "", reason: event.target.value }))}
                          >
                            {MATCH_DISPUTE_REASON_OPTIONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                          </select>
                        </label>
                        {sourceDisputeDraft.reason === OTHER_MATCH_DISPUTE_REASON ? (
                          <label className="memo-label">
                            기타 사유
                            <textarea
                              disabled={!canRequestSourceMatchPointDispute}
                              value={sourceDisputeDraft.matchId === sourceMatch.id ? sourceDisputeDraft.customReason : ""}
                              onChange={(event) => setSourceDisputeDraft((current) => ({ ...current, matchId: sourceMatch.id, resultKey: sourceMatch.result?.updatedAt ?? sourceMatch.result?.submittedAt ?? "", customReason: event.target.value }))}
                            />
                          </label>
                        ) : null}
                        <div className="match-action-row">
                          <Button type="submit" variant="secondary" disabled={!canRequestSourceMatchPointDispute}>이의제기</Button>
                        </div>
                      </form>
                    ) : null}
                    {sourceMatchAction.disputed ? (
                      <SourceMatchDisputeEditor
                        match={sourceMatch}
                        userById={userById}
                        canReview={canReviewSourceMatch}
                        onSave={(draft) => app.actions.submitMatchResult(sourceMatch.id, draft)}
                        onResolve={(draft) => app.actions.resumeMatchApproval(sourceMatch.id, draft)}
                        onVoid={() => app.actions.voidMatch(sourceMatch.id)}
                      />
                    ) : null}
                    {!sourceMatchAction.disputed && (canSubmitSourceMatchLiveResult || canSubmitSourceMatchPostgameResult || canSubmitSourceMatchRecorderResult) ? (
                      <SourceMatchDisputeEditor
                        match={sourceMatch}
                        userById={userById}
                        canReview={canSubmitSourceMatchLiveResult || canSubmitSourceMatchPostgameResult}
                        canEditSideScore={canEditSourceMatchSideScore}
                        getEditableStatFields={getEditableSourceMatchStatFields}
                        submitLabel={canSubmitSourceMatchRecorderResult ? "후보 기록 제출" : ""}
                        onSave={(draft) => app.actions.submitMatchResult(sourceMatch.id, draft)}
                      />
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
                    {!sourceRoomReadOnly && canRequestRefereeAbsence ? (
                      <Button type="button" variant="secondary" onClick={() => app.actions.requestMatchRefereeAbsence(sourceMatch.id)}>
                        심판 미출석
                      </Button>
                    ) : null}
                    {!sourceRoomReadOnly && canConfirmRefereeAbsence ? (
                      <Button type="button" variant="secondary" onClick={() => app.actions.confirmMatchRefereeAbsence(sourceMatch.id)}>
                        심판 미출석 인정
                      </Button>
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
                  <div className="arena-owner-panel">
                    <strong>방장 권한</strong>
                    <span>{roomQueueStatus.detail}</span>
                  </div>
                ) : currentUserIsRoomReferee ? (
                  <div className="arena-owner-panel">
                    <strong>심판 참여 중</strong>
                    <span>슬롯 없이 심판으로 배정된 상태입니다.</span>
                  </div>
                ) : alreadyApplied ? (
                  <div className="arena-owner-panel">
                    <strong>참여 중</strong>
                    <span>내 슬롯을 누르면 위치 변경, 후보 이동, 파티 조작을 할 수 있습니다.</span>
                  </div>
                ) : selectedPost.visibility === "private" ? (
                  <div className="arena-owner-panel">
                    <strong>비공개방</strong>
                    <span>초대 수락으로만 참여할 수 있습니다.</span>
                  </div>
                ) : (
                  <form className="arena-join-form" onSubmit={(event) => { event.preventDefault(); void submitJoin(selectedPost); }}>
                    {sidePartyJoinOptions.length ? (
                      <div className="arena-self-placement-actions">
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
                      {joinModeEntries.map(([mode, meta]) => (
                        <button
                          key={mode}
                          type="button"
                          className={joinDraft.joinMode === mode ? "active" : ""}
                          onClick={() => {
                            const teamId = mode === "team" ? getDefaultApplyTeamId(selectedPost, myTeams) : "";
                            const team = myTeams.find((item) => item.id === teamId) ?? null;
                            const rosterPatch = mode === "team"
                              ? getJoinRosterPatch(team)
                              : { playerIds: [], reservePlayerIds: [] };
                            updateJoinDraft(selectedPost, {
                              joinMode: mode,
                              teamId,
                              reserve: false,
                              ...rosterPatch,
                            });
                          }}
                        >
                          {meta.label}
                        </button>
                      ))}
                    </div>
                    {joinDraft.joinMode === "team" ? (
                      <>
                        <div className="arena-team-choice-field">
                          <span>참여 팀</span>
                          {myTeams.length ? (
                            <div className="arena-team-choice-grid">
                              {myTeams.map((team) => (
                                <button
                                  key={team.id}
                                  type="button"
                                  className={joinDraft.teamId === team.id ? "selected" : ""}
                                  onClick={() => {
                                    updateJoinDraft(selectedPost, {
                                      teamId: team.id,
                                      ...getJoinRosterPatch(team),
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
                    ) : joinDraft.joinMode === "referee" ? (
                      <div className="arena-mini-note">
                        <div>
                          <span>심판 참여</span>
                          <strong>슬롯 사용 안 함</strong>
                          <em>경기 시작 이후 운영 권한</em>
                        </div>
                        <ShieldCheck size={18} />
                      </div>
                    ) : (
                      <label>
                        포지션
                        <select value={joinDraft.position} onChange={(event) => updateJoinDraft(selectedPost, { position: event.target.value })}>
                          {PLAYER_POSITIONS.map((position) => <option key={position}>{position}</option>)}
                        </select>
                      </label>
                    )}
                    {joinDraft.joinMode !== "referee" ? (
                    <div className="arena-field-grid">
                      <label>
                        진영
                        <select
                          value={joinDraft.side}
                          onChange={(event) => {
                            const side = event.target.value;
                            if (joinDraft.joinMode !== "team") {
                              updateJoinDraft(selectedPost, { side });
                              return;
                            }
                            updateJoinDraft(selectedPost, {
                              side,
                              ...getJoinRosterPatch(selectedJoinTeam, side, joinDraft.reserve),
                            });
                          }}
                        >
                          <option value="teamA">A사이드</option>
                          <option value="teamB">B사이드</option>
                        </select>
                      </label>
                      <label className="arena-check-row">
                        <input
                          type="checkbox"
                          checked={joinDraft.reserve}
                          onChange={(event) => {
                            const reserve = event.target.checked;
                            if (joinDraft.joinMode !== "team") {
                              updateJoinDraft(selectedPost, { reserve });
                              return;
                            }
                            updateJoinDraft(selectedPost, {
                              reserve,
                              ...getJoinRosterPatch(selectedJoinTeam, joinDraft.side, reserve),
                            });
                          }}
                        />
                        <span>
                          후보로 참여
                          <small>출전선수 부족하면 자동으로 출전됩니다.</small>
                        </span>
                      </label>
                    </div>
                    ) : null}
                    <div className="arena-mini-note">
                      <div>
                        <span>{joinDraft.joinMode === "team" ? `팀 파티 ${selectedJoinPlayerIds.length}+${selectedJoinReserveIds.length}` : joinDraft.joinMode === "referee" ? "심판 참여" : "개인 참여"}</span>
                        <strong>{joinDraft.joinMode === "referee" ? "심판 가능" : fit.label}</strong>
                        <em>{joinDraft.joinMode === "referee" ? "슬롯 사용 안 함" : fit.range.label}</em>
                      </div>
                      {joinDraft.joinMode === "referee" ? <ShieldCheck size={18} /> : <TierBadge mmr={candidateMmr || app.currentUser.ratings.integrated} compact />}
                    </div>
                    <Button type="submit" disabled={!canJoin || joiningThisRoom}>
                      {joinDraft.joinMode === "team" ? <UsersRound size={18} /> : joinDraft.joinMode === "referee" ? <ShieldCheck size={18} /> : <UserRound size={18} />}
                      {joiningThisRoom ? "참여 중" : "참여하기"}
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
                {!matchRoom && !recruitingRoomConfirmed && mine ? (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!lobby.canConfirm || !roomTimingStatus.canConfirm || confirmingMatchId === selectedPost.id}
                    onClick={() => confirmQueueRoom(selectedPost)}
                  >
                    <Swords size={18} />
                    {confirmingMatchId === selectedPost.id ? "확정 중" : "경기 확정"}
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
              <div className="arena-modal-close-row">
                <Button
                  type="button"
                  variant="secondary"
                  className="arena-modal-close-button"
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

function RecruitingReady({ app }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetPostId = searchParams.get("post") ?? "";
  const targetFilter = searchParams.get("filter") ?? "";
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const courtByName = useMemo(() => Object.fromEntries(registeredCourts.map((court) => [court.name, court])), [registeredCourts]);
  const myTeamIds = useMemo(() => myTeams.map((team) => team.id), [myTeams]);
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const currentRegion = getCanonicalRegion(app.currentUser.regionDistrict || app.currentUser.region);
  const defaultRegionSelection = useMemo(
    () => inferRegionSelection([
      app.currentUser.regionSido,
      app.currentUser.regionDistrict,
      app.currentUser.region,
    ].filter(Boolean).join(" ")),
    [app.currentUser.region, app.currentUser.regionDistrict, app.currentUser.regionSido],
  );
  const [queue, setQueue] = useState("all");
  const [roomScope, setRoomScope] = useState(() => (targetFilter === "invited" ? "invited" : "all"));
  const [loadingRoomScope, setLoadingRoomScope] = useState("");
  const [regionFilterSido, setRegionFilterSido] = useState(defaultRegionSelection.sido);
  const [regionFilterDistrict, setRegionFilterDistrict] = useState(defaultRegionSelection.district);
  const [modeFilter, setModeFilter] = useState("all");
  const [startFilter, setStartFilter] = useState("instant");
  const [queueControlsOpen, setQueueControlsOpen] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [selectedPostDetailLoadingId, setSelectedPostDetailLoadingId] = useState(null);
  const targetPostLoadRef = useRef("");
  const selectedPostRefreshRef = useRef("");
  const myRecruitingLoadRef = useRef("");
  const regionLoadRef = useRef("");
  const defaultDraftCourt = registeredCourts.find((court) => isSameRegion(court.region, currentRegion)) ?? registeredCourts[0] ?? null;
  const [draft, setDraft] = useState(() => ({
    hostJoinMode: myTeams[0]?.id ? "team" : "player",
    title: "",
    region: currentRegion,
    courtId: defaultDraftCourt?.id ?? "",
    court: defaultDraftCourt?.name ?? "미정",
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
  const selectedRegionGroup = REGION_TREE.find((region) => region.sido === regionFilterSido) ?? REGION_TREE[0] ?? { districts: [] };
  const regionDistrictOptions = selectedRegionGroup.districts ?? [];
  const selectedRegionDistrict = regionDistrictOptions.includes(regionFilterDistrict) ? regionFilterDistrict : regionDistrictOptions[0] ?? defaultRegionSelection.district;
  const regionFilter = selectedRegionDistrict;
  const selectedRegionKey = stripRegionSuffix(selectedRegionDistrict);
  const startDateKey = getTodayInputValue();
  const startDateOptions = useMemo(() => getStartDateFilterOptions(), [startDateKey]);
  const startFilterLabel = startDateOptions.find((option) => option.id === startFilter)?.label ?? "전체 시작일";
  const filterRequestKey = `${regionFilterSido}:${selectedRegionKey}:${startFilter}:${roomScope}`;
  const debouncedFilterRequestKey = useDebouncedValue(filterRequestKey, RECRUITING_FILTER_DEBOUNCE_MS);
  const filterRequestSettled = filterRequestKey === debouncedFilterRequestKey;

  const selectRegionSido = (event) => {
    const nextSido = event.target.value;
    const nextGroup = REGION_TREE.find((region) => region.sido === nextSido) ?? REGION_TREE[0];
    setRoomScope("all");
    setRegionFilterSido(nextGroup?.sido ?? defaultRegionSelection.sido);
    setRegionFilterDistrict(nextGroup?.districts?.[0] ?? defaultRegionSelection.district);
  };
  const selectRegionDistrict = (event) => {
    setRoomScope("all");
    setRegionFilterDistrict(event.target.value);
  };

  useEffect(() => {
    if (targetFilter === "invited") {
      setRoomScope("invited");
      return;
    }
    if (!targetPostId) return;
    setQueue("all");
    setModeFilter("all");
    setRoomScope("all");
  }, [targetFilter, targetPostId]);

  useEffect(() => {
    if (!app.remoteReady || !app.currentUser.id) return;
    if (targetPostId) return;
    if (roomScope !== "all") return;
    if (!filterRequestSettled) return;
    const regionKey = selectedRegionKey;
    const currentScope = app.recruitingPagination?.regionScope ?? "local";
    const currentKey = app.recruitingPagination?.regionKey ?? "";
    const currentPageMatchesRegion = currentScope === "region" && currentKey === regionKey;
    const targetStartFilter = roomScope === "all" ? startFilter : "all";
    const currentStartFilter = app.recruitingPagination?.startFilter ?? "all";
    const needsFilteredPage = roomScope === "all"
      && startFilter !== "all"
      && currentStartFilter !== startFilter;
    const needsBasePage = targetStartFilter === "all" && currentStartFilter !== "all";
    const shouldIncludeFeedCounts = app.recruitingPagination?.feedCounts == null;
    if (currentPageMatchesRegion && !needsFilteredPage && !needsBasePage && !shouldIncludeFeedCounts) return;
    const loadKey = `${app.currentUser.id}:${regionFilter}:${regionKey}:${targetStartFilter}:${shouldIncludeFeedCounts ? "counts" : "plain"}`;
    if (regionLoadRef.current === loadKey) return;
    regionLoadRef.current = loadKey;
    Promise.resolve(app.actions.loadRecruitingRegion?.({
      regionScope: "region",
      regionKey,
      limit: needsFilteredPage ? RECRUITING_FILTER_PAGE_LIMIT : undefined,
      startFilter: targetStartFilter,
      includeFeedCounts: shouldIncludeFeedCounts,
    })).then((count) => {
      if (count !== false) regionLoadRef.current = "";
    }).catch(() => {
      // Keep the key on failure so the effect does not retry in a tight loop.
    });
  }, [app.actions, app.currentUser.id, app.remoteReady, app.recruitingPagination, filterRequestSettled, regionFilter, roomScope, selectedRegionKey, startFilter, targetPostId]);

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
      .filter((post) => !isExpiredInstantRecruitingPost(post))
      .filter((post) => canShowRecruitingQueuePost(post, {
        roomScope,
        currentUserId: app.currentUser.id,
        myTeamIds,
        targetPostId,
      }))
      .filter((post) => {
        const invited = hasPendingRecruitingInvitation(post, app.currentUser.id);
        const relationScoped = roomScope !== "all";
        return invited || relationScoped || post.id === targetPostId || isRegionRecruitingPost(post, selectedRegionKey, app.currentUser) || isNationalRecruitingPost(post, app.state);
      })
      .filter((post) => queue === "all" || (queue === "ranked" ? post.ranked !== false : post.ranked === false))
      .filter((post) => modeFilter === "all" || post.mode === modeFilter)
      .filter((post) => {
        if (startFilter === "all" || post.id === targetPostId) return true;
        if (roomScope !== "all") return true;
        if (startFilter === "instant") return isInstantRoom(post);
        return !isInstantRoom(post) && post.scheduledDate === startFilter;
      })
      .filter((post) => roomScope !== "created" || getRecruitingRoomOwnerId(post) === app.currentUser.id)
      .filter((post) => roomScope !== "joined" || (getRecruitingRoomOwnerId(post) !== app.currentUser.id && isRecruitingPostForUser(post, app.currentUser.id, myTeamIds)))
      .filter((post) => roomScope !== "invited" || hasPendingRecruitingInvitation(post, app.currentUser.id));
  }, [app.currentUser, app.currentUser.id, app.state, modeFilter, myTeamIds, queue, roomScope, selectedRegionKey, startFilter, targetPostId]);

  const posts = useMemo(() => {
    return scopedPosts.sort((a, b) => {
      const aLocal = Number(isLocalRecruitingPost(a, app.currentUser));
      const bLocal = Number(isLocalRecruitingPost(b, app.currentUser));
      const aMine = Number(isRecruitingPostForUser(a, app.currentUser.id, myTeamIds));
      const bMine = Number(isRecruitingPostForUser(b, app.currentUser.id, myTeamIds));
      const aNational = Number(isNationalRecruitingPost(a, app.state));
      const bNational = Number(isNationalRecruitingPost(b, app.state));
      const aInstant = Number(isInstantRoom(a));
      const bInstant = Number(isInstantRoom(b));
      return bMine - aMine || bInstant - aInstant || bLocal - aLocal || bNational - aNational || new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [app.currentUser, app.currentUser.id, app.state, myTeamIds, scopedPosts]);
  const queueListLoading = roomScope === "all" && !posts.length && (!filterRequestSettled || app.recruitingPagination?.loading);

  const selectedPost = selectedPostId
    ? app.state.recruitingPosts.find((post) => post.id === selectedPostId)
    : null;
  const selectedPostPending = Boolean(selectedPostId && !selectedPost);
  const selectedPostDetailLoading = Boolean(selectedPostId && selectedPostDetailLoadingId === selectedPostId);
  const openSelectedPost = (postId) => {
    if (!postId) return;
    setSelectedPostDetailLoadingId(postId);
    setSelectedPostId(postId);
  };
  useBodyScrollLock(Boolean(selectedPost) || selectedPostPending || selectedPostDetailLoading || composeOpen);

  useEffect(() => {
    if (!targetPostId || !app.remoteReady) return;
    const targetPost = app.state.recruitingPosts.find((post) => post.id === targetPostId);
    if (targetPost) {
      if (targetPostLoadRef.current === targetPostId && app.currentUser.id) {
        selectedPostRefreshRef.current = `${targetPostId}:${app.currentUser.id}`;
      }
      targetPostLoadRef.current = "";
      return;
    }
    if (targetPostLoadRef.current === targetPostId) return;
    targetPostLoadRef.current = targetPostId;
    setSelectedPostDetailLoadingId(targetPostId);
    Promise.resolve(app.actions.loadRecruitingPost?.(targetPostId)).finally(() => {
      setSelectedPostDetailLoadingId((currentId) => currentId === targetPostId ? null : currentId);
    });
  }, [app.actions, app.currentUser.id, app.remoteReady, app.state.recruitingPosts, targetPostId]);

  useEffect(() => {
    if (!targetPostId) return;
    setSelectedPostDetailLoadingId(targetPostId);
    setSelectedPostId(targetPostId);
  }, [targetPostId]);

  useEffect(() => {
    if (!selectedPostId) {
      selectedPostRefreshRef.current = "";
      setSelectedPostDetailLoadingId(null);
      return;
    }
    if (!app.remoteReady || !app.currentUser.id) return;
    const refreshKey = `${selectedPostId}:${app.currentUser.id}`;
    if (selectedPostRefreshRef.current === refreshKey) return;
    selectedPostRefreshRef.current = refreshKey;
    setSelectedPostDetailLoadingId(selectedPostId);
    Promise.resolve(app.actions.loadRecruitingPost?.(selectedPostId)).finally(() => {
      setSelectedPostDetailLoadingId((currentId) => currentId === selectedPostId ? null : currentId);
    });
  }, [app.actions, app.currentUser.id, app.remoteReady, selectedPostId]);

  useEffect(() => {
    if (!selectedPostId || !app.remoteReady || !app.currentUser.id) return undefined;
    if ((app.state.recruitingPosts ?? []).some((post) => post.id === selectedPostId)) return undefined;
    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      app.actions.loadRecruitingPost?.(selectedPostId);
    }, RECRUITING_ROOM_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [app.actions, app.currentUser.id, app.remoteReady, app.state.recruitingPosts, selectedPostId]);

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
  const feedCounts = app.recruitingPagination?.feedCounts ?? null;
  const getFeedCount = (key) => {
    const count = Number(feedCounts?.[key]);
    return Number.isFinite(count) ? count : 0;
  };
  const createdRoomCount = getFeedCount("created");
  const joinedRoomCount = getFeedCount("joined");
  const invitedRoomCount = getFeedCount("invited");
  const isRoomCountLoading = (scope) => (
    app.remoteReady === false
    || feedCounts == null
    || loadingRoomScope === scope
  );
  const formatRoomCount = (count, scope) => (isRoomCountLoading(scope) ? "..." : count);
  const getRelationButtonClass = (scope) => [
    roomScope === scope ? "active" : "",
    loadingRoomScope === scope ? "loading" : "",
  ].filter(Boolean).join(" ");

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const submit = (event) => {
    event.preventDefault();
    const selectedDraftCourt = courtByName[draft.court] ?? null;
    const nextDraft = {
      ...draft,
      courtId: selectedDraftCourt?.id ?? draft.courtId ?? "",
      region: selectedDraftCourt?.region ?? draft.region,
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
    if (RECRUITING_RELATION_SCOPES.has(target)) {
      setQueue("all");
      setModeFilter("all");
      setStartFilter("all");
    } else {
      setLoadingRoomScope("");
    }
    if (target === "all" || !app.remoteReady || !app.currentUser.id) return;
    const userId = app.currentUser.id;
    const includeFeedCounts = feedCounts == null;
    const pendingKey = `${userId}:${target}:${includeFeedCounts ? "counts" : "plain"}:pending`;
    if (myRecruitingLoadRef.current === pendingKey) return;
    myRecruitingLoadRef.current = pendingKey;
    setLoadingRoomScope(target);
    Promise.resolve(app.actions.loadMyRecruitingPosts?.(target, { includeFeedCounts })).finally(() => {
      myRecruitingLoadRef.current = "";
      setLoadingRoomScope((current) => (current === target ? "" : current));
    });
  };
  const selectStartFilter = (nextFilter) => {
    setRoomScope("all");
    setStartFilter((current) => (current === nextFilter ? "all" : nextFilter));
  };

  return (
    <div className="page-stack arena-recruit-page">
      <section className="arena-recruit-hero">
        <div className="arena-hero-copy">
          <span className="arena-kicker">MATCH QUEUE</span>
          <h1>대기 매칭</h1>
          <p>개인/팀 모집을 나누지 않는다. 공개방을 열면 참가자가 개인이나 팀 파티로 들어온다.</p>
        </div>
        <div className="arena-hero-panel">
          <div className="arena-hero-stats">
            <span><strong>{scopedPosts.length}</strong>OPEN</span>
            <span><strong>{rankedCount}</strong>RANKED</span>
            <span><strong>{friendlyCount}</strong>FRIENDLY</span>
          </div>
          <Link to="/app/create">
            <Button type="button" className="arena-hero-cta">
              <PlusCircle size={18} /> 경기방 만들기
            </Button>
          </Link>
        </div>
      </section>

      <section className={queueControlsOpen ? "arena-queue-controls" : "arena-queue-controls collapsed"}>
        <div className="arena-queue-controls-head">
          <div>
            <span className="arena-kicker">QUEUE FILTER</span>
            <strong>매치방 · {posts.length}개 표시</strong>
          </div>
          <button type="button" className="arena-collapse-button" onClick={() => setQueueControlsOpen((current) => !current)}>
            {queueControlsOpen ? "접기" : "펼치기"}
          </button>
        </div>

        {queueControlsOpen ? (
          <>
            <section className="arena-filter-bar" aria-label="필터">
              <label className="arena-filter-select arena-region-sido-filter">
                <select aria-label="시도" value={regionFilterSido} onChange={selectRegionSido}>
                  {REGION_TREE.map((region) => <option key={region.sido} value={region.sido}>{region.sido}</option>)}
                </select>
              </label>
              <label className="arena-filter-select arena-region-district-filter">
                <select aria-label="시군구" value={selectedRegionDistrict} onChange={selectRegionDistrict}>
                  {regionDistrictOptions.map((district) => <option key={district} value={district}>{district}</option>)}
                </select>
              </label>
              <div className="segmented-control compact-segments arena-filter-segment arena-relation-filter">
                <button type="button" className={getRelationButtonClass("created")} aria-busy={loadingRoomScope === "created"} onClick={() => selectRoomScope("created")}><span className="arena-filter-label">내가 만든 방</span><span className="arena-filter-badge">{formatRoomCount(createdRoomCount, "created")}</span></button>
                <button type="button" className={getRelationButtonClass("joined")} aria-busy={loadingRoomScope === "joined"} onClick={() => selectRoomScope("joined")}><span className="arena-filter-label">내 참여방</span><span className="arena-filter-badge">{formatRoomCount(joinedRoomCount, "joined")}</span></button>
                <button type="button" className={getRelationButtonClass("invited")} aria-busy={loadingRoomScope === "invited"} onClick={() => selectRoomScope("invited")}><span className="arena-filter-label">초대받음</span><span className="arena-filter-badge">{formatRoomCount(invitedRoomCount, "invited")}</span></button>
              </div>
              <div className="segmented-control compact-segments arena-filter-segment">
                <button type="button" className={queue === "all" ? "active" : ""} onClick={() => setQueue("all")}>전체</button>
                <button type="button" className={queue === "ranked" ? "active" : ""} onClick={() => setQueue("ranked")}>정규전</button>
                <button type="button" className={queue === "friendly" ? "active" : ""} onClick={() => setQueue("friendly")}>친선전</button>
              </div>
              <label className="arena-filter-select arena-mode-filter">
                <select aria-label="경기 방식" value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
                  <option value="all">전체 방식</option>
                  {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                </select>
              </label>
              <div className="arena-start-date-filter" aria-label="start date">
                {startDateOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={[
                      startFilter === option.id ? "active" : "",
                      option.weekend === "sat" ? "sat" : "",
                      option.weekend === "sun" ? "sun" : "",
                    ].filter(Boolean).join(" ")}
                    aria-pressed={startFilter === option.id}
                    onClick={() => selectStartFilter(option.id)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.subLabel}</span>
                  </button>
                ))}
              </div>
              <span className="arena-filter-count">{posts.length}개 표시</span>
            </section>
          </>
        ) : (
          <div className="arena-queue-summary">
            <span>{`${regionFilterSido} ${selectedRegionDistrict}`}</span>
            <span>{queue === "ranked" ? "정규전" : queue === "friendly" ? "친선전" : "전체"}</span>
            <span>{modeFilter === "all" ? "전체 방식" : MATCH_MODES.find((mode) => mode.id === modeFilter)?.label ?? modeFilter}</span>
            <span>{startFilterLabel}</span>
            <span>{roomScope === "created" ? `내가 만든 방 ${formatRoomCount(createdRoomCount, "created")}` : roomScope === "joined" ? `내 참여방 ${formatRoomCount(joinedRoomCount, "joined")}` : roomScope === "invited" ? `초대받음 ${formatRoomCount(invitedRoomCount, "invited")}` : "전체 방"}</span>
          </div>
        )}
      </section>

      <section className="arena-recruit-list" aria-label="매치 큐 목록">
        {posts.length ? posts.map((post) => {
          const lobby = getRecruitingLobby(post, app.state);
          const roomOwnerId = getRecruitingRoomOwnerId(post);
          const host = userById[roomOwnerId] ?? userById[post.playerId];
          const hostTeam = post.teamId ? teamById[post.teamId] : null;
          const targetTeam = post.targetTeamId ? teamById[post.targetTeamId] : null;
          const hostName = host?.name ?? post.hostName ?? "방장";
          const hostTeamName = hostTeam?.name ?? post.hostTeamName ?? "";
          const mine = roomOwnerId === app.currentUser.id;
          const myRoom = isRecruitingPostForUser(post, app.currentUser.id, myTeamIds);
          const invited = hasPendingRecruitingInvitation(post, app.currentUser.id);
          const roomTag = invited ? "초대받음" : mine ? "내가 만든 방" : "";
          const refereeLabel = getRoomRefereeLabel(post);
          const roomStatus = getRecruitingRoomListStatus(lobby, { post });
          const roomTitle = getRecruitingCardTitle(post);

          return (
            <article
              id={`recruiting-room-${post.id}`}
              key={post.id}
              className={`om-match-card om-status-contract arena-lobby-card ${myRoom ? "arena-my-room" : ""} ${invited ? "arena-invited-room" : ""} ${targetPostId === post.id ? "arena-target-room" : ""}`}
              onClick={() => openSelectedPost(post.id)}
            >
              <div className="om-card-main">
                <div className="om-card-kicker">
                  <span className={`om-status-pill ${roomStatus.tone}`}>{roomStatus.label}</span>
                  {roomTag ? <span className="om-card-official om-card-relation">{roomTag}</span> : null}
                  <span className="om-card-mode">{post.mode}</span>
                  <span className="om-card-official">{getRoomVisibilityLabel(post)}</span>
                  <span className="om-card-official">{getRecruitingRoomTypeLabel(post, lobby)}</span>
                  <span className="om-card-official">{getRoomCompetitionLabel(post)}</span>
                  {refereeLabel !== "심판 없음" ? <span className="om-card-official om-card-referee">{refereeLabel}</span> : null}
                  {targetTeam ? <span className="om-card-official">희망 상대 <TeamHoverCard team={targetTeam} as="span">{targetTeam.name}</TeamHoverCard></span> : post.targetTeamName ? <span className="om-card-official">희망 상대 {post.targetTeamName}</span> : null}
                  {isNationalRecruitingPost(post, app.state) ? <span className="om-card-official">전국 노출</span> : null}
                </div>
                {roomTitle ? <h3>{roomTitle}</h3> : null}
                <p>
                  <CalendarDays size={15} />
                  {getRecruitingSchedule(post)} · <CourtHoverCard court={courtByName[post.court]} courtName={post.court}>{post.court}</CourtHoverCard> ·{" "}
                  {hostTeam ? (
                    <TeamHoverCard team={hostTeam} as="span">{hostTeam.name}</TeamHoverCard>
                  ) : post.teamId && hostTeamName ? (
                    <span>{hostTeamName}</span>
                  ) : (
                    <PlayerHoverCard user={host} teams={app.state.teams} as="span">{hostName}</PlayerHoverCard>
                  )}
                </p>
                <QueueRoomBoard post={post} lobby={lobby} roomStatus={roomStatus} />
              </div>

              <button type="button" className="button button-secondary button-md om-room-link" onClick={(event) => {
                event.stopPropagation();
                openSelectedPost(post.id);
              }}>
                {roomStatus.actionLabel}
              </button>
            </article>
          );
        }) : queueListLoading ? (
          <div className="arena-empty-state">
            <div>
              <strong>매치방 불러오는 중</strong>
              <p>선택한 지역과 날짜의 공개방을 확인 중이다.</p>
            </div>
          </div>
        ) : (
          <div className="arena-empty-state">
            <div>
              <strong>조건에 맞는 매치방 없음</strong>
              <p>필터를 바꾸거나 새 매치방을 열어라.</p>
            </div>
          </div>
        )}
      </section>

      {roomScope === "all" && !app.recruitingPagination?.exhausted ? (
        <div className="om-load-more">
          <button type="button" className="button button-secondary button-md" disabled={app.recruitingPagination?.loading} onClick={() => app.actions.loadMoreRecruiting?.()}>
            {app.recruitingPagination?.loading ? "불러오는 중" : "더 보기"}
          </button>
          {app.recruitingPagination?.loadMoreError ? <span>더 보기 실패</span> : null}
        </div>
      ) : null}

      {selectedPost && !selectedPostDetailLoading ? (
        <RecruitingRoomModal
          app={app}
          post={selectedPost}
          skipInitialDetailLoad
          onClose={() => setSelectedPostId(null)}
          onOpenMatch={(matchId) => navigate(`/app/matches?match=${matchId}`)}
          onInvitationAccepted={() => {
            if (roomScope === "invited") setRoomScope("joined");
          }}
          onJoined={(postId) => {
            setSelectedPostDetailLoadingId(postId);
            setSelectedPostId(postId);
            selectedPostRefreshRef.current = "";
            Promise.resolve(app.actions.loadRecruitingPost?.(postId)).finally(() => {
              setSelectedPostDetailLoadingId((currentId) => currentId === postId ? null : currentId);
            });
            if (targetPostId !== postId) {
              navigate(`/app/recruiting?post=${encodeURIComponent(postId)}`, { replace: true });
            }
          }}
        />
      ) : selectedPostPending || selectedPostDetailLoading ? (
        <BasketballLoader overlay label="방 불러오는 중" />
      ) : null}

      {composeOpen ? (
        <div className="arena-compose-backdrop" role="presentation" onMouseDown={() => setComposeOpen(false)}>
          <aside className="arena-compose-drawer" role="dialog" aria-modal="true" aria-label="매치방 만들기" onMouseDown={(event) => event.stopPropagation()}>
            <div className="arena-drawer-head">
              <div>
                <span className="arena-kicker">CREATE ROOM</span>
                <h2>매치방 만들기</h2>
              </div>
              <button type="button" className="arena-icon-button" aria-label="닫기" onClick={() => setComposeOpen(false)}><X size={20} /></button>
            </div>

            <form className="arena-compose-form" onSubmit={submit}>
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
                <div className="arena-range-control">
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

              <div className="arena-field-grid">
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
                  <div className="arena-mini-note">
                    <div>
                      <span>일정</span>
                      <strong>즉시</strong>
                      <em>날짜/시간 입력 없음</em>
                    </div>
                    <Clock3 size={22} />
                  </div>
                )}
              </div>

              <div className="arena-field-grid three">
                <label>
                  지역
                  <select
                    value={draft.region}
                    onChange={(event) => {
                      const region = event.target.value;
                      const court = registeredCourts.find((item) => isSameRegion(item.region, region)) ?? null;
                      update({ region, courtId: court?.id ?? draft.courtId ?? "", court: court?.name ?? draft.court });
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
                  <select
                    value={draft.court}
                    onChange={(event) => {
                      const court = courtByName[event.target.value] ?? null;
                      update({ courtId: court?.id ?? "", court: event.target.value, ...(court?.region ? { region: court.region } : {}) });
                    }}
                  >
                    {registeredCourts.filter((court) => isSameRegion(court.region, draft.region) || draft.region === "전체").map((court) => (
                      <option key={court.id} value={court.name}>{court.region} · {court.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="arena-field-grid">
                {draft.hostJoinMode === "team" ? (
                  <div className="arena-party-field">
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
                <div className="arena-mini-note">
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

              <div className="arena-submit-row">
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

export default function Recruiting({ app }) {
  if (!app?.currentUser?.id) {
    return <BasketballLoader overlay label="프로필 불러오는 중" />;
  }
  if (app.remoteReady === false) {
    return null;
  }
  return <RecruitingReady app={app} />;
}
