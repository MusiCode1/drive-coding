# Slice display-toggle-consistency — עקביות מחווני "תצוגת צ'אט" — תוכנית

> **תאריך**: 2026-06-25 · **dispatch-ready**: 2026-06-25 (מרדכי)
> **סטטוס**: ✅ **הושלם** — commit `cf4cb86`, branch `slice-display-toggle-consistency`. ממתין ל-merge ע"י מרדכי.
> **Complexity**: 3/10 (verifier: light)
> **תלות (depends_on)**: `[chat-render-polish]` — ✅ **מוזג ל-dev** (`cc5ff66`). base = `dev`.
> ✅ **Q1/R1 נפתרו**: `enter-toggle` **כבר מוזג ל-dev** (`160736b`, `enterToSend` בקוד) → base=dev מכיל אותו, אין conflict, לינארי. (ה-§9 Q1 וה-§6 R1 התיישנו — ראה הערות שם.)
> ⚠️ **collision עם `chat-virtualization`**: שניהם נוגעים ב-`ToolBubble`/`ThoughtBubble`. **slice זה רץ ראשון** → merge → אז chat-virtualization מעליו.

---

## §1 — מטרה

שני המחוונים בכרטיס "Chat display" (מ-chat-render-polish) בעלי **פולריות הפוכה**: "Collapse thoughts" — ON מסתיר; "Expand tools" — ON מציג. באותו כרטיס, הפעלת מתג אחד מסתירה ואחרת מציגה — מבלבל. המטרה: **לאחד לפולריות חיובית אחת** ("Show X by default") — ON תמיד מציג. ההתנהגות-בפועל של ברירות-המחדל נשמרת (מחשבות מוצגות, כלים מצומצמים), רק המודל המנטלי נעשה עקבי. משתמשים קיימים שומרים את ההעדפה שלהם דרך migration.

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/slice-display-toggle-consistency -b slice-display-toggle-consistency dev
cd .worktrees/slice-display-toggle-consistency
pnpm install && pnpm hooks:install
```

### Run
- **FE בלבד** — אין נגיעת BE/proxy. OneCLI לא דרוש.
- FE: `pnpm --filter @drive-coding/frontend-v2 dev` (port: OS-assigned).
- typecheck/test/lint: `pnpm --filter @drive-coding/frontend-v2 typecheck` · `... test` · `pnpm lint:i18n`.

### Browser
- linux-gui Chrome :9222. `playwright-cli -s=vacp attach --cdp=http://localhost:9222` (תמיד `-s=vacp`).
- בדיקת UI בלי BE: `/chat?mock=greeting` (reload מלא). ל-settings: `/settings`.

### OneCLI agent
- **לא דרוש**.

### Reading list
**must-read לפני**:
- `packages/frontend/AGENTS.md` — חמשת חוקי הזהב.
- **ההוראות בראש `settings.svelte.ts` (LL 4-13)** — הוספת/שינוי שדה Persisted.
- **§6 R2 (snap-back)** בקובץ זה — הלוגיקה `let open = $state(...)` היא **מכוונת** (תיקון snap-back של chat-render-polish). אסור להחזיר ל-`open={...}` reactive.

**reference**:
- `docs/decisions/drive-coding.md` — entry של chat-render-polish (רציונל ברירות-המחדל).

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| rename `collapseThoughts`→`showThoughts` (+flip polarity) | ✅ | הסבר זה |
| rename `expandTools`→`showTools` (polarity כבר חיובית — רק שם) | ✅ | הסבר זה |
| migration ל-localStorage קיים | ✅ | הסבר זה |
| `enterToSend` (enter-toggle) | ❌ | כבר חיובי — לא נוגעים בלוגיקה שלו (רק co-exist בכרטיס) |
| שינוי ברירות-מחדל של *מה גלוי* | ❌ | נשמרות (מחשבות מוצגות, כלים מצומצמים) |
| per-bubble override (snap-back fix) | ❌ | נשמר כמו שהוא (`$state` מקומי) |

## §3 — Architecture diagram

```
core/i18n: keys.ts + he.ts + en.ts   ← rename 2 keys (collapse→show, expand→show)
┌─ components ──────────────────────────────────────────┐
│  ThoughtBubble.svelte  ← open = showThoughts           │
│  ToolBubble.svelte     ← open = showTools              │
│  settings/SettingsScreen.svelte ← labels + reset       │
├─ view-models ─────────────────────────────────────────┤
│  settings.svelte.ts    ← rename fields + defaults +    │
│                          setters + #persist + MIGRATION │
└────────────────────────────────────────────────────────┘
```

## §4 — Commits

