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

const DEFAULT_MODEL = "gemini-flash-lite-latest";
const TRANSLATE_TIMEOUT_MS = 2500;
const NARRATE_TIMEOUT_MS = 1500;

// instance יחיד — OneCLI מטפל ב-auth בדרך
const ai = new GoogleGenAI({ apiKey: "placeholder" });

// caches in-memory (POC — אין eviction)
const translationCache = new Map<string, string>();
const narrationCache = new Map<string, string>(); // key = toolCallId

/**
 * עוטף promise ב-timeout. אם הזמן עבר — מחזיר fallback בלי לזרוק.
 * ה-promise המקורי ממשיך לרוץ ברקע (לא נקטע); נראה אם זה מטיל עומס,
 * נוסיף AbortController בגרסה הבאה.
 */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const TRANSLATE_PROMPT_PREFIX =
  `Translate the following text into natural spoken Hebrew, suitable for
being read aloud through TTS. Output ONLY the Hebrew translation —
no commentary, no quotes, no English, no markdown.

Text:
`;

/**
 * מתרגם reasoning (בדרך-כלל אנגלית) לעברית מדוברת טבעית להקראה.
 *
 * - cache hit → החזר מיד.
 * - timeout 2500ms → `null`.
 * - כל שגיאה → `null`.
 * - תוצאה ריקה → `null`.
 * - תוצאה מוצלחת → cache + החזר.
 *
 * הקוראים אחראים לבדוק `null` ולדלג על TTS/תצוגת תרגום במקרה הזה —
 * הקראה של הטקסט האנגלי בקול עברי נשמעת מסולפת ומבלבלת.
 */
export async function translateThought(text: string): Promise<string | null> {
  const key = text.trim();
  if (!key) return null;

  const cached = translationCache.get(key);
  if (cached !== undefined) return cached;

  const call = (async (): Promise<string | null> => {
    try {
      const response = await ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: createUserContent([TRANSLATE_PROMPT_PREFIX + key]),
      });
      const out = (response.text ?? "").trim();
      return out || null;
    } catch (e) {
      console.error(`[gemini-helper] translateThought נכשל: ${(e as Error).message}`);
      return null;
    }
  })();

  const result = await withTimeout<string | null>(
    call,
    TRANSLATE_TIMEOUT_MS,
    null,
  );
  if (result !== null) {
    translationCache.set(key, result);
  }
  return result;
}

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

const NARRATE_EXAMPLES =
  `Examples:
- Tool: read README.md          → "אני בודק את ה-README כדי לראות מה הפרויקט"
- Tool: execute bash "ls"       → "אני מציץ מה יש בתיקייה"
- Tool: edit hello.js           → "מעדכן את הפונקציה שדיברנו עליה"
- Tool: execute "npm run build" → "מריץ build לראות שאין שגיאות"`;

/**
 * מנסח משפט קצר בעברית שמתאר מה הסוכן הולך לעשות, על בסיס ההקשר.
 *
 * - cache hit לפי toolCallId → החזר מיד.
 * - timeout 1500ms → fallback ל-title הגולמי.
 * - כל שגיאה → fallback ל-title הגולמי.
 * - תוצאה מוצלחת ולא ריקה → cache.
 */
export async function narrateToolCall(
  ctx: NarrateContext,
  tool: ToolCallForNarrate,
): Promise<string> {
  const fallback = tool.title.trim() || tool.kind || "פעולה";

  const cached = narrationCache.get(tool.toolCallId);
  if (cached !== undefined) return cached;

  const recent = ctx.recentMessages.length
    ? ctx.recentMessages.join(" · ")
    : "—";

  const prompt = `You are narrating a coding assistant's actions out loud in Hebrew.
Given the user's request and recent context, describe in ONE short
conversational Hebrew sentence what the assistant is about to do —
and WHY in this context. Don't list parameters; explain the intent.
Don't repeat the user's words verbatim.

${NARRATE_EXAMPLES}

User said: "${ctx.userMessage}"
Recent assistant context: ${recent}

Tool: ${tool.kind ?? "?"} — ${tool.title}

Output ONLY the Hebrew sentence (no quotes, no markdown).`;

  const call = (async () => {
    try {
      const response = await ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: createUserContent([prompt]),
      });
      const out = (response.text ?? "").trim();
      if (!out) return fallback;
      return out;
    } catch (e) {
      console.error(`[gemini-helper] narrateToolCall נכשל: ${(e as Error).message}`);
      return fallback;
    }
  })();

  const result = await withTimeout(call, NARRATE_TIMEOUT_MS, fallback);
  if (result && result !== fallback) {
    narrationCache.set(tool.toolCallId, result);
  }
  return result;
}

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
