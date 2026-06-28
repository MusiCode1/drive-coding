# Slice session-prefs-per-cwd — שמירת state של סשן פר-פרויקט (BE, מסונכרן בין מכשירים) — בריף

> **תאריך**: 2026-06-21
> **סוג מסמך**: בריף ביצועי לסלייס — לא תוכנית טרום-בריף
> **סטטוס**: מאושר
> **אימות אביגיל**: READY (r3 — דוח: `reports/drive-coding/slice-session-prefs-per-cwd-avigail-r3.md`)
> **Dispatch**: מותר לאליעזר רק אם `אימות אביגיל = READY`; אחרת זה בריף לא-גמור.
> **Complexity**: 7/10 (verifier: light)
> **תלויות (`depends_on`)**: [] — בנוי ישירות על dev
> **Base**: dev
> **Dev tip**: `7444c85`

---

## §0 — Pre-flight

### תלויות (חובה!)

slice זה **אינו תלוי** באף slice אחר. בנוי ישירות על `dev` (`7444c85`). נשען על תשתית קיימת:
- דפוס store קובץ-מבוסס: `createRecordingsStore` (`packages/backend/src/app/recordings-store.ts`) ו-`createProjectsRegistry`.
- `AgentSession` עם `configOptions`/`models`/`modes` שנלכדים ב-`#captureSessionConfig` (slice 23).
- `Settings` view-model עם persist ל-localStorage (`settings.svelte.ts`).
- דפוס endpoint: `registerRecordingsHttp(app, { deps })` (`packages/backend/src/delivery/http-history.ts`).

### Worktree

```bash
cd /home/user/projects/drive-coding
git worktree add /home/user/projects/drive-coding/.worktrees/slice-session-prefs-per-cwd -b slice-session-prefs-per-cwd dev
cd /home/user/projects/drive-coding/.worktrees/slice-session-prefs-per-cwd
pnpm install && pnpm hooks:install
```
(bare repo — absolute path חובה.)

### איך להריץ

- BE+FE dev: `DRIVE_CODING_DATA_DIR=/tmp/dc-test-data pnpm --filter @drive-coding/backend dev` — **חובה env override**, אחרת תכתוב ל-`~/.drive-coding/` החי. default port 4000; אם תפוס → `PORT=4002`.
- Tests FE: `pnpm --filter @drive-coding/frontend test` (vitest)
- Tests BE: `pnpm --filter @drive-coding/backend test`
- Typecheck: `pnpm -r typecheck`
- ⚠️ אל תיגע ב-services החיים (`voice-acp-dev` :4001, `voice-acp-main` :4000) ובתיקייה `~/.drive-coding/` (data חי). הרץ על port נפרד + `DRIVE_CODING_DATA_DIR` נפרד.

### Browser

הבדיקה דורשת דפדפן + שני "מכשירים" כדי לאמת sync. השתמש ב-`playwright-cli` (skill) עם שני browser contexts מול אותו BE (= שני מכשירים וירטואליים). אמת ב-DevTools → Application, וגם בקובץ `$DRIVE_CODING_DATA_DIR/session-prefs.json`.

### Reading list

**must-read**:
- `packages/backend/src/app/recordings-store.ts` — הדפוס המלא של store קובץ-מבוסס (factory + loadIndex/saveIndex + JSON pretty).
- `packages/backend/src/server.ts` שורות 80-104 — wiring של ה-stores (`path.resolve("data/...")`) ו-`registerXxxHttp`.
- `packages/backend/src/delivery/http-history.ts` — דפוס endpoint Hono (`app.get`/`app.post`, `c.req.query`, `c.json`).
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `constructor(opts?)` (72), `applyConfigOption` (859), `#captureSessionConfig` (996), `newSession` (505-523), `loadSession` (640-665), שדות `cwd`/`#cliKind`/`configOptions`/`models`/`modes`.
- `packages/frontend/src/lib/view-models/settings.svelte.ts` — `Persisted`/`DEFAULTS`, `muted`/`voiceId`/`speakThoughts`/`narrateTools` + ה-setters שלהם.
- `packages/frontend/src/routes/+page.svelte` — שורות 17-59, 140 — מקור ה-`cwd`/`cliKind`, נקודת ה-connect/loadSession (orchestration point).

