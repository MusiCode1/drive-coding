/**
 * drive-message-envelope.test.ts — codec TDD (slice agent-message-envelope-send B0).
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  type DriveMessageAgent,
  type DriveMessageSystem,
  insertEnvelopeContext,
  parseDriveMessage,
  serializeDriveMessage,
} from "./drive-message-envelope.js"

const here = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(
  here,
  "../../../../docs-for-llm/investigations/agent-message-envelope/proof/fixtures",
)

function readFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf8")
}

const agentSample: DriveMessageAgent = {
  source: "agent",
  sender: { id: "11111111-1111-4111-8111-111111111111", name: 'בודק "המעטפת"' },
  body: "   ",
}

const systemSample: DriveMessageSystem = {
  source: "system",
  eventKind: "turn-ended",
  subjectAgent: { id: "11111111-1111-4111-8111-111111111111", name: "בודק הבדיקות" },
  at: 1_800_000_000_000,
  stopReason: "end_turn",
  lastAssistantText: { text: "נקלט, והתיקונים נרשמו בגוף הבריף.", truncated: false },
}

describe("serializeDriveMessage / parseDriveMessage round-trip", () => {
  it("matches proof fixtures byte-for-byte", () => {
    for (const name of [
      "agent-envelope-v1.xml",
      "agent-envelope-edge.xml",
      "system-envelope-v1.xml",
    ]) {
      const xml = readFixture(name)
      const parsed = parseDriveMessage(xml)
      expect(parsed.isOk()).toBe(true)
      if (parsed.isOk()) {
        expect(serializeDriveMessage(parsed.value)).toBe(xml)
      }
    }
  })

  it("round-trips rich agent body (Hebrew, emoji, markdown, XML, &/<)", () => {
    const msg: DriveMessageAgent = {
      source: "agent",
      sender: { id: "11111111-1111-4111-8111-111111111111", name: "probe" },
      body: "שלום 🎉 **bold**\n```\n<tag>&amp;\n```\nif (a & b) { x < y }",
    }
    const wire = serializeDriveMessage(msg)
    const back = parseDriveMessage(wire)
    expect(back.isOk()).toBe(true)
    if (back.isOk()) {
      expect(back.value).toEqual(msg)
      expect(serializeDriveMessage(back.value)).toBe(wire)
    }
  })

  it("empty body round-trips", () => {
    const wire = serializeDriveMessage({ ...agentSample, body: "" })
    expect(parseDriveMessage(wire).isOk()).toBe(true)
    expect(serializeDriveMessage(parseDriveMessage(wire)._unsafeUnwrap())).toBe(wire)
  })
})

describe("parseDriveMessage failures", () => {
  it("plain text → not-envelope", () => {
    expect(parseDriveMessage("hello")._unsafeUnwrapErr()).toBe("not-envelope")
  })

  it("unknown version → unknown-version", () => {
    const xml = serializeDriveMessage(agentSample).replace('version="1"', 'version="2"')
    expect(parseDriveMessage(xml)._unsafeUnwrapErr()).toBe("unknown-version")
  })

  it("duplicate sender tag → malformed", () => {
    const base = serializeDriveMessage(agentSample)
    const dup = base.replace(
      "</sender>",
      '</sender>\n  <sender id="22222222-2222-4222-8222-222222222222"></sender>',
    )
    expect(parseDriveMessage(dup)._unsafeUnwrapErr()).toBe("malformed")
  })

  it("agent field on system envelope → malformed", () => {
    const bad = serializeDriveMessage(systemSample).replace(
      "<event-kind>",
      "<body>x</body><event-kind>",
    )
    expect(parseDriveMessage(bad)._unsafeUnwrapErr()).toBe("malformed")
  })

  it("unknown context kind → malformed", () => {
    const base = serializeDriveMessage(agentSample)
    const withCtx = insertEnvelopeContext(base, {
      kind: "project-charter",
      text: "CHARTER",
    })._unsafeUnwrap().text
    const bad = withCtx.replace('kind="project-charter"', 'kind="other"')
    expect(parseDriveMessage(bad)._unsafeUnwrapErr()).toBe("malformed")
  })

  it("truncated envelope → malformed", () => {
    const cut = serializeDriveMessage(agentSample).slice(0, -20)
    expect(parseDriveMessage(cut)._unsafeUnwrapErr()).toBe("malformed")
  })

  it("nested envelope in body stays encoded (still valid envelope)", () => {
    const inner = '<drive-coding-msg version="1" source="agent"></drive-coding-msg>'
    const msg: DriveMessageAgent = {
      source: "agent",
      sender: { id: "11111111-1111-4111-8111-111111111111" },
      body: inner,
    }
    const wire = serializeDriveMessage(msg)
    const parsed = parseDriveMessage(wire)
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk() && parsed.value.source === "agent") expect(parsed.value.body).toBe(inner)
  })
})

describe("insertEnvelopeContext", () => {
  const charter = { kind: "project-charter" as const, text: "CHARTER with & and <tag>" }

  it("G6: serialize with context equals insert on serialize without", () => {
    const base = serializeDriveMessage(agentSample)
    const inserted = insertEnvelopeContext(base, charter)
    expect(inserted.isOk()).toBe(true)
    const withField = serializeDriveMessage({ ...agentSample, context: charter })
    if (inserted.isOk()) {
      expect(inserted.value.text).toBe(withField)
    }
  })

  it("G7: hand-pasted non-canonical envelope preserves sender/source/body", () => {
    const canonical = serializeDriveMessage(agentSample)
    const hand = canonical.replace("<body>", "<body>\n    ")
    const handParsed = parseDriveMessage(hand)._unsafeUnwrap()
    if (handParsed.source !== "agent") throw new Error("expected agent")
    const bodyBefore = handParsed.body
    const ctx = { kind: "project-charter" as const, text: "CTX" }
    const out = insertEnvelopeContext(hand, ctx)
    expect(out.isOk()).toBe(true)
    if (out.isOk()) {
      const parsed = parseDriveMessage(out.value.text)
      expect(parsed.isOk()).toBe(true)
      if (parsed.isOk() && parsed.value.source === "agent") {
        expect(parsed.value.sender).toEqual(agentSample.sender)
        expect(parsed.value.body).toBe(bodyBefore)
        expect(parsed.value.context).toEqual(ctx)
      }
    }
  })

  it("existing context → context-exists", () => {
    const withCtx = serializeDriveMessage({ ...agentSample, context: charter })
    expect(insertEnvelopeContext(withCtx, charter)._unsafeUnwrapErr()).toBe("context-exists")
  })

  it("not envelope → not-envelope", () => {
    expect(insertEnvelopeContext("nope", charter)._unsafeUnwrapErr()).toBe("not-envelope")
  })
})
