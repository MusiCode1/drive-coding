# Slice 15b — Settings Page Shell — תוכנית

> **‏תאריך**: 2026-05-29
> **‏סטטוס**: ‏הושלם — ‏פאזה 2 ‏מתוך 4 ‏של slice 15 (CF deployment family)
> **‏Complexity**: 3/10 (verifier: ‏אין — ‏נכלל ב-verifier-slice-light בסוף slice 15)
> **‏תלות**: 15a (לא חוסם — ‏FE לא יודע על CORS; ‏אבל merge sequence הוא a → b → c → d)
> **‏מתבסס על**: `docs/plans/README.md`, `docs/conventions/parallel-safe-code.md`, `packages/frontend/AGENTS.md` (5 חוקי הזהב)

---

## §0 — Pre-flight

‏⚠️ **‏אתה ה-executor** — ‏אל תdelegate. ‏ראה `EXECUTOR_DISPATCH.md §0`.

‏רץ באותו worktree של 15a: `.worktrees/slice-15-cf-deployment/`. ‏לפני שמתחילים, ‏וודא ש-15a כבר ‏commit-מ ‏בfork הזה.

```bash
# ‏BE לבדיקת UI (אם רצוי) — port 4002
cd packages/backend
PORT=4002 onecli run --agent voice-acp -- bun --watch src/server.ts &

# FE
cd packages/frontend
BE_PORT=4002 pnpm --filter @drive-coding/frontend-v2 dev
# ‏Vite יבחר port OS-assigned, ידפיס בstartup
```

