/**
 * https-serve.test.ts — integration tests for HTTPS serve (commit 1).
 *
 * Starts the actual server via Bun subprocess, verifies HTTP and HTTPS modes.
 *
 * Coverage:
 *  1. HTTP mode (no DRIVE_CODING_HTTPS) — GET / returns 200
 *  2. HTTPS self-signed mode — GET / via curl -k returns 200
 *  3. HTTPS self-signed cert is written to state dir (idempotent)
 *
 * 🔴 הקובץ היה **אדום לצמיתות בכל מכונה שאינה אחת**: הוא קידד קשיח
 *    `D:/ProgramsAndApps/Bun/bin/bun.exe` ו-`D:/UserProjects/AI/…/https-local`,
 *    וגם תפס פורטים קבועים 4090/4091. על לינוקס — `spawn ENOENT`, תמיד.
 *    טסט אדום-לצמיתות מרעיל כל DoD שנשען על "הסוויטה ירוקה", כי הוא מאמן
 *    להתעלם מאדום. שלושת המקורות מנוטרלים כאן: הבינארי נפתר בזמן-ריצה,
 *    השורש נגזר ממיקום הקובץ, והפורטים מוקצים ע"י ה-OS.
 */

import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as http from "node:http"
import * as https from "node:https"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

// ‏באג #64: ‏זמן-העלייה הקר של ה-BE תחת vitest נמדד ב-**~3.5 שניות** (‏probe
// ‏עם סקר-פורט: ECONNREFUSED ב-t=1..3s, ‏HTTP 200 ב-t=4s, ‏"listening" ב-+3544ms),
// ‏מול תקציב שהיה 3000ms. ‏הפספוס של ~500ms הפיל את הקובץ **רק בהרצה מבודדת** —
// ‏בהרצה מלאה המטמונים חמים והעלייה נכנסת מתחת לתקציב, ולכן זה נראה "פלייקי".
// ‏`waitForServer` סוקר כל 300ms ומחזיר מיָדית בהצלחה ⇒ תקרה גבוהה **אינה** מאטה
// ‏את המסלול הבריא; היא רק מפסיקה להיכשל על מכונה איטית או מטמון קר.
const SERVER_TIMEOUT = 45_000
const STARTUP_WAIT = 30_000

function waitForServer(protocol: "http" | "https", port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tryConnect = () => {
      const req = (protocol === "https" ? https : http).request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/",
          method: "GET",
          rejectUnauthorized: false,
          timeout: 1000,
        },
        (res) => {
          res.resume()
          resolve()
        },
      )
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server on ${protocol}://127.0.0.1:${port} did not start in time`))
          return
        }
        setTimeout(tryConnect, 300)
      })
      req.end()
    }
    tryConnect()
  })
}

function httpGet(
  protocol: "http" | "https",
  port: number,
  path_: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = (protocol === "https" ? https : http).request(
      {
        hostname: "127.0.0.1",
        port,
        path: path_,
        method: "GET",
        rejectUnauthorized: false,
      },
      (res) => {
        let body = ""
        res.on("data", (chunk) => (body += chunk.toString()))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on("error", reject)
    req.end()
  })
}

/**
 * פתירת הבינארי של bun בזמן-ריצה. סדר: `BUN_BIN` מפורש (מתועד ב-
 * `docs/configuration.md`) → ה-executable הנוכחי אם הוא bun → סריקת PATH.
 * מחזיר null כשאין — ואז הסוויטה **מדולגת**, לא נכשלת: היעדר bun הוא מגבלת
 * סביבה, לא רגרסיה בקוד.
 */
function resolveBun(): string | null {
  const fromEnv = process.env.BUN_BIN
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv

  if (/(^|[\\/])bun(\.exe)?$/i.test(process.execPath) && fs.existsSync(process.execPath)) {
    return process.execPath
  }

  const exe = process.platform === "win32" ? "bun.exe" : "bun"
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, exe)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/** פורט חופשי מה-OS (listen על 0). קבוע ⇒ התנגשות עם כל מופע רץ. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      const port = typeof addr === "object" && addr !== null ? addr.port : 0
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error("no free port"))))
    })
  })
}

const BUN_PATH = resolveBun()
const SERVER_ENTRY = "packages/backend/src/server.ts"
// שורש הריפו נגזר ממיקום הקובץ: packages/backend/tests → ../../..
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

describe.skipIf(!BUN_PATH)("HTTP serve (no DRIVE_CODING_HTTPS)", () => {
  let proc: ReturnType<typeof spawn> | null = null
  let tmpHome: string
  let port: number

  beforeAll(async () => {
    port = await freePort()
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "https-serve-http-"))
    proc = spawn(BUN_PATH as string, [SERVER_ENTRY], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        HOME: tmpHome,
        USERPROFILE: tmpHome,
      },
      stdio: "pipe",
    })
    await waitForServer("http", port, STARTUP_WAIT)
  }, SERVER_TIMEOUT)

  afterAll(() => {
    proc?.kill("SIGTERM")
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true })
    } catch {
      /**/
    }
  })

  it("GET /api/agents returns 200 on HTTP (regression check)", async () => {
    const res = await httpGet("http", port, "/api/agents")
    expect(res.status).toBe(200)
  })
})

describe.skipIf(!BUN_PATH)("HTTPS serve (DRIVE_CODING_HTTPS=true, self-signed)", () => {
  let proc: ReturnType<typeof spawn> | null = null
  let tmpHome: string
  let port: number

  beforeAll(async () => {
    port = await freePort()
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "https-serve-tls-"))
    proc = spawn(BUN_PATH as string, [SERVER_ENTRY], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        DRIVE_CODING_HTTPS: "true",
        HOME: tmpHome,
        USERPROFILE: tmpHome,
      },
      stdio: "pipe",
    })
    await waitForServer("https", port, STARTUP_WAIT)
  }, SERVER_TIMEOUT)

  afterAll(() => {
    proc?.kill("SIGTERM")
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true })
    } catch {
      /**/
    }
  })

  it("GET /api/agents returns 200 over HTTPS (self-signed, rejectUnauthorized=false)", async () => {
    const res = await httpGet("https", port, "/api/agents")
    expect(res.status).toBe(200)
  })

  it("self-signed cert is written to state dir", async () => {
    const tlsDir = path.join(tmpHome, ".config", "drive-coding", "tls")
    expect(fs.existsSync(path.join(tlsDir, "key.pem"))).toBe(true)
    expect(fs.existsSync(path.join(tlsDir, "cert.pem"))).toBe(true)
  })
})
