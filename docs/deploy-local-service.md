# Local Prod Service — Deploy Guide

voice-acp running as **two** systemd user services — one per branch. Each BE
(Hono) serves its built static FE + API/WS/proxy on its own port (single origin,
no CORS for local access). Both are exposed publicly via the central
home-server Cloudflare tunnel.

---

## Overview — two deployments

| Deployment | Branch / worktree | Port | Public URL | systemd unit |
|------------|-------------------|------|------------|--------------|
| **main** (prod) | `/home/user/projects/drive-coding/main` | 4000 | `https://drive-coding.example.com` | `voice-acp-main.service` |
| **dev** (staging) | `/home/user/projects/drive-coding/dev` | 4001 | `https://drive-coding-dev.example.com` | `voice-acp-dev.service` |

Each BE requires the OneCLI gateway (for ElevenLabs + Google proxy credentials);
both units call `onecli run --agent voice-acp -- bun packages/backend/src/server.ts`.

> **Why two?** main is the stable prod branch; dev is the integration/staging
> branch where merged slices land first. They run side-by-side on different ports
> so you can preview dev before fast-forwarding main.

---

## Public access — Cloudflare tunnel (no local tunnel service)

Both domains route through the **central** home-server token-based CF tunnel
(`REDACTED-TUNNEL-ID`). There is **no local tunnel systemd unit**
(the old `tuns.sh` tunnel was removed 2026-06-01).

Routing + DNS are managed **via the Cloudflare API** (token-based tunnel has no
local `config.yml`). To change which port a domain hits:

- **Ingress** (hostname → service): `PUT /accounts/{ACCT}/cfd_tunnel/{TUN}/configurations`
  with the FULL ingress list (catch-all `http_status:404` must stay last).
- **DNS** (CNAME → tunnel): `POST/PATCH /zones/{ZONE}/dns_records`, content
  `{TUN}.cfargotunnel.com`, proxied=true.

IDs: ACCT `REDACTED-ACCOUNT-ID`, TUN `REDACTED-TUNNEL-ID`,
ZONE (example.com) `REDACTED-ZONE-ID`. Both hosts point at
`192.168.x.x` (this CT, `cli-agents`): main→`:4000`, dev→`:4001`.

Access the CF API via `onecli run --agent voice-coda-cf -- curl ...` (the CF
secret is configured in that OneCLI selective agent — NOT in `voice-acp`).

---

## Install (one-time)

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/voice-acp-main.service ~/.config/systemd/user/
cp deploy/systemd/voice-acp-dev.service  ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now voice-acp-main.service
systemctl --user enable --now voice-acp-dev.service
```

Each unit's `ExecStartPre` runs `pnpm install --frozen-lockfile && node scripts/dc-build-fe.mjs --if-stale`
in its worktree — installs dependencies and rebuilds the FE **if missing or stale** (compares the version
baked into `build/_app/version.json` against `HEAD`; rebuilds when they differ). So a restart after a
`git pull`/merge picks up the new FE automatically. For a live FE refresh without restart, use `pnpm fe:build`
(see Daily Use).

---

## Daily Use — deploy latest code

### Refresh FE only (common — live agents survive)

```bash
cd /home/user/projects/drive-coding/dev   # or /main for prod
pnpm fe:build
# Then hard-refresh the browser (Ctrl+Shift+R).
# Live ACP agents are NOT killed — no restart needed.
```

The BE reads static files from disk on every request (no in-memory cache),
so the next browser request after the build gets the new files immediately.

> **Note on browser cache:** `index.html` may be cached by the browser. A hard-refresh
> (Ctrl+Shift+R) bypasses it. Asset files (JS/CSS) have content-hash names and
> invalidate automatically. See `slice-cache-headers-version` for a proper fix.

### Restart BE (rare — use only for BE changes)

`restart` kills live ACP agents (they are children of the BE process). Use it only
when BE code changed.

```bash
# Deploy dev (after merging a slice into dev):
systemctl --user restart voice-acp-dev.service

# Deploy main (after fast-forwarding main from dev):
cd /home/user/projects/drive-coding/main && git merge --ff-only dev
systemctl --user restart voice-acp-main.service
```

`restart` re-runs `pnpm install --frozen-lockfile` (picks up new BE deps) and
`node scripts/dc-build-fe.mjs --if-stale` (rebuilds FE if missing **or** the built
version differs from `HEAD`). So after a merge/pull, the restart refreshes the FE
automatically — no need to delete `build/` or run `pnpm fe:build` first.

---

## Apply unit changes (post-merge)

After merging a slice that modifies `deploy/systemd/*.service`, copy the updated
units and reload. This requires an explicit one-time restart to activate the new
`ExecStartPre` (after that, future restarts use the new script automatically).

```bash
cp deploy/systemd/voice-acp-dev.service  ~/.config/systemd/user/
cp deploy/systemd/voice-acp-main.service ~/.config/systemd/user/
systemctl --user daemon-reload
# One-time restart to load the new ExecStartPre (kills children once):
systemctl --user restart voice-acp-dev.service
systemctl --user restart voice-acp-main.service
```

---

## Local Access

- main: `http://localhost:4000/` (or `http://192.168.x.x:4000/` on LAN)
- dev:  `http://localhost:4001/` (or `http://192.168.x.x:4001/` on LAN)

Each BE listens on all interfaces (node-server).

---

## Logs

```bash
journalctl --user -u voice-acp-main -f    # prod log
journalctl --user -u voice-acp-dev  -f    # staging log
```

Wire-level traffic: add `Environment=LOG_WIRE=acp` to the unit, then
`systemctl --user daemon-reload && systemctl --user restart voice-acp-<main|dev>`.
The namespace is `backend.acp.wire.*` (CLI↔BE layer) — survives FE disconnect, always-active for the full child lifetime.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `AUTH_REQUIRED` / service exits immediately | `ONECLI_API_HOST` not set in systemd env | `shared-env.sh` (sourced in ExecStart) sets it; verify the source line exists in the unit |
| 401 on `/proxy/*` | OneCLI not injecting credentials | Check `onecli` on PATH (via shared-env); verify `ONECLI_API_HOST` |
| Port already in use | both units on same port | main=4000, dev=4001 must differ; check `Environment=PORT` |
| Static files 404 on `/` | `FE_STATIC_DIR` missing/wrong | `ls $FE_STATIC_DIR/index.html`; run `pnpm fe:build` in that worktree |
| `frozen-lockfile` fails on restart | new dependency not installed in that worktree | run `pnpm install` once manually in the worktree, then restart |
| public domain 502/404 | CF ingress points at wrong port, or BE down | verify `systemctl --user is-active voice-acp-<x>`; re-check ingress via CF API |

---

## CF Pages Access (legacy, still supported)

`https://drive-coding.pages.dev` with `Settings.beUrl` → a BE address works too;
CORS for the Pages origin is pre-configured in `voice-acp-main.service`. See
`docs/deploy-cf-pages.md` for PNA/mixed-content notes.
