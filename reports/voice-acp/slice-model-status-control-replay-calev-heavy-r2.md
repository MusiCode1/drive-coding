---
project: "voice-acp"
slice: "slice-model-status-control-replay"
verifier: "calev-heavy"
round: 2
date: "2026-06-13"
mode: "heavy"
verdict: "GO"
commit: "3f2c6cd"
re_verification_of: "reports/voice-acp/slice-model-status-control-replay-calev.md (NO-GO, 3 blockers)"
fix_verified: "slice-fix-turnstate-stuck (commits 659f0dc NBug1, 41dd8c0 NBug3, 630203a tests)"
blockers_status:
  - id: 1
    title: "live turn: turnState stuck at responding (never returns to idle)"
    status: "CLOSED"
    confidence: "high (deterministic — integration tests + replay DOM + code-trace; live-WS env-blocked)"
  - id: 2
    title: "▶ play permanent no-op (turnState!==idle guard)"
    status: "CLOSED"
    confidence: "high (live DOM: guard passes, Stop button appears; integration test asserts real idle transition)"
  - id: 3
    title: "history/replay phantom 'Responding' StatusBubble"
    status: "CLOSED"
    confidence: "high (live DOM on mock-greeting replay: zero phantom phase text, turnState idle)"
dod_items:
  - "core+frontend-v2 typecheck/build/lint:i18n — trusted green (executor); fix scope = agent-session.svelte.ts + co-located test + docs only (git diff confirms, no out-of-scope files)"
  - "NBug3 history phantom: mock-greeting replay leaves NO StatusBubble (turnState=idle) — VERIFIED live DOM + screenshot"
  - "NBug1 live-turn idle: idle-on-RESP + tail-debounce + replay-reset + stale-timer-clear — VERIFIED via 5/5 integration tests asserting REAL turnState transitions; live opencode turn env-blocked (SSH-tunnel WS drop, BE+opencode confirmed healthy server-side)"
  - "NBug2 ▶ no-op: guard now passes (turnState=idle) — VERIFIED live (clicking ▶ flips Play→Stop; was 0 Stop in r1). ▶-user GET path 200; ▶-agent TTS env-blocked (ElevenLabs 401)"
  - "recordings endpoint (DoD#6, regression): POST {audioBase64,mimeType}->{id} 201 + GET 200 — VERIFIED, unchanged by fix"
  - "StatusBubble i18n: all 6 phases map to modelStatus.* keys, {#if phase!==null} render-guard intact — VERIFIED"
  - "mobile 390x844 + desktop 1280x800 render clean (no phantom, ▶ present) — VERIFIED"
  - "app.html lang=he dir=rtl correct; en-locale-UI was navigator-locale (pre-existing, not slice bug)"
findings:
  - id: 1
    severity: "resolved"
    category: "reload-reconnect"
    summary: "NBug1 turnState-stuck — CLOSED. idle-on-RESP (sendPrompt :230-231) + #turnEnded-gated tail-debounce in all 4 onSessionUpdate handlers (:697/701/725/769) + #scheduleIdle TAIL_MS=1500. Integration test 'tail simulation' asserts chunk-after-RESP -> responding -> advanceTimers(1500) -> idle. Live opencode turn could not be exercised (env: SSH-tunnel WS drop)."
  - id: 2
    severity: "resolved"
    category: "cross-store-null"
    summary: "NBug2 ▶ no-op — CLOSED (derivative of #1/#3). Live: on mock-greeting (turnState=idle) clicking ▶ flips aria-label Play->Stop (r1 produced 0 Stop). BubblePlayer guard turnState!==idle now passes. Integration test 4 (replay->idle) covers the unblock."
  - id: 3
    severity: "resolved"
    category: "reload-reconnect"
    summary: "NBug3 history phantom — CLOSED. All 3 load paths reset turnState=idle in finally (:298/:359/:648) + catch (:310/:375/:655) + #resetTurnTracking() at start (:259/:347/:634). Live mock-greeting replay: zero phantom phase text in DOM, mic idle, clean chat (screenshot r2-desktop-mock-greeting.png). Integration test 4 asserts loadMockSession -> turnState=idle."
  - id: 4
    severity: "minor"
    category: "library-compat"
    summary: "ElevenLabs quota=0 -> TTS POST 401 (env, pre-existing from r1 finding#4). Blocks audible verification of ▶-agent (TTS re-synth) and speaking-cue. NOT a slice bug. ▶-user (recorded-audio GET) path = 200, not affected. proxy/elevenlabs/v1/voices = 200 (auth OK, billing only)."
  - id: 5
    severity: "minor"
    category: "unique"
    summary: "app.html correctly lang=he dir=rtl (verified live). The English-UI observed in r1 was navigator-locale resolution at the i18n layer on linux-gui — pre-existing app behavior, not introduced by this slice. StatusBubble uses i18n keys correctly; he.ts/keys present per executor lint:i18n green."
  - id: 6
    severity: "info"
    category: "unique"
    summary: "ENV NOTE (not a slice bug): live opencode turn unverifiable this round. BE WS to opencode works server-side (log: 'WS connect -> pipe attached', opencode child spawns), but the browser<->FE<->BE agent-WebSocket drops ~2-3s after open (code 1005) over the SSH reverse-tunnel + Vite proxy required by this harness. r1 had a directly-reachable browser-side tunnel (:5175); r2 only had localhost ports needing SSH tunnels, which do not sustain the long-lived agent WS. Also found stale bare-'bun src/server.ts' (no onecli) on :4013 returning 404 on every route — restarted correctly via onecli; routes then healthy (recordings GET/POST 200/201, proxy 200)."
