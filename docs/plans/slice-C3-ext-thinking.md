# Slice C3-ext-thinking — runtime-control דרך ext channel (בלי patch) + חבילת בדיקות-חי קבועה — בריף

> **תאריך**: 2026-06-28 · **סטטוס**: הושלם · **branch**: slice/C3-ext-thinking
> **Complexity**: 7/10 (verifier: light — אימות חי מול CLI) · **depends_on**: [C3-rename] · **Base**: `slice/C3-rename` (HEAD)
> **מנגנון**: inbound `extMethod` handler **שלנו** (לא patch) → `getQuery(sessionId)` → `query.setMaxThinkingTokens(n)`

---

## §0 — context

**הבריף עצמאי — אינו תלוי במסמכי-רציונל.** (הרציונל המלא ב-`decisions/drive-coding.md` +
`extension-layer.md §1.5` — אך אלה על **dev**, לא על ה-base `slice/C3-rename`; אל תחפש אותם ב-worktree.)

הממצא: runtime-controls של claude **לא דורשים patch**. שלוש עובדות אומתו **ישירות מול הקוד** (לא תלוי במסמך):
(1) ה-`ext` channel ברמת הפרוטוקול מקבל **כל** method חופשי תוך-כדי-סשן;
(2) ב-in-process host **אנחנו** מממשים את ה-`extMethod` הנכנס (host.test.ts:58 כבר מוכיח ש-`callExt`→`onRequest` עובד);
(3) `ClaudeAcpAgent.sessions` שדה **ציבורי** ב-runtime (`acp-agent.js:297`), כל רשומת-סשן מחזיקה `query` חי
שחושף `setMaxThinkingTokens` (sdk.d.ts:2260, גרסה 0.3.191 — אותה שרצה).

C3-rename הוכיח את הדפוס ה**פשוט** (פונקציית SDK standalone, store-level — **לא נוגע ב-query**). slice זה מוכיח
את דפוס ה-**runtime-control** (ext → query חי) — הראשון מסוגו, שכל thinking/mcp העתידיים תלויים בו.
**חיוב מאושר** (מנוי; deferred). additive — נוגע רק ב-`packages/provider/**` + docs.

## §1 — מטרה

`_drive/setThinkingTokens` — קריאת ext **אמיתית** מלקוח-ACP → ה-host מנתב ל-`query.setMaxThinkingTokens(n)`
של הסשן החי, **בלי patch**. ובמקביל: מקים **חבילת בדיקות-חי קבועה** (real client → real adapter → real CLI)
שמאמתת בוודאות — דרך פלט **דטרמיניסטי ומובנה** מ-claude — שהשרשרת עובדת מקצה-לקצה, בלי FE.

## §2 — Scope

| כן | לא |
|---|---|
| `getQuery(sessionId)` — accessor **יחיד ומטופס** ל-`(claudeAgent as ...).sessions[id].query` | patch/fork ל-node_modules |
| inbound ext handler **פנימי** ל-`_drive/setThinkingTokens` — `onRequest(...)` **ייעודי** על agentApp שסוגר על `claudeAgent` (לא דרך `options.extHandlers`) | mcp / set_mode / שאר ה-controls (slices תאומים, אחרי) |
| `NormalizedCapabilities.thinkingTokens: boolean` + `thinkingTokens=true` ב-claude caps | FE/UI · נגיעה בקוד חי (bridge-manager) |
| **חבילת בדיקות-חי קבועה** ב-vitest (`*.live.test.ts`), gated מאחורי `RUN_LIVE` | הרצה ב-`pnpm test` הרגיל (live=opt-in) |
| מיגרציה: `rename-smoke.ts` + `session-smoke.ts` → cases בחבילה הקבועה | בדיקות שמאשרות רק "לא נזרקה שגיאה" |
| `test:live` script ב-`packages/provider/package.json` | — |

## §3 — מימוש

