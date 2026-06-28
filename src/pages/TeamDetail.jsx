import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Star, Trash2 } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import MemberTypeBadge from "../components/team/MemberTypeBadge.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import TierEmblem from "../components/rating/TierEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { MAX_TEAM_MEMBERS, MAX_TEAM_MEMBERSHIPS, TEAM_ROLES } from "../lib/constants.js";

function getTeamSide(match, teamId) {
  if (match.teamA?.teamId === teamId) return "teamA";
  if (match.teamB?.teamId === teamId) return "teamB";
  return null;
}

function getSideScore(match, sideName) {
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return Number(match.result?.[resultKey] ?? match[sideName]?.score ?? 0);
}

const historyStatusLabel = {
  contract: "동의 대기",
  agreed: "예정",
  approval: "승인 대기",
  disputed: "보류",
  confirmed: "확정",
  void: "무효",
  cancelled: "취소",
};
const externalTeamRoles = new Set(["mercenary", "guest"]);
const managedTeamRoleOptions = [["regular", TEAM_ROLES.regular]];

function getManagedRoleOptions(member, captainId) {
  if (member.userId === captainId) return [["captain", TEAM_ROLES.captain]];
  if (member.role && member.role !== "regular") return [[member.role, TEAM_ROLES[member.role] ?? member.role], ...managedTeamRoleOptions];
  return managedTeamRoleOptions;
}

