import { isSupabaseConfigured, supabase } from "./supabase.js";

const NAVER_MAP_SCRIPT_ID = "naver-map-sdk-script";
const NAVER_MAP_READY_CALLBACK = "__rankballNaverMapsReady";
let naverMapReadyPromise = null;

function hasNaverGeocoder() {
  return typeof window !== "undefined" && Boolean(window.naver?.maps?.Service?.geocode);
}

function loadExternalScript(id, src) {
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저에서만 사용할 수 있습니다."));

  let existing = document.getElementById(id);
  const existingSrc = existing?.dataset.src || existing?.src || "";
  if (existing && existingSrc && existingSrc !== src) {
    existing.remove();
    existing = null;
  }
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  if (existing?.dataset.loading === "true") {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("지도 스크립트 로드 실패")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.dataset.src = src;
    script.dataset.loading = "true";
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      script.dataset.loading = "false";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("지도 스크립트 로드 실패")), { once: true });
    document.head.appendChild(script);
  });
}

function waitForNaverGeocoder() {
  if (hasNaverGeocoder()) return Promise.resolve();
  if (naverMapReadyPromise) return naverMapReadyPromise;

  naverMapReadyPromise = new Promise((resolve, reject) => {
    let intervalId = 0;
    let timeoutId = 0;
    const finish = (error) => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
      if (error) reject(error);
      else resolve();
    };
    window[NAVER_MAP_READY_CALLBACK] = () => {
      if (hasNaverGeocoder()) finish();
    };
    intervalId = window.setInterval(() => {
      if (hasNaverGeocoder()) finish();
    }, 50);
    timeoutId = window.setTimeout(() => {
      finish(new Error("Naver Maps Geocoder를 사용할 수 없습니다."));
    }, 10000);
  }).finally(() => {
    naverMapReadyPromise = null;
  });

  return naverMapReadyPromise;
}

export function getNaverMapClientId() {
  return (
    import.meta.env.VITE_NAVER_MAP_CLIENT_ID ??
    import.meta.env.VITE_NAVER_MAP_NCP_KEY_ID ??
    import.meta.env.VITE_NAVER_MAP_NCP_CLIENT_ID ??
    ""
  );
}

