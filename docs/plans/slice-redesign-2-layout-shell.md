# Slice redesign-2 — Layout Shell אחיד — תוכנית

> **תאריך**: 2026-06-01
> **סטטוס**: טיוטה
> **Complexity**: 6/10 (verifier: light)
> **תלות**: depends_on: [redesign-1]
> **base**: branch `slice-redesign-1-foundation` (שרשור — לא dev)

---

## §0 — Pre-flight

> ⚠️ **brief בשרשרת — אומת מול תכנון, לא מול קוד קיים.** ThemeVM ו-utility-classes של Tailwind
> (redesign-1) טרם קיימים ב-dev. ה-base חייב להיות branch `slice-redesign-1-foundation`, **לא dev**.
> אם redesign-1 טרם בוצע → עצור. (אם אביגיל אימתה מול dev tip 80ba325 — שם redesign-1 לא קיים; צפוי.)

### Worktree (שרשור — נגזר מ-redesign-1, לא מ-dev)
```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-redesign-2-layout-shell -b slice-redesign-2-layout-shell slice-redesign-1-foundation
cd .worktrees/slice-redesign-2-layout-shell
pnpm install && pnpm hooks:install
```
> ⚠️ **base = `slice-redesign-1-foundation`**, לא `dev`. ה-slice הזה בונה על Tailwind+ThemeVM
> שנוצרו ב-redesign-1. אם redesign-1 עוד לא בוצע — עצור, אי-אפשר להתחיל.

