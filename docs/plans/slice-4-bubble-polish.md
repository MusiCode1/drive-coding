# Slice 4 — Bubble Polish — תוכנית

> **‏תאריך**: 2026-05-29
> **‏סטטוס**: ‏מאושר — ‏עבר 2 ‏סיבובי verifier (general agent), ‏מוכן ל-dispatch
> **‏Complexity**: 8/10 (verifier: heavy + 1 phase verifier)
> **‏תלות**: slice 2 (Speaker, ‏bubble model), slice 3 (VoiceMode), slice 8 (loadSession)
> **‏מתבסס על**: `docs/plans/README.md` (מבנה), `docs/frontend-spec.md §7` (UI spec), `docs/conventions/parallel-safe-code.md` (additive)

---

## §0 — Pre-flight

### ⚠️ ‏אתה ה-Executor

‏אתה הסוכן ‏שמבצע את ‏הbrief הזה — **אל תdelegate** ל-sub-agent נוסף ‏(verifier הוא היחיד שמדelegated במפורש, ‏בנקודות הקבועות ב-§10). ‏אם אתה נתקע על משהו ‏שלא ‏מכוסה ב-brief — ‏עצור ודווח ‏לטמה ‏ב-parent task (לא ל-sub-agent חדש). ‏ראה ‏`learnings.md` 2026-05-29 — "Sonnet build agent לפעמים מ-delegated ל-executor sub-agent".

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-4-bubble-polish -b slice-4-bubble-polish dev
cd .worktrees/slice-4-bubble-polish
pnpm install
pnpm hooks:install
```

### Ports

‏זה ה-worktree היחיד הצפוי לרוץ בזמן הפיתוח (אין parallel slices). ‏ברירת מחדל:

| מה | פקודה |
|---|---|
‏| BE | `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000) |
‏| FE | `pnpm --filter @drive-coding/frontend-v2 dev` (port: ‏OS-assigned, ‏Vite מדפיס בstartup) |

‏**חובה**: ‏BE רץ דרך OneCLI (אחרת כל קריאת TTS/translate/narrate תיכשל 401). ‏ראה `AGENTS.md §Backend MUST run through OneCLI`.

### Tunnel (אופציונלי, ‏לבדיקה ממכשיר חיצוני)

```bash
ssh -i ~/.ssh/pico -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 \
  -R drive-coding:80:localhost:<FE_PORT> tuns.sh http
# → https://your-app.nue.tuns.sh
```

### Browser

‏Chrome מקומי. ‏בדיקה ידנית של קריסת UI, click handling, markdown rendering. ‏אין צורך ב-linux-gui.

### OneCLI agent

‏שם: `voice-acp` (ID: `3f08d584-4da0-4cb4-87b4-9611ae0fa9c0`)
‏מזריק: ‏ElevenLabs (`xi-api-key`) + Google (`x-goog-api-key`)
‏שימוש: `onecli run --agent voice-acp -- <cmd>`

### Reading list

