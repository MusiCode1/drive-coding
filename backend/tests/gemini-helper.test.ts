/**
 * Tests for `createGeminiHelper` — translateThought + narrateToolCall.
 *
 * Uses a fake `GeminiLike` client to test timeout, cache, fallback, error
 * handling without hitting the real API.
 *
 * Behaviors documented in `docs/behaviors.md` (GEMINI-1..GEMINI-9).
 */

import { describe, expect, test } from "bun:test";
import {
  buildNarratePrompt,
  createGeminiHelper,
  withTimeout,
  type GeminiLike,
} from "../src/gemini-helper.ts";

// ── Test fakes ───────────────────────────────────────────────────────────────

/** A configurable fake Gemini client. */
function fakeAi(opts: {
  /** Result for every call (or override per call via array). */
  response?: { text?: string };
  /** Sequential responses — each call gets the next. */
  responses?: Array<{ text?: string }>;
  /** Delay in ms before resolving (default 0). */
  delayMs?: number;
  /** Throw this error instead of returning. */
  error?: Error;
}): GeminiLike & { callCount: number; receivedModels: string[] } {
  let callCount = 0;
  const receivedModels: string[] = [];
  const ai = {
    callCount: 0,
    receivedModels,
    models: {
      async generateContent(args: { model: string }) {
        callCount++;
        ai.callCount = callCount;
        receivedModels.push(args.model);
        if (opts.delayMs) {
          await new Promise((r) => setTimeout(r, opts.delayMs));
        }
        if (opts.error) throw opts.error;
        if (opts.responses) {
          return opts.responses[callCount - 1] ?? { text: "" };
        }
        return opts.response ?? { text: "" };
      },
    },
  };
  return ai;
}

// ── withTimeout — utility ────────────────────────────────────────────────────

describe("withTimeout — utility", () => {
  test("resolves with the original value if fast enough", async () => {
    const r = await withTimeout(Promise.resolve("ok"), 100, "fallback");
    expect(r).toBe("ok");
  });

  test("returns fallback if the promise takes too long", async () => {
    const slow = new Promise<string>((resolve) =>
      setTimeout(() => resolve("ok"), 200),
    );
    const r = await withTimeout(slow, 50, "fallback");
    expect(r).toBe("fallback");
  });

  test("fallback can be null", async () => {
    const slow = new Promise<string | null>((resolve) =>
      setTimeout(() => resolve("ok"), 200),
    );
    const r = await withTimeout<string | null>(slow, 50, null);
    expect(r).toBeNull();
  });
});

// ── translateThought ─────────────────────────────────────────────────────────

describe("translateThought — happy path (GEMINI-1)", () => {
  test("returns translated Hebrew text", async () => {
    const ai = fakeAi({ response: { text: "שלום עולם." } });
    const helper = createGeminiHelper(ai);
    const r = await helper.translateThought("Hello world.");
    expect(r).toBe("שלום עולם.");
  });

  test("uses the default model", async () => {
    const ai = fakeAi({ response: { text: "x" } });
    const helper = createGeminiHelper(ai);
    await helper.translateThought("foo");
    expect(ai.receivedModels[0]).toBe("gemini-flash-lite-latest");
  });

  test("custom model option overrides default", async () => {
    const ai = fakeAi({ response: { text: "x" } });
    const helper = createGeminiHelper(ai, { model: "custom-model" });
    await helper.translateThought("foo");
    expect(ai.receivedModels[0]).toBe("custom-model");
  });

  test("output is trimmed", async () => {
    const ai = fakeAi({ response: { text: "  שלום  \n" } });
    const helper = createGeminiHelper(ai);
    expect(await helper.translateThought("x")).toBe("שלום");
  });
});