**reference**:
- `docs/decisions/drive-coding.md` — entry 2026-06-21 (הרציונל).
- `docs/conventions/parallel-safe-code.md` — דפוס "תוספתי".

---

## §1 — מטרה

כשהמשתמשת חוזרת לפרויקט — **מכל מכשיר** (מחשב בבית, טלפון ברכב) המחובר לאותו BE — הסשן נפתח אוטומטית עם אותן בחירות שבחרה שם לאחרונה: ה-mode (למשל `bypassPermissions`), ה-model, ה-agent ושאר ה-config של הסשן. ההעדפות **פר-פרויקט** (לפי `cwd`+`cliKind`) נשמרות בצד השרת ולכן **מסתנכרנות בין כל המכשירים**. (העדפות קול — נדחו ל-slice נפרד; ראה §2.)

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| BE store קובץ-מבוסס ל-session-prefs פר-(cwd, cliKind) | ✅ | הסלייס הזה |
| העברת **כל** ה-stores לנתיב `~/.drive-coding/` + env override | ✅ | הסלייס הזה |
| שחזור session-config (mode/model/agent/config) אחרי `newSession`, clamped | ✅ | הסלייס הזה |
| העדפות קול (`muted`/`voiceId`/`speakThoughts`/`narrateTools`) per-project | ❌ | `slice-voice-prefs-per-project` (נפרד — דורש runtime-tier ב-Settings) |
| sync בין מכשירים | ✅ | תוצאה של אחסון ב-BE |
| **migration** של data חי (recordings/cache) לנתיב החדש | ✅ אבל **תפעולי-ידני** | script + תיעוד; לא קוד-startup |
| toggle בהגדרות לכבות per-project sync | ❌ | slice עתידי — נרשם כהערה (§8) |
| backend-managed enforcement (BE מחיל את ה-prefs) | ❌ | עתידי; כרגע האכיפה ב-FE (ה-client שם) |
| שחזור ב-`loadSession`/warm-reconnect | ❌ | הסשן הקיים נושא את ה-mode שלו |

> זו לא טבלת TODO. זו הגנה מ-scope creep.

---

## §3 — Architecture diagram

```
מכשיר A (browser)        מכשיר B (browser)
   │  HTTP                   │  HTTP
   └──────────┬──────────────┘
              ▼
┌─────────────────────────────────────────────┐
│ drive-coding BE (Hono)                        │
│  GET/PUT /api/session-prefs  ←חדש             │
│        │                                      │
│        ▼                                      │
│  createSessionPrefsStore(file)  ←חדש          │
│        │                                      │
│        ▼                                      │
│  $DRIVE_CODING_DATA_DIR  (ברירת מחדל          │
│    ~/.drive-coding/)  ←נתיב חדש לכל ה-stores   │
│    ├─ session-prefs.json   ←חדש               │
│    ├─ recordings/          ←הועבר              │
│    └─ cache/               ←הועבר              │
└─────────────────────────────────────────────┘
              ▲ get/set(cwd, cliKind, …)
              │
   FE: AgentSession.#applySavedPrefs() אחרי newSession (session-config בלבד)
```

---

## §4 — Commits בסדר

### Commit 0 — נתיב `~/.drive-coding/` + env override (approach: integration)

**קובץ חדש**: `packages/backend/src/app/data-dir.ts`
```ts
import { homedir } from "node:os"
import { join } from "node:path"
/** שורש ה-state של drive-coding. ברירת מחדל ~/.drive-coding; override ל-tests/worktree. */
export function driveCodingDataDir(): string {
  return process.env.DRIVE_CODING_DATA_DIR ?? join(homedir(), ".drive-coding")
}
```

**קובץ שמשתנה**: `packages/backend/src/server.ts` (שורות 80-104) — החלף את כל ה-`path.resolve("data/...")` ב-`join(driveCodingDataDir(), "...")`:
- `data/recordings` → `join(dataDir, "recordings")`
- `data/cache` → `join(dataDir, "cache")`
- `data/cache/proxy` → `join(dataDir, "cache", "proxy")`
- `data/wire-recordings` → `join(dataDir, "wire-recordings")`

