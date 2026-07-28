import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import MatchRecordMeta, { PersonalRecordMetaLabels } from "../components/match/MatchRecordMeta.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { formatStatLine, getActualMatchPlayerSideName, getMatchParticipationType, getMatchPlayedDate, getMatchSideResult, getMatchSideScore as getSideScore, getPlayerRecentRecordMatches, isPersonalRecordMatch } from "../lib/matchUtils.js";
import { MatchRoomModal } from "./Matches.jsx";

function getRecordLine(match, userId) {
  const sideName = getActualMatchPlayerSideName(match, userId) ?? "teamA";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  return {
    side: match[sideName],
    opponent: match[otherSide],
    score: getSideScore(match, sideName),
    opponentScore: getSideScore(match, otherSide),
    result: getMatchSideResult(match, sideName),
  };
}
function hasPlayerStats(match, userId) {
  return Boolean(match.refereeId) && Object.prototype.hasOwnProperty.call(match.result?.playerStats ?? {}, userId);
}


function getTotals(records, userId) {
  return records.reduce((totals, match) => {
    const stats = match.result?.playerStats?.[userId] ?? {};
    PLAYER_STAT_FIELDS.forEach((field) => {
      totals[field.id] = (totals[field.id] ?? 0) + Number(stats[field.id] ?? 0);
    });
    return totals;
  }, {});
}

function isPersonalArchiveRecord(record = {}) {
  return ["solo", "personal_record"].includes(String(record.recordType ?? "").trim().toLowerCase());
}

const RECORD_FILTERS = [
  { id: "all", label: "통합" },
  { id: "individual", label: "개인전" },
  { id: "team", label: "팀전" },
  { id: "personal", label: "내 기록" },
];

function matchesRecordFilter(record = {}, filter = "all") {
  const participationType = getMatchParticipationType(record);
  if (filter === "personal") return participationType === "personal";
  if (participationType === "personal") return false;
  return filter === "all" || participationType === filter;
}

