// See https://svelte.dev/docs/kit/types#app
declare global {
  namespace App {}

  /** Lucide icon library loaded via CDN (unpkg.com/lucide) */
  const lucide:
    | {
        createIcons: (opts?: Record<string, unknown>) => void
      }
    | undefined
}

export {}
