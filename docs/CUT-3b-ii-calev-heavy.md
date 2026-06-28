---
project: "drive-coding"
slice: "CUT-3b-ii-be-rewire"
verifier: "calev"
date: "2026-06-28"
mode: "heavy"
verdict: "GO"
dod_items:
  - "typecheck green (all packages)"
  - "spawn alive — connect calls connectSpawn with correct params (static + integration tests)"
  - "WS pump — conn.wire.onLine/write wired in ws-agent"
  - "wire-observability — conn.onFrame registered once in registry.connect, not in ws-agent write"
  - "turn/busy — getRuntimeInfo.busy from conn.turn.isBusy"
  - "attach — markAttached/markDetached + getRuntimeInfo.attached (BE-state)"
  - "crash — conn.onCrash fires registry crash listeners + cleanup, no Map leak"
  - "opencode env — shapeEnv injects OPENCODE_CONFIG_CONTENT + PROMPT_INJECTOR_TEXT"
  - "bridge-manager.ts deleted; no live consumer remains; double-spawn regression moved to registry"
  - "modelOverride live — ConnectOpts.modelOverride passed, not hardcoded null"
  - "port/wsUrl stub: bridgePort=0/wsUrl='' preserved; dead dedup path stays no-op"
  - "pnpm test green except 3 documented pre-existing (https-serve x2, bridge-failure-integration x1)"
spot_check: "ran typecheck (green) + full test suite (1003 pass, only the 3 documented pre-existing fails) + 5 slice-touched test files in isolation (47 pass) + grep for leftover bridge-manager consumers (none in src) + i18n lint (clean)"
findings: []
---

# CUT-3b-ii — BE rewire: connection-registry — Verification Report (Heavy)

> **תאריך:** 2026-06-28
> **Tier:** heavy
> **Commit בסיס:** ac43a79 · **HEAD:** 18ff277 (branch slice/cutover-migration)
> **שיטה:** static analysis + code-reading + typecheck + test-suite (אין BE רץ — behavior-preserving rewire, האימות החי הוא ה-integration tests עם child processes אמיתיים)
> **Worktree:** /home/user/projects/drive-coding/.worktrees/cutover-migration

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 12/12 |
| Regressions | 0 |
| Bugs חדשים | 0 |
| Tests ש-אליעזר הכריז | אומת — typecheck ירוק, 1003 pass, רק 3 ה-pre-existing המתועדים נכשלים |

**Verdict: GO.** ה-slice הוא behavior-preserving rewire נקי. כל 4 ה-findings של אביגיל (modelOverride, dedup, port-stub, dead-dedup-noop) טופלו במדויק. כל edge-case שה-brief סימן (כפל wire-observability, Map-leak אחרי crash, attached-state ב-registry, modelOverride לא-null) נבדק ואומת. ה-3 כשלים בסוויטה הם בדיוק ה-pre-existing המתועדים, ואף אחד מהם לא נגרם/הוחמר ע"י ה-slice.

## טבלת DoD items

| # | Item מה-brief | סטטוס | עדות |
|---|---------------|--------|------|
| 1 | typecheck ירוק (כל packages) | ✅ | `pnpm typecheck` → `tsc --build` exit 0 |
| 2 | spawn חי — connect→connectSpawn params נכונים | ✅ | spawn.ts:104-110 (cliKind/cwd/modelOverride); connection-registry.test.ts "connect returns ProviderConnection" + pid>0 (child אמיתי) |
| 3 | WS pump — onLine/write דרך conn.wire | ✅ | ws-agent.ts:80 (`conn.wire.onLine`), :102 (`conn.wire.write`); ws-agent-pipe.test green |
| 4 | wire-observability — onFrame פעם אחת (לא כפול) | ✅ | onFrame רשום ב-registry.connect (connection-registry.ts:107) בלבד; ws-agent.ts:90-102 כותב raw בלי decode. decode יחיד. |
| 5 | turn/busy — getRuntimeInfo.busy מ-conn.turn | ✅ | connection-registry.ts:164 `e.conn.turn.isBusy()`; spawn.ts:77-80 observe על dir==="in" (תואם bridge-manager:97-99) |
| 6 | attach — markAttached/markDetached + attached | ✅ | registry מחזיק attached ב-ConnEntry (לא ב-ws-agent); attached-state tests (3 cases) green |
| 7 | crash — conn.onCrash → registry update(crashed) | ✅ | registry.ts:121-130 (crash listeners + cleanup); orchestrator.ts:101-115 update(status=crashed); crash+map-leak tests green |
| 8 | opencode env — shapeEnv מוזרק | ✅ | orchestrator.ts:82-91 drivecodingShapeEnv (opencode→OPENCODE_CONFIG_CONTENT+PROMPT_INJECTOR_TEXT verbatim; claude=passthrough), מועבר ב-connect opts:160 |
| 9 | bridge-manager.ts נמחק; אין צרכן; regression עבר | ✅ | git: bridge-manager.ts + .runtime.test.ts deleted (commit 2). grep src: 0 צרכנים חיים (רק comments + ה-`BridgeManager` interface הנפרד ב-provider/core). F-1 regression migrated ל-bridge-failure-modes.test (registry+orchestrator layers) |
| 10 | modelOverride חי — מועבר, לא null | ✅ | spawn.ts:108 `opts.modelOverride ?? null` (לפני: hardcoded null); types.ts:38 ConnectOpts.modelOverride; orchestrator.ts:159 מעביר input.modelOverride |
| 11 | port/wsUrl stub: 0/"" נשמרים; dead dedup no-op | ✅ | orchestrator.ts:165-167 (bridgePort=0, wsUrl=""); :135 `if (duplicate?.bridgePort)` — תמיד false → no-op, נשמר ביודעין |
| 12 | pnpm test ירוק פרט ל-pre-existing | ✅ | 1003 pass / 1 fail (bridge-failure-integration F-1) + 2 unhandled (https-serve — Windows bun path). שלושתם pre-existing מתועדים. |

