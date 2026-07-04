# Slice reattach-state-sync — סנכרון state ב-warm reattach (capabilities + turn + liveness) דרך `_drive/*`

> **תאריך**: 2026-07-04 · **סטטוס**: 💭 טרם אביגיל
> **מקור**: נגזר מ-image-paste known-limitation (warm reattach → `supportsImageInput=false`). הכללה: כל state שה-FE בונה מ-`initialize`/wire נעלם ב-warm reattach, כי שניהם לא משוחזרים.
> **Base**: `dev` HEAD (v0.12.0, `9ebf10b`)
> **depends_on**: `[]` (image-paste כבר מוזג)

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
**הבעיה:** `NormalizedCapabilities` (`provider/src/types.ts`) נושא `mcp`/`rename`/`thinkingTokens` — **לא** `image`. 3 המקורות הסטטיים (`mapClaudeCapabilities`, `staticCapsFor`) לא כוללים אותו (codex מדווח `image:true` אך "not currently mapped" — `capabilities-static.ts:12`).

**הכרעה — מקור sourcing** (§2 🟡): שתי אופציות, ה-brief בוחר **B**:
- **A (static)**: הוסף `image` ל-`NormalizedCapabilities`, hardcode פר-ספק ב-3 המקורות. פשוט, אבל **ניחוש** שיכול לסטות ממה שהסוכן מדווח (בדיוק סיכון §10 של image-paste).
- **B (tap real init) — נבחר**: לכוד את frame ה-`initialize` **response** מה-wire (כל 3 ה-connect-* כבר עושים `onFrame`/`handleLine` על dir="in") → חלץ את `promptCapabilities.image` **האמיתי** → אחסן על ה-connection. אוניברסלי + מדויק. הפתרון היחיד שנותן ערך-אמת אחיד בלי per-provider hardcode.

**שינויים:**
- `provider/src/types.ts`: `NormalizedCapabilities.image: boolean` (non-optional — עקבי עם `mcp`/`rename`/`thinkingTokens`).
  - ⚠️ **finding אביגיל 🟡 — שדה non-optional שובר 4 literals שבונים `NormalizedCapabilities`; חובה להוסיף `image` לכולם:**
    1. `staticCapsFor` default/כל case ב-`capabilities-static.ts` (codex→`image:true` לפי `:12`; opencode→`image:false` עד שנתפוס אמיתי).
    2. `mapClaudeCapabilities` ב-`providers/claude/capabilities.ts` (→`image:false` בסיס; ה-tap יעדכן).
    3. FE all-false fallback ב-`agent-session.svelte.ts` (‏`supports`/`ATTACHED_CAPS_FALLBACK` — כל object שבונה NormalizedCapabilities מלא).
    4. ‏2 literals בטסטים (`capabilities-static.test.ts` + FE/VM test) — הוסף `image:false`.
  - (אלטרנטיבה שנשקלה ונדחתה: `image?: boolean` optional — פחות churn אבל שובר עקביות עם 3 השדות האחרים; בחרנו non-optional + עדכון 4 האתרים.)
- מנגנון tap: helper `extractPromptCaps(parsed)` (core, TDD — טהור).
  - ⚠️ **finding אביגיל 🟡 — זיהוי מבני, לא לפי method:** ה-initialize **response** הוא frame מסוג **JSON-RPC result** — **אין בו `method`**. `extractPromptCaps` חייב לזהות מבנית: לחפש `parsed.result?.agentCapabilities?.promptCapabilities` (או `agentCapabilities.promptCapabilities` לפי צורת ה-`parsed` של `decodeWireLine`). מחזיר `{ image: boolean }` (או `undefined` אם אין `agentCapabilities` → לא frame של init).
  - חיווט בכל `connect-*`: ב-`handleLine`/tap של dir="in", אם `extractPromptCaps` מחזיר ערך → עדכן את ה-caps הפנימי. ⚠️ ה-`capabilities` היום `readonly` value — יהפוך ל-getter שקורא `let caps` פנימי mutable.
- fallback: עד שנצפה init-response, `image=false` (בטוח).

> ⚠️ **הערה (finding אביגיל 🟢, pre-existing):** הערת-header ב-`connect-in-process.ts` טוענת `mapClaudeCapabilities(null)` מחזיר `mcp=true` — **הקוד מחזיר `mcp=false`**. הערה ישנה, לא מהסלייס. **אל תסמוך על ההערה**; קרא את `mapClaudeCapabilities` בפועל. (תיקון ההערה = אופציונלי, מחוץ ל-scope.)

**Tests**: `extractPromptCaps` על result-frame של init עם/בלי `promptCapabilities.image` · על result-frame בלי `agentCapabilities` (→undefined, מתעלם) · על frame עם `method` (notification — מתעלם) · אינטגרציה: אחרי הזרקת init-result-frame ל-connect-double, `conn.capabilities.image===true`.

### Commit 2 — FE: `supportsImageInput` דרך NormalizedCapabilities (approach: **manual**)
- `_drive/capabilities` **כבר נשלח ב-attach** (`ws-agent.ts` — `markAttached` ב-`:73`, שליחת ה-notification ב-`:82`/`:87`; שורד reattach). עכשיו הוא נושא `image`.
- `agent-session.svelte.ts`: `supportsImageInput` יקרא `this.#capabilities?.image` (‏NormalizedCapabilities מ-`_drive/capabilities`) **כ-fallback/מקור** במקום raw-בלבד. (ה-raw נשאר ל-cold; ה-normalized מכסה warm.)
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
BE (3 connect-* + types + registry + delivery) + FE (VM) + 3 ספקים + tap-wire + TDD core. **~8/10 → `calev-heavy`.** runtime-gate חי מול claude (in-proc) + לפחות ספק spawn אחד (liveness pid).

## §8 — המלצת-חיתוך (JIT)
- **Phase A (מומלץ עכשיו)** = Commit 1+2+3 — **capabilities + turn across reattach**. שניהם רוכבים על אותו attach-push, שניהם delivery-אוניברסלי, וסוגרים את הכאב הקונקרטי (image-paste limitation + "רץ" ב-load).
- **Phase B (slice נפרד)** = Commit 4 (liveness). מימוש פר-ספק, concern נפרד (משלים ping), ואפשר לאמת עצמאית. **מתחבר ל-`be-hang-supervisor`** (roadmap Track F) — שם ה-liveness החיצוני נדון; שקול לאחד.

## §9 — שאלות פתוחות
| # | שאלה | ברירת-מחדל | חוסם? |
|---|------|-----------|-------|
| 1 | `busy`/`image` על אותו `_drive/capabilities` או `_drive/runtime` נפרד? | הרחב את `_drive/capabilities` הקיים (פחות ערוצים; caps+runtime יחד ב-attach) | ❌ |
| 2 | `isAlive` sync או async? | sync (pid signal-0 + conn-state שניהם sync) | ❌ |
| 3 | tap init-frame — לאחסן רק `image` או את כל `promptCapabilities`? | כל `promptCapabilities` (audio/embeddedContext עתידיים ילכו באותו מסלול) | ❌ |
| 4 | Phase B נפרד או מאוחד ל-`be-hang-supervisor`? | להכריע לפני dispatch של B | ❌ (רק ל-B) |
