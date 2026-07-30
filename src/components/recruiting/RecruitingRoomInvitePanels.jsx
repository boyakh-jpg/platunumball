
import {
  ShieldCheck,
  X,
} from "lucide-react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import SearchPicker from "../common/SearchPicker.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import TeamEmblem from "../team/TeamEmblem.jsx";
import {
  ROOM_RELATION_TERMS,
  SIDE_LABEL_TEXT as SIDE_LABELS,
} from "../../lib/constants.js";

import {
  getSelectableTeamPlayerIds,
} from "../../lib/recruiting.js";
import {
  findTeamByHashtag,
  getTeamHashtag,
  getUserHashtag,
} from "../../lib/handles.js";


export function InvitePanel({
  sideName,
  reserve = false,
  query,
  onQueryChange,
  users,
  teams,
  userById,
  disabledPlayerIds,
  selectedPlayerIds,
  favoritePlayerIds,
  favoriteTeamIds,
  allowedTeamId = "",
  playerOnly = false,
  poolMode = false,
  canInvitePlayer = () => true,
  onTogglePlayer,
  onInvitePlayers,
  onClose,
  error = "",
  remoteSearchEnabled = true,
}) {
  const teamSummonMode = Boolean(allowedTeamId);
  const relationTerms = teamSummonMode ? ROOM_RELATION_TERMS.teamRoster : ROOM_RELATION_TERMS.pregame;
  const actionNoun = relationTerms.request;
  const actionLabel = teamSummonMode ? "소집" : actionNoun;
  const matchedTeam = !playerOnly && query.trim() ? findTeamByHashtag(teams, query) : null;
  const selectedSet = new Set(selectedPlayerIds);
  const disabledSet = new Set(disabledPlayerIds);
  const allowedTeam = allowedTeamId ? teams.find((team) => team.id === allowedTeamId) : null;
  const rosterTeam = teamSummonMode ? allowedTeam : matchedTeam;
  const allowedTeamMemberIds = new Set(allowedTeam ? getSelectableTeamPlayerIds(allowedTeam) : []);
  const isAllowedPlayer = (playerId, player = null) => (
    (!allowedTeamId || allowedTeamMemberIds.has(playerId) || (player?.teamIds ?? []).includes(allowedTeamId)) &&
    canInvitePlayer(playerId, player)
  );
  const favoritePlayers = favoritePlayerIds.map((playerId) => userById[playerId]).filter(Boolean);
  const favoriteTeams = favoriteTeamIds
    .map((teamId) => teams.find((team) => team.id === teamId))
    .filter((team) => !playerOnly && team && (!allowedTeamId || team.id === allowedTeamId));
  const teamMemberIds = rosterTeam && (!allowedTeamId || rosterTeam.id === allowedTeamId) ? getSelectableTeamPlayerIds(rosterTeam) : [];
  const selectedInvitableIds = selectedPlayerIds.filter((playerId) => !disabledSet.has(playerId) && isAllowedPlayer(playerId, userById[playerId]));
  const canShowSelectedInviteAction = Boolean(!teamSummonMode && selectedInvitableIds.length && !matchedTeam);
  const selectedInviteTeamId = allowedTeamId || null;
  const selectedInviteJoinMode = allowedTeamId ? "team" : "player";
  const inviteQuery = query.trim().toLowerCase();
  const inviteSearchPlayers = inviteQuery
    ? users
      .filter((player) => isAllowedPlayer(player.id, player))
      .filter((player) => `${player.name} ${getUserHashtag(player)} ${player.region} ${player.position}`.toLowerCase().includes(inviteQuery))
      .map((player) => ({ type: "player", player }))
    : [];
  const inviteSearchTeams = inviteQuery && !allowedTeamId && !playerOnly
    ? teams
      .filter((team) => `${team.name} ${getTeamHashtag(team)} ${team.region} ${team.homeCourt}`.toLowerCase().includes(inviteQuery))
      .map((team) => ({ type: "team", team }))
    : [];
  const inviteSearchItems = [...inviteSearchPlayers, ...inviteSearchTeams];
  const idleInviteItems = [
    ...favoritePlayers.filter((player) => isAllowedPlayer(player.id, player)).map((player) => ({ type: "player", player })),
    ...favoriteTeams.map((team) => ({ type: "team", team })),
  ];
  const getInviteItemSearchText = (item = {}) => {
    if (item.type === "team") {
      const team = item.team ?? item;
      return [team.name, getTeamHashtag(team), team.region, team.homeCourt].filter(Boolean).join(" ");
    }
    const player = item.player ?? item;
    return [player.name, getUserHashtag(player), player.handle, player.region, player.position].filter(Boolean).join(" ");
  };

  const renderInviteSearchItem = (item) => {
    if (item.type === "team") {
      const team = item.team;
      return (
        <div
          key={`team-${team.id}`}
          className="search-picker-result-row search-picker-result-row-actionable"
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" className="search-picker-result-main" onClick={() => onQueryChange(getTeamHashtag(team))}>
            <strong>{team.name}</strong>
            <span>{getTeamHashtag(team)} · {team.mmr} MMR</span>
            <em>팀</em>
          </button>

        </div>
      );
    }
    const player = item.player;
    const disabled = disabledSet.has(player.id) || !isAllowedPlayer(player.id, player);
    const selected = selectedSet.has(player.id);
    return (
      <div
        key={`player-${player.id}`}
        className={selected ? "search-picker-result-row search-picker-result-row-actionable selected" : "search-picker-result-row search-picker-result-row-actionable"}
        onMouseDown={(event) => event.preventDefault()}
      >
        <button
          type="button"
          className="search-picker-result-main"
          disabled={disabled}
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            if (!disabled) onTogglePlayer(player.id);
          }}
        >
          <strong>{player.name}</strong>
          <span>{getUserHashtag(player)} · {player.position}</span>
          <em>{disabled ? "불가" : selected ? "선택됨" : "선택"}</em>
        </button>
      </div>
    );
  };

  return (
    <div className="arena-invite-panel">
      <header>
        <div>
          <strong>{poolMode ? "참가자 초대" : `${SIDE_LABELS[sideName]} ${reserve ? "후보" : "빈 슬롯"} ${actionLabel}`}</strong>
          <span>{poolMode
            ? "수락하면 통합 참가자 풀에 합류합니다."
            : teamSummonMode
              ? "사이드장이 팀원을 출전 또는 후보 명단에 바로 등록할 수 있습니다."
              : reserve
                ? "수락하면 해당 사이드의 후보 선수로 합류합니다."
                : "선착순으로 수락되며, 정원이 차면 참여할 수 없습니다."}</span>
        </div>
        <button type="button" className="arena-icon-button" aria-label={`${actionNoun} 닫기`} onClick={onClose}><X size={18} /></button>
      </header>
      {!teamSummonMode ? (
        <SearchPicker
          value={query}
          onChange={onQueryChange}
          placeholder={playerOnly ? "선수 검색" : "선수 또는 팀 검색"}
          items={inviteSearchItems}
          getSearchText={getInviteItemSearchText}
          remoteSearchType={remoteSearchEnabled ? (playerOnly ? "profile" : ["profile", "team"]) : ""}
          mapRemoteItem={(item) => {
            if (item.kind === "team") return playerOnly ? null : { type: "team", team: item };
            if (!isAllowedPlayer(item.id, item)) return null;
            return { type: "player", player: item };
          }}
          idleItems={idleInviteItems}
          idleTitle="즐겨찾기"
          showIdleOnFocus
          limit={5}
          detailLimit={50}
          loadMoreStep={5}
          remoteLimit={25}
          floating
          fieldClassName="arena-invite-search"
          renderItem={renderInviteSearchItem}
        />
      ) : null}

      {canShowSelectedInviteAction ? (
        <div className="arena-invite-actions">
          <Button type="button" size="sm" onClick={() => onInvitePlayers(selectedInvitableIds, selectedInviteTeamId, selectedInviteJoinMode)}>
            선택 {selectedInvitableIds.length}명 {actionLabel}
          </Button>
        </div>
      ) : null}

      {error ? <div className="arena-invite-empty error">{error}</div> : null}

      {teamSummonMode && !allowedTeam ? <div className="arena-invite-empty error">팀원 명단을 불러오지 못했습니다.</div> : null}

      {rosterTeam && (!allowedTeamId || rosterTeam.id === allowedTeamId) ? (
        <div className="arena-invite-team-picker">
          <div className="arena-invite-team-head">
            <>
              <TeamEmblem team={rosterTeam} size="xs" />
              <span>
                <strong>{rosterTeam.name}</strong>
                <em>{getTeamHashtag(rosterTeam)} · {rosterTeam.mmr} MMR</em>
              </span>
            </>
          </div>
          <div className="arena-invite-member-grid">
            {teamMemberIds.map((playerId) => {
              const player = userById[playerId];
              const selected = selectedSet.has(playerId);
              const disabled = disabledSet.has(playerId);
              return (
                <button key={playerId} type="button" className={selected ? "selected" : ""} disabled={disabled} aria-pressed={selected} onClick={() => {
                  if (!disabled) onTogglePlayer(playerId);
                }}>
                  <ProfileEmblem user={player} className="small" />
                  <span>
                    <strong>{player?.name ?? "선수"}</strong>
                    <em>{disabled ? `이미 대기/${actionLabel}` : getUserHashtag(player)}</em>
                  </span>
                </button>
              );
            })}
          </div>
          <Button type="button" size="sm" disabled={!selectedInvitableIds.length} onClick={() => onInvitePlayers(selectedInvitableIds, rosterTeam.id, "team")}>
            선택 {selectedInvitableIds.length}명 {actionLabel}
          </Button>
        </div>
      ) : null}

      {!teamSummonMode && query.trim() && !inviteSearchItems.length && !matchedTeam ? <div className="arena-invite-empty">검색 결과 없음</div> : null}
    </div>
  );
}

