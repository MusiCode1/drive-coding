# Testing Coverage — תוכנית

> **תאריך**: 2026-05-28
> **סטטוס**: ‏הושלם 2026-05-28 22:55 (branch `testing-coverage`, ‏לפני merge ל-dev)
> **Complexity**: 5/10 (verifier: light)
> **תלות**: ‏אין. ‏יכול לרוץ ‏במקביל לסבבים אחרים.
> **מתבסס על**: ‏`docs/plans/README.md` (מבנה), ‏`tests/smoke/README.md` (smoke convention)

---

## §0 — Pre-flight

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/testing-coverage -b testing-coverage dev
cd .worktrees/testing-coverage
pnpm install
pnpm hooks:install
```

### איך להריץ

| ‏מה | ‏פקודה |
|---|---|
| ‏Vitest (core + backend) | `pnpm test` |
| ‏Vitest (core + backend) watch | `pnpm test:watch` |
| ‏Smoke (single test) | `cd tests/smoke && node <test>.mjs` |
| ‏Smoke (all tests) | ‏פקודה ‏חדשה ‏שתוסף ‏ב-commit 0 |

### Pre-condition לsmoke

‏smoke ‏דורש ‏BE + ‏FE רצים מקומית. ‏הסשן חייב לוודא ‏זאת לפני הרצה. ‏ראה `tests/smoke/README.md`.

```bash
# Terminal 1 — BE (חייב OneCLI)
cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts

# Terminal 2 — FE
pnpm --filter @drive-coding/frontend-v2 dev
```

### Reading list

**must-read לפני** (~‎15 ‏דקות):

1. ‏`tests/smoke/README.md` — ‏convention של ‏RESULT JSON
2. ‏`tests/smoke/chat-roundtrip.mjs` — ‏ה-test ‏הקיים, ‏מודל ‏לחיקוי
3. ‏`docs/conventions/parallel-safe-code.md` — ‏השינויים ‏בקבצים ‏משותפים ‏חייבים ‏additive
4. ‏`AGENTS.md` (root) §Backend MUST run through OneCLI
5. ‏`packages/frontend/src/lib/view-models/settings.svelte.ts` — ‏Settings VM ‏עם persisted voice + ‏async loadVoices
6. ‏`packages/frontend/src/lib/view-models/agent-session.svelte.ts` — ‏Bug D1 fix:
   - ‏שורה 58: ‏`#detached` ‏field declaration
   - ‏שורה 73: ‏`this.#detached = false` ‏ב-attach
   - ‏שורות 84-93: ‏ה-`transport.onClose` callback ‏עם guard ‏ב-88 (`if (this.#detached) return`)
   - ‏שורה 117: ‏`this.#detached = true` ‏ב-detach לפני cleanup
7. ‏`packages/frontend/AGENTS.md` — ‏5 ‏חוקי זהב + ‏מבנה 5 שכבות (רלוונטי ל-commit 5: ‏ה-vitest setup ל-FE ‏חייב לא לפגוע בארכיטקטורת השכבות)

**reference בזמן עבודה**:

- ‏`packages/backend/src/delivery/proxy-cache.ts` — ‏cache rules (POST generateContent + ‏POST text-to-speech) + ‏x-cache headers (hit/miss)
- ‏`packages/frontend/src/lib/components/chat/` — ‏8 ‏components ‏שהפירוק יצר
- ‏`~/.config/opencode/learnings.md` — ‏gotchas רוחביים

---

## §1 — מטרה

‏אחרי הסבב: ‏יש coverage מקיפה ‏יותר מהיום ‏(שכרגע: ‏349 unit tests ‏ב-core/backend + ‏1 ‏smoke test).

**‏המטרה הקונקרטית**: ‏לתפוס regressions ‏עתידיים ב:
1. ‏Voice picker flow (slice 9a) — ‏picker מתאכלס, ‏בחירה נשמרת
2. ‏BE proxy cache — ‏x-cache: hit ‏פועל ב-replay
3. ‏Disconnect flow — ‏Bug D1 (Disconnect spurious error) ‏לא חוזר
4. ‏Audio toggle — ‏on/off ‏אמין
5. ‏BubbleRenderer dispatch — ‏switch exhaustiveness

