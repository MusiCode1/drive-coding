/**
 * permission.ts — טיפוסי permission ומיפוי טהור (slice-permission-ui-client-shell, Commit 0).
 *
 * טיפוסים נגזרים ישירות מ-`Client["requestPermission"]` (ה-SDK) — כך ש-shape
 * שינוי ב-SDK מתגלה כשגיאת typecheck כאן, לא כ-runtime mismatch.
 *
 * client shell בלבד: אין כאן חיבור חי ל-ACP (`onRequestPermission` לא מועבר
 * ל-`createAcpClient` בסלייס הזה). ראה `docs/plans/slice-permission-ui-client-shell.md`.
 *
 * חוקים:
 *   - להשתמש ב-`option.name`; אין `option.label`.
 *   - לא למיין options.
 *   - לא להמציא option שלא הגיע מה-agent.
 *   - אין טקסט UI בקובץ הזה (הכל i18n, בשכבת ה-component).
 */

import type { Client } from "@agentclientprotocol/sdk"

export type PermissionParams = Parameters<Client["requestPermission"]>[0]
export type PermissionResponse = Awaited<ReturnType<Client["requestPermission"]>>

export type PermissionRequestState = {
  id: string
  raw: PermissionParams
  options: PermissionOptionView[]
  status: "pending" | "resolved" | "cancelled"
  selectedOptionId?: string
}

export type PermissionOptionView = {
  optionId: string
  name: string
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string
}

export function permissionSelected(optionId: string): PermissionResponse {
  return { outcome: { outcome: "selected", optionId } }
}

export function permissionCancelled(): PermissionResponse {
  return { outcome: { outcome: "cancelled" } }
}

export function toPermissionOptionViews(params: PermissionParams): PermissionOptionView[] {
  return params.options.map((option) => ({
    optionId: option.optionId,
    name: option.name,
    kind: option.kind,
  }))
}
