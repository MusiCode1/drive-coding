# Slice image-paste — הדבקת/גרירת/בחירת תמונות בתיבת הפרומפט — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: טיוטה (אביגיל טרם)
> **Complexity**: 8/10 (verifier: **calev-heavy**)
> **תלות (depends_on)**: `[track-A: provider-contract — AcpClient.prompt(blocks)]` — **רק ל-Commit 4 ול-merge**. Commits 0–3 עצמאיים ובְּני-ביצוע על dev הנוכחי.
> **Base**: `dev` HEAD (tip בעת הכתיבה `3bb36a9`)
> **⚠️ MERGE-GATE**: **אין למזג** לפני שצד ה-ACP (`provider-contract`) חושף `AcpClient.prompt` שמקבל `PromptContent`/ContentBlock[] מולטימודלי. החלטת המשתמשת (2026-06-28): כותבים + מבצעים את החלקים הלא-חסומים, ממתינים עם merge עד שהחוזה תומך.

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
- `packages/frontend/src/lib/components/chat/TypeArea.svelte` — **כל הקובץ** (67 שורות). הקובץ המרכזי שמשתנה.
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` §559-591 (`sendPrompt`, מתחיל בשורה 559) + הגדרת `#client`/`capabilities`.
- `packages/frontend/src/lib/types/bubble.ts` §30-41 (`UserBubble`).

**reference בזמן עבודה**:
- `docs/plans/ui-feature-backlog.md` §3a + §5 ("attachments מלא" — reference CodeNomad `composer.tsx`: drag-drop+paste+דחיסה ≤8MB/JPEG/2048px).
- `docs/conventions/parallel-safe-code.md` — **רק אם** נוגעים ב-`packages/core/src/i18n/keys.ts` / `catalogs/*` (מחרוזות tray).
- Contract types — **הגרסה ש-ה-FE פותר אליה** (`packages/frontend/node_modules/provider-contract` → symlink ל-`node_modules/.pnpm/provider-contract@git+https_f03460478b9f19a4a0f949e446254e90/node_modules/provider-contract`): `dist/adapters/acp/client/client.d.ts:45` (`AcpClient.prompt` — היום `text: string`), `dist/contract/events.d.ts:160` (`PromptContent = string | PromptContentPart[]`). ⚠️ קיימות **שתי** גרסאות ב-`.pnpm` (גם `4f3a...`) — תמיד לאמת מול זו ש-ה-FE פותר (`f034...`).

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
| שליחת `PromptContent[]` מולטימודלי | ✅ (Commit 4, **gated**) | תלוי חוזה |
| רינדור התמונה בבועת-המשתמש האופטימית | ✅ (Commit 4) | הסבב הזה |
| **הרחבת `AcpClient.prompt` לקבל blocks** | ❌ | **Track A — `provider-contract`** (הסוכן השני) |
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

## §4 — Commits

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

**(א) VM — getter נגזר** (ב-`AgentSession`, additive):
```ts
get supportsImageInput(): boolean {
  return this.#client?.capabilities?.promptCapabilities?.image === true
}
```
> `#client.capabilities` = `agentCapabilities` מ-`initialize()` (כבר נחשף ב-`AcpClient`, client.d.ts). **חובת-spec**: בלי image-capability — אין לכידה.

**(ב) TypeArea — state מקומי** (`$state`):
```ts
let attachments = $state<ImageAttachment[]>([])
let fileInputEl = $state<HTMLInputElement>()
```
⚠️ **Svelte 5 reactivity על array** (learnings): שינוי דרך השמה (`attachments = [...attachments, a]` / `.filter`), לא mutation, ו-`{#each attachments as a (a.id)}` עם key.

**(ג) handlers**: `onpaste` (קורא `e.clipboardData.items`, מסנן `kind==="file" && type.startsWith("image/")`), `ondrop`+`ondragover.preventDefault`, ו-`onchange` ל-`<input type="file" accept="image/*" capture>`. כולם → `fileToImageAttachment` → push ל-`attachments`. כפתור הוספה (אייקון `Paperclip`/`ImagePlus`) פותח את ה-input. **gating**: כל הלכידה enabled רק כש-`session.supportsImageInput` (אחרת אייקון מוסתר/disabled + tooltip).

**(ד) tray UI**: שורת thumbnails מעל ה-textarea, כל אחד עם כפתור-הסרה (`revokeAttachment` + filter). i18n לכל מחרוזת.

**אסור לשנות**: את `onkeydown` (enter-toggle, L43-55), את `onSubmit` הקיים (Commit 4 ירחיב אותו), את לוגיקת ה-`isDisabled`.

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

---

### Commit 3 — רינדור תמונות בבועת-המשתמש (approach: **manual** — visual)
**קבצים שמשתנים**:
- `packages/frontend/src/lib/types/bubble.ts` — `UserBubble.attachments?: { mimeType: string; dataBase64: string }[]` (additive, optional — לא שובר בועות קיימות).
- `packages/frontend/src/lib/components/chat/bubbles/UserBubble.svelte` — רינדור `<img>` מ-`data:` URL לכל attachment.

> מופרד מ-Commit 4 כי הוא **FE-טהור ובְּן-ביצוע עכשיו** (מודל+רינדור), בלי תלות בחוזה. ה-wiring שמאכלס את `attachments` הוא Commit 4.

