---
project: "drive-coding"
slice: "slice-active-agents-backend"
verifier: "avigail"
date: "2026-06-13"
verdict: "READY"
round: 3
findings:
  - id: 5
    severity: "regression"
    category: "dropped-branch"
    summary: "ROUND 3 — RESOLVED: afterEach is now async, awaits each child's exit (once(exit)+kill(SIGKILL), short-circuit on exitCode/signalCode!==null) before rmSync, and rmSync gets maxRetries:5/retryDelay:50. EPERM race closed; no residual stdout/stderr-handle race (pipe handles do not lock tmpDir/acp)."
    source_brief: "§0 lines 80-96 (async afterEach)"
    source_code: "packages/backend/src/acp/bridge-manager.idle.test.ts:32-41"
    cost_estimate: "resolved"
  - id: 1
    severity: "blocker"
    category: "wrong-path"
    summary: "ROUND 1 — RESOLVED: Linux-only /usr/bin/sleep spawn replaced by cross-platform §0 helper (process.execPath + temp acp). Verified node acp runs the extensionless file as a long-lived process."
    source_brief: "§0 Cross-platform test helper (lines 55-103)"
    source_code: "packages/backend/src/acp/cli-config.ts:52,68"
    cost_estimate: "resolved"
  - id: 2
    severity: "confusion"
    category: "wrong-path"
    summary: "ROUND 1 — RESOLVED: Worktree/run commands now PowerShell + d:\\UserProjects\\AI\\drive-coding\\.worktrees\\. Verified against actual git worktree list."
    source_brief: "§0 Worktree (lines 33-41)"
    source_code: "n/a (environment)"
    cost_estimate: "resolved"
  - id: 3
    severity: "confusion"
    category: "outdated-risk"
    summary: "ROUND 1 — RESOLVED: DoD#8 now routes lint:i18n through Git-Bash, DoD#8b added for Windows test pass."
    source_brief: "§5 DoD #8 / #8b (lines 405-406)"
    source_code: "n/a"
    cost_estimate: "resolved"
  - id: 4
    severity: "minor"
    category: "wrong-line-number"
    summary: "ROUND 1 — RESOLVED: base hash now e25912c (62ca5bf kept only as verified cross-ref); spawnBridge cited 53-72 (was 52-72)."
    source_brief: "§0 line 11, §4 Commit 1 line 264"
    source_code: "packages/backend/src/acp/bridge-manager.idle.test.ts:53"
    cost_estimate: "resolved"
---

# Plan Verification — slice-active-agents-backend

> **Brief**: docs/plans/slice-active-agents-backend.md
> **Base tip**: e25912c
> **Verdict**: ✅ READY (round 3)

ה-brief מדויק טכנית באופן יוצא-דופן: **כל** ה-anchors, ה-symbols, מספרי השורות, וספירת ה-call-sites
אומתו מול הקוד החי ונמצאו נכונים. הבעיה היחידה המהותית היא **סביבתית** — ה-brief נכתב לסביבת Linux,
והפרויקט עכשיו רץ על Windows. זה משפיע בעיקר על הטסטים החדשים (Commit 1 + Commit 3) שאמורים
לחקות דפוס spawn שתלוי ב-`/usr/bin/sleep`.

## בעיות שנמצאו

### 🔴 Blocker / Regression risk

