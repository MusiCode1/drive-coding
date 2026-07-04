# Slice — tts-quota-refine — תוכנית

> **תאריך**: 2026-07-03
> **סטטוס**: ‏מאושר (‏אביגיל READY r1, 2×🟡/🟢 — 2026-07-03)
> **Complexity**: 5/10 (verifier: light)
> **תלות**: ‏מתקן את slice 3 (logic) + slice 4 (UI). **‏base = `slice/tts-status-ui`** (‏שכולל 1+2+3+4). ‏depends_on: [tts-status-ui]

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/tts-quota-refine -b slice/tts-quota-refine slice/tts-status-ui
cd .worktrees/tts-quota-refine && pnpm install && pnpm hooks:install
```

### Run
- ‏BE (‏env, port גבוה-פנוי — **‏זומבים על 4000-4085; ‏netstat + ‏בחר 4090+**): `set -a; . D:/UserProjects/AI/drive-coding/.tmp/.env; set +a; PORT=4090 bun packages/backend/src/server.ts`
- ‏preview: ‏build FE + `FE_STATIC_DIR=<build> PORT=4090 bun ...`. ‏המפתח מוצה (count 200K, limit 100K, +ext 100K → effective 200K → מוצה).
- ‏Tests: `pnpm --filter @drive-coding/core test`

### Reading list
**‏must-read**:
- `packages/core/src/tts/subscription.ts` (`interpretSubscription` — ‏משנים logic)
- `packages/backend/src/delivery/http-tts-capabilities.ts` (`probeElevenLabsQuota` + `subscriptionResponseSchema` — ‏מוסיפים 2 שדות)
- `packages/frontend/src/lib/adapters/voice/subscription.ts` (‏adapter — ‏מוסיפים 2 שדות)
- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte` §‏שורות 41-52 (`ttsProviderOptions` — ‏מוסיפים description)
- `packages/frontend/src/lib/components/settings/TtsStatusCard.svelte` §49-56, 103-116 (`reasonKey`, `quotaExhausted`, quota display)
- `packages/frontend/src/lib/components/ui/Select.svelte` §‏שורה 5 (`SelectOption.description` — ‏קיים), 153-154 (‏מרונדר מתחת ל-label)

## §1 — מטרה

‏שני תיקונים שה-preview חשף:
1. ‏**‏reason בגוף ה-Select** — ‏היום כשElevenLabs disabled בבורר-הספק, ‏המשתמש רואה disabled-שקט; ‏הסיבה מוצגת רק בכרטיס-נפרד. ‏התיקון: ‏ה-`reason` (‏"‏המכסה מוצתה" / ‏"‏חסר מפתח") ‏מופיע **‏כ-`description` של האופציה בתוך ה-Select** (‏ה-component כבר תומך).
2. ‏**‏logic ב' — ‏מכסה אפקטיבית** — ‏היום `interpretSubscription` ‏חוסם על `count >= character_limit` (‏**‏בסיס**). ‏אבל ElevenLabs מאפשר **‏extension** (`can_extend_character_limit` + `max_character_limit_extension`). ‏התיקון: ‏חסימה על **‏המכסה-האפקטיבית** = `limit + (canExtend ? maxExtension : 0)`. ‏(‏למשל creator: ‏100K בסיס + ‏100K ext = ‏200K effective.)
3. ‏**‏format** — ‏"‏200,000 / ‏100,000" ‏מבלבל; ‏labels ברורים ("‏נוצל / ‏מכסה" + ‏"‏חריגה" ‏כש-count>base).

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא |
|---|---|
| ‏reason כ-description ב-Select | ✅ |
| ‏effective-limit logic (base+extension) | ✅ |
| ‏quota format labels ברורים + effective | ✅ |
| ‏שינוי חוזה `/api/tts/capabilities` | ❌ (‏reason כבר בטיפוס) |
| ‏overage-warning (95%) | ❌ future |

## §3 — Commits

### Commit 0 — core: interpretSubscription effective limit (approach: TDD)
**‏קובץ**: `packages/core/src/tts/subscription.ts` (+‏עדכון `subscription.test.ts`)
```ts
export type SubscriptionInfo = {
  characterCount: number; characterLimit: number; status: SubscriptionStatus
  maxExtension?: number   // max_character_limit_extension
  canExtend?: boolean     // can_extend_character_limit
}
export function interpretSubscription(sub: SubscriptionInfo): QuotaVerdict {
  if (sub.status === "free_disabled") return { exhausted: true, reason: "quota" }
  const effectiveLimit =
    sub.canExtend && sub.maxExtension && sub.maxExtension > 0
      ? sub.characterLimit + sub.maxExtension
      : sub.characterLimit
  if (effectiveLimit > 0 && sub.characterCount >= 0 && sub.characterCount >= effectiveLimit)
    return { exhausted: true, reason: "quota" }
  return { exhausted: false, reason: "ok" }
}
```
**‏טסטים חדשים**: ‏count בין base ל-effective (‏overage) → ‏**‏לא**-exhausted; ‏count >= effective → ‏exhausted; ‏canExtend=false → ‏מול base; ‏maxExtension=0 → ‏מול base.
**‏Verification**: `pnpm --filter @drive-coding/core test subscription`

### Commit 1 — BE: schema + pass extension (approach: manual)
**‏קובץ**: `packages/backend/src/delivery/http-tts-capabilities.ts`
- ‏schema: ‏הוסף `"max_character_limit_extension?": "number"`, `"can_extend_character_limit?": "boolean"` (‏אופציונליים; `"+":"ignore"` ‏נשאר).
- ‏העבר ל-`interpretSubscription({ ..., maxExtension: parsed.max_character_limit_extension, canExtend: parsed.can_extend_character_limit })`.
**‏Verification**: `curl :4090/api/tts/capabilities` → `elevenlabs:{available:false,reason:"quota"}` (‏effective 200K, count 200K).