### א. ה-accessor המבודד (נקודת-הצימוד היחידה)
`host/in-process/claude/query-access.ts`:
```ts
import type { ClaudeAcpAgent } from "@agentclientprotocol/claude-agent-acp"
/** ⚠️ צימוד-רך ל-internal לא-מתועד: ClaudeAcpAgent.sessions ציבורי ב-runtime (acp-agent.js),
 *  כל רשומה מחזיקה query חי. נקודת-שבירה יחידה אם claude-agent-acp ישנה את sessions.
 *  מכוסה ע"י live test. גרסה נעולה ממילא. */
interface SessionRecord { query: { setMaxThinkingTokens(n: number | null, display?: "summarized" | "omitted" | null): Promise<void> } }
export function getQuery(agent: ClaudeAcpAgent, sessionId: string): SessionRecord["query"] {
  const sessions = (agent as unknown as { sessions: Record<string, SessionRecord> }).sessions
  const rec = sessions?.[sessionId]
  if (!rec?.query) throw new Error(`getQuery: no live query for session ${sessionId}`)
  return rec.query
}
```
> two-SDK containment: ה-interface המקומי מטפס רק את המתודה שאנו קוראים — **אין** ייבוא טיפוס query מה-SDK.

### ב. ה-handler הפנימי (סוגר על claudeAgent)
⚠️ **לא דרך `options.extHandlers`** — ה-loop הקיים (`host.ts` ~שורה 191) רושם handlers עם חתימה
`(params) => ...` שמקבלת params **בלבד** ולא יכולה לסגור על `claudeAgent`. במקום זה הוסף **`onRequest`
ייעודי משלך** על ה-agentApp (כמו ב-loop, אבל closure ידני שסוגר על `claudeAgent` שכבר חי ב-closure של
`createClaudeInProcessHost`):
- `onRequest("_drive/setThinkingTokens", ...)` → `{ sessionId, n }` → `getQuery(claudeAgent!, sessionId).setMaxThinkingTokens(n)` → `{ ok: true }`.
- ⚠️ ודא ש-`claudeAgent` כבר מאותחל (נקבע ב-`onConnect`) לפני שה-handler רץ — הוא רץ רק אחרי `newSession`,
  אז claudeAgent מובטח. אם `undefined` → זרוק שגיאה ברורה.
- אם יש כבר רישום ext גנרי על agentApp — הוסף את ה-route הספציפי **לצדו**, אל תשבור אותו.

### ג. capability
- `host/types.ts` (לא in-process/types.ts) — הוסף `thinkingTokens: boolean` ל-`NormalizedCapabilities`.
- `claude/capabilities.ts` — `thinkingTokens: true` (claude תומך — ה-query חושף את המתודה).

### ד. חבילת הבדיקות-החי הקבועה
`host/in-process/live/host.live.test.ts` (vitest, **gated**):
```ts
const RUN = process.env.RUN_LIVE === "1"
describe.skipIf(!RUN)("in-process host — live (real client → real claude CLI)", () => { /* cases */ })
```
⚠️ **`skipIf` מדלג ברמת-suite, אבל הקובץ עדיין נאסף ע"י `pnpm test` הרגיל** (ל-`vitest.config.ts` אין
`include` override → ה-glob `**/*.test.ts` תופס אותו). לכן: **top-level imports חייבים להיות lazy/לא-side-effecting**
(לא לאתחל host / לא לגעת ב-claude ברמת-המודול) — אחרת `pnpm test` יקרוס למרות ה-skip. כל ה-setup בתוך
ה-`describe`/`beforeAll`. אל תוסיף `exclude` ל-config (ישבור את `--dir` של `test:live`).
- **case `capabilities`**: `start({cwd})` → `expect(caps.thinkingTokens).toBe(true)` + `caps.rename === true`.
- **case `deterministic round-trip` (סף-התקפות, נקודת המשתמש)**: `newSession` → `prompt({ text:
  'Reply with EXACTLY this token and nothing else: DRIVE_OK_4242' })` → אסוף `agent_message_chunk`s →
  `expect(joined).toContain("DRIVE_OK_4242")`. **זה** מוכיח שה-CLI האמיתי באמת ענה במבנה הנדרש.
- **case `setThinkingTokens` (ext channel)**: `host.callExt("_drive/setThinkingTokens", { sessionId, n: 8000 })`
  → `expect(res).toEqual({ ok: true })` → ואז prompt דטרמיניסטי נוסף שמצליח (מוכיח שה-query לא נשבר אחרי ה-ext).
  best-effort: אם נצפים `agent_thought_chunk`s כשהתקציב גבוה — assert קל; אם לא ניתן דטרמיניסטית → תעד (escalation §7).
- **case `rename`**: מהגר את לוגיקת `rename-smoke.ts` — `rename(id,"DC-TEST")` → אמת ב-listSessions/session_info.
- מחק את `rename-smoke.ts` ו-`session-smoke.ts` אחרי שה-cases שלהם חיים בחבילה (אל תשאיר כפילות).
- `package.json`: `"test:live": "RUN_LIVE=1 vitest run --dir src/host/in-process/live"` (או דומה לפי vitest.config).
- timeout נדיב פר-case (claude אמיתי איטי — למשל 60s).

