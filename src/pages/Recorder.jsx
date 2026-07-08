import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ClipboardList, Minus, Plus, RotateCcw, Save, ShieldCheck, Square } from "lucide-react";
import ApprovalPanel from "../components/match/ApprovalPanel.jsx";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import { PLAYER_STAT_FIELDS, SIDE_LABEL_TEXT as sideLabels } from "../lib/constants.js";
import { getUserHashtag } from "../lib/handles.js";
import {
  MATCH_DISPUTE_REASON_OPTIONS,
  OTHER_MATCH_DISPUTE_REASON,
  buildMatchDisputeRequest,
  canOperatorSubmitMissingPostgameResult,
  getAllowedStatFields,
  getMatchHostPlayerId,
  getMatchPlayerDisputePoints,
  getMatchReservePlayerIds,
  getMatchPlayerIds,
  getMatchRecordPlayerIds,
  getMatchRecordWindow,
  getMatchRoomPhase,
  getMatchSideRecordPlayerIds,
  getMatchTrustFeedbackParticipantIds,
  getPlayerSideName,
  getStatRecorderSides,
  isEligibleReferee,
  isMatchReferee,
} from "../lib/matchUtils.js";
import { MatchRoomModal } from "./Matches.jsx";

const statusMeta = {
  agreed: { label: "진행", tone: "blue" },
  approval: { label: "승인", tone: "orange" },
  disputed: { label: "이의", tone: "orange" },
  confirmed: { label: "확정", tone: "gold" },
};

const activeStatuses = new Set(["agreed", "approval", "disputed"]);
const activeProgressPhases = new Set(["live", "postgame", "dispute"]);

function getPlayerSearchHashtag(user = {}) {
  return getUserHashtag(user);
}