describe("translateThought — failure modes (GEMINI-5, GEMINI-8)", () => {
  test("empty input → null without calling API", async () => {
    const ai = fakeAi({ response: { text: "should not be returned" } });
    const helper = createGeminiHelper(ai);
    expect(await helper.translateThought("")).toBeNull();
    expect(await helper.translateThought("   ")).toBeNull();
    expect(ai.callCount).toBe(0);
  });

  test("empty response → null", async () => {
    const ai = fakeAi({ response: { text: "" } });
    const helper = createGeminiHelper(ai);
    expect(await helper.translateThought("hello")).toBeNull();
  });

  test("undefined text → null", async () => {
    const ai = fakeAi({ response: {} });
    const helper = createGeminiHelper(ai);
    expect(await helper.translateThought("hello")).toBeNull();
  });

  test("whitespace-only response → null", async () => {
    const ai = fakeAi({ response: { text: "   \n  " } });
    const helper = createGeminiHelper(ai);
    expect(await helper.translateThought("hello")).toBeNull();
  });

  test("AI throws → null (no propagation)", async () => {
    const ai = fakeAi({ error: new Error("API down") });
    const helper = createGeminiHelper(ai);
    expect(await helper.translateThought("hello")).toBeNull();
  });

  test("timeout → null (GEMINI-3)", async () => {
    const ai = fakeAi({ delayMs: 500, response: { text: "too late" } });
    const helper = createGeminiHelper(ai, { translateTimeoutMs: 50 });
    expect(await helper.translateThought("hello")).toBeNull();
  });
});

describe("translateThought — cache (GEMINI-6)", () => {
  test("same input → second call hits cache (no API call)", async () => {
    const ai = fakeAi({ response: { text: "תרגום" } });
    const helper = createGeminiHelper(ai);
    await helper.translateThought("hello");
    await helper.translateThought("hello");
    expect(ai.callCount).toBe(1);
  });

  test("different input → no cache hit", async () => {
    const ai = fakeAi({ response: { text: "תרגום" } });
    const helper = createGeminiHelper(ai);
    await helper.translateThought("hello");
    await helper.translateThought("world");
    expect(ai.callCount).toBe(2);
  });

  test("trim is part of cache key (same after trim → hit)", async () => {
    const ai = fakeAi({ response: { text: "תרגום" } });
    const helper = createGeminiHelper(ai);
    await helper.translateThought("hello");
    await helper.translateThought("  hello  ");
    expect(ai.callCount).toBe(1);
  });

  test("null result is NOT cached — retries on next call", async () => {
    const ai = fakeAi({
      responses: [{ text: "" }, { text: "תרגום" }],
    });
    const helper = createGeminiHelper(ai);
    const r1 = await helper.translateThought("hello");
    const r2 = await helper.translateThought("hello");
    expect(r1).toBeNull();
    expect(r2).toBe("תרגום");
    expect(ai.callCount).toBe(2);
  });

  test("cacheSizes / resetCaches", async () => {
    const ai = fakeAi({ response: { text: "תרגום" } });
    const helper = createGeminiHelper(ai);
    expect(helper.cacheSizes().translations).toBe(0);
    await helper.translateThought("hello");
    expect(helper.cacheSizes().translations).toBe(1);
    helper.resetCaches();
    expect(helper.cacheSizes().translations).toBe(0);
  });
});

// ── narrateToolCall ──────────────────────────────────────────────────────────

describe("narrateToolCall — happy path (GEMINI-1, GEMINI-7)", () => {
  test("returns narration", async () => {
    const ai = fakeAi({ response: { text: "אני בודק את הקובץ" } });
    const helper = createGeminiHelper(ai);
    const r = await helper.narrateToolCall(
      { userMessage: "what's in readme?", recentMessages: [] },
      { toolCallId: "t1", kind: "read", title: "Read README.md" },
    );
    expect(r).toBe("אני בודק את הקובץ");
  });

  test("output is trimmed", async () => {
    const ai = fakeAi({ response: { text: "  טקסט  " } });
    const helper = createGeminiHelper(ai);
    const r = await helper.narrateToolCall(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "do thing" },
    );
    expect(r).toBe("טקסט");
  });
});

