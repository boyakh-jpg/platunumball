import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Handshake, MapPin, PlusCircle, Swords } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import { COURTS, MATCH_MODES, PLAYER_POSITIONS, REGIONS } from "../lib/constants.js";
import {
  RECRUITING_TYPES,
  getRecruitingFit,
  getRecruitingTierRange,
  getRecruitingTargetMmr,
  isNationalRecruitingPost,
} from "../lib/recruiting.js";

function formatApplicants(post, userById) {
  return (post.applicants ?? []).map((userId) => userById[userId]).filter(Boolean);
}

export default function Recruiting({ app }) {
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const [scope, setScope] = useState("local");
  const [queue, setQueue] = useState("all");
  const [draft, setDraft] = useState(() => ({
    type: "need_player",
    title: RECRUITING_TYPES.need_player.emptyTitle,
    region: app.currentUser.region,
    court: COURTS.find((court) => court.region === app.currentUser.region)?.name ?? COURTS[0].name,
    mode: "5v5",
    ranked: true,
    spots: 1,
    teamId: myTeams[0]?.id ?? "",
    position: "상관없음",
    memo: "포지션은 맞춰볼게요. 경기 전 룰만 먼저 확인해요.",
  }));

  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const selectedTeam = myTeams.find((team) => team.id === draft.teamId) ?? myTeams[0] ?? null;
  const targetMmr = draft.type === "need_player" ? selectedTeam?.mmr ?? 1200 : app.currentUser.ratings.integrated;
  const draftRange = getRecruitingTierRange(targetMmr, draft.ranked);
  const canPostRecruiting = draft.type !== "need_player" || Boolean(selectedTeam);

  useEffect(() => {
    if (draft.type !== "need_player") return;
    if (selectedTeam && draft.teamId === selectedTeam.id) return;
    setDraft((current) => ({ ...current, teamId: myTeams[0]?.id ?? "" }));
  }, [draft.teamId, draft.type, myTeams, selectedTeam]);

  const posts = useMemo(() => {
    return [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status !== "closed")
      .filter((post) => scope !== "local" || post.region === app.currentUser.region || isNationalRecruitingPost(post, app.state))
      .filter((post) => queue === "all" || (queue === "ranked" ? post.ranked !== false : post.ranked === false))
      .sort((a, b) => {
        const aLocal = Number(a.region === app.currentUser.region);
        const bLocal = Number(b.region === app.currentUser.region);
        const aNational = Number(isNationalRecruitingPost(a, app.state));
        const bNational = Number(isNationalRecruitingPost(b, app.state));
        return bLocal - aLocal || bNational - aNational || new Date(b.createdAt) - new Date(a.createdAt);
      });
  }, [app.currentUser.region, app.state, queue, scope]);

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const submit = (event) => {
    event.preventDefault();
    app.actions.createRecruitingPost(draft);
    setDraft((current) => ({
      ...current,
      title: RECRUITING_TYPES[current.type].emptyTitle,
      memo: "포지션은 맞춰볼게요. 경기 전 룰만 먼저 확인해요.",
    }));
  };

  return (
    <div className="page-stack recruiting-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Recruiting</p>
          <h1>지역 용병 매칭</h1>
        </div>
        <Badge tone="green">{app.currentUser.region} 먼저</Badge>
      </header>

      <section className="content-grid wide-left">
        <Card className="section-card recruiting-board-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>용병/팀 찾기</h2>
            </div>
            <div className="segmented-control compact-segments">
              <button type="button" className={scope === "local" ? "active" : ""} onClick={() => setScope("local")}>내 지역</button>
              <button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>전체</button>
            </div>
          </div>
          <div className="segmented-control compact-segments">
            <button type="button" className={queue === "all" ? "active" : ""} onClick={() => setQueue("all")}>전체</button>
            <button type="button" className={queue === "ranked" ? "active" : ""} onClick={() => setQueue("ranked")}>랭크 반영</button>
            <button type="button" className={queue === "friendly" ? "active" : ""} onClick={() => setQueue("friendly")}>친선</button>
          </div>

          <div className="recruiting-post-list">
            {posts.map((post) => {
              const typeMeta = RECRUITING_TYPES[post.type] ?? RECRUITING_TYPES.need_player;
              const owner = userById[post.playerId];
              const team = teamById[post.teamId];
              const applicants = formatApplicants(post, userById);
              const fit = getRecruitingFit(post, app.currentUser.ratings.integrated, app.state);
              const target = getRecruitingTargetMmr(post, app.state);
              const applied = (post.applicants ?? []).includes(app.currentUser.id);
              const mine = post.playerId === app.currentUser.id;
              const blockedByTier = !fit.allowed;

              return (
                <article key={post.id} className="recruiting-post">
                  <div className="recruiting-post-main">
                    <div className="badge-row">
                      <Badge tone={post.ranked === false ? "neutral" : "green"}>{post.ranked === false ? "친선" : "랭크 반영"}</Badge>
                      <Badge tone={fit.tone}>{fit.label}</Badge>
                      <Badge tone="blue">{post.position && post.position !== "상관없음" ? post.position : "포지션 자유"}</Badge>
                      {isNationalRecruitingPost(post, app.state) ? <Badge tone="gold">전국구</Badge> : null}
                    </div>
                    <h3>{post.title}</h3>
                    <p>
                      <MapPin size={15} />
                      {post.region} · {post.court} · {post.mode}
                    </p>
                    <div className="recruiting-owner-line">
                      <span>{typeMeta.shortLabel}</span>
                      {team ? <Link to={`/app/teams/${team.id}`}>{team.name}</Link> : null}
                      {owner ? <Link to={`/app/players/${owner.id}`}>{owner.name}</Link> : null}
                    </div>
                  </div>
                  <div className="recruiting-fit-panel">
                    <span>{post.ranked === false ? "참고 티어" : "허용 구간"}</span>
                    <strong>{fit.range.label}</strong>
                    <em>{post.ranked === false ? "제한 없음" : `${target} MMR 기준`}</em>
                  </div>
                  <p className="recruiting-memo">{post.memo}</p>
                  <div className="applicant-row">
                    {applicants.length ? applicants.slice(0, 4).map((user) => (
                      <span key={user.id} className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
                    )) : <small>아직 관심 표시 없음</small>}
                    <strong>{applicants.length}/{post.spots}</strong>
                  </div>
                  <div className="recruiting-actions">
                    <Button
                      type="button"
                      variant={applied || blockedByTier ? "secondary" : "primary"}
                      disabled={applied || mine || blockedByTier}
                      onClick={() => app.actions.interestRecruitingPost(post.id)}
                    >
                      <Handshake size={17} /> {mine ? "내 모집글" : blockedByTier ? "티어 구간 밖" : applied ? "관심 표시 완료" : "관심 표시"}
                    </Button>
                    {mine ? <Button type="button" variant="secondary" onClick={() => app.actions.closeRecruitingPost(post.id)}>마감</Button> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </Card>

        <aside className="page-stack">
          <Card className="section-card recruiting-compose-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Post</p>
                <h2>모집 올리기</h2>
              </div>
              <Swords size={22} />
            </div>
            <form className="form-stack" onSubmit={submit}>
              <div className="segmented-control compact-segments">
                {Object.entries(RECRUITING_TYPES).map(([type, meta]) => (
                  <button
                    key={type}
                    type="button"
                    className={draft.type === type ? "active" : ""}
                    onClick={() => update({ type, title: meta.emptyTitle, position: type === "find_team" ? app.currentUser.position : "상관없음" })}
                  >
                    {meta.label}
                  </button>
                ))}
              </div>
              <div className="toggle-pair flush-toggle">
                <label><input type="checkbox" checked={draft.ranked} onChange={(event) => update({ ranked: event.target.checked })} /> 랭크 반영 경기</label>
              </div>
              <label>
                제목
                <input value={draft.title} onChange={(event) => update({ title: event.target.value })} />
              </label>
              <div className="form-grid two">
                <label>
                  지역
                  <select
                    value={draft.region}
                    onChange={(event) => {
                      const region = event.target.value;
                      update({ region, court: COURTS.find((court) => court.region === region)?.name ?? draft.court });
                    }}
                  >
                    {REGIONS.map((region) => <option key={region}>{region}</option>)}
                  </select>
                </label>
                <label>
                  방식
                  <select value={draft.mode} onChange={(event) => update({ mode: event.target.value })}>
                    {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                  </select>
                </label>
              </div>
              <label>
                코트
                <select value={draft.court} onChange={(event) => update({ court: event.target.value })}>
                  {COURTS.filter((court) => court.region === draft.region || draft.region === "전체").map((court) => (
                    <option key={court.id} value={court.name}>{court.region} · {court.name}</option>
                  ))}
                </select>
              </label>
              {draft.type === "need_player" ? (
                <label>
                  모집 팀
                  <select value={draft.teamId} onChange={(event) => update({ teamId: event.target.value })}>
                    {myTeams.map((team) => (
                      <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {draft.type === "need_player" ? (
                <p className={canPostRecruiting ? "form-help" : "form-warning"}>
                  {canPostRecruiting ? "용병 모집은 내 소속팀으로만 올릴 수 있습니다." : "소속팀이 있어야 용병 모집을 올릴 수 있습니다."}
                </p>
              ) : null}
              <div className="position-tab-group">
                <span>포지션</span>
                <div className="segmented-control compact-segments position-segments">
                  {PLAYER_POSITIONS.map((position) => (
                    <button
                      key={position}
                      type="button"
                      className={draft.position === position ? "active" : ""}
                      onClick={() => update({ position })}
                    >
                      {position}
                    </button>
                  ))}
                </div>
              </div>
              <label>
                필요 인원
                <input type="number" min="1" max="5" value={draft.spots} onChange={(event) => update({ spots: event.target.value })} />
              </label>
              <div className="tier-range-note">
                <div>
                  <span>{draft.ranked ? "랭크 허용 구간" : "친선 매칭"}</span>
                  <strong>{draftRange.label}</strong>
                  <em>{draftRange.detail}</em>
                </div>
                <TierBadge mmr={targetMmr} compact />
              </div>
              <label className="memo-label">
                메모
                <textarea value={draft.memo} onChange={(event) => update({ memo: event.target.value })} />
              </label>
              <Button type="submit" disabled={!canPostRecruiting}><PlusCircle size={18} /> 모집글 올리기</Button>
            </form>
          </Card>
        </aside>
      </section>
    </div>
  );
}
