# Slice enter-toggle — ביטול שליחה ב-Enter (toggle) — תוכנית

> **תאריך**: 2026-06-24
> **סטטוס**: מאושר (אביגיל READY — `reports/drive-coding/slice-enter-toggle-avigail.md`)
> **Complexity**: 2/10 (verifier: light)
> **תלות (depends_on)**: `[chat-render-polish]` — מבוסס על תשתית ה-settings שלו (כרטיס "תצוגת צ'אט", דפוס `Persisted` עם `collapseThoughts`/`expandTools`, כפתור reset). **base = `dev` אחרי merge של chat-render-polish.**

---

## §0 — Pre-flight

### Worktree
```bash
# רק אחרי ש-slice-chat-render-polish מוזג ל-dev!
git worktree add .worktrees/slice-enter-toggle -b slice-enter-toggle dev
cd .worktrees/slice-enter-toggle
pnpm install && pnpm hooks:install
```

### Run
- **FE בלבד מספיק** (אין נגיעת BE/proxy בסבב הזה):
  `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned, Vite מדפיס)
- typecheck/test/lint:
  ```bash
  pnpm --filter @drive-coding/frontend typecheck
  pnpm --filter @drive-coding/frontend test
  pnpm lint:i18n
  ```

### Browser
- אין DISPLAY במכונה → linux-gui Chrome :9222.
  `playwright-cli -s=vacp attach --cdp=http://localhost:9222` (תמיד `-s=vacp`).
- אפשר לבדוק בלי BE: `/chat?mock=greeting` (reload מלא, לא ניווט SPA). מספיק כדי לבדוק את התנהגות ה-textarea.

### OneCLI agent
- **לא דרוש** — אין קריאת proxy/TTS בסבב הזה.

