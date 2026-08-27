#!/usr/bin/env node

// packages/release/scripts/build.mjs
// Builds the release bundle:
//   1. Builds the frontend — package-manager-AGNOSTIC: runs the workspace `build`
//      script with the PM the *project* declares (packageManager field / lockfile),
//      so this works whoever invokes it (node/bun/pnpm, or a `prepack` under npm).
//   2. Copies frontend/build → release/frontend-dist/
//   3. Copies backend/plugins  → release/plugins/
//   4. Bundles the backend bin with `bun build --target=node` — bun is only the
//      *bundler* here; the OUTPUT is a Node-runnable bundle (`#!/usr/bin/env node`),
//      so the published package works under BOTH `npx` (Node) and `bunx` (Bun). The
//      runtime is already Node-compatible (@hono/node-server, ws, node:* builtins);
//      the only `Bun.*` call (Bun.file) lives behind isBinary() — dead code in this
//      bundle, live only in the separate `bun build --compile` binary (build-binary.mjs).
//
// Run via: node scripts/build.mjs  (or triggered automatically by prepack/npm pack)

import { execFileSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { detect } from "package-manager-detector/detect"
import { runFilterArgs, runPm } from "../../../scripts/pm.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// scripts/ is inside packages/release/scripts — go up twice to reach monorepo root
const releaseDir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(__dirname, "../../..")

const frontendBuild = path.join(repoRoot, "packages", "frontend", "build")
const backendPlugins = path.join(repoRoot, "packages", "backend", "plugins")
const backendBinEntry = path.join(repoRoot, "packages", "backend", "src", "bin", "drive-coding.ts")

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
// FE_ENV is pinned to "prod" and NOT inherited. Measured 2026-08-27: the shell that
// ran this build had FE_ENV=preview (it belongs to the drive-coding-dev systemd unit),
// so the published 0.34.0 shipped `<title>Preview · Drive Coding</title>`, source maps,
// and the __dc playback debug panel ENABLED (vite.config.ts: DC_ENABLED = FE_ENV !== "prod").
// A published package must never depend on the publisher's environment.
const [feCmd, feArgs] = runFilterArgs("@drive-coding/frontend", "build", pm)
runPm(feCmd, feArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, FE_ENV: "prod", FE_SOURCEMAP: "false", FE_TITLE: "", FE_PREVIEW_LABEL: "" },
})

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

// Step 2c: assert the release copy is a PROD build. These two checks are the gate for
// the FE_ENV leak above — both were RED on the 0.34.0 artifact.
const indexHtml = readFileSync(path.join(releaseFrontendDist, "index.html"), "utf8")
const titleMatch = indexHtml.match(/<title>([^<]*)<\/title>/)
if (titleMatch?.[1]?.trim() !== "Drive Coding") {
  throw new Error(
    `[build] FE_ENV leak: expected <title>Drive Coding</title>, got <title>${titleMatch?.[1] ?? "?"}</title>`,
  )
}
const debugHits = []
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full)
    else if (/\.(js|html|css)$/.test(e.name) && readFileSync(full, "utf8").includes("awaiting TTS"))
      debugHits.push(path.relative(releaseFrontendDist, full))
  }
}
walk(releaseFrontendDist)
if (debugHits.length > 0) {
  throw new Error(`[build] debug surface leaked into frontend-dist (${debugHits.length}): ${debugHits.join(", ")}`)
}
console.log("[build] Step 2c: prod assertions OK — clean title, no debug surface")

// Step 3: Copy backend/plugins → release/plugins
console.log("[build] Step 3: copying plugins…")
rmSync(releasePlugins, { recursive: true, force: true })
cpSync(backendPlugins, releasePlugins, { recursive: true })

// Step 4: Bundle backend bin with `bun build --target=node` (core + provider-contract inline).
// --target=node → a Node-runnable bundle so `npx drive-coding` works, not only `bunx`.
console.log("[build] Step 4: bundling with bun build (--target=node)…")
rmSync(releaseDist, { recursive: true, force: true })
mkdirSync(releaseDist, { recursive: true })

execFileSync(
  bunBin,
  [
    "build",
    backendBinEntry,
    "--target=node",
    "--external",
    "pino",
    "--external",
    "pino-pretty",
    "--outfile",
    releaseBinOut,
  ],
  { stdio: "inherit" },
)

// Step 4b: rewrite the shebang to node. bun preserves the ENTRY file's source
// shebang (`#!/usr/bin/env bun` — correct for running raw TS in dev), but the
// published bundle must launch under Node so `npx drive-coding` doesn't require
// bun on the user's PATH. Only the first line is touched; the harmless `// @bun`
// pragma on line 2 is a plain comment under Node.
const bundleText = readFileSync(releaseBinOut, "utf8")
if (!bundleText.startsWith("#!/usr/bin/env bun\n")) {
  throw new Error(
    `[build] FATAL: expected bundle to start with '#!/usr/bin/env bun' shebang to rewrite, ` +
      `got: ${JSON.stringify(bundleText.slice(0, 40))}. bun's shebang behaviour may have changed.`,
  )
}
writeFileSync(releaseBinOut, bundleText.replace("#!/usr/bin/env bun\n", "#!/usr/bin/env node\n"))
console.log("[build] Step 4b: rewrote shebang → #!/usr/bin/env node")

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
