# Slice reattach-state-sync — סנכרון state ב-warm reattach (capabilities + turn + liveness) דרך `_drive/*`

> **תאריך**: 2026-07-04 · **base-refresh**: 2026-07-12 · **סטטוס**: ✅ אביגיל READY r2 (‏`f017665e`) → **base-refresh re-verify מתבצע** (dev זז 134 commits; +עריכת post-READY `a86c5cbf`)
> **מקור**: נגזר מ-image-paste known-limitation (warm reattach → `supportsImageInput=false`). הכללה: כל state שה-FE בונה מ-`initialize`/wire נעלם ב-warm reattach, כי שניהם לא משוחזרים.
> **Base**: `dev` HEAD (v0.17.1, `43e9d28e`) — *עודכן מ-v0.12.0 `9ebf10b`. הפרמיסה שרירה: `NormalizedCapabilities` עדיין ללא `image`, `ATTACHED_CAPS_FALLBACK = {}`, והערת `capabilities-static.ts:12` ("not currently mapped") ללא שינוי. ⚠️ `be-lifecycle-hardening` (v0.17.1) נגע ב-2 קבצים-בתחום — additive: `connect-in-process.ts` (dispose-on-close, לא באזור ה-wire-tap) ו-`ws-agent.ts` (obs-log, הזיז line-numbers). **עַגֵּן ב-anchors, לא ב-line-numbers.***
> **depends_on**: `[]` (image-paste מוזג ל-dev ב-v0.12.0 `9ebf10b`)
> **נתיבים שזזו מאז הטיוטה** (שמות-הקבצים בגוף ה-brief תקפים; העדכון הוא לספרייה): `capabilities-static.ts` → `packages/provider/src/connection/` · `ws-agent.ts` → `packages/backend/src/delivery/` · `agent-session.svelte.ts` → `packages/frontend/src/lib/view-models/`

---

## §1 — מטרה

