import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import { AFFILIATION_TYPES } from "../lib/constants.js";

export default function Affiliations({ app }) {
  const visibleAffiliations = app.rankings.affiliations.filter((affiliation) => affiliation.type !== "club");
  const userAffiliationNames = new Set([
    app.currentUser.region,
    app.currentUser.school,
    app.currentUser.company,
  ].filter(Boolean));
  const myAffiliations = visibleAffiliations
    .map((affiliation, index) => ({ ...affiliation, rank: index + 1 }))
    .filter((affiliation) => userAffiliationNames.has(affiliation.name));
  const challengeRows = myAffiliations.map((affiliation) => {
    const sameType = visibleAffiliations
      .map((item, index) => ({ ...item, rank: index + 1 }))
      .filter((item) => item.type === affiliation.type)
      .sort((a, b) => b.score - a.score);
    const typeRank = sameType.findIndex((item) => item.id === affiliation.id) + 1;
    const target = typeRank > 1 ? sameType[typeRank - 2] : sameType[1];
    return {
      ...affiliation,
      typeRank,
      target,
      challengeType: typeRank > 1 ? "chase" : "defend",
      gap: target ? Math.abs(Math.round(target.score - affiliation.score)) : 0,
    };
  });

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Affiliations</p>
          <h1>소속별 랭킹</h1>
        </div>
      </header>

      <section className="affiliation-challenge-grid">
        <Card className="section-card affiliation-focus-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">My Affiliation</p>
              <h2>내 소속 비교</h2>
            </div>
            <Badge tone="blue">{myAffiliations.length}개</Badge>
          </div>
          <div className="affiliation-challenge-list">
            {challengeRows.map((affiliation) => (
              <div key={affiliation.id}>
                <span>{AFFILIATION_TYPES[affiliation.type]}</span>
                <strong>{affiliation.name}</strong>
                <em>{affiliation.typeRank}위 · {Math.round(affiliation.score)}점</em>
                <b>
                  {affiliation.target
                    ? affiliation.challengeType === "chase"
                      ? `${affiliation.target.name}까지 ${affiliation.gap}점`
                      : `${affiliation.target.name}보다 ${affiliation.gap}점 앞섬`
                    : "방어전"}
                </b>
              </div>
            ))}
          </div>
        </Card>
        <Card className="section-card affiliation-focus-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Challenge</p>
              <h2>다음 목표</h2>
            </div>
          </div>
          <div className="compact-list">
            {challengeRows.map((affiliation) => (
              <div key={`${affiliation.id}-target`}>
                <span>
                  {affiliation.target
                    ? affiliation.challengeType === "chase"
                      ? `${affiliation.name} → ${affiliation.target.name}`
                      : `${affiliation.name} 1위 방어`
                    : `${affiliation.name} 1위 유지`}
                </span>
                <strong>{affiliation.target ? `${affiliation.gap}점 차` : "TOP"}</strong>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="card-grid">
        {visibleAffiliations.map((affiliation, index) => (
          <Card key={affiliation.id} className="affiliation-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">#{index + 1} {AFFILIATION_TYPES[affiliation.type]}</p>
                <h2>{affiliation.name}</h2>
              </div>
              <Badge tone="blue">{Math.round(affiliation.score)}</Badge>
            </div>
            <div className="stat-strip">
              <span><strong>{affiliation.wins}</strong>승</span>
              <span><strong>{affiliation.losses}</strong>패</span>
              <span><strong>{Math.round((affiliation.wins / Math.max(1, affiliation.wins + affiliation.losses)) * 100)}%</strong>승률</span>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
