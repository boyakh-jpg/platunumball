import { useMemo, useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import Button from "../common/Button.jsx";
import SearchPicker from "../common/SearchPicker.jsx";
import "../../styles/match-attendance.css";

const MATCH_SIDES = ["teamA", "teamB"];

function uniqueIds(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function getPlayedIds(match = {}, sideName = "teamA") {
  const values = match.playedPlayerIds?.[sideName] ?? match.rules?.playedPlayerIds?.[sideName];
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

function getActiveIds(match = {}) {
  return MATCH_SIDES.flatMap((sideName) => (
    Array.isArray(match?.[sideName]?.players) ? match[sideName].players : []
  )).filter(Boolean);
}

export default function MatchPostgameRosterPanel({
  match,
  users = [],
  onAdd,
  onRemove,
}) {
  const [sideName, setSideName] = useState("teamA");
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [anonymousName, setAnonymousName] = useState("");
  const [pendingKey, setPendingKey] = useState("");
  const [feedback, setFeedback] = useState("");

  const playedBySide = useMemo(() => ({
    teamA: getPlayedIds(match, "teamA"),
    teamB: getPlayedIds(match, "teamB"),
  }), [match]);
  const blockedIds = useMemo(
    () => new Set(uniqueIds([...getActiveIds(match), ...playedBySide.teamA, ...playedBySide.teamB])),
    [match, playedBySide],
  );
  const addedIds = useMemo(() => {
    const values = match?.rules?.postgameAddedPlayerIds;
    return Array.isArray(values) ? values.filter(Boolean) : [];
  }, [match?.rules?.postgameAddedPlayerIds]);
  const userById = useMemo(
    () => Object.fromEntries([
      ...users,
      ...Object.values(match?.anonymousPlayers ?? {}),
    ].map((user) => [user.id, user])),
    [match?.anonymousPlayers, users],
  );
  const localCandidates = useMemo(
    () => users.filter((user) => user?.id && !user.anonymous && !blockedIds.has(user.id)),
    [blockedIds, users],
  );

  const normalizeCandidate = (item) => {
    const user = item?.player ?? item?.profile ?? item;
    return user?.id && !user.anonymous && !blockedIds.has(user.id) ? user : null;
  };
  const selectUser = (user) => {
    setSelectedUser(user);
    setQuery("");
    setFeedback("");
  };
  const add = async (draft, pending) => {
    if (pendingKey) return;
    setPendingKey(pending);
    setFeedback("");
    try {
      const result = await onAdd?.({ ...draft, sideName });
      if (!result || result?.ok === false) throw new Error("postgame_roster_add_failed");
      setSelectedUser(null);
      setAnonymousName("");
      setFeedback("기록 대상에 추가했습니다. MMR에서는 제외됩니다.");
    } catch {
      setFeedback("추가하지 못했습니다. 중복 선수와 기록 입력 가능 시간을 확인하세요.");
    } finally {
      setPendingKey("");
    }
  };
  const remove = async (playerId) => {
    if (pendingKey) return;
    setPendingKey(playerId);
    setFeedback("");
    try {
      const result = await onRemove?.(playerId);
      if (!result || result?.ok === false) throw new Error("postgame_roster_remove_failed");
      setFeedback("경기 후 추가 선수를 제거했습니다.");
    } catch {
      setFeedback("선수를 제거하지 못했습니다.");
    } finally {
      setPendingKey("");
    }
  };

  return (
    <section className="ui-panel ui-match-postgame-roster" aria-label="경기 후 인원 추가">
      <header>
        <span>
          <UserPlus size={18} />
          <strong>경기 후 인원 추가</strong>
        </span>
        <small>실제 출전 기록에는 포함하고 MMR에서는 제외합니다.</small>
      </header>

      <div className="ui-match-postgame-side" role="group" aria-label="추가할 사이드">
        {MATCH_SIDES.map((side) => (
          <button
            key={side}
            type="button"
            className={sideName === side ? "active" : ""}
            onClick={() => setSideName(side)}
          >
            {side === "teamA" ? "A사이드" : "B사이드"}
          </button>
        ))}
      </div>

      <div className="ui-match-postgame-add-grid">
        <div>
          <strong>가입 선수</strong>
          <SearchPicker
            value={query}
            onChange={setQuery}
            placeholder="선수 이름, #해시태그 검색"
            items={localCandidates}
            idleItems={localCandidates.slice(0, 8)}
            remoteSearchType="profile"
            mapRemoteItem={normalizeCandidate}
            title="추가할 선수"
            emptyText="추가 가능한 선수 없음"
            showIdleOnFocus
            floating
            closeOnResultClick
            renderItem={(user) => (
              <button
                type="button"
                className="ui-match-postgame-search-result"
                key={user.id}
                onClick={() => selectUser(user)}
              >
                <strong>{user.name}</strong>
                <span>{user.hashtag ? `#${String(user.hashtag).replace(/^#/, "")}` : user.position ?? "선수"}</span>
              </button>
            )}
          />
          {selectedUser ? (
            <div className="ui-match-postgame-selected">
              <span><strong>{selectedUser.name}</strong><small>가입 선수</small></span>
              <Button
                type="button"
                size="sm"
                disabled={Boolean(pendingKey)}
                onClick={() => void add({ userId: selectedUser.id }, "registered")}
              >
                추가
              </Button>
            </div>
          ) : null}
        </div>

        <label>
          <strong>무기명 선수</strong>
          <input
            value={anonymousName}
            maxLength={30}
            placeholder="현장 표시 이름"
            onChange={(event) => {
              setAnonymousName(event.target.value);
              setFeedback("");
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={Boolean(pendingKey) || !anonymousName.trim()}
            onClick={() => void add({ name: anonymousName.trim() }, "anonymous")}
          >
            무기명 추가
          </Button>
        </label>
      </div>

      {addedIds.length ? (
        <div className="ui-match-postgame-added-list">
          {addedIds.map((playerId) => {
            const player = userById[playerId];
            const playerSide = playedBySide.teamB.includes(playerId) ? "B" : "A";
            return (
              <div key={playerId}>
                <span>
                  <strong>{player?.name ?? "추가 선수"}</strong>
                  <small>{playerSide}사이드 · MMR 제외</small>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label={`${player?.name ?? "추가 선수"} 제거`}
                  disabled={Boolean(pendingKey)}
                  onClick={() => void remove(playerId)}
                >
                  <Trash2 size={15} /> 제거
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      {feedback ? <p role="status">{feedback}</p> : null}
    </section>
  );
}
