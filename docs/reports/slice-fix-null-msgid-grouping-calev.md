---
project: "voice-acp"
slice: "fix-null-msgid-grouping"
verifier: "calev"
date: "2026-06-04"
mode: "light"
verdict: "GO"
dod_items:
  - "3 agent_message_chunk with null messageId → 1 MessageBubble with 3 segments"
  - "3 agent_message_chunk with messageId abc → 1 MessageBubble (Claude regression)"
  - "kind alternation msg→thought→msg → 3 separate bubbles"
  - "user bubble not confused with message bubble (kind guard)"
  - "TypeScript typecheck passes"
spot_check: "6 unit tests added covering all grouping scenarios — all 171/171 pass; typecheck 0 errors"
findings: []
---

# slice-fix-null-msgid-grouping — Verification Report (Light)

> **תאריך:** 2026-06-04
> **Tier:** light
> **Commit:** 852e950

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 5/5 |
| Happy path עובד | ✅ |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | 3 `agent_message_chunk` עם `messageId=null` → MessageBubble יחיד עם 3 segments | ✅ | `agent-session.test.ts:130-141` — test "Gemini-style" עובר; `bubbles.length===1`, `segments.join===hello world!` |
| 2 | 3 `agent_message_chunk` עם `messageId="abc"` → MessageBubble יחיד (regression) | ✅ | `agent-session.test.ts:117-128` — test "Claude-style" עובר; קיבוץ לפי messageId שמור |
| 3 | kind מתחלף (msg→thought→msg) → 3 בועות נפרדות | ✅ | `agent-session.test.ts:154-167` — 3 bubbles עם kinds message/thought/message |
| 4 | user bubble לא מתבלבל עם message bubble (kind guard) | ✅ | `agent-session.test.ts:169-177` — null msg → null user → 2 bubbles נפרדות |
| 5 | TypeScript typecheck | ✅ | `pnpm --filter @drive-coding/frontend-v2 typecheck` → "0 errors and 0 warnings" |

## Happy path

השינוי הוא קוד-טהור (אין BE/FE runtime). Happy path מוגדר ע"י הטסטים:

1. `session.attach({cwd,cliKind})` → mock AcpClient נוצר, `onSessionUpdate` callback נלכד
2. 3x `msgChunk(text, null)` דרך `onSessionUpdate` → בדיקת `session.bubbles.length===1` + `segments.length===3`
3. Alternation test: `msg(null)→thought(null)→msg(null)` → `session.bubbles.length===3`

✅ כל 6 הטסטים החדשים עוברים. סה"כ **171/171 tests pass** (20 test files).

## Logic verification — קוד השינוי

`agent-session.svelte.ts:716-721`:

```ts
const canGroup =
  last !== undefined &&
  last.kind === kind &&
  (messageId !== null
    ? last.messageId === messageId     // יש messageId → קבץ לפי מזהה (Claude)
    : last.messageId === null)         // אין messageId → קבץ לפי kind (Gemini)
```

הלוגיקה תואמת בדיוק לטבלת הסיכון ב-§3 של ה-brief:
- Claude (messageId קיים): condition `last.messageId === messageId` — שמור
- Gemini (messageId=null): מתקבץ רק כש-`last.messageId === null` + same kind — נכון
- kind שונה (user vs message, thought vs message): `last.kind === kind` חוסם — נכון

## Bugs חדשים שלא ברשימה

אין.
