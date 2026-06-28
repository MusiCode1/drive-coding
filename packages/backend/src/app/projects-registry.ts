/**
 * ProjectsRegistry — מאגר JSON מבוסס-דיסק של נתיבי פרויקטים מוכרים.
 *
 * Slice 8a: עוקב אחרי כל cwd שהשרת ראה, מקוטלג לפי (cwd, kind).
 * נשמר אל `<baseDir>/projects-registry.json` — שורד הפעלות מחדש של השרת.
 * ממוין לפי lastSeen בסדר יורד כשמוחזר.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { BridgeKind } from "@drive-coding/core"

export type ProjectEntry = {
  readonly cwd: string
  readonly kind: BridgeKind
  readonly lastSeen: string // ISO 8601
  readonly lastSessionId?: string
  readonly hidden?: boolean // הסתרה קבועה (לא מוחזר ב-getProjects) — slice recent-projects-controls
}

type RegistryFile = {
  readonly projects: ProjectEntry[]
}

export function createProjectsRegistry(baseDir: string) {
  const filePath = join(baseDir, "projects-registry.json")

  async function load(): Promise<ProjectEntry[]> {
    try {
      const text = await readFile(filePath, "utf8")
      const data = JSON.parse(text) as RegistryFile
      return Array.isArray(data.projects) ? data.projects : []
    } catch {
      return []
    }
  }

  async function persist(projects: readonly ProjectEntry[]): Promise<void> {
    await mkdir(baseDir, { recursive: true })
    const data: RegistryFile = { projects: [...projects] }
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf8")
  }

  return {
    /** מתעד ש-cwd היה בשימוש. יוצר או מעדכן את הרשומה. */
    async recordCwd(cwd: string, kind: BridgeKind): Promise<void> {
      const projects = await load()
      const idx = projects.findIndex((p) => p.cwd === cwd)
      const lastSeen = new Date().toISOString()

      if (idx >= 0) {
        const updated = [...projects]
        updated[idx] = { ...projects[idx]!, cwd, kind, lastSeen }
        await persist(updated)
      } else {
        await persist([...projects, { cwd, kind, lastSeen }])
      }
    },

    /** מעדכן את ה-lastSessionId עבור cwd קיים. לא עושה כלום אם ה-cwd אינו מוכר. */
    async recordSession(cwd: string, sessionId: string): Promise<void> {
      const projects = await load()
      const idx = projects.findIndex((p) => p.cwd === cwd)
      if (idx < 0) return

      const updated = [...projects]
      updated[idx] = { ...projects[idx]!, lastSessionId: sessionId }
      await persist(updated)
    },

    /**
     * מסתיר תיקייה מרשימת הפרויקטים (hidden=true).
     * אם ה-cwd אינו קיים — no-op (כמו recordSession).
     * slice: recent-projects-controls
     */
    async hideCwd(cwd: string): Promise<void> {
      const projects = await load()
      const idx = projects.findIndex((p) => p.cwd === cwd)
      if (idx < 0) return // unknown cwd → no-op
      const updated = [...projects]
      updated[idx] = { ...projects[idx]!, hidden: true }
      await persist(updated)
    },

    /** מחזיר את כל הפרויקטים המוכרים (לא מוסתרים), ממוינים לפי lastSeen יורד (הכי חדש ראשון). */
    async getProjects(): Promise<readonly ProjectEntry[]> {
      const projects = await load()
      return [...projects]
        .filter((p) => p.hidden !== true) // מסנן מוסתרות — slice recent-projects-controls
        .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
    },
  }
}

export type ProjectsRegistry = ReturnType<typeof createProjectsRegistry>
