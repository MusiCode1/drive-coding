// @ts-check
import { describe, expect, it } from "vitest"
import { detectPm, runAllArgs, runFilterArgs } from "./pm.mjs"

describe("detectPm", () => {
  it("bun UA → bun", () => expect(detectPm("bun/1.3.14 npm/? node/v24 linux x64")).toBe("bun"))
  it("pnpm UA → pnpm", () => expect(detectPm("pnpm/10.0.0 npm/? node/v22 linux x64")).toBe("pnpm"))
  it("npm UA → npm", () => expect(detectPm("npm/10.0.0 node/v22 linux x64")).toBe("npm"))
  it("yarn UA → yarn", () => expect(detectPm("yarn/4.0.0 npm/? node/v22 linux x64")).toBe("yarn"))
  it("empty UA → declared packageManager (this repo: bun), not a guess", () =>
    expect(detectPm("")).toBe("bun"))
})

describe("runAllArgs", () => {
  it("bun → filter '*'", () =>
    expect(runAllArgs("build", { pm: "bun" })).toEqual(["bun", ["run", "--filter", "*", "build"]]))
  it("pnpm seq → -r run", () =>
    expect(runAllArgs("build", { pm: "pnpm" })).toEqual(["pnpm", ["-r", "run", "build"]]))
  it("pnpm parallel → -r --parallel run", () =>
    expect(runAllArgs("dev", { parallel: true, pm: "pnpm" })).toEqual([
      "pnpm",
      ["-r", "--parallel", "run", "dev"],
    ]))
  it("npm → --workspaces --if-present", () =>
    expect(runAllArgs("build", { pm: "npm" })).toEqual([
      "npm",
      ["run", "build", "--workspaces", "--if-present"],
    ]))
})

describe("runFilterArgs", () => {
  it("bun", () =>
    expect(runFilterArgs("@drive-coding/frontend", "build", "bun")).toEqual([
      "bun",
      ["run", "--filter", "@drive-coding/frontend", "build"],
    ]))
  it("pnpm", () =>
    expect(runFilterArgs("@drive-coding/frontend", "build", "pnpm")).toEqual([
      "pnpm",
      ["--filter", "@drive-coding/frontend", "build"],
    ]))
  it("npm", () =>
    expect(runFilterArgs("@drive-coding/frontend", "build", "npm")).toEqual([
      "npm",
      ["run", "build", "--workspace", "@drive-coding/frontend"],
    ]))
})
