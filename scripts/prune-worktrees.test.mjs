// @ts-check
//
// טסט-אינטגרציה ל-prune-worktrees.mjs. **לא unit** במכוון: כל ההתנהגות של
// הסקריפט היא תוצר של git אמיתי ושל מערכת-הקבצים, ו-mock היה בודק את ה-mock.
// לכן כל בדיקה בונה ריפו-מעבדה תחת os.tmpdir() ומריצה את הסקריפט עליו.
//
// שתי הבדיקות בסוף (stale entry · basename מתנגש) הן **רגרסיה**: שתיהן נמצאו
// באימות ידני אחרי שהסקריפט כבר נכתב, ואחת מהן הפילה אותו לגמרי.

import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const SCRIPT = path.resolve(import.meta.dirname, "prune-worktrees.mjs")

let root

/** git בתוך תיקייה — זורק עם stderr קריא אם נכשל. */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

/** מריץ את הסקריפט ומחזיר stdout+stderr, גם כשהיציאה אינה 0. */
function run(cwd, args = []) {
  try {
    return execFileSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8", stdio: "pipe" })
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`
  }
}

/** ריפו עם commit אחד, ענף `unmerged` שקדימה בקומיט, ו-worktrees לפי הצורך. */
function makeRepo() {
  const repo = path.join(root, "repo")
  mkdirSync(repo)
  git(repo, "init", "-q", "-b", "main")
  git(repo, "config", "user.email", "t@t")
  git(repo, "config", "user.name", "t")
  writeFileSync(path.join(repo, "a.txt"), "a")
  git(repo, "add", ".")
  git(repo, "commit", "-qm", "A")
  return repo
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "pwt-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("prune-worktrees", () => {
  it("dry-run is the default — plans, but removes nothing", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../wt", "-b", "m1", "main")
    const out = run(repo, ["--base", "main"])
    expect(out).toContain("would remove 1 worktree(s)")
    expect(out).toContain("dry-run")
    // ⚠️ "/wt" ולא "wt": התחילית של mkdtemp היא "pwt-", ולכן toContain("wt")
    // מתקיים תמיד — הטסט היה עובר גם אם המחיקה שבורה.
    expect(git(repo, "worktree", "list")).toContain("/wt")
  })

  it("--apply removes a clean, contained worktree and prunes", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../wt", "-b", "m1", "main")
    const out = run(repo, ["--base", "main", "--apply"])
    expect(out).toContain("removed=1 failed=0")
    expect(git(repo, "worktree", "list")).not.toContain("/wt")
  })

  it("skips a worktree with uncommitted changes", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../wt", "-b", "m1", "main")
    writeFileSync(path.join(root, "wt", "dirty.txt"), "x")
    expect(run(repo, ["--base", "main"])).toContain("uncommitted changes")
    expect(run(repo, ["--base", "main"])).toContain("would remove 0")
  })

  it("skips a branch that is not contained in any base", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../wt", "-b", "ahead", "main")
    writeFileSync(path.join(root, "wt", "b.txt"), "b")
    git(path.join(root, "wt"), "add", ".")
    git(path.join(root, "wt"), "commit", "-qm", "B")
    expect(run(repo, ["--base", "main"])).toContain("not contained in main")
  })

  it("never removes a worktree whose branch is itself a base", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../wt", "-b", "m1", "main")
    expect(run(repo, ["--base", "m1"])).toContain("is a base ref")
  })

  it("never removes the worktree the command runs from", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../wt", "-b", "m1", "main")
    expect(run(path.join(root, "wt"), ["--base", "main"])).toContain("cwd is inside it")
  })

  // רגרסיה חוצה-פלטפורמות: נמצא חי על Windows — ההשוואה הישנה הייתה
  // `here.startsWith(real + "/")`, וב-Windows המפריד הוא `\\`, ולכן הרצה
  // מתת-תיקייה **לא** הדליקה את השומר וה-worktree נכנס לרשימת-המחיקה.
  it("cwd guard fires from a subdirectory too, not just the worktree root", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../wt", "-b", "m1", "main")
    const sub = path.join(root, "wt", "sub")
    mkdirSync(sub)
    expect(run(sub, ["--base", "main"])).toContain("cwd is inside it")
  })

  it("--keep spares a worktree by name", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../wt", "-b", "m1", "main")
    expect(run(repo, ["--base", "main", "--keep", "wt"])).toContain("--keep")
  })

  it("exits non-zero on an unknown base instead of removing anything", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../wt", "-b", "m1", "main")
    expect(run(repo, ["--base", "no/such/ref", "--apply"])).toContain("base not found")
    expect(git(repo, "worktree", "list")).toContain("/wt")
  })

  it("--delete-branches removes a merged branch and keeps an unmerged one", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../merged", "-b", "m1", "main")
    git(repo, "worktree", "add", "-q", "../ahead", "-b", "ahead", "main")
    writeFileSync(path.join(root, "ahead", "b.txt"), "b")
    git(path.join(root, "ahead"), "add", ".")
    git(path.join(root, "ahead"), "commit", "-qm", "B")
    run(repo, ["--base", "main", "--apply", "--delete-branches"])
    expect(git(repo, "branch", "--list", "m1")).toBe("")
    expect(git(repo, "branch", "--list", "ahead")).toContain("ahead")
  })

  // ⭐ הבדיקה שבגללה הסקריפט קיים: `git worktree remove` בודק שינויים לא-שמורים,
  // ‏**לא** תהליכים. worktree שנמחק מתחת ל-BE רץ מושך לו את הקרקע.
  it("skips a worktree that a live process sits in — and only because of that", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../wt", "-b", "m1", "main")
    const child = spawn("sleep", ["30"], { cwd: path.join(root, "wt"), stdio: "ignore" })
    try {
      // המתנה קצרה עד שה-cwd של הילד גלוי ב-/proc.
      execFileSync("sleep", ["0.5"])
      expect(run(repo, ["--base", "main"])).toContain("a live process sits inside")
      // בקרה שלילית: אותו worktree בדיוק, אותו רגע — רק בלי הבדיקה. אם הוא
      // נחסם גם כאן, הסיבה לא הייתה התהליך והבדיקה הראשונה חסרת-ערך.
      expect(run(repo, ["--base", "main", "--no-process-check"])).toContain(
        "would remove 1 worktree(s)",
      )
    } finally {
      child.kill()
    }
  })

  // ─── רגרסיה ───────────────────────────────────────────────────────────
  it("survives a stale entry whose directory was deleted by hand", () => {
    const repo = makeRepo()
    git(repo, "worktree", "add", "-q", "../gone", "-b", "m1", "main")
    git(repo, "worktree", "add", "-q", "../live", "-b", "m2", "main")
    rmSync(path.join(root, "gone"), { recursive: true, force: true })
    const out = run(repo, ["--base", "main"])
    // לפני התיקון: realpathSync זרק ENOENT וכל הריצה נפלה, כולל על ה-worktrees התקינים.
    expect(out).not.toContain("ENOENT")
    expect(out).toContain("path is gone")
    expect(out).toContain("would remove 1 worktree(s)")
  })

  it("two worktrees sharing a basename: --keep spares both, output disambiguates", () => {
    const repo = makeRepo()
    mkdirSync(path.join(repo, "sub"))
    git(repo, "worktree", "add", "-q", "sub/twin", "-b", "twinA", "main")
    git(repo, "worktree", "add", "-q", "../twin", "-b", "twinB", "main")
    const out = run(repo, ["--base", "main", "--keep", "twin"])
    // ההתאמה היא לפי basename ⇒ שניהם נשמרים. זו הבחירה הבטוחה, אבל היא חייבת
    // להיראות בפלט — אחרת שתי שורות זהות מציגות "אותו" worktree פעמיים.
    expect(out.match(/--keep/g)).toHaveLength(2)
    expect(out).toContain("sub/twin")
    expect(out).toContain("would remove 0")
  })
})
