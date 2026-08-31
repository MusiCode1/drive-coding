/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
/**
 * Unified service worker:
 *  1) Offline fallback — precache ONLY /offline.html; intercept failed navigations.
 *  2) OS notifications — notificationclick focuses/opens /chat.
 * Do NOT cache app shell, assets, API, or logos.
 */
import { version } from "$service-worker"

const sw = self as unknown as ServiceWorkerGlobalScope
const CACHE = `offline-${version}`
const OFFLINE_URL = "/offline.html"

sw.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))),
	)
	sw.skipWaiting()
})

sw.addEventListener("activate", (event) => {
	// Only offline-* — not every cache in the origin (fix vs old feat/offline-page)
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((k) => k.startsWith("offline-") && k !== CACHE).map((k) => caches.delete(k))),
			)
			.then(() => sw.clients.claim()),
	)
})

sw.addEventListener("fetch", (event) => {
	const { request } = event
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

sw.addEventListener("notificationclick", (event) => {
	const url = (event.notification.data as { url?: string } | null)?.url ?? "/chat"
	event.notification.close()
	event.waitUntil(
		(async () => {
			const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true })
			for (const client of windows) {
				if ("focus" in client) {
					await client.focus()
					return
				}
			}
			await sw.clients.openWindow(url)
		})(),
	)
})
