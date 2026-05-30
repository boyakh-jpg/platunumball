import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { COURTS, MATCH_MODES } from "../lib/constants.js";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import EvidenceSelector from "../components/match/EvidenceSelector.jsx";
import RuleSelector from "../components/match/RuleSelector.jsx";
import TeamBuilder from "../components/match/TeamBuilder.jsx";

export default function CreateMatch({ app }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState({
    title: "오늘의 5v5 공식전",
    mode: "5v5",
    court: COURTS[0],
    scheduledAt: "오늘 20:30",
    teamAId: app.state.teams[0]?.id,
    teamBId: app.state.teams[1]?.id,
    official: true,
    preRegistered: true,
    targetScore: 21,
    timeLimit: 12,
    ball: "7호 공",
    winByTwo: true,
    evidence: [],
    memo: "경기 전 룰을 확정하고, 경기 후 결과를 승인하면 티어에 반영됩니다.",
  });
  const selectedTeams = useMemo(
    () => app.state.teams.filter((team) => team.id === draft.teamAId || team.id === draft.teamBId),
    [app.state.teams, draft.teamAId, draft.teamBId],
  );

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const submit = (event) => {
    event.preventDefault();
    const matchId = app.actions.createMatch(draft);
    navigate(matchId ? `/app/matches/${matchId}` : "/app/matches");
  };

  return (
    <form className="page-stack" onSubmit={submit}>
      <header className="page-header">
        <div>
          <p className="eyebrow">CreateMatch</p>
          <h1>오늘의 판 만들기</h1>
        </div>
        <Button type="submit">경기 생성</Button>
      </header>

      <div className="content-grid wide-left">
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">기본 설정</p>
              <h2>경기 정보</h2>
            </div>
          </div>
          <div className="form-grid">
            <label>
              제목
              <input value={draft.title} onChange={(event) => update({ title: event.target.value })} />
            </label>
            <label>
              방식
              <select value={draft.mode} onChange={(event) => update({ mode: event.target.value })}>
                {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
              </select>
            </label>
            <label>
              코트
              <select value={draft.court} onChange={(event) => update({ court: event.target.value })}>
                {COURTS.map((court) => <option key={court}>{court}</option>)}
              </select>
            </label>
            <label>
              시간
              <input value={draft.scheduledAt} onChange={(event) => update({ scheduledAt: event.target.value })} />
            </label>
          </div>
        </Card>

        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">규칙</p>
              <h2>룰 설정</h2>
            </div>
          </div>
          <RuleSelector draft={draft} onChange={update} />
          <div className="toggle-pair">
            <label><input type="checkbox" checked={draft.official} onChange={(event) => update({ official: event.target.checked })} /> 공식경기</label>
            <label><input type="checkbox" checked={draft.preRegistered} onChange={(event) => update({ preRegistered: event.target.checked })} /> 사전등록</label>
          </div>
        </Card>

        <Card className="section-card full-span">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">팀 설정</p>
              <h2>참여 팀</h2>
            </div>
          </div>
          <div className="form-grid two">
            <label>
              Team A
              <select value={draft.teamAId} onChange={(event) => update({ teamAId: event.target.value })}>
                {app.state.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label>
              Team B
              <select value={draft.teamBId} onChange={(event) => update({ teamBId: event.target.value })}>
                {app.state.teams.filter((team) => team.id !== draft.teamAId).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
          </div>
          <TeamBuilder teams={selectedTeams} users={app.state.users} draft={draft} onChange={update} />
        </Card>

        <Card className="section-card full-span">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">증빙자료</p>
              <h2>공신력 옵션</h2>
            </div>
          </div>
          <EvidenceSelector selected={draft.evidence} onChange={(evidence) => update({ evidence })} />
          <label className="memo-label">
            경기 메모
            <textarea value={draft.memo} onChange={(event) => update({ memo: event.target.value })} />
          </label>
        </Card>
      </div>
    </form>
  );
}
