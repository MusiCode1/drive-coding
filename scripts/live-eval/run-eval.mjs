#!/usr/bin/env bun
/**
 * With GEMINI_API_KEY set, run in tmux:
 * LIVE_EVAL_OUT="$HOME/Projects/drive-coding-docs/investigations/live-route-a-eval" \
 *   bun scripts/live-eval/run-eval.mjs --label before
 * Repeat the same label to retry only failed runs. Use --finalize <label> to apply the review.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { parseArgs } from "node:util"
import { buildGeminiLiveConfig } from "../../packages/backend/src/delivery/live-gemini-config.ts"
import { buildLiveActions } from "../../packages/core/src/voice/live-actions.ts"
import {
  buildLiveSecretaryPrompt,
  formatAgentDelivery,
  formatConfigSeedProse,
} from "../../packages/core/src/voice/live-prompt.ts"
import { readRecentBubbles } from "../../packages/core/src/voice/live-read-recent.ts"
import { searchSessionBubbles } from "../../packages/core/src/voice/live-search.ts"
import { buildLiveSeed } from "../../packages/core/src/voice/live-seed.ts"
import { GoogleGenAI } from "../../packages/frontend/node_modules/@google/genai/dist/node/index.mjs"
import { LIVE_SEED_LABELS } from "../../packages/frontend/src/lib/util/live-seed-from-session.ts"
import { classifyRun } from "./classify.mjs"
import { generateHebrewPcm16k } from "./hebrew-pcm.mjs"

process.exitCode = 1

const CHUNK_MS = 100
const CHUNK_BYTES = 3200
const COLLECTION_MS = 25_000
const QUIET_MS = 10_000
const CONCURRENCY = 4
const DISPATCH = ["compose_prompt", "forward"]
const CACHE_DIR = join(homedir(), ".cache", "drive-coding", "live-eval")
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hash = (data) => createHash("sha256").update(data).digest("hex")

const seed = buildLiveSeed(
  {
    bubbles: [
      { kind: "user", text: "תעדכן את הטיפול בשגיאת טעינה.", turnIndex: 0 },
      { kind: "assistant", text: "הוספתי הודעה ברורה במקרה של שגיאת טעינה.", turnIndex: 0 },
      { kind: "user", text: "תוסיף בדיקה למצב הזה.", turnIndex: 1 },
      { kind: "assistant", text: "הוספתי בדיקה שמוודאת שהודעת השגיאה מופיעה.", turnIndex: 1 },
    ],
    turnState: "idle",
    pendingPermission: null,
    lastUserMessage: null,
  },
  LIVE_SEED_LABELS,
)
const seedTexts = [
  ...seed.turns.map((turn) => turn.text),
  formatConfigSeedProse({
    session: { connected: true, options: [] },
    app: { screenWakeLock: true, locale: "he", theme: "dark", themeChoices: ["dark"] },
  }),
]

function actionResult(scenario, name) {
  if (DISPATCH.includes(name)) return scenario.toolResult ?? { status: "sent" }
  if (name === "read_recent") return readRecentBubbles([])
  if (name === "search_session") return searchSessionBubbles([], "")
  return { status: "ok" }
}

async function collect(client, model, config, run, pcm) {
  let session
  let expired = false
  let setupComplete = false
  let ended = false
  let turnCompleteAt
  let sent = false
  let connectTimeout
  let signalClosed
  const closed = new Promise((resolve) => {
    signalClosed = resolve
  })
  let failure
  const fail = (message) => {
    if (ended) return
    failure ??= new Error(message)
    signalClosed()
  }

  try {
    const connected = client.live
      .connect({
        model,
        config,
        callbacks: {
          onerror: () => fail("Gemini Live socket error"),
          onclose: (event) => fail(`Gemini Live closed (${event.code}): ${event.reason}`),
          onmessage: (message) => {
            if (ended) return
            try {
              if (message.setupComplete !== undefined) setupComplete = true
              const content = message.serverContent
              const input = content?.inputTranscription?.text ?? ""
              const output = content?.outputTranscription?.text ?? ""
              run.inputText += input
              run.outputText += output
              if (!run.deliverySent) run.beforeDeliveryText += output
              const calls = message.toolCall?.functionCalls ?? []
              if (calls.length > 0) {
                turnCompleteAt = undefined
                const functionResponses = calls.map(({ id, name, args }) => {
                  if (!id || !name) throw new Error("Gemini Live sent an incomplete tool call")
                  run.toolCalls.push({ name, args: args ?? {}, afterDelivery: run.deliverySent })
                  const response = actionResult(run.scenario, name)
                  if (DISPATCH.includes(name) && response.status === "sent") sent = true
                  return { id, name, response }
                })
                session.sendToolResponse({ functionResponses })
              }
              if (content?.turnComplete) turnCompleteAt = Date.now()
            } catch (error) {
              fail(error.message)
            }
          },
        },
      })
      .then((connection) => {
        if (expired) connection.close()
        return connection
      })

    session = await Promise.race([
      connected,
      closed.then(() => {
        throw failure
      }),
      new Promise((_, reject) => {
        connectTimeout = setTimeout(
          () => reject(new Error("No setupComplete from Gemini Live")),
          20_000,
        )
      }),
    ])
    clearTimeout(connectTimeout)

    const setupDeadline = Date.now() + 2000
    while (!setupComplete && !failure && Date.now() < setupDeadline) await sleep(25)
    if (failure) throw failure
    if (!setupComplete) throw new Error("No setupComplete from Gemini Live")

    for (const text of seedTexts) {
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: false,
      })
    }
    for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
      if (failure) throw failure
      session.sendRealtimeInput({
        audio: {
          data: pcm.subarray(offset, offset + CHUNK_BYTES).toString("base64"),
          mimeType: "audio/pcm;rate=16000",
        },
      })
      await sleep(CHUNK_MS)
    }
    session.sendRealtimeInput({ audioStreamEnd: true })

    const deadline = Date.now() + COLLECTION_MS
    while (Date.now() < deadline) {
      if (failure) throw failure
      if (turnCompleteAt !== undefined) {
        if (sent && run.scenario.afterDelivery && !run.deliverySent) {
          run.deliverySent = true
          turnCompleteAt = undefined
          session.sendRealtimeInput({ text: formatAgentDelivery(run.scenario.afterDelivery) })
        } else if (Date.now() - turnCompleteAt >= QUIET_MS) {
          break
        }
      }
      await sleep(50)
    }
    if (failure) throw failure
  } finally {
    ended = true
    expired = true
    clearTimeout(connectTimeout)
    session?.close()
  }
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const key = process.env.GEMINI_API_KEY
  return key ? message.replaceAll(key, "[redacted]") : message
}

function summarize(runs) {
  const valid = runs.filter(({ outcome }) => outcome !== "error")
  const delegations = valid.filter(({ scenario }) => scenario.expect === "delegate")
  const selfTurns = valid.filter(({ scenario }) => scenario.expect === "self")
  const count = (key, rows = valid) => rows.filter((run) => run[key]).length
  const validRunsPerScenario = {}
  const perScenario = {}
  for (const { scenario } of runs) {
    if (perScenario[scenario.id]) continue
    const all = runs.filter((run) => run.scenario.id === scenario.id)
    const rows = valid.filter((run) => run.scenario.id === scenario.id)
    validRunsPerScenario[scenario.id] = rows.length
    perScenario[scenario.id] = {
      expected: scenario.expect,
      delegated: rows.filter(({ outcome }) => outcome === "delegated").length,
      self: rows.filter(({ outcome }) => outcome === "self").length,
      otherTool: rows.filter(({ outcome }) => outcome === "other-tool").length,
      silent: rows.filter(({ outcome }) => outcome === "silent").length,
      errors: all.length - rows.length,
      I_auto: count("invented", rows),
      suspects: count("suspect", rows),
      S: rows.filter(({ outcome }) => outcome === "self").length,
      F: count("falseConfirm", rows),
      R: count("refused", rows),
      X: count("redispatched", rows),
      selfClaims: count("selfClaim", rows),
      deliveries: count("deliverySent", rows),
    }
  }
  return {
    D: delegations.length
      ? delegations.filter(({ outcome }) => outcome === "delegated").length / delegations.length
      : null,
    I_auto: count("invented"),
    suspects: count("suspect"),
    S: selfTurns.length
      ? selfTurns.filter(({ outcome }) => outcome === "self").length / selfTurns.length
      : null,
    F: count("falseConfirm"),
    R: count("refused"),
    X: count("redispatched"),
    selfClaims: count("selfClaim"),
    errors: runs.length - valid.length,
    validRunsPerScenario,
    perScenario,
  }
}

function writeJson(path, value) {
  const staging = `${path}.${process.pid}.part`
  writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(staging, path)
}

function finalize(path, label) {
  const result = JSON.parse(readFileSync(`${path}.json`, "utf8"))
  const suspects = result.runs.filter(({ suspect }) => suspect)
  const reviewPath = `${path}.review.json`
  const reviews = existsSync(reviewPath) ? JSON.parse(readFileSync(reviewPath, "utf8")) : []
  const byId = new Map(reviews.map((row) => [row.runId, row]))
  if (
    byId.size !== reviews.length ||
    reviews.length !== suspects.length ||
    suspects.some(({ runId }) => {
      const review = byId.get(runId)
      return (
        !review ||
        !["invented", "ok"].includes(review.verdict) ||
        typeof review.why !== "string" ||
        !review.why.trim()
      )
    })
  ) {
    throw new Error("Provide one valid review decision with reasoning for each suspect")
  }
  result.reviews = reviews
  result.summary.I =
    result.summary.I_auto + reviews.filter(({ verdict }) => verdict === "invented").length
  for (const [id, row] of Object.entries(result.summary.perScenario)) {
    row.I =
      row.I_auto +
      suspects.filter(
        ({ scenario, runId }) => scenario.id === id && byId.get(runId).verdict === "invented",
      ).length
  }
  writeJson(`${path}.final.json`, result)
  printSummary(label, result.summary)
}

function printSummary(label, summary) {
  const { perScenario, validRunsPerScenario, ...totals } = summary
  console.log(JSON.stringify({ label, ...totals }))
}

async function main() {
  const { values } = parseArgs({
    options: {
      label: { type: "string" },
      finalize: { type: "string" },
      model: { type: "string", default: "gemini-3.1-flash-live-preview" },
      voice: { type: "string", default: "Puck" },
      n: { type: "string", default: "3" },
    },
  })
  const { model, voice } = values
  const label = values.finalize ?? values.label
  if (!label || !/^[a-z][a-z0-9-]*$/.test(label) || (values.finalize && values.label)) {
    throw new Error("Provide exactly one --label <label> or --finalize <label>")
  }
  const out = process.env.LIVE_EVAL_OUT
  if (!out || !isAbsolute(out)) throw new Error("LIVE_EVAL_OUT must be an absolute path")
  const path = join(out, label)
  if (values.finalize) return finalize(path, label)

  const n = Number(values.n)
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("--n must be a positive integer")
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GEMINI_API_KEY is required")

  const source = readFileSync(new URL("./scenarios.json", import.meta.url))
  const scenarios = JSON.parse(source)
  const actions = buildLiveActions()
  const systemInstruction = buildLiveSecretaryPrompt({ language: "he", tools: actions })
  const config = buildGeminiLiveConfig({ actions, systemInstruction, voiceName: voice })
  const identity = {
    promptSha: hash(systemInstruction),
    scenariosSha: hash(source),
    model,
    voice,
    n,
  }
  const outFile = `${path}.json`
  mkdirSync(out, { recursive: true })
  const previous = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : undefined
  if (previous && Object.keys(identity).some((key) => identity[key] !== previous[key])) {
    throw new Error(
      "Existing label has a different prompt, scenario set, model, voice, or run count",
    )
  }
  const previousRuns = new Map(previous?.runs.map((run) => [run.runId, run]))
  const before = label.startsWith("after-")
    ? JSON.parse(readFileSync(join(out, "before.final.json"), "utf8"))
    : undefined
  if (
    before &&
    ["scenariosSha", "model", "voice", "n"].some((key) => identity[key] !== before[key])
  ) {
    throw new Error("After measurement must match baseline scenarios, model, voice and repetitions")
  }
  if (before?.promptSha === identity.promptSha)
    throw new Error("The prompt has not changed since baseline")

  const client = new GoogleGenAI({ apiKey })
  const audio = new Map()
  for (const scenario of scenarios) {
    const pcm = await generateHebrewPcm16k(scenario.utterance, apiKey, CACHE_DIR)
    const pcmSha = hash(pcm)
    const reference = (before ?? previous)?.pcmShas[scenario.id]
    if (reference && reference !== pcmSha) throw new Error(`PCM changed for ${scenario.id}`)
    audio.set(scenario.id, { pcm, pcmSha })
    console.log(`PCM ready: ${scenario.id}`)
  }
  const pcmShas = Object.fromEntries([...audio].map(([id, data]) => [id, data.pcmSha]))
  const jobs = scenarios.flatMap((scenario) =>
    Array.from({ length: n }, (_, i) => ({ scenario, runId: `${scenario.id}/${i + 1}` })),
  )
  async function runJob({ scenario, runId }) {
    const saved = previousRuns.get(runId)
    if (saved && saved.outcome !== "error") return saved
    const run = {
      runId,
      scenario,
      toolCalls: [],
      inputText: "",
      outputText: "",
      beforeDeliveryText: "",
      deliverySent: false,
    }
    try {
      await collect(client, model, config, run, audio.get(scenario.id).pcm)
    } catch (error) {
      run.error = safeError(error)
    }
    const measured = { ...run, ...classifyRun(run) }
    console.log(`${runId}: ${measured.outcome}${run.error ? ` (${run.error})` : ""}`)
    return measured
  }

  const runs = []
  for (let index = 0; index < jobs.length; index += CONCURRENCY) {
    runs.push(...(await Promise.all(jobs.slice(index, index + CONCURRENCY).map(runJob))))
  }
  const summary = summarize(runs)
  writeJson(outFile, { ...identity, pcmShas, runs, summary })
  printSummary(label, summary)
}

try {
  await main()
  process.exitCode = 0
} catch (error) {
  console.error(safeError(error))
}
