export function clampNumericStepperValue(value, min, max, integer = true) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  const normalized = integer ? Math.floor(number) : number;
  return Math.max(min, Math.min(max, normalized));
}
