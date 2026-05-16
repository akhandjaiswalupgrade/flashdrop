"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Drop = {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "file" | "text";
  createdAt: number;
  expiresAt: number;
  downloadUrl: string;
};

type Status = {
  ok: boolean;
  serverTime: number;
  maxFileBytes: number;
  ttlMs: number;
  maxActiveDrops: number;
  maxTotalBytes: number;
  adminEnabled: boolean;
};

type LiveState = "connecting" | "live" | "fallback";

type UploadProgress = {
  label: string;
  percent: number;
};

type TextViewer = {
  drop: Drop;
  text: string;
  loading: boolean;
};

type TextDropResponse = {
  id: string;
  name: string;
  size: number;
  text: string;
  serverTime: number;
};

const FALLBACK_MAX_BYTES = 100 * 1024 * 1024;

export function FlashDropApp() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [serverDelta, setServerDelta] = useState(0);
  const [message, setMessage] = useState("");
  const [textValue, setTextValue] = useState("");
  const [textName, setTextName] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [liveState, setLiveState] = useState<LiveState>("connecting");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [textViewer, setTextViewer] = useState<TextViewer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);

  const maxBytes = status?.maxFileBytes || FALLBACK_MAX_BYTES;
  const serverNow = nowTick - serverDelta;

  const sortedDrops = useMemo(
    () => [...drops].sort((a, b) => a.expiresAt - b.expiresAt),
    [drops]
  );

  const totalBytes = sortedDrops.reduce((sum, drop) => sum + drop.size, 0);
  const nextDrop = sortedDrops[0];
  const nextRemaining = nextDrop ? Math.max(0, nextDrop.expiresAt - serverNow) : 0;

  useEffect(() => {
    const savedToken = sessionStorage.getItem("flashdrop-admin-token");
    if (savedToken) {
      setAdminToken(savedToken);
    }

    void loadStatus();
    void refreshDrops();
    const events = connectLiveUpdates();

    const tickTimer = window.setInterval(() => setNowTick(Date.now()), 1000);
    const refreshTimer = window.setInterval(() => void refreshDrops(), 30_000);

    return () => {
      events?.close();
      window.clearInterval(tickTimer);
      window.clearInterval(refreshTimer);
      if (toastTimer.current) {
        window.clearTimeout(toastTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    sessionStorage.setItem("flashdrop-admin-token", adminToken);
  }, [adminToken]);

  useEffect(() => {
    if (textViewer && !sortedDrops.some((drop) => drop.id === textViewer.drop.id)) {
      setTextViewer(null);
    }
  }, [sortedDrops, textViewer]);

  useEffect(() => {
    if (!textViewer) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTextViewer(null);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [textViewer]);

  useEffect(() => {
    if (sortedDrops.some((drop) => drop.expiresAt <= serverNow)) {
      void refreshDrops();
    }
  }, [serverNow, sortedDrops]);

  async function loadStatus() {
    try {
      const data = await api<Status>("/api/status");
      setStatus(data);
      syncClock(data.serverTime);
    } catch (error) {
      showError(error);
    }
  }

  async function refreshDrops() {
    try {
      const data = await api<{ drops: Drop[]; serverTime: number }>("/api/drops");
      setDrops(data.drops);
      setLastUpdate(Date.now());
      syncClock(data.serverTime);
    } catch (error) {
      showError(error);
    }
  }

  function connectLiveUpdates() {
    if (!("EventSource" in window)) {
      setLiveState("fallback");
      return null;
    }

    const events = new EventSource("/api/events");

    events.onopen = () => {
      setLiveState("live");
    };

    events.addEventListener("status", (event) => {
      const payload = parseEventPayload(event);
      if (payload?.serverTime) {
        syncClock(payload.serverTime);
      }
      setLiveState("live");
    });

    events.addEventListener("drops", (event) => {
      const payload = parseEventPayload(event);
      if (payload?.serverTime) {
        syncClock(payload.serverTime);
      }
      setLiveState("live");
      void refreshDrops();
    });

    events.onerror = () => {
      setLiveState("fallback");
    };

    return events;
  }

  async function uploadFiles(files: File[]) {
    const accepted = files.filter((file) => {
      if (file.size > maxBytes) {
        showToast(`${file.name} is over the 100 MB limit.`);
        return false;
      }
      return true;
    });

    if (!accepted.length) {
      return;
    }

    setBusy(true);
    try {
      for (const file of accepted) {
        await uploadDrop(file, file.name || "flash-drop.bin", "file");
      }
      showToast(`${accepted.length} drop${accepted.length === 1 ? "" : "s"} saved.`);
      await refreshDrops();
    } catch (error) {
      showError(error);
    } finally {
      setUploadProgress(null);
      setBusy(false);
    }
  }

  async function saveText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = textValue.trim();
    if (!value) {
      showToast("Add text first.");
      return;
    }

    let filename = sanitizeName(textName || "Text drop");
    if (!filename.toLowerCase().endsWith(".txt")) {
      filename += ".txt";
    }

    const file = new File([textValue], filename, { type: "text/plain;charset=utf-8" });
    if (file.size > maxBytes) {
      showToast("Text is over the 100 MB limit.");
      return;
    }

    setBusy(true);
    try {
      await uploadDrop(file, filename, "text");
      setTextValue("");
      setTextName("");
      showToast("Text saved.");
      await refreshDrops();
    } catch (error) {
      showError(error);
    } finally {
      setUploadProgress(null);
      setBusy(false);
    }
  }

  async function uploadDrop(file: File, name: string, kind: Drop["kind"]) {
    const safe = sanitizeName(name);
    const form = new FormData();
    form.set("name", safe);
    form.set("kind", kind);
    form.set("payload", file, safe);

    const data = await uploadWithProgress(form, safe, (percent) => {
      setUploadProgress({ label: safe, percent });
    });
    syncClock(data.serverTime);
  }

  async function clearExpired() {
    await adminRequest("/api/cleanup", { method: "POST" }, "Expired drops removed.");
  }

  async function clearAll() {
    await adminRequest("/api/drops", { method: "DELETE" }, "All drops removed.");
  }

  async function deleteDrop(drop: Drop) {
    await adminRequest(`/api/drops/${encodeURIComponent(drop.id)}`, { method: "DELETE" }, "Drop removed.");
  }

  async function adminRequest(path: string, options: RequestInit, success: string) {
    if (!adminToken) {
      showToast("Admin token required.");
      return;
    }

    setBusy(true);
    try {
      const data = await api<{ serverTime: number }>(path, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${adminToken}`
        }
      });
      syncClock(data.serverTime);
      showToast(success);
      await refreshDrops();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function downloadDrop(drop: Drop) {
    window.location.href = absoluteUrl(drop.downloadUrl);
  }

  async function copyLink(drop: Drop) {
    const link = absoluteUrl(drop.downloadUrl);
    try {
      await copyText(link);
      showToast("Download link copied.");
    } catch {
      showToast(link);
    }
  }

  async function viewTextDrop(drop: Drop) {
    setTextViewer({ drop, text: "", loading: true });
    try {
      const data = await fetchTextDrop(drop);
      setTextViewer({ drop, text: data.text, loading: false });
    } catch (error) {
      setTextViewer(null);
      showError(error);
    }
  }

  async function copyTextDrop(drop: Drop) {
    try {
      const data = textViewer?.drop.id === drop.id && !textViewer.loading
        ? { text: textViewer.text, serverTime: Date.now() }
        : await fetchTextDrop(drop);
      await copyText(data.text);
      syncClock(data.serverTime);
      showToast("Text copied.");
    } catch (error) {
      showError(error);
    }
  }

  async function fetchTextDrop(drop: Drop) {
    const data = await api<TextDropResponse>(`/api/drops/${encodeURIComponent(drop.id)}/text`);
    syncClock(data.serverTime);
    return data;
  }

  async function copyPageLink() {
    const link = new URL("/", window.location.href).href;
    try {
      await copyText(link);
      showToast("Page link copied.");
    } catch {
      showToast(link);
    }
  }

  function showError(error: unknown) {
    showToast(error instanceof Error ? error.message : "Request failed.");
  }

  function showToast(text: string) {
    setMessage(text);
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => setMessage(""), 4500);
  }

  function syncClock(serverTime?: number) {
    if (serverTime) {
      setServerDelta(Date.now() - serverTime);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="My Flash Drop home">
          <span className="brand-mark" aria-hidden="true">FD</span>
          <span>
            <strong>My Flash Drop</strong>
            <small>Hardened public drop</small>
          </span>
        </a>
        <div className="badges" aria-label="Limits and connection">
          <span className={`live-pill ${liveState}`}>{liveLabel(liveState)}</span>
          <span>100 MB max</span>
          <span>1 hour</span>
          <span>Attachment-only</span>
          <button type="button" className="copy-page" onClick={() => void copyPageLink()}>
            Copy page link
          </button>
        </div>
      </header>

      <section className="hero" aria-labelledby="title">
        <div>
          <p className="eyebrow">Next.js server storage</p>
          <h1 id="title">Temporary drops for anyone who can reach this address.</h1>
        </div>
        <div className="hero-meter" aria-label="Next removal">
          <span>{nextDrop ? formatDuration(nextRemaining) : "No drops"}</span>
          <small>next cleanup</small>
        </div>
      </section>

      <section className="notice" aria-label="Security status">
        <strong>{status?.adminEnabled ? "Admin token enabled" : "Anonymous public mode"}</strong>
        <span>
          Uploads are stored outside the app routes, downloaded as attachments, rate limited, removed after 1 hour, and synced live across open devices.
        </span>
      </section>

      <section className="workspace" aria-label="Drop workspace">
        <div className="drop-panel">
          <div
            className={`drop-zone${dragging ? " is-dragging" : ""}`}
            role="group"
            aria-label="File upload"
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const files = Array.from(event.dataTransfer.files || []);
              if (files.length) {
                void uploadFiles(files);
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                void uploadFiles(files);
                event.currentTarget.value = "";
              }}
            />
            <span className="drop-icon" aria-hidden="true">+</span>
            <span className="drop-title">Drop files here</span>
            <span className="drop-copy">All file types accepted. Server-enforced limit: 100 MB.</span>
            {uploadProgress && (
              <div className="upload-progress" role="status" aria-live="polite">
                <span>{uploadProgress.label}</span>
                <strong>{uploadProgress.percent}%</strong>
                <div aria-hidden="true">
                  <i style={{ transform: `scaleX(${uploadProgress.percent / 100})` }} />
                </div>
              </div>
            )}
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              Choose files
            </button>
          </div>

          <form className="text-drop" onSubmit={saveText}>
            <label htmlFor="textInput">Text drop</label>
            <textarea
              id="textInput"
              maxLength={maxBytes}
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              placeholder="Paste text..."
            />
            <div className="form-row">
              <input
                type="text"
                value={textName}
                maxLength={80}
                onChange={(event) => setTextName(event.target.value)}
                placeholder="Optional name"
              />
              <button type="submit" disabled={busy}>Save text</button>
            </div>
          </form>
        </div>

        <aside className="dashboard" aria-label="Dashboard">
          <Metric label="Active drops" value={String(sortedDrops.length)} />
          <Metric label="Stored" value={formatBytes(totalBytes)} />
          <Metric label="Next removal" value={nextDrop ? formatDuration(nextRemaining) : "--"} />
          <Metric label="Last sync" value={lastUpdate ? formatClock(lastUpdate) : "--"} />

          <label className="admin-field">
            <span>Admin token</span>
            <input
              type="password"
              autoComplete="off"
              value={adminToken}
              onChange={(event) => setAdminToken(event.target.value)}
              placeholder={status?.adminEnabled ? "Required for delete" : "Not configured"}
              disabled={!status?.adminEnabled}
            />
          </label>

          <div className="admin-actions">
            <button type="button" onClick={clearExpired} disabled={busy || !status?.adminEnabled}>
              Clear expired
            </button>
            <button type="button" className="danger" onClick={clearAll} disabled={busy || !status?.adminEnabled}>
              Clear all
            </button>
          </div>
        </aside>
      </section>

      <section className="drops-section" aria-labelledby="drops-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h2 id="drops-title">Current drops</h2>
          </div>
          <button type="button" className="ghost" onClick={() => void refreshDrops()} disabled={busy}>
            Refresh
          </button>
        </div>

        <div className="drop-list" aria-live="polite">
          {sortedDrops.map((drop) => {
            const left = Math.max(0, drop.expiresAt - serverNow);
            const elapsed = Math.max(0, serverNow - drop.createdAt);
            const progress = Math.max(0, Math.min(1, 1 - elapsed / (status?.ttlMs || 3_600_000)));

            return (
              <article className="drop-card" key={drop.id}>
                <div className="drop-card-main">
                  <div className="file-glyph" aria-hidden="true">{glyphFor(drop)}</div>
                  <div className="file-meta">
                    <h3>{drop.name}</h3>
                    <p className="file-details">
                      {drop.kind === "text" ? "Plain text" : "File"} | {formatBytes(drop.size)} | {drop.type || "unknown"}
                    </p>
                    <div className="timer-line">
                      <span className="timer">{formatDuration(left)} left</span>
                      <span>removes at {formatClock(drop.expiresAt)}</span>
                    </div>
                    <div className="progress-track" aria-hidden="true">
                      <span className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
                    </div>
                  </div>
                </div>
                <div className="drop-actions">
                  {drop.kind === "text" ? (
                    <>
                      <button type="button" onClick={() => void viewTextDrop(drop)}>View</button>
                      <button type="button" onClick={() => void copyTextDrop(drop)}>Copy text</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => downloadDrop(drop)}>Download</button>
                      <button type="button" onClick={() => void copyLink(drop)}>Copy link</button>
                    </>
                  )}
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void deleteDrop(drop)}
                    disabled={busy || !status?.adminEnabled}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {!sortedDrops.length && (
          <p className="empty-state">Nothing here yet.</p>
        )}
      </section>

      {textViewer && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setTextViewer(null)}>
          <section
            className="text-viewer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="text-viewer-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">Text drop</p>
                <h2 id="text-viewer-title">{textViewer.drop.name}</h2>
              </div>
              <button type="button" className="ghost" onClick={() => setTextViewer(null)}>
                Close
              </button>
            </header>
            <p className="viewer-meta">
              {formatBytes(textViewer.drop.size)} | expires at {formatClock(textViewer.drop.expiresAt)}
            </p>
            <textarea
              readOnly
              value={textViewer.loading ? "Loading text..." : textViewer.text}
              aria-label={`Text content for ${textViewer.drop.name}`}
            />
            <footer>
              <button
                type="button"
                onClick={() => void copyTextDrop(textViewer.drop)}
                disabled={textViewer.loading}
              >
                Copy text
              </button>
              <button type="button" className="ghost" onClick={() => setTextViewer(null)}>
                Done
              </button>
            </footer>
          </section>
        </div>
      )}

      <div className={`toast${message ? " is-visible" : ""}`} role="status" aria-live="polite">
        {message}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data as T;
}

function uploadWithProgress(
  form: FormData,
  label: string,
  onProgress: (percent: number) => void
): Promise<{ drop: Drop; serverTime: number }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/drops");
    request.setRequestHeader("Accept", "application/json");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100))));
      } else {
        onProgress(1);
      }
    };

    request.onload = () => {
      let data: { drop?: Drop; serverTime?: number; error?: string } = {};
      try {
        data = request.responseText ? JSON.parse(request.responseText) : {};
      } catch {
        reject(new Error("Upload response was not valid JSON."));
        return;
      }

      if (request.status < 200 || request.status >= 300) {
        reject(new Error(data.error || "Upload failed."));
        return;
      }

      if (!data.drop || !data.serverTime) {
        reject(new Error("Upload response was incomplete."));
        return;
      }

      onProgress(100);
      resolve({ drop: data.drop, serverTime: data.serverTime });
    };

    request.onerror = () => reject(new Error(`Network error while uploading ${label}.`));
    request.onabort = () => reject(new Error(`Upload cancelled for ${label}.`));
    request.send(form);
  });
}

function parseEventPayload(event: Event) {
  const message = event as MessageEvent<string>;
  try {
    return JSON.parse(message.data) as { serverTime?: number; version?: number; reason?: string };
  } catch {
    return null;
  }
}

function liveLabel(state: LiveState) {
  if (state === "live") {
    return "Live sync";
  }
  if (state === "fallback") {
    return "Polling sync";
  }
  return "Connecting";
}

function sanitizeName(name: string) {
  return String(name || "flash-drop")
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "flash-drop";
}

function glyphFor(drop: Drop) {
  if (drop.kind === "text") {
    return "TXT";
  }
  const extension = drop.name.includes(".") ? drop.name.split(".").pop() : "";
  return (extension || "BIN").slice(0, 3).toUpperCase();
}

function formatBytes(bytes: number) {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? size : size.toFixed(size >= 10 ? 1 : 2)} ${units[unit]}`;
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatClock(time: number) {
  return new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function pad(value: number) {
  return value < 10 ? `0${value}` : String(value);
}

function absoluteUrl(path: string) {
  return new URL(path, window.location.href).href;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}
