/**
 * CLI entry for `drive-coding agent …` and `drive-coding instances`.
 * Invoked from bin/drive-coding.ts AFTER a peek at argv[2], before parseArgs.
 */

import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import type { InstanceRecord } from "@drive-coding/core/schemas/session-bus"
import { resolveInstances } from "../instances.js"
import { childEnv, formatInstanceList, resolveBase } from "./discover.js"
import { AGENT_HELP } from "./help.js"
import { postJson, readJson } from "./http.js"
import { waitForTurnEnd } from "./wait-for-turn.js"

type Values = {
  json?: boolean
  help?: boolean
  base?: string
  port?: string
  cli?: string
  cwd?: string
  env?: string[]
  permission?: string
  parent?: string
  "close-on-turn-end"?: boolean
  agent?: string
  "prompt-file"?: string
  prompt?: string
  set?: string[]
  file?: string
  marker?: string
  timeout?: string
  "idle-timeout"?: string
  "no-wait"?: boolean
  keep?: boolean
  force?: boolean
  text?: string
  "text-file"?: string
  "public-url"?: string
}

function kv(entries: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of entries ?? []) {
    const i = e.indexOf("=")
    if (i <= 0) continue
    const key = e.slice(0, i)
    out[key] = e.slice(i + 1)
  }
  return out
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printInstances(instances: InstanceRecord[], asJson: boolean): void {
  if (asJson) {
    printJson({ instances })
    return
  }
  const lines = formatInstanceList(instances)
  if (lines) console.log(lines)
}

export async function runCli(argv: string[]): Promise<number> {
  let values: Values
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        base: { type: "string" },
        port: { type: "string" },
        cli: { type: "string" },
        cwd: { type: "string" },
        env: { type: "string", multiple: true },
        permission: { type: "string" },
        parent: { type: "string" },
        "close-on-turn-end": { type: "boolean" },
        agent: { type: "string" },
        "prompt-file": { type: "string" },
        prompt: { type: "string" },
        set: { type: "string", multiple: true },
        file: { type: "string" },
        marker: { type: "string" },
        timeout: { type: "string" },
        "idle-timeout": { type: "string" },
        "no-wait": { type: "boolean" },
        keep: { type: "boolean" },
        force: { type: "boolean" },
        text: { type: "string" },
        "text-file": { type: "string" },
        "public-url": { type: "string" },
      },
    }) as { values: Values; positionals: string[] })
  } catch (err) {
    console.error(`[drive-coding] ${(err as Error).message}\n`)
    console.error(AGENT_HELP)
    return 4
  }

  const asJson = values.json === true
  const head = positionals[0]

  if (head === "instances") {
    if (values.help) {
      console.log(AGENT_HELP)
      return 0
    }
    const instances = await resolveInstances()
    printInstances(instances, asJson)
    return 0
  }

  if (head !== "agent") {
    console.error(AGENT_HELP)
    return 4
  }

  const cmd = positionals[1]
  if (values.help || cmd === undefined || cmd === "help") {
    console.log(AGENT_HELP)
    return 0
  }

  const discovered = await resolveBase({ base: values.base, port: values.port })
  if (!discovered.ok) {
    console.error(`[drive-coding] ${discovered.message}`)
    const listing = formatInstanceList(discovered.instances)
    if (listing) console.error(listing)
    return 1
  }
  const base = discovered.base

  try {
    switch (cmd) {
      case "list":
        return await cmdList(base, asJson)
      case "open":
        return await cmdOpen(base, values, asJson)
      case "send":
        return await cmdSend(base, values)
      case "state":
        return await cmdState(base, values)
      case "close":
        return await cmdClose(base, values)
      case "notify":
        return await cmdNotify(base, values)
      default:
        console.error(`[drive-coding] unknown agent command "${cmd}"\n`)
        console.error(AGENT_HELP)
        return 4
    }
  } catch (e) {
    console.error(`[drive-coding] ${e instanceof Error ? e.message : String(e)}`)
    return 4
  }
}

