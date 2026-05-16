/**
 * Narration module — generates short Hebrew sentences describing what
 * the agent is about to do, based on the current tool call and context.
 *
 * Ported from v1 gemini-helper.ts (buildNarratePrompt + narrateToolCall).
 * v2 changes:
 *   - Returns Result<string, string> (neverthrow) instead of string fallback.
 *   - Cache uses generic Cache<NarrationValue> (disk-backed, namespaced).
 *   - Generator interface is decoupled from @google/genai for testability.
 */

import type { Cache } from "@drive-coding/core/cache/types"
import type { Result } from "neverthrow"
import { err, ok } from "neverthrow"

/** Default narration timeout in ms (shorter than translation: text is usually 1-2 sentences). */
export const NARRATE_TIMEOUT_MS = 1500

// ─── Context / Tool types ─────────────────────────────────────

export interface NarrateContext {
  /** What the user said (post-STT). */
  userMessage: string
  /** FIFO max 3 of recent assistant messages (for context). */
  recentMessages: string[]
}

export interface ToolCallForNarrate {
  /** Unique tool call ID — used as cache key. */
  toolCallId: string
  /** ACP ToolKind: read/edit/execute/search/think/... */
  kind?: string
  /** Raw title as supplied by the model. */
  title: string
}

/** Value stored in the narration cache. */
export interface NarrationValue {
  text: string
  toolTitle: string
  createdAt: string // ISO timestamp
}

// ─── Generator interface ──────────────────────────────────────

/**
 * Minimal generator interface — decoupled from @google/genai for testability.
 * Production adapters wrap generateText() from the ai SDK.
 */
export interface NarrationGenerator {
  generateContent(prompt: string): Promise<string>
}

// ─── Examples (exported for tests) ───────────────────────────

export const NARRATE_EXAMPLES = `Examples:
- Tool: read README.md          → "אני בודק את ה-README כדי לראות מה הפרויקט"
- Tool: execute bash "ls"       → "אני מציץ מה יש בתיקייה"
- Tool: edit hello.js           → "מעדכן את הפונקציה שדיברנו עליה"
- Tool: execute "npm run build" → "מריץ build לראות שאין שגיאות"`

// ─── buildNarratePrompt — pure ────────────────────────────────

/**
 * Builds the narration prompt. Pure function — exported for tests.
 * Ported from v1 gemini-helper.ts:buildNarratePrompt.
 */
export function buildNarratePrompt(ctx: NarrateContext, tool: ToolCallForNarrate): string {
  const recent = ctx.recentMessages.length ? ctx.recentMessages.join(" · ") : "—"
  return `You are narrating a coding assistant's actions out loud in Hebrew.
Given the user's request and recent context, describe in ONE short
conversational Hebrew sentence what the assistant is about to do —
and WHY in this context. Don't list parameters; explain the intent.
Don't repeat the user's words verbatim.

${NARRATE_EXAMPLES}

User said: "${ctx.userMessage}"
Recent assistant context: ${recent}

Tool: ${tool.kind ?? "?"} — ${tool.title}

Output ONLY the Hebrew sentence (no quotes, no markdown).`
}

// ─── narrateToolCall — async ──────────────────────────────────

/**
 * Generates a short Hebrew narration for a tool call.
 *
 * Cache key is the toolCallId (stable within a session).
 * On cache hit: returns cached text immediately.
 * On cache miss: calls LLM, stores result, returns it.
 * On LLM error or timeout: returns Err.
 * On LLM empty result: returns Ok(fallback) where fallback = title || kind.
 */
export async function narrateToolCall(
  ctx: NarrateContext,
  tool: ToolCallForNarrate,
  generator: NarrationGenerator,
  cache: Cache<NarrationValue>,
  opts: { timeoutMs?: number } = {},
): Promise<Result<string, string>> {
  const timeoutMs = opts.timeoutMs ?? NARRATE_TIMEOUT_MS

  // Cache hit — return without calling LLM
  const cached = await cache.get(tool.toolCallId)
  if (cached !== null) {
    return ok(cached.text)
  }

  const fallback = tool.title.trim() || tool.kind || "פעולה"
  const prompt = buildNarratePrompt(ctx, tool)

  // Race: LLM call vs. timeout
  let timedOut = false
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => {
      timedOut = true
      reject(new Error(`Narration timeout after ${timeoutMs}ms`))
    }, timeoutMs),
  )

  let rawText: string
  try {
    rawText = await Promise.race([generator.generateContent(prompt), timeoutPromise])
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (timedOut) {
      return err(`Narration timeout after ${timeoutMs}ms`)
    }
    return err(`Narration failed: ${msg}`)
  }

  const text = rawText.trim() || fallback

  // Store in cache
  await cache.set(tool.toolCallId, {
    text,
    toolTitle: tool.title,
    createdAt: new Date().toISOString(),
  })

  return ok(text)
}
