// Shared court naming and address-deduplication policy.
export function normalizeCourtIdentityText(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}#]/gu, "");
}

export function normalizeCourtNamePart(value = "") {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/제\s+(\d+)\s*코트/gi, "제$1코트")
    .replace(/([A-Z0-9]+)\s+코트/gi, "$1코트");
}

export function normalizeCourtFacilityName(value = "") {
  const normalized = normalizeCourtNamePart(value)
    .replace(/^\[\s*\d+\s*\]\s*/, "")
    .replace(/^농구장\s*\(\s*([^()]+?)\s*\)$/i, "$1 농구장")
    .replace(/\s*\(\s*((?:실내|실외|야외)\s*)?농구장\s*\)\s*$/i, " $1농구장")
    .replace(/농구\s*코트/gi, "농구장")
    .replace(/([0-9A-Za-z가-힣])농구장/g, "$1 농구장")
    .replace(/농구장\s*(\d+)\s*면/g, "농구장 $1면")
    .replace(/농구장\s*(\d+)(?!\s*면)/g, "농구장 $1")
    .replace(/농구장\s*([A-Z])$/i, (_, unit) => `농구장 ${unit.toUpperCase()}`)
    .replace(/제\s+(\d+)\s*농구장/gi, "제$1 농구장")
    .replace(/농구장\s*및\s*/g, "농구장 및 ");
  return normalizeCourtNamePart(normalized);
}

function stripCourtAddressPrefix(name = "", addressDong = "") {
  const normalizedName = normalizeCourtFacilityName(name);
  const normalizedDong = normalizeCourtNamePart(addressDong);
  if (!normalizedDong || !normalizedName.startsWith(`${normalizedDong} `)) return normalizedName;
  return normalizedName.slice(normalizedDong.length).trim();
}

function normalizeCourtRegionText(value = "") {
  return normalizeCourtNamePart(value).replace(/^세종특별자치시$/, "세종시");
}

function isCourtCityToken(value = "") {
  return /(?:시|군)$/.test(value);
}

function isCourtDistrictToken(value = "") {
  return /구$/.test(value);
}

export function normalizeCourtSigungu(value = "", addressText = "", sido = "", region = "") {
  const safeSido = normalizeCourtRegionText(sido);
  const addressTokens = normalizeCourtNamePart(addressText).split(" ").filter(Boolean);
  let direct = normalizeCourtRegionText(value);
  if (direct === "세종시" || safeSido === "세종시" || addressTokens[0] === "세종특별자치시") return "세종시";

  if (safeSido && direct.startsWith(`${safeSido} `)) direct = direct.slice(safeSido.length).trim();
  const directParts = direct.split(" ").filter(Boolean);
  if (directParts.length > 1 && /(?:특별자치시|특별시|광역시|도)$/.test(directParts[0])) {
    direct = directParts.slice(1).join(" ");
  }

  if (direct) {
    const directTokens = direct.split(" ").filter(Boolean);
    const addressCityIndex = addressTokens.findIndex((token) => token === directTokens[0]);
    if (
      directTokens.length === 1
      && isCourtCityToken(directTokens[0])
      && addressCityIndex >= 0
      && isCourtDistrictToken(addressTokens[addressCityIndex + 1])
    ) {
      return `${directTokens[0]} ${addressTokens[addressCityIndex + 1]}`;
    }
    return direct;
  }

  const localityTokens = addressTokens[0] === safeSido || /(?:특별자치시|특별시|광역시|도)$/.test(addressTokens[0] ?? "")
    ? addressTokens.slice(1)
    : addressTokens;
  if (isCourtCityToken(localityTokens[0]) && isCourtDistrictToken(localityTokens[1])) {
    return `${localityTokens[0]} ${localityTokens[1]}`;
  }
  if (/(?:시|군|구)$/.test(localityTokens[0] ?? "")) return localityTokens[0];

  const safeRegion = normalizeCourtRegionText(region);
  return /(?:시|군|구)$/.test(safeRegion) ? safeRegion : "";
}

