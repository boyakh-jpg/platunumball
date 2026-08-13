import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, ImagePlus, MapPin, RotateCcw, Share2, Trash2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import QrCode from "../components/common/QrCode.jsx";
import CourtMapPicker from "../components/court/CourtMapPicker.jsx";
import { getCourtAddress, getRegisteredCourts, mergeCourtSearchCourts } from "../lib/courts.js";
import { inferRegionSelection } from "../lib/profileSetup.js";
import { COURT_MAP_SEARCH_LIMIT, COURT_MAP_SEARCH_PURPOSE } from "../lib/queryPolicy.js";
import { postServerAction } from "../lib/serverActions.js";
import {
  MATCH_RECEIPT_CANVAS_SIZES,
  MATCH_RECEIPT_CREATE_RETURN_TO,
  MATCH_RECEIPT_FORMATS,
  MATCH_RECEIPT_NATURES,
  MATCH_RECEIPT_LIMITS,
  MATCH_RECEIPT_PHOTO_MAX_BYTES,
  clearMatchReceiptPhoto,
  createMatchReceiptViewModel,
  createDefaultMatchReceiptDraft,
  getMatchReceiptCreateDraft,
  getMatchReceiptDraftFromMatch,
  getMatchReceiptFileName,
  getMatchReceiptFormatLabel,
  getMatchReceiptOutcome,
  getMatchReceiptPhotoStyle,
  loadMatchReceiptPhoto,
  loadMatchReceiptDraft,
  normalizeMatchReceiptPhotoFile,
  normalizeMatchReceiptDraft,
  renderMatchReceiptPng,
  saveMatchReceiptPhoto,
  saveMatchReceiptDraft,
  trackMatchReceiptEvent,
  validateMatchReceiptDraft,
} from "../lib/matchReceipt.js";

function loadDraft() {
  return loadMatchReceiptDraft() ?? createDefaultMatchReceiptDraft();
}

const CANONICAL_RECEIPT_FIELDS = new Set([
  "homeTeam",
  "awayTeam",
  "homeScore",
  "awayScore",
  "playedOn",
  "format",
  "matchNature",
  "venue",
  "address",
  "comment",
]);

const RECEIPT_TEXT_FIELDS = new Set([
  "homeTeam",
  "awayTeam",
  "venue",
  "address",
  "comment",
]);

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

