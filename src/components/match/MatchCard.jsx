import { CalendarDays, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../common/Badge.jsx";
import Card from "../common/Card.jsx";
import CourtHoverCard from "../court/CourtHoverCard.jsx";
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

function getSafeSide(side = {}, fallbackName = "") {
  return {
    ...side,
    name: side?.name || fallbackName,
    teamId: side?.teamId || "",
    score: side?.score ?? 0,
  };
}

export default function MatchCard({ match, teams = [], courts = [] }) {
  if (!match) return null;
  const sideA = getSafeSide(match.teamA, "A");
  const sideB = getSafeSide(match.teamB, "B");
  const teamA = teams.find((team) => team.id === sideA.teamId);
  const teamB = teams.find((team) => team.id === sideB.teamId);
  const court = courts.find((item) => item.name === match.court);

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
        <span><MapPin size={15} /><CourtHoverCard court={court} courtName={match.court}>{match.court}</CourtHoverCard></span>
        <span><CalendarDays size={15} />{match.scheduledAt}</span>
      </div>
      <div className="score-line">
        <TeamHoverCard team={teamA} to={sideA.teamId ? `/app/teams/${sideA.teamId}` : undefined}>{sideA.name}</TeamHoverCard>
        <strong>{sideA.score} : {sideB.score}</strong>
        <TeamHoverCard team={teamB} to={sideB.teamId ? `/app/teams/${sideB.teamId}` : undefined}>{sideB.name}</TeamHoverCard>
      </div>
      <Link className="button button-secondary button-md" to={`/app/matches?match=${match.id}`}>
        방 보기
      </Link>
    </Card>
  );
}
