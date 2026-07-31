import {
  useEffect,
  useState,
} from "react";

import Button from "../common/Button.jsx";
import NumericStepper from "../common/NumericStepper.jsx";
import MatchDisputeQueue from "../match/MatchDisputeQueue.jsx";
import {
  getTeamCaptainMemberId as getTeamCaptainId,
} from "../../data/teamMappers.js";

import {
  MATCH_SIDES,
  PLAYER_STAT_FIELDS,
  SIDE_LABEL_TEXT as SIDE_LABELS,
} from "../../lib/constants.js";

import {
  normalizeRegionText,
} from "../../lib/regionText.js";

import {
  buildMatchResultSubmission,
  formatStatLine,
  getOpenMatchDisputes,
  getMatchRecordWindow,
  getMatchRoomPhase,
  getMatchSideRecordPlayerIds,
  getMergedResultScore,
  normalizePlayerStats,
  getPublicRoomTimingStatus,
  isInstantRoom,
  isMatchRecordMatch,
} from "../../lib/matchUtils.js";

import {
  getNonNegativeNumber,
} from "../../lib/recruitingPage.js";
import { getRecordSummaryNames } from "../../../shared/lib/matchMappers.js";

function getSourceMatchUserSideName(match, userId) {
  if (!match || !userId) return null;
  if (match.teamA?.players?.includes(userId)) return "teamA";
  if (match.teamB?.players?.includes(userId)) return "teamB";
  return null;
}

export function getSourceMatchDecisionSideName(match, userId, teams = []) {
  const playerSideName = getSourceMatchUserSideName(match, userId);
  if (playerSideName) return playerSideName;
  const sideName = MATCH_SIDES.find((name) => {
    const teamId = match?.[name]?.teamId;
    if (!teamId) return false;
    const team = teams.find((item) => item.id === teamId);
    return getTeamCaptainId(team) === userId;
  });
  return sideName ?? null;
}

export function getSourceMatchStatus(match, lobby, userId = "") {
  if (!match) return { label: "대기방", tone: lobby.canConfirm ? "green" : "blue" };
  const phase = getMatchRoomPhase(match);
  return { label: phase.label, tone: phase.tone };
}

