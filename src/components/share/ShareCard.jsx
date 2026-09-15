import TierEmblem from "../rating/TierEmblem.jsx";
import ShareButton from "./ShareButton.jsx";
import { getPlacementLabel, isPlacementComplete } from "../../lib/rating.js";
import { getTierDivision } from "../../lib/tier.js";
import { getEntityDetailPath } from "../../lib/appNavigation.js";

export default function ShareCard({ user }) {
  const mmr = Number(user.ratings.integrated);
  const placementComplete = isPlacementComplete(user.ratings);

  return (
    <div className="share-card ui-design-info-surface">
      <div className="share-card-copy">
        <strong>{user.name}</strong>
        <span className="share-card-tier-copy ui-tier-label">
          {placementComplete ? `${getTierDivision(mmr)} · ${Math.round(mmr)} MMR` : getPlacementLabel(user.ratings)}
        </span>
        <ShareButton className="share-card-action" path={user?.id ? getEntityDetailPath("members", user.id) : ""} title={`${user.name} 프로필`} label="프로필 공유" />
      </div>
      <div className="share-card-emblem" aria-hidden="true">
        <TierEmblem mmr={mmr} ratings={user.ratings} size="hero" />
      </div>
    </div>
  );
}
