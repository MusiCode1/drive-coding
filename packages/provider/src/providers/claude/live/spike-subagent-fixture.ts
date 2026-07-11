/**
 * spike-subagent-fixture.ts — Gate-1 spike (docs/plans/spike-subagent-transcript-fixture.md).
 *
 * Drives connectInProcess against the REAL claude CLI, enables the raw-SDK channel
 * (emitRawSDKMessages + forwardSubagentText), forces a Task/subagent, and captures
 * BOTH wire channels (ACP session/update + _claude/sdkMessage) with timestamps.
 *
 * Run:  cd packages/provider && bun run src/providers/claude/live/spike-subagent-fixture.ts
 *
 * Output: writes raw capture to OUT (below) and prints §9 analysis to stdout.
 * NOT a vitest test — a one-shot investigative harness.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectInProcess } from "../../../connection/connect-in-process.js"
import type { ProviderConnection } from "../../../connection/types.js"

// Raw captures are local-only research artifacts → .research/ (gitignored). cwd = packages/provider.
const OUT_DIR = join(process.cwd(), "../../.research/subagent-spike")
const OUT = join(OUT_DIR, `raw-${Date.now()}.jsonl`)

type Cap = { ts: number; dir: string; type: string; raw: string }

function req(id: number, method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params })
}

async function waitFor(cond: () => boolean, maxMs: number): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > maxMs) throw new Error(`waitFor timeout ${maxMs}ms`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function sendRequest(
  conn: ProviderConnection,
  id: number,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const responses: Array<Record<string, unknown>> = []
  const unsub = conn.wire.onLine((line) => {
    try {
      const msg = JSON.parse(line) as Record<string, unknown>
      if (msg.id === id && ("result" in msg || "error" in msg)) responses.push(msg)
    } catch {
      /* non-JSON */
    }
  })
  conn.wire.write(req(id, method, params))
  try {
    await waitFor(() => responses.length > 0, timeoutMs)
    const resp = responses[0]
    if (resp && "error" in resp) throw new Error(`${method} error: ${JSON.stringify(resp.error)}`)
    return (resp as Record<string, unknown>)?.result
  } finally {
    unsub()
  }
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "dc-spike-subagent-"))
  console.log(`[spike] cwd=${cwd}`)
  const conn = await connectInProcess({ cwd })

  const cap: Cap[] = []
  conn.onFrame((f) => {
    cap.push({ ts: Date.now(), dir: f.dir, type: f.type, raw: f.raw })
  })

  let id = 1
  const nextId = () => id++

  // 1) initialize
  await sendRequest(
    conn,
    nextId(),
    "initialize",
    { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "spike", version: "0.0.0" } },
    30_000,
  )
  console.log("[spike] initialized")

  // 2) session/new WITH the raw-SDK channel enabled (the two taps)
  const sessionResult = (await sendRequest(
    conn,
    nextId(),
    "session/new",
    {
      cwd,
      mcpServers: [],
      _meta: {
        claudeCode: {
          options: { forwardSubagentText: true },
          emitRawSDKMessages: [
            { type: "system", subtype: "task_started" },
            { type: "system", subtype: "task_progress" },
            { type: "system", subtype: "task_notification" },
            { type: "system", subtype: "task_updated" },
            { type: "assistant" },
            { type: "user" },
          ],
        },
      },
    },
    60_000,
  )) as Record<string, unknown>
  const sessionId = sessionResult.sessionId as string
  console.log(`[spike] session=${sessionId}`)

  // 3) prompt that FORCES a Task/subagent, multi-step (§4)
  const prompt =
    "Use the Task tool to launch a general-purpose subagent. Tell the subagent to do exactly this: " +
    "(1) print the sentence 'STEP ONE SPIKE_SUBAGENT_MARK', " +
    "(2) use the Bash tool to run: echo hello-from-subagent, " +
    "(3) print the sentence 'STEP TWO done'. " +
    "After the subagent finishes, reply with a one-line summary of what it did."
  console.log("[spike] prompting (forcing Task)... up to 240s")
  const promptResult = (await sendRequest(
    conn,
    nextId(),
    "session/prompt",
    { sessionId, prompt: [{ type: "text", text: prompt }] },
    240_000,
  )) as Record<string, unknown>
  console.log(`[spike] prompt done, stopReason=${String(promptResult?.stopReason)}`)

  // 4) Q7 — does session/load replay the raw ext channel? capture a marker window.
  const beforeLoad = cap.length
  try {
    await sendRequest(conn, nextId(), "session/load", { sessionId, cwd, mcpServers: [] }, 60_000)
    console.log("[spike] session/load ok")
  } catch (e) {
    console.log(`[spike] session/load error (may be unsupported): ${String(e)}`)
  }
  const loadFrames = cap.slice(beforeLoad)

  await conn.close()

  // ── dump raw capture ──
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT, cap.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8")
  console.log(`\n[spike] wrote ${cap.length} frames → ${OUT}`)

  // ── inline §9 analysis ──
  const parseRaw = (c: Cap) => {
    try {
      return JSON.parse(c.raw) as Record<string, unknown>
    } catch {
      return null
    }
  }
  const method = (c: Cap) => (parseRaw(c)?.method as string | undefined) ?? ""
  const isSdkMsg = (c: Cap) => method(c) === "_claude/sdkMessage"

  const acp = cap.filter((c) => !isSdkMsg(c))
  const raw = cap.filter(isSdkMsg)
  console.log(`\n===== §9 ANALYSIS =====`)
  console.log(`channels: acp=${acp.length}  raw(_claude/sdkMessage)=${raw.length}`)

  // type histogram per channel
  const hist = (arr: Cap[], label: (c: Cap) => string) => {
    const m: Record<string, number> = {}
    for (const c of arr) m[label(c)] = (m[label(c)] ?? 0) + 1
    return m
  }
  console.log(`\nACP frame types:`, hist(acp, (c) => c.type))

  // raw sdkMessage: dig into params.message.type / subtype
  const rawKind = (c: Cap) => {
    const p = parseRaw(c)?.params as Record<string, unknown> | undefined
    const msg = (p?.message ?? p?.sdkMessage ?? p) as Record<string, unknown> | undefined
    const t = msg?.type as string | undefined
    const st = msg?.subtype as string | undefined
    return st ? `${t}:${st}` : (t ?? "?")
  }
  console.log(`raw sdkMessage kinds:`, hist(raw, rawKind))

  // parent_tool_use_id presence + correlation to ACP toolCallId
  const parents = new Set<string>()
  for (const c of raw) {
    const p = parseRaw(c)?.params as Record<string, unknown> | undefined
    const msg = (p?.message ?? p) as Record<string, unknown> | undefined
    const pid = (msg?.parent_tool_use_id ?? p?.parent_tool_use_id) as string | undefined
    if (pid) parents.add(pid)
  }
  const toolCallIds = new Set<string>()
  for (const c of acp) {
    const u = (parseRaw(c)?.params as Record<string, unknown>)?.update as
      | Record<string, unknown>
      | undefined
    const tcid = u?.toolCallId as string | undefined
    if (tcid) toolCallIds.add(tcid)
  }
  console.log(`\nparent_tool_use_id values seen (raw):`, [...parents])
  console.log(`ACP toolCallId values seen:`, [...toolCallIds])
  console.log(
    `Q4 correlation — parents ⊆ toolCallIds?`,
    [...parents].every((p) => toolCallIds.has(p)),
  )

  // Q7 replay
  console.log(
    `\nQ7 session/load replay — frames after load=${loadFrames.length}, of which raw=${loadFrames.filter(isSdkMsg).length}`,
  )
  console.log(`===== END ANALYSIS =====`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[spike] FATAL", e)
    process.exit(1)
  },
)
