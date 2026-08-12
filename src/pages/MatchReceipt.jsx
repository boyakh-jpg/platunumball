import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, MapPin, Share2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import QrCode from "../components/common/QrCode.jsx";
import {
  MATCH_RECEIPT_CANVAS_SIZES,
  MATCH_RECEIPT_CREATE_RETURN_TO,
  MATCH_RECEIPT_FORMATS,
  MATCH_RECEIPT_LIMITS,
  createDefaultMatchReceiptDraft,
  getMatchReceiptCreateDraft,
  getMatchReceiptDraftFromMatch,
  getMatchReceiptFileName,
  getMatchReceiptFormatLabel,
  getMatchReceiptOutcome,
  loadMatchReceiptDraft,
  normalizeMatchReceiptDraft,
  renderMatchReceiptPng,
  saveMatchReceiptDraft,
  trackMatchReceiptEvent,
  validateMatchReceiptDraft,
} from "../lib/matchReceipt.js";

function loadDraft() {
  return loadMatchReceiptDraft() ?? createDefaultMatchReceiptDraft();
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReceiptPreview({ draft, matchId = "", matchUrl = "" }) {
  const outcome = getMatchReceiptOutcome(draft);
  const hasComment = Boolean(draft.comment.trim());
  const hasAddress = Boolean(draft.address.trim());

  return (
    <article
      className="match-receipt-card"
      style={{
        "--receipt-home": draft.homeColor,
        "--receipt-away": draft.awayColor,
        "--receipt-result": outcome.key === "away" ? draft.awayColor : draft.homeColor,
      }}
      aria-label="경기 영수증 미리보기"
    >
      <div className="match-receipt-paper">
        <div className="match-receipt-brand-row">
          <strong>BOXTIER</strong>
          <span>MATCH RECEIPT</span>
        </div>
        <div className="match-receipt-serial">{matchId ? `MATCH-${matchId}` : "PRACTICE · LIVE PREVIEW"}</div>

        <div className="match-receipt-teams">
          <div>
            <span>HOME</span>
            <strong>{draft.homeTeam || "HOME TEAM"}</strong>
          </div>
          <div>
            <span>AWAY</span>
            <strong>{draft.awayTeam || "AWAY TEAM"}</strong>
          </div>
        </div>

        <div className="match-receipt-score" aria-label={`${draft.homeScore} 대 ${draft.awayScore}`}>
          <strong>{draft.homeScore}</strong>
          <span>:</span>
          <strong>{draft.awayScore}</strong>
        </div>
        <div className={`match-receipt-result is-${outcome.key}`}>{outcome.label}</div>

        <dl className="match-receipt-meta">
          <div><dt>DATE</dt><dd>{draft.playedOn.replaceAll("-", ".")}</dd></div>
          <div><dt>FORMAT</dt><dd>{getMatchReceiptFormatLabel(draft.format)}</dd></div>
        {draft.venue ? <div><dt>VENUE</dt><dd><MapPin aria-hidden="true" /> {draft.venue}</dd></div> : null}
          {hasAddress ? <div><dt>ADDRESS</dt><dd>{draft.address}</dd></div> : null}
        </dl>

        {hasComment ? <blockquote>“{draft.comment}”</blockquote> : null}
        <footer className={matchUrl ? "has-qr" : ""}>
          {matchUrl ? <QrCode value={matchUrl} label="경기 열기 QR 코드" className="match-receipt-qr" /> : null}
          <div>
            <strong>오늘 농구, 증거 남김.</strong>
            <span>{matchUrl ? "SCAN TO OPEN MATCH" : "PRACTICE RECEIPT · boxtier.kr"}</span>
          </div>
        </footer>
      </div>
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
  const sourceDraftRef = useRef(location.state?.receiptDraft
    ? normalizeMatchReceiptDraft(location.state.receiptDraft)
    : null);
  const [draft, setDraft] = useState(() => sourceDraftRef.current ?? loadDraft());
  const [errors, setErrors] = useState({});
  const [generated, setGenerated] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const startedRef = useRef(false);
  const requestedMatchIdRef = useRef("");
  const previewRef = useRef(null);
  const outcome = useMemo(() => getMatchReceiptOutcome(draft), [draft]);
  const canonicalMatch = useMemo(
    () => app?.state?.matches?.find((match) => String(match.id) === matchId) ?? null,
    [app?.state?.matches, matchId],
  );
  const canonicalMatchId = canonicalMatch ? matchId : "";
  const matchUrl = useMemo(() => (
    canonicalMatchId && typeof window !== "undefined"
      ? new URL(`/app/matches?match=${encodeURIComponent(canonicalMatchId)}`, window.location.origin).toString()
      : ""
  ), [canonicalMatchId]);

  useEffect(() => {
    if (!matchId) return;
    if (canonicalMatch) {
      setDraft(getMatchReceiptDraftFromMatch(canonicalMatch, sourceDraftRef.current ?? {}));
      setGenerated(true);
      setStatus("");
      return;
    }
    if (requestedMatchIdRef.current === matchId) return;
    requestedMatchIdRef.current = matchId;
    Promise.resolve(app?.actions?.loadMatchDetail?.(matchId)).then((loaded) => {
      if (!loaded) setStatus("저장된 경기 기록을 불러오지 못했습니다.");
    });
  }, [app?.actions, canonicalMatch, matchId]);

  useEffect(() => {
    trackMatchReceiptEvent("receipt_page_view", { loggedIn: Boolean(auth?.session), entry: "direct" });
  }, [auth?.session]);

  useEffect(() => {
    saveMatchReceiptDraft(draft);
  }, [draft]);

  function updateField(name, value) {
    if (!startedRef.current) {
      startedRef.current = true;
      trackMatchReceiptEvent("receipt_started", { loggedIn: Boolean(auth?.session) });
    }
    if (matchId) navigate("/app/receipt", { replace: true });
    setDraft((current) => normalizeMatchReceiptDraft({ ...current, [name]: value }));
    setErrors((current) => (current[name] ? { ...current, [name]: "" } : current));
    setGenerated(false);
    setStatus("");
  }

  function completeReceipt(event) {
    event.preventDefault();
    const result = validateMatchReceiptDraft(draft);
    setDraft(result.draft);
    setErrors(result.errors);
    if (!result.valid) {
      setStatus("필수 정보를 확인해 주세요.");
      return;
    }
    setGenerated(true);
    setStatus("경기 영수증이 완성됐습니다.");
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
    return renderMatchReceiptPng(result.draft, preset, { matchId: canonicalMatchId, matchUrl });
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
      await auth?.signInWithProvider?.("google", MATCH_RECEIPT_CREATE_RETURN_TO);
    } finally {
      setBusy("");
    }
  }

  function continueToRecord() {
    if (!auth?.session) {
      void continueWithGoogle();
      return;
    }
    navigate(MATCH_RECEIPT_CREATE_RETURN_TO, {
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
            <div className="match-receipt-team-fields">
              <fieldset>
                <legend>홈팀</legend>
                <label>
                  팀 이름
                  <input value={draft.homeTeam} maxLength={MATCH_RECEIPT_LIMITS.teamName} onChange={(event) => updateField("homeTeam", event.target.value)} aria-invalid={Boolean(errors.homeTeam)} />
                  {errors.homeTeam ? <small className="field-error">{errors.homeTeam}</small> : null}
                </label>
                <label className="match-receipt-score-input">
                  점수
                  <input type="number" inputMode="numeric" min="0" max={MATCH_RECEIPT_LIMITS.score} value={draft.homeScore} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.value === "0" && event.currentTarget.select()} onChange={(event) => updateField("homeScore", event.target.value)} />
                </label>
                <label className="match-receipt-color-input">팀 컬러 <input type="color" value={draft.homeColor} onChange={(event) => updateField("homeColor", event.target.value)} /></label>
              </fieldset>

              <fieldset>
                <legend>원정팀</legend>
                <label>
                  팀 이름
                  <input value={draft.awayTeam} maxLength={MATCH_RECEIPT_LIMITS.teamName} onChange={(event) => updateField("awayTeam", event.target.value)} aria-invalid={Boolean(errors.awayTeam)} />
                  {errors.awayTeam ? <small className="field-error">{errors.awayTeam}</small> : null}
                </label>
                <label className="match-receipt-score-input">
                  점수
                  <input type="number" inputMode="numeric" min="0" max={MATCH_RECEIPT_LIMITS.score} value={draft.awayScore} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.value === "0" && event.currentTarget.select()} onChange={(event) => updateField("awayScore", event.target.value)} />
                </label>
                <label className="match-receipt-color-input">팀 컬러 <input type="color" value={draft.awayColor} onChange={(event) => updateField("awayColor", event.target.value)} /></label>
              </fieldset>
            </div>
          </section>

          <section className="ui-panel">
            <h2>경기 정보</h2>
            <div className="match-receipt-info-fields">
              <label>경기 날짜<input type="date" value={draft.playedOn} onChange={(event) => updateField("playedOn", event.target.value)} /></label>
              <label>경기 방식<select value={draft.format} onChange={(event) => updateField("format", event.target.value)}>{MATCH_RECEIPT_FORMATS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="is-wide">
                경기 장소
                <input value={draft.venue} maxLength={MATCH_RECEIPT_LIMITS.venue} placeholder="예: 서대문구 연북중학교 농구장" onChange={(event) => updateField("venue", event.target.value)} />
              </label>
              <label className="is-wide">짧은 주소 <input value={draft.address} maxLength={MATCH_RECEIPT_LIMITS.address} placeholder="선택 · 예: 서울 서대문구" onChange={(event) => updateField("address", event.target.value)} /></label>
              <label className="is-wide">한 줄 코멘트 <input value={draft.comment} maxLength={MATCH_RECEIPT_LIMITS.comment} placeholder="선택 · 예: 마지막 3점으로 역전" onChange={(event) => updateField("comment", event.target.value)} /></label>
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
          <ReceiptPreview draft={draft} matchId={canonicalMatchId} matchUrl={matchUrl} />

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
    </section>
  );
}
