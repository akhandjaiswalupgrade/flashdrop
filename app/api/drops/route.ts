import { NextRequest } from "next/server";
import { MAX_REQUEST_BYTES } from "@/lib/config";
import { publishDropChange } from "@/lib/events";
import { errorResponse, getClientKey, jsonResponse, requireAdmin } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createDrop, deleteAllDrops, listDrops, StorageError } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = checkRateLimit(request, "api");
  if (limited) {
    return limited;
  }

  try {
    return jsonResponse({ drops: await listDrops(), serverTime: Date.now() });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, "upload");
  if (limited) {
    return limited;
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("Upload request is over the 100 MB limit.", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Upload must be multipart form data.", 400);
  }

  const payload = form.get("payload");
  if (!(payload instanceof File)) {
    return errorResponse("No file payload found.", 400);
  }

  const nameField = form.get("name");
  const kindField = form.get("kind");
  const name = typeof nameField === "string" ? nameField : payload.name || "flash-drop.bin";
  const kind = kindField === "text" ? "text" : "file";

  try {
    const drop = await createDrop({
      name,
      type: payload.type || "application/octet-stream",
      size: payload.size,
      kind,
      stream: payload.stream(),
      uploaderKey: getClientKey(request)
    });

    publishDropChange("upload");
    return jsonResponse({ drop, serverTime: Date.now() }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const limited = checkRateLimit(request, "admin");
  if (limited) {
    return limited;
  }

  const adminError = requireAdmin(request);
  if (adminError) {
    return adminError;
  }

  try {
    const removed = await deleteAllDrops();
    if (removed) {
      publishDropChange("clear-all");
    }
    return jsonResponse({ removed, serverTime: Date.now() });
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown) {
  if (error instanceof StorageError) {
    return errorResponse(error.message, error.status);
  }
  return errorResponse("Server request failed.", 500);
}