function ReceiptPreview({ draft, photoUrl = "", matchUrl = "", photoGestureHandlers = {} }) {
  const model = createMatchReceiptViewModel(draft, { matchUrl });
  const backgroundUrl = photoUrl || model.defaultPhotoUrl;
  const posterTeams = [
    { name: model.homeTeam, tier: model.homeTier, neutralMarkUrl: model.neutralTeamMarkUrls.home },
    { name: model.awayTeam, tier: model.awayTier, neutralMarkUrl: model.neutralTeamMarkUrls.away },
  ];

  return (
    <article
      className="match-receipt-card"
      style={{
        "--receipt-home": model.homeColor,
        "--receipt-away": model.awayColor,
        "--receipt-paper-texture": `url("${model.paperUrl}")`,
        ...getMatchReceiptPhotoStyle(model, undefined, { defaultPhoto: !photoUrl }),
      }}
      aria-label="경기 영수증 미리보기"
    >
      <div
        className={`match-receipt-photo${photoUrl ? " is-editable" : " is-default"}`}
        aria-label={photoUrl ? "영수증 배경 사진 편집" : undefined}
        {...photoGestureHandlers}
      >
        {!photoUrl ? <img className="match-receipt-photo-backdrop" src={backgroundUrl} alt="" aria-hidden="true" /> : null}
        <img className="match-receipt-photo-image" src={backgroundUrl} alt="" />
      </div>
      <header className="match-receipt-poster-head">
        <span className="match-receipt-wordmark">
          <img
            src={model.wordmarkUrl}
            alt="BOXTIER"
            onError={(event) => {
              event.currentTarget.hidden = true;
              event.currentTarget.nextElementSibling?.removeAttribute("hidden");
            }}
          />
          <strong hidden>BOXTIER</strong>
        </span>
        <span>{model.serial}</span>
      </header>
      <div className={`match-receipt-verified${model.verified ? "" : " is-receipt"}`}>★ <i /> {model.verified ? "BOXTIER VERIFIED" : "MATCH RECEIPT"} <i /> ★</div>
      <div className="match-receipt-team-watermarks" aria-hidden="true">
        {posterTeams.map((team, index) => (
          <span key={index}>
            <img
              className={model.showTeamTierEmblems && team.tier ? "" : "is-neutral"}
              src={model.showTeamTierEmblems && team.tier ? team.tier.outlineSrc : team.neutralMarkUrl}
              alt=""
            />
          </span>
        ))}
      </div>
      <section className="match-receipt-poster-score">
        <span>{model.matchNatureLabel}</span>
        <div aria-label={`${model.homeScore} 대 ${model.awayScore}`}>
          <strong>{model.homeScore}</strong>
          <span>:</span>
          <strong>{model.awayScore}</strong>
        </div>
      </section>
      <section className="match-receipt-poster-teams">
        {posterTeams.map((team, index) => (
          <div key={index}>
            <strong>{team.name || (index ? "AWAY TEAM" : "HOME TEAM")}</strong>
            <img
              className={`match-receipt-team-tier${model.showTeamTierEmblems && team.tier ? "" : " is-neutral"}`}
              src={model.showTeamTierEmblems && team.tier ? team.tier.outlineSrc : team.neutralMarkUrl}
              alt=""
              aria-hidden="true"
            />
            {model.showTeamTierEmblems && team.tier ? <span>{`TEAM TIER · ${team.tier.label}`}</span> : null}
          </div>
        ))}
      </section>
      <footer className="match-receipt-ticket">
        <img className="match-receipt-ticket-paper" src={model.paperUrl} alt="" aria-hidden="true" />
        <div className="match-receipt-ticket-place">
          <MapPin aria-hidden="true" />
          <strong>{[model.address, model.venue].filter(Boolean).join(" · ") || "경기 장소"}</strong>
          <span className="match-receipt-ticket-date">{model.playedOn.replaceAll("-", ".")}</span>
        </div>
        <div className="match-receipt-ticket-game">
          {model.personalTier ? (
            <div className="match-receipt-personal-tier-mark" aria-hidden="true">
              <img className="match-receipt-personal-tier is-watermark" src={model.personalTier.outlineSrc} alt="" />
              <small className="match-receipt-personal-tier-label">MY TIER · {model.personalTier.label}</small>
            </div>
          ) : null}
          {model.personalTier && model.hasPersonalStats ? <strong>MY GAME</strong> : !model.personalTier ? <strong>{getMatchReceiptFormatLabel(model.format)}</strong> : null}
          {model.hasPersonalStats ? (
            <span className="match-receipt-personal-stats">
              <b><em>{model.personalPoints ?? 0}</em><small>PTS</small></b>
              <b><em>{model.personalRebounds ?? 0}</em><small>REB</small></b>
            </span>
          ) : model.personalTier ? null : <span>{model.outcome.label}</span>}
          {model.comment || model.hasPersonalStats ? (
            <span className="match-receipt-ticket-caption">{model.comment || "내 경기 기록"}</span>
          ) : null}
        </div>
        <div className="match-receipt-ticket-qr">
          <strong>{matchUrl ? "경기 기록 보기" : "boxtier.kr"}</strong>
          {matchUrl ? <QrCode value={matchUrl} label="경기 열기 QR 코드" className="match-receipt-qr" branded /> : null}
        </div>
      </footer>
    </article>
  );
}

