---
project: "voice-acp"
slice: "slice-model-status-control-replay"
verifier: "calev-heavy"
date: "2026-06-03"
mode: "heavy"
verdict: "NO-GO"
dod_items:
  - "core+frontend-v2 typecheck/build/lint:i18n — trusted green (executor); diff-stat matches DoD#8 exactly"
  - "StatusBubble appears + cycles waiting/thinking/responding/calling-tool in a real turn — VERIFIED"
  - "StatusBubble NEVER disappears: turnState stuck at 'responding' after every turn — BLOCKER (DoD#3 fail)"
  - "cancel (mic during turn): agent stops, button->idle, NO blinking X — VERIFIED (DoD#5 pass)"
  - "recording save POST /api/recordings {audioBase64,mimeType}->{id} 201 + GET 200 audio/wav + transcribe.ts no-stub best-effort — VERIFIED (DoD#6 pass)"
  - "play ▶ agent (TTS): blocked — turnState-stuck guard makes it permanent no-op AND ElevenLabs quota_exceeded(401) — DoD#7 fail"
  - "play ▶ user (recording): GET path 200 but unreachable via UI (turnState guard) — DoD#7 fail"
  - "history reload leaves phantom 'Responding' StatusBubble forever — BLOCKER"
spot_check: "real opencode turns end-to-end; StatusBubble phases cycle but never reset to idle; cancel/X-blink fixed; recordings endpoint correct"
findings:
  - id: 1
    severity: "blocker"
    category: "reload-reconnect"
    summary: "turnState never returns to idle after a turn: prompt() resolution does not fire #setTurnState('idle') (line 202). StatusBubble + mic button stay stuck at 'Responding'/'Thinking…' forever, on EVERY turn, even on a fresh connection with no prior cancel. Breaks DoD#3 (bubble must disappear)."
    source_brief: "DoD #3 / §2.1 line 94/198"
    source_code: "view-models/agent-session.svelte.ts:201-202 (await #client.prompt does not resolve in this env)"
    cost_estimate: "investigate"
  - id: 2
    severity: "blocker"
    category: "cross-store-null"
    summary: "BubblePlayer guard 'if turnState!==idle return' + finding#1 = ▶ play is a PERMANENT no-op after any turn (and on every history-loaded session). Clicking ▶ yields 0 Stop buttons, 0 <audio> elements. DoD#7 unreachable via UI."
    source_brief: "DoD #7 / §6 guard"
    source_code: "view-models/bubble-player.svelte.ts (guard) + agent-session.svelte.ts:202"
    cost_estimate: "depends on #1"
  - id: 3
    severity: "blocker"
    category: "reload-reconnect"
    summary: "Loading an existing session from history replays updates via #onSessionUpdate; last content update is agent_message_chunk->turnState='responding', and nothing resets turnState after history load. Every history-loaded session shows a phantom 'Responding' StatusBubble + ▶ play no-op. Reproduced live (session 'Current directory file listing') and in mock."
    source_brief: "§3.2 ModelStatus / DoD #3 / §11 out-of-scope (replay) — but stray bubble is in-scope"
    source_code: "agent-session.svelte.ts #loadMockSession:595-609 + real loadSession history replay (no turnState reset after isLoadingHistory=false)"
    cost_estimate: "30min"
  - id: 4
    severity: "minor"
    category: "library-compat"
    summary: "ElevenLabs account quota_exceeded (0 credits) -> all TTS POSTs return 401. Not a slice bug, but it means ▶-agent / narration cannot produce audio in this environment regardless of code. GET /proxy/elevenlabs/v1/voices = 200 (auth OK); only TTS billing fails."
    source_brief: "DoD #7 (TTS cache hit)"
    source_code: "environment — backend/data + ElevenLabs billing"
    cost_estimate: "n/a (env)"
  - id: 5
    severity: "minor"
    category: "unique"
    summary: "Whole UI (incl. StatusBubble) renders in English despite app.html lang=he dir=rtl — locale resolves to en from navigator on linux-gui. Pre-existing app behavior (all strings English), not introduced by this slice. StatusBubble correctly uses i18n; he.ts keys present and correct."
    source_brief: "§3.3 i18n modelStatus.*"
    source_code: "i18n locale detection (pre-existing)"
    cost_estimate: "n/a"
