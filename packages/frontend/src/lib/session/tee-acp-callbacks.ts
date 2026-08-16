/**
 * tee-acp-callbacks.ts — חלוקת update notifications בין ה-VM (primary) ל-observer
 * (LocalSessionView) כשהם חולקים לקוח ACP אחד.
 *
 * slice local-view-wiring C2: ה-VM קורא ל-createAcpClient עם callbacks משלו; עכשיו
 * הוא עוטף אותם ב-tee שמעביר את אותו update גם ל-view. הכללים (brief §4.2):
 *   - ה-VM **ראשון, לא עטוף** — מסלול הייצור שעובד; ה-observer אחריו.
 *   - ה-observer עטוף ב-try/catch — throw אצלו לא נוגע ב-VM.
 *   - **רק** onUpdate + onExtNotification — onRequestPermission/onCreateElicitation
 *     מחזירים ערך, שני עונים = תשובה כפולה (הם עוברים ב-spread, ב-זהות).
 */
import type { AcpClientCallbacks } from "@drive-coding/provider/client"

/** ה-callbacks שה-observer צורך. קריאה בלבד — מחזירי-ערך אינם כאן. */
export type ObserverCallbacks = Pick<AcpClientCallbacks, "onUpdate" | "onExtNotification">

/**
 * עוטף את ה-callbacks של ה-VM כך שגם ה-observer (ה-LocalSessionView) מקבל את אותו
 * update — primary ראשון, observer מבודד.
 */
export function teeAcpCallbacks(
  primary: AcpClientCallbacks,
  observer: ObserverCallbacks,
): AcpClientCallbacks {
  return {
    ...primary,
    onUpdate: (notification) => {
      primary.onUpdate(notification)
      try {
        observer.onUpdate?.(notification)
      } catch {
        // throw של ה-observer מבודד — לא נוגע ל-VM
      }
    },
    onExtNotification: (method, params) => {
      primary.onExtNotification?.(method, params)
      try {
        observer.onExtNotification?.(method, params)
      } catch {
        // throw של ה-observer מבודד — לא נוגע ל-VM
      }
    },
  }
}
