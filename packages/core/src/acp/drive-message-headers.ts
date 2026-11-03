/**
 * drive-message-headers.ts — header names the FE sends and the backend reads.
 *
 * They live in core because both sides must agree on the exact string, and two literals
 * in two packages is a drift that fails **silently**: the backend would simply stop
 * seeing the FE and label every message it sends as coming from the API.
 *
 * 🛑 None of these are authenticated. They say what a caller claims to be. See
 * `CLIENT_KIND_HEADER` in `backend/agent-identity.ts` for why a token would not help.
 */

/** `ui` means "a human typed this in the web app". Absent ⇒ treated as an API caller. */
export const CLIENT_KIND_HEADER = "X-Drive-Coding-Client"

/** Free-text origin an API caller declares about itself. Capped by the backend. */
export const CALLER_NAME_HEADER = "X-Drive-Coding-Caller"

/** Open set (`agent`, `tool`, …) — an unknown value gets a generic label, not an error. */
export const CALLER_KIND_HEADER = "X-Drive-Coding-Caller-Kind"

export const CLIENT_KIND_UI = "ui"
