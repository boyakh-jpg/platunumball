import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ImageUp, RotateCcw, Star, Trash2 } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import EmblemCropEditor from "../components/common/EmblemCropEditor.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import MatchRecordMeta from "../components/match/MatchRecordMeta.jsx";
import MemberTypeBadge from "../components/team/MemberTypeBadge.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import TierEmblem from "../components/rating/TierEmblem.jsx";
import { MAX_TEAM_MEMBERS, MAX_TEAM_MEMBERSHIPS, TEAM_INVITE_ROLES, getTeamRoleLabel, isMercenaryTeamRole, normalizeTeamRole } from "../lib/constants.js";
import { getMatchSideScore as getSideScore, isMatchWithinRecordDetailWindow } from "../lib/matchUtils.js";
import {
  TEAM_EMBLEM_ABBREVIATION_MAX_CHARACTERS,
  TEAM_EMBLEM_FONT_OPTIONS,
  getTeamEmblemAbbreviationCharacterCount,
  getTeamEmblemErrorMessage,
  isTeamEmblemAbbreviation,
  isTeamEmblemAbbreviationDraftWithinLimits,
  normalizeTeamEmblemAbbreviation,
} from "../lib/teamEmblem.js";
import { formatEmblemDate, getEmblemUploadWarning, getNextEmblemUploadAt, isEmblemUploadLocked } from "../lib/emblemPolicy.js";
import { MatchRoomModal } from "./Matches.jsx";

function getTeamSide(match, teamId) {
  if (match.teamA?.teamId === teamId) return "teamA";
  if (match.teamB?.teamId === teamId) return "teamB";
  return null;
}

function isHistoryInDetailWindow(match) {
  return isMatchWithinRecordDetailWindow(match);
}

function getTeamOutcome(match, teamId) {
  const sideName = getTeamSide(match, teamId);
  if (!sideName) return null;
  const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
  const score = getSideScore(match, sideName);
  const opponentScore = getSideScore(match, oppositeSide);
  if (score === opponentScore) return "draw";
  return score > opponentScore ? "win" : "loss";
}

function getScoreOutcome(score, opponentScore) {
  const normalizedScore = Number(score ?? 0);
  const normalizedOpponentScore = Number(opponentScore ?? 0);
  if (normalizedScore === normalizedOpponentScore) return "draw";
  return normalizedScore > normalizedOpponentScore ? "win" : "loss";
}

const outcomeLabel = {
  win: "승",
  loss: "패",
  draw: "무",
};
const managedTeamRoleOptions = TEAM_INVITE_ROLES.map((role) => [role, getTeamRoleLabel(role)]);
const inviteRoleOptions = managedTeamRoleOptions;

function getManagedRoleOptions(member, captainId) {
  if (member.userId === captainId) return [["captain", getTeamRoleLabel("captain")]];
  return managedTeamRoleOptions;
}