### Run
- **FE**: `pnpm --filter @drive-coding/frontend-v2 dev` (port: OS-assigned)
- **BE** (לבדיקת flow מלא — connect→chat): `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000)
- **Typecheck/Build/Test**: `pnpm --filter @drive-coding/frontend-v2 typecheck|build|test`
- **i18n lint**: `pnpm lint:i18n` (מ-root)

> ⚠️ שם ה-package ב-`--filter` הוא `@drive-coding/frontend-v2` (לא `frontend`).

### Browser
- Chrome מול ה-Vite URL. בדוק גם רוחב דסקטופ (>768px) וגם מובייל (DevTools responsive, ~400px).
- ה-shell צריך להיראות **כמו המוקאפ** AppShell+AppHeader+Sidebar/BottomSheet בשני הרוחבים.

### Reading list
**must-read**:
- `dev/docs/plans/redesign-vnext-mockup.html` — ה-anchor. הקומפוננטות הרלוונטיות:
  - `AppShell` (788-800), `AppHeader` (308-348), `Sidebar` (350-418), `BottomSheet` (738-777),
    `MainScreen` (779-786), `ChatColumn` (472-582 — **רק את ה-shell/scroll wrapper**, לא הבועות).
  - לוגיקת viewport/sidebar/sheet ב-`<script>` (957-1093) — **כ-reference להתנהגות**, לא להעתקה ישירה
    (במוצר: media-query + Svelte state, ראה "לא במוקאפ" 1156-1178).
- `dev/docs/decisions/voice-acp.md` — entry "redesign vNext" + "redesign-2" (ארכיטקטורת multi-route).
- `packages/frontend/AGENTS.md` — חוק זהב #1 (routes shells דקים, 150 שורות), #2 (VM=entity), #4 (effects).
- `dev/docs/conventions/parallel-safe-code.md` — לפני נגיעה ב-`+layout.svelte`, `context.ts`, `i18n/keys.ts`.

**reference**:
- מבנה ה-routing הקיים: `routes/+layout.svelte` (composition root), `routes/chat/+page.svelte`
  (guard + ChatHeader+AgentOptionsPanel+ChatBubbles+ChatInput), `routes/+page.svelte` (connect).

---

## §1 — מטרה

אחרי הסבב הזה ל-`/chat` יש את ה-shell העיצובי של המוקאפ: header צף (☰ + שם סוכן + cwd chip +
נקודת-סטטוס + ⚙), עמודת תוכן ממורכזת עם רוחב מקסימלי (shell רחב, בועות צרות), פס-גלילה אלגנטי,
ו-fade בתחתית. בדסקטופ יש sidebar בצד (אפשרויות סוכן + סשנים); במובייל אותו תוכן ב-bottom-sheet
נגרר — **רכיב משותף אחד** (`SessionOptionsPanel`), לא דופליקציה. הכל ריספונסיבי דרך media-query.
ה-shell חל גם על `/settings` (אותו layout). זהו ה-fix המרכזי לבעיית הקריאוּת בדסקטופ.

---

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| AppShell (`+layout` של קבוצת chat) — max-width 2-רמות, רקע אחיד | ✅ | כאן |
| AppHeader צף (☰/שם/cwd chip/status dot/⚙) + fade gradient | ✅ | כאן |
| Sidebar דסקטופ (`aside w-72`) + collapse | ✅ | כאן |
| BottomSheet מובייל נגרר (peek→open) — אותו תוכן (DRY) | ✅ | כאן |
| `SessionOptionsPanel` משותף (sidebar↔sheet) — **shell בלבד** (סקלטון אפשרויות + placeholder סשנים) | ✅ | כאן |
| ChatColumn shell: scroll-area ממורכז (`max-w-2xl`) + `.chat-scroll` + chat-fade | ✅ | כאן |
| ריספונסיב דסקטופ↔מובייל דרך media-query (`md:`) + ResponsiveVM (matchMedia) | ✅ | כאן |
| **תוכן ה-Sidebar/Sheet האמיתי** (dropdowns סוכן/מודל מחווטים, רשימת סשנים אמיתית) | ❌ | redesign-3 (settings/options) + redesign-6 (sessions) |
| **עיצוב הבועות** (BubbleRenderer/Tool/Thought ל-Tailwind) | ❌ | redesign-5 |
| **הסרת ה-scroll מ-ChatBubbles** (העברת auto-scroll ל-AppShell) | ✅ | כאן (אביגיל #2 — מונע double-scroll) |
| disconnect + audio-master toggle ב-AppHeader (שימור מ-ChatHeader) | ✅ | כאן (אביגיל #1; ימוקם מחדש ב-redesign-3) |
| **RecordFooter / mic 110px / toggle הקלדה-הקלטה** | ❌ | redesign-4 (הסבב הזה משאיר את ChatInput+MicButton הקיימים בתוך ה-shell) |
| **SettingsScreen redesign** (שדות גדולים, כרטיסים) | ❌ | redesign-3 (כאן רק ה-shell חל על /settings) |
| **sheet drag עם component-lib** (Bits/vaul) | ❌ | אם ה-drag הידני מספיק — נשאר; אם לא, redesign-6 מחליט |
| Dialog/Select/Switch primitives | ❌ | redesign-3/6 |

> **קו אדום**: הסבב הזה הוא **shell בלבד**. ChatInput, MicButton הקיימים נכנסים *כמו שהם* לתוך
> ה-shell החדש (עטופים, לא נכתבים מחדש). אם אתה משנה את ה-markup הפנימי שלהם כדי "שיתאימו למוקאפ"
> — עצור. זה redesign-4/5.
> **חריג מאושר (אביגיל #2)**: **ChatBubbles כן משתנה** — מסירים ממנו את ה-scroll-container
> (`overflow-y:auto` + auto-scroll), כי ה-scroll עובר ל-AppShell (ראה Commit 4 + הכרעת scroll-ownership).
> זה השינוי היחיד המותר ב-bubbles בסבב הזה; שאר העיצוב שלהם = redesign-5.

### הכרעות מרדכי על 2 regressions שאביגיל תפסה (חובה לקרוא)

**(1) disconnect + audio-toggle** (היו ב-ChatHeader הנמחק; AppHeader של המוקאפ לא כולל אותם):
ה-AppHeader **כן יכלול** אותם זמנית כדי למנוע רגרסיה — לא בדיוק כמו המוקאפ:
- **disconnect** → אייקון Lucide `LogOut` ב-AppHeader (קורא ל-`onDisconnect` prop = `session.detach()`+`goto("/")`).
- **audio master toggle** (`speaker.enabled`/`speaker.toggle()`) → אייקון Lucide `Volume2`/`VolumeX` ב-AppHeader.
- שניהם **ימוקמו מחדש ב-redesign-3** (disconnect→SessionOptionsPanel; audio master→SettingsScreen ליד
  3 ה-toggles המפורטים). בינתיים ב-header. **תעד ב-decisions.**

**(2) scroll ownership** (double-scroll: AppShell עוטף scroll + ChatBubbles כבר scroll):
**ה-scroll עובר ל-AppShell. ChatBubbles מאבד את ה-scroll שלו.**
- AppShell מחזיק את ה-`.chat-scroll overflow-y-auto` + ה-`bind:this` של ה-scroll node + ה-auto-scroll $effect.
- ChatBubbles הופך ל-content בלבד (מסירים `overflow-y:auto`, `bind:this={chatEl}`, ה-$effect של scrollTop).
- **חוק זהב #4**: ה-auto-scroll $effect עובר ל-component שמחזיק את ה-scroll node = AppShell (או ChatScroll
  שחולצים ממנו). redesign-7 (smart-scroll) ימשיך מאותו מקום.

---

## §3 — Architecture diagram

**הכרעה ארכיטקטונית (decisions): נשארים multi-route. ה-AppShell = nested `+layout`.**
המוקאפ הוא single-page עם `data-view` (artifact של HTML סטטי). במוצר: routes נפרדים,
ה-shell המשותף הוא `+layout.svelte` של קבוצת routes. זה מכבד חוק זהב #1 (לא route ענק).

```
routes/
  +layout.svelte              ← (ללא שינוי מהותי — composition root; redesign-1 הוסיף ThemeVM)
  +page.svelte                — / (connect) — ללא shell (מסך כניסה עצמאי)
  (chat)/                     ← חדש: route group עם shell משותף
    +layout.svelte            ← חדש: AppShell — header + sidebar/sheet + <slot/> לתוכן
    chat/+page.svelte         ← עובר לכאן? לא — ראה הערה. נשאר routes/chat/+page.svelte
  ...
