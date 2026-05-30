import { CalendarDays, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../common/Badge.jsx";
import Card from "../common/Card.jsx";

const statusLabel = {
  contract: "계약서",
  approval: "승인 대기",
  confirmed: "확정",
};

export default function MatchCard({ match }) {
  return (
    <Card className="match-card" as="article">
      <div className="match-card-header">
        <div>
          <p className="eyebrow">{match.mode} · {match.official ? "공식경기" : "일반경기"}</p>
          <h3>{match.title}</h3>
        </div>
        <Badge tone={match.status === "confirmed" ? "green" : match.status === "approval" ? "orange" : "blue"}>
          {statusLabel[match.status]}
        </Badge>
      </div>
      <div className="match-meta">
        <span><MapPin size={15} />{match.court}</span>
        <span><CalendarDays size={15} />{match.scheduledAt}</span>
      </div>
      <div className="score-line">
        <Link to={`/app/teams/${match.teamA.teamId}`}>{match.teamA.name}</Link>
        <strong>{match.teamA.score ?? 0} : {match.teamB.score ?? 0}</strong>
        <Link to={`/app/teams/${match.teamB.teamId}`}>{match.teamB.name}</Link>
      </div>
      <Link className="button button-secondary button-md" to={`/app/matches/${match.id}`}>
        경기방 보기
      </Link>
    </Card>
  );
}
