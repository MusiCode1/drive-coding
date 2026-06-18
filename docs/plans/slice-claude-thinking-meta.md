# Slice claude-thinking-meta — הזרקת thinking-display ל-claude דרך `_meta` (consumer) — תוכנית

> **תאריך**: 2026-06-18
> **סטטוס**: הושלם (מוזג ל-dev 35c9755, אומת חי e2e: thought full:3/empty:1)
> **Complexity**: 3/10 (verifier: light)
> **תלויות (`depends_on`)**: [slice-acp-session-meta] — חוסם: דורש את ה-`_meta` passthrough ב-provider-contract, merged+pushed (edb562e)
> **Base**: dev
> **Dev tip**: `f1e6313`

---

## §0 — Pre-flight

> ⚠️ **אתה ה-executor** — מבצע ישירות. verifier-slice-light בסוף. ראה `docs/plans/EXECUTOR_DISPATCH.md`.

### תלויות (חובה!)

slice זה **מבוסס על** Slice A (`slice-acp-session-meta` ב-repo `provider-contract`):
- A מוסיף `_meta?` ל-`AcpClient.newSession`/`loadSession`. בלי A merged+pushed → ה-git-dep לא יכיל את ה-`_meta` type → Commit 2 לא יעבור typecheck.
- ⚠️ לפני שמתחילים — ודא ש-Slice A מוזג ל-main של provider-contract ונדחף ל-GitHub.

### Worktree

```bash
git -C /d/UserProjects/AI/drive-coding/dev worktree add /d/UserProjects/AI/drive-coding/.worktrees/slice-claude-thinking-meta -b slice-claude-thinking-meta dev
cd /d/UserProjects/AI/drive-coding/.worktrees/slice-claude-thinking-meta
pnpm install && pnpm hooks:install
```

### איך להריץ

- Typecheck: `pnpm --filter @drive-coding/frontend-v2 typecheck` (svelte-kit sync קודם — memory: worktree חדש)
- Tests: `pnpm --filter @drive-coding/frontend-v2 test -- agent-session`
- lint:i18n: `bash ./scripts/lint-no-hebrew-in-code.sh`
- בדיקה חיה (e2e): BE (`WIRE_RECORD=1 bun src/server.ts`, bun ישיר ב-Windows) + FE + claude agent + prompt → `agent_thought_chunk` לא ריק ב-`.jsonl`.

### Reading list

1. `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — **5 call sites**: newSession (~503 attach, ~798 warm), loadSession (~446 warmReconnect, ~635, ~741 switchSession). `#cliKind` (~150) מוגדר לפני כל call site. import `provider-contract/acp` (~20).
2. `agent-session.test.ts` — הטסטים הקיימים בודקים `toHaveBeenCalledWith({ cwd: "/tmp" })` (~216) עם opencode. conditional spread שומר עליהם.
3. Slice A brief: `provider-contract/main/docs/plans/slice-acp-session-meta.md`.
4. רקע: `docs/decisions/voice-acp.md` (wire-recorder-jsonl) — האבחנה (Opus 4.7/4.8 → display:omitted).

---

## §1 — מטרה

כל session של **claude** מקבל אוטומטית `_meta.claudeCode.options.thinking = { type:"adaptive", display:"summarized" }` ב-newSession/loadSession, וה-thinking summaries חוזרים (במקום בועות ריקות). ספקים אחרים — ללא שינוי. always-on ל-claude (החלטת המשתמש).

רקע: Opus 4.7+ שינו default ל-`display:"omitted"`. ה-thinking זורם אבל ריק. `display:"summarized"` מחזיר אותו. אומת חי (control 0 → treatment 3).

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| עדכון git-dep `provider-contract` ל-`_meta` passthrough | ✅ | Commit 1 |
| `CLAUDE_SESSION_META` + `#sessionMeta()` | ✅ | Commit 2 |
| הזרקת `_meta` ב-5 call sites (conditional spread) | ✅ | Commit 2 |
| טסטים (claude→meta, opencode→בלי) | ✅ | Commit 2 (TDD) |
| toggle/Settings | ❌ | always-on |
| `_meta` ל-prompt/cancel | ❌ | לא נדרש |
| שינוי ב-provider-contract | ❌ | Slice A |
| thinking ל-gemini/codex | ❌ | claude-specific |

---

## §3 — Architecture

