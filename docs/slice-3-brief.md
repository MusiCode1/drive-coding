# Slice 3 — Implementation Brief

> **מטרה:** BridgeManager שמפעיל `@rebornix/stdio-to-ws` עבור כל agent חדש. ה-agent.status מתעדכן מ-`starting` → `ready` (או `crashed`).
> **תלות:** Slice 2 (✅ commit `985f174`).
> **המתחיל:** Yolo executor (Sonnet 4-6) ב-`/home/user/projects/voice-acp-v2`.

---

## 1. החלטות שננעלו ל-Slice 3

| נושא | בחירה |
|------|--------|
| **Bridge** | `@rebornix/stdio-to-ws` דרך `npx` (D33) |
| **CLI כברירת מחדל** | `opencode` — אצל אבי ב-`/home/user/.opencode/bin/opencode acp`. נשים את ה-path ב-config (אם לא ב-PATH) |
| **Ports allocation** | OS-assigned (port=0). נpars את ה-port מ-stdout של stdio-to-ws |
| **Process supervisor** | spawn ישיר ב-Node `child_process.spawn` — כשhe-backend מת, ה-bridge עדיין חי (`--persist --grace-period -1`) |
| **Storage** | in-memory `Map<agentId, BridgeHandle>` (D8) |
| **Crash detection** | listener על `process.exit`. עדכון `agent.status = "crashed"` ב-registry |
| **WS connection ל-bridge** | **לא ב-Slice 3** — רק spawn ו-port detection. WS connection ל-bridge יהיה ב-Slice 4 (AcpTransport) |
| **agent.status flow** | POST /api/agents → status=`starting` → spawn → port detected → status=`ready`. failure → `crashed` |
| **Frontend** | מציג status חי. עם polling פשוט (כל 2 שניות) — WS עדכוני status ב-Slice 4 |

---

## 2. מה נוסף

### 2.1 Schemas — `packages/core/src/schemas/`

אין שינוי. ה-`Agent.bridgePort` כבר קיים ב-schema (Slice 2).

### 2.2 Ports — `packages/core/src/ports.ts`

**חדש**: `BridgeManager` interface.

### 2.3 Backend

**חדש**:
- `packages/backend/src/acp/bridge-spawn.ts` — pure-ish helper לבניית args + parsing port מ-stdout.
- `packages/backend/src/acp/bridge-manager.ts` — implements `BridgeManager`. wraps child_process + in-memory Map.
- `packages/backend/src/acp/cli-config.ts` — מיפוי `CliKind` → command.

**עדכון**:
- `packages/backend/src/agents/registry.ts` — לא משתנה. ה-orchestration ב-app/agent-orchestrator.ts.
- `packages/backend/src/delivery/http-agents.ts` — POST יתחיל לעבוד עם BridgeManager. DELETE יקטע את ה-bridge.
- `packages/backend/src/server.ts` — wire BridgeManager + orchestrator.

**חדש**:
- `packages/backend/src/app/agent-orchestrator.ts` — מתאם בין AgentRegistry ל-BridgeManager.

### 2.4 Frontend

**מינימלי**:
- `packages/frontend/src/routes/+page.svelte` — הוסף polling כל 2 שניות אם יש agents ב-status="starting".
- `packages/frontend/src/routes/agent/[id]/+page.svelte` — הוסף polling.

---

## 3. תבניות קוד מדויקות

### 3.1 `packages/core/src/ports.ts` (עדכון — הוסף BridgeManager)

