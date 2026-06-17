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
  UserMinus,
  UserPlus,
  UserRound,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
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

const SIDE_LABELS = {
  teamA: "A팀",
  teamB: "B팀",
};
const RECORDABLE_RESERVE_SOURCES = new Set(["reserve-entry", "team-reserve"]);
const MAX_RESERVE_PLAYERS_PER_SIDE = 2;

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
  const date = new Date();
  date.setDate(date.getDate() + 365);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRecruitingSchedule(post) {
  return [post.scheduledDate, post.scheduledTime].filter(Boolean).join(" ") || post.scheduledAt || "일정 미정";
}

function getDefaultApplyTeamId(post, teams) {
  return teams.find((team) => team.region === post.region)?.id ?? teams[0]?.id ?? "";
}

function getDefaultTeamPlayerIds(team, capacity) {
  if (!team) return [];
  return getSelectableTeamPlayerIds(team).slice(0, capacity);
}

function getPartyPlayerIds(team, playerIds, capacity) {
  if (!team) return [];
  if (!Array.isArray(playerIds)) return getDefaultTeamPlayerIds(team, capacity);
  const selectableIds = new Set(getSelectableTeamPlayerIds(team));
  return Array.from(new Set(playerIds.filter((playerId) => selectableIds.has(playerId)))).slice(0, capacity);
}

function getRoomEditDraft(post) {
  return {
    sideCapacity: getRecruitingSideCapacity(post),
    mmrRangeMode: post.mmrRangeMode ?? post.roomState?.mmrRangeMode ?? "narrow",
    targetScore: post.rules?.targetScore ?? 21,
    timeLimit: post.rules?.timeLimit ?? 12,
    winByTwo: post.rules?.winByTwo ?? true,
    ball: post.rules?.ball ?? "7호 공",
    attackRule: post.rules?.attackRule ?? "득점 후 공격권 교대",
    foulRule: post.rules?.foulRule ?? "파울 콜 즉시 중단, 공격권 유지",
    memo: post.memo ?? "",
  };
}

function getDefaultJoinDraft(post, teams, currentUser, state) {
  const teamId = getDefaultApplyTeamId(post, teams);
  const team = teams.find((item) => item.id === teamId) ?? null;
  const capacity = getRecruitingSideCapacity(post);
  return {
    joinMode: teamId ? "team" : "player",
    teamId,
    playerIds: getDefaultTeamPlayerIds(team, capacity),
    side: getRecruitingBestSide(post, state),
    reserve: false,
    position: currentUser.position,
  };
}

function getEntryMmr(entry) {
  return (entry.fixed || entry.kind === "team")
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
  if ((entry.fixed || entry.kind === "team") && entry.team) {
    const leader = entry.user?.name ? ` · ${entry.user.name}` : "";
    return `${entry.team?.name ?? "팀"}${leader}`;
  }
  return entry.user?.name ?? "플레이어";
}

function getLobbySideMeta(lobby, sideName, userById) {
  const side = lobby.sides[sideName];
  const teamEntry = side.entries.find((entry) => (entry.fixed || entry.kind === "team") && entry.team);
  const leadEntry = teamEntry ?? side.entries[0] ?? null;
  const playerMmrs = side.projectedPlayers
    .map((playerId) => userById[playerId]?.ratings?.integrated)
    .filter((value) => Number.isFinite(Number(value)));
  const avgMmr = playerMmrs.length
    ? Math.round(playerMmrs.reduce((sum, value) => sum + Number(value), 0) / playerMmrs.length)
    : 0;

  return {
    name: leadEntry?.team?.name ?? leadEntry?.user?.name ?? SIDE_LABELS[sideName],
    mmr: leadEntry?.team?.mmr ?? avgMmr,
    label: sideName === "teamA" ? "HOME TEAM" : "OPPONENT",
  };
}

function getPlayerPosition(user) {
  return user?.position || "포지션 자유";
}

function getTeamCaptainId(team) {
  return team?.members?.find((member) => member.role === "captain")?.userId ?? "";
}

function getRoomSlotBadge(playerId, entry, hostPlayerId) {
  if (!playerId) return null;
  if (playerId === hostPlayerId) return { tone: "host", label: "방장" };
  if (getTeamCaptainId(entry?.team) === playerId) return { tone: "captain", label: "주장" };
  return null;
}

function uniqueIds(ids = []) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function getEntryPlacementAvailability(entry, lobby) {
  return ["teamA", "teamB"].reduce((acc, sideName) => {
    const side = lobby.sides[sideName];
    const filledWithoutEntry = uniqueIds(side.entries
      .filter((item) => item.id !== entry.id)
      .flatMap((item) => item.players)).length;
    acc[sideName] = filledWithoutEntry + (entry.players?.length ?? 0) <= side.capacity;
    acc[`${sideName}Reserve`] = (entry.reserve && entry.side === sideName) || side.reserveCandidates.length < MAX_RESERVE_PLAYERS_PER_SIDE;
    return acc;
  }, {});
}

