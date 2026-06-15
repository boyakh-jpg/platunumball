import { useState } from "react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import ProgressionChecklist from "../components/rating/ProgressionChecklist.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import ShareCard from "../components/share/ShareCard.jsx";

export default function Profile({ app }) {
  const user = app.currentUser;
  const [draft, setDraft] = useState({
    name: user.name,
    position: user.position,
    region: user.region,
    school: user.school,
    company: user.company,
  });
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const submit = (event) => {
    event.preventDefault();
    app.actions.updateProfile(draft);
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Profile</p>
          <h1>프로필</h1>
        </div>
      </header>
      <div className="content-grid">
        <div className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">내 정보</p>
                <h2>{user.handle}</h2>
              </div>
            </div>
            <form className="form-grid" onSubmit={submit}>
              {Object.entries(draft).map(([key, value]) => (
                <label key={key}>
                  {key}
                  <input value={value} onChange={(event) => update({ [key]: event.target.value })} />
                </label>
              ))}
              <Button type="submit">저장</Button>
            </form>
          </Card>
          <section className="mode-grid">
            <RatingCard title="통합" mmr={user.ratings.integrated} subtitle="메인 티어" />
            {Object.entries(user.ratings.modes).map(([mode, mmr]) => (
              <RatingCard key={mode} title={mode} mmr={mmr} subtitle="모드 티어" />
            ))}
          </section>
        </div>
        <aside className="page-stack">
          <ProgressionChecklist user={user} matches={app.state.matches} />
          <ShareCard user={user} match={app.state.matches[0]} />
          <Card className="section-card">
            <div className="contract-grid single">
              <div>
                <span>신뢰도</span>
                <strong>{user.trustScore}</strong>
              </div>
              <div>
                <span>지역</span>
                <strong>{user.region}</strong>
              </div>
              <div>
                <span>학교</span>
                <strong>{user.school}</strong>
              </div>
              <div>
                <span>회사</span>
                <strong>{user.company}</strong>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
