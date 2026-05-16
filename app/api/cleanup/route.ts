import { NextRequest } from "next/server";
import { publishDropChange } from "@/lib/events";
import { errorResponse, jsonResponse, requireAdmin } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { cleanupExpired, StorageError } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, "admin");
  if (limited) {
    return limited;
  }

  const adminError = requireAdmin(request);
  if (adminError) {
    return adminError;
  }

  try {
    const removed = await cleanupExpired();
    if (removed) {
      publishDropChange("cleanup");
    }
    return jsonResponse({ removed, serverTime: Date.now() });
  } catch (error) {
    if (error instanceof StorageError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Server request failed.", 500);
  }
}
