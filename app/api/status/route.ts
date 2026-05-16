import { NextRequest } from "next/server";
import { ADMIN_TOKEN, DROP_TTL_MS, MAX_ACTIVE_DROPS, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "@/lib/config";
import { jsonResponse } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = checkRateLimit(request, "api");
  if (limited) {
    return limited;
  }

  return jsonResponse({
    ok: true,
    serverTime: Date.now(),
    maxFileBytes: MAX_FILE_BYTES,
    ttlMs: DROP_TTL_MS,
    maxActiveDrops: MAX_ACTIVE_DROPS,
    maxTotalBytes: MAX_TOTAL_BYTES,
    adminEnabled: Boolean(ADMIN_TOKEN)
  });
}
