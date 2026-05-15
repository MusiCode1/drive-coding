/**
 * `GET /api/voices` handler — fetches voices from ElevenLabs and returns
 * them sorted for the config UI.
 *
 * Sort order:
 *   1. The default voice (matching `ELEVENLABS_VOICE_ID` env / dep).
 *   2. Hebrew-supporting voices.
 *   3. Category order: premade < professional < cloned < generated.
 *   4. Alphabetical by name (localeCompare).
 *
 * Behaviors documented in `docs/behaviors.md` (HTTP-4..HTTP-6).
 */

/** Shape of a single voice in our response (mapped from ElevenLabs raw). */
export interface MappedVoice {
  voiceId: string;
  name: string;
  category: string;
  description: string | null;
  languages: string[];
  supportsHebrew: boolean;
}

/** Maps the raw ElevenLabs voice shape to our `MappedVoice`. */
export function mapVoice(v: any): MappedVoice {
  const langs = (v.verified_languages ?? []).map(
    (l: any) => l.language ?? l.language_id,
  );
  return {
    voiceId: v.voice_id,
    name: v.name,
    category: v.category, // premade / cloned / generated / professional
    description: v.description ?? null,
    languages: langs,
    supportsHebrew: langs.includes("he") || v.labels?.language === "he",
  };
}

const CATEGORY_ORDER: Record<string, number> = {
  premade: 0,
  professional: 1,
  cloned: 2,
  generated: 3,
};

/**
 * Sorts voices in place (and returns the same array) by the rules above.
 */
export function sortVoices(
  voices: MappedVoice[],
  defaultVoiceId: string,
): MappedVoice[] {
  voices.sort((a, b) => {
    if (a.voiceId === defaultVoiceId) return -1;
    if (b.voiceId === defaultVoiceId) return 1;
    if (a.supportsHebrew !== b.supportsHebrew) {
      return a.supportsHebrew ? -1 : 1;
    }
    const ao = CATEGORY_ORDER[a.category] ?? 9;
    const bo = CATEGORY_ORDER[b.category] ?? 9;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
  return voices;
}

export interface VoicesDeps {
  /** Fetches voices from ElevenLabs. In production: real fetch. Tests inject. */
  fetchVoices(): Promise<{ ok: boolean; status: number; voices?: any[] }>;
  /** The default voice ID (from `ELEVENLABS_VOICE_ID` env). */
  defaultVoiceId: string;
}

/** Result of handling /api/voices — caller wraps in Response. */
export type VoicesResult =
  | {
      ok: true;
      body: { defaultVoiceId: string | null; voices: MappedVoice[] };
    }
  | { ok: false; status: number; body: { error: string } };

/** Pure handler logic — no Response/Request types here. */
export async function handleApiVoices(deps: VoicesDeps): Promise<VoicesResult> {
  let upstream: Awaited<ReturnType<typeof deps.fetchVoices>>;
  try {
    upstream = await deps.fetchVoices();
  } catch (e) {
    return {
      ok: false,
      status: 500,
      body: { error: String((e as Error).message ?? e) },
    };
  }
  if (!upstream.ok) {
    return {
      ok: false,
      status: 502,
      body: { error: `ElevenLabs error ${upstream.status}` },
    };
  }
  const mapped = (upstream.voices ?? []).map(mapVoice);
  const sorted = sortVoices(mapped, deps.defaultVoiceId);
  return {
    ok: true,
    body: {
      defaultVoiceId: deps.defaultVoiceId || null,
      voices: sorted,
    },
  };
}