---

# slice-model-status-control-replay — Verification Report (Heavy)

> **תאריך:** 2026-06-03
> **Commit בסיס:** e2dd686..12f398c (6 commits + docs); worktree tip 12f398c
> **שיטה:** browser חי (linux-gui Chrome :9222 ← tunnel → FE :5173 = browser-side :5175) + real opencode ACP + curl ל-BE :4013
> **Screenshots:** `/tmp/verify/slice-model-status-control-replay/*.png`

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 3/7 (מתוכם 1 חלקי) |
| Regressions | 1 (turnState-reset — ראה הערת attribution) |
| Bugs חדשים | 3 blockers + 2 minor |
| Tests ש-אליעזר הכריז (602✓) | לא אומת (פרוטוקול — סומך), diff-stat תואם DoD#8 |
| **Verdict** | **NO-GO** |

הליבה הוויזואלית של הסליס נכונה לפי ה-brief (StatusBubble, ModelStatus, BubblePlayer,
recordings endpoint, hasPendingNarration reactive — כולם מומשו בדיוק כפי שתואר). **אבל**
בסביבה אמיתית שתי הפיצ'רים הראשיים לא עובדים: בועת-הסטטוס **לא נעלמת לעולם** (נתקעת
ב-"Responding" אחרי כל תור), וכפתור ▶ הוא **no-op קבוע** כתוצאה מאותו תקיעה. בנוסף יש באג
ברור של reload-history. תיקון ה-X-מהבהב (DoD#5) וצינור ההקלטות (DoD#6) — תקינים לחלוטין.

## טבלת DoD items

| # | Item מה-brief | סטטוס | עדות |
|---|---------------|--------|------|
| 1 | core+FE typecheck/build/lint:i18n נקי | ⓘ | סומך על אליעזר (602✓); `git diff --stat dev` תואם DoD#8 בדיוק (26 קבצים, החלוקה לכל commit נכונה, MicLarge לא נגוע) |
| 2 | טסטים קיימים עוברים (Commit1 התנהגות זהה) | ⓘ | סומך על אליעזר; sendPrompt diff מול dev מראה שינוי status→turnState בלבד, מבנה זהה |
| 3 | בועת-סטטוס מופיעה/מתחלפת/**נעלמת** בכל שיטות-קלט | ❌ | מופיעה+מתחלפת ✅ (Waiting→Thinking→Responding→Calling-tool נצפו); **נעלמת ❌** — נתקעת ב-"Responding" לנצח אחרי כל תור (Finding#1). |
| 4 | cues thinking/speaking בעיתוי נכון | ⚠️ | thinking cue נצפה בתחילת תור; speaking cue לא נבדק שמיעתית (TTS 401 quota — Finding#4). מנגנון §8.3 קיים בקוד (speaker.svelte.ts #prevTurnState). |
| 5 | **עצירה**: mic ב-thinking→נעצר, →idle, אין X מהבהב | ✅ | לחצתי mic ("Thinking…") באמצע תור → StatusBubble→none, mic→"Microphone", הסוכן נעצר (אפס בועות חדשות אחרי 3s). אין X תקוע. screenshot 06. |
| 6 | **הקלטה נשמרת** + recordingId אמיתי + כשל לא מפיל | ✅ | POST `/api/recordings {audioBase64,mimeType}`→`{id}` + קובץ `<id>.wav` ב-data/recordings + index.json. GET→200 audio/wav. transcribe.ts: stub הוסר, saveRecording אמיתי עם `.catch(()=>({id:""}))` (best-effort). |
| 7 | **▶ user** מנגן / **▶ agent** TTS / toggle עוצר / thinking→no-op / בועה מודגשת | ❌ | ▶ מרונדר נכון (Thought+Message; user רק עם recordingId). אבל **לחיצה = no-op קבוע** (Finding#2): turnState נתקע ב-non-idle → guard חוסם תמיד. בנוסף TTS=401 quota. |

## Flows שעבדו מקצה לקצה

- ✅ **חיבור + תור אמיתי**: connect → /chat → Type "List the files…" → הסוכן הריץ ls, יצר
  סשן, כותרת "Current directory file listing" — שיחה מלאה עובדת.
- ✅ **StatusBubble phase cycle (חלקי)**: תור אמיתי → Waiting → Calling tool → Thinking →
  Responding נצפו ב-DOM (poll). המיפוי turnState→phase נכון.
- ✅ **עצירה / X-מהבהב (DoD#5)**: לחיצת mic ב-Responding → StatusBubble נעלם, mic→idle,
  הסוכן נעצר. אין X תקוע. **התיקון המרכזי של הסליס עובד.** (screenshot 06)
- ✅ **recordings endpoint (DoD#6)**: POST→{id}→קובץ; GET→200 audio/wav. צינור ה-save
  + best-effort guard ב-transcribe.ts תקין.
- ✅ **bubble grouping (regression)**: תגובה ארוכה זורמת = בועת-message אחת, לא בועה-per-chunk
  (2 כפתורי Play יציבים לכל אורך ה-streaming). (screenshot 07 mobile)
- ✅ **mobile (390×844)**: layout תקין, footer Record/Type/Hidden + mic. (screenshot 07)

## Flows שנשברו

- ❌ **בועת-הסטטוס נעלמת (DoD#3)** — תור: שלח "Say only: ok" (חיבור טרי, ללא cancel קודם) →
  Waiting→Thinking→Responding → **תקוע ב-"Responding" 30s+** למרות שהתגובה הושלמה במלואה
  ב-DOM. גורם מוערך: `await this.#client.prompt()` (agent-session:201) לא resolved → שורה 202
  `#setTurnState("idle")` לא רצה. נצפה גם על כפתור ה-mic (תקוע "Thinking…"), שמאשר ש-turnState
  עצמו תקוע (ולא רק ה-StatusBubble).
- ❌ **▶ play (DoD#7)** — לחיצה על ▶ של בועת-message בסשן אמיתי (turnState תקוע) → 0 Stop, 0
  `<audio>`. ב-mock greeting: זהה (turnState="responding" מ-replay חוסם). ב-history-loaded: זהה.
- ❌ **history reload** — טעינת סשן ישן "Current directory file listing" → בועת "Responding"
  פנטום בתחתית לנצח + ▶ no-op. (screenshot 05)

## Regressions

- ⚠️ **turnState/status לא חוזר ל-idle אחרי תור** — *attribution חשוב*: מבנה ה-sendPrompt
  (`await prompt()` ואז reset) **זהה** ל-dev לפני הסליס (השוויתי git show e2dd686^). גם הקוד
  הישן היה `#setStatus("thinking")` ואז reset — אותו תלות ב-`prompt()` resolved. כלומר ה-hang
  של `prompt()` הוא ככל-הנראה **pre-existing/environmental** (ACP turn-end/stopReason לא מגיע),
  ולא הוכנס ע"י הסליס הזה. **אבל** הסליס הזה הופך אותו לבאג חוסם וגלוי: StatusBubble (DoD#3)
  ו-BubblePlayer (DoD#7) תלויים ישירות ב-turnState=idle. לכן זה NO-GO גם אם השורש סביבתי —
  הפיצ'רים של הסליס לא עובדים בפועל. צריך החלטת מרדכי: לחקור את `conn.prompt()` resolution
  (BE/ACP) או להוסיף reset של turnState על סיום-stream ב-#onSessionUpdate.

## Bugs חדשים שלא ברשימה

- ❌ **NBug1 (blocker)**: turnState נתקע ב-non-idle אחרי כל תור (Finding#1). ראה Regressions.
- ❌ **NBug2 (blocker)**: ▶ play no-op קבוע — נגזרת של NBug1 דרך ה-guard (Finding#2).
- ❌ **NBug3 (blocker)**: history reload → StatusBubble פנטום "Responding" (Finding#3). זה
  מנגנון נפרד מ-NBug1 (replay דרך #onSessionUpdate ללא reset אחרי isLoadingHistory=false),
  גם אם התור החי לא היה תקוע — הוא עדיין יופיע.
- ⓘ **NBug4 (minor, env)**: ElevenLabs quota_exceeded → TTS POST = 401 (Finding#4). חוסם
  בדיקה שמיעתית של cues/▶-agent. GET voices=200. לא באג קוד.
- ⓘ **NBug5 (minor, pre-existing)**: כל ה-UI באנגלית למרות lang=he (locale=navigator). he.ts
  keys של modelStatus קיימים ונכונים; StatusBubble משתמש ב-i18n נכון. (Finding#5)

## Regressions שנבדקו ועברו

- ✅ שיחה בסיסית (sendPrompt → תגובה) — עובדת.
- ✅ Bubble grouping — בועה אחת, לא per-chunk.
- ✅ Tool-call bubbles — נוצרו (ls/echo).
- ✅ Mobile + Desktop — שניהם נבדקו.

## סיווג ל-patterns.md

| באג | קטגוריה | הערה |
|------|---------|------|
| NBug1 turnState stuck | קטגוריה 2 (צנרת בין-stores) / reload-reconnect | ה-bridge "סיום תור→turnState=idle" תלוי ב-prompt() resolved; אם השרשרת לא נסגרת, ה-state לא חוזר. |
| NBug2 ▶ no-op | קטגוריה 2 (cross-store) | guard תלוי ב-state ש-store אחר (turnState) לא מאפס. unit-test של toggle עובר עם turnState mocked=idle — לא תופס. |
| NBug3 history phantom bubble | reload-reconnect | replay דרך #onSessionUpdate משאיר turnState. דפוס "TDD ירוק ≠ התנהגות" (קטגוריה 1) — אין טסט שבודק turnState אחרי loadSession. |
| NBug4 TTS 401 | library-compat | env (quota), לא קוד. |
| NBug5 locale=en | unique | pre-existing. |

## סיכום לסוכן הבא (אליעזר של ה-fix)

עדיפות לתיקון:
1. **NBug1/NBug3 (השורש המשותף)** — turnState חייב לחזור ל-idle בסיום תור גם כש-`prompt()`
   לא resolved/לא מגיע. אופציות: (א) reset turnState ב-`#onSessionUpdate` על סיום-stream
   (stopReason/end-of-turn signal) במקום להסתמך רק על `prompt()` resolved; (ב) reset turnState
   ל-idle בסוף `#loadMockSession`/loadSession אחרי `isLoadingHistory=false` (מתקן את NBug3
   בנפרד ומיידית). **שאלה למרדכי**: האם `conn.prompt()` אמור לחזור עם stopReason בסביבה הזו —
   אם לא, זו בעיה ב-ACP bridge/BE ולא ב-FE. כדאי לבדוק BE log של תור-בודד.
2. **NBug2** — נגזר מ-1; ייפתר כש-turnState יחזור ל-idle. אין צורך בתיקון נפרד (אבל שווה
   integration-test: תור→idle→▶ מנגן).
3. **NBug4 (env)** — לטעון credits ל-ElevenLabs כדי לבדוק שמיעתית את ▶-agent + cues. לא חוסם merge.
4. **NBug5 (env/pre-existing)** — מחוץ לסקופ הסליס; לתעד בנפרד.

**מה לא צריך תיקון**: cancel/X-blink (DoD#5 ✅), recordings save/transcribe (DoD#6 ✅),
מבנה ה-VMs (StatusBubble/ModelStatus/BubblePlayer/hasPendingNarration — כולם נאמנים ל-brief).
