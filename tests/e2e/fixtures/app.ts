/**
 * app.ts — יעד הבדיקות: BE אחד שמגיש גם את ה-FE הבנוי.
 *
 * למה פורט אחד ולא שניים: ה-BE מגיש את תוצר הבנייה של ה-FE
 * (`packages/backend/src/boot/app.ts` → `serving static FE`), ולכן אין צורך
 * ב-Vite dev server. זה גם קרוב יותר לפרודקשן, וגם מייתר את המלכודת שבה
 * `FE_URL=http://localhost:5173` היה ברירת-מחדל שגויה — פורט ה-dev של Vite
 * מוקצה ע"י ה-OS (`packages/frontend/vite.config.ts`: "port: OS-assigned").
 *
 * 🛑 פורטים: 4000 הוא ה-BE של הסוכן עצמו ולעולם לא נוגעים בו. אנחנו בוחרים
 * פורט פנוי מ-4120 ומעלה, ומורידים רק את התהליך שאנחנו השקנו.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

const PORT_BASE = Number(process.env.E2E_BE_PORT ?? "4120")
const PORT_TRIES = 20
const BOOT_MS = 120_000

/** 🛑 ה-BE של הסוכן. */
const FORBIDDEN_PORTS = new Set([4000])

export type AppTarget = {
  baseURL: string
  /** true כשהשתמשנו במופע חי שלא אנחנו הרמנו — ולכן גם לא נוריד. */
  external: boolean
  dispose: () => Promise<void>
}

function portFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const srv = createServer()
    srv.once("error", () => res(false))
    srv.once("listening", () => srv.close(() => res(true)))
    srv.listen(port, "127.0.0.1")
  })
}

async function findFreePort(): Promise<number> {
  for (let i = 0; i < PORT_TRIES; i++) {
    const port = PORT_BASE + i
    if (FORBIDDEN_PORTS.has(port)) continue
    if (await portFree(port)) return port
  }
  throw new Error(`no free BE port in ${PORT_BASE}..${PORT_BASE + PORT_TRIES - 1}`)
}

async function healthy(baseURL: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/** בונה את ה-FE רק אם התוצר אינו תואם ל-HEAD. אידמפוטנטי וזול בהרצה חוזרת. */
function buildFrontendIfStale(): void {
  execFileSync("node", ["scripts/dc-build-fe.mjs", "--if-stale"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    timeout: 600_000,
  })
}

export async function startApp(): Promise<AppTarget> {
  const existing = process.env.E2E_BASE_URL
  if (existing) {
    if (!(await healthy(existing, 5000))) {
      throw new Error(`E2E_BASE_URL=${existing} did not answer GET /api/health`)
    }
    return { baseURL: existing, external: true, dispose: async () => {} }
  }

  buildFrontendIfStale()

  const port = await findFreePort()
  const baseURL = `http://127.0.0.1:${port}`

  const child: ChildProcess = spawn(
    "bun",
    ["packages/backend/src/bin/drive-coding.ts", "--host", "127.0.0.1"],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )

  const log: string[] = []
  child.stdout?.on("data", (b) => log.push(String(b)))
  child.stderr?.on("data", (b) => log.push(String(b)))

  let exited = false
  child.once("exit", () => {
    exited = true
  })

  const deadline = Date.now() + BOOT_MS
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`BE exited during boot. log:\n${log.join("").slice(-4000)}`)
    }
    if (await healthy(baseURL, 2000)) {
      return {
        baseURL,
        external: false,
        dispose: async () => {
          if (child.pid && !exited) {
            child.kill("SIGTERM")
            await new Promise((r) => setTimeout(r, 2000))
            if (!exited) child.kill("SIGKILL")
          }
        },
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  child.kill("SIGKILL")
  throw new Error(`BE did not become healthy on ${baseURL} within ${BOOT_MS}ms. log:\n${log.join("").slice(-4000)}`)
}
