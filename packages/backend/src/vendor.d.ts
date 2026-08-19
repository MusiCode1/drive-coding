/**
 * vendor.d.ts — type declarations for dependencies without bundled .d.ts files.
 *
 * @musicode1/codex-acp is built with esbuild (no tsc --declaration).
 * This ambient module declaration satisfies TypeScript when the backend build
 * transitively typechecks provider/src/connection/connect-codex-in-process.ts.
 */

declare module "@musicode1/codex-acp/lib" {
  import type { Readable, Writable } from "node:stream"

  export interface StartAcpServerOptions {
    codexPath?: string
    config?: unknown
    modelProvider?: string
    defaultAuthRequest?: unknown
  }

  export function startAcpServer(
    readable?: Readable,
    writable?: Writable,
    opts?: StartAcpServerOptions,
  ): void
}

/**
 * Minimal Bun globals declaration.
 * We avoid `types: ["bun"]` because bun-types declares `onmessage: never`
 * which pollutes globalThis and breaks @types/node's fetch types.
 */
declare namespace Bun {
  export function file(path: string | URL): import("node:buffer").Blob
}

declare var Bun: {
  file: typeof Bun.file
}
