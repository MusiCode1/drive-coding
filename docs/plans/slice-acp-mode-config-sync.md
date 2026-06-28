# Slice — acp-mode-config-sync — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: מוזג ל-dev v0.4.0 (2026-06-28 — 2 commits TDD: 0703a98, 3e51cf1; calev GO 6/6; merge 3f96354)
> **Complexity**: 3/10 (verifier: light — calev)
> **תלות**: אין (base=dev). depends_on: []. **קשור**: `slice-leave-running-background` (חשף את הבאג; bypassActive נשען על מצב-mode טרי). מומלץ למזג **לפני** leave-running.

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/acp-mode-config-sync -b slice/acp-mode-config-sync dev
cd .worktrees/acp-mode-config-sync
pnpm install && pnpm hooks:install
```

### Run
- Tests: `pnpm test` · `pnpm typecheck` · `pnpm lint`
- אימות חי (אופציונלי): build מלא (לא Vite) — `pnpm --filter @drive-coding/frontend-v2 build` ואז BE עם `FE_STATIC_DIR` (ראה memory `preview-full-build-not-vite`). claude על PORT פנוי.

### Browser
- claude כספק (יחיד שמאשר את הכפילות modes+configOptions). אימות: שנה mode חי → ודא ש-`session.modes.currentModeId` מתעדכן מיד (devtools).

### Reading list
**must-read**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `#onSessionUpdate` (~1237), `#captureSessionConfig` (~1083), `#applyConfigToClient` (~896), fixture-replay helper (~1189). זה הקובץ היחיד שמשתנה. (מספרי-שורות מקורבים — מצא לפי שם-סמל.)
- **דפוס-טסט קיים**: `agent-session.turnstate.test.svelte.ts:46-73,126-130` (captured-listener + `inject()`) + `agent-session.restore-config.test.svelte.ts:133-138` (זריעת `modes` דרך mock-return של newSession/loadSession). זה המנגנון לבדיקת events — **לא** קריאה ישירה ל-`#onSessionUpdate` (פרטי).
- `docs/decisions/voice-acp.md` §slice-23 (config-options) — הרקע לכפילות modes/configOptions.

**reference**:
- ACP SDK `types.gen.d.ts`: `SessionUpdate` union (~4330), `CurrentModeUpdate` (~1031), `ConfigOptionUpdate` (~787), `SessionModeState` (~4231).

## §1 — מטרה

