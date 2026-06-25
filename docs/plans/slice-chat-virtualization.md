# Slice chat-virtualization — windowing + follow/hold לרשימת הבועות — תוכנית

> **תאריך**: 2026-06-25
> **סטטוס**: מאושר — READY (אביגיל r1=USABLE-AFTER-FIX, 4 findings מינוריים תוקנו; ה-API של virtua אומת אמפירית, אין blocker)
> **Complexity**: 8/10 (verifier: **calev-heavy** + phase-check אחרי Commit 1)
> **תלות (depends_on)**: [] — עצמאי. base = `dev` (229ad9c). לא חופף ל-session-title (AppHeader/VM) או latex (markdown.ts).

> **רקע-מחקר** (נעשה ב-2026-06-25, מתועד ב-decisions): נבחרה הספרייה **`virtua`** (לא TanStack-headless ולא ידני) בזכות zero-config dynamic measurement + `Virtualizer` עם `scrollRef` חיצוני. נבחר **Option B** — AppShell **נשאר owner ה-scroll** (חוק זהב #4 / redesign-2 לא מתהפך), virtua עושה windowing בתוך ה-scroll node הקיים. רמת חסינות **MVP+**: windowing + follow-via-handle + `ResizeObserver` ל-streaming + user-intent window. **hold-target (בועה גבוהה-מ-viewport) נדחה ל-future.**

## §0 — Pre-flight

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

בשיחה ארוכה (180+ בועות) ה-`{#each}` הנוכחי מחזיק את כל הבועות ב-DOM בו-זמנית → גלילה איטית/קופצנית, במיוחד בנייד. אחרי הסבב: רק הבועות שבחלון-התצוגה (+overscan) ב-DOM, הגלילה חלקה ללא תלות באורך השיחה, וההתנהגות "להידבק לתחתית כשבתחתית / לשמור מיקום כשגוללים למעלה" עובדת **גם בזמן streaming** (הבועה האחרונה גדלה) ללא קפיצות. המשתמש לא אמור להבחין בשום שינוי חוץ מ"זה מהיר עכשיו".

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| windowing של `session.bubbles` עם virtua | ✅ | הסבב |
| follow (pin לתחתית כשבתחתית) דרך virtua handle | ✅ | הסבב |
| hold (שמירת מיקום כשגוללים למעלה) | ✅ | הסבב — חינם מ-virtua (measurement-jump compensation) + ניהול דגל follow |
| re-pin בזמן streaming (`ResizeObserver`) | ✅ | הסבב |
| user-intent window (להבדיל scroll-משתמש מ-scroll-תוכניתי) | ✅ | הסבב |
| jump-to-bottom button (קיים) — חיווט מחדש למדדי virtua | ✅ | הסבב |
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
    layout/AppShell.svelte    ← owner ה-scroll. follow/hold logic עובר למדדי virtua handle:
                                isAtBottom מ-handle.getScrollOffset/Size/ViewportSize (לא DOM גולמי);
                                auto-follow = handle.scrollToIndex(last,{align:'end'});
                                + ResizeObserver (re-pin בזמן stream); + user-intent listeners.
                                כותב scrollEl ל-bridge.
    chat/ChatBubbles.svelte   ← {#each} → <Virtualizer scrollRef={bridge.scrollEl} data={bubbles}
                                getKey={b=>b.id}> ; כותב handle ל-bridge; StatusBubble+empty אחרי הרשימה.
```

**ChatScrollBridge** — אובייקט `$state` משותף (לא VM — זו UI/DOM state, לא domain entity; חוק זהב #2):
```ts
// $state object, נוצר ב-+layout, מסופק ב-context
type ChatScrollBridge = {
  scrollEl: HTMLElement | null    // נכתב ע"י AppShell (bind:this הקיים)
  handle: VirtualizerHandle | null // נכתב ע"י ChatBubbles (bind:this על Virtualizer)
}
```
> **למה גשר דו-כיווני ולא prop**: AppShell (owner ה-scroll + button + follow) ו-ChatBubbles (owner ה-Virtualizer + handle) הם **אחאים** דרך `{@render children()}`, לא יחס parent→prop ישיר. AppShell צריך את ה-handle (follow), ChatBubbles צריך את ה-scrollEl (scrollRef). גשר-`$state` ב-context הוא ה-coupling המינימלי. AppShell נשאר owner ה-scroll — virtua רק שואל אותו (`scrollRef`).

**3 הכרעות-מפתח** (מרדכי, מתועדות ב-decisions):
1. **isAtBottom ממדדי virtua, לא DOM גולמי** — תחת windowing אסור להניח ש-`scrollEl.scrollHeight` מהימן. הפונקציה הטהורה מקבלת `getScrollOffset()/getScrollSize()/getViewportSize()` מה-handle → עובד תמיד, ללא הנחות על מבנה ה-DOM של virtua.
2. **auto-follow דרך `handle.scrollToIndex(last,{align:'end'})`**, לא `scrollTop=scrollHeight` — virtua מחשב נכון גם עבור items שטרם נמדדו (anti-jump בזמן stream).
3. **`{#if bridge.scrollEl}` עוטף את ה-Virtualizer** — מונע מ-virtua ליפול ל-fallback "parent element כ-scroller" אם ה-bind טרם רץ (אחרת ה-`max-w-2xl` wrapper הופך לקונטיינר-גלילה שגוי).

## §4 — Commits בסדר

### Commit 0 — `scroll-follow.ts` פונקציה טהורה (approach: **TDD**)
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
```
**Verification**:
```bash
cd packages/frontend && pnpm vitest run src/lib/util/scroll-follow.test.ts
```
טסטים: atBottom=true כש-`scrollSize-(offset+viewport) <= margin`; atTop=true כש-`offset <= margin`; קצוות (תוכן קצר מ-viewport → גם atTop וגם atBottom); margin מותאם.

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

### Commit 2 — חיווט follow/hold למדדי virtua + ResizeObserver (approach: manual + browser)
**קבצים שמשתנים**: `AppShell.svelte`
- `checkIsAtBottom()` → משתמש ב-`chatScroll.handle` + `computeScrollEdges(...)` (Commit 0), לא DOM גולמי.
- ה-auto-follow `$effect` (שורות 66-89) → במקום `scrollEl.scrollTop = scrollEl.scrollHeight`:
  ```ts
  if (isAtBottom) chatScroll.handle?.scrollToIndex(session.bubbles.length - 1, { align: "end" })
  ```
- **ResizeObserver** על ה-content wrapper (re-pin בזמן שהבועה האחרונה גדלה): observer חדש ב-`$effect` שמחזיק את ה-node; כש-`isAtBottom` → `scrollToIndex(last,{align:'end'})`. (side-effect של scroll node = שייך ל-AppShell, חוק זהב #4.)
- `onScroll` → מעדכן `isAtBottom` מ-`computeScrollEdges`, ומנקה `hasNewBelow` כשבתחתית.

**Verification**:
```bash
# browser: /chat?mock=mitm&stream=120  → בזמן שהבועות "זורמות":
#   (א) אם בתחתית → נצמד לתחתית רציף בזמן הגדילה (לא קופץ, לא נתקע)
#   (ב) גלול למעלה תוך כדי stream → נשאר במקום, לא נגרר לתחתית; ה-JumpDown button מופיע
```

### Commit 3 — user-intent window (approach: manual + browser)
**קבצים שמשתנים**: `AppShell.svelte`
- מאזיני `wheel`/`touchstart`/`keydown` (ArrowUp/Down,PageUp/Down,Home,End,Space) על `scrollEl` → מסמנים `userIntentUntil = now + 600ms` (+ direction).
- ב-`onScroll`: רק אם `hasUserIntent()` משנים את דגל ה-follow (כלומר scroll-תוכניתי לא שובר follow). גלילה-למעלה יזומה → follow=off.
- ניקוי המאזינים ב-cleanup של ה-`$effect`.
**Verification**:
```bash
# browser: בזמן follow פעיל, scrollToIndex תוכניתי לא מכבה follow;
#   wheel-up יזום מכבה follow מיידית; חזרה ידנית לתחתית מדליק follow.
```

## §5 — DoD verifiable

| בדיקה | איך |
|---|---|
| windowing — לא כל הבועות ב-DOM | `/chat?mock=salary-attendance`; DevTools → מספר node-בועות ב-DOM ≪ סך הבועות שנטענו |
| גלילה חלקה בשיחה ארוכה | גלילה ידנית מקצה לקצה, אין jank/בועות ריקות |
| follow — pin בתחתית כשבתחתית | `&stream=120`; בתחתית → נצמד רציף בזמן זרימה |
| hold — שמירת מיקום בגלילה למעלה | גלול למעלה תוך stream → לא זז; JumpDown מופיע |
| anti-jump — תוכן מעל לא קופץ | בועת-כלי מתרחבת/תמונה נטענת מעל ה-viewport → אין קפיצה |
| scroll-תוכניתי לא שובר follow | scrollToIndex פנימי בזמן follow → follow נשאר |
| JumpDown button עובד | גלול למעלה → לחץ → חזרה לתחתית + follow on |
| טעינה ראשונית נוחתת בתחתית | `/chat?mock=greeting` → בתחתית |
| פונקציה טהורה ירוקה | `pnpm vitest run src/lib/util/scroll-follow.test.ts` |
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

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- ה-phase-check ב-Commit 1 מגלה ש-virtua **לא** מתחזק scrollHeight אמיתי **וגם** ה-handle לא נותן מדדים עקביים → שובר את הנחת ה-isAtBottom.
- מנגנון ה-`bind:this` להוצאת ה-handle ב-`virtua/svelte` שונה מהותית מ-§4 (לא רק שמות).
- ה-`max-w-2xl` centering נשבר מתחת ל-Virtualizer (scrollRef ancestor mismatch) ודורש שינוי layout ב-AppShell מעבר ל-gap.

> **לא escalation** (אומת ע"י אביגיל — סיכון אפס): windowing **אינו** פוגע ב-Speaker/replay-quiet. ה-`$effect` של ה-Speaker (`speaker.svelte.ts:151,173`) ו-`bubble-player` קוראים את `session.bubbles` (מערך ה-VM המלא), **לא** את ה-DOM. windowing משפיע רק על מה שמרונדר.
- regression ב-smart-scroll שלא ניתן לפתור בלי לשנות את חלוקת ה-ownership (Option B).

## §8 — Complexity score

- commits: 4 → סביר-גבוה
- שכבות/קבצים משותפים: context.ts + +layout + AppShell + ChatBubbles + util חדש → **גבוה**
- API חיצוני: `virtua` (+1)
- streaming/async pipeline: follow בזמן measurement אסינכרוני (+2)
- refactor של scroll/follow state: (+2)
- שינוי protocol: לא
- **Score ≈ 8/10 → `calev-heavy`** (פרוטוקול 7 שלבים — edge cases של scroll/streaming + regressions ב-smart-scroll קיים) **+ `calev mode: phase` אחרי Commit 1** (אינטגרציית virtua רגישה, חוסמת את ההמשך).

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | `startMargin` — 80px קשיח או לקרוא דינמית מה-padding? | קשיח 80 (= `pt-20`) + הערה לעדכן אם משתנה. דינמי = over-engineering | ❌ |
| 2 | hold-target (בועה גבוהה-מ-viewport) | מחוץ ל-scope (future). אם calev ימצא שזה מטריד בבועות-קוד ארוכות → slice המשך | ❌ |
| 3 | `bufferSize` (overscan px) | default של virtua (200px). virtua **אין** prop בשם `overscan` — רק `bufferSize`. כיוונון אם calev מוצא blank-on-fast-scroll | ❌ |
| 4 | להעביר את ה-follow logic כולו ל-engine נפרד (`scroll-follow-engine`)? | לא בסבב הזה — נשאר ב-AppShell (owner ה-scroll). אם יגדל מדי → refactor עתידי | ❌ |
