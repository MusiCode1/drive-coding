# Slice 25 — Bridge Process Leak Fix — ‏תוכנית

> **‏תאריך**: 2026-06-01
> **‏סטטוס**: ‏מאושר (‏אביגיל: READY ‏אחרי תיקון תיעוד, 2026-06-01)
> **Complexity**: 2/10 (verifier: light)
> **‏תלויות (`depends_on`)**: []
> **‏Base**: dev
> **‏Dev tip**: `62b41a0dcdb039bcdd09dba99f97238496f2924b`

---

## §0 — Pre-flight

> ‏אם אתה executor חדש: ‏קרא את [`EXECUTOR_DISPATCH.md`](./EXECUTOR_DISPATCH.md) ‏לפני כל דבר אחר.

### ‏תלויות (חובה)

‏slice זה **‏מבוסס על dev בלבד**. ‏כל הסמלים שצוינו להלן קיימים ב-dev tip `62b41a0`:

- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `AgentSession` ‏עם `attach`, `loadSession`, `detach`, `#cleanup`, `agentId`.
- `packages/frontend/src/lib/adapters/agents-api.ts` — `createAgent`, `deleteAgent` (‏שניהם כבר קיימים ‏ועובדים).
- `packages/frontend/src/lib/adapters/sessions.ts` — ‏דוגמת-ייחוס לדפוס spawn→delete תקין (`finally` + `void deleteAgent(...).catch(...)`).
- `packages/backend/src/delivery/ws-agent.ts` — ‏צינור ה-WS; ‏שורה 126 ‏מתעדת במפורש: ‏סגירת WS **‏לא** ‏הורגת את ה-child (‏בכוונה).
- `packages/backend/src/app/agent-orchestrator.ts` — `deleteAndKill(id)` ‏שמופעל מ-`DELETE /api/agents/:id` → ‏הורג את ה-bridge.

`depends_on: []`.

> **‏הערה על base**: ‏slices 22/23/24 ‏מתוכננים/ממתינים אך **‏לא ממוזגים** ל-dev. ‏slice זה נוגע רק ב-`#cleanup`/`detach` ‏של `AgentSession` ‏וב-i18n — ‏אזורים שאינם נוגעים ב-22/23/24. ‏לכן `base: dev`, `depends_on: []`. ‏אם 23 ‏(שמרחיב את אותו VM) ‏יתמזג לפני סלייס זה — ‏אין התנגשות state (‏23 ‏מוסיף שדות, ‏25 ‏מוסיף שורה ב-`#cleanup`). ‏Tama ‏ממזג בסדר.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-25-bridge-leak-fix -b slice-25-bridge-leak-fix dev
cd .worktrees/slice-25-bridge-leak-fix
pnpm install
pnpm hooks:install
```

### ‏איך להריץ

| ‏מה | ‏פקודה |
|---|---|
| ‏BE | `cd packages/backend && LOG_WIRE=ws PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts` |
| ‏FE | `BE_PORT=4001 pnpm --filter @drive-coding/frontend-v2 dev` |
| ‏Typecheck | `pnpm --filter @drive-coding/frontend-v2 typecheck` |
| ‏כללי | `pnpm typecheck && pnpm lint:i18n` |

‏אם port 4001 ‏תפוס — ‏עבור ל-4002+. **‏אל תהרוג** ‏שירותים קיימים (‏כולל `voice-acp-be` ‏ה-systemd ‏על 4000).

### Browser

‏Chrome ‏רגיל. ‏אין מיקרופון בסלייס הזה — ‏אין צורך ב-HTTPS/tunnel.

### ‏איך לוודא דליפה / ‏תיקון (‏כלי האימות המרכזי)

‏ספירת תהליכי ה-CLI ‏שה-BE ‏יילד. ‏ב-OneCLI ‏ה-bridge ‏הוא `opencode` (‏או `claude`/`gemini`/`codex` ‏לפי הבחירה):

```bash
# ‏ספירת תהליכי opencode שה-BE יילד (בזמן ש-BE רץ על 4001)
pgrep -af 'opencode' | grep -v -- '--watch' | wc -l
```

> ‏לפני הסלייס: ‏כל connect→disconnect ‏מגדיל את המספר ‏ב-1 ‏ולא מקטין.
> ‏אחרי הסלייס: ‏disconnect ‏מחזיר את המספר למצב הקודם תוך ~5 ‏שניות (SIGTERM→SIGKILL).
>
> ‏לחלופין: `GET http://127.0.0.1:4001/api/agents` ‏— ‏רשימת הסוכנים החיים. ‏אחרי disconnect ‏הסוכן צריך להיעלם מהרשימה.

