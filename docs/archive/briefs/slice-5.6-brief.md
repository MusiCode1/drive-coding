# Slice 5.6 — Port v1 pure logic (provider-error + markdown)

> **מטרה:** סגירת 2 quick wins מ-v1 שהיו אמורים להיות ב-port D47 ולא נעשו: זיהוי שגיאות provider אמיתיות במקום "agent crashed" גנרי, ו-rendering של markdown ב-chat UI (במקום `**bold**` raw).
> **תלות:** commit `91194c8` (Slice 5.5 closed).
> **CWD:** `/home/user/projects/voice-acp-v2`
> **מבצע:** Yolo (Sonnet 4.6)

---

## 0. ⚠️ TDD חובה (חזרה על Slice 5.5 sec. 0)

כל test → red → impl → green → next. אסור 5 tests בבת אחת, אסור impl לפני test.

---

## 1. מה זה Slice 5.6

D47 ב-`vnext-architecture.md` הבטיח ש-~96 pure tests מ-v1 יהיו port-ed. בפועל רק `sentence-boundary` (21 cases) נעשה. נשלים שני קבצים נוספים כאן:

- **`provider-error`** (16 tests) — קריטי כי אבי כבר נתקל בbug של "credit balance" אתמול ולא ראה הודעה
- **`markdown`** (29 tests) — קריטי כי ה-UI נראה "מכוער" — code blocks ו-bold ב-raw

נדחים ל-Slice 6 (טבעי שם):
- `tts-cache.test.ts` — יחד עם LRU eviction
- `recordings.test.ts` — יחד עם persistence

---

## 2. מקורות (קרא קודם)

| v1 קובץ | שורות | תיאור |
|---------|-------|--------|
| `/home/user/projects/voice-acp/backend/src/provider-error.ts` | 47 | impl |
| `/home/user/projects/voice-acp/backend/tests/extractProviderError.test.ts` | ~150 | 16 tests |
| `/home/user/projects/voice-acp/backend/src/markdown.ts` | 35 | impl |
| `/home/user/projects/voice-acp/backend/tests/markdown.test.ts` | ~200 | 29 tests |

קרא את 4 הקבצים לפני שמתחילים.

---

## 3. מה לבנות

### 3.1 `provider-error` — TDD, ~30 דק

**Red — port test:**
- צור `packages/core/tests/acp/provider-error.test.ts`
- copy ה-tests מ-v1. שינוי import: `from "../../src/acp/provider-error.js"`
- הרץ — צפוי: "Cannot find module" (אין impl)

**Green — port impl:**
- צור `packages/core/src/acp/provider-error.ts`
- copy מ-v1
- שינוי: שורה ראשונה היא JSDoc — שמור. ייצוא ESM (אמור להיות זהה).
- הרץ — אמור לעבור.

**Wire — integration ל-vnext:**
- ב-`packages/backend/src/acp/bridge-spawn.ts`:
  - שמור buffer גלגול של stderr — Array של 200 שורות (FIFO)
  - הוסף ל-`SpawnResult`: `stderrLines: () => string[]` — מחזיר עותק
- ב-`packages/backend/src/acp/bridge-manager.ts`:
  - שמור reference ל-stderr getter ב-`BridgeHandle` (הוסף `getStderr: () => string[]`)
- ב-`packages/backend/src/app/agent-orchestrator.ts` בtry/catch של spawn/attach:
  - אם נתפס error — קרא `extractProviderError(bridgeHandle.getStderr())`
  - אם החזיר string — `crashReason: that string`
  - שמור ב-registry. הוסף ל-AgentPublic: `crashReason?: string`
- ב-frontend `+page.svelte`:
  - אם `agent.status === "crashed"` ויש `agent.crashReason` — הצג אותו במקום "הסוכן קרס"

**Wire tests:** הוסף `bridge-manager.test.ts` או `agent-orchestrator.test.ts` בbackend:
- mock spawn שמחזיר stderr עם "credit balance too low"
- assert: agent.status === "crashed", agent.crashReason includes "credit"

### 3.2 `markdown` — TDD, ~30 דק

**Red — port test:**
- צור `packages/core/tests/ui/markdown.test.ts`
- copy מ-v1
- שינוי import

**Setup deps:**
- `cd packages/core && pnpm add marked` (marked הוא pure transformer — לא שובר את "core pure" rule)

**Green — port impl:**
- צור `packages/core/src/ui/markdown.ts`
- copy מ-v1 + שינויי ESM אם דרושים

