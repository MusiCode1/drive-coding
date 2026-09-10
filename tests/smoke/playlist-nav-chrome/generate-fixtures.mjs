#!/usr/bin/env node
/**
 * Generate 20 MP3 fixtures for playlist-nav-chrome harness.
 * Duration: 5 + i*0.25 s, unique sine frequency per file.
 * Run on host (ffmpeg), not in linux-gui container.
 */
import { execSync } from "node:child_process"
import { mkdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dir, "../../../packages/frontend/static/fixtures/playlist-nav-chrome")

try {
  execSync("ffmpeg -version", { stdio: "ignore" })
} catch {
  console.error("ffmpeg not found — install ffmpeg on host")
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })

for (let i = 0; i < 20; i++) {
  const duration = 5 + i * 0.25
  const freq = 220 + i * 37
  const out = join(OUT_DIR, `seg-${String(i).padStart(2, "0")}.mp3`)
  if (existsSync(out)) {
    console.log(`skip ${out} (exists)`)
    continue
  }
  const cmd = [
    "ffmpeg -y -hide_banner -loglevel error",
    `-f lavfi -i "sine=frequency=${freq}:duration=${duration}"`,
    "-c:a libmp3lame -q:a 4",
    `"${out}"`,
  ].join(" ")
  execSync(cmd, { shell: true, stdio: "inherit" })
  console.log(`wrote ${out} (${duration}s @ ${freq}Hz)`)
}

console.log(`Done — ${OUT_DIR}`)
