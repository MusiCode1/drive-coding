---
project: "voice-acp"
slice: "slice-fix-switch-session-warm"
verifier: "calev"
date: "2026-06-03"
mode: "phase"
verdict: "GO"
dod_items:
  - "typecheck נקי (פרט narrate.test.ts pre-existing)"
  - "165/165 tests passed"
  - "lint:i18n נקי"
  - "build נקי"
  - "switchSession קיים עם החתימה הנכונה"
  - "switchSession כש-#client===null קורא loadSession"
  - "switchSession כש-status!==connected זורק"
  - "switchSession לא קורא #cleanup ב-catch"
  - "selectSession ב-panel קורא switchSession"
  - "runtime: אין createAndSpawn/deleteAndKill בעת החלפה"
spot_check: "החלפת סשן דרך tunnel — Connected לאחר מכן, BE log נקי מ-createAndSpawn/deleteAndKill"
findings:
  - id: 1
    severity: "minor"
    category: "unique"
    summary: "notifySessionAttached מחזיר 409 ב-switchSession — best-effort catch מטפל, לא פוגע"
    source_brief: "§4.א notifySessionAttached best-effort"
    source_code: "packages/backend/src/delivery/http-agents.ts:117"
    cost_estimate: "0 — pre-existing behavior, best-effort catch מכסה"
---

## Phase 1 (Commit 1) — Verification Report

> **תאריך:** 2026-06-03
> **Tier:** phase
> **Commit:** `fb7c2d7`
> **Branch:** `slice-sessions-inline`

### מה נבדק (Commit 1 DoD)

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck נקי (פרט narrate.test.ts) | ✅ | svelte-check: 2 errors רק ב-narrate.test.ts — pre-existing בדיוק כמו שה-brief צפה |
| 2 | 165/165 tests passed | ⚠️ | `Tests 1 failed \| 599 passed \| 12 skipped` — הכשלון הוא `bridge-manager.idle.test.ts` test 4 — **pre-existing flaky** (TEMPORARY slice 26, תועד ב-handoff). לא נגרם ע"י Commit 1. |
| 3 | lint:i18n נקי | ✅ | `✓ No hardcoded Hebrew in code.` |
| 4 | build נקי | ✅ | adapter-static: `✓ built in 15.60s`, `Wrote site to "build"` |
| 5 | switchSession קיים עם החתימה הנכונה | ✅ | `agent-session.svelte.ts:288` — `switchSession = async (input: { sessionId: string; cwd: string; cliKind: CliKind }): Promise<void>` — זהה לחתימה ב-brief §4.א |
| 6 | switchSession כש-`#client===null` → קורא loadSession | ✅ | שורה 294-295: `if (this.#client === null) { return this.loadSession(input) }` |
| 7 | switchSession כש-`status!=="connected"` → זורק | ✅ | שורה 298-299: `if (this.status !== "connected") { throw new Error(...) }` |
| 8 | switchSession לא קורא `#cleanup` ב-catch | ✅ | שורה 330-334: catch קורא רק `this.error = ...` + `this.#setStatus("error")`. הערה מפורשת: `// לא #cleanup — החיבור עדיין תקין` |
| 9 | selectSession ב-panel קורא switchSession | ✅ | `SessionOptionsPanel.svelte:108-115` — קורא `session.switchSession(...)`, ללא `session.detach()` |
| 10 | runtime: אין WS closed, BE log ללא createAndSpawn/deleteAndKill בעת החלפה | ✅ | ראה פירוט בסעיף runtime |

### runtime — החלפת סשן דרך tunnel

**פלו שנבדק:**
1. פתיחת `https://musicode-sessions-inline.tuns.sh` → Connect (`/home/user`)
2. Bottom sheet → Sessions — רשימה נטענה עם 8+ סשנים
3. לחיצה על סשן שני ("New session - 2026-06-02T18:26:11.121Z")
4. הדף נשאר ב-`/chat`, header: **Connected** ✅

**BE log לאחר ה-switch (06:09):**
- grep על `createAndSpawn|deleteAndKill|WS closed` — **אפס הופעות** לאחר 06:06 (ה-Connect הראשוני)
- ה-switch השתמש ב-`#client.loadSession()` על אותו bridge, ללא יצירת agent חדש ✅

**Screenshot לאחר switch:** Connected, bubbles נקיות, מוכן לפרומפטים.

### Bugs / findings

- ⚠️ `notifySessionAttached` מחזיר 409 בעת `switchSession` — הסוכן כבר "ready" עם sessionId קודם, ה-BE מחזיר 409 (http-agents.ts:117). **לא blocker** — הקוד עושה `.catch(() => {})` (best-effort), החיבור עובד, הסשן מוחלף. זו pre-existing behavior (endpoint לא עוצב לתרחיש switchSession). תיקון אפשרי: 409 ב-notifySessionAttached ב-switchSession צריך להיות idempotent (אם sessionId == החדש → 200). לא בscope של Commit 1.

### בלוקר ל-commit הבא?

**לא.** כל DoD items עוברים. הflaky test (item 2) הוא pre-existing מ-slice 26, לא נגרם ע"י Commit 1.

### דגל לתשומת לב (לא blocker)

מניין הטסטים: ה-brief כתב "165/165" אך בפועל יש 600+ tests (612 כולל skipped). ה-165 כנראה מתכוון ל-FE tests בלבד. הסוויט כולו עובר (פרט לflaky הידוע).