function getLobbyRecorderIds(lobby) {
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

function canMovePlayerTo(lobby, playerId, sideName, reserve = false) {
  const side = lobby.sides[sideName];
  if (!side) return false;
  if (reserve) return side.reserves.includes(playerId) || side.reserveCandidates.length < MAX_RESERVE_PLAYERS_PER_SIDE;
  return side.projectedPlayers.includes(playerId) || side.projectedFilled < side.capacity;
}

function getEntryPlayerReserveState(entry, playerId) {
  if (!entry || !playerId) return false;
  if (entry.reserve) return true;
  return (entry.reserves ?? []).includes(playerId) && !(entry.players ?? []).includes(playerId);
}

function getSameSidePartyOptions(lobby, myEntry, myTeams = [], targetSide = myEntry?.side) {
  if (!myEntry || myEntry.fixed || myEntry.kind === "team") return [];
  const sideEntries = lobby.sides[targetSide]?.entries ?? [];
  return myTeams.filter((team) => {
    const memberIds = new Set((team.members ?? []).map((member) => member.userId));
    return sideEntries.some((entry) => (
      entry.id !== myEntry.id &&
      (
        entry.team?.id === team.id ||
        (entry.kind === "player" && memberIds.has(entry.playerId))
      )
    ));
  });
}

function getJoinableSidePartyOptions(lobby, myTeams = [], currentUserId = "", targetSide = "") {
  const sides = ["teamA", "teamB"].filter((sideName) => !targetSide || sideName === targetSide);
  const seen = new Set();
  return sides.flatMap((sideName) => {
    const sideEntries = lobby.sides[sideName]?.entries ?? [];
    return myTeams.flatMap((team) => {
      const memberIds = new Set((team.members ?? []).map((member) => member.userId));
      const hasCurrentUser = memberIds.has(currentUserId);
      const canJoin = hasCurrentUser && sideEntries.some((entry) => (
        ![entry.playerId, ...(entry.players ?? []), ...(entry.reserves ?? [])].includes(currentUserId) &&
        (
          entry.team?.id === team.id ||
          (entry.kind === "player" && memberIds.has(entry.playerId))
        )
      ));
      const key = `${sideName}-${team.id}`;
      if (!canJoin || seen.has(key)) return [];
      seen.add(key);
      return [{ team, sideName }];
    });
  });
}

function SlotActionMenu({ label = "관리", children }) {
  return (
    <details className="ow-slot-action-menu" onClick={(event) => event.stopPropagation()}>
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  );
}

function PlacementActionButtons({ currentSide, currentReserve = false, availability = {}, onMove }) {
  const actions = [
    { side: "teamA", reserve: false, label: "A 출전", disabled: availability.teamA === false },
    { side: "teamB", reserve: false, label: "B 출전", disabled: availability.teamB === false },
    { side: "teamA", reserve: true, label: "A 후보", disabled: availability.teamAReserve === false },
    { side: "teamB", reserve: true, label: "B 후보", disabled: availability.teamBReserve === false },
  ];
  return actions.map((action) => (
    <button
      key={`${action.side}-${action.reserve ? "reserve" : "active"}`}
      type="button"
      className={currentSide === action.side && currentReserve === action.reserve ? "active" : ""}
      disabled={action.disabled}
      onClick={(event) => stopControlClick(event, () => onMove({ side: action.side, reserve: action.reserve }))}
    >
      {action.label}
    </button>
  ));
}

function getPartySlotClass(partyKey, partyCounts, partySeen) {
  if (!partyKey || (partyCounts[partyKey] ?? 0) < 2) return "";
  const index = partySeen[partyKey] ?? 0;
  partySeen[partyKey] = index + 1;
  const count = partyCounts[partyKey];
  const role = index === 0 ? "first" : index === count - 1 ? "last" : "middle";
  return `party-linked party-${role}`;
}

function PlayerRoomSlot({
  user,
  teams,
  status = "waiting",
  title = "",
  detail = "",
  mmr = 1200,
  badge = null,
  empty = false,
  invite = false,
  onInvite,
  onSelfAction,
  partyClassName = "",
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
  const slotContent = (
    <>
      {badge ? (
        <span className={`ow-room-slot-crown ${badge.tone}`} title={badge.label} aria-label={badge.label}>
          <Crown size={12} strokeWidth={3} />
        </span>
      ) : null}
      <span className="avatar" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "?"}</span>
      <strong>{user?.name ?? "플레이어"}</strong>
      <small>{getPlayerPosition(user)}</small>
      {detail ? <b>{detail}</b> : null}
      <TierBadge mmr={mmr} compact />
      <em>{title}</em>
    </>
  );

  return (
    <div className={`ow-room-player-slot-wrap ${partyClassName}`.trim()}>
      {onSelfAction ? (
        <button type="button" className={`${slotClassName} self-action`} onClick={onSelfAction}>
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
  if (post.playerId === currentUserId || post.playerIds?.includes(currentUserId)) return true;
  return (lobby.entries ?? []).some((entry) => entry.playerId === currentUserId || entry.players?.includes(currentUserId));
}

function TeamMemberPicker({ team, userById, selectedIds, capacity, onChange }) {
  if (!team) {
    return (
      <div className="ow-party-picker empty">
        <span>선택할 팀이 없다.</span>
      </div>
    );
  }

  const memberIds = getSelectableTeamPlayerIds(team);
  const selectedSet = new Set(selectedIds);
  const toggleMember = (playerId) => {
    const nextIds = selectedSet.has(playerId)
      ? selectedIds.filter((id) => id !== playerId)
      : [...selectedIds, playerId].slice(0, capacity);
    onChange(nextIds);
  };

  return (
    <div className="ow-party-picker">
      <div className="ow-party-picker-head">
        <span>참여 팀원</span>
        <strong>{selectedIds.length}/{capacity}</strong>
      </div>
      <div className="ow-party-picker-grid">
        {memberIds.map((playerId) => {
          const user = userById[playerId];
          const selected = selectedSet.has(playerId);
          const locked = !selected && selectedIds.length >= capacity;
          return (
            <button
              key={playerId}
              type="button"
              className={selected ? "selected" : ""}
              disabled={locked}
              onClick={() => toggleMember(playerId)}
            >
              <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "?"}</span>
              <span>
                <strong>{user?.name ?? "알 수 없음"}</strong>
                <em>{getPlayerPosition(user)}</em>
              </span>
              <TierBadge mmr={user?.ratings?.integrated ?? 1200} compact />
            </button>
          );
        })}
      </div>
      {!selectedIds.length ? <em>최소 1명 선택 필요</em> : null}
    </div>
  );
}

function EntryBlock({
  entry,
  lobby,
  userById,
  teams,
  canManage = false,
  onSetPlacement,
  onSetMemberReserve,
  onDetachMember,
  onRemoveMember,
  onKick,
}) {
  const mmr = getEntryMmr(entry);
  const players = entry.players.map((playerId) => userById[playerId]).filter(Boolean);
  const readyLabel = entry.status === "ready" ? "READY" : "WAIT";
  const availability = canManage && lobby ? getEntryPlacementAvailability(entry, lobby) : {};
  const activePlayerIds = entry.players ?? [];
  const canDemoteActive = activePlayerIds.length > 1;
  const isPartyEntry = entry.fixed || entry.kind === "team";
  const renderPlayerActions = (user) => {
    if (!canManage || !user) return null;
    if (!isPartyEntry) {
      return (
        <SlotActionMenu>
          <PlacementActionButtons
            currentSide={entry.side}
            currentReserve={Boolean(entry.reserve)}
            availability={availability}
            onMove={(placement) => onSetPlacement(entry.playerId, placement)}
          />
          {!entry.fixed ? (
            <button type="button" className="danger" onClick={(event) => stopControlClick(event, () => onKick(entry.playerId))}>
              강퇴
            </button>
          ) : null}
        </SlotActionMenu>
      );
    }
    return (
      <SlotActionMenu>
        <button
          type="button"
          disabled={!canDemoteActive || !canMovePlayerTo(lobby, user.id, entry.side, true)}
          onClick={(event) => stopControlClick(event, () => onSetMemberReserve(entry.id, user.id, true))}
        >
          후보로
        </button>
        {!(entry.fixed && user.id === entry.playerId) ? (
          <button
            type="button"
            onClick={(event) => stopControlClick(event, () => onDetachMember(entry.id, user.id))}
          >
            파티에서 내보내기
          </button>
        ) : null}
        {!(entry.fixed && user.id === entry.playerId) ? (
          <button type="button" className="danger" onClick={(event) => stopControlClick(event, () => onRemoveMember(entry.id, user.id))}>
            강퇴
          </button>
        ) : null}
      </SlotActionMenu>
    );
  };

  return (
    <div className={`ow-party-block ${entry.status === "ready" ? "ready" : ""}`}>
      <div className="ow-party-head">
        <div>
          <strong>
            {isPartyEntry && entry.team ? (
              <>
                <TeamHoverCard team={entry.team} as="span">{entry.team.name}</TeamHoverCard>
                {entry.fixed ? " · 방장 파티" : " · 팀 파티"}
              </>
            ) : getEntryTitle(entry)}
          </strong>
          <span>{isPartyEntry && entry.team ? `${players.length}명 팀 소속 참여` : entry.team ? `개인참여 · 원래 ${entry.team.name}` : getPlayerPosition(entry.user)}</span>
        </div>
        <div className="ow-party-meta">
          <TierBadge mmr={mmr} compact />
          <Badge tone={entry.status === "ready" ? "green" : "neutral"}>
            {entry.status === "ready" ? "READY" : "WAIT"}
          </Badge>
          {canManage ? (
            <SlotActionMenu>
              <PlacementActionButtons
                currentSide={entry.side}
                currentReserve={Boolean(entry.reserve)}
                availability={availability}
                onMove={(placement) => onSetPlacement(entry.playerId, placement)}
              />
              {!entry.fixed ? (
                <button type="button" className="danger" onClick={(event) => stopControlClick(event, () => onKick(entry.playerId))}>
                  {isPartyEntry ? "파티 강퇴" : "강퇴"}
                </button>
              ) : null}
            </SlotActionMenu>
          ) : null}
        </div>
      </div>
      <div className="ow-party-members">
        {players.map((user) => (
          <span key={user.id} className="ow-member-chip-wrap">
            <PlayerHoverCard user={user} teams={teams} className="ow-member-chip">
              <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
              <span>{user.name}</span>
              <b>{getPlayerPosition(user)}</b>
              <em>{readyLabel}</em>
            </PlayerHoverCard>
            {renderPlayerActions(user)}
          </span>
        ))}
      </div>
    </div>
  );
}

function QueueRoomBoard({ lobby, userById, teams }) {
  const entries = lobby.entries ?? [];
  const entryById = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
  const activeRows = entries.filter((entry) => !entry.reserve).map((entry) => {
    const user = entry.playerId ? userById[entry.playerId] : null;
    const players = (entry.players ?? []).map((playerId) => userById[playerId]).filter(Boolean);
    return {
      id: entry.id,
      label: getReadyTitle(entry),
      sideName: entry.side,
      reserve: Boolean(entry.reserve),
      ready: entry.status === "ready",
      user,
      team: entry.team,
      players,
    };
  });
  const fillRows = ["teamA", "teamB"].flatMap((sideName) => (
    (lobby.sides[sideName]?.fillSlots ?? []).map((candidate) => {
      const entry = entryById[candidate.entryId] ?? {};
      const user = userById[candidate.playerId] ?? candidate.user ?? null;
      const label = entry.team && user ? `${entry.team.name} · ${user.name}` : user?.name ?? getReadyTitle(entry);
      return {
        id: `fill-${sideName}-${candidate.playerId}`,
        label,
        sideName,
        reserve: false,
        ready: candidate.status === "ready",
        autoFill: true,
        user,
        team: entry.team ?? null,
        players: user ? [user] : [],
      };
    })
  ));
  const reserveRows = ["teamA", "teamB"].flatMap((sideName) => (
    (lobby.sides[sideName]?.reserveCandidates ?? []).map((candidate) => {
      const entry = entryById[candidate.entryId] ?? {};
      const user = userById[candidate.playerId] ?? candidate.user ?? null;
      const label = entry.team && user ? `${entry.team.name} · ${user.name}` : user?.name ?? getReadyTitle(entry);
      return {
        id: `reserve-${sideName}-${candidate.playerId}`,
        label,
        sideName,
        reserve: true,
        ready: candidate.status === "ready",
        user,
        team: entry.team ?? null,
        players: user ? [user] : [],
      };
    })
  ));
  const rows = [...activeRows, ...fillRows, ...reserveRows];
  const renderRow = (row) => (
    <span key={row.id} className={row.ready ? "ready" : "waiting"}>
      <span className="ow-queue-board-avatars" aria-hidden="true">
        {row.players.slice(0, 3).map((player) => (
          <PlayerHoverCard key={player.id} user={player} teams={teams} as="span">
            <span className="avatar small" style={{ "--avatar": player.avatarColor }}>{player.name.slice(0, 1)}</span>
          </PlayerHoverCard>
        ))}
        {row.players.length > 3 ? <i>+{row.players.length - 3}</i> : null}
      </span>
      <span className="ow-queue-board-name">
        {row.team ? (
          <TeamHoverCard team={row.team} as="span">
            <b>{row.label}</b>
          </TeamHoverCard>
        ) : row.user ? (
          <PlayerHoverCard user={row.user} teams={teams} as="span">
            <b>{row.label}</b>
          </PlayerHoverCard>
        ) : (
          <b>{row.label}</b>
        )}
      </span>
      <em>{row.autoFill ? "FILL" : row.ready ? "READY" : "WAIT"}</em>
    </span>
  );
  const renderGroup = (id, label, side) => {
    const groupRows = rows.filter((row) => (id === "reserve" ? row.reserve : !row.reserve && row.sideName === id));
    if (id === "reserve" && !groupRows.length) return null;
    return (
      <div className={`ow-queue-board-group ${id}`}>
        <header>
          <strong>{label}</strong>
          <small>{side ? `${side.projectedFilled}/${side.capacity}` : `${groupRows.length}명`}</small>
        </header>
        <div>{groupRows.length ? groupRows.map(renderRow) : <span className="empty">참여 없음</span>}</div>
      </div>
    );
  };
  const readyCount = rows.filter((row) => row.ready).length;
  const filledCount = lobby.sides.teamA.projectedFilled + lobby.sides.teamB.projectedFilled;
  const totalCapacity = lobby.sides.teamA.capacity + lobby.sides.teamB.capacity;

  return (
    <div className={lobby.canConfirm ? "ow-queue-board complete" : "ow-queue-board"}>
      <div className="ow-queue-board-head">
        <span>{lobby.canConfirm ? "CONFIRM" : "WAIT"}</span>
        <b>참여 {readyCount}/{rows.length}</b>
        <b>인원 {filledCount}/{totalCapacity}</b>
      </div>
      <div className="ow-queue-board-grid">
        {renderGroup("teamA", SIDE_LABELS.teamA, lobby.sides.teamA)}
        {renderGroup("teamB", SIDE_LABELS.teamB, lobby.sides.teamB)}
        {renderGroup("reserve", "후보", null)}
      </div>
    </div>
  );
}

function FillSlot({ candidate, lobby, userById, teams, hostPlayerId = "", currentUserId = "", readyText = "READY", partyClassName = "", onSelfAction }) {
  const user = candidate ? userById[candidate.playerId] : null;
  const readyLabel = candidate?.status === "ready" ? "READY" : "WAIT";
  const entry = candidate ? (lobby.entries ?? []).find((item) => item.id === candidate.entryId) : null;
  const badge = getRoomSlotBadge(candidate?.playerId, entry, hostPlayerId);
  if (!user) {
    return (
      <div className="ow-room-player-slot empty">
        <UserRound size={17} />
        <span>후보 없음</span>
      </div>
    );
  }

  return (
    <div className={`ow-room-player-slot-wrap ${partyClassName}`.trim()}>
      {candidate.playerId === currentUserId && onSelfAction ? (
        <button
          type="button"
          className={candidate.status === "ready" ? "ow-room-player-slot fill ready self-action" : "ow-room-player-slot fill self-action"}
          onClick={onSelfAction}
        >
          {badge ? (
            <span className={`ow-room-slot-crown ${badge.tone}`} title={badge.label} aria-label={badge.label}>
              <Crown size={12} strokeWidth={3} />
            </span>
          ) : null}
          <span className="avatar" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
          <strong>{user.name}</strong>
          <small>{getPlayerPosition(user)}</small>
          <b>{candidate.sourceLabel}</b>
          <TierBadge mmr={user.ratings.integrated} compact />
          <em>{candidate.status === "ready" ? readyText : readyLabel}</em>
        </button>
      ) : (
      <PlayerHoverCard user={user} teams={teams} className={candidate.status === "ready" ? "ow-room-player-slot fill ready" : "ow-room-player-slot fill"}>
        {badge ? (
          <span className={`ow-room-slot-crown ${badge.tone}`} title={badge.label} aria-label={badge.label}>
            <Crown size={12} strokeWidth={3} />
          </span>
        ) : null}
        <span className="avatar" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
        <strong>{user.name}</strong>
        <small>{getPlayerPosition(user)}</small>
        <b>{candidate.sourceLabel}</b>
        <TierBadge mmr={user.ratings.integrated} compact />
        <em>{candidate.status === "ready" ? readyText : readyLabel}</em>
      </PlayerHoverCard>
      )}
    </div>
  );
}

function SlotCommandPanel({ sideName, reserve = false, floating = false, canMoveHere = false, partyJoinOptions = [], onMoveHere, onJoinParty, onClose, children }) {
  return (
    <div className={floating ? "ow-slot-command-popover floating" : "ow-slot-command-popover"} onClick={(event) => event.stopPropagation()}>
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
        {partyJoinOptions.map((team) => (
          <Button key={team.id} type="button" size="sm" variant="secondary" onClick={() => onJoinParty(team.id)}>
            {team.name} 파티 합류
          </Button>
        ))}
      </div>
      {children}
    </div>
  );
}

function SelfSlotCommandPanel({
  entry,
  sideName,
  reserve = false,
  sourceTeam = null,
  canLeaveParty = false,
  partyJoinOptions = [],
  onLeaveParty,
  onJoinParty,
  onClose,
  children,
}) {
  const inParty = Boolean(entry?.fixed || entry?.kind === "team");
  const fromParty = Boolean(!inParty && sourceTeam);
  const partyText = inParty && entry?.team
    ? `${entry.team.name} 파티 연결됨`
    : fromParty
      ? `${sourceTeam.name} 파티에서 나와 개인 참여 중`
      : "개인 참여 중";

  return (
    <div className="ow-slot-command-popover ow-self-slot-popover floating" onClick={(event) => event.stopPropagation()}>
      <header>
        <div>
          <strong>내 슬롯 관리</strong>
          <span>{SIDE_LABELS[sideName]} · {reserve ? "후보" : "출전"} · {partyText}</span>
        </div>
        <button type="button" className="ow-icon-button" aria-label="닫기" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="ow-self-slot-status">
        <Badge tone={inParty ? "green" : fromParty ? "orange" : "neutral"}>{partyText}</Badge>
      </div>
      {children}
      <div className="ow-slot-command-actions">
        {canLeaveParty ? (
          <Button type="button" size="sm" variant="secondary" onClick={onLeaveParty}>
            파티 나가기
          </Button>
        ) : null}
        {partyJoinOptions.map((team) => (
          <Button key={team.id} type="button" size="sm" variant="secondary" onClick={() => onJoinParty(team.id)}>
            {team.name} 파티 합류
          </Button>
        ))}
      </div>
    </div>
  );
}

function SideRoster({
  sideName,
  side,
  lobby,
  userById,
  teams,
  hostPlayerId = "",
  currentUserId = "",
  canInvite = false,
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
        partyKey: (entry.fixed || entry.kind === "team") && entry.team?.id ? entry.id : "",
      });
    });
  });
  const partyCounts = activeSlots.reduce((acc, slot) => {
    if (slot.partyKey) acc[slot.partyKey] = (acc[slot.partyKey] ?? 0) + 1;
    return acc;
  }, {});
  const partySeen = {};
  const openSlots = Math.max(0, side.capacity - side.projectedFilled);
  return (
    <section className="ow-side-roster">
      <header>
        <div>
          <span>{SIDE_LABELS[sideName]}</span>
          <strong>{side.projectedFilled}/{side.capacity}</strong>
        </div>
      </header>
      <div className="ow-room-slot-row" style={{ "--slot-count": 5 }}>
        {activeSlots.map(({ entry, playerId, user }) => {
          const isPartyEntry = entry.fixed || entry.kind === "team";
          const partyLabel = isPartyEntry && entry.team ? entry.team.name : entry.team ? `${entry.team.name} · 개인` : "개인 참여";
          const partyClassName = getPartySlotClass((isPartyEntry && entry.team?.id) ? entry.id : "", partyCounts, partySeen);
          return (
            <PlayerRoomSlot
              key={`${sideName}-${entry.id}-${playerId}`}
              user={user}
              teams={teams}
              status={entry.status}
              title={entry.status === "ready" ? "READY" : "WAIT"}
              detail={partyLabel}
              mmr={user?.ratings?.integrated ?? getEntryMmr(entry)}
              badge={getRoomSlotBadge(playerId, entry, hostPlayerId)}
              partyClassName={partyClassName}
              onSelfAction={playerId === currentUserId ? () => onSelfSlotAction?.(sideName, false, playerId) : null}
            />
          );
        })}
        {side.fillSlots.map((candidate) => (
          <FillSlot
            key={`${sideName}-fill-${candidate.playerId}`}
            candidate={candidate}
            lobby={lobby}
            userById={userById}
            teams={teams}
            hostPlayerId={hostPlayerId}
            currentUserId={currentUserId}
            onSelfAction={() => onSelfSlotAction?.(sideName, false, candidate.playerId)}
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
                  onClick={() => onInviteSlot?.(sideName, false, slotKey)}
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

function stopControlClick(event, callback) {
  event.preventDefault();
  event.stopPropagation();
  callback();
}

function ReserveLine({
  sideName,
  candidates,
  playingIds,
  lobby,
  userById,
  teams,
  hostPlayerId = "",
  currentUserId = "",
  canInvite = false,
  recorderId = "",
  onInviteSlot,
  onSelfSlotAction,
}) {
  const playingSet = new Set(playingIds);
  const slots = candidates.slice(0, MAX_RESERVE_PLAYERS_PER_SIDE);
  const openSlots = Math.max(0, MAX_RESERVE_PLAYERS_PER_SIDE - slots.length);
  const slotTrackCount = 5;
  const partyCounts = slots.reduce((acc, candidate) => {
    const entry = (lobby.entries ?? []).find((item) => item.id === candidate.entryId);
    const partyKey = (entry?.fixed || entry?.kind === "team") && entry.team?.id ? entry.id : "";
    if (partyKey) acc[partyKey] = (acc[partyKey] ?? 0) + 1;
    return acc;
  }, {});
  const partySeen = {};
  return (
    <div className="ow-reserve-line">
      <strong>{SIDE_LABELS[sideName]} 후보 {candidates.length}/{MAX_RESERVE_PLAYERS_PER_SIDE}</strong>
      <div className="ow-room-reserve-row" style={{ "--slot-count": slotTrackCount }}>
        {slots.map((candidate) => {
          const user = userById[candidate.playerId];
          if (!user) return null;
          const canRecord = RECORDABLE_RESERVE_SOURCES.has(candidate.source) && candidate.status === "ready" && !playingSet.has(candidate.playerId);
          const assigned = recorderId === candidate.playerId;
          const readyText = canRecord ? (assigned ? "자동 기록자" : "기록 후보") : "후보";
          const entry = (lobby.entries ?? []).find((item) => item.id === candidate.entryId);
          const partyClassName = getPartySlotClass((entry?.fixed || entry?.kind === "team") && entry.team?.id ? entry.id : "", partyCounts, partySeen);
          return (
            <PlayerRoomSlot
              key={`${sideName}-${candidate.playerId}`}
              user={user}
              teams={teams}
              status={candidate.status}
              title={readyText}
              detail={candidate.sourceLabel}
              mmr={user.ratings?.integrated ?? 1200}
              badge={getRoomSlotBadge(candidate.playerId, entry, hostPlayerId)}
              partyClassName={partyClassName}
              onSelfAction={candidate.playerId === currentUserId ? () => onSelfSlotAction?.(sideName, true, candidate.playerId) : null}
            />
          );
        })}
        {Array.from({ length: openSlots }).map((_item, index) => {
          const slotKey = `${sideName}-reserve-${index}`;
          return (
            <Fragment key={slotKey}>
              <div className="ow-room-player-slot-wrap">
                <button
                  type="button"
                  className={canInvite ? "ow-room-player-slot empty invite" : "ow-room-player-slot empty"}
                  disabled={!canInvite}
                  onClick={() => onInviteSlot?.(sideName, true, slotKey)}
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

function RoomKickPanel({ lobby, userById, teams, onKickApplicant, onRemovePartyPlayer }) {
  const rows = [];
  (lobby.entries ?? []).forEach((entry) => {
    const isPartyEntry = entry.fixed || entry.kind === "team";
    const activeIds = entry.players ?? [];
    const reserveIds = (entry.reserves ?? []).filter((playerId) => !activeIds.includes(playerId));
    [
      ...activeIds.map((playerId) => ({ playerId, reserve: false })),
      ...reserveIds.map((playerId) => ({ playerId, reserve: true })),
    ].forEach(({ playerId, reserve }) => {
      if (!playerId || (entry.fixed && playerId === entry.playerId)) return;
      const user = userById[playerId];
      if (!user) return;
      rows.push({ entry, isPartyEntry, playerId, reserve, user });
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
        {rows.map(({ entry, isPartyEntry, playerId, reserve, user }) => (
          <div key={`${entry.id}-${playerId}`} className="ow-host-kick-row">
            <PlayerHoverCard user={user} teams={teams} as="span">
              <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
              <span>
                <strong>{user.name}</strong>
                <em>{SIDE_LABELS[entry.side]} · {reserve ? "후보" : "출전"} · {entry.team?.name ?? "개인"}</em>
              </span>
            </PlayerHoverCard>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="danger-button"
              onClick={() => (isPartyEntry ? onRemovePartyPlayer(entry.id, playerId) : onKickApplicant(entry.playerId))}
            >
              강퇴
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function HostRoomControls({ lobby, userById, teams, recorderIds = {}, canAssignRecorder = false, onSetPlacement, onSetMemberReserve, onAssignRecorder, onKick }) {
  const applicants = lobby.entries ?? [];

  if (!applicants.length) {
    return (
      <div className="ow-host-control-panel empty">
        <strong>방장 관리</strong>
        <span>관리할 참가자가 아직 없다.</span>
      </div>
    );
  }

  return (
    <div className="ow-host-control-panel">
      <header>
        <strong>방장 관리</strong>
        <span>A/B 배치, 후보 전환, 기록자 지정, 강퇴</span>
      </header>
      <div className="ow-host-control-list">
        {applicants.map((entry) => {
          const leader = userById[entry.playerId];
          const availability = getEntryPlacementAvailability(entry, lobby);
          const activePlayerIds = entry.players ?? [];
          const activePlayerSet = new Set(activePlayerIds);
          const reservePlayerIds = (entry.reserves ?? []).filter((playerId) => !activePlayerSet.has(playerId));
          const canPromoteReserve = lobby.sides[entry.side].filled < lobby.sides[entry.side].capacity;
          const canDemoteActive = activePlayerIds.length > 1;
          return (
            <article key={entry.id} className="ow-host-control-row">
              <div>
                <PlayerHoverCard user={leader} teams={teams} as="span">
                  <span className="avatar small" style={{ "--avatar": leader?.avatarColor }}>{leader?.name?.slice(0, 1) ?? "?"}</span>
                </PlayerHoverCard>
                <span>
                  <strong>{getEntryTitle(entry)}</strong>
                  <em>{SIDE_LABELS[entry.side]} · {entry.reserve ? "후보" : "출전"} · {entry.status === "ready" ? "READY" : "WAIT"}</em>
                </span>
              </div>
              <div className="ow-placement-actions">
                <Button
                  type="button"
                  size="sm"
                  variant={!entry.reserve && entry.side === "teamA" ? "primary" : "secondary"}
                  disabled={!availability.teamA}
                  onClick={() => onSetPlacement(entry.playerId, { side: "teamA", reserve: false })}
                >
                  A 출전
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={!entry.reserve && entry.side === "teamB" ? "primary" : "secondary"}
                  disabled={!availability.teamB}
                  onClick={() => onSetPlacement(entry.playerId, { side: "teamB", reserve: false })}
                >
                  B 출전
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={entry.reserve && entry.side === "teamA" ? "primary" : "secondary"}
                  onClick={() => onSetPlacement(entry.playerId, { side: "teamA", reserve: true })}
                >
                  A 후보
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={entry.reserve && entry.side === "teamB" ? "primary" : "secondary"}
                  onClick={() => onSetPlacement(entry.playerId, { side: "teamB", reserve: true })}
                >
                  B 후보
                </Button>
                {!entry.fixed ? (
                  <Button type="button" variant="secondary" className="danger-button" onClick={() => onKick(entry.playerId)}>
                    <UserMinus size={16} /> 강퇴
                  </Button>
                ) : null}
              </div>
              {entry.team && !entry.reserve ? (
                <div className="ow-member-adjust-actions">
                  {activePlayerIds.map((playerId) => {
                    const user = userById[playerId];
                    return (
                      <span key={`${entry.id}-${playerId}-active`} className="ow-member-adjust-chip">
                        <PlayerHoverCard user={user} teams={teams} as="span" className="ow-member-adjust-profile">
                          <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "?"}</span>
                          <span>{user?.name ?? "선수"}</span>
                        </PlayerHoverCard>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!canDemoteActive}
                          onClick={(event) => stopControlClick(event, () => onSetMemberReserve(entry.id, playerId, true))}
                        >
                          후보
                        </Button>
                      </span>
                    );
                  })}
                  {reservePlayerIds.map((playerId) => {
                    const user = userById[playerId];
                    const assigned = recorderIds[entry.side] === playerId;
                    const canRecord = canAssignRecorder && entry.status === "ready";
                    return (
                      <span key={`${entry.id}-${playerId}-reserve`} className={assigned ? "ow-member-adjust-chip reserve recorder" : "ow-member-adjust-chip reserve"}>
                        <PlayerHoverCard user={user} teams={teams} as="span" className="ow-member-adjust-profile">
                          <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "?"}</span>
                          <span>{user?.name ?? "후보"}</span>
                        </PlayerHoverCard>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!canPromoteReserve}
                          onClick={(event) => stopControlClick(event, () => onSetMemberReserve(entry.id, playerId, false))}
                        >
                          출전
                        </Button>
                        {canAssignRecorder ? (
                          <Button
                            type="button"
                            size="sm"
                            variant={assigned ? "primary" : "secondary"}
                            className="ow-recorder-action"
                            disabled={!canRecord}
                            onClick={(event) => stopControlClick(event, () => onAssignRecorder(entry.side, assigned ? "" : playerId))}
                          >
                            {assigned ? "기록 해제" : "기록자 지정"}
                          </Button>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function RoomChat({ messages, userById, teams, value, canChat, onChange, onSubmit }) {
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
    </div>
  );
}

function InvitePanel({
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
  const favoritePlayers = favoritePlayerIds.map((playerId) => userById[playerId]).filter(Boolean);
  const favoriteTeams = favoriteTeamIds.map((teamId) => teams.find((team) => team.id === teamId)).filter(Boolean);
  const teamMemberIds = matchedTeam ? getSelectableTeamPlayerIds(matchedTeam) : [];
  const selectedInvitableIds = selectedPlayerIds.filter((playerId) => !disabledSet.has(playerId));

  const renderPlayerInvite = (player) => {
    const disabled = !player || disabledSet.has(player.id);
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
          <span>{reserve ? "수락하면 해당 팀의 후보 선수로 들어온다." : "선착순 수락이다. 방이 차면 수락 실패."}</span>
        </div>
        <button type="button" className="ow-icon-button" aria-label="초대 닫기" onClick={onClose}><X size={18} /></button>
      </header>
      <label className="ow-invite-search">
        <Search size={17} />
        <input value={query} placeholder="#minjun 또는 #noeulkings" onChange={(event) => onQueryChange(event.target.value)} />
      </label>

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
          <Button type="button" size="sm" disabled={disabledSet.has(matchedUser.id)} onClick={() => onInvitePlayers([matchedUser.id], null)}>
            <UserPlus size={16} /> 초대
          </Button>
        </div>
      ) : null}

      {matchedTeam ? (
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
                <Button type="button" size="sm" disabled={alreadyApplied} onClick={() => onAccept(invitation.id)}>수락</Button>
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
  const [joinDraftByPost, setJoinDraftByPost] = useState({});
  const [chatDraftByPost, setChatDraftByPost] = useState({});
  const [inviteDraft, setInviteDraft] = useState(null);
  const [slotActionDraft, setSlotActionDraft] = useState(null);
  const [roomEditDraftByPost, setRoomEditDraftByPost] = useState({});
  const [draft, setDraft] = useState(() => ({
    hostJoinMode: myTeams[0]?.id ? "team" : "player",
    title: "",
    region: app.currentUser.region,
    court: COURTS.find((court) => court.region === app.currentUser.region)?.name ?? COURTS[0].name,
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
  const hasSchedule = Boolean(draft.scheduledDate && draft.scheduledTime && draft.court);
  const minScheduleDate = getTodayInputValue();
  const maxScheduleDate = getMaxInputValue();
  const scheduleAllowed = draft.scheduledDate >= minScheduleDate && draft.scheduledDate <= maxScheduleDate;
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
      .filter((post) => post.status !== "closed")
      .filter((post) => {
        const invited = hasPendingRecruitingInvitation(post, app.currentUser.id);
        return invited || scope !== "local" || post.region === app.currentUser.region || isNationalRecruitingPost(post, app.state);
      })
      .filter((post) => queue === "all" || (queue === "ranked" ? post.ranked !== false : post.ranked === false))
      .filter((post) => modeFilter === "all" || post.mode === modeFilter)
      .filter((post) => roomScope !== "created" || post.playerId === app.currentUser.id)
      .filter((post) => roomScope !== "joined" || (post.playerId !== app.currentUser.id && isRecruitingPostForUser(post, app.currentUser.id, myTeamIds)))
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
      return bMine - aMine || bLocal - aLocal || bNational - aNational || new Date(b.createdAt) - new Date(a.createdAt);
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
    .filter((post) => post.status !== "closed")
    .filter((post) => post.playerId === app.currentUser.id)
    .length;
  const joinedRoomCount = (app.state.recruitingPosts ?? [])
    .filter((post) => post.status !== "closed")
    .filter((post) => post.playerId !== app.currentUser.id)
    .filter((post) => isRecruitingPostForUser(post, app.currentUser.id, myTeamIds))
    .length;
  const invitedRoomCount = (app.state.recruitingPosts ?? [])
    .filter((post) => post.status !== "closed")
    .filter((post) => hasPendingRecruitingInvitation(post, app.currentUser.id))
    .length;

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const submit = (event) => {
    event.preventDefault();
    const nextDraft = { ...draft, title: draft.title.trim() || getDefaultTitle(draft) };
    app.actions.createRecruitingPost(nextDraft);
    setDraft((current) => ({ ...current, title: "", memo: "빈자리는 개인 또는 팀 파티로 들어올 수 있습니다." }));
    setComposeOpen(false);
  };

  const selectRoomScope = (nextScope) => {
    const target = roomScope === nextScope ? "all" : nextScope;
    setRoomScope(target);
    if (target !== "all") setScope("all");
  };

  const getJoinDraft = (post) => joinDraftByPost[post.id] ?? getDefaultJoinDraft(post, myTeams, app.currentUser, app.state);
  const updateJoinDraft = (post, patch) => {
    setJoinDraftByPost((current) => ({
      ...current,
      [post.id]: { ...getJoinDraft(post), ...patch },
    }));
  };
  const submitJoin = (post) => {
    const joinDraft = getJoinDraft(post);
    app.actions.interestRecruitingPost(post.id, joinDraft);
  };
  const getChatDraft = (post) => chatDraftByPost[post.id] ?? "";
  const updateChatDraft = (post, value) => {
    setChatDraftByPost((current) => ({ ...current, [post.id]: value }));
  };
  const submitChat = (event, post) => {
    event.preventDefault();
    const body = getChatDraft(post).trim();
    if (!body) return;
    app.actions.sendRecruitingChat(post.id, body);
    updateChatDraft(post, "");
  };
  const openInviteSlot = (post, sideName, reserve = false, slotKey = "") => {
    setSlotActionDraft(null);
    setInviteDraft({ postId: post.id, sideName, reserve, slotKey, query: "", selectedPlayerIds: [] });
  };
  const openSelfSlotAction = (post, sideName, reserve = false, playerId = "") => {
    setInviteDraft(null);
    setSlotActionDraft({ postId: post.id, sideName, reserve, playerId });
  };
  const getRoomEditDraftByPost = (post) => roomEditDraftByPost[post.id] ?? null;
  const openRoomEdit = (post) => {
    setRoomEditDraftByPost((current) => ({ ...current, [post.id]: getRoomEditDraft(post) }));
  };
  const closeRoomEdit = (post) => {
    setRoomEditDraftByPost((current) => {
      const next = { ...current };
      delete next[post.id];
      return next;
    });
  };
  const updateRoomEditDraft = (post, patch) => {
    setRoomEditDraftByPost((current) => ({
      ...current,
      [post.id]: { ...(current[post.id] ?? getRoomEditDraft(post)), ...patch },
    }));
  };
  const saveRoomEdit = (post) => {
    const roomEditDraft = getRoomEditDraftByPost(post);
    if (!roomEditDraft) return;
    app.actions.updateRecruitingRoomRules(post.id, roomEditDraft);
    closeRoomEdit(post);
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
  const sendInvites = (post, playerIds, teamId = null) => {
    if (!inviteDraft || !playerIds.length) return;
    app.actions.inviteRecruitingPlayers(post.id, { side: inviteDraft.sideName, reserve: Boolean(inviteDraft.reserve), playerIds, teamId });
    setInviteDraft((current) => (current ? { ...current, selectedPlayerIds: [] } : current));
  };
  const confirmMatch = (post) => {
    const matchId = app.actions.confirmRecruitingMatch(post.id);
    if (!matchId) return;
    setSelectedPostId(null);
    navigate(`/app/matches?match=${matchId}`);
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
          const host = userById[post.playerId];
          const hostTeam = post.teamId ? teamById[post.teamId] : null;
          const targetTeam = post.targetTeamId ? teamById[post.targetTeamId] : null;
          const applicantEntry = { kind: "player", joinMode: "player", playerId: app.currentUser.id };
          const applied = hasRecruitingApplicant(post, applicantEntry)
            || myTeams.some((team) => hasRecruitingApplicant(post, { kind: "team", joinMode: "team", teamId: team.id }));
          const mine = post.playerId === app.currentUser.id;
          const myRoom = isRecruitingPostForUser(post, app.currentUser.id, myTeamIds);
          const invited = hasPendingRecruitingInvitation(post, app.currentUser.id);
          const roomTag = invited ? "초대받음" : mine ? "내가 만든 방" : myRoom ? "내 참여방" : "";

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
                <h3>{post.title}</h3>
                <div className="ow-card-meta">
                  <MapPin size={15} />
                  <span>
                    {post.region} · {post.court} · {" "}
                    {hostTeam ? <TeamHoverCard team={hostTeam} as="span">{hostTeam.name}</TeamHoverCard> : host?.name ?? "방장"}
                  </span>
                </div>
                <QueueRoomBoard lobby={lobby} userById={userById} teams={app.state.teams} />
                <div className="ow-card-bottom">
                  <span>{getRecruitingSchedule(post)}</span>
                  <span className="ow-tier-chip">{post.ranked === false ? "티어 자유" : range.label}</span>
                  <span>{formatWhen(post.createdAt)}</span>
                  <span>{lobby.ready ? "READY" : "WAIT"}</span>
                </div>
              </div>

              <div className="ow-card-side" onClick={(event) => event.stopPropagation()}>
                <span className="ow-slot-count">
                  <strong>{lobby.sides.teamA.projectedFilled + lobby.sides.teamB.projectedFilled}/{getRecruitingSideCapacity(post) * 2}</strong>
                  <span>참가 인원</span>
                </span>
                <Button type="button" className="ow-card-action" onClick={() => setSelectedPostId(post.id)}>
                  <Swords size={16} /> 방 보기
                </Button>
                {!mine && !applied ? (
                  <Button
                    type="button"
                    className="ow-card-action"
                    variant="secondary"
                    onClick={() => app.actions.interestRecruitingPost(post.id, getDefaultJoinDraft(post, myTeams, app.currentUser, app.state))}
                  >
                    <Clock3 size={16} /> 빠른 참여
                  </Button>
                ) : null}
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

      {selectedPost ? (() => {
        const lobby = getRecruitingLobby(selectedPost, app.state);
        const joinDraft = getJoinDraft(selectedPost);
        const selectedJoinTeam = myTeams.find((team) => team.id === joinDraft.teamId) ?? myTeams[0] ?? null;
        const joinCapacity = getRecruitingSideCapacity(selectedPost);
        const selectedJoinPlayerIds = getPartyPlayerIds(selectedJoinTeam, joinDraft.playerIds, joinCapacity);
        const candidateMmr = joinDraft.joinMode === "team"
          ? selectedJoinTeam?.mmr ?? 0
          : app.currentUser.ratings.integrated;
        const fit = getRecruitingFit(selectedPost, candidateMmr || app.currentUser.ratings.integrated, app.state);
        const mine = selectedPost.playerId === app.currentUser.id;
        const myEntry = lobby.entries.find((entry) => (
          entry.playerId === app.currentUser.id ||
          entry.players?.includes(app.currentUser.id) ||
          entry.reserves?.includes(app.currentUser.id)
        ));
        const alreadyApplied = Boolean(myEntry && !mine);
        const canInviteFromRoom = isCurrentUserRoomParticipant(selectedPost, lobby, app.currentUser.id);
        const canChat = isRecruitingPostForUser(selectedPost, app.currentUser.id, myTeamIds);
        const canJoin = !mine && !alreadyApplied && fit.allowed && (joinDraft.joinMode === "player" || (Boolean(selectedJoinTeam) && selectedJoinPlayerIds.length > 0));
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
        const maxSideFilled = Math.max(lobby.sides.teamA.projectedFilled, lobby.sides.teamB.projectedFilled);
        const roomEditCapacityValid = !roomEditDraft || Number(roomEditDraft.sideCapacity) >= maxSideFilled;
        const playingIds = [...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers];
        const partyJoinOptions = getSameSidePartyOptions(lobby, myEntry, myTeams);
        const sidePartyJoinOptions = getJoinableSidePartyOptions(lobby, myTeams, app.currentUser.id);
        const roomState = selectedPost.roomState ?? {};
        const recorderIds = getLobbyRecorderIds(lobby);
        const chatMessages = roomState.chatMessages ?? [];
        const invitations = roomState.invitations ?? [];
        const pendingInvitations = invitations.filter((invitation) => invitation.status === "pending");
        const moveCandidate = (candidate, placement) => {
          const candidateEntry = lobby.entries.find((entry) => entry.id === candidate.entryId);
          if (candidateEntry?.fixed || candidateEntry?.kind === "team") {
            app.actions.setRecruitingPartyPlayerPlacement(selectedPost.id, candidate.entryId, candidate.playerId, placement);
            return;
          }
          app.actions.setRecruitingApplicantPlacement(selectedPost.id, candidate.playerId, placement);
        };
        const removeCandidate = (candidate) => {
          const candidateEntry = lobby.entries.find((entry) => entry.id === candidate.entryId);
          if (candidateEntry?.fixed || candidateEntry?.kind === "team") {
            app.actions.removeRecruitingPartyPlayer(selectedPost.id, candidate.entryId, candidate.playerId);
            return;
          }
          app.actions.kickRecruitingApplicant(selectedPost.id, candidate.playerId);
        };
        const disabledInvitePlayerIds = [
          app.currentUser.id,
          selectedPost.playerId,
          ...lobby.entries.flatMap((entry) => [entry.playerId, ...(entry.players ?? []), ...(entry.reserves ?? [])]),
          ...pendingInvitations.map((invitation) => invitation.targetUserId),
        ].filter(Boolean);
        const activeInviteDraft = inviteDraft?.postId === selectedPost.id ? inviteDraft : null;
        const activeSelfSlotDraft = slotActionDraft?.postId === selectedPost.id ? slotActionDraft : null;
        const favoritePlayerIds = app.state.settings?.favoritePlayerIds ?? [];
        const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
        const teamAMeta = getLobbySideMeta(lobby, "teamA", userById);
        const teamBMeta = getLobbySideMeta(lobby, "teamB", userById);
        const roomReadyLabel = lobby.canConfirm ? "READY" : "WAIT";
        const roomTitle = selectedPost.ranked === false ? "친선전" : "정규전";
        const activeSlotDraft = activeInviteDraft?.slotKey ? activeInviteDraft : null;
        const currentUserReserve = getEntryPlayerReserveState(myEntry, app.currentUser.id);
        const currentUserInEntry = Boolean(myEntry && (
          myEntry.playerId === app.currentUser.id ||
          myEntry.players?.includes(app.currentUser.id) ||
          myEntry.reserves?.includes(app.currentUser.id)
        ));
        const currentUserPartyLocked = Boolean(myEntry?.fixed && app.currentUser.id === selectedPost.playerId);
        const currentUserInParty = Boolean(currentUserInEntry && (myEntry?.fixed || myEntry?.kind === "team"));
        const canMoveActiveUserToSlot = (sideName, reserve) => {
          if (!myEntry || !currentUserInEntry) return false;
          const samePlacement = myEntry.side === sideName && currentUserReserve === reserve;
          if (samePlacement) return false;
          if (!canMovePlayerTo(lobby, app.currentUser.id, sideName, reserve)) return false;
          if (myEntry.kind === "player" && myEntry.playerId === app.currentUser.id) return true;
          if (currentUserInParty && myEntry.side === sideName) return true;
          if (currentUserInParty && !currentUserPartyLocked) return true;
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
          if (currentUserInParty && !currentUserPartyLocked) {
            app.actions.detachRecruitingPartyPlayer(selectedPost.id, myEntry.id, app.currentUser.id, { side: sideName, reserve });
            setInviteDraft(null);
            setSlotActionDraft(null);
          }
        };
        const leaveCurrentParty = () => {
          if (!currentUserInParty || currentUserPartyLocked || !myEntry) return;
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
              canMoveHere={canMoveHere}
              partyJoinOptions={targetPartyOptions}
              onMoveHere={() => moveActiveUserToSlot(sideName, reserve)}
              onJoinParty={(teamId) => app.actions.joinRecruitingSideParty(selectedPost.id, teamId, sideName)}
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
        const renderSelfPlacementActions = () => {
          if (!myEntry || !currentUserInEntry) return null;
          return (
            <div className="ow-self-placement-actions">
              {selfPlacementActions.map((action) => {
                const active = myEntry.side === action.side && currentUserReserve === action.reserve;
                const movable = canMoveActiveUserToSlot(action.side, action.reserve);
                return (
                  <Button
                    key={`${action.side}-${action.reserve ? "reserve" : "active"}`}
                    type="button"
                    size="sm"
                    variant={active ? "primary" : "secondary"}
                    aria-pressed={active}
                    disabled={!active && !movable}
                    onClick={() => {
                      if (!active) moveActiveUserToSlot(action.side, action.reserve);
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
          if (!activeSelfSlotDraft || !myEntry || !currentUserInEntry) return null;
          const sourceTeam = myEntry.sourceTeamId ? teamById[myEntry.sourceTeamId] : null;
          const targetPartyOptions = getSameSidePartyOptions(lobby, myEntry, myTeams, activeSelfSlotDraft.sideName);
          return (
            <SelfSlotCommandPanel
              entry={myEntry}
              sideName={activeSelfSlotDraft.sideName}
              reserve={Boolean(activeSelfSlotDraft.reserve)}
              sourceTeam={sourceTeam}
              canLeaveParty={currentUserInParty && !currentUserPartyLocked}
              partyJoinOptions={targetPartyOptions}
              onLeaveParty={leaveCurrentParty}
              onJoinParty={(teamId) => {
                app.actions.joinRecruitingSideParty(selectedPost.id, teamId, activeSelfSlotDraft.sideName);
                setSlotActionDraft(null);
              }}
              onClose={() => setSlotActionDraft(null)}
            >
              {renderSelfPlacementActions()}
            </SelfSlotCommandPanel>
          );
        };

        return (
          <div className="ow-compose-backdrop" role="presentation" onPointerDown={() => { setInviteDraft(null); setSlotActionDraft(null); setSelectedPostId(null); }}>
            <aside className="ow-lobby-modal" role="dialog" aria-modal="true" aria-label="매치방" onPointerDown={(event) => event.stopPropagation()}>
              <div className="ow-lobby-arena">
                <div className="ow-lobby-topline">
                  <div className="badge-row">
                    <Badge tone={selectedPost.ranked === false ? "neutral" : "gold"}>{roomTitle}</Badge>
                    <Badge tone={lobby.canConfirm ? "green" : "blue"}>{lobby.canConfirm ? "CONFIRM" : "WAIT"}</Badge>
                    <Badge tone="green">사전등록</Badge>
                  </div>
                  <div>
                    <span>{selectedPost.mode}</span>
                  </div>
                </div>

                <div className="ow-lobby-title">
                  <span>{selectedPost.visibility === "private" ? "PRIVATE ROOM" : "CUSTOM ROOM"}</span>
                  <h2>{roomTitle}</h2>
                  <p><MapPin size={16} />{selectedPost.court} · {getRecruitingSchedule(selectedPost)}</p>
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
                      hostPlayerId={selectedPost.playerId}
                      currentUserId={app.currentUser.id}
                      canInvite={canInviteFromRoom}
                      canManage={mine}
                      onInviteSlot={(sideName, reserve, slotKey) => openInviteSlot(selectedPost, sideName, reserve, slotKey)}
                      onSelfSlotAction={(sideName, reserve, playerId) => openSelfSlotAction(selectedPost, sideName, reserve, playerId)}
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
                      hostPlayerId={selectedPost.playerId}
                      currentUserId={app.currentUser.id}
                      canInvite={canInviteFromRoom}
                      canManage={mine}
                      onInviteSlot={(sideName, reserve, slotKey) => openInviteSlot(selectedPost, sideName, reserve, slotKey)}
                      onSelfSlotAction={(sideName, reserve, playerId) => openSelfSlotAction(selectedPost, sideName, reserve, playerId)}
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
                    hostPlayerId={selectedPost.playerId}
                    currentUserId={app.currentUser.id}
                    canInvite={canInviteFromRoom}
                    canManage={mine}
                    recorderId={recorderIds.teamA}
                    lobby={lobby}
                    onInviteSlot={(sideName, reserve, slotKey) => openInviteSlot(selectedPost, sideName, reserve, slotKey)}
                    onSelfSlotAction={(sideName, reserve, playerId) => openSelfSlotAction(selectedPost, sideName, reserve, playerId)}
                    onMoveCandidate={moveCandidate}
                    onRemoveCandidate={removeCandidate}
                  />
                  <ReserveLine
                    sideName="teamB"
                    candidates={lobby.sides.teamB.reserveCandidates}
                    playingIds={playingIds}
                    userById={userById}
                    teams={app.state.teams}
                    hostPlayerId={selectedPost.playerId}
                    currentUserId={app.currentUser.id}
                    canInvite={canInviteFromRoom}
                    canManage={mine}
                    recorderId={recorderIds.teamB}
                    lobby={lobby}
                    onInviteSlot={(sideName, reserve, slotKey) => openInviteSlot(selectedPost, sideName, reserve, slotKey)}
                    onSelfSlotAction={(sideName, reserve, playerId) => openSelfSlotAction(selectedPost, sideName, reserve, playerId)}
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
                  onTogglePlayer={toggleInvitePlayer}
                  onInvitePlayers={(playerIds, teamId) => sendInvites(selectedPost, playerIds, teamId)}
                  onToggleFavoritePlayer={(playerId) => app.actions.toggleFavoritePlayer(playerId)}
                  onToggleFavoriteTeam={(teamId) => app.actions.toggleFavoriteTeam(teamId)}
                  onClose={() => setInviteDraft(null)}
                />
              ) : null}

              <InvitationPanel
                invitations={invitations}
                userById={userById}
                teams={app.state.teams}
                currentUserId={app.currentUser.id}
                alreadyApplied={alreadyApplied}
                onAccept={(invitationId) => app.actions.acceptRecruitingInvitation(selectedPost.id, invitationId)}
                onDecline={(invitationId) => app.actions.declineRecruitingInvitation(selectedPost.id, invitationId)}
              />

              {mine ? (
                <RoomKickPanel
                  lobby={lobby}
                  userById={userById}
                  teams={app.state.teams}
                  onKickApplicant={(playerId) => app.actions.kickRecruitingApplicant(selectedPost.id, playerId)}
                  onRemovePartyPlayer={(entryId, playerId) => app.actions.removeRecruitingPartyPlayer(selectedPost.id, entryId, playerId)}
                />
              ) : null}

              <div className="ow-room-rule-panel">
                <div className="ow-room-rule-head">
                  <strong>규칙</strong>
                  {mine ? (
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
                {roomEditDraft ? (
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
                      메모
                      <textarea value={roomEditDraft.memo} onChange={(event) => updateRoomEditDraft(selectedPost, { memo: event.target.value })} />
                    </label>
                    {!roomEditCapacityValid ? <span className="form-warning">현재 출전 인원이 {maxSideFilled}명이라 정원을 그보다 낮출 수 없습니다.</span> : null}
                    <div className="ow-room-edit-actions">
                      <Button type="button" size="sm" variant="secondary" onClick={() => closeRoomEdit(selectedPost)}>취소</Button>
                      <Button type="button" size="sm" disabled={!roomEditCapacityValid} onClick={() => saveRoomEdit(selectedPost)}>수정 저장</Button>
                    </div>
                    <small>저장하면 방장 포함 모든 참가자가 CONFIRM을 다시 눌러야 합니다.</small>
                  </div>
                ) : null}
                <span>{selectedPost.memo}</span>
                <span>팀 MMR은 실제 참가한 팀원 비율 기준으로 반영한다.</span>
                <span>후보가 경기 밖에서 참여 확정하면 해당 팀 개인 활약 기록자로 배정된다.</span>
                <span>확정 후 불참하면 신뢰점수 패널티 대상이다.</span>
              </div>

              <RoomChat
                messages={chatMessages}
                userById={userById}
                teams={app.state.teams}
                value={getChatDraft(selectedPost)}
                canChat={canChat}
                onChange={(value) => updateChatDraft(selectedPost, value)}
                onSubmit={(event) => submitChat(event, selectedPost)}
              />

              <div className="ow-join-panel">
                {mine ? (
                  <div className="ow-owner-panel">
                    <strong>방장 권한</strong>
                    <span>{lobby.canConfirm ? "CONFIRM" : "WAIT"}</span>
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
                        {sidePartyJoinOptions.map(({ team, sideName }) => (
                          <Button
                            key={`${sideName}-${team.id}`}
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => app.actions.joinRecruitingSideParty(selectedPost.id, team.id, sideName)}
                          >
                            {SIDE_LABELS[sideName]} {team.name} 파티 합류
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    <div className="segmented-control compact-segments">
                      {Object.entries(RECRUITING_JOIN_MODES).map(([mode, meta]) => (
                        <button
                          key={mode}
                          type="button"
                          className={joinDraft.joinMode === mode ? "active" : ""}
                          onClick={() => {
                            const teamId = mode === "team" ? getDefaultApplyTeamId(selectedPost, myTeams) : "";
                            const team = myTeams.find((item) => item.id === teamId) ?? null;
                            updateJoinDraft(selectedPost, {
                              joinMode: mode,
                              teamId,
                              playerIds: mode === "team" ? getDefaultTeamPlayerIds(team, joinCapacity) : [],
                            });
                          }}
                        >
                          {meta.label}
                        </button>
                      ))}
                    </div>
                    {joinDraft.joinMode === "team" ? (
                      <>
                        <label>
                          참여 팀
                          <select
                            value={joinDraft.teamId}
                            onChange={(event) => {
                              const teamId = event.target.value;
                              const team = myTeams.find((item) => item.id === teamId) ?? null;
                              updateJoinDraft(selectedPost, {
                                teamId,
                                playerIds: getDefaultTeamPlayerIds(team, joinCapacity),
                              });
                            }}
                          >
                            {myTeams.length ? myTeams.map((team) => (
                              <option key={team.id} value={team.id}>{team.name} · {team.mmr}</option>
                            )) : <option value="">내 팀 없음</option>}
                          </select>
                        </label>
                        <TeamMemberPicker
                          team={selectedJoinTeam}
                          userById={userById}
                          selectedIds={selectedJoinPlayerIds}
                          capacity={joinCapacity}
                          onChange={(playerIds) => updateJoinDraft(selectedPost, { playerIds })}
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
                          <option value="teamA">A팀</option>
                          <option value="teamB">B팀</option>
                        </select>
                      </label>
                      <label className="ow-check-row">
                        <input type="checkbox" checked={joinDraft.reserve} onChange={(event) => updateJoinDraft(selectedPost, { reserve: event.target.checked })} />
                        후보로 참여
                      </label>
                    </div>
                    <div className="ow-mini-note">
                      <div>
                        <span>{joinDraft.joinMode === "team" ? "팀 파티" : "개인 참여"}</span>
                        <strong>{fit.label}</strong>
                        <em>{fit.range.label}</em>
                      </div>
                      <TierBadge mmr={candidateMmr || app.currentUser.ratings.integrated} compact />
                    </div>
                    <Button type="submit" disabled={!canJoin}>
                      {joinDraft.joinMode === "team" ? <UsersRound size={18} /> : <UserRound size={18} />}
                      READY
                    </Button>
                  </form>
                )}

                {myEntry && myEntry.status !== "ready" ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => app.actions.setRecruitingReady(selectedPost.id, true)}
                  >
                    <CheckCircle2 size={18} />
                    CONFIRM
                  </Button>
                ) : null}
                {alreadyApplied ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="danger-button"
                    onClick={() => app.actions.cancelRecruitingParticipation(selectedPost.id)}
                  >
                    <XCircle size={18} /> 참여 취소
                  </Button>
                ) : null}
                {mine ? (
                  <Button type="button" disabled={!lobby.canConfirm} onClick={() => confirmMatch(selectedPost)}>
                    <Swords size={18} /> CONFIRM
                  </Button>
                ) : null}
                {mine ? (
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
                  onClick={() => { setInviteDraft(null); setSelectedPostId(null); }}
                >
                  <X size={20} /> 방 닫기
                </Button>
              </div>
            </aside>
          </div>
        );
      })() : null}

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

              <div className="ow-field-grid">
                <label>
                  날짜
                  <input type="date" required min={minScheduleDate} max={maxScheduleDate} value={draft.scheduledDate} onChange={(event) => update({ scheduledDate: event.target.value })} />
                </label>
                <label>
                  시간
                  <input type="time" required value={draft.scheduledTime} onChange={(event) => update({ scheduledTime: event.target.value })} />
                </label>
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
                    <em>{draft.hostJoinMode === "team" ? `${selectedHostPlayerIds.length}명 선택 배치` : "개인 1명이 A팀에 배치"}</em>
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
                  <ShieldCheck size={17} /> {canPostRecruiting ? "등록 가능" : hasSchedule ? "팀/팀원 선택 필요" : "날짜/시간/장소 필요"}
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
