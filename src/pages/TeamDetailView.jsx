import { ImageUp, RotateCcw, Star, Trash2 } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import EmblemCropEditor from "../components/common/EmblemCropEditor.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import RecentMatchRow from "../components/match/RecentMatchRow.jsx";
import EntityProfileHero from "../components/profile/EntityProfileHero.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TierEmblem from "../components/rating/TierEmblem.jsx";
import { MAX_TEAM_MEMBERS, MAX_TEAM_MEMBERSHIPS, TEAM_INVITE_ROLES, getTeamRoleLabel, normalizeTeamRole } from "../lib/constants.js";
import { getMatchSideScore as getSideScore } from "../lib/matchUtils.js";
import { getSideResult, getTeamSide } from "../lib/season.js";
import {
  TEAM_EMBLEM_ABBREVIATION_MAX_CHARACTERS,
  TEAM_EMBLEM_FONT_OPTIONS,
  isTeamEmblemAbbreviationDraftWithinLimits,
} from "../lib/teamEmblem.js";
import { formatEmblemDate, getEmblemUploadWarning } from "../lib/emblemPolicy.js";
import { getUserHashtag } from "../lib/handles.js";
import { MatchRoomModal } from "./Matches.jsx";

function myTeamCountLabel(canManage) {
  return canManage ? "관리" : "조회";
}

const inviteRoleOptions = TEAM_INVITE_ROLES.map((role) => [role, getTeamRoleLabel(role)]);

function getManagedRoleOptions(member, captainId) {
  if (member.userId === captainId) return [["captain", getTeamRoleLabel("captain")]];
  return inviteRoleOptions;
}