> **לא לשנות מעבר לזה** — רק ה-baseDir. לוגיקת כל store נשארת.

**טסט (integration)**: עם `DRIVE_CODING_DATA_DIR=/tmp/x`, store נכתב תחת `/tmp/x/...` ולא תחת `data/`.

---

### Commit 1 — BE session-prefs store + endpoints (approach: tdd)

**קובץ חדש (core — type משותף)**: `packages/core/src/schemas/session-prefs.ts` — **חובה ב-core, לא ב-backend**: גם ה-FE adapter וגם ה-BE store צריכים את הטיפוס, וה-FE **לא** מייבא מ-`@drive-coding/backend` (אין coupling כזה היום — לא לשבור). הוסף ל-barrel `packages/core/src/schemas/index.ts` (ה-`index.ts` הראשי כבר עושה `export * from "./schemas"`). מומלץ (conventions: ArkType) להוסיף גם schema ל-validation של גוף ה-PUT; לכל הפחות validate ב-handler ש-`patch` הוא אובייקט.
```ts
// packages/core/src/schemas/session-prefs.ts
export type SavedSessionState = {
  modelId?: string
  modeId?: string
  configValues?: Record<string, string | boolean>
  // הערה: voice fields (muted/voiceId/…) יתווספו ב-slice-voice-prefs-per-project. ה-schema פתוח להרחבה.
}
```

**קובץ חדש (BE store)**: `packages/backend/src/app/session-prefs-store.ts` — דפוס זהה ל-`recordings-store.ts`, קובץ **יחיד** (אין blobs). מייבא `SavedSessionState` מ-`@drive-coding/core`:
```ts
import type { SavedSessionState } from "@drive-coding/core"
function prefKey(cwd: string, cliKind: string): string { return `${cliKind} ${cwd}` }

export function createSessionPrefsStore(filePath: string) {
  async function load(): Promise<Record<string, SavedSessionState>> {
    try { return JSON.parse(await readFile(filePath, "utf8")) } catch { return {} }
  }
  async function save(all: Record<string, SavedSessionState>): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(all, null, 2), "utf8")
  }
  return {
    async get(cwd: string, cliKind: string): Promise<SavedSessionState | null> {
      return (await load())[prefKey(cwd, cliKind)] ?? null
    },
    async set(cwd: string, cliKind: string, patch: Partial<SavedSessionState>): Promise<void> {
      const all = await load(); const k = prefKey(cwd, cliKind)
      all[k] = { ...all[k], ...patch }; await save(all)
    },
  }
}
```
> ⚠️ **concurrency**: load-modify-save לא אטומי. שני PUT במקביל יכולים לדרוס. ב-MVP — סיכון נמוך (כתיבות נדירות, ממשתמש אחד). אם אביגיל דורשת — serialize דרך promise-chain פשוט. ציין בהחלטות.

**קובץ חדש**: `packages/backend/src/delivery/http-session-prefs.ts` (דפוס `http-history.ts` — שים לב: שם ה-dep = שם ה-store, typed; ו-`app: Hono` מטופס מפורש כדי למנוע implicit-any תחת strict):
```ts
import type { Hono } from "hono"
import type { SessionPrefsStore } from "../app/session-prefs-store.js"  // טיפוס מוחזר מה-factory

export function registerSessionPrefsHttp(
  app: Hono,
  deps: { sessionPrefsStore: SessionPrefsStore },
) {
  app.get("/api/session-prefs", async (c) => {
    const cwd = c.req.query("cwd"); const cliKind = c.req.query("cliKind")
    if (!cwd || !cliKind) return c.json({ error: "cwd and cliKind required" }, 400)
    return c.json(await deps.sessionPrefsStore.get(cwd, cliKind) ?? {})
  })
  // PUT נתמך ב-Hono (`app.put`). אין לו תקדים בקודבייס (קיימים רק get/post) — זה השימוש הראשון, תקין.
  app.put("/api/session-prefs", async (c) => {
    const body = await c.req.json()   // { cwd, cliKind, patch }
    if (!body?.cwd || !body?.cliKind) return c.json({ error: "cwd and cliKind required" }, 400)
    await deps.sessionPrefsStore.set(body.cwd, body.cliKind, body.patch ?? {})
    return c.json({ ok: true })
  })
}
```
> `SessionPrefsStore` כטיפוס: ייצא `export type SessionPrefsStore = ReturnType<typeof createSessionPrefsStore>` מ-`session-prefs-store.ts` (הימנע מהתנגשות שם עם ה-type שב-FE; כאן זה ה-store, לא ה-snapshot).

