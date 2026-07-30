import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw } from "lucide-react";
import Button from "../common/Button.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import {
  MATCH_SIDES,
  MAX_RECRUITING_RESERVES_PER_SIDE as MAX_RESERVE_PLAYERS_PER_SIDE,
  SIDE_LABEL_TEXT as SIDE_LABELS,
} from "../../lib/constants.js";
import { isRecruitingPartyEntry } from "../../lib/recruiting.js";
import {
  getMatchReservePlayerIds,
  getMatchSidePlayerIds,
  getMatchSubstitutionAccess,
  isMatchLateAttendancePlayer,
} from "../../lib/matchUtils.js";

export function RoomKickPanel({
  lobby,
  userById,
  teams,
  hostPlayerId = "",
  onKickApplicant,
  onRemovePartyPlayer,
  onCheckInPlayer,
  onSetReserve,
  onSetPlacement,
  onSwapPlacement,
  allowSideMove = false,
  attendanceBySide = null,
  requireMissingAttendance = false,
  currentUserId = "",
  poolMode = false,
  placementByPlayerId = null,
  placementPlayerIds = null,
  onRefresh = null,
}) {
  const [pendingKick, setPendingKick] = useState(null);
  const [pendingSwap, setPendingSwap] = useState(null);
  const pickupAssignmentMode = Array.isArray(placementPlayerIds);
  const placementPlayerIdSet = Array.isArray(placementPlayerIds)
    ? new Set(placementPlayerIds.filter(Boolean))
    : null;
  const rows = [];
  (lobby.entries ?? []).forEach((entry) => {
    const partyEntry = isRecruitingPartyEntry(entry);
    const activeIds = entry.players ?? [];
    const reserveIds = (entry.reserves ?? []).filter((playerId) => !activeIds.includes(playerId));
    [
      ...activeIds.map((playerId) => ({ playerId, reserve: false })),
      ...reserveIds.map((playerId) => ({ playerId, reserve: true })),
    ].forEach(({ playerId, reserve }) => {
      if (!playerId || (!attendanceBySide && entry.fixed && playerId === entry.playerId)) return;
      const user = userById[playerId];
      if (!user) return;
      const placement = placementByPlayerId?.[playerId];
      rows.push({
        entry,
        partyEntry,
        playerId,
        reserve: placement?.reserve ?? reserve,
        side: placement?.side ?? entry.side,
        user,
      });
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
    <div className={`arena-host-kick-panel${pickupAssignmentMode ? " is-pickup-assignment" : ""}`}>
      <header>
        <strong>{onSwapPlacement ? "출석·팀 배치" : "참가자 관리"}</strong>
        <span>{onSwapPlacement
          ? "첫 선수를 고른 뒤 반대 사이드 선수를 선택하면 A/B·출전·대기 자리가 서로 바뀝니다."
          : "방장은 참가자 상태와 퇴장을 관리합니다."}</span>
        {attendanceBySide && onRefresh ? (
          <Button type="button" size="sm" variant="secondary" onClick={onRefresh}>
            <RefreshCw size={15} /> 새로고침
          </Button>
        ) : null}
      </header>
      <div className="arena-host-kick-list">
        {rows.map(({ entry, partyEntry, playerId, reserve, side, user }) => {
          const checkedIn = Boolean(attendanceBySide?.[side]?.includes(playerId));
          const placementAllowed = !placementPlayerIdSet || placementPlayerIdSet.has(playerId);
          const selfRow = playerId === currentUserId;
          const hostRow = playerId === hostPlayerId;
          const operatorAttendanceOptional = requireMissingAttendance && selfRow;
          const kickDisabled = selfRow || (requireMissingAttendance && checkedIn);
          return (
            <div key={`${entry.id}-${playerId}`} className="arena-host-kick-row">
              <PlayerHoverCard user={user} teams={teams} as="span">
                <ProfileEmblem user={user} className="small" />
                <span>
                  <strong>{user.name}</strong>
                  <em>{poolMode ? "개인 참가" : `${SIDE_LABELS[side]} · ${reserve ? "후보" : "출전"} · ${entry.team?.name ?? "개인"}`}</em>
                  {attendanceBySide ? <i>{checkedIn ? "출석 완료" : operatorAttendanceOptional ? "방장 확인 생략" : "미출석"}</i> : null}
                </span>
              </PlayerHoverCard>
              <div className="arena-host-kick-actions">
                {attendanceBySide && onCheckInPlayer ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={checkedIn ? "secondary" : "primary"}
                    disabled={checkedIn || operatorAttendanceOptional}
                    onClick={() => onCheckInPlayer(side, playerId)}
                  >
                    {checkedIn ? "출석 완료" : operatorAttendanceOptional ? "확인 생략" : "출석"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="danger-button"
                  disabled={kickDisabled}
                  onClick={() => setPendingKick({
                    entryId: entry.id,
                    partyEntry,
                    playerId,
                    playerName: user.name,
                  })}
                >
                  강퇴
                </Button>
                {onSetReserve ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!placementAllowed}
                    onClick={() => onSetReserve({ ...entry, side }, playerId, !reserve)}
                  >
                    {reserve ? "출전" : "후보"}
                  </Button>
                ) : null}
                {allowSideMove && onSetPlacement && !hostRow ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!placementAllowed}
                    onClick={() => onSetPlacement(playerId, { side: side === "teamA" ? "teamB" : "teamA", reserve })}
                  >
                    {side === "teamA" ? "B" : "A"} 이동
                  </Button>
                ) : null}
                {onSwapPlacement ? (
                  <Button
                    type="button"
                    size="sm"
                    className="arena-player-swap-button"
                    variant={pendingSwap?.playerId === playerId ? "primary" : "secondary"}
                    disabled={!placementAllowed || Boolean(pendingSwap && pendingSwap.side === side && pendingSwap.playerId !== playerId)}
                    onClick={() => {
                      if (!pendingSwap || pendingSwap.playerId === playerId) {
                        setPendingSwap(pendingSwap?.playerId === playerId ? null : { playerId, side });
                        return;
                      }
                      onSwapPlacement(pendingSwap.playerId, playerId);
                      setPendingSwap(null);
                    }}
                  >
                    {pendingSwap?.playerId === playerId
                      ? "선택됨"
                      : pendingSwap
                        ? "이 선수와 교환"
                        : "교환 선택"}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {pendingKick && typeof document !== "undefined" ? createPortal(
        <div className="arena-kick-confirm-backdrop" role="presentation" onMouseDown={closeKickConfirm}>
          <div
            className="arena-kick-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="강퇴 확인"
            onMouseDown={(event) => event.stopPropagation()}
          >
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

export function MatchSubstitutionPanel({
  match,
  userById,
  teams,
  currentUserId,
  canManageSide,
  onSubstitute,
}) {
  const [draftByReserveId, setDraftByReserveId] = useState({});
  const [reasonByReserveId, setReasonByReserveId] = useState({});
  if (!match) return null;
  const rows = MATCH_SIDES.flatMap((sideName) => {
    const access = getMatchSubstitutionAccess(match, currentUserId, sideName, {
      canOperate: canManageSide(sideName),
    });
    const activePlayerIds = match[sideName]?.players ?? [];
    const reservePlayerIds = access.allowedReservePlayerIds;
    if (!activePlayerIds.length || !reservePlayerIds.length) return [];
    return reservePlayerIds.map((reservePlayerId) => ({
      sideName,
      activePlayerIds,
      reservePlayerId,
      reserveUser: userById[reservePlayerId],
      canManage: access.canManage,
    }));
  });
  if (!rows.length) return null;

  return (
    <div className="arena-record-roster-panel">
      <header>
        <strong>선수 교체</strong>
        <span>배정 심판은 양 사이드를 교체하고, 후보는 본인 교체를 실행합니다.</span>
      </header>
      <div className="arena-record-roster-list">
        {rows.map(({ sideName, activePlayerIds, reservePlayerId, reserveUser, canManage }) => {
          const activePlayerId = draftByReserveId[reservePlayerId] ?? activePlayerIds[0] ?? "";
          const lateEligible = isMatchLateAttendancePlayer(match, reservePlayerId);
          return (
            <div key={`${sideName}:${reservePlayerId}`} className="arena-record-roster-row selected">
              <PlayerHoverCard user={reserveUser} teams={teams} as="span">
                <ProfileEmblem user={reserveUser} className="small" initial="P" />
                <span>
                  <strong>{reserveUser?.name ?? "후보"}</strong>
                  <em>{SIDE_LABELS[sideName]} 후보</em>
                </span>
              </PlayerHoverCard>
              <select
                value={activePlayerId}
                onChange={(event) => setDraftByReserveId((current) => ({ ...current, [reservePlayerId]: event.target.value }))}
              >
                {activePlayerIds.map((playerId) => (
                  <option value={playerId} key={playerId}>{userById[playerId]?.name ?? playerId}</option>
                ))}
              </select>
              {canManage ? (
                <select
                  aria-label={`${reserveUser?.name ?? "후보"} 교체 사유`}
                  value={reasonByReserveId[reservePlayerId] ?? "operator"}
                  onChange={(event) => setReasonByReserveId((current) => ({ ...current, [reservePlayerId]: event.target.value }))}
                >
                  <option value="operator">일반 교체</option>
                  {lateEligible ? <option value="late">지각 합류</option> : null}
                  <option value="ejection">퇴장</option>
                </select>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!activePlayerId}
                onClick={() => onSubstitute(
                  sideName,
                  activePlayerId,
                  reservePlayerId,
                  canManage ? reasonByReserveId[reservePlayerId] ?? "operator" : "self",
                )}
              >
                교체
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MatchRecordRosterPanel({
  match,
  sideName,
  team,
  userById,
  teams,
  currentUserId,
  sideLeaderId,
  capacity,
  tournamentRoster = false,
  eligiblePlayerIds = null,
  onChange,
  reserveCapacity = MAX_RESERVE_PLAYERS_PER_SIDE,
}) {
  const sourceActiveIds = getMatchSidePlayerIds(match, sideName);
  const sourceReserveIds = getMatchReservePlayerIds(match, sideName);
  const teamMemberIdSet = new Set((team?.members ?? []).map((member) => member.userId).filter(Boolean));
  const normalizeLeaderRoster = (activeIds = [], reserveIds = []) => {
    const activeSetIds = [...new Set(activeIds.filter(Boolean))];
    let nextActiveIds = activeSetIds.slice(0, capacity);
    let nextReserveIds = [...new Set(reserveIds.filter(Boolean))]
      .filter((playerId) => !nextActiveIds.includes(playerId))
      .slice(0, reserveCapacity);
    if (!tournamentRoster && sideLeaderId && teamMemberIdSet.has(sideLeaderId)) {
      nextActiveIds = [sideLeaderId, ...nextActiveIds.filter((playerId) => playerId !== sideLeaderId)].slice(0, capacity);
      nextReserveIds = nextReserveIds.filter((playerId) => playerId !== sideLeaderId);
    }
    return { activeIds: nextActiveIds, reserveIds: nextReserveIds };
  };
  const sourceRoster = normalizeLeaderRoster(sourceActiveIds, sourceReserveIds);
  const [draftRoster, setDraftRoster] = useState(sourceRoster);

  useEffect(() => {
    setDraftRoster(normalizeLeaderRoster(sourceActiveIds, sourceReserveIds));
  }, [
    match?.id,
    sideName,
    sideLeaderId,
    team?.id,
    capacity,
    tournamentRoster,
    sourceActiveIds.join("|"),
    sourceReserveIds.join("|"),
  ]);

  if (!match || !team || !sideLeaderId || sideLeaderId !== currentUserId) return null;
  const activeIds = draftRoster.activeIds;
  const reserveIds = draftRoster.reserveIds;
  const rosterIds = new Set([...activeIds, ...reserveIds]);
  const eligibleSet = Array.isArray(eligiblePlayerIds) ? new Set(eligiblePlayerIds) : null;
  const memberIds = (team.members ?? [])
    .map((member) => member.userId)
    .filter((playerId) => userById[playerId]);
  if (!memberIds.length) return null;

  const commitRoster = () => {
    const nextRoster = normalizeLeaderRoster(activeIds, reserveIds);
    onChange(sideName, {
      playerIds: nextRoster.activeIds,
      reservePlayerIds: nextRoster.reserveIds,
    });
  };
  const setPlayerState = (playerId, state) => {
    if (!tournamentRoster && playerId === sideLeaderId && state !== "active") return;
    if ((state === "active" || state === "reserve") && eligibleSet && !eligibleSet.has(playerId)) return;
    const nextActiveIds = activeIds.filter((id) => id !== playerId);
    const nextReserveIds = reserveIds.filter((id) => id !== playerId);
    if (state === "active" && nextActiveIds.length < capacity) {
      if (playerId === sideLeaderId) nextActiveIds.unshift(playerId);
      else nextActiveIds.push(playerId);
    }
    if (state === "reserve" && nextReserveIds.length < reserveCapacity) nextReserveIds.push(playerId);
    setDraftRoster({ activeIds: nextActiveIds, reserveIds: nextReserveIds });
  };
  const rosterChanged = (
    sourceActiveIds.join("|") !== activeIds.join("|")
    || sourceReserveIds.join("|") !== reserveIds.join("|")
  );

  return (
    <div className="arena-record-roster-panel">
      <header>
        <strong>{SIDE_LABELS[sideName]} {tournamentRoster ? "출전 명단 구성" : "출전자 확인"}</strong>
        <span>{team.name} · 출전 {activeIds.length}/{capacity}{reserveCapacity > 0 ? ` · 후보 ${reserveIds.length}/${reserveCapacity}` : ""}</span>
      </header>
      <div className="arena-record-roster-list">
        {memberIds.map((playerId) => {
          const user = userById[playerId];
          const isActive = activeIds.includes(playerId);
          const isReserve = reserveIds.includes(playerId);
          const isLeader = playerId === sideLeaderId;
          const eligible = !eligibleSet || eligibleSet.has(playerId);
          const stateLabel = isActive ? "출전" : isReserve ? "후보" : "미선택";
          return (
            <div
              key={playerId}
              className={[
                "arena-record-roster-row",
                rosterIds.has(playerId) ? "selected" : "",
                !eligible ? "ineligible" : "",
              ].filter(Boolean).join(" ")}
            >
              <PlayerHoverCard user={user} teams={teams} as="span">
                <ProfileEmblem user={user} className="small" />
                <span>
                  <strong>{user.name}</strong>
                  <em>{user.position ?? "포지션 자유"} · {eligible ? stateLabel : "조건 불일치"}{isLeader ? " · 사이드장" : ""}</em>
                </span>
              </PlayerHoverCard>
              <Button
                type="button"
                size="sm"
                variant={isActive ? "primary" : "secondary"}
                disabled={!eligible || (!isActive && activeIds.length >= capacity)}
                onClick={() => setPlayerState(playerId, "active")}
              >
                출전
              </Button>
              {reserveCapacity > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant={isReserve ? "primary" : "secondary"}
                  disabled={!eligible || (!tournamentRoster && isLeader) || (!isReserve && reserveIds.length >= reserveCapacity)}
                  onClick={() => setPlayerState(playerId, "reserve")}
                >
                  후보
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={(!tournamentRoster && isLeader) || (!isActive && !isReserve)}
                onClick={() => setPlayerState(playerId, "none")}
              >
                해제
              </Button>
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        size="sm"
        disabled={!rosterChanged || (tournamentRoster ? activeIds.length !== capacity : !activeIds.length)}
        onClick={commitRoster}
      >
        선수 확정
      </Button>
    </div>
  );
}
