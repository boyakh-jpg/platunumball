import {
  BOXTIER_LETTER_DARK_URL,
  BOXTIER_LETTER_LIGHT_URL,
  BOXTIER_LOGO_URL,
  showBrandLetterFallback,
} from "../../lib/assets.js";
import { BRAND_NAME } from "../../lib/brand.js";

export default function BrandLockup() {
  return (
    <>
      <span className="brand-logo-frame" aria-hidden="true">
        <img className="brand-logo-img" src={BOXTIER_LOGO_URL} alt="" />
      </span>
      <span className="brand-letter-wrap" aria-hidden="true">
        <img
          className="brand-letter-img brand-letter-dark"
          src={BOXTIER_LETTER_DARK_URL}
          alt=""
          onError={showBrandLetterFallback}
        />
        <span className="brand-letter-fallback brand-letter-fallback-dark" hidden>{BRAND_NAME}</span>
        <img
          className="brand-letter-img brand-letter-light"
          src={BOXTIER_LETTER_LIGHT_URL}
          alt=""
          onError={showBrandLetterFallback}
        />
        <span className="brand-letter-fallback brand-letter-fallback-light" hidden>{BRAND_NAME}</span>
      </span>
    </>
  );
}
