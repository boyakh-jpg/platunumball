import { BarChart3, CalendarDays, Handshake, House, Settings, Trophy, UserRound, UsersRound } from "lucide-react";
import { NavLink } from "react-router-dom";

const items = [
  { to: "/app", label: "홈", icon: House },
  { to: "/app/matches", label: "경기", icon: CalendarDays },
  { to: "/app/season", label: "시즌", icon: Trophy },
  { to: "/app/recruiting", label: "용병", icon: Handshake },
  { to: "/app/rankings", label: "랭킹", icon: BarChart3 },
  { to: "/app/teams", label: "팀", icon: UsersRound },
  { to: "/app/profile", label: "나", icon: UserRound },
  { to: "/app/settings", label: "설정", icon: Settings },
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
