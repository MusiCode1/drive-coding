# Slice — tts-segment-floor — רצפת-סגמנט: מיזוג-אחורה של זנב force-split מתחת-לרצפה

> **תאריך**: 2026-07-05
> **סטטוס**: ✅ **READY** (אביגיל r3, 2026-07-05 — 0 findings חוסמים; r1 תפסה הנחת-ליבה שגויה, r2+r3 דיוק-חסם). מוכן ל-dispatch.
> **Complexity**: 3/10 (verifier: light — core הוא TDD; smoke חי קצר ל-DoD)
> **תלות (`depends_on`)**: [] — בנוי ישירות על `dev` (segment-word-safe כבר מוזג)
> **Base**: `dev` @ `49b98e9`
> **מקור**: נגזר חי מ-`segment-word-safe` (runtime-gate, 2026-07-05). ר' `decisions/voice-acp.md` 2026-07-05.

## §1 — מטרה

היום, כשמשפט חורג מ-`maxChars` (=200), `forceSplitWords` מפצל אותו על גבול-מילה עם **תקרה
קשיחה** — אף פעם לא חורג מ-200. התוצאה: לפעמים ה**זנב האחרון** הוא מילה שלמה בודדת מתחת-לרצפה
(`minChars`=20), למשל `"ביניהם."` (8 תווים) שמושמעת כ-utterance קצרצר ולא-טבעי אחרי פאוזה.
נתפס חי ע"י המשתמשת (2026-07-05, על משפט 207-תווים).

אחרי ה-slice: **שום סגמנט מ-force-split לא קצר מ-`minChars`** (למעט מקרה-קצה של מילה-בודדת
שארוכה-מ-maxChars). ה-`maxChars` הופך ל**תקרה רכה** — מותר לחרוג בכמות חסומה (< `minChars`)
כדי לבלוע זנב-יתום לתוך הסגמנט הקודם. שינוי **ליבה-טהורה** (`packages/core`), בר-אימות-unit מלא.

**מדוע התקרה רכה**: `maxChars=200` היא היוריסטיקה שלנו ל-latency/גודל-chunk, **לא מגבלת-API**
(Gemini/ElevenLabs מקבלים טקסט ארוך בהרבה). חריגה של עד 19 תווים כדי למנוע utterance-יתום עדיפה.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| מיזוג-אחורה של זנב force-split < `minChars` לתוך ה-chunk הקודם | ✅ | commit 0 |
| חסימת גובה-החריגה: chunk ממוזג ≤ `maxChars + 2*minChars` (double-absorption בתצורת `[קצר,ענק,קצר]`) | ✅ | commit 0 (מובנה במיזוג) |
| מיזוג פסקה-קצרה-שלמה (סגמנט שלם < minChars שאינו זנב-force-split) | ❌ | **בכוונה לא** — פסקה/משפט קצר הוא כוונת-המחבר; §9 Q1. המיזוג-הקדמי הקיים (שורות 97-108) כבר מטפל בקצרים באותה פסקה. |
| שינוי `minChars`/`maxChars` defaults | ❌ | נשארים 20/200 |
| איזון-פיצול (לפצל מוקדם יותר כדי ששני החצאים ≥ רצפה) | ❌ | §9 Q2 — נדחה: מזיז יותר טקסט, משנה גם סגמנט שהיה תקין. מיזוג-אחורה מינימלי. |
| נגיעה ב-`Intl.Segmenter`/`TERMINATOR_RE`/מסלול ה-`remaining` (root A) | ❌ | מסלול נפרד; לא נוגעים |

## §3 — Architecture

```
packages/core/src/voice/sentence-boundary.ts   ← השינוי היחיד (פונקציה טהורה)
  splitIntoSentences(buffer, opts)
    └─ forceSplitWords(s, maxChars, minChars, locale)   ← מקבל minChars חדש
         ├─ צבירת chunks על גבול-מילה עד maxChars (קיים, ללא שינוי — אפס רגרסיה)
         └─ [חדש] floor-pass אחורני: כל chunk < minChars מקופל לשכן (קודם מועדף; קדימה אם ראשון)
```
אין נגיעה ב-FE/BE. חתימת `forceSplitWords` משתנה, אך היא **פנימית** (לא-exported) ונקראת
ממקום יחיד (`sentence-boundary.ts:114`). אפס שינוי-חוזה חיצוני. **לולאת-הצבירה הקיימת לא משתנה** →
טסטי-maxChars הקיימים (שאין להם זנב תת-רצפה) עוברים ללא שינוי.

