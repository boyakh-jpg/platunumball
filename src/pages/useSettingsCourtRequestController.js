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
  const courtAddressSearchRef = useRef(0);
  const courtPinPendingRef = useRef(false);
  const courtSubmitPendingRef = useRef(false);
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
  const canOpenCourtRequestForm = currentTrustScore >= COURT_REQUEST_TRUST_MIN;
  const canSubmitCourtRequest = canOpenCourtRequestForm
    && !courtDuplicate
    && !courtSourceUrlInvalid
    && !courtNearbyLookupFailed
    && (!courtNearbyReviewRequired || courtNearbyConfirmed)
    && (!courtRequiresUnit || Boolean(courtDraft.courtUnit.trim()));

  useEffect(() => {
    setCourtNearbyConfirmed(false);
  }, [courtNearbyCandidateSignature]);

  const updateCourtDraft = (patch) => {
    if (Object.keys(patch).some((key) => COURT_NEARBY_REVIEW_FIELDS.has(key))) setCourtNearbyConfirmed(false);
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
    const requestId = courtAddressSearchRef.current + 1;
    courtAddressSearchRef.current = requestId;
    setCourtAddressSearchPending(true);
    setCourtLookupStatus("네이버 주소 검색 중");
    try {
      const results = await searchNaverAddresses(courtAddressQuery);
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
  const submitCourtRequest = async (event) => {
    event.preventDefault();
    if (courtSubmitPendingRef.current) return;
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
    courtSubmitPendingRef.current = true;
    setCourtSubmitPending(true);
    try {
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
    submitCourtRequest,
  };
}
