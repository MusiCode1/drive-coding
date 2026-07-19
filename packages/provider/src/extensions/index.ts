/**
 * extensions/index.ts — barrel.
 * Exported via @drive-coding/provider/extensions subpath.
 */

export { extMethods } from "./schema.js"
export type { ExtMethodName } from "./schema.js"
export type {
  ExtParams,
  ExtResult,
  GetQuotaResult,
  QuotaConsumption,
  QuotaPeriod,
  QuotaSnapshot,
  QuotaWindow,
} from "./types.js"
export { parseExtParams, parseExtResult } from "./types.js"
