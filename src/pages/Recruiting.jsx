import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  XCircle,
} from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { COURTS, MATCH_MODES, PLAYER_POSITIONS, REFEREE_TRUST_MIN, REGIONS } from "../lib/constants.js";
import { isEligibleReferee } from "../lib/matchUtils.js";
import {
  RECRUITING_JOIN_MODES,
  getRecruitingBestSide,
  getRecruitingFit,
  getRecruitingLobby,
  getRecruitingSideCapacity,
  getRecruitingTargetMmr,
  getSelectableTeamPlayerIds,
  hasRecruitingApplicant,
  isRecruitingPostForUser,
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

function getTodayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRecruitingSchedule(post) {
  return [post.scheduledDate, post.scheduledTime].filter(Boolean).join(" ") || post.scheduledAt || "일정 미정";
}

function getDefaultApplyTeamId(post, teams) {
  return teams.find((team) => team.region === post.region)?.id ?? teams[0]?.id ?? "";
}

function getDefaultTeamPlayerIds(team, capacity) {
  if (!team) return [];
  return getSelectableTeamPlayerIds(team).slice(0, capacity);
}

function getPartyPlayerIds(team, playerIds, capacity) {
  if (!team) return [];
  if (!Array.isArray(playerIds)) return getDefaultTeamPlayerIds(team, capacity);
  const selectableIds = new Set(getSelectableTeamPlayerIds(team));
  return Array.from(new Set(playerIds.filter((playerId) => selectableIds.has(playerId)))).slice(0, capacity);
}

function getDefaultJoinDraft(post, teams, currentUser, state) {
  const teamId = getDefaultApplyTeamId(post, teams);
  const team = teams.find((item) => item.id === teamId) ?? null;
  const capacity = getRecruitingSideCapacity(post);
  return {
    joinMode: teamId ? "team" : "player",
    teamId,
    playerIds: getDefaultTeamPlayerIds(team, capacity),
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

function getReadyTitle(entry) {
  if (entry.kind === "team") {
    const leader = entry.user?.name ? ` · ${entry.user.name}` : "";
    return `${entry.team?.name ?? "팀"}${leader}`;
  }
  return entry.user?.name ?? "플레이어";
}

function getPlayerPosition(user) {
  return user?.position || "포지션 자유";
}

function TeamMemberPicker({ team, userById, selectedIds, capacity, onChange }) {
  if (!team) {
    return (
      <div className="ow-party-picker empty">
        <span>선택할 팀이 없다.</span>
      </div>
    );
  }

  const memberIds = getSelectableTeamPlayerIds(team);
  const selectedSet = new Set(selectedIds);
  const toggleMember = (playerId) => {
    const nextIds = selectedSet.has(playerId)
      ? selectedIds.filter((id) => id !== playerId)
      : [...selectedIds, playerId].slice(0, capacity);
    onChange(nextIds);
  };

  return (
    <div className="ow-party-picker">
      <div className="ow-party-picker-head">
        <span>참여 팀원</span>
        <strong>{selectedIds.length}/{capacity}</strong>
      </div>
      <div className="ow-party-picker-grid">
        {memberIds.map((playerId) => {
          const user = userById[playerId];
          const selected = selectedSet.has(playerId);
          const locked = !selected && selectedIds.length >= capacity;
          return (
            <button
              key={playerId}
              type="button"
              className={selected ? "selected" : ""}
              disabled={locked}
              onClick={() => toggleMember(playerId)}
            >
              <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "?"}</span>
              <span>
                <strong>{user?.name ?? "알 수 없음"}</strong>
                <em>{getPlayerPosition(user)}</em>
              </span>
              <TierBadge mmr={user?.ratings?.integrated ?? 1200} compact />
            </button>
          );
        })}
      </div>
      {!selectedIds.length ? <em>최소 1명 선택 필요</em> : null}
    </div>
  );
}

function EntryBlock({ entry, userById, teams }) {
  const mmr = getEntryMmr(entry);
  const players = entry.players.map((playerId) => userById[playerId]).filter(Boolean);

  return (
    <div className={`ow-party-block ${entry.status === "ready" ? "ready" : ""}`}>
      <div className="ow-party-head">
        <div>
          <strong>
            {entry.team ? (
              <>
                <TeamHoverCard team={entry.team} as="span">{entry.team.name}</TeamHoverCard>
                {entry.fixed ? " · 방장 파티" : " · 팀 파티"}
              </>
            ) : getEntryTitle(entry)}
          </strong>
          <span>{entry.kind === "team" ? `${players.length}명 선택 참여` : getPlayerPosition(entry.user)}</span>
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
          <PlayerHoverCard key={user.id} user={user} teams={teams} className="ow-member-chip">
            <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
            <span>{user.name}</span>
            <b>{getPlayerPosition(user)}</b>
          </PlayerHoverCard>
        ))}
      </div>
    </div>
  );
}

