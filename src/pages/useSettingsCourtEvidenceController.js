import { useEffect, useRef, useState } from "react";
import {
  COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS,
  COURT_REQUEST_PHOTO_MAX,
  getCoordinateDistanceMeters,
} from "../../shared/lib/courtRequestImagePolicy.js";
import { normalizeCourtFacilityName } from "../lib/courts.js";
import { getCourtRequestPhotoErrorMessage, prepareCourtRequestPhotos } from "../lib/courtRequestImages.js";
import { reverseGeocodeNaverCoordinate } from "../lib/naverAddress.js";
import { isLatestRequest } from "../lib/asyncState.js";
import { getCourtAddressDong } from "./settingsPageModel.js";

export default function useSettingsCourtEvidenceController({
  courtAddressSelected,
  courtDraft,
  courtPinConfirmed,
  courtQuotaBlocked,
  courtQuotaMessage,
  getCourtAddressRegion,
  loadCourtNearbyCandidates,
  naverMapKeyReady,
  onsiteCourtEntry,
  setCourtAddressQuery,
  setCourtLookupStatus,
  setCourtPinConfirmed,
  setNaverAddressResults,
  updateCourtDraft,
}) {
  const [courtPhotos, setCourtPhotos] = useState([]);
  const [courtPhotoPending, setCourtPhotoPending] = useState(false);
  const [courtFieldLocation, setCourtFieldLocation] = useState(null);
  const [courtFieldLocationPending, setCourtFieldLocationPending] = useState(false);
  const courtFieldLocationPendingRef = useRef(false);
  const courtLocationOperationVersionRef = useRef(0);
  const courtPhotoSequenceRef = useRef(0);
  const courtPhotoObjectUrlsRef = useRef(new Set());
  const courtPhotoSelectionRef = useRef("");

  const revokePhotoPreview = (url) => {
    if (!courtPhotoObjectUrlsRef.current.delete(url)) return;
    URL.revokeObjectURL(url);
  };
  const clearCourtPhotos = () => {
    courtPhotoObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    courtPhotoObjectUrlsRef.current.clear();
    setCourtPhotos([]);
  };
  const invalidateCourtLocationOperation = () => {
    courtLocationOperationVersionRef.current += 1;
    courtFieldLocationPendingRef.current = false;
    setCourtFieldLocationPending(false);
  };
  useEffect(() => () => {
    courtLocationOperationVersionRef.current += 1;
    courtFieldLocationPendingRef.current = false;
    courtPhotoObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

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
    const operationVersion = courtLocationOperationVersionRef.current + 1;
    courtLocationOperationVersionRef.current = operationVersion;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!isLatestRequest(courtLocationOperationVersionRef.current, operationVersion)) {
          resolve(null);
          return;
        }
        const location = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          distanceMeters: getCoordinateDistanceMeters(courtDraft.lat, courtDraft.lng, coords.latitude, coords.longitude),
          capturedAt: new Date().toISOString(),
        };
        setCourtFieldLocation(location);
        resolve({ location, operationVersion });
      },
      () => {
        if (!isLatestRequest(courtLocationOperationVersionRef.current, operationVersion)) {
          resolve(null);
          return;
        }
        fail("court_field_location_failed");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });

  const selectCourtPhotos = async (event, replaceIndex = null) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) {
      setCourtLookupStatus("촬영한 사진을 받지 못했습니다. 카메라에서 사진 사용을 눌러 주세요.");
      return;
    }
    const selectionKey = files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|");
    if (courtPhotoSelectionRef.current === selectionKey) return;
    courtPhotoSelectionRef.current = selectionKey;
    let pendingPhoto = null;
    try {
      if (courtQuotaBlocked) {
        setCourtLookupStatus(courtQuotaMessage);
        return;
      }
      if (replaceIndex === null && courtPhotos.length >= COURT_REQUEST_PHOTO_MAX) {
        setCourtLookupStatus("현장 사진은 최대 2장까지 촬영할 수 있습니다.");
        return;
      }
      if (!courtPinConfirmed) {
        setCourtLookupStatus("구장 위치를 먼저 지정한 뒤 사진을 추가해 주세요.");
        return;
      }
      if (onsiteCourtEntry && !courtFieldLocation) {
        setCourtLookupStatus("현장 위치를 먼저 확인한 뒤 사진을 촬영해 주세요.");
        return;
      }
      if (onsiteCourtEntry && Date.now() - Date.parse(courtFieldLocation.capturedAt) > COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS) {
        setCourtFieldLocation(null);
        setCourtLookupStatus("현장 위치 확인 시간이 지났습니다. 위치를 다시 확인해 주세요.");
        return;
      }
      const file = files[0];
      const previewUrl = URL.createObjectURL(file);
      courtPhotoObjectUrlsRef.current.add(previewUrl);
      pendingPhoto = {
        id: `court-photo-${++courtPhotoSequenceRef.current}`,
        previewUrl,
        byteSize: file.size,
        pending: true,
        error: "",
      };
      if (replaceIndex !== null) revokePhotoPreview(courtPhotos[replaceIndex]?.previewUrl);
      setCourtPhotos((current) => replaceIndex === null
        ? [...current, pendingPhoto].slice(0, COURT_REQUEST_PHOTO_MAX)
        : current.map((photo, index) => (index === replaceIndex ? pendingPhoto : photo)));
      setCourtPhotoPending(true);
      setCourtLookupStatus("촬영한 사진을 자동 최적화하는 중입니다.");
      const [prepared] = await prepareCourtRequestPhotos([file], courtFieldLocation);
      revokePhotoPreview(previewUrl);
      setCourtPhotos((current) => current.map((photo) => (photo.id === pendingPhoto.id
        ? { ...prepared, id: pendingPhoto.id, pending: false, error: "" }
        : photo)));
      setCourtLookupStatus(replaceIndex === null
        ? `현장 사진 ${Math.min(courtPhotos.length + 1, COURT_REQUEST_PHOTO_MAX)}장을 촬영하고 자동 최적화했습니다.`
        : `현장 사진 ${replaceIndex + 1}장을 다시 촬영했습니다.`);
    } catch (error) {
      const message = String(error?.code || "").startsWith("court_field_location_")
        ? "현장 위치를 확인하지 못했습니다. GPS와 위치 권한을 켠 뒤 다시 촬영해 주세요."
        : getCourtRequestPhotoErrorMessage(error?.code);
      if (pendingPhoto) {
        setCourtPhotos((current) => current.map((photo) => (photo.id === pendingPhoto.id
          ? { ...photo, pending: false, error: message }
          : photo)));
      }
      setCourtLookupStatus(message);
    } finally {
      if (courtPhotoSelectionRef.current === selectionKey) courtPhotoSelectionRef.current = "";
      input.value = "";
      setCourtPhotoPending(false);
    }
  };
  const removeCourtPhoto = (index) => {
    revokePhotoPreview(courtPhotos[index]?.previewUrl);
    setCourtPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index));
  };
  const confirmCourtFieldLocation = async () => {
    let location = null;
    let operationVersion = 0;
    try {
      const captured = await readCourtFieldLocation();
      if (!captured) return;
      ({ location, operationVersion } = captured);
      if (courtPinConfirmed && courtAddressSelected) {
        setCourtLookupStatus(`현장 위치 확인됨 · 오차 ${Math.round(location.accuracy)}m · 핀과 ${Math.round(location.distanceMeters)}m`);
        return;
      }
      if (!naverMapKeyReady) throw new Error("court_reverse_geocode_unavailable");
      const pin = await reverseGeocodeNaverCoordinate(location.lat, location.lng);
      if (!isLatestRequest(courtLocationOperationVersionRef.current, operationVersion)) return;
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
        lat: String(location.lat),
        lng: String(location.lng),
      });
      setCourtFieldLocation({ ...location, distanceMeters: 0 });
      setCourtAddressQuery(pin.addressText);
      setNaverAddressResults([]);
      setCourtPinConfirmed(true);
      setCourtLookupStatus(`현재 위치로 구장을 지정했습니다 · GPS 오차 ${Math.round(location.accuracy)}m`);
      await loadCourtNearbyCandidates({ ...pin, lat: location.lat, lng: location.lng }, operationVersion);
    } catch {
      if (operationVersion && !isLatestRequest(courtLocationOperationVersionRef.current, operationVersion)) return;
      setCourtLookupStatus(location
        ? "현재 위치는 확인했지만 주소를 찾지 못했습니다. 주소로 찾기를 선택해 직접 지정해 주세요."
        : "현장 위치를 확인하지 못했습니다. GPS와 위치 권한을 켠 뒤 다시 시도해 주세요.");
    } finally {
      if (!operationVersion || isLatestRequest(courtLocationOperationVersionRef.current, operationVersion)) {
        courtFieldLocationPendingRef.current = false;
        setCourtFieldLocationPending(false);
      }
    }
  };

  return {
    clearCourtPhotos,
    confirmCourtFieldLocation,
    courtFieldLocation,
    courtFieldLocationPending,
    courtLocationOperationVersionRef,
    courtPhotoPending,
    courtPhotos,
    invalidateCourtLocationOperation,
    removeCourtPhoto,
    selectCourtPhotos,
    setCourtFieldLocation,
  };
}
