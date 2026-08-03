import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { PersonalRecordMetaLabels } from "../components/match/MatchRecordMeta.jsx";
import RecentMatchRow from "../components/match/RecentMatchRow.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { formatStatLine, getActualMatchPlayerSideName, getMatchSideResult, getMatchSideScore as getSideScore, getPlayerRecentRecordMatches, getProfileRecordFolder, groupProfileRecordsByCourt, hasVerifiedPlayerStats, isPersonalRecordMatch, summarizeProfileRecords } from "../lib/matchUtils.js";
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

const RECORD_FOLDERS = [
  { id: "summary", label: "종합" },
  { id: "official", label: "공식기록" },
  { id: "no_referee", label: "무심판" },
  { id: "postgame", label: "사후기록" },
  { id: "personal", label: "내 기록" },
];

const OFFICIAL_SECTIONS = [
  { id: "general", label: "일반" },
  { id: "tournament", label: "대회" },
  { id: "venue", label: "경기장별" },
];

const PERSONAL_VISIBILITY_FILTERS = [
  { id: "all", label: "통합" },
  { id: "public", label: "공개" },
  { id: "private", label: "비공개" },
];

const MODE_FILTERS = [
  { id: "all", label: "통합" },
  { id: "1v1", label: "1v1" },
  { id: "2v2", label: "2v2" },
  { id: "3v3", label: "3v3" },
  { id: "5v5", label: "5v5" },
];

const PERSONAL_SUMMARY_FIELDS = [
  "recordCount",
  "winCount",
  "lossCount",
  "drawCount",
  "statCount",
  ...PLAYER_STAT_FIELDS.map((field) => field.id),
];

function matchesRecordSelection(record = {}, folder = "summary", officialSection = "general", playerId = "") {
  const recordFolder = getProfileRecordFolder(record, playerId);
  if (folder === "summary") return recordFolder !== "personal";
  if (recordFolder !== folder) return false;
  if (folder !== "official" || officialSection === "venue") return true;
  return officialSection === "tournament" ? Boolean(record.tournamentId) : !record.tournamentId;
}

function matchesPersonalVisibility(record = {}, filter = "all") {
  return filter === "all" || (record.visibility ?? record.rules?.visibility ?? "private") === filter;
}

function matchesModeFilter(record = {}, filter = "all") {
  return filter === "all" || record.mode === filter;
}

function formatMetric(value = 0) {
  return Number(value).toFixed(1).replace(/\.0$/, "");
}

function getPersonalSummaryByVisibility(summary = {}, filter = "all") {
  if (filter === "all") return summary;
  const publicSummary = summary.publicSummary ?? {};
  if (filter === "public") return publicSummary;
  return Object.fromEntries(PERSONAL_SUMMARY_FIELDS.map((field) => [
    field,
    Math.max(0, Number(summary[field] ?? 0) - Number(publicSummary[field] ?? 0)),
  ]));
}

