# Slice fix — turnState stuck → idle (NBug1/2/3 מ-calev NO-GO) — תוכנית

> **תאריך**: 2026-06-03
> **סטטוס**: הושלם (2026-06-09)
> **Complexity**: 3/10 (verifier: light + verifier-phase אחרי Commit 2)
> **תלות**: fix-up **על** branch `slice-model-status-control-replay` (לא מוזג ל-dev).
>           depends_on: [] (לא תלוי בסליס אחר; נכתב על אותו worktree).

---

## רקע — למה ה-fix הזה

‏ה-slice `model-status-control-replay` קיבל **calev-heavy NO-GO** (3 blockers).
‏הדוח: `reports/voice-acp/slice-model-status-control-replay-calev.md`.
‏**הרציונל המלא + 4 ה-probes שעיצבו את ה-fix: `docs/decisions/voice-acp.md`
‏(entry 2026-06-03 slice-fix-turnstate-stuck — חובה לקרוא לפני שמתחילים).**

‏שלושת ה-blockers שורש משותף: `turnState` לא חוזר ל-`idle`. ה-StatusBubble
‏(`ModelStatus.phase`) וכפתור ה-▶ (`BubblePlayer.toggle` guard `turnState!==idle`)
‏תלויים ב-turnState→idle. כשהוא נתקע — שני הפיצ'רים מתים.

| Bug | מנגנון | תיקון |
|------|--------|--------|
| **NBug3** history phantom | טעינת היסטוריה מזרימה `agent_message_chunk`→`responding`; ה-`finally` מאפס רק `isLoadingHistory`, לא turnState | reset idle בסוף הטעינה |
| **NBug1** live turn stuck | **באג opencode** (ראה ★): RESP של `session/prompt` מגיע **באמצע** הזרם → `idle` (202) רץ נכון, אבל פיסות tail מאוחרות דורסות ל-`responding` | idle-on-RESP + debounce-net רק על tail |
| **NBug2** ▶ no-op | guard `turnState!==idle` + NBug1/3 | נגזרת — ייפתר מ-1+3; integration-test |

### ★ ממצא ה-probes (מרדכי, 2026-06-03) — קרא לפני הקוד

‏מרדכי הריץ 4 probes ישירים מול CLIs על stdio (בלי BE/WS — ראה זיכרון גלובלי
‏`2026-06-03-fact-acp-stdio-probe-how-to`). **אל תחזור עליהם, בוצעו.** הממצאים:

1. **opencode מחזיר RESP של `session/prompt` באמצע הזרם.** ב-400-word answer:
   ‏RESP אחרי 523 פיסות, ועוד **512 פיסות (≈חצי התשובה) הגיעו אחריו**. tail = **5.6ש'**.
   ‏ה-`idle` שנקבע על RESP (שורה 202) **נכון** — אבל פיסת-tail מאוחרת דורסת ל-`responding`.
2. **אין signal אמין לסיום-תור**: stopReason תמיד `end_turn` (גם על cancel);
   ‏usage_update מגיע עם ה-RESP (באמצע); **אין הודעת-סיום**. רק "הפיסות הפסיקו".
3. **★ opencode הוא היחיד החריג** (ההשוואה שמעצבת את ה-fix):

   | CLI | RESP מגיע | tail | |
   |-----|-----------|------|-|
   | opencode | באמצע (חצי תשובה אחריו) | עד 5.6ש' | ❌ באג |
   | gemini   | אחרי הפיסה האחרונה | 0 | ✅ תקין |
   | claude   | אחרי הפיסה האחרונה | 0 | ✅ תקין |

   ‏→ **NBug1 הוא באג ספציפי ל-opencode.** ב-gemini/claude הקוד המקורי עובד מושלם.

