import { spawn } from "node:child_process"
import { once } from "node:events"
import { createReadStream } from "node:fs"
import { readdir, realpath } from "node:fs/promises"
import { join } from "node:path"
import { createInterface } from "node:readline"

function parseFrame(line) {
  try {
    const entry = JSON.parse(line)
    return typeof entry?.raw === "string" ? JSON.parse(entry.raw) : undefined
  } catch {
    return undefined
  }
}

async function scanStream(stream) {
  let identity
  let sawTools = false
  const keys = new Set()
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    const frame = parseFrame(line)
    const agentInfo = frame?.result?.agentInfo
    if (typeof agentInfo?.name === "string" && typeof agentInfo?.version === "string") {
      identity ??= { bridge: agentInfo.name, version: agentInfo.version }
    }
    const update = frame?.params?.update
    if (update?.sessionUpdate !== "tool_call" && update?.sessionUpdate !== "tool_call_update") {
      continue
    }
    sawTools = true
    const meta = update._meta
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      for (const key of Object.keys(meta)) keys.add(key)
    }
  }
  return identity && sawTools ? { ...identity, keys } : undefined
}

async function scanFile(path) {
  if (!path.endsWith(".zst")) return scanStream(createReadStream(path))
  const child = spawn("zstd", ["-dc", "--", await realpath(path)], {
    stdio: ["ignore", "pipe", "ignore"],
  })
  const [recording, [code]] = await Promise.all([scanStream(child.stdout), once(child, "close")])
  if (code !== 0) throw new Error("Could not decompress a wire recording")
  return recording
}

async function main(dir) {
  if (!dir) {
    console.error("Usage: node scripts/probe-tool-meta-keys.mjs <directory>")
    return 2
  }
  const groups = new Map()
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if ((!entry.isFile() && !entry.isSymbolicLink()) || !/\.jsonl(?:\.zst)?$/.test(entry.name)) {
      continue
    }
    const recording = await scanFile(join(dir, entry.name))
    if (!recording) continue
    const { bridge, version, keys } = recording
    const key = JSON.stringify([bridge, version])
    const group = groups.get(key) ?? { bridge, version, keys: new Set() }
    for (const name of keys) group.keys.add(name)
    groups.set(key, group)
  }
  if (groups.size === 0) return 2
  const results = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({ ...group, keys: [...group.keys].sort() }))
  console.log(JSON.stringify(results, null, 2))
  return 0
}

try {
  process.exitCode = await main(process.argv[2])
} catch {
  console.error("Could not read the wire recordings")
  process.exitCode = 1
}
