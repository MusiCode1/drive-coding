# Brief: slice-context-window-meter — מד טוקנים ביחס לחלון-הקשר

> סטטוס: **plan-verified** (אביגיל r2: 3 תיקונים מהותיים אומתו פתורים; 2 קוסמטיים
> תוקנו ידנית — 0 ממצאים פתוחים · 2026-06-27).
> base: `dev` (b816803). depends_on: **[]**. additive בלבד.
> complexity: **5/10** → calev (mode: light).
> ⚠️ פיצ'ר עם **סיכון-נתונים ריצתי**: לא אומת סטטית שה-CLI פולט `usage_update`.
> לכן **Commit 0 הוא spike fail-fast** — לפני בניית UI מאשרים שהנתון מגיע על החוט.

---

## 0. הקשר וסביבה

**מטרה:** להציג למשתמשת כמה מחלון-ההקשר של המודל נמצא בשימוש — מד `used / size`
(טוקנים-בשימוש מתוך גודל-החלון), ואופציונלית עלות מצטברת (`cost`).

**מאיפה הנתון (מאומת בקוד):**
ACP מגדיר התראת `session/update` מסוג `usage_update`. הסכמה
(`@agentclientprotocol/sdk@0.21.1`, `dist/schema/types.gen.d.ts`):
```ts
export type UsageUpdate = {
  _meta?: { [key: string]: unknown } | null;
  cost?: Cost | null;   // ⚠️ Cost = { amount: number; currency: string } — אובייקט, לא מספר!
  size: number;         // גודל חלון-ההקשר הכולל בטוקנים
  used: number;         // טוקנים כרגע בהקשר
};
// SessionUpdate variant: (UsageUpdate & { sessionUpdate: "usage_update" })
```
ה-bridge ב-BE הוא **passthrough גנרי** — כל שורת-stdout גולמית עוברת verbatim
ל-subscribers דרך `cb(line)` (`packages/backend/src/acp/bridge-manager.ts:165`)
→ `ws-agent.ts:88` `feWs.send`, **ללא allowlist**. לכן אם ה-CLI פולט `usage_update`
— ההתראה מגיעה ל-FE כמו שהיא.

**הפער (מאומת):** ב-FE, המתודה **`#onSessionUpdate`** ב-`agent-session.svelte.ts`
(dev, `packages/frontend/src/lib/view-models/agent-session.svelte.ts:1160`) בנויה כך:
(א) **early-return** ל-`tool_call`/`tool_call_update` (L1181-1188);
(ב) **`const text = ...; if (!text) return` (L1190-1191)** — guard שבולע כל update
ללא `content.text`; (ג) רק *אז* שרשרת `else if` ל-chunks (L1195+). **אין ענף
`usage_update`**, וגם אם היה מוסיפים אותו בשרשרת ה-else-if — הוא מעולם לא יורה,
כי `usage_update` **לא נושא `content.text`** ולכן נחתך ב-guard של L1191. הנתון נזרק
בשקט. ה-update מגיע כ-cast רופף `{ sessionUpdate?: string; ... }` (~L1163).

**שם package FE:** `@drive-coding/frontend-v2`.

**worktree:**
```bash
git worktree add .worktrees/slice-context-window-meter -b slice-context-window-meter dev
cd .worktrees/slice-context-window-meter && pnpm install && pnpm hooks:install
```

**איך מריצים:**
```bash
cd packages/backend
PORT=4013 onecli run --agent voice-acp -- bun --watch src/server.ts   # OneCLI חובה (turn אמיתי = חיוב tokens)
BE_PORT=4013 pnpm --filter @drive-coding/frontend-v2 dev
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 test
pnpm lint:i18n
```
**Browser:** linux-gui Chrome :9222 profile voice-acp.
`playwright-cli -s=vacp attach --cdp=http://localhost:9222`.
**Mock ל-UI ללא BE:** `/chat?mock=greeting` (reload מלא).

**מקורות-אמת:** `packages/frontend/AGENTS.md` (5 שכבות + חוקי-זהב logical-CSS/RTL).

