---
project: "voice-acp"
slice: "slice-ws-reconnect-infra"
verifier: "calev-heavy"
date: "2026-06-03"
mode: "heavy"
verdict: "NO-GO"
re_verify_of: "slice-ws-reconnect-infra-calev.md (prior NO-GO, 2 blockers)"
commit: "db7c212"
dod_items:
  - "DoD#1 GET /api/agents returns {agents:[]} — PASS"
  - "DoD#6 manual reconnect() from disconnected — PASS (clean, no leak)"
  - "DoD#7 WARM (abnormal close, child survives) — PASS (same agentId, n stays 1)"
  - "DoD#8 COLD (kill child) — PASS + NBug1 fix CONFIRMED (old agent deleted)"
  - "DoD#9 warm->cold fallback, no deadlock — PASS (~3-4s, no hang)"
  - "DoD#10 background -> disconnected, no auto-reconnect — PASS"
  - "DoD#11 backoff 1->5 then stable disconnected — PASS"
  - "DoD#13 detach -> idle, no reconnect — PASS"
  - "DoD#14 detach mid-backoff stops loop — PASS"
  - "DoD#15 regression normal chat (attach->detach) — PASS, no leak"
  - "DoD#16 no agent accumulation — PARTIAL: PASS for auto-crash-cold (x3 -> n=1); FAIL via public reconnect() on live WS (leaks 1 orphan/call)"
  - "DoD#17 zero UI change — PASS (diff: agent-session.svelte.ts + agents-api.ts + 2 tests + 3 docs)"
spot_check: "Live BE(4001 via OneCLI)+FE(Vite 5173) on linux-gui Chrome via window.__session. NBug1 FIXED (cold-after-crash deletes old agent, x3 steady n=1). NBug2 PARTIALLY fixed (2->1 leak): reconnect() on live WS still leaks exactly 1 orphan ready-agent per call AND orphan survives detach()."
findings:
  - id: 1
    severity: "blocker"
    category: "reload-reconnect"
    summary: "NBug2 STILL LEAKS: public reconnect() on a live WS (warm-fail->cold fallback) leaves exactly 1 orphan live agent per call, and the orphan SURVIVES detach(). The Commit-5 #client.close() fix introduced this: closing the live WS emits browser code 1005, the original onClose handler (attach:347/loadSession:465) treats 1005 as unexpected (code!==1000&&1001) and fires #handleUnexpectedClose -> #scheduleReconnect -> a SECOND #runReconnectLoop -> a second cold createAgent that is never reaped by the first cold's deleteAgent(prevAgentId)."
    source_brief: "DoD#16 + DoD#6 (reconnect() is the public UI-facing method) + Risk table line 633 'WS closed (1005) ghost'"
    source_code: "agent-session.svelte.ts:233-251 (#coldReconnect close), :347-352 + :465-470 (onClose treats 1005 as unexpected), ws-transport.ts:80-87 (close() sends no code => 1005)"
    cost_estimate: "45min"
  - id: 2
    severity: "minor"
    category: "regression"
    summary: "Test suite is 633/634 in this verification env, NOT 634/634 as executor declared. The 1 failure (backend tests/bridge-failure-integration.test.ts 'POST /api/agents broken PATH returns 5xx' expects >=400, gets 201) is PRE-EXISTING and env-specific: it fails IDENTICALLY on the base dev tip 8f59ec3 and lives in a backend file untouched by this frontend-only slice. Not a slice regression; flagged so the 634 claim is not taken at face value."
    source_brief: "DoD#5 Tests (634)"
    source_code: "packages/backend/tests/bridge-failure-integration.test.ts:154 (NOT modified by slice)"
    cost_estimate: "0 (env, out of slice scope)"
  - id: 3
    severity: "minor"
    category: "unique"
    summary: "Brief drift (carried over from prior calev finding3, still unfixed): brief refers to FE package as @drive-coding/frontend but actual name is @drive-coding/frontend-v2. All pnpm --filter @drive-coding/frontend commands in brief fail as written ('No projects matched')."
    source_brief: "section 0 + DoD#2/#3 commands"
    source_code: "packages/frontend/package.json:name = @drive-coding/frontend-v2"
    cost_estimate: "5min"
---

# slice-ws-reconnect-infra — Verification Report (Heavy, re-verify of Commit 5)