‏**must-read לפני (~‎15 ‏דק'):**

‏1. `packages/frontend/AGENTS.md` — ‏5 חוקי הזהב
‏2. `docs/frontend-spec.md §7` (Chat Bubbles) — ‏ה-spec הקנוני של הסבב הזה
‏3. `docs/conventions/parallel-safe-code.md` — ‏additive design ל-MessageBubble + BubbleRenderer (קבצים משותפים)
‏4. `packages/frontend/src/lib/types/bubble.ts` — ‏ה-types שכבר מוכנים לסבב הזה
‏5. `packages/frontend/src/lib/view-models/speaker.svelte.ts` — ‏הקובץ שמשתנה הכי הרבה ב-Phase 1
‏6. `packages/frontend/src/lib/view-models/agent-session.svelte.ts:228-251` — ‏ה-`#onSessionUpdate` שמקבל handler חדש

‏**reference בזמן עבודה:**

‏- `packages/frontend/src/lib/adapters/voice/translate.ts` — ‏דוגמה ל-adapter שמשתמש ב-`generateObject` + ‏Gemini Flash Lite (תבנית ל-narrate)
‏- `packages/backend/src/delivery/proxy-cache.ts` — ‏אישור ש-`generateContent` נתפס ב-cache (`isCacheableRequest` שורה 32)
‏- `~/.config/opencode/learnings.md` — ‏gotchas רוחביים (Svelte 5 reactivity, ‏OneCLI placeholder pattern, ‏RTL)
‏- `main` ‏branch: `packages/frontend/index.html` ‏לוויזואל markdown styling רפרנס (slice 4 לא משכפל קוד מ-main, ‏רק רואה את הגיאומטריה)

---

## §1 — מטרה

‏אחרי slice 4: ‏ההודעות בצ'אט הופכות **קריאות** במקום פלט גולמי. ‏המשתמש רואה:

‏- ‏**הודעות assistant** מרונדרות עם markdown מלא (headings, ‏bold, ‏italic, ‏lists, ‏inline code, ‏code blocks)
‏- ‏**מחשבות** עם תרגום עברית בולט מעל הטקסט המקורי באנגלית
‏- ‏**קריאות לכלים** מוצגות כ-bubble קומפקטי: ‏narration עברית מ-Gemini למעלה ("‏אני קוראת את foo.ts"), ‏title טכני (`Read /path/to/foo.ts`) ‏מתחת בקטן. ‏click → ‏הרחבה ל-args + ‏result מלאים
‏- ‏RTL alignment נכון: ‏user מימין, ‏agent משמאל, ‏tool במלוא הרוחב
‏- ‏asymmetric border-radius (flat corner בקצה הקרוב לבעלים)

‏טעינה מחדש של סשן (loadSession): ‏אותו דבר חוזר בדיוק, ‏עם cache hits על translations + narrations (כלי + מחשבה שכבר נוצרו פעם → ‏הופעה מיידית, ‏ללא תשלום נוסף).

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
‏| ToolBubble: ‏narration + title + status dot, ‏collapsible | ✅ | Phase 2 |
‏| ToolBubble: ‏args + result expanded view | ✅ | Phase 2 |
‏| ThoughtBubble: ‏HE + EN side-by-side | ✅ | Phase 2 |
‏| MessageBubble: ‏markdown rendering (full) | ✅ | Phase 2 |
‏| RTL alignment + asymmetric border-radius | ✅ | Phase 2 |
‏| Speaker — ‏replay correctness (no auto-speak on loadSession) | ✅ | Phase 1 |
‏| Speaker — ‏write translation back to `ThoughtSegment.originalText` | ✅ | Phase 1 |
‏| Tool call handlers (`tool_call` + `tool_call_update`) | ✅ | Phase 1 |
‏| Narrate adapter (Gemini → ‏Hebrew prose) + cache via BE | ✅ | Phase 1 |
‏| Speaker reads narration aloud (post-narration arrival) | ❌ | follow-up (after slice 4 land) |
‏| Markdown library choice — `marked` + `DOMPurify` | ✅ | Phase 2 (proposed; ‏executor יכול לסטות אם יש סיבה) |
‏| Syntax highlighting בtool result | ❌ | slice 10+ (recordings) — ‏אם נחוץ |
‏| Speaker reads narration of tool calls | ❌ | follow-up. ‏ב-slice 4 narration רק לתצוגה. |
‏| Click להעתיק `result` ל-clipboard | ❌ | future |
‏| Markdown במחשבות עצמן | ❌ | ‏מחשבות נשארות plain text (זה דיבור פנימי, ‏לא formatted output) |

---

## §3 — Architecture diagram

```
‏Layer       │  Phase 1 (Data)              │  Phase 2 (UI)
───────────┼──────────────────────────────┼──────────────────────────────
‏routes/    │                              │  chat/+page.svelte (no change
            │                              │    — uses BubbleRenderer)
            │                              │
‏components/│                              │  ToolBubble.svelte     ← מימוש
            │                              │  ThoughtBubble.svelte  ← מימוש
            │                              │  MessageBubble.svelte  ← markdown
            │                              │  UserBubble.svelte     ← RTL/radius
            │                              │
‏actions/   │                              │  (none)
            │                              │
‏view-models│  agent-session.svelte.ts     │
            │    + tool_call handlers      │
            │    + ToolBubble creation     │
            │  speaker.svelte.ts           │
            │    + originalText writeback  │
            │    + narrate trigger         │
            │    + replay-quiet on load    │
            │                              │
‏engines/   │  (none new)                  │
            │                              │
‏adapters/  │  voice/narrate.ts ← חדש      │
            │  (calls Gemini via BE proxy) │
            │                              │
‏util/      │                              │  markdown.ts ← חדש (renderMarkdown +
            │                              │    DOMPurify sanitize)
            │                              │
‏core/      │  voice/narration-prompt.ts ← קיים! (slice 2 prep)
            │  buildNarratePrompt(ctx, tool) — לא צריך ליצור מחדש
            │  (i18n allowlist /voice/*-prompt.ts כבר תופס אותו)
```

‏ToolBubble status state machine:

```
‏receive tool_call         ──▶ create ToolBubble{ status: pending,
                                                   title, narration: undefined }
‏receive tool_call_update  ──▶ update bubble: { status: in_progress|completed|failed,
                                                  rawInput?, rawOutput? }
‏on status === completed   ──▶ narrate(name, args) ──▶ bubble.narration = text
                                                       (async, fire-and-forget)
```

---

## §4 — Commits

### Phase 1 — Data Layer

#### Commit 1 — Speaker replay correctness (approach: manual)

‏**מטרה**: ‏ב-loadSession Speaker מקבל פתאום N bubbles היסטוריות. ‏ה-`#processBubbles` ‏הנוכחי מנסה ל-enqueue אותן כ-TTS jobs → ‏ההיסטוריה כולה תיקרא בקול. ‏לתקן.

‏**הסיבה ש-`markBubblesAsProcessed()` לבדה לא מספיקה**: ‏Speaker עובד דרך `$effect` על `session.bubbles`. ‏ב-loadSession, ACP replay זורק chunks תוך כדי שהPromise של `loadSession()` ‏ממתין. ‏ה-effect ירוץ עבור כל chunk **תוך כדי** ‏שהreplay מתרחש, ‏לפני שה-`loadSession()` ‏יחזור. ‏מה ש-`markBubblesAsProcessed()` ‏יכול לעשות **אחרי** ‏שהוא ‏יחזור הוא כבר מאוחר — ‏ה-jobs ב-queue. ‏הפתרון חייב להיות **מניעה במקור**: ‏flag ב-AgentSession שSpeaker בודק לפני enqueue.

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/view-models/agent-session.svelte.ts` | ‏שדה `$state` חדש: `isLoadingHistory = $state(false)`. ‏ב-`loadSession()` — ‏set `true` לפני `await acpClient.loadSession(...)`, ‏set `false` ב-`finally`. |
‏| `packages/frontend/src/lib/view-models/speaker.svelte.ts` | ‏ב-`#processBubbles` — ‏בדיקה בראש: ‏`if (this.#session.isLoadingHistory) return` (אחרי שמעדכנים `#bubbleStates` ‏כדי שלא ירדפו אחרי). ‏או יותר נכון: ‏לעבור על bubbles ולעדכן את `processedSegments` ‏ל-`segArr.length` ‏בלי enqueue. ‏ראה skeleton |

‏**API skeleton**:

```ts
// agent-session.svelte.ts
class AgentSession {
  // ... existing
  isLoadingHistory = $state(false)
  
  async loadSession({ cwd, cliKind, sessionId }: {...}): Promise<void> {
    this.isLoadingHistory = true
    try {
      // ... existing acpClient setup
      await this.#client!.loadSession({ cwd, sessionId })
      // ‏replay completed — bubbles populated via #onSessionUpdate callbacks
    } finally {
      this.isLoadingHistory = false
    }
  }
}

// speaker.svelte.ts — modification to #processBubbles
#processBubbles(bubbles: AgentSession["bubbles"], enabled: boolean): void {
  // ‏If history is replaying — mark all current bubbles as processed
  // ‏(no enqueue) so they won't be picked up after replay ends either.
  if (this.#session.isLoadingHistory) {
    for (const bubble of bubbles) {
      if (bubble.kind !== "message" && bubble.kind !== "thought") continue
      let state = this.#bubbleStates.get(bubble.id)
      if (state === undefined) {
        state = { processedSegments: 0, buffer: "" }
        this.#bubbleStates.set(bubble.id, state)
      }
      state.processedSegments = bubble.segments.length
      state.buffer = ""
    }
    return
  }
  // ... existing logic for live bubbles
}
```

‏**גוטשה קריטית — ‏ה-flag חייב להיקרא ב-tracked block של ה-effect, לא בתוך untrack**: ‏הSpeaker effect ‏ב-`speaker.svelte.ts:91-113` ‏בנוי כך:

```ts
$effect(() => {
  // ── Reads (tracked) ──
  const status = this.#session.status
  const enabled = this.enabled
  const bubbles = this.#session.bubbles
  // ... pin seg counts
  
  // ── Writes (untracked) ──
  untrack(() => {
    this.#processBubbles(bubbles, enabled)
    // ...
  })
})
```

‏אם נקרא ‏ל-`this.#session.isLoadingHistory` ‏רק ‏מתוך `#processBubbles` (שרץ ב-untrack), ‏השינוי שלו ‏מ-`true`→`false` ‏בסוף loadSession **לא יטריגר re-run של ה-effect**. ‏ההיסטוריה תיתקע במצב processed=max, ‏אבל chunks חדשים אחרי loadSession **לא יpassu**.

‏**הפתרון**: ‏לקרוא ‏את הflag ב-tracked block ולעבור כפרמטר ‏ל-`#processBubbles`:

```ts
$effect(() => {
  const status = this.#session.status
  const enabled = this.enabled
  const bubbles = this.#session.bubbles
  const isLoadingHistory = this.#session.isLoadingHistory  // ← ‏tracked
  const _segCounts = bubbles.filter(...).map(b => b.segments.length)
  void _segCounts
  
  untrack(() => {
    this.#processBubbles(bubbles, enabled, isLoadingHistory)  // ← ‏param
    this.#handleStatusTransition(status, enabled)
    this.#prevStatus = status
  })
})
```

‏ו-`#processBubbles` ‏מקבל ‏פרמטר נוסף:

```ts
#processBubbles(bubbles: AgentSession["bubbles"], enabled: boolean, isLoadingHistory: boolean): void {
  if (isLoadingHistory) {
    // ... mark all as processed, return
  }
  // ... existing logic
}
```

‏עכשיו ‏גם ‏שינוי ‏ה-flag לבד יטריגר re-run, ‏ו-chunks חדשים שמגיעים אחרי loadSession ימשיכו לזרום ל-TTS.

‏**הערה**: ‏אם executor מעדיף ‏לעטוף ‏ב-public method `markBubblesAsProcessed()` ‏לקריאה ידנית מ-tests — ‏מותר. ‏ה-flag הוא הקווי המרכזי.

‏**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm test
# ‏ידני: ‏start BE+FE, ‏שלח prompt, ‏ראה תגובה, ‏הקש F5, ‏connect מחדש עם
# ‏אותו sessionId דרך session picker, ‏ודא: ‏ה-bubbles מופיעים, ‏אין שום
# ‏TTS playback של ההיסטוריה
```

---

#### Commit 2 — Tool call handlers (approach: manual)

‏**מטרה**: ‏`tool_call` + `tool_call_update` notifications נופלים בשקט. ‏להוסיף cases ב-`#onSessionUpdate`, ‏ליצור ToolBubble כש-tool_call מגיע, ‏לעדכן status כש-tool_call_update.

‏**מחקר נדרש לפני כתיבת קוד** (~‎10 דק', ‏ראה גם הפקודה המדויקת ב-Commit 4 ‏למטה — ‏אותו endpoint, ‏אל תכפיל)

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/view-models/agent-session.svelte.ts` | ‏שני cases חדשים ב-`#onSessionUpdate:240-250`: `tool_call` ו-`tool_call_update`. ‏מתודה פנימית `#handleToolCall` ‏שיוצרת ToolBubble. ‏מתודה פנימית `#handleToolCallUpdate` ‏שמעדכנת bubble קיים לפי toolCallId. ‏שמירה במפה `#toolBubbleByCallId: Map<string, ToolBubble>` ‏ל-O(1) lookup |

‏**API skeleton**:

```ts
// agent-session.svelte.ts (additions)
class AgentSession {
  // ... existing
  
  #toolBubbleByCallId = new Map<string, ToolBubble>()
  
  #onSessionUpdate = (notification: SessionNotification): void => {
    const update = notification.update as {
      sessionUpdate?: string
      // ... existing fields
      toolCallId?: string
      title?: string
      kind?: string                  // ACP ToolKind
      rawInput?: unknown
      rawOutput?: unknown
      status?: "pending" | "in_progress" | "completed" | "failed"
    }
    
    // ... existing cases
    
    if (update.sessionUpdate === "tool_call") {
      this.#handleToolCall(update)
    } else if (update.sessionUpdate === "tool_call_update") {
      this.#handleToolCallUpdate(update)
    }
  }
  
  #handleToolCall(update: { toolCallId?: string; title?: string; kind?: string; rawInput?: unknown; rawOutput?: unknown; status?: ToolCall["status"] }): void {
    if (update.toolCallId === undefined) return
    // ‏הערה: ‏tool_call יכול להגיע ישירות במצב completed עם rawOutput (אם 
    // ‏הסוכן מהיר מאוד או אם opencode מאחד notifications). ‏מטפלים בכל המידע 
    // ‏שיש כבר בnotification ‏הראשון.
    const bubble: ToolBubble = {
      id: crypto.randomUUID(),
      kind: "tool",
      messageId: null,
      createdAt: Date.now(),
      toolCall: {
        toolCallId: update.toolCallId,
        // ‏name = kind אם יש, אחרת title (לא heuristic — שתי האפשרויות 
        // ‏נכונות; UI מציג narration או title, name משמש פנימית בלבד)
        name: update.kind ?? update.title ?? "tool",
        kind: update.kind,
        args: update.rawInput ?? {},
        status: update.status ?? "pending",
        title: update.title,
        narration: undefined,
        result: update.rawOutput,
      },
      segments: [],
    }
    this.bubbles.push(bubble)
    this.#toolBubbleByCallId.set(update.toolCallId, bubble)
  }
  
  #handleToolCallUpdate(update: { toolCallId?: string; status?: ToolCall["status"]; rawOutput?: unknown; kind?: string; title?: string }): void {
    if (update.toolCallId === undefined) return
    const idx = this.bubbles.findIndex((b) => b.kind === "tool" && b.toolCall.toolCallId === update.toolCallId)
    if (idx === -1) return
    const old = this.bubbles[idx] as ToolBubble
    // ‏גוטשה Svelte 5: ‏החלפת אובייקט שלם, לא mutation in-place — ‏מבטיח reactivity
    const newToolCall: ToolCall = {
      ...old.toolCall,
      ...(update.status !== undefined && { status: update.status }),
      ...(update.rawOutput !== undefined && { result: update.rawOutput }),
      ...(update.kind !== undefined && { kind: update.kind }),
      ...(update.title !== undefined && { title: update.title }),
    }
    this.bubbles[idx] = { ...old, toolCall: newToolCall }
  }
}
```

‏**הערה על types** — ‏שינויים הנדרשים ב-`packages/frontend/src/lib/types/bubble.ts`:

```ts
// ToolCall — additive (slice 2 prep type)
export type ToolCall = {
  toolCallId: string
  name: string
  args: unknown
  status: "pending" | "in_progress" | "completed" | "failed"
  title?: string
  narration?: string
  kind?: string         // ← ‏חדש (ACP ToolKind, ‏נדרש ל-narrate prompt)
  result?: unknown      // ← ‏חדש (rawOutput של ACP)
}
```

‏**מחקר נדרש לפני כתיבת קוד** (~‎10 ‏דק'):

‏ACP schema נמצא בpackage `@agentclientprotocol/sdk` (מותקן ‏ב-FE). ‏לקרוא:

```bash
# ‏מ-cwd = packages/frontend/
node -e 'const s = require("@agentclientprotocol/sdk/schema/schema.json"); 
  const upd = s.$defs.SessionUpdate.oneOf; 
  console.log(JSON.stringify(upd.filter(u => JSON.stringify(u).includes("tool_call")), null, 2))'
```

‏לוודא ‏ש: ‏(א) `toolCallId` ‏הוא string חובה ‏ב-`tool_call`; ‏(ב) ‏ה-status enum תואם; ‏(ג) ‏לאמת ‏shape של `rawInput`/`rawOutput`/`kind`/`title`. ‏לתעד גילויים ‏ב-commit message.

‏**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm test
# ‏ידני: ‏prompt שמפעיל tool ("read the README"). ‏פתח devtools console, 
# ‏הרץ: $0 לאחר click על bubble → בודק שיש ToolBubble במצב completed.
```

---

#### Commit 3 — Translation persistence (approach: manual)

‏**מטרה**: ‏Speaker כבר מתרגם thoughts לעברית לפני TTS, ‏אבל זורק את התרגום. ‏לכתוב אותו חזרה ל-`ThoughtSegment.originalText`.

‏**הערה על שם השדה**: ‏השדה ב-types נקרא `originalText` ‏(כלומר ה**מקור** באנגלית). ‏ה-`segment.text` ‏יכיל את **התרגום** ‏(עברית). ‏זה הפוך ממה שמתבקש אינטואיטיבית, ‏אבל מתאים ל-pattern של "‏הטקסט שמוצג הוא ה-`text`" — ‏בעברית. ‏ה-UI ‏יוצג HE (text) ‏גדול + EN (originalText) ‏קטן.

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/view-models/speaker.svelte.ts` | ‏ב-`#fetchJob:224-233` — ‏אחרי `result.text` ‏מתקבל, ‏לעדכן את ה-segment המקורי. ‏הoperation: ‏מצא את ה-bubble לפי `messageId` ‏(או segmentId), ‏מצא את ה-segment, ‏הצב `originalText = job.text` (המקור באנגלית) ‏וגם `text = result.text` (התרגום). ‏צריך גישה ל-session.bubbles — ‏כבר זמין דרך `this.#session` |

‏**API skeleton**:

```ts
// speaker.svelte.ts (modification to #fetchJob)
async #fetchJob(job: TtsJob): Promise<void> {
  try {
    let text = job.text
    if (job.kind === "thought") {
      const result = await translate(text, TARGET_LANG, job.abort.signal)
      if (result !== null && result.status === "translated") {
        // ‏Write back to the segment: text → translated, originalText → source
        this.#persistThoughtTranslation(job.segmentId, job.messageId, result.text)
        text = result.text
      }
      // already_in_target or null → keep original text (originalText נשאר undefined)
    }
    // ... existing TTS code
  }
}

#persistThoughtTranslation(segmentId: string, messageId: string | null, translated: string): void {
  // ‏מאתר את ה-ThoughtBubble המכיל segment שתואם.
  // ‏המבנה הקיים: ‏Speaker רושם jobs לכל sentence, ‏לא לכל segment ‎ב-bubble.
  // ‏הגישה הפשוטה: ‏לכל ThoughtBubble, ‏מצא segment עם הtext שתואם ל-job.text המקורי. 
  // ‏הגישה הנכונה: ‏לעבור ל-jobs שכוללים reference לsegment id מהbubble.
  // ‏החלטה: ‏executor מחליט — ‏אם הגישה הפשוטה עובדת ב-tests, ‏מספיק; ‏אם יש 
  // ‏edge cases (אותו thought נשלח פעמיים), ‏צריך גישה מורחבת.
}
```

‏**גוטשה**: ‏ה-job ה-current מקבל את ה-text שכבר עבר sentence-split. ‏ה-segment המקורי ב-bubble יכול להיות חלק מהsentence (אם split חצה segments) ‏או יותר ‏מ-segment שלם. ‏צריך לחשוב על mapping. ‏זה הסיבה ש-Speaker.enqueue ‏מקבל גם `messageId` — ‏ה-grouping מבטיח שכל ה-segments של אותו thought נמצאים ב-bubble אחד.

‏**גישה מומלצת**: ‏בכל invocation של `enqueue("thought", messageId, sentence)` — ‏השמור reference לbubble.id ו-segments range שהsentence הזה כיסה. ‏אחר כך ב-`#persistThoughtTranslation`, ‏עדכן את כל ה-segments במapping. ‏זה מצריך הרחבה של `TtsJob` עם `bubbleId` + `segmentIds[]`, ‏עדכון signature של `#enqueue` (2 ‏מקומות שקוראים אליה: `#processBubbles:176` ו-`#handleStatusTransition:192`), ‏ועדכון `#processBubbles` ‏שיעביר את ה-segment IDs (יש לו גישה דרך `segArr.slice(state.processedSegments)`).

‏**הערכת גודל ‎מעודכנת**: ~‎40-50 ‏שורות (לא 15 כפי שכתוב במקור). ‏כולל refactor ‏קל ל-`#enqueue` signature. ‏אם executor רואה שזה גדל ‎ל->100 ‏שורות — ‏עצור ושאל את Tama (escalation §7 #6).

‏**Fallback פשוט יותר** (אם הfull mapping מסתבך): ‏לוותר על persistence לסגמנט-ספציפי, ‏ולשמור `originalText` ‏רק על ה-bubble הראשון של כל message group (ב-`agent_thought_chunk` ‏case ב-`#onSessionUpdate`). ‏פשוט יותר, ‏אבל ‏ה-UI יראה ‏את המקור פעם אחת ‏ב-בועה, ‏לא ליד כל segment.

‏**Executor יחליט** ‏בין הגישות לפי מה שעובד נקי. ‏שתי האפשרויות מתקבלות.

‏**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm test
# ‏ידני: ‏prompt שמייצר thought באנגלית, ‏פתח devtools, ‏בדוק 
# ‏session.bubbles[i].segments[j].originalText !== undefined ‏אחרי שה-Speaker סיים
```

---

#### Commit 4 — Narrate adapter + Speaker integration (approach: manual)

‏**מטרה**: ‏adapter חדש `narrate.ts` ‏שקורא ‏ל-`buildNarratePrompt` ‏הקיים ב-core ומחזיר משפט עברית אחד. ‏Speaker מפעיל אותו כש-ToolBubble עובר ל-`completed` (או כבר נוצר ‏ב-`completed`). ‏BE cache מתפסת חזרות אוטומטית.

‏**Approach: manual** — ‏ה-prompt builder **כבר קיים** ‏ב-`packages/core/src/voice/narration-prompt.ts` ‏(טוב ‏יותר ‏ממה שתכננו: ‏מקבל user context + recent messages → ‏narration קונטקסטואלית, ‏לא רק טכנית). ‏אנחנו רק ‏עוטפים ‏אותו ‏ב-adapter ומחווטים את הcontext.

‏**הקובץ הקיים (אומת)**:

```ts
// packages/core/src/voice/narration-prompt.ts (קיים, אל תיצור מחדש!)
export interface NarrateContext {
  userMessage: string         // ‏מה שהמשתמש אמר (post-STT)
  recentMessages: string[]    // ‏FIFO max 3 הודעות assistant אחרונות
}
export interface ToolCallForNarrate {
  toolCallId: string
  kind?: string               // ACP ToolKind: read/edit/execute/search/think
  title: string
}
export function buildNarratePrompt(ctx: NarrateContext, tool: ToolCallForNarrate): string
```

‏**קבצים חדשים**:

| ‏קובץ | ‏מטרה |
|---|---|
‏| `packages/frontend/src/lib/adapters/voice/narrate.ts` | ‏פונקציה `narrate(ctx, tool, signal?)` ‏שקוראת ‏ל-`generateText` ‏(string פשוט, ‏לא JSON) ‏דרך googleAi |

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/view-models/agent-session.svelte.ts` | ‏(1) ‏שדה `$state` ‏חדש: `lastUserMessage = $state("")`. ‏עדכון ב-`sendPrompt` ‏(שורה ~‎145, ‏אחרי שה-text התקבל). ‏(2) ‏method ‏חדש: `recentAssistantMessages(n: number = 3): string[]` — ‏עוברת על `bubbles` ‏מהסוף, ‏אוספת עד n MessageBubbles כ-strings (`segments.map(s => s.text).join("")`), ‏מחזירה ‏בסדר היסטורי |
‏| `packages/frontend/src/lib/view-models/speaker.svelte.ts` | ‏effect חדש (או ‏בתוך ‏effect קיים) ‏שעוקב אחרי ToolBubbles. ‏לכל ToolBubble ש-`status === "completed"` ‏ו-`narration === undefined` — ‏מפעיל `narrate(ctx, tool)`. ‏אחרי הצלחה: ‏החלפת ה-bubble כולה (ראה גוטשה Svelte 5 ‏ב-§6) |
‏| `packages/frontend/src/lib/types/bubble.ts` | ‏הוספת `kind?: string` ‏ל-`ToolCall` ‏(נדרש כקלט ל-`buildNarratePrompt`) |

‏**API skeleton**:

```ts
// packages/frontend/src/lib/adapters/voice/narrate.ts
import { generateText } from "ai"
import { googleAi } from "./sdks"
import {
  buildNarratePrompt,
  type NarrateContext,
  type ToolCallForNarrate,
} from "@drive-coding/core/voice/narration-prompt"

const TIMEOUT_MS = 3000

export async function narrate(
  ctx: NarrateContext,
  tool: ToolCallForNarrate,
  signal?: AbortSignal,
): Promise<string | null> {
  const prompt = buildNarratePrompt(ctx, tool)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  signal?.addEventListener("abort", () => ac.abort(), { once: true })
  try {
    const result = await generateText({
      model: googleAi("gemini-flash-lite-latest"),
      prompt,
      abortSignal: ac.signal,
    })
    const text = result.text.trim()
    if (text.length === 0) return null
    return text
  } catch (e) {
    console.warn("narrate failed", { err: e instanceof Error ? e.message : String(e) })
    return null
  } finally {
    clearTimeout(timer)
  }
}
```

‏**Speaker integration skeleton**:

```ts
// speaker.svelte.ts (תוספת — או ב-#processBubbles או ב-effect נפרד)
#processToolBubbles(): void {
  if (this.#session.isLoadingHistory) return
  for (const bubble of this.#session.bubbles) {
    if (bubble.kind !== "tool") continue
    const tc = bubble.toolCall
    if (tc.status !== "completed") continue
    if (tc.narration !== undefined) continue  // ‏כבר יש
    if (this.#narratingCallIds.has(tc.toolCallId)) continue  // ‏בעבודה
    this.#narratingCallIds.add(tc.toolCallId)
    
    const ctx: NarrateContext = {
      userMessage: this.#session.lastUserMessage,
      recentMessages: this.#session.recentAssistantMessages(3),  // ‏helper
    }
    const tool: ToolCallForNarrate = {
      toolCallId: tc.toolCallId,
      kind: tc.kind,
      title: tc.title ?? tc.name,
    }
    void narrate(ctx, tool).then((text) => {
      this.#narratingCallIds.delete(tc.toolCallId)
      if (text === null) return
      // ‏גוטשה Svelte 5: ‏החלפת ה-bubble כולה (עקבי עם #handleToolCallUpdate
      // ‏ב-Commit 2 — patterns אחידים מקלים על verifier)
      const idx = this.#session.bubbles.findIndex((b) => b.id === bubble.id)
      if (idx === -1) return  // ‏bubble כבר נמחקה
      const old = this.#session.bubbles[idx] as ToolBubble
      this.#session.bubbles[idx] = {
        ...old,
        toolCall: { ...old.toolCall, narration: text },
      }
    })
  }
}
```

‏**גוטשה ‎ל-cache**: ‏ה-prompt חייב להיות **deterministic**. ‏הקיים `buildNarratePrompt` ‏מבסס על `ctx.userMessage`, ‏`ctx.recentMessages`, ‏`tool.title`. ‏`tool.title` ‏בא מ-ACP — ‏deterministic לאותו tool call. ‏`ctx.userMessage` ‏זהה ‏לאותו ‏סשן. ‏`recentMessages` ‏זהה אם ההיסטוריה זהה. ‏ב-replay של אותה סשן → ‏cache hit. ‏ב-recreate של אותה תגובה ‏בסשן אחר → ‏cache miss (סביר, ‏לא קריטי).

‏**גוטשה ל-`extractToolNameFromTitle`** (מ-Commit 2): ‏ה-heuristic של regex על capitalized prefix שביר. ‏הכלל הנכון: ‏`tool.kind ?? title`. ‏לא מציגים את ‎`name` ‏ב-UI ‏(UI מציג `narration` ‏או ‎`title`).

‏**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
# ‏ידני: ‏prompt "‏read the README briefly" → ‏ToolBubble נוצרת → ‏אחרי 1-2 ‏שניות 
# ‏narration מופיע. ‏בדוק BE log: ‏יש קריאה ל-`POST /v1beta/models/...generateContent`.
# ‏שלח אותו prompt שוב באותה סשן → ‏BE log: `proxy cache hit`.
```

---

### ↑ Phase 1 boundary ↑ — `Task(subagent_type="verifier-phase", phase=1)`

‏**הbrief לverifier-phase**:

> ‏בדוק את ה-DoD של Phase 1 בbrief: ‏4 commits (Speaker replay fix, ‏tool handlers, ‏translation persistence, ‏narrate adapter). ‏הרץ typecheck, ‏tests, ‏ובדיקה ידנית (start BE + FE, ‏שלח prompt שמפעיל tool — ‏ודא ‏ש-ToolBubble נוצרת, ‏ש-narration מתעדכנת ב-bubble אחרי ~‎2 ‏שניות, ‏ש-thought.originalText מאוכלסת, ‏ש-loadSession לא מפעיל TTS על ההיסטוריה). ‏Brief: `docs/plans/slice-4-bubble-polish.md`. ‏אם NEEDS REVISION — ‏עצור וחזור ל-Tama. ‏אם GO — ‏המשך ל-Phase 2.

---

### Phase 2 — UI Layer

#### Commit 5 — ToolBubble.svelte (approach: manual)

‏**מטרה**: ‏מימוש מלא של ToolBubble — ‏collapsible, ‏narration prominent, ‏title small, ‏status dot, ‏expanded view מציג args + result.

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte` | ‏מימוש מלא. ‏Header עם status dot + narration (אם יש) או title. ‏פירוט בתוך `<details>` ‏עם args + result. ‏click handler על כל ה-bubble (כיוון ש-`<details>` ‏מקפץ רק על summary, ‏צריך click delegation על ה-container) |
‏| `packages/core/src/i18n/keys.ts` + ‏`catalogs/{he,en}.ts` | ‏3-4 ‏keys חדשים: ‏`chat.tool.status.pending`, ‏`.in_progress`, ‏`.completed`, ‏`.failed`, `chat.tool.args`, ‏`chat.tool.result`, ‏`chat.tool.loading_narration` (placeholder text) |

‏**API/UX skeleton**:

```svelte
<script lang="ts">
import type { ToolBubble } from "$lib/types/bubble"
import { getI18n } from "$lib/context"

let { bubble }: { bubble: ToolBubble } = $props()
let expanded = $state(false)

const t = getI18n().t
const tc = $derived(bubble.toolCall)
const showNarration = $derived(tc.narration !== undefined && tc.narration.length > 0)
</script>

<button
  class="bubble bubble-tool"
  class:expanded
  onclick={() => expanded = !expanded}
  type="button"
>
  <div class="header">
    <span class="status-dot status-{tc.status}" aria-hidden="true"></span>
    <div class="header-text">
      {#if showNarration}
        <div class="narration" dir="auto">{tc.narration}</div>
      {:else}
        <div class="narration loading">{t("chat.tool.loading_narration")}</div>
      {/if}
      {#if tc.title}
        <div class="title" dir="ltr">{tc.title}</div>
      {/if}
    </div>
    <span class="arrow" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
  </div>
  
  {#if expanded}
    <div class="details" dir="ltr">
      <div class="section">
        <div class="section-label">{t("chat.tool.args")}</div>
        <pre>{JSON.stringify(tc.args, null, 2)}</pre>
      </div>
      {#if (tc as ToolCall & { result?: unknown }).result !== undefined}
        <div class="section">
          <div class="section-label">{t("chat.tool.result")}</div>
          <pre>{formatResult((tc as ToolCall & { result?: unknown }).result)}</pre>
        </div>
      {/if}
    </div>
  {/if}
</button>

<style>
  .bubble-tool {
    /* ‏full width ‎per frontend-spec §7 */
    align-self: stretch;
    /* ‏... */
  }
  /* status dots: pending=gray, in_progress=orange+pulse, completed=green, failed=red */
</style>
```

‏**גוטשה accessibility**: ‏`<button>` ‏עוטף את ה-`.bubble` ‏(לא `<div role="button">`) — ‏מקבל native keyboard + ‏screen reader treatment. ‏`<details>` ‏יכול להיות גם אופציה, ‏אבל הוא נותן פחות שליטה על visual state.

‏**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n  # ‏ודא שכל מחרוזת חדשה ‏עברה דרך t()
# ‏ידני: ‏tool call → ‏בדוק collapsed view (narration + title small), click → ‏פתיחה, ‏click שוב → ‏סגירה
```

---

#### Commit 6 — ThoughtBubble.svelte: HE + EN side-by-side (approach: manual)

‏**מטרה**: ‏מציג את התרגום העברית בולט + ‏המקור באנגלית קטן.

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/components/chat/bubbles/ThoughtBubble.svelte` | ‏Layout: ‏לכל segment, ‏אם יש `originalText` — ‏הצג text (HE) ‏גדול + ‏originalText (EN) ‏בקטן/אפור מתחת. ‏אם אין — ‏רק text כמו עכשיו (no-op fallback). ‏ה-`{#each}` ‏עובר כבר לפי `(seg.id)` ‏key — ‏שמור |

‏**Skeleton**:

```svelte
<script lang="ts">
import type { ThoughtBubble } from "$lib/types/bubble"
import { getI18n } from "$lib/context"

let { bubble }: { bubble: ThoughtBubble } = $props()
const t = getI18n().t
</script>

<div class="bubble bubble-thought">
  <div class="kind-label">{t("chat.bubble.thought")}</div>
  {#each bubble.segments as seg (seg.id)}
    <div class="segment">
      <div class="translated" dir="auto">{seg.text}</div>
      {#if seg.originalText !== undefined}
        <div class="original" dir="ltr">{seg.originalText}</div>
      {/if}
    </div>
  {/each}
  <span class="hidden">{bubble.segments.length}</span>
</div>

<style>
  /* ... existing styles ... */
  .segment { margin-bottom: 0.4em; }
  .translated { /* HE prominent */ }
  .original { font-size: 0.85em; opacity: 0.6; margin-top: 2px; }
</style>
```

‏**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
# ‏ידני: ‏prompt שמייצר thought → ‏בדוק HE+EN מופיע אחרי 2-3 ‏שניות (אחרי שהtranslation חוזר)
```

---

#### Commit 7 — Markdown rendering + sanitization (approach: mixed)

‏**מטרה**: ‏MessageBubble מרנדר markdown מלא. ‏שילוב `marked` + ‏`DOMPurify`.

‏**Library install**:

```bash
pnpm --filter @drive-coding/frontend-v2 add marked dompurify
pnpm --filter @drive-coding/frontend-v2 add -D @types/dompurify
# (marked ‎מגיע עם types מובנים)
```

‏**קבצים חדשים**:

| ‏קובץ | ‏מטרה |
|---|---|
‏| `packages/frontend/src/lib/util/markdown.ts` | ‏פונקציה `renderMarkdown(text: string): string` — ‏marked → ‏DOMPurify → ‏HTML מחוטא. ‏Conservative DOMPurify config: ‏מאפשר רק טקסט + ‏inline tags + ‏headings + ‏lists + ‏code. ‏אוסר `<script>`, ‏event handlers, ‏href שלא https/relative |
‏| `packages/frontend/src/lib/util/markdown.test.ts` | TDD: ‏~‎6 ‏tests. ‏basic markdown → ‏HTML. ‏XSS attempts → ‏stripped. ‏Hebrew text → ‏preserved. ‏empty input → ‏empty output |

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/components/chat/bubbles/MessageBubble.svelte` | ‏החלפת `<span>{seg.text}</span>` ‏ב-`{@html renderMarkdown(seg.text)}`. ‏הוספת `<style>` ‏ל-`.bubble :global(...)` ‏לעיצוב markdown elements (p, ‏h1-h4, ‏ul, ‏ol, ‏code, ‏pre) ‏לפי frontend-spec §7 "Markdown rendering" |
‏| `packages/frontend/package.json` | ‏אוטומטית ע"י `pnpm add` |

‏**ארגומנט ל-DOMPurify**:

```ts
import DOMPurify from "dompurify"

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "code", "pre", "blockquote",
  "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "a", "hr",
]
const ALLOWED_ATTR = ["href", "title", "lang", "dir"]

export function renderMarkdown(text: string): string {
  if (text.length === 0) return ""
  const html = marked.parse(text, { async: false, breaks: true, gfm: true }) as string
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  })
}
```

‏**גוטשה ‏RTL ב-markdown**: ‏עברית בתוך paragraph אנגלית עלולה להתבלגן. ‏ההצעה: ‏`<div dir="auto">` ‏סביב ה-{@html} ‏ב-MessageBubble (לא בתוך ה-renderMarkdown — ‏שיהיה pure HTML). ‏הbrowser ‏יחליט direction per-paragraph.

‏**גוטשה ‎ל-streaming**: ‏ה-message מצטבר chunks. ‏אם נריץ renderMarkdown על כל chunk — ‏ייתכן partial markdown ("**bold" ‏בלי הסוגרים הסוגרים). ‏marked מטפל בזה בסבירות. ‏לבדוק ידנית עם streaming.

‏**Verification**:

```bash
pnpm test  # markdown.test.ts
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
# ‏ידני: ‏prompt שמייצר markdown (למרות הplugin — בודק edge cases).
# ‏לדוגמה: "show me a python hello world example in a code block"
# ‏ודא: ‏code block מרונדר, ‏inline code מרונדר, ‏אין XSS (try: prompt 
# ‏"output exactly this: <img src=x onerror=alert(1)>" — ‏לוודא שהimg נחתך)
```

---

#### Commit 8 — RTL alignment + asymmetric border-radius + walkthrough (approach: manual)

‏**מטרה**: ‏סיום עיצוב לפי frontend-spec §7. ‏user מימין, ‏agent משמאל, ‏tool ברוחב מלא. ‏עדכון walkthrough.

‏**קבצים שמשתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
‏| `packages/frontend/src/lib/components/chat/bubbles/UserBubble.svelte` | ‏`align-self: flex-start` (ימין ב-RTL), ‏`border-bottom-right-radius: 4px` (asymmetric flat) |
‏| `packages/frontend/src/lib/components/chat/bubbles/MessageBubble.svelte` | ‏`align-self: flex-end` (שמאל ב-RTL), ‏`border-bottom-left-radius: 4px` |
‏| `packages/frontend/src/lib/components/chat/bubbles/ThoughtBubble.svelte` | ‏`align-self: flex-end` + `opacity: 0.85` (כבר בקיים — ‏לוודא) |
‏| `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte` | ‏`align-self: stretch` (כבר בcommit 5) |
‏| `docs/walkthrough.md` | ‏רשומה חדשה ב-Top |
‏| `packages/frontend/docs/slices.md` | ‏slice 4 ‏סטטוס → ✅ |
‏| `docs/plans/slice-4-bubble-polish.md` (זה) | ‏סטטוס → "‏הושלם", ‏סטיות (אם יש) |

‏**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n
pnpm test
# ‏ידני visual: ‏צ'אט עם 2-3 turns, ‏ודא alignment + ‏asymmetric corners
```

---

### ↑ Phase 2 boundary ↑ — `Task(subagent_type="verifier-slice-heavy")`

‏**הbrief לverifier**:

> ‏בדוק את slice 4 כולה. ‏8 commits ב-`.worktrees/slice-4-bubble-polish/`. ‏Brief מלא: ‏`docs/plans/slice-4-bubble-polish.md`. ‏Base commit: `dfe09e5` (לפני slice). ‏פתח BE + FE, ‏בצע flows: ‏(א) ‏prompt רגיל → ‏בדוק bubble אופן, ‏markdown, ‏thought translation; ‏(ב) ‏prompt שמפעיל tool → ‏בדוק ToolBubble, ‏narration, ‏collapse/expand; ‏(ג) F5 + ‏reconnect ל-sessionId → ‏בדוק שההיסטוריה חוזרת בלי TTS auto-play; ‏(ד) ‏XSS attempt; ‏(ה) ‏רגרסיה: ‏VoiceMode + ‏Mic + ‏Speaker עדיין עובדים. ‏אם NEEDS REVISION — ‏רשום פירוט; ‏אם GO — ‏מוכן ל-merge.

---

## §5 — DoD

| # | ‏בדיקה | ‏איך |
|---|---|---|
‏| 1 | `pnpm typecheck` ‏ירוק | ‏אוטומטי |
‏| 2 | `pnpm test` ירוק | ‏לפחות 356 (אותו מספר) + ‏tests חדשים של markdown.test.ts |
‏| 3 | `pnpm lint:i18n` ‏ירוק | ‏אוטומטי |
‏| 4 | `pnpm --filter @drive-coding/frontend-v2 build` ירוק | ‏אוטומטי |
‏| 5 | ‏smoke `chat-roundtrip.mjs` עובר | `node tests/smoke/chat-roundtrip.mjs` |
‏| 6 | ‏tool_call יוצר ToolBubble (manual) | ‏prompt: "read the README briefly" |
‏| 7 | ‏ToolBubble.narration מתעדכן ~‎2s ‏אחרי completed (Svelte 5 reactivity!) | ‏devtools: ‏`$0` ‏על ‏bubble אחרי click. ‏אם UI לא מתעדכן — ‏הassignment הוא in-place ‏ולא החלפת אובייקט. ‏ראה skeleton Commit 4 |
‏| 8 | ‏click על ToolBubble → ‏expand מציג args + result | ‏visual |
‏| 9 | ‏ThoughtBubble מציג HE + EN | ‏prompt שמפעיל thinking בolopencode |
‏| 10 | ‏MessageBubble מרנדר markdown | ‏prompt: "show python hello world in a code block" |
‏| 11 | ‏XSS attempt נחסם | ‏prompt: ‏`output: <img src=x onerror=alert(1)>` ‏— ‏בדוק שאין alert |
‏| 12 | ‏RTL: ‏user ימין, ‏agent שמאל | ‏visual |
‏| 13 | ‏loadSession: ‏היסטוריה חוזרת, ‏אין TTS playback אוטומטי | ‏F5 + reconnect |
‏| 14 | ‏BE proxy cache hit על narrate חוזר | ‏BE log אחרי prompt שני זהה |
‏| 15 | ‏Walkthrough עודכן + ‏slices.md ‏סטטוס ✅ | ‏visual |

---

## §6 — Risks + mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
‏| 1 | XSS דרך {@html renderMarkdown} | OWASP / ‏general | DOMPurify עם ALLOWED_TAGS ‏מוגבל. Test ייעודי. |
‏| 2 | Svelte 5 reactivity על `bubble.toolCall.narration` (assignment על שדה nested) | learnings 2026-05-16 ‏(Svelte 5 $effect infinite loop) | ‏השמה ישירה דרך proxy ($state recursive) ‏מטריגרת re-render. ‏לוודא ש-AgentSession.bubbles הוא `$state`. ‏אם הconsumer לא מתעדכן — ‏לעטוף הassignment ב-`untrack()` או לעדכן את ה-bubble דרך החלפת אובייקט שלם |
‏| 3 | Cache miss על narrate בגלל JSON.stringify key order | proxy-cache שורה 43 (sha256 על body) | ‏Document. ‏אם בעיה בפועל — ‏follow-up עם canonical JSON. ‏ב-MVP, ‏fallback ל-API call הוא ‏אוקיי |
‏| 4 | Markdown library bundle size | general | `marked` ~‎50KB, `DOMPurify` ~‎60KB. ‏סה"כ ~‎110KB nezipped. ‏לבדוק build size אחרי הוספה — ‏אם יותר מ-‎30% ‏גידול, ‏לדון על חלופה (microMark) |
‏| 5 | Streaming markdown — ‏partial render גורם ‎לflicker | edge case | ‏marked מטפל בזה ‎בסבירות, ‏אבל לבדוק ידנית. ‏אם flicker — ‏debounce render על stream end, ‏אבל זה מוסיף latency. ‏החלטה ב-executor אחרי בדיקה |
‏| 6 | Hardcoded Hebrew במחרוזות UI חדשות | i18n lint | ‏כל מחרוזת חדשה → `t(key)`. ‏הbrief מצוין שיש 5-7 ‏keys חדשים — ‏לוודא שכולם ב-`packages/core/src/i18n/keys.ts` + ‏שני catalogs |
‏| 7 | Speaker reactivity על נחילי bubbles ב-loadSession | learnings replay correctness | Commit 1 ‏מטפל מפורש. ‏Verifier מבצע F5 test |
‏| 8 | OneCLI לא מזריק Google credentials לnarrate | learnings 2026-05-16 (OneCLI placeholder pattern) | ‏narrate משתמש באותו `googleAi(...)` ‏מ-`sdks.ts` ‏(שכבר עובד עבור translate) — ‏אם translate עובד, ‏narrate יעבוד |
‏| 9 | ACP `tool_call` notification shape שונה ממה שמשוער | brief assumption | Commit 2 דורש 10 דק' מחקר ‏מקדים ב-`@agentclientprotocol/sdk` schema. ‏לתעד גילויים |
‏| 10 | Click handler על `<button>` עם `<pre>` בפנים — ‏טקסט לא ניתן לבחירה | UX | ‏לעטוף ‎ב-`<button>` ‏רק את ה-header. ‏האזור ‎`.details` ‏יהיה ‎`<div>` ‏רגיל. ‏או להוסיף ‎`onclick:capture` ‏עם ‎stopPropagation על ‎`<pre>` |

---

## §7 — Escalation triggers

‏עצור ושאל את Tama בparent task אם:

‏1. ‏ACP `tool_call` notification shape שונה מהותית ממה שמשוער (חסר `toolCallId`? ‏מבנה args מקונן עמוק?)
‏2. ‏Speaker reactivity על `bubble.toolCall.narration` ‏לא מטריגר re-render אחרי 30 ‏דק' של ניסיונות
‏3. ‏Markdown library: ‏marked + DOMPurify לא עובדים יחד ב-SvelteKit static (build error) — ‏הצעת חלופה
‏4. ‏BE proxy cache לא תופס narrate (אפילו prompt שני זהה → ‏miss) — ‏יכול להיות bug בproxy-cache, ‏לא ‏slice 4
‏5. ‏RTL: ‏עברית בתוך paragraph עם markdown אנגלי מתנהג בצורה שבורה שלא ניתן לפתור עם `dir="auto"`
‏6. ‏שינוי ‎ב-`agent-session.svelte.ts` ‏מצריך שינוי ‏ב-`Speaker` ‏או ‏ב-`VoiceMode` ‏שדורש איטרציה ארוכה — ‏כנראה מבנה חסר

---

## §8 — Complexity score: 8/10

| ‏פקטור | ‏ניקוד |
|---|---|
‏| ‏מספר commits (8) | +2 |
‏| ‏מספר שכבות חדשות (adapter, util, multiple components) | +2 |
‏| ‏אינטגרציה עם APIs חיצוניים (Gemini ‏narrate) | +1 |
‏| ‏Streaming/async pipelines (narrate async + bubble update) | +1 |
‏| ‏Refactor של state (Speaker writeback, TtsJob enrichment) | +1 |
‏| ‏Library חדש (marked + DOMPurify) | +1 |
‏| ‏סה"כ | **8** |

‏**Verifier**: ‏`verifier-slice-heavy` ‏בסוף Phase 2. ‏בנוסף `verifier-phase` ‏אחרי Phase 1 (data layer).

‏**Phase verifier brief**:

```
‏בדוק את ה-DoD של Phase 1 (4 commits) בbrief slice-4-bubble-polish.md.
‏Worktree: .worktrees/slice-4-bubble-polish/
‏Base commit: dfe09e5
‏הרץ: typecheck, tests, ‏ובדיקה ידנית:
‏  1. ‏start BE + FE
‏  2. ‏prompt "‏read the README briefly" → ‏ToolBubble נוצרת, ‏narration מתעדכנת ‎ב-~2s
‏  3. ‏אותו prompt שוב → ‏BE log: cache hit על narrate
‏  4. ‏F5 + reconnect ל-session → ‏היסטוריה חוזרת, ‏Speaker שקט (אין TTS)
‏  5. ‏בדוק $0.toolCall.narration ‏ועל thought: ‏originalText מאוכלסת
‏אם NEEDS REVISION → ‏עצור ודווח לTama. ‏אם GO → ‏המשך ל-Phase 2.
```

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
‏| 1 | ‏Markdown library: `marked` + `DOMPurify` | ‏שילוב סטנדרטי, ‏Svelte-agnostic. ‏אם executor מעדיף `markdown-it` או `micromark` — ‏OK ‏אם DOMPurify נשאר | ❌ |
‏| 2 | ToolCall `result` type extension — ‏לbubble.ts? | ‏הוסף `result?: unknown` ל-`ToolCall`. ‏Additive | ❌ |
‏| 3 | ‏מי מחזיק את ה-`#toolBubbleByCallId` map? AgentSession? | ‏כן, ‏שייך ל-AgentSession (יצירה + ‏עדכון של bubbles) | ❌ |
‏| 4 | Narrate cache stability עם JSON.stringify | ‏Document risk, ‏לא מתקנים ב-MVP. ‏Cache miss = ‏fallback ל-API ‏(זול) | ❌ |
‏| 5 | ‏Speaker reactivity על `bubble.toolCall.narration` ‏עדכון | ‏**נסגר**: ‏החלפת toolCall כאובייקט שלם (לא in-place), ‏וכל הbubble כולל ה-toolCall נכנס דרך `bubbles[idx] = {...old, toolCall: newToolCall}`. ‏ראה skeletons ב-Commit 2 + Commit 4 | ❌ |
‏| 6 | Speaker יקרא narration בקול? | ❌ ‏לא ב-slice 4. ‏follow-up אחרי slice 4 land — ‏commit קטן שמרחיב את ה-TtsJob types ל-`narration` kind | ❌ |
‏| 7 | ‏Code blocks ב-markdown — ‏syntax highlighting? | ❌ ‏לא ב-slice 4. ‏slice עתידי, ‏אופציונלי | ❌ |
‏| 8 | ‏RTL: ‏עברית במשפט עם code inline (`` `function` `` ‏באמצע עברית) | ‏`dir="auto"` ‏על ה-container, ‏הbrowser מטפל | ❌ |
‏| 9 | ‏בדיקת bundle size אחרי הוספת marked+DOMPurify | ‏אם > 30% גידול — ‏discuss. ‏בinitial estimate ~‎110KB → ‏לכ-5% ‏מ-bundle | ❌ |
‏| 10 | ‏Speaker `markBubblesAsProcessed()` ‏יחיד או פר loadSession invocation? | ‏יחיד, ‏public, ‏נקרא מ-AgentSession.loadSession() ‏אחרי שה-replay מסתיים | ❌ |

---

## §10 — Execution flow ל-executor

‏סוכן אחד, ‏סשן אחד, ‏רצף קבוע:

```
‏[ Phase 1 — Data Layer ]
‏  Commit 1: ‏Speaker replay correctness
‏  Commit 2: ‏Tool call handlers
‏  Commit 3: ‏Translation persistence
‏  Commit 4: ‏Narrate adapter + Speaker integration
‏  ──────────────────────────────────────────────
‏  Task(subagent_type="verifier-phase", phase=1, brief, base=dfe09e5)
‏    אם NEEDS REVISION → ‏עצור, ‏דווח ל-Tama (parent task), ‏אל תמשיך
‏    אם GO → ‏המשך
‏  ──────────────────────────────────────────────
‏[ Phase 2 — UI Layer ]
‏  Commit 5: ‏ToolBubble.svelte
‏  Commit 6: ‏ThoughtBubble HE+EN
‏  Commit 7: ‏Markdown rendering
‏  Commit 8: ‏RTL + asymmetric radius + walkthrough
‏  ──────────────────────────────────────────────
‏  Task(subagent_type="verifier-slice-heavy", brief, base=dfe09e5)
‏    אם NEEDS REVISION → ‏תקן issues, ‏הרץ verifier שוב
‏    אם GO → ‏דווח ל-Tama, ‏ready ל-merge
```

‏**‎חוקי handoff**:

‏1. ‏אם verifier-phase מחזיר NEEDS REVISION — **‏אסור ‏להתחיל Phase 2**. ‏לעצור ולדווח לTama.
‏2. ‏בכל commit — ‏typecheck + lint:i18n ‏חייבים להיות ירוקים לפני git add.
‏3. ‏ה-pre-commit hook ירוק (`.githooks/pre-commit`) — ‏אם אדום, ‏תקן את הסיבה ולא `--no-verify`.
‏4. ‏סטיות מהbrief: ‏לתעד ‎ב-walkthrough תחת "‏סטיות מהתכנון".

---

## ‏מה אחרי slice 4

‏Follow-up מיידי (slice קטן ~‎50 שורות):

‏- ‏Speaker קורא narration של ToolBubble בקול (drive-first). ‏מצריך הרחבת `TtsJob.kind` ‏מ-`message | thought` ל-`message | thought | tool_narration`. ‏ה-pipeline זהה — ‏רק עוד case ב-`#processBubbles` ‏שצופה ‏ב-ToolBubbles עם narration חדש.

‏Slices קרובים אחרים שמשפרים את אותו flow:

‏- ‏slice 9 (Settings): ‏voice picker, ‏cue toggles. ‏לא חופף, ‏אבל בונה על ThoughtBubble + Settings VM.
‏- ‏slice 5 (Smart scroll): ‏auto-scroll עם jump-down button. ‏עצמאי.
