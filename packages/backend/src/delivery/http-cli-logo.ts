/**
 * http-cli-logo.ts — HTTP endpoint שמגיש קובץ-לוגו של CLI (slice cli-logo-serving).
 *
 * GET /api/cli-logo/:cliId
 *
 * 🔴 id-keyed, לא path-keyed (§3 בבריף). ה-client שולח מזהה, לא נתיב. הנתיב נשלף
 * מה-CliSpec הממוזג (getCliSpec — קלט מהימן, קובץ-קונפיג) ולעולם לא מגיע מהבקשה.
 * זהו בדיוק הדפוס של GET /api/recordings/:id (http-history.ts) — התקדים היחיד
 * בריפו להזרמת bytes, id-keyed מאותה סיבה.
 *
 * הערת מודל-איום: קובץ הקונפ' הוא קלט מהימן (מי ששולט בו כבר שולט ב-bin ומריץ
 * תהליכים שרירותיים) — לכן אין כאן בדיקת-הכלה (containment) כמו ב-/api/fs/browse.
 * ה-realpath כאן הוא פתרון-נתיב + בדיקת-קיום בלבד, לא הגנת-traversal.
 * traversal ב-logo (../../etc/passwd) מגיע מהקונפ' המהימן, לא מהבקשה — לא באג אבטחה,
 * אבל עדיין עובר את בדיקות הסיומת/גודל הרגילות (ולכן במקרה הנפוץ ייכשל 415/404).
 *
 * 🔴 לוגו מרוחק (Commit 3, בקשת משתמשת): אם `spec.logo` הוא URL (http/https) —
 * ה-endpoint הזה **אף פעם** לא מנסה לפתור/למשוך אותו. הדפדפן (ה-FE) מושך URL
 * מרוחק ישירות (`isRemoteLogo()` ב-`cli-display.ts`, `<img src={logo}>`). אם
 * בקשה עדיין מגיעה לכאן עם logo מרוחק — 404 מפורש **לפני** כל resolve/realpath,
 * כדי לא לפתוח משטח-SSRF (ה-BE לעולם לא מושך URL מטעם ה-client).
 */

import { readFile, realpath, stat } from "node:fs/promises"
import { dirname, extname, resolve } from "node:path"
import { getCliSpec, resolveCliSpecsPath } from "@drive-coding/provider/config"
import type { Hono } from "hono"
import { isAbsolutePath } from "./http-history.js"

const MAX_LOGO_BYTES = 1024 * 1024 // 1MB (DoD #7, §9 Q3)

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

export function registerCliLogoHttp(app: Hono): void {
  app.get("/api/cli-logo/:cliId", async (c) => {
    const cliId = c.req.param("cliId")

    const spec = getCliSpec(cliId, process.env)
    if (spec === undefined) {
      return c.json({ error: "unknown CLI" }, 404)
    }

    const logo = spec.logo
    if (logo === undefined) {
      return c.json({ error: "CLI has no logo" }, 404)
    }

    // 🔴 guard מפורש (Commit 3) — לוגו מרוחק (http/https) לא אמור להגיע לכאן
    // בכלל (ה-FE מציג אותו ישירות דרך <img src={logo}>, ר' isRemoteLogo ב-FE),
    // אבל אל תסמוך על כך. **אין לנסות לפתור URL כנתיב-קובץ** — זה היה מייצר
    // path מוזר (resolve עושה string-join, לא URL-parsing) ופתח משטח-SSRF
    // בעקיפין אם מתישהו יתווסף sniffing/fetch. עצור כאן, לפני resolve/realpath.
    if (/^https?:\/\//i.test(logo)) {
      return c.json({ error: "remote logo URLs are not served by the backend" }, 404)
    }

    // הנתיב לעולם לא מגיע מהבקשה — רק מ-spec.logo (הקונפ' המהימן).
    // 🔴 שימוש ב-isAbsolutePath של הריפו (לא path.isAbsolute) — מטפל גם ב-drive
    // של Windows וב-UNC.
    const rawPath = isAbsolutePath(logo)
      ? logo
      : resolve(dirname(resolveCliSpecsPath(process.env)), logo)

    // allowlist סיומות — נבדק לפני קריאת-דיסק. הסיומת קובעת את ה-Content-Type; אין sniffing.
    const ext = extname(rawPath).toLowerCase()
    const contentType = EXT_TO_CONTENT_TYPE[ext]
    if (contentType === undefined) {
      return c.json({ error: "unsupported logo file type" }, 415)
    }

    // realpath — פתרון-נתיב + בדיקת-קיום בלבד. אין כאן בדיקת-הכלה (ר' §3 בבריף):
    // הנתיב מגיע מהקונפ' המהימן, לא מהבקשה. כשל (לא קיים / לא ניתן לקריאה) → 404.
    let real: string
    try {
      real = await realpath(rawPath)
    } catch {
      return c.json({ error: "logo file not found" }, 404)
    }

    let size: number
    try {
      size = (await stat(real)).size
    } catch {
      return c.json({ error: "logo file not found" }, 404)
    }

    if (size > MAX_LOGO_BYTES) {
      return c.json({ error: "logo file too large" }, 413)
    }

    const bytes = new Uint8Array(await readFile(real))

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // no-cache ולא immutable — המשתמש עשוי להחליף את הקובץ (§4 Commit 0)
        "Cache-Control": "no-cache",
      },
    })
  })
}