### Reading list
**must-read לפני**:
- `packages/frontend/AGENTS.md` — חמשת חוקי הזהב (במיוחד #2 entity-not-screen, #4 effect ownership).
- `packages/frontend/src/lib/view-models/settings.svelte.ts` — **ההוראות בראש הקובץ (שורות 4-13)** איך מוסיפים שדה Persisted. עקוב אחרי הדפוס של `collapseThoughts`/`expandTools` בדיוק.

**reference בזמן עבודה**:
- `packages/frontend/src/lib/components/chat/TypeArea.svelte` — ה-handler שמשתנה (שורות 42-47).
- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte` — כרטיס "תצוגת צ'אט" (שורות 124-138) + כפתור reset (173-180).
- `packages/core/src/i18n/keys.ts:202-204` + `catalogs/he.ts:192-194` + `catalogs/en.ts:197-199` (L196 = שורת-הערה) — דפוס הוספת מפתח (chat-render-polish).

---

## §1 — מטרה

המשתמש יוכל לבחור ב-Settings אם **Enter שולח הודעה** (ברירת מחדל — התנהגות נוכחית) או לא. כשהאפשרות כבויה, Enter יוצר שורה חדשה (כמו עורך טקסט רגיל), ושליחה נעשית בכפתור-השליחה או ב-Cmd/Ctrl+Enter. זה נותן שליטה למי שמכתיב טקסט רב-שורתי (קולי/נייד) ולא רוצה שליחה בטעות.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| toggle `enterToSend` ב-settings + persist | ✅ | הסבב הזה |
| Enter / Shift+Enter / Cmd+Ctrl+Enter ב-TypeArea | ✅ | הסבב הזה |
| הדבקת תמונות / multimodal prompt | ❌ | slice image-paste (תלוי-חוזה) |
| פקודות Slash | ❌ | slice slash-commands (תלוי-חוזה) |
| prompt history (↑/↓), shell mode (`!`) | ❌ | backlog §5 (nice-to-have) |
| שינוי התנהגות ה-send button | ❌ | תמיד שולח, ללא שינוי |

## §3 — Architecture diagram

```
┌─ routes ──────────────────────────────────────────────┐
│  (ללא שינוי)                                            │
├─ components ──────────────────────────────────────────┤
│  TypeArea.svelte          ← keydown logic לפי setting   │
│  settings/SettingsScreen  ← SettingToggle + reset       │
├─ view-models ─────────────────────────────────────────┤
│  settings.svelte.ts       ← שדה enterToSend (+setter)   │
├─ engines / adapters ──────────────────────────────────┤
│  (ללא שינוי)                                            │
└────────────────────────────────────────────────────────┘
core/i18n: keys.ts + he.ts + en.ts  ← מפתח settings.toggle.enterToSend
```

## §4 — Commits

### Commit 1 — שדה settings + i18n + test (approach: mixed — additive + unit test)

**קבצים שמשתנים**:
- `packages/core/src/i18n/keys.ts` — אחרי `"settings.toggle.expandTools"` (L204) הוסף:
  ```ts
  | "settings.toggle.enterToSend"
  ```
- `packages/core/src/i18n/catalogs/he.ts` — אחרי L194:
  ```ts
  "settings.toggle.enterToSend": "Enter שולח הודעה",
  ```
- `packages/core/src/i18n/catalogs/en.ts` — אחרי L199:
  ```ts
  "settings.toggle.enterToSend": "Enter sends message",
  ```
- `packages/frontend/src/lib/view-models/settings.svelte.ts` — **6 נקודות**, בדיוק כמו `expandTools`:
  1. `Persisted` (אחרי L44): `enterToSend: boolean`
  2. `DEFAULTS` (אחרי L68): `enterToSend: true,  // ברירת מחדל = התנהגות נוכחית (Enter שולח)`
  3. `$state` (אחרי L130): `enterToSend = $state<boolean>(DEFAULTS.enterToSend)`
  4. constructor (אחרי L153): `this.enterToSend = loaded.enterToSend`
  5. setter (אחרי L323): ```ts
     setEnterToSend = (v: boolean): void => {
       this.enterToSend = v
       this.#persist()
     }
     ```
  6. `#persist()` object (אחרי L341): `enterToSend: this.enterToSend,`

**API skeleton (התוספת ל-Settings)**:
```ts
class Settings {
  enterToSend: boolean         // $state, DEFAULTS.enterToSend = true
  setEnterToSend(v: boolean): void   // מעדכן + #persist()
}
```

**Test** — `packages/frontend/src/lib/view-models/settings.test.svelte.ts`:
- ברירת מחדל: `new Settings().enterToSend === true`
- round-trip persistence: `setEnterToSend(false)` → instance חדש טוען `false` (מאותו דפוס בדיקה של שדות קיימים — חפש `expandTools`/`muted` בקובץ הטסט והעתק).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck   # 0 errors
pnpm --filter @drive-coding/frontend test         # כל הטסטים + החדש ירוקים
pnpm lint:i18n                                     # אין עברית בקוד; שני המפתחים קיימים בשתי השפות
```

### Commit 2 — חיווט UI (approach: manual — browser smoke)

**קובץ `packages/frontend/src/lib/components/chat/TypeArea.svelte`**:
- הוסף ל-import (L11): `getSettings` →
  ```ts
  import { getI18n, getSession, getSettings } from "$lib/context"
  ```
- הוסף אחרי `const session = getSession()` (L13): `const settings = getSettings()`
- החלף את ה-`onkeydown` (L42-47) ב:
  ```ts
  onkeydown={(e) => {
    // Cmd/Ctrl+Enter תמיד שולח (power-user, ללא תלות בהגדרה)
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      onSubmit()
      return
    }
    // Enter רגיל שולח רק כש-enterToSend פעיל; Shift+Enter תמיד שורה חדשה
    if (e.key === "Enter" && !e.shiftKey && settings.enterToSend) {
      e.preventDefault()
      onSubmit()
    }
  }}
  ```
  > הערה: כש-`enterToSend=false`, Enter **לא** עושה `preventDefault` → התנהגות ברירת-המחדל של ה-textarea (שורה חדשה). שליחה: כפתור-השליחה (תמיד קיים, ידידותי-נייד) או Cmd/Ctrl+Enter.

**קובץ `packages/frontend/src/lib/components/settings/SettingsScreen.svelte`**:
- בכרטיס "תצוגת צ'אט" (אחרי toggle `expandTools`, L136) הוסף:
  ```svelte
  <SettingToggle
    label={t("settings.toggle.enterToSend")}
    checked={settings.enterToSend}
    onCheckedChange={(v) => settings.setEnterToSend(v)}
  />
  ```
- בכפתור reset (אחרי `settings.setExpandTools(false)`, L179) הוסף:
  ```ts
  settings.setEnterToSend(true)
  ```

**Verification (browser smoke)**:
```bash
pnpm --filter @drive-coding/frontend dev
# בדפדפן (linux-gui :9222), /settings:
#  1. כרטיס "תצוגת צ'אט" → toggle חדש "Enter שולח הודעה" דלוק (ברירת מחדל)
#  2. /chat?mock=greeting → הקלד טקסט → Enter שולח (ברירת מחדל)
#  3. כבה את ה-toggle → /chat → Enter יוצר שורה חדשה; Cmd/Ctrl+Enter שולח; כפתור-שליחה שולח
#  4. reset → ה-toggle חוזר לדלוק
pnpm --filter @drive-coding/frontend typecheck && pnpm lint:i18n
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| `enterToSend` ב-Persisted/DEFAULTS/$state/constructor/setter/#persist | code review מול 6 הנקודות; typecheck 0 errors |
| ברירת מחדל `true` (התנהגות נוכחית נשמרת) | טסט unit; ידני: Enter שולח כברירת מחדל |
| round-trip persistence | טסט unit (instance שני טוען את הערך השמור) |
| toggle off → Enter = שורה חדשה | ידני ב-/chat |
| Cmd/Ctrl+Enter שולח בשני המצבים | ידני |
| Shift+Enter תמיד שורה חדשה | ידני |
| כפתור-שליחה שולח תמיד | ידני |
| toggle מופיע בכרטיס "תצוגת צ'אט" + ב-reset | ידני ב-/settings |
| שני מפתחי i18n קיימים ב-he+en | `pnpm lint:i18n` ירוק; code review |
| typecheck + test + build נקיים | הפקודות ב-§4 |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| מחרוזת עברית קשיחה בקוד | learnings (pre-commit hook חוסם) | התווית דרך `t("settings.toggle.enterToSend")`; המפתח ב-he+en |
| Svelte 5 reactivity | learnings | אין array-mutation כאן; `settings.enterToSend` נקרא בתוך event-handler (לא render) → קריאת-ערך רגילה, ללא בעיית reactivity |
| בסיס שגוי — file:line של SettingsScreen/settings לא תואמים | אביגיל r1 ב-slice-bunx (spike על בסיס לא-נכון) | **base חייב להיות dev אחרי merge של chat-render-polish.** אם הכרטיס "תצוגת צ'אט" לא קיים ב-SettingsScreen → הבסיס שגוי, עצור |
| נייד בלי Cmd/Ctrl — אין דרך לשלוח כש-toggle כבוי | — | כפתור-השליחה תמיד קיים ופעיל (`type="submit"`, L50-58) → תמיד יש מסלול שליחה |