‏לא ‏בscope: ‏component tests מלאים ‏עם testing-library/svelte (setup כבד, ‏ROI ‏לא ‏מצדיק עכשיו).

---

## §2 — Scope

| ‏סוג test | ‏כן/לא | ‏איפה |
|---|---|---|
| ‏Smoke extensions ‏(end-to-end Playwright) | ✅ | ‏commits 1-3 |
| ‏Component test ‏ל-BubbleRenderer ‏(switch exhaustive) | ✅ | ‏commit 4 — ‏unit test ‏ללא ‏DOM (logic only) |
| ‏Unit test ‏ל-Settings.loadVoices race conditions | ✅ | ‏commit 5 |
| ‏Component tests ‏עם testing-library/svelte | ❌ | ‏Setup כבד, ‏ROI נמוך. ‏סבב נפרד אם תצא הצדקה |
| ‏Visual regression tests ‏(Percy/Chromatic) | ❌ | ‏Over-engineering לפרויקט יחיד-משתמש |
| ‏Mock unit tests ‏ל-adapters (tts, ‏translate, ‏voices, ‏transcribe) | ❌ | ‏fetch wrappers ‏טריוויאליים. ‏smoke ‏מכסה |
| ‏Engine tests (AudioStream, ‏Player) | ❌ | ‏MediaSource ‏לא ‏ב-JSDOM. ‏הסתבכות גדולה. ‏skip |
| ‏Speaker VM orchestration test | ❌ | ‏מורכב, ‏smoke ‏יראה רגרסיות מספיק |
| ‏CI integration | ❌ | ‏עדיין ‏אין CI. ‏סבב ‏עתידי |

---

## §3 — Architecture של ה-tests

```
‏tests/
  smoke/                        ← ‏E2E ‏עם Playwright ‏(Chromium headless)
    chat-roundtrip.mjs          (קיים — ‏slice 2 verification)
    voice-picker.mjs            ← ‏commit 1
    cache-replay.mjs            ← ‏commit 2
    disconnect.mjs              ← ‏commit 3
    run-all.mjs                 ← ‏commit 0 (runner)
    package.json (Playwright)
    README.md

‏packages/core/                 ← ‏Vitest unit (קיים, ‏349 ‏tests)

‏packages/backend/               ← ‏Vitest integration (קיים)

‏packages/frontend/              ← ‏Vitest unit ‏(setup חדש ב-commit 5)
  src/lib/types/
    bubble.exhaustive.ts        ← ‏commit 4 (type-level check)
  src/lib/view-models/
    settings.test.svelte.ts     ← ‏commit 5

‏vitest.config.ts (root)         ← ‏מעודכן ‏ב-commit 5 ‏לכלול ‏את ‏ה-FE
```

### ‏Smoke convention (מ-`tests/smoke/README.md`)

- ‏Exit 0 = pass, ‏exit 1 = fail
- ‏Env overrides: ‏`FE_URL`, ‏`CWD`, ‏`CLI`, ‏`PROMPT`, ‏`HEADED`
- ‏Output: ‏human-readable + ‏`RESULT: {…JSON…}` ‏בשורה אחת
- ‏Browser: ‏Playwright headless Chromium (פר machine, ‏`npx playwright install chromium-headless-shell`)

### ‏Vitest config (root)

‏הקיים: ‏`projects: ["packages/core", "packages/backend"]`. ‏הcomment ‏אומר ‏מפורש: ‏"frontend has no tests yet — add here when it does". ‏ה-commit 5 ‏סוגר ‏את ‏הgap.

---

## §4 — Commits (= ‏tests פר commit)

### Commit 0 — Smoke runner script (approach: **manual**)

**מטרה**: ‏פקודה אחת שמריצה ‏את ‏כל ‏ה-smoke tests ‏ברצף, ‏מסכמת ‏results.