**Verification**: typecheck+build · ב-browser, בועת-משתמש עם `attachments` (mock) מציגה תמונה.

---

### Commit 4 — שליחה מולטימודלית (approach: **manual**) — **⚠️ GATED על Track A**
> **לא לבצע** עד ש-`provider-contract` המותקן חושף `AcpClient.prompt(sessionId, content: PromptContent)` (היום: `text: string` בלבד, client.d.ts:45). **escalation מיידי למרדכי** אם הבסיס עדיין טקסט-בלבד (ר' §7).

**קבצים שמשתנים**:
- `agent-session.svelte.ts` — `sendPrompt(text, { attachments }?)`: בונה `PromptContent` = `[...(text.trim() ? [{type:"text",text}] : []), ...attachments.map(a => ({type:"image", mimeType:a.mimeType, data:a.dataBase64}))]`, מאכלס `userBubble.attachments`, קורא `this.#client.prompt(this.#sessionId, content)`.
  > ⚠️ **finding אביגיל r2** — ה-guard הקיים `if (!text.trim()) return` (שורה 562) **יזרוק בשקט שליחת תמונה-בלבד**. שנה את התנאי ל: `if (!text.trim() && !(opts?.attachments?.length)) return` — כלומר חוסם רק כשגם הטקסט ריק וגם אין attachments. בלוק-טקסט נכלל ב-`PromptContent` רק אם אינו ריק (תמונה-בלבד = מערך עם image-block בלבד).
- `TypeArea.svelte` — `onSubmit` מעביר `{ attachments }`, מנקה את ה-tray (+`revokeAttachment` לכולם) אחרי שליחה.

**API skeleton** (הרחבת החתימה הקיימת — backward-compatible):
```ts
sendPrompt = async (
  text: string,
  opts?: { recordingId?: string; attachments?: { mimeType: string; dataBase64: string }[] },
): Promise<void> => { /* ... */ }
```

**Verification (חי, BE+agent עם image-capability)**:
```
# opencode/claude עם promptCapabilities.image=true:
#  1. paste תמונה + טקסט → שלח → ה-agent מגיב על תוכן התמונה (אימות end-to-end)
#  2. בועת-המשתמש מציגה את התמונה ששלחה
#  3. WIRE_RECORD=1 → frame session/prompt מכיל {type:"image",mimeType,data}
#  4. שליחת טקסט-בלבד (בלי attachments) → ללא רגרסיה
```

## §5 — DoD

| בדיקה | איך | Commit |
|---|---|---|
| `planResize` נכון (scale-to-fit, no-op, עיגול) | `core test` ירוק | 0 |
| `fileToImageAttachment` דוחס + מחזיר base64+preview | browser console | 1 |
| paste/drop/picker → thumbnail ב-tray | ידני /chat | 2 |
| הסרה משחררת object URL | ידני + devtools | 2 |
| paste-טקסט לא נשבר | ידני | 2 |
| ללא image-capability → לכידה מושבתת | mock | 2 |
| בועת-משתמש מרנדרת תמונה | ידני (mock) | 3 |
| **שליחה מולטימודלית מגיעה ל-agent (חי)** | BE+agent + WIRE_RECORD | 4 (gated) |
| **שליחת תמונה-בלבד (בלי טקסט) לא נחסמת** | ידני — הוסף תמונה, השאר textarea ריק, שלח | 4 |
| טקסט-בלבד ללא רגרסיה | ידני | 4 |
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
| **החוזה לא יורד / חתימה שונה** מהצפוי | תלות Track A | Commit 4 מבודד + gated; escalation §7; שאר ה-slice נמסר/נבדק עצמאית |
| **merge מוקדם מדי** | תיאום | MERGE-GATE מפורש בראש המסמך; runtime-gate (calev) רק אחרי Commit 4 חי |

## §7 — Escalation triggers
עצור ושאל את מרדכי (parent task) אם:
- **Commit 4**: ה-`AcpClient.prompt` בבסיס עדיין `(sessionId, text: string)` — החוזה טרם ירד → **אל תבצע את Commit 4**, דווח, המשך ל-DoD של 0–3.
- חתימת `PromptContent`/`PromptContentPart` בחוזה שונה ממה שמתואר (`{type:"image",mimeType,data}`) → החלטת-מיפוי.
- `AcpClient.capabilities.promptCapabilities` חסר/undefined בפועל → אי-אפשר gating לפי spec → החלטה.
- דחיסת canvas מייצרת תמונות פגומות/ריקות בדפדפן היעד → ייתכן stack/API שגוי.

## §8 — Complexity score
- commits: 4 (+ gated) → בינוני-גבוה
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
| 4 | האם החוזה (הסוכן השני) חושף `PromptContent` ברמת ACP-client, או רק `ProviderSession`? drive-coding משתמש ב-`AcpClient` הישיר — צריך ש**הוא** יקבל blocks | לתאם עם הסוכן השני; ברירת מחדל: `AcpClient.prompt(sessionId, PromptContent)` | ✅ **חוסם Commit 4** |
| 5 | base64 — עם או בלי prefix `data:`? ACP `ImageContent.data` = base64 **גולמי** (בלי prefix) | גולמי (לפי ACP SDK) | ❌ |
