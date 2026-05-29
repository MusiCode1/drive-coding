/**
 * be-url.ts — module-level Backend URL base for all FE → BE calls.
 *
 * NOT a Svelte context: adapters (e.g. sdks.ts) read this during their own
 * module init, which happens outside any component setup — `getSettings()`
 * would throw `lifecycle_outside_component` there. So we keep a plain module
 * variable, updated by the Settings VM on load + on user save.
 *
 * Empty base → uses location.origin (Vite proxy handles same-origin paths in
 * dev; in prod the BE is same-origin too unless overridden).
 * Set base   → absolute cross-origin base (needs CORS — see slice 15a).
 */

let _beUrl = ""

/**
 * Called by the Settings VM on construction (from persisted value) and on
 * every user save. Trailing slash is stripped for consistent concatenation.
 */
export function setBeUrlBase(value: string): void {
  _beUrl = value.replace(/\/$/, "")
}

/**
 * Build an absolute BE URL for `fetch()`.
 *
 * Empty base → `location.origin` + path (Vite proxy / same-origin).
 * Set base   → that base + path (cross-origin).
 * SSR (no `location`) → returns the path as-is (no fetch happens in SSR).
 */
export function beUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (_beUrl !== "") return `${_beUrl}${normalized}`
  if (typeof location === "undefined") return normalized
  return `${location.origin}${normalized}`
}

/**
 * Build a BE WebSocket URL. Same base logic, but http → ws and https → wss.
 */
export function beWsUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (_beUrl !== "") return _beUrl.replace(/^http/, "ws") + normalized
  if (typeof location === "undefined") return `ws://ssr-stub${normalized}`
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${location.host}${normalized}`
}

/** Testing only — reset internal state between tests. */
export function _resetForTests(): void {
  _beUrl = ""
}
