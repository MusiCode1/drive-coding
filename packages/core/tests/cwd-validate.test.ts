/**
 * cwd-validate.test.ts — TDD for validateCwd.
 */
import { describe, expect, it } from "vitest"
import { validateCwd } from "../src/cwd-validate"

describe("validateCwd — happy path", () => {
  it("accepts a normal absolute path", () => {
    const result = validateCwd("/home/user/projects/voice-acp-v3")
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe("/home/user/projects/voice-acp-v3")
  })

  it("accepts root /", () => {
    expect(validateCwd("/").isOk()).toBe(true)
  })

  it("accepts path with Hebrew characters", () => {
    expect(validateCwd("/home/user/פרויקט").isOk()).toBe(true)
  })

  it("accepts path with spaces", () => {
    expect(validateCwd("/home/user/my project").isOk()).toBe(true)
  })

  it("strips trailing slash (except root)", () => {
    const result = validateCwd("/home/user/projects/")
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe("/home/user/projects")
  })

  it("keeps root / as-is", () => {
    const result = validateCwd("/")
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe("/")
  })

  it("accepts path with % not followed by two hex digits (real % in name)", () => {
    // e.g. folder named "100%-coverage" → % followed by '-', not hex
    expect(validateCwd("/home/user/100%-coverage").isOk()).toBe(true)
  })
})

describe("validateCwd — Windows paths (cross-platform, גישה A)", () => {
  it("accepts a drive-letter path with backslashes", () => {
    const result = validateCwd("C:\\Users\\aviad\\projects")
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe("C:\\Users\\aviad\\projects")
  })

  it("accepts a drive-letter path with forward slashes", () => {
    expect(validateCwd("D:/UserProjects/AI/drive-coding").isOk()).toBe(true)
  })

  it("accepts lowercase drive letter", () => {
    expect(validateCwd("c:\\temp").isOk()).toBe(true)
  })

  it("accepts a UNC path", () => {
    expect(validateCwd("\\\\server\\share\\folder").isOk()).toBe(true)
  })

  it("keeps a drive root as-is (C:\\)", () => {
    const result = validateCwd("C:\\")
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe("C:\\")
  })

  it("strips trailing backslash (except drive root)", () => {
    const result = validateCwd("C:\\Users\\aviad\\")
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe("C:\\Users\\aviad")
  })

  it("rejects a drive-relative path (C:foo — no separator)", () => {
    const result = validateCwd("C:foo")
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().kind).toBe("not_absolute")
  })

  it("accepts a Windows path with Hebrew and spaces", () => {
    expect(validateCwd("C:\\Users\\פרויקט שלי").isOk()).toBe(true)
  })
})

describe("validateCwd — error cases", () => {
  it("rejects empty string", () => {
    const result = validateCwd("")
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().kind).toBe("empty")
  })

  it("rejects relative path", () => {
    const result = validateCwd("home/user/projects")
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().kind).toBe("not_absolute")
  })

  it("rejects path starting with % (URL-encoded slash artifact)", () => {
    const result = validateCwd("%2Fhome%2Fuser")
    expect(result.isErr()).toBe(true)
    // not_absolute (doesn't start with /) catches this first
    expect(result._unsafeUnwrapErr().kind).toBe("not_absolute")
  })

  it("rejects double-encoded path (F-2 artifact)", () => {
    const result = validateCwd("/%2Fhome%2Fuser%2Fprojects")
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().kind).toBe("contains_percent_encoding")
  })

  it("rejects path with NUL byte", () => {
    const result = validateCwd("/home/user\u0000/projects")
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().kind).toBe("contains_null")
  })

  it("rejects path with newline", () => {
    const result = validateCwd("/home/user\n/projects")
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().kind).toBe("contains_control_chars")
  })

  it("rejects path with carriage return", () => {
    const result = validateCwd("/home/user\r/projects")
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().kind).toBe("contains_control_chars")
  })

  it("rejects path exceeding 4096 chars", () => {
    const result = validateCwd("/" + "a".repeat(4096))
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().kind).toBe("too_long")
  })

  it("accepts path exactly at 4096 chars", () => {
    // '/' + 4095 'a' = 4096 total
    expect(validateCwd("/" + "a".repeat(4095)).isOk()).toBe(true)
  })
})
