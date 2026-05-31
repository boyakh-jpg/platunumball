import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Handshake, PlusCircle, Search, Swords, Trophy } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import MatchCard from "../components/match/MatchCard.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import TierEmblem from "../components/rating/TierEmblem.jsx";
import TeamCard from "../components/team/TeamCard.jsx";
import { COURTS } from "../lib/constants.js";
import { isNationalRecruitingPost } from "../lib/recruiting.js";
import { getTierDivision, getTierQuote } from "../lib/tier.js";

function compareSchedule(a, b) {
  return String(a.scheduledAt ?? "").localeCompare(String(b.scheduledAt ?? ""));
}

function matchHasUser(match, userId) {
  return match.teamA.players.includes(userId) || match.teamB.players.includes(userId);
}

function getUserResult(match, userId) {
  const sideName = match.teamA.players.includes(userId) ? "teamA" : "teamB";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  const sideScore = Number(match[sideName].score ?? match.result?.scoreA ?? 0);
  const otherScore = Number(match[otherSide].score ?? match.result?.scoreB ?? 0);
  if (sideScore === otherScore) return "D";
  return sideScore > otherScore ? "W" : "L";
}

function getUserDelta(match, userId) {
  const change = match.ratingResult?.find((item) => item.playerId === userId);
  return Math.round(change?.integratedDelta ?? 0);
}

