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
  if (errorCode === "profile_not_found") return "가입정보 설정 후 주소검색을 사용할 수 있습니다.";
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
    throw new Error(getNaverAddressErrorMessage(payload.error));
  }
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function searchNaverAddresses(query, clientId = getNaverMapClientId()) {
  const searchQuery = String(query ?? "").trim();
  if (!searchQuery) throw new Error("주소 검색어를 입력하세요.");
  const serverResults = await searchNaverAddressesOnServer(searchQuery);
  if (serverResults) return serverResults;

  await loadNaverMapsSdk(clientId);

  return new Promise((resolve, reject) => {
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
}

export async function geocodeNaverAddress(addressText, clientId = getNaverMapClientId()) {
  const results = await searchNaverAddresses(addressText, clientId);
  const first = results[0];
  if (!first || !first.lat || !first.lng) throw new Error("좌표 변환 결과가 없습니다.");
  return { lat: Number(first.lat), lng: Number(first.lng) };
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
    title.textContent = "지도 핀 저장";
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
      justifyContent: "flex-end",
      gap: "8px",
      padding: "12px 14px",
      borderTop: "1px solid var(--line)",
    });
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "취소";
    const submitButton = document.createElement("button");
    submitButton.type = "button";
    submitButton.textContent = "핀 저장";

    header.append(title, closeButton);
    footer.append(cancelButton, submitButton);
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
    submitButton.addEventListener("click", () => {
      if (settled) return;
      settled = true;
      const lat = selectedPosition.lat();
      const lng = selectedPosition.lng();
      cleanup();
      resolve({ lat, lng });
    });
    window.setTimeout(() => {
      if (typeof map.refresh === "function") map.refresh();
      map.setCenter(center);
    }, 0);
  });
}