```
> **הערה על route-group**: SvelteKit route-groups (`(name)/`) משתפים layout בלי לשנות URL.
> **אבל** העברת קבצים בין תיקיות = שינוי invasive. **גישה פשוטה ובטוחה יותר** (מומלצת):
> אל תזיז routes. צור `AppShell.svelte` **כקומפוננטה** ב-`lib/components/layout/`, ועטוף בה את
> תוכן `chat/+page.svelte` ו-`settings/+page.svelte`. ה-shell מקבל את התוכן כ-`{@render children()}`
> או כ-snippet prop. כך אין הזזת routes, אין route ענק, וה-shell משותף. **בחר בזה.**

```
components/layout/             ← חדש (כל הקבצים)
  AppShell.svelte             — עוטף: AppHeader + (Sidebar | BottomSheet לפי viewport) + content slot
  AppHeader.svelte            — header צף (☰/שם/cwd/status/⚙)
  Sidebar.svelte              — aside דסקטופ (w-72, collapse)
  BottomSheet.svelte          — sheet מובייל נגרר (peek→open, backdrop)
  SessionOptionsPanel.svelte  — תוכן משותף (DRY) — סקלטון אפשרויות + placeholder סשנים
view-models/
  responsive.svelte.ts        ← חדש (ResponsiveVM: isMobile $state מ-matchMedia)
  ui-shell.svelte.ts          ← חדש (UiShellVM: sidebarCollapsed + sheetOpen $state)
context.ts                    ← additive (setResponsive/getResponsive, setUiShell/getUiShell)
routes/+layout.svelte         ← additive (new ResponsiveVM/UiShellVM + setContext)
routes/chat/+page.svelte      ← משתנה: עוטף את התוכן ב-<AppShell> (ChatHeader הישן יוצא, AppHeader נכנס)
routes/settings/+page.svelte  ← משתנה: עוטף ב-<AppShell> (אותו shell)
i18n/keys.ts + catalogs       ← additive (מפתחות חדשים: header/sidebar/sheet)
```

**שכבות**: view-models (ResponsiveVM, UiShellVM — entities של UI-state גלובלי), components/layout
(leaves), routes (עטיפה דקה). אין engine/adapter חדש.

> **שאלת VM למרדכי/executor**: האם `sidebarCollapsed`/`sheetOpen` הם "entity" (חוק זהב #2)?
> הכרעה: **כן** — UiShellVM הוא singleton גלובלי שחי מעבר ל-route בודד (ה-shell עוטף chat+settings),
> נצרך מ-AppHeader (☰) ומ-Sidebar/Sheet בו-זמנית. זה לא "route state" כי הוא חוצה routes. ✓ entity.
> ResponsiveVM (`isMobile` מ-matchMedia) — בוודאות entity (מצב מכשיר גלובלי).

---

## §4 — Commits בסדר

### Commit 1 — ResponsiveVM + UiShellVM (approach: manual)

**קבצים חדשים**:
- `packages/frontend/src/lib/view-models/responsive.svelte.ts`
- `packages/frontend/src/lib/view-models/ui-shell.svelte.ts`

**API skeleton**:
```ts
// responsive.svelte.ts
export class ResponsiveVM {
  isMobile = $state(false)   // true כאשר < 768px (Tailwind md breakpoint)
  #mql: MediaQueryList | undefined
  constructor() {
    if (typeof window === "undefined") return
    this.#mql = window.matchMedia("(max-width: 767px)")
    this.isMobile = this.#mql.matches
    this.#mql.addEventListener("change", (e) => { this.isMobile = e.matches })
  }
}