### OneCLI

```bash
onecli run --agent voice-acp -- bun --watch src/server.ts
```

### Reading list

**must-read**:

1. `packages/frontend/AGENTS.md` — 5 ‏חוקי הזהב + ‏מבנה 5 ‏שכבות.
2. `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `#cleanup` + `detach` ‏שמשתנים.
3. `packages/frontend/src/lib/adapters/sessions.ts` — **‏דפוס הייחוס** ‏ל-fire-and-forget delete (‏שורות 62–73).

**reference**:

- `packages/backend/src/delivery/ws-agent.ts` ‏שורה 126 — ‏למה ה-BE ‏לא הורג את ה-child ‏לבד.
- `docs/conventions/parallel-safe-code.md` §1 — ‏עריכה אדיטיבית.

---

## §1 — ‏מטרה

‏היום, ‏כל מחזור שיחה (connect → disconnect, ‏רענון דף, ‏או שגיאת חיבור) ‏משאיר תהליך CLI ‏(opencode/claude/gemini) ‏יתום וחי ב-BE ‏לנצח — ‏עד שה-BE ‏עצמו נופל. ‏הסיבה: ‏ה-BE ‏בכוונה לא הורג את ה-child ‏בסגירת WS (‏כדי לאפשר reconnect), ‏אבל ה-FE ‏אף פעם לא קורא ל-`deleteAgent` ‏ב-`detach`/`#cleanup` ‏ולא מבצע reconnect אמיתי. ‏אחרי הסלייס: ‏לחיצה על "‏disconnect" ‏(או כל cleanup) ‏שולחת `DELETE /api/agents/:id`, ‏ה-BE ‏הורג את ה-bridge, ‏והתהליך מתנקה. ‏זהו תיקון-עצירת-דימום (‏גישה B). ‏מנגנון agents-ברקע ‏עם ממשק ניהול הוא slice עתידי נפרד (‏ראה §2).

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| `#cleanup` ‏קורא `deleteAgent(agentId)` ‏לפני איפוס | ✅ | ‏הסלייס הזה |
| `detach` ‏מסתמך על `#cleanup` (‏כבר קורא לו) → ‏מקבל את התיקון בחינם | ✅ | ‏הסלייס הזה |
| ‏fire-and-forget (‏לא חוסם UI, ‏לא זורק) | ✅ | ‏הסלייס הזה |
| ‏לכידת `agentId` ‏מקומית לפני האיפוס ל-null | ✅ | ‏הסלייס הזה |
| ‏מנגנון "‏agents חיים ברקע" + ‏ממשק לראות/לסגור | ❌ | **‏future slice** (‏גישה A ‏המורחבת — ‏reconnect לפי session + ‏רשימת agents פעילים + ‏ניהול) |
| ‏חיווט `existingSessionId` ‏ל-dedup ‏בצד שרת | ❌ | ‏future (‏חלק מ-agents-ברקע) |
| ‏timeout/GC ‏ל-bridges יתומים בצד BE | ❌ | ‏future (‏רשת-ביטחון; ‏לא נדרש כש-FE ‏מנקה) |
| ‏שינוי התנהגות ה-BE ‏ב-`ws-agent.ts` | ❌ | ‏לא נוגעים — ‏ההתנהגות "child שורד WS close" ‏נשארת (‏נחוצה ל-future A) |

