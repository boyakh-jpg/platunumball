import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Database, MapPin, MessageCircle, Moon, Send, ShieldCheck, Star, Sun, Unlink2, UserRound } from "lucide-react";
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
import { REPORT_REASONS, REPORT_TARGET_TYPES, getReportTargetType } from "../lib/reportReasons.js";
import { formatKoreanDateTime, formatStatLine, getMatchReservePlayerIds, getMatchScheduledDate, getMatchSidePlayerIds, isEligibleReferee } from "../lib/matchUtils.js";
import { COURT_REQUEST_TRUST_MIN, REFEREE_TRUST_MIN, REGIONS } from "../lib/constants.js";
import { COURT_LAYOUT_OPTIONS, COURT_SURFACE_OPTIONS, findCourtDuplicate, getCourtCanonicalName, getCourtDuplicateMessage, getCourtLayoutLabel, getCourtLocationMatches, getCourtSurfaceLabel, getRegisteredCourts } from "../lib/courts.js";
import { getCourtHashtag, getMatchHashtag, getTeamHashtag, getUserHashtag } from "../lib/handles.js";
import { getNaverMapClientId, openNaverMapPinPicker, searchNaverAddresses } from "../lib/naverAddress.js";
import { hasAdminAccess } from "../lib/admin.js";
import {
  DISCORD_NOTIFICATION_EVENTS,
  consumeDiscordOAuthResult,
  findDiscordConnectionOwner,
  getDiscordAvatarClassName,
  getDiscordAvatarStyle,
  getDiscordChannel,
  getDiscordDisplayName,
  getDiscordOAuthStartUrl,
  getDiscordProfileUrl,
  isDiscordLinked,
} from "../lib/discord.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import "../styles/recruiting-arena.css";

const REPORT_MATCH_WINDOW_DAYS = 7;
const REFEREE_EXAM_COOLDOWN_DAYS = 7;
const REFEREE_EXAM_VERSION = "rankball-referee-2026-06";
const REFEREE_EXAM_SIZE = 30;
const REFEREE_EXAM_PASS_SCORE = 24;
const REFEREE_EXAM_BANK_SIZE = 600;
const DEFAULT_COURT_REQUEST = {
  name: "",
  buildingName: "",
  courtUnit: "",
  region: "",
  type: "야외",
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
  courtKind: "street_hoop",
  surfaceType: "asphalt",
  courtLayout: "half",
  paid: false,
};
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
const AUTH_PROVIDER_LABELS = {
  google: "Google",
  kakao: "Kakao",
  naver: "Naver",
  test: "Test",
};

function getPrivacyDraft(privacy = {}) {
  return {
    regionRanking: privacy.regionRanking !== false,
    teamHistory: privacy.teamHistory !== false,
    statSummary: privacy.statSummary !== false,
  };
}

function getAuthSessionLabel(authUser = null) {
  if (!authUser) return "Guest";
  const providerName = authUser.user_metadata?.providerName;
  if (providerName) return providerName;
  const provider = String(authUser.app_metadata?.provider ?? "").trim().toLowerCase();
  if (provider) return AUTH_PROVIDER_LABELS[provider] ?? provider;
  return authUser.email ?? "Supabase";
}

function getMatchReportTime(match = {}) {
  const rawDate = match.endedAt ?? match.confirmedAt ?? match.scheduledDate ?? match.scheduledAt ?? match.createdAt;
  if (!rawDate) return 0;
  if (match.scheduledDate && rawDate === match.scheduledDate) {
    return getMatchScheduledDate(match)?.getTime() ?? 0;
  }
  const value = new Date(rawDate).getTime();
  return Number.isFinite(value) ? value : 0;
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
  if (targetType === REPORT_TARGET_TYPES.courtRequest) return "구장/요청 검색";
  if (targetType === REPORT_TARGET_TYPES.court) return "구장 검색";
  if (targetType === REPORT_TARGET_TYPES.courtReview) return "구장 리뷰 검색";
  return "신고 대상 검색";
}

