/**
 * recent-projects.svelte.ts — VM לרשימת התיקיות האחרונות.
 *
 * מנהל: טעינה, שגיאה, רענון.
 * מעביר ל-RecentProjectsPanel דרך context.
 *
 * slice: connect-recent-projects
 * דפוס: חיקוי מדויק של ActiveAgents (active-agents.svelte.ts).
 */
import { listRecentProjects, type RecentProject } from "$lib/adapters/recent-projects"

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
}
