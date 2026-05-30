import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import { AFFILIATION_TYPES } from "../lib/constants.js";

export default function Affiliations({ app }) {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Affiliations</p>
          <h1>소속 랭킹</h1>
        </div>
      </header>
      <section className="card-grid">
        {app.rankings.affiliations.map((affiliation, index) => (
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
