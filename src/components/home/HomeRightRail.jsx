import { Bell, ClipboardCheck, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { MAX_TEAM_MEMBERSHIPS, getTeamRoleLabel } from "../../lib/constants.js";
import { getNotificationDisplayContent, getNotificationHref } from "../../lib/notifications.js";
import { getPlacementLabel } from "../../lib/rating.js";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import TierEmblem from "../rating/TierEmblem.jsx";
import TeamEmblem from "../team/TeamEmblem.jsx";
import TeamHoverCard from "../team/TeamHoverCard.jsx";

function getNotificationPreviewBody(notification = {}) {
  return String(notification.body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "알림 확인 필요";
}

export default function HomeRightRail({
  acceptHomeRecruitingInvitation,
  actionItems,
  app,
  declineHomeRecruitingInvitation,
  homeNoticeItems,
  localRivals,
  mySeasonIndex,
  mySeasonRow,
  myTeamCount,
  myTeams,
  openActionRoom,
  placementComplete,
  priorityItems,
  priorityNoticeItems,
  processingInviteId,
  inviteActionError,
  rankSpotlightLabel,
  recentFiveWins,
  seasonProgress,
  topRankers,
  user,
}) {
  return (
    <aside className="page-stack home-right-rail">
      <aside className="page-stack home-top-rail">
        <div className="rank-tier-rail">
          <Card className="section-card rank-profile-card rank-spotlight-card ui-design-decorative-surface">
            <div className="rank-spotlight-content">
              <div className="rank-spotlight-main">
                <TierEmblem mmr={user.ratings.integrated} ratings={user.ratings} size="md" />
                <div>
                  <strong>{rankSpotlightLabel}</strong>
                  <span>{placementComplete ? `${Math.round(user.ratings.integrated)} MMR` : getPlacementLabel(user.ratings)} · 최근 5경기 {recentFiveWins}승</span>
                </div>
              </div>
              <div className="rank-profile-tabs rank-spotlight-links">
                <Button as={Link} to={`/app/players/${user.id}`} size="sm" variant="secondary">프로필</Button>
                <Button as={Link} to="/app/season" size="sm" variant="secondary">시즌</Button>
                <Button as={Link} to="/app/settings" size="sm" variant="secondary">설정</Button>
              </div>
            </div>
          </Card>
        </div>

        <Card className="section-card home-action-card">
          <div className="section-title-row">
            <div>
              <h2>내가 처리할 일</h2>
            </div>
            <Badge tone={actionItems.length ? "orange" : "neutral"}>{actionItems.length}개</Badge>
          </div>
          <div className="home-action-list ui-design-borderless-list">
            {actionItems.length ? (
              <>
                {priorityItems.map((item) => {
                  const Icon = item.icon;
                  if (item.actionType === "recruiting-invite") {
                    const isProcessing = processingInviteId === `${item.postId}:${item.invitationId}`;
                    return (
                      <div key={item.id} className={`home-action-row priority-${item.priority}`}>
                        <span className="home-action-icon"><Icon size={18} /></span>
                        <span className="home-action-main">
                          <strong>{item.title}</strong>
                          <em>{item.meta}</em>
                          {inviteActionError?.key === `${item.postId}:${item.invitationId}` ? <small role="status" className="form-warning">{inviteActionError.message}</small> : null}
                        </span>
                        <span className="home-action-buttons">
                          <Button size="sm" type="button" disabled={Boolean(processingInviteId)} onClick={() => acceptHomeRecruitingInvitation(item.postId, item.invitationId)}>{isProcessing ? "수락 중" : "수락"}</Button>
                          <Button size="sm" type="button" variant="secondary" disabled={Boolean(processingInviteId)} onClick={() => declineHomeRecruitingInvitation(item.postId, item.invitationId)}>{isProcessing ? "처리 중" : "거절"}</Button>
                          <Button as={Link} variant="secondary" size="sm" to={item.href} onClick={(event) => openActionRoom(event, item)}>보기</Button>
                        </span>
                      </div>
                    );
                  }
                  return (
                    <Link key={item.id} to={item.href} className={`home-action-row priority-${item.priority}`} onClick={(event) => openActionRoom(event, item)}>
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
                  <Link
                    to={actionItems[priorityItems.length]?.href ?? "/app/matches"}
                    className="home-action-row priority-5"
                    onClick={(event) => openActionRoom(event, actionItems[priorityItems.length])}
                  >
                    <span className="home-action-icon"><ClipboardCheck size={18} /></span>
                    <span className="home-action-main">
                      <strong>더 처리할 항목 있음</strong>
                      <em>{actionItems.length - priorityItems.length}개 더 있음</em>
                    </span>
                    <b>더보기</b>
                  </Link>
                ) : null}
              </>
            ) : (
              <div className="home-action-row priority-5">
                <span className="home-action-icon"><ClipboardCheck size={18} /></span>
                <span className="home-action-main">
                  <strong>처리할 일 없음</strong>
                </span>
                <b>OK</b>
              </div>
            )}
          </div>
        </Card>

        <Card className="section-card home-alert-card">
          <div className="section-title-row">
            <div>
              <h2>알림</h2>
            </div>
            <div className="ui-action-row home-alert-heading-actions">
              <Button as={Link} to="/app/notifications?view=all" variant="secondary" size="sm">전체 알림</Button>
              <Badge tone={homeNoticeItems.length ? "orange" : "neutral"}>{homeNoticeItems.length}개</Badge>
            </div>
          </div>
          <div className="home-action-list ui-design-borderless-list">
            {priorityNoticeItems.length ? (
              <>
                {priorityNoticeItems.map((notification) => {
                  const displayContent = getNotificationDisplayContent(notification);
                  const content = (
                    <>
                      <span className="home-action-icon"><Bell size={18} /></span>
                      <span className="home-action-main">
                        <strong>{displayContent.title}</strong>
                        <em>{getNotificationPreviewBody(displayContent)}</em>
                      </span>
                      <b>{notification.targetUnavailable ? "종료됨" : "보기"}</b>
                    </>
                  );
                  return notification.targetUnavailable ? (
                    <div key={notification.id} className="home-action-row priority-5 notification-terminal-row">
                      {content}
                    </div>
                  ) : (
                    <Link
                      key={notification.id}
                      to={getNotificationHref(notification)}
                      className="home-action-row priority-5"
                      onClick={(event) => openActionRoom(event, notification)}
                    >
                      {content}
                    </Link>
                  );
                })}
                {homeNoticeItems.length > priorityNoticeItems.length ? (
                  <Link to="/app/notifications?view=all" className="home-action-row priority-5">
                    <span className="home-action-icon"><Bell size={18} /></span>
                    <span className="home-action-main">
                      <strong>더 많은 알림</strong>
                      <em>{homeNoticeItems.length - priorityNoticeItems.length}개 더 있음</em>
                    </span>
                    <b>전체</b>
                  </Link>
                ) : null}
              </>
            ) : (
              <div className="home-action-row priority-5">
                <span className="home-action-icon"><Bell size={18} /></span>
                <span className="home-action-main">
                  <strong>새 알림 없음</strong>
                </span>
                <b>OK</b>
              </div>
            )}
          </div>
        </Card>
      </aside>

      <aside className="page-stack home-side-stack">
        <Card className="section-card rank-leaderboard-card home-side-wide-card">
          <div className="section-title-row">
            <div>
              <h2>{user.region} 랭킹</h2>
            </div>
          </div>
          <div className="rank-list ui-design-borderless-list">
            {topRankers.map((row, index) => (
              <PlayerHoverCard className="rank-row" key={row.id} user={row} teams={app.state.teams}>
                <b>{index + 1}</b>
                <ProfileEmblem user={row} className="small" />
                <strong>{row.name}</strong>
                <em>{Math.round(row.seasonScore)}점</em>
              </PlayerHoverCard>
            ))}
          </div>
          <Button as={Link} to="/app/rankings" variant="secondary" className="ui-button-block ui-design-borderless-surface"><Trophy size={17} /> 전체 랭크보드</Button>
        </Card>

        <Card className="section-card season-mini-card">
          <div className="section-title-row">
            <div>
              <h2>{user.region} 시즌 레이스</h2>
            </div>
          </div>
          <div className="season-progress">
            <span style={{ width: `${seasonProgress}%` }} />
          </div>
          <div className="contract-grid single ui-design-borderless-list">
            <div>
              <span>내 지역 순위</span>
              <strong>{mySeasonIndex >= 0 ? `${mySeasonIndex + 1}위` : "대기"}</strong>
            </div>
            <div>
              <span>시즌 전적</span>
              <strong>{mySeasonRow ? `${mySeasonRow.seasonWins}승 ${mySeasonRow.seasonLosses}패` : "0승 0패"}</strong>
            </div>
          </div>
          <Button as={Link} to="/app/season" variant="secondary" className="ui-button-block ui-design-borderless-surface"><Trophy size={17} /> 시즌 허브</Button>
        </Card>

        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <h2>{user.region} 라이벌</h2>
            </div>
          </div>
          <div className="ui-entity-list ui-design-borderless-list">
            {localRivals.length ? localRivals.map((team) => (
              <TeamHoverCard className="ui-control ui-entity-row" directNavigation key={team.id} team={team}>
                <TeamEmblem team={team} size="xs" />
                <span className="ui-entity-copy">
                  <strong>{team.name}</strong>
                  <em>MMR 차이 {team.gap > 0 ? `+${team.gap}` : team.gap}</em>
                </span>
                <b>{team.mmr} MMR</b>
              </TeamHoverCard>
            )) : <div className="ui-entity-empty"><span>지역 라이벌 없음</span><strong>대기</strong></div>}
          </div>
        </Card>

        <Card className="section-card home-side-wide-card">
          <div className="section-title-row">
            <div>
              <h2>내 소속 팀</h2>
            </div>
            <Badge tone={myTeamCount > MAX_TEAM_MEMBERSHIPS ? "orange" : myTeamCount ? "green" : "neutral"}>{myTeamCount}/{MAX_TEAM_MEMBERSHIPS}</Badge>
          </div>
          <div className="ui-entity-list ui-design-borderless-list">
            {myTeams.length ? myTeams.slice(0, 5).map((team) => (
              <TeamHoverCard className="ui-control ui-entity-row" directNavigation key={team.id} team={team}>
                <TeamEmblem team={team} size="xs" />
                <span className="ui-entity-copy">
                  <strong>{team.name}</strong>
                  <em>{getTeamRoleLabel(team.myRole)}</em>
                </span>
                <b>{team.mmr} MMR</b>
              </TeamHoverCard>
            )) : <div className="ui-entity-empty"><span>팀 없음</span><strong>팀 찾기 필요</strong></div>}
          </div>
          <Button as={Link} to="/app/teams" variant="secondary" className="ui-button-block ui-design-borderless-surface">팀 전체 보기</Button>
        </Card>
      </aside>
    </aside>
  );
}