**parallel-safety:** קרא `docs/conventions/parallel-safe-code.md`. כל הנגיעות כאן
**additive** (יש worktrees פעילים על `agent-session.svelte.ts` — הישאר additive):
שדה `usage` חדש, ענף חדש ב-`#onSessionUpdate`, שורת reset ב-`#captureSessionConfig`,
key חדש ב-i18n catalog, רכיב UI חדש. **אל תשנה signatures קיימים.**

---

## 1. Commits

### Commit 0 — SPIKE: אישור פליטת `usage_update` (fail-fast, testing: manual)
**מטרה:** לפני כל קוד-מוצר — לאשש שלפחות CLI אחד פולט `usage_update` בריצה אמיתית.
1. הרץ BE+FE, פתח סשן עם **opencode** (ברירת-המחדל), שלח prompt אמיתי שמייצר תשובה.
2. לכוד את החוט. שתי אפשרויות:
   - אם קיים wire-recorder/`LOG_WIRE` בפרויקט — הפעל ו-grep ל-`usage_update`.
   - אחרת, הוסף `console.debug("[wire]", update.sessionUpdate)` זמני בראש
     `#onSessionUpdate` (L1160, לפני הענפים) וצפה ב-DevTools console.
3. חזור על 1-2 עבור **claude** (`npx @agentclientprotocol/claude-agent-acp`).
4. **תיעוד התוצאה ב-walkthrough**: אילו CLIs פלטו `usage_update`, ומה הצורה
   המדויקת (`{used, size, cost}` — אילו שדות נוכחים בפועל).

**🛑 שער-החלטה:** אם **אף** CLI לא פולט `usage_update` →
**עצור, אל תבנה UID/state, דווח למרדכי.** במצב כזה הפיצ'ר חסר-נתון והגישה
משתנה (חישוב מ-`PromptResponse.usage` פר-turn, או ספירה לוקאלית) — החלטה
ארכיטקטונית שלי, לא שלך. אל תמשיך ל-Commit 1.
אם **לפחות** CLI אחד פולט → המשך. תעד אילו CLIs נתמכים (השאר יראו מד ריק — תקין).

**DoD Commit 0:** ב-walkthrough כתוב במפורש "usage_update נצפה ב-<CLIs> עם שדות
<...>" או "לא נצפה → עצירה".

---

### Commit 1 — state: קליטת `usage_update` ב-VM (testing: tdd)
1. הוסף שדה ל-`AgentSession` (ליד `configOptions/models/modes`, ~L101-106):
   ```ts
   // cost = u.cost?.amount (Cost הוא {amount,currency}; שומרים רק את הסכום)
   usage = $state<{ used: number; size: number; cost?: number } | null>(null)
   ```
2. ב-**`#onSessionUpdate`** (`agent-session.svelte.ts:1160`) — **🔴 קריטי למיקום**:
   הוסף את הענף **לפני** ה-`if (!text) return` של L1190, **כ-early-return משלו**
   (בדיוק כמו ה-early-returns של `tool_call`/`tool_call_update` ב-L1181-1188).
   **אל תוסיף אותו לשרשרת ה-else-if** של L1195+ — שם הוא לעולם לא יורה
   (ה-guard ב-L1191 חותך אותו כי אין `content.text`):
   ```ts
   // ⬅️ מיד אחרי הטיפול ב-tool_call_update (L1188), לפני חישוב `text`:
   if (update.sessionUpdate === "usage_update") {
     const u = update as { used?: number; size?: number; cost?: { amount?: number } | null }
     if (typeof u.used === "number" && typeof u.size === "number") {
       this.usage = { used: u.used, size: u.size, cost: u.cost?.amount }
     }
     return
   }
   ```
   ⚠️ עקוב אחר **דפוס ה-cast הקיים** במתודה (ה-update מגיע כ-shape רופף
   `{ sessionUpdate?: string; ... }`, ~L1163). אל תמציא טיפוס חדש.
