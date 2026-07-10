# Decisions — drive-coding

## 2026-07-10 — slash-commands: merge ל-dev v0.14.0 (reconcile + fix-in-place RTL/ghost)

### רציונל
הסלייס (`slice-slash-commands` + הרחבות `hint`/`slash-menu-native`) היה קוד-גמור מ-07-07 עם
calev GO×2 ו-preview שאושר — **אבל לא מוזג**, ובינתיים dev התקדם 11 commits כולל מיגרציית
`agnostic-tooling` v0.13.3 (bun-only, `pm.mjs`, codex-acp מ-npm). לכן ה-merge חייב **reconcile**
תחילה.

### reconcile — כמעט-נקי (מנוגד לחשש)
merge `dev→branch` (`016c0b23`) עבר **אפס קונפליקטים**: (1) codex-acp — שני הצדדים התכנסו
עצמאית לאותה חבילה בדיוק (`@musicode1/codex-acp@^1.0.2`); (2) ה-`workspaces` field וה-`bun.lock`
הלא-committed ב-worktree היו שחזור-ידני חלקי של אותה מיגרציה שכבר קיימת כראוי ב-dev → נזרקו;
(3) קוד ה-slash (FE-only) לא נגע כלל באזורי agnostic-tooling. build-gate מול baseline: FE typecheck 0,
slash-tests 14/14, 1228 tests pass. 28 typecheck-errors ב-backend = `bun-types-web-api-gap` המתועד
(זהה על התקנת-bun טרייה של dev עצמו) — לא רגרסיה.

### fix-in-place — 3 באגי-RTL שנתפסו חי ב-preview (runtime-gate עבד)
preview production (bun build, tunnel, claude 57 פקודות) חשף 3 באגים ש-calev-הסטטי **פספס** —
כולם משורש אחד: האפליקציה `dir=rtl`-first, וה-slash מרנדר תוכן-LTR (`/code-review`, `[--fix]`):
1. **תפריט מיושר-ימין + סדר הפוך** (`[--fix]`→`[fix--]`) → `dir=ltr` על ה-item, `dir=auto` על התיאור.
2. **ghost-hint בלתי-נראה** — ה-overlay רונדר *לפני* ה-textarea האטום שצבע מעליו. `z-10` על ה-overlay.
3. **`/code-review` הוצג `code-review/`** + placeholder עברי משמאל → `dir={len?"auto":"rtl"}`.
תוקן ב-`c53d7096`, rebuild, **אושר חזותית ע"י המשתמשת** (הצילום: ghost עובד נקי).

### ממצא-שיטה — calev DOM-check ≠ נראות חזותית
calev המקורי נתן GO 8/8 על ה-ghost כי בדק **נוכחות-DOM** של ה-span (צבע `rgb(125,112,100)`) —
אבל ה-span היה **מוסתר חזותית** מאחורי ה-textarea האטום. זה בדיוק "green report ≠ עיני המשתמשת".
ה-fix-round חוזק להנחות בדיקת-**נראות** (bounding-box/z-order), אך calev-החוזר נחסם ע"י חוסר
`libnspr4`/`libnss3` בהוסט (אין browser) → PARTIAL 10/13 **מטעמי-כלים-לא-קוד**; 3 הפריטים הלא-מאומתים
= בדיוק החזותיים שהמשתמשת כבר אישרה חי. calev אישר את הקוד מבנית (z-stacking sound). ה-runtime-gate
מולא במהותו: GO-מבני על הקוד + GO-חזותי של המשתמשת.

### מוזג
merge `6d80a28a` (`--no-ff`) → release **v0.14.0** (`56ac821c`, frontend 0.13.0 + core 0.11.0), push origin.
FE-only + core/i18n. **`slash-commands-typed`** (הבחנת סוגי-פקודה) נשאר 💭 טרם brief (חסם-ידע 07-07).

## 2026-07-10 — be-crash-hardening: הקשחת ה-BE מול 2 וקטורי-קריסה (brief READY, טרם dispatch)

### רציונל

‏המשתמשת דיווחה על אי-יציבות חוזרת ב-BE (event-loop נתקע, קריסות עד נפילה). חקירה הראתה
‏שאין תעלומה אחת אלא **שלוש משפחות-כשל**: (A) מוות-רועש (קריסות), (B) ריקבון-שקט (דליפות
‏שמייצרות את ה-hang), (C) תקיעה סינכרונית. סקירת-הבאגים הכלל-פרויקטית (07-06, 4 סוכנים
‏מקבילים) מצאה 3 שורשי-קריסה קריטיים; אימות-קוד עצמאי שלי (מרדכי, 07-10, שורה-שורה)
‏אישר 4/4 מהטענות שבדקתי, כולל את המנגנונים המדויקים. שני וקטורים **חיים ב-dev כרגע**:

1. **#1** — `stream-bridge.ts:77,124` — `void drainOutbound()` / `void inboundWriter.write(msg)`
   ‏fire-and-forget בלי `.catch()`. frame שהוא JSON-תקין-אך-לא-אובייקט → ה-SDK זורק ב-receive-loop
   ‏→ ה-stream errored → ה-write הבא נדחה → `unhandledRejection` לא-transient → `process.exit(1)`.
2. **#3** — `server.ts:228` — `new URL(req.url)` ב-upgrade handler בלי try/catch. target פגום
   ‏(`//[::1`) → `TypeError` (אין `.code` → לא-transient) → `uncaughtException` → exit. **קריסה מרחוק.**

‏הבחירה: slice **כירורגי** ל-#1+#3 (3 commits — `.catch`+`closed`, `safeUrlPathname` טהור,
‏`onError`→פירוק-סשן). ROI עצום, blast-radius קטן.

### ‏הכרעת-גבולות (מניעת חפיפה)

‏סקירת-07-06 מצאה 10 שורשים; חילקתי אותם לסלייסים כדי למנוע חפיפה (§9 בברִיף):
- **#2** (חטיפת SIGINT/SIGTERM ב-`usage-store.ts:129-135`) → **`be-shutdown-hardening`** (brief READY קיים)
  ‏**עם דגל שהברִיף שם צריך עדכון** — הוא נכתב 07-01, לפני שזוהה ש-usage-store הוא שורש-החטיפה;
  ‏ה-graceful-shutdown שם חייב להסיר את ה-listeners של usage-store ולנתב את ה-flush דרכו.
- **#4** (`/api/options` `execFileSync` חוסם-loop) → slice נפרד `options-async-cache`.
- **#5/#6/#7** (dispose / onCrash כללי / מרוץ-DELETE) → `be-lifecycle-hardening`.
- **תשתית-אבחון** (`/api/diag` + `watch.mjs` + hot-path) → `be-diag-harness` (מהspikes השמורים).

### ‏תובנה מרכזית (מעבר לדוח)

‏הקריסות (A) הן הסימפטום החריף; **הדליפות (B) הן מה שמייצר את ה-hang/פורט-לא-משתחרר**
‏המקורי. לכן תיקון-הקריסות לבד לא יפתור את "אי-היציבות" שדווחה — תיקוני-ה-lifecycle (B) הם
‏מה שבאמת פותר אותה. נגזר: crash-hardening ראשון (חריף), אבל be-lifecycle-hardening הוא
‏העיקר. עוד תובנה: `.catch()` לבד לא מספיק — הוא עוצר את הקריסה אבל משאיר סשן-זומבי שקט;
‏לכן Commit 3 מפרק את הסשן דרך `crashListeners`.

### ‏ממצאי אביגיל

‏r1 → USABLE-AFTER-FIX (3 findings, **כולם reference/naming — אפס בעיה טכנית**). כל הטענות
‏העובדתיות אומתו נכונות, כולל **אימות אמפירי** של הנחת-הליבה של Commit 1 (`reader.cancel`→
‏errored→write נדחה) ושל idempotency של `cleanup`. תיקנתי: (1) קימטתי את מסמך-המקור 07-06
‏ל-dev (`b448adcb`) — היה רק ב-wip; (2)+(3) שם+נתיב הטסטים. **r2 → READY, 0 findings.**

### ‏שאלה ארכיטקטונית פתוחה (הושארה מחוץ-scope)

‏מדיניות ה-handler הגלובלי — `unhandledRejection` לא-transient עדיין עושה `process.exit(1)`.
‏ריכוך ל-log-and-continue הוא trade-off אמיתי (חוסן מול הסתרת-באגים); הוכרע **לא** לכרוך
‏אותו ב-crash-hardening — מתקנים מקורות ידועים, לא מדיניות. יעלה למשתמשת בנפרד.
## 2026-07-08 — agnostic-tooling: סקריפטי-שורש PM/runtime-אגנוסטיים (bun-only server)

### רקע
שכבת ה-install כבר bun-native (codex-acp→npm, `cce234c` על origin/dev). מה שנשאר שבר על שרת
**bun-only** (אין pnpm/node): ארבעת סקריפטי-השורש `build`/`dev`/`start`/`fe:build` היו כבולים
ל-`pnpm -r …`/`node …` literals. אומת חי: `bun run build` קורס על `pnpm: command not found` (exit 127).

### רציונל
**בורר-אחד `scripts/pm.mjs`** שמזהה PM דרך `npm_config_user_agent` ו-runtime דרך `process.execPath`,
ומייצא arg-builders (`runAllArgs`/`runFilterArgs`) + CLI (`run-all`/`run-all-parallel`/`run-filter`).
כל סקריפט קורא לבורר במקום literals → אותם סקריפטים רצים זהה תחת bun (שרת) ו-pnpm (dev), בלי שכפול.
עדיף על סקריפטים כפולים פר-PM (drift) ועל `Makefile` (עוד תלות). `spawn("bun")` ב-`dc-launch`
**נשאר literal** — ה-BE bin הוא `#!/usr/bin/env bun` + `Bun.*` ב-`server.ts` → חייב bun תמיד.

### ממצאי אביגיל (3 סבבים → READY)
- **r1 (USABLE-AFTER-FIX, 3):** כל 7 הטענות הטכניות אומתו חי (כולל `bun run --filter '*' build` end-to-end
  ו-`dev` מקבילי). ה-findings היו בהירות בלבד: (1) ה-DoD "test passes" הניח baseline ירוק — שגוי;
  (2) `runFilterArgs` על חבילה חסרת-סקריפט נכשל exit 1 (רק `'*'` מדלג בחן); (3) מיקום ה-`include`
  ב-`scripts/vitest.config.ts`, לא root inline.
- **r2 (USABLE-AFTER-FIX, 1):** תיקון #1 הראשון קיבע "בדיוק 2 כשלים" — אבל יש **קובץ-כשל שלישי**
  pre-existing (`https-serve.test.ts`, מקודד-קשיח `D:/…bun.exe` → ENOENT על linux).
- **r3 (READY, 0):** ה-DoD חודד ל-**baseline-capture-then-compare** (מדוד לפני/אחרי, בלי מונה קשיח).

### שינויי-כיוון
- **base ל-worktree = `origin/dev`, לא local dev.** התגלה ש-local dev (`9faf62f`) **מאחורי** origin/dev
  ושהשכבה ה-bun-native (`cce234c`) יושבת שם כ-drift לא-committed מקומית. worktree מ-`9faf62f` היה
  מקבל את ה-github codex-acp הישן → BE לא היה עולה. הבסיס הנכון = origin/dev (עם cce234c committed).
- **DoD test-gate**: ממונה-קשיח → capture-and-compare (חסין למספר הכשלים ה-pre-existing).

### רעיונות שנדחו
- **סקריפטים כפולים פר-PM** (`build:pnpm`/`build:bun`) — drift + על המשתמש לבחור. הבורר מסתיר את ה-PM.
- **החלפת `spawn("bun")` ב-`process.execPath`** — היה מפיל את ה-BE תחת pnpm/node (ה-bin חייב bun).
- **הסרת `packageManager: pnpm`/`engines`** — נשמר לתאימות dev; bun מתעלם מהם ב-`run`.

### runtime-gate (כלב) — GO 7/7 (light, commit 707105e)
אומת חי על bun-only: `fe:build` exit 0 · `start`→`/api/health` 200 · `dev`→BE+FE במקביל ·
`pm.test.mjs` 25/25 · CLI `run-filter core build` exit 0 · i18n נקי. אפס רגרסיות מהסלייס.
מסלול pnpm/npm לא-נבדק כאן (אין node/pnpm על השרת) — לאימות-parity על מכונת-dev.

### 🆕 follow-up שנגזר (blocker נפרד, out-of-scope) — `bun-types-web-api-gap`
`bun run build`/`typecheck` יוצאים code 1 בגלל שגיאות tsc ב-backend (`http-proxy.ts` +
`http-tts-capabilities.ts`): `Property 'ok'/'json'/'body'/'set'/'delete'/'signal' does not
exist on 'Response'/'Headers'/'Request'`. שורש: `packages/backend/tsconfig.json` `"types":["bun"]`
+ `@types/bun@1.3.14` עם Web-API types חלקיים. **לא נגרם ע"י סלייס-הסקריפטים** (git: אף אחד מ-3
ה-commits לא נגע בקבצים; ה-FE כן נבנה תחת אותו `bun run build`). זהו החלק הלא-גמור של שכבת
ה-bun-native-install (הטייפים), נפרד מהסקריפטים. תיקון מוצע: שדרוג `@types/bun` / augment
ל-`lib.bun.d.ts` / הוספת `"dom"` ל-`lib`. **מרדכי: להפוך ל-brief נפרד לפני שסומכים על `bun run build`
המלא על השרת.**

## 2026-07-07 — slash-menu-native + native-select-parity: תיקון-כיוון (B ל-slash, C ל-select)

### רקע
אחרי ה-preview שהמשתמשת אישרה, היא ביקשה **native-select parity מלא**: scroll-into-view בניווט-חיצים
(ה-selected יוצא מהתצוגה — באג), Home/End/wrap-around, ARIA, ורמזי-ארגומנט **גם ב-input** (ghost כמו CLI).
בחירה ראשונית: **C** (מעבר מלא ל-bits-ui).

### הממצא ששינה כיוון
`bits-ui` (^2.18.1, כבר בפרויקט) חושף `Command` (cmdk-port) + `Combobox` + `Select`. **אבל** `Command`
מיועד ל-**standalone**: `Command.Input` **חובה** ל-search, keyboard-nav עובד **רק כשה-focus עליו**, ו**אין**
`searchValue` חיצוני על `Command.Root` (אומת ב-`types.d.ts` + docs הרשמיים). ה-slash menu לעומת זאת הוא
**inline-autocomplete בתוך ה-textarea הקיים** (המשתמש מקליד `/co` ב-textarea, לא ב-input נפרד) → כפיית
`Command` = `Command.Input` מוסתר-מסונכרן + keyboard-forwarding imperative = **hack, לא C נקי**.

### ההכרעה — כלי לכל מקרה (אותה מטרה: native parity)
- **`ui/Select` הרוחבי** (צרכנים: VoicePicker · GeminiVoicePicker · LanguageSelect · PalettePicker ·
  SessionOptionsPanel · SettingsScreen — כולם על bits-ui `Dialog`/`Popover` + רשימת-`{#each}` custom, **בלי**
  keyboard-nav) → **C: bits-ui `Select` primitive**. סלייס `native-select-parity` (רוחבי, מתקן 6 צרכנים).
- **slash menu** (inline) → **B: scroll-into-view + Home/End/wrap + ARIA `listbox`** על ה-`<ul>` הקיים.
  אותה native parity בדיוק, בלי primitive זר.

### מבנה `slash-menu-native`
Commit 1: keyboard (Home/End/wrap) + scroll-into-view + ARIA listbox roles. Commit 2 (**מבודד, קל-revert**
לבקשת המשתמשת): ghost-hint ב-input (rendered רמז-ארגומנט אחרי בחירת פקודה, כל עוד לא הוקלד ארגומנט).
base = worktree `slice/slash-commands` @ `abb0b78` (טרם merge — לא ממזגים ואז מחליפים).

