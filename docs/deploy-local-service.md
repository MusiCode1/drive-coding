# Local Prod Service — Deploy Guide

voice-acp running as a systemd user service: BE (Hono) serves the built
static FE and the API/WS/proxy — single origin, no CORS for local access.
Cloudflare Pages connect is also supported simultaneously (cross-origin CORS).

---

## Overview

Two access modes work simultaneously:

| Mode | URL | How |
|------|-----|-----|
| Local | `http://<host>:4000/` | BE serves built `packages/frontend/build/` |
| CF Pages | `https://drive-coding.pages.dev` | Static from CF; `Settings.beUrl` → BE; CORS allows CF origin |

The BE requires the OneCLI gateway (for ElevenLabs + Google proxy credentials).
`voice-acp-be.service` calls `onecli run --agent voice-acp -- bun server.ts`.

---

## Build

Build FE + BE (from the `dev` worktree):

```bash
cd /home/user/projects/voice-acp/dev
pnpm build
```

FE output: `packages/frontend/build/`

---

## Install (one-time)

Copy the unit files from the repo to the systemd user directory:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/voice-acp-be.service ~/.config/systemd/user/
cp deploy/systemd/voice-acp-build.service ~/.config/systemd/user/
cp deploy/systemd/voice-acp-tunnel.service ~/.config/systemd/user/
systemctl --user daemon-reload
```

Enable and start the BE service (and the tunnel):

```bash
systemctl --user enable --now voice-acp-be.service
systemctl --user enable --now voice-acp-tunnel.service
```

---

## Daily Use

After changing source code, trigger a build + restart:

```bash
systemctl --user start voice-acp-build
```

This runs `pnpm build` then restarts `voice-acp-be.service` automatically
(via `ExecStartPost`).

---

## Local Access

Open `http://localhost:4000/` (or `http://<host-ip>:4000/` on LAN).

The BE listens on all interfaces by default (node-server). Restrict to
localhost in the future if needed.

---

## Public Tunnel (single-origin)

`voice-acp-tunnel.service` exposes the BE (which serves FE + API + WS on :4000)
through a pico/tuns.sh SSH tunnel — one origin, no CORS/proxy split.

- URL: `https://your-app-build.nue.tuns.sh`
- The service `Wants=voice-acp-be.service` (starts after the BE, stops with it).
- SSH auto-recovery: `ServerAliveInterval=15` + `ServerAliveCountMax=3` detect a
  dead link (~45s) and exit; `ExitOnForwardFailure=yes` exits on forward failure;
  `Restart=always` + `RestartSec=5` brings it back on the same subdomain.

```bash
systemctl --user status voice-acp-tunnel       # active (running)
journalctl --user -u voice-acp-tunnel -f       # tunnel log
```

Verified: killing the ssh process → systemd restarts it within ~5s, same subdomain.

---

## CF Pages Access

1. Open `https://drive-coding.pages.dev`
2. In Settings, set **BE URL** to the local BE address (e.g. `http://192.168.x.x:4000`)
   — or use a tunnel if accessing remotely (see slice 15d for PNA/mixed-content notes).
3. CORS is pre-configured for `https://drive-coding.pages.dev` in the service env.

---

## Logs

Live log tail:

```bash
journalctl --user -u voice-acp-be -f
```

Wire-level traffic (if `LOG_WIRE=ws` is set in the service Environment):

```bash
# Add to ~/.config/systemd/user/voice-acp-be.service:
# Environment=LOG_WIRE=ws
systemctl --user daemon-reload && systemctl --user restart voice-acp-be
journalctl --user -u voice-acp-be -f
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `AUTH_REQUIRED` / service exits immediately | `ONECLI_API_HOST` not set in systemd env (not inherited from shell) | Add `Environment=ONECLI_API_HOST=<gateway-url>` to the service file; `systemctl --user daemon-reload && systemctl --user restart voice-acp-be` |
| 401 on `/proxy/*` | OneCLI not injecting credentials | Check `onecli` path in service; verify `ONECLI_API_HOST` is correct |
| `voice-acp-build` fails with "pnpm not found" | PATH not initialized | Use `bash -lc 'which pnpm'` to diagnose; consider `corepack pnpm` as fallback |
| Port 4000 already in use | Another process (e.g. dev mode) | Change `Environment=PORT=4001` in service; update `CORS_ORIGINS` accordingly |
| Static files not served (404 on `/`) | `FE_STATIC_DIR` missing or wrong path | Verify path exists: `ls $FE_STATIC_DIR/index.html` |
| SPA route returns 404 | Fallback route missing | Ensure slice 20 BE code is deployed (check `systemctl --user status voice-acp-be`) |