// ui-shell.svelte.ts
export class UiShellVM {
  sidebarCollapsed = $state(false)   // דסקטופ: sidebar מקופל
  sheetOpen = $state(false)          // מובייל: bottom-sheet פתוח
  toggleSidebar(): void { this.sidebarCollapsed = !this.sidebarCollapsed }
  openSheet(): void { this.sheetOpen = true }
  closeSheet(): void { this.sheetOpen = false }
  toggleSheet(): void { this.sheetOpen = !this.sheetOpen }
}
```

**קבצים שמשתנים** (additive):
- `context.ts` — בבלוק הייבוא: `import type { ResponsiveVM }` + `import type { UiShellVM }`.
  בלוקים חדשים בסוף: `// ─── responsive ───` → `[getResponsive, setResponsive]`,
  `// ─── ui-shell ───` → `[getUiShell, setUiShell]`.
- `routes/+layout.svelte` — בלוקים חדשים: `const responsive = new ResponsiveVM()` + `setResponsive`,
  `const uiShell = new UiShellVM()` + `setUiShell`. additive בלבד.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
# DevTools console: getResponsive().isMobile משתנה כשמשנים רוחב חלון (cross 768px)
```

---

### Commit 2 — i18n keys + AppHeader (approach: manual)

**קבצים שמשתנים**:
- `packages/core/src/i18n/keys.ts` — בלוק חדש `// ─── layout/header ─── (redesign-2)`:
  `"header.menu"`, `"header.settings"`, `"header.connected"`, `"sidebar.collapse"`,
  `"sidebar.agentOptions"`, `"sidebar.sessions"`, `"sidebar.refresh"`, `"sidebar.newSession"`,
  `"sheet.handle"`. (הוסף ל-`he.ts` חובה + `en.ts` placeholder, באותו בלוק domain.)
- **קבצים חדשים**:
  - `packages/frontend/src/lib/components/layout/AppHeader.svelte`

