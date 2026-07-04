# Slice image-paste — הדבקת/גרירת/בחירת תמונות בתיבת הפרומפט — תוכנית

> **תאריך**: 2026-06-28 (עודכן 2026-07-04 — Commit 5 §11 הושלם)
> **סטטוס**: ✅ **הושלם** — Commits 0–5 בוצעו. Commit 5 (§11): תיקון replay gate; #appendUserImage; 7 טסטים TDD ירוקים. branch `slice/image-paste` @ `c6a48e5`. ממתין לאימות calev-heavy + merge.
> **Complexity**: 8/10 (verifier: **calev-heavy**)
> **תלות (depends_on)**: `[]` — כל התלויות מוזגו ל-dev. (`slice-input-autogrow` מוזג `b3b5140` — TypeArea שונה, ראה §3.5. Track-A נספג ל-`packages/provider/` בקוד שלנו.)
>   - ⚠️ **תיאום merge (רך, לא depends_on)**: `slice-warm-reattach-skip-init` (סשן אחר) נוגע גם הוא ב-`packages/provider/src/client/client.ts` (מחלץ `buildAcpClientFacade`). שניהם מבוססים על dev ושניהם נוגעים במתודת `prompt`/ה-facade. מי שממזג שני — יְיַשם מחדש את שינויו ב-facade (אולי) המרוענן. ראה §6.
> **Base**: `dev` HEAD (`0ad8ed3` — 2026-07-01; ה-branch/worktree של Commits 0–3 נוקו אחרי merge → **צור worktree טרי על dev הנוכחי**)
> **⚠️ MERGE-GATE (עודכן 2026-06-28 — kill-switch)**: ה-feature מוגן ב-**דגל קשיח `IMAGE_INPUT_ENABLED = false`** (Commit 2). כל עוד הוא `false`, `supportsImageInput` מחזיר `false` **תמיד** — ללא תלות במה שהספק מדווח → כל הלכידה רדומה לחלוטין, אפס שינוי-התנהגות. לכן:
>   - **Commits 0–3 בטוחים ל-merge מיד** (פיגום רדום; הדגל false). אין צורך בבדיקת-runtime של capability — הדגל כופה.
>   - **Commit 4** (שליחה מולטימודלית) הופך את הדגל ל-`true`, **מרחיב את `AcpClient.prompt` לקבל blocks** (client.ts — בבעלותנו), ומחווט. **כל החסמים סגורים** — הכרעת-gating §10 נעולה (raw), track-A נספג.
>   - ההחלטה (המשתמשת, 2026-06-28): כופים `false` במקום לבדוק מה הספק מדווח. flip ל-`true` = שורה אחת, יחד עם Commit 4.
>   - **gating אחרי flip = raw** (הכרעת §10): `supportsImageInput` קורא `#client.capabilities.promptCapabilities.image` — הערך האמיתי פר-סוכן מ-`initialize`, לכל הספקים.

---

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/slice-image-paste -b slice/image-paste dev
cd .worktrees/slice-image-paste
pnpm install && pnpm hooks:install
```

### Run
- **FE מספיק** לרוב ה-slice (לכידה/preview/דחיסה/gating — FE-טהור):
  `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned, Vite מדפיס)
- **BE דרוש רק לאימות חי end-to-end של Commit 4** (אחרי שהחוזה ירד) —
  `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000)
- בדיקות:
  ```bash
  pnpm --filter @drive-coding/core test          # Commit 0 (TDD)
  pnpm --filter @drive-coding/frontend typecheck
  pnpm --filter @drive-coding/frontend build      # adapter-static — prod build
  pnpm lint:i18n                                   # אין מחרוזות עברית קשיחות
  ```

### Browser
- אין DISPLAY במכונה → linux-gui Chrome :9222.
  `playwright-cli -s=vacp attach --cdp=http://localhost:9222` (תמיד `-s=vacp`).
