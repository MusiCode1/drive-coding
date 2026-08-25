/**
 * http-fs-file.ts — HTTP endpoint שמגיש קובץ מקומי לפי URI (slice fs-file-proxy).
 *
 * GET /api/fs/file?uri=<file:// | absolute path>
 *
 * מודל-איום (זהה להערת מודל-האיום בראש http-cli-logo.ts ול-/api/fs/browse): ל-BE אין שכבת-אימות,
 * ו-POST /api/agents כבר מרים תהליך CLI בכל cwd. ⇒ הגבלת-נתיבים כאן **אינה**
 * גבול-אבטחה, והיא שוברת את התרחיש שביקש המשתמש (docs-for-llm הוא symlink אל
 * ~/Projects/docs-repo — מחוץ ל-cwd). realpath = פתרון-symlink, לא הגנת-traversal.
 *
 * 🔴 מה כן גבול אמיתי — **הפרוקסי לעולם לא מגיש text/html**. קובץ HTML שיוגש
 * מה-origin שלנו ירוץ בתוכו (same-origin script). לכן .html/.htm/.xhtml/.svgz
 * **אינם** ב-map, ואין sniffing: הסיומת קובעת את ה-Content-Type. לא-מוכר → 415.
 */

import { readFile, realpath, stat } from "node:fs/promises"
import { extname, relative, resolve } from "node:path"
import type { Hono } from "hono"
import { isAbsolutePath, normalizeRealpath } from "./http-history.js"

const MAX_FILE_BYTES = 8 * 1024 * 1024 // 8MB

/**
 * 🔴 allowlist סגור. אין כאן — ולעולם לא יהיה — text/html או כל סוג שמריץ קוד
 * ב-origin שלנו. הוספת סיומת חדשה מחייבת לשאול: "האם הדפדפן מריץ אותה?"
 */
const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
}

export function registerFsFileHttp(
  app: Hono,
  opts: {
    /**
     * 🔴 דלתא 4 — פרמטר, לא רק env. שומר אבטחה opt-in: כשמוגדר, נתיבים מחוץ
     * לבסיס → 403. ניתן להגדיר גם דרך env FS_FILE_ALLOWED_BASE.
     * ברירת-מחדל undefined = allow-all (זהה להכרעת Q1 של /api/fs/browse).
     * הפרמטר קיים כדי שהטסט השלילי יהיה בר-הרצה בלי restart של התהליך.
     */
    allowedBase?: string
  } = {},
): void {
  const allowedBase = opts.allowedBase ?? process.env.FS_FILE_ALLOWED_BASE

  app.get("/api/fs/file", async (c) => {
    const uri = c.req.query("uri")
    if (!uri) return c.json({ error: "uri query param is required" }, 400)

    // 🔴 guard מפורש — ה-BE לעולם לא מושך URL מטעם ה-client (SSRF).
    // אותו **דפוס** כמו guard ה-"remote logo URLs" ב-http-cli-logo.ts, ולפני כל
    // resolve/realpath. 🔴 שים לב (ממצא-אביגיל 7): התקדים מחזיר **404**; כאן
    // **400** — ובכוונה. שם ה-URL מגיע מקונפיג מהימן ולכן "לא נמצא" נכון; כאן
    // הוא מגיע מהבקשה ולכן זו **בקשה פסולה**. אל "תיישר" ל-404.
    if (/^https?:\/\//i.test(uri)) {
      return c.json({ error: "remote URLs are not served by the backend" }, 400)
    }

    // 1. file:// URI → נתיב אבסולוטי.
    // 🔴 דלתא 6 — decodeURIComponent זורק URIError על percent-encoding פגום
    // (נמדד: "%zz" → URIError). לא-עטוף = 500 במקום 400.
    let rawPath: string
    if (uri.startsWith("file://")) {
      try {
        rawPath = decodeURIComponent(uri.slice("file://".length))
      } catch {
        return c.json({ error: "malformed uri" }, 400)
      }
    } else if (isAbsolutePath(uri)) {
      rawPath = uri
    } else {
      return c.json({ error: "invalid uri" }, 400)
    }

    // 🔴 ממצא-אביגיל 8 — ה-slice("file://") אינו URL-parsing. שתי תוצאות:
    //   · "file://relative.md" לא היה עובר ב-isAbsolutePath ⇒ resolve מול cwd של ה-BE
    //   · "file:///C:/x.md" מתפרק על Windows, למרות שאנחנו מייבאים דווקא את שני
    //     ה-helpers מודעי-Windows.
    // לכן: **אותה בדיקת-אבסולוטיות חלה גם על ענף ה-file://**. אין מסלול שעוקף אותה.
    if (!isAbsolutePath(rawPath)) {
      return c.json({ error: "uri must resolve to an absolute path" }, 400)
    }

    // 2. allowlist סיומות — לפני כל IO. הסיומת קובעת את ה-Content-Type; אין sniffing.
    const ext = extname(rawPath).toLowerCase()
    const contentType = EXT_TO_CONTENT_TYPE[ext]
    if (contentType === undefined) {
      return c.json({ error: "unsupported file type" }, 415)
    }

    // 3. realpath — פתרון-symlink + בדיקת-קיום.
    let real: string
    try {
      real = normalizeRealpath(await realpath(resolve(rawPath)))
    } catch {
      return c.json({ error: "file not found" }, 404)
    }

    // 4. 🔴 דלתא 2 — הכלה opt-in. מועתק אחד-לאחד מבלוק ה-"access denied" ב-http-history.ts.
    if (allowedBase !== undefined) {
      const safeBase = await realpath(allowedBase).catch(() => allowedBase)
      if (real !== safeBase) {
        const rel = relative(safeBase, real)
        if (rel.startsWith("..") || isAbsolutePath(rel)) {
          return c.json({ error: "access denied" }, 403)
        }
      }
    }

    // 5. תקרת-גודל
    let size: number
    try {
      size = (await stat(real)).size
    } catch {
      return c.json({ error: "file not found" }, 404)
    }
    if (size > MAX_FILE_BYTES) {
      return c.json({ error: "file too large" }, 413)
    }

    // 6. הגשה.
    // 🔴 דלתא 5 — r2 כתב `{…}.filter(…)` על אובייקט-ליטרל. נמדד:
    // TypeError: ({a:"1"}).filter is not a function ⇒ כל 200 היה נופל ל-500.
    // הבנייה כאן היא Record רגיל + השמה מותנית.
    const bytes = new Uint8Array(await readFile(real))
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      // bytes.length ולא size מ-stat — הקובץ יכול להשתנות בין stat ל-readFile.
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-cache",
      // 🔴 מונע רינדור-כדף גם אם סוג כלשהו יפורש כ-HTML ע"י דפדפן סורר.
      "X-Content-Type-Options": "nosniff",
    }
    if (ext === ".svg") {
      // 🔴 ממצא-אביגיל 9 — טווח מדויק: ה-CSP מגן **רק על ניווט ישיר** ל-endpoint.
      // במסלול ה-FE (fetch → blob:) ה-headers של ה-response **נזרקים**, ולכן ה-CSP
      // אינו נוסע עם ה-blob. זה לא חור: SVG ב-<img> רץ ב-secure-static-mode ממילא.
      headers["Content-Security-Policy"] = "script-src 'none'; sandbox"
    }

    return new Response(bytes, { status: 200, headers })
  })
}
