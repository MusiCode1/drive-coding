# Slice CUT-3b-i — ProviderConnection primitive (spawn-based, package-side) — בריף

> **תאריך**: 2026-06-28 · **סטטוס**: הושלם · **branch**: slice/cutover-migration (ממשיך אחרי CUT-3a)
> **Complexity**: 7/10 (verifier: light + תשומת-לב למעבר חוצה-חבילה) · **depends_on**: [CUT-3a] · **Base**: `slice/cutover-migration` @ `49f1527`
> **לא ממזגים — ‏נצבר על cutover-migration.**

---

## §0 — context

ההכרעה (המשתמש, 2026-06-28): החבילה מספקת **פרימיטיבים ניטרליים-לסביבה** וה-BE **מרכיב** מהם
orchestrator/registry/crash/wire-observability/turn-tracking. הפרימיטיב המרכזי: `ProviderConnection` —
חיבור-ספק שחושף wire-stream + onFrame(decoded) + turn + onCrash + capabilities + ext.

CUT-3b-i בונה את הפרימיטיב **בחבילה, spawn-based, additive** — **לא נוגע בנתיב החי** (bridge-manager נשאר
כמו-שהוא; ה-rewire הוא CUT-3b-ii). מעביר את הלוגיקה הגנרית (wire-decode + turn-tracker) מה-BE לחבילה
(ביתם הנכון — ACP-גנרי, transport-neutral). **Variant A**: onFrame מחזיר frame מפוענח.

> ⚠️ ייווצר **כפל זמני**: `connectSpawn` (חדש) ו-bridge-manager (קיים) שניהם wrap spawn-core. זה מכוון —
> CUT-3b-ii ימוסס את bridge-manager. כאן connectSpawn **לא מחובר חי**, רק נבנה+נבדק.

## §1 — מטרה

`ProviderConnection` interface + `connectSpawn(cliKind, opts) → ProviderConnection` בחבילה, שעוטף spawn-core +
turn-tracker + wire-decode (שעוברים לחבילה) וחושף את הפרימיטיב המלא. tests. הנתיב החי לא משתנה (פרט ל-import-path
של turn-tracker/wire-decode ב-bridge-manager).

## §2 — Scope

| כן | לא |
|---|---|
| העברת `wire-decode.ts` + `turn-tracker.ts` → `provider/src/shared/` (גנרי, transport-neutral) | rewire של orchestrator/ws-agent (CUT-3b-ii) |
| `connection/types.ts` — `ProviderConnection`, `WireFrame`, `ConnectOpts` (wire = onLine-style) | claude in-process מאחורי connect (CUT-3b-iii) |
| `connection/spawn.ts` — `connectSpawn()` (wraps spawn-core + turn + decode → primitive) | מחיקת bridge-manager (CUT-3b-ii) |
| **subpath `./connection`** (barrel: connectSpawn + types + re-export decodeWireLine/createTurnTracker/WireSummary) + tests | שינוי התנהגות בנתיב החי |
| עדכון import של turn-tracker/wire-decode ב-`bridge-manager.ts` (מ-BE-local ל-`@drive-coding/provider/...`) | — |

## §3 — מימוש

### א. מעבר חוצה-חבילה (git mv + repoint)
- `backend/src/delivery/wire-decode.ts` (+`.test.ts`) → `provider/src/shared/wire-decode.ts` (pure, אפס תלויות — נקי).
- `backend/src/acp/turn-tracker.ts` (+`.test.ts`) → `provider/src/shared/turn-tracker.ts` (תלוי רק ב-`WireSummary` מ-wire-decode — נשאר עקבי).
- **export surface (הכרעה — אביגיל)**: subpath חדש **`./connection`** בלבד (אין `./shared`). ה-barrel `connection/index.ts` **מ-re-export** את `decodeWireLine`, `createTurnTracker`, `type WireSummary`, `type TurnTracker` (מ-`../shared/`) **בנוסף** ל-`connectSpawn` + הטיפוסים. כך:
  - **consumer ב-BE** (`bridge-manager.ts`) — repoint `decodeWireLine`/`createTurnTracker`/`WireSummary` ל-`@drive-coding/provider/connection`. ⚠️ נגיעה ב-BE מינימלית (import-path בלבד, כמו CUT-1).
  - `connectSpawn` (ב-`connection/spawn.ts`) מייבא `createSpawnCore` דרך **relative פנימי** (`../shared/spawn-core.js`) — לא דרך subpath.
