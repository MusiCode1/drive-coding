#!/usr/bin/env node
// packages/release/scripts/build.mjs
// Builds the release bundle:
//   1. Builds the frontend — package-manager-AGNOSTIC: runs the workspace `build`
//      script with the PM the *project* declares (packageManager field / lockfile),
//      so this works whoever invokes it (node/bun/pnpm, or a `prepack` under npm).
//   2. Copies frontend/build → release/frontend-dist/
//   3. Copies backend/plugins  → release/plugins/
//   4. Bundles the backend bin with `bun build` — this step is bun-SPECIFIC (it is a
//      bun-targeted bundle: `#!/usr/bin/env bun`, uses `Bun.*`). If we ever target
//      Deno etc., only this step changes.
//
// Run via: node scripts/build.mjs  (or triggered automatically by prepack/npm pack)

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { detect } from "package-manager-detector/detect"
import { runFilterArgs, runPm } from "../../../scripts/pm.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// scripts/ is inside packages/release/scripts — go up twice to reach monorepo root
const releaseDir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(__dirname, "../../..")

const frontendBuild = path.join(repoRoot, "packages", "frontend", "build")
const backendPlugins = path.join(repoRoot, "packages", "backend", "plugins")
const backendBinEntry = path.join(
  repoRoot,
  "packages",
  "backend",
  "src",
  "bin",
  "drive-coding.ts",
)

const releaseFrontendDist = path.join(releaseDir, "frontend-dist")
const releasePlugins = path.join(releaseDir, "plugins")
const releaseDist = path.join(releaseDir, "dist")
const releaseBinOut = path.join(releaseDist, "drive-coding.js")

// `bun` for the step-4 bundler (override via BUN_BIN). Step 4 is intentionally
// bun-specific (see header) — unlike step 1, which follows the project's declared PM.
const bunBin = process.env.BUN_BIN ?? "bun"

// Step 1: Build frontend with the project's declared package manager.
// `detect()` (package-manager-detector) reads the packageManager field + lockfile,
// so it returns the PM the repo is set up for — bun here — regardless of who invoked
// this script (a `prepack` under `npm publish` reports npm as the user-agent, but the
// build must still run under bun). Falls back to bun if detection somehow yields nothing.
const KNOWN_PM = ["bun", "pnpm", "npm", "yarn"]
const detected = (await detect())?.name
const pm = KNOWN_PM.includes(detected) ? detected : "bun"
console.log(`[build] Step 1: building frontend (pm: ${pm})…`)
const [feCmd, feArgs] = runFilterArgs("@drive-coding/frontend", "build", pm)
runPm(feCmd, feArgs, { cwd: repoRoot, stdio: "inherit" })

// Step 2: Copy frontend/build → release/frontend-dist
console.log("[build] Step 2: copying frontend-dist…")
rmSync(releaseFrontendDist, { recursive: true, force: true })
cpSync(frontendBuild, releaseFrontendDist, { recursive: true })

// Step 2b: strip DEV-only fixtures from the release copy (privacy + ~2MB bloat).
// MOCK_FIXTURES is gated behind import.meta.env.DEV (+page.svelte) → prod never fetches them.
const releaseFixtures = path.join(releaseFrontendDist, "fixtures")
if (existsSync(releaseFixtures)) {
  rmSync(releaseFixtures, { recursive: true, force: true })
  console.log("[build] Step 2b: stripped DEV fixtures from release frontend-dist")
}

// Step 3: Copy backend/plugins → release/plugins
console.log("[build] Step 3: copying plugins…")
rmSync(releasePlugins, { recursive: true, force: true })
cpSync(backendPlugins, releasePlugins, { recursive: true })

// Step 4: Bundle backend bin with bun build (core + provider-contract inline)
console.log("[build] Step 4: bundling with bun build…")
rmSync(releaseDist, { recursive: true, force: true })
mkdirSync(releaseDist, { recursive: true })

execFileSync(
  bunBin,
  [
    "build",
    backendBinEntry,
    "--target=bun",
    "--external",
    "pino",
    "--external",
    "pino-pretty",
    "--outfile",
    releaseBinOut,
  ],
  { stdio: "inherit" },
)

// Guard: the bundle must exist, and NO sourcemap may leak into dist/.
// bun 1.3.14 has a bug where `bun build --sourcemap --outfile <p>` ignores
// --outfile and writes to the ENTRY dir instead — so a stray --sourcemap would
// (a) leave dist/drive-coding.js missing, and (b) drop a .map next to the source.
// This assertion fails the build loudly so a sourcemap can NEVER ship to npm.
if (!existsSync(releaseBinOut)) {
  throw new Error(
    `[build] FATAL: ${releaseBinOut} was not produced. A --sourcemap flag may have ` +
      "misrouted the output to the entry dir (bun 1.3.14 ignores --outfile when --sourcemap is set). " +
      "Remove --sourcemap from the bun build args.",
  )
}
const mapLeak = readdirSync(releaseDist).filter((f) => f.endsWith(".map"))
if (mapLeak.length > 0) {
  throw new Error(
    `[build] FATAL: sourcemap(s) found in dist/ — these would ship to npm: ${mapLeak.join(", ")}. ` +
      "Do not pass --sourcemap to the bun build above (see comment).",
  )
}

console.log(`[build] Done. Bundle: ${releaseBinOut}`)