**קבצים חדשים**:
- ‏`tests/smoke/run-all.mjs` — ‏רץ ‏על ‏כל ‏`*.mjs` ‏בתיקייה (חוץ ‏מ-`run-all.mjs` ‏עצמו), ‏מסכם ‏pass/fail
- ‏`tests/smoke/README.md` ‏(update) — ‏הוראות ‏על ‏`run-all.mjs`

**קבצים שמשתנים**:
- ‏`tests/smoke/package.json` — ‏הוספת ‏script ‏`"test": "node run-all.mjs"`

**API skeleton**:
```js
// run-all.mjs
import { readdirSync } from "node:fs"
import { spawn } from "node:child_process"
import path from "node:path"

const dir = path.dirname(new URL(import.meta.url).pathname)
const tests = readdirSync(dir)
  .filter((f) => f.endsWith(".mjs") && f !== "run-all.mjs")

const results = []
for (const t of tests) {
  // spawn node <test>, capture exit code + RESULT line
  // accumulate
}
console.log(JSON.stringify({ ok: results.every(r => r.ok), tests: results }))
process.exit(results.every(r => r.ok) ? 0 : 1)
```

**Verification**: ‏`cd tests/smoke && node run-all.mjs` — ‏רץ ‏את ‏ה-test ‏הקיים ‏(chat-roundtrip), ‏מציג ‏summary.

---

### Commit 1 — Smoke: voice-picker (approach: **manual**)

**קבצים חדשים**:
- ‏`tests/smoke/voice-picker.mjs`

**מה ‏בוחן**:
1. ‏Connect page ‏מציג Voice ‏dropdown ‏ב-form
2. ‏ה-dropdown ‏מאוכלס ‏עם ‏רשימת ‏voices ‏מ-ElevenLabs (≥ 1 ‏voice)
3. ‏Default voice ‏הוא ‏Sarah (voice_id `EXAVITQu4vr4xnSDxMaL`)
4. ‏שינוי ‏voice ‏ל-other ‏ושמירה ל-localStorage ‏(reload → ‏nieuwe ‏voice ‏נשמרת)
5. ‏BE log: ‏GET ‏ל-`/proxy/elevenlabs/v1/voices` ‏נצפה

**Skeleton**:
```js
import { chromium } from "playwright"
const browser = await chromium.launch({ headless: !HEADED })
const page = await browser.newPage()
// 1. goto FE
// 2. ‏וודא ‏ש-`<select>` ‏מופיע ‏ב-form (selector: input/select בlabel + voice text)
// 3. ‏עוצרים, ‏מחכים ל-voices ‏שמתאכלסים (waitForFunction על voiceSelect.options.length > 1)
// 4. ‏assert: ‏voice ‏ראשון ‏ב-options ‏היא Sarah ‏(או ‏שיש option ‏עם value=EXAVITQu4vr4xnSDxMaL)
// 5. ‏בחירת ‏voice ‏אחר, ‏הקלקה ‏על ‏submit ‏(לא נדרש — ‏רק ‏בדיקת ‏localStorage)
// 6. ‏localStorage check: ‏`localStorage.getItem("drive-coding-v2-settings")` ‏מכיל ‏voiceId ‏החדש
// 7. ‏new page (לסימולציה ‏של reload), ‏assert: ‏ה-voice ‏החדש ‏עדיין נבחר
```

**RESULT שדות חדשים**:
```ts
{ voices: { count: number; firstVoiceId: string; persistedVoiceId: string } }
```

**Verification**: ‏אמור ‏לעבור ‏עם ‏slice 9a ‏הקיים. ‏אם ‏נשבר — ‏slice 9 שבור.

---

### Commit 2 — Smoke: cache-replay (approach: **manual**)

**קבצים חדשים**:
- ‏`tests/smoke/cache-replay.mjs`

**מה ‏בוחן**:
1. ‏שלוח ‏prompt קבוע (e.g. "השב 'אישור' בלבד") פעמיים בריצה אחת
2. ‏הריצה ‏הראשונה: ‏TTS proxy responses ‏עם ‏`x-cache: miss`
3. ‏הריצה ‏השנייה: ‏TTS proxy responses ‏עם ‏`x-cache: hit`
4. ‏ה-translate ‏(אם ‏thought ‏מופיע) ‏גם כ-hit ‏בשנייה

