/**
 * fs-browser-store.svelte.ts — Phase 11.
 *
 * UI state for the FilePicker modal — backend filesystem browser.
 * Navigates via /api/fs/browse?path=
 */

export type FsEntry = {
  name: string
  isDir: boolean
}

export function createFsBrowserStore(initialPath = "/home/user") {
  let currentPath = $state(initialPath)
  let entries = $state<FsEntry[]>([])
  let history = $state<string[]>([]) // navigation stack for "back"
  let loading = $state(false)
  let error = $state<string | null>(null)

  async function browse(path: string): Promise<void> {
    loading = true
    error = null
    try {
      const res = await fetch(`/api/fs/browse?path=${encodeURIComponent(path)}`)
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `browse failed: ${res.status}`)
      }
      const data = (await res.json()) as { path: string; entries: FsEntry[] }
      // Keep only directories
      entries = data.entries.filter((e) => e.isDir)
      currentPath = data.path
    } catch (e) {
      error = e instanceof Error ? e.message : "שגיאה בגלישה"
    } finally {
      loading = false
    }
  }

  /** Navigate into a child directory. */
  async function enter(name: string): Promise<void> {
    history = [...history, currentPath]
    await browse(`${currentPath}/${name}`)
  }

  /** Navigate back to parent. */
  async function back(): Promise<void> {
    const prev = history[history.length - 1]
    if (prev === undefined) return
    history = history.slice(0, -1)
    await browse(prev)
  }

  /** Navigate to parent directory (parent of currentPath). */
  async function goParent(): Promise<void> {
    const parent = currentPath.split("/").slice(0, -1).join("/") || "/"
    if (parent === currentPath) return
    history = [...history, currentPath]
    await browse(parent)
  }

  return {
    get currentPath() {
      return currentPath
    },
    get entries() {
      return entries
    },
    get loading() {
      return loading
    },
    get error() {
      return error
    },
    get canGoBack() {
      return history.length > 0
    },
    browse,
    enter,
    back,
    goParent,
  }
}
