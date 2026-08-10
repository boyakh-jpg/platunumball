import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import MemberTypeBadge from "../components/team/MemberTypeBadge.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import {
  MAX_TEAM_MEMBERS,
  MAX_TEAM_MEMBERSHIPS,
  MAX_TEAM_DESCRIPTION_LENGTH,
  MAX_TEAM_DESCRIPTION_LINES,
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
import { getTeamScoreSummary, getTeamSide } from "../lib/season.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { getTeamJoinApplicationBlockReason } from "../lib/teamJoinApplication.js";
import { isCurrentScopedOperation } from "../lib/asyncState.js";
import TeamDetailView from "./TeamDetailView.jsx";

function isHistoryInDetailWindow(match) {
  return isMatchWithinRecordDetailWindow(match);
}

export default function TeamDetail({ app }) {
  const { teamId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const loadDirectory = app.actions.loadDirectory;
  const loadTeamRecords = app.actions.loadTeamRecords;
  const loadTeamEmblemStatus = app.actions.loadTeamEmblemStatus;
  const previewTeam = location.state?.teamPreview?.id === teamId
    ? location.state.teamPreview
    : null;
  const authoritativeTeam = app.state.teams.find((item) => item.id === teamId);
  const displayTeam = authoritativeTeam ?? previewTeam;
  const teamRecordArchive = app.recordArchives?.teams?.[teamId] ?? { rows: [], page: {}, loaded: false, loading: false, error: "" };
  const [memberDraft, setMemberDraft] = useState({ userId: "", role: "regular" });
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedInviteProfile, setSelectedInviteProfile] = useState(null);
  const [teamInvitePending, setTeamInvitePending] = useState(false);
  const teamInvitePendingRef = useRef(false);
  const [teamInviteError, setTeamInviteError] = useState("");
  const [favoritePending, setFavoritePending] = useState(false);
  const [favoriteError, setFavoriteError] = useState("");
  const [teamManagementPending, setTeamManagementPending] = useState(false);
  const [teamManagementError, setTeamManagementError] = useState("");
  const [joinApplicationOpen, setJoinApplicationOpen] = useState(false);
  const [reviewedJoinApplication, setReviewedJoinApplication] = useState(null);
  const [teamDescriptionDraft, setTeamDescriptionDraft] = useState(displayTeam?.description ?? "");
  const [teamDetailLoad, setTeamDetailLoad] = useState(() => ({
    teamId,
    loading: false,
    loaded: !isSupabaseConfigured,
    error: "",
  }));
  const [selectedHistoryMatchId, setSelectedHistoryMatchId] = useState("");
  const [emblemPending, setEmblemPending] = useState(false);
  const [emblemCanRestore, setEmblemCanRestore] = useState(false);
  const [emblemStatusError, setEmblemStatusError] = useState("");
  const [emblemStatusRetrySequence, setEmblemStatusRetrySequence] = useState(0);
  const [emblemFeedback, setEmblemFeedback] = useState("");
  const [emblemClock, setEmblemClock] = useState(0);
  const [emblemFile, setEmblemFile] = useState(null);
  const [emblemStyleDraft, setEmblemStyleDraft] = useState(() => ({
    emblemColor: displayTeam?.emblemColor ?? displayTeam?.accent ?? "#f05a46",
    emblemBorderEnabled: displayTeam?.emblemBorderEnabled !== false,
    emblemBorderColor: displayTeam?.emblemBorderColor ?? displayTeam?.accent ?? "#f05a46",
    emblemTextMode: new Set(["name", "abbreviation"]).has(displayTeam?.emblemTextMode) ? displayTeam.emblemTextMode : "initial",
    emblemAbbreviation: displayTeam?.emblemAbbreviation ?? "",
    emblemFont: displayTeam?.emblemFont ?? "sport",
  }));
  const emblemInputRef = useRef(null);
  const emblemPendingRef = useRef(null);
  const emblemOperationSequenceRef = useRef(0);
  const currentTeamIdRef = useRef(teamId);
  currentTeamIdRef.current = teamId;
  const emblemStatusRequestRef = useRef("");
  const detailRequestRef = useRef("");
  const teamManagementPendingRef = useRef(false);
  const favoritePendingRef = useRef(false);
  const teamDetailReady = !isSupabaseConfigured || (teamDetailLoad.teamId === teamId && teamDetailLoad.loaded);
  const teamDetailError = teamDetailLoad.teamId === teamId ? teamDetailLoad.error : "";
  const team = authoritativeTeam ?? (!teamDetailReady ? previewTeam : null);
  const emblemAbbreviationCharacterCount = getTeamEmblemAbbreviationCharacterCount(emblemStyleDraft.emblemAbbreviation);
  const captain = team?.members.find((member) => member.role === "captain");
  const authoritativeCaptain = authoritativeTeam?.members.find((member) => member.role === "captain");
  const canManage = teamDetailReady
    && authoritativeTeam?.membersPartial !== true
    && authoritativeCaptain?.userId === app.currentUser.id;

  useEffect(() => {
    emblemPendingRef.current = null;
    setEmblemPending(false);
    setEmblemCanRestore(false);
    setEmblemStatusError("");
    setEmblemFeedback("");
    setEmblemFile(null);
  }, [teamId]);

  useEffect(() => {
    const cooldownMs = getNextEmblemUploadAt(team?.emblemUploadCount, team?.emblemUploadedAt)?.getTime() ?? 0;
    const moderationMs = new Date(team?.emblemUploadBlockedUntil ?? "").getTime() || 0;
    const remaining = Math.max(cooldownMs, moderationMs) - Date.now();
    if (remaining <= 0) return undefined;
    const timer = window.setTimeout(() => setEmblemClock((value) => value + 1), Math.min(remaining + 50, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [emblemClock, team?.emblemUploadBlockedUntil, team?.emblemUploadCount, team?.emblemUploadedAt]);

  const refreshTeamDetail = useCallback(async () => {
    if (!teamId) return false;
    if (!isSupabaseConfigured) {
      setTeamDetailLoad({ teamId, loading: false, loaded: true, error: "" });
      return true;
    }
    if (app.remoteReady === false || !loadDirectory) return false;
    setTeamDetailLoad((current) => ({
      teamId,
      loading: true,
      loaded: current.teamId === teamId && current.loaded,
      error: "",
    }));
    const loaded = await loadDirectory({ force: true, teamId });
    if (detailRequestRef.current !== teamId) return false;
    setTeamDetailLoad((current) => ({
      teamId,
      loading: false,
      loaded: loaded === true || (current.teamId === teamId && current.loaded),
      error: loaded === true ? "" : "팀 정보를 불러오지 못했습니다.",
    }));
    return loaded === true;
  }, [app.remoteReady, loadDirectory, teamId]);

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
    setTeamDescriptionDraft(team?.description ?? "");
  }, [team?.description, team?.id]);

  useEffect(() => {
    if (!team?.id || !canManage || app.remoteReady === false || emblemStatusRequestRef.current === team.id) return;
    let cancelled = false;
    emblemStatusRequestRef.current = team.id;
    setEmblemCanRestore(false);
    setEmblemStatusError("");
    Promise.resolve(loadTeamEmblemStatus?.(team.id)).then((result) => {
      if (cancelled) return;
      if (!result || result.ok === false || result.teamId !== team.id) {
        emblemStatusRequestRef.current = "";
        setEmblemStatusError("이전 엠블럼 상태를 확인하지 못했습니다.");
        return;
      }
      setEmblemCanRestore(result.emblemCanRestore === true);
    }).catch(() => {
      if (cancelled) return;
      emblemStatusRequestRef.current = "";
      setEmblemStatusError("이전 엠블럼 상태를 확인하지 못했습니다.");
    });
    return () => { cancelled = true; };
  }, [app.remoteReady, canManage, emblemStatusRetrySequence, loadTeamEmblemStatus, team?.id]);

  const retryTeamEmblemStatus = () => {
    emblemStatusRequestRef.current = "";
    setEmblemStatusError("");
    setEmblemStatusRetrySequence((current) => current + 1);
  };

  useEffect(() => {
    if (app.remoteReady === false || !teamId) return undefined;
    const refreshTeam = () => { void refreshTeamDetail(); };
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
  }, [app.remoteReady, refreshTeamDetail, teamId]);

  useEffect(() => {
    if (app.demoPreview || app.remoteReady === false || !team?.id || !loadTeamRecords || teamRecordArchive.loaded || teamRecordArchive.loading || teamRecordArchive.error) return;
    loadTeamRecords(team.id);
  }, [app.demoPreview, app.remoteReady, loadTeamRecords, team?.id, teamRecordArchive.error, teamRecordArchive.loaded, teamRecordArchive.loading]);

  const directoryPending = app.remoteReady === false
    || teamDetailLoad.loading
    || (app.directoryStatus?.loaded === false && !app.directoryStatus?.error)
    || (!team && !teamDetailReady && app.remoteReady !== false && Boolean(loadDirectory) && !teamDetailError);
  if (!team && directoryPending) return <BasketballLoader overlay label="팀 불러오는 중" />;
  if (!team && teamDetailError) {
    return (
      <main className="page-stack team-detail-page">
        <Card className="section-card">
          <h1>팀 정보를 불러오지 못했습니다</h1>
          <p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
          <Button type="button" onClick={() => { void refreshTeamDetail(); }}>다시 시도</Button>
        </Card>
      </main>
    );
  }
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
  const pendingTeamJoinRequests = pendingTeamInvitations.filter((invitation) => invitation.requestKind === "request");
  const pendingOwnJoinRequest = pendingTeamJoinRequests.find((invitation) => invitation.targetUserId === app.currentUser.id) ?? null;
  const pendingOwnTeamInvite = pendingTeamInvitations.find((invitation) => invitation.requestKind !== "request" && invitation.targetUserId === app.currentUser.id) ?? null;
  const pendingTargetIds = new Set(pendingTeamInvitations.map((invitation) => invitation.targetUserId));
  const availableUsers = app.state.users.filter((user) => (
    !team.members.some((member) => member.userId === user.id) &&
    !pendingTargetIds.has(user.id)
  ));
  const selectedRemoteUser = selectedInviteProfile?.id === memberDraft.userId &&
    !team.members.some((member) => member.userId === selectedInviteProfile.id) &&
    !pendingTargetIds.has(selectedInviteProfile.id)
    ? selectedInviteProfile
    : null;
  const addUserId = selectedRemoteUser?.id ?? (availableUsers.some((user) => user.id === memberDraft.userId) ? memberDraft.userId : "");
  const selectedInviteUser = selectedRemoteUser ?? availableUsers.find((user) => user.id === addUserId) ?? null;
  const selectedCount = membershipCounts.get(addUserId) ?? 0;
  const teamFull = team.members.length >= MAX_TEAM_MEMBERS;
  const currentUserIsMember = team.members.some((member) => member.userId === app.currentUser.id);
  const currentUserTeamCount = membershipCounts.get(app.currentUser.id) ?? 0;
  const canAddMember = canManage && Boolean(addUserId) && selectedCount < MAX_TEAM_MEMBERSHIPS && !teamFull;
  const history = app.state.matches.filter((match) => match.status === "confirmed" && getTeamSide(match, team.id));
  const detailHistory = history.filter(isHistoryInDetailWindow);
  const archivedHistory = teamRecordArchive.rows ?? [];
  const teamScoreSummary = getTeamScoreSummary(history, archivedHistory, team.id);
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
    if (!canAddMember || teamInvitePendingRef.current || teamManagementPendingRef.current) return;
    teamInvitePendingRef.current = true;
    setTeamInvitePending(true);
    setTeamInviteError("");
    try {
      const result = await app.actions.inviteTeamMember(team.id, addUserId, memberDraft.role);
      if (!result || result.ok === false) {
        setTeamInviteError("팀 초대를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setMemberDraft({ userId: "", role: "regular" });
      setMemberQuery("");
      setSelectedInviteProfile(null);
    } catch {
      setTeamInviteError("팀 초대를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      teamInvitePendingRef.current = false;
      setTeamInvitePending(false);
    }
  };
  const toggleTeamFavorite = async () => {
    if (favoritePendingRef.current) return;
    favoritePendingRef.current = true;
    setFavoritePending(true);
    setFavoriteError("");
    try {
      const result = await app.actions.toggleFavoriteTeam(team.id, team);
      if (!result || result?.ok === false) setFavoriteError("즐겨찾기를 저장하지 못했습니다. 다시 시도해 주세요.");
    } catch {
      setFavoriteError("즐겨찾기를 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      favoritePendingRef.current = false;
      setFavoritePending(false);
    }
  };
  const runTeamManagementMutation = async (mutation) => {
    if (teamManagementPendingRef.current || teamInvitePendingRef.current) return false;
    teamManagementPendingRef.current = true;
    setTeamManagementPending(true);
    setTeamManagementError("");
    try {
      const result = await mutation();
      if (!result || result.ok === false) {
        setTeamManagementError("팀 관리 변경을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return false;
      }
      return true;
    } catch {
      setTeamManagementError("팀 관리 변경을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    } finally {
      teamManagementPendingRef.current = false;
      setTeamManagementPending(false);
    }
  };
  const cancelPendingTeamInvitation = (invitationId) => (
    runTeamManagementMutation(() => app.actions.cancelTeamInvitation(invitationId))
  );
  const openTeamJoinApplication = () => {
    const reason = getTeamJoinApplicationBlockReason({
      demoPreview: app.demoPreview,
      currentUserIsMember,
      currentTeamCount: currentUserTeamCount,
      targetTeamMemberCount: team.members.length,
      hasPendingRequest: Boolean(pendingOwnJoinRequest),
      hasPendingInvite: Boolean(pendingOwnTeamInvite),
    });
    if (reason) {
      setTeamManagementError(reason);
      return;
    }
    setTeamManagementError("");
    setJoinApplicationOpen(true);
  };
  const requestTeamMembership = async (application) => {
    const saved = await runTeamManagementMutation(() => app.actions.requestTeamMembership(team.id, application));
    if (saved) setJoinApplicationOpen(false);
    return saved;
  };
  const cancelTeamJoinRequest = (invitationId) => runTeamManagementMutation(() => app.actions.cancelTeamJoinRequest(invitationId));
  const approveTeamJoinRequest = (invitationId) => runTeamManagementMutation(() => app.actions.approveTeamJoinRequest(invitationId));
  const declineTeamJoinRequest = (invitationId) => runTeamManagementMutation(() => app.actions.declineTeamJoinRequest(invitationId));
  const saveTeamDescription = () => {
    const description = String(teamDescriptionDraft ?? "").replace(/\r\n?/g, "\n").trim();
    if (description.length > MAX_TEAM_DESCRIPTION_LENGTH || description.split("\n").length > MAX_TEAM_DESCRIPTION_LINES) return false;
    return runTeamManagementMutation(() => app.actions.updateTeamDescription(team.id, description));
  };
  const changeTeamMemberRole = (userId, role) => (
    runTeamManagementMutation(() => app.actions.updateTeamMemberRole(team.id, userId, role))
  );
  const excludeTeamMember = (userId) => (
    runTeamManagementMutation(() => app.actions.removeTeamMember(team.id, userId))
  );
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
        <span className="search-picker-player-identity">
          <span>
            <strong>{user.name}</strong>
            <small>{getUserHashtag(user)}</small>
          </span>
        </span>
        <span>{user.region} · {user.position} · {count}/{MAX_TEAM_MEMBERSHIPS}팀</span>
        <em>{blocked ? "초대 불가" : "초대 대상"}</em>
      </button>
    );
  };
  const deleteTeam = async () => {
    const deleted = await runTeamManagementMutation(() => app.actions.deleteTeam(team.id));
    if (deleted) navigate("/app/teams", { replace: true });
    return deleted;
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
    if (!file || emblemPendingRef.current?.scopeId === team.id) return;
    const operation = { scopeId: team.id, operationId: ++emblemOperationSequenceRef.current };
    emblemPendingRef.current = operation;
    setEmblemPending(true);
    setEmblemFeedback("");
    try {
      const result = await app.actions.uploadTeamEmblem(team.id, file, crop);
      if (!isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) return;
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
      if (isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) setEmblemFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      if (isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) {
        emblemPendingRef.current = null;
        setEmblemPending(false);
      }
    }
  };
  const restorePreviousEmblem = async () => {
    if (emblemPendingRef.current?.scopeId === team.id || !emblemCanRestore) return;
    const operation = { scopeId: team.id, operationId: ++emblemOperationSequenceRef.current };
    emblemPendingRef.current = operation;
    setEmblemPending(true);
    setEmblemFeedback("");
    try {
      const result = await app.actions.restoreTeamEmblem(team.id);
      if (!isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) return;
      const nextAt = result?.details?.nextAllowedAt;
      if (result && result.ok !== false) setEmblemCanRestore(result.emblemCanRestore === true);
      setEmblemFeedback(!result || result?.ok === false
        ? `${getTeamEmblemErrorMessage(result?.error)}${nextAt ? ` ${formatEmblemDate(nextAt)}` : ""}`
        : "직전 사진으로 되돌렸습니다.");
    } catch (error) {
      if (isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) setEmblemFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      if (isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) {
        emblemPendingRef.current = null;
        setEmblemPending(false);
      }
    }
  };
  const selectEmblemSource = async (emblemSource) => {
    const currentSource = team.emblemSource ?? (team.emblemKey ? "upload" : "initial");
    if (emblemPendingRef.current?.scopeId === team.id || emblemSource === currentSource) return;
    if (emblemSource === "upload" && !team.emblemKey) {
      if (!isEmblemUploadLocked(team.emblemUploadCount, team.emblemUploadedAt)) emblemInputRef.current?.click();
      return;
    }
    const operation = { scopeId: team.id, operationId: ++emblemOperationSequenceRef.current };
    emblemPendingRef.current = operation;
    setEmblemPending(true);
    setEmblemFeedback("");
    try {
      const result = await app.actions.setTeamEmblemSource(team.id, emblemSource);
      if (!isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) return;
      setEmblemFeedback(!result || result?.ok === false ? getTeamEmblemErrorMessage(result?.error) : "엠블럼 표시 방식을 저장했습니다.");
    } catch (error) {
      if (isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) setEmblemFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      if (isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) {
        emblemPendingRef.current = null;
        setEmblemPending(false);
      }
    }
  };
  const saveEmblemStyle = async () => {
    if (emblemPendingRef.current?.scopeId === team.id) return;
    const emblemAbbreviation = normalizeTeamEmblemAbbreviation(emblemStyleDraft.emblemAbbreviation);
    if (emblemAbbreviation && !isTeamEmblemAbbreviation(emblemAbbreviation)) {
      setEmblemFeedback("약칭은 공백을 제외한 1~4자로 입력해 주세요.");
      return;
    }
    if (emblemStyleDraft.emblemTextMode === "abbreviation" && !isTeamEmblemAbbreviation(emblemAbbreviation)) {
      setEmblemFeedback("공백만 있는 약칭은 저장할 수 없습니다. 1~4자로 입력해 주세요.");
      return;
    }
    const operation = { scopeId: team.id, operationId: ++emblemOperationSequenceRef.current };
    emblemPendingRef.current = operation;
    setEmblemPending(true);
    setEmblemFeedback("");
    try {
      const result = await app.actions.updateTeamEmblemStyle(team.id, { ...emblemStyleDraft, emblemAbbreviation });
      if (!isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) return;
      if (result && result.ok !== false) setEmblemStyleDraft((current) => ({ ...current, emblemAbbreviation }));
      setEmblemFeedback(!result || result?.ok === false ? getTeamEmblemErrorMessage(result?.error) : "엠블럼 디자인을 저장했습니다.");
    } catch (error) {
      if (isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) setEmblemFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      if (isCurrentScopedOperation(emblemPendingRef.current, operation, currentTeamIdRef.current)) {
        emblemPendingRef.current = null;
        setEmblemPending(false);
      }
    }
  };

  const cooldownNextAt = getNextEmblemUploadAt(team.emblemUploadCount, team.emblemUploadedAt);
  const moderationBlockedAt = team.emblemUploadBlockedUntil ? new Date(team.emblemUploadBlockedUntil) : null;
  const moderationLocked = Boolean(moderationBlockedAt && Number.isFinite(moderationBlockedAt.getTime()) && moderationBlockedAt.getTime() > Date.now());
  const nextEmblemUploadAt = moderationLocked && (!cooldownNextAt || moderationBlockedAt > cooldownNextAt) ? moderationBlockedAt : cooldownNextAt;
  const emblemUploadLocked = moderationLocked || isEmblemUploadLocked(team.emblemUploadCount, team.emblemUploadedAt);
  const emblemSource = team.emblemSource ?? (team.emblemKey ? "upload" : "initial");

  return <TeamDetailView controller={{ addUserId, app, archivedHistory, availableUsers, approveTeamJoinRequest, canAddMember, canManage, cancelPendingTeamInvitation, cancelTeamJoinRequest, captain, changeTeamMemberRole, confirmEmblemUpload, confirmedCount, cooldownNextAt, currentUserIsMember, deleteTeam, detailHistory, directoryPending, declineTeamJoinRequest, emblemAbbreviationCharacterCount, emblemCanRestore, emblemFeedback, emblemFile, emblemInputRef, emblemPending, emblemSource, emblemStatusError, emblemStatusRequestRef, emblemStyleDraft, emblemUploadLocked, excludeTeamMember, favoriteError, favoritePending, favoriteTeamIds, history, historyCount, historyIds, inviteMember, isFavoriteTeam, joinApplicationOpen, loadDirectory, loadTeamEmblemStatus, loadTeamRecords, loadedLosses, loadedWins, losses, memberDraft, memberQuery, membershipCounts, moderationBlockedAt, moderationLocked, nextEmblemUploadAt, openTeamJoinApplication, pendingOwnJoinRequest, pendingOwnTeamInvite, pendingTargetIds, pendingTeamInvitations, pendingTeamJoinRequests, refreshTeamDetail, regularMembers, renderInviteSearchItem, renderMembers, requestTeamMembership, reserveMembers, restorePreviousEmblem, retryTeamEmblemStatus, reviewedJoinApplication, saveEmblemStyle, saveTeamDescription, selectEmblemSource, selectedCount, selectedHistoryMatchId, selectedInviteProfile, selectedInviteUser, selectedRemoteUser, setEmblemCanRestore, setEmblemFeedback, setEmblemFile, setEmblemPending, setEmblemStyleDraft, setJoinApplicationOpen, setMemberDraft, setMemberQuery, setReviewedJoinApplication, setSelectedHistoryMatchId, setSelectedInviteProfile, setTeamDescriptionDraft, setTeamInviteError, team, teamDescriptionDraft, teamDetailError, teamFull, teamId, teamInviteError, teamInvitePending, teamManagementError, teamManagementPending, teamRecordArchive, teamScoreSummary, toggleTeamFavorite, uploadEmblem, userMap, winRate, wins }} />;
}
