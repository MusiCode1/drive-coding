#!/usr/bin/env bun
/**
 * יוצר קובץ אודיו MP3 דרך ElevenLabs v3.
 *
 * הרצה (מroot הפרויקט):
 *   export NO_PROXY=localhost,127.0.0.1,::1; export no_proxy=$NO_PROXY
 *   onecli run --agent voice-acp -- bun scripts/generate-test-audio.ts [options] <text>
 *
 * הערה: scripts/package.json מגדיר deps. הרץ `cd scripts && bun install` אם חסר node_modules.
 */

import { createElevenLabs } from "@ai-sdk/elevenlabs"
import { experimental_generateSpeech as generateSpeech } from "ai"

// ── Parse args ──────────────────────────────────────────────────────────────

const VOICES: Record<string, string> = {
  sarah: "EXAVITQu4vr4xnSDxMaL", // Mature, Reassuring (default)
  roger: "CwhRBWXzGAHq8TQ4Fs17", // Laid-Back, Casual
  laura: "FGY2WhTYpPnrIDTdsKH5", // Enthusiast, Quirky
  charlie: "IKne3meq5aSn9XLyUdCD", // Deep, Confident
  george: "JBFqnCBsd6RMkjVDRZzb", // Warm, Storyteller
  callum: "N2lVS1w4EtoT3dr4eOWO", // Husky
  river: "SAz9YHcvj6GT2YYXdXww", // Relaxed, Neutral
  alice: "Xb7hH8MSUJpSbSDYk0k2", // Clear, Engaging
  liam: "TX3LPaxmHKxFdv7VOQHJ", // Energetic
}

let text = ""
let outPath = "/tmp/test-voice.mp3"
let voiceName = "sarah"
let showHelp = false
let listVoices = false

const args = process.argv.slice(2)
let i = 0
while (i < args.length) {
  const arg = args[i]
  if (arg === undefined) break
  if (arg === "--help" || arg === "-h") {
    showHelp = true
    break
  } else if (arg === "--voices") {
    listVoices = true
    break
  } else if ((arg === "--voice" || arg === "-v") && args[i + 1]) {
    voiceName = (args[i + 1] ?? "").toLowerCase()
    i += 2
  } else if ((arg === "--out" || arg === "-o") && args[i + 1]) {
    outPath = args[i + 1] ?? outPath
    i += 2
  } else if (!arg.startsWith("-")) {
    text = arg
    i++
  } else {
    console.error(`ארגומנט לא מוכר: ${arg}`)
    showHelp = true
    break
  }
}

// ── Help ─────────────────────────────────────────────────────────────────────

if (showHelp || (!text && !listVoices)) {
  console.log(
    `
יוצר קובץ אודיו MP3 דרך ElevenLabs v3.

שימוש:
  onecli run --agent voice-acp -- bun scripts/generate-test-audio.ts [options] <text>

פרמטרים:
  <text>              הטקסט להקראה (חובה)
  -o, --out <path>    נתיב קובץ פלט (ברירת מחדל: /tmp/test-voice.mp3)
  -v, --voice <name>  שם קול (ברירת מחדל: sarah)
  --voices            הצג רשימת קולות זמינים
  -h, --help          הצג עזרה

דוגמאות:
  bun scripts/generate-test-audio.ts "שלום, מה שלומך?"
  bun scripts/generate-test-audio.ts -v roger -o /tmp/roger.mp3 "בדיקת קול"
  bun scripts/generate-test-audio.ts --voice alice "תכתוב לי פונקציה"
  bun scripts/generate-test-audio.ts --voices

הערות:
  - חייב לרוץ דרך OneCLI: onecli run --agent voice-acp -- bun ...
  - חייב NO_PROXY=localhost,127.0.0.1,::1 (אחרת OneCLI proxy חוסם localhost)
  - כל הקולות תומכים עברית דרך eleven_v3
`.trim(),
  )
  process.exit(showHelp ? 0 : 1)
}

if (listVoices) {
  console.log("קולות זמינים:\n")
  console.log("  שם          voice_id                          תיאור")
  console.log("  ─────────── ───────────────────────────────── ──────────────────────")
  const descriptions: Record<string, string> = {
    sarah: "Mature, Reassuring, Confident",
    roger: "Laid-Back, Casual, Resonant",
    laura: "Enthusiast, Quirky Attitude",
    charlie: "Deep, Confident, Energetic",
    george: "Warm, Captivating Storyteller",
    callum: "Husky Trickster",
    river: "Relaxed, Neutral, Informative",
    alice: "Clear, Engaging Educator",
    liam: "Energetic, Social Media Creator",
  }
  for (const [name, id] of Object.entries(VOICES)) {
    const desc = descriptions[name] ?? ""
    console.log(`  ${name.padEnd(12)} ${id}  ${desc}`)
  }
  console.log(`\nברירת מחדל: sarah`)
  process.exit(0)
}

// ── Resolve voice ────────────────────────────────────────────────────────────

let voiceId = VOICES[voiceName]
if (!voiceId) {
  // Maybe they passed a raw voice_id
  if (voiceName.length > 10) {
    voiceId = voiceName
  } else {
    console.error(`קול לא מוכר: "${voiceName}". הרץ --voices לרשימה.`)
    process.exit(1)
  }
}

// ── Generate ─────────────────────────────────────────────────────────────────

const el = createElevenLabs({ apiKey: "onecli-injects-this-at-proxy" })

const result = await generateSpeech({
  model: el.speech("eleven_v3"),
  text,
  voice: voiceId,
})

await Bun.write(outPath, result.audio.uint8Array)
console.log(`${result.audio.uint8Array.length} bytes → ${outPath}`)