## Flows שעבדו מקצה לקצה (verified via integration tests + static trace)

- ✅ **spawn → connection registered** — `registry.connect("agent","opencode",{cwd})` מפעיל child אמיתי, מחזיר conn עם pid>0, נכנס ל-Map. (connection-registry.test.ts)
- ✅ **close → no Map leak** — `close` מסיר מ-Map, סוגר wireRecorder session, מריץ unsubs; `get`/`getRuntimeInfo` מחזירים undefined/null אחרי. close idempotent (double-close לא זורק).
- ✅ **crash → cleanup + listener** — child שיוצא פולט crash → registry crash listeners נקראים → cleanup מסיר מ-Map → orchestrator מסמן status=crashed. אין uncaught.
- ✅ **dedup (NBug1) — double-connect** — connect שני על אותו agentId זורק "already live", הראשון שורד עם attached-state שלו שלם. ה-guard לפני connectSpawn (לא דורס conn חי).
- ✅ **WS pipe attach/detach** — feWs מתחבר → markAttached + conn.wire.onLine/write; feWs נסגר → markDetached + unsub, **בלי conn.close** (ה-connection שורד ניתוק FE). detach idempotent (error+close ברצף → ניקוי פעם אחת).
- ✅ **failure modes (F-1)** — connect דוחה נקי על כל מצב כשל (spawn ENOENT סינכרוני, child בלי pid, async error מאוחר); orchestrator מחזיר דחייה ל-caller בלי להפיל את ה-BE. (bridge-failure-modes.test.ts — registry + orchestrator layers)

## Flows שנשברו

אין.

## Regressions

אין. בדקתי במפורש את כל ה-regression vectors שה-brief סימן:

- **כפל wire-observability** — נמנע. onFrame ב-registry בלבד; ws-agent כותב raw בלי decode. ✅
- **Map leak אחרי crash** — נמנע. cleanup ב-onCrash + close, שניהם idempotent (`if(!entry) return`). ✅
- **attached-state location** — ב-registry (ConnEntry.attached), לא ב-ws-agent. http-agents קורא דרך getRuntimeInfo. ✅
- **modelOverride hardcoded null** — תוקן ב-spawn.ts:108. ✅
- **shapeEnv condition (opencode-only)** — verbatim מ-bridge-manager:71-83; claude=passthrough. ✅

3 ה-flows מ-slices קודמים שבדקתי שעדיין עובדים: ws-agent pipe (slice 10/3b), ws-agent error survival (slice ws-error-survival), bridge-failure-modes (slice 10 F-1) — כולם ירוקים.

## Bugs חדשים שלא ברשימה

אין.

## הערות-עומק (heavy — מה שבדקתי ושלא נשבר)

1. **dir semantics** — spawn-core: `dir:"in"` = child→BE (onLine path), `dir:"out"` = BE→child (writeStdin). turn-tracker ב-spawn.ts observe על `dir==="in"` — נכון (עוקב תגובות הסוכן, תואם bridge-manager:97-99). ההגדרה counter-intuitive אבל עקבית עם המקור.
2. **close() אחרי crash** — `close` תופס `e = map.get()` לפני `cleanup` (שמוחק), אז `e.conn.close()` עדיין רץ על הרפרנס. אם crash כבר ניקה → `if(!e) return`. בטוח.
3. **conn.turn.onChange** — לא נצרך ב-BE (busy הוא pull-based דרך getRuntimeInfo). זה תקין — onChange קיים בחוזה לעתיד, אין חובת-שימוש.
4. **wireRecorder no-op fallback** — `{ record(){}, close(){} }` ב-registry.ts:101 תואם בדיוק ל-WireSession ול-NOOP_SESSION הקנוני. אין IO כש-WIRE_RECORD כבוי.
5. **server wiring** — connectionRegistry מועבר כ-`bridgeManager:` ל-registerAgentsHttp (שם-param נשמר לתאימות, ה-getRuntimeInfo shape זהה); wireRecorder מוזרם ל-registry. נקי.
6. **decodeWireLine export** — קיים ב-provider/connection barrel (index.ts:15). אין שבירת build (ר' memory provider-contract-acp-stdio-fe-build — לא רלוונטי כאן, זה BE-only).

## הכשלים ב-test-suite (אומת pre-existing — לא רגרסיה)

| כשל | למה pre-existing |
|------|------------------|
| `https-serve.test.ts` ×2 (unhandled) | מנסה spawn `D:/ProgramsAndApps/Bun/bin/bun.exe` — נתיב Windows שלא קיים על Linux. environment-specific, לא נגוע ב-slice. |
| `bridge-failure-integration.test.ts` F-1 (201≥400) | ה-bug המתועד `spawn ENOENT → 201` (roadmap: "אדום מ-slice 10"). הקובץ **לא נגע** ב-slice (last commit 3412f1b, slice 10). |

ה-brief §5 DoD#12 ניבא בדיוק את שלושת אלה.

## סיווג ל-patterns.md

אין bugs — אין מה לסווג.

## סיכום לסוכן הבא (אליעזר של ה-fix)

אין fix נדרש. ה-slice GO. ממתין לאישור merge ע"י המשתמשת (לא ממזגים — base=ac43a79, branch slice/cutover-migration).
