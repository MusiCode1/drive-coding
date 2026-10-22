# tests/smoke — חליפה מדור קודם

> **‏המסלול הנתמך לבדיקות דפדפן הוא `tests/e2e/`.** התיקייה הזאת נשארת כי
> שלושה מהסקריפטים כאן מכסים מסלולים שטרם הומרו, ואין טעם למחוק כיסוי לפני
> שיש לו מחליף.

## מה קרה כאן (22/10/2026)

החליפה נכתבה בסבב `testing-coverage` ומאז הסביבה זזה תחתיה. מה שתוקן:

| מה | מצב |
|---|---|
| ‏`disconnect.mjs` | **הומר** ל-`tests/e2e/specs/disconnect.spec.ts` והוסר מכאן |
| ‏`chat-roundtrip` · `voice-picker` · `cache-replay` | **מדלגים כברירת-מחדל.** הם קוראים `chromium.launch()` שחסום במארח, והם תלויים בספק חיצוני בתשלום |
| ‏`playlist-nav-chrome` | נשאר מאחורי `PLAYLIST_NAV_CHROME=1`. ההערה שהניחה שהקונטיינר מפרסם פורט הוחלפה בעובדה נמדדת |
| ‏`run-all.mjs` | ‏**‏`skipped` הוא מצב שלישי**, ודילוג גורף נספר ככשל |

## 🔴 מה שהיה שבור, ולמה זה היה בלתי-נראה

‏`run-all.mjs` קבע `ok: code === 0`, וסקריפט שדילג יוצא 0. ⇒ **האגרגט היה
מדפיס "4/4 passed" ו-exit 0 כשאפס דפדפנים נפתחו.** עכשיו אותו מצב בדיוק מדפיס
`0 passed · 4 skipped` ו-exit **1**.

ואין כאן CI ואין hook שמריץ את זה, ולכן שום מנגנון לא היה אמור לתפוס את
הריקבון — הוא נמצא רק כשניגשנו לכתוב את `tests/e2e/`.

## הרצה

```bash
cd tests/smoke
npm install        # פעם אחת; playwright
node run-all.mjs
```

**תנאי-קדם:** ‏BE חי. ‏⚠️ **הערך ההיסטורי `FE_URL=http://localhost:5173` שגוי** —
פורט ה-dev של Vite מוקצה ע"י ה-OS (`packages/frontend/vite.config.ts`:
`port: OS-assigned`). ‏`tests/e2e/` עוקף את זה לגמרי: ה-BE מגיש את ה-FE הבנוי,
ולכן יש **כתובת אחת**.

להרצת סקריפט מדור-קודם בכל זאת, במכונה שבה דפדפן מקומי כן זמין:

```bash
SMOKE_LEGACY_HOST_CHROME=1 node voice-picker.mjs
```

## קונבנציית הפלט

כל סקריפט מדפיס פלט לאדם **ובנוסף** שורה מובנית אחת:

```
RESULT: {"ok":true,"skipped":null,...}
```

‏`run-all.mjs` קורא את השורה הזאת. ‏`skipped` הוא מה שמבדיל "לא רץ" מ-"עבר" —
בלעדיו הדילוג נראה כהצלחה.

```bash
node voice-picker.mjs 2>&1 | grep '^RESULT: ' | sed 's/^RESULT: //' | jq .
```

## הסקריפטים

| קובץ | מכסה | תלות חיצונית |
|---|---|---|
| `chat-roundtrip.mjs` | ‏סבב צ'אט מלא + TTS | ‏turn אמיתי של LLM + ElevenLabs |
| `voice-picker.mjs` | בורר הקולות בטופס החיבור | ‏ElevenLabs דרך OneCLI |
| `cache-replay.mjs` | ‏מטמון ה-proxy של ה-BE (`x-cache: hit`) | ‏Gemini + ElevenLabs |
| `playlist-nav-chrome.mjs` | ‏harness ניווט-פלייליסט ב-Chrome | כרום בקונטיינר |

**הסדר סדרתי במכוון** — ל-BE יש state משותף (סשנים מצטברים), והרצה מקבילית
הייתה מסתירה באגי-מקביליות במקום לחשוף אותם. אותו נימוק תקף ב-`tests/e2e/`.
