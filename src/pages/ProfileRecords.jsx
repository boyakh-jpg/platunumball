import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { PersonalRecordMetaLabels } from "../components/match/MatchRecordMeta.jsx";
import RecentMatchRow from "../components/match/RecentMatchRow.jsx";
import ProfileRecordSummaryCard from "../components/profile/ProfileRecordSummaryCard.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { filterProfileRecords, formatStatLine, getActualMatchPlayerSideName, getMatchSideResult, getMatchSideScore as getSideScore, getPlayerRecentRecordMatches, hasVerifiedPlayerStats, isPersonalRecordMatch } from "../lib/matchUtils.js";
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
  const recordFilter = {
    folder: recordFolder,
    officialSection,
    playerId: user.id,
    mode: modeFilter,
    visibility: personalVisibilityFilter,
  };
  const visibleRecentRecords = filterProfileRecords(recentRecords, recordFilter);
  const visibleArchivedRecords = filterProfileRecords(archivedRecords, recordFilter);
  const fallbackPersonalTotals = getTotals(personalRecentRecords, user.id);
  const fallbackPublicPersonalRecords = filterProfileRecords(personalRecentRecords, {
    folder: "personal",
    playerId: user.id,
    visibility: "public",
  });
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
  return (
    <div className="page-stack profile-records-page">
      <header className="page-header ui-page-hero ui-design-app-hero">
        <div className="ui-page-hero__copy">
          <p className="eyebrow">MY RECORDS</p>
          <h1>내 기록</h1>
        </div>
        <Button as={Link} variant="secondary" to="/app/profile">프로필로</Button>
      </header>

      <ProfileRecordSummaryCard
        records={recentRecords}
        playerId={user.id}
        personalSummary={personalSummary}
        recordFolder={recordFolder}
        setRecordFolder={setRecordFolder}
        officialSection={officialSection}
        setOfficialSection={setOfficialSection}
        personalVisibilityFilter={personalVisibilityFilter}
        setPersonalVisibilityFilter={setPersonalVisibilityFilter}
        modeFilter={modeFilter}
        setModeFilter={setModeFilter}
        showPersonalVisibilityFilter
      />

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
              const personalRecord = isPersonalRecordMatch(match);
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
                  to={personalRecord ? `/app/receipt?match=${encodeURIComponent(match.id)}` : `/app/matches?match=${encodeURIComponent(match.id)}`}
                  onOpen={personalRecord ? undefined : () => setSelectedRecordMatchId(match.id)}
                  afterCourt={personalRecord ? <PersonalRecordMetaLabels visibility={match.visibility} /> : null}
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
                to={isPersonalArchiveRecord(record) ? `/app/receipt?match=${encodeURIComponent(record.matchId)}` : undefined}
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
