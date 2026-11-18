import type { PermissionParams, PermissionResponse } from "$lib/types/permission"

export type RequestPermissionDeps = {
  pendingPermission: () => {
    params: PermissionParams
    resolve: (r: PermissionResponse) => void
  } | null
  setPendingPermission: (
    v: { params: PermissionParams; resolve: (r: PermissionResponse) => void } | null,
  ) => void
  bypassActive: () => boolean
  resolvePendingPermission: (response: PermissionResponse) => void
}

/**
 * callback שמוזרק ל-createClientImpl.onRequestPermission (בשלושת ה-call-sites: attach,
 * loadSession, #warmReconnect). מוחזר Promise שנפתר כש-resolvePermission/cancelPermission
 * נקראים, או כש-#client מתאפס (כל נקודות ה-teardown — ר' #resolvePendingPermission).
 */
export function onRequestPermission(
  d: RequestPermissionDeps,
  params: PermissionParams,
): Promise<PermissionResponse> {
  return new Promise<PermissionResponse>((resolve) => {
    // pending יחיד — בקשה שנייה סוגרת את הקודמת כ-cancelled (החלטת המשתמשת, §4 Commit 2).
    if (d.pendingPermission()) {
      d.resolvePendingPermission({ outcome: { outcome: "cancelled" } })
    }
    // הגנה: bypass לא אמור לשלוח בקשת הרשאה כלל (הסוכן עוקף) — אך אם בכל זאת הגיעה
    // (race/CLI לא-סטנדרטי), auto-allow כדי לא לתקוע turn בלי UI רלוונטי.
    if (d.bypassActive()) {
      const byKind = (k: string) => params.options.find((o) => o.kind === k)
      const chosen = byKind("allow_once") ?? byKind("allow_always") ?? params.options[0]
      resolve(
        chosen
          ? { outcome: { outcome: "selected", optionId: chosen.optionId } }
          : { outcome: { outcome: "cancelled" } },
      )
      return
    }
    d.setPendingPermission({ params, resolve })
  })
}
