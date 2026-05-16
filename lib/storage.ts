import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DATA_DIR,
  DROP_TTL_MS,
  FILES_DIR,
  MAX_ACTIVE_DROPS,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  META_FILE
} from "./config";

export type DropKind = "file" | "text";

export type DropRecord = {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: DropKind;
  createdAt: number;
  expiresAt: number;
  uploaderKey: string;
};

export type PublicDrop = Omit<DropRecord, "uploaderKey"> & {
  downloadUrl: string;
};

export class StorageError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const ID_PATTERN = /^[A-Za-z0-9_-]{24,80}$/;
let lock = Promise.resolve();

export function normalizeDropId(id: string) {
  const value = id.trim();
  return ID_PATTERN.test(value) ? value : null;
}

export function toPublicDrop(record: DropRecord): PublicDrop {
  const { uploaderKey: _uploaderKey, ...rest } = record;
  return {
    ...rest,
    downloadUrl: `/api/drops/${encodeURIComponent(record.id)}/download`
  };
}

export async function listDrops() {
  return withStorageLock(async () => {
    await cleanupExpiredUnlocked();
    const records = await readRecordsUnlocked();
    return records.sort((a, b) => a.expiresAt - b.expiresAt).map(toPublicDrop);
  });
}

export async function createDrop(input: {
  name: string;
  type: string;
  size: number;
  kind: DropKind;
  stream: ReadableStream<Uint8Array>;
  uploaderKey: string;
}) {
  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw new StorageError("Upload is empty.", 400);
  }
  if (input.size > MAX_FILE_BYTES) {
    throw new StorageError("File is over the 100 MB limit.", 413);
  }

  const id = randomBytes(24).toString("base64url");
  const createdAt = Date.now();
  const record: DropRecord = {
    id,
    name: safeName(input.name),
    type: safeType(input.type),
    size: input.size,
    kind: input.kind,
    createdAt,
    expiresAt: createdAt + DROP_TTL_MS,
    uploaderKey: input.uploaderKey
  };

  return withStorageLock(async () => {
    await cleanupExpiredUnlocked();
    const records = await readRecordsUnlocked();
    const totalBytes = records.reduce((sum, item) => sum + item.size, 0);

    if (records.length >= MAX_ACTIVE_DROPS) {
      throw new StorageError("Server has too many active drops. Try again after old drops expire.", 507);
    }
    if (totalBytes + input.size > MAX_TOTAL_BYTES) {
      throw new StorageError("Server storage limit reached. Try again after old drops expire.", 507);
    }

    await ensureStorage();
    const destination = dropPath(id);
    try {
      const source = Readable.fromWeb(input.stream as unknown as Parameters<typeof Readable.fromWeb>[0]);
      await pipeline(source, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
      const stored = await stat(destination);
      if (stored.size !== input.size || stored.size > MAX_FILE_BYTES) {
        await unlink(destination).catch(() => undefined);
        throw new StorageError("Upload size did not match the declared file size.", 400);
      }
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError("Could not store upload.", 500);
    }

    records.push(record);
    await writeRecordsUnlocked(records);
    return toPublicDrop(record);
  });
}

export async function getDownload(dropId: string) {
  const id = normalizeDropId(dropId);
  if (!id) {
    return null;
  }

  return withStorageLock(async () => {
    await cleanupExpiredUnlocked();
    const records = await readRecordsUnlocked();
    const record = records.find((item) => item.id === id);
    if (!record) {
      return null;
    }

    const file = dropPath(id);
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) {
      return null;
    }

    return {
      file,
      size: info.size,
      record
    };
  });
}

export async function getTextDrop(dropId: string) {
  const id = normalizeDropId(dropId);
  if (!id) {
    return null;
  }

  return withStorageLock(async () => {
    await cleanupExpiredUnlocked();
    const records = await readRecordsUnlocked();
    const record = records.find((item) => item.id === id && item.kind === "text");
    if (!record) {
      return null;
    }

    const file = dropPath(id);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      return null;
    }

    return {
      record,
      text: await readFile(file, "utf8")
    };
  });
}

