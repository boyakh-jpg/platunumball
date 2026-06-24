const DAUM_POSTCODE_SCRIPT_ID = "daum-postcode-script";
const DAUM_POSTCODE_SRC = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
const KAKAO_MAP_SCRIPT_ID = "kakao-map-sdk-script";

function loadExternalScript(id, src) {
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저에서만 사용할 수 있습니다."));

  const existing = document.getElementById(id);
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  if (existing?.dataset.loading === "true") {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("외부 스크립트 로드 실패")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.dataset.loading = "true";
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      script.dataset.loading = "false";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("외부 스크립트 로드 실패")), { once: true });
    document.head.appendChild(script);
  });
}

export function getKakaoMapAppKey() {
  return (
    import.meta.env.VITE_KAKAO_MAP_APP_KEY ??
    import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY ??
    import.meta.env.VITE_KAKAO_APP_KEY ??
    ""
  );
}

function getPostcodeConstructor() {
  return window.kakao?.Postcode ?? window.daum?.Postcode ?? null;
}

export async function openDaumPostcodeSearch(query = "") {
  await loadExternalScript(DAUM_POSTCODE_SCRIPT_ID, DAUM_POSTCODE_SRC);
  const Postcode = getPostcodeConstructor();
  if (!Postcode) throw new Error("Kakao 주소검색을 사용할 수 없습니다.");
  const searchQuery = String(query ?? "").trim();

  return new Promise((resolve, reject) => {
    try {
      new Postcode({
        oncomplete: (data) => {
          resolve({
            addressText: data.roadAddress || data.address || data.jibunAddress || "",
            roadAddress: data.roadAddress ?? "",
            jibunAddress: data.jibunAddress ?? "",
            buildingName: data.buildingName ?? "",
            bname: data.bname ?? "",
            hname: data.hname ?? "",
            sido: data.sido ?? "",
            sigungu: data.sigungu ?? "",
            zonecode: data.zonecode ?? "",
          });
        },
        onclose: (state) => {
          if (state === "FORCE_CLOSE") reject(new Error("주소 검색이 닫혔습니다."));
        },
      }).open({
        q: searchQuery || undefined,
        popupTitle: "RankBall 주소 검색",
        popupKey: "rankball-court-address",
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function loadKakaoMapsSdk(appKey = getKakaoMapAppKey()) {
  if (!appKey) throw new Error("VITE_KAKAO_MAP_APP_KEY가 없습니다.");
  const src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&libraries=services&autoload=false`;
  await loadExternalScript(KAKAO_MAP_SCRIPT_ID, src);
  if (!window.kakao?.maps?.load) throw new Error("Kakao Maps SDK를 사용할 수 없습니다.");
  await new Promise((resolve) => window.kakao.maps.load(resolve));
}

export async function geocodeKakaoAddress(addressText, appKey = getKakaoMapAppKey()) {
  const address = String(addressText ?? "").trim();
  if (!address) throw new Error("주소가 비어 있습니다.");
  await loadKakaoMapsSdk(appKey);

  const geocoder = new window.kakao.maps.services.Geocoder();
  return new Promise((resolve, reject) => {
    geocoder.addressSearch(address, (results, status) => {
      if (status !== window.kakao.maps.services.Status.OK || !results?.[0]) {
        reject(new Error("좌표 변환 결과가 없습니다."));
        return;
      }
      resolve({
        lat: Number(results[0].y),
        lng: Number(results[0].x),
      });
    });
  });
}

function isValidCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

async function getInitialMapPosition({ addressText = "", lat = "", lng = "" } = {}, appKey = getKakaoMapAppKey()) {
  const numericLat = Number(lat);
  const numericLng = Number(lng);
  if (isValidCoordinate(numericLat, numericLng)) return { lat: numericLat, lng: numericLng };
  if (addressText) return geocodeKakaoAddress(addressText, appKey);
  return { lat: 37.5665, lng: 126.9780 };
}

function applyInlineStyle(element, style) {
  Object.assign(element.style, style);
  return element;
}

export async function openKakaoMapPinPicker(court = {}, appKey = getKakaoMapAppKey()) {
  if (!appKey) throw new Error("VITE_KAKAO_MAP_APP_KEY가 없습니다.");
  await loadKakaoMapsSdk(appKey);
  const initial = await getInitialMapPosition(court, appKey);

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

    const center = new window.kakao.maps.LatLng(initial.lat, initial.lng);
    const map = new window.kakao.maps.Map(mapElement, { center, level: 3 });
    const marker = new window.kakao.maps.Marker({ position: center, map, draggable: true });
    let selectedPosition = center;
    const setSelectedPosition = (latLng) => {
      selectedPosition = latLng;
      marker.setPosition(latLng);
      map.setCenter(latLng);
    };
    window.kakao.maps.event.addListener(map, "click", (event) => setSelectedPosition(event.latLng));
    window.kakao.maps.event.addListener(marker, "dragend", () => {
      selectedPosition = marker.getPosition();
    });
    submitButton.addEventListener("click", () => {
      if (settled) return;
      settled = true;
      const lat = selectedPosition.getLat();
      const lng = selectedPosition.getLng();
      cleanup();
      resolve({ lat, lng });
    });
    window.setTimeout(() => {
      map.relayout();
      map.setCenter(center);
    }, 0);
  });
}