**Skeleton**:
```js
// 1. connect
// 2. send prompt 1, ‏accumulate proxy responses (x-cache headers)
// 3. ‏clear bubbles? ‏פשוט ‏שלוח שוב — ‏הbubbles החדשים יוסיפו בהמשך
// 4. send prompt 2 (זהה), accumulate proxy responses
// 5. assert: ‏ב-pass 2, ‏ה-`x-cache: hit` ‏מופיע ל-TTS וtranslate
```

**Caveat**: ‏הLLM ‏יחזיר ‏טקסט מעט שונה ‏בכל פעם ‏(נון-דטרמיניסטי). ‏אבל ‏אם הטקסט ‏זהה → ‏cache key זהה → ‏hit. ‏לכן prompt צריך ‏לעודד תשובה דטרמיניסטית (e.g. "השב במילה אחת בלבד: כן"). ‏אם הסוכן עדיין נון-דטרמיניסטי — ‏ה-assert ‏יהיה: ‏≥ 1 ‏cache hit ‏ב-pass 2, ‏לא "‏כל cache hit".

**RESULT שדות**:
```ts
{ cache: {
    pass1: { hits, misses, other },
    pass2: { hits, misses, other },
    cacheHitInPass2: boolean   // ‏לפחות ‏אחד
} }
```

---

### Commit 3 — Smoke: disconnect (approach: **manual**)

**קבצים חדשים**:
- ‏`tests/smoke/disconnect.mjs`

**מה ‏בוחן**: ‏regression test ל-**Bug D1** (Disconnect spurious 'WS closed (1005)' error).

1. ‏Connect → ‏/chat
2. ‏לחיצה ‏על Disconnect
3. ‏assert: ‏ה-URL ‏חזר ל-`/`
4. ‏assert: ‏**‏אין** ‏element עם class containing "error" ‏בעמוד ‏הconnect
5. ‏assert: ‏console: ‏אין error חדש מאז ‏ה-Disconnect (‏עם stream tracking)

**Skeleton**:
```js
// 1. connect
// 2. wait for /chat + connected status
// 3. clear console logs collected so far
// 4. click Disconnect button
// 5. waitForURL("**/")  (default 30s)
// 6. wait 1s for any async WS close events to land
// 7. assert: ‏no .error element on /
// 8. assert: ‏no console.error since step 3
```

**RESULT שדות**:
```ts
{ disconnect: { urlAfter: string, hadErrorBanner: boolean, consoleErrorsAfterDisconnect: number } }
```

**Important**: ‏ה-test הזה יזהה ‏regression אם Bug D1 ‏יחזור ‏(e.g., ‏מישהו ‏יסיר ‏את ‏ה-`#detached` flag, ‏או ‏ה-onClose ‏לוגיקה ‏תתחלף).

---

### Commit 4 — Unit test: BubbleRenderer exhaustiveness (approach: **manual**)

‏ה-BubbleRenderer (`packages/frontend/src/lib/components/chat/BubbleRenderer.svelte`) ‏מבצע ‏switch ‏על ‏4 ‏variants (user / message / thought / tool). ‏אם slice ‏עתידי יוסיף variant ‏בלי לעדכן את ‏ה-switch — ‏רגרסיה ‏שקטה.

**שתי גישות**:

**גישה**: ‏type-level test (אין vitest infra ל-FE עדיין; ‏לא רוצים ‏להמתין ‏לcommit 5 ‏לסגירת ‏הgaבל).

**קובץ חדש**: ‏`packages/frontend/src/lib/types/bubble.exhaustive.ts`

‏זה ‏לא ‏file test ‏מובנה, ‏אלא source file ‏שmעורר ‏TypeScript ‏לדרוש exhaustiveness:

