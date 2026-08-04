function getAddressElement(address = {}, type = "") {
  return address.addressElements?.find((element) => element.types?.includes(type))?.longName ?? "";
}

function getLocalCoordinate(value, limit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "";
  const coordinate = Math.abs(numericValue) > limit ? numericValue / 10_000_000 : numericValue;
  return Math.abs(coordinate) <= limit ? coordinate : "";
}

function getLocalTitle(value = "") {
  return String(value).replace(/<\/?b>/gi, "").replace(/&amp;/gi, "&").trim();
}

export function normalizeNaverAddress(address = {}, index = 0) {
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

export function normalizeNaverLocalPlace(place = {}, index = 0) {
  const roadAddress = String(place.roadAddress ?? "").trim();
  const jibunAddress = String(place.address ?? "").trim();
  const buildingName = getLocalTitle(place.title);
  const lat = getLocalCoordinate(place.mapy, 90);
  const lng = getLocalCoordinate(place.mapx, 180);

  return {
    id: `naver-place:${place.mapx ?? ""}:${place.mapy ?? ""}:${index}`,
    addressText: roadAddress || jibunAddress,
    roadAddress,
    jibunAddress,
    buildingName,
    bname: "",
    hname: "",
    sido: "",
    sigungu: "",
    zonecode: "",
    lat,
    lng,
  };
}
