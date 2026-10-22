/**
 * container-chrome.ts — כרום טרי בתוך קונטיינר linux-gui, דרך CDP.
 *
 * למה לא `chromium.launch()`: הורדה והרצה של דפדפן במארח חסומות ע"י
 * host-browser-guard (`~/.local/libexec/host-browser-guard/bin/`). ה-guard
 * מעביר כל `playwright <cmd>` שאינו `install` ל-playwright הגלובלי, ולכן
 * Playwright עצמו מותר — אסור רק הבינארי של הדפדפן.
 *
 * למה CDP מהמארח עובד בכלל: linux-gui רץ ב-`network_mode: host`, ולכן פורטי
 * הקונטיינר יושבים ישר על 127.0.0.1 של המארח. `docker port` מחזיר ריק לא
 * בגלל שאין מיפוי אלא בגלל שאין בו צורך.
 *
 * 🛑 פורט: 9222–9299 הוא הטווח שבו הדפדפן של הקונטיינר בוחר CDP לעצמו,
 * ו-9222 הוא הפרופיל המחובר (Google/SSO) ששותפים לו סשנים אחרים. הבדיקות
 * בוחרות פורט **מחוץ** לטווח — 9333 ומעלה, כקונבנציה ב-calev.
 *
 * 🛑 פרופיל: /tmp אינו משותף בין המארח לקונטיינר (נמדד), ולכן ספריית הפרופיל
 * נוצרת **בתוך** הקונטיינר. היא גם המזהה הייחודי שלפיו מנקים — הורגים רק את
 * התהליך שהפרופיל שלו הוא שלנו, ולא "כל כרום".
 */
import { execFileSync } from "node:child_process"
import { chromium, type Browser } from "@playwright/test"

const CONTAINER = process.env.LINUX_GUI_CONTAINER ?? "linux-gui"
const PORT_BASE = Number(process.env.E2E_CDP_PORT ?? "9333")
const PORT_TRIES = 12
const CDP_READY_MS = 20_000

/** 🛑 הפרופיל המחובר. בדיקה שתיגע בו תפגע בסשנים אחרים. */
const FORBIDDEN_PORTS = new Set([9222])

export type ContainerChrome = {
  browser: Browser
  cdpPort: number
  profileDir: string
  dispose: () => Promise<void>
}

function docker(args: string[], opts: { timeout?: number } = {}): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: opts.timeout ?? 20_000,
  })
}

export function containerRunning(): boolean {
  try {
    return docker(["inspect", CONTAINER, "--format", "{{.State.Running}}"]).trim() === "true"
  } catch {
    return false
  }
}

async function cdpAnswers(port: number, timeoutMs: number): Promise<boolean> {
  const ctl = AbortSignal.timeout(timeoutMs)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctl })
    return res.ok
  } catch {
    return false
  }
}

/** פורט פנוי מחוץ לטווח של הקונטיינר. "פנוי" = אף אחד לא עונה עליו. */
async function findFreePort(): Promise<number> {
  for (let i = 0; i < PORT_TRIES; i++) {
    const port = PORT_BASE + i
    if (FORBIDDEN_PORTS.has(port)) continue
    if (!(await cdpAnswers(port, 1500))) return port
  }
  throw new Error(`no free CDP port in ${PORT_BASE}..${PORT_BASE + PORT_TRIES - 1}`)
}

/** הורג רק תהליכים שה-cmdline שלהם מכיל את ספריית-הפרופיל שאנחנו יצרנו. */
function killByProfile(profileDir: string): number {
  let killed = 0
  try {
    const out = docker(["exec", CONTAINER, "ps", "-eo", "pid=,args="])
    for (const line of out.split("\n")) {
      if (!line.includes(profileDir)) continue
      const pid = line.trim().split(/\s+/)[0]
      if (!/^\d+$/.test(pid)) continue
      try {
        docker(["exec", CONTAINER, "kill", pid])
        killed++
      } catch {
        /* כבר מת */
      }
    }
  } catch {
    /* הקונטיינר ירד — אין מה לנקות */
  }
  return killed
}

export async function launchContainerChrome(): Promise<ContainerChrome> {
  if (!containerRunning()) {
    throw new Error(
      `container ${CONTAINER} is not running — start it before running e2e ` +
        `(see tests/e2e/README.md)`,
    )
  }

  const cdpPort = await findFreePort()
  const profileDir = docker([
    "exec", "--user", "abc", CONTAINER,
    "mktemp", "-d", "/tmp/e2e-chrome-XXXXXXXX",
  ]).trim()

  // ⚠️ בלי --remote-debugging-address: הוא מונע מ-Chrome לפתוח את פורט ה-CDP
  // בשקט (עולה, אבל אין מאזין ואין DevToolsActivePort). נמדד 18/10/2026.
  docker([
    "exec", "-d", "--user", "abc", CONTAINER,
    "google-chrome",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${cdpPort}`,
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "about:blank",
  ])

  const deadline = Date.now() + CDP_READY_MS
  let ready = false
  while (Date.now() < deadline) {
    if (await cdpAnswers(cdpPort, 2000)) {
      ready = true
      break
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  if (!ready) {
    killByProfile(profileDir)
    throw new Error(`CDP did not come up on 127.0.0.1:${cdpPort} within ${CDP_READY_MS}ms`)
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)

  return {
    browser,
    cdpPort,
    profileDir,
    dispose: async () => {
      try {
        await browser.close()
      } catch {
        /* ייתכן שהתהליך כבר מת */
      }
      // connectOverCDP + close() אינו מבטיח שהתהליך ייפול — מוודאים לפי הפרופיל.
      killByProfile(profileDir)
      try {
        docker(["exec", "--user", "abc", CONTAINER, "rm", "-rf", profileDir])
      } catch {
        /* /tmp בקונטיינר מתנקה בלאו הכי */
      }
    },
  }
}