‏**עקרון ה-fix**: idle נקבע על RESP (תקין לכולם). ה-debounce-net מטופל **רק** על פיסות
‏שמגיעות **אחרי** RESP (= ה-tail של opencode). CLI תקין: 0 פיסות-אחרי-RESP → ה-net
‏לא מופעל → **0 השהיה מיותרת**. ה-fix מפעיל את עצמו רק כשיש את הבאג.

> ❗ **אסור לזרוק פיסות tail** — הן נושאות ≈חצי התשובה (ב-opencode). ה-net נוגע **רק**
> ב-turnState; התוכן נכנס לבועה כרגיל.

---

## §0 — Pre-flight

### Worktree
‏fix על branch קיים — **לא** worktree חדש:
```bash
cd /home/user/projects/voice-acp/.worktrees/slice-model-status-control-replay
# branch: slice-model-status-control-replay (checked out). tip 01e85ce.
pnpm install && pnpm hooks:install   # אם עדיין לא
```
‏dev עדיין **לא** מכיל turnState — הקוד חי רק כאן.

### Run
```bash
BE_PORT=4013 pnpm --filter @drive-coding/frontend-v2 dev
cd packages/backend && PORT=4013 onecli run --agent voice-acp -- bun --watch src/server.ts
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 test
pnpm lint:i18n
```

### Browser
- linux-gui Chrome :9222 profile voice-acp: `playwright-cli -s=vacp attach --cdp=http://localhost:9222`
- mock לבדיקת NBug3 ללא BE: `/chat?mock=greeting` (**reload מלא**).

### OneCLI agent
- `voice-acp` (ElevenLabs+Google keys). נחוץ רק כדי שה-BE יעלה לתור-אמיתי ב-DoD.

### Reading list
**must-read לפני**:
- `docs/decisions/voice-acp.md` entry 2026-06-03 slice-fix-turnstate-stuck (4 probes + העיצוב).
- `reports/voice-acp/slice-model-status-control-replay-calev.md` (NO-GO findings 1/2/3).
- `packages/frontend/AGENTS.md` (5 שכבות + חוקי זהב).

**reference**:
- `agent-session.svelte.ts` (הקובץ המתוקן), `derived/model-status.svelte.ts:29`,
  `bubble-player.svelte.ts:38` (ה-guard).

---

## §1 — מטרה

‏אחרי ה-fix: בועת-הסטטוס **נעלמת** כשהתור נגמר (בכל CLI) וכשטוענים סשן מההיסטוריה,
‏וכפתור ה-▶ עובד. ב-opencode ה-tail המאוחר (≈חצי התשובה) **כן** מופיע בבועה, וה-bubble
‏נעלם רק כשה-tail נרגע. ב-gemini/claude אין השהיה מיותרת.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|--------|-------|-----|
| reset idle אחרי replay (NBug3) | ✅ | Commit 1 |
| `#turnEnded` flag + idle-on-RESP + debounce-net על tail (NBug1) | ✅ | Commit 2 |
| integration-test (NBug2) | ✅ | Commit 3 |
| **debounce-על-כל-chunk סף קבוע** | ❌ | נדחה — שובר פאוזה>סף (decisions ממצא B) |
| **טיימר קבוע מ-RESP** | ❌ | נדחה — tail פרופורציוני, אין סף קבוע (A) |
| **התעלמות מ-chunks אחרי RESP** | ❌ | מוחק ≈חצי התשובה (A) |
| **תיקון bridge/BE** | ❌ | אין באג bridge — באג opencode עצמו |
| **gate על stopReason** | ❌ | תמיד end_turn גם ב-cancel (C) |
| ElevenLabs quota / locale | ❌ | env / pre-existing |

> **הגנת-scope**: ה-debounce-net נוגע **רק** ב-turnState ו**רק** על פיסות שאחרי RESP.
> אל תיגע ב-content path (appendChunk/bubbles). אל תוסיף debounce לפני RESP.

---

## §3 — Architecture diagram

