/**
 * Settings — user preferences. Persists to localStorage.
 *
 * ─── Parallel-safe additive design (docs/conventions/parallel-safe-code.md) ───
 *
 * Adding a new persisted field:
 *   1. Append it to the `Persisted` type below.
 *   2. Append its default to `DEFAULTS`.
 *   3. Append a `$state` field + setter in the appropriate `// ─── domain ───`
 *      block of the class. Setter must call `save()`.
 *
 * Non-persisted fields (e.g. loaded-from-API caches) go in the relevant
 * domain block without a setter that writes to localStorage.
 */

import type { CliKind } from "@drive-coding/core"
import { listVoices, type Voice } from "../adapters/voice/voices"

const STORAGE_KEY = "drive-coding-v2-settings"

const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL" // Sarah, ElevenLabs

type Persisted = {
  cliKind: CliKind
  lastCwd: string
  voiceId: string
  beUrl: string
}

const DEFAULTS: Persisted = {
  cliKind: "opencode",
  lastCwd: "",
  voiceId: DEFAULT_VOICE_ID,
  beUrl: "",
}

function load(): Persisted {
  if (typeof localStorage === "undefined") return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) }
  } catch {
    return { ...DEFAULTS }
  }
}

function save(s: Persisted): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // quota / disabled storage — silently skip
  }
}

export class Settings {
  // ─── connect form ───
  cliKind = $state<CliKind>(DEFAULTS.cliKind)
  lastCwd = $state(DEFAULTS.lastCwd)

  // ─── voice ───
  voiceId = $state<string>(DEFAULTS.voiceId)
  /** Loaded async from ElevenLabs via `loadVoices()`. Empty until then. */
  availableVoices = $state<Voice[]>([])
  voicesLoading = $state<boolean>(false)
  voicesError = $state<string | null>(null)

  constructor() {
    const loaded = load()
    this.cliKind = loaded.cliKind
    this.lastCwd = loaded.lastCwd
    this.voiceId = loaded.voiceId
  }

  // ─── connect form ───

  setCliKind = (k: CliKind): void => {
    this.cliKind = k
    this.#persist()
  }

  setLastCwd = (cwd: string): void => {
    this.lastCwd = cwd
    this.#persist()
  }

  // ─── voice ───

  setVoiceId = (id: string): void => {
    this.voiceId = id
    this.#persist()
  }

  /**
   * Fetch the voice catalog from ElevenLabs (via BE proxy + OneCLI).
   * Idempotent: subsequent calls reuse `availableVoices` if already loaded
   * and not currently in-flight. Errors are stored on `voicesError`.
   */
  loadVoices = async (): Promise<void> => {
    const result = await fetchVoices()
    this.voices = result
  }

  // ─── backend ───

  /**
   * Validates and sets the BE base URL. Empty string disables the override
   * (falls back to same-origin / Vite proxy). Returns a Result-like value so
   * the settings form can render validation errors without throwing.
   */
  setBeUrl = (value: string): { ok: true } | { ok: false; error: string } => {
    const trimmed = value.trim().replace(/\/$/, "")
    if (trimmed === "") {
      this.beUrl = ""
      this.#persist()
      return { ok: true }
    }
    try {
      const u = new URL(trimmed)
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return { ok: false, error: "scheme must be http or https" }
      }
      this.beUrl = trimmed
      this.#persist()
      return { ok: true }
    } catch {
      return { ok: false, error: "malformed URL" }
    }
  }

  // ─── private ───
  #persist(): void {
    save({
      cliKind: this.cliKind,
      lastCwd: this.lastCwd,
      voiceId: this.voiceId,
      beUrl: this.beUrl,
    })
  }
  }

  // ─── private ───

  #persist(): void {
    save({
      cliKind: this.cliKind,
      lastCwd: this.lastCwd,
      voiceId: this.voiceId,
    })
  }
}
