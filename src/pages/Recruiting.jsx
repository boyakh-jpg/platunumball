import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MapPin, PlusCircle, ShieldCheck, Swords, UserRound, UsersRound } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import { COURTS, MATCH_MODES, PLAYER_POSITIONS, REGIONS } from "../lib/constants.js";
import {
  RECRUITING_TYPES,
  getRecruitingApplicantKind,
  getRecruitingFit,
  getRecruitingTierRange,
  getRecruitingTargetMmr,
  hasRecruitingApplicant,
  isNationalRecruitingPost,
  normalizeRecruitingApplicants,
} from "../lib/recruiting.js";

function getDefaultMemo(type) {
  if (type === "need_team") return "비슷한 티어 팀이면 바로 경기방 만들고 양팀 동의로 진행해요.";
  if (type === "find_team") return "혼자 참여 가능합니다. 포지션과 시간만 맞으면 바로 들어갈게요.";
  return "포지션은 맞춰볼게요. 경기 전 룰만 먼저 확인해요.";
}

function formatApplicants(post, userById, teamById) {
  return normalizeRecruitingApplicants(post.applicants ?? [])
    .map((applicant) => ({
      ...applicant,
      user: applicant.playerId ? userById[applicant.playerId] : null,
      team: applicant.teamId ? teamById[applicant.teamId] : null,
    }))
    .filter((applicant) => applicant.kind === "team" ? applicant.team : applicant.user);
}

function getDefaultApplyTeamId(post, teams) {
  return teams.find((team) => team.region === post.region)?.id ?? teams[0]?.id ?? "";
}

function getPostApplyTeamId(post, teams, selectedByPost) {
  return selectedByPost[post.id] ?? getDefaultApplyTeamId(post, teams);
}

