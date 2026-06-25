# Slice chat-virtualization — windowing + follow/hold לרשימת הבועות — תוכנית

> **תאריך**: 2026-06-25 · **עודכן**: 2026-06-25 (batched auto-scroll — דיון `623c749f`)
> **סטטוס**: ✅ **הושלם** — 4 commits על branch `slice-chat-virtualization` (17253b3..f60168c). verifier-slice-heavy בביצוע. (מקורי: READY r8 מ-אביגיל, 0 findings.)
> **Complexity**: 8/10 (קצה עליון אחרי תוספת batched+toggle-intent+turn-boundary; verifier: **calev-heavy** + phase-check אחרי Commit 1)
> **תלות (depends_on)**: [] — עצמאי. base = `dev` (d15b5cf — אחרי merge של display-toggle-consistency `96ed28e` ו-session-title-header). לא חופף ל-session-title (AppHeader/VM) או latex (markdown.ts) — נוגע ב-scroll/AppShell/ChatBubbles + toggle של ToolBubble/ThoughtBubble.

> **רקע-מחקר** (נעשה ב-2026-06-25, מתועד ב-decisions): נבחרה הספרייה **`virtua`** (לא TanStack-headless ולא ידני) בזכות zero-config dynamic measurement + `Virtualizer` עם `scrollRef` חיצוני. נבחר **Option B** — AppShell **נשאר owner ה-scroll** (חוק זהב #4 / redesign-2 לא מתהפך), virtua עושה windowing בתוך ה-scroll node הקיים. רמת חסינות **MVP+**: windowing + **batched follow** + user-intent window. **hold-target (בועה גבוהה-מ-viewport) נדחה ל-future.**

> **החלטת UX — auto-scroll במנות (לא רציף)** (דיון `623c749f`, מתועד ב-decisions): follow **לא** עוקב רציף אחרי כל גדילה (זה הבאג הקופצני של ChatGPT/Claude — הטקסט "בורח" תוך כדי קריאה). במקום זה — **batched**: קופצים לתחתית **המוחלטת בבת-אחת** רק כש (א) הקצה החי נפל **≥ ~3 שורות** (`3 × lineHeight`) מתחת לתחתית הנראית, **וגם** (ב) עברו **≥ ~300ms** מהקפיצה הקודמת (throttle-floor שמאחד פרצים מהירים לקפיצה אחת חלקה). בין הקפיצות — **אפס תזוזה**. **בלי page-cap** (נשקל ונדחה מפורשות — המשתמשת רוצה קפיצה מלאה לסוף, לא הליכת-מסך). כלל אחד מכסה גם פרוזה זורמת (קפיצות קטנות קריאות) וגם בלוק-כלי גדול (קפיצה אחת לסוף). **toggle ידני של בועה (פתיחה/קיפול tool/thought) = user-intent = hold** (אחרת פתיחת כלי במצב follow תקפיץ אותך לסוף במקום לתת לקרוא). **תור חדש (prompt חדש) = force-follow ON + קפיצה** (גם אם היית ב-hold על התור הקודם).

## §0 — Pre-flight

> ✅ **collision נפתר:** ה-slice נוגע ב-`ToolBubble.svelte`/`ThoughtBubble.svelte` (toggle-intent). `slice-display-toggle-consistency` (שמשכתב את אותם קבצים — polarity חיובית `showThoughts`/`showTools` + migration) **כבר מוזג ל-dev** (`96ed28e`), וכך גם `session-title-header`. dev tip = `d15b5cf`. אין עוד התנגשות-סדר — ה-`<details bind:open>` יציב על dev, וה-`ontoggle` נוסף מעליו. dispatch ישירות על dev.

### Worktree
```bash
git worktree add .worktrees/slice-chat-virtualization -b slice-chat-virtualization dev
cd .worktrees/slice-chat-virtualization
pnpm install && pnpm hooks:install
pnpm --filter @drive-coding/frontend add virtua   # ← תלות חדשה (מאושר ע"י המשתמשת)
```

### Run
- FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned — ראה startup log)
- BE: **לא נדרש** לסבב הזה — כל האימות דרך mock fixtures (`/chat?mock=<name>`), בלי ACP חי.
- streaming-sim: `/chat?mock=<name>&stream=<ms>` — `#loadMockSession` משהה בין updates (sleep צד-לקוח). השתמש ל-בדיקת follow בזמן זרימה. (שים לב: `&stream=`, לא `?stream=` — זו query-param שנייה.)

