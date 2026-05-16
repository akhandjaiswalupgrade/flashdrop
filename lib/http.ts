import { NextRequest, NextResponse } from "next/server";
import { ADMIN_TOKEN, SECURITY_HEADERS } from "./config";

export function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      ...SECURITY_HEADERS,
      ...(init.headers || {})
    }
  });
}

export function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message, serverTime: Date.now() }, { status });
}

export function getClientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const cfIp = request.headers.get("cf-connecting-ip");
  const raw = cfIp || realIp || forwarded?.split(",")[0] || "direct";
  return raw.trim().slice(0, 80) || "direct";
}

export function requireAdmin(request: NextRequest) {
  if (!ADMIN_TOKEN) {
    return errorResponse("Admin actions are disabled until FLASHDROP_ADMIN_TOKEN is set.", 403);
  }

  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : request.headers.get("x-admin-token") || "";

  if (!constantTimeEqual(token, ADMIN_TOKEN)) {
    return errorResponse("Invalid admin token.", 401);
  }

  return null;
}

function constantTimeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}
