# Slice AB — עצירת סוכן + חיווי סטטוס + הקלטות + השמעת בועה בודדת

> ⚠️⚠️ **SUPERSEDED (2026-06-03)** — אוחד לתוך
> `poc-wake-word:docs/plans/slice-model-status-control-replay.md`.
> ה-brief הזה התגלה כחופף ל-brief A (בועת-סטטוס + refactor turnState) של סשן מקביל:
> שניהם נוגעים ב-agent-session/voice-mode, ו-A מסיר `thinking` מ-status. במקום
> conflict — אוחדו ל-slice אחד (6 commits). **אל תבצע את ה-brief הזה.** נשמר לתיעוד.
>
> **תאריך**: 2026-06-02
> **סטטוס**: ‏~~READY (אביגיל round 2)~~ **SUPERSEDED** ע"י ה-brief המאוחד
> **base**: `dev` **אחרי** merge של `slice-sessions-inline-transcribe-resilience`
> (אותו slice נוגע ב-`transcribe.ts` + `mic.svelte.ts` — חייב להתמזג ראשון כדי
> למנוע התנגשות; ראה §6 risk R1). **depends_on**: `[slice-sessions-inline-transcribe-resilience]`
> **complexity**: 5 → verifier-slice-light (+ verifier-phase אחרי Commit 3, נקודת I/O)

---

## §0 — Pre-flight

**Worktree**:
```bash
# רק אחרי ש-sessions-inline-transcribe-resilience מוזג ל-dev!
git worktree add .worktrees/slice-AB-cancel-status-replay -b slice-AB-cancel-status-replay dev
cd .worktrees/slice-AB-cancel-status-replay
pnpm install && pnpm hooks:install
```

**איך מריצים**:
```bash
# BE (חובה OneCLI — אחרת /api/recordings עובד אבל /proxy/elevenlabs נכשל ב-Commit 4):
cd packages/backend
PORT=4011 onecli run --agent voice-acp -- bun --watch src/server.ts
# FE (פורט אקראי גבוה — אל תתנגש עם sessions/integration):
BE_PORT=4011 pnpm --filter @drive-coding/frontend dev
# typecheck/test:
pnpm --filter @drive-coding/frontend typecheck
pnpm --filter @drive-coding/frontend test
pnpm lint:i18n
```

**OneCLI agent**: `voice-acp` (מזריק `xi-api-key` ל-ElevenLabs, `x-goog-api-key` ל-Google).
דרוש ב-Commit 4 (השמעת בועת-סוכן = `synthesizeStreaming` → proxy). **לא** דרוש ל-Commit 1-3.

**Browser**: אין DISPLAY במכונה → linux-gui Chrome :9222, profile voice-acp.
`playwright-cli -s=vacp attach --cdp=http://localhost:9222`. ⚠️ תמיד `-s=vacp` (ה-default שייך לסוכן אחר).
לבדיקת mock UI בלי BE: `/chat?mock=greeting` (דורש reload מלא, לא ניווט SPA).

