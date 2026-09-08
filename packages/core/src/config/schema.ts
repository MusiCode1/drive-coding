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
  "publicBaseUrl?": "string",
  "opencodeBin?": "string",
  "wireRecord?": "boolean",
  "rssBudgetMb?": "number",
  "httpOwnerTtlMs?": "number",
  "fsBrowseBase?": "string",
  // Where the agent registry snapshot is written. Default: <stateDir>/agents/<port>.json.
  // Overridable so two backends can share a port across containers, and so a
  // test harness can keep its rows out of the real deployment's state dir.
  "agentsStoreFile?": "string",
  // Prompt timeouts, in milliseconds. Omitted — or "never" / "off" / 0 — means
  // no timeout, which is the default: a question the user has not answered yet
  // must not answer itself. Two flat leaves rather than a `timeouts` object,
  // because resolveConfig overrides object fields wholesale: setting one in env
  // would then silently erase the other from the config file.
  "elicitationTimeoutMs?": "number|'never'|'off'",
  "permissionTimeoutMs?": "number|'never'|'off'",
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
