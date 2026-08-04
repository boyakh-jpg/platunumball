export const COURT_REQUEST_PHOTO_MIN = 1;
export const COURT_REQUEST_PHOTO_MAX = 4;
export const COURT_REQUEST_PHOTO_TARGET_BYTES = 220 * 1024;
export const COURT_REQUEST_PHOTO_MAX_BYTES = 300 * 1024;
export const COURT_REQUEST_PHOTO_MAX_DIMENSION = 1280;
export const COURT_REQUEST_PHOTO_MIN_BYTES = 12 * 1024;
export const COURT_REQUEST_PHOTO_MIN_DIMENSION = 360;
export const COURT_REQUEST_PHOTO_MIN_PIXELS = 300_000;
export const COURT_REQUEST_PHOTO_MIN_SOURCE_DIMENSION = 640;
export const COURT_REQUEST_FIELD_ACCURACY_MAX_METERS = 20;
export const COURT_REQUEST_FIELD_DISTANCE_MAX_METERS = 150;
export const COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS = 10 * 60 * 1000;
export const COURT_REQUEST_PHOTO_LOCATION_MATCH_MAX_METERS = 50;
export const COURT_REQUEST_PHOTO_LOCATION_MISMATCH_MIN_METERS = 150;

export function getCourtPhotoPixelQualityError(pixels, width, height) {
  const safeWidth = Math.trunc(Number(width));
  const safeHeight = Math.trunc(Number(height));
  const pixelCount = safeWidth * safeHeight;
  if (!pixels || safeWidth < 2 || safeHeight < 2 || pixels.length < pixelCount * 4) return "court_photo_quality_unavailable";

  const luminance = new Float32Array(pixelCount);
  let sum = 0;
  let squareSum = 0;
  let darkPixels = 0;
  let brightPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const value = (77 * pixels[offset] + 150 * pixels[offset + 1] + 29 * pixels[offset + 2]) / 256;
    luminance[index] = value;
    sum += value;
    squareSum += value * value;
    if (value < 20) darkPixels += 1;
    if (value > 245) brightPixels += 1;
  }

  const mean = sum / pixelCount;
  if (mean < 28 || darkPixels / pixelCount > 0.8) return "court_photo_too_dark";
  if (mean > 232 || brightPixels / pixelCount > 0.8) return "court_photo_too_bright";

  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const index = y * safeWidth + x;
      if (x) {
        edgeSum += Math.abs(luminance[index] - luminance[index - 1]);
        edgeCount += 1;
      }
      if (y) {
        edgeSum += Math.abs(luminance[index] - luminance[index - safeWidth]);
        edgeCount += 1;
      }
    }
  }
  const deviation = Math.sqrt(Math.max(0, squareSum / pixelCount - mean * mean));
  if (deviation < 12 || edgeSum / edgeCount < 3) return "court_photo_too_blurry";
  return null;
}

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

export function getCourtPhotoLocationEvidence(photoMetadata = [], locations = {}) {
  const photos = (Array.isArray(photoMetadata) ? photoMetadata : []).map((metadata, index) => {
    const rawLatitude = metadata?.latitude;
    const rawLongitude = metadata?.longitude;
    const latitude = Number(rawLatitude);
    const longitude = Number(rawLongitude);
    const hasCoordinates = rawLatitude !== null
      && rawLatitude !== undefined
      && rawLatitude !== ""
      && rawLongitude !== null
      && rawLongitude !== undefined
      && rawLongitude !== ""
      && Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && Math.abs(latitude) <= 90
      && Math.abs(longitude) <= 180;
    const capturedMs = Date.parse(String(metadata?.capturedAt || ""));
    return {
      index,
      latitude: hasCoordinates ? latitude : null,
      longitude: hasCoordinates ? longitude : null,
      capturedAt: Number.isFinite(capturedMs) ? new Date(capturedMs).toISOString() : null,
      fieldDistanceMeters: hasCoordinates
        ? getCoordinateDistanceMeters(latitude, longitude, locations.fieldLat, locations.fieldLng)
        : null,
      pinDistanceMeters: hasCoordinates
        ? getCoordinateDistanceMeters(latitude, longitude, locations.pinLat, locations.pinLng)
        : null,
    };
  });
  const locatedPhotos = photos.filter((photo) => photo.latitude !== null && photo.longitude !== null);
  const distances = locatedPhotos
    .flatMap((photo) => [photo.fieldDistanceMeters, photo.pinDistanceMeters])
    .filter(Number.isFinite);
  const maxDistanceMeters = distances.length ? Math.max(...distances) : null;
  const coverage = photos.length ? locatedPhotos.length / photos.length : 0;
  let status = "unavailable";
  let confidence = 0.75;
  if (Number.isFinite(maxDistanceMeters)) {
    if (maxDistanceMeters <= COURT_REQUEST_PHOTO_LOCATION_MATCH_MAX_METERS && coverage === 1) {
      status = "matched";
      confidence = 1;
    } else if (maxDistanceMeters <= COURT_REQUEST_PHOTO_LOCATION_MATCH_MAX_METERS) {
      status = "partial";
      confidence = 0.85;
    } else if (maxDistanceMeters <= COURT_REQUEST_PHOTO_LOCATION_MISMATCH_MIN_METERS) {
      status = "uncertain";
      confidence = 0.6;
    } else {
      status = "mismatch";
      confidence = 0.25;
    }
  }
  return {
    status,
    confidence,
    photoCount: photos.length,
    gpsPhotoCount: locatedPhotos.length,
    maxDistanceMeters,
    photos,
  };
}
