import { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createEventStream } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = checkRateLimit(request, "api");
  if (limited) {
    return limited;
  }

  return new Response(createEventStream(request.signal), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
