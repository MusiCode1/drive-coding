/**
 * נקודות קצה HTTP — תמיכה בהיסטוריית סשנים (fe-fetch-sessions מעודכן).
 *
 *   GET  /api/projects   — רשימת פרויקטים מוכרים (מה-registry)
 *   GET  /api/recordings/:id  — מגיש בתי אודיו גולמיים
 *   POST /api/recordings      — מעלה ושומר אודיו
 *   GET  /api/fs/browse?path= — רשימת ספריות (מאובטח)
 *
 * הוסר (fe-fetch-sessions):
 *   GET /api/projects/:cwdHash/sessions — סשנים עכשיו נמשכים בצד ה-FE דרך ACP WS
 *   GET /api/sessions                  — תצוגת איחוד הוסרה; ראה sessions-ws.ts ב-FE
 *
 * cwdHash = SHA-256(cwd) מקודד כ-base64url (בטוח ל-URL, ללא ריפוד).
 */

import { readdir, realpath } from "node:fs/promises"
import { relative, resolve } from "node:path"
import type { Hono } from "hono"
import type { ProjectsRegistry } from "../app/projects-registry.js"
import type { RecordingsStore } from "../app/recordings-store.js"

// ─── /api/projects ────────────────────────────────────────────────────────────

export function registerProjectsHttp(
  app: Hono,
  deps: {
    projectsRegistry: ProjectsRegistry
  },
): void {
  // GET /api/projects
  app.get("/api/projects", async (c) => {
    const projects = await deps.projectsRegistry.getProjects()
    return c.json({ projects })
  })
}

// ─── /api/recordings/:id ─────────────────────────────────────────────────────

export function registerRecordingsHttp(
  app: Hono,
  deps: { recordingsStore: RecordingsStore },
): void {
  app.get("/api/recordings/:id", async (c) => {
    const id = c.req.param("id")
    const recording = await deps.recordingsStore.get(id)

    if (!recording) {
      return c.json({ error: "recording not found" }, 404)
    }

    return new Response(recording.bytes, {
      status: 200,
      headers: { "Content-Type": recording.mimeType },
    })
  })
}

// ─── POST /api/recordings ─────────────────────────────────────────────────────

/**
 * POST /api/recordings — מעלה ושומר הקלטת אודיו.
 *
 * Slice 10 Phase 1: ה-FE מעלה אודיו ברקע במקביל לתמלול (STT).
 *
 * גוף הבקשה (Body): { audioBase64: string, mimeType: string }
 * תגובה (Response): { id: string }
 */
export function registerRecordingsPostHttp(
  app: Hono,
  deps: { recordingsStore: RecordingsStore },
): void {
  app.post("/api/recordings", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }

    const { audioBase64, mimeType } = body as Record<string, unknown>

    if (typeof audioBase64 !== "string" || !audioBase64) {
      return c.json({ error: "audioBase64 is required" }, 400)
    }
    if (typeof mimeType !== "string" || !mimeType) {
      return c.json({ error: "mimeType is required" }, 400)
    }

    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(Buffer.from(audioBase64, "base64"))
    } catch {
      return c.json({ error: "invalid base64" }, 400)
    }

    const { id } = await deps.recordingsStore.save(bytes, mimeType)
    return c.json({ id }, 201)
  })
}

// ─── /api/fs/browse ───────────────────────────────────────────────────────────

const HIDDEN_PREFIXES = [".git", ".opencode", ".svelte-kit", "node_modules", ".pnpm"]

/**
 * בודק אם נתיב הוא absolute — cross-platform.
 * ב-Unix: מתחיל ב-"/"
 * ב-Windows: כונן (C:\) או UNC (\\)
 * משמש לבדיקת containment עם path.relative.
 */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\")
}

/**
 * מנרמל פלט realpath של drive-root על Windows.
 * bun async `realpath("D:\\")` מחזיר "D:" (בלי separator), ואז readdir("D:") נכשל
 * ENOENT (drive-relative, לא root). מחזיר את ה-backslash לזיהוי drive-root.
 * anchor $ → רק "X:" מדויק (לא "D:\\Users"). Unix ("/home") ושאר נתיבים — ללא שינוי.
 */
export function normalizeRealpath(real: string): string {
  return /^[a-zA-Z]:$/.test(real) ? `${real}\\` : real
}

export function registerFsBrowseHttp(
  app: Hono,
  opts: {
    /**
     * שומר אבטחה opt-in: כשמוגדר, נתיבים מחוץ לבסיס זה מחזירים 403.
     * ניתן להגדיר גם דרך env FS_BROWSE_ALLOWED_BASE.
     * ברירת מחדל: undefined — מאפשר דפדוף בכל ה-filesystem (Q1 decision).
     * realpath נשמר תמיד (הגנת symlink).
     */
    allowedBase?: string
  } = {},
): void {
  // opt-in restriction: opts.allowedBase או env FS_BROWSE_ALLOWED_BASE.
  // undefined = allow-all (Q1 decision: ברירת מחדל מאפשרת הכל).
  const allowedBase = opts.allowedBase ?? process.env.FS_BROWSE_ALLOWED_BASE

  app.get("/api/fs/browse", async (c) => {
    const rawPath = c.req.query("path")
    if (!rawPath) {
      return c.json({ error: "path query param is required" }, 400)
    }
    const showHidden = c.req.query("showHidden") === "true"

    // המרה לנתיב אבסולוטי ואז realpath למעקב אחר סימלינקים (הגנת symlink — תמיד)
    const normalized = resolve(rawPath)
    let real: string
    try {
      real = normalizeRealpath(await realpath(normalized))
    } catch {
      return c.json({ error: "path not found" }, 404)
    }

    // אבטחה opt-in: בדיקת הכלה רק כש-allowedBase מוגדר.
    // שימוש ב-path.relative (cross-platform): בתוך הבסיס ⟺ relative אינו מתחיל ב-".."
    // ואינו absolute (מטפל ב-"\" וב-"/").
    if (allowedBase !== undefined) {
      const safeBase = await realpath(allowedBase).catch(() => allowedBase)
      if (real !== safeBase) {
        const rel = relative(safeBase, real)
        const isOutside = rel.startsWith("..") || isAbsolutePath(rel)
        if (isOutside) {
          return c.json({ error: "access denied" }, 403)
        }
      }
    }

    let dirents: import("node:fs").Dirent<string>[]
    try {
      dirents = await readdir(real, { withFileTypes: true, encoding: "utf8" })
    } catch {
      return c.json({ error: "cannot read directory" }, 500)
    }

    const entries = dirents
      .filter((d) => showHidden || !HIDDEN_PREFIXES.some((prefix) => d.name.startsWith(prefix)))
      .map((d) => ({
        name: d.name,
        isDir: d.isDirectory() || d.isSymbolicLink(), // מתייחס לסימלינקים כניתנים לניווט
      }))
      .sort((a, b) => {
        // ספריות קודם, אחר כך קבצים, ואז סדר אלפביתי
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    return c.json({ path: real, entries })
  })
}
