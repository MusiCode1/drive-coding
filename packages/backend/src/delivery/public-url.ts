import { normalizePublicBaseUrl } from "@drive-coding/core/config/public-base-url"
import type { DriveCodingConfig } from "@drive-coding/core/config/schema"

export type UrlConfig = Pick<DriveCodingConfig, "port" | "host" | "publicBaseUrl">

export function loopbackBaseUrl(config: UrlConfig): string {
  const port = config.port ?? 4000
  const host = config.host ?? "127.0.0.1"
  return `http://${host}:${port}`
}

export function defaultPublicUrl(config: UrlConfig): string {
  return normalizePublicBaseUrl(config.publicBaseUrl ?? "") ?? loopbackBaseUrl(config)
}
