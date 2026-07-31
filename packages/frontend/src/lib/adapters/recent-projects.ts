/**
 * recent-projects.ts — אדפטר עבור קבלת רשימת תיקיות אחרונות.
 *
 * קורא GET /api/projects → { projects: ProjectEntry[] } (ממוין lastSeen יורד).
 * ה-endpoint קיים ב-BE (http-history.ts registerProjectsHttp) — אין צורך בשינוי BE.
 *
 * slice: connect-recent-projects
 */

import { beUrl } from "$lib/util/be-url"

/** רשומת פרויקט מ-GET /api/projects (משקף את ProjectEntry של ה-BE). */
export type RecentProject = {
  cwd: string
  kind: string
  lastSeen: string // ISO 8601
  lastSessionId?: string
}

/**
 * מוחק תיקייה מרשימת התיקיות האחרונות (DELETE /api/projects).
 * חיבור חוזר לאחר מכן ידרך recordCwd ויוצר רשומה חדשה.
 * slice: recent-projects-controls
 */
export async function removeRecentProject(cwd: string): Promise<void> {
  const res = await fetch(beUrl("/api/projects"), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd }),
  })
  if (!res.ok) throw new Error(`remove project failed: ${res.status}`)
}

/** מחזיר את התיקיות האחרונות (ממוין lastSeen יורד — ה-BE כבר ממיין). */
export async function listRecentProjects(signal?: AbortSignal): Promise<RecentProject[]> {
  const res = await fetch(beUrl("/api/projects"), { signal })
  if (!res.ok) throw new Error(`projects failed: ${res.status}`)
  const body = (await res.json()) as { projects?: unknown[] }
  return (body.projects ?? []).map(normalizeRecentProject)
}

function normalizeRecentProject(p: unknown): RecentProject {
  const item = p as Record<string, unknown>
  return {
    cwd: String(item["cwd"] ?? ""),
    // ⚠️ ברירת-המחדל "claude" ממציאה ספק כשאין kind — נשאר לטיפול ב-Commit 4 (§9 Q2).
    kind: String(item["kind"] ?? "claude"),
    lastSeen: String(item["lastSeen"] ?? ""),
    lastSessionId: item["lastSessionId"] ? String(item["lastSessionId"]) : undefined,
  }
}
