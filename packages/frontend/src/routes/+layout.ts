// SPA-only — adapter-static + voice/audio APIs that don't exist in SSR.
// All navigation is client-side. Prevents SSR-time access to window/localStorage.

export const ssr = false
export const prerender = false
export const csr = true
