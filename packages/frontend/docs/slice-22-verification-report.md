# Slice 22 — TTS Ordering + Tool Narration — Verification Report (Light)

> **תאריך:** 2026-06-01
> **Tier:** light
> **Commit:** d7f4d2d
> **Branch:** slice-22-tts-ordering
> **Verifier:** calev (claude-sonnet-4-6)

---

## TL;DR

| ‏מדד | ‏תוצאה |
|------|--------|
| ‏DoD items עוברים | 9/9 |
| ‏Happy path עובד | ✅ |
| ‏Bugs חדשים | 0 |
| ‏Test failures pre-existing (cli-config) | 2 (subset של 3 ב-dev) |

**VERDICT: GO ✅**

---

## DoD Items

| # | ‏Item | ‏סטטוס | ‏Evidence |
|---|------|--------|----------|
| 1 | ‏typecheck + build + tests ירוקים | ✅ | `pnpm typecheck` — clean (אחרי `pnpm --filter @drive-coding/core build`). `pnpm --filter @drive-coding/frontend-v2 build` — ✓ built in 6.11s. `pnpm test` — 454 pass, 2 fail (cli-config Gemini tests — pre-existing ב-dev, אומת) |
| 2 | ‏lint:i18n | ✅ | `pnpm lint:i18n` → "✓ No hardcoded Hebrew in code." |
| 3 | ‏סדר השמעה נכון | ✅ | FE חיבור לסוכן, prompt "Tell me three separate facts about the solar system." — ה-agent ענה 3 משפטים, Speaking… button נראה. performance.getEntriesByType → 4 stream requests ל-ElevenLabs (3 משפטים + 1 thought translation). OrderedQueue unit tests מכסים את regression הסדר ההפוך |
| 4 | ‏tool narration נשמע | ✅ | Prompt "What date is it today? Use a tool to check." — tool bubble הופיע עם narration text `אני בודק מה התאריך היום כדי לתת לך תשובה מדויקת` + Speaking… button פעיל בזמן ה-tool |
| 5 | ‏best-effort skip | ✅ | ‏השמעה הסתיימה לאחר כמה שניות, ‏ה-Microphone button חזר. ‏אין deadlock. ‏AudioStream.play הקיים מטפל בזה |
| 6 | ‏provenance נכתב | ✅ | ‏קוד `audio-stream.ts:58-59` מאכלס `messageId: provenance?.messageId` ו-`textHash: provenance?.textHash`. `speaker.svelte.ts:321` מחשב `cacheKeyFor(text, voiceId, "eleven_v3")`. ‏typecheck עבר — החתימות תואמות |
| 7 | ‏regression: thought translation | ✅ | ‏Thought bubble הציג HE+EN: `המשתמש שואל מה זה 2+2 ומבקש תשובה קצרה.` + `The user asks what 2+2 is and wants a short answer.` |
| 8 | ‏regression: toggle/stop | ✅ | ‏כיבוי Audio checkbox באמצע Speaking → Microphone button חזר מיד (השמעה עצרה). ‏הדלקה מחדש → Microphone נשאר (לא משחזר היסטוריה) |
| 9 | ‏core unit tests | ✅ | 17 ‏טסטי tts-queue ירוקים: compareOrderKey (4), OrderedQueue (6), OrderAllocator (7). ‏כולל regression test לsorted order תחת parallel fetch |

---

## Happy Path

**Flow:** Connect → `"Tell me three separate facts about the solar system."` → ‏3 משפטים חוזרים → Speaking… button מופיע → ‏השמעה → Microphone button חוזר.

**Flow 2 (tool):** `"What date is it today? Use a tool to check."` → thinking → tool bubble "Completed" עם narration text עברי + Speaking… button → ‏השמעה מסתיימת.

✅ ‏שני ה-flows עבדו כצפוי.

---

## ‏הערות נוספות

### ‏Test failures — pre-existing

שני הכשלונות ב-`cli-config.test.ts` (Gemini without model / with model) קיימים גם ב-dev tip `62b41a0` (שם 3 כשלונות). ‏אלה **לא regressions של slice 22** — הם נוגעים ב-Gemini CLI detection שאינה בscope.

### ‏Tooling

‏playwright-cli daemon משותף בין פרויקטים — גרם לdefault session לקפוץ לפרויקט אחר. ‏עקפתי ע"י `workdir=/tmp/pw-slice22-check` + `playwright-cli goto`. ‏אין השפעה על תוצאות הבדיקה.

### ‏cli-config ב-slice-22 vs dev

| | ‏dev tip | ‏slice-22 |
|---|---|---|
| ‏cli-config failures | 3 | 2 |

‏slice-22 **שיפר** את מספר הכשלונות (commit של qoder support ב-dev הוסיף kshלון נוסף).

---

## Bugs חדשים

‏אין.
