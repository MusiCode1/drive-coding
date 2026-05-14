/**
 * Characterization tests for `extractProviderError`.
 *
 * Behaviors documented in `docs/behaviors.md` (PROMPT-19, ACP-4).
 *
 * The function scans stderr lines (newest at the END of the array) and
 * returns either (a) a JSON `"message":"..."` whose contents match one
 * of: credit/invalid/unauthor/forbid/rate/limit/key, or (b) an opencode
 * `ERROR ... error=...` line, capped at 200 chars.
 *
 * Pattern 1 scans the last 30 lines.
 * Pattern 2 scans the last 50 lines.
 * Returns null if neither pattern matches.
 */

import { describe, expect, test } from "bun:test";
import { extractProviderError } from "../src/provider-error.ts";

describe("extractProviderError — pattern 1: JSON message", () => {
  test("Anthropic credit error in last line", () => {
    const lines = [
      "INFO request started",
      `INFO acp call`,
      `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}`,
    ];
    expect(extractProviderError(lines)).toBe(
      "Your credit balance is too low to access the Anthropic API.",
    );
  });

  test("invalid API key — keyword 'invalid'", () => {
    const lines = [
      `{"error":{"message":"Invalid API key provided. Check your authentication."}}`,
    ];
    expect(extractProviderError(lines)).toBe(
      "Invalid API key provided. Check your authentication.",
    );
  });

  test("rate limit — keyword 'rate'", () => {
    const lines = [
      `{"message":"Rate limit exceeded for this account."}`,
    ];
    expect(extractProviderError(lines)).toBe(
      "Rate limit exceeded for this account.",
    );
  });

  test("unauthorized — keyword 'unauthor'", () => {
    const lines = [
      `{"message":"Request unauthorized. Please re-authenticate."}`,
    ];
    expect(extractProviderError(lines)).toBe(
      "Request unauthorized. Please re-authenticate.",
    );
  });

  test("message without a keyword is NOT returned", () => {
    const lines = [
      `{"message":"Random log message about nothing in particular."}`,
    ];
    expect(extractProviderError(lines)).toBeNull();
  });

  test("message too short (<10 chars) is NOT matched", () => {
    const lines = [`{"message":"oops"}`];
    expect(extractProviderError(lines)).toBeNull();
  });

  test("scans the LAST 30 lines only (older lines ignored)", () => {
    // 50 noise lines, then keyword far enough in the past (>30 from end).
    const lines = [
      `{"message":"Credit too low here at start."}`, // way old — ignored
      ...Array(40).fill("INFO noise"),
    ];
    expect(extractProviderError(lines)).toBeNull();
  });

  test("returns the MOST RECENT match (scans newest-first)", () => {
    const lines = [
      `{"message":"First credit error long ago."}`,
      `{"message":"Latest credit error to report."}`,
    ];
    expect(extractProviderError(lines)).toBe(
      "Latest credit error to report.",
    );
  });
});

describe("extractProviderError — pattern 2: opencode ERROR log", () => {
  test("ERROR line with error= field", () => {
    const lines = [
      "INFO starting",
      "ERROR provider failed error=Could not connect to upstream",
    ];
    expect(extractProviderError(lines)).toBe(
      "Could not connect to upstream",
    );
  });

  test("ERROR with stack= field — strips at stack", () => {
    const lines = [
      "ERROR module=acp error=Stream closed unexpectedly stack=at foo:1",
    ];
    expect(extractProviderError(lines)).toBe(
      "Stream closed unexpectedly",
    );
  });

  test("ERROR long message is capped at 200 chars", () => {
    const long = "x".repeat(500);
    const lines = [`ERROR error=${long}`];
    const result = extractProviderError(lines);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(200);
    expect(result).toBe("x".repeat(200));
  });

  test("ERROR pattern is fallback — pattern 1 has priority", () => {
    // Both patterns match. Pattern 1 (JSON) wins because it's checked first.
    const lines = [
      `ERROR error=plain error`,
      `{"message":"Invalid credentials, try again."}`,
    ];
    expect(extractProviderError(lines)).toBe(
      "Invalid credentials, try again.",
    );
  });

  test("ERROR pattern scans last 50 lines", () => {
    // 60 noise lines, then ERROR far back — should be missed.
    const lines = [
      "ERROR error=ancient error",
      ...Array(55).fill("INFO noise"),
    ];
    expect(extractProviderError(lines)).toBeNull();
  });
});

describe("extractProviderError — edge cases", () => {
  test("empty stderr → null", () => {
    expect(extractProviderError([])).toBeNull();
  });

  test("only noise → null", () => {
    expect(
      extractProviderError(["INFO a", "INFO b", "WARN c"]),
    ).toBeNull();
  });

  test("message with all 7 keywords each in turn", () => {
    for (const kw of [
      "credit balance low",
      "invalid token used",
      "unauthorized request received",
      "forbidden access here",
      "rate limit reached",
      "limit per minute exceeded",
      "API key missing here",
    ]) {
      const lines = [`{"message":"${kw}"}`];
      // All should match (each contains one keyword and is ≥10 chars).
      expect(extractProviderError(lines)).toBe(kw);
    }
  });
});