export function getCourtFacilityBaseName(rawName = "", sigungu = "", courtUnit = "") {
  let facilityName = normalizeCourtFacilityName(rawName);
  const safeSigungu = normalizeCourtSigungu(sigungu);
  const safeCourtUnit = normalizeCourtNamePart(courtUnit);
  if (safeSigungu && facilityName.startsWith(`${safeSigungu} `)) {
    facilityName = facilityName.slice(safeSigungu.length).trim();
  }
  if (safeCourtUnit && normalizeCourtIdentityText(facilityName).endsWith(normalizeCourtIdentityText(safeCourtUnit))) {
    facilityName = facilityName.slice(0, Math.max(0, facilityName.length - safeCourtUnit.length)).trim();
  }
  facilityName = facilityName
    .replace(/\s*(?:(?:실내|실외|야외)\s*)?농구장\s*$/i, "")
    .replace(/\s*농구\s*코트\s*$/i, "")
    .replace(/[\s·,\-]+$/g, "");
  return normalizeCourtNamePart(facilityName);
}

export function getCourtStandardName(court = {}) {
  const addressText = court.addressText || court.roadAddress || court.jibunAddress;
  const sigungu = normalizeCourtSigungu(court.sigungu, addressText, court.sido, court.region);
  const courtUnit = normalizeCourtNamePart(court.courtUnit ?? court.court_unit);
  const rawFacilityName = court.buildingName || court.facilityName || court.facility_name || court.baseName || court.name;
  const facilityName = getCourtFacilityBaseName(rawFacilityName, sigungu, courtUnit);
  if (!sigungu || !facilityName) return "";
  return normalizeCourtNamePart(`${sigungu} ${facilityName} 농구장${courtUnit ? ` ${courtUnit}` : ""}`);
}

