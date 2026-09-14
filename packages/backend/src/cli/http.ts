import { authedInit } from "./authed-init.js"

export { authedInit } from "./authed-init.js"

export async function readJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url} :: ${text.slice(0, 200)}`)
  return text ? (JSON.parse(text) as unknown) : {}
}

export function postJson(url: string, body: unknown): Promise<unknown> {
  return readJson(
    url,
    authedInit({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}