## §7 — Escalation triggers

עצור ושאל את מרדכי (parent task) אם:
- כרטיס "תצוגת צ'אט" / השדות `collapseThoughts`/`expandTools` **לא קיימים** בבסיס → chat-render-polish לא מוזג; הבסיס שגוי.
- `getSettings` לא זמין מ-`$lib/context` (לא אמור — SettingsScreen משתמש בו).
- ה-textarea לא יוצר שורה חדשה ב-Enter כש-`enterToSend=false` (התנהגות דפדפן בלתי צפויה).

## §8 — Complexity score

- commits: 2 (נמוך)
- שכבות חדשות: 0 (VM + component קיימים) — נמוך
- APIs חיצוניים: 0
- streaming/async: לא
- refactor state model: לא
- שינוי protocol BE↔FE: לא

**Score ≈ 2/10 → verifier `calev` mode: light.** אין phase רגיש (אין I/O / state-refactor).

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | האם Cmd/Ctrl+Enter ישלח גם כש-`enterToSend=true`? | כן — עקבי ולא מזיק (תמיד "שלח") | ❌ |
| 2 | מיקום ה-toggle — בכרטיס "תצוגת צ'אט" הקיים או כרטיס חדש "קלט"? | בכרטיס הקיים (חוסך כרטיס, שייך לתצוגת-צ'אט) | ❌ |
| 3 | טקסט התווית בעברית — "Enter שולח הודעה" או "שליחה ב-Enter"? | "Enter שולח הודעה" (ברור) | ❌ |