async function cmdList(base: string, asJson: boolean): Promise<number> {
  const body = (await readJson(`${base}/api/agents`)) as { agents?: unknown }
  if (asJson) {
    printJson(body)
    return 0
  }
  const agents = Array.isArray(body.agents) ? body.agents : []
  for (const a of agents) {
    const row = a as { id?: string; cliKind?: string; cwd?: string; status?: string }
    console.log(`${row.id ?? "?"}  ${row.cliKind ?? "?"}  ${row.status ?? "?"}  ${row.cwd ?? ""}`)
  }
  return 0
}

async function cmdOpen(base: string, values: Values, asJson: boolean): Promise<number> {
  const cli = values.cli
  if (!cli) {
    console.error("[drive-coding] open: --cli is required")
    return 4
  }
  const cwd = values.cwd && values.cwd !== "" ? values.cwd : process.cwd()
  const extra = kv(values.env)
  const env = childEnv(base, extra, values.parent)
  const created = (await postJson(`${base}/api/agents`, {
    cliKind: cli,
    cwd,
    env,
    ...(values.permission ? { permissionPolicy: values.permission } : {}),
    ...(values.parent ? { parentAgentId: values.parent } : {}),
    ...(values["close-on-turn-end"] ? { closeOnTurnEnd: true } : {}),
  })) as { agentId?: string }
  const agent = created.agentId
  if (!agent) {
    console.error("[drive-coding] open: server returned no agentId")
    return 4
  }

  const abort = new AbortController()
  setTimeout(() => abort.abort(), 15_000)
  try {
    const ev = await fetch(`${base}/api/agents/${agent}/events`, { signal: abort.signal })
    await ev.body?.cancel()
  } catch {
    // trigger lazy host; ignore
  }

  let st: { sessionId?: string; modes?: unknown; configOptions?: unknown } | undefined
  for (let i = 0; i < 20 && !st?.sessionId; i++) {
    try {
      st = (await readJson(`${base}/api/agents/${agent}/state`)) as typeof st
    } catch {
      // host not up yet
    }
    if (!st?.sessionId) await new Promise((r) => setTimeout(r, 1500))
  }
  if (!st?.sessionId) {
    console.error("[drive-coding] session did not come up within 30s")
    return 3
  }

  const publicUrl = (values["public-url"] ?? base).replace(/\/$/, "")
  const url = `${publicUrl}/chat/${cli}/${st.sessionId}?sessionTransport=http`
  if (asJson) {
    printJson({
      agent,
      sessionId: st.sessionId,
      url,
      modes: st.modes,
      configOptions: st.configOptions,
    })
    return 0
  }
  console.log(`agent:     ${agent}`)
  console.log(`session:   ${st.sessionId}`)
  console.log(`url:       ${url}`)
  return 0
}

