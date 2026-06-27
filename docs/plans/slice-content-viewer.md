# Slice content-viewer — viewer fullscreen גנרי (MVP: Markdown + תמונה) — תוכנית

> **תאריך**: 2026-06-27
> **סטטוס**: טיוטה
> **Complexity**: 4/10 (verifier: light)
> **תלות**: אין (FE-טהור — כל התוכן כבר ב-bubble model; **לא** תלוי ב-local-file-proxy)

---

## רקע והכרעת-סקופ (קרא קודם)

המקור: roadmap Track C — "content-viewer · viewer fullscreen גנרי (bits-ui `Dialog`)
פר content-type. MVP: תמונה + PDF + Markdown-מרונדר (לסוכן להציג brief/plan לאישור)".

**הכרעת-סקופ שאושרה (2026-06-27):** ה-MVP מכסה **רק תוכן שכבר נמצא ב-FE דרך ה-bubble
model** — Markdown (טקסט) ותמונה (base64). שני אלה מגיעים inline ב-ACP stream, ולכן
ה-viewer הוא **רכיב FE-טהור** בלי שום עבודת BE / הגשת-קבצים.

**מה נדחה לגל שני (gated על `local-file-proxy`):** PDF וקבצי `file://` מהדיסק. אלה
נופלים היום ל-`ToolContentOther` (raw) ודורשים BE proxy עם הכרעת-אבטחה כבדה
(LFI/path-traversal) — פריט נפרד ב-roadmap ("אחרי B"). **אל תיגע בהם בסלייס הזה.**

ה-use case המניע: המשתמשת רוצה לראות **בריפים מוכנים** בנוחות. בריף מגיע מהסוכן כ-message
markdown ארוך → בבועת-צ'אט הוא צפוף וקשה לקריאה. ה-viewer פותח אותו fullscreen.

---

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/content-viewer -b slice/content-viewer dev   # branch: slice/content-viewer | dir: .worktrees/content-viewer
cd .worktrees/content-viewer
pnpm install && pnpm hooks:install
```

### Run
- BE: לא חובה לסלייס הזה (אין נגיעת BE). אם רוצים סשן חי לבדיקת lightbox:
  `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (PORT=4000)
- FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned, Vite מדפיס)
- Typecheck/lint/test: `pnpm typecheck && pnpm lint && pnpm test`

### Browser
- Chrome רגיל מול ה-`localhost` של Vite מספיק (אין צורך ב-getUserMedia/AudioWorklet).
- בדיקת mobile: DevTools device-toolbar (fullscreen viewer חייב להיראות טוב בנייד —
  זה ה-use case העיקרי של המשתמשת).

### OneCLI agent
- שם: `voice-acp` (רק אם מריצים BE חי לבדיקת lightbox על תמונת-כלי אמיתית).