async function loadNaverMapsSdk(clientId = getNaverMapClientId()) {
  if (!clientId) throw new Error("VITE_NAVER_MAP_CLIENT_ID가 없습니다.");
  if (typeof window === "undefined") throw new Error("브라우저에서만 사용할 수 있습니다.");
  if (hasNaverGeocoder()) return;
  const src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}&submodules=geocoder&callback=${NAVER_MAP_READY_CALLBACK}`;
  const readyPromise = waitForNaverGeocoder();
  await Promise.all([loadExternalScript(NAVER_MAP_SCRIPT_ID, src), readyPromise]);
}

function getAddressElement(address = {}, type = "") {
  return address.addressElements?.find((element) => element.types?.includes(type))?.longName ?? "";
}

function normalizeNaverAddress(address = {}, index = 0) {
  const lat = Number(address.y);
  const lng = Number(address.x);
  const roadAddress = String(address.roadAddress ?? "").trim();
  const jibunAddress = String(address.jibunAddress ?? "").trim();
  const addressText = roadAddress || jibunAddress || String(address.englishAddress ?? "").trim();

  return {
    id: `naver:${address.x ?? ""}:${address.y ?? ""}:${index}`,
    addressText,
    roadAddress,
    jibunAddress,
    buildingName: getAddressElement(address, "BUILDING_NAME"),
    bname: getAddressElement(address, "DONGMYUN") || getAddressElement(address, "RI"),
    hname: getAddressElement(address, "DONGMYUN"),
    sido: getAddressElement(address, "SIDO"),
    sigungu: getAddressElement(address, "SIGUGUN"),
    zonecode: address.postalCode ?? getAddressElement(address, "POSTAL_CODE"),
    lat: Number.isFinite(lat) ? lat : "",
    lng: Number.isFinite(lng) ? lng : "",
  };
}

function getNaverAddressErrorMessage(errorCode = "") {
  if (errorCode === "missing_bearer_token" || errorCode === "invalid_bearer_token") return "로그인 세션을 다시 확인해주세요.";
  if (errorCode === "profile_not_found") return "서버 프로필 저장 전이라 서버 주소검색을 사용할 수 없습니다.";
  if (errorCode === "court_request_trust_required") return "구장 등록요청 권한이 부족합니다.";
  if (errorCode === "address_search_rate_limited") return "주소검색 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
  if (errorCode === "naver_client_id_missing") return "서버에 NAVER_MAP_CLIENT_ID 또는 VITE_NAVER_MAP_CLIENT_ID가 없습니다.";
  if (errorCode === "naver_client_secret_missing") return "서버에 NAVER_MAP_CLIENT_SECRET이 없습니다.";
  if (String(errorCode).startsWith("naver_geocode_failed")) return "네이버 주소검색 API 호출이 실패했습니다. Naver Maps Geocoding 권한과 키를 확인해주세요.";
  return errorCode || "주소 검색 실패";
}

async function searchNaverAddressesOnServer(searchQuery) {
  if (!isSupabaseConfigured) return null;

  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) return null;

  const response = await fetch(`/api/courts/address-search?q=${encodeURIComponent(searchQuery)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(getNaverAddressErrorMessage(payload.error));
    error.code = payload.error;
    throw error;
  }
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function searchNaverAddresses(query, clientId = getNaverMapClientId()) {
  const searchQuery = String(query ?? "").trim();
  if (!searchQuery) throw new Error("주소 검색어를 입력하세요.");

  try {
    await loadNaverMapsSdk(clientId);
    return await new Promise((resolve, reject) => {
      window.naver.maps.Service.geocode({ query: searchQuery }, (status, response) => {
        if (status !== window.naver.maps.Service.Status.OK) {
          reject(new Error("네이버 주소검색 API 호출이 실패했습니다. Naver Maps Geocoding 권한과 도메인 설정을 확인해주세요."));
          return;
        }
        const results = (response.v2?.addresses ?? [])
          .map(normalizeNaverAddress)
          .filter((address) => address.addressText);
        resolve(results);
      });
    });
  } catch (clientError) {
    try {
      const serverResults = await searchNaverAddressesOnServer(searchQuery);
      if (serverResults) return serverResults;
    } catch (serverError) {
      if (!["profile_not_found", "court_request_trust_required"].includes(serverError.code)) {
        throw serverError;
      }
    }
    throw clientError;
  }
}

export async function geocodeNaverAddress(addressText, clientId = getNaverMapClientId()) {
  const results = await searchNaverAddresses(addressText, clientId);
  const first = results[0];
  if (!first || !first.lat || !first.lng) throw new Error("좌표 변환 결과가 없습니다.");
  return { lat: Number(first.lat), lng: Number(first.lng) };
}

function getReverseAddressResult(response = {}, name = "") {
  return (response.v2?.results ?? response.results ?? []).find((result) => result?.name === name) ?? null;
}

function getReverseRegionValue(result = {}, area = "") {
  return String(result?.region?.[area]?.name ?? "").trim();
}