```typescript
import type { Agent, CreateAgentInput } from "./schemas"

// קיים מ-Slice 2:
export interface AgentRegistry {
  create(input: CreateAgentInput): Promise<Agent>
  get(id: string): Promise<Agent | null>
  list(): Promise<ReadonlyArray<Agent>>
  update(id: string, patch: Partial<Pick<Agent, "status" | "bridgePort" | "acpSessionId">>): Promise<Agent>
  delete(id: string): Promise<void>
}

// ─── חדש ב-Slice 3 ──────────────────────────────

export type BridgeKind = "opencode" | "claude" | "gemini" | "codex"

export type SpawnBridgeInput = {
  readonly cliKind: BridgeKind
  readonly cwd: string
  readonly modelOverride: string | null
}

export type BridgeHandle = {
  readonly bridgeId: string         // UUID, אותו שייך לagent id
  readonly cliKind: BridgeKind
  readonly cwd: string
  readonly port: number             // OS-assigned, parsed מ-stdout
  readonly pid: number              // PID של תהליך ה-bridge
  readonly wsUrl: string            // ws://127.0.0.1:<port>/
  readonly startedAt: Date
}

export type SpawnError =
  | { readonly kind: "cli_not_found"; readonly message: string }
  | { readonly kind: "spawn_failed"; readonly message: string }
  | { readonly kind: "port_parse_timeout"; readonly message: string }
  | { readonly kind: "unknown"; readonly message: string }

/**
 * BridgeManager — manages stdio-to-ws bridges per agent.
 * Each bridge wraps a CLI agent (opencode/claude/...) and exposes WS.
 * Bridges שורדים נפילת backend (--persist).
 * הregistry בזיכרון — נאבד ב-backend restart (D8).
 */
export interface BridgeManager {
  /** spawn `@rebornix/stdio-to-ws "<cli> acp" --port 0 --persist --grace-period -1`. */
  spawn(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandle>

  /** מקבל handle. null אם לא קיים. */
  get(bridgeId: string): BridgeHandle | null

  /** רשימה של bridges חיים. */
  list(): ReadonlyArray<BridgeHandle>

  /** kill graceful — SIGTERM ל-stdio-to-ws (שיהרוג את ה-CLI). מחזיר true אם נהרג, false אם לא קיים. */
  kill(bridgeId: string): Promise<boolean>

  /** subscribe ל-crash events. callback נקרא כש-bridge מת לבד. */
  onCrash(handler: (bridgeId: string, exitCode: number | null) => void): () => void
}
```

### 3.2 `packages/backend/src/acp/cli-config.ts` (חדש)

```typescript
import type { BridgeKind } from "@drive-coding/core"

/**
 * מיפוי CliKind ל-command + args ל-`@rebornix/stdio-to-ws`.
 * Slice 3: רק opencode. שאר ה-CLIs יוסיפו ב-Slice עתידי.
 */
export type CliCommand = {
  readonly bin: string         // executable path or name
  readonly args: ReadonlyArray<string>
}

export function getCliCommand(kind: BridgeKind): CliCommand {
  switch (kind) {
    case "opencode":
      // אצל אבי ב-/home/user/.opencode/bin/opencode (D14 — Proxmox)
      // נסה bin in PATH ראשון, אחרת fallback.
      return {
        bin: process.env.OPENCODE_BIN ?? "opencode",
        args: ["acp"],
      }
    case "claude":
      return {
        bin: "npx",
        args: ["-y", "@agentclientprotocol/claude-agent-acp@latest"],
      }
    case "gemini":
      return {
        bin: "npx",
        args: ["-y", "@google/gemini-cli@latest", "--experimental-acp"],
      }
    case "codex":
      return {
        bin: "npx",
        args: ["-y", "@zed-industries/codex-acp@latest"],
      }
  }
}

/**
 * Args ל-stdio-to-ws שיעטוף את ה-CLI.
 * הCLI command מועבר כstring יחיד (stdio-to-ws עושה parse).
 */
export function buildStdioToWsArgs(cli: CliCommand, port = 0): ReadonlyArray<string> {
  const cliCommand = [cli.bin, ...cli.args].join(" ")
  return [
    "-y",
    "@rebornix/stdio-to-ws",
    cliCommand,
    "--port",
    String(port),
    "--persist",
    "--grace-period",
    "-1",
  ]
}
```