**wiring** ב-`server.ts`: `const sessionPrefsStore = createSessionPrefsStore(join(dataDir, "session-prefs.json"))` + `registerSessionPrefsHttp(app, { sessionPrefsStore })`.

**טסטים (tdd)** — `session-prefs-store.test.ts`:
1. set→get round-trip לאותו (cwd,cliKind).
2. שני cwd / שני cliKind נפרדים (4 תאים).
3. merge patch חלקי לא דורס שדות קיימים.
4. get על מפתח לא-קיים → null.
5. persist לדיסק: instance חדש קורא את אותו ערך.

---

### Commit 2 — FE: שחזור + שמירה של session-config (approach: integration + manual)

**קובץ חדש**: `packages/frontend/src/lib/adapters/session-prefs.ts` — fetch wrapper:
```ts
export async function fetchSessionPref(cwd, cliKind): Promise<SavedSessionState | null>
export async function putSessionPref(cwd, cliKind, patch: Partial<SavedSessionState>): Promise<void>
```
(משתמש ב-`be-url` util הקיים; fail → null / no-op, לא זורק.)

**קובץ שמשתנה**: `agent-session.svelte.ts`

> **חשוב (תיקון אחרי אביגיל r1)**: יש **שני** מסלולי "סשן חדש" (`newSession` ACP) שצריכים restore, ו**שלושה** מסלולי load/warm שלא:
> | מתודה | שורה | סוג | restore? |
> |------|------|-----|---------|
> | `attach()` | capture @519 | fresh (newSession ACP) | ✅ |
> | `newSession()` ציבורי | capture @818 | fresh (newSession ACP) | ✅ |
> | `loadSession()` | capture @648 | load | ❌ |
> | `switchSession()` | capture @759 | load | ❌ |
> | `#warmReconnect()` | capture @457 | warm/load | ❌ |

- **restore**: הוסף helper משותף שעוטף capture+restore, וקרא לו **רק** בשני מסלולי ה-fresh (במקום `#captureSessionConfig` הישיר שם):
```ts
async #captureSessionConfigFresh(result, cwd: string, cliKind: CliKind): Promise<void> {
  this.#captureSessionConfig(result)
  await this.#applySavedPrefs(cwd, cliKind)
}
```
  - ב-`attach()` @519: החלף `this.#captureSessionConfig(sessionResult)` ב-`await this.#captureSessionConfigFresh(sessionResult, input.cwd, input.cliKind)`.
  - ב-`newSession()` @818: החלף `this.#captureSessionConfig(result)` ב-`await this.#captureSessionConfigFresh(result, cwd, input.cliKind)` (`cwd` ו-`input.cliKind` זמינים שם).
  - שאר שלושת ה-call-sites (@457/648/759) — **לא נוגעים**, נשארים `#captureSessionConfig` רגיל.
