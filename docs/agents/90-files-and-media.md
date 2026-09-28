---
id: files
title: Files, projects, and recordings
summary: Browse local paths, serve file bytes to the browser, and store short audio recordings.
read_when:
  - You need a clickable file:// link the user can open in the chat UI
  - You want to list project roots or browse a directory through the backend
  - You are uploading or fetching a voice recording id for playback
tags: [files, output]
surface: [http]
stability: stable
routes:
  - GET /api/fs/browse
  - GET /api/fs/file
  - GET /api/projects
  - DELETE /api/projects
  - GET /api/recordings/:id
  - POST /api/recordings
docs_version: 1.2.0
updated: 2026-09-28
---

# Files, projects, and recordings

For **what the chat UI renders** from your markdown, see `45-render-contract`. This doc covers **how to obtain bytes and URLs** through the backend.

## File proxy links

`buildFsFileUrl(origin, absolutePath)` builds **`GET /api/fs/file?uri=…`** (`prompts/surface/runtime.ts:47-51`).

Use the user's **`PUBLIC_BASE_URL`** when present for links they click in a browser (`runtime.ts:121-122`).

## GET /api/fs/file

Serves a local file from an encoded **`file://`** URI (or path resolved to absolute).

| Status | When | Anchor |
|--------|------|--------|
| `400` | Missing `uri`, remote URL, malformed/invalid uri, non-absolute path | `http-fs-file.ts:104`, `:112`, `:123`, `:128`, `:137` |
| `415` | Unsupported extension | `http-fs-file.ts:144` |
| `404` | Not found | `http-fs-file.ts:152`, `:171` |
| `403` | Access denied (allowed roots) | `http-fs-file.ts:161` |
| `413` | Over size cap | `http-fs-file.ts:179`, `:185` |
| `200` | Full file body | `http-fs-file.ts:230` |
| `206` | Partial content (audio + Range) | `http-fs-file-audio.ts:54-55` |
| `416` | Unsatisfiable Range | `http-fs-file-audio.ts:24-25` |

Audio extensions delegate to **`serveAudioFile`** (`http-fs-file.ts:181`); Range parsing is in `http-fs-file-range.ts` (parser only — responses are from `http-fs-file-audio.ts`).

## GET /api/fs/browse

Directory listing under an allowed root.

| Status | When | Anchor |
|--------|------|--------|
| `400` | Missing `path` query | `http-history.ts:182` |
| `404` | Path not found | `http-history.ts:192` |
| `403` | Access denied | `http-history.ts:204` |
| `500` | Cannot read directory | `http-history.ts:213` |
| `200` | `{ path, entries }` | `http-history.ts:238` |

## Projects

| Route | Status | Anchor |
|-------|--------|--------|
| `GET /api/projects` | `200` | `http-history.ts:33` |
| `DELETE /api/projects` | `400` without `cwd` | `http-history.ts:42` |
| `DELETE /api/projects` | `204` empty | `http-history.ts:44` |

## Recordings

| Route | Status | When | Anchor |
|-------|--------|------|--------|
| `GET /api/recordings/:id` | `404` | Unknown id | `http-history.ts:59` |
| `GET /api/recordings/:id` | `200` | Audio bytes | `http-history.ts:62-64` |
| `POST /api/recordings` | `400` | Invalid JSON / missing fields / bad base64 | `http-history.ts:88-104` |
| `POST /api/recordings` | `201` | `{ id }` | `http-history.ts:108` |
