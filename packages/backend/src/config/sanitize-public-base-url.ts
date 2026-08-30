import { normalizePublicBaseUrl } from "@drive-coding/core/config/public-base-url"
import type { DriveCodingConfig } from "@drive-coding/core/config/schema"

/** Choke point: normalize or drop invalid publicBaseUrl from resolved config. */
export function sanitizePublicBaseUrl(config: DriveCodingConfig, warnings: string[]): void {
  if (config.publicBaseUrl === undefined) return
  const raw = config.publicBaseUrl
  const normalized = normalizePublicBaseUrl(raw)
  if (normalized !== undefined) {
    config.publicBaseUrl = normalized
    return
  }
  delete (config as Partial<DriveCodingConfig>).publicBaseUrl
  warnings.push(`[load-config] publicBaseUrl "${raw}" is not a valid origin — ignoring`)
}
