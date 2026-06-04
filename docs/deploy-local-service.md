# Local Prod Service — Deploy Guide

voice-acp running as **two** systemd user services — one per branch. Each BE
(Hono) serves its built static FE + API/WS/proxy on its own port (single origin,
no CORS for local access). Both are exposed publicly via the central
home-server Cloudflare tunnel.

---

## Overview — two deployments

| Deployment | Branch / worktree | Port | Public URL | systemd unit |
|------------|-------------------|------|------------|--------------|
| **main** (prod) | `/home/user/projects/voice-acp/main` | 4000 | `https://drive-coding.example.com` | `voice-acp-main.service` |
| **dev** (staging) | `/home/user/projects/voice-acp/dev` | 4001 | `https://drive-coding-dev.example.com` | `voice-acp-dev.service` |

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

Each unit's `ExecStartPre` runs `pnpm install --frozen-lockfile && pnpm build`
in its worktree, so a `restart` always brings the latest committed code to air.

---

## Daily Use — deploy latest code

Each deployment builds from its own worktree on restart:

```bash
# Deploy dev (after merging a slice into dev):
systemctl --user restart voice-acp-dev.service

# Deploy main (after fast-forwarding main from dev):
cd /home/user/projects/voice-acp/main && git merge --ff-only dev
systemctl --user restart voice-acp-main.service
```

`restart` re-runs install+build via `ExecStartPre`. Build is incremental (~fast
when unchanged); a fresh dependency after a merge is installed before the build.

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

Wire-level traffic: add `Environment=LOG_WIRE=ws` to the unit, then
`systemctl --user daemon-reload && systemctl --user restart voice-acp-<main|dev>`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `AUTH_REQUIRED` / service exits immediately | `ONECLI_API_HOST` not set in systemd env | `shared-env.sh` (sourced in ExecStart) sets it; verify the source line exists in the unit |
| 401 on `/proxy/*` | OneCLI not injecting credentials | Check `onecli` on PATH (via shared-env); verify `ONECLI_API_HOST` |
| Port already in use | both units on same port | main=4000, dev=4001 must differ; check `Environment=PORT` |
| Static files 404 on `/` | `FE_STATIC_DIR` missing/wrong | `ls $FE_STATIC_DIR/index.html`; run `pnpm build` in that worktree |
| `frozen-lockfile` fails on restart | new dependency not installed in that worktree | run `pnpm install` once manually in the worktree, then restart |
| public domain 502/404 | CF ingress points at wrong port, or BE down | verify `systemctl --user is-active voice-acp-<x>`; re-check ingress via CF API |

---

## CF Pages Access (legacy, still supported)

`https://drive-coding.pages.dev` with `Settings.beUrl` → a BE address works too;
CORS for the Pages origin is pre-configured in `voice-acp-main.service`. See
`docs/deploy-cf-pages.md` for PNA/mixed-content notes.
