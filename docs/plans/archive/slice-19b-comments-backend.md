# Slice 19b — Hebrew Comments: backend — תוכנית

> **תאריך**: 2026-06-03
> **סטטוס**: טיוטה
> **Complexity**: 2/10 (verifier: light)
> **תלות**: אין (עצמאי לחלוטין מ-19a ו-19c)
> **Base**: dev tip `1409184`

---

## §0 — Pre-flight

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-19b-comments-backend -b slice-19b-comments-backend dev
cd .worktrees/slice-19b-comments-backend
pnpm install
pnpm hooks:install
```

### איך להריץ

- **Tests**: `pnpm --filter @drive-coding/backend test`
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

לאחר השלמת הסליס, כל הערות הקוד בחבילת `packages/backend/src/` יהיו בעברית. הארכיטקטורה של ה-HTTP/WS routes, אסטרטגיות caching, ו-agent orchestration — כולן יהיו מתועדות בעברית עבור הצוות.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| תרגום הערות `packages/backend/src/` | ✅ | בסליס הזה |
| תרגום הערות `packages/core/src/` | ❌ | slice 19a |
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
packages/backend/src/
  acp/
    bridge-manager.ts     ← ~20 שורות הערה (critical logic)
    cli-config.ts         ← ~10 שורות
  agents/
    registry.ts           ← ~8 שורות
  app/
    agent-orchestrator.ts ← 47 שורות הערה (הגדול ביותר)
    projects-registry.ts  ← ~5 שורות
    recordings-store.ts   ← ~6 שורות
  delivery/
    cors-config.ts        ← ייתכן הערות
    cors-config.test.ts   ← test file, תרגם הערות
    http-agents.ts        ← 25 שורות
    http-client-log.ts    ← ~5 שורות
    http-history.ts       ← 31 שורות
    http-options.ts       ← ~5 שורות
    http-proxy.ts         ← 41 שורות (כולל CRITICAL comment)
    http.ts               ← ייתכן ללא הערות
    proxy-cache.ts        ← 37 שורות
    wire-decode.ts        ← ייתכן הערות
    wire-decode.test.ts   ← test file, תרגם הערות
    ws-agent.ts           ← 32 שורות (ארכיטקטורה + ASCII diagram)
    ws-echo.ts            ← ~3 שורות
  log-setup.ts            ← ~5 שורות
  plugin-config.ts        ← ייתכן הערות
  prompts/
    audio-friendly.ts     ← ייתכן הערות
    index.ts              ← ייתכן הערות
  server.ts               ← ייתכן הערות
  voice/
    cache-keys.ts         ← ~6 שורות
    cache.ts              ← ~8 שורות
```

---

## §4 — Commits בסדר

### Commit 0 — תרגום הערות packages/backend/src/ לעברית (approach: none)

**קבצים שמשתנים** (רשימה מלאה — תרגם כולם בcommit אחד):
- `packages/backend/src/acp/bridge-manager.ts`
- `packages/backend/src/acp/cli-config.ts`
- `packages/backend/src/agents/registry.ts`
- `packages/backend/src/app/agent-orchestrator.ts`
- `packages/backend/src/app/projects-registry.ts`
- `packages/backend/src/app/recordings-store.ts`
- `packages/backend/src/delivery/cors-config.ts`
- `packages/backend/src/delivery/cors-config.test.ts`
- `packages/backend/src/delivery/http-agents.ts`
- `packages/backend/src/delivery/http-client-log.ts`
- `packages/backend/src/delivery/http-history.ts`
- `packages/backend/src/delivery/http-options.ts`
- `packages/backend/src/delivery/http-proxy.ts`
- `packages/backend/src/delivery/http.ts`
- `packages/backend/src/delivery/proxy-cache.ts`
- `packages/backend/src/delivery/wire-decode.ts`
- `packages/backend/src/delivery/wire-decode.test.ts`
- `packages/backend/src/delivery/ws-agent.ts`
- `packages/backend/src/delivery/ws-echo.ts`
- `packages/backend/src/log-setup.ts`
- `packages/backend/src/plugin-config.ts`
- `packages/backend/src/prompts/audio-friendly.ts`
- `packages/backend/src/prompts/index.ts`
- `packages/backend/src/server.ts`
- `packages/backend/src/voice/cache-keys.ts`
- `packages/backend/src/voice/cache.ts`

**כללי תרגום לקובץ**:

