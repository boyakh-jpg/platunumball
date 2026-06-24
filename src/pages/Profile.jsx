import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Search, Star, Unlink2 } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProgressionChecklist from "../components/rating/ProgressionChecklist.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import ShareCard from "../components/share/ShareCard.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import {
  DISCORD_NOTIFICATION_EVENTS,
  consumeDiscordOAuthResult,
  findDiscordConnectionOwner,
  getDiscordAvatarClassName,
  getDiscordAvatarStyle,
  getDiscordChannel,
  getDiscordDisplayName,
  getDiscordOAuthStartUrl,
  getDiscordProfileUrl,
  isDiscordLinked,
} from "../lib/discord.js";
import { findTeamByHashtag, findUserByHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { canChangeProfileName, getNextNameChangeDate } from "../lib/profileSetup.js";

function compareRecent(a, b) {
  return String(b.scheduledAt ?? b.createdAt ?? "").localeCompare(String(a.scheduledAt ?? a.createdAt ?? ""));
}

function getUserSide(match, userId) {
  if (match.teamA?.players?.includes(userId)) return "teamA";
  if (match.teamB?.players?.includes(userId)) return "teamB";
  return null;
}

function getSideScore(match, sideName) {
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return Number(match.result?.[resultKey] ?? match[sideName]?.score ?? 0);
}

function getUserResult(match, userId) {
  const sideName = getUserSide(match, userId);
  if (!sideName) return "D";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  const sideScore = getSideScore(match, sideName);
  const otherScore = getSideScore(match, otherSide);
  if (sideScore === otherScore) return "D";
  return sideScore > otherScore ? "W" : "L";
}

function getUserRecordLine(match, userId) {
  const sideName = getUserSide(match, userId) ?? "teamA";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  return {
    side: match[sideName],
    opponent: match[otherSide],
    score: getSideScore(match, sideName),
    opponentScore: getSideScore(match, otherSide),
    result: getUserResult(match, userId),
  };
}

function getAverageFouls(matches = [], userId) {
  const confirmed = matches.filter((match) => match.status === "confirmed" && match.result && getUserSide(match, userId));
  if (!confirmed.length) return 0;
  const total = confirmed.reduce((sum, match) => sum + Number(match.result?.playerStats?.[userId]?.fouls ?? 0), 0);
  return total / confirmed.length;
}

function formatDate(date) {
  if (!date) return "";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function RecentRecordCard({ records, userId }) {
  return (
    <Card className="section-card profile-record-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Record</p>
          <h2>내 기록</h2>
        </div>
        <Link className="button button-secondary button-sm" to="/app/profile/records">기록 더보기</Link>
      </div>
      {records.length ? (
        <div className="recent-match-list">
          {records.map((match) => {
            const line = getUserRecordLine(match, userId);
            return (
              <Link key={match.id} to={`/app/matches?match=${match.id}`} className={`recent-match-row result-${line.result.toLowerCase()}`}>
                <b>{line.result}</b>
                <span>
                  <strong>{line.side.name} vs {line.opponent.name}</strong>
                  <em>{match.scheduledAt} · {match.mode}</em>
                </span>
                <i>{line.score}:{line.opponentScore}</i>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">확정된 경기 기록이 없습니다.</div>
      )}
    </Card>
  );
}

export default function Profile({ app }) {
  const user = app.currentUser;
  const [draft, setDraft] = useState({
    name: user.name,
    position: user.position,
    region: user.region,
    school: user.school,
    company: user.company,
  });
  const [favoriteQuery, setFavoriteQuery] = useState("");
  const [discordLinkError, setDiscordLinkError] = useState("");
  const [profileError, setProfileError] = useState("");
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const submit = (event) => {
    event.preventDefault();
    if (draft.name !== user.name && !canChangeProfileName(user)) {
      setProfileError(`닉네임은 월 1회만 변경할 수 있습니다. 다음 변경 가능일: ${formatDate(getNextNameChangeDate(user))}`);
      return;
    }
    setProfileError("");
    app.actions.updateProfile(draft);
  };
  const myRecords = [...app.state.matches]
    .filter((match) => match.status === "confirmed" && getUserSide(match, user.id))
    .sort(compareRecent)
    .slice(0, 6);
  const favoritePlayerIds = app.state.settings?.favoritePlayerIds ?? [];
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const favoritePlayers = favoritePlayerIds.map((playerId) => app.state.users.find((item) => item.id === playerId)).filter(Boolean);
  const favoriteTeams = favoriteTeamIds.map((teamId) => app.state.teams.find((item) => item.id === teamId)).filter(Boolean);
  const searchedUser = favoriteQuery.trim() ? findUserByHashtag(app.state.users, favoriteQuery) : null;
  const searchedTeam = favoriteQuery.trim() ? findTeamByHashtag(app.state.teams, favoriteQuery) : null;
  const averageFouls = getAverageFouls(app.state.matches, user.id);
  const discordLinked = isDiscordLinked(user);
  const discordChannel = getDiscordChannel(app.state.settings);
  const discordProfileUrl = getDiscordProfileUrl(user);
  const discordDisplayName = getDiscordDisplayName(user);
  const queuedDiscordDeliveries = (app.state.discordNotificationDeliveries ?? [])
    .filter((delivery) => delivery.targetUserId === user.id && delivery.status === "queued");
  const updateDiscordChannel = (patch) => {
    const notificationChannels = app.state.settings?.notificationChannels ?? {};
    app.actions.updateSettings({
      notificationChannels: {
        ...notificationChannels,
        discord: {
          ...discordChannel,
          ...patch,
          events: {
            ...discordChannel.events,
            ...(patch.events ?? {}),
          },
        },
      },
    });
  };
  useEffect(() => {
    const discordOAuthResult = consumeDiscordOAuthResult(user.id);
    if (!discordOAuthResult) return;
    if (discordOAuthResult.status !== "linked") {
      console.warn("Discord link failed.", discordOAuthResult.error);
      setDiscordLinkError("Discord 연동에 실패했습니다.");
      return;
    }
    const targetUserId = discordOAuthResult.appUserId || user.id;
    const linkedOwner = findDiscordConnectionOwner(app.state.users, discordOAuthResult.connection, targetUserId);
    if (linkedOwner) {
      setDiscordLinkError(`이미 ${linkedOwner.name} 프로필에 연결된 Discord입니다.`);
      return;
    }
    setDiscordLinkError("");
    app.actions.updateProfile({ discordConnection: discordOAuthResult.connection }, targetUserId);
    if (targetUserId !== user.id) app.actions.switchUser(targetUserId);
    updateDiscordChannel({ enabled: true });
  }, [user.id]);

  const connectDiscord = () => {
    window.location.assign(getDiscordOAuthStartUrl(user.id));
  };
  const unlinkDiscord = () => {
    app.actions.updateProfile({ discordConnection: null });
    updateDiscordChannel({ enabled: false });
  };
  const toggleDiscordEvent = (eventId) => {
    updateDiscordChannel({
      events: {
        [eventId]: !discordChannel.events[eventId],
      },
    });
  };

  return (
    <div className="page-stack profile-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Profile</p>
          <h1>프로필</h1>
        </div>
        <Link className="button button-secondary" to="/app/signup">가입 정보 설정</Link>
      </header>
      <div className="content-grid profile-overview-grid">
        <div className="page-stack profile-main-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">내 정보</p>
                <h2>{getUserHashtag(user)}</h2>
              </div>
            </div>
            <form className="form-grid" onSubmit={submit}>
              {Object.entries(draft).map(([key, value]) => (
                <label key={key}>
                  {key}
                  <input value={value} onChange={(event) => update({ [key]: event.target.value })} />
                </label>
              ))}
              {profileError ? <p className="form-warning">{profileError}</p> : null}
              <Button type="submit">저장</Button>
            </form>
          </Card>
          <section className="profile-rating-grid">
            <RatingCard className="profile-rating-primary" title="통합" mmr={user.ratings.integrated} subtitle="메인 티어" />
            {Object.entries(user.ratings.modes).map(([mode, mmr]) => (
              <RatingCard className="profile-rating-mode" key={mode} title={mode} mmr={mmr} subtitle="모드 티어" />
            ))}
          </section>
          <RecentRecordCard records={myRecords} userId={user.id} />
        </div>
        <aside className="page-stack profile-side-grid">
          <Card className="section-card discord-link-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Discord</p>
                <h2>디스코드 알림</h2>
              </div>
              {discordLinked ? (
                <a className="discord-link-badge" href={discordProfileUrl} target="_blank" rel="noreferrer">
                  <MessageCircle size={14} /> 연동됨
                </a>
              ) : (
                <MessageCircle size={20} />
              )}
            </div>
            <div className="contract-grid single">
              {discordLinked ? (
                <div className="discord-profile-line">
                  <span className={getDiscordAvatarClassName(user, "avatar small")} style={getDiscordAvatarStyle(user)}>
                    {user.name.slice(0, 1)}
                  </span>
                  <strong>@{discordDisplayName}</strong>
                </div>
              ) : null}
              <div>
                <span>연동 상태</span>
                <strong>{discordLinked ? "연동됨" : "미연동"}</strong>
              </div>
              <div>
                <span>알림 경로</span>
                <strong>{discordLinked && discordChannel.enabled ? "앱 + Discord DM" : "앱 내부"}</strong>
              </div>
              {discordLinked ? (
                <div>
                  <span>DM 큐</span>
                  <strong>{queuedDiscordDeliveries.length}개 대기</strong>
                </div>
              ) : null}
            </div>
            {discordLinkError ? <p className="form-warning">{discordLinkError}</p> : null}
            <div className="settings-toggle-grid">
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(discordLinked && discordChannel.enabled)}
                  disabled={!discordLinked}
                  onChange={(event) => updateDiscordChannel({ enabled: event.target.checked })}
                />
                Discord DM
              </label>
              {DISCORD_NOTIFICATION_EVENTS.map((option) => (
                <label key={option.id}>
                  <input
                    type="checkbox"
                    checked={Boolean(discordChannel.events[option.id])}
                    disabled={!discordLinked || !discordChannel.enabled}
                    onChange={() => toggleDiscordEvent(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <div className="settings-address-actions">
              {discordLinked ? (
                <Button type="button" variant="secondary" size="sm" onClick={unlinkDiscord}>
                  <Unlink2 size={15} /> 연동 해제
                </Button>
              ) : (
                <Button type="button" variant="secondary" size="sm" onClick={connectDiscord}>
                  Discord 연동
                </Button>
              )}
              <Badge tone={discordLinked && discordChannel.enabled ? "green" : "neutral"}>
                {discordLinked && discordChannel.enabled ? "DM ON" : "앱 알림"}
              </Badge>
            </div>
          </Card>
          <Card className="section-card favorite-management-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Favorites</p>
                <h2>즐겨찾기</h2>
              </div>
              <Star size={20} />
            </div>
            <div className="favorite-search-row">
              <Search size={17} />
              <input value={favoriteQuery} placeholder="#minjun 또는 #noeulkings" onChange={(event) => setFavoriteQuery(event.target.value)} />
            </div>
            <div className="favorite-result-stack">
              {searchedUser ? (
                <div className="favorite-result-row">
                  <PlayerHoverCard as="span" user={searchedUser} teams={app.state.teams}>
                    <span className={getDiscordAvatarClassName(searchedUser, "avatar small")} style={getDiscordAvatarStyle(searchedUser)}>{searchedUser.name.slice(0, 1)}</span>
                    <span>
                      <strong>{searchedUser.name}</strong>
                      <em>{getUserHashtag(searchedUser)}</em>
                    </span>
                  </PlayerHoverCard>
                  <Button type="button" size="sm" variant={favoritePlayerIds.includes(searchedUser.id) ? "primary" : "secondary"} onClick={() => app.actions.toggleFavoritePlayer(searchedUser.id)}>
                    {favoritePlayerIds.includes(searchedUser.id) ? "해제" : "저장"}
                  </Button>
                </div>
              ) : null}
              {searchedTeam ? (
                <div className="favorite-result-row">
                  <TeamHoverCard as="span" team={searchedTeam}>
                    <span className="team-emblem small" style={{ "--team-color": searchedTeam.accent }}>{searchedTeam.name.slice(0, 1)}</span>
                    <span>
                      <strong>{searchedTeam.name}</strong>
                      <em>{getTeamHashtag(searchedTeam)}</em>
                    </span>
                  </TeamHoverCard>
                  <Button type="button" size="sm" variant={favoriteTeamIds.includes(searchedTeam.id) ? "primary" : "secondary"} onClick={() => app.actions.toggleFavoriteTeam(searchedTeam.id)}>
                    {favoriteTeamIds.includes(searchedTeam.id) ? "해제" : "저장"}
                  </Button>
                </div>
              ) : null}
              {favoriteQuery.trim() && !searchedUser && !searchedTeam ? <div className="empty-state">해시태그 결과 없음</div> : null}
            </div>
            <div className="favorite-chip-list">
              {favoritePlayers.map((player) => (
                <PlayerHoverCard key={player.id} as="span" user={player} teams={app.state.teams} className="favorite-mini-chip">
                  <span className={getDiscordAvatarClassName(player, "avatar small")} style={getDiscordAvatarStyle(player)}>{player.name.slice(0, 1)}</span>
                  <span>{getUserHashtag(player)}</span>
                </PlayerHoverCard>
              ))}
              {favoriteTeams.map((team) => (
                <TeamHoverCard key={team.id} as="span" team={team} className="favorite-mini-chip">
                  <span className="team-dot" style={{ "--team-color": team.accent }} />
                  <span>{getTeamHashtag(team)}</span>
                </TeamHoverCard>
              ))}
              {!favoritePlayers.length && !favoriteTeams.length ? <em>저장된 즐겨찾기 없음</em> : null}
            </div>
          </Card>
          <ProgressionChecklist user={user} matches={app.state.matches} />
          <ShareCard user={user} match={app.state.matches[0]} />
          <Card className="section-card">
            <div className="contract-grid single">
              <div>
                <span>신뢰도</span>
                <strong>{user.trustScore}</strong>
              </div>
              <div>
                <span>지역</span>
                <strong>{user.region}</strong>
              </div>
              <div>
                <span>평균 파울</span>
                <strong>{averageFouls.toFixed(1)}</strong>
              </div>
              <div>
                <span>학교</span>
                <strong>{user.school}</strong>
              </div>
              <div>
                <span>회사</span>
                <strong>{user.company}</strong>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