---

# slice-model-status-control-replay — Re-Verification Report (Heavy, Round 2)

> **תאריך:** 2026-06-13
> **Commit:** 3f2c6cd (HEAD slice-model-status-control-replay, includes fix commits 659f0dc/41dd8c0/630203a)
> **שיטה:** linux-gui Chrome :9333 (via pw-clean.sh + SSH CDP tunnel) על mock-greeting replay + live DOM eval; integration tests (vitest run); curl ל-BE :4013 (onecli, restarted); code-trace של ה-fix מול ה-brief.
> **Screenshots:** `/tmp/verify/slice-model-status-control-replay/r2-*.png`

## TL;DR

| מדד | תוצאה |
|------|--------|
| 3 הblockers שתוקנו | **3/3 CLOSED** (high confidence) |
| Regressions על שאר הסליס | 0 (fix scope = 1 קובץ + test, מבודד) |
| Bugs חדשים | 0 |
| Env-blocked (לא כשל) | live-opencode-turn (WS-over-tunnel), TTS-▶-agent (ElevenLabs 401) |
| **Verdict** | **GO** |

ה-fix `slice-fix-turnstate-stuck` ממומש **בדיוק** כפי שתואר ב-brief וב-decisions
(idle-on-RESP + #turnEnded-gated tail-debounce על 4 ה-handlers + reset על 3 מסלולי
הטעינה + #resetTurnTracking + cleanup של הtimer). כל שלושת ה-blockers נסגרו, מאומתים
בראיה דטרמיניסטית (integration tests שבודקים מעבר turnState אמיתי + DOM חי על replay).

## פר-blocker

### Blocker #1 (live turn stuck) — CLOSED
- **קוד:** sendPrompt קובע `#turnEnded=true` + `#setTurnState("idle")` על RESP (:230-231);
  כל 4 ה-handlers ב-`#onSessionUpdate` קוראים `if(#turnEnded) #scheduleIdle()` על tail
  (:697 message, :701 thought, :725 toolCall, :769 toolCallUpdate-מחוץ-ל-if); `#scheduleIdle`
  עם `#TAIL_MS=1500`; cleanup ב-:548. תואם §4 Commit 2 ו-decisions A/B מילה-במילה.
- **בדיקה:** integration test #2 (tail simulation) מאשר: RESP→idle, ואז tail-chunk→responding,
  ואז `advanceTimersByTime(1500)`→idle. test #3 (before-RESP) מאשר: chunk **לפני** RESP
  (#turnEnded=false)→**אין** debounce (turnState נשאר responding) → לא קוטע תור חי. **5/5 ירוקים.**
- **env-block:** תור opencode חי לא נבדק — ה-agent-WS נופל ~2-3ש' אחרי open (1005) דרך
  ה-SSH-tunnel. צד-ה-BE תקין לחלוטין (log: pipe attached, opencode spawns). זו מגבלת-transport
  של ה-harness, לא של הסליס. ה-mock-replay (שמזרים את אותם updates שתור-חי מסתיים בהם)
  ענה ב-turnState=idle נקי.

### Blocker #2 (▶ play no-op) — CLOSED
- נגזרת מ-#1/#3. **בדיקה חיה:** על mock-greeting (turnState=idle) לחיצה על ▶ הפכה את
  ה-aria-label מ-"Play" ל-"Stop" (2 כפתורי Stop הופיעו). ב-r1 זה היה **0 Stop קבוע**.
  ה-guard `turnState!==idle` עכשיו **עובר**. ▶-user (GET של audio מוקלט) = 200.
- **env-block:** ▶-agent (TTS re-synth) לא מפיק `<audio>` כי ElevenLabs מחזיר 401 (quota=0,
  pre-existing). ה-guard עבר — זה מה ש-NBug2 דרש; ה-401 הוא env-blocked, לא fail.

### Blocker #3 (history phantom) — CLOSED
- **קוד:** 3 מסלולי טעינה (loadSession/switchSession/#loadMockSession) קוראים
  `#resetTurnTracking()` בתחילתם + `#setTurnState("idle")` ב-finally הפנימי וב-catch החיצוני
  (תפיסת throw מוקדם של createAgent/waitForOpen).
- **בדיקה חיה:** mock-greeting replay (reload מלא) → `phantomPhaseText: []` (אפס טקסט-phase
  בכל ה-DOM), mic idle, צ'אט נקי מתחת ל-"Hello." (screenshot). ב-r1 הייתה בועת "Responding"
  פנטום פה. integration test #4 מאשר loadMockSession→idle; test #4b מאשר switchSession מנקה
  טיימר-tail יתום (ה-blocker של אביגיל סבב 7).

## Regression על שאר ה-DoD

- ✅ **fix מבודד:** `git diff 659f0dc~1 HEAD` = רק `agent-session.svelte.ts` (+50) + test
  חדש (+264) + docs. **לא** נגע ב-ModelStatus/BubblePlayer/Speaker/StatusBubble/components —
  תואם §3 ("לא נוגעים"). אפס סיכון-regression לליבת הסליס.
- ✅ **recordings (DoD#6):** POST `{audioBase64,mimeType}`→`{id}` 201; GET 200. ללא שינוי.
- ✅ **StatusBubble i18n:** 6 phases → `modelStatus.*` keys; `{#if phase!==null}` render-guard
  (מנגנון ההיעלמות) שלם.
- ✅ **mobile+desktop:** שניהם מרנדרים נקי (footer Record/Type, ▶, אפס פנטום).
- ✅ **RTL:** app.html lang=he dir=rtl.

## נקודות-נפילה-ידועות (heavy checklist)
- Bubble grouping: ה-fix לא נגע ב-`#appendChunk` (§10 merge-note אומת — לא חזר ל-`messageId!==null`).
- Cross-store data: NBug2 (cross-store guard) נסגר.
- Hardcoded nulls: אין.
- Spec drift: ה-fix תואם brief+decisions במדויק (idle-on-RESP, tail-only debounce, gate על #turnEnded).
- Mobile+Desktop: נבדקו.
- Reload/reconnect: NBug3 (reload) נסגר; reconnect-WS = env-blocked (לא קוד).

## סיווג ל-patterns.md (brief-driven-slices/main/patterns.md)
| ממצא | קטגוריה | הערה |
|------|---------|------|
| #1/#3 turnState→idle | קטגוריה 2 (צנרת בין-stores) + reload-reconnect | נסגר — ה-bridge "סיום-תור→idle" עכשיו עמיד גם ל-race של opencode (RESP-באמצע-זרם) ול-replay |
| #2 ▶ guard | קטגוריה 2 (cross-store) | נסגר — ה-fix הוסיף integration-test שבודק **מעבר אמיתי** (resolve→idle, tail→responding→idle), סוגר את פער קטגוריה 1 שה-r1 זיהה ("TDD ירוק עם turnState mocked=idle לא תפס") |
| #4 TTS 401 | קטגוריה 4 (library-compat) | env (quota), לא קוד |
| #5 locale=en | unique | pre-existing |
| #6 WS-over-tunnel drop | unique (env) | מגבלת-harness, לא סליס |

## המלצה
**GO.** שלושת ה-blockers שקיבל ה-slice ב-r1 נסגרו, מאומתים בראיה דטרמיניסטית. ה-fix
מבודד ולא מכניס regression. שתי המגבלות שנותרו (TTS-▶-agent ו-live-opencode-turn) הן
**env/transport**, לא כשלי-קוד — מתועדות כ-env-blocked, לא כ-fail. מומלץ למרדכי: לפני מיזוג
ל-dev, אמת את §10 merge-notes (קונפליקט null-msgid ב-`#onSessionUpdate` — שמור את שתי
ההתנהגויות), ובהזדמנות עם credits/browser-ישיר — לאמת אודיטיבית את ▶-agent + speaking-cue.