| # | בעיה | מקור (brief / קוד) | עלות אם לא תוקן |
|---|------|--------------------|-----------------|
| 1 | ה-brief מורה לחקות את דפוס `spawnBridge` הקיים (`OPENCODE_BIN=/usr/bin/sleep`) לטסטים החדשים: `getRuntimeInfo` (Commit 1) ו-`reaper-pin.test.ts` (Commit 3). הדפוס מבצע `spawn("/usr/bin/sleep", ...)` מתהליך Node/Bun. על Windows הנתיב `/usr/bin/sleep` אינו executable תקין ל-`child_process.spawn` (נפתר כ-drive-relative `C:\usr\bin\sleep`, לא קיים) — Git-Bash לא מעורב ב-spawn. הטסטים החדשים יתקעו ב-ENOENT/אין-pid. הערה: גם הטסט הקיים `bridge-manager.idle.test.ts` תלוי בזה, ולא הצלחתי להריץ אותו לאימות (deps לא מותקנים ב-checkout — אין `node_modules/.bin/vitest`). | brief §4 Commit 1 line 204 + Commit 3 lines 311-313 / `packages/backend/src/acp/bridge-manager.idle.test.ts:19,53-72` | אליעזר יתקע 30-60 דק' debug על ssspawn שנכשל; ה-mitigation: שימוש ב-bin חוצה-פלטפורמות (למשל `process.execPath` עם סקריפט המתנה, או fake-handle/store injection במקום spawn אמיתי). מרדכי תחליט. |

