function getAddressElement(address = {}, type = "") {
  return address.addressElements?.find((element) => element.types?.includes(type))?.longName ?? "";
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
