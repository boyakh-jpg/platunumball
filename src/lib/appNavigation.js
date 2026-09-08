import { CalendarDays, ClipboardList, Handshake, House, MessageSquareText, Settings, ShieldCheck, Trophy, UserRound, UsersRound } from "lucide-react";
import { ADMIN_GRADE_META } from "./adminPolicy.js";

export const APP_NOTIFICATION_PATH = "/app/notifications";

export const PROFILE_NAVIGATION_ITEMS = Object.freeze([
  { to: "/app/teams", labelKey: "teams", icon: UsersRound },
  { to: "/app/rankings", labelKey: "rankings", icon: Trophy },
  { to: "/app/settings", labelKey: "settings", icon: Settings },
  { to: "/app/admin", labelKey: "admin", icon: ShieldCheck, adminOnly: true },
]);

export const APP_NAVIGATION_ITEMS = Object.freeze([
  { to: "/app", labelKey: "home", icon: House },
  { to: "/app/matches", labelKey: "schedule", icon: CalendarDays, relatedPaths: ["/app/operations", "/app/tournaments"] },
  { to: "/app/recruiting", labelKey: "matching", icon: Handshake },
  { to: "/app/recorder", labelKey: "play", icon: ClipboardList },
  { to: "/app/community", labelKey: "board", icon: MessageSquareText },
  { to: "/app/profile", labelKey: "me", icon: UserRound, relatedPaths: [...PROFILE_NAVIGATION_ITEMS.map((item) => item.to), "/app/signup"] },
]);

export function getActiveAppNavigationPath(pathname = "") {
  return APP_NAVIGATION_ITEMS.find((item) => (
    [item.to, ...(item.relatedPaths ?? [])].some((path) => (
      pathname === path || (path !== "/app" && pathname.startsWith(`${path}/`))
    ))
  ))?.to ?? "";
}

export function getProfileNavigationItems({ adminLevel = 0, guestPreview = false } = {}) {
  return PROFILE_NAVIGATION_ITEMS.filter((item) => (
    !item.adminOnly || (!guestPreview && Number(adminLevel) >= ADMIN_GRADE_META.support.level)
  ));
}