> ‏**‏חשוב**: ‏אנחנו **‏לא** ‏משנים את `ws-agent.ts:126`. ‏ה-child עדיין שורד סגירת WS ‏"סתמית" (‏reload בלי disconnect מפורש). ‏אנחנו רק מוסיפים מסלול disconnect מפורש שכן הורג. ‏זה משאיר את התשתית ל-future A ‏שלמה.

---

## §3 — Architecture diagram

```text
‏─── ‏מסלול disconnect מפורש (‏המשתמש לוחץ "disconnect") ───
routes/chat/+page.svelte  onDisconnect()
  └── session.detach()                       (‏קיים)
        └── #cleanup()                       (‏קיים — ‏מתוקן בסלייס זה)
              ├── const id = this.agentId    ← ‏חדש: ‏לכוד לפני איפוס
              ├── this.#client?.close()      (‏קיים)
              ├── this.agentId = null        (‏קיים)
              └── if (id) void deleteAgent(id).catch(()=>{})   ← ‏חדש: ‏fire-and-forget

deleteAgent(id)  →  DELETE /api/agents/:id  →  orchestrator.deleteAndKill(id)
                                                  └── bridgeManager.kill(id)  →  SIGTERM→SIGKILL

‏─── ‏מסלול error (attach/loadSession נכשל) ───
attach/loadSession  catch  →  #cleanup()     ← ‏אותו תיקון חל גם כאן (‏מנקה bridge שנוצר חלקית)
```

### ‏כלל ארכיטקטורה מחייב

- ‏התיקון כולו ב-`#cleanup` ‏בלבד. ‏`detach` ‏ו-error paths ‏כבר קוראים ל-`#cleanup` → ‏מקבלים את התיקון בלי שינוי נוסף.
- ‏לא נוגעים ב-BE. ‏לא נוגעים ב-`ws-agent.ts`.
- ‏`deleteAgent` ‏הוא **‏fire-and-forget** — ‏בדיוק כמו ב-`sessions.ts:71`. ‏אסור ל-`await` ‏אותו ‏ולא לתת לו לזרוק (‏cleanup ‏רץ גם ב-error path; ‏שגיאת רשת ב-delete ‏לא צריכה להסלים).

---

## §4 — Commits ‏בסדר

### Commit 1 — `#cleanup` ‏הורג את ה-bridge (approach: manual)

**‏מטרה**: ‏`#cleanup` ‏שולח `deleteAgent` ‏על ה-agentId ‏הנוכחי לפני איפוסו.

**‏קבצים משתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
| `packages/frontend/src/lib/view-models/agent-session.svelte.ts` | ‏import `deleteAgent` + ‏עדכון `#cleanup` |

**Before** (‏קוד קיים, ‏שורות ~254–263):

```ts
#cleanup(): void {
  try {
    this.#client?.close()
  } catch {
    // ‏כבר סגור
  }
  this.#client = null
  this.#sessionId = null
  this.agentId = null
}
```

**After**:

```ts
#cleanup(): void {
  // ‏לכוד את ה-agentId לפני האיפוס — ‏צריך אותו ל-deleteAgent.
  const agentId = this.agentId
  try {
    this.#client?.close()
  } catch {
    // ‏כבר סגור
  }
  this.#client = null
  this.#sessionId = null
  this.agentId = null
  // ‏הורג את ה-bridge בצד ה-BE. ‏ה-BE לא הורג את ה-child בסגירת WS לבד
  // (‏ws-agent.ts:126 — ‏בכוונה, ‏לאפשר reconnect עתידי), ‏לכן ה-FE אחראי
  // לבקש מחיקה מפורשת. ‏fire-and-forget — ‏לא חוסם, ‏לא זורק (‏cleanup רץ גם
  // ב-error path; ‏ראה sessions.ts:71 לאותו דפוס).
  if (agentId) void deleteAgent(agentId).catch(() => {})
}
```

