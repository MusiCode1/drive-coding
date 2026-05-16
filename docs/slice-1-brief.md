# Slice 1 — Implementation Brief

> **מטרה:** scaffold monorepo + echo WS עובד מהדפדפן ל-backend וחזרה.
> **תקציר ל-coding agent.** כל ההחלטות ננעלו — בצע לפי ההוראות. אם משהו לא ברור, חזור ל-Tama.
> **תלות:** `docs/vnext-architecture.md` (D1-D50), `docs/vnext-spec.md` §8 (Slice 1).

---

## 1. החלטות שננעלו ל-Slice 1

| נושא | בחירה | למה |
|------|--------|-----|
| **Runtime** | **Bun בלבד** ב-Slice 1 (Node support ב-Slice 2) | פשטות. Hono+`@hono/node-ws` ב-Node דורש 2 imports שונים — נוסיף לאחר ש-Bun עובד |
| **Package manager** | `pnpm@10` workspaces | universal, יציב |
| **Linter/formatter** | Biome 2.x | מהיר, אחד-עבור-הכל, default ב-stdio-to-ws+Hono ecosystem |
| **TypeScript** | 5.7+ strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess` | חמור, מונע באגים |
| **Test runner** | Vitest 4.x (workspace config) | universal, מסונכרן עם Vite |
| **dev runner** | `bun --watch` ב-backend; `vite dev` ב-frontend | hot reload |
| **HTTP/WS server** | Hono 4.x + `Bun.serve` | aerodynamic |
| **Frontend** | SvelteKit 2 + Svelte 5 + adapter-static | אבי בחר |
| **ArkType** | 2.x | schemas |
| **neverthrow** | 8.x | Result type |
| **Module system** | ESM only | אין CommonJS בכלל |

---

## 2. מבנה תיקיות (יוקם בסעיף 4)

```
drive-coding/                        ← root של worktree
├── package.json                     ← root + workspaces
├── pnpm-workspace.yaml
├── tsconfig.base.json               ← shared TS config
├── tsconfig.json                    ← root solution (references)
├── vitest.config.ts                 ← root vitest workspace
├── biome.json                       ← lint+format
├── .gitignore
├── .nvmrc                           ← Node version pin (לעתיד)
├── AGENTS.md                        ← project conventions
├── README.md                        ← quick start
├── docs/                            ← copied from voice-acp
│   ├── vnext-architecture.md
│   ├── vnext-spec.md
│   ├── vnext-research.md
│   ├── slice-1-brief.md             ← this file
│   └── agents/
│       └── README.md
└── packages/
    ├── core/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts             ← public exports
    │       └── schemas/
    │           └── ws-messages.ts   ← Ping/Pong (Slice 1)
    ├── backend/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── Dockerfile               ← stub (Slice 10)
    │   └── src/
    │       ├── server.ts            ← entry point
    │       └── delivery/
    │           ├── http.ts          ← health endpoint
    │           └── ws-echo.ts       ← Slice 1 echo handler
    └── frontend/
        ├── package.json
        ├── tsconfig.json
        ├── svelte.config.js
        ├── vite.config.ts
        ├── static/
        └── src/
            ├── app.html
            ├── app.d.ts
            ├── routes/
            │   ├── +layout.svelte
            │   └── +page.svelte     ← "Hello + Connect" button
            └── lib/
                └── ws-client.ts     ← thin client
```

---

## 3. תבניות קוד מדויקות

### 3.1 root `package.json`

```json
{
  "name": "drive-coding",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.0.0",
  "engines": {
    "node": ">=22.5.0",
    "pnpm": ">=10.0.0"
  },
  "scripts": {
    "dev": "pnpm -r --parallel run dev",
    "build": "pnpm -r run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --build",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "typescript": "^5.7.0",
    "vitest": "^4.0.0",
    "@types/node": "^22.0.0"
  }
}
```

### 3.2 `pnpm-workspace.yaml`

```yaml
packages:
  - 'packages/*'
```

### 3.3 `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### 3.4 root `tsconfig.json` (solution)

```json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/backend" }
  ]
}
```

### 3.5 `packages/core/package.json`

