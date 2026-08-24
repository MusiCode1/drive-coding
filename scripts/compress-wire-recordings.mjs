// usage: node scripts/compress-wire-recordings.mjs [--dir <path>] [--apply] [--level <n>]
//                                          [--max-age-days <n>] [--max-total-mb <n>]
//                                          [--no-process-check] [--verbose]
//
// דוחס הקלטות wire (.jsonl) משוחררות ל-.jsonl.zst, מוחק קבצי-אפס משוחררים,
// ו**לעולם לא נוגע** בקובץ שתהליך חי מחזיק פתוח (זיהוי דרך /proc/*/fd).
// **ברירת המחדל היא dry-run** — מדפיס תוכנית ולא נוגע בכלום. --apply מבצע.
//
// ⚠️ שתי ריצות מקבילות (טיימר + ידנית) — אין flock. אין איבוד-נתונים (המקור
// שורד בכל הסתעפות), אבל rename/unlink עלולים לזרוק ENOENT אם שתי ריצות
// נוגעות באותו קובץ — לכן כל rename/unlink עטוף ב-try/catch.
//
// ⚠️ מגבלה: קובץ שפתוח ע"י תהליך של משתמש **אחר** לא ייראה ב-/proc (EACCES).
// התהליכים הרלוונטיים (ה-BE) הם של אותו משתמש.

import {
  createReadStream,
  createWriteStream,
  existsSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { constants, createZstdCompress, createZstdDecompress } from "node:zlib"

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined
}

const home = process.env.HOME || process.env.USERPROFILE || os.homedir()
const defaultDir = path.join(home, ".config", "drive-coding", "wire-recordings")

const dirArg = opt("--dir") ?? defaultDir
const apply = flag("--apply")
const levelArg = opt("--level")
const level = levelArg === undefined ? 12 : Number(levelArg)
const maxAgeDaysArg = opt("--max-age-days")
const maxAgeDays = maxAgeDaysArg === undefined ? undefined : Number(maxAgeDaysArg)
const maxTotalMbArg = opt("--max-total-mb")
const maxTotalMb = maxTotalMbArg === undefined ? undefined : Number(maxTotalMbArg)
const processCheck = !flag("--no-process-check")
const verbose = flag("--verbose")

function positiveInt(name, value) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    console.error(`--${name} must be a positive finite integer`)
    process.exit(1)
  }
}

function nonNegativeInt(name, value) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    console.error(`--${name} must be a non-negative finite integer`)
    process.exit(1)
  }
}

if (levelArg !== undefined) {
  if (!Number.isInteger(level) || level < 1 || level > 22) {
    console.error("--level must be an integer between 1 and 22")
    process.exit(1)
  }
}
if (maxAgeDaysArg !== undefined) nonNegativeInt("max-age-days", maxAgeDays)
if (maxTotalMbArg !== undefined) positiveInt("max-total-mb", maxTotalMb)

/** קבוצת הנתיבים (realpath) שתהליך כלשהו מחזיק עליהם fd פתוח. null = /proc לא קריא. */
function openFilePaths() {
  const out = new Set()
  let entries
  try {
    entries = readdirSync("/proc")
  } catch {
    return null
  }
  for (const pid of entries) {
    if (!/^\d+$/.test(pid)) continue
    let fds
    try {
      fds = readdirSync(`/proc/${pid}/fd`)
    } catch {
      // תהליך שמת בינתיים, או של משתמש אחר — אין הרשאה. לדלג.
      continue
    }
    for (const fd of fds) {
      try {
        const link = readlinkSync(`/proc/${pid}/fd/${fd}`)
        if (link.startsWith("/")) {
          out.add(realpathSync(link))
        }
      } catch {
        // pipe/socket/anon — לא קובץ רגיל
      }
    }
  }
  return out
}

/** דוחס src → dst בזרימה. זורק על כשל. */
async function compressStream(src, dst, compressLevel) {
  await pipeline(
    createReadStream(src),
    createZstdCompress({
      params: { [constants.ZSTD_c_compressionLevel]: compressLevel },
    }),
    createWriteStream(dst),
  )
}

/** פורש path בזרימה וסופר בתים. לאימות-שלמות. */
async function decompressedByteLength(filePath) {
  let bytes = 0
  await pipeline(
    createReadStream(filePath),
    createZstdDecompress(),
    new Writable({
      write(chunk, _enc, cb) {
        bytes += chunk.length
        cb()
      },
    }),
  )
  return bytes
}

function skipMsg(basename, reason) {
  console.log(`skip  ${basename}   ${reason}`)
}

/** אוסף קבצי .zst רגילים בתיקייה (עומק 1). */
function listZstFiles(dirReal) {
  const out = []
  for (const d of readdirSync(dirReal, { withFileTypes: true })) {
    if (d.isFile() && d.name.endsWith(".jsonl.zst")) {
      const full = path.join(dirReal, d.name)
      out.push({ name: d.name, path: full, stat: statSync(full) })
    }
  }
  return out
}

/** תקרות שימור על .zst קיימים — רץ לפני לולאת הדחיסה. */
function applyRetention(_dirReal, zstSnapshot, counters) {
  const toDelete = new Set()

  if (maxAgeDays !== undefined) {
    const cutoff = Date.now() - maxAgeDays * 86_400_000
    for (const f of zstSnapshot) {
      if (f.stat.mtimeMs < cutoff) toDelete.add(f.path)
    }
  }

  if (maxTotalMb !== undefined) {
    const cap = maxTotalMb * 1024 * 1024
    const remaining = [...zstSnapshot]
      .filter((f) => !toDelete.has(f.path))
      .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)
    let total = remaining.reduce((s, f) => s + f.stat.size, 0)
    while (total > cap && remaining.length > 0) {
      const oldest = remaining.shift()
      toDelete.add(oldest.path)
      total -= oldest.stat.size
    }
  }

  const count = toDelete.size
  if (count === 0) return

  if (!apply) {
    counters.wouldDeleteZst += count
    return
  }

  for (const p of toDelete) {
    try {
      unlinkSync(p)
      counters.zstDeleted++
    } catch {
      counters.failed++
    }
  }
}

