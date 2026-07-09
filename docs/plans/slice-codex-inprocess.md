# Slice — codex-inprocess — תוכנית

> **תאריך**: 2026-07-02
> **סטטוס**: סבב-fix הושלם (2026-07-02 — Fix A: `6b40fa8` resolveCliBinary TDD; Fix B: `ab6401a` codex משתמש ב-resolver + תיקון done(). ממתין ל-calev בסביבה נקייה בלי CODEX_PATH)
> **Complexity**: 7/10 (verifier: light — calev, אך **חובה אימות-חי codex**)
> **תלות**: fork `MusiCode1/codex-acp#inprocess-lib` (חלק A — הושלם, אומת in-process). base=dev.
> **קשור**: `docs/investigations/2026-07-01-be-shutdown-socket-health.md` (npx=שורש היתומים/exit-2), `docs/decisions/drive-coding.md` (provider cutover Model 2)

## רקע

codex רץ היום דרך `npx -y @zed-industries/codex-acp@latest` (spawn). זה מקור לשלוש בעיות
שאומתו חי (ר' מסמך shutdown-health): boot ~10ש' (מירוץ מול init-timeout), נכד-יתום
שמחזיק את הפורט, ו-exit-2 של המתאם הרשמי החדש תחת bun-spawn. **הוכח חי**: הרצת ה-JS של
המתאם ישירות (בלי npx) פותרת את שלושתן.

הפורק `MusiCode1/codex-acp#inprocess-lib` (חלק A, הושלם) חושף `startAcpServer(readable,
writable, opts)` דרך subpath `./lib` — **אומת in-process בלי BE** (initialize + session/new
חיים מול native codex). הסלייס הזה מחווט אותו ל-drive-coding כספק **in-process** (מודל claude).

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/codex-inprocess -b slice/codex-inprocess dev
cd .worktrees/codex-inprocess
pnpm install && pnpm hooks:install
```

### Run
- provider tests: `pnpm --filter @drive-coding/provider test`
- typecheck: `pnpm typecheck` (+ `pnpm --filter @drive-coding/frontend-v2 typecheck` אם נוגעים ב-FE)
- BE (בלי onecli — codex לא צריך proxy): `cd packages/backend && PORT=4010 bun src/server.ts`

### בדיקה חיה — codex (הליבה)
1. חבר codex דרך ה-FE (או API+WS ל-`/ws/agent/:id`).
2. צפוי: `initialize` נענה מהר (~1ש', **לא ~10ש'**), `session/new` מצליח, נכנס לצ'אט.
3. wire: **אין** `npx` בעץ-התהליכים; ה-child הישיר הוא codex/node (לא npx).
4. אחרי כיבוי ה-agent: **אין codex-acp יתום** (kill פוגע ישירות).

### git-dep הערה
הפורק נצרך כ-`github:MusiCode1/codex-acp#inprocess-lib`. הוא בונה dist ב-install דרך
`prepare` (dist gitignored). ⚠️ לאמת ש-pnpm מריץ prepare ושה-subpath `./lib` נפתר.

### Reading list
**must-read**:
- `packages/provider/src/connection/connect-in-process.ts` — דגם claude in-process (agent()+onConnect+onRequest).
- `packages/provider/src/connection/stream-bridge.ts` — הבריج של claude (⚠️ acp-sdk **object** streams — codex שונה, ר' §3).
- `packages/provider/src/connection/types.ts` — `ProviderConnection` (החוזה שקודקס-in-process חייב לספק).
- `packages/backend/src/acp/connection-registry.ts:106-112` — נקודת הניתוב claude→inprocess/else→spawn.
- הפורק: `~/projects/@Forks/codex-acp/src/lib.ts` (`startAcpServer` signature).

**reference**:
- `packages/provider/src/shared/spawn-core.ts` (spawn נוכחי — נשאר ל-opencode/gemini).
- `packages/core/src/schemas/agent.ts:38-42` (CLI_SPECS.codex — משתנה/מוסר).

## §1 — מטרה

חיבור codex דרך ה-FE נהיה מהיר (~1ש' במקום ~10) ואמין: המתאם רץ **in-process** (מודל claude),
codex עצמו child מנוהל דרך `CODEX_PATH` → native codex. אין npx, אין boot-race, אין יתומים.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| codex → in-process דרך הפורק | ✅ | הסבב הזה |
| `connectCodexInProcess` (connect fn חדשה, מייצרת ProviderConnection) | ✅ | הסבב הזה |
| ניתוב codex ב-connection-registry | ✅ | הסבב הזה |
| `CODEX_PATH` resolution (native codex) | ✅ | הסבב הזה |
| **הכללת claude+codex ל-connect-in-process גנרי אחד** | ❌ | דגמי-stream שונים (object vs NDJSON). קודקס=connect fn נפרדת שמייצרת אותו ProviderConnection. הכללה עמוקה = slice נפרד (§ ארגון-provider) |
| warm-reattach skip-init | ❌ | slice-warm-reattach-skip-init (נפרד; רלוונטי לכל מתאם) |
| graceful-shutdown / kill-tree | ❌ | slice בריאות-הכיבוי (נפרד) |
| החלפת opencode/gemini ל-JS-ישיר | ❌ | future (אותו רציונל, ספק אחר) |

## §3 — Architecture diagram

```
connection-registry.ts (routing)
  claude → connectInProcess     (acp-sdk object-Stream + createStreamBridge)   ← קיים
  codex  → connectCodexInProcess ← חדש
  else   → connectSpawn                                                        ← קיים

connectCodexInProcess(opts) → ProviderConnection:
  serverIn  = PassThrough()   ─┐  (Node NDJSON streams — לא acp-sdk object-Stream!)
  serverOut = PassThrough()   ─┤
  startAcpServer(serverIn, serverOut, { codexPath })   ← מהפורק (import "@agentclientprotocol/codex-acp/lib")
       └─ המתאם מריץ native codex כ-child (דרך CODEX_PATH)
  wire.write(line) → serverIn.write(line)         (FE→agent)
  serverOut 'data' → split '\n' → wire.onLine     (agent→FE)
  + onFrame/turn/onCrash/capabilities/pid — כמו connectInProcess (decodeWireLine, turn-tracker)
```

**נקודת-המפתח**: קודקס-הפורק מדבר **NDJSON על Node streams** (`createJsonStream`), שקרוב ל-`wire`
המחרוזתי שלנו — לכן **לא** משתמשים ב-`createStreamBridge` (שהוא ל-acp-sdk object-streams של claude).
הבריג של codex פשוט יותר: PassThrough ↔ wire lines.

## §4 — Commits

### Commit 0 — git-dep של הפורק (approach: manual)
**קובץ**: `packages/provider/package.json`
- הוסף dependency: `"@agentclientprotocol/codex-acp": "github:MusiCode1/codex-acp#inprocess-lib"`.
- הסר את התלות הישנה אם קיימת (`@zed-industries/codex-acp` — לבדוק אם בכלל ב-deps; היום זה npx בלבד, לא dep).
**Verification**:
```bash
pnpm install   # חייב להריץ prepare של הפורק ולבנות dist
node -e "import('@agentclientprotocol/codex-acp/lib').then(m=>console.log('lib ok:', typeof m.startAcpServer))"
```
> אם `prepare` לא רץ / `./lib` לא נפתר → escalate (§7).

### Commit 1 — connectCodexInProcess (approach: mixed — unit ל-wire-adapter, manual ל-connect)
**קובץ חדש**: `packages/provider/src/connection/connect-codex-in-process.ts`
**API skeleton**:
```ts
import { startAcpServer } from "@agentclientprotocol/codex-acp/lib"
import { PassThrough } from "node:stream"
import type { ConnectOpts, ProviderConnection } from "./types.js"

export async function connectCodexInProcess(opts: ConnectOpts): Promise<ProviderConnection> {
  const serverIn = new PassThrough()    // FE→agent (NDJSON)
  const serverOut = new PassThrough()   // agent→FE (NDJSON)
  const codexPath = resolveCodexPath()  // §Commit 2
  startAcpServer(serverIn, serverOut, { codexPath })   // ⚠️ אין modelOverride ב-StartAcpServerOptions (ר' הערת-מודל למטה)
  // wire: write→serverIn; onLine← split serverOut by '\n'
  // onFrame/turn: decodeWireLine + createTurnTracker (כמו connect-in-process)
  // capabilities: staticCapsFor("codex") (§Commit 2); pid: null; ext: undefined
  // onCrash: serverOut 'close'/codex exit → notify
  return { wire, capabilities, onFrame, turn, onCrash, close, pid: null }
}
```
> **הערת-מודל (finding אביגיל #1 — הוכרע)**: `StartAcpServerOptions` של הפורק כולל רק
> `codexPath`/`config`/`modelProvider`/`defaultAuthRequest` — **אין `modelOverride`**. ב-codex
> בחירת-המודל היא **FE-driven דרך ה-wire** (`session/new` params / `setSessionModel`, שכבר
> עוברים דרך ה-wire שאנחנו מפילים) — לא דרך אופציית הפורק. לכן `connectCodexInProcess`
> **מתעלם מ-`opts.modelOverride`** (בשונה מ-claude שמזריק ל-`_meta` ב-`connect-in-process`).
> אם בעתיד נרצה default-model פר-spawn ל-codex — דרך `modelProvider` או injection ל-session/new.
- ה-`onLine` buffering: לצבור עד `\n` (כמו createJSONRPCReader / spawn-core.onLine).
- `close()`: `serverIn.end()` + סגירת המתאם (readable close מפעיל kill ל-codex child אחרי 2ש' — מובנה בפורק).
**Verification**: unit לbuffer-adapter (write/onLine round-trip); `pnpm --filter @drive-coding/provider test`.

### Commit 2 — CODEX_PATH resolution + capabilities סטטי (approach: mixed)
**קבצים**: `connect-codex-in-process.ts` (או helper) · `packages/provider/src/connection/capabilities-static.ts`
- `resolveCodexPath()`: איתור native codex. **ברירת-מחדל מוצעת** (§9-Q1): חפש `codex` ב-PATH → נתיב מלא; אם לא נמצא → `undefined` (הפורק ינסה bundled). Windows: bundled שבור → חובה נתיב מלא.
- **capabilities — שם נכון** (finding אביגיל #2): ה-helper הקיים הוא `staticCapsFor(cliKind)` ב-`capabilities-static.ts:17` (switch פר-cliKind). **להוסיף `case "codex"`** שם — לא ליצור `staticCodexCapabilities()` חדש. `connectCodexInProcess` קורא `staticCapsFor("codex")`. (שים לב: `connect-in-process.ts:254` משתמש ב-`mapClaudeCapabilities(null)` ולא ב-static helper — זה claude-ספציפי; ל-codex ניקח את המסלול הסטטי.)
  - הערכים: **קלט אמיתי מהבדיקה החיה** — codex מדווח `loadSession:true`, `mcpCapabilities.http:true`, `promptCapabilities.image:true`. מיפוי ל-`NormalizedCapabilities`: `mcp:true`, `thinkingTokens:false`, `rename:false`, השאר לפי מה שאומת (לא all-false כמו היום).
- **header של capabilities-static.ts** (finding אביגיל #3, 🟢): הכותרת מצהירה "spawn-based". בהוספת codex (in-process) — לעדכן את ה-header שהקובץ מכסה גם static-caps ל-in-process (codex), לא רק spawn.
**Verification**: unit ל-resolveCodexPath (mock PATH) + `staticCapsFor("codex")`; typecheck.

### Commit 3 — routing ב-registry (approach: manual)
**קובץ**: `packages/backend/src/acp/connection-registry.ts` (~106-112)
- שינוי הניתוב:
  ```ts
  cliKind === "claude" ? await connectInProcess(connectOpts)
  : cliKind === "codex" ? await connectCodexInProcess(connectOpts)
  : await connectSpawn(cliKind, connectOpts)
  ```
- export ל-`connectCodexInProcess` מ-`connection/index.ts`.
**Verification**: `pnpm typecheck`; בדיקה חיה §0.

## §5 — DoD

| בדיקה | איך |
|---|---|
| pnpm install בונה את הפורק (prepare) ו-`./lib` נפתר | `node -e "import('@agentclientprotocol/codex-acp/lib')..."` (Commit 0) |
| wire-adapter round-trip (write→onLine) | unit ירוק (Commit 1) |
| resolveCodexPath + capabilities | unit ירוק (Commit 2) |
| typecheck נקי | `pnpm typecheck` = 0 |
| **חי**: codex connect דרך BE → initialize מהיר (~1ש') + session/new + chat | ידני §0 |
| **חי**: אין `npx` בעץ; ה-child הוא codex/node ישיר | `Get-CimInstance`/`ps` בזמן ריצה |
| **חי**: אחרי כיבוי agent — אין codex יתום | בדיקת תהליכים אחרי delete |
| claude + opencode עדיין עובדים (לא רגרסיה) | חי — claude in-process, opencode spawn |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| git-dep לא מריץ `prepare` → אין dist | ניסיון-חי (dist gitignored) | הוספתי `prepare` בפורק; Commit 0 מאמת מפורשות; fallback: לקמט dist בפורק |
| `@openai/codex` המצורף קורס על Windows | אומת חי (exit 1) | `CODEX_PATH`→native חובה על Windows (Commit 2); אומת שעובד עם נתיב מלא |
| `CODEX_PATH` machine-specific | אומת (bare "codex" לא עבד) | resolveCodexPath דינמי (PATH→full); לא hardcode. פר-פלטפורמה |
| codex boot איטי עדיין (~session/new 6ש') | אומת חי | in-process מסיר את זמן ה-npx (~10ש'); שאר האטיות codex-side — מחוץ לסקופ. שקול bump ל-INIT_TIMEOUT (slice נפרד) |
| stream backpressure ב-PassThrough | — | PassThrough מטפל אוטומטית; write fire-and-forget כמו wireEnd הקיים |
| Svelte 5 / i18n / OneCLI | — | לא נוגעים ב-FE/מחרוזות; codex לא צריך proxy |

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- `pnpm install` לא בונה את git-dep / `./lib` לא נפתר (מנגנון prepare נכשל) — מכריע אם לקמט dist.
- ה-PassThrough↔wire adapter דורש טיפול backpressure/framing מעבר ל-split-by-newline.
- codex מחזיר שגיאה על `session/load`/`initialize` in-process שלא ראינו ב-harness.
- ה-ProviderConnection של codex לא מסתדר עם onCrash/turn של ה-registry הקיים.

## §8 — Complexity score

- commits: 4 · שכבות חדשות: 1 (connectCodexInProcess) · dep חיצוני חדש: +1 (git-dep) · stream plumbing: +1 · שינוי registry routing: משיק.
- **Score 7/10 → light (calev)**, אבל האימות-החי (codex דרך BE, אין npx/יתומים) הוא הליבה — calev חייב להריץ אותו על סביבה עם native codex.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | `resolveCodexPath` — איך לאתר native codex פר-פלטפורמה | PATH-lookup ל-`codex`→נתיב מלא; אם אין→undefined (bundled, עובד על linux/termux). Windows חייב מלא | 🟡 לא-חוסם (יש default), אך להכריע cross-platform |
| 2 | ref ל-git-dep — branch `inprocess-lib` או למזג ל-fork main / tag | `#inprocess-lib` (branch) בינתיים | ❌ |
| 3 | לצרוך את הפורק ב-provider או backend package | provider (שם חיים connect*) | ❌ |
| 4 | האם gemini/opencode גם יעברו ל-JS-ישיר בעתיד | מחוץ לסקופ; לתעד ב-roadmap | ❌ |

---

## סבב-fix (2026-07-02) — resolveCliBinary + findings כלב

> runtime-gate ראשון החזיר **PARTIAL** (2 findings). השורש: `resolveCodexPath()` מומש
> env-only (`return process.env["CODEX_PATH"]`) — **סטייה מ-§9-Q1** שקבע PATH-lookup. בלי
> `CODEX_PATH` מוגדר → undefined → bundled codex → קורס על Windows → codex לא "עובד מהקופסה".
> ההכרעה (עם המשתמשת): לבנות **resolver כללי** ללוקיישן של בינארי-CLI מותקן, location-only.

### findings כלב (r1 PARTIAL)
1. 🟡 `resolveCodexPath` env-only, אין PATH-lookup → codex נכשל בלי CODEX_PATH ידני. **המהותי.**
2. 🟡 טסט `wire.write` משתמש ב-`done()` callback (deprecated ב-Vitest 4) → uncaught-exception warning (הטסט עובר).

### Fix Commit A — `resolveCliBinary` (approach: TDD, טהור location-only)
**קובץ חדש**: `packages/core/src/cli-resolve.ts` (+ test)
**⚠️ חיווט exports (finding אביגיל #1 — קובץ-שורש ב-core מיוצא בשני מקומות, תקדים `cwd-hash`)**:
- הוסף ל-`packages/core/package.json` exports map: `"./cli-resolve": "./src/cli-resolve.ts"`.
- הוסף re-export ב-`packages/core/src/index.ts` (barrel).
- provider יייבא `@drive-coding/core/cli-resolve` (subpath, כמו `@drive-coding/core/log`). בלי זה — module-resolution נכשל ב-typecheck.
**API skeleton**:
```ts
// טהור + סינכרוני. fs.existsSync + env בלבד. אין spawn (לא which/where). cross-platform.
export interface CliResolveSpec {
  /** שם הבינארי לחיפוש (ללא סיומת), למשל "codex". */
  bin: string
  /** env var לדריסה מפורשת, למשל "CODEX_PATH". גובר על הכל. */
  envVar?: string
  /** מיקומים ידועים פר-CLI (נתיבים מלאים או תיקיות; מורחבים עם ~ ו-env). */
  knownPaths?: string[]
}

/** מחזיר נתיב מלא לבינארי המותקן, או undefined אם לא נמצא. */
export function resolveCliBinary(spec: CliResolveSpec): string | undefined
```
**שכבות (לפי קדימות)**:
1. `spec.envVar` אם מוגדר ולא-ריק → מוחזר כמו-שהוא (דריסה מפורשת).
2. **PATH scan**: `(process.env.PATH ?? "").split(path.delimiter).filter(Boolean)` (⚠️ guard ל-PATH===undefined — finding אביגיל #2), ולכל dir בדוק `<bin>` + על Windows כל סיומת ב-`PATHEXT` (`.EXE/.CMD/.BAT/.PS1`). ראשון קיים → נתיב מלא.
3. **pm-global-bin** (ההצעה הנוספת): `~/.bun/bin`, npm global bin (`process.env.npm_config_prefix`/‏מיקום סטנדרטי), `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin` — בדוק `<bin>`(+ext).
4. **`spec.knownPaths`**: מיקומים ידועים פר-CLI (codex: `%LOCALAPPDATA%/Programs/OpenAI/Codex/bin`, WinGet Links).
5. אחרת → `undefined`.
> **סמנטיקה** (הוכרע): מחפש את **הבינארי של הכלי** (`codex`/`claude`/`opencode`), לא את ה-npx-wrapper.
**Verification**: unit — env-override, PATH-hit (mock PATH dir עם קובץ), PATHEXT על Windows, miss→undefined.

### Fix Commit B — codex משתמש ב-resolver + תיקון טסט
**קבצים**: `connect-codex-in-process.ts` · `connect-codex-in-process.test.ts`
- `resolveCodexPath()` → `resolveCliBinary({ bin: "codex", envVar: "CODEX_PATH", knownPaths: [...] })`.
- תקן את טסט `wire.write`: הסר `done()` → `Promise`/`await` (דפוס Vitest 4).
**Verification**: `pnpm --filter @drive-coding/provider test` (144+ ירוק, אפס warnings); typecheck 0.

### מחוץ לסקופ (follow-up נפרד — לתעד ב-roadmap)
- חיווט `spawn-core` (opencode/gemini) ו-claude-SDK ל-`resolveCliBinary` — יפתור גם את בעיות
  `npx`/`.cmd` על Windows. **לא כאן.**
- זיהוי-גרסה — לא-אחיד cross-platform (Windows=PE, Unix=`--version`/package.json). לא בסקופ.

### DoD מעודכן (סבב-fix)
| בדיקה | איך |
|---|---|
| `resolveCliBinary` — env/PATH/known/miss | unit ירוק (Commit A) |
| codex משתמש ב-resolver; אין `done()` בטסטים | provider test ירוק, אפס warnings (Commit B) |
| **חי — out-of-box**: BE **בלי CODEX_PATH ב-env** → codex connect + initialize מהיר | calev, סביבה נקייה (codex ב-PATH; **לא** להגדיר CODEX_PATH) |
| שאר ה-DoD החי מ-§5 (אין npx, אין יתומים, session/new) | calev |

> **קריטי ל-calev הבא**: להריץ **בלי `CODEX_PATH` ב-env** — זה מה שמוכיח שה-PATH-lookup עובד
> (ה-GO הקודם היה מוטעה כי ה-env במקרה כלל CODEX_PATH).
