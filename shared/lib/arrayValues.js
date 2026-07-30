export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function compactArray(value) {
  return asArray(value).filter(Boolean);
}

export function mergeRemoteById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (item?.id) merged.set(item.id, item);
  });
  return [...merged.values()];
}