export function getCourtAddressKey(value = "") {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function isCourtAddressLocalityOnly(value = "") {
  const normalized = normalizeCourtNamePart(value).trim();
  const text = normalized.startsWith("(") && normalized.endsWith(")")
    ? normalized.slice(1, -1).trim()
    : normalized;
  return !text
    || /^(?:\d+(?:-\d+)?(?:동|호|층|실)?\s*)+$/.test(text)
    || /^[가-힣\d]+(?:동|리|읍|면|가)$/.test(text);
}

export function getCourtAddressFacilityName(value = "") {
  const address = normalizeCourtNamePart(value);
  if (!address) return "";
  const match = address.match(/(?:^|\s)[^\s]+(?:대로|로|길)\s+\d+(?:-\d+)?(?:\s+\(([^()]*)\)|\s+(.+)|\(([^()]*)\))$/u);
  if (!match) return "";
  const normalized = normalizeCourtNamePart(match[1] || match[2] || match[3]).trim();
  const candidate = normalized.startsWith("(") && normalized.endsWith(")")
    ? normalized.slice(1, -1).trim()
    : normalized;
  return isCourtAddressLocalityOnly(candidate) ? "" : getCourtFacilityBaseName(candidate);
}

function canApplyCourtAddressFacility(row = {}) {
  const decision = String(row.name_evidence_decision ?? "").trim();
  if (decision) return decision === "administrative_fallback" || decision === "unresolved";
  const currentFacility = getCourtFacilityBaseName(row.facility_name);
  return [row.emd, row.name_evidence_reference]
    .map((value) => getCourtFacilityBaseName(value))
    .filter(Boolean)
    .includes(currentFacility);
}

export function buildCourtAddressNameUpdates(rows = []) {
  const prepared = rows.map((row) => {
    const address = row.road_address || row.address_text || row.jibun_address || "";
    return {
      row,
      addressKey: getCourtAddressKey(address),
      addressKeys: [...new Set([row.address_text, row.road_address, row.jibun_address].map(getCourtAddressKey).filter(Boolean))],
      facilityName: getCourtAddressFacilityName(row.road_address || row.address_text || ""),
    };
  });
  const addressGroups = new Map();
  prepared.forEach((item) => {
    item.addressKeys.forEach((key) => {
      const group = addressGroups.get(key) ?? [];
      group.push(item);
      addressGroups.set(key, group);
    });
  });
  const duplicateGroups = [...new Map([...addressGroups.values()]
    .filter((group) => group.length > 1)
    .map((group) => [group.map((item) => String(item.row.id)).sort().join("|"), group])).values()];
  const duplicateSeedIds = new Set(duplicateGroups.flatMap((group) => group.map((item) => String(item.row.id))));
  const parents = prepared.map((_, index) => index);
  const find = (index) => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const join = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  for (let left = 0; left < prepared.length; left += 1) {
    for (let right = left + 1; right < prepared.length; right += 1) {
      const leftItem = prepared[left];
      const rightItem = prepared[right];
      const sameAddress = leftItem.addressKeys.some((key) => rightItem.addressKeys.includes(key));
      const lat1 = Number(leftItem.row.lat);
      const lng1 = Number(leftItem.row.lng);
      const lat2 = Number(rightItem.row.lat);
      const lng2 = Number(rightItem.row.lng);
      const validCoordinates = [lat1, lng1, lat2, lng2].every(Number.isFinite);
      const latRadians = (lat2 - lat1) * Math.PI / 180;
      const lngRadians = (lng2 - lng1) * Math.PI / 180;
      const distance = validCoordinates ? 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1,
        Math.sin(latRadians / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(lngRadians / 2) ** 2
      ))) : Number.POSITIVE_INFINITY;
      if (sameAddress || distance <= 35) join(left, right);
    }
  }
  const locationGroups = new Map();
  prepared.forEach((item, index) => {
    const root = find(index);
    const group = locationGroups.get(root) ?? [];
    group.push(item);
    locationGroups.set(root, group);
  });
  const numberedGroups = [...locationGroups.values()].filter((group) => group.length > 1 && group.some((item) => duplicateSeedIds.has(String(item.row.id))));
  const duplicateUnits = new Map();
  numberedGroups.forEach((group) => {
    group.sort((left, right) => {
      const latDiff = Number(left.row.lat ?? 0) - Number(right.row.lat ?? 0);
      if (latDiff) return latDiff;
      const lngDiff = Number(left.row.lng ?? 0) - Number(right.row.lng ?? 0);
      return lngDiff || String(left.row.id).localeCompare(String(right.row.id));
    }).forEach((item, index) => duplicateUnits.set(String(item.row.id), `${index + 1}코트`));
  });
  const updates = prepared.flatMap(({ row, facilityName }) => {
    const patch = {};
    if (facilityName && canApplyCourtAddressFacility(row) && getCourtFacilityBaseName(row.facility_name) !== facilityName) {
      patch.facilityName = facilityName;
    }
    const duplicateUnit = duplicateUnits.get(String(row.id));
    if (duplicateUnit && normalizeCourtNamePart(row.court_unit) !== duplicateUnit) patch.courtUnit = duplicateUnit;
    return Object.keys(patch).length ? [{ courtId: String(row.id), patch }] : [];
  });
  const unitGroups = numberedGroups.map((group) => group.map(({ row, facilityName }) => {
    const patch = { courtUnit: duplicateUnits.get(String(row.id)) };
    if (facilityName && canApplyCourtAddressFacility(row) && getCourtFacilityBaseName(row.facility_name) !== facilityName) {
      patch.facilityName = facilityName;
    }
    return { courtId: String(row.id), patch };
  }));
  const reviewGroups = numberedGroups.map((group) => {
    const first = group[0];
    const address = first?.row?.road_address || first?.row?.address_text || first?.row?.jibun_address || "";
    const facilityName = group.find((item) => item.facilityName)?.facilityName
      || first?.row?.facility_name
      || "";
    return {
      groupId: group.map((item) => String(item.row.id)).sort().join("|"),
      detectedCount: group.length,
      facilityName,
      address,
      courts: group.map(({ row }) => ({
        id: String(row.id),
        name: row.name || "",
        facilityName: row.facility_name || "",
        courtUnit: row.court_unit || "",
        address: row.road_address || row.address_text || row.jibun_address || "",
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        status: row.status || "active",
        proximityExcess: row.proximity_excess === true,
        verifiedCourtCount: row.verified_court_count ?? null,
      })),
    };
  });
  return {
    updates,
    unitGroups,
    reviewGroups,
    scannedCount: prepared.length,
    addressFacilityCount: prepared.filter((item) => item.facilityName).length,
    duplicateAddressCount: duplicateGroups.length,
    duplicateCourtCount: numberedGroups.reduce((total, group) => total + group.length, 0),
  };
}

export function getCourtRequestName(rawName = "", addressDong = "", courtUnit = "") {
  const facilityName = stripCourtAddressPrefix(rawName, addressDong);
  const unit = normalizeCourtNamePart(courtUnit);
  if (!facilityName || !unit) return facilityName;
  const facilityKey = normalizeCourtIdentityText(facilityName);
  const unitKey = normalizeCourtIdentityText(unit);
  return facilityKey.endsWith(unitKey) ? facilityName : `${facilityName} ${unit}`;
}
