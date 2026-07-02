/**
 * usage-store.ts — in-memory TTS usage counters with debounced JSON persistence.
 *
 * Single-process → in-memory counters, synchronous update in record() (zero race).
 * Flush to {baseDir}/totals.json: debounced 2s after last record + on-shutdown.
 * Append to {baseDir}/events.jsonl: immediate per record (audit/future analytics).
 * Load from totals.json on construct (survives restart); missing/corrupt → zeros.
 *
 * baseDir: pass ensureStateSubdir("usage") = ~/.config/drive-coding/usage/
 *
 * Slice: tts-usage-metering
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// ─── Types (exported for http-usage.ts and server.ts) ─────────────────────────

export type Provider = "elevenlabs" | "google"

export type UsageEvent = {
  ts: number
  provider: Provider
  cached: boolean
  chars?: number
  inputTokens?: number
  audioTokens?: number
  costUsd: number
}

export type ProviderTotals = {
  requests: number
  cacheHits: number
  chars: number
  inputTokens: number
  audioTokens: number
  costUsd: number
}

export type UsageSummary = Record<Provider, ProviderTotals>

export interface UsageStore {
  /** Synchronous in-memory accumulate; schedules debounced flush to disk. */
  record(event: UsageEvent): void
  /** Returns a snapshot of current totals (new object each call). */
  summary(): UsageSummary
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function zeroTotals(): ProviderTotals {
  return { requests: 0, cacheHits: 0, chars: 0, inputTokens: 0, audioTokens: 0, costUsd: 0 }
}

function defaultSummary(): UsageSummary {
  return { elevenlabs: zeroTotals(), google: zeroTotals() }
}

function snapshotSummary(counters: UsageSummary): UsageSummary {
  return {
    elevenlabs: { ...counters.elevenlabs },
    google: { ...counters.google },
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a UsageStore backed by baseDir for persistence.
 * Loads existing totals.json on construct (synchronous read for simplicity at boot).
 */
export function createUsageStore(baseDir: string): UsageStore {
  const totalsPath = join(baseDir, "totals.json")
  const eventsPath = join(baseDir, "events.jsonl")

  // Ensure directory exists
  try {
    mkdirSync(baseDir, { recursive: true })
  } catch {
    // best-effort
  }

  // Load persisted totals (synchronous at boot; errors → zeros)
  const counters: UsageSummary = defaultSummary()
  try {
    const raw = readFileSync(totalsPath, "utf8")
    const loaded = JSON.parse(raw) as UsageSummary
    if (loaded.elevenlabs) {
      counters.elevenlabs = { ...zeroTotals(), ...loaded.elevenlabs }
    }
    if (loaded.google) {
      counters.google = { ...zeroTotals(), ...loaded.google }
    }
  } catch {
    // Missing or corrupt → start from zeros (normal on first run)
  }

  // Debounced flush state
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const FLUSH_DEBOUNCE_MS = 2_000

  function scheduleFlush() {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
    }
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushNow()
    }, FLUSH_DEBOUNCE_MS)
  }

  function flushNow() {
    try {
      writeFileSync(totalsPath, JSON.stringify(counters, null, 2), "utf8")
    } catch {
      // Disk full or permission error — swallow to avoid crashing the proxy
    }
  }

  // Register on-shutdown flush (integrates with graceful-shutdown slice when available)
  const flushOnExit = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    flushNow()
  }
  process.on("exit", flushOnExit)
  process.on("SIGINT", () => {
    flushOnExit()
    // Don't call process.exit here — let other handlers run
  })
  process.on("SIGTERM", () => {
    flushOnExit()
  })

  return {
    record(event: UsageEvent): void {
      // Synchronous in-memory update (single-process, no race)
      const t = counters[event.provider]
      t.requests += 1
      if (event.cached) {
        t.cacheHits += 1
      } else {
        t.costUsd += event.costUsd
        if (event.chars !== undefined) t.chars += event.chars
        if (event.inputTokens !== undefined) t.inputTokens += event.inputTokens
        if (event.audioTokens !== undefined) t.audioTokens += event.audioTokens
      }

      // Immediate append to events.jsonl (audit log; metadata only — no user text)
      const line = JSON.stringify({
        ts: event.ts,
        provider: event.provider,
        cached: event.cached,
        ...(event.chars !== undefined && { chars: event.chars }),
        ...(event.inputTokens !== undefined && { inputTokens: event.inputTokens }),
        ...(event.audioTokens !== undefined && { audioTokens: event.audioTokens }),
        costUsd: event.costUsd,
      })
      try {
        appendFileSync(eventsPath, `${line}\n`, "utf8")
      } catch {
        // Events log write failure is non-fatal
      }

      // Schedule debounced flush of totals
      scheduleFlush()
    },

    summary(): UsageSummary {
      return snapshotSummary(counters)
    },
  }
}
