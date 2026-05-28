# Bubble Model — Design Decision

> **תאריך**: 2026-05-28.
> **סטטוס**: ‎הצעה ‎לפני slice 2. ‎יש לאשר ‎עם ‎ה-planner ‎לפני ‎יישום ‎ב-slice 2.
> **מקור**: ‎נדרש ‎לפי **חוק ‎זהב #5** ‎ב-`AGENTS.md` ‎(אסור backward compat in place).

---

## ‎הבעיה

‎ב-slice 0 ‎ה-bubble ‎הוא שטוח:

```ts
type Bubble = {
  id: string
  kind: "user" | "message" | "thought"
  text: string
}
```

‎זה ‎עובד ‎ל-chat טקסטואלי בסיסי, ‎אבל ‎ב-slices ‎הבאים ‎יידרשו ‎שדות ‎שלא ‎מתאימים ‎למודל ‎הזה:

| Slice | ‎דרישה ‎חדשה |
|-------|----------|
| 2 (Speaker+TTS) | ‎`segments[]` ‎— ‎חלוקה ‎ל-משפטים ‎כדי ‎לזרוק ‎ל-streaming TTS ‎ולמפות ‎audio chunks ‎חזרה ‎ל-bubble |
| 2 | ‎`messageId` — ‎כדי ‎לקבץ ‎chunks ‎עוקבים ‎מאותו ‎message ל-bubble אחד (vs יצירת ‎bubble חדש לכל chunk) |
| 4 (Bubble polish) | ‎`kind: "tool"` + ‎`toolCall: { name, args, status, narration?, title? }` ‎— ‎ל-tool bubbles ‎collapsible ‎עם ‎status dots |
| 4 | ‎ב-`thought` ‎— ‎`originalText` ‎(אנגלית) ‎+ ‎`text` ‎(תרגום ‎עברית). ‎הצגה side-by-side ‎לפי ‎`frontend-spec.md §7` |
| 10 (Recordings) | ‎`user` bubbles → ‎`recordingId?: string` ‎ל-replay |

**‎הפיתוי**: ‎להוסיף ‎שדות ‎הדרגתית ‎(`segments?`, ‎`toolCall?`, ‎`recordingId?`). **‎אסור**. ‎זה ‎בדיוק ‎הדפוס ‎שיצר ‎`messages` + ‎`bubbles` ‎הכפול ‎ב-FE ‎הישן ‎ואת ‎`segmentCache` ‎שלא ‎הוצב ‎אף ‎פעם.

‎הכלל: **מודל מחושב פעם אחת קדימה, ‎עם ‎כל ‎השדות ‎הצפויים. ‎מי ‎שלא ‎צריך ‎אותם ‎עוד ‎פשוט ‎לא ‎מציב.**

---

## ‎ההצעה

‎Discriminated union לפי ‎`kind`. ‎כל ‎variant מכיל ‎בדיוק ‎את ‎השדות ‎הרלוונטיים ‎לו.

```ts
type BubbleBase = {
  id: string
  messageId: string | null  // ACP message id; null = synthetic (user / tool / pre-chunk)
  createdAt: number          // Date.now() — סדר תצוגה
}

type Segment = {
  id: string                 // לזיהוי ‎ב-Player ‎ול-audio mapping
  text: string
}

type UserBubble = BubbleBase & {
  kind: "user"
  messageId: null            // user prompts אין להם ACP messageId
  segments: Segment[]        // bubble אחד = segment אחד בפועל, אבל הצורה אחידה
  recordingId?: string       // slice 10 — id ב-RecordingsStore ‎של ‎ה-BE
}

type MessageBubble = BubbleBase & {
  kind: "message"
  segments: Segment[]        // chunks מצטברים — כל chunk הוא segment או append ל-last
}

type ThoughtBubble = BubbleBase & {
  kind: "thought"
  segments: ThoughtSegment[]
}

type ThoughtSegment = Segment & {
  originalText?: string      // slice 2/4 — אנגלית מקור, ‎`text` ‎הוא ‎תרגום עברית
}

type ToolCall = {
  toolCallId: string
  name: string
  args: unknown
  status: "pending" | "in_progress" | "completed" | "failed"
  title?: string             // ACP raw title (technical)
  narration?: string         // Gemini-generated prose (Hebrew)
}

type ToolBubble = BubbleBase & {
  kind: "tool"
  messageId: null            // tool calls מגיעים בנפרד מ-messages
  toolCall: ToolCall
  segments: never[]          // מבני אחיד — bubble ללא segments
}

type Bubble = UserBubble | MessageBubble | ThoughtBubble | ToolBubble
```

### ‎נקודות ‎חשובות

**`messageId` ‎כ-grouping key**: ‎שני ‎chunks ‎עוקבים ‎מאותו ‎`messageId` ‎ו-`kind` ‎= ‎אותו ‎bubble. ‎אם ‎ה-`messageId` ‎שונה ‎(או ‎null) ‎→ bubble חדש. ‎זה ‎בדיוק ‎ה-pattern ‎שיושם ‎ב-Slice 9 ‎של ‎ה-FE ‎הישן ‎(walkthrough 2026-05-17 03:30) ‎ועבד.

**`segments` ‎גם ‎ל-`user`**: ‎אחידות. ‎`Player` ‎ב-slice 10 ‎ינגן ‎`segments[].id` ‎גם ‎ל-user (recording) ‎וגם ‎ל-message/thought (TTS). ‎שדה ‎יחיד ‎לכל ‎הסוגים.

**`ToolBubble.segments: never[]`**: ‎מבטיח ‎ב-typecheck ‎ש-tool bubbles ‎לא ‎מנסים ‎לקבל ‎segments. ‎ב-runtime ‎זה ‎array ריק.

