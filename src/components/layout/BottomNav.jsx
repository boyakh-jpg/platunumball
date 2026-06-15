import { CalendarDays, ClipboardList, Handshake, House, UserRound, UsersRound } from "lucide-react";
import { NavLink } from "react-router-dom";

const items = [
  { to: "/app", label: "홈", icon: House },
  { to: "/app/matches", label: "경기", icon: CalendarDays },
  { to: "/app/recorder", label: "기록", icon: ClipboardList },
  { to: "/app/recruiting", label: "매칭", icon: Handshake },
  { to: "/app/teams", label: "팀", icon: UsersRound },
  { to: "/app/profile", label: "나", icon: UserRound },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="하단 메뉴">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink key={item.to} to={item.to} end={item.to === "/app"}>
            <Icon size={20} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
