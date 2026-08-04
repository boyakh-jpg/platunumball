export const COURT_REQUEST_PHOTO_MIN = 1;
export const COURT_REQUEST_PHOTO_MAX = 4;
export const COURT_REQUEST_PHOTO_TARGET_BYTES = 220 * 1024;
export const COURT_REQUEST_PHOTO_MAX_BYTES = 300 * 1024;
export const COURT_REQUEST_PHOTO_MAX_DIMENSION = 1280;
export const COURT_REQUEST_FIELD_ACCURACY_MAX_METERS = 20;
export const COURT_REQUEST_FIELD_DISTANCE_MAX_METERS = 30;
export const COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS = 10 * 60 * 1000;

export function getCoordinateDistanceMeters(latA, lngA, latB, lngB) {
  const input = [latA, lngA, latB, lngB];
  if (input.some((value) => value === null || value === undefined || value === "")) return null;
  const values = input.map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [safeLatA, safeLngA, safeLatB, safeLngB] = values;
  const radians = (value) => value * Math.PI / 180;
  const latDelta = radians(safeLatB - safeLatA);
  const lngDelta = radians(safeLngB - safeLngA);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(safeLatA)) * Math.cos(radians(safeLatB)) * Math.sin(lngDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
