import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Building2, CalendarDays, Clock3, ExternalLink, Flag, Lightbulb, MapPin, Phone, Star, Trophy } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import {
  COURT_CORRECTION_FIELD_OPTIONS,
  getCourtAddress,
  getCourtAccessLabel,
  getCourtCorrectionAttributeOptions,
  getCourtCorrectionFieldLabel,
  getCourtHoopCount,
  getCourtLayoutLabel,
  getCourtLightingLabel,
  getCourtMapUrl,
  getCourtPaidLabel,
  getCourtPublicAccessLabel,
  getCourtKindLabel,
  getCourtSurfaceLabel,
} from "../lib/courts.js";
import { getCourtHashtag } from "../lib/handles.js";
import { formatDate, getMatchDate, getLoadError, getLocalDetail } from "./courtDetailModel.js";

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
  const [saving, setSaving] = useState(false); const savingRef = useRef(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionField, setCorrectionField] = useState("name");
  const [correctionAttribute, setCorrectionAttribute] = useState("");
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const [correctionUrl, setCorrectionUrl] = useState("");
  const [correctionSaving, setCorrectionSaving] = useState(false); const correctionSavingRef = useRef(false);
  const [correctionMessage, setCorrectionMessage] = useState("");
  const detailRequestRef = useRef(0);
  const loadCourtDetail = app.actions?.loadCourtDetail;
  const correctionAttributes = useMemo(
    () => getCourtCorrectionAttributeOptions(correctionField),
    [correctionField],
  );
  const selectedCorrectionAttribute = correctionAttributes.find((option) => option.id === correctionAttribute)
    ?? correctionAttributes[0]
    ?? null;
  const correctionIsStructured = Boolean(selectedCorrectionAttribute);
  const correctionCanSubmit = correctionIsStructured
    ? Boolean(selectedCorrectionAttribute.options.some((option) => option.id === correctionValue))
    : correctionValue.trim().length >= 4;
  const changeCorrectionField = (field) => {
    const nextAttribute = getCourtCorrectionAttributeOptions(field)[0] ?? null;
    setCorrectionField(field);
    setCorrectionAttribute(nextAttribute?.id ?? "");
    setCorrectionValue(nextAttribute?.options[0]?.id ?? "");
    setCorrectionNote("");
    setCorrectionMessage("");
  };
  const changeCorrectionAttribute = (attribute) => {
    const nextAttribute = correctionAttributes.find((option) => option.id === attribute) ?? correctionAttributes[0];
    setCorrectionAttribute(nextAttribute?.id ?? "");
    setCorrectionValue(nextAttribute?.options[0]?.id ?? "");
    setCorrectionMessage("");
  };
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
  useEffect(() => {
    setCorrectionOpen(false);
    setCorrectionField("name");
    setCorrectionAttribute("");
    setCorrectionValue("");
    setCorrectionNote("");
    setCorrectionUrl("");
    setCorrectionMessage("");
  }, [courtId]);
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
    if (!selectedMatchId || rating < 1 || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveMessage("");
    try {
      const result = await app.actions?.submitCourtDetailReview?.(selectedMatchId, {
        ...(selectedMatch?.existingReview ?? {}),
        rating,
        memo,
      });
      if (result?.ok === false || !result) {
        setSaveMessage("리뷰를 저장하지 못했습니다.");
        return;
      }
      await refreshDetail({ silent: true });
      setSaveMessage(selectedMatch?.existingReview ? "리뷰를 수정했습니다." : "리뷰를 등록했습니다.");
    } catch {
      setSaveMessage("리뷰를 저장하지 못했습니다.");
    } finally { savingRef.current = false; setSaving(false); }
  };

  const submitCorrection = async (event) => {
    event.preventDefault();
    const proposedValue = correctionValue.trim();
    const note = correctionNote.trim();
    const evidenceUrl = correctionUrl.trim();
    if (!correctionCanSubmit || correctionSavingRef.current) return;
    if (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl)) {
      setCorrectionMessage("근거 URL은 http:// 또는 https://로 입력해 주세요.");
      return;
    }
    correctionSavingRef.current = true;
    setCorrectionSaving(true);
    setCorrectionMessage("");
    const fieldLabel = getCourtCorrectionFieldLabel(correctionField);
    try {
      const result = await app.actions?.reportCourt?.(
        courtId,
        `${fieldLabel} 수정 요청: ${proposedValue}`,
        {
          field: correctionField,
          attribute: selectedCorrectionAttribute?.id ?? "",
          proposedValue,
          note,
          evidenceUrl,
        },
        detail?.court ?? null,
      );
      if (result?.duplicate) {
        setCorrectionMessage("이미 검토 중인 정보 수정 신고가 있습니다.");
      } else if (!result || result.ok === false) {
        setCorrectionMessage(result?.error === "court_report_unavailable"
          ? "이미 검토 중인 신고가 있거나 신고할 수 없는 구장입니다."
          : "정보 수정 신고를 접수하지 못했습니다.");
      } else {
        if (!correctionIsStructured) setCorrectionValue("");
        setCorrectionNote("");
        setCorrectionUrl("");
        setCorrectionMessage("접수했습니다. 관리자 확인 전까지 현재 정보는 유지됩니다.");
      }
    } catch {
      setCorrectionMessage("정보 수정 신고를 접수하지 못했습니다.");
    } finally { correctionSavingRef.current = false; setCorrectionSaving(false); }
  };

  if (loading && !detail) {
    return <div className="court-detail-state">구장 정보를 불러오는 중입니다.</div>;
  }

  if (!detail?.court) {
    return (
      <div className="court-detail-state" role="alert">
        <strong>{loadError?.message || "구장 정보를 찾을 수 없습니다."}</strong>
        <div className="ui-action-row court-detail-state-actions">
          {loadError?.retryable ? <Button type="button" variant="secondary" size="sm" onClick={() => refreshDetail()}>다시 시도</Button> : null}
          {embedded ? (
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>닫기</Button>
          ) : (
            <Button as={Link} variant="secondary" size="sm" to="/app">홈으로</Button>
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
  const hoopCount = getCourtHoopCount(court);
  const facilityDetails = [
    ["실내외", court.type || court.indoorOutdoor || "확인 필요"],
    ["코트 유형", getCourtKindLabel(court)],
    ["바닥", getCourtSurfaceLabel(court)],
    ["코트 형태", getCourtLayoutLabel(court)],
    ["골대", hoopCount == null ? "확인 필요" : `${hoopCount}개`],
    ["조명", getCourtLightingLabel(court)],
  ];
  const accessDetails = [
    ["공개 범위", getCourtPublicAccessLabel(court)],
    ["이용 방식", getCourtAccessLabel(court)],
    ["비용", getCourtPaidLabel(court)],
    ["운영시간", court.openingHoursText || "확인 필요"],
    ["신청 방법", court.applicationMethod || "확인 필요"],
    ["운영 주체", court.operatorName || "확인 필요"],
  ];

  return (
    <div className={`page-stack court-detail-page${embedded ? " is-embedded" : ""}`}>
      {loadError?.retryable ? (
        <div className="court-detail-inline-error" role="status">
          <span>{loadError.message}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => refreshDetail()}>다시 시도</Button>
        </div>
      ) : null}
      <Card className="court-detail-hero ui-page-hero ui-design-app-hero">
        <div className="court-detail-heading ui-page-hero__copy">
          <p className="eyebrow">Court Profile</p>
          <h1>{court.name}</h1>
          <p><MapPin size={16} /> {getCourtAddress(court)}</p>
          <div className="court-detail-tags">
            <Badge>{getCourtHashtag(court)}</Badge>
            <Badge>{court.region || "지역 미정"}</Badge>
            <Badge>실내외 · {court.type || court.indoorOutdoor || "확인 필요"}</Badge>
            <Badge>바닥 · {getCourtSurfaceLabel(court)}</Badge>
            <Badge>코트 형태 · {getCourtLayoutLabel(court)}</Badge>
            {typeof court.paid === "boolean" ? <Badge>이용료 · {court.paid ? "유료" : "무료"}</Badge> : null}
          </div>
        </div>
        <div className="ui-action-row court-detail-actions">
          <Button as="a" variant="secondary" size="sm" className="court-map-link ui-liquid-glass" href={mapUrl} target="_blank" rel="noreferrer">
            지도 보기 <ExternalLink size={15} />
          </Button>
          <Button type="button" variant="secondary" size="sm" className="ui-liquid-glass" disabled={correctionSaving} onClick={() => setCorrectionOpen((open) => !open)} aria-expanded={correctionOpen}>
            <Flag size={15} /> 정보 수정 신고
          </Button>
        </div>
      </Card>

      {correctionOpen ? (
        <Card className="section-card court-correction-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Correction Report</p>
              <h2>구장 정보 수정 신고</h2>
              <small>신고 즉시 정보가 바뀌지 않습니다. 관리자가 확인한 뒤 반영합니다.</small>
            </div>
          </div>
          <form className="court-correction-form" onSubmit={submitCorrection}>
            <label>
              <span>수정할 정보</span>
              <select value={correctionField} onChange={(event) => changeCorrectionField(event.target.value)}>
                {COURT_CORRECTION_FIELD_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            {selectedCorrectionAttribute ? (
              <label>
                <span>세부 항목</span>
                <select value={selectedCorrectionAttribute.id} onChange={(event) => changeCorrectionAttribute(event.target.value)}>
                  {correctionAttributes.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
            ) : null}
            <label className="court-correction-value">
              <span>{selectedCorrectionAttribute ? "바꿀 값" : "올바른 정보 또는 수정 내용"}</span>
              {selectedCorrectionAttribute ? (
                <select value={correctionValue} onChange={(event) => setCorrectionValue(event.target.value)}>
                  {selectedCorrectionAttribute.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              ) : (
                <>
                  <textarea value={correctionValue} onChange={(event) => setCorrectionValue(event.target.value)} minLength={4} maxLength={500} rows={3} required placeholder="현재 정보에서 무엇을 어떻게 바꿔야 하는지 적어 주세요." />
                  <small>{correctionValue.length}/500</small>
                </>
              )}
            </label>
            {selectedCorrectionAttribute ? (
              <label className="court-correction-note">
                <span>추가 설명 (선택)</span>
                <textarea value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} maxLength={500} rows={2} placeholder="관리자가 확인할 내용이 있으면 적어 주세요." />
                <small>{correctionNote.length}/500</small>
              </label>
            ) : null}
            <label className="court-correction-evidence">
              <span>근거 URL (선택)</span>
              <input type="url" value={correctionUrl} onChange={(event) => setCorrectionUrl(event.target.value)} maxLength={1000} placeholder="https://" />
            </label>
            <div className="ui-action-row court-correction-actions">
              <Button type="submit" size="sm" disabled={!correctionCanSubmit || correctionSaving}>{correctionSaving ? "접수 중" : "수정 신고 접수"}</Button>
              <Button type="button" variant="secondary" size="sm" disabled={correctionSaving} onClick={() => setCorrectionOpen(false)}>닫기</Button>
            </div>
          </form>
          {correctionMessage ? <p className="court-correction-message" role="status">{correctionMessage}</p> : null}
        </Card>
      ) : null}

      <section className="court-detail-metrics ui-design-borderless-list" aria-label="구장 지표">
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

      <Card className="section-card court-profile-information ui-design-content-surface">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Court Information</p>
            <h2>구장 이용 정보</h2>
          </div>
        </div>
        <div className="court-profile-information-grid ui-design-borderless-list">
          <section>
            <h3><Building2 size={17} /> 시설</h3>
            <dl>
              {facilityDetails.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </section>
          <section>
            <h3><Clock3 size={17} /> 이용</h3>
            <dl>
              {accessDetails.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </section>
          <section>
            <h3><MapPin size={17} /> 위치·안내</h3>
            <dl>
              <div><dt>도로명</dt><dd>{court.roadAddress || court.addressText || "확인 필요"}</dd></div>
              <div><dt>지번</dt><dd>{court.jibunAddress || "확인 필요"}</dd></div>
              <div><dt>상세 위치</dt><dd>{court.detailAddress || "확인 필요"}</dd></div>
              <div><dt>찾아가는 메모</dt><dd>{court.locationNote || "등록된 메모 없음"}</dd></div>
              <div><dt>이용 안내</dt><dd>{court.accessNote || "등록된 안내 없음"}</dd></div>
            </dl>
          </section>
          <section>
            <h3><Phone size={17} /> 연락·예약</h3>
            <dl>
              <div><dt>연락처</dt><dd>{court.contactPhone || "확인 필요"}</dd></div>
              <div>
                <dt>공식 정보</dt>
                <dd>{court.officialUrl ? <a href={court.officialUrl} target="_blank" rel="noreferrer">공식 페이지 <ExternalLink size={13} /></a> : "등록된 링크 없음"}</dd>
              </div>
              <div>
                <dt>예약</dt>
                <dd>{court.reservationUrl ? <a href={court.reservationUrl} target="_blank" rel="noreferrer">예약 페이지 <ExternalLink size={13} /></a> : "등록된 링크 없음"}</dd>
              </div>
              <div><dt>시설 면적</dt><dd>{court.facilityAreaSqm ? `${court.facilityAreaSqm}㎡${court.facilityAreaScope ? ` · ${court.facilityAreaScope}` : ""}` : "확인 필요"}</dd></div>
            </dl>
          </section>
        </div>
        <p className="court-profile-information-note"><Lightbulb size={15} /> 확인되지 않은 정보는 추정하지 않고 ‘확인 필요’로 표시합니다.</p>
      </Card>

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
                <textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={240} rows={4} placeholder="바닥, 림, 조명, 혼잡도 정보를 적어 주세요." />
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
