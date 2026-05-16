# My Flash Drop Next

A hardened Next.js temporary file drop for self-hosting.

## Start

Install once:

```bash
npm install
```

Run for local/public network access:

```bash
npm run dev
```

Open:

```text
http://YOUR-IP:52895/
```

Production build:

```bash
npm run build
npm run start
```

On Windows you can also run:

```text
start-public.cmd
```

The server must listen on `0.0.0.0` for other devices to access it. The included `dev`, `start`, and `start-public.cmd` commands already do this.

## Security Model

This app allows anonymous upload and download, so it can never be mathematically impossible to misuse. The implementation reduces risk with:

- server-side 100 MB file limit,
- 1-hour automatic expiry,
- live dashboard sync with polling fallback,
- upload progress feedback,
- text drops can be viewed/copied in the browser instead of downloaded,
- randomized file IDs,
- path traversal defenses,
- storage outside public app routes,
- orphan metadata/file cleanup,
- forced `Content-Disposition: attachment` downloads,
- `application/octet-stream` download content type,
- `X-Content-Type-Options: nosniff`,
- strict browser security headers,
- in-memory rate limiting,
- active-drop and total-storage caps,
- admin-token requirement for delete/clear actions.

## Admin Token

Set this before running if you want manual delete/clear buttons to work:

```bash
set FLASHDROP_ADMIN_TOKEN=use-a-long-random-secret
npm run dev
```

PowerShell:

```powershell
$env:FLASHDROP_ADMIN_TOKEN="use-a-long-random-secret"
npm.cmd run dev
```

If no admin token is set, anonymous users can upload and download but cannot delete drops.

## Storage

Uploaded files are stored in:

```text
.flashdrop-data-next/files
```

Metadata is stored in:

```text
.flashdrop-data-next/drops.json
```

The server also cleans stale metadata and private orphan files during normal drop listing/cleanup.

## Live Updates

Open browsers subscribe to:

```text
/api/events
```

Uploads and admin cleanup/delete actions broadcast a small Server-Sent Event, so other open devices update without pressing refresh. If a proxy or browser blocks the event stream, the page falls back to periodic polling.

## Text Drops

Pasted text is shown in a safe read-only text viewer with a one-click copy button. The UI does not show download buttons for text entries. Pasted HTML or scripts are displayed as plain text, not executed.

## Internet Access

To expose from home internet, forward TCP port `52895` from your router to this machine. Use HTTPS through a reverse proxy or tunnel for serious public use.

For LAN testing, open the Wi-Fi IP from another device, for example:

```text
http://192.168.1.40:52895/
```

Do not force `upgrade-insecure-requests` while serving plain HTTP on a LAN IP, or browsers may try to load CSS/JS assets over HTTPS and show an unstyled page.

## Important

For hostile public internet traffic, put this behind a real reverse proxy with HTTPS, request-size limits, logging, firewall rules, and OS updates. Anonymous upload services are inherently high-risk.
