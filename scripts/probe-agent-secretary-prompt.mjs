#!/usr/bin/env bun
/**
 * probe-agent-secretary-prompt — gate 7 (§5ב) for slice agent-secretary-prompt.
 *
 * Compares model behavior with vs without secretary tag + one-shot agent instruction.
 * Requires `claude` (or pass CLI=claude) on PATH with working API credentials.
 *
 * Usage:
 *   bun scripts/probe-agent-secretary-prompt.mjs
 *   bun scripts/probe-agent-secretary-prompt.mjs --model haiku
 */

import { spawnSync } from "node:child_process"
import {
  buildLiveAgentPrompt,
  formatSecretaryToAgent,
  LIVE_SECRETARY_TO_AGENT_MARKER,
} from "../packages/core/src/voice/live-agent-prompt.ts"

const QUESTION = "סכם בקצרה מה ההבדל בין map ל-flatMap. אפשר בטבלה."
const modelFlag = process.argv.includes("--model")
  ? process.argv[process.argv.indexOf("--model") + 1]
  : "haiku"

function runClaude(prompt) {
  const args = ["-p", prompt, "--model", modelFlag]
  const result = spawnSync("claude", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
  if (result.error) {
    console.error("BLOCKED: claude not runnable:", result.error.message)
    process.exit(2)
  }
  if (result.status !== 0) {
    console.error("BLOCKED: claude exit", result.status, result.stderr?.slice(0, 500))
    process.exit(2)
  }
  return result.stdout.trim()
}

function hasTable(text) {
  return /\|.+\|/.test(text) || /^\s*\|[-:]+\|/m.test(text)
}

function score(text) {
  return { hasTable: hasTable(text), lines: text.split("\n").length, chars: text.length }
}

console.log("=== probe-agent-secretary-prompt (gate 7) ===")
console.log(`model=${modelFlag} marker=${LIVE_SECRETARY_TO_AGENT_MARKER}`)

const taggedPrompt = `${buildLiveAgentPrompt()}\n\n${formatSecretaryToAgent(QUESTION)}`
const untaggedPrompt = QUESTION

console.log("\n--- WITH instruction + tag ---")
const taggedOut = runClaude(taggedPrompt)
const taggedScore = score(taggedOut)
console.log(taggedOut)
console.log("score:", taggedScore)

console.log("\n--- WITHOUT instruction or tag (mutation) ---")
const untaggedOut = runClaude(untaggedPrompt)
const untaggedScore = score(untaggedOut)
console.log(untaggedOut)
console.log("score:", untaggedScore)

const behaviorChanged =
  taggedScore.hasTable !== untaggedScore.hasTable ||
  taggedScore.chars < untaggedScore.chars * 0.85

console.log("\n=== verdict ===")
console.log("behaviorChanged:", behaviorChanged)
if (!behaviorChanged) {
  console.error("NO-GO: tag/instruction did not change model behavior")
  process.exit(1)
}
console.log("GO: removal of tag/instruction changes response (not decorative)")
