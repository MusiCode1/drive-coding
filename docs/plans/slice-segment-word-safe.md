# Slice — segment-word-safe — סגמנטציית-TTS בטוחת-מילה (שורש A) + נרמול-bidi (שורש B)

> **תאריך**: 2026-07-04
> **סטטוס**: מאושר (אביגיל READY, 2026-07-04 — finding ירוק יחיד: Risk #2 non-issue, `.test.ts` ב-allowlist של lint:i18n. הדוח לא נשמר לדיסק — ה-verdict מתוך task-result; טענות-המפתח אומתו גם ע"י מרדכי ישירות מהקוד)
> **Complexity**: 4/10 (verifier: light — core הוא TDD; smoke חי קצר ל-DoD)
> **תלות (`depends_on`)**: [] — בנוי ישירות על `dev`
> **Base**: `dev` @ `1832aa0`
> **מקור-חקירה**: `docs/investigations/2026-07-04-sentence-cutting-replay-findings.md` (שורש A, מאומת ב-replay של נתוני-אמת: 7 חיתוכים→0) · `docs/investigations/2026-07-04-sentence-cutting-h1-unit-findings.md` (שורש B)

## §1 — מטרה

היום, כשהעוזר מקריא תשובה עברית עם מבנה-markdown (כותרות `###`, `**מודגש**`, פסקאות),
**מילים נחתכות באמצע** בין שני סגמנטי-TTS → קול קטוע. שורש מאומת: מסלול "commit-everything"
הרב-פסקאתי ב-`splitIntoSentences` פולט את השארית החצי-מילה של הפסקה **האחרונה** (שעדיין בזרימה).
בנוסף, תווי-כיווניות (RLM) שהמודל פולט משבשים את זיהוי-סוף-המשפט (`TERMINATOR_RE`) → החזקת-זנב
ועיכוב. אחרי ה-slice: **שום סגמנט לא נגמר באמצע מילה**, ותווי-כיווניות לא משבשים את הסגמנטציה.
שינוי **ליבה-טהורה** (`packages/core`), בר-אימות-unit מלא.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| שורש A — החזקת זנב הפסקה-האחרונה בזרימה (fix mid-word) | ✅ | commit 0 |
| שורש B — נרמול תווי-כיווניות (bidi) בכניסת הסגמנטציה | ✅ | commit 1 |
| Hardening ברז-2 (`speaker.svelte.ts` flush) — הרצת `splitIntoSentences` על ה-flush | ❌ | **follow-up נפרד** — תלוי ב-heuristic סוף-תור של opencode (`#TAIL_MS=1500`, premature-flush). ר' §9. |
| מיזוג פסקאות-קצרות שלמות (one-word paragraph) חוצה-`\n\n` | ❌ | §9 — מיזוג חוצה-פסקה נגד design קיים; לא חוסם |
| נרמול ניקוד (`U+0591–U+05C7`) | ❌ | **בכוונה לא** — הוכח לא-מזיק (unit findings זווית 2/3), עשוי לשפר הגייה |
| שינוי `maxChars`/`minChars` defaults | ❌ | נשארים 200/20 |

## §3 — Architecture

```
packages/core/src/voice/sentence-boundary.ts   ← השינוי היחיד (פונקציה טהורה)
  splitIntoSentences(buffer, opts)
    ├─ [commit 1] נרמול-bidi בכניסה (שורש B)         ← חדש
    ├─ split לפסקאות (\n{2,})
    └─ [commit 0] הפסקה האחרונה: זנב לא-מסתיים → remaining  ← השינוי (הסרת !isMulti)
packages/core/tests/voice/sentence-boundary.test.ts  ← טסטים חדשים + עדכון test 4
```
אין נגיעה ב-FE/BE. `Speaker` (`packages/frontend`) צורך את הפונקציה כמו היום — אפס שינוי-חוזה.

## §4 — Commits

### Commit 0 — שורש A: החזקת זנב הפסקה-האחרונה בזרימה (approach: **TDD**)

**קבצים משתנים**:
- `packages/core/tests/voice/sentence-boundary.test.ts` — טסטים חדשים (red first):
  1. **streaming mid-word + multi-para** — הזנה דו-שלבית שמשחזרת את הבאג:
     ```ts
     it("streaming: a chunk ending mid-word in a multi-paragraph buffer does NOT emit a mid-word segment", () => {
       // chunk#1 ends mid-word ("### מ") while the buffer already contains a \n\n
       const c1 = "טקסט קודם ארוך מספיק כדי להיחשב.\n\n### מ"
       const c2 = "ה נשאר פתוח (לא חוסם)\n- פריט"
       let buf = ""
       const emitted: string[] = []
       for (const ch of [c1, c2]) {
         const { sentences, remaining } = splitIntoSentences(buf + ch)
         for (const s of sentences) emitted.push(s)
         buf = remaining
       }
       // אף סגמנט לא נגמר באמצע מילה: "מה" לא נחצה
       expect(emitted.join(" | ")).not.toMatch(/### מ$/)
       expect(emitted.some((s) => s.includes("### מה"))).toBe(true)
     })
     ```
  2. **control חד-פסקאתי** — אותו chunk בלי `\n\n` → הזנב מוחזק (כבר עובר היום; regression-guard).
  3. **fixtures מזרם-אמת** — לפחות 3 מ-7 המילים שנחתכו (`הודעת`, `בוצע`, `השינויים`): הזנה דו-שלבית
     שבה גבול-ה-chunk נופל באמצע המילה כשה-buffer רב-פסקאתי → המילה השלמה מופיעה באחד הסגמנטים, לא נחצית.
  4. **עדכון `test 4`** (`"שלום\n\nעולם"`) — הציפייה משתנה ל-streaming-semantics:
     ```ts
     // before: expect(sentences).toEqual(["שלום","עולם"]); remaining ""
     // after:  הפסקה האחרונה ("עולם") עדיין בזרימה → מוחזקת
     expect(sentences).toEqual(["שלום"])
     expect(remaining).toBe("עולם")
     ```
     עדכן גם את שם/תיאור הטסט: "…מחייב פסקאות שהושלמו (\n\n אחריהן); הזנב האחרון מוחזק".

**שינוי הקוד** (`packages/core/src/voice/sentence-boundary.ts`, סביב שורה 65):
```ts
// before:
if (isLastPara && isLastSeg && !isMulti) {
// after — הפסקה האחרונה (עוד בזרימה, אין \n\n אחריה) מטופלת כמו פסקה-בודדת:
if (isLastPara && isLastSeg) {
```
+ עדכן את הערת-הקוד של ה-`else` (שורות 73-78): "פסקאות שאינן-אחרונות (בוגרות ע\"י \n\n) מחויבות
במלואן; הפסקה האחרונה עוד בזרימה → זנבה הלא-מסתיים מוחזק כ-remaining (מונע חיתוך-אמצע-מילה)".

**Verification**:
```bash
pnpm --filter @drive-coding/core test sentence-boundary
pnpm --filter @drive-coding/core typecheck
```

### Commit 1 — שורש B: נרמול תווי-כיווניות בכניסת הסגמנטציה (approach: **TDD**)

**קבצים משתנים**:
- `packages/core/tests/voice/sentence-boundary.test.ts` — 7 טסטים (מ-unit findings §5). בנה תווים ב-JS
  (`const RLM = "‏"`, `const LRM = "‎"`) — **לא ליטרלים** (וגם: hook ה-i18n חוסם עברית-בקוד,
  אבל bidi ב-regex מותר; העדף `\u`-escapes לבהירות):
  1. `"משפט ראשון ארוך מספיק להיפלט." + RLM` → `sentences=["משפט ראשון ארוך מספיק להיפלט."]`, `remaining=""`.
  2. `"…להיפלט." + RLM + " "` → נפלט, `remaining=""`.
  3. control בלי RLM → נפלט (אי-רגרסיה).
  4. RLM לא נדבק לתחילת הסגמנט הבא: streaming עם RLM בתחילת chunk המשך → `expect(seg.startsWith("‏")).toBe(false)`.
  5. ניקוד לא-מזיק: `"שְׁלוֹם עוֹלָם. משפט שני ארוך מספיק כאן."` → 2 משפטים, פיצול תקין (הניקוד נשמר, לא נורמל).
  6. ניפוח-אורך: משפט >200 עם RLM אחרי כל רווח → מס' הסגמנטים = כמו הגרסה הנקייה; כל סגמנט ≤200 ובגבול-מילה.
  7. דו-לשוני: `"…‎npm run build‏ עובד. משפט הבא ארוך מספיק כאן."` → פיצול תקין, בלי bidi בטקסט הנפלט.

**שינוי הקוד** (`sentence-boundary.ts`, בכניסת `splitIntoSentences`, מחליף את בדיקת-האורך-0 בשורה 39):
```ts
// TTS-only: תווי-כיווניות נחוצים לתצוגה (הבועות מרונדרות מ-bubble.segments המקוריים),
// אך משבשים את TERMINATOR_RE ומנפחים את ספירת-maxChars. הסרתם כאן בטוחה — הטקסט זורם רק ל-TTS.
// טווח: LRM/RLM (200E/200F) + embeddings (202A-202E) + isolates (2066-2069). לא ניקוד.
buffer = buffer.replace(/[‎‏‪-‮⁦-⁩]/g, "")
if (buffer.length === 0) return { sentences: [], remaining: "" }
```
(ודא שזה **‏לפני** יצירת ה-`Intl.Segmenter` ולפני ה-`split(/\n{2,}/)`.)

**Verification**:
```bash
pnpm --filter @drive-coding/core test sentence-boundary
pnpm --filter @drive-coding/core typecheck
pnpm lint:i18n   # ודא שאין עברית-ליטרלית שנכנסה לקוד המקור (טסטים משתמשים ב-\u)
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| כל הטסטים החדשים + הקיימים ירוקים | `pnpm --filter @drive-coding/core test sentence-boundary` |
| `test 4` עודכן ל-streaming-semantics (לא נמחק) | קריאת ה-diff של הטסט |
| typecheck נקי | `pnpm --filter @drive-coding/core typecheck` |
| lint נקי (0 עברית בקוד) | `pnpm lint:i18n` |
| build-gate מלא ירוק | `pnpm typecheck && pnpm test` (root) |
| **smoke חי (calev):** תשובה עברית עתירת-markdown לא נשמעת חתוכה-באמצע-מילה | preview + Gemini-TTS: prompt שמחזיר כותרות `###`+פסקאות בעברית; האזנה — מילים שלמות. (מפתח Gemini עובד, אומת 2026-07-04.) |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| הסרת `!isMulti` שוברת התנהגות multi-para לגיטימית | חקירת-replay 2026-07-04 §5 | הפסקאות הבוגרות (1..n-1) עדיין מחויבות במלואן; רק הזנב האחרון מוחזק, ונפלט בסוף-turn (ברז-2) או ב-chunk הבא — אפס אובדן-טקסט. אומת: 7→0 חיתוכים בלי רגרסיית-סגמנטים בהקלטה. |
| עברית-ליטרלית בטסטים → pre-commit hook חוסם | README §6 gotcha #1 · אביגיל 2026-07-04 (🟢) | **non-issue — אומת:** `lint:i18n` (`scripts/lint-no-hebrew-in-code.sh`) **מכיל allowlist ל-`.test.ts` ו-`/tests/`** → מחרוזות-בדיקה עבריות מותרות. עדיין: תווי-bidi ב-`\u`-escapes לבהירות. |
| `remaining` עם bidi מוביל אחרי נרמול | unit findings §2.1 (S3) | הנרמול בכניסה מסיר bidi מכל ה-buffer → ה-remaining שחוזר נקי; הטסט #4 של commit 1 שומר על כך. |
| ICU sentence boundary עדיין חותך מילה בתוכן-markdown נדיר | replay — לא נצפה אחרי fix A | fix A מחזיק את כל הזנב הלא-מסתיים; ICU חותך רק במשפטים מחויבים (בעלי terminator/פסקה) → גבול תמיד בטרמינטור/whitespace. אם calev שומע חיתוך שנותר → escalation. |

## §7 — Escalation triggers

עצור ושאל את מרדכי בparent task אם:
- אחרי fix A, טסט streaming עדיין מראה סגמנט שמסתיים באמצע מילה (→ מנגנון שלישי מעבר ל-commit-everything).
- `lint:i18n` בכל-זאת חוסם מחרוזות-בדיקה עבריות (לא-צפוי — `.test.ts` ב-allowlist; אם קרה → בדוק שינוי ב-hook).
- ה-smoke החי (calev) שומע חיתוך-אמצע-מילה למרות ירוק ב-unit (→ ייתכן שורש-אודיו נפרד, רמה-3).
- הסרת `!isMulti` מפילה טסט קיים אחר מלבד `test 4` (→ התנהגות multi-para לא-צפויה).

## §8 — Complexity score

- Commits: 2 (נמוך) · שכבות חדשות: 0 (אותה פונקציה) · APIs חיצוניים: 0 · streaming pipeline: הפונקציה משרתת streaming אך היא **טהורה** (+0 — נבדקת דטרמיניסטית) · refactor state: 0 · protocol: 0.
- **Score: 4/10 → verifier: light (calev).** ה-core בר-TDD-מלא; ה-verifier מוסיף smoke חי קצר בלבד ל-DoD.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | Hardening ברז-2 (`speaker.svelte.ts:316`): להריץ `splitIntoSentences` על ה-flush במקום raw? | **לא ב-slice הזה** — מגן רק מפני premature-flush של opencode (`#TAIL_MS=1500`), שהוא heuristic upstream נפרד; דורש הבחנה premature/final שאין ל-opencode. follow-up. | ❌ לא חוסם |
| 2 | מיזוג פסקה-קצרה-שלמה (one-word) חוצה-`\n\n`? | **לא** — מיזוג חוצה-פסקה נגד design קיים; concern ה-mid-word/tiny-fragment כבר נפתר ע"י fix A (הזנב מוחזק ומתמזג). | ❌ לא חוסם |
| 3 | לצרף A+B לאותו slice? | **כן** (הוחלט עם המשתמשת) — אותו קובץ, אותה משפחת-טסטים, שניהם TDD-core. | ❌ |
| 4 | `minChars` — להעלות מ-20 להקטנת קטוע? | להשאיר 20 (latency); כוונון = slice נפרד אם יידרש. | ❌ |
