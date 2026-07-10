# Slice — tts-provider-availability — תוכנית

> **תאריך**: 2026-07-02
> **סטטוס**: ‏הושלם + ‏runtime-GO — ‏Commits 0-4 ‏(`526f70a`..`0457214`); ‏capability-gate: ‏אביגיל READY r5, ‏calev GO 7/7 (‏**‏14→0 בקשות voices אומת חי בדפדפן**). ‏ממתין reconcile+merge.
> **Complexity**: 7/10 (verifier: light)
> **תלות**: ‏אין (base=dev, depends_on=[])
>
> **‏שינוי-כיוון (2026-07-02, ‏אחרי preview חי)**: ‏ה-preview חשף שה-slice עוצר בחצי הדרך — ‏הוא מסמן ספק `disabled` ‏בבורר, ‏אבל **‏לא מונע תעבורה** ‏לספק לא-זמין. ‏נתפס retry-loop של `loadVoices` (‏14 ‏בקשות ל-`/v1/voices`, ‏7×401, ‏עם מפתח-פגום). ‏ההרחבה: ‏ה-capability הופך ל-**‏gate מרכזי** ‏שחוסם את *‏כל* ‏הקריאות לספק לא-זמין (‏loadVoices + ‏TTS synthesize), ‏לא רק מסמן disabled. ‏זו מטרת ה-slice המקורית ("‏הפסק להטריד endpoints לא-שמישים").

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/tts-provider-availability -b slice/tts-provider-availability dev
cd .worktrees/tts-provider-availability
pnpm install && pnpm hooks:install
```

### Run
- ‏BE (‏דרך OneCLI — ‏חובה, ה-probe בודק את מסלול ה-proxy האמיתי):
  ```bash
  cd packages/backend
  PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts
  ```
- ‏BE (‏בדיקת env-mode — **‏בלי** OneCLI, ‏עם מפתח ישיר):
  ```bash
  ELEVENLABS_API_KEY=<real-or-fake> GEMINI_API_KEY=<real-or-fake> PORT=4000 bun --watch src/server.ts
  ```
- ‏FE: `pnpm --filter @drive-coding/frontend dev` (‏port OS-assigned; proxy ל-BE 4000 default)
- ‏Tests: `pnpm --filter @drive-coding/core test` · `pnpm --filter @drive-coding/backend test`

### Browser
- ‏Chrome רגיל על `http://localhost:<vite-port>` (‏secure-context עובד ב-localhost)

### OneCLI agent
- ‏שם: `voice-acp` · ‏מזריק `xi-api-key` (elevenlabs) + `x-goog-api-key` (google) ‏דרך HTTPS_PROXY על fetch יוצא.

### Reading list
**‏must-read לפני**:
- `packages/backend/src/delivery/http-proxy.ts` §‏שורות 40-43 (`PROXY_HOSTS`), 119-124 (‏הזרקת auth)
- `packages/backend/src/delivery/proxy-auth.ts` ‏(‏כל הקובץ — 39 ‏שורות; ‏מקור-האמת להזרקה)
- `packages/frontend/src/lib/adapters/options.ts` ‏(‏תקדים adapter ל-fetch מ-BE)
- `packages/frontend/src/lib/components/ui/Select.svelte` §‏שורות 1-8 (`SelectOption.disabled`), 142-160 (‏רינדור disabled)

