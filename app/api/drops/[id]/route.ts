import { NextRequest } from "next/server";
import { publishDropChange } from "@/lib/events";
import { errorResponse, jsonResponse, requireAdmin } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { deleteDrop, StorageError } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const limited = checkRateLimit(request, "admin");
  if (limited) {
    return limited;
  }

  const adminError = requireAdmin(request);
  if (adminError) {
    return adminError;
  }

  try {
    const { id } = await context.params;
    const removed = await deleteDrop(id);
    if (!removed) {
      return errorResponse("Drop not found.", 404);
    }
    publishDropChange("delete");
    return jsonResponse({ ok: true, serverTime: Date.now() });
  } catch (error) {
    if (error instanceof StorageError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Server request failed.", 500);
  }
}