- בדיקת UI בלי BE: `/chat?mock=greeting` (reload מלא, לא ניווט SPA) — מספיק ל-tray/preview/gating.
- ⚠️ **clipboard image paste** דורש secure-context — `localhost`/HTTPS בלבד (זהה ל-getUserMedia, ר' AGENTS.md).

### OneCLI agent
- **לא דרוש** ל-Commits 0–3. דרוש (`voice-acp`) רק לאימות-החי של Commit 4.

### Reading list
**must-read לפני**:
- `packages/frontend/AGENTS.md` — חמשת חוקי הזהב (במיוחד #4 effect-ownership, #5 אין-תאימות-לאחור).
- `docs/design-principles.md` §1-2 — מה זה "engine" מול "view-model" (הדחיסה = engine; ה-tray = state ב-VM/component).
- `packages/frontend/src/lib/components/chat/TypeArea.svelte` — **כל הקובץ (229 שורות — Commit 2 של הסלייס הזה כבר מוזג!).** מכיל כבר: autogrow (`$effect` L34-40, `taEl`, `rows={1}`+`max-height`, `items-end`), **וגם** tray+handlers+gating מ-Commit 2 (`attachments` L30, `handlePaste` L67, `handleDrop` L94, `handleFileChange` L108, `removeAttachment` L123, tray-UI L137-159, כפתור-הוספה L180-192). Commit 4b **משנה רק** את `onSubmit` (L46-53) וכפתור Send (L220) — ראה §4b. **לא ליצור מחדש** את ה-tray/handlers.
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `sendPrompt` **בשורה 671** (לא 565 — 565 הוא `attach`); guard `if (!text.trim()) return` **בשורה 674**; קריאת `this.#client.prompt(this.#sessionId, text)` **בשורה 693**; getter `supportsImageInput` **בשורה 137**; `IMAGE_INPUT_ENABLED` **בשורה 46**; `#client`/`capabilities`.
- `packages/frontend/src/lib/types/bubble.ts` §30-41 (`UserBubble`).

**reference בזמן עבודה**:
- `docs/plans/ui-feature-backlog.md` §3a + §5 ("attachments מלא" — reference CodeNomad `composer.tsx`: drag-drop+paste+דחיסה ≤8MB/JPEG/2048px).
- `docs/conventions/parallel-safe-code.md` — **רק אם** נוגעים ב-`packages/core/src/i18n/keys.ts` / `catalogs/*` (מחרוזות tray).
- **Contract/client types — עכשיו בקוד שלנו** (החבילה נספגה v0.8.0): `packages/provider/src/client/client.ts` — `AcpClient.prompt` (שורה 57 type, 189-190 impl; היום `text: string`), `capabilities` (שורה 46 = raw `agentCapabilities`). ה-image-block הוא ContentBlock סטנדרטי של `@agentclientprotocol/sdk` (`{type:"image", mimeType, data}`, data=base64 גולמי). ⚠️ **אין יותר** git-dep/`.pnpm` symlink — התעלם מהפניות ישנות ל-`provider-contract`.

---

## §1 — מטרה
כשהמשתמש רוצה לשלוח תמונה ל-agent — הוא יכול **להדביק** (Ctrl/Cmd+V), **לגרור-ולשחרר**, או **לבחור קובץ** (כפתור + `capture` בנייד) לתוך תיבת הפרומפט. התמונה מופיעה כ-**thumbnail preview** מעל/ליד ה-textarea, ניתנת להסרה, ונדחסת אוטומטית (≤2048px, JPEG, ≤8MB) לפני שליחה. בלחיצת שלח — הטקסט + התמונות נשלחים יחד כ-`PromptContent` מולטימודלי, והבועה האופטימית של המשתמש מציגה את התמונה ששלח. אם ה-agent הנוכחי **לא** מצהיר `promptCapabilities.image` — לכידת התמונות מושבתת (לפי חובת ה-spec).

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| paste תמונה מה-clipboard | ✅ | הסבב הזה |
| drag-drop קובץ-תמונה לתיבה | ✅ | הסבב הזה |
| file-picker (כפתור + `capture` נייד) | ✅ | הסבב הזה |
| preview כ-thumbnail + הסרה | ✅ | הסבב הזה |
| דחיסה אוטומטית (resize≤2048px, JPEG, ≤8MB) | ✅ | הסבב הזה |
| capability gating (`promptCapabilities.image`) | ✅ | הסבב הזה |
| שליחת `PromptContent[]` מולטימודלי | ✅ (Commit 4b) | הסבב הזה |
| רינדור התמונה בבועת-המשתמש האופטימית | ✅ (Commit 4b) | הסבב הזה |
| **הרחבת `AcpClient.prompt` לקבל blocks** | ✅ (Commit 4a) | הסבב הזה — החבילה בבעלותנו |
| הדבקת **קבצים לא-תמונה** (PDF/טקסט) כ-`resource` | ❌ | slice attachments-files עתידי |
| draft persistence (טיוטה+attachments בין sessions) | ❌ | backlog (CodeNomad `instance-shell2`) |
| `@` mentions / slash / shell-mode | ❌ | slices נפרדים (slash תלוי-חוזה) |
| רינדור `resource_link`+`file://` כתמונה | ❌ | `local-file-proxy` (roadmap) |

## §3 — Architecture diagram

```
┌─ routes ──────────────────────────────────────────────────────┐
│  (ללא שינוי)                                                    │
├─ components ──────────────────────────────────────────────────┤
│  chat/TypeArea.svelte   ← onpaste + ondrop + file-input        │
│                            + attachment tray (thumbnails+remove)│
│                            + gating (session.supportsImageInput)│
│  chat/bubbles/UserBubble.svelte ← רינדור תמונות הבועה (Commit 4)│
├─ view-models ─────────────────────────────────────────────────┤
│  agent-session.svelte.ts ← get supportsImageInput (derived)    │
│                            sendPrompt(text, {attachments}) ←Commit4│
│                            UserBubble.attachments[] (Commit 4)  │
├─ engines ─────────────────────────────────────────────────────┤
│  engines/image-attachment.ts  ← חדש: דחיסה (canvas) + base64    │
├─ adapters ────────────────────────────────────────────────────┤
│  (ללא שינוי — ACP client מ-provider-contract)                  │
└───────────────────────────────────────────────────────────────┘
┌─ core (packages/core) ────────────────────────────────────────┐
│  src/image/resize-plan.ts  ← חדש: חישוב טהור (TDD), אין browser │
└───────────────────────────────────────────────────────────────┘
BE: אפס שינוי (bridge-manager dumb-pipe שקוף).
```

## §3.5 — [היסטורי] שינוי TypeArea אחרי autogrow

> 🟢 **הערה 2026-07-01**: הסעיף הזה + Commit 2 למטה **כבר מוזגו** (Commits 0–3, `2cdb85a`).
> ה-line-refs כאן (79 שורות, L18/L21-28...) **מיושנים** — TypeArea עכשיו **229 שורות** וכבר מכיל
> את הכל. הסעיף נשמר להקשר בלבד. **ל-Commit 4b השתמש ב-line-refs של §4b / §0**, לא כאן.

> **למה הסעיף הזה קיים**: ה-brief המקורי נכתב מול TypeArea בן 67 שורות. בינתיים מוזג
> `slice-input-autogrow` (`b3b5140`) ששינה את אותו קובץ. ה-brief רוענן, אבל ה-executor
> חייב לראות את המצב הנוכחי לפני שהוא "משכתב את כל הקובץ".

**מה autogrow הוסיף ל-`TypeArea.svelte` (79 שורות עכשיו):**
| מה | היכן | למה אסור לדרוס |
|----|------|----------------|
| `let taEl = $state<HTMLTextAreaElement>()` + `bind:this={taEl}` | L18, L48 | ה-handle שה-$effect צריך |
| `const MAX_ROWS = 6` | L19 | תקרת-גובה |
| `$effect` (מאפס height→auto, מציב scrollHeight) | L21-28 | **לב ה-autogrow** — תלוי ב-`promptText` |
| `rows={1}` (היה `rows={2}`) | L51 | גובה בסיס |
| `max-height: calc(MAX_ROWS*1.5em+1.25rem)` + `overflow-y:auto` | L54 (inline style) | התקרה + scroll |
| `<form class="… items-end …">` (היה `items-stretch`) | L45 | Send בגובה טבעי |

**ההשלכה ל-Commit 2:**
1. **ה-tray חי מחוץ ל-`<form>`** — עטוף את ה-`<form>` הקיים ב-container אנכי ושים את ה-tray
   מעליו (ראה הערת §Commit 2 ד). אל תכניס thumbnails כ-sibling של ה-textarea בתוך ה-form
   (ישבור `items-end` + גדילת-הגובה).
2. **`promptText = ""` ב-`onSubmit`** (L39) הוא מה שמכווץ את ה-textarea חזרה דרך ה-$effect.
   Commit 4 שמרחיב את `onSubmit` (ניקוי tray) — **להוסיף** אחרי, לא להחליף את ניקוי ה-`promptText`.
3. **onpaste של תמונה** לא אמור לשנות `promptText` → לא יגרום לגדילה (טוב). onpaste של **טקסט**
   ממשיך כרגיל (Verification §5) ומפעיל autogrow — זה תקין.

## §4 — Commits

> 🟢 **מצב 2026-07-01**: **Commits 0, 1, 2, 3 כבר מוזגו ל-dev** (`2cdb85a`, calev-heavy GO). הם למטה
> **להקשר בלבד** — אל תבצע אותם מחדש. **העבודה שנותרה = Commit 4a + Commit 4b בלבד.** דלג ישר אליהם.

### Commit 0 — `resize-plan` חישוב טהור (approach: **TDD**)
**קובץ חדש**: `packages/core/src/image/resize-plan.ts` (+ייצוא ב-`packages/core/src/index.ts`)
**קובץ test**: `packages/core/src/image/resize-plan.test.ts`

> **למה core/TDD**: זו מתמטיקה טהורה (scale-to-fit), input/output ידועים מראש — בדיוק המקרה של README §1 ל-TDD. ⚠️ **אסור browser globals ב-core** (AGENTS.md "No browser globals") — לכן ה-**החלטה** כאן טהורה; ה-canvas-encoding בפועל ב-engine (Commit 1).

**API skeleton**:
```ts
export type ResizePlan = {
  targetWidth: number
  targetHeight: number
  /** האם בכלל לקודד-מחדש (אם מתחת לכל הסיפים — אפשר לשלוח as-is) */
  shouldReencode: boolean
}
export function planResize(
  src: { width: number; height: number; bytes: number; mimeType: string },
  limits?: { maxDim?: number; maxBytes?: number },  // ברירת מחדל: 2048, 8*1024*1024
): ResizePlan
```
**מקרי-טסט חובה**: תמונה קטנה מתחת לכל הסיפים → `shouldReencode:false`, מימדים ללא שינוי · רוחב 4096 → scale ל-2048 (יחס נשמר, גובה מתכווץ פרופורציונלי) · גובה > רוחב → המימד הגדול נקבע ל-maxDim · bytes>maxBytes אך מימדים קטנים → `shouldReencode:true` (לכווץ איכות) · mimeType כבר `image/jpeg` קטן → no-op · עיגול מימדים ל-int.

**Verification**: `pnpm --filter @drive-coding/core test` (ירוק) · `pnpm --filter @drive-coding/core typecheck`.

---

### Commit 1 — `image-attachment` engine (approach: **manual** — integration ב-browser)
**קובץ חדש**: `packages/frontend/src/lib/engines/image-attachment.ts`

> **למה engine ולא core**: משתמש ב-`createImageBitmap`/`OffscreenCanvas`/`canvas.toBlob` (browser-only). ה-engine *צורך* את `planResize` מ-core.

**API skeleton**:
```ts
export type ImageAttachment = {
  id: string
  mimeType: string        // אחרי דחיסה: בד"כ "image/jpeg"
  dataBase64: string      // base64 ללא prefix data: (כפי ש-ACP ImageContent מצפה)
  previewUrl: string      // object URL ל-thumbnail
  bytes: number
}
/** מקבל File/Blob (מ-paste/drop/picker), דוחס לפי planResize, מחזיר attachment. */
export async function fileToImageAttachment(file: File | Blob): Promise<ImageAttachment>
/** שחרור ה-object URL (קריאה ב-onremove ו-onsend). */
export function revokeAttachment(a: ImageAttachment): void
```
**הערות**:
- אם `planResize.shouldReencode === false` — עדיין צריך base64 מה-blob המקורי (אין re-encode, רק קידוד).
- mimeType לא-נתמך (לא `image/*`) → לזרוק/להחזיר שגיאה; ה-caller (Commit 2) מתעלם בשקט.
- **לא** לשמור `File` ארוך-טווח — רק את ה-`dataBase64`+`previewUrl`.

**Verification**: `typecheck` ירוק · בדיקת-עשן ב-browser console: `fileToImageAttachment` על תמונה גדולה → `bytes` קטן יותר, `mimeType:"image/jpeg"`.

---

### Commit 2 — TypeArea: לכידה + tray + gating (approach: **manual** — browser smoke)
**קבצים שמשתנים**:
- `packages/frontend/src/lib/components/chat/TypeArea.svelte` — onpaste/ondrop/file-input + tray UI.
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — getter `supportsImageInput` בלבד (additive).
- **i18n ב-`packages/core/`** (לא ב-frontend — אין שם תיקיית i18n): `packages/core/src/i18n/keys.ts` (הצהרת מפתחות) + `packages/core/src/i18n/catalogs/he.ts` + `packages/core/src/i18n/catalogs/en.ts` (תרגומים) — מחרוזות חדשות (additive, ר' parallel-safe-code).

**(א) VM — getter נגזר + kill-switch** (ב-`AgentSession`, additive):
```ts
// 🔒 kill-switch — נשאר false עד Commit 4b (שליחה מולטימודלית). Commit 4b הופך ל-true.
// כל עוד false: supportsImageInput=false תמיד → לכידת-התמונה רדומה לחלוטין,
// ללא תלות במה שהספק מדווח. Commit 4 הופך ל-true. (module-level const בראש הקובץ.)
const IMAGE_INPUT_ENABLED = false

// בתוך class AgentSession:
get supportsImageInput(): boolean {
  return IMAGE_INPUT_ENABLED && this.#client?.capabilities?.promptCapabilities?.image === true
}
```
> `#client.capabilities` = `agentCapabilities` מ-`initialize()` (כבר נחשף ב-`AcpClient`, client.d.ts). **חובת-spec**: בלי image-capability — אין לכידה.
> **למה הדגל**: הופך את merge של Commits 0–3 מ"מותנה בבדיקת-runtime" ל"בטוח בוודאות". גם אם ספק מדווח `image:true` בטעות בעוד `AcpClient.prompt` text-only — הדגל כופה `false` ומונע כשל-שקט (משתמש מצרף תמונה ושולח לחלל). הדגל הוא `const` module-level (לא env/build-flag — פשטות; flip ידני ב-Commit 4).

**(ב) TypeArea — state מקומי** (`$state`):
```ts
let attachments = $state<ImageAttachment[]>([])
let fileInputEl = $state<HTMLInputElement>()
```
⚠️ **Svelte 5 reactivity על array** (learnings): שינוי דרך השמה (`attachments = [...attachments, a]` / `.filter`), לא mutation, ו-`{#each attachments as a (a.id)}` עם key.

**(ג) handlers**: `onpaste` (קורא `e.clipboardData.items`, מסנן `kind==="file" && type.startsWith("image/")`), `ondrop`+`ondragover.preventDefault`, ו-`onchange` ל-`<input type="file" accept="image/*" capture>`. כולם → `fileToImageAttachment` → push ל-`attachments`. כפתור הוספה (אייקון `Paperclip`/`ImagePlus`) פותח את ה-input. **gating — ברמת-handler, לא רק אייקון** (finding אביגיל r5): **כל** handler (`onpaste`/`ondrop`/`onchange`) פותח ב-`if (!session.supportsImageInput) return` — early-return **לפני** עיבוד ה-items. כך גם אם הדגל יידלק בעתיד וספק ספציפי חסר capability, הלכידה חסומה בכל הנתיבים, לא רק שהאייקון מוסתר. ⚠️ `onpaste` של תמונה כשהגטר false → return מוקדם → ה-paste הטקסטואלי הדיפולטי של ה-textarea ממשיך כרגיל (לא לעשות `preventDefault` בנתיב ה-return).

**(ד) tray UI**: שורת thumbnails **מעל** ה-textarea, כל אחד עם כפתור-הסרה (`revokeAttachment` + filter). i18n לכל מחרוזת.
> ⚠️ **אינטראקציה עם autogrow** (ראה §ייעודי): ה-textarea **גדל אנכית** עד 6 שורות. ה-tray חייב לשבת מחוץ ל-`<form class="flex items-end">` הקיים — עטוף את `<form>` ב-container אנכי (`<div class="flex flex-col gap-1">` או דומה) ושים את ה-tray מעל ה-form, כדי שגדילת ה-textarea לא תזיז/תמחץ את ה-thumbnails ולא תשבור את `items-end`. **אל תכניס את ה-tray כ-sibling של ה-textarea בתוך ה-form** — זה ישבור את ה-layout של autogrow.

**אסור לשנות** (כולל מה ש-slice-input-autogrow הוסיף):
- `onkeydown` (enter-toggle, **L55-67** אחרי autogrow — לא L43-55) — את לוגיקת ה-Enter/Shift/Cmd.
- `onSubmit` הקיים (L34-40; Commit 4 ירחיב אותו, לא משכתב). ⚠️ הוא מסתיים ב-`promptText = ""` — זה מה שמפעיל את ה-autogrow $effect לכווץ חזרה. אל תסיר.
- לוגיקת ה-`isDisabled` (L30-32).
- **autogrow** (slice-input-autogrow): ה-`$effect` (L21-28), `taEl` + `bind:this={taEl}` (L18,L48), `MAX_ROWS` (L19), `rows={1}` (L51), ו-`max-height`/`overflow-y` ב-style (L54), ו-`items-end` ב-`<form>` (L45). אלה חיים — **לא לדרוס בעת השכתוב של "כל הקובץ".**

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck && pnpm --filter @drive-coding/frontend build && pnpm lint:i18n
# browser (linux-gui :9222), /chat?mock=greeting:
#  1. paste תמונה → thumbnail מופיע ב-tray
#  2. drag-drop קובץ-תמונה → thumbnail מופיע
#  3. כפתור picker → בחירת קובץ → thumbnail
#  4. הסרה → ה-thumbnail נעלם, object URL משוחרר
#  5. paste של טקסט רגיל → נכנס ל-textarea כרגיל (לא נשבר)
#  6. mock ללא image-capability → אייקון הלכידה מוסתר/disabled
```
> ⚠️ **בדיקת Commit 2 עם ה-kill-switch**: כל עוד `IMAGE_INPUT_ENABLED = false`, הלכידה
> **מוסתרת תמיד** — אי-אפשר לראות tray/paste. כדי לבדוק חי את צעדים 1-5, **הפוך זמנית
> את הדגל ל-`true` מקומית** (+mock עם `promptCapabilities.image:true`), בדוק, ו**החזר
> ל-`false` לפני ה-commit**. צעד 6 (גטינג) נבדק עם הדגל true + mock **בלי** capability.
> ⚠️ **DoD חובה**: ה-commit של Commit 2 חייב להישמר עם `IMAGE_INPUT_ENABLED = false`.

---

### Commit 3 — רינדור תמונות בבועת-המשתמש (approach: **manual** — visual)
**קבצים שמשתנים**:
- `packages/frontend/src/lib/types/bubble.ts` — `UserBubble.attachments?: { mimeType: string; dataBase64: string }[]` (additive, optional — לא שובר בועות קיימות).
- `packages/frontend/src/lib/components/chat/bubbles/UserBubble.svelte` — רינדור `<img>` מ-`data:` URL לכל attachment.

> מופרד מ-Commit 4 כי הוא **FE-טהור ובְּן-ביצוע עכשיו** (מודל+רינדור), בלי תלות בחוזה. ה-wiring שמאכלס את `attachments` הוא Commit 4.

**Verification**: typecheck+build · ב-browser, בועת-משתמש עם `attachments` (mock) מציגה תמונה.

---

### Commit 4 — שליחה מולטימודלית (approach: **manual**) — **עצמאי (כל החסמים סגורים)**
> החוזה בבעלותנו (`packages/provider/`). Commit 4 מפוצל לשני sub-steps: **4a** (provider — הרחבת `prompt`) → **4b** (FE — flip + wiring). 4b תלוי ב-4a.

---

#### Commit 4a — provider: הרחבת `AcpClient.prompt` ל-blocks (approach: **TDD** — provider test)
**קובץ**: `packages/provider/src/client/client.ts` (חתימה **שורה 57** + מימוש **שורות 189-190**).

**מצב נוכחי (נמדד 2026-07-01)**:
```ts
// type (57):
prompt(sessionId: string, text: string): ReturnType<ClientSideConnection["prompt"]>
// impl (189-190):
async prompt(sessionId: string, text: string) {
  return conn.prompt({ sessionId, prompt: [{ type: "text", text }] })
}
```
> ה-layer התחתון `conn.prompt` (`@agentclientprotocol/sdk`) **כבר** מקבל `ContentBlock[]` מלא (כולל image). ההרחבה = לתת ל-facade לקבל blocks ולהעביר כמו-שהם, תוך שמירת התאימות-לאחור לחתימת ה-string.
> ✅ **מאומת מול SDK המותקן 0.21.1** (`node_modules/.pnpm/@agentclientprotocol+sdk@0.21.1_.../dist/schema/types.gen.d.ts`, 2026-07-01 — זה ה-SDK ש-client.ts מייבא, provider/package.json:23):
> - `ClientSideConnection.prompt(params: PromptRequest)` (`acp.d.ts:446`) → `PromptRequest.prompt: Array<ContentBlock>` (`types.gen.d.ts:3383`).
> - `ContentBlock` union כולל image: `ImageContent & { type: "image" }` (`:840-841`).
> - `ImageContent = { data: string; mimeType: string; annotations?; _meta?; uri? }` (`:1760-1775`) → הבלוק `{ type: "image", mimeType, data }` **תקף** (data+mimeType חובה, שאר optional).
> - `PromptCapabilities.image` קיים (`:3332`) → ה-getter raw type-correct (כבר אומת סבב קודם).
> ⇒ `PromptBlocks = Parameters<ClientSideConnection["prompt"]>[0]["prompt"]` = `Array<ContentBlock>` — projection טהור, קומפילי. ב-FE הליטרל `{ type: "image" as const, mimeType, data }` assignable ל-union member (discriminant + שני שדות-חובה).

**שינוי — backward-compatible (string עדיין עובד)**:
```ts
// טיפוס נגזר-SDK (drift אפס — דפוס AcpRequestMeta הקיים בשורות 34-35):
type PromptRequest = Parameters<ClientSideConnection["prompt"]>[0]
export type PromptBlocks = PromptRequest["prompt"]   // = ContentBlock[]; ייצוא ל-FE (index.ts, additive)

// type (57 — union backward-compatible):
prompt(sessionId: string, content: string | PromptBlocks): ReturnType<ClientSideConnection["prompt"]>

// impl (189-190):
async prompt(sessionId: string, content: string | PromptBlocks) {
  const prompt = typeof content === "string" ? [{ type: "text", text: content }] : content
  return conn.prompt({ sessionId, prompt })
}
```
> **`index.ts`** — additive: הוסף ל-export הקיים גם `PromptBlocks` (type). אל תדרוס.
> **חתימה בלבד — אין שינוי שכבת-capabilities.** ה-gating נשאר raw (§10 החלטה א); `NormalizedCapabilities` לא נגעים.

**Tests (`client.ts` יש כבר suite — הוסף לו / קובץ נלווה)**:
- string עדיין נכתב כ-`prompt:[{type:"text",text}]` (regression — התנהגות קיימת נשמרת).
- מערך blocks `[{type:"text",...},{type:"image",mimeType,data}]` מועבר **כמו-שהוא** ל-`conn.prompt` (frame ב-transport-double מכיל את ה-image-block).
> אם אין תשתית transport-double בקלות — לפחות assert על ה-frame שנכתב (ראה דפוס ב-`client.extmethod.test.ts` / `client.attached.test.ts` אם קיים).

**Verification**: `pnpm --filter @drive-coding/provider test && pnpm --filter @drive-coding/provider typecheck`.

---

#### Commit 4b — FE: flip + wiring (approach: **manual** — אומת חי)
**קבצים שמשתנים**:
- `agent-session.svelte.ts`:
  - **(0)** הפוך `IMAGE_INPUT_ENABLED = false` → `true` (**שורה 46** — kill-switch מ-Commit 2; מדליק את כל הלכידה). ה-getter `supportsImageInput` (**שורה 137**) כבר קורא raw `#client?.capabilities?.promptCapabilities?.image` — **אין שינוי בו** (§10 החלטה א).
  - **(1)** `sendPrompt(text, { attachments }?)` (**שורה 671**): בונה content = `[...(text.trim() ? [{type:"text",text}] : []), ...attachments.map(a => ({type:"image", mimeType:a.mimeType, data:a.dataBase64}))]`, מאכלס `userBubble.attachments`, קורא `this.#client.prompt(this.#sessionId, content)` (**שורה 693** — היום `..., text`).
  > ⚠️ **finding אביגיל r2** — ה-guard `if (!text.trim()) return` (**שורה 674**) **יזרוק בשקט שליחת תמונה-בלבד**. שנה ל: `const atts = opts?.attachments ?? []; if (!text.trim() && atts.length === 0) return`. בלוק-טקסט נכלל ב-content רק אם אינו ריק (תמונה-בלבד = מערך עם image-block בלבד).
  > ⚠️ **טיפוס** — content הוא `PromptBlocks` (ייצוא מ-4a). אם TS לא מסיק structural — יְיַבֵּא `import type { PromptBlocks } from "@drive-coding/provider/client"` ויטפס את המערך. ה-`as const` על `type` עוזר.
- `TypeArea.svelte` — ⚠️ **הקובץ כבר 229 שורות (Commit 2 מוזג — ה-tray/handlers/gating כבר בקוד).** לשליחת **תמונה-בלבד** צריך לשחרר **שלוש** שכבות-חסימה, לא אחת. ה-brief המקורי טיפל רק בשכבת ה-VM guard — **finding אביגיל 2026-07-01 (🔴)**. שלוש השכבות במצב הנוכחי:
  | שכבה | מיקום נוכחי | תיקון |
  |---|---|---|
  | **1. כפתור Send `disabled`** | `TypeArea.svelte:220` — `disabled={!promptText.trim() \|\| isDisabled}` | `disabled={(!promptText.trim() && attachments.length === 0) \|\| isDisabled}` — אפשר שליחה כשיש attachments גם בלי טקסט |
  | **2. `onSubmit` early-return** | `TypeArea.svelte:46-53` — `const text = promptText.trim(); if (!text \|\| isDisabled) return; session.sendPrompt(text)` | `if ((!text && attachments.length === 0) \|\| isDisabled) return; session.sendPrompt(text, { attachments }); …` |
  | **3. VM guard** | `agent-session.svelte.ts:674` | ראה למעלה (`atts.length === 0`) |
  - **`onSubmit` המלא (4b)**: מעביר `{ attachments }` ל-`sendPrompt`, ואז מנקה: `attachments.forEach(revokeAttachment); attachments = []`. **אל תסיר** את `promptText = ""` (שורה 51 — מפעיל autogrow-collapse §3.5). ההערה `// Commit 4 ירחיב כאן` (שורה 52) היא בדיוק המקום.
  - **handlers כבר קיימים** (`handlePaste:67`, `handleDrop:94`, `handleFileChange:108`, `removeAttachment:123`, `processImageFile:57`, tray-UI:137-159) — **אל תיצור מחדש**. הם כבר מגַטים על `session.supportsImageInput` (early-return) → כשהדגל נדלק ב-4b(0), הם מתעוררים אוטומטית.

**API skeleton** (הרחבת החתימה הקיימת — backward-compatible):
```ts
sendPrompt = async (
  text: string,
  opts?: { recordingId?: string; attachments?: { mimeType: string; dataBase64: string }[] },
): Promise<void> => { /* ... */ }
```

**Verification (חי, BE+agent עם image-capability)**:
```
# ספק עם promptCapabilities.image=true (ר' §10 "שאלה משנית" — לאמת מי):
#  1. paste תמונה + טקסט → שלח → ה-agent מגיב על תוכן התמונה (אימות end-to-end)
#  2. בועת-המשתמש מציגה את התמונה ששלחה
#  3. WIRE_RECORD=1 → frame session/prompt מכיל {type:"image",mimeType,data}
#  4. שליחת טקסט-בלבד (בלי attachments) → ללא רגרסיה
#  5. ספק בלי image-capability → אייקון הלכידה מוסתר (getter=false); paste-טקסט תקין
```

## §5 — DoD

| בדיקה | איך | Commit |
|---|---|---|
| `planResize` נכון (scale-to-fit, no-op, עיגול) | `core test` ירוק | 0 |
| `fileToImageAttachment` דוחס + מחזיר base64+preview | browser console | 1 |
| paste/drop/picker → thumbnail ב-tray | ידני /chat | 2 |
| הסרה משחררת object URL | ידני + devtools | 2 |
| paste-טקסט לא נשבר | ידני | 2 |
| ללא image-capability → לכידה מושבתת | mock (דגל true זמני) | 2 |
| **`IMAGE_INPUT_ENABLED = false` ב-commit הסופי של 0–3** | grep בקוד | 2 |
| **עם דגל false: לכידה מוסתרת תמיד, אפס שינוי-התנהגות** (פיגום רדום — בטוח ל-merge) | ידני /chat | 2 |
| בועת-משתמש מרנדרת תמונה | ידני (mock) | 3 |
| **`AcpClient.prompt(string)` — regression: עדיין נכתב כ-`[{type:"text"}]`** | provider test | 4a |
| **`AcpClient.prompt(blocks)` — image-block מועבר כמו-שהוא ל-`conn.prompt`** | provider test | 4a |
| **שליחה מולטימודלית מגיעה ל-agent (חי)** | BE+agent + WIRE_RECORD | 4b |
| **שליחת תמונה-בלבד (בלי טקסט) לא נחסמת — 3 שכבות** | ידני — הוסף תמונה, textarea ריק: (א) כפתור Send **פעיל** (לא disabled), (ב) לחיצה/Cmd+Enter שולחת, (ג) מגיע ל-agent | 4b |
| טקסט-בלבד ללא רגרסיה | ידני | 4b |
| typecheck + build + lint:i18n ירוקים | פקודות §0 | כל commit |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| **Svelte 5 reactivity על array** — push לא מרנדר מחדש | learnings | השמה (`[...]`/`filter`) + `{#each ... (a.id)}` עם key |
| **מחרוזות עברית קשיחות** ב-tray/tooltip | learnings (pre-commit hook) | כל מחרוזת → `t(key)`; `lint:i18n` ב-verification |
| **browser globals ב-core** — לפתות לשים canvas ב-resize-plan | AGENTS.md | ה-core טהור-חישוב בלבד; canvas ב-engine (Commit 1) |
| **object URL leak** — tray לא משחרר | דפוס ידוע | `revokeAttachment` ב-onremove וב-onsend; DoD בודק |
| **paste image דורש secure-context** | AGENTS.md (getUserMedia) | בדיקה ב-localhost/HTTPS בלבד; לא חוסם dev |
| **clipboard מרובה-items / HEIC בנייד** | edge | מסננים `image/*`; פורמט לא-נתמך → התעלמות שקטה (לא crash) |
| **חתימת `conn.prompt` שונה מהמדוד** | SDK version | נמדד 2026-07-01 (`conn.prompt` מקבל `ContentBlock[]`); 4a TDD-regression על string; escalation §7 אם מופרך |
| **התנגשות ב-`client.ts` מול `warm-reattach-skip-init`** | שני slices נוגעים ב-facade/`prompt`, שניהם base=dev (סשן אחר) | merge-order: מי ששני מְיַשם מחדש את שינויו ב-facade המרוענן. השינויים קטנים וממוקדים (4a=מתודת prompt; warm=חילוץ facade). מרדכי מתאם בזמן merge. |
| **merge מוקדם מדי** | תיאום | MERGE-GATE מפורש בראש המסמך; runtime-gate (calev-heavy) רק אחרי Commit 4b חי מול ספק עם image-cap |

## §7 — Escalation triggers
עצור ושאל את מרדכי (parent task) אם:
- **Commit 4a**: `conn.prompt` (SDK) לא מקבל בפועל `ContentBlock[]` עם image-block כפי שמתואר (`{type:"image",mimeType,data}`) → החלטת-מיפוי. (הבסיס נמדד — `conn.prompt` מקבל blocks; escalate רק אם המדידה מופרכת בפועל.)
- `AcpClient.capabilities.promptCapabilities` חסר/undefined בפועל בזמן ריצה → ה-getter raw יחזיר false תמיד (לא crash — optional chaining), אבל הפיצ'ר לא יעבוד לאף ספק → דווח לפני מעבר ל-runtime-gate.
- **אף ספק זמין** לא מצהיר `promptCapabilities.image:true` (בדוק ב-`WIRE_RECORD`) → אי-אפשר לאמת חי את Commit 4b → דווח (חוסם runtime-gate, לא את הביצוע).
- דחיסת canvas מייצרת תמונות פגומות/ריקות בדפדפן היעד → ייתכן stack/API שגוי.

## §8 — Complexity score
- commits: 5 (0–3 מוזגו; נותרו 4a provider + 4b FE) → בינוני-גבוה
- שכבות חדשות: 2 (`core/image` + FE `engine`) → +1
- state model: הרחבת tray + UserBubble.attachments → +1
- protocol coupling (ACP ImageContent + capability gating) → +2
- visual review (thumbnails, image bubble, gating states, נייד) + edge cases (paste types, size, HEIC) → דורש עין

**Score ≈ 8/10 → verifier `calev-heavy`.** runtime-gate (חי) **רק** אחרי Commit 4, מול agent עם `promptCapabilities.image`.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | פורמט יעד לדחיסה — JPEG תמיד, או לשמר PNG כשיש שקיפות? | JPEG (כמו CodeNomad); PNG→JPEG מאבד alpha אך זול | ❌ |
| 2 | מגבלות — `maxDim=2048`, `maxBytes=8MB` (CodeNomad). סביר? | כן | ❌ |
| 3 | ריבוי תמונות בפרומפט אחד — מותר כמה? | כן, מערך; בלי תקרה קשיחה ב-MVP | ❌ |
| 4 | האם החוזה חושף `PromptContent` ברמת ACP-client? drive-coding משתמש ב-`AcpClient` הישיר — צריך ש**הוא** יקבל blocks | **הוכרע 2026-07-01**: החבילה בבעלותנו → Commit 4a מרחיב את `AcpClient.prompt` ל-`string \| PromptBlocks` (backward-compat). ה-layer התחתון `conn.prompt` כבר מקבל blocks. | ❌ (נסגר) |
| 5 | base64 — עם או בלי prefix `data:`? ACP `ImageContent.data` = base64 **גולמי** (בלי prefix) | גולמי (לפי ACP SDK) | ❌ |

## §10 — הכרעת ה-gating: **נתיב (א) — raw** (נעול ע"י מרדכי 2026-07-01)

> ה-§ הזה היה "שאלה פתוחה לסוכן provider-cutover". אחרי ספיגת החבילה (v0.8.0) אין סוכן כזה —
> ההכרעה חזרה למרדכי, שמדד את הקוד והכריע. **ההכרעה סופית; אין פעולה פתוחה כאן ל-executor.**

### ההכרעה
`supportsImageInput` נשאר קורא **raw**: `#client.capabilities.promptCapabilities.image` (getter קיים,
`agent-session.svelte.ts:137`). **אפס שינוי בשכבת ה-capabilities.** `NormalizedCapabilities` לא נגעים.

### נימוק (מה שמכריע — נמדד 2026-07-01)
1. **`staticCapsFor` (spawn: opencode/codex/claude-spawn) hardcoded לגמרי** (`capabilities-static.ts:1-52`):
   "capabilities cannot be discovered at runtime here". נתיב (ב) normalized היה כופה את `image` להיות
   **ניחוש קשיח** לספקי-spawn — מנותק ממה שהסוכן מדווח → בדיוק סיכון הכשל-השקט שה-kill-switch נועד למנוע.
2. **raw = הערך האמיתי פר-סוכן לכל הספקים.** `#client.capabilities` = `agentCapabilities` מ-`initialize`
   האמיתי של הסוכן המחובר (client.ts:46,156) — עובר דרך ה-bridge לסוכן האמיתי (in-process claude *וגם*
   spawn opencode/codex). זה המסלול היחיד שנותן ערך-אמת אחיד.
3. **`promptCapabilities.image` הוא שדה ACP סטנדרטי** — כבר אחיד לכל סוכן תואם-ACP. `NormalizedCapabilities`
   נועד ל-host/_drive features שהמשטח הגולמי *לא* חשף אחיד (mcp/compact/commands/usage/configOptions/
   rename/thinkingTokens). `image` לא צריך את שכבת הנרמול — הוא כבר נורמלי.

### ה"חיסרון" (image raw בעוד השאר normalized) — מקובל ונכון
זו הבחנה **קטגוריאלית נכונה**, לא חוסר-עקביות: prompt-content caps ⊥ host/_drive caps. אם בעתיד יתווספו
`audio`/`embeddedContext` (גם הם תחת `promptCapabilities`) — הם ילכו באותו מסלול raw, עקבי.

### מצב הקוד שנמדד (2026-07-01, dev `0ad8ed3`)
| מה | היכן | מצב |
|----|------|-----|
| חתימת `AcpClient.prompt` | `client.ts:57,189` | `(sessionId, text: string)` — Commit 4a מרחיב ל-`string \| PromptBlocks` |
| השכבה התחתונה | `client.ts:190` | `conn.prompt` **כבר מקבל `ContentBlock[]`** — passthrough |
| getter `supportsImageInput` | `agent-session.svelte.ts:137` | raw `#client.capabilities.promptCapabilities.image` — **נשאר** |
| `IMAGE_INPUT_ENABLED` | `agent-session.svelte.ts:46` | `false` → Commit 4b הופך ל-`true` |

### שאלה משנית (לא חוסמת ביצוע, חוסמת runtime-gate — ל-calev)
איזה ספק זמין מצהיר `promptCapabilities.image: true` (claude / opencode / codex)? נדרש ל-DoD של Commit 4b
(אימות end-to-end). **calev-heavy יאמת עם `WIRE_RECORD` מה כל ספק מצהיר** ויריץ את ה-e2e מול הספק שכן.
אם אף ספק לא מצהיר → escalation (§7) — הפיצ'ר נכון-מבנית אבל לא-ניתן-לאימות-חי כרגע.

---

## §11 — Commit 5: תיקון replay — ContentBlocks לא-טקסטואליים ב-`session/load`

> **נוסף 2026-07-04** אחרי ש-calev נתן GO (12/13) ו**המשתמשת תפסה חי** באג replay: תמונה שנשלחה **נעלמת בטעינה-מחדש** של הסשן. זה תיקון-במקום לפני merge (החלטה: `decisions/drive-coding.md` 2026-07-04). approach: **TDD** (VM handler, לוגיקה בדידה על bubbles).

### §11.1 — השורש (מאומת בקוד)
`#handleSessionUpdate` (`agent-session.svelte.ts`) — שורות **1527-1528**:
```ts
const text = update.content?.type === "text" ? (update.content.text ?? "") : ""
if (!text) return   // ← content לא-טקסטואלי נזרק כאן, לפני מטפלי ה-chunks
```
ה-gate שומר **רק** `text` ומפיל בשקט **4 מ-5** `ContentBlock` (ACP SDK 0.21.1, `types.gen.d.ts:838`): `image` · `audio` · `resource_link` · `resource` (EmbeddedResource). חל על שלושת ה-chunks שאחריו (1532/1537/1541): `agent_message_chunk` · `agent_thought_chunk` · `user_message_chunk`. הבאג הנצפה: `user_message_chunk` עם `content.type==="image"` ב-replay (`session/load`) → נזרק → התמונה נעלמת מההיסטוריה. **מחלקת-הבאג: איבוד-מידע שקט.**

### §11.2 — Scope
| טיפול | כן/לא | הערה |
|---|---|---|
| `image` ב-`user_message_chunk` → `attachments[]` (רינדור מלא) | ✅ | התשתית קיימת (Commit 3): `UserBubble.attachments` + render `UserBubble.svelte:56-64` |
| **placeholder** ל-`audio`/`resource_link`/`resource` ב-`user_message_chunk` | ✅ | **סמן מבני** על הבועה (לא טקסט-סגמנט!) שהרכיב מתרגם — ר' §11.3א. מונע איבוד-שקט |
| קיבוץ image-chunk לבועת-user לפי `messageId` (כמו טקסט) | ✅ | chunk-תמונה עם אותו messageId כמו chunk-טקסט קודם → אותה בועה |
| רינדור מלא של `resource` embedded (text/blob) | ❌ | slice נגזר `message-embedded-content` (roadmap) |
| טיפול ב-image/resource ב-**`agent_message_chunk`** (צד-agent) | ❌ | לא נצפה בפועל (agents פולטים תוכן דרך `tool_call`); מחוץ ל-scope. **אבל** — אל תשבור: ודא שה-gate לא זורק בשקט גם שם ללא placeholder → אם קל, placeholder גם לצד-agent; אחרת השאר כמו-שהוא ותעד |

### §11.3 — הקובץ + נקודות-שינוי
**`packages/frontend/src/lib/view-models/agent-session.svelte.ts`** — `#handleSessionUpdate`:
- **החלף את ה-gate** (1527-1528) כך שלא יזרוק content לא-טקסטואלי **לפני** שמגיעים למטפל ב-`user_message_chunk`. הדפוס הקיים כבר עושה זאת ל-`tool_call`/mode/config (מטופלים **לפני** ה-gate, 1498-1525) — הרחב את אותה גישה: או (א) הזז את מטפל ה-`user_message_chunk` לפני ה-gate עם dispatch פנימי לפי `content.type`, או (ב) חשב `contentType` והתנה.
- **`user_message_chunk`** (היום 1541-1545): 
  - `content.type==="text"` → כמו היום (`#appendChunk("user", text, messageId)`).
  - `content.type==="image"` → helper חדש `#appendUserImage(messageId, { mimeType: content.mimeType, data: content.data })` שמצרף ל-`attachments[]` של בועת-user (קיבוץ לפי messageId כמו `#appendChunk`; אם אין בועה תואמת → בועה חדשה עם `attachments:[…]` ו-`segments:[]`).
  - `content.type` ∈ {`audio`,`resource_link`,`resource`} → **סמן מבני** (§11.3א), לא טקסט.

⚠️ **Svelte 5 reactivity על array** (learnings): הוספת attachment/placeholder בהשמה (`bubble.X = [...(bubble.X ?? []), a]`), לא `push`. **הערת-קוד חובה** (finding אביגיל r1 #2): ה-`#appendChunk` הקיים משתמש ב-`segments.push` (עובד — deep `$state` proxy), אבל `attachments`/`contentPlaceholders` מתחילים `undefined` (optional) → `.push` יקרוס; לכן **השמה**. הוסף הערה קצרה ליד ה-helper.

⚠️ **אל תיגע** ב-`sendPrompt`/Commit 4b (נתיב השליחה — אומת GO). זה **read-path בלבד**.

### §11.3א — i18n בשכבת-הרכיב, לא ב-VM (תיקון finding 2026-07-04)
> **הבעיה שנתפסה במימוש הראשון**: ה-VM כתב מפתח-i18n גולמי כטקסט-סגמנט (`#appendChunk("user","chat.content.unsupported")`) → מרונדר מילולית ("chat.content.unsupported") כי `UserBubble.svelte:73` מעביר segments ל-`MarkdownContent`. בנוסף `t: (key)=>string` **חסר אינטרפולציה** → `"{name}"` לא יתורגם. **שורש: i18n שייך לרכיב (`getI18n().t`), לא ל-VM** (שאין לו `t`, ובצדק — locale ריאקטיבי).

**המבנה הנכון — סמן מבני על הבועה שהרכיב מתרגם:**
1. **`bubble.ts`** — הוסף ל-`UserBubble` (additive, optional):
   ```ts
   /** slice-image-paste §11 — תוכן לא-נתמך ב-replay (audio/resource/resource_link). הרכיב מתרגם. */
   contentPlaceholders?: { kind: "resource_link" | "audio" | "resource"; label?: string }[]
   ```
   `label` = **data** (שם-קובץ/uri ל-resource_link) — לא מתורגם, מוצג כמו-שהוא.
2. **VM** — helper `#appendUserPlaceholder(messageId, ph)` (אותה לוגיקת-קיבוץ כמו `#appendUserImage`, השמה לא push):
   - `resource_link` → `{ kind:"resource_link", label: content.name ?? content.uri }`
   - `audio` → `{ kind:"audio" }`
   - `resource` → `{ kind:"resource" }`
   **ה-VM לא מייבא/קורא `t` ולא כותב שום מחרוזת-תצוגה.**
3. **`UserBubble.svelte`** — בלוק chips (כמו בלוק ה-attachments 56-64), פר placeholder:
   - `resource_link` → אייקון (`Paperclip`, lucide) + `{label}` (raw). aria/title = `t("chat.content.attachedFile")`.
   - `audio`/`resource` → `t("chat.content.unsupported")`.

### §11.4 — i18n (חובה — `lint:i18n` חוסם עברית קשיחה; `t` **param-less**)
מפתחות ב-`keys.ts` + `catalogs/he.ts` + `catalogs/en.ts` (additive ליד `attach.*` 216-218). **בלי `{name}`** (אין אינטרפולציה):
- `chat.content.attachedFile` — he: "קובץ מצורף" · en: "Attached file" (aria/title ל-resource_link; שם-הקובץ עצמו = data ליד האייקון).
- `chat.content.unsupported` — he: "תוכן לא-נתמך" · en: "Unsupported content".
- ⚠️ **הסר** את `chat.content.fileAttachment` (`{name}`) שנוסף במימוש הראשון — שבור (אין אינטרפולציה).

### §11.5 — Testing (TDD)
`agent-session.test.ts` (כבר יש suite ל-`user_message_chunk`, שורות 104/189):
1. `user_message_chunk` עם `content:{type:"image",data,mimeType}` → בועת-user אחת עם `attachments.length===1`, data/mimeType נכונים.
2. טקסט+תמונה עם **אותו** messageId (שני chunks) → **בועה אחת**: `segments.length===1` **וגם** `attachments.length===1`.
3. תמונה בלבד (בלי chunk-טקסט) → בועה עם `attachments.length===1`, `segments.length===0`.
4. `resource_link` → בועה עם `contentPlaceholders.length===1`, `kind==="resource_link"`, `label` = השם/uri. `audio`/`resource` → `contentPlaceholders` עם ה-kind המתאים (לא segment-טקסט, לא מפתח-i18n).
5. **רגרסיה**: `user_message_chunk` טקסט-בלבד → כמו היום (segment, בלי attachments/placeholders). `agent_message_chunk` טקסט → ללא רגרסיה.

### §11.6 — DoD
| בדיקה | איך | 
|---|---|
| replay image ב-`user_message_chunk` → attachment | unit + חי (calev) |
| טקסט+תמונה אותו messageId → בועה אחת (segment+attachment) | unit |
| audio/resource_link/resource → placeholder (לא איבוד-שקט) | unit + חי |
| טקסט-בלבד ללא רגרסיה | unit |
| **חי: שלח תמונה → reload סשן → התמונה מופיעה בהיסטוריה** | calev (הבאג המקורי) |
| typecheck + build + `lint:i18n` ירוקים | פקודות §0 |

### §11.7 — Complexity
VM read-path + i18n + טסטים; אין UI חדש (render קיים), אין BE, אין פרוטוקול חדש. **~4/10 → verifier `calev`** (light) — אבל מכיוון שזה חלק מ-image-paste (8/10) ונמזג יחד, ה-runtime-gate המשולב יישאר **calev-heavy** על נתיב ה-replay + רגרסיית השליחה.

### §11.8 — depends_on
`[Commit 4b]` (אותו סלייס — משתמש ב-`UserBubble.attachments` שהוגדר ב-Commit 3 ובמודל שהודלק ב-4b). base = ה-branch הנוכחי `slice/image-paste` @ HEAD.

---

## §12 — Commit 6: lightbox לתמונת-המשתמש (עקביות עם תמונת-הכלי)

> **נוסף 2026-07-04** — המשתמשת תפסה חי: תמונות שהסוכן מציג (תוכן-כלי) נפתחות ב-lightbox בלחיצה, אבל תמונה שהמשתמש שלח (attachment בבועת-user) היא `<img>` חשוף שלא ניתן להגדיל. פער-עקביות בפיצ'ר. approach: **manual** (חיווט UI לתשתית קיימת, ללא לוגיקה חדשה).

### §12.1 — השורש (מאומת)
`UserBubble.svelte:58-62` מרנדר את ה-attachment כ-`<img>` חשוף. `ToolBubble.svelte:139-145` עוטף את תמונת-הכלי ב-`<button onclick={() => viewer.show({ kind:"image", src, alt })}>` (`viewer = getContentViewer()`, `$lib/context:81`). ה-lightbox (`ContentViewerVM.show`, `view-models/content-viewer.svelte.ts:14,27`) **גנרי וקיים** — ToolBubble כבר משתמש בו. UserBubble פשוט לא חובר.

### §12.2 — Scope
- ✅ עטיפת ה-`<img>` של כל attachment ב-`UserBubble.svelte` ב-`<button>` שקורא `viewer.show({ kind:"image", src:`data:${att.mimeType};base64,${att.dataBase64}`, alt })`.
- ❌ שום שינוי במודל/VM/BE/i18n-key חדש. **חיווט-UI בלבד.**
- ❌ הגדלת ה-placeholders (resource_link/audio/resource) — לא רלוונטי (אין להם תמונה).

### §12.3 — נקודות-שינוי (קובץ יחיד)
`packages/frontend/src/lib/components/chat/bubbles/UserBubble.svelte`:
1. ייבוא: הוסף `getContentViewer` לשורת ה-import הקיימת מ-`$lib/context` (שורה 16), ו-`const viewer = getContentViewer()` ליד ה-getters (שורה ~30).
2. בבלוק ה-attachments (**שורות ~60-65** — ה-`{#each bubble.attachments as att, i (i)}` עם ה-`<img src="data:{att.mimeType};base64,{att.dataBase64}">`): עטוף את ה-`<img>` ב-`<button>`. ⚠️ **אין משתני `src`/`alt` בסקופ** (finding אביגיל 🟡) — בנה את ה-`src` מהאובייקט `att` בדיוק כמו ה-`<img>` הקיים:
   ```svelte
   <button
     class="user-image-btn"
     onclick={() => viewer.show({ kind: "image", src: `data:${att.mimeType};base64,${att.dataBase64}`, alt: "" })}
     aria-label={t("contentViewer.expand")}
     title={t("contentViewer.expand")}
   >
     <img src="data:{att.mimeType};base64,{att.dataBase64}" alt="" class="max-h-40 max-w-[12rem] rounded-xl object-contain border" style="border-color:var(--border)" />
   </button>
   ```
   (ה-`<img>` נשאר עם ה-class/style הקיימים; רק נעטף.)
3. CSS: `.user-image-btn` — reset בלבד: `background:none; border:none; padding:0; cursor:pointer; display:inline-flex`. ⚠️ **אל תעתיק verbatim את `.tool-image-btn`** (`ToolBubble.svelte:~295-308`) — יש בו `margin:0.2em 0` שיוסיף רווח-אנכי חדש לתמונת-המשתמש (finding אביגיל 🟢 — רגרסיה ויזואלית). `margin:0` (או השמט לגמרי).

> **i18n**: אין מפתח חדש — `contentViewer.expand` (`keys.ts:210`) קיים. `alt` — השאר `""` כמו היום (התמונה דקורטיבית; ה-aria על ה-button).

### §12.4 — DoD
| בדיקה | איך |
|---|---|
| לחיצה על תמונת-משתמש (attachment) → lightbox fullscreen נפתח | חי (calev) |
| ה-lightbox מציג את אותה תמונה (data-URI תואם) | חי |
| סגירת lightbox (overlay/Esc) עובדת | חי (מנגנון קיים) |
| רגרסיה: רינדור התמונה עצמה ללא שינוי (גודל/מסגרת) | חי + visual |
| typecheck + build + `lint:i18n` ירוקים | פקודות §0 |

### §12.5 — Complexity
חיווט-UI לתשתית קיימת, קובץ יחיד, אפס לוגיקה/מודל. **~2/10**. נמזג עם image-paste → ה-runtime-gate המשולב נשאר **calev-heavy**; אימות §12 = smoke קצר (לחיצה→lightbox) בתוך אותה ריצה.

### §12.6 — depends_on
`[Commit 3]` (`UserBubble.attachments` render) + slice `content-viewer` (מוזג `e2126e0` — `ContentViewerVM`/`getContentViewer`). base = `slice/image-paste` @ HEAD.
