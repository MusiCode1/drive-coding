# slice-ws-reconnect-fix-nbug2 — calev light report

**verdict: GO**
**mode: light**
**commit: e1e0d6d**
**findings: 2 (minors, non-blocking)**

## מה אומת

- ✅ `closeAndWait` קיים ב-ws-transport, listener נרשם לפני `close()`, timeout fallback 1000ms
- ✅ `#transport` ref נשמר בכל 3 יצירות (attach/loadSession/warmReconnect), מנוקה בכל 4 null sites
- ✅ `#doReconnect` קורא `closeAndWait` + מנקה `#client`/`#transport` לפני warm
- ✅ 651 טסטים ✓ (כולל 5 unit ws-transport + 2 reconnect-agent, TDD)
- ✅ typecheck ✓, build ✓
- ✅ DoD#8 בשטח (auto-cold): n=1, detach n→0, second-WS → 1008 resolved by MED-8 retry

## Findings

### 🟡 Finding 1: DoD#8.1 (reconnect() on live WS) לא ניתן לבדיקה headless

- **מה**: DoD#8 תת-מקרה 1 — `reconnect()` על WS **חי** → n נשאר 1 — דורש browser חי עם TEMP button גלוי
- **למה לא**: production Svelte לא חושף context; TEMP reconnect button נסתר כש-status=connected
- **כיסוי קיים**: unit test `agent-session.reconnect.test.svelte.ts` מאמת ש-`closeAndWait` נקרא כשיש `#transport`
- **severity**: minor — unit coverage קיים; הוכחה-בשטח תתאפשר אחרי TEMP button עם trigger מתאים

### 🟡 Finding 2: TEMP button Hebrew literal → lint:i18n fails

- **מה**: `RecordFooter.svelte` (commit `672aa42`, TEMP) מכיל מחרוזות עברית קשיחות
- **השפעה**: `pnpm lint:i18n` נכשל → commit הנוכחי נדרש `--no-verify`
- **פעולה**: יש להסיר TEMP button לפני merge (5 דקות עבודה)
- **severity**: minor — out-of-scope של ה-fix הנוכחי; התעד ב-commit message

## סיכום

DoD 7/8 — כל item ניתן לאמת. DoD#8.1 (reconnect על WS חי) מכוסה ב-unit test; בדיקה-בשטח תחייב UI fix נפרד. fix-nbug2 עצמו תקין ומוכן ל-merge (אחרי הסרת TEMP button).