ב-**warm reattach** (`createAttachedAcpClient` — FE מתחבר לסוכן שכבר רץ, בלי `initialize`), ה-FE מאבד שלושה דברים שה-BE **כבר יודע**:
1. **capabilities** (‏`promptCapabilities.image` וכו') — נשאב מ-`initialize`, שלא רץ ב-reattach → קלט-תמונות מושבת עד connect קר.
2. **turn/running state** — נבנה מהתבוננות-wire → אם מתחברים באמצע turn, הבועה לא מוצגת כ"רצה" עד ה-frame הבא.
3. **liveness** — אין דרך לדעת אם הסוכן (child) חי/תקוע; ה-`$/ping` הקיים בודק רק את קו ה-WS (‏FE↔BE), לא את הסוכן.

**הפתרון המאחד:** ה-BE **מחזיק** את שלושתם ב-`connection-registry` (‏ה-`ConnEntry` שורד detach). דוחפים אותם ל-FE דרך ערוץ `_drive/*` **בכל attach** (‏כמו `_drive/capabilities` שכבר עובד ל-`thinkingTokens`) — בלתי-תלוי ב-`initialize`. ה-FE צורך ב-(re)attach במקום להישען על wire-replay.

## §2 — Universal מול per-provider (הכרעת-מפתח)

3 סוגי חיבור: **claude** in-process · **codex** in-process (`startAcpServer`) · **opencode** spawn.

| רובד | claude in-proc | codex in-proc | spawn | סיווג |
|------|----------------|---------------|-------|-------|
| turn-tracker | `createTurnTracker` | אותו | אותו | ✅ **אוניברסלי** — אין שינוי-ליבה |
| capabilities (BE היום) | `mapClaudeCapabilities(null)` static | `staticCapsFor("codex")` static | `staticCapsFor(kind)` static | 🟡 delivery אוניברסלי; sourcing סטטי-פר-ספק |
| pid (בסיס liveness) | `null` | `null` | אמיתי (`core.getChild.pid`) | 🔴 interface אוניברסלי; מימוש פר-ספק |

**עקרון-התכנון:** `ProviderConnection` נשאר **interface אחיד** (registry/delivery/FE אגנוסטיים), והמימוש הפר-ספק חי בתוך כל `connect-*`. זה בדיוק הדפוס הקיים (turn/capabilities/pid כבר uniform-interface, provider-specific-impl).

## §3 — Scope

| פריט | כן/לא | הערה |
|---|---|---|
| capabilities (כולל `image`) שורד reattach | ✅ (Commit 1-2) | הכאב הקונקרטי — סוגר את image-paste limitation |
| turn/busy נזרע ב-attach (מוצג "רץ" ב-load) | ✅ (Commit 3) | consume-existing (turn-tracker כבר קיים+שורד) |
| liveness (BE↔child) משלים את ה-ping | ✅ (Commit 4) | **מומלץ לשקול slice נפרד** — ר' §8 |
| שינוי ה-`$/ping` הקיים (FE↔BE) | ❌ | נשאר; ה-liveness מוסיף שכבה, לא מחליף |
| UI חדש ל-liveness | ❌ | ה-slice חושף state; תצוגה = follow-up |

## §4 — Commits

### Commit 1 — `NormalizedCapabilities.image` + מקור-אמת (approach: **TDD** core + provider)
**הבעיה:** `NormalizedCapabilities` (`provider/src/types.ts:11-35`) נושא 7 שדות (`mcp`/`compact`/`commands`/`usage`/`configOptions`/`rename`/`thinkingTokens`) — **לא** `image`. המקורות הסטטיים (`mapClaudeCapabilities`, `staticCapsFor`) לא כוללים אותו (codex מדווח `image:true` אך "not currently mapped" — `capabilities-static.ts:12`).

**הכרעה — מקור sourcing** (§2 🟡): שתי אופציות, ה-brief בוחר **B**:
- **A (static)**: הוסף `image` ל-`NormalizedCapabilities`, hardcode פר-ספק ב-3 המקורות. פשוט, אבל **ניחוש** שיכול לסטות ממה שהסוכן מדווח (בדיוק סיכון §10 של image-paste).
- **B (tap real init) — נבחר**: לכוד את frame ה-`initialize` **response** מה-wire (כל 3 ה-connect-* כבר עושים `onFrame`/`handleLine` על dir="in") → חלץ את `promptCapabilities.image` **האמיתי** → אחסן על ה-connection. אוניברסלי + מדויק. הפתרון היחיד שנותן ערך-אמת אחיד בלי per-provider hardcode.

**שינויים:**
- `provider/src/types.ts`: `NormalizedCapabilities.image: boolean` (non-optional — עקבי עם 7 השדות הקיימים).
  - ⚠️ **finding אביגיל 🟡 (r3→r5, drift-proof) — `image` non-optional ⇒ typecheck יתפוס כל literal *מלא* של `NormalizedCapabilities` (לא silent, לא blocker). אל תמנה מספרי-שורה מוחלטים (מתיישנים תוך דקות); עַגֵּן בשמות-סמל. האתרים:**
    - **Production — 8 literals מלאים** (כולם → `image:false` כברירת-מחדל בטוחה; ה-tap יעדכן לאמיתי):
      1. `staticCapsFor` ב-`connection/capabilities-static.ts` — **6 cases** (opencode/claude/codex/**cursor**/**grok**/default; כל case מעוגן ב-`thinkingTokens:`). **אחיד `image:false` לכולם** — גם codex (למרות הערת `:12`); עדיף להסתמך על ה-tap מאשר לנחש פר-ספק.
      2. `mapClaudeCapabilities` ב-`providers/claude/capabilities.ts` (מעוגן ב-`thinkingTokens:`).
      3. FE `get supports()` fallback ב-`agent-session.svelte.ts` (ה-literal ה-Normalized המלא; מעוגן ב-`get supports()`). ⚠️ **לא** `ATTACHED_CAPS_FALLBACK` — ר' F3 למטה.
    - **Tests — 2 literals מלאים בלבד** (typecheck יתפוס אותם; אין צורך "לצוד"):
      4. `makeCapabilities()` helper ב-`agent-session.capabilities.test.svelte.ts` (return מלא).
      5. stub של `ProviderConnection` ב-`connection-registry.race.test.ts` (‏caps מלא).
    - ⚠️ **אל תיגע** ב-`simulateCaps({...})` (‏`agent-session.capabilities.test`) וב-payloads של `client.extmethod.test.ts` — הם `Partial<NormalizedCapabilities>`/`Record<string,unknown>`, **אינם** צריכים `image`, והוספתו שם תשבור `toHaveBeenCalledWith`.
  - (אלטרנטיבה שנשקלה ונדחתה: `image?: boolean` optional — פחות churn אבל שובר עקביות עם 7 השדות האחרים; בחרנו non-optional + עדכון כל האתרים.)
- מנגנון tap: helper `extractPromptCaps(parsed)` (core, TDD — טהור). **המפענח שלנו קיים — אין נגיעה במתאם:** `decodeWireLine` (`shared/wire-decode.ts`) כבר רץ בכל 3 ה-`connect-*` וחושף `parsed` (האובייקט המלא) + `responseKind` (`"result"`/`"error"`/undefined).
  - ⚠️ **finding אביגיל 🟡 — זיהוי מבני, לא לפי method:** ה-initialize **response** הוא frame מסוג **JSON-RPC result** — **אין בו `method`**. הסימן המוכן: `WireSummary.responseKind === "result"` (`wire-decode.ts:38`) **וגם** `parsed.result?.agentCapabilities?.promptCapabilities` קיים. `extractPromptCaps(parsed)` מחזיר `{ image: boolean }` (או `undefined` אם אין `agentCapabilities` → לא frame של init). כך מבחינים init-response מ-notification (`method`) ומ-`error`.
  - חיווט בכל `connect-*`: ב-`handleLine`/tap של dir="in", אם `extractPromptCaps` מחזיר ערך → עדכן את ה-caps הפנימי. ⚠️ ה-`capabilities` היום `readonly` value — יהפוך ל-getter שקורא `let caps` פנימי mutable.
- fallback: עד שנצפה init-response, `image=false` (בטוח).

> ⚠️ **הערה (finding אביגיל 🟢, pre-existing):** הערת-header ב-`connect-in-process.ts` טוענת `mapClaudeCapabilities(null)` מחזיר `mcp=true` — **הקוד מחזיר `mcp=false`**. הערה ישנה, לא מהסלייס. **אל תסמוך על ההערה**; קרא את `mapClaudeCapabilities` בפועל. (תיקון ההערה = אופציונלי, מחוץ ל-scope.)

**Tests**: `extractPromptCaps` על result-frame של init עם/בלי `promptCapabilities.image` · על result-frame בלי `agentCapabilities` (→undefined, מתעלם) · על frame עם `method` (notification — מתעלם) · אינטגרציה: אחרי הזרקת init-result-frame ל-connect-double, `conn.capabilities.image===true`.

### Commit 2 — FE: `supportsImageInput` דרך NormalizedCapabilities (approach: **manual**)
- `_drive/capabilities` **כבר נשלח ב-attach** (`backend/src/delivery/ws-agent.ts` — עַגֵּן ב-anchors `markAttached` → ואז `method:"_drive/capabilities"`/`feWs.send`; ~`:100`/`:111`/`:114` ב-`43e9d28e`, אך **ה-line-numbers נודדים תוך דקות — סמוך על ה-anchor, לא על המספר**; שורד reattach). עכשיו הוא נושא `image`.
- `agent-session.svelte.ts`: `supportsImageInput` (`:177`) יקרא `this.#capabilities?.image` (‏NormalizedCapabilities מ-`_drive/capabilities`, storage `#capabilities` `:261`, handler `:1522`) **כ-fallback/מקור** במקום raw-בלבד. (ה-raw נשאר ל-cold; ה-normalized מכסה warm.)
  - ⚠️ **finding אביגיל 🟢 (r3):** `ATTACHED_CAPS_FALLBACK = {} as AcpClient["capabilities"]` (`:65`) הוא type של **raw** caps — **לא** `NormalizedCapabilities`, ולכן **אינו צריך `image`**. ה-literal ה-Normalized שכן צריך `image` הוא `get supports()` fallback (`:202-210`, ר' Commit 1). אל תערבב.
- ⚠️ שמור על `IMAGE_INPUT_ENABLED` (=true מ-image-paste).

**Verification (חי)**: connect קר → כפתור-תמונה מופיע · **warm reattach → הכפתור נשאר** (הבאג המקורי) · שלח תמונה אחרי reattach.

### Commit 3 — turn/busy נזרע ב-attach (approach: **manual**)
- ה-BE כבר יודע: `getRuntimeInfo().busy` (‏`conn.turn.isBusy()`, שורד detach). 
- **delivery**: הרחב את ה-push ב-attach — או שדה `busy` ב-`_drive/capabilities`, או `_drive/runtime` אחות (‏`{busy, lastActivityAt}`). (הכרעה ב-§9.)
- `agent-session.svelte.ts`: ב-attach, זְרַע `turnState` מ-`busy` (אם `true` → הצג "רץ" מיד, בלי לחכות ל-frame).

**Verification (חי)**: הפעל prompt ארוך → נתק (leave-running) → חזור **באמצע ה-turn** → הבועה/מצב מוצגים "רץ" מיד.

### Commit 4 — liveness `isAlive()` (approach: **TDD** interface + per-provider) — *שקול slice נפרד (§8)*
- **interface**: `ProviderConnection.isAlive(): boolean` (‏או `Promise<boolean>` אם probe אסינכרוני).
- **מימוש פר-ספק** (§2 🔴):
  - **spawn** (`spawn.ts`): `pid` אמיתי → `process.kill(pid, 0)` ב-try/catch (signal-0 = probe בלי הרג).
  - **claude in-proc** (`connect-in-process.ts`): `pid:null` → מצב `agentConn` (ה-`agentConn.closed` לא-resolved = חי) / stream-bridge פתוח.
  - **codex in-proc** (`connect-codex-in-process.ts`): `pid:null` → מצב ה-conn של `startAcpServer`.
- **registry**: `getRuntimeInfo` יוסיף `alive: boolean`.
- ⚠️ זה **משלים** את `$/ping` (‏FE↔BE), לא מחליף. + `onCrash` הקיים כבר מכסה קריסה-פתאומית; `isAlive` מכסה probe יזום.

**Verification**: spawn חי → `isAlive=true`; הרוג את ה-child ידנית → `isAlive=false`. in-proc: אחרי `close()` → false.

## §5 — DoD

| בדיקה | Commit |
|---|---|
| `NormalizedCapabilities.image` מאוכלס מ-init-frame אמיתי (לא static) | 1 |
| `extractPromptCaps` TDD ירוק | 1 |
| warm reattach → כפתור-תמונה נשאר, שליחה עובדת (הבאג המקורי נסגר) | 2 |
| cold connect ללא רגרסיה (raw עדיין עובד) | 2 |
| reattach באמצע turn → מוצג "רץ" מיד | 3 |
| `isAlive()` נכון פר-ספק (spawn signal-0, in-proc conn-state) | 4 |
| typecheck + build + `lint:i18n` + provider/core tests ירוקים | כל commit |

## §6 — Risks

| סיכון | מיטיגציה |
|---|---|
| tap init-frame — הפורמט שונה פר-ספק? | `promptCapabilities` הוא ACP-סטנדרטי (`InitializeResponse`); ה-tap מפענח JSON-RPC result אחיד. TDD על frame אמיתי מכל ספק. |
| `capabilities` היום readonly value → שינוי ל-mutable/getter | additive; ה-getter מחזיר snapshot. אימות שכל הצרכנים (`getRuntimeInfo`, `_drive/capabilities`) קוראים דרך ה-getter. |
| in-process liveness — אין pid | מצב `agentConn.closed`/stream כבר קיים; לא צריך OS-probe. |
| ריבוי FE (multi-client) — attach push פר-לקוח | ה-push כבר פר-attach; לא רגרסיה. |

## §7 — Complexity
**Full slice (1-4):** BE (3 connect-* + types + registry + delivery) + FE (VM) + 3 ספקים + tap-wire + TDD core + liveness pid פר-ספק. **~8/10 → `calev-heavy`.**

> **🎯 הרצה נוכחית (capabilities-only, Commit 1+2):** בלי Commit 3 (turn) ובלי Commit 4 (liveness pid פר-ספק — המרכיב הכי-כבד). נשאר: הוספת שדה `image` ל-`NormalizedCapabilities` + tap init-frame (TDD core טהור) + חיווט 3 connect-* + שדה FE אחד. **~5/10 → `calev` light.** runtime-gate חי מול claude in-proc (image button שורד reattach) + ספק spawn אחד (‏opencode) לוודא caps אמיתי-מ-tap. אין צורך ב-pid/liveness → אין calev-heavy.

## §8 — המלצת-חיתוך (JIT)

> **🎯 הכרעת-dispatch (2026-07-12, המשתמשת):** ה-slice הזה משוגר כעת כ-**capabilities-only = Commit 1 + Commit 2 בלבד**. Commit 3 (turn/busy) **נדחה ל-follow-up**; Commit 4 (liveness) = slice נפרד. הבקשה הקונקרטית = לגבות את יכולות-ה-CLI ברישום ה-BE כך שישרדו reattach. לכן ה-DoD, ה-verifier וה-complexity למטה חלים על **1+2 בלבד** בהרצה הזו.

- **הרצה נוכחית = Commit 1 + Commit 2** — **capabilities across reattach**. סוגר את הכאב הקונקרטי (image-paste limitation: `supportsImageInput=false` אחרי reattach). Complexity מצומצם (‏ר' §7 — הערת capabilities-only) → **`calev` light**, לא heavy.
- **Follow-up (אותו brief, dispatch נפרד)** = Commit 3 (turn/busy נזרע ב-attach). רוכב על אותו attach-push; מומלץ אחרי ש-1+2 מוזג ואומת חי.
- **Phase B (slice נפרד)** = Commit 4 (liveness). מימוש פר-ספק, concern נפרד (משלים ping), ואפשר לאמת עצמאית. **מתחבר ל-`be-hang-supervisor`** (roadmap Track F) — שם ה-liveness החיצוני נדון; שקול לאחד.

## §9 — שאלות פתוחות
| # | שאלה | ברירת-מחדל | חוסם? |
|---|------|-----------|-------|
| 1 | `busy`/`image` על אותו `_drive/capabilities` או `_drive/runtime` נפרד? | הרחב את `_drive/capabilities` הקיים (פחות ערוצים; caps+runtime יחד ב-attach) | ❌ |
| 2 | `isAlive` sync או async? | sync (pid signal-0 + conn-state שניהם sync) | ❌ |
| 3 | tap init-frame — לאחסן רק `image` או את כל `promptCapabilities`? | כל `promptCapabilities` (audio/embeddedContext עתידיים ילכו באותו מסלול) | ❌ |
| 4 | Phase B נפרד או מאוחד ל-`be-hang-supervisor`? | להכריע לפני dispatch של B | ❌ (רק ל-B) |

## §10 — כיוון-עתיד (לא ב-scope): hooks במתאם

ה-slice הזה משתמש ב-**tap פסיבי** (`decodeWireLine` על ה-wire) כדי להישאר **אגנוסטי למתאם** — קוד ה-`@agentclientprotocol/*` נשאר שקוף (עיקרון-יסוד של הפרויקט). זה עובד, אבל לוכד state *בדיעבד* מהתעבורה.

**כיוון-עתיד (נדון 2026-07-04):** להכניס **hooks רשמיים למתאם** (callbacks על initialize/turn-lifecycle/capabilities) במקום הסקה מ-wire — נקי יותר וסמכותי יותר. אם המנגנון גנרי — **שקול PR upstream** ל-`agent-client-protocol`. עד אז, ה-tap הפסיבי הוא הגישה הנכונה (אפס תלות ב-fork/מתאם). אם/כשיוכנסו hooks — `extractPromptCaps` + turn-tracker יוחלפו בקריאות-hook ישירות, וה-`_drive/*` delivery + registry-hold נשארים ללא שינוי.
