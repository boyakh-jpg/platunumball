import { CalendarDays, ClipboardList, Handshake, House, LogIn, MessageSquareText, Settings, UserRound, UsersRound } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { getLoginPath } from "../../lib/profileSetup.js";

const items = [
  { to: "/app", label: "홈", icon: House },
  { to: "/app/matches", label: "일정", icon: CalendarDays },
  { to: "/app/recruiting", label: "매칭", icon: Handshake },
  { to: "/app/recorder", label: "플레이", icon: ClipboardList },
  { to: "/app/teams", label: "팀", icon: UsersRound },
  { to: "/app/community", label: "게시판", icon: MessageSquareText },
  { to: "/app/profile", label: "나", icon: UserRound },
  { to: "/app/settings", label: "설정", icon: Settings },
];

export default function BottomNav({ guestPreview = false }) {
  const location = useLocation();
  const loginPath = getLoginPath(`${location.pathname}${location.search}${location.hash}`);
  return (
    <nav className="bottom-nav" aria-label="하단 메뉴">
      {items.map((item) => {
        const isGuestProfile = guestPreview && item.to === "/app/profile";
        const Icon = isGuestProfile ? LogIn : item.icon;
        return (
          <NavLink key={item.to} to={isGuestProfile ? loginPath : item.to} end={item.to === "/app"}>
            <Icon size={20} />
            <span>{isGuestProfile ? "로그인" : item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