```ts
async #applySavedPrefs(cwd, cliKind): Promise<void> {
  const pref = await fetchSessionPref(cwd, cliKind); if (!pref) return
  this.#restoringPrefs = true
  try {
    // סדר קריטי: model קודם. הרציונל הוא התנהגות האדפטר החיצוני claude-agent-acp
    // (v0.48.0 — `buildAvailableModes` חי בקוד האדפטר, לא ב-codebase של drive-coding):
    // availableModes נגזר מהמודל, ולכן שינוי model עשוי לשנות את רשימת ה-modes הזמינה.
    if (pref.modelId && this.models?.availableModels.some(m => m.modelId === pref.modelId)
        && pref.modelId !== this.models.currentModelId) await this.applyConfigOption("model", pref.modelId)
    if (pref.modeId && this.modes?.availableModes.some(m => m.id === pref.modeId)
        && pref.modeId !== this.modes.currentModeId) await this.applyConfigOption("mode", pref.modeId)
    for (const [id, v] of Object.entries(pref.configValues ?? {}))
      if (this.configOptions.some(o => o.id === id)) await this.applyConfigOption(id, v)
  } finally { this.#restoringPrefs = false }
}
```
- **capture**: ל-`applyConfigOption` יש **5** מסלולי-הצלחה (ה-`return`-ים במסלולים: optById, model-byCat, model-fallback, mode-byCat, mode-fallback) ומסלול skip אחד (ה-`console.warn` בסוף, ללא return). ה-capture חייב לרוץ בכל **5** מסלולי ההצלחה — **לא** ב-skip. הדרך הנקייה (מומלצת): refactor ה-public method ל-wrapper דק שמפריד ביצוע מ-capture:
```ts
applyConfigOption = async (configId, value): Promise<void> => {
  const ok = await this.#applyConfigOptionInner(configId, value)  // הגוף הקיים: return true ב-5 ההצלחות, return false ב-skip
  if (ok) void this.#persistCurrentConfig()
}
```
> חלופה אם לא רוצים refactor: קריאה מפורשת ל-`void this.#persistCurrentConfig()` לפני כל אחד מ-5 ה-returns. ה-wrapper עדיף (capture במקום אחד, פחות סיכוי לפספס מסלול).

ה-method `#persistCurrentConfig`:
```ts
#persistCurrentConfig(): void {
  if (this.#restoringPrefs || !this.cwd || !this.#cliKind) return
  const configValues = {} as Record<string, string|boolean>
  for (const o of this.configOptions) {
    if (o.category === "model" || o.category === "mode") continue
    const v = currentValueOf(o); if (v !== undefined) configValues[o.id] = v
  }
  void putSessionPref(this.cwd, this.#cliKind, {
    modelId: this.models?.currentModelId, modeId: this.modes?.currentModeId, configValues,
  })
}
// שדה: #restoringPrefs = false
```
> `currentValueOf(o)`: **helper חדש לכתיבה** (net-new — לא קיים בקוד). מחלץ ערך נוכחי מ-`SessionConfigOption`, שהוא discriminated union לפי `o.type`. ל-reference איך הערכים נקראים בפועל ראה `SessionOptionsPanel.svelte:212` (select → `.currentValue`) ו-`:97` (`onCheckboxChange` → boolean). type לא-מוכר → החזר `undefined` (מדלגים). אליעזר יאמת את שדות ה-union מול הטיפוס `SessionConfigOption` ב-`@agentclientprotocol/sdk` לפני המימוש.
> clamp + re-entrancy guard כמו לעיל. ערך לא-זמין מדולג, **לא** נמחק מה-store.

**טסטים (integration)**:
1. newSession עם pref.modeId תקף → applyConfigOption("mode",…) נקרא.
2. pref.modeId לא ב-availableModes → לא נקרא (clamp).
3. applyConfigOption מצליח → putSessionPref נקרא.
4. במהלך #applySavedPrefs → putSessionPref **לא** נקרא (guard).
5. loadSession **לא** מפעיל #applySavedPrefs.

**manual (DoD)**: §5.

---

## §5 — Definition of Done (manual, שני browser contexts מול אותו BE)

1. מכשיר-1: התחבר ל-cwd=A, cliKind=claude, בחר `bypassPermissions` + model.
2. בקובץ `$DRIVE_CODING_DATA_DIR/session-prefs.json`: יש entry ל-(A,claude) עם modeId/modelId.
3. מכשיר-2 (context אחר, אותו BE): התחבר ל-(A,claude) → סשן נפתח **כבר** עם bypassPermissions + model, בלי בחירה. אמת אין `request_permission` בריצה (wire log).
4. cwd=B → לא יורש מ-A (נפתח default).
5. cliKind=opencode על A → claude modes לא קיימים → clamp (לא יורש mode).
6. regression: עם `DRIVE_CODING_DATA_DIR` ריק — recordings/cache עדיין עובדים (store נוצר נקי). voiceId/muted/locale עדיין נטענים מ-localStorage כרגיל (לא נגענו בהם).