- ⚠️ ודא ש-`WireSummary` מיוצא מ-`connection` barrel — turn-tracker וה-BE צריכים.

### ב. `connection/types.ts`
```ts
// type נגזר (WireSummary אין לו type) — ראה §3ג
export interface WireFrame { dir: "in" | "out"; type: string; id?: string | number; raw: string; parsed: unknown }
export interface ConnectOpts {
  cwd: string
  // cliKind מטופס כמו spawn-core: SpawnBridgeInput["cliKind"] (לא core/CliKind — להימנע מ-import מיותר)
  shapeEnv?: (cliKind: SpawnBridgeInput["cliKind"], base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
}
export interface ProviderConnection {
  // ⚠️ onLine-style (לא ReadableStream) — תואם ל-ws-agent הקיים (ws-agent.ts:86) ול-spawn-core
  readonly wire: { onLine(cb: (line: string) => void): () => void; write(line: string): boolean }
  readonly capabilities: NormalizedCapabilities
  onFrame(cb: (f: WireFrame) => void): () => void          // Variant A — מפוענח
  readonly turn: { isBusy(): boolean; lastActivityAt(): number | null; onChange(cb: (busy: boolean) => void): () => void }
  onCrash(cb: (info: BridgeCrashInfo) => void): () => void
  close(): Promise<void>
  readonly ext?: { call(method: string, params: unknown): Promise<unknown> }  // undefined ל-spawn
  readonly pid: number | null
}
```

### ג. `connection/spawn.ts` — `connectSpawn`
⚠️ **ה-API האמיתי של spawn-core (אביגיל)**: `onFrame` הוא **hook ב-constructor** (לא method); `getChild`/`writeStdin`/`onLine`
**דורשים `bridgeId`**; `onCrash` **global** ‏(`(bridgeId, info) => ...`). ה-connection מחזיק **`bridgeId` פנימי יחיד** ומעביר אותו לכל קריאה.

`connectSpawn` יוצר spawn-core עם hooks ומתרגם לפרימיטיב (כמו ש-bridge-manager עושה היום):
```ts
const bridgeId = newId()
const frameListeners = new Set<(f: WireFrame) => void>()
const tracker = createTurnTracker()
const core = createSpawnCore({
  shapeEnv: opts.shapeEnv,
  onFrame(bId, dir, rawLine) {                 // ← hook, לא method
    const s = decodeWireLine(rawLine)
    const type = s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")  // ← type נגזר (bridge-manager.ts:93-95)
    const f: WireFrame = { dir, type, id: s.id, raw: rawLine, parsed: s.parsed }
    if (dir === "in") tracker.observe(s, Date.now())   // 🟢 avigail: ה-live מזין רק על 'in' (bridge-manager.ts:97-99) — שמר זהה
    for (const cb of frameListeners) cb(f)      // re-broadcast
  },
})
await core.spawnWithStderr(bridgeId, { cliKind, cwd: opts.cwd, ... })
return {
  wire: { onLine: (cb) => core.onLine(bridgeId, cb), write: (l) => core.writeStdin(bridgeId, l) },
  onFrame: (cb) => { frameListeners.add(cb); return () => frameListeners.delete(cb) },
  turn: { isBusy: () => tracker.isBusy(Date.now()), lastActivityAt: () => tracker.getLastActivityAt(), onChange: /* poll/derive */ },
  onCrash: (cb) => core.onCrash((bId, info) => { if (bId === bridgeId) cb(info) }),  // ← סנן ל-bridgeId שלנו
  close: () => core.kill(bridgeId),
  pid: core.getChild(bridgeId)?.pid ?? null,
  capabilities: staticCapsFor(cliKind),         // static map (opencode: ext=undefined)
  ext: undefined,                                // spawn-native — אין ext channel שלנו
}
```
- `turn.onChange`: turn-tracker היום הוא pull-based (isBusy(now)); ל-onChange אפשר poll קל פנימי או derive מ-onFrame. MVP: derive מ-onFrame (busy השתנה → emit).
- single connection = single bridgeId (ריבוי = orchestrator ב-CUT-3b-ii).

