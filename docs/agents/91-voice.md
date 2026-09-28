---
id: voice
title: Voice — TTS capabilities, live token, upstream proxies
summary: Discover TTS engines on this backend, mint Gemini live tokens, and use BE-proxied provider keys.
read_when:
  - The user uses voice mode and you need TTS or live session setup
  - You see 503 no-api-key from the live token route
  - You must call ElevenLabs or Google APIs without holding keys in the agent process
tags: [voice]
surface: [http]
stability: transitional
routes:
  - GET /api/tts/capabilities
  - POST /api/voice/live/token
docs_version: 1.1.0
updated: 2026-09-28
---

# Voice

API keys **`ELEVENLABS_API_KEY`** and **`GEMINI_API_KEY`** live in the **backend environment** (or config mapped to env). Agents do not supply them; the BE proxies upstream calls.

## GET /api/tts/capabilities

Reports which TTS backends are configured and usable (`http-tts-capabilities.ts:205`).

| Status | Anchor |
|--------|--------|
| `200` | `http-tts-capabilities.ts:212` |

## POST /api/voice/live/token

Mints a short-lived token for Gemini live voice (`http-live-token.ts:40`).

| Status | When | Anchor |
|--------|------|--------|
| `400` | Invalid JSON | `http-live-token.ts:45` |
| `400` | Body schema failure | `http-live-token.ts:50` |
| `503` | `{ error: "no-api-key" }` — GEMINI key missing on BE | `http-live-token.ts:55` |
| `502` | `{ error: "token-mint-failed" }` | `http-live-token.ts:87` |
| `200` | Token payload | `http-live-token.ts:96` |

## Upstream proxies (prose only)

The backend also exposes **`/proxy/:provider/*`** for ElevenLabs and Google generative APIs (`http-proxy.ts:84`).

These paths are **out of scope** for `routes:` in agent docs (same as OpenAPI gate). Call them through the BE base URL when the FE or your integration already uses proxied TTS/STT.