1. **`// הערה`** → תרגם הטקסט לעברית
2. **`/** JSDoc block */`** → תרגם את כל הטקסט (כולל תיאורי @param ו-@returns), אבל השאר את שמות ה-tags עצמם (@param, @returns וכו') ואת שמות הפרמטרים
3. **`/* inline block */`** → תרגם לעברית
4. **`// ── Section Banner ─────`** → תרגם את הכיתוב
5. **הערות שכבר בעברית** → השאר כמו שהן
6. **`// biome-ignore lint/...: <reason>`** → **לא לגעת בכלל** — כל השורה נשארת
7. **`// @ts-ignore`**, **`// @ts-expect-error`** → לא לגעת
8. **ASCII art diagrams** (→, ↕, ┌, └, etc.) → שמור את ה-ASCII, תרגם רק את הטקסט המתאר (labels)
9. **קוד** (לא הערות) → לא לגעת לחלוטין

**דוגמה לתרגום ה-CRITICAL comment ב-http-proxy.ts**:

```ts
// לפני:
// CRITICAL: Bun/fetch transparently decompresses gzip/deflate response bodies,
// but the original `content-encoding` and `content-length` headers describe
// the COMPRESSED body. Forwarding them as-is makes the FE try to decompress
// an already-decompressed payload → ERR_CONTENT_DECODING_FAILED.
// Strip both — the browser will read the decompressed body via chunked transfer.

// אחרי:
// קריטי: Bun/fetch מפענח gzip/deflate בשקיפות,
// אבל header ה-`content-encoding` וה-`content-length` המקוריים מתארים
// את ה-body הדחוס. העברתם כמו שהם גורמת ל-FE לנסות לפענח
// payload שכבר פוענח → ERR_CONTENT_DECODING_FAILED.
// מסירים את שניהם — הדפדפן קורא את ה-body המפוענח דרך chunked transfer.
```

**Verification**:

```bash
pnpm typecheck
pnpm lint:i18n
pnpm --filter @drive-coding/backend test
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck עובר | `pnpm typecheck` |
| 2 | lint:i18n עובר | `pnpm lint:i18n` |
| 3 | backend tests עוברים | `pnpm --filter @drive-coding/backend test` |
| 4 | אין שינוי ב-biome-ignore שורות | `git diff \| grep "biome-ignore"` — אמור להיות ריק (הערה: אין `biome-ignore` ב-`src/` בפועל, כן יש ב-test files שמחוץ לscope — DoD זה תמיד יהיה ריק) |
| 5 | כל הערה ארוכה באנגלית תורגמה | `grep -r "^[[:space:]]*//" packages/backend/src/ \| grep -vE "biome-ignore\|@ts-\|eslint" \| python3 -c "import sys,re; [print(l,end='') for l in sys.stdin if not re.search(r'[\u0590-\u05ff]',l)]" \| grep -E "[a-zA-Z]{5,}"` — מעט/כלום |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| שינוי מקרי של קוד (לא רק הערות) | טעות עריכה | DoD #5 — בדוק ש-diff כולל רק הערות |
| תרגום שגוי של `biome-ignore` directive | כלל ברזל §2 | DoD #4 — `git diff \| grep biome-ignore` חייב להיות ריק |
| שבירת TypeScript syntax | טעות בהעתקה | `pnpm typecheck` — DoD #1 |
| אובדן מידע טכני חשוב בתרגום שגוי | CRITICAL comments כמו HTTP decompression | תרגם בזהירות, שמור על המשמעות המדויקת |

---

## §7 — Escalation triggers

> עצור ושאל את Tama:

- TypeScript typecheck נכשל לאחר התרגום
- lint:i18n מתלונן על Hebrew בקוד (הוכנסה עברית בstring literal בטעות)
- backend tests נכשלים לאחר התרגום (אמור להיות בלתי אפשרי — שינוי הערות בלבד)
- קובץ `biome-ignore` שורה השתנתה

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Pure logic, אין IO | -2 |
| שינוי טקסט בלבד (הערות) | -2 |

**Score**: 0/10 (מינימלי)

**Tier**: `verifier-slice-light` בלבד

**Verifier-phase אחרי commit/phase**: אין

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | כיצד לתרגם מונחים טכניים כמו "bridge", "proxy", "spawn"? | להשאיר את המונח הטכני באנגלית בתוך הטקסט העברי (כמו: "מפעיל bridge") | ❌ |
| 2 | ASCII diagrams (→, ↕, ┌) — לתרגם labels? | כן — תרגם הטקסט, שמור ה-ASCII | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

> ה-executor מתעד פה כל סטייה מה-brief ולמה.

- ...
