/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Offline fallback service worker.
 *
 * Goal: when the device has no network and the user opens the app, show a
 * friendly offline page instead of the browser's "this site can't be reached".
 *
 * Strategy — deliberately minimal to avoid stale-app bugs:
 *   - Precache ONLY `/offline.html` (a self-contained static page).
 *   - Do NOT cache the app shell or assets, so a rebuilt frontend is never
 *     shadowed by a stale cached copy — every request still hits the network.
 *   - Intercept only failed *navigation* requests and answer them with the
 *     cached offline page.
 *
 * SvelteKit auto-registers this file (kit.serviceWorker.register defaults true).
 * Note: service workers only run on secure origins (https or localhost) — over
 * plain-http LAN access the browser will not register it.
 */
import { version } from "$service-worker"

// `self` is a ServiceWorkerGlobalScope here; cast avoids the DOM/worker lib clash.
const sw = self as unknown as ServiceWorkerGlobalScope

const CACHE = `offline-${version}`
const OFFLINE_URL = "/offline.html"

sw.addEventListener("install", (event) => {
  // `cache: "reload"` bypasses the HTTP cache so we precache the fresh page.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))),
  )
  // Activate this worker immediately instead of waiting for existing tabs.
  sw.skipWaiting()
})

sw.addEventListener("activate", (event) => {
  // Drop offline caches from previous versions, then take control of open pages.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  )
})

sw.addEventListener("fetch", (event) => {
  const { request } = event

  // Only page navigations can land on the browser's error page; leave every
  // other request (assets, API, WebSocket handshakes) untouched.
  if (request.method !== "GET" || request.mode !== "navigate") return

  event.respondWith(
    (async () => {
      try {
        return await fetch(request)
      } catch {
        const cache = await caches.open(CACHE)
        const cached = await cache.match(OFFLINE_URL)
        return cached ?? Response.error()
      }
    })(),
  )
})