### 3.3 `packages/backend/src/acp/bridge-spawn.ts` (חדש)

```typescript
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"

/**
 * Parses port מ-stdout של stdio-to-ws.
 * הPattern: "Listening on ws://127.0.0.1:<port>/" או דומה.
 * Returns number or null.
 */
export function parsePortFromStdout(line: string): number | null {
  // Pattern דוגמאות שעלולים להופיע:
  //   "Listening on ws://127.0.0.1:7100/"
  //   "ws://localhost:7100"
  //   "Server started on port 7100"
  const wsMatch = line.match(/ws:\/\/[\d.]+:(\d+)/)
  if (wsMatch) return Number(wsMatch[1])

  const portMatch = line.match(/(?:port|listening on)\s+(?:port\s+)?(\d{4,5})/i)
  if (portMatch) return Number(portMatch[1])

  return null
}

export type SpawnOptions = {
  readonly bin: string                    // 'npx' או 'bunx'
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
  readonly portTimeoutMs?: number         // default 30000
}

export type SpawnResult = {
  readonly child: ChildProcessWithoutNullStreams
  readonly port: number
  readonly pid: number
}

/**
 * Spawn stdio-to-ws + reads stdout until port is detected.
 * Throws if port not detected within timeoutMs or process exits.
 */
export async function spawnAndWaitForPort(opts: SpawnOptions): Promise<SpawnResult> {
  const timeout = opts.portTimeoutMs ?? 30000

  const child = spawn(opts.bin, [...opts.args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (!child.pid) {
    throw new Error("spawn returned no pid")
  }

  return new Promise<SpawnResult>((resolve, reject) => {
    let resolved = false
    let stdoutBuf = ""
    let stderrBuf = ""

    const timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true
        child.kill("SIGTERM")
        reject(new Error(
          `Port not detected within ${timeout}ms. stdout: ${stdoutBuf.slice(0, 500)} | stderr: ${stderrBuf.slice(0, 500)}`,
        ))
      }
    }, timeout)

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8")
      stdoutBuf += text
      if (resolved) return

      // נסה לחלץ port מכל שורה חדשה
      for (const line of text.split("\n")) {
        const port = parsePortFromStdout(line)
        if (port !== null) {
          resolved = true
          clearTimeout(timeoutHandle)
          resolve({ child, port, pid: child.pid! })
          return
        }
      }
    })

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8")
    })

    child.on("exit", (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeoutHandle)
        reject(new Error(
          `Process exited (code=${code}) before port detected. stdout: ${stdoutBuf.slice(0, 500)} | stderr: ${stderrBuf.slice(0, 500)}`,
        ))
      }
    })

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeoutHandle)
        reject(err)
      }
    })
  })
}
```

### 3.4 `packages/backend/tests/bridge-spawn.test.ts` (TDD)

```typescript
import { describe, it, expect } from "vitest"
import { parsePortFromStdout } from "../src/acp/bridge-spawn"

describe("parsePortFromStdout", () => {
  it("parses ws:// URL", () => {
    expect(parsePortFromStdout("Listening on ws://127.0.0.1:7100/")).toBe(7100)
  })

  it("parses ws://localhost", () => {
    expect(parsePortFromStdout("ws://localhost:7100")).toBe(7100)
  })

  it("parses 'listening on port'", () => {
    expect(parsePortFromStdout("Server listening on port 7100")).toBe(7100)
  })

  it("parses 'port X'", () => {
    expect(parsePortFromStdout("running on port 7100")).toBe(7100)
  })

  it("returns null for unrelated", () => {
    expect(parsePortFromStdout("starting up...")).toBeNull()
    expect(parsePortFromStdout("")).toBeNull()
    expect(parsePortFromStdout("warning: deprecated flag")).toBeNull()
  })

  it("handles multiple ports — returns first ws://", () => {
    expect(parsePortFromStdout("ws://127.0.0.1:7100/ alt port 9999")).toBe(7100)
  })
})
```

