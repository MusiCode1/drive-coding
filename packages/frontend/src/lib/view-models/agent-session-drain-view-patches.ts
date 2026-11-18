import type { SessionView } from "$lib/session/session-view"

export type DrainViewPatchesDeps = {
  view: () => SessionView | null
}

/**
 * הניקוז המקומי — קורא-ריק על view.patches (**לא** #consumeViewPatches): ב-local
 * ה-VM הוא הצרכן היחיד של bubbles (primary handler), והדרינה/סינכרון מ-state
 * של ה-view היו מכפילים בועות ומדרסים quota. lifecycle: dispose/close סוגרים
 * את ה-controller ⇒ read() נפתר done ⇒ הלולאה יוצאת. אין מונה-דור (§4.5 —
 * await read() תלוי אינו ניתן להפקעה מבחוץ).
 */
export async function drainViewPatches(d: DrainViewPatchesDeps, view: SessionView): Promise<void> {
  const reader = view.patches.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (d.view() !== view) break // זהות — view הוחלף/אופס
      void value // קורא-ריק: patches נצרכים כדי למנוע backpressure
    }
  } catch {
    // stream נסגר או בוטל — תקין
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* */
    }
  }
}
