---
project: "voice-acp"
slice: "slice-ws-reconnect-fix-nbug2"
verifier: "calev"
date: "2026-06-04"
mode: "light"
verdict: "GO"
dod_items:
  - "closeAndWait exists in WsAcpTransport with listener-before-close + timeout fallback"
  - "transport ref saved in all 3 creation sites, cleared in all 4 null sites"
  - "#doReconnect calls closeAndWait + clears client/transport before warm"
  - "TDD unit tests pass (5 ws-transport + 2 agent-session reconnect)"
  - "typecheck exit 0"
  - "build exit 0"
  - "651 tests pass no regressions"
  - "in-browser auto-cold reconnect: n=1 after child kill (DoD#8 case 3)"
  - "detach: n→0 confirmed (DoD#8 case 2)"
spot_check: "FE on worktree BE :4013 — connect, 2x kill-child auto-cold, detach n=0, second WS gets 1008. No orphan agents."
findings:
  - id: 1
    severity: "minor"
    category: "unique"
    summary: "DoD#8 test 1 (reconnect() on live WS) not directly exercisable in headless: production Svelte build does not expose context — only TEMP button (hidden when connected). Covered by unit test DoD#1."
    source_brief: "DoD#8 test 1"
    source_code: "packages/frontend/src/lib/components/chat/RecordFooter.svelte:92"
    cost_estimate: "0 — documented limitation, not a bug"
  - id: 2
    severity: "minor"
    category: "unique"
    summary: "TEMP reconnect button (672aa42) still in RecordFooter causing lint:i18n failure (Hebrew literal). Committed with --no-verify. Expected to be removed with reconnect UI slice."
    source_brief: "commit message note"
    source_code: "packages/frontend/src/lib/components/chat/RecordFooter.svelte:91-105"
    cost_estimate: "5min — remove TEMP block before merge"
---

# slice-ws-reconnect-fix-nbug2 — Verification Report (Light)

> **תאריך:** 2026-06-04
> **Tier:** light
> **Commit:** `e1e0d6d`

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 7/8 (DoD#8.1 covered by unit test only) |
| Happy path עובד | ✅ auto-cold n=1, detach n=0 |
| Bugs חדשים | 0 (2 minors — לא blockers) |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | unit test: `closeAndWait` נקרא ב-`#doReconnect` | ✅ | 5/5 ws-transport.test.ts ✓; 2/2 agent-session reconnect tests ✓ |
| 2 | `closeAndWait` קיים — listener לפני `close()`, timeout fallback | ✅ | `ws-transport.ts:101-111` — `#closeListeners.push(resolve)` לפני `this.close()`, `Promise.race([closed, setTimeout(1000)])` |
| 3 | `#transport` ref שמור ב-3 יצירות + מנוקה ב-4 null sites | ✅ | grep `#transport` ב-`agent-session.svelte.ts` מציג lines 336/419/539 (שמירה) ו-303/333/386/794 (ניקוי) |
| 4 | `#doReconnect` קורא `closeAndWait` + מנקה לפני warm | ✅ | `:267-273` — `if (this.#transport) { await this.#transport.closeAndWait(); this.#client=null; this.#transport=null; }` |
| 5 | typecheck exit 0 | ✅ | אליעזר דיווח ✓; build output ב-commit message: `typecheck ✓` |
| 6 | build נקי (`@drive-coding/frontend-v2`) | ✅ | `build` ב-verification: `✓ built in 17.14s`, adapter-static output clean |
| 7 | 651 tests ✓ אין רגרסיה | ✅ | `651 passed | 12 skipped` — זהה לדיווח אליעזר |
| 8 | **in-browser (BE חי)**: n=1 לאחר reconnect, n=0 לאחר detach, auto-cold נקי | ✅⚠️ | cases 2+3 אומתו; case 1 (reconnect() על WS חי) — ראה מטה |

## Happy path

**Flow שבוצע (BE על :4013, FE build מ-worktree):**

1. Connect → agent נוצר (id=6ef408c4), WS מחובר, `n=1`
2. Kill child process PID 17709 (`opencode acp`) → FE מגיב, auto-cold reconnect → agent חדש (4c3b6c05), `n=1` ✅ (DoD#8 case 3)
3. Disconnect דרך UI → חזרה לדף /, `n=0` ✅ (DoD#8 case 2)
4. Connect שוב → agent (fc1ee0b4), `n=1`. ניסיון WS שני → `1008 "agent in use by another tab"` (BE guard עובד) ✅
5. Kill child שוב (PID 26057) → BE רושם `crashed`, agent חדש (e47ac98e starting→ready), `n=1` ✅

**DoD#8 test 1 — reconnect() על WS חי:**
- לא ניתן לקרוא `session.reconnect()` ישירות בbrowser: production Svelte 5 build לא חושף VM context ל-window; ה-TEMP button נסתר כש-`status !== "disconnected"`.
- **כיסוי בunit test (DoD#1):** `"reconnect() calls closeAndWait when #transport is set"` — ✅ עובר. הtest מזריק transport stub עם `closeAndWait` spy ומאמת שנקרא לפני `#findReusableAgent`.
- **אין agent יתום בלוג:** הlog של BE (grep 1008/second-tab) מציג רק `1008` אחד — ממבדיקת Bun ידנית שלי, לא מ-reconnect. ✅

✅ **עובד** — 3/4 cases in-browser, case 1 covered by unit test.

## Bugs חדשים שלא ברשימה

- ⚠️ **Minor 1: TEMP reconnect button גורם ל-lint:i18n failure** — Hebrew literal ב-`RecordFooter.svelte:99-101` (`מתחבר מחדש… / התחבר מחדש`). Commit 672aa42 עם `--no-verify`. לא חלק מ-slice זה, אבל צריך להסיר לפני merge.
- ⚠️ **Minor 2: DoD#8 test 1 לא ניתן לאמת ב-headless** — documented limitation (production Svelte build). Unit test מכסה. לא blocker.
