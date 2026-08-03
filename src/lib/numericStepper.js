export function clampNumericStepperValue(value, min, max, integer = true) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  const normalized = integer ? Math.floor(number) : number;
  return Math.max(min, Math.min(max, normalized));
}

export function isDirectNumericEntryPointer(clientX, inputRight, spinnerWidth = 24) {
  return Number.isFinite(clientX) && Number.isFinite(inputRight) && clientX < inputRight - spinnerWidth;
}

export function getNumericInputBlurValue(value, fallbackValue) {
  return value === "" ? fallbackValue : value;
}
