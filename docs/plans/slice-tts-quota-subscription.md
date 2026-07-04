# Slice — tts-quota-subscription — תוכנית

> **תאריך**: 2026-07-03
> **סטטוס**: ‏הושלם + ‏runtime-GO — ‏Commits `7218a48`+`7175616`; ‏אביגיל READY r1, ‏calev GO 7/7 (‏**‏creator-מוצה → quota → disabled אומת חי**). ‏ממתין reconcile+merge.
> **Complexity**: 6/10 (verifier: light)
> **תלות**: ‏`tts-provider-availability` (‏מרחיב את `http-tts-capabilities.ts` + ‏מזין את אותו `caps`). ‏**‏depends_on: [tts-provider-availability]** · ‏base = `slice/tts-provider-availability`

## §0 — Pre-flight

### Worktree
```bash
# base = branch של slice 1 (שרשור — מרחיב את http-tts-capabilities + caps)
git worktree add .worktrees/tts-quota-subscription -b slice/tts-quota-subscription slice/tts-provider-availability
cd .worktrees/tts-quota-subscription
pnpm install && pnpm hooks:install
```

### Run
- ‏BE (‏env ישיר — ‏ה-gateway מת): `set -a; . D:/UserProjects/AI/drive-coding/.tmp/.env; set +a; PORT=4000 bun src/server.ts` (‏יש `ELEVENLABS_API_KEY` ‏ב-`.tmp/.env`).
- ‏Tests: `pnpm --filter @drive-coding/core test`
- ‏**‏אימות חי**: ‏`curl localhost:4000/api/tts/capabilities` — ‏ElevenLabs (‏מפתח-תקף-אבל-אפס-קרדיט) ‏אמור להחזיר `available:false, reason:"quota"`.

### Browser
- ‏Chrome/localhost — ‏אין UI חדש; ‏האימות דרך curl + ‏הבורר (‏ElevenLabs disabled).

### Reading list
**‏must-read לפני**:
- `packages/backend/src/delivery/http-tts-capabilities.ts` ‏(‏כל הקובץ, 115 ‏שורות — ‏הקובץ שמרחיבים; ‏`probeProvider` ‏שורות 57-100, `PROBE_PATHS` ‏23-26, cache 34-53)
- `packages/core/src/tts/probe-status.ts` ‏(`ProbeResult`/`ProbeReason` — **‏`"quota"` ‏כבר קיים**; ‏`interpretProbeStatus`)
- `packages/backend/src/delivery/proxy-auth.ts` ‏(`resolveProviderAuth` — ‏אותו auth ל-subscription)

**‏reference**:
- ‏מבנה `/v1/user/subscription`: `character_count`, `character_limit`, `tier`, `status` (`active`/`trialing`/`free`/`free_disabled`/`past_due`). ‏מקור: ‏תיעוד ElevenLabs (‏אומת 2026-07-03).

## §1 — מטרה

‏ה-probe הקיים (`GET /v1/voices`) ‏מאמת **‏מפתח**, ‏לא **‏מכסה** — ‏אז ElevenLabs עם מפתח-תקף-אבל-מכסה-מוצה מופיע `available:true` ‏(‏ה-preview חשף זאת). ‏ה-slice הזה מוסיף בדיקת-**‏מכסה** ‏מ-`GET /v1/user/subscription` ‏שמזינה את אותו `caps.elevenlabs`: ‏אם `character_count >= character_limit` ‏או `status=free_disabled` → `available:false, reason:"quota"`. ‏ה-**‏capability-gate** ‏של slice 1 (‏loadVoices + ‏synthesize + ‏disabled-בבורר) ‏חוסם אז אוטומטית. ‏**‏אין UI חדש** — ‏רק ה-BE מזין את התשתית הקיימת. ‏Gemini: ‏אין endpoint-מכסה (‏probe-only נשאר).

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏quota-check ElevenLabs → ‏מזין `caps.elevenlabs.available` | ✅ | ‏כאן |
| ‏Gemini quota | ❌ | ‏אין endpoint API-key (‏GCP-only). ‏Gemini נשאר probe-only |
| ‏הצגת "234K/500K" ‏ב-FE (settings) | ❌ | ‏future — ‏"‏לא נממש בפרונט" (‏החלטת-משתמשת) |
| ‏Gemini-429 (‏מכסה-מדולדלת runtime) | ❌ | ‏future — ‏runtime-429-detection נפרד |
| ‏ריכוז קוד per-provider (`PROVIDER_REGISTRY`) | ❌ | ‏slice-refactor נפרד **‏אחרי** ‏merge של 1+2+3 (‏החלטת-משתמשת) |
| ‏endpoint נפרד `/api/tts/quota` | ❌ | ‏משולב ב-`/api/tts/capabilities` הקיים (‏אותו cache) |

## §3 — Architecture diagram