async function cmdSend(base: string, values: Values): Promise<number> {
  const agent = values.agent
  const promptText =
    values.prompt ??
    (values["prompt-file"] ? readFileSync(values["prompt-file"], "utf8") : undefined)
  if (!agent || promptText === undefined) {
    console.error("[drive-coding] send: --agent and (--prompt | --prompt-file) are required")
    return 4
  }
  const st0 = (await readJson(`${base}/api/agents/${agent}/state`)) as { sessionId?: string }
  const sid = st0.sessionId
  if (!sid) {
    console.error("[drive-coding] send: no sessionId — run open first")
    return 4
  }
  for (const [id, value] of Object.entries(kv(values.set))) {
    await postJson(`${base}/api/agents/${agent}/rpc`, {
      method: "session/set_config_option",
      params: { configId: id, value },
      waitMs: 15_000,
    })
    const st = (await readJson(`${base}/api/agents/${agent}/state`)) as {
      configOptions?: { id: string; currentValue?: unknown }[]
    }
    const now = (st.configOptions ?? []).find((c) => c.id === id)?.currentValue
    const ok = now === value
    console.log(`${ok ? "ok" : "warn"} ${id} = ${String(now)}${ok ? "" : `  (wanted ${value})`}`)
  }
  await postJson(`${base}/api/agents/${agent}/rpc`, {
    method: "session/prompt",
    params: { sessionId: sid, content: promptText },
  })
  console.log("prompt accepted (202)")
  if (values["no-wait"]) return 0

  const r = await waitForTurnEnd({
    base,
    agent,
    file: values.file,
    marker: values.marker,
    timeoutMs: Number(values.timeout ?? "1800") * 1000,
    idleTimeoutMs: Number(values["idle-timeout"] ?? "0") * 1000,
  })
  const icon = r.code === 0 ? "ok" : r.code === 2 ? "timeout" : "err"
  console.log(
    `${icon} ${r.why}${r.stopReason ? `  stopReason=${r.stopReason}` : ""}  frames=${r.frames}  state=${r.lastState}`,
  )
  if (r.code === 0 && !values.keep) {
    await fetch(`${base}/api/agents/${agent}`, { method: "DELETE" })
    console.log("agent closed")
  } else if (r.code !== 0) {
    console.log(
      `agent left running — close with: drive-coding agent close --base ${base} --agent ${agent}`,
    )
  }
  return r.code
}

async function cmdState(base: string, values: Values): Promise<number> {
  const agent = values.agent
  if (!agent) {
    console.error("[drive-coding] state: --agent is required")
    return 4
  }
  const st = await readJson(`${base}/api/agents/${agent}/state`)
  printJson(st)
  return 0
}

async function cmdClose(base: string, values: Values): Promise<number> {
  const agent = values.agent
  if (!agent) {
    console.error("[drive-coding] close: --agent is required")
    return 4
  }
  let cwd: string | undefined
  try {
    const listed = (await readJson(`${base}/api/agents`)) as {
      agents?: { id: string; cwd?: string }[]
    }
    const row = (listed.agents ?? []).find((x) => x.id === agent)
    if (!row) {
      console.log(`not in list — already closed: ${agent}`)
      return 0
    }
    cwd = row.cwd
  } catch (e) {
    console.error(
      `[drive-coding] could not read agent list: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  let turnState: string | null = null
  try {
    const st = (await readJson(`${base}/api/agents/${agent}/state`)) as { turnState?: string }
    turnState = st.turnState ?? null
  } catch {
    // host may not have come up
  }
  if (turnState && turnState !== "idle" && !values.force) {
    console.error(`[drive-coding] turnState=${turnState} — turn is open. wait, or pass --force.`)
    return 3
  }
  if (turnState === null)
    console.error("[drive-coding] no /state (host not up?) — closing without turn check.")
  const res = await fetch(`${base}/api/agents/${agent}`, { method: "DELETE" })
  console.log(`${res.ok ? "ok" : "err"} DELETE ${res.status}  ${agent}${cwd ? `  ${cwd}` : ""}`)
  return res.ok ? 0 : 3
}

async function cmdNotify(base: string, values: Values): Promise<number> {
  const agent = values.agent
  const text =
    values.text ?? (values["text-file"] ? readFileSync(values["text-file"], "utf8") : undefined)
  if (!agent || !text) {
    console.error("[drive-coding] notify: --agent and (--text | --text-file) are required")
    return 4
  }
  const st = (await readJson(`${base}/api/agents/${agent}/state`)) as { sessionId?: string }
  if (!st.sessionId) {
    console.error(`[drive-coding] notify: agent ${agent} has no live sessionId`)
    return 4
  }
  const r = (await postJson(`${base}/api/agents/${agent}/rpc`, {
    method: "session/prompt",
    params: { sessionId: st.sessionId, content: text },
  })) as { version?: unknown }
  console.log(`delivered  version=${String(r.version)}  ${agent}`)
  return 0
}
