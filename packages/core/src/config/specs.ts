/**
 * specs.ts — single source of truth for ENV ↔ flag ↔ config leaf mapping.
 *
 * CONFIG_SPECS declares every in-scope leaf of DriveCodingConfig (excluding
 * cliSpecs and https). Derivation sites in load-config.ts loop over this table.
 */

import { normalizePublicBaseUrl } from "./public-base-url.js"
import type { DriveCodingConfig } from "./schema.js"

/** Roots deliberately excluded — see brief §2. */
type OutOfScopeRoot = "cliSpecs" | "https"
type InScopeConfig = Omit<DriveCodingConfig, OutOfScopeRoot>

/** Dotted leaf keys of the schema. Arrays are leaves; objects recurse one level. */
type LeafKeyOf<T> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends readonly unknown[]
    ? K
    : NonNullable<T[K]> extends object
      ? `${K}.${keyof NonNullable<T[K]> & string}`
      : K
}[keyof T & string]

export type ConfigLeafKey = LeafKeyOf<InScopeConfig>

export type ConfigSpec = {
  /** dotted path into DriveCodingConfig */
  key: ConfigLeafKey
  env: string
  /** optional — leaves without a CLI flag */
  flag?: string
  /** env-string → config value. undefined ⇒ leaf not contributed by the layer. */
  parse?: (raw: string) => unknown
  /**
   * config value → env-string. Default: identity on string.
   * `unknown` not `never`: derivation loop passes getLeaf(...) which is unknown.
   */
  serialize?: (value: unknown) => string
  /**
   * Product default when no layer defines the leaf.
   * Applied in resolveConfig. The only place a configurable default may be written.
   */
  default?: unknown
}

/** Keys that have a product default on CONFIG_SPECS. */
export type ConfigDefaultKey = "port" | "host" | "rssBudgetMb" | "httpOwnerTtlMs" | "opencodeBin"

export type ConfigDefaults = {
  port: number
  host: string
  rssBudgetMb: number
  httpOwnerTtlMs: number
  opencodeBin: string
}

/** Read a product default. Throws if the key has none — that is a catalog bug. */
export function configDefault<K extends ConfigDefaultKey>(key: K): ConfigDefaults[K] {
  const spec: ConfigSpec | undefined = CONFIG_SPECS.find((s) => s.key === key)
  if (spec?.default === undefined) {
    throw new Error(`CONFIG_SPECS has no default for ${key}`)
  }
  return spec.default as ConfigDefaults[K]
}

export const CONFIG_SPECS = [
  {
    key: "port",
    env: "PORT",
    flag: "port",
    parse: (raw: string) => {
      const n = Number(raw)
      return Number.isNaN(n) ? undefined : n
    },
    serialize: (v: unknown) => String(v),
    default: 4000,
  },
  { key: "host", env: "DRIVE_CODING_HOST", flag: "host", default: "127.0.0.1" },
  {
    key: "corsOrigins",
    env: "CORS_ORIGINS",
    flag: "cors-origins",
    parse: (raw: string) =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    serialize: (v: unknown) => (v as readonly string[]).join(","),
  },
  { key: "feStaticDir", env: "FE_STATIC_DIR", flag: "fe-static-dir" },
  {
    key: "publicBaseUrl",
    env: "PUBLIC_BASE_URL",
    flag: "public-base-url",
    parse: (raw: string) => normalizePublicBaseUrl(raw),
  },
  { key: "opencodeBin", env: "OPENCODE_BIN", flag: "opencode-bin", default: "opencode" },
  {
    key: "wireRecord",
    env: "WIRE_RECORD",
    parse: (raw: string) => raw === "1",
    serialize: (v: unknown) => (v ? "1" : "0"),
  },
  {
    key: "rssBudgetMb",
    env: "RSS_BUDGET_MB",
    parse: (raw: string) => {
      const n = Number(raw)
      return Number.isNaN(n) ? undefined : n
    },
    serialize: (v: unknown) => String(v),
    default: 1500,
  },
  {
    key: "httpOwnerTtlMs",
    env: "HTTP_OWNER_TTL_MS",
    parse: (raw: string) => {
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0) return undefined
      return n
    },
    serialize: (v: unknown) => String(v),
    default: 600_000,
  },
  { key: "fsBrowseBase", env: "FS_BROWSE_ALLOWED_BASE" },
  { key: "log.level", env: "LOG_LEVEL", flag: "log-level" },
  { key: "log.ns", env: "LOG_NS" },
  {
    key: "log.format",
    env: "LOG_FORMAT",
    parse: (raw: string) =>
      raw === "pretty" || raw === "json" || raw === "both" ? raw : undefined,
  },
] as const satisfies ReadonlyArray<ConfigSpec>

/** Compile-time: every in-scope schema leaf must appear in CONFIG_SPECS. */
export type AssertCovered<Missing extends never> = Missing
type _ConfigSpecCoverage = AssertCovered<
  Exclude<ConfigLeafKey, (typeof CONFIG_SPECS)[number]["key"]>
>

export function getLeaf(cfg: Partial<DriveCodingConfig>, key: ConfigLeafKey): unknown {
  const [rootKey, nestedKey] = key.split(".") as [string, string | undefined]
  const root = (cfg as Record<string, unknown>)[rootKey]
  if (nestedKey === undefined) {
    return root
  }
  return (root as Record<string, unknown> | undefined)?.[nestedKey]
}

export function setLeaf(cfg: Record<string, unknown>, key: ConfigLeafKey, value: unknown): void {
  const [rootKey, nestedKey] = key.split(".") as [string, string | undefined]
  if (nestedKey === undefined) {
    cfg[rootKey] = value
    return
  }
  const existing = cfg[rootKey]
  const rootObj =
    existing !== undefined &&
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}
  rootObj[nestedKey] = value
  cfg[rootKey] = rootObj
}