**Reading list**:
- **must-read לפני**:
  - `packages/frontend/AGENTS.md` — חמשת חוקי הזהב (במיוחד #2 entity-not-screen, #4 effect ownership).
  - `packages/frontend/src/lib/view-models/derived/voice-mode.svelte.ts` — ה-FSM. **כאן הבאג** (§1).
  - `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `#client`/`#sessionId`, `detach`:150.
  - `packages/core/src/acp/client.ts:161` — `cancel(sessionId)` קיים ומוכן.
- **reference בזמן עבודה**:
  - `packages/backend/src/delivery/http-history.ts` — `/api/recordings` GET+POST (קיים, עובד).
  - `packages/frontend/src/lib/adapters/voice/tts.ts:29` — `synthesizeStreaming(opts)`.
  - `docs/conventions/parallel-safe-code.md` — לפני נגיעה ב-`context.ts`/`+layout.svelte`/`BubbleRenderer`.

---

## §1 — מטרה

המשתמש יוכל: (א) **לעצור** את הסוכן באמצע תשובה בלחיצה אחת על כפתור המיקרופון —
וזה באמת יעצור (היום ה-mic+speaker נעצרים אבל הסוכן ממשיך לרוץ ב-BE, וה-FSM נתקע
במצב `cancelling` עם X שמהבהב לנצח). (ב) לראות **חיווי טקסטואלי ברור** למה שקורה כרגע
("מתמלל…" / "חושב…" / "מדבר…") ולא רק צבע/אנימציה. (ג) **ההקלטות שלו יישמרו** לדיסק
ב-BE (היום נזרקות — `recordingId:""` קשיח). (ד) **להשמיע בועה בודדת** בלחיצה על ▶:
בועת-משתמש מנגנת את ההקלטה המקורית, בועת-סוכן מסנתזת TTS מחדש (cache hit → מהיר וזול).

זהו הבסיס. הפלייליסט המלא (רצף, קדימה/אחורה, loop, התחל-מנקודה) הוא **slice C** נפרד.

---

## §2 — Scope: מה כן, מה לא

| נושא | בסבב הזה? | מתי |
|---|---|---|
| עצירת סוכן בריצה (ACP cancel) + תיקון X-מהבהב | ✅ Commit 1 | — |
| חיווי סטטוס טקסטואלי | ✅ Commit 2 | — |
| חיבור הקלטות משתמש ל-BE (recordingId אמיתי) | ✅ Commit 3 | — |
| השמעת בועה בודדת (▶ על כל בועה) | ✅ Commit 4-5 | — |
| **רצף/פלייליסט** (נגן את כל השיחה אוטומטית) | ❌ | slice C |
| **קדימה/אחורה/loop/התחל-מנקודה** | ❌ | slice C |
| **סרגל נגן גלובלי צף** | ❌ | slice C |
| **מצב replay נפרד** (חסימת mic בזמן replay) | ❌ | slice C |
| **replay שמכבד speakThoughts/narrateTools** | ❌ | slice C (בבודדת אין שאלת הגדרות — בחרת בועה → היא מתנגנת) |
| **IndexedDB / replay של סשן ישן שנטען מחדש** | ❌ | עתידי. הקלטות בדיסק BE לפי recordingId; טעינת recordings לסשן משוחזר = slice נפרד |

---

## §3 — Architecture diagram

```
routes/chat/+page.svelte ─ shell (אין שינוי לוגי משמעותי)
components/
  chat/MicLarge.svelte         ← משתנה: onClick קורא cancel() המתוקן (Commit 1)
  chat/StatusIndicator.svelte  ← חדש: מציג voiceMode.status.* (Commit 2)
  chat/bubbles/*Bubble.svelte  ← משתנה: כפתור ▶ + מצב playing (Commit 4-5)
view-models/
  agent-session.svelte.ts      ← משתנה: + cancelTurn() (Commit 1, ADDITIVE method)
  derived/voice-mode.svelte.ts ← משתנה: cancel() קורא גם session.cancelTurn() (Commit 1)
  bubble-player.svelte.ts      ← חדש: VM להשמעת בועה בודדת (Commit 4)
adapters/
  voice/recordings.ts          ← חדש: saveRecording / recordingUrl (Commit 3)
  voice/transcribe.ts          ← משתנה: מסיר stub, קורא saveRecording (Commit 3)
  voice/play-bubble.ts         ← חדש: playUserBlob / synthesizeBubble (Commit 4)
view-models/mic.svelte.ts      ← משתנה: מעביר recordingId אמיתי הלאה (Commit 3)
```

> ה-Player engine הקיים (`engines/player.svelte.ts`) **לא משתנה** בסבב זה. השמעת בועה
> בודדת היא נתיב פשוט (`<audio>` element) ולא דרך ה-Player/AudioStream המורכב — אלה
> נשמרים ל-slice C (פלייליסט). הסיבה: ה-Player+AudioStream בנויים ל-streaming TTS חי
> עם orderKey; להשמעה חד-פעמית של בועה אחת זו תקורה מיותרת.

---

## §4 — Commits בסדר

### Commit 1 — עצירת סוכן (ACP cancel) + תיקון X-מהבהב
**Approach**: manual (glue, browser verification).

**קבצים שמשתנים**:
- `view-models/agent-session.svelte.ts` — מתודה ציבורית חדשה `cancelTurn` (ADDITIVE,
  בבלוק `// ─── prompting ───` או חדש). לא שדה state חדש → לא INVASIVE.
- `view-models/derived/voice-mode.svelte.ts` — `cancel()` קורא גם ל-`session.cancelTurn()`.

**שורש הבאג** (להבנת ה-executor): היום `VoiceMode.cancel()` מדליק `isCancelling=true`
ועוצר mic+speaker, אבל **לא מבטל את הסוכן** — אז `session.status` נשאר `"thinking"`.
ה-`$effect` ב-voice-mode:55-64 מאפס `isCancelling=false` רק כש-`status !== "thinking"`,
לכן הוא **לעולם לא משתחרר** → ה-FSM תקוע ב-`cancelling`. ב-MicLarge: state=`cancelling`
מציג `XIcon` (סטטי, שורה 72) **על כפתור עם class `flash-state`** (STATE_CLASS:32 →
אנימציית `flash-fast` ב-MicLarge:118-130). כלומר **הכפתור כולו מהבהב** והאייקון תקוע על X.
התופעה שהמשתמש דיווח ("X שמהבהב לנצח") = הכפתור-המהבהב התקוע במצב cancelling.
התיקון: `cancelTurn()` קורא ל-ACP cancel, הסוכן נעצר, `status` חוזר ל-`connected`,
ה-effect משחרר את `isCancelling`.

**API skeleton**:
```ts
// agent-session.svelte.ts — additive method
/**
 * מבטל את התור הנוכחי (turn) דרך ACP cancel. הסוכן מפסיק לייצר.
 * מחזיר status ל-connected אם היה thinking. no-op אם אין חיבור/לא חושב.
 */
cancelTurn = async (): Promise<void> => {
  if (this.status !== "thinking") return
  if (!this.#client || !this.#sessionId) return
  try {
    await this.#client.cancel(this.#sessionId)
  } catch {
    // best-effort — גם אם cancel נכשל, נחזיר status מקומית
  }
  if (this.status === "thinking") this.#setStatus("connected")
}
```
```ts
// voice-mode.svelte.ts — cancel() מורחב (additive — מוסיף קריאה אחת)
cancel(): void {
  this.isCancelling = true
  this.#mic.cancel()
  this.#speaker.stop()
  void this.#session.cancelTurn()   // ← חדש: מבטל את הסוכן עצמו
}
```
> ⚠️ `voice-mode.svelte.ts` כרגע **לא** מחזיק הפנייה ל-`#session` בתור שדה שמשמש את
> `cancel()` — בדוק: הבנאי כבר מקבל `session` (`opts.session`, שמור ב-`this.#session`).
> אם כן (זה המצב, ראה constructor:49-52) — פשוט קרא `this.#session.cancelTurn()`.

**Verification**:
- `pnpm --filter @drive-coding/frontend typecheck` → 0.
- browser (BE+OneCLI על 4011): שלח פרומפט ארוך, לחץ mic באמצע `thinking` →
  הסוכן נעצר, הכפתור **חוזר ל-idle** (מיקרופון), **לא** נתקע ב-X מהבהב.

---

### Commit 2 — חיווי סטטוס טקסטואלי
**Approach**: manual (UI).

> **i18n מוכן כבר** — `voiceMode.status.{idle,recording,transcribing,thinking,speaking,cancelling}`
> קיימים ב-keys.ts:51-56 + he.ts:40-45 ("מתמלל…"/"חושב…"/"מדבר…"). **אל תוסיף keys חדשים**
> אלא אם חסר משהו.

**קבצים חדשים**:
- `components/chat/StatusIndicator.svelte` — leaf component. קורא `getVoiceMode()`,
  מציג `t(\`voiceMode.status.${voiceMode.state}\`)` + אייקון לפי state. מוסתר כש-`idle`
  (או מציג "מיקרופון" — לפי שיקול עיצוב; ברירת מחדל: הסתר ב-idle כדי לא להעמיס).

**קבצים שמשתנים**:
- `components/chat/RecordFooter.svelte` — **כאן מרונדר MicLarge** (שורה ~99, אומת ע"י אביגיל,
  *לא* chat/+page.svelte). הוסף `<StatusIndicator />` ליד/מעל MicLarge בתוך RecordFooter.
  זה leaf component → שינוי מקומי מותר.

**API skeleton** (component, אין class):
```svelte
<script lang="ts">
  import { getI18n, getVoiceMode } from "$lib/context"
  const voiceMode = getVoiceMode()
  const t = getI18n().t
</script>
{#if voiceMode.state !== "idle"}
  <div class="..." role="status" aria-live="polite">
    {t(`voiceMode.status.${voiceMode.state}`)}
  </div>
{/if}
```
> `aria-live="polite"` — קורא-מסך יקריא את שינוי הסטטוס. חשוב ל-hands-free.

**Verification**:
- typecheck 0, `pnpm lint:i18n` נקי (לא הוספת מחרוזת עברית קשיחה).
- browser: שלח פרומפט → רואים "חושב…" → "מדבר…" → נעלם ב-idle. הקלט → "מקליט…" → "מתמלל…".

---

### Commit 3 — חיבור הקלטות משתמש ל-BE
**Approach**: manual (I/O integration). **verifier-phase אחרי commit זה.**

**קבצים חדשים**:
- `adapters/voice/recordings.ts` — שתי פונקציות I/O:
  ```ts
  import { beUrl } from "$lib/util/be-url"
  import { bytesToBase64 } from "./base64"   // קיים — בשימוש ב-transcribe.ts

  /**
   * שומר blob הקלטה ל-BE, מחזיר recordingId. throws on failure.
   * ⚠️ ה-BE (http-history.ts:73-99) דורש JSON { audioBase64, mimeType } ומחזיר
   * { id } עם status 201 — *לא* body גולמי. שליחת blob ישיר → 400 "invalid json".
   */
  export async function saveRecording(
    blob: Blob,
    opts?: { signal?: AbortSignal },
  ): Promise<{ id: string }> {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const audioBase64 = bytesToBase64(bytes)
    const mimeType = blob.type || "audio/webm"
    const res = await fetch(beUrl("/api/recordings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64, mimeType }),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    })
    if (!res.ok) throw new Error(`saveRecording failed: ${res.status}`)
    return (await res.json()) as { id: string }   // BE מחזיר 201 + { id }
  }
  /** URL לניגון הקלטה לפי id (GET /api/recordings/:id). */
  export function recordingUrl(id: string): string {
    return beUrl(`/api/recordings/${id}`)
  }
  ```
  > **אומת ע"י אביגיל מול http-history.ts:66-98**: גוף = `{ audioBase64, mimeType }`,
  > תגובה = `{ id }` (201). `bytesToBase64` כבר קיים ב-`adapters/voice/base64.ts`.
  > `beUrl` מ-`$lib/util/be-url.ts` (תמיכה ב-cross-origin Settings.beUrl).

**קבצים שמשתנים**:
- `adapters/voice/transcribe.ts` — **הסר** את ה-stub `Promise.resolve({ id: "" })`.
  הוסף פרמטר `blob` נשמר: לאחר/במקביל לתמלול, קרא `saveRecording(blob)`. שמור על
  החתימה `transcribe(blob, opts?)` ועל ה-return `{ text, recordingId }`. עכשיו
  `recordingId` = ה-id האמיתי. **שמירה כושלת לא אמורה להפיל תמלול** — עטוף ב-try/catch
  שמחזיר `recordingId:""` אם השמירה נכשלה (התמלול חשוב יותר).
  > ⚠️ slice sessions-inline שינה את הקובץ הזה (timeout/retry). עבוד **על הבסיס הממוזג** —
  > אל תחזיר את ה-stub. שלב את saveRecording לתוך הזרימה הקיימת.
  > 🛑 **בדיקת base חובה לפני Commit 3**: `grep -n "with-retry\|retryTranscribe" transcribe.ts`.
  > אם **ריק** → ה-base לא מכיל את sessions-inline → **עצור ושאל את מרדכי** (base שגוי,
  > ראה §7). ה-stub שצריך להסיר היום הוא `Promise.resolve({ id: "" })` (transcribe.ts:38
  > בקוד הנוכחי; אחרי merge המספר ישתנה).
- `view-models/mic.svelte.ts` — כבר מעביר `recordingId` ל-`sendPrompt` (mic:93).
  אין שינוי לוגי — recordingId פשוט יהיה אמיתי עכשיו. אמת שזה זורם.

**Verification**:
- typecheck 0.
- browser (BE+OneCLI 4011): הקלט הודעה → אחרי שליחה, `ls packages/backend/data/recordings/`
  מראה קובץ חדש + `index.json` מתעדכן. בועת-המשתמש מקבלת `recordingId` לא-ריק
  (בדוק ב-`window.__session.bubbles` ב-DEV, אם חשוף, או console).
- שגיאת רשת ב-saveRecording → התמלול עדיין עובד (recordingId ריק, אין קריסה).

---

### Commit 4 — adapter + VM להשמעת בועה בודדת
**Approach**: manual (audio/browser).

**קבצים חדשים**:
- `adapters/voice/play-bubble.ts`:
  ```ts
  /** מנגן blob הקלטת-משתמש דרך <audio>. resolves כשהניגון נגמר/בוטל. */
  export function playUserRecording(
    recordingId: string,
    audioEl: HTMLAudioElement,
  ): Promise<void> { /* audioEl.src = recordingUrl(id); play(); await 'ended' */ }

  /** מסנתז TTS לטקסט בועת-סוכן (cache hit ברוב המקרים) ומנגן דרך <audio>.
   *  משתמש ב-synthesizeStreaming הקיים → Blob → objectURL → <audio>. */
  export async function playAgentText(
    text: string,
    voiceId: string,
    audioEl: HTMLAudioElement,
    opts?: { signal?: AbortSignal },
  ): Promise<void> { /* stream→Response→blob→URL.createObjectURL→play */ }
  ```
  > **למה `<audio>` ולא ה-Player/AudioStream**: השמעה חד-פעמית של בועה אחת. ה-Player בנוי
  > לרצף מקטעים עם orderKey (streaming חי). `<audio>` פשוט, מנגן blob שלם, יש לו
  > seek/pause native — שימושי ל-slice C. **אל תיגע ב-Player/Speaker.**
  > `synthesizeStreaming` מחזיר `ReadableStream` — צבור ל-Blob (`new Response(stream).blob()`),
  > `URL.createObjectURL`, נקה ב-`URL.revokeObjectURL` אחרי `ended` (דליפת זיכרון אחרת).

- `view-models/bubble-player.svelte.ts` — VM שמנהל "איזו בועה מתנגנת עכשיו".
  entity לפי חוק זהב #2 (מצב השמעה חי בלי קשר למסך):
  ```ts
  export class BubblePlayer {
    /** id של הבועה המתנגנת כרגע, או null. */
    playingBubbleId: string | null = $state(null)
    readonly #session: AgentSession
    readonly #settings: Settings          // ל-voiceId
    #audioEl: HTMLAudioElement | null = null
    #abort: AbortController | null = null

    constructor(opts: { session: AgentSession; settings: Settings })

    /** מנגן בועה בודדת עד הסוף. לוחץ שוב על אותה בועה → עוצר (toggle). */
    toggle(bubbleId: string): void

    /** עוצר כל ניגון פעיל. */
    stop(): void
  }
  ```
  > guard (החלטת משתמש): **חסום replay כש-`session.status === "thinking"`** — `toggle()`
  > עושה no-op (או stop) אם הסוכן עונה כרגע. בועת-משתמש → `playUserRecording(b.recordingId)`.
  > בועת-message/thought → `playAgentText(טקסט מאוחד מ-segments, settings.voiceId)`.
  > בועת-tool → אין recordingId ואין טקסט להקראה ישיר → דלג (אין ▶).

**קבצים שמשתנים**:
- `context.ts` — הוסף `[getBubblePlayer, setBubblePlayer]` (ADDITIVE, section משלך).
- `routes/+layout.svelte` — `new BubblePlayer({ session, settings })` + setContext
  (המקום היחיד שיוצר VMs). הוסף `destroy` אם צריך ב-onDestroy.

**Verification**:
- typecheck 0.
- browser: (נבדק דרך כפתור ב-Commit 5 — כאן רק שה-VM/adapter נטענים בלי שגיאה).

---

### Commit 5 — כפתור ▶ על הבועות + מצב playing
**Approach**: manual (UI).

**קבצים שמשתנים**:
- `components/chat/bubbles/UserBubble.svelte` — כפתור ▶/⏸ (אם `bubble.recordingId`).
- `components/chat/bubbles/MessageBubble.svelte` — כפתור ▶/⏸.
- `components/chat/bubbles/ThoughtBubble.svelte` — כפתור ▶/⏸ (אופציונלי; אם זמן מספיק).
- כל אחד קורא `getBubblePlayer()`, מציג ▶ כברירת מחדל / ⏸ כש-
  `bubblePlayer.playingBubbleId === bubble.id`, ב-onclick קורא `bubblePlayer.toggle(bubble.id)`.
  הבועה המתנגנת מקבלת הדגשה (class conditional).
  > **i18n**: צריך keys חדשים `bubble.play` / `bubble.stop` (aria-label). הוסף ל-keys.ts +
  > he.ts + en.ts לפי §i18n ב-AGENTS.md.
  > **parallel-safe**: BubbleRenderer/bubbles הם leaf components — שינוי מקומי, לא נוגע
  > ב-switch dispatcher עצמו.

**Verification**:
- typecheck 0, lint:i18n 0.
- browser (BE+OneCLI 4011, סשן אמיתי קצר): לחץ ▶ על בועת-משתמש → ההקלטה שלך מתנגנת.
  לחץ ▶ על בועת-סוכן → TTS מתנגן (cache hit מהיר). לחץ שוב → עוצר. בזמן `thinking`
  כפתור ▶ לא מנגן (no-op). הבועה המתנגנת מודגשת.

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|---|---|
| 1 | typecheck נקי | `pnpm --filter @drive-coding/frontend typecheck` → 0 |
| 2 | lint:i18n נקי | `pnpm lint:i18n` → 0 |
| 3 | tests עוברים | `pnpm --filter @drive-coding/frontend test` → ירוק |
| 4 | **עצירה עובדת** | פרומפט ארוך, לחץ mic ב-thinking → סוכן נעצר, כפתור חוזר ל-idle |
| 5 | **אין X מהבהב** | אחרי עצירה — אין מצב cancelling תקוע. חוזר ל-mic icon |
| 6 | חיווי סטטוס | רצף "חושב…"→"מדבר…"→נעלם; "מקליט…"→"מתמלל…" |
| 7 | **הקלטה נשמרת** | אחרי שליחה קולית, קובץ חדש ב-`data/recordings/` + index.json |
| 8 | recordingId אמיתי | בועת-משתמש עם recordingId לא-ריק |
| 9 | שמירה כושלת לא מפילה | BE כבוי-זמנית בזמן saveRecording → תמלול עדיין שולח (אם בר-בדיקה) |
| 10 | **▶ בועת-משתמש** | מנגן את ההקלטה המקורית |
| 11 | **▶ בועת-סוכן** | מסנתז TTS (cache hit) ומנגן |
| 12 | toggle עוצר | לחיצה שנייה על בועה מתנגנת → עוצר |
| 13 | guard thinking | ▶ לא מנגן בזמן שהסוכן עונה |
| 14 | הדגשת בועה מתנגנת | הבועה הפעילה מודגשת ויזואלית |

---

## §6 — Risks + mitigations

**R1 — התנגשות על transcribe.ts/mic.svelte.ts** (מקור: slice sessions-inline נוגע באותם קבצים).
→ mitigation: base = dev **אחרי** merge של sessions-inline. depends_on מוצהר. אם ה-executor
מגלה שהקבצים לא מכילים את שינויי sessions-inline (timeout/retry) → **עצור, ה-base שגוי**.

**R2 — Hardcoded Hebrew** (pre-commit hook חוסם).
→ Commit 2 משתמש ב-keys קיימים. Commit 5 מוסיף `bubble.play`/`bubble.stop` דרך t(). אין מחרוזת ישירה.

**R3 — Svelte 5 reactivity על array** (push לא מפעיל re-render בלי קריאת .length).
→ הבועות כבר מרונדרות ב-`{#each ... (id)}` קיים. `playingBubbleId` הוא `$state` סקלרי — בטוח.

**R4 — דליפת objectURL** (playAgentText יוצר Blob URL לכל השמעה).
→ `URL.revokeObjectURL` חובה אחרי `ended`/`stop`/`abort`. ציין מפורש ב-Commit 4.

**R5 — $effect שקורא+כותב state** (gotcha 2026-05-16, ה-loop של DDoS).
→ BubblePlayer **לא** משתמש ב-$effect לניגון — `toggle()` הוא method מפורש (קריאה ישירה,
כמו `Mic.toggle()`). אין effect → אין סיכון loop. voice-mode effect הקיים לא משתנה
(רק `cancel()` מקבל קריאה נוספת, לא effect).

**R6 — POST /api/recordings shape** (לא בטוח אם body גולמי או multipart).
→ Commit 3 מורה במפורש לאמת מול http-history.ts:73-97 לפני כתיבת ה-fetch.

**R7 — ACP cancel לא נתמך בכל CLI** (-32601 אפשרי).
→ `cancelTurn` עטוף ב-try/catch + מחזיר status מקומית בכל מקרה. גם אם cancel נכשל,
ה-X-מהבהב מתוקן (status חוזר ל-connected).

---

## §7 — Escalation triggers

עצור ושאל את מרדכי (parent task) אם:
- ה-base (dev) **לא** מכיל את שינויי sessions-inline ב-transcribe.ts → base שגוי.
- POST /api/recordings מחזיר צורה לא צפויה (לא `{ id }`) או דורש auth/multipart מסובך.
- `synthesizeStreaming` לא מחזיר אודיו תקין כ-Blob (MediaSource vs <audio> אי-תאימות).
- ACP cancel גורם לסוכן להיתקע במקום להיעצר (status לא חוזר).
- צריך לגעת ב-Player/Speaker/AudioStream כדי להשמיע בועה בודדת → סימן שהגישה שגויה, שאל.

---

## §8 — Complexity score: 5 → verifier-slice-light

- 5 commits (סביר)
- 2 שכבות חדשות (VM + adapter) — נמוך-בינוני
- 1 API חיצוני (ElevenLabs via proxy, ב-Commit 4) — +1
- אין refactor של state model, אין שינוי protocol BE↔FE
- audio playback (לא streaming pipeline מלא) — +0.5

→ **verifier-slice-light** בסוף + **verifier-phase אחרי Commit 3** (נקודת I/O — חיבור
הקלטות, נקודה היסטורית של באגים).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | StatusIndicator מוסתר ב-idle או מציג "מיקרופון"? | מוסתר ב-idle (פחות עומס ויזואלי) | ❌ |
| 2 | ▶ גם על ThoughtBubble? | כן אם זמן מספיק (Commit 5), אחרת רק user+message | ❌ |
| 3 | playAgentText מנגן segments מאוחדים או משפט-משפט? | מאוחד (בועה בודדת = השמעה אחת רציפה) | ❌ |
| 4 | guard thinking — toggle עושה no-op או stop? | no-op (לא מתחיל; אם כבר מנגן ומגיע thinking — נדיר, stop) | ❌ |
| 5 | bubble-player ל-DEV mock (אין recordings אמיתיות)? | user bubbles ב-mock אין recordingId → ▶ לא מוצג. agent עובד (TTS). תקין | ❌ |

כל השאלות **לא חוסמות** — ברירות מחדל סבירות. executor מחליט ומתעד ב-commit message.
