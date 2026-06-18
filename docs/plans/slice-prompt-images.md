# Slice — prompt-images (3a) — brief

+ **תאריך:** 2026-06-18 · **סטטוס:** תוכנית (טרם בוצע) · **מקור:** `docs/plans/ui-feature-backlog.md` §3a + §5 ("attachments מלא")
+ **Base:** `dev` · **Worktree (כשיבוצע):** `.worktrees/slice-prompt-images` · **Branch:** `slice-prompt-images`
+ **Complexity:** 6/10 (FE-only, אבל נוגע ב-input UX + multimodal + capability-gating)
+ **תלויות (`depends_on`):** [] — עצמאי. אפשר לבצע אחרי/במקביל ל-batch ה-Enter.

## §0 — הממצא המכריע (מאומת מהקוד, 2026-06-18)

**תמונות הן FE-only.** אין צורך לגעת ב-`core`, ב-`backend`, או ב-contract החיצוני:

+ הנתיב הנוכחי הוא **ACP מלא מעל WS** — ה-FE מריץ `ClientSideConnection` (מ-`@agentclientprotocol/sdk`)
  דרך `WsAcpTransport` שהוא transport **שקוף** ל-JSON-RPC (NDJSON; ראה
  [ws-transport.ts](packages/frontend/src/lib/engines/ws-transport.ts)). ה-BE רק pipe ל-stdin/stdout של ה-CLI.
