# Slice session-title-header — כותרת הסשן בהדר הצ'אט — תוכנית

> **תאריך**: 2026-06-25 · **עודכן**: 2026-06-25 (הוספת ארגון-מחדש של ההדר — תיקייה ליד נקודת-החיבור)
> **סטטוס**: ✅ **הושלם** — 3 commits על branch `slice-session-title-header` (bfaa7ee..9ac0e81). ממתין ל-merge ע"י מרדכי.
> **Complexity**: 4/10 (היה 3; +1 על ארגון-מחדש של ההדר + RTL/logical-classes; verifier: light)
> **תלות (depends_on)**: [] — עצמאי. base = `dev` (aab70ce; כולל chat-render-polish + enter-toggle + display-toggle-consistency)
> **החלטות UX שננעלו** (דיון 2026-06-25): (א) fallback כשאין title = **"drive-coding"** הקיים (אפס i18n, §9 Q1 הוכרע). (ב) **התיקייה (cwd) עוברת מהמרכז ל-`inline-end` ליד נקודת-החיבור**; המרכז מציג רק את הכותרת. בעברית (RTL) ה-`inline-end` = **שמאל** → הנקודה+התיקייה משמאל. (ג) **קלאסים לוגיים בלבד** (`start/end`, `ms/me`) — לא פיזיים.

> **תיקוני r1 (אביגיל)**: ה-`title` מחווט דרך **שלושה** נתיבי-כניסה לסשן, לא רק `loadSession`:
> `loadSession` (כבד), `switchSession` (warm, הנתיב הראשי מהפאנל), ו-`#coldReconnect` (WS reconnect).
> ההכרעה: סמנטיקת **keep-on-undefined** (`input.title ?? this.sessionTitle`) — קורא שלא מעביר title
> (reconnect) **שומר** את הכותרת ולא מאפס. `switchSession` מקבל `title?` מפורש (סשן אחר = כותרת אחרת).

## §1 — מטרה

כשמשתמשת טוענת סשן קיים ונכנסת ל-`/chat`, **שם הסשן (title) מוצג בהדר** במקום ה-placeholder הקבוע `"drive-coding"`. הכותרת כבר קיימת במודל (`SessionInfo.title`, מ-`listSessionsForCwd`) ומוצגת ב-`SessionPicker`/`SessionCard`, אך כיום **לא מחווטת** ל-`AgentSession` הפעיל ולכן לא נראית בצ'אט. הסבב מחווט את ה-title דרך `loadSession` אל שדה `$state` חדש ב-VM, וה-`AppHeader` מציג אותו. לסשן חדש (אין title) — נשמרת ההתנהגות הנוכחית (label "drive-coding"), בלי regression.

**ארגון-מחדש של ההדר (נוסף 2026-06-25)**: כיום ה-cwd chip (שם-התיקייה) יושב **במרכז** ליד שם-הסוכן, ונקודת-החיבור לבדה ב-`inline-end`. הסבב מעביר את ה-cwd chip ל-**קבוצת-סטטוס ב-`inline-end` ליד נקודת-החיבור** (תיקייה = "איפה אני", נקודה = "מחובר?" → מחווני-הקשר מקובצים), והמרכז נשאר עם **הכותרת בלבד** (גיבור התוכן, פחות נדחקת). בעברית ה-`inline-end` הוא **שמאל** ויזואלית.

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
| הצגת title ב-warm-attach (`attachToLiveAgent` מ-ActiveProcessesPanel) | ❌ | ה-`AgentPublic` של process חי לא מחזיק title → **מאפס ל-`""`** (fallback ל-"drive-coding", מונע stale-title מ-process קודם — ראה Commit 0 step 4b). הצגת-title אמיתית = slice נפרד |
| **העברת cwd chip מהמרכז ל-`inline-end` (ליד נקודת-החיבור)** | ✅ | הסבב (Commit 2) — קלאסים לוגיים |
| **המרכז מציג כותרת בלבד** (בלי ה-chip) | ✅ | הסבב (Commit 2) |
| שינוי עיצוב נקודת-החיבור עצמה / cwd chip עצמו | ❌ | רק מיקום — לא נוגעים בסגנון הפנימי, ב-`dir="ltr"` של ה-path, או בלוגיקת ה-status |

## §3 — Architecture diagram

