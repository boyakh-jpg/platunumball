import { normalizeRegionText } from "./regionText.js";
import {
  AGE_GROUPS,
  formatProfileDate,
  getAgeGroupByBirthYear,
  getAgeGroupForUser,
  getAgeGroupLabel,
  getAgeGroupSeasonForDate,
  getAgeGroupSeasonLabel,
  shouldRecheckAgeGroup,
} from "../../shared/lib/profileSetup.js";

export {
  AGE_GROUPS,
  formatProfileDate,
  getAgeGroupByBirthYear,
  getAgeGroupForUser,
  getAgeGroupLabel,
  getAgeGroupSeasonForDate,
  getAgeGroupSeasonLabel,
  shouldRecheckAgeGroup,
};

export const REGION_TREE = [
  { sido: "서울특별시", districts: ["종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구", "도봉구", "노원구", "은평구", "서대문구", "마포구", "양천구", "강서구", "구로구", "금천구", "영등포구", "동작구", "관악구", "서초구", "강남구", "송파구", "강동구"] },
  { sido: "전남광주통합특별시", districts: ["목포시", "여수시", "순천시", "나주시", "광양시", "동구", "서구", "남구", "북구", "광산구", "담양군", "곡성군", "구례군", "고흥군", "보성군", "화순군", "장흥군", "강진군", "해남군", "영암군", "무안군", "함평군", "영광군", "장성군", "완도군", "진도군", "신안군"] },
  { sido: "부산광역시", districts: ["중구", "서구", "동구", "영도구", "부산진구", "동래구", "남구", "북구", "해운대구", "사하구", "금정구", "강서구", "연제구", "수영구", "사상구", "기장군"] },
  { sido: "대구광역시", districts: ["중구", "동구", "서구", "남구", "북구", "수성구", "달서구", "달성군", "군위군"] },
  { sido: "인천광역시", districts: ["제물포구", "영종구", "미추홀구", "연수구", "남동구", "부평구", "계양구", "서해구", "검단구", "강화군", "옹진군"] },
  { sido: "대전광역시", districts: ["동구", "중구", "서구", "유성구", "대덕구"] },
  { sido: "울산광역시", districts: ["중구", "남구", "동구", "북구", "울주군"] },
  { sido: "세종특별자치시", districts: ["세종시"] },
  { sido: "경기도", districts: ["수원시", "성남시", "의정부시", "안양시", "부천시", "광명시", "평택시", "동두천시", "안산시", "고양시", "과천시", "구리시", "남양주시", "오산시", "시흥시", "군포시", "의왕시", "하남시", "용인시", "파주시", "이천시", "안성시", "김포시", "화성시", "광주시", "양주시", "포천시", "여주시", "연천군", "가평군", "양평군"] },
  { sido: "충청북도", districts: ["청주시", "충주시", "제천시", "보은군", "옥천군", "영동군", "증평군", "진천군", "괴산군", "음성군", "단양군"] },
  { sido: "충청남도", districts: ["천안시", "공주시", "보령시", "아산시", "서산시", "논산시", "계룡시", "당진시", "금산군", "부여군", "서천군", "청양군", "홍성군", "예산군", "태안군"] },
  { sido: "경상북도", districts: ["포항시", "경주시", "김천시", "안동시", "구미시", "영주시", "영천시", "상주시", "문경시", "경산시", "의성군", "청송군", "영양군", "영덕군", "청도군", "고령군", "성주군", "칠곡군", "예천군", "봉화군", "울진군", "울릉군"] },
  { sido: "경상남도", districts: ["창원시", "진주시", "통영시", "사천시", "김해시", "밀양시", "거제시", "양산시", "의령군", "함안군", "창녕군", "고성군", "남해군", "하동군", "산청군", "함양군", "거창군", "합천군"] },
  { sido: "제주특별자치도", districts: ["제주시", "서귀포시"] },
  { sido: "강원특별자치도", districts: ["춘천시", "원주시", "강릉시", "동해시", "태백시", "속초시", "삼척시", "홍천군", "횡성군", "영월군", "평창군", "정선군", "철원군", "화천군", "양구군", "인제군", "고성군", "양양군"] },
  { sido: "전북특별자치도", districts: ["전주시", "군산시", "익산시", "정읍시", "남원시", "김제시", "완주군", "진안군", "무주군", "장수군", "임실군", "순창군", "고창군", "부안군"] },
];

const REGION_SIDO_ALIASES = new Map([
  ["광주광역시", "전남광주통합특별시"],
  ["전라남도", "전남광주통합특별시"],
  ["전남광주특별시", "전남광주통합특별시"],
  ["광주전남통합특별시", "전남광주통합특별시"],
  ["광주전남특별통합시", "전남광주통합특별시"],
  ["광주특별시", "전남광주통합특별시"],
]);

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
    const url = new URL(rawValue, "https://boxtier.local");
    if (url.origin !== "https://boxtier.local") return safeFallback;
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

function findDistrictForGroup(group, normalized) {
  return group.districts.find((item) => {
    const shortName = item.replace(/[시군구]$/u, "");
    return normalized.includes(item) || (shortName.length >= 2 && normalized.includes(shortName));
  });
}

function getDistrictForGroup(group, normalized) {
  return findDistrictForGroup(group, normalized) ?? group.districts[0];
}

export function getRegionDistrictOptions(sido = "") {
  return (REGION_TREE.find((group) => group.sido === sido) ?? REGION_TREE[0])?.districts ?? [];
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

export function getProfileRegionSelection(user = {}) {
  return inferRegionSelection([
    user?.regionSido,
    user?.regionDistrict,
    user?.region,
  ].filter(Boolean).join(" "));
}