+ ה-schema `PromptMessage = {type:'prompt', text}` ב-[ws-messages.ts](packages/core/src/schemas/ws-messages.ts#L13-L16)
  הוא **legacy מ-slice 4** — **לא בנתיב** של ה-FE↔BE הנוכחי. אין לגעת בו.
+ `AcpClient` מ-`provider-contract/acp` חושף `prompt(sessionId, text: string)` — מצומצם ל-text.
  **אבל** הוא חושף גם `conn: ClientSideConnection`
  ([client.d.ts](node_modules/provider-contract/dist/adapters/acp/client/client.d.ts)).
  ה-SDK המלא `conn.prompt({ sessionId, prompt: ContentBlock[] })` תומך ב-`ImageContent`
  (`{ type:"image", data: base64, mimeType }`). **זהו ה-escape hatch — עוקף את ה-wrapper בלי לשנות contract.**
+ ACP SDK תומך מלא ב-`ImageContent` בתוך `PromptRequest.prompt`. ה-CLI (claude/opencode) מקבל את זה ישירות.

> כלומר: כל העבודה ב-`packages/frontend`. אפס שינוי ב-`core`/`backend`/git-deps.

## §1 — מטרה

המשתמש יכול לצרף תמונות לפרומפט: **הדבקה (paste)**, **גרירה (drag-drop)**, ו-**בורר קבצים**.
תצוגה מקדימה (thumbnails) עם הסרה לפני שליחה. בשליחה, התמונות נכנסות ל-`ContentBlock[]` יחד עם הטקסט,
נשלחות דרך ה-ACP conn ל-agent, ומוצגות בבועת המשתמש. הכל gated ל-capability של ה-agent.

## §2 — Scope

| פיצ'ר | כן/לא |
|------|------|
| paste image לתיבה | ✅ |
| drag-drop image לתיבה | ✅ |
| כפתור attach (file picker; נייד: capture) | ✅ |
| preview thumbnails + הסרה | ✅ |
| דחיסה אוטומטית (≤~8MB, JPEG, max ~2048px) | ✅ |
| בניית `ContentBlock[]` + שליחה דרך `conn.prompt` | ✅ |
| הצגת תמונה בבועת המשתמש | ✅ |
| capability-gating (השבתה אם ה-agent לא תומך image) | ✅ |
| שינוי `PromptMessage`/core/BE/contract | ❌ — מיותר (§0) |
| קבצים שאינם תמונה (PDF/וכו') | ❌ — סבב נפרד |
| draft persistence של attachments | ❌ — §5 backlog (🟢), סבב נפרד |

## §3 — Architecture

```
TypeArea.svelte
  state: attachments: Attachment[]   // {id, previewUrl, mimeType, base64}
  paste/drop/file-picker → readImage() → compressImage() → push attachment
  preview row (thumbnails + ✕)
        │ onSubmit(text, attachments)
        ▼
AgentSession.sendPrompt(text, { images })
  blocks = [ {type:"text", text}, ...images.map(i => ({type:"image", data:i.base64, mimeType:i.mimeType})) ]
  optimistic UserBubble (text + image previews)
  await this.#client.conn.prompt({ sessionId, prompt: blocks })   // ← conn, לא wrapper
        │ WsAcpTransport (שקוף, JSON-RPC) → BE pipe → CLI
        ▼
UserBubble.svelte → מציג טקסט + תמונות
```

## §4 — Commits בסדר

### Commit 1 — util דחיסת תמונה (approach: TDD חלקי)
+ צור `lib/util/image-attach.ts`:
  + `fileToAttachment(file: File): Promise<Attachment>` — קורא File, דוחס דרך `<canvas>` (max-dim ~2048,
    JPEG quality ~0.85), מחזיר `{ id, previewUrl, mimeType, base64 }` (base64 ללא ה-`data:` prefix — ה-ACP
    `ImageContent.data` הוא base64 גולמי).
  + טיפוס `Attachment` (ייצוא).
+ TDD: בדיקת הלוגיקה הטהורה (בחירת mimeType, חישוב ממדי resize, חיתוך prefix). `canvas`/`Image` צריכים mock
  ב-jsdom — בדוק שלפחות נתיב ה-base64-prefix-stripping והממדים מכוסים; השאר manual.

### Commit 2 — UI ב-TypeArea (approach: manual+visual)
+ [TypeArea.svelte](packages/frontend/src/lib/components/chat/TypeArea.svelte):
  + `attachments = $state<Attachment[]>([])`.
  + `onpaste` — `e.clipboardData.items` → פריטי `image/*` → `fileToAttachment` → push.
  + `ondragover`/`ondrop` — קבצי תמונה → push (preventDefault).
  + כפתור attach (lucide `paperclip` / `image`) → `<input type="file" accept="image/*" multiple>` נסתר.
  + שורת preview: thumbnails (`previewUrl`) + כפתור ✕ להסרה.
  + `onSubmit`: אם יש attachments — קרא `session.sendPrompt(text, { images: attachments })` ונקה. מותר טקסט ריק
    אם יש תמונה (התאם את ה-guard).
  + i18n: aria/tooltip לכפתור attach ול-✕ (`record.attach`, `record.removeAttachment`) — keys.ts + he.ts + en.ts.

### Commit 3 — חיווט sendPrompt + conn.prompt (approach: manual)
+ [agent-session.svelte.ts](packages/frontend/src/lib/view-models/agent-session.svelte.ts#L555):
  + הרחב `sendPrompt = async (text, opts?: { recordingId?; images?: PromptImage[] })`.
  + בנה `ContentBlock[]` (text + images). אם אין images — שמור על הנתיב הקיים (אפשר להמשיך עם `conn.prompt`
    של block טקסט יחיד, או להשאיר את ה-wrapper `prompt` ל-text-only כדי לצמצם סיכון רגרסיה).
  + קרא `await this.#client.conn.prompt({ sessionId: this.#sessionId, prompt: blocks })`.
  + בועת user אופטימית: הוסף תמונות (שדה `images?` ב-`UserBubble` VM type).

### Commit 4 — הצגה ב-UserBubble + capability-gating (approach: manual+visual)
+ [UserBubble.svelte](packages/frontend/src/lib/components/chat/bubbles/UserBubble.svelte): render `bubble.images`
  (thumbnails, `dir=ltr`, max-width responsive).
+ capability-gating: `this.#client.capabilities` כולל `promptCapabilities`? אם `image` לא נתמך —
  הסתר/השבת את כפתור ה-attach ו-paste/drop (חיווי קצר). חשוף `supportsImages` ב-AgentSession VM.

## §5 — DoD

+ paste/drop/file-picker מוסיפים תמונה עם preview; ✕ מסיר.
+ שליחה עם תמונה → הבועה מציגה טקסט+תמונה; ה-agent מקבל ומגיב לתוכן התמונה (אימות E2E מול claude/opencode).
+ דחיסה: תמונה גדולה מצטמצמת (בדוק גודל base64 סביר).
+ capability-gating: על agent ללא תמיכת image — אין כפתור attach.
+ `pnpm typecheck && pnpm test && pnpm lint && pnpm lint:i18n` ירוקים. אפס diff ב-`core`/`backend`.

## §6 — סיכונים

| סיכון | מיטיגציה |
|------|----------|
| `conn.prompt` עוקף את ה-wrapper — שינוי לוגיקת turn? | ה-wrapper רק מצמצם טיפוס; `conn.prompt` הוא אותו call ל-SDK. בדוק שה-`#onSessionUpdate`/turn-state עדיין מתנהג זהה. |
| ה-agent לא תומך image → שגיאת ACP | capability-gating (Commit 4) חוסם מראש. |
| תמונות גדולות → base64 ענק על ה-WS | דחיסה (Commit 1) לפני שליחה. |
| jsdom חסר canvas לטסט | בדוק לוגיקה טהורה; דחיסה אמיתית — manual/E2E. |
| 3 שתמיד נשכחים: i18n (keys ל-attach/remove) · Reactivity (`attachments` $state) · OneCLI (לא רלוונטי — נתיב ACP שקוף). |

## §7 — שאלות פתוחות

| # | שאלה | ברירת מחדל |
|---|------|----------|
| 1 | להשאיר את ה-wrapper `prompt` ל-text-only ולהשתמש ב-`conn.prompt` רק כשיש images? | כן — מצמצם סיכון רגרסיה בנתיב הקיים |
| 2 | מבנה התמונה ב-`UserBubble` — שדה `images` נפרד או חלק מ-segments? | שדה `images?` נפרד (segments הם text בלבד היום) |
| 3 | פורמט דחיסה — JPEG תמיד, או לשמר PNG עם שקיפות? | JPEG (קטן); אם נדרשת שקיפות — סבב נפרד |
