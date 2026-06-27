// Gate: true only when the binary is compiled with --define __IS_BINARY__=true.
// In dev/test, __IS_BINARY__ is not defined by Bun, so typeof returns "undefined".
//
// The declare here tells TypeScript this may exist as a global (injected by bun build --define).
// Using `declare const` (not `declare global`) — backend tsconfig uses "types":["bun"] which
// already includes Bun globals; a module-level declare const is sufficient.
declare const __IS_BINARY__: boolean | undefined

export function isBinary(): boolean {
  return typeof __IS_BINARY__ !== "undefined" && __IS_BINARY__ === true
}
