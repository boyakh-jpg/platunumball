import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Check, Trash2 } from "lucide-react";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import { isInstantRoom } from "../lib/matchUtils.js";
import { isNotificationDisplayable, isNotificationTargetUnavailable, isNotificationVisibleToUser } from "../lib/notifications.js";
import { getPendingRecruitingInvitations } from "../lib/recruiting.js";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { MatchRoomModal } from "./Matches.jsx";
import { RecruitingRoomModal } from "./Recruiting.jsx";

function getRecruitingSchedule(post) {
  if (isInstantRoom(post)) return "즉시";
  return [post.scheduledDate, post.scheduledTime].filter(Boolean).join(" ") || post.scheduledAt || "일정 미정";
}

function formatNotificationTime(value) {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function Notifications({ app }) {
  const navigate = useNavigate();
  const [notificationView, setNotificationView] = useState("unread");
  const [deletingNotificationId, setDeletingNotificationId] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [selectedRecruitingPostId, setSelectedRecruitingPostId] = useState("");
  const loadNotifications = app.actions.loadNotifications;
  useEffect(() => {
    loadNotifications?.();
  }, [loadNotifications]);
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
  const selectedRecruitingPost = (app.state.recruitingPosts ?? []).find((post) => post.id === selectedRecruitingPostId) ?? null;
  useBodyScrollLock(Boolean(selectedRecruitingPost));
  const visibleNotifications = useMemo(() => (app.state.notifications ?? [])
    .filter((notification) => isNotificationVisibleToUser(notification, app.currentUser.id, { blockedUserIds }))
    .map((notification) => isNotificationTargetUnavailable(notification, app.state)
      ? { ...notification, targetUnavailable: true }
      : notification)
    .filter((notification) => isNotificationDisplayable(notification))
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))), [app.currentUser.id, app.state, app.state.notifications, blockedUserIds]);
  const unreadNotifications = visibleNotifications.filter((notification) => !notification.readAt);
  const pastNotifications = visibleNotifications.filter((notification) => Boolean(notification.readAt));
  const unreadCount = unreadNotifications.length;
  const displayedNotifications = notificationView === "past" ? pastNotifications : unreadNotifications;
  const pendingInvitations = getPendingRecruitingInvitations(app.state, app.currentUser.id);
  const pendingTeamInvitations = (app.state.teamInvitations ?? []).filter((invitation) => (
    invitation.targetUserId === app.currentUser.id &&
    invitation.status === "pending"
  ));
  const acceptInvitation = async (postId, invitationId) => {
    const result = await app.actions.acceptRecruitingInvitation(postId, invitationId);
    if (result && result.ok !== false) {
      setSelectedMatchId("");
      setSelectedRecruitingPostId(postId);
    }
  };
  const openMatchRoom = (matchId) => {
    if (!matchId) return;
    setSelectedRecruitingPostId("");
    setSelectedMatchId(matchId);
  };
  const openRecruitingRoom = (postId) => {
    if (!postId) return;
    setSelectedMatchId("");
    setSelectedRecruitingPostId(postId);
    app.actions.loadRecruitingPost?.(postId);
  };
  const acceptTeamInvite = async (invitation) => {
    await app.actions.acceptTeamInvitation(invitation.id);
    await app.actions.loadDirectory?.(true);
    navigate(`/app/teams/${invitation.teamId}`);
  };
  const deletePastNotification = async (notificationId) => {
    setDeletingNotificationId(notificationId);
    try {
      await app.actions.deleteNotification(notificationId);
    } finally {
      setDeletingNotificationId("");
    }
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
                  <Link
                    className="button button-secondary button-sm"
                    to={`/app/recruiting?filter=invited&post=${post.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      openRecruitingRoom(post.id);
                    }}
                  >
                    방 보기
                  </Link>
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
      <Card className="section-card home-alert-card notification-inbox-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Inbox</p>
            <h2>{notificationView === "past" ? `지난 알림 ${pastNotifications.length}개` : `읽지 않은 알림 ${unreadCount}개`}</h2>
          </div>
          <div className="notification-inbox-controls">
            <div className="segmented-control notification-view-tabs" role="tablist" aria-label="알림 보기">
              <button
                type="button"
                role="tab"
                aria-selected={notificationView === "unread"}
                className={notificationView === "unread" ? "active" : ""}
                onClick={() => setNotificationView("unread")}
              >
                읽지 않음 <span>{unreadCount}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={notificationView === "past"}
                className={notificationView === "past" ? "active" : ""}
                onClick={() => setNotificationView("past")}
              >
                지난 알림 <span>{pastNotifications.length}</span>
              </button>
            </div>
            <Badge tone={unreadCount ? "orange" : "green"}>{unreadCount ? "확인 필요" : "정리됨"}</Badge>
          </div>
        </div>
        <div className="home-action-list notifications-list" role="tabpanel">
          {displayedNotifications.length ? displayedNotifications.map((notification) => (
            <article key={notification.id} className={`home-action-row notification-row ${notification.readAt ? "notification-read" : "notification-unread"} ${notification.targetUnavailable ? "notification-terminal-row" : ""}`}>
              <span className="home-action-icon"><Bell size={18} aria-hidden="true" /></span>
              <span className="home-action-main">
                <strong>{notification.title}</strong>
                <em>{notification.body}</em>
                {formatNotificationTime(notification.createdAt) ? (
                  <time dateTime={notification.createdAt}>{formatNotificationTime(notification.createdAt)}</time>
                ) : null}
              </span>
              <span className="notification-actions">
                {notification.targetUnavailable ? (
                  <b className="notification-terminal-state">종료됨</b>
                ) : notification.matchId ? (
                  <Link
                    className="notification-row-open"
                    to={`/app/matches?match=${notification.matchId}`}
                    onClick={(event) => {
                      event.preventDefault();
                      openMatchRoom(notification.matchId);
                    }}
                  >
                    보기
                  </Link>
                ) : null}
                {!notification.targetUnavailable && !notification.matchId && notification.recruitingPostId ? (
                  <Link
                    className="notification-row-open"
                    to={`/app/recruiting?post=${notification.recruitingPostId}`}
                    onClick={(event) => {
                      event.preventDefault();
                      openRecruitingRoom(notification.recruitingPostId);
                    }}
                  >
                    보기
                  </Link>
                ) : null}
                {notificationView === "past" ? (
                  <button
                    type="button"
                    className="notification-delete-button"
                    title="알림 삭제"
                    aria-label={`${notification.title} 알림 삭제`}
                    disabled={deletingNotificationId === notification.id}
                    onClick={() => deletePastNotification(notification.id)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                ) : (
                  <button type="button" className="notification-read-button" title="읽음 처리" aria-label={`${notification.title} 읽음 처리`} onClick={() => app.actions.markNotificationRead(notification.id)}>
                    <Check size={16} aria-hidden="true" />
                  </button>
                )}
              </span>
            </article>
          )) : (
            <div className="notification-empty-state">
              {notificationView === "past" ? "지난 알림이 없습니다." : "읽지 않은 알림이 없습니다."}
            </div>
          )}
        </div>
      </Card>
      <MatchRoomModal app={app} matchId={selectedMatchId} entryPoint="notifications" onClose={() => setSelectedMatchId("")} />
      {selectedRecruitingPost ? (
        <RecruitingRoomModal
          app={app}
          post={selectedRecruitingPost}
          entryPoint="notifications"
          onClose={() => setSelectedRecruitingPostId("")}
          onOpenMatch={(matchId) => {
            setSelectedRecruitingPostId("");
            openMatchRoom(matchId);
          }}
        />
      ) : null}
    </div>
  );
}
