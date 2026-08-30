import { normalizePublicBaseUrl } from "@drive-coding/core/config/public-base-url"

export function loopbackBaseUrl(): string {
  const port = process.env.PORT ?? "4000"
  const host = process.env.DRIVE_CODING_HOST ?? "127.0.0.1"
  return `http://${host}:${port}`
}

export function defaultPublicUrl(): string {
  return normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL ?? "") ?? loopbackBaseUrl()
}