ACP מגדיר זרם `SessionUpdate` עם events סמכותיים שהסוכן דוחף כשמצב משתנה. ה-FE (ה-ACP client) מטפל היום ב-5 בלבד (chunks + tool_call/update) ו**מתעלם** מ-`current_mode_update` ו-`config_option_update`. כתוצאה, כששינוי mode עובר במסלול config-option (claude חושף mode גם ב-`modes` וגם ב-`configOptions`), מתעדכן רק `configOptions` ו-`modes.currentModeId` נשאר תקוע — **הקורא הקונקרטי שנפגע ב-dev הוא ה-dropdown של ה-mode** ב-`SessionOptionsPanel.svelte:236` (`value={session.modes?.currentModeId}`): אחרי שינוי-mode חי הוא מציג ערך-ישן עד reconnect. (קורא נוסף, `bypassActive`, נוחת עם ה-slice הקשור `leave-running-background` ויהנה מאותו תיקון — אך אינו על dev כעת.) אחרי הסלייס: ה-FE מטפל בשני ה-events → מצב ה-mode/config נשאר **טרי וסמכותי** באמצע סשן, **לכל ספק תואם-ACP** (לא תיקון ספציפי-claude — השלמת conformance).

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| handler ל-`current_mode_update` → עדכון `modes.currentModeId` | ✅ | — |
| handler ל-`config_option_update` → עדכון `configOptions` | ✅ | — |
| `plan` / `available_commands_update` / `session_info_update` / `usage_update` | ❌ | events סטנדרטיים נוספים שלא מטופלים — slices נפרדים (slash/usage-meter וכו') |
| איחוד זיהוי-bypass חוצה-ספקים | ❌ | Track C — slice נפרד. הסלייס הזה נותן לו בסיס טרי |
| הסרת העדכונים האופטימיים ב-`#applyConfigToClient` | ❌ | נשארים כ-belt-and-suspenders (§9 שאלה 1) |
| שינוי UI כלשהו | ❌ | אין. VM-only |

## §3 — Architecture diagram

```
view-models/ agent-session.svelte.ts
  #onSessionUpdate(notification)            ← רק כאן משתנה
    ├─ "tool_call" / "tool_call_update" (קיים — לפני ה-text-guard)
    ├─ "current_mode_update"  ← חדש → this.modes = {availableModes(נשמר), currentModeId}
    ├─ "config_option_update" ← חדש → this.configOptions = update.configOptions
    │   ⚠️ שני החדשים יושבים מיד אחרי tool_call_update, **לפני** `if (!text) return`
    │      (mode/config לא נושאים content.text → return מוקדם יבלע אותם)
    ├─ "agent_message_chunk"  (קיים — אחרי ה-text-guard)
    ├─ "agent_thought_chunk"  (קיים)
    └─ "user_message_chunk"   (קיים)

  קוראי המצב (ללא שינוי, נהנים אוטומטית):
    SessionOptionsPanel dropdown (:236) → modes.currentModeId  (נהיה טרי)  ← הקורא הקיים ב-dev
    get bypassActive (נוחת עם leave-running) → נהנה גם הוא
```

## §4 — Commits

### Commit 0 — handler ל-`current_mode_update` (approach: TDD)

**שינויים** ב-`#onSessionUpdate` (agent-session.svelte.ts ~1237). מבנה ה-update (לפי `CurrentModeUpdate`): `{ sessionUpdate: "current_mode_update", currentModeId: string }`.

> ⚠️ **מיקום קריטי (avigail r1, finding #3):** שים את הענף **מיד אחרי בלוק `tool_call_update`, לפני** ה-guard `if (!text) return` (~שורה 1268; יש שם הערת-קוד מפורשת ~1255-1257). updates של mode/config **לא נושאים `content.text`**, אז ענף שיושב אחרי ה-`return` המוקדם = dead-code. ה-chunks (message/thought/user) יושבים אחרי ה-guard — אל תתבלבל מ"אחרי הענפים הקיימים".

**API skeleton**:
```ts
// בתוך #onSessionUpdate, מיד אחרי בלוק tool_call_update, לפני `if (!text) return`:
if (update.sessionUpdate === "current_mode_update") {
  const modeId = (update as { currentModeId?: unknown }).currentModeId
  if (typeof modeId === "string") {
    // שמור availableModes אם קיימים; קבע currentModeId טרי.
    // SessionModeState דורש availableModes — אם modes null, התחל ריק (הסוכן ישלים ב-load).
    this.modes = {
      availableModes: this.modes?.availableModes ?? [],
      currentModeId: modeId,
    }
  }
  return
}
```
> ⚠️ אל תשתמש ב-non-null assertion על `this.modes` — ייתכן null (ספק שמשתמש רק ב-configOptions). השתמש ב-`?.` + ברירת-מחדל `[]`.

**Verification**:
```bash
pnpm test -- agent-session
pnpm typecheck
```
טסט נדרש (TDD red→green) — **דפוס captured-listener (לא קריאה ישירה ל-`#onSessionUpdate` הפרטי!)**:
- חקה את `createAcpClient` כך שתתפוס את ה-listener (כמו `agent-session.turnstate.test.svelte.ts:46-73`), והשתמש ב-helper `inject(update)` שזורק notification דרך ה-listener התפוס (שם, ~126-130).
- **זרע `modes`** דרך mock-return של `newSession`/`loadSession` שמחזיר `modes: { availableModes:[...], currentModeId:"default" }` (כמו `restore-config.test:133-138`).
- אמת: לפני — `session.modes.currentModeId==="default"`; אחרי `inject({sessionUpdate:"current_mode_update", currentModeId:"bypassPermissions"})` → `currentModeId==="bypassPermissions"`, `availableModes` נשמר.

### Commit 1 — handler ל-`config_option_update` (approach: TDD)

**API skeleton** (אותו מיקום — לפני ה-text-guard, ליד ה-handler מ-commit 0):
```ts
if (update.sessionUpdate === "config_option_update") {
  const opts = (update as { configOptions?: unknown }).configOptions
  if (Array.isArray(opts)) {
    this.configOptions = opts as SessionConfigOption[]   // הסכמה מחזירה את הסט המלא
  }
  return
}
```

**Verification**:
```bash
pnpm test -- agent-session
pnpm typecheck && pnpm lint
```
טסט (אותו דפוס captured-listener + `inject()`): `inject({sessionUpdate:"config_option_update", configOptions:[...סט חדש...]})` → `session.configOptions` שווה לסט החדש.

## §5 — DoD

| בדיקה | איך |
|---|---|
| `current_mode_update` מעדכן `modes.currentModeId` | טסט agent-session (TDD) |
| `availableModes` נשמר בעדכון mode | טסט: assert availableModes לא נמחק |
| `modes===null` לא קורס בעדכון mode | טסט עם modes=null → לא throw, currentModeId נקבע |
| `config_option_update` מחליף `configOptions` | טסט agent-session (TDD) |
| events לא-מטופלים אחרים לא נשברים | טסטי agent-session קיימים ירוקים |
| typecheck + lint נקיים | `pnpm typecheck && pnpm lint` |
| (חי, אופציונלי) claude: שינוי mode → `modes.currentModeId` מתעדכן מיד בלי reconnect | devtools |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| `this.modes` null → non-null assertion קורס | desync ניתוח | `?.` + `?? []` בקוד; DoD בודק modes=null |
| Svelte 5 reactivity — מוטציה לא מפעילה re-render | learnings (קבוע) | **השמה מחדש** של object (`this.modes = {...}`, `this.configOptions = [...]`), לא push/mutate — מפעיל reactivity |
| ה-update מגיע בצורה לא צפויה (לא string/array) | wire variance | type-guards (`typeof === "string"`, `Array.isArray`) לפני השמה; אחרת מתעלם בשקט |
| כפילות עם עדכון אופטימי ב-`#applyConfigToClient` | שתי נקודות-כתיבה | לא מזיק — שתיהן כותבות אותו ערך; ה-event הוא הסמכותי. §9 שאלה 1 |

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- מבנה `CurrentModeUpdate`/`ConfigOptionUpdate` החי שונה מה-schema (שמות-שדה אחרים על ה-wire).
- מתברר שצריך לסנתז `availableModes` מתוך ה-event (ה-event לא נושא אותם — רק currentModeId; אם זה חוסם קורא כלשהו).
- הטיפול ב-event גורם ל-loop/echo עם העדכון האופטימי.

## §8 — Complexity score

- commits: 2 · שכבות: VM בלבד (0 חדשות) · APIs חיצוניים: 0 · streaming: 0 · refactor state-model: לא (תוספתי) · protocol: 0 (צריכת events קיימים בסטנדרט)
- **Score: 3/10 → light (`calev`)**

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | להסיר את העדכונים האופטימיים ב-`#applyConfigToClient` (~919 mode, ~933 model) עכשיו כשה-event סמכותי? | להשאיר (belt-and-suspenders; ה-event מגיע מיד אחרי). ניקוי = slice עתידי | ❌ |
| 2 | לסנתז `availableModes` כשהם חסרים ב-event? | לא — לשמור קיימים, להתחיל `[]` אם null. ה-load מביא את המלא | ❌ |
| 3 | לטפל גם ב-`session_info_update` (כותרת-סשן חיה)? | לא — מחוץ ל-scope; slice נפרד | ❌ |
