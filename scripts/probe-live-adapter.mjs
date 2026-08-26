#!/usr/bin/env bun
/**
 * probe-live-adapter.mjs — live gate for slice live-contract-gemini.
 *
 * Imports the real gemini adapter + BE token endpoint, streams Hebrew PCM,
 * and checks normalized LiveEvents.
 *
 * Usage:
 *   bun scripts/probe-live-adapter.mjs
 *   PROBE_CONTEXT=1 bun scripts/probe-live-adapter.mjs   # DoD #15 mutation gate
 */

import { execSync, spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { GoogleGenAI } from "../packages/frontend/node_modules/@google/genai/dist/node/index.mjs"
import { LIVE_ACTION_SHAPES } from "../packages/core/src/voice/live-actions.ts"
import { buildLiveSecretaryPrompt } from "../packages/core/src/voice/live-prompt.ts"
import { geminiLive } from "../packages/frontend/src/lib/adapters/voice/live/gemini.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const BE_PORT = Number(process.env.PROBE_BE_PORT ?? 4020)
const PHRASE =
  process.env.PHRASE ?? "תבקש מהסוכן להריץ את הטסטים בקובץ auth.test.ts"
const IDENTIFIER = process.env.IDENTIFIER ?? "auth.test.ts"
const VOICE = process.env.LIVE_VOICE ?? "Puck"
const PROBE_CONTEXT = process.env.PROBE_CONTEXT === "1"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isHebrewScript = (t) => /[֐-׿]/.test(t ?? "")

function portIsInUse(port) {
  try {
    const out = execSync(`ss -ltn 'sport = :${port}'`, { encoding: "utf8" })
    return out.split("\n").some((line) => line.trimStart().startsWith("LISTEN"))
  } catch {
    return false
  }
}

function assertPortFree(port) {
  if (!portIsInUse(port)) return
  console.error(`Port ${port} is already in use — probe refuses to attach to a stale backend.`)
  console.error(`Find the listener: ss -ltnp 'sport = :${port}'`)
  console.error(`Kill only that PID (never pkill/killall — parallel agents share this host).`)
  process.exit(1)
}

async function killBackend(child) {
  if (!child || child.exitCode !== null) return
  child.kill("SIGTERM")
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    await sleep(100)
  }
  if (child.exitCode === null) {
    child.kill("SIGKILL")
    await sleep(200)
  }
}

async function waitPortReleased(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!portIsInUse(port)) return
    await sleep(100)
  }
  throw new Error(`Port ${port} still in use after backend cleanup`)
}

function beEnv() {
  const env = { ...process.env }
  for (const k of ["PORT", "FE_STATIC_DIR", "BE_PORT", "NODE_ENV"]) delete env[k]
  env.PORT = String(BE_PORT)
  return env
}

async function startBackend() {
  const child = spawn("bun", ["packages/backend/src/server.ts"], {
    cwd: ROOT,
    env: beEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  })
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${BE_PORT}/api/diag`)
      if (res.ok) return child
    } catch {}
    await sleep(200)
  }
  child.kill("SIGTERM")
  throw new Error(`BE did not become ready on port ${BE_PORT}`)
}

async function mintToken() {
  const actionNames = LIVE_ACTION_SHAPES.map((s) => s.name)
  const res = await fetch(`http://127.0.0.1:${BE_PORT}/api/voice/live/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: buildLiveSecretaryPrompt(),
      actions: actionNames,
      voiceName: VOICE,
    }),
  })
  if (!res.ok) {
    throw new Error(`token mint failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

/** Gemini TTS 24k → ffmpeg → 16k PCM (same path as probe-live-text-only.mjs). */
async function generateHebrewPcm16k(text, apiKey) {
  const ai = new GoogleGenAI({ apiKey })
  const iter = await ai.models.generateContentStream({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    },
  })

  const chunks = []
  for await (const chunk of iter) {
    const b64 = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
    if (b64) chunks.push(Buffer.from(b64, "base64"))
  }
  if (chunks.length === 0) throw new Error("TTS produced no audio")

  const dir = mkdtempSync(join(tmpdir(), "live-adapter-probe-"))
  const pcm24 = join(dir, "he24.pcm")
  writeFileSync(pcm24, Buffer.concat(chunks))
  const pcm16 = join(dir, "he16.pcm")
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-i",
      pcm24,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "s16le",
      pcm16,
    ],
    { encoding: "utf8" },
  )
  if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr}`)
  const audio = readFileSync(pcm16)
  rmSync(dir, { recursive: true, force: true })
  return new Uint8Array(audio)
}