describe("narrateToolCall — fallback behavior (GEMINI-4, GEMINI-8)", () => {
  test("AI throws → fallback to title", async () => {
    const ai = fakeAi({ error: new Error("API down") });
    const helper = createGeminiHelper(ai);
    const r = await helper.narrateToolCall(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "Reading README" },
    );
    expect(r).toBe("Reading README");
  });

  test("timeout → fallback to title", async () => {
    const ai = fakeAi({ delayMs: 500, response: { text: "too slow" } });
    const helper = createGeminiHelper(ai, { narrateTimeoutMs: 50 });
    const r = await helper.narrateToolCall(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "raw-title" },
    );
    expect(r).toBe("raw-title");
  });

  test("empty AI response → fallback to title", async () => {
    const ai = fakeAi({ response: { text: "" } });
    const helper = createGeminiHelper(ai);
    const r = await helper.narrateToolCall(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "fallback-title" },
    );
    expect(r).toBe("fallback-title");
  });

  test("title empty → fallback to kind", async () => {
    const ai = fakeAi({ error: new Error("fail") });
    const helper = createGeminiHelper(ai);
    const r = await helper.narrateToolCall(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "", kind: "search" },
    );
    expect(r).toBe("search");
  });

  test("both title and kind empty → fallback to 'פעולה'", async () => {
    const ai = fakeAi({ error: new Error("fail") });
    const helper = createGeminiHelper(ai);
    const r = await helper.narrateToolCall(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "" },
    );
    expect(r).toBe("פעולה");
  });
});

describe("narrateToolCall — cache (GEMINI-6)", () => {
  test("same toolCallId → cache hit (even with different ctx)", async () => {
    const ai = fakeAi({ response: { text: "narration" } });
    const helper = createGeminiHelper(ai);
    await helper.narrateToolCall(
      { userMessage: "a", recentMessages: [] },
      { toolCallId: "t1", title: "x" },
    );
    await helper.narrateToolCall(
      { userMessage: "b", recentMessages: ["other"] },
      { toolCallId: "t1", title: "different title" },
    );
    expect(ai.callCount).toBe(1);
  });

  test("different toolCallId → no cache hit", async () => {
    const ai = fakeAi({ response: { text: "narration" } });
    const helper = createGeminiHelper(ai);
    await helper.narrateToolCall(
      { userMessage: "a", recentMessages: [] },
      { toolCallId: "t1", title: "x" },
    );
    await helper.narrateToolCall(
      { userMessage: "a", recentMessages: [] },
      { toolCallId: "t2", title: "x" },
    );
    expect(ai.callCount).toBe(2);
  });

  test("fallback result NOT cached — retries next call", async () => {
    const ai = fakeAi({
      responses: [{ text: "" }, { text: "real narration" }],
    });
    const helper = createGeminiHelper(ai);
    const r1 = await helper.narrateToolCall(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "raw" },
    );
    const r2 = await helper.narrateToolCall(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "raw" },
    );
    expect(r1).toBe("raw");
    expect(r2).toBe("real narration");
    expect(ai.callCount).toBe(2);
  });

  test("cacheSizes counts narrations separately", async () => {
    const ai = fakeAi({ response: { text: "n" } });
    const helper = createGeminiHelper(ai);
    await helper.narrateToolCall(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "x" },
    );
    expect(helper.cacheSizes().narrations).toBe(1);
    expect(helper.cacheSizes().translations).toBe(0);
  });
});

// ── buildNarratePrompt — pure ────────────────────────────────────────────────

describe("buildNarratePrompt — pure prompt construction", () => {
  test("includes user message verbatim", () => {
    const p = buildNarratePrompt(
      { userMessage: "what's in the README?", recentMessages: [] },
      { toolCallId: "t1", title: "Read README" },
    );
    expect(p).toContain(`what's in the README?`);
  });

  test("recent messages joined with ' · '", () => {
    const p = buildNarratePrompt(
      { userMessage: "x", recentMessages: ["foo", "bar", "baz"] },
      { toolCallId: "t1", title: "y" },
    );
    expect(p).toContain("foo · bar · baz");
  });

  test("empty recent messages → '—'", () => {
    const p = buildNarratePrompt(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "y" },
    );
    expect(p).toContain("Recent assistant context: —");
  });

  test("kind defaults to ? if missing", () => {
    const p = buildNarratePrompt(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "do thing" },
    );
    expect(p).toContain("Tool: ? — do thing");
  });

  test("kind included if provided", () => {
    const p = buildNarratePrompt(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "do thing", kind: "execute" },
    );
    expect(p).toContain("Tool: execute — do thing");
  });

  test("includes the 4 examples from NARRATE_EXAMPLES (GEMINI-7)", () => {
    const p = buildNarratePrompt(
      { userMessage: "x", recentMessages: [] },
      { toolCallId: "t1", title: "y" },
    );
    expect(p).toContain("read README.md");
    expect(p).toContain("npm run build");
    expect(p).toContain("bash");
    expect(p).toContain("hello.js");
  });
});
