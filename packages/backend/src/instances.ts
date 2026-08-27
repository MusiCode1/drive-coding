/**
 * instances.ts — on-disk registry of live drive-coding servers.
 *
 * Written AFTER listen (port is certain). Pruned by GET /api/health, not by pid.
 * Directory: $XDG_RUNTIME_DIR/drive-coding, else <stateDir>/instances/.
 */

import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { InstanceRecord as InstanceRecordSchema } from "@drive-coding/core/schemas/session-bus"
import { type } from "arktype"
import { getStateDir } from "./paths.js"

export type InstanceRecord = typeof InstanceRecordSchema.infer

const HEALTH_TIMEOUT_MS = 300

export function getInstancesDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_RUNTIME_DIR
  if (xdg !== undefined && xdg !== "") {
    return join(xdg, "drive-coding")
  }
  return join(getStateDir(), "instances")
}

export function writeInstance(
  record: InstanceRecord,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dir = getInstancesDir(env)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${record.port}.json`)
  writeFileSync(file, `${JSON.stringify(record)}\n`, "utf8")
  return file
}

export function removeInstance(port: number, env: NodeJS.ProcessEnv = process.env): void {
  const file = join(getInstancesDir(env), `${port}.json`)
  try {
    unlinkSync(file)
  } catch {
    // already gone
  }
}

export function isDriveCodingHealth(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false
  const o = body as Record<string, unknown>
  if (o.service === "drive-coding") return true
  return (
    typeof o.status === "string" && typeof o.version === "string" && typeof o.uptime === "number"
  )
}

async function probeHealth(record: InstanceRecord): Promise<boolean> {
  const scheme = record.https ? "https" : "http"
  const url = `${scheme}://${record.host}:${record.port}/api/health`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return false
    const body: unknown = await res.json()
    return isDriveCodingHealth(body)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function resolveInstances(
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstanceRecord[]> {
  const dir = getInstancesDir(env)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const live: InstanceRecord[] = []
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    const file = join(dir, name)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"))
    } catch {
      try {
        unlinkSync(file)
      } catch {
        // ignore
      }
      continue
    }
    if (!isInstanceRecord(parsed)) {
      try {
        unlinkSync(file)
      } catch {
        // ignore
      }
      continue
    }
    if (await probeHealth(parsed)) {
      live.push(parsed)
    } else {
      try {
        unlinkSync(file)
      } catch {
        // ignore
      }
    }
  }
  live.sort((a, b) => a.port - b.port)
  return live
}

function isInstanceRecord(value: unknown): value is InstanceRecord {
  return !(InstanceRecordSchema(value) instanceof type.errors)
}