### 3.5 `packages/backend/src/acp/bridge-manager.ts` (חדש)

```typescript
import type { ChildProcess } from "node:child_process"
import type {
  BridgeHandle,
  BridgeManager,
  SpawnBridgeInput,
} from "@drive-coding/core"
import { buildStdioToWsArgs, getCliCommand } from "./cli-config"
import { spawnAndWaitForPort } from "./bridge-spawn"

type Entry = {
  readonly handle: BridgeHandle
  readonly child: ChildProcess
}

export function createBridgeManager(): BridgeManager {
  const store = new Map<string, Entry>()
  const crashHandlers = new Set<(bridgeId: string, exitCode: number | null) => void>()

  function notifyCrash(bridgeId: string, exitCode: number | null): void {
    for (const handler of crashHandlers) {
      try {
        handler(bridgeId, exitCode)
      } catch (e) {
        console.error("[bridge-manager] crash handler threw:", e)
      }
    }
  }

  return {
    async spawn(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandle> {
      if (store.has(bridgeId)) {
        throw new Error(`Bridge ${bridgeId} already exists`)
      }

      const cli = getCliCommand(input.cliKind)
      const args = buildStdioToWsArgs(cli, 0)  // OS-assigned port

      // Use npx by default (universal Node+Bun per D45)
      const bin = "npx"

      const result = await spawnAndWaitForPort({
        bin,
        args,
        cwd: input.cwd,
        portTimeoutMs: 30000,
      })

      const handle: BridgeHandle = {
        bridgeId,
        cliKind: input.cliKind,
        cwd: input.cwd,
        port: result.port,
        pid: result.pid,
        wsUrl: `ws://127.0.0.1:${result.port}/`,
        startedAt: new Date(),
      }

      store.set(bridgeId, { handle, child: result.child })

      // Crash listener
      result.child.on("exit", (code) => {
        store.delete(bridgeId)
        notifyCrash(bridgeId, code)
      })

      return handle
    },

    get(bridgeId: string): BridgeHandle | null {
      return store.get(bridgeId)?.handle ?? null
    },

    list(): ReadonlyArray<BridgeHandle> {
      return [...store.values()].map((e) => e.handle)
    },

    async kill(bridgeId: string): Promise<boolean> {
      const entry = store.get(bridgeId)
      if (!entry) return false

      return new Promise((resolve) => {
        const onExit = () => {
          store.delete(bridgeId)
          resolve(true)
        }
        entry.child.once("exit", onExit)
        entry.child.kill("SIGTERM")

        // Force kill after 5s
        setTimeout(() => {
          if (store.has(bridgeId)) {
            entry.child.kill("SIGKILL")
          }
        }, 5000)
      })
    },

    onCrash(handler) {
      crashHandlers.add(handler)
      return () => {
        crashHandlers.delete(handler)
      }
    },
  }
}
```

### 3.6 `packages/backend/tests/bridge-manager.test.ts` (integration עם mock spawn)

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createBridgeManager } from "../src/acp/bridge-manager"

// Mock node:child_process.spawn — נחזיר child mock עם stdout/stderr emitters
vi.mock("node:child_process", () => {
  const { EventEmitter } = require("node:events")
  return {
    spawn: vi.fn((bin: string, args: string[]) => {
      const child: any = new EventEmitter()
      child.pid = 12345
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = vi.fn(() => {
        setTimeout(() => child.emit("exit", 0), 10)
      })

      // Simulate stdio-to-ws output: emit port after small delay
      setTimeout(() => {
        child.stdout.emit("data", Buffer.from("Listening on ws://127.0.0.1:7100/\n"))
      }, 20)

      return child
    }),
  }
})

describe("BridgeManager (integration with mock spawn)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("spawns and returns handle with parsed port", async () => {
    const mgr = createBridgeManager()
    const handle = await mgr.spawn("agent-1", {
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    expect(handle.bridgeId).toBe("agent-1")
    expect(handle.port).toBe(7100)
    expect(handle.wsUrl).toBe("ws://127.0.0.1:7100/")
    expect(handle.cliKind).toBe("opencode")
  })

  it("get returns handle after spawn", async () => {
    const mgr = createBridgeManager()
    await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    expect(mgr.get("a-1")?.port).toBe(7100)
  })

  it("returns null for unknown bridgeId", () => {
    const mgr = createBridgeManager()
    expect(mgr.get("unknown")).toBeNull()
  })

  it("list returns all bridges", async () => {
    const mgr = createBridgeManager()
    await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    await mgr.spawn("a-2", { cliKind: "claude", cwd: "/foo", modelOverride: null })
    expect(mgr.list()).toHaveLength(2)
  })

  it("throws when spawning duplicate bridgeId", async () => {
    const mgr = createBridgeManager()
    await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    await expect(
      mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
    ).rejects.toThrow(/already exists/)
  })

  it("kill removes bridge from registry", async () => {
    const mgr = createBridgeManager()
    await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    const killed = await mgr.kill("a-1")
    expect(killed).toBe(true)
    expect(mgr.get("a-1")).toBeNull()
  })

  it("kill returns false for unknown", async () => {
    const mgr = createBridgeManager()
    expect(await mgr.kill("unknown")).toBe(false)
  })

  it("crash handler called on unexpected exit", async () => {
    const mgr = createBridgeManager()
    const onCrash = vi.fn()
    mgr.onCrash(onCrash)

    const handle = await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    
    // Get the mocked child and force it to exit
    const { spawn } = await import("node:child_process")
    const mockChild = vi.mocked(spawn).mock.results[0]?.value as any
    mockChild.emit("exit", 1)

    await new Promise((r) => setTimeout(r, 20))
    expect(onCrash).toHaveBeenCalledWith("a-1", 1)
  })
})
```