```json
{
  "name": "@drive-coding/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./schemas/*": "./src/schemas/*.ts"
  },
  "scripts": {
    "build": "tsc --build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "arktype": "^2.0.0",
    "neverthrow": "^8.0.0"
  }
}
```

### 3.6 `packages/core/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*"]
}
```

### 3.7 `packages/core/src/index.ts`

```typescript
export * from "./schemas/ws-messages"
```

### 3.8 `packages/core/src/schemas/ws-messages.ts`

```typescript
import { type } from "arktype"

// Client → Server (Slice 1: ping only)
export const PingMessage = type({ type: "'ping'" })
export type PingMessage = typeof PingMessage.infer

export const ClientMessage = PingMessage  // נרחיב ב-Slice הבא

// Server → Client
export const HelloMessage = type({ type: "'hello'", version: "string" })
export const PongMessage = type({
  type: "'pong'",
  echoOf: "string",
  serverTime: "number",
})
export const ErrorMessage = type({ type: "'error'", message: "string" })

export const ServerMessage = HelloMessage.or(PongMessage).or(ErrorMessage)
export type ServerMessage = typeof ServerMessage.infer
```

### 3.9 `packages/backend/package.json`

```json
{
  "name": "@drive-coding/backend",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/server.ts",
    "build": "tsc --build",
    "start": "bun src/server.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@drive-coding/core": "workspace:*",
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

### 3.10 `packages/backend/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun"]
  },
  "references": [{ "path": "../core" }],
  "include": ["src/**/*"]
}
```

### 3.11 `packages/backend/src/server.ts`

```typescript
import { Hono } from "hono"
import { cors } from "hono/cors"
import { registerHttp } from "./delivery/http"
import { registerEchoWs } from "./delivery/ws-echo"

const app = new Hono()

app.use("*", cors({ origin: ["http://localhost:5173"], credentials: true }))

registerHttp(app)

const echo = registerEchoWs(app)  // returns { websocket } for Bun.serve

const port = Number(process.env.PORT ?? 4000)

Bun.serve({
  port,
  fetch: (req, server) => {
    const url = new URL(req.url)
    if (url.pathname === "/ws/echo") {
      const upgraded = server.upgrade(req)
      if (upgraded) return  // WS upgraded
      return new Response("WS upgrade failed", { status: 426 })
    }
    return app.fetch(req)
  },
  websocket: echo.websocket,
})

console.log(`[backend] listening on http://localhost:${port}`)
```

### 3.12 `packages/backend/src/delivery/http.ts`

```typescript
import type { Hono } from "hono"

export function registerHttp(app: Hono): void {
  app.get("/api/health", (c) =>
    c.json({ status: "ok", version: "0.0.0", uptime: process.uptime() })
  )
}
```

### 3.13 `packages/backend/src/delivery/ws-echo.ts`

```typescript
import type { Hono } from "hono"
import type { ServerWebSocket } from "bun"
import { type } from "arktype"
import { ClientMessage, type ServerMessage } from "@drive-coding/core"

type WsData = { id: string }

function send(ws: ServerWebSocket<WsData>, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg))
}

export function registerEchoWs(_app: Hono): {
  websocket: Parameters<typeof Bun.serve<WsData>>[0]["websocket"]
} {
  return {
    websocket: {
      open(ws) {
        send(ws, { type: "hello", version: "0.0.0" })
      },
      message(ws, raw) {
        let parsed: unknown
        try {
          parsed = JSON.parse(String(raw))
        } catch {
          send(ws, { type: "error", message: "invalid json" })
          return
        }
        const result = ClientMessage(parsed)
        if (result instanceof type.errors) {
          send(ws, { type: "error", message: result.summary })
          return
        }
        if (result.type === "ping") {
          send(ws, {
            type: "pong",
            echoOf: "ping",
            serverTime: Date.now(),
          })
        }
      },
      close() {
        // cleanup later
      },
    },
  }
}
```

### 3.14 `packages/frontend/package.json`

```json
{
  "name": "@drive-coding/frontend",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev --port 5173",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
  },
  "dependencies": {
    "@drive-coding/core": "workspace:*"
  },
  "devDependencies": {
    "@sveltejs/adapter-static": "^3.0.0",
    "@sveltejs/kit": "^2.8.0",
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "vite": "^6.0.0"
  }
}
```

### 3.15 `packages/frontend/svelte.config.js`

```javascript
import adapter from "@sveltejs/adapter-static"
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",
      precompress: false,
    }),
  },
}
```

### 3.16 `packages/frontend/vite.config.ts`

```typescript
import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/ws": { target: "ws://localhost:4000", ws: true },
    },
  },
})
```

### 3.17 `packages/frontend/tsconfig.json`

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true
  }
}
```