```ts
import type { Bubble } from "./bubble"

/**
 * Compile-time exhaustiveness check for the Bubble union.
 *
 * If a new variant is added to Bubble without updating BubbleRenderer.svelte
 * (or this file), TypeScript will fail the build at the `const _exhaustive`
 * assignment.
 *
 * NOT executed at runtime — purely a type-level guard.
 */
function exhaustiveCheck(b: Bubble): string {
  switch (b.kind) {
    case "user": return "u"
    case "message": return "m"
    case "thought": return "t"
    case "tool": return "tool"
    default: {
      const _exhaustive: never = b
      return _exhaustive
    }
  }
}

void exhaustiveCheck
```

**מגבלה ‏ידועה**: ‏ה-trick הזה ‏מוכיח ‏ש-`Bubble` ‏closed type. ‏הוא ‏**לא** ‏מוכיח ‏ש-BubbleRenderer.svelte ‏עצמו ‏ב-runtime ‏מטפל ‏בכל kind — ‏אבל ‏ה-Svelte typecheck ‏על ‏`{:else if bubble.kind === "X"}` ‏יזעק ‏על variant חסר ‏עם ‏אזהרה ‏(לא ‏שגיאה — ‏זה ‏ה-trade-off).

**Verification**: ‏`pnpm --filter @drive-coding/frontend-v2 typecheck` — ‏אמור לעבור.

**Future**: ‏אם slice 4 ‏הוסיף ‏variant ‏ל-Bubble ושכח ‏לעדכן ‏את ‏הקובץ ‏הזה — ‏ה-typecheck ‏ייפול ‏מיד. ‏Slice 4 ‏יראה את הfailure ‏ולא ‏ימצא ‏את ‏הקובץ ‏בגיר ‏שלו ‏(זה ‏בdev). ‏יודיע ‏לTama, ‏שיוסיף ‏את ‏ה-case ‏ב-prep commit ‏לפני ‏המrlamp.

---

### Commit 5 — Unit test: Settings voice methods (approach: **manual + vitest setup**)

‏ה-Settings ‏VM (`packages/frontend/src/lib/view-models/settings.svelte.ts`) ‏הוסיף ב-slice 9a:
- ‏`voiceId` ‏(persisted)
- ‏`availableVoices` (loaded async)
- ‏`voicesLoading`, ‏`voicesError`
- ‏`setVoiceId`, ‏`loadVoices`

`loadVoices` ‏יש לו ‏race condition logic ‏(idempotent — ‏לא ‏refetch ‏אם ‏כבר ‏loaded ‏ולא ‏error). ‏שווה ‏unit test ‏לוגי.

**אתגר**: ‏Settings ‏הוא Svelte 5 class ‏עם `$state`. ‏לטסט אותו, ‏צריך ‏את Svelte 5 ‏compiled. ‏זה דורש ‏vitest setup ‏עם `@sveltejs/vite-plugin-svelte`.

**Setup ‏שיש לעשות** (commit 5 ‏ראשון):
1. ‏`packages/frontend/vitest.config.ts` (חדש):
   ```ts
   import { defineConfig } from "vitest/config"
   import { svelte } from "@sveltejs/vite-plugin-svelte"
   export default defineConfig({
     plugins: [svelte({ hot: false })],
     test: { environment: "node" /* ‏אין DOM נדרש לSettings */ },
   })
   ```
2. ‏`vitest.config.ts` (root) — ‏הוסף ‏`packages/frontend` ‏ל-`projects`
3. ‏`packages/frontend/package.json` — ‏הוסף script ‏`"test": "vitest run"` + ‏devDeps ‏אם ‏חסרים

**Tests**:

`packages/frontend/src/lib/view-models/settings.test.svelte.ts` (חדש):

**Mock pattern**:
```ts
import { beforeEach, describe, expect, test, vi } from "vitest"

beforeEach(() => {
  // Mock localStorage כ-Map פנימית
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  })

  // Mock listVoices מ-adapter
  vi.mock("../adapters/voice/voices", () => ({
    listVoices: vi.fn(async () => [
      { voice_id: "v1", name: "Test Voice 1" },
      { voice_id: "v2", name: "Test Voice 2" },
    ]),
  }))
})
```

