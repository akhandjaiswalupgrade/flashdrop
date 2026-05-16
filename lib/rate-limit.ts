import { NextRequest } from "next/server";
import { errorResponse, getClientKey } from "./http";

type Bucket = {
  count: number;
  resetAt: number;
};

type Limit = {
  max: number;
  windowMs: number;
};

const buckets = new Map<string, Bucket>();

const limits: Record<string, Limit> = {
  api: { max: 240, windowMs: 60_000 },
  upload: { max: 20, windowMs: 60 * 60_000 },
  download: { max: 360, windowMs: 60_000 },
  admin: { max: 30, windowMs: 60_000 }
};

export function checkRateLimit(request: NextRequest, scope: keyof typeof limits) {
  const limit = limits[scope];
  const key = `${scope}:${getClientKey(request)}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    sweepBuckets(now);
    return null;
  }

  bucket.count += 1;

  if (bucket.count > limit.max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    const response = errorResponse("Too many requests. Try again later.", 429);
    response.headers.set("Retry-After", String(retryAfter));
    return response;
  }

  return null;
}

function sweepBuckets(now: number) {
  if (buckets.size < 2000) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}