### 3.18 `packages/frontend/src/routes/+page.svelte`

```svelte
<script lang="ts">
  import { onDestroy } from "svelte"

  type LogEntry = { time: string; direction: "→" | "←"; payload: string }

  let log = $state<LogEntry[]>([])
  let ws = $state<WebSocket | null>(null)
  let status = $state<"disconnected" | "connecting" | "connected">("disconnected")

  function addLog(direction: "→" | "←", payload: string): void {
    log = [
      { time: new Date().toLocaleTimeString(), direction, payload },
      ...log.slice(0, 19),
    ]
  }

  function connect(): void {
    if (ws) return
    status = "connecting"
    const socket = new WebSocket(`ws://${location.host}/ws/echo`)
    socket.onopen = () => {
      status = "connected"
      addLog("←", "[opened]")
    }
    socket.onmessage = (e) => addLog("←", String(e.data))
    socket.onerror = () => addLog("←", "[error]")
    socket.onclose = () => {
      status = "disconnected"
      ws = null
      addLog("←", "[closed]")
    }
    ws = socket
  }

  function sendPing(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const msg = JSON.stringify({ type: "ping" })
    ws.send(msg)
    addLog("→", msg)
  }

  function disconnect(): void {
    ws?.close()
  }

  onDestroy(() => ws?.close())
</script>

