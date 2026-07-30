import { useEffect, useMemo, useState } from "react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import SearchPicker from "../common/SearchPicker.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import TeamEmblem from "../team/TeamEmblem.jsx";
import {
  MATCH_SIDES,
  SIDE_LABEL_TEXT as SIDE_LABELS,
} from "../../lib/constants.js";
import { getTeamHashtag, getUserHashtag } from "../../lib/handles.js";
import {
  getMatchRecordSetupStatus,
  getMatchSidePlayerIds,
} from "../../lib/matchUtils.js";
import { getRecruitingSideCapacity } from "../../lib/recruiting.js";

export default function MatchRecordParticipantSetupPanel({
  match,
  users,
  teams,
  currentUserId,
  onSave,
}) {
  const composition = match?.rules?.recordComposition === "team" ? "team" : "individual";
  const setupStatus = getMatchRecordSetupStatus(match);
  const capacity = getRecruitingSideCapacity(match);
  const [teamAPlayerIds, setTeamAPlayerIds] = useState(() => getMatchSidePlayerIds(match, "teamA"));
  const [teamBPlayerIds, setTeamBPlayerIds] = useState(() => getMatchSidePlayerIds(match, "teamB"));
  const [userSnapshots, setUserSnapshots] = useState({});
  const [queryBySide, setQueryBySide] = useState({ teamA: "", teamB: "" });
  const myTeams = useMemo(
    () => teams.filter((team) => (team.members ?? []).some((member) => member.userId === currentUserId)),
    [currentUserId, teams],
  );
  const [teamAId, setTeamAId] = useState(match?.teamA?.teamId || myTeams[0]?.id || "");
  const [teamBSnapshot, setTeamBSnapshot] = useState(() => {
    const savedTeamId = match?.teamB?.teamId || "";
    return teams.find((team) => team.id === savedTeamId)
      ?? (savedTeamId ? { id: savedTeamId, name: match?.teamB?.name || "B사이드" } : null);
  });
  const [teamQuery, setTeamQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const userById = useMemo(
    () => ({ ...Object.fromEntries(users.map((user) => [user.id, user])), ...userSnapshots }),
    [userSnapshots, users],
  );

  useEffect(() => {
    setTeamAPlayerIds(getMatchSidePlayerIds(match, "teamA"));
    setTeamBPlayerIds(getMatchSidePlayerIds(match, "teamB"));
    setTeamAId(match?.teamA?.teamId || myTeams[0]?.id || "");
    const savedTeamId = match?.teamB?.teamId || "";
    setTeamBSnapshot((current) => teams.find((team) => team.id === savedTeamId)
      ?? (current?.id === savedTeamId
        ? current
        : savedTeamId
          ? { id: savedTeamId, name: match?.teamB?.name || "B사이드" }
          : null));
    setFeedback("");
  }, [
    match?.id,
    match?.updatedAt,
    match?.teamA?.teamId,
    match?.teamB?.teamId,
    match?.teamB?.name,
    myTeams,
    teams,
  ]);

  const selectedIds = new Set([...teamAPlayerIds, ...teamBPlayerIds]);
  const togglePlayer = (sideName, user) => {
    if (!user?.id || user.anonymous) return;
    const ownIds = sideName === "teamA" ? teamAPlayerIds : teamBPlayerIds;
    const otherIds = sideName === "teamA" ? teamBPlayerIds : teamAPlayerIds;
    if (otherIds.includes(user.id)) return;
    if (user.id === currentUserId && sideName !== "teamA") return;
    const selected = ownIds.includes(user.id);
    if (selected && user.id === currentUserId) return;
    const nextIds = selected
      ? ownIds.filter((playerId) => playerId !== user.id)
      : [...ownIds, user.id].slice(0, capacity);
    if (sideName === "teamA") setTeamAPlayerIds(nextIds);
    else setTeamBPlayerIds(nextIds);
    setUserSnapshots((current) => ({ ...current, [user.id]: user }));
    setQueryBySide((current) => ({ ...current, [sideName]: "" }));
    setFeedback("");
  };
  const renderUserResult = (sideName) => (user) => (
    <div key={user.id} className="search-picker-result-row search-picker-result-row-actionable">
      <button
        type="button"
        className="search-picker-result-main"
        disabled={selectedIds.has(user.id)}
        onClick={() => togglePlayer(sideName, user)}
      >
        <strong>{user.name}</strong>
        <span>{getUserHashtag(user)} · {user.position ?? "포지션 자유"}</span>
      </button>
    </div>
  );
  const renderSelectedPlayers = (sideName, playerIds) => (
    <div className="arena-record-setup-selected">
      {playerIds.map((playerId) => {
        const user = userById[playerId];
        const fixed = playerId === currentUserId;
        return (
          <button
            key={playerId}
            type="button"
            disabled={fixed}
            onClick={() => togglePlayer(sideName, user)}
          >
            <ProfileEmblem user={user} className="small" />
            <span>
              <strong>{user?.name ?? "선수"}</strong>
              <em>{fixed ? "방장 고정" : "선택 해제"}</em>
            </span>
          </button>
        );
      })}
    </div>
  );
  const teamCandidates = teams.filter((team) => team.id !== teamAId);
  const renderTeamResult = (team) => (
    <div key={team.id} className="search-picker-result-row search-picker-result-row-actionable">
      <button
        type="button"
        className="search-picker-result-main"
        onClick={() => {
          setTeamBSnapshot(team);
          setTeamQuery("");
          setFeedback("");
        }}
      >
        <strong>{team.name}</strong>
        <span>{getTeamHashtag(team)} · {team.region ?? "지역 미정"}</span>
      </button>
    </div>
  );
  const individualReady = (
    teamAPlayerIds.length === capacity
    && teamBPlayerIds.length === capacity
    && teamAPlayerIds.includes(currentUserId)
  );
  const teamReady = Boolean(teamAId && teamBSnapshot?.id && teamAId !== teamBSnapshot.id);
  const savedTeamAId = match?.teamA?.teamId || "";
  const savedTeamBId = match?.teamB?.teamId || "";
  const teamSelectionChanged = teamAId !== savedTeamAId || (teamBSnapshot?.id || "") !== savedTeamBId;
  const saveReady = composition === "individual" ? individualReady : teamReady && teamSelectionChanged;
  const save = async () => {
    if (saving || !saveReady) return;
    setSaving(true);
    setFeedback("");
    const result = await onSave?.(composition === "individual"
      ? { composition, teamAPlayerIds, teamBPlayerIds }
      : { composition, teamAId, teamBId: teamBSnapshot.id });
    if (!result || result?.ok === false) {
      setFeedback("참가자 구성을 저장하지 못했습니다. 선택값과 권한을 확인해 주세요.");
    } else {
      setFeedback(composition === "team"
        ? "팀 선택을 저장했습니다. 각 팀장이 실제 출전 명단을 확정해 주세요."
        : "실제 참가자를 저장했습니다.");
    }
    setSaving(false);
  };

  return (
    <div className="arena-record-setup-panel">
      <header>
        <span>
          <strong>경기 기록 참가자 구성</strong>
          <em>{composition === "team"
            ? "팀 구성 · 양 팀장이 출전 명단을 확정"
            : "개인 구성 · 실제 참가자가 각자 결과를 확인"}</em>
        </span>
        <Badge tone={setupStatus?.tone ?? "orange"}>{setupStatus?.label ?? "구성 확인"}</Badge>
      </header>
      {composition === "individual" ? (
        <div className="arena-record-setup-grid">
          {MATCH_SIDES.map((sideName) => {
            const playerIds = sideName === "teamA" ? teamAPlayerIds : teamBPlayerIds;
            return (
              <section key={sideName}>
                <strong>{SIDE_LABELS[sideName]} 선수 {playerIds.length}/{capacity}</strong>
                <SearchPicker
                  value={queryBySide[sideName]}
                  onChange={(value) => setQueryBySide((current) => ({ ...current, [sideName]: value }))}
                  placeholder="이름, #해시태그 검색"
                  items={users.filter((user) => !user.anonymous && !selectedIds.has(user.id))}
                  remoteSearchType="player"
                  idleItems={users.filter((user) => !user.anonymous && !selectedIds.has(user.id)).slice(0, 8)}
                  title={`${SIDE_LABELS[sideName]} 선수 검색`}
                  emptyText="선수 없음"
                  showIdleOnFocus
                  floating
                  closeOnResultClick
                  renderItem={renderUserResult(sideName)}
                />
                {renderSelectedPlayers(sideName, playerIds)}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="arena-record-setup-grid">
          <label>
            A사이드 내 팀
            <select
              value={teamAId}
              onChange={(event) => {
                setTeamAId(event.target.value);
                if (event.target.value === teamBSnapshot?.id) setTeamBSnapshot(null);
                setFeedback("");
              }}
            >
              <option value="">팀 선택</option>
              {myTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label>
            B사이드 상대 팀
            <SearchPicker
              value={teamQuery}
              onChange={setTeamQuery}
              placeholder="팀명, #해시태그 검색"
              items={teamCandidates}
              remoteSearchType="team"
              idleItems={teamCandidates.slice(0, 8)}
              title="상대 팀 검색"
              emptyText="팀 없음"
              showIdleOnFocus
              floating
              closeOnResultClick
              renderItem={renderTeamResult}
            />
            {teamBSnapshot ? (
              <span className="arena-record-team-selected">
                <TeamEmblem team={teamBSnapshot} />
                <strong>{teamBSnapshot.name}</strong>
                <button type="button" onClick={() => setTeamBSnapshot(null)}>해제</button>
              </span>
            ) : null}
          </label>
        </div>
      )}
      <div className="arena-record-setup-actions">
        <span>{feedback || (composition === "team"
          ? setupStatus?.stage === "complete"
            ? "양 팀의 실제 출전 명단이 확정됐습니다."
            : savedTeamAId && savedTeamBId
              ? "각 팀장이 자기 팀의 실제 출전 명단을 확정해야 합니다."
              : "팀을 저장한 뒤 각 팀장이 실제 출전 명단을 확정합니다."
          : `A/B 각각 ${capacity}명을 모두 선택해야 저장할 수 있습니다.`)}</span>
        <Button type="button" size="sm" disabled={saving || !saveReady} onClick={save}>
          {saving
            ? "저장 중"
            : composition === "team"
              ? (savedTeamAId && savedTeamBId ? "팀 변경 저장" : "팀 선택 저장")
              : "참가자 저장"}
        </Button>
      </div>
    </div>
  );
}