**Tests**:

1. ‏Default voiceId = ‏Sarah (`EXAVITQu4vr4xnSDxMaL`) ‏אם ‏אין localStorage
2. ‏`setVoiceId("v2")` ‏שומר ל-localStorage (verify ‏עם ‏ה-mock store)
3. ‏`new Settings()` ‏אחרי ‏שmore moved ‏בlocalStorage — ‏מחזיר ‏voiceId ‏ה-stored
4. ‏`await loadVoices()`: ‏availableVoices ‏מאוכלס, ‏voicesLoading: ‏true → ‏false, ‏voicesError: ‏null
5. ‏Idempotency: ‏שתי קריאות ‏רצופות ל-`loadVoices()` → ‏`listVoices` mock ‏נקרא ‏פעם אחת בלבד (verify ‏עם ‏`expect(mock).toHaveBeenCalledTimes(1)`)
6. ‏Retry on error: ‏mock ‏שזורק שגיאה ‏בראשון, ‏מחזיר ‏ב-call שני → ‏`loadVoices` ‏שני ‏יביא ‏את הnerror cleared ‏ויshould fetch again
7. ‏Concurrent: ‏שני ‏`loadVoices` ‏בלי await ‏ביניהם → ‏רק fetch ‏אחד (guard `voicesLoading`)

**Verification**: ‏`pnpm --filter @drive-coding/frontend-v2 test`

---

### Commit 6 — walkthrough + ‏cleanup

- ‏`docs/walkthrough.md`
- ‏`tests/smoke/README.md` — ‏עדכן עם ‏ה-tests החדשים + ‏`run-all.mjs`
- ‏`docs/plans/testing-coverage.md` (זה) — ‏סטטוס → ‏"הושלם"

---

## §5 — DoD

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏`tests/smoke/voice-picker.mjs` ‏רץ ועובר | ‏ידני: ‏`node voice-picker.mjs` ‏עם BE+FE |
| 2 | ‏`tests/smoke/cache-replay.mjs` ‏רץ ועובר | ‏ידני |
| 3 | ‏`tests/smoke/disconnect.mjs` ‏רץ ועובר | ‏ידני |
| 4 | ‏`tests/smoke/run-all.mjs` ‏רץ ועובר ‏על ‏כל ‏ה-tests | ‏ידני |
| 5 | ‏Bubble exhaustive check — ‏typecheck ‏פועל | `pnpm --filter @drive-coding/frontend-v2 typecheck` |
| 6 | ‏Settings unit tests ‏עוברים | `pnpm --filter @drive-coding/frontend-v2 test` |
| 7 | ‏Vitest config של ‏root ‏כולל ‏FE | `pnpm test` ‏מציג ‏גם ‏FE tests |
| 8 | ‏RESULT JSON ‏נכון בכל smoke ‏החדש | ‏grep ‏על ‏output |
| 9 | ‏Lint:i18n + ‏typecheck + ‏build ‏ירוקים | ‏סטנדרטי |
| 10 | ‏smoke chat-roundtrip ‏הקיים ‏לא נשבר | ‏regression sanity |

---

## §6 — Risks + ‏mitigations

