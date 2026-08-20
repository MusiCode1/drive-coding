/**
 * dc.ts — `window.__dc`: משטח-תצפית קריא בלבד, זמין ב-dev **וגם בפריוויו**.
 *
 * למה זה קיים: אבחון `bugs/41` ארך שעה, והנתון החוסם (`lastVersion` של הלקוח)
 * לא היה נגיש בשום דרך — ה-hook היחיד שהיה מגודר ב-`import.meta.env.DEV`,
 * שהוא **false בכל בילד**, כולל `build:preview`.
 *
 * שלושה כללים:
 *   1. קריאה-בלבד. תמונות-מצב שטוחות, לעולם לא רפרנס חי. אין setters.
 *   2. אסור שקוד-מוצר יסתמך על זה. משטח-ניפוי, לא API.
 *   3. מגודר בזמן-בילד (`PUBLIC_APP_ENV !== "prod"`) — נעדר לגמרי מייצור.
 */

import { connEvents } from "$lib/util/conn-log"
import { listViews, type ViewDebugInfo } from "./session-registry"

type ServerState = { version: number; messages: number } | { error: string }

async function fetchServer(agentId: string): Promise<ServerState> {
  try {
    const r = await fetch(`/api/agents/${agentId}/state`, { cache: "no-store" })
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const d = (await r.json()) as { version: number; messages: unknown[] }
    return { version: d.version, messages: d.messages.length }
  } catch (e) {
    return { error: String(e) }
  }
}

/**
 * ⭐ ההשוואה שהייתה חוסכת את אבחון #41: מה הלקוח מחזיק מול מה שבשרת,
 * ו**המסקנה במילים** — לא רק מספרים.
 */
async function diff() {
  const views = listViews()
  if (views.length === 0) return { verdict: "no live view (WS transport? not connected?)" }
  const out = []
  for (const v of views) {
    const server = await fetchServer(v.agentId)
    let verdict: string
    if ("error" in server) {
      verdict = `⚠️ no server state: ${server.error}`
    } else if (server.version < v.lastVersion) {
      verdict =
        `🔴 REJECT — snapshot ${server.version} < lastVersion ${v.lastVersion}. ` +
        "every frame will be dropped (see bugs/41 — page reload cures it)."
    } else if (server.version === v.lastVersion) {
      verdict = "🟢 in sync — nothing newer on the server."
    } else {
      verdict = `🟡 server ahead by ${server.version - v.lastVersion} — should catch up.`
    }
    out.push({ client: v, server, verdict })
  }
  return out.length === 1 ? out[0] : out
}

export type DcSurface = {
  diff: typeof diff
  session: () => ViewDebugInfo | ViewDebugInfo[] | null
  instances: () => number
  conn: (n?: number) => ReturnType<typeof connEvents>
  dump: () => Promise<string>
}

export function installDebugSurface(): void {
  if (typeof window === "undefined") return
  const surface: DcSurface = {
    diff,
    session: () => {
      const v = listViews()
      // noUncheckedIndexedAccess: v[0] הוא T|undefined גם כשהאורך 1
      return v.length === 0 ? null : (v.length === 1 ? (v[0] ?? null) : v)
    },
    /** יותר מ-1 ⇒ ממצא: מופע כפול אחרי reconnect. */
    instances: () => listViews().length,
    conn: (n = 40) => connEvents().slice(-n),
    dump: async () =>
      JSON.stringify(
        { at: new Date().toISOString(), diff: await diff(), conn: connEvents().slice(-60) },
        null,
        1,
      ),
  }
  ;(window as unknown as { __dc: DcSurface }).__dc = surface
  console.info("[dc] debug surface ready: __dc.diff() · __dc.session() · __dc.conn() · __dc.dump()")
}