**למה floor-pass אחורני ולא post-pass על האחרון בלבד** (תיקון finding 2 של אביגיל r1):
ההנחה "רק ה-chunk האחרון קטן" **שגויה בקצה** — כשמילה בודדת ארוכה-מ-~(maxChars−minChars) באה
אחרי prefix קצר, ה-prefix נדחף כ-chunk **לא-אחרון** תת-רצפה (למשל `"אב"` לפני מילת-199-תווים →
`(2+1+199)>200` → `"אב"` נפלט לבד). נדיר בעברית טבעית (URL/base64/token ארוך), אך אמיתי. לכן
**floor-pass שסורק אחורה ומקפל כל chunk תת-רצפה** — לא רק האחרון. (chunks תת-רצפה מבודדים ולא-סמוכים,
כי לולאת-הצבירה ממלאת כל chunk-פנימי עד ~maxChars → שכן המיזוג תמיד גדול → אין מיזוגים משורשרים.)
**חסם-החריגה** (אביגיל r2): בתצורת `[קצר, ענק, קצר]` (בדיוק תרחיש finding 2) המילה-הענקית האמצעית בולעת
**גם prefix וגם זנב** → החסם `maxChars + 2*minChars` (לא `+minChars`). זה **double-absorption**, לא שרשור
(אין שני תת-רצפה סמוכים) — לכן floor-pass אחורני יחיד עדיין נכון; רק החסם גדול פי-שניים ברכיב-הרצפה.

## §4 — Commits

### Commit 0 — רצפת-זנב ב-forceSplitWords (approach: **TDD**)

**קבצים משתנים**:
- `packages/core/tests/voice/sentence-boundary.test.ts` — טסטים חדשים (red first), `describe("force-split floor")`:
  1. **זנב-יתום נבלע**: משפט חד-פסקאתי שמתפצל ל-`[~199ch, "מילהקצרה."]` (זנב < minChars) →
     התוצאה: **סגמנט אחד** (הזנב נבלע), או לכל היותר chunks שכולם ≥ minChars. אף chunk < minChars.
     בנה קלט דטרמיניסטי: `("מילה ".repeat(n) + "סוף.")` שמכוון זנב קצר.
  2. **זנב תקין לא-נבלע (regression)**: משפט שמתפצל עם זנב ≥ minChars → הזנב **נשאר chunk נפרד**
     (לא מתמזג). מוודא שלא ממזגים אגרסיבית.
  3. **חסם-חריגה**: אחרי מיזוג, כשכל מילה ≤ maxChars — אורך ה-chunk הממוזג ≤ `maxChars + 2*minChars`.
     החסם `2*minChars` (לא `minChars`) מכסה **double-absorption**: בתצורת `[קצר, ענק, קצר]` המילה-הענקית
     בולעת גם prefix וגם זנב (worst-case: `prefix 19 + מילה 200 + זנב 19` = 240 ≤ 200+2·20). כלול טסט
     ייעודי לתצורה הזו (הרחבה של טסט 5), לא רק single-tail.
  4. **מילה-בודדת > maxChars**: קלט של מילה אחת ארוכה מ-maxChars → chunk יחיד, אין crash,
     אין מיזוג (אין שכן לצרף אליו).
  5. **זנב-יתום *לא-אחרון* נבלע** (finding 2): prefix קצר + מילה ארוכה-מ-(maxChars−minChars),
     ואז עוד תוכן — למשל `"אב " + "x".repeat(199) + " המשך ארוך תקין."` → ה-`"אב"` **לא** נשאר
     chunk תת-רצפה בפני עצמו (נבלע קדימה/אחורה). **אף chunk < minChars.** זה הטסט שמפיל את הגרסה
     הנאיבית (post-pass על האחרון בלבד).
  6. **3+ chunks עם זנב-יתום אחרון**: משפט ארוך מאוד (3+ chunks) שזנבו קצר → רק היתום מתמזג,
     ה-chunks האמצעיים (≥ minChars) נשארים שלמים.
  7. **fixture חי**: המשפט האמיתי שנתפס — `"...החוקיות של המעברים ביניהם."` (~207ch) →
     אין chunk == `"ביניהם."` בפני עצמו (הזנב נבלע ל-`"...המעברים ביניהם."`).
  8. **minChars=0 מכבה את הרצפה**: עם `{minChars:0}` — אין מיזוג (זנבות נשארים כמו היום).
     (regression-guard לכיבוי; עקבי עם `test: custom minChars=0` הקיים.)
  9. **דטרמיניזם**: אותו קלט → אותו פלט.
  10. **אי-רגרסיה ל-maxChars הקיים**: `test 6` ו-`"force-split subject to maxChars"` — הקלט שלהם
      **אין לו** זנב תת-רצפה → חייבים להישאר ירוקים **ללא שינוי** (מאמת שה-floor-pass לא מופעל לשווא).

