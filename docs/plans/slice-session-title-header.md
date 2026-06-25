# Slice session-title-header — כותרת הסשן בהדר הצ'אט — תוכנית

> **תאריך**: 2026-06-25
> **סטטוס**: מאושר — READY (אביגיל r1=USABLE-AFTER-FIX → r2=READY; 3 findings תוקנו ואומתו מול הקוד)
> **Complexity**: 3/10 (verifier: light)
> **תלות (depends_on)**: [] — עצמאי. base = `dev` (229ad9c; כולל chat-render-polish + enter-toggle)

> **תיקוני r1 (אביגיל)**: ה-`title` מחווט דרך **שלושה** נתיבי-כניסה לסשן, לא רק `loadSession`:
> `loadSession` (כבד), `switchSession` (warm, הנתיב הראשי מהפאנל), ו-`#coldReconnect` (WS reconnect).
> ההכרעה: סמנטיקת **keep-on-undefined** (`input.title ?? this.sessionTitle`) — קורא שלא מעביר title
> (reconnect) **שומר** את הכותרת ולא מאפס. `switchSession` מקבל `title?` מפורש (סשן אחר = כותרת אחרת).

## §1 — מטרה

כשמשתמשת טוענת סשן קיים ונכנסת ל-`/chat`, **שם הסשן (title) מוצג בהדר** במקום ה-placeholder הקבוע `"drive-coding"`. הכותרת כבר קיימת במודל (`SessionInfo.title`, מ-`listSessionsForCwd`) ומוצגת ב-`SessionPicker`/`SessionCard`, אך כיום **לא מחווטת** ל-`AgentSession` הפעיל ולכן לא נראית בצ'אט. הסבב מחווט את ה-title דרך `loadSession` אל שדה `$state` חדש ב-VM, וה-`AppHeader` מציג אותו. לסשן חדש (אין title) — נשמרת ההתנהגות הנוכחית (label "drive-coding"), בלי regression.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| הצגת `title` של סשן **קיים** שנטען בהדר | ✅ | הסבב הזה |
| fallback ל-label הנוכחי כשאין title (סשן חדש) | ✅ | הסבב הזה |
| auto-generate של כותרת (`generate_session_title`) | ❌ | future נפרד (roadmap Track C) — **לא** נוגעים ב-wire |
| הצגת title בהחלפת-סשן **warm** מהפאנל (`switchSession`) | ✅ | הסבב הזה (תוקן r1 — זה הנתיב הנפוץ) |
| שימור title על WS reconnect (`#coldReconnect`) | ✅ | הסבב הזה (keep-on-undefined, אוטומטי) |
| עדכון **חי** של הכותרת אם המודל משנה אותה תוך-כדי שיחה | ❌ | תלוי auto-generate (future) — הכותרת היא snapshot מרגע הטעינה/החלפה |
| עריכת-שם ע"י המשתמשת | ❌ | future-features (דורש RFD בצד הספק) |
| הצגת title ב-warm-attach (`attachToLiveAgent` מ-ActiveProcessesPanel) | ❌ | ה-`AgentPublic` של process חי לא מחזיק title → נשאר כפי שהוא (fallback). אם יידרש — slice נפרד |

## §3 — Architecture diagram

```
routes/
  +page.svelte (connect)   ← שינוי: מעביר title מ-SessionInfo הנבחר ל-loadSession
  chat/+page.svelte        ← לא נוגעים (קובץ משותף — AppShell כבר מרנדר AppHeader)
components/
  layout/AppHeader.svelte         ← שינוי: מציג session.sessionTitle (fallback ל-agentName)
  layout/SessionOptionsPanel.svelte ← שינוי: selectSession מעביר title ל-switchSession (הנתיב הראשי בצ'אט!)
view-models/
  agent-session.svelte.ts  ← שינוי: שדה sessionTitle $state + חיווט ב-3 נתיבים:
                              loadSession (+title?) · switchSession (+title?) · newSession/mock (reset)
                              #coldReconnect — keep-on-undefined שומר אוטומטית (אין שינוי שם)
adapters/ engines/         — ללא שינוי
core/i18n/                 ← תוספת: key "header.untitledSession" (לא חוסם — ראה §9)
```

כל השינויים **תוספתיים** (additive). אין refactor ל-state model, אין שינוי protocol.

## §4 — Commits בסדר

### Commit 0 — `sessionTitle` ב-AgentSession + חיווט 3 נתיבים (approach: mixed — TDD ל-loadSession/switchSession, manual לשאר)

**קבצים שמשתנים**: `packages/frontend/src/lib/view-models/agent-session.svelte.ts`

