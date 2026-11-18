/**
 * secrets.ts — DriveCodingSecrets schema + single source of truth for secret mapping.
 *
 * SECRET_SPECS is the only place where secret key ↔ env ↔ flag names are declared.
 * All derivation sites (env layer, flag layer, envPatch) loop over this table.
 */

import { type } from "arktype"
import type { AssertCovered } from "./specs.js"

export const DriveCodingSecrets = type({
  "elevenLabsKey?": "string",
  "geminiKey?": "string",
})

export type DriveCodingSecrets = typeof DriveCodingSecrets.infer

/** Single source of truth — env/flag/key names must not be duplicated elsewhere. */
export const SECRET_SPECS = [
  { key: "elevenLabsKey", env: "ELEVENLABS_API_KEY", flag: "elevenlabs-key" },
  { key: "geminiKey", env: "GEMINI_API_KEY", flag: "gemini-key" },
] as const satisfies ReadonlyArray<{
  key: keyof DriveCodingSecrets
  env: string
  flag: string
}>

/** Compile-time: every schema key must appear in SECRET_SPECS. */
type _SecretSpecCoverage = AssertCovered<
  Exclude<keyof DriveCodingSecrets, (typeof SECRET_SPECS)[number]["key"]>
>