**Import** (‏שורה 16 ‏קיימת): ‏הוסף `deleteAgent` ‏ל-import הקיים:

```ts
// before:
import { createAgent, notifySessionAttached } from "$lib/adapters/agents-api"
// after:
import { createAgent, deleteAgent, notifySessionAttached } from "$lib/adapters/agents-api"
```

> ⚠️ ‏אל תיצור import חדש — ‏הוסף ל-import הקיים בשורה 16.

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm typecheck
```

‏Manual (‏הליבה של הסלייס):

1. ‏הפעל BE ‏על 4001 ‏+ ‏FE.
2. ‏ספור: `curl -s http://127.0.0.1:4001/api/agents | grep -o '"id"' | wc -l` ‏(או `pgrep`).
3. ‏התחבר ל-opencode בתיקייה כלשהי → ‏היכנס לצ'אט → ‏ודא שהמספר עלה ב-1.
4. ‏לחץ "disconnect" → ‏המתן ~5 ‏שניות → ‏ספור שוב → ‏המספר ירד ל-baseline.
5. ‏חזור על 3–4 ‏שלוש פעמים → ‏ודא שאין הצטברות (‏baseline יציב).
6. ‏error path: ‏נסה להתחבר ל-cwd ‏שגוי/לא קיים → ‏ודא שלא נשאר agent ב-`/api/agents` (‏ה-attach נכשל ‏ו-`#cleanup` ‏ניקה).

---

### Commit 2 — Docs + ‏סטטוס (approach: manual)

**‏קבצים**:

| ‏קובץ | ‏שינוי |
|---|---|
| `docs/walkthrough.md` | ‏רשומת ביצוע (‏שיטת `update-walkthrough`) |
| `docs/plans/slice-25-bridge-leak-fix.md` | ‏עדכון סטטוס + ‏סטיות |
| `packages/frontend/docs/slices.md` | ‏רישום slice 25 ‏אם חסר |