> **אינוונטר usages מלא (dev, 2026-06-25)** — שנֵה כל אחד:
> - `packages/core/src/i18n/keys.ts:203,204`
> - `packages/core/src/i18n/catalogs/en.ts:198,199`
> - `packages/core/src/i18n/catalogs/he.ts:193,194`
> - `packages/frontend/src/lib/components/chat/bubbles/ThoughtBubble.svelte:34`
> - `packages/frontend/src/lib/components/chat/bubbles/ToolBubble.svelte:30`
> - `packages/frontend/src/lib/components/settings/SettingsScreen.svelte:128,129,133,134,178,179`
> - `packages/frontend/src/lib/view-models/settings.svelte.ts:43,44,67,68,129,130,152,153,316,321,340,341` (+ שמות הסטרים ~314-322)
> אחרי השינוי הרץ `grep -rn "collapseThoughts\|expandTools" packages/` — חייב להחזיר **0**.
> ⚠️ **מספרי השורות לעיל = dev הנוכחי (לפני merge של enter-toggle).** אם `enter-toggle` מוזג קודם (§6 R1): המספרים בקבצים `SettingsScreen.svelte` (+~6) ו-`settings.svelte.ts` (+~6) **יזוזו**, ושורת `setEnterToSend(true)` תשב **בתוך** בלוק ה-reset (בין השתיים) — **שמור אותה**. אל תסתמך על המספרים — אתר ע"י grep ועוגני-context.

### Commit 1 — settings rename + defaults + migration + i18n + tests (approach: mixed)

**`packages/frontend/src/lib/view-models/settings.svelte.ts`** — rename מלא:
- `Persisted`: `collapseThoughts`→`showThoughts`, `expandTools`→`showTools`.
- `DEFAULTS`: `showThoughts: true` (היה `collapseThoughts:false` → מחשבות מוצגות), `showTools: false` (היה `expandTools:false` → כלים מצומצמים). **ההתנהגות זהה.**
- `$state`, constructor, setters → `setShowThoughts`/`setShowTools`, `#persist` keys.
- **MIGRATION ב-`load()`** (אחרי `JSON.parse`, לפני ה-spread). החלף את שורה 77:
  ```ts
  const parsed = JSON.parse(raw) as Partial<Persisted> & {
    collapseThoughts?: boolean
    expandTools?: boolean
  }
  // migration (display-toggle-consistency): מפתחות ישנים → פולריות חיובית.
  // נשמר רק אם המפתח החדש עדיין לא קיים (לא לדרוס בחירה חדשה).
  if (parsed.showThoughts === undefined && parsed.collapseThoughts !== undefined) {
    parsed.showThoughts = !parsed.collapseThoughts
  }
  if (parsed.showTools === undefined && parsed.expandTools !== undefined) {
    parsed.showTools = parsed.expandTools
  }
  return { ...DEFAULTS, ...parsed }
  ```
  > המפתחות הישנים נשארים באובייקט אך אינם ב-`Persisted` ולא נכתבים ב-`#persist` → נופלים בשמירה הבאה. תקין.

**`packages/core/src/i18n/keys.ts`** (203-204): `collapseThoughts`→`showThoughts`, `expandTools`→`showTools`.
**`catalogs/en.ts`** (198-199):
```ts
"settings.toggle.showThoughts": "Show thoughts by default",
"settings.toggle.showTools": "Show tools by default",
```
**`catalogs/he.ts`** (193-194):
```ts
"settings.toggle.showThoughts": "הצג מחשבות כברירת מחדל",
"settings.toggle.showTools": "הצג כלים כברירת מחדל",
```

**Tests** — `settings.test.svelte.ts` (עקוב אחרי דפוס `screenWakeLock`/`muted`):
- `default showThoughts = true when localStorage empty`
- `default showTools = false when localStorage empty`
- round-trip ל-`setShowThoughts(false)` / `setShowTools(true)`
- **migration**: `localStorage` עם `{"collapseThoughts":true}` → `new Settings().showThoughts === false`; עם `{"expandTools":true}` → `showTools === true`.

**Verification**:
```bash
pnpm --filter @drive-coding/frontend-v2 typecheck   # 0 errors
pnpm --filter @drive-coding/frontend-v2 test
pnpm lint:i18n
```

### Commit 2 — חיווט bubbles + UI (approach: manual — browser smoke)