‏Reading list (must-read, ~‎15 ‏דק'):

‏- `packages/frontend/AGENTS.md` — ‏5 חוקי הזהב, ‏מבנה 5 שכבות
‏- `docs/conventions/parallel-safe-code.md` — ‏additive design
‏- `packages/frontend/src/lib/view-models/settings.svelte.ts` — **‏לקרוא כל הקובץ (122 שורות)**. ‏הקונבנציה ה-additive מתועדת ב-docstring שורות 4-13.
‏- `packages/frontend/src/lib/view-models/settings.test.svelte.ts` — **‏לקרוא** ‏לאיתור helpers (`installLocalStorage` ‏או דומה) ש-15b ‏יחזור עליהם
‏- `packages/frontend/src/lib/view-models/i18n.svelte.ts` — ‏לדעת ‏איך `getI18n().t` ‏עובד
‏- `packages/frontend/src/lib/context.ts:23,26` — `getSettings`/`setSettings` ‏רשומים
‏- `packages/frontend/src/lib/components/chat/ChatHeader.svelte` — ‏component הקיים שמתעדכן ב-Commit 3
‏- `packages/core/src/i18n/keys.ts:66` — ‏ה-placeholder `// ─── settings ─── (slice 9)` ‏היכן להוסיף keys

‏reference:

‏- `packages/core/src/i18n/catalogs/{he,en}.ts` — ‏איך להוסיף ‏ערכים
‏- ‏routes קיימים: ‏`+page.svelte` (connect), ‏`chat/+page.svelte`

---

## §1 — מטרה

‏אחרי 15b: ‏המשתמש לוחץ על ⚙️ ‏בchat header (או ניווט ידני ל-`/settings`), ‏רואה דף הגדרות ‏עם שדה אחד — ‏BE URL. ‏מקליד URL, ‏הערך נשמר אוטומטית ל-localStorage. ‏השדה לא משפיע על כלום עדיין — ‏רק נשמר. ‏(15c יחבר את הערך ל-adapters בפועל).

‏המבנה הזה הוא הבסיס ל-slice 9 ‏עתידי (voice picker + cue toggles) שיוסיפו שדות נוספים. ‏slice 9 ‏המקורי הופך לתוספת על 15b.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
‏| `/settings` route חדש | ✅ | Commit 2 |
‏| `Settings.beUrl` ‏שדה ‏עם `$state` ‏+ ‏persistence | ✅ | Commit 1 |
‏| ‏Validation: ‏URL תקני (scheme + host) ‏או ריק | ✅ | Commit 1 |
‏| ⚙️ ‏כפתור ב-chat header | ✅ | Commit 3 |
‏| ⚙️ ‏כפתור ב-connect screen | ❌ | ‏עתיד (slice 15c או future) |
‏| ‏Save on blur עם debounce | ✅ | Commit 2 |
‏| ‏Validation visual (border red) | ✅ | Commit 2 |
‏| ‏Voice picker | ❌ | slice 9 future |
‏| ‏Audio cue toggles | ❌ | slice 9 future |
‏| ‏Wire BE URL לactual fetch calls | ❌ | **slice 15c** |
‏| ‏i18n keys (he + en) | ✅ | ‏פר commit, ‏~‎6 keys |

---

## §3 — Architecture diagram

```
‏routes/
  +page.svelte       (connect — ‏לא משתנה)
  chat/+page.svelte  (chat — ‏מוסיף ⚙️ ‏ב-header → ‏href="/settings")
  settings/          ← ‏חדש
    +page.svelte     (form: BE URL field)
                                          ↓
‏view-models/
  settings.svelte.ts (קיים, ‏מורחב)
    + beUrl: string  $state
    + setBeUrl(value)  validation + ‏persist
    + #persist (private — ‏localStorage write)
    + #load    (private — ‏localStorage read at construct)

‏localStorage["voice-acp:settings"] = {
  voiceId: "...",
  beUrl: "..."   // ← ‏חדש
}
```

‏i18n keys ‏חדשים — ‏מוסיפים תחת ה-placeholder ‏הקיים ב-`packages/core/src/i18n/keys.ts:66` (`// ─── settings ─── (slice 9)`):

```
settings.title         → "הגדרות" / "Settings"
settings.beUrl.label   → "כתובת השרת (BE URL)" / "Backend URL"
settings.beUrl.help    → "השאר ריק במצב dev. ‏בproduction (Cloudflare) הזן URL מלא של ה-BE." / "Leave empty in dev mode. ..."
settings.beUrl.invalid → "כתובת לא תקנית" / "Invalid URL"
settings.beUrl.saved   → "נשמר ✓" / "Saved ✓"
settings.back          → "חזרה" / "Back"
```

‏**הערה ‎ל-parallel-safe**: ‏ה-comment `// ─── settings ─── (slice 9)` ‏כבר תופס מיקום בקובץ. ‏הוסף את 6 ה-keys ‏מתחתיו (לפני `// ─── recordings ─── (slice 10)`). ‏ב-catalogs/{he,en}.ts ‏עקוב באותו ‏סדר.

---

## §4 — Commits

### Commit 1 — Settings VM extension + tests (approach: TDD)

‏**מטרה**: ‏הוספת `beUrl` ל-Settings הקיים לפי הקונבנציה ה-additive שמתועדת ב-docstring של `settings.svelte.ts:4-13`. ‏לא לבנות class מחדש — ‏רק append.

‏**קוד קיים שצריך להבין** (settings.svelte.ts):
‏- `STORAGE_KEY = "drive-coding-v2-settings"` ‏(שורה 19) — **‏לא ‏לשנות**
‏- `type Persisted = { cliKind, lastCwd, voiceId }` ‏(שורות 23-27) — ‏להוסיף `beUrl` ‏בסוף
‏- `DEFAULTS` ‏(שורות 29-33) — ‏להוסיף `beUrl: ""` ‏בסוף
‏- ‏module-scope `load()` ‏ו-`save()` ‏(שורות 35-53) — **‏אל תיגע**, ‏הם generic + Partial parse מקבל field חדש אוטומטית
‏- ‏constructor (שורות 67-72) — ‏להוסיף ‏שורה אחת: `this.beUrl = loaded.beUrl`
‏- `#persist` ‏(שורות 115-121) — ‏להוסיף ‏שורה אחת: `beUrl: this.beUrl`
‏- ‏Setters arrow functions per-domain — ‏הוסף `setBeUrl` ‏ב-domain block חדש

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/view-models/settings.svelte.ts` | ‏8 ‏הוספות (לפי skeleton למטה). ‏שום שינוי קיים |
‏| `packages/frontend/src/lib/view-models/settings.test.svelte.ts` | ‏Append: ‏section חדש `describe("beUrl", ...)` ‏עם ~‎7 ‏tests. ‏לוודא שimports ו-helpers הקיימים (כמו `installLocalStorage`) ‏זמינים |

‏**שינויים מדויקים** (additive, ‏לפי הקונבנציה):

```ts
// 1. Persisted type — append field
type Persisted = {
  cliKind: CliKind
  lastCwd: string
  voiceId: string
  beUrl: string  // ← ‏חדש (slice 15)
}

// 2. DEFAULTS — append field
const DEFAULTS: Persisted = {
  cliKind: "opencode",
  lastCwd: "",
  voiceId: DEFAULT_VOICE_ID,
  beUrl: "",  // ← ‏חדש
}

// 3. ‏Class — ‏הוסף domain block חדש אחרי `voice` (לפני constructor):
  // ─── backend ───
  beUrl = $state<string>(DEFAULTS.beUrl)

// 4. Constructor — ‏הוסף שורה אחרי `this.voiceId = loaded.voiceId`:
  this.beUrl = loaded.beUrl

// 5. ‏הוסף setter ‏ב-section חדש אחרי setVoiceId (וה-loadVoices), ‏לפני ה-private section:
  // ─── backend ───
  
  /**
   * Validates and sets the BE base URL. Empty string disables override.
   * Returns Result-like for the form to render errors.
   */
  setBeUrl = (value: string): { ok: true } | { ok: false; error: string } => {
    const trimmed = value.trim().replace(/\/$/, "")
    if (trimmed === "") {
      this.beUrl = ""
      this.#persist()
      return { ok: true }
    }
    try {
      const u = new URL(trimmed)
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return { ok: false, error: "scheme must be http or https" }
      }
      this.beUrl = trimmed
      this.#persist()
      return { ok: true }
    } catch {
      return { ok: false, error: "malformed URL" }
    }
  }