## §4 — Commits

0. git mv של wire-decode + turn-tracker → `provider/src/shared/` + repoint imports (provider פנימי + bridge-manager ב-BE). typecheck + tests (הטסטים שלהם עברו גם). 
1. `connection/types.ts` (ProviderConnection/WireFrame/ConnectOpts) + export `./connection`. typecheck.
2. `connection/spawn.ts` `connectSpawn` + tests (spawn fake/real: onFrame מפוענח, turn.isBusy מתעדכן, onCrash, write/onLine). findings + walkthrough.

## §5 — DoD

| # | בדיקה |
|---|------|
| 1 | typecheck ירוק (כל packages — bridge-manager עכשיו מייבא turn-tracker/wire-decode מהחבילה) |
| 2 | `pnpm test` ירוק — הטסטים שעברו (wire-decode/turn-tracker) עוברים במיקום החדש; 0 רגרסיה |
| 3 | `@drive-coding/provider/connection` ניתן-לייבוא; `connectSpawn` + `ProviderConnection` מיוצאים |
| 4 | `connectSpawn` (test): onFrame מחזיר WireFrame מפוענח (type/id/dir); turn.isBusy()=true בזמן turn; onCrash נורה; write עובד |
| 5 | **bridge-manager התנהגות לא השתנתה** — רק import-path של turn-tracker/wire-decode (diff = imports בלבד שם) |
| 6 | additive — `packages/provider/**` + `bridge-manager.ts` imports + `docs/**` בלבד; אין rewire של orchestrator/ws-agent |
| 7 | `ext` = undefined ל-connectSpawn (spawn-native) |

## §6 — Risks

| סיכון | מיטיגציה |
|---|---|
| מעבר turn-tracker/wire-decode שובר את bridge-manager החי | DoD#5 — repoint import בלבד; typecheck+tests תופסים; bridge-manager לוגיקה ללא שינוי |
| `WireSummary` vs `WireFrame` בלבול (שתי צורות) | WireSummary = הפלט הגולמי של decodeWireLine (נשאר); WireFrame = העטיפה של הפרימיטיב (dir+raw+type+id+parsed). תעד הקשר |
| wire `readable` vs `onLine` — חוסר-התאמה ל-ws-agent ב-ii | §3 ⚠️ + §9#1 — הכרע onLine-style מראש (תואם ws-agent) |
| כפל connectSpawn↔bridge-manager | מכוון, זמני; CUT-3b-ii ממוסס. תעד |
| spawn-core single-bridge vs connection model | connectSpawn = חיבור יחיד (bridgeId פנימי); ריבוי = orchestrator ב-ii |

> 3 שנשכחים: ESM `.js` · git **mv** (blame) · lint:i18n (BE+provider).

## §7 — Escalation
- אם ה-wire-stream model (readable vs onLine) לא מתיישב נקי עם spawn-core הקיים או עם הצורך של ws-agent (ii) → עצור, הכרע עם מרדכי לפני שממשיכים (זה משפיע על ii).

## §8 — Complexity: 7/10 → calev light (פרימיטיב package-internal; האמת מ-tests + import-check; אין נתיב-חי מושפע פרט ל-import-repoint).

## §9 — שאלות פתוחות

| # | שאלה | ברירת-מחדל | חוסם? |
|---|------|----------|------|
| 1 | `wire`: `readable` או `onLine(cb)`? | ✅ **onLine(cb)** — אומת תואם ל-ws-agent.ts:86 (אביגיל); נעול ב-§3ב | ❌ |
| 2 | turn-tracker/wire-decode ב-`shared/` או `connection/`? | `shared/` (גנריים, ליד spawn-core); re-export דרך `./connection` barrel | ❌ |
| 3 | capabilities ל-spawn (opencode) מאיפה? | static map פר-provider (ל-opencode: configOptions=?; ext=false). MVP: שלד, מלא ב-iii | ❌ |
