import { Link } from "react-router-dom";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";

const toneMap = {
  match: "blue",
  tier: "gold",
  team: "green",
};

export default function Notifications({ app }) {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Notifications</p>
          <h1>알림</h1>
        </div>
      </header>
      <Card className="section-card">
        <div className="compact-list notifications-list">
          {app.state.notifications.map((notification) => (
            <div key={notification.id}>
              <span>
                <strong>{notification.title}</strong>
                <small>{notification.body}</small>
              </span>
              <span className="notification-actions">
                <Badge tone={toneMap[notification.tone] ?? "neutral"}>{notification.tone}</Badge>
                {notification.matchId ? (
                  <Link className="button button-secondary button-md" to={`/app/matches/${notification.matchId}`}>경기방</Link>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
