# drive-coding

**עברית** · [English](./README.md)

ממשק קולי, hands-free, לסוכני-קוד CLI תואמי-ACP. פקודה אחת מפעילה שרת
backend ומגישה את ה-web UI מאותו origin — משוחחים עם סוכן-הקוד מהדפדפן,
בנייד או במחשב, עם text-to-speech בזרימה ו-push-to-talk.

שבעה סוכנים מגיעים מובנים — [opencode](https://opencode.ai), Claude Code,
Gemini CLI, Codex, Qoder, Cursor ו-Grok — והרג'יסטרי פתוח: אפשר להוסיף כל
CLI אחר שדובר ACP מקובץ הגדרות, בלי שינוי קוד. ראו
[`deploy/cli-specs.jsonc`](deploy/cli-specs.jsonc) ואת
[סכימת ה-JSON](deploy/cli-specs.schema.json) שלו.

## שימוש (בלי clone של הריפו)

```bash
bunx drive-coding
```

דורש [Bun](https://bun.sh) ≥ 1.3. למדריך המלא למשתמש-קצה (flags, משתני
סביבה, פתרון תקלות) — [`packages/release/README.he.md`](packages/release/README.he.md).

## פיתוח / תרומה לפרויקט

זהו מונו-רפו מבוסס Bun-workspaces.

```bash
bun install
bun run dev           # מריץ backend + frontend במקביל
```

- Backend: http://localhost:4000
- Frontend (Vite dev): פורט שנקבע אוטומטית, מודפס בהפעלה

```bash
bun run test          # כל הטסטים
bun run typecheck
bun run lint          # Biome
bun run hooks:install # חד-פעמי: מפעיל hook לבדיקת i18n לפני commit
```

### מבנה

- `packages/core/` — לוגיקה טהורה, ללא IO.
- `packages/backend/` — שרת Hono (REST + WebSocket) + גשר-תהליכי ACP.
- `packages/frontend/` — PWA קולי מבוסס SvelteKit.
- `packages/provider/` — שכבת חיבור ACP/CLI אגנוסטית-לספק.
- `packages/release/` — חבילת ה-npm `drive-coding` המפורסמת (אורזת את כל הנ"ל).

מתחילים מ-[`AGENTS.md`](AGENTS.md) — מוסכמות, הרצה מקומית ותהליך
git worktrees.

> **לגבי מסמכי העיצוב המעמיקים:** הערות הארכיטקטורה, ה-roadmap ויומן
> ההחלטות לכל slice חיים בריפו פרטי נפרד, ולכן נתיבים מהצורה
> `docs-for-llm/…` שמוזכרים ב-`AGENTS.md` **אינם** חלק מה-clone הזה. אלה
> הערות-עבודה של הסוכנים שבונים את הפרויקט, לא תיעוד למשתמש — שום דבר
> שנחוץ כדי להריץ או להשתמש ב-drive-coding אינו מוסתר שם.

## רישיון

MIT — ר' [`LICENSE`](LICENSE).