export default function ProfileRecords({ app }) {
  const user = app.currentUser;
  const loadProfileRecords = app.actions.loadProfileRecords;
  const profileRecordsLoaded = app.actions.profileRecordsLoaded;
  const archiveState = app.recordArchives?.profile ?? { rows: [], page: {}, loading: false, error: "" };
  const loadKeyRef = useRef("");
  const [selectedRecordMatchId, setSelectedRecordMatchId] = useState("");
  const [recordFilter, setRecordFilter] = useState("all");
  const recentRecords = getPlayerRecentRecordMatches(app.state.matches, user.id);
  const officialRecentRecords = recentRecords.filter((match) => !isPersonalRecordMatch(match));
  const personalRecentRecords = recentRecords.filter(isPersonalRecordMatch);
  const archivedRecords = archiveState.rows ?? [];
  useEffect(() => {
    const shouldLoadRecords = !profileRecordsLoaded;
    if (!app.remoteReady || !loadProfileRecords || !shouldLoadRecords) return;
    if (archiveState.error) return;
    if (loadKeyRef.current === user.id) return;
    loadKeyRef.current = user.id;
    const request = loadProfileRecords();
    if (!request?.then) {
      if (!request) loadKeyRef.current = "";
      return;
    }
    request.then((count) => {
      if (count === false) loadKeyRef.current = "";
    }).catch(() => {
      loadKeyRef.current = "";
    });
  }, [app.remoteReady, archiveState.error, loadProfileRecords, profileRecordsLoaded, user.id]);
  const filteredOfficialRecords = officialRecentRecords.filter((match) => matchesRecordFilter(match, recordFilter));
  const visibleRecentRecords = recentRecords.filter((match) => matchesRecordFilter(match, recordFilter));
  const visibleArchivedRecords = archivedRecords.filter((record) => matchesRecordFilter(record, recordFilter));
  const recordedStatRecords = filteredOfficialRecords.filter((match) => hasPlayerStats(match, user.id));
  const totals = getTotals(recordedStatRecords, user.id);
  const wins = filteredOfficialRecords.filter((match) => getRecordLine(match, user.id).result === "W").length;
  const losses = filteredOfficialRecords.filter((match) => getRecordLine(match, user.id).result === "L").length;
  const draws = filteredOfficialRecords.length - wins - losses;
  const averageFouls = recordedStatRecords.length ? Number(totals.fouls ?? 0) / recordedStatRecords.length : 0;
  const fallbackPersonalTotals = getTotals(personalRecentRecords, user.id);
  const personalSummary = archiveState.personalSummary ?? {
    recordCount: personalRecentRecords.length,
    winCount: personalRecentRecords.filter((match) => getRecordLine(match, user.id).result === "W").length,
    lossCount: personalRecentRecords.filter((match) => getRecordLine(match, user.id).result === "L").length,
    drawCount: personalRecentRecords.filter((match) => getRecordLine(match, user.id).result === "D").length,
    statCount: personalRecentRecords.filter((match) => match.result?.playerStats?.[user.id]).length,
    publicRecordCount: personalRecentRecords.filter((match) => match.visibility === "public").length,
    ...fallbackPersonalTotals,
  };
  const dateRows = [...visibleRecentRecords.reduce((map, match) => {
    const date = getMatchPlayedDate(match) || "날짜 미정";
    map.set(date, (map.get(date) ?? 0) + 1);
    return map;
  }, new Map()).entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])));

  return (
    <div className="page-stack profile-records-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">MY RECORDS</p>
          <h1>내 기록</h1>
        </div>
        <Button as={Link} variant="secondary" to="/app/profile">프로필로</Button>
      </header>

      <Card className="section-card profile-records-summary">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">{recordFilter === "personal" ? "Self Authored" : "Official & General"}</p>
            <h2>{recordFilter === "personal" ? "내 기록 통계" : `${RECORD_FILTERS.find((item) => item.id === recordFilter)?.label ?? "통합"} 경기 통계`}</h2>
          </div>
          <Badge tone={recordFilter === "personal" ? "gold" : "green"}>
            {recordFilter === "personal"
              ? `내 기록 ${personalSummary.recordCount ?? 0} · 공개 ${personalSummary.publicRecordCount ?? 0}`
              : `최근 6개월 ${filteredOfficialRecords.length}경기`}
          </Badge>
        </div>
        <div className="segmented-control profile-record-filter" aria-label="경기 기록 구분">
          {RECORD_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={recordFilter === item.id ? "active" : ""}
              aria-pressed={recordFilter === item.id}
              onClick={() => setRecordFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="rank-stat-grid">
          {recordFilter === "personal" ? <>
            <span><strong>{personalSummary.winCount ?? 0}</strong>승</span>
            <span><strong>{personalSummary.lossCount ?? 0}</strong>패</span>
            <span><strong>{personalSummary.drawCount ?? 0}</strong>무</span>
            {Number(personalSummary.statCount ?? 0) > 0 ? PLAYER_STAT_FIELDS.map((field) => (
              <span key={field.id}><strong>{personalSummary[field.id] ?? 0}</strong>{field.label}</span>
            )) : null}
          </> : <>
            <span><strong>{wins}</strong>승</span>
            <span><strong>{losses}</strong>패</span>
            <span><strong>{draws}</strong>무</span>
            {recordedStatRecords.length ? <>
              <span><strong>{averageFouls.toFixed(1)}</strong>평균 파울</span>
              {PLAYER_STAT_FIELDS.map((field) => (
                <span key={field.id}><strong>{totals[field.id] ?? 0}</strong>{field.label}</span>
              ))}
            </> : null}
          </>}
        </div>
        {recordFilter === "personal" ? <p className="form-helper">직접 만든 기록만 합산합니다. 공식 통계·업적·MMR에는 포함되지 않습니다.</p> : null}
      </Card>

      <Card className="section-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Calendar</p>
            <h2>날짜별 기록 수</h2>
          </div>
          <Badge tone="blue">6개월</Badge>
        </div>
        <div className="rank-stat-grid">
          {dateRows.length ? dateRows.slice(0, 24).map(([date, count]) => (
            <span key={date}><strong>{count}</strong>{date}</span>
          )) : <span><strong>0</strong>기록 없음</span>}
        </div>
      </Card>

      <Card className="section-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">History</p>
            <h2>최근 6개월 경기 기록</h2>
          </div>
        </div>
        {visibleRecentRecords.length ? (
          <div className="recent-match-list profile-records-list">
            {visibleRecentRecords.map((match) => {
              const line = getRecordLine(match, user.id);
              const stats = hasPlayerStats(match, user.id) ? match.result.playerStats[user.id] : null;
              return (
                <Link
                  key={match.id}
                  to={`/app/matches?match=${match.id}`}
                  className={`recent-match-row profile-record-row result-${line.result.toLowerCase()}`}
                  onClick={(event) => {
                    event.preventDefault();
                    setSelectedRecordMatchId(match.id);
                  }}
                >
                  <b>{line.result}</b>
                  <span>
                    <strong>{line.side.name} vs {line.opponent.name}</strong>
                    <MatchRecordMeta
                      record={match}
                      afterCourt={isPersonalRecordMatch(match) ? <PersonalRecordMetaLabels visibility={match.visibility} /> : null}
                    />
                    {stats ? <small>{formatStatLine(stats)}</small> : null}
                  </span>
                  <i>{line.score}:{line.opponentScore}</i>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="ui-empty-state-compact">확정된 경기 기록이 없습니다.</div>
        )}
        {archiveState.page?.detailExhausted === false ? (
          <button
            type="button"
            className="button button-secondary button-md"
            disabled={archiveState.loading}
            onClick={() => loadProfileRecords?.({
              loadMoreDetail: true,
              detailOffset: archiveState.page?.detailNextOffset,
            })}
          >
            {archiveState.loading ? "불러오는 중" : "상세 기록 더 보기"}
          </button>
        ) : null}
      </Card>
      {visibleArchivedRecords.length ? (
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Archive</p>
              <h2>6개월 초과 · 최근 5년</h2>
            </div>
            <Badge tone="neutral">목록 {visibleArchivedRecords.length}경기</Badge>
          </div>
          <div className="recent-match-list profile-records-list">
            {visibleArchivedRecords.map((record) => (
                <div key={record.matchId} className={`recent-match-row profile-record-row record-archive-row result-${String(record.result ?? "D").toLowerCase()}`}>
                  <b>{record.result}</b>
                  <span>
                    <strong>{record.teamName} vs {record.opponentTeamName}</strong>
                    <MatchRecordMeta
                      record={record}
                      afterCourt={isPersonalArchiveRecord(record) ? <PersonalRecordMetaLabels visibility={record.visibility} /> : null}
                    />
                    <small>6개월이 지난 기록은 목록으로 보관합니다.</small>
                  </span>
                  <i>{record.score}:{record.opponentScore}</i>
                </div>
              ))}
          </div>
          {archiveState.page?.archiveExhausted === false ? (
            <button
              type="button"
              className="button button-secondary button-md"
              disabled={archiveState.loading}
              onClick={() => loadProfileRecords?.({
                loadMoreArchive: true,
                archiveOffset: archiveState.page?.archiveNextOffset,
              })}
            >
              {archiveState.loading ? "불러오는 중" : "기록 더 보기"}
            </button>
          ) : null}
        </Card>
      ) : archiveState.loading && !archiveState.loaded ? (
        <Card className="section-card"><div className="ui-empty-state-compact">5년 기록을 불러오는 중입니다.</div></Card>
      ) : archiveState.error ? (
        <Card className="section-card">
          <div className="ui-empty-state-compact">기록을 불러오지 못했습니다.</div>
          <button type="button" className="button button-secondary button-md" onClick={() => loadProfileRecords?.({ force: true })}>
            다시 시도
          </button>
        </Card>
      ) : null}
      <MatchRoomModal app={app} matchId={selectedRecordMatchId} onClose={() => setSelectedRecordMatchId("")} />
    </div>
  );
}
