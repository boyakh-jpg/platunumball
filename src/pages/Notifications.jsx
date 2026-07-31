import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Trash2 } from "lucide-react";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import { getRoomScheduleLabel } from "../lib/matchUtils.js";
import { compareNotificationsNewestFirst, dedupeNotifications, getNotificationDisplayAt, getNotificationHref, isNotificationDisplayable, isNotificationTargetUnavailable, isNotificationVisibleToUser } from "../lib/notifications.js";
import { getPendingRecruitingInvitations, getRecruitingInvitationSenderName } from "../lib/recruiting.js";
import { useRoomModalNavigation } from "../lib/roomModalNavigation.js";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { MatchRoomModal } from "./Matches.jsx";
import { RecruitingRoomModal } from "./Recruiting.jsx";

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
  const [pendingInvitationKeys, setPendingInvitationKeys] = useState([]);
  const [invitationActionErrors, setInvitationActionErrors] = useState({});
  const [notificationDeleteError, setNotificationDeleteError] = useState(null);
  const [notificationsLoadError, setNotificationsLoadError] = useState("");
  const pendingInvitationKeysRef = useRef(new Set());
  const {
    selectedMatchId,
    setSelectedMatchId,
    selectedRecruitingPostId,
    setSelectedRecruitingPostId,
    openMatchRoom,
    openRecruitingRoom,
  } = useRoomModalNavigation({
    loadRecruitingPost: app.actions.loadRecruitingPost,
  });
  const loadNotifications = app.actions.loadNotifications;
  const loadDirectory = app.actions.loadDirectory;
  const refreshNotifications = useCallback(async () => {
    setNotificationsLoadError("");
    try {
      await Promise.all([
        loadNotifications?.(),
        loadDirectory?.({ kind: "self", force: true }),
      ]);
    } catch {
      setNotificationsLoadError("알림을 불러오지 못했습니다.");
    }
  }, [loadDirectory, loadNotifications]);
  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
  const selectedRecruitingPost = (app.state.recruitingPosts ?? []).find((post) => post.id === selectedRecruitingPostId) ?? null;
  useBodyScrollLock(Boolean(selectedRecruitingPost));
  const visibleNotifications = useMemo(() => dedupeNotifications((app.state.notifications ?? [])
    .filter((notification) => isNotificationVisibleToUser(notification, app.currentUser.id, { blockedUserIds }))
    .map((notification) => isNotificationTargetUnavailable(notification, app.state)
      ? { ...notification, targetUnavailable: true }
      : notification)
    .filter((notification) => isNotificationDisplayable(notification)))
    .sort(compareNotificationsNewestFirst), [app.currentUser.id, app.state, app.state.notifications, blockedUserIds]);
  const unreadNotifications = visibleNotifications.filter((notification) => !notification.readAt);
  const pastNotifications = visibleNotifications.filter((notification) => Boolean(notification.readAt));
  const unreadCount = unreadNotifications.length;
  const displayedNotifications = notificationView === "past" ? pastNotifications : unreadNotifications;
  const pendingInvitations = getPendingRecruitingInvitations(app.state, app.currentUser.id);
  const pendingTeamInvitations = (app.state.teamInvitations ?? []).filter((invitation) => (
    invitation.targetUserId === app.currentUser.id &&
    invitation.status === "pending"
  ));
  const runInvitationAction = async (key, action) => {
    if (pendingInvitationKeysRef.current.has(key)) return { ok: false, error: "invitation_action_pending" };
    pendingInvitationKeysRef.current.add(key);
    setPendingInvitationKeys(Array.from(pendingInvitationKeysRef.current));
    setInvitationActionErrors((current) => ({ ...current, [key]: "" }));
    try {
      const result = await action();
      if (!result || result.ok === false) {
        setInvitationActionErrors((current) => ({ ...current, [key]: "초대를 처리하지 못했습니다. 다시 시도해 주세요." }));
      }
      return result;
    } catch {
      setInvitationActionErrors((current) => ({ ...current, [key]: "초대를 처리하지 못했습니다. 다시 시도해 주세요." }));
      return { ok: false, error: "invitation_action_failed" };
    } finally {
      pendingInvitationKeysRef.current.delete(key);
      setPendingInvitationKeys(Array.from(pendingInvitationKeysRef.current));
    }
  };
  const acceptInvitation = async (postId, invitationId) => {
    const result = await runInvitationAction(
      `recruiting:${invitationId}`,
      () => app.actions.acceptRecruitingInvitation(postId, invitationId),
    );
    if (result && result.ok !== false) {
      setSelectedMatchId("");
      setSelectedRecruitingPostId(postId);
    }
  };
  const declineInvitation = (postId, invitationId) => runInvitationAction(
    `recruiting:${invitationId}`,
    () => app.actions.declineRecruitingInvitation(postId, invitationId),
  );
  const acceptTeamInvite = async (invitation) => {
    const result = await runInvitationAction(
      `team:${invitation.id}`,
      () => app.actions.acceptTeamInvitation(invitation.id),
    );
    if (!result || result.ok === false) return;
    await app.actions.loadDirectory?.({ kind: "self", force: true });
    navigate(`/app/teams/${invitation.teamId}`);
  };
  const declineTeamInvite = (invitationId) => runInvitationAction(
    `team:${invitationId}`,
    () => app.actions.declineTeamInvitation(invitationId),
  );
  const deletePastNotification = async (notificationId) => {
    setDeletingNotificationId(notificationId);
    setNotificationDeleteError(null);
    try {
      const result = await app.actions.deleteNotification(notificationId);
      if (!result || result.ok === false) {
        setNotificationDeleteError({ id: notificationId, message: "알림을 삭제하지 못했습니다. 다시 시도해 주세요." });
      }
    } catch {
      setNotificationDeleteError({ id: notificationId, message: "알림을 삭제하지 못했습니다. 다시 시도해 주세요." });
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
      {notificationsLoadError ? (
        <Card className="section-card">
          <div className="ui-empty-state">
            <strong>{notificationsLoadError}</strong>
            <Button type="button" variant="secondary" size="sm" onClick={refreshNotifications}>다시 시도</Button>
          </div>
        </Card>
      ) : null}
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
            {pendingInvitations.map(({ post, invitation }) => {
              const senderName = getRecruitingInvitationSenderName(app.state, invitation);
              const actionKey = `recruiting:${invitation.id}`;
              const actionPending = pendingInvitationKeys.includes(actionKey);
              return (
                <div key={`${post.id}-${invitation.id}`} className="home-invitation-row">
                  <span className="home-action-main">
                    <strong>{post.title}</strong>
                    <em>{getRoomScheduleLabel(post)} · {post.court} · {senderName}님이 초대</em>
                    {invitationActionErrors[actionKey] ? <small role="status" className="form-warning">{invitationActionErrors[actionKey]}</small> : null}
                  </span>
                  <span className="home-invitation-actions">
                    <Button size="sm" type="button" disabled={actionPending} onClick={() => acceptInvitation(post.id, invitation.id)}>수락</Button>
                    <Button size="sm" type="button" variant="secondary" disabled={actionPending} onClick={() => declineInvitation(post.id, invitation.id)}>거절</Button>
                    <Button
                      as={Link}
                      variant="secondary"
                      size="sm"
                      to={`/app/recruiting?filter=invited&post=${post.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        openRecruitingRoom(post.id);
                      }}
                    >
                      방 보기
                    </Button>
                  </span>
                </div>
              );
            })}
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
          <div className="home-invitation-list ui-design-borderless-list">
            {pendingTeamInvitations.map((invitation) => {
              const team = app.state.teams.find((item) => item.id === invitation.teamId);
              const sender = app.state.users.find((user) => user.id === invitation.fromUserId);
              const actionKey = `team:${invitation.id}`;
              const actionPending = pendingInvitationKeys.includes(actionKey);
              return (
                <div key={invitation.id} className="home-invitation-row">
                  <span className="home-action-main">
                    <strong>{team?.name ?? "팀 초대"}</strong>
                    <em>{sender?.name ?? "주장"} · 팀 가입 초대</em>
                    {invitationActionErrors[actionKey] ? <small role="status" className="form-warning">{invitationActionErrors[actionKey]}</small> : null}
                  </span>
                  <span className="home-invitation-actions">
                    <Button size="sm" type="button" disabled={actionPending} onClick={() => acceptTeamInvite(invitation)}>수락</Button>
                    <Button size="sm" type="button" variant="secondary" disabled={actionPending} onClick={() => declineTeamInvite(invitation.id)}>거절</Button>
                    <Button as={Link} variant="secondary" size="sm" to={`/app/teams/${invitation.teamId}`}>팀 보기</Button>
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
        <div className="home-action-list notifications-list ui-design-borderless-list" role="tabpanel">
          {displayedNotifications.length ? displayedNotifications.map((notification) => (
            <article key={notification.id} className={`home-action-row notification-row ${notification.readAt ? "notification-read" : "notification-unread"} ${notification.targetUnavailable ? "notification-terminal-row" : ""}`}>
              <span className="home-action-icon"><Bell size={18} aria-hidden="true" /></span>
              <span className="home-action-main">
                <strong>{notification.title}</strong>
                <em>{notification.body}</em>
                {formatNotificationTime(getNotificationDisplayAt(notification)) ? (
                  <time dateTime={getNotificationDisplayAt(notification)}>{formatNotificationTime(getNotificationDisplayAt(notification))}</time>
                ) : null}
                {notificationDeleteError?.id === notification.id ? <small role="status" className="form-warning">{notificationDeleteError.message}</small> : null}
              </span>
              <span className="notification-actions">
                {notification.targetUnavailable ? (
                  <b className="notification-action-control notification-terminal-state">종료됨</b>
                ) : notification.matchId ? (
                  <Link
                    className="notification-action-control notification-row-open"
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
                    className="notification-action-control notification-row-open"
                    to={`/app/recruiting?post=${notification.recruitingPostId}`}
                    onClick={(event) => {
                      event.preventDefault();
                      openRecruitingRoom(notification.recruitingPostId);
                    }}
                  >
                    보기
                  </Link>
                ) : null}
                {!notification.targetUnavailable
                  && !notification.matchId
                  && !notification.recruitingPostId
                  && getNotificationHref(notification) !== "/app/notifications" ? (
                    <Link
                      className="notification-action-control notification-row-open"
                      to={getNotificationHref(notification)}
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
                  <button type="button" className="notification-action-control notification-read-button" title="읽음 처리" aria-label={`${notification.title} 읽음 처리`} onClick={() => app.actions.markNotificationRead(notification.id)}>
                    읽음
                  </button>
                )}
              </span>
            </article>
          )) : (
            <div className="ui-empty-state-compact">
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
