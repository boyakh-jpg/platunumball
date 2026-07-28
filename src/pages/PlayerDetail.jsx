import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Card from "../components/common/Card.jsx";
import MatchRecordMeta, { PersonalRecordMetaLabels } from "../components/match/MatchRecordMeta.jsx";
import EntityProfileHero from "../components/profile/EntityProfileHero.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import ProgressionChecklist from "../components/rating/ProgressionChecklist.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import TierEmblem from "../components/rating/TierEmblem.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import { getDiscordDisplayName, getDiscordProfileUrl } from "../lib/discord.js";
import { getUserHashtag } from "../lib/handles.js";
import { getTeamRoleLabel, PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { compareMatchRecency, formatStatLine, getMatchSideScore as getSideScore, isPersonalRecordMatch } from "../lib/matchUtils.js";
import { getRepresentativeTeam, getUserProfileTeams } from "../lib/profileSetup.js";
import { getPlacementLabel, isPlacementComplete } from "../lib/rating.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { getTierDivision } from "../lib/tier.js";
import { MatchRoomModal } from "./Matches.jsx";

function getPlayerSide(match, playerId) {
  if ((match.teamA?.players ?? []).includes(playerId)) return "teamA";
  if ((match.teamB?.players ?? []).includes(playerId)) return "teamB";
  return null;
}

function getPlayerOutcome(match, playerId) {
  const sideName = getPlayerSide(match, playerId);
  if (!sideName || !match.result) return null;
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  const sideScore = getSideScore(match, sideName);
  const otherScore = getSideScore(match, otherSide);
  if (sideScore === otherScore) return "draw";
  return sideScore > otherScore ? "win" : "loss";
}

function addCount(map, userId) {
  map.set(userId, (map.get(userId) ?? 0) + 1);
}
function hasPlayerStats(match, playerId) {
  return Boolean(match.refereeId) && Object.prototype.hasOwnProperty.call(match.result?.playerStats ?? {}, playerId);
}


const historyStatusLabel = {
  contract: "동의 대기",
  agreed: "예정",
  approval: "승인 대기",
  disputed: "보류",
  void: "무효",
  cancelled: "취소",
};

export default function PlayerDetail({ app }) {
  const { playerId } = useParams();
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const loadDirectory = app.actions?.loadDirectory;
  const loadPublicProfileRecords = app.actions?.loadPublicProfileRecords;
  useEffect(() => {
    loadDirectory?.();
  }, [loadDirectory]);
  useEffect(() => {
    if (!app.remoteReady || !playerId || !loadPublicProfileRecords) return;
    void loadPublicProfileRecords(playerId);
  }, [app.remoteReady, loadPublicProfileRecords, playerId]);
  const player = app.state.users.find((user) => user.id === playerId);

  const directoryPending = app.remoteReady === false
    || app.directoryStatus?.loading
    || (app.directoryStatus?.loaded === false && !app.directoryStatus?.error);
  if (!player && directoryPending) return <BasketballLoader overlay label="선수 프로필 불러오는 중" />;
  if (!player) return <Navigate to="/app/rankings" replace />;

  const isOwnProfile = player.id === app.currentUser.id;
  const canViewTeamHistory = isOwnProfile || player.privacy?.teamHistory === true || (!isSupabaseConfigured && player.privacy?.teamHistory !== false);
  const canViewStatSummary = isOwnProfile || player.privacy?.statSummary === true || (!isSupabaseConfigured && player.privacy?.statSummary !== false);
  const userMap = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const teamMap = Object.fromEntries(app.state.teams.map((team) => [team.id, team]));
  const playerTeams = getUserProfileTeams(player.id, app.state.teams);
  const representativeTeam = getRepresentativeTeam(player.id, app.state.teams, player.representativeTeamId);
  const orderedPlayerTeams = [...playerTeams].sort((teamA, teamB) => (
    Number(teamB.id === representativeTeam?.id) - Number(teamA.id === representativeTeam?.id)
  ));
  const allPlayerHistory = app.state.matches.filter((match) => getPlayerSide(match, player.id));
  const history = allPlayerHistory.filter((match) => !isPersonalRecordMatch(match));
  const personalRecordHistory = allPlayerHistory
    .filter((match) => (
      isPersonalRecordMatch(match)
      && match.createdBy === player.id
      && match.status === "confirmed"
      && (isOwnProfile || match.visibility === "public")
    ))
    .sort(compareMatchRecency);
  const personalArchive = isOwnProfile ? app.recordArchives?.profile : app.recordArchives?.publicProfiles?.[player.id];
  const personalArchivedRecords = (personalArchive?.rows ?? []).filter((record) => {
    const personalRecord = ["solo", "personal_record"].includes(record.recordType);
    const ownerMatches = record.ownerProfileId ? record.ownerProfileId === player.id : isOwnProfile;
    return personalRecord && ownerMatches && (isOwnProfile || record.visibility === "public");
  });
  const personalSummary = personalArchive?.personalSummary ?? player.personalRecordSummary ?? null;
  const personalRecordCount = Number(personalSummary?.recordCount ?? (personalRecordHistory.length + personalArchivedRecords.length));
  const teammateCounts = new Map();
  const opponentCounts = new Map();
  const totals = Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field.id, 0]));

  for (const match of history) {
    const sideName = getPlayerSide(match, player.id);
    const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
    (match[sideName]?.players ?? []).filter((id) => id !== player.id).forEach((id) => addCount(teammateCounts, id));
    (match[oppositeSide]?.players ?? []).forEach((id) => addCount(opponentCounts, id));
  }
  const confirmedHistory = history.filter((match) => match.status === "confirmed" && match.result);
  const recordedStatHistory = confirmedHistory.filter((match) => hasPlayerStats(match, player.id));
  recordedStatHistory.forEach((match) => {
    const stats = match.result.playerStats[player.id];
    PLAYER_STAT_FIELDS.forEach((field) => { totals[field.id] += Number(stats[field.id] ?? 0); });
  });
  const wins = confirmedHistory.filter((match) => getPlayerOutcome(match, player.id) === "win").length;
  const losses = confirmedHistory.filter((match) => getPlayerOutcome(match, player.id) === "loss").length;
  const winRate = confirmedHistory.length ? Math.round((wins / confirmedHistory.length) * 100) : 0;
  const recentOutcomes = confirmedHistory.slice(0, 10).map((match) => getPlayerOutcome(match, player.id));
  const averageFouls = recordedStatHistory.length
    ? recordedStatHistory.reduce((sum, match) => sum + Number(match.result.playerStats[player.id]?.fouls ?? 0), 0) / recordedStatHistory.length
    : 0;
  const discordProfileUrl = getDiscordProfileUrl(player);
  const discordDisplayName = getDiscordDisplayName(player);
  const placementComplete = isPlacementComplete(player.ratings);
  const placementLabel = getPlacementLabel(player.ratings);

  const renderRelationship = (title, counts) => (
    <Card className="section-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Match Links</p>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="connection-list">
        {[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, count]) => {
          const user = userMap[id];
          if (!user) return null;
          return (
            <PlayerHoverCard key={id} user={user} teams={app.state.teams}>
              <ProfileEmblem user={user} className="small" />
              <strong>{user.name}</strong>
              <em>{count}경기</em>
            </PlayerHoverCard>
          );
        })}
      </div>
    </Card>
  );

  return (
    <div className="page-stack profile-detail-page rank-profile-page">
      <EntityProfileHero
        className="profile-hero rank-profile-hero"
        eyebrow="Player Profile"
        title={player.name}
        subtitle={`${getUserHashtag(player)} · 신뢰도 ${player.trustScore}`}
        leading={<ProfileEmblem user={player} className="hero-avatar" />}
        identityClassName="profile-identity rank-profile-identity"
        badges={(
          <>
              <TierBadge mmr={player.ratings.integrated} ratings={player.ratings} />
              <Badge tone="green">{player.region}</Badge>
              <Badge tone="blue">{player.position}</Badge>
              {discordProfileUrl ? (
                <a className="discord-link-badge" href={discordProfileUrl} target="_blank" rel="noreferrer">
                  <MessageCircle size={14} /> {discordDisplayName}
                </a>
              ) : null}
          </>
        )}
        visual={(
          <div className="tier-statement rank-tier-statement ui-liquid-glass">
          <TierEmblem mmr={player.ratings.integrated} ratings={player.ratings} size="hero" showLabel />
          <div>
            <span>{placementComplete ? getTierDivision(player.ratings.integrated) : "배정 전"}</span>
            <em className="tier-score-line">{placementComplete ? `${Math.round(player.ratings.integrated)} MMR` : placementLabel.replace("배정 전 · ", "")}</em>
          </div>
          </div>
        )}
      />

      {canViewStatSummary || canViewTeamHistory ? (
        <nav className="rank-profile-tabs">
          {canViewStatSummary ? <a href="#summary">종합</a> : null}
          {canViewTeamHistory ? <a href="#history">전적</a> : null}
          {canViewTeamHistory ? <a href="#teams">팀</a> : null}
          {canViewTeamHistory ? <a href="#links">상대</a> : null}
        </nav>
      ) : null}

      <div className={`rank-profile-body-grid${canViewTeamHistory ? " has-team-rail" : ""}${canViewStatSummary ? " has-summary" : ""}`}>
        {canViewTeamHistory ? (
          <aside className="page-stack player-profile-left-rail">
            <Card className="section-card player-profile-teams-card" id="teams">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Teams</p>
                  <h2>소속 팀</h2>
                </div>
                <Badge tone="blue">{orderedPlayerTeams.length}팀</Badge>
              </div>
              {orderedPlayerTeams.length ? (
                <div className="player-profile-team-list">
                  {orderedPlayerTeams.map((team) => {
                    const isRepresentative = team.id === representativeTeam?.id;
                    return (
                      <Link
                        className={`player-profile-team-row${isRepresentative ? " is-representative" : ""}`}
                        key={team.id}
                        to={`/app/teams/${team.id}`}
                      >
                        <TeamEmblem team={team} size="sm" />
                        <span>
                          <small>{isRepresentative ? "대표팀" : "소속팀"}</small>
                          <strong>{team.name}</strong>
                          <em>{getTeamRoleLabel(team.myRole)} · {Math.round(Number(team.mmr) || 0)} MMR</em>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="player-profile-team-empty">소속 팀 없음</p>
              )}
            </Card>
          </aside>
        ) : null}

        {canViewStatSummary ? (
        <section id="summary" className="rank-profile-summary">
          <Card className="section-card rank-record-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Ranked Solo</p>
                <h2>통합 랭크</h2>
              </div>
              <Badge tone={placementComplete ? "gold" : "neutral"}>{placementComplete ? `${Math.round(player.ratings.integrated)} MMR` : placementLabel}</Badge>
            </div>
            <div className="rank-record-main">
              <TierEmblem mmr={player.ratings.integrated} ratings={player.ratings} size="md" showLabel />
              <div>
                <strong>{placementComplete ? getTierDivision(player.ratings.integrated) : "배정 전"}</strong>
                <span>{wins}승 {losses}패 · 승률 {winRate}%</span>
              </div>
            </div>
            <div className="form-pill-row">
              {recentOutcomes.map((outcome, index) => (
                <span key={`${outcome}-${index}`} className={`form-pill form-pill-${outcome === "win" ? "w" : outcome === "loss" ? "l" : "d"}`}>
                  {outcome === "win" ? "W" : outcome === "loss" ? "L" : "D"}
                </span>
              ))}
            </div>
          </Card>
          {recordedStatHistory.length ? <Card className="section-card rank-record-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Career Totals</p>
                <h2>누적 스탯</h2>
              </div>
            </div>
            <div className="rank-stat-grid">
              {PLAYER_STAT_FIELDS.map((field) => (
                <span key={field.id}>
                  <strong>{totals[field.id]}</strong>
                  {field.label}
                </span>
              ))}
              <span>
                <strong>{averageFouls.toFixed(1)}</strong>
                평균 파울
              </span>
            </div>
          </Card> : null}
        </section>
        ) : null}

        <div className={`${canViewStatSummary || canViewTeamHistory ? "content-grid wide-left" : "page-stack"} player-profile-detail-content`}>
        <div className="page-stack">
          <section className="mode-grid">
            <RatingCard title="통합" mmr={player.ratings.integrated} ratings={player.ratings} />
            {placementComplete ? Object.entries(player.ratings.modes).map(([mode, mmr]) => (
              <RatingCard key={mode} title={mode} mmr={mmr} ratings={player.ratings} mode={mode} />
            )) : null}
          </section>

          {(personalRecordCount > 0 || personalArchive?.loading) ? (
            <Card id="personal-records" className="section-card personal-record-profile-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Self Authored</p>
                  <h2>{isOwnProfile ? "내 기록" : player.name + "의 공개 기록"}</h2>
                </div>
                <Badge tone="gold">{personalArchive?.loading && !personalRecordCount ? "불러오는 중" : personalRecordCount + "경기"}</Badge>
              </div>
              {personalSummary && Number(personalSummary.statCount ?? 0) > 0 ? (
                <div className="rank-stat-grid personal-record-stat-grid">
                  <span><strong>{personalSummary.winCount ?? 0}</strong>승</span>
                  <span><strong>{personalSummary.lossCount ?? 0}</strong>패</span>
                  <span><strong>{personalSummary.drawCount ?? 0}</strong>무</span>
                  {PLAYER_STAT_FIELDS.map((field) => <span key={field.id}><strong>{personalSummary[field.id] ?? 0}</strong>{field.label}</span>)}
                </div>
              ) : null}
              <p className="form-helper">직접 작성한 기록입니다. 공식 통계·업적·MMR과 분리됩니다.</p>
              {personalRecordHistory.length ? (
                <div className="history-list personal-record-history-list">
                  {personalRecordHistory.map((match) => {
                    const outcome = getPlayerOutcome(match, player.id);
                    return (
                      <article key={match.id} className={"history-item rank-match-item " + (outcome ? "rank-match-" + outcome : "")}>
                        <div>
                          <button type="button" className="personal-record-open-button" onClick={() => setSelectedMatchId(match.id)}>
                            <strong>{match.title}</strong>
                          </button>
                          <MatchRecordMeta
                            record={match}
                            afterCourt={<PersonalRecordMetaLabels visibility={match.visibility} />}
                          />
                        </div>
                        <div className="history-score"><strong>{getSideScore(match, "teamA")}:{getSideScore(match, "teamB")}</strong></div>
                        {match.result?.playerStats?.[player.id] ? <p>{formatStatLine(match.result.playerStats[player.id])}</p> : null}
                      </article>
                    );
                  })}
                </div>
              ) : null}
              {personalArchivedRecords.length ? (
                <div className="recent-match-list profile-records-list personal-record-archive-list">
                  {personalArchivedRecords.map((record) => (
                    <div key={record.matchId} className={"recent-match-row profile-record-row record-archive-row result-" + String(record.result ?? "D").toLowerCase()}>
                      <b>{record.result}</b>
                      <span>
                        <strong>{record.teamName} vs {record.opponentTeamName}</strong>
                        <MatchRecordMeta
                          record={record}
                          afterCourt={<PersonalRecordMetaLabels visibility={record.visibility} />}
                        />
                      </span>
                      <i>{record.score}:{record.opponentScore}</i>
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          ) : null}

          {canViewTeamHistory ? (
            <Card id="history" className="section-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Player History</p>
                  <h2>누구와 뛰었는지</h2>
                </div>
                <Badge tone="green">{history.length}경기</Badge>
              </div>
              <div className="history-list">
                {history.map((match) => {
                  const sideName = getPlayerSide(match, player.id);
                  const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
                  const side = match[sideName] ?? { name: sideName === "teamA" ? "A" : "B", teamId: "" };
                  const opponent = match[oppositeSide] ?? { name: oppositeSide === "teamA" ? "A" : "B", teamId: "" };
                  const stats = match.result?.playerStats?.[player.id];
                  const outcome = getPlayerOutcome(match, player.id);
                  return (
                    <article key={match.id} className={`history-item rank-match-item ${outcome ? `rank-match-${outcome}` : ""}`}>
                      <div>
                        <Link
                          to={`/app/matches?match=${match.id}`}
                          onClick={(event) => {
                            event.preventDefault();
                            setSelectedMatchId(match.id);
                          }}
                        >
                          <strong>{match.title}</strong>
                        </Link>
                        <MatchRecordMeta record={match} />
                      </div>
                      <div className="history-score">
                        <Badge tone={outcome === null ? "blue" : outcome === "win" ? "green" : outcome === "loss" ? "orange" : "gold"}>
                          {outcome === null ? historyStatusLabel[match.status] ?? "상태 확인 중" : outcome === "win" ? "승" : outcome === "loss" ? "패" : "무"}
                        </Badge>
                        <strong>{getSideScore(match, sideName)}:{getSideScore(match, oppositeSide)}</strong>
                      </div>
                      <div className="history-teams">
                        {side.teamId ? <Link to={`/app/teams/${side.teamId}`}>{teamMap[side.teamId]?.name ?? side.name}</Link> : <span>{side.name}</span>}
                        <span>vs</span>
                        {opponent.teamId ? <Link to={`/app/teams/${opponent.teamId}`}>{teamMap[opponent.teamId]?.name ?? opponent.name}</Link> : <span>{opponent.name}</span>}
                      </div>
                      {canViewStatSummary && stats ? <p>{formatStatLine(stats)}</p> : null}
                    </article>
                  );
                })}
              </div>
            </Card>
          ) : null}
        </div>

        {canViewStatSummary || canViewTeamHistory ? (
          <aside className="page-stack">
            {canViewStatSummary ? <ProgressionChecklist user={player} matches={app.state.matches} /> : null}
            {canViewStatSummary && recordedStatHistory.length ? (
              <Card className="section-card">
                <div className="section-title-row">
                  <div>
                    <p className="eyebrow">Career Totals</p>
                    <h2>누적 경기 스탯</h2>
                  </div>
                </div>
                <div className="contract-grid single">
                  {PLAYER_STAT_FIELDS.map((field) => (
                    <div key={field.id}>
                      <span>{field.label}</span>
                      <strong>{totals[field.id]}</strong>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
            {canViewTeamHistory ? (
              <div id="links" className="page-stack">
                {renderRelationship("같이 뛴 사람", teammateCounts)}
                {renderRelationship("상대한 사람", opponentCounts)}
              </div>
            ) : null}
          </aside>
        ) : null}
        </div>
      </div>
      <MatchRoomModal app={app} matchId={selectedMatchId} entryPoint="player-history" onClose={() => setSelectedMatchId("")} />
    </div>
  );
}