// 6. #persist — append to the save() payload:
  #persist(): void {
    save({
      cliKind: this.cliKind,
      lastCwd: this.lastCwd,
      voiceId: this.voiceId,
      beUrl: this.beUrl,  // ← ‏חדש
    })
  }
```

‏**Tests skeleton** (additive — ‏לסוף הקובץ):

```ts
describe("beUrl", () => {
  // ‏השתמש ב-installLocalStorage helper הקיים (שורה ~‎12 ‏של testfile)
  
  it("defaults to empty string", () => { ... })
  it("setBeUrl with valid https URL → persists + ok", () => { ... })
  it("setBeUrl with valid http URL → persists + ok", () => { ... })
  it("setBeUrl with empty string → clears + ok", () => { ... })
  it("setBeUrl strips trailing slash", () => { ... })
  it("setBeUrl with malformed URL → returns error + not persisted", () => { ... })
  it("setBeUrl with ws:// → returns error", () => { ... })
  it("load from existing localStorage without beUrl key → defaults to empty", () => { ... })
})
```

‏**גוטשה — ‏Tests reuse**: ‏הקובץ קיים עם helpers (חפש `installLocalStorage` ‏או דומה). ‏השתמש בהם, ‏לא לכתוב mock חדש.

‏**Verification**:

```bash
pnpm test  # settings.test.svelte.ts
pnpm --filter @drive-coding/frontend-v2 typecheck
```

---

### Commit 2 — `/settings` route + form + i18n keys (approach: manual)

‏**מטרה**: ‏route חדש שמציג טופס עם שדה BE URL ‏וכפתור חזרה.

‏**קבצים חדשים**:

| ‏קובץ | ‏מטרה |
|---|---|
‏| `packages/frontend/src/routes/settings/+page.svelte` | ‏route ‏פשוט: ‏h1 + form + back link |

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/core/src/i18n/keys.ts` | ‏הוסף 6 keys ‏ב-union `MessageKey` (section חדש `settings.*`) |
‏| `packages/core/src/i18n/catalogs/he.ts` | ‏ערכים בעברית (ראה §3) |
‏| `packages/core/src/i18n/catalogs/en.ts` | ‏ערכים באנגלית |

‏**Skeleton**:

