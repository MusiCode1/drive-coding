# Slice A5 — watchdog ל‑turnState — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: ✅ READY (אביגיל r2 — 3×🟡 מ-r1 נסגרו; `reports/drive-coding/A5-avigail.md`)
> **Complexity**: 4/10 (verifier: light)
> **תלות**: [] · **base**: `dev` @ `3a23195` (עצמאי — A1 בוטל, ר' roadmap)
> **שייך ל**: `docs/plans/playback-run-control-roadmap.md` (עצמאי, לא בשרשרת הפלייליסט)

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/playback-core-a5 -b slice/playback-core-a5 dev
cd .worktrees/playback-core-a5
pnpm install && pnpm hooks:install
```

### Reading list
**must-read**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — §`#scheduleIdle`/`#turnEnded`
  (145‑160), `sendPrompt` (615‑647), `#onSessionUpdate` (1288‑1357), `cancelTurn` (1083‑1092),
  `#setTurnState("idle")` (1122), `#resetTurnTracking` (159‑161).
  > ⚠️ (אביגיל #1) **A1 בוטל** — אין `onTurnSettled`/`#scheduleSettle` בקוד. המנגנון האמיתי:
  > `#scheduleIdle`/`#turnEnded` (msr‑v2, קיים) + flush דרך `justFinished` ב‑Speaker
  > (`speaker.svelte.ts:303‑318`, מופעל ע"י ה‑`$effect` בשורות 144‑183 שקורא `turnState` ריאקטיבית).
- `docs/roadmap.md` — Track F "הריצה נעצרת" + "ממשק אישור‑בקשות" (ההקשר: RESP אבוד).
- `docs/plans/playback-run-control-roadmap.md` — §אבחון השורש (בועה תקועה).

## §1 — מטרה

אחרי הסבב: אם הסוכן מפסיק לפלוט וה‑RESP של `session/prompt` **לא חוזר** (detach,
reconnect, `request_permission` ללא מענה), הבועה כבר לא נתקעת לנצח על "חושב…/עונה…".
watchdog מזהה היעדר‑פעילות ממושך ומאלץ `turnState=idle` — כך ה‑StatusBubble נעלמת
וההשמעה משוחררת. זו רשת‑ביטחון **עצמאית**: היא לא מחליפה את ה‑flush התקין של סוף‑תור,
רק תופסת את המקרה שבו ה‑RESP אובד (A1 שהיה אמור לטפל ב‑tail — בוטל; ר' אביגיל #1).

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| watchdog timer שמאופס בכל update | ✅ | — |
| אילוץ idle אחרי `WATCHDOG_MS` בלי activity ובלי RESP | ✅ | — |
| חיווי "התור נקטע" (אופציונלי) | ✅ (דגל בלבד) | UI ב‑B1 |
| תיקון השורש של RESP‑אבוד (BE) | ❌ | roadmap Track F |
| permission UI | ❌ | roadmap Track C |

## §3 — Architecture diagram

```
agent-session.svelte.ts
  + #watchdogTimer
  + #kickWatchdog()   ← נקרא בראש #onSessionUpdate (לפני ה-returns המוקדמים!) + sendPrompt start
  כש פג WATCHDOG_MS בלי kick ו-turnState ≠ idle:
     #setTurnState("idle") + (אופציונלי) turnInterrupted=true
     → המעבר ל-idle מפעיל את ה-justFinished flush הקיים ב-Speaker (לא נוגעים בו)
  מנוקה ב: RESP (sendPrompt resolve), cancelTurn, sendPrompt חדש, destroy
```

## §4 — Commits

### Commit 0 — watchdog (approach: manual + integration)

**קבצים שמשתנים**: `agent-session.svelte.ts`

```ts
class AgentSession {
  #watchdogTimer: ReturnType<typeof setTimeout> | null = null
  #WATCHDOG_MS = 45_000   // §9 Q1
  /** התראת idle‑בכוח אם אין activity. reactive — UI יכול להציג "נקטע". */
  turnInterrupted: boolean = $state(false)

  #kickWatchdog(): void   // reset timer; נקרא בכל update/chunk + תחילת sendPrompt
  #clearWatchdog(): void  // RESP / cancelTurn / sendPrompt חדש / destroy
  // on fire: if turnState!=="idle" → #setTurnState("idle") [מפעיל justFinished flush ב-Speaker] + turnInterrupted=true
}
```
- `#kickWatchdog` נקרא **בראש `#onSessionUpdate`** — **לפני** ה‑`return` המוקדמים (אביגיל #3):
  `tool_call`@1309, `tool_call_update`@1313, `current_mode_update`@1320, `config_option_update`@1330,
  ו‑`if (!text) return`@1339. **קריטי:** kick רק בענפי‑הטקסט (message/thought/user chunk) יחמיץ
  **כלי‑שקט ארוך** (tool שרץ דקות בלי text‑chunk) → קטיעה שגויה. וגם מתחילת `sendPrompt`
  (סביב `#resetTurnTracking`@159‑161, שנקרא מ‑`sendPrompt`@634).
- בעת ירי: `#setTurnState("idle")` — המעבר ל‑idle מפעיל את ה‑`justFinished` flush הקיים
  ב‑Speaker (לא משנים אותו). `turnInterrupted=true` (B1 יציג; reset בתחילת תור הבא).
- `cancelTurn` ו‑`sendPrompt` החדש קוראים `#clearWatchdog` + מאפסים `turnInterrupted`.

**Verification**: integration test (Commit 1).

### Commit 1 — integration test (approach: integration)

**קבצים חדשים**: `agent-session.watchdog.test.svelte.ts`

- sendPrompt, כמה chunks, ואז **שתיקה** (mock timers) → אחרי `WATCHDOG_MS` → `turnState==="idle"`
  + `turnInterrupted===true`.
- activity לפני timeout → לא נורה (kick מאפס).
- RESP תקין → watchdog מנוקה, `turnInterrupted` נשאר false.
- cancelTurn → watchdog מנוקה.

**Verification**: `pnpm --filter frontend test -- agent-session.watchdog`

## §5 — DoD

| בדיקה | איך |
|---|---|
| שתיקה > WATCHDOG_MS → idle כפוי + turnInterrupted | integration ירוק |
| activity מאפס את ה‑watchdog | integration ירוק |
| RESP/cancel מנקים | integration ירוק |
| flush של שארית קורה גם במסלול הכפוי | integration (דרך המעבר ל‑idle הקיים) |
| build‑gate | typecheck + tests ירוקים |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| WATCHDOG_MS קצר → קוטע תור חי איטי (LLM שחושב הרבה / **כלי‑שקט ארוך**) | אביגיל #3 | 45s נדיב; **כל update מאפס** (kick בראש `#onSessionUpdate` לפני ה‑returns → מכסה גם `tool_call` שלא פולט text). thinking ארוך פולט chunks→kick. |
| flush כפול (watchdog idle + justFinished) | — | המעבר ל‑idle הוא היחיד שמפעיל flush; idempotent (buffer מתרוקן). |
| timer דולף | learnings | `#clearWatchdog` ב‑destroy + cancel + sendPrompt. |
| reconnect מצליח אחרי watchdog ירה | ws‑reconnect | אם chunks חוזרים אחרי idle כפוי → תור חדש מתחיל נקי (kick). |

## §7 — Escalation triggers

- watchdog יורה תכופות בשימוש רגיל → ה‑WATCHDOG_MS לא מתאים או שיש בעיית RESP אמיתית
  (Track F) — שאל מרדכי.
- מסתבר שצריך גם BE‑side timeout → חורג מ‑FE scope.

## §8 — Complexity score

4/10: timer logic (+1), state change (+1), integration test (+1), משולב A1 (+1). → **light**.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | `WATCHDOG_MS` | 45_000 | ❌ |
| 2 | `turnInterrupted` — להציג ב‑B1 או שקט? | דגל קיים; B1 יחליט תצוגה | ❌ |
| 3 | watchdog פעיל גם בזמן `responding` ארוך (thinking) | כן — **כל update** (כולל `tool_call` שקט) מאפס, אז בטוח | ❌ |
