// usage: node scripts/bump-version.mjs <patch|minor|major> [pkg...]
//   pkg = שם תיקייה תחת packages/ שנגעה במיזוג (backend|core|frontend). אפשר כמה. release לא נמסר (מסונכרן ל-root).
import { readFileSync, writeFileSync } from "node:fs"

const level = process.argv[2]
const pkgs = process.argv.slice(3)

if (!["patch", "minor", "major"].includes(level)) {
  console.error("usage: bump-version.mjs <patch|minor|major> [pkg...]")
  process.exit(1)
}

const bump = (v) => {
  const [maj, min, pat] = v.split(".").map(Number)
  return level === "major"
    ? `${maj + 1}.0.0`
    : level === "minor"
      ? `${maj}.${min + 1}.0`
      : `${maj}.${min}.${pat + 1}`
}

const edit = (url, fn) => {
  const o = JSON.parse(readFileSync(url, "utf8"))
  fn(o)
  writeFileSync(url, JSON.stringify(o, null, 2) + "\n")
}

// 1) root = המספר הראשי
let rootNext
edit(new URL("../package.json", import.meta.url), (o) => {
  rootNext = o.version = bump(o.version)
})

// 2) packages/release = זהה ל-root תמיד
edit(new URL("../packages/release/package.json", import.meta.url), (o) => {
  o.version = rootNext
})

// 3) כל חבילה שנגעה — מונה עצמאי, עולה ב-level
for (const name of pkgs) {
  if (name === "release") continue // כבר מסונכרן ל-root
  edit(new URL(`../packages/${name}/package.json`, import.meta.url), (o) => {
    o.version = bump(o.version)
  })
}

console.log(
  `root+release → ${rootNext}${pkgs.length ? ` | bumped: ${pkgs.filter((p) => p !== "release").join(", ")}` : ""}`,
)
