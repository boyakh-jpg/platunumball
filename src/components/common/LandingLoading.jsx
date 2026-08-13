import BrandLockup from "./BrandLockup.jsx";
import { BRAND_NAME } from "../../lib/brand.js";

export default function LandingLoading() {
  return (
    <main className="landing-auth-loading" aria-live="polite">
      <div className="brand landing-brand-lockup" aria-label={BRAND_NAME}>
        <BrandLockup />
      </div>
      <p>기록 불러오는 중...</p>
    </main>
  );
}
