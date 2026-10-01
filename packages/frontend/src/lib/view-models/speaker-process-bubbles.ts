import { splitIntoSentences } from "@drive-coding/core/voice/sentence-boundary"
import {
  type SpeakableLabels,
  splitStreamable,
  toSpeakable,
} from "@drive-coding/core/voice/speakable"
import type { Bubble } from "$lib/types/bubble"
import type { SessionTurnState } from "./speaker-lifecycle"
import type { TranscriptScope } from "./transcript-scope.svelte"

const MIN_CHARS = 20
const MAX_CHARS = 200

export type BubbleState = {
  processedSegments: number
  buffer: string
  speakPending: string
}

/** Consumes new transcript chunks while preserving the existing sentence and tail rules. */
export function processSpeakerBubbles({
  owner,
  bubbles,
  enabled,
  isLoadingHistory,
  speakThoughts,
  turnState,
  states,
  labels,
  enqueue,
  pump,
}: {
  owner: TranscriptScope
  bubbles: Bubble[]
  enabled: boolean
  isLoadingHistory: boolean
  speakThoughts: boolean
  turnState: SessionTurnState
  states: Map<string, BubbleState>
  labels: () => SpeakableLabels
  enqueue: (
    owner: TranscriptScope,
    kind: "message" | "thought",
    messageId: string | null,
    text: string,
    bubbleId: string,
  ) => void
  pump: () => void
}): void {
  // Slice 4: בזמן ש-loadSession() משחזר היסטוריה, מסמן בועות כמעובדות
  // ללא הכנסת TTS jobs לתור. ה-effect רץ מחדש ברגע שה-isLoadingHistory → false,
  // ובאותה נקודה מקטעים חיים חדשים חוזרים לזרום TTS רגיל.
  if (isLoadingHistory) {
    for (const bubble of bubbles) {
      if (bubble.kind !== "message" && bubble.kind !== "thought") continue
      let state = states.get(bubble.id)
      if (state === undefined) {
        state = { processedSegments: 0, buffer: "", speakPending: "" }
        states.set(bubble.id, state)
      }
      state.processedSegments = bubble.segments.length
      state.buffer = ""
      // ⚠️ **גם `speakPending`.** הוא חדש, וכל אתר שמנקה `buffer` בלבד
      // משאיר טקסט מעובד שיֵאמר בתור הבא. ההערות בענפים האלה כבר הצהירו
      // את הכוונה — הקוד פשוט הפסיק לקיים אותה.
      state.speakPending = ""
    }
    return
  }

  for (const bubble of bubbles) {
    if (bubble.kind !== "message" && bubble.kind !== "thought") continue

    // redesign-3 / slice 9a: הקראת מחשבות כבויה → סמן מעובד ודלג (בלי TTS job).
    // סימון processedSegments מבטיח שהדלקה מחדש לא תשגר תוכן ישן.
    const segArr = bubble.segments
    let state = states.get(bubble.id)
    if (state === undefined) {
      state = { processedSegments: 0, buffer: "", speakPending: "" }
      states.set(bubble.id, state)
    }
    if (bubble.kind === "thought" && !speakThoughts) {
      state.processedSegments = segArr.length
      state.buffer = ""
      state.speakPending = "" // ר' ההערה למעלה
      continue
    }

    if (state.processedSegments >= segArr.length) continue

    const newChunks = segArr
      .slice(state.processedSegments)
      .map((s) => s.text)
      .join("")
    state.processedSegments = segArr.length

    if (!enabled) {
      // מושלך — כשמופעל שוב לאחר מכן לא רוצים לשגר תוכן ישן.
      state.buffer = ""
      state.speakPending = ""
      continue
    }

    // ─── slice tts-speakable-text ───
    // ⚠️ **שני חוצצים, וזה העיקר.** `buffer` נשאר **גולמי לנצח**; טקסט
    // מעובד לעולם לא חוזר אליו. `speakPending` מחזיק טקסט שכבר עובר
    // ומחכה להשלים משפט.
    //
    // 🔴 גרסה קודמת החזירה טקסט מעובד לחוצץ ועיבדה אותו שוב — וכל סיבוב
    // שבר מבנה במקום אחר: ה-`trim` אכל את הרווח שלפני ה-chunk הבא
    // (מילים נדבקו), והשרשור איבד את השורה-החדשה שלפני הגדר הבאה (הקוד
    // דלף להקראה). כאן כל קטע-גולמי מעובד **בדיוק פעם אחת**.
    state.buffer += newChunks
    const { ready, held } = splitStreamable(state.buffer)
    state.buffer = held
    if (ready.length > 0) {
      state.speakPending += toSpeakable(ready, labels(), { stream: true })
    }
    const { sentences, remaining } = splitIntoSentences(state.speakPending, {
      minChars: MIN_CHARS,
      maxChars: MAX_CHARS,
    })
    // ⚠️ **אין כאן עיכוב.** גרסה קודמת החזיקה מקטע קצר-מהרצפה לסיבוב הבא
    // (כדי ש-Gemini לא יקבל פרגמנט בודד) — וזה עיכב **בדיוק את הזנב**,
    // שהוא הקצר ביותר. התסמין: "שומעים את ההודעה, לא את סופה". מדוד.
    // ⇒ עדיף פרגמנט שאולי לא ייאמר מאשר זנב שנעלם.
    state.speakPending = remaining

    for (const sentence of sentences) {
      enqueue(owner, bubble.kind, bubble.messageId, sentence, bubble.id)
    }

    // ─── slice tts-tail-after-idle ───
    // ⚠️ **אחרי לולאת המשפטים, לא לפניה.** ‏`OrderAllocator` מקצה
    // `segmentIndex` עולה לפי סדר הקריאה — ולכן פליטת הזנב לפני הלולאה
    // נתנה לו מפתח **נמוך** מהמשפטים שקדמו לו, והפלייליסט השמיע אותו
    // **ראשון**. תיקון ה"סוף לא נשמע" הפך ל"סוף נשמע ראשון". נתפס
    // ב-code review, בדיוק במקרה שבשבילו נכתב.
    // 🔴 **התור כבר הסתיים? אין מי שיפלוש אחרינו — לפלוש כאן.**
    //
    // `justFinished` יורה **פעם אחת בלבד** (מעבר `!== idle` → `idle`).
    // ב-HTTP הפריים `state_update: idle` והצ'אנק האחרון יכולים להגיע
    // באותה מנה, וה-flush רץ ב-`$effect` נפרד מהזרימה. אם הוא מקדים,
    // הזנב שמגיע אחריו נתקע לנצח. זה #47.
    //
    // ⚠️ הסרתי את זה פעם אחת בחשד שגוי (חשבתי שהוא מרוקן חוצץ בין
    // הודעות) — והריוויו הראה שההסרה **החזירה** את הבאג. השורש היה
    // במקום אחר לגמרי (בדיקת ה-`[`). מוחזר.
    if (turnState === "idle") {
      const finalTail = (
        state.speakPending + toSpeakable(state.buffer, labels(), { stream: true })
      ).trim()
      state.buffer = ""
      state.speakPending = ""
      if (finalTail.length > 0) {
        enqueue(owner, bubble.kind, bubble.messageId, finalTail, bubble.id)
      }
    }
  }
  pump()
}
