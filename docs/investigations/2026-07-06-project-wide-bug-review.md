# סקירת-באגים כלל-פרויקטית — 2026-07-06

**סטטוס:** נחקר (read-only) · **בסיס:** `dev` @ `9faf62f` (v0.13.2)
**שיטה:** 4 סוכני general-purpose במקביל (Explore-style, read-only) על `packages/core`, `packages/backend`, `packages/frontend`, `packages/provider`, בתוספת הרצות אמפיריות (typecheck/tests/lint פר-חבילה) ואימות-עצמי בקוד לממצאים הקריטיים ולממצאים שהתכנסו משני סוכנים בנפרד.

לא בוצע שום שינוי קוד — זהו מסמך-חקירה בלבד. תיקונים עתידיים עוברים brief-driven-slices כרגיל.

---

## תקציר מנהלים

הבסיס יציב וראוי-לשימוש-יומיומי, בהתאם למה שהראודמאפ טוען. אבל מתחת לזה יש **שלושה שורשי-קריסה קריטיים ב-backend**, כל אחד מפיל את כל השרת בתרחיש ריאלי, ואף אחד מהם לא מתועד בראודמאפ. שניים מהשלושה עלו משני סוכנים שונים בנפרד (התכנסות = אמינות גבוהה), ואחד אומת אמפירית בהרצת קוד. הם גם מסבירים ישירות כמה מהכאבים החוזרים שכבר רשומים בראודמאפ כתעלומה ("הפורט לא משתחרר", "event-loop stalls").

בנוסף נמצאו שורשי-אמת לשני באגי-FE ידועים (ThoughtBubble בסדר הפוך, prev/next stall), וממצא-XSS שדווח על-ידי אחד הסוכנים הופרך באימות (dead code).

---

## 🔴 שלושה שורשי-קריסה קריטיים ב-BE (לא בראודמאפ)

### 1. כתיבה fire-and-forget לסטרים שבור מפילה את כל ה-BE
**קובץ:** `packages/provider/src/connection/stream-bridge.ts:124`
```ts
void inboundWriter.write(msg)  // fire-and-forget, אין catch
```
**רצף כשל (מאומת בקוד):** לקוח WS שולח frame שהוא JSON תקין אבל לא אובייקט (למשל `42`) → מועבר ל-agent → בלולאת ה-receive של `acp-sdk-v1` (`jsonrpc.js:526`, `"method" in message`) נזרק TypeError → ה-SDK עושה `close(error)` ומבטל את ה-reader → צד ה-writable של ה-TransformStream נכנס למצב errored, אבל הדגל `closed` של ה-bridge נשאר `false` (נדלק רק ב-`bridge.close()`) → ה-frame הבא (פרומפט רגיל מה-FE) → `inboundWriter.write` נדחה → `unhandledRejection` בלי `code` → ה-handler הגלובלי (`packages/backend/src/server.ts:36-47`) מסווג לא-transient → `process.exit(1)`.

