import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { Client } from "@agentclientprotocol/sdk"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createClientImpl } from "../src/acp/client-impl"

type ReqPermParams = Parameters<NonNullable<Client["requestPermission"]>>[0]
type ReadTextParams = Parameters<NonNullable<Client["readTextFile"]>>[0]
type WriteTextParams = Parameters<NonNullable<Client["writeTextFile"]>>[0]
type SessionUpdParams = Parameters<NonNullable<Client["sessionUpdate"]>>[0]

type PermOpt = ReqPermParams["options"][number]

function makeParams(options: PermOpt[]): ReqPermParams {
  return {
    sessionId: "sess-1",
    toolCall: {
      toolCallId: "tc-1",
      rawInput: {},
    } as ReqPermParams["toolCall"],
    options,
  }
}

describe("createClientImpl — requestPermission", () => {
  const onSessionUpdate = vi.fn()
  const client = createClientImpl({ onSessionUpdate })

  beforeEach(() => {
    onSessionUpdate.mockReset()
  })

  it("with option kind=allow_once → selects it", async () => {
    const params = makeParams([
      { optionId: "a", name: "Allow once", kind: "allow_once" },
      { optionId: "b", name: "Allow always", kind: "allow_always" },
      { optionId: "c", name: "Reject", kind: "reject_once" },
    ])
    const res = await client.requestPermission(params)
    expect(res.outcome).toEqual({ outcome: "selected", optionId: "a" })
  })

  it("with allow_always present but no allow_once → selects allow_always", async () => {
    const params = makeParams([
      { optionId: "b", name: "Allow always", kind: "allow_always" },
      { optionId: "c", name: "Reject", kind: "reject_once" },
    ])
    const res = await client.requestPermission(params)
    expect(res.outcome).toEqual({ outcome: "selected", optionId: "b" })
  })

  it("with only reject options → falls back to first option (impl's last-resort path)", async () => {
    const params = makeParams([
      { optionId: "r1", name: "Reject once", kind: "reject_once" },
      { optionId: "r2", name: "Reject always", kind: "reject_always" },
    ])
    const res = await client.requestPermission(params)
    expect(res.outcome).toEqual({ outcome: "selected", optionId: "r1" })
  })

  it("with no options → returns cancelled", async () => {
    const params = makeParams([])
    const res = await client.requestPermission(params)
    expect(res.outcome).toEqual({ outcome: "cancelled" })
  })

  it("with reject_once + allow_once → selects allow_once (not reject)", async () => {
    const params = makeParams([
      { optionId: "r", name: "Reject", kind: "reject_once" },
      { optionId: "a", name: "Allow once", kind: "allow_once" },
    ])
    const res = await client.requestPermission(params)
    expect(res.outcome).toEqual({ outcome: "selected", optionId: "a" })
  })

  it("with unknown kind only → still picks it (non-reject fallback)", async () => {
    // kind is enum-typed in the SDK but we exercise the impl's runtime branch.
    const params = makeParams([
      { optionId: "x", name: "Other", kind: "custom_xyz" as PermOpt["kind"] },
    ])
    const res = await client.requestPermission(params)
    expect(res.outcome).toEqual({ outcome: "selected", optionId: "x" })
  })
})

describe("createClientImpl — sessionUpdate", () => {
  it("forwards notification to onSessionUpdate callback", async () => {
    const onSessionUpdate = vi.fn()
    const client = createClientImpl({ onSessionUpdate })

    const notification = {
      sessionId: "sess-1",
      update: { sessionUpdate: "agent_message_chunk" as const },
    } as unknown as SessionUpdParams
    await client.sessionUpdate(notification)

    expect(onSessionUpdate).toHaveBeenCalledWith(notification)
  })
})

describe("createClientImpl — fs operations", () => {
  let tmpDir: string
  const client = createClientImpl({ onSessionUpdate: () => {} })

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "client-impl-test-"))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("readTextFile with existing path → returns content", async () => {
    const filePath = path.join(tmpDir, "hello.txt")
    await fs.writeFile(filePath, "Hello, world!", "utf8")

    const res = await client.readTextFile({
      path: filePath,
      sessionId: "s",
    } as ReadTextParams)
    expect(res.content).toBe("Hello, world!")
  })

  it("readTextFile with line + limit → returns slice", async () => {
    const filePath = path.join(tmpDir, "lines.txt")
    await fs.writeFile(filePath, "L1\nL2\nL3\nL4\nL5", "utf8")

    const res = await client.readTextFile({
      path: filePath,
      line: 2,
      limit: 2,
      sessionId: "s",
    } as ReadTextParams)
    expect(res.content).toBe("L2\nL3")
  })

  it("readTextFile with line only (no limit) → returns from line to end", async () => {
    const filePath = path.join(tmpDir, "lines.txt")
    await fs.writeFile(filePath, "L1\nL2\nL3", "utf8")

    const res = await client.readTextFile({
      path: filePath,
      line: 2,
      sessionId: "s",
    } as ReadTextParams)
    expect(res.content).toBe("L2\nL3")
  })

  it("readTextFile with non-existent path → throws (ENOENT)", async () => {
    const filePath = path.join(tmpDir, "does-not-exist.txt")
    await expect(
      client.readTextFile({ path: filePath, sessionId: "s" } as ReadTextParams),
    ).rejects.toThrow(/ENOENT/)
  })

  it("writeTextFile creates file with given content + returns {}", async () => {
    const filePath = path.join(tmpDir, "out.txt")
    const res = await client.writeTextFile({
      path: filePath,
      content: "written by test",
      sessionId: "s",
    } as WriteTextParams)

    expect(res).toEqual({})
    const onDisk = await fs.readFile(filePath, "utf8")
    expect(onDisk).toBe("written by test")
  })

  it("writeTextFile overwrites existing file", async () => {
    const filePath = path.join(tmpDir, "overwrite.txt")
    await fs.writeFile(filePath, "original", "utf8")

    await client.writeTextFile({
      path: filePath,
      content: "replaced",
      sessionId: "s",
    } as WriteTextParams)

    const onDisk = await fs.readFile(filePath, "utf8")
    expect(onDisk).toBe("replaced")
  })
})
