export const AGE_GROUPS = [
  { id: "junior", label: "Junior", rangeLabel: "U-13", minAge: 0, maxAge: 12 },
  { id: "rising", label: "Rising", rangeLabel: "U-20", minAge: 13, maxAge: 19 },
  { id: "open", label: "Open", rangeLabel: "Open", minAge: 20, maxAge: 120 },
];

export const AGE_GROUP_ORDER = AGE_GROUPS.map((group) => group.id);

export const REGION_TREE = [
  { sido: "서울특별시", districts: ["강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구"] },
  { sido: "부산광역시", districts: ["강서구", "금정구", "기장군", "남구", "동구", "동래구", "부산진구", "북구", "사상구", "사하구", "서구", "수영구", "연제구", "영도구", "중구", "해운대구"] },
  { sido: "대구광역시", districts: ["군위군", "남구", "달서구", "달성군", "동구", "북구", "서구", "수성구", "중구"] },
  { sido: "인천광역시", districts: ["강화군", "계양구", "남동구", "동구", "미추홀구", "부평구", "서구", "연수구", "옹진군", "중구"] },
  { sido: "대전광역시", districts: ["대덕구", "동구", "서구", "유성구", "중구"] },
  { sido: "울산광역시", districts: ["남구", "동구", "북구", "울주군", "중구"] },
  { sido: "세종특별자치시", districts: ["세종시"] },
  { sido: "경기도", districts: ["가평군", "고양시", "과천시", "광명시", "광주시", "구리시", "군포시", "김포시", "남양주시", "동두천시", "부천시", "성남시", "수원시", "시흥시", "안산시", "안성시", "안양시", "양주시", "양평군", "여주시", "연천군", "오산시", "용인시", "의왕시", "의정부시", "이천시", "파주시", "평택시", "포천시", "하남시", "화성시"] },
  { sido: "강원특별자치도", districts: ["강릉시", "고성군", "동해시", "삼척시", "속초시", "양구군", "양양군", "영월군", "원주시", "인제군", "정선군", "철원군", "춘천시", "태백시", "평창군", "홍천군", "화천군", "횡성군"] },
  { sido: "충청북도", districts: ["괴산군", "단양군", "보은군", "영동군", "옥천군", "음성군", "제천시", "증평군", "진천군", "청주시", "충주시"] },
  { sido: "충청남도", districts: ["계룡시", "공주시", "금산군", "논산시", "당진시", "보령시", "부여군", "서산시", "서천군", "아산시", "예산군", "천안시", "청양군", "태안군", "홍성군"] },
  { sido: "전북특별자치도", districts: ["고창군", "군산시", "김제시", "남원시", "무주군", "부안군", "순창군", "완주군", "익산시", "임실군", "장수군", "전주시", "정읍시", "진안군"] },
  { sido: "전남광주통합특별시", districts: ["광산구", "남구", "동구", "북구", "서구", "강진군", "고흥군", "곡성군", "광양시", "구례군", "나주시", "담양군", "목포시", "무안군", "보성군", "순천시", "신안군", "여수시", "영광군", "영암군", "완도군", "장성군", "장흥군", "진도군", "함평군", "해남군", "화순군"] },
  { sido: "경상북도", districts: ["경산시", "경주시", "고령군", "구미시", "김천시", "문경시", "봉화군", "상주시", "성주군", "안동시", "영덕군", "영양군", "영주시", "영천시", "예천군", "울릉군", "울진군", "의성군", "청도군", "청송군", "칠곡군", "포항시"] },
  { sido: "경상남도", districts: ["거제시", "거창군", "고성군", "김해시", "남해군", "밀양시", "사천시", "산청군", "양산시", "의령군", "진주시", "창녕군", "창원시", "통영시", "하동군", "함안군", "함양군", "합천군"] },
  { sido: "제주특별자치도", districts: ["서귀포시", "제주시"] },
];

const REGION_SIDO_ALIASES = new Map([
  ["광주광역시", "전남광주통합특별시"],
  ["전라남도", "전남광주통합특별시"],
  ["전남광주특별시", "전남광주통합특별시"],
  ["광주전남통합특별시", "전남광주통합특별시"],
  ["광주전남특별통합시", "전남광주통합특별시"],
  ["광주특별시", "전남광주통합특별시"],
]);

export function getAgeGroupByBirthYear(birthYear, now = new Date()) {
  const year = Number(birthYear);
  if (!Number.isInteger(year) || year < 1900) return null;
  if (year > now.getFullYear()) return null;
  const age = now.getFullYear() - year;
  return AGE_GROUPS.find((group) => age >= group.minAge && age <= group.maxAge)?.id ?? "open";
}

export function getAgeGroupSeasonForDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = safeDate.getFullYear();
  const isFirstHalf = safeDate.getMonth() < 6;
  return {
    id: `${year}-${isFirstHalf ? "h1" : "h2"}`,
    label: `${year} ${isFirstHalf ? "1" : "2"}시즌`,
    startsAt: `${year}-${isFirstHalf ? "01-01" : "07-01"}`,
    endsAt: `${year}-${isFirstHalf ? "06-30" : "12-31"}`,
  };
}

export function getAgeGroupSeasonLabel(now = new Date()) {
  const season = getAgeGroupSeasonForDate(now);
  return `${season.label} · ${season.startsAt.slice(5).replace("-", ".")}~${season.endsAt.slice(5).replace("-", ".")}`;
}

