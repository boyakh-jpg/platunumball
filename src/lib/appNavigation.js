import { CalendarDays, ClipboardCheck, ClipboardList, Handshake, House, MessageSquareText, PlusCircle, ReceiptText, ShieldCheck, Trophy, UserRound, UsersRound } from "lucide-react";
import { ADMIN_GRADE_META } from "./adminPolicy.js";

export const APP_NOTIFICATION_PATH = "/app/notifications";
export const APP_SETTINGS_PATH = "/app/settings";
const APP_TEAMS_PATH = "/app/teams";
const APP_MATCHING_PATH = "/app/recruiting";
const APP_CREATE_PATH = "/app/create";

export const HOME_START_LINKS = Object.freeze([
  { to: APP_MATCHING_PATH, label: "경기 찾기", description: "참가할 수 있는 경기 둘러보기", icon: Handshake },
  { to: APP_CREATE_PATH, label: "경기·대회 열기", description: "일정을 정하고 참가자 모으기", icon: PlusCircle },
]);

export const HOME_RECORD_LINKS = Object.freeze([
  { to: "/app/receipt", label: "점수만 공유하기", description: "로그인 없이 점수를 입력하고 경기 영수증으로 공유해요.", icon: ReceiptText },
  { to: `${APP_CREATE_PATH}?intent=record`, label: "경기·개인 기록 남기기", description: "내 기록을 저장하거나, 참가자 확인을 받아 경기 기록을 남겨요.", icon: ClipboardCheck },
]);

export const MY_NAVIGATION_ITEMS = Object.freeze([
  { to: "/app/profile", labelKey: "myProfile", icon: UserRound },
  { to: APP_TEAMS_PATH, labelKey: "myTeams", icon: UsersRound },
]);

export const PROFILE_NAVIGATION_ITEMS = Object.freeze([
  { to: "/app/rankings", labelKey: "rankings", icon: Trophy },
  { to: "/app/admin", labelKey: "admin", icon: ShieldCheck, adminOnly: true },
]);

export const APP_NAVIGATION_ITEMS = Object.freeze([
  { to: "/app", labelKey: "home", icon: House },
  { to: "/app/matches", labelKey: "schedule", icon: CalendarDays, relatedPaths: ["/app/operations", "/app/tournaments"] },
  { to: APP_MATCHING_PATH, labelKey: "matching", icon: Handshake },
  { to: "/app/recorder", labelKey: "play", icon: ClipboardList },
  { to: "/app/community", labelKey: "board", icon: MessageSquareText },
  { to: MY_NAVIGATION_ITEMS[0].to, labelKey: "me", icon: UserRound, relatedPaths: [...MY_NAVIGATION_ITEMS.slice(1).map((item) => item.to), ...PROFILE_NAVIGATION_ITEMS.map((item) => item.to), "/app/signup"] },
]);

function getActiveNavigationPath(items, pathname) {
  return items.find((item) => (
    [item.to, ...(item.relatedPaths ?? [])].some((path) => (
      pathname === path || (path !== "/app" && pathname.startsWith(`${path}/`))
    ))
  ))?.to ?? "";
}

export function getActiveAppNavigationPath(pathname = "") {
  return getActiveNavigationPath(APP_NAVIGATION_ITEMS, pathname);
}

export function getActiveMyNavigationPath(pathname = "") {
  return getActiveNavigationPath(MY_NAVIGATION_ITEMS, pathname);
}

export function getTeamDetailNavigation(team) {
  return { to: getEntityDetailPath("teams", team.id), state: { teamPreview: team } };
}

export function getEntityDetailPath(kind, id) {
  const encodedId = encodeURIComponent(id);
  if (kind === "members") return `/app/players/${encodedId}`;
  if (kind === "teams") return `${APP_TEAMS_PATH}/${encodedId}`;
  if (kind === "tournaments") return `/app/tournaments/${encodedId}`;
  return `/app/matches?match=${encodedId}`;
}

export const getAdminDashboardDetailPath = getEntityDetailPath;

export function getRecruitingRoomPath(id = "") {
  return id ? `${APP_MATCHING_PATH}?post=${encodeURIComponent(id)}` : APP_MATCHING_PATH;
}

export function getProfileNavigationItems({ adminLevel = 0, guestPreview = false } = {}) {
  return PROFILE_NAVIGATION_ITEMS.filter((item) => (
    !item.adminOnly || (!guestPreview && Number(adminLevel) >= ADMIN_GRADE_META.support.level)
  ));
}
