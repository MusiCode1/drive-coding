/**
 * session-routes.ts — pure route membership for live session scope (slice session-scope-nav S2).
 */

/** True iff pathname is inside the live session (§6 map). Query/hash are not part of pathname. */
export function isInSessionRoute(pathname: string): boolean {
  if (pathname === "/settings") return true
  if (pathname === "/usage") return true
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return true
  return false
}

/** Explicit leave targets — unknown `toPath` does not release session scope. */
export function isOutsideSessionRoute(pathname: string): boolean {
  return (
    pathname === "" ||
    pathname === "/" ||
    pathname === "/bt-test" ||
    pathname === "/wake-word-test" ||
    pathname === "/playlist-nav-chrome-test"
  )
}
