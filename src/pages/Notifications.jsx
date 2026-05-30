import { Link } from "react-router-dom";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";

const toneMap = {
  match: "blue",
  tier: "gold",
  team: "green",
};

export default function Notifications({ app }) {
  const unreadCount = app.state.notifications.filter((notification) => !notification.readAt).length;

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
      <Card className="section-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Inbox</p>
            <h2>읽지 않은 알림 {unreadCount}개</h2>
          </div>
          <Badge tone={unreadCount ? "orange" : "green"}>{unreadCount ? "확인 필요" : "정리됨"}</Badge>
        </div>
        <div className="compact-list notifications-list">
          {app.state.notifications.map((notification) => (
            <div key={notification.id} className={notification.readAt ? "notification-read" : "notification-unread"}>
              <span>
                <strong>{notification.title}</strong>
                <small>{notification.body}</small>
              </span>
              <span className="notification-actions">
                <Badge tone={toneMap[notification.tone] ?? "neutral"}>{notification.tone}</Badge>
                {notification.matchId ? (
                  <Link className="button button-secondary button-md" to={`/app/matches/${notification.matchId}`}>경기방</Link>
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