### 🟡 Confusion / Type error / Outdated

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 2 | פקודות ה-Worktree וה-run משתמשות בנתיבי Linux (`/home/user/projects/drive-coding`, `git worktree add ...`). הפרויקט על Windows ב-`d:\UserProjects\AI\drive-coding` (worktrees ב-`.worktrees\`). גם §0 line 23 מצטט base כ-`62ca5bf` עם נתיב Linux. | brief §0 lines 23, 29-34 | מרדכי תעדכן לנתיבי Windows / PowerShell. |
| 3 | DoD#8 קורא `pnpm lint:i18n` → `./scripts/lint-no-hebrew-in-code.sh` (סקריפט bash). על Windows צריך הרצה דרך Git-Bash, לא PowerShell ישיר. | brief §5 DoD #8 line 343 | סמני ש-lint:i18n דורש bash; או הריצי דרך `bash scripts/...`. |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 4 | §0 line 23 מצטט base `62ca5bf` בעוד ה-header (line 11) עודכן ל-`e25912c` — אי-עקביות פנימית. בנוסף Commit 1 (line 204) מצטט את `spawnBridge` כשורות 52-72; בפועל 53-72 (off-by-one). | brief §0 line 23, §4 Commit 1 line 204 |

## Spot-check שעבר (לא מצא בעיה)

- ✅ `agent.ts`: `crashReason`@74, `acpSessionId`@91, `toAgentPublic` copy-blocks 121-126 — אומת. השדות אופציונליים ומועתקים בתנאי, בדיוק כפי שה-brief מתאר. הדפוס שה-brief מציע ל-`persistent` זהה ו-type-safe.
- ✅ `agent.ts`: `Agent` 63-75, `AgentPublic` 79-92 — אומת. אין שדה `persistent` קיים (אין collision).
- ✅ `bridge-manager.ts`: return-type interface 16-24, `Entry` 25-33, `get` 172-174, `getChild` 176-178, `handle.pid` (146), `hasActiveWs` (155/209/215), `markAttached`/`markDetached` 207-218, `listIdle` 220-232, spawn-no-pid throw 135-138 — כולם אומתו.
- ✅ `http-agents.ts`: `GET /api/agents` 27-30, `session-attached` 99-134, `registerAgentsHttp` deps 18-25 (registry/orchestrator/projectsRegistry?) — אומת. הדפוס של `session-attached` תקף לחיקוי.
- ✅ `registry.ts`: `create` 14-33, `createdAt`@29, `update(id, patch)` קיים (43-49) — אומת. הוספת `persistent: false` אחרי `createdAt` בשורה 29 תקפה.
- ✅ `server.ts`: reaper TEMPORARY block 138-155, `setInterval` 145, body 145-154, `reaper.unref()` 155 — אומת.
- ✅ `agent-orchestrator.ts`: `deleteAndKill` בממשק (61) ובמימוש (199) — אומת.
- ✅ **call-sites של `registerAgentsHttp`**: בדיוק 3 כפי שה-brief טוען — `server.ts:69`, `http-agents.test.ts:34`, `http-agents.test.ts:150`. אומת ב-grep. ההיגיון של `bridgeManager?` אופציונלי + guard `?.` נכון: הופך-חובה היה שובר את 2 ה-call-sites בטסט.
- ✅ **agent-schema.test.ts**: שורה 88 `expect(pub).toEqual(agent)` — אומת. שורות 94 ו-106 בונות `Agent({...})` **בלי** `persistent` — אומת. המסקנה ש-`persistent` חייב להיות אופציונלי נכונה.
- ✅ **type flags**: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` פעילים; `exactOptionalPropertyTypes` **כבוי**. לכן `pub.persistent = agent.persistent` בתוך guard `!== undefined` בטוח-טיפוסים (זהה ל-crashReason הקיים שמתקמפל). ה-pseudo-code לא מוסיף imports חדשים בקבצי ה-schema → אין סיכון verbatimModuleSyntax. אין array-index גולמי → אין סיכון noUncheckedIndexedAccess.
- ✅ **depends_on**: `[]` עקבי — slice ראשון בתור, base=dev, אין הנחת קוד מ-slice אחר.
- ✅ **dropped branches**: pseudo-code של GET enrichment שומר על `toAgentPublic(a)` ומוסיף `...(rt ?? {})` — לא מחסיר branch. endpoint ה-`persistent` מטפל ב-invalid-json (400), non-boolean (400), not-found (404) — תואם דפוס `session-attached`.

---

# Round 2 — אימות חוזר אחרי תיקוני מרדכי (2026-06-13)

> **Dev tip**: e25912c (ללא שינוי)
> **Verdict round 2**: 🟡 USABLE-AFTER-FIX (ממצא חדש אחד: #5)

מרדכי תיקנה את כל 4 הממצאים מ-round 1. אימתתי כל אחד מול הקוד החי, ובנוסף **אימתתי
אמפירית** את ליבת הפתרון ה-cross-platform (הרצתי בפועל `spawn(process.execPath, ["acp"], {cwd})`).
התוצאה: הליבה עובדת, אבל **ה-teardown של ה-helper מכניס regression חדש על Windows** (ממצא #5).

## אימות 4 הממצאים מ-round 1

| # round1 | סטטוס | אימות |
|---|------|------|
| 1 🔴 `/usr/bin/sleep` | ✅ **טופל** | §0 helper: `OPENCODE_BIN=process.execPath` + קובץ `acp` ב-tmpDir, args קבועים `["acp"]`. אימתתי מול `cli-config.ts`: `getCliCommand("opencode")` → `args: ["acp"]` (CLI_SPECS@agent.ts:31), ו-`OPENCODE_BIN` דורס bin בלבד (cli-config.ts:68). **הרצתי בפועל**: `node acp` עם קובץ extensionless שמכיל `setInterval` → pid תקין, exitCode=null (חי), stderr ריק. הטענה הטכנית של מרדכי נכונה. |
| 2 🟡 נתיבי worktree | ✅ **טופל** | §0 lines 33-41 — PowerShell + `d:\UserProjects\AI\drive-coding\.worktrees\`. אימתתי מול `git worktree list`: השורש הוא בדיוק `D:/UserProjects/AI/drive-coding`, worktrees ב-`.worktrees\` (P1a/P1b כבר שם). הפקודה תקפה. |
| 3 🟡 lint:i18n bash | ✅ **טופל** | DoD#8 (line 405) דרך Git-Bash + fallback `bash ./scripts/...`; DoD#8b (line 406) חדש. עקבי. |
| 4 🟢 base hash + שורות | ✅ **טופל** | header (line 11) = `e25912c`; `62ca5bf` נשאר רק כ-cross-ref מפורש ("anchors זהים ל-62ca5bf"), לא כ-base — עקבי. spawnBridge עכשיו `:53-72` (line 264) — אימתתי מול הקובץ (spawnBridge מתחיל 53). off-by-one תוקן. |

## אימות ליבת הפתרון ה-cross-platform (שאלה 1 מהמשימה)

**האם `node <file>` ללא סיומת רץ כ-CommonJS?** — כן. אימות אמפירי:
- `spawn(process.execPath, ["acp"], {cwd: tmpDir})` עם `tmpDir/acp` המכיל `setInterval(()=>{},1e9)`
  → התהליך קיבל pid, נשאר חי (exitCode=null), **stderr ריק**. אין כשל ESM/`type:module`.
- הסיבה: ל-tmpDir שנוצר ב-`mkdtempSync(tmpdir())` **אין `package.json`**, ולכן אין `type:module`.
  Node מטפל בקובץ ללא סיומת וללא package.json כ-CommonJS. הקוד שבתוך (`setInterval`) הוא
  syntax ניטרלי CJS/ESM ממילא. אין סיכון אמיתי.
- **escalation (CLI_SPECS_FILE + vi.resetModules) מספיק?** — כן, ומדויק טכנית, אם כי ככל הנראה
  לא יידרש. אימתתי: `resolveCliSpecsPath` קורא env `CLI_SPECS_FILE` (cli-config-file.ts:29);
  `override.args` דורס spec.args (cli-config.ts:52); ה-memoization `_cached` (cli-config-file.ts:138,149)
  אכן דורש `vi.resetModules()` כדי לטעון קובץ override חדש בטסט. כל החוליות בשרשרת הזו אמיתיות.
  (הערה: המשימה ציינה `cli-config-file.ts:138-193`; הבריף עצמו מצטט `138-149` — שהוא הנכון/המדויק
  ל-block ה-memoization. אין בעיה בבריף.)

## ממצא חדש — נוצר ע"י תיקון round 1

### 🔴 #5 — `rmSync(tmpDir)` ב-afterEach יכשל ב-EPERM על Windows (regression חדש)

ה-helper החדש (§0 lines 80-83) מוסיף ל-afterEach:
```ts
afterEach(() => {
  // ... kill children (כמו היום) ...
  rmSync(tmpDir, { recursive: true, force: true })
})
```
ה-afterEach הקיים (idle.test.ts:32-41) הורג fire-and-forget (`p.kill("SIGKILL")`) ו-**לא ממתין
ליציאת התהליך**. על Windows, `kill` אסינכרוני ברמת ה-OS; כל עוד הילד חי הוא מחזיק את
`tmpDir/acp` פתוח (הקובץ נטען כ-script). מחיקת ספרייה שמכילה קובץ-בשימוש / שהיא cwd של תהליך
חי → **`EPERM`**, וה-afterEach זורק → כל ה-suite נכשל.

**אימות אמפירי**: הרצתי בדיוק את הרצף (spawn → `kill("SIGKILL")` → `rmSync` מיד אחריו):
התוצאה `rm-immediate FAILED: EPERM`. רק `rmSync` שמופעל **אחרי** אירוע `exit` של הילד (+~50ms)
הצליח (`rm-after-exit: OK`). הקומנט בבריף `// ... kill children (כמו היום) ...` מאשר שהוא מעתיק
את ההריגה ה-fire-and-forget הקיימת — ולכן ה-`rmSync` הסינכרוני שאחריו ייכשל באופן עקבי על Windows.

| # | בעיה | מקור | עלות אם לא תוקן |
|---|------|------|------|
| 5 | afterEach מבצע `rmSync(tmpDir)` מיד אחרי `kill("SIGKILL")` fire-and-forget; הילד עוד מחזיק את `tmpDir/acp` → EPERM, ה-suite נכשל. (אומת אמפירית) | brief §0 lines 80-83, §4 Commit 1 lines 374-377 / `packages/backend/src/acp/bridge-manager.idle.test.ts:32-41` | אליעזר יתקע 20-40 דק' על EPERM לא-צפוי ב-teardown |

> **לא מציעה fix מפורט** (תפקיד מרדכי), אבל הכיוון: ה-teardown חייב להמתין ל-`exit` של כל ילד
> לפני `rmSync` (למשל `await once(child,'exit')` per child), ו/או `rmSync` עם `maxRetries`/retry,
> ו/או למקם `tmpDir` מחוץ ל-cwd של הילד. מרדכי תחליט.

## בדיקות נוספות (anchors שלא נבדקו ב-round 1) — passed

- ✅ `registry.update(id, patch)` (registry.ts:43-49) — קיים, generic patch; `update(id,{persistent})` תקף.
- ✅ `server.ts:69` call-site = `registerAgentsHttp(app, { registry, orchestrator, projectsRegistry })` — אומת; `bridgeManager` אכן ב-module scope (server.ts:61) → הוספתו ל-deps אפשרית.
- ✅ `CLI_SPECS.opencode = { bin:"opencode", args:["acp"] }` (core/schemas/agent.ts:31) — אומת; הליבה של ה-helper נשענת על כך ש-args קבועים `["acp"]`.
- ✅ `getChild` (bridge-manager.ts:176-178) ו-`getCreatedAt` (interface:23) — קיימים, נדרשים ע"י ה-helper וע"י הטסטים הקיימים שה-helper לא ישבור.
- ✅ אין סתירות פנימיות חדשות מהתיקונים: §8 complexity 6/10 עקבי עם harness ה-cross-platform; verifier-phase על commit 1+3 עקבי עם §4; כל ה-grep ל-Linux paths הם רפרנסים תיאוריים ("מחליף את /usr/bin/sleep"), לא הוראות פעילות.

## Verdict round 2

🟡 **USABLE-AFTER-FIX** — מרדכי פתרה את כל 4 הממצאים מ-round 1, וליבת הפתרון ה-cross-platform
נכונה טכנית (אומת אמפירית — אין סיכון ESM). אך תיקון round 1 הכניס **regression חדש אחד**:
`rmSync` ב-afterEach ייכשל ב-EPERM על Windows כי ההריגה fire-and-forget לא ממתינה ליציאת הילד
(ממצא #5, אומת אמפירית). ~15-20 דק' של מרדכי לתקן את ה-teardown (await exit לפני rmSync / retry)
ואז READY. שאר הבריף מדויק לחלוטין.

---

# Round 3 — אימות סופי של תיקון ממצא #5 (2026-06-13)

> **Dev tip**: e25912c (ללא שינוי)
> **Verdict round 3**: ✅ READY (הממצא היחיד שנותר — #5 — נפתר; כל השאר resolved)

מרדכי תיקנה את ה-helper skeleton ב-§0 (lines 80-96). אימתתי את שלוש השאלות מהמשימה.

## שאלה 1 — האם התיקון פותר את ה-EPERM נכון? (כולל race שיורי של stdout/stderr)

ה-afterEach החדש (§0 lines 83-96):
```ts
afterEach(async () => {
  await Promise.all(
    spawnedChildren.map((p) => new Promise<void>((res) => {
      if (p.exitCode !== null || p.signalCode !== null) return res()
      p.once("exit", () => res())
      p.kill("SIGKILL")
    })),
  )
  spawnedChildren = []
  rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})
```

**✅ פותר את ה-EPERM נכון.** הניתוח:

1. **ההמתנה ל-`exit` היא העיקר.** ה-EPERM ב-Windows נובע מכך שה-OS נועל את ה-image
   של ה-executable ואת ה-cwd של תהליך *חי*. ה-event `exit` נורה כשתהליך-הילד **מסתיים**,
   ובאותו רגע ה-OS משחרר את נעילת ה-`tmpDir/acp` (ה-script) ואת ה-cwd. הריצה הסדורה
   (kill → await exit → rmSync) מסירה בדיוק את ה-race שאומת אמפירית ב-round 2.

2. **שאלת ה-stdout/stderr handle — לא race שיורי.** ה-child נוצר עם
   `stdio: ["pipe","pipe","pipe"]` (`bridge-manager.ts:88-92`), כך שה-parent מחזיק
   pipe-handles ל-stdout/stderr של הילד. **‏אבל handles אלה אינם נועלים את `tmpDir/acp`** —
   הם pipes ל-stdout/stderr של התהליך, לא file-handle על קובץ ה-script או על ה-cwd.
   הנעילה הרלוונטית היחידה ל-rmSync היא על ה-image/cwd, והיא משוחררת ב-`exit`.
   הבחנה עדינה: Node מבדיל בין `exit` (התהליך הסתיים) ל-`close` (כל ה-stdio streams נסגרו);
   ה-fix ממתין ל-`exit` (מוקדם יותר), אך הנעילה על ה-image/cwd תלויה בסיום-התהליך ולא
   בסגירת ה-streams — לכן `exit` מספיק. ‏**‏ה-`maxRetries:5/retryDelay:50` ‏מכסה כרשת-ביטחון**
   ‏את חלון ה-~ms ה-residual שבו ה-OS לעיתים מאחר בשחרור ה-handle אחרי `exit` (תופעה
   ידועה ב-Windows). השילוב await-exit + retry הוא הדפוס הסטנדרטי והנכון.

3. **short-circuit נכון**: `if (p.exitCode !== null || p.signalCode !== null) return res()` —
   אם הילד כבר מת (exitCode מספרי או signalCode מחרוזת) ה-`once("exit")` לא יירה שוב,
   ולכן ה-short-circuit הכרחי כדי לא להיתקע ב-Promise תלוי-לנצח. שני התנאים (exitCode/signalCode)
   מכסים גם exit רגיל וגם הריגה ב-signal. נכון טכנית. `exitCode`+`signalCode` קיימים על
   `ChildProcessWithoutNullStreams` (טיפוס ה-array — אומת מול `getChild`@bridge-manager.ts:18).

## שאלה 2 — אין סתירה פנימית חדשה?

- ✅ **afterEach async עקבי**: vitest תומך ב-async afterEach; ה-`await Promise.all` נחסם נכון
  לפני ה-rmSync. ה-beforeEach נשאר סינכרוני (רק mkdtemp+writeFile) — אין צורך ב-async שם,
  ואין סתירה (vitest ממתין ל-async afterEach בנפרד).
- ✅ **`spawnedChildren` reassign**: מוצהר `let` (idle.test.ts:22) → ה-`spawnedChildren = []`
  ב-afterEach תקין (לא const).
- 🟢 **הערה (לא חוסם)**: `spawnedChildren = []` מאופס **בשני** מקומות — גם ב-beforeEach
  (idle.test.ts:29, קוד קיים) וגם ב-afterEach (ה-skeleton החדש). זו רדודנטיות בלתי-מזיקה
  (belt-and-suspenders), לא bug: ה-afterEach מאפס אחרי הניקוי, וה-beforeEach מאפס לפני הריצה
  הבאה. המשימה ביקשה "מקום אחד בלבד" — בפועל יש שניים, אבל אין race ואין דליפה. מרדכי יכולה
  להשאיר כמו שזה או למחוק את האיפוס מ-beforeEach; שניהם תקינים. **‏לא מוריד מ-READY.**
- ✅ **rmSync options**: `{ recursive, force, maxRetries, retryDelay }` — כל השדות קיימים
  ב-`fs.rmSync` (Node 14.14+). אין type-error.

## שאלה 3 — verdict

✅ **READY**. ממצא #5 (הממצא היחיד שנותר אחרי round 2) נפתר נכון טכנית — await-exit סוגר את
ה-race העיקרי, ו-maxRetries מכסה את החלון ה-residual; אין race שיורי של stdout/stderr (ה-pipes
לא נועלים את ה-script). אין סתירה פנימית חדשה (הרדודנטיות של איפוס spawnedChildren היא 🟢 בלבד).
כל הממצאים מ-round 1 (#1-#4) כבר resolved. הבריף מוכן ל-dispatch לאליעזר.
