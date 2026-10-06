import { useState } from "react";
import { RotateCw, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { APP_SETTINGS_PATH, getEntityDetailPath } from "../../lib/appNavigation.js";
import { getLoginPath } from "../../lib/profileSetup.js";
import { getPlacementLabel, isPlacementComplete } from "../../lib/rating.js";
import { getTierDivision } from "../../lib/tier.js";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";
import TierEmblem from "./TierEmblem.jsx";

export default function PlayerCard({ user, rankLabel, recentFiveWins = 0, mySeasonRow, mySeasonIndex = -1 }) {
  const [reveal, setReveal] = useState(0);
  const placementComplete = user && isPlacementComplete(user.ratings);
  const rating = user?.ratings?.integrated;
  const ratingLabel = placementComplete
    ? Number.isFinite(rating) ? `${Math.round(rating)} MMR` : "기록 대기"
    : user ? getPlacementLabel(user.ratings) : "미발급";

  return (
    <Card className="ui-player-card ui-design-decorative-surface" aria-label={user ? "내 선수 카드" : "선수 카드 시작하기"}>
      <div className="ui-player-card-stage">
        <div key={reveal} className="ui-player-card-face">
          <span className="ui-player-card-particles" aria-hidden="true" />
          <div className="ui-player-card-heading"><h2>내 선수 카드</h2><span>{ratingLabel}</span></div>
          <div className="ui-player-card-identity">
            {user ? <TierEmblem mmr={rating} ratings={user.ratings} size="md" /> : <UserRound className="ui-player-card-placeholder" aria-hidden="true" />}
            <div><strong>{user?.name || "첫 경기가 카드의 시작"}</strong><span>{user ? rankLabel || (placementComplete ? getTierDivision(rating) : "배정 경기 진행 중") : "경기를 뛰고, 내 기록을 쌓으세요."}</span></div>
          </div>
          {user ? (
            <dl className="ui-player-card-stats">
              <div><dt>최근 5경기</dt><dd>{recentFiveWins}승</dd></div>
              <div><dt>시즌 전적</dt><dd>{mySeasonRow ? `${mySeasonRow.seasonWins}승 ${mySeasonRow.seasonLosses}패` : "기록 대기"}</dd></div>
              <div><dt>지역 순위</dt><dd>{mySeasonIndex >= 0 ? `${mySeasonIndex + 1}위` : "순위 대기"}</dd></div>
            </dl>
          ) : (
            <ol className="ui-player-card-steps"><li>경기 참가</li><li>결과 기록</li><li>내 랭크 확인</li></ol>
          )}
        </div>
      </div>
      <div className="ui-player-card-actions">
        <Button variant="secondary" touchFriendly onClick={() => setReveal((value) => value + 1)}><RotateCw size={16} aria-hidden="true" /> 카드 펼치기</Button>
        {!user ? <Button as={Link} to={getLoginPath("/app")} touchFriendly>내 카드 시작</Button> : null}
      </div>
      {user ? <nav className="ui-player-card-links" aria-label="선수 카드 메뉴">
        <Button as={Link} to={getEntityDetailPath("members", user.id)} variant="text" touchFriendly>프로필</Button>
        <Button as={Link} to="/app/season" variant="text" touchFriendly>시즌</Button>
        <Button as={Link} to={APP_SETTINGS_PATH} variant="text" touchFriendly>설정</Button>
      </nav> : null}
    </Card>
  );
}
