import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../components/common/Button.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import { REPORT_TARGET_TYPES, VOID_MATCH_RESTORE_REPORT_REASON, getCourtCorrectionFieldForReportReason, getReportReasonValue, getReportTargetType } from "../lib/reportReasons.js";
import { canRequestVoidMatchRestore, formatKoreanDateTime, getReportableMatchTimeMs, isEligibleReferee } from "../lib/matchUtils.js";
import { COURT_REQUEST_TRUST_MIN, REFEREE_TRUST_MIN, REGIONS, REPORT_MATCH_WINDOW_MS } from "../lib/constants.js";
import { findCourtDuplicate, getCourtCanonicalName, getCourtDuplicateMessage, getCourtLocationMatches, getNearbyCourtCandidates, getRegisteredCourts, normalizeCourtFacilityName, normalizeCourtSourceUrl } from "../lib/courts.js";
import { getCourtHashtag, getMatchHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { getNaverMapClientId, openNaverMapPinPicker, searchNaverAddresses, searchNearbyCourtCandidates } from "../lib/naverAddress.js";
import { DIRECTORY_SELF_PAGE_LIMIT } from "../lib/queryPolicy.js";
import { isHomeGuideCardVisible } from "../data/settingsMappers.js";
import { DISCORD_NOTIFICATION_EVENTS, acknowledgeDiscordOAuthResult, consumeDiscordOAuthResult, findDiscordConnectionOwner, getDiscordChannel, getDiscordDisplayName, getDiscordProfileUrl, isDiscordLinked, startDiscordOAuth } from "../lib/discord.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { REFEREE_EXAM_SIZE, REFEREE_EXAM_VERSION } from "../lib/refereeExamBank.js";
import {
  DEFAULT_COURT_REQUEST,
  COURT_NEARBY_REVIEW_FIELDS,
  DEFAULT_REFEREE_REQUEST,
  SETTINGS_SECTIONS,
  EMBEDDED_SETTINGS_SECTIONS,
  getPrivacyDraft,
  makeRefereeAttemptId,
  getLatestRefereeExamAttempt,
  getCourtAddressDong,
  getReportParticipantRows,
  getMatchReportTitle,
} from "./settingsPageModel.js";
import useSettingsReportController from "./useSettingsReportController.jsx";

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















  const [favoriteQuery, setFavoriteQuery] = useState("");
  const [favoriteListType, setFavoriteListType] = useState("");
  const [courtAddressQuery, setCourtAddressQuery] = useState("");
  const [naverAddressResults, setNaverAddressResults] = useState([]);
  const [courtLookupStatus, setCourtLookupStatus] = useState("");
  const [courtPinConfirmed, setCourtPinConfirmed] = useState(false);
  const [courtServerNearbyCandidates, setCourtServerNearbyCandidates] = useState([]);
  const [courtNearbyConfirmed, setCourtNearbyConfirmed] = useState(false);
  const courtNearbySearchRef = useRef(0);
  const [courtDraft, setCourtDraft] = useState(() => ({
    ...DEFAULT_COURT_REQUEST,
    region: app.currentUser?.region ?? DEFAULT_COURT_REQUEST.region,
  }));
  const [refereeDraft, setRefereeDraft] = useState(DEFAULT_REFEREE_REQUEST);
  const [refereeExamQuestions, setRefereeExamQuestions] = useState([]);
  const [refereeExamOpen, setRefereeExamOpen] = useState(false);
  const [refereeExamAnswers, setRefereeExamAnswers] = useState({});
  const [refereeExamResult, setRefereeExamResult] = useState(null);
  const userMap = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const matchMap = useMemo(() => Object.fromEntries(app.state.matches.map((match) => [match.id, match])), [app.state.matches]);
  const courtRequests = app.state.settings?.courtRequests ?? [];
  const approvedCourts = app.state.settings?.approvedCourts ?? [];
  const courtReviews = app.state.settings?.courtReviews ?? [];
  const { reportMatchId, setReportMatchId, reportReason, setReportReason, reportTargetQuery, setReportTargetQuery, reportCourtRequestId, setReportCourtRequestId, reportCourtId, setReportCourtId, reportCourtReviewId, setReportCourtReviewId, reportTeamId, setReportTeamId, reportRemoteTarget, setReportRemoteTarget, reportMemo, setReportMemo, reportedUserIds, setReportedUserIds, reportSubmitPending, setReportSubmitPending, reportSubmitStatus, setReportSubmitStatus, reportMatchesLoading, setReportMatchesLoading, reportMatchesError, setReportMatchesError, recentReportMatches, reportTargetType, isVoidRestoreReport, reportableMatchCandidates, reportNeedsMatchData, reportableCourtRequests, reportableCourts, reportableCourtReviews, reportableTeams, selectedReportMatchId, selectedReportMatch, selectedReportCourtRequest, selectedReportCourt, selectedReportCourtReview, selectedReportTeam, selectedTeamHasUploadedEmblem, reportParticipantRows, reportParticipantIds, selectedReportedUserIds, reportTargetSearchItems, reportRemoteSearchTypes, mapRemoteReportTarget, hasValidVoidRestoreMemo, canSubmitReport, selectReportTarget, changeReportTargetQuery, renderReportTargetSearchItem, submitReport, toggleReportedUser } = useSettingsReportController({ app, userMap, matchMap, courtRequests, approvedCourts, courtReviews });
  const refereeRequests = app.state.settings?.refereeRequests ?? [];
  const refereeExamAttempts = app.state.settings?.refereeExamAttempts ?? [];
  const currentTrustScore = Number(app.currentUser?.trustScore ?? 0);
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
  const favoritePlayerIds = app.state.settings?.favoritePlayerIds ?? [];
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const favoriteCourtIds = app.state.settings?.favoriteCourtIds ?? [];
  const favoriteRefereeIds = app.state.settings?.favoriteRefereeIds ?? [];
  const favoritePlayers = favoritePlayerIds.map((playerId) => app.state.users.find((item) => item.id === playerId)).filter(Boolean);
  const favoriteTeams = favoriteTeamIds.map((teamId) => app.state.teams.find((item) => item.id === teamId)).filter(Boolean);
  const favoriteCourts = favoriteCourtIds.map((courtId) => registeredCourts.find((item) => item.id === courtId)).filter(Boolean);
  const favoriteReferees = favoriteRefereeIds
    .map((userId) => app.state.users.find((item) => item.id === userId))
    .filter((user) => user && isEligibleReferee(user, REFEREE_TRUST_MIN, app.state.settings?.refereeAppointments));
  const favoriteListConfig = {
    player: { label: "프로필", count: favoritePlayerIds.length },
    team: { label: "팀", count: favoriteTeamIds.length },
    court: { label: "구장", count: favoriteCourtIds.length },
    referee: { label: "심판", count: favoriteRefereeIds.length },
  };
  const favoriteSearchIdleItems = [
    ...favoritePlayers.map((item) => ({ ...item, kind: "profile" })),
    ...favoriteTeams.map((item) => ({ ...item, kind: "team" })),
    ...favoriteCourts.map((item) => ({ ...item, kind: "court" })),
    ...favoriteReferees.map((item) => ({ ...item, kind: "referee" })),
  ].slice(0, 10);
  const renderFavoriteSearchItem = (item) => {
    if (item.kind === "team") {
      return (
        <div key={`favorite-team-${item.id}`} className="favorite-result-row" onMouseDown={(event) => event.preventDefault()}>
          <span className="favorite-result-identity team-identity">
            <TeamEmblem team={item} size="sm" />
            <span>
              <strong>{item.name}</strong>
              <em>{getTeamHashtag(item)}</em>
            </span>
          </span>
          <Button type="button" size="sm" variant={favoriteTeamIds.includes(item.id) ? "primary" : "secondary"} onClick={() => { app.actions.toggleFavoriteTeam(item.id); setFavoriteQuery(""); }}>
            {favoriteTeamIds.includes(item.id) ? "해제" : "저장"}
          </Button>
        </div>
      );
    }
    if (item.kind === "court") {
      return (
        <div key={`favorite-court-${item.id}`} className="favorite-result-row" onMouseDown={(event) => event.preventDefault()}>
          <span className="favorite-result-identity">
            <span className="team-dot" />
            <span>
              <strong>{item.name}</strong>
              <em>{getCourtHashtag(item)}</em>
            </span>
          </span>
          <Button type="button" size="sm" variant={favoriteCourtIds.includes(item.id) ? "primary" : "secondary"} onClick={() => { app.actions.toggleFavoriteCourt(item.id); setFavoriteQuery(""); }}>
            {favoriteCourtIds.includes(item.id) ? "해제" : "저장"}
          </Button>
        </div>
      );
    }
    if (item.kind === "referee") {
      return (
        <div key={`favorite-referee-${item.id}`} className="favorite-result-row" onMouseDown={(event) => event.preventDefault()}>
          <span className="favorite-result-identity">
            <ProfileEmblem user={item} className="small" />
            <span>
              <strong>{item.name}</strong>
              <em>{getUserHashtag(item)} · 신뢰도 {item.trustScore}</em>
            </span>
          </span>
          <Button type="button" size="sm" variant={favoriteRefereeIds.includes(item.id) ? "primary" : "secondary"} onClick={() => { app.actions.toggleFavoriteReferee(item.id); setFavoriteQuery(""); }}>
            {favoriteRefereeIds.includes(item.id) ? "해제" : "저장"}
          </Button>
        </div>
      );
    }
    return (
      <div key={`favorite-player-${item.id}`} className="favorite-result-row" onMouseDown={(event) => event.preventDefault()}>
        <span className="favorite-result-identity">
          <ProfileEmblem user={item} className="small" />
          <span>
            <strong>{item.name}</strong>
            <em>{getUserHashtag(item)}</em>
          </span>
        </span>
        <Button type="button" size="sm" variant={favoritePlayerIds.includes(item.id) ? "primary" : "secondary"} onClick={() => { app.actions.toggleFavoritePlayer(item.id); setFavoriteQuery(""); }}>
          {favoritePlayerIds.includes(item.id) ? "해제" : "저장"}
        </Button>
      </div>
    );
  };
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
  const naverMapKeyReady = Boolean(getNaverMapClientId());
  const courtAddressSelected = Boolean(String(courtDraft.addressText ?? "").trim());
  const courtDisplayName = getCourtCanonicalName(courtDraft, app.state);
  const courtHasMapPin = Boolean(String(courtDraft.lat ?? "").trim() && String(courtDraft.lng ?? "").trim());
  const courtLocationMatches = useMemo(
    () => getCourtLocationMatches(courtDraft, app.state),
    [app.state, courtDraft],
  );
  const courtLocalNearbyCandidates = useMemo(
    () => getNearbyCourtCandidates(courtDraft, app.state, { maxDistanceMeters: 500, limit: 5 }),
    [app.state, courtDraft],
  );
  const courtNearbyCandidates = useMemo(() => {
    const seen = new Set();
    return [...courtServerNearbyCandidates, ...courtLocalNearbyCandidates]
      .filter((candidate) => {
        const key = `${candidate.type}:${candidate.court?.id ?? candidate.court?.name ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (
        Number(b.sameLocation) - Number(a.sameLocation)
        || (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER)
      ))
      .slice(0, 5);
  }, [courtLocalNearbyCandidates, courtServerNearbyCandidates]);
  const courtNearbyCandidateSignature = courtNearbyCandidates
    .map((candidate) => `${candidate.type}:${candidate.court?.id ?? candidate.court?.name ?? ""}:${Math.round(candidate.distanceMeters ?? -1)}:${candidate.sameLocation ? 1 : 0}`)
    .join("|");
  const courtRequiresUnit = courtLocationMatches.length > 0;
  const courtNearbyReviewRequired = courtPinConfirmed && courtNearbyCandidates.length > 0;
  const courtDuplicate = useMemo(
    () => findCourtDuplicate({ ...courtDraft, name: courtDisplayName || courtDraft.name }, app.state),
    [app.state, courtDisplayName, courtDraft],
  );
  const courtDuplicateMessage = getCourtDuplicateMessage(courtDuplicate);
  const courtSourceUrlInput = String(courtDraft.sourceUrl ?? "").trim();
  const courtSourceUrl = normalizeCourtSourceUrl(courtSourceUrlInput);
  const courtSourceUrlInvalid = Boolean(courtSourceUrlInput && !courtSourceUrl);
  const canOpenCourtRequestForm = currentTrustScore >= COURT_REQUEST_TRUST_MIN;
  const canSubmitCourtRequest = canOpenCourtRequestForm
    && !courtDuplicate
    && !courtSourceUrlInvalid
    && (!courtNearbyReviewRequired || courtNearbyConfirmed)
    && (!courtRequiresUnit || Boolean(courtDraft.courtUnit.trim()));
  const canOpenRefereeRequestForm = currentTrustScore >= REFEREE_TRUST_MIN;
  const [currentRefereeExamAttemptId, setCurrentRefereeExamAttemptId] = useState("");
  const [refereeExamNotice, setRefereeExamNotice] = useState("");

  useEffect(() => {
    setCourtNearbyConfirmed(false);
  }, [courtNearbyCandidateSignature]);
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
  const selectedBlockUserId = blockableUsers.some((user) => user.id === blockUserId) ? blockUserId : "";

























  const answeredRefereeExamCount = Object.keys(refereeExamAnswers).length;
  const refereeExamRequired = refereeDraft.qualification === "community_exam";
  const refereeExamPassed = refereeExamResult?.passed === true;
  const latestRefereeExamAttempt = useMemo(
    () => getLatestRefereeExamAttempt(refereeExamAttempts, app.currentUserId),
    [app.currentUserId, refereeExamAttempts],
  );
  const refereeExamLockedUntilMs = latestRefereeExamAttempt?.availableAfter ? new Date(latestRefereeExamAttempt.availableAfter).getTime() : 0;
  const refereeExamLocked = Number.isFinite(refereeExamLockedUntilMs) && refereeExamLockedUntilMs > Date.now();
  const refereeExamLockLabel = refereeExamLocked ? formatKoreanDateTime(latestRefereeExamAttempt.availableAfter) : "";




  const submitBlock = async (event) => {
    event.preventDefault();
    if (!selectedBlockUserId || blockSavePending) return;
    setBlockSavePending(true);
    try {
      await app.actions.blockUser(selectedBlockUserId);
      setBlockUserId("");
      setBlockUserQuery("");
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
    try {
      await app.actions.unblockUser(userId);
    } finally {
      setBlockSavePending(false);
    }
  };

  const updateCourtDraft = (patch) => {
    if (Object.keys(patch).some((key) => COURT_NEARBY_REVIEW_FIELDS.has(key))) setCourtNearbyConfirmed(false);
    setCourtDraft((current) => ({ ...current, ...patch }));
  };
  const resetCourtNearbyLookup = () => {
    courtNearbySearchRef.current += 1;
    setCourtServerNearbyCandidates([]);
  };
  const loadCourtNearbyCandidates = async (pin) => {
    const requestId = courtNearbySearchRef.current + 1;
    courtNearbySearchRef.current = requestId;
    setCourtServerNearbyCandidates([]);
    try {
      const nearbyCourts = await searchNearbyCourtCandidates(pin);
      if (courtNearbySearchRef.current !== requestId) return;
      setCourtServerNearbyCandidates(nearbyCourts);
    } catch (error) {
      if (courtNearbySearchRef.current !== requestId) return;
      setCourtServerNearbyCandidates([]);
      setCourtLookupStatus("근처 등록 구장을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
  const getCourtAddressRegion = (addressResult) => {
    const text = `${addressResult?.sigungu ?? ""} ${addressResult?.addressText ?? ""}`;
    return REGIONS.find((region) => text.includes(region)) ?? addressResult?.sigungu ?? app.currentUser?.region ?? "";
  };
  const searchCourtAddress = async () => {
    if (!canOpenCourtRequestForm) {
      setCourtLookupStatus(`구장 등록요청은 신뢰도 ${COURT_REQUEST_TRUST_MIN}점 이상부터 가능합니다.`);
      return;
    }
    setCourtLookupStatus("네이버 주소 검색 중");
    try {
      const results = await searchNaverAddresses(courtAddressQuery);
      setNaverAddressResults(results);
      setCourtLookupStatus(results.length ? `${results.length}개 주소를 찾았습니다. 사용할 주소를 선택해 주세요.` : "주소 검색 결과가 없습니다.");
    } catch (error) {
      setCourtLookupStatus("주소를 검색하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
  const pickCourtMapPin = async () => {
    if (!naverMapKeyReady) {
      setCourtLookupStatus("지도 기능을 준비 중입니다. 잠시 후 다시 이용해 주세요.");
      return;
    }
    setCourtLookupStatus("실제 구장 위치 선택 중");
    try {
      const pin = await openNaverMapPinPicker(courtDraft);
      const addressDong = getCourtAddressDong(pin);
      const buildingName = normalizeCourtFacilityName(pin.buildingName);
      updateCourtDraft({
        buildingName,
        ...(buildingName ? { name: buildingName } : {}),
        region: getCourtAddressRegion(pin),
        sido: pin.sido ?? "",
        sigungu: pin.sigungu ?? "",
        addressText: pin.addressText,
        roadAddress: pin.roadAddress,
        jibunAddress: pin.jibunAddress,
        addressDong,
        zonecode: pin.zonecode,
        lat: String(pin.lat),
        lng: String(pin.lng),
      });
      setCourtAddressQuery(pin.addressText);
      setNaverAddressResults([]);
      setCourtPinConfirmed(true);
      setCourtLookupStatus(buildingName
        ? `핀 주소의 건물명 '${buildingName}'을 시설명에 자동 반영했습니다.`
        : "핀 위치의 실제 주소를 저장했습니다. 시설/장소명을 확인해 주세요.");
      await loadCourtNearbyCandidates(pin);
    } catch (error) {
      setCourtLookupStatus("구장 위치를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
  const selectNaverAddress = (result) => {
    resetCourtNearbyLookup();
    const addressDong = getCourtAddressDong(result);
    const buildingName = normalizeCourtFacilityName(result.buildingName);
    updateCourtDraft({
      buildingName,
      ...(buildingName ? { name: buildingName } : {}),
      region: getCourtAddressRegion(result),
      sido: result.sido ?? "",
      sigungu: result.sigungu ?? "",
      addressText: result.addressText,
      roadAddress: result.roadAddress,
      jibunAddress: result.jibunAddress,
      addressDong,
      searchAddressText: result.addressText,
      zonecode: result.zonecode,
      detailAddress: "",
      lat: result.lat ? String(result.lat) : "",
      lng: result.lng ? String(result.lng) : "",
    });
    setCourtAddressQuery(result.addressText);
    setNaverAddressResults([]);
    setCourtPinConfirmed(false);
    setCourtLookupStatus("근처 주소를 선택했습니다. 지도 핀으로 실제 구장 위치를 확정해 주세요.");
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
  const submitCourtRequest = async (event) => {
    event.preventDefault();
    if (!courtPinConfirmed) {
      setCourtLookupStatus("지도 핀으로 실제 구장 위치를 확정해 주세요.");
      return;
    }
    if (courtDuplicate) {
      setCourtLookupStatus(courtDuplicateMessage);
      return;
    }
    if (courtNearbyReviewRequired && !courtNearbyConfirmed) {
      setCourtLookupStatus("근처 등록·검토 중 구장을 확인하고 중복 확인에 체크해 주세요.");
      return;
    }
    if (courtSourceUrlInvalid) {
      setCourtLookupStatus("공식 안내 링크는 https:// 주소로 입력해 주세요.");
      return;
    }
    if (!canSubmitCourtRequest) return;
    const requestId = await app.actions.submitCourtRequest(courtDraft);
    if (!requestId) {
      setCourtLookupStatus("구장 등록 요청을 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.");
      return;
    }
    setCourtAddressQuery("");
    setNaverAddressResults([]);
    setCourtPinConfirmed(false);
    resetCourtNearbyLookup();
    setCourtNearbyConfirmed(false);
    setCourtDraft({
      ...DEFAULT_COURT_REQUEST,
      region: app.currentUser?.region ?? DEFAULT_COURT_REQUEST.region,
    });
    setCourtLookupStatus("구장 등록요청 저장됨");
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
  const updateRefereeDraft = (patch) => setRefereeDraft((current) => ({ ...current, ...patch }));
  const startRefereeExam = async () => {
    if (!canOpenRefereeRequestForm) {
      setRefereeExamNotice(`심판 시험은 신뢰도 ${REFEREE_TRUST_MIN}점 이상부터 가능합니다.`);
      return;
    }
    if (!isSupabaseConfigured) {
      setRefereeExamNotice("심판 시험은 서버 연결 후 응시할 수 있습니다.");
      return;
    }
    if (refereeExamOpen && !refereeExamResult) {
      setRefereeExamNotice("이미 진행 중인 시험이 있습니다.");
      return;
    }
    if (refereeExamLocked) {
      setRefereeExamNotice(`심판 시험은 주 1회만 가능합니다. 다음 응시 가능: ${refereeExamLockLabel}`);
      return;
    }
    const attemptId = makeRefereeAttemptId();
    setRefereeExamNotice("시험을 불러오는 중입니다.");
    const startedAttempt = await app.actions.startRefereeExamAttempt({
      id: attemptId,
      examVersion: REFEREE_EXAM_VERSION,
    });
    const questions = Array.isArray(startedAttempt?.questions) ? startedAttempt.questions : [];
    if (!startedAttempt?.id || questions.length !== REFEREE_EXAM_SIZE) {
      setRefereeExamNotice("심판 시험을 시작하지 못했습니다.");
      return;
    }
    setCurrentRefereeExamAttemptId(startedAttempt.id);
    setRefereeExamQuestions(questions);
    setRefereeExamAnswers({});
    setRefereeExamResult(null);
    setRefereeExamNotice("");
    setRefereeExamOpen(true);
  };
  const selectRefereeExamAnswer = (questionId, answerIndex) => {
    if (refereeExamResult) return;
    setRefereeExamAnswers((current) => ({ ...current, [questionId]: answerIndex }));
  };
  const submitRefereeExam = async () => {
    if (!currentRefereeExamAttemptId) {
      setRefereeExamNotice("진행 중인 시험이 없습니다.");
      return;
    }
    const result = await app.actions.finishRefereeExamAttempt(currentRefereeExamAttemptId, { answers: refereeExamAnswers });
    if (!result) {
      setRefereeExamNotice("심판 시험 채점에 실패했습니다.");
      return;
    }
    setRefereeExamResult(result);
  };
  const submitRefereeRequest = (event) => {
    event.preventDefault();
    app.actions.submitRefereeRequest({
      ...refereeDraft,
      examVersion: REFEREE_EXAM_VERSION,
      examScore: refereeExamResult?.score ?? 0,
      examTotal: refereeExamResult?.total ?? REFEREE_EXAM_SIZE,
      examPassed: refereeDraft.qualification === "official_license" ? false : refereeExamPassed,
      examAttemptId: currentRefereeExamAttemptId,
    });
    setRefereeDraft(DEFAULT_REFEREE_REQUEST);
    setCurrentRefereeExamAttemptId("");
    setRefereeExamQuestions([]);
    setRefereeExamAnswers({});
    setRefereeExamResult(null);
    setRefereeExamOpen(false);
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