### Commit 2 — FE: reason ב-Select + quota labels + adapter (approach: manual)
**‏קובץ חדש**: `packages/frontend/src/lib/util/tts-reason.ts` — ‏העבר את `reasonKey`-logic (‏מ-TtsStatusCard) ל-util משותף: `ttsReasonMessage(reason, t): string`.
**‏קבצים משתנים**:
- `SettingsScreen.svelte` §41-52: ‏ל-`ttsProviderOptions` ‏הוסף `description`: ‏כשהאופציה disabled → `ttsReasonMessage(caps[value].reason, t)`, ‏אחרת `undefined`. ‏(‏ה-Select מציג description מתחת ל-label, ‏מעומעם ב-disabled.)
- `subscription.ts` (adapter): ‏הוסף `maxExtension?`, `canExtend?` ל-`ElevenLabsSubscription` + ‏ל-ArkType schema (`"max_character_limit_extension?":"number"`, `"can_extend_character_limit?":"boolean"`), snake→camel.
- `TtsStatusCard.svelte`:
  - ‏השתמש ב-`ttsReasonMessage` ‏המשותף (‏במקום reasonKey מקומי).
  - ‏quota: ‏חשב `effectiveLimit` (‏מ-sub.maxExtension/canExtend); ‏`quotaExhausted` ‏מול effective. ‏**‏labels ברורים**: ‏`t("...used"): {count} · t("...limit"): {base}` + ‏אם `count > base` → ‏`t("...overage")` ("‏חריגה"). ‏ה-bar מול effective.
- ‏i18n (3 קבצים core): ‏מפתחות `settings.ttsStatus.quota.used` = "נוצל", `.limitLabel` = "מכסה", `.overage` = "חריגה (overage)". (‏reason keys כבר קיימים.)
**‏Verification**: ‏typecheck · ‏preview (‏DoD §4).

## §4 — DoD

| ‏בדיקה | ‏איך |
|---|---|
| ‏core test ‏ירוק (‏overage cases) | `pnpm --filter @drive-coding/core test subscription` — ‏count-בין-base-ל-effective → ‏לא-חסום |
| ‏typecheck + ‏lint:i18n | `pnpm typecheck; bash scripts/lint-no-hebrew-in-code.sh` |
| ‏**‏reason ב-Select** | ‏preview → ‏בורר-TTS → ‏אופציית ElevenLabs מציגה "‏המכסה מוצתה" מתחת ל-label |
| ‏**‏effective logic** | ‏preview → ‏מפתח-מוצה (‏count 200K ≥ effective 200K) → ‏`reason:"quota"`. (‏overage-באמצע לא ייחסם — ‏אין דרך לבדוק חי עם ה-מפתח הנוכחי, ‏אבל core-test מכסה) |
| ‏**‏quota labels ברורים** | ‏preview → ‏כרטיס: ‏"‏נוצל: 200,000 · ‏מכסה: 100,000 · ‏חריגה" (‏לא "‏200,000/100,000" ‏גולמי) |
| ‏Gemini לא-מושפע | ‏caps.google ‏ללא שינוי |

## §5 — Risks
| ‏סיכון | ‏מיטיגציה |
|---|---|
| ‏שדות extension חסרים בתגובה (‏tier אחר) | ‏אופציונליים ב-schema (`?`); ‏interpretSubscription: ‏`canExtend && maxExtension>0` → ‏fallback ל-base |
| ‏Hardcoded Hebrew | ‏3 מפתחות חדשים → t(key); `lint:i18n` |
| ‏reasonKey כפול (‏TtsStatusCard + Select) | ‏util משותף `tts-reason.ts` — ‏מקור-אחד |
| ‏Select description ‏על אופציה disabled לא מוצג | ‏אמת ב-preview (‏Select.svelte:153 ‏מרנדר description ‏גם ל-disabled) |

## §6 — Escalation
- ‏אם ElevenLabs לא מחזיר `can_extend_character_limit`/`max_character_limit_extension` בכלל → ‏שאל (‏ה-fallback ל-base אמור לכסות, ‏אבל אמת).
- ‏אם ה-Select לא מציג description על disabled-option → ‏שאל על מיקום חלופי (‏ליד הבורר).

## §7 — Complexity
- ‏commits: 3 · ‏core (TDD) + ‏BE (2 שדות) + ‏FE (Select desc + labels + adapter) · ‏glue · ‏0 endpoints חדשים
- ‏**‏Score: 5/10 → light (`calev`)**. ‏אימות = ‏preview (‏reason-ב-Select + ‏labels).

## §8 — שאלות פתוחות
| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏reason בכרטיס — ‏להשאיר או להסיר (‏עכשיו ב-Select)? | ‏להשאיר בכרטיס (‏פירוט) + ‏Select (‏מהיר) — ‏שניהם | ❌ |
| 2 | ‏format: ‏"‏נוצל: X · ‏מכסה: Y" ‏או "‏X מתוך Y"? | ‏"‏נוצל: X · ‏מכסה: Y (‏חריגה)" | ❌ |
| 3 | ‏להציג את ה-effective (‏200K) ‏או את ה-base (‏100K) ‏כ"‏מכסה"? | ‏base (100K) ‏+ ‏"‏חריגה"; ‏effective = ‏future-detail | ❌ |
