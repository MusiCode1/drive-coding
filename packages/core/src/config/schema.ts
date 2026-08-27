/**
 * schema.ts — DriveCodingConfig ArkType schema.
 *
 * All fields are optional (Partial-friendly) — this config is built from
 * multiple layers and a field may be absent from any given layer.
 *
 * Validation is performed by resolveConfig after merging all layers.
 */

import { type } from "arktype"

export const DriveCodingConfig = type({
  "port?": "number",
  "host?": "string",
  "corsOrigins?": "string[]",
  "feStaticDir?": "string",
  "opencodeBin?": "string",
  "wireRecord?": "boolean",
  "fsBrowseBase?": "string",
  "log?": {
    "level?": "string",
    "ns?": "string",
    "format?": "'pretty'|'json'|'both'",
  },
  // https: boolean (enable with auto-cert) or {key, cert} (explicit paths).
  // Validation of the cert/key paths is deferred to slice-https-local.
  "https?": type("boolean").or({ key: "string", cert: "string" }),
  // cliSpecs: per-CLI override map. Per-entry validation stays in cli-config-file.ts.
  "cliSpecs?": "Record<string, unknown>",
})

export type DriveCodingConfig = typeof DriveCodingConfig.infer
