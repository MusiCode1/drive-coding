# drive-coding

**עברית** · [English](./README.md)

ממשק קולי, hands-free, לסוכני-קוד CLI תואמי-ACP (כרגע
[opencode](https://opencode.ai) ו-Claude Code). פקודה אחת מפעילה שרת backend
ומגישה את ה-web UI מאותו origin — משוחחים עם סוכן-הקוד מהדפדפן, בנייד או
במחשב, עם text-to-speech בזרימה ו-push-to-talk.

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

מתחילים מ-[`AGENTS.md`](AGENTS.md) — המפה לשאר התיעוד (ארכיטקטורה, מוסכמות,
הרצה מקומית, תהליך git worktrees). רקע טכני מורחב:
[`docs/design-principles.md`](docs/design-principles.md) ו-
[`docs/roadmap.md`](docs/roadmap.md).

## רישיון

MIT — ר' [`LICENSE`](LICENSE).
