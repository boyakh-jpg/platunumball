export function createFixedWindowRateLimiter({
  windowMs,
  max,
  errorCode,
  statusCode = 429,
  now = () => Date.now(),
} = {}) {
  const buckets = new Map();

  return function assertWithinRateLimit(key) {
    const currentTime = now();
    const bucket = buckets.get(key) ?? { startedAt: currentTime, count: 0 };
    const nextBucket = currentTime - bucket.startedAt > windowMs
      ? { startedAt: currentTime, count: 1 }
      : { ...bucket, count: bucket.count + 1 };
    buckets.set(key, nextBucket);
    if (nextBucket.count <= max) return;
    const error = new Error(errorCode);
    error.statusCode = statusCode;
    throw error;
  };
}
