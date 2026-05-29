# Slice 19a — Hebrew Comments: core — תוכנית

> **תאריך**: 2026-06-03
> **סטטוס**: טיוטה
> **Complexity**: 2/10 (verifier: light)
> **תלות**: אין (עצמאי לחלוטין מ-19b ו-19c)
> **Base**: dev tip `1409184`

---

## §0 — Pre-flight

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-19a-comments-core -b slice-19a-comments-core dev
cd .worktrees/slice-19a-comments-core
pnpm install
pnpm hooks:install
```

### איך להריץ

- **Tests**: `pnpm --filter @drive-coding/core test`
- **Typecheck**: `pnpm typecheck`
- **Lint i18n**: `pnpm lint:i18n`

> אין צורך ב-BE או FE — slice זה הוא שינוי טקסט בלבד (הערות קוד).

### Browser

לא נדרש.

### OneCLI agent

לא נדרש.

### Reading list

**must-read** (לפני שמתחילים):
- `scripts/lint-no-hebrew-in-code.sh` — מאשר שהערות מותרות בעברית (רק string literals נחסמים)
- `scripts/lint-no-hebrew-in-code.py` — לוגיקת הבדיקה המדויקת

**reference** (בזמן עבודה):
- `docs/plans/EXECUTOR_DISPATCH.md` — קונבנציות כלליות

---

## §1 — מטרה

לאחר השלמת הסליס, כל הערות הקוד בחבילת `packages/core/src/` יהיו בעברית. מפתח הקורא את הקוד יוכל להבין את כל ה-JSDoc blocks, ההערות ה-inline, ותיאורי הארכיטקטורה בשפה אחת עקבית — עברית — בלי לעבור בין שפות.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| תרגום הערות `packages/core/src/` | ✅ | בסליס הזה |
| תרגום הערות `packages/backend/src/` | ❌ | slice 19b |
| תרגום הערות `packages/frontend/src/` | ❌ | slice 19c |
| תרגום JSDoc `@param`/`@returns` descriptions | ✅ | בסליס הזה |
| שמירת `biome-ignore` justifications באנגלית | ✅ | לא לגעת בהם |
| שמירת `@ts-ignore`/`@ts-expect-error` באנגלית | ✅ | לא לגעת |
| שינוי קוד פונקציונלי | ❌ | לא לגעת |
| תרגום string literals | ❌ | לא לגעת |
| תרגום שמות פונקציות/משתנים | ❌ | לא לגעת |

> **כלל ברזל**: אם שורה מתחילה עם `// biome-ignore` או מכילה `@ts-` directive — לא לגעת בכלום בשורה.

---

## §3 — Architecture diagram

```
packages/core/src/
  acp/
    client-impl.ts      ← הערות קצרות, תרגום inline
    client.ts           ← ייתכן ללא הערות
    describe-crash.ts   ← JSDoc + inline
    provider-error.ts   ← JSDoc block גדול (תיאור algorithm)
    transport-mock.ts   ← ייתכן ללא הערות
    transport.ts        ← ייתכן ללא הערות
  cache/
    types.ts            ← הערות קצרות
  cwd-hash.ts           ← הערות
  cwd-validate.ts       ← ~40 שורות הערה
  i18n/
    catalogs/en.ts      ← ייתכן ללא הערות (i18n strings)
    catalogs/he.ts      ← ייתכן ללא הערות
    index.ts            ← ייתכן ללא הערות
    keys.ts             ← ייתכן ללא הערות
  index.ts              ← ייתכן ללא הערות
  log/
    browser.ts          ← ~37 שורות הערה, יש biome-ignore
    config.ts           ← ~20 שורות
    index.ts            ← ~5 שורות
    namespace.ts        ← ~15 שורות
    types.ts            ← ~5 שורות
  ports.ts              ← 29 שורות הערה
  schemas/
    agent.ts            ← ~20 שורות, חלק כבר בעברית
    index.ts            ← ייתכן ללא הערות
    ws-messages.ts      ← 65 שורות הערה (הגדול ביותר)
  ui/
    markdown.ts         ← ~5 שורות
  voice/
    cache-key.ts        ← ייתכן ללא הערות
    narration-prompt.ts ← ~5 שורות
    sentence-boundary.ts← ~8 שורות
    translation-prompt.ts← ייתכן ללא הערות
```

---

## §4 — Commits בסדר

### Commit 0 — תרגום הערות packages/core/src/ לעברית (approach: none)

