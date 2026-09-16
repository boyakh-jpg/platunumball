export const SHARE_FEEDBACK = Object.freeze({
  shared: "공유했습니다.",
  copied: "링크를 복사했어요. 원하는 곳에 붙여넣어 주세요.",
  cancelled: "",
  failed: "링크를 복사하지 못했어요. 아래 주소를 직접 복사해 주세요.",
});

export function getAppShareUrl(path, base = import.meta.env?.VITE_PUBLIC_APP_URL || globalThis.location?.origin || "") {
  return base ? new URL(path, base).href : path;
}

export async function copyTextToClipboard(text, { navigator: browser = globalThis.navigator, document: page = globalThis.document } = {}) {
  if (!text) return false;
  try {
    if (browser?.clipboard?.writeText) {
      await browser.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Browsers may deny clipboard permission but still allow selection copy.
  }
  if (!page?.body) return false;
  const previousFocus = page.activeElement;
  const buffer = page.createElement("textarea");
  buffer.value = text;
  buffer.className = "ui-clipboard-buffer";
  buffer.setAttribute("readonly", "");
  try {
    page.body.appendChild(buffer);
    buffer.focus({ preventScroll: true });
    buffer.select();
    return page.execCommand?.("copy") === true;
  } catch {
    return false;
  } finally {
    buffer.remove();
    previousFocus?.focus?.({ preventScroll: true });
  }
}

export function getPromotionShareText({ title, eyebrow, fields = [], actionLabel, note }) {
  return [
    [eyebrow, title].filter(Boolean).join(" · "),
    ...fields.filter(({ value }) => value !== null && value !== undefined && String(value).trim()).map(({ label, value }) => `${label}: ${value}`),
    note,
    actionLabel,
  ].filter(Boolean).join("\n");
}

export function canShareImageFile(browser, file) {
  if (!file || typeof browser?.share !== "function") return false;
  try {
    return browser.canShare?.({ files: [file] }) === true;
  } catch {
    return false;
  }
}

export async function shareImageFile(file, { title, navigator: browser = globalThis.navigator } = {}) {
  if (!canShareImageFile(browser, file)) return "failed";
  try {
    await browser.share({ title, files: [file] });
    return "shared";
  } catch (error) {
    return error?.name === "AbortError" ? "cancelled" : "failed";
  }
}

export async function shareLink(payload, { navigator: browser = globalThis.navigator, copy = copyTextToClipboard, fallbackText = payload?.url } = {}) {
  if (!payload?.url) return "failed";
  if (browser?.share) {
    try {
      await browser.share(payload);
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }
  try {
    return await copy(fallbackText) ? "copied" : "failed";
  } catch {
    return "failed";
  }
}