### Reading list
**must-read לפני קוד:**
- `packages/frontend/AGENTS.md` §חמשת חוקי הזהב (במיוחד #2 entity, #3 leaves, #4 owner של state)
- `packages/frontend/src/lib/components/modals/FolderPickerDialog.svelte` — **התבנית
  המדויקת** של bits-ui Dialog בפרויקט (Portal/Overlay/Content/Title/Close). העתק את
  המבנה, התאם ל-fullscreen ולתוכן.
- `packages/frontend/src/lib/util/markdown.ts` — `renderMarkdown(text): string` כבר
  מסנן (DOMPurify two-pass + KaTeX). **אל תשכפל sanitize — קרא לפונקציה הזו.**
- `packages/core/src/i18n/keys.ts` §header (הוראות הוספת מפתח — בלוק חדש בסוף)

**reference בזמן עבודה:**
- `packages/frontend/src/lib/context.ts` (הוראות הוספת VM-context תוספתי בראש הקובץ)
- `packages/frontend/src/lib/types/bubble.ts:53-60` (ה-`ToolContent` union —
  `ToolContentText`/`ToolContentImage` עם `{type:"image"; data; mimeType}`. **read-only
  ל-reference** — אליעזר לא נוגע בקובץ הזה)
- `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte:118-129` (איך
  תמונת-כלי מרונדרת היום — מכאן ייגזר ה-src ל-lightbox)
- `packages/frontend/src/lib/components/chat/bubbles/MessageBubble.svelte:60` (איך
  message markdown מרונדר — לידו ייכנס כפתור ה-expand)
- `packages/frontend/src/lib/components/chat/bubbles/bubble-rendering.ts:3`
  (`joinSegmentText(segments: Segment[]): string` — **כאן** הפונקציה, לא ב-util/)
- `packages/frontend/src/lib/view-models/modals.svelte.ts` (דוגמה ל-VM של UI-state גלובלי)

---

## §1 — מטרה

אחרי הסלייס: בכל בועת-הודעה ובכל פלט-טקסט של כלי יש כפתור "הרחב" קטן; לחיצה פותחת
דיאלוג fullscreen שמרנדר את אותו Markdown בנוחות-קריאה מלאה. לחיצה על תמונת-כלי
פותחת אותה כ-lightbox fullscreen. סגירה ב-Escape / כפתור-X / לחיצה על הרקע. זה נותן
למשתמשת דרך נוחה לקרוא בריפים ארוכים שהסוכן מציג, ומשמש מיד גם כ-lightbox לתמונות.

---

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| Dialog fullscreen גנרי (bits-ui) | ✅ | — |
| רינדור Markdown (דרך `renderMarkdown` קיים) | ✅ | — |
| תמונה fullscreen (lightbox מתמונת-כלי) | ✅ | — |
| כפתור expand על MessageBubble | ✅ | — |
| כפתור expand על tool-text (`ToolContentText`) | ✅ | — |
| **PDF** | ❌ | גל שני — gated על `local-file-proxy` |
| **`file://` / `resource_link` מהדיסק** | ❌ | גל שני — gated על `local-file-proxy` |
| **פתיחה אוטומטית ביוזמת הסוכן** (agent-triggered) | ❌ | דורש הרחבת חוזה ACP — ראה §9 שאלה 1 |
| zoom/pan על תמונה, gallery prev/next | ❌ | future — לא MVP |
| diff/terminal content ב-viewer | ❌ | לא MVP (יש להם רינדור inline ייעודי) |

> הגנת-scope: ה-executor נוטה "להוסיף עוד content-type ב-10 שורות". **כל מה שלא
> markdown/image בגל הזה — עצור.** ה-payload union נכתב כך שתוספת type עתידית היא
> שורה אחת, אבל לא בסלייס הזה.

---

## §3 — Architecture diagram

```
routes/+page.svelte ──┐ (כבר מרנדר <FolderPickerDialog/>)
AppShell.svelte ──────┴─► <ContentViewerDialog/>   ← חדש (mount ליד FolderPickerDialog)
                                  │ getContext
components/ (leaves):             ▼
  ContentViewerDialog.svelte  ← חדש  (bits-ui Dialog + renderMarkdown / <img>)
  MessageBubble.svelte        ← שינוי: כפתור expand → viewer.show({kind:"markdown",...})
  ToolBubble.svelte           ← שינוי: כפתור expand על text + click על image → viewer.show(...)

view-models/:
  content-viewer.svelte.ts    ← חדש  (ContentViewerVM: payload $state, show/close)

context.ts                    ← שינוי תוספתי: בלוק חדש get/setContentViewer בסוף

core/i18n:
  keys.ts + catalogs/he.ts + catalogs/en.ts  ← שינוי תוספתי: בלוק "content-viewer" בסוף
```

**מיקום בשכבות:** ה-VM הוא UI-state גלובלי נושא-payload — עקבי עם `ModalsVM` הקיים
(שניהם entities של UI גלובלי, חוק זהב #2). VM נפרד ולא הרחבה של `ModalsVM` כי הוא נושא
payload לא-טריוויאלי (discriminated union) + לוגיקת show-with-payload, ושמירה על
תוספתיות (אפס נגיעה ב-`modals.svelte.ts`). הרכיבים הם leaves: קוראים `getContentViewer()`
ופולטים callback בלבד (חוק זהב #3).

---

## §4 — Commits בסדר

### Commit 0 — i18n keys (approach: manual)

**קבצים שמשתנים:**
- `packages/core/src/i18n/keys.ts` — בלוק חדש **בסוף** ה-union:
  ```ts
  // ─── content-viewer ─── (slice content-viewer)
  | "contentViewer.title"
  | "contentViewer.expand"
  | "contentViewer.close"
  ```
- `packages/core/src/i18n/catalogs/he.ts` — בלוק תואם בסוף:
  ```ts
  // ─── content-viewer ─── (slice content-viewer)
  "contentViewer.title": "תצוגה",
  "contentViewer.expand": "הרחב",
  "contentViewer.close": "סגור",
  ```
- `packages/core/src/i18n/catalogs/en.ts` — בלוק תואם בסוף (placeholder אנגלי):
  ```ts
  // ─── content-viewer ─── (slice content-viewer)
  "contentViewer.title": "View",
  "contentViewer.expand": "Expand",
  "contentViewer.close": "Close",
  ```

**Verification:**
```bash
pnpm typecheck   # MessageKey union שלם → catalogs חייבים לכסות, אחרת אדום
pnpm test
```

### Commit 1 — ContentViewerVM + context wiring (approach: manual)

**קבצים חדשים:**
- `packages/frontend/src/lib/view-models/content-viewer.svelte.ts`

**API skeleton (חתימה מחייבת — executor לא משנה):**
```ts
/** payload להצגה ב-ContentViewer. discriminated union — תוספת type עתידית = ענף חדש. */
export type ViewerPayload =
  | { kind: "markdown"; text: string; title?: string }
  | { kind: "image"; src: string; alt?: string }

/**
 * ContentViewerVM — UI-state גלובלי של הדיאלוג fullscreen.
 * Entity: UI גלובלי נושא-payload (עקבי עם ModalsVM, חוק זהב #2).
 */
export class ContentViewerVM {
  payload = $state<ViewerPayload | null>(null)
  get open(): boolean { return this.payload !== null }
  show(payload: ViewerPayload): void { this.payload = payload }
  close(): void { this.payload = null }
}
```

**קבצים שמשתנים:**
- `packages/frontend/src/lib/context.ts` — בלוק תוספתי **בסוף** הקובץ (+ import ב-type block):
  ```ts
  // ─── content-viewer ─── (slice content-viewer)
  export const [getContentViewer, setContentViewer] = createContext<ContentViewerVM>()
  ```
- composition root: **`packages/frontend/src/routes/+layout.svelte:132`** (ליד
  `setModals(modals)` — מאומת ע"י אביגיל). הוסף `setContentViewer(new ContentViewerVM())`
  לידו (+ ה-import של `ContentViewerVM`). אמת ב-`grep -rn "setModals(" packages/frontend/src`.

**Verification:**
```bash
pnpm typecheck
grep -rn "setContentViewer(" packages/frontend/src   # חייב להופיע בדיוק פעם אחת ב-composition root
```

### Commit 2 — ContentViewerDialog component (approach: manual)

**קבצים חדשים:**
- `packages/frontend/src/lib/components/modals/ContentViewerDialog.svelte`

**מבנה (העתק את שלד bits-ui מ-`FolderPickerDialog.svelte:156-257`, התאם):**
- `getContentViewer()` ו-`getI18n().t` בלבד (leaf — אין fetch, אין actions).
- `<BitsDialog.Root open={viewer.open} onOpenChange={(o) => { if (!o) viewer.close() }}>`
- Portal + Overlay (`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm`)
- Content: **fullscreen** — `fixed inset-0 z-50 flex flex-col` עם `max-w` רחב יותר
  מ-FolderPicker (למשל `max-w-3xl mx-auto w-full`) ו-`max-height:100dvh`.
- Header: Title (`t("contentViewer.title")` או `payload.title` כשקיים) + `BitsDialog.Close`
  עם `XIcon` (`aria-label={t("contentViewer.close")}`).
- Body — `flex-1 overflow-y-auto chat-scroll px-4 py-3`:
  ```svelte
  {#if viewer.payload?.kind === "markdown"}
    <!-- אותו מסלול מסונן כמו MessageBubble — renderMarkdown מסנן DOMPurify two-pass -->
    <div class="markdown-body" dir="auto">{@html renderMarkdown(viewer.payload.text)}</div>
  {:else if viewer.payload?.kind === "image"}
    <!--
      Invariant אבטחה (זהה ל-ToolBubble:120): תמונה מוצגת **רק** דרך <img>.
      אסור {@html}/<object> — SVG ב-<img> רץ ב-secure-static-mode.
    -->
    <img class="viewer-image" src={viewer.payload.src} alt={viewer.payload.alt ?? t("contentViewer.title")} />
  {/if}
  ```

**Verification:**
```bash
pnpm typecheck && pnpm lint
```

### Commit 3 — mount + triggers wiring (approach: manual + browser smoke)

**קבצים שמשתנים:**
- `packages/frontend/src/lib/components/layout/AppShell.svelte` — הוסף
  `import ContentViewerDialog ...` (ליד יבוא FolderPickerDialog, שורה ~31) ו-
  `<ContentViewerDialog />` ליד `<FolderPickerDialog />` (שורה ~345). *(בדוק אם צריך
  גם ב-`routes/+page.svelte:236` — חקה את מה ש-FolderPicker עושה; אם מופיע בשניהם →
  הוסף בשניהם, אם רק ב-AppShell → רק שם.)*
- `packages/frontend/src/lib/components/chat/bubbles/MessageBubble.svelte` —
  `getContentViewer()`; כפתור expand קטן (אייקון מ-`@lucide/svelte/icons/maximize-2`)
  בפינת הבועה → `viewer.show({ kind: "markdown", text: joinSegmentText(bubble.segments) })`.
  `joinSegmentText` כבר מיובא ב-MessageBubble מ-`"./bubble-rendering"` (אותה ספרייה — אל
  תוסיף import מ-util/). `aria-label={t("contentViewer.expand")}`.
- `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte` —
  `getContentViewer()`; (א) על `ToolContentText` — כפתור expand →
  `viewer.show({ kind: "markdown", text: c.text })`; (ב) על `c.type === "image"` —
  עטוף את ה-`<img>` ב-`<button>` (או `onclick` + role) →
  `viewer.show({ kind: "image", src: \`data:${c.mimeType};base64,${c.data}\` })`.
  השאר את ה-`<img>` ה-inline הקיים — ה-lightbox הוא **בנוסף**, לא במקום.

**Verification (browser smoke — ה-feedback loop האמיתי, לא JSDOM):**
```bash
pnpm --filter @drive-coding/frontend dev
# בדפדפן:
# 1. בועת message עם markdown → לחיצה על expand → דיאלוג fullscreen, markdown מרונדר נכון
# 2. Escape סוגר; לחיצה על הרקע סוגרת; X סוגר
# 3. (עם BE חי) תמונת-כלי → לחיצה → lightbox fullscreen
# 4. mobile viewport (DevTools) → fullscreen נראה טוב, גלילה עובדת
pnpm typecheck && pnpm lint && pnpm test
```

---

## §5 — DoD verifiable

| בדיקה | איך |
|---|---|
| `pnpm typecheck` ירוק | הרצה |
| `pnpm lint` + `pnpm lint:i18n` ירוקים (אין עברית בקוד) | הרצה |
| `pnpm test` ירוק | הרצה |
| כפתור expand על message → fullscreen markdown | browser, בועת message |
| כפתור expand על tool-text → fullscreen markdown | browser, כלי עם פלט טקסט |
| click על תמונת-כלי → lightbox fullscreen | browser + BE חי |
| Escape / רקע / X — שלושתם סוגרים | browser |
| נסגר → `viewer.payload === null` (אין דליפת state) | browser, פתח/סגור 3× |
| mobile viewport — fullscreen קריא, גלילה תקינה | DevTools device-toolbar |
| markdown של `<span style>` גולמי **לא** עובר (sanitize) | browser — בריף עם `<span style="...">` נשאר טקסט/מנוקה |
| `<ContentViewerDialog/>` מותקן פעם אחת בכל mount-point של FolderPicker | grep + הרצה |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| שכפול sanitize → פרצת XSS | learnings (latex-math two-pass) | **חובה** `renderMarkdown` הקיים — אסור DOMPurify/marked ידני חדש ב-viewer |
| תמונה דרך `{@html}`/`<object>` → SVG scripting | ToolBubble:120-123 invariant | תמונה **רק** דרך `<img src>`; הערת-invariant בקוד |
| Hardcoded Hebrew → pre-commit hook חוסם | README §6 | כל מחרוזת → `t("contentViewer.*")` (Commit 0 קודם) |
| Svelte 5 reactivity — payload לא מעדכן | README §6 #2 | `payload = $state(...)`; `open` getter נגזר; דיאלוג מאזין ל-`viewer.open` |
| body-scroll / focus-trap / Escape | bits-ui Dialog | מובנה ב-bits-ui (כמו FolderPicker) — אל תממש ידנית |
| נגיעה בקובץ shared (context/keys/MessageBubble/ToolBubble) במקביל לסלייס אחר | `docs/conventions/parallel-safe-code.md` | הכל **תוספתי** — בלוקים חדשים בסוף, כפתור נוסף ליד קיים, אפס עריכת בלוק קיים |
| double-mount (AppShell + +page) → שני דיאלוגים | תבנית FolderPicker מופיעה בשניהם | חקה **בדיוק** את FolderPicker. אין double-overlay: `+page.svelte` (מסך connect) **לא** עטוף ב-AppShell (comment ב-+page.svelte:235), כך ששני ה-mount-points הם מסכים בלעדיים — connect ו-chat לעולם לא מרונדרים יחד |

---

## §7 — Escalation triggers (עצור ושאל את מרדכי ב-parent task)

- `renderMarkdown` לא נותן פלט תקין על בריף אמיתי באופן שמרמז על באג ב-markdown.ts
  (לא לתקן את markdown.ts בסלייס הזה — זה משטח משותף עם latex/bidi/invisibles).
- bits-ui Dialog לא תומך fullscreen / focus-trap נשבר במצב fullscreen.
- מתברר שצריך agent-triggered auto-open כדי ש"להציג בריף" יעבוד (ראה §9.1) — זו
  הרחבת-חוזה, **לא** בסלייס הזה.
- FolderPicker מותקן ביותר ממקום אחד ולא ברור איפה למקם → שאל לפני duplicate.

---

## §8 — Complexity score + verifier

- commits: 4 (סביר)
- שכבות חדשות: 2 (VM + component) — בינוני-נמוך
- API חיצוני: 0
- streaming/async: 0
- state-model refactor: 0
- protocol BE↔FE: 0
- security-sensitive (markdown/image) — מכוסה ע"י reuse של `renderMarkdown` + invariant `<img>`

**Score: 4/10 → verifier `light`** (כלב, mode: light). הבדיקה האמיתית היא runtime
בדפדפן (visual fullscreen + mobile), לא inference — light מתאים.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | **agent-triggered auto-open** — האם הסוכן צריך לפתוח את ה-viewer מיוזמתו (לדחוף brief לאישור), או מספיק שהמשתמשת פותחת ידנית (expand)? | **ידני (expand)** ל-MVP. auto-open דורש הרחבת חוזה ACP (content-type/tool ייעודי) — סלייס נפרד אחרי שמבינים מה claude/opencode שולחים על ה-wire. | ❌ לא חוסם — MVP שלם בלי זה |
| 2 | מיקום כפתור expand — פינת הבועה תמיד, או רק בריחוף (hover)? | תמיד-נראה קטן ועמום; נייד אין hover. | ❌ |
| 3 | האם expand גם על `ThoughtBubble`? | לא ל-MVP (מחשבות בד"כ קצרות; פותחים על message+tool בלבד). | ❌ |
| 4 | רוחב מקסימלי ב-desktop — `max-w-3xl` או רחב יותר לבריפים עם טבלאות/קוד? | `max-w-3xl`; אם בריף עם טבלאות-רחבות נחתך → להגדיל בגל הבא. | ❌ |