**שינוי הקוד** (`sentence-boundary.ts`):
- חתימה: `forceSplitWords(text, maxChars, minChars, locale)` (+פרמטר `minChars: number`).
- קריאה (שורה ~114): `forceSplitWords(s, maxChars, minChars, locale)`.
- **לולאת-הצבירה הקיימת (שורות 130-141) — ללא שינוי.**
- בסוף `forceSplitWords`, אחרי הצבירה ולפני `return chunks`:
  ```ts
  // floor-pass (תקרה רכה): כל chunk תת-רצפה נבלע לשכן — קודם מועדף, קדימה אם הוא הראשון.
  // סורק אחורה כדי לטפל גם בזנב-יתום לא-אחרון (prefix קצר לפני מילה ענקית — finding 2).
  // חריגה חסומה: כשכל מילה ≤ maxChars, chunk ממוזג ≤ maxChars+2*minChars (double-absorption ב-[קצר,ענק,קצר]).
  if (minChars > 0) {
    for (let i = chunks.length - 1; i >= 0 && chunks.length > 1; i--) {
      const c = chunks[i] ?? ""
      if (c.length >= minChars) continue
      if (i > 0) {
        chunks.splice(i - 1, 2, `${chunks[i - 1]} ${c}`)
      } else {
        chunks.splice(0, 2, `${c} ${chunks[1]}`)
      }
    }
  }
  ```
  (הערה למבצע: הסריקה-אחורה + `chunks.length > 1` בטוחה כי chunks תת-רצפה מבודדים; אין שרשור.)