function FormTrendChart({ matches, userId }) {
  const recent = matches.filter((match) => matchHasUser(match, userId)).slice(0, 8).reverse();
  const values = recent.map((match) => getUserDelta(match, userId));
  const maxAbs = Math.max(8, ...values.map((value) => Math.abs(value)));
  const points = values.map((value, index) => {
    const x = 18 + index * (recent.length > 1 ? 264 / (recent.length - 1) : 0);
    const y = 82 - (value / maxAbs) * 48;
    return `${x},${y}`;
  });

  return (
    <div className="form-trend-chart">
      <svg viewBox="0 0 300 128" role="img" aria-label="최근 전적 흐름 그래프">
        <path d="M18 82H282" className="trend-axis" />
        {points.length > 1 ? <polyline points={points.join(" ")} className="trend-line" /> : null}
        {points.map((point, index) => {
          const [x, y] = point.split(",");
          const result = getUserResult(recent[index], userId);
          return <circle key={`${point}-${index}`} cx={x} cy={y} r="5" className={`trend-dot trend-dot-${result.toLowerCase()}`} />;
        })}
      </svg>
      <div className="form-pill-row">
        {recent.map((match) => {
          const result = getUserResult(match, userId);
          return (
            <Link key={match.id} to={`/app/matches/${match.id}`} className={`form-pill form-pill-${result.toLowerCase()}`}>
              {result}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function Home({ app }) {
  const user = app.currentUser;
  const [query, setQuery] = useState("");
  const searchText = query.trim().toLowerCase();
  const approvalMatches = [...app.state.matches].filter((match) => match.status === "approval");
  const upcomingMatches = [...app.state.matches].filter((match) => ["contract", "agreed"].includes(match.status)).sort(compareSchedule);
  const completedMatches = [...app.state.matches].filter((match) => match.status === "confirmed");
  const myTeam = app.state.teams.find((team) => team.members.some((member) => member.userId === user.id));
  const myTeamCount = app.state.teams.filter((team) => team.members.some((member) => member.userId === user.id)).length;
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
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
      .filter((post) => post.status !== "closed")
      .filter((post) => post.region === user.region || isNationalRecruitingPost(post, app.state))
      .slice(0, 3);
  }, [app.state, app.state.recruitingPosts, user.region]);

  const searchResults = useMemo(() => {
    const players = app.state.users
      .filter((item) => !blockedUserIds.includes(item.id))
      .map((item) => ({
        id: `player-${item.id}`,
        label: item.name,
        meta: `${item.region} · ${item.position} · ${item.ratings.integrated}`,
        href: `/app/players/${item.id}`,
        score: Number(item.region === user.region) * 10000 + item.ratings.integrated,
        haystack: `${item.name} ${item.handle} ${item.region} ${item.position} ${item.club}`,
        avatar: item.avatarColor,
      }));
    const teams = app.state.teams.map((team) => ({
      id: `team-${team.id}`,
      label: team.name,
      meta: `${team.region} · ${team.homeCourt} · ${team.mmr}`,
      href: `/app/teams/${team.id}`,
      score: Number(team.region === user.region) * 10000 + team.mmr,
      haystack: `${team.name} ${team.region} ${team.homeCourt}`,
      teamColor: team.accent,
    }));
    const courts = COURTS.map((court) => ({
      id: `court-${court.id}`,
      label: court.name,
      meta: `${court.region} · ${court.type}`,
      href: "/app/create",
      score: Number(court.region === user.region) * 10000 + Number(court.favorite) * 1000,
      haystack: `${court.name} ${court.region} ${court.type}`,
      court: true,
    }));

    return [...players, ...teams, ...courts]
      .filter((item) => (searchText ? item.haystack.toLowerCase().includes(searchText) : item.score >= 10000))
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, searchText ? 8 : 5);
  }, [app.state.teams, app.state.users, blockedUserIds, searchText, user.region]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">내 랭크 보드</p>
          <h1>{user.name}님의 오늘 코트 현황</h1>
        </div>
        <Link to="/app/create">
          <Button><PlusCircle size={18} /> 경기 만들기</Button>
        </Link>
      </header>

      <section className="court-command">
        <div className="court-command-copy">
          <BadgeLine icon={Trophy} text="Rank profile" />
          <div className="tier-crest-lockup">
            <TierEmblem mmr={user.ratings.integrated} size="hero" showLabel />
            <div>
              <strong>{user.ratings.integrated}</strong>
              <h2>{user.name} · 통합 티어</h2>
              <Badge tone="gold">{getTierDivision(user.ratings.integrated)}</Badge>
            </div>
          </div>
          <p className="tier-line">{getTierQuote(user.ratings.integrated)}</p>
          <p>{user.streak > 0 ? `${user.streak}연승 중. 다음 공식전이 티어를 흔듭니다.` : "다음 승리를 준비하는 중입니다."}</p>
        </div>
        <div className="mode-grid">
          {Object.entries(user.ratings.modes).map(([mode, mmr]) => (
            <RatingCard key={mode} title={mode} mmr={mmr} subtitle="모드 티어" />
          ))}
        </div>
      </section>

      <Card className="home-search-panel">
        <div className="home-search-box">
          <Search size={24} />
          <input value={query} placeholder="이름, 팀명, 코트명을 바로 검색" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="home-search-results unified">
          {searchResults.map((item) => (
            <Link key={item.id} to={item.href}>
              {item.avatar ? <span className="avatar small" style={{ "--avatar": item.avatar }}>{item.label.slice(0, 1)}</span> : null}
              {item.teamColor ? <span className="team-mini-dot" style={{ "--team-color": item.teamColor }} /> : null}
              {item.court ? <span className="court-mini-dot" /> : null}
              <strong>{item.label}</strong>
              <em>{item.meta}</em>
            </Link>
          ))}
        </div>
      </Card>

      <div className="content-grid home-dashboard-grid">
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
                {upcomingMatches.slice(0, 3).map((match) => <MatchCard key={match.id} match={match} />)}
              </div>
            ) : (
              <p className="muted">아직 잡힌 경기가 없습니다. 새 경기를 만들면 여기에 먼저 표시됩니다.</p>
            )}
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Recent Form</p>
                <h2>완료 전적 흐름</h2>
              </div>
              <Badge tone="green">{completedMatches.length}경기</Badge>
            </div>
            <FormTrendChart matches={completedMatches} userId={user.id} />
            <div className="compact-list">
              {completedMatches.slice(0, 5).map((match) => (
                <Link key={match.id} to={`/app/matches/${match.id}`}>
                  <span>{match.title}</span>
                  <strong>{match.teamA.score ?? 0}:{match.teamB.score ?? 0}</strong>
                </Link>
              ))}
            </div>
          </Card>
        </div>
        <aside className="page-stack home-side-stack">
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
                <Link key={team.id} to={`/app/teams/${team.id}`}>
                  <span>{team.name}</span>
                  <strong>{team.gap > 0 ? `+${team.gap}` : team.gap} MMR</strong>
                </Link>
              )) : <div><span>같은 지역 팀을 더 등록해보세요.</span><strong>대기</strong></div>}
            </div>
          </Card>
          <Card className="section-card recruiting-teaser-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Recruiting</p>
                <h2>용병/팀 찾기</h2>
              </div>
              <Handshake size={20} />
            </div>
            <div className="compact-list recruiting-mini-list">
              {localRecruitingPosts.map((post) => (
                <Link key={post.id} to="/app/recruiting">
                  <span>{post.title}</span>
                  <strong>{post.ranked === false ? "친선" : "랭크"}</strong>
                </Link>
              ))}
            </div>
            <Link to="/app/recruiting">
              <Button variant="secondary" className="wide-button"><Handshake size={17} /> 모집판 보기</Button>
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
                <Link key={match.id} to={`/app/matches/${match.id}`}>
                  <span>{match.title}</span>
                  <strong>{(match.approvals?.teamA?.length ?? 0) + (match.approvals?.teamB?.length ?? 0)}명 승인</strong>
                </Link>
              )) : <div><span>승인 대기 중인 경기가 없습니다.</span><strong>OK</strong></div>}
            </div>
          </Card>
          <Card className="section-card">
            <div className="contract-grid single">
              <div>
                <span>소속 팀</span>
                <strong>{myTeamCount}/5</strong>
              </div>
              <div>
                <span>지역</span>
                <strong>{user.region}</strong>
              </div>
              <div>
                <span>신뢰도</span>
                <strong>{user.trustScore}</strong>
              </div>
            </div>
          </Card>
          {myTeam ? <TeamCard team={myTeam} users={app.state.users} compact /> : null}
        </aside>
      </div>
    </div>
  );
}

function BadgeLine({ icon: Icon, text }) {
  return (
    <span className="badge-line">
      <Icon size={17} />
      {text}
      <Flame size={17} />
    </span>
  );
}
