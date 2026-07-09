---
project: "ClaudeCodeACP"
slice: "slash-menu-native"
verifier: "calev"
date: "2026-07-07"
mode: "light"
verdict: "GO"
dod_items:
  - "pnpm typecheck = 0"
  - "ArrowDown x10 — highlighted item always visible (scroll-into-view)"
  - "Home jumps to first; End to last"
  - "wrap-around ArrowUp from first goes to last"
  - "ARIA: ul role=listbox id=slash-listbox; button role=option id=slash-opt-{i} aria-selected; textarea role=combobox aria-expanded aria-controls aria-activedescendant"
  - "Escape closes; open/filter/select/send as before"
  - "ghost-hint: /code-review + space shows hint; typing arg removes it"
  - "/context + space — no ghost"
spot_check: "happy path — type / open 57-item menu, ArrowDown, Enter select, menu closes, value set, ghost-hint visible then clears on arg input"
findings: []
---

# slash-menu-native — Verification Report (Light)

> **תאריך:** 2026-07-07
> **Tier:** light
> **Commit:** d396be6 (top of slice/slash-commands, 6 commits above abb0b78)

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 8/8 |
| Happy path עובד | ✅ |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | `pnpm typecheck` = 0 | ✅ | פלט ריק = 0 שגיאות |
| 2 | ArrowDown x10 — פריט מודגש תמיד נראה | ✅ | `isVisible:true` — `elTop:595 elBottom:649` בתוך `ulTop:394 ulBottom:650` אחרי 10 לחיצות |
| 3 | Home קופץ לראשון; End לאחרון | ✅ | End→`slash-opt-56` (isVisible:true); Home→`slash-opt-0` (isVisible:true) |
| 4 | wrap-around ArrowUp מהראשון → אחרון | ✅ | `slash-opt-0` → ArrowUp → `slash-opt-56` (isVisible:true) |
| 5 | ARIA מלא על ul/button/textarea | ✅ | `ul role=listbox id=slash-listbox`; `button role=option id=slash-opt-0 aria-selected=true`; `textarea role=combobox aria-expanded=true aria-controls=slash-listbox aria-activedescendant=slash-opt-0`; כשסגור: `expanded=false, controls=null, activedesc=null` |
| 6 | Escape סוגר; פתיחה/סינון/בחירה/שליחה כמו קודם | ✅ | Escape→listbox נמחק מ-DOM, `aria-expanded=false`; Enter בוחר (`/audiobook-reader `); קליק בוחר (`/commit `); סינון `/comm`→`["/commit"]` בלבד |
| 7 | ghost-hint: `/code-review ` → hint מוצג; הקלדת ארגומנט → נעלם | ✅ | overlay span: `"[low\|medium\|high\|xhigh\|max\|ultra] [--fix] [--comment] [<target>]"` (rgb(125,112,100)); אחרי `pressSequentially('my-task')` → `null` |
| 8 | `/context ` (ללא hint) → אין ghost | ✅ | `GHOST_FOR_CONTEXT: null` |

## Happy path

פתיחת סשן slash-commands → הקלדה mode → `/` → תפריט 57 פקודות נפתח → ArrowDown ×10 (גלילה אוטומטית) → End (קפיצה לאחרון `team-onboarding/`) → Home (חזרה לראשון) → ArrowUp (wrap→`team-onboarding/`) → Escape (תפריט נסגר) → `/code-review` + Enter (בחירה) → ghost hint מופיע → הקלדת ארגומנט → ghost נעלם.

✅ עבד בכל השלבים

## Bugs חדשים שלא ברשימה

אין.
