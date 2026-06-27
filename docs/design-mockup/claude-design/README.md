# claude-design — snapshots מ-claude.ai/design

תוצרי **claude.ai/design** של ה-project "DriveCoding Design System"
(`a6504a32-0a47-483f-922c-d02e0da4a78e`, בעלים: Avi), נשמרים כאן כ-**reference
ויזואלי בלבד**.

## למה זה כאן ולא משמש כקוד

claude.ai/design תומך רק ב-**React**, וה-frontend שלנו הוא **Svelte 5**. לכן
התוצרים האלה הם **מוקאפים-מטרה** — שפת-העיצוב, ה-tokens, פריסות-המסך וכיווני-העיצוב —
ולפיהם עורכים את קומפוננטות ה-Svelte. **אין מ-build, אין import לקוד הרץ.** הקומפוננטות
הן framework-agnostic React recreations של ה-Svelte המקורי (ויזואלית נאמנות, פונקציונלית
מפושטות — בלי voice/WS אמיתי).

## מבנה

```
claude-design/
└── <YYYY-MM-DD>/        snapshot מתוארך (לא דורסים גרסה קודמת)
    ├── readme.md        ה-design-language המלא של ה-project (המסמך הכי שימושי)
    ├── styles.css       entry point (@import בלבד)
    ├── tokens/          colors (8 palettes) · typography · spacing · motion · fonts · base
    ├── guidelines/      specimens ויזואליים (HTML) — Colors / Type / Spacing / Brand
    ├── ui_kits/         מסכים שלמים (connect → live-chat) — React + index.html
    ├── components/      core (Button/Icon/Card/...) + chat (Bubble/MicButton/...) —
    │                    כל קומפוננטה: .jsx + .d.ts (props) + .prompt.md (usage) + *.card.html
    └── explorations/    כיווני-עיצוב חלופיים (redesign directions / modes & layout)
```

## מה לא נמשך (קיים ב-project, לא רלוונטי כ-reference עיצובי)

- `assets/*.png`, `.thumbnail` — binary (ה-icons כבר ב-`packages/frontend/static/icons`).
- `_ds_bundle.js` — bundle של React מקומפל/minified (לא קריא).
- `_ds_manifest.json`, `_adherence.oxlintrc.json`, `SKILL.md` — תשתית של פלטפורמת
  claude.ai/design עצמה.

למשיכה מחדש / עדכון: `/design-sync` (read-only) מול ה-projectId לעיל.

## מקור-אמת

ה-project ב-claude.ai/design נבנה **reverse-engineered מהקוד של ה-frontend**. כלומר
זה snapshot של פרשנות-עיצוב, לא ה-spec הקנוני. מקור-האמת הקנוני נשאר
`docs/frontend-spec.md` ו-`packages/frontend/src/app.css`.
