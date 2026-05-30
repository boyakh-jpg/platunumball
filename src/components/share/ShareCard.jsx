import { Trophy } from "lucide-react";
import TierBadge from "../rating/TierBadge.jsx";

export default function ShareCard({ user, match }) {
  return (
    <div className="share-card">
      <div>
        <Trophy size={22} />
        <span>RANKBALL RESULT</span>
      </div>
      <h3>{match?.title ?? "오늘의 판"}</h3>
      <strong>{user.name}</strong>
      <TierBadge mmr={user.ratings.integrated} />
      <p>
        {user.region} 코트 통합 {Math.round(user.ratings.integrated)} MMR · {user.streak > 0 ? `${user.streak}연승` : "다음 판 대기"}
      </p>
    </div>
  );
}
