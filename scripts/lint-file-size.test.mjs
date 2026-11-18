// @ts-check
//
// Regression tests for the size+impurity ratchet. Each case builds a lab
// tree under os.tmpdir() and runs the CLI — a mock would not catch a
// ratchet that never fails.

import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const SCRIPT = path.resolve(import.meta.dirname, "lint-file-size.mjs")
const REPO = path.resolve(import.meta.dirname, "..")
const BUDGETS_SRC = path.join(REPO, "size-budgets.json")
const FAT = "packages/lab/src/util/fat.ts"
/** util mixed budget = 150. 200 lines of mixed code is over budget → baseline. */
const OVER = 200
const OVER_GROWN = 220
const OVER_SHRUNK = 180

let lab

/** Mixed (clock impurity) file with exactly `n` newline characters. */
function mixedFile(n) {
  const lines = ["export const t = Date.now()"]
  while (lines.length < n) lines.push(`const n${lines.length} = ${lines.length}`)
  return `${lines.join("\n")}\n`
}

function writeFat(n) {
  writeFileSync(path.join(lab, FAT), mixedFile(n))
}

function readBaseline() {
  return JSON.parse(readFileSync(path.join(lab, "size-baseline.json"), "utf8"))
}

function run(args = []) {
  try {
    const output = execFileSync("node", [SCRIPT, "--root", lab, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    })
    return { output, exitCode: 0 }
  } catch (e) {
    return {
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
      exitCode: e.status ?? 1,
    }
  }
}

beforeEach(() => {
  lab = mkdtempSync(path.join(os.tmpdir(), "lint-size-"))
  mkdirSync(path.dirname(path.join(lab, FAT)), { recursive: true })
  cpSync(BUDGETS_SRC, path.join(lab, "size-budgets.json"))
  writeFat(OVER)
  const init = run(["--init-baseline"])
  expect(init.exitCode, init.output).toBe(0)
})

afterEach(() => {
  rmSync(lab, { recursive: true, force: true })
})

describe("svelte markup comments (2026-09-30)", () => {
  const SV = "packages/lab/src/lib/components/Widget.svelte"
  // components budget = 50 scriptLines; the baseline only records files over budget.
  const BIG_SCRIPT = `<script>\n${Array.from({ length: 60 }, (_, i) => `const n${i} = ${i}`).join("\n")}\n</script>\n`

  /** codeLines recorded for a .svelte file whose markup is `markup`. */
  function codeLinesOf(markup) {
    mkdirSync(path.dirname(path.join(lab, SV)), { recursive: true })
    writeFileSync(path.join(lab, SV), `${BIG_SCRIPT}\n${markup}`)
    rmSync(path.join(lab, "size-baseline.json"), { force: true })
    const r = run(["--init-baseline"])
    expect(r.exitCode, r.output).toBe(0)
    const e = readBaseline().files[SV]
    expect(e, `no baseline entry for ${SV}`).toBeTruthy()
    return e.codeLines
  }

  it("does not count an HTML comment as code", () => {
    const withComment = codeLinesOf("<!-- one -->\n<!-- two -->\n<div>x</div>\n")
    const without = codeLinesOf("<div>x</div>\n")
    expect(withComment).toBe(without)
  })

  it("🔴 an apostrophe in a markup comment must not swallow the markup after it", () => {
    // Real shape: a Hebrew comment containing ר' — one unbalanced quote. Before
    // 2026-09-30 it opened a "string" that desynchronised quote state for the rest
    // of the file, blanking real markup; codeLines under-reported by hundreds.
    const withQuote = codeLinesOf(
      "<!-- ר' see Other.svelte -->\n<div>one</div>\n<div>two</div>\n<div>three</div>\n",
    )
    const plain = codeLinesOf("<div>one</div>\n<div>two</div>\n<div>three</div>\n")
    expect(withQuote).toBe(plain)
  })

  it("leaves .ts files alone — `<!--` is not a comment there", () => {
    const TS = "packages/lab/src/util/angle.ts"
    mkdirSync(path.dirname(path.join(lab, TS)), { recursive: true })
    writeFileSync(
      path.join(lab, TS),
      // impure first line so it lands in the same (mixed) budget class as FAT
      `export const t = Date.now()\n${Array.from({ length: 199 }, (_, i) => `const q${i} = ${i} < !--${i}`).join("\n")}\n`,
    )
    rmSync(path.join(lab, "size-baseline.json"), { force: true })
    const r = run(["--init-baseline"])
    expect(r.exitCode, r.output).toBe(0)
    expect(readBaseline().files[TS].codeLines).toBe(200)
  })
})

describe("lint-file-size on the repo", () => {
  it("is green and does not flag core/session/reduce.ts", () => {
    try {
      const output = execFileSync("node", [SCRIPT], {
        cwd: REPO,
        encoding: "utf8",
        stdio: "pipe",
      })
      expect(output).toMatch(/no growth/)
      expect(output).not.toMatch(/reduce\.ts/)
    } catch (e) {
      const output = `${e.stdout ?? ""}${e.stderr ?? ""}`
      expect(output).not.toMatch(/reduce\.ts/)
      throw new Error(output)
    }
  })
})

