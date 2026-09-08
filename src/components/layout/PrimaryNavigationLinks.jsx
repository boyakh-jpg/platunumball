import { Link, useLocation } from "react-router-dom";
import { APP_NAVIGATION_ITEMS, getActiveAppNavigationPath } from "../../lib/appNavigation.js";
import { getReceiptLocale, RECEIPT_SHELL_COPY } from "../../lib/receiptLocale.js";

export default function PrimaryNavigationLinks({ className = "", iconSize = 20 }) {
  const location = useLocation();
  const shellCopy = RECEIPT_SHELL_COPY[getReceiptLocale(location)];
  const activePath = getActiveAppNavigationPath(location.pathname);
  return APP_NAVIGATION_ITEMS.map((item) => {
    const Icon = item.icon;
    const active = item.to === activePath;
    return (
      <Link key={item.to} to={item.to} className={`${className}${active ? " active" : ""}`.trim()} aria-current={active ? "page" : undefined}>
        <Icon size={iconSize} aria-hidden="true" />
        <span>{shellCopy[item.labelKey]}</span>
      </Link>
    );
  });
}
