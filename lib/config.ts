import path from "node:path";

export const MAX_FILE_BYTES = 1000 * 1024 * 1024;
export const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024;
export const DROP_TTL_MS = 60 * 60 * 1000;
export const MAX_TOTAL_BYTES = Number(process.env.FLASHDROP_TOTAL_LIMIT_MB || 1024) * 1024 * 1024;
export const MAX_ACTIVE_DROPS = Number(process.env.FLASHDROP_MAX_ACTIVE_DROPS || 200);
export const ADMIN_TOKEN = process.env.FLASHDROP_ADMIN_TOKEN || "";

export const DATA_DIR = path.join(process.cwd(), ".flashdrop-data-next");
export const FILES_DIR = path.join(DATA_DIR, "files");
export const META_FILE = path.join(DATA_DIR, "drops.json");

export const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