**Verification**:
```bash
pnpm --filter @drive-coding/core test sentence-boundary   # (vitest run מהשורש בפועל)
pnpm --filter @drive-coding/core typecheck
pnpm lint:i18n
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| כל הטסטים החדשים + הקיימים ירוקים | `npx vitest run packages/core/tests/voice/sentence-boundary.test.ts` |
| אף chunk מ-force-split אינו < minChars (פרט למילה-בודדת>max) | טסטים 1/5/6/7 |
| חסם-החריגה ≤ maxChars+2*minChars (כשכל מילה ≤ maxChars; double-absorption) | טסט 3 |
| typecheck נקי | `pnpm --filter @drive-coding/core typecheck` |
| lint נקי | `pnpm lint:i18n` |
| build-gate מלא ירוק | `pnpm typecheck && pnpm test` (root; פרט ל-pre-existing known-bugs) |
| **smoke חי (calev):** תשובה עברית ארוכה (משפטים >200 תווים) — אין utterance של מילה-בודדת מבודדת | preview + Gemini-TTS (voice-keys-direct, `.tmp/.env`); tap אופציונלי על ה-proxy לספירת סגמנטים קצרים = 0. |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| chunk תת-רצפה **לא-אחרון** נשמט (finding 2) | אביגיל r1 | ה-floor-pass סורק **אחורה על כל ה-chunks**, לא רק האחרון. טסט 5 מכסה במפורש. |
| floor-pass יוצר chunk שעדיין < minChars | תיאורטי | השכן ממולא עד ~maxChars (גדול) → מיזוג תמיד ≫ minChars. chunks תת-רצפה מבודדים (אין שרשור). טסט 1/5. |
| שינוי חתימת `forceSplitWords` שובר caller | קוד | קריאה יחידה (`:114`); הפרמטר mandatory → typecheck יתפוס כל פספוס. |
| חריגה מהתקרה שוברת latency/TTS | design | חסום ל-maxChars+2*minChars למילים רגילות (double-absorption); מילה בודדת>max כבר חורגת היום (בלתי-נמנע). התקרה היא היוריסטיקה, לא מגבלת-API (§1). |
| רגרסיה בטסטי-maxChars הקיימים | קוד | לולאת-הצבירה לא משתנה; הקלטים שלהם חסרי זנב תת-רצפה → floor-pass לא מופעל. טסט 10 שומר. |
| אינטראקציה עם root A (held tail) | parent slice | מסלולים נפרדים: root A נוגע ב-`remaining` (זנב לא-מסתיים); force-split פועל על סגמנטים **מחויבים**. אפס חפיפה. |
| מיזוג על פני גבול-משפט לגיטימי | design | force-split פועל **בתוך** סגמנט-ICU יחיד (משפט אחד ארוך) → הזנב הוא המשך אותו משפט, לא משפט אחר. |

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- מתגלה chunk תת-רצפה שאינו האחרון (→ הנחת-האלגוריתם "רק האחרון קטן" שגויה; דורש לולאת-מיזוג).
- ה-smoke החי (calev) שומע utterance של מילה-בודדת למרות ירוק ב-unit (→ ייתכן מקור-קטיעה נוסף מעבר ל-force-split, למשל ברז-2 flush).
- המיזוג-אחורה מפיל טסט קיים (→ אינטראקציה לא-צפויה עם המיזוג-הקדמי בשורות 97-108).

## §8 — Complexity score

- Commits: 1 · שכבות חדשות: 0 (אותה פונקציה) · APIs חיצוניים: 0 · streaming pipeline: הפונקציה טהורה (+0) · refactor state: 0 · protocol: 0.
- **Score: 3/10 → verifier: light (calev).** core בר-TDD-מלא; ה-verifier מוסיף smoke חי קצר בלבד.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | להחיל מיזוג-אחורה גם על פסקה-קצרה-שלמה (סגמנט שלם < minChars שאינו זנב-force-split)? | **לא** — פסקה/משפט קצר הוא כוונת-המחבר; המיזוג-הקדמי הקיים כבר מטפל בקצרים באותה פסקה. (הוכרע עם המשתמשת 2026-07-05.) | ❌ |
| 2 | תקרה רכה (חריגה עד `2*minChars` ב-double-absorption) מול איזון-פיצול? | **תקרה רכה** — מינימלי, נוגע רק ביתום. (הוכרע עם המשתמשת 2026-07-05.) | ❌ |
| 3 | מה אם `minChars ≥ maxChars` (קונפיג לא-שפוי)? | לא-נתמך רשמית (20<200). המיזוג עדיין בטוח (chunk יגדל). לא חוסם. | ❌ |

## §10 — Findings-log (אביגיל)

### r1 — USABLE-AFTER-FIX (2 findings, שניהם 🟡) — תוקנו

1. 🟡 **off-by-one בחסם-החריגה** — הברief אמר `maxChars+minChars-1`; הנכון הוא **`maxChars+minChars`**
   (המצרף `${prev} ${c}` מוסיף רווח). **תוקן**: §4 טסט 3, §5 DoD, §6.
2. 🟡 **טענה 5 ("רק ה-chunk האחרון תת-רצפה") שגויה בקצה** — מילה >~(maxChars−minChars) אחרי prefix
   קצר דוחפת את ה-prefix כ-chunk תת-רצפה **לא-אחרון**; post-pass יחיד מפספס, וטסט 4 לא כיסה.
   **תוקן**: העיצוב שונה מ-post-pass-על-האחרון ל-**floor-pass אחורני על כל ה-chunks** (§3, §4);
   נוסף **טסט 5** ייעודי; הטענה השגויה הוסרה מ-§3.

> הערה: אביגיל r1 לא כתבה דוח לדיסק (רק verdict+findings ב-task-result). התיקונים מבוססים על שני
> ה-findings שאומתו עצמאית ע"י מרדכי מול הקוד (הדוגמה `"אב"`+מילת-199 שוחזרה ידנית).

### r2 — USABLE-AFTER-FIX (🟡 + 🟢) — תוקנו

> דוח: `reports/drive-coding/tts-segment-floor-avigail-r2.md`. אביגיל אימתה ב-trace שה-floor-pass
> האחורני **מכסה את finding 2**, שאין שרשור, שאין רגרסיה ל-`test 6`/`:125`, ושהקריאה יחידה (`:114`). 4/5 מוקדים נקי.

1. 🟡 **חסם-החריגה `maxChars+minChars` מוקטן-מדי** — ה-floor-pass האחורני מבצע **double-absorption**:
   בתצורת `[קצר, ענק, קצר]` המילה-הענקית בולעת גם prefix וגם זנב → החסם האמיתי **`maxChars+2*minChars`**
   (worst-case 19+200+19=240 ≤ 240). **תוקן**: §2, §3, §4 טסט 3 + הערת-קוד, §5, §6. (האלגוריתם נכון — רק הטענה עודכנה.)
2. 🟢 **§2 נשמט מתיקון-r1** — טבלת-scope עדיין `maxChars+minChars-1` בעוד השאר עודכן. **תוקן** (§2 → `maxChars+2*minChars`).