export default function TeamDetailView({ controller }) {
  const { addUserId, app, archivedHistory, availableUsers, canAddMember, canManage, cancelPendingTeamInvitation, captain, changeTeamMemberRole, confirmEmblemUpload, confirmedCount, cooldownNextAt, deleteArmed, deleteTeam, detailHistory, directoryPending, emblemAbbreviationCharacterCount, emblemCanRestore, emblemFeedback, emblemFile, emblemInputRef, emblemPending, emblemSource, emblemStatusError, emblemStatusRequestRef, emblemStyleDraft, emblemUploadLocked, excludeTeamMember, favoriteError, favoritePending, favoriteTeamIds, firstAddableUser, history, historyCount, historyIds, inviteMember, isFavoriteTeam, loadDirectory, loadTeamEmblemStatus, loadTeamRecords, loadedLosses, loadedWins, losses, memberDraft, memberQuery, membershipCounts, moderationBlockedAt, moderationLocked, nextEmblemUploadAt, pendingTargetIds, pendingTeamInvitations, refreshTeamDetail, regularMembers, renderInviteSearchItem, renderMembers, reserveMembers, restorePreviousEmblem, retryTeamEmblemStatus, saveEmblemStyle, selectEmblemSource, selectedCount, selectedHistoryMatchId, selectedInviteProfile, selectedInviteUser, selectedRemoteUser, setDeleteArmed, setEmblemCanRestore, setEmblemFeedback, setEmblemFile, setEmblemPending, setEmblemStyleDraft, setMemberDraft, setMemberQuery, setSelectedHistoryMatchId, setSelectedInviteProfile, setTeamInviteError, team, teamDetailError, teamFull, teamId, teamInviteError, teamInvitePending, teamManagementError, teamManagementPending, teamRecordArchive, toggleTeamFavorite, uploadEmblem, userMap, winRate, wins } = controller;
  const teamControlPending = teamInvitePending || teamManagementPending;
  return (
    <div className="page-stack team-detail-page rank-team-page">
      {teamDetailError ? (
        <Card className="section-card">
          <div className="section-title-row">
            <span className="form-warning">{teamDetailError} 최신 정보를 확인하려면 다시 시도해 주세요.</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => { void refreshTeamDetail(); }}>다시 시도</Button>
          </div>
        </Card>
      ) : null}
      <EntityProfileHero
        className="team-detail-hero rank-profile-hero rank-team-hero"
        style={{ "--team-color": team.accent }}
        eyebrow="Team Profile"
        title={team.name}
        subtitle={`${team.region} · ${team.homeCourt}`}
        action={(
          <Button
              type="button"
              variant={isFavoriteTeam ? "primary" : "secondary"}
              className={isFavoriteTeam ? "favorite-toggle-button ui-liquid-glass active" : "favorite-toggle-button ui-liquid-glass"}
              disabled={favoritePending}
              onClick={() => { void toggleTeamFavorite(); }}
            >
              <Star size={16} fill={isFavoriteTeam ? "currentColor" : "none"} />
              {favoritePending ? "저장 중" : isFavoriteTeam ? "즐겨찾기됨" : "즐겨찾기"}
          </Button>
        )}
        badges={(
          <>
            <Badge tone="green" className="ui-liquid-glass">{team.mmr} 팀 MMR</Badge>
            <Badge tone="gold" className="ui-liquid-glass">팀장 {userMap[captain?.userId]?.name ?? "미지정"}</Badge>
          </>
        )}
        visual={<div className="team-tier-hero"><TierEmblem mmr={team.mmr} size="hero" showLabel /></div>}
      />
      {favoriteError ? <span role="status" className="form-warning">{favoriteError}</span> : null}

      <nav className="rank-profile-tabs">
        <a href="#team-history">전적</a>
        <a href="#team-roster">로스터</a>
        <a href="#team-control">관리</a>
      </nav>

      <section className="rank-profile-summary">
        <Card className="section-card rank-record-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Ranked Record</p>
              <h2>경쟁전 전적</h2>
            </div>
          </div>
          <div className="rank-stat-grid">
            <span><strong>{wins}승</strong>승리</span>
            <span><strong>{losses}패</strong>패배</span>
            <span><strong>{winRate}%</strong>승률</span>
            <span><strong>{historyCount}</strong>전체 경기 이력</span>
          </div>
        </Card>
        <Card className="section-card rank-record-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Roster</p>
              <h2>선수 구성</h2>
            </div>
            <Badge tone="green">{team.members.length}명</Badge>
          </div>
          <div className="rank-stat-grid">
            <span><strong>{regularMembers.length}</strong>팀원</span>
            <span><strong>{reserveMembers.length}</strong>용병</span>
            <span><strong>{myTeamCountLabel(canManage)}</strong>권한</span>
            <span><strong>{team.region}</strong>지역</span>
          </div>
        </Card>
      </section>

      <div className="content-grid wide-left">
        <div className="page-stack">
          <Card id="team-history" className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Team History</p>
                <h2>팀 경기 히스토리</h2>
              </div>
              <Badge tone="green">전체 {historyCount}경기</Badge>
            </div>
            <div className="recent-match-list">
              {detailHistory.map((match) => {
                const sideName = getTeamSide(match, team.id);
                const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
                const outcome = getSideResult(match, sideName);
                return (
                  <RecentMatchRow
                    key={match.id}
                    record={match}
                    result={outcome}
                    side={match[sideName]}
                    opponent={match[oppositeSide]}
                    score={getSideScore(match, sideName)}
                    opponentScore={getSideScore(match, oppositeSide)}
                    teams={app.state.teams}
                    to={`/app/matches?match=${match.id}`}
                    onOpen={() => setSelectedHistoryMatchId(match.id)}
                  />
                );
              })}
              {teamRecordArchive.page?.detailExhausted === false ? (
                <button
                  type="button"
                  className="button button-secondary button-md"
                  disabled={teamRecordArchive.loading}
                  onClick={() => loadTeamRecords?.(team.id, {
                    loadMoreDetail: true,
                    detailOffset: teamRecordArchive.page?.detailNextOffset,
                  })}
                >
                  {teamRecordArchive.loading ? "불러오는 중" : "상세 기록 더 보기"}
                </button>
              ) : null}
              {archivedHistory.filter((record) => !historyIds.has(record.matchId)).map((record) => {
                return (
                  <RecentMatchRow
                    key={record.matchId}
                    record={record}
                    result={record.result}
                    side={{ name: record.teamName, teamId: team.id }}
                    opponent={{ name: record.opponentTeamName }}
                    score={record.score}
                    opponentScore={record.opponentScore}
                    teams={app.state.teams}
                    className="record-archive-row"
                  />
                );
              })}
            </div>
            {teamRecordArchive.page?.archiveExhausted === false ? (
              <button
                type="button"
                className="button button-secondary button-md"
                disabled={teamRecordArchive.loading}
                onClick={() => loadTeamRecords?.(team.id, {
                  loadMoreArchive: true,
                  archiveOffset: teamRecordArchive.page?.archiveNextOffset,
                })}
              >
                {teamRecordArchive.loading ? "불러오는 중" : "기록 더 보기"}
              </button>
            ) : null}
            {teamRecordArchive.error ? (
              <button
                type="button"
                className="button button-secondary button-md"
                onClick={() => loadTeamRecords?.(team.id, { force: true })}
              >
                기록 다시 불러오기
              </button>
            ) : null}
          </Card>
        </div>

        <aside className="page-stack">
          <Card className="section-card">
            <div className="contract-grid single">
              <div>
                <span>팀장</span>
                <strong>{userMap[captain?.userId]?.name ?? "미지정"}</strong>
              </div>
              <div>
                <span>팀원</span>
                <strong>{regularMembers.length}명</strong>
              </div>
              <div>
                <span>용병</span>
                <strong>{reserveMembers.length}명</strong>
              </div>
            </div>
          </Card>
          <Card id="team-control" className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Member Control</p>
                <h2>팀원 관리</h2>
              </div>
              <Badge tone={teamFull ? "orange" : "green"}>{team.members.length}/{MAX_TEAM_MEMBERS}명</Badge>
            </div>
            {canManage ? (
              <>
                <form className="member-add-form" onSubmit={inviteMember}>
                  <label>
                    초대할 선수
                    <SearchPicker
                      value={memberQuery}
                      onChange={(value) => {
                        setTeamInviteError("");
                        setMemberQuery(value);
                        setMemberDraft((current) => ({ ...current, userId: "" }));
                        setSelectedInviteProfile(null);
                      }}
                      placeholder="선수 이름, #해시태그, 지역 검색"
                      items={availableUsers}
                      remoteSearchType="profile"
                      idleItems={availableUsers.slice(0, 10)}
                      idleTitle="초대 가능한 선수"
                      title="선수 검색 결과"
                      emptyText="초대 가능한 선수 없음"
                      showIdleOnFocus
                      floating
                      closeOnResultClick
                      renderItem={renderInviteSearchItem}
                    />
                  </label>
                  <label>
                    초대 역할
                    <select value={memberDraft.role} onChange={(event) => setMemberDraft((current) => ({ ...current, role: event.target.value }))}>
                      {inviteRoleOptions.map(([role, label]) => <option key={role} value={role}>{label}</option>)}
                    </select>
                  </label>
                  {selectedInviteUser ? (
                    <PlayerHoverCard user={selectedInviteUser} teams={app.state.teams} className="form-chip member-invite-selection">
                      <span>선택: <strong>{selectedInviteUser.name}</strong></span>
                      <small>{getUserHashtag(selectedInviteUser)} · {selectedCount}/{MAX_TEAM_MEMBERSHIPS}팀</small>
                    </PlayerHoverCard>
                  ) : null}
                  <Button type="submit" disabled={!canAddMember || teamControlPending}>{teamInvitePending ? "발송 중" : "초대 발송"}</Button>
                  {teamInviteError ? <span className="form-warning">{teamInviteError}</span> : null}
                  {teamFull ? <span className="form-warning">팀원은 최대 {MAX_TEAM_MEMBERS}명까지 등록할 수 있습니다.</span> : null}
                  {!teamFull && selectedInviteUser && !canAddMember ? <span className="form-warning">선수 팀 한도 {MAX_TEAM_MEMBERSHIPS}/{MAX_TEAM_MEMBERSHIPS}</span> : null}
                </form>
                {pendingTeamInvitations.length ? (
                  <div className="member-control-list">
                    {pendingTeamInvitations.map((invitation) => {
                      const user = userMap[invitation.targetUserId];
                      return (
                        <div key={invitation.id} className="member-control-row">
                          <PlayerHoverCard className="member-control-identity" user={user} teams={app.state.teams}>
                            <span className="member-control-copy">
                              <strong>{user?.name ?? "초대 대상"}</strong>
                              <small>
                                {user ? <span>{getUserHashtag(user)}</span> : null}
                                <span>{getTeamRoleLabel(invitation.role)}</span>
                              </small>
                            </span>
                          </PlayerHoverCard>
                          <span className="member-control-state">초대 대기</span>
                          <Button type="button" size="sm" variant="secondary" className="danger-button" disabled={teamControlPending} onClick={() => { void cancelPendingTeamInvitation(invitation.id); }}>취소</Button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div className="member-control-list">
                  {team.members.map((member) => {
                    const user = userMap[member.userId];
                    if (!user) return null;
                    const isCaptainMember = member.userId === captain?.userId;
                    const roleOptions = getManagedRoleOptions(member, captain?.userId);
                    return (
                      <div key={`${team.id}-${member.userId}-control`} className="member-control-row">
                        <PlayerHoverCard className="ui-profile-identity-inline" user={user} teams={app.state.teams}>
                          <ProfileEmblem user={user} className="small" />
                          <strong>{user.name}</strong>
                        </PlayerHoverCard>
                        <select value={normalizeTeamRole(member.role)} disabled={isCaptainMember || teamControlPending} onChange={(event) => { void changeTeamMemberRole(member.userId, event.target.value); }}>
                          {roleOptions.map(([role, label]) => <option key={role} value={role}>{label}</option>)}
                        </select>
                        <button type="button" disabled={isCaptainMember || team.members.length <= 1 || teamControlPending} onClick={() => { void excludeTeamMember(member.userId); }}>제외</button>
                      </div>
                    );
                  })}
                </div>
                {teamManagementError ? <span className="form-warning">{teamManagementError}</span> : null}
                <div className="team-danger-zone">
                  <div>
                    <strong>팀 삭제</strong>
                    <span>팀 프로필과 로스터를 삭제합니다. 기존 경기 기록은 유지됩니다.</span>
                  </div>
                  <Button type="button" variant="secondary" className="danger-button" disabled={teamControlPending} onClick={deleteTeam}>
                    <Trash2 size={16} />
                    {deleteArmed ? "한 번 더 눌러 삭제" : "팀 삭제"}
                  </Button>
                </div>
              </>
            ) : (
              <span className="form-chip">팀장 전용</span>
            )}
          </Card>
          <div id="team-roster" className="page-stack">
            {renderMembers("팀원", regularMembers)}
          </div>
          {renderMembers("용병 기록", reserveMembers)}
          {canManage ? (
            <Card className="section-card team-emblem-management-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Team Emblem</p>
                  <h2>팀 엠블럼 관리</h2>
                </div>
              </div>
              {emblemStatusError ? (
                <div className="settings-save-row">
                  <small role="status" className="form-warning">{emblemStatusError}</small>
                  <Button type="button" size="sm" variant="secondary" onClick={retryTeamEmblemStatus}>다시 시도</Button>
                </div>
              ) : null}
              <div className="team-emblem-editor">
                <TeamEmblem team={{ ...team, ...emblemStyleDraft }} size="lg" />
                <span>
                  <strong>팀 엠블럼</strong>
                  <small>{emblemUploadLocked ? `${formatEmblemDate(nextEmblemUploadAt)}부터 사진을 변경할 수 있습니다.` : "사진은 위치와 확대·축소를 조정한 뒤 저장합니다."}</small>
                  {emblemFeedback ? <em>{emblemFeedback}</em> : null}
                </span>
              </div>
              <div className="emblem-source-grid two-options">
                <button type="button" className={emblemSource === "initial" ? "active" : ""} aria-pressed={emblemSource === "initial"} disabled={emblemPending} onClick={() => selectEmblemSource("initial")}>
                  <strong>기본값</strong>
                </button>
                <button type="button" className={emblemSource === "upload" ? "active" : ""} aria-pressed={emblemSource === "upload"} disabled={emblemPending || (!team.emblemKey && emblemUploadLocked)} onClick={() => selectEmblemSource("upload")}>
                  <strong>사진 사용</strong>
                  {!team.emblemKey ? <span>사진 선택 필요</span> : null}
                </button>
              </div>
              <input
                ref={emblemInputRef}
                hidden
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
                disabled={emblemPending || emblemUploadLocked}
                onChange={uploadEmblem}
              />
              {emblemSource === "initial" ? (
                <div className="team-emblem-design-controls">
                  <div className="team-emblem-text-controls">
                    <label>
                      글자 기준
                      <select value={emblemStyleDraft.emblemTextMode} onChange={(event) => setEmblemStyleDraft((current) => ({ ...current, emblemTextMode: event.target.value }))}>
                        <option value="initial">기본값</option>
                        <option value="name">팀 이름</option>
                        <option value="abbreviation">약칭</option>
                      </select>
                    </label>
                    <label>
                      약칭
                      <textarea
                        rows={2}
                        value={emblemStyleDraft.emblemAbbreviation}
                        disabled={emblemStyleDraft.emblemTextMode !== "abbreviation"}
                        placeholder={"예: RB\nBC"}
                        onChange={(event) => {
                          if (!isTeamEmblemAbbreviationDraftWithinLimits(event.target.value)) return;
                          setEmblemStyleDraft((current) => ({ ...current, emblemAbbreviation: event.target.value }));
                        }}
                      />
                      <small>공백 제외 {emblemAbbreviationCharacterCount}/{TEAM_EMBLEM_ABBREVIATION_MAX_CHARACTERS}자 · Enter로 줄바꿈</small>
                    </label>
                  </div>
                  <div className="team-emblem-font-grid" role="group" aria-label="엠블럼 글꼴">
                    {TEAM_EMBLEM_FONT_OPTIONS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`team-emblem-font-${value} ${emblemStyleDraft.emblemFont === value ? "active" : ""}`}
                        aria-pressed={emblemStyleDraft.emblemFont === value}
                        onClick={() => setEmblemStyleDraft((current) => ({ ...current, emblemFont: value }))}
                      >
                        <span>Aa가</span>
                        <small>{label}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className={`emblem-style-controls team-emblem-style-controls ${emblemSource === "initial" ? "has-emblem-color" : "is-upload"}`}>
                {emblemSource === "initial" ? (
                  <label>
                    엠블럼 색
                    <input type="color" value={emblemStyleDraft.emblemColor} onChange={(event) => setEmblemStyleDraft((current) => ({ ...current, emblemColor: event.target.value }))} />
                  </label>
                ) : null}
                <label className="emblem-border-toggle">
                  <input type="checkbox" checked={emblemStyleDraft.emblemBorderEnabled} onChange={(event) => setEmblemStyleDraft((current) => ({ ...current, emblemBorderEnabled: event.target.checked }))} />
                  테두리 사용
                </label>
                <label>
                  테두리 색
                  <input type="color" value={emblemStyleDraft.emblemBorderColor} disabled={!emblemStyleDraft.emblemBorderEnabled} onChange={(event) => setEmblemStyleDraft((current) => ({ ...current, emblemBorderColor: event.target.value }))} />
                </label>
                <Button type="button" size="sm" variant="secondary" disabled={emblemPending} onClick={saveEmblemStyle}>저장</Button>
              </div>
              <p className="emblem-policy-note">{moderationLocked ? "운영 조치로 사진 업로드가 제한되었습니다." : getEmblemUploadWarning()}</p>
              <div className="settings-save-row team-emblem-editor-actions">
                <small>{emblemFeedback || "저장된 사진은 기본값으로 바꿔도 삭제되지 않습니다."}</small>
                {emblemCanRestore ? (
                  <Button type="button" size="sm" variant="secondary" disabled={emblemPending || moderationLocked} onClick={restorePreviousEmblem}>
                    <RotateCcw size={16} /> 이전 사진
                  </Button>
                ) : null}
                <Button type="button" size="sm" disabled={emblemPending || emblemUploadLocked} onClick={() => emblemInputRef.current?.click()}>
                  <ImageUp size={16} /> {team.emblemKey ? "사진 변경" : "사진 선택"}
                </Button>
              </div>
            </Card>
          ) : null}
        </aside>
      </div>
      {selectedHistoryMatchId ? (
        <MatchRoomModal
          app={app}
          matchId={selectedHistoryMatchId}
          onClose={() => setSelectedHistoryMatchId("")}
          entryPoint="team-history"
        />
      ) : null}
      <EmblemCropEditor
        file={emblemFile}
        pending={emblemPending}
        warning={getEmblemUploadWarning()}
        error={emblemFeedback}
        onCancel={() => setEmblemFile(null)}
        onConfirm={confirmEmblemUpload}
      />
    </div>
  );
}
