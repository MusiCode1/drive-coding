/**
 * ProjectsRegistry — disk-backed JSON store of known project cwds.
 *
 * Slice 8a: tracks every cwd the backend has seen, keyed by (cwd, kind).
 * Persisted to `<baseDir>/projects-registry.json` — survives backend restarts.
 * Sorted by lastSeen DESC when returned.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { BridgeKind } from "@drive-coding/core"

export type ProjectEntry = {
  readonly cwd: string
  readonly kind: BridgeKind
  readonly lastSeen: string // ISO 8601
  readonly lastSessionId?: string
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
    /** Record that a cwd was used. Creates or updates the entry. */
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

    /** Update the lastSessionId for an existing cwd. No-op if cwd unknown. */
    async recordSession(cwd: string, sessionId: string): Promise<void> {
      const projects = await load()
      const idx = projects.findIndex((p) => p.cwd === cwd)
      if (idx < 0) return

      const updated = [...projects]
      updated[idx] = { ...projects[idx]!, lastSessionId: sessionId }
      await persist(updated)
    },

    /** Returns all known projects, sorted by lastSeen DESC (newest first). */
    async getProjects(): Promise<readonly ProjectEntry[]> {
      const projects = await load()
      return [...projects].sort(
        (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
      )
    },
  }
}

export type ProjectsRegistry = ReturnType<typeof createProjectsRegistry>
