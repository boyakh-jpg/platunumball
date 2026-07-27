import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Database, MapPin, MessageCircle, Moon, Send, ShieldCheck, Star, Sun, Unlink2 } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import CourtHoverCard from "../components/court/CourtHoverCard.jsx";
import RefereeHoverCard from "../components/referee/RefereeHoverCard.jsx";
import {
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  VOID_MATCH_RESTORE_REPORT_REASON,
  getCourtCorrectionFieldForReportReason,
  getReportReasonValue,
  getReportTargetType,
} from "../lib/reportReasons.js";
import {
  canRequestVoidMatchRestore,
  formatKoreanDateTime,
  formatStatLine,
  getMatchReservePlayerIds,
  getMatchScheduledDate,
  getMatchSidePlayerIds,
  getReportableMatchTimeMs,
  isEligibleReferee,
} from "../lib/matchUtils.js";
import { COURT_REQUEST_TRUST_MIN, REFEREE_EXAM_COOLDOWN_DAYS, REFEREE_TRUST_MIN, REGIONS, REPORT_MATCH_WINDOW_MS } from "../lib/constants.js";
import {
  COURT_ACCESS_OPTIONS,
  COURT_KIND_OPTIONS,
  COURT_LAYOUT_OPTIONS,
  COURT_PUBLIC_ACCESS_OPTIONS,
  COURT_SOURCE_URL_MAX_LENGTH,
  COURT_SURFACE_OPTIONS,
  COURT_TYPE_OPTIONS,
  findCourtDuplicate,
  getCourtAccessLabel,
  getCourtCanonicalName,
  getCourtDuplicateMessage,
  getCourtKindLabel,
  getCourtLayoutLabel,
  getCourtLocationMatches,
  getNearbyCourtCandidates,
  getCourtPaidLabel,
  getCourtPublicAccessLabel,
  getCourtSurfaceLabel,
  getRegisteredCourts,
  normalizeCourtFacilityName,
  normalizeCourtSourceUrl,
} from "../lib/courts.js";
import { getCourtHashtag, getMatchHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { getNaverMapClientId, openNaverMapPinPicker, searchNaverAddresses, searchNearbyCourtCandidates } from "../lib/naverAddress.js";
import { getAdminStatusLabel } from "../lib/admin.js";
import { DIRECTORY_SELF_PAGE_LIMIT } from "../lib/queryPolicy.js";
import { isHomeGuideCardVisible } from "../data/settingsMappers.js";
import {
  DISCORD_NOTIFICATION_EVENTS,
  acknowledgeDiscordOAuthResult,
  consumeDiscordOAuthResult,
  findDiscordConnectionOwner,
  getDiscordAvatarClassName,
  getDiscordAvatarStyle,
  getDiscordChannel,
  getDiscordDisplayName,
  getDiscordProfileUrl,
  isDiscordLinked,
  startDiscordOAuth,
} from "../lib/discord.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  REFEREE_EXAM_BANK_SIZE,
  REFEREE_EXAM_PASS_SCORE,
  REFEREE_EXAM_SIZE,
  REFEREE_EXAM_VERSION,
} from "../lib/refereeExamBank.js";
import "../styles/recruiting-arena.css";

const DEFAULT_COURT_REQUEST = {
  name: "",
  buildingName: "",
  courtUnit: "",
  region: "",
  sido: "",
  sigungu: "",
  type: "확인 필요",
  addressText: "",
  roadAddress: "",
  jibunAddress: "",
  addressDong: "",
  searchAddressText: "",
  zonecode: "",
  detailAddress: "",
  locationNote: "",
  lat: "",
  lng: "",
  courtKind: "unknown",
  surfaceType: "unknown",
  courtLayout: "unknown",
  accessType: "unknown",
  publicAccess: "unknown",
  lighting: null,
  paid: null,
  sourceUrl: "",
};
const COURT_NEARBY_REVIEW_FIELDS = new Set([
  "name",
  "buildingName",
  "courtUnit",
  "addressText",
  "roadAddress",
  "jibunAddress",
  "zonecode",
  "lat",
  "lng",
]);
const COURT_COST_OPTIONS = [
  { id: "unknown", label: "확인 필요", value: null },
  { id: "free", label: "무료", value: false },
  { id: "paid", label: "유료", value: true },
];
const COURT_LIGHTING_OPTIONS = [
  { id: "unknown", label: "확인 필요", value: null },
  { id: "yes", label: "있음", value: true },
  { id: "no", label: "없음", value: false },
];
const DEFAULT_REFEREE_REQUEST = {
  qualification: "community_exam",
  experience: "",
  memo: "",
};
const SETTINGS_SECTIONS = {
  main: { eyebrow: "Settings", title: "설정" },
  favorites: { eyebrow: "Favorites", title: "즐겨찾기 설정" },
  profile: { eyebrow: "Profile", title: "프로필 노출 설정" },
  discord: { eyebrow: "Discord", title: "디스코드 알림" },
  courts: { eyebrow: "Court", title: "구장 신청" },
  referee: { eyebrow: "Referee", title: "심판 등록" },
};
const EMBEDDED_SETTINGS_SECTIONS = new Set(["profile", "discord"]);
function getPrivacyDraft(privacy = {}) {
  return {
    regionRanking: privacy.regionRanking !== false,
    teamHistory: privacy.teamHistory !== false,
    statSummary: privacy.statSummary !== false,
  };
}

