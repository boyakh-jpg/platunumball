import { useEffect, useMemo, useRef, useState } from "react";
import { getRegisteredCourts } from "../lib/courts.js";
import { getUserHashtag } from "../lib/handles.js";
import { DIRECTORY_SELF_PAGE_LIMIT } from "../lib/queryPolicy.js";
import { isHomeGuideCardVisible } from "../data/settingsMappers.js";
import { DISCORD_NOTIFICATION_EVENTS, acknowledgeDiscordOAuthResult, consumeDiscordOAuthResult, findDiscordConnectionOwner, getDiscordChannel, getDiscordDisplayName, getDiscordProfileUrl, isDiscordLinked, startDiscordOAuth } from "../lib/discord.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  SETTINGS_SECTIONS,
  EMBEDDED_SETTINGS_SECTIONS,
  getPrivacyDraft,
} from "./settingsPageModel.js";
import useSettingsReportController from "./useSettingsReportController.jsx";
import useSettingsFavorites from "./useSettingsFavorites.jsx";
import useSettingsCourtRequestController from "./useSettingsCourtRequestController.js";
import useSettingsRefereeController from "./useSettingsRefereeController.js";

export default function useSettingsPageController({
  app,
  section = "main"
}) {
const loadDirectory = app.actions.loadDirectory;
  const loadAdminContext = app.actions.loadAdminContext;
  useEffect(() => {
    loadDirectory?.({ kind: "self", limit: DIRECTORY_SELF_PAGE_LIMIT, offset: 0 });
    loadAdminContext?.();
  }, [loadAdminContext, loadDirectory]);
  const requestedSettingsSection = Object.prototype.hasOwnProperty.call(SETTINGS_SECTIONS, section) ? section : "main";
  const settingsSection = EMBEDDED_SETTINGS_SECTIONS.has(requestedSettingsSection) ? "main" : requestedSettingsSection;
  const sectionMeta = SETTINGS_SECTIONS[settingsSection];
  const privacy = app.state.settings?.privacy ?? {};
  const privacySnapshot = JSON.stringify(getPrivacyDraft(privacy));
  const [privacyDraft, setPrivacyDraft] = useState(() => getPrivacyDraft(privacy));
  const [privacySaveStatus, setPrivacySaveStatus] = useState("");
  const theme = app.state.settings?.theme === "light" ? "light" : "dark";
  const [themeDraft, setThemeDraft] = useState(theme);
  const [themeSaveStatus, setThemeSaveStatus] = useState("");
  const lastThemeRef = useRef(theme);
  const themeSaveRequestRef = useRef(0);
  const homeGuideCardVisible = isHomeGuideCardVisible(app.state.settings);
  const [homeGuideCardDraft, setHomeGuideCardDraft] = useState(homeGuideCardVisible);
  const [homeGuideCardSavePending, setHomeGuideCardSavePending] = useState(false);
  const [homeGuideCardSaveStatus, setHomeGuideCardSaveStatus] = useState("");
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
  const [blockUserId, setBlockUserId] = useState("");
  const [blockUserQuery, setBlockUserQuery] = useState("");
  const [blockSavePending, setBlockSavePending] = useState(false);
  const [blockSaveStatus, setBlockSaveStatus] = useState("");
  const userMap = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const matchMap = useMemo(() => Object.fromEntries(app.state.matches.map((match) => [match.id, match])), [app.state.matches]);
  const courtRequests = app.state.settings?.courtRequests ?? [];
  const approvedCourts = app.state.settings?.approvedCourts ?? [];
  const courtReviews = app.state.settings?.courtReviews ?? [];
  const { reportMatchId, setReportMatchId, reportReason, setReportReason, reportTargetQuery, setReportTargetQuery, reportCourtRequestId, setReportCourtRequestId, reportCourtId, setReportCourtId, reportCourtReviewId, setReportCourtReviewId, reportTeamId, setReportTeamId, reportRemoteTarget, setReportRemoteTarget, reportMemo, setReportMemo, reportedUserIds, setReportedUserIds, reportSubmitPending, setReportSubmitPending, reportSubmitStatus, setReportSubmitStatus, reportMatchesLoading, setReportMatchesLoading, reportMatchesError, setReportMatchesError, recentReportMatches, reportTargetType, isVoidRestoreReport, reportableMatchCandidates, reportNeedsMatchData, reportableCourtRequests, reportableCourts, reportableCourtReviews, reportableTeams, selectedReportMatchId, selectedReportMatch, selectedReportCourtRequest, selectedReportCourt, selectedReportCourtReview, selectedReportTeam, selectedTeamHasUploadedEmblem, reportParticipantRows, reportParticipantIds, selectedReportedUserIds, reportTargetSearchItems, reportRemoteSearchTypes, mapRemoteReportTarget, hasValidVoidRestoreMemo, canSubmitReport, selectReportTarget, changeReportTargetQuery, renderReportTargetSearchItem, submitReport, toggleReportedUser } = useSettingsReportController({ app, userMap, matchMap, courtRequests, approvedCourts, courtReviews });
  const currentTrustScore = Number(app.currentUser?.trustScore ?? 0);
  const {
    courtAddressQuery, setCourtAddressQuery, naverAddressResults, setNaverAddressResults,
    courtLookupStatus, courtPinConfirmed, courtNearbyConfirmed, setCourtNearbyConfirmed,
    courtDraft, naverMapKeyReady, courtAddressSelected, courtDisplayName, courtHasMapPin,
    courtNearbyCandidates, courtRequiresUnit, courtNearbyReviewRequired, courtDuplicate,
    courtDuplicateMessage, courtSourceUrlInvalid, canOpenCourtRequestForm, canSubmitCourtRequest,
    updateCourtDraft, searchCourtAddress, pickCourtMapPin, selectNaverAddress, submitCourtRequest,
  } = useSettingsCourtRequestController({ app, currentTrustScore });
  const {
    refereeDraft, refereeExamQuestions, refereeExamOpen, refereeExamAnswers, refereeExamResult,
    refereeRequests, canOpenRefereeRequestForm, refereeExamNotice, answeredRefereeExamCount,
    refereeExamRequired, refereeExamPassed, refereeExamLocked, refereeExamLockLabel,
    updateRefereeDraft, startRefereeExam, selectRefereeExamAnswer, submitRefereeExam,
    submitRefereeRequest,
  } = useSettingsRefereeController({ app, currentTrustScore });
  const discordLinked = isDiscordLinked(app.currentUser);
  const discordChannel = getDiscordChannel(app.state.settings);
  const discordProfileUrl = getDiscordProfileUrl(app.currentUser);
  const discordDisplayName = getDiscordDisplayName(app.currentUser);
  const queuedDiscordDeliveries = (app.state.discordNotificationDeliveries ?? [])
    .filter((delivery) => delivery.targetUserId === app.currentUserId && delivery.status === "queued");
  const [discordLinkError, setDiscordLinkError] = useState("");
  const [discordSaveStatus, setDiscordSaveStatus] = useState("");
  const [discordDraft, setDiscordDraft] = useState(() => ({
    enabled: Boolean(discordLinked && discordChannel.enabled),
    events: { ...discordChannel.events },
    unlink: false,
  }));
  const discordSnapshot = JSON.stringify({
    linked: discordLinked,
    userId: app.currentUser?.discordConnection?.userId ?? "",
    enabled: discordChannel.enabled,
    events: discordChannel.events,
  });
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const {
    favoriteQuery, setFavoriteQuery, favoriteListType, setFavoriteListType,
    favoritePlayers, favoriteTeams, favoriteCourts, favoriteReferees,
    favoriteListConfig, favoriteSearchIdleItems, renderFavoriteSearchItem,
  } = useSettingsFavorites({ app, registeredCourts });
  const serverAdminLevel = Number(app.adminContext?.level ?? 0);
  const canOpenAdminMenu = serverAdminLevel >= 30;
  const themeDirty = themeDraft !== theme;
  const privacyDirty = JSON.stringify(privacyDraft) !== privacySnapshot;
  const homeGuideCardDirty = homeGuideCardDraft !== homeGuideCardVisible;
  const discordDirty = Boolean(discordDraft.unlink) ||
    discordDraft.enabled !== Boolean(discordLinked && discordChannel.enabled) ||
    DISCORD_NOTIFICATION_EVENTS.some((option) => Boolean(discordDraft.events?.[option.id]) !== Boolean(discordChannel.events?.[option.id]));
  const generalSettingsDirty = homeGuideCardDirty || privacyDirty || discordDirty;
  const generalSettingsStatus = [
    themeSaveStatus ? `테마 ${themeSaveStatus}` : null,
    homeGuideCardSaveStatus ? `홈 안내 ${homeGuideCardSaveStatus}` : null,
    privacySaveStatus ? `노출 ${privacySaveStatus}` : null,
    discordSaveStatus ? `디스코드 ${discordSaveStatus}` : null,
  ].filter(Boolean).join(" · ") || (generalSettingsDirty ? "변경 있음" : "저장됨");

  useEffect(() => {
    const previousTheme = lastThemeRef.current;
    lastThemeRef.current = theme;
    setThemeDraft((current) => (current === previousTheme ? theme : current));
    setThemeSaveStatus((current) => (current === "저장 중" ? current : ""));
  }, [theme]);
  useEffect(() => {
    setPrivacyDraft(JSON.parse(privacySnapshot));
    setPrivacySaveStatus("");
  }, [privacySnapshot]);
  useEffect(() => {
    setHomeGuideCardDraft(homeGuideCardVisible);
    setHomeGuideCardSaveStatus("");
  }, [homeGuideCardVisible]);
  useEffect(() => {
    setDiscordDraft({
      enabled: Boolean(discordLinked && discordChannel.enabled),
      events: { ...discordChannel.events },
      unlink: false,
    });
    setDiscordSaveStatus("");
    setDiscordLinkError("");
  }, [discordSnapshot]);
  useEffect(() => {
    if (isSupabaseConfigured && !app.remoteReady) return;
    const discordOAuthResultPromise = consumeDiscordOAuthResult(app.currentUserId);
    if (!discordOAuthResultPromise) return;
    let active = true;
    const persistDiscordConnection = async () => {
      const discordOAuthResult = await discordOAuthResultPromise;
      if (!active) return;
      acknowledgeDiscordOAuthResult();
      try {
        if (discordOAuthResult.status !== "linked") {
          console.warn("Discord link failed.", discordOAuthResult.error);
          setDiscordLinkError("Discord 연동에 실패했습니다.");
          return;
        }
        const targetUserId = discordOAuthResult.appUserId || app.currentUserId;
        const linkedOwner = findDiscordConnectionOwner(app.state.users, discordOAuthResult.connection, targetUserId);
        if (linkedOwner) {
          setDiscordLinkError(`이미 ${linkedOwner.name} 프로필에 연결된 Discord입니다.`);
          return;
        }
        setDiscordLinkError("");
        const result = await app.actions.updateProfile({ discordConnection: discordOAuthResult.connection }, targetUserId);
        if (!active) return;
        if (result?.ok === false) throw new Error(result.error || "discord_profile_save_failed");
        if (targetUserId !== app.currentUserId) app.actions.switchUser(targetUserId);
        await app.actions.updateSettings({
          notificationChannels: {
            ...(app.state.settings?.notificationChannels ?? {}),
            discord: {
              ...discordChannel,
              enabled: true,
            },
          },
        });
        if (active) setDiscordSaveStatus("연동됨");
      } catch (error) {
        if (!active) return;
        console.warn("Discord connection save failed.", error);
        setDiscordLinkError("Discord 연동 정보를 서버에 저장하지 못했습니다.");
        setDiscordSaveStatus("");
      }
    };
    void persistDiscordConnection();
    return () => {
      active = false;
    };
  }, [app.currentUserId, app.remoteReady]);

  const blockableUsers = useMemo(
    () => app.state.users.filter((user) => user.id !== app.currentUserId && !blockedUserIds.includes(user.id)),
    [app.currentUserId, app.state.users, blockedUserIds],
  );
  const selectedBlockUserId = blockUserId && blockUserId !== app.currentUserId && !blockedUserIds.includes(blockUserId)
    ? blockUserId
    : "";
  const submitBlock = async (event) => {
    event.preventDefault();
    if (!selectedBlockUserId || blockSavePending) return;
    setBlockSavePending(true);
    setBlockSaveStatus("");
    try {
      const result = await app.actions.blockUser(selectedBlockUserId);
      if (!result || result.ok === false) {
        setBlockSaveStatus("차단을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setBlockUserId("");
      setBlockUserQuery("");
      setBlockSaveStatus("차단했습니다.");
    } catch {
      setBlockSaveStatus("차단을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBlockSavePending(false);
    }
  };
  const selectBlockUser = (user) => {
    if (!user?.id || user.id === app.currentUserId || blockedUserIds.includes(user.id)) return;
    setBlockUserId(user.id);
    setBlockUserQuery(`${user.name} ${getUserHashtag(user)}`.trim());
  };
  const renderBlockUserSearchItem = (item) => {
    const user = item.player ?? item;
    const unavailable = user.id === app.currentUserId || blockedUserIds.includes(user.id);
    return (
      <button
        key={user.id}
        type="button"
        className="search-picker-result-row"
        disabled={unavailable}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectBlockUser(user)}
      >
        <strong>{user.name}</strong>
        <span>{getUserHashtag(user)}</span>
        <em>{unavailable ? "선택할 수 없음" : user.region || user.position || "플레이어"}</em>
      </button>
    );
  };
  const releaseBlock = async (userId) => {
    if (!userId || blockSavePending) return;
    setBlockSavePending(true);
    setBlockSaveStatus("");
    try {
      const result = await app.actions.unblockUser(userId);
      setBlockSaveStatus(!result || result.ok === false
        ? "차단 해제를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."
        : "차단을 해제했습니다.");
    } catch {
      setBlockSaveStatus("차단 해제를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBlockSavePending(false);
    }
  };

  const saveTheme = async (nextTheme = themeDraft) => {
    const requestId = themeSaveRequestRef.current + 1;
    themeSaveRequestRef.current = requestId;
    setThemeSaveStatus("저장 중");
    try {
      const saved = await app.actions.saveTheme?.(nextTheme);
      if (themeSaveRequestRef.current === requestId) setThemeSaveStatus(saved ? "저장되었습니다." : "테마를 저장하지 못했습니다.");
      return saved;
    } catch {
      if (themeSaveRequestRef.current === requestId) setThemeSaveStatus("테마를 저장하지 못했습니다.");
      return false;
    }
  };
  const selectTheme = (nextTheme) => {
    if (nextTheme !== "light" && nextTheme !== "dark") return;
    setThemeDraft(nextTheme);
    if (nextTheme === theme && !themeDirty) {
      setThemeSaveStatus("");
      return;
    }
    void saveTheme(nextTheme);
  };
  const saveHomeGuideCardVisibility = async () => {
    if (!homeGuideCardDirty || homeGuideCardSavePending) return;
    setHomeGuideCardSavePending(true);
    setHomeGuideCardSaveStatus("저장 중");
    try {
      const saved = await app.actions.updateSettings({ showHomeGuideCard: homeGuideCardDraft });
      setHomeGuideCardSaveStatus(saved && saved.ok !== false ? "저장되었습니다." : "표시 설정을 저장하지 못했습니다.");
    } catch {
      setHomeGuideCardSaveStatus("표시 설정을 저장하지 못했습니다.");
    } finally {
      setHomeGuideCardSavePending(false);
    }
  };
  const savePrivacy = async () => {
    setPrivacySaveStatus("저장 중");
    try {
      const saved = await app.actions.updatePrivacySettings(privacyDraft);
      setPrivacySaveStatus(saved && saved.ok !== false ? "저장되었습니다." : "공개 범위를 저장하지 못했습니다.");
    } catch {
      setPrivacySaveStatus("공개 범위를 저장하지 못했습니다.");
    }
  };
  const connectDiscord = async () => {
    setDiscordLinkError("");
    try {
      await startDiscordOAuth(app.currentUserId);
    } catch (error) {
      console.warn("Discord OAuth start failed.", error);
      setDiscordLinkError("Discord 연동을 시작하지 못했습니다.");
    }
  };
  const saveDiscordSettings = async () => {
    setDiscordSaveStatus("저장 중");
    try {
      if (discordDraft.unlink) {
        await app.actions.updateProfile({ discordConnection: null });
      }
      const saved = await app.actions.updateSettings({
        notificationChannels: {
          ...(app.state.settings?.notificationChannels ?? {}),
          discord: {
            enabled: Boolean(discordLinked && !discordDraft.unlink && discordDraft.enabled),
            events: {
              ...discordChannel.events,
              ...(discordDraft.events ?? {}),
            },
          },
        },
      });
      setDiscordSaveStatus(saved && saved.ok !== false ? "저장되었습니다." : "Discord 알림 설정을 저장하지 못했습니다.");
    } catch {
      setDiscordSaveStatus("Discord 알림 설정을 저장하지 못했습니다.");
    }
  };
  const saveGeneralSettings = async () => {
    if (!generalSettingsDirty) return;
    if (homeGuideCardDirty) await saveHomeGuideCardVisibility();
    if (privacyDirty) await savePrivacy();
    if (discordDirty) await saveDiscordSettings();
  };
  const reportCourtRequest = (request) => {
    setReportReason("허위 구장 등록");
    setReportTargetQuery(`${request.name} ${request.hashtag ?? ""}`.trim());
    setReportCourtRequestId(request.id);
    setReportCourtId("");
    setReportCourtReviewId("");
    setReportTeamId("");
    setReportRemoteTarget(null);
    setReportMatchId("");
    setReportedUserIds([]);
  };



  return {
    app,
    settingsSection,
    sectionMeta,
    privacyDraft,
    setPrivacyDraft,
    themeDraft,
    themeSaveStatus,
    homeGuideCardDraft,
    setHomeGuideCardDraft,
    homeGuideCardSavePending,
    setHomeGuideCardSaveStatus,
    blockedUserIds,
    setBlockUserId,
    blockUserQuery,
    setBlockUserQuery,
    blockSavePending,
    blockSaveStatus,
    setReportMatchId,
    reportReason,
    setReportReason,
    reportTargetQuery,
    setReportTargetQuery,
    setReportCourtRequestId,
    setReportCourtId,
    setReportCourtReviewId,
    setReportTeamId,
    setReportRemoteTarget,
    reportMemo,
    setReportMemo,
    setReportedUserIds,
    reportSubmitPending,
    reportSubmitStatus,
    reportMatchesLoading,
    reportMatchesError,
    favoriteQuery,
    setFavoriteQuery,
    favoriteListType,
    setFavoriteListType,
    courtAddressQuery,
    setCourtAddressQuery,
    naverAddressResults,
    setNaverAddressResults,
    courtLookupStatus,
    courtPinConfirmed,
    courtNearbyConfirmed,
    setCourtNearbyConfirmed,
    courtDraft,
    refereeDraft,
    refereeExamQuestions,
    refereeExamOpen,
    refereeExamAnswers,
    refereeExamResult,
    userMap,
    matchMap,
    courtRequests,
    approvedCourts,
    courtReviews,
    refereeRequests,
    currentTrustScore,
    discordLinked,
    discordChannel,
    discordProfileUrl,
    discordDisplayName,
    queuedDiscordDeliveries,
    discordLinkError,
    discordSaveStatus,
    discordDraft,
    setDiscordDraft,
    favoritePlayers,
    favoriteTeams,
    favoriteCourts,
    favoriteReferees,
    favoriteListConfig,
    favoriteSearchIdleItems,
    renderFavoriteSearchItem,
    canOpenAdminMenu,
    themeDirty,
    generalSettingsDirty,
    generalSettingsStatus,
    naverMapKeyReady,
    courtAddressSelected,
    courtDisplayName,
    courtHasMapPin,
    courtNearbyCandidates,
    courtRequiresUnit,
    courtNearbyReviewRequired,
    courtDuplicate,
    courtDuplicateMessage,
    courtSourceUrlInvalid,
    canOpenCourtRequestForm,
    canSubmitCourtRequest,
    canOpenRefereeRequestForm,
    refereeExamNotice,
    blockableUsers,
    selectedBlockUserId,
    reportTargetType,
    isVoidRestoreReport,
    reportNeedsMatchData,
    selectedReportMatch,
    selectedReportCourtRequest,
    selectedReportCourt,
    selectedReportCourtReview,
    selectedReportTeam,
    selectedTeamHasUploadedEmblem,
    reportParticipantRows,
    selectedReportedUserIds,
    reportTargetSearchItems,
    reportRemoteSearchTypes,
    mapRemoteReportTarget,
    canSubmitReport,
    answeredRefereeExamCount,
    refereeExamRequired,
    refereeExamPassed,
    refereeExamLocked,
    refereeExamLockLabel,
    changeReportTargetQuery,
    renderReportTargetSearchItem,
    submitBlock,
    renderBlockUserSearchItem,
    releaseBlock,
    submitReport,
    updateCourtDraft,
    searchCourtAddress,
    pickCourtMapPin,
    selectNaverAddress,
    selectTheme,
    connectDiscord,
    saveGeneralSettings,
    submitCourtRequest,
    reportCourtRequest,
    updateRefereeDraft,
    startRefereeExam,
    selectRefereeExamAnswer,
    submitRefereeExam,
    submitRefereeRequest,
    toggleReportedUser,
  };
}
