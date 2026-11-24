import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { GoogleGenAI } from "../../packages/frontend/node_modules/@google/genai/dist/node/index.mjs"

const MODEL = "gemini-3.1-flash-tts-preview"
const VOICE = "Kore"

/** Synthesizes Hebrew speech and resamples it to signed 16-bit mono PCM at 16 kHz. */
export async function generateHebrewPcm16k(text, apiKey, cacheDir) {
  const cacheKey = createHash("sha1")
    .update(JSON.stringify([MODEL, VOICE, text]))
    .digest("hex")
  const cacheFile = cacheDir && join(cacheDir, `${cacheKey}.pcm`)
  if (cacheFile) {
    try {
      const data = readFileSync(cacheFile)
      if (data.length > 0 && data.length % 2 === 0) return data
      throw new Error("Invalid PCM cache entry")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }

  const ai = new GoogleGenAI({ apiKey })
  const iter = await ai.models.generateContentStream({
    model: MODEL,
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
    },
  })
  const chunks = []
  for await (const chunk of iter) {
    const b64 = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
    if (b64) chunks.push(Buffer.from(b64, "base64"))
  }
  if (chunks.length === 0) throw new Error("TTS produced no audio")

  const ff = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { input: Buffer.concat(chunks), maxBuffer: 16_000_000 },
  )
  if (ff.error) throw ff.error
  if (ff.status !== 0 || ff.stdout.length === 0) {
    throw new Error(`ffmpeg failed: ${ff.stderr.toString()}`)
  }
  if (cacheFile) {
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 })
    const stagingFile = `${cacheFile}.${process.pid}.part`
    writeFileSync(stagingFile, ff.stdout, { mode: 0o600 })
    renameSync(stagingFile, cacheFile)
  }
  return ff.stdout
}
