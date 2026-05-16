import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { SECURITY_HEADERS } from "@/lib/config";
import { errorResponse } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { contentDisposition, getDownload, openDownloadStream } from "@/lib/storage";

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
  const download = await getDownload(id);
  if (!download) {
    return errorResponse("Drop not found or expired.", 404);
  }

  const stream = Readable.toWeb(openDownloadStream(download.file)) as unknown as BodyInit;

  return new Response(stream, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(download.size),
      "Content-Disposition": contentDisposition(download.record.name)
    }
  });
}
