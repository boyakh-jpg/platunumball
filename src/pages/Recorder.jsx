import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Minus, Plus, Save, ShieldCheck } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import {
  getAllowedStatFields,
  getMatchPlayerIds,
  getMatchRecordWindow,
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
};

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

function getSideScore(match, stats, sideName, editableSides) {
  if (editableSides.includes(sideName) || hasSideStats(match, sideName)) return sumSidePoints(match, stats, sideName);
  return getExistingScore(match, sideName);
}

function formatSchedule(match) {
  return [match.scheduledDate, match.scheduledTime, match.court].filter(Boolean).join(" · ");
}

function getRoleText(match, user, recorderSides) {
  if (isMatchReferee(match, user.id)) return "심판";
  return `${recorderSides.map((sideName) => sideLabels[sideName]).join(", ")} 기록자`;
}

function canAccessRecorder(match, user) {
  const isReferee = isMatchReferee(match, user.id) && isEligibleReferee(user, match.refereeTrustMin);
  return isReferee || (!match.refereeId && getStatRecorderSides(match, user.id).length > 0);
}

export default function Recorder({ app }) {
  const user = app.currentUser;
  const userMap = useMemo(() => Object.fromEntries(app.state.users.map((item) => [item.id, item])), [app.state.users]);
  const matches = useMemo(
    () =>
      app.state.matches
        .filter((match) => ["agreed", "approval"].includes(match.status) && canAccessRecorder(match, user))
        .sort((a, b) => String(a.scheduledAt ?? a.createdAt ?? "").localeCompare(String(b.scheduledAt ?? b.createdAt ?? ""))),
    [app.state.matches, user],
  );
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? matches[0] ?? null;
  const [stats, setStats] = useState({});

  useEffect(() => {
    if (!selectedMatch || selectedMatchId === selectedMatch.id) return;
    setSelectedMatchId(selectedMatch.id);
  }, [selectedMatch, selectedMatchId]);

  useEffect(() => {
    if (selectedMatch) setStats(makeInitialStats(selectedMatch));
  }, [selectedMatch?.id, selectedMatch?.result?.updatedAt, selectedMatch?.result?.submittedAt]);

  const recorderSides = selectedMatch ? getStatRecorderSides(selectedMatch, user.id) : [];
  const isReferee = selectedMatch ? isMatchReferee(selectedMatch, user.id) : false;
  const editableSides = isReferee ? ["teamA", "teamB"] : selectedMatch?.refereeId ? [] : recorderSides;
  const recordWindow = selectedMatch ? getMatchRecordWindow(selectedMatch) : null;
  const startsAt = selectedMatch ? getMatchStartDate(selectedMatch) : null;
  const beforeStart = startsAt && Date.now() < startsAt.getTime();
  const saveWindowOpen = selectedMatch && !beforeStart && (recordWindow?.beforeEnd || recordWindow?.statOpen);
  const canSave = Boolean(selectedMatch && editableSides.length && saveWindowOpen);
  const scoreA = selectedMatch ? getSideScore(selectedMatch, stats, "teamA", editableSides) : 0;
  const scoreB = selectedMatch ? getSideScore(selectedMatch, stats, "teamB", editableSides) : 0;
  const saveLockedReason = beforeStart
    ? "경기 시작 전"
    : recordWindow?.statExpired
      ? "기록 마감"
      : !editableSides.length
        ? "기록 권한 없음"
        : "저장 가능";

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
            <span className="eyebrow">REFEREE / RECORDER</span>
            <h1>기록판</h1>
            <p>심판 또는 후보 기록자로 배정된 경기만 표시됩니다.</p>
          </div>
        </header>
        <Card className="recorder-empty">
          <ShieldCheck size={34} />
          <strong>배정된 기록 경기 없음</strong>
          <p>경기방에서 심판이나 후보 기록자로 지정되면 여기서 실시간 기록을 저장합니다.</p>
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
          <span className="eyebrow">REFEREE / RECORDER</span>
          <h1>기록판</h1>
          <p>심판은 양팀, 기록자는 배정된 팀 선수만 카운트합니다. 선수 득점 합계가 팀 점수로 자동 반영됩니다.</p>
        </div>
        <Link to={`/app/matches/${selectedMatch.id}`} className="button button-secondary button-md">경기방</Link>
      </header>

      <div className="recorder-layout">
        <Card className="recorder-match-list">
          <div className="section-title-row">
            <div>
              <span className="eyebrow">ASSIGNED</span>
              <h2>내 기록 경기</h2>
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

          <div className={editableSides.length > 1 ? "recorder-sides two" : "recorder-sides"}>
            {editableSides.map(renderSide)}
          </div>

          <div className="recorder-save-row">
            <p>{recordWindow?.beforeEnd ? "경기 중 저장은 상태를 진행으로 유지합니다. 경기 종료 후 저장하면 결과 승인 단계로 넘어갑니다." : "저장하면 결과 승인 단계로 넘어갑니다."}</p>
            <Button onClick={saveStats} disabled={!canSave}>
              <Save size={17} />
              저장
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