export function getSourceMatchAction(match, userId, teams = [], userById = {}) {
  if (!match) return { label: "경기 정보", detail: "명단과 룰을 확인합니다." };
  const agreedResultOpen = match.status === "agreed" && match.endedAt && match.result && !getMatchRecordWindow(match).disputeExpired;
  const effectiveStatus = agreedResultOpen ? "approval" : match.status;
  if (effectiveStatus === "disputed") {
    const openCount = getOpenMatchDisputes(match).length;
    const authorityLabel = match.refereeId ? "배정 심판" : "방장";
    return {
      label: "이의신청방",
      detail: openCount
        ? `${authorityLabel}이 이의제기 ${openCount}건을 사유와 함께 가결 또는 부결합니다.`
        : `이의 처리가 끝나면 ${authorityLabel}이 별도로 최종 승인합니다.`,
      disputed: true,
    };
  }
  const sideName = getSourceMatchDecisionSideName(match, userId, teams);
  if (!sideName) return { label: "경기 정보", detail: "명단과 룰을 확인합니다." };
  if (effectiveStatus === "contract") {
    const agreed = (match.agreements?.[sideName] ?? []).includes(userId);
    return agreed
      ? { label: "확정방", detail: "다른 참가자 동의를 기다립니다." }
      : { label: "확정방", detail: "현재 명단과 룰에 동의하면 경기준비로 넘어갑니다.", action: "agree", button: "동의" };
  }
  if (effectiveStatus === "approval") {
    if (isMatchRecordMatch(match)) {
      return {
        label: "참가 확인 대기",
        detail: "각 참가자가 본인의 참가 사실을 확인합니다.",
      };
    }
    const authorityLabel = match.refereeId ? "배정 심판" : "방장";
    return {
      label: "최종 승인 대기",
      detail: `${authorityLabel}이 최종 점수를 확인한 뒤 확정합니다.`,
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
    return {
      label: "경기시작",
      detail: match.refereeId
        ? "배정 심판만 팀 점수와 개인 스탯을 기록합니다. 경기시계 담당자는 시계와 샷클락만 조작합니다."
        : match.rules?.gameClockEnabled === false
          ? "방장이 경기 종료 전까지 양쪽 팀 점수를 기록합니다."
          : "경기시계 담당자가 경기 종료 전까지 양쪽 팀 점수를 기록합니다.",
    };
  }
  if (phase.phase === "postgame") {
    return {
      label: "경기 종료",
      detail: match.refereeId
        ? "배정 심판이 팀 점수와 개인 스탯을 정리하고 최종 승인합니다."
        : "방장이 경기 중 기록된 팀 점수를 확인하고 최종 승인합니다.",
    };
  }
  if (phase.phase === "dispute") return { label: "결과 확인", detail: "이의신청 시간 안에 기록을 확인합니다." };
  if (phase.phase === "record") return {
    label: "경기 기록",
    detail: match.refereeId
      ? "확정된 팀 점수와 개인 스탯을 열람합니다."

      : "확정된 팀 점수를 열람합니다.",
  };
  if (phase.phase === "cancelled" || phase.phase === "void") return { label: phase.label, detail: "닫힌 방입니다." };
  return { label: "경기 정보", detail: "현재 상태를 확인합니다." };
}

export function canShowRecruitingQueuePost(post, { targetPostId }) {
  if (post.visibility !== "private") return true;
  if (post.id === targetPostId) return true;
  return false;
}

export function stripRegionSuffix(value = "") {
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

export function isLocalRecruitingPost(post = {}, user = {}) {
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

export function isRegionRecruitingPost(post = {}, regionKey = "", user = {}) {
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

export function isExpiredInstantRecruitingPost(post = {}) {
  return isInstantRoom(post) && getPublicRoomTimingStatus(post).expired;
}

function getSourceMatchPlayerName(match, userById, sideName, playerId, index, fallback) {
  return (
    userById[playerId]?.name
    || match.anonymousPlayers?.[playerId]?.name
    || getRecordSummaryNames(match, sideName)[index]
    || fallback
  );
}

export function SourceMatchRecordSummary({ match, userById }) {
  if (!match?.result) return null;
  const result = match.disputeDraftResult ?? match.result;
  const renderSide = (sideName) => {
    const sidePlayerIds = getMatchSideRecordPlayerIds(match, sideName, false);
    const playerStats = normalizePlayerStats(result.playerStats, sidePlayerIds);
    return (
    <div className="arena-source-record-side" key={sideName}>
      <strong>{match[sideName]?.name ?? SIDE_LABELS[sideName]}</strong>
      {sidePlayerIds.map((playerId, index) => (
          <div key={playerId}>
            <span>{getSourceMatchPlayerName(match, userById, sideName, playerId, index, "플레이어")}</span>
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
      {match.refereeId ? <div className="arena-source-record-grid">
        {MATCH_SIDES.map(renderSide)}
      </div> : null}
    </div>
  );
}

function makeSourceMatchDraft(match) {
  const result = match?.disputeDraftResult ?? match?.result ?? {};
  const playerIds = MATCH_SIDES.flatMap((sideName) => getMatchSideRecordPlayerIds(match, sideName));
  return {
    scoreA: Number(result.scoreA ?? match?.teamA?.score ?? 0),
    scoreB: Number(result.scoreB ?? match?.teamB?.score ?? 0),
    playerStats: normalizePlayerStats(result.playerStats, playerIds),
    statSubmissions: result.statSubmissions ?? {},
    submittedBy: result.submittedBy,
    submittedAt: result.submittedAt,
  };
}

export function SourceMatchDisputeEditor({
  match,
  userById,
  canReview,
  onSave,
  getEditableStatFields = null,
  editableScoreSides = [],
  submitLabel = "",
}) {
  const [draft, setDraft] = useState(() => makeSourceMatchDraft(match));

  useEffect(() => {
    setDraft(makeSourceMatchDraft(match));
  }, [match?.id, match?.result?.updatedAt, match?.disputeDraftResult?.updatedAt]);

  if (!match) return null;
  const hasResult = Boolean(match.result);
  const sideNames = MATCH_SIDES;
  const getEditableFieldsForPlayer = (playerId) => (
    canReview
      ? PLAYER_STAT_FIELDS
      : typeof getEditableStatFields === "function"
        ? getEditableStatFields(playerId) ?? []
        : []
  );
  const getDerivedScore = (sideName) => getMergedResultScore(match, draft.playerStats, sideName, 0);
  const getDerivedDraft = () => buildMatchResultSubmission(match, draft, getEditableFieldsForPlayer, { editableScoreSides });
  const canSaveDraft = (
    canReview ||
    editableScoreSides.length > 0 ||
    sideNames
      .flatMap((sideName) => getMatchSideRecordPlayerIds(match, sideName))
      .some((playerId) => getEditableFieldsForPlayer(playerId).length > 0)
  );

  const updateTeamScore = (sideName, value) => {
    const scoreKey = sideName === "teamA" ? "scoreA" : "scoreB";
    setDraft((current) => ({
      ...current,
      [scoreKey]: getNonNegativeNumber(value),
    }));
  };

  const updatePlayerStat = (playerId, fieldId, value) => {
    setDraft((current) => ({
      ...current,
      playerStats: {
        ...current.playerStats,
        [playerId]: {
          ...(current.playerStats[playerId] ?? {}),
          [fieldId]: getNonNegativeNumber(value),
        },
      },
    }));
  };
  return (
    <form className="arena-dispute-editor" onSubmit={(event) => {
      event.preventDefault();
      onSave(getDerivedDraft());
    }}>
      <div className="arena-dispute-score-row">
        <label>
          {match.teamA?.name ?? "A"}
          <input
            className="arena-derived-score"
            type="number"
            min="0"
            max="999"
            disabled={!editableScoreSides.includes("teamA")}
            value={editableScoreSides.includes("teamA") ? draft.scoreA : getDerivedScore("teamA")}
            onChange={(event) => updateTeamScore("teamA", event.target.value)}
          />
          <small>개인 PTS 합계 {getDerivedScore("teamA")}</small>
        </label>
        <strong>:</strong>
        <label>
          {match.teamB?.name ?? "B"}
          <input
            className="arena-derived-score"
            type="number"
            min="0"
            max="999"
            disabled={!editableScoreSides.includes("teamB")}
            value={editableScoreSides.includes("teamB") ? draft.scoreB : getDerivedScore("teamB")}
            onChange={(event) => updateTeamScore("teamB", event.target.value)}
          />
          <small>개인 PTS 합계 {getDerivedScore("teamB")}</small>
        </label>
      </div>
      <div className="arena-dispute-stat-grid">
        {MATCH_SIDES.map((sideName) => (
          <div className="arena-dispute-side" key={sideName}>
            <strong>{match[sideName]?.name ?? SIDE_LABELS[sideName]}</strong>
            {getMatchSideRecordPlayerIds(match, sideName).map((playerId, index) => {
              const playerStats = draft.playerStats[playerId] ?? {};
              const editableFieldIds = new Set(getEditableFieldsForPlayer(playerId).map((field) => field.id));
              return (
                <div className="arena-dispute-player" key={playerId}>
                  <span>{getSourceMatchPlayerName(match, userById, sideName, playerId, index, "선수")}</span>
                  <div>
                    {PLAYER_STAT_FIELDS.map((field) => (
                      <label key={field.id}>
                        {field.shortLabel}
                        <NumericStepper
                          className="arena-stat-stepper"
                          disabled={!editableFieldIds.has(field.id)}
                          integer={false}
                          label={`${getSourceMatchPlayerName(match, userById, sideName, playerId, index, "선수")} ${field.label}`}
                          max={Number.MAX_SAFE_INTEGER}
                          value={Number(playerStats[field.id] ?? 0)}
                          onChange={(value) => updatePlayerStat(playerId, field.id, value)}
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
      </div>
      <p className="muted">{hasResult ? "확정 후 불복은 신고로 처리합니다." : "결과 저장 후 양쪽 승인 단계로 넘어갑니다."}</p>
    </form>
  );
}

export function SourceMatchDisputeReviewPanel({
  match,
  userById,
  canResolve,
  actions,
  onRefresh,
  refreshing,
}) {
  return (
    <SourceMatchDisputeControls
      match={match}
      userById={userById}
      canResolve={canResolve}
      onResolve={(disputeId, decision, resolutionReason) => actions.resolveMatchDispute(match.id, disputeId, decision, resolutionReason)}
      onVoid={(reason) => actions.voidMatch(match.id, reason)}
      onRefresh={onRefresh}
      refreshing={refreshing}
    />
  );
}

export function SourceMatchDisputeControls({
  match,
  userById,
  canResolve,
  onResolve,
  onVoid,
  onRefresh,
  refreshing = false,
}) {
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidPending, setVoidPending] = useState(false);
  if (!match || match.status !== "disputed") return null;

  return (
    <div className="arena-dispute-controls">
      <MatchDisputeQueue
        match={match}
        userById={userById}
        canResolve={canResolve}
        onResolve={onResolve}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
      {canResolve ? (
        <Button type="button" variant="secondary" className="danger-button" onClick={() => setVoidDialogOpen(true)}>경기 무효 처리</Button>
      ) : null}
      <MatchVoidDialog
        open={voidDialogOpen}
        pending={voidPending}
        onClose={() => setVoidDialogOpen(false)}
        onConfirm={async (reason) => {
          setVoidPending(true);
          try {
            const result = await onVoid?.(reason);
            if (result?.ok !== false) setVoidDialogOpen(false);
          } finally {
            setVoidPending(false);
          }
        }}
      />
    </div>
  );
}
