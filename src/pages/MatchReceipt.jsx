import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, Download, House, ImagePlus, MapPin, RotateCcw, Share2, Trash2 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Button from "../components/common/Button.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import EmblemCropEditor from "../components/common/EmblemCropEditor.jsx";
import CourtMapPicker from "../components/court/CourtMapPicker.jsx";
import MatchReceiptPreview from "../components/match/MatchReceiptPreview.jsx";
import ThermalReceiptPreview from "../components/match/ThermalReceiptPreview.jsx";
import { assetUrl } from "../lib/assets.js";
import { getCourtAddress, getRegisteredCourts, mergeCourtSearchCourts } from "../lib/courts.js";
import { getLoginPath, inferRegionSelection } from "../lib/profileSetup.js";
import { COURT_MAP_SEARCH_LIMIT, COURT_MAP_SEARCH_PURPOSE } from "../lib/queryPolicy.js";
import { postServerAction } from "../lib/serverActions.js";
import { getUserHashtag } from "../lib/handles.js";
import { MATCH_RECEIPT_LINE_ART_AI_PROMPT, createMatchReceiptLineArt } from "../lib/matchReceiptEmblem.js";
import { getTeamEmblemErrorMessage, prepareTeamEmblemUpload } from "../lib/teamEmblem.js";
import { applyReceiptLocaleToUrl, getReceiptLocale, getReceiptSearchWithLocale } from "../lib/receiptLocale.js";
import {
  MATCH_RECEIPT_CANVAS_SIZES,
  MATCH_RECEIPT_CREATE_RETURN_TO,
  MATCH_RECEIPT_FORMATS,
  MATCH_RECEIPT_NATURES,
  MATCH_RECEIPT_LIMITS,
  MATCH_RECEIPT_PHOTO_ASPECT,
  MATCH_RECEIPT_PHOTO_MAX_BYTES,
  clearMatchReceiptDraft,
  clearMatchReceiptPhoto,
  createDefaultMatchReceiptDraft,
  getMatchReceiptDraftFromMatch,
  getMatchReceiptFileName,
  getMatchReceiptOutcome,
  getMatchReceiptPhotoStyle,
  getMatchReceiptSideTeamId,
  loadMatchReceiptPhoto,
  loadMatchReceiptDraft,
  normalizeMatchReceiptPhotoFile,
  normalizeMatchReceiptDraft,
  renderMatchReceiptPng,
  resolveMatchReceiptTeamEmblems,
  saveMatchReceiptPhoto,
  saveMatchReceiptDraft,
  trackMatchReceiptEvent,
  validateMatchReceiptDraft,
} from "../lib/matchReceipt.js";
import {
  MATCH_RECEIPT_COMMENT_MAX_LENGTH,
  MATCH_RECEIPT_LOCALES,
  MATCH_RECEIPT_STYLES,
  sanitizeMatchReceiptCommentInput,
} from "../../shared/lib/thermalReceipt.js";
import { THERMAL_RECEIPT_PHOTO_ASPECT } from "../lib/thermalReceipt.js";

function loadDraft() {
  return loadMatchReceiptDraft() ?? createDefaultMatchReceiptDraft();
}

function getCanonicalTeam(teams, teamId) {
  return teams?.find((item) => String(item.id) === String(teamId)) ?? null;
}

function getCanonicalTeamMmr(team) {
  const mmr = Number(team?.mmr ?? team?.rosterMmr);
  return Number.isFinite(mmr) ? mmr : undefined;
}

const CANONICAL_RECEIPT_FIELDS = new Set([
  "homeTeam",
  "awayTeam",
  "homeScore",
  "awayScore",
  "playedOn",
  "playedTime",
  "format",
  "matchNature",
  "venue",
  "originalAddress",
  "playerCount",
]);

const RECEIPT_TEXT_FIELDS = new Set([
  "homeTeam",
  "awayTeam",
  "address",
  "comment",
  "receiptComment",
  "tournamentName",
]);

const RECEIPT_PERIOD_FIELDS = [
  ["1Q", "q1Home", "q1Away"],
  ["2Q", "q2Home", "q2Away"],
  ["3Q", "q3Home", "q3Away"],
  ["4Q", "q4Home", "q4Away"],
  ["OT", "otHome", "otAway"],
];

const EMPTY_EMBLEM_EDITOR = { side: "", file: null, preview: "", error: "" };

