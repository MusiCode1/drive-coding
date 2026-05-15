/**
 * In-memory cache for TTS audio outputs.
 *
 * The same text + voiceId + modelId always produces the same MP3, so we
 * cache base64 strings keyed by `${voiceId}|${modelId}|${text}`. No LRU /
 * eviction — POC simplicity. ~30-100KB per entry.
 *
 * Extracted into a class so tests can construct fresh instances. The
 * module-level singleton lives in `tts.ts`.
 *
 * Behaviors documented in `docs/behaviors.md` (TTS-4, TTS-6, TTS-9).
 */

export interface CacheKeyOpts {
  voiceId?: string;
  modelId?: string;
}

/** Default model ID used when none provided. */
export const DEFAULT_MODEL_ID = "eleven_v3";

export class TtsCache {
  private map = new Map<string, string>();

  /** Construct a cache key. Returns the same key for the same inputs. */
  keyOf(text: string, opts: CacheKeyOpts, envDefaultVoiceId: string): string {
    const voiceId = opts.voiceId ?? envDefaultVoiceId ?? "";
    const modelId = opts.modelId ?? DEFAULT_MODEL_ID;
    return `${voiceId}|${modelId}|${text}`;
  }

  /** Returns the cached base64 string, or undefined. */
  get(key: string): string | undefined {
    return this.map.get(key);
  }

  /** Stores a base64 string under the given key. */
  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  /** True iff the key exists. */
  has(key: string): boolean {
    return this.map.has(key);
  }

  /** Number of stored entries. */
  get size(): number {
    return this.map.size;
  }

  /** Clears all entries — useful for tests. */
  clear(): void {
    this.map.clear();
  }

  /** Stats — total entries and total bytes (sum of base64 string lengths). */
  stats(): { entries: number; bytes: number } {
    let bytes = 0;
    for (const v of this.map.values()) bytes += v.length;
    return { entries: this.map.size, bytes };
  }
}
