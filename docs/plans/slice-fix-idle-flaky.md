# Slice fix-idle-flaky — ייצוב flaky test ב-bridge-manager.idle.test.ts — תוכנית

> **תאריך**: 2026-06-02
> **סטטוס**: ✅ הושלם (2026-06-02, branch fix-idle-flaky) — getter getCreatedAt +
>   תיקון test 4+5. 10/10 ריצות pnpm test נקיות. calev: pending.
> **Complexity**: 2/10 (verifier: light)
> **תלויות (`depends_on`)**: [] — עצמאי, base = dev
> **Base**: branch `dev` (tip `266322f`)
> **Dev tip**: `266322f`

---

## §0 — Pre-flight

### תלויות (חובה!)

אין. ה-slice עצמאי, מבוסס ישירות על `dev`.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/fix-idle-flaky -b fix-idle-flaky dev
cd .worktrees/fix-idle-flaky
pnpm install && pnpm hooks:install
```

### איך להריץ

- Tests: `pnpm test` מה-root.
- typecheck: `pnpm typecheck` (אם `TS6305` → `find packages -name '*.tsbuildinfo' -delete`, ואז build core לבד לפני backend).
- lint:i18n: `pnpm lint:i18n`.

> אין צורך ב-BE/OneCLI/tunnel/browser — טסט יחידה בלבד עם `sleep` כ-bridge binary.

### Browser

לא נדרש.

### Reading list

**must-read**:
- `packages/backend/src/acp/bridge-manager.idle.test.ts` — הקובץ לתיקון. שים לב ל-test 4 (116-125) ו-test 5 (128-137).
- `packages/backend/src/acp/bridge-manager.ts` — הקוד שתחתיו. **אסור לגעת ב-`listIdle` (206-218).** רק חשיפת getter חדש.

**reference**:
- `docs/plans/slice-26-bridge-idle-reaper.md` §7 — מקור ה-slice 26, מסביר את ה-TEMPORARY block.

---

## §1 — מטרה

‏ה-test suite מכיל טסט תלוי-timing שנכשל **אקראית** תחת עומס:
`packages/backend/src/acp/bridge-manager.idle.test.ts` — test 4
(`"4: never-attached bridge not returned within grace period"`).
ריצה אחת של `pnpm test` נכשלה, ריצה שנייה עברה — **אותו קוד**. הטסט לבדו עובר
12/12 ב-5 ריצות. **קוד הפרודקשן `listIdle` תקין** (אומת בלוג חי + 5 ריצות).
הבאג הוא **בטסט עצמו**.

מטרת ה-slice: לייצב את test 4 (ו-test 5 שיש בו את אותה חולשה פוטנציאלית) כך
ש-`pnpm test` עובר **10/10 ריצות רצופות**, **בלי לרוקן את הטסט** (עדיין בודק
grace period 2x) **ובלי לגעת ב-`listIdle`**.

---

## §2 — שורש הבעיה (root cause)

‏הטסט (test 4, שורות 117-124):

```ts
await spawnBridge("agent-4")
const createdAt = Date.now()          // ← נקרא אחרי ה-spawn
const timeout = 10_000
const result = bm.listIdle(timeout, createdAt + timeout * 2 - 1)
expect(result).not.toContain("agent-4")
```

‏ה-`createdAt` של הטסט נקרא **אחרי** ש-`spawnBridge` כבר רץ. אבל ה-`e.createdAt`
האמיתי נקבע **בתוך** ה-spawn — ב-`bridge-manager.ts:143`
(`createdAt: Date.now()` בתוך `store.set`, בסוף `spawnInternal`).

תחת עומס ה-spawn לוקח כמה מילישניות, אז:
`createdAt_test` (שורה 119) **>** `e.createdAt` (שורה 143, מוקדם יותר).

הלוגיקה ב-`listIdle` (214) בודקת `now - e.createdAt >= timeoutMs * 2`.
הטסט בונה `now = createdAt_test + timeout*2 - 1`. אבל הוא מודד מול `e.createdAt`
שקטן יותר → ה-delta בפועל = `(createdAt_test - e.createdAt) + timeout*2 - 1`.
אם `createdAt_test - e.createdAt >= 1` (drift של ms אחד מספיק!) → delta ≥ `timeout*2`
→ ה-bridge **כן** מוחזר → `expect(...).not.toContain` נכשל.

test 5 משתמש באותו דפוס (`createdAt = Date.now()` אחרי spawn, שורה 131) אבל בונה
`now = createdAt + timeout*2` (בלי `-1`). שם ה-drift דווקא **מחזק** את התנאי (delta
גדל מעבר ל-`timeout*2`), אז test 5 **לא** נכשל מהבעיה הזו — אבל הוא משתמש בנקודת-אמת
שגויה (`Date.now()` במקום ה-`createdAt` האמיתי), ולכן **מתקנים גם אותו** לעקביות
ולחסינות עתידית.

---

## §3 — הפתרון (גישה #1 — מומלץ)

‏לחשוף getter קריאה-בלבד ב-bridge-manager שמחזיר את ה-`createdAt` האמיתי מה-store,
ולגרום לטסטים 4+5 למדוד מאותה נקודת-אמת בדיוק כמו `listIdle`.

> **למה גישה #1 ולא "ללכוד `Date.now()` לפני spawn + שוליים"**: הגישה השנייה היא
> hack — מניחה שה-spawn מתרחש בין שתי קריאות `Date.now()` עם שוליים שרירותיים.
> getter שמחזיר את ה-`createdAt` *בפועל* מסיר את כל אי-הוודאות: הטסט והקוד מודדים
> מאותו ערך. זה גם getter בטוח (קריאה בלבד, לא נוגע ב-`listIdle`).

### Commit 1 — getter `getCreatedAt` ב-bridge-manager

**קובץ**: `packages/backend/src/acp/bridge-manager.ts`

‏(א) **חתימת ה-return type** (16-23) — הוסף שורה ל-TEMPORARY block:

```ts
export function createBridgeManager(): BridgeManager & {
  spawnWithStderr(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandleWithStderr>
  getChild(bridgeId: string): ChildProcessWithoutNullStreams | null
  // ─── TEMPORARY (slice 26) ───
  markAttached(bridgeId: string): void
  markDetached(bridgeId: string): void
  listIdle(timeoutMs: number, now: number): string[]
  getCreatedAt(bridgeId: string): number | null   // ← חדש
} {
```

‏(ב) **המימוש** — בתוך ה-`return {...}`, ב-TEMPORARY block (ליד `listIdle`, סביב 205-218),
הוסף:

```ts
    getCreatedAt(bridgeId: string): number | null {
      return store.get(bridgeId)?.createdAt ?? null
    },
```

> **אל תיגע ב-`listIdle` עצמו** (206-218). רק מוסיפים getter חדש לידו.
> ה-`createdAt` כבר קיים ב-`Entry` (31) ונקבע ב-143 — רק חושפים אותו.

**testing**: none (getter טריוויאלי, מכוסה דרך התיקון בטסטים).

### Commit 2 — תקן test 4 + test 5 להשתמש ב-getter

**קובץ**: `packages/backend/src/acp/bridge-manager.idle.test.ts`

**test 4** (116-125) — החלף את `const createdAt = Date.now()` (119):

```ts
  it("4: never-attached bridge not returned within grace period", async () => {
    await spawnBridge("agent-4")

    const createdAt = bm.getCreatedAt("agent-4")!   // ← נקודת-האמת האמיתית מה-store
    const timeout = 10_000

    // now - createdAt < timeout * 2
    const result = bm.listIdle(timeout, createdAt + timeout * 2 - 1)
    expect(result).not.toContain("agent-4")
  })
```

**test 5** (128-137) — אותו שינוי לשורה 131:

```ts
  it("5: never-attached bridge returned after grace period expires", async () => {
    await spawnBridge("agent-5")

    const createdAt = bm.getCreatedAt("agent-5")!   // ← נקודת-האמת האמיתית מה-store
    const timeout = 10_000

    // now - createdAt >= timeout * 2
    const result = bm.listIdle(timeout, createdAt + timeout * 2)
    expect(result).toContain("agent-5")
  })
```

> ה-`!` (non-null assertion) מוצדק: ה-bridge בדיוק נוצר ב-`spawnBridge` שורה למעלה,
> אז `getCreatedAt` בהכרח מחזיר ערך. אם מעדיפים בלי `!`: `const createdAt = bm.getCreatedAt("agent-4")` ואז
> `expect(createdAt).not.toBeNull()` — אבל ה-`!` תקין כאן ולא מפר את strict TS.

> **מה לא לשנות**: טסטים 2, 3, 6 משתמשים ב-`Date.now()` עבור `detachedAt`/`now`
> שמתייחס ל-`lastDetachedAt`. גם הוא נקבע בקוד (`markDetached` → `bridge-manager.ts:202`),
> בדיוק כמו `createdAt`. אבל שם **אין drift בפועל**: בין `bm.markDetached(...)`
> לקריאת `bm.listIdle(...)` בטסט **אין `await` יקר** (אין spawn/IO ביניהם) — שתי
> השורות רצות באותו tick, אז `detachedAt_test - e.lastDetachedAt ≈ 0`. הבעיה ב-4/5
> היא ספציפית כי בין `e.createdAt` (נקבע בתוך spawn) לקריאת `Date.now()` בטסט יש
> את ה-`await spawnBridge` היקר — שם נצבר ה-drift. **אל תיגע ב-2/3/6.** רק 4 ו-5.
> (טסט 1 משתמש ב-`hasActiveWs` ולא נכנס לענף ה-grace בכלל.)

---

## §4 — Definition of Done (DoD)

‏1. **10 ריצות רצופות נקיות**:
   ```bash
   for i in $(seq 10); do pnpm test 2>&1 | grep -E "Tests +[0-9]"; done
   ```
   כל 10 השורות מראות **0 failed** (כל הטסטים pass). **אפס כשלים.**
2. test 4 עדיין בודק: bridge never-attached **לא** מוחזר בתוך grace period (`< timeout*2`).
3. test 5 עדיין בודק: bridge never-attached **כן** מוחזר אחרי grace period (`>= timeout*2`).
   (כלומר — לא רוקנו את הטסטים, ההתנהגות הנבדקת זהה.)
4. `getCreatedAt` חושף את `createdAt` של ה-entry, ומחזיר `null` ל-id לא-קיים.
5. **`listIdle` (206-218) לא שונה** — diff על הפונקציה ריק.
6. `pnpm typecheck` נקי.
7. `pnpm lint:i18n` נקי.

---

## §5 — סיכונים

| סיכון | הסתברות | מיטיגציה |
|-------|---------|----------|
| ה-getter מוסיף שטח-פנים ל-API ש"זמני" | נמוכה | הוא בתוך TEMPORARY block (19-22 + ליד listIdle), נמחק עם slice 26. תיעוד בהערה. |
| 10 ריצות לוקחות זמן (suite מלא × 10) | ודאית | זה ה-DoD המבוקש. אם איטי מדי — להריץ ברקע, לא לקצר. |
| flaky אחר שלא קשור צץ ב-10 הריצות | נמוכה | אם טסט אחר נכשל אקראית — **לעצור ולדווח למרדכי**, לא לתקן אותו פה (out of scope). |

---

## §6 — הערות executor

- ה-slice מסומן `TEMPORARY slice 26` — **תיקון מינימלי בלבד**, אל תשקיע over-engineering.
  הקובץ + ה-getter ימחקו כש-background-agent management ינחת.
- **אל תמזג ל-dev** — מרדכי ממזג, באישור המשתמשת.
- אם ב-10 הריצות **test 4 עדיין נכשל פעם אחת** — סימן שהתיקון לא תפס; חזור ל-§3
  וודא שהחלפת את **שתי** הקריאות (`getCreatedAt` במקום `Date.now()`), ולא נשארה
  קריאת `Date.now()` ישנה.
- complexity 2/10 — verifier: light (calev Sonnet).

---

## §7 — Complexity scoring

| ממד | ציון | הערה |
|-----|------|------|
| היקף קבצים | 1 | 2 קבצים, אותה תיקייה |
| לוגיקה חדשה | 1 | getter בן שורה אחת |
| סיכון רגרסיה | 1 | קריאה-בלבד, לא נוגע ב-listIdle |
| אינטגרציה | 1 | אין — טסט יחידה |
| **סה"כ** | **2/10** | verifier: light |
