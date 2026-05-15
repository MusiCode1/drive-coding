/**
 * Tests for `/api/tts` handler.
 *
 * Behaviors documented in `docs/behaviors.md` (HTTP-7..HTTP-9).
 */

import { describe, expect, test } from "bun:test";
import { handleApiTts } from "../src/api-tts.ts";

describe("handleApiTts — body validation (HTTP-7)", () => {
  test("invalid JSON → 400 'JSON לא תקין'", async () => {
    const r = await handleApiTts(
      async () => {
        throw new Error("parse fail");
      },
      { async textToSpeech() { return "ignored"; } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("JSON לא תקין");
    }
  });

  test("missing text → 400 'חסר text'", async () => {
    const r = await handleApiTts(
      async () => ({}),
      { async textToSpeech() { return "ignored"; } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("חסר text");
    }
  });

  test("empty text → 400", async () => {
    const r = await handleApiTts(
      async () => ({ text: "" }),
      { async textToSpeech() { return "ignored"; } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  test("whitespace-only text → 400 (after trim)", async () => {
    const r = await handleApiTts(
      async () => ({ text: "   " }),
      { async textToSpeech() { return "ignored"; } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe("handleApiTts — delegate to TTS (HTTP-8, HTTP-9)", () => {
  test("valid text → calls textToSpeech, returns base64 data", async () => {
    let receivedText: string | undefined;
    let receivedVoice: string | undefined;
    const r = await handleApiTts(
      async () => ({ text: "hello", voiceId: "voice-abc" }),
      {
        async textToSpeech(text, voiceId) {
          receivedText = text;
          receivedVoice = voiceId;
          return "BASE64DATA";
        },
      },
    );
    expect(receivedText).toBe("hello");
    expect(receivedVoice).toBe("voice-abc");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.data).toBe("BASE64DATA");
  });

  test("voiceId optional → passed as undefined", async () => {
    let receivedVoice: string | undefined = "not-touched";
    await handleApiTts(
      async () => ({ text: "hello" }),
      {
        async textToSpeech(_text, voiceId) {
          receivedVoice = voiceId;
          return "x";
        },
      },
    );
    expect(receivedVoice).toBeUndefined();
  });

  test("text is trimmed before passing", async () => {
    let receivedText: string | undefined;
    await handleApiTts(
      async () => ({ text: "  hello world  " }),
      {
        async textToSpeech(text) {
          receivedText = text;
          return "x";
        },
      },
    );
    expect(receivedText).toBe("hello world");
  });

  test("textToSpeech throws → 500", async () => {
    const r = await handleApiTts(
      async () => ({ text: "x" }),
      {
        async textToSpeech() {
          throw new Error("upstream blew up");
        },
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(500);
      expect(r.body.error).toContain("upstream blew up");
    }
  });
});
