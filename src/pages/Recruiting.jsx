import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Clock3,
  MapPin,
  PlusCircle,
  ShieldCheck,
  Swords,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import { COURTS, MATCH_MODES, PLAYER_POSITIONS, REGIONS } from "../lib/constants.js";
import {
  RECRUITING_JOIN_MODES,
  getRecruitingBestSide,
  getRecruitingFit,
  getRecruitingLobby,
  getRecruitingSideCapacity,
  getRecruitingTargetMmr,
  hasRecruitingApplicant,
  isNationalRecruitingPost,
} from "../lib/recruiting.js";

const SIDE_LABELS = {
  teamA: "A팀",
  teamB: "B팀",
};

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

function getDefaultTitle(draft) {
  return `${draft.ranked ? "정규전" : "친선전"} ${draft.mode} 매치 큐`;
}

function getDefaultApplyTeamId(post, teams) {
  return teams.find((team) => team.region === post.region)?.id ?? teams[0]?.id ?? "";
}

function getDefaultJoinDraft(post, teams, currentUser, state) {
  const teamId = getDefaultApplyTeamId(post, teams);
  return {
    joinMode: teamId ? "team" : "player",
    teamId,
    side: getRecruitingBestSide(post, state),
    reserve: false,
    position: currentUser.position,
  };
}

function getEntryMmr(entry) {
  return entry.team?.mmr ?? entry.user?.ratings?.integrated ?? 1200;
}

function getEntryTitle(entry) {
  if (entry.fixed && entry.kind === "team") return `${entry.team?.name ?? "팀"} · 방장 파티`;
  if (entry.fixed) return `${entry.user?.name ?? "방장"} · 방장`;
  if (entry.kind === "team") return `${entry.team?.name ?? "팀"} · 팀 파티`;
  return `${entry.user?.name ?? "플레이어"} · 개인`;
}

function getPlayerPosition(user) {
  return user?.position || "포지션 자유";
}