> **עקרון מנחה — keep-on-undefined**: כל קביעת `sessionTitle` מהקלט היא `input.title ?? this.sessionTitle`,
> **לא** `?? ""`. כך קורא שלא יודע title (כמו `#coldReconnect`) **שומר** את הכותרת הקיימת במקום למחוק.
> רק נתיבים שיודעים title-חדש (connect / switch) מעבירים אותו; רק `newSession` מאפס מפורשות ל-"".

**שינויים**:
1. שדה `$state` ציבורי חדש בבלוק ה-state (אחרי בלוק `sessions`/redesign-fix, שורה ~109, עם section header תוספתי):
   ```ts
   // ─── slice session-title: כותרת הסשן הפעיל ─── (תוספתי)
   /** כותרת הסשן הפעיל. snapshot מרגע הטעינה/החלפה. "" = אין כותרת (סשן חדש). */
   sessionTitle = $state<string>("")
   ```
   > **שם השדה**: `sessionTitle` ולא `title` — בקובץ קיימים מקומיים בשם `title` (כותרת tool_call, שורות ~1158/1229/1275); השם הנפרד מונע בלבול. אין התנגשות class-member, אבל הבהירות חשובה.

2. **`loadSession`** (שורה ~596) — הרחב input ב-`title?` (תוספתי), וקבע **keep-on-undefined** אחרי `this.#sessionId = input.sessionId` (שורה ~653):
   ```ts
   loadSession = async (input: {
     sessionId: string
     cwd: string
     cliKind: CliKind
     title?: string   // ← חדש, אופציונלי (תוספתי — קוראים קיימים לא נשברים)
   }): Promise<void> => {
   ```
   ובגוף, אחרי `this.#sessionId = input.sessionId`:
   ```ts
   this.sessionTitle = input.title ?? this.sessionTitle   // keep-on-undefined: reconnect לא מאפס
   ```
   > **למה זה מתקן את `#coldReconnect` (שורה 392) ללא נגיעה בו**: הוא קורא `loadSession({ sessionId, cwd, cliKind })` בלי title → `undefined ?? this.sessionTitle` → הכותרת **נשמרת**. אין צורך לשנות את `#coldReconnect`.

3. **`switchSession`** (שורה ~727) — הנתיב הראשי להחלפת סשן בצ'אט (warm, מהפאנל). הרחב input ב-`title?` (תוספתי). שני תיקונים:
   - הנתיבים-הכבדים (`return this.loadSession(input)` בשורות ~734 ו-~742) מעבירים title **אוטומטית** דרך `input` — אין מה לשנות שם.
   - **בנתיב ה-warm**: אחרי `this.#sessionId = input.sessionId` (שורה ~765), הוסף:
     ```ts
     this.sessionTitle = input.title ?? this.sessionTitle
     ```
   ```ts
   switchSession = async (input: {
     sessionId: string
     cwd: string
     cliKind: CliKind
     title?: string   // ← חדש
   }): Promise<void> => {
   ```

4. **`newSession`** (שורה ~794) — סשן חדש = אין כותרת. ליד איפוס ה-state הקיים (`bubbles = []`/`error = null`, שורות ~808-809):
   ```ts
   this.sessionTitle = ""
   ```

5. **`#loadMockSession`** (ההשמה `this.#sessionId = \`mock:${name}\`` היא בשורה **1115**, לא בתחילת הפונקציה ב-1102) — כותרת-דמו ל-harness הוויזואלי. אחריה:
   ```ts
   this.sessionTitle = `🧪 ${name}`
   ```

**API skeleton (before/after)**:
```ts
// before: loadSession(input: { sessionId; cwd; cliKind })
// after:  loadSession(input: { sessionId; cwd; cliKind; title? })
// before: switchSession(input: { sessionId; cwd; cliKind })
// after:  switchSession(input: { sessionId; cwd; cliKind; title? })
// שדה חדש: AgentSession.sessionTitle: string  ($state, ציבורי קריא)
// סמנטיקה: sessionTitle = input.title ?? sessionTitle  (keep-on-undefined)
```

**Verification**:
```bash
cd packages/frontend
pnpm vitest run src/lib/view-models/agent-session.test.ts
pnpm --filter @drive-coding/frontend typecheck
```
טסטים לכתוב (דפוס mockClient הקיים, שורות 289-310 ב-`agent-session.test.ts` — מאמת `loadSession` נקרא עם `{sessionId,cwd}` בלבד, **לא** עם title; title הוא FE-state בלבד אז ה-assertions הקיימים לא נשברים):
- `loadSession({ sessionId, cwd, cliKind, title: "פיקדון" })` → `session.sessionTitle === "פיקדון"`.
- keep-on-undefined: אחרי הנ"ל, `loadSession({ sessionId, cwd, cliKind })` (בלי title, מדמה reconnect) → `session.sessionTitle === "פיקדון"` (נשמר, לא אופס).
- `newSession({ cliKind })` (אם יש דפוס mock ל-newSession בטסטים, שורה 197 `describe("AgentSession.newSession")`) → `session.sessionTitle === ""`.