```
core (pure / TDD)                    backend (מרחיב http-tts-capabilities.ts)
─────────────────                    ─────────────────────────────────────────
tts/subscription.ts  ← חדש           probeProvider("elevenlabs"):
  interpretSubscription(               1. list-voices probe → ProbeResult (קיים)
    charCount, charLimit, status)      2. אם available → probeElevenLabsQuota() ← חדש
    → { exhausted, reason }               fetch /v1/user/subscription (אותו auth+cache)
                                          → interpretSubscription
                                       3. אם exhausted → override {available:false, reason:"quota"}
                                              │
                                       GET /api/tts/capabilities (ללא שינוי חוזה —
                                         elevenlabs.available עכשיו מתחשב גם במכסה)
                                              │
                                       ה-caps מוזרם ל-FE → gate של slice 1 חוסם
```

## §4 — Commits

### Commit 0 — core: interpretSubscription (approach: TDD)
**‏קובץ חדש**: `packages/core/src/tts/subscription.ts` + ‏`subscription.test.ts`
**‏API skeleton** (‏executor **‏לא** ‏משנה חתימה):
```ts
import type { ProbeReason } from "./probe-status.js"

export type SubscriptionStatus =
  | "active" | "trialing" | "free" | "free_disabled" | "past_due" | (string & {})
export type SubscriptionInfo = {
  characterCount: number
  characterLimit: number
  status: SubscriptionStatus
}
export type QuotaVerdict = { exhausted: boolean; reason: ProbeReason }

/** Pure: maps subscription info to whether the provider is quota-exhausted. */
export function interpretSubscription(sub: SubscriptionInfo): QuotaVerdict
```
**‏לוגיקה**:
- `status === "free_disabled"` → `{ exhausted: true, reason: "quota" }`
- `characterLimit > 0 && characterCount >= characterLimit` → `{ exhausted: true, reason: "quota" }`
- ‏אחרת → `{ exhausted: false, reason: "ok" }`
- ‏קלטים חסרים/‏שליליים → ‏defensive: ‏לא-exhausted (‏optimistic — ‏אל תחסום על נתון-פגום).
**‏Verification**: `pnpm --filter @drive-coding/core test subscription`