export default function Recruiting({ app }) {
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const [scope, setScope] = useState("local");
  const [queue, setQueue] = useState("all");
  const [unit, setUnit] = useState("all");
  const [applyTeamByPost, setApplyTeamByPost] = useState({});
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
    memo: getDefaultMemo("need_player"),
  }));

  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const selectedTeam = myTeams.find((team) => team.id === draft.teamId) ?? myTeams[0] ?? null;
  const posterNeedsTeam = draft.type !== "find_team";
  const targetMmr = draft.type === "find_team" ? app.currentUser.ratings.integrated : selectedTeam?.mmr ?? 1200;
  const draftRange = getRecruitingTierRange(targetMmr, draft.ranked);
  const canPostRecruiting = !posterNeedsTeam || Boolean(selectedTeam);

  useEffect(() => {
    if (!posterNeedsTeam) return;
    if (selectedTeam && draft.teamId === selectedTeam.id) return;
    setDraft((current) => ({ ...current, teamId: myTeams[0]?.id ?? "" }));
  }, [draft.teamId, myTeams, posterNeedsTeam, selectedTeam]);

  const posts = useMemo(() => {
    return [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status !== "closed")
      .filter((post) => scope !== "local" || post.region === app.currentUser.region || isNationalRecruitingPost(post, app.state))
      .filter((post) => queue === "all" || (queue === "ranked" ? post.ranked !== false : post.ranked === false))
      .filter((post) => unit === "all" || (unit === "solo" ? getRecruitingApplicantKind(post) === "player" : getRecruitingApplicantKind(post) === "team"))
      .sort((a, b) => {
        const aLocal = Number(a.region === app.currentUser.region);
        const bLocal = Number(b.region === app.currentUser.region);
        const aNational = Number(isNationalRecruitingPost(a, app.state));
        const bNational = Number(isNationalRecruitingPost(b, app.state));
        return bLocal - aLocal || bNational - aNational || new Date(b.createdAt) - new Date(a.createdAt);
      });
  }, [app.currentUser.region, app.state, queue, scope, unit]);

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const changeType = (type) => {
    const meta = RECRUITING_TYPES[type] ?? RECRUITING_TYPES.need_player;
    update({
      type,
      title: meta.emptyTitle,
      teamId: type === "find_team" ? "" : myTeams[0]?.id ?? "",
      spots: 1,
      position: type === "find_team" ? app.currentUser.position : "상관없음",
      memo: getDefaultMemo(type),
    });
  };
  const submit = (event) => {
    event.preventDefault();
    app.actions.createRecruitingPost(draft);
    setDraft((current) => ({
      ...current,
      title: RECRUITING_TYPES[current.type].emptyTitle,
      memo: getDefaultMemo(current.type),
    }));
  };

  return (
    <div className="page-stack recruiting-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Recruiting Queue</p>
          <h1>빠른대전/경쟁전 모집 큐</h1>
        </div>
        <Badge tone="green">{app.currentUser.region} 먼저</Badge>
      </header>

      <section className="content-grid wide-left">
        <Card className="section-card recruiting-board-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>혼자 또는 팀으로 참여</h2>
            </div>
            <div className="segmented-control compact-segments">
              <button type="button" className={scope === "local" ? "active" : ""} onClick={() => setScope("local")}>내 지역</button>
              <button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>전체</button>
            </div>
          </div>
          <div className="queue-filter-grid">
            <div className="segmented-control compact-segments">
              <button type="button" className={queue === "all" ? "active" : ""} onClick={() => setQueue("all")}>전체</button>
              <button type="button" className={queue === "ranked" ? "active" : ""} onClick={() => setQueue("ranked")}>경쟁전</button>
              <button type="button" className={queue === "friendly" ? "active" : ""} onClick={() => setQueue("friendly")}>빠른대전</button>
            </div>
            <div className="segmented-control compact-segments">
              <button type="button" className={unit === "all" ? "active" : ""} onClick={() => setUnit("all")}>전체</button>
              <button type="button" className={unit === "solo" ? "active" : ""} onClick={() => setUnit("solo")}>혼자 참여</button>
              <button type="button" className={unit === "team" ? "active" : ""} onClick={() => setUnit("team")}>팀 참여</button>
            </div>
          </div>

          <div className="recruiting-post-list">
            {posts.map((post) => {
              const typeMeta = RECRUITING_TYPES[post.type] ?? RECRUITING_TYPES.need_player;
              const applicantKind = getRecruitingApplicantKind(post);
              const owner = userById[post.playerId];
              const team = teamById[post.teamId];
              const applicants = formatApplicants(post, userById, teamById);
              const applyTeamId = getPostApplyTeamId(post, myTeams, applyTeamByPost);
              const applyTeam = teamById[applyTeamId];
              const candidateMmr = applicantKind === "team" ? applyTeam?.mmr ?? 0 : app.currentUser.ratings.integrated;
              const fit = getRecruitingFit(post, candidateMmr || app.currentUser.ratings.integrated, app.state);
              const target = getRecruitingTargetMmr(post, app.state);
              const applicantEntry = applicantKind === "team"
                ? { kind: "team", teamId: applyTeamId }
                : { kind: "player", playerId: app.currentUser.id };
              const applied = hasRecruitingApplicant(post, applicantEntry);
              const mine = post.playerId === app.currentUser.id;
              const needsTeamApplication = applicantKind === "team";
              const noTeam = needsTeamApplication && !myTeams.length;
              const blockedByTier = !fit.allowed;

              return (
                <article key={post.id} className="recruiting-post">
                  <div className="recruiting-post-main">
                    <div className="badge-row">
                      <Badge tone={post.ranked === false ? "neutral" : "green"}>{post.ranked === false ? "빠른대전" : "경쟁전"}</Badge>
                      <Badge tone={applicantKind === "team" ? "blue" : "gold"}>{typeMeta.unitLabel}</Badge>
                      <Badge tone={fit.tone}>{fit.label}</Badge>
                      {post.position && post.position !== "상관없음" ? <Badge tone="blue">{post.position}</Badge> : null}
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
                    <span>{post.ranked === false ? "빠른대전" : "경쟁전 허용 구간"}</span>
                    <strong>{fit.range.label}</strong>
                    <em>{post.ranked === false ? "티어 제한 없음" : `${target} MMR 기준`}</em>
                  </div>
                  <p className="recruiting-memo">{post.memo}</p>
                  <div className="applicant-row">
                    {applicants.length ? applicants.slice(0, 4).map((applicant) => (
                      applicant.kind === "team" ? (
                        <span key={`team-${applicant.team.id}`} className="applicant-team-chip">
                          <span className="team-mini-dot" style={{ "--team-color": applicant.team.accent }} />
                          {applicant.team.name}
                        </span>
                      ) : (
                        <span key={`player-${applicant.user.id}`} className="avatar small" style={{ "--avatar": applicant.user.avatarColor }}>{applicant.user.name.slice(0, 1)}</span>
                      )
                    )) : <small>아직 신청 없음</small>}
                    <strong>{applicants.length}/{post.spots}</strong>
                  </div>
                  <div className="recruiting-actions">
                    {needsTeamApplication && !mine ? (
                      <select
                        className="recruiting-apply-select"
                        disabled={!myTeams.length}
                        value={applyTeamId}
                        onChange={(event) => setApplyTeamByPost((current) => ({ ...current, [post.id]: event.target.value }))}
                      >
                        {myTeams.length ? myTeams.map((item) => (
                          <option key={item.id} value={item.id}>{item.name} · {item.mmr}</option>
                        )) : <option value="">소속팀 없음</option>}
                      </select>
                    ) : null}
                    <Button
                      type="button"
                      variant={applied || blockedByTier || noTeam ? "secondary" : "primary"}
                      disabled={applied || mine || blockedByTier || noTeam}
                      onClick={() => app.actions.interestRecruitingPost(post.id, needsTeamApplication ? { teamId: applyTeamId } : undefined)}
                    >
                      {needsTeamApplication ? <UsersRound size={17} /> : <UserRound size={17} />}
                      {mine ? "내 모집글" : noTeam ? "소속팀 필요" : blockedByTier ? "티어 구간 밖" : applied ? "신청 완료" : typeMeta.actionLabel}
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
              <div className="recruiting-type-grid">
                {Object.entries(RECRUITING_TYPES).map(([type, meta]) => (
                  <button
                    key={type}
                    type="button"
                    className={draft.type === type ? "active" : ""}
                    onClick={() => changeType(type)}
                  >
                    {meta.applicantKind === "team" ? <UsersRound size={18} /> : <UserRound size={18} />}
                    <strong>{meta.label}</strong>
                    <span>{meta.shortLabel}</span>
                  </button>
                ))}
              </div>
              <div className="segmented-control compact-segments">
                <button type="button" className={!draft.ranked ? "active" : ""} onClick={() => update({ ranked: false })}>빠른대전</button>
                <button type="button" className={draft.ranked ? "active" : ""} onClick={() => update({ ranked: true })}>경쟁전</button>
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
              {posterNeedsTeam ? (
                <label>
                  내 팀
                  <select value={draft.teamId} onChange={(event) => update({ teamId: event.target.value })}>
                    {myTeams.map((team) => (
                      <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {posterNeedsTeam ? (
                <p className={canPostRecruiting ? "form-help" : "form-warning"}>
                  {canPostRecruiting ? "팀원 모집과 팀 큐는 내 소속팀으로만 올릴 수 있습니다." : "소속팀이 있어야 팀 단위 모집을 올릴 수 있습니다."}
                </p>
              ) : null}
              {draft.type !== "need_team" ? (
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
              ) : null}
              <label>
                {draft.type === "need_player" ? "필요 인원" : "필요 팀 수"}
                <input type="number" min="1" max={draft.type === "need_player" ? "5" : "4"} value={draft.spots} onChange={(event) => update({ spots: event.target.value })} />
              </label>
              <div className="tier-range-note">
                <div>
                  <span>{draft.ranked ? "경쟁전 허용 구간" : "빠른대전"}</span>
                  <strong>{draftRange.label}</strong>
                  <em>{draftRange.detail}</em>
                </div>
                <TierBadge mmr={targetMmr} compact />
              </div>
              <div className="queue-note">
                <ShieldCheck size={17} />
                <span>{draft.ranked ? "경쟁전은 기준 MMR에서 위아래 두 티어까지만 신청됩니다." : "빠른대전은 티어 제한 없이 신청되고, 기록 반영은 약하게 처리됩니다."}</span>
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