---

## §6 — Migration (תפעולי-ידני, לא קוד)

**קובץ חדש**: `scripts/migrate-data-dir.sh` — מעתיק (לא מוחק) data קיים לנתיב החדש:
```bash
# מריצים ידנית פר-deployment, פעם אחת, לפני restart עם הקוד החדש:
mkdir -p ~/.drive-coding
cp -rn <deployment>/data/recordings ~/.drive-coding/ 2>/dev/null || true
cp -rn <deployment>/data/cache      ~/.drive-coding/ 2>/dev/null || true
```
> **לא אוטומטי ב-startup** — כדי לא לסכן data חי ב-race/partial-copy. מרדכי מריץ על dev+main בזמן ה-deploy. `cp -n` = no-clobber (לא דורס). recordings UUID לא מתנגשים; cache — אם מתנגש, נשמר הקיים.

---

## §7 — Risks

| סיכון | חומרה | מיטיגציה |
|------|-------|----------|
| בדיקה/worktree מזהמים `~/.drive-coding/` החי | גבוה | `DRIVE_CODING_DATA_DIR` override **חובה** בכל הרצת פיתוח. ב-DoD מפורש. |
| איבוד recordings חיים במעבר נתיב | גבוה | migration ידני עם `cp -n` (העתקה, לא העברה). dev/main בנפרד. |
| תלות model→modes (clamp mode מול state לא-מסונכרן) | בינוני | סדר model→mode; clamp best-effort; ערך לא-תקף מדולג. ספק→עצור ודווח. |
| concurrency ב-store (load-modify-save) | בינוני | MVP: כתיבות נדירות. serialize אם אביגיל דורשת. |
| re-entrancy restore→apply→capture | נמוך | guard `#restoringPrefs`. |
| HTTP fail בזמן restore → סשן בלי prefs | נמוך | fail→no-op; הסשן נפתח ב-default (degradation עדין). |

---

## §8 — החלטות פתוחות + הערות

1. **toggle לכבות sync** (בקשת המשתמשת): בעתיד נוסיף הגדרה שמכבה את ה-per-project sync ומחזירה להתנהגות per-device/localStorage. **לא בסלייס הזה** — נרשם כאן כדי לא להישכח. כשיתווסף: כשה-toggle כבוי, `#applySavedPrefs`/`putSessionPref` מדלגים, והקול חוזר ל-localStorage בלבד.
2. **voice per-project — נדחה ל-`slice-voice-prefs-per-project`** (החלטת המשתמשת, 2026-06-21): סנכרון muted/voice בין מכשירים דורש runtime-tier ב-`Settings` (`effectiveX = override ?? persistedDefault`) ושינוי בכל הצרכנים של `settings.muted`/`voiceId`/וכו' — tier נפרד מ-session-config, ראוי ל-brief משלו. ה-schema של `SavedSessionState` נשאר פתוח להוספת השדות. `muted` יישאר per-device כברירת מחדל גם אז.
3. **מפתח flat** `${cliKind} ${cwd}`. nested מותר אם אליעזר מעדיף, כל עוד הטסטים עוברים.
4. **enforcement ב-FE**: כרגע ה-FE מחיל את ה-prefs (ה-AcpClient שם). כשיגיע backend-managed, האכיפה תיפול ל-BE — וה-store כבר יהיה במקום. צעד ראשון נכון בכיוון הגדול.

---

## §9 — Complexity score

| גורם | ניקוד |
|------|------|
| קבצים | ~6 (data-dir, store, http, server, adapter, agent-session) + טסטים |
| BE + FE | שניהם |
| לוגיקה לא-טריוויאלית | clamp, סדר model→mode, שני מסלולי fresh, concurrency |
| סיכון regression | בינוני-גבוה (newSession path, מעבר נתיב data חי — אך migration ידני מחוץ לקוד) |
| **סה"כ** | **7/10 → calev light (Sonnet)** |
