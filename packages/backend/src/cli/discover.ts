import type { InstanceRecord } from "@drive-coding/core/schemas/session-bus"
import { resolveInstances } from "../instances.js"

export type DiscoverOk = { ok: true; base: string; instances: InstanceRecord[] }
export type DiscoverErr = {
  ok: false
  kind: "none" | "ambiguous"
  instances: InstanceRecord[]
  message: string
}
export type DiscoverResult = DiscoverOk | DiscoverErr

export function instanceUrl(record: InstanceRecord): string {
  return `${record.https ? "https" : "http"}://${record.host}:${record.port}`
}

export function formatInstanceList(instances: InstanceRecord[]): string {
  if (instances.length === 0) return ""
  return instances
    .map((i) => `  ${i.port}  ${instanceUrl(i)}  pid=${i.pid}  v${i.version}  ${i.cwd}`)
    .join("\n")
}

/**
 * Resolve the HTTP base for an `agent …` command.
 * Precedence: --base, --port, DRIVE_CODING_BASE, unique live registry row.
 * PORT env is intentionally ignored (it would silently pin every lookup to 4000).
 */
export async function resolveBase(opts: {
  base?: string
  port?: string
  env?: NodeJS.ProcessEnv
}): Promise<DiscoverResult> {
  const env = opts.env ?? process.env
  if (opts.base !== undefined && opts.base !== "") {
    return { ok: true, base: opts.base.replace(/\/$/, ""), instances: [] }
  }
  if (opts.port !== undefined && opts.port !== "") {
    return { ok: true, base: `http://127.0.0.1:${opts.port}`, instances: [] }
  }
  const fromEnv = env.DRIVE_CODING_BASE
  if (fromEnv !== undefined && fromEnv !== "") {
    return { ok: true, base: fromEnv.replace(/\/$/, ""), instances: [] }
  }
  const instances = await resolveInstances(env)
  if (instances.length === 1) {
    const only = instances[0]
    if (only === undefined) {
      return {
        ok: false,
        kind: "none",
        instances: [],
        message: "no drive-coding instance found; pass --port or --base",
      }
    }
    return { ok: true, base: instanceUrl(only), instances }
  }
  if (instances.length === 0) {
    return {
      ok: false,
      kind: "none",
      instances,
      message: "no drive-coding instance found; pass --port or --base",
    }
  }
  return {
    ok: false,
    kind: "ambiguous",
    instances,
    message: "multiple drive-coding instances; pass --port or --base",
  }
}

/** Env injected into every `agent open` child. Both names — children still read DC_BASE. */
export function childEnv(
  base: string,
  extra: Record<string, string>,
  parent?: string,
): Record<string, string> {
  const env: Record<string, string> = {
    ...extra,
    DRIVE_CODING_BASE: base,
    DC_BASE: base,
  }
  if (parent !== undefined && parent !== "") env.DC_PARENT = parent
  return env
}