function getReportTargetPlaceholder(targetType) {
  if (targetType === REPORT_TARGET_TYPES.player) return "선수명, 포지션, 경기, #경기기록 검색";
  if (targetType === REPORT_TARGET_TYPES.match) return "경기명, 팀명, 구장, #경기기록 검색";
  if (targetType === REPORT_TARGET_TYPES.courtRequest) return "구장명, 주소, #구장 검색";
  if (targetType === REPORT_TARGET_TYPES.court) return "구장명, 주소, #구장 검색";
  if (targetType === REPORT_TARGET_TYPES.courtReview) return "구장명, 리뷰, 경기, #구장 검색";
  return "선수, 경기, 구장, 해시태그 검색";
}

function getReportTargetEmptyText(targetType) {
  if (targetType === REPORT_TARGET_TYPES.courtRequest) return "신고 가능한 구장/요청 없음";
  if (targetType === REPORT_TARGET_TYPES.court) return "신고 가능한 구장 없음";
  if (targetType === REPORT_TARGET_TYPES.courtReview) return "신고 가능한 구장 리뷰 없음";
  if (targetType === REPORT_TARGET_TYPES.player) return "신고 가능한 선수 없음";
  return "신고 가능한 대상 없음";
}

export default function Settings({ app, auth, section = "main" }) {
  const loadDirectory = app.actions.loadDirectory;
  const loadAdminContext = app.actions.loadAdminContext;
  useEffect(() => {
    loadDirectory?.({ kind: "self", limit: 30, offset: 0 });
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
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
  const [blockUserId, setBlockUserId] = useState(app.state.users.find((user) => user.id !== app.currentUserId)?.id ?? "");
  const [blockSavePending, setBlockSavePending] = useState(false);
  const [reportMatchId, setReportMatchId] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [reportTargetQuery, setReportTargetQuery] = useState("");
  const [reportCourtRequestId, setReportCourtRequestId] = useState("");
  const [reportCourtId, setReportCourtId] = useState("");
  const [reportCourtReviewId, setReportCourtReviewId] = useState("");
  const [reportMemo, setReportMemo] = useState("");
  const [reportedUserIds, setReportedUserIds] = useState([]);
  const [reportMatchesLoading, setReportMatchesLoading] = useState(false);
  const [reportMatchesError, setReportMatchesError] = useState("");
  const reportMatchesLoadRef = useRef("");
  const [accountQuery, setAccountQuery] = useState("");
  const [favoriteQuery, setFavoriteQuery] = useState("");
  const [favoriteListType, setFavoriteListType] = useState("");
  const [courtAddressQuery, setCourtAddressQuery] = useState("");
  const [naverAddressResults, setNaverAddressResults] = useState([]);
  const [courtLookupStatus, setCourtLookupStatus] = useState("");
  const [courtPinConfirmed, setCourtPinConfirmed] = useState(false);
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
  const canOpenAdminMenu = serverAdminLevel >= 30 || hasAdminAccess(app.currentUser, app.state.settings);
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
  const courtRequiresUnit = courtLocationMatches.length > 0;
  const courtDuplicate = useMemo(
    () => findCourtDuplicate({ ...courtDraft, name: courtDisplayName || courtDraft.name }, app.state),
    [app.state, courtDisplayName, courtDraft],
  );
  const courtDuplicateMessage = getCourtDuplicateMessage(courtDuplicate);
  const canOpenCourtRequestForm = currentTrustScore >= COURT_REQUEST_TRUST_MIN;
  const canSubmitCourtRequest = canOpenCourtRequestForm && !courtDuplicate && (!courtRequiresUnit || Boolean(courtDraft.courtUnit.trim()));
  const canOpenRefereeRequestForm = currentTrustScore >= REFEREE_TRUST_MIN;
  const [currentRefereeExamAttemptId, setCurrentRefereeExamAttemptId] = useState("");
  const [refereeExamNotice, setRefereeExamNotice] = useState("");

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
    const discordOAuthResult = consumeDiscordOAuthResult(app.currentUserId);
    if (!discordOAuthResult) return;
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
    let active = true;
    const persistDiscordConnection = async () => {
      try {
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
    const cutoff = now - REPORT_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return [...app.state.matches]
      .map((match) => ({ match, reportTime: getMatchReportTime(match) }))
      .filter(({ match, reportTime }) => (
        reportTime >= cutoff &&
        reportTime <= now &&
        getReportParticipantRows(match, userMap).some((row) => row.userId === app.currentUserId)
      ))
      .sort((a, b) => b.reportTime - a.reportTime)
      .map(({ match }) => match);
  }, [app.currentUserId, app.state.matches, userMap]);
  const reportTargetType = reportReason ? getReportTargetType(reportReason) : "";
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
      setReportMatchesError("신고 가능한 경기를 불러오지 못했습니다.");
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
      return request.requestedBy !== app.currentUserId && request.status !== "approved" && !alreadyReported;
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
  const selectedReportMatchId = recentReportMatches.some((match) => match.id === reportMatchId) ? reportMatchId : "";
  const selectedReportMatch = recentReportMatches.find((match) => match.id === selectedReportMatchId) ?? null;
  const selectedReportCourtRequest = reportableCourtRequests.find((request) => request.id === reportCourtRequestId) ?? null;
  const selectedReportCourt = reportableCourts.find((court) => court.id === reportCourtId) ?? null;
  const selectedReportCourtReview = reportableCourtReviews.find((review) => review.id === reportCourtReviewId) ?? null;
  const reportParticipantRows = useMemo(
    () => (selectedReportMatch && reportTargetType !== REPORT_TARGET_TYPES.courtRequest ? getReportParticipantRows(selectedReportMatch, userMap) : []),
    [reportTargetType, selectedReportMatch, userMap],
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
    const includeCourts = reportTargetType === REPORT_TARGET_TYPES.court || reportTargetType === REPORT_TARGET_TYPES.courtRequest || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const includeCourtReviews = reportTargetType === REPORT_TARGET_TYPES.courtReview || reportTargetType === REPORT_TARGET_TYPES.mixed;
    const items = [];

    if (includeMatches) {
      recentReportMatches.forEach((match) => {
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
      recentReportMatches.forEach((match) => {
        const matchHashtag = getMatchHashtag(match);
        getReportParticipantRows(match, userMap).forEach((row) => {
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

    return items.filter((item) => (keyword ? item.haystack.includes(keyword) : true));
  }, [matchMap, recentReportMatches, reportReason, reportTargetQuery, reportTargetType, reportableCourtRequests, reportableCourtReviews, reportableCourts, userMap]);
  const canSubmitReport = Boolean(reportReason) && (
    reportTargetType === REPORT_TARGET_TYPES.courtRequest
      ? Boolean(selectedReportCourtRequest || selectedReportCourt)
      : reportTargetType === REPORT_TARGET_TYPES.court
        ? Boolean(selectedReportCourt)
        : reportTargetType === REPORT_TARGET_TYPES.courtReview
          ? Boolean(selectedReportCourtReview)
      : reportTargetType === REPORT_TARGET_TYPES.player
        ? Boolean(selectedReportMatch && selectedReportedUserIds.length)
        : Boolean(selectedReportMatch || selectedReportCourtRequest || selectedReportCourt || selectedReportCourtReview)
  );
  const matchCountByUser = useMemo(() => {
    const counts = new Map();
    app.state.matches.forEach((match) => {
      [...(match.teamA?.players ?? []), ...(match.teamB?.players ?? [])].forEach((userId) => {
        counts.set(userId, (counts.get(userId) ?? 0) + 1);
      });
    });
    return counts;
  }, [app.state.matches]);
  const testAccounts = useMemo(
    () => app.state.users.filter((user) => user.testLoginId),
    [app.state.users],
  );
  const visibleTestAccounts = useMemo(() => {
    const keyword = accountQuery.trim().toLowerCase();
    return testAccounts
      .filter((user) => (
        keyword
          ? `${user.name} ${getUserHashtag(user)} ${user.region} ${user.position} ${user.testLoginId}`.toLowerCase().includes(keyword)
          : true
      ))
      .slice(0, 12);
  }, [accountQuery, testAccounts]);
  const averageMatches = testAccounts.length
    ? Math.round(testAccounts.reduce((sum, user) => sum + (matchCountByUser.get(user.id) ?? 0), 0) / testAccounts.length)
    : 0;
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
  const renderAccountSearchItem = (user) => (
    <button
      key={user.id}
      type="button"
      className={user.id === app.currentUserId ? "search-picker-result-row selected" : "search-picker-result-row"}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => app.actions.switchUser(user.id)}
    >
      <strong>{user.name}</strong>
      <span>{user.testLoginId} · {user.region} · {matchCountByUser.get(user.id) ?? 0}경기</span>
      <em>{user.position}</em>
    </button>
  );
  const selectReportTarget = (item) => {
    setReportTargetQuery(`${item.title} ${item.meta ?? ""}`.trim());
    if (item.kind === "court_request") {
      setReportCourtRequestId(item.request.id);
      setReportCourtId("");
      setReportCourtReviewId("");
      setReportMatchId("");
      setReportedUserIds([]);
      return;
    }
    if (item.kind === "court") {
      setReportCourtId(item.court.id);
      setReportCourtRequestId("");
      setReportCourtReviewId("");
      setReportMatchId("");
      setReportedUserIds([]);
      return;
    }
    if (item.kind === "court_review") {
      setReportCourtReviewId(item.review.id);
      setReportCourtId("");
      setReportCourtRequestId("");
      setReportMatchId("");
      setReportedUserIds([]);
      return;
    }
    setReportCourtRequestId("");
    setReportCourtId("");
    setReportCourtReviewId("");
    setReportMatchId(item.match.id);
    setReportedUserIds(item.kind === "player" ? [item.row.userId] : []);
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
  const submitReport = (event) => {
    event.preventDefault();
    if (!canSubmitReport) return;
    const memo = reportMemo.trim();
    if (selectedReportCourtRequest) {
      app.actions.reportCourtRequest(selectedReportCourtRequest.id, [reportReason, memo].filter(Boolean).join(" · "));
      setReportCourtRequestId("");
      setReportCourtId("");
      setReportCourtReviewId("");
      setReportTargetQuery("");
      setReportMemo("");
      return;
    }
    if (selectedReportCourt) {
      app.actions.reportCourt(selectedReportCourt.id, [reportReason, memo].filter(Boolean).join(" · "));
      setReportCourtRequestId("");
      setReportCourtId("");
      setReportCourtReviewId("");
      setReportTargetQuery("");
      setReportMemo("");
      return;
    }
    if (selectedReportCourtReview) {
      app.actions.reportCourtReview(selectedReportCourtReview.id, [reportReason, memo].filter(Boolean).join(" · "));
      setReportCourtRequestId("");
      setReportCourtId("");
      setReportCourtReviewId("");
      setReportTargetQuery("");
      setReportMemo("");
      return;
    }
    const targetNames = selectedReportedUserIds.map((userId) => userMap[userId]?.name).filter(Boolean);
    const targetLine = targetNames.length ? `대상: ${targetNames.join(", ")}` : "대상: 경기 기록";
    const matchLine = selectedReportMatch ? getMatchHashtag(selectedReportMatch) : "";
    if (selectedReportMatchId) {
      app.actions.reportMatch(selectedReportMatchId, [reportReason, matchLine, targetLine, memo].filter(Boolean).join(" · "), selectedReportedUserIds);
      setReportMatchId("");
      setReportedUserIds([]);
      setReportCourtRequestId("");
      setReportCourtId("");
      setReportCourtReviewId("");
      setReportTargetQuery("");
      setReportMemo("");
    }
  };
  const updateCourtDraft = (patch) => setCourtDraft((current) => ({ ...current, ...patch }));
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
      setCourtLookupStatus(results.length ? `${results.length}개 주소를 찾았습니다. 사용할 주소를 선택하세요.` : "주소 검색 결과가 없습니다.");
    } catch (error) {
      setCourtLookupStatus(error.message || "주소 검색 실패");
    }
  };
  const pickCourtMapPin = async () => {
    if (!naverMapKeyReady) {
      setCourtLookupStatus("지도 핀은 VITE_NAVER_MAP_CLIENT_ID 설정 후 사용할 수 있습니다.");
      return;
    }
    setCourtLookupStatus("실제 구장 위치 선택 중");
    try {
      const pin = await openNaverMapPinPicker(courtDraft);
      const addressDong = getCourtAddressDong(pin);
      const buildingName = String(pin.buildingName || courtDraft.buildingName || courtDraft.name).trim();
      updateCourtDraft({
        name: buildingName,
        buildingName: String(pin.buildingName || courtDraft.buildingName).trim(),
        region: getCourtAddressRegion(pin),
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
      setCourtLookupStatus("핀 위치의 실제 주소를 저장했습니다.");
    } catch (error) {
      setCourtLookupStatus(error.message || "실제 구장 위치 저장 실패");
    }
  };
  const selectNaverAddress = (result) => {
    const addressDong = getCourtAddressDong(result);
    const buildingName = String(result.buildingName || courtDraft.buildingName || courtDraft.name).trim();
    updateCourtDraft({
      name: buildingName,
      buildingName: String(result.buildingName || courtDraft.buildingName).trim(),
      region: getCourtAddressRegion(result),
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
    setCourtLookupStatus("근처 주소를 선택했습니다. 지도 핀으로 실제 구장 위치를 확정하세요.");
  };
  const saveTheme = async (nextTheme = themeDraft) => {
    const requestId = themeSaveRequestRef.current + 1;
    themeSaveRequestRef.current = requestId;
    setThemeSaveStatus("저장 중");
    try {
      const saved = await app.actions.saveTheme?.(nextTheme);
      if (themeSaveRequestRef.current === requestId) setThemeSaveStatus(saved ? "저장됨" : "저장 실패");
      return saved;
    } catch {
      if (themeSaveRequestRef.current === requestId) setThemeSaveStatus("저장 실패");
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
  const savePrivacy = async () => {
    setPrivacySaveStatus("저장 중");
    try {
      const saved = await app.actions.updatePrivacySettings(privacyDraft);
      setPrivacySaveStatus(saved && saved.ok !== false ? "저장됨" : "저장 실패");
    } catch {
      setPrivacySaveStatus("저장 실패");
    }
  };
  const connectDiscord = () => {
    window.location.assign(getDiscordOAuthStartUrl(app.currentUserId));
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
      setDiscordSaveStatus(saved && saved.ok !== false ? "저장됨" : "저장 실패");
    } catch {
      setDiscordSaveStatus("저장 실패");
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
      setCourtLookupStatus("지도 핀으로 실제 구장 위치를 확정하세요.");
      return;
    }
    if (courtDuplicate) {
      setCourtLookupStatus(courtDuplicateMessage);
      return;
    }
    if (!canSubmitCourtRequest) return;
    const requestId = await app.actions.submitCourtRequest(courtDraft);
    if (!requestId) {
      setCourtLookupStatus("구장 등록요청 저장 실패");
      return;
    }
    setCourtAddressQuery("");
    setNaverAddressResults([]);
    setCourtPinConfirmed(false);
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
        ? current.filter((id) => id !== userId)
        : [...current, userId]
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
          <Link className="button button-secondary button-md" to="/app/settings">설정</Link>
        ) : null}
      </header>
      <div className={`content-grid ${settingsSection === "main" ? "" : "settings-section-grid"}`}>
        <div className="page-stack settings-main-column">
          <Card className="section-card settings-data-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">데이터 모드</p>
                <h2>{isSupabaseConfigured ? "Supabase" : "localStorage demo"}</h2>
              </div>
              <Badge tone={isSupabaseConfigured ? "green" : "orange"}>{isSupabaseConfigured ? "연결됨" : "Demo"}</Badge>
            </div>
            <div className="contract-grid single">
              <div>
                <span>저장소</span>
                <strong>{isSupabaseConfigured ? "Cloud" : "Local"}</strong>
              </div>
              <div>
                <span>세션</span>
                <strong>{getAuthSessionLabel(auth?.user)}</strong>
              </div>
            </div>
          </Card>

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

          <Card className="section-card admin-seed-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Admin Seed</p>
                <h2>테스트 리그 DB</h2>
              </div>
              <Database size={22} />
            </div>
            <div className="contract-grid single">
              <div>
                <span>로그인 계정</span>
                <strong>{testAccounts.length}개</strong>
              </div>
              <div>
                <span>경기 데이터</span>
                <strong>{app.state.matches.length}경기</strong>
              </div>
              <div>
                <span>평균 경기</span>
                <strong>{averageMatches}경기/계정</strong>
              </div>
              <div>
                <span>모집방</span>
                <strong>{app.state.recruitingPosts.length}개</strong>
              </div>
            </div>
          </Card>

          <Card className="section-card settings-account-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Admin Login</p>
                <h2>테스트 계정 로그인</h2>
              </div>
              <UserRound size={22} />
            </div>
            {app.profileLocked ? (
              <div className="contract-grid single">
                <div>
                  <span>프로필 고정</span>
                  <strong>{app.currentUser?.name ?? app.currentUserId}</strong>
                </div>
                <div>
                  <span>전환 제한</span>
                  <strong>Google 계정당 1개</strong>
                </div>
              </div>
            ) : (
              <>
                <SearchPicker
                  value={accountQuery}
                  onChange={setAccountQuery}
                  placeholder="이름, 지역, 포지션, rankball-001 검색"
                  items={visibleTestAccounts}
                  idleItems={visibleTestAccounts}
                  idleTitle="테스트 계정"
                  showIdleOnFocus
                  fieldClassName="admin-account-search"
                  renderItem={renderAccountSearchItem}
                />
                <label>
                  전체 계정 선택
                  <select value={app.currentUserId} onChange={(event) => app.actions.switchUser(event.target.value)}>
                    {app.state.users.map((user) => (
                      <option key={user.id} value={user.id}>{user.testLoginId ? `${user.testLoginId} · ` : ""}{user.name} · {user.region} · {user.position}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </Card>

          <Card className="section-card settings-privacy-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">공개 범위</p>
                <h2>프로필 표시</h2>
              </div>
              <ShieldCheck size={22} />
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
            <div className="settings-save-row">
              <small>{privacySaveStatus || (privacyDirty ? "변경 있음" : "저장됨")}</small>
            </div>
          </Card>

          <Card className="section-card settings-unified-save-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Save</p>
                <h2>설정 저장</h2>
              </div>
              <Badge tone={generalSettingsDirty ? "orange" : "neutral"}>{generalSettingsDirty ? "변경 있음" : "저장됨"}</Badge>
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
              <Link className="button button-secondary button-md" to="/app/admin?section=courts">구장 신청 관리 열기</Link>
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
                <strong>{currentTrustScore < COURT_REQUEST_TRUST_MIN ? "등록 제한" : courtDuplicate ? "중복 확인 필요" : "등록 가능"}</strong>
                <em>{courtDuplicateMessage || `신뢰도 ${COURT_REQUEST_TRUST_MIN}점 이상 필요 · 허위 등록은 운영 정책에 따라 신뢰도 차감`}</em>
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
                    공식 시설명
                    <input
                      value={courtDraft.name}
                      readOnly={Boolean(courtDraft.buildingName)}
                      placeholder="핀에서 자동 생성 · 없으면 직접 입력"
                      onChange={(event) => updateCourtDraft({ name: event.target.value })}
                    />
                  </label>
                  <label>
                    코트 구분 {courtRequiresUnit ? "(필수)" : "(선택)"}
                    <input value={courtDraft.courtUnit} placeholder="예: 1코트, B코트, 실내" onChange={(event) => updateCourtDraft({ courtUnit: event.target.value })} />
                  </label>
                </div>
                {courtDisplayName ? (
                  <div className="arena-mini-note">
                    <div>
                      <span>저장 구장명</span>
                      <strong>{courtDisplayName}</strong>
                      <em>공식 시설명과 코트 구분으로 자동 생성 · 해시태그 자동 부여</em>
                    </div>
                    <MapPin size={18} />
                  </div>
                ) : null}
                {courtLocationMatches.length ? (
                  <div className="arena-mini-note arena-mini-note-warning">
                    <div>
                      <span>같은 장소 등록 구장 {courtLocationMatches.length}개</span>
                      <strong>{courtLocationMatches.slice(0, 3).map((item) => item.court?.name).filter(Boolean).join(" · ")}</strong>
                      <em>물리적으로 다른 코트만 추가할 수 있습니다. 코트 구분을 정확히 입력하세요.</em>
                    </div>
                    <MapPin size={18} />
                  </div>
                ) : null}
                {courtAddressSelected ? (
                  <div className="arena-mini-note">
                    <div>
                      <span>{courtPinConfirmed ? "핀 기준 실제 주소" : "검색 기준 주소"}</span>
                      <strong>{courtDraft.addressText}</strong>
                      <em>{courtPinConfirmed ? "핀 좌표 역지오코딩 완료" : naverMapKeyReady ? "지도 핀으로 최종 주소를 확정하세요" : "지도 핀은 VITE_NAVER_MAP_CLIENT_ID 설정 후 사용"}</em>
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
                <label>
                  유형
                  <select value={courtDraft.type} onChange={(event) => updateCourtDraft({ type: event.target.value })}>
                    <option value="야외">야외</option>
                    <option value="실내">실내</option>
                  </select>
                </label>
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
                    <em>반코트/골대 1개도 등록 가능하지만 경기방에서 5v5 경고를 표시합니다.</em>
                  </div>
                  <MapPin size={18} />
                </div>
                <label>
                  찾아가는 메모
                  <textarea value={courtDraft.locationNote} placeholder="예: 나들목 지나 오른쪽 두 번째 골대" onChange={(event) => updateCourtDraft({ locationNote: event.target.value })} />
                </label>
                <div className="settings-toggle-grid">
                  <label>
                    <input
                      type="checkbox"
                      checked={courtDraft.courtKind === "official"}
                      onChange={(event) => updateCourtDraft({ courtKind: event.target.checked ? "official" : "street_hoop" })}
                    />
                    정식구장
                  </label>
                  <label>
                    <input type="checkbox" checked={courtDraft.paid} onChange={(event) => updateCourtDraft({ paid: event.target.checked })} />
                    유료구장
                  </label>
                </div>
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
                const canReportRequest = request.requestedBy !== app.currentUserId && request.status !== "approved" && !alreadyReported;
                return (
                  <div key={request.id}>
                    <span>{request.name} · {request.addressText} · {requester?.name ?? "요청자"} 신뢰도 {request.requestedByTrustScore ?? requester?.trustScore ?? "-"}</span>
                    <strong>{request.status === "pending" ? "대기" : request.status === "reported" ? "신고됨" : request.status}</strong>
                    <button type="button" disabled={!canReportRequest} onClick={() => reportCourtRequest(request)}>
                      {alreadyReported ? "신고됨" : "신고 선택"}
                    </button>
                  </div>
                );
              })}
              {!courtRequests.length ? <div><span>요청한 구장이 없습니다.</span><strong>{registeredCourts.length}개 등록</strong></div> : null}
            </div>
          </Card>

          <Card className="section-card settings-report-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">신고</p>
                <h2>경기 기록 신고</h2>
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
                      onChange={setReportTargetQuery}
                      placeholder={getReportTargetPlaceholder(reportTargetType)}
                      items={reportTargetSearchItems}
                      idleItems={reportTargetSearchItems}
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
                      ? "허위 구장 등록은 신고 가능한 등록요청과 승인 구장만 표시됩니다."
                      : reportTargetType === REPORT_TARGET_TYPES.court
                        ? "승인된 구장 중 위치나 상태 확인이 필요한 대상만 선택합니다."
                        : reportTargetType === REPORT_TARGET_TYPES.courtReview
                          ? "내가 작성하지 않은 구장 리뷰만 신고할 수 있습니다."
                          : "최근 7일 내 내가 출전했거나 후보로 등록된 경기 안에서만 검색됩니다."}
                  </small>
                </div>
              ) : (
                <div className="empty-state">신고 사유를 먼저 선택하세요.</div>
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
                  <small>{reportTargetType === REPORT_TARGET_TYPES.player ? "선수 사유는 신고 대상을 1명 이상 선택해야 합니다." : "선택하지 않으면 경기 기록 전체 신고로 접수됩니다."}</small>
                </div>
              ) : null}
              <label>
                상세 메모
                <textarea value={reportMemo} placeholder="상황을 짧게 적어주세요." onChange={(event) => setReportMemo(event.target.value)} />
              </label>
              <Button type="submit" variant="secondary" disabled={!canSubmitReport}>신고 접수</Button>
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
                          : matchMap[report.targetId]
                            ? `${getMatchHashtag(matchMap[report.targetId])} ${matchMap[report.targetId].title ?? "경기"}`
                            : "경기"
                  } · {report.reason}</span>
                  <strong>{report.status}</strong>
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
              <Link className="button button-secondary button-md" to="/app/referee-rulebook">
                <BookOpen size={16} /> 룰북 보기
              </Link>
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
                    <textarea value={refereeDraft.memo} placeholder="자격증, 활동지역, 가능한 시간 등을 적어주세요." onChange={(event) => updateRefereeDraft({ memo: event.target.value })} />
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
                      <strong>{request.status === "pending" ? "대기" : request.status}</strong>
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