export async function deleteDrop(dropId: string) {
  const id = normalizeDropId(dropId);
  if (!id) {
    return false;
  }

  return withStorageLock(async () => {
    const records = await readRecordsUnlocked();
    const active = records.filter((item) => item.id !== id);
    const removed = active.length !== records.length;
    if (removed) {
      await unlink(dropPath(id)).catch(() => undefined);
      await writeRecordsUnlocked(active);
    }
    return removed;
  });
}

export async function deleteAllDrops() {
  return withStorageLock(async () => {
    const records = await readRecordsUnlocked();
    await Promise.all(records.map((item) => unlink(dropPath(item.id)).catch(() => undefined)));
    await writeRecordsUnlocked([]);
    return records.length;
  });
}

export async function cleanupExpired() {
  return withStorageLock(cleanupExpiredUnlocked);
}

export function openDownloadStream(file: string) {
  return createReadStream(file);
}

export function contentDisposition(filename: string) {
  const safe = safeName(filename).replaceAll("\\", "-").replaceAll('"', "'");
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function withStorageLock<T>(fn: () => Promise<T>) {
  const previous = lock;
  let release!: () => void;
  lock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function ensureStorage() {
  await mkdir(FILES_DIR, { recursive: true, mode: 0o700 });
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    await stat(META_FILE);
  } catch {
    await writeFile(META_FILE, "[]", { encoding: "utf8", mode: 0o600 });
  }
}

async function readRecordsUnlocked(): Promise<DropRecord[]> {
  await ensureStorage();
  try {
    const raw = await readFile(META_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isRecord);
  } catch {
    return [];
  }
}

async function writeRecordsUnlocked(records: DropRecord[]) {
  await ensureStorage();
  const temp = `${META_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(records, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, META_FILE);
}

async function cleanupExpiredUnlocked() {
  const records = await readRecordsUnlocked();
  const now = Date.now();
  const active: DropRecord[] = [];
  const activeIds = new Set<string>();
  let removed = 0;

  for (const record of records) {
    const file = dropPath(record.id);
    const info = await stat(file).catch(() => null);

    if (record.expiresAt <= now || !info?.isFile()) {
      removed += 1;
      await unlink(file).catch(() => undefined);
    } else {
      active.push(record);
      activeIds.add(record.id);
    }
  }

  await removeOrphanFilesUnlocked(activeIds);

  if (removed) {
    await writeRecordsUnlocked(active);
  }
  return removed;
}

async function removeOrphanFilesUnlocked(activeIds: Set<string>) {
  const entries = await readdir(FILES_DIR, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".bin")) {
      return;
    }

    const id = entry.name.slice(0, -4);
    if (!normalizeDropId(id) || activeIds.has(id)) {
      return;
    }

    await unlink(path.join(FILES_DIR, entry.name)).catch(() => undefined);
  }));
}

function dropPath(id: string) {
  const file = path.join(FILES_DIR, `${id}.bin`);
  const resolved = path.resolve(file);
  const root = path.resolve(FILES_DIR);
  if (!resolved.startsWith(root + path.sep)) {
    throw new StorageError("Invalid file path.", 400);
  }
  return resolved;
}

function safeName(name: string) {
  const basename = path.basename(String(name || "flash-drop.bin"));
  const cleaned = basename
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || "flash-drop.bin";
}

function safeType(type: string) {
  const cleaned = String(type || "application/octet-stream")
    .replace(/[\x00-\x1f\x7f]+/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || "application/octet-stream";
}

function isRecord(value: unknown): value is DropRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<DropRecord>;
  return Boolean(
    typeof item.id === "string" &&
      normalizeDropId(item.id) &&
      typeof item.name === "string" &&
      typeof item.type === "string" &&
      typeof item.size === "number" &&
      (item.kind === "file" || item.kind === "text") &&
      typeof item.createdAt === "number" &&
      typeof item.expiresAt === "number" &&
      typeof item.uploaderKey === "string"
  );
}
