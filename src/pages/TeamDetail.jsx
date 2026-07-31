import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Card from "../components/common/Card.jsx";
import MemberTypeBadge from "../components/team/MemberTypeBadge.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import {
  MAX_TEAM_MEMBERS,
  MAX_TEAM_MEMBERSHIPS,
  getTeamRoleLabel,
  isMercenaryTeamRole,
} from "../lib/constants.js";
import { getMatchSideScore as getSideScore, isMatchWithinRecordDetailWindow } from "../lib/matchUtils.js";
import {
  getTeamEmblemAbbreviationCharacterCount,
  getTeamEmblemErrorMessage,
  isTeamEmblemAbbreviation,
  normalizeTeamEmblemAbbreviation,
} from "../lib/teamEmblem.js";
import { formatEmblemDate, getNextEmblemUploadAt, isEmblemUploadLocked } from "../lib/emblemPolicy.js";
import { getUserHashtag } from "../lib/handles.js";
import { getTeamSide } from "../lib/season.js";
import TeamDetailView from "./TeamDetailView.jsx";

function isHistoryInDetailWindow(match) {
  return isMatchWithinRecordDetailWindow(match);
}

export default function TeamDetail({ app }) {
  const { teamId } = useParams();
  const location = useLocation();
  const loadDirectory = app.actions.loadDirectory;
  const loadTeamRecords = app.actions.loadTeamRecords;
  const loadTeamEmblemStatus = app.actions.loadTeamEmblemStatus;
  const previewTeam = location.state?.teamPreview?.id === teamId
    ? location.state.teamPreview
    : null;
  const authoritativeTeam = app.state.teams.find((item) => item.id === teamId);
  const team = authoritativeTeam ?? previewTeam;
  const teamRecordArchive = app.recordArchives?.teams?.[teamId] ?? { rows: [], page: {}, loaded: false, loading: false, error: "" };
  const [memberDraft, setMemberDraft] = useState({ userId: app.state.users[0]?.id, role: "regular" });
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedInviteProfile, setSelectedInviteProfile] = useState(null);
  const [teamInvitePending, setTeamInvitePending] = useState(false);
  const [teamInviteError, setTeamInviteError] = useState("");
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
  const detailRequestRef = useRef("");
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
    const refreshTeam = () => loadDirectory?.({ force: true, teamId });
    if (detailRequestRef.current !== teamId) {
      detailRequestRef.current = teamId;
      refreshTeam();
    }
    window.addEventListener("focus", refreshTeam);
    const handleVisibilityChange = () => {
      if (!document.hidden) refreshTeam();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshTeam);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [app.remoteReady, loadDirectory, teamId]);

  useEffect(() => {
    if (app.remoteReady === false || !team?.id || !loadTeamRecords || teamRecordArchive.loaded || teamRecordArchive.loading || teamRecordArchive.error) return;
    loadTeamRecords(team.id);
  }, [app.remoteReady, loadTeamRecords, team?.id, teamRecordArchive.error, teamRecordArchive.loaded, teamRecordArchive.loading]);

  const directoryPending = app.remoteReady === false
    || app.directoryStatus?.loading
    || (app.directoryStatus?.loaded === false && !app.directoryStatus?.error)
    || (!team && app.remoteReady !== false && Boolean(loadDirectory) && !app.directoryStatus?.error);
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
      <div className="member-list ui-design-borderless-list">
        {members.map((member) => {
          const user = userMap[member.userId];
          if (!user) return null;
          return (
            <PlayerHoverCard className="member-row" key={`${team.id}-${member.userId}-${member.role}`} user={user} teams={app.state.teams}>
              <ProfileEmblem user={user} className="small" />
              <div className="member-main">
                <span className="member-name-line ui-profile-identity-inline">
                  <strong>{user.name}</strong>
                  <MemberTypeBadge role={member.role} />
                </span>
                <span>{user.position} · {user.region}</span>
              </div>
              <TierBadge mmr={user.ratings.integrated} ratings={user.ratings} compact />
            </PlayerHoverCard>
          );
        })}
      </div>
    </Card>
  );

  const inviteMember = async (event) => {
    event.preventDefault();
    if (!canAddMember || teamInvitePending) return;
    setTeamInvitePending(true);
    setTeamInviteError("");
    try {
      const result = await app.actions.inviteTeamMember(team.id, addUserId, memberDraft.role);
      if (!result || result.ok === false) {
        setTeamInviteError("팀 초대를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      const nextUser = availableUsers.find((user) => user.id !== addUserId);
      setMemberDraft({ userId: nextUser?.id ?? app.state.users[0]?.id, role: "regular" });
      setMemberQuery("");
      setSelectedInviteProfile(null);
    } catch {
      setTeamInviteError("팀 초대를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setTeamInvitePending(false);
    }
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
          setTeamInviteError("");
          setMemberDraft((current) => ({ ...current, userId: user.id }));
          setMemberQuery(user.name ?? "");
          setSelectedInviteProfile(user);
        }}
      >
        <PlayerHoverCard as="span" user={user} teams={app.state.teams} className="search-picker-player-identity">
          <span>
            <strong>{user.name}</strong>
            <small>{getUserHashtag(user)}</small>
          </span>
        </PlayerHoverCard>
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

  return <TeamDetailView controller={{ addUserId, app, archivedHistory, availableUsers, canAddMember, canManage, captain, confirmEmblemUpload, confirmedCount, cooldownNextAt, deleteArmed, deleteTeam, detailHistory, directoryPending, emblemAbbreviationCharacterCount, emblemCanRestore, emblemFeedback, emblemFile, emblemInputRef, emblemPending, emblemSource, emblemStatusRequestRef, emblemStyleDraft, emblemUploadLocked, favoriteTeamIds, firstAddableUser, history, historyCount, historyIds, inviteMember, isFavoriteTeam, loadDirectory, loadTeamEmblemStatus, loadTeamRecords, loadedLosses, loadedWins, losses, memberDraft, memberQuery, membershipCounts, moderationBlockedAt, moderationLocked, nextEmblemUploadAt, pendingTargetIds, pendingTeamInvitations, regularMembers, renderInviteSearchItem, renderMembers, reserveMembers, restorePreviousEmblem, saveEmblemStyle, selectEmblemSource, selectedCount, selectedHistoryMatchId, selectedInviteProfile, selectedInviteUser, selectedRemoteUser, setDeleteArmed, setEmblemCanRestore, setEmblemFeedback, setEmblemFile, setEmblemPending, setEmblemStyleDraft, setMemberDraft, setMemberQuery, setSelectedHistoryMatchId, setSelectedInviteProfile, setTeamInviteError, team, teamFull, teamId, teamInviteError, teamInvitePending, teamRecordArchive, uploadEmblem, userMap, winRate, wins }} />;
}