**AppHeader פרטים** (מהמוקאפ 308-348 + 2 התוספות מהכרעת מרדכי):
- `<header class="absolute top-0 inset-x-0 z-20 ...">` עם fade gradient layer (backdrop-blur + mask).
- ☰ (כפתור menu) — **דסקטופ-בלבד** (אביגיל #3, תואם מוקאפ:319): בדסקטופ `onclick={() => uiShell.toggleSidebar()}`
  (פותח/מקפל sidebar). **במובייל מוסתר** (ה-sheet peek מחליף אותו). class: מוצג רק `!responsive.isMobile`
  (או `max-md:hidden` / `{#if !responsive.isMobile}`). **לא `md:hidden`** — זה היה הפוך.
- שם הסוכן (`session.cliKind` או קבוע) + cwd chip (`session.cwd`, `dir="ltr"`, אייקון תיקייה Lucide).
- נקודת-סטטוס: `<span>` עם צבע לפי `session.status` (connected=speaking-color). title דרך `t("header.connected")`.
- **audio master toggle** (תוספת — אביגיל #1): אייקון `Volume2`(enabled)/`VolumeX`(disabled),
  `onclick={() => speaker.toggle()}`, מצב מ-`speaker.enabled`. `getSpeaker()` מ-context.
- **disconnect** (תוספת — אביגיל #1): אייקון `LogOut`, `onclick={onDisconnect}` (prop שמגיע מה-route).
- ⚙ — `<a href="/settings">` (Lucide `Settings` icon).
- **AppHeader props**: `{ onDisconnect }: { onDisconnect: () => void }` (כמו ChatHeader הקיים).
  ב-/settings אין disconnect → ה-prop אופציונלי או AppShell מקבל אותו ומעביר. **הכרעה**: AppShell מקבל
  `onDisconnect?` ומעביר ל-AppHeader; ב-/settings לא מועבר → האייקון מוסתר אם `onDisconnect` undefined.
- **i18n**: כל `aria-label`/`title` → `t(key)`. **אייקונים**: Lucide בלבד. נדרשים:
  `Menu`, `Folder`, `Settings`, `Volume2`, `VolumeX`, `LogOut`.
- **keys נוספים**: `header.disconnect`, `header.audioOn`, `header.audioOff` (בנוסף לרשימה למעלה).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm lint:i18n   # אין מחרוזת עברית קשיחה
```

---

### Commit 3 — Sidebar + BottomSheet + SessionOptionsPanel (approach: manual)

**קבצים חדשים**:
- `packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte` — **תוכן משותף DRY**.
  כולל (shell בלבד): כותרת "אפשרויות סוכן" + 3 selects placeholder (סוכן/מודל/חשיבה — **לא מחווטים**,
  סקלטון; redesign-3 מחווט), כותרת "סשנים" + כפתור רענן (Lucide `RefreshCw`) + "סשן חדש" + placeholder
  רשימה. **אל תחווט ל-session/API** — זה shell. הוסף הערה `<!-- TODO redesign-3/6: wire -->`.
- `packages/frontend/src/lib/components/layout/Sidebar.svelte` — `<aside w-72>` (מוקאפ 350-418).
  עוטף `<SessionOptionsPanel/>`. collapse דרך `uiShell.sidebarCollapsed` (width→0 + opacity).
  כפתור collapse (Lucide `ChevronRight`).
- `packages/frontend/src/lib/components/layout/BottomSheet.svelte` — sheet נגרר (מוקאפ 738-777).
  עוטף `<SessionOptionsPanel/>`. peek (translateY) ↔ open (`uiShell.sheetOpen`). ידית גרירה + backdrop.
  **drag**: מימוש ידני (pointer events) כמו במוקאפ 1053-1081, **או** click-to-toggle בלבד אם ה-drag
  מסובך — ה-drag המלא הוא nice-to-have; click על הידית פותח/סוגר חובה. (אם בוחרים drag — Risks §6.)

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm lint:i18n
```

---

### Commit 4 — AppShell + חיווט ל-routes (approach: manual)

**קבצים חדשים**:
- `packages/frontend/src/lib/components/layout/AppShell.svelte`

**API skeleton**:
```svelte
<script lang="ts">
  import { getResponsive } from "$lib/context"
  import AppHeader from "./AppHeader.svelte"
  import Sidebar from "./Sidebar.svelte"
  import BottomSheet from "./BottomSheet.svelte"
  let { children }: { children: import("svelte").Snippet } = $props()
  const responsive = getResponsive()
</script>

<script lang="ts">
  // AppShell מחזיק את ה-scroll node + auto-scroll $effect (חוק זהב #4 — הועבר מ-ChatBubbles).
  let scrollEl = $state<HTMLElement | null>(null)
  const session = getSession()
  // auto-scroll: הועבר מ-ChatBubbles.svelte:21-36 ככתבו (קורא bubbles.length + segment lengths).
  $effect(() => { /* ... אותו effect, רק scrollEl במקום chatEl ... */ })
</script>

<div class="relative flex flex-col h-[100dvh] w-full mx-auto" ...>
  <AppHeader {onDisconnect} />
  <div class="flex flex-row flex-1 min-h-0">
    {#if !responsive.isMobile}<Sidebar />{/if}
    <div class="relative flex flex-col flex-1 min-h-0">
      <!-- chat-fade overlay (מוקאפ 480-481) — מעל ה-scroll -->
      <div bind:this={scrollEl} class="chat-scroll flex-1 overflow-y-auto ...">
        <div class="... max-w-2xl mx-auto w-full">
          {@render children()}
        </div>
      </div>
    </div>
  </div>
  {#if responsive.isMobile}<BottomSheet />{/if}
</div>
```
> **scroll ownership (אביגיל #2)**: ה-`overflow-y-auto` + `bind:this` + auto-scroll **כאן ב-AppShell**.
> ה-`max-w-2xl mx-auto` = fix A2a (בועות צרות). chat-fade overlay מעל ה-scroll.
> **ChatBubbles משתנה בהתאם** — ראה "קבצים שמשתנים" למטה.

**קבצים שמשתנים**:
- `routes/chat/+page.svelte` — עטוף את התוכן ב-`<AppShell {onDisconnect}>`. **ChatHeader הישן יוצא**
  (מוחלף ב-AppHeader שבתוך AppShell; ה-disconnect+audio שלו עברו ל-AppHeader). `AgentOptionsPanel`
  **נשאר זמנית** בתוך התוכן (redesign-3 ימזג ל-SessionOptionsPanel). ChatBubbles+ChatInput בתוך AppShell content.
  - **חוק זהב #1**: route < 150 שורות. `onDisconnect` כבר קיים ב-route (54 שורות → בטוח).
  - **חוק זהב #5**: מחק `lib/components/chat/ChatHeader.svelte` + הסר import (chat/+page.svelte:4). עדכן.
- **`lib/components/chat/ChatBubbles.svelte` — משתנה (חריג מאושר, אביגיל #2)**: הסר את ה-scroll:
  - הסר `bind:this={chatEl}`, `let chatEl`, `overflow-y:auto` מה-`.chat`, וה-`$effect` של auto-scroll
    (שורות 9, 21-36, 49-51). העבר את ה-$effect (ככתבו) ל-AppShell. ChatBubbles נשאר רק `{#each bubbles}`
    + empty state. **לא נוגעים בעיצוב הבועות** (זה redesign-5) — רק מסירים את ה-scroll wrapper.
- `routes/settings/+page.svelte` — עטוף ב-`<AppShell>` (בלי onDisconnect → אייקון disconnect מוסתר).
  התוכן הפנימי (beUrl form) נשאר; redesign-3 יעצב.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm --filter @drive-coding/frontend-v2 test
pnpm lint:i18n
# flow ידני: BE + FE up → connect → /chat. בדוק shell (header צף, sidebar/sheet, scroll ממורכז).
```

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| typecheck/build/test/i18n נקיים | 4 הפקודות → ירוק |
| header צף עובד | /chat: header עם ☰(מובייל)/שם/cwd chip/status dot/⚙; fade gradient מתחתיו |
| max-width 2-רמות | דסקטופ: shell רחב, בועות ב-`max-w-2xl` ממורכז (קריא, לא נמתח לרוחב מלא) |
| sidebar דסקטופ | רוחב >768px: `aside` בצד עם SessionOptionsPanel. collapse (☰/chevron) מצמצם ל-0 |
| bottom-sheet מובייל | רוחב <768px: אין sidebar, יש sheet עם ידית peek בתחתית; לחיצה/גרירה פותחת |
| DRY | SessionOptionsPanel הוא קומפוננטה אחת המרונדרת גם ב-Sidebar וגם ב-BottomSheet (לא 2 עותקים) |
| ריספונסיב אוטומטי | שינוי רוחב חלון חוצה 768px → מעבר sidebar↔sheet אוטומטי (ResponsiveVM/matchMedia) |
| shell על /settings | /settings מקבל אותו AppShell (header אחיד) |
| ChatHeader נמחק | `ChatHeader.svelte` לא קיים יותר; אין consumer שבור |
| **אין double-scroll** | רק ה-AppShell גולל; ChatBubbles ללא overflow. auto-scroll עובד (הודעה חדשה→תחתית) |
| disconnect עובד | אייקון LogOut ב-header → `session.detach()`+goto("/") |
| audio toggle עובד | אייקון Volume ב-header → `speaker.toggle()`; מצב משתקף (Volume2/VolumeX) |
| המבורגר נכון | דסקטופ: ☰ מקפל/פותח sidebar; מובייל: ☰ מוסתר (sheet peek במקום) |
| .chat-scroll אלגנטי | פס גלילה דק, שקוף→hover (helper מ-redesign-1) |
| parallel-safe | context.ts/+layout.svelte/keys.ts — additive בלבד |
| route < 150 שורות | `wc -l routes/chat/+page.svelte` < 150 |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| route-group (`(chat)/`) = הזזת קבצים invasive | parallel-safe-code | **לא משתמשים ב-route-group.** AppShell = קומפוננטה עוטפת ב-lib/components/layout (§3). אין הזזת routes. |
| sheet drag (pointer events) מורכב/buggy | מוקאפ 1053-1081 | ה-drag הוא nice-to-have. click-to-toggle על הידית = חובה ומספיק ל-DoD. drag מלא — רק אם נשאר זמן. אם buggy → השאר click בלבד, תעד. |
| matchMedia ב-SSR | SvelteKit | FE כבר ssr=false. ResponsiveVM constructor `if (typeof window === undefined) return`. |
| ChatHeader מחיקה שוברת import | חוק זהב #5 | מחק `ChatHeader.svelte` + הסר import מ-chat/+page. typecheck יתפוס consumer שבור. |
| route חורג מ-150 שורות אחרי עטיפה | חוק זהב #1 | אם chat/+page גדל — התוכן (ChatBubbles+Input) כבר components; העטיפה דקה. בדוק `wc -l`. |
| Hardcoded Hebrew | pre-commit hook | כל aria/title/label → t(key). בלוק keys חדש. |
| Svelte 5 reactivity על isMobile | learnings | `isMobile` scalar boolean — אין בעיית array. matchMedia listener כותב ל-$state ב-VM (owner). |
| z-index: header/fade/sheet/backdrop מתנגשים | מוקאפ | עקוב אחר ה-z מהמוקאפ: header z-20, chat-fade z-10, backdrop z-30, sheet z-40. |
| כפילות AgentOptionsPanel↔SessionOptionsPanel | — | בסבב הזה SessionOptionsPanel הוא **placeholder shell**; AgentOptionsPanel נשאר מחווט. המיזוג ב-redesign-3. אל תחווט את שניהם עכשיו. |
| **double-scroll** (AppShell + ChatBubbles שניהם scroll) | אביגיל #2 | ה-scroll עובר ל-AppShell; ChatBubbles מאבד overflow+auto-scroll. **רק container אחד גולל.** בדוק ב-DoD. |
| **אובדן disconnect/audio** כש-ChatHeader נמחק | אביגיל #1 | שניהם עוברים ל-AppHeader כאייקונים (LogOut, Volume2/X). לא רגרסיה. ימוקמו מחדש ב-redesign-3. |
| המבורגר הפוך | אביגיל #3 | ☰ דסקטופ-בלבד (מקפל sidebar); מובייל מוסתר. **לא** `md:hidden`. |
| auto-scroll $effect הועבר | חוק זהב #4 | ה-$effect (ChatBubbles:21-36) עובר ל-AppShell ככתבו (קורא bubbles.length+segment lengths). scrollEl במקום chatEl. |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- מתברר שצריך route-group או הזזת routes כדי לשתף shell (האלטרנטיבה — קומפוננטה — אמורה לעבוד).
- ה-`{@render children()}` snippet pattern לא מתאים לעטיפת תוכן route (Svelte 5 snippet API).
- ResponsiveVM/media-query מתנגש עם משהו ב-SvelteKit hydration.
- מתברר ש-sheet drag דורש component-lib (vaul-svelte) כבר עכשיו — זו הכרעה (component-lib), עצור.
- צריך לשנות markup פנימי של ChatBubbles/ChatInput/MicButton כדי שה-shell יעבוד (זה redesign-4/5).

---

## §8 — Complexity score

**6/10 → verifier: light**

- commits: 4 → 0
- שכבות חדשות: 2 VMs + 5 components/layout → +1
- APIs חיצוניים: matchMedia (browser API) → +1 (לא LLM/proxy)
- streaming/async: אין → 0
- refactor state model: אין (additive; ChatHeader מוחלף אבל לא state model) → 0
- protocol BE↔FE: אין → 0
- responsive + DRY shell + z-index layering → +2 (מורכבות UI אמיתית, אבל ויזואלית-בדיקה)
- מחיקת ChatHeader (refactor consumer) → +2

≈ 6. מתחת ל-8 → light. הבדיקה היא ויזואלית-runtime (shell בשני רוחבים, DRY, ריספונסיב),
לא לוגיקה עמוקה. calev light מתאים.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | route-group או קומפוננטה עוטפת ל-shell? | **קומפוננטה** (AppShell ב-lib/components/layout) — בלי הזזת routes | ❌ (הוכרע) |
| 2 | sheet drag מלא או click-to-toggle? | click חובה; drag אם נשאר זמן | ❌ |
| 3 | AgentOptionsPanel — למזג ל-SessionOptionsPanel עכשיו? | לא — placeholder shell; מיזוג ב-redesign-3 | ❌ |
| 4 | שם הסוכן ב-header — מאיפה? | `session.cliKind` כקבוע בינתיים; redesign-3 יחבר לאפשרויות | ❌ |