### Commit 1 — BE: probeElevenLabsQuota + שילוב ב-probeProvider (approach: manual)
**‏קובץ משתנה**: `packages/backend/src/delivery/http-tts-capabilities.ts`
- ‏הוסף `SUBSCRIPTION_PATHS: Record<string, string> = { elevenlabs: "/v1/user/subscription" }` (‏Gemini: ‏לא במפה).
- ‏פונקציה חדשה:
  ```ts
  // fetch /v1/user/subscription (same auth path as probe), parse via ArkType, interpret.
  // Returns null when unsupported (google) / fetch-fail / parse-fail → caller keeps probe result.
  async function probeElevenLabsQuota(): Promise<QuotaVerdict | null>
  ```
  - ‏**‏בניית ה-URL** (‏אביגיל 🟢 #2+#3): ‏`const url = PROXY_HOSTS.elevenlabs + SUBSCRIPTION_PATHS.elevenlabs` — ‏ה-host נגזר מ-`PROXY_HOSTS` (‏אותו map של ה-probe), ‏וה-path מ-`SUBSCRIPTION_PATHS`. ‏(‏הפונקציה קשיחה-ל-elevenlabs — ‏זה תקין; ‏ה-map קיים לעקביות-סגנון עם `PROBE_PATHS` ‏ולהרחבה עתידית, ‏גם אם היום יש בו ערך יחיד.)
  - ‏auth: ‏`resolveProviderAuth("elevenlabs", process.env)` + ‏placeholder fallback (‏זהה ל-probe).
  - ‏**‏ArkType schema** ל-response (‏no-any): `{ character_count: "number", character_limit: "number", status: "string" }` (‏שדות עודפים מותרים). ‏parse-fail → `null`.
  - ‏timeout 5s (`AbortSignal.timeout`). ‏לעולם לא ללוגג auth.value.
- ‏**‏שילוב ב-`probeProvider`** (‏שורות 57-100), ‏סדרתי (‏חוסך קריאה כשמפתח פגום):
  ```ts
  const result = interpretProbeStatus(status)
  // NEW: quota gate — רק ל-elevenlabs, רק אם המפתח תקף (result.available)
  if (provider === "elevenlabs" && result.available) {
    const quota = await probeElevenLabsQuota()
    if (quota?.exhausted) {
      const gated = { available: false, reason: quota.reason }
      setCached(provider, gated); return gated
    }
  }
  setCached(provider, result); return result
  ```
**‏Verification**:
```bash
pnpm typecheck && pnpm --filter @drive-coding/core test subscription
# חי (מפתח אפס-קרדיט ב-.tmp/.env):
curl -s localhost:4000/api/tts/capabilities | jq   # elevenlabs: available:false, reason:"quota"
```

## §5 — DoD

| ‏בדיקה | ‏איך |
|---|---|
| ‏core test ‏ירוק | `pnpm --filter @drive-coding/core test subscription` (‏free_disabled / ‏exhausted / ‏ok / ‏פגום) |
| ‏typecheck ‏נקי | `pnpm typecheck` |
| ‏lint:i18n ‏נקי | `bash scripts/lint-no-hebrew-in-code.sh` |
| ‏**‏quota חי: ‏מפתח-אפס-קרדיט → ‏quota** | ‏מפתח-תקף-מוצה → `curl .../capabilities` → `elevenlabs:{available:false,reason:"quota"}` |
| ‏מפתח-תקף-**‏עם**-קרדיט → ‏available | ‏(‏אם יהיה מפתח עם יתרה) → `available:true, reason:"ok"` |
| ‏מפתח פגום → ‏עדיין `no-key` (‏לא quota) | ‏ה-quota-check **‏לא** ‏רץ כשמפתח פגום (‏סדרתי) → `reason:"no-key"` |
| ‏Gemini ‏לא-מושפע | `google` ‏ב-caps ‏ללא שינוי (‏אין SUBSCRIPTION_PATHS) |
| ‏**‏אינטגרציה עם slice 1**: ‏quota→disabled | ‏ElevenLabs quota → ‏הבורר מסמן disabled (‏ה-gate של slice 1) |
| ‏parse-fail ‏לא שובר | ‏subscription מחזיר JSON לא-צפוי → `probeElevenLabsQuota` = null → ‏probe result נשמר (‏available) |
| ‏אין דליפת-סוד | ‏grep ‏בלוג — ‏אין auth.value |

## §6 — Risks

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏מבנה subscription משתנה | ‏integration חיצוני | ‏ArkType parse → `null` על אי-התאמה → ‏probe result נשמר (‏לא חוסם). ‏DoD בודק parse-fail. |
| ‏quota-check עולה קריאה בכל probe | ‏— | ‏סדרתי (‏רק אם available) + ‏cache 60s הקיים (‏משולב ב-probeProvider). |
| ‏`character_limit=0` ‏(‏חלוקה/‏השוואה) | ‏— | ‏guard `characterLimit > 0` ‏ב-interpretSubscription. |
| ‏Hardcoded Hebrew | ‏hook | ‏אין מחרוזות-UI חדשות (‏BE-only); ‏reason codes אנגלית. |
| ‏שינוי חוזה `/api/tts/capabilities` ‏שובר FE | ‏— | ‏**‏החוזה זהה** (`ProviderCapabilities`); ‏רק ה-`reason` ‏יכול להיות `"quota"` (‏כבר בטיפוס `ProbeReason`). ‏FE ה-gate כבר מטפל ב-`available:false` ‏לכל reason. |
| ‏OneCLI/‏env auth | ‏— | ‏אותו `resolveProviderAuth` ‏כמו ה-probe; ‏עובד env-mode ו-OneCLI. |

## §7 — Escalation triggers
- ‏אם `/v1/user/subscription` ‏מחזיר מבנה שונה מהותית מ-`{character_count, character_limit, status}` → ‏עצור, ‏הצג את ה-JSON, ‏שאל את מרדכי.
- ‏אם ל-ElevenLabs יש tier שבו `character_limit` ‏לא מוגדר (‏unlimited/‏enterprise) → ‏שאל על ההתנהגות הרצויה.
- ‏אם ה-quota-check מוסיף latency מורגש ל-`/api/tts/capabilities` (‏גם עם cache) → ‏שאל.

## §8 — Complexity score
- ‏commits: 2 · ‏שכבות: core pure (interpretSubscription) + ‏BE (‏הרחבת endpoint קיים) · ‏external API: 1 (subscription) (+1) · ‏streaming: ‏אין · ‏protocol: ‏אין שינוי-חוזה (‏reason כבר בטיפוס) · ‏שרשור על slice 1
- ‏**‏Score: 6/10 → verifier: light (`calev`)** — ‏glue + ‏core-pure; ‏אימות מרכזי = ‏curl חי (‏quota→disabled).

## §9 — שאלות פתוחות
| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏reason ל-quota-exhausted — ‏`"quota"` ‏(‏כמו 429) ‏או חדש `"quota-exhausted"`? | ‏`"quota"` (‏קיים; ‏פשוט; ‏UI מציג tooltip גנרי ממילא) | ❌ |
| 2 | ‏מכסה קרובה-למיצוי (‏95%) → ‏אזהרה? | ‏לא לגל זה — ‏רק מיצוי-מלא חוסם. ‏אזהרה = ‏future (‏עם ה-FE display) | ❌ |
| 3 | ‏`status` ‏אחרים (`past_due`) → ‏חוסם? | ‏רק `free_disabled` + ‏`count>=limit` ‏חוסמים. ‏`past_due` ‏עדיין עשוי לעבוד → ‏לא חוסם | ❌ |
| 4 | ‏Gemini quota בעתיד | ‏GCP Service Usage API (‏service-account) — ‏gated, ‏future | ❌ |
