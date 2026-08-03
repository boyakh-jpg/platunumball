import {
  useEffect,
  useState,
} from "react";

import {
  Crown,
  UserRound,
} from "lucide-react";
import Button from "../common/Button.jsx";
import {
  MatchListSummary,
} from "../match/MatchListCard.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import {
  DEFAULT_RATING,
  MAX_RECRUITING_RESERVES_PER_SIDE as MAX_RESERVE_PLAYERS_PER_SIDE,
} from "../../lib/constants.js";

import {
  getRecruitingListCardCounts,
  getSelectableTeamPlayerIds,
  isRecruitingTeamEntry,
  isTeamRecruitingRoom,
} from "../../lib/recruiting.js";

import {
  getMatchRuleSummary,
} from "../../lib/matchRules.js";

import {
  getPlayerPosition,
  getRoomSlotBadge,
  getRoomSlotDisplayPosition,
  getRoomSlotTeamName,
  RoomSlotAvatar,
} from "./RecruitingRoomSlotCore.jsx";

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
  const [commitPending, setCommitPending] = useState(false);
  const [commitError, setCommitError] = useState("");

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
  const commitRoster = async (nextSelectedIds, nextReserveIds) => {
    if (commitPending) return;
    setCommitPending(true);
    setCommitError("");
    try {
      const result = await onRosterChange?.({ selectedIds: nextSelectedIds, reserveIds: nextReserveIds });
      if (result === false || result?.ok === false) throw new Error("roster_save_failed");
      onChange?.(nextSelectedIds);
      onReserveChange?.(nextReserveIds);
    } catch {
      setCommitError("선수 명단을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setCommitPending(false);
    }
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
                <button type="button" className={selected ? "active" : ""} disabled={commitPending || !eligible || activeLocked} onClick={() => setMemberRole(playerId, "active")}>출전</button>
                {canSelectReserves ? (
                  <button type="button" className={reserve ? "active" : ""} disabled={commitPending || !eligible || reserveLocked} onClick={() => setMemberRole(playerId, "reserve")}>후보</button>
                ) : null}
                <button type="button" disabled={commitPending || required} onClick={() => setMemberRole(playerId, "none")}>해제</button>
              </div>
            </div>
          );
        })}
      </div>
      {!effectiveSelectedIds.length ? <em>최소 1명 선택 필요</em> : null}
      {commitError ? <p className="form-warning" role="alert">{commitError}</p> : null}
      {deferCommit ? (
        <Button type="button" size="sm" disabled={commitPending || !rosterChanged || !effectiveSelectedIds.length} onClick={() => void commitRoster(effectiveSelectedIds, effectiveReserveIds)}>
          {commitPending ? "저장 중..." : submitLabel}
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
