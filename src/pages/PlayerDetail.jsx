import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowUpRight, MessageCircle, ShieldCheck } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import RecentMatchRow from "../components/match/RecentMatchRow.jsx";
import EntityProfileHero from "../components/profile/EntityProfileHero.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import ProfileRecordSummaryCard from "../components/profile/ProfileRecordSummaryCard.jsx";
import ProgressionChecklist from "../components/rating/ProgressionChecklist.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import TierEmblem from "../components/rating/TierEmblem.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import { getDiscordDmUrl } from "../lib/discord.js";
import { getUserHashtag } from "../lib/handles.js";
import { getTeamRoleLabel } from "../lib/constants.js";
import { getActualMatchPlayerSideName, getMatchSideScore as getSideScore, getPlayerRecentRecordMatches, isEligibleReferee, isPersonalRecordMatch } from "../lib/matchUtils.js";
import { getRepresentativeTeam, getUserProfileTeams } from "../lib/profileSetup.js";
import { getPlacementLabel, isPlacementComplete } from "../lib/rating.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { getTierDivision } from "../lib/tier.js";
import { MatchRoomModal } from "./Matches.jsx";
import PlayerCommunityActivity from "./PlayerCommunityActivity.jsx";

function getPlayerOutcome(match, playerId) {
  const sideName = getActualMatchPlayerSideName(match, playerId);
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
  const location = useLocation();
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [profileLoadAttempt, setProfileLoadAttempt] = useState(0);
  const [profileLoadState, setProfileLoadState] = useState({ playerId: "", status: "idle" });
  const [refereeProfileState, setRefereeProfileState] = useState({ playerId: "", available: false });
  const [recordFolder, setRecordFolder] = useState("summary");
  const [officialSection, setOfficialSection] = useState("general");
  const [personalVisibilityFilter, setPersonalVisibilityFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const loadDirectory = app.actions?.loadDirectory;
  const loadPublicProfileRecords = app.actions?.loadPublicProfileRecords;
  const loadRefereeDetail = app.actions?.loadRefereeDetail;
  useEffect(() => {
    if (!playerId || app.remoteReady === false) return undefined;
    let cancelled = false;
    if (!isSupabaseConfigured) {
      setProfileLoadState({ playerId, status: "loaded" });
      return undefined;
    }
    setProfileLoadState({ playerId, status: "loading" });
    Promise.resolve(loadDirectory?.({
      force: profileLoadAttempt > 0,
      kind: "players",
      profileId: playerId,
      limit: 1,
      offset: 0,
    })).then((result) => {
      if (!cancelled) setProfileLoadState({ playerId, status: result === false ? "error" : "loaded" });
    }).catch(() => {
      if (!cancelled) setProfileLoadState({ playerId, status: "error" });
    });
    return () => { cancelled = true; };
  }, [app.remoteReady, loadDirectory, playerId, profileLoadAttempt]);
  useEffect(() => {
    if (app.demoPreview || !app.remoteReady || !playerId || !loadPublicProfileRecords) return;
    void loadPublicProfileRecords(playerId);
  }, [app.demoPreview, app.remoteReady, loadPublicProfileRecords, playerId]);
  const previewPlayer = location.state?.playerPreview?.id === playerId
    ? location.state.playerPreview
    : null;
  const player = app.state.users.find((user) => user.id === playerId) ?? previewPlayer;
  const hasKnownRefereeProfile = Boolean(player && isEligibleReferee(
    player,
    undefined,
    app.state.settings?.refereeAppointments,
  ));
  const playerAvailable = Boolean(player);
  useEffect(() => {
    if (app.demoPreview || !playerId || !playerAvailable || app.remoteReady === false) return undefined;
    let cancelled = false;
    if (hasKnownRefereeProfile || !isSupabaseConfigured || !loadRefereeDetail) {
      setRefereeProfileState({ playerId, available: hasKnownRefereeProfile });
      return undefined;
    }
    setRefereeProfileState({ playerId, available: false });
    Promise.resolve(loadRefereeDetail(playerId, 1))
      .then((result) => {
        if (!cancelled) setRefereeProfileState({ playerId, available: Boolean(result?.referee) });
      })
      .catch(() => {
        if (!cancelled) setRefereeProfileState({ playerId, available: false });
      });
    return () => { cancelled = true; };
  }, [app.demoPreview, app.remoteReady, hasKnownRefereeProfile, loadRefereeDetail, playerAvailable, playerId]);

  const directoryPending = app.remoteReady === false
    || profileLoadState.playerId !== playerId
    || ["idle", "loading"].includes(profileLoadState.status);
  if (!player && directoryPending) return <BasketballLoader overlay label="선수 프로필 불러오는 중" />;
  if (!player && profileLoadState.status === "error") {
    return (
      <Card className="section-card court-detail-state">
        <h1>선수 프로필을 불러오지 못했습니다.</h1>
        <p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
        <div className="ui-action-row">
          <Button type="button" onClick={() => setProfileLoadAttempt((attempt) => attempt + 1)}>다시 시도</Button>
          <Button as={Link} to="/app/rankings" variant="secondary">랭킹으로</Button>
        </div>
      </Card>
    );
  }
  if (!player) {
    return (
      <Card className="section-card court-detail-state">
        <h1>선수 프로필을 찾을 수 없습니다.</h1>
        <Button as={Link} to="/app/rankings" variant="secondary">랭킹으로</Button>
      </Card>
    );
  }

  const isOwnProfile = player.id === app.currentUser.id;
  const canViewTeamHistory = isOwnProfile || player.privacy?.teamHistory === true || (!isSupabaseConfigured && player.privacy?.teamHistory !== false);
  const canViewStatSummary = isOwnProfile || player.privacy?.statSummary !== false;
  const canViewCommunity = isOwnProfile || player.privacy?.communityPosts !== false || player.privacy?.communityComments !== false;
  const hasRefereeProfile = refereeProfileState.playerId === player.id && refereeProfileState.available;
  const userMap = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const playerTeams = getUserProfileTeams(player.id, app.state.teams);
  const representativeTeam = getRepresentativeTeam(player.id, app.state.teams, player.representativeTeamId);
  const orderedPlayerTeams = [...playerTeams].sort((teamA, teamB) => (
    Number(teamB.id === representativeTeam?.id) - Number(teamA.id === representativeTeam?.id)
  ));
  const allPlayerHistory = app.state.matches.filter((match) => getActualMatchPlayerSideName(match, player.id));
  const history = allPlayerHistory.filter((match) => (
    !isPersonalRecordMatch(match)
    && (isOwnProfile || (match.visibility ?? match.rules?.visibility ?? "public") !== "private")
  ));
  const recentProfileRecords = getPlayerRecentRecordMatches(app.state.matches, player.id).filter((match) => (
    isOwnProfile || (isPersonalRecordMatch(match)
      ? (match.visibility ?? match.rules?.visibility ?? "private") === "public"
      : (match.visibility ?? match.rules?.visibility ?? "public") !== "private")
  ));
  const profileRecordArchive = isOwnProfile ? app.recordArchives?.profile : app.recordArchives?.publicProfiles?.[player.id];
  const archivedPublicHistory = (profileRecordArchive?.rows ?? []).filter((record) => (
    !["solo", "personal_record"].includes(record.recordType)
    && (isOwnProfile || record.visibility === "public")
  ));
  const personalSummary = profileRecordArchive?.personalSummary ?? (isOwnProfile ? player.personalRecordSummary : null);
  const teammateCounts = new Map();
  const opponentCounts = new Map();

  for (const match of history) {
    const sideName = getActualMatchPlayerSideName(match, player.id);
    const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
    (match[sideName]?.players ?? []).filter((id) => id !== player.id).forEach((id) => addCount(teammateCounts, id));
    (match[oppositeSide]?.players ?? []).forEach((id) => addCount(opponentCounts, id));
  }
  const confirmedHistory = history.filter((match) => match.status === "confirmed" && match.result);
  const wins = confirmedHistory.filter((match) => getPlayerOutcome(match, player.id) === "win").length;
  const losses = confirmedHistory.filter((match) => getPlayerOutcome(match, player.id) === "loss").length;
  const winRate = confirmedHistory.length ? Math.round((wins / confirmedHistory.length) * 100) : 0;
  const recentOutcomes = confirmedHistory.slice(0, 10).map((match) => getPlayerOutcome(match, player.id));
  const discordDmUrl = getDiscordDmUrl(player);
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
            <PlayerHoverCard key={id} user={user} teams={app.state.teams} className="ui-profile-identity-inline">
              <ProfileEmblem user={user} className="small" />
              <strong>{user.name}</strong>
              <em>{count}경기</em>
            </PlayerHoverCard>
          );
        })}
        {!counts.size ? <div className="ui-empty-state-compact">공개 경기 기록이 아직 없습니다.</div> : null}
      </div>
    </Card>
  );

  return (
    <div className="page-stack profile-detail-page rank-profile-page">
      <EntityProfileHero
        className="profile-hero rank-profile-hero"
        eyebrow="Player Profile"
        title={player.name}
        subtitle={(
          <>
            {getUserHashtag(player)}
            {discordDmUrl ? (
              <a className="discord-link-badge" href={discordDmUrl} target="_blank" rel="noreferrer" aria-label="Discord에서 DM 보내기">
                <MessageCircle size={13} aria-hidden="true" />
                <span>DM 보내기</span>
              </a>
            ) : null}
            {` · 신뢰도 ${player.trustScore}`}
          </>
        )}
        badges={(
          <>
              <Badge tone="gold" className="ui-liquid-glass">
                {placementComplete ? `${Math.round(player.ratings.integrated)} MMR` : placementLabel}
              </Badge>
              <Badge tone="green" className="ui-liquid-glass">{player.region}</Badge>
              <Badge tone="blue" className="ui-liquid-glass">{player.position}</Badge>
          </>
        )}
        visual={(
          <div className="player-tier-hero">
            <TierEmblem mmr={player.ratings.integrated} ratings={player.ratings} size="hero" showLabel />
          </div>
        )}
      />

      {profileLoadState.status === "error" ? (
        <Card className="section-card court-detail-state">
          <p>최신 선수 프로필을 불러오지 못했습니다. 현재 보이는 정보는 이전 화면의 미리보기일 수 있습니다.</p>
          <Button type="button" variant="secondary" onClick={() => setProfileLoadAttempt((attempt) => attempt + 1)}>다시 시도</Button>
        </Card>
      ) : null}

      {canViewStatSummary || canViewTeamHistory || canViewCommunity || hasRefereeProfile ? (
        <div className="profile-page-navigation">
          {canViewStatSummary || canViewTeamHistory || canViewCommunity ? <nav className="rank-profile-tabs">
            {canViewStatSummary ? <Button as="a" href="#summary" size="sm">종합</Button> : null}
            {canViewTeamHistory ? <Button as="a" href="#history" size="sm" variant="secondary">전적</Button> : null}
            {canViewTeamHistory ? <Button as="a" href="#teams" size="sm" variant="secondary">팀</Button> : null}
            {canViewTeamHistory ? <Button as="a" href="#links" size="sm" variant="secondary">상대</Button> : null}
            {canViewCommunity ? <Button as="a" href="#community" size="sm" variant="secondary">커뮤니티</Button> : null}
          </nav> : null}
          {hasRefereeProfile ? (
            <Button as={Link} size="sm" variant="secondary" className="profile-role-link" to={`/app/referees/${player.id}`}>
              <ShieldCheck size={15} aria-hidden="true" />
              심판 프로필
              <ArrowUpRight size={15} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className={`rank-profile-body-grid${canViewStatSummary || canViewTeamHistory ? " has-team-rail" : ""}${canViewStatSummary ? " has-summary" : ""}`}>
        {canViewStatSummary || canViewTeamHistory ? (
          <aside className="page-stack player-profile-left-rail">
            {canViewTeamHistory ? <Card className="section-card player-profile-teams-card" id="teams">
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
            </Card> : null}
            {canViewStatSummary ? <ProgressionChecklist user={player} matches={app.state.matches} /> : null}
            {canViewTeamHistory ? (
              <div id="links" className="page-stack">
                {renderRelationship("같이 뛴 사람", teammateCounts)}
                {renderRelationship("상대한 사람", opponentCounts)}
              </div>
            ) : null}
          </aside>
        ) : null}

        <div className="page-stack player-profile-main-column">
        <section id="summary" className={`rank-profile-summary${canViewStatSummary ? "" : " is-single"}`}>
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
            <div className="recent-result-strip" aria-label="최근 경기 결과">
              {recentOutcomes.map((outcome, index) => (
                <span key={`${outcome}-${index}`} className={`recent-result-pill result-${outcome === "win" ? "w" : outcome === "loss" ? "l" : "d"}`}>
                  {outcome === "win" ? "W" : outcome === "loss" ? "L" : "D"}
                </span>
              ))}
            </div>
          </Card>
          {canViewStatSummary ? (
            <ProfileRecordSummaryCard
              records={recentProfileRecords}
              playerId={player.id}
              personalSummary={personalSummary}
              recordFolder={recordFolder}
              setRecordFolder={setRecordFolder}
              officialSection={officialSection}
              setOfficialSection={setOfficialSection}
              personalVisibilityFilter={isOwnProfile ? personalVisibilityFilter : "public"}
              setPersonalVisibilityFilter={setPersonalVisibilityFilter}
              modeFilter={modeFilter}
              setModeFilter={setModeFilter}
              showPersonalVisibilityFilter={isOwnProfile}
            />
          ) : null}
        </section>

        <div className="page-stack player-profile-detail-content">
          {canViewCommunity ? <PlayerCommunityActivity key={player.id} app={app} player={player} isOwnProfile={isOwnProfile} /> : null}
          {placementComplete ? <section className="mode-grid">
            {Object.entries(player.ratings.modes).map(([mode, mmr]) => (
              <RatingCard key={mode} title={mode} mmr={mmr} ratings={player.ratings} mode={mode} />
            ))}
          </section> : null}

          {canViewTeamHistory ? (
            <Card id="history" className="section-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Player History</p>
                  <h2>누구와 뛰었는지</h2>
                </div>
                <Badge tone="green">{history.length + archivedPublicHistory.length}경기</Badge>
              </div>
              <div className="recent-match-list">
                {history.map((match) => {
                  const sideName = getActualMatchPlayerSideName(match, player.id);
                  const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
                  const side = match[sideName] ?? { name: sideName === "teamA" ? "A" : "B", teamId: "" };
                  const opponent = match[oppositeSide] ?? { name: oppositeSide === "teamA" ? "A" : "B", teamId: "" };
                  const outcome = getPlayerOutcome(match, player.id);
                  return (
                    <RecentMatchRow
                      key={match.id}
                      record={match}
                      result={outcome ?? "neutral"}
                      side={side}
                      opponent={opponent}
                      score={getSideScore(match, sideName)}
                      opponentScore={getSideScore(match, oppositeSide)}
                      teams={app.state.teams}
                      to={`/app/matches?match=${match.id}`}
                      onOpen={() => setSelectedMatchId(match.id)}
                      afterCourt={outcome === null ? (
                        <span className="match-record-meta__label match-record-meta__label--private">
                          · {historyStatusLabel[match.status] ?? "상태 확인 중"}
                        </span>
                      ) : null}
                    />
                  );
                })}
                {archivedPublicHistory.map((record) => (
                  <RecentMatchRow
                    key={record.matchId}
                    record={record}
                    result={record.result}
                    side={{ name: record.teamName }}
                    opponent={{ name: record.opponentTeamName }}
                    score={record.score}
                    opponentScore={record.opponentScore}
                  />
                ))}
                {!history.length && !archivedPublicHistory.length
                  ? <div className="ui-empty-state-compact">공개 경기 기록이 아직 없습니다.</div>
                  : null}
                {profileRecordArchive?.error ? (
                  <div className="ui-empty-state-compact">
                    공개 경기 기록을 불러오지 못했습니다.
                    <Button type="button" size="sm" variant="secondary" onClick={() => loadPublicProfileRecords?.(player.id, { force: true })}>다시 시도</Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
        </div>
      </div>
      <MatchRoomModal app={app} matchId={selectedMatchId} entryPoint="player-history" onClose={() => setSelectedMatchId("")} />
    </div>
  );
}