| # | ‏סיכון | ‏מיטיגציה |
|---|---|---|
| 1 | ‏Smoke ‏דורש BE+FE רצים — ‏המפתח שוכח | ‏run-all ‏בodvik ‏שbBE על port 4000 + ‏FE זמין. ‏fail fast עם ‏הוראה |
| 2 | ‏cache-replay test ‏אם הLLM ‏לא דטרמיניסטי | ‏prompt מאוד מצומצם ("השב 'אישור' בלבד"). ‏assert ‏רך: ‏≥ 1 hit ‏ב-pass 2 |
| 3 | ‏Bug D1 ‏regression test — ‏false positive ‏אם ‏console errors ‏מאחר אחד אחר | ‏diff ‏בfocus ‏על errors ‏אחרי step "click Disconnect" בלבד |
| 4 | ‏Vitest setup ‏ל-FE ‏עם svelte plugin ‏שובר ‏ל-core | ‏הסטטוס existing config ‏`projects: ["packages/core", "packages/backend"]`. ‏commit 5 ‏מוסיף `packages/frontend`. ‏אם conflicts — ‏הריץ ‏בנפרד `pnpm --filter X test` |
| 5 | ‏Settings ‏tests עם mocked localStorage ‏– ‏Svelte 5 ‏בlast version בלי matching `vitest-plugin-svelte` | ‏ייתכן ‏שדורש ‏`globals: true` ‏וטיפול ‏בstate compilation. ‏אם נכשל אחרי 30 ‏דק' — ‏Escalation #1 |
| 5a | ‏Svelte 5 `$state` ‏על arrays ‏ב-node env ‏עלול לא להתנהג ‏כצפוי ‏(Proxy semantics) | ‏ה-`@sveltejs/vite-plugin-svelte` ‏עם `hot: false` ‏מהדר ‏את ‏ה-runes ‏ל-runtime ‏עם Proxy ‏תקין. ‏אם array push לא ‏מערן reactivity ‏ב-test — ‏לבדוק עם `flushSync` ‏מ-svelte |
| 6 | ‏Playwright headless ‏לא מותקן ‏בworktree חדש | ‏`tests/smoke/README.md` ‏מתאר ‏setup. ‏commit 0 ‏יכלול בדיקה ‏שChromium קיים, ‏יתנהג ‏fail אם לא + ‏הוראה |
| 7 | ‏i18n catalogs ‏שנים עם slice 2 ‏– ‏ה-smoke לוקח prompts בעברית, ‏Hebrew lint חוסם | ‏הprompts ‏מועברים ‏כ-env var ‏(`PROMPT=שלום`) — ‏לא ‏בקוד. ‏Lint לא יחסום |
| 8 | ‏slice 11 או slice 3 ‏שיבולים ‏לdev ‏בזמן ‏הסבב — ‏rebase ‏חוזר | ‏לעבוד ‏על worktree ‏מ-dev tip ‏ב-start. ‏אם ‏ב-dispatch אחרי gל 1 — ‏לrebase ‏אחרי ‏הmerge |

---

## §7 — Escalation triggers

‏עצור ושאל את Tama אם:

1. **‏Vitest + Svelte 5 plugin setup** ‏לוקח ‏יותר ‏מ-30 ‏דק' ‏להריץ test ראשון. ‏ייתכן ‏שצריך גישה ‏אחרת (e.g. ‏לא לטסט Settings VM ישירות, ‏רק דרך smoke).
2. **‏cache-replay**: ‏אם הLLM ‏לא ‏דטרמיניסטי ‏גם ‏ב-prompt ‏פשוט ‏ביותר — ‏לדון ‏אם ‏לbypass ‏ה-LLM (mock ACP responses) ‏או ‏לקבל ‏assert רך
3. **‏Playwright ‏נכשל ‏עם ‏שגיאת ‏permission** ‏או ‏missing binary
4. ‏Test פל ‏על קוד ‏שנכון ‏(false positive) — ‏ייתכן ‏שה-assertion ‏מורכב מדי
5. ‏Setup ‏של ‏`packages/frontend/vitest.config.ts` ‏שובר ‏את ‏ה-`vite dev` ‏הרגיל

‏אחרת: ‏החלט סבירות, ‏רשום בcommit message, ‏המשך.

---

## §8 — Complexity score: 5/10

| ‏פקטור | ‏ניקוד |
|---|---|
| ‏מספר commits (6) | ‏סביר |
| ‏שכבות חדשות (smoke tests, ‏unit test FE) | +2 |
| ‏APIs חיצוניים | 0 |
| ‏Browser APIs (Playwright) | +1 |
| ‏Streaming pipeline | 0 |
| ‏Refactor של state | 0 |
| ‏Vitest setup ל-FE | +2 |
| ‏סה"כ | **5** |

