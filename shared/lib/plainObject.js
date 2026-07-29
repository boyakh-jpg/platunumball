export function sortPlainObject(value) {
  if (Array.isArray(value)) return value.map(sortPlainObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortPlainObject(value[key])]));
}