### 3.7 `packages/backend/src/app/agent-orchestrator.ts` (חדש)

```typescript
import type { AgentRegistry, BridgeManager, CreateAgentInput } from "@drive-coding/core"
import type { Agent } from "@drive-coding/core"

export type AgentOrchestrator = {
  /** create an agent (registry) + spawn bridge. On failure, agent.status='crashed'. */
  createAndSpawn(input: CreateAgentInput): Promise<Agent>

  /** delete agent + kill bridge. */
  deleteAndKill(id: string): Promise<void>
}

export function createAgentOrchestrator(deps: {
  registry: AgentRegistry
  bridgeManager: BridgeManager
}): AgentOrchestrator {
  // Wire crash handler: כש-bridge מת בלי שביקשנו, סמן agent כ-crashed
  deps.bridgeManager.onCrash(async (bridgeId, exitCode) => {
    try {
      const existing = await deps.registry.get(bridgeId)
      if (existing && existing.status !== "closed") {
        await deps.registry.update(bridgeId, { status: "crashed" })
        console.warn(`[orchestrator] bridge ${bridgeId} crashed with code ${exitCode}`)
      }
    } catch (e) {
      console.error("[orchestrator] failed to update status on crash:", e)
    }
  })

  return {
    async createAndSpawn(input: CreateAgentInput): Promise<Agent> {
      // 1. Create with status='starting'
      const agent = await deps.registry.create(input)
      await deps.registry.update(agent.id, { status: "starting" })

      // 2. Spawn bridge (async — לא חוסם את ה-create response)
      // אבל בעצם — אנחנו כן ממתינים, כדי שהsmoke test יראה ready. אם זה לוקח יותר מ-30s, נכשל.
      try {
        const handle = await deps.bridgeManager.spawn(agent.id, {
          cliKind: input.cliKind,
          cwd: input.cwd,
          modelOverride: input.modelOverride ?? null,
        })

        // 3. Update with port + ready
        const updated = await deps.registry.update(agent.id, {
          status: "ready",
          bridgePort: handle.port,
        })
        return updated
      } catch (e) {
        // spawn נכשל — סמן כ-crashed
        await deps.registry.update(agent.id, { status: "crashed" })
        throw new Error(
          `Failed to spawn bridge for agent ${agent.id}: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    },

    async deleteAndKill(id: string): Promise<void> {
      const agent = await deps.registry.get(id)
      if (!agent) return

      // Update status first
      try {
        await deps.registry.update(id, { status: "closed" })
      } catch {
        // ignore
      }

      // Kill bridge
      await deps.bridgeManager.kill(id)

      // Remove from registry
      try {
        await deps.registry.delete(id)
      } catch {
        // ignore (already deleted)
      }
    },
  }
}
```

### 3.8 `packages/backend/src/delivery/http-agents.ts` (עדכון — להשתמש ב-orchestrator)

```typescript
import type { Hono } from "hono"
import { type } from "arktype"
import {
  CreateAgentInput,
  toAgentPublic,
  type AgentRegistry,
} from "@drive-coding/core"
import type { AgentOrchestrator } from "../app/agent-orchestrator"