```
AgentSession
  #sessionMeta() → cliKind==="claude" ? CLAUDE_SESSION_META : undefined
  5 call sites: #client.{new,load}Session({ ..., ...(m && { _meta: m }) })
         ▼
AcpClient (provider-contract, Slice A) → conn → claude-agent-acp → SDK → API (display:summarized)

CLAUDE_SESSION_META = { claudeCode: { options: { thinking: { type:"adaptive", display:"summarized" } } } }
```

עיקרון: drive-coding (consumer) היחיד שיודע על claude/thinking. provider-contract אגנוסטי. conditional spread שומר backward-compat.

---

## §4 — Commits בסדר

### Commit 1 — עדכון git-dep (approach: none)

```bash
pnpm update provider-contract   # מרענן ל-tip main (edb562e, עם Slice A)
pnpm --filter @drive-coding/frontend-v2 typecheck
```
DoD: pnpm-lock → commit חדש; typecheck נקי (`_meta?` זמין).
> גוטשה: אם cache לא מתרענן → `pnpm install --force` / מחק entry מ-lock. אם `_meta` עדיין חסר → Slice A לא pushed.

### Commit 2 — helper + הזרקה + tests (approach: tdd)

```ts
const CLAUDE_SESSION_META = {
  claudeCode: { options: { thinking: { type: "adaptive", display: "summarized" } } },
} as const

#sessionMeta(): Record<string, unknown> | undefined {
  return this.#cliKind === "claude" ? CLAUDE_SESSION_META : undefined
}

// 5 call sites:
const m = this.#sessionMeta()
await this.#client.newSession({ cwd, ...(m && { _meta: m }) })
await this.#client.loadSession({ sessionId, cwd, ...(m && { _meta: m }) })
```

> גוטשה — conditional spread: `...(m && { _meta: m })`. ל-opencode `m===undefined` → call נשאר `{ cwd }`. (Vitest deep-equal ממילא מתייחס ל-`_meta:undefined` כשווה, אבל ה-spread נקי יותר ולא משאיר undefined בחוט.)
> גוטשה — #cliKind תקף בכל 5 ה-call sites (נקבע ב-attach/loadSession לפני; warm על אותו bridge).

טסטים: #sessionMeta נכון; attach claude→_meta; opencode→בלי (no-regression); loadSession claude→_meta.

### Commit 3 — walkthrough + status (approach: none)

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck frontend | `pnpm --filter @drive-coding/frontend-v2 typecheck` |
| 2 | טסטים (חדשים+קיימים) | `pnpm ... test -- agent-session` |
| 3 | lint:i18n | `bash ./scripts/lint-no-hebrew-in-code.sh` |
| 4 | git-dep מעודכן | `grep provider-contract pnpm-lock.yaml` |
| 5 | e2e: claude → thinking מלא | BE+FE+claude, `WIRE_RECORD=1` → thought לא ריק |
| 6 | regression: opencode → בלי `_meta` | test + opencode חי |

---

## §6 — Risks + mitigations

| סיכון | מיטיגציה |
|------|----------|
| Slice A לא pushed → typecheck נכשל | §0 — ודא A pushed |
| טסטים קיימים נשברים | conditional spread |
| #cliKind null | #sessionMeta מחזיר undefined → spread מדלג |
| מחרוזת עברית | קוד אנגלי; JSDoc עברית מותר |

---

## §7 — Escalation triggers

1. Slice A לא ב-git-dep (typecheck לא מוצא `_meta`)
2. e2e לא ממלא thinking למרות ש-`_meta` נשלח (ראה `.jsonl`)
3. נדרש לשנות provider-contract (= Slice A)

---

## §8 — Complexity score: 3/10 → verifier-slice-light

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל |
|---|------|----------|
| 1 | adaptive או enabled+budget? | adaptive (אומת חי) |
| 2 | constant module-level או static? | module-level |
| 3 | loadSession (resume) גם? | כן — resume יוצר query חדש |

---

## סטיות מהתכנון

- **ביצוע**: pnpm store cache החזיק tarball ישן של provider-contract — נדרש cache refresh + reinstall ידני (one-time infra, לא bug).
- **calev**: רץ כ-self-verify אצל אליעזר (sub-agent לא יכול לשגר sub-agent); מרדכי הריץ calev אמיתי → PARTIAL (רק e2e env-blocked), ואז אימת e2e חי בעצמו → GO.
- **brief**: לא היה ב-worktree base (mordechai כתב ב-dev אחרי ה-tip); שוחזר ע"י מרדכי אחרי ה-merge (אבד זמנית בניקוי untracked).
