/**
 * Tests for `TtsCache` — the in-memory cache class for TTS audio.
 *
 * Pure data structure — no fetch / no network.
 *
 * Behaviors documented in `docs/behaviors.md` (TTS-4, TTS-6, TTS-9).
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL_ID, TtsCache } from "../src/tts-cache.ts";

describe("TtsCache — key construction (TTS-4)", () => {
  test("same inputs → same key", () => {
    const c = new TtsCache();
    const k1 = c.keyOf("hello", { voiceId: "v1", modelId: "m1" }, "");
    const k2 = c.keyOf("hello", { voiceId: "v1", modelId: "m1" }, "");
    expect(k1).toBe(k2);
  });

  test("different text → different key", () => {
    const c = new TtsCache();
    const k1 = c.keyOf("hello", { voiceId: "v1" }, "");
    const k2 = c.keyOf("world", { voiceId: "v1" }, "");
    expect(k1).not.toBe(k2);
  });

  test("different voiceId → different key", () => {
    const c = new TtsCache();
    const k1 = c.keyOf("hello", { voiceId: "v1" }, "");
    const k2 = c.keyOf("hello", { voiceId: "v2" }, "");
    expect(k1).not.toBe(k2);
  });

  test("different modelId → different key", () => {
    const c = new TtsCache();
    const k1 = c.keyOf("hello", { modelId: "m1" }, "");
    const k2 = c.keyOf("hello", { modelId: "m2" }, "");
    expect(k1).not.toBe(k2);
  });

  test("voiceId falls back to envDefault when not in opts", () => {
    const c = new TtsCache();
    const k1 = c.keyOf("hello", {}, "default-voice");
    const k2 = c.keyOf("hello", { voiceId: "default-voice" }, "");
    expect(k1).toBe(k2);
  });

  test("modelId defaults to DEFAULT_MODEL_ID (eleven_v3)", () => {
    const c = new TtsCache();
    const k1 = c.keyOf("hello", {}, "v1");
    const k2 = c.keyOf("hello", { modelId: DEFAULT_MODEL_ID }, "v1");
    expect(k1).toBe(k2);
    expect(DEFAULT_MODEL_ID).toBe("eleven_v3");
  });

  test("key format is `voiceId|modelId|text`", () => {
    const c = new TtsCache();
    const key = c.keyOf("שלום", { voiceId: "vX", modelId: "mY" }, "");
    expect(key).toBe("vX|mY|שלום");
  });

  test("voiceId empty and no env default → empty voiceId in key", () => {
    const c = new TtsCache();
    const key = c.keyOf("hi", {}, "");
    expect(key).toBe("|eleven_v3|hi");
  });
});

describe("TtsCache — get/set/has", () => {
  test("get on missing key → undefined", () => {
    const c = new TtsCache();
    expect(c.get("nope")).toBeUndefined();
  });

  test("set + get round-trip", () => {
    const c = new TtsCache();
    c.set("k1", "base64-data");
    expect(c.get("k1")).toBe("base64-data");
  });

  test("has reflects set state", () => {
    const c = new TtsCache();
    expect(c.has("k1")).toBe(false);
    c.set("k1", "x");
    expect(c.has("k1")).toBe(true);
  });

  test("set overwrites existing value", () => {
    const c = new TtsCache();
    c.set("k1", "first");
    c.set("k1", "second");
    expect(c.get("k1")).toBe("second");
  });
});

describe("TtsCache — size + clear", () => {
  test("size grows with each unique key", () => {
    const c = new TtsCache();
    expect(c.size).toBe(0);
    c.set("k1", "v1");
    expect(c.size).toBe(1);
    c.set("k2", "v2");
    expect(c.size).toBe(2);
  });

  test("size stays same when overwriting same key", () => {
    const c = new TtsCache();
    c.set("k1", "v1");
    c.set("k1", "v2");
    expect(c.size).toBe(1);
  });

  test("clear empties the cache", () => {
    const c = new TtsCache();
    c.set("k1", "v1");
    c.set("k2", "v2");
    expect(c.size).toBe(2);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get("k1")).toBeUndefined();
  });
});

describe("TtsCache — stats (TTS-9)", () => {
  test("empty cache → entries=0, bytes=0", () => {
    const c = new TtsCache();
    expect(c.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  test("entries counts unique keys; bytes sums string lengths", () => {
    const c = new TtsCache();
    c.set("k1", "abc");
    c.set("k2", "defgh");
    expect(c.stats()).toEqual({ entries: 2, bytes: 8 });
  });

  test("stats after overwrite reflects the new value's length", () => {
    const c = new TtsCache();
    c.set("k1", "short");
    expect(c.stats().bytes).toBe(5);
    c.set("k1", "much-longer-value");
    expect(c.stats()).toEqual({ entries: 1, bytes: 17 });
  });

  test("stats after clear → 0 / 0", () => {
    const c = new TtsCache();
    c.set("k1", "data");
    c.clear();
    expect(c.stats()).toEqual({ entries: 0, bytes: 0 });
  });
});

describe("TtsCache — instances are isolated", () => {
  test("two caches don't share state", () => {
    const c1 = new TtsCache();
    const c2 = new TtsCache();
    c1.set("k1", "in-c1");
    expect(c2.get("k1")).toBeUndefined();
    expect(c2.size).toBe(0);
  });
});