export function registerAgentsHttp(
  app: Hono,
  deps: { registry: AgentRegistry; orchestrator: AgentOrchestrator },
): void {
  app.get("/api/agents", async (c) => {
    const all = await deps.registry.list()
    return c.json({ agents: all.map(toAgentPublic) })
  })

  app.post("/api/agents", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }

    const parsed = CreateAgentInput(body)
    if (parsed instanceof type.errors) {
      return c.json({ error: parsed.summary }, 400)
    }

    try {
      const agent = await deps.orchestrator.createAndSpawn(parsed)
      return c.json({ agent: toAgentPublic(agent) }, 201)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return c.json({ error: msg }, 500)
    }
  })

  app.get("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    const agent = await deps.registry.get(id)
    if (!agent) return c.json({ error: "agent not found" }, 404)
    return c.json({ agent: toAgentPublic(agent) })
  })

  app.delete("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    const existing = await deps.registry.get(id)
    if (!existing) return c.json({ error: "agent not found" }, 404)

    await deps.orchestrator.deleteAndKill(id)
    return c.body(null, 204)
  })
}
```

### 3.9 `packages/backend/tests/http-agents.test.ts` (עדכון)

ה-tests צריכים mock ל-orchestrator. הוסף את ה-mock המתאים:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { Hono } from "hono"
import { createInMemoryAgentRegistry } from "../src/agents/registry"
import { registerAgentsHttp } from "../src/delivery/http-agents"
import type { AgentOrchestrator } from "../src/app/agent-orchestrator"
import type { Agent } from "@drive-coding/core"

function makeApp() {
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()

  // Mock orchestrator — stub createAndSpawn ל-status ready ישר
  const orchestrator: AgentOrchestrator = {
    async createAndSpawn(input) {
      const agent = await registry.create(input)
      const updated = await registry.update(agent.id, {
        status: "ready",
        bridgePort: 7100,
      })
      return updated
    },
    async deleteAndKill(id) {
      await registry.delete(id).catch(() => {})
    },
  }

  registerAgentsHttp(app, { registry, orchestrator })
  return { app, registry, orchestrator }
}

// שאר ה-tests כמו ב-Slice 2 אבל עם makeApp החדש
// ... (העתק tests מ-Slice 2 כאן + הוסף test ל-status=ready עם bridgePort)

describe("POST /api/agents — orchestrated", () => {
  it("creates agent with status=ready and bridgePort", async () => {
    const { app } = makeApp()
    const res = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cliKind: "opencode", cwd: "/tmp" }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.agent.status).toBe("ready")
    // bridgePort לא ב-AgentPublic — בודק רק שאין error
  })
})
```