export default function ProfileRecords({ app }) {
  const user = app.currentUser;
  const loadProfileRecords = app.actions.loadProfileRecords;
  const profileRecordsLoaded = app.actions.profileRecordsLoaded;
  const archiveState = app.recordArchives?.profile ?? { rows: [], page: {}, loading: false, error: "" };
  const loadKeyRef = useRef("");
  const [selectedRecordMatchId, setSelectedRecordMatchId] = useState("");
  const [recordFolder, setRecordFolder] = useState("summary");
  const [officialSection, setOfficialSection] = useState("general");
  const [personalVisibilityFilter, setPersonalVisibilityFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const recentRecords = getPlayerRecentRecordMatches(app.state.matches, user.id);
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
  const visibleRecentRecords = recentRecords.filter((match) => (
    matchesRecordSelection(match, recordFolder, officialSection, user.id)
    && (recordFolder !== "personal" || matchesPersonalVisibility(match, personalVisibilityFilter))
    && (recordFolder === "personal" || matchesModeFilter(match, modeFilter))
  ));
  const visibleArchivedRecords = archivedRecords.filter((record) => (
    matchesRecordSelection(record, recordFolder, officialSection, user.id)
    && (recordFolder !== "personal" || matchesPersonalVisibility(record, personalVisibilityFilter))
    && (recordFolder === "personal" || matchesModeFilter(record, modeFilter))
  ));
  const recentSummary = summarizeProfileRecords(visibleRecentRecords, user.id);
  const fallbackPersonalTotals = getTotals(personalRecentRecords, user.id);
  const fallbackPublicPersonalRecords = personalRecentRecords.filter((match) => matchesPersonalVisibility(match, "public"));
  const personalSummary = archiveState.personalSummary ?? {
    recordCount: personalRecentRecords.length,
    winCount: personalRecentRecords.filter((match) => getRecordLine(match, user.id).result === "W").length,
    lossCount: personalRecentRecords.filter((match) => getRecordLine(match, user.id).result === "L").length,
    drawCount: personalRecentRecords.filter((match) => getRecordLine(match, user.id).result === "D").length,
    statCount: personalRecentRecords.filter((match) => match.result?.playerStats?.[user.id]).length,
    publicRecordCount: personalRecentRecords.filter((match) => match.visibility === "public").length,
    publicSummary: {
      recordCount: fallbackPublicPersonalRecords.length,
      winCount: fallbackPublicPersonalRecords.filter((match) => getRecordLine(match, user.id).result === "W").length,
      lossCount: fallbackPublicPersonalRecords.filter((match) => getRecordLine(match, user.id).result === "L").length,
      drawCount: fallbackPublicPersonalRecords.filter((match) => getRecordLine(match, user.id).result === "D").length,
      statCount: fallbackPublicPersonalRecords.filter((match) => match.result?.playerStats?.[user.id]).length,
      ...getTotals(fallbackPublicPersonalRecords, user.id),
    },
    ...fallbackPersonalTotals,
  };
  const visiblePersonalSummary = getPersonalSummaryByVisibility(personalSummary, personalVisibilityFilter);
  const personalGameCount = Number(visiblePersonalSummary.recordCount ?? 0);
  const statCount = recordFolder === "personal" ? Number(visiblePersonalSummary.statCount ?? 0) : recentSummary.statGames;
  const statTotals = recordFolder === "personal" ? visiblePersonalSummary : recentSummary.totals;
  const statAverages = Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => [
    id,
    statCount ? Number(statTotals[id] ?? 0) / statCount : 0,
  ]));
  const showPlayerStats = recordFolder === "official" || recordFolder === "personal";
  const venueGroups = recordFolder === "official" && officialSection === "venue"
    ? groupProfileRecordsByCourt(visibleRecentRecords, user.id)
    : [];
  const folderLabel = RECORD_FOLDERS.find(({ id }) => id === recordFolder)?.label ?? "종합";
  const sectionLabel = OFFICIAL_SECTIONS.find(({ id }) => id === officialSection)?.label ?? "일반";
  const summaryTitle = `${modeFilter === "all" || recordFolder === "personal" ? "" : `${modeFilter} `}${recordFolder === "official" ? `공식기록 ${sectionLabel}` : folderLabel} 통계`;
  return (
    <div className="page-stack profile-records-page">
      <header className="page-header ui-page-hero ui-design-app-hero">
        <div className="ui-page-hero__copy">
          <p className="eyebrow">MY RECORDS</p>
          <h1>내 기록</h1>
        </div>
        <Button as={Link} variant="secondary" to="/app/profile">프로필로</Button>
      </header>

      <Card className="section-card profile-records-summary">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">RECORD SUMMARY</p>
            <h2>{summaryTitle}</h2>
          </div>
          <Badge tone={recordFolder === "personal" ? "gold" : "green"}>최근 6개월 {recentSummary.games}경기</Badge>
        </div>
        <div className="profile-record-folder-tabs" role="tablist" aria-label="경기 기록 폴더">
          {RECORD_FOLDERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className={recordFolder === item.id ? "active" : ""}
              aria-selected={recordFolder === item.id}
              onClick={() => setRecordFolder(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {recordFolder === "official" ? (
          <div className="ui-segmented-control segmented-control profile-record-section-filter" aria-label="공식기록 구분">
            {OFFICIAL_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={officialSection === item.id ? "active" : ""}
                aria-pressed={officialSection === item.id}
                onClick={() => setOfficialSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        {recordFolder !== "personal" ? (
          <div className="ui-segmented-control segmented-control profile-record-mode-filter" aria-label="경기 인원 구분">
            {MODE_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={modeFilter === item.id ? "active" : ""}
                aria-pressed={modeFilter === item.id}
                onClick={() => setModeFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        {recordFolder === "personal" ? (
          <div className="ui-segmented-control segmented-control profile-record-visibility-filter" aria-label="내 기록 공개 범위">
            {PERSONAL_VISIBILITY_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={personalVisibilityFilter === item.id ? "active" : ""}
                aria-pressed={personalVisibilityFilter === item.id}
                onClick={() => setPersonalVisibilityFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        <h3 className="profile-record-metric-title">최근 6개월 점수</h3>
        <div className="rank-stat-grid profile-record-score-grid">
          <span><strong>{recentSummary.games}</strong>경기</span>
          <span><strong>{recentSummary.wins}</strong>승</span>
          <span><strong>{recentSummary.losses}</strong>패</span>
          <span><strong>{recentSummary.draws}</strong>무</span>
          <span><strong>{formatMetric(recentSummary.winRate)}%</strong>승률</span>
          <span><strong>{formatMetric(recentSummary.averageScore)}</strong>경기당 득점</span>
          <span><strong>{formatMetric(recentSummary.averageAllowed)}</strong>경기당 실점</span>
          <span><strong>{formatMetric(recentSummary.averageDiff)}</strong>평균 득실차</span>
          <span><strong>{recentSummary.scoreFor}</strong>누적 팀 득점</span>
        </div>
        {showPlayerStats ? <>
          <h3 className="profile-record-metric-title">
            {recordFolder === "personal" ? `저장된 내 기록 누적 · ${personalGameCount}경기` : `검증된 개인 기록 누적 · ${statCount}경기`}
          </h3>
          <div className="rank-stat-grid">
            {PLAYER_STAT_FIELDS.map((field) => (
              <span key={field.id}><strong>{statTotals[field.id] ?? 0}</strong>{field.label}</span>
            ))}
          </div>
          <h3 className="profile-record-metric-title">개인 기록 경기당 평균</h3>
          <div className="rank-stat-grid">
            {PLAYER_STAT_FIELDS.map((field) => (
              <span key={field.id}><strong>{formatMetric(statAverages[field.id])}</strong>평균 {field.label}</span>
            ))}
          </div>
        </> : null}
        {venueGroups.length ? (
          <div className="profile-record-venue-list">
            {venueGroups.map((group) => (
              <section key={group.id}>
                <div className="profile-record-venue-heading"><strong>{group.name}</strong><span>{group.summary.games}경기</span></div>
                <div className="rank-stat-grid">
                  <span><strong>{formatMetric(group.summary.averageScore)}</strong>평균 득점</span>
                  <span><strong>{formatMetric(group.summary.averageAllowed)}</strong>평균 실점</span>
                  <span><strong>{formatMetric(group.summary.averageDiff)}</strong>평균 득실차</span>
                  {PLAYER_STAT_FIELDS.map((field) => (
                    <span key={field.id}><strong>{formatMetric(group.summary.averages[field.id])}</strong>평균 {field.label}</span>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
        {recordFolder === "official" && officialSection === "venue" && !venueGroups.length ? (
          <div className="ui-empty-state-compact">최근 6개월 공식 경기장 기록이 없습니다.</div>
        ) : null}
        {recordFolder === "personal" ? <p className="form-helper">직접 만든 기록만 합산합니다. 공식 통계·업적·MMR에는 포함되지 않습니다.</p> : null}
        {["no_referee", "postgame"].includes(recordFolder) ? <p className="form-helper">개인 스탯을 만들지 않는 기록 유형이라 점수 통계만 표시합니다.</p> : null}
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
              const stats = hasVerifiedPlayerStats(match, user.id) ? match.result.playerStats[user.id] : null;
              return (
                <RecentMatchRow
                  key={match.id}
                  record={match}
                  result={line.result}
                  side={line.side}
                  opponent={line.opponent}
                  score={line.score}
                  opponentScore={line.opponentScore}
                  teams={app.state.teams}
                  to={`/app/matches?match=${match.id}`}
                  onOpen={() => setSelectedRecordMatchId(match.id)}
                  afterCourt={isPersonalRecordMatch(match) ? <PersonalRecordMetaLabels visibility={match.visibility} /> : null}
                  detail={stats ? formatStatLine(stats) : null}
                  className="profile-record-row"
                />
              );
            })}
          </div>
        ) : (
          <div className="ui-empty-state-compact">확정된 경기 기록이 없습니다.</div>
        )}
        {archiveState.page?.detailExhausted === false ? (
          <button
            type="button"
            className="button ui-button button-secondary ui-button-secondary button-md ui-button-md"
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
      {archiveState.error && (visibleRecentRecords.length || visibleArchivedRecords.length) ? (
        <Card className="section-card">
          <div className="ui-empty-state-compact">추가 기록을 불러오지 못했습니다. 기존 기록은 그대로 유지됩니다.</div>
          <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" onClick={() => loadProfileRecords?.({ force: true })}>
            다시 시도
          </button>
        </Card>
      ) : null}
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
              <RecentMatchRow
                key={record.matchId}
                record={record}
                result={record.result}
                side={{ name: record.teamName }}
                opponent={{ name: record.opponentTeamName }}
                score={record.score}
                opponentScore={record.opponentScore}
                afterCourt={isPersonalArchiveRecord(record) ? <PersonalRecordMetaLabels visibility={record.visibility} /> : null}
                detail="6개월이 지난 기록은 목록으로 보관합니다."
                className="profile-record-row record-archive-row"
              />
              ))}
          </div>
          {archiveState.page?.archiveExhausted === false ? (
            <button
              type="button"
              className="button ui-button button-secondary ui-button-secondary button-md ui-button-md"
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
          <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" onClick={() => loadProfileRecords?.({ force: true })}>
            다시 시도
          </button>
        </Card>
      ) : null}
      <MatchRoomModal app={app} matchId={selectedRecordMatchId} onClose={() => setSelectedRecordMatchId("")} />
    </div>
  );
}