let dirReal
try {
  dirReal = realpathSync(dirArg)
} catch {
  console.log(`dir not found: ${dirArg}`)
  process.exit(0)
}

const counters = {
  compressed: 0,
  failed: 0,
  emptyDeleted: 0,
  zstDeleted: 0,
  dupRemoved: 0,
  reclaimedBytes: 0,
  wouldCompress: 0,
  wouldDeleteEmpty: 0,
  wouldRemovePart: 0,
  wouldDeleteZst: 0,
  wouldRemoveDup: 0,
}

// שלב 1: נקה .part שרידיים (שם עם נקודה מובילה — בלתי-נראה ל-glob *.jsonl*)
for (const d of readdirSync(dirReal, { withFileTypes: true })) {
  if (d.isFile() && /^\..*\.jsonl\.zst\.part$/.test(d.name)) {
    if (apply) {
      try {
        unlinkSync(path.join(dirReal, d.name))
      } catch {
        counters.failed++
      }
    } else {
      counters.wouldRemovePart++
    }
  }
}

// שלב 2: סריקת /proc
const open = processCheck ? openFilePaths() : new Set()
if (open === null && apply) {
  console.error("cannot read /proc — the open-file check is unavailable.")
  console.error("re-run with --no-process-check only if you know nothing is recording.")
  process.exit(1)
}

// שלב 3: תקרות שימור — על ה-.zst שקיימים **עכשיו**, לפני הדחיסה
const zstSnapshot = listZstFiles(dirReal)
applyRetention(dirReal, zstSnapshot, counters)

// שלב 4: לולאת דחיסה / מחיקה
for (const d of readdirSync(dirReal, { withFileTypes: true })) {
  if (!d.name.endsWith(".jsonl")) continue

  const full = path.join(dirReal, d.name)
  const basename = d.name

  if (d.isSymbolicLink() || !d.isFile()) {
    skipMsg(basename, "not a regular file")
    continue
  }

  let real
  try {
    real = realpathSync(full)
  } catch {
    counters.failed++
    continue
  }

  // בדיקת "פתוח" **ראשונה** — לפני גודל 0
  if (processCheck && open?.has(real)) {
    skipMsg(basename, "open by a live process")
    continue
  }

  let size
  try {
    size = statSync(real).size
  } catch {
    counters.failed++
    continue
  }

  if (size === 0) {
    if (apply) {
      try {
        unlinkSync(real)
        counters.emptyDeleted++
      } catch {
        counters.failed++
      }
    } else {
      counters.wouldDeleteEmpty++
    }
    continue
  }

  const zstPath = `${real}.zst`
  if (existsSync(zstPath)) {
    try {
      const decompressedLen = await decompressedByteLength(zstPath)
      if (decompressedLen === size) {
        if (apply) {
          try {
            unlinkSync(real)
            counters.dupRemoved++
            counters.reclaimedBytes += size
            console.log(`removed duplicate  ${basename}`)
          } catch {
            counters.failed++
          }
        } else {
          counters.wouldRemoveDup++
        }
      } else {
        skipMsg(basename, ".zst already exists")
      }
    } catch {
      counters.failed++
    }
    continue
  }

  if (!apply) {
    counters.wouldCompress++
    if (verbose) console.log(`  would compress  ${basename}`)
    continue
  }

  const part = path.join(dirReal, `.${basename}.zst.part`)
  try {
    await compressStream(real, part, level)
    const origSize = statSync(real).size
    const decompressedLen = await decompressedByteLength(part)
    if (decompressedLen === origSize) {
      try {
        renameSync(part, zstPath)
        try {
          unlinkSync(real)
          counters.compressed++
          counters.reclaimedBytes += origSize
        } catch {
          counters.failed++
        }
      } catch {
        counters.failed++
      }
    } else {
      counters.failed++
    }
  } catch {
    counters.failed++
  } finally {
    if (existsSync(part)) {
      try {
        unlinkSync(part)
      } catch {
        // part יתום — לא מעלים failed; המקור שרד
      }
    }
  }
}

if (!apply) {
  if (counters.wouldRemovePart > 0) {
    console.log(`would remove ${counters.wouldRemovePart} stale .part file(s)`)
  }
  if (counters.wouldDeleteZst > 0) {
    console.log(`would delete ${counters.wouldDeleteZst} .zst file(s) over the retention cap`)
  }
  if (counters.wouldDeleteEmpty > 0) {
    console.log(`would delete ${counters.wouldDeleteEmpty} empty file(s)`)
  }
  if (counters.wouldRemoveDup > 0) {
    console.log(`would remove ${counters.wouldRemoveDup} already-compressed source(s)`)
  }
  if (counters.wouldCompress > 0) {
    console.log(`would compress ${counters.wouldCompress} file(s)`)
  }
  console.log("\ndry-run — nothing was touched. re-run with --apply to perform.")
  process.exit(0)
}

const reclaimedMb = (counters.reclaimedBytes / (1024 * 1024)).toFixed(2)
console.log(
  `compressed=${counters.compressed} failed=${counters.failed} · empty-deleted=${counters.emptyDeleted} · zst-deleted=${counters.zstDeleted} · dup-removed=${counters.dupRemoved} · reclaimed=${reclaimedMb}MB`,
)

if (counters.failed > 0) process.exit(1)
