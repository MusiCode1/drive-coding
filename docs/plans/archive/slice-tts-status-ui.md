# Slice — tts-status-ui — תוכנית

> **תאריך**: 2026-07-03
> **סטטוס**: ‏הושלם + ‏מוזג ל-dev (‏אביגיל READY r2, ‏calev GO 9/9 — 2026-07-03)
> **Complexity**: 5/10 (verifier: light)
> **תלות**: ‏`tts-provider-availability` (caps.reason) · `tts-usage-metering` (/api/usage/summary) · `tts-quota-subscription` (reason:"quota"). **‏depends_on: [tts-provider-availability, tts-usage-metering, tts-quota-subscription]** · ‏base = `slice/tts-quota-subscription` (‏סוף השרשרת)

## §0 — Pre-flight

### Worktree
```bash
# base = slice 3 (שרשרת 1→3), + merge slice 2 (metering — branch נפרד) כדי להביא /api/usage/summary
git worktree add .worktrees/tts-status-ui -b slice/tts-status-ui slice/tts-quota-subscription
cd .worktrees/tts-status-ui
git merge --no-ff slice/tts-usage-metering -m "integration: usage endpoint for status-ui"
# ^ אביגיל finding #2: הצפה 3 CONFLICTS טריוויאליים-additive (לא merge אוטומטי). פתור "keep-both":
#   • packages/backend/src/server.ts — שני import+register (proxy-usage + tts-capabilities). שמור את שניהם.
#   • packages/core/package.json — export-map (usage + tts). שמור את שני ה-exports.
#   • docs/walkthrough.md — שמור את שני הסיכומים (או את של slice 3).
# אחרי resolve: git add . && git commit. (http-proxy.ts דווקא auto-merge נקי.)
pnpm install && pnpm hooks:install
```
> **‏למה merge כאן**: ‏slice 4 צורך שלושה endpoints — ‏caps+quota (‏slice 1+3, ‏בשרשרת ה-base) ‏ו-usage (‏slice 2, ‏branch נפרד). ‏זהו integration של branches **‏לא** ‏merge ל-dev (‏"‏בלי merge" ‏של המשתמשת = ‏dev). ‏ה-merge הסופי ל-dev (‏כל השרשרת+‏metering) ‏נשאר בסוף, ‏בכפוף לאישור.

### Run
- ‏BE (‏env ישיר, ‏port פנוי — **‏יש היום זומבים על 4000/4006/4010/4011, ‏בחר גבוה+‏ודא netstat**): `set -a; . D:/UserProjects/AI/drive-coding/.tmp/.env; set +a; PORT=4080 bun packages/backend/src/server.ts`
- ‏FE: `pnpm --filter @drive-coding/frontend-v2 dev` (‏שם החבילה: `@drive-coding/frontend-v2`)
- ‏preview מלא: ‏build FE + `FE_STATIC_DIR=<build> PORT=4080 bun ...` — ‏המפתח ב-`.tmp/.env` ‏מוצה (‏creator, count 200K ≥ limit 100K) → ‏מדגים quota+display.

### Browser
- ‏Chrome/localhost — ‏הגדרות → ‏כרטיס "‏מצב TTS".

