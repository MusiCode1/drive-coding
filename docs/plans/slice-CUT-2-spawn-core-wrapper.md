# Slice CUT-2 — bridge-manager → spawn-core wrapper (R3-style, על נתיב חי) — בריף

> **תאריך**: 2026-06-28 · **סטטוס**: brief · **branch**: slice/cutover-migration (ממשיך אחרי CUT-1)
> **Complexity**: 8/10 (verifier: **calev-heavy** — behavior-preserving על ה-spawn החי) + phase-gate · **depends_on**: [CUT-1]
> **Base**: `slice/cutover-migration` HEAD (אחרי CUT-1) · **Phase 3 — cutover (צעד 2/N)**
> ⚠️ **dev נע מהר** — אחרי CUT-2 ממזגים את CUT-1+CUT-2 ל-dev מהר (אישור).

---

## §0 — context

ה-`bridge-manager.ts` החי (309 שורות) הוא **מונוליט**: spawn + lifecycle + stdio + **4 פיצ'רים ספציפיים-ל-drive-coding
שזורים פנימה**. CUT-2 מפרק אותו ל-**wrapper דק** מעל `createSpawnCore` של החבילה (`@drive-coding/provider/host`),
כשה-4 מוזרקים דרך hooks (R3-style). **התנהגות זהה לחלוטין** — רק מבנה.

> **R3 כבר הוכיח את הדפוס הזה** (`slice/R3-spawn-core-untangle`, calev-**heavy** GO 10/10) — הוא ה-reference.
> אבל **לא העתקה עיוורת**: ה-live התקדם מאז R3 (נוסף `writeStdin`), וה-spawn-core בחבילה כבר **שלם יותר**
> מה-wrapper של R3 (כולל `writeStdin` native + `onFrame` לשני הכיוונים). מתאם מול ה-API הנוכחי, לא מול R3.

**ה-spawn-core בחבילה (מאומת)** — `createSpawnCore(hooks?): SpawnCore`:
- `SpawnCoreHooks.shapeEnv?(cliKind, baseEnv) → env` — להזרקת env ספציפי (opencode-config + audio-prompt).
- `SpawnCoreHooks.onFrame?(bridgeId, dir, rawLine)` — נקרא ל-**in וגם out** (out = verbatim מ-writeStdin) → wire-observability.
- `SpawnCore = BridgeManager & { spawnWithStderr, onLine, onCrash, writeStdin }` — **כולל writeStdin native**.

## §1 — מטרה

החלף את `createBridgeManager` המונוליטי ב-wrapper שמשתמש ב-`createSpawnCore` ומזריק את 4 הפיצ'רים דרך hooks,
**משמר את ה-API הציבורי המדויק הנוכחי** ואת ההתנהגות. 0 רגרסיה על ה-spawn החי.

## §2 — Scope

| כן | לא |
|---|---|
| `bridge-manager.ts` → wrapper מעל `createSpawnCore` (`@drive-coding/provider/host`) | שינוי ה-spawn-core בחבילה (הוא שלם — אם חסר משהו → §7) |
| 4 פיצ'רים מוזרקים: shapeEnv (opencode+audio) · onFrame (decodeWireLine + wireRecorder) · turn-tracking · markAttached/getRuntimeInfo | FE · cli-config · in-process host (CUT-3/track B) |
| **שימור API ציבורי מדויק נוכחי** (§3) | שינוי התנהגות / סמנטיקה |
| smoke חי: spawn + prompt + wire + turn-tracking + attach/runtime-info | — |

## §3 — ה-API הציבורי שחייב להישמר **בדיוק** (אל תסמוך על R3 — R3 ישן)

ה-consumers בנתיב החי (נתיבים מאומתים): `server.ts:86 createBridgeManager({ wireRecorder })` ·
`delivery/ws-agent.ts` (`.writeStdin`:106 · `.getChild`:67 · `.onLine`:86 · `.markAttached`:77 · `.markDetached`:136) ·
`app/agent-orchestrator.ts:150 .spawnWithStderr` · `delivery/http-agents.ts:26 getRuntimeInfo` (צורך `lastMessageAt`).

