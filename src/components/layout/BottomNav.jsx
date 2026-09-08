import { useLocation } from "react-router-dom";
import { getReceiptLocale, RECEIPT_SHELL_COPY } from "../../lib/receiptLocale.js";
import PrimaryNavigationLinks from "./PrimaryNavigationLinks.jsx";

export default function BottomNav() {
  const location = useLocation();
  const shellCopy = RECEIPT_SHELL_COPY[getReceiptLocale(location)];

  return (
    <nav className="bottom-nav" aria-label={shellCopy.bottomNavigation}>
      <PrimaryNavigationLinks />
    </nav>
  );
}