### 3.10 `packages/backend/src/server.ts` (עדכון — wire orchestrator)

```typescript
import { Hono } from "hono"
import { cors } from "hono/cors"
import { createInMemoryAgentRegistry } from "./agents/registry"
import { createBridgeManager } from "./acp/bridge-manager"
import { createAgentOrchestrator } from "./app/agent-orchestrator"
import { registerHttp } from "./delivery/http"
import { registerAgentsHttp } from "./delivery/http-agents"
import { registerEchoWs } from "./delivery/ws-echo"

const app = new Hono()
app.use("*", cors({ origin: ["http://localhost:5173"], credentials: true }))

// Boot dependencies
const registry = createInMemoryAgentRegistry()
const bridgeManager = createBridgeManager()
const orchestrator = createAgentOrchestrator({ registry, bridgeManager })

// HTTP routes
registerHttp(app)
registerAgentsHttp(app, { registry, orchestrator })

// WS routes
const echo = registerEchoWs(app)

const port = Number(process.env.PORT ?? 4000)

Bun.serve({
  port,
  fetch: (req, server) => {
    const url = new URL(req.url)
    if (url.pathname === "/ws/echo") {
      const upgraded = server.upgrade(req)
      if (upgraded) return
      return new Response("WS upgrade failed", { status: 426 })
    }
    return app.fetch(req)
  },
  websocket: echo.websocket,
})

console.log(`[backend] listening on http://localhost:${port}`)
```

### 3.11 `packages/frontend/src/routes/+page.svelte` (עדכון — polling)

הוסף polling כל 2 שניות אם יש agents ב-`status="starting"`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from "svelte"
  import type { AgentPublic } from "@drive-coding/core"
  import { listAgents, deleteAgent } from "$lib/api/agents"

  let agents = $state<AgentPublic[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function load(): Promise<void> {
    loading = true
    error = null
    try {
      const { agents: list } = await listAgents()
      agents = [...list].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      )
      schedulePoll()
    } catch (e) {
      error = e instanceof Error ? e.message : "טעינה נכשלה"
    } finally {
      loading = false
    }
  }

  function schedulePoll(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    // Poll only if any agent is starting
    const hasStarting = agents.some((a) => a.status === "starting")
    if (hasStarting) {
      pollTimer = setInterval(async () => {
        try {
          const { agents: fresh } = await listAgents()
          agents = [...fresh].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          // Stop polling if no more starting
          if (!agents.some((a) => a.status === "starting") && pollTimer) {
            clearInterval(pollTimer)
            pollTimer = null
          }
        } catch {
          // silent — keep polling
        }
      }, 2000)
    }
  }

  async function remove(id: string): Promise<void> {
    if (!confirm("למחוק את הסוכן?")) return
    try {
      await deleteAgent(id)
      await load()
    } catch (e) {
      error = e instanceof Error ? e.message : "מחיקה נכשלה"
    }
  }

  onMount(load)
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
  })
</script>

<!-- שאר ה-template נשאר כמו ב-Slice 2 -->
```

---

## 4. Step-by-step

1. `cd /home/user/projects/voice-acp-v2`
2. **Ports**: עדכן `packages/core/src/ports.ts` עם `BridgeManager` + types (§3.1). `pnpm typecheck`.
3. **CLI config**: צור `packages/backend/src/acp/cli-config.ts` (§3.2).
4. **Spawn helper + test**:
   - צור `packages/backend/src/acp/bridge-spawn.ts` (§3.3)
   - צור `packages/backend/tests/bridge-spawn.test.ts` (§3.4) — 6 tests על `parsePortFromStdout`
   - `pnpm test` — חדש ירוק
5. **BridgeManager + test**:
   - צור `packages/backend/src/acp/bridge-manager.ts` (§3.5)
   - צור `packages/backend/tests/bridge-manager.test.ts` (§3.6) — 8 tests עם mock spawn
   - `pnpm test`