export function RefereeInvitePanel({
  query,
  onQueryChange,
  candidates,
  favoriteRefereeIds = [],
  pendingInvitations,
  userById,
  matches,
  minTrust,
  canInvite,
  canJoin,
  disabledRefereeIds = [],
  onInviteReferee,
  onJoin,
  remoteSearchEnabled = true,
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const disabledRefereeSet = new Set(disabledRefereeIds);
  const searchItems = canInvite
    ? candidates
      .filter((user) => (
        !normalizedQuery ||
        `${user.name} ${getUserHashtag(user)} ${user.region} ${user.position} 신뢰도 ${user.trustScore}`.toLowerCase().includes(normalizedQuery)
      ))
      .slice(0, 8)
    : [];
  const favoriteReferees = favoriteRefereeIds
    .map((userId) => candidates.find((user) => user.id === userId))
    .filter(Boolean);
  const idleItems = canInvite ? (favoriteReferees.length ? favoriteReferees : candidates.slice(0, 8)) : [];
  const renderRefereeSearchItem = (user) => {
    return (
      <div
        key={user.id}
        className="search-picker-result-row search-picker-result-row-actionable"
        onMouseDown={(event) => event.preventDefault()}
      >
        <button type="button" className="search-picker-result-main" onClick={() => onInviteReferee(user.id)}>
          <span>
            <strong>{user.name}</strong>
          </span>
          <span>{getUserHashtag(user)} · 신뢰도 {user.trustScore}</span>
          <em>초대</em>
        </button>
      </div>
    );
  };

  return (
    <div className="arena-invite-panel arena-referee-invite-panel">
      <header>
        <div>
          <strong>심판 초대 슬롯</strong>
          <span>심판 자격이 있고 이 방에 참여하지 않은 사람만 초대할 수 있습니다.</span>
        </div>
        {canJoin ? (
          <Button type="button" size="sm" onClick={onJoin}>
            <ShieldCheck size={16} /> 심판참여
          </Button>
        ) : null}
      </header>

      {canInvite ? (
        <SearchPicker
          value={query}
          onChange={onQueryChange}
          placeholder="심판 이름, #해시태그, 지역 검색"
          items={searchItems}
          remoteSearchType={remoteSearchEnabled ? "referee" : ""}
          mapRemoteItem={(item) => (disabledRefereeSet.has(item.id) ? null : item)}
          idleItems={idleItems}
          idleTitle={favoriteReferees.length ? "즐겨찾기 심판" : "초대 가능한 심판"}
          showIdleOnFocus
          floating
          fieldClassName="arena-invite-search"
          closeOnResultClick
          renderItem={renderRefereeSearchItem}
        />
      ) : (
        <div className="arena-invite-empty">심판 초대 권한 없음</div>
      )}

      {pendingInvitations.length ? (
        <div className="arena-referee-pending-list">
          {pendingInvitations.map((invitation) => {
            const target = userById[invitation.targetUserId];
            return (
              <span key={invitation.id}>
                {target?.name ?? "심판"} · 초대 대기
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function InvitationPanel({ invitations, userById, teams, currentUserId, alreadyApplied, poolMode = false, onAccept, onDecline }) {
  const pending = invitations.filter((invitation) => invitation.status === "pending");
  if (!pending.length) return null;
  return (
    <div className="arena-invitation-list">
      <strong>초대장</strong>
      {pending.map((invitation) => {
        const target = userById[invitation.targetUserId];
        const mine = invitation.targetUserId === currentUserId;
        const inviteLabel = invitation.role === "referee"
          ? "심판"
          : poolMode ? "개인 참가" : `${SIDE_LABELS[invitation.side]} · ${invitation.reserve ? "후보" : "출전"}`;
        return (
          <div key={invitation.id} className={mine ? "mine" : ""}>
            <PlayerHoverCard as="span" user={target} teams={teams}>
              <ProfileEmblem user={target} className="small" />
              <span>
                <b>{target?.name ?? "선수"}</b>
                <em>{inviteLabel} · {getUserHashtag(target)}</em>
              </span>
            </PlayerHoverCard>
            {mine && alreadyApplied ? (
              <Badge tone="green">참가 완료</Badge>
            ) : mine ? (
              <span className="arena-invite-actions">
                <Button type="button" size="sm" onClick={() => onAccept(invitation)}>수락</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onDecline(invitation.id)}>거절</Button>
              </span>
            ) : (
              <Badge tone="blue">수락 대기</Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}
