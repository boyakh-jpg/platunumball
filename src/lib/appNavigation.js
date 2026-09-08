import { CalendarDays, ClipboardList, Handshake, House, MessageSquareText, ShieldCheck, Trophy, UserRound, UsersRound } from "lucide-react";
import { ADMIN_GRADE_META } from "./adminPolicy.js";

export const APP_NOTIFICATION_PATH = "/app/notifications";
export const APP_SETTINGS_PATH = "/app/settings";

export const MY_NAVIGATION_ITEMS = Object.freeze([
  { to: "/app/profile", labelKey: "myProfile", icon: UserRound },
  { to: "/app/teams", labelKey: "myTeams", icon: UsersRound },
]);

export const PROFILE_NAVIGATION_ITEMS = Object.freeze([
  { to: "/app/rankings", labelKey: "rankings", icon: Trophy },
  { to: "/app/admin", labelKey: "admin", icon: ShieldCheck, adminOnly: true },
]);

export const APP_NAVIGATION_ITEMS = Object.freeze([
  { to: "/app", labelKey: "home", icon: House },
  { to: "/app/matches", labelKey: "schedule", icon: CalendarDays, relatedPaths: ["/app/operations", "/app/tournaments"] },
  { to: "/app/recruiting", labelKey: "matching", icon: Handshake },
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

export function getProfileNavigationItems({ adminLevel = 0, guestPreview = false } = {}) {
  return PROFILE_NAVIGATION_ITEMS.filter((item) => (
    !item.adminOnly || (!guestPreview && Number(adminLevel) >= ADMIN_GRADE_META.support.level)
  ));
}