function EntryBlock({ entry, userById }) {
  const mmr = getEntryMmr(entry);
  const players = entry.players.map((playerId) => userById[playerId]).filter(Boolean);

  return (
    <div className={`ow-party-block ${entry.status === "ready" ? "ready" : ""}`}>
      <div className="ow-party-head">
        <div>
          <strong>{getEntryTitle(entry)}</strong>
          <span>{entry.kind === "team" ? `${players.length}명 자동 참여` : getPlayerPosition(entry.user)}</span>
        </div>
        <div className="ow-party-meta">
          <TierBadge mmr={mmr} compact />
          <Badge tone={entry.status === "ready" ? "green" : "neutral"}>
            {entry.status === "ready" ? "대기 완료" : "대기 전"}
          </Badge>
        </div>
      </div>
      <div className="ow-party-members">
        {players.map((user) => (
          <Link key={user.id} to={`/app/players/${user.id}`} className="ow-member-chip">
            <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
            <span>{user.name}</span>
            <b>{getPlayerPosition(user)}</b>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SideRoster({ sideName, side, userById }) {
  const openSlots = Math.max(0, side.capacity - side.filled);
  return (
    <section className="ow-side-roster">
      <header>
        <div>
          <span>{SIDE_LABELS[sideName]}</span>
          <strong>{side.filled}/{side.capacity}</strong>
        </div>
        <div className="ow-side-progress" style={{ "--fill": `${Math.min(100, (side.filled / side.capacity) * 100)}%` }} />
      </header>
      <div className="ow-roster-stack">
        {side.entries.map((entry) => (
          <EntryBlock key={`${sideName}-${entry.id}`} entry={entry} userById={userById} />
        ))}
        {Array.from({ length: openSlots }).map((_item, index) => (
          <div key={`${sideName}-open-${index}`} className="ow-open-slot">
            <UserRound size={17} />
            <span>빈 슬롯</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReserveLine({ sideName, userIds, userById }) {
  if (!userIds.length) return null;
  return (
    <div className="ow-reserve-line">
      <strong>{SIDE_LABELS[sideName]} 후보</strong>
      <div>
        {userIds.map((userId) => {
          const user = userById[userId];
          if (!user) return null;
          return (
            <span key={`${sideName}-${userId}`} className="ow-member-chip compact">
              <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
              {user.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function Recruiting({ app }) {
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const [scope, setScope] = useState("local");
  const [queue, setQueue] = useState("all");
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [joinDraftByPost, setJoinDraftByPost] = useState({});
  const [draft, setDraft] = useState(() => ({
    hostJoinMode: myTeams[0]?.id ? "team" : "player",
    title: "",
    region: app.currentUser.region,
    court: COURTS.find((court) => court.region === app.currentUser.region)?.name ?? COURTS[0].name,
    mode: "5v5",
    ranked: true,
    teamId: myTeams[0]?.id ?? "",
    position: app.currentUser.position,
    memo: "빈자리는 개인 또는 팀 파티로 들어올 수 있습니다.",
  }));

  const selectedTeam = myTeams.find((team) => team.id === draft.teamId) ?? myTeams[0] ?? null;
  const hostNeedsTeam = draft.hostJoinMode === "team";
  const canPostRecruiting = !hostNeedsTeam || Boolean(selectedTeam);

  useEffect(() => {
    if (!hostNeedsTeam) return;
    if (selectedTeam && draft.teamId === selectedTeam.id) return;
    setDraft((current) => ({ ...current, teamId: myTeams[0]?.id ?? "" }));
  }, [draft.teamId, hostNeedsTeam, myTeams, selectedTeam]);

  const visibleBasePosts = useMemo(() => {
    return [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status !== "closed")
      .filter((post) => scope !== "local" || post.region === app.currentUser.region || isNationalRecruitingPost(post, app.state))
      .filter((post) => queue === "all" || (queue === "ranked" ? post.ranked !== false : post.ranked === false));
  }, [app.currentUser.region, app.state, queue, scope]);

  const posts = useMemo(() => {
    return visibleBasePosts.sort((a, b) => {
      const aLocal = Number(a.region === app.currentUser.region);
      const bLocal = Number(b.region === app.currentUser.region);
      const aNational = Number(isNationalRecruitingPost(a, app.state));
      const bNational = Number(isNationalRecruitingPost(b, app.state));
      return bLocal - aLocal || bNational - aNational || new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [app.currentUser.region, app.state, visibleBasePosts]);

  const selectedPost = selectedPostId
    ? app.state.recruitingPosts.find((post) => post.id === selectedPostId)
    : null;
  const rankedCount = visibleBasePosts.filter((post) => post.ranked !== false).length;
  const friendlyCount = visibleBasePosts.length - rankedCount;

  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const submit = (event) => {
    event.preventDefault();
    const nextDraft = { ...draft, title: draft.title.trim() || getDefaultTitle(draft) };
    app.actions.createRecruitingPost(nextDraft);
    setDraft((current) => ({ ...current, title: "", memo: "빈자리는 개인 또는 팀 파티로 들어올 수 있습니다." }));
    setComposeOpen(false);
  };

  const getJoinDraft = (post) => joinDraftByPost[post.id] ?? getDefaultJoinDraft(post, myTeams, app.currentUser, app.state);
  const updateJoinDraft = (post, patch) => {
    setJoinDraftByPost((current) => ({
      ...current,
      [post.id]: { ...getJoinDraft(post), ...patch },
    }));
  };
  const submitJoin = (post) => {
    const joinDraft = getJoinDraft(post);
    app.actions.interestRecruitingPost(post.id, joinDraft);
  };

  return (
    <div className="page-stack ow-recruit-page">
      <section className="ow-recruit-hero">
        <div className="ow-hero-copy">
          <span className="ow-kicker">MATCH QUEUE</span>
          <h1>매치 큐</h1>
          <p>팀 구함, 용병 구함을 나누지 않는다. 방을 열고, 참가자가 개인이나 팀 파티로 들어온다.</p>
        </div>
        <div className="ow-hero-panel">
          <div className="ow-hero-stats">
            <span><strong>{visibleBasePosts.length}</strong>OPEN</span>
            <span><strong>{rankedCount}</strong>RANKED</span>
            <span><strong>{friendlyCount}</strong>FRIENDLY</span>
          </div>
          <Button type="button" className="ow-hero-cta" onClick={() => setComposeOpen(true)}>
            <PlusCircle size={18} /> 매치방 만들기
          </Button>
        </div>
      </section>

      <section className="ow-mode-grid" aria-label="참여 방식">
        <div className="ow-mode-card static">
          <span className="ow-mode-icon"><UserRound size={23} /></span>
          <span className="ow-mode-copy">
            <span className="ow-mode-code">SOLO</span>
            <h2>개인 참여</h2>
            <p>빈 슬롯 하나에 용병처럼 들어간다.</p>
          </span>
          <span className="ow-mode-count">선택형</span>
        </div>
        <div className="ow-mode-card static">
          <span className="ow-mode-icon"><UsersRound size={23} /></span>
          <span className="ow-mode-copy">
            <span className="ow-mode-code">PARTY</span>
            <h2>팀 파티</h2>
            <p>내 팀 활성 멤버가 자동으로 같이 들어간다.</p>
          </span>
          <span className="ow-mode-count">{myTeams.length}팀</span>
        </div>
        <div className="ow-mode-card static">
          <span className="ow-mode-icon"><Swords size={23} /></span>
          <span className="ow-mode-copy">
            <span className="ow-mode-code">ROOM</span>
            <h2>매치방</h2>
            <p>A/B 로스터, 포지션, 티어, 후보를 보고 대기한다.</p>
          </span>
          <span className="ow-mode-count">팝업</span>
        </div>
      </section>

      <section className="ow-filter-bar" aria-label="필터">
        <button type="button" className={scope === "local" ? "active" : ""} onClick={() => setScope("local")}>내 지역</button>
        <button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>전체 지역</button>
        <button type="button" className={queue === "all" ? "active" : ""} onClick={() => setQueue("all")}>전체</button>
        <button type="button" className={queue === "ranked" ? "active" : ""} onClick={() => setQueue("ranked")}>정규전</button>
        <button type="button" className={queue === "friendly" ? "active" : ""} onClick={() => setQueue("friendly")}>친선전</button>
        <span className="ow-filter-count">{posts.length}개 표시</span>
      </section>

      <section className="ow-recruit-list" aria-label="매치 큐 목록">
        {posts.length ? posts.map((post) => {
          const lobby = getRecruitingLobby(post, app.state);
          const target = getRecruitingTargetMmr(post, app.state);
          const host = userById[post.playerId];
          const hostTeam = post.teamId ? teamById[post.teamId] : null;
          const applicantEntry = { kind: "player", joinMode: "player", playerId: app.currentUser.id };
          const applied = hasRecruitingApplicant(post, applicantEntry)
            || myTeams.some((team) => hasRecruitingApplicant(post, { kind: "team", joinMode: "team", teamId: team.id }));
          const mine = post.playerId === app.currentUser.id;

          return (
            <article
              key={post.id}
              className={`ow-recruit-card ow-lobby-card ${lobby.canConfirm ? "ow-state-ready" : ""}`}
              onClick={() => setSelectedPostId(post.id)}
            >
              <div className="ow-card-main">
                <div className="ow-card-top">
                  <span className="ow-type-tag">ROOM</span>
                  <span className={`ow-queue-pill ${post.ranked === false ? "friendly" : "ranked"}`}>{post.ranked === false ? "친선전" : "정규전"}</span>
                  <span className="ow-position-pill">{post.mode}</span>
                  {isNationalRecruitingPost(post, app.state) ? <span className="ow-position-pill">전국 노출</span> : null}
                </div>
                <h3>{post.title}</h3>
                <div className="ow-card-meta">
                  <MapPin size={15} />
                  <span>{post.region} · {post.court} · {hostTeam?.name ?? host?.name ?? "방장"}</span>
                </div>
                <div className="ow-lobby-meter-grid">
                  {["teamA", "teamB"].map((sideName) => (
                    <div key={sideName} className="ow-lobby-meter">
                      <span>{SIDE_LABELS[sideName]}</span>
                      <div style={{ "--fill": `${Math.min(100, (lobby.sides[sideName].filled / lobby.sides[sideName].capacity) * 100)}%` }} />
                      <b>{lobby.sides[sideName].filled}/{lobby.sides[sideName].capacity}</b>
                    </div>
                  ))}
                </div>
                <div className="ow-card-bottom">
                  <span className="ow-tier-chip">{post.ranked === false ? "티어 자유" : `${target} MMR 기준`}</span>
                  <span>{formatWhen(post.createdAt)}</span>
                  <span>{lobby.ready ? "전원 대기 완료" : "대기 확인 중"}</span>
                </div>
              </div>

              <div className="ow-card-side" onClick={(event) => event.stopPropagation()}>
                <span className="ow-slot-count">
                  <strong>{lobby.sides.teamA.filled + lobby.sides.teamB.filled}/{getRecruitingSideCapacity(post) * 2}</strong>
                  <span>참가 인원</span>
                </span>
                <Button type="button" className="ow-card-action" onClick={() => setSelectedPostId(post.id)}>
                  <Swords size={16} /> 방 보기
                </Button>
                {!mine && !applied ? (
                  <Button
                    type="button"
                    className="ow-card-action"
                    variant="secondary"
                    onClick={() => app.actions.interestRecruitingPost(post.id, getDefaultJoinDraft(post, myTeams, app.currentUser, app.state))}
                  >
                    <Clock3 size={16} /> 빠른 대기
                  </Button>
                ) : null}
              </div>
            </article>
          );
        }) : (
          <div className="ow-empty-state">
            <div>
              <strong>조건에 맞는 매치방 없음</strong>
              <p>필터를 바꾸거나 새 매치방을 열어라.</p>
            </div>
          </div>
        )}
      </section>

      {selectedPost ? (() => {
        const lobby = getRecruitingLobby(selectedPost, app.state);
        const joinDraft = getJoinDraft(selectedPost);
        const selectedJoinTeam = myTeams.find((team) => team.id === joinDraft.teamId) ?? myTeams[0] ?? null;
        const candidateMmr = joinDraft.joinMode === "team"
          ? selectedJoinTeam?.mmr ?? 0
          : app.currentUser.ratings.integrated;
        const fit = getRecruitingFit(selectedPost, candidateMmr || app.currentUser.ratings.integrated, app.state);
        const mine = selectedPost.playerId === app.currentUser.id;
        const myEntry = lobby.entries.find((entry) => entry.playerId === app.currentUser.id);
        const alreadyApplied = Boolean(myEntry && !myEntry.fixed);
        const canJoin = !mine && !alreadyApplied && fit.allowed && (joinDraft.joinMode === "player" || Boolean(selectedJoinTeam));

        return (
          <div className="ow-compose-backdrop" role="presentation" onMouseDown={() => setSelectedPostId(null)}>
            <aside className="ow-lobby-modal" role="dialog" aria-modal="true" aria-label="매치방" onMouseDown={(event) => event.stopPropagation()}>
              <div className="ow-drawer-head">
                <div>
                  <span className="ow-kicker">MATCH ROOM</span>
                  <h2>{selectedPost.title}</h2>
                  <p>{selectedPost.region} · {selectedPost.court} · {selectedPost.mode}</p>
                </div>
                <button type="button" className="ow-icon-button" aria-label="닫기" onClick={() => setSelectedPostId(null)}><X size={20} /></button>
              </div>

              <div className="ow-lobby-summary">
                <span><ShieldCheck size={16} /> {selectedPost.ranked === false ? "친선전" : "정규전"}</span>
                <span><UsersRound size={16} /> 팀은 활성 멤버 자동 참여</span>
                <span><Clock3 size={16} /> 전원 대기 후 방장 확정</span>
              </div>

              <div className="ow-lobby-grid">
                <SideRoster sideName="teamA" side={lobby.sides.teamA} userById={userById} />
                <SideRoster sideName="teamB" side={lobby.sides.teamB} userById={userById} />
              </div>

              <div className="ow-reserve-panel">
                <ReserveLine sideName="teamA" userIds={lobby.sides.teamA.reserves} userById={userById} />
                <ReserveLine sideName="teamB" userIds={lobby.sides.teamB.reserves} userById={userById} />
                {!lobby.sides.teamA.reserves.length && !lobby.sides.teamB.reserves.length ? <span>후보 없음</span> : null}
              </div>

              <div className="ow-room-rule-panel">
                <strong>규칙</strong>
                <span>{selectedPost.memo}</span>
                <span>팀 MMR은 실제 참가한 팀원 비율 기준으로 반영한다.</span>
                <span>확정 후 불참하면 신뢰점수 패널티 대상이다.</span>
              </div>

              <div className="ow-join-panel">
                {mine ? (
                  <div className="ow-owner-panel">
                    <strong>방장 권한</strong>
                    <span>{lobby.canConfirm ? "확정 가능" : "양쪽 인원과 대기 상태를 채워야 확정 가능"}</span>
                  </div>
                ) : alreadyApplied ? (
                  <div className="ow-owner-panel">
                    <strong>대기 등록됨</strong>
                    <span>방장이 확정하기 전까지 준비 상태를 바꿀 수 있다.</span>
                  </div>
                ) : (
                  <form className="ow-join-form" onSubmit={(event) => { event.preventDefault(); submitJoin(selectedPost); }}>
                    <div className="segmented-control compact-segments">
                      {Object.entries(RECRUITING_JOIN_MODES).map(([mode, meta]) => (
                        <button
                          key={mode}
                          type="button"
                          className={joinDraft.joinMode === mode ? "active" : ""}
                          onClick={() => updateJoinDraft(selectedPost, { joinMode: mode, teamId: mode === "team" ? getDefaultApplyTeamId(selectedPost, myTeams) : "" })}
                        >
                          {meta.label}
                        </button>
                      ))}
                    </div>
                    {joinDraft.joinMode === "team" ? (
                      <label>
                        참여 팀
                        <select value={joinDraft.teamId} onChange={(event) => updateJoinDraft(selectedPost, { teamId: event.target.value })}>
                          {myTeams.length ? myTeams.map((team) => (
                            <option key={team.id} value={team.id}>{team.name} · {team.mmr}</option>
                          )) : <option value="">내 팀 없음</option>}
                        </select>
                      </label>
                    ) : (
                      <label>
                        포지션
                        <select value={joinDraft.position} onChange={(event) => updateJoinDraft(selectedPost, { position: event.target.value })}>
                          {PLAYER_POSITIONS.map((position) => <option key={position}>{position}</option>)}
                        </select>
                      </label>
                    )}
                    <div className="ow-field-grid">
                      <label>
                        진영
                        <select value={joinDraft.side} onChange={(event) => updateJoinDraft(selectedPost, { side: event.target.value })}>
                          <option value="teamA">A팀</option>
                          <option value="teamB">B팀</option>
                        </select>
                      </label>
                      <label className="ow-check-row">
                        <input type="checkbox" checked={joinDraft.reserve} onChange={(event) => updateJoinDraft(selectedPost, { reserve: event.target.checked })} />
                        후보로 대기
                      </label>
                    </div>
                    <div className="ow-mini-note">
                      <div>
                        <span>{joinDraft.joinMode === "team" ? "팀 파티" : "개인 참여"}</span>
                        <strong>{fit.label}</strong>
                        <em>{fit.range.label}</em>
                      </div>
                      <TierBadge mmr={candidateMmr || app.currentUser.ratings.integrated} compact />
                    </div>
                    <Button type="submit" disabled={!canJoin}>
                      {joinDraft.joinMode === "team" ? <UsersRound size={18} /> : <UserRound size={18} />}
                      {RECRUITING_JOIN_MODES[joinDraft.joinMode].actionLabel}
                    </Button>
                  </form>
                )}

                {myEntry ? (
                  <Button
                    type="button"
                    variant={myEntry.status === "ready" ? "secondary" : "primary"}
                    onClick={() => app.actions.setRecruitingReady(selectedPost.id, myEntry.status !== "ready")}
                  >
                    {myEntry.status === "ready" ? <Clock3 size={18} /> : <CheckCircle2 size={18} />}
                    {myEntry.status === "ready" ? "대기 취소" : "대기 완료"}
                  </Button>
                ) : null}
                {mine ? (
                  <Button type="button" disabled={!lobby.canConfirm} onClick={() => app.actions.confirmRecruitingMatch(selectedPost.id)}>
                    <Swords size={18} /> 매치 확정
                  </Button>
                ) : null}
                {mine ? (
                  <Button type="button" variant="secondary" onClick={() => app.actions.closeRecruitingPost(selectedPost.id)}>방 닫기</Button>
                ) : null}
              </div>
            </aside>
          </div>
        );
      })() : null}

      {composeOpen ? (
        <div className="ow-compose-backdrop" role="presentation" onMouseDown={() => setComposeOpen(false)}>
          <aside className="ow-compose-drawer" role="dialog" aria-modal="true" aria-label="매치방 만들기" onMouseDown={(event) => event.stopPropagation()}>
            <div className="ow-drawer-head">
              <div>
                <span className="ow-kicker">CREATE ROOM</span>
                <h2>매치방 만들기</h2>
              </div>
              <button type="button" className="ow-icon-button" aria-label="닫기" onClick={() => setComposeOpen(false)}><X size={20} /></button>
            </div>

            <form className="ow-compose-form" onSubmit={submit}>
              <div className="segmented-control compact-segments">
                <button type="button" className={draft.hostJoinMode === "team" ? "active" : ""} onClick={() => update({ hostJoinMode: "team", teamId: myTeams[0]?.id ?? "" })}>내 팀으로 열기</button>
                <button type="button" className={draft.hostJoinMode === "player" ? "active" : ""} onClick={() => update({ hostJoinMode: "player", teamId: "" })}>개인으로 열기</button>
              </div>

              <div className="segmented-control compact-segments">
                <button type="button" className={!draft.ranked ? "active" : ""} onClick={() => update({ ranked: false })}>친선전</button>
                <button type="button" className={draft.ranked ? "active" : ""} onClick={() => update({ ranked: true })}>정규전</button>
              </div>

              <label>
                제목
                <input value={draft.title} placeholder={getDefaultTitle(draft)} onChange={(event) => update({ title: event.target.value })} />
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
                {draft.hostJoinMode === "team" ? (
                  <label>
                    내 파티 팀
                    <select value={draft.teamId} onChange={(event) => update({ teamId: event.target.value })}>
                      {myTeams.length ? myTeams.map((team) => (
                        <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>
                      )) : <option value="">내 팀 없음</option>}
                    </select>
                  </label>
                ) : (
                  <label>
                    내 포지션
                    <select value={draft.position} onChange={(event) => update({ position: event.target.value })}>
                      {PLAYER_POSITIONS.map((position) => <option key={position}>{position}</option>)}
                    </select>
                  </label>
                )}
                <div className="ow-mini-note">
                  <div>
                    <span>슬롯</span>
                    <strong>{getRecruitingSideCapacity(draft)} vs {getRecruitingSideCapacity(draft)}</strong>
                    <em>팀으로 열면 활성 멤버가 A팀에 자동 배치</em>
                  </div>
                  <ShieldCheck size={22} />
                </div>
              </div>

              <label>
                메모
                <textarea value={draft.memo} onChange={(event) => update({ memo: event.target.value })} />
              </label>

              <div className="ow-submit-row">
                <span className={canPostRecruiting ? "queue-note" : "form-warning"}>
                  <ShieldCheck size={17} /> {canPostRecruiting ? "등록 가능" : "내 팀 선택 필요"}
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
