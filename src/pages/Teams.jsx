import { useState } from "react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import TeamCard from "../components/team/TeamCard.jsx";
import { COURTS } from "../lib/constants.js";

export default function Teams({ app }) {
  const [draft, setDraft] = useState({ name: "New Court Crew", region: "마포", homeCourt: COURTS[0], accent: "#58d2c0" });
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const submit = (event) => {
    event.preventDefault();
    app.actions.createTeam(draft);
    setDraft({ name: "New Court Crew", region: "마포", homeCourt: COURTS[0], accent: "#58d2c0" });
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Teams</p>
          <h1>팀</h1>
        </div>
      </header>
      <div className="content-grid">
        <section className="card-grid">
          {app.state.teams.map((team) => <TeamCard key={team.id} team={team} users={app.state.users} />)}
        </section>
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">팀 만들기</p>
              <h2>새 팀</h2>
            </div>
          </div>
          <form className="form-stack" onSubmit={submit}>
            <label>
              팀 이름
              <input value={draft.name} onChange={(event) => update({ name: event.target.value })} />
            </label>
            <label>
              지역
              <input value={draft.region} onChange={(event) => update({ region: event.target.value })} />
            </label>
            <label>
              홈 코트
              <select value={draft.homeCourt} onChange={(event) => update({ homeCourt: event.target.value })}>
                {COURTS.map((court) => <option key={court}>{court}</option>)}
              </select>
            </label>
            <label>
              팀 컬러
              <input type="color" value={draft.accent} onChange={(event) => update({ accent: event.target.value })} />
            </label>
            <Button type="submit">팀 만들기</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