### נדחה
- **C אחיד** — נדחה: `Command` לא מתאים ל-inline-textarea-autocomplete (Input חובה, אין external keyboard).
- **enum-cycling** (#2, מעבר עם חיצים בין `[low|medium|…]`) — future: parsing של format ה-hint שביר ולא-סטנדרטי.

## 2026-07-07 — slash-commands: ביצוע הבסיס (GO×2) + ממצאי `slash-commands-typed` + הרחבת `hint`

### רציונל — הבסיס בוצע ואומת
`slice-slash-commands` (brief מ-2026-07-04) בוצע: 3 commits (VM receive `available_commands_update` · engine
`matchSlashCommands` טהור · dropdown `SlashCommandMenu`). FE-only, BE dumb-pipe. **calev GO×2** (12/12 + 13/13,
cross-check), **preview חי אושר ע"י המשתמשת**. אומת חי מול claude (57 פקודות) **וגם opencode (30)** — סתירה
להנחה הישנה ב-roadmap ("opencode ללא פקודות"). base=dev @ `9faf62f`, טרם merge (ממתין להרחבת `hint`).

### סטיית-מימוש שאושרה — portal-to-body
ה-brief תיאר `position:absolute bottom-full` פשוט. בפועל ה-textarea יושב בתוך `.record-pane-inner` עם
`overflow:hidden` (אנימציית-קיפול הפוטר) → ה-dropdown נחתך ובלתי-נראה (נתפס חי: קיים ב-DOM, קליקים נופלים על
`.chat-scroll` מתחת). התיקון: **portal ידני ל-`document.body` + `position:fixed`** עם קואורדינטות
`getBoundingClientRect` — בורח גם מה-clip וגם מ-containing-block של `transform` ב-`BottomSheet` (מובייל).

### ממצאי `slash-commands-typed` — למה אין הבחנת-סוגים קלה (חסם-ידע מאומת)
המשתמשת ביקשה הבחנה ויזואלית בין **סקיל** לבין **פקודת-הרנס** (compact) ואחרים. חקירת הקלטת-wire אמיתית
(`29175b45-…-1781776443783.jsonl`, 47 פקודות) הראתה:
- **ה-`available_commands_update` מכיל רק `{ availableCommands, sessionId }`; כל פקודה בהקלטה = `{name, description, input}` בלבד.**
  **אין `type`/`category`/`source`** — זו העובדה החוסמת. ⚠️ דיוק: הסכמה (`zAvailableCommand`, SDK 0.21.1) **כן**
  מגדירה `_meta?: Record<string,unknown> | null` אופציונלי (גם על הפקודה וגם על `input`), אבל בהקלטה הוא **לא אוכלס**.
  ה-`_meta` הזה הוא **ה-vehicle הטבעי לגישה ג'** (fork-adapter שמזריק `source`/`kind` ל-`_meta` בלי לשבור את החוזה).
- **5 מקורות-פקודה ב-Claude Code** קורסים ל-shape האחיד הזה: (1) **פקודות-הרנס/built-in** (compact/context/usage/
  init/reload-skills/heapdump/security-review/insights/goal/schedule/team-onboarding — רצות מקומית, משנות מצב);
  (2) **סקילים** (`.claude/skills/`, agentic, model-invoked או /slash — 15 מזוהים ודאית ע"י `"Triggers when user
  mentions"` בתיאור); (3) **custom commands** (`.claude/commands/`, prompt-md); (4) **MCP prompts** (`Svelte-MCP`);
  (5) **plugin commands**.
- **חתך שני שכן יש על ה-wire**: `input.hint` — 7 פקודות מקבלות ארגומנט (`compact`/`code-review`/`debug`/`simplify`/
  `batch`/`loop`/`design-sync`). זה נוצל ל-slice ה-`hint` (ר' למטה).

**שלוש גישות להבחנה (טרם הוכרע — נשמר ל-brief עתידי):**
1. **Heuristic על התיאור** (`"Triggers when"` → סקיל) — FE-only מיידי, אך **שביר** (תופס 15/? — סקיל בלי המחרוזת נופל שגוי).
2. **allowlist של built-in ידועים** — יציב יחסית, דורש תחזוקה כשאנתרופיק מוסיפה built-in.
3. **fork/הרחבת adapter** — לחשוף מקור מה-SDK דרך `_meta` (תבנית `claude-subagent-adapter-fork`); מדויק אך
   per-provider (opencode חושף אחרת) ודורש spike. **המלצה: spike קצר לבדוק אם `system.init.slash_commands`/SDK
   חושפים מקור לפני הכרעה.**

### רעיונות שנדחו (לעת עתה)
- **להבחין ב-heuristic לבד ולמזג מיד** — נדחה: false-classification של סקיל→פקודה מטעה משתמש. עדיף מקור מוסמך או allowlist.
- **לדחות את `hint` ל-typed** — נדחה: ה-`hint` כבר על ה-wire (אפס-מחקר), משלים את ה-dropdown, ולא תלוי בהכרעת-הסוגים.

## 2026-07-05 — claude-subagent-adapter-fork (Slice A): fork שקוף שחושף פעילות תת-סוכן (brief READY, טרם dispatch)

> המימוש הקונקרטי הראשון של `provider-adapter-split` (למטה). Slice A בשרשרת → B `subagent-nested-bubble` (renderer FE, טרם brief).

### רציונל

ה-adapter `claude-agent-acp` **זורק בכוונה** את כל פעילות תת-הסוכן: `break` על `system/task_{started,notification,progress,updated}` + סינון `text`/`thinking` של הודעות subagent ("keep dropping so subagent prose doesn't leak into the top-level feed"). המבנה קיים במלואו על ה-wire (אומת מול `provider-contract/PROTOCOL.md`: task lifecycle + subagent attribution `subagent_type`/`task_description`/`parent_tool_use_id`, 704×) — ה-adapter פשוט לא מעביר אותו. שדרוג לא פותר (זהה 0.52→0.55, התנהגות upstream מכוונת). **הפתרון: fork שקוף.**

### הכרעות-עיצוב

1. **אפס-זריקה (הנחיית משתמשת)** — ה-fork לא מקבל החלטת-תצוגה; מעביר raw ב-`_meta.claudeCode`, וה-FE/`provider-contract` בורר. scope = **שתי נקודות** ב-`src/acp-agent.ts`: (א) task_* → `tool_call_update` עם `_meta.claudeCode.task=frame` (במקום `break`); (ב) הסרת ה-filter של subagent prose.
2. **הסרת ה-filter מספיקה** (הגילוי שחסך שינוי שלישי) — `toAcpNotifications` **כבר** מצמיד `_meta.claudeCode.parentToolUseId` (string-path @4864 + array-path @5123), אז ה-prose יגיע מתויג-parent בלי לזהם את ה-feed הראשי (ה-gates של `parent===null` נשארים).
3. **envelope = `tool_call_update`** על `tool_use_id`, בלי `status` — תבנית `terminal_output` (לא `tool_progress` שנושא status). SDK 1.1.0 מאשר `status` optional; ובפועל ה-BE כבר מקבל status-less tool_call_update מ-terminal_output ועובד.
4. **repo נפרד** — Slice A מתבצע ב-`MusiCode1/claude-agent-acp#drive-coding` (sync מ-v0.55.0), נצרך כ-github-dep עם `"prepare":"npm run build"` (תבנית codex-acp). חיבור drive-coding = scope של Slice B.

### ממצאי אביגיל

**r1 USABLE-AFTER-FIX** (3 findings, כולם תוקנו): 🔴 ה-skeleton החסיר את 4 השכנים (`hook_*`/`files_persisted`) שחולקים `break` יחיד עם ה-task_* → silent regression; תוקן להצגה מפורשת · 🟡 הפניה שגויה ל-`tool_progress` (נושא status) → שונתה ל-`terminal_output` · 🟢 Q1 (status חובה?) נסגר: SDK 1.1.0 optional. **r2 READY, 0 findings** — כל התיקונים אומתו מול upstream v0.55.0 (SHA `6e01792`); ה-caution על SDK 1.0.0 vs 1.1.0 נוטרל (upstream עצמו פולט status-less tool_call_update שעובד ב-BE).

### אימות (אליעזר + כלב) — ✅ בוצע ואומת GO

**בוצע** ב-`@vendor/claude-agent-acp` (branch `drive-coding`, 4 commits מ-v0.55.0, נדחף ל-`origin/drive-coding`): **2 hunks בלבד** ב-`acp-agent.ts` (כפי שהובטח), 5 tests חדשים TDD. **כלב runtime-gate GO 7/7** (light) — אימת עצמאית מול baseline v0.55.0 נקי: build/lint/tests ירוקים; 2 failing tests = pre-existing (path-sep Windows, זהים ב-baseline); prettier-fail = CRLF artifact (`--end-of-line auto` נקי בקבצים ששונו). **הסטייה** (עדכון test 'leak') אומתה תקינה: ה-gate `if(parentToolUseId)` מתייג רק `parent≠null`; regression-test חדש מאשר ש-top-level (`parent===null`) נשאר `undefined` → אין זיהום.

**מבנה ה-`_meta` הנעול ל-Slice B**: task_* → `tool_call_update{toolCallId: tool_use_id ?? task_id, _meta.claudeCode.task: <raw frame>}`; subagent prose → `agent_message_chunk`/`agent_thought_chunk` עם `_meta.claudeCode.parentToolUseId`. **לא מוזג** (A חי ב-fork, נדחף; drive-coding יצרוך ב-Slice B).

### smoke חי מקצה-לקצה + `forwardSubagentText` (2026-07-06)

**smoke חי** (worktree `subagent-smoke`: github-dep→claude אמיתי דרך `connectInProcess`, live-test): אימת מקצה-לקצה — build-on-install ב-Windows (`prepare`→`dist`), ה-fork עם השינויים, ה-BE dumb-pipe מעביר `_meta`, task_* passthrough חי (כולל `toolCallId: tool_use_id ?? task_id` על `task_updated`), zero-leak חי (0 frames עם parent על top-level).

**גילוי מכריע**: ב-**SDK query mode** (איך ש-drive-coding מריץ claude) claude שולח מתת-הסוכן **רק** `tool_use`/`tool_result` — לא `text`/`thinking` (שחוזרים רק ב-`task_notification.summary`). זה **שונה** מ-VS Code captures (`provider-contract/research-assets`, 32.5k frames) שבהם subagent שולח גם `text` (59×) ו-`thinking` (122×). ההבדל אינו bug אלא **query option**.

**השורש**: `forwardSubagentText` (SDK query option, `@anthropic-ai/claude-agent-sdk` 0.3.198). default `false` → רק tool_use/tool_result (heartbeat); `true` → full subagent conversation (text+thinking, tagged `parent_tool_use_id`) לרינדור nested transcript.

**הכרעה — config, לא convert** (נגזר משאלת-משתמשת "לאיזה ענף?"): `forwardSubagentText` הוא **query option**, לא שינוי-תרגום. ה-adapter כבר עושה `...userProvidedOptions` (מ-`_meta.claudeCode.options`, שורה 3583/3623). לכן הוא **לא שייך ל-fork** — drive-coding מזריק אותו כהגדרה (`injectForwardSubagentText` ב-`connect-in-process`, תאום מדויק ל-`injectModelOverride`). כך ה-fork נשאר **2-commits רזה** (convert בלבד, כפי שכלב אימת — אין re-verify), וה-config חי ב-drive-coding: פחות סחף מול upstream, ניתן-לשליטה. תואם `provider-adapter-split`.

**אומת חי**: עם ה-injection (config-path), `proseFrameCount` עלה מ-2 (tool בלבד) ל-**4** (tool + `agent_message_chunk` מקונן) — subagent prose זורם עם `parentToolUseId`, **זהה בדיוק** ל-hardcoded-ב-fork. Commit 2 (הסרת filter) **מוצדק**: הוא מעביר את ה-text/thinking כשה-flag גורם להם לזרום.

**Slice B מפוצל** (הכרעת-משתמשת "transcript בתוך הבועה" — ה-transcript חי כמערך פנימי בבועת-Task, לא כעץ ב-`bubbles` הראשי → הווירטואליזציה השטוחה נשמרת):
- **B1 `subagent-transcript-data`** (data layer) — Commit 0: github-dep (pin `d6891f8`) + `injectForwardSubagentText` (כתוב+מאומת חי ב-worktree); Commit 1-3: קריאת `_meta.claudeCode` ב-`#onSessionUpdate` (היום מושמט) + `subFrames?`/`task?` additive + `#routeToSubFrames` (mini-dispatch, object-replacement) + task-merge בתוך `#handleToolCallUpdate`. **אביגיל READY r2** (r1: 2×🟡 confusion — task-meta רוכב על `tool_call_update` [early-return :1508] → merge בתוך `#handleToolCallUpdate`; reuse-push לא מצית reactivity → mini-dispatch). Complexity 7/light. **טרם dispatch.**
- **B2 `subagent-transcript-render`** (renderer FE — אזור-נגלל בבועה, `max-height`+overflow, task-summary, sticky-bottom-בריצה) — calev-heavy, טרם brief.

### רעיונות שנדחו

**opencode באותו slice** — נדחה: opencode **משטח** (desk-research) ל-`tool_call` יחיד (`kind:think`), subagent ב-session נפרד, רק output חוזר — אין קינון ב-wire. דורש spike חי + אולי fork עמוק ל-opencode; מופרד. **normalize ב-fork** — נדחה לטובת passthrough דק + נירמול ב-`provider-contract` (רזה לרבייס מול upstream).

## 2026-07-05 — provider-adapter-split: בידוד spawn↔convert ב-claude adapter + fork לחשיפת sub-agent (כיוון ארכיטקטוני, טרם brief)

> נגזר משתי משימות שהתלכדו: (א) "סידור תצוגת קריאות-סוכן (sub-agent/Task)" — התגלה שה-adapter **זורק** את פעילות תת-הסוכן בכוונה; (ב) הנחיית-משתמשת לבודד את שכבת ההשרצה משכבת ההמרה ולהשתחרר מהבינארי המבונדל. מרחיב את `claude-executable-from-specs` (למטה) מ-workaround-נקודתי לכיוון-מבנה.

### רציונל

היום claude רץ in-process: `connect-in-process.ts` מייבא `ClaudeAcpAgent` (ה-adapter = **שכבת ההמרה**, frames↔ACP) ומחווט כל method ידנית; ה-adapter תלוי ב-`@anthropic-ai/claude-agent-sdk` (= **שכבת ההשרצה**) דרך `query()`. הגבול spawn↔convert **לא מבודד** — ה-adapter מוזמן inline, וה-SDK מוסתר בתוכו. הכוונה: לצרוך מה-adapter **רק** את קוד ההמרה כלוגיקה טהורה, ולשלוט/לכתוב-מחדש את שכבת ההשרצה אצלנו.

### ממצאים מרכזיים (אומתו בקוד)

1. **הבינארי המבונדל** — `claude-agent-sdk` מבנדל את ה-CLI `claude` השלם ב-`$bunfs` (`manifest.json`: **~220-240MB × 8 platforms**), ו-`extractFromBunfs.js` מחלץ ל-tmpdir בזמן ריצה ומריץ כ-subprocess. **דלת-מילוט**: `pathToClaudeCodeExecutable` / `CLAUDE_CODE_EXECUTABLE` → CLI חיצוני, עוקף חילוץ (זה בדיוק ה-workaround של `claude-executable-from-specs`).
2. **שני מנגנוני-spawn נפרדים** — spawn של ה-BE (`spawn-core`/`connectSpawn`, ל-opencode/gemini) ש-claude **לא** עובר בו; ו-spawn **נסתר בתוך ה-SDK** שמריץ את בינארי-claude. ה-kill-tree של `slice-be-shutdown-hardening` מכסה רק את הראשון — בינארי-claude מנוהל בתוך ה-SDK/adapter.
3. **הבעיות נופלות לפי הקו** — *שכבת השרצה/lifecycle*: hang (event-loop block, שורש לא אותר → `be-hang-supervisor`), port-not-released (kill-tree), NBug2 (4 מקורות-אמת → `AgentLifecycleManager`), F-4 (אין BE-buffering ב-reattach). *שכבת המרה*: warm-reattach (`initialize` כפול → `skipInitialize`), F-3 (נירמול frame חסר), **task_\*/subagent** (ה-adapter `break`-ים את כל אירועי ה-Task ומסננים text/thinking של תת-סוכן — `acp-agent.js` "keep dropping so subagent prose doesn't leak"; זהה ב-0.52.0 ו-0.55.0-האחרון → **התנהגות upstream מכוונת, שדרוג לא פותר**).
4. **fork קיים אך מנותק** — `MusiCode1/claude-agent-acp` (fork ציבורי, ~0.48, שבע גרסאות מאחור). היום ה-provider צורך את claude **מ-npm** (`^0.52.0`), בעוד codex כבר נצרך מ-fork (`github:MusiCode1/codex-acp#drive-coding`) — תבנית-חיבור מוכחת.

### שינוי-כיוון (סטייה מתועדת)

מסמך `multi-client-mux-design` קבע במפורש "להשאיר את `claude-agent-acp` npm `@latest`, ללא fork". החלטה זו **סוטה** מכך במכוון: כדי לחשוף sub-agent ולשלוט בהשרצה, fork הוא הכרחי (upstream לא יחשוף task_*). זו הכרעה חדשה, לא המשך העיצוב הקודם.

### מסלול מדורג (אופציות פתוחות — טרם נעול)

- **(א) מיידי/זול** — `CLAUDE_CODE_EXECUTABLE` → CLI מותקן. מבטל את חילוץ ה-240MB בלי fork. (= `claude-executable-from-specs`, כבר brief-READY.)
- **(ב) fork ל-adapter** — `MusiCode1/claude-agent-acp#drive-coding`: לחשוף task_*/subagent (למשל דרך `_meta`) + ידית ל-lifecycle של ה-child.
- **(ג) בידוד מלא** — להחליף את `query()` של ה-SDK במימוש-השרצה שלנו (spawn CLI חיצוני + stream-json), לצרוך מה-adapter **רק** convert; + `capabilities/normalize.ts` (נקודת-תרגום raw→normalized, כבר תוכננה ב-`provider-package-organization`).

### רעיונות שנדחו

**שדרוג-גרסה כפתרון ל-sub-agent** — נדחה: 0.55.0 (האחרון) זהה ל-0.52.0 בטיפול ב-task_*. **מודל process-per-agent/worker-threads** — נדחה (`be-shutdown-socket-health §"האם המודל"`): "אב יחיד → N צאצאים" לגיטימי; הכאב הוא היגיינת-תהליך, לא כמות צאצאים.

## 2026-07-05 — claude-executable-from-specs: claude in-process רץ על ה-executable המקומי (brief מאושר, טרם dispatch)

> נגזר מדיווח-משתמשת: claude מציג "Sonnet 4.6" בעוד ה-CLI המקומי הוא Sonnet 5. חקירה חצתה 4 שכבות עד שורש חד-משמעי.

### רציונל

claude רץ **in-process**: BE → adapter `@agentclientprotocol/claude-agent-acp@0.52.0` → `query()` של `@anthropic-ai/claude-agent-sdk@0.3.191` → spawn של `claude.exe`. **איזה** `claude.exe` נקבע ב-`acp-agent.js:2445`: `pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? (await claudeCliPath())`. ללא ה-env var → נופל ל-native binary **המבונדל** של ה-SDK (`claude-agent-sdk-win32-x64@0.3.191`, יודע רק Sonnet 4.6). המקומי (`~/.local/bin/claude.exe`, 2.1.200) יודע Sonnet 5.

**שורש ה"מוזרות"**: המשתמשת הגדירה `CLAUDE_CODE_EXECUTABLE` ב-`cli-specs.jsonc` תחת `claude.setEnv`, אבל `claude-env-override.ts` מזריק setEnv ל-`_meta.claudeCode.options.env` — ה-env של ה-**child**, לא של ה-BE. השורה 2445 קוראת `process.env` של ה-**BE**. שני ערוצי-env נפרדים → ההגדרה נכונה-ברעיון אך הלכה לערוץ הלא-נכון. הזרקה דרך `_meta...pathToClaudeCodeExecutable` גם לא תעבוד: השורה 2445 באה **אחרי** `...userProvidedOptions` ודורסת. הערוץ היחיד = `process.env.CLAUDE_CODE_EXECUTABLE` של ה-BE.

**ההכרעה**: `applyClaudeExecutablePath` (ב-`claude-env-override.ts`, claude-specific) מחיל את המפתח מ-`cli-specs` על `process.env` של ה-BE, מחוּוט ב-`connect-in-process.ts:145` (לפני ה-`query()`). אומת חי (workaround ידני עבד → Sonnet 5).

### הכרעת-עיצוב (הנחיית משתמשת)

הקוד claude-specific → **חייב לחיות במסלול claude** (`claude-env-override.ts`/`connect-in-process.ts`), **אפס נגיעה בקוד הכללי** (`server.ts`/`cli-config`/`connection-registry`). whitelist מפתח-בודד: **רק** `CLAUDE_CODE_EXECUTABLE` — דחיפת כל ה-`setEnv` ל-`process.env` תדליף `NO_PROXY` ותשבור את ה-TTS proxy.

### ממצאי אביגיל

r1 **READY** (3 findings דיוקי-נוסח, תוקנו): 🟡 `registerHttpOptions` מחזיר `void` (ה-`{models,projects,homeDir}` הוא גוף `c.json` של ה-route) · 🟡 ה-DoD החי נשען על ה-cli-specs.jsonc ה**מקומי** (`~/.config`), לא `deploy/` שב-repo · 🟢 Commit 2 מוחק ~5 טסטים (קבוצה, לא בודד). אומתה השורה 2445 והסדר מול `...userProvidedOptions`, וש-connect-in-process:145 קודם ל-`query()`.

### רעיונות שנדחו

**גשר גנרי `cli-specs→process.env` בקוד הכללי** — נדחה: מפר את containment ה-claude-specific + סיכון-`NO_PROXY`. **הזרקה דרך `_meta.claudeCode.options.pathToClaudeCodeExecutable`** — נדחה: נדרס ע"י 2445. **עדכון `MODEL_FALLBACKS`** — התגלה כ-dead code (אף צרכן FE ל-`ServerOptions.models`); מסומן למחיקה (Commit 2), לא לתיקון.

## 2026-07-04 — claude-session-title: פענוח מנגנון הכותרת (`generate_session_title`)

> נגזר מהבאג "‏חזרה-לסשן-חי מאפסת title" (`attachToLiveAgent:921`). התרחב לפענוח **מלא** של מנגנון כותרת-הסשן של claude — עם capture חי כראיה.

**הפענוח**: ה-title של claude מגיע כ-`generate_session_title` **control_request** — ערוץ ה-control-protocol של Claude Code SDK, **לא** ACP (‏לא `session/update`, לא transcript, לא `session/load`). חמש עובדות מאומתות: (1) ה-**client יוזם** (‏claude לא דוחף); (2) ה-`description` = **ההודעה הראשונה** של המשתמש מילה-במילה (‏claude רק מלטש→title); (3) נשלח אחרי ~3 turns; (4) **`persist:boolean`** הוא מנגנון-השמירה היחיד (‏**אין** `set_title` נפרד) — false→ה-client שומר, true→claude שומר; (5) drive-coding **אף פעם לא שולח** את הבקשה → אין title live → נופל ל-`session/list` flaky → `attach` אפילו מאפס.

**איך פוענח**: כלי-tap (`claude-protocol-wrapper`, שהמשתמשת יצרה ב-ClaudeCodeACP והושתל ל-`packages/provider/tools/`) לכד את ה-stdio של claude. ה-frame: `control_response.response.title = "ניסיון תקשורת"` (‏מ-description `"ניסוי תקשורת."` = ההודעה הראשונה).

**ההכרעה**: `slice-claude-session-title` — **persist=true** (‏title first-class, שורד attach/reload) + תיקון attach. **spike-מקדים חוסם**: איך שולחים control_request דרך ה-stack (`claude-agent-acp`→SDK: API קיים / fork). ר' `docs/investigations/2026-07-04-claude-session-title-mechanism.md`. **כלי-לוואי נלווה**: `packages/provider/tools/claude-protocol-wrapper.cjs` (‏debug-tap, passthrough).

## 2026-07-04 — slash-commands: השלמת פקודות-Slash (brief מאושר, טרם dispatch)

### רציונל

‏פקודות-Slash (`/commit`, `/code-review`...) ‏היו מסומנות ב-roadmap כ-"0% ‏תשתית, ‏תלוי
‏Track A (‏משטח-חוזה)". ‏חקירה הראתה שההנחה **‏התיישנה**: ‏מאז reabsorb ‏של `packages/provider`
‏ל-monorepo, ‏משטח-החוזה מקומי, ‏ו-ACP SDK (‏גם 0.21.1 ‏שה-FE ‏משתמש בה) ‏**‏כבר חושף**
‏`available_commands_update` ‏עם `AvailableCommand[]`. ‏שלוש הכרעות עיצוב:

1. **‏צד-קבלה בלבד חדש** — ‏מראה 1:1 ‏את `acp-mode-config-sync` ‏(‏שהיה VM-only). ‏ה-BE
   ‏dumb-pipe ‏מעביר את ה-variant ללא שינוי; ‏ה-handler החדש ב-`#onSessionUpdate` ‏לפני ה-gate.
2. **‏הפעלה = ‏טקסט-prompt רגיל** — ‏`AvailableCommandInput` ‏הוא unstructured ("‏כל הטקסט
   ‏אחרי שם-הפקודה"), ‏ו**‏אין** ‏method ייעודי ב-SDK. ‏לכן `sendPrompt("/name args")` ‏הקיים
   ‏מספיק — ‏**‏אפס שינוי BE/‏חוזה**. ‏זו הכרעת ה-de-risking המרכזית.
3. **‏גייטינג על `availableCommands.length`, ‏לא על ה-capability** — ‏דגל
   ‏`NormalizedCapabilities.commands` ‏מקובע `false` ‏בכל מקום (‏מעולם לא חווט); ‏גייטינג עליו
   ‏= ‏פיצ'ר-מת. ‏האות האמיתי הוא אורך הרשימה בזמן-ריצה.

‏מבנה: 3 ‏commits — VM receive (TDD) · engine `matchSlashCommands` ‏טהור (TDD) · dropdown
‏השלמה ב-`TypeArea` (browser). Complexity 5/light.

### ‏עיגון בהקלטת-אמת

‏הקלטת-wire קיימת (`data/wire-recordings/_pre-test-archive/29175b45-...jsonl`) ‏הוכיחה חי:
‏claude ‏פולט `available_commands_update` ‏**‏מיד עם פתיחת הסשן** (‏לפני כל prompt), ‏עם **47
‏פקודות**, ‏שמות mixed-case (`Svelte-MCP`), ‏ותיאורים רב-שורתיים ארוכים → ‏חייבים סינון
‏case-insensitive + ‏קיצור-תיאור + ‏רשימה נגללת. ‏codex ‏פולט אף הוא (‏אדפטר).

### ‏ממצאי אביגיל

‏r1 = USABLE-AFTER-FIX (3 ‏ממצאים): (#1) ‏שם-מתודת-האיפוס `#captureSessionConfig` ‏ולא
‏`#captureSessionState`; (#2) ‏ה-FE ‏משתמש ב-SDK **0.21.1** ‏ולא 1.1.0 (‏אך הטיפוסים קיימים
‏גם בה — ‏ההיתכנות שלמה); (#3) ‏ה-Enter-intercept ‏בלע גם Cmd/Ctrl+Enter. ‏כולם תוקנו.
‏r2 = **READY**. ‏הערות-ליטוש שנותרו (‏null-guards ב-strict-TS, ‏Shift+Enter, ‏מספר-שורת-import)
‏הוקשחו ב-pseudo-code כדי לחסוך לאליעזר confusion, ‏אף שאינן חוסמות.

### ‏שינויי-כיוון

- ‏**‏מ-"‏תלוי Track A" ‏ל-"‏FE-only"**: ‏ההנחה שהחוזה חוסם התבררה כלא-רלוונטית אחרי ה-cutover.
- ‏**‏finding #2 ‏מנע באג-ייבוא**: ‏ה-repo ‏מכיל *‏שתי* ‏גרסאות SDK (0.21.1 + ‏alias `acp-sdk-v1`
  ‏= 1.0.0 ‏ב-provider). ‏ה-brief מצמיד מפורשות ל-`@agentclientprotocol/sdk` ‏הרגיל.

### ‏רעיונות שנדחו

- ‏**‏spike נפרד ל-wire** — ‏מיותר: ‏הקלטות-אמת + ‏קוד-האדפטר סיפקו את העדות הסטטית.
- ‏**‏slice נפרד ל-receive** — ‏אין לו משטח-אימות (‏אין UI); ‏אוחד ל-commit 0 ‏בתוך slice אחד.
- ‏**‏gating על `supports.commands`** — ‏דגל מת (‏ראה רציונל §3).
- ‏**‏רינדור `input.hint` ‏כ-form מובנה** — ‏future; ‏MVP ‏מציג תיאור + ‏token טקסטואלי.

## 2026-07-04 — image-paste: השלמה + תיקון replay (איבוד-שקט של ContentBlocks לא-טקסטואליים)

> image-paste (Commits 0–4) הושלם, אומת (calev-heavy GO 12/13), reconcile מול dev v0.10.1. **לפני merge — המשתמשת תפסה חי באג replay:** תמונה שנשלחה נעלמה בטעינה-מחדש של הסשן.

### רציונל — למה תיקון-במקום ולא merge+follow-up
הבאג הוא **בשלמות הפיצ'ר עצמו**: שולחים תמונה (עובד) → טוענים מחדש → נעלמת. לא מקרה-קצה. פיצ'ר "שלח תמונות" שהתמונות נעלמות בו בטעינה = לא-גמור. לכן fix-in-place באותו worktree, re-verify, ואז merge.

### השורש (מיפוי-פרוטוקול)
`#handleSessionUpdate` ב-`agent-session.svelte.ts:1527-1528`: `const text = update.content?.type === "text" ? ... : ""` ואז `if (!text) return`. ה-gate הזה שומר **רק** `text` ומפיל בשקט **4 מ-5** ה-`ContentBlock` של ACP: `image` · `audio` · `resource_link` · `resource` (embedded). חל על **שלושת** ה-chunks שאחריו: `agent_message_chunk` · `agent_thought_chunk` · `user_message_chunk` (replay מ-`session/load`). זה סוג-הבאג המסוכן: **איבוד-מידע שקט**, בלי שום סימן.

### ההכרעה (אושר ע"י המשתמשת)
1. **`image` — תמיכה מלאה עכשיו** (בסלייס image-paste): רינדור ב-`user_message_chunk` דרך `attachments[]` (התשתית + ה-render של `UserBubble` כבר קיימים מ-Commit 3), קיבוץ לפי `messageId` כמו הטקסט.
2. **placeholder ל-audio/resource_link/resource** — במקום היעלמות שקטה. סוגר את **מחלקת-הבאג** בעלות זעירה, בלי renderers ספקולטיביים.
3. **אין "תמיכה מלאה בכל ה-union" בסלייס הזה** — נמנע: (א) פותח מחדש סלייס-מאומת; (ב) audio/resource דורשים UI+מודל חדשים; (ג) **אין producer** לבדוק audio/resource-in-message → כלב לא יכול לאמת (עיוור); (ד) `resource_link` חוסם על אבטחה (`local-file-proxy`).

### הבחנה שהכריעה את התכנון (חידוד המשתמשת) — embedded ⊥ link
- **`resource` (embedded)** = **self-contained**: התוכן ב-frame (`text` או `blob` base64). **לא דורש proxy** — כמו image, הנתונים גולמיים ב-wire. ⇒ תמיכה חלקית זמינה **עכשיו** → slice נגזר `message-embedded-content`.
- **`resource_link`** = רק `uri` (בד"כ `file://`) → הדפדפן ב-https לא יכול לטעון → **חייב** את `local-file-proxy` (LFI/path-traversal). ⇒ הרינדור-המלא שלו **מקופל לתוך** תוכנית ה-proxy; ב-image-paste מקבל placeholder בלבד.

### רעיונות שנדחו
- **"פשוט לתמוך בהכל" עכשיו** — נדחה: 4 מיני-פיצ'רים עם עלויות שונות (מודל+UI+אבטחה+producer), לא שורה אחת. מפרק ל: image (עכשיו) · embedded-resource (slice מיידי) · resource_link (proxy) · audio (slice כשיהיה producer).

### עדכוני-roadmap
image-paste → 🟢 הושלם-ממתין-merge (כולל תיקון replay); **נוסף** `message-embedded-content` (base=dev אחרי image-paste, ~6); `local-file-proxy` → מקפל את `resource_link` המלא.

## 2026-07-04 — ui-session-polish: באטש של 5 תיקוני-ממשק קטנים

> חמש בקשות-משתמשת שנתפסו בשימוש, מקובצות ל-slice אחד קליל (‏Complexity 5/10, ‏calev light): (1) פס-גלילה-רפאים בפרומפט; (2) כותרת-סשן מלאה (‏מעבר-שורה); (3) כפתור העתקת-מזהה-סשן; (4) אזהרת-יציאה שלא תקפוץ כשאין תור פעיל; (5) `LoadingModal` עם ספינר לשימוש-חוזר, מחווט לטעינת-סשן.

**רציונל / למה באטש**: כל החמישה **FE + `core/i18n` בלבד** — אין BE/contract/streaming, רגרסיה נמוכה (‏הכל additive), וזול לאמת יחד. תלות: אין (‏base=dev). שורשים שאותרו לפני כתיבת ה-brief (‏3 סוכני-חקירה): פס-הגלילה = **שארית ב-autogrow שכבר מוזג** (‏`overflow-y:auto` קבוע + אי-התאמת `line-height:1.25rem` מול `1.5em` בחישוב ה-`max-height`); fix4 = ה-guard משתמש רק ב-`bypassActive` בלי לבדוק `turnState` → מזהיר גם ב-idle; fix5 = **אין** רכיב-מודאל גנרי ולא ספינר — נבנה חדש מעל שלד bits-ui של `FolderPickerDialog`, `open` נגזר מ-`session.status === "connecting"` (‏אין state חדש).

**החלטות-מפתח**:
- ‏**fix3 (‏copy-id)** — כרטיס-הסשן הוא `<button>` שלם → כפתור-copy מקונן = HTML לא-תקין. נבחר **sibling ממוקם absolutely** ב-`<div class="relative">` (‏במקום לשנות את הכרטיס ל-`div role=button`), עם `e.stopPropagation()` כדי לא להפעיל `onSelect`.
- ‏**fix5 (‏mount)** — mount יחיד ב-`AppShell` (‏מכסה switch/load/new בתוך-האפליקציה). מסך-connect **לא** נעטף — כבר יש לו חיווי inline (`connect.submitting`). הרכיב נבנה prop-driven (`open`/`label`) לשימוש-חוזר עתידי, אבל מחווט רק שימוש אחד (‏טעינת-סשן).

**ממצאי אביגיל — ‏3 סבבים, ‏והלקח המתודולוגי**:
- ‏**r1 (‏שם `ui-polish-batch`)**: READY, 2 findings 🟢. איתרתי גם התנגשות-שם עם slice ישן (‏06/18) → **שיניתי שם ל-`ui-session-polish`**.
- ‏**r2 (‏אחרי rename + קיפול ממצאים)**: **USABLE-AFTER-FIX** — תפסה ש**החיזוק שאני קיפלתי מ-r1 היה שגוי**: r1 טענה ש-`@keyframes spin` "‏רק ב-MicLarge", ואני הפכתי את זה להוראה "‏הוסף ל-app.css". r2 בדקה לעומק → `@keyframes spin` **כבר קיים ב-`app.css:296`** (‏+ Tailwind v4 auto-inject). ביטלתי את ההוראה השגויה. + תיקון line-ref ל-`beforeunload` (39-43 לא 39-44).
- ‏**r3**: READY, 0 findings.
- ‏**הלקח**: אל תסמן plan-verified מכותרת-ה-result; re-run **אחרי עריכה** שווה את הזמן — הוא תפס טעות-עובדתית שאני הזרקתי בתום-לב מקיפול headline של סבב קודם. (‏מחזק את ה-anti-pattern "‏להחליט על finding מכותרת בלבד".)

**רעיונות שנדחו**: (‏א) כותרת wrap בלתי-מוגבל → `line-clamp-2` (‏עקבי עם `header-title-responsive`, רשימה מסודרת); (‏ב) שינוי כרטיס-סשן ל-`div role=button` → sibling-absolute פחות-פולשני; (‏ג) extract של `<Modal>` shell גנרי + refactor הדיאלוגים הקיימים → future (‏fix5 רק **מוסיף** רכיב); (‏ד) חיווט LoadingModal גם למסך-connect → מיותר (‏כבר יש inline feedback).

## 2026-07-04 — proxy-tap-memory: תיקון נפילת-OOM בנתיב Gemini TTS proxy

> נולד מ**נפילה חיה**: ה-BE (pid 29680) קרס בזמן proxy ל-Gemini TTS. אבחנה עם המשתמשת הפרידה שני אירועים שהתלכדו בלוג — (א) **הנפילה** עצמה, (ב) "סוכן שסגר שוב ושוב את המארח" (ירד מהשולחן — רק ההסבר למה הריצה נעצרה, לא הבאג).

**רציונל / אבחנה**: התהליך **מת** (`tasklist` ריק) — crash אמיתי, לא hang. ה-listen-socket שנשאר על 4000 היה שריד **נפרד** (handle-inheritance → be-shutdown-hardening, לא הנפילה). **אין** `uncaughtException — exiting` בלוג → לא עבר דרך ה-JS handler ב-`server.ts` → crash ברמת ה-runtime (OOM/native), שהורג מיד בלי לתת ל-JS לרוץ. השורש אותר ב-`git log -S`: commit `76bb8b7` (slice `tts-usage-metering`, ב-dev) הוסיף בנתיב Gemini `res.body.tee()` + `readStreamInBackground` (full-buffer) — כדי לחלץ `usageMetadata` (כמה tokens) הוא צובר את **כל** ה-audio PCM בזיכרון.

**מה שהכריע — repro חי** (‏`bun 1.3.14`, לא רק ניתוח-קוד):
- ‏`tee()` עם ה-tap קורא בלי-לצבור + client לא-נצרך → RSS 67→**326MB**. כלומר **ה-`tee` של Bun לא מפעיל backpressure** — מבפר את ה-branch הלא-נצרך במלואו.
- ‏`TransformStream` peek עם client איטי → RSS 67→**86MB** יציב (`produced≈clientRead`, client-paced).

**שינוי-כיוון (המהותי)**: התוכנית הראשונה הייתה `drainWithCap` על ה-**tap**. ה-repro **הפריך** אותה — השורש אינו ה-tap-buffer אלא ה-**`tee()` עצמו** (מבפר את ה-client-branch ללא-תלות ב-tap). לכן ה-Commit המרכזי הוא **החלפת `tee` ב-`TransformStream` peek** (‏audio זורם client-paced, ה-tap מציץ inline ומחלץ usage ב-`flush`, zero-retain). ה-`drainWithCap` נשאר רק כרשת-ביטחון ל-cache-path.

**מבנה** (4 commits, אפס deps חדשים): (0) `createGeminiUsageAccumulator` ב-core — SSE line-frame + `TextDecoder({stream})` ל-utf8-boundary, TDD; (1) Gemini `tee`→`TransformStream`; (2) ElevenLabs cache `tee`→bounded-collector עם cap; (3) RSS watchdog + 503 degradation ("גרסה מספקת, נשפר בעתיד" — בקשת המשתמשת). ה-DoD המרכזי (§5.1) = **repro-under-load הפוך** (mock upstream ~256MB, client-שלא-קורא → RSS delta < 50MB), לא תלוי במפתח-Gemini-השרוף.

**ממצאי אביגיל** (r1 **READY**, 3 findings — הדוח לא נשמר פיזית, תמצית בלבד): 🟡 (1) ה-helper המשותף `parseGeminiChunkUsage` חייב להחזיר `GeminiUsage` המיוצא, לא `UsageMetadata` הפנימי-הלא-מיוצא → שולב ב-brief; 🟡 (2) סדר שני ה-tee בקובץ הפוך מסדר ה-commits (cache ~181 לפני Gemini ~234) → הובהר לפי שם-בלוק; 🟢 (3) `flush` לא-נקרא-ב-abort הוא **נסיגת-התנהגות מכוונת** (הקוד הנוכחי כן רושם usage חלקי ב-abort) — מקובל (fail-safe), מתועד ב-§6.

**רעיונות שנדחו**: (א) `drainWithCap` על ה-tap — לא נוגע בשורש (ה-repro); (ב) ring-buffer של N-KB-אחרונים — מנחש איפה הסוף, נחות מ-parse; (ג) dep `eventsource-parser` — הליבה (`extractGeminiUsage`) כבר קיימת ובדוקה, חסר רק line-framing (~10 שורות), ו-single-binary מעניש deps; (ד) disk-cache-LRU ובידוד-תהליכי-לסוכנים (claude in-process = blast radius) — הוצאו ל-scope נפרד לבקשת המשתמשת ("הדיסק פחות דחוף; מה שאפשר, מקס' נשפר בעתיד").

**‏memoryGuard (Commit 3) — החלטת-interim מודעת** (נדון 2026-07-04, בעקבות שאלת-המשתמשת "האם רץ בתוך התהליך? תמיד?"): ה-`memoryGuard` הוא **in-process** (`setInterval` 5s על `process.memoryUsage().rss`, `.unref()`), ולכן **הגנה חלקית בלבד** — תופס רק **טיפוס-הדרגתי** של RSS (מה שהפיל אותנו, לכן רלוונטי לסוג-הבאג), אך **נופל בשני התרחישים הקריטיים**: OOM-native (מת לפני שה-poll רץ) ו-event-loop-hang (ה-poll יושב באותו loop תקוע). **הוכרע להשאירו כרשת-משנית** (עלות זעירה, מתועד בקוד ככזה) ולא לממש עכשיו את הפתרון-המלא — לבקשת המשתמשת ("לא רוצה את זה עכשיו, רק תעד"). הפתרון האמיתי ל-blast-radius (**המארח + כל הסוכנים ה-in-process**) הוא **child-process supervisor** (parent שמנטר את ה-BE; שורד crash+hang; רואה RSS דרך OS/pid). ניתוח מלא (worker-thread שורד hang אך מת ב-crash · מול child-process ששורד את שניהם) **תועד להרחבת `be-hang-supervisor` ב-roadmap**; ה-`memoryGuard` הזה ייספג לתוכו כשיֵצא. שני ה-observations של calev (503 חוסם גם cache-hits · flush-לא-רץ-ב-abort) שייכים ל-Commit 3 ויתאפסו אם/כשהוא ייספג.

## 2026-07-03 — batch chrome/identity: app-title-build-env + cli-name-in-chat + rename re-verify

> באץ' של 4 בקשות-משתמשת "קוסמטיות למחצה": (1) כותרת `Drive Coding [Dev|Preview] • [סשן]` + 3 פרופילי-בילד; (2) סימן דורש-תשומת-לב בטאב כשמסיים (אופציונלי); (3) rename חבילת-FE; (4) שם ה-CLI במסך הצ'אט. נחתכו ל-4 slices (JIT), 3 מהם עברו אביגיל→READY בסשן זה; #2 (`tab-attention-notify`) נכתב אחרון (תלוי ב-app-title).

### app-title-build-env (בקשה #1)

**רציונל**: חצי מהתשתית כבר קיימת אך מנותקת — `FE_ENV` מוגדר ב-systemd (dev.service) אבל `vite.config.ts` קרא `FE_SOURCEMAP` ולא `FE_ENV` (הפער תועד ב-D3a, 2026-06-28). הסלייס סוגר את הפער ומרחיב מ-2 מצבים ל-3 (dev/preview/prod). המשתמשת חידדה: **שלושה בילדים אמיתיים** (גם dev), כותרת קשיחה ב-HTML שנטענת מיד עם ה-badge ואז מוחלפת בקוד לפי ההקשר (סשן/הגדרות/סשנים).

**הכרעות**:
1. **מיפוי**: dev+preview = source-maps + badge ("Dev"/"Preview"); prod = בלי source-maps + בלי badge. ה-staging unit עובר מ-`FE_ENV=dev` ל-`FE_ENV=preview` (ה-`vite dev` המקומי הוא ה-dev האמיתי; ה-tunnel הוא preview).
2. **מקור-אמת יחיד לכותרת** = `PUBLIC_APP_TITLE` (נגזר מ-FE_ENV ב-vite.config); גם ה-HTML וגם ה-runtime קוראים אותו → לא סוטים.
3. **overrides**: `FE_TITLE` (base) + `FE_SOURCEMAP` (source-maps) גוברים על FE_ENV.

**ממצאי אביגיל** (r1 USABLE-AFTER-FIX → r2 READY): כל 8 הטענות העובדתיות אומתו נכונות; אין blocker. הממצא המהותי (r1 #4): ה-crux — הזרקת-כותרת דרך vite `transformIndexHtml` + `define` — **לא-מאומת תחת SvelteKit**.

**שינוי-כיוון (המהותי בבאץ')**: בעקבות finding 4 בדקתי את קוד SvelteKit 2.60.1 המותקן ומצאתי ש-`transformIndexHtml` **אינו מובטח על `app.html`**, אבל `%sveltekit.env.PUBLIC_*%` **כן נתמך נייטיבית** (`@sveltejs/kit/src/core/config/index.js:33-35`). **המנגנון הוחלף** ל-placeholder נייטיבי (HTML) + `$env/dynamic/public` (runtime), כאשר vite.config מציב `process.env.PUBLIC_APP_TITLE`. Commit 1 מתחיל באימות-מנגנון מוקדם (TEST123) עם fallback (הצבה ב-build scripts).

**רעיונות שנדחו**: (א) vite plugin `transformIndexHtml` — לא מובטח על app.html ב-SvelteKit; (ב) `define`+global `__APP_TITLE_BASE__` — מיותר, `$env/*/public` נייטיבי ובטוח; (ג) מיגרציית `STORAGE_KEY="drive-coding-v2-settings"` — מחוץ ל-scope (מסכן אובדן-הגדרות; לא נתבקש).

### cli-name-in-chat (בקשה #4)

**רציונל**: ה-CLI הפעיל יושב ב-`#cliKind` פרטי ב-`agent-session`; אין getter ציבורי → בתוך הצ'אט אין אינדיקציה באיזה CLI עובדים. מיקום (בקשת המשתמשת): מעל סקשן "אפשרויות סוכן" ב-`SessionOptionsPanel`.

**ממצאי אביגיל** (r1 USABLE-AFTER-FIX → r2 READY): 🔴 `#cliKind` הוא שדה פרטי **לא-`$state`**, וה-VM הוא **singleton** (`+layout.svelte:72`) שהפאנל קורא בלי `{#key}` → getter רגיל לא-ריאקטיבי; ה-badge היה נתקע ב-CLI הראשון (רגרסיה שקטה — smoke יחיד היה ירוק, עלול לעבור calev).

**הכרעה (מרדכי, כי אביגיל ביקשה)**: הופכים את `#cliKind` ל-`$state`. **בטוח**: `CliKind` primitive (string|null) → signal בלי proxy; הקריאות ב-reconnect guards סינכרוניות ולא מושפעות. נדחה: שדה-מראה ציבורי נפרד (כפילות + סיכון-סנכרון). ההנחה השגויה המקורית ("remount של הפאנל מרענן") הוסרה מ-§6.

### frontend-rename-cutover — אימות-מחדש (בקשה #3)

**רציונל**: ה-brief אושר READY ב-25/06, אבל dev נסחף. הרצתי אימות-מחדש לפני dispatch.

**ממצאי אביגיל** (r2/r3 USABLE-AFTER-FIX → r4 READY): 🔴 **2 קבצים פונקציונליים חדשים** עם `--filter @drive-coding/frontend-v2` שלא היו ברשימת ה-4 המקורית: `packages/release/scripts/build-binary.mjs:56` (bun --compile) ו-`scripts/dc-build-fe.mjs:77` (build של systemd). בלי תיקון — ה-rename היה שובר את בניית-הבינארי ואת build-if-stale. בנוסף: `dc-launch.mjs` עבר refactor (אין בו יותר frontend-v2); רשימת docs-חיים 11→9.

**שינוי-כיוון**: רשימת Commit 1 הורחבה ל-5 קבצי-קוד (7 מופעים), docs ל-9. אישוש עצמאי ב-`git grep`. **לקח**: brief מאושר-בעבר חייב אימות-מחדש כש-base נסחף — התשתית (`dc-build-fe`/`build-binary`) נוספה *אחרי* האימות המקורי.

### tab-attention-notify (בקשה #2) — נדחה לסוף הבאץ'

**החלטה**: נכתב אחרון, `depends_on: [app-title-build-env]` (שניהם נוגעים ב-`document.title`). המשתמשת סימנה "אם מסובך אז לא עכשיו" → גרסה **קלה**: prefix ● בכותרת + badge ב-favicon כשה-turn מסתיים ו-`document.hidden`, ניקוי ב-visibilitychange. **בלי** OS-Notification (ה"מסובך").

## 2026-07-03 — claude-inprocess-cli-env: claude in-process מכבד cli-spec env (החרגת-Anthropic הצהרתית)

### רציונל
אחרי provider cutover v0.8.0 claude רץ **in-process** — ה-Claude Agent SDK מ-spawn את ה-claude CLI,
שיורש את `process.env` של ה-BE. תחת שער OneCLI זה מזריק `ANTHROPIC_API_KEY=<placeholder>` + proxy →
קריאת claude ל-`api.anthropic.com` מנותבת לשער ומחזירה **401** (הסוכן voice-acp בכוונה לא מקבל את סוד
Anthropic — מניעת שחיקת-יתרה). מנגנון ה-cli-spec (`unsetEnv`/`setEnv`) שכבר מעצב env ב-spawn-path
(opencode/codex, `spawn-core.ts:92-103`) **לא חל על ה-in-process** — `connect-in-process.ts` לא נוגע
ב-env כלל. הפער נסגר: connect-in-process יקרא `getCliSpec("claude")` (בדיוק כמו spawn-core) ויזריק את
ה-env דרך `_meta.claudeCode.options.env`.

### הכרעות
1. **ערוץ ההזרקה: `_meta.claudeCode.options.env`** (לא mutation של process.env). אומת ב-node_modules:
   `ClaudeAcpAgent.createSession` בונה `env: {...process.env, ...params._meta.claudeCode.options.env, ...}`
   — אותו נתיב שדרכו כבר מוזרק `model` (injectModelOverride). ה-SDK מעביר את זה ל-spawn **verbatim**
   (`initialize(): env:c=this.options.env`, בלי re-merge שני של process.env).
2. **unset ע"י ערך `undefined`** — נבדק אמפירית: Node משמיט מפתח env בעל ערך undefined ב-`child_process.spawn`
   (זהה ל-delete; לא הופך ל-`"undefined"`). מנגנון ה-SDK לא מ-zod-validate את env בנתיב זה (destructure ישיר).
3. **scoped לתת-תהליך claude בלבד → TTS בטוח.** `process.env` של ה-BE לא נגוע → ה-proxy של ElevenLabs/Google
   (TTS) נשאר שלם. זו הסיבה המרכזית לבחור בהזרקה-דרך-`_meta` על-פני ה-wrapper הישן ששינה את **כל** env ה-BE.
4. **החלה על כל 4 ה-handlers** (new/load/resume/fork) — כולם מגיעים ל-`createSession` דרך `_meta`;
   401 ב-reattach הוא UX גרוע. `injectModelOverride` נשאר רק ב-new (מחוץ ל-scope).
5. **שכבת provider** (connect-in-process צורך `getCliSpec` ישירות), לא הרחבת `drivecodingShapeEnv` (backend,
   שהוא ה-hook של ה-spawn-path ולא נצרך ב-in-process).
6. **retire ה-workaround → קונפיג מוצהר tracked**: `scripts/claude-direct-be.sh` (untracked) + עטיפת
   `ExecStart` ב-systemd מוחלפים ב-`deploy/cli-specs.jsonc` (tracked) + `Environment=CLI_SPECS_FILE=...`.
   דקלרטיבי, ב-git, ליד ה-unit; לא משפיע על dev מקומי.

### ממצאי אביגיל
r1 **READY** (3 findings, כולם 🟢, כולם שולבו): (א) `getOrCreateSession` על session חי עם fingerprint
תואם מחזיר מוקדם בלי createSession → env חסר-אפקט שם — **תקין** (env נחוץ ב-spawn הראשון בלבד; נרשם כמגבלה
ידועה §10). (ב) בלוק ה-env הוא שורות 2422-2428 (לא 2427) בגרסה 0.52.0 — תוקן. (ג) **`CLI_SPECS_JSON`
אינו נתמך ב-provider's `cli-config-file.ts`** (רק ב-mirror של ה-backend) → תוקן: טסט Commit 2 עובר
ל-`CLI_SPECS_FILE`+temp-file, וכל אזכורי CLI_SPECS_JSON כאלטרנטיבה הוסרו.

### שינויי-כיוון
נמצאה טיוטה מוקדמת של ה-brief שהשאירה את מנגנון-ההזרקה כ"לחקור בביצוע" (§9 Q1 🟡). החקירה בוצעה
**לפני** dispatch (מיפוי SDK מלא: createSession→query→spawn + בדיקת Node-undefined אמפירית) → כל השאלות
הפתוחות הוכרעו, ה-executor מקבל brief de-risked ללא חקירת-SDK תוך-כדי.

**✅ אימות end-to-end מלא על הקוד המוממש (טלפון/termux, 2026-07-03):** אחרי המימוש (calev GO 7/7), הרצנו את
ה-live test `connect-in-process.live.test.ts` (RUN_LIVE=1) על הטלפון תחת `onecli` עם **token-דמה מוזרק**
(תנאי ה-MiniPC), `CLAUDE_CODE_EXECUTABLE`=termux-claude. **ניסוי מבוקר**: (control) בלי `CLI_SPECS_FILE` →
`× prompt → claude responds` **timeout 60s** (dummy token → claude נתקע); (fix) `CLI_SPECS_FILE=deploy/cli-specs.jsonc`
→ `✓ prompt → claude responds with DRIVE_OK_5678` **3.3s, 4/4 passed**. אותו env בדיוק — ההבדל היחיד הוא
ה-cli-spec שהקוד קורא ומזריק דרך `_meta.claudeCode.options.env`. זה מוכיח **end-to-end** את **§8b** (ההזרקה
מגיעה לתת-תהליך claude — אחרת ה-fix לא היה עובד) **וגם §8c** (unset→OAuth). **שני ה-runtime-gates = GO.**

**אימות-התנהגות חי מוקדם (טלפון/termux, 2026-07-03, לפני מימוש):** ניצלנו OneCLI חי על הטלפון כדי לאמת את
התנהגות §8c **לפני** כתיבת קוד — `claude -p` הגולמי הוא אותו נתיב-auth של ה-claude שה-SDK מ-spawn (שניהם יורשים
אותו `process.env`; ה-SDK מוסיף `createEnvForGateway`=∅). תוצאות (עם token-דמה של Anthropic מוזרק ב-OneCLI, כמו
ה-MiniPC): **ברירת-מחדל** (key-דמה + proxy) → claude **נתקע** (timeout; מנסה-שוב מול ה-gateway); **התיקון**
(`env -u ANTHROPIC_API_KEY NO_PROXY=api.anthropic.com`) → **OK** (OAuth, EXIT=0). claude עצמו הדפיס:
*"connectors are disabled because ANTHROPIC_API_KEY … is set and takes precedence over your claude.ai login ·
**Unset it**"* — בדיוק מה שה-slice עושה. **מסקנות**: (1) הדימנשן הקריטי = `unset ANTHROPIC_API_KEY` (עם key ריק +
proxy דלוק claude כבר עבד — ה-gateway של הטלפון מנהרר OAuth בשקיפות); `NO_PROXY` **הגנתי** (מול gateway שעושה
MITM, אולי ה-MiniPC). (2) מצב-הכשל עם token-דמה אמיתי הוא **hang** (לא 401-נקי) — גרוע יותר ל-UX. (3) OneCLI של
הטלפון שונה מה-MiniPC (out-of-box בלי הזרקת ANTHROPIC_API_KEY). **נשאר לאימות פוסט-מימוש**: שהמנגנון שלנו
(`_meta.claudeCode.options.env`) מייצר את צורת-ה-env הזו בתת-התהליך → §8b (sinkhole).

**local mechanism-gate (הצעת המשתמשת, שולבה §8b):** ה-runtime-gate פוצל ל-3 שערים במקום אחד תלוי-deploy:
§8a קוד (בכל מקום) → **§8b מנגנון-חי מקומי** → §8c התנהגות-auth (deploy). §8b מוכיח שה-env המוזרק מגיע
לתת-תהליך claude ע"י משתנה-claude נצפה (`ANTHROPIC_BASE_URL` → sinkhole מקומי `scripts/claude-env-sinkhole.mjs`):
בקשה שנוחתת ב-sinkhole = ההזרקה עובדת, **בלי OneCLI/OAuth/שריפת-יתרה**, על כל מכונה עם claude. זה מוציא את
ליבת-האימות (האם ה-env מגיע ל-child) מהתלות ב-deploy — הופך את אימות-הקוד שלי לאישור-חי מוקדם. §8c (unset→OAuth
+ NO_PROXY-bypass מול OneCLI) נשאר deploy-only. (וריאנט B: `HTTPS_PROXY`→proxy-logger, נאמן-יותר אך מיותר.)

### רעיונות שנדחו
- **mutation גלובלי של process.env סביב ה-spawn** — נדחה: race עם קריאות-TTS מקבילות ב-BE + לא ניתן
  לתחום את חלון-המוטציה (ה-spawn קורה בתוך ה-SDK).
- **`CLI_SPECS_JSON` בתוך systemd `Environment=`** — נדחה: ה-provider לא קורא אותו; ובנוסף quoting של JSON
  ב-systemd שביר. `CLI_SPECS_FILE` → קובץ נקי מנצח.
- **הרחבת `drivecodingShapeEnv` + חיווט shapeEnv ל-in-process** — נדחה: connect-in-process לא צורך shapeEnv
  היום; הרחבה כזו גדולה ומיותרת. provider-contained פשוט יותר.

### תיאום merge
`dc-launch-version-check` (ההחלטה למטה) נוגע ב-`ExecStartPre` של אותם `.service`; סבב זה נוגע ב-`ExecStart`+
`Environment` — שורות שונות, conflict נמוך. מי שממזג שני — rebase טריוויאלי.

## 2026-07-03 — dc-launch-version-check: rebuild-FE-if-stale (version-aware) בכל נתיבי-ההרצה

### רציונל
אבחון חי בטלפון (termux): "אי אפשר לחזור לקודקס" + לולאת-סוקטים. השורש **לא** היה באג-קוד חדש —
הבאג עצמו (warm reattach שולח `initialize` חוזר ל-Codex → `Already initialized`) כבר תוקן ב-
`warm-reattach-skip-init` (v0.9.0, `d74ff49`). מה שנמצא: **התיקון לא הגיע לדפדפן בטלפון**. ה-`git pull`
עדכן את המקור, אבל ה-FE build שהוגש היה מ-Jul 1 (לפני התיקון) — כי כל נתיבי-הבנייה מדלגים על rebuild
"אם ה-build קיים", בלי לבדוק אם הוא **עדכני**. ראיה כרונולוגית ודאית: build מ-Jul 1 11:26 לא יכול להכיל
תיקון מ-Jul 2 19:35. תיקון-מיידי בטלפון: `pnpm --filter frontend-v2 build` ידני. תיקון-שורש: version-check.

### הכרעות
1. **בדיקת-הגרסה יורדת ל-`dc-build-fe.mjs`, לא ל-dc-launch** — אביגיל r1 תפסה 🔴: כבר קיים
   `scripts/dc-build-fe.mjs` (מוזג ב-`fe-build-decouple`) עם **atomic swap** (staging→build). ה-brief
   המקורי היה משכפל build **inline לא-אטומי** ב-dc-launch — כפילות שמתעלמת מה-pattern הקנוני. שכתוב:
   מצב חדש `--if-stale` ב-dc-build-fe עצמו (שם הבנייה כבר קורית אטומית), ו-dc-launch **מאציל** אליו.
2. **תיקון כל שלושת נתיבי-ההרצה, לא רק הטלפון** — אביגיל תפסה 🟡: אותו staleness חי גם ב-**systemd**
   (`voice-acp-{dev,main}.service` `ExecStartPre --if-missing`). ה-brief המקורי "תיקן את הטלפון" אבל
   השאיר את ה-deploys ל-linux תקועים. הכרעה: dc-launch + systemd ×2 + `package.json` script + doc
   כולם עוברים ל-`--if-stale`.
3. **השוואת string-מלא (semver + short-sha), לא semver-בלבד** — ה-sha כבר מוטבע ב-`build/_app/version.json`
   (`v0.9.0 (d74ff49)`, מיוצר ע"י `svelte.config.js` `kit.version.name`). השוואת המחרוזת המלאה חינמית
   וקולטת גם commit-שונה-באותה-גרסה, לא רק bump — היה תופס בדיוק את הבאג הזה. מחיר: rebuild (~60ש', אטומי →
   ללא downtime) על כל commit שנמשך. הנוסחה משוכפלת **מילולית** מ-svelte.config (מקור-אמת יחיד; הערת-drift בשני הקבצים).
4. **`--if-stale` flag חדש, `--if-missing` נשאר legacy** — לא משנים סמנטיקה קיימת; migrate את הצרכנים שלנו.

### ממצאי אביגיל
r1 **USABLE-AFTER-FIX** (4 findings: 🔴 inline-non-atomic-duplication מתעלם מ-dc-build-fe הקנוני;
🟡 סמנטיקת FE_BUILD_OUT [מקובע פנימית ל-`.build-staging`, לא knob]; 🟡 systemd staleness לא-מטופל; 🟢 ספירת-שורות).
→ שכתוב מלא → r2 **READY** (2 findings 🟢: doc `deploy-local-service.md` עדיין `--if-missing`; אי-עקביות
מספרי-שורות 12-22/14-22 — **שולבו** ב-brief). ה-🔴 של r1 הוא בדיוק סוג-הטעות שה-plan-gate נועד לתפוס:
brief שנכתב מהקוד שראיתי בטלפון, בלי לדעת שקיים כבר נתיב-בנייה קנוני חדש יותר.

### שינויי-כיוון
מ"תיקון inline ב-dc-launch בלבד" (r1) ל"version-check ב-dc-build-fe הקנוני + migrate כל 3 הצרכנים" (r2) —
בעקבות גילוי `dc-build-fe.mjs`. גם היקף גדל (1→3 commits) כי systemd נכנס.

### רעיונות שנדחו
- **rebuild רק כשקבצי-FE השתנו** (git diff paths) — over-engineering; SHA-compare על כל commit מספיק ופשוט.
- **semver-בלבד** — היה מספיק במודל bump-בכל-merge, אבל full-string strictly safer בחינם.
- **שדרוג סמנטיקת `--if-missing` הקיים** — מסכן callers; flag חדש נקי יותר.

## 2026-07-02 — tts-provider-availability + tts-usage-metering: השבתת-ספק-ללא-מפתח + מדידת-שימוש

### רציונל
שתי דרישות-משתמשת סביב מפתחות-ה-TTS: (א) להשבית ספק (ElevenLabs/Gemini) שאין לו מפתח תקף;
(ב) לספור קריאות/טוקנים ולהעריך עלות. שני slices עצמאיים (`depends_on=[]`, base=dev, שניהם additive
ב-`server.ts`), נכתבו לפי חקירה מלאה של שכבת ה-proxy.

### הכרעות
1. **זמינות = probe חינמי, לא בדיקת-env** — המשתמשת זיהתה שנתיב ה-OneCLI (מזריק מפתח *אחרי* ה-BE)
   שובר בדיקת-env: false-negative תחת OneCLI, ו-false-positive על מפתח-**שרוף** (ה-Gemini החסום שלה,
   `403`). הכרעה: ה-BE מריץ probe אמיתי (`GET /v1/voices` · `GET /v1beta/models`) דרך **אותו מסלול-auth**
   כמו ה-proxy (resolveProviderAuth + placeholder→OneCLI). ה-probe הוא ground-truth — עובד בשני המסלולים
   *ותופס מפתח-שרוף*. **ייתר את הכפיית env-dummy** שהמשתמשת הציעה כ-plan-B.
2. **ספירה ב-choke-point (BE proxy), מדויקת** — `http-proxy.ts` הוא נקודה יחידה. אימות הפריך את החקירה
   הראשונית ("אין metadata"): Gemini **כן** מחזיר `usageMetadata` (token counts, `genai.d.ts:4533`).
   לכן ספירה **מדויקת**: chars-of-input ל-ElevenLabs (החיוב per-char), `usageMetadata` ל-Gemini
   (עדיפות ל-`candidatesTokensDetails[modality=AUDIO]`). cache-miss בלבד נספר לעלות (hit=$0).
3. **אין DB — מונים-בזיכרון + JSON/NDJSON** — ה-BE single-process (אין race) → מונים בזיכרון + flush
   ל-`~/.config/drive-coding/usage/totals.json` (שורד restart) + `events.jsonl` append-log (לבקשת המשתמשת,
   לפילוח/audit עתידי). לא SQLite — לא תואם סגנון, over-engineering. תקדים: `projects-registry.json` + `wire-recorder`.
4. **מחירים סטטיים** — snapshot מאומת 2026-07-02: ElevenLabs ~$0.18/1k chars; Gemini-3.1-flash-tts $1/$20 per-1M
   (input/audio). config עם תאריך+מקורות, "משוער" מפורש.
5. **מנגנון 2 = BE-only בשלב זה** — הצגת-summary ב-FE נדחית ל-slice עתידי; character_count/limit מ-subscription
   (`/v1/user/subscription`) ל-slice `tts-quota-subscription` (גל הבא). JIT — נכתבו 2 briefs, לא 3.

### ממצאי אביגיל
9 findings בשני ה-briefs (r1 USABLE-AFTER-FIX שניהם → r2 READY 0-findings). הבולטים:
**availability**: 🔴 pseudo-code קיבע `caps.elevenlabs` לכל אופציה (Google היה נחסם לפי ElevenLabs) → per-provider;
🟡 נתיב i18n שגוי (`frontend/` → הנכון `core/src/i18n/`, עריכת-3-קבצים). **metering**: 🔴 הנחת ה-tap סתרה את
ה-cache — Gemini `:streamGenerateContent` **uncacheable**, אין tee לשמש בו → הנחיה ל-**tee חדש** על
transparent-forward (escalation מובטח שנמנע); 🟡 `candidatesTokensDetails[]` מדויק יותר מ-`candidatesTokenCount`.

### שינויי-כיוון
- מ"בדיקת-env / env-dummy" ל-**probe** (בעקבות תובנת-OneCLI של המשתמשת).
- מ"הערכה גסה (chars≈tokens)" ל-**ספירה מדויקת** (התגלה `usageMetadata` אמיתי ב-Gemini).

### רעיונות שנדחו
- **SQLite/DB** — לא תואם סגנון JSON-store, over-engineering ל-single-process.
- **ספירה ב-FE adapters** — נוח יותר לקריאת ה-data, אך לא-persistent + דורש דיווח FE→BE; ה-choke-point נקי יותר.
- **env-dummy תחת OneCLI** (הצעת-המשתמשת) — התייתר ע"י ה-probe.

### שינוי-כיוון (2026-07-03, אחרי preview חי) — availability גדל ל-capability-gate
**preview חשף פער-תכנון**: slice 1 סימן ספק `disabled` בבורר אבל **לא מנע תעבורה** — נתפס
retry-loop של `loadVoices` (14 בקשות ל-`/v1/voices`, 7×401, מפתח-פגום). המשתמשת: "כל הרעיון
להפסיק להטריד endpoints לא-שמישים". ההרחבה (Commits 3-4): ה-`ttsCapabilities` הופך ל-**gate
מרכזי** — כל צרכני-הספק (loadVoices, Speaker/BubblePlayer synthesize) בודקים זמינות לפני קריאה
ל-upstream. ספק לא-זמין → **0 בקשות מוחלט**.
- **הכרעה ארכיטקטונית (5 סבבי אביגיל)**: הגישה הראשונה (`await ensureLoaded()` ב-loadVoices)
  נדחתה — ה-`await` לפני ה-loading-guard **שובר reentrancy** (🔴 r3, test-7 DDoS-guard). הגישה
  הסופית: **gate reactive ב-`$effect` של VoicePicker** — loadVoices לא נקרא כלל עד ש-caps ידוע
  ו-available. אפס async ב-loadVoices → ה-guard הסינכרוני שלם. זה הדפוס ה-Svelte הנכון.
- **חיבור ל-slice 3**: ה-probe (list-voices) תופס רק **מפתח**, לא **קרדיט**. slice 3 (subscription)
  יזין את אותו `caps` עם `character_count>=character_limit` / `status=free_disabled` → available:false
  → ה-gate יחסום אוטומטית גם על אפס-קרדיט. שני ה-slices = מנגנון אחד.
- **ערך ה-preview**: כל זה נתפס **לפני merge**, לפני שאליעזר כתב שורה. בדיוק מטרת ה-runtime-gate/preview.

## 2026-07-02 — codex-inprocess: codex כספק in-process דרך fork (במקום npx-spawn)

### רציונל
codex רץ דרך `npx -y @zed-industries/codex-acp@latest` (spawn). אובחן חי ששלושה כשלים
מתלכדים סביב npx: boot ~10ש' (מירוץ מול `INIT_TIMEOUT_MS=10_000` → כשלי-connect אקראיים),
נכד-יתום שמחזיק את הפורט, ו-exit-2 של המתאם הרשמי החדש תחת bun-spawn. **הוכח חי**: הרצת
ה-JS של המתאם ישירות (בלי npx) פותרת את שלושתם. ההכרעה: **codex עובר ל-in-process** (מודל
claude/Model-2) — המתאם רץ אצלנו, codex עצמו child מנוהל דרך `CODEX_PATH` → native codex.

### הכרעות
1. **fork בשליטתנו** — `MusiCode1/codex-acp` (public; git-dep על branch `#drive-coding` — ר' "מודל-הפורק"
   למטה). הפורק מוסיף `src/lib.ts` שחושף `startAcpServer(readable, writable, opts)` דרך subpath `./lib`
   (ה-agent מעל זוג-streams במקום stdio קשיח). **אומת in-process בלי BE** (initialize 0.7ש' + session/new חיים).
2. **connect fn נפרדת** (`connectCodexInProcess`), לא הכללת `connectInProcess` הקיימת — כי claude
   מדבר acp-sdk **object**-streams (`createStreamBridge`) ואילו הפורק מדבר **NDJSON על Node streams**.
   שתיהן מחזירות `ProviderConnection` (זו ההכללה ברמה הנכונה). הבריג של codex פשוט יותר (PassThrough↔wire).
3. **model = FE-driven** — `StartAcpServerOptions` אין לו `modelOverride`; ב-codex המודל נבחר דרך
   ה-wire (`session/new`/`setSessionModel`), לא דרך אופציית הפורק.

### מודל-הפורק וסיכון-התלות (git-dep) — הכרעה מפורשת

**מודל שלושת הענפים** בפורק `MusiCode1/codex-acp` (fork של repo ציבורי → ציבורי):
- **`main`** — מראה של upstream (`agentclientprotocol/codex-acp`). נתיב-סנכרון (`git fetch upstream && merge`).
- **`inprocess-lib`** — ענף-ה-PR ל-upstream: נקי ומינימלי (רק `src/lib.ts` + build/exports). מיועד ל-PR.
- **`drive-coding`** — ענף-האינטגרציה **שאנחנו שולטים בו**; **ה-git-dep מצביע לכאן** (`github:MusiCode1/codex-acp#drive-coding`).

**למה ה-git-dep על `#drive-coding` ולא על `#inprocess-lib`**: ענף-PR עובר force-push (rebase לפי
feedback) → ref נייד שישבור/יזיז את ה-git-dep. ענף-האינטגרציה יציב תחתינו. **`pnpm-lock` נועל את
ה-SHA המדויק** — אז גם ref-של-branch רפרודוקטיבי (install משתמש ב-SHA הנעול עד עדכון מפורש).

**בנייה ב-install**: `dist` gitignored → הוספנו `prepare: npm run build` בפורק, כך ש-`pnpm/npm install`
של git-dep בונה dist (כולל subpath `./lib`). **אומת מקצה-לקצה**: `npm install github:...#drive-coding`
נקי (בלי auth) → fetch אנונימי (`http=200`) → prepare בונה `dist/lib.js` → `./lib` נפתר. ~3 דק' (כולל @openai/codex).

**סיכון-התלות (מתועד-במודע)**: git-dep על **פורק אישי**. אם `MusiCode1/codex-acp` יימחק/יהפוך פרטי —
`pnpm install` של drive-coding יישבר (בכל מכונה/CI/deploy). זה מחיר מודע תמורת השליטה (in-process, בלי npx).
**נתיב-יציאה (מיטיגציה)**: (א) PR מ-`inprocess-lib` ל-upstream → חזרה ל-`@agentclientprotocol/codex-acp`
רשמי מ-npm; **או** (ב) publish תחת scope משלנו ל-npm. עד אז — הפורק הוא מקור-האמת ל-codex.

### רעיונות שנדחו
- **המשך npx-spawn** — מקור שלושת הכשלים (אומת חי).
- **patch על ה-bundle של @zed** — שביר (bundled/minified, נשבר בכל bump).
- **המתאם הרשמי דרך npx** — עדיין exit-2 תחת bun; ה-bundled `@openai/codex` קורס על Windows.
- **in-process ללא fork (import ישיר)** — v1.0.2 לא חושף API (exports ריק, CLI-only) → fork הכרחי.

### ממצאי אביגיל
r1 USABLE-AFTER-FIX (3): (#1 type-error) `modelOverride` שאינו שדה ב-`StartAcpServerOptions`;
(#2 naming) הומצא `staticCodexCapabilities()` במקום `staticCapsFor(cliKind)` הקיים; (#3 🟢) header
של `capabilities-static.ts` אומר spawn-based. כולם תוקנו → r3 READY. (r2 אימת אך כתיבת-הדוח נקטעה;
r3 פרסם.) הערת-המשך: `resolveCodexPath` פר-פלטפורמה (Windows חייב נתיב-מלא; bundled שבור שם).

## 2026-07-02 — be-shutdown-hardening: kill-tree + graceful-shutdown + WS-heartbeat

### רציונל
כאב חוזר (המשתמשת: "מזמן"): כשעוצרים את ה-BE, הפורט 4000 נשאר תפוס על PID **מת**, ותהליכי-בן
מתייתמים. חקירה (`docs/investigations/2026-07-01-be-shutdown-socket-health.md`) זיהתה שזה **לא באג
יחיד** אלא שרשרת של שלושה כשלים בניהול-תהליכים שמתלכדים:
1. **`npx …@latest`** (`core/schemas/agent.ts:30-43`) יוצר תהליך-עטיפה → ה-CLI האמיתי (codex-acp) הוא **נכד**.
2. **`kill()` לא-רקורסיבי** (`spawn-core.ts:218-229`) — `child.kill()` על ה-PID הישיר בלבד → הנכד מתייתם.
3. **spawn ללא בקרת-inheritance** + **אין graceful-shutdown** → הנכד היתום מחזיק את ה-listen socket.
נוסף: דליפת-WS (60 סוקטים חצי-סגורים) מהיעדר server-side heartbeat → מזין את ה-hang.

**ההכרעה — למתן היגיינה בתהליך-האב, לא לשנות מודל.** כל agent כבר תהליך-OS נפרד; ה-BE הוא
pipe-relay. השורש אינו "יותר מדי תהליכים" אלא היגיינה רופפת. שלושה תיקונים זולים: kill-tree
(POSIX process-group + Windows `taskkill /T`), graceful-shutdown (SIGINT/SIGTERM), WS-heartbeat.

### שינויי-כיוון (מ-CodeNomad)
בדקתי איך CodeNomad מנהל את opencode (`D:\UserProjects\AI\CodeNomad`). הם נתקלו **בדיוק** באותו
סיכון — הערה מפורשת ב-`runtime.ts:375`: *"Prefer process-group signaling so wrapper launchers
(bun/node) don't orphan the real server."* אימצתי את **תבנית ה-kill-tree** שלהם (`runtime.ts:262-430`:
process-group POSIX + `taskkill /T` + escalation SIGTERM→SIGKILL) ואת תבנית ה-heartbeat/sweep
(`connection-manager.ts`). **הבחנה קריטית שמנעה העתקה-עיוורת**: CodeNomad הוא HTTP-per-agent
(`opencode serve`, `stdin:"ignore"`) — אנחנו **ACP-over-stdio** (claude/codex אין להם serve mode),
חייבים את ה-stdin pipe. אז אימצתי kill/shutdown/heartbeat, **דחיתי** את מודל ה-HTTP-transport.

### רעיונות שנדחו (מתועד ב-brief §2)
- **HTTP/SSE transport (מודל CodeNomad)** — לא ישים ל-ACP-over-stdio; שמור ל-roadmap Future.
- **החלפת `npx` בבינארי-ישיר** — יקטין נכדים, אבל slice נפרד (config/binary-dist).
- **תמיכת WSL ב-kill** — אנחנו לא מריצים agents ב-WSL; הושמט מהתבנית.
- **נעיצת codex-acp (boot-race, ממצא 5)** — slice נפרד.

### ממצאי אביגיל (READY r1, 4 findings קלים — כולם שולבו)
- 🟡 **hbInterval cross-commit** — Commit 2 מגדיר `hbInterval` אבל `gracefulShutdown` (Commit 1) צריך
  `clearInterval`. חודד: Commit 2 עורך במפורש את קוד Commit 1, `hbInterval` module-level מעל ה-handler.
- 🟡 **httpServer TLS-variant** — במסלול TLS זה `Http2SecureServer`/`https.Server`, לא `http.Server`;
  `.close(cb)` קיים על כולם → לא חוסם. ניסוח חודד.
- 🟢 **list() כפול** — ל-`spawn-core.ts:214` כבר יש `list()` (`BridgeHandle[]`); ה-list החדש
  ב-`connection-registry` מחזיר `string[]`. סמלים נפרדים — הוספה אזהרה ל-executor.
- 🟢 **kill() שורות** — 218-**229** לא 218-228. תוקן.
> **תפיסה מוקדמת (טרם אביגיל)**: תוך כתיבה זיהיתי ש-`connection-registry` **חסר `list()`** (הוספתי
> כצעד מפורש) ואת הסיכון ה-🔴 ש-`process.kill(-pid)` בלי `detached:true` יכול להרוג את ה-BE עצמו
> (נעלתי את שניהם ל-Commit 0).

### עדכון אחרי repro-אמיתי (המשתמשת דרשה אימות, לא hang-מוזרק) — שינה את התוכנית
הרצתי repro חי. **ממצא מכריע ששינה שלושה דברים:**
1. **הבאג אומת חי** — פורט 4000 נמצא תפוס על PID **מת** (67512) יומיים אחרי, עם פרופיל 13 CLOSE_WAIT +
   13 FIN_WAIT_2 (החתמת-handle, לא TIME_WAIT). שרשרת ה-spawn נחשפה: `bun→npx→vp→cmd→node` (**5 רמות**).
2. **אבל BE בריא עמיד** — 3 תרחישי-כיבוי (כולל `bun --watch`+SIGHUP דרך tmux) + 3 ניסויי-stress
   (WS abandon 400, WS terminate 300, codex spawn-storm 25/104-תהליכים) → **אף אחד לא חנק**; bun/tmux
   מנקים הכל; הסוקטים TIME_WAIT שמתפנה לבד.
3. **הסיבתיות הפוכה** — ה-CLOSE_WAIT של 67512 הם **סימפטום** של loop-תקוע, לא הסיבה. הצטברות-סוקטים
   **אינה** מחנקת. שורש-ה-hang **לא שוחזר** בשני וקטורים.

**השינויים לתוכנית (r2):**
- **Commit 2 שוכתב** — מ-native `ws.ping()` (server.ts) ל-מעקב `lastPingAt`+sweep על ה-`$/ping` שה-FE
  **כבר שולח כל 25s** (`ws-transport.ts:22`), ב-`ws-agent.ts` בלבד. מוסגר-מחדש: **"ניקוי סוקטי-רפאים של
  קליינט-מת"** (שאלה 1) — **לא** תרופת-hang. (בונוס: ביטל את ה-cross-commit dependency שאביגיל תפסה ב-r1.)
- **kill-tree + graceful-shutdown** → הוגדרו-מחדש כ-**defense-in-depth** (bun כבר מנקה ב-happy-path;
  ערכם ל-Node-runtime/systemd עתידי).
- **watchdog חיצוני = slice נפרד `be-hang-supervisor`** — הפתרון היחיד ל-hang: מודד ping round-trip
  **מחוץ** ל-loop (BE לא יכול לזהות את עצמו תקוע), ועל אי-מענה → kill-tree מבחוץ. agnostic → **לא דורש**
  לדעת את שורש-ה-hang (טוב, כי חמקמק). נבדק עם hang-מוזרק.

**הערך של האימות-האמיתי (שהמשתמשת התעקשה עליו)**: הפריך את השערת-הסוקטים **לפני** שנכתב קוד. בלעדיו
היינו בונים heartbeat כ"תרופת-hang" וטועים. hang-מוזרק לבדו לא היה חושף זאת. **r2 → READY** (finding 🟢
יחיד: שארית hbInterval מתה, הוסרה).

### תיאום מול `slice/codex-inprocess` (סקירה 2026-07-02)
codex-inprocess (branch נפרד, READY r3, לא מוזג) מעביר codex ל-in-process → **כשל #1 (npx-grandchild)
נעלם עבור codex**. ה-slice שלי **נשאר תקף**: opencode/gemini/qoder עדיין spawn (kill-tree שלי מכסה),
ו-native-codex רץ כ-child דרך `CODEX_PATH` **מחוץ ל-spawn-core** (מנוקה ב-`connectCodexInProcess.close()`,
אחריותם). חפיפה יחידה+רכה: `connection-registry.ts` (routing שלהם מול `list()` שלי — additive, merge-order
גמיש, אין תלות קשה). ה-DoD שלי עבר ל-**opencode** כדי להיות עמיד לסדר-המיזוג. פירוט: `slice-be-shutdown-hardening.md` §10.

## 2026-07-01 — image-paste Commit 4: gating דרך raw, לא normalized

### רציונל
image-paste Commits 0–3 מוזגו (`2cdb85a`, פיגום רדום `IMAGE_INPUT_ENABLED=false`). נותר Commit 4
(שליחה מולטימודלית). היה חסום על "Track A חיצוני" שירחיב `provider-contract` — אבל provider cutover
v0.8.0 **ספג** את החבילה ל-`packages/provider/` (קוד שלנו). החסם נעלם, וההכרעה על ה-gating חזרה למרדכי.

**ההכרעה: `supportsImageInput` נשאר קורא raw** — `#client.capabilities.promptCapabilities.image`
(ערך אמיתי פר-סוכן מ-`initialize`), **לא** דרך `NormalizedCapabilities`. Commit 4 פוצל: 4a (provider —
הרחבת `AcpClient.prompt` ל-`string | PromptBlocks`, backward-compat; ה-layer התחתון `conn.prompt` כבר
מקבל `ContentBlock[]`) → 4b (FE — flip הדגל + wiring).

### מה הכריע (נמדד מהקוד 2026-07-01)
- **`staticCapsFor` (spawn: opencode/codex) hardcoded לגמרי** — "capabilities cannot be discovered at
  runtime here". נתיב normalized היה כופה את `image` להיות **ניחוש קשיח** לספקי-spawn, מנותק ממה שהסוכן
  מדווח → בדיוק סיכון הכשל-השקט שה-kill-switch נועד למנוע.
- **raw = הערך האמיתי פר-סוכן לכל הספקים** (in-process claude *וגם* spawn, דרך initialize האמיתי).
- **`promptCapabilities.image` הוא שדה ACP סטנדרטי** — כבר אחיד; `NormalizedCapabilities` נועד ל-host/_drive
  features שהמשטח הגולמי לא חשף אחיד. image לא צריך את שכבת הנרמול. (audio/embeddedContext עתידיים ילכו
  באותו מסלול raw — עקבי קטגורית.)

### ממצאי אביגיל
- **סבב 1 (🔴):** ה-brief תיאר את Commit 4b מול TypeArea הישן (79 שורות) — אבל **Commit 2 כבר מוזג**,
  TypeArea עכשיו 229 שורות. שליחת תמונה-בלבד חסומה ב**שלוש** שכבות (כפתור Send `disabled`, `onSubmit`
  early-return, VM guard), וה-brief טיפל רק באחת → DoD "תמונה-בלבד לא נחסמת" היה נכשל. + line-refs מיושנים.
- **תיקון:** Commit 4b הורחב לכסות את שלוש השכבות עם refs מדויקים; §3.5+Commit 2 סומנו "היסטורי/מוזג"
  (באנרים "אל תיצור מחדש"); טענות ה-SDK של 4a עוגנו מול `@agentclientprotocol/sdk@0.21.1`
  (`PromptRequest.prompt: Array<ContentBlock>`, `ImageContent & {type:"image"}` עם data+mimeType).
- **סבב 2:** READY, 0 findings.

### תיאום (לא-חסם)
`slice-warm-reattach-skip-init` (סשן אחר) מחלץ `buildAcpClientFacade` מ-`client.ts` ונוגע במתודת `prompt`
— אותו אזור ש-4a עורך. חפיפת-קובץ רכה (שניהם base=dev, worktrees נפרדים). merge-order יטופל ע"י מרדכי;
מי ששני מְיַשם מחדש את שינויו ב-facade המרוענן.

### רעיונות שנדחו
- **(ב) הוספת `image` ל-`NormalizedCapabilities`** — "נכון ארכיטקטונית" לכאורה, אך שובר על spawn (hardcoded),
  יותר עבודה, ומערבב prompt-content caps עם host/_drive caps. נדחה.

## 2026-07-01 — warm-reattach-skip-init: reconnect ל-agent חי בלי initialize חוזר

### רציונל
כפתור "Reconnect" ל-agent codex חי נכשל: `#warmReconnect` (FE) עבר דרך `createAcpClient()`
ש**תמיד** שולח `initialize`. Codex ACP, על process שכבר אותחל, מחזיר `Already initialized`;
הכשל הצית `transport.close()` → `#handleUnexpectedClose` → auto-reconnect → warm שוב → לולאה
(המשתמשת ראתה "3 סוקטים ברצף"). ההכרעה: **נתיב יצירת-client נפרד `createAttachedAcpClient`**
(ב-`packages/provider/src/client/client.ts`) שמדלג על `initialize` — `session/load` לבדו עובד
על process חי (מאומת חי ב-wire). ה-facade משותף לשני הנתיבים (`buildAcpClientFacade`), כך
שנתיב ה-cold נשאר זהה התנהגותית.

### רעיונות שנדחו
- **fork ל-`@agentclientprotocol/sdk`** — מיותר; ה-SDK כבר חושף `initialize`/`loadSession`
  כפעולות נפרדות, החובה הייתה רק ב-wrapper שלנו.
- **`skipInitialize` flag בתוך `createAcpClient`** — נדחה לטובת פונקציה נפרדת (הוכרע עם המשתמשת):
  קריא יותר ולא מסכן את נתיב ה-cold שעובד.
- **capabilities מנורמלות ל-warm** — לא נדרש: `NormalizedCapabilities` מגיע ממילא מ-`_drive/capabilities`
  (ws-agent.ts:84); ה-raw `#client.capabilities` נצרך רק ב-`supportsImageInput` הרדום → fallback ריק בטוח.

### ממצאי אביגיל
3 סבבים (r1: USABLE-AFTER-FIX/4 findings → r2: 1 → r3: READY/0). אף 🔴. תפסה: (r1) מספרי-שורות
`createAcpClient` הצביעו על שורת ה-`WsAcpTransport` ולא על הקריאה (תוקן: warm=525/attach=590/
loadSession=757/coldReconnect→loadSession@466); export חסר ל-`AttachedAcpClientOptions`; היעדר
תקדים ל-transport-double. (r2) ה-skeleton של ה-double סיפק 2 מ-4 חברי `AcpTransport` — חסרו
`close`/`onClose` וה-facade קורא `transport.close()` → היה TypeError בזמן ריצה שמסווה כשל. כל תוקן ב-brief.

### הערת המשך
באג נפרד שנמצא אגב-אורחא ונשאר known-issue: ה-BE משתמש בקוד סגירה **1008** גם ל-"agent not found"
וגם ל-"agent in use by another tab" (`ws-agent.ts:60,68`), וה-FE (`#warmReconnect:509`) עושה retry
על כל 1008 — כך ש-not-found (לא-ניתן-לתיקון) מקבל 3 retries מיותרים. מחוץ לסקופ הסלייס; תיקון עתידי
= קוד ייעודי ל-not-found. וכן: תיעוד ארגון חבילת provider ב-`docs/investigations/2026-07-01-provider-package-organization.md`
(refactor אחרי הבאג).

## 2026-06-29 — provider cutover: claude in-process + ext channel חי (v0.8.0)

### רציונל
ההוצאה של provider-abstraction ל-git-dep נפרד הפכה לכאב. החזרנו אותה פנימה כחבילת-workspace
`@drive-coding/provider`, **additive** (קוד-חדש שלא נוגע בנתיב החי), ואז cutover אחד מבוקר. המטרה:
API = ACP-client רשמי **+ הרחבות מנורמלות**, כך שפקודות ייחודיות-לספק (rename/thinking/mcp) נקראות אחיד
מצד-לקוח, והתרגום פר-ספק חי בשרת.

### ההכרעות המרכזיות
1. **ext ללא patch** (תיקון לכיוון קודם): runtime-controls של claude לא דורשים patch ל-claude-agent-acp.
   ה-`ext` channel ברמת הפרוטוקול מקבל כל method; אנחנו מממשים את ה-`extMethod` הנכנס בעצמנו; וה-`query`
   נגיש דרך `ClaudeAcpAgent.sessions` (שדה ציבורי ב-runtime). ראה entry "runtime-controls בלי patch".
2. **Model 2 — BE-as-ACP-transport** (לא backend-managed מלא): ה-FE **נשאר ה-ACP client**; ה-BE מגשר את ה-WS
   לחיבור-הספק. claude מתארח **in-process** (האדפטר בתהליך שלנו → בעלות על ה-ext channel; claude עצמו עדיין child
   תחת ה-SDK). opencode/codex/gemini/qoder = spawn. הרווח: בעלות, לא ביצועים (in-process אף מקצר — תהליך אחד פחות).
3. **ProviderConnection — פרימיטיבים ניטרליים**: החבילה חושפת `connect() → { wire(onLine/write), onFrame(decoded),
   turn, onCrash, capabilities, ext?, pid }`; ה-BE **מרכיב** מהם orchestrator/registry/crash/wire-observability/
   turn-tracking. `bridge-manager` נמחק — הלוגיקה הגנרית עברה לחבילה, וה-config הספציפי (audio-prompt) נשאר BE כ-`shapeEnv` opt.
4. **ציר = ספק** (`providers/<x>/`), לא מנגנון-חיבור. spawn-core = כלי-עזר. registry מנתב cliKind→provider.
5. **חוזה ext מטופס** (`extensions/schema.ts`, ArkType) משותף FE/BE; FE עושה capability-gating + facade מטופס; ה-FE
   לא יודע מי הספק (capabilities+schema הם הקלטים).
6. **stream-bridge** (iii-1): ה-`Stream` של sdk@1.0 נושא אובייקטי AnyMessage; ה-wire הוא string → שכבת-תרגום stringify/parse בגבול.

### שרשרת הביצוע (11 slices, additive)
C3-ext-thinking · EXT-SCHEMA · CUT-1(dep-repoint) · CUT-2(spawn-core-wrapper)+NBug1 · CUT-3a(reorg) ·
CUT-3b-i(ProviderConnection) · CUT-3b-ii(BE-rewire) · CUT-3b-iii-1(connectInProcess) · CUT-3b-iii-2(routing חי) ·
FE-normalization · FEAT-thinking-live. כל אחת: אביגיל READY → אליעזר → calev GO. אומת ב-preview חי.

### רעיונות שנדחו
- **patch/fork ל-claude-agent-acp** — מיותר (ה-query נגיש).
- **backend-managed מלא (Model 1)** — שינוי גדול ב-FE↔BE; דחינו לטובת Model 2 (צעד-ביניים, ה-FE לא נשבר).
- **reabsorption move+repoint (R1-R3)** — הוחלף במודל האדיטיבי; R1-R3 שימשו כמקור-קוד + cutover-preview מאומת.

### הסתייגויות ידועות (פתוחות)
- `mcp:false` תמיד ב-capabilities (initResult לא נתפס) — future; אין UI ל-mcp עדיין.
- **חיוב**: claude in-process עדיין דרך SDK → pool third-party (פתוח-במודע; מיטיגציית VSCode-ext ב-roadmap).
- אימות-אפקט thinking הוא best-effort (ה-ext מגיע ל-claude; שינוי-budget לא אומת דטרמיניסטית).

## 2026-06-28 — V4b: בורר-קול Gemini (רשימה סטטית, אין endpoint)

### רציונל
‏אחרי ש-V4a (Gemini TTS) מוזג, הקול נשאר מקובע ל-`"Kore"` ב-`resolveTts()`. V4b מוסיף
‏בחירת-קול. ההכרעה המרכזית: **מאיפה רשימת הקולות**. בדקנו אם קיים endpoint חי (העדפת
‏המשתמשת) — ‏ו**אין כזה**: תיעוד Gemini speech-generation מגדיר 30 קולות prebuilt בלי REST
‏endpoint; `GET /v1beta/voices` → 404; `models.list` מחזיר metadata בלי שדה קולות; ו-SDK
‏`@google/genai@2.3.0` (המותקן) חסר כל method לרשימת קולות. לכן הגישה: **רשימה סטטית בקוד**
‏(`voices-gemini.ts`, 30 קולות + תיאורי-אופי). זה גם מפשט את ה-slice משמעותית — אין fetch,
‏retry/backoff או מצבי-טעינה (בניגוד ל-`loadVoices` של ElevenLabs).

‏הכרעות-משתמשת: (1) להציג תיאורי-אופי בבורר — דרך `SelectOption.description` שכבר קיים
‏ב-`Select.svelte`; (2) ברירת-מחדל = `Kore` (זהה למקובע היום, שינוי מינימלי); (3) התיאורים
‏**דו-לשוניים** (אנגלית+עברית). מבנה: `resolveTts` מקבל פרמטר שלישי אופציונלי `geminiVoice`
‏(backward-compatible), `Settings.geminiVoice` שטוח (לא voice-config מקונן), בורר UI
‏conditional על `provider==="google"`.

‏**הכרעת ה-i18n הדו-לשוני** (נגזרת מבקשת המשתמשת + אילוץ ה-lint): ה-lint חוסם עברית בכל
‏קובץ פרט ל-`i18n/catalogs/*` + טסטים. לכן העברית **לא** יכולה להיות data ב-`voices-gemini.ts`.
‏הפתרון: מפתח i18n פר-קול (`settings.geminiVoice.desc.<Id>`, ×30), ב-`he.ts`="`Firm · תקיף`"
‏(גם-וגם), ב-`en.ts`="`Firm`". הקובץ הסטטי מחזיק `{ id, descKey: MessageKey }` — ה-`descKey`
‏literal עובר typecheck (מפתח דינמי `t(\`...${id}\`)` היה נשבר מול ה-union). אביגיל אימתה את
‏כל שרשרת ה-i18n (allowlist, MessageKey type, `Catalog`-completeness, append-only).

### ‏ממצאי אביגיל
‏r1 = **READY** (נדיר): אימתה symbols + שהטענה "אין endpoint" לא הופרכה. אחרי שינוי
‏הדו-לשוני — r2 = **READY** שוב: אימתה את שרשרת ה-i18n (allowlist `lint-no-hebrew`,
‏`MessageKey` union + יצוא מ-`core/i18n`, `Catalog`-completeness, append-only קטלוגים).
‏סה"כ findings ירוקים בלבד (provider=`"google"` מול מפתחות `gemini`, ה-brief מודע;
‏`Select` חותך description אך "`Firm · תקיף`" שורה-אחת → מלא).

### ‏שינויי-כיוון (אחרי ביצוע)
- ‏**בורר-קול מותנה-ספק** (תיקון `c9edd64`): ה-brief המקורי הוסיף בורר-Gemini conditional אך
  ‏השאיר את בורר-ElevenLabs **תמיד-גלוי** → במצב Google הופיעו שניהם (מבלבל; השמטה ב-brief).
  ‏המשתמשת תפסה ב-preview. תוקן-במקום: בורר-הספק קודם, ואז **רק** הבורר של הספק הפעיל
  ‏(`{#if elevenlabs}…{:else if google}…`). typecheck+i18n נקיים.

### ‏רעיונות שנדחו
- ‏**endpoint חי** — נבדק לבקשת המשתמשת, לא קיים (ראה רציונל).
- ‏**Cloud Text-to-Speech `voices.list`** — endpoint שכן קיים, אך API אחר (`texttospeech.googleapis.com`),
  ‏קולות אחרים (Chirp/WaveNet — לא ה-prebuilt של Gemini), host שלא מוזרק ע"י OneCLI. לא חלופה.
- ‏**voice-config מקונן פר-ספק** — מיותר; שני שדות שטוחים (`voiceId`/`geminiVoice`) מספיקים.
- ‏**תיאורים אנגלית-בלבד** — נשקל בתחילה (פשוט יותר), נדחה לבקשת המשתמשת לטובת דו-לשוני.

## 2026-06-28 21:52 — permission-ui נשאר brief חסום עד hook הרשאות ב-provider-contract

### רציונל
נכתב brief ל-`slice-permission-ui` שמחזיר את פיצ'ר ממשק אישור ההרשאות למסלול: UI inline בצ'אט,
state ב-`AgentSession`, bridge מבוסס Promise, ו-DoD חי מול ספק non-bypass. הבדיקה מול אביגיל חשפה
שאי אפשר לשגר את הסלייס לפני שינוי מקדים ב-`provider-abstraction`: ה-adapter הנוכחי עדיין מאשר
אוטומטית `requestPermission`, ולכן ל-drive-coding אין hook אמיתי להצגת UI.

### שינויי-כיוון
ה-brief סומן במפורש `BLOCKED / pre-dispatch` במקום READY חלקי. הוספתי Dispatch gate שמחייב:
השלמת P0 ב-`provider-abstraction`, נעילת commit חדש ב-`pnpm-lock.yaml`, עדכון ה-header, והרצת אביגיל
חוזרת לפני `plan_verified=true`. תיקוני אביגיל הפנימיים הוטמעו: שימוש ב-`option.name` במקום `label`,
implementations מלאים ב-skeleton של `permission.ts`, ושם טיפוס `RequestPermissionHandler` במקום
`PermissionDecision` לא קיים.

### מצב
אין finding פנימי ידוע שנשאר בבריף. החסם היחיד הידוע הוא חיצוני: `provider-contract` צריך לחשוף
`onRequestPermission` דרך `createAcpClient` ולשמר fallback legacy כשאין callback.

## 2026-06-28 — runtime-controls בלי patch: ext channel שלנו + גישת-query דרך `sessions`

### רציונל
ההחלטה הקודמת (extension-layer §1.5, 2026-06-28) הייתה ש-control_requests של claude (mcp/thinking
mid-session) "נעולים" ולכן צריך `pnpm patch` ל-claude-agent-acp שמוסיף inbound extMethod. בדיקה חוזרת
של `acp-agent.js` המקומפל הוכיחה שזה מיותר. שלושה ממצאים מתחברים:
1. **ה-`ext` channel ברמת הפרוטוקול** — `Agent.extMethod?(method, params)` מקבל **כל** method חופשי
   תוך כדי סשן (`acp-extension-mechanisms.md`; קיים ב-0.21 וב-1.0). אין רשימה סגורה.
2. **אנחנו הבעלים של צד-הקבלה** — ב-in-process host הקוד שלנו מספק את ה-`Agent`. מאצילים standard
   methods ל-`ClaudeAcpAgent`, ומממשים `extMethod` הנכנס **בעצמנו**. (ClaudeAcpAgent לא מממש extMethod —
   לא רלוונטי, אנחנו תופסים את ה-ext לפניו.)
3. **ה-query נגיש ב-runtime** — `ClaudeAcpAgent.sessions` שדה **ציבורי** (`this.sessions = {}`), כל רשומת-סשן
   מחזיקה את ה-query החי שחושף `setMaxThinkingTokens`/`setMcpServers`/`setModel`/... ה-`private` שהנחנו
   קודם היה TS-בלבד.

### שינויי-כיוון
ה-patch **יורד מהשולחן**. כל ה-runtime-controls (thinking/mcp) מתאחדים לאותו דפוס של C3-rename —
slice פשוט (`host/in-process/claude/<x>.ts` + capability + smoke חי), בלי modification ל-node_modules.

### רעיונות שנדחו
- **patch ל-claude-agent-acp** — נדחה: מיותר (ה-query נגיש), ויקר-תחזוקה (רץ על כל `pnpm install`).
- **fork** — נדחה עוד קודם (תחזוקה).

### הסתייגות מתועדת
הגישה ל-`sessions[id].query` היא ל-internal **לא-מתועד** (public טכנית, לא API יציב). מיטיגציה:
(א) גרסה נעולה ממילא; (ב) accessor מטופס **יחיד** (`getQuery(sessionId)`) כך ששבירה עתידית = קובץ אחד;
(ג) smoke-test פר control מאמת שהשרשרת קיימת. צימוד-רך, לא modification.

## 2026-06-28 — פיצול slice-cache-headers-version לדק (A+B+C) + D נפרד

### רציונל

ה-brief הישן `slice-cache-headers-version.md` גדל לנפח-יתר: A (Cache-Control headers) + B (הצגת
גרסה+SHA) + C (bump semver) + D (מיתוג: rename, FE_ENV, title, localStorage, publish). A+B קטנים
ובעלי-ערך מיידי (רענון-טלפון אמין + visibility ל-debug) אבל נתקעו כי D (מיתוג/publish) נגרר איתם
ודרש סבב אביגיל חוזר. פיצלתי ל-`slice-cache-version.md` הדק = A+B+C בלבד, שעבר אביגיל **READY ב-r2**
(0 findings; r1 = 3 קוסמטיים בלבד — אחד מה-briefs המדויקים שעברו כאן). depends_on=[] כי
slice-fe-build-decouple כבר מוזג (זרימת build מנותקת + dc-build-fe + alias fe:build זמינים).

### שינויי-כיוון

- **D מתפצל בעצמו**: D2+D3+D4 (כותרת בלי v2, איחוד `FE_ENV` ב-vite.config, מיגרציית localStorage-key)
  עצמאיים מהשם → slice מיתוג נפרד (depends_on=[]). D5+D-publish (metadata + guards ב-build.mjs)
  מצמדים לשם החבילה (`--filter @drive-coding/frontend`) ולסוכן-הפרסום → slice publish-prep שתלוי
  ב-`slice-frontend-rename-cutover` (הקנוני ל-rename). כך אין סבך-תלויות.
- **ממצא חי שהפיצול חשף**: `FE_ENV=dev` שכבר הוגדר ב-units (sync 21/06) **לא עושה כלום** — `vite.config.ts`
  עדיין קורא `FE_SOURCEMAP`, לא `FE_ENV`. D3(a) (איחוד ב-vite.config) הוא הפער שסוגר את זה.

### רעיונות שנדחו

- **לשגר את ה-brief הגדול כמו שהוא** — נדחה. הנפח החזיק את A+B (ערך מיידי) כבני-ערובה של D
  (מיתוג, פחות דחוף, מצמד-לפרסום). thin-slicing מחזיר את A+B למסלול מהיר.
- **§D1 (rename חבילה) בתוך D** — נדחה לטובת `slice-frontend-rename-cutover` כמקור-אמת יחיד (כפילות).

---

## 2026-06-28 — סדר slice-input-autogrow ↔ slice-image-paste: autogrow ראשון, brief מרוענן

### רציונל
שני ה-slices נוגעים ב-`TypeArea.svelte` (היחיד). `input-autogrow` היה בוצע+אומת (כלב GO 9/9);
`image-paste` הוא complexity-8, טרם התחיל, וחלקו (Commit 4) gated על track-A. ההכרעה:
**מזגנו את autogrow ראשון** (b3b5140) ולא הפכנו את הסדר — להחזיק slice מאומת כבן-ערובה
ל-slice שטרם התחיל זה אחורה.

### שינוי-כיוון (תלות שהתגלתה)
ה-brief המקורי של image-paste הצהיר `depends_on: [track-A]` בלבד — **לא הכיר ב-autogrow**.
זו הייתה תלות-קוד חבויה: autogrow שינה את אותו קובץ ש-image-paste "משכתב במלואו".
התיקון: הוספת `input-autogrow` ל-depends_on, רענון כל הפניות-השורה (TypeArea 67→79,
onkeydown L43-55→L55-67), §3.5 חדש (טבלת מה-autogrow-הוסיף + מה אסור לדרוס), והערת-layout
ל-tray (חייב לשבת **מחוץ** ל-`<form items-end>` כדי לא לשבור את גדילת-הגובה).

### ממצאי אביגיל
r3 USABLE-AFTER-FIX: הרענון מול autogrow היה **מדויק לחלוטין** (כל 9 הפניות TypeArea בול);
2 findings קלים בלבד — drift +6 בהפניות `sendPrompt` (559→565, 562→568, שריד מ-131-commit
sync, לא קשור ל-autogrow) ו-hash contract קוסמטי (4f3a→b745). תוקנו → r4 **READY**.

### מצב
Commits 0–3 (resize-plan TDD + image-attachment engine + TypeArea capture/tray/gating +
UserBubble render) **dispatch-ready**. Commit 4 (שליחה מולטימודלית) + merge **מוקפאים**
עד ש-track-A יחשוף `AcpClient.prompt(PromptContent[])` (היום text-only, client.d.ts:45).

### kill-switch (החלטת המשתמשת, 2026-06-28) — Commits 0–3 בטוחים ל-merge רדומים
במקום להסתמך על מה שהספק מדווח ב-`promptCapabilities.image` (שעלול להיות `true` בטעות בעוד
`AcpClient.prompt` text-only → כשל-שקט: משתמש שולח תמונה לחלל), הוספנו **דגל קשיח
`IMAGE_INPUT_ENABLED = false`** (module-const ב-`agent-session.svelte.ts`) שכופה
`supportsImageInput=false`. כל עוד false → כל הלכידה רדומה, אפס שינוי-התנהגות → **Commits 0–3
בטוחים ל-merge מיד** בלי בדיקת-runtime ובלי להחזיק branch שמתיישן. Commit 4 הופך ל-`true`
בשורה אחת יחד עם חיווט השליחה. אביגיל r5 הוסיפה: gating גם ברמת-handler (early-return
ב-paste/drop/picker), לא רק הסתרת אייקון. זה מהפך את "בצע ולא תמזג" מכורח לבחירה.

## 2026-06-28 — recent-projects-controls: מחיקה מהרשימה + כיווץ-panel נשמר

> brief: `docs/plans/slice-recent-projects-controls.md` · base dev `ebf50ae` · Complexity 6 · calev light.
> אביגיל: **READY** (r1, 3 findings 🟢 cosmetic). report: `reports/drive-coding/recent-projects-controls-avigail.md`.

> ⚠️ **שינוי-כיוון אחרי preview חי (2026-06-28)**: ההכרעה המקורית הייתה "הסתרה קבועה"
> (`hidden:true` ששורד `recordCwd`). **בוטלה** אחרי שהמשתמשת ראתה את ההשלכה ב-preview: תיקייה
> שמוסתרת ואז עובדים בה שוב הייתה נשארת מוסתרת לנצח — לא-אינטואיטיבי לרשימת-recency. **ההחלטה
> החדשה: מחיקה-אמיתית** — ✕ **מוחק את הרשומה** (`removeCwd`, לא דגל). אם המשתמשת תתחבר לתיקייה
> שוב → `recordCwd` ייצור רשומה חדשה והיא **תחזור** (התנהגות-recency טבעית). ראה "שינוי-כיוון 2"
> בסוף ה-entry. הסעיפים על `hidden`/`hideCwd` למטה משקפים את הגרסה המקורית (היסטוריה).

### רציונל

המשך ל-connect-recent-projects (מוזג `726f9f3`). המשתמשת ביקשה שני פקדים על ה-panel: (1) כפתור
למחוק תיקייה מהרשימה; (2) אפשרות לכווץ את ה-panel, **ולשמור** את מצב-הכיווץ לכניסה הבאה.

**הכרעה מרכזית — מחיקה = הסתרה קבועה, לא הסרה זמנית** (בחירת המשתמשת): ה-registry מתמלא *אוטומטית*
בכל `recordCwd` (session-attached). הסרה פשוטה הייתה חוזרת בחיבור הבא. לכן הוספנו דגל `hidden`
לרשומה — `getProjects` מסנן אותו, ו-`recordCwd` **כבר** עושה spread של הרשומה הקיימת
(`{ ...projects[idx]!, cwd, kind, lastSeen }`) → ה-`hidden` שורד אוטומטית בלי לגעת ב-recordCwd. זו
תוספת CRUD חלקית ל-`ProjectsRegistry` (כפי שהמשתמשת זיהתה נכון) — `hideCwd` + endpoint `DELETE /api/projects`.

**הבחנת-persist**: `hidden` נשמר **בשרת** (`projects-registry.json` — עקבי בין מכשירים, כי הסתרה היא
החלטה על הפרויקט). מצב-הכיווץ `recentCollapsed` נשמר ב-**localStorage** (העדפת-תצוגה מקומית, דפוס
`showThoughts` ב-Settings). הבחנה מכוונת: מה ששייך לפרויקט → שרת; מה ששייך לתצוגה → מקומי.

### ממצאי אביגיל

READY בסבב ראשון. 3 findings cosmetic (0-min): off-by-one בספירת-שורות (registry 80 לא 81),
`registerProjectsHttp` בשורה 24 לא 22, וחידוד שהתקדים `app.delete` (`http-agents.ts:89`) הוא
path-param ולא DELETE-with-body. ה-spot-check אישר **מילולית** את הטענה הקריטית: spread ב-`recordCwd`
משמר `hidden`. אזהרת ה-**nested-button** (כפתור מחיקה חייב sibling, לא ילד — HTML תקין + מניעת
bubbling ל-connect) אומתה כנכונה ופרואקטיבית.

### שינויי-כיוון

- **slice אחד מאוחד** (לא 2 מקבילים) — שלושת הפקדים נוגעים ב-`RecentProjectsPanel.svelte` → פיצול
  היה יוצר merge-conflict/שרשור מיותר.
- **בלי confirm על מחיקה** ל-MVP — ההסתרה הפיכה (לא הורסת קוד/סשנים; un-hide ידני בקובץ אפשרי).
- **DELETE עם JSON body** (`{cwd}`) ולא path-param — ה-cwd מכיל `:`/`\`. fallback מתועד ל-`POST /api/projects/hide`
  אם DELETE-with-body ייחסם ברשת/proxy.

### שינוי-כיוון 2 — מחיקה-אמיתית במקום הסתרה-קבועה (2026-06-28, אחרי preview)

המשתמשת ראתה ב-preview שהסתרה-קבועה לא-אינטואיטיבית: רשימת "תיקיות אחרונות" צריכה לשקף נוכחות-
אחרונה, ותיקייה שמוסתרת ואז עובדים בה שוב צריכה לחזור. **ההחלטה הפכה ל"מחיקה-אמיתית"**:
- `hideCwd(cwd)` → **`removeCwd(cwd)`**: `projects.filter(p => p.cwd !== cwd)` + persist.
- שדה `hidden?` ב-`ProjectEntry` **הוסר**; ה-filter ב-`getProjects` הוסר (חזרה ל-sort בלבד).
- `recordCwd` ללא שינוי — כשמתחברים לתיקייה שנמחקה, הוא יוצר רשומה חדשה → התיקייה **חוזרת** (recency).
- הטסטים התהפכו: "hidden survives recordCwd" → "removed project returns after recordCwd".
- **הארכיטקטורה לא השתנתה**: ה-endpoint `DELETE /api/projects` + ה-optimistic-remove ב-FE נשארים
  זהים — רק *מה שה-endpoint עושה בשרת* השתנה (מחיקה במקום סימון). (הובהר למשתמשת: הרשימה חיה בשרת,
  לכן מחיקה חייבת endpoint; ה-FE רק מסיר אופטימית מהמסך + שולח DELETE.)

### רעיונות שנדחו

- **un-hide UI** — לא רלוונטי יותר (אין hidden; מחיקה הפיכה דרך חיבור-חוזר).
- **סנכרון מצב-הכיווץ בין מכשירים** — נדחה; כיווץ הוא העדפת-תצוגה מקומית (localStorage), לא server-state.
- **הסתרה-קבועה (`hidden:true`)** — נדחה אחרי preview (ראה שינוי-כיוון 2); מחיקה-אמיתית אינטואיטיבית יותר לרשימת-recency.

---

## 2026-06-28 — slice-restore-last-config: שחזור agent+mode מהסשן האחרון (מוזג)

### רציונל
הבקשה: "סשן חדש יטען את ה-agent וה-mode שהיו בסשן האחרון." בחרנו פתרון **FE-טהור,
per-cliKind**: mode/model/agent הם תכונות של ה-CLI, לא של התיקייה — לכן Settings (FE)
ולא ה-BE registry (שמחזיק per-cwd lastSessionId; לא מערבבים). מנגנון גנרי יחיד
`setLastConfig(cliKind, configId, value)` שמכסה **כל** ציר-קונפיג. apply נקרא אחרי
`status==="connected"` בשני נתיבי סשן-חדש (`attach` + `newSession`) — **לא** ב-resume
(loadSession/switchSession שומרים את ה-mode של הסשן הקיים).

זה **נפרד** מ-`session-prefs-per-cwd` (BE, multi-device sync) — בכוונה לא עשינו את זה כאן.

### החלטת-תכנון מרכזית
הזרקת `settings` ל-constructor של `AgentSession` (לא singleton import) — ה-VM הוא הבעלים
של persist+apply. `settings` אופציונלי → טסטים קיימים (`new AgentSession({ cues })`)
ממשיכים לעבור כ-no-op חינני.

### ממצאי אביגיל (r3, READY)
2 findings זניחים בלבד (מספר-שורה L163 vs L159, הערת-נתיב view-models/) — 0 מהותיים.
התפיסות החשובות היו בסבבים מוקדמים: (א) `applyConfigOption` עם 5 מסלולי-return → persist
חייב wrapper, לא "בסוף המתודה"; (ב) תזמון — apply חייב לרוץ אחרי `connected` אחרת no-op
שקט; (ג) כיסוי — `attach` (החיבור הראשון) הוא הנתיב השכיח, לא רק `newSession`.

### merge (2026-06-28)
INVASIVE-but-additive במכוון (אישור המשתמשת 27/06). מול 90 commits drift ב-dev: קונפליקט
additive יחיד בקוד (`settings.ttsProvider` של V4a לצד `lastConfig` — keep-both). build-gate
ירוק (typecheck 0, 354/354, i18n נקי), כלב GO (light, 6/6 DoD). merge `350e60d`.

### רעיונות שנדחו
per-cwd/BE/sync (= ה-roadmap-item הנפרד session-prefs-per-cwd) — נדחה לעכשיו.

## 2026-06-27 — slice-context-window-meter: מד טוקנים ביחס לחלון-הקשר

### רציונל

המשתמשת ביקשה להציג כמה מחלון-ההקשר של המודל בשימוש. ACP מספק את הנתון ישירות דרך
התראת `session/update` מסוג `usage_update` = `{ used, size, cost }` — בדיוק `used/size`.
ה-bridge ב-BE הוא passthrough גנרי (`bridge-manager.ts:165` `cb(line)` → `ws-agent.ts:88`,
ללא allowlist), כך שההתראה כבר מגיעה ל-FE; הפער היחיד הוא ש-`#onSessionUpdate` לא מטפל
בה והנתון נזרק. לכן הפיצ'ר הוא plumbing קצר (ענף early-return) + רכיב UI קטן — לא שינוי
פרוטוקול. בחרתי ב-`usage_update` ולא ב-`PromptResponse.usage` (פר-turn) כי הראשון נותן
used-מול-size ישירות, והשני נזרק היום ב-acp-provider וממילא מצטבר-פר-turn.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (4 findings). 🔴 הבולט: ה-pseudo-code מיקם את ענף ה-usage_update
בשרשרת ה-else-if **אחרי** ה-guard `if (!text) return` (L1191) — ושם הוא לעולם לא יורה,
כי usage_update לא נושא `content.text` (silent bug שהיה עולה לאליעזר 20-40 דק' debug).
תוקן ל-early-return לפני ה-guard. עוד: שם-המתודה האמיתי `#onSessionUpdate` (לא
`#applyUpdate`), ו-`cost` הוא `Cost={amount,currency}` ולא מספר (→ `u.cost?.amount`).
r2 = שלושת אלה אומתו כמתוקנים; נותרו 2 🟢 קוסמטיים בלבד שתוקנו ידנית. 0 ממצאים פתוחים.

### שינויי-כיוון

- **Commit 0 = spike fail-fast**: הסיכון אינו טכני אלא ריצתי — לא אומת סטטית שה-CLI
  (opencode/claude) בכלל *פולט* `usage_update`. במקום לבנות UI על הנחה, השלב הראשון לוכד
  turn אמיתי ומאשר פליטה; אם אף CLI לא פולט — עצירה והחלטה ארכיטקטונית מחדש.

### רעיונות שנדחו

- **`PromptResponse.usage` פר-turn** כמקור — נדחה לטובת `usage_update` (used/size ישיר).
  נשמר כתוכנית-מגירה אם ה-spike יגלה שאין `usage_update`.

---

## 2026-06-27 — slice-release-publish (בוצע ישיר): תיקון `bin` ל-npm publish
אימות חי של החבילה (npm publish --dry-run, npm 11.11) חשף ש-`bin: "./dist/drive-coding.js"` עם
`./` prefix **נדחה בפרסום** (`invalid and removed`) → ה-CLI `drive-coding` לא היה עולה אחרי install.
תוקן ל-`"dist/drive-coding.js"` (אומת ע"י `npm pkg fix`). נוסף `publishConfig: {access:"public"}` +
metadata (keywords/repository/homepage/bugs). ה-bundle נבנה ורץ על Windows (אימות ראשון על Windows —
GET / + /api/agents + _app asset = 200). branch `slice/release-publish` @ `b349d63`. **slice קטן
מדי ל-executor/verifier — בוצע ישירות ע"י מרדכי**; `npm publish` עצמו = צעד אנושי.

## 2026-06-27 — slice-binary-core: בינארי `--compile` עולה ומגיש מקומית
### רציונל
ה-slice המרכזי בשרשרת הבינארי — מטמיע FE+BE ב-executable יחיד (`bun build --compile`) שרץ בלי Bun
מותקן. מבוסס על 5 ספייקים מאומתים (FE embed דרך `import…with{type:"file"}`; `--asset-naming="[dir]…"`
משמר נתיב; `__IS_BINARY__` דרך `--define` עובד cross-module; pino-pretty stream ישיר in-process;
`.ts` מוטמע כ-asset כמו `.js`). base=`slice/state-dir` (משתמש ב-`getStateDir()` לחילוץ ה-plugin).
### ממצאי אביגיל
r1 USABLE-AFTER-FIX (5) → r2 READY (0). findings: SPA-fallback typecheck (`noUncheckedIndexedAccess`),
stub annotation `Record<string,string>`, plugin extraction → `ensureStateSubdir("plugins")`, dev-tip
התיישן `0e23b0f`→`88d447b`, `.ts` embedding לא-מאומת (נסגר בספייק 27/06).
### שינויי-כיוון
ה-gate הוא **build-constant** (`--define`), לא env var ולא `Bun.isStandaloneExecutable` (שמחזיר
`undefined` ב-1.3.12). plugin extraction דרך `ensureStateSubdir` (mkdir מובטח).
### רעיונות שנדחו
- serve-from-memory דרך `Bun.embeddedFiles` loop: לא ישים (מסנן `.js`, `name` משוטח) → codegen manifest.
- `bun-plugin-pino` / תיקון ה-worker: מיותר — pino-pretty stream ישיר פשוט יותר ומבטל את ה-worker.
- extract-to-temp ל-FE: נדחה — embedded + `Bun.file()` serve-from-memory, אפס חילוץ.

## 2026-06-27 — slice-state-dir: תיקיית state מאוחדת `~/.config/drive-coding/`

### רציונל
Foundation לסלייס הבינארי (`docs/plans/slice-single-binary-prebrief.md`). היום נתיבי ה-state
(recordings/cache/wire-recordings/proxy) נוצרים `path.resolve("data/...")` יחסית ל-cwd → בינארי/bunx
שרצים מ-cwd אקראי מזהמים אותו. ה-slice מאחד ל-`~/.config/drive-coding/` (מרחיב את `cli-specs.jsonc`
שכבר שם), דרך helper יחיד `getStateDir()`. הוכרע 27/06 שלא נדרש migration — אין recordings חיים,
cache ייבנה מחדש → ה-slice פשוט (complexity 4, calev light). ראשון בשרשרת state-dir→binary-core→binary-dist.

### ממצאי אביגיל
r1 USABLE-AFTER-FIX (3 findings) → r2 READY (0). 6 spot-checks עברו מילה-במילה (`getHomeDir`
http-options:75-77, 4 נתיבי `data/` ב-server.ts:80/84/85/104, חתימות store/registry, אין circular
import). findings: (1) imports יתומים (`homedir`/`join`) אחרי swap; (2) הנתיב **כן** משתנה
`os.homedir`→`getHomeDir` (DoD#6 טען בטעות "לא השתנה") → טסט `cli-config-file:33-38` צריך עדכון;
(3) הנחה שגויה שטסטי recordings/projects מניחים `data/`-cwd (הם מזריקים `tmpdir()`).

### שינויי-כיוון
DoD#6 תוקן: ההתנהגות משתנה (env `HOME`/`USERPROFILE` > `os.homedir`) — הטסט שמשווה ל-`os.homedir`
ישירות יישבר במכונה שבה `HOME≠os.homedir` (git-bash/onecli); עודכן ל-`getStateDir()` או mock env.

### רעיונות שנדחו
- **extract-to-temp** ל-state: נדחה לטובת dir קבוע (יציב, נגיש למשתמש, חילוץ plugin חד-פעמי).
- **OS-native (env-paths)**: נדחה לטובת `~/.config/drive-coding/` אחיד פר-OS — פשטות > OS-purity.
- **migration אוטומטי**: לא נדרש (אין data חי).

## 2026-06-27 — content-viewer: viewer fullscreen גנרי (MVP: Markdown + תמונה, FE-טהור)

> brief: `docs/plans/slice-content-viewer.md`. אביגיל **READY** (r2/0-findings; r1 היו 3
> path/line findings, אין blocker). דוח: `reports/drive-coding/content-viewer-avigail.md`.
> Complexity 4/10 → verifier light. base=dev, `depends_on: []`.

### רציונל

המשתמשת ביקשה viewer להצגת **בריפים מוכנים** בנוחות. בריף מגיע מהסוכן כ-message markdown
ארוך → בבועת-צ'אט הוא צפוף. ה-viewer פותח אותו fullscreen (bits-ui Dialog, בחיקוי מדויק
של `FolderPickerDialog`). משתמש מחדש ב-`renderMarkdown` הקיים (DOMPurify two-pass + KaTeX) —
אפס שכפול-sanitize. משמש מיד גם כ-lightbox לתמונות-הכלים.

ההכרעה המכריעה — **מקור התוכן קובע את הסקופ**: בדיקת ה-bubble model הראתה שלמרות ש-roadmap
מנה "Markdown + תמונה + PDF" יחד, רק markdown (כ-`Segment.text`) ותמונה (כ-`ToolContentImage.data`
base64) מגיעים **inline ב-ACP stream** וכבר נמצאים ב-FE. PDF ו-`file://` מהדיסק נופלים
ל-`ToolContentOther` ודורשים BE proxy עם הכרעת-אבטחה כבדה (LFI/path-traversal). לכן ה-MVP
**FE-טהור** (`depends_on: []`) ו-PDF נדחה לגל שני gated על `local-file-proxy`. זה מנתק את
הפיצ'ר מכל תלות-תשתית — אפשר לשגר מיד.

### ממצאי אביגיל

r1: 3 findings, כולן path/line (אין blocker, אין regression). (1) `ToolContent` union ב-
`lib/types/bubble.ts` ולא ב-`chat/bubbles/`; (2) `joinSegmentText` ב-`chat/bubbles/bubble-rendering.ts`
ולא ב-util/; (3) cosmetic — נימוק double-mount. תוקנו, r2 נקי. אביגיל אישרה במפורש את שלוש
ה-concerns: (א) expand ידני מספיק ל-use case הבריפים, (ב) אין double-overlay (connect ו-chat
מסכים בלעדיים — +page לא עטוף ב-AppShell), (ג) `viewer.open` getter-מעל-`$state` ריאקטיבי כ-prop
ל-bits-ui `open` (תקדים `uiShell.sheetOpen`).

### רעיונות שנדחו

- **agent-triggered auto-open** (הסוכן פותח את ה-viewer מיוזמתו לדחוף brief לאישור) — נדחה
  ל-MVP: דורש הרחבת חוזה ACP (content-type/tool ייעודי), וצריך קודם spike של מה claude/opencode
  שולחים על ה-wire. ה-default = expand ידני, שמספק את ה-use case במלואו. (§9.1 בבריף, לא חוסם)
- **הרחבת `ModalsVM`** במקום VM נפרד — נדחה: content-viewer נושא payload לא-טריוויאלי
  (discriminated union markdown|image) + שמירה על תוספתיות (אפס נגיעה ב-modals.svelte.ts).

## 2026-06-27 — מסך-פתיחה: החלפת בורר-הסשן ברשימת תיקיות-אחרונות + 2 תיקוני folder-picker

> שני briefs (שרשרת סדרתית): `slice-folder-picker-fixes` → `slice-connect-recent-projects`.
> שניהם אומתו ע"י אביגיל ל-**READY** (folder-picker-fixes r3/0-findings; connect-recent-projects
> r2/3-cosmetic). דוחות: `reports/drive-coding/slice-*-avigail.md` (ריפו השיטה).

### רציונל

המשתמשת ביקשה להסיר את בורר-הסשן ממסך הפתיחה. המנגנון הנוכחי (`SessionPicker` + `listSessionsForCwd`)
**מריץ תהליך-סוכן חד-פעמי** (spawn → ACP handshake → listSessions → delete, ~300-700ms) רק כדי
להציג רשימת סשנים *לפני* שמתחברים. זה יקר ומיותר: בחירת סשן כבר אפשרית **בתוך** הסשן הפעיל
(`SessionOptionsPanel` → `switchSession`/`newSession`, warm ACP call ~20-50ms על אותו חיבור). אז
מסך-הפתיחה צריך רק *לחבר לתיקייה*, והבחירה העדינה קורית בפנים.

במקום הבורר — **רשימת תיקיות אחרונות**. הגילוי המכריע בתכנון: התשתית **כבר קיימת במלואה ב-BE** —
`ProjectsRegistry` (`projects-registry.json`) שמתעד כל `cwd` ב-`session-attached`, ו-endpoint
`GET /api/projects` שמחזיר אותן ממוינות lastSeen — **רק שאף אחד ב-FE לא צורך אותן**. כלומר הפיצ'ר
הוא FE-only (adapter + VM + panel בחיקוי מדויק של דפוס `ActiveAgents` הקיים) + הסרה. אין צורך
ב-endpoint חדש או שינוי BE.

שני תיקוני ה-folder-picker שורבבו כ-slice נפרד (ראשון בשרשרת) כי הם low-risk ועצמאיים-לוגית, אבל
**שניהם נוגעים ב-`+page.svelte`** — לכן שרשרת סדרתית (slice 1 ממוזג ל-dev, slice 2 נגזר מ-dev
המעודכן) במקום שני dev-based מקבילים שיתנגשו ב-merge.

**שורשי הבאגים (מאומתים בקוד, לא משוערים):**
- *folder-picker לא נפתח בנתיב שהוזן*: `FolderPickerDialog.openAtStart` קורא נקודת-פתיחה מ-`currentPath`/
  `settings.lastCwd` בלבד — **לא** רואה את ערך-הקלט החי (`cwd` ב-`+page.svelte`). תיקון: prop `startPath`.
- *תיקיות מוסתרות לא מוסתרות*: הפילטר ב-`http-history.ts:179` הוא **prefix-match מול 5 קידומות בלבד**
  (`.git`/`.opencode`/`.svelte-kit`/`node_modules`/`.pnpm`). כל dot-folder אחר (`.config`/`.cache`/
  `.ssh`/`.vscode`...) עובר ומוצג. תיקון: "מוסתר" = `startsWith(".")` || שם-רעש (`node_modules`).

### ממצאי אביגיל

- **folder-picker-fixes** (3 סבבים): r1 — mount כפול של `FolderPickerDialog` (גם `AppShell.svelte:345`,
  chat/settings) שלא הוזכר → הובהר כמחוץ-לסקופ. r2 — **blocker אמיתי**: `pnpm --filter
  @drive-coding/backend test` הוא **no-op** (אין script `test` ב-package; ה-runner היחיד הוא root
  vitest) → תוקן ל-`pnpm vitest run packages/backend` (אומת חי: 16 טסטים עוברים). r3 — READY/0.
- **connect-recent-projects** (2 סבבים): r1 — 2 blockers בשכבת-התלות: ה-base `slice/folder-picker-fixes`
  לא קיים/לא-מוזג, וההנחה `startPath={cwd}` לא מתקיימת ב-dev הנוכחי. r2 — READY אחרי מסגור-מחדש
  כשרשרת-סדרתית עם **Gate** מפורש + Pre-flight `grep startPath`. אומת ש-`beUrl` הוא ה-helper הנכון,
  ושמחיקת כל `sessions.ts` הייתה שוברת build (`SessionInfo`/`normalizeSessionInfo` בשימוש חי).

### שינויי-כיוון

- **לא מוחקים את `sessions.ts`** — רק את `listSessionsForCwd`. הקובץ מייצא גם `SessionInfo` +
  `normalizeSessionInfo` בשימוש ב-`agent-session.svelte.ts` (in-session listing) וב-`SessionCard`.
- **שרשרת סדרתית במקום שני slices מקבילים** — שניהם נוגעים ב-`+page.svelte` → merge מקביל = קונפליקט.
- **build-gate (`vite build`) ב-DoD של slice 2** — לא בגלל ה-adapter החדש (fetch בלבד, בטוח), אלא
  כשער-כללי; ה-acp barrel כבר ב-bundle ממילא (`agent-session.svelte.ts:20`).

### Windows hidden — נקודת-הרחבה מוכנה, מימוש בנפרד (עדכון 2026-06-27, בקשת המשתמשת)

המשתמשת שאלה אם "מוסתר" יכול לקרוא מה-OS כדי לכלול גם תיקיות מוסתרות-ב-Windows. הבחנה: ב-Windows
"מוסתר" = תכונת-קובץ (`FILE_ATTRIBUTE_HIDDEN`), **לא** נקודה — הכלל `startsWith(".")` יפספס תיקיות
כמו `AppData`. אבל **Node לא חושף את התכונה הזו** ב-`readdir`/`stat`; קריאתה דורשת מודול native
(`winattr`/`fswin`) או shell-out ל-`attrib`, **per-entry** (IO על כל פתיחת תיקייה → רגרסיית-latency
בבורר אינטראקטיבי).

**הכרעה**: לא לאגד עם תיקון-הבאג (שמשנה את פרופיל-הסיכון מ-trivial ל-native-dep/IO). במקום —
`isHiddenEntry` נכתב כ-**async שמקבל `(dirent, fullPath)`**, נקודת-ההרחבה היחידה שאליה ה-Windows-
detection ייכנס בעתיד בלי לגעת בלולאת-הסינון. המימוש בפועל = `slice-windows-hidden-attr` נפרד
(יכריע native vs `attrib`). עלות-עכשיו: מעט קוד async ללא-IO; תועלת: ה-Windows-slice = שינוי נקודתי
בתוך פונקציה אחת.

### רעיונות שנדחו

- **מימוש Windows-hidden כחלק מתיקון-הבאג** — נדחה (ראה למעלה): native-dep / IO per-entry ⊥ פרופיל
  של תיקון-trivial. רק נקודת-ההרחבה הוכנה.
- **טעינת `lastSessionId` של תיקייה-אחרונה בלחיצה** — נדחה ל-MVP. לחיצה = חיבור (סשן חדש); בחירת
  סשן ספציפי נעשית מתוך הסשן (בדיוק העיקרון שהמשתמשת ביקשה). אפשר להוסיף בעתיד.
- **סינון חופפים מול `ActiveProcessesPanel`** — נדחה. תיקייה עם agent חי תופיע בשניהם, אבל הסמנטיקה
  שונה: "תהליכים פעילים" = reconnect warm (שומר state); "תיקיות אחרונות" = spawn חדש. לא באג.
- **endpoint BE חדש** — מיותר; `GET /api/projects` כבר קיים ומאוכלס.

### ביצוע + runtime-gate (2026-06-28)

שני הסלייסים בוצעו ע"י אליעזר **בשרשור על מכונה אחת** (לא merge ביניים — merge דורש אישור משתמשת).

- **OVERRIDE על §0 של slice-2**: ה-brief הניח base=dev *לאחר* merge של slice-1. בפועל לא מיזגנו
  ביניהם; ה-base של slice-2 הוא ה-**branch** `slice/folder-picker-fixes` (chained worktree), והכלל
  `Pre-flight grep startPath` עבר בזכות השרשור (`+page.svelte:238`). שום merge לא נעשה ללא אישור.
- **slice-folder-picker-fixes** — branch `slice/folder-picker-fixes` @ `3fdfd86` (commits `ed7718f`
  BE async `isHiddenEntry` TDD red→green, `b86e078` FE `startPath` prop). **כלב GO, 8/8 DoD, 0
  findings** — אומת **חי בדפדפן** (playwright): dot-folders מוסתרים, הופיעו עם showHidden, בורר נפתח
  בנתיב שהוקלד, ניווט up/breadcrumb/בחירה ללא רגרסיה. typecheck 0 שגיאות, vitest 16/16.
- **slice-connect-recent-projects** — branch `slice/connect-recent-projects` @ `fb1f9ea` (5 commits:
  adapter/VM/panel/page-rewire/cleanup). **כלב GO, 14/14 DoD, 0 findings.** ⚠️ **אזהרה כנה**: ה-DoD
  אומת **סטטית בלבד** (typecheck 0, vite build, vitest 339/339, grep-residuals 0, אימות חיווט
  end-to-end ב-code) — **happy-path runtime חי לא הורץ** (אין BE בסביבת כלב). פריטי-ה-DoD הידניים מ-§5
  של ה-brief (לחיצה על תיקייה אחרונה → /chat, מצב-ריק, רשימה נטענת) **לא אומתו חי**. סיכון מרוסן (glue
  בלבד, חיקוי מדויק של דפוס ActiveAgents קיים) אך לא אפס — מומלץ smoke-test חי לפני/אחרי merge.
- **typecheck משולב** (slice-1+slice-2 chained): 0 שגיאות (backend+frontend, 5024 קבצים) — אומת
  ע"י מרדכי עצמאית.
- **סטייה מינורית**: ב-slice-2 ה-i18n keys נוספו ב-commit 3 (לא 5 כ-brief) — הכרח לוגי (ה-component
  השתמש בהם ועבר typecheck). הבדל שיוך-commit בלבד, לא תוכן.
- **merge**: ⛔ **טרם** — ממתין לאישור מפורש של המשתמשת (סדר A→B, `--no-ff` חובה בשרשרת).

---

## 2026-06-27 — היפוך-כיוון: ACP כמשטח קנוני + ספק-כגשר + reabsorption (מחליף את החוזה הקנוני)

### רציונל

החלטה ארכיטקטונית מכוננת שמהפכת את כיוון שכבת-הספק. עד כה הכיוון (ננעל 2026-06-08..17)
היה **חוזה קנוני מומצא** (`provider-abstraction/docs/design/canonical-contract-proposal.md`
LOCKED v1.2): consumer מדבר `ProviderSession` מנורמל, drive-coding = צרכן-בלבד דרך git-dep על
repo פרטי `provider-abstraction`. הכיוון הזה ייצר כאב מתמשך (git-dep על repo פרטי → 404 ל-bun;
`pnpm update -r` מוחק `#main`; ה-acp barrel שבר את ה-vite build) **בתמורה לתועלת שלא מומשה** —
ה-cutover ל-ProviderSession (P1d) מעולם לא הושלם (חסום).

ההיפוך (התקבל ע"י המשתמש 2026-06-26, פורמלי 2026-06-27): **ACP הוא ה-API הקנוני.** אין סיבה
לכתוב מודל מנורמל מקביל כש-`@agentclientprotocol/sdk` מכסה את רוב המשטח. צורכים את הספרייה
הרשמית כספרייה (לא כפקודות), ומרחיבים את מה שאינו מכוסה דרך 3 שכבות ההרחבה
(`provider-abstraction/docs/design/acp-extension-mechanisms.md`: `_meta` / `ext` / `unstable_`).
נשארים עם פרוביידור אחד שמתקנן את כל ה-CLIs ומייצא משטח אחיד — רק שהמשטח הוא ACP-רשמי+הרחבות,
לא חוזה מומצא.

### ההחלטה — 8 עוגנים

1. **ACP = המשטח הקנוני** (`ClientSideConnection`), לא `ProviderSession` מומצא.
2. **מתאם אחד, כמה CLIs, משטח אחד** — opencode/gemini/codex/claude-acp, כולם ACP-over-stdio.
3. **ייחוד-פר-ספק = הרחבות** (`_meta`/`ext`/`unstable_`), בלי לזהם את הליבה.
4. **החוזה הקנוני יורד לרציף** — `canonical-contract-proposal.md` → superseded; שני ה-P1d מתבטלים.
5. **Reabsorption** — הפרוסה הנצרכת (`provider-contract/acp`: client+transport+describe-crash, בלי
   `contract/`) חוזרת ל-`packages/core` כמודול מקומי; git-dep נמחק; הריפו `provider-abstraction`
   נשאר כארכיב-ידע, נוציא שוב כשבשל לשימוש חוצה-פרויקטים.
6. **מודול-הספק מחזיק את כל מחסנית ה-CLI** — spawn (`bridge-manager`) + מפרטים (`cli-config`) +
   פרוטוקול (ACP client) + טרנספורט — "הספרייה = גשר" (`roadmap.md` Future,
   `backend-managed-http-transport.md`).
7. **session-owner עובר ל-BE** (HTTP/SSE ללקוח) — פותר את ה-stall (Track F: ה-FE כקליינט
   → `request_permission` ללא מענה אחרי ניתוק) ומייתר את כל warm-attach/reconnect.
8. **שער-אימות אמפירי פר-CLI לפני התחייבות** — להריץ בפועל מול claude/codex/gemini/opencode
   (+antigravity desk-check) ולוודא שכל פיצ'ר ניתן-לביטוי על ACP+הרחבה, לא להסיק מהמסמכים.

### מה מוחלף (superseded)

- `canonical-contract-proposal.md` (LOCKED v1.2) — מודל ProviderSession מומצא.
- `provider-contract-framework.md` + `session-control-redesign/02-prescription.md` (17/06) —
  מסגור "provider-contract בעלים, drive-coding צרכן git-dep".
- `slice-P1d-provider-session-cutover.md` (🔴 NEEDS-REWORK) + `slice-P1d-frontend-cutover.md` (DRAFT) —
  אין יעד-cutover; ACP הוא היעד.
- `provider-abstraction-roadmap.md` — כבר SUPERSEDED (17/06), נשאר היסטורי.

### רעיונות שנדחו / מאוזנים

- **התפיסה ש-reabsorption = "5 קבצים וגמרנו"** — נדחתה. ה*חזון* המלא (עוגנים 6+7) הוא שינוי-טופולוגיה
  (FE-client → BE-session-owner), גדול בהרבה מ-5 קבצים → roadmap קצר (V→R→B), לא slice בודד שמסיים הכול.
  הגישה ההדרגתית ("שלב ראשון רק לאשר בקשות, התשתית כבר שם") היא הדרך.
  **‏הבהרה (נדחתה התפיסה, לא הצעד):** מהלך ה-5-קבצים עצמו **כן מבוצע** — כצעד הראשון של גל R
  (`slice-R1-inline-acp-slice`): interim פרגמטי שמסיר את כאב ה-git-dep **מיד**, מנותק מעוגנים 6+7.
  R1 הוא הצעד הראשון של הדרך ההדרגתית, לא סתירה לה.
- **לדלג על שער-האימות (עוגן 8)** — נדחה. הדירוגים 🟡/🟠/🔴 ב-`acp-extension-mechanisms.md` הם
  הסקה מתיעוד, לא הרצה. 🔴 אמיתי (antigravity ללא ACP, custom-agent בזמן-ריצה) יכול לשנות את התכנון —
  לכן האימות קודם לכל קוד.

### תוצרים

- roadmap: `docs/plans/acp-bridge-roadmap.md` (V → R → B).
- brief ראשון: `docs/plans/slice-V1-acp-feature-probe.md` (שער-האימות).

## 2026-06-25 — slice-frontend-rename-cutover: `@drive-coding/frontend-v2` → `@drive-coding/frontend`

### רציונל
סגירת ה-cutover ההיסטורי frontend-v2→frontend. הדירקטוריה כבר `packages/frontend/` (שונתה
2026-05 עם מחיקת ה-legacy); נשאר רק **שם החבילה** ב-`package.json` שעדיין `-v2`. החקירה
הראתה שהמשטח הפונקציונלי **זעיר**: 3 קבצי-קוד (package.json name + `--filter` ב-build.mjs
וב-dc-launch.mjs) + 2 הערות. 92 מתוך 97 ההפניות הן docs היסטוריים.

### ממצאי אביגיל
3 סבבים עד READY. הליבה הפונקציונלית אומתה מילה-במילה כבר ב-r1 (כולל: pnpm-lock ממופתח
לפי **נתיב** לא שם → rename לא נוגע ב-lockfile; build paths דירקטוריוניים; אין CI/turbo/nx;
אף package אחר לא תלוי בשם). כל ה-findings (r1×4, r2×1) היו בשכבת ה-docs-sweep: exclude-pattern
שדולף ל-`docs/reports/`, קבצי-גבול לא-מסווגים (redesign-chain-dispatch, walkthrough, voice-acp,
.html mockup), ו-24 merged briefs ב-`docs/plans/*.md` שנספרו ב-grep גלובלי.

### שינויי-כיוון
- **rename גורף → גורף-מתוחם**: לא `sed -i` עיוור. Commit 1 = 4 קבצי-קוד נקובים; Commit 2 =
  רשימת 11 docs-חיים מפורשת. ה-DoD בודק את הרשימה המתוחמת (`git grep` על 11 קבצים), לא
  "grep גלובלי ריק" — כי זה מתנגש עם ה-briefs ההיסטוריים.
- **brief = ארטיפקט היסטורי כשמוזג**: ~24 merged briefs ב-`docs/plans/*.md` מזכירים `-v2`
  ונשארים (כמו reports/archives). ד-dispatch עתידי מקבל את השם הנכון מ-prompt של מרדכי, אז
  stale `--filter` ב-brief לא-מורץ אינו סיכון.

### רעיונות שנדחו
- **`sed -i` גורף על כל הריפו** (כולל archives/reports/merged-briefs): נדחה — שכתוב רשומה
  היסטורית מטעה ("אז זה היה frontend-v2") + diff ענק. אם תתבקש בכל זאת — Commit 3 טריוויאלי.
- **שכתוב `docs/decisions/voice-acp.md` הישן**: נדחה — ה-rename נכנס כ-entry חדש (זה), לא
  בעריכת entries מתוארכים ישנים.

## 2026-06-25 — slice-input-autogrow: textarea שגדל עם הטקסט עד תקרה

### רציונל
ה-composer (`TypeArea.svelte`) היה `rows={2}` קבוע עם scroll פנימי — בהכתבה קולית/נייד
רב-שורתית לא רואים את כל מה שנכתב. הסלייס הופך אותו ל-auto-grow: גדל שורה-שורה עד תקרה
(`MAX_ROWS=6`) ואז scroll. מימוש מינימלי: `bind:this` + `$effect` תלוי-`promptText`
(לא `oninput` — כי מחיקה פרוגרמטית אחרי שליחה לא פולטת `input` event), + `max-height`/
`overflow-y:auto` ב-inline style. commit אחד, קובץ אחד, `depends_on: []`. Complexity 2.

### ממצאי אביגיל
3 סבבים עד READY. r1: (#1 🔴) ה-`<form>` היה `items-stretch` → כפתור ה-Send היה נמתח
ל-6 שורות יחד עם ה-textarea (רגרסיה ויזואלית שלא כוסתה); (#2 base-hash מיושן). r2: שני
הראשונים תוקנו; צצו 2 מינוריים — הטרייד-אוף ההפוך של `items-end` (~6px בראש הכפתור בשורה-
אחת) ו-base-drift נוסף. r3: READY. כל דפוסי ה-Svelte 5 (`$state` ל-ref, `$effect` timing,
interpolation ב-`style`) אומתו תקינים מול הקוד.

### שינויי-כיוון
- ה-fix לרגרסיית כפתור-הענק: `<form>` מ-`items-stretch` ל-**`items-end`** — הכפתור מיושר-
  לתחתית ושומר על גובהו הטבעי, יושב בקו התחתית של ה-textarea הגדל. זה גם דפוס ה-composer
  הסטנדרטי (ChatGPT/Claude) כשהקלט גדל כלפי מעלה.

### רעיונות שנדחו
- **`oninput` handler** במקום `$effect`: נדחה — לא מכווץ אחרי שליחה (מחיקה פרוגרמטית של
  `promptText` לא פולטת `input`).
- **`min-h` תואם על הכפתור** כדי לסגור את ה-6px בשורה-אחת: נדחה לבסבב הזה — הטרייד-אוף
  מקובל (יישור-לתחתית מכוון), והחלופה `items-stretch` מחזירה את רגרסיית כפתור-הענק.
- **תקרה כהגדרה ב-Settings**: נדחה — `MAX_ROWS` קבוע hardcoded; slice עתידי אם יידרש.

## 2026-06-25 — slice-fe-build-decouple: ניתוק בילד-FE מ-restart של הסרוויס

### רציונל
רענון FE בפריסה המקומית דרש `systemctl restart`, שמריץ `pnpm build` מלא **וגם** מפיל את
תהליך ה-bun → כל סוכני ה-ACP (children של ה-BE) נהרגים. זה כפה הרג-סוכנים + בילד איטי על כל
שינוי FE קוסמטי. העובדה המאפשרת: ה-BE מגיש את ה-FE דרך Hono `serveStatic` שקורא מהדיסק
**per-request** (אין קאש בזיכרון) → בילד לתוך אותה תיקייה תוך-כדי ריצה מתפרסם ב-request הבא,
בלי restart.

### החלטות
1. **בילד היחיד שנחוץ בריצה = FE.** core/backend רצים מ-src עם bun (exports→src), ה-`tsc --build`
   שלהם הם artifacts לטייפצ'ק בלבד. לכן ExecStartPre עובר מ-`pnpm build` מלא ל-FE-only
   `build-if-missing` (תקדים: `dc-launch.mjs`).
2. **swap אטומי בשני `mv`** (build→old, staging→build) ולא symlink — החלון הלא-אטומי תת-מילישנייה
   (metadata-only), עלות נמוכה מול ניהול-גרסאות/symlink. בילד ה-vite האיטי רץ ל-`.build-staging`
   בלי לגעת ב-`build/` החי.
3. **outDir פרמטרי דרך `FE_BUILD_OUT`** ב-svelte.config.js (ברירת-מחדל `"build"` → אפס שינוי
   התנהגות). הוכח שה-cwd של `pnpm --filter` הוא package-dir, אז נתיב יחסי נפתר נכון.
4. **restart שמור ל-BE בלבד** — מודע ובכוונה. הטייפצ'ק כשער-פריסה נזנח (ה-BE רץ untyped מ-src
   ממילא); נשאר באחריות לולאת-הפיתוח.
5. **התקנת ה-units החיים = צעד post-merge נפרד** הדורש אישור מפורש (שינוי שירות-חי, SOUL.md).
   הסבר עצמו נוגע רק בקבצי-מקור ב-`deploy/systemd/`.

### ממצאי אביגיל
verdict=READY בסבב ראשון (נדיר). כל הטענות הארכיטקטוניות אומתו אמפירית: serveStatic per-request
(createReadStream, ללא קאש), cwd של pnpm filter = package-dir, אין service-worker,
`.gitignore build/` לא תופס `.build-staging`. שני findings minor בלבד (drop-in `.service.d`
לא-בתחום + תבנית grep path-only) — הוטמעו כהערות ב-brief.

### רעיונות שנדחו
- **symlink-based atomic deploy** — אטומי-לחלוטין אבל overkill לפריסה אישית (ניהול גרסאות + ניקוי).
- **`bun --watch` ל-BE** — היה מחזיר את הרג-ה-children בכל שינוי. נדחה.
- **השארת `pnpm build` מלא כשער-טייפצ'ק** — סותר את מטרת הרענון-המהיר.

## 2026-06-25 — slice-chat-virtualization: windowing לרשימת הבועות (virtua + Option B)

### רציונל
`ChatBubbles` עושה `{#each session.bubbles}` ללא windowing → כל הבועות ב-DOM בו-זמנית →
גלילה איטית בשיחה ארוכה (180+ בועות), בעיקר בנייד. גל שני של ה-Message&Input UX backlog.

### החלטות (אחרי מחקר ספריות — מתועד למטה)
1. **ספרייה: `virtua`** (לא TanStack-headless, לא windowing ידני). שלוש סיבות: zero-config
   dynamic measurement (החלק הקשה — גובה משתנה ב-markdown/קוד/כלים/תמונות); `Virtualizer`
   חושף `scrollRef?: HTMLElement` חיצוני; peer `svelte >=5.0` native. TanStack headless דורש
   רינדור absolute + measureElement ידני + anchoring עצמי = הרבה boilerplate על משטח רגיש.
   זו גם בחירת CodeNomad (`virtual-follow-list.tsx`, battle-tested).
2. **Option B — AppShell נשאר owner ה-scroll** (חוק זהב #4 / redesign-2 **לא** מתהפך).
   `virtua` עושה windowing בתוך ה-scroll node הקיים דרך `scrollRef`. נמנעת היפוך-ארכיטקטורה.
3. **isAtBottom ממדדי virtua handle**, לא `scrollEl.scrollHeight` גולמי — תחת windowing אסור
   להניח ש-scrollHeight מהימן. פונקציה טהורה `computeScrollEdges` (TDD) ניזונה מ-handle.
4. **auto-follow דרך `handle.scrollToIndex(last,{align:'end'})`**, לא `scrollTop=scrollHeight` —
   virtua מחשב נכון גם עבור items שטרם נמדדו (anti-jump בזמן stream).
5. **גשר context דו-כיווני** (`ChatScrollBridge` $state ב-+layout): AppShell↔ChatBubbles הם
   אחאים דרך `{@render children()}` (לא parent→prop). AppShell כותב scrollEl, ChatBubbles
   כותב handle. coupling מינימלי, additive.

### רמת חסינות: MVP+
windowing + follow-via-handle + `ResizeObserver` (re-pin בזמן streaming) + user-intent window
(להבדיל scroll-משתמש מ-scroll-תוכניתי). **hold-target** (בועה גבוהה-מ-viewport מחזיקה follow,
כמו CodeNomad) **נדחה ל-future** — over-engineering ל-MVP.

### ממצאי אביגיל (r1→r3)
r1=USABLE-AFTER-FIX, 4 findings — **כולם מינוריים** (אין blocker). אביגיל אימתה אמפירית
את אי-הוודאות המרכזית שדגלתי (§6): מנגנון ה-`bind:this` ל-handle ב-virtua/svelte = Svelte 5
instance-exports → `bind:this={handle}` מחזיר את המתודות ישירות, כפי שהונח. גם הפריכה השערת
regression על ה-Speaker (קורא `session.bubbles` VM, לא DOM). r2 תפסה שאריות typo (`?stream=`→
`&stream=` + DoD hardcoded 209). r3=READY. complexity 8 → **calev-heavy** + phase-check אחרי Commit 1.

### רעיונות שנדחו
- **TanStack svelte-virtual (headless)**: שליטה מלאה ב-DOM אבל boilerplate כבד (absolute +
  measureElement + anchoring ידני); ה-Svelte adapter היסטורית מפגר אחרי React. נדחה.
- **windowing ידני (IntersectionObserver)**: מדידת-גובה-משתנה היא בדיוק החלק הקשה — לא להמציא מחדש.
- **היפוך scroll-ownership ל-ChatBubbles**: היה מבטל את redesign-2; Option B מונע זאת.
- **hold-target**: נדחה ל-future (ראה לעיל).

### עדכון 2026-06-25 (אחרי READY) — auto-scroll במנות (batched), לא רציף (דיון `623c749f`)
ה-brief היה READY עם follow **רציף** (re-pin בכל גדילה דרך ResizeObserver). בדיון עם המשתמשת
התברר שזה בדיוק הבאג שמרגיז: הטקסט "בורח" כלפי מעלה תוך כדי קריאה (ה-default הנאיבי של
ChatGPT/Claude). ההחלטה החדשה:
1. **batched by distance + floor** — קופצים לתחתית **המלאה** רק כש (א) הקצה החי נפל ≥ ~3 שורות
   (`3 × lineHeight`) **וגם** (ב) עברו ≥ ~300ms מהקפיצה הקודמת. בין הקפיצות — אפס תזוזה.
   const-ים ב-`scroll-follow.ts` (פונקציה טהורה `shouldFollowJump`, TDD) → calev מכוונן חי.
2. **distance על-פני throttle** — המשתמשת בחרה מרחק (מסתגל למהירות הזרם) על-פני שעון.
3. **קפיצה תמיד מלאה לסוף — page-cap נדחה מפורשות.** המשתמשת לא רוצה הליכת-מסך; בלוק-כלי גדול →
   קפיצה אחת לסוף (לקרוא אותו = לגלול למעלה = hold). snap-to-line מיותר בגרנולריות בועה.
4. **toggle ידני של בועה = user-intent = hold** — פתיחה/קיפול tool/thought הוא קליק (לא scroll
   event) → ה-handler מאותת `chatScroll.noteUserIntent?.()`; המוטציה ב-AppShell (חוק זהב #4).
   בלי זה, פתיחת כלי במצב follow הייתה מקפיצה לסוף במקום לתת לקרוא.
5. **turn-boundary = force-follow** — prompt חדש מדליק follow + קופץ לקצה, גם אם היית ב-hold.

**מה זה שינה ב-brief**: Commit 0 קיבל פונקציה טהורה שנייה (`shouldFollowJump`); Commit 2 שוכתב
מ-re-pin רציף ל-batched-tick; Commit 3 קיבל toggle-intent (נוגע ב-ToolBubble/ThoughtBubble) +
turn-boundary. complexity נשאר 8 (קצה עליון). plan_verified→false עד אביגיל READY מחדש.

**רעיונות שנדחו בדיון הזה**: continuous re-pin (קופצני — הבעיה המקורית); throttle-by-time
(distance עדיף); page-walk/page-cap (המשתמשת רצתה קפיצה מלאה); snap-to-line (מיותר); hold-target
(נשאר future); split לסלייס נפרד (אותו משטח קוד בדיוק — לא לשגר-ואז-להחליף).

## 2026-06-25 — roadmap-reconciliation: קיפול הצעות-סשנים שלא תועדו ל-roadmap

### רציונל
ביקורת-כיסוי: סריקת 22 סשנים אחרונים (21–25/6) מול `docs/roadmap.md` (grep + git) חשפה
שהצעות מהותיות שנדונו — חלקן עם **brief מאושר** — מעולם לא נכנסו ל-roadmap. זה בדיוק מה
שהמשתמשת ביקשה למנוע ("תתעד הכל ב-Roadmap, שאם לא נספיק — לפחות יישאר כתוב", session b1f98c82).

### מה נוסף ל-roadmap
**Track C (Message & Input UX backlog) — 7 פריטים:**
- `session-prefs-per-cwd` — 🟢 brief READY (r3, Complexity 7), היה **חסר לגמרי** מה-roadmap למרות brief מלא.
- `display-toggle-consistency` — 🟢 brief READY (Complexity 3).
- `fix-claude-duplicate-bubbles` — 🟡 brief טיוטה (Complexity 6, fork ל-adapter).
- `RLM / תווים משבשי-markdown` — 🔄 בעבודה כעת ע"י סוכן (נדון+שוגר ב-5f8fcb92); לאמת branch/commit בסיום.
- `permission UI` (אישור-בקשות) — 💭 טרם brief.
- `ID יציב לכלי` (שורש snap-back) — 💭 טרם brief.
- `עקביות themes` — 💭 רעיון.

**Track A — 1 פריט:** הזרקת prompt-מערכת מותאם-אודיו פר-CLI (claude flag / opencode plugin / codex app-server).

**עדכוני-מסגור (לא פריטים חדשים):**
- הערת-סיכון Anthropic: נוספה דרך-מיטיגציה לחקירה (פרוטוקול ה-VSCode extension מול Claude Code, לשמירה על pool-המנוי).
- Future "Backend-managed transport": עודכן לשקף כוונה אקטיבית יותר — להפוך את ספריית-הספקים לגשר הדרגתי (frames↔WS/SSE/HTTP/ACP, שלב ראשון רק אישור-בקשות).

### תיקוני-מצב (stale)
- `latex-math`: ההערה "dispatch אחרי merge chat-render-polish" הוסרה — chat-render-polish **מוזג** (`cc5ff66`), הסלייס unblocked.
- אומת ב-git ש-`enter-toggle` ו-`chat-render-polish` מוזגו ל-dev; הסתירה לכאורה ב-brief של display-toggle ("enter-toggle טרם מוזג") היא הערה מיושנת בלבד — חשש merge-ordering נפתר.

### רעיונות שנדחו / מחוץ ל-scope כעת
local-file-proxy (כבר ב-roadmap, נדחה ע"י המשתמשת ל"אחרי B"). לא בוצע merge/push — שינוי docs בלבד.

## 2026-06-25 — slice-session-title-header: כותרת הסשן בהדר הצ'אט

### רציונל
פריט "גל ראשון quick-win" מה-Message&Input UX backlog. ה-`title` כבר קיים ב-`SessionInfo`
(מ-`listSessionsForCwd`) ומוצג ב-`SessionPicker`/`SessionCard`, אבל **לא** חווט ל-`AgentSession`
הפעיל → לא נראה בהדר ה-`/chat` (שמציג placeholder קבוע `"drive-coding"`). תיקון: שדה
`$state sessionTitle` חדש ב-VM, חיווט מ-connect, ו-`AppHeader` מציג עם fallback ל-placeholder
הקיים (אפס regression לסשן חדש). **auto-generate (`generate_session_title`) מחוץ ל-scope** —
future נפרד; הכותרת היא snapshot מרגע הטעינה, ללא תלות ב-wire (זה מה שהפך אותו מ-spike לסלייס קטן).

### שינויי-כיוון — אביגיל הצילה מ-regression שקט
ה-brief הראשון חיווט **רק** את `loadSession`, עם סמנטיקת `sessionTitle = input.title ?? ""`.
אביגיל (r1, USABLE-AFTER-FIX) תפסה שזה משאיר שני נתיבי-כניסה חיים שמאפסים את הכותרת בשקט
(לא נתפס ב-typecheck, כנראה גם לא ב-calev light):
1. **`switchSession`** — הנתיב ה**ראשי** להחלפת סשן בצ'אט (מ-`SessionOptionsPanel`), לא חווט כלל.
2. **`#coldReconnect`** — קורא `loadSession` בלי title → כל WS-reconnect היה מוחק את הכותרת.

ההכרעה המתקנת: **keep-on-undefined** — `sessionTitle = input.title ?? this.sessionTitle`.
קורא שלא יודע title (reconnect) **שומר** במקום למחוק (תיקון אוטומטי, אפס שינוי ב-`#coldReconnect`);
רק נתיבים שיודעים title-חדש (connect/switch) מעבירים `string` מפורש (גם `""` כדי לנקות כראוי
בהחלפה לסשן חסר-כותרת); רק `newSession` מאפס. r2=READY.

### רעיונות שנדחו
- **שדה פרטי `#sessionTitle` שמשוחזר ב-reconnect** (הצעת אביגיל א'): מיותר — keep-on-undefined
  על השדה הציבורי מספיק ופשוט יותר (אין כפילות state).
- **צמצום scope ("warm-switch+reconnect לא בסבב")** (הצעת אביגיל ב'): נדחה — warm-switch הוא
  הנתיב הנפוץ; כותרת שנעלמת בהחלפת-סשן = בדיוק החוויה השבורה שהפריט בא לתקן.
- **fallback ל-"סשן חדש"**: ברירת-המחדל היא שימור ה-placeholder הקיים (`"drive-coding"`) — אפס
  regression, אפס i18n חדש. נשאר כשאלה פתוחה לא-חוסמת (§9) למשתמשת.

## 2026-06-25 — slice-display-toggle-consistency: פולריות אחידה למחווני "תצוגת צ'אט"

### רציונל
המשתמשת תפסה חוסר-עקביות: בכרטיס "Chat display" (מ-chat-render-polish) מחוון אחד
("Collapse thoughts" — ON מסתיר) ואחר ("Expand tools" — ON מציג) בעלי **פולריות הפוכה**.
באותו כרטיס, הפעלת מתג אחד מסתירה ואחרת מציגה — מודל מנטלי שבור. אומת בקוד:
`ThoughtBubble:34` = `open = !collapseThoughts` (שלילי); `ToolBubble:30` = `open = expandTools`
(חיובי). השורש: ב-chat-render-polish כל מתג נוסח כ-"opt-in לשינוי מברירת-המחדל" (מחשבות
פתוחות, כלים סגורים) → פולריות לא-עקבית כתוצר-לוואי.

**ההכרעה**: לאחד לפולריות חיובית אחת — `showThoughts`/`showTools`, **ON תמיד מציג**.
ההתנהגות-בפועל של ברירות-המחדל נשמרת (`showThoughts:true`=מחשבות מוצגות,
`showTools:false`=כלים מצומצמים) — רק המודל המנטלי נעשה עקבי. **migration ב-`load()`**
ממפה מפתחות ישנים (`!collapseThoughts`→`showThoughts`, `expandTools`→`showTools`) כדי
שמשתמשים קיימים לא יאבדו העדפה.

### ממצאי אביגיל
verdict=**READY** (0 חוסמים, 2 findings). 🟡: מספרי שורות ה-reset (178-179) נכונים
ל-dev הנוכחי, אך אם enter-toggle מוזג קודם — שורת `setEnterToSend` נכנסת ביניהן והמספרים
זזים; חודד ב-§4 (אתר ע"י grep, לא מספרים). 🟢: ה-spread ב-`load()` נושא מפתחות-ישנים
ל-runtime — מאושר ב-brief (נופלים בשמירה הבאה). אומת: ה-rename מלא (grep=0), לוגיקת
migration נכונה, snap-back נשמר (`$state` מקומי, לא reactive). דוח:
`reports/drive-coding/slice-display-toggle-consistency-avigail.md`.

### שינויי-כיוון / merge-ordering
- **תלות-מיזוג ב-enter-toggle** (GO, טרם מוזג): שני ה-slices נוגעים בכרטיס + reset.
  הכרעה פתוחה (§9 Q1): למזג enter-toggle קודם (לינארי, נקי) **או** לשרשר slice זה עליו.
  ממתין להכרעת המשתמשת לפני dispatch.

### רעיונות שנדחו
- **לא לגעת (known issue בלבד)** — נדחה; המשתמשת ביקשה עקביות מפורשות, וזה מחמיר עם
  המתג השלישי (enterToSend) שנכנס לאותו כרטיס.
- **להפוך את `expandTools` לשלילי** (כדי "להתאים" ל-collapse) — נדחה; חיובי ("Show")
  הוא המודל הברור; הפכנו את `collapseThoughts` אליו, לא להפך.
- **בלי migration** (ערך ישן נופל ל-default) — נדחה; זול לשמר העדפה (2 תנאים ב-load).
## 2026-06-25 — slice-latex-math-invisibles: נרמול range של תווים בלתי-נראים (relocate-or-delete)

### רציונל
ה-fix הקודם (slice-latex-math-bidi-fix) תיקן RLM בתחילת שורה אבל התגלה **חלקי** באימות חי:
טבלאות נשברו מ-RLM ש**אחרי** ה-`|` בשורת ה-separator (`|‏---|`) — מיקום שהנרמול לא כיסה.
אבחון אמפירי שיטתי (מטריצת **10 תווים בלתי-נראים × 6 מיקומים**) הראה ש**כל משפחת התווים**
(bidi-control, zero-width, soft-hyphen, NBSP) שוברת את **כל** המיקומים התחביריים — לא רק RLM,
לא רק תחילת שורה. תיקון-מונחה-תסמינים כשל פעמיים → עברנו לאסטרטגיה כללית.

ההכרעה: עיקרון אחיד — *"הצמד את התו הבלתי-נראה לטקסט אמיתי; מחק רק באזורי-תחביר-טהור."*
מומש כ-`normalizeInvisibles` (מחליף את `normalizeLineLeadingBidi`): char-class של **range** (לא רשימה),
+ NBSP→רווח, + strip בשורות separator ובתוך math-spans, + relocate בתחילת שורה, + שמירה בתוכן.
הורץ אמפירית: **16/16** (כל המטריצה + שמירת RLM בתוכן).

### ממצאי אביגיל (2 סבבים)
- **r1 = USABLE-AFTER-FIX** (3 findings): (🔴) `markdown.ts:41` עושה re-export של `normalizeLineLeadingBidi`
  — מחיקת הסמל בלי עדכון ה-re-export שוברת typecheck (`verbatimModuleSyntax`). (🟡 **המהותי**) ה-inline
  `$..$` strip תופס **מחירים** (`$5 .. $10`) ומוחק מהם invis = content-mutation שקט שלא נתפס בטסטים.
  (🟡) מקור ה-import של ה-unit test לא צוין. אביגיל אימתה את ה-reference 16/16 עצמאית.
- **r2 = READY** (0 חוסם) — שלושת התיקונים אושרו.

### שינויי-כיוון
- מ"נרמול RLM בתחילת שורה" → **range של כל הבלתי-נראים, בכל מיקום** (אבחון המטריצה).
- math-span strip **הוגבל ל-`$$`/`\[`/`\(`** (הוסר `$..$` inline) — בעקבות finding #2 (מחירים). invis בתוך
  `$x$` inline math נדיר נשאר → רעש `unknownSymbol` קל ב-KaTeX, מחיר מקובל מול הגנה על מחירים/קוד.

### רעיונות שנדחו
- **strip גורף של כל הבלתי-נראים** (אסטרטגיה B) — נדחה לטובת relocate-or-delete של המשתמשת: שומר את ה-RLM
  בתוכן אמיתי (מועיל ל-`dir="auto"` ב-block שמתחיל בלטינית), מוחק רק היכן שאין טקסט.
- **טלאי per-{תו×מיקום}** (אסטרטגיה A) — gap-prone; כשל פעמיים. range + עיקרון אחיד מחליף.

## 2026-06-25 — slice-latex-math-bidi-fix: נרמול bidi-marks בתחילת שורה (heuristic היברידי)

### רציונל
אחרי merge-ready של `slice-latex-math`, אימות חי בדפדפן (linux-gui) חשף ש**טבלאות ונוסחאות display
לא רונדרו** — נשארו markdown גולמי. אבחון אמפירי (marked+katex ישירות, ואז `renderMarkdown` ב-jsdom)
הוכיח ש**`marked` ו-`DOMPurify` תקינים לחלוטין** — ה-root-cause הוא **תווי bidi-control (RLM, U+200F)
שמרדכי/המודל מזריקים בתחילת שורות עבריות** (כללי ה-RTL של ה-CLI). marked עוגן block-tokenizers ל-`^`
(`^#`/`^|`/`^>`/`^-`); RLM יושב שם וחוסם → הבלוק הופך לפסקה גולמית. אירוניה: כללי-ה-RTL שברו את הרינדור.

ההכרעה: **heuristic היברידי** של נרמול-bidi בתחילת שורה (לא מחיקה גורפת):
- לפני **block-marker נושא-טקסט** (`#`/`-`/`>`/`|`/`1.`) → **דחוף** את ה-RLM אל אחרי ה-marker.
  כך marked מזהה את הבלוק, וה-RLM נוחת בתחילת התוכן → `dir="auto"` של ה-element בוחר RTL נכון
  (heading שמתחיל במילה לטינית עדיין מיושר ימין).
- לפני **math-marker** (`$$`/`\[`) → **מחק** את ה-RLM (נוסחה היא LTR; RLM בתוך LaTeX = `unknownSymbol` ב-KaTeX).
- לפני **טקסט רגיל / באמצע שורה** → **השאר** (RLM שם ניטרלי/מועיל — לא נוגעים בכוונת המשתמש).

בנוסף: **פיצול `markdown-parse.ts` (טהור, בר-בדיקה ללא DOM) / `markdown.ts` (עוטף-סניטיזציה)** — internal
boundary בתוך FE, ה-export הציבורי היחיד נשאר `renderMarkdown`, האבטחה (two-pass) לא משתנה.

### ממצאי אביגיל (2 סבבים)
- **r1 = USABLE-AFTER-FIX** (3 findings, אין blocker): (#1) פקודת typecheck השתמשה ב-`@drive-coding/frontend`
  במקום `-v2` → "No projects matched"+exit-0 = **typecheck פאנטום** (קריטי כי Commit 2 הוא refactor רגיש-אבטחה).
  (#2) בעלות `replacePlaceholders`/sentinels ב-Commit 2 הייתה דו-משמעית. (#3) framing: `$$`/`\[` כבר עובדים
  עם RLM (start()=indexOf) — החסימה רק ל-block-markers. אביגיל אימתה אמפירית את ה-regex (9 תרחישים) ואת
  ה-edge-cases (RLM כפול, marker בלי רווח, `|` בטבלה) — כולם נכונים.
- **r2 = READY** (0 findings) — שלושת התיקונים אושרו.

### שינויי-כיוון
- מהשערה ראשונית "הבאג ב-`breaks:true` / ב-DOMPurify allowlist" → אחרי אבחון אמפירי: **הקלט (bidi-marks), לא הקוד**.
  marked+DOMPurify חפים. תובנת המשתמשת ("אולי קשור לסניטיזציה") כיוונה לפסילת ה-allowlist כחשוד, מה שמיקד את האבחון.
- מ"מחיקה גורפת של bidi בתחילת שורה" (הצעת מרדכי הראשונה, A) → **heuristic היברידי** (דחיפה/מחיקה/השארה).
  תובנת המשתמשת: "אי אפשר לדחוף RLM אל הטקסט במקום למחוק?" — אומת ש-`dir="auto"` הופך דחיפה לעדיפה (משמרת RTL).

### רעיונות שנדחו
- **העברת הרינדור ל-`core`** — נדחה: DOMPurify דורש DOM (אסור ב-core); זה view-concern; אין צרכן מחוץ ל-FE.
- **מחיקה גורפת (A)** — over-reach: מסיר RLM לגיטימי מטקסט רגיל.
- **strip רק לפני רשימת-markers קשיחה (C)** — שביר (מתיישן בהוספת תחביר); ההיברידי משתמש ב"דחיפה" שלא דורשת זאת.
- **דחיפת RLM גם לתוך math** — נדחה: KaTeX פולט `unknownSymbol` (אומת אמפירית).

## 2026-06-25 — slice-latex-math: רינדור LaTeX/KaTeX עם allowlist פר-מקור

### רציונל
רינדור נוסחאות (KaTeX) בכל 4 הסגנונות (`$`,`$$`,`\(`,`\[`). ההכרעה המרכזית — **אבטחה**:
KaTeX מייצר HTML עם inline `style` (positioning), שמנוגד ל-policy שאסר `style` ב-DOMPurify
(vector ל-CSS-injection). הפתרון הסופי: **allowlist פר-מקור (two-pass)**, לא רשימה כללית אחת.

- **המנגנון**: extension פנימי (`marked.use`) שמזהה math (מכבד code blocks דרך ה-pipeline,
  לא regex) ומפיק **placeholder**; `renderMarkdown` עושה two-pass: ה-markdown עובר
  `MARKDOWN_ALLOW` (שמרני, **בלי span/style**), וכל KaTeX עובר `KATEX_ALLOW` (נדיב: span/style/
  MathML/SVG) **בנפרד**, ואז מוזרק. ה-`span`+`style` קיימים אך-ורק במסלול KaTeX (input מהימן:
  generated, `trust:false`). span גולמי של מודל-מתחזה (prompt-injection) → נמחק.
- **secure by construction, לא by filtering**: לא "מסננים" CSS מסוכן (ומקווים שה-allowlist מושלם)
  — פשוט לא יוצרים את ההרשאה במסלול הלא-מהימן.

### ממצאי אביגיל (3 סבבים — אומת אמפירית, לא בהנחה)
- **r1 = NEEDS-REWORK**: ההכרעה המקורית ("התר `style` גלובלי כי DOMPurify מסנן `url()`/`javascript:`")
  הייתה **שגויה עובדתית** — אביגיל הריצה DOMPurify ואימתה ש-style עובר verbatim. **טעות של מרדכי**;
  אביגיל תפסה לפני קוד. (הסיכון האמיתי: overlay-phishing/exfiltration דרך prompt-injection, **לא** RCE — מת ב-2026.)
- **r2 = USABLE-AFTER-FIX**: ה-two-pass אומת אמפירית — כל 5 ההנחות (בידוד span-strip, re-inject ≠ modify-after,
  PUA sentinel שורד, marked-extension API, map per-call). נותרו 3 דיוקים.
- **r3 = USABLE-AFTER-FIX + אישור-מותנה**: KATEX_ALLOW הושלם (mtable/sum/vector...), אומת שאין tag מסוכן.
  4 ערכי-MathML שוליים (`mpadded`/`linethickness`/...) נוספו → READY.

### שינויי-כיוון
- מ"התר style גלובלי + סנן" (r1) → "allowlist פר-מקור, style מבודד ל-KaTeX" (r2+). תובנת המשתמשת:
  ה-CSS המסוכן מגיע מ-HTML-גולמי-של-מודל, לא מ-KaTeX/LaTeX → לבנות כך שלא קיים, לא לסנן.
- `marked-katex-extension` הוסר — extension פנימי שולט בכל ה-delimiters (פותר גם `\(`/`\[`).

### רעיונות שנדחו
- **`style` גלובלי + DOMPurify** — שגוי (style עובר verbatim).
- **placeholder re-inject בלי sanitize נפרד** — מפר אזהרת DOMPurify "modify-after".
- **MathML-only** — בטוח-מבנית ופשוט יותר, אך KaTeX-HTML מלוטש יותר; נבחר two-pass לטובת ה-rendering.
- **CSS-sanitizer hook (uponSanitizeAttribute)** — תקף (המלצת DOMPurify), אך per-input בטוח-מבנית יותר (לא תלוי בשלמות allowlist של CSS-properties).

## 2026-06-24 — slice-enter-toggle: ביטול שליחה ב-Enter (toggle)

### רציונל
ראשון ב-"Message & Input UX backlog" (Track C, נקלט מהתנסות המשתמשת). נבחר כ-quick-win
ראשון כי כל התשתית קיימת: ה-handler ב-`TypeArea` כבר מבחין Enter/Shift+Enter, ותשתית
ה-settings (Persisted + reset) קיימת מ-chat-render-polish. השדה `enterToSend` ברירת-מחדל
`true` → **התנהגות נוכחית נשמרת**, אין הפתעה למשתמש קיים. כש-off: Enter=שורה-חדשה, שליחה
בכפתור (תמיד קיים — ידידותי-נייד) או Cmd/Ctrl+Enter. Cmd/Ctrl+Enter שולח בשני המצבים
(power-user עקבי).

**הכרעת depends_on**: התבסס על `chat-render-polish` (לא dev הנקי) — הוא מוסיף את כרטיס
"תצוגת צ'אט" ב-SettingsScreen + דפוס Persisted ל-toggles, וה-toggle החדש נכנס לאותו כרטיס.
base = dev אחרי merge של chat-render-polish. **חוסם dispatch**: chat-render-polish חייב
להתמזג ל-dev ראשון.

### ממצאי אביגיל
verdict=**READY** (0 חוסמים, 2 findings ירוקים). #1: הפניה קוסמטית — `en.ts:196` היא
שורת-הערה (expandTools ב-197-199); הוראת-ההוספה עצמה נכונה — תוקן ה-ref. #2: ל-keydown
החדש אין guard ל-`e.isComposing`/IME — אבל גם ל-baseline אין, אז זו **לא רגרסיה** שה-brief
מכניס (קיים-מראש, מחוץ ל-scope). אומת שקריאת `settings.enterToSend` בתוך event-handler
אינה בעיית reactivity של Svelte 5 (קריאת-ערך, לא render). דוח: `reports/drive-coding/slice-enter-toggle-avigail.md`.

### רעיונות שנדחו
- **כרטיס "קלט" נפרד ב-settings** — נדחה; ה-toggle שייך-לוגית לתצוגת-הצ'אט, חוסך כרטיס.
- **לשנות Enter ל-newline ללא הגדרה (swap קשיח)** — נדחה; שובר ציפייה של משתמשים קיימים.
  toggle עם default=current שומר תאימות-לאחור.
- **IME isComposing guard** — לא נכלל בסבב (out-of-scope, pre-existing); מועמד ל-polish עתידי.

## 2026-06-24 — slice-chat-render-polish: טבלאות MD + תמונות בכלים + העדפות-תצוגה

### רציונל
שלושה שיפורי-רינדור בצ'אט אוחדו ל-**brief אחד עם 3 commits עצמאיים** (לא 3 slices נפרדים).
הסיבה: שלושתם נוגעים ב-`ToolBubble.svelte`. בתחילה תוכננה שרשרת A→B→C כדי להימנע מ-merge
conflicts בין branches — אבל ב-worktree יחיד אין conflicts כלל, כך שהנימוק לפיצול ביטל את
עצמו. הנושאים קטנים, קוהרנטיים ("שיפורי רינדור"), ועצמאיים-לוגית, אז commit-per-נושא מאפשר
merge חלקי אם אחד מסתבך — בלי overhead של 3 dispatch/אביגיל/כלב/merge.

- **טבלאות MD**: השורש — `markdown.ts` ALLOWED_TAGS חסר תגי טבלה, DOMPurify מוחק את מה
  ש-marked כבר מייצר (`gfm:true`). תיקון: allowlist + `align` (marked מייצר attr, **לא** style)
  + CSS. אומת ש-marked v18 פולט `<th align="left">`.
- **תמונות**: ACP `image` content (`{data:base64, mimeType}`) מופה היום ל-`{type:"other"}`
  ומודפס כ-JSON. הוספת `ToolContentImage` + רינדור `<img>`. גם `resource` blob עם `image/*`
  (אותו רינדור). **SVG מתירני** — `<img>` מנטרל scripting ב-secure-static-mode, עם invariant
  מתועד "רק `<img>`, לעולם לא inline".
- **העדפות-תצוגה**: ברירות-מחדל שומרות התנהגות נוכחית (`collapseThoughts:false`,
  `expandTools:false`); רק ה-default נשמר ב-settings, override ידני per-bubble הוא per-render.

### ממצאי אביגיל
verdict=**READY** (0 חוסמים, 2 findings ירוקים). #1: כפתור reset סלקטיבי ולא גלובלי —
ניסוח "עקביות" תוקן. #2 (משמעותי): `ToolBubble:121` כופה reactivity על `tc.status`; חשש
ל-snap-back שיכפה `open` מחדש ויבטל קיפול ידני באמצע turn. ב-Svelte 5 fine-grained כנראה
לא קורה, אך חוזק ב-§6 כ-risk עם הנחיית בדיקה-בפועל + פתרון נפילה (local `$state` per-bubble).
(הערה: אביגיל לא כתבה קובץ report פיזי — ה-verdict+findings תועדו כאן מהתמצית.)

### שינויי-כיוון
- מ-3 briefs בשרשרת → brief אחד / 3 commits (בקשת המשתמשת; הנימוק לשרשור קרס תחת worktree יחיד).
- `resource_link` (`file://`) **הוצא מ-scope** — דורש BE proxy לקבצים מקומיים (LFI/path-traversal),
  נרשם ב-roadmap כ-slice **local-file-proxy** נפרד (Track C, תלוי ב-slice זה).

### רעיונות שנדחו
- **שמרני ל-SVG** (raster בלבד): נדחה — `<img>` בטוח, ו-SVG נפוץ בפרויקטי קוד.
- **persist של מצב פתוח/סגור per-bubble**: נדחה — רק ה-default נשמר, override ידני per-render.
- **audio / resource-text content**: future (סוגי מדיה אחרים, fallback ל-JSON נשמר).

## 2026-06-22 — slice-wake-lock: מתג "השאר מסך דלוק" + WakeLockEngine

### רציונל

באג שמטריד בעיקר בנייד: המסך נכבה באמצע שהסוכן עובד / בזמן האזנה לתשובה. ה-Web
**Screen Wake Lock API** פותר בדיוק את זה. בקשת המשתמשת: שזו תהיה **הגדרה** שניתן
להדליק/לכבות, לא התנהגות כפויה. הפיצ'ר כבר ברודמ"פ — Track C, "drive-first chrome
(car mode, Media Session, **wake lock**)".

**הכרעת סמנטיקה: נעילה כל-עוד-הטאב-גלוי, לא רק-בזמן-turn-פעיל.** מתג שהמשתמשת מדליקה
במפורש צריך להיות צפוי — מסך שנכבה באמצע קריאת תשובה ארוכה (כי ה-turn הסתיים) הוא
הפתעה גרועה. בהקשר hands-free/נהיגה רוצים את המסך דלוק לאורך כל ה-session כדי להעיף
מבט. הסוללה היא tradeoff שהמשתמשת בוחרת מדעת (opt-in, default `false`). עידון עתידי
"רק בזמן פעילות" (חיסכון סוללה) אפשרי בסלייס שיגדיר "פעילות" (turn/mic/speaker).

**הכרעת ארכיטקטורה: `WakeLockEngine` (engines/) owner של ה-`WakeLockSentinel`, מחווט
דרך `$effect` יחיד ב-`+layout.svelte`** — לא ב-VM. זו סטייה **מודעת** מחוק-הזהב 4 של
ה-FE (`AGENTS.md:70`), שנותן דוגמה "`Mic.state === recording` צריך wake-lock? → ב-Mic"
— כלומר מחברי ה-design דמיינו wake-lock בתוך VM. ההצדקה: כאן הנעילה גלובלית-לאפליקציה
ולא נגזרת מ-state של entity יחיד, אלא ממתג גלובלי (`settings.screenWakeLock`). זה בדיוק
המקרה של ה-`$effect` הקיים של dir/lang sync, שכבר חי ב-`+layout` כי `<html>` הוא
app-global. ה-engine **לא** ב-`context.ts` — אף component/VM לא צורך אותו (רק +layout
מזין), אז context pair היה dead code.

ה-gotcha המרכזי של ה-API מעוגן ב-DoD (#6): הדפדפן משחרר את הנעילה אוטומטית בכל הסתרת
טאב, ולא מחזיר אותה לבד — לכן ה-engine מאזין ל-`visibilitychange` ותופס-מחדש.

### ממצאי אביגיל

r1 = **READY** בסבב ראשון (נדיר — track record היה 100% briefs-with-issues עד כה). 3
findings, כולן 0-min: (#1 🟡) חוק-זהב 1 מונה 'wakelock' מפורשות כ-side-effect אסור
ב-`$effect` — ה-brief מפרש כ-routes-only, עקבי עם precedent של dir/lang (לא חוסם,
ומתועד מראש ב-brief); (#2 🟢) אין precedent ל-`dispose()` ב-engines (cues חושף
`close()`); (#3 🟢) snippet UI בלי wrapper `divide-y`. כל 8 ה-spot-checks אומתו factual
(דפוס muted, `$effect` של dir/lang, חתימת `SettingToggle`, `WakeLockSentinel` ב-DOM lib).

### שינויי-כיוון

קלים בלבד — קיפלתי את שתי ה-🟢 לתוך ה-brief כהבהרות (dispose סינכרוני במכוון ≠ close
אסינכרוני; toggle בודד לא צריך wrapper) כדי לאטום אותו. הסמנטיקה והארכיטקטורה לא השתנו.

### רעיונות שנדחו

- **נעילה רק בזמן turn פעיל** — חיסכון סוללה אבל כיבוי מפתיע באמצע קריאה. נדחה ל-v1,
  אופציה לעידון עתידי.
- **wake-lock בתוך VM (Mic/AgentSession)** — מה שחוק-זהב 4 מרמז עליו. נדחה כי הנעילה
  גלובלית-לאפליקציה, לא נגזרת מ-entity יחיד; +layout הוא ה-owner הנכון (כמו dir/lang).
- **`WakeLockEngine` ב-`context.ts`** — dead code (אין צרכן מלבד +layout).

## 2026-06-21 — slice-session-prefs-per-cwd: שמירת state של סשן פר-פרויקט בצד שרת

### רציונל

המשך-ישיר לאבחון של "הריצה נעצרת": גילינו ש-`bypassPermissions` פותר את התקיעה (האדפטר עושה
short-circuit ולא שולח `request_permission` — אומת חי על agent `920d6c43`), אבל הבחירה במצב
**לא נשמרת** — היא runtime-only (`session/set_config_option`) לאותו סשן. בכל סשן חדש המשתמשת
נאלצת לבחור מחדש.

**ההכרעה: לשמור את ה-state של הסשן (mode/model/agent/config) פר-`(cwd, cliKind)` בצד שרת, לא ב-localStorage.**
הנימוק המכריע — drive-coding הוא **multi-device מעצם הגדרתו** (voice/car/mobile): בוחרים
`bypassPermissions` במחשב בבית, נכנסים לרכב ומתחברים מהטלפון לאותו BE — וצריך שייזכר.
localStorage שובר את זה כי הוא per-device. אחסון ב-BE מסתנכרן בין כל המכשירים המחוברים לאותו
שרת, וה-`cwd` ממילא שייך לוגית ל-BE (זה ה-filesystem שלו). זה גם צעד ראשון עקבי לכיוון
backend-managed (state נודד ל-BE).

**ההחלטה על הנתיב**: כל ה-stores עוברים מ-`<worktree>/data/` (מעורבב בקוד, נפרד בין dev/main)
ל-`~/.drive-coding/` — תיקיית בית יציבה, משותפת בין deployments, עם `DRIVE_CODING_DATA_DIR`
override קריטי כדי שבדיקות/worktrees לא יזהמו data חי. migration של recordings/cache קיימים
= פעולה תפעולית-ידנית (`cp -n`), **לא** קוד-startup, כדי לא לסכן data חי ב-race.

### ממצאי אביגיל

3 סבבים עד READY. r1 = USABLE-AFTER-FIX (6 findings, 2×🔴): (#1) הנחתי מסלול `newSession` יחיד
אך יש **שניים** fresh (`attach()` ו-`newSession()` ציבורי) מול שלושה load/warm — תוקן עם helper
`#captureSessionConfigFresh`; (#2) Commit 3 (voice) הסתמך על `applyRuntimeMuted` שלא קיים — voice
דורש runtime-tier ב-`Settings`. r2 = USABLE-AFTER-FIX (4 findings, 0×🔴): `applyConfigOption` יש
בו **5** success-returns לא 3 (תוקן עם wrapper boolean); `SavedSessionState` חייב לשבת ב-core ולא
ב-backend (אחרת coupling FE→backend שלא קיים היום); `buildAvailableModes` הוא בקוד האדפטר החיצוני
לא ב-drive-coding. r3 = READY (2×🟢 cosmetic). track record נמשך: 100% briefs עם בעיה אמיתית.

### שינויי-כיוון

תוכנן תחילה client-side (localStorage) — המשתמשת עצרה ושאלה "צד שרת או לקוח?", מה שחשף שה-multi-device
שובר את גישת ה-localStorage. שונה ל-BE. בעקבות ממצא אביגיל r1, **voice/muted נדחה ל-slice נפרד**
(`slice-voice-prefs-per-project`) — tier שונה (UI-prefs ב-localStorage מול ACP session-config),
דורש runtime-override layer ב-`Settings`. הסלייס הזה התמקד ב-session-config בלבד.

### רעיונות שנדחו

- ‏**localStorage (per-device)** — נדחה בגלל multi-device (הליבה של drive-coding).
- ‏**migration אוטומטי ב-startup** — נדחה (סיכון race/partial-copy על recordings חיים); ידני במקום.
- ‏**voice override-on-top באותו slice** — נדחה (mechanism `applyRuntimeMuted` לא קיים, tier נפרד) → slice ייעודי.
- ‏**`permissions.defaultMode` ב-claude settings** (חלופה ללא קוד) — נדחה כפתרון ראשי: גלובלי לכל ה-CLIs, לא מבודד ל-drive-coding, ולא נותן את חוויית ה-UI.

## 2026-06-21 — slice-release-cli-hardening: fixtures strip + CLI flags + --help

### רציונל

קידום ה-NPM package `drive-coding` (packages/release/) לקראת publish. שתי מטרות אמיתיות:
(1) הסרת דליפה — `frontend-dist/fixtures/` (~2MB sessions מוקלטים, כולל `salary-*.json`
שנשמעים אישיים) נכנס ל-tarball הציבורי. הם DEV-only (`MOCK_FIXTURES` מאחורי
`import.meta.env.DEV`), לכן מוחרגים מהעותק של ה-release ב-build.mjs בלבד — dev לא נפגע.
(2) בקשת המשתמשת — config דרך flags (לא רק env vars) + `--help`. נוסף `parseArgs`
(`node:util`, בלי dependency), flags `--port/--opencode-bin/--fe-static-dir/--cors-origins`,
`--help`, `--version`, עם קדימות flag > env > default (flag דורס env דרך הצבה לפני ה-`??=`).

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX, **תפסה 🔴 קריטי**: ה-brief המקורי כלל "Commit 0 — תיקון FE path
resolution" בטענה שה-package שבור (404 מהתקנה נקייה). **הטענה הופרכה.** אומת עד הסוף:
`import.meta.dirname` בבאנדל נפתר נכון ל-`dist/`, ו-candidate `../frontend-dist` נבחר.
r2 = READY (1×🟢: `--port` לא-מספרי → NaN → bind שקט; קופל פנימה כולידציה).

### שינויי-כיוון

ה-FE-path "blocker" כולו נמחק מה-brief. ה-package **עובד ומוכן לפרסום כמו שהוא** —
ה-slice הוא שיפורים בלבד, לא תיקון.

### רעיונות שנדחו

- **תיקון FE path resolution (process.argv[1] במקום import.meta.dirname):** נדחה — אין באג.
- **config-file ממשי (JSON/TOML):** נדחה — flags מספיקים; env-vars נשארים מקור-האמת ש-flags דורסים.
- **חשיפת debug envs (LOG_WIRE/WIRE_RECORD) כ-flags:** נדחה — נשארים env-only (לא user-facing).

### לקח מתודולוגי (false-blocker)

ה-404 שהוליד את ה"blocker" המדומה נבע **אך ורק** מכך שה-session של מרדכי מייצא
`FE_STATIC_DIR=.../dev/packages/frontend/build` (מסקריפט הרצת dev) — זה דלף לכל בדיקת
install-נקי, וה-`??=` ב-bin היה no-op. עם `env -u FE_STATIC_DIR` + עץ dev מוסתר → 200
מה-`frontend-dist` הארוז. **כלל חדש שנכנס ל-brief**: כל בדיקת install חייבת `env -u
FE_STATIC_DIR -u CORS_ORIGINS -u OPENCODE_BIN`. ערך אביגיל כאן היה למנוע dispatch של
תיקון מיותר לבאג שלא קיים.

---

## 2026-06-19 — slice-wire-observability-bridge: העברת תצפית ה-wire לשכבת הגשר

### רציונל

המשך-ישיר ל-`slice-ws-error-survival`. אותו slice תיקן שה-child **שורד** ניתוק דפדפן, אבל
דיבוג חי (19/6) חשף שהתסמין האמיתי שונה ממה ש-§11 הניח: ברוב המקרים **התהליך לא מת — אבל
הריצה נעצרת**. כדי לאבחן את זה צריך לראות את זרם ה-wire של ה-agent **גם כשאין דפדפן** — וכאן
התגלה ה-gap: כל ה-wire observability (live log של `LOG_WIRE` ב-ns `backend.ws.wire`, וגם
`WIRE_RECORD`) חי **בתוך `ws-agent.ts`**, ב-`onLine` callback וב-message handler — שניהם
מתבטלים ב-`detach()` (`unsub()` + `rec.close()`). כלומר ברגע הניתוק אנחנו עיוורים בדיוק
כשצריך לראות. זה מה ש-Commit 3 (observability) של ה-slice הקודם לא כיסה — הוא הוסיף לוג ל-error
path, לא לזרם ה-stdout/stdin עצמו.

**ההכרעה: להוריד את נקודת-התצפית מהשכבה שמתנתקת (`ws-agent`) לשכבה שמחזיקה את ה-child ושורדת
(`bridge-manager`).** ה-reader הקבוע `stdoutRl` הוא כבר הבעלים של `child.stdout` ורץ כל חיי
ה-child → שם נכנס תיעוד כיוון ה-"in". כיוון ה-"out" עובר דרך method חדש `bridgeManager.writeStdin()`
(במקום `child.stdin.write` ישיר ב-ws-agent), שמתעד גם הוא. כך התצפית **סימטרית, רציפה דרך
disconnect→reconnect, ובלי פערים עיוורים**. ה-recording session הופך per-child-lifetime (לא
per-WS-connection). ה-ns עובר מ-`backend.ws.wire` ל-`backend.acp.wire` — סמנטי נכון (זה ה-CLI↔BE
wire, לא BE↔FE), וכבר ממופה ל-`LOG_WIRE=acp` ב-`core/log/config.ts`.

> **גבול scope מפורש**: הבריף **נותן את העיניים** לאבחן את "הריצה נעצרת" — הוא לא מתקן את
> התקיעה. ההשערה החזקה (FE הוא ה-ACP client → בקשת-קליינט שלא נענית כשאין דפדפן) תיבדק
> ב-slice נפרד, עם התצפית החדשה ביד.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (5 findings). ה-blocker (🔴 #1+#2): פספסתי call-site שלם —
`ws-agent-pipe.test.ts` עם 7 קריאות ל-`createAgentWsHandler` ו-mock `bridgeManager` בלי
`writeStdin`; הסרת `wireRecorder` מה-deps הייתה מפילה typecheck ב-7 מקומות, והמעבר ל-`writeStdin`
היה שובר את הטסט "FE message forwarded to child.stdin" **ב-runtime** (ה-mock לא כותב ל-stdin).
תוקן: §4.ד מפרט הסרת `wireRecorder` + הוספת `writeStdin` ל-mock. עוד: (#3) ה-return type הוא
inline object, אין שינוי ב-`core/ports.ts`; (#4) אין rec-leak ב-spawn-fail path (rec.open אחרי
pid-guard); (#5) `LOG_WIRE=ws` ב-`docs/deploy-local-service.md:99`, לא ב-systemd units. r2 = READY
(2 findings 🟢 קוסמטיים: off-by-one בציטוט שורות, walkthrough היסטורי out-of-scope).

### שינויי-כיוון

ה-blocker של אביגיל חידד שזה refactor שנוגע ב-**3 קבצי טסט** (לא אחד) — מה שהצדיק commit אטומי
אחד (in+out+recorder יחד) במקום פיצול, כדי להימנע מ-double-logging זמני.

### רעיונות שנדחו

- **לתעד `$/ping`/`$/pong` ב-wire** — נדחה: זה transport keepalive (BE↔FE, ענייני NAT), לא עובר
  ל-child ולא חלק מ-ACP wire. יורד מהתיעוד.
- **לפצל ל-2 commits (הוסף ל-bridge → הסר מ-ws-agent)** — נדחה: יוצר double-logging/recording זמני
  כי שתי השכבות היו מתעדות את אותו frame. commit אטומי במקום.
- **להשאיר `backend.ws.wire` כ-alias ל-backward-compat** — נדחה: אין צרכן קוד חי אחרי השינוי
  (אומת ב-grep), `LOG_WIRE=acp` מכסה. פחות בלבול.

## 2026-06-18 — slice-ws-error-survival: ניתוק דפדפן לא יפיל את ה-BE

### רציונל

המשתמשת דיווחה שכשחיבור הדפדפן משתבש/מתנתק, גם ה-CLI agent (claude-code/opencode)
מפסיק לרוץ — התנהגות לא-צפויה, שכן ה-backend הוא בעל התהליך. החקירה גילתה ש-`ws-agent.ts`
דווקא **נכון** בניתוק נקי (`feWs.on("close")` מבצע detach בלי `child.kill`). הבאג הוא
בניתוק **לא-נקי**: ה-socket פולט אירוע `'error'`, אין לו listener בשום מקום → ב-Node זה
throw → `uncaughtException` → ה-handler הגלובלי ב-`server.ts:14-20` עושה `process.exit(1)`
→ כל ה-backend נופל, וה-child (spawn ללא `detached`) מת כ-collateral.

**ההכרעה: שלוש שכבות.** (0) `feWs.on("error")` שמטפל כמו close (detach idempotent,
בלי kill) — חוסם במקור. (1) error listeners על `echoWss`/`agentWss`/ws-echo — סותם
מקורות WS error נוספים. (2) הגנה בעומק — `uncaughtException` מסנן transient socket
errors (`isTransientSocketError` טהור: ECONNRESET/EPIPE/ENOTCONN/ECONNABORTED/ETIMEDOUT)
ולא יוצא עליהם, אבל **שומר** `process.exit` לשגיאות אמיתיות (קו-הגנה אחרון לגיטימי).

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (2 findings, שניהם בתיאור הטסט/הבהרות — לא בקוד הייצור): (#1)
mock WS כ-EventEmitter לא מספק structurally את חתימת `ws.WebSocket` תחת strict → דרוש
`as unknown as WebSocket` (הבריף השמיט); (#2) `lint:i18n` חוסם רק string literals,
לא הערות — הבריף רמז על כלל מחמיר מדי. תוקנו. r2 = READY (1 finding 🟢 קוסמטי: ציטוט
מספר שורה :9→:6, עלות אפס — תוקן). כל ה-claims העובדתיים (שורות, symbols, paths)
אומתו 1:1, כולל אישור ש-ה-child לא detached ולכן מת עם ה-backend.

### שינויי-כיוון

- **שני באגים נפרדים זוהו, slice אחד מתקן רק את הקריסה.** ה-thrashing של אותו session
  בשני טאבים (MED-8 livelock) הופרד ל-slice עתידי (תועד ב-`roadmap.md` Track F) — בעיה
  של connection-arbitration, לא error-handling. לא מערבבים scope/verification.

### רעיונות שנדחו

- **ריכוך uncaughtException בלבד (בלי שכבה 0):** היה מסתיר את הבאג במקום לתקנו, ומסכן
  בליעת שגיאות אמיתיות. נדחה — שכבה 0 (טיפול במקור) היא התיקון הנכון; שכבה 2 רק
  belt-and-suspenders, מוגבלת לרשימת codes סגורה.
- **Backend-managed session ownership (HTTP/SSE transport):** פתרון-שורש לכל משפחת
  בעיות ה-WS, אבל refactor ארכיטקטוני גדול. נשאר ב-Future (roadmap) — לא נדרש כדי
  לעצור את הקריסה.

## 2026-06-16 — slice-npm-publish: אריזה ל-npm כ-tarball self-contained

### רציונל

המשך ישיר ל-slice-bunx-single-command (depends_on). המטרה: `bunx drive-coding`
מ-npm. הבדיקה הראתה ששני deps לא יושבים ב-registry — `@drive-coding/core` (workspace,
private, exports ל-`src/*.ts`) ו-`provider-contract` (git dep, 404 ב-npm, אבל בנוי עם
`dist/`). ההכרעה: **`bundledDependencies`** לשניהם — נארזים פנימה ל-tarball, בלי לפרסם
אותם בנפרד ובלי לדרוש git מהמשתמש הקצה.

ה-package המתפרסם = `packages/backend` ששמו משתנה ל-`drive-coding` (כבר מחזיק את ה-bin
ואת כל ה-runtime deps; אביגיל אימתה שאף אחד לא תלוי ב-`@drive-coding/backend` כ-import).
ה-FE build מועתק לתוך החבילה ב-`prepack` (`frontend-dist/`), וה-bin בוחר בין dev-path
ל-packaged-path לפי קיום הקובץ.

**Scope עד tarball שמתקין ורץ מקומית** — `npm publish` ל-registry הוא הצעד האנושי האחרון
(credentials + שם + אישור), מחוץ ל-slice.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (5 findings, 2 🔴). הקריטי (#1): `bundledDependencies` אורז את
**קבצי** core אבל לא את עץ ה-deps שלו — core מייבא `pino`/`pino-pretty`/`marked` שלא
מוצהרים ב-backend → התקנה נקייה קורסת ב-boot עם `Cannot find module 'pino'`, וזה נראה
מטעה כמו בעיית symlink. #2: ה-base branch (התלות) עדיין לא קיים. #4: `npm pack` מסרב
לארוז `private` bundledDependency. r2 = READY (נותר רק ה-gate התזמוני המתועד).

### שינויי-כיוון

- **הכרזת transitive deps על פני bundling רקורסיבי:** `pino`/`pino-pretty`/`marked`
  הוכרזו כ-`dependencies` של ה-package (מותקנים מ-registry), במקום לנסות לבנדל את כל
  עץ ה-deps של core. פשוט יותר ועמיד.
- **core הופך packable** (הסרת `private`, version 0.1.0) — בלי לפרסמו בנפרד.
- **gate תזמוני מפורש** ב-§0: ה-slice לא מתחיל לפני שה-branch של התלות קיים או נמרג ל-dev.

### רעיונות שנדחו

- **פרסום `@drive-coding/core` ו-`provider-contract` כ-packages נפרדים ל-npm:** "נכון"
  ל-monorepo אבל דורש תיאום-גרסאות ופרסום של 3 packages. נדחה לטובת bundledDependencies
  (חבילה אחת self-contained).
- **`npm publish` בתוך ה-slice:** נדחה — צעד אנושי אחרון אחרי merge.

## 2026-06-16 — slice-bunx-single-command: הרצה בפקודה אחת דרך bunx

> **2026-06-17 — מוזג ל-dev** (merge commit `ea7726f`, `--no-ff`). כלב: GO (light, 0 findings).
> מרדכי אימת runtime נוסף מעבר ל-DoD: `bun link` חשף את ה-`bin` כ-`drive-coding` גלובלי,
> הרצה מ-`/tmp` כפקודה עירומה → HTTP 200 + FE + API. אומת גם ש-`FE_STATIC_DIR ??=`
> מכבד env מפורש על פני ה-default (env precedence) כפי שתוכנן. אישור מיזוג מפורש מהמשתמשת.

### רציונל

המשתמש ביקש להריץ את הפרויקט "מ-npx בפקודה אחת". הפרויקט הוא monorepo (pnpm) עם
backend (Hono), frontend (SvelteKit/adapter-static), ו-core. הבדיקה הראתה ש**הבעיה
אינה ה-runtime** אלא אריזה: ה-backend כבר משתמש ב-`@hono/node-server` (אין `Bun.serve`
בקוד — ה-comment בטסט התיישן) ויודע להגיש את ה-FE הבנוי דרך `FE_STATIC_DIR` (single-origin).
מה שחסר: `bin` entry שמחבר את שני אלה בפקודה אחת.

**ההכרעה: `bunx` — לא Node, לא bundling.** שלוש עובדות הכריעו:
1. `tsconfig.base.json` עם `moduleResolution: "Bundler"` — הקוד מתוכנן ל-Bun/bundler,
   לא ל-`tsc → node`.
2. ה-plugin `packages/backend/plugins/prompt-injector.ts` **חייב להישאר .ts נגיש
   ב-runtime** — OpenCode טוען אותו דרך `file://` באמצעות Bun. bundling היה שובר אותו.
3. production (Dockerfile, systemd) כבר רץ עם Bun.

bunx מריץ את ה-TS ישירות כמו production — אפס מרחק בין dev ל-prod, ואפס עבודת bundling.

**Scope מצומצם בכוונה (JIT):** ה-slice הזה הוא ה-**mechanism** המקומי בלבד —
`bin/drive-coding.ts` שמגדיר `FE_STATIC_DIR`+`PORT` ומייבא את server.ts, launcher
שבונה FE אם חסר, ו-preflight. **פרסום ל-npm בפועל** (הסרת `private`, פתרון
`@drive-coding/core` workspace + `provider-contract` git dependency, `prepublishOnly`)
נדחה ל-slice המשך נפרד (`slice-npm-publish`), כדי ללמוד מה-mechanism לפני ה-publish.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (4 findings). כל ההנחות הארכיטקטוניות הקריטיות אומתו — במיוחד
ש-`server.ts` הוא **self-starting on-import** (אין `startServer()`; `serve()` ב-top-level),
שעליה נשען כל ה-API skeleton. שני פערי-אימות אמיתיים: (1) `bin/` מחוץ ל-`src/` היה גורם
ל-`pnpm typecheck` לדלג עליו בשקט (false-positive ל-DoD); (3) פקודות האימות היו bash-only
בעוד סביבת ה-dev היא Windows/PowerShell. r2 = READY, 0 findings.

### שינויי-כיוון

לפי ממצא #1 — ה-bin הועבר מ-`packages/backend/bin/` אל **`packages/backend/src/bin/`**,
כך שהוא נכלל אוטומטית ב-`include: ["src/**/*"]` ו-typecheck מכסה גם אותו וגם את ה-`import`,
**בלי לגעת ב-`rootDir`/`outDir`**. זה עדיף על הרחבת ה-tsconfig (שהיתה משנה מבנה output).
כל פקודות האימות הומרו ל-PowerShell.

### רעיונות שנדחו

- **bundling ל-JS יחיד (node-compatible):** היה מאפשר `npx` על Node טהור ומעלים את ה-git/
  workspace deps — אבל שובר את טעינת ה-plugin דרך `file://` ומנוגד ל-`moduleResolution: Bundler`
  ולכל ה-production stack שרץ Bun. נדחה לטובת bunx.
- **פרסום ל-npm בתוך ה-slice הזה:** נדחה ל-slice נפרד (JIT — לא לבנות publish לפני
  שה-mechanism עובד ונבדק).

## 2026-06-18 — slice-release-package: package נפרד מבונדל ל-bunx (החליף את slice-npm-publish)

### רציונל

המטרה: `bunx drive-coding` עובד מהתקנה נקייה מ-npm. הדרך לשם התבררה רק אחרי
שלוש גישות שנפלו אחת-אחת באימות אמפירי (spikes):

1. **`bundledDependencies` (slice-npm-publish, נזרק):** ארז את core+provider-contract
   כקבצים בתוך ה-tarball. **עובד עם npm, נשבר עם bun** — `bun add`/`bunx` מתעלמים משדה
   `bundledDependencies` ומנסים לפתור מחדש את ה-specs המקוריים: `@drive-coding/core@workspace:*`
   (לא קיים מחוץ ל-monorepo) ו-`provider-contract@git+...` (repo **פרטי** → 404 ל-bun הלא-מאומת).
   מאחר שה-headline הוא `bunx`, זו חסימה.
2. **devDependencies:** הרעיון — להוציא את core/provider-contract מ-`dependencies` כדי ש-bun
   לא ינסה לפתור. אבל `bundledDependencies` **חייב להיות תת-קבוצה של `dependencies`** — npm
   הפסיק לארוז אותם (457→89 קבצים), וה-runtime קרס `Cannot find module @drive-coding/core`.
3. **git URL ציבורי / auth:** bun **יודע** git+https; ה-404 הוא כי ה-repo פרטי. אבל חבילה
   ציבורית לא יכולה לתלות ב-repo פרטי, ו-`workspace:*` של core אין לו git URL בכלל.

**ההכרעה: package נפרד `packages/release/` שמבונדל בזמן build.** `bun build` של ה-bin
מטמיע (inline) את core+provider-contract לתוך JS אחד → הם **נעלמים מגרף התלויות** → אין
מה לפתור, לא משנה איזה installer. external רק ל-`pino`/`pino-pretty` (worker-thread, לא
ניתנים ל-bundling — נשארים deps ציבוריים ש-bun פותר). ה-packages הקיימים
(backend/core/provider-contract) **לא נגעו** — נשארים workspace/git/private (זמני, יהפכו
ל-public בעתיד). זה היפוך מודע של ההחלטה של slice-bunx ("no bundling") — שתי הסיבות שלה
פגו: (א) אומת שה-plugin (`file://` ע"י תהליך opencode נפרד) **לא** מבונדל ולכן לא נשבר;
(ב) `bundledDependencies` ⊥ bun הוכח אמפירית. בחירת המשתמשת: package נפרד על-פני עריכת
ה-monorepo "הזמני".

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (4 findings). שני 🔴 חשובים: (#1) ה-brief תיאר את ה-bin של
slice-npm-publish (dual-layout) במקום את ה-bin האמיתי של dev (single-line) — ה-spike
רץ על הבסיס הלא-נכון; (#2) ה-script `build` היה נתפס ע"י `pnpm -r run build` ומפעיל
build כבד לא-מכוון. תוקנו: ה-script שונה ל-`bundle`, וה-Commit עודכן ל-bin האמיתי
(single-line + הוספת `existsSync`). r2 = READY, 0 findings.

### שינויי-כיוון

- **הנגיעה היחידה ב-backend**: ה-FE cascade ב-`src/bin/drive-coding.ts` שונה ל-2-candidate
  (`../frontend-dist` ל-bundle, `../../../frontend/build` ל-dev) — שיפור path-resolution
  כללי, לא מחיקת תלויות. אומת לשני ה-layouts.
- **guard ל--sourcemap**: התגלה באג ב-bun 1.3.14 — `bun build --sourcemap --outfile` מתעלם
  מ-`--outfile` ופולט לתיקיית ה-entry. נוגע רק ל-build של release (לא ל-dev, ששם אין
  bundling). הוגן guard דו-שכבתי: `files` מצומצם ל-`dist/drive-coding.js` בלבד + assertion
  ב-build.mjs שמפיל את ה-build אם `.map` מופיע או אם הבאנדל חסר. מאומת ששתי השכבות תופסות.

### רעיונות שנדחו

- **`bundledDependencies` (slice-npm-publish):** נזרק — ⊥ bun (ראה רציונל). ה-worktree
  וה-branch נמחקו (לא merged).
- **bundling בתוך backend (טיוטת slice-bundle-single-artifact):** היה דורש מחיקת deps
  ושכתוב prepack של backend. נדחה לטובת package נפרד — additive, הפיך, בלי לגעת ב-monorepo
  "הזמני" (בקשת המשתמשת).
- **release-own bin shim (אפס נגיעה ב-backend):** היה מונע את הנגיעה ב-bin, אבל משכפל את
  לוגיקת ה-preflight/URL. נדחה — ה-cascade הוא שיפור כללי ובטוח ממילא.