```
view-models/
  agent-session.svelte.ts        ← משתנה
    sendPrompt          → #resetTurnTracking() (תחילת תור); await prompt();
                          ב-success #turnEnded=true + idle; ב-catch idle      [Commit 2]
    #onSessionUpdate    → אם #turnEnded דלוק (tail אחרי RESP): #scheduleIdle() [Commit 2]
                          (התוכן נכנס כרגיל; turnState→responding ואז debounce)
    #idleTimer(=null) + #scheduleIdle() + #TAIL_MS + #turnEnded(=false)        [Commit 2]
    #resetTurnTracking()  ← helper: #turnEnded=false + נקה #idleTimer          [Commit 2]
    #cleanup/detach     → clearTimeout(#idleTimer); #idleTimer=null            [Commit 2]
    loadSession/switch/mock → #resetTurnTracking() + reset idle (NBug3)        [Commit 1]
                          ⚠️ בלי reset: טיימר-tail יתום יורה ב-replay (blocker)
  derived/model-status.svelte.ts ← לא נוגעים (קורא turnState)
  bubble-player.svelte.ts        ← לא נוגעים (guard turnState!==idle)
  speaker.svelte.ts              ← לא נוגעים (נהנה ממעבר נקי responding→idle)
  agent-session.test.svelte.ts   ← integration-test חדש, co-located           [Commit 3]
```

> **חוק זהב #4**: ה-timer side-effect שייך ל-AgentSession (owner של turnState).
> imperative `setTimeout`, **לא** `$effect`. ניקוי ב-#cleanup חובה (דפוס #stopHeartbeat
> ב-`engines/ws-transport.ts:106`). **אין** תיקיית `tests/` ל-FE — co-located בלבד.

---

## §4 — Commits

### Commit 1 — reset turnState=idle אחרי replay (NBug3) (approach: manual)

‏**קובץ**: `packages/frontend/src/lib/view-models/agent-session.svelte.ts`

> ⚠️ **תלות סדר**: Commit 1 קורא ל-`#resetTurnTracking()` שמוגדר ב-**Commit 2**. אם
> מבצעים בנפרד — בצע **Commit 2 קודם** (השדות+helper), ואז Commit 1. (או אחד אותם
> ל-commit אחד — שניהם באותו קובץ, אותו עניין. בחירת executor.)

‏שלושת מסלולי הטעינה (`loadSession`/`switchSession`/`#loadMockSession`). בכל אחד:
- **success**: הוסף `#setTurnState("idle")` ב-`finally` הפנימי (264-266 / 322-324 /
  606-608) ליד `isLoadingHistory = false`.