### Reading list
**‏must-read לפני**:
- `packages/frontend/src/lib/adapters/voice/voices.ts` ‏(‏תקדים: ‏`listVoices` ‏קורא `/proxy/elevenlabs/v1/voices` ‏עם placeholder — **‏אותו דפוס** ‏ל-subscription)
- `packages/frontend/src/lib/view-models/capabilities.svelte.ts` (`ttsCapabilities.caps` — ‏מקור ה-reason; ‏singleton)
- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte` (‏מבנה כרטיסים — ‏מוסיפים כרטיס)
- `packages/frontend/src/lib/adapters/tts-capabilities.ts` (‏תקדים adapter ל-`/api/...`)

**‏reference**:
- ‏מבנה subscription: `{character_count, character_limit, tier, status}` (‏אומת חי — ‏creator: `count:200000, limit:100000`)
- ‏מבנה usage summary (`/api/usage/summary`, slice 2): `Record<"elevenlabs"|"google", {requests, cacheHits, chars, inputTokens, audioTokens, costUsd}>`
- ‏`docs/conventions/parallel-safe-code.md` — ‏לפני i18n

## §1 — מטרה

‏משתמש פותח הגדרות ורואה **‏כרטיס "‏מצב TTS"** ‏שמסביר בדיוק מה קורה עם ספקי-הקול: ‏(‏א) ‏**‏למה** ‏ספק חסום (‏"‏המכסה מוצתה" / ‏"‏חסר מפתח" / ‏"‏מפתח לא תקף") — ‏במקום disabled-שקט; ‏(‏ב) ‏**‏מכסת ElevenLabs** ‏("‏200K / ‏100K ‏תווים"); ‏(‏ג) ‏**‏סיכום-שימוש ועלות** ‏("‏ElevenLabs: X ‏תווים ~$Y · Gemini: Z tokens ~$W"). ‏כל המידע **‏כבר קיים ב-BE** (‏caps + ‏proxy-subscription + ‏usage) — ‏זה slice **‏FE-only** ‏שחושף אותו. ‏**‏אפס קוד-BE חדש.**

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏reason display (‏למה חסום) | ✅ | ‏כאן |
| ‏quota display (‏character_count/limit) | ✅ | ‏כאן (‏FE קורא proxy) |
| ‏usage+עלות display | ✅ | ‏כאן (‏FE קורא `/api/usage/summary`) |
| ‏**‏קוד-BE חדש** | ❌ | ‏אין — ‏כל ה-endpoints קיימים |
| ‏Gemini quota | ❌ | ‏אין endpoint (‏מוצג "‏—" / ‏לא-זמין) |
| ‏"‏שימוש החודש" (‏פילוח-זמן) | ❌ | ‏usage הוא **‏מצטבר** (totals); ‏פילוח-חודשי = ‏future (events.jsonl) |
| ‏reset של מונה-usage | ❌ | ‏future |
| ‏progress-bar גרפי | 🟡 | ‏אופציונלי — ‏טקסט מספיק; ‏bar אם קל |

## §3 — Architecture diagram

```
FE (5-layer)
──────────────────────────────────────────
adapters/                         view-models/
  voice/subscription.ts ← חדש       tts-status.svelte.ts ← חדש (VM)
    fetchElevenLabsSubscription()     מאגד: caps(reason) + subscription + usage
    → /proxy/elevenlabs/v1/user/...   refresh() · $state
  usage.ts ← חדש                          ▲
    fetchUsageSummary()                   │ derived
    → /api/usage/summary                  │
       (ArkType parse)             components/settings/
                                     TtsStatusCard.svelte ← חדש
                                       reason (מ-ttsCapabilities.caps)
                                       quota bar/text (מ-subscription)
                                       usage+cost (מ-usage)
                                          │ מוצג ב-
                                     SettingsScreen.svelte (כרטיס נוסף)
```

## §4 — Commits

### Commit 0 — FE adapters: subscription + usage (approach: manual)
**‏קבצים חדשים**:
- `packages/frontend/src/lib/adapters/voice/subscription.ts`:
  ```ts
  export type ElevenLabsSubscription = {
    characterCount: number; characterLimit: number; status: string; tier?: string
  }
  /** Reads /proxy/elevenlabs/v1/user/subscription (BE injects key). ArkType parse. */
  export async function fetchElevenLabsSubscription(signal?: AbortSignal): Promise<ElevenLabsSubscription>
  ```
  - ‏דפוס מ-`voices.ts`: `fetch(beUrl("/proxy/elevenlabs/v1/user/subscription"), { headers: { "xi-api-key": "browser-placeholder" } })`.
  - ‏**‏ArkType** ל-response — **‏רק שדות שבאמת נחוצים, ‏`tier` אופציונלי** (‏אביגיל finding #1 — ‏אחרת parse-throw אם tier חסר; ‏מיושר עם ה-precedent ב-BE שמדלג עליו): ‏`{ character_count: "number", character_limit: "number", status: "string", "tier?": "string", "+": "ignore" }`. ‏ממפה snake→camel. ‏no-any. ‏(‏parse-fail → ‏throw שנתפס ב-VM → undefined, ‏לא קורס — ‏DoD.)
- `packages/frontend/src/lib/adapters/usage.ts`:
  ```ts
  export type ProviderTotals = { requests: number; cacheHits: number; chars: number; inputTokens: number; audioTokens: number; costUsd: number }
  export type UsageSummary = Record<"elevenlabs" | "google", ProviderTotals>
  export async function fetchUsageSummary(): Promise<UsageSummary>  // GET /api/usage/summary
  ```
**‏Verification**: `pnpm --filter @drive-coding/frontend-v2 typecheck`

### Commit 1 — FE: VM + כרטיס TtsStatusCard (approach: manual)
**‏קבצים חדשים**:
- `packages/frontend/src/lib/view-models/tts-status.svelte.ts` — ‏VM (‏singleton או context) ‏עם `$state`: `subscription`, `usage`, ‏`refresh()` (‏קורא את שני ה-adapters, ‏בולע שגיאות → undefined). ‏ה-reason נלקח מ-`ttsCapabilities.caps` (‏קיים).
- `packages/frontend/src/lib/components/settings/TtsStatusCard.svelte`:
  - ‏**‏reason**: ‏לכל ספק ב-caps עם `available===false` → ‏הודעה לפי `reason`: `quota→t("...quotaExhausted")`, `no-key→t("...noKey")`, `forbidden→t("...forbidden")`, `error→t("...error")`.
  - ‏**‏quota** (ElevenLabs): ‏`{characterCount} / {characterLimit}` + ‏(‏אופציונלי) bar `min(count/limit,1)*100%`. ‏אם מוצה — ‏הדגשה.
  - ‏**‏usage**: ‏פר-ספק — ‏ElevenLabs: ‏`{chars} תווים · ~${costUsd}`; ‏Gemini: ‏`{inputTokens}+{audioTokens} tokens · ~${costUsd}`. ‏+ cacheHits.
**‏קבצים משתנים**:
- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte` — ‏הוסף `<SettingsCard title={t("settings.ttsStatus.title")}><TtsStatusCard/></SettingsCard>` (‏אחרי כרטיס הקול). ‏קרא `ttsStatus.refresh()` ב-mount.
- ‏i18n (`packages/core/src/i18n/keys.ts` + `catalogs/he.ts` + `catalogs/en.ts`) — **‏additive, 3 קבצים** (‏כמו slice 1): ‏מפתחות ל-title + ‏reason-messages + ‏labels (‏quota/‏usage/‏cost). ‏ראה §6.
**‏Verification**: ‏typecheck · ‏preview (‏DoD §5).

