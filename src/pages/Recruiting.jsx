import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MapPin, PlusCircle, ShieldCheck, Swords, UserRound, UsersRound, X } from "lucide-react";
import Button from "../components/common/Button.jsx";
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

const TYPE_VIEW = {
  need_player: {
    code: "PLAYER",
    title: "용병 구함",
    desc: "팀이 뛸 사람을 찾음",
    icon: UserRound,
  },
  find_team: {
    code: "SOLO",
    title: "팀 찾기",
    desc: "혼자 들어갈 팀을 찾음",
    icon: UsersRound,
  },
  need_team: {
    code: "TEAM",
    title: "상대 구함",
    desc: "팀 대 팀 경기를 찾음",
    icon: Swords,
  },
};

function getDefaultMemo(type) {
  if (type === "need_team") return "동급 팀 우선.";
  if (type === "find_team") return "바로 참여 가능.";
  return "포지션 협의 가능.";
}

function getDefaultTitle(type) {
  if (type === "find_team") return "오늘 뛸 팀 구함";
  if (type === "need_team") return "상대팀 구함";
  return "용병 1명";
}

function formatApplicants(post, userById, teamById) {
  return normalizeRecruitingApplicants(post.applicants ?? [])
    .map((applicant) => ({
      ...applicant,
      user: applicant.playerId ? userById[applicant.playerId] : null,
      team: applicant.teamId ? teamById[applicant.teamId] : null,
    }))
    .filter((applicant) => (applicant.kind === "team" ? applicant.team : applicant.user));
}

function getDefaultApplyTeamId(post, teams) {
  return teams.find((team) => team.region === post.region)?.id ?? teams[0]?.id ?? "";
}

function getPostApplyTeamId(post, teams, selectedByPost) {
  return selectedByPost[post.id] ?? getDefaultApplyTeamId(post, teams);
}

