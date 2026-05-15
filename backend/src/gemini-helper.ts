/**
 * Gemini Helper — מודול עזר לנגישות אודיו דרך Gemini Flash Lite.
 *
 * מספק שני שירותים:
 * - `translateThought(text)` — תרגום reasoning של המודל מאנגלית לעברית
 *   טבעית להקראה.
 * - `narrateToolCall(ctx, tool)` — ניסוח משפט קצר טבעי בעברית שמתאר
 *   מה הסוכן הולך לעשות, על בסיס ההקשר.
 *
 * שני השירותים:
 * - משתמשים ב-`gemini-flash-lite-latest` (זול, מהיר, אליאס מתעדכן).
 * - מפעילים timeouts קצרים — אם המודל איטי, חוזרים ל-fallback.
 * - מטמינים תוצאות מוצלחות ב-Map (בלי TTL — POC).
 * - אסור שיעצרו את ה-flow. כל כשל מחזיר fallback.
 *
 * המפתח מוזרק על-ידי OneCLI כ-`x-goog-api-key` header — כאן placeholder.
 */

import { GoogleGenAI, createUserContent } from "@google/genai";

export const DEFAULT_MODEL = "gemini-flash-lite-latest";
export const TRANSLATE_TIMEOUT_MS = 2500;
export const NARRATE_TIMEOUT_MS = 1500;

/**
 * Minimal interface used by the helper from a Gemini-like client.
 * The real `GoogleGenAI` instance satisfies this; tests pass a mock.
 */
export interface GeminiLike {
  models: {
    generateContent(opts: {
      model: string;
      contents: unknown;
    }): Promise<{ text?: string }>;
  };
}

/**
 * Wraps a promise with a timeout. If the time runs out, resolves with
 * `fallback` instead of throwing. The original promise keeps running in
 * the background — there's no AbortController (POC simplicity).
 */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export const TRANSLATE_PROMPT_PREFIX =
  `Translate the following text into natural spoken Hebrew, suitable for
being read aloud through TTS. Output ONLY the Hebrew translation —
no commentary, no quotes, no English, no markdown.

Text:
`;

export interface NarrateContext {
  /** מה המשתמש אמר לסוכן בסיבוב הזה (transcript). */
  userMessage: string;
  /** עד 3 ההודעות האחרונות של הסוכן (סדר כרונולוגי, ישנה→חדשה). */
  recentMessages: string[];
}

export interface ToolCallForNarrate {
  /** מזהה ייחודי של ה-tool call — משמש כ-cache key. */
  toolCallId: string;
  /** סוג ה-tool (read/edit/execute/search/think/...). אופציונלי. */
  kind?: string;
  /** כותרת הגולמית כפי שהמודל סיפק. */
  title: string;
}

export const NARRATE_EXAMPLES =
  `Examples:
- Tool: read README.md          → "אני בודק את ה-README כדי לראות מה הפרויקט"
- Tool: execute bash "ls"       → "אני מציץ מה יש בתיקייה"
- Tool: edit hello.js           → "מעדכן את הפונקציה שדיברנו עליה"
- Tool: execute "npm run build" → "מריץ build לראות שאין שגיאות"`;

/**
 * Builds the narration prompt — pure, exported for tests.
 */
export function buildNarratePrompt(
  ctx: NarrateContext,
  tool: ToolCallForNarrate,
): string {
  const recent = ctx.recentMessages.length
    ? ctx.recentMessages.join(" · ")
    : "—";
  return `You are narrating a coding assistant's actions out loud in Hebrew.
Given the user's request and recent context, describe in ONE short
conversational Hebrew sentence what the assistant is about to do —
and WHY in this context. Don't list parameters; explain the intent.
Don't repeat the user's words verbatim.

${NARRATE_EXAMPLES}

User said: "${ctx.userMessage}"
Recent assistant context: ${recent}

Tool: ${tool.kind ?? "?"} — ${tool.title}

Output ONLY the Hebrew sentence (no quotes, no markdown).`;
}