**Verifier**: ‏`verifier-slice-light` — ‏מספיק. ‏כל test ‏יוצא ‏בpass ‏על המצב הנוכחי של dev אם slice 9a + ‏Bug D1 fix ‏עובדים. ‏אם משהו ‏נשבר — ‏זה ‏לא ‏רגרסיה מהסבב הזה.

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏cache-replay assertion רך ‏או ‏קשה? | ‏רך (≥ 1 hit ‏ב-pass 2) | ❌ ‏לפי Risk #2 |
| 2 | ‏Settings unit test ‏בvitest ‏FE setup ‏מסובך — ‏לדלג אם ‏לוקח > 30 ‏דק? | ‏לדלג. ‏Settings ‏מכוסה דרך ‏voice-picker smoke ‏בצורה אחרת | 🟡 ‏ב-commit 5 |
| 3 | ‏Bubble exhaustive — ‏גישה A (type-level) ‏או ‏B (smoke)? | ‏A (פשוט ‏יותר, ‏לא דורש פלאגינים) | ❌ ‏מוחלט |
| 4 | ‏run-all.mjs — ‏רץ ‏tests ‏במקביל ‏או ‏sequential? | ‏Sequential — ‏BE ‏לא ‏סקלאבילי (sessions מצטברים) | ❌ |
| 5 | ‏Cleanup של BE ‏sessions ‏בין tests? | ‏לא ‏ב-MVP. ‏אם BE ‏סובל ‏אחרי 5 ‏tests — ‏slice ‏עתידי | ❌ |

---

## §10 — ‏סטיות ‏מהbrief ‏(ביצוע)

‏- **Commit 2 (cache-replay)**: ‏הניסיון ‏לפי ‏ה-brief ‏(שולח את אותו prompt ‏פעמיים לסוכן) ‏החזיר 0 ‏cache hits ‏ב-pass 2 — ‏הסוכן ‏לא ‏דטרמיניסטי גם ‏ב-"השב במילה אחת בלבד". ‏§6 ‏Risk #2 ‏אישר ‏fallback ‏ל-soft assert, ‏אבל ‏בחרתי ‏גישה ‏אלטרנטיבית: ‏שתי ‏קריאות ‏fetch ‏ישירות ‏מהדפדפן (`page.evaluate`) ‏עם body ‏זהה ‏ו-nonce ‏ייחודי ‏פר ‏ריצה. ‏עוקף ‏את ‏ה-LLM, ‏יציב ומהיר, ‏עדיין ‏מקיף ‏את ‏המסלול ‏Vite proxy → ‏BE → ‏OneCLI → ‏cache writeback. ‏Asserts קשים: ‏pass1 `miss`, ‏pass2 `hit` ‏לשתי הקריאות.

‏- **Commit 4**: ‏השארתי ‏טכניקה ‏אחת ‏(switch-with-never) ‏אבל ‏הוספתי ‏גם ‏שכבה ‏שנייה ‏(`Equals<Bubble["kind"], KnownKind>` ‏עם ‏conditional types) ‏כי ‏זה ‏נותן ‏שגיאה ‏ברורה ‏יותר ‏שמצביעה ‏על ‏השמיט ‏הספציפי. ‏Mutation-tested.

‏- **שאר ‏ה-commits**: ‏לפי ‏ה-brief, ‏ללא ‏סטיות ‏משמעותיות.

---

## §11 — מה אחרי הסבב

‏אחרי הסבב, ‏יש ‏5 ‏tests חדשים (3 ‏smoke + 1 unit + 1 type-level) + ‏run-all script.

‏עתידי:
- ‏Component tests מלאים ‏עם testing-library/svelte (אם ‏יש pull לזה אחרי slice 4 ‏Bubble polish)
- ‏voice-roundtrip.mjs ‏אחרי slice 3 (Mic + ‏STT) — ‏בדיקת ‏הזרימה ‏הקולית המלאה
- ‏CI ‏לרוץ ‏smoke + vitest על PR
- ‏Cleanup logic ‏ל-BE ‏בין ‏tests ‏(אם ‏מצטבר ‏debt)
