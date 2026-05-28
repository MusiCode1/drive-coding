/**
 * Settings — minimal user preferences (cliKind + lastCwd).
 * Persists to localStorage so the connect form remembers.
 */

import type { CliKind } from "@drive-coding/core"

const STORAGE_KEY = "drive-coding-v2-settings"

type Persisted = {
  cliKind: CliKind
  lastCwd: string
}

const DEFAULTS: Persisted = {
  cliKind: "opencode",
  lastCwd: "",
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
  cliKind = $state<CliKind>(DEFAULTS.cliKind)
  lastCwd = $state(DEFAULTS.lastCwd)

  constructor() {
    const loaded = load()
    this.cliKind = loaded.cliKind
    this.lastCwd = loaded.lastCwd
  }

  setCliKind = (k: CliKind): void => {
    this.cliKind = k
    save({ cliKind: this.cliKind, lastCwd: this.lastCwd })
  }

  setLastCwd = (cwd: string): void => {
    this.lastCwd = cwd
    save({ cliKind: this.cliKind, lastCwd: this.lastCwd })
  }
}
