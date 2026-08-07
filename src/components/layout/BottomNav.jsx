import { CalendarDays, ClipboardList, Ellipsis, Handshake, House, MessageSquareText, Settings, UserRound, UsersRound } from "lucide-react";
import { NavLink } from "react-router-dom";

const items = [
  { to: "/app", label: "홈", icon: House },
  { to: "/app/matches", label: "일정", icon: CalendarDays },
  { to: "/app/recruiting", label: "매칭", icon: Handshake },
  { to: "/app/recorder", label: "플레이", icon: ClipboardList },
  { to: "/app/community", label: "게시판", icon: MessageSquareText },
];

const moreItems = [
  { to: "/app/profile", label: "나", icon: UserRound },
  { to: "/app/teams", label: "팀", icon: UsersRound },
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
      <details className="bottom-nav-more">
        <summary>
          <Ellipsis size={20} />
          <span>더보기</span>
        </summary>
        <div className="bottom-nav-more-menu" aria-label="더보기 메뉴">
          {moreItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </details>
    </nav>
  );
}
