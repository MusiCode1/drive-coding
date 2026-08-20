// usage: node scripts/prune-worktrees.mjs [--base <ref>]... [--keep <name>]... [--apply] [--delete-branches] [--no-process-check]
//
// מסיר worktrees תחת .worktrees/ שכל העבודה שלהם כבר מוכלת ב-base.
// ‏**ברירת המחדל היא dry-run** — מדפיס תוכנית ולא נוגע בכלום. --apply מבצע.
//
//   --base <ref>        ref שמכיל את העבודה. ניתן לחזור. ברירת מחדל: dev
//   --keep <name>       שם worktree (basename) שלא ייגע בו. ניתן לחזור.
//                       ⚠️ התאמה לפי basename — שני worktrees בעלי אותו שם ייתפסו שניהם.
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
import { readdirSync, realpathSync } from "node:fs"
import path from "node:path"

/**
 * האם `child` הוא `parent` או תחתיו — **חוצה-פלטפורמות**.
 * ⚠️ `child.startsWith(`${parent}/`)` נראה שקול והוא לא: ב-Windows המפריד הוא
 * `\\`, ולכן ההשוואה לא מתקיימת לעולם ל-subdir. נמדד חי על Windows 10.0.26200:
 * הרצה מ-`<worktree>\sub` **לא** הדליקה את שומר ה-cwd, וה-worktree שעומדים בו
 * נכנס לרשימת-המחיקה. path.relative פותר את זה בלי לגעת במפרידים.
 */
const isInside = (parent, child) => {
  const rel = path.relative(parent, child)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

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
  const rest = all
    .filter((w) => !w.bare && w !== main)
    .map((w) => ({ ...w, ref: w.branch ?? w.head, name: w.path.split("/").filter(Boolean).pop() }))
  // שני worktrees יכולים לחלוק basename (למשל .worktrees/x מול dev/.worktrees/x).
  // ‏`--keep` תופס את שניהם — מכוון, זו הכיוון הבטוח — אבל שתי שורות זהות בפלט
  // הן שקר קטן. לשמות מתנגשים מציגים שני מקטעי-נתיב.
  // ⚠️ `label` לתצוגה בלבד. ‏`name` **חייב** להישאר ה-basename, כי הוא מה
  // ש-`--keep` משווה מולו; שינויו כאן היה הופך `--keep` לשקט-ולא-תופס.
  const seen = new Map()
  for (const w of rest) seen.set(w.name, (seen.get(w.name) ?? 0) + 1)
  for (const w of rest) {
    w.label = seen.get(w.name) > 1 ? w.path.split("/").filter(Boolean).slice(-2).join("/") : w.name
  }
  return rest
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
  const skip = (why) => skipped.push({ label: wt.label, why })

  // ⚠️ הרישום שורד `rm -rf` על התיקייה. זה מצב שכיח דווקא בריפו מוזנח — וכל
  // גישה למסלול שאיננו (realpath/status) זורקת ENOENT ומפילה את הריצה כולה.
  // `git worktree prune` בסוף --apply מנקה בדיוק את אלה.
  let real
  try {
    real = realpathSync(wt.path)
  } catch {
    skip("path is gone — prune will clear the entry")
    continue
  }

  if (keep.has(wt.name)) skip("--keep")
  else if (wt.branch && bases.includes(wt.branch)) skip("is a base ref")
  else if (isInside(real, here)) skip("cwd is inside it")
  else if (!bases.some((b) => gitOk("merge-base", "--is-ancestor", wt.ref, b)))
    skip(`not contained in ${bases.join(" / ")}`)
  else if (git("-C", wt.path, "status", "--porcelain") !== "") skip("uncommitted changes")
  else if (busy !== null && [...busy].some((c) => isInside(real, c)))
    skip("a live process sits inside")
  else plan.push(wt)
}

for (const s of skipped) console.log(`  skip  ${s.label.padEnd(36)} ${s.why}`)
console.log(`\n${apply ? "removing" : "would remove"} ${plan.length} worktree(s):`)
for (const wt of plan) console.log(`  ${apply ? "✓" : "-"} ${wt.label.padEnd(36)} ${wt.ref}`)

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
    console.error(`  ✗ ${wt.label}: ${String(e.message).split("\n")[0]}`)
    continue
  }
  // git branch -d מסרב בעצמו לענף שאינו מוזג — לכן אין כאן בדיקה משלנו.
  if (deleteBranches && wt.branch && !gitOk("branch", "-d", wt.branch)) {
    console.log(`    (branch kept: ${wt.branch} — git refused, not merged into HEAD)`)
  }
}

git("worktree", "prune")
console.log(`\nremoved=${plan.length - failed} failed=${failed} · pruned`)