export function shouldRecheckAgeGroup(user, now = new Date()) {
  return Boolean(user?.birthYear && user?.onboardingComplete && user?.ageGroupCheckedSeason !== getAgeGroupSeasonForDate(now).id);
}

export function shouldSetupProfile(user = {}) {
  const hasLockedBirthYear = Boolean(user?.birthYearLockedAt && user?.birthYear);
  return Boolean(!user?.onboardingComplete || !user?.handleLockedAt || !hasLockedBirthYear);
}

export function getNextNameChangeDate(user = {}) {
  if (!user?.nameUpdatedAt) return null;
  const date = new Date(user.nameUpdatedAt);
  if (Number.isNaN(date.getTime())) return null;
  date.setMonth(date.getMonth() + 1);
  return date;
}

export function canChangeProfileName(user = {}, now = new Date()) {
  const nextDate = getNextNameChangeDate(user);
  return !user?.onboardingComplete || !nextDate || nextDate <= now;
}

export function getSafeAppRedirect(value, fallback = "/app") {
  const safeFallback = fallback && String(fallback).startsWith("/app") ? fallback : "/app";
  const rawValue = String(value ?? "").trim();
  if (!rawValue || rawValue.startsWith("//")) return safeFallback;

  try {
    const url = new URL(rawValue, "https://rankball.local");
    if (url.origin !== "https://rankball.local") return safeFallback;
    const redirectPath = `${url.pathname}${url.search}${url.hash}`;
    if (!redirectPath.startsWith("/app")) return safeFallback;
    if (redirectPath === "/app/signup" || redirectPath.startsWith("/app/signup?") || redirectPath.startsWith("/app/signup#")) {
      return safeFallback;
    }
    return redirectPath;
  } catch {
    return safeFallback;
  }
}

export function getAppRedirectFromLocation(location, fallback = "/app") {
  const params = new URLSearchParams(location?.search ?? "");
  const queryRedirect = params.get("redirect") ?? params.get("returnTo");
  if (queryRedirect) return getSafeAppRedirect(queryRedirect, fallback);

  const from = location?.state?.from;
  if (typeof from === "string") return getSafeAppRedirect(from, fallback);
  if (from?.pathname) return getSafeAppRedirect(`${from.pathname}${from.search ?? ""}${from.hash ?? ""}`, fallback);
  return getSafeAppRedirect(fallback, "/app");
}

export function getAgeGroupLabel(ageGroupId) {
  const group = AGE_GROUPS.find((item) => item.id === ageGroupId) ?? AGE_GROUPS[2];
  if (String(group.label).toLowerCase() === String(group.rangeLabel).toLowerCase()) return group.label;
  return `${group.label} · ${group.rangeLabel}`;
}

export function getAgeGroupForUser(user, now = new Date()) {
  return getAgeGroupByBirthYear(user?.birthYear, now) ?? user?.ageGroup ?? "open";
}

const teamRolePriority = {
  captain: 0,
  regular: 1,
  mercenary: 2,
};

function getTeamMemberForUser(team = {}, userId = "") {
  if (!userId || !Array.isArray(team.members)) return null;
  return team.members.find((member) => member?.userId === userId) ?? null;
}

function getTeamJoinSortTime(team = {}, member = {}) {
  const value = member?.joinedAt ?? member?.createdAt ?? team?.joinedAt ?? team?.createdAt ?? team?.updatedAt;
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

export function getUserProfileTeams(userId = "", teams = []) {
  return teams
    .map((team) => {
      const member = getTeamMemberForUser(team, userId);
      return member ? { ...team, myRole: member.role ?? "regular", joinedAt: member.joinedAt ?? member.createdAt ?? team.createdAt ?? "" } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (
      getTeamJoinSortTime(a, getTeamMemberForUser(a, userId)) - getTeamJoinSortTime(b, getTeamMemberForUser(b, userId)) ||
      (teamRolePriority[a.myRole] ?? 9) - (teamRolePriority[b.myRole] ?? 9) ||
      String(a.name ?? "").localeCompare(String(b.name ?? ""))
    ));
}

export function getRepresentativeTeam(userId = "", teams = [], representativeTeamId = "") {
  const userTeams = getUserProfileTeams(userId, teams);
  if (!userTeams.length) return null;
  return userTeams.find((team) => team.id === representativeTeamId) ?? userTeams[0];
}

function normalizeRegionText(value = "") {
  return String(value ?? "").replace(/\s/g, "");
}

function findDistrictForGroup(group, normalized) {
  return group.districts.find((item) => {
    const shortName = item.replace(/[시군구]$/u, "");
    return normalized.includes(item) || (shortName.length >= 2 && normalized.includes(shortName));
  });
}

function getDistrictForGroup(group, normalized) {
  return findDistrictForGroup(group, normalized) ?? group.districts[0];
}

export function inferRegionSelection(region = "") {
  const normalized = normalizeRegionText(region);
  for (const group of REGION_TREE) {
    if (normalized.includes(normalizeRegionText(group.sido))) return { sido: group.sido, district: getDistrictForGroup(group, normalized) };
  }
  for (const [alias, sido] of REGION_SIDO_ALIASES) {
    if (!normalized.includes(normalizeRegionText(alias))) continue;
    const group = REGION_TREE.find((item) => item.sido === sido);
    if (group) return { sido: group.sido, district: getDistrictForGroup(group, normalized) };
  }
  for (const group of REGION_TREE) {
    const district = findDistrictForGroup(group, normalized);
    if (district) return { sido: group.sido, district };
  }
  return { sido: REGION_TREE[0].sido, district: "마포구" };
}
