# Slice A1 — turnState‑stability — ⚠️ בוטל (הוצא מהשרשרת)

> **תאריך**: 2026-06-28 · **סטטוס**: **בוטל** — אבחון הופרך
> **מחליף**: `docs/investigations/2026-06-28-sentence-cutting-mid-word.md`

## למה בוטל

ה‑brief הזה התיימר לתקן את **חיתוך‑המילים** ב‑TTS דרך `onTurnSettled` (flush של השארית
רק בסוף‑תור ודאי). האבחון הופרך ע"י המשתמשת בשתי נקודות:

1. **החיתוך קורה גם ב‑claude‑code** (שאין לו opencode‑tail) → ה‑flush‑המוקדם אינו השורש.
2. **אין סיגנל אמין של "סוף הודעה"** → `onTurnSettled` (debounce של שקט) הוא היוריסטיקה
   שיורה גם באמצע תשובה איטית.

→ חיתוך‑המילים עבר ל**חקירה** מול נתונים חיים (cache/wire של שני הספקים):
`docs/investigations/2026-06-28-sentence-cutting-mid-word.md`. הניחוש המוביל: תווי‑כיווניות
(RLM)/ניקוד משבשים את `Intl.Segmenter`.

## מה קרה לשרשרת

הפלייליסט (A2→A3→A4), ה‑watchdog (A5) וה‑UI (B1) **אינם תלויים** בבאג הזה. הם בודדו
ועומדים בנפרד — A2 ו‑A5 עומדים ישירות על `dev`. ר' `playback-run-control-roadmap.md`.