**‏reference**:
- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte` §‏שורות 33-37, 90-99 (‏בורר TTS)
- ‏i18n חי ב-**core**: `packages/core/src/i18n/keys.ts` (‏union) + `catalogs/he.ts` + `catalogs/en.ts` (‏**‏לא** ‏ב-frontend). ‏ראה Commit 2.
- `docs/conventions/parallel-safe-code.md` — ‏לפני נגיעה ב-i18n (‏additive בלבד)

## §1 — מטרה

‏כשמשתמש פותח את בורר ספק-ה-TTS בהגדרות, ‏ספק שאין לו מפתח-אימות תקף (‏חסר מפתח, ‏או מפתח שרוף/‏quota — ‏למשל `403 PERMISSION_DENIED`) ‏מופיע **‏מושבת (disabled)** ‏עם סיבה קצרה, ‏במקום להיראות זמין ואז להיכשל ב-runtime. ‏אם הספק שנבחר כרגע הפך ללא-זמין — ‏מוצגת הודעה והבחירה נופלת חזרה לספק הזמין. ‏הזמינות נקבעת ע"י **‏probe חינמי אמיתי** (‏`GET /v1/voices` ל-ElevenLabs, `GET /v1beta/models` ל-Google) ‏שעובר באותו מסלול-auth כמו קריאות ה-TTS — ‏כך שהוא מכבד גם env-keys ‏וגם הזרקת-OneCLI, ‏ותופס מפתח-שרוף שבדיקת-env בלבד הייתה מפספסת.

‏**‏ומעבר לתצוגה — ‏הזמינות חוסמת תעבורה**: ‏כל צרכני-הספק ב-FE (‏טעינת רשימת-קולות `loadVoices`, ‏והקראת ה-TTS עצמה ב-`Speaker`/`BubblePlayer`) ‏בודקים את ה-capability **‏לפני** ‏שהם פונים ל-upstream. ‏ספק לא-זמין → ‏**‏אפס בקשות** ‏אליו (‏אין retry-loop, ‏אין הקראה נכשלת). ‏זו המטרה: ‏להפסיק להטריד endpoint שאי-אפשר להשתמש בו.

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏probe זמינות + endpoint + disable בבורר | ✅ | ‏כאן (Commits 0-2) |
| ‏**‏capability-gate: ‏חסימת `loadVoices` ל-ElevenLabs לא-זמין** | ✅ | ‏**‏כאן (Commit 3)** |
| ‏**‏capability-gate: ‏חסימת TTS synthesize לספק לא-זמין** | ✅ | ‏**‏כאן (Commit 4)** |
| ‏**‏הקדמת `refresh()` ל-app-init (`+layout`)** — ‏race fix | ✅ | ‏**‏כאן (Commit 3)** |
| ‏ספירת קריאות/טוקנים/עלות | ❌ | ‏slice `tts-usage-metering` |
| ‏character_count/limit ‏מ-subscription (‏אפס-קרדיט → ‏יזין את ה-capability) | ❌ | ‏slice `tts-quota-subscription` (‏מזין את אותו gate) |
| ‏חסימת TTS על **‏אפס-קרדיט** (‏מפתח תקף, ‏quota מוצה) | ❌ | ‏slice `tts-quota-subscription` — ‏ה-probe (list-voices) ‏לא תופס קרדיט, ‏רק מפתח |
| ‏persistence של תוצאת probe לדיסק | ❌ | ‏cache in-memory בלבד |

## §3 — Architecture diagram

```
FE (settings)                         BE
─────────────                         ──
SettingsScreen.svelte                 http-tts-capabilities.ts   ← חדש (delivery)
  ttsProviderOptions (disabled?)  ┐     GET /api/tts/capabilities
  + הודעת "ספק לא זמין" + fallback │      └─ probeProvider(el) ─┐
        ▲                          │      └─ probeProvider(go) ─┤
        │ derived                  │                            ▼
capabilities.svelte.ts  ← חדש (VM) │        fetch(upstream + auth)  ──HTTPS_PROXY(OneCLI)──▶ upstream
   { elevenlabs:{available,reason},│                            │
     google:{available,reason} }   │        interpretProbeStatus(status) ← חדש (core, pure/TDD)
        ▲                          │          200→ok | 401→no-key | 403→forbidden | else→error
        │ fetch                    │
tts-capabilities.ts  ← חדש (adapter)
   GET /api/tts/capabilities
```

## §4 — Commits

### Commit 0 — core: interpretProbeStatus (approach: TDD)
**‏קובץ חדש**: `packages/core/src/tts/probe-status.ts`
**‏טסט חדש**: `packages/core/src/tts/probe-status.test.ts`
**‏API skeleton** (‏executor **‏לא** ‏משנה חתימה):
```ts
export type ProbeReason = "ok" | "no-key" | "forbidden" | "quota" | "error"
export type ProbeResult = { available: boolean; reason: ProbeReason }

/** Maps an upstream HTTP status (or null on network/timeout error) to availability. */
export function interpretProbeStatus(status: number | null): ProbeResult
```
**‏לוגיקה**: `200-299 → {true,"ok"}` · `401 → {false,"no-key"}` · `403 → {false,"forbidden"}` · `429 → {false,"quota"}` · `null → {false,"error"}` · ‏אחר (4xx/5xx) → `{false,"error"}`.
**‏Verification**: `pnpm --filter @drive-coding/core test probe-status`

### Commit 1 — BE: /api/tts/capabilities עם probe + cache (approach: manual)
**‏קובץ חדש**: `packages/backend/src/delivery/http-tts-capabilities.ts`
**‏קובץ משתנה**: `packages/backend/src/server.ts` — ‏import + `registerTtsCapabilitiesHttp(app)` ‏אחרי `registerHttpOptions(app)` (‏שורה ~99). **additive**.
**‏API skeleton**:
```ts
import type { Hono } from "hono"
export type ProviderCapabilities = Record<"elevenlabs" | "google", ProbeResult>