**קבצים שמשתנים** (רשימה מלאה — תרגם כולם בcommit אחד):
- `packages/core/src/acp/client-impl.ts`
- `packages/core/src/acp/client.ts`
- `packages/core/src/acp/describe-crash.ts`
- `packages/core/src/acp/provider-error.ts`
- `packages/core/src/acp/transport-mock.ts`
- `packages/core/src/acp/transport.ts`
- `packages/core/src/cache/types.ts`
- `packages/core/src/cwd-hash.ts`
- `packages/core/src/cwd-validate.ts`
- `packages/core/src/i18n/catalogs/en.ts`
- `packages/core/src/i18n/catalogs/he.ts`
- `packages/core/src/i18n/index.ts`
- `packages/core/src/i18n/keys.ts`
- `packages/core/src/index.ts`
- `packages/core/src/log/browser.ts`
- `packages/core/src/log/config.ts`
- `packages/core/src/log/index.ts`
- `packages/core/src/log/namespace.ts`
- `packages/core/src/log/types.ts`
- `packages/core/src/ports.ts`
- `packages/core/src/schemas/agent.ts`
- `packages/core/src/schemas/index.ts`
- `packages/core/src/schemas/ws-messages.ts`
- `packages/core/src/ui/markdown.ts`
- `packages/core/src/voice/cache-key.ts`
- `packages/core/src/voice/narration-prompt.ts`
- `packages/core/src/voice/sentence-boundary.ts`
- `packages/core/src/voice/translation-prompt.ts`

**כללי תרגום לקובץ**:

1. **`// הערה`** → תרגם הטקסט לעברית
2. **`/** JSDoc block */`** → תרגם את כל הטקסט (כולל תיאורי @param ו-@returns), אבל השאר את שמות ה-tags עצמם (@param, @returns וכו') ואת שמות הפרמטרים
3. **`/* inline block */`** → תרגם לעברית
4. **`// ── Section Banner ─────`** → תרגם את הכיתוב — **חריג**: Section banners בקבצי `i18n/catalogs/` (כמו `// ─── connect ───`, `// ─── chat ───`) הם domain prefixes של i18n keys — **לא לתרגם**, השאר כמו שהן
5. **הערות שכבר בעברית** → השאר כמו שהן
6. **`// biome-ignore lint/...: <reason>`** → **לא לגעת בכלל** — כל השורה נשארת (ב-`log/browser.ts` יש כמה כאלה)
7. **`// @ts-ignore`**, **`// @ts-expect-error`** → לא לגעת
8. **הפניות ל-"Slice X"** בהערות (כמו `// Slice 3+`) → השאר כמו שהן (שמות slice הם identifiers, לא תיאור חופשי)
9. **קוד** (לא הערות) → לא לגעת לחלוטין

**Verification**:

```bash
pnpm typecheck
pnpm lint:i18n
# אין test-run נדרש לslicer זה — אין שינוי לוגי
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck עובר | `pnpm typecheck` |
| 2 | lint:i18n עובר (אין Hebrew בstring literals) | `pnpm lint:i18n` |
| 3 | כל הערה באנגלית ב-`packages/core/src/` תורגמה | `grep -r "^[[:space:]]*//" packages/core/src/ \| grep -vE "biome-ignore\|@ts-\|eslint\|i18n/catalogs" \| python3 -c "import sys,re; [print(l,end='') for l in sys.stdin if not re.search(r'[\u0590-\u05ff]',l)]" \| grep -E "[a-zA-Z]{4,}"` — אמור להחזיר מעט/כלום |
| 4 | אין שינוי ב-biome-ignore שורות | `git diff \| grep "biome-ignore"` — אמור להיות ריק |
| 5 | אין שינוי בstring literals (רק הערות) | `git diff packages/core/src/ \| grep "^+" \| grep -v "^+++" \| grep -vE "^\\+[[:space:]]*//"` — אמור להיות ריק (פלט ריק = רק הערות השתנו) |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| שינוי מקרי של קוד (לא רק הערות) | טעות עריכה | פקודת DoD #5 — בדוק ש-diff כולל רק הערות |
| תרגום שגוי של `biome-ignore` directive | כלל ברזל §2 | DoD #4 — `git diff \| grep biome-ignore` חייב להיות ריק |
| שבירת TypeScript syntax ע"י עריכה שגויה | טעות בהעתקה | `pnpm typecheck` — DoD #1 |
| הערות שכבר בעברית — תרגום כפול | § schemas/agent.ts | קרא קודם לפני עריכה, שמור כמו שהן |

---

## §7 — Escalation triggers

> עצור ושאל את Tama:

- TypeScript typecheck נכשל לאחר התרגום (שבירת syntax בהערה)
- lint:i18n מתלונן על Hebrew בקוד (הוכנסה עברית בstring literal בטעות)
- קובץ `biome-ignore` שורה השתנתה (אי אפשר לתרגם ולשמור תאימות)

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Pure logic, אין IO | -2 |
| TDD מלא, tests מקיפים | 0 |
| Greenfield, אין call sites | 0 |
| שינוי טקסט בלבד (הערות) | -2 |

**Score**: 0/10 (מינימלי)

**Tier**: `verifier-slice-light` בלבד

**Verifier-phase אחרי commit/phase**: אין

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | כיצד לתרגם מונחים טכניים כמו "bridge", "proxy", "spawn"? | להשאיר את המונח הטכני באנגלית בתוך הטקסט העברי (כמו: "מפעיל bridge") | ❌ |
| 2 | האם לתרגם ASCII art diagrams בתוך הערות? | כן — תרגם את הטקסט המתאר, שמור את ה-ASCII art | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

> ה-executor מתעד פה כל סטייה מה-brief ולמה.

- ...