export default function MatchReceipt({ auth, app }) {
  const location = useLocation();
  const navigate = useNavigate();
  const matchId = useMemo(
    () => new URLSearchParams(location.search).get("match")?.trim() ?? "",
    [location.search],
  );
  const requestedPublicDraftId = useMemo(
    () => new URLSearchParams(location.search).get("draft")?.trim() ?? "",
    [location.search],
  );
  const sourceDraftRef = useRef(location.state?.receiptDraft
    ? normalizeMatchReceiptDraft(location.state.receiptDraft)
    : null);
  const [draft, setDraft] = useState(() => sourceDraftRef.current ?? loadDraft());
  const [errors, setErrors] = useState({});
  const [generated, setGenerated] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [photoBlob, setPhotoBlob] = useState(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [publicDraftId, setPublicDraftId] = useState(requestedPublicDraftId);
  const [courtMapOpen, setCourtMapOpen] = useState(false);
  const [selectedCourtId, setSelectedCourtId] = useState("");
  const [discoveredCourts, setDiscoveredCourts] = useState([]);
  const [courtMapDirectoryStatus, setCourtMapDirectoryStatus] = useState({ loading: false, error: "" });
  const startedRef = useRef(false);
  const requestedMatchIdRef = useRef("");
  const courtMapRequestIdRef = useRef(0);
  const previewRef = useRef(null);
  const photoGestureRef = useRef({ pointers: new Map(), baseline: null });
  const photoTransformRef = useRef(null);
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
  const currentUserId = auth?.session?.user?.id ?? "";
  const currentUserMmr = Number(app?.currentUser?.ratings?.integrated);
  const personalMmr = currentUserId && Number.isFinite(currentUserMmr) ? currentUserMmr : null;
  const directoryCourts = useMemo(() => getRegisteredCourts(app?.state ?? {}), [app?.state]);
  const registeredCourts = useMemo(
    () => mergeCourtSearchCourts(directoryCourts, discoveredCourts),
    [directoryCourts, discoveredCourts],
  );
  const profileCourtRegion = useMemo(() => (
    [app?.currentUser?.regionSido, app?.currentUser?.regionDistrict].filter(Boolean).join(" ").trim()
      || String(app?.currentUser?.region ?? "").trim()
  ), [app?.currentUser?.region, app?.currentUser?.regionDistrict, app?.currentUser?.regionSido]);
  const courtMapRegionSource = String(draft.address || profileCourtRegion).trim();
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
  const readOnlyReceipt = Boolean(canonicalMatchId || requestedPublicDraftId);
  const matchUrl = useMemo(() => (
    typeof window !== "undefined" && (canonicalMatchId || publicDraftId)
      ? new URL(canonicalMatchId
        ? `/app/matches?match=${encodeURIComponent(canonicalMatchId)}`
        : `/app/receipt?draft=${encodeURIComponent(publicDraftId)}`, window.location.origin).toString()
      : ""
  ), [canonicalMatchId, publicDraftId]);

  useEffect(() => {
    if (!matchId) return;
    if (canonicalMatch) {
      setDraft((current) => getMatchReceiptDraftFromMatch(canonicalMatch, {
        ...current,
        currentUserId,
        personalMmr,
        tournament: canonicalTournament,
      }));
      setGenerated(true);
      setStatus("");
      return;
    }
    if (requestedMatchIdRef.current === matchId) return;
    requestedMatchIdRef.current = matchId;
    Promise.resolve(app?.actions?.loadMatchDetail?.(matchId)).then((loaded) => {
      if (!loaded) setStatus("저장된 경기 기록을 불러오지 못했습니다.");
    });
  }, [app?.actions, canonicalMatch, canonicalTournament, currentUserId, matchId, personalMmr]);

  useEffect(() => {
    if (requestedPublicDraftId || canonicalMatchId) return;
    setDraft((current) => current.personalMmr === personalMmr
      ? current
      : normalizeMatchReceiptDraft({ ...current, personalMmr }));
  }, [canonicalMatchId, personalMmr, requestedPublicDraftId]);

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
        setDraft(normalizeMatchReceiptDraft(result.draft));
        setGenerated(true);
        setStatus(result.claimed ? "내 기록으로 전환된 경기 영수증입니다." : "공유된 경기 영수증입니다.");
      })
      .catch(() => {
        if (active) setStatus("공유된 영수증이 만료됐거나 존재하지 않습니다.");
      });
    return () => {
      active = false;
    };
  }, [canonicalMatchId, requestedPublicDraftId]);

  useEffect(() => {
    if (requestedPublicDraftId) return undefined;
    let active = true;
    loadMatchReceiptPhoto().then((blob) => {
      if (active && blob) setPhotoBlob(blob);
    });
    return () => {
      active = false;
    };
  }, [requestedPublicDraftId]);

  useEffect(() => {
    if (!courtMapOpen) return undefined;
    if (!courtMapRegion) {
      setCourtMapDirectoryStatus({ loading: false, error: "주소를 입력하거나 프로필 지역을 설정해 주세요." });
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
    if (!requestedPublicDraftId) saveMatchReceiptDraft(draft);
  }, [draft, requestedPublicDraftId]);

  function updateField(name, value) {
    if (readOnlyReceipt && CANONICAL_RECEIPT_FIELDS.has(name)) return;
    if (!startedRef.current) {
      startedRef.current = true;
      trackMatchReceiptEvent("receipt_started", { loggedIn: Boolean(auth?.session) });
    }
    setDraft((current) => RECEIPT_TEXT_FIELDS.has(name)
      ? { ...current, [name]: String(value ?? "") }
      : normalizeMatchReceiptDraft({ ...current, [name]: value }));
    if (publicDraftId && !requestedPublicDraftId) setPublicDraftId("");
    setErrors((current) => (current[name] ? { ...current, [name]: "" } : current));
    setGenerated(Boolean(canonicalMatchId));
    setStatus("");
  }

  function selectCourt(court) {
    if (!court || readOnlyReceipt) return;
    const courtAddress = getCourtAddress(court);
    const venue = court.name ?? "";
    const address = court.region || (courtAddress === "주소 미등록" ? "" : courtAddress);
    setSelectedCourtId(String(court.id ?? ""));
    setDraft((current) => normalizeMatchReceiptDraft({ ...current, venue, address }));
    if (publicDraftId && !requestedPublicDraftId) setPublicDraftId("");
    setErrors((current) => ({ ...current, venue: "", address: "" }));
    setGenerated(Boolean(canonicalMatchId));
    setStatus("");
    setCourtMapOpen(false);
  }

  async function handlePhotoChange(event) {
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
      setStatus("사진을 적용했습니다. 서버에는 업로드하지 않습니다.");
    } catch (error) {
      setStatus(error.message === "match_receipt_photo_size"
        ? `사진은 ${Math.round(MATCH_RECEIPT_PHOTO_MAX_BYTES / 1024 / 1024)}MB 이하만 사용할 수 있습니다.`
        : "사진을 읽지 못했습니다. JPG, PNG, WebP 파일을 확인해 주세요.");
    } finally {
      setBusy("");
    }
  }

  async function removePhoto() {
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
    setStatus("사진을 제거했습니다.");
  }

  function resetPhotoTransform() {
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

    setDraft((current) => {
      const next = normalizeMatchReceiptDraft({
        ...current,
        photoX: baseline.photoX + (snapshot.centerX - baseline.centerX) / baseline.width * 200,
        photoY: baseline.photoY + (snapshot.centerY - baseline.centerY) / baseline.height * 200,
        photoZoom,
        photoRotation,
      });
      photoTransformRef.current = {
        photoX: next.photoX,
        photoY: next.photoY,
        photoZoom: next.photoZoom,
        photoRotation: next.photoRotation,
      };
      return next;
    });
  }

  function endPhotoGesture(event) {
    const gesture = photoGestureRef.current;
    if (!gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.delete(event.pointerId);
    gesture.baseline = getPhotoGestureBaseline(event.currentTarget, gesture.pointers);
  }

  async function ensurePublicDraft(value = draft) {
    if (canonicalMatchId || publicDraftId) return publicDraftId;
    const response = await fetch("/api/match-receipts/draft", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: value }),
    });
    if (!response.ok) throw new Error(response.status === 429 ? "receipt_draft_rate_limited" : "receipt_draft_create_failed");
    const result = await response.json();
    setPublicDraftId(result.publicId);
    return result.publicId;
  }

  async function completeReceipt(event) {
    event.preventDefault();
    const result = validateMatchReceiptDraft(draft);
    setDraft(result.draft);
    setErrors(result.errors);
    if (!result.valid) {
      setStatus("필수 정보를 확인해 주세요.");
      return;
    }
    setGenerated(true);
    setBusy("generate");
    try {
      await ensurePublicDraft(result.draft);
      setStatus("경기 영수증이 완성됐습니다.");
    } catch (error) {
      setStatus(error.message === "receipt_draft_rate_limited"
        ? "공유 영수증 생성 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
        : "이미지는 완성됐지만 공유 QR을 만들지 못했습니다.");
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
      setStatus("영수증을 먼저 완성해 주세요.");
      throw new Error("match_receipt_invalid");
    }
    return renderMatchReceiptPng(result.draft, preset, { matchId: canonicalMatchId, matchUrl, photoBlob });
  }

  async function handleDownload(preset) {
    setBusy(`download-${preset}`);
    setStatus("");
    try {
      const blob = await createPng(preset);
      downloadBlob(blob, getMatchReceiptFileName(draft, preset));
      setStatus(`${MATCH_RECEIPT_CANVAS_SIZES[preset].label} 이미지를 저장했습니다.`);
      trackMatchReceiptEvent("receipt_downloaded", { loggedIn: Boolean(auth?.session), imagePreset: preset });
    } catch (error) {
      if (error.message !== "match_receipt_invalid") setStatus("이미지를 만들지 못했습니다. 다시 시도해 주세요.");
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
        await navigator.share({ title: "BOXTIER 경기 영수증", files: [file] });
        setStatus("공유 화면을 열었습니다.");
        trackMatchReceiptEvent("receipt_shared", { loggedIn: Boolean(auth?.session), imagePreset: preset, method: "web_share" });
      } else {
        downloadBlob(blob, file.name);
        setStatus("이 브라우저는 이미지 공유를 지원하지 않아 Story 이미지를 저장했습니다.");
        trackMatchReceiptEvent("receipt_downloaded", { loggedIn: Boolean(auth?.session), imagePreset: preset, method: "share_fallback" });
      }
    } catch (error) {
      if (error.name !== "AbortError" && error.message !== "match_receipt_invalid") {
        setStatus("공유하지 못했습니다. 이미지 저장을 이용해 주세요.");
      }
    } finally {
      setBusy("");
    }
  }

  async function copyCreatorLink() {
    try {
      await navigator.clipboard.writeText(new URL("/app/receipt", window.location.origin).toString());
      setStatus("영수증 만들기 링크를 복사했습니다.");
    } catch {
      setStatus("링크를 복사하지 못했습니다.");
    }
  }

  async function continueWithGoogle() {
    setBusy("login");
    trackMatchReceiptEvent("receipt_save_login_started", { loggedIn: false, matchType: draft.format });
    try {
      const publicId = await ensurePublicDraft();
      const returnTo = `${MATCH_RECEIPT_CREATE_RETURN_TO}&receiptDraft=${encodeURIComponent(publicId)}`;
      await auth?.signInWithProvider?.("google", returnTo);
    } catch (error) {
      setStatus(error.message === "receipt_draft_rate_limited"
        ? "공유 영수증 생성 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
        : "로그인용 영수증 초안을 만들지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  function continueToRecord() {
    if (!auth?.session) {
      void continueWithGoogle();
      return;
    }
    const returnTo = publicDraftId
      ? `${MATCH_RECEIPT_CREATE_RETURN_TO}&receiptDraft=${encodeURIComponent(publicDraftId)}`
      : MATCH_RECEIPT_CREATE_RETURN_TO;
    navigate(returnTo, {
      state: {
        receiptDraft: getMatchReceiptCreateDraft(draft),
        receiptSourceDraft: draft,
      },
    });
  }

  return (
    <section className="match-receipt-page">
      <header className="match-receipt-page-head">
        <p className="eyebrow">MATCH RECEIPT</p>
        <h1>경기 영수증</h1>
        <p>오늘 경기 결과를 입력하고 바로 자랑할 이미지로 저장하세요.</p>
      </header>

      <div className="match-receipt-workspace">
        <form className="match-receipt-editor" onSubmit={completeReceipt}>
          <section className="ui-panel">
            <h2>경기 결과</h2>
            {readOnlyReceipt ? <p className="match-receipt-locked-note">확정·공유 영수증의 팀·점수·날짜·장소는 원본 기록을 사용합니다.</p> : null}
            <div className="match-receipt-team-fields">
              <fieldset>
                <legend>홈팀</legend>
                <label>
                  팀 이름
                  <input value={draft.homeTeam} maxLength={MATCH_RECEIPT_LIMITS.teamName} disabled={readOnlyReceipt} onChange={(event) => updateField("homeTeam", event.target.value)} aria-invalid={Boolean(errors.homeTeam)} />
                  {errors.homeTeam ? <small className="field-error">{errors.homeTeam}</small> : null}
                </label>
                <label className="match-receipt-score-input">
                  점수
                  <input type="number" inputMode="numeric" min="0" max={MATCH_RECEIPT_LIMITS.score} value={draft.homeScore} disabled={readOnlyReceipt} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.value === "0" && event.currentTarget.select()} onChange={(event) => updateField("homeScore", event.target.value)} />
                </label>
              </fieldset>

              <fieldset>
                <legend>원정팀</legend>
                <label>
                  팀 이름
                  <input value={draft.awayTeam} maxLength={MATCH_RECEIPT_LIMITS.teamName} disabled={readOnlyReceipt} onChange={(event) => updateField("awayTeam", event.target.value)} aria-invalid={Boolean(errors.awayTeam)} />
                  {errors.awayTeam ? <small className="field-error">{errors.awayTeam}</small> : null}
                </label>
                <label className="match-receipt-score-input">
                  점수
                  <input type="number" inputMode="numeric" min="0" max={MATCH_RECEIPT_LIMITS.score} value={draft.awayScore} disabled={readOnlyReceipt} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.value === "0" && event.currentTarget.select()} onChange={(event) => updateField("awayScore", event.target.value)} />
                </label>
              </fieldset>
            </div>
          </section>

          <section className="ui-panel">
            <h2>경기 정보</h2>
            <div className="match-receipt-info-fields">
              <label>경기 날짜<input type="date" value={draft.playedOn} disabled={readOnlyReceipt} onChange={(event) => updateField("playedOn", event.target.value)} /></label>
              <label>경기 방식<select value={draft.format} disabled={readOnlyReceipt} onChange={(event) => updateField("format", event.target.value)}>{MATCH_RECEIPT_FORMATS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>경기 성격<select value={draft.matchNature} disabled={readOnlyReceipt} onChange={(event) => updateField("matchNature", event.target.value)}>{MATCH_RECEIPT_NATURES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="is-wide">
                경기 장소
                <span className="match-receipt-venue-control">
                  <input value={draft.venue} maxLength={MATCH_RECEIPT_LIMITS.venue} disabled={readOnlyReceipt} placeholder="직접 입력 또는 지도에서 선택" onChange={(event) => updateField("venue", event.target.value)} />
                  {!readOnlyReceipt ? (
                    <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md match-receipt-map-button" onClick={() => setCourtMapOpen(true)}>
                      <MapPin aria-hidden="true" /> 지도에서 선택
                    </button>
                  ) : null}
                </span>
              </label>
              <label className="is-wide">짧은 주소 <input value={draft.address} maxLength={MATCH_RECEIPT_LIMITS.address} disabled={readOnlyReceipt} placeholder="선택 · 예: 서울 서대문구" onChange={(event) => updateField("address", event.target.value)} /></label>
              <label className="is-wide">한 줄 코멘트 <input value={draft.comment} maxLength={MATCH_RECEIPT_LIMITS.comment} disabled={readOnlyReceipt} placeholder="선택 · 예: 마지막 3점으로 역전" onChange={(event) => updateField("comment", event.target.value)} /></label>
            </div>
            <p className="match-receipt-map-note"><MapPin aria-hidden="true" /> 이미지에는 장소명과 짧은 주소만 들어갑니다. 지도 화면은 포함하지 않습니다.</p>
          </section>

          <button type="submit" className="button ui-button button-primary ui-button-primary button-md ui-button-md match-receipt-complete">영수증 완성하기</button>
          {status ? <p className="match-receipt-status" role="status">{status}</p> : null}
        </form>

        <aside className="match-receipt-preview-panel" ref={previewRef}>
          <div className="match-receipt-preview-head">
            <div><span>미리보기</span><strong>{outcome.label}</strong></div>
            <span>9:16 STORY</span>
          </div>
          <div className="match-receipt-preview-stage">
            <ReceiptPreview
              draft={draft}
              photoUrl={photoUrl}
              matchUrl={matchUrl}
              photoGestureHandlers={{
                onPointerDown: beginPhotoGesture,
                onPointerMove: movePhotoGesture,
                onPointerUp: endPhotoGesture,
                onPointerCancel: endPhotoGesture,
                onLostPointerCapture: endPhotoGesture,
              }}
            />
            <div className="match-receipt-photo-actions" aria-label="미리보기 사진 편집">
              <label className="button ui-button button-secondary ui-button-secondary button-md ui-button-md">
                <ImagePlus aria-hidden="true" /> 사진 선택
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy === "photo"} onChange={handlePhotoChange} />
              </label>
              <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" onClick={() => updateField("photoRotation", draft.photoRotation + 90)}><RotateCcw aria-hidden="true" /> 90° 회전</button>
              <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" onClick={resetPhotoTransform}>초기화</button>
              {photoUrl ? <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md is-danger" onClick={removePhoto}><Trash2 aria-hidden="true" /> 제거</button> : null}
            </div>
            <p className="match-receipt-photo-note">
              {photoUrl ? "사진을 직접 이동 · 두 손가락 확대·축소·회전" : "사진을 선택하면 이 영역에서 바로 편집"} · 서버 미업로드
            </p>
          </div>

          {generated ? (
            <div className="match-receipt-actions">
              <button type="button" className="button ui-button button-primary ui-button-primary button-md ui-button-md" disabled={Boolean(busy)} onClick={handleShare}><Share2 aria-hidden="true" /> 이미지 공유</button>
              <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" disabled={Boolean(busy)} onClick={() => handleDownload("story")}><Download aria-hidden="true" /> Story 저장</button>
              <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" disabled={Boolean(busy)} onClick={() => handleDownload("feed")}><Download aria-hidden="true" /> Feed 저장</button>
              <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" disabled={Boolean(busy)} onClick={copyCreatorLink}><Copy aria-hidden="true" /> 만들기 링크 복사</button>
            </div>
          ) : null}

          {generated ? (
            <section className="ui-panel match-receipt-save-card">
              <h2>{canonicalMatchId ? "내 기록에 저장됨" : "이 경기를 내 기록으로 가져가기"}</h2>
              {canonicalMatchId ? (
                <>
                  <p>실제 경기 ID가 연결됐습니다. QR 코드는 이 경기 기록을 엽니다.</p>
                  <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" onClick={() => navigate("/app/profile/records")}>내 기록 보기</button>
                </>
              ) : auth?.session ? (
                <>
                  <p>상세 기록을 이어서 작성하면 기존 개인 기록 저장 흐름으로 보관됩니다.</p>
                  <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" onClick={continueToRecord}>상세 기록 이어서 작성</button>
                </>
              ) : (
                <>
                  <p>Google로 계속하면 작성 내용이 유지됩니다. 로그인 뒤 상세 기록을 작성해 저장할 수 있습니다.</p>
                  <button type="button" className="button ui-button button-secondary ui-button-secondary button-md ui-button-md" disabled={Boolean(busy)} onClick={continueToRecord}>상세 기록 이어서 작성</button>
                </>
              )}
            </section>
          ) : null}
        </aside>
      </div>
      <CourtMapPicker
        open={courtMapOpen}
        courts={registeredCourts}
        selectedCourt={selectedCourt}
        currentRegion={courtMapRegion}
        loading={courtMapDirectoryStatus.loading}
        loadError={courtMapDirectoryStatus.error}
        onSelect={selectCourt}
        onClose={() => setCourtMapOpen(false)}
      />
    </section>
  );
}