function normalizeReverseAddressText(value = "") {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function formatReverseAddress(result = {}, includeBuilding = false) {
  if (!result) return "";
  const region = ["area1", "area2", "area3", "area4"]
    .map((area) => getReverseRegionValue(result, area))
    .filter(Boolean);
  const land = result.land ?? {};
  const number = [land.number1, land.number2].filter(Boolean).join("-");
  const mountain = result.name === "addr" && String(land.type) === "2" ? "산" : "";
  const road = result.name === "roadaddr" ? String(land.name ?? "").trim() : "";
  const building = includeBuilding && land.addition0?.type === "building" ? String(land.addition0.value ?? "").trim() : "";
  return [...region, road, [mountain, number].filter(Boolean).join(" "), building].filter(Boolean).join(" ");
}

export function normalizeNaverReverseAddress(response = {}, lat, lng) {
  const roadResult = getReverseAddressResult(response, "roadaddr");
  const jibunResult = getReverseAddressResult(response, "addr");
  const legalResult = getReverseAddressResult(response, "legalcode");
  const adminResult = getReverseAddressResult(response, "admcode");
  const regionResult = roadResult ?? jibunResult ?? legalResult ?? adminResult;
  const roadAddress = normalizeReverseAddressText(response.v2?.address?.roadAddress ?? response.address?.roadAddress ?? formatReverseAddress(roadResult, true));
  const jibunAddress = normalizeReverseAddressText(response.v2?.address?.jibunAddress ?? response.address?.jibunAddress ?? formatReverseAddress(jibunResult));
  const addressText = roadAddress || jibunAddress;
  if (!addressText) throw new Error("핀 위치의 주소를 찾을 수 없습니다.");

  return {
    id: `naver-pin:${lng}:${lat}`,
    addressText,
    roadAddress,
    jibunAddress,
    buildingName: roadResult?.land?.addition0?.type === "building" ? normalizeReverseAddressText(roadResult.land.addition0.value) : "",
    bname: getReverseRegionValue(jibunResult ?? legalResult ?? regionResult, "area4") || getReverseRegionValue(jibunResult ?? legalResult ?? regionResult, "area3"),
    hname: getReverseRegionValue(adminResult ?? regionResult, "area4") || getReverseRegionValue(adminResult ?? regionResult, "area3"),
    sido: getReverseRegionValue(regionResult, "area1"),
    sigungu: getReverseRegionValue(regionResult, "area2"),
    zonecode: roadResult?.land?.addition1?.type === "zipcode" ? String(roadResult.land.addition1.value ?? "").trim() : "",
    lat: Number(lat),
    lng: Number(lng),
  };
}

export async function reverseGeocodeNaverCoordinate(lat, lng, clientId = getNaverMapClientId()) {
  const numericLat = Number(lat);
  const numericLng = Number(lng);
  if (!isValidCoordinate(numericLat, numericLng)) throw new Error("유효한 핀 좌표가 아닙니다.");
  await loadNaverMapsSdk(clientId);
  if (typeof window.naver?.maps?.Service?.reverseGeocode !== "function") {
    throw new Error("Naver Maps Reverse Geocoding을 사용할 수 없습니다.");
  }

  return new Promise((resolve, reject) => {
    const service = window.naver.maps.Service;
    const orders = [service.OrderType?.ADDR ?? "addr", service.OrderType?.ROAD_ADDR ?? "roadaddr"].join(",");
    service.reverseGeocode({
      coords: new window.naver.maps.LatLng(numericLat, numericLng),
      orders,
    }, (status, response) => {
      if (status !== service.Status.OK || Number(response?.v2?.status?.code ?? 0) !== 0) {
        reject(new Error("핀 위치의 주소 변환에 실패했습니다."));
        return;
      }
      try {
        resolve(normalizeNaverReverseAddress(response, numericLat, numericLng));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function isValidCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

async function getInitialMapPosition({ addressText = "", lat = "", lng = "" } = {}, clientId = getNaverMapClientId()) {
  const numericLat = Number(lat);
  const numericLng = Number(lng);
  if (isValidCoordinate(numericLat, numericLng)) return { lat: numericLat, lng: numericLng };
  if (addressText) return geocodeNaverAddress(addressText, clientId);
  return { lat: 37.5665, lng: 126.9780 };
}

function applyInlineStyle(element, style) {
  Object.assign(element.style, style);
  return element;
}

export async function openNaverMapPinPicker(court = {}, clientId = getNaverMapClientId()) {
  if (!clientId) throw new Error("VITE_NAVER_MAP_CLIENT_ID가 없습니다.");
  await loadNaverMapsSdk(clientId);
  const initial = await getInitialMapPosition(court, clientId);

  return new Promise((resolve, reject) => {
    let settled = false;
    let resolving = false;
    const overlay = applyInlineStyle(document.createElement("div"), {
      position: "fixed",
      inset: "0",
      zIndex: "9999",
      background: "rgba(0, 0, 0, 0.55)",
      display: "grid",
      placeItems: "center",
      padding: "16px",
    });
    const panel = applyInlineStyle(document.createElement("div"), {
      width: "min(720px, 100%)",
      background: "var(--surface)",
      border: "1px solid var(--line)",
      borderRadius: "8px",
      overflow: "hidden",
      boxShadow: "0 20px 60px rgba(0, 0, 0, 0.35)",
    });
    const header = applyInlineStyle(document.createElement("div"), {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 14px",
      borderBottom: "1px solid var(--line)",
    });
    const title = document.createElement("strong");
    title.textContent = "실제 구장 위치 선택";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "닫기";
    const mapElement = applyInlineStyle(document.createElement("div"), {
      width: "100%",
      height: "420px",
      background: "#eef3f5",
    });
    const footer = applyInlineStyle(document.createElement("div"), {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: "8px",
      padding: "12px 14px",
      borderTop: "1px solid var(--line)",
    });
    const pinStatus = applyInlineStyle(document.createElement("span"), {
      color: "var(--muted)",
      fontSize: "12px",
    });
    pinStatus.textContent = "핀 좌표의 실제 주소를 확인해 저장합니다.";
    const footerActions = applyInlineStyle(document.createElement("div"), {
      display: "flex",
      gap: "8px",
      marginLeft: "auto",
    });
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "취소";
    const submitButton = document.createElement("button");
    submitButton.type = "button";
    submitButton.textContent = "이 위치로 주소 확정";

    header.append(title, closeButton);
    footerActions.append(cancelButton, submitButton);
    footer.append(pinStatus, footerActions);
    panel.append(header, mapElement, footer);
    overlay.append(panel);
    document.body.appendChild(overlay);

    const cleanup = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("지도 선택이 닫혔습니다."));
    };
    closeButton.addEventListener("click", cancel);
    cancelButton.addEventListener("click", cancel);

    const center = new window.naver.maps.LatLng(initial.lat, initial.lng);
    const map = new window.naver.maps.Map(mapElement, { center, zoom: 16 });
    const marker = new window.naver.maps.Marker({ position: center, map, draggable: true });
    let selectedPosition = center;
    const setSelectedPosition = (latLng) => {
      selectedPosition = latLng;
      marker.setPosition(latLng);
      map.setCenter(latLng);
    };
    window.naver.maps.Event.addListener(map, "click", (event) => setSelectedPosition(event.coord));
    window.naver.maps.Event.addListener(marker, "dragend", () => {
      selectedPosition = marker.getPosition();
    });
    submitButton.addEventListener("click", async () => {
      if (settled || resolving) return;
      resolving = true;
      const lat = selectedPosition.lat();
      const lng = selectedPosition.lng();
      submitButton.disabled = true;
      submitButton.textContent = "주소 확인 중";
      pinStatus.textContent = "핀 위치를 주소로 변환하고 있습니다.";
      pinStatus.style.color = "var(--muted)";
      try {
        const address = await reverseGeocodeNaverCoordinate(lat, lng, clientId);
        if (settled) return;
        settled = true;
        cleanup();
        resolve(address);
      } catch (error) {
        if (settled) return;
        resolving = false;
        submitButton.disabled = false;
        submitButton.textContent = "이 위치로 주소 확정";
        pinStatus.textContent = error.message || "핀 위치의 주소를 확인하지 못했습니다.";
        pinStatus.style.color = "var(--danger, #d94b3d)";
      }
    });
    window.setTimeout(() => {
      if (typeof map.refresh === "function") map.refresh();
      map.setCenter(center);
    }, 0);
  });
}
