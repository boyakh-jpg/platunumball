import { Link, useLocation } from "react-router-dom";
import Button from "../common/Button.jsx";
import { getActiveMyNavigationPath, MY_NAVIGATION_ITEMS } from "../../lib/appNavigation.js";
import { getReceiptLocale, RECEIPT_SHELL_COPY } from "../../lib/receiptLocale.js";

export default function MyNavigation() {
  const location = useLocation();
  const activePath = getActiveMyNavigationPath(location.pathname);
  const shellCopy = RECEIPT_SHELL_COPY[getReceiptLocale(location)];
  if (!activePath) return null;

  return (
    <nav className="ui-action-row ui-action-row-equal my-navigation" aria-label={shellCopy.myNavigation}>
      {MY_NAVIGATION_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = activePath === item.to;
        return (
          <Button key={item.to} as={Link} to={item.to} variant={active ? "primary" : "secondary"} aria-current={active ? "page" : undefined}>
            <Icon size={18} aria-hidden="true" />{shellCopy[item.labelKey]}
          </Button>
        );
      })}
    </nav>
  );
}
