/**
 * wire-recorder.ts — הקלטת tap פסיבית של תעבורת ה-WS לקובץ NDJSON.
 *
 * כל session של agent מקבל קובץ `<dir>/<agentId>-<ts>.jsonl`; כל frame שעובר
 * ב-pipe (שני הכיוונים) נכתב כשורה אחת `{ts, dir, raw}`. הכלי משמש לדיבוג של
 * חריגות ACP (chunks ריקים, הודעות כפולות). ר' slice-wire-recorder-jsonl.
 *
 * עיקרון: ה-recorder לעולם לא זורק ולא חוסם את ה-pipe — כל IO עטוף ב-try/catch,
 * וכש-dir===null ה-recorder הוא no-op מוחלט (אפס IO).
 */
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs"
import { join } from "node:path"

export type WireDir = "in" | "out"

/** Pure: serialize רשומת wire אחת לשורת NDJSON (כולל \n בסוף). */
export function serializeWireRecord(ts: number, dir: WireDir, raw: string): string {
  return `${JSON.stringify({ ts, dir, raw })}\n`
}

export type WireSession = {
  /** כותב frame בודד. לעולם לא זורק. no-op אם ה-recorder כבוי/נסגר. */
  record(dir: WireDir, raw: string): void
  /** סוגר את ה-write stream. לעולם לא זורק. אידמפוטנטי. */
  close(): void
}

export type WireRecorder = {
  /** פותח session חדש (קובץ) ל-agentId נתון. כש-dir===null → session no-op. */
  open(agentId: string): WireSession
}

const NOOP_SESSION: WireSession = { record() {}, close() {} }

/**
 * createWireRecorder — factory.
 * @param opts.dir   תיקיית יעד, או null ל-no-op מוחלט (WIRE_RECORD לא מוגדר).
 * @param opts.now   מקור ts (להזרקה בטסטים). default: Date.now.
 */
export function createWireRecorder(opts: { dir: string | null; now?: () => number }): WireRecorder {
  const now = opts.now ?? (() => Date.now())
  if (opts.dir === null) {
    return { open: () => NOOP_SESSION }
  }
  const dir = opts.dir
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // אם אי אפשר ליצור תיקייה — נפול ל-no-op כדי לא לשבור את ה-pipe
    return { open: () => NOOP_SESSION }
  }
  return {
    open(agentId: string): WireSession {
      let stream: WriteStream | null = null
      try {
        stream = createWriteStream(join(dir, `${agentId}-${now()}.jsonl`), { flags: "a" })
        stream.on("error", () => {
          stream = null
        }) // דיסק מלא וכו' → השתק
      } catch {
        return NOOP_SESSION
      }
      return {
        record(d: WireDir, raw: string): void {
          if (stream === null) return
          try {
            stream.write(serializeWireRecord(now(), d, raw))
          } catch {
            // לעולם אל תיתן להקלטה לשבור את ה-pipe
          }
        },
        close(): void {
          try {
            stream?.end()
          } catch {
            // כבר סגור
          }
          stream = null
        },
      }
    },
  }
}
