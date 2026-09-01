/**
 * read-process-rss.ts — child process RSS via /proc (Linux S1).
 *
 * See docs-for-llm/conventions/process-memory-platform.md.
 * Windows S1: returns null (no shell-out, no new deps).
 */

import { readFileSync } from "node:fs"

export type ProcessRssResult = { rssMB: number; source: "proc" }

/** Parse VmRSS from /proc/<pid>/status file contents. Exported for unit tests. */
export function parseVmRssFromProcStatus(content: string): ProcessRssResult | null {
  for (const line of content.split("\n")) {
    if (!line.startsWith("VmRSS:")) continue
    const match = line.match(/VmRSS:\s+(\d+)\s+kB/)
    if (!match?.[1]) return null
    const kb = Number(match[1])
    if (!Number.isFinite(kb) || kb <= 0) return null
    return { rssMB: Math.round(kb / 1024), source: "proc" }
  }
  return null
}

/**
 * Read resident set size for a child process pid.
 * Returns null when pid is invalid, stale, unmeasurable, or on Windows.
 */
export function readProcessRss(pid: number): ProcessRssResult | null {
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (process.platform === "win32") return null
  if (pid === process.pid) return null

  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8")
    return parseVmRssFromProcStatus(status)
  } catch {
    return null
  }
}