3. **reset**: `usage` חייב להתאפס בכל סשן חדש/load. **נקודת-האיפוס המאומתת**:
   `#captureSessionConfig` (L1006) — מאפס בלי-תנאי `configOptions/models/modes` ונקרא
   מ-5 המקומות (newSession L523, loadSession L461/653/767, mock L1129). הוסף שם
   `this.usage = null` (עקביות עם איפוס `modes/models`).

**testing (tdd):** הרחב את `agent-session.turnstate.test.svelte.ts` — יש בו helper
`inject(update)` (~L127-130) שעוטף `{ update }`. הזרק `usage_update`
(`{ sessionUpdate:"usage_update", used, size, cost:{amount,currency} }`) ואמת
ש-`session.usage === { used, size, cost: amount }`; אמת שערך לא-תקין (חסר `used`)
לא מאפס/מקלקל; אמת reset בסשן חדש (`#captureSessionConfig`).

**DoD Commit 1:** typecheck ✓, הטסטים החדשים ירוקים, `usage` מתעדכן מ-notification.

---

### Commit 2 — UI: מד חלון-הקשר (testing: integration + manual)
1. רכיב חדש `ContextWindowMeter.svelte` תחת `packages/frontend/src/lib/components/`:
   - קלט: `used`, `size`, `cost?`.
   - תצוגה: בר התקדמות `used/size` + אחוז (`Math.round(used/size*100)`), טקסט
     `42K / 200K` (פורמט קצר — הוסף helper `formatTokens` אם אין; בדוק
     `packages/core` ל-formatter קיים לפני שכותב חדש).
   - **logical-CSS בלבד** (`inline-start/inline-end`, `ps/pe`) — RTL. ראה
     זיכרון-הפרויקט "logical CSS classes".
   - אם `usage === null` → אל תרנדר (או מצב מינימלי "—"). אל תשבור layout כש-CLI
     לא פולט.
2. שיבוץ: ליד ה-input או ב-header של הצ'אט. אתר את הרכיב הקיים שמחזיק את
   ה-`AgentSession` (חפש שימוש ב-`session.modes`/`SessionOptionsPanel`) ושבץ שם
   `{#if session.usage}<ContextWindowMeter .../>{/if}`.
3. **i18n**: כל מחרוזת גלויה → `he.ts` (`packages/core/src/i18n/catalogs/he.ts`).
   הרץ `pnpm lint:i18n`. בדוק את מבנה ה-catalog הקיים לפני הוספת מפתחות.

**testing:** component test (mount עם props, אמת בר/אחוז/טקסט); manual ב-mock.

**DoD Commit 2:** typecheck ✓, `lint:i18n` ✓, מד מוצג ומתעדכן, RTL תקין, ריק כש-null.

---

### Commit 3 — calev light (testing: none — verifier)
מרדכי מפעיל את כלב (mode: light). אליעזר לא ממזג.

---

## 8. Complexity
**5/10.** plumbing קצר (ענף יחיד ב-switch) + רכיב UI קטן. הסיכון אינו טכני אלא
**זמינות-נתון ריצתית** (Commit 0 ממתן אותו ל-fail-fast). → calev mode: light.

## 9. Q&A / החלטות
- **Q: למה לא להשתמש ב-`PromptResponse.usage` (פר-turn)?** A: הוא נזרק היום ב-acp-provider
  (turn.end לא נושא usage), והוא מצטבר-פר-turn ולא "used מול size". `usage_update`
  נותן ישירות used/size = בדיוק מד-החלון. אם Commit 0 מגלה שאין `usage_update` →
  זו תהיה החלופה (אבל אז מרדכי מחליט).
- **Q: מה אם CLI מסוים לא פולט?** A: מד ריק/מוסתר. תקין. תעד אילו נתמכים.
- **Q: cost?** A: nice-to-have. ב-ACP `cost` הוא `Cost = {amount,currency}` (אובייקט,
  לא מספר) — שומרים `u.cost?.amount`. הצג אם נוכח, אל תכשל אם חסר.

## depends_on
**[]** — עצמאי לחלוטין. נוגע רק ב-FE VM + רכיב UI חדש.
