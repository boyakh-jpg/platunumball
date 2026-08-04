import { useEffect, useMemo, useRef, useState } from "react";
import { COURT_REQUEST_TRUST_MIN, REGIONS } from "../lib/constants.js";
import {
  findCourtDuplicate,
  getCourtCanonicalName,
  getCourtDuplicateMessage,
  getCourtLocationMatches,
  getNearbyCourtCandidates,
  normalizeCourtFacilityName,
  normalizeCourtSourceUrl,
} from "../lib/courts.js";
import {
  getNaverMapClientId,
  openNaverMapPinPicker,
  searchNaverAddresses,
  searchNearbyCourtCandidates,
} from "../lib/naverAddress.js";
import {
  COURT_NEARBY_REVIEW_FIELDS,
  DEFAULT_COURT_REQUEST,
  getCourtAddressDong,
} from "./settingsPageModel.js";
import { COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS, COURT_REQUEST_PHOTO_MAX, getCoordinateDistanceMeters } from "../../shared/lib/courtRequestImagePolicy.js";
import { getCourtRequestPhotoErrorMessage, prepareCourtRequestPhotos } from "../lib/courtRequestImages.js";
import { postServerAction } from "../lib/serverActions.js";

export default function useSettingsCourtRequestController({ app, currentTrustScore }) {
  const [courtAddressQuery, setCourtAddressQueryState] = useState("");
  const [naverAddressResults, setNaverAddressResults] = useState([]);
  const [courtLookupStatus, setCourtLookupStatus] = useState("");
  const [courtAddressSearchPending, setCourtAddressSearchPending] = useState(false);
  const [courtPinPending, setCourtPinPending] = useState(false);
  const [courtSubmitPending, setCourtSubmitPending] = useState(false);
  const [courtPinConfirmed, setCourtPinConfirmed] = useState(false);
  const [courtServerNearbyCandidates, setCourtServerNearbyCandidates] = useState([]);
  const [courtNearbyLookupFailed, setCourtNearbyLookupFailed] = useState(false);
  const [courtNearbyConfirmed, setCourtNearbyConfirmed] = useState(false);
  const [courtPhotos, setCourtPhotos] = useState([]);
  const [courtPhotoPending, setCourtPhotoPending] = useState(false);
  const [courtFieldLocation, setCourtFieldLocation] = useState(null);
  const [courtFieldLocationPending, setCourtFieldLocationPending] = useState(false);
  const [courtAiQuota, setCourtAiQuota] = useState(null);
  const courtAddressSearchRef = useRef(0);
  const courtPinPendingRef = useRef(false);
  const courtSubmitPendingRef = useRef(false);
  const courtFieldLocationPendingRef = useRef(false);
  const courtNearbySearchRef = useRef(0);
  const [courtDraft, setCourtDraft] = useState(() => ({
    ...DEFAULT_COURT_REQUEST,
    region: app.currentUser?.region ?? DEFAULT_COURT_REQUEST.region,
  }));

  const naverMapKeyReady = Boolean(getNaverMapClientId());
  const setCourtAddressQuery = (value) => {
    courtAddressSearchRef.current += 1;
    setCourtAddressSearchPending(false);
    setCourtAddressQueryState(value);
  };
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
  const courtQuotaBlocked = courtAiQuota?.blocked === true;
  const canOpenCourtRequestForm = currentTrustScore >= COURT_REQUEST_TRUST_MIN && !courtQuotaBlocked;
  const canSubmitCourtRequest = canOpenCourtRequestForm
    && Boolean(courtDisplayName)
    && courtAddressSelected
    && courtHasMapPin
    && courtPinConfirmed
    && !courtDuplicate
    && !courtSourceUrlInvalid
    && !courtNearbyLookupFailed
    && courtPhotos.length > 0
    && Boolean(courtFieldLocation)
    && (!courtNearbyReviewRequired || courtNearbyConfirmed)
    && (!courtRequiresUnit || Boolean(courtDraft.courtUnit.trim()));

  useEffect(() => {
    setCourtNearbyConfirmed(false);
  }, [courtNearbyCandidateSignature]);

  useEffect(() => {
    let active = true;
    postServerAction("/api/court-requests/quota", {}, { allowWhenDisabled: true })
      .then((result) => {
        if (active && result?.quota) setCourtAiQuota(result.quota);
      })
      .catch(() => null);
    return () => { active = false; };
  }, [app.currentUserId]);

  const updateCourtDraft = (patch) => {
    if (Object.keys(patch).some((key) => COURT_NEARBY_REVIEW_FIELDS.has(key))) setCourtNearbyConfirmed(false);
    if (Object.keys(patch).some((key) => ["addressText", "lat", "lng"].includes(key))) {
      setCourtFieldLocation(null);
      setCourtPhotos([]);
    }
    setCourtDraft((current) => ({ ...current, ...patch }));
  };
  const resetCourtNearbyLookup = () => {
    courtNearbySearchRef.current += 1;
    setCourtServerNearbyCandidates([]);
    setCourtNearbyLookupFailed(false);
  };
  const loadCourtNearbyCandidates = async (pin) => {
    const requestId = courtNearbySearchRef.current + 1;
    courtNearbySearchRef.current = requestId;
    setCourtServerNearbyCandidates([]);
    setCourtNearbyLookupFailed(false);
    try {
      const nearbyCourts = await searchNearbyCourtCandidates(pin);
      if (courtNearbySearchRef.current !== requestId) return;
      setCourtServerNearbyCandidates(nearbyCourts);
    } catch {
      if (courtNearbySearchRef.current !== requestId) return;
      setCourtServerNearbyCandidates([]);
      setCourtNearbyLookupFailed(true);
      setCourtLookupStatus("근처 등록 구장을 불러오지 못했습니다. 실제 위치 확인을 눌러 다시 시도해 주세요.");
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
    const normalizedAddressQuery = courtAddressQuery.trim();
    if (!normalizedAddressQuery) {
      setNaverAddressResults([]);
      setCourtLookupStatus("검색할 주소를 입력해 주세요.");
      return;
    }
    const requestId = courtAddressSearchRef.current + 1;
    courtAddressSearchRef.current = requestId;
    setCourtAddressSearchPending(true);
    setCourtLookupStatus("네이버 주소 검색 중");
    try {
      const results = await searchNaverAddresses(normalizedAddressQuery);
      if (courtAddressSearchRef.current !== requestId) return;
      setNaverAddressResults(results);
      setCourtLookupStatus(results.length ? `${results.length}개 주소를 찾았습니다. 사용할 주소를 선택해 주세요.` : "주소 검색 결과가 없습니다.");
    } catch {
      if (courtAddressSearchRef.current !== requestId) return;
      setCourtLookupStatus("주소를 검색하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (courtAddressSearchRef.current === requestId) setCourtAddressSearchPending(false);
    }
  };
  const pickCourtMapPin = async () => {
    if (courtPinPendingRef.current) return;
    if (!naverMapKeyReady) {
      setCourtLookupStatus("지도 기능을 준비 중입니다. 잠시 후 다시 이용해 주세요.");
      return;
    }
    courtPinPendingRef.current = true;
    setCourtPinPending(true);
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
      if (error?.code === "naver_pin_picker_cancelled") {
        setCourtLookupStatus("지도 위치 선택을 취소했습니다.");
        return;
      }
      setCourtLookupStatus("구장 위치를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      courtPinPendingRef.current = false;
      setCourtPinPending(false);
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
  const readCourtFieldLocation = () => new Promise((resolve, reject) => {
    const fail = (code) => {
      const error = new Error(code);
      error.code = code;
      reject(error);
    };
    if (!navigator.geolocation) {
      fail("court_field_location_unavailable");
      return;
    }
    if (courtFieldLocationPendingRef.current) {
      fail("court_field_location_pending");
      return;
    }
    courtFieldLocationPendingRef.current = true;
    setCourtFieldLocationPending(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          distanceMeters: getCoordinateDistanceMeters(courtDraft.lat, courtDraft.lng, coords.latitude, coords.longitude),
          capturedAt: new Date().toISOString(),
        };
        setCourtFieldLocation(location);
        courtFieldLocationPendingRef.current = false;
        setCourtFieldLocationPending(false);
        resolve(location);
      },
      () => {
        courtFieldLocationPendingRef.current = false;
        setCourtFieldLocationPending(false);
        fail("court_field_location_failed");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
  const selectCourtPhotos = async (event) => {
    const files = event.target.files;
    event.target.value = "";
    if (!files?.length) return;
    if (courtQuotaBlocked) {
      setCourtLookupStatus("금일 구장 신청 가능량을 넘었습니다. 오전 9시 이후 다시 신청해 주세요.");
      return;
    }
    if (courtPhotos.length >= COURT_REQUEST_PHOTO_MAX) {
      setCourtLookupStatus("현장 사진은 최대 4장까지 촬영할 수 있습니다.");
      return;
    }
    setCourtPhotoPending(true);
    try {
      if (!courtFieldLocation || Date.now() - Date.parse(courtFieldLocation.capturedAt) > COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS) {
        setCourtFieldLocation(null);
        setCourtPhotos([]);
        await readCourtFieldLocation();
      }
      const prepared = await prepareCourtRequestPhotos(files);
      setCourtPhotos((current) => [...current, ...prepared].slice(0, COURT_REQUEST_PHOTO_MAX));
      setCourtLookupStatus("현장 사진을 촬영하고 자동 최적화했습니다.");
    } catch (error) {
      setCourtLookupStatus(String(error?.code || "").startsWith("court_field_location_")
        ? "현장 위치를 확인하지 못했습니다. GPS와 위치 권한을 켠 뒤 다시 촬영해 주세요."
        : getCourtRequestPhotoErrorMessage(error?.code));
    } finally {
      setCourtPhotoPending(false);
    }
  };
  const removeCourtPhoto = (index) => setCourtPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index));
  const confirmCourtFieldLocation = async () => {
    try {
      const location = await readCourtFieldLocation();
      setCourtLookupStatus(`현장 위치 확인됨 · 오차 ${Math.round(location.accuracy)}m · 핀과 ${Math.round(location.distanceMeters)}m`);
    } catch {
      setCourtLookupStatus("현장 위치를 확인하지 못했습니다. GPS와 위치 권한을 켠 뒤 다시 시도해 주세요.");
    }
  };
  const submitCourtRequest = async (event) => {
    event.preventDefault();
    if (courtSubmitPendingRef.current) return;
    if (courtQuotaBlocked) {
      setCourtLookupStatus("금일 구장 신청 가능량을 넘었습니다. 오전 9시 이후 다시 신청해 주세요.");
      return;
    }
    if (!courtDisplayName) {
      setCourtLookupStatus("시설/장소명을 입력해 주세요.");
      return;
    }
    if (!courtAddressSelected || !courtHasMapPin) {
      setCourtLookupStatus("근처 주소를 선택하고 실제 구장 위치를 확정해 주세요.");
      return;
    }
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
    if (courtNearbyLookupFailed) {
      setCourtLookupStatus("근처 등록 구장을 다시 불러온 뒤 신청해 주세요.");
      return;
    }
    if (courtRequiresUnit && !courtDraft.courtUnit.trim()) {
      setCourtLookupStatus("같은 장소의 다른 코트라면 코트 구분을 입력해 주세요.");
      return;
    }
    if (courtSourceUrlInvalid) {
      setCourtLookupStatus("공식 안내 링크는 https:// 주소로 입력해 주세요.");
      return;
    }
    if (!courtPhotos.length) {
      setCourtLookupStatus("현장 사진을 1장 이상 선택해 주세요.");
      return;
    }
    if (!courtFieldLocation || Date.now() - Date.parse(courtFieldLocation.capturedAt) > COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS) {
      setCourtFieldLocation(null);
      setCourtLookupStatus("현장 위치를 다시 확인한 뒤 사진을 촬영해 주세요.");
      return;
    }
    if (!canSubmitCourtRequest) return;
    courtSubmitPendingRef.current = true;
    setCourtSubmitPending(true);
    try {
      const result = await app.actions.submitCourtRequest(
        { ...courtDraft, fieldLocation: courtFieldLocation },
        courtPhotos.map(({ imageBase64, byteSize, width, height }) => ({ imageBase64, byteSize, width, height })),
      );
      if (result?.error === "court_ai_daily_quota_reached") {
        setCourtAiQuota((current) => ({ ...(current ?? {}), blocked: true }));
        setCourtLookupStatus("금일 구장 신청 가능량을 넘었습니다. 오전 9시 이후 다시 신청해 주세요.");
        return;
      }
      const photoError = String(result?.error || "").replace(/^court_photo_\d+_/, "court_photo_");
      if (photoError.startsWith("court_photo_")) {
        setCourtLookupStatus(getCourtRequestPhotoErrorMessage(photoError));
        return;
      }
      if (!result?.requestId) {
        setCourtLookupStatus("구장 등록 요청을 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.");
        return;
      }
      setCourtAddressQuery("");
      setNaverAddressResults([]);
      setCourtPinConfirmed(false);
      resetCourtNearbyLookup();
      setCourtNearbyConfirmed(false);
      setCourtPhotos([]);
      setCourtFieldLocation(null);
      if (result.quota) setCourtAiQuota(result.quota);
      setCourtDraft({
        ...DEFAULT_COURT_REQUEST,
        region: app.currentUser?.region ?? DEFAULT_COURT_REQUEST.region,
      });
      setCourtLookupStatus(result.autoApproved ? "AI 검증 후 구장 자동승인 완료" : "구장 등록요청 저장됨 · AI 또는 관리자 검토 대기");
    } catch {
      setCourtLookupStatus("구장 등록 요청을 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      courtSubmitPendingRef.current = false;
      setCourtSubmitPending(false);
    }
  };

  return {
    courtAddressQuery,
    setCourtAddressQuery,
    naverAddressResults,
    setNaverAddressResults,
    courtLookupStatus,
    courtAddressSearchPending,
    courtPinPending,
    courtSubmitPending,
    courtPinConfirmed,
    courtNearbyConfirmed,
    setCourtNearbyConfirmed,
    courtDraft,
    courtPhotos,
    courtPhotoPending,
    courtFieldLocation,
    courtFieldLocationPending,
    courtQuotaBlocked,
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
    updateCourtDraft,
    searchCourtAddress,
    pickCourtMapPin,
    selectNaverAddress,
    selectCourtPhotos,
    removeCourtPhoto,
    confirmCourtFieldLocation,
    submitCourtRequest,
  };
}
