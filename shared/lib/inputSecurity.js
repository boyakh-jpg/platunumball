export const UNSAFE_INPUT_ERROR_CODE = "unsafe_input_content";
export const UNSAFE_INPUT_MESSAGE = "HTML·스크립트 코드는 입력할 수 없습니다.";
export const MAX_INPUT_STRING_LENGTH = 300_000;
export const MAX_INPUT_PAYLOAD_DEPTH = 24;
export const MAX_INPUT_PAYLOAD_NODES = 12_000;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const BIDI_CONTROL_PATTERN = /[\u202A-\u202E\u2066-\u2069\uFEFF]/u;
const HTML_TAG_PATTERN = /<\s*\/?\s*[a-z][^>]*>/iu;
const HTML_COMMENT_PATTERN = /<!--|-->/u;
const ENCODED_HTML_TAG_PATTERN = /(?:&lt;|&#0*60;|&#x0*3c;)\s*\/?\s*[a-z][^&]*(?:&gt;|&#0*62;|&#x0*3e;)/iu;
const SCRIPT_PROTOCOL_PATTERN = /(?:javascript|vbscript)\s*:/iu;
const DATA_DOCUMENT_PATTERN = /data\s*:\s*(?:text\/(?:html|javascript)|application\/(?:xhtml\+xml|javascript))/iu;
const EVENT_HANDLER_PATTERN = /\bon[a-z]{3,}\s*=/iu;
const SRCDOC_PATTERN = /\bsrcdoc\s*=/iu;
const CSS_EXECUTION_PATTERN = /\bexpression\s*\(|\burl\s*\(\s*['"]?\s*(?:javascript|vbscript|data\s*:\s*text\/html)/iu;
const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function getUnsafeUserTextReason(value, options = {}) {
  const text = String(value ?? "");
  const maxLength = Number.isFinite(Number(options.maxLength))
    ? Math.max(0, Number(options.maxLength))
    : MAX_INPUT_STRING_LENGTH;
  if (text.length > maxLength) return "input_too_long";
  if (CONTROL_CHARACTER_PATTERN.test(text) || BIDI_CONTROL_PATTERN.test(text)) return "unsafe_control_character";
  if (
    HTML_TAG_PATTERN.test(text)
    || HTML_COMMENT_PATTERN.test(text)
    || ENCODED_HTML_TAG_PATTERN.test(text)
    || SCRIPT_PROTOCOL_PATTERN.test(text)
    || DATA_DOCUMENT_PATTERN.test(text)
    || EVENT_HANDLER_PATTERN.test(text)
    || SRCDOC_PATTERN.test(text)
    || CSS_EXECUTION_PATTERN.test(text)
  ) return "unsafe_executable_markup";
  return "";
}

export function createUnsafeInputError(reason = "unsafe_executable_markup", path = "$input") {
  const error = new Error(UNSAFE_INPUT_ERROR_CODE);
  error.code = UNSAFE_INPUT_ERROR_CODE;
  error.statusCode = reason === "input_too_long" ? 413 : 400;
  error.details = {
    reason,
    path,
    message: reason === "input_too_long" ? "입력값이 너무 깁니다." : UNSAFE_INPUT_MESSAGE,
  };
  return error;
}

export function assertSafeUserText(value, options = {}) {
  const reason = getUnsafeUserTextReason(value, options);
  if (reason) throw createUnsafeInputError(reason, options.path ?? "$input");
  return String(value ?? "");
}

export function assertSafeInputPayload(value, options = {}) {
  const maxDepth = Number(options.maxDepth ?? MAX_INPUT_PAYLOAD_DEPTH);
  const maxNodes = Number(options.maxNodes ?? MAX_INPUT_PAYLOAD_NODES);
  const maxStringLength = Number(options.maxStringLength ?? MAX_INPUT_STRING_LENGTH);
  const rootPath = options.path ?? "$input";
  const seen = new WeakSet();
  let nodeCount = 0;

  const visit = (current, path, depth) => {
    if (typeof current === "string") {
      assertSafeUserText(current, { maxLength: maxStringLength, path });
      return;
    }
    if (current == null || typeof current !== "object") return;
    if (ArrayBuffer.isView(current) || current instanceof ArrayBuffer) return;
    if (seen.has(current)) return;
    seen.add(current);
    nodeCount += 1;
    if (depth > maxDepth || nodeCount > maxNodes) {
      throw createUnsafeInputError("unsafe_input_shape", path);
    }

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }

    Object.entries(current).forEach(([key, item]) => {
      if (PROTOTYPE_KEYS.has(key)) throw createUnsafeInputError("unsafe_object_key", `${path}.${key}`);
      assertSafeUserText(key, { maxLength: 120, path: `${path}.[key]` });
      visit(item, `${path}.${key}`, depth + 1);
    });
  };

  visit(value, rootPath, 0);
  return value;
}

export function getSafeHttpUrl(value, options = {}) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (options.allowRelative === true && /^\/(?!\/)/.test(text)) return text;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function getSafeImageUrl(value) {
  return getSafeHttpUrl(value, { allowRelative: true });
}
