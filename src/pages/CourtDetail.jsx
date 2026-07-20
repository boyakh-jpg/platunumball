import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarDays, ExternalLink, MapPin, Star, Trophy } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import { getCourtLayoutLabel, getCourtMapUrl, getCourtSurfaceLabel, getRegisteredCourts } from "../lib/courts.js";
import { getCourtHashtag } from "../lib/handles.js";

function formatDate(value) {
  if (!value) return "날짜 미정";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function getMatchDate(match = {}) {
  return match.scheduledAt || (match.scheduledDate ? `${match.scheduledDate}T${match.scheduledTime || "00:00"}` : "") || match.endedAt;
}

function getCourtAddress(court = {}) {
  return court.roadAddress || court.addressText || court.jibunAddress || "주소 미등록";
}

function getLoadError(error) {
  const code = error?.code || error?.message || "court_detail_load_failed";
  if (error?.statusCode === 404 || code === "court_not_found") {
    return { code, message: "등록된 구장을 찾을 수 없습니다.", retryable: false };
  }
  return { code, message: "구장 정보를 불러오지 못했습니다.", retryable: true };
}

function getLocalDetail(settings, courtId) {
  const court = getRegisteredCourts(settings).find((item) => item.id === courtId);
  if (!court) return null;
  const reviews = (settings?.courtReviews ?? [])
    .filter((review) => review.status !== "hidden")
    .filter((review) => review.courtId === court.id || review.courtName === court.name)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .map((review) => ({ ...review, adjustedRating: review.adjustedRating ?? review.rating }));
  return { ok: true, court, reviews, reviewableMatches: [] };
}

export default function CourtDetail({ app, courtId: courtIdProp = "", embedded = false, onClose }) {
  const { courtId: routeCourtId = "" } = useParams();
  const courtId = courtIdProp || routeCourtId;
  const courtSettings = app.state.settings;
  const localDetail = useMemo(() => getLocalDetail(courtSettings, courtId), [courtId, courtSettings]);
  const [detail, setDetail] = useState(localDetail);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [rating, setRating] = useState(0);
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const detailRequestRef = useRef(0);
  const loadCourtDetail = app.actions?.loadCourtDetail;

  const refreshDetail = useCallback(async ({ silent = false } = {}) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    if (!silent) {
      setLoading(true);
      setDetail((current) => current?.court?.id === courtId ? current : localDetail);
    }
    setLoadError(null);
    try {
      const result = await loadCourtDetail?.(courtId);
      if (detailRequestRef.current !== requestId) return;
      if (result?.court) setDetail(result);
      else if (localDetail) setDetail(localDetail);
      else {
        setDetail(null);
        setLoadError(getLoadError(new Error("court_detail_load_failed")));
      }
    } catch (error) {
      if (detailRequestRef.current !== requestId) return;
      const nextError = getLoadError(error);
      if (localDetail) {
        setDetail(localDetail);
        if (nextError.retryable) {
          setLoadError({ ...nextError, message: "최신 리뷰 정보를 불러오지 못했습니다." });
        }
      } else {
        setDetail(null);
        setLoadError(nextError);
      }
    } finally {
      if (detailRequestRef.current === requestId) setLoading(false);
    }
  }, [courtId, loadCourtDetail, localDetail]);

  useEffect(() => {
    refreshDetail();
    return () => {
      detailRequestRef.current += 1;
    };
  }, [refreshDetail]);

  const reviewableMatches = detail?.reviewableMatches ?? [];
  useEffect(() => {
    setSelectedMatchId((current) => (
      reviewableMatches.some((match) => match.id === current) ? current : reviewableMatches[0]?.id ?? ""
    ));
  }, [reviewableMatches]);

  const selectedMatch = reviewableMatches.find((match) => match.id === selectedMatchId) ?? null;
  useEffect(() => {
    setRating(Number(selectedMatch?.existingReview?.rating ?? 0));
    setMemo(selectedMatch?.existingReview?.memo ?? "");
  }, [selectedMatchId, selectedMatch?.existingReview?.id, selectedMatch?.existingReview?.rating, selectedMatch?.existingReview?.memo]);

  const changeSelectedMatch = (event) => {
    setSelectedMatchId(event.target.value);
    setSaveMessage("");
  };

  const submitReview = async (event) => {
    event.preventDefault();
    if (!selectedMatchId || rating < 1 || saving) return;
    setSaving(true);
    setSaveMessage("");
    const result = await app.actions?.submitCourtDetailReview?.(selectedMatchId, {
      ...(selectedMatch?.existingReview ?? {}),
      rating,
      memo,
    });
    if (result?.ok === false || !result) {
      setSaveMessage("리뷰를 저장하지 못했습니다.");
      setSaving(false);
      return;
    }
    await refreshDetail({ silent: true });
    setSaveMessage(selectedMatch?.existingReview ? "리뷰를 수정했습니다." : "리뷰를 등록했습니다.");
    setSaving(false);
  };

  if (loading && !detail) {
    return <div className="court-detail-state">구장 정보를 불러오는 중입니다.</div>;
  }

  if (!detail?.court) {
    return (
      <div className="court-detail-state" role="alert">
        <strong>{loadError?.message || "구장 정보를 찾을 수 없습니다."}</strong>
        <div className="court-detail-state-actions">
          {loadError?.retryable ? <Button type="button" variant="secondary" size="sm" onClick={() => refreshDetail()}>다시 시도</Button> : null}
          {embedded ? (
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>닫기</Button>
          ) : (
            <Link className="button button-secondary button-sm" to="/app">홈으로</Link>
          )}
        </div>
      </div>
    );
  }

  const { court } = detail;
  const reviews = detail.reviews ?? [];
  const adjustedRating = Number(court.adjustedRating ?? court.rating ?? 0);
  const reviewCount = Number(court.reviewCount ?? reviews.length ?? 0);
  const mapUrl = getCourtMapUrl(court);

  return (
    <div className={`page-stack court-detail-page${embedded ? " is-embedded" : ""}`}>
      {loadError?.retryable ? (
        <div className="court-detail-inline-error" role="status">
          <span>{loadError.message}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => refreshDetail()}>다시 시도</Button>
        </div>
      ) : null}
      <Card className="court-detail-hero">
        <div className="court-detail-heading">
          <p className="eyebrow">Court Profile</p>
          <h1>{court.name}</h1>
          <p><MapPin size={16} /> {getCourtAddress(court)}</p>
          <div className="court-detail-tags">
            <span>{getCourtHashtag(court)}</span>
            <span>{court.region || "지역 미정"}</span>
            <span>{court.type || court.courtKind || "농구장"}</span>
            <span>{getCourtSurfaceLabel(court)}</span>
            <span>{getCourtLayoutLabel(court)}</span>
            {typeof court.paid === "boolean" ? <span>{court.paid ? "유료" : "무료"}</span> : null}
          </div>
        </div>
        <a className="button button-secondary button-sm court-map-link" href={mapUrl} target="_blank" rel="noreferrer">
          지도 보기 <ExternalLink size={15} />
        </a>
      </Card>

      <section className="court-detail-metrics" aria-label="구장 지표">
        <div>
          <Star size={19} />
          <span>보정 평점</span>
          <strong>{reviewCount ? adjustedRating.toFixed(1) : "평가 전"}</strong>
        </div>
        <div>
          <Trophy size={19} />
          <span>완료 경기</span>
          <strong>{Number(court.completedMatchCount ?? 0)}경기</strong>
        </div>
        <div>
          <CalendarDays size={19} />
          <span>참가자 리뷰</span>
          <strong>{reviewCount}개</strong>
        </div>
      </section>

      <div className="court-detail-layout">
        <Card className="section-card court-review-section">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Reviews</p>
              <h2>경기 참가자 리뷰</h2>
            </div>
            <span className="court-review-count">{reviewCount}개</span>
          </div>
          {reviews.length ? (
            <div className="court-review-list">
              {reviews.map((review) => (
                <article className="court-review-row" key={review.id}>
                  <div className="court-review-author">
                    <ProfileEmblem user={review.reviewer} className="small" initial={(review.reviewer?.name || "참").slice(0, 1)} />
                    <div>
                      <strong>{review.reviewer?.name || "경기 참가자"}</strong>
                      <span>{formatDate(review.updatedAt || review.createdAt)}</span>
                    </div>
                  </div>
                  <strong className="court-review-score"><Star size={16} fill="currentColor" /> {Number(review.adjustedRating ?? review.rating).toFixed(1)}</strong>
                  {review.memo ? <p>{review.memo}</p> : <p className="muted">별점만 등록된 리뷰입니다.</p>}
                  {review.tags?.length ? (
                    <div className="court-review-tags">{review.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="court-review-empty">아직 등록된 리뷰가 없습니다.</div>
          )}
        </Card>

        <Card className="section-card court-review-form-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Write Review</p>
              <h2>리뷰 작성</h2>
            </div>
          </div>
          {reviewableMatches.length ? (
            <form className="court-review-form" onSubmit={submitReview}>
              <label>
                <span>이용 경기</span>
                <select value={selectedMatchId} onChange={changeSelectedMatch}>
                  {reviewableMatches.map((match) => (
                    <option key={match.id} value={match.id}>{match.title} · {formatDate(getMatchDate(match))}</option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>평점</legend>
                <div className="court-rating-buttons">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={rating >= value ? "active" : ""}
                      aria-label={`${value}점`}
                      aria-pressed={rating === value}
                      onClick={() => setRating(value)}
                    >
                      <Star size={22} fill={rating >= value ? "currentColor" : "none"} />
                    </button>
                  ))}
                </div>
              </fieldset>
              <label>
                <span>한줄 리뷰</span>
                <textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={240} rows={4} placeholder="바닥, 림, 조명, 혼잡도를 알려주세요." />
                <small>{memo.length}/240</small>
              </label>
              <Button type="submit" disabled={rating < 1 || saving}>{saving ? "저장 중" : selectedMatch?.existingReview ? "리뷰 수정" : "리뷰 등록"}</Button>
              {saveMessage ? <p className="court-review-message" role="status">{saveMessage}</p> : null}
            </form>
          ) : (
            <div className="court-review-guide">
              <strong>리뷰 작성 가능한 경기 없음</strong>
              <p>이 구장에서 끝난 경기에 실제 참가한 선수만 리뷰를 남길 수 있습니다.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