```
routes/
  +page.svelte (connect)   ← שינוי: מעביר title מ-SessionInfo הנבחר ל-loadSession
  chat/+page.svelte        ← לא נוגעים (קובץ משותף — AppShell כבר מרנדר AppHeader)
components/
  layout/AppHeader.svelte         ← שינוי: (1) מרכז מציג session.sessionTitle (fallback ל-agentName);
                                      (2) cwd chip עובר מהמרכז ל-inline-end ליד נקודת-החיבור (קלאסים לוגיים)
  layout/SessionOptionsPanel.svelte ← שינוי: selectSession מעביר title ל-switchSession (הנתיב הראשי בצ'אט!)
view-models/
  agent-session.svelte.ts  ← שינוי: שדה sessionTitle $state + חיווט ב-3 נתיבים:
                              loadSession (+title?) · switchSession (+title?) · newSession/mock (reset)
                              #coldReconnect — keep-on-undefined שומר אוטומטית (אין שינוי שם)
adapters/ engines/         — ללא שינוי
core/i18n/                 ← ללא שינוי (fallback="drive-coding", §9 Q1 הוכרע — אין key חדש)
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
   - **בנתיב ה-warm**: אחרי `this.#sessionId = input.sessionId` (שורה 764; 765 הוא `this.cwd`), הוסף:
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

