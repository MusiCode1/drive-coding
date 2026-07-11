/**
 * vendor.d.ts — type declarations for dependencies without bundled .d.ts files.
 *
 * @musicode1/codex-acp is built with esbuild (no tsc --declaration).
 * This ambient module declaration satisfies TypeScript inside provider itself.
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