## §4 — Commits

0. `query-access.ts` (getQuery) + `NormalizedCapabilities.thinkingTokens` + `capabilities.ts` thinkingTokens=true. typecheck. **TDD**: unit test ל-getQuery מול stub-agent (`{sessions:{s1:{query:{setMaxThinkingTokens}}}}`).
1. host: handler פנימי `_drive/setThinkingTokens` (סוגר על claudeAgent → getQuery). unit: callExt דרך הצינור → getQuery נקרא עם n נכון (stub).
2. חבילת `host.live.test.ts` — 4 cases (capabilities/round-trip/setThinkingTokens/rename) + `test:live` script. מיגרציה+מחיקה של ה-smokes. **integration (live)**: `RUN_LIVE=1 pnpm test:live` ירוק. findings + walkthrough.

## §5 — DoD

| # | בדיקה |
|---|------|
| 1 | typecheck + unit ירוקים (`pnpm test` הרגיל — בלי live) |
| 2 | **`RUN_LIVE=1 pnpm test:live` ירוק** — real client → real claude (calev מריץ) |
| 3 | round-trip case מאשר `DRIVE_OK_4242` בתשובת ה-CLI (פלט מובנה דטרמיניסטי) |
| 4 | setThinkingTokens ext מחזיר `{ok:true}` + prompt עוקב מצליח (query לא נשבר) |
| 5 | `capabilities.thinkingTokens === true` ב-start() |
| 6 | `getQuery` היא הנקודה **היחידה** שניגשת ל-`.sessions` (grep: אין `.sessions[` מחוץ ל-query-access.ts) |
| 7 | additive — `git diff slice/C3-rename..HEAD` ⇒ רק `packages/provider/**` + `docs/**` |
| 8 | אין דליפת טיפוסי SDK בחתימות הציבוריות (grep) · `rename-smoke.ts`/`session-smoke.ts` נמחקו |

## §6 — Risks

| סיכון | מיטיגציה |
|---|---|
| `sessions` ישתנה בעדכון claude-agent-acp | accessor יחיד (getQuery) + live test תופס מיד + גרסה נעולה |
| setMaxThinkingTokens "הצליח" אבל לא ניתן לאמת אפקט דטרמיניסטית | round-trip + prompt-עוקב מוכיחים שהשרשרת חיה ולא-שבורה; אפקט-thinking = best-effort, תעד אם לא נצפה |
| live test תלוי-רשת/מנוי → flaky ב-CI | gated מאחורי `RUN_LIVE` — **לא** ב-`pnpm test` הרגיל; opt-in מכוון |
| claudeAgent עדיין undefined כשה-handler רץ | הוא רץ רק אחרי newSession (onConnect קודם); זרוק שגיאה ברורה אם undefined |
| ה-handler החיצוני (ExtHandlers) לא מגיע ל-claudeAgent | הוסף handler **פנימי** שסוגר על closure — אל תנתב דרך options.extHandlers |

> 3 שתמיד נשכחים: lint:i18n לא סורק provider · ESM `.js` בייבוא · additive בלבד.

## §7 — Escalation

- אם אי-אפשר לאמת דטרמיניסטית שה-thinking-budget נכנס לתוקף (רק "לא נזרק") → מרדכי. ה-round-trip עדיין
  מוכיח את הצינור; ייתכן שנסתפק בכך ל-v1 ונתעד.
- אם `callExt` לא מנתב ל-handler הפנימי (הצינור הקיים לא תומך inbound ext request) → מרדכי (אולי צריך
  `.onExt`/handler-registration נוסף על agentApp).

## §8 — Complexity: 7/10 → calev light (האמת מ-runtime: live test מול CLI אמיתי = DoD 2-4).

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | `callExt` באמת מגיע ל-handler inbound על agentApp? | אם לא — host method `setThinkingTokens(id,n)` שקורא getQuery ישיר; live test קורא אותו | ❌ (fallback קיים) |
| 2 | cwd ל-live test | tmp dir ייעודי (`mkdtemp`) או repo root | ❌ |
| 3 | thinkingDisplay param | omit (default) — רק n | ❌ |
| 4 | n לבדיקה | 8000 (תקציב סביר) | ❌ |
