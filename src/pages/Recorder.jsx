import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardList, Minus, Plus, RotateCcw, Save, ShieldCheck } from "lucide-react";
import ApprovalPanel from "../components/match/ApprovalPanel.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import {
  getAllowedStatFields,
  getMatchReservePlayerIds,
  getMatchPlayerIds,
  getMatchRecordWindow,
  getPlayerSideName,
  getStatRecorderSides,
  isEligibleReferee,
  isMatchReferee,
} from "../lib/matchUtils.js";

const sideLabels = {
  teamA: "A팀",
  teamB: "B팀",
};

const statusMeta = {
  agreed: { label: "진행", tone: "green" },
  approval: { label: "승인", tone: "orange" },
  disputed: { label: "이의", tone: "orange" },
};

const activeStatuses = new Set(["agreed", "approval", "disputed"]);

function makeInitialStats(match) {
  return Object.fromEntries(
    getMatchPlayerIds(match).map((playerId) => [
      playerId,
      Object.fromEntries(
        PLAYER_STAT_FIELDS.map((field) => [field.id, Number(match.result?.playerStats?.[playerId]?.[field.id] ?? 0)]),
      ),
    ]),
  );
}

function getMatchStartDate(match) {
  if (!match?.scheduledDate || !match?.scheduledTime) return null;
  const date = new Date(`${match.scheduledDate}T${match.scheduledTime}`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getExistingScore(match, sideName) {
  const scoreKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return Number(match.result?.[scoreKey] ?? match[sideName]?.score ?? 0);
}

function sumSidePoints(match, stats, sideName) {
  return (match[sideName]?.players ?? []).reduce((sum, playerId) => sum + Number(stats[playerId]?.points ?? 0), 0);
}

function hasSideStats(match, sideName) {
  return (match[sideName]?.players ?? []).some((playerId) => match.result?.playerStats?.[playerId]);
}

function getSideScore(match, stats, sideName, editablePlayerIds) {
  const hasEditablePlayer = (match[sideName]?.players ?? []).some((playerId) => editablePlayerIds.includes(playerId));
  if (hasEditablePlayer || hasSideStats(match, sideName)) return sumSidePoints(match, stats, sideName);
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

function canAccessActiveMatch(match, user) {
  if (!activeStatuses.has(match.status)) return false;
  const isReferee = isMatchReferee(match, user.id) && isEligibleReferee(user, match.refereeTrustMin);
  const isRecorder = !match.refereeId && getStatRecorderSides(match, user.id).length > 0;
  const isPlayer = getMatchPlayerIds(match).includes(user.id);
  const isReserve = ["teamA", "teamB"].some((sideName) => getMatchReservePlayerIds(match, sideName).includes(user.id));
  return isReferee || isRecorder || isPlayer || isReserve;
}

export default function Recorder({ app }) {
  const user = app.currentUser;
  const userMap = useMemo(() => Object.fromEntries(app.state.users.map((item) => [item.id, item])), [app.state.users]);
  const matches = useMemo(
    () =>
      app.state.matches
        .filter((match) => canAccessActiveMatch(match, user))
        .sort((a, b) => String(a.scheduledAt ?? a.createdAt ?? "").localeCompare(String(b.scheduledAt ?? b.createdAt ?? ""))),
    [app.state.matches, user],
  );
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? matches[0] ?? null;
  const [stats, setStats] = useState({});
  const [handoffDraft, setHandoffDraft] = useState({});
  const [disputeReason, setDisputeReason] = useState("스코어 또는 개인 기록 재확인 필요");

  useEffect(() => {
    if (!selectedMatch || selectedMatchId === selectedMatch.id) return;
    setSelectedMatchId(selectedMatch.id);
  }, [selectedMatch, selectedMatchId]);

  useEffect(() => {
    if (selectedMatch) {
      setStats(makeInitialStats(selectedMatch));
      setHandoffDraft({});
    }
  }, [selectedMatch?.id, selectedMatch?.result?.updatedAt, selectedMatch?.result?.submittedAt]);

  const recorderSides = selectedMatch ? getStatRecorderSides(selectedMatch, user.id) : [];
  const editablePlayerIds = selectedMatch
    ? getMatchPlayerIds(selectedMatch).filter((playerId) => getAllowedStatFields(selectedMatch, user.id, playerId).length > 0)
    : [];
  const recordWindow = selectedMatch ? getMatchRecordWindow(selectedMatch) : null;
  const startsAt = selectedMatch ? getMatchStartDate(selectedMatch) : null;
  const beforeStart = startsAt && Date.now() < startsAt.getTime();
  const saveWindowOpen = selectedMatch && !beforeStart && (recordWindow?.beforeEnd || recordWindow?.statOpen);
  const canSave = Boolean(selectedMatch && selectedMatch.status !== "disputed" && editablePlayerIds.length && saveWindowOpen);
  const scoreA = selectedMatch ? getSideScore(selectedMatch, stats, "teamA", editablePlayerIds) : 0;
  const scoreB = selectedMatch ? getSideScore(selectedMatch, stats, "teamB", editablePlayerIds) : 0;
  const saveLockedReason = beforeStart
    ? "경기 시작 전"
    : selectedMatch?.status === "disputed"
      ? "이의 확인 중"
    : recordWindow?.statExpired
      ? "기록 마감"
      : !editablePlayerIds.length
        ? "기록 권한 없음"
        : "저장 가능";
  const canDispute = Boolean(selectedMatch?.result) && selectedMatch?.status === "approval" && recordWindow?.disputeOpen;
  const canResumeApproval = selectedMatch?.status === "disputed";
  const canVoid = selectedMatch?.status === "disputed";

  const updateStat = (playerId, fieldId, delta) => {
    setStats((current) => {
      const currentPlayer = current[playerId] ?? {};
      const nextValue = Math.max(0, Number(currentPlayer[fieldId] ?? 0) + delta);

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
    app.actions.submitMatchResult(selectedMatch.id, {
      scoreA,
      scoreB,
      playerStats: stats,
    });
  };

  const handoffRecorder = (sideName) => {
    const nextRecorderId = handoffDraft[sideName];
    if (!selectedMatch || !nextRecorderId) return;
    if (canSave) saveStats();
    app.actions.handoffMatchRecorder(selectedMatch.id, sideName, nextRecorderId);
    setHandoffDraft((current) => ({ ...current, [sideName]: "" }));
  };

  const renderSide = (sideName) => {
    const side = selectedMatch[sideName];

    return (
      <section className="recorder-side" key={sideName}>
        <header>
          <span>{sideLabels[sideName]}</span>
          <strong>{side.name}</strong>
          <em>{sumSidePoints(selectedMatch, stats, sideName)} 득점</em>
        </header>
        <div className="recorder-player-list">
          {side.players.map((playerId) => {
            const player = userMap[playerId];
            const allowedFields = new Set(getAllowedStatFields(selectedMatch, user.id, playerId).map((field) => field.id));

            return (
              <article className="recorder-player-row" key={playerId}>
                <PlayerHoverCard as="span" user={player} teams={app.state.teams} className="recorder-player-main">
                  <span className="avatar small" style={{ "--avatar": player?.avatarColor }}>{player?.name?.slice(0, 1) ?? "P"}</span>
                  <span>
                    <strong>{player?.name ?? "선수"}</strong>
                    <em>{player?.position ?? "-"} · 신뢰 {player?.trustScore ?? "-"}</em>
                  </span>
                </PlayerHoverCard>
                <div className="recorder-stat-grid">
                  {PLAYER_STAT_FIELDS.map((field) => {
                    const value = Number(stats[playerId]?.[field.id] ?? 0);
                    const editable = canSave && allowedFields.has(field.id);

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
          <ShieldCheck size={34} />
          <strong>처리할 진행 경기 없음</strong>
          <p>경기가 확정 완료되면 이 메뉴에서 자동으로 사라집니다.</p>
          <Link to="/app/matches" className="button button-secondary button-md">경기 보기</Link>
        </Card>
      </div>
    );
  }

  const status = statusMeta[selectedMatch.status] ?? { label: selectedMatch.status, tone: "blue" };

  return (
    <div className="page-stack recorder-page">
      <header className="page-header recorder-header">
        <div>
          <span className="eyebrow">ACTIVE MATCHES</span>
          <h1>진행 경기</h1>
          <p>활성 경기만 모아 기록 입력, 이의제기, 결과 승인을 한 화면에서 처리합니다.</p>
        </div>
        <Link to={`/app/matches/${selectedMatch.id}`} className="button button-secondary button-md">경기방</Link>
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
                  onClick={() => setSelectedMatchId(match.id)}
                >
                  <span>
                    <Badge tone={statusMeta[match.status]?.tone ?? "blue"}>{statusMeta[match.status]?.label ?? match.status}</Badge>
                    <em>{getRoleText(match, user, sides)}</em>
                  </span>
                  <strong>{match.teamA.name} vs {match.teamB.name}</strong>
                  <small>{formatSchedule(match)}</small>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="recorder-workspace">
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
                <strong>{selectedMatch.teamA.name}</strong>
                <em>{scoreA}</em>
              </span>
              <b>:</b>
              <span>
                <strong>{selectedMatch.teamB.name}</strong>
                <em>{scoreB}</em>
              </span>
            </div>

            <div className="recorder-sides two">
              {["teamA", "teamB"].map(renderSide)}
            </div>

            {recorderSides.length && !selectedMatch.refereeId ? (
              <div className="recorder-handoff-panel">
                <div>
                  <span className="eyebrow">HANDOFF</span>
                  <strong>기록자 인수인계</strong>
                  <p>후보가 출전하면 쉬고 있는 같은 팀 선수에게 현재 기록 상태를 넘깁니다.</p>
                </div>
                <div className="recorder-handoff-list">
                  {recorderSides.map((sideName) => {
                    const candidates = getMatchReservePlayerIds(selectedMatch, sideName)
                      .filter((playerId) => playerId !== user.id)
                      .map((playerId) => userMap[playerId])
                      .filter(Boolean);
                    return (
                      <div className="recorder-handoff-row" key={sideName}>
                        <label>
                          {sideLabels[sideName]}
                          <select
                            value={handoffDraft[sideName] ?? ""}
                            onChange={(event) => setHandoffDraft((current) => ({ ...current, [sideName]: event.target.value }))}
                          >
                            <option value="">후보 선택</option>
                            {candidates.map((candidate) => (
                              <option value={candidate.id} key={candidate.id}>{candidate.name} · {candidate.position}</option>
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
              <p>{recordWindow?.beforeEnd ? "경기 중 저장은 상태를 진행으로 유지합니다. 경기 종료 후 저장하면 결과 승인 단계로 넘어갑니다." : "저장하면 결과 승인 단계로 넘어갑니다."}</p>
              <Button onClick={saveStats} disabled={!canSave}>
                <Save size={17} />
                저장
              </Button>
            </div>
          </Card>

          {["approval", "disputed"].includes(selectedMatch.status) ? (
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
              <label className="memo-label">
                이의제기 사유
                <textarea disabled={!canDispute} value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} />
              </label>
              <div className="match-action-row">
                <Button type="button" variant="secondary" disabled={!canDispute} onClick={() => app.actions.disputeMatch(selectedMatch.id, disputeReason)}>
                  <AlertTriangle size={16} />
                  이의제기
                </Button>
                <Button type="button" variant="secondary" disabled={!canResumeApproval} onClick={() => app.actions.resumeMatchApproval(selectedMatch.id)}>승인 재개</Button>
                <Button type="button" variant="secondary" disabled={!canVoid} onClick={() => app.actions.voidMatch(selectedMatch.id)}>무효 처리</Button>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