4b. **`attachToLiveAgent`** (warm-attach מ-ActiveProcessesPanel, שורה ~692) — ה-`AgentPublic` של process חי **לא מחזיק title**. בגוף הפונקציה (אחרי קביעת `this.#sessionId`, סביב שורה ~698-706 — **לא** ליד reset של bubbles; ה-bubbles מתאפסים ב-`#warmReconnect:452`, לא כאן), **אפס את הכותרת** כדי שלא תידבק כותרת ישנה מ-process קודם (תיקון ה-stale-title ש-אביגיל r3 #1 דגלה):
   ```ts
   this.sessionTitle = ""   // process חי בלי title → fallback ל-"drive-coding"
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

### Commit 2 — הצגה ב-AppHeader + ארגון-מחדש (cwd→inline-end) (approach: manual + browser smoke)

**קבצים שמשתנים**:
- `packages/frontend/src/lib/components/layout/AppHeader.svelte` (בלבד — אין נגיעה ב-i18n, fallback="drive-coding")

**שינויים ב-AppHeader.svelte** — שני שינויים: הצגת כותרת במרכז + העברת ה-cwd chip ל-inline-end.

**(א) כותרת במרכז** — derived שמעדיף את כותרת הסשן, fallback ל-`agentName` הקיים:
```ts
// sessionTitle אם קיים, אחרת ה-placeholder הקיים "drive-coding" (אפס regression, §9 Q1 — fallback=agentName)
const headerLabel = $derived(session.sessionTitle?.trim() ? session.sessionTitle : agentName)
```
הקבוצה הממורכזת (שורה 52) **מאבדת את ה-cwd chip** ומציגה רק את הכותרת:
```svelte
<!-- כותרת ממורכזת אבסולוטית: כותרת-הסשן בלבד (ה-cwd עבר ל-inline-end) -->
<div class="absolute start-1/2 -translate-x-1/2 top-3 h-9 flex items-center justify-center pointer-events-none max-w-[60%]">
  <span class="text-[15px] font-semibold shrink-0 truncate max-w-[min(60vw,22rem)]"
        title={headerLabel}>{headerLabel}</span>
</div>
```
> `start-1/2` (לוגי) במקום `left-1/2`; ה-`-translate-x-1/2` הוא מרכוז גאומטרי (a-directional, תקין). `truncate`+`title` כי כותרות ארוכות. `agentName="drive-coding"` נשאר כ-fallback (לא מסירים — redesign-3 עתידי). **fallback טקסטואלי = ❌ (הוכרע "drive-coding"); אין key i18n חדש, אין נגיעה ב-keys.ts/catalogs.**

**(ב) cwd chip עובר ל-inline-end, ליד נקודת-החיבור** — גוזרים את בלוק ה-`{#if cwdLabel} ... {/if}` (שורות 53-63, ה-chip על כל סגנונו, `dir="ltr"`, ה-`FolderIcon`, ה-tooltip) **מהקבוצה הממורכזת**, ומדביקים אותו **לתוך קבוצת-סטטוס חדשה** שעוטפת אותו יחד עם נקודת-החיבור הקיימת:
```svelte
<!-- spacer — דוחק את קבוצת-הסטטוס ל-inline-end -->
<div class="flex-1"></div>

<!-- קבוצת-סטטוס (inline-end): cwd chip + נקודת-חיבור. בעברית inline-end = שמאל. -->
<div class="flex items-center gap-2 shrink-0">
  {#if cwdLabel}
    <!-- ⬇ בלוק ה-cwd chip הקיים, מועבר כמו-שהוא (dir="ltr", FolderIcon, title) -->
    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono shrink-0"
          style="background:var(--bg-card); border:1px solid var(--border)" dir="ltr" title={session.cwd ?? ""}>
      <FolderIcon size={11} strokeWidth={2} style="color:var(--fg-dim)" />
      <span class="font-semibold" style="color:var(--fg)">{cwdLabel}</span>
    </span>
  {/if}
  <!-- ⬇ נקודת-החיבור הקיימת (שורות 71-81) — בלי שינוי לוגיקה/סגנון -->
  <span class="pointer-events-auto shrink-0 grid place-items-center size-9" title={t("header.connected")}>
    <span class="size-2.5 rounded-full transition-colors duration-300"
          style="background:{session.status === 'connected' ? 'var(--speaking)' : 'var(--fg-dim)'}; {session.status === 'connected' ? 'box-shadow:0 0 8px var(--speaking)' : ''}"></span>
  </span>
</div>
```
> **סדר בתוך הקבוצה**: `[cwd chip] [dot]` → ה-dot ב-inline-end-most (פינה = שמאל בעברית), התיקייה צמודה לו. **קלאסים לוגיים בלבד** — `gap`/`px`/`py` סימטריים (תקין); **אסור** להוסיף `ml/mr/pl/pr/left/right` — אם צריך מרווח אסימטרי השתמש ב-`ms/me`/`ps/pe`. ה-`dir="ltr"` נשאר **רק על ה-chip** (ה-path הוא LTR), לא על הקבוצה.

> ⚠️ **בדיקת-RTL חובה**: אמת בדפדפן ב-RTL שהנקודה+התיקייה **בשמאל** (inline-end), ההמבורגר בימין (inline-start), והכותרת במרכז. אם משהו "קפץ" לצד הלא-נכון → סימן לקלאס פיזי שנשאר.

**i18n**: ❌ אין שינוי (fallback="drive-coding"). לא נוגעים ב-`keys.ts`/`catalogs`. (השאלה על fallback טקסטואלי הוסרה — §9 Q1 הוכרע.)

**Verification (browser smoke — אין צורך ב-ACP חי, יש mock harness)**:
```bash
cd packages/frontend && pnpm --filter @drive-coding/frontend dev
# בדפדפן (RTL — ברירת מחדל):
#   /chat?mock=greeting   → מרכז: "🧪 greeting"; inline-end (שמאל בעברית): [📁 תיקייה] [● נקודה]
#   /chat?mock=mitm       → מרכז: "🧪 mitm"
#   fallback: connect ללא בחירת סשן → מרכז מציג "drive-coding" (כמו היום)
#   ⚠️ RTL: נקודה+תיקייה בשמאל, המבורגר בימין, כותרת במרכז. כותרת ארוכה (mock עם title ארוך) → truncate+tooltip, התיקייה לא נדחקת.
pnpm --filter @drive-coding/frontend build   # production build נקי (mock tree-shaken) — חובה ל-git-dep (provider-contract /acp)
```

## §5 — DoD verifiable

| בדיקה | איך |
|---|---|
| טעינת סשן קיים עם title → הכותרת בהדר | connect → בחר סשן עם כותרת → `/chat`; ההדר מציג את ה-title |
| **החלפת סשן warm מהפאנל → הכותרת מתעדכנת** | ב-`/chat`, פתח את הפאנל/sheet → בחר סשן אחר → ההדר מציג את כותרת הסשן **החדש** (לא הישנה) |
| **WS reconnect שומר כותרת** | טען סשן עם title → נתק רשת/WS → reconnect קר → ההדר ממשיך להציג את ה-title (לא נופל ל-"drive-coding") |
| סשן חדש (בלי title) → אין regression | connect ללא בחירת סשן → `/chat`; ההדר מציג "drive-coding" כמו היום |
| harness ויזואלי | `/chat?mock=greeting` → ההדר מציג "🧪 greeting" |
| **cwd עבר ל-inline-end ליד הנקודה** | בצ'אט: התיקייה (📁) צמודה לנקודת-החיבור, **לא** במרכז. המרכז = כותרת בלבד |
| **RTL נכון** | בעברית: נקודה+תיקייה ב**שמאל** (inline-end), המבורגר בימין (inline-start), כותרת במרכז |
| **קלאסים לוגיים בלבד** | code review: אין `left/right`/`ml/mr`/`pl/pr` חדשים ב-AppHeader; רק `start/end`/`ms/me`/סימטריים |
| כותרת ארוכה לא **חופפת** ל-cwd (מסך צר) | `/chat?mock=salary-attendance` + viewport ~360px → הכותרת (`absolute`, max-w) **לא חופפת** על קבוצת-הסטטוס (cwd+נקודה); truncate + tooltip פעילים. ⚠️ הסיכון אחרי ההעברה הוא חפיפה (כותרת absolute מול cwd ב-flow), לא דחיפה — בדוק ויזואלית במסך צר |
| טסט יחידה | `pnpm vitest run src/lib/view-models/agent-session.test.ts` ירוק (title set / keep-on-undefined / newSession="") |
| typecheck + lint:i18n נקיים | `pnpm --filter @drive-coding/frontend typecheck && pnpm lint:i18n` |
| production build נקי | `pnpm --filter @drive-coding/frontend build` |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| מחרוזת עברית קשיחה בקוד → pre-commit hook חוסם | plans/README §6 (גוטשה קבועה) | אין מחרוזת חדשה — fallback = `agentName`="drive-coding" הקיים; אין נגיעה ב-i18n (§9 Q1 הוכרע) |
| Svelte 5: `$state` שלא מתעדכן | plans/README §6 | `sessionTitle` הוא primitive `$state`; קריאה ב-`$derived`/markup → reactive טבעי. אין array-mutation כאן |
| שבירת קוראים קיימים של `loadSession` | חוק זהב #5 (אסור backward-compat מלוכלך) | ה-param `title?` **אופציונלי** → כל הקוראים הקיימים (chat mock URL, טסטים) ממשיכים לעבוד ללא שינוי. תוספתי טהור |
| **קוראים פנימיים מאפסים title** (אביגיל r1 #1/#2) | דוח אביגיל 2026-06-25 — `switchSession` + `#coldReconnect` | סמנטיקת **keep-on-undefined** (`?? this.sessionTitle`): `#coldReconnect` שומר אוטומטית; `switchSession` מקבל `title?` מפורש ומחווט מ-`SessionOptionsPanel`. שני הנתיבים מכוסים ב-DoD |
| התנגשות עם redesign-3 (חיווט שם-סוכן ל-header) | הערה ב-AppHeader.svelte:23 | לא מסירים את `agentName`; הוא הופך ל-fallback. redesign-3 יוכל בעתיד להחליף את ה-fallback |
| ~~נגיעה בקובץ משותף `i18n/keys.ts`~~ | — | **לא רלוונטי** — fallback="drive-coding" הוכרע, אין key חדש, אין נגיעה ב-i18n |
| **קלאס פיזי שובר RTL** (cwd קופץ לצד הלא-נכון) | העברת ה-chip ל-inline-end | קלאסים לוגיים בלבד (`start/end`, `ms/me`); ה-chip רק מועבר (px/gap סימטריים). DoD-row "RTL נכון" + "קלאסים לוגיים" מאמתים. בדיקה חיה ב-RTL חובה |
| ה-`dir="ltr"` של ה-path הולך לאיבוד בהעברה | path הוא LTR גם ב-RTL | ה-`dir="ltr"` נשאר **על ה-chip עצמו** (לא על קבוצת-הסטטוס); מועבר verbatim עם הבלוק |

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
- +1 על ארגון-מחדש של ה-AppHeader (העברת cwd ל-inline-end) + נכונות RTL/קלאסים-לוגיים
- **Score ≈ 4/10 → verifier `calev` mode: light.** אין phase רגישה (אין I/O חדש, אין state-machine). ה-keep-on-undefined מצמצם את סיכון ה-reconnect; ה-RTL/layout נתפס ב-browser smoke.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | fallback כשאין title (סשן חדש) | ✅ **הוכרע — "drive-coding" הקיים** (אפס regression, אפס i18n). | ❌ נפתר |
| 2 | להציג title גם ב-warm-attach (process חי)? | לא בסבב הזה — `AgentPublic` לא מחזיק title → "" → fallback | ❌ |
| 3 | מיקום: title והתיקייה | ✅ **הוכרע** — title **לבד במרכז**; ה-cwd chip עובר ל-`inline-end` ליד נקודת-החיבור (בעברית = שמאל). | ❌ נפתר |
