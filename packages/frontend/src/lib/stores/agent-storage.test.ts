/**
 * agent-storage.test.ts — TTL, missing key, malformed JSON, schema validation
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
  type AgentMetadata,
  clearAgentMetadata,
  loadAgentMetadata,
  saveAgentMetadata,
} from "./agent-storage"

const TTL_MS = 7 * 24 * 60 * 60 * 1000
const KEY = (id: string) => `voice-acp:agent:${id}`

const baseMeta: Omit<AgentMetadata, "savedAt"> = {
  agentId: "agent-1",
  cwd: "/home/user/projects/voice-acp",
  cliKind: "opencode",
  acpSessionId: "sess-abc",
  modelOverride: null,
}

describe("loadAgentMetadata", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("returns null for missing key", () => {
    expect(loadAgentMetadata("nope")).toBeNull()
  })

  it("returns stored metadata when fresh", () => {
    saveAgentMetadata(baseMeta)
    const loaded = loadAgentMetadata("agent-1")
    expect(loaded).not.toBeNull()
    expect(loaded?.cwd).toBe(baseMeta.cwd)
    expect(loaded?.cliKind).toBe("opencode")
    expect(loaded?.acpSessionId).toBe("sess-abc")
    expect(loaded?.modelOverride).toBeNull()
  })

  it("returns null when TTL expired (>7d) and removes entry", () => {
    const expired: AgentMetadata = {
      ...baseMeta,
      agentId: "agent-old",
      savedAt: Date.now() - TTL_MS - 1000,
    }
    localStorage.setItem(KEY("agent-old"), JSON.stringify(expired))
    expect(loadAgentMetadata("agent-old")).toBeNull()
    expect(localStorage.getItem(KEY("agent-old"))).toBeNull()
  })

  it("returns metadata just inside TTL boundary", () => {
    const fresh: AgentMetadata = {
      ...baseMeta,
      agentId: "agent-edge",
      savedAt: Date.now() - TTL_MS + 5000,
    }
    localStorage.setItem(KEY("agent-edge"), JSON.stringify(fresh))
    expect(loadAgentMetadata("agent-edge")?.agentId).toBe("agent-edge")
  })

  it("returns null for malformed JSON and removes the entry", () => {
    localStorage.setItem(KEY("agent-bad"), "{ not valid json }")
    expect(loadAgentMetadata("agent-bad")).toBeNull()
    expect(localStorage.getItem(KEY("agent-bad"))).toBeNull()
  })

  it("returns null when schema is missing a required field and removes entry", () => {
    // Missing cwd — ArkType should reject
    const broken = {
      agentId: "agent-missing",
      cliKind: "opencode",
      acpSessionId: null,
      modelOverride: null,
      savedAt: Date.now(),
    }
    localStorage.setItem(KEY("agent-missing"), JSON.stringify(broken))
    expect(loadAgentMetadata("agent-missing")).toBeNull()
    expect(localStorage.getItem(KEY("agent-missing"))).toBeNull()
  })

  it("returns null when schema field has wrong type and removes entry", () => {
    // cwd is a number (should be string)
    const broken = {
      agentId: "agent-typed",
      cwd: 42,
      cliKind: "opencode",
      acpSessionId: null,
      modelOverride: null,
      savedAt: Date.now(),
    }
    localStorage.setItem(KEY("agent-typed"), JSON.stringify(broken))
    expect(loadAgentMetadata("agent-typed")).toBeNull()
    expect(localStorage.getItem(KEY("agent-typed"))).toBeNull()
  })

  it("accepts extra unknown fields (forward-compat)", () => {
    // Future fields shouldn't break old clients
    const withExtra = {
      ...baseMeta,
      agentId: "agent-extra",
      savedAt: Date.now(),
      futureField: "should-be-ignored",
    }
    localStorage.setItem(KEY("agent-extra"), JSON.stringify(withExtra))
    const loaded = loadAgentMetadata("agent-extra")
    expect(loaded).not.toBeNull()
    expect(loaded?.cwd).toBe(baseMeta.cwd)
  })
})

describe("saveAgentMetadata", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("writes JSON with current savedAt timestamp", () => {
    const before = Date.now()
    saveAgentMetadata(baseMeta)
    const raw = localStorage.getItem(KEY("agent-1"))
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as AgentMetadata
    expect(parsed.savedAt).toBeGreaterThanOrEqual(before)
    expect(parsed.cwd).toBe(baseMeta.cwd)
  })

  it("overwrites previous savedAt when re-saved", () => {
    saveAgentMetadata({ ...baseMeta, agentId: "agent-rs" })
    const first = JSON.parse(localStorage.getItem(KEY("agent-rs"))!) as AgentMetadata
    // sleep tiny bit by busy-waiting (vitest jsdom — no setTimeout in sync test)
    const target = first.savedAt + 2
    while (Date.now() < target) {
      // noop
    }
    saveAgentMetadata({ ...baseMeta, agentId: "agent-rs" })
    const second = JSON.parse(localStorage.getItem(KEY("agent-rs"))!) as AgentMetadata
    expect(second.savedAt).toBeGreaterThan(first.savedAt)
  })
})

describe("clearAgentMetadata", () => {
  it("removes stored entry", () => {
    saveAgentMetadata({ ...baseMeta, agentId: "agent-clr" })
    expect(loadAgentMetadata("agent-clr")).not.toBeNull()
    clearAgentMetadata("agent-clr")
    expect(loadAgentMetadata("agent-clr")).toBeNull()
  })

  it("is a no-op for missing key", () => {
    expect(() => clearAgentMetadata("nonexistent")).not.toThrow()
  })
})