> **תאריך:** 2026-06-03
> **Commit בסיס:** db7c212 (8f59ec3..db7c212, 6 commits — Commit 5 = NBug1+NBug2 fix)
> **שיטה:** browser חי (linux-gui Chrome :9222 via tunnel :9223) + window.__session DevTools; BE 4001 via OneCLI, FE Vite 5173 --host, same-origin proxy
> **Screenshots:** אין — slice תשתית, אפס UI (נבדק דרך window.__session + poll של /api/agents)

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 11/12 בדיקים מלאים; DoD#16 חלקי (PASS auto, FAIL public reconnect) |
| Regressions | 0 (שיחה רגילה נקייה) |
| Bugs חדשים | 1 blocker (NBug2 לא תוקן עד הסוף) + 2 minor |
| NBug1 (Commit 5) | ✅ אומת תוקן |
| NBug2 (Commit 5) | ⚠️ תוקן חלקית בלבד — עדיין דליפה |
| typecheck / build | ✅ / ✅ |
| Tests "634" | בפועל 633/634 (1 כשל קדום-קיים, לא של הסלייס) |

**Verdict: NO-GO** — Commit 5 תיקן את NBug1 לגמרי (אומת בשטח), אבל NBug2 תוקן רק חלקית: הדליפה ירדה מ-2 agents לקריאה ל-**1 agent יתום לקריאה**, וה-יתום **שורד detach()**. `reconnect()` הוא ה-API הציבורי שייחשף ל-UI העוקב — כל לחיצה כשהחיבור חי = agent חי דלוף עד ל-reaper (5 דק'). DoD#16 עדיין נכשל בנתיב הזה.

## טבלת DoD items

| # | Item מה-brief | סטטוס | עדות |
|---|---------------|--------|------|
| 1 | GET /api/agents → {agents:[]} | ✅ | `curl :4001/api/agents` → `{"agents":[]}` בהרמה נקייה |
| 2 | Frontend typecheck | ✅ | `pnpm typecheck` exit 0 (הערה: שם החבילה frontend-v2 — finding 3) |
| 3 | Build | ✅ | `pnpm --filter @drive-coding/frontend-v2 build` → "Wrote site to build ✔ done" |
| 4 | lint:i18n | ⓘ | הוכרז ע"י אליעזר (לא נבדק כראיה) |
| 5 | Tests (634) | ⚠️ | בפועל 633 passed / 1 failed. הכשל = backend bridge-failure (קדום-קיים על dev base 8f59ec3, קובץ שלא נגע בו הסלייס). ראה finding 2 |
| 6 | reconnect() ידני | ✅ | מ-disconnected אחרי crash → cold → agent חדש `dbb76b86`, connected, **n=1** (נקי) |
| 7 | **WARM** | ✅ | סגירת WS abnormal (code 3000) + child שורד → auto warm: **אותו** agentId `e6997cb8` לכל אורך ה-poll, n נשאר 1, connected, attempt→0. **אין** createAgent |
| 8 | **COLD** + NBug1 | ✅ | kill child → `dfa29ac9:crashed` → cold → agent חדש `dc0833e9`, ו**הישן נמחק** (n: 1→2→1). NBug1 fix עובד |
| 9 | warm→cold fallback + אין deadlock | ✅ | reconnect() על WS חי: warm 1008×3 → cold; הושלם ~3-4s, לא תקע (Promise.race של אביגיל עובד) |
| 10 | לא-אוטומטי ברקע | ✅ | document.hidden=true + kill child → status=disconnected, attempt=0, **אין** agent חדש (n=1 crashed בלבד) |
| 11 | backoff מדורג | ✅ | חסימת fetch+WS + הפלת WS בפוקוס → attempt 2→3→4→5, נעצר על 5, אז `disconnected` יציב |
| 13 | detach לא מפעיל reconnect | ✅ | detach → idle, attempt=0, agentId=null, BE n→0 |
| 14 | detach mid-backoff | ✅ | detach ב-attempt=3 → idle מיד; אחרי 8s הלולאה לא המשיכה (attempt נשאר 0) |
| 15 | Regression שיחה רגילה | ✅ | attach→detach: n 0→1→0, נקי, אין דליפה |
| 16 | **אין דליפת agents** | ❌ | **חלקי**: auto-cold-after-crash ×3 → n=1 יציב (נקי). אבל `reconnect()` על WS חי → n: 1→2, וה-יתום שורד detach (n נשאר 1). ראה NBug2 |
| 17 | אפס שינוי UI | ✅ | `git diff --stat 8f59ec3..db7c212`: רק agent-session.svelte.ts + agents-api.ts + 2 טסטים + 3 docs. אין components/routes/i18n |

## Flows שעבדו מקצה לקצה

- ✅ **WARM auto-reconnect** — attach (`e6997cb8`) → WS abnormal close(3000) → child שורד → auto warm: אותו agentId לכל אורך ה-poll (11 דגימות n=1), connected, attempt→0. אפס createAgent, אפס דליפה.
- ✅ **COLD auto-reconnect + NBug1 fix** — attach (`dfa29ac9`) → kill child → crashed → cold: agent חדש `dc0833e9`, **הישן נמחק** (trajectory 1→2→1). NBug1 (deleteAgent של prevAgentId) אומת עובד בשטח.
- ✅ **DoD#16 auto path** — 3 מחזורי crash+cold רצופים: כל מחזור התייצב על n=1 בדיוק (`f8ab889b`→`b3331bf5`→`682b3959`). אין הצטברות בנתיב ה-auto.
- ✅ **Backoff escalation** — חסימת כל נתיבי reconnect → attempt 2→3→4→5→ disconnected יציב (לולאה מסתיימת נכון, אין deadlock).
- ✅ **Background guard** — document.hidden + kill → disconnected, אפס auto-reconnect.
- ✅ **detach + detach-mid-backoff** — שניהם עוצרים מיד, אין reconnect אחרי.
- ✅ **Regression: שיחה רגילה** — attach→detach נקי לחלוטין.

## Flows שנשברו

- ❌ **reconnect() ציבורי כשה-WS עדיין חי** — מסתיים פונקציונלית (status=connected, agentId חדש) אבל **משאיר agent יתום אחד חי** ב-BE לכל קריאה, וה-יתום **שורד detach()**. שוחזר פעמיים בנפרד + repro דטרמיניסטי נקי (n 1→2, ואז detach→1).

## Regressions

- אין regression שנגרם מהסלייס. שיחה רגילה (attach→detach) נקייה. הכשל היחיד בטסטים (bridge-failure) קדום-קיים על dev base 8f59ec3 ובקובץ backend שהסלייס לא נגע בו — לא regression.

## Bugs חדשים שלא ברשימה

### ❌ NBug2 (blocker, לא תוקן עד הסוף) — reconnect() על WS חי מדליף agent יתום + שורד detach

- **מניפסטציה:** קריאה ל-`reconnect()` הציבורי כשה-WS עדיין פתוח (לחיצת UI "reconnect" בלי שה-WS נפל באמת) משאירה **agent יתום אחד `status=ready`** (child opencode חי) לכל קריאה. ה-יתום **לא נמחק ב-detach()** — שורד עד ל-reaper (~5 דק').
- **עדות (repro דטרמיניסטי):** attach `93a2772e` (n=1) → `reconnect()` → **n=2** → `detach()` → **n=1** (`57be72f2:ready` שורד). שוחזר גם פעם קודמת (1→2 settled, ואז reconnect שני 2→3). שני ה-agents היתומים חולקים את אותו acpSessionId של הסשן המקורי.
- **גורם (אותר מהקוד + מהתנהגות):** התיקון של Commit 5 הוסיף `this.#client?.close()` ב-`#coldReconnect` (שורה 237). אבל `WsAcpTransport.close()` (ws-transport.ts:80-87) קורא ל-`ws.close()` **בלי code** → הדפדפן שולח **1005**. סגירה זו על ה-WS **החי** מפעילה את ה-onClose המקורי שנרשם ב-`attach`(347-352)/`loadSession`(465-470), שבודק `code!==1000&&code!==1001` → **1005 עובר** → קורא `#handleUnexpectedClose` → `#scheduleReconnect` → מפעיל **לולאת `#runReconnectLoop` שנייה**. בנתיב reconnect() הציבורי `#reconnecting=false` (אופס ב-reconnect()), כך שה-guard לא חוסם. הלולאה השנייה מריצה cold שני → createAgent שני, שה-deleteAgent(prevAgentId) של ה-cold הראשון לא מכסה. זה בדיוק ה-"WS closed (1005) ghost" שטבלת ה-Risks (שורה 633) טענה שמכוסה ע"י `#detached` — אבל `#detached=false` במהלך reconnect, אז ה-guard לא רלוונטי כאן.
- **למה NBug1 כן תוקן ו-NBug2 לא:** בנתיב **auto-cold-after-crash** ה-WS המקורי כבר מת לפני ש-`#client.close()` נקרא → אין onClose נוסף → אין לולאה שנייה → נקי. הדליפה ספציפית למצב שבו ה-WS **עדיין חי** כש-cold נכנס (reconnect() ידני על חיבור חי, או warm-fail→cold כשהסיבה ל-warm-fail היא MED-8 ולא נפילה אמיתית).
- **חומרה:** blocker — `reconnect()` הוא ה-API הציבורי שיחשף ל-UI העוקב; DoD#16 דורש במפורש שלא תהיה הצטברות agents. כאן מצטברים agents חיים, וזה אפילו שורד detach.

### ⚠️ NBug-test (minor) — "634 tests" בפועל 633/634

- **מניפסטציה:** `pnpm test` → 633 passed, 1 failed. הכשל: `packages/backend/tests/bridge-failure-integration.test.ts` — "POST /api/agents with broken PATH (ENOENT) returns 5xx" מצפה ל-≥400, מקבל 201.
- **גורם:** קדום-קיים + env-specific. אומת שנכשל **זהה על dev base 8f59ec3** (לא חלק מהסלייס), בקובץ backend שהסלייס לא נגע בו (סלייס frontend-only). כנראה התנהגות spawn ב-container הזה (PATH שבור עדיין מצליח). **לא regression של הסלייס.**
- **חומרה:** minor — מתעד שה-"634 ✓" של אליעזר לא מדויק בסביבה הזו; לא חוסם את הסלייס.

### ⚠️ NBug3 (minor, carried-over) — שם חבילת FE שגוי ב-brief

- ה-brief מתייחס ל-`@drive-coding/frontend` אבל השם האמיתי `@drive-coding/frontend-v2`. כל פקודות `pnpm --filter @drive-coding/frontend ...` ב-§0/§4/§5 נכשלות. (אותו finding כמו בסבב הקודם — לא תוקן ב-Commit 5.)

## סיווג ל-patterns.md

| באג | קטגוריה | הערה |
|------|---------|------|
| NBug2 | reload-reconnect (כלב) | תיקון-של-תיקון יצר באג חדש: `#client.close()` ללא code → 1005 → onClose ישן → לולאת reconnect שנייה. דפוס "fix triggers stale-listener side-effect". mock-only tests לא תופסים (כל ה-adapters mocked). |
| NBug-test | regression / library-compat | טסט אינטגרציה env-sensitive, קדום-קיים — לא של הסלייס |
| NBug3 | unique | brief drift על שם חבילה |

> **מטא:** NBug1 הוכיח שהרצה אמיתית מול BE היא הדרך היחידה לתפוס דליפות (unit mock-only מסתיר). NBug2 מדגים שתיקון ממוקד שלא נבדק בשטח (Commit 5 לא עבר re-verify בגלל קריסת tmux) יכול לתקן 50% מהבעיה ולהשאיר 50% — וגרוע מכך, ה-fix עצמו (`#client.close`) הוא שמפעיל את ה-onClose שיוצר את היתום. תיקון נכון חייב: סגירת WS עם code 1000/1001, **או** הסרת ה-onClose listener לפני close ב-cold, **או** guard ב-#handleUnexpectedClose שמזהה שאנחנו כבר בתוך reconnect.

## סיכום לסוכן הבא (אליעזר של ה-fix)

עדיפות לתיקון:
1. **NBug2 (blocker)** — מנע את הלולאה השנייה כש-`#coldReconnect` סוגר WS חי. שלוש אפשרויות (אחת מספיקה):
   (א) הסר את ה-onClose listener של ה-transport הישן לפני `#client.close()` ב-cold (הכי נקי — דורש לחשוף הסרת listener ב-WsAcpTransport, או לשמור ref ל-transport ולנטרל את ה-handler);
   (ב) הוסף guard ב-`#handleUnexpectedClose`: אם `this.#reconnecting === true` או שאנחנו בתוך `#doReconnect` — אל תפתח לולאה חדשה (סמן flag `#reconnectInProgress` ב-#doReconnect);
   (ג) סגור את ה-WS עם code 1000 ב-cold כך שה-onClose יחזור מוקדם (אבל זה משנה את WsAcpTransport.close הגלובלי — פחות ממוקד).
   **המלצה: (ב)** — flag פנימי שחוסם `#scheduleReconnect` כל עוד `#doReconnect`/`reconnect()` רץ. ⚠️ ודא שזה לא שובר את WARM (שם אין close על WS חי) ולא את auto-cold (שם ה-WS כבר מת).
2. **NBug3 (minor)** — תקן שם החבילה ב-brief ל-`frontend-v2`.
3. **NBug-test (לא בסלייס)** — הכשל ב-bridge-failure-integration קדום-קיים על dev; להפנות ל-מרדכי כ-tech-debt נפרד (לא חוסם את הסלייס).

> **הערה ל-מרדכי:** הליבה הארכיטקטונית (warm-first, deadlock-fix, backoff, visibility, detach, NBug1) **עובדת ואומתה מצוין בשטח**. נשאר באג נקודתי אחד: ה-fix של NBug2 (Commit 5) טיפל בחצי — `#client.close()` על WS חי מפעיל את ה-onClose הישן (1005) שפותח לולאת reconnect שנייה → יתום. תיקון ~45 דק'. אחרי התיקון — re-verify ממוקד על DoD#6/#16 בנתיב reconnect()-על-WS-חי בלבד (שאר ה-DoD כבר ירוקים).
