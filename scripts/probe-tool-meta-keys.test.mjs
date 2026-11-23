import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

const script = fileURLToPath(new URL("./probe-tool-meta-keys.mjs", import.meta.url))
const run = (dir) =>
  new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, fileURLToPath(new URL(dir, import.meta.url))],
      (error, stdout) => {
        if (error && typeof error.code !== "number") reject(error)
        else resolve({ status: error?.code ?? 0, stdout })
      },
    )
  })

it("reports only distinct tool metadata keys grouped by bridge and version", async () => {
  const result = await run("./__fixtures__/tool-meta-observed")
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual([
    { bridge: "fixture-bridge", version: "1.0.0", keys: ["stable", "stream"] },
  ])
})

it("fails with exit 2 when the directory has no usable recordings", async () => {
  const result = await run("./")
  expect(result.status).toBe(2)
  expect(result.stdout).toBe("")
})
