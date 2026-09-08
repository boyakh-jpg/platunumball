import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import Button from "../common/Button.jsx";
import { getProfileNavigationItems } from "../../lib/appNavigation.js";
import { getReceiptLocale, RECEIPT_SHELL_COPY } from "../../lib/receiptLocale.js";

export default function ProfileNavigation({ app, guestPreview = false }) {
  const location = useLocation();
  const shellCopy = RECEIPT_SHELL_COPY[getReceiptLocale(location)];
  const loadAdminContext = app.actions.loadAdminContext;
  useEffect(() => {
    if (!guestPreview) loadAdminContext?.();
  }, [guestPreview, loadAdminContext]);
  const items = getProfileNavigationItems({ adminLevel: app.adminContext?.level, guestPreview });
  return (
    <nav className="ui-action-row profile-navigation" aria-label={shellCopy.profileNavigation}>
      {items.map((item) => {
        const Icon = item.icon;
        return <Button key={item.to} as={Link} to={item.to} variant="secondary"><Icon size={18} aria-hidden="true" />{shellCopy[item.labelKey]}</Button>;
      })}
    </nav>
  );
}
