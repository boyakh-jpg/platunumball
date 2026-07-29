export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function compactArray(value) {
  return asArray(value).filter(Boolean);
}
