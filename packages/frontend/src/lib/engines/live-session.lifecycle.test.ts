/**
 * F1/F2 regressions — both found by calev-heavy on the first real gate.
 *
 * F2 is the interesting one: it is the symmetric twin of NBug17. That fix made
 * `connect()` always settle; this one makes a `close()` that lands *during*
 * `connect()` actually take effect. Without it the session came up after the
 * user had closed it, `session.close()` was never called, and a live Gemini
 * session stayed open — burning the microphone and the budget with no UI.
 */
import { describe, expect, it, vi } from "vitest"
import { LiveSessionEngine } from "./live-session"

const deferred = <T>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

const frames = { on: () => () => {}, stop: async () => {} }
const token = { token: "t", model: "m", sessionConfig: {} }

describe("F2 — close() during connect()", () => {
  it("shuts the session that arrives after close(), and stays closed", async () => {
    const gate = deferred<{ close: () => void; send: () => void }>()
    const close = vi.fn()
    let connectEntered = false
    const engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => token,
        provider: {
          id: "fake", inputSampleRate: 16000, outputSampleRate: 24000,
          supportsSilentContext: true,
          connect: () => { connectEntered = true; return gate.promise },
        } as never,
      },
      frames,
    })

    const opening = engine.open()
    // Wait until we are genuinely INSIDE connect(). Closing earlier lands in the
    // token gap, where returning without a session is the correct behaviour and
    // nothing needs shutting — a different branch of the same guard.
    while (!connectEntered) await Promise.resolve()

    engine.close()
    gate.resolve({ close, send: () => {} })
    await opening

    expect(engine.state).toBe("closed")     // must NOT flip to "open"
    expect(close).toHaveBeenCalledTimes(1)  // the late session must be shut
  })

  it("close() in the token gap leaves no session and stays closed", async () => {
    const engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => token,
        provider: {
          id: "fake", inputSampleRate: 16000, outputSampleRate: 24000,
          supportsSilentContext: true,
          connect: async () => { throw new Error("must not be reached") },
        } as never,
      },
      frames,
    })
    const opening = engine.open()
    engine.close()
    await opening
    expect(engine.state).toBe("closed")
  })

  it("a normal open still reaches open", async () => {
    const engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => token,
        provider: {
          id: "fake", inputSampleRate: 16000, outputSampleRate: 24000,
          supportsSilentContext: true,
          connect: async () => ({ close: () => {}, send: () => {} }),
        } as never,
      },
      frames,
    })
    await engine.open()
    expect(engine.state).toBe("open")
  })
})

describe("F1 — transcript entries carry stable identity", () => {
  it("gives distinct ids to finalised entries with identical role and text", async () => {
    let emit!: (e: { type: string; role: string; text: string; final: boolean }) => void
    const engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => token,
        provider: {
          id: "fake", inputSampleRate: 16000, outputSampleRate: 24000,
          supportsSilentContext: true,
          connect: async (opts: { onEvent: typeof emit }) => {
            emit = opts.onEvent
            return { close: () => {}, send: () => {} }
          },
        } as never,
      },
      frames,
    })
    await engine.open()

    // Two finalised chunks with the SAME role and SAME text. Keyed on
    // `role + text` these collide and Svelte 5 throws — in production too.
    emit({ type: "transcript", role: "user", text: "כן", final: true })
    emit({ type: "transcript", role: "user", text: "כן", final: true })

    const ids = engine.transcript.map((e) => e.id)
    expect(engine.transcript.length).toBe(2)
    expect(new Set(ids).size).toBe(2)
  })
})
