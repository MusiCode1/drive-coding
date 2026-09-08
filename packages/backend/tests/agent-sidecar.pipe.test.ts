/**
 * agent-sidecar.pipe.test.ts — the sidecar as an actual process.
 *
 * Spawned rather than imported, for two reasons: `runSidecar` installs signal
 * handlers and calls `process.exit` when its child dies, and the property under
 * test — surviving the death of the thing that started it — cannot be observed
 * from inside the same process.
 *
 * The CLI is a fixture that echoes NDJSON, so a round trip proves the pipe, not
 * the agent.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { connect, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { encodePing } from "@drive-coding/acp-wire"
import { afterEach, describe, expect, it } from "vitest"
import { parseSidecarArgs } from "../src/bin/agent-sidecar.js"

const here = fileURLToPath(new URL(".", import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const sidecarEntry = join(repoRoot, "packages", "backend", "src", "bin", "agent-sidecar.ts")
const fakeCli = join(here, "fixtures", "fake-acp-cli.mjs")

const kids: ChildProcess[] = []
const socks: Socket[] = []
const dirs: string[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "sidecar-"))
  dirs.push(d)
  return d
}

/** Start the sidecar with `cursor` pointed at the echo fixture. */
function startSidecar(socket: string, agentId = "agent-1"): ChildProcess {
  const child = spawn(
    "bun",
    [
      sidecarEntry,
      "--agent-id",
      agentId,
      "--cli-kind",
      "cursor",
      "--cwd",
      tmpdir(),
      "--socket",
      socket,
    ],
    {
      env: {
        ...process.env,
        CLI_SPECS_JSON: JSON.stringify({ cursor: { bin: "node", args: [fakeCli] } }),
        LOG_LEVEL: "silent",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  kids.push(child)
  return child
}

async function waitFor(pred: () => boolean, ms = 15000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (pred()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("timed out")
}

/** Connect and collect complete lines. */
function open(path: string): { sock: Socket; lines: string[] } {
  const sock = connect(path)
  socks.push(sock)
  const lines: string[] = []
  let buf = ""
  sock.on("data", (b: Buffer) => {
    buf += b.toString("utf8")
    let nl = buf.indexOf("\n")
    while (nl !== -1) {
      lines.push(buf.slice(0, nl))
      buf = buf.slice(nl + 1)
      nl = buf.indexOf("\n")
    }
  })
  return { sock, lines }
}

afterEach(() => {
  for (const s of socks) s.destroy()
  socks.length = 0
  for (const k of kids) k.kill("SIGKILL")
  kids.length = 0
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe("parseSidecarArgs", () => {
  const base = ["--agent-id", "a", "--cli-kind", "cursor", "--cwd", "/tmp", "--socket", "/s.sock"]

  it("reads every required flag", () => {
    expect(parseSidecarArgs(base)).toEqual({
      agentId: "a",
      cliKind: "cursor",
      cwd: "/tmp",
      socket: "/s.sock",
      modelOverride: null,
    })
  })

  it("model is optional", () => {
    expect(parseSidecarArgs([...base, "--model", "gpt-5"]).modelOverride).toBe("gpt-5")
  })

  it("names the flag that is missing rather than starting half-configured", () => {
    expect(() => parseSidecarArgs(["--agent-id", "a"])).toThrow(/--cli-kind/)
  })
})

describe("agent-sidecar as a process", () => {
  it("binds the socket and answers _drive/ping with its identity", async () => {
    const socket = join(tmpDir(), "a.sock")
    startSidecar(socket, "agent-xyz")
    await waitFor(() => existsSync(socket))

    const { sock, lines } = open(socket)
    await new Promise<void>((r) => sock.once("connect", () => r()))
    sock.write(encodePing(1))
    await waitFor(() => lines.length > 0)

    const answer = JSON.parse(lines[0]!)
    expect(answer.result.alive).toBe(true)
    expect(answer.result.info).toMatchObject({
      agentId: "agent-xyz",
      cliKind: "cursor",
      hasOwner: false,
    })
    expect(typeof answer.result.info.pid).toBe("number")
  }, 30000)

  it("🔴 relays a frame to the CLI and the answer back", async () => {
    const socket = join(tmpDir(), "a.sock")
    startSidecar(socket)
    await waitFor(() => existsSync(socket))

    const { sock, lines } = open(socket)
    await new Promise<void>((r) => sock.once("connect", () => r()))
    sock.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`)

    await waitFor(() => lines.length > 0)
    expect(JSON.parse(lines[0]!)).toEqual({ jsonrpc: "2.0", id: 1, result: { echo: "initialize" } })
  }, 30000)

  it("🔴 a probe does not disturb the attached owner", async () => {
    const socket = join(tmpDir(), "a.sock")
    startSidecar(socket)
    await waitFor(() => existsSync(socket))

    const owner = open(socket)
    await new Promise<void>((r) => owner.sock.once("connect", () => r()))
    owner.sock.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`)
    await waitFor(() => owner.lines.length > 0)

    let ownerEnded = false
    owner.sock.on("close", () => {
      ownerEnded = true
    })

    for (const id of [10, 11, 12]) {
      const probe = open(socket)
      await new Promise<void>((r) => probe.sock.once("connect", () => r()))
      probe.sock.write(encodePing(id))
      await waitFor(() => probe.lines.length > 0)
      expect(JSON.parse(probe.lines[0]!).result.alive).toBe(true)
      probe.sock.destroy()
    }

    expect(ownerEnded).toBe(false)

    // The session still works after all that probing.
    owner.sock.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new" })}\n`)
    await waitFor(() => owner.lines.length > 1)
    expect(JSON.parse(owner.lines[1]!)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { echo: "session/new" },
    })
  }, 30000)

  it("🔴 the CLI survives the owner disconnecting, and a new owner takes over", async () => {
    // This is the property the whole slice exists for, in miniature: the peer
    // dies, the agent does not, and the next peer picks it up.
    const socket = join(tmpDir(), "a.sock")
    const kid = startSidecar(socket)
    await waitFor(() => existsSync(socket))

    const first = open(socket)
    await new Promise<void>((r) => first.sock.once("connect", () => r()))
    first.sock.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`)
    await waitFor(() => first.lines.length > 0)

    first.sock.destroy()
    await new Promise((r) => setTimeout(r, 100))
    expect(kid.exitCode).toBeNull()
    expect(existsSync(socket)).toBe(true)

    const second = open(socket)
    await new Promise<void>((r) => second.sock.once("connect", () => r()))
    second.sock.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/prompt" })}\n`)
    await waitFor(() => second.lines.length > 0)
    expect(JSON.parse(second.lines[0]!)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { echo: "session/prompt" },
    })
  }, 30000)

  it("shuts down when its CLI exits — no socket outlives its agent", async () => {
    const socket = join(tmpDir(), "a.sock")
    const kid = startSidecar(socket)
    await waitFor(() => existsSync(socket))

    const { sock } = open(socket)
    await new Promise<void>((r) => sock.once("connect", () => r()))
    // The fixture exits on this method. Note it is NOT the socket closing that
    // does it — the test above pins that the child survives exactly that.
    sock.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "_test/exit" })}\n`)

    await waitFor(() => kid.exitCode !== null || kid.signalCode !== null, 20000)
    expect(existsSync(socket)).toBe(false)
  }, 30000)
})
