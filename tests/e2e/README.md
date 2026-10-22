# tests/e2e — בדיקות דפדפן מקצה לקצה

‏`@playwright/test` מול **BE אמיתי** ו**כרום אמיתי**. התוכנית המלאה, הנימוקים
והמדידות: ‏`docs-for-llm/plans/brief-e2e-browser-tests.md`.

## 🛑 מתי להריץ — פעם אחת, לפני preview

```bash
cd tests/e2e
npm install          # פעם אחת למכונה
npx playwright test
```

**‏לא פר-פאזה ולא פר-קומיט** (הכרעת-משתמש 22/10/2026). ההרצה מרימה BE, בונה FE
אם צריך, ופותחת כרום בקונטיינר — זה יקר. המקום שלה הוא בדיוק לפני שמגישים
למשתמש פריוויו להסתכל עליו בעיניים.

## למה זה לא רץ במארח

הורדה והרצה של דפדפן במארח **חסומות** ע"י `host-browser-guard`
(`~/.local/libexec/host-browser-guard/bin/`), כדי שהדיסק לא יתמלא. ה-guard
מעביר כל `playwright <cmd>` שאינו `install` ל-playwright הגלובלי ⇒ **Playwright
מותר, הבינארי של הדפדפן אסור.**

⇒ החליפה מתחברת ב-CDP לכרום **בתוך `linux-gui`**. זה עובד מהמארח בלי פרסום
פורטים, כי הקונטיינר רץ ב-`network_mode: host`.

🛑 **שני גבולות:**
- **‏CDP 9222 אסור** — זה הפרופיל המחובר (Google/SSO) ששותפים לו סשנים אחרים.
  החליפה בוחרת פורט **מחוץ** לטווח 9222–9299, מ-9333 ומעלה.
- **מורידים רק מה שהרמנו** — הכרום שלנו מזוהה לפי ספריית הפרופיל הייחודית שלו.

## דרישות

| מה | למה | בדיקה |
|---|---|---|
| `linux-gui` רץ | שם הדפדפן | `docker inspect linux-gui --format '{{.State.Running}}'` |
| ‏CLI של סוכן מותקן | הבדיקות מחברות סשן | `command -v claude` |
| ‏`bun install` בעץ | ה-BE | — |

**אין צורך ב-`npx playwright install`** — ואסור: הוא חסום, ואין לנו שימוש בו.

## משתני סביבה

| var | ברירת מחדל | מה |
|---|---|---|
| `E2E_BASE_URL` | — | להשתמש במופע BE **חי** במקום להרים אחד. מדלג גם על בניית ה-FE |
| `E2E_BE_PORT` | `4120` | תחילת טווח החיפוש לפורט פנוי. 🛑 **4000 מוחרג לעולם** — זה ה-BE של הסוכן |
| `E2E_CDP_PORT` | `9333` | תחילת טווח החיפוש ל-CDP. 🛑 **9222 מוחרג לעולם** |
| `LINUX_GUI_CONTAINER` | `linux-gui` | שם הקונטיינר |
| `E2E_EXPECT_MODEL` | — | אסרשן אופציונלי שתווית מודל מסוימת מופיעה בבורר (למשל `Haiku 5.5`) |

## הבדיקות

| קובץ | דורש דפדפן | מה |
|---|:---:|---|
| `specs/i18n-anchors.spec.ts` | ❌ | שומר על מפתחות ה-i18n שכל שאר הבדיקות עוגנות עליהם. נכשל בזמן **קומפילציה** אם מפתח נמחק |
| `specs/skeleton.spec.ts` | ✅ | שער: ה-BE מגיש FE, כרום עלה, CDP התחבר, אין שגיאות קונסול |
| `specs/disconnect.spec.ts` | ✅ | רגרסיה ל-Bug D1 — ניתוק חוזר ל-`/` בלי באנר שגיאה |
| `specs/model-picker.spec.ts` | ✅ | בורר המודלים מאוכלס בשמות קריאים ולא במזהים גולמיים |

**אף בדיקה אינה שולחת prompt** ⇒ אפס טוקנים ואפס תלות בספק חיצוני.

## עוגנים — למה לא `data-testid` ולא מחלקות CSS

‏`data-testid` אינו קיים בפרויקט (0 מופעים), ומחלקות CSS אינן עוגן: ‏
`button.disconnect` שעליו נשענה הבדיקה הישנה **נעלם** כשה-UI עבר למחלקות
Tailwind. וה-`aria-label` עוברים `t(...)` ולכן תלויי-שפה.

⇒ העיגון הוא על **מפתח i18n**, דרך ה-API הציבורי של core:

```ts
import { createI18n } from "@drive-coding/core/i18n"
const { t } = createI18n({ locale: "he" })
await page.getByLabel(t("session.closeSession")).click()
```

שינוי תרגום — הבדיקה עוקבת מעצמה. מחיקת מפתח — **שגיאת קומפילציה**, לא בדיקה
מהבהבת. זו הגנה שאין ל-`data-testid`.

## כשזה נכשל

| תסמין | סיבה | מה לעשות |
|---|---|---|
| `CDP did not come up on 127.0.0.1:<port>` + `Resource temporarily unavailable` | **הקונטיינר רווי ב-threads.** מגבלת ה-pids של `linux-gui` היא **512**, וכרום צורך ~35 threads למופע | `cat /sys/fs/cgroup/system.slice/docker-$(docker inspect linux-gui --format '{{.Id}}').scope/pids.current` — אם זה ≈512, אין מה לעשות מלבד להמתין או להעלות את המגבלה |
| `container linux-gui is not running` | — | להרים אותו |
| `BE did not become healthy` | ראו את הלוג שבהודעת השגיאה | — |
| `connectOverCDP` נתקע | טאב-אח שקרס. **הפרופיל הטרי אמור למנוע זאת** | רנבוק `cdp-raw-when-playwright-attach-hangs.md` |

🛑 **אל תהרגו תהליכי כרום שלא אתם הרמתם** — הקונטיינר משותף עם סשנים מקבילים.

## דוח

```bash
npx playwright show-report      # HTML
npx playwright show-trace test-results/<...>/trace.zip   # trace, נשמר ב-retry
```
