/**
 * Tests for `/api/voices` handler — mapping, sorting, error paths.
 *
 * Pure logic (sort + map) tested directly. The handler tested with a
 * mock `fetchVoices`.
 *
 * Behaviors documented in `docs/behaviors.md` (HTTP-4..HTTP-6).
 */

import { describe, expect, test } from "bun:test";
import {
  handleApiVoices,
  mapVoice,
  sortVoices,
  type MappedVoice,
} from "../src/api-voices.ts";

// ── mapVoice ─────────────────────────────────────────────────────────────────

describe("mapVoice — raw → mapped (HTTP-4)", () => {
  test("basic fields are mapped", () => {
    const v = mapVoice({
      voice_id: "v1",
      name: "Alice",
      category: "premade",
      description: "A test voice",
      verified_languages: [],
    });
    expect(v.voiceId).toBe("v1");
    expect(v.name).toBe("Alice");
    expect(v.category).toBe("premade");
    expect(v.description).toBe("A test voice");
  });

  test("missing description → null", () => {
    const v = mapVoice({ voice_id: "v1", name: "x", category: "premade" });
    expect(v.description).toBeNull();
  });

  test("languages extracted from verified_languages", () => {
    const v = mapVoice({
      voice_id: "v1",
      name: "x",
      category: "premade",
      verified_languages: [{ language: "he" }, { language: "en" }],
    });
    expect(v.languages).toEqual(["he", "en"]);
  });

  test("language_id used as fallback if language missing", () => {
    const v = mapVoice({
      voice_id: "v1",
      name: "x",
      category: "premade",
      verified_languages: [{ language_id: "ar" }],
    });
    expect(v.languages).toEqual(["ar"]);
  });

  test("supportsHebrew=true when 'he' in languages", () => {
    const v = mapVoice({
      voice_id: "v1",
      name: "x",
      category: "premade",
      verified_languages: [{ language: "he" }],
    });
    expect(v.supportsHebrew).toBe(true);
  });

  test("supportsHebrew=true when labels.language === 'he'", () => {
    const v = mapVoice({
      voice_id: "v1",
      name: "x",
      category: "premade",
      labels: { language: "he" },
    });
    expect(v.supportsHebrew).toBe(true);
  });

  test("supportsHebrew=false when no hebrew indicator", () => {
    const v = mapVoice({
      voice_id: "v1",
      name: "x",
      category: "premade",
      verified_languages: [{ language: "en" }],
    });
    expect(v.supportsHebrew).toBe(false);
  });
});

// ── sortVoices ───────────────────────────────────────────────────────────────

function v(
  voiceId: string,
  category: string,
  name: string,
  supportsHebrew = false,
): MappedVoice {
  return {
    voiceId,
    name,
    category,
    description: null,
    languages: [],
    supportsHebrew,
  };
}

describe("sortVoices — priority order (HTTP-5)", () => {
  test("default voice goes first", () => {
    const voices = [
      v("v1", "premade", "Alice"),
      v("v2", "premade", "Bob"),
      v("v3", "premade", "Charlie"),
    ];
    sortVoices(voices, "v2");
    expect(voices[0].voiceId).toBe("v2");
  });

  test("Hebrew supporters come before non-Hebrew (when no default)", () => {
    const voices = [
      v("v1", "premade", "Alice", false),
      v("v2", "premade", "Bob", true),
      v("v3", "premade", "Charlie", false),
    ];
    sortVoices(voices, "");
    expect(voices[0].voiceId).toBe("v2"); // Hebrew first
  });

  test("category order: premade < professional < cloned < generated", () => {
    const voices = [
      v("v1", "generated", "Z"),
      v("v2", "cloned", "Z"),
      v("v3", "premade", "Z"),
      v("v4", "professional", "Z"),
    ];
    sortVoices(voices, "");
    expect(voices.map((x) => x.voiceId)).toEqual(["v3", "v4", "v2", "v1"]);
  });

  test("within category, sort by name alphabetically", () => {
    const voices = [
      v("v1", "premade", "Charlie"),
      v("v2", "premade", "Alice"),
      v("v3", "premade", "Bob"),
    ];
    sortVoices(voices, "");
    expect(voices.map((x) => x.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  test("unknown category gets order 9 (last)", () => {
    const voices = [
      v("v1", "weird-category", "Z"),
      v("v2", "premade", "A"),
    ];
    sortVoices(voices, "");
    expect(voices[0].voiceId).toBe("v2");
    expect(voices[1].voiceId).toBe("v1");
  });

  test("full priority chain — default beats Hebrew beats category", () => {
    const voices = [
      v("default-id", "generated", "Z", false), // default — wins
      v("v2", "generated", "A", true), // Hebrew, but later category
      v("v3", "premade", "Z", false), // premade, but no Hebrew
    ];
    sortVoices(voices, "default-id");
    expect(voices[0].voiceId).toBe("default-id");
    expect(voices[1].voiceId).toBe("v2"); // Hebrew beats category
    expect(voices[2].voiceId).toBe("v3");
  });

  test("default not in list → ordinary sort", () => {
    const voices = [
      v("v1", "premade", "B"),
      v("v2", "premade", "A"),
    ];
    sortVoices(voices, "non-existent-default");
    expect(voices.map((x) => x.name)).toEqual(["A", "B"]);
  });
});

// ── handleApiVoices ──────────────────────────────────────────────────────────

describe("handleApiVoices — orchestration", () => {
  test("fetch fails → 500", async () => {
    const result = await handleApiVoices({
      defaultVoiceId: "",
      async fetchVoices() {
        throw new Error("network down");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.body.error).toContain("network");
    }
  });

  test("upstream not ok → 502 (HTTP-6)", async () => {
    const result = await handleApiVoices({
      defaultVoiceId: "",
      async fetchVoices() {
        return { ok: false, status: 401 };
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.body.error).toContain("ElevenLabs error 401");
    }
  });

  test("upstream ok, no voices → empty array + defaultVoiceId", async () => {
    const result = await handleApiVoices({
      defaultVoiceId: "default-x",
      async fetchVoices() {
        return { ok: true, status: 200, voices: [] };
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.voices).toEqual([]);
      expect(result.body.defaultVoiceId).toBe("default-x");
    }
  });

  test("upstream ok, voices mapped + sorted", async () => {
    const result = await handleApiVoices({
      defaultVoiceId: "v2",
      async fetchVoices() {
        return {
          ok: true,
          status: 200,
          voices: [
            { voice_id: "v1", name: "Z", category: "generated" },
            { voice_id: "v2", name: "A", category: "premade" },
            {
              voice_id: "v3",
              name: "B",
              category: "premade",
              verified_languages: [{ language: "he" }],
            },
          ],
        };
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // v2 is the default → first.
      // v3 has Hebrew → second.
      // v1 is generated → last.
      expect(result.body.voices.map((v) => v.voiceId)).toEqual([
        "v2",
        "v3",
        "v1",
      ]);
    }
  });

  test("defaultVoiceId empty → returned as null", async () => {
    const result = await handleApiVoices({
      defaultVoiceId: "",
      async fetchVoices() {
        return { ok: true, status: 200, voices: [] };
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.defaultVoiceId).toBeNull();
  });
});
