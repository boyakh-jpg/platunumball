import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ClipboardCheck, Handshake, PlusCircle, ShieldAlert, Swords, Trophy, UserPlus } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import MatchCard from "../components/match/MatchCard.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import TierEmblem from "../components/rating/TierEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { COURTS } from "../lib/constants.js";
import { getCourtHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { getAllowedStatFields, getMatchRecordWindow, getMatchReservePlayerIds, getMatchRoomPhase, getPlayerSideName, getPlayerStatSubmitted, getPublicRoomTimingStatus, isInstantRoom } from "../lib/matchUtils.js";
import { RECRUITING_TYPES, getPendingRecruitingInvitations, getRecruitingLobby, getRecruitingRoomOwnerId, isNationalRecruitingPost, isRecruitingPostForUser } from "../lib/recruiting.js";
import { getCurrentSeason, getPlayerSeasonRows, getSeasonProgress } from "../lib/season.js";
import { getTierDivision } from "../lib/tier.js";

function compareSchedule(a, b) {
  const instantDiff = Number(isInstantRoom(b)) - Number(isInstantRoom(a));
  if (instantDiff) return instantDiff;
  return String(a.scheduledAt ?? "").localeCompare(String(b.scheduledAt ?? ""));
}

function matchHasUser(match, userId) {
  return Boolean(getUserParticipantSide(match, userId));
}

function getUserResult(match, userId) {
  const sideName = getUserParticipantSide(match, userId) ?? "teamA";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  const sideScore = Number((sideName === "teamA" ? match.result?.scoreA : match.result?.scoreB) ?? match[sideName].score ?? 0);
  const otherScore = Number((otherSide === "teamA" ? match.result?.scoreA : match.result?.scoreB) ?? match[otherSide].score ?? 0);
  if (sideScore === otherScore) return "D";
  return sideScore > otherScore ? "W" : "L";
}

function getUserSide(match, userId) {
  return getPlayerSideName(match, userId);
}

function getUserParticipantSide(match, userId) {
  const sideName = getPlayerSideName(match, userId);
  if (sideName) return sideName;
  if (getMatchReservePlayerIds(match, "teamA").includes(userId)) return "teamA";
  if (getMatchReservePlayerIds(match, "teamB").includes(userId)) return "teamB";
  return null;
}

function userNeedsAgreement(match, userId) {
  const sideName = getUserSide(match, userId);
  return Boolean(sideName && match.status === "contract" && !(match.agreements?.[sideName] ?? []).includes(userId));
}

function userNeedsApproval(match, userId) {
  const sideName = getUserSide(match, userId);
  if (getMatchRoomPhase(match).phase === "record") return false;
  return Boolean(sideName && ["approval", "disputed"].includes(match.status) && !(match.approvals?.[sideName] ?? []).includes(userId));
}

function userNeedsResultInput(match, userId) {
  if (!["agreed", "approval", "disputed"].includes(match.status) || !matchHasUser(match, userId)) return false;
  if (getPlayerStatSubmitted(match, userId)) return false;
  const recordWindow = getMatchRecordWindow(match);
  if (!recordWindow.statOpen) return false;
  const playerIds = [...(match.teamA?.players ?? []), ...(match.teamB?.players ?? [])];
  return playerIds.some((playerId) => getAllowedStatFields(match, userId, playerId).length > 0);
}

function getRecruitingSchedule(post) {
  if (isInstantRoom(post)) return "즉시";
  return [post.scheduledDate, post.scheduledTime].filter(Boolean).join(" ") || post.scheduledAt || "일정 미정";
}

function getSideScore(match, sideName) {
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return Number(match.result?.[resultKey] ?? match[sideName].score ?? 0);
}

function getUserMatchLine(match, userId) {
  const sideName = getUserParticipantSide(match, userId) ?? "teamA";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  return {
    side: match[sideName],
    opponent: match[otherSide],
    score: getSideScore(match, sideName),
    opponentScore: getSideScore(match, otherSide),
    result: getUserResult(match, userId),
  };
}

const SEARCH_PREVIEW_LIMIT = 5;
const SEARCH_DETAIL_LIMIT = 20;

export default function Home({ app }) {
  const user = app.currentUser;
  const [query, setQuery] = useState("");
  const searchText = query.trim().toLowerCase();
  const approvalMatches = [...app.state.matches].filter((match) => userNeedsApproval(match, user.id));
  const upcomingMatches = [...app.state.matches]
    .filter((match) => ["locked", "checkin"].includes(getMatchRoomPhase(match).phase) && matchHasUser(match, user.id))
    .sort(compareSchedule);
  const completedMatches = [...app.state.matches].filter((match) => match.status === "confirmed");
  const myTeam = app.state.teams.find((team) => team.members.some((member) => member.userId === user.id));
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const myTeams = app.state.teams
    .filter((team) => team.members.some((member) => member.userId === user.id))
    .map((team) => ({ ...team, myRole: team.members.find((member) => member.userId === user.id)?.role ?? "regular" }))
    .sort((a, b) => Number(b.myRole === "captain") - Number(a.myRole === "captain") || b.mmr - a.mmr);
  const captainTeamIds = useMemo(() => myTeams.filter((team) => team.myRole === "captain").map((team) => team.id), [myTeams]);
  const myTeamIds = useMemo(() => myTeams.map((team) => team.id), [myTeams]);
  const pendingInvitations = useMemo(() => getPendingRecruitingInvitations(app.state, user.id), [app.state, user.id]);
  const myTeamCount = app.state.teams.filter((team) => team.members.some((member) => member.userId === user.id)).length;
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
  const season = getCurrentSeason(app.state);
  const seasonProgress = getSeasonProgress(season);
  const seasonRows = getPlayerSeasonRows(app.state.users, app.state.matches, season, user.region);
  const mySeasonIndex = seasonRows.findIndex((row) => row.id === user.id);
  const mySeasonRow = mySeasonIndex >= 0 ? seasonRows[mySeasonIndex] : null;
  const localRivals = useMemo(() => {
    const regionTeams = app.state.teams
      .filter((team) => team.region === user.region)
      .sort((a, b) => b.mmr - a.mmr);
    const referenceMmr = myTeam?.mmr ?? regionTeams[0]?.mmr ?? user.ratings.integrated;
    return regionTeams
      .filter((team) => team.id !== myTeam?.id)
      .slice(0, 4)
      .map((team) => ({ ...team, gap: team.mmr - referenceMmr }));
  }, [app.state.teams, myTeam?.id, myTeam?.mmr, user.ratings.integrated, user.region]);
  const localRecruitingPosts = useMemo(() => {
    return [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status === "open")
      .filter((post) => post.region === user.region || isNationalRecruitingPost(post, app.state))
      .slice(0, 3);
  }, [app.state, app.state.recruitingPosts, user.region]);
  const myCompletedMatches = completedMatches.filter((match) => matchHasUser(match, user.id));
  const myWins = myCompletedMatches.filter((match) => getUserResult(match, user.id) === "W").length;
  const winRate = myCompletedMatches.length ? Math.round((myWins / myCompletedMatches.length) * 100) : 0;
  const actionItems = useMemo(() => {
    const tournamentInviteItems = (app.state.tournaments ?? [])
      .filter((tournament) => tournament.status === "draft")
      .flatMap((tournament) => captainTeamIds
        .filter((teamId) => (tournament.teamIds ?? []).includes(teamId))
        .filter((teamId) => (tournament.teamStatuses?.[teamId] ?? "invited") !== "accepted")
        .map((teamId) => ({
          id: `tournament-${tournament.id}-${teamId}`,
          priority: 0,
          label: "대회 초대",
          title: tournament.title,
          meta: `${teamById[teamId]?.name ?? "내 팀"} · ${tournament.format === "tournament" ? "토너먼트" : "리그"} 승인 필요`,
          href: `/app/tournaments/${tournament.id}`,
          icon: Trophy,
        })));
    const matchItems = app.state.matches
      .filter((match) => matchHasUser(match, user.id))
      .map((match) => {
        const phase = getMatchRoomPhase(match).phase;
        if (userNeedsAgreement(match, user.id)) {
          return {
            id: `agreement-${match.id}`,
            priority: 1,
            label: "동의",
            title: match.title,
            meta: `${match.scheduledAt} · ${match.court}`,
            href: `/app/matches?match=${match.id}`,
            icon: Handshake,
          };
        }
        if (phase === "checkin" && match.createdBy === user.id) {
          return {
            id: `checkin-${match.id}`,
            priority: 2,
            label: "경기 시작",
            title: match.title,
            meta: `${match.scheduledAt} · ${match.court}`,
            href: `/app/matches?match=${match.id}`,
            icon: Swords,
          };
        }
        if (phase === "postgame" && userNeedsResultInput(match, user.id)) {
          return {
            id: `result-${match.id}`,
            priority: 3,
            label: "결과 입력",
            title: match.title,
            meta: `${match.scheduledAt} · ${match.court}`,
            href: `/app/matches?match=${match.id}`,
            icon: CalendarDays,
          };
        }
        if (phase === "dispute" && userNeedsApproval(match, user.id)) {
          return {
            id: `approval-${match.id}`,
            priority: 4,
            label: match.status === "disputed" ? "이의 확인" : "결과 승인",
            title: match.title,
            meta: `${match.scheduledAt} · ${match.court}`,
            href: `/app/matches?match=${match.id}`,
            icon: ShieldAlert,
          };
        }
        return null;
      })
      .filter(Boolean);
    const readyRoomItems = (app.state.recruitingPosts ?? [])
      .filter((post) => post.status === "open" && getRecruitingRoomOwnerId(post) !== user.id)
      .map((post) => ({ post, lobby: getRecruitingLobby(post, app.state) }))
      .map(({ post, lobby }) => ({
        post,
        entry: (lobby.entries ?? []).find((entry) => (
          (entry.players ?? []).includes(user.id) ||
          (entry.reserves ?? []).includes(user.id)
        )),
      }))
      .filter(({ entry }) => entry && entry.status !== "ready")
      .map(({ post }) => ({
        id: `ready-room-${post.id}`,
        priority: 1,
        label: "수락",
        title: post.title,
        meta: `${getRecruitingSchedule(post)} · ${post.court}`,
        href: `/app/recruiting?post=${post.id}`,
        icon: ClipboardCheck,
      }));
    const confirmableRoomItems = (app.state.recruitingPosts ?? [])
      .filter((post) => post.status === "open" && getRecruitingRoomOwnerId(post) === user.id)
      .map((post) => ({ post, lobby: getRecruitingLobby(post, app.state), timing: getPublicRoomTimingStatus(post) }))
      .filter(({ lobby, timing }) => lobby.canConfirm && timing.canConfirm)
      .map(({ post }) => ({
        id: `confirm-room-${post.id}`,
        priority: 1,
        label: "경기 확정",
        title: post.title,
        meta: `${getRecruitingSchedule(post)} · ${post.court}`,
        href: `/app/recruiting?post=${post.id}`,
        icon: Swords,
      }));

    const invitationItems = pendingInvitations.map(({ post, invitation }) => ({
      id: `invite-${post.id}-${invitation.id}`,
      priority: 0,
      label: "방 초대",
      title: post.title,
      meta: `${getRecruitingSchedule(post)} · ${post.court}`,
      href: `/app/recruiting?filter=invited&post=${post.id}`,
      icon: UserPlus,
    }));
    const cancelledRoomItems = (app.state.recruitingPosts ?? [])
      .filter((post) => post.status === "cancelled")
      .filter((post) => isRecruitingPostForUser(post, user.id, myTeamIds))
      .sort((a, b) => String(b.cancelledAt ?? b.createdAt ?? "").localeCompare(String(a.cancelledAt ?? a.createdAt ?? "")))
      .slice(0, 2)
      .map((post) => ({
        id: `cancelled-room-${post.id}`,
        priority: 5,
        label: "방 취소",
        title: post.title,
        meta: `${getRecruitingSchedule(post)} · ${post.court}`,
        href: `/app/recruiting?post=${post.id}`,
        icon: ShieldAlert,
      }));

    return [...invitationItems, ...tournamentInviteItems, ...readyRoomItems, ...confirmableRoomItems, ...matchItems, ...cancelledRoomItems]
      .sort((a, b) => a.priority - b.priority || String(a.meta).localeCompare(String(b.meta)));
  }, [app.state, app.state.matches, app.state.recruitingPosts, app.state.tournaments, captainTeamIds, myTeamIds, pendingInvitations, teamById, user.id]);
  const priorityItems = actionItems.slice(0, 5);

  const searchResults = useMemo(() => {
    if (!searchText) return [];

    const players = app.state.users
      .filter((item) => !blockedUserIds.includes(item.id))
      .map((item) => {
        const hashtag = getUserHashtag(item);
        return {
          id: `player-${item.id}`,
          label: item.name,
          kind: "PLAYER",
          meta: `${item.region} · ${item.position} · ${item.ratings.integrated}`,
          href: `/app/players/${item.id}`,
          score: Number(hashtag.toLowerCase() === searchText) * 100000 + Number(item.region === user.region) * 10000 + item.ratings.integrated,
          haystack: `${item.name} ${item.handle} ${hashtag} ${item.region} ${item.position} ${item.club}`,
          avatar: item.avatarColor,
          hashtag,
        };
      });
    const teams = app.state.teams.map((team) => {
      const hashtag = getTeamHashtag(team);
      return {
        id: `team-${team.id}`,
        label: team.name,
        kind: "TEAM",
        meta: `${team.region} · ${team.homeCourt} · ${team.mmr}`,
        href: `/app/teams/${team.id}`,
        team,
        score: Number(hashtag.toLowerCase() === searchText) * 100000 + Number(team.region === user.region) * 10000 + team.mmr,
        haystack: `${team.name} ${team.handle ?? ""} ${hashtag} ${team.region} ${team.homeCourt}`,
        teamColor: team.accent,
        hashtag,
      };
    });
    const courts = COURTS.map((court) => {
      const hashtag = getCourtHashtag(court);
      return {
        id: `court-${court.id}`,
        label: court.name,
        kind: "COURT",
        meta: `${court.region} · ${court.type}`,
        href: "/app/create",
        score: Number(hashtag.toLowerCase() === searchText) * 100000 + Number(court.region === user.region) * 10000 + Number(court.favorite) * 1000,
        haystack: `${court.name} ${hashtag} ${court.region} ${court.type}`,
        court: true,
        hashtag,
      };
    });

    return [...players, ...teams, ...courts]
      .filter((item) => {
        const itemHashtag = item.hashtag.toLowerCase();
        if (/^#\d+$/.test(searchText)) return itemHashtag === searchText;
        if (searchText.startsWith("#")) return itemHashtag.includes(searchText);
        return item.haystack.toLowerCase().includes(searchText);
      })
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  }, [app.state.teams, app.state.users, blockedUserIds, searchText, user.region]);
  const topRankers = seasonRows.slice(0, 5);
  const latestMyMatches = myCompletedMatches.slice(0, 5);
  const renderHomeSearchItem = (item) => (
    item.team ? (
      <TeamHoverCard key={item.id} team={item.team}>
        {item.teamColor ? <span className="team-mini-dot" style={{ "--team-color": item.teamColor }} /> : null}
        <span className="rank-result-main">
          <strong>{item.label}</strong>
          <em>{item.meta}</em>
        </span>
        <small>{item.kind} · {item.hashtag}</small>
      </TeamHoverCard>
    ) : (
      <Link key={item.id} to={item.href}>
        {item.avatar ? <span className="avatar small" style={{ "--avatar": item.avatar }}>{item.label.slice(0, 1)}</span> : null}
        {item.court ? <span className="court-mini-dot" /> : null}
        <span className="rank-result-main">
          <strong>{item.label}</strong>
          <em>{item.meta}</em>
        </span>
        <small>{item.kind} · {item.hashtag}</small>
      </Link>
    )
  );

  return (
    <div className="page-stack rank-home">
      <Card className="home-search-panel rank-search-card">
        <SearchPicker
          value={query}
          onChange={setQuery}
          placeholder="이름, 팀명, 코트명, 해시태그를 바로 검색"
          items={searchResults}
          renderItem={renderHomeSearchItem}
          limit={SEARCH_PREVIEW_LIMIT}
          detailLimit={SEARCH_DETAIL_LIMIT}
          fieldClassName="home-search-box"
        />
        <div className="rank-quick-links">
          <Link to="/app/rankings">랭킹</Link>
          <Link to="/app/matches">경기</Link>
          <Link to="/app/teams">팀</Link>
          <Link to="/app/recruiting">매칭</Link>
        </div>
      </Card>

      {actionItems.length ? (
        <Card className="section-card home-action-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Action Queue</p>
              <h2>내가 처리할 방</h2>
            </div>
            <Badge tone="orange">{actionItems.length}개</Badge>
          </div>
          <div className="home-action-list">
            {priorityItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.id} to={item.href} className={`home-action-row priority-${item.priority}`}>
                  <span className="home-action-icon"><Icon size={18} /></span>
                  <span className="home-action-main">
                    <strong>{item.title}</strong>
                    <em>{item.meta}</em>
                  </span>
                  <b>{item.label}</b>
                </Link>
              );
            })}
            {actionItems.length > priorityItems.length ? (
              <Link to={actionItems[priorityItems.length]?.href ?? "/app/matches"} className="home-action-row priority-5">
                <span className="home-action-icon"><ClipboardCheck size={18} /></span>
                <span className="home-action-main">
                  <strong>더 처리할 항목 있음</strong>
                  <em>{actionItems.length - priorityItems.length}개 더 있음</em>
                </span>
                <b>더보기</b>
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      <section className="rank-summary-grid">
        <div className="home-rank-board-head">
          <div className="rank-hero-top">
            <div>
              <p className="eyebrow">내 랭크 보드</p>
              <h1>{user.name}님의 오늘 코트 현황</h1>
              <p>{user.region} · {user.position} · 통합 {getTierDivision(user.ratings.integrated)} · {Math.round(user.ratings.integrated)} MMR</p>
            </div>
            <Link to="/app/create">
              <Button><PlusCircle size={18} /> 경기 만들기</Button>
            </Link>
          </div>
        </div>
        <Card className="section-card rank-profile-card">
          <div className="rank-profile-head">
            <div className="avatar hero-avatar" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</div>
            <div>
              <p className="eyebrow">내 프로필</p>
              <h2>{user.name}</h2>
              <span>{user.region} · {user.position} · 신뢰도 {user.trustScore}</span>
            </div>
          </div>
          <div className="rank-tier-block">
            <TierEmblem mmr={user.ratings.integrated} size="md" />
            <div>
              <strong>{getTierDivision(user.ratings.integrated)}</strong>
              <span>{Math.round(user.ratings.integrated)} MMR</span>
            </div>
          </div>
          <div className="rank-tier-meta-line">
            <Badge tone="gold">{Math.round(user.ratings.integrated)} MMR</Badge>
            <Badge tone="green">시즌 점수</Badge>
          </div>
          <p className="rank-tier-copy">팀 기여도가 안정적인 플레이어입니다.</p>
          <p className="rank-tier-note">{user.streak > 0 ? `${user.streak}연승 중. 다음 공식전이 티어를 흔듭니다.` : "꾸준히 경기에 참여하는 플레이어입니다."}</p>
          <div className="rank-stat-grid">
            <span><strong>{myCompletedMatches.length}</strong>경기</span>
            <span><strong>{winRate}%</strong>승률</span>
            <span><strong>{mySeasonIndex >= 0 ? `${mySeasonIndex + 1}위` : "-"}</strong>{user.region}</span>
            <span><strong>{user.streak > 0 ? `${user.streak}연승` : user.streak < 0 ? `${Math.abs(user.streak)}연패` : "0"}</strong>흐름</span>
          </div>
          <div className="rank-profile-tabs">
            <Link to={`/app/players/${user.id}`}>프로필</Link>
            <Link to="/app/season">시즌</Link>
            <Link to="/app/settings">설정</Link>
          </div>
        </Card>

        <Card className="section-card rank-mode-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Queue Rating</p>
              <h2>모드별 티어</h2>
            </div>
            <Badge tone="gold">{Math.round(user.ratings.integrated)}</Badge>
          </div>
          <div className="mode-grid rank-mode-grid">
            {Object.entries(user.ratings.modes).map(([mode, mmr]) => (
              <div key={mode} className="rank-mode-pill">
                <TierEmblem mmr={mmr} size="sm" />
                <div>
                  <span>{mode}</span>
                  <strong>{getTierDivision(mmr)}</strong>
                  <em>{Math.round(mmr)} MMR</em>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <div className="content-grid home-dashboard-grid rank-dashboard-grid">
        <div className="page-stack home-primary-stack">
          <Card className="section-card match-focus-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Upcoming</p>
                <h2>진행 예정 경기</h2>
              </div>
              <Badge tone={upcomingMatches.length ? "orange" : "neutral"}>{upcomingMatches.length}개</Badge>
            </div>
            {upcomingMatches.length ? (
              <div className="match-stack">
                {upcomingMatches.slice(0, 3).map((match) => <MatchCard key={match.id} match={match} teams={app.state.teams} />)}
              </div>
            ) : (
              <div className="empty-state">예정 경기 없음</div>
            )}
          </Card>

          <Card className="section-card home-recent-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Recent Matches</p>
                <h2>내 최근 전적</h2>
              </div>
              <Badge tone="green">{myCompletedMatches.length}경기</Badge>
            </div>
            <div className="recent-result-strip">
              {myCompletedMatches.slice(0, 8).map((match) => {
                const result = getUserResult(match, user.id);
                return (
                  <Link key={match.id} to={`/app/matches?match=${match.id}`} className={`recent-result-pill result-${result.toLowerCase()}`}>
                    {result}
                  </Link>
                );
              })}
            </div>
            <div className="recent-match-list">
              {latestMyMatches.map((match) => (
                <Link key={match.id} to={`/app/matches?match=${match.id}`} className={`recent-match-row result-${getUserResult(match, user.id).toLowerCase()}`}>
                  {(() => {
                    const line = getUserMatchLine(match, user.id);
                    return (
                      <>
                        <b>{line.result}</b>
                        <span>
                          <TeamHoverCard team={teamById[line.side.teamId]} as="span"><strong>{line.side.name}</strong></TeamHoverCard>
                          <em>vs <TeamHoverCard team={teamById[line.opponent.teamId]} as="span">{line.opponent.name}</TeamHoverCard> · {match.court}</em>
                        </span>
                        <i>{line.score}:{line.opponentScore}</i>
                      </>
                    );
                  })()}
                </Link>
              ))}
            </div>
          </Card>
        </div>
        <aside className="page-stack home-side-stack">
          <Card className="section-card rank-leaderboard-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Local Ranking</p>
                <h2>{user.region} 랭킹</h2>
              </div>
              <Trophy size={20} />
            </div>
            <div className="rank-list">
              {topRankers.map((row, index) => (
                <PlayerHoverCard className="rank-row" key={row.id} user={row} teams={app.state.teams}>
                  <b>{index + 1}</b>
                  <span className="avatar small" style={{ "--avatar": row.avatarColor }}>{row.name.slice(0, 1)}</span>
                  <strong>{row.name}</strong>
                  <em>{Math.round(row.seasonScore)}점</em>
                </PlayerHoverCard>
              ))}
            </div>
          </Card>

          <Card className="section-card season-mini-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Season Race</p>
                <h2>{user.region} 시즌 레이스</h2>
              </div>
              <Trophy size={20} />
            </div>
            <div className="season-progress">
              <span style={{ width: `${seasonProgress}%` }} />
            </div>
            <div className="contract-grid single">
              <div>
                <span>내 지역 순위</span>
                <strong>{mySeasonIndex >= 0 ? `${mySeasonIndex + 1}위` : "대기"}</strong>
              </div>
              <div>
                <span>시즌 전적</span>
                <strong>{mySeasonRow ? `${mySeasonRow.seasonWins}승 ${mySeasonRow.seasonLosses}패` : "0승 0패"}</strong>
              </div>
            </div>
            <Link to="/app/season">
              <Button variant="secondary" className="wide-button"><Trophy size={17} /> 시즌 허브</Button>
            </Link>
          </Card>
          <Card className="section-card rivalry-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Local Rivalry</p>
                <h2>{user.region} 라이벌</h2>
              </div>
              <Swords size={20} />
            </div>
            <div className="compact-list rivalry-list">
              {localRivals.length ? localRivals.map((team) => (
                <TeamHoverCard key={team.id} team={team}>
                  <span>{team.name}</span>
                  <strong>{team.gap > 0 ? `+${team.gap}` : team.gap} MMR</strong>
                </TeamHoverCard>
              )) : <div><span>지역 라이벌 없음</span><strong>대기</strong></div>}
            </div>
          </Card>
          <Card className="section-card recruiting-teaser-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Recruiting</p>
                <h2>친선전/정규전 큐</h2>
              </div>
              <Handshake size={20} />
            </div>
            <div className="compact-list recruiting-mini-list">
              {localRecruitingPosts.map((post) => {
                const meta = RECRUITING_TYPES[post.type] ?? RECRUITING_TYPES.need_player;
                return (
                  <Link key={post.id} to={`/app/recruiting?post=${post.id}`}>
                    <span>{post.title}</span>
                    <strong>{post.ranked === false ? "친선" : meta.actionLabel}</strong>
                  </Link>
                );
              })}
            </div>
            <Link to="/app/recruiting">
              <Button variant="secondary" className="wide-button"><Handshake size={17} /> 큐 보기</Button>
            </Link>
          </Card>
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Approval</p>
                <h2>승인 대기 경기</h2>
              </div>
              <Badge tone={approvalMatches.length ? "orange" : "neutral"}>{approvalMatches.length}개</Badge>
            </div>
            <div className="compact-list">
              {approvalMatches.length ? approvalMatches.slice(0, 4).map((match) => (
                <Link key={match.id} to={`/app/matches?match=${match.id}`}>
                  <span>{match.title}</span>
                  <strong>{(match.approvals?.teamA?.length ?? 0) + (match.approvals?.teamB?.length ?? 0)}명 승인</strong>
                </Link>
              )) : <div><span>승인 대기 없음</span><strong>OK</strong></div>}
            </div>
          </Card>
          <Card className="section-card home-my-teams-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">My Teams</p>
                <h2>내 소속 팀</h2>
              </div>
              <Badge tone={myTeamCount ? "green" : "neutral"}>{myTeamCount}/5</Badge>
            </div>
            <div className="home-team-list">
              {myTeams.length ? myTeams.slice(0, 5).map((team) => (
                <TeamHoverCard key={team.id} team={team}>
                  <span className="team-mini-dot" style={{ "--team-color": team.accent }} />
                  <strong>{team.name}</strong>
                  <em>{team.myRole === "captain" ? "주장" : ["candidate", "substitute", "regular"].includes(team.myRole) ? "팀원" : team.myRole === "mercenary" ? "용병" : "게스트"}</em>
                  <b>{team.mmr}</b>
                </TeamHoverCard>
              )) : <div><span>팀 없음</span><strong>팀 찾기 필요</strong></div>}
            </div>
            <Link to="/app/teams">
              <Button variant="secondary" className="wide-button">팀 전체 보기</Button>
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
