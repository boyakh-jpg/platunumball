export const MATCH_RECEIPT_PATH = "/app/receipt";

export const RECEIPT_SHELL_COPY = Object.freeze({
  ko: {
    primaryNavigation: "주요 메뉴",
    bottomNavigation: "하단 메뉴",
    moreMenu: "더보기 메뉴",
    home: "홈",
    notifications: "알림",
    schedule: "일정",
    matching: "매칭",
    play: "플레이",
    teams: "팀",
    community: "커뮤니티",
    board: "게시판",
    rankings: "랭크보드",
    me: "나",
    settings: "설정",
    more: "더보기",
    signIn: "로그인",
    guestHint: "기록·참가 기능 사용",
    serviceInformation: "서비스 정보",
    privacyPolicy: "개인정보처리방침",
    termsOfService: "서비스 약관",
    courtData: "농구장 데이터:",
    publicDataPortal: "공공데이터포털",
    unreadNotifications: (count) => `알림, 읽지 않은 알림 ${count}개`,
  },
  en: {
    primaryNavigation: "Primary navigation",
    bottomNavigation: "Bottom navigation",
    moreMenu: "More menu",
    home: "Home",
    notifications: "Notifications",
    schedule: "Schedule",
    matching: "Matching",
    play: "Play",
    teams: "Teams",
    community: "Community",
    board: "Board",
    rankings: "Rankings",
    me: "Me",
    settings: "Settings",
    more: "More",
    signIn: "Sign in",
    guestHint: "Save records and join games",
    serviceInformation: "Service information",
    privacyPolicy: "Privacy Policy",
    termsOfService: "Terms of Service",
    courtData: "Court data:",
    publicDataPortal: "Public Data Portal",
    unreadNotifications: (count) => `Notifications, ${count} unread`,
  },
});

export function getReceiptLocale(location = {}) {
  if (location.pathname !== MATCH_RECEIPT_PATH) return "ko";
  return new URLSearchParams(location.search || "").get("lang") === "en" ? "en" : "ko";
}

export function getReceiptSearchWithLocale(search, locale) {
  const params = new URLSearchParams(search || "");
  if (locale === "en") params.set("lang", "en");
  else params.delete("lang");
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function applyReceiptLocaleToUrl(url, locale) {
  if (locale === "en") url.searchParams.set("lang", "en");
  else url.searchParams.delete("lang");
  return url;
}