function includesPlayerQuery(user = {}, query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [user.name, getPlayerSearchHashtag(user), user.position, user.region, user.club]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function makeInitialStats(match) {
  const sourceResult = match.disputeDraftResult ?? match.result;
  return Object.fromEntries(
    getMatchRecordPlayerIds(match).map((playerId) => [
      playerId,
      Object.fromEntries(
        PLAYER_STAT_FIELDS.map((field) => [field.id, Number(sourceResult?.playerStats?.[playerId]?.[field.id] ?? 0)]),
      ),
    ]),
  );
}

function getExistingScore(match, sideName) {
  const sourceResult = match.disputeDraftResult ?? match.result;
  const scoreKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return Number(sourceResult?.[scoreKey] ?? match[sideName]?.score ?? 0);
}

function sumSidePoints(match, stats, sideName, includeReserves = false) {
  return getMatchSideRecordPlayerIds(match, sideName, includeReserves).reduce((sum, playerId) => sum + Number(stats[playerId]?.points ?? 0), 0);
}

function hasSideStats(match, sideName, includeReserves = false) {
  const sourceResult = match.disputeDraftResult ?? match.result;
  return getMatchSideRecordPlayerIds(match, sideName, includeReserves).some((playerId) => sourceResult?.playerStats?.[playerId]);
}

function getSideScore(match, stats, sideName, editablePlayerIds, includeReserves = false) {
  const hasEditablePlayer = getMatchSideRecordPlayerIds(match, sideName, includeReserves).some((playerId) => editablePlayerIds.includes(playerId));
  if (hasEditablePlayer || hasSideStats(match, sideName, includeReserves)) return sumSidePoints(match, stats, sideName, includeReserves);
  return getExistingScore(match, sideName);
}

function formatSchedule(match) {
  return [match.scheduledDate, match.scheduledTime, match.court].filter(Boolean).join(" · ");
}

function getRoleText(match, user, recorderSides) {
  if (isMatchReferee(match, user.id)) return "심판";
  if (recorderSides.length) return `${recorderSides.map((sideName) => sideLabels[sideName]).join(", ")} 기록자`;
  const playerSide = getPlayerSideName(match, user.id);
  if (playerSide) return `${sideLabels[playerSide]} 선수`;
  const reserveSide = ["teamA", "teamB"].find((sideName) => getMatchReservePlayerIds(match, sideName).includes(user.id));
  if (reserveSide) return `${sideLabels[reserveSide]} 후보`;
  return "경기 관계자";
}

function getRecorderAllowedFields(match, state, userId, playerId, allowPostgameScore = false) {
  const fields = getAllowedStatFields(match, userId, playerId);
  if (!allowPostgameScore) return fields;
  const fieldById = Object.fromEntries(fields.map((field) => [field.id, field]));
  const pointsField = PLAYER_STAT_FIELDS.find((field) => field.id === "points");
  if (pointsField) fieldById.points = pointsField;
  return Object.values(fieldById);
}

function isAnonymousDisplayUser(user = null) {
  return Boolean(user?.anonymous || user?.participationLabel === "개인참여");
}

function getAvatarInitial(user = null, fallback = "P") {
  return isAnonymousDisplayUser(user) ? "?" : (user?.name?.slice(0, 1) ?? fallback);
}

function getPlayerMetaLabel(user = null, rosterLabel = "") {
  const position = user?.position ?? "-";
  const participation = user?.participationLabel ? ` · ${user.participationLabel}` : "";
  const roster = rosterLabel ? ` · ${rosterLabel}` : "";
  return `${position}${participation}${roster} · 신뢰 ${user?.trustScore ?? "-"}`;
}

function canAccessActiveMatch(match, user, state) {
  if (!activeStatuses.has(match.status)) return false;
  if (!activeProgressPhases.has(getMatchRoomPhase(match).phase)) return false;
  const sourcePost = match?.recruitingPostId
    ? state.recruitingPosts?.find((post) => post.id === match.recruitingPostId)
    : null;
  const isHost = getMatchHostPlayerId(match, sourcePost) === user.id;
  const isReferee = isMatchReferee(match, user.id) && isEligibleReferee(user, match.refereeTrustMin, state.settings?.refereeAppointments);
  const isRecorder = !match.refereeId && getStatRecorderSides(match, user.id).length > 0;
  const isPlayer = getMatchPlayerIds(match).includes(user.id);
  const isReserve = ["teamA", "teamB"].some((sideName) => getMatchReservePlayerIds(match, sideName).includes(user.id));
  return isHost || isReferee || isRecorder || isPlayer || isReserve;
}

export default function Recorder({ app }) {
  const user = app.currentUser;
  const [searchParams, setSearchParams] = useSearchParams();
  const queryMatchId = searchParams.get("match") ?? "";
  const userMap = useMemo(() => {
    const anonymousUsers = app.state.matches.flatMap((match) => Object.values(match.anonymousPlayers ?? {}));
    return Object.fromEntries([...app.state.users, ...anonymousUsers].map((item) => [item.id, item]));
  }, [app.state.matches, app.state.users]);
  const matches = useMemo(
    () =>
      app.state.matches
        .filter((match) => canAccessActiveMatch(match, user, app.state))
        .sort((a, b) => String(a.scheduledAt ?? a.createdAt ?? "").localeCompare(String(b.scheduledAt ?? b.createdAt ?? ""))),
    [app.state.matches, app.state.settings?.refereeAppointments, user],
  );
  const [selectedMatchId, setSelectedMatchId] = useState(queryMatchId);
  const selectedMatch = matches.find((match) => match.id === queryMatchId)
    ?? matches.find((match) => match.id === selectedMatchId)
    ?? matches[0]
    ?? null;
  const selectedMatchPlayerKey = selectedMatch ? getMatchRecordPlayerIds(selectedMatch).join("|") : "";
  const [stats, setStats] = useState({});
  const [dirtyStats, setDirtyStats] = useState({});
  const [handoffDraft, setHandoffDraft] = useState({});
  const [substitutionDraft, setSubstitutionDraft] = useState({});
  const [latePlayerDraft, setLatePlayerDraft] = useState({ sideName: "teamA", userId: "", playerQuery: "", name: "" });
  const [disputeReason, setDisputeReason] = useState(MATCH_DISPUTE_REASON_OPTIONS[0]);
  const [disputeCustomReason, setDisputeCustomReason] = useState("");
  const [disputeRequestedPoints, setDisputeRequestedPoints] = useState("");
  const [recorderLoading, setRecorderLoading] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState("");
  const [refreshingMatchDetail, setRefreshingMatchDetail] = useState(false);
  const [selectedRoomMatchId, setSelectedRoomMatchId] = useState("");
  const recorderLoadRef = useRef("");
  const selectedDetailLoadRef = useRef("");

  useEffect(() => {
    if (!app.remoteReady || !user.id || matches.length || app.recorderMatchesLoaded) return;
    const loadRecorderMatches = app.actions.loadRecorderMatches;
    if (!loadRecorderMatches) return;
    if (recorderLoadRef.current === user.id) return;
    recorderLoadRef.current = user.id;
    setRecorderLoading(true);
    Promise.resolve(loadRecorderMatches()).finally(() => {
      setRecorderLoading(false);
    });
  }, [app.actions.loadRecorderMatches, app.recorderMatchesLoaded, app.remoteReady, matches.length, user.id]);

  useEffect(() => {
    if (!selectedMatch || selectedMatchId === selectedMatch.id) return;
    setSelectedMatchId(selectedMatch.id);
  }, [selectedMatch, selectedMatchId]);

  useEffect(() => {
    if (!app.remoteReady || !selectedMatch?.id) return;
    const loadMatchDetail = app.actions.loadMatchDetail;
    if (!loadMatchDetail) return;
    const detailKey = `${user.id}:${selectedMatch.id}`;
    if (selectedDetailLoadRef.current === detailKey) return;
    selectedDetailLoadRef.current = detailKey;
    setRefreshingMatchDetail(true);
    Promise.resolve(loadMatchDetail(selectedMatch.id))
      .catch(() => {
        if (selectedDetailLoadRef.current === detailKey) setSaveFeedback("최신 경기 정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (selectedDetailLoadRef.current === detailKey) setRefreshingMatchDetail(false);
      });
  }, [app.actions.loadMatchDetail, app.remoteReady, selectedMatch?.id, user.id]);

  const selectMatch = (matchId) => {
    setSelectedMatchId(matchId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("match", matchId);
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    if (selectedMatch) {
      setStats(makeInitialStats(selectedMatch));
      setDirtyStats({});
      setHandoffDraft({});
      setSubstitutionDraft({});
      setLatePlayerDraft((current) => ({ ...current, userId: "", playerQuery: "", name: "" }));
      setDisputeReason(MATCH_DISPUTE_REASON_OPTIONS[0]);
      setDisputeCustomReason("");
      setDisputeRequestedPoints(String(getMatchPlayerDisputePoints(selectedMatch, user.id)));
      setSaveFeedback("");
    }
  }, [selectedMatch?.id, selectedMatch?.result?.updatedAt, selectedMatch?.result?.submittedAt, selectedMatch?.disputeDraftResult?.updatedAt, selectedMatchPlayerKey, user.id]);

  const recordWindow = selectedMatch ? getMatchRecordWindow(selectedMatch) : null;
  const roomPhase = selectedMatch ? getMatchRoomPhase(selectedMatch).phase : "";
  const selectedMatchSourcePost = selectedMatch?.recruitingPostId
    ? app.state.recruitingPosts?.find((post) => post.id === selectedMatch.recruitingPostId)
    : null;
  const hostPlayerId = selectedMatch ? getMatchHostPlayerId(selectedMatch, selectedMatchSourcePost) : "";
  const currentUserIsHost = Boolean(hostPlayerId && hostPlayerId === user.id);
  const selectedMatchHasReferee = Boolean(selectedMatch?.refereeId);
  const currentUserIsEligibleReferee = Boolean(selectedMatch && isMatchReferee(selectedMatch, user.id) && isEligibleReferee(user, selectedMatch.refereeTrustMin, app.state.settings?.refereeAppointments));
  const currentUserCanOperatePostStart = Boolean(selectedMatch && (selectedMatchHasReferee ? currentUserIsEligibleReferee : currentUserIsHost));
  const currentUserCanFileDispute = Boolean(selectedMatch && (currentUserCanOperatePostStart || getMatchTrustFeedbackParticipantIds(selectedMatch).includes(user.id)));
  const currentUserCanPostgameScore = Boolean(currentUserCanOperatePostStart && roomPhase === "postgame" && !["confirmed", "disputed"].includes(selectedMatch.status));
  const currentUserCanSubmitMissingPostgameResult = canOperatorSubmitMissingPostgameResult(selectedMatch, currentUserCanOperatePostStart);
  const postStartOperatorLabel = selectedMatchHasReferee ? "심판" : "방장";
  const recorderSides = selectedMatch ? getStatRecorderSides(selectedMatch, user.id) : [];
  const canEditDisputeDraft = Boolean(selectedMatch?.status === "disputed" && currentUserCanOperatePostStart && recordWindow?.disputeOpen);
  const editablePlayerIds = selectedMatch
    ? getMatchRecordPlayerIds(selectedMatch).filter((playerId) => (
        canEditDisputeDraft || getRecorderAllowedFields(selectedMatch, app.state, user.id, playerId, currentUserCanPostgameScore).length > 0
      ))
    : [];
  const beforeStart = Boolean(recordWindow?.beforeStart);
  const saveWindowOpen = selectedMatch && !beforeStart && (recordWindow?.beforeEnd || recordWindow?.statOpen || canEditDisputeDraft || currentUserCanSubmitMissingPostgameResult);
  const hasDirtyStats = Object.keys(dirtyStats).length > 0;
  const canEditStats = Boolean(selectedMatch && !refreshingMatchDetail && !["confirmed"].includes(selectedMatch.status) && (canEditDisputeDraft || selectedMatch.status !== "disputed") && editablePlayerIds.length && saveWindowOpen);
  const canSave = Boolean(selectedMatch && !refreshingMatchDetail && !["confirmed"].includes(selectedMatch.status) && (canEditDisputeDraft || selectedMatch.status !== "disputed") && editablePlayerIds.length && saveWindowOpen && hasDirtyStats);
  const canEndLiveMatch = Boolean(selectedMatch && currentUserCanOperatePostStart && roomPhase === "live" && !selectedMatch.endedAt);
  const canEditPostgameRoster = Boolean(selectedMatch && currentUserCanOperatePostStart && roomPhase === "postgame" && (recordWindow?.statOpen || currentUserCanSubmitMissingPostgameResult) && !selectedMatch.result);
  const scoreA = selectedMatch ? getSideScore(selectedMatch, stats, "teamA", editablePlayerIds) : 0;
  const scoreB = selectedMatch ? getSideScore(selectedMatch, stats, "teamB", editablePlayerIds) : 0;
  const latePlayerOptions = useMemo(() => {
    if (!selectedMatch) return [];
    const activeIds = new Set(getMatchPlayerIds(selectedMatch));
    return app.state.users
      .filter((item) => !activeIds.has(item.id))
      .filter((item) => includesPlayerQuery(item, latePlayerDraft.playerQuery))
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko"));
  }, [app.state.users, latePlayerDraft.playerQuery, selectedMatch]);
  const saveLockedReason = beforeStart
    ? "경기 시작 전"
    : selectedMatch?.status === "confirmed"
      ? "결과 확정"
    : selectedMatch?.status === "disputed"
      ? "이의 확인 중"
    : currentUserCanSubmitMissingPostgameResult
      ? "결과 입력 필요"
    : recordWindow?.statExpired
      ? "기록 마감"
      : !editablePlayerIds.length
        ? "기록 권한 없음"
        : "저장 가능";
  const canDispute = Boolean(selectedMatch?.result) && selectedMatch?.status === "approval" && recordWindow?.disputeOpen && currentUserCanFileDispute;
  const canRequestOwnPointDispute = Boolean(canDispute && getMatchRecordPlayerIds(selectedMatch).includes(user.id));
  const currentUserDisputePoints = selectedMatch ? getMatchPlayerDisputePoints(selectedMatch, user.id) : 0;
  const canResumeApproval = selectedMatch?.status === "disputed" && currentUserCanOperatePostStart;
  const canVoid = selectedMatch?.status === "disputed" && currentUserCanOperatePostStart;

  const updateStat = (playerId, fieldId, delta) => {
    setStats((current) => {
      const currentPlayer = current[playerId] ?? {};
      const nextValue = Math.max(0, Number(currentPlayer[fieldId] ?? 0) + delta);
      setDirtyStats((dirtyCurrent) => ({
        ...dirtyCurrent,
        [playerId]: {
          ...(dirtyCurrent[playerId] ?? {}),
          [fieldId]: nextValue,
        },
      }));

      return {
        ...current,
        [playerId]: {
          ...currentPlayer,
          [fieldId]: nextValue,
        },
      };
    });
  };

  const saveStats = () => {
    if (!selectedMatch || !canSave) return;
    setSaveFeedback(canEditDisputeDraft ? "수정 중" : "저장 중");
    const result = app.actions.submitMatchResult(selectedMatch.id, {
      scoreA,
      scoreB,
      playerStats: canEditDisputeDraft ? stats : dirtyStats,
    });
    setDirtyStats({});
    Promise.resolve(result).then((response) => {
      setSaveFeedback(response?.ok === false ? "저장 실패" : canEditDisputeDraft ? "수정되었습니다." : "저장되었습니다.");
    }).catch(() => setSaveFeedback("저장 실패"));
  };

  const submitDispute = () => {
    if (!selectedMatch || !canRequestOwnPointDispute) return;
    app.actions.disputeMatch(selectedMatch.id, buildMatchDisputeRequest({
      match: selectedMatch,
      playerId: user.id,
      playerName: user.name,
      requestedPoints: disputeRequestedPoints,
      reason: disputeReason,
      customReason: disputeCustomReason,
    }));
  };

  const refreshSelectedMatch = () => {
    if (!selectedMatch || refreshingMatchDetail) return;
    const loadMatchDetail = app.actions.loadMatchDetail;
    if (!loadMatchDetail) return;
    setRefreshingMatchDetail(true);
    Promise.resolve(loadMatchDetail(selectedMatch.id)).then((count) => {
      setSaveFeedback(count ? "새로고침되었습니다." : "최신 경기 정보를 불러오지 못했습니다.");
    }).catch(() => setSaveFeedback("새로고침 실패"))
      .finally(() => setRefreshingMatchDetail(false));
  };

  const addLatePlayer = (anonymous = false) => {
    if (!selectedMatch || !canEditPostgameRoster) return;
    app.actions.addMatchLatePlayer(selectedMatch.id, {
      sideName: latePlayerDraft.sideName,
      userId: anonymous ? "" : latePlayerDraft.userId,
      name: anonymous ? latePlayerDraft.name : "",
    });
    setLatePlayerDraft((current) => ({ ...current, userId: "", playerQuery: "", name: "" }));
  };

  const selectLatePlayer = (player) => {
    setLatePlayerDraft((current) => ({
      ...current,
      userId: player.id,
      playerQuery: player.name ?? "",
    }));
  };

  const handoffRecorder = (sideName) => {
    const nextRecorderId = handoffDraft[sideName];
    if (!selectedMatch || !nextRecorderId) return;
    if (canSave) saveStats();
    app.actions.handoffMatchRecorder(selectedMatch.id, sideName, nextRecorderId);
    setHandoffDraft((current) => ({ ...current, [sideName]: "" }));
  };

  const canSubstituteSide = (sideName) => Boolean(
    selectedMatch &&
    selectedMatch.status === "agreed" &&
    roomPhase === "live" &&
    !selectedMatch.endedAt &&
    recordWindow?.beforeEnd &&
    (currentUserCanOperatePostStart || recorderSides.includes(sideName))
  );

  const substitutePlayer = (sideName, reservePlayerId) => {
    const activePlayerIds = selectedMatch?.[sideName]?.players ?? [];
    const activePlayerId = substitutionDraft[`${sideName}:${reservePlayerId}`] ?? activePlayerIds[0] ?? "";
    if (!selectedMatch || !activePlayerId || !reservePlayerId) return;
    if (canSave) saveStats();
    app.actions.substituteMatchPlayer?.(selectedMatch.id, sideName, activePlayerId, reservePlayerId);
  };

  const renderSubstitutionPanel = () => {
    const sides = ["teamA", "teamB"].filter((sideName) => (
      canSubstituteSide(sideName) &&
      (selectedMatch[sideName]?.players ?? []).length &&
      getMatchReservePlayerIds(selectedMatch, sideName).length
    ));
    if (!sides.length) return null;
    return (
      <div className="recorder-handoff-panel">
        <div>
          <span className="eyebrow">SUBSTITUTION</span>
          <strong>선수 교체</strong>
          <p>경기 중 후보를 출전으로 올리고, 기존 출전 선수는 후보로 내립니다.</p>
        </div>
        <div className="recorder-handoff-list">
          {sides.flatMap((sideName) => {
            const activePlayerIds = selectedMatch[sideName]?.players ?? [];
            return getMatchReservePlayerIds(selectedMatch, sideName).map((reservePlayerId) => {
              const draftKey = `${sideName}:${reservePlayerId}`;
              const reserveUser = userMap[reservePlayerId];
              return (
                <div className="recorder-handoff-row" key={draftKey}>
                  <label>
                    {sideLabels[sideName]} {reserveUser?.name ?? "후보"}
                    <select
                      value={substitutionDraft[draftKey] ?? activePlayerIds[0] ?? ""}
                      onChange={(event) => setSubstitutionDraft((current) => ({ ...current, [draftKey]: event.target.value }))}
                    >
                      {activePlayerIds.map((playerId) => (
                        <option value={playerId} key={playerId}>{userMap[playerId]?.name ?? playerId}</option>
                      ))}
                    </select>
                  </label>
                  <Button type="button" variant="secondary" onClick={() => substitutePlayer(sideName, reservePlayerId)}>
                    <RotateCcw size={16} />
                    교체
                  </Button>
                </div>
              );
            });
          })}
        </div>
      </div>
    );
  };

  const renderSide = (sideName) => {
    const side = selectedMatch[sideName];
    const activePlayerIds = side.players ?? [];
    const reservePlayerIds = getMatchReservePlayerIds(selectedMatch, sideName);
    const statPlayerIds = getMatchSideRecordPlayerIds(selectedMatch, sideName);

    return (
      <section className="recorder-side" key={sideName}>
        <header>
          <span>{sideLabels[sideName]}</span>
          <strong>{side.name}</strong>
          <em>{sumSidePoints(selectedMatch, stats, sideName)} 득점</em>
        </header>
        <div className="recorder-player-list">
          {statPlayerIds.map((playerId) => {
            const player = userMap[playerId];
            const allowedFields = new Set(
              (canEditDisputeDraft ? PLAYER_STAT_FIELDS : getRecorderAllowedFields(selectedMatch, app.state, user.id, playerId, currentUserCanPostgameScore))
                .map((field) => field.id),
            );
            const rosterLabel = activePlayerIds.includes(playerId)
              ? "출전 중"
              : reservePlayerIds.includes(playerId)
                ? "후보"
                : "교체 출전";

            return (
              <article className="recorder-player-row" key={playerId}>
                <PlayerHoverCard as="span" user={player} teams={app.state.teams} className="recorder-player-main">
                  <span className={["avatar", "small", isAnonymousDisplayUser(player) ? "anonymous" : ""].filter(Boolean).join(" ")} style={{ "--avatar": player?.avatarColor }}>{getAvatarInitial(player)}</span>
                  <span>
                    <strong>{player?.name ?? "선수"}</strong>
                    <em>{getPlayerMetaLabel(player, rosterLabel)}</em>
                  </span>
                </PlayerHoverCard>
                <div className="recorder-stat-grid">
                  {PLAYER_STAT_FIELDS.map((field) => {
                    const value = Number(stats[playerId]?.[field.id] ?? 0);
                    const editable = canEditStats && allowedFields.has(field.id);

                    return (
                      <div className={editable ? "recorder-stat-stepper editable" : "recorder-stat-stepper"} key={field.id}>
                        <span>{field.shortLabel}</span>
                        <button type="button" onClick={() => updateStat(playerId, field.id, -1)} disabled={!editable} aria-label={`${field.label} 감소`}>
                          <Minus size={14} />
                        </button>
                        <strong>{value}</strong>
                        <button type="button" onClick={() => updateStat(playerId, field.id, 1)} disabled={!editable} aria-label={`${field.label} 증가`}>
                          <Plus size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  };

  const recorderPending = !matches.length && !app.recorderMatchesLoaded;

  if (!matches.length) {
    return (
      <div className="page-stack recorder-page">
        <header className="page-header recorder-header">
          <div>
            <span className="eyebrow">ACTIVE MATCHES</span>
            <h1>진행 경기</h1>
            <p>기록 입력, 이의제기, 결과 승인이 필요한 내 경기만 표시됩니다.</p>
          </div>
        </header>
        <Card className="recorder-empty">
          {recorderPending || recorderLoading ? (
            <BasketballLoader overlay label="진행 경기 확인 중" />
          ) : (
            <>
              <ShieldCheck size={34} />
              <strong>처리할 진행 경기 없음</strong>
              <p>경기가 확정 완료되면 이 메뉴에서 자동으로 사라집니다.</p>
            </>
          )}
          <Link to="/app/matches" className="button button-secondary button-md">경기 보기</Link>
        </Card>
      </div>
    );
  }

  const status = statusMeta[selectedMatch.status] ?? { label: selectedMatch.status, tone: "blue" };

  return (
    <>
    <div className="page-stack recorder-page">
      <header className="page-header recorder-header">
        <div>
          <span className="eyebrow">ACTIVE MATCHES</span>
          <h1>진행 경기</h1>
          <p>활성 경기만 모아 기록 입력, 이의제기, 결과 승인을 한 화면에서 처리합니다.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setSelectedRoomMatchId(selectedMatch.id)}>방 보기</Button>
      </header>

      <div className="recorder-layout">
        <Card className="recorder-match-list">
          <div className="section-title-row">
            <div>
              <span className="eyebrow">ACTIVE</span>
              <h2>내 진행 경기</h2>
            </div>
            <Badge tone="blue">{matches.length}개</Badge>
          </div>
          <div className="recorder-match-options">
            {matches.map((match) => {
              const sides = getStatRecorderSides(match, user.id);
              const active = match.id === selectedMatch.id;

              return (
                <button
                  type="button"
                  className={active ? "recorder-match-option active" : "recorder-match-option"}
                  key={match.id}
                  onClick={() => selectMatch(match.id)}
                >
                  <span>
                    <Badge tone={statusMeta[match.status]?.tone ?? "blue"}>{statusMeta[match.status]?.label ?? match.status}</Badge>
                    <em>{getRoleText(match, user, sides)}</em>
                  </span>
                  <strong>{match.teamA?.name ?? "A"} vs {match.teamB?.name ?? "B"}</strong>
                  <small>{formatSchedule(match)}</small>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="recorder-workspace">
          {refreshingMatchDetail ? <BasketballLoader overlay label="경기 기록 확인 중" /> : null}
          <Card className="recorder-board">
            <div className="recorder-board-head">
              <div>
                <Badge tone={status.tone}>{status.label}</Badge>
                <h2>{selectedMatch.title}</h2>
                <p>{formatSchedule(selectedMatch)}</p>
              </div>
              <div className="recorder-live-state">
                <ClipboardList size={18} />
                <strong>{getRoleText(selectedMatch, user, recorderSides)}</strong>
                <span>{saveLockedReason}</span>
              </div>
            </div>

            <div className="recorder-scoreboard">
              <span>
                <strong>{selectedMatch.teamA?.name ?? "A"}</strong>
                <em>{scoreA}</em>
              </span>
              <b>:</b>
              <span>
                <strong>{selectedMatch.teamB?.name ?? "B"}</strong>
                <em>{scoreB}</em>
              </span>
            </div>

            {canEndLiveMatch ? (
              <div className="recorder-host-action-row">
                <p>{postStartOperatorLabel}이 경기 종료를 누르면 경기종료방으로 넘어가고 결과 입력이 열린다.</p>
                <Button type="button" variant="secondary" onClick={() => app.actions.endMatch(selectedMatch.id)}>
                  <Square size={16} />
                  경기 종료
                </Button>
              </div>
            ) : null}

            <div className="recorder-sides two">
              {["teamA", "teamB"].map(renderSide)}
            </div>

            {renderSubstitutionPanel()}

            {canEditPostgameRoster ? (
              <div className="recorder-late-player-panel">
                <div>
                  <span className="eyebrow">POSTGAME ROSTER</span>
                  <strong>경기 후 인원 수정</strong>
                  <p>현장에서 추가로 뛴 사람만 기록 대상에 넣는다. 추가자는 MMR에 반영되지 않는다.</p>
                </div>
                <div className="recorder-late-player-form">
                  <label>
                    사이드
                    <select
                      value={latePlayerDraft.sideName}
                      onChange={(event) => setLatePlayerDraft((current) => ({ ...current, sideName: event.target.value }))}
                    >
                      <option value="teamA">{sideLabels.teamA}</option>
                      <option value="teamB">{sideLabels.teamB}</option>
                    </select>
                  </label>
                  <label>
                    등록 선수
                    <SearchPicker
                      value={latePlayerDraft.playerQuery}
                      onChange={(value) => setLatePlayerDraft((current) => ({ ...current, userId: "", playerQuery: value }))}
                      placeholder="선수 이름, #해시태그, 포지션 검색"
                      items={latePlayerOptions}
                      remoteSearchType="profile"
                      idleItems={latePlayerOptions.slice(0, 10)}
                      idleTitle="추가 가능한 선수"
                      title="선수 검색 결과"
                      showIdleOnFocus
                      floating
                      closeOnResultClick
                      renderItem={(item) => (
                        <button
                          type="button"
                          key={item.id}
                          className={item.id === latePlayerDraft.userId ? "search-picker-result-row selected" : "search-picker-result-row"}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectLatePlayer(item)}
                        >
                          <span>
                            <strong>{item.name}</strong>
                            <em>{getPlayerSearchHashtag(item)} · {item.position} · {item.region}</em>
                          </span>
                          <small>{item.ratings?.integrated ?? "-"} MMR</small>
                        </button>
                      )}
                    />
                  </label>
                  <Button type="button" variant="secondary" disabled={!latePlayerDraft.userId} onClick={() => addLatePlayer(false)}>
                    등록 선수 추가
                  </Button>
                  <label>
                    무기명
                    <input
                      value={latePlayerDraft.name}
                      onChange={(event) => setLatePlayerDraft((current) => ({ ...current, name: event.target.value }))}
                      placeholder="현장 선수 이름"
                    />
                  </label>
                  <Button type="button" variant="secondary" disabled={!latePlayerDraft.name.trim()} onClick={() => addLatePlayer(true)}>
                    무기명 추가
                  </Button>
                </div>
                <div className="recorder-late-player-list">
                  {(selectedMatch.mmrExcludedPlayerIds ?? selectedMatch.rules?.mmrExcludedPlayerIds ?? []).map((playerId) => {
                    const latePlayer = userMap[playerId];
                    const sideName = getPlayerSideName(selectedMatch, playerId);
                    return (
                      <span key={playerId}>
                        {latePlayer?.name ?? "추가 선수"} · {sideLabels[sideName] ?? "기록"}
                        <button type="button" onClick={() => app.actions.removeMatchLatePlayer(selectedMatch.id, playerId)}>제거</button>
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {recorderSides.length && !selectedMatch.refereeId ? (
              <div className="recorder-handoff-panel">
                <div>
                  <span className="eyebrow">HANDOFF</span>
                  <strong>기록자 인수인계</strong>
                  <p>출전 선수를 고르면 그 선수가 후보 기록자가 되고 현재 기록자가 출전한다. 후보를 고르면 기록 권한만 넘긴다.</p>
                </div>
                <div className="recorder-handoff-list">
                  {recorderSides.map((sideName) => {
                    const activeCandidates = (selectedMatch[sideName]?.players ?? [])
                      .filter((playerId) => playerId !== user.id)
                      .map((playerId) => ({ user: userMap[playerId], role: "출전 중" }))
                      .filter((item) => item.user);
                    const reserveCandidates = getMatchReservePlayerIds(selectedMatch, sideName)
                      .filter((playerId) => playerId !== user.id)
                      .map((playerId) => ({ user: userMap[playerId], role: "후보" }))
                      .filter((item) => item.user);
                    const candidates = [...activeCandidates, ...reserveCandidates];
                    return (
                      <div className="recorder-handoff-row" key={sideName}>
                        <label>
                          {sideLabels[sideName]}
                          <select
                            value={handoffDraft[sideName] ?? ""}
                            onChange={(event) => setHandoffDraft((current) => ({ ...current, [sideName]: event.target.value }))}
                          >
                            <option value="">인수인계 대상 선택</option>
                            {candidates.map((candidate) => (
                              <option value={candidate.user.id} key={candidate.user.id}>{candidate.user.name} · {candidate.role} · {candidate.user.position}</option>
                            ))}
                          </select>
                        </label>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!handoffDraft[sideName] || !candidates.length}
                          onClick={() => handoffRecorder(sideName)}
                        >
                          <RotateCcw size={16} />
                          넘기기
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="recorder-save-row">
              <p>{canEditDisputeDraft ? "저장하면 기존 결과는 유지하고 이의 수정안만 임시 저장합니다." : recordWindow?.beforeEnd ? "경기 중 저장은 상태를 진행으로 유지합니다. 경기 종료 후 저장하면 결과 승인 단계로 넘어갑니다." : "저장하면 결과 승인 단계로 넘어갑니다."}</p>
              <div className="match-action-row">
                <Button type="button" variant="secondary" onClick={refreshSelectedMatch} disabled={refreshingMatchDetail}>
                  <RotateCcw size={16} />
                  새로고침
                </Button>
                <Button onClick={saveStats} disabled={!canSave}>
                  <Save size={17} />
                  {canEditDisputeDraft ? "수정안 저장" : "저장"}
                </Button>
              </div>
            </div>
            {saveFeedback ? <p className="recorder-save-feedback">{saveFeedback}</p> : null}
          </Card>

          {selectedMatch.status === "approval" ? (
            <ApprovalPanel
              match={selectedMatch}
              teams={app.state.teams}
              users={app.state.users}
              currentUserId={user.id}
              onApprove={(sideName, playerId) => app.actions.approveMatch(selectedMatch.id, sideName, playerId)}
            />
          ) : null}

          {["approval", "disputed"].includes(selectedMatch.status) ? (
            <Card className="recorder-review-panel">
              <div className="section-title-row">
                <div>
                  <span className="eyebrow">REVIEW</span>
                  <h2>이의와 보류 처리</h2>
                </div>
                <Badge tone={canDispute || canResumeApproval || canVoid ? "orange" : "neutral"}>
                  {recordWindow?.disputeExpired ? "이의 마감" : "처리 가능"}
                </Badge>
              </div>
              {selectedMatch.disputes?.[0] ? <p className="muted">최근 이의제기: {selectedMatch.disputes[0].reason}</p> : null}
              <div className="dispute-score-request">
                <div>
                  <span>점수판</span>
                  <strong>{scoreA} : {scoreB}</strong>
                </div>
                <label>
                  내 득점
                  <input
                    type="number"
                    min="0"
                    disabled={!canRequestOwnPointDispute}
                    value={disputeRequestedPoints}
                    onChange={(event) => setDisputeRequestedPoints(event.target.value)}
                  />
                  <em>현재 {currentUserDisputePoints}점</em>
                </label>
              </div>
              <label className="memo-label">
                이의제기 사유
                <select disabled={!canRequestOwnPointDispute} value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)}>
                  {MATCH_DISPUTE_REASON_OPTIONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              {disputeReason === OTHER_MATCH_DISPUTE_REASON ? (
                <label className="memo-label">
                  기타 사유
                  <textarea disabled={!canRequestOwnPointDispute} value={disputeCustomReason} onChange={(event) => setDisputeCustomReason(event.target.value)} />
                </label>
              ) : null}
              <div className="match-action-row">
                <Button type="button" variant="secondary" disabled={!canRequestOwnPointDispute} onClick={submitDispute}>
                  <AlertTriangle size={16} />
                  이의제기
                </Button>
                <Button type="button" variant="secondary" disabled={!canResumeApproval} onClick={() => app.actions.resumeMatchApproval(selectedMatch.id)}>
                  {selectedMatch.disputeDraftResult ? "수정안 확정" : "결과 확정"}
                </Button>
                <Button type="button" variant="secondary" disabled={!canVoid} onClick={() => app.actions.voidMatch(selectedMatch.id)}>무효 처리</Button>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
    <MatchRoomModal app={app} matchId={selectedRoomMatchId} onClose={() => setSelectedRoomMatchId("")} />
    </>
  );
}