- **`ThoughtBubble.svelte:34`**: `let open = $state(settings.showThoughts)` (היה `!settings.collapseThoughts`). **השאר `$state` + `bind:open` — לא reactive (snap-back).**
- **`ToolBubble.svelte:30`**: `let open = $state(settings.showTools)` (היה `settings.expandTools`).
- **`SettingsScreen.svelte`** (128-135): labels → `showThoughts`/`showTools`; `checked`/`onCheckedChange` → `settings.showThoughts`/`setShowThoughts`, `settings.showTools`/`setShowTools`.
- **reset** (178-179): `settings.setShowThoughts(true)` + `settings.setShowTools(false)` (= ברירות-מחדל החדשות).

**Verification (browser smoke)**:
```bash
pnpm --filter @drive-coding/frontend-v2 dev
# /settings — כרטיס "Chat display": שני מתגים "Show thoughts" (ON) + "Show tools" (OFF), ON תמיד=מציג
# /chat?mock=greeting — מחשבות מוצגות, כלים מצומצמים (ברירת מחדל ללא שינוי)
# כבה "Show thoughts" → מחשבות מצומצמות. הדלק "Show tools" → כלים פתוחים.
# Reset → "Show thoughts" ON, "Show tools" OFF.
# migration ידני: ב-DevTools localStorage הזרק {"collapseThoughts":true} ל-drive-coding-v2-settings, reload → "Show thoughts" OFF.
pnpm --filter @drive-coding/frontend-v2 typecheck && pnpm lint:i18n
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| 0 שימושים שנותרו ב-`collapseThoughts`/`expandTools` | `grep -rn` מחזיר 0 |
| שני המתגים פולריות חיובית (ON=מציג) | code review + ידני |
| ברירות-מחדל = התנהגות נוכחית (מחשבות מוצגות, כלים מצומצמים) | ידני + unit |
| migration: collapseThoughts:true → showThoughts:false | unit + ידני (localStorage) |
| migration: expandTools:true → showTools:true | unit |
| snap-back נשמר (`$state` מקומי, לא reactive) | code review ב-2 ה-bubbles |
| reset → showThoughts ON, showTools OFF | ידני |
| labels ב-he+en, אין עברית בקוד | `pnpm lint:i18n` |
| typecheck + test נקיים | הפקודות ב-§4 |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| **R1 — conflict עם `enter-toggle`** ✅ **נפתר — enter-toggle מוזג (`160736b`)** | שניהם עורכים את כרטיס "Chat display" + בלוק reset ב-`SettingsScreen.svelte` | ~~merge-ordering~~ **לא רלוונטי יותר**: `enter-toggle` כבר ב-dev, base=dev מכיל אותו. `enterToSend` חיובי — לא נוגעים בלוגיקה שלו, רק דואגים שהמתג נשאר בכרטיס. (עדיין שים לב בעת עריכת `SettingsScreen.svelte`: ה-toggle של enterToSend קיים שם — additive בלבד סביבו.) |
| **R2 — snap-back** | chat-render-polish (commit 3 fix `0adfb17`) | ה-`open` חייב להישאר `let open = $state(...)` (אתחול חד-פעמי) + `bind:open`. **אסור** `open={settings.showX}` reactive — יחזיר את ה-snap-back (קיפול ידני מתאפס באמצע turn). |
| migration שלא רץ → משתמש מאבד העדפה | — | migration ב-`load()` ממופה רק כש-המפתח החדש `undefined` (לא דורס בחירה חדשה); unit test מאמת שני הכיוונים |
| מחרוזת עברית קשיחה | pre-commit hook | התוויות דרך `t(...)`; שני מפתחים ב-he+en |
| Svelte 5 reactivity על rename | — | רק שינוי שם + אתחול; אין array-mutation |

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- `enter-toggle` כבר מוזג ל-dev והבסיס מכיל 3 מתגים בכרטיס (לוודא שלא דורסים את `enterToSend`).
- ה-snap-back fix לא קיים בבסיס (`open={...}` reactive במקום `$state`) — סימן לבסיס שגוי (chat-render-polish לא מוזג).
- migration שובר טסט קיים באופן לא-צפוי.

## §8 — Complexity score

- commits: 2 · שכבות חדשות: 0 · APIs חיצוניים: 0 · streaming/async: לא · protocol BE↔FE: לא
- +1 על migration של persisted state. **Score ≈ 3/10 → verifier `calev` mode: light.**

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | למזג `enter-toggle` קודם, או לשרשר slice זה עליו? | ✅ **הוכרע — enter-toggle כבר מוזג (`160736b`)**. base=dev (לינארי, נקי). | ❌ נפתר |
| 2 | שמות מפתחי i18n — `showThoughts`/`showTools`? | כן (תואם פולריות חיובית) | ❌ |
| 3 | להשאיר migration לנצח או להסיר אחרי כמה גרסאות? | להשאיר (זול, בלי תאריך תפוגה) | ❌ |