const RECEIPT_PAGE_COPY = Object.freeze({
  ko: {
    eyebrow: "MATCH RECEIPT", title: "경기 영수증", description: "오늘 경기 결과를 입력하고 바로 자랑할 이미지로 저장하세요.",
    navLabel: "영수증 페이지 이동", back: "뒤로가기", home: "홈으로", finalScore: "경기 결과",
    teamA: "TEAM A", teamB: "TEAM B", teamName: "팀 이름", score: "점수", info: "경기 정보", date: "경기 날짜",
    style: "출력 스타일", map: "지도", shortName: "짧은 팀명", includePhoto: "출력물에 경기·팀 사진 포함",
    time: "경기 시간", players: "참가 인원", receiptComment: "한줄평", receiptCommentPlaceholder: "선택 · 22자 이내",
    thermalPhotoCrop: "사진 자르기 조정", zoom: "확대", horizontal: "가로 위치", vertical: "세로 위치",
    venue: "짧은 장소", venuePlaceholder: "경기 장소 대신 주소나 장소를 입력 가능", periodScores: "쿼터별 점수",
    preview: "미리보기", complete: "영수증 완성하기", share: "이미지 공유", story: "Story 저장", post: "Feed 저장", create: "만들기 링크 복사",
    loadingTitle: "경기 찾는 중", notFoundTitle: "경기를 찾을 수 없습니다", loadFailedTitle: "경기를 불러오지 못했습니다",
    loadingDescription: "일련번호로 경기 기록을 확인하고 있습니다.", notFoundDescription: "일련번호를 확인하거나 새 영수증을 만들어 주세요.", retryDescription: "잠시 후 다시 시도해 주세요.", newReceipt: "새 영수증 만들기", retry: "다시 시도",
    readOnlyNote: "공유 영수증은 읽기 전용입니다.", canonicalNote: "확정 기록의 팀·점수·날짜·장소는 원본을 사용합니다. 짧은 장소와 코멘트는 편집할 수 있습니다.",
    requiredTeam: (team) => `필수 · ${team} 이름을 입력하세요`, format: "경기 방식", nature: "경기 성격", tournament: "대회·리그 이름", tournamentPlaceholder: "선택 · 20자 이내", optional: "선택",
    teamEmblems: "팀 엠블럼", emblemGuide: "사진을 골라 선화 엠블럼으로 바로 사용할 수 있습니다. 로그인 후 팀을 만들면 팀 상세에 저장해 다음 영수증에서도 재사용할 수 있습니다.",
    selectLineArt: "선화 엠블럼 선택", savedEmblem: "저장 엠블럼", chooseSavedEmblem: "저장 엠블럼 선택", noSavedEmblem: "저장된 팀 엠블럼 없음", emblemCandidates: (team) => `${team} 엠블럼 후보`, lineArtCandidate: (team) => `${team} 선화 후보`, disableLineArt: "선화 사용 해제", reuseLineArt: "선화 다시 사용",
    localEmblemOnly: "직접 선택한 이미지는 이번 영수증에서만 유지됩니다.", aiPromptHelp: "외부 AI에서 선화 PNG를 만들 때 사용할 지시문입니다.", copyAiPrompt: "AI 선화 프롬프트 복사", createTeamSave: "팀 만들고 엠블럼 저장", loginCreateTeamSave: "로그인 · 팀 만들고 엠블럼 저장",
    periodScoreAria: (period, team) => `${period} ${team} 점수`, comment: "한 줄 코멘트", commentPlaceholder: "선택 · 22자 이내",
    rotatePhotoAria: "사진 자유 회전", rotatePhotoTitle: "드래그해 자유 회전 · 방향키로 미세 조정", photoActionsAria: "미리보기 사진 편집", selectPhoto: "경기사진선택", rotate90: "90° 회전", remove: "제거", reset: "초기화", resetTitle: "입력값·사진 초기화 후 새 일련번호 시작",
    photoEditHelp: "사진 안쪽 드래그 이동 · 휠 확대·축소 · 테두리 손잡이 회전 · 더블클릭 초기화 · 모바일 두 손가락 편집", photoSelectHelp: "사진을 선택하면 미리보기 안에서 바로 편집", localPhotoOnly: "사진은 서버에 업로드하지 않음",
    savedTitle: "내 기록에 저장됨", importTitle: "이 경기를 내 기록으로 가져가기", savedDescription: "실제 경기 ID가 연결됐습니다. QR 코드는 누구나 볼 수 있는 공개 영수증을 엽니다.", viewRecords: "내 기록 보기", continueDescription: "상세 기록을 이어서 작성하면 기존 개인 기록 저장 흐름으로 보관됩니다.", guestContinueDescription: "로그인 방법을 선택해도 작성 내용이 유지됩니다. 로그인 뒤 상세 기록을 작성해 저장할 수 있습니다.", continueRecord: "상세 기록 이어서 작성",
    imageWindowTitle: "BOXTIER 이미지 준비 중", imageWindowBody: "이미지 만드는 중...", recordLoadFailed: "저장된 경기 기록을 불러오지 못했습니다.", claimedReceipt: "내 기록으로 전환된 경기 영수증입니다.", sharedReceipt: "공유된 경기 영수증입니다.", sharedExpired: "공유된 영수증이 만료됐거나 존재하지 않습니다.",
    photoApplied: "사진을 적용했습니다. 서버에는 업로드하지 않습니다.", photoTooLarge: (size) => `사진은 ${size}MB 이하만 사용할 수 있습니다.`, photoInvalid: "사진을 읽지 못했습니다. JPG, PNG, WebP 파일을 확인해 주세요.", savedEmblemApplied: (team) => `${team} 저장 엠블럼을 영수증에 적용했습니다.`, lineArtFailed: "선화를 만들지 못했습니다. 대비가 분명한 엠블럼 이미지를 선택해 주세요.", lineArtApplied: (team) => `${team} 선화를 이번 영수증에 적용했습니다. 서버에는 저장하지 않습니다.`,
    promptCopied: "AI 선화 프롬프트를 복사했습니다.", promptCopyFailed: "프롬프트를 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.", photoRemoved: "사진을 제거했습니다.", resetConfirm: "입력값과 선택 사진을 지우고 새 일련번호로 시작할까요?", resetDone: "새 일련번호로 영수증을 시작했습니다.", publicLinkFailed: "공개 영수증 링크를 만들지 못했습니다.", requiredInfo: "필수 정보를 확인해 주세요.", completeSuccess: "경기 영수증이 완성됐습니다.", rateLimited: "공유 영수증 생성 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.", qrFailed: "이미지는 완성됐지만 공유 QR을 만들지 못했습니다.", completeFirst: "영수증을 먼저 완성해 주세요.",
    imageOpened: "이미지를 열었습니다. 공유 메뉴에서 이미지 저장을 선택하세요.", imageSaved: (label) => `${label} 이미지를 저장했습니다.`, imageFailed: "이미지를 만들지 못했습니다. 다시 시도해 주세요.", shareTitle: "BOXTIER 경기 영수증", shareOpened: "공유 화면을 열었습니다.", shareFallback: "이 브라우저는 이미지 공유를 지원하지 않아 Story 이미지를 저장했습니다.", shareFailed: "공유하지 못했습니다. 이미지 저장을 이용해 주세요.", creatorCopied: "영수증 만들기 링크를 복사했습니다.", creatorCopyFailed: "링크를 복사하지 못했습니다.", loginDraftFailed: "로그인용 영수증 초안을 만들지 못했습니다.", recordDraftRateLimited: "공유 영수증 생성 시도를 초과했습니다. 잠시 후 다시 시도해 주세요.", recordDraftFailed: "기록으로 이어갈 영수증 초안을 만들지 못했습니다.",
    emblemWarning: "조정한 이미지는 이번 영수증에서만 사용되며 서버에 저장되지 않습니다.",
    emblemEditor: { dialog: "엠블럼 이미지 편집", title: "엠블럼 조정", description: "원형 영역 안에 엠블럼을 맞춰 주세요.", convertedPreview: "변환된 선화 미리보기", loadFailed: "이미지를 읽지 못했습니다.", cropPreview: "엠블럼 크롭 미리보기", zoom: "확대·축소", horizontal: "가로 위치", vertical: "세로 위치", cancel: "취소", convert: "선화 만들기", converting: "변환 중", confirm: "적용" },
  },
  en: {
    eyebrow: "GAME RECEIPT", title: "Game Receipt", description: "Turn your game result into a shareable receipt.",
    navLabel: "Receipt page navigation", back: "Back", home: "Home", finalScore: "Final Score",
    teamA: "Team A", teamB: "Team B", teamName: "Team Name", score: "Score", info: "Date / Time / Venue", date: "Date",
    style: "Receipt Style", map: "Map", shortName: "Short Team Name", includePhoto: "Include game / team photo",
    time: "Time", players: "Players", receiptComment: "One-Line Comment", receiptCommentPlaceholder: "Optional · Up to 22 characters",
    thermalPhotoCrop: "Photo crop", zoom: "Zoom", horizontal: "Horizontal", vertical: "Vertical",
    venue: "Venue", venuePlaceholder: "Short venue name", periodScores: "Period Scores",
    preview: "Preview", complete: "Create Receipt", share: "Share Receipt", story: "Download Story", post: "Download Post", create: "Create Your Own",
    loadingTitle: "Finding game", notFoundTitle: "Game not found", loadFailedTitle: "Could not load game",
    loadingDescription: "Checking the game record by receipt number.", notFoundDescription: "Check the receipt number or create a new receipt.", retryDescription: "Try again in a moment.", newReceipt: "Create New Receipt", retry: "Try Again",
    readOnlyNote: "Shared receipts are read-only.", canonicalNote: "Confirmed teams, scores, date, and venue use the official record. You can edit the short venue and comment.",
    requiredTeam: (team) => `Required · Enter ${team}`, format: "Game Format", nature: "Game Type", tournament: "Tournament / League", tournamentPlaceholder: "Optional · Up to 20 characters", optional: "Optional",
    teamEmblems: "Team Emblems", emblemGuide: "Choose an image to create a line-art emblem for this receipt. Sign in and create a team to save it for future receipts.",
    selectLineArt: "Choose Line-Art Emblem", savedEmblem: "Saved Emblem", chooseSavedEmblem: "Choose saved emblem", noSavedEmblem: "No saved team emblem", emblemCandidates: (team) => `${team} emblem options`, lineArtCandidate: (team) => `${team} line-art option`, disableLineArt: "Disable Line Art", reuseLineArt: "Use Line Art Again",
    localEmblemOnly: "Images selected here stay on this receipt only.", aiPromptHelp: "Use this prompt to create a line-art PNG with an external AI tool.", copyAiPrompt: "Copy AI Line-Art Prompt", createTeamSave: "Create Team & Save Emblem", loginCreateTeamSave: "Sign In · Create Team & Save Emblem",
    periodScoreAria: (period, team) => `${period} ${team} score`, comment: "One-Line Comment", commentPlaceholder: "Optional · Up to 22 characters",
    rotatePhotoAria: "Free-rotate photo", rotatePhotoTitle: "Drag to rotate · Use arrow keys for fine adjustment", photoActionsAria: "Edit preview photo", selectPhoto: "Choose game photo", rotate90: "Rotate 90°", remove: "Remove", reset: "Reset", resetTitle: "Clear inputs and photo, then start with a new receipt number",
    photoEditHelp: "Drag to move · Wheel or pinch to zoom · Drag the edge handle to rotate · Double-click to reset", photoSelectHelp: "Choose a photo to edit it in the preview", localPhotoOnly: "Photo stays on this device and is not uploaded",
    savedTitle: "Saved to My Records", importTitle: "Add This Game to My Records", savedDescription: "This receipt is linked to an official game. Its QR code opens the public receipt.", viewRecords: "View My Records", continueDescription: "Continue with detailed stats to save this game through the regular record flow.", guestContinueDescription: "Your work stays here while you sign in. After signing in, continue the detailed record to save it.", continueRecord: "Continue Detailed Record",
    imageWindowTitle: "Preparing BOXTIER Image", imageWindowBody: "Creating image...", recordLoadFailed: "Could not load the saved game record.", claimedReceipt: "This game receipt is now linked to your records.", sharedReceipt: "This is a shared game receipt.", sharedExpired: "This shared receipt has expired or does not exist.",
    photoApplied: "Photo applied. It will not be uploaded to the server.", photoTooLarge: (size) => `Use a photo smaller than ${size}MB.`, photoInvalid: "Could not read the photo. Check the JPG, PNG, or WebP file.", savedEmblemApplied: (team) => `${team} saved emblem applied to the receipt.`, lineArtFailed: "Could not create line art. Choose an emblem with clear contrast.", lineArtApplied: (team) => `${team} line art applied to this receipt. It will not be saved to the server.`,
    promptCopied: "AI line-art prompt copied.", promptCopyFailed: "Could not copy the prompt. Check your browser clipboard permission.", photoRemoved: "Photo removed.", resetConfirm: "Clear all inputs and the selected photo, then start with a new receipt number?", resetDone: "Started a new receipt number.", publicLinkFailed: "Could not create the public receipt link.", requiredInfo: "Check the required information.", completeSuccess: "Game receipt created.", rateLimited: "You have reached the shared receipt limit. Try again later.", qrFailed: "The image is ready, but the shared QR code could not be created.", completeFirst: "Create the receipt first.",
    imageOpened: "Image opened. Choose Save Image from the share menu.", imageSaved: (label) => `${label} image saved.`, imageFailed: "Could not create the image. Try again.", shareTitle: "BOXTIER Game Receipt", shareOpened: "Share sheet opened.", shareFallback: "Image sharing is unavailable in this browser, so the Story image was downloaded.", shareFailed: "Could not share the image. Use an image download instead.", creatorCopied: "Create Your Own link copied.", creatorCopyFailed: "Could not copy the link.", loginDraftFailed: "Could not prepare the receipt for sign-in.", recordDraftRateLimited: "Too many shared receipt attempts. Try again later.", recordDraftFailed: "Could not prepare the receipt for the detailed record.",
    emblemWarning: "The adjusted image is used only on this receipt and is not saved to the server.",
    emblemEditor: { dialog: "Edit emblem image", title: "Adjust Emblem", description: "Fit the emblem inside the circular area.", convertedPreview: "Converted line-art preview", loadFailed: "Could not load the image.", cropPreview: "Emblem crop preview", zoom: "Zoom", horizontal: "Horizontal position", vertical: "Vertical position", cancel: "Cancel", convert: "Create Line Art", converting: "Converting", confirm: "Apply" },
  },
});

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function isIosDevice(navigatorValue) {
  return /iPad|iPhone|iPod/u.test(navigatorValue?.userAgent || "")
    || (navigatorValue?.platform === "MacIntel" && navigatorValue.maxTouchPoints > 1);
}

function canShareImageFile(navigatorValue, file) {
  return typeof navigatorValue?.share === "function" && Boolean(navigatorValue.canShare?.({ files: [file] }));
}

function getPhotoGestureSnapshot(pointers) {
  const points = [...pointers.values()].slice(0, 2);
  if (!points.length) return null;
  const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  if (points.length === 1) return { count: 1, centerX, centerY, distance: 0, angle: 0 };
  const deltaX = points[1].x - points[0].x;
  const deltaY = points[1].y - points[0].y;
  return {
    count: 2,
    centerX,
    centerY,
    distance: Math.hypot(deltaX, deltaY),
    angle: Math.atan2(deltaY, deltaX) * 180 / Math.PI,
  };
}