### Browser
- **חובה browser אמיתי** (scroll/ResizeObserver/momentum לא נבדקים ב-JSDOM). Chrome רגיל למובייל-emulation + לפחות בדיקה אחת ב-linux-gui או טלפון אמיתי (momentum scroll שונה).
- fixtures ארוכים לבדיקת windowing: `mitm` / `salary-prev` / `salary-attendance` — כל אחד **מאות `updates`** (259/328/325 ב-JSON), שמתקפלים ל-**~150+ בועות** לאחר grouping. הספירה המדויקת מתגלה רק אחרי רינדור — אל תסתמך על מספר ה-updates. ה-DoD נמדד יחסית (node-בועות ב-DOM ≪ סך הבועות).

### Reading list
**must-read לפני קוד**:
- `packages/frontend/AGENTS.md` §"חמשת חוקי הזהב" (#4 side-effects שייכים ל-owner של ה-state; #3 components הם leaves)
- `docs/conventions/parallel-safe-code.md` — **חובה**: הסבב נוגע ב-3 קבצים משותפים (`context.ts`, `+layout.svelte`, `chat/+page.svelte` עקיף דרך AppShell). additive only.
- §"רקע-מחקר" + §3 כאן (הארכיטקטורה) לפני שכותבים שורה.

**reference בזמן עבודה**:
- ה-`VirtualizerHandle` + props ב-`node_modules/virtua/dist` (אחרי install) — לאמת חתימות מול §4.
- `~/projects/CodeNomad/packages/ui/src/components/virtual-follow-list.tsx` — reference (Solid) לדפוסי follow/intent/anchor. **לא להעתיק** — דפוס בלבד.

## §1 — מטרה

בשיחה ארוכה (180+ בועות) ה-`{#each}` הנוכחי מחזיק את כל הבועות ב-DOM בו-זמנית → גלילה איטית/קופצנית, במיוחד בנייד. אחרי הסבב: רק הבועות שבחלון-התצוגה (+overscan) ב-DOM, והגלילה חלקה ללא תלות באורך השיחה. בנוסף — **auto-scroll קריא במנות**: בזמן streaming הגלילה **לא** עוקבת רציף (שזה הבאג הקופצני שבו הטקסט "בורח" תוך כדי קריאה), אלא קופצת לתחתית **במנות** (distance ~3 שורות + floor ~300ms), עם אפס תזוזה בין הקפיצות — כך שאפשר לקרוא בנוחות תוך כדי שהסוכן כותב. hold בגלילה-למעלה/פתיחת-בועה, ו-force-follow על תור חדש.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| windowing של `session.bubbles` עם virtua | ✅ | הסבב |
| follow (pin לתחתית כשבתחתית) דרך virtua handle | ✅ | הסבב |
| hold (שמירת מיקום כשגוללים למעלה) | ✅ | הסבב — חינם מ-virtua (measurement-jump compensation) + ניהול דגל follow |
| **batched auto-scroll** — קפיצה לתחתית מלאה לפי distance(~3 שורות) + floor(~300ms), **לא רציף, לא page-walk** | ✅ | הסבב — **הלב של ה-UX** (מחליף את ה-re-pin הרציף) |
| `ResizeObserver` על הבועה האחרונה — מזין את לולאת ה-batched (לא מקפיץ ישירות) | ✅ | הסבב |
| user-intent window (wheel/touch/keydown + **toggle ידני של בועה**) | ✅ | הסבב |
| **force-follow על תור חדש** (prompt חדש מדליק follow + קופץ) | ✅ | הסבב |
| jump-to-bottom button (קיים) — חיווט מחדש למדדי virtua | ✅ | הסבב |
| **page-cap / הליכת-מסך** (קפיצה חלקית של ≤viewport) | ❌ | **נדחה מפורשות** (דיון `623c749f`) — קפיצה תמיד מלאה לסוף |
| **snap-to-line** (נחיתה על גבול שורה) | ❌ | future — לא נדרש עם קפיצה-לתחתית-מלאה בגרנולריות בועה |
| **hold-target** (בועה גבוהה-מ-viewport מחזיקה follow) | ❌ | future — over-engineering ל-MVP |
| `shift` mode (prepend היסטוריה למעלה בלי קפיצה) | ❌ | future (טעינת-היסטוריה-בגלילה-למעלה — אין כיום) |
| scroll restoration בין ניווטים (cache snapshot) | ❌ | future |
| שינוי עיצוב הבועות עצמן | ❌ | redesign-5 (לא כאן) |
| הפיכת scroll-ownership ל-ChatBubbles | ❌ | **מפורשות לא** — AppShell נשאר owner (Option B) |

## §3 — Architecture diagram + החלטות

```
routes/
  +layout.svelte        ← (composition root) יוצר ChatScrollBridge ($state) + setChatScroll
  chat/+page.svelte     ← לא נוגעים (AppShell + ChatBubbles כמו היום)
lib/
  context.ts            ← + צמד getChatScroll/setChatScroll (additive, בלוק חדש בסוף)
  util/
    scroll-follow.ts    ← חדש: פונקציה טהורה computeScrollEdges (TDD)
    scroll-follow.test.ts ← חדש
  components/
    layout/AppShell.svelte    ← owner ה-scroll + דגל following. batched follow:
                                isAtBottom מ-handle.getScrollOffset/Size/ViewportSize (לא DOM גולמי);
                                ResizeObserver/$ effect → shouldFollowJump(...) → jumpToBottom() (scrollToIndex last,align:'end');
                                + user-intent listeners (scroll) + noteUserIntent (toggle) + turn-boundary $effect.
                                כותב scrollEl + noteUserIntent ל-bridge.
    components/chat/bubbles/{ToolBubble,ThoughtBubble}.svelte ← `<details ontoggle>` (עם guard ל-init-fire) קורא chatScroll.noteUserIntent?.()
    chat/ChatBubbles.svelte   ← {#each} → <Virtualizer scrollRef={bridge.scrollEl} data={bubbles}
                                getKey={b=>b.id}> ; כותב handle ל-bridge; StatusBubble+empty אחרי הרשימה.
```

**ChatScrollBridge** — אובייקט `$state` משותף (לא VM — זו UI/DOM state, לא domain entity; חוק זהב #2):
```ts
// $state object, נוצר ב-+layout, מסופק ב-context
type ChatScrollBridge = {
  scrollEl: HTMLElement | null    // נכתב ע"י AppShell (bind:this הקיים)
  handle: VirtualizerHandle | null // נכתב ע"י ChatBubbles (bind:this על Virtualizer)
  noteUserIntent?: () => void      // מסופק ע"י AppShell; נקרא ע"י ToolBubble/ThoughtBubble על toggle (hold)
}
```
> **למה גשר דו-כיווני ולא prop**: AppShell (owner ה-scroll + button + follow) ו-ChatBubbles (owner ה-Virtualizer + handle) הם **אחאים** דרך `{@render children()}`, לא יחס parent→prop ישיר. AppShell צריך את ה-handle (follow), ChatBubbles צריך את ה-scrollEl (scrollRef). גשר-`$state` ב-context הוא ה-coupling המינימלי. AppShell נשאר owner ה-scroll — virtua רק שואל אותו (`scrollRef`).

**3 הכרעות-מפתח** (מרדכי, מתועדות ב-decisions):
1. **isAtBottom ממדדי virtua, לא DOM גולמי** — תחת windowing אסור להניח ש-`scrollEl.scrollHeight` מהימן. הפונקציה הטהורה מקבלת `getScrollOffset()/getScrollSize()/getViewportSize()` מה-handle → עובד תמיד, ללא הנחות על מבנה ה-DOM של virtua.
2. **auto-follow דרך `handle.scrollToIndex(last,{align:'end'})`**, לא `scrollTop=scrollHeight` — virtua מחשב נכון גם עבור items שטרם נמדדו (anti-jump בזמן stream).
3. **`{#if bridge.scrollEl}` עוטף את ה-Virtualizer** — מונע מ-virtua ליפול ל-fallback "parent element כ-scroller" אם ה-bind טרם רץ (אחרת ה-`max-w-2xl` wrapper הופך לקונטיינר-גלילה שגוי).
4. **batched, לא רציף** — ה-`ResizeObserver`/onScroll **לא** קוראים `scrollToIndex` ישירות בכל אירוע. הם רק מעדכנים מדדים; פונקציה טהורה `shouldFollowJump` (Commit 0) מחליטה אם **עכשיו** מותר לקפוץ (distance ≥ סף **וגם** floor עבר). הקפיצה עצמה (`scrollToIndex(last,{align:'end'})`) — תחתית מלאה, **בלי page-cap**. זה מה שהופך "follow" ל"קריא" במקום "קופצני".
5. **toggle ידני = user-intent (לא scroll event)** — פתיחה/קיפול בועה משנה את `open`, אבל **אין handler** — שני הקבצים משתמשים ב-`<details bind:open>` (two-way binding נטיב). ⚠️ **ה-hook הוא ה-event `ontoggle` על אלמנט ה-`<details>`** (לא `onclick`, לא עטיפת `open` ב-getter/setter — זה מסבך מיותר): `<details bind:open ontoggle={onUserToggle}>`. `ontoggle` יורה בפתיחה ובסגירה — שתיהן user-intent → תקין.
   ⚠️ **init-fire — חובה guard**: הקוד הוא `<details bind:open>` כש-`open=$state(...)` (לא `<details open>` סטטי). תחת `ssr=false` (CSR-only) Svelte קובע `open` **פרוגרמטית** ב-mount — ולפי HTML spec מעבר `open` null→true פרוגרמטית **כן מתזמן `toggle` event**. `ThoughtBubble` ברירת-מחדל `open=true` (`showThoughts=true` — הפולריות החיובית מ-display-toggle-consistency שמוזג ל-dev; `collapseThoughts` קיים רק בבלוק ה-migration) → `ontoggle` **יורה ב-init** → היה מכבה `following` בטעינה ראשונית (regression ל-DoD "נוחת בתחתית"). **fix**: guard `ready` שמסונן את ה-fire הראשון —
   ```ts
   let ready = false
   onMount(() => requestAnimationFrame(() => { ready = true }))   // ה-init-toggle (task בזמן mount) קודם ל-rAF → מסונן
   const onUserToggle = () => { if (ready) getChatScroll().noteUserIntent?.() }
   ```
   **המוטציה של דגל ה-follow נשארת ב-AppShell** (owner ה-scroll, חוק זהב #4); הבועה רק *מאותתת* — לא נוגעת ב-scroll state. optional-chaining → בטוח גם בבדיקה מבודדת בלי bridge. **calev: אמת חי ש"טעינה ראשונית נוחתת בתחתית" עם mock שמכיל ThoughtBubble פתוח** (`claude-demo`/כל mock עם מחשבה) — זו נקודת ה-init-fire.
6. **turn-boundary = force-follow** — `$effect` ב-AppShell שמזהה בועת-משתמש **חדשה** (הבועה האחרונה עם `kind === "user"` ו-`id` שלא נראה — `UserBubble` נושא `kind` discriminant + `id` יציב; **אין שדה `role`** ב-bubble union) → `following=true` + קפיצה לתחתית. כך prompt חדש תמיד מביא לקצה גם אם היית ב-hold.

## §4 — Commits בסדר

### Commit 0 — `scroll-follow.ts` פונקציות טהורות (approach: **TDD**)
**קבצים חדשים**: `packages/frontend/src/lib/util/scroll-follow.ts` + `scroll-follow.test.ts`
**API skeleton**:
```ts
export type ScrollEdges = { atTop: boolean; atBottom: boolean }
/** טהורה: גאומטריה בלבד. sentinelMargin px מהקצה = "בקצה". */
export function computeScrollEdges(input: {
  scrollOffset: number      // handle.getScrollOffset()
  scrollSize: number        // handle.getScrollSize()
  viewportSize: number      // handle.getViewportSize()
  sentinelMargin?: number   // default 48
}): ScrollEdges

/** טהורה: ההחלטה ה-batched. "האם מותר לקפוץ לתחתית עכשיו?" */
export const FOLLOW_DISTANCE_LINES = 3      // סף-מרחק ביחידות line-height
export const FOLLOW_FLOOR_MS = 300          // מינ' זמן בין קפיצות (מאחד פרצים)
export function shouldFollowJump(input: {
  following: boolean        // דגל follow פעיל (לא ב-hold)
  distanceBelow: number     // px: scrollSize - (scrollOffset + viewportSize)
  lineHeight: number        // px (computed line-height של אזור התוכן)
  now: number               // performance.now()/Date.now()
  lastJumpAt: number        // timestamp הקפיצה התוכניתית הקודמת
  distanceLines?: number    // default FOLLOW_DISTANCE_LINES
  floorMs?: number          // default FOLLOW_FLOOR_MS
}): boolean
// = following && distanceBelow >= (distanceLines??3)*lineHeight && (now-lastJumpAt) >= (floorMs??300)
```
**Verification**:
```bash
cd packages/frontend && pnpm vitest run src/lib/util/scroll-follow.test.ts
```
טסטים `computeScrollEdges`: atBottom=true כש-`scrollSize-(offset+viewport) <= margin`; atTop=true כש-`offset <= margin`; קצוות (תוכן קצר מ-viewport → גם atTop וגם atBottom); margin מותאם.
טסטים `shouldFollowJump`: false כש-`following=false` (ב-hold); false כשמרחק < 3 שורות; false כש-floor טרם עבר (גם אם מרחק גדול — מאחד פרץ מהיר); true כששלושת התנאים מתקיימים; פרמטרים מותאמים (distanceLines/floorMs). **edge**: מרחק ענק (בלוק-כלי) + floor עבר → true פעם אחת (קפיצה מלאה, לא חוזר עד floor הבא).

### Commit 1 — virtua + Virtualizer ב-ChatBubbles + bridge (approach: manual + browser) ⚠️ phase-check אחרי
**קבצים שמשתנים**:
- `packages/frontend/src/lib/context.ts` — בלוק חדש בסוף (additive):
  ```ts
  // ─── chat-scroll bridge ─── (slice chat-virtualization)
  export const [getChatScroll, setChatScroll] = createContext<ChatScrollBridge>()
  ```
  (+ הגדרת הטיפוס `ChatScrollBridge` ב-`$lib/types/chat-scroll.ts` חדש, כדי לא לייבא טיפוס virtua ל-context.ts)
- `packages/frontend/src/routes/+layout.svelte` — בסקשן ה-composition (additive): `const chatScroll = $state<ChatScrollBridge>({ scrollEl: null, handle: null }); setChatScroll(chatScroll)`.
- `packages/frontend/src/lib/components/chat/ChatBubbles.svelte` — החלף את ה-`{#each}`:
  ```svelte
  <script lang="ts">
  import { Virtualizer, type VirtualizerHandle } from "virtua/svelte"
  import { getSession, getI18n, getChatScroll } from "$lib/context"
  const session = getSession(); const t = getI18n().t
  const chatScroll = getChatScroll()
  let handle = $state<VirtualizerHandle>()   // bind:this על רכיב Svelte 5 = instance-exports = ה-handle ישירות
  $effect(() => { chatScroll.handle = handle ?? null })   // פרסם handle ל-bridge
  </script>

  {#if chatScroll.scrollEl}
    <Virtualizer bind:this={handle} scrollRef={chatScroll.scrollEl}
                 data={session.bubbles} getKey={(b) => b.id} startMargin={80}>
      {#snippet children(bubble)}
        <div class="pb-5"><BubbleRenderer {bubble} /></div>  <!-- gap-5 → pb על item (נמדד) -->
      {/snippet}
    </Virtualizer>
  {/if}
  <StatusBubble />
  {#if session.bubbles.length === 0}<div class="empty">{t("chat.empty")}</div>{/if}
  ```
- `packages/frontend/src/lib/components/layout/AppShell.svelte`:
  - הסר `gap-5` מה-wrapper (`flex flex-col gap-5 max-w-2xl` → `flex flex-col max-w-2xl`) — ה-spacing עבר ל-`pb-5` פר-item.
  - כתוב את ה-scroll node ל-bridge: `const chatScroll = getChatScroll()` + `$effect(() => { chatScroll.scrollEl = scrollEl })`.
  - **השאר** את ה-follow logic הקיים כפי-שהוא לבינתיים (raw) — נחווט מחדש ב-Commit 2.

> **`startMargin={80}`** = גובה ה-`pt-20` (80px) של `.chat-scroll`. אם ה-padding ישתנה — לעדכן. אמת ויזואלית שאין offset שגוי בראש.

**Verification + ⚠️ calev `mode: phase`** (אינטגרציה רגישה — חוסם את Commit 2):
```bash
cd packages/frontend && pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend build
# ⚠️ מיד אחרי `pnpm add virtua`: אמת ש-bind:this={handle} עובר typecheck (handle: VirtualizerHandle).
#    אם strict-TS מתלונן על type של instance — annotate ישירות / cast (virtua מייצא VirtualizerHandle מ-virtua/svelte). חוסם typecheck בלבד, לא ריצה.
# browser: /chat?mock=salary-attendance →
#   (א) רק תת-קבוצה של בועות ב-DOM (DevTools Elements) — windowing עובד
#   (ב) גלילה חלקה מקצה-לקצה, אין בועות חסרות/ריקות
#   (ג) טעינה ראשונית נוחתת בתחתית (כמו היום)
#   (ד) StatusBubble + empty state עדיין מופיעים נכון
```
**phase-check מאמת במיוחד**: האם ה-follow ה-raw הקיים (scrollTop=scrollHeight) עדיין עובד מעל virtua, או נשבר → קובע אם Commit 2 הוא חיווט-מחדש מלא או רק הקשחה.

### Commit 2 — batched follow למדדי virtua + ResizeObserver (approach: manual + browser)
**קבצים שמשתנים**: `AppShell.svelte`
- **state חדש ב-AppShell** (owner): `let following = $state(true)`, `let lastJumpAt = 0`.
- `checkIsAtBottom()` → `computeScrollEdges(...)` ממדדי `chatScroll.handle` (Commit 0), לא DOM גולמי.
- `lineHeight` — נמדד פעם אחת מ-`getComputedStyle(scrollEl).lineHeight` (fallback ~24px אם `"normal"`); נשמר ומתעדכן ב-resize של ה-viewport.
- **`jumpToBottom()`** (helper יחיד): `chatScroll.handle?.scrollToIndex(session.bubbles.length - 1, { align: "end" })` + `lastJumpAt = now()`. **תחתית מלאה, בלי page-cap.**
- **ה-batched tick** — מקור הגדילה הוא `ResizeObserver` על ה-content wrapper (הבועה האחרונה גדלה בזמן stream). ב-callback שלו (וגם ב-`$effect` על `session.bubbles`):
  ```ts
  const dist = scrollSize - (scrollOffset + viewportSize)        // distanceBelow
  if (shouldFollowJump({ following, distanceBelow: dist, lineHeight, now: now(), lastJumpAt }))
    jumpToBottom()
  ```
  כלומר ה-observer **לא** מקפיץ ישירות — הוא שואל את הפונקציה הטהורה. אם floor טרם עבר או מרחק < 3 שורות → **אפס תזוזה** (זה הכל). פרץ מהיר מתאחד כי `lastJumpAt` חוסם עד floor הבא. (side-effect של scroll = שייך ל-AppShell, חוק זהב #4.)
  > **floor-tail edge**: כדי שלא "ייתקע" כשהזרם נעצר בדיוק בתוך חלון ה-floor (האירוע האחרון נחסם) — אחרי שהזרם שוקט, ה-`$effect`/observer יורה שוב; הקריאה הבאה (floor כבר עבר) משלימה את הקפיצה. אם אין אירוע-זנב → `setTimeout(floorMs)` קצר שמנקה. אמת בדפדפן שאין "נשאר 2 שורות מתחת" בסוף stream.
- `onScroll` → מעדכן `isAtBottom`; מנקה `hasNewBelow` כשבתחתית. (שינוי דגל `following` מ-scroll — רק ב-Commit 3 דרך user-intent.)

**Verification**:
```bash
# browser: /chat?mock=mitm&stream=120  → בזמן שהבועות "זורמות":
#   (א) follow פעיל → קפיצות במנות (~פעם ב-300ms+, אחרי ~3 שורות), לא רצף קופצני, אפס תזוזה בין הקפיצות
#   (ב) בסוף ה-stream → נוחת בתחתית מלאה (אין "נתקע 2 שורות מתחת")
#   (ג) בלוק גדול (פתח בועת-כלי ארוכה / mock עם tool result גדול) → קפיצה אחת מלאה לסוף, לא הליכת-מסך
#   (ד) גלול למעלה תוך stream → נשאר במקום, לא נגרר; JumpDown מופיע  (תלוי Commit 3 ל-hold מלא)
```

### Commit 3 — user-intent window + toggle-intent + turn-boundary (approach: manual + browser)
**קבצים שמשתנים**: `AppShell.svelte` · `lib/types/chat-scroll.ts` (הרחבת bridge) · `ToolBubble.svelte` · `ThoughtBubble.svelte` (one-liner toggle)

**א. user-intent window (scroll):**
- מאזיני `wheel`/`touchstart`/`keydown` (ArrowUp/Down,PageUp/Down,Home,End,Space) על `scrollEl` → `userIntentUntil = now + 600ms` (+ direction).
- ב-`onScroll`: רק אם `hasUserIntent()` משנים את דגל ה-`following` (scroll-תוכניתי לא שובר follow). גלילה-למעלה יזומה → `following=false`. חזרה ידנית לתחתית → `following=true`.

**ב. toggle-intent (פתיחה/קיפול בועה):**
- ה-bridge מקבל `noteUserIntent?: () => void` — מסופק ע"י AppShell, מציב `userIntentUntil = now + 600ms` + `following=false` (פתיחת בועה = רוצה לקרוא, לא לעקוב).
- ⚠️ **אין handler — שני הקבצים הם `<details bind:open>`.** ה-hook = ה-event **`ontoggle`** על ה-`<details>`, **עם guard ל-init-fire** (ראה §3 dec.5 — `<details bind:open>` מ-`$state` תחת CSR מתזמן `toggle` ב-mount):
  ```svelte
  <script>
    // ... open = $state(...) הקיים
    let ready = false
    onMount(() => requestAnimationFrame(() => { ready = true }))
    const onUserToggle = () => { if (ready) getChatScroll().noteUserIntent?.() }
  </script>
  <!-- ToolBubble.svelte:41 / ThoughtBubble.svelte:43 -->
  <details bind:open ontoggle={onUserToggle}>
  ```
  (additive, optional-chained. **אל תעטוף את `open` ב-getter/setter / $derived** — `ontoggle`+guard הוא הנתיב הנקי.) `ontoggle` יורה בפתיחה ובסגירה — שתיהן user-intent. **הבועה רק מאותתת**; המוטציה ב-AppShell.

**ג. turn-boundary (תור חדש):**
- `$effect` שעוקב אחרי הבועה האחרונה ב-`session.bubbles`: כשמופיעה בועת **`kind === "user"`** חדשה (id שלא נראה — `UserBubble` נושא `kind` discriminant + `id` יציב; **אין שדה `role`**) → `following=true` + `jumpToBottom()`. **גובר על hold** של התור הקודם.

- ניקוי כל המאזינים ב-cleanup של ה-`$effect`.
**Verification**:
```bash
# browser:
#   (א) follow פעיל → scrollToIndex תוכניתי לא מכבה follow; wheel-up יזום מכבה מיידית; חזרה לתחתית מדליק.
#   (ב) toggle: במצב follow, פתח בועת-כלי אחרונה → הגלילה קופאת (לא מקפיץ לסוף); JumpDown מופיע.
#   (ג) turn: היה ב-hold (גלול למעלה) → שלח prompt חדש → קופץ אוטומטית לתחתית + follow on.
```

## §5 — DoD verifiable

| בדיקה | איך |
|---|---|
| windowing — לא כל הבועות ב-DOM | `/chat?mock=salary-attendance`; DevTools → מספר node-בועות ב-DOM ≪ סך הבועות שנטענו |
| גלילה חלקה בשיחה ארוכה | גלילה ידנית מקצה לקצה, אין jank/בועות ריקות |
| follow **batched** — קפיצות במנות, לא רציף | `&stream=120`; בתחתית → קפיצה ~פעם ב-300ms+ אחרי ~3 שורות, **אפס תזוזה בין הקפיצות** (לא רצף קופצני) |
| batched — נוחת בתחתית מלאה בסוף stream | סוף `&stream=120` → בקצה, לא "נתקע 2 שורות מתחת" |
| בלוק גדול → קפיצה מלאה (לא page-walk) | בועת-כלי ארוכה/tool result גדול נוחת → קפיצה אחת לסוף |
| hold — שמירת מיקום בגלילה למעלה | גלול למעלה תוך stream → לא זז; JumpDown מופיע |
| toggle = hold | במצב follow פתח בועת-כלי אחרונה → גלילה קופאת (לא מקפיץ לסוף) |
| turn-boundary = force-follow | היה ב-hold → prompt חדש → קופץ לתחתית + follow on |
| anti-jump — תוכן מעל לא קופץ | בועת-כלי מתרחבת/תמונה נטענת מעל ה-viewport → אין קפיצה |
| scroll-תוכניתי לא שובר follow | scrollToIndex פנימי בזמן follow → follow נשאר |
| JumpDown button עובד | גלול למעלה → לחץ → חזרה לתחתית + follow on |
| טעינה ראשונית נוחתת בתחתית | `/chat?mock=greeting` → בתחתית |
| פונקציות טהורות ירוקות | `pnpm vitest run src/lib/util/scroll-follow.test.ts` (computeScrollEdges + shouldFollowJump) |
| typecheck + build + lint:i18n נקיים | הפקודות הרגילות |
| אין regression ב-/settings | `/settings` נטען (AppShell משותף — ה-gap/bridge לא שברו אותו) |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| `scrollRef` undefined ב-mount → virtua נופל ל-parent כ-scroller | virtua type doc ("default = direct parent") | `{#if chatScroll.scrollEl}` עוטף את ה-Virtualizer — לא מומאונט עד ש-scrollEl קיים |
| `flex gap-5` לא עובד עם items מתורגמים | דפוס virtualization כללי | gap → `pb-5` פר-item (נמדד כחלק מגובה ה-item) |
| `scrollEl.scrollHeight` לא מהימן תחת windowing | מחקר 2026-06-25 | isAtBottom ממדדי handle (`getScrollSize`), לא DOM. phase-check ב-Commit 1 מאמת אמפירית |
| follow מתחרה ב-anchoring של virtua או של הדפדפן | MDN overflow-anchor (לא אמין עם virtualization) | follow דרך `scrollToIndex` (API של virtua), לא scrollTop ידני; לא נשענים על `overflow-anchor` |
| Svelte 5 reactivity על `session.bubbles` array | plans/README §6 גוטשה #2 | virtua מקבל `data={session.bubbles}` + `getKey={b=>b.id}` (לא index) — re-render על שינוי אורך/זהות |
| נגיעה ב-3 קבצים משותפים | parallel-safe-code.md | הכל additive (בלוק חדש ב-context.ts, סקשן ב-+layout); AppShell — שינוי owned (scroll שלו) |
| מחרוזת עברית בקוד | pre-commit hook | אין מחרוזת חדשה (משתמשים ב-`chat.empty`/`chat.jumpDown` הקיימים) |
| ה-handle של virtua ב-Svelte לא נקשר כצפוי | אי-ודאות מנגנון bind | אחרי `pnpm add virtua` — אמת את מנגנון ה-`bind:this` + שמות ה-handle מול `node_modules/virtua/dist/svelte`. אם שונה מ-§4 → עדכן + דווח (escalation). |
| **batched "נתקע" בסוף stream** (אירוע-זנב נחסם ע"י floor) | לוגיקת throttle-floor | `$effect`/observer יורה שוב אחרי השקט + `setTimeout(floorMs)` משלים. DoD-row "נוחת בתחתית מלאה" מאמת חי |
| **toggle-intent נוגע ב-2 leaf components** (ToolBubble/ThoughtBubble) | parallel-safe-code | additive `ontoggle` one-liner על ה-`<details bind:open>` הקיים + optional-chaining; **הבועה מאותתת בלבד**, המוטציה ב-AppShell (חוק זהב #4 נשמר). |
| **collision עם `slice-display-toggle-consistency`** — שכתב את אותם `showThoughts`/`showTools` (לשעבר `expandTools`/`collapseThoughts`) ב-ToolBubble/ThoughtBubble (polarity + migration) | roadmap: display-toggle מוזג ל-dev | ✅ **נפתר**: display-toggle-consistency כבר מוזג ל-dev (`96ed28e`). ה-toggle יציב, אין עוד התנגשות-סדר. dispatch ישירות על dev (`d15b5cf`) |
| **lineHeight = "normal"** (לא מספר) מ-getComputedStyle | CSS computed value | fallback ~24px; אמת ש-distance-trigger לא שבור (אחרת קופץ על כל פיקסל או לעולם לא) |
| **init-fire של `ontoggle`** — `<details bind:open>` מ-`$state` תחת CSR מתזמן `toggle` ב-mount → ThoughtBubble (פתוח כברירת-מחדל) מכבה follow בטעינה | HTML spec (programmatic open → queue toggle) + `ssr=false` | guard `ready` (rAF אחרי onMount) מסנן את ה-fire הראשון (§3 dec.5). **calev מאמת חי**: DoD "טעינה ראשונית נוחתת בתחתית" עם mock שיש בו ThoughtBubble פתוח |

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- ה-phase-check ב-Commit 1 מגלה ש-virtua **לא** מתחזק scrollHeight אמיתי **וגם** ה-handle לא נותן מדדים עקביים → שובר את הנחת ה-isAtBottom.
- מנגנון ה-`bind:this` להוצאת ה-handle ב-`virtua/svelte` שונה מהותית מ-§4 (לא רק שמות).
- ה-`max-w-2xl` centering נשבר מתחת ל-Virtualizer (scrollRef ancestor mismatch) ודורש שינוי layout ב-AppShell מעבר ל-gap.

> **לא escalation** (אומת ע"י אביגיל — סיכון אפס): windowing **אינו** פוגע ב-Speaker/replay-quiet. ה-`$effect` של ה-Speaker (`speaker.svelte.ts:151,173`) ו-`bubble-player` קוראים את `session.bubbles` (מערך ה-VM המלא), **לא** את ה-DOM. windowing משפיע רק על מה שמרונדר.
- regression ב-smart-scroll שלא ניתן לפתור בלי לשנות את חלוקת ה-ownership (Option B).

## §8 — Complexity score

- commits: 4 → סביר-גבוה
- שכבות/קבצים משותפים: context.ts + +layout + AppShell + ChatBubbles + util חדש + **ToolBubble/ThoughtBubble (toggle-intent)** → **גבוה**
- API חיצוני: `virtua` (+1)
- streaming/async pipeline: **batched follow** בזמן measurement אסינכרוני + throttle-floor edge-cases (+2)
- refactor של scroll/follow state: דגל `following` + user-intent + turn-boundary ב-AppShell (+2)
- שינוי protocol: לא
- **Score ≈ 8/10 (קצה עליון) → `calev-heavy`** (פרוטוקול 7 שלבים — edge cases של scroll/streaming/batched-timing + regressions ב-smart-scroll קיים) **+ `calev mode: phase` אחרי Commit 1** (אינטגרציית virtua רגישה, חוסמת את ההמשך).

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | `startMargin` — 80px קשיח או לקרוא דינמית מה-padding? | קשיח 80 (= `pt-20`) + הערה לעדכן אם משתנה. דינמי = over-engineering | ❌ |
| 2 | hold-target (בועה גבוהה-מ-viewport) | מחוץ ל-scope (future). אם calev ימצא שזה מטריד בבועות-קוד ארוכות → slice המשך | ❌ |
| 3 | `bufferSize` (overscan px) | default של virtua (200px). virtua **אין** prop בשם `overscan` — רק `bufferSize`. כיוונון אם calev מוצא blank-on-fast-scroll | ❌ |
| 4 | להעביר את ה-follow logic כולו ל-engine נפרד (`scroll-follow-engine`)? | לא בסבב הזה — נשאר ב-AppShell (owner ה-scroll). אם יגדל מדי → refactor עתידי | ❌ |
| 5 | **distance/floor — 3 שורות / 300ms?** | ✅ **הוכרע** (דיון `623c749f`): distance-based ~3×lineHeight + floor 300ms, קפיצה לתחתית מלאה. const-ים ב-`scroll-follow.ts` — **calev מכוונן חי** (אם קופצני מדי → העלה floor / סף; אם נגרר מאחורי הקצה → הורד). batched-by-distance נבחר על-פני throttle ועל-פני continuous-re-pin | ❌ |
| 6 | page-cap / snap-to-line? | ✅ **הוכרע**: שניהם **out**. קפיצה תמיד מלאה לסוף (המשתמשת דחתה הליכת-מסך); snap-to-line מיותר בגרנולריות-בועה | ❌ |