async function runProbe() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY required")
    process.exit(1)
  }

  assertPortFree(BE_PORT)

  let be = null
  let exitCode = 1
  const events = []
  let closedReason

  try {
    be = await startBackend()
    const { token, model, sessionConfig } = await mintToken()

    const session = await geminiLive.connect({
      credential: token,
      model,
      providerConfig: sessionConfig,
      onEvent: (e) => {
        events.push(e)
        if (e.type === "closed") closedReason = e.reason
      },
    })

    await sleep(2000)

    let contextProvokedFrames = 0
    if (PROBE_CONTEXT) {
      const before = events.length
      session.send({
        type: "context",
        channel: "silent",
        text: "[הקשר] הסוכן מריץ טסטים.",
      })
      await sleep(3000)
      contextProvokedFrames = events.slice(before).filter((e) => e.type === "audio").length
    }

    const pcm = await generateHebrewPcm16k(PHRASE, process.env.GEMINI_API_KEY)
    const CHUNK = 3200
    for (let i = 0; i < pcm.length; i += CHUNK) {
      session.send({ type: "audio", pcm: pcm.subarray(i, i + CHUNK) })
      await sleep(20)
    }
    session.send({ type: "audio_stream_end" })

    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      if (events.some((e) => e.type === "action")) break
      await sleep(200)
    }
    // Allow late tool calls after turn completion
    if (!events.some((e) => e.type === "action")) {
      await sleep(3000)
    }
    await sleep(800)

    const actionEvents = events.filter((e) => e.type === "action")
    if (actionEvents.length > 0) {
      const first = actionEvents[0]
      session.send({
        type: "action_result",
        id: first.id,
        name: first.name,
        result: { status: "sent" },
      })
      await sleep(2000)
    }

    // usageMetadata often arrives after turn completion
    const usageDeadline = Date.now() + 5000
    while (Date.now() < usageDeadline && !events.some((e) => e.type === "usage")) {
      await sleep(200)
    }

    session.close()
    await sleep(500)

    const userTranscript = events
      .filter((e) => e.type === "transcript" && e.role === "user")
      .map((e) => e.text)
      .join("")

    const composeArgs = actionEvents
      .filter((e) => e.name === "compose_prompt")
      .map((e) => String(e.args?.text ?? ""))
      .join(" ")

    const usageEvent = [...events].reverse().find((e) => e.type === "usage")


    // The identifier as the secretary actually received it (post-STT).
    const identifierHeard =
      userTranscript.match(/[A-Za-z0-9_.-]+\.test\.ts/)?.[0] ?? null
    const out = {
      sessionStarted: events.some((e) => e.type === "session_started"),
      userTranscript,
      transcriptIsHebrew: isHebrewScript(userTranscript),
      audioEventCount: events.filter((e) => e.type === "audio").length,
      actionEvents: actionEvents.map((e) => ({ id: e.id, name: e.name, args: e.args })),
      // DoD 10 polices the SECRETARY, not the microphone. Comparing against the
      // spoken IDENTIFIER conflates the two: measured 2026-08-27, STT heard
      // "auth.test.ts" as "oath.test.ts" and the secretary then forwarded
      // "oath.test.ts" faithfully — perfect behaviour, failed gate. So fidelity
      // is measured against what the secretary actually RECEIVED, and the STT
      // step is reported separately as a diagnostic that does not gate.
      // (Mission §11ד already flags synthetic-speech transcription as non-verbatim.)
      identifierHeard,
      identifierTranscribedExactly: userTranscript.includes(IDENTIFIER),
      identifierSurvived: identifierHeard !== null && composeArgs.includes(identifierHeard),
      usage: usageEvent
        ? { totalTokens: usageEvent.totalTokens, promptTokens: usageEvent.promptTokens }
        : null,
      errorEvents: events.filter((e) => e.type === "error").map((e) => e.message),
      closedReason: closedReason ?? null,
    }

    if (PROBE_CONTEXT) {
      out.contextProvokedFrames = contextProvokedFrames
    }

    console.log(JSON.stringify(out, null, 2))
    exitCode = 0
  } catch (e) {
    console.error("PROBE FAILED:", e?.stack ?? e)
    exitCode = 1
  } finally {
    if (be) {
      await killBackend(be)
      try {
        await waitPortReleased(BE_PORT)
      } catch (e) {
        console.error(String(e?.message ?? e))
        exitCode = 1
      }
    }
  }

  process.exit(exitCode)
}

runProbe()