export default function MatchReceipt({ auth, app }) {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedReceiptLocale = useMemo(() => (
    new URLSearchParams(location.search).get("lang") === MATCH_RECEIPT_LOCALES.en
      ? MATCH_RECEIPT_LOCALES.en
      : ""
  ), [location.search]);
  const matchId = useMemo(
    () => new URLSearchParams(location.search).get("match")?.trim() ?? "",
    [location.search],
  );
  const requestedPublicDraftId = useMemo(
    () => new URLSearchParams(location.search).get("draft")?.trim() ?? "",
    [location.search],
  );
  const requestedPublicCode = useMemo(
    () => new URLSearchParams(location.search).get("code")?.trim() ?? "",
    [location.search],
  );
  const sourceDraftRef = useRef(location.state?.receiptDraft
    ? normalizeMatchReceiptDraft(location.state.receiptDraft)
    : null);
  const [draft, setDraft] = useState(() => sourceDraftRef.current
    ?? (matchId || requestedPublicDraftId || requestedPublicCode ? createDefaultMatchReceiptDraft() : loadDraft()));
  const receiptLocale = getReceiptLocale(location);
  const receiptPreviewDraft = useMemo(
    () => ({ ...draft, receiptLocale }),
    [draft, receiptLocale],
  );
  const [errors, setErrors] = useState({});
  const [generated, setGenerated] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [publicCodeLookup, setPublicCodeLookup] = useState(() => requestedPublicCode ? "loading" : "idle");
  const [publicCodeLookupAttempt, setPublicCodeLookupAttempt] = useState(0);
  const [photoBlob, setPhotoBlob] = useState(null);
  const [localTeamLineArtUrls, setLocalTeamLineArtUrls] = useState({ home: "", away: "" });
  const [photoUrl, setPhotoUrl] = useState("");
  const [publicDraftId, setPublicDraftId] = useState("");
  const [requestedDraftCanClaim, setRequestedDraftCanClaim] = useState(false);
  const [courtMapOpen, setCourtMapOpen] = useState(false);
  const [selectedCourtId, setSelectedCourtId] = useState("");
  const [discoveredCourts, setDiscoveredCourts] = useState([]);
  const [courtMapDirectoryStatus, setCourtMapDirectoryStatus] = useState({ loading: false, error: "" });
  const [localTeamEmblemUrls, setLocalTeamEmblemUrls] = useState({ home: "", away: "" });
  const [emblemEditor, setEmblemEditor] = useState(EMPTY_EMBLEM_EDITOR);
  const [emblemPending, setEmblemPending] = useState(false);
  const [photoGestureActive, setPhotoGestureActive] = useState(false);
  const startedRef = useRef(false);
  const requestedMatchIdRef = useRef("");
  const courtMapRequestIdRef = useRef(0);
  const previewRef = useRef(null);
  const photoEditorRef = useRef(null);
  const photoGestureRef = useRef({ pointers: new Map(), baseline: null });
  const photoRotationRef = useRef(null);
  const photoTransformRef = useRef(null);
  const photoTransformFrameRef = useRef({ requestId: 0, values: null });
  const publicDraftRequestRef = useRef(null);
  const publicDraftSerialSeedRef = useRef("");
  const canonicalSnapshotCreatedRef = useRef("");
  const draftRevisionRef = useRef(0);
  const publicDraftLoadedRevisionRef = useRef(0);
  const publicDraftSavedRevisionRef = useRef(-1);
  const draftRef = useRef(draft);
  const publicDraftIdRef = useRef("");
  const isEnglish = receiptLocale === "en";
  const receiptCopy = RECEIPT_PAGE_COPY[receiptLocale];
  draftRef.current = draft;
  publicDraftIdRef.current = publicDraftId;
  photoTransformRef.current = {
    photoX: draft.photoX,
    photoY: draft.photoY,
    photoZoom: draft.photoZoom,
    photoRotation: draft.photoRotation,
  };
  const outcome = useMemo(() => getMatchReceiptOutcome(draft), [draft]);
  const canonicalMatch = useMemo(
    () => app?.state?.matches?.find((match) => String(match.id) === matchId) ?? null,
    [app?.state?.matches, matchId],
  );
  const canonicalMatchId = canonicalMatch ? matchId : "";
  const canonicalTournament = useMemo(
    () => app?.state?.tournaments?.find((tournament) => tournament.id === canonicalMatch?.tournamentId) ?? null,
    [app?.state?.tournaments, canonicalMatch?.tournamentId],
  );
  const canonicalHomeTeam = useMemo(
    () => getCanonicalTeam(app?.state?.teams, getMatchReceiptSideTeamId(canonicalMatch, "teamA")),
    [app?.state?.teams, canonicalMatch],
  );
  const canonicalAwayTeam = useMemo(
    () => getCanonicalTeam(app?.state?.teams, getMatchReceiptSideTeamId(canonicalMatch, "teamB")),
    [app?.state?.teams, canonicalMatch],
  );
  const savedReceiptEmblemTeams = useMemo(
    () => (app?.state?.teams ?? []).filter((team) => team.receiptEmblemKey),
    [app?.state?.teams],
  );
  const canonicalHomeTeamMmr = getCanonicalTeamMmr(canonicalHomeTeam);
  const canonicalAwayTeamMmr = getCanonicalTeamMmr(canonicalAwayTeam);
  const currentUserId = app?.currentUser?.id ?? "";
  const currentUserMmr = Number(app?.currentUser?.ratings?.integrated);
  const canShowCurrentUserIdentity = Boolean(
    auth?.session && currentUserId && !requestedPublicDraftId && !requestedPublicCode,
  );
  const personalMmr = canShowCurrentUserIdentity && Number.isFinite(currentUserMmr) ? currentUserMmr : null;
  const profileHashtag = canShowCurrentUserIdentity && app?.currentUser
    ? getUserHashtag(app.currentUser)
    : "";
  const directoryCourts = useMemo(() => getRegisteredCourts(app?.state ?? {}), [app?.state]);
  const registeredCourts = useMemo(
    () => mergeCourtSearchCourts(directoryCourts, discoveredCourts),
    [directoryCourts, discoveredCourts],
  );
  const profileCourtRegion = useMemo(() => (
    [app?.currentUser?.regionSido, app?.currentUser?.regionDistrict].filter(Boolean).join(" ").trim()
      || String(app?.currentUser?.region ?? "").trim()
  ), [app?.currentUser?.region, app?.currentUser?.regionDistrict, app?.currentUser?.regionSido]);
  const courtMapRegionSource = String(draft.originalAddress || profileCourtRegion).trim();
  const courtMapRegion = useMemo(() => {
    if (!courtMapRegionSource) return "";
    const selection = inferRegionSelection(courtMapRegionSource);
    return [selection.sido, selection.district].filter(Boolean).join(" ");
  }, [courtMapRegionSource]);
  const selectedCourt = useMemo(() => (
    registeredCourts.find((court) => String(court.id) === selectedCourtId)
      ?? registeredCourts.find((court) => court.name === draft.venue)
      ?? null
  ), [draft.venue, registeredCourts, selectedCourtId]);
  const activePublicDraftId = publicDraftId || requestedPublicDraftId;
  const receiptIsReadOnly = Boolean(requestedPublicDraftId && !publicDraftId);
  const matchUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    if (requestedPublicCode && !draft.publicCode) return "";
    const url = new URL("/app/receipt", window.location.origin);
    if (draft.publicCode) url.searchParams.set("code", draft.publicCode);
    else if (activePublicDraftId) url.searchParams.set("draft", activePublicDraftId);
    applyReceiptLocaleToUrl(url, receiptLocale);
    return url.toString();
  }, [activePublicDraftId, draft.publicCode, receiptLocale, requestedPublicCode]);
  const receiptPublicId = activePublicDraftId;
  const canonicalTeamReceiptEmblemUrls = useMemo(() => ({
    home: canonicalHomeTeam?.receiptEmblemKey || draft.homeEmblemKey ? assetUrl(canonicalHomeTeam?.receiptEmblemKey || draft.homeEmblemKey) : "",
    away: canonicalAwayTeam?.receiptEmblemKey || draft.awayEmblemKey ? assetUrl(canonicalAwayTeam?.receiptEmblemKey || draft.awayEmblemKey) : "",
  }), [canonicalAwayTeam?.receiptEmblemKey, canonicalHomeTeam?.receiptEmblemKey, draft.awayEmblemKey, draft.homeEmblemKey]);
  const selectedTeamLineArtUrls = useMemo(() => resolveMatchReceiptTeamEmblems({
    local: localTeamLineArtUrls,
    canonical: canonicalTeamReceiptEmblemUrls,
    enabled: { home: draft.homeUseLineArt, away: draft.awayUseLineArt },
  }), [
    canonicalTeamReceiptEmblemUrls.away,
    canonicalTeamReceiptEmblemUrls.home,
    draft.awayUseLineArt,
    draft.homeUseLineArt,
    localTeamLineArtUrls.away,
    localTeamLineArtUrls.home,
  ]);
  const isThermal = draft.receiptStyle === MATCH_RECEIPT_STYLES.thermal;
  const photoEditorAspect = isThermal ? THERMAL_RECEIPT_PHOTO_ASPECT : MATCH_RECEIPT_PHOTO_ASPECT;
  const commentLength = Array.from(draft.comment).length;
  const selectedTeamThermalEmblemUrls = useMemo(() => resolveMatchReceiptTeamEmblems({
    canonical: canonicalTeamReceiptEmblemUrls,
    local: localTeamEmblemUrls,
    enabled: { home: draft.homeUseLineArt, away: draft.awayUseLineArt },
  }), [
    canonicalTeamReceiptEmblemUrls.away,
    canonicalTeamReceiptEmblemUrls.home,
    draft.awayUseLineArt,
    draft.homeUseLineArt,
    localTeamEmblemUrls.away,
    localTeamEmblemUrls.home,
  ]);
  const selectedTeamReceiptEmblemUrls = isThermal ? selectedTeamThermalEmblemUrls : selectedTeamLineArtUrls;

  useEffect(() => () => {
    const frame = photoTransformFrameRef.current;
    if (frame.requestId) window.cancelAnimationFrame(frame.requestId);
  }, []);

  useEffect(() => {
    if (!requestedPublicCode) {
      setPublicCodeLookup("idle");
      return undefined;
    }
    let active = true;
    setPublicCodeLookup("loading");
    fetch(`/api/match-receipts/resolve?code=${encodeURIComponent(requestedPublicCode)}`, {
      credentials: "same-origin",
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const lookupError = new Error(result.error || "match_public_code_resolution_failed");
          lookupError.status = response.status;
          throw lookupError;
        }
        return result;
      })
      .then((result) => {
        if (!active) return;
        if (result.matchId) {
          navigate(`/app/matches?match=${encodeURIComponent(result.matchId)}`, { replace: true });
          return;
        }
        if (result.publicId) {
          const nextSearch = new URLSearchParams({ draft: result.publicId });
          if (isEnglish) nextSearch.set("lang", "en");
          navigate(`/app/receipt?${nextSearch.toString()}`, { replace: true });
          return;
        }
        const lookupError = new Error("match_public_code_not_found");
        lookupError.status = 404;
        throw lookupError;
      })
      .catch((lookupError) => {
        if (!active) return;
        setPublicCodeLookup(
          lookupError.status === 404 || lookupError.message === "match_public_code_not_found"
            ? "not-found"
            : "error",
        );
      });
    return () => { active = false; };
  }, [isEnglish, navigate, publicCodeLookupAttempt, requestedPublicCode]);

  useEffect(() => {
    if (!matchId) return;
    if (canonicalMatch) {
      setDraft((current) => getMatchReceiptDraftFromMatch(canonicalMatch, {
        ...current,
        currentUserId,
        personalMmr,
        profileHashtag,
        tournament: canonicalTournament,
        homeMmr: canonicalHomeTeamMmr,
        awayMmr: canonicalAwayTeamMmr,
        homeTeamRecord: canonicalHomeTeam,
        awayTeamRecord: canonicalAwayTeam,
      }));
      setGenerated(true);
      setStatus("");
      return;
    }
    if (requestedMatchIdRef.current === matchId) return;
    requestedMatchIdRef.current = matchId;
    Promise.resolve(app?.actions?.loadMatchDetail?.(matchId)).then((loaded) => {
      if (!loaded) setStatus(receiptCopy.recordLoadFailed);
    });
  }, [
    app?.actions,
    canonicalAwayTeamMmr,
    canonicalAwayTeam,
    canonicalHomeTeamMmr,
    canonicalHomeTeam,
    canonicalMatch,
    canonicalTournament,
    currentUserId,
    matchId,
    personalMmr,
    profileHashtag,
    receiptCopy.recordLoadFailed,
  ]);

  useEffect(() => {
    if (requestedPublicDraftId || requestedPublicCode || canonicalMatchId) return;
    setDraft((current) => current.personalMmr === personalMmr && current.profileHashtag === profileHashtag
      ? current
      : normalizeMatchReceiptDraft({ ...current, personalMmr, profileHashtag }));
  }, [canonicalMatchId, personalMmr, profileHashtag, requestedPublicCode, requestedPublicDraftId]);

  useEffect(() => {
    if (!requestedPublicDraftId || canonicalMatchId) return;
    let active = true;
    fetch(`/api/match-receipts/draft?publicId=${encodeURIComponent(requestedPublicDraftId)}`, {
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("receipt_draft_not_found");
        return response.json();
      })
      .then((result) => {
        if (!active) return;
        const normalizedDraft = normalizeMatchReceiptDraft({
          ...result.draft,
          ...(requestedReceiptLocale ? { receiptLocale: requestedReceiptLocale } : {}),
        });
        publicDraftSerialSeedRef.current = result.draft?.serialSeed ?? "";
        publicDraftLoadedRevisionRef.current = draftRevisionRef.current;
        publicDraftSavedRevisionRef.current = draftRevisionRef.current;
        draftRef.current = normalizedDraft;
        if (result.canClaim) {
          publicDraftIdRef.current = result.publicId;
          setPublicDraftId(result.publicId);
        }
        setDraft(normalizedDraft);
        setGenerated(true);
        setRequestedDraftCanClaim(Boolean(result.canClaim));
        setStatus(result.claimed ? receiptCopy.claimedReceipt : receiptCopy.sharedReceipt);
      })
      .catch(() => {
        if (active) setStatus(receiptCopy.sharedExpired);
      });
    return () => {
      active = false;
    };
  }, [canonicalMatchId, receiptCopy.claimedReceipt, receiptCopy.sharedExpired, receiptCopy.sharedReceipt, requestedPublicDraftId]);

  useEffect(() => {
    if (requestedPublicDraftId || requestedPublicCode) return undefined;
    let active = true;
    loadMatchReceiptPhoto().then((blob) => {
      if (active && blob) setPhotoBlob(blob);
    });
    return () => {
      active = false;
    };
  }, [requestedPublicCode, requestedPublicDraftId]);

  useEffect(() => {
    if (!courtMapOpen) return undefined;
    if (!courtMapRegion) {
      setCourtMapDirectoryStatus({ loading: false, error: "지도 검색 지역이 없습니다. 프로필 지역을 설정해 주세요." });
      return undefined;
    }

    const requestId = courtMapRequestIdRef.current + 1;
    courtMapRequestIdRef.current = requestId;
    setCourtMapDirectoryStatus({ loading: true, error: "" });
    postServerAction("/api/search", {
      query: courtMapRegion,
      type: "court",
      limit: COURT_MAP_SEARCH_LIMIT,
      context: { purpose: COURT_MAP_SEARCH_PURPOSE },
      force: true,
    }, { allowWhenDisabled: true, allowAnonymous: true }).then((result) => {
      if (courtMapRequestIdRef.current !== requestId) return;
      const courts = (Array.isArray(result?.items) ? result.items : [])
        .filter((court) => court?.kind === "court" && court?.id);
      setDiscoveredCourts((current) => mergeCourtSearchCourts(current, courts));
      setCourtMapDirectoryStatus({ loading: false, error: "" });
    }).catch(() => {
      if (courtMapRequestIdRef.current !== requestId) return;
      setCourtMapDirectoryStatus({ loading: false, error: "등록 구장을 불러오지 못했습니다. 다시 열어 주세요." });
    });

    return () => {
      if (courtMapRequestIdRef.current === requestId) courtMapRequestIdRef.current += 1;
    };
  }, [courtMapOpen, courtMapRegion]);

  useEffect(() => {
    if (!photoBlob) {
      setPhotoUrl("");
      return undefined;
    }
    const nextUrl = URL.createObjectURL(photoBlob);
    setPhotoUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [photoBlob]);

  useEffect(() => {
    trackMatchReceiptEvent("receipt_page_view", { loggedIn: Boolean(auth?.session), entry: "direct" });
  }, [auth?.session]);

  useEffect(() => {
    if (!requestedPublicDraftId && !requestedPublicCode) saveMatchReceiptDraft(draft);
  }, [draft, requestedPublicCode, requestedPublicDraftId]);

  function updateField(name, value) {
    if (isFieldReadOnly(name)) return;
    if (!startedRef.current) {
      startedRef.current = true;
      trackMatchReceiptEvent("receipt_started", { loggedIn: Boolean(auth?.session) });
    }
    setDraft((current) => {
      const isCommentField = name === "comment" || name === "receiptComment";
      const normalizedValue = isCommentField ? sanitizeMatchReceiptCommentInput(value) : value;
      let next = RECEIPT_TEXT_FIELDS.has(name)
        ? {
          ...current,
          [name]: String(normalizedValue ?? ""),
        }
        : normalizeMatchReceiptDraft({ ...current, [name]: normalizedValue });
      if (isCommentField) {
        next = { ...next, comment: normalizedValue, receiptComment: normalizedValue };
      }
      draftRef.current = next;
      return next;
    });
    draftRevisionRef.current += 1;
    setErrors((current) => (name === "address" && current.venue
      ? { ...current, address: "", venue: "" }
      : current[name] ? { ...current, [name]: "" } : current));
    setGenerated(Boolean(canonicalMatchId));
    setStatus("");
  }

  function selectReceiptLocale(locale) {
    if (locale === receiptLocale) return;
    setStatus("");
    if (locale === "en") setCourtMapOpen(false);
    navigate(`${location.pathname}${getReceiptSearchWithLocale(location.search, locale)}${location.hash}`, { replace: true });
  }

  function selectCourt(court) {
    if (!court || isFieldReadOnly("venue")) return;
    const courtAddress = getCourtAddress(court);
    const venue = court.name ?? "";
    const address = "";
    const originalAddress = courtAddress === "주소 미등록" ? "" : courtAddress;
    setSelectedCourtId(String(court.id ?? ""));
    setDraft((current) => {
      const next = normalizeMatchReceiptDraft({ ...current, venue, address, originalAddress });
      draftRef.current = next;
      return next;
    });
    draftRevisionRef.current += 1;
    setErrors((current) => ({ ...current, venue: "", address: "" }));
    setGenerated(Boolean(canonicalMatchId));
    setStatus("");
    setCourtMapOpen(false);
  }

  function isFieldReadOnly(name) {
    return receiptIsReadOnly || Boolean(canonicalMatchId && CANONICAL_RECEIPT_FIELDS.has(name));
  }

  async function handlePhotoChange(event) {
    if (receiptIsReadOnly) {
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("photo");
    setStatus("");
    try {
      const normalized = await normalizeMatchReceiptPhotoFile(file);
      await saveMatchReceiptPhoto(normalized);
      setPhotoBlob(normalized);
      setGenerated(Boolean(canonicalMatchId));
      setStatus(receiptCopy.photoApplied);
    } catch (error) {
      setStatus(error.message === "match_receipt_photo_size"
        ? receiptCopy.photoTooLarge(Math.round(MATCH_RECEIPT_PHOTO_MAX_BYTES / 1024 / 1024))
        : receiptCopy.photoInvalid);
    } finally {
      setBusy("");
    }
  }

  function selectSavedTeamReceiptEmblem(side, emblemKey) {
    if (receiptIsReadOnly) return;
    setLocalTeamLineArtUrls((current) => ({ ...current, [side]: "" }));
    setLocalTeamEmblemUrls((current) => ({ ...current, [side]: "" }));
    setDraft((current) => {
      const next = normalizeMatchReceiptDraft({
        ...current,
        [`${side}EmblemKey`]: emblemKey,
        [`${side}UseLineArt`]: Boolean(emblemKey),
      });
      draftRef.current = next;
      return next;
    });
    draftRevisionRef.current += 1;
    setGenerated(Boolean(canonicalMatchId));
    setStatus(emblemKey ? receiptCopy.savedEmblemApplied(side === "home" ? receiptCopy.teamA : receiptCopy.teamB) : "");
  }

  function handleLocalTeamEmblemChange(side, event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (receiptIsReadOnly || !file) return;
    setEmblemEditor({ side, file, preview: "", error: "" });
    setStatus("");
  }

  function resetLocalTeamEmblemConversion() {
    setEmblemEditor((current) => ({ ...current, preview: "", error: "" }));
  }

  async function convertLocalTeamEmblem(crop) {
    if (!emblemEditor.file) return;
    setEmblemPending(true);
    setEmblemEditor((current) => ({ ...current, error: "" }));
    try {
      const prepared = await prepareTeamEmblemUpload(emblemEditor.file, crop, { circular: true });
      const preview = await createMatchReceiptLineArt(`data:image/webp;base64,${prepared.imageBase64}`);
      if (!preview) throw new Error("match_receipt_line_art_failed");
      setEmblemEditor((current) => ({ ...current, preview, error: "" }));
    } catch (error) {
      const message = error.message === "match_receipt_line_art_failed"
        ? receiptCopy.lineArtFailed
        : isEnglish ? receiptCopy.lineArtFailed : getTeamEmblemErrorMessage(error.code || error.message);
      setEmblemEditor((current) => ({ ...current, preview: "", error: message }));
    } finally {
      setEmblemPending(false);
    }
  }

  async function confirmLocalTeamEmblem(crop) {
    if (!emblemEditor.side || (!isThermal && !emblemEditor.preview)) return;
    const side = emblemEditor.side;
    setEmblemPending(true);
    try {
      if (isThermal) {
        const prepared = await prepareTeamEmblemUpload(emblemEditor.file, crop, { circular: true });
        setLocalTeamEmblemUrls((current) => ({ ...current, [side]: `data:image/webp;base64,${prepared.imageBase64}` }));
      } else {
        setLocalTeamLineArtUrls((current) => ({ ...current, [side]: emblemEditor.preview }));
      }
      updateField(`${side}UseLineArt`, true);
      setEmblemEditor(EMPTY_EMBLEM_EDITOR);
      setStatus(isThermal
        ? (isEnglish
          ? `${side === "home" ? "TEAM A" : "TEAM B"} emblem applied to this receipt only.`
          : `${side === "home" ? "TEAM A" : "TEAM B"} 엠블럼을 이번 영수증에 적용했습니다. 서버에는 저장하지 않습니다.`)
        : receiptCopy.lineArtApplied(side === "home" ? receiptCopy.teamA : receiptCopy.teamB));
    } catch (error) {
      setEmblemEditor((current) => ({ ...current, error: isEnglish ? "Could not prepare the emblem image." : getTeamEmblemErrorMessage(error.code || error.message) }));
    } finally {
      setEmblemPending(false);
    }
  }

  async function copyLineArtPrompt() {
    try {
      await navigator.clipboard.writeText(MATCH_RECEIPT_LINE_ART_AI_PROMPT);
      setStatus(receiptCopy.promptCopied);
    } catch {
      setStatus(receiptCopy.promptCopyFailed);
    }
  }

  async function removePhoto() {
    if (receiptIsReadOnly) return;
    await clearMatchReceiptPhoto();
    setPhotoBlob(null);
    setDraft((current) => normalizeMatchReceiptDraft({
      ...current,
      photoZoom: 1,
      photoX: 0,
      photoY: 0,
      photoRotation: 0,
    }));
    setGenerated(Boolean(canonicalMatchId));
    setStatus(receiptCopy.photoRemoved);
  }

  function resetPhotoTransform() {
    if (receiptIsReadOnly) return;
    setDraft((current) => normalizeMatchReceiptDraft({
      ...current,
      photoZoom: 1,
      photoX: 0,
      photoY: 0,
      photoRotation: 0,
    }));
    setGenerated(Boolean(canonicalMatchId));
    setStatus("");
  }

  async function resetReceipt() {
    if (receiptIsReadOnly) return;
    if (!window.confirm(receiptCopy.resetConfirm)) return;

    setBusy("reset");
    try {
      if (publicDraftRequestRef.current) {
        try {
          await publicDraftRequestRef.current;
        } catch {
          // A failed previous save must not prevent a local reset.
        }
      }
      clearMatchReceiptDraft();
      await clearMatchReceiptPhoto();
      const next = normalizeMatchReceiptDraft({
        ...createDefaultMatchReceiptDraft(),
        personalMmr,
        profileHashtag,
        receiptStyle: draft.receiptStyle,
        receiptLocale,
      });
      photoTransformRef.current = {
        photoX: next.photoX,
        photoY: next.photoY,
        photoZoom: next.photoZoom,
        photoRotation: next.photoRotation,
      };
      draftRef.current = next;
      setDraft(next);
      setPhotoBlob(null);
      setLocalTeamLineArtUrls({ home: "", away: "" });
      setLocalTeamEmblemUrls({ home: "", away: "" });
      setEmblemEditor(EMPTY_EMBLEM_EDITOR);
      setGenerated(false);
      publicDraftIdRef.current = "";
      setPublicDraftId("");
      setRequestedDraftCanClaim(false);
      draftRevisionRef.current += 1;
      publicDraftLoadedRevisionRef.current = draftRevisionRef.current;
      publicDraftSavedRevisionRef.current = -1;
      publicDraftSerialSeedRef.current = "";
      canonicalSnapshotCreatedRef.current = "";
      setSelectedCourtId("");
      setErrors({});
      setStatus(receiptCopy.resetDone);
      navigate(`/app/receipt${getReceiptSearchWithLocale("", receiptLocale)}`, { replace: true, state: { receiptDraft: next } });
    } finally {
      setBusy("");
    }
  }

  function updatePhotoTransform(values) {
    setDraft((current) => {
      const next = normalizeMatchReceiptDraft({ ...current, ...values });
      photoTransformRef.current = {
        photoX: next.photoX,
        photoY: next.photoY,
        photoZoom: next.photoZoom,
        photoRotation: next.photoRotation,
      };
      return next;
    });
  }

  function schedulePhotoTransform(values) {
    const frame = photoTransformFrameRef.current;
    frame.values = { ...(frame.values || {}), ...values };
    if (frame.requestId) return;
    frame.requestId = window.requestAnimationFrame(() => {
      const nextValues = frame.values;
      frame.requestId = 0;
      frame.values = null;
      if (nextValues) updatePhotoTransform(nextValues);
    });
  }

  function flushPhotoTransform() {
    const frame = photoTransformFrameRef.current;
    if (frame.requestId) window.cancelAnimationFrame(frame.requestId);
    const nextValues = frame.values;
    frame.requestId = 0;
    frame.values = null;
    if (nextValues) updatePhotoTransform(nextValues);
  }

  function getPhotoGestureBaseline(target, pointers) {
    const snapshot = getPhotoGestureSnapshot(pointers);
    if (!snapshot) return null;
    return {
      ...snapshot,
      ...photoTransformRef.current,
      width: Math.max(1, target.clientWidth),
      height: Math.max(1, target.clientHeight),
    };
  }

  function beginPhotoGesture(event) {
    if (!photoUrl) return;
    event.preventDefault();
    const gesture = photoGestureRef.current;
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.baseline = getPhotoGestureBaseline(event.currentTarget, gesture.pointers);
    setPhotoGestureActive(true);
  }

  function movePhotoGesture(event) {
    const gesture = photoGestureRef.current;
    if (!photoUrl || !gesture.pointers.has(event.pointerId) || !gesture.baseline) return;
    event.preventDefault();
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const snapshot = getPhotoGestureSnapshot(gesture.pointers);
    if (!snapshot) return;

    const baseline = gesture.baseline;
    let photoZoom = baseline.photoZoom;
    let photoRotation = baseline.photoRotation;
    if (snapshot.count === 2 && baseline.count === 2) {
      photoZoom *= snapshot.distance / Math.max(1, baseline.distance);
      const angleDelta = ((snapshot.angle - baseline.angle + 540) % 360) - 180;
      photoRotation += angleDelta;
    }

    schedulePhotoTransform({
      photoX: baseline.photoX + (snapshot.centerX - baseline.centerX) / baseline.width * 200,
      photoY: baseline.photoY + (snapshot.centerY - baseline.centerY) / baseline.height * 200,
      photoZoom,
      photoRotation,
    });
  }

  function endPhotoGesture(event) {
    const gesture = photoGestureRef.current;
    if (!gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.delete(event.pointerId);
    gesture.baseline = getPhotoGestureBaseline(event.currentTarget, gesture.pointers);
    if (gesture.pointers.size === 0) {
      flushPhotoTransform();
      setPhotoGestureActive(false);
    }
  }

  function zoomPhotoWithWheel(event) {
    if (!photoUrl) return;
    event.preventDefault();
    updatePhotoTransform({ photoZoom: photoTransformRef.current.photoZoom * Math.exp(-event.deltaY * 0.0015) });
  }

  function beginPhotoRotation(event) {
    if (!photoUrl) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = photoEditorRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    photoRotationRef.current = {
      pointerId: event.pointerId,
      centerX,
      centerY,
      angle: Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI,
      photoRotation: photoTransformRef.current.photoRotation,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPhotoGestureActive(true);
  }

  function movePhotoRotation(event) {
    const rotation = photoRotationRef.current;
    if (!rotation || rotation.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const angle = Math.atan2(event.clientY - rotation.centerY, event.clientX - rotation.centerX) * 180 / Math.PI;
    const angleDelta = ((angle - rotation.angle + 540) % 360) - 180;
    schedulePhotoTransform({ photoRotation: rotation.photoRotation + angleDelta });
  }

  function endPhotoRotation(event) {
    if (photoRotationRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    photoRotationRef.current = null;
    flushPhotoTransform();
    setPhotoGestureActive(false);
  }

  function nudgePhotoRotation(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    updatePhotoTransform({
      photoRotation: photoTransformRef.current.photoRotation + direction * (event.shiftKey ? 15 : 5),
    });
  }

  async function ensurePublicDraft(value = draftRef.current, { forClaim = false } = {}) {
    const hasLocalEdits = () => Boolean(
      requestedPublicDraftId
      && draftRevisionRef.current !== publicDraftLoadedRevisionRef.current,
    );
    if (publicDraftIdRef.current
      && publicDraftSavedRevisionRef.current === draftRevisionRef.current) {
      return publicDraftIdRef.current;
    }
    if (requestedPublicDraftId && !hasLocalEdits() && !publicDraftIdRef.current
      && (!forClaim || requestedDraftCanClaim)) return requestedPublicDraftId;
    if (publicDraftRequestRef.current) return publicDraftRequestRef.current;

    const request = (async () => {
      let nextDraft = value;
      while (true) {
        const requestRevision = draftRevisionRef.current;
        const ownedPublicId = publicDraftIdRef.current;
        const result = await postServerAction("/api/match-receipts/draft", {
          draft: { ...nextDraft, receiptLocale },
          ...(ownedPublicId ? { publicId: ownedPublicId } : {}),
          ...(!ownedPublicId && canonicalMatchId ? { sourceMatchId: canonicalMatchId } : {}),
          ...(!ownedPublicId && requestedPublicDraftId && !hasLocalEdits()
            ? { clonePublicId: requestedPublicDraftId }
            : {}),
        }, {
          allowAnonymous: !canonicalMatchId,
          allowWhenDisabled: true,
        });
        if (!result?.publicId) throw new Error("receipt_draft_create_failed");

        publicDraftIdRef.current = result.publicId;
        publicDraftSavedRevisionRef.current = requestRevision;
        setPublicDraftId(result.publicId);
        const serverDraft = result.draft ?? {};
        const serialSeed = result.serialSeed || serverDraft.serialSeed || draftRef.current.serialSeed;
        const publicCode = result.publicCode || serverDraft.publicCode || draftRef.current.publicCode;
        publicDraftSerialSeedRef.current = serialSeed;
        setDraft((current) => {
          const normalized = normalizeMatchReceiptDraft({
            ...current,
            serialSeed,
            publicCode,
          });
          draftRef.current = normalized;
          return normalized;
        });
        if (requestRevision === draftRevisionRef.current) return result.publicId;
        nextDraft = draftRef.current;
      }
    })().finally(() => {
      if (publicDraftRequestRef.current === request) publicDraftRequestRef.current = null;
    });
    publicDraftRequestRef.current = request;
    return request;
  }

  useEffect(() => {
    if (!canonicalMatchId || !generated || publicDraftId
      || canonicalSnapshotCreatedRef.current === canonicalMatchId) return;
    canonicalSnapshotCreatedRef.current = canonicalMatchId;
    void ensurePublicDraft(draft).catch(() => {
      canonicalSnapshotCreatedRef.current = "";
      setStatus(receiptCopy.publicLinkFailed);
    });
  }, [canonicalMatchId, draft, generated, publicDraftId, receiptCopy.publicLinkFailed]);

  async function completeReceipt(event) {
    event.preventDefault();
    const result = validateMatchReceiptDraft(draft);
    setDraft(result.draft);
    setErrors(result.errors);
    if (!result.valid) {
      setStatus(receiptCopy.requiredInfo);
      return;
    }
    setGenerated(true);
    setBusy("generate");
    try {
      await ensurePublicDraft(result.draft);
      setStatus(receiptCopy.completeSuccess);
    } catch (error) {
      setStatus(error.message === "receipt_draft_rate_limited"
          ? receiptCopy.rateLimited
          : receiptCopy.qrFailed);
    } finally {
      setBusy("");
    }
    trackMatchReceiptEvent("receipt_generated", {
      loggedIn: Boolean(auth?.session),
      matchType: result.draft.format,
      result: outcome.key,
    });
    window.requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function createPng(preset) {
    const result = validateMatchReceiptDraft(draft);
    if (!result.valid) {
      setErrors(result.errors);
      setStatus(receiptCopy.completeFirst);
      throw new Error("match_receipt_invalid");
    }
    let publicId = "";
    try {
      publicId = await ensurePublicDraft(result.draft);
    } catch {
      // A public QR is optional for local image export.
    }
    const publicMatchUrl = publicId
      ? applyReceiptLocaleToUrl(new URL(draftRef.current.publicCode
        ? `/app/receipt?code=${encodeURIComponent(draftRef.current.publicCode)}`
        : `/app/receipt?draft=${encodeURIComponent(publicId)}`, window.location.origin), receiptLocale).toString()
      : "";
    const renderDraft = normalizeMatchReceiptDraft({
      ...result.draft,
      receiptLocale,
      ...(publicDraftSerialSeedRef.current ? { serialSeed: publicDraftSerialSeedRef.current } : {}),
      ...(draftRef.current.publicCode ? { publicCode: draftRef.current.publicCode } : {}),
    });
    const blob = await renderMatchReceiptPng(renderDraft, preset, {
      publicId,
      matchUrl: publicMatchUrl,
      photoBlob,
      teamLineArtUrls: selectedTeamReceiptEmblemUrls,
      showPersonalTierIdentity: canShowCurrentUserIdentity,
      locale: receiptLocale,
    });
    return blob;
  }

  async function handleDownload(preset) {
    setBusy(`download-${preset}`);
    setStatus("");
    try {
      const blob = await createPng(preset);
      const fileName = getMatchReceiptFileName(draft, preset);
      const file = new File([blob], fileName, { type: "image/png" });
      if (isIosDevice(navigator) && canShareImageFile(navigator, file)) {
        await navigator.share({ title: receiptCopy.shareTitle, files: [file] });
        setStatus(receiptCopy.imageOpened);
        trackMatchReceiptEvent("receipt_downloaded", { loggedIn: Boolean(auth?.session), imagePreset: preset, method: "ios_share" });
      } else {
        downloadBlob(blob, fileName);
        setStatus(receiptCopy.imageSaved(MATCH_RECEIPT_CANVAS_SIZES[preset].label));
        trackMatchReceiptEvent("receipt_downloaded", { loggedIn: Boolean(auth?.session), imagePreset: preset, method: "download" });
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (error.message !== "match_receipt_invalid") {
        console.error("[match-receipt] image export failed", preset, error?.message, error?.stack);
        setStatus(receiptCopy.imageFailed);
      }
    } finally {
      setBusy("");
    }
  }

  async function handleShare() {
    setBusy("share");
    setStatus("");
    try {
      const preset = "story";
      const blob = await createPng(preset);
      const file = new File([blob], getMatchReceiptFileName(draft, preset), { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: receiptCopy.shareTitle, files: [file] });
        setStatus(receiptCopy.shareOpened);
        trackMatchReceiptEvent("receipt_shared", { loggedIn: Boolean(auth?.session), imagePreset: preset, method: "web_share" });
      } else {
        downloadBlob(blob, file.name);
        setStatus(receiptCopy.shareFallback);
        trackMatchReceiptEvent("receipt_downloaded", { loggedIn: Boolean(auth?.session), imagePreset: preset, method: "share_fallback" });
      }
    } catch (error) {
      if (error.name !== "AbortError" && error.message !== "match_receipt_invalid") {
        console.error("[match-receipt] image share failed", error);
        setStatus(receiptCopy.shareFailed);
      }
    } finally {
      setBusy("");
    }
  }

  async function copyCreatorLink() {
    try {
      const creatorUrl = applyReceiptLocaleToUrl(new URL("/app/receipt", window.location.origin), receiptLocale);
      await navigator.clipboard.writeText(creatorUrl.toString());
      setStatus(receiptCopy.creatorCopied);
    } catch {
      setStatus(receiptCopy.creatorCopyFailed);
    }
  }

  async function continueWithLogin() {
    setBusy("login");
    trackMatchReceiptEvent("receipt_save_login_started", { loggedIn: false, matchType: draft.format });
    try {
      const publicId = await ensurePublicDraft(draft, { forClaim: true });
      const returnTo = `${MATCH_RECEIPT_CREATE_RETURN_TO}&receiptDraft=${encodeURIComponent(publicId)}`;
      const backTo = `${location.pathname}${location.search}${location.hash}`;
      navigate(getLoginPath(returnTo, backTo));
    } catch (error) {
      setStatus(error.message === "receipt_draft_rate_limited"
          ? receiptCopy.rateLimited
          : receiptCopy.loginDraftFailed);
    } finally {
      setBusy("");
    }
  }

  async function continueToRecord() {
    if (!auth?.session) {
      await continueWithLogin();
      return;
    }
    setBusy("continue");
    try {
      const publicId = await ensurePublicDraft(draft, { forClaim: true });
      navigate(`${MATCH_RECEIPT_CREATE_RETURN_TO}&receiptDraft=${encodeURIComponent(publicId)}`);
    } catch (error) {
      setStatus(error.message === "receipt_draft_rate_limited"
          ? receiptCopy.recordDraftRateLimited
          : receiptCopy.recordDraftFailed);
    } finally {
      setBusy("");
    }
  }

  function returnFromReceipt() {
    if (location.key === "default") {
      navigate("/app", { replace: true });
      return;
    }
    navigate(-1);
  }

  return (
    <section className="page-stack match-receipt-page">
      <header className="page-header match-receipt-page-head ui-page-hero ui-design-app-hero">
        <div className="ui-page-hero__copy">
          <p className="eyebrow">{receiptCopy.eyebrow}</p>
          <h1>{receiptCopy.title}</h1>
          <p>{receiptCopy.description}</p>
        </div>
        <nav className="match-receipt-page-head-nav" aria-label={receiptCopy.navLabel}>
          <Button variant="secondary" onClick={returnFromReceipt}>
            <ArrowLeft aria-hidden="true" size={17} /> {receiptCopy.back}
          </Button>
          <Button as={Link} to="/app" variant="secondary">
            <House aria-hidden="true" size={17} /> {receiptCopy.home}
          </Button>
        </nav>
      </header>
      <div className="match-receipt-page-controls" aria-label={receiptCopy.style}>
          <div className="match-receipt-compact-toggle" role="group" aria-label={receiptCopy.style}>
            <button type="button" aria-pressed={!isThermal} onClick={() => updateField("receiptStyle", MATCH_RECEIPT_STYLES.score)}>BOXTIER</button>
            <button type="button" aria-pressed={isThermal} onClick={() => updateField("receiptStyle", MATCH_RECEIPT_STYLES.thermal)}>THERMAL</button>
          </div>
          <div className="match-receipt-locale-switch" role="group" aria-label="Receipt language">
            <Button type="button" variant={!isEnglish ? "primary" : "ghost"} size="sm" lang="ko" aria-label={isEnglish ? "Korean" : "한국어"} aria-pressed={!isEnglish} onClick={() => selectReceiptLocale("ko")}>🇰🇷</Button>
            <Button type="button" variant={isEnglish ? "primary" : "ghost"} size="sm" lang="en" aria-label="English" aria-pressed={isEnglish} onClick={() => selectReceiptLocale("en")}>🇺🇸</Button>
          </div>
      </div>

      {requestedPublicCode ? (
        <section className="ui-panel">
          <EmptyState
            tone={publicCodeLookup === "loading" || publicCodeLookup === "idle" ? "loading" : "error"}
            title={publicCodeLookup === "loading" || publicCodeLookup === "idle"
              ? receiptCopy.loadingTitle
              : publicCodeLookup === "not-found"
                ? receiptCopy.notFoundTitle
                : receiptCopy.loadFailedTitle}
            description={publicCodeLookup === "loading" || publicCodeLookup === "idle"
              ? receiptCopy.loadingDescription
              : publicCodeLookup === "not-found"
                ? receiptCopy.notFoundDescription
                : receiptCopy.retryDescription}
            action={publicCodeLookup === "not-found" ? (
              <Button as={Link} to={`/app/receipt${getReceiptSearchWithLocale("", receiptLocale)}`} variant="secondary">{receiptCopy.newReceipt}</Button>
            ) : publicCodeLookup === "error" ? (
              <Button type="button" variant="secondary" onClick={() => setPublicCodeLookupAttempt((current) => current + 1)}>{receiptCopy.retry}</Button>
            ) : null}
          />
        </section>
      ) : (
        <div className="match-receipt-workspace">
        <form className="match-receipt-editor" onSubmit={completeReceipt}>
          <section className="ui-panel">
            <h2>{receiptCopy.finalScore}</h2>
            {receiptIsReadOnly ? <p className="match-receipt-locked-note">{receiptCopy.readOnlyNote}</p> : null}
            {canonicalMatchId ? <p className="match-receipt-locked-note">{receiptCopy.canonicalNote}</p> : null}
            <div className="match-receipt-team-fields">
              <fieldset>
                <legend>{receiptCopy.teamA}</legend>
                <label>
                  {receiptCopy.teamName}
                  <input value={draft.homeTeam} maxLength={MATCH_RECEIPT_LIMITS.teamName} disabled={isFieldReadOnly("homeTeam")} placeholder={errors.homeTeam ? receiptCopy.requiredTeam(receiptCopy.teamA) : receiptCopy.teamA} onChange={(event) => updateField("homeTeam", event.target.value)} aria-invalid={Boolean(errors.homeTeam)} />
                </label>
                <label className="match-receipt-score-input">
                  {receiptCopy.score}
                  <input type="number" inputMode="numeric" min="0" max={MATCH_RECEIPT_LIMITS.score} value={draft.homeScore} disabled={isFieldReadOnly("homeScore")} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.value === "0" && event.currentTarget.select()} onChange={(event) => updateField("homeScore", event.target.value)} />
                </label>
              </fieldset>

              <fieldset>
                <legend>{receiptCopy.teamB}</legend>
                <label>
                  {receiptCopy.teamName}
                  <input value={draft.awayTeam} maxLength={MATCH_RECEIPT_LIMITS.teamName} disabled={isFieldReadOnly("awayTeam")} placeholder={errors.awayTeam ? receiptCopy.requiredTeam(receiptCopy.teamB) : receiptCopy.teamB} onChange={(event) => updateField("awayTeam", event.target.value)} aria-invalid={Boolean(errors.awayTeam)} />
                </label>
                <label className="match-receipt-score-input">
                  {receiptCopy.score}
                  <input type="number" inputMode="numeric" min="0" max={MATCH_RECEIPT_LIMITS.score} value={draft.awayScore} disabled={isFieldReadOnly("awayScore")} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.value === "0" && event.currentTarget.select()} onChange={(event) => updateField("awayScore", event.target.value)} />
                </label>
              </fieldset>
            </div>
          </section>

          <section className="ui-panel">
            <h2>{receiptCopy.info}</h2>
            <div className="match-receipt-info-fields">
              <label>{receiptCopy.date}<input type="date" value={draft.playedOn} disabled={isFieldReadOnly("playedOn")} onChange={(event) => updateField("playedOn", event.target.value)} /></label>
              <label>{receiptCopy.time}<input type="time" value={draft.playedTime} disabled={isFieldReadOnly("playedTime")} onChange={(event) => updateField("playedTime", event.target.value)} /></label>
              <label>{receiptCopy.format}<select value={draft.format} disabled={isFieldReadOnly("format")} onChange={(event) => updateField("format", event.target.value)}>{MATCH_RECEIPT_FORMATS.map((item) => <option key={item.value} value={item.value}>{isEnglish ? item.value.toUpperCase() : item.label}</option>)}</select></label>
              <label>{receiptCopy.nature}<select value={draft.matchNature} disabled={isFieldReadOnly("matchNature")} onChange={(event) => updateField("matchNature", event.target.value)}>{MATCH_RECEIPT_NATURES.map((item) => <option key={item.value} value={item.value}>{isEnglish ? item.value.toUpperCase() : item.label}</option>)}</select></label>
              {!isEnglish ? <label className="is-wide">
                경기 장소
                <span className="match-receipt-venue-control">
                  <input value={draft.venue} maxLength={MATCH_RECEIPT_LIMITS.venue} disabled={isFieldReadOnly("venue")} readOnly placeholder={errors.venue ? "경기 장소 또는 짧은 장소가 필요합니다" : "지도에서 선택 · 자유 입력은 짧은 장소에 작성"} aria-invalid={Boolean(errors.venue)} />
                  {!isFieldReadOnly("venue") ? (
                    <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md match-receipt-map-button" onClick={() => setCourtMapOpen(true)}>
                      <MapPin aria-hidden="true" /> {receiptCopy.map}
                    </button>
                  ) : null}
                </span>
              </label> : null}
              <label className="is-wide">{receiptCopy.venue} <input value={draft.address} maxLength={MATCH_RECEIPT_LIMITS.address} disabled={isFieldReadOnly("address")} placeholder={receiptCopy.venuePlaceholder} onChange={(event) => updateField("address", event.target.value)} /></label>
              <label className="is-wide">{receiptCopy.tournament} <input value={draft.tournamentName} maxLength={MATCH_RECEIPT_LIMITS.tournamentName} disabled={isFieldReadOnly("tournamentName")} placeholder={receiptCopy.tournamentPlaceholder} onChange={(event) => updateField("tournamentName", event.target.value)} /></label>
              <fieldset className="match-receipt-line-art-fields is-wide">
                <legend>{receiptCopy.teamEmblems} <small>{receiptCopy.optional}</small></legend>
                <p className="match-receipt-emblem-guide">
                  {isThermal
                    ? (isEnglish ? "Choose an emblem. It is converted to thermal black and white in the output." : "엠블럼을 고르면 출력물에서 감열 흑백으로 변환합니다.")
                    : (isEnglish ? "Choose an image to create a line-art emblem for this receipt. Save it to a team after signing in to reuse it." : "사진을 골라 선화 엠블럼으로 바로 사용할 수 있습니다. 로그인 후 팀을 만들면 팀 상세에 저장해 다음 영수증에서도 재사용할 수 있습니다.")}
                </p>
                <div className="match-receipt-emblem-upload-grid">
                  {[["home", "TEAM A"], ["away", "TEAM B"]].map(([side, label]) => {
                    const activeEmblemUrl = selectedTeamReceiptEmblemUrls[side];
                    return (
                      <div className="match-receipt-emblem-upload" key={side}>
                        <strong>{label}</strong>
                        {!receiptIsReadOnly ? (
                          <Button
                            as="label"
                            variant="secondary"
                            size="sm"
                            disabled={Boolean(busy) || emblemPending}
                          >
                            <ImagePlus aria-hidden="true" /> {isThermal ? (isEnglish ? "Choose Emblem" : "엠블럼 선택") : receiptCopy.selectLineArt}
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
                              disabled={Boolean(busy) || emblemPending}
                              onChange={(event) => handleLocalTeamEmblemChange(side, event)}
                            />
                          </Button>
                        ) : null}
                        {!receiptIsReadOnly && !canonicalMatchId && savedReceiptEmblemTeams.length ? (
                          <label className="match-receipt-saved-emblem">
                            <span>{receiptCopy.savedEmblem}</span>
                            <select
                              value={draft[`${side}EmblemKey`] || ""}
                              onChange={(event) => selectSavedTeamReceiptEmblem(side, event.target.value)}
                            >
                              <option value="">{receiptCopy.chooseSavedEmblem}</option>
                              {savedReceiptEmblemTeams.map((team) => (
                                <option key={team.id} value={team.receiptEmblemKey}>{team.name}</option>
                              ))}
                            </select>
                          </label>
                        ) : !activeEmblemUrl ? (
                          <small>{receiptCopy.noSavedEmblem}</small>
                        ) : null}
                        {activeEmblemUrl ? (
                          <div className="match-receipt-emblem-candidates" aria-label={isEnglish ? `${label} emblem preview` : `${label} 엠블럼 후보`}>
                            <img src={activeEmblemUrl} alt={isThermal ? (isEnglish ? `${label} emblem preview` : `${label} 엠블럼 미리보기`) : (isEnglish ? `${label} line-art preview` : `${label} 선화 후보`)} />
                          </div>
                        ) : null}
                        {activeEmblemUrl ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={receiptIsReadOnly}
                            onClick={() => updateField(`${side}UseLineArt`, !draft[`${side}UseLineArt`])}
                          >
                            {draft[`${side}UseLineArt`]
                              ? (isThermal ? (isEnglish ? "Remove Emblem" : "엠블럼 사용 해제") : (isEnglish ? "Use Original" : "선화 사용 해제"))
                              : (isThermal ? (isEnglish ? "Use Emblem" : "엠블럼 다시 사용") : (isEnglish ? "Use Line Art" : "선화 다시 사용"))}
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <small>{isEnglish ? "Selected images stay on this device and apply only to this receipt." : "직접 선택한 이미지는 이번 영수증에서만 유지됩니다."}</small>
                {!receiptIsReadOnly ? (
                  <Button
                    as={Link}
                    to={auth?.session
                      ? "/app/teams"
                      : getLoginPath("/app/teams", `${location.pathname}${location.search}${location.hash}`)}
                    variant="secondary"
                    size="sm"
                  >
                    {auth?.session ? receiptCopy.createTeamSave : receiptCopy.loginCreateTeamSave}
                  </Button>
                ) : null}
              </fieldset>
              <fieldset className="match-receipt-period-fields is-wide">
                <legend>{receiptCopy.periodScores} <small>{receiptCopy.optional}</small></legend>
                {RECEIPT_PERIOD_FIELDS.map(([label, homeField, awayField]) => (
                  <label key={label}>
                    <span>{label}</span>
                    <input type="number" min="0" max={MATCH_RECEIPT_LIMITS.score} inputMode="numeric" value={draft[homeField] ?? ""} disabled={isFieldReadOnly(homeField)} aria-label={receiptCopy.periodScoreAria(label, receiptCopy.teamA)} placeholder="A" onChange={(event) => updateField(homeField, event.target.value)} />
                    <i>:</i>
                    <input type="number" min="0" max={MATCH_RECEIPT_LIMITS.score} inputMode="numeric" value={draft[awayField] ?? ""} disabled={isFieldReadOnly(awayField)} aria-label={receiptCopy.periodScoreAria(label, receiptCopy.teamB)} placeholder="B" onChange={(event) => updateField(awayField, event.target.value)} />
                  </label>
                ))}
              </fieldset>
              <label className="is-wide">
                <span className="match-receipt-field-heading">
                  <span>{receiptCopy.comment}</span>
                  <span className="match-receipt-field-count">{`${commentLength}/${MATCH_RECEIPT_COMMENT_MAX_LENGTH}`}</span>
                </span>
                <input value={draft.comment} maxLength={MATCH_RECEIPT_COMMENT_MAX_LENGTH} disabled={isFieldReadOnly("comment")} placeholder={receiptCopy.commentPlaceholder} onChange={(event) => updateField("comment", event.target.value)} />
              </label>
              <label className="match-receipt-check-field is-wide">
                <input type="checkbox" checked={draft.includePhoto} disabled={receiptIsReadOnly} onChange={(event) => updateField("includePhoto", event.target.checked)} />
                <span>{receiptCopy.includePhoto}</span>
              </label>
            </div>
            {!isEnglish ? <p className="match-receipt-map-note"><MapPin aria-hidden="true" /> 이미지에는 경기 장소 또는 짧은 장소만 들어갑니다. 지도 화면은 포함하지 않습니다.</p> : null}
          </section>

          {!receiptIsReadOnly ? <div className="match-receipt-photo-tools">
            {photoUrl ? (
              <div className="match-receipt-photo-editor-shell" style={{ aspectRatio: photoEditorAspect }}>
                <div
                  ref={photoEditorRef}
                  className="match-receipt-photo-editor"
                  style={getMatchReceiptPhotoStyle(draft, photoEditorAspect)}
                  aria-label={receiptCopy.photoActionsAria}
                  onPointerDown={beginPhotoGesture}
                  onPointerMove={movePhotoGesture}
                  onPointerUp={endPhotoGesture}
                  onPointerCancel={endPhotoGesture}
                  onLostPointerCapture={endPhotoGesture}
                  onWheel={zoomPhotoWithWheel}
                  onDoubleClick={resetPhotoTransform}
                >
                  <img className="match-receipt-photo-editor-image" src={photoUrl} alt="" draggable="false" />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="match-receipt-photo-editor-rotate"
                  aria-label={receiptCopy.rotatePhotoAria}
                  title={receiptCopy.rotatePhotoTitle}
                  onPointerDown={beginPhotoRotation}
                  onPointerMove={movePhotoRotation}
                  onPointerUp={endPhotoRotation}
                  onPointerCancel={endPhotoRotation}
                  onLostPointerCapture={endPhotoRotation}
                  onKeyDown={nudgePhotoRotation}
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
              </div>
            ) : null}
            <div className="match-receipt-photo-actions" aria-label={receiptCopy.photoActionsAria}>
              <Button as="label" variant="secondary">
                <ImagePlus aria-hidden="true" /> {receiptCopy.selectPhoto}
                <input className="match-receipt-photo-input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy === "photo"} onChange={handlePhotoChange} />
              </Button>
              <Button variant="secondary" disabled={!photoUrl || Boolean(busy)} onClick={() => updateField("photoRotation", draft.photoRotation + 90)}><RotateCcw aria-hidden="true" /> {receiptCopy.rotate90}</Button>
              <Button variant="danger" disabled={!photoUrl || Boolean(busy)} onClick={removePhoto}><Trash2 aria-hidden="true" /> {receiptCopy.remove}</Button>
              <Button
                variant="secondary"
                disabled={Boolean(busy)}
                title={receiptCopy.resetTitle}
                onClick={resetReceipt}
              >
                <RotateCcw aria-hidden="true" /> {receiptCopy.reset}
              </Button>
            </div>
            <p className="match-receipt-photo-note">
              {photoUrl
                ? receiptCopy.photoEditHelp
                : receiptCopy.photoSelectHelp} · {receiptCopy.localPhotoOnly}
            </p>
          </div> : null}

          <button type="submit" className="button ui-button button-primary ui-button-primary button-md ui-button-md match-receipt-complete" disabled={receiptIsReadOnly || Boolean(busy)}>{receiptCopy.complete}</button>
          {status ? <p className="match-receipt-status" role="status">{status}</p> : null}
        </form>

        <aside className="match-receipt-preview-panel" ref={previewRef}>
          <div className="match-receipt-preview-head">
            <div><span>{receiptCopy.preview}</span></div>
            <span>{isThermal ? "THERMAL RECEIPT" : "9:16 STORY"}</span>
          </div>
          <div className={`match-receipt-preview-stage${isThermal ? " is-thermal" : ""}`}>
            {isThermal ? (
              <ThermalReceiptPreview
                draft={receiptPreviewDraft}
                photoBlob={photoBlob}
                matchUrl={matchUrl}
                publicId={receiptPublicId}
                teamLineArtUrls={selectedTeamReceiptEmblemUrls}
                suspendRender={photoGestureActive}
              />
            ) : (
              <MatchReceiptPreview
                draft={receiptPreviewDraft}
                photoUrl={draft.includePhoto ? photoUrl : ""}
                matchUrl={matchUrl}
                publicId={receiptPublicId}
                showPersonalTierIdentity={canShowCurrentUserIdentity}
                locale={receiptLocale}
                teamLineArtUrls={selectedTeamReceiptEmblemUrls}
              />
            )}
          </div>
          {generated ? (
            <div className="match-receipt-actions">
              <button type="button" className="button ui-button button-primary ui-button-primary button-md ui-button-md" disabled={Boolean(busy)} onClick={handleShare}><Share2 aria-hidden="true" /> {receiptCopy.share}</button>
              <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" disabled={Boolean(busy)} onClick={() => handleDownload("story")}><Download aria-hidden="true" /> {receiptCopy.story}</button>
              <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" disabled={Boolean(busy)} onClick={() => handleDownload("feed")}><Download aria-hidden="true" /> {receiptCopy.post}</button>
              <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" disabled={Boolean(busy)} onClick={copyCreatorLink}><Copy aria-hidden="true" /> {receiptCopy.create}</button>
            </div>
          ) : null}

          {generated ? (
            <section className="ui-panel match-receipt-save-card">
              <h2>{canonicalMatchId ? receiptCopy.savedTitle : receiptCopy.importTitle}</h2>
              {canonicalMatchId ? (
                <>
                  <p>{receiptCopy.savedDescription}</p>
                  <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" onClick={() => navigate("/app/profile/records")}>{receiptCopy.viewRecords}</button>
                </>
              ) : auth?.session ? (
                <>
                  <p>{receiptCopy.continueDescription}</p>
                  <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" onClick={continueToRecord}>{receiptCopy.continueRecord}</button>
                </>
              ) : (
                <>
                  <p>{receiptCopy.guestContinueDescription}</p>
                  <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" disabled={Boolean(busy)} onClick={continueToRecord}>{receiptCopy.continueRecord}</button>
                </>
              )}
            </section>
          ) : null}
        </aside>
        </div>
      )}
      {!requestedPublicCode ? (
        <>
          {!isEnglish ? <CourtMapPicker
            open={courtMapOpen}
            courts={registeredCourts}
            selectedCourt={selectedCourt}
            currentRegion={courtMapRegion}
            loading={courtMapDirectoryStatus.loading}
            loadError={courtMapDirectoryStatus.error}
            onSelect={selectCourt}
            onClose={() => setCourtMapOpen(false)}
          /> : null}
          <EmblemCropEditor
            file={emblemEditor.file}
            locale={receiptLocale}
            circular
            pending={emblemPending}
            convertedPreview={emblemEditor.preview}
            warning={receiptCopy.emblemWarning}
            labels={receiptCopy.emblemEditor}
            conversionMode={isThermal ? "monochrome" : "line-art"}
            aiPrompt={isThermal ? "" : MATCH_RECEIPT_LINE_ART_AI_PROMPT}
            onCopyAiPrompt={isThermal ? undefined : copyLineArtPrompt}
            error={emblemEditor.error}
            onCropChange={resetLocalTeamEmblemConversion}
            onCancel={() => setEmblemEditor(EMPTY_EMBLEM_EDITOR)}
            onConvert={isThermal ? undefined : convertLocalTeamEmblem}
            onConfirm={confirmLocalTeamEmblem}
          />
        </>
      ) : null}
    </section>
  );
}