// probes upstream via SAME auth path as the proxy: resolveProviderAuth + placeholder fallback,
// fetch out (OneCLI's HTTPS_PROXY injects when no env key). 5s timeout.
export function registerTtsCapabilitiesHttp(app: Hono): void
// GET /api/tts/capabilities → 200 { elevenlabs: ProbeResult, google: ProbeResult }
```
**‏פרטי probe** (‏חובה — ‏עקביות עם ה-proxy):
- ‏`PROXY_HOSTS` ‏הוא `const` **‏פרטי** ‏ב-`http-proxy.ts:40` (‏לא exported). ‏**‏הוסף `export`** ‏ל-`PROXY_HOSTS` ‏שם, ‏ו-import אותו כאן (‏עדיף על הכפלה). ‏paths: `elevenlabs → /v1/voices`, `google → /v1beta/models`.
- ‏`const auth = resolveProviderAuth(provider, process.env)` → ‏אם non-null: `headers.set(auth.name, auth.value)`. ‏אם null: ‏set placeholder (`xi-api-key`/`x-goog-api-key` = `"probe"`) ‏כדי ש-OneCLI יוכל להחליף.
- ‏`fetch(url, { headers, signal: AbortSignal.timeout(5000) })` → `interpretProbeStatus(res.status)`; ‏על throw/timeout → `interpretProbeStatus(null)`.
- ‏**‏cache in-memory**: ‏Map עם TTL (‏למשל 60s) — ‏probe יקר (‏קריאת-רשת), ‏אל תריץ בכל בקשה. ‏מבנה: `{ result, ts }` per-provider.
- ‏**‏לעולם לא ללוגג את ערך ה-auth** (‏סוד).
**‏Verification**:
```bash
# env-mode: מפתח מזויף → 401 → no-key
ELEVENLABS_API_KEY=fake GEMINI_API_KEY=fake PORT=4000 bun src/server.ts &
curl -s localhost:4000/api/tts/capabilities   # elevenlabs/google: available:false
# OneCLI-mode: מפתחות תקפים → available:true
```

### Commit 2 — FE: adapter + VM + disable בבורר (approach: manual)
**‏קבצים חדשים**:
- `packages/frontend/src/lib/adapters/tts-capabilities.ts` — ‏`fetchTtsCapabilities(): Promise<ProviderCapabilities>` (‏דפוס מ-`options.ts`).
- `packages/frontend/src/lib/view-models/capabilities.svelte.ts` — ‏VM עם `$state` ‏שמחזיק `ProviderCapabilities | undefined`, ‏מתודה `refresh()`.
**‏קבצים משתנים**:
- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte`:
  - ‏`ttsProviderOptions` (‏שורה 34) → ‏מוסיף `disabled` **‏per-provider** ‏(‏אביגיל finding #2 — ‏🔴 ‏קריטי, ‏אל תקבע elevenlabs לכולם): `disabled: caps?.[opt.value as "elevenlabs"|"google"]?.available === false`. ‏כל אופציה נחסמת לפי הזמינות **‏שלה**.
  - ‏אם `settings.ttsProvider` ‏הנוכחי הפך ל-`available===false` → ‏הצג הודעת-`t(...)` + ‏קרא `settings.setTtsProvider(<הספק הזמין>)` (‏fallback). ‏אם **‏שני** ‏הספקים לא-זמינים → ‏הצג אזהרה, ‏אל תבצע fallback.
  - ‏קרא `capabilities.refresh()` ב-`onMount`/`$effect` ‏(‏non-blocking).
- ‏i18n keys — **‏עריכת 3 קבצים ב-`packages/core/src/i18n/`** (‏אביגיל finding #1+#3 — ‏ה-dir **‏לא** ‏ב-frontend; ‏ה-i18n חי ב-core). ‏`Catalog = Record<MessageKey,string>` → ‏מפתח-union בלי entry בשני הקטלוגים **‏שובר typecheck**. ‏שלוש נקודות-עריכה **‏חובה**, **‏additive בלבד** (‏parallel-safe-code):
  1. ‏`packages/core/src/i18n/keys.ts` — ‏הוסף ל-union `MessageKey` (‏ליד `settings.ttsProvider.elevenlabs` ‏הקיים, ‏שורה ~214).
  2. ‏`packages/core/src/i18n/catalogs/he.ts` — `settings.ttsProvider.unavailable` = "ספק זה אינו זמין (חסר מפתח או מפתח לא תקף)" · `settings.ttsProvider.fallbackNotice` = "עברנו לספק הזמין" · `settings.ttsProvider.allUnavailable` = "אין ספק TTS זמין — בדוק מפתחות"
  3. ‏`packages/core/src/i18n/catalogs/en.ts` — ‏אותם מפתחות, ‏ערכי אנגלית.
**‏Verification**: `pnpm --filter @drive-coding/frontend typecheck` · ‏בדיקה בדפדפן (‏DoD §5).

> **‏Commits 0-2 בוצעו ואומתו** (‏אליעזר @ `9543078`; ‏calev: ‏disable-per-provider אומת חי ב-preview). ‏Commits 3-4 הם ההרחבה אחרי preview.

### Commit 3 — FE: capability-gate על loadVoices + race-fix (approach: manual)
**‏רציונל**: ‏preview חשף retry-loop של `loadVoices` (‏14 ‏בקשות/‏7×401) ‏כשה-ElevenLabs לא-זמין. ‏ה-slice מסמן disabled אבל לא חוסם את הקריאה.
**‏גישה** (‏אביגיל r3 — ‏הגישה של `await ensureLoaded()` ‏ב-loadVoices נדחתה: ‏ה-`await` ‏לפני ה-loading-guard **‏שובר reentrancy** [‏🔴 finding #1, ‏test-7] ‏ו-`refresh()` early-returns [‏finding #2]): ‏**‏ה-gate הוא reactive ב-`$effect` של VoicePicker** — ‏loadVoices **‏לא נקרא בכלל** ‏עד ש-caps מוגדר ו-available. ‏**‏אפס async ב-loadVoices** → ‏ה-reentrancy guard הסינכרוני נשאר שלם.
**‏קבצים משתנים**:
- `packages/frontend/src/lib/view-models/capabilities.svelte.ts`:
  ```ts
  isAvailable(provider: "elevenlabs" | "google"): boolean {
    return this.caps?.[provider]?.available !== false   // undefined→optimistic
  }
  ```
  ‏**‏+ ‏תיקון `refresh()` catch**: ‏על כשל-endpoint → ‏קבע `caps` ל-**‏optimistic-מוגדר** (`{elevenlabs:{available:true,reason:"ok"}, google:{...}}`) ‏במקום להשאיר `undefined`. ‏סיבה: ‏ה-$effect ה-reactive (‏למטה) ‏זקוק ל-caps **‏מוגדר** ‏כדי לקרוא loadVoices; ‏`undefined`-לנצח = ‏over-gating (‏VoicePicker ריק אם ה-capabilities-endpoint נכשל). ‏ה-endpoint הוא local-BE → ‏כמעט תמיד עובד; ‏optimistic-on-error סביר.
- `packages/frontend/src/lib/components/chat/VoicePicker.svelte` — ‏ה-`$effect` (‏~22): ‏**‏reactive ל-caps, ‏gate כאן**:
  ```ts
  $effect(() => {
    const caps = ttsCapabilities.caps            // tracked → re-run כשמתעדכן
    if (caps === undefined) return               // עוד loading → אל תקרא (המתן)
    if (caps.elevenlabs.available === false) return  // לא-זמין → 0 בקשות
    untrack(() => void settings.loadVoices())     // זמין → טען (idempotent)
  })
  ```
  ‏זה סוגר את ה-race **‏בלי await**: ‏loadVoices לא נקרא עד ש-caps ידוע. ‏caps=undefined→המתן; ‏false→0 בקשות; ‏true→טען.
- `packages/frontend/src/lib/view-models/settings.svelte.ts` — `loadVoices` (‏~252): ‏gate **‏סינכרוני** ‏כהגנה-שנייה (‏לקוראים אחרים, ‏אם יש): ‏`if (!ttsCapabilities.isAvailable("elevenlabs")) { this.#clearVoicesRetry(); return }` ‏— ‏בתחילת הפונקציה, ‏**‏בלי await** (‏לא שובר את ה-loading-guard). ‏וב-`#scheduleVoicesRetry` — ‏אל תתזמן retry אם `!isAvailable`. **‏תלות**: ‏import ‏ישיר של `ttsCapabilities` (‏אביגיל אישרה: ‏אין תלות מעגלית).
  - ‏**‏test-isolation (‏אביגיל r4 finding #2)**: ‏ה-gate קורא את ה-singleton הגלובלי `ttsCapabilities`. ‏ב-unit-tests הקיימים `caps===undefined` → ‏optimistic → ‏ה-gate לא חוסם (‏test-7 ‏ירוק). ‏**‏אם תוסיף/‏תיגע בטסט שקובע `ttsCapabilities.caps`** — ‏אפס אותו ב-`afterEach` (`ttsCapabilities.caps = undefined`) ‏למניעת דליפת-state בין קבצים ב-vitest. (‏DI מלא של ה-capability = ‏future; ‏לא לגל זה.)
- `packages/frontend/src/routes/+layout.svelte` — ‏**‏אביגיל r4 finding #3**: ‏הקובץ **‏לא מכיל היום שום** ‏הפניה ל-`ttsCapabilities` (grep=0). ‏הוסף **‏שניהם**: ‏(‏א) `import { ttsCapabilities } from "$lib/view-models/capabilities.svelte"` ‏למעלה; ‏(‏ב) ‏קריאה `void ttsCapabilities.refresh()` ‏ב-composition-root (‏~58-116, ‏ליד `new <VM>()`). ‏זה מקדים את ה-caps → ‏ה-$effect ה-reactive מתעורר מהר. ‏(‏`refresh()` ‏ישיר, ‏לא `ensureLoaded` — ‏ה-$effect reactive מטפל בסדר.)
**‏Verification**: `pnpm --filter @drive-coding/frontend typecheck` · ‏`pnpm --filter @drive-coding/frontend test` (‏**‏test-7 concurrent חייב להישאר ירוק** — ‏אין async חדש ב-loadVoices) · ‏preview: ‏מפתח מזויף → ‏**‏0 בקשות** ל-`/v1/voices` (‏כולל mount קר; ‏ה-$effect לא קורא עד caps ידוע).

### Commit 4 — FE: capability-gate על TTS synthesize (approach: manual)
**‏רציונל**: ‏ספק לא-זמין → ‏אל תנסה הקראה (‏שתיכשל).
**‏קבצים משתנים**:
- `packages/frontend/src/lib/view-models/speaker.svelte.ts` (‏~399-413): ‏אחרי `resolveTts()`, ‏לפני `provider.synthesize()` — ‏gate: ‏אם `!ttsCapabilities.isAvailable(this.#settings.ttsProvider)` → ‏דלג על ה-job (‏אל תקרא synthesize; ‏סמן/‏לוג במקום להיכשל).
- `packages/frontend/src/lib/view-models/bubble-player.svelte.ts` (‏~97-105): ‏אותו gate לפני `provider.synthesize()`.
**‏הערה**: ‏ה-gate מבוסס `provider` (`"elevenlabs"|"google"`), ‏לא `voiceId`. ‏Gemini קולות סטטיים (‏אין loadVoices) → ‏ה-gate על synthesize מספיק לצד Gemini.
**‏Verification**: ‏typecheck · ‏preview: ‏בחר ספק לא-זמין → ‏אין בקשת `/proxy/.../stream`.

## §5 — DoD

| ‏בדיקה | ‏איך |
|---|---|
| ‏core test ירוק | `pnpm --filter @drive-coding/core test probe-status` |
| ‏typecheck ‏נקי (‏BE+FE) | `pnpm typecheck` |
| ‏lint ‏נקי | `pnpm lint && pnpm lint:i18n` |
| ‏env-mode: ‏מפתח מזויף → ‏אופציה מושבתת | ‏הפעל BE עם `ELEVENLABS_API_KEY=fake`; ‏בבורר ElevenLabs מופיע disabled |
| ‏OneCLI-mode: ‏מפתחות תקפים → ‏שתי אופציות זמינות | ‏הפעל דרך `onecli run --agent voice-acp`; ‏שני הספקים בחירים |
| ‏fallback: ‏ספק-נבחר לא-זמין → ‏מעבר אוטומטי + ‏הודעה | ‏בחר Google, ‏הפעל בלי מפתח Google עם ElevenLabs תקף → ‏עובר ל-ElevenLabs |
| ‏endpoint ‏מחזיר JSON תקין | `curl localhost:4000/api/tts/capabilities` |
| ‏אין דליפת-סוד בלוג | ‏grep ‏בלוג — ‏אין ערך-מפתח |
| ‏**‏gate: ‏0 בקשות `/v1/voices` ‏לספק לא-זמין** (Commit 3) | ‏preview מפתח-מזויף → ‏`grep -c 'v1/voices' be.log` = **‏0** (‏מול 14 קודם) |
| ‏**‏gate: ‏אין TTS synthesize לספק לא-זמין** (Commit 4) | ‏preview: ‏ttsProvider לא-זמין → ‏הקראה → ‏אין `/proxy/.../stream` בלוג |
| ‏**‏race סגור: ‏0 בקשות גם ב-mount קר** (Commit 3, ‏reactive `$effect`) | ‏preview: ‏רענון-קשיח (`Ctrl+Shift+R`) ‏עם מפתח-מזויף → ‏`grep -c v1/voices be.log` = **‏0** (‏לא 1) |
| ‏**‏test-7 concurrent נשאר ירוק** (‏אין async ב-loadVoices) | `pnpm --filter @drive-coding/frontend-v2 test settings` — ‏test-7 (`concurrent: 2 unawaited → invoked once`) ‏ירוק |
| ‏regression: ‏ספק זמין עדיין טוען voices+TTS | ‏preview מפתח-תקף → ‏VoicePicker נטען, ‏הקראה עובדת (‏אין over-gating) |

## §6 — Risks

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏probe עוקף OneCLI ‏(‏fetch ‏ישיר בלי HTTPS_PROXY) | ‏ניתוח מרדכי 2026-07-02 | ‏ה-probe רץ **‏בתוך תהליך ה-BE** ‏שרץ תחת `onecli run` → ‏ה-HTTPS_PROXY תופס כל fetch יוצא. ‏אותו מסלול כמו ה-proxy handler. ‏חובה לבדוק ב-DoD את שני המצבים. |
| ‏Hardcoded Hebrew | ‏learnings (‏pre-commit hook) | ‏כל מחרוזת חדשה → `t(key)`; ‏הרץ `pnpm lint:i18n` |
| ‏probe יקר בכל בקשה | ‏— | ‏cache in-memory עם TTL (Commit 1) |
| ‏OneCLI placeholder pattern | ‏`proxy-auth.ts:6-9` + ‏AGENTS.md | ‏שלח placeholder header כשאין env → ‏OneCLI מחליף |
| ‏קונפליקט additive ב-`i18n/keys.ts` ‏מול slices מקבילים | ‏parallel-safe-code | ‏הוספה בלבד, ‏אל תיגע במפתחות קיימים |

## §7 — Escalation triggers
- ‏אם ה-probe מחזיר סטטוס לא-צפוי גם ב-OneCLI-mode ‏עם מפתחות שנבדקו תקפים → ‏עצור, ‏שאל את מרדכי (‏ייתכן שנתיב ה-probe שגוי).
- ‏אם `PROXY_HOSTS` ‏לא ניתן ל-import נקי מ-`http-proxy.ts` ‏בלי מעגליות → ‏שאל לפני הכפלה.
- ‏אם ה-FE bootstrap ‏לא חושף מקום טבעי ל-`refresh()` ‏non-blocking → ‏שאל.

## §8 — Complexity score
- ‏commits: 5 (‏0-2 ‏בוצעו + ‏3-4 ‏חדשים) · ‏שכבות: core pure + BE endpoint + FE VM/‏VM-gate · ‏external APIs: 2 probe (+2) · ‏streaming: ‏אין · ‏protocol: ‏endpoint חדש (+1) · ‏gate על 3 ‏צרכנים (loadVoices/Speaker/BubblePlayer) + ‏race-fix ב-layout (+1)
- ‏**‏Score: 7/10 → verifier: light (`calev`)** — ‏עדיין glue-code (‏VM-gating, ‏אין state-refactor); ‏אבל האימות דורש preview חי (‏ספירת בקשות voices מזויף מול תקף).

## §9 — שאלות פתוחות
| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏TTL ‏ל-cache ה-probe | 60s | ❌ |
| 2 | ‏האם לחשוף `reason` ב-UI ‏(‏"מפתח שרוף" מול "חסר מפתח") ‏או רק disabled? | ‏disabled + ‏tooltip גנרי אחד (`unavailable`) | ❌ |
| 3 | ‏probe רק כשיש env-key, ‏או תמיד (‏גם placeholder ל-OneCLI)? | ‏**‏תמיד** (‏אחרת OneCLI-mode ‏תמיד יסומן לא-זמין) | ❌ |
