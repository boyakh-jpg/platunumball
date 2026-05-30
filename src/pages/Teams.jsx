import { useState } from "react";
import { Crown, PlusCircle, Shield, Swords } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import TeamCard from "../components/team/TeamCard.jsx";
import { COURTS } from "../lib/constants.js";

export default function Teams({ app }) {
  const [draft, setDraft] = useState({ name: "New Court Crew", region: "마포", homeCourt: COURTS[0], accent: "#58d2c0" });
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const topTeam = [...app.state.teams].sort((a, b) => b.mmr - a.mmr)[0];

  const submit = (event) => {
    event.preventDefault();
    app.actions.createTeam(draft);
    setDraft({ name: "New Court Crew", region: "마포", homeCourt: COURTS[0], accent: "#58d2c0" });
  };

  return (
    <div className="page-stack teams-page">
      <section className="team-hub-hero">
        <div>
          <p className="eyebrow">Squad House</p>
          <h1>코트 위 팀 랭크를 장악하세요.</h1>
          <p>정규멤버, 후보, 용병을 나누고 경기 결과에 따라 팀 MMR이 움직입니다.</p>
        </div>
        <div className="team-hub-board">
          <span><Crown size={18} /> Top squad</span>
          <strong>{topTeam?.name}</strong>
          <em>{topTeam?.mmr} MMR · {topTeam?.wins}승 {topTeam?.losses}패</em>
          <div>
            <span><Shield size={16} /> regular core</span>
            <span><Swords size={16} /> official ready</span>
          </div>
        </div>
      </section>
      <div className="content-grid">
        <section className="card-grid">
          {app.state.teams.map((team) => <TeamCard key={team.id} team={team} users={app.state.users} />)}
        </section>
        <Card className="section-card team-create-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Create Squad</p>
              <h2>새 팀 만들기</h2>
            </div>
            <PlusCircle size={22} />
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
            <Button type="submit"><PlusCircle size={18} /> 팀 만들기</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