function makeRefereeAttemptId() {
  return `rea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getLatestRefereeExamAttempt(attempts = [], userId) {
  return [...attempts]
    .filter((attempt) => attempt.userId === userId)
    .sort((a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime())[0] ?? null;
}

function getCourtAddressDong(source = {}) {
  const direct = String(source.addressDong ?? source.bname ?? source.hname ?? "").trim();
  if (direct) return direct;
  const addressText = String(source.addressText ?? source.roadAddress ?? source.jibunAddress ?? "").trim();
  return addressText.match(/[가-힣0-9]+동/)?.[0] ?? "";
}

function getReportParticipantRows(match = {}, userMap = {}) {
  const rows = [];
  const seen = new Set();
  const addSideRows = (sideName, role, playerIds) => {
    playerIds.forEach((userId) => {
      const user = userMap[userId];
      if (!user || seen.has(userId)) return;
      seen.add(userId);
      rows.push({
        userId,
        user,
        sideName,
        sideLabel: sideName === "teamA" ? "A사이드" : "B사이드",
        teamName: match[sideName]?.name ?? (sideName === "teamA" ? "A사이드" : "B사이드"),
        role,
        stats: match.result?.playerStats?.[userId] ?? match.playerStats?.[userId] ?? {},
      });
    });
  };

  addSideRows("teamA", "출전", getMatchSidePlayerIds(match, "teamA"));
  addSideRows("teamB", "출전", getMatchSidePlayerIds(match, "teamB"));
  addSideRows("teamA", "후보", getMatchReservePlayerIds(match, "teamA"));
  addSideRows("teamB", "후보", getMatchReservePlayerIds(match, "teamB"));
  return rows;
}

function getMatchReportTitle(match = {}) {
  const versus = [match.teamA?.name, match.teamB?.name].filter(Boolean).join(" vs ");
  return match.title || versus || "경기 기록";
}

function getReportTargetLabel(targetType) {
  if (targetType === REPORT_TARGET_TYPES.player) return "선수 검색";
  if (targetType === REPORT_TARGET_TYPES.match) return "경기기록 검색";
  if (targetType === REPORT_TARGET_TYPES.courtRequest) return "구장 등록요청 검색";
  if (targetType === REPORT_TARGET_TYPES.court) return "구장 검색";
  if (targetType === REPORT_TARGET_TYPES.courtReview) return "구장 리뷰 검색";
  if (targetType === REPORT_TARGET_TYPES.teamName || targetType === REPORT_TARGET_TYPES.teamEmblem) return "팀 검색";
  return "신고 대상 검색";
}

function getReportTargetPlaceholder(targetType) {
  if (targetType === REPORT_TARGET_TYPES.player) return "선수명, 포지션, 경기, #경기기록 검색";
  if (targetType === REPORT_TARGET_TYPES.match) return "경기명, 팀명, 구장, #경기기록 검색";
  if (targetType === REPORT_TARGET_TYPES.courtRequest) return "요청 구장명, 주소, #구장 검색";
  if (targetType === REPORT_TARGET_TYPES.court) return "구장명, 주소, #구장 검색";
  if (targetType === REPORT_TARGET_TYPES.courtReview) return "구장명, 리뷰, 경기, #구장 검색";
  if (targetType === REPORT_TARGET_TYPES.teamName || targetType === REPORT_TARGET_TYPES.teamEmblem) return "팀명, 홈코트, 지역 검색";
  return "선수, 경기, 구장, 해시태그 검색";
}

function getReportTargetEmptyText(targetType) {
  if (targetType === REPORT_TARGET_TYPES.courtRequest) return "신고 가능한 구장 등록요청 없음";
  if (targetType === REPORT_TARGET_TYPES.court) return "신고 가능한 구장 없음";
  if (targetType === REPORT_TARGET_TYPES.courtReview) return "신고 가능한 구장 리뷰 없음";
  if (targetType === REPORT_TARGET_TYPES.player) return "신고 가능한 선수 없음";
  if (targetType === REPORT_TARGET_TYPES.teamName || targetType === REPORT_TARGET_TYPES.teamEmblem) return "신고 가능한 팀 없음";
  return "신고 가능한 대상 없음";
}

function formatCourtDistance(distanceMeters) {
  const distance = Number(distanceMeters);
  if (!Number.isFinite(distance)) return "거리 미확인";
  if (distance < 1000) return `${Math.max(0, Math.round(distance))}m`;
  return `${(distance / 1000).toFixed(1)}km`;
}

export default function Settings({ app, section = "main" }) {
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
  const [homeGuideCardSavePending, setHomeGuideCardSavePending] = useState(false);
  const [homeGuideCardSaveStatus, setHomeGuideCardSaveStatus] = useState("");
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
  const [blockUserId, setBlockUserId] = useState(app.state.users.find((user) => user.id !== app.currentUserId)?.id ?? "");
  const [blockSavePending, setBlockSavePending] = useState(false);
  const [reportMatchId, setReportMatchId] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [reportTargetQuery, setReportTargetQuery] = useState("");
  const [reportCourtRequestId, setReportCourtRequestId] = useState("");
  const [reportCourtId, setReportCourtId] = useState("");
  const [reportCourtReviewId, setReportCourtReviewId] = useState("");
  const [reportTeamId, setReportTeamId] = useState("");
  const [reportRemoteTarget, setReportRemoteTarget] = useState(null);
  const [reportMemo, setReportMemo] = useState("");
  const [reportedUserIds, setReportedUserIds] = useState([]);
  const [reportSubmitPending, setReportSubmitPending] = useState(false);
  const [reportSubmitStatus, setReportSubmitStatus] = useState("");
  const [reportMatchesLoading, setReportMatchesLoading] = useState(false);
  const [reportMatchesError, setReportMatchesError] = useState("");
  const reportMatchesLoadRef = useRef("");
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
  const discordDirty = Boolean(discordDraft.unlink) ||
    discordDraft.enabled !== Boolean(discordLinked && discordChannel.enabled) ||
    DISCORD_NOTIFICATION_EVENTS.some((option) => Boolean(discordDraft.events?.[option.id]) !== Boolean(discordChannel.events?.[option.id]));
  const generalSettingsDirty = privacyDirty || discordDirty;
  const generalSettingsStatus = [
    themeSaveStatus ? `테마 ${themeSaveStatus}` : null,
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
  const selectedBlockUserId = blockableUsers.some((user) => user.id === blockUserId) ? blockUserId : blockableUsers[0]?.id ?? "";
  const recentReportMatches = useMemo(() => {
    const now = Date.now();
    const cutoff = now - REPORT_MATCH_WINDOW_MS;
    return [...app.state.matches]
      .map((match) => ({ match, reportTime: getReportableMatchTimeMs(match) }))
      .filter(({ match, reportTime }) => (
        reportTime >= cutoff &&
        reportTime <= now &&
        getReportParticipantRows(match, userMap).some((row) => row.userId === app.currentUserId)
      ))
      .sort((a, b) => b.reportTime - a.reportTime)
      .map(({ match }) => match);
  }, [app.currentUserId, app.state.matches, userMap]);
  const reportTargetType = reportReason ? getReportTargetType(reportReason) : "";
  const isVoidRestoreReport = reportReason === VOID_MATCH_RESTORE_REPORT_REASON;
  const reportableMatchCandidates = useMemo(
    () => (isVoidRestoreReport
      ? recentReportMatches.filter((match) => canRequestVoidMatchRestore(match, app.currentUserId))
      : recentReportMatches),
    [app.currentUserId, isVoidRestoreReport, recentReportMatches],
  );
  const reportNeedsMatchData = [REPORT_TARGET_TYPES.player, REPORT_TARGET_TYPES.match, REPORT_TARGET_TYPES.mixed].includes(reportTargetType);
  useEffect(() => {
    if (!reportNeedsMatchData || !app.currentUserId || reportMatchesLoadRef.current === app.currentUserId) return;
    const loadReportableMatches = app.actions.loadReportableMatches;
    if (!loadReportableMatches) return;
    reportMatchesLoadRef.current = app.currentUserId;
    setReportMatchesLoading(true);
    setReportMatchesError("");
    Promise.resolve(loadReportableMatches()).then((ok) => {
      if (ok !== false) return;
      reportMatchesLoadRef.current = "";
      setReportMatchesError("신고 가능한 경기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }).finally(() => {
      setReportMatchesLoading(false);
    });
  }, [app.actions.loadReportableMatches, app.currentUserId, reportNeedsMatchData]);
  const reportableCourtRequests = useMemo(() => (
    courtRequests.filter((request) => {
      const alreadyReported = app.state.reports?.some((report) => (
        report.type === "court_request" &&
        report.targetId === request.id &&
        report.by === app.currentUserId &&
        report.status !== "dismissed"
      ));
      return request.requestedBy !== app.currentUserId
        && ["pending", "reported"].includes(request.status ?? "pending")
        && !alreadyReported;
    })
  ), [app.currentUserId, app.state.reports, courtRequests]);
  const reportableCourts = useMemo(() => (
    approvedCourts.filter((court) => {
      const alreadyReported = app.state.reports?.some((report) => (
        report.type === "court" &&
        report.targetId === court.id &&
        report.by === app.currentUserId &&
        report.status !== "dismissed" &&
        report.status !== "resolved"
      ));
      return court.id && (!court.status || court.status === "active") && !alreadyReported;
    })
  ), [app.currentUserId, app.state.reports, approvedCourts]);
  const reportableCourtReviews = useMemo(() => (
    courtReviews.filter((review) => {
      const alreadyReported = app.state.reports?.some((report) => (
        report.type === "court_review" &&
        report.targetId === review.id &&
        report.by === app.currentUserId &&
        report.status !== "dismissed" &&
        report.status !== "resolved"
      ));
      return review.id && (!review.status || review.status === "active") && review.reviewerId !== app.currentUserId && !alreadyReported;
    })
  ), [app.currentUserId, app.state.reports, courtReviews]);
  const reportableTeams = useMemo(() => (
    (app.state.teams ?? []).filter((team) => (
      team.id && !team.members?.some((member) => member.role === "captain" && member.userId === app.currentUserId)
    ))
  ), [app.currentUserId, app.state.teams]);
  const selectedReportMatchId = reportableMatchCandidates.some((match) => match.id === reportMatchId) ? reportMatchId : "";
  const selectedReportMatch = reportableMatchCandidates.find((match) => match.id === selectedReportMatchId) ?? null;
  const selectedReportCourtRequest = reportableCourtRequests.find((request) => request.id === reportCourtRequestId)
    ?? (reportRemoteTarget?.kind === "court_request" && reportRemoteTarget.request?.id === reportCourtRequestId ? reportRemoteTarget.request : null);
  const selectedReportCourt = reportableCourts.find((court) => court.id === reportCourtId)
    ?? (reportRemoteTarget?.kind === "court" && reportRemoteTarget.court?.id === reportCourtId ? reportRemoteTarget.court : null);
  const selectedReportCourtReview = reportableCourtReviews.find((review) => review.id === reportCourtReviewId)
    ?? (reportRemoteTarget?.kind === "court_review" && reportRemoteTarget.review?.id === reportCourtReviewId ? reportRemoteTarget.review : null);
  const selectedReportTeam = reportableTeams.find((team) => team.id === reportTeamId)
    ?? (reportRemoteTarget?.kind === "team" && reportRemoteTarget.team?.id === reportTeamId ? reportRemoteTarget.team : null);
  const selectedTeamHasUploadedEmblem = selectedReportTeam?.emblemSource === "upload" && Boolean(selectedReportTeam?.emblemKey);
  const reportParticipantRows = useMemo(
    () => (selectedReportMatch && reportTargetType !== REPORT_TARGET_TYPES.courtRequest
      ? getReportParticipantRows(selectedReportMatch, userMap).filter((row) => reportTargetType !== REPORT_TARGET_TYPES.player || row.userId !== app.currentUserId)
      : []),
    [app.currentUserId, reportTargetType, selectedReportMatch, userMap],
  );
  const reportParticipantIds = useMemo(
    () => reportParticipantRows.map((row) => row.userId),
    [reportParticipantRows],
  );
  const selectedReportedUserIds = reportedUserIds.filter((userId) => reportParticipantIds.includes(userId));
  const reportTargetSearchItems = useMemo(() => {
    if (!reportReason) return [];
    const keyword = reportTargetQuery.trim().toLowerCase();
    const includePlayers = reportTargetType === REPORT_TARGET_TYPES.player || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const includeMatches = reportTargetType === REPORT_TARGET_TYPES.match || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const includeCourtRequests = reportTargetType === REPORT_TARGET_TYPES.courtRequest || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const includeCourts = reportTargetType === REPORT_TARGET_TYPES.court || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const includeCourtReviews = reportTargetType === REPORT_TARGET_TYPES.courtReview || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const includeTeams = reportTargetType === REPORT_TARGET_TYPES.teamName || reportTargetType === REPORT_TARGET_TYPES.teamEmblem;
    const items = [];

    if (includeMatches) {
      reportableMatchCandidates.forEach((match) => {
        const hashtag = getMatchHashtag(match);
        const title = getMatchReportTitle(match);
        items.push({
          id: `match:${match.id}`,
          kind: "match",
          match,
          title,
          subtitle: `${match.scheduledDate || match.scheduledAt || "일정 미정"} · ${match.court || "구장 미정"}`,
          meta: hashtag,
          haystack: `${title} ${hashtag} ${match.teamA?.name ?? ""} ${match.teamB?.name ?? ""} ${match.court ?? ""} ${match.scheduledDate ?? ""} ${match.scheduledTime ?? ""}`.toLowerCase(),
        });
      });
    }

    if (includePlayers) {
      reportableMatchCandidates.forEach((match) => {
        const matchHashtag = getMatchHashtag(match);
        getReportParticipantRows(match, userMap).forEach((row) => {
          if (row.userId === app.currentUserId) return;
          const userHashtag = getUserHashtag(row.user);
          const matchTitle = getMatchReportTitle(match);
          items.push({
            id: `player:${match.id}:${row.userId}`,
            kind: "player",
            match,
            row,
            title: row.user.name,
            subtitle: `${row.sideLabel} · ${row.teamName} · ${row.role} · ${matchTitle}`,
            meta: `${userHashtag} · ${matchHashtag}`,
            haystack: `${row.user.name} ${userHashtag} ${row.user.position} ${row.teamName} ${row.role} ${matchTitle} ${matchHashtag} ${match.court ?? ""}`.toLowerCase(),
          });
        });
      });
    }

    if (includeCourtRequests) {
      reportableCourtRequests.forEach((request) => {
        const requester = userMap[request.requestedBy];
        const hashtag = request.hashtag ? getCourtHashtag(request) : "";
        items.push({
          id: `court:${request.id}`,
          kind: "court_request",
          request,
          title: request.name,
          subtitle: `${request.addressText || "주소 미정"} · ${requester?.name ?? "요청자"}`,
          meta: hashtag || "구장요청",
          haystack: `${request.name} ${request.addressText ?? ""} ${request.region ?? ""} ${requester?.name ?? ""} ${hashtag}`.toLowerCase(),
        });
      });
    }

    if (includeCourts) {
      reportableCourts.forEach((court) => {
        const hashtag = court.hashtag ? getCourtHashtag(court) : "";
        items.push({
          id: `court:${court.id}`,
          kind: "court",
          court,
          title: court.name,
          subtitle: `${court.addressText || "주소 미정"} · 등록 구장`,
          meta: hashtag || "승인 구장",
          haystack: `${court.name} ${court.addressText ?? ""} ${court.region ?? ""} ${hashtag}`.toLowerCase(),
        });
      });
    }

    if (includeCourtReviews) {
      reportableCourtReviews.forEach((review) => {
        const reviewer = userMap[review.reviewerId];
        const match = matchMap[review.matchId];
        items.push({
          id: `court-review:${review.id}`,
          kind: "court_review",
          review,
          title: review.courtName || "구장 리뷰",
          subtitle: `${review.rating ?? "-"}점 · ${reviewer?.name ?? "작성자"} · ${match?.title ?? "경기"}`,
          meta: match ? getMatchHashtag(match) : "구장 리뷰",
          haystack: `${review.courtName ?? ""} ${review.memo ?? ""} ${review.tags?.join?.(" ") ?? ""} ${reviewer?.name ?? ""} ${match?.title ?? ""}`.toLowerCase(),
        });
      });
    }

    if (includeTeams) {
      reportableTeams.forEach((team) => {
        items.push({
          id: `team:${team.id}`,
          kind: "team",
          team,
          title: team.name,
          subtitle: `${team.region || "지역 미정"} · ${team.homeCourt || "홈코트 미정"}`,
          meta: getTeamHashtag(team),
          haystack: `${team.name} ${team.region ?? ""} ${team.homeCourt ?? ""} ${getTeamHashtag(team)}`.toLowerCase(),
        });
      });
    }

    return items.filter((item) => (keyword ? item.haystack.includes(keyword) : true));
  }, [app.currentUserId, matchMap, reportReason, reportTargetQuery, reportTargetType, reportableCourtRequests, reportableCourtReviews, reportableCourts, reportableMatchCandidates, reportableTeams, userMap]);
  const reportRemoteSearchTypes = reportTargetType === REPORT_TARGET_TYPES.courtReview
    ? ["court_review"]
    : reportTargetType === REPORT_TARGET_TYPES.teamName || reportTargetType === REPORT_TARGET_TYPES.teamEmblem
      ? ["team"]
      : reportTargetType === REPORT_TARGET_TYPES.courtRequest
        ? ["court_request"]
        : reportTargetType === REPORT_TARGET_TYPES.court
          ? ["court"]
          : reportTargetType === REPORT_TARGET_TYPES.mixed
            ? ["court", "court_review"]
            : [];
  const mapRemoteReportTarget = (item) => {
    if (item?.kind === "court_request") {
      return {
        id: `court-request:${item.id}`,
        kind: "court_request",
        request: item,
        title: item.name,
        subtitle: `${item.addressText || "주소 미정"} · 등록요청`,
        meta: item.hashtag || "구장요청",
      };
    }
    if (item?.kind === "team") {
      if (item.members?.some((member) => member.role === "captain" && member.userId === app.currentUserId)) return null;
      return {
        id: `team:${item.id}`,
        kind: "team",
        team: item,
        title: item.name,
        subtitle: `${item.region || "지역 미정"} · ${item.homeCourt || "홈코트 미정"}`,
        meta: getTeamHashtag(item),
      };
    }
    if (item?.kind === "court") {
      const hashtag = item.hashtag ? getCourtHashtag(item) : "";
      return {
        id: `court:${item.id}`,
        kind: "court",
        court: item,
        title: item.name,
        subtitle: `${item.addressText || "주소 미정"} · 등록 구장`,
        meta: hashtag || "승인 구장",
      };
    }
    if (item?.kind === "court_review") {
      return {
        id: `court-review:${item.id}`,
        kind: "court_review",
        review: item,
        title: item.courtName || "구장 리뷰",
        subtitle: `${item.rating ?? "-"}점 · ${userMap[item.reviewerId]?.name ?? "작성자"} · ${matchMap[item.matchId]?.title ?? "경기"}`,
        meta: matchMap[item.matchId] ? getMatchHashtag(matchMap[item.matchId]) : "구장 리뷰",
      };
    }
    return null;
  };
  const hasValidVoidRestoreMemo = !isVoidRestoreReport || reportMemo.trim().length >= 10;
  const canSubmitReport = Boolean(reportReason) && hasValidVoidRestoreMemo && (
    reportTargetType === REPORT_TARGET_TYPES.courtRequest
      ? Boolean(selectedReportCourtRequest)
      : reportTargetType === REPORT_TARGET_TYPES.court
        ? Boolean(selectedReportCourt)
        : reportTargetType === REPORT_TARGET_TYPES.courtReview
          ? Boolean(selectedReportCourtReview)
          : reportTargetType === REPORT_TARGET_TYPES.teamName
            ? Boolean(selectedReportTeam)
            : reportTargetType === REPORT_TARGET_TYPES.teamEmblem
              ? Boolean(selectedReportTeam && selectedTeamHasUploadedEmblem)
      : reportTargetType === REPORT_TARGET_TYPES.player
        ? Boolean(selectedReportMatch && selectedReportedUserIds.length)
        : Boolean(selectedReportMatch || selectedReportCourtRequest || selectedReportCourt || selectedReportCourtReview)
  );
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
  const selectReportTarget = (item) => {
    setReportTargetQuery(`${item.title} ${item.meta ?? ""}`.trim());
    if (item.kind === "court_request") {
      setReportRemoteTarget(item);
      setReportCourtRequestId(item.request.id);
      setReportCourtId("");
      setReportCourtReviewId("");
      setReportMatchId("");
      setReportTeamId("");
      setReportedUserIds([]);
      return;
    }
    if (item.kind === "court") {
      setReportRemoteTarget(item);
      setReportCourtId(item.court.id);
      setReportCourtRequestId("");
      setReportCourtReviewId("");
      setReportMatchId("");
      setReportTeamId("");
      setReportedUserIds([]);
      return;
    }
    if (item.kind === "court_review") {
      setReportRemoteTarget(item);
      setReportCourtReviewId(item.review.id);
      setReportCourtId("");
      setReportCourtRequestId("");
      setReportMatchId("");
      setReportTeamId("");
      setReportedUserIds([]);
      return;
    }
    if (item.kind === "team") {
      setReportRemoteTarget(item);
      setReportTeamId(item.team.id);
      setReportCourtRequestId("");
      setReportCourtId("");
      setReportCourtReviewId("");
      setReportMatchId("");
      setReportedUserIds([]);
      return;
    }
    setReportCourtRequestId("");
    setReportRemoteTarget(null);
    setReportCourtId("");
    setReportCourtReviewId("");
    setReportTeamId("");
    setReportMatchId(item.match.id);
    setReportedUserIds(item.kind === "player" ? [item.row.userId] : []);
  };
  const changeReportTargetQuery = (value) => {
    setReportTargetQuery(value);
    setReportMatchId("");
    setReportCourtRequestId("");
    setReportCourtId("");
    setReportCourtReviewId("");
    setReportTeamId("");
    setReportRemoteTarget(null);
    setReportedUserIds([]);
  };
  const renderReportTargetSearchItem = (item) => (
    <button
      key={item.id}
      type="button"
      className="search-picker-result-row"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => selectReportTarget(item)}
    >
      <strong>{item.title}</strong>
      <span>{item.subtitle}</span>
      <em>{item.meta}</em>
    </button>
  );

  const submitBlock = async (event) => {
    event.preventDefault();
    if (!selectedBlockUserId || blockSavePending) return;
    setBlockSavePending(true);
    try {
      await app.actions.blockUser(selectedBlockUserId);
    } finally {
      setBlockSavePending(false);
    }
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
  const submitReport = async (event) => {
    event.preventDefault();
    if (!canSubmitReport || reportSubmitPending) return;
    const memo = reportMemo.trim();
    setReportSubmitPending(true);
    setReportSubmitStatus("신고 저장 중");
    try {
      let result = null;
      const reportReasonValue = getReportReasonValue(reportReason);
      if (selectedReportTeam && reportTargetType === REPORT_TARGET_TYPES.teamName) {
        result = await app.actions.reportTeamName(selectedReportTeam.id, [reportReasonValue, memo].filter(Boolean).join(" · "), selectedReportTeam.name);
      } else if (selectedReportTeam && reportTargetType === REPORT_TARGET_TYPES.teamEmblem) {
        result = await app.actions.reportTeamEmblem(selectedReportTeam.id, [reportReasonValue, memo].filter(Boolean).join(" · "), selectedReportTeam);
      } else if (selectedReportCourtRequest) {
        result = await app.actions.reportCourtRequest(selectedReportCourtRequest.id, [reportReason, memo].filter(Boolean).join(" · "));
      } else if (selectedReportCourt) {
        const correctionField = getCourtCorrectionFieldForReportReason(reportReason);
        result = await app.actions.reportCourt(
          selectedReportCourt.id,
          [reportReason, memo].filter(Boolean).join(" · "),
          {
            field: correctionField,
            proposedValue: memo || (correctionField === "duplicate" ? "동일 구장 중복 등록 확인 필요" : reportReason),
            evidenceUrl: "",
          },
          selectedReportCourt,
        );
      } else if (selectedReportCourtReview) {
        result = await app.actions.reportCourtReview(selectedReportCourtReview.id, [reportReason, memo].filter(Boolean).join(" · "));
      } else if (selectedReportMatchId) {
        const matchLine = selectedReportMatch ? getMatchHashtag(selectedReportMatch) : "";
        if (reportTargetType === REPORT_TARGET_TYPES.player) {
          const targetUserId = selectedReportedUserIds[0] ?? "";
          result = await app.actions.reportPlayer(targetUserId, selectedReportMatchId, [reportReason, matchLine, memo].filter(Boolean).join(" · "));
        } else {
          const targetNames = selectedReportedUserIds.map((userId) => userMap[userId]?.name).filter(Boolean);
          const targetLine = targetNames.length ? `대상: ${targetNames.join(", ")}` : "대상: 경기 기록";
          const reason = isVoidRestoreReport
            ? `${VOID_MATCH_RESTORE_REPORT_REASON}: ${memo}`
            : [reportReason, matchLine, targetLine, memo].filter(Boolean).join(" · ");
          result = await app.actions.reportMatch(selectedReportMatchId, reason, selectedReportedUserIds);
        }
      }
      if (!result || result.ok === false) {
        setReportSubmitStatus("신고를 접수하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.");
        return;
      }
      if (loadDirectory) {
        await Promise.resolve(loadDirectory({ kind: "self", limit: DIRECTORY_SELF_PAGE_LIMIT, offset: 0, force: true })).catch(() => false);
      }
      setReportSubmitStatus(result.duplicate ? "이미 접수된 신고입니다." : "신고가 접수됐습니다.");
      setReportReason("");
      setReportMatchId("");
      setReportedUserIds([]);
      setReportCourtRequestId("");
      setReportCourtId("");
      setReportCourtReviewId("");
      setReportTeamId("");
      setReportRemoteTarget(null);
      setReportTargetQuery("");
      setReportMemo("");
    } catch {
      setReportSubmitStatus("신고를 접수하지 못했습니다. 입력 내용은 유지됩니다.");
    } finally {
      setReportSubmitPending(false);
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
  const selectHomeGuideCardVisibility = async (visible) => {
    if (visible === homeGuideCardVisible || homeGuideCardSavePending) return;
    setHomeGuideCardSavePending(true);
    setHomeGuideCardSaveStatus("저장 중");
    try {
      const saved = await app.actions.updateSettings({ showHomeGuideCard: visible });
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
  const toggleReportedUser = (userId) => {
    setReportedUserIds((current) => (
      current.includes(userId)
        ? []
        : [userId]
    ));
  };

  useEffect(() => {
    setReportedUserIds((current) => {
      const next = current.filter((userId) => reportParticipantIds.includes(userId));
      return next.length === current.length ? current : next;
    });
  }, [reportParticipantIds]);

  return (
    <div className={`page-stack settings-page settings-section-${settingsSection}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">{sectionMeta.eyebrow}</p>
          <h1>{sectionMeta.title}</h1>
        </div>
        {settingsSection !== "main" ? (
          <Button as={Link} variant="secondary" to="/app/settings">설정</Button>
        ) : null}
      </header>
      <div className={`content-grid ${settingsSection === "main" ? "" : "settings-section-grid"}`}>
        <div className="page-stack settings-main-column">
          <Card className="section-card settings-nav-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Setting pages</p>
                <h2>세부 설정</h2>
              </div>
              <ShieldCheck size={22} />
            </div>
            <div className="settings-nav-grid">
              <Link to="/app/settings/favorites"><strong>즐겨찾기</strong><span>프로필/팀/구장/심판</span></Link>
              <Link to="/app/settings/courts"><strong>구장 신청</strong><span>주소 검색/등록 요청</span></Link>
              <Link to="/app/settings/referee"><strong>심판</strong><span>룰북/시험/등록 요청</span></Link>
            </div>
          </Card>

          <Card className="section-card theme-choice-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">화면 테마</p>
                <h2>밝기</h2>
              </div>
              {themeDraft === "light" ? <Sun size={22} /> : <Moon size={22} />}
            </div>
            <div className="segmented-control">
              <button
                type="button"
                className={themeDraft === "light" ? "active" : ""}
                onClick={() => selectTheme("light")}
              >
                라이트
              </button>
              <button
                type="button"
                className={themeDraft === "dark" ? "active" : ""}
                onClick={() => selectTheme("dark")}
              >
                다크
              </button>
            </div>
            <div className="settings-save-row">
              <small>{themeSaveStatus || (themeDirty ? "변경 있음" : "저장됨")}</small>
            </div>
          </Card>

          <Card className="section-card favorite-management-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Favorites</p>
                <h2>즐겨찾기 설정</h2>
              </div>
              <Star size={20} />
            </div>
            <SearchPicker
              value={favoriteQuery}
              onChange={setFavoriteQuery}
              placeholder="이름 또는 해시태그 검색"
              items={[]}
              remoteSearchType="all"
              idleItems={favoriteSearchIdleItems}
              idleTitle="저장한 즐겨찾기"
              title="즐겨찾기 검색 결과"
              emptyText="검색 결과 없음"
              showIdleOnFocus
              floating
              closeOnResultClick
              fieldClassName="favorite-search-row"
              renderItem={renderFavoriteSearchItem}
            />
            <div className="favorite-type-grid">
              {Object.entries(favoriteListConfig).map(([type, config]) => (
                <button
                  key={type}
                  type="button"
                  className={favoriteListType === type ? "active" : ""}
                  aria-pressed={favoriteListType === type}
                  onClick={() => setFavoriteListType((current) => (current === type ? "" : type))}
                >
                  <span>{config.label}</span>
                  <strong>{config.count}/10</strong>
                </button>
              ))}
            </div>
            {favoriteListType ? (
              <div className="favorite-chip-list">
                {favoriteListType === "player" ? favoritePlayers.map((player) => (
                  <div key={player.id} className="favorite-mini-row">
                    <PlayerHoverCard as="span" user={player} teams={app.state.teams} className="favorite-mini-chip">
                      <ProfileEmblem user={player} className="small" />
                      <span>{getUserHashtag(player)}</span>
                    </PlayerHoverCard>
                    <Button type="button" size="sm" variant="secondary" onClick={() => app.actions.toggleFavoritePlayer(player.id)}>해제</Button>
                  </div>
                )) : null}
                {favoriteListType === "team" ? favoriteTeams.map((team) => (
                  <div key={team.id} className="favorite-mini-row">
                    <TeamHoverCard as="span" team={team} className="favorite-mini-chip">
                      <TeamEmblem team={team} size="xs" />
                      <span>{getTeamHashtag(team)}</span>
                    </TeamHoverCard>
                    <Button type="button" size="sm" variant="secondary" onClick={() => app.actions.toggleFavoriteTeam(team.id)}>해제</Button>
                  </div>
                )) : null}
                {favoriteListType === "court" ? favoriteCourts.map((court) => (
                  <div key={court.id} className="favorite-mini-row">
                    <CourtHoverCard court={court} className="favorite-mini-chip">
                      <span className="team-dot" />
                      <span>{getCourtHashtag(court)}</span>
                    </CourtHoverCard>
                    <Button type="button" size="sm" variant="secondary" onClick={() => app.actions.toggleFavoriteCourt(court.id)}>해제</Button>
                  </div>
                )) : null}
                {favoriteListType === "referee" ? favoriteReferees.map((referee) => (
                  <div key={referee.id} className="favorite-mini-row">
                    <RefereeHoverCard user={referee} matches={app.state.matches} minTrust={REFEREE_TRUST_MIN} className="favorite-mini-chip">
                      <ShieldCheck size={14} />
                      <span>{getUserHashtag(referee)}</span>
                    </RefereeHoverCard>
                    <Button type="button" size="sm" variant="secondary" onClick={() => app.actions.toggleFavoriteReferee(referee.id)}>해제</Button>
                  </div>
                )) : null}
                {favoriteListConfig[favoriteListType]?.count ? null : <em>{favoriteListConfig[favoriteListType]?.label} 즐겨찾기 없음</em>}
              </div>
            ) : null}
          </Card>

          <Card className="section-card discord-link-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Discord</p>
                <h2>디스코드 알림</h2>
              </div>
              {discordLinked ? (
                <a className="discord-link-badge" href={discordProfileUrl} target="_blank" rel="noreferrer">
                  <MessageCircle size={14} /> 연동됨
                </a>
              ) : (
                <MessageCircle size={20} />
              )}
            </div>
            <div className="contract-grid single">
              {discordLinked ? (
                <div className="discord-profile-line">
                  <span className={getDiscordAvatarClassName(app.currentUser, "avatar small")} style={getDiscordAvatarStyle(app.currentUser)}>
                    {app.currentUser.name.slice(0, 1)}
                  </span>
                  <strong>@{discordDisplayName}</strong>
                </div>
              ) : null}
              <div>
                <span>연동 상태</span>
                <strong>{discordDraft.unlink ? "해제 예정" : discordLinked ? "연동됨" : "미연동"}</strong>
              </div>
              <div>
                <span>알림 경로</span>
                <strong>{discordLinked && !discordDraft.unlink && discordDraft.enabled ? "앱 + Discord DM" : "앱 내부"}</strong>
              </div>
              {discordLinked ? (
                <div>
                  <span>DM 대기</span>
                  <strong>{queuedDiscordDeliveries.length}개</strong>
                </div>
              ) : null}
            </div>
            {discordLinkError ? <p className="form-warning">{discordLinkError}</p> : null}
            <div className="settings-toggle-grid">
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(discordLinked && !discordDraft.unlink && discordDraft.enabled)}
                  disabled={!discordLinked || discordDraft.unlink}
                  onChange={(event) => setDiscordDraft((current) => ({ ...current, enabled: event.target.checked }))}
                />
                Discord DM
              </label>
              {DISCORD_NOTIFICATION_EVENTS.map((option) => (
                <label key={option.id}>
                  <input
                    type="checkbox"
                    checked={Boolean(discordDraft.events?.[option.id])}
                    disabled={!discordLinked || discordDraft.unlink || !discordDraft.enabled}
                    onChange={() => setDiscordDraft((current) => ({
                      ...current,
                      events: {
                        ...current.events,
                        [option.id]: !current.events?.[option.id],
                      },
                    }))}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <div className="settings-address-actions">
              {discordLinked ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setDiscordDraft((current) => ({
                    ...current,
                    unlink: !current.unlink,
                    enabled: current.unlink ? Boolean(discordChannel.enabled) : false,
                  }))}
                >
                  <Unlink2 size={15} /> {discordDraft.unlink ? "해제 취소" : "연동 해제"}
                </Button>
              ) : (
                <Button type="button" variant="secondary" size="sm" onClick={connectDiscord}>
                  Discord 연동
                </Button>
              )}
              <Badge tone={discordLinked && !discordDraft.unlink && discordDraft.enabled ? "green" : "neutral"}>
                {discordLinked && !discordDraft.unlink && discordDraft.enabled ? "DM ON" : "앱 알림"}
              </Badge>
            </div>
            {discordSaveStatus ? <small>{discordSaveStatus}</small> : null}
          </Card>

          <Card className="section-card settings-privacy-card settings-preference-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Display</p>
                <h2>표시 설정</h2>
              </div>
              <Badge tone={generalSettingsDirty ? "orange" : "neutral"}>{generalSettingsDirty ? "변경 있음" : "저장됨"}</Badge>
            </div>

            <div className="settings-preference-group settings-home-guide-group">
              <div className="settings-preference-heading">
                <strong>홈 안내 카드</strong>
                <span>홈의 ‘처음 사용하시나요?’ 카드만 숨깁니다. 사용 설명과 연습 경기는 계속 이용할 수 있습니다.</span>
              </div>
              <div className="settings-toggle-grid">
                <label>
                  <input
                    type="checkbox"
                    checked={homeGuideCardVisible}
                    disabled={homeGuideCardSavePending}
                    onChange={(event) => void selectHomeGuideCardVisibility(event.target.checked)}
                  />
                  홈에서 안내 카드 표시
                </label>
              </div>
              <small className="settings-preference-status">{homeGuideCardSaveStatus || "선택 즉시 저장됩니다."}</small>
            </div>

            <div className="settings-preference-group">
              <div className="settings-preference-heading">
                <strong>프로필 표시</strong>
                <span>다른 사용자에게 보여줄 프로필 정보를 선택합니다.</span>
              </div>
              <div className="settings-toggle-grid">
                <label>
                  <input
                    type="checkbox"
                    checked={privacyDraft.regionRanking !== false}
                    onChange={(event) => setPrivacyDraft((current) => ({ ...current, regionRanking: event.target.checked }))}
                  />
                  지역 랭킹에 표시
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={privacyDraft.teamHistory !== false}
                    onChange={(event) => setPrivacyDraft((current) => ({ ...current, teamHistory: event.target.checked }))}
                  />
                  소속팀 히스토리 표시
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={privacyDraft.statSummary !== false}
                    onChange={(event) => setPrivacyDraft((current) => ({ ...current, statSummary: event.target.checked }))}
                  />
                  개인 스탯 요약 표시
                </label>
              </div>
            </div>

            <div className="settings-save-row">
              <small>{generalSettingsStatus}</small>
              <Button type="button" variant="primary" onClick={saveGeneralSettings} disabled={!generalSettingsDirty}>저장</Button>
            </div>
          </Card>

          {canOpenAdminMenu ? (
            <Card className="section-card admin-menu-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Operations</p>
                  <h2>관리자 메뉴</h2>
                </div>
                <ShieldCheck size={22} />
              </div>
              <div className="contract-grid single">
                <div>
                  <span>정렬 기준</span>
                  <strong>구장 · 플레이어 · 경기</strong>
                </div>
                <div>
                  <span>처리 대상</span>
                  <strong>신고 · 기록 · 구장요청</strong>
                </div>
              </div>
              <Button as={Link} variant="secondary" to="/app/admin?section=courts">구장 신청 관리 열기</Button>
            </Card>
          ) : null}

          <Card className="section-card settings-reset-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">초기화</p>
                <h2>샘플 데이터 복원</h2>
              </div>
            </div>
            <Button variant="secondary" onClick={app.actions.reset}>데모 데이터 초기화</Button>
          </Card>

          <Card className="section-card settings-block-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">차단</p>
                <h2>플레이어 숨김</h2>
              </div>
              <Badge tone={blockedUserIds.length ? "orange" : "neutral"}>{blockedUserIds.length}명</Badge>
            </div>
            <form className="form-stack" onSubmit={submitBlock}>
              <label>
                차단할 플레이어
                <select value={selectedBlockUserId} disabled={blockSavePending} onChange={(event) => setBlockUserId(event.target.value)}>
                  {blockableUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.region}</option>)}
                </select>
              </label>
              <Button type="submit" variant="secondary" disabled={!selectedBlockUserId || blockSavePending}>{blockSavePending ? "저장 중" : "차단"}</Button>
            </form>
            <div className="compact-list">
              {blockedUserIds.length ? blockedUserIds.map((userId) => (
                <div key={userId}>
                  <span>{userMap[userId]?.name ?? "플레이어"}</span>
                  <button type="button" disabled={blockSavePending} onClick={() => releaseBlock(userId)}>해제</button>
                </div>
              )) : <div><span>차단한 플레이어가 없습니다.</span><strong>0</strong></div>}
            </div>
          </Card>
        </div>

        <aside className="page-stack settings-side-column">

          <Card className="section-card settings-court-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Court</p>
                <h2>구장 등록요청</h2>
              </div>
              <Badge tone={canSubmitCourtRequest ? "green" : "orange"}>신뢰도 {currentTrustScore}</Badge>
            </div>
            <div className={canSubmitCourtRequest ? "tier-range-note" : "tier-range-note tier-range-note-warning"}>
              <div>
                <span>등록 권한</span>
                <strong>{currentTrustScore < COURT_REQUEST_TRUST_MIN ? "등록 제한" : courtDuplicate ? "중복 확인 필요" : courtNearbyReviewRequired && !courtNearbyConfirmed ? "근처 구장 확인 필요" : courtSourceUrlInvalid ? "링크 확인 필요" : "등록 가능"}</strong>
                <em>{courtDuplicateMessage || (courtNearbyReviewRequired && !courtNearbyConfirmed ? "근처 등록·검토 중 구장을 확인하고 체크해 주세요." : courtSourceUrlInvalid ? "공식 안내 링크는 https:// 주소만 사용할 수 있습니다." : `신뢰도 ${COURT_REQUEST_TRUST_MIN}점 이상 필요 · 허위 등록은 운영 정책에 따라 신뢰도 차감`)}</em>
              </div>
              <MapPin size={22} />
            </div>
            {canOpenCourtRequestForm ? (
              <form className="form-stack" onSubmit={submitCourtRequest}>
                <div className="settings-address-search">
                  <label>
                    근처 주소 검색
                    <input
                      value={courtAddressQuery}
                      onChange={(event) => {
                        setCourtAddressQuery(event.target.value);
                        setNaverAddressResults([]);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          searchCourtAddress();
                        }
                      }}
                      placeholder="구장 근처 도로명, 건물명 검색"
                    />
                  </label>
                  <div className="settings-address-actions">
                    <Button type="button" variant="secondary" onClick={searchCourtAddress}>근처 주소 찾기</Button>
                    <Button type="button" variant="secondary" onClick={pickCourtMapPin} disabled={!courtAddressSelected || !naverMapKeyReady}>
                      실제 위치 확정
                    </Button>
                  </div>
                  {naverAddressResults.length ? (
                    <div className="settings-address-results">
                      {naverAddressResults.map((result) => (
                        <button key={result.id} type="button" onClick={() => selectNaverAddress(result)}>
                          <strong>{result.roadAddress || result.addressText}</strong>
                          <span>{result.jibunAddress || result.addressText}</span>
                          <em>지도 이동 기준</em>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {courtLookupStatus ? <small>{courtLookupStatus}</small> : null}
                </div>
                <div className="form-grid two">
                  <label>
                    시설/장소명
                    <input
                      value={courtDraft.name}
                      placeholder="예: 보라매공원"
                      onChange={(event) => updateCourtDraft({ name: event.target.value, buildingName: "" })}
                      onBlur={(event) => updateCourtDraft({ name: normalizeCourtFacilityName(event.target.value), buildingName: "" })}
                    />
                  </label>
                  <label>
                    코트 구분 {courtRequiresUnit ? "(필수)" : "(선택)"}
                    <input value={courtDraft.courtUnit} placeholder="예: 1코트, B코트, 실내" onChange={(event) => updateCourtDraft({ courtUnit: event.target.value })} />
                  </label>
                </div>
                <div className="settings-place-name-actions">
                  <small>핀 주소의 시군구와 시설명을 합쳐 `시군구 + 시설명 + 농구장`으로 저장합니다.</small>
                  {courtDraft.buildingName ? <small>주소 건물명 `{courtDraft.buildingName}` 자동 반영 · 직접 수정하면 수동 시설명을 사용</small> : null}
                </div>
                {courtDisplayName ? (
                  <div className="arena-mini-note">
                    <div>
                      <span>저장 구장명</span>
                      <strong>{courtDisplayName}</strong>
                      <em>시군구·시설/장소명·코트 구분으로 자동 생성 · 해시태그 자동 부여</em>
                    </div>
                    <MapPin size={18} />
                  </div>
                ) : null}
                {courtPinConfirmed && courtNearbyCandidates.length ? (
                  <div className="arena-mini-note arena-mini-note-warning settings-nearby-courts">
                    <div className="settings-nearby-courts-head">
                      <div>
                        <span>근처 등록·검토 중 구장</span>
                        <strong>{courtNearbyCandidates.length}개 확인</strong>
                      </div>
                      <MapPin size={18} />
                    </div>
                    <div className="settings-nearby-court-list">
                      {courtNearbyCandidates.map((item) => (
                        <div key={`${item.type}:${item.court?.id ?? item.court?.name}`}>
                          <span>
                            <b>{item.court?.name ?? "구장"}</b>
                            <small>{item.court?.addressText || item.court?.roadAddress || item.court?.jibunAddress || "주소 미확인"}</small>
                          </span>
                          <em>{item.type === "approved" ? "등록됨" : "검토 중"} · {item.sameLocation ? "같은 장소" : formatCourtDistance(item.distanceMeters)}</em>
                        </div>
                      ))}
                    </div>
                    {courtRequiresUnit ? <small>같은 장소 후보가 있습니다. 실제로 다른 코트라면 코트 구분을 입력해 주세요.</small> : null}
                    <label className="settings-nearby-confirm">
                      <input type="checkbox" checked={courtNearbyConfirmed} onChange={(event) => setCourtNearbyConfirmed(event.target.checked)} />
                      <span>위 구장과 중복이 아닌지 확인했습니다.</span>
                    </label>
                  </div>
                ) : null}
                {courtAddressSelected ? (
                  <div className="arena-mini-note">
                    <div>
                      <span>{courtPinConfirmed ? "핀 기준 실제 주소" : "검색 기준 주소"}</span>
                      <strong>{courtDraft.addressText}</strong>
                      <em>{courtPinConfirmed ? "지도 위치와 주소를 확인했습니다." : naverMapKeyReady ? "지도 핀으로 최종 주소를 확정해 주세요." : "지도 기능을 준비 중입니다."}</em>
                    </div>
                    <MapPin size={18} />
                  </div>
                ) : null}
                <label>
                  상세주소
                  <input value={courtDraft.detailAddress} placeholder="예: 체육관 B1, 남문 출입구" onChange={(event) => updateCourtDraft({ detailAddress: event.target.value })} />
                </label>
                {courtDuplicate ? (
                  <div className="arena-mini-note arena-mini-note-warning">
                    <div>
                      <span>중복 확인</span>
                      <strong>{courtDuplicate.court?.name ?? "기존 구장"}</strong>
                      <em>{courtDuplicateMessage}</em>
                    </div>
                    <MapPin size={18} />
                  </div>
                ) : null}
                <div className="form-grid two">
                  <label>
                    유형
                    <select
                      value={courtDraft.type}
                      onChange={(event) => updateCourtDraft({
                        type: event.target.value,
                        ...(event.target.value === "야외" ? {} : { lighting: null }),
                      })}
                    >
                      {COURT_TYPE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    구장 분류
                    <select value={courtDraft.courtKind} onChange={(event) => updateCourtDraft({ courtKind: event.target.value })}>
                      {COURT_KIND_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="form-grid two">
                  <label>
                    바닥
                    <select value={courtDraft.surfaceType} onChange={(event) => updateCourtDraft({ surfaceType: event.target.value })}>
                      {COURT_SURFACE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    코트 형태
                    <select value={courtDraft.courtLayout} onChange={(event) => updateCourtDraft({ courtLayout: event.target.value })}>
                      {COURT_LAYOUT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="arena-mini-note">
                  <div>
                    <span>구장 속성</span>
                    <strong>{getCourtSurfaceLabel(courtDraft)} · {getCourtLayoutLabel(courtDraft)}</strong>
                    <em>{courtDraft.type} · {getCourtKindLabel(courtDraft)} · {getCourtAccessLabel(courtDraft)} · 공개 여부 {getCourtPublicAccessLabel(courtDraft)} · {getCourtPaidLabel(courtDraft)}</em>
                  </div>
                  <MapPin size={18} />
                </div>
                <div className="form-grid two">
                  <label>
                    이용 방식
                    <select value={courtDraft.accessType} onChange={(event) => updateCourtDraft({ accessType: event.target.value })}>
                      {COURT_ACCESS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    공개 여부
                    <select value={courtDraft.publicAccess} onChange={(event) => updateCourtDraft({ publicAccess: event.target.value })}>
                      {COURT_PUBLIC_ACCESS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <label>
                  비용
                  <select
                    value={courtDraft.paid === true ? "paid" : courtDraft.paid === false ? "free" : "unknown"}
                    onChange={(event) => updateCourtDraft({
                      paid: COURT_COST_OPTIONS.find((option) => option.id === event.target.value)?.value ?? null,
                    })}
                  >
                    {COURT_COST_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <small>실제 이용 권한을 아는 경우에만 공개 또는 비공개를 선택해 주세요. 지도만으로는 추정하지 않습니다.</small>
                {courtDraft.type === "야외" ? (
                  <label>
                    야간 조명
                    <select
                      value={courtDraft.lighting === true ? "yes" : courtDraft.lighting === false ? "no" : "unknown"}
                      onChange={(event) => updateCourtDraft({
                        lighting: COURT_LIGHTING_OPTIONS.find((option) => option.id === event.target.value)?.value ?? null,
                      })}
                    >
                      {COURT_LIGHTING_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                ) : null}
                <label>
                  공식 안내/예약 링크 (선택)
                  <input
                    type="url"
                    inputMode="url"
                    maxLength={COURT_SOURCE_URL_MAX_LENGTH}
                    value={courtDraft.sourceUrl}
                    placeholder="https://..."
                    aria-invalid={courtSourceUrlInvalid || undefined}
                    onChange={(event) => updateCourtDraft({ sourceUrl: event.target.value })}
                  />
                  <small>{courtSourceUrlInvalid ? "https:// 주소만 입력할 수 있습니다." : "공식 시설 안내나 예약 페이지가 있을 때만 입력해 주세요."}</small>
                </label>
                <label>
                  찾아가는 메모
                  <textarea value={courtDraft.locationNote} placeholder="예: 나들목 지나 오른쪽 두 번째 골대" onChange={(event) => updateCourtDraft({ locationNote: event.target.value })} />
                </label>
                <Button type="submit" variant="secondary" disabled={!canSubmitCourtRequest || !courtDisplayName || !courtAddressSelected || !courtHasMapPin || !courtPinConfirmed}>
                  <Send size={16} /> 등록요청
                </Button>
              </form>
            ) : null}
            <div className="compact-list">
              {courtRequests.slice(0, 4).map((request) => {
                const requester = userMap[request.requestedBy];
                const alreadyReported = app.state.reports?.some((report) => (
                  report.type === "court_request" &&
                  report.targetId === request.id &&
                  report.by === app.currentUserId &&
                  report.status !== "dismissed"
                ));
                const canReportRequest = request.requestedBy !== app.currentUserId
                  && ["pending", "reported"].includes(request.status ?? "pending")
                  && !alreadyReported;
                return (
                  <div key={request.id}>
                    <span>{request.name} · {request.addressText} · 공개 여부 {getCourtPublicAccessLabel(request)} · {requester?.name ?? "요청자"} 신뢰도 {request.requestedByTrustScore ?? requester?.trustScore ?? "-"}</span>
                    <strong>{getAdminStatusLabel(request.status)}</strong>
                    <button type="button" disabled={!canReportRequest} onClick={() => reportCourtRequest(request)}>
                      {alreadyReported ? "신고됨" : "신고 선택"}
                    </button>
                  </div>
                );
              })}
              {!courtRequests.length ? <div className="settings-court-empty"><span>요청한 구장이 없습니다.</span></div> : null}
            </div>
          </Card>

          <Card className="section-card settings-report-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">신고</p>
                <h2>신고 접수</h2>
              </div>
              <Badge tone={app.state.reports?.length ? "orange" : "neutral"}>{app.state.reports?.length ?? 0}건</Badge>
            </div>
            <form className="form-stack" onSubmit={submitReport}>
              <label>
                사유
                <select
                  value={reportReason}
                  onChange={(event) => {
                    setReportReason(event.target.value);
                    setReportTargetQuery("");
                    setReportMatchId("");
                    setReportCourtRequestId("");
                    setReportCourtId("");
                    setReportCourtReviewId("");
                    setReportTeamId("");
                    setReportRemoteTarget(null);
                    setReportedUserIds([]);
                  }}
                >
                  <option value="">신고 사유 선택</option>
                  {REPORT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              {reportReason ? (
                <div className="settings-address-search report-target-search">
                  <label>
                    {getReportTargetLabel(reportTargetType)}
                    <SearchPicker
                      value={reportTargetQuery}
                      onChange={changeReportTargetQuery}
                      placeholder={getReportTargetPlaceholder(reportTargetType)}
                      items={reportTargetSearchItems}
                      idleItems={reportTargetSearchItems}
                      remoteSearchType={reportRemoteSearchTypes}
                      remoteLimit={12}
                      mapRemoteItem={mapRemoteReportTarget}
                      idleTitle="선택 가능한 대상"
                      emptyText={reportNeedsMatchData && reportMatchesLoading
                        ? "신고 가능한 경기 확인 중"
                        : reportMatchesError || getReportTargetEmptyText(reportTargetType)}
                      showIdleOnFocus
                      fieldClassName="admin-account-search"
                      renderItem={renderReportTargetSearchItem}
                    />
                  </label>
                  <small>
                    {reportTargetType === REPORT_TARGET_TYPES.courtRequest
                      ? "허위 구장 등록은 타인의 검토 대기·신고 상태 등록요청만 표시됩니다."
                      : reportTargetType === REPORT_TARGET_TYPES.court
                        ? "승인된 구장 중 위치·상태·중복 확인이 필요한 대상만 선택합니다."
                        : reportTargetType === REPORT_TARGET_TYPES.courtReview
                          ? "내가 작성하지 않은 구장 리뷰만 신고할 수 있습니다."
                          : reportTargetType === REPORT_TARGET_TYPES.teamName
                            ? "내가 팀장인 팀은 신고할 수 없습니다."
                            : reportTargetType === REPORT_TARGET_TYPES.teamEmblem
                              ? "사용자가 올린 사진 엠블럼만 신고할 수 있습니다."
                              : reportTargetType === REPORT_TARGET_TYPES.mixed
                                ? "경기는 최근 7일 내 내 경기만, 구장과 리뷰는 신고 가능한 공개 대상만 검색됩니다."
                                : isVoidRestoreReport
                                  ? "최근 7일 안에 무효 처리됐고 내가 복구 요청할 수 있는 경기만 표시됩니다."
                                  : "최근 7일 내 내가 출전했거나 후보로 등록된 경기 안에서만 검색됩니다."}
                  </small>
                </div>
              ) : (
                <div className="ui-empty-state-compact">신고 사유를 먼저 선택해 주세요.</div>
              )}
              {selectedReportCourt ? (
                <div className="arena-mini-note">
                  <div>
                    <span>선택 구장</span>
                    <strong>{selectedReportCourt.name}</strong>
                    <em>{selectedReportCourt.addressText || "주소 미정"}</em>
                  </div>
                  <MapPin size={18} />
                </div>
              ) : null}
              {selectedReportCourtReview ? (
                <div className="arena-mini-note">
                  <div>
                    <span>선택 리뷰</span>
                    <strong>{selectedReportCourtReview.courtName || "구장 리뷰"}</strong>
                    <em>{selectedReportCourtReview.rating ?? "-"}점 · {userMap[selectedReportCourtReview.reviewerId]?.name ?? "작성자"}</em>
                  </div>
                  <MapPin size={18} />
                </div>
              ) : null}
              {selectedReportMatch ? (
                <div className="arena-mini-note">
                  <div>
                    <span>선택 경기기록</span>
                    <strong>{getMatchReportTitle(selectedReportMatch)}</strong>
                    <em>{getMatchHashtag(selectedReportMatch)} · {selectedReportMatch.court || "구장 미정"}</em>
                  </div>
                  <Database size={18} />
                </div>
              ) : null}
              {selectedReportCourtRequest ? (
                <div className="arena-mini-note">
                  <div>
                    <span>선택 구장요청</span>
                    <strong>{selectedReportCourtRequest.name}</strong>
                    <em>{selectedReportCourtRequest.addressText || "주소 미정"}</em>
                  </div>
                  <MapPin size={18} />
                </div>
              ) : null}
              {selectedReportTeam ? (
                <div className="arena-mini-note report-team-note">
                  <div>
                    <span>선택 팀</span>
                    <strong>{selectedReportTeam.name}</strong>
                    <em>{selectedReportTeam.region || "지역 미정"} · {selectedReportTeam.homeCourt || "홈코트 미정"}</em>
                    {reportTargetType === REPORT_TARGET_TYPES.teamEmblem && !selectedTeamHasUploadedEmblem ? <small>사진 엠블럼을 사용 중인 팀만 신고할 수 있습니다.</small> : null}
                  </div>
                  <TeamEmblem team={selectedReportTeam} size="sm" />
                </div>
              ) : null}
              {selectedReportMatch && reportTargetType !== REPORT_TARGET_TYPES.match ? (
                <div className="report-player-picker">
                  <span>신고 대상</span>
                  <div>
                    {reportParticipantRows.map((row) => {
                      const checked = selectedReportedUserIds.includes(row.userId);
                      return (
                        <button key={row.userId} type="button" className={checked ? "selected" : ""} onClick={() => toggleReportedUser(row.userId)}>
                          <ProfileEmblem user={row.user} className="small" />
                          <span className="report-player-info">
                            <strong>{row.user.name}</strong>
                            <em>{row.sideLabel} · {row.teamName} · {row.role} · {row.user.position}</em>
                            <small>{formatStatLine(row.stats)}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <small>{reportTargetType === REPORT_TARGET_TYPES.player ? "플레이어 신고는 한 번에 한 명만 선택합니다." : "선택하지 않으면 경기 기록 전체 신고로 접수됩니다."}</small>
                </div>
              ) : null}
              <label>
                상세 메모
                <textarea
                  value={reportMemo}
                  minLength={isVoidRestoreReport ? 10 : undefined}
                  placeholder={isVoidRestoreReport ? "복구가 필요한 이유를 10자 이상 적어 주세요." : "상황을 짧게 적어 주세요."}
                  onChange={(event) => setReportMemo(event.target.value)}
                />
                {isVoidRestoreReport ? <small>{reportMemo.trim().length}/10자 이상</small> : null}
              </label>
              <Button type="submit" variant="secondary" disabled={!canSubmitReport || reportSubmitPending}>{reportSubmitPending ? "저장 중" : "신고 접수"}</Button>
              {reportSubmitStatus ? <small role="status">{reportSubmitStatus}</small> : null}
            </form>
            <div className="compact-list">
              {app.state.reports?.slice(0, 4).map((report) => (
                <div key={report.id}>
                  <span>{
                    report.type === "court_request"
                      ? courtRequests.find((request) => request.id === report.targetId)?.name ?? "구장 등록요청"
                      : report.type === "court"
                        ? approvedCourts.find((court) => court.id === report.targetId)?.name ?? "구장"
                      : report.type === "court_review"
                          ? courtReviews.find((review) => review.id === report.targetId)?.courtName ?? "구장 리뷰"
                          : report.type === "team_name" || report.type === "team_emblem"
                            ? app.state.teams.find((team) => team.id === report.targetId)?.name ?? report.teamName ?? "팀"
                          : report.type === "player"
                            ? userMap[report.targetId]?.name ?? "플레이어"
                          : matchMap[report.targetId]
                            ? `${getMatchHashtag(matchMap[report.targetId])} ${matchMap[report.targetId].title ?? "경기"}`
                            : "경기"
                  } · {report.reason}</span>
                  <strong>{getAdminStatusLabel(report.status)}</strong>
                </div>
              ))}
            </div>
          </Card>

        </aside>
      </div>

      <Card className="section-card settings-referee-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Referee</p>
                <h2>심판 등록요청</h2>
              </div>
              <ShieldCheck size={22} />
            </div>
            <div className="referee-rulebook-panel compact">
              <div className="referee-rulebook-head">
                <div>
                  <span className="eyebrow">Study guide</span>
                  <strong>커뮤니티 심판 룰북</strong>
                  <p>문제 원문은 숨기고 판정 기준, 개인활약 기록 기준, 상황 예시만 따로 정리했다.</p>
                </div>
                <Badge tone="blue">학습자료</Badge>
              </div>
              <Button as={Link} variant="secondary" to="/app/referee-rulebook">
                <BookOpen size={16} /> 룰북 보기
              </Button>
            </div>
            {canOpenRefereeRequestForm ? (
              <>
                <div className="referee-exam-panel">
                  <div className="referee-exam-summary">
                    <span><strong>{REFEREE_EXAM_BANK_SIZE}</strong>문제은행</span>
                    <span><strong>{REFEREE_EXAM_SIZE}</strong>문항</span>
                    <span><strong>{REFEREE_EXAM_PASS_SCORE}</strong>점 통과</span>
                  </div>
                  <p className={`referee-exam-lock ${refereeExamLocked ? "locked" : ""}`}>
                    {refereeExamLocked
                      ? `주 1회 제한 중 · 다음 응시 가능 ${refereeExamLockLabel}`
                      : `시험 시작 후 ${REFEREE_EXAM_COOLDOWN_DAYS}일 동안 재응시할 수 없습니다.`}
                  </p>
                  {refereeExamNotice ? <p className="referee-exam-lock locked">{refereeExamNotice}</p> : null}
                  <div className="referee-exam-actions">
                    <Button type="button" variant="secondary" onClick={startRefereeExam} disabled={refereeExamLocked || (refereeExamOpen && !refereeExamResult)}>
                      {refereeExamOpen && !refereeExamResult ? "시험 진행 중" : "심판 시험 시작"}
                    </Button>
                    {refereeExamResult ? (
                      <Badge tone={refereeExamResult.passed ? "green" : "orange"}>
                        {refereeExamResult.score}/{refereeExamResult.total} · {refereeExamResult.passed ? "통과" : "미통과"}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">{answeredRefereeExamCount}/{REFEREE_EXAM_SIZE}</Badge>
                    )}
                  </div>
                  {refereeExamOpen ? (
                    <div className="referee-exam-list">
                      {refereeExamQuestions.map((question) => (
                        <div key={question.id} className="referee-exam-question">
                          <strong>{question.number}. {question.stem}</strong>
                          <div className="referee-exam-choice-grid">
                            {question.choices.map((choice, index) => {
                              const review = refereeExamResult?.reviewedById?.[question.id];
                              const selected = refereeExamAnswers[question.id] === index;
                              const checked = Boolean(refereeExamResult);
                              const correct = checked && review?.answerIndex === index;
                              const wrong = checked && selected && review?.answerIndex !== index;
                              return (
                                <button
                                  key={choice}
                                  type="button"
                                  className={`${selected ? "selected" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}
                                  onClick={() => selectRefereeExamAnswer(question.id, index)}
                                >
                                  {choice}
                                </button>
                              );
                            })}
                          </div>
                          {refereeExamResult ? <small>{refereeExamResult.reviewedById?.[question.id]?.explanation}</small> : null}
                        </div>
                      ))}
                      <Button type="button" onClick={submitRefereeExam} disabled={answeredRefereeExamCount < REFEREE_EXAM_SIZE || Boolean(refereeExamResult)}>
                        채점하기
                      </Button>
                    </div>
                  ) : null}
                </div>
                <form className="form-stack" onSubmit={submitRefereeRequest}>
                  <label>
                    신청 유형
                    <select value={refereeDraft.qualification} onChange={(event) => updateRefereeDraft({ qualification: event.target.value })}>
                      <option value="community_exam">커뮤니티 심판 시험</option>
                      <option value="official_license">정식 라이선스 보유</option>
                    </select>
                  </label>
                  <label>
                    심판 경험
                    <input value={refereeDraft.experience} placeholder="예: 동호회 20경기, 학교대회 5경기" onChange={(event) => updateRefereeDraft({ experience: event.target.value })} />
                  </label>
                  <label>
                    메모
                    <textarea value={refereeDraft.memo} placeholder="자격증, 활동 지역, 가능한 시간 등을 적어 주세요." onChange={(event) => updateRefereeDraft({ memo: event.target.value })} />
                  </label>
                  <Button type="submit" variant="secondary" disabled={refereeExamRequired && !refereeExamPassed}>
                    <Send size={16} /> 심판 등록요청
                  </Button>
                  {refereeExamRequired && !refereeExamPassed ? <small>커뮤니티 심판은 시험 통과 후 등록요청할 수 있습니다.</small> : null}
                </form>
                <div className="compact-list">
                  {refereeRequests.slice(0, 4).map((request) => (
                    <div key={request.id}>
                      <span>
                        {request.qualification === "official_license" ? "정식 라이선스" : "커뮤니티 시험"} · 신뢰도 {request.trustScore}
                        {request.examTotal ? ` · 시험 ${request.examScore}/${request.examTotal}` : ""}
                      </span>
                      <strong>{getAdminStatusLabel(request.status)}</strong>
                    </div>
                  ))}
                  {!refereeRequests.length ? <div><span>요청한 심판 등록이 없습니다.</span><strong>신뢰도 {app.currentUser?.trustScore ?? 0}</strong></div> : null}
                </div>
              </>
            ) : (
              <div className="tier-range-note tier-range-note-warning">
                <div>
                  <span>시험 제한</span>
                  <strong>신뢰도 {REFEREE_TRUST_MIN}점 이상 필요</strong>
                  <em>현재 신뢰도 {currentTrustScore}점입니다. 룰북은 누구나 볼 수 있습니다.</em>
                </div>
                <ShieldCheck size={18} />
              </div>
            )}
      </Card>
    </div>
  );
}