function ReadyStatusStrip({ lobby, compact = false }) {
  const rows = (lobby.entries ?? []).map((entry) => ({
    id: entry.id,
    label: getReadyTitle(entry),
    side: entry.reserve ? "후보" : SIDE_LABELS[entry.side],
    ready: entry.status === "ready",
  }));
  const visibleRows = compact ? rows.slice(0, 6) : rows;
  const hiddenCount = rows.length - visibleRows.length;
  const readyCount = rows.filter((row) => row.ready).length;
  const readyRows = rows.filter((row) => row.ready);
  const waitingRows = rows.filter((row) => !row.ready);
  const renderReadyChip = (row) => (
    <span key={row.id} className={row.ready ? "ow-ready-chip ready" : "ow-ready-chip waiting"}>
      {row.ready ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
      <b>{row.label}</b>
      <small>{row.side}</small>
      <em>{row.ready ? "완료" : "대기"}</em>
    </span>
  );

  if (!compact) {
    return (
      <div className="ow-ready-strip ow-ready-strip-modal">
        <div className="ow-ready-head">
          <span>대기 현황</span>
          <strong>{readyCount}/{rows.length}</strong>
        </div>
        <div className="ow-ready-groups">
          <div className="ow-ready-group ready">
            <strong><CheckCircle2 size={14} /> 대기 완료</strong>
            <div className="ow-ready-chip-row">
              {readyRows.length ? readyRows.map(renderReadyChip) : <span className="ow-ready-empty">아직 없음</span>}
            </div>
          </div>
          <div className="ow-ready-group waiting">
            <strong><Clock3 size={14} /> 대기 전</strong>
            <div className="ow-ready-chip-row">
              {waitingRows.length ? waitingRows.map(renderReadyChip) : <span className="ow-ready-empty">전원 완료</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ow-ready-strip ow-ready-strip-card">
      <div className="ow-ready-head">
        <span>대기 현황</span>
        <strong>{readyCount}/{rows.length}</strong>
      </div>
      <div className="ow-ready-chip-row">
        {visibleRows.map(renderReadyChip)}
        {hiddenCount > 0 ? <span className="ow-ready-chip more">+{hiddenCount}</span> : null}
      </div>
    </div>
  );
}

function FillSlot({ candidate, userById, teams }) {
  const user = candidate ? userById[candidate.playerId] : null;
  if (!user) {
    return (
      <div className="ow-open-slot empty">
        <UserRound size={17} />
        <span>후보 없음</span>
      </div>
    );
  }

  return (
    <PlayerHoverCard user={user} teams={teams} className="ow-open-slot fill">
      <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
      <span>
        <strong>{user.name}</strong>
        <em>{candidate.status === "ready" ? "충원 예정" : "준비 대기"} · {candidate.sourceLabel}</em>
      </span>
      <TierBadge mmr={user.ratings.integrated} compact />
    </PlayerHoverCard>
  );
}

function SideRoster({ sideName, side, userById, teams }) {
  const openSlots = Math.max(0, side.capacity - side.projectedFilled);
  return (
    <section className="ow-side-roster">
      <header>
        <div>
          <span>{SIDE_LABELS[sideName]}</span>
          <strong>{side.projectedFilled}/{side.capacity}</strong>
        </div>
        <div className="ow-side-progress" style={{ "--fill": `${Math.min(100, (side.projectedFilled / side.capacity) * 100)}%` }} />
      </header>
      <div className="ow-roster-stack">
        {side.entries.map((entry) => (
          <EntryBlock key={`${sideName}-${entry.id}`} entry={entry} userById={userById} teams={teams} />
        ))}
        {side.fillSlots.map((candidate) => (
          <FillSlot key={`${sideName}-fill-${candidate.playerId}`} candidate={candidate} userById={userById} teams={teams} />
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

function ReserveLine({ sideName, candidates, playingIds, userById, teams }) {
  if (!candidates.length) return null;
  const playingSet = new Set(playingIds);
  return (
    <div className="ow-reserve-line">
      <strong>{SIDE_LABELS[sideName]} 후보</strong>
      <div>
        {candidates.map((candidate, index) => {
          const user = userById[candidate.playerId];
          if (!user) return null;
          const canRecord = candidate.source === "reserve-entry" && candidate.status === "ready" && !playingSet.has(candidate.playerId) && isEligibleReferee(user, REFEREE_TRUST_MIN);
          return (
            <PlayerHoverCard key={`${sideName}-${candidate.playerId}`} user={user} teams={teams} className={canRecord ? "ow-member-chip compact recorder" : "ow-member-chip compact"}>
              <b>{index + 1}</b>
              <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
              <span>{user.name}</span>
              <em>{canRecord ? "기록 가능" : candidate.status === "ready" ? "준비" : "대기"}</em>
            </PlayerHoverCard>
          );
        })}
      </div>
    </div>
  );
}

export default function Recruiting({ app }) {
  const navigate = useNavigate();
  const myTeams = useMemo(
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  const myTeamIds = useMemo(() => myTeams.map((team) => team.id), [myTeams]);
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const [scope, setScope] = useState("local");
  const [queue, setQueue] = useState("all");
  const [roomScope, setRoomScope] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [queueControlsOpen, setQueueControlsOpen] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [joinDraftByPost, setJoinDraftByPost] = useState({});
  const [draft, setDraft] = useState(() => ({
    hostJoinMode: myTeams[0]?.id ? "team" : "player",
    title: "",
    region: app.currentUser.region,
    court: COURTS.find((court) => court.region === app.currentUser.region)?.name ?? COURTS[0].name,
    scheduledDate: getTodayInputValue(),
    scheduledTime: "20:00",
    mode: "5v5",
    ranked: true,
    teamId: myTeams[0]?.id ?? "",
    playerIds: getDefaultTeamPlayerIds(myTeams[0], getRecruitingSideCapacity({ mode: "5v5" })),
    position: app.currentUser.position,
    memo: "빈자리는 개인 또는 팀 파티로 들어올 수 있습니다.",
  }));

  const selectedTeam = myTeams.find((team) => team.id === draft.teamId) ?? myTeams[0] ?? null;
  const draftCapacity = getRecruitingSideCapacity(draft);
  const selectedHostPlayerIds = getPartyPlayerIds(selectedTeam, draft.playerIds, draftCapacity);
  const hostNeedsTeam = draft.hostJoinMode === "team";
  const hasSchedule = Boolean(draft.scheduledDate && draft.scheduledTime && draft.court);
  const canPostRecruiting = hasSchedule && (!hostNeedsTeam || (Boolean(selectedTeam) && selectedHostPlayerIds.length > 0));

  useEffect(() => {
    if (!hostNeedsTeam) return;
    const nextTeam = selectedTeam ?? myTeams[0] ?? null;
    if (!nextTeam) return;
    const nextPlayerIds = getPartyPlayerIds(nextTeam, draft.playerIds, draftCapacity);
    const playerIdsNeedSync = !Array.isArray(draft.playerIds)
      || draft.playerIds.length > draftCapacity
      || draft.playerIds.some((playerId) => !getSelectableTeamPlayerIds(nextTeam).includes(playerId));
    if (draft.teamId === nextTeam.id && !playerIdsNeedSync) return;
    setDraft((current) => ({
      ...current,
      teamId: nextTeam.id,
      playerIds: nextPlayerIds.length ? nextPlayerIds : getDefaultTeamPlayerIds(nextTeam, draftCapacity),
    }));
  }, [draft.teamId, draft.playerIds, draftCapacity, hostNeedsTeam, myTeams, selectedTeam]);

  const scopedPosts = useMemo(() => {
    return [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status !== "closed")
      .filter((post) => scope !== "local" || post.region === app.currentUser.region || isNationalRecruitingPost(post, app.state))
      .filter((post) => queue === "all" || (queue === "ranked" ? post.ranked !== false : post.ranked === false))
      .filter((post) => modeFilter === "all" || post.mode === modeFilter)
      .filter((post) => roomScope !== "created" || post.playerId === app.currentUser.id)
      .filter((post) => roomScope !== "joined" || (post.playerId !== app.currentUser.id && isRecruitingPostForUser(post, app.currentUser.id, myTeamIds)));
  }, [app.currentUser.id, app.currentUser.region, app.state, modeFilter, myTeamIds, queue, roomScope, scope]);

  const posts = useMemo(() => {
    return scopedPosts.sort((a, b) => {
      const aLocal = Number(a.region === app.currentUser.region);
      const bLocal = Number(b.region === app.currentUser.region);
      const aMine = Number(isRecruitingPostForUser(a, app.currentUser.id, myTeamIds));
      const bMine = Number(isRecruitingPostForUser(b, app.currentUser.id, myTeamIds));
      const aNational = Number(isNationalRecruitingPost(a, app.state));
      const bNational = Number(isNationalRecruitingPost(b, app.state));
      return bMine - aMine || bLocal - aLocal || bNational - aNational || new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [app.currentUser.id, app.currentUser.region, app.state, myTeamIds, scopedPosts]);

  const selectedPost = selectedPostId
    ? app.state.recruitingPosts.find((post) => post.id === selectedPostId)
    : null;
  useBodyScrollLock(Boolean(selectedPost) || composeOpen);

  const rankedCount = scopedPosts.filter((post) => post.ranked !== false).length;
  const friendlyCount = scopedPosts.length - rankedCount;
  const createdRoomCount = (app.state.recruitingPosts ?? [])
    .filter((post) => post.status !== "closed")
    .filter((post) => post.playerId === app.currentUser.id)
    .length;
  const joinedRoomCount = (app.state.recruitingPosts ?? [])
    .filter((post) => post.status !== "closed")
    .filter((post) => post.playerId !== app.currentUser.id)
    .filter((post) => isRecruitingPostForUser(post, app.currentUser.id, myTeamIds))
    .length;

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
  const confirmMatch = (post) => {
    const matchId = app.actions.confirmRecruitingMatch(post.id);
    if (!matchId) return;
    setSelectedPostId(null);
    navigate(`/app/matches/${matchId}`);
  };

  return (
    <div className="page-stack ow-recruit-page">
      <section className="ow-recruit-hero">
        <div className="ow-hero-copy">
          <span className="ow-kicker">MATCH QUEUE</span>
          <h1>대기 매칭</h1>
          <p>개인/팀 모집을 나누지 않는다. 공개방을 열면 참가자가 개인이나 팀 파티로 들어온다.</p>
        </div>
        <div className="ow-hero-panel">
          <div className="ow-hero-stats">
            <span><strong>{scopedPosts.length}</strong>OPEN</span>
            <span><strong>{rankedCount}</strong>RANKED</span>
            <span><strong>{friendlyCount}</strong>FRIENDLY</span>
          </div>
          <Link to="/app/create">
            <Button type="button" className="ow-hero-cta">
              <PlusCircle size={18} /> 경기방 만들기
            </Button>
          </Link>
        </div>
      </section>

      <section className={queueControlsOpen ? "ow-queue-controls" : "ow-queue-controls collapsed"}>
        <div className="ow-queue-controls-head">
          <div>
            <span className="ow-kicker">QUEUE FILTER</span>
            <strong>매치방 · {posts.length}개 표시</strong>
          </div>
          <button type="button" className="ow-collapse-button" onClick={() => setQueueControlsOpen((current) => !current)}>
            {queueControlsOpen ? "접기" : "펼치기"}
          </button>
        </div>

        {queueControlsOpen ? (
          <>
            <section className="ow-filter-bar" aria-label="필터">
              <button type="button" className={scope === "local" ? "active" : ""} onClick={() => setScope("local")}>내 지역</button>
              <button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>전체 지역</button>
              <button type="button" className={roomScope === "created" ? "active" : ""} onClick={() => setRoomScope(roomScope === "created" ? "all" : "created")}>내가 만든 방 {createdRoomCount}</button>
              <button type="button" className={roomScope === "joined" ? "active" : ""} onClick={() => setRoomScope(roomScope === "joined" ? "all" : "joined")}>내 참여방 {joinedRoomCount}</button>
              <button type="button" className={queue === "all" ? "active" : ""} onClick={() => setQueue("all")}>전체</button>
              <button type="button" className={queue === "ranked" ? "active" : ""} onClick={() => setQueue("ranked")}>정규전</button>
              <button type="button" className={queue === "friendly" ? "active" : ""} onClick={() => setQueue("friendly")}>친선전</button>
              <label className="ow-filter-select">
                방식
                <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
                  <option value="all">전체</option>
                  {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                </select>
              </label>
              <span className="ow-filter-count">{posts.length}개 표시</span>
            </section>
          </>
        ) : (
          <div className="ow-queue-summary">
            <span>{scope === "local" ? "내 지역" : "전체 지역"}</span>
            <span>{queue === "ranked" ? "정규전" : queue === "friendly" ? "친선전" : "전체"}</span>
            <span>{modeFilter === "all" ? "전체 방식" : MATCH_MODES.find((mode) => mode.id === modeFilter)?.label ?? modeFilter}</span>
            <span>{roomScope === "created" ? `내가 만든 방 ${createdRoomCount}` : roomScope === "joined" ? `내 참여방 ${joinedRoomCount}` : "전체 방"}</span>
          </div>
        )}
      </section>

      <section className="ow-recruit-list" aria-label="매치 큐 목록">
        {posts.length ? posts.map((post) => {
          const lobby = getRecruitingLobby(post, app.state);
          const target = getRecruitingTargetMmr(post, app.state);
          const host = userById[post.playerId];
          const hostTeam = post.teamId ? teamById[post.teamId] : null;
          const targetTeam = post.targetTeamId ? teamById[post.targetTeamId] : null;
          const applicantEntry = { kind: "player", joinMode: "player", playerId: app.currentUser.id };
          const applied = hasRecruitingApplicant(post, applicantEntry)
            || myTeams.some((team) => hasRecruitingApplicant(post, { kind: "team", joinMode: "team", teamId: team.id }));
          const mine = post.playerId === app.currentUser.id;
          const myRoom = isRecruitingPostForUser(post, app.currentUser.id, myTeamIds);
          const roomTag = mine ? "내가 만든 방" : myRoom ? "내 참여방" : "";

          return (
            <article
              key={post.id}
              className={`ow-recruit-card ow-lobby-card ${lobby.canConfirm ? "ow-state-ready" : ""} ${myRoom ? "ow-my-room" : ""}`}
              onClick={() => setSelectedPostId(post.id)}
            >
              <div className="ow-card-main">
                <div className="ow-card-top">
                  <span className="ow-type-tag">ROOM</span>
                  {roomTag ? <span className="ow-my-room-tag">{roomTag}</span> : null}
                  <span className={`ow-queue-pill ${post.ranked === false ? "friendly" : "ranked"}`}>{post.ranked === false ? "친선전" : "정규전"}</span>
                  <span className="ow-position-pill">{post.mode}</span>
                  {targetTeam ? <span className="ow-position-pill">희망 상대 <TeamHoverCard team={targetTeam} as="span">{targetTeam.name}</TeamHoverCard></span> : null}
                  {isNationalRecruitingPost(post, app.state) ? <span className="ow-position-pill">전국 노출</span> : null}
                </div>
                <h3>{post.title}</h3>
                <div className="ow-card-meta">
                  <MapPin size={15} />
                  <span>
                    {post.region} · {post.court} · {" "}
                    {hostTeam ? <TeamHoverCard team={hostTeam} as="span">{hostTeam.name}</TeamHoverCard> : host?.name ?? "방장"}
                  </span>
                </div>
                <div className="ow-lobby-meter-grid">
                  {["teamA", "teamB"].map((sideName) => (
                    <div key={sideName} className="ow-lobby-meter">
                      <span>{SIDE_LABELS[sideName]}</span>
                      <div style={{ "--fill": `${Math.min(100, (lobby.sides[sideName].projectedFilled / lobby.sides[sideName].capacity) * 100)}%` }} />
                      <b>{lobby.sides[sideName].projectedFilled}/{lobby.sides[sideName].capacity}</b>
                    </div>
                  ))}
                </div>
                <ReadyStatusStrip lobby={lobby} compact />
                <div className="ow-card-bottom">
                  <span>{getRecruitingSchedule(post)}</span>
                  <span className="ow-tier-chip">{post.ranked === false ? "티어 자유" : `${target} MMR 기준`}</span>
                  <span>{formatWhen(post.createdAt)}</span>
                  <span>{lobby.ready ? "전원 대기 완료" : "대기 확인 중"}</span>
                </div>
              </div>

              <div className="ow-card-side" onClick={(event) => event.stopPropagation()}>
                <span className="ow-slot-count">
                  <strong>{lobby.sides.teamA.projectedFilled + lobby.sides.teamB.projectedFilled}/{getRecruitingSideCapacity(post) * 2}</strong>
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
        const joinCapacity = getRecruitingSideCapacity(selectedPost);
        const selectedJoinPlayerIds = getPartyPlayerIds(selectedJoinTeam, joinDraft.playerIds, joinCapacity);
        const candidateMmr = joinDraft.joinMode === "team"
          ? selectedJoinTeam?.mmr ?? 0
          : app.currentUser.ratings.integrated;
        const fit = getRecruitingFit(selectedPost, candidateMmr || app.currentUser.ratings.integrated, app.state);
        const mine = selectedPost.playerId === app.currentUser.id;
        const myEntry = lobby.entries.find((entry) => entry.playerId === app.currentUser.id);
        const alreadyApplied = Boolean(myEntry && !myEntry.fixed);
        const canJoin = !mine && !alreadyApplied && fit.allowed && (joinDraft.joinMode === "player" || (Boolean(selectedJoinTeam) && selectedJoinPlayerIds.length > 0));
        const selectedTargetTeam = selectedPost.targetTeamId ? teamById[selectedPost.targetTeamId] : null;
        const selectedReferee = selectedPost.refereeId ? userById[selectedPost.refereeId] : null;
        const playingIds = [...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers];
        const trustedReserveRecorder = ["teamA", "teamB"]
          .flatMap((sideName) => lobby.sides[sideName].reserveCandidates ?? [])
          .find((candidate) => {
            const user = userById[candidate.playerId];
            return candidate.source === "reserve-entry" && candidate.status === "ready" && !playingIds.includes(candidate.playerId) && isEligibleReferee(user, REFEREE_TRUST_MIN);
          });
        const selectedRecorder = selectedReferee ?? (trustedReserveRecorder ? userById[trustedReserveRecorder.playerId] : null);

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
                <span><Clock3 size={16} /> {getRecruitingSchedule(selectedPost)}</span>
                {selectedTargetTeam ? <span><Swords size={16} /> 희망 상대 {selectedTargetTeam.name}</span> : null}
                <span><ShieldCheck size={16} /> {selectedRecorder ? `${selectedReferee ? "심판" : "후보 기록자"} ${selectedRecorder.name}` : "심판 없음 · 득점만"}</span>
                <span><UsersRound size={16} /> 팀은 선택 멤버만 참여</span>
                <span><Clock3 size={16} /> 전원 대기 후 방장 확정</span>
              </div>

              <ReadyStatusStrip lobby={lobby} />

              <div className="ow-lobby-grid">
                <SideRoster sideName="teamA" side={lobby.sides.teamA} userById={userById} teams={app.state.teams} />
                <SideRoster sideName="teamB" side={lobby.sides.teamB} userById={userById} teams={app.state.teams} />
              </div>

              <div className="ow-reserve-panel">
                <ReserveLine sideName="teamA" candidates={lobby.sides.teamA.reserveCandidates} playingIds={playingIds} userById={userById} teams={app.state.teams} />
                <ReserveLine sideName="teamB" candidates={lobby.sides.teamB.reserveCandidates} playingIds={playingIds} userById={userById} teams={app.state.teams} />
                {!lobby.sides.teamA.reserves.length && !lobby.sides.teamB.reserves.length ? <span>후보 없음</span> : null}
              </div>

              <div className="ow-room-rule-panel">
                <strong>규칙</strong>
                <span>{selectedPost.memo}</span>
                <span>팀 MMR은 실제 참가한 팀원 비율 기준으로 반영한다.</span>
                <span>신뢰도 {REFEREE_TRUST_MIN} 이상 후보가 경기 밖에서 대기 완료하면 기록자로 자동 배정된다.</span>
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
                          onClick={() => {
                            const teamId = mode === "team" ? getDefaultApplyTeamId(selectedPost, myTeams) : "";
                            const team = myTeams.find((item) => item.id === teamId) ?? null;
                            updateJoinDraft(selectedPost, {
                              joinMode: mode,
                              teamId,
                              playerIds: mode === "team" ? getDefaultTeamPlayerIds(team, joinCapacity) : [],
                            });
                          }}
                        >
                          {meta.label}
                        </button>
                      ))}
                    </div>
                    {joinDraft.joinMode === "team" ? (
                      <>
                        <label>
                          참여 팀
                          <select
                            value={joinDraft.teamId}
                            onChange={(event) => {
                              const teamId = event.target.value;
                              const team = myTeams.find((item) => item.id === teamId) ?? null;
                              updateJoinDraft(selectedPost, {
                                teamId,
                                playerIds: getDefaultTeamPlayerIds(team, joinCapacity),
                              });
                            }}
                          >
                            {myTeams.length ? myTeams.map((team) => (
                              <option key={team.id} value={team.id}>{team.name} · {team.mmr}</option>
                            )) : <option value="">내 팀 없음</option>}
                          </select>
                        </label>
                        <TeamMemberPicker
                          team={selectedJoinTeam}
                          userById={userById}
                          selectedIds={selectedJoinPlayerIds}
                          capacity={joinCapacity}
                          onChange={(playerIds) => updateJoinDraft(selectedPost, { playerIds })}
                        />
                      </>
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
                    {myEntry.status === "ready" ? "준비 해제" : "대기 완료"}
                  </Button>
                ) : null}
                {alreadyApplied ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="danger-button"
                    onClick={() => app.actions.cancelRecruitingParticipation(selectedPost.id)}
                  >
                    <XCircle size={18} /> 참여 취소
                  </Button>
                ) : null}
                {mine ? (
                  <Button type="button" disabled={!lobby.canConfirm} onClick={() => confirmMatch(selectedPost)}>
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
                <button
                  type="button"
                  className={draft.hostJoinMode === "team" ? "active" : ""}
                  onClick={() => {
                    const team = myTeams[0] ?? null;
                    update({
                      hostJoinMode: "team",
                      teamId: team?.id ?? "",
                      playerIds: getDefaultTeamPlayerIds(team, draftCapacity),
                    });
                  }}
                >
                  내 팀으로 열기
                </button>
                <button type="button" className={draft.hostJoinMode === "player" ? "active" : ""} onClick={() => update({ hostJoinMode: "player", teamId: "", playerIds: [] })}>개인으로 열기</button>
              </div>

              <div className="segmented-control compact-segments">
                <button type="button" className={!draft.ranked ? "active" : ""} onClick={() => update({ ranked: false })}>친선전</button>
                <button type="button" className={draft.ranked ? "active" : ""} onClick={() => update({ ranked: true })}>정규전</button>
              </div>

              <label>
                제목
                <input value={draft.title} placeholder={getDefaultTitle(draft)} onChange={(event) => update({ title: event.target.value })} />
              </label>

              <div className="ow-field-grid">
                <label>
                  날짜
                  <input type="date" required value={draft.scheduledDate} onChange={(event) => update({ scheduledDate: event.target.value })} />
                </label>
                <label>
                  시간
                  <input type="time" required value={draft.scheduledTime} onChange={(event) => update({ scheduledTime: event.target.value })} />
                </label>
              </div>

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
                  장소
                  <select value={draft.court} onChange={(event) => update({ court: event.target.value })}>
                    {COURTS.filter((court) => court.region === draft.region || draft.region === "전체").map((court) => (
                      <option key={court.id} value={court.name}>{court.region} · {court.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="ow-field-grid">
                {draft.hostJoinMode === "team" ? (
                  <div className="ow-party-field">
                    <label>
                      내 파티 팀
                      <select
                        value={draft.teamId}
                        onChange={(event) => {
                          const teamId = event.target.value;
                          const team = myTeams.find((item) => item.id === teamId) ?? null;
                          update({
                            teamId,
                            playerIds: getDefaultTeamPlayerIds(team, draftCapacity),
                          });
                        }}
                      >
                        {myTeams.length ? myTeams.map((team) => (
                          <option key={team.id} value={team.id}>{team.region} · {team.name} · {team.mmr}</option>
                        )) : <option value="">내 팀 없음</option>}
                      </select>
                    </label>
                    <TeamMemberPicker
                      team={selectedTeam}
                      userById={userById}
                      selectedIds={selectedHostPlayerIds}
                      capacity={draftCapacity}
                      onChange={(playerIds) => update({ playerIds })}
                    />
                  </div>
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
                    <strong>{draftCapacity} vs {draftCapacity}</strong>
                    <em>{draft.hostJoinMode === "team" ? `${selectedHostPlayerIds.length}명 선택 배치` : "개인 1명이 A팀에 배치"}</em>
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
                  <ShieldCheck size={17} /> {canPostRecruiting ? "등록 가능" : hasSchedule ? "팀/팀원 선택 필요" : "날짜/시간/장소 필요"}
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
