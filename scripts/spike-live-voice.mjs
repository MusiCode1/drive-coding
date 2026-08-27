#!/usr/bin/env bun
/**
 * Spike runner for live-voice-surface pre-brief blockers (H.1 / H.2 / H.3).
 *
 * Usage:
 *   GEMINI_API_KEY=... bun scripts/spike-live-voice.mjs [h1|h2|h3|all]
 *
 * Outputs JSON summary to stdout; details to stderr.
 */

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  GoogleGenAI,
  Modality,
} from "../packages/frontend/node_modules/@google/genai/dist/node/index.mjs"

const API_KEY = process.env.GEMINI_API_KEY
if (!API_KEY) {
  console.error("GEMINI_API_KEY required")
  process.exit(1)
}

const ai = new GoogleGenAI({ apiKey: API_KEY })

const MODELS = {
  v31: "gemini-3.1-flash-live-preview",
  v25: "gemini-2.5-flash-native-audio-preview-12-2025",
}

const HEBREW_PHRASE = "שלום, מה שלומך היום?"

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function collectMessages(session, timeoutMs = 30_000) {
  const messages = []
  let resolveDone
  let rejectDone
  const done = new Promise((res, rej) => {
    resolveDone = res
    rejectDone = rej
  })
  const timer = setTimeout(() => rejectDone(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)

  return {
    push(msg) {
      messages.push(msg)
    },
    waitForTurnComplete(extraMs = 0) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const last = messages.at(-1)
          if (last?.serverContent?.turnComplete) {
            clearTimeout(timer)
            setTimeout(() => resolve([...messages]), extraMs)
            return true
          }
          return false
        }
        if (check()) return
        const interval = setInterval(() => {
          if (check()) clearInterval(interval)
        }, 50)
        setTimeout(() => {
          clearInterval(interval)
          reject(new Error("turnComplete not seen"))
        }, timeoutMs)
      })
    },
    all: () => messages,
    done,
    fail(err) {
      clearTimeout(timer)
      rejectDone(err)
    },
  }
}

async function connectLive(model, configExtra = {}) {
  const collector = { msgs: [], resolveOpen: null, resolveClose: null, rejectErr: null }
  const openP = new Promise((res) => {
    collector.resolveOpen = res
  })
  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      thinkingConfig: { thinkingBudget: 0 },
      ...configExtra,
    },
    callbacks: {
      onopen: () => collector.resolveOpen?.(),
      onmessage: (m) => collector.msgs.push(m),
      onerror: (e) => collector.rejectErr?.(e),
      onclose: () => {},
    },
  })
  await openP
  await sleep(300)
  return { session, collector }
}

function hasModelAudio(messages) {
  return messages.some((m) => m.serverContent?.modelTurn?.parts?.some((p) => p.inlineData?.data))
}

function hasModelText(messages) {
  return messages.some((m) => m.serverContent?.modelTurn?.parts?.some((p) => p.text?.trim()))
}

/** H.1 — silent context injection then follow-up turn */
async function spikeH1(modelId, modelKey) {
  const result = {
    spike: "H.1",
    model: modelId,
    modelKey,
    silentContextNoResponse: null,
    followUpTriggersResponse: null,
    followUpVia: null,
    notes: [],
  }

  const { session, collector } = await connectLive(modelId, {
    systemInstruction: {
      parts: [{ text: "You are a voice secretary. Keep replies very short." }],
    },
  })

  const before = collector.msgs.length
  session.sendClientContent({
    turns: [
      {
        role: "user",
        parts: [{ text: "[silent context] Agent status: running tests on auth module." }],
      },
    ],
    turnComplete: false,
  })
  await sleep(1500)

  const afterSilent = collector.msgs.slice(before)
  const silentResponse = hasModelAudio(afterSilent) || hasModelText(afterSilent)
  result.silentContextNoResponse = !silentResponse

  // Follow-up: try realtime text (works on 3.1 per docs) then client content question
  const mid = collector.msgs.length
  session.sendRealtimeInput({ text: "Say only the word PONG." })
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no response")), 20_000)
      const iv = setInterval(() => {
        const slice = collector.msgs.slice(mid)
        if (hasModelAudio(slice) || hasModelText(slice)) {
          clearTimeout(t)
          clearInterval(iv)
          resolve(undefined)
        }
        const err = slice.find((m) => m.error)
        if (err) {
          clearTimeout(t)
          clearInterval(iv)
          reject(new Error(JSON.stringify(err)))
        }
      }, 100)
    })
    result.followUpTriggersResponse = true
    result.followUpVia = "sendRealtimeInput(text)"
  } catch (e) {
    result.followUpTriggersResponse = false
    result.notes.push(`realtime text follow-up failed: ${e.message}`)
    // fallback: explicit client content turn
    const mid2 = collector.msgs.length
    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: "Say only the word PONG." }] }],
      turnComplete: true,
    })
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no response")), 20_000)
        const iv = setInterval(() => {
          const slice = collector.msgs.slice(mid2)
          if (hasModelAudio(slice) || hasModelText(slice)) {
            clearTimeout(t)
            clearInterval(iv)
            resolve(undefined)
          }
        }, 100)
      })
      result.followUpTriggersResponse = true
      result.followUpVia = "sendClientContent(turnComplete:true) fallback"
    } catch (e2) {
      result.notes.push(`client content fallback failed: ${e2.message}`)
    }
  }

  session.close()
  return result
}