**ה-surface המלא הנוכחי (אומת מול ה-live — חייב להישמר בדיוק):**
```ts
export function createBridgeManager(opts?: { wireRecorder?: WireRecorder }): BridgeManager & {
  spawnWithStderr(bridgeId, input): Promise<BridgeHandleWithStderr>
  getChild(bridgeId): ChildProcessWithoutNullStreams | null        // 🔴 נצרך ws-agent.ts:67 — האצל ל-core (spawn-core.ts:54). אמת null/undefined מול ה-live
  onLine(bridgeId, cb): () => void                                  // 🔴 נצרך ws-agent.ts:86 — האצל ל-core (spawn-core.ts:55)
  writeStdin(bridgeId, line): boolean                               // האצל ל-core.writeStdin (כבר native)
  markAttached(bridgeId): void                                      // wrapper (attached-state)
  markDetached(bridgeId): void                                      // wrapper — נצרך ws-agent.ts:136
  getRuntimeInfo(bridgeId): { pid; attached; busy; lastMessageAt } | null  // 🔴 4 שדות! lastMessageAt מ-tracker.getLastActivityAt(); נבנה ב-wrapper (spawn-core אין לו getRuntimeInfo)
  onCrash(handler): () => void                                      // האצל ל-core
}
```
> **חלוקת-אחריות**: `spawnWithStderr`/`getChild`/`onLine`/`writeStdin`/`onCrash` → **האצל ל-core**.
> `markAttached`/`markDetached`/`getRuntimeInfo`(כולל lastMessageAt)/turn-tracking → **נבנים ב-wrapper** (ה-core generic, אפס ידע על turn/attach).
> **חובה לפני מימוש**: `grep -nE "\.(getChild|onLine|writeStdin|markAttached|markDetached|getRuntimeInfo|spawnWithStderr|onCrash)\("` על **כל** `packages/backend/src` — בנה את הרשימה המלאה + הצורות מהצרכנים. R3 = תבנית-מבנה בלבד, **לא** מקור-API.

## §4 — מימוש (R3-style, מותאם ל-live)

```ts
import { createSpawnCore } from "@drive-coding/provider/host"
const core = createSpawnCore({
  shapeEnv: (cliKind, base) => cliKind === "opencode"
    ? { ...base, OPENCODE_CONFIG_CONTENT: buildOpencodeConfigContent(base.OPENCODE_CONFIG_CONTENT), PROMPT_INJECTOR_TEXT: AUDIO_FRIENDLY_PROMPT }
    : base,                              // ⚠️ אמת את התנאי המדויק מול ה-live (אילו cliKind מקבלים מה)
  onFrame: (bridgeId, dir, raw) => {     // wire-observability — in + out
    /* decodeWireLine → wireLog.debug/trace */
    recs.get(bridgeId)?.record(dir, raw) // wireRecorder file (BE feature)
  },
})
```
- **turn-tracking + wireRecorder map (`recs`) + attached-state + getRuntimeInfo** — חיים ב-**wrapper** (מסביב ל-core).
  - `turn-tracker.observe()` נקרא על **in בלבד** (כמו ה-live, bridge-manager.ts:176) — דרך ה-onLine של ה-core או ב-onFrame(dir="in").
  - `getRuntimeInfo` בונה `{ pid: core.getChild(id)?.pid, attached, busy: tracker.isBusy(), lastMessageAt: tracker.getLastActivityAt() }`.
- **`writeStdin`** → האצל ל-`core.writeStdin` (ה-core כבר עושה onFrame ל-"out"; אל תכפיל decode).
- **`spawnWithStderr`/`getChild`/`onLine`/`onCrash`** → האצל ל-core.
- ה-4 הפיצ'רים (`buildOpencodeConfigContent`, `AUDIO_FRIENDLY_PROMPT`, `decodeWireLine`, `createTurnTracker`) **נשארים imports של BE**.

> ⚠️ **סדר ה-env-shaping (שינוי לטנטי — שים לב!)**: ב-**live** הסדר הוא `process.env` → הזרקת opencode-config+prompt
> → ואז cli-spec `unsetEnv`/`setEnv` (גוברים **אחרונים**). ב-**core** הסדר הפוך: cli-spec רץ על baseEnv, ואז
> `shapeEnv` רץ **אחרון**. לקונפיג ברירת-מחדל זה **שקול** (ה-override JSONC ריק/מיועד ל-proxy/CA, לא נוגע ב-OPENCODE_CONFIG_CONTENT).
> אבל אם override יגדיר `setEnv` עם אחד מהמשתנים האלה — ה-live נותן ל-override לנצח, ה-core ל-shapeEnv. **תעד כ-known-equivalent-for-default**;
> אם צריך שקילות מלאה — shapeEnv צריך לכבד spec-override (לא לדרוס). ה-smoke יוודא שאין override שדורס בקונפיג הרגיל.