export default function TeamDetail({ app }) {
  const { teamId } = useParams();
  const team = app.state.teams.find((item) => item.id === teamId);
  const [memberDraft, setMemberDraft] = useState({ userId: app.state.users[0]?.id, role: "regular" });
  const [deleteArmed, setDeleteArmed] = useState(false);

  if (!team) return <Navigate to="/app/teams" replace />;

  const userMap = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const teamById = Object.fromEntries(app.state.teams.map((item) => [item.id, item]));
  const membershipCounts = new Map();
  app.state.teams.forEach((item) => {
    item.members.forEach((member) => membershipCounts.set(member.userId, (membershipCounts.get(member.userId) ?? 0) + 1));
  });
  const captain = team.members.find((member) => member.role === "captain");
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const isFavoriteTeam = favoriteTeamIds.includes(team.id);
  const canManage = captain?.userId === app.currentUser.id;
  const regularMembers = team.members.filter((member) => !externalTeamRoles.has(member.role));
  const reserveMembers = team.members.filter((member) => externalTeamRoles.has(member.role));
  const availableUsers = app.state.users.filter((user) => !team.members.some((member) => member.userId === user.id));
  const firstAddableUser = availableUsers.find((user) => (membershipCounts.get(user.id) ?? 0) < MAX_TEAM_MEMBERSHIPS);
  const addUserId = availableUsers.some((user) => user.id === memberDraft.userId) ? memberDraft.userId : firstAddableUser?.id ?? availableUsers[0]?.id ?? "";
  const selectedCount = membershipCounts.get(addUserId) ?? 0;
  const teamFull = team.members.length >= MAX_TEAM_MEMBERS;
  const canAddMember = canManage && Boolean(addUserId) && selectedCount < MAX_TEAM_MEMBERSHIPS && !teamFull;
  const history = app.state.matches.filter((match) => getTeamSide(match, team.id));
  const loadedWins = history.filter((match) => {
    const sideName = getTeamSide(match, team.id);
    const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
    return match.status === "confirmed" && getSideScore(match, sideName) > getSideScore(match, oppositeSide);
  }).length;
  const loadedLosses = history.filter((match) => {
    const sideName = getTeamSide(match, team.id);
    const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
    return match.status === "confirmed" && getSideScore(match, sideName) < getSideScore(match, oppositeSide);
  }).length;
  const wins = Number(team.wins ?? loadedWins);
  const losses = Number(team.losses ?? loadedLosses);
  const confirmedCount = wins + losses;
  const winRate = confirmedCount ? Math.round((wins / confirmedCount) * 100) : 0;

  const renderMembers = (title, members) => (
    <Card className="section-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Roster</p>
          <h2>{title}</h2>
        </div>
        <Badge tone="blue">{members.length}명</Badge>
      </div>
      <div className="member-list">
        {members.map((member) => {
          const user = userMap[member.userId];
          if (!user) return null;
          return (
            <PlayerHoverCard className="member-row" key={`${team.id}-${member.userId}-${member.role}`} user={user} teams={app.state.teams}>
              <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
              <div className="member-main">
                <strong>{user.name}</strong>
                <span>{user.position} · {user.region}</span>
              </div>
              <TierBadge mmr={user.ratings.integrated} compact />
              <MemberTypeBadge role={member.role} />
            </PlayerHoverCard>
          );
        })}
      </div>
    </Card>
  );

  const addMember = (event) => {
    event.preventDefault();
    if (!canAddMember) return;
    app.actions.addTeamMember(team.id, { ...memberDraft, userId: addUserId });
    const nextUser = availableUsers.find((user) => user.id !== addUserId);
    setMemberDraft({ userId: nextUser?.id ?? app.state.users[0]?.id, role: "regular" });
  };
  const deleteTeam = () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    app.actions.deleteTeam(team.id);
  };

  return (
    <div className="page-stack team-detail-page rank-team-page">
      <section className="team-detail-hero rank-profile-hero rank-team-hero" style={{ "--team-color": team.accent }}>
        <div>
          <p className="eyebrow">Team Profile</p>
          <h1>{team.name}</h1>
          <p>{team.region} · {team.homeCourt}</p>
          <div className="badge-row">
            <Badge tone="green">{team.mmr} 팀 MMR</Badge>
            <TierBadge mmr={team.mmr} />
            <Badge tone="gold">주장 {userMap[captain?.userId]?.name ?? "미지정"}</Badge>
          </div>
          <Button
            type="button"
            variant={isFavoriteTeam ? "primary" : "secondary"}
            className={isFavoriteTeam ? "favorite-toggle-button active" : "favorite-toggle-button"}
            onClick={() => app.actions.toggleFavoriteTeam(team.id)}
          >
            <Star size={16} fill={isFavoriteTeam ? "currentColor" : "none"} />
            {isFavoriteTeam ? "즐겨찾기됨" : "즐겨찾기"}
          </Button>
        </div>
        <div className="team-tier-hero">
          <TierEmblem mmr={team.mmr} size="md" showLabel />
          <div className="team-emblem hero-emblem">{team.name.slice(0, 1)}</div>
        </div>
      </section>

      <nav className="rank-profile-tabs">
        <a href="#team-history">전적</a>
        <a href="#team-roster">로스터</a>
        <a href="#team-control">관리</a>
      </nav>

      <section className="rank-profile-summary">
        <Card className="section-card rank-record-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Team Ranked</p>
              <h2>팀 전적</h2>
            </div>
            <div className="badge-row">
              <Badge tone="gold">{team.mmr} MMR</Badge>
              <TierBadge mmr={team.mmr} compact />
            </div>
          </div>
          <div className="rank-stat-grid">
            <span><strong>{wins}승</strong>승리</span>
            <span><strong>{losses}패</strong>패배</span>
            <span><strong>{winRate}%</strong>승률</span>
            <span><strong>{history.length}</strong>전체 경기</span>
          </div>
        </Card>
        <Card className="section-card rank-record-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Roster</p>
              <h2>선수 구성</h2>
            </div>
            <Badge tone="green">{team.members.length}명</Badge>
          </div>
          <div className="rank-stat-grid">
            <span><strong>{regularMembers.length}</strong>팀원</span>
            <span><strong>{reserveMembers.length}</strong>용병/게스트</span>
            <span><strong>{myTeamCountLabel(canManage)}</strong>권한</span>
            <span><strong>{team.region}</strong>지역</span>
          </div>
        </Card>
      </section>

      <div className="content-grid wide-left">
        <div className="page-stack">
          <Card id="team-history" className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Team History</p>
                <h2>팀 경기 히스토리</h2>
              </div>
              <Badge tone="green">{history.length}경기 · {wins}승</Badge>
            </div>
            <div className="history-list">
              {history.map((match) => {
                const sideName = getTeamSide(match, team.id);
                const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
                const side = match[sideName];
                const opponent = match[oppositeSide];
                const reserveUsed = (side?.players ?? [])
                  .map((id) => team.members.find((member) => member.userId === id))
                  .filter((member) => member && externalTeamRoles.has(member.role));
                return (
                  <article key={match.id} className="history-item">
                    <div>
                      <Link to={`/app/matches?match=${match.id}`}><strong>{match.title}</strong></Link>
                      <span>{match.court} · {match.scheduledAt}</span>
                    </div>
                    <div className="history-score">
                      <Badge tone={match.status === "confirmed" ? "green" : match.status === "contract" ? "blue" : "orange"}>{historyStatusLabel[match.status] ?? match.status}</Badge>
                      <strong>{getSideScore(match, sideName)}:{getSideScore(match, oppositeSide)}</strong>
                    </div>
                    <div className="roster compact-roster">
                      {(side?.players ?? []).map((id) => {
                        const user = userMap[id];
                        return user ? <PlayerHoverCard key={id} user={user} teams={app.state.teams}><i style={{ "--avatar": user.avatarColor }} />{user.name}</PlayerHoverCard> : null;
                      })}
                    </div>
                    <p>
                      상대 <TeamHoverCard team={teamById[opponent.teamId]} as="span">{opponent.name}</TeamHoverCard>
                      {reserveUsed.length ? ` · 용병/게스트 ${reserveUsed.map((member) => `${userMap[member.userId]?.name ?? "플레이어"}(${TEAM_ROLES[member.role]})`).join(", ")}` : ""}
                    </p>
                  </article>
                );
              })}
            </div>
          </Card>
        </div>

        <aside className="page-stack">
          <Card className="section-card">
            <div className="contract-grid single">
              <div>
                <span>주장</span>
                <strong>{userMap[captain?.userId]?.name ?? "미지정"}</strong>
              </div>
              <div>
                <span>팀원</span>
                <strong>{regularMembers.length}명</strong>
              </div>
              <div>
                <span>용병/게스트</span>
                <strong>{reserveMembers.length}명</strong>
              </div>
            </div>
          </Card>
          <Card id="team-control" className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Member Control</p>
                <h2>팀원 관리</h2>
              </div>
              <Badge tone={teamFull ? "orange" : "green"}>{team.members.length}/{MAX_TEAM_MEMBERS}명</Badge>
            </div>
            {canManage ? (
              <>
                <form className="member-add-form" onSubmit={addMember}>
                  <label>
                    추가할 선수
                    <select value={addUserId} onChange={(event) => setMemberDraft((current) => ({ ...current, userId: event.target.value }))}>
                      {availableUsers.map((user) => {
                        const count = membershipCounts.get(user.id) ?? 0;
                        return (
                          <option key={user.id} value={user.id} disabled={count >= MAX_TEAM_MEMBERSHIPS}>
                            {user.name} · {count}/{MAX_TEAM_MEMBERSHIPS}팀
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>
                    역할
                    <select value={memberDraft.role} onChange={(event) => setMemberDraft((current) => ({ ...current, role: event.target.value }))}>
                      {managedTeamRoleOptions.map(([role, label]) => <option key={role} value={role}>{label}</option>)}
                    </select>
                  </label>
                  <Button type="submit" disabled={!canAddMember || !availableUsers.length}>팀원 추가</Button>
                  {teamFull ? <span className="form-warning">팀원은 최대 {MAX_TEAM_MEMBERS}명까지 등록할 수 있습니다.</span> : null}
                  {!teamFull && !canAddMember ? <span className="form-warning">선수 팀 한도 {MAX_TEAM_MEMBERSHIPS}/{MAX_TEAM_MEMBERSHIPS}</span> : null}
                </form>
                <div className="member-control-list">
                  {team.members.map((member) => {
                    const user = userMap[member.userId];
                    if (!user) return null;
                    const isCaptainMember = member.userId === captain?.userId;
                    const roleOptions = getManagedRoleOptions(member, captain?.userId);
                    return (
                      <div key={`${team.id}-${member.userId}-control`} className="member-control-row">
                        <PlayerHoverCard user={user} teams={app.state.teams}>
                          <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
                          <strong>{user.name}</strong>
                        </PlayerHoverCard>
                        <select value={member.role} disabled={isCaptainMember} onChange={(event) => app.actions.updateTeamMemberRole(team.id, member.userId, event.target.value)}>
                          {roleOptions.map(([role, label]) => <option key={role} value={role}>{label}</option>)}
                        </select>
                        <button type="button" disabled={isCaptainMember || team.members.length <= 1} onClick={() => app.actions.removeTeamMember(team.id, member.userId)}>제외</button>
                      </div>
                    );
                  })}
                </div>
                <div className="team-danger-zone">
                  <div>
                    <strong>팀 삭제</strong>
                    <span>팀 프로필과 로스터를 삭제합니다. 기존 경기 기록은 유지됩니다.</span>
                  </div>
                  <Button type="button" variant="secondary" className="danger-button" onClick={deleteTeam}>
                    <Trash2 size={16} />
                    {deleteArmed ? "한 번 더 눌러 삭제" : "팀 삭제"}
                  </Button>
                </div>
              </>
            ) : (
              <span className="form-chip">팀장 전용</span>
            )}
          </Card>
          <div id="team-roster" className="page-stack">
            {renderMembers("팀원", regularMembers)}
          </div>
          {renderMembers("용병/게스트 기록", reserveMembers)}
        </aside>
      </div>
    </div>
  );
}

function myTeamCountLabel(canManage) {
  return canManage ? "관리" : "조회";
}