6. **Orchestrator**: צור `packages/backend/src/app/agent-orchestrator.ts` (§3.7)
7. **HTTP endpoints — wire orchestrator**:
   - עדכן `packages/backend/src/delivery/http-agents.ts` (§3.8)
   - עדכן `packages/backend/tests/http-agents.test.ts` (§3.9)
8. **Server**: עדכן `packages/backend/src/server.ts` (§3.10)
9. **Frontend polling**: עדכן `packages/frontend/src/routes/+page.svelte` + `agent/[id]/+page.svelte` עם polling (§3.11)
10. **Lint + typecheck + tests**: `pnpm typecheck && pnpm test && pnpm lint`
11. **Smoke test idle** (בלי לspawn אמיתי):
   - הפעל backend
   - `curl http://localhost:4000/api/agents` → empty
12. **Smoke test עם opencode** (אופציונלי — אם אבי תיקן OPENCODE_BIN):
   - `OPENCODE_BIN=/home/user/.opencode/bin/opencode bun --watch packages/backend/src/server.ts`
   - `curl -X POST .../api/agents -d '{"cliKind":"opencode","cwd":"/tmp"}'`
   - **אם נכשל** עם "spawn ENOENT" — תעד והמשך. ה-smoke מלא יעשה ב-Slice 4 או ידנית של אבי.
13. **Commit**: `git add . && git commit -m "(slice-3): BridgeManager + spawn stdio-to-ws"`

---

## 5. Definition of Done

- [ ] `packages/core/src/ports.ts` כולל `BridgeManager` + types
- [ ] `packages/backend/src/acp/cli-config.ts` עם CliKind→command mapping
- [ ] `packages/backend/src/acp/bridge-spawn.ts` עם `parsePortFromStdout` + `spawnAndWaitForPort`
- [ ] `packages/backend/src/acp/bridge-manager.ts` עם `createBridgeManager`
- [ ] `packages/backend/src/app/agent-orchestrator.ts` עם `createAgentOrchestrator`
- [ ] HTTP `POST /api/agents` מקרא orchestrator — agent יוצר עם `status=starting` ואז `ready` (כשbridge עולה)
- [ ] `DELETE /api/agents/:id` הורג את ה-bridge
- [ ] `pnpm typecheck` נקי (3 packages)
- [ ] `pnpm test` נקי (כל ה-tests מ-Slice 2 + 6+8 חדשות מ-Slice 3 + עדכוני http = 50+ tests)
- [ ] `pnpm lint` נקי
- [ ] `curl /api/agents` עם backend חי עובד
- [ ] commit עם הודעה מפורטת

---

## 6. Slice 3 לא כולל

- **WebSocket connection ל-bridge** — Slice 4 (AcpTransport).
- **ACP handshake (initialize, session/new)** — Slice 4.
- **Voice** — Slice 5.
- **Crash recovery / auto-respawn** — future.
- **Bridge orphan cleanup ב-restart** — future (§9 pt.5 ב-spec).

---

## 7. דיווח לסיום

החזר ל-Tama:
1. commit hash
2. DoD checklist
3. סטיות מ-brief
4. תוצאות `pnpm test` (כמה tests, כולם עוברים?)
5. אם יש שגיאה ב-spawn האמיתי — תיעוד מדויק (stdout/stderr)

**זמן צפוי:** 25-40 דקות.

---

## 8. הוראה ל-Yolo executor

אתה רץ ב-yolo mode. אם נתקע בdetail (למשל arg של `npx` שונה ממה שתיכננתי) — תקן בעצמך לפי שיקול. אל תיצור Identity/Auth/DB. אם ה-spawn האמיתי נכשל בlocal testing (npx לא מוצא, opencode עצמו לא רץ), זה OK — תעד והמשך. ה-smoke E2E אמיתי יעשה ידנית.