**שני frames מכבים את כל השרת.** נמצא בנפרד על-ידי סוכן ה-backend (ממצא #9) וסוכן ה-provider (ממצא #1).

### 2. usage-store חוטף SIGINT/SIGTERM ומבטל את יציאת ברירת-המחדל — ה-BE לא ניתן לכיבוי
**קובץ:** `packages/backend/src/usage/usage-store.ts:129-135`
```ts
process.on("SIGINT", () => {
  flushOnExit()
  // Don't call process.exit here — let other handlers run
})
process.on("SIGTERM", () => {
  flushOnExit()
})
```
**רצף כשל (מאומת בקוד + grep):** נרשמים listeners ל-SIGINT/SIGTERM שרק עושים flush ובמכוון לא קוראים ל-`process.exit` ("let other handlers run"). אימות ב-grep: **אין שום handler אחר בכל ה-backend** שכן קורא exit. ב-Node/Bun, עצם קיום listener על SIGINT/SIGTERM מבטל את ה-default-terminate-behavior. רצף: `systemd stop` שולח SIGTERM → flush → התהליך ממשיך לרוץ → SIGKILL רק אחרי `TimeoutStopSec` (90s); ב-dev, Ctrl+C נבלע לגמרי.

**זה מסביר ישירות** את הכאב התיעודי בראודמאפ Track F — "חוסן כיבוי-BE + פורטים שלא משתחררים" ("סגירת-טרמינל לא הרגה אותו", "הפורט לא השתחרר גם אחרי מות התהליך") — שתועד שם כתעלומה לא-פתורה.

### 3. קריסת BE מרחוק בבקשת upgrade עם URL פגום
**קובץ:** `packages/backend/src/server.ts:228`
```ts
httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", `http://localhost`)  // אין try/catch
  ...
```
**אומת אמפירית** (`node -e`):
```
THROW "http://[" -> TypeError
THROW "//[::1"   -> TypeError   ← origin-form תקין מבחינת פרסר-HTTP
THROW "http://%" -> TypeError
```
בקשת `upgrade` עם request-target פגום (למשל `//[::1`, שצורת ה-origin-form שלו תקינה מבחינת llhttp) → `new URL()` זורק TypeError → אין `code` → לא מסווג transient → `uncaughtException` → `process.exit(1)`. **בקשה זדונית בודדת מפילה את כל השרת מרחוק.**

---

## 🟠 שורשים נוספים בולטים (גבוה)

| # | ממצא | מיקום | תמצית |
|---|------|-------|-------|
| 4 | `/api/options` חוסם את כל ה-event-loop | `backend/src/delivery/http-options.ts:32` | `execFileSync("opencode",["models"],{timeout:5000})` סינכרוני, בלי cache, בכל קריאה + `readdirSync`/`statSync` על `$HOME`. חשוד מרכזי ל"event-loop stalls" שנצפו חי. |
| 5 | תהליכי claude יתומים | `provider/src/connection/connect-in-process.ts:299-313` | `close()` לא קורא `claudeAgent.dispose()` (רק `bridge.close()`); ה-adapter מחזיק תהליך-SDK חי לכל session. `pid=null` → בלתי-נהרג. נמצא בנפרד ע"י backend (#3) ו-provider (#2). |
| 6 | קריסת codex/claude in-process בלתי-נראית | `connect-in-process.ts:133-135,236-240,292-297`, `connect-codex-in-process.ts:172-183` | `onCrash` לא נורה בנתיב in-process; ה-fork של codex לא סוגר את `serverOut` כשה-child מת → ה-registry חושב שה-agent חי, בקשות pending לנצח. |
| 7 | `close()` ב-connection-registry דורס agent חי | `backend/src/acp/connection-registry.ts` + `agent-orchestrator.ts:149-191` | מרוץ DELETE-בזמן-spawn → נתיב catch לא סוגר connection → child אלמותי בלתי-נגיש. |
| 8 | תלויות runtime בשדה `devDependencies` | `provider/package.json:29-35` | `acp-sdk-v1` ו-`@agentclientprotocol/claude-agent-acp` הם devDependencies אבל מיובאים מקוד production (`connect-in-process.ts`, `stream-bridge.ts`) שנחשף דרך ה-barrel שה-BE מייבא. `pnpm install --prod` עלול לשבור את עליית ה-BE כליל. |
| 9 | חילוץ שגיאות-ספק מ-stderr מת | `provider/src/connection/spawn.ts:110` | `getStderr` מהתוצאה נזרק; `describeCrash(info, [])` תמיד מקבל מערך ריק → הודעות שגיאה עשירות (401/429/"credit balance too low") אף פעם לא מגיעות למשתמשת — dead code בשקט מאז ה-cutover. |
| 10 | אובדן chunks בניתוק FE (F4, ידוע בראודמאפ) | `backend/src/delivery/ws-agent.ts:97-104,149` | אין buffering צד-BE; ניתוק רגעי → chunks שנפלטו בינתיים אבדים; אושר בקוד. |

---

## שורשים שנמצאו לכאבים כבר-רשומים בראודמאפ

### ThoughtBubble בסדר הפוך (נצפה חי 2026-07-05, "טרם brief" בראודמאפ)
**שורש:** `packages/frontend/src/lib/view-models/speaker.svelte.ts:553-577` (`#persistThoughtTranslation`) + `:346-357` (`#pumpFetchLoop`, LOOKAHEAD=2).
תרגומי-מחשבות נכתבים לסגמנטים **לפי סדר-השלמת-fetch** ולא סדר-המשפט: בועת-מחשבה עם 2+ משפטים → שני jobs של `translate()` יוצאים במקביל → אם משפט 2 חוזר מהרשת לפני משפט 1, התרגום שלו נכתב לסגמנט 0 — שורות הפוכות. מחמיר: `visibleThoughtSegments` מסתיר כל סגמנט לא-מתורגם ברגע שיש תרגום אחד, כך שתוכן יכול "להיעלם" עד שהתרגום נוחת.

### prev/next stall ~20s (ידוע בראודמאפ כ-`playback-nav-retain`)
**שורש:** `packages/frontend/src/lib/engines/pcm-audio-stream.ts:163-166,247-261` — `cancel()` לא מאפס את `#nextStartTime`; הניגון הבא מתוזמן כמה עשרות שניות קדימה על גבי ה-cursor הישן ונראה כתקוע. קורה בנתיב `bubble-player` בלבד (ב-`Speaker` יש `#stopAndClear` שמאפס נכון).

---

## ✅ ממצא שהופרך באימות

סוכן ה-core דיווח על XSS "גבוה" ב-`packages/core/src/ui/markdown.ts` (`renderMarkdown` עם regex-sanitization חלש — לא חוסם `data:` URIs, ו-`javascript:` עם רווח מוביל חומק). **אימתתי ב-grep: זהו dead code.** `renderMarkdown` הזה מיובא רק בטסטים של `packages/core` עצמו. כל ה-FE משתמש ב-`$lib/util/markdown` (DOMPurify two-pass + KaTeX allowlist) — צנרת נפרדת ומאובטחת. זהו legacy port מ-v1 שנשאר ללא צרכן production. לא וקטור-תקיפה חי, אך שווה מחיקה כדי למנוע שימוש-שגוי עתידי.

---

## מצב תשתית (אמפירי)

- **טסטים:** 10 אדומים מתוך 1234 — **כולם סביבתיים, לא רגרסיות קוד**: נתיב-bun קשיח (`D:/ProgramsAndApps/Bun/bin/bun.exe`) ב-`packages/backend/tests/https-serve.test.ts:85` שלא תואם את ההתקנה בפועל (`/d/ProgramsAndApps/Bun/bin/bun`); טסט מקומפל-ישן ב-`dist/acp/bridge-manager.idle.test.js` (רכיב שהוחלף ב-connection-registry); spawn-ENOENT ב-Windows (`bridge-failure-modes.test.ts`). שאר 1207 עוברים.
- **typecheck:** `packages/core` ו-`packages/backend` נקיים. `packages/provider` נופל רק על `.d.ts` חסר מה-fork החיצוני `@agentclientprotocol/codex-acp` + 2 טעויות-טיפוס בטסטים — לא לוגיקה שבורה. `pnpm typecheck` ברמת-root (`tsc --build`) נכשל על `allowImportingTsExtensions` שדורש `noEmit`/`emitDeclarationOnly` ב-tsconfig הבסיסי.
- **lint:** `pnpm lint` (Biome) מציג ~600 שגיאות, אבל ~863 מהאירועים הם "format" מדומה — **אין `.gitattributes` ו-`core.autocrlf=true`** גורם ל-working-tree עם CRLF בעוד Biome מצפה ל-LF. מסתיר lint אמיתי מתחת לרעש; שווה `.gitattributes` עם `* text=auto eol=lf`.

---

## המלצת סדר-תיקון

1. **slice קצר "BE-crash-hardening"** — שלושת הקריטיים ביחד: try/catch סביב `inboundWriter.write` (stream-bridge:124), try/catch סביב `new URL` ב-upgrade handler (server.ts:228), ותיקון ה-SIGINT/SIGTERM ל-graceful-shutdown שבאמת קורא `process.exit`. תשואה גבוהה מאוד ביחס לגודל הפאץ'.
2. **מיזוג `slice/be-shutdown-hardening`** (branch קיים, לא-ממוזג, 3 commits) — כבר כולל תיקוני SIGINT/ghost-socket/kill-tree; חלק מהעבודה על ממצא #2 כבר קיים שם וממתין ל-dispatch.
3. **cache/async ל-`/api/options`** — מנטרל את חשוד-התקיעות המרכזי בבקשת event-loop.
4. **dispose לתהליכי claude in-process** (ממצא #5) + חשיפת onCrash אמיתי בנתיב in-process (ממצא #6).
5. **ThoughtBubble ו-prev/next** — עכשיו שהשורש ידוע, שני briefs ממוקדים וקטנים.
6. `.gitattributes` לניקוי הרעש ב-lint; מעבר devDependencies→dependencies ב-provider (ממצא #8) לפני כל build מינימלי.

---

*הופק ב-2026-07-06 על-ידי 4 סוכני בדיקה מקבילים (Explore-style, read-only) + אימות-עצמי בקוד ובהרצה. ראה גם זיכרון-פרויקט `bug-review-2026-07-06-findings`.*