/**
 * Factory: creates a helper with its own caches and AI client.
 *
 * The default singleton (`translateThought`, `narrateToolCall`) is
 * created at module bottom using the real `GoogleGenAI`. Tests build
 * their own instance with a mock `GeminiLike`.
 */
export function createGeminiHelper(
  ai: GeminiLike,
  opts: {
    translateTimeoutMs?: number;
    narrateTimeoutMs?: number;
    model?: string;
  } = {},
): {
  translateThought: (text: string) => Promise<string | null>;
  narrateToolCall: (
    ctx: NarrateContext,
    tool: ToolCallForNarrate,
  ) => Promise<string>;
  /** Test helper: clears both caches. */
  resetCaches: () => void;
  /** Test helper: peek at cache sizes. */
  cacheSizes: () => { translations: number; narrations: number };
} {
  const model = opts.model ?? DEFAULT_MODEL;
  const translateTimeoutMs = opts.translateTimeoutMs ?? TRANSLATE_TIMEOUT_MS;
  const narrateTimeoutMs = opts.narrateTimeoutMs ?? NARRATE_TIMEOUT_MS;

  const translationCache = new Map<string, string>();
  const narrationCache = new Map<string, string>(); // key = toolCallId

  async function translateThought(text: string): Promise<string | null> {
    const key = text.trim();
    if (!key) return null;

    const cached = translationCache.get(key);
    if (cached !== undefined) return cached;

    const call = (async (): Promise<string | null> => {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: createUserContent([TRANSLATE_PROMPT_PREFIX + key]),
        });
        const out = (response.text ?? "").trim();
        return out || null;
      } catch (e) {
        console.error(
          `[gemini-helper] translateThought נכשל: ${(e as Error).message}`,
        );
        return null;
      }
    })();

    const result = await withTimeout<string | null>(
      call,
      translateTimeoutMs,
      null,
    );
    if (result !== null) {
      translationCache.set(key, result);
    }
    return result;
  }

  async function narrateToolCall(
    ctx: NarrateContext,
    tool: ToolCallForNarrate,
  ): Promise<string> {
    const fallback = tool.title.trim() || tool.kind || "פעולה";

    const cached = narrationCache.get(tool.toolCallId);
    if (cached !== undefined) return cached;

    const prompt = buildNarratePrompt(ctx, tool);

    const call = (async () => {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: createUserContent([prompt]),
        });
        const out = (response.text ?? "").trim();
        if (!out) return fallback;
        return out;
      } catch (e) {
        console.error(
          `[gemini-helper] narrateToolCall נכשל: ${(e as Error).message}`,
        );
        return fallback;
      }
    })();

    const result = await withTimeout(call, narrateTimeoutMs, fallback);
    if (result && result !== fallback) {
      narrationCache.set(tool.toolCallId, result);
    }
    return result;
  }

  return {
    translateThought,
    narrateToolCall,
    resetCaches: () => {
      translationCache.clear();
      narrationCache.clear();
    },
    cacheSizes: () => ({
      translations: translationCache.size,
      narrations: narrationCache.size,
    }),
  };
}

// ── Default singleton — wraps the real GoogleGenAI for production ────────────
const defaultHelper = createGeminiHelper(
  new GoogleGenAI({ apiKey: "placeholder" }),
);
export const translateThought = defaultHelper.translateThought;
export const narrateToolCall = defaultHelper.narrateToolCall;

// CLI entrypoint לבדיקה עצמאית:
//   bun src/gemini-helper.ts "I should check the README first to understand the project."
if (import.meta.main) {
  const arg = process.argv.slice(2).join(" ").trim();
  if (!arg) {
    console.error('שימוש: bun src/gemini-helper.ts "<english text>"');
    process.exit(1);
  }
  const start = Date.now();
  const result = await translateThought(arg);
  const elapsed = Date.now() - start;
  console.log(
    `(${elapsed}ms): ${result === null ? "[null — נכשל]" : result}`,
  );
}
