#!/usr/bin/env bun
/**
 * Probe for §H.7 — "one voice-output mechanism".
 *
 * §H.7 decided the Live session runs `responseModalities: [TEXT]` and emits no
 * audio at all; every spoken word goes through the existing TTS pipeline. That
 * decision was never tested — the H.1/H.2/H.3 spike ran [AUDIO] throughout.
 *
 * This probe answers four questions that the whole surface rests on:
 *   1. Does a Live session even open with responseModalities:[TEXT]?
 *   2. Does inputAudioTranscription still yield Hebrew transcript in TEXT mode?
 *   3. Does the model reply in text (and NOT emit inlineData audio)?
 *   4. Does function-calling work in TEXT mode? (the entire action surface)
 *
 * Usage:
 *   GEMINI_API_KEY=... bun scripts/probe-live-text-only.mjs
 *
 * Kept as a run artifact (mission §11ב): verifiers re-run it instead of
 * trusting a summary of it.
 */

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GoogleGenAI, Modality } from "../packages/frontend/node_modules/@google/genai/dist/node/index.mjs"

const API_KEY = process.env.GEMINI_API_KEY
if (!API_KEY) {
  console.error("GEMINI_API_KEY required")
  process.exit(1)
}

const ai = new GoogleGenAI({ apiKey: API_KEY })
const MODEL = "gemini-3.1-flash-live-preview"
const MODALITY = (process.env.PROBE_MODALITY ?? "TEXT").toUpperCase()
const HEBREW_PHRASE = "תעביר לסוכן שיתקן את הבאג"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Same generator the H.2 spike used: Gemini TTS 24k -> ffmpeg -> 16k PCM. */
async function generateHebrewPcm16k(text) {
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

  const dir = mkdtempSync(join(tmpdir(), "live-probe-"))
  const pcm24 = join(dir, "he24.pcm")
  writeFileSync(pcm24, Buffer.concat(chunks))
  const pcm16 = join(dir, "he16.pcm")
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm24,
     "-ar", "16000", "-ac", "1", "-f", "s16le", pcm16],
    { encoding: "utf8" },
  )
  if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr}`)
  const audio = readFileSync(pcm16)
  rmSync(dir, { recursive: true, force: true })
  return audio
}

const isHebrewScript = (t) => /[֐-׿]/.test(t ?? "")

/** The one action that matters most for the probe: forward to the coding agent. */
const FORWARD_TOOL = {
  functionDeclarations: [
    {
      name: "forward",
      description:
        "Forward the user's request to the coding agent. Use this whenever the user " +
        "asks for code work. Returns a receipt immediately; the answer arrives elsewhere.",
      parameters: {
        type: "OBJECT",
        properties: {
          request: { type: "STRING", description: "The request, phrased in full." },
        },
        required: ["request"],
      },
    },
  ],
}

async function probe() {
  const msgs = []
  let opened = false
  let openErr = null

  let resolveOpen, rejectOpen
  const openP = new Promise((res, rej) => {
    resolveOpen = res
    rejectOpen = rej
    setTimeout(() => rej(new Error("open timeout 20s")), 20_000)
  })

  const session = await ai.live.connect({
    model: MODEL,
    config: {
      responseModalities: [MODALITY === "AUDIO" ? Modality.AUDIO : Modality.TEXT],  // <-- §H.7 under test
      inputAudioTranscription: {},
      tools: [FORWARD_TOOL],
      systemInstruction: {
        parts: [{
          text: "You are a voice secretary for a coding assistant. When the user asks " +
                "for code work, call the forward tool. Reply in Hebrew, one short sentence.",
        }],
      },
      thinkingConfig: { thinkingBudget: 0 },
    },
    callbacks: {
      onopen: () => { opened = true; resolveOpen?.() },
      onmessage: (m) => msgs.push(m),
      onerror: (e) => { openErr = e; rejectOpen?.(e) },
      onclose: () => {},
    },
  })

  await openP.catch((e) => { openErr = openErr ?? e })
  await sleep(300)

  const pcm = await generateHebrewPcm16k(HEBREW_PHRASE)

  const CHUNK = 3200 // 100ms @ 16kHz mono s16le
  for (let i = 0; i < pcm.length; i += CHUNK) {
    const slice = pcm.subarray(i, i + CHUNK)
    session.sendRealtimeInput({
      audio: { data: Buffer.from(slice).toString("base64"), mimeType: "audio/pcm;rate=16000" },
    })
    await sleep(20)
  }
  session.sendRealtimeInput({ audioStreamEnd: true })

  // wait for turn completion or timeout
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (msgs.some((m) => m.serverContent?.turnComplete)) break
    if (msgs.some((m) => m.toolCall)) break
    await sleep(200)
  }
  await sleep(1500)
  try { session.close() } catch {}

  const inputTranscript = msgs
    .map((m) => m.serverContent?.inputTranscription?.text ?? "")
    .join("")
  const modelText = msgs
    .flatMap((m) => m.serverContent?.modelTurn?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
  const modelAudioParts = msgs
    .flatMap((m) => m.serverContent?.modelTurn?.parts ?? [])
    .filter((p) => p.inlineData?.data).length
  const toolCalls = msgs
    .flatMap((m) => m.toolCall?.functionCalls ?? [])
    .map((f) => ({ name: f.name, args: f.args }))
  const usage = msgs.map((m) => m.usageMetadata).filter(Boolean).at(-1) ?? null

  return {
    model: MODEL,
    modality: MODALITY,
    spokenPhrase: HEBREW_PHRASE,
    q1_sessionOpened: opened,
    openError: openErr ? String(openErr?.message ?? openErr) : null,
    q2_inputTranscript: inputTranscript,
    q2_transcriptIsHebrew: isHebrewScript(inputTranscript),
    q3_modelText: modelText,
    q3_modelAudioPartCount: modelAudioParts,   // MUST be 0 for §H.7 to hold
    q4_toolCalls: toolCalls,
    q4_functionCallingWorks: toolCalls.length > 0,
    frameCount: msgs.length,
    usageMetadata: usage
      ? { total: usage.totalTokenCount, prompt: usage.promptTokenCount,
          responseModalities: (usage.responseTokensDetails ?? []).map((d) => d.modality) }
      : null,
  }
}

probe()
  .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0) })
  .catch((e) => { console.error("PROBE FAILED:", e?.stack ?? e); process.exit(1) })
