import { CalendarDays, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../common/Badge.jsx";
import Card from "../common/Card.jsx";
import TeamHoverCard from "../team/TeamHoverCard.jsx";

const statusLabel = {
  contract: "WAIT",
  agreed: "진행 예정",
  approval: "승인 대기",
  disputed: "이의제기",
  confirmed: "확정",
  void: "무효",
  cancelled: "취소",
};

const statusTone = {
  contract: "blue",
  agreed: "green",
  approval: "orange",
  disputed: "orange",
  confirmed: "green",
  void: "neutral",
  cancelled: "neutral",
};

export default function MatchCard({ match, teams = [] }) {
  const teamA = teams.find((team) => team.id === match.teamA.teamId);
  const teamB = teams.find((team) => team.id === match.teamB.teamId);

  return (
    <Card className="match-card" as="article">
      <div className="match-card-header">
        <div>
          <p className="eyebrow">{match.mode} · {match.official ? "공식경기" : "일반경기"}</p>
          <h3>{match.title}</h3>
        </div>
        <Badge tone={statusTone[match.status] ?? "blue"}>
          {statusLabel[match.status] ?? match.status}
        </Badge>
      </div>
      <div className="match-meta">
        <span><MapPin size={15} />{match.court}</span>
        <span><CalendarDays size={15} />{match.scheduledAt}</span>
      </div>
      <div className="score-line">
        <TeamHoverCard team={teamA} to={`/app/teams/${match.teamA.teamId}`}>{match.teamA.name}</TeamHoverCard>
        <strong>{match.teamA.score ?? 0} : {match.teamB.score ?? 0}</strong>
        <TeamHoverCard team={teamB} to={`/app/teams/${match.teamB.teamId}`}>{match.teamB.name}</TeamHoverCard>
      </div>
      <Link className="button button-secondary button-md" to={`/app/matches?match=${match.id}`}>
        방 보기
      </Link>
    </Card>
  );
}
