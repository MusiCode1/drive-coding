# Deploy — Cloudflare Pages (drive-coding)

> Updated: 2026-05-30 — slice 15d

This document describes how to build and deploy the **drive-coding** frontend to Cloudflare Pages.

## Architecture overview

The app uses a **"bring your own backend"** model:

- **Frontend** — static SPA deployed to `https://drive-coding.pages.dev` (Cloudflare Pages).
- **Backend** — runs locally on your machine (`localhost:4000`). Users enter the BE URL in `/settings`.
- The FE fetches `Settings.beUrl + "/api/..."` for all API calls (set up in slice 15b/15c).

> ⚠️ **Important**: The public FE at `pages.dev` cannot reach `localhost:4000` on _your_ machine unless
> the user opens the app in a browser on the **same machine** running the BE. Even then, browser
> security restrictions may apply — see [Known Limitations](#known-limitations) below.

---

## 1. Build

From the monorepo root:

```bash
pnpm --filter @drive-coding/frontend build
```

Output: `packages/frontend/build/` (static SPA with `index.html` fallback for client-side routing).

**Verify:**
```bash
test -f packages/frontend/build/index.html && echo OK
```

---

## 2. Deploy

### Option A — wrangler Direct Upload (recommended)

```bash
npx wrangler pages deploy packages/frontend/build --project-name=drive-coding
```

- If the project `drive-coding` does not yet exist in your Cloudflare account, wrangler will offer
  to create it interactively, or you can create it first in the CF dashboard.
- No `wrangler.toml` required for Direct Upload — the project name and build dir are passed as CLI flags.
- Deployed URL: `https://drive-coding.pages.dev`

### Option B — CF Dashboard / Git integration

Configure the project in the Cloudflare dashboard with:

| Setting | Value |
|---|---|
| Build command | `pnpm --filter @drive-coding/frontend build` |
| Build output directory | `packages/frontend/build` |
| Root directory | `/` (monorepo root) |

> Note: Git integration + `wrangler.toml` is a future slice. For now, use Direct Upload (Option A).

---

## 3. Running the local BE for use with the deployed FE

When connecting the deployed `drive-coding.pages.dev` FE to a local BE, include the Pages origin in `CORS_ORIGINS`:

```bash
CORS_ORIGINS="https://drive-coding.pages.dev,http://localhost:4000" \
  PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts
```

This is consistent with the value already set in `deploy/systemd/voice-acp-be.service` (from slice 20).

### Verify CORS preflight

```bash
# Start BE temporarily on port 4002 with the correct CORS origins
CORS_ORIGINS="https://drive-coding.pages.dev,http://localhost:4000" PORT=4002 \
  onecli run --agent voice-acp -- bun src/server.ts &
sleep 3

# Preflight OPTIONS request
curl -sI -X OPTIONS http://localhost:4002/api/agents \
  -H "Origin: https://drive-coding.pages.dev" \
  -H "Access-Control-Request-Method: GET" 2>&1 | grep -i "access-control"
# Expected: access-control-allow-origin: https://drive-coding.pages.dev
```

---

## 4. Known Limitations

### Mixed-content (HTTPS → HTTP)

The deployed FE is served over HTTPS (`https://drive-coding.pages.dev`). Fetching a
`http://localhost:4000` backend from HTTPS context is a **mixed-content** request, which most
browsers block by default. Some browsers allow a per-site override in site settings.

### Private Network Access (Chrome 94+, CORS-RFC1918)

Even if mixed-content is allowed, Chrome 94+ actively blocks requests from a **public origin**
(like `pages.dev`) to `localhost` or LAN addresses. This requires the BE to respond with:

```
Access-Control-Allow-Private-Network: true
```

on CORS preflight responses.

**Current status**: Neither the mixed-content issue nor the PNA header is handled in the current
slice. The BE serving over HTTPS (via the existing tunnel at
`https://your-app-build.nue.tuns.sh`) avoids both problems.

**Resolution path**:
1. **Use the tunnel BE URL** in `/settings` instead of `localhost` — avoids both issues immediately.
2. **Add PNA header to BE** — future slice; solves the PNA issue but not mixed-content.
3. **Expose BE over HTTPS** (proper DNS + cert or tunnel) — full solution; future slice.

---

## 5. URL

| Environment | URL |
|---|---|
| Deployed FE (CF Pages) | `https://drive-coding.pages.dev` |
| Local BE (default) | `http://localhost:4000` |
| Local BE via tunnel | `https://your-app-build.nue.tuns.sh` |

---

## 6. Related docs

- `docs/deploy-local-service.md` — local systemd service + tunnel setup
- `deploy/systemd/voice-acp-be.service` — the systemd unit with `CORS_ORIGINS` already set
- `packages/frontend/src/lib/view-models/settings.svelte.ts` — `Settings.beUrl` implementation
- `packages/backend/src/delivery/cors-config.ts` — CORS parser