**Wire — integration:**
- ב-`packages/frontend/src/routes/agent/[id]/+page.svelte`:
  - בlines של `kind === "assistant"`:
    ```svelte
    <span class="bubble" dir="auto">{@html renderMarkdown(msg.text)}</span>
    ```
  - import `renderMarkdown` מ-`@drive-coding/core/ui/markdown` (וודא שה-core package מייצא)
- וודא שה-CSS שתומך ב-HTML מתחילים מ-`<pre>`, `<code>`, `<a>`, `<ul>`, `<table>`. הוסף בסיסי styling אם חסר.

**Wire tests:**
- אין צורך ב-tests integration ל-frontend (Svelte rendering נבדק רק E2E)
- ה-29 tests מ-v1 מספיקים — הם כבר מכסים XSS, code blocks, links, tables

---

## 4. Step-by-step

1. קרא 4 קבצי מקור (v1 src + tests).
2. **`provider-error` TDD loop:**
   - port test → red
   - port impl → green
3. Wire `provider-error` ל-bridge-spawn + bridge-manager + orchestrator + frontend.
   - לכל step — test → red → green
4. **`markdown` TDD loop:**
   - port test → red
   - npm i marked
   - port impl → green
5. Wire `markdown` ל-frontend.
6. `pnpm typecheck` + `pnpm lint` + `pnpm test` (יעד: 153+45 = 198 tests)
7. Smoke ידני:
   - `tail -f /tmp/be.log` ובדפדפן יוצרים agent עם cwd לא קיים → אמור לראות שגיאת spawn אמיתית
   - prompt שמחזיר markdown → UI מציג נכון
8. Commit אחד: `(slice-5.6): port v1 provider-error + markdown — 45 tests + UI integration`
9. עדכן `docs/walkthrough.md` עם entry.

---

## 5. Definition of Done

1. ✅ `core/acp/provider-error.ts` קיים, port מ-v1
2. ✅ `core/tests/acp/provider-error.test.ts` — 16+ cases עוברים
3. ✅ `bridge-spawn.ts` שומר stderr buffer
4. ✅ `bridge-manager.ts` חושף `getStderr()`
5. ✅ `agent-orchestrator.ts` קורא `extractProviderError` ב-catch, שומר `crashReason`
6. ✅ `AgentPublic.crashReason?: string` ב-schema
7. ✅ frontend מציג `crashReason` במקום "הסוכן קרס"
8. ✅ backend test: spawn fail עם stderr → crashReason נכון
9. ✅ `core/ui/markdown.ts` קיים, port מ-v1
10. ✅ `core/tests/ui/markdown.test.ts` — 29+ cases עוברים
11. ✅ `marked` ב-`packages/core/package.json` deps
12. ✅ `renderMarkdown` exported מ-`@drive-coding/core`
13. ✅ frontend `+page.svelte` משתמש ב-`{@html renderMarkdown(text)}` ל-assistant messages
14. ✅ typecheck + lint נקי
15. ✅ pnpm test — 198+ tests (היה 153)
16. ✅ Walkthrough entry + commit

---

## 6. אל תעשה

- **לא לערוך:**
  - `docs/slice-6*` (Tama)
  - `docs/agents/**`
  - voice pipeline (Slice 5)
  - frontend tests של 5.5 (כבר נכתבו)
- **לא להוסיף** features מעבר ל-DoD. אין session UI, אין reconnect, אין cache.
- **לא לשפר** את הקוד של v1 — port כמעט מילולי. אם יש bug ידוע מ-v1 — תעד ב-comment, אל תתקן.

---

## 7. אם נתקעת

- **v1 tests משתמשים ב-`expect.toThrow` או דברים שלא בvitest 4** — קח את הקבצים, התאם syntax מינימלי. אם יש שינויי API גדולים בvitest — דווח, אל תתקע.
- **`marked` v15+ שינה API** — בדוק את ה-import של v1, ייתכן שצריך `import { marked } from "marked"` במקום default.
- **Svelte 5 `{@html ...}` עם happy-dom test** — אין צורך ב-test לזה. סמוך על המבחני v1.
- **stderr buffer race condition** — בunit test, mock `child.stderr.on("data", ...)` ידנית.

---

## 8. הוראות פעולה

1. קרא את ה-brief.
2. קרא 4 קבצי v1.
3. בצע סעיף 3.1 ואז 3.2 (סדר חשוב — provider-error מסובך יותר, markdown יותר ישיר).
4. כל TDD — red → green. הרץ אחרי כל אחד.
5. typecheck + lint + tests בסוף.
6. commit + walkthrough.

**Timeline:** 60-90 דק'. אם עברת 120 — דווח.

בהצלחה.