/** Generate 16kHz mono PCM Hebrew speech via Gemini TTS + ffmpeg resample */
async function generateHebrewPcm16k() {
  const iter = await ai.models.generateContentStream({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{ parts: [{ text: HEBREW_PHRASE }] }],
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

  const dir = mkdtempSync(join(tmpdir(), "live-spike-"))
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
  return audio
}

function isHebrewScript(text) {
  return /[\u0590-\u05FF]/.test(text)
}

function isLatinTransliteration(text) {
  const t = text.trim()
  if (!t) return false
  if (isHebrewScript(t)) return false
  return /^[\x00-\x7F\s.,!?'"()-]+$/.test(t)
}

/** H.2 — Hebrew streaming input transcription */
async function spikeH2(modelId) {
  const pcm = await generateHebrewPcm16k()
  const result = {
    spike: "H.2",
    model: modelId,
    phrase: HEBREW_PHRASE,
    pcmBytes: pcm.length,
    firstPartialMs: null,
    finalTranscript: null,
    hebrewScript: null,
    latinTransliteration: null,
    partialCount: 0,
    notes: [],
  }

  const transcripts = []
  let firstPartialAt = null
  const t0 = Date.now()

  const { session, collector } = await connectLive(modelId, {
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  })

  // Stream PCM in ~100ms chunks (1600 samples @16kHz = 3200 bytes)
  const chunkSize = 3200
  for (let i = 0; i < pcm.length; i += chunkSize) {
    const slice = pcm.subarray(i, i + chunkSize)
    session.sendRealtimeInput({
      audio: { data: Buffer.from(slice).toString("base64"), mimeType: "audio/pcm;rate=16000" },
    })
    await sleep(80)
  }
  session.sendRealtimeInput({ audioStreamEnd: true })

  // Wait for turn + transcriptions
  await sleep(8000)

  for (const m of collector.msgs) {
    const t = m.serverContent?.inputTranscription?.text
    if (t) {
      transcripts.push(t)
      if (firstPartialAt == null) firstPartialAt = Date.now() - t0
    }
  }

  result.partialCount = transcripts.length
  result.firstPartialMs = firstPartialAt
  result.finalTranscript = transcripts.at(-1) ?? null
  result.hebrewScript = result.finalTranscript ? isHebrewScript(result.finalTranscript) : false
  result.latinTransliteration = result.finalTranscript
    ? isLatinTransliteration(result.finalTranscript)
    : false

  session.close()
  return result
}

/** H.3 — usageMetadata over multi-turn session (~90s accelerated proxy for 3min) */
async function spikeH3(modelId, durationSec = 90) {
  const usageSnapshots = []
  const t0 = Date.now()

  const { session, collector } = await connectLive(modelId, {
    inputAudioTranscription: {},
  })

  const prompts = [
    "Reply with one short sentence about the weather.",
    "Reply with one short sentence about coding.",
    "Reply with one short sentence about music.",
    "Reply with one short sentence about travel.",
    "Reply with one short sentence about food.",
  ]

  let turn = 0
  while (Date.now() - t0 < durationSec * 1000) {
    const prompt = prompts[turn % prompts.length]
    const mid = collector.msgs.length
    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: prompt }] }],
      turnComplete: true,
    })

    await new Promise((resolve) => {
      const deadline = Date.now() + 25_000
      const iv = setInterval(() => {
        const slice = collector.msgs.slice(mid)
        if (slice.some((m) => m.serverContent?.turnComplete) || Date.now() > deadline) {
          clearInterval(iv)
          resolve(undefined)
        }
      }, 100)
    })

    for (const m of collector.msgs.slice(mid)) {
      if (m.usageMetadata) {
        usageSnapshots.push({
          elapsedSec: Math.round((Date.now() - t0) / 1000),
          totalTokenCount: m.usageMetadata.totalTokenCount,
          promptTokenCount: m.usageMetadata.promptTokenCount,
          responseTokenCount: m.usageMetadata.responseTokenCount,
          details: m.usageMetadata.responseTokensDetails ?? null,
        })
      }
    }

    turn++
    await sleep(500)
  }

  session.close()

  const last = usageSnapshots.at(-1)
  const elapsedSec = Math.round((Date.now() - t0) / 1000)

  return {
    spike: "H.3",
    model: modelId,
    requestedDurationSec: durationSec,
    actualDurationSec: elapsedSec,
    turns: turn,
    usageSnapshots,
    finalTotalTokens: last?.totalTokenCount ?? null,
    extrapolated3MinTokens: last?.totalTokenCount
      ? Math.round((last.totalTokenCount / elapsedSec) * 180)
      : null,
    notes: [
      "Extrapolation assumes linear token growth; Live billing may include audio tokens separately.",
    ],
  }
}

async function main() {
  const which = process.argv[2] ?? "all"
  const out = { ranAt: new Date().toISOString(), results: [] }

  if (which === "all" || which === "h1") {
    console.error("=== H.1 silent context (2.5) ===")
    out.results.push(await spikeH1(MODELS.v25, "v25"))
    console.error("=== H.1 silent context (3.1) ===")
    out.results.push(await spikeH1(MODELS.v31, "v31"))
  }

  if (which === "all" || which === "h2") {
    console.error("=== H.2 Hebrew transcription (3.1) ===")
    out.results.push(await spikeH2(MODELS.v31))
    console.error("=== H.2 Hebrew transcription (2.5) ===")
    out.results.push(await spikeH2(MODELS.v25))
  }

  if (which === "all" || which === "h3") {
    const dur = Number(process.env.SPIKE_H3_SEC ?? "90")
    console.error(`=== H.3 usage (${dur}s, 3.1) ===`)
    out.results.push(await spikeH3(MODELS.v31, dur))
  }

  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
