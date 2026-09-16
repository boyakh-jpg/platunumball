export const SHARE_FEEDBACK = Object.freeze({
  shared: "공유했습니다.",
  copied: "링크를 복사했어요. 원하는 곳에 붙여넣어 주세요.",
  cancelled: "",
  failed: "공유창을 열지 못했어요. 복사 버튼으로 직접 전달해 주세요.",
  copyFailed: "링크를 복사하지 못했어요. 위 주소를 직접 선택해 복사해 주세요.",
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

export async function shareLink(payload, { navigator: browser = globalThis.navigator } = {}) {
  if (!payload?.url || typeof browser?.share !== "function") return "failed";
  try {
    await browser.share(payload);
    return "shared";
  } catch (error) {
    return error?.name === "AbortError" ? "cancelled" : "failed";
  }
}
