import { normalizePublicBaseUrl } from "@drive-coding/core/config/public-base-url"
import type { DriveCodingConfig } from "@drive-coding/core/config/schema"
import { configDefault } from "@drive-coding/core/config/specs"

export type UrlConfig = Pick<DriveCodingConfig, "port" | "host" | "publicBaseUrl">

export function loopbackBaseUrl(config: UrlConfig): string {
  const port = config.port ?? configDefault("port")
  const host = config.host ?? configDefault("host")
  return `http://${host}:${port}`
}

export function defaultPublicUrl(config: UrlConfig): string {
  return normalizePublicBaseUrl(config.publicBaseUrl ?? "") ?? loopbackBaseUrl(config)
}