describe("lint-file-size ratchet", () => {
  it("a baseline file that grew is red", () => {
    const before = readBaseline().files[FAT].metric
    writeFat(OVER_GROWN)
    const r = run()
    expect(r.exitCode).toBe(1)
    expect(r.output).toMatch(/code grew/)
    expect(r.output).toContain(`${before} → ${OVER_GROWN}`)
    expect(readBaseline().files[FAT].metric).toBe(before)
  })

  it("a baseline file that shrank is green and --update-baseline lowers the recorded metric", () => {
    const before = readBaseline().files[FAT].metric
    writeFat(OVER_SHRUNK)
    const stale = run()
    expect(stale.exitCode).toBe(1)
    expect(stale.output).toMatch(/stale baseline/)
    expect(readBaseline().files[FAT].metric).toBe(before)

    const down = run(["--update-baseline"])
    expect(down.exitCode, down.output).toBe(0)
    expect(down.output).toMatch(/wrote-down/)
    expect(readBaseline().files[FAT].metric).toBe(OVER_SHRUNK)
    expect(readBaseline().files[FAT].metric).toBeLessThan(before)
  })

  it("refuses to raise a baseline entry via --update-baseline", () => {
    const before = readBaseline().files[FAT].metric
    writeFat(OVER_GROWN)
    const r = run(["--update-baseline"])
    expect(r.exitCode).toBe(1)
    expect(r.output).toMatch(/code grew/)
    expect(readBaseline().files[FAT].metric).toBe(before)
    expect(readBaseline().files[FAT].metric).toBeLessThan(OVER_GROWN)
  })

  // ─── 2026-09-29: גדילה בהערות אינה חסימה ───────────────────────────────
  // הכלל גזר מ-`wc -l`, ולכן תיקון-הערה בקובץ חורג עלה 25 שורות חילוץ —
  // וסוכן דילג על שיפור הערה במקום לשלם. שני הטסטים האלה מקבעים את התיקון.

  it("comment-only growth on an over-budget file is GREEN", () => {
    const before = readBaseline().files[FAT]
    // אותו קוד בדיוק, + 40 שורות הערה
    const comments = Array.from({ length: 40 }, (_, i) => `// note ${i}`).join("\n")
    writeFileSync(path.join(lab, FAT), `${comments}\n${mixedFile(OVER)}`)
    const r = run()
    expect(r.exitCode, r.output).toBe(0)
    expect(r.output).not.toMatch(/code grew/)
    // metric אכן גדל — וזה מותר במפורש
    expect(readBaseline().files[FAT].metric).toBe(before.metric)
  })

  it("comment-only edit on an over-budget STAGED file owes no extraction", () => {
    // זה המקרה שבגללו התיקון נעשה: סוכן דילג על שיפור הערה כדי לא לשלם
    // 25 שורות חילוץ.
    // 🔴 חייב git אמיתי + staging: stagedPaths קורא `git diff --cached`, ובלי
    // מאגר הוא מחזיר קבוצה ריקה וכלל ה-must-shrink אינרטי — כלומר הטסט היה
    // עובר מהסיבה הלא-נכונה. לכן הבדיקה השנייה למטה מאמתת שהכלל **כן** פעיל.
    const git = (...a) =>
      execFileSync("git", a, { cwd: lab, encoding: "utf8", stdio: "pipe" })
    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    git("add", "-A")
    git("commit", "-qm", "base")

    // ‏(א) ‏שער-שפיות: ‏מחיקת קוד קטנה מדי **כן** מפעילה את הכלל בעץ הזה
    writeFat(OVER - 3)
    git("add", FAT)
    const tooSmall = run()
    expect(tooSmall.output, "must-shrink חייב להיות פעיל כאן").toMatch(/רק מסירים|ירידה/)

    // ‏(ב) ‏ההתנהגות שמתוקנת: ‏אותו קוד בדיוק + ‏הערה אחת ⇒ ‏אין חוב
    writeFileSync(path.join(lab, FAT), `// one new note\n${mixedFile(OVER)}`)
    git("add", FAT)
    const r = run()
    expect(r.exitCode, r.output).toBe(0)
    expect(r.output).not.toMatch(/רק מסירים|ירידה/)
  })

  it("code growth is still RED even when total lines shrink", () => {
    // 30 שורות הערה יוצאות, 10 שורות קוד נכנסות ⇒ wc -l יורד, קוד עולה.
    const base = mixedFile(OVER)
    const withComments = `${Array.from({ length: 30 }, (_, i) => `// c${i}`).join("\n")}\n${base}`
    writeFileSync(path.join(lab, FAT), withComments)
    const init = run(["--update-baseline"])
    expect(init.exitCode, init.output).toBe(0)

    const extraCode = Array.from({ length: 10 }, (_, i) => `const x${i} = ${i}`).join("\n")
    writeFileSync(path.join(lab, FAT), `${base}${extraCode}\n`)
    const r = run()
    expect(r.exitCode, r.output).toBe(1)
    expect(r.output).toMatch(/code grew/)
  })

  it("impurity growth on a baseline file is red even when lines stay put", () => {
    const before = readBaseline().files[FAT]
    writeFileSync(
      path.join(lab, FAT),
      mixedFile(OVER).replace("Date.now()", "Date.now() + Date.now()"),
    )
    const r = run()
    expect(r.exitCode).toBe(1)
    expect(r.output).toMatch(/impurity grew/)
    expect(readBaseline().files[FAT].impurity).toBe(before.impurity)
  })
})
