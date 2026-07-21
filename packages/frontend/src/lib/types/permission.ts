/**
 * permission.ts — טיפוסי view + מיפוי `PermissionParams.options` → view-model לרינדור.
 *
 * לוגיקה טהורה (ללא IO/DOM) — ר' docs/plans/slice-permission-ui-basic.md §4 Commit 1.
 * תשתית משותפת: הדפוס (params → view-model ממוין) מיועד לשכפול ע"י slice B (elicitation).
 */
import type { Client } from "@agentclientprotocol/sdk"

/** נגזר מ-SDK — לא shape מותאם; drift אפס. */
export type PermissionParams = Parameters<Client["requestPermission"]>[0]
export type PermissionResponse = Awaited<ReturnType<Client["requestPermission"]>>

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always"

export type PermissionOptionView = {
  optionId: string
  name: string
  kind: PermissionOptionKind
}

/** סדר-מיון: allow לפני reject; בתוך כל קבוצה, once לפני always. */
const KIND_ORDER: Record<PermissionOptionKind, number> = {
  allow_once: 0,
  allow_always: 1,
  reject_once: 2,
  reject_always: 3,
}

/**
 * מיפוי `params.options` (SDK `PermissionOption[]`) לרשימת כפתורים ממוינת לרינדור.
 * allow לפני reject; בתוך כל קבוצה — once לפני always. name/optionId/kind נשמרים כמו-שהם.
 */
export function mapPermissionOptions(params: PermissionParams): PermissionOptionView[] {
  return params.options
    .map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind as PermissionOptionKind }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

/**
 * ברירת-מחדל להדגשה בממשק: allow_once אם קיים; אחרת האפשרות הראשונה אחרי מיון.
 * מערך ריק → undefined.
 */
export function defaultPermissionOptionId(
  options: readonly PermissionOptionView[],
): string | undefined {
  return options.find((o) => o.kind === "allow_once")?.optionId ?? options[0]?.optionId
}