### Commit 1 — חיווט ה-title משני נתיבי-הכניסה (approach: manual)

**קבצים שמשתנים**:
- `packages/frontend/src/routes/+page.svelte` (connect → loadSession)
- `packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte` (פאנל בצ'אט → switchSession)

**שינוי 1 — connect route** (`+page.svelte`, `onSubmit` שורה ~142, ענף `selectedSessionId !== null`):
```ts
const selected = sessions.find((s) => s.sessionId === selectedSessionId)
await session.loadSession({
  sessionId: selectedSessionId,
  cwd: cwd.trim(),
  cliKind,
  title: selected?.title ?? "",   // ← חדש (title ב-scope: sessions: SessionInfo[])
})
```

**שינוי 2 — SessionOptionsPanel** (`selectSession`, שורה ~141). ה-call-site `selectSession(s)` (שורה ~361) כבר מעביר `SessionInfo` מלא עם `.title`. הרחב את החתימה והעבר את ה-title:
```ts
async function selectSession(info: { sessionId: string; cwd: string; title?: string }) {
  await session.switchSession({
    sessionId: info.sessionId,
    cwd: info.cwd,
    cliKind: settings.cliKind,
    title: info.title ?? "",   // ← חדש
  })
  uiShell.closeSheet()
  await goto("/chat")
}
```
> `s` שמועבר ב-`onSelect={() => selectSession(s)}` הוא `SessionInfo` (יש לו `.title`). שום שינוי נדרש ב-`SessionCard`.

**Verification**:
```bash
cd packages/frontend && pnpm --filter @drive-coding/frontend typecheck
pnpm lint:i18n   # אין מחרוזת עברית חדשה בקוד הזה
```

### Commit 2 — הצגה ב-AppHeader + i18n (approach: manual + browser smoke)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/components/layout/AppHeader.svelte`
- `packages/core/src/i18n/keys.ts` (+ `catalogs/he.ts` + `catalogs/en.ts`)

**שינויים ב-AppHeader.svelte**:
- החלף את התווית הממורכזת (שורה 64, `{agentName}`) ב-derived שמעדיף את כותרת הסשן:
  ```ts
  // sessionTitle אם קיים, אחרת ה-placeholder הקיים (אפס regression לסשן חדש)
  const headerLabel = $derived(session.sessionTitle?.trim() ? session.sessionTitle : agentName)
  ```
  ```svelte
  <span class="text-[15px] font-semibold shrink-0 truncate max-w-[min(60vw,22rem)]"
        title={headerLabel}>{headerLabel}</span>
  ```
  > הוסף `truncate` + `title={...}` (tooltip) כי כותרות יכולות להיות ארוכות; ה-container כבר `max-w-[60%]`. ה-cwd chip נשאר ללא שינוי.
- את `agentName = "drive-coding"` משאירים כ-fallback (לא מסירים — אין עדיין מקור-אמת לשם-סוכן; redesign-3 עתידי).

**i18n** (רק אם בוחרים fallback טקסטואלי — ראה §9 שאלה 1; ברירת המחדל **לא** דורשת key חדש):
- אם הוחלט fallback ל-"סשן חדש" במקום ל-`agentName`: הוסף key `"header.untitledSession"` ב-`keys.ts` (ליד שאר `header.*`, שורות 151-156), ערך he `"סשן חדש"`, scaffold en `"New session"`, והשתמש ב-`t("header.untitledSession")` במקום `agentName` ב-derived.

**Verification (browser smoke — אין צורך ב-ACP חי, יש mock harness)**:
```bash
cd packages/frontend && pnpm --filter @drive-coding/frontend dev
# בדפדפן:
#   /chat?mock=greeting   → ההדר מציג "🧪 greeting"  (כותרת מ-#loadMockSession)
#   /chat?mock=mitm       → ההדר מציג "🧪 mitm"
# בדיקת fallback: connect רגיל ללא בחירת סשן (סשן חדש) → ההדר מציג "drive-coding" (כמו היום)
pnpm --filter @drive-coding/frontend build   # production build נקי (mock tree-shaken)
```

## §5 — DoD verifiable

| בדיקה | איך |
|---|---|
| טעינת סשן קיים עם title → הכותרת בהדר | connect → בחר סשן עם כותרת → `/chat`; ההדר מציג את ה-title |
| **החלפת סשן warm מהפאנל → הכותרת מתעדכנת** | ב-`/chat`, פתח את הפאנל/sheet → בחר סשן אחר → ההדר מציג את כותרת הסשן **החדש** (לא הישנה) |
| **WS reconnect שומר כותרת** | טען סשן עם title → נתק רשת/WS → reconnect קר → ההדר ממשיך להציג את ה-title (לא נופל ל-"drive-coding") |
| סשן חדש (בלי title) → אין regression | connect ללא בחירת סשן → `/chat`; ההדר מציג "drive-coding" כמו היום |
| harness ויזואלי | `/chat?mock=greeting` → ההדר מציג "🧪 greeting" |
| כותרת ארוכה לא שוברת layout | `/chat?mock=salary-attendance` (או mock עם כותרת ארוכה) → truncate + tooltip, ה-cwd chip לא נדחק |
| טסט יחידה | `pnpm vitest run src/lib/view-models/agent-session.test.ts` ירוק (title set / keep-on-undefined / newSession="") |
| typecheck + lint:i18n נקיים | `pnpm --filter @drive-coding/frontend typecheck && pnpm lint:i18n` |
| production build נקי | `pnpm --filter @drive-coding/frontend build` |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| מחרוזת עברית קשיחה בקוד → pre-commit hook חוסם | plans/README §6 (גוטשה קבועה) | אין מחרוזת חדשה בברירת המחדל (fallback = `agentName` קיים). אם בוחרים "סשן חדש" → דרך `t("header.untitledSession")` בלבד |
| Svelte 5: `$state` שלא מתעדכן | plans/README §6 | `sessionTitle` הוא primitive `$state`; קריאה ב-`$derived`/markup → reactive טבעי. אין array-mutation כאן |
| שבירת קוראים קיימים של `loadSession` | חוק זהב #5 (אסור backward-compat מלוכלך) | ה-param `title?` **אופציונלי** → כל הקוראים הקיימים (chat mock URL, טסטים) ממשיכים לעבוד ללא שינוי. תוספתי טהור |
| **קוראים פנימיים מאפסים title** (אביגיל r1 #1/#2) | דוח אביגיל 2026-06-25 — `switchSession` + `#coldReconnect` | סמנטיקת **keep-on-undefined** (`?? this.sessionTitle`): `#coldReconnect` שומר אוטומטית; `switchSession` מקבל `title?` מפורש ומחווט מ-`SessionOptionsPanel`. שני הנתיבים מכוסים ב-DoD |
| התנגשות עם redesign-3 (חיווט שם-סוכן ל-header) | הערה ב-AppHeader.svelte:23 | לא מסירים את `agentName`; הוא הופך ל-fallback. redesign-3 יוכל בעתיד להחליף את ה-fallback |
| נגיעה בקובץ משותף `i18n/keys.ts` | parallel-safe-code.md | additive בלבד (key אחד ליד `header.*`), ורק אם נבחר fallback טקסטואלי |

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- מתברר ש-`SessionInfo.title` **לא** מאוכלס בפועל ב-`sessions` בזמן הבחירה (בדוק ב-`listSessionsForCwd` — לא אמור לקרות).
- נדרש שינוי ב-`chat/+page.svelte` (קובץ משותף, invasive) — לא אמור; AppShell כבר מרנדר AppHeader.
- מתברר שצריך עדכון-title חי על ה-wire כדי שהבדיקה תעבוד (זה future מחוץ ל-scope — אם נחסם, עצור).
- decision ארכיטקטוני שלא מכוסה ב-D1-D50.

## §8 — Complexity score

- commits: 3 (Commit 1 נוגע ב-2 קבצים) → נמוך
- שכבות חדשות: 0 (נוגע ב-VM/route/component קיימים)
- APIs חיצוניים: 0 · streaming: 0 · state-model refactor: לא (שדה תוספתי) · protocol change: לא
- +1 על חיווט דרך 3 נתיבי-כניסה (loadSession/switchSession/reconnect) — מקור ה-regression ב-r1
- **Score ≈ 3/10 → verifier `calev` mode: light.** אין phase רגישה (אין I/O חדש, אין state-machine). ה-keep-on-undefined מצמצם את סיכון ה-reconnect ל-regression שקט יחיד שכוסה ב-DoD.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | fallback כשאין title (סשן חדש) | **השאר את ה-placeholder הקיים "drive-coding"** (אפס regression, אפס i18n). חלופה: `t("header.untitledSession")`="סשן חדש" | ❌ לא חוסם — ברירת המחדל בטוחה; המשתמשת יכולה להחליף |
| 2 | להציג title גם ב-warm-attach (process חי)? | לא בסבב הזה — `AgentPublic` לא מחזיק title → "" → fallback | ❌ |
| 3 | מיקום: title מחליף את "drive-coding" הממורכז, או שורה נוספת? | מחליף (label אחד ממורכז + cwd chip) — שומר על ה-header הנקי הקיים | ❌ |
