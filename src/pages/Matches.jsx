import { Link } from "react-router-dom";
import { PlusCircle } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import MatchCard from "../components/match/MatchCard.jsx";

const groups = [
  { id: "contract", title: "경기 전 동의 대기", subtitle: "양팀 과반과 주장 확인이 필요한 경기방", statuses: ["contract"], tone: "blue" },
  { id: "agreed", title: "진행 예정 경기", subtitle: "동의가 끝나 결과 입력을 기다리는 경기", statuses: ["agreed"], tone: "green" },
  { id: "approval", title: "결과 승인 대기", subtitle: "스코어와 개인 기록 승인을 기다리는 경기", statuses: ["approval"], tone: "orange" },
  { id: "review", title: "보류/이의제기", subtitle: "확인 후 재입력하거나 무효 처리할 경기", statuses: ["disputed"], tone: "orange" },
  { id: "done", title: "완료 경기", subtitle: "티어와 랭킹에 반영된 경기", statuses: ["confirmed"], tone: "green" },
  { id: "closed", title: "취소/무효", subtitle: "랭킹 반영 없이 닫힌 경기", statuses: ["cancelled", "void"], tone: "neutral" },
];

function compareRecent(a, b) {
  return String(b.scheduledAt ?? b.createdAt ?? "").localeCompare(String(a.scheduledAt ?? a.createdAt ?? ""));
}

export default function Matches({ app }) {
  return (
    <div className="page-stack matches-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Match rooms</p>
          <h1>경기방</h1>
        </div>
        <Link to="/app/create">
          <Button><PlusCircle size={18} /> 경기 만들기</Button>
        </Link>
      </header>

      <div className="match-board-grid">
        {groups.map((group) => {
          const matches = app.state.matches
            .filter((match) => group.statuses.includes(match.status))
            .sort(compareRecent);

          return (
            <Card key={group.id} className="section-card match-lane">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">{group.id}</p>
                  <h2>{group.title}</h2>
                  <p className="muted">{group.subtitle}</p>
                </div>
                <Badge tone={group.tone}>{matches.length}개</Badge>
              </div>
              <div className="match-stack">
                {matches.length ? (
                  matches.map((match) => <MatchCard key={match.id} match={match} />)
                ) : (
                  <div className="empty-state">해당 상태의 경기방이 없습니다.</div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
