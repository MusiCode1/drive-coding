---
project: "drive-coding"
slice: "tts-status-ui"
verifier: "calev"
date: "2026-07-03"
mode: "light"
verdict: "GO"
dod_items:
  - "typecheck clean (0 errors)"
  - "lint:i18n clean (no hardcoded Hebrew)"
  - "reason displayed: ElevenLabs quota exhausted shows correct message"
  - "quota displayed: 200K/100K from live subscription"
  - "usage displayed: chars/tokens + ~$cost"
  - "no-key case: i18n key present (settings.ttsStatus.reason.noKey)"
  - "Gemini quota: no subscription endpoint, shows — gracefully"
  - "adapter fail does not crash: Promise.allSettled swallows errors to undefined"
  - "no secret leaked in FE: header value is browser-placeholder"
spot_check: "API responses validated live — caps+subscription+usage all return expected shapes"
findings: []
---

# tts-status-ui — Verification Report (Light)

> **תאריך:** 2026-07-03
> **Tier:** light
> **Commit:** 892725e

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 9/9 |
| Happy path עובד | ✅ |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck נקי | ✅ | `svelte-check 5063 FILES 0 ERRORS 0 WARNINGS` |
| 2 | lint:i18n נקי | ✅ | `✓ No hardcoded Hebrew in code.` |
| 3 | reason מוצג: ElevenLabs מוצה → "המכסה מוצתה" | ✅ | caps endpoint: `{available:false,reason:"quota"}`; i18n key `settings.ttsStatus.reason.quota` → `"המכסה מוצתה"` ב-he.ts; `reasonKey()` ב-TtsStatusCard מפנה ל-key נכון |
| 4 | quota מוצג: 200K/100K | ✅ | subscription endpoint מחזיר `character_count:200000, character_limit:100000`; ArkType ממפה snake→camel; component מציג `{sub.characterCount.toLocaleString()} / {sub.characterLimit.toLocaleString()}` + progress bar אדום (quotaExhausted=true) |
| 5 | usage מוצג: chars/tokens + ~$cost | ✅ | usage endpoint: elevenlabs `{chars:0,costUsd:0}`, google `{inputTokens:104,audioTokens:1282,costUsd:0.025744}`; component מציג `formatCost(costUsd)` = `$0.0257` בדיוק 4 ספרות |
| 6 | no-key → "חסר מפתח" | ✅ | i18n key `settings.ttsStatus.reason.noKey` → `"חסר מפתח"` — לא נבדק חי (env עם key), אבל `reasonKey()` מפנה ל-key הנכון ב-switch, typecheck אימת |
| 7 | Gemini quota → "—" / לא-זמין | ✅ | אין fetchGeminiSubscription; `usageGo` מגיע מ-usage summary (לא subscription); כשהוא undefined → component מציג `t("settings.ttsStatus.usage.notAvailable")` = `"—"` |
| 8 | adapter fail לא שובר | ✅ | VM משתמש ב-`Promise.allSettled` → גם אם subscription/usage נכשלים → `undefined` → card מציג "—", לא קורס |
| 9 | אין דליפת-סוד | ✅ | `subscription.ts` שורה 45: `"xi-api-key": "browser-placeholder"` — מחרוזת literal, לא env var |

## Happy path

**תרחיש:** BE על 4085 עם .tmp/.env (מפתח ElevenLabs מוצה). FE build עם `FE_STATIC_DIR`.

ציפוי בהגדרות → כרטיס "מצב TTS":
- ElevenLabs: disabled + reason "המכסה מוצתה" (מ-caps.elevenlabs.reason="quota")
- Quota section: `200,000 / 100,000` + progress bar אדום + תווית "מוצה"
- Usage ElevenLabs: `0 chars · עלות משוערת: $0.0000`
- Usage Gemini: `104 input + 1,282 audio tokens · עלות משוערת: $0.0257`

ה-flow תקין: `SettingsScreen.onMount` קורא `ttsCapabilities.refresh()` + `ttsStatus.refresh()` במקביל. שניהם non-blocking. הכרטיס מציג "טוען..." ואז ממלא.

✅ עבד — ה-API responses תואמים לתצוגה הצפויה.

## Bugs חדשים שלא ברשימה

אין.
