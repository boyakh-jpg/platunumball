import Badge from "../common/Badge.jsx";
import Card from "../common/Card.jsx";
import { PLAYER_STAT_FIELDS } from "../../lib/constants.js";
import { filterProfileRecords, groupProfileRecordsByCourt, summarizeProfileRecords } from "../../lib/matchUtils.js";

export const PROFILE_RECORD_FOLDERS = [
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

function formatMetric(value = 0) {
  return Number(value).toFixed(1).replace(/\.0$/, "");
}

function getPersonalSummaryByVisibility(summary = {}, filter = "all") {
  if (filter === "all" || summary.visibilityScope === "public") return summary;
  const publicSummary = summary.publicSummary ?? {};
  if (filter === "public") return publicSummary;
  return Object.fromEntries(PERSONAL_SUMMARY_FIELDS.map((field) => [
    field,
    Math.max(0, Number(summary[field] ?? 0) - Number(publicSummary[field] ?? 0)),
  ]));
}

export default function ProfileRecordSummaryCard({
  records = [],
  playerId = "",
  personalSummary = null,
  recordFolder,
  setRecordFolder,
  officialSection,
  setOfficialSection,
  personalVisibilityFilter = "all",
  setPersonalVisibilityFilter,
  modeFilter,
  setModeFilter,
  showPersonalVisibilityFilter = false,
}) {
  const visibleRecords = filterProfileRecords(records, {
    folder: recordFolder,
    officialSection,
    playerId,
    mode: modeFilter,
    visibility: personalVisibilityFilter,
  });
  const recentSummary = summarizeProfileRecords(visibleRecords, playerId);
  const fallbackPersonalSummary = {
    recordCount: recentSummary.games,
    winCount: recentSummary.wins,
    lossCount: recentSummary.losses,
    drawCount: recentSummary.draws,
    statCount: recentSummary.statGames,
    ...recentSummary.totals,
  };
  const visiblePersonalSummary = getPersonalSummaryByVisibility(personalSummary ?? fallbackPersonalSummary, personalVisibilityFilter);
  const personalGameCount = Number(visiblePersonalSummary.recordCount ?? 0);
  const statCount = recordFolder === "personal" ? Number(visiblePersonalSummary.statCount ?? 0) : recentSummary.statGames;
  const statTotals = recordFolder === "personal" ? visiblePersonalSummary : recentSummary.totals;
  const statAverages = Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => [
    id,
    statCount ? Number(statTotals[id] ?? 0) / statCount : 0,
  ]));
  const showPlayerStats = recordFolder === "official" || recordFolder === "personal";
  const venueGroups = recordFolder === "official" && officialSection === "venue"
    ? groupProfileRecordsByCourt(visibleRecords, playerId)
    : [];
  const folderLabel = PROFILE_RECORD_FOLDERS.find(({ id }) => id === recordFolder)?.label ?? "종합";
  const sectionLabel = OFFICIAL_SECTIONS.find(({ id }) => id === officialSection)?.label ?? "일반";
  const summaryTitle = `${modeFilter === "all" || recordFolder === "personal" ? "" : `${modeFilter} `}${recordFolder === "official" ? `공식기록 ${sectionLabel}` : folderLabel} 통계`;

  return (
    <Card className="section-card profile-records-summary">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">RECORD SUMMARY</p>
          <h2>{summaryTitle}</h2>
        </div>
        <Badge tone={recordFolder === "personal" ? "gold" : "green"}>최근 6개월 {recentSummary.games}경기</Badge>
      </div>
      <div className="profile-record-folder-tabs" role="tablist" aria-label="경기 기록 폴더">
        {PROFILE_RECORD_FOLDERS.map((item) => (
          <button key={item.id} type="button" role="tab" className={recordFolder === item.id ? "active" : ""} aria-selected={recordFolder === item.id} onClick={() => setRecordFolder(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {recordFolder === "official" ? (
        <div className="ui-segmented-control segmented-control profile-record-section-filter" aria-label="공식기록 구분">
          {OFFICIAL_SECTIONS.map((item) => (
            <button key={item.id} type="button" className={officialSection === item.id ? "active" : ""} aria-pressed={officialSection === item.id} onClick={() => setOfficialSection(item.id)}>{item.label}</button>
          ))}
        </div>
      ) : null}
      {recordFolder !== "personal" ? (
        <div className="ui-segmented-control segmented-control profile-record-mode-filter" aria-label="경기 인원 구분">
          {MODE_FILTERS.map((item) => (
            <button key={item.id} type="button" className={modeFilter === item.id ? "active" : ""} aria-pressed={modeFilter === item.id} onClick={() => setModeFilter(item.id)}>{item.label}</button>
          ))}
        </div>
      ) : null}
      {recordFolder === "personal" && showPersonalVisibilityFilter ? (
        <div className="ui-segmented-control segmented-control profile-record-visibility-filter" aria-label="내 기록 공개 범위">
          {PERSONAL_VISIBILITY_FILTERS.map((item) => (
            <button key={item.id} type="button" className={personalVisibilityFilter === item.id ? "active" : ""} aria-pressed={personalVisibilityFilter === item.id} onClick={() => setPersonalVisibilityFilter(item.id)}>{item.label}</button>
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
          {PLAYER_STAT_FIELDS.map((field) => <span key={field.id}><strong>{statTotals[field.id] ?? 0}</strong>{field.label}</span>)}
        </div>
        <h3 className="profile-record-metric-title">개인 기록 경기당 평균</h3>
        <div className="rank-stat-grid">
          {PLAYER_STAT_FIELDS.map((field) => <span key={field.id}><strong>{formatMetric(statAverages[field.id])}</strong>평균 {field.label}</span>)}
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
                {PLAYER_STAT_FIELDS.map((field) => <span key={field.id}><strong>{formatMetric(group.summary.averages[field.id])}</strong>평균 {field.label}</span>)}
              </div>
            </section>
          ))}
        </div>
      ) : null}
      {recordFolder === "official" && officialSection === "venue" && !venueGroups.length ? <div className="ui-empty-state-compact">최근 6개월 공식 경기장 기록이 없습니다.</div> : null}
      {recordFolder === "personal" ? <p className="form-helper">직접 만든 기록만 합산합니다. 공식 통계·업적·MMR에는 포함되지 않습니다.</p> : null}
      {["no_referee", "postgame"].includes(recordFolder) ? <p className="form-helper">개인 스탯을 만들지 않는 기록 유형이라 점수 통계만 표시합니다.</p> : null}
    </Card>
  );
}
