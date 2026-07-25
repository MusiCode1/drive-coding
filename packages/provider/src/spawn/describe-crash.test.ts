/**
 * describe-crash.test.ts — TDD for slice surface-crash-stderr, Commit 0.
 *
 * describeCrash step 4 (non-zero exit, no provider-error match): today it
 * returns the bare "Exited with code N", discarding the real reason that may
 * sit in stderr. Fixture (א) is the real stderr line reported by the user
 * connecting cursor (`agent acp`) — see brief §0.
 *
 * Priority order stays: provider-error (1) > spawnError (2) > signal (3) >
 * exit-code+stderr (4) > undefined (5). Only step 4 gains the stderr line.
 */

import { describe, expect, it } from "vitest"
import { describeCrash } from "./describe-crash.js"

describe("describeCrash — stderr-enriched exit reason (Commit 0)", () => {
  it("(א) exit=1 + meaningful stderr line → 'Exited with code 1: <stderr>'", () => {
    const reason = describeCrash({ exitCode: 1, signal: null }, [
      "Error: No such device or address (os error 6)",
    ])
    expect(reason).toBe("Exited with code 1: Error: No such device or address (os error 6)")
  })

  it("(ב) exit=1 + empty stderr → 'Exited with code 1' (regression — today's behavior)", () => {
    const reason = describeCrash({ exitCode: 1, signal: null }, [])
    expect(reason).toBe("Exited with code 1")
  })

  it("(ג) provider-error still wins over stderr line (priority 1 > 4)", () => {
    const reason = describeCrash({ exitCode: 1, signal: null }, [
      '{"message":"invalid api key"}',
      "some trailing noise line",
    ])
    expect(reason).toBe("invalid api key")
  })

  it("(ד) signal still 'Killed by signal SIGKILL' — unaffected by stderr presence", () => {
    const reason = describeCrash({ exitCode: null, signal: "SIGKILL" }, [
      "some stderr line that should not be appended",
    ])
    expect(reason).toBe("Killed by signal SIGKILL")
  })

  it("(ה) exit=0 → undefined (clean exit, no reason)", () => {
    const reason = describeCrash({ exitCode: 0, signal: null }, ["irrelevant stderr line"])
    expect(reason).toBeUndefined()
  })

  it("prefers a line matching /error|fatal|panic|failed/i over a later non-matching line", () => {
    const reason = describeCrash({ exitCode: 1, signal: null }, [
      "fatal: something broke",
      "unrelated trailing log line",
    ])
    expect(reason).toBe("Exited with code 1: fatal: something broke")
  })

  it("caps the appended stderr line at ~200 chars", () => {
    const long = "x".repeat(400)
    const reason = describeCrash({ exitCode: 1, signal: null }, [long])
    expect(reason?.startsWith("Exited with code 1: ")).toBe(true)
    expect(reason?.length).toBeLessThanOrEqual("Exited with code 1: ".length + 200)
  })

  it("skips trailing empty/whitespace-only stderr lines, uses last meaningful one", () => {
    const reason = describeCrash({ exitCode: 1, signal: null }, [
      "Error: No such device or address (os error 6)",
      "",
      "   ",
    ])
    expect(reason).toBe("Exited with code 1: Error: No such device or address (os error 6)")
  })
})