<main>
  <h1>drive-coding — Slice 1</h1>
  <p>Status: <strong>{status}</strong></p>
  <div class="actions">
    {#if status === "disconnected"}
      <button onclick={connect}>Connect</button>
    {:else}
      <button onclick={sendPing} disabled={status !== "connected"}>Send ping</button>
      <button onclick={disconnect}>Disconnect</button>
    {/if}
  </div>
  <ul class="log">
    {#each log as entry (entry.time + entry.payload)}
      <li><code>{entry.time}</code> {entry.direction} <code>{entry.payload}</code></li>
    {/each}
  </ul>
</main>

<style>
  main { max-width: 720px; margin: 2rem auto; font-family: system-ui, sans-serif; }
  .actions { display: flex; gap: 0.5rem; margin: 1rem 0; }
  button { padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; }
  .log { list-style: none; padding: 0; }
  .log li { padding: 0.25rem 0; border-bottom: 1px solid #eee; font-size: 0.9rem; }
  code { background: #f5f5f5; padding: 0.1rem 0.3rem; border-radius: 3px; }
</style>
```

### 3.19 `packages/frontend/src/routes/+layout.svelte`

```svelte
<script lang="ts">
  let { children } = $props()
</script>

{@render children?.()}
```

### 3.20 `packages/frontend/src/app.html`

```html
<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>drive-coding</title>
    %sveltekit.head%
  </head>
  <body>
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

### 3.21 `packages/frontend/src/app.d.ts`

```typescript
// See https://svelte.dev/docs/kit/types#app
declare global {
  namespace App {}
}

export {}
```

### 3.22 `biome.json`

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignore": [
      "**/dist/**",
      "**/node_modules/**",
      "**/.svelte-kit/**",
      "**/build/**"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "asNeeded"
    }
  }
}
```

### 3.23 `vitest.config.ts` (root)

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: ["packages/core", "packages/backend"],
  },
})
```

### 3.24 `.gitignore`

```
node_modules/
dist/
build/
.svelte-kit/
*.log
.env
.env.local
.DS_Store
```

### 3.25 `packages/core/tests/schemas.test.ts` (test לpurity של core)

```typescript
import { describe, it, expect } from "vitest"
import { ClientMessage, ServerMessage } from "../src"

describe("ClientMessage", () => {
  it("accepts valid ping", () => {
    const result = ClientMessage({ type: "ping" })
    expect(result).toEqual({ type: "ping" })
  })

  it("rejects invalid type", () => {
    const result = ClientMessage({ type: "foo" })
    expect(result).toHaveProperty("summary")
  })
})

describe("ServerMessage", () => {
  it("accepts pong", () => {
    const result = ServerMessage({
      type: "pong",
      echoOf: "ping",
      serverTime: 1234,
    })
    expect(result).toMatchObject({ type: "pong" })
  })
})
```

---

## 4. Step-by-step להפעלה

בצע בסדר. אל תפסיק באמצע — כל שלב תלוי בקודמו.

### 4.1 פתיחת worktree

```bash
cd /home/user/projects/voice-acp
git worktree add ../voice-acp-v2 -b vnext
cd ../voice-acp-v2
```

### 4.2 העתקת docs

```bash
mkdir -p docs/agents
cp ../voice-acp/docs/vnext-architecture.md docs/
cp ../voice-acp/docs/vnext-spec.md docs/
cp ../voice-acp/docs/vnext-research.md docs/
cp ../voice-acp/docs/slice-1-brief.md docs/
cp ../voice-acp/docs/agents/README.md docs/agents/
```

### 4.3 יצירת AGENTS.md

צור `AGENTS.md` ב-root לפי תוכן ב-§5 למטה.

### 4.4 יצירת files לפי תבניות ב-§3

צור כל הקבצים. אם יש קובץ שאתה לא בטוח לגביו (filename/path), חזור ל-Tama.

### 4.5 התקנת dependencies

```bash
pnpm install
```

⚠️ אם `pnpm` לא מותקן ב-PATH, השתמש ב-`npx pnpm install`.

⚠️ ייתכן ש-`@biomejs/biome@^2.0.0` עוד לא יצא רשמית — אם משהו נכשל, נסה `@latest`.

### 4.6 typecheck

```bash
pnpm typecheck
```

צריך לעבור נקי. אם לא — תקן typos ב-`tsconfig` או imports.

### 4.7 tests

```bash
pnpm test
```

צריך לעבור (2 בדיקות מ-§3.25).

### 4.8 lint

```bash
pnpm lint
```

אם יש warnings — תקן או add `// biome-ignore` עם הסבר.

### 4.9 הרץ backend

```bash
cd packages/backend
bun --watch src/server.ts
```

צריך להדפיס `[backend] listening on http://localhost:4000`.

בtest:
```bash
curl http://localhost:4000/api/health
# צריך להחזיר {"status":"ok","version":"0.0.0","uptime":...}
```

### 4.10 הרץ frontend

ב-shell נוסף:

```bash
cd packages/frontend
pnpm dev
```

צריך להדפיס `Local: http://localhost:5173/`.

### 4.11 בדיקה ידנית

פתח `http://localhost:5173` בדפדפן (curl לא יעזור — צריך JS).

- לחץ "Connect" → צריך לראות status: connected + `[opened]` בלוג
- לחץ "Send ping" → צריך לראות `→ {"type":"ping"}` ואז `← {"type":"pong","echoOf":"ping","serverTime":...}`

⚠️ אם אין דפדפן זמין — השתמש ב-`wscat` או `websocat` או script Node קצר. אבל ה-DoD דורש בדיקה ידנית בדפדפן.

### 4.12 קומיט

לאחר שכל ה-DoD עובר:

```bash
git add .
git commit -m "(slice-1): scaffold monorepo + echo WS עובד

- packages/core: ArkType schemas (Ping/Pong/Hello/Error)
- packages/backend: Hono + Bun.serve, /api/health + /ws/echo
- packages/frontend: SvelteKit + adapter-static, Connect+Ping page
- biome, vitest, tsconfig refs, pnpm workspaces
- DoD עבר: typecheck נקי, 2 בדיקות עוברות, echo WS עובד E2E"
```

---

## 5. תוכן AGENTS.md ל-worktree החדש

```markdown
# AGENTS.md — drive-coding

## Project

Voice-first hands-free interface for ACP-compatible CLI agents.
See `docs/vnext-architecture.md` for full spec.

## Stack

- TypeScript (ESM only, no CommonJS)
- Bun (Slice 1) + Node 22.5+ (Slice 2+)
- Hono (HTTP/WS)
- SvelteKit + adapter-static (frontend)
- ArkType (schemas), neverthrow (Result)
- Vitest (tests), Biome (lint+format)
- pnpm workspaces

## Structure

- `packages/core/` — pure logic, no IO. Tests TDD.
- `packages/backend/` — Hono + adapters. Integration tests.
- `packages/frontend/` — SvelteKit drive-first PWA.

## Conventions

- Strict TS: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- Functional core / imperative shell — pure in core, IO in backend.
- `Result<T, E>` (neverthrow) for fallible ops in core; throw only in shell.
- ArkType for all schemas — runtime validation + type inference.
- No `any` — use `unknown` + ArkType to refine.
- No deep `null` — `T | undefined` or Option pattern.

## Commands

```bash
pnpm install
pnpm dev              # all packages
pnpm test             # all tests
pnpm typecheck
pnpm lint
pnpm format
```

## What NOT to do

- No secrets in code (`.env` is gitignored)
- No CommonJS (`require`, `module.exports`)
- No adapters in `core/` — they live in `backend/adapters/`
- No browser globals in `core/`

## Reference

- `docs/vnext-architecture.md` — 50 decisions (D1-D50)
- `docs/vnext-spec.md` — protocol, schemas, ports, roadmap
- `docs/vnext-research.md` — competitor analysis, library research
- `docs/slice-X-brief.md` — current slice's implementation brief

## Working with Tama (planner)

If you hit any of these — **stop and ask Tama via the parent task**:
- Architectural decision not covered by D1-D50
- Spec ambiguity that affects > 50 lines of code
- A library/tool failing in a way that suggests our stack choice was wrong
- A test infrastructure gap

Otherwise: decide reasonably, document in commit message, continue.
```

---

## 6. Definition of Done — Slice 1

- [ ] worktree `voice-acp-v2` קיים על branch `vnext`
- [ ] `pnpm install` עובר נקי
- [ ] `pnpm typecheck` עובר נקי (3 packages: core, backend, frontend)
- [ ] `pnpm test` עובר נקי (2+ בדיקות ב-core)
- [ ] `pnpm lint` עובר נקי
- [ ] `bun --watch src/server.ts` מעלה backend על port 4000
- [ ] `GET /api/health` מחזיר JSON תקף
- [ ] `pnpm dev` ב-frontend מעלה Vite על port 5173
- [ ] פתיחת `http://localhost:5173` בדפדפן מציגה את הדף
- [ ] Connect → status מתחלף ל-`connected`, מופיע `[opened]` בלוג
- [ ] Send ping → מופיע `→ {"type":"ping"}` ואחריו `← {"type":"pong","echoOf":"ping","serverTime":N}`
- [ ] commit נכנס נקי

---

## 7. דיווח לסיום

לאחר שכל ה-DoD עבר, חזור ל-Tama עם:

1. **commit hash** של Slice 1
2. **כל בעיה שנתקלת בה** + איך פתרת
3. **מסקנות מהשלב** — האם משהו ב-spec דרוש update לפני Slice 2?
4. **שינויים מהbrief** — אם נאלצת לסטות מהוראה (גרסת חבילה שונה, וכו'), מה ולמה
5. **screenshot של הדף עם ping/pong** (אם זמין) — אופציונלי

---

## 8. מה Slice 1 לא כולל

- ACP, CLI, stdio-to-ws, Bridge — Slice 3
- AI SDK, voice — Slice 5
- Identity, dashboard, multi-agent — Slice 2
- Cloudflare tunnel, Docker, systemd — Slice 10
- Node compatibility — Slice 2
- כפתור גדול, audio cues — Slice 7

זה רק תשתית. תתפתה לעשות יותר — **אל תעשה.**
