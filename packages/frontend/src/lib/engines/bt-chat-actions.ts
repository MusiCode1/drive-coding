/**
 * bt-chat-actions.ts — ‏מה השלט אמור לעשות בצ'אט. ‏**‏תיאור, ‏לא ביצוע.**
 *
 * ─── ‏למה המודול הזה קיים ───
 * ‏המיפוי נכתב במקור inline ‏בתוך `onMount` ‏של `/chat` (‏קומיט `6c2a4390`, ‏קוד ידני
 * ‏שנכתב לשימוש חי בנהיגה). ‏שם הוא **‏בלתי-בדיק**: ‏vitest רץ ב-`environment: "node"`
 * ‏ואי-אפשר לרנדר route. ‏חילוצו לכאן הוא הצעד המינימלי שנותן לו טסטים.
 *
 * ‏זו בדיוק אותה תבנית שהצילה את `pad-cells.ts`: ‏המיפוי הקודם ב-`BtPad` **‏נשבר
 * ‏בשטח** ‏בדיוק כי היה inline ‏ולא בר-בדיקה.
 *
 * ─── ‏מה נשמר מילה-במילה ───
 * ‏**‏המיפוי כפי שאומת חי** ‏ע"י המשתמש בנהיגה (`next` ‏טאפ: ‏הקליט, ‏עצר, ‏נשלח).
 * ‏אין כאן שינוי-התנהגות **‏פרט** ‏ל-`repeat: 2` — ‏ר' ‏למטה.
 */

import type { BtCommand } from "./bt-remote.js"

/**
 * ‏המרווח בין **‏תחילת** ‏הביפ הראשון לתחילת השני.
 * 🔴 **‏חייב להיות גדול מאורך ה-cue עצמו.** ‏`thinking`/`speaking` ‏הם
 * ‏`#playGlide(…, 300)` ‏ב-`cues.ts`: ‏הגיין מגיע ל-0 ‏ב-300ms ‏והצומת נעצר ב-350ms.
 * ‏מרווח קצר מזה ⇒ ‏הביפים **‏חופפים** ‏ונשמעים כצליל אחד מתנודד — ‏בדיוק הבעיה
 * ‏שהביפ-הכפול בא לפתור. ‏480 ⇒ 300 ‏צליל · **‏180 ‏שקט נשמע** · 300 ‏צליל.
 */
export const PROBE_CUE_GAP_MS = 480

export type BtChatAction =
  | { kind: "mic-toggle" }
  | { kind: "mic-cancel" }
  | { kind: "playback-stop" }
  /**
   * ‏**‏מכשיר-מדידה, ‏לא פיצ'ר.** ‏קיים כדי לענות על שאלה פתוחה: ‏האם ההחזקה
   * ‏נקלטת על קדימה/‏אחורה, ‏או שאנדרואיד חוטף אותה (‏פקודת-המשימה §0).
   * ‏`repeat: 2` ‏כי ביפ **‏יחיד** ‏זהה לצליל שהאפליקציה מנגנת מעצמה — ‏והנוהג
   * ‏לא יוכל לדעת אם שמע את השלט או את האפליקציה.
   */
  | { kind: "probe-cue"; cue: "thinking" | "speaking"; repeat: 2 }
  | { kind: "none" }

/**
 * 🔴 ‏האינווריאנטה שהמודול נועל: ‏**‏`gesture === "hold"` ‏לעולם אינו מחזיר פעולה.**
 * ‏החזקה מפיקה צליל בלבד. ‏זו ההבטחה היחידה שמצדיקה להשאיר את ההחזקות בקוד-מוצר
 * ‏שרץ בנהיגה — ‏החזקה שתפעיל `mic-toggle` ‏בטעות תתחיל הקלטה בלי שהנהג ידע.
 */
export function btChatAction(cmd: BtCommand): BtChatAction {
  if (cmd.gesture === "hold") {
    if (cmd.button === "next") return { kind: "probe-cue", cue: "thinking", repeat: 2 }
    if (cmd.button === "prev") return { kind: "probe-cue", cue: "speaking", repeat: 2 }
    return { kind: "none" } // ‏המרכז שותק — ‏ההחזקה עליו כבר נמדדה ב-27/07
  }
  if (cmd.button === "next") return { kind: "mic-toggle" }
  if (cmd.button === "prev") return { kind: "mic-cancel" }
  return { kind: "playback-stop" }
}