## §5 — DoD

| ‏בדיקה | ‏איך |
|---|---|
| ‏typecheck נקי | `pnpm --filter @drive-coding/frontend-v2 typecheck` |
| ‏lint:i18n נקי | `bash scripts/lint-no-hebrew-in-code.sh` |
| ‏**‏reason מוצג**: ‏ElevenLabs מוצה → ‏"‏המכסה מוצתה" | ‏preview (‏מפתח-מוצה) → ‏כרטיס מציג "‏המכסה מוצתה" (‏לא disabled-שקט) |
| ‏**‏quota מוצג**: ‏200K/100K | ‏preview → ‏כרטיס מציג `200000 / 100000` (‏מ-subscription החי) |
| ‏**‏usage מוצג** | ‏אחרי TTS → ‏כרטיס מציג chars/tokens + ‏~$cost (‏מ-`/api/usage/summary`) |
| ‏no-key → ‏"‏חסר מפתח" | ‏מפתח ריק → ‏reason "‏חסר מפתח" (‏לא "‏מכסה") |
| ‏Gemini quota → ‏"‏—"/‏לא-זמין | ‏אין subscription ל-Gemini → ‏מוצג gracefully |
| ‏adapter fail לא שובר | ‏subscription/usage נכשל → ‏VM undefined → ‏כרטיס מציג "‏—", ‏לא קורס |
| ‏אין דליפת-סוד ב-FE | ‏ה-placeholder הוא `"browser-placeholder"`, ‏לא מפתח |

## §6 — Risks

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏Hardcoded Hebrew | ‏hook | ‏כל מחרוזת → `t(key)`; ‏i18n ב-3 קבצי-core (‏כמו slice 1); `lint:i18n` |
| ‏Svelte 5 reactivity | ‏learnings | ‏VM עם `$state`; ‏`{#each}` ‏עם key אם רשימה |
| ‏subscription snake_case | ‏— | ‏ArkType parse + ‏מיפוי snake→camel ב-adapter |
| ‏usage/subscription איטי (‏חוסם UI) | ‏— | ‏VM `refresh()` non-blocking; ‏כרטיס מציג "‏טוען…"/"‏—" ‏עד שמגיע |
| ‏i18n additive collision | ‏parallel-safe-code | ‏הוספה בלבד |
| ‏reason gate מציג כל reason | ‏— | ‏מיפוי ל-4 ה-reasons; ‏default → "‏לא זמין" ‏גנרי |

## §7 — Escalation triggers
- ‏אם `/proxy/elevenlabs/v1/user/subscription` ‏מ-FE ‏מחזיר 401 ‏למרות שה-BE מזריק (‏placeholder לא-מוחלף) → ‏שאל (‏ייתכן ש-OneCLI/env נדרש שונה מ-voices).
- ‏אם מבנה usage summary שונה ממה שה-brief מתאר → ‏עצור, ‏הצג, ‏שאל.
- ‏החלטת-עיצוב שמשנה >50 ‏שורות (‏layout הכרטיס) → ‏decide reasonably + ‏commit-msg.

## §8 — Complexity score
- ‏commits: 2 · ‏שכבות: ‏FE adapters + ‏VM + ‏component (‏glue) · ‏external APIs: ‏0 חדשים (‏2 endpoints קיימים) · ‏streaming: ‏אין · ‏BE: ‏**‏אפס** · ‏protocol: ‏אין
- ‏**‏Score: 5/10 → verifier: light (`calev`)** — ‏FE glue-code; ‏אימות = ‏preview (‏reason+quota+usage מוצגים).

## §9 — שאלות פתוחות
| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏progress-bar גרפי או טקסט למכסה? | ‏טקסט + ‏bar-פשוט אם קל (`div` ‏ברוחב-%) | ❌ |
| 2 | ‏usage: ‏"‏סה"כ מצטבר" — ‏להבהיר שזה לא-חודשי? | ‏label "‏סה"כ (‏מאז ההפעלה)" | ❌ |
| 3 | ‏עלות: ‏להציג גם breakdown (‏input vs audio ל-Gemini)? | ‏רק סכום `costUsd` + ‏tokens; ‏breakdown = ‏future | ❌ |
| 4 | ‏רענון-אוטומטי של הכרטיס (‏usage משתנה)? | ‏refresh ב-mount + ‏כפתור-רענון ידני; ‏auto = ‏future | ❌ |
