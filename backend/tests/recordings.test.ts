/**
 * Tests for the `recordings` module — pure helpers + integration with
 * the filesystem via a tmp directory.
 *
 * Behaviors documented in `docs/behaviors.md` (REC-1..REC-8).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRecordingPaths,
  extFromMime,
  saveRecordingMetadata,
  type RecordingInfo,
} from "../src/recordings.ts";

// ── extFromMime — pure ───────────────────────────────────────────────────────

describe("extFromMime — MIME type → extension", () => {
  test("audio/webm → 'webm'", () => {
    expect(extFromMime("audio/webm")).toBe("webm");
  });

  test("audio/webm;codecs=opus → 'webm' (substring match)", () => {
    expect(extFromMime("audio/webm;codecs=opus")).toBe("webm");
  });

  test("audio/ogg → 'ogg'", () => {
    expect(extFromMime("audio/ogg")).toBe("ogg");
  });

  test("audio/mp3 → 'mp3'", () => {
    expect(extFromMime("audio/mp3")).toBe("mp3");
  });

  test("audio/mpeg → 'mp3' (mp3 substring)", () => {
    expect(extFromMime("audio/mpeg")).toBe("mp3");
  });

  test("audio/wav → 'wav'", () => {
    expect(extFromMime("audio/wav")).toBe("wav");
  });

  test("audio/m4a → 'm4a'", () => {
    expect(extFromMime("audio/m4a")).toBe("m4a");
  });

  test("audio/mp4 → 'm4a' (mp4 substring also matches m4a branch)", () => {
    // The code checks `m.includes("m4a") || m.includes("mp4")` in the m4a branch.
    expect(extFromMime("audio/mp4")).toBe("m4a");
  });

  test("audio/flac → 'flac'", () => {
    expect(extFromMime("audio/flac")).toBe("flac");
  });

  test("case-insensitive (input upper) → still matches", () => {
    expect(extFromMime("AUDIO/WEBM")).toBe("webm");
  });

  test("unknown MIME → 'audio' fallback", () => {
    expect(extFromMime("audio/unknown-format")).toBe("audio");
    expect(extFromMime("application/octet-stream")).toBe("audio");
    expect(extFromMime("")).toBe("audio");
  });
});

// ── buildRecordingPaths — pure ───────────────────────────────────────────────

describe("buildRecordingPaths — filename construction (REC-3)", () => {
  test("standard inputs → expected paths", () => {
    const p = buildRecordingPaths(
      "/cache/recordings",
      "2026-01-15T12:34:56.789Z",
      "abc12345xyz",
      "audio/webm",
    );
    expect(p.audioPath).toBe(
      "/cache/recordings/2026-01-15T12-34-56-789Z_abc12345.webm",
    );
    expect(p.metaPath).toBe(
      "/cache/recordings/2026-01-15T12-34-56-789Z_abc12345.json",
    );
  });

  test("audio + meta share base name (just different extensions)", () => {
    const p = buildRecordingPaths(
      "/dir",
      "2026-01-01T00:00:00.000Z",
      "session-id",
      "audio/mp3",
    );
    const audioBase = p.audioPath.replace(/\.\w+$/, "");
    const metaBase = p.metaPath.replace(/\.json$/, "");
    expect(audioBase).toBe(metaBase);
  });

  test("colon and period in timestamp replaced with hyphen", () => {
    const p = buildRecordingPaths(
      "/d",
      "2026-01-15T12:34:56.789Z",
      "x",
      "audio/webm",
    );
    expect(p.audioPath).not.toContain(":");
    expect(p.audioPath).not.toMatch(/\.[^/]+\./); // no dots besides extension
  });

  test("null sessionId → 'no-sess' marker", () => {
    const p = buildRecordingPaths(
      "/d",
      "2026-01-01T00:00:00.000Z",
      null,
      "audio/webm",
    );
    expect(p.audioPath).toContain("_no-sess.");
  });

  test("sessionId truncated to 8 chars", () => {
    const p = buildRecordingPaths(
      "/d",
      "2026-01-01T00:00:00.000Z",
      "abcdefghijklmnop",
      "audio/webm",
    );
    expect(p.audioPath).toContain("_abcdefgh.");
    expect(p.audioPath).not.toContain("ijklmnop");
  });

  test("extension derived from mimeType (mp3 case)", () => {
    const p = buildRecordingPaths(
      "/d",
      "2026-01-01T00:00:00.000Z",
      "x",
      "audio/mpeg",
    );
    expect(p.audioPath.endsWith(".mp3")).toBe(true);
  });

  test("baseDir variation reflected in paths", () => {
    const p = buildRecordingPaths(
      "/custom/path",
      "2026-01-01T00:00:00.000Z",
      "x",
      "audio/webm",
    );
    expect(p.audioPath.startsWith("/custom/path/")).toBe(true);
    expect(p.metaPath.startsWith("/custom/path/")).toBe(true);
  });
});

// ── saveRecordingMetadata — integration with tmp dir ─────────────────────────

describe("saveRecordingMetadata — writes JSON next to audio (REC-5)", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  test("writes valid JSON with all fields", async () => {
    tmp = await mkdtemp(join(tmpdir(), "voice-acp-test-"));
    const info: RecordingInfo = {
      audioPath: join(tmp, "audio.webm"),
      metaPath: join(tmp, "audio.json"),
      timestamp: "2026-01-01T00:00:00Z",
    };
    await saveRecordingMetadata(info, {
      timestamp: info.timestamp,
      sessionId: "sess-1",
      cwd: "/test",
      mimeType: "audio/webm",
      audioSize: 1024,
      transcript: "hello world",
      sttModel: "test-model",
    });
    const content = await readFile(info.metaPath, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed.transcript).toBe("hello world");
    expect(parsed.sessionId).toBe("sess-1");
    expect(parsed.audioSize).toBe(1024);
  });

  test("JSON is formatted with 2-space indent (REC-5 readable)", async () => {
    tmp = await mkdtemp(join(tmpdir(), "voice-acp-test-"));
    const info: RecordingInfo = {
      audioPath: join(tmp, "a.webm"),
      metaPath: join(tmp, "a.json"),
      timestamp: "2026-01-01T00:00:00Z",
    };
    await saveRecordingMetadata(info, { foo: "bar" });
    const content = await readFile(info.metaPath, "utf8");
    expect(content).toContain("  \"foo\":");
  });

  test("error doesn't throw (REC-6 — silent failure)", async () => {
    const info: RecordingInfo = {
      audioPath: "/nonexistent-dir/xyz.webm",
      metaPath: "/nonexistent-dir-that-should-not-exist/zzz.json",
      timestamp: "x",
    };
    // Should not throw — `saveRecordingMetadata` catches.
    await expect(saveRecordingMetadata(info, { x: 1 })).resolves.toBeUndefined();
  });
});