```svelte
<!-- src/routes/settings/+page.svelte -->
<script lang="ts">
  import { getSettings, getI18n } from "$lib/context"
  import { goto } from "$app/navigation"

  const settings = getSettings()
  const t = getI18n().t

  let beUrlInput = $state(settings.beUrl)
  let error = $state<string | undefined>(undefined)
  let savedAt = $state<number | undefined>(undefined)

  function handleSave() {
    const result = settings.setBeUrl(beUrlInput)
    if (result.ok) {
      error = undefined
      savedAt = Date.now()
    } else {
      error = result.error
      savedAt = undefined
    }
  }

  let showSaved = $derived(savedAt !== undefined && Date.now() - savedAt < 3000)
</script>

<main class="settings">
  <header>
    <button type="button" onclick={() => goto("/chat")}>← {t("settings.back")}</button>
    <h1>{t("settings.title")}</h1>
  </header>

  <form onsubmit={(e) => { e.preventDefault(); handleSave() }}>
    <label>
      <span class="label">{t("settings.beUrl.label")}</span>
      <input
        type="url"
        bind:value={beUrlInput}
        onblur={handleSave}
        class:invalid={error !== undefined}
        placeholder="https://my-be.example.com"
        dir="ltr"
      />
      <span class="help">{t("settings.beUrl.help")}</span>
      {#if error}
        <span class="error">{t("settings.beUrl.invalid")}: {error}</span>
      {/if}
      {#if showSaved}
        <span class="saved">{t("settings.beUrl.saved")}</span>
      {/if}
    </label>
  </form>
</main>

<style>
  .settings { max-width: 600px; margin: 2rem auto; padding: 1rem; }
  header { display: flex; gap: 1rem; align-items: center; margin-bottom: 2rem; }
  h1 { margin: 0; }
  form { display: flex; flex-direction: column; gap: 1rem; }
  label { display: flex; flex-direction: column; gap: 0.4rem; }
  .label { font-weight: 600; }
  input { padding: 0.7rem; font-size: 1rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-elev); color: inherit; }
  input.invalid { border-color: var(--recording); }
  .help { font-size: 0.85em; opacity: 0.7; }
  .error { font-size: 0.85em; color: var(--recording); }
  .saved { font-size: 0.85em; color: var(--speaking); }
</style>
```

‏**גוטשה — ‏i18n מחרוזות עברית**: ‏ה-`pnpm lint:i18n` ‏יחסום מחרוזת עברית בקוד. ‏כל המחרוזות עוברות דרך `t(...)`. ‏ה-pre-commit hook ‏יזרוק אם פספסת.

‏**גוטשה — ‏Save on blur**: ‏ה-`onblur={handleSave}` ‏נורה כשהinput מאבד פוקוס. ‏זה דורש למשתמש לעבור לאלמנט אחר. ‏ב-mobile / drive-first — ‏אם רק ‏שדה אחד, ‏יכול להיות בעייתי. ‏גישה חלופית: ‏גם `Enter` ‏(form submit). ‏שניהם נכנסים בskeleton.

‏**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n
# ‏ידני: ‏נווט ל-/settings, ‏הקלד URL, ‏Tab → ‏נשמר ✓. ‏reload — ‏הערך עדיין שם.
```

---

### Commit 3 — Chat header ⚙️ button (approach: manual)

‏**מטרה**: ‏link ⚙️ ‏ב-`ChatHeader.svelte` (component קיים) → ‏`/settings`.

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/components/chat/ChatHeader.svelte` | ‏הוסף `<a href="/settings" class="settings-link" aria-label={t("settings.title")}>⚙️</a>` ‏במיקום מתאים ב-header (top-right סביר) |

