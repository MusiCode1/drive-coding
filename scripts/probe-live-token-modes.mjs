#!/usr/bin/env bun
/**
 * probe-live-token-modes.mjs — which ephemeral-token shape keeps function-calling alive?
 *
 * Run artifact for the `live-contract-gemini` slice (mission §9: verifiers re-run
 * the probe instead of trusting a summary of it).
 *
 * The question it answers: §E of the pre-brief says the BE mints an ephemeral token
 * and the browser talks to Google directly. It does NOT say what to put in
 * `liveConnectConstraints`. That turns out to decide whether the secretary can act
 * at all: `liveConnectConstraints.config` REPLACES the client's config rather than
 * constraining it, so a token minted with a partial config silently drops the
 * client's `tools` — the session opens, the voice is right, the transcript is right,
 * and the model simply never calls a function. No error anywhere.
 *
 * Modes:
 *   raw         no token at all — raw API key (control)
 *   tok-plain   token, no liveConnectConstraints
 *   tok-constr  token, constraints = { model, config: { responseModalities } }
 *   tok-model   token, constraints = { model }   (no config)
 *   tok-full    token, constraints = full session config (modalities + transcription
 *               + speechConfig + tools + systemInstruction)
 *
 * Usage:
 *   GEMINI_API_KEY=... bun scripts/probe-live-token-modes.mjs
 *   MODES=raw,tok-full N=3 bun scripts/probe-live-token-modes.mjs
 *
 * The prompt is deliberately CONCRETE. A vague request ("fix the bug") makes the
 * model ask a clarifying question instead of calling a tool ~50% of the time, which
 * makes any gate built on it flaky. A request with nothing left to clarify does not.
 */

import {
  GoogleGenAI,
  Modality,
} from "../packages/frontend/node_modules/@google/genai/dist/node/index.mjs"

const KEY = process.env.GEMINI_API_KEY
if (!KEY) {
  console.error("GEMINI_API_KEY required")
  process.exit(1)
}

const MODEL = process.env.LIVE_MODEL ?? "gemini-3.1-flash-live-preview"
const VOICE = process.env.LIVE_VOICE ?? "Puck"
const N = Number(process.env.N ?? 2)
const MODES = (process.env.MODES ?? "raw,tok-plain,tok-constr,tok-model,tok-full").split(",")
/** Concrete on purpose — and it carries a technical identifier we can check survives. */
const PHRASE = process.env.PHRASE ?? "תבקש מהסוכן להריץ את הטסטים בקובץ auth.test.ts"
const IDENTIFIER = process.env.IDENTIFIER ?? "auth.test.ts"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "compose_prompt",
        description:
          "נסח ושלח בקשה לסוכן הקוד בשם המשתמש. מחזיר קבלה מיידית; התשובה מגיעה בערוץ אחר.",
        parameters: {
          type: "OBJECT",
          properties: { text: { type: "STRING", description: "הבקשה המנוסחת במלואה." } },
          required: ["text"],
        },
      },
      {
        name: "cancel_turn",
        description: "בטל את הריצה הנוכחית של הסוכן.",
        parameters: { type: "OBJECT", properties: {}, required: [] },
      },
    ],
  },
]

const SYSTEM_INSTRUCTION =
  "אתה מזכיר קולי לעוזר-קוד. כל בקשה שנוגעת לקוד — קרא מיד לכלי compose_prompt עם ניסוח מלא. " +
  "אל תשאל שאלות הבהרה. מזהים טכניים (שם קובץ, מספר שורה, פקודה, ערך) — צטט כלשונם, אל תנסח אותם מחדש."

/**
 * The one load-bearing object. Because `liveConnectConstraints.config` REPLACES the
 * client config rather than constraining it, this is simultaneously what the BE mints
 * with and what the client connects with — they cannot be allowed to diverge.
 *
 * `outputAudioTranscription` was added after measuring that it does NOT cost the tool
 * call (the assistant transcript is needed by the UI from `live-ears` onward).
 */
const SESSION_CONFIG = {
  responseModalities: [Modality.AUDIO],
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
  tools: TOOLS,
  systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
  thinkingConfig: { thinkingBudget: 0 },
  contextWindowCompression: { slidingWindow: {} },
}

function constraintsFor(mode) {
  if (mode === "tok-plain") return {}
  if (mode === "tok-constr")
    return {
      liveConnectConstraints: { model: MODEL, config: { responseModalities: [Modality.AUDIO] } },
    }
  if (mode === "tok-model") return { liveConnectConstraints: { model: MODEL } }
  if (mode === "tok-full")
    return { liveConnectConstraints: { model: MODEL, config: SESSION_CONFIG } }
  return {}
}

async function mint(mode) {
  // Ephemeral tokens are v1alpha-only — but ONLY for the mint call. Connecting on
  // v1alpha inflates promptTokenCount ~4x, so the session client stays on default.
  const admin = new GoogleGenAI({ apiKey: KEY, httpOptions: { apiVersion: "v1alpha" } })
  const tok = await admin.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
      ...constraintsFor(mode),
    },
  })
  return tok.name
}

async function once(mode) {
  const client =
    mode === "raw"
      ? new GoogleGenAI({ apiKey: KEY })
      : new GoogleGenAI({ apiKey: await mint(mode) })

  const frames = []
  let err = null
  const session = await client.live.connect({
    model: MODEL,
    config: SESSION_CONFIG,
    callbacks: {
      onmessage: (m) => frames.push(m),
      onerror: (e) => {
        err = String(e?.message ?? e)
      },
      onclose: (e) => {
        if (e?.reason) err = err ?? `close: ${e.reason}`
      },
    },
  })

  await sleep(1200)
  // role:"user" is MANDATORY on 3.1 — omitting it closes the session with
  // "Request contains an invalid argument."
  session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: PHRASE }] }],
    turnComplete: true,
  })

  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    if (frames.some((m) => m.toolCall)) break
    if (frames.some((m) => m.serverContent?.turnComplete)) break
    await sleep(200)
  }
  await sleep(600)
  try {
    session.close()
  } catch {}

  const calls = frames
    .flatMap((m) => m.toolCall?.functionCalls ?? [])
    .map((f) => ({ name: f.name, args: f.args }))
  const composed = calls.map((c) => String(c.args?.text ?? "")).join(" ")
  return {
    calledTool: calls.length > 0,
    calls,
    identifierSurvived: composed.includes(IDENTIFIER),
    frames: frames.length,
    err,
  }
}

const out = {}
for (const mode of MODES) {
  out[mode] = []
  for (let i = 0; i < N; i++) {
    try {
      out[mode].push(await once(mode))
    } catch (e) {
      out[mode].push({ error: String(e?.message ?? e) })
    }
  }
}
const summary = Object.fromEntries(
  Object.entries(out).map(([m, rs]) => [
    m,
    `${rs.filter((r) => r.calledTool).length}/${rs.length}`,
  ]),
)
console.log(
  JSON.stringify({ model: MODEL, voice: VOICE, phrase: PHRASE, summary, runs: out }, null, 2),
)
process.exit(0)
