---
project: "voice-acp"
slice: "slice-redesign-7-smart-scroll"
verifier: "calev"
date: "2026-06-02"
mode: "light"
verdict: "GO"
dod_items:
  - "typecheck/build/test/i18n נקיים"
  - "auto-scroll בתחתית — הודעה חדשה נגללת אוטומטית"
  - "עצירה בגלילה-למעלה — לא נזרק לתחתית תוך streaming"
  - "כפתור JumpDown מופיע כש-!בתחתית + תוכן חדש"
  - "jump → קפיצה לתחתית + חידוש + כפתור נעלם"
  - "effect ב-owner (AppShell מחזיק bind:this)"
  - "אין רגרסיה — בועות/Speaker/הקראה לא הושפעו"
spot_check: "code walk — logic sound: isAtBottom gate on $effect, onScroll resets hasNewBelow, jumpToBottom resets both flags"
findings:
  - id: 1
    severity: "minor"
    category: "unique"
    summary: "JumpDown button: -translate-x-1/2 (Tailwind) + style transform:translateX(-50%) — כפילות. RTL: start-1/2 נכון אבל translateX(-50%) לא מסתגל ל-RTL."
    source_brief: "§4 Commit 1 — כפתור JumpDown"
    source_code: "packages/frontend/src/lib/components/layout/AppShell.svelte:122-123"
    cost_estimate: "5min"
---

# slice-redesign-7-smart-scroll — Verification Report (Light)

> **תאריך:** 2026-06-02
> **Tier:** light
> **Commit:** 0a12ce2

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 7/7 |
| Happy path עובד | ✅ (code walk) |
| Bugs חדשים | 1 (minor, לא blocker) |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck/build/test/i18n נקיים | ✅ | אליעזר דיווח: 0/נקי/447 pass/נקי. commit message מאשר. |
| 2 | auto-scroll בתחתית | ✅ | `$effect` קורא `session.bubbles.length`+seg counts → אם `isAtBottom` → `scrollEl.scrollTop = scrollEl.scrollHeight` (AppShell:76-81) |
| 3 | עצירה בגלילה-למעלה | ✅ | `onScroll` → `isAtBottom = checkIsAtBottom()`. `$effect` מסתעף: אם `!isAtBottom` → `hasNewBelow = true` בלבד, לא נוגע ב-scrollTop |
| 4 | כפתור JumpDown מופיע | ✅ | `{#if !isAtBottom && hasNewBelow}` (AppShell:118). `ArrowDownIcon` + `t("chat.jumpDown")` |
| 5 | jump עובד | ✅ | `jumpToBottom()`: `scrollEl.scrollTop = scrollEl.scrollHeight` + `isAtBottom=true` + `hasNewBelow=false` → כפתור נעלם באותו tick |
| 6 | effect ב-owner | ✅ | `$effect` ב-AppShell שמחזיק `bind:this={scrollEl}`. ChatBubbles = content-only, אין scroll logic (שורות 1-7 בקובץ מסבירות את ה-redesign-2 ownership). חוק זהב #4 ✓ |
| 7 | אין רגרסיה | ✅ | commit שינה רק 4 קבצים: AppShell.svelte + i18n keys/en/he. ChatBubbles, Speaker, AgentSession לא נגעו. |

## Happy path

1. משתמש שולח פרומפט → streaming מתחיל → `session.bubbles` גדל → `$effect` יורה → `isAtBottom=true` (ברירת מחדל) → `scrollToBottom` → נצמד לתחתית.
2. משתמש גולל למעלה תוך streaming → `onScroll` → `isAtBottom=false` → `$effect` הבא יורה → `hasNewBelow=true` → כפתור ↓ מופיע.
3. משתמש לוחץ ↓ → `jumpToBottom()` → `scrollTop=scrollHeight` + שני flags מתאפסים → כפתור נעלם → streaming ממשיך לתחתית.

✅ עבד (code walk — הלוגיקה תקינה ורציפה)

## Bugs חדשים שלא ברשימה

- ⚠️ **כפילות transform על כפתור JumpDown** (minor, לא blocker):
  שורה 122: `class="... start-1/2 -translate-x-1/2 ..."` + שורה 123: `style="... transform:translateX(-50%)"`.
  ה-`style` attribute דורס את ה-Tailwind class — `start-1/2` (RTL-safe) עם `-translate-x-1/2` (Tailwind logical) עובד נכון, אבל ה-`style` הכפול מיותר ועלול לגרום ל-misalignment בסביבות שמחשבות specificity שונה.
  תיקון: להסיר את `style="... transform:translateX(-50%)"` (להשאיר רק Tailwind classes).
