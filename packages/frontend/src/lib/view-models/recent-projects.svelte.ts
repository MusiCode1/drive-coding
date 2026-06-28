/**
 * recent-projects.svelte.ts — VM לרשימת התיקיות האחרונות.
 *
 * מנהל: טעינה, שגיאה, רענון.
 * מעביר ל-RecentProjectsPanel דרך context.
 *
 * slice: connect-recent-projects
 * דפוס: חיקוי מדויק של ActiveAgents (active-agents.svelte.ts).
 */
import { listRecentProjects, hideRecentProject, type RecentProject } from "$lib/adapters/recent-projects"

export class RecentProjects {
  projects = $state<RecentProject[]>([])
  loading = $state(false)
  error = $state<string | null>(null)

  refresh = async (): Promise<void> => {
    this.loading = true
    this.error = null
    try {
      this.projects = await listRecentProjects()
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    } finally {
      this.loading = false
    }
  }

  // ─── מחיקה (הסתרה קבועה) ─── (slice recent-projects-controls)

  /**
   * מסתיר פרויקט מהרשימה (optimistic: מסיר מיד מה-UI, קורא ל-BE ב-async).
   * בכשל: rollback ל-projects הקודם + error.
   */
  hide = async (cwd: string): Promise<void> => {
    const prev = this.projects
    this.projects = this.projects.filter((p) => p.cwd !== cwd) // optimistic remove
    try {
      await hideRecentProject(cwd)
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
      this.projects = prev // rollback
    }
  }
}
