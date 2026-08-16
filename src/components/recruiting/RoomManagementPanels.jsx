import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw } from "lucide-react";
import Button from "../common/Button.jsx";
import ModalShell from "../common/ModalShell.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import {
  MATCH_SIDES,
  MAX_RECRUITING_RESERVES_PER_SIDE as MAX_RESERVE_PLAYERS_PER_SIDE,
  PARTICIPANT_REMOVAL_REASON_MAX_LENGTH,
  PARTICIPANT_REMOVAL_REASON_MIN_LENGTH,
  SIDE_LABEL_TEXT as SIDE_LABELS,
  isValidParticipantRemovalReason,
  normalizeParticipantRemovalReason,
} from "../../lib/constants.js";
import { getRecruitingEntryPlacementIds, isRecruitingPartyEntry } from "../../lib/recruiting.js";
import {
  getMatchReservePlayerIds,
  getMatchSidePlayerIds,
  getMatchSubstitutionAccess,
  isMatchLateAttendancePlayer,
} from "../../lib/matchUtils.js";
const ROOM_PANEL_ACTION_ERROR = "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
function useRoomPanelAction() {
  const pendingRef = useRef(false);
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const runAction = async (actionKey, action) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingAction(actionKey);
    setActionError("");
    try {
      const result = await action();
      if (result === false || result?.ok === false) throw new Error("room_panel_action_failed");
      return true;
    } catch {
      setActionError(ROOM_PANEL_ACTION_ERROR);
      return false;
    } finally {
      pendingRef.current = false;
      setPendingAction("");
    }
  };
  return { actionError, pendingAction, runAction };
}
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
  canSetPlacement = null,
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
  const [kickAcknowledged, setKickAcknowledged] = useState(false);
  const [kickReason, setKickReason] = useState("");
  const [pendingSwap, setPendingSwap] = useState(null);
  const { actionError, pendingAction, runAction } = useRoomPanelAction();
  const pickupAssignmentMode = Array.isArray(placementPlayerIds);
  const placementPlayerIdSet = Array.isArray(placementPlayerIds)
    ? new Set(placementPlayerIds.filter(Boolean))
    : null;
  const rows = [];
  (lobby.entries ?? []).forEach((entry) => {
    const partyEntry = isRecruitingPartyEntry(entry);
    const { activeIds, reserveIds } = getRecruitingEntryPlacementIds(entry);
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
  const closeKickConfirm = () => {
    if (pendingAction) return;
    setPendingKick(null);
    setKickAcknowledged(false);
    setKickReason("");
  };
  const confirmKick = async () => {
    const target = pendingKick;
    const reason = normalizeParticipantRemovalReason(kickReason);
    if (!target || !kickAcknowledged || !isValidParticipantRemovalReason(reason)) return;
    const kicked = await runAction(`kick:${target.playerId}`, () => (target.partyEntry
      ? onRemovePartyPlayer(target.entryId, target.playerId, reason)
      : onKickApplicant(target.playerId, reason)));
    if (kicked) closeKickConfirm();
  };

  return (
    <div className={`arena-host-kick-panel${pickupAssignmentMode ? " is-pickup-assignment" : ""}`}>
      <header>
        <strong>{onSwapPlacement ? "출석·팀 배치" : "참가자 관리"}</strong>
        <span>{onSwapPlacement
          ? "첫 선수를 고른 뒤 반대 사이드 선수를 선택하면 A/B·출전·대기 자리가 서로 바뀝니다."
          : "방장은 참가자 상태와 퇴장을 관리합니다."}</span>
        {attendanceBySide && onRefresh ? (
          <Button type="button" size="sm" variant="secondary" disabled={Boolean(pendingAction)} onClick={() => void runAction("refresh", onRefresh)}>
            <RefreshCw size={15} /> {pendingAction === "refresh" ? "처리 중" : "새로고침"}
          </Button>
        ) : null}
      </header>
      <div className="arena-host-kick-list">
        {rows.map(({ entry, partyEntry, playerId, reserve, side, user }) => {
          const checkedIn = Boolean(attendanceBySide?.[side]?.includes(playerId));
          const placementAllowed = !placementPlayerIdSet || placementPlayerIdSet.has(playerId);
          const selfRow = playerId === currentUserId;
          const hostRow = playerId === hostPlayerId;
          const kickDisabled = selfRow || (requireMissingAttendance && checkedIn);
          const reserveAllowed = !canSetPlacement || canSetPlacement(playerId, { side, reserve: !reserve }), sideMoveAllowed = !canSetPlacement || canSetPlacement(playerId, { side: side === "teamA" ? "teamB" : "teamA", reserve });
          return (
            <div key={`${entry.id}-${playerId}`} className="arena-host-kick-row">
              <PlayerHoverCard user={user} teams={teams} as="span">
                <ProfileEmblem user={user} className="small" />
                <span>
                  <strong>{user.name}</strong>
                  <em>{poolMode ? "개인 참가" : `${SIDE_LABELS[side]} · ${reserve ? "후보" : "출전"} · ${entry.team?.name ?? "개인"}`}</em>
                  {attendanceBySide ? <i>{checkedIn ? "출석 완료" : "미출석"}</i> : null}
                </span>
              </PlayerHoverCard>
              <div className="arena-host-kick-actions">
                {attendanceBySide && onCheckInPlayer ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={checkedIn ? "secondary" : "primary"}
                    disabled={checkedIn || Boolean(pendingAction)}
                    onClick={() => void runAction(`checkin:${playerId}`, () => onCheckInPlayer(side, playerId))}
                  >
                    {checkedIn ? "출석 완료" : "출석"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="danger-button"
                  disabled={kickDisabled || Boolean(pendingAction)}
                  onClick={() => {
                    setKickAcknowledged(false);
                    setKickReason("");
                    setPendingKick({ entryId: entry.id, partyEntry, playerId, playerName: user.name });
                  }}
                >
                  강퇴
                </Button>
                {onSetReserve ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!placementAllowed || !reserveAllowed || Boolean(pendingAction)}
                    onClick={() => void runAction(`placement:${playerId}`, () => onSetReserve({ ...entry, side }, playerId, !reserve))}
                  >
                    {reserve ? "출전" : "후보"}
                  </Button>
                ) : null}
                {allowSideMove && onSetPlacement && !hostRow ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!placementAllowed || !sideMoveAllowed || Boolean(pendingAction)}
                    onClick={() => void runAction(`placement:${playerId}`, () => onSetPlacement(playerId, { side: side === "teamA" ? "teamB" : "teamA", reserve }))}
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
                    disabled={Boolean(pendingAction) || !placementAllowed || Boolean(pendingSwap && pendingSwap.side === side && pendingSwap.playerId !== playerId)}
                    onClick={() => {
                      if (!pendingSwap || pendingSwap.playerId === playerId) {
                        setPendingSwap(pendingSwap?.playerId === playerId ? null : { playerId, side });
                        return;
                      }
                      const firstPlayerId = pendingSwap.playerId;
                      void runAction(`swap:${firstPlayerId}:${playerId}`, () => onSwapPlacement(firstPlayerId, playerId))
                        .then((swapped) => {
                          if (swapped) setPendingSwap(null);
                        });
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
      {pendingAction ? <p className="form-warning" role="status">처리 중입니다.</p> : null}
      {actionError && !pendingKick ? <p className="form-warning" role="alert">{actionError}</p> : null}
      {pendingKick && typeof document !== "undefined" ? createPortal(
        <div className="arena-kick-confirm-backdrop" role="presentation" onMouseDown={closeKickConfirm}>
          <ModalShell as="div" className="arena-kick-confirm-dialog ui-room-modal" role="dialog" aria-modal="true" aria-label="강퇴 확인" onMouseDown={(event) => event.stopPropagation()}>
            <strong>{pendingKick.playerName} 강퇴</strong>
            <p>강퇴하면 즉시 방에서 제외됩니다. 반복 강퇴는 방장 신뢰도를 줄일 수 있습니다.</p>
            <label className="arena-kick-reason-field">
              <span>강퇴 사유</span>
              <textarea
                required
                minLength={PARTICIPANT_REMOVAL_REASON_MIN_LENGTH}
                maxLength={PARTICIPANT_REMOVAL_REASON_MAX_LENGTH}
                value={kickReason}
                onChange={(event) => setKickReason(event.target.value)}
                placeholder={`${PARTICIPANT_REMOVAL_REASON_MIN_LENGTH}자 이상 입력`}
              />
              <small>{kickReason.length}/{PARTICIPANT_REMOVAL_REASON_MAX_LENGTH}</small>
            </label>
            <label className="arena-kick-confirm-check">
              <input type="checkbox" checked={kickAcknowledged} onChange={(event) => setKickAcknowledged(event.target.checked)} />
              <span>해당 참가자를 경기에서 제외하는 것을 확인했습니다.</span>
            </label>
            {actionError ? <p className="form-warning" role="alert">{actionError}</p> : null}
            <div className="arena-kick-confirm-actions">
              <Button type="button" variant="secondary" disabled={Boolean(pendingAction)} onClick={closeKickConfirm}>취소하기</Button>
              <Button type="button" variant="primary" className="danger-button" disabled={Boolean(pendingAction) || !kickAcknowledged || !isValidParticipantRemovalReason(kickReason)} onClick={() => void confirmKick()}>{pendingAction ? "처리 중" : "강퇴하기"}</Button>
            </div>
          </ModalShell>
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
  const { actionError, pendingAction, runAction } = useRoomPanelAction();
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
                disabled={Boolean(pendingAction)}
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
                  disabled={Boolean(pendingAction)}
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
                disabled={!activePlayerId || Boolean(pendingAction)}
                onClick={() => void runAction(`substitute:${reservePlayerId}`, () => onSubstitute(
                  sideName,
                  activePlayerId,
                  reservePlayerId,
                  canManage ? reasonByReserveId[reservePlayerId] ?? "operator" : "self",
                ))}
              >
                {pendingAction === `substitute:${reservePlayerId}` ? "처리 중" : "교체"}
              </Button>
            </div>
          );
        })}
      </div>
      {actionError ? <p className="form-warning" role="alert">{actionError}</p> : null}
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
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState("");

  useEffect(() => {
    setDraftRoster(normalizeLeaderRoster(sourceActiveIds, sourceReserveIds));
    setSaveFeedback("");
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

  const commitRoster = async () => {
    if (saving || activeIds.length !== capacity) return;
    const nextRoster = normalizeLeaderRoster(activeIds, reserveIds);
    setSaving(true);
    setSaveFeedback("");
    try {
      const result = await onChange(sideName, {
        playerIds: nextRoster.activeIds,
        reservePlayerIds: nextRoster.reserveIds,
      });
      if (!result || result?.ok === false) {
        setSaveFeedback("선수 명단을 저장하지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      setSaveFeedback("선수 명단을 확정했습니다.");
    } catch {
      setSaveFeedback("선수 명단을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
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
                  <em>{user.position ?? "포지션 자유"} · {eligible ? stateLabel : "조건 불일치"}{isLeader ? " · 주장" : ""}</em>
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
        disabled={saving || !rosterChanged || activeIds.length !== capacity}
        onClick={commitRoster}
      >
        {saving ? "저장 중" : "선수 확정"}
      </Button>
      {saveFeedback ? (
        <span className="arena-record-roster-feedback" role="status">{saveFeedback}</span>
      ) : null}
    </div>
  );
}