**`originalText` ‎אופציונלי ‎ב-ThoughtSegment**: ‎ב-slice 0/0.5 ‎`text` ‎הוא ‎טקסט ‎מקור ‎ללא ‎תרגום. ‎ב-slice 2 ‎ה-orchestrator ‎יחל ‎לתרגם ‎ולמלא ‎`originalText`. ‎ה-component ‎יידע ‎להציג ‎את ‎שניהם ‎אם ‎שניהם ‎קיימים, ‎אחרת ‎רק ‎`text`.

**‎לא ‎חלק ‎מ-Bubble**: ‎`isPlaying` ‎/ ‎`currentlyPlayingSegmentId` ‎שייכים ‎ל-`Player` VM, ‎לא ל-Bubble (UI ‎נגזרת). ‎component ‎יקרא ‎ל-`player.currentSegmentId` ‎ויעשה ‎`segments.some(s => s.id === player.currentSegmentId)`.

---

## ‎מה ‎צריך ‎לקרות ‎ב-slice 0.5 / 1 / 2

| Slice | ‎השפעה ‎על ‎ה-model |
|-------|------------------|
| 0.5 ‎(i18n) | ‎אין ‎השפעה ‎— ‎i18n ‎עובד ‎על ‎טקסטים ‎ב-components, ‎לא ‎על ‎שדה ‎`text` ‎של ‎bubble (זה ‎טקסט ‎דינמי ‎מהסוכן) |
| 1 ‎(Mic+STT) | ‎ה-`Mic` ‎מעביר ‎לתוך ‎`sendPrompt(text, opts?)`. ‎ב-slice 1 ‎אין ‎עוד ‎`recordingId`. ‎ההכנה ‎ב-API הציבורי: ‎`sendPrompt(text, opts?: { recordingId?: string })` |
| 2 ‎(Speaker+TTS) | ‎ה-bubble model המורחב ‎נכנס ‎לתוקף. ‎`segments` + ‎`messageId` + ‎`ThoughtBubble.originalText` |
| 4 | ‎`tool` ‎נוסף ‎ל-discriminated union |
| 10 | ‎`UserBubble.recordingId` ‎מתחיל ‎להיות ‎מוצב |

**‎ההמלצה**: **‎לא ‎ליישם ‎את ‎המודל ‎המורחב ‎ב-slice 0.5 ‎או 1.** ‎ליישם ‎אותו ‎בתחילת ‎slice 2 ‎כ-מהלך ‎`refactor` ‎ראשון, ‎עם ‎עדכון ‎אטומי ‎של ‎`AgentSession`, ‎`+page.svelte` ‎(chat), ‎וטסטים. ‎חוק ‎זהב ‎#5: ‎שובר ‎consumers ‎באותו ‎commit, ‎לא ‎"‎לצד ‎הישן".

‎הסיבה ‎לא ‎ליישם ‎ב-0.5: ‎i18n ‎פשוט ‎דרכו ‎בלי ‎מודל ‎חדש. ‎לערבב ‎את ‎שניהם ‎= ‎שני ‎שינויים ‎בקומיט אחד ‎= ‎revert מסובך אם משהו נשבר.

‎הסיבה ‎לא ‎ליישם ‎ב-1: ‎`Mic` ‎לא ‎דורש ‎את ‎המודל ‎החדש. ‎הוא ‎דורש ‎רק ‎ש-`sendPrompt` ‎יקבל ‎`opts?`. ‎שינוי ‎מינימלי.

**‎הסיבה ‎ליישם ‎ב-2 ‎ולא ‎אחרי**: ‎`Speaker` ‎מטבעו ‎צריך ‎`segments` ‎+ ‎`messageId` ‎כדי ‎לעבוד. ‎בלי ‎המודל ‎החדש ‎יהיה ‎צורך ‎ב-state ‎מקביל ‎ב-`Speaker` ‎(שזה ‎`segmentCache` ‎הזניח ‎של ‎ה-FE ‎הישן ‎שוב). ‎את ‎ההצדקה ‎הזו ‎צריך ‎לזכור.

---

## ‎פתוחות

| # | ‎שאלה | ‎מתי ‎להחליט |
|---|------|---------|
| 1 | `Segment.id` ‎— `crypto.randomUUID()` ‎או ‎deterministic (`${messageId}-${index}`)? | slice 2 |
| 2 | ‎`ToolBubble.segments` — `never[]` ‎(טיפוס) ‎או ‎פשוט ‎השמטה? | slice 4 |
| 3 | ‎האם ‎`MessageBubble.segments` ‎מכיל ‎sentence-split (לטובת TTS) ‎או ‎chunks ‎כפי ‎שמגיעים? | slice 2 — תלוי ‎בארכיטקטורת ‎`Speaker` |
| 4 | ‎`createdAt` נחוץ עם `id` ‎ב-UUID? | אם ‎ה-id ‎הוא UUID v7 — לא; ‎אחרת ‎כן ‎ל-stable order |

---

## ‎סיכום ‎להחלטה

‎אישור ‎נדרש ‎על:
1. ‎לאמץ ‎את ‎ה-discriminated union ‎עם 4 ‎variants ‎(user / message / thought / tool).
2. ‎ליישם ‎אותו ‎בתחילת ‎slice 2 ‎כ-refactor ‎אטומי ‎(לא ‎ב-0.5 ‎ולא ‎ב-1).
3. ‎`sendPrompt(text, opts?: { recordingId?: string })` ‎— ‎להוסיף ‎חתימה ‎עם ‎`opts` ‎כבר ‎ב-slice 1 ‎(גם ‎אם ‎`recordingId` ‎ימולא ‎רק ‎ב-slice 10) — ‎חוסך ‎שינוי API ‎עתידי.
