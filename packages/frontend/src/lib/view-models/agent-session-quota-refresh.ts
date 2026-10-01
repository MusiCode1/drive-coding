import type { QuotaSnapshot } from "@drive-coding/provider/extensions"
import type { ExtClient } from "$lib/adapters/ext"

export type QuotaRefreshDeps = {
  sessionId: () => string | null
  mockQuota: () => QuotaSnapshot | null | undefined
  ext: () => ExtClient | null
  setQuota: (v: QuotaSnapshot | null) => void
  setQuotaLoading: (v: boolean) => void
}

/** מבצע את בקשת ה-quota בפועל, עם guard נגד כתיבה אחרי session switch/cleanup. */
export async function doRefreshQuota(d: QuotaRefreshDeps, sessionId: string): Promise<void> {
  try {
    // DEV-only mock harness — אותו תנאי כמו ה-mock loader הקיים (brief §4 Commit 4).
    const mockQuota = d.mockQuota()
    if (
      import.meta.env.MODE !== "production" &&
      sessionId.startsWith("mock:") &&
      mockQuota !== undefined
    ) {
      if (d.sessionId() === sessionId) d.setQuota(mockQuota)
      return
    }
    if (!d.ext()) {
      // אין ext פעיל (session מנותק/mock ללא mockState.quota) — unavailable, לא קריסה.
      if (d.sessionId() === sessionId) d.setQuota(null)
      return
    }
    const snapshot = await d.ext()!.getQuota(sessionId)
    if (d.sessionId() === sessionId) d.setQuota(snapshot)
  } catch {
    if (d.sessionId() === sessionId) d.setQuota(null)
  } finally {
    if (d.sessionId() === sessionId) d.setQuotaLoading(false)
  }
}