- **throw מוקדם**: הוסף `#setTurnState("idle")` גם ב-`catch` החיצוני (loadSession
  273-278, #loadMockSession 610-614, switchSession catch **335-340**). ⚠️ ה-`finally` הפנימי עוטף
  **רק** את `loadSession()` (261-266); throw ב-`createAgent`(239)/`waitForOpen`(253)
  מדלג עליו → לכן צריך גם ב-catch. (idempotent — no-op אם כבר idle.)
- **🔴 reset turn-tracking** (אביגיל סבב 7 — blocker): בתחילת **כל** מסלול טעינה
  (אחרי `this.bubbles = []`, ליד `this.#detached = false` — שורות ~227/312/588), קרא
  `this.#resetTurnTracking()`. **למה**: תור opencode קודם השאיר `#turnEnded=true` +
  `#idleTimer` רץ. אם לא מאפסים, ה-replay מזרים `agent_message_chunk` → `if(#turnEnded)`
  עדיין true → `#scheduleIdle()` נורה על chunk של replay, **או** הטיימר היתום יורה
  idle באמצע ה-replay. הטענה "replay לא רלוונטי ל-#turnEnded" **שגויה** — שום דבר לא
  מאפס אותו בלי הקריאה הזו.

‏**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
# ידני: /chat?mock=greeting (reload מלא) → StatusBubble לא נתקע "Responding".
# ידני: תור opencode → מיד טען סשן אחר → ה-replay לא משאיר פנטום (הטיימר הקודם נוקה).
```

### Commit 2 — idle-on-RESP + debounce-net על tail (NBug1) (approach: manual)

‏**קובץ**: `packages/frontend/src/lib/view-models/agent-session.svelte.ts`

‏**שדות חדשים** (ליד `#toolBubbleByCallId`):
```ts
// ─── מעקף לבאג opencode #17505 (ראה decisions 2026-06-03) ───
// opencode מחזיר RESP של session/prompt באמצע הזרם — ≈חצי התשובה (tail עד ~5.6ש')
// מגיעה אחרי ה-RESP, ודורסת turnState ל-responding אחרי שכבר נקבע idle.
// מפר את ה-ACP spec (כל notifications לפני response). gemini/claude תקינים →
// ה-net הזה לא מופעל אצלם. כשהבאג ייסגר (github.com/sst/opencode/issues/17505)
// אפשר להסיר את #turnEnded/#scheduleIdle/#TAIL_MS.
#turnEnded = false                                  // דלוק בין RESP לתחילת תור הבא
#idleTimer: ReturnType<typeof setTimeout> | null = null   // | null כמו settings.svelte.ts:86
#TAIL_MS = 1500                                      // debounce לבליעת tail (אחרי RESP בלבד)

/** מתזמן idle אחרי שקט מ-tail. נקרא רק כש-#turnEnded דלוק. כל tail-chunk מאפס. */
#scheduleIdle(): void {
  if (this.#idleTimer !== null) clearTimeout(this.#idleTimer)
  this.#idleTimer = setTimeout(() => {
    this.#idleTimer = null
    this.#setTurnState("idle")
  }, this.#TAIL_MS)
}

/** מאפס את מעקב-התור. חובה בתחילת תור (sendPrompt) ובכל טעינה (replay אינו תור).
 *  בלי זה: #turnEnded דלוק מתור קודם + #idleTimer יתום → tail-debounce יורה על
 *  chunk של replay / false-idle באמצע התור הבא (אביגיל סבב 7 — blocker). */
#resetTurnTracking(): void {
  this.#turnEnded = false
  if (this.#idleTimer !== null) { clearTimeout(this.#idleTimer); this.#idleTimer = null }
}
```

‏**(א) `sendPrompt`** (שורות ~198-207):
```ts
this.#setTurnState("waiting")
this.#resetTurnTracking()             // תחילת תור — #turnEnded=false + נקה טיימר יתום
// ... bubble אופטימי קיים ...
try {
  await this.#client.prompt(this.#sessionId, text)
  this.#turnEnded = true              // RESP הגיע — opencode: tail עוד יבוא; gemini/claude: סוף
  this.#setTurnState("idle")          // נכון ל-gemini/claude (אין tail). opencode: tail יטופל ב-(ב)
} catch (err: unknown) {
  this.error = `prompt failed: ${err instanceof Error ? err.message : String(err)}`
  this.#setStatus("error")
  this.#turnEnded = true
  this.#setTurnState("idle")
}
```
‏שורה 202 הישנה (`#setTurnState("idle")` בתוך try) נשמרת — עם `#turnEnded=true` לפניה.
‏⚠️ `#resetTurnTracking()` **אחרי** `waiting` ולפני ה-`await` — מנקה טיימר יתום מתור קודם.

‏**(ב) `#onSessionUpdate`** — על פיסת-tail (אחרי RESP), תזמן idle מחדש. הוסף **בכל ארבעת
‏ה-handlers** שקובעים non-idle, **אחרי** ה-`#setTurnState`, **מותנה ב-`#turnEnded`**.
‏הדפוס בכל מקום: `if (this.#turnEnded) this.#scheduleIdle()`. ארבעת המקומות:

```ts
// 1. agent_message_chunk (~653, ב-#onSessionUpdate)
} else if (update.sessionUpdate === "agent_message_chunk") {
  this.#setTurnState("responding")
  if (this.#turnEnded) this.#scheduleIdle()     // tail בלבד; gemini/claude מגיעים לפה אך #turnEnded=false (RESP בסוף)
  this.#appendChunk("message", text, messageId) // התוכן נכנס כרגיל — לא מאבדים תשובה
}

// 2. agent_thought_chunk (~656, ב-#onSessionUpdate)
} else if (update.sessionUpdate === "agent_thought_chunk") {
  this.#setTurnState("thinking")
  if (this.#turnEnded) this.#scheduleIdle()
  this.#appendChunk("thought", text, messageId)
}

// 3. #handleToolCall (~679) — אחרי #setTurnState("calling-tool")
#handleToolCall(update): void {
  if (update.toolCallId === undefined) return
  this.#setTurnState("calling-tool")
  if (this.#turnEnded) this.#scheduleIdle()
  // ... שאר הלוגיקה הקיימת (יצירת bubble וכו') — לא משתנה
}

// 4. #handleToolCallUpdate (~720) — #scheduleIdle מ-OUTSIDE ה-if(pending)
#handleToolCallUpdate(update): void {
  if (update.toolCallId === undefined) return
  if (update.status === "pending" || update.status === "in_progress") {
    this.#setTurnState("calling-tool")
  }
  if (this.#turnEnded) this.#scheduleIdle()     // ← מחוץ ל-if: גם completed/failed = tail
  // ... שאר הלוגיקה הקיימת — לא משתנה
}
```
‏⚠️ ב-#4 ה-`#scheduleIdle` **מחוץ** ל-if(pending/in_progress): tool שמסתיים `completed`
‏בתוך ה-tail עדיין צריך לתזמן idle, אחרת תור שמסתיים ב-tool-completed ב-tail לא ייעצר.

> 🔴 **למה מותנה ב-`#turnEnded`** (לא על כל chunk): פיסה **לפני** RESP = תור חי (כולל
> פאוזות-מחשבה עד 3.2ש'+ או כלי איטי — decisions ממצא B). debounce עליה = false-idle
> באמצע תור. רק **אחרי** RESP (=tail) בטוח לתזמן idle, כי opencode כבר אמר "סיימתי".
> gemini/claude: אין פיסות-אחרי-RESP → התנאי `if(#turnEnded)` אף פעם לא true → 0 overhead.

> 🔴 **למה NOT בתוך `#setTurnState`**: ה-idempotency guard (488 `next===prev return`)
> חוסם tail-chunk שני מאותו סוג → טיימר לא מתאפס. הקריאה הנפרדת עוקפת.

‏**(ג) cleanup** — ב-`#cleanup()` (~507): `if (this.#idleTimer !== null) { clearTimeout(this.#idleTimer); this.#idleTimer = null }`. (detach עובר דרך #cleanup.)

‏**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck && pnpm --filter @drive-coding/frontend-v2 test
# תור-אמיתי opencode: "Reply: ok" → StatusBubble נעלם ~1.5ש' אחרי הפיסה האחרונה.
#   התשובה ("ok") מופיעה בבועה. תשובה ארוכה: כל ה-tail מופיע, bubble נעלם בסוף.
# (אם יש gemini/claude זמין: תור → bubble נעלם מיד על RESP, בלי השהיית 1.5ש'.)
```

> **verifier-phase כאן** (אחרי Commit 2). calev light מאמת בתור-אמיתי: bubble נעלם,
> התוכן לא אבד, replay לא משאיר פנטום. **wire-trace בוצע ע"י מרדכי** (4 probes).

### Commit 3 — integration-test (NBug2) (approach: integration)

‏**קובץ חדש**: `packages/frontend/src/lib/view-models/agent-session.test.svelte.ts`
‏(co-located — `settings.test.svelte.ts`, `wake-word.test.svelte.ts`). **אין** `tests/` ל-FE.

‏טסטים (השתמש ב-`vi.useFakeTimers()` + `vi.advanceTimersByTime(#TAIL_MS)`):
- mock `#client.prompt` resolve → `#turnEnded=true`, idle נקבע.
- **tail simulation**: אחרי resolve, הזרק `agent_message_chunk` דרך `#onSessionUpdate`
  ‏(צורה `{update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"x"},messageId:"m"}}`
  ‏— מקונן, לא bare). ודא turnState→responding, ואז אחרי advanceTimers(#TAIL_MS)→idle.
- **before-RESP**: הזרק chunk **לפני** resolve (#turnEnded=false) → ודא **אין** טיימר
  ‏(turnState נשאר responding גם אחרי advanceTimers — כי debounce לא תוזמן).
- replay→idle (NBug3 guard).

‏**למה integration**: calev סיווג NBug2 כ"unit עם turnState mocked=idle לא תופס". חייב את
‏ה-מעבר האמיתי (resolve→idle, tail→responding→idle).

```bash
pnpm --filter @drive-coding/frontend-v2 test
```

---

## §5 — DoD

| בדיקה | איך |
|--------|------|
| typecheck/test/lint:i18n נקי | הפקודות מ-§0 |
| **NBug3**: `/chat?mock=greeting` (reload) → bubble לא נתקע "Responding" | ידני, linux-gui |
| **NBug3 live**: טען סשן ישן → אין פנטום, ▶ עובד | ידני, BE+opencode |
| **NBug1 opencode**: תור "Reply: ok" → bubble נעלם ~1.5ש' אחרי הפיסה האחרונה | ידני |
| **NBug1 content**: תשובה ארוכה — **כל** ה-tail (≈חצי התשובה) מופיע בבועה | ידני |
| **NBug1 gemini/claude** (אם זמין): bubble נעלם מיד על RESP, בלי השהיית 1.5ש' | ידני (אופציונלי) |
| **NBug2**: בסשן טעון/אחרי תור, ▶ → Stop+`<audio>` (לא no-op) | ידני (TTS אולי 401 — בדוק שה-guard עבר) |
| **timer cleanup**: detach באמצע תור → אין idle שרץ אחרי ניתוק | בדיקה/test |
| **Commit 3 test**: resolve→idle + tail→idle + before-RESP→no-timer + replay→idle | `pnpm test` |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|--------|------|----------|
| `#setTurnState("idle")` cue לא-רצוי | cue thinking על idle→waiting בלבד (491) | היעד idle → לא מנגן. idempotent. |
| replay → Speaker justFinished | speaker:283-289 | בטוח: replay מריק buffers (225-226) → אין enqueue. escalation §7 אם cue-test נשבר. |
| **#idleTimer דולף אחרי detach** | timer חדש | חובה clearTimeout ב-#cleanup + null. דפוס #stopHeartbeat (ws-transport:106). |
| **#TAIL_MS קצר מדי** → bubble נעלם באמצע ה-tail | tail = 5.6ש' אבל פיסות **בתוכו** צפופות (עשרות ms) | 1500ms בטוח — מאפס על כל tail-chunk, רק הפסקה אמיתית >1.5ש' תפעיל. אם תשובה ענקית מראה הבהוב → העלה. escalation §7. |
| **#turnEnded לא מתאפס** → תור הבא לא מזהה tail | sendPrompt:198 | `#turnEnded=false` בתחילת sendPrompt (לפני await). בדוק שזה השורה הראשונה אחרי waiting. |
| debounce בולע content | אי-הבנה | ה-net **רק** turnState. appendChunk לא משתנה. |
| טסט NBug2 מזריק idle ישיר | calev patterns | חייב מעבר (resolve→idle, tail→responding→idle) + fake timers. |
| typecheck על setTimeout type | browser/node | `ReturnType<typeof setTimeout> \| null` כמו `#voicesRetryTimer` settings.svelte.ts:86. |

---

## §7 — Escalation triggers

‏עצור ושאל את מרדכי אם:
- **bubble נעלם באמצע ה-tail** (תשובה ארוכה) → #TAIL_MS קצר מדי לתרחיש. הצג אותו.
- **content נבלע** (tail-chunk לא מופיע בבועה) → ה-fix נגע ב-content path בטעות.
- **gemini/claude מראים השהיית 1.5ש'** → התנאי `if(#turnEnded)` לא עובד (אולי הם כן
  שולחים פיסה אחרי RESP) → הצג probe.
- **bubble מהבהב בתחילת תור** → ייתכן ש-#turnEnded דלוק מתור קודם (לא אופס). בדוק sendPrompt:198.
- **`#setTurnState("idle")` שובר speaker-cue test** → הצג את הטסט.
- **typecheck על setTimeout** → דפוס settings.svelte.ts:86. אם נופל — עצור.

---

## §8 — Complexity score

- commits: 3 · שכבות חדשות: 0 · APIs חיצוניים: 0 (probes בוצעו)
- streaming/async: timer imperative + flag על async flow (+1)
- state refactor: לא · protocol BE↔FE: לא
- **ציון: 3/10** → `verifier-slice-light` + verifier-phase אחרי Commit 2.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|-----------|-------|
| 1 | #TAIL_MS = 1500 — מספיק? | 1500 (פיסות tail צפופות, עשרות ms). העלה אם תשובה ענקית מהבהבת | ❌ (escalation) |
| 2 | טסטי agent-session היכן? | co-located `*.test.svelte.ts` — אין `tests/` ל-FE | ❌ |
| 3 | CLI שלא שולח RESP בכלל (#turnEnded לעולם לא דלוק) → bubble נתקע? | gemini+claude+opencode כולם שולחים RESP (אומת). edge נדיר — calev יחליט אם צריך fallback timeout | ❌ |
| 4 | מיזוג ה-slice המאוחד ל-dev אחרי ה-fix? | fix כ-commits על branch → calev re-verify → merge מרדכי | ❌ |
| 5 | gemini/claude verification — חובה? | אופציונלי (התנהגות תקינה אומתה ב-probe). אם זמין — בונוס | ❌ |

---

## §10 — Merge-time notes (קריא למרדכי לפני מיזוג ל-dev)

‏ה-branch הזה נחתך **לפני** ש-`fix-null-msgid-grouping` נכנס ל-dev (commit `47f9ad7`).
‏לכן `agent-session.svelte.ts` יתנגש במיזוג ל-dev. אומת ב-trial-merge (2026-06-08):

| אזור | מה קורה במיזוג | פעולת הפותר |
|------|----------------|-------------|
| **`#appendChunk` → `const canGroup`** | נפתר **אוטומטית** לגרסת dev (ה-branch לא נגע בבלוק; dev שינה אותו) | ✅ אין מה לעשות. **רק ודא** שלא חזר ל-`messageId !== null &&` (=הבאג הישן של Gemini). |
| **`#onSessionUpdate`** (סביב `const messageId = update.messageId ?? null`) | **קונפליקט** — גם dev (null-msgid) וגם ה-branch (setTurnState) נגעו כאן | ⚠️ שמור את **שתי** ההתנהגויות: עיבוד null-msgid של dev **+** קריאות `#setTurnState` של ה-branch. |
| `i18n` he/en/keys | קונפליקט — `modelStatus.*` (סלייס) מול `record.reconnect.*` (נכנס ל-dev ב-ws-reconnect) | שמור את שני סטי-המפתחות. |
| `docs/walkthrough.md`, `docs/decisions/voice-acp.md` | קונפליקט changelog (ה-branch מאחורי dev) | שמור שני הבלוקים. |

> **הסכנה היחידה ל-Gemini-regression**: פתרון-ידני שגוי של קונפליקט שמחזיר את
> `messageId !== null &&` ב-canGroup. git לא יעשה זאת לבד — רק טעות אנוש תעשה. בדוק.
