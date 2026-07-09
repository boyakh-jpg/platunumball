import { Link, useNavigate } from "react-router-dom";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import { isInstantRoom } from "../lib/matchUtils.js";
import { isNotificationVisibleToUser } from "../lib/notifications.js";
import { getPendingRecruitingInvitations } from "../lib/recruiting.js";

const toneMap = {
  match: "blue",
  tier: "gold",
  team: "green",
};

function getRecruitingSchedule(post) {
  if (isInstantRoom(post)) return "즉시";
  return [post.scheduledDate, post.scheduledTime].filter(Boolean).join(" ") || post.scheduledAt || "일정 미정";
}

export default function Notifications({ app }) {
  const navigate = useNavigate();
  const visibleNotifications = app.state.notifications.filter((notification) => isNotificationVisibleToUser(notification, app.currentUser.id));
  const unreadCount = visibleNotifications.filter((notification) => !notification.readAt).length;
  const pendingInvitations = getPendingRecruitingInvitations(app.state, app.currentUser.id);
  const pendingTeamInvitations = (app.state.teamInvitations ?? []).filter((invitation) => (
    invitation.targetUserId === app.currentUser.id &&
    invitation.status === "pending"
  ));
  const acceptInvitation = async (postId, invitationId) => {
    await app.actions.acceptRecruitingInvitation(postId, invitationId);
    navigate(`/app/recruiting?post=${postId}`);
  };
  const acceptTeamInvite = async (invitation) => {
    await app.actions.acceptTeamInvitation(invitation.id);
    await app.actions.loadDirectory?.(true);
    navigate(`/app/teams/${invitation.teamId}`);
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Notifications</p>
          <h1>알림</h1>
        </div>
        <Button variant="secondary" disabled={!unreadCount} onClick={app.actions.markAllNotificationsRead}>
          모두 읽음
        </Button>
      </header>
      {pendingInvitations.length ? (
        <Card className="section-card notification-invitation-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Invitations</p>
              <h2>받은 초대장</h2>
            </div>
            <Badge tone="orange">{pendingInvitations.length}개</Badge>
          </div>
          <div className="home-invitation-list">
            {pendingInvitations.map(({ post, invitation }) => (
              <div key={`${post.id}-${invitation.id}`} className="home-invitation-row">
                <span className="home-action-main">
                  <strong>{post.title}</strong>
                  <em>{getRecruitingSchedule(post)} · {post.court}</em>
                </span>
                <span className="home-invitation-actions">
                  <Button size="sm" type="button" onClick={() => acceptInvitation(post.id, invitation.id)}>수락</Button>
                  <Button size="sm" type="button" variant="secondary" onClick={() => app.actions.declineRecruitingInvitation(post.id, invitation.id)}>거절</Button>
                  <Link className="button button-secondary button-sm" to={`/app/recruiting?filter=invited&post=${post.id}`}>방 보기</Link>
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {pendingTeamInvitations.length ? (
        <Card className="section-card notification-invitation-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Team Invitations</p>
              <h2>받은 팀 초대</h2>
            </div>
            <Badge tone="green">{pendingTeamInvitations.length}개</Badge>
          </div>
          <div className="home-invitation-list">
            {pendingTeamInvitations.map((invitation) => {
              const team = app.state.teams.find((item) => item.id === invitation.teamId);
              const sender = app.state.users.find((user) => user.id === invitation.fromUserId);
              return (
                <div key={invitation.id} className="home-invitation-row">
                  <span className="home-action-main">
                    <strong>{team?.name ?? "팀 초대"}</strong>
                    <em>{sender?.name ?? "주장"} · 팀 가입 초대</em>
                  </span>
                  <span className="home-invitation-actions">
                    <Button size="sm" type="button" onClick={() => acceptTeamInvite(invitation)}>수락</Button>
                    <Button size="sm" type="button" variant="secondary" onClick={() => app.actions.declineTeamInvitation(invitation.id)}>거절</Button>
                    <Link className="button button-secondary button-sm" to={`/app/teams/${invitation.teamId}`}>팀 보기</Link>
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
      <Card className="section-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Inbox</p>
            <h2>읽지 않은 알림 {unreadCount}개</h2>
          </div>
          <Badge tone={unreadCount ? "orange" : "green"}>{unreadCount ? "확인 필요" : "정리됨"}</Badge>
        </div>
        <div className="compact-list notifications-list">
          {visibleNotifications.map((notification) => (
            <div key={notification.id} className={notification.readAt ? "notification-read" : "notification-unread"}>
              <span>
                <strong>{notification.title}</strong>
                <small>{notification.body}</small>
              </span>
              <span className="notification-actions">
                <Badge tone={toneMap[notification.tone] ?? "neutral"}>{notification.tone}</Badge>
                {notification.matchId ? (
                  <Link className="button button-secondary button-md" to={`/app/matches?match=${notification.matchId}`}>방 보기</Link>
                ) : null}
                {notification.recruitingPostId ? (
                  <Link className="button button-secondary button-md" to={`/app/recruiting?post=${notification.recruitingPostId}`}>매칭</Link>
                ) : null}
                <button type="button" disabled={Boolean(notification.readAt)} onClick={() => app.actions.markNotificationRead(notification.id)}>
                  {notification.readAt ? "읽음" : "읽음 처리"}
                </button>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