‏**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n
# ‏ידני: ‏פתח /chat, ‏לחץ ⚙️ → ‏מועברת ל-/settings. ‏לחץ "← ‏חזרה" → ‏חוזרת ל-/chat
```

---

## §5 — DoD

| # | ‏בדיקה | ‏איך |
|---|---|---|
‏| 1 | typecheck FE | ‏אוטומטי |
‏| 2 | tests עוברים + 8 ‏חדשים ל-settings | ‏אוטומטי |
‏| 3 | lint:i18n | ‏אוטומטי |
‏| 4 | build FE | ‏אוטומטי |
‏| 5 | smoke `chat-roundtrip.mjs` ‏עובר | `node tests/smoke/chat-roundtrip.mjs` |
‏| 6 | `/settings` route נטען | ‏ידני |
‏| 7 | ‏שדה ריק → save → reload → ריק | ‏ידני + ‏localStorage inspect |
‏| 8 | ‏URL תקני → save → reload → ‏נשמר | ‏ידני |
‏| 9 | ‏URL לא תקני → ‏border אדום + ‏error | ‏ידני |
‏| 10 | ⚙️ ‏בchat → ‏מנווט ל-/settings | ‏ידני |
‏| 11 | ‏Settings VM ‏עדיין compatible עם slice 4 | ‏בדיקה ש-`voiceId` ‏לא נשבר |

---

## §6 — Risks + mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
‏| 1 | ‏SSR crash על localStorage | general | ‏`browser` ‏guard ב-`#load`/`#persist` |
‏| 2 | ‏Hardcoded Hebrew | i18n lint | ‏כל מחרוזת → t(). ‏6 keys חדשים |
‏| 3 | ‏Svelte 5 $state.snapshot על persist | learnings 2026-05-17 ($state.snapshot לא מכבד toJSON) | ‏לא משתמשים ב-snapshot — ‏בונים payload ידני |
‏| 4 | ‏Conflict עם slice 4 על i18n keys | parallel-safe | ‏slice 4 ‏מוסיף keys ‏ב-section `chat.*` ‏ו-`settings.*` ‏נפרד. ‏אם slice 4 ‏עוד לא merged — ‏15b ‏מצוין עם תלות סדר |
‏| 5 | ‏Conflict על `+layout.svelte` | parallel-safe | ‏15b לא נוגע ב-+layout — ‏רק route חדש. ‏Settings VM ‏כבר ב-context ‏מsetup קיים. ‏אפס conflict |
‏| 6 | ‏localStorage quota | ‏general | ‏try/catch ב-#persist, ‏silent fail |
‏| 7 | ‏localStorage JSON שבור (manual edit) | edge case | ‏#load ‏עוטפת ב-try/catch, ‏fallback ל-defaults |

---

## §7 — Escalation triggers

‏עצור ושאל את Tama אם:

‏1. ‏ה-context (`getSettings/setSettings`) ‏לא קיים בפועל בקוד (התיעוד מציין שכן — ‏לוודא)
‏2. ‏Settings VM ‏הקיים בנוי שונה מהותית ממה שה-skeleton מניח (למשל בלי `$state`)
‏3. ‏localStorage לא ניתן לכתיבה בכלל (incognito mode טהור — ‏אבל זה edge case)

‏אחרת: ‏החלט והמשך.

---

## §8 — Complexity score: 3/10

| ‏פקטור | ‏ניקוד |
|---|---|
‏| ‏מספר commits (3) | +1 |
‏| ‏שכבות (VM + route + component) | +1 |
‏| ‏APIs חיצוניים | 0 |
‏| ‏State refactor | 0 (additive) |
‏| ‏i18n חדשים | +1 |
‏| ‏סה"כ | **3** |

‏**Verifier**: ‏אין verifier-phase ייעודי.

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
‏| 1 | ‏Save על blur ‏בלבד או גם Enter | ‏שניהם (form submit + ‏onblur). ‏אין עלות | ❌ |
‏| 2 | Validation timing — ‏on input ‏או on save? | ‏on save (פחות רעש). ‏on input אם UX רע | ❌ |
‏| 3 | ‏Settings localStorage key | `drive-coding-v2-settings` (קיים, ‏לא משנים) | ❌ |
‏| 4 | ‏Animation על "saved ✓" | ‏fade auto-hide 3s (כתוב ב-`showSaved` derived) | ❌ |
‏| 5 | ⚙️ ‏גם בconnect screen? | ❌ ‏לא בscope. ‏future אם נצטרך | ❌ |

---

## §10 — מה הלאה

**‏הפאזה הבאה: ‏slice 15c** (`docs/plans/slice-15c-adapter-migration.md`). ‏migration של 8 ‏adapter files להשתמש ב-`beUrl()` ‏מ-Settings. ‏הופך את ה-feature לפעיל בפועל.