> ⚠️ **init בנתיב המשותף**: גם `spawn` וגם `spawnWithStderr` מאצילים ל-`spawnInternal` יחיד (גם ב-live וגם ב-core) —
> אתחל trackers/recs בנתיב המשותף הזה (אין נתיב-init מפוצל). ודא cleanup ב-`onCrash`/exit (אין דליפת Map).

## §5 — DoD

| # | בדיקה |
|---|------|
| 1 | typecheck ירוק (כל ה-packages) |
| 2 | API ציבורי **זהה** — `git grep` על ה-surface (§3) לפני/אחרי תואם; consumers (server/ws-agent/agent-orchestrator) ללא שינוי |
| 3 | **spawn חי עובד** — claude/opencode spawn + prompt + תשובה (calev-heavy, מול CLI אמיתי) |
| 4 | **wire-observability** — `LOG_WIRE=acp` מפיק frames (in+out); `WIRE_RECORD=1` כותב קובץ (שני הכיוונים) |
| 5 | **turn-tracking** — busy-indicator עובד (getRuntimeInfo.busy מתעדכן בturn) |
| 6 | **attach/runtime-info** — markAttached/getRuntimeInfo (פאנל active-agents) עובד |
| 7 | opencode: OPENCODE_CONFIG_CONTENT + PROMPT_INJECTOR_TEXT מוזרקים (env על ה-child) |
| 8 | אין דליפת Map (trackers/recs מנוקים ב-crash/exit) — regression test |
| 9 | `pnpm test` ירוק (פרט ל-2 ה-pre-existing: bridge-failure[known]+https-serve[bun]) |

## §6 — Risks

| סיכון | מיטיגציה |
|---|---|
| API drift — משמיט writeStdin/markDetached/שדה שנוסף אחרי R3 | §3 חובה: grep על ה-live הנוכחי, לא R3. DoD#2 משווה surface |
| shapeEnv תנאי שגוי (איזה cliKind מקבל opencode-config) | אמת מול ה-live (§4 ⚠️); ה-live היום מזריק ל-opencode בלבד — שמר זהה |
| onFrame לא מכסה את שני הכיוונים → wire חסר ב-out | ה-core קורא onFrame ל-out (verbatim מ-writeStdin, spawn-core.ts:253); DoD#4 בודק שני כיוונים |
| **getChild/onLine/lastMessageAt** מושמטים → build אדום | §3 surface מלא + grep-חובה; DoD#2 משווה surface לפני/אחרי |
| **סדר env-shaping** הפוך (shapeEnv-last) → סטייה אם override דורס | §4 ⚠️ — תעד known-equivalent; smoke מוודא אין override בקונפיג רגיל |
| trackers/recs init / cleanup | §4 — init בנתיב המשותף `spawnInternal`; cleanup ב-onCrash/exit (regression test DoD#8) |
| spawn-core בחבילה חסר יכולת שה-live צריך | §7 escalation — אל תשנה את החבילה בלי לעצור |
| התנהגות child-env שונה (baseEnv) | shapeEnv מקבל baseEnv ומרחיב; ודא שלא מאבד env קיים |

> 3 שתמיד נשכחים: ESM `.js` · lint:i18n (BE כן נסרק!) · phase-gate אחרי commit ה-wrapper לפני smoke.

## §7 — Escalation

- אם ה-spawn-core בחבילה **חסר** hook/יכולת שה-live צריך (משהו שה-monolith עשה ואי-אפשר להזריק) → **עצור, תעד** (מרדכי). ייתכן שצריך להוסיף hook לחבילה (slice נפרד) לפני CUT-2. אל תשנה את החבילה אד-הוק.
- אם ההתנהגות משתנה ולו במעט (busy/wire/env) ולא ברור למה → עצור (זה behavior-preserving; כל סטייה = בעיה).

## §8 — Complexity: 8/10 → **calev-heavy** (behavior-preserving על ה-spawn החי — edge cases, regressions, patterns). phase-gate: אחרי commit ה-wrapper (לפני smoke) — calev phase מאשר שה-API נשמר.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | `markDetached` קיים? | ✅ כן (bridge-manager.ts:266, נצרך ws-agent.ts:136) — שמר | ❌ |
| 2 | shapeEnv: רק opencode מקבל config? | ✅ כן (bridge-manager.ts:82) — אמת ושמר | ❌ |
| 3 | turn-tracker observe על in בלבד? | ✅ in בלבד (bridge-manager.ts:176) | ❌ |
| 4 | commits: 1=wrapper+API, 2=smoke+regression? | כן | ❌ |