function formatWhen(value) {
  if (!value) return "방금";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "방금";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function getQueueLabel(post) {
  return post.ranked === false ? "친선" : "정규";
}

function getButtonLabel({ mine, noTeam, blockedByTier, full, applied, typeMeta }) {
  if (mine) return "내 글";
  if (noTeam) return "팀 필요";
  if (blockedByTier) return "티어 불가";
  if (full) return "마감";
  if (applied) return "완료";
  return typeMeta.actionLabel;
}

export default function Recruiting({ app }) {
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const [scope, setScope] = useState("local");
  const [queue, setQueue] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [composeOpen, setComposeOpen] = useState(false);
  const [applyTeamByPost, setApplyTeamByPost] = useState({});
  const [draft, setDraft] = useState(() => ({
    type: "need_player",
    title: getDefaultTitle("need_player"),
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

  const visibleBasePosts = useMemo(() => {
    return [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status !== "closed")
      .filter((post) => scope !== "local" || post.region === app.currentUser.region || isNationalRecruitingPost(post, app.state))
      .filter((post) => queue === "all" || (queue === "ranked" ? post.ranked !== false : post.ranked === false));
  }, [app.currentUser.region, app.state, queue, scope]);

  const posts = useMemo(() => {
    return visibleBasePosts
      .filter((post) => typeFilter === "all" || post.type === typeFilter)
      .sort((a, b) => {
        const aLocal = Number(a.region === app.currentUser.region);
        const bLocal = Number(b.region === app.currentUser.region);
        const aNational = Number(isNationalRecruitingPost(a, app.state));
        const bNational = Number(isNationalRecruitingPost(b, app.state));
        return bLocal - aLocal || bNational - aNational || new Date(b.createdAt) - new Date(a.createdAt);
      });
  }, [app.currentUser.region, app.state, typeFilter, visibleBasePosts]);

  const typeCounts = useMemo(() => {
    return Object.keys(RECRUITING_TYPES).reduce((acc, type) => {
      acc[type] = visibleBasePosts.filter((post) => post.type === type).length;
      return acc;
    }, {});
  }, [visibleBasePosts]);

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const changeDraftType = (type) => {
    update({
      type,
      title: getDefaultTitle(type),
      teamId: type === "find_team" ? "" : myTeams[0]?.id ?? "",
      spots: 1,
      position: type === "find_team" ? app.currentUser.position : "상관없음",
      memo: getDefaultMemo(type),
    });
  };
  const openComposeForType = (type = draft.type) => {
    if (type !== draft.type) changeDraftType(type);
    setComposeOpen(true);
  };
  const submit = (event) => {
    event.preventDefault();
    app.actions.createRecruitingPost({ ...draft, title: draft.title || getDefaultTitle(draft.type) });
    setDraft((current) => ({
      ...current,
      title: getDefaultTitle(current.type),
      memo: getDefaultMemo(current.type),
    }));
    setComposeOpen(false);
  };

  const rankedCount = visibleBasePosts.filter((post) => post.ranked !== false).length;
  const friendlyCount = visibleBasePosts.length - rankedCount;

  return (
    <div className="page-stack ow-recruit-page">
      <section className="ow-recruit-hero">
        <div className="ow-hero-copy">
          <span className="ow-kicker">RECRUIT QUEUE</span>
          <h1>용병 큐</h1>
          <p>오늘 뛸 사람, 들어갈 팀, 붙을 상대팀만 빠르게 고른다.</p>
        </div>
        <div className="ow-hero-panel">
          <div className="ow-hero-stats">
            <span><strong>{visibleBasePosts.length}</strong>OPEN</span>
            <span><strong>{rankedCount}</strong>RANKED</span>
            <span><strong>{friendlyCount}</strong>FRIENDLY</span>
          </div>
          <Button type="button" className="ow-hero-cta" onClick={() => openComposeForType(typeFilter === "all" ? "need_player" : typeFilter)}>
            <PlusCircle size={18} /> 모집 시작
          </Button>
        </div>
      </section>

      <section className="ow-mode-grid" aria-label="모집 유형">
        {Object.entries(TYPE_VIEW).map(([type, view]) => {
          const Icon = view.icon;
          return (
            <button
              key={type}
              type="button"
              className={`ow-mode-card ${typeFilter === type ? "active" : ""}`}
              onClick={() => setTypeFilter(typeFilter === type ? "all" : type)}
            >
              <span className="ow-mode-icon"><Icon size={23} /></span>
              <span className="ow-mode-copy">
                <span className="ow-mode-code">{view.code}</span>
                <h2>{view.title}</h2>
                <p>{view.desc}</p>
              </span>
              <span className="ow-mode-count">{typeCounts[type] ?? 0} 대기</span>
            </button>
          );
        })}
      </section>

      <section className="ow-filter-bar" aria-label="필터">
        <button type="button" className={scope === "local" ? "active" : ""} onClick={() => setScope("local")}>내 지역</button>
        <button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>전체 지역</button>
        <button type="button" className={queue === "all" ? "active" : ""} onClick={() => setQueue("all")}>전체</button>
        <button type="button" className={queue === "ranked" ? "active" : ""} onClick={() => setQueue("ranked")}>정규</button>
        <button type="button" className={queue === "friendly" ? "active" : ""} onClick={() => setQueue("friendly")}>친선</button>
        <button type="button" className={typeFilter === "all" ? "active" : ""} onClick={() => setTypeFilter("all")}>타입 전체</button>
        <span className="ow-filter-count">{posts.length}개 표시</span>
      </section>

      <section className="ow-recruit-list" aria-label="모집글 목록">
        {posts.length ? posts.map((post) => {
          const typeMeta = RECRUITING_TYPES[post.type] ?? RECRUITING_TYPES.need_player;
          const typeView = TYPE_VIEW[post.type] ?? TYPE_VIEW.need_player;
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
          const full = applicants.length >= Number(post.spots ?? 1);
          const disabled = applied || mine || blockedByTier || noTeam || full;
          const canShowTeamSelect = needsTeamApplication && !mine && !applied && !full;

          return (
            <article key={post.id} className={`ow-recruit-card ow-type-${post.type} ${disabled ? "ow-state-blocked" : ""} ${full ? "ow-state-full" : ""}`}>
              <div className="ow-card-main">
                <div className="ow-card-top">
                  <span className="ow-type-tag">{typeView.code}</span>
                  <span className={`ow-queue-pill ${post.ranked === false ? "friendly" : "ranked"}`}>{getQueueLabel(post)}</span>
                  {post.position && post.position !== "상관없음" ? <span className="ow-position-pill">{post.position}</span> : null}
                </div>
                <h3>{post.title}</h3>
                <div className="ow-card-meta">
                  <MapPin size={15} />
                  <span>{post.region} · {post.court} · {post.mode}</span>
                </div>
                <div className="ow-card-bottom">
                  <span className="ow-tier-chip">{post.ranked === false ? "티어 자유" : fit.range.label}</span>
                  <span>{formatWhen(post.createdAt)}</span>
                  {isNationalRecruitingPost(post, app.state) ? <span>전국구</span> : null}
                </div>
              </div>

              <div className="ow-card-side">
                <span className="ow-slot-count"><strong>{applicants.length}/{post.spots}</strong><span>신청</span></span>
                <Button
                  type="button"
                  className="ow-card-action"
                  variant={disabled ? "secondary" : "primary"}
                  disabled={disabled}
                  onClick={() => app.actions.interestRecruitingPost(post.id, needsTeamApplication ? { teamId: applyTeamId } : undefined)}
                >
                  {needsTeamApplication ? <UsersRound size={16} /> : <UserRound size={16} />}
                  {getButtonLabel({ mine, noTeam, blockedByTier, full, applied, typeMeta })}
                </Button>
              </div>

              <details className="ow-card-details">
                <summary>상세 보기</summary>
                <div className="ow-details-grid">
                  <span>
                    작성자
                    {owner ? <Link to={`/app/players/${owner.id}`}>{owner.name}</Link> : <b>알 수 없음</b>}
                  </span>
                  <span>
                    기준
                    <b>{target} MMR · {fit.label}</b>
                  </span>
                  <span>
                    유형
                    <b>{typeMeta.shortLabel}</b>
                  </span>
                  {team ? (
                    <span>
                      팀
                      <Link to={`/app/teams/${team.id}`}>{team.name}</Link>
                    </span>
                  ) : null}
                  {canShowTeamSelect ? (
                    <label>
                      신청 팀
                      <select
                        value={applyTeamId}
                        disabled={!myTeams.length}
                        onChange={(event) => setApplyTeamByPost((current) => ({ ...current, [post.id]: event.target.value }))}
                      >
                        {myTeams.length ? myTeams.map((item) => (
                          <option key={item.id} value={item.id}>{item.name} · {item.mmr}</option>
                        )) : <option value="">소속팀 없음</option>}
                      </select>
                    </label>
                  ) : null}
                  <p className="ow-details-memo">{post.memo}</p>
                  <div className="ow-applicant-strip">
                    {applicants.length ? applicants.slice(0, 6).map((applicant) => (
                      applicant.kind === "team" ? (
                        <span key={`team-${applicant.team.id}`} className="ow-applicant-team">
                          <span className="ow-mini-dot" style={{ "--team-color": applicant.team.accent }} />
                          {applicant.team.name}
                        </span>
                      ) : (
                        <span key={`player-${applicant.user.id}`} className="avatar small" style={{ "--avatar": applicant.user.avatarColor }}>{applicant.user.name.slice(0, 1)}</span>
                      )
                    )) : <small>아직 신청 없음</small>}
                  </div>
                  {mine ? <Button type="button" className="ow-close-button" variant="secondary" onClick={() => app.actions.closeRecruitingPost(post.id)}>마감</Button> : null}
                </div>
              </details>
            </article>
          );
        }) : (
          <div className="ow-empty-state">
            <div>
              <strong>조건에 맞는 큐 없음</strong>
              <p>필터를 풀거나 새 모집을 시작.</p>
            </div>
          </div>
        )}
      </section>

      {composeOpen ? (
        <div className="ow-compose-backdrop" role="presentation" onMouseDown={() => setComposeOpen(false)}>
          <aside className="ow-compose-drawer" role="dialog" aria-modal="true" aria-label="모집 시작" onMouseDown={(event) => event.stopPropagation()}>
            <div className="ow-drawer-head">
              <div>
                <span className="ow-kicker">CREATE QUEUE</span>
                <h2>모집 시작</h2>
              </div>
              <button type="button" className="ow-icon-button" aria-label="닫기" onClick={() => setComposeOpen(false)}><X size={20} /></button>
            </div>

            <form className="ow-compose-form" onSubmit={submit}>
              <div className="ow-compose-type-grid">
                {Object.entries(RECRUITING_TYPES).map(([type, meta]) => {
                  const view = TYPE_VIEW[type] ?? TYPE_VIEW.need_player;
                  return (
                    <button
                      key={type}
                      type="button"
                      className={draft.type === type ? "active" : ""}
                      onClick={() => changeDraftType(type)}
                    >
                      <strong>{view.title}</strong>
                      <span>{meta.shortLabel}</span>
                    </button>
                  );
                })}
              </div>

              <div className="segmented-control compact-segments">
                <button type="button" className={!draft.ranked ? "active" : ""} onClick={() => update({ ranked: false })}>친선</button>
                <button type="button" className={draft.ranked ? "active" : ""} onClick={() => update({ ranked: true })}>정규</button>
              </div>

              <label>
                제목
                <input value={draft.title} onChange={(event) => update({ title: event.target.value })} />
              </label>

              <div className="ow-field-grid three">
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
                <label>
                  코트
                  <select value={draft.court} onChange={(event) => update({ court: event.target.value })}>
                    {COURTS.filter((court) => court.region === draft.region || draft.region === "전체").map((court) => (
                      <option key={court.id} value={court.name}>{court.region} · {court.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="ow-field-grid">
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
                {draft.type !== "need_team" ? (
                  <label>
                    포지션
                    <select value={draft.position} onChange={(event) => update({ position: event.target.value })}>
                      {PLAYER_POSITIONS.map((position) => <option key={position}>{position}</option>)}
                    </select>
                  </label>
                ) : null}
                <label>
                  {draft.type === "need_player" ? "필요 인원" : "필요 팀 수"}
                  <input type="number" min="1" max={draft.type === "need_player" ? "5" : "4"} value={draft.spots} onChange={(event) => update({ spots: event.target.value })} />
                </label>
              </div>

              <div className="ow-mini-note">
                <div>
                  <span>{draft.ranked ? "정규 허용 구간" : "친선"}</span>
                  <strong>{draftRange.label}</strong>
                  <em>{draft.ranked ? draftRange.detail : "티어 제한 없음"}</em>
                </div>
                <TierBadge mmr={targetMmr} compact />
              </div>

              <label>
                메모
                <textarea value={draft.memo} onChange={(event) => update({ memo: event.target.value })} />
              </label>

              <div className="ow-submit-row">
                <span className={canPostRecruiting ? "queue-note" : "form-warning"}>
                  <ShieldCheck size={17} /> {canPostRecruiting ? "바로 등록 가능" : "소속팀 필요"}
                </span>
                <Button type="submit" disabled={!canPostRecruiting}><PlusCircle size={18} /> 등록</Button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
