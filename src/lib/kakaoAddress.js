const DAUM_POSTCODE_SCRIPT_ID = "daum-postcode-script";
const DAUM_POSTCODE_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
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
  return import.meta.env.VITE_KAKAO_MAP_APP_KEY ?? "";
}

export async function openDaumPostcodeSearch() {
  await loadExternalScript(DAUM_POSTCODE_SCRIPT_ID, DAUM_POSTCODE_SRC);
  if (!window.daum?.Postcode) throw new Error("Daum 주소검색을 사용할 수 없습니다.");

  return new Promise((resolve, reject) => {
    try {
      new window.daum.Postcode({
        oncomplete: (data) => {
          resolve({
            addressText: data.roadAddress || data.jibunAddress || data.address || "",
            roadAddress: data.roadAddress ?? "",
            jibunAddress: data.jibunAddress ?? "",
            buildingName: data.buildingName ?? "",
            sido: data.sido ?? "",
            sigungu: data.sigungu ?? "",
            zonecode: data.zonecode ?? "",
          });
        },
        onclose: (state) => {
          if (state === "FORCE_CLOSE") reject(new Error("주소 검색이 닫혔습니다."));
        },
      }).open();
    } catch (error) {
      reject(error);
    }
  });
}

export async function geocodeKakaoAddress(addressText, appKey = getKakaoMapAppKey()) {
  const address = String(addressText ?? "").trim();
  if (!address) throw new Error("주소가 비어 있습니다.");
  if (!appKey) throw new Error("VITE_KAKAO_MAP_APP_KEY가 없습니다.");

  const src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&libraries=services&autoload=false`;
  await loadExternalScript(KAKAO_MAP_SCRIPT_ID, src);
  if (!window.kakao?.maps?.load) throw new Error("Kakao Maps SDK를 사용할 수 없습니다.");
  await new Promise((resolve) => window.kakao.maps.load(resolve));

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
