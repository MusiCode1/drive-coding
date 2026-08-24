// @ts-check
//
// טסט-אינטגרציה ל-compress-wire-recordings.mjs. כל בדיקה בונה תיקיית-מעבדה
// תחת os.tmpdir() ומריצה את הסקריפט עליה. אין mock ל-/proc.

import { execFileSync, spawn } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { zstdCompressSync, zstdDecompressSync } from "node:zlib"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const SCRIPT = path.resolve(import.meta.dirname, "compress-wire-recordings.mjs")

let lab

/** מריץ את הסקריפט ומחזיר stdout+stderr וקוד יציאה. */
function run(args = []) {
  try {
    const output = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8", stdio: "pipe" })
    return { output, exitCode: 0 }
  } catch (e) {
    return { output: `${e.stdout ?? ""}${e.stderr ?? ""}`, exitCode: e.status ?? 1 }
  }
}

function runDir(args = []) {
  return run(["--dir", lab, ...args])
}

/** דוחס buffer ל-.zst בדיסק. */
function writeZst(filePath, content, level = 12) {
  writeFileSync(filePath, zstdCompressSync(content, { level }))
}

/** poll חסום — מחכה עד שה-fd של הילד גלוי ב-/proc (עד 5s, צעד 50ms). */
async function waitForOpenFd(child, target) {
  const targetReal = realpathSync(target)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      for (const fd of readdirSync(`/proc/${child.pid}/fd`)) {
        try {
          const link = readlinkSync(`/proc/${child.pid}/fd/${fd}`)
          if (link.startsWith("/") && realpathSync(link) === targetReal) return
        } catch {
          // fd שעבר או symlink לא-קבוע
        }
      }
    } catch {
      // pid שמת
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timeout: fd not visible for ${target}`)
}

/** ילד שמחזיק fd פתוח על target. */
function spawnFileHolder(target) {
  return spawn(
    process.execPath,
    [
      "-e",
      `require("node:fs").openSync(process.argv[1], "r"); setInterval(() => {}, 1000)`,
      target,
    ],
    { stdio: "ignore" },
  )
}

beforeEach(() => {
  lab = mkdtempSync(path.join(os.tmpdir(), "cwr-"))
})
afterEach(() => {
  rmSync(lab, { recursive: true, force: true })
})

describe("compress-wire-recordings", () => {
  // #1
  it("dry-run is the default — plans, but touches nothing", () => {
    writeFileSync(path.join(lab, "a.jsonl"), '{"x":1}\n')
    const { output } = runDir()
    expect(output).toContain("would compress 1 file(s)")
    expect(output).toContain("dry-run")
    expect(existsSync(path.join(lab, "a.jsonl"))).toBe(true)
    expect(existsSync(path.join(lab, "a.jsonl.zst"))).toBe(false)
  })

  // #2
  it("--apply compresses and replaces — decompressed bytes match original", () => {
    const content = Buffer.from('{"hello":"world"}\n')
    writeFileSync(path.join(lab, "a.jsonl"), content)
    const { output } = runDir(["--apply"])
    expect(output).toContain("compressed=1 failed=0")
    const zstPath = path.join(lab, "a.jsonl.zst")
    expect(existsSync(zstPath)).toBe(true)
    expect(existsSync(path.join(lab, "a.jsonl"))).toBe(false)
    const restored = zstdDecompressSync(readFileSync(zstPath))
    expect(restored.equals(content)).toBe(true)
  })

  // #3 — ⭐ הבדיקה הבטיחותית
  it("an open file survives --apply — and only because of /proc", async () => {
    const target = path.join(lab, "open.jsonl")
    writeFileSync(target, '{"live":true}\n')
    const child = spawnFileHolder(target)
    try {
      await waitForOpenFd(child, target)
      const { output } = runDir(["--apply"])
      expect(output).toContain("open by a live process")
      expect(existsSync(target)).toBe(true)
      expect(existsSync(`${target}.zst`)).toBe(false)
      // בקרה שלילית: אותו קובץ, אותו רגע — בלי בדיקת /proc
      const { output: neg } = runDir(["--no-process-check"])
      expect(neg).toContain("would compress 1 file(s)")
    } finally {
      child.kill()
    }
  })

  // #4
  it("a zero-byte open file is not deleted on --apply", async () => {
    const target = path.join(lab, "empty-open.jsonl")
    writeFileSync(target, "")
    const child = spawnFileHolder(target)
    try {
      await waitForOpenFd(child, target)
      runDir(["--apply"])
      expect(existsSync(target)).toBe(true)
    } finally {
      child.kill()
    }
  })

  // #5
  it("a released zero-byte file is deleted on --apply, dry-run only reports", () => {
    writeFileSync(path.join(lab, "empty.jsonl"), "")
    const dry = runDir()
    expect(dry.output).toContain("would delete 1 empty file(s)")
    expect(existsSync(path.join(lab, "empty.jsonl"))).toBe(true)
    const applied = runDir(["--apply"])
    expect(applied.output).toContain("empty-deleted=1")
    expect(existsSync(path.join(lab, "empty.jsonl"))).toBe(false)
  })

  // #6א
  it("existing .zst that does not match source — neither file touched", () => {
    writeFileSync(path.join(lab, "a.jsonl"), "hello")
    writeZst(path.join(lab, "a.jsonl.zst"), Buffer.from("other content"))
    runDir(["--apply"])
    expect(existsSync(path.join(lab, "a.jsonl"))).toBe(true)
    expect(existsSync(path.join(lab, "a.jsonl.zst"))).toBe(true)
    expect(runDir(["--apply"]).output).toContain(".zst already exists")
  })

  // #6ב
  it("existing .zst that matches source — source removed as duplicate", () => {
    const content = Buffer.from("duplicate me\n")
    writeFileSync(path.join(lab, "a.jsonl"), content)
    writeZst(path.join(lab, "a.jsonl.zst"), content)
    const { output } = runDir(["--apply"])
    expect(existsSync(path.join(lab, "a.jsonl"))).toBe(false)
    expect(existsSync(path.join(lab, "a.jsonl.zst"))).toBe(true)
    expect(output).toContain("removed duplicate")
    expect(output).toContain("dup-removed=1")
  })

  // #7
  it("stale .part files are removed — name starts with a dot", () => {
    writeFileSync(path.join(lab, ".a.jsonl.zst.part"), "partial")
    const dry = runDir()
    expect(dry.output).toContain("would remove 1 stale .part file(s)")
    expect(existsSync(path.join(lab, ".a.jsonl.zst.part"))).toBe(true)
    runDir(["--apply"])
    expect(existsSync(path.join(lab, ".a.jsonl.zst.part"))).toBe(false)
  })

  // #8
  it("ignores non-.jsonl, subdirs, and symlinks — no recursion", () => {
    writeFileSync(path.join(lab, "notes.txt"), "nope")
    mkdirSync(path.join(lab, "sub"))
    writeFileSync(path.join(lab, "sub", "deep.jsonl"), "{}")
    symlinkSync(path.join(lab, "sub", "deep.jsonl"), path.join(lab, "link.jsonl"))
    const { output } = runDir(["--apply", "--no-process-check"])
    expect(existsSync(path.join(lab, "notes.txt"))).toBe(true)
    expect(existsSync(path.join(lab, "sub", "deep.jsonl"))).toBe(true)
    expect(existsSync(path.join(lab, "link.jsonl"))).toBe(true)
    expect(output).toContain("not a regular file")
  })

  // #9
  it("--max-age-days deletes old .zst only — never .jsonl", async () => {
    const keep = path.join(lab, "keep.jsonl")
    writeFileSync(keep, "{}")
    writeZst(path.join(lab, "old.jsonl.zst"), Buffer.from("old"))
    writeZst(path.join(lab, "fresh.jsonl.zst"), Buffer.from("fresh"))
    const ancient = Date.now() - 100 * 86_400_000
    utimesSync(path.join(lab, "old.jsonl.zst"), ancient / 1000, ancient / 1000)
    const child = spawnFileHolder(keep)
    try {
      await waitForOpenFd(child, keep)
      runDir(["--max-age-days", "90", "--apply"])
      expect(existsSync(path.join(lab, "old.jsonl.zst"))).toBe(false)
      expect(existsSync(path.join(lab, "fresh.jsonl.zst"))).toBe(true)
      expect(existsSync(keep)).toBe(true)
    } finally {
      child.kill()
    }
  })

  // #10
  it("missing dir prints dir not found and exits 0", () => {
    const missing = path.join(lab, "no-such-dir")
    const { output, exitCode } = run(["--dir", missing])
    expect(output).toContain(`dir not found: ${missing}`)
    expect(exitCode).toBe(0)
  })

  // #11
  it.skipIf(process.getuid?.() === 0)(
    "compression failure leaves source intact — no orphan .part",
    () => {
      writeFileSync(path.join(lab, "locked.jsonl"), "secret")
      chmodSync(path.join(lab, "locked.jsonl"), 0o000)
      try {
        const { output, exitCode } = runDir(["--apply", "--no-process-check"])
        expect(existsSync(path.join(lab, "locked.jsonl"))).toBe(true)
        expect(existsSync(path.join(lab, "locked.jsonl.zst"))).toBe(false)
        expect(existsSync(path.join(lab, ".locked.jsonl.zst.part"))).toBe(false)
        expect(output).toContain("failed=1")
        expect(exitCode).toBe(1)
      } finally {
        chmodSync(path.join(lab, "locked.jsonl"), 0o644)
      }
    },
  )

  // #12
  it("--max-total-mb deletes oldest .zst first until under cap", () => {
    // גודל על הדיסק — לא תוכן דחוס (zstd היה מקטין Buffer.alloc חוזר)
    writeFileSync(path.join(lab, "a.jsonl.zst"), Buffer.alloc(600 * 1024))
    writeFileSync(path.join(lab, "b.jsonl.zst"), Buffer.alloc(600 * 1024))
    writeFileSync(path.join(lab, "c.jsonl.zst"), Buffer.alloc(600 * 1024))
    const t1 = Date.now() - 300_000
    const t2 = Date.now() - 200_000
    const t3 = Date.now() - 100_000
    utimesSync(path.join(lab, "a.jsonl.zst"), t1 / 1000, t1 / 1000)
    utimesSync(path.join(lab, "b.jsonl.zst"), t2 / 1000, t2 / 1000)
    utimesSync(path.join(lab, "c.jsonl.zst"), t3 / 1000, t3 / 1000)
    const dry = runDir(["--max-total-mb", "1", "--no-process-check"])
    expect(dry.output).toContain("would delete")
    expect(dry.output).toContain(".zst file(s) over the retention cap")
    const { output } = runDir(["--max-total-mb", "1", "--apply", "--no-process-check"])
    expect(existsSync(path.join(lab, "a.jsonl.zst"))).toBe(false)
    expect(existsSync(path.join(lab, "b.jsonl.zst"))).toBe(false)
    expect(existsSync(path.join(lab, "c.jsonl.zst"))).toBe(true)
    expect(output).toContain("zst-deleted=")
  })

  // #13
  it("invalid --level exits 1 with message and touches nothing", () => {
    writeFileSync(path.join(lab, "a.jsonl"), "{}")
    const { output, exitCode } = runDir(["--level", "99"])
    expect(output).toContain("--level must be an integer between 1 and 22")
    expect(exitCode).toBe(1)
    expect(existsSync(path.join(lab, "a.jsonl"))).toBe(true)
  })

  // #14 — תקרות רצות לפני דחיסה
  it("retention runs before compression — .zst created this run is not deleted", () => {
    writeFileSync(path.join(lab, "new.jsonl"), '{"frame":1}\n')
    const { output } = runDir(["--max-age-days", "0", "--apply", "--no-process-check"])
    expect(existsSync(path.join(lab, "new.jsonl.zst"))).toBe(true)
    expect(output).toContain("zst-deleted=0")
  })
})