export default function TeamDetail({ app }) {
  const { teamId } = useParams();
  const loadDirectory = app.actions.loadDirectory;
  const loadTeamRecords = app.actions.loadTeamRecords;
  const loadTeamEmblemStatus = app.actions.loadTeamEmblemStatus;
  const team = app.state.teams.find((item) => item.id === teamId);
  const teamRecordArchive = app.recordArchives?.teams?.[teamId] ?? { rows: [], page: {}, loaded: false, loading: false, error: "" };
  const [memberDraft, setMemberDraft] = useState({ userId: app.state.users[0]?.id, role: "regular" });
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedInviteProfile, setSelectedInviteProfile] = useState(null);
  const [selectedHistoryMatchId, setSelectedHistoryMatchId] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [emblemPending, setEmblemPending] = useState(false);
  const [emblemCanRestore, setEmblemCanRestore] = useState(false);
  const [emblemFeedback, setEmblemFeedback] = useState("");
  const [emblemFile, setEmblemFile] = useState(null);
  const [emblemStyleDraft, setEmblemStyleDraft] = useState(() => ({
    emblemColor: team?.emblemColor ?? team?.accent ?? "#f05a46",
    emblemBorderEnabled: team?.emblemBorderEnabled !== false,
    emblemBorderColor: team?.emblemBorderColor ?? team?.accent ?? "#f05a46",
    emblemTextMode: new Set(["name", "abbreviation"]).has(team?.emblemTextMode) ? team.emblemTextMode : "initial",
    emblemAbbreviation: team?.emblemAbbreviation ?? "",
    emblemFont: team?.emblemFont ?? "sport",
  }));
  const emblemInputRef = useRef(null);
  const emblemStatusRequestRef = useRef("");
  const emblemAbbreviationCharacterCount = getTeamEmblemAbbreviationCharacterCount(emblemStyleDraft.emblemAbbreviation);
  const captain = team?.members.find((member) => member.role === "captain");
  const canManage = captain?.userId === app.currentUser.id;

  useEffect(() => {
    if (!team) return;
    setEmblemStyleDraft({
      emblemColor: team.emblemColor ?? team.accent ?? "#f05a46",
      emblemBorderEnabled: team.emblemBorderEnabled !== false,
      emblemBorderColor: team.emblemBorderColor ?? team.accent ?? "#f05a46",
      emblemTextMode: new Set(["name", "abbreviation"]).has(team.emblemTextMode) ? team.emblemTextMode : "initial",
      emblemAbbreviation: team.emblemAbbreviation ?? "",
      emblemFont: team.emblemFont ?? "sport",
    });
  }, [team?.accent, team?.emblemAbbreviation, team?.emblemBorderColor, team?.emblemBorderEnabled, team?.emblemColor, team?.emblemFont, team?.emblemTextMode, team?.id]);

  useEffect(() => {
    if (!team?.id || !canManage || app.remoteReady === false || emblemStatusRequestRef.current === team.id) return;
    let cancelled = false;
    emblemStatusRequestRef.current = team.id;
    setEmblemCanRestore(false);
    Promise.resolve(loadTeamEmblemStatus?.(team.id)).then((result) => {
      if (!cancelled && result?.ok !== false && result?.teamId === team.id) setEmblemCanRestore(result.emblemCanRestore === true);
    });
    return () => { cancelled = true; };
  }, [app.remoteReady, canManage, loadTeamEmblemStatus, team?.id]);

  useEffect(() => {
    if (app.remoteReady === false || !teamId) return undefined;
    const refreshTeam = () => loadDirectory?.({ force: true });
    if (team?.membersPartial === true) refreshTeam();
    window.addEventListener("focus", refreshTeam);
    const handleVisibilityChange = () => {
      if (!document.hidden) refreshTeam();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshTeam);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [app.remoteReady, loadDirectory, team?.membersPartial, teamId]);

  useEffect(() => {
    if (app.remoteReady === false || !team?.id || !loadTeamRecords || teamRecordArchive.loaded || teamRecordArchive.loading || teamRecordArchive.error) return;
    loadTeamRecords(team.id);
  }, [app.remoteReady, loadTeamRecords, team?.id, teamRecordArchive.error, teamRecordArchive.loaded, teamRecordArchive.loading]);

  const directoryPending = app.remoteReady === false
    || app.directoryStatus?.loading
    || (app.directoryStatus?.loaded === false && !app.directoryStatus?.error);
  if (!team && directoryPending) return <BasketballLoader overlay label="팀 불러오는 중" />;
  if (!team) return <Navigate to="/app/teams" replace />;

  const userMap = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const membershipCounts = new Map();
  app.state.teams.forEach((item) => {
    item.members.forEach((member) => membershipCounts.set(member.userId, (membershipCounts.get(member.userId) ?? 0) + 1));
  });
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const isFavoriteTeam = favoriteTeamIds.includes(team.id);
  const regularMembers = team.members.filter((member) => !isMercenaryTeamRole(member.role));
  const reserveMembers = team.members.filter((member) => isMercenaryTeamRole(member.role));
  const pendingTeamInvitations = (app.state.teamInvitations ?? []).filter((invitation) => invitation.teamId === team.id && invitation.status === "pending");
  const pendingTargetIds = new Set(pendingTeamInvitations.map((invitation) => invitation.targetUserId));
  const availableUsers = app.state.users.filter((user) => (
    !team.members.some((member) => member.userId === user.id) &&
    !pendingTargetIds.has(user.id)
  ));
  const firstAddableUser = availableUsers.find((user) => (membershipCounts.get(user.id) ?? 0) < MAX_TEAM_MEMBERSHIPS);
  const selectedRemoteUser = selectedInviteProfile?.id === memberDraft.userId &&
    !team.members.some((member) => member.userId === selectedInviteProfile.id) &&
    !pendingTargetIds.has(selectedInviteProfile.id)
    ? selectedInviteProfile
    : null;
  const addUserId = selectedRemoteUser?.id ?? (availableUsers.some((user) => user.id === memberDraft.userId) ? memberDraft.userId : firstAddableUser?.id ?? availableUsers[0]?.id ?? "");
  const selectedInviteUser = selectedRemoteUser ?? availableUsers.find((user) => user.id === addUserId) ?? null;
  const selectedCount = membershipCounts.get(addUserId) ?? 0;
  const teamFull = team.members.length >= MAX_TEAM_MEMBERS;
  const canAddMember = canManage && Boolean(addUserId) && selectedCount < MAX_TEAM_MEMBERSHIPS && !teamFull;
  const history = app.state.matches.filter((match) => match.status === "confirmed" && getTeamSide(match, team.id));
  const detailHistory = history.filter(isHistoryInDetailWindow);
  const archivedHistory = teamRecordArchive.rows ?? [];
  const historyIds = new Set(history.map((match) => match.id));
  const historyCount = history.length + archivedHistory.filter((record) => !historyIds.has(record.matchId)).length;
  const loadedWins = history.filter((match) => {
    const sideName = getTeamSide(match, team.id);
    const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
    return match.status === "confirmed" && getSideScore(match, sideName) > getSideScore(match, oppositeSide);
  }).length;
  const loadedLosses = history.filter((match) => {
    const sideName = getTeamSide(match, team.id);
    const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
    return match.status === "confirmed" && getSideScore(match, sideName) < getSideScore(match, oppositeSide);
  }).length;
  const wins = Number(team.wins ?? loadedWins);
  const losses = Number(team.losses ?? loadedLosses);
  const confirmedCount = wins + losses;
  const winRate = confirmedCount ? Math.round((wins / confirmedCount) * 100) : 0;

  const renderMembers = (title, members) => (
    <Card className="section-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Roster</p>
          <h2>{title}</h2>
        </div>
        <Badge tone="blue">{members.length}명</Badge>
      </div>
      <div className="member-list">
        {members.map((member) => {
          const user = userMap[member.userId];
          if (!user) return null;
          return (
            <PlayerHoverCard className="member-row" key={`${team.id}-${member.userId}-${member.role}`} user={user} teams={app.state.teams}>
              <ProfileEmblem user={user} className="small" />
              <div className="member-main">
                <strong>{user.name}</strong>
                <span>{user.position} · {user.region}</span>
              </div>
              <TierBadge mmr={user.ratings.integrated} ratings={user.ratings} compact />
              <MemberTypeBadge role={member.role} />
            </PlayerHoverCard>
          );
        })}
      </div>
    </Card>
  );

  const inviteMember = (event) => {
    event.preventDefault();
    if (!canAddMember) return;
    app.actions.inviteTeamMember(team.id, addUserId, memberDraft.role);
    const nextUser = availableUsers.find((user) => user.id !== addUserId);
    setMemberDraft({ userId: nextUser?.id ?? app.state.users[0]?.id, role: "regular" });
    setMemberQuery("");
    setSelectedInviteProfile(null);
  };
  const renderInviteSearchItem = (user) => {
    const count = membershipCounts.get(user.id) ?? 0;
    const blocked = teamFull || team.members.some((member) => member.userId === user.id) || pendingTargetIds.has(user.id) || count >= MAX_TEAM_MEMBERSHIPS;
    return (
      <button
        key={user.id}
        type="button"
        className={user.id === addUserId ? "search-picker-result-row selected" : "search-picker-result-row"}
        disabled={blocked}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setMemberDraft((current) => ({ ...current, userId: user.id }));
          setMemberQuery(user.name ?? "");
          setSelectedInviteProfile(user);
        }}
      >
        <span>
          <strong>{user.name}</strong>
        </span>
        <span>{user.region} · {user.position} · {count}/{MAX_TEAM_MEMBERSHIPS}팀</span>
        <em>{blocked ? "초대 불가" : "초대 대상"}</em>
      </button>
    );
  };
  const deleteTeam = () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    app.actions.deleteTeam(team.id);
  };
  const uploadEmblem = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || emblemPending || isEmblemUploadLocked(team.emblemUploadCount, team.emblemUploadedAt)) return;
    setEmblemFile(file);
    setEmblemFeedback("");
  };
  const confirmEmblemUpload = async (crop) => {
    const file = emblemFile;
    if (!file || emblemPending) return;
    setEmblemPending(true);
    setEmblemFeedback("");
    try {
      const result = await app.actions.uploadTeamEmblem(team.id, file, crop);
      if (!result || result.ok === false) {
        const nextAt = result?.details?.nextAllowedAt;
        setEmblemFeedback(nextAt ? `${getTeamEmblemErrorMessage(result?.error)} ${formatEmblemDate(nextAt)}` : getTeamEmblemErrorMessage(result?.error));
        return;
      }
      setEmblemFeedback(result.storageCleanupPending
        ? "엠블럼을 저장했습니다. 가장 오래된 파일 정리는 재시도가 필요합니다."
        : "엠블럼을 저장했습니다.");
      setEmblemCanRestore(result.emblemCanRestore === true);
      setEmblemFile(null);
    } catch (error) {
      setEmblemFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      setEmblemPending(false);
    }
  };
  const restorePreviousEmblem = async () => {
    if (emblemPending || !emblemCanRestore) return;
    setEmblemPending(true);
    setEmblemFeedback("");
    try {
      const result = await app.actions.restoreTeamEmblem(team.id);
      const nextAt = result?.details?.nextAllowedAt;
      if (result?.ok !== false) setEmblemCanRestore(result.emblemCanRestore === true);
      setEmblemFeedback(result?.ok === false
        ? `${getTeamEmblemErrorMessage(result.error)}${nextAt ? ` ${formatEmblemDate(nextAt)}` : ""}`
        : "직전 사진으로 되돌렸습니다.");
    } catch (error) {
      setEmblemFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      setEmblemPending(false);
    }
  };
  const selectEmblemSource = async (emblemSource) => {
    const currentSource = team.emblemSource ?? (team.emblemKey ? "upload" : "initial");
    if (emblemPending || emblemSource === currentSource) return;
    if (emblemSource === "upload" && !team.emblemKey) {
      if (!isEmblemUploadLocked(team.emblemUploadCount, team.emblemUploadedAt)) emblemInputRef.current?.click();
      return;
    }
    setEmblemPending(true);
    setEmblemFeedback("");
    try {
      const result = await app.actions.setTeamEmblemSource(team.id, emblemSource);
      setEmblemFeedback(result?.ok === false ? getTeamEmblemErrorMessage(result.error) : "엠블럼 표시 방식을 저장했습니다.");
    } catch (error) {
      setEmblemFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      setEmblemPending(false);
    }
  };
  const saveEmblemStyle = async () => {
    if (emblemPending) return;
    const emblemAbbreviation = normalizeTeamEmblemAbbreviation(emblemStyleDraft.emblemAbbreviation);
    if (emblemAbbreviation && !isTeamEmblemAbbreviation(emblemAbbreviation)) {
      setEmblemFeedback("약칭은 공백을 제외한 1~4자로 입력해 주세요.");
      return;
    }
    if (emblemStyleDraft.emblemTextMode === "abbreviation" && !isTeamEmblemAbbreviation(emblemAbbreviation)) {
      setEmblemFeedback("공백만 있는 약칭은 저장할 수 없습니다. 1~4자로 입력해 주세요.");
      return;
    }
    setEmblemPending(true);
    setEmblemFeedback("");
    try {
      const result = await app.actions.updateTeamEmblemStyle(team.id, { ...emblemStyleDraft, emblemAbbreviation });
      if (result?.ok !== false) setEmblemStyleDraft((current) => ({ ...current, emblemAbbreviation }));
      setEmblemFeedback(result?.ok === false ? getTeamEmblemErrorMessage(result.error) : "엠블럼 디자인을 저장했습니다.");
    } catch (error) {
      setEmblemFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      setEmblemPending(false);
    }
  };

  const cooldownNextAt = getNextEmblemUploadAt(team.emblemUploadCount, team.emblemUploadedAt);
  const moderationBlockedAt = team.emblemUploadBlockedUntil ? new Date(team.emblemUploadBlockedUntil) : null;
  const moderationLocked = Boolean(moderationBlockedAt && Number.isFinite(moderationBlockedAt.getTime()) && moderationBlockedAt.getTime() > Date.now());
  const nextEmblemUploadAt = moderationLocked && (!cooldownNextAt || moderationBlockedAt > cooldownNextAt) ? moderationBlockedAt : cooldownNextAt;
  const emblemUploadLocked = moderationLocked || isEmblemUploadLocked(team.emblemUploadCount, team.emblemUploadedAt);
  const emblemSource = team.emblemSource ?? (team.emblemKey ? "upload" : "initial");

  return (
    <div className="page-stack team-detail-page rank-team-page">
      <section className="team-detail-hero rank-profile-hero rank-team-hero" style={{ "--team-color": team.accent }}>
        <div>
          <div className="team-detail-heading-row">
            <p className="eyebrow">Team Profile</p>
            <Button
              type="button"
              variant={isFavoriteTeam ? "primary" : "secondary"}
              className={isFavoriteTeam ? "favorite-toggle-button ui-liquid-glass active" : "favorite-toggle-button ui-liquid-glass"}
              onClick={() => app.actions.toggleFavoriteTeam(team.id)}
            >
              <Star size={16} fill={isFavoriteTeam ? "currentColor" : "none"} />
              {isFavoriteTeam ? "즐겨찾기됨" : "즐겨찾기"}
            </Button>
          </div>
          <h1>{team.name}</h1>
          <p>{team.region} · {team.homeCourt}</p>
          <div className="badge-row">
            <Badge tone="green" className="ui-liquid-glass">{team.mmr} 팀 MMR</Badge>
            <Badge tone="gold" className="ui-liquid-glass">팀장 {userMap[captain?.userId]?.name ?? "미지정"}</Badge>
          </div>
        </div>
        <div className="team-tier-hero">
          <TierEmblem mmr={team.mmr} size="hero" showLabel />
        </div>
      </section>

      <nav className="rank-profile-tabs">
        <a href="#team-history">전적</a>
        <a href="#team-roster">로스터</a>
        <a href="#team-control">관리</a>
      </nav>

      <section className="rank-profile-summary">
        <Card className="section-card rank-record-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Team Ranked</p>
              <h2>팀 전적</h2>
            </div>
            <div className="badge-row">
              <Badge tone="gold">{team.mmr} MMR</Badge>
              <TierBadge mmr={team.mmr} compact />
            </div>
          </div>
          <div className="rank-stat-grid">
            <span><strong>{wins}승</strong>승리</span>
            <span><strong>{losses}패</strong>패배</span>
            <span><strong>{winRate}%</strong>승률</span>
            <span><strong>{historyCount}</strong>전체 경기</span>
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
              <Badge tone="green">{historyCount}경기 · {wins}승</Badge>
            </div>
            <div className="history-list">
              {detailHistory.map((match) => {
                const sideName = getTeamSide(match, team.id);
                const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
                const side = match[sideName];
                const outcome = getTeamOutcome(match, team.id);
                return (
                  <article key={match.id} className={`history-item rank-match-item rank-match-${outcome}`}>
                    <div>
                      <Link
                        to={`/app/matches?match=${match.id}`}
                        onClick={(event) => {
                          event.preventDefault();
                          setSelectedHistoryMatchId(match.id);
                        }}
                      >
                        <strong>{match.title}</strong>
                      </Link>
                      <MatchRecordMeta record={match} />
                    </div>
                    <div className="history-score">
                      <Badge tone={outcome === "win" ? "green" : outcome === "loss" ? "orange" : "gold"}>{outcomeLabel[outcome]}</Badge>
                      <strong>{getSideScore(match, sideName)}:{getSideScore(match, oppositeSide)}</strong>
                    </div>
                    <div className="roster compact-roster">
                      {(side?.players ?? []).map((id) => {
                        const user = userMap[id];
                        return user ? <PlayerHoverCard key={id} user={user} teams={app.state.teams}><i style={{ "--avatar": user.avatarColor }} />{user.name}</PlayerHoverCard> : null;
                      })}
                    </div>
                  </article>
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
              {archivedHistory.map((record) => {
                const outcome = getScoreOutcome(record.score, record.opponentScore);
                return (
                  <article key={record.matchId} className={`history-item record-archive-row rank-match-item rank-match-${outcome}`}>
                    <div>
                      <strong>{record.title}</strong>
                      <MatchRecordMeta record={record} />
                    </div>
                    <div className="history-score">
                      <Badge tone={outcome === "win" ? "green" : outcome === "loss" ? "orange" : "gold"}>{outcomeLabel[outcome]}</Badge>
                      <strong>{record.score}:{record.opponentScore}</strong>
                    </div>
                  </article>
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
                  {selectedInviteUser ? <span className="form-chip">선택: {selectedInviteUser.name} · {selectedCount}/{MAX_TEAM_MEMBERSHIPS}팀</span> : null}
                  <Button type="submit" disabled={!canAddMember}>초대 발송</Button>
                  {teamFull ? <span className="form-warning">팀원은 최대 {MAX_TEAM_MEMBERS}명까지 등록할 수 있습니다.</span> : null}
                  {!teamFull && !canAddMember ? <span className="form-warning">선수 팀 한도 {MAX_TEAM_MEMBERSHIPS}/{MAX_TEAM_MEMBERSHIPS}</span> : null}
                </form>
                {pendingTeamInvitations.length ? (
                  <div className="member-control-list">
                    {pendingTeamInvitations.map((invitation) => {
                      const user = userMap[invitation.targetUserId];
                      return (
                        <div key={invitation.id} className="member-control-row">
                          <span>
                            <strong>{user?.name ?? "초대 대상"}</strong>
                            <small>초대 대기 · {getTeamRoleLabel(invitation.role)}</small>
                          </span>
                          <Badge tone="orange">pending</Badge>
                          <button type="button" onClick={() => app.actions.cancelTeamInvitation(invitation.id)}>취소</button>
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
                        <select value={normalizeTeamRole(member.role)} disabled={isCaptainMember} onChange={(event) => app.actions.updateTeamMemberRole(team.id, member.userId, event.target.value)}>
                          {roleOptions.map(([role, label]) => <option key={role} value={role}>{label}</option>)}
                        </select>
                        <button type="button" disabled={isCaptainMember || team.members.length <= 1} onClick={() => app.actions.removeTeamMember(team.id, member.userId)}>제외</button>
                      </div>
                    );
                  })}
                </div>
                <div className="team-danger-zone">
                  <div>
                    <strong>팀 삭제</strong>
                    <span>팀 프로필과 로스터를 삭제합니다. 기존 경기 기록은 유지됩니다.</span>
                  </div>
                  <Button type="button" variant="secondary" className="danger-button" onClick={deleteTeam}>
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

function myTeamCountLabel(canManage) {
  return canManage ? "관리" : "조회";
}