```bash
pnpm typecheck
pnpm lint:i18n
pnpm --filter @drive-coding/frontend-v2 build
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏Typecheck ‏ירוק | `pnpm typecheck` |
| 2 | ‏Frontend typecheck ‏ירוק | `pnpm --filter @drive-coding/frontend-v2 typecheck` |
| 3 | ‏Build ‏ירוק | `pnpm --filter @drive-coding/frontend-v2 build` |
| 4 | ‏אין עברית קשיחה | `pnpm lint:i18n` (‏הסלייס לא מוסיף מחרוזות UI; ‏הערות עברית מותרות — ‏ה-lint מנקה הערות לפני סריקה) |
| 5 | ‏disconnect ‏הורג bridge | ‏connect→disconnect → `/api/agents` ‏מתרוקן + `pgrep` ‏יורד |
| 6 | ‏אין דליפה אחרי 3 ‏מחזורים | ‏3× connect→disconnect → baseline יציב |
| 7 | ‏error path ‏מנקה | ‏connect ל-cwd ‏שגוי → ‏אין agent יתום ב-`/api/agents` |
| 8 | ‏Regression: ‏שיחה רגילה עובדת | ‏connect → ‏שלח פרומפט → ‏קבל תשובה → ‏disconnect — ‏הכל כרגיל |
| 9 | ‏Regression: ‏רשימת סשנים עדיין נקייה | ‏פתח picker (`listSessionsForCwd`) → ‏ודא ש-`/api/agents` ‏לא צובר (‏היה נקי, ‏נשאר נקי) |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏`await deleteAgent` ‏יחסום/יזרוק ב-error path | ‏cleanup ‏רץ ב-catch | ‏fire-and-forget: `void deleteAgent(id).catch(()=>{})` — ‏בדיוק כמו sessions.ts:71 |
| ‏`agentId` ‏כבר null ‏בקריאה כפולה ל-cleanup | ‏detach ‏עלול להיקרא פעמיים | ‏guard `if (agentId)` — ‏null → ‏no-op |
| ‏הריגת bridge ‏בזמן שעדיין רץ prompt | ‏המשתמש לוחץ disconnect ‏באמצע | ‏זו הכוונה — disconnect מפורש ‏= ‏המשתמש רוצה לעזוב. `deleteAndKill` ‏ב-BE ‏עושה SIGTERM→SIGKILL ‏מסודר |
| ‏future A (agents-ברקע) ‏יסתור את התיקון | ‏עיצוב עתידי | ‏לא — A ‏יוסיף *‏לא* ‏לקרוא ל-deleteAgent ‏ב-disconnect מסוים (‏"השאר ברקע"); ‏זה שינוי עתידי מודע, ‏לא רגרסיה. ‏כרגע ברירת המחדל הנכונה היא לנקות |
| ‏מחרוזת עברית קשיחה | ‏pre-commit hook | ‏הסלייס מוסיף רק הערות קוד — ‏מותר. ‏ה-lint (`lint-no-hebrew-in-code.sh`) ‏מנקה הערות לפני הסריקה; ‏כל `agent-session.svelte.ts` ‏כבר כתוב בהערות עברית וה-lint ‏עובר. ‏השאר את ההערות בעברית כמו בדוגמת ה-After |
| ‏Svelte 5 reactivity | ‏`agentId` ‏הוא `$state` | ‏אין בעיה — ‏האיפוס ל-null ‏כבר קיים; ‏לא משנים ריאקטיביות |

---

## §7 — Escalation triggers

- ‏`deleteAndKill` ‏ב-BE ‏לא הורג בפועל את ה-child (‏ה-bridge נשאר ב-`/api/agents` ‏אחרי DELETE) — ‏עצור, ‏זה באג BE ‏נפרד.
- ‏אתה רוצה לשנות את `ws-agent.ts` ‏או את התנהגות ה-BE — ‏עצור (‏זה future A, ‏מחוץ ל-scope).
- ‏אתה רוצה לשנות signature ‏של `detach`/`attach`/`loadSession` — ‏עצור (‏invasive).
- ‏מתברר שיש מסלול cleanup ‏שלישי שלא דרך `#cleanup` — ‏דווח.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|---|---:|
| ‏שינוי בקובץ אחד, ‏~6 ‏שורות | 0 |
| ‏אין API ‏חדש, ‏אין שכבה חדשה | 0 |
| ‏fire-and-forget ‏על adapter קיים | +1 |
| ‏אין streaming/audio/state-model | 0 |
| ‏אין protocol חדש | 0 |
| ‏Regression surface ‏קטן (cleanup ‏בלבד) | +1 |

**Score**: 2/10

**Tier**: `calev` mode: light ‏בסוף. ‏אין צורך ב-phase verifier.

> ‏האימות המרכזי הוא **runtime** (‏ספירת תהליכים/agents ‏לפני-אחרי), ‏לא inference — ‏לכן calev (Sonnet) ‏מספיק לחלוטין.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏האם להרוג bridge ‏גם ב-reload "סתמי" (‏לא disconnect מפורש)? | ‏לא — ‏רק disconnect מפורש + error. ‏reload סתמי משאיר את ה-child (‏תשתית ל-future A) | ❌ |
| 2 | ‏האם להוסיף עכשיו timeout/GC ‏ל-bridges יתומים ב-BE? | ‏לא — future. ‏ה-FE cleanup ‏מספיק לעצירת הדימום | ❌ |
| 3 | ‏האם ההערות בקוד מותרות בעברית (lint:i18n)? | ‏כן — ‏ה-lint מנקה הערות לפני סריקה. ‏השאר עברית | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

- (‏טרם בוצע)
