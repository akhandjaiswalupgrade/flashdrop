import { NextRequest } from "next/server";
import { errorResponse, jsonResponse } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTextDrop } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const limited = checkRateLimit(request, "download");
  if (limited) {
    return limited;
  }

  const { id } = await context.params;
  const result = await getTextDrop(id);
  if (!result) {
    return errorResponse("Text drop not found or expired.", 404);
  }

  return jsonResponse({
    id: result.record.id,
    name: result.record.name,
    size: result.record.size,
    text: result.text,
    serverTime: Date.now()
  });
}
