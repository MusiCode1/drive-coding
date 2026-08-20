// usage: node scripts/prune-worktrees.mjs [--base <ref>]... [--keep <name>]... [--apply] [--delete-branches] [--no-process-check]
//
// מסיר worktrees תחת .worktrees/ שכל העבודה שלהם כבר מוכלת ב-base.
// ‏**ברירת המחדל היא dry-run** — מדפיס תוכנית ולא נוגע בכלום. --apply מבצע.
//
//   --base <ref>        ref שמכיל את העבודה. ניתן לחזור. ברירת מחדל: dev
//   --keep <name>       שם worktree שלא ייגע בו. ניתן לחזור.
//   --apply             בצע בפועל (בלי זה: dry-run)
//   --delete-branches   מחק גם את הענף (git branch -d — מסרב לענף לא-מוזג)
//   --no-process-check  דלג על סריקת /proc (נדרש מחוץ ללינוקס)
//
// שלוש בדיקות-בטיחות לכל worktree, וכולן חייבות לעבור:
//   1. ה-ref מוכל ב-base כלשהו       (merge-base --is-ancestor)
//   2. העץ נקי                        (status --porcelain ריק)
//   3. אין תהליך שה-cwd שלו בפנים     (סריקת /proc)
//
// ⚠️ בדיקה 3 היא היחידה ש-`git worktree remove` **אינו** עושה: הוא בודק שינויים
// לא-שמורים, לא תהליכים. worktree שנמחק מתחת ל-BE רץ מושך לו את הקרקע בלי אזהרה
// — ה-FE (FE_STATIC_DIR) נעלם, וה-BE ממשיך להאזין ומגיש 404.

import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, realpathSync } from "node:fs"

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const many = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []))

const bases = many("--base").length > 0 ? many("--base") : ["dev"]
const keep = new Set(many("--keep"))
const apply = flag("--apply")
const deleteBranches = flag("--delete-branches")
const processCheck = !flag("--no-process-check")

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const gitOk = (...args) => {
  try {
    execFileSync("git", args, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

for (const base of bases) {
  if (!gitOk("rev-parse", "--verify", `${base}^{commit}`)) {
    console.error(`base not found: ${base}`)
    process.exit(1)
  }
}

/** קבוצת תיקיות שתהליך חי יושב בהן (או מתחתן). null = לא ניתן לקרוא /proc. */
function busyDirs() {
  const out = new Set()
  let entries
  try {
    entries = readdirSync("/proc")
  } catch {
    return null
  }
  for (const pid of entries) {
    if (!/^\d+$/.test(pid)) continue
    try {
      out.add(realpathSync(`/proc/${pid}/cwd`))
    } catch {
      // תהליך שמת בינתיים, או של משתמש אחר — אין הרשאה. לדלג.
    }
  }
  return out
}

/** git worktree list --porcelain → [{ path, ref, branch }] (בלי ה-bare וה-main). */
function worktrees() {
  const blocks = git("worktree", "list", "--porcelain").split("\n\n")
  const all = []
  for (const blk of blocks) {
    const wt = {}
    for (const line of blk.split("\n")) {
      if (line.startsWith("worktree ")) wt.path = line.slice(9)
      else if (line.startsWith("HEAD ")) wt.head = line.slice(5)
      else if (line.startsWith("branch ")) wt.branch = line.slice(7).replace("refs/heads/", "")
      else if (line === "bare") wt.bare = true
    }
    if (wt.path) all.push(wt)
  }
  // ה-main worktree הוא **הבלוק הראשון** (git-worktree(1)) — אין למחוק אותו לעולם.
  // ⚠️ בריפו bare (הסידור כאן: .bare + .worktrees/*) הבלוק הראשון הוא ה-bare,
  // ואז **אין** main כלל. הניסוח "הראשון שאינו bare" נראה שקול והוא לא: הוא
  // מוציא מהרשימה worktree אקראי — כאן זה היה debug-surface, שדווקא חייב הגנה
  // מסיבה אחרת לגמרי (תהליך חי). נתפס ב-dry-run.
  const main = all[0]?.bare ? null : all[0]
  return all
    .filter((w) => !w.bare && w !== main)
    .map((w) => ({ ...w, ref: w.branch ?? w.head, name: w.path.split("/").filter(Boolean).pop() }))
}

const busy = processCheck ? busyDirs() : new Set()
if (busy === null && apply) {
  console.error("cannot read /proc — the running-process check is unavailable.")
  console.error("re-run with --no-process-check only if you know no worktree is in use.")
  process.exit(1)
}

const here = realpathSync(process.cwd())
const plan = []
const skipped = []

for (const wt of worktrees()) {
  const real = realpathSync(wt.path)
  const skip = (why) => skipped.push({ name: wt.name, why })

  if (keep.has(wt.name)) skip("--keep")
  else if (wt.branch && bases.includes(wt.branch)) skip("is a base ref")
  else if (here === real || here.startsWith(`${real}/`)) skip("cwd is inside it")
  else if (!bases.some((b) => gitOk("merge-base", "--is-ancestor", wt.ref, b)))
    skip(`not contained in ${bases.join(" / ")}`)
  else if (git("-C", wt.path, "status", "--porcelain") !== "") skip("uncommitted changes")
  else if (busy !== null && [...busy].some((c) => c === real || c.startsWith(`${real}/`)))
    skip("a live process sits inside")
  else plan.push(wt)
}

for (const s of skipped) console.log(`  skip  ${s.name.padEnd(36)} ${s.why}`)
console.log(`\n${apply ? "removing" : "would remove"} ${plan.length} worktree(s):`)
for (const wt of plan) console.log(`  ${apply ? "✓" : "-"} ${wt.name.padEnd(36)} ${wt.ref}`)

if (!apply) {
  console.log("\ndry-run — nothing was touched. re-run with --apply to perform.")
  process.exit(0)
}

let failed = 0
for (const wt of plan) {
  try {
    git("worktree", "remove", wt.path)
  } catch (e) {
    failed++
    console.error(`  ✗ ${wt.name}: ${String(e.message).split("\n")[0]}`)
    continue
  }
  // git branch -d מסרב בעצמו לענף שאינו מוזג — לכן אין כאן בדיקה משלנו.
  if (deleteBranches && wt.branch && !gitOk("branch", "-d", wt.branch)) {
    console.log(`    (branch kept: ${wt.branch} — git refused, not merged into HEAD)`)
  }
}

git("worktree", "prune")
console.log(`\nremoved=${plan.length - failed} failed=${failed} · pruned`)
